import { describe, expect, test } from "bun:test";
import { summarizeGatewayBenchmarkTrace } from "../../scripts/reporting/summarize-gateway-benchmark-trace";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function event(sequence: number, kind: "search" | "inspect" | "mutate" | "verify") {
  return JSON.stringify({
    schema: "lazydesigner-gateway-benchmark-trace-v1",
    sequence,
    task_id: "golden-existing-model-correction",
    source_sha: SHA,
    timestamp: "2026-09-29T00:00:00.000Z",
    kind,
    capability: kind === "search" ? null : "manage_cubes",
    success: true,
    latency_ms: 10,
    result_bytes: 100,
    read_only: kind === "inspect" || kind === "verify",
    verification_class: kind === "mutate" ? "visual" : null
  });
}

describe("gateway benchmark trace report", () => {
  test("summarizes objective metadata", () => {
    const report = summarizeGatewayBenchmarkTrace([
      event(0, "search"),
      event(1, "inspect"),
      event(2, "mutate"),
      event(3, "verify")
    ].join("\n"));

    expect(report.calls.total).toBe(4);
    expect(report.calls.search).toBe(1);
    expect(report.calls.inspect).toBe(1);
    expect(report.calls.mutate).toBe(1);
    expect(report.calls.verify).toBe(1);
    expect(report.payload.result_bytes).toBe(400);
    expect(report.mcp_images).toMatchObject({
      measured_events:0,unmeasured_events:4,
      delivered_count:null,delivered_bytes:null,png_count:null,png_bytes:null,
    });
    expect(report.latency.total_ms).toBe(40);
    expect(report.latency.p50_ms).toBe(10);
    expect(report.latency.p95_ms).toBe(10);
    expect(report.failures).toEqual({ by_code: {}, unclassified: 0 });
    expect(report.proof_scope).toContain("does not prove accepted-result quality");
  });

  test("computes p50/p95 and distinguishes named failures", () => {
    const rows = [5, 10, 20, 80].map((latency, index) => ({
      ...(JSON.parse(event(index, "mutate")) as Record<string, unknown>),
      latency_ms: latency,
      ...(index === 3 ? { success: false, error_code: "OUTCOME_UNKNOWN" } : {}),
    }));
    const report = summarizeGatewayBenchmarkTrace(rows.map(row => JSON.stringify(row)).join("\n"));
    expect(report.latency).toMatchObject({
      total_ms: 115, max_ms: 80, p50_ms: 10, p95_ms: 80,
    });
    expect(report.failures).toEqual({
      by_code: { OUTCOME_UNKNOWN: 1 },
      unclassified: 0,
    });
  });

  test("aggregates observed image traffic without pretending legacy events were measured", () => {
    const input=[event(0,"mutate"),event(1,"verify")].map((raw,i)=>({
      ...JSON.parse(raw),
      mcp_images:i===0
        ? {delivered_count:0,delivered_bytes:0,png_count:0,png_bytes:0}
        : {delivered_count:2,delivered_bytes:270,png_count:1,png_bytes:230},
    }));
    const report=summarizeGatewayBenchmarkTrace(
      input.map(row=>JSON.stringify(row)).join("\n")
    );
    expect(report.mcp_images).toMatchObject({
      measured_events:2,unmeasured_events:0,
      delivered_count:2,delivered_bytes:270,png_count:1,png_bytes:230,
    });
    const mixed=summarizeGatewayBenchmarkTrace(
      [JSON.stringify(input[0]),event(1,"verify")].join("\n")
    );
    expect(mixed.mcp_images).toMatchObject({
      measured_events:1,unmeasured_events:1,
      delivered_count:null,png_bytes:null,
    });
  });
  test("rejects fabricated or inconsistent image telemetry", () => {
    for (const invalid of [
      {delivered_count:-1,delivered_bytes:10,png_count:0,png_bytes:0},
      {delivered_count:1,delivered_bytes:10,png_count:2,png_bytes:10},
      {delivered_count:1,delivered_bytes:10,png_count:1,png_bytes:11},
      {delivered_count:0,delivered_bytes:1,png_count:0,png_bytes:0},
    ]) {
      expect(()=>summarizeGatewayBenchmarkTrace(JSON.stringify({
        ...JSON.parse(event(0,"mutate")),mcp_images:invalid,
      }))).toThrow("invalid MCP image metrics");
    }
  });

  test("reports correlated spans and queue timing without inventing legacy measurements", () => {
    const first = {
      ...JSON.parse(event(0, "mutate")),
      started_at: "2026-09-29T00:00:00.000Z",
      correlation: {
        trace_id: "a".repeat(32), span_id: "b".repeat(16),
        parent_span_id: null, origin: "GATEWAY_LOCAL",
        task_context_ref: "c".repeat(64), cohort_boundary: "CONTINUE",
      },
      queue_timing: { queue_wait_ms: 4, operation_duration_ms: 9 },
    };
    const second = {
      ...JSON.parse(event(1, "inspect")),
      correlation: {
        trace_id: "a".repeat(32), span_id: "d".repeat(16),
        parent_span_id: "b".repeat(16), origin: "CLIENT_TRACEPARENT",
        task_context_ref: null, cohort_boundary: null,
      },
      queue_timing: null,
    };
    const output = summarizeGatewayBenchmarkTrace(
      [first, second].map((row) => JSON.stringify(row)).join("\n")
    );
    expect(output.correlation).toMatchObject({
      measured_events: 2, trace_count: 1,
      client_parented_events: 1, scoped_context_events: 1,
    });
    expect(output.queue_timing).toMatchObject({
      measured_events: 1, unmeasured_events: 1,
      observed_queue_wait_ms: 4, queue_wait_p95_ms: 4,
      operation_duration_p95_ms: 9,
    });
    expect(summarizeGatewayBenchmarkTrace(event(0, "inspect")).queue_timing)
      .toMatchObject({ measured_events: 0, observed_queue_wait_ms: null });
    expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify({
      ...first, queue_timing: { queue_wait_ms: -1, operation_duration_ms: 9 },
    }))).toThrow("invalid queue timing");
    expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify({
      ...first, correlation: { ...first.correlation, span_id: "bad" },
    }))).toThrow("invalid correlation");
    expect(() => summarizeGatewayBenchmarkTrace(
      [first, { ...second, correlation: first.correlation }]
        .map((row) => JSON.stringify(row)).join("\n")
    )).toThrow("duplicate span IDs");
  });

  test("ranks measured hotspots without claiming tool latency is wall time", () => {
    const rows = [0, 1, 2, 3].map((index) => ({
      ...JSON.parse(event(index, "mutate")),
      capability: index === 3 ? "get_texture" : "manage_cubes",
      latency_ms: index === 3 ? 100 : [20, 30, 40][index],
      result_bytes: index === 1 ? null : 100,
    }));
    const output = summarizeGatewayBenchmarkTrace(rows.map((row) => JSON.stringify(row)).join("\n"));
    expect(output.diagnostics.top_capabilities_by_observed_latency).toEqual([
      {
        capability: "get_texture", calls: 1, failures: 0,
        observed_latency_sum_ms: 100, latency_p95_ms: 100,
        response_bytes: 100,
      },
      {
        capability: "manage_cubes", calls: 3, failures: 0,
        observed_latency_sum_ms: 90, latency_p95_ms: 40,
        response_bytes: null,
      },
    ]);
    expect(output.diagnostics.findings).toEqual([]);
    expect(output.diagnostics.provider_token_usage).toBeNull();
    expect(output.diagnostics.accepted_result).toBe("UNVERIFIED");
  });

  test("keeps findings bounded and investigative, never an automatic waste verdict", () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({
      ...JSON.parse(event(index, "mutate")),
      capability: "manage_cubes",
      success: index < 2 ? false : true,
      error_code: index < 2 ? "OUTCOME_UNKNOWN" : null,
      queue_timing: index < 3
        ? { queue_wait_ms: 25, operation_duration_ms: 5 } : null,
    }));
    const output = summarizeGatewayBenchmarkTrace(rows.map((row) => JSON.stringify(row)).join("\n"));
    expect(output.diagnostics.findings).toEqual([
      {
        code: "REPEATED_ERROR_CODE",
        disposition: "INVESTIGATE_ONLY",
        capability: "manage_cubes", error_code: "OUTCOME_UNKNOWN",
        observed_events: 2, example_sequences: [0, 1],
      },
      {
        code: "QUEUE_WAIT_OUTWEIGHS_OPERATION",
        disposition: "INVESTIGATE_ONLY",
        capability: null, error_code: null,
        observed_events: 3, example_sequences: [0, 1, 2],
      },
    ]);
    const unknown = summarizeGatewayBenchmarkTrace(event(0, "inspect"));
    expect(unknown.diagnostics.findings).toEqual([]);
    expect(unknown.diagnostics.top_capabilities_by_observed_latency[0])
      .toMatchObject({ response_bytes: 100 });
    expect(unknown.diagnostics.interpretation).toContain("not wall time");
  });

  test("rejects private paths masquerading as error codes", () => {
    const row = {
      ...(JSON.parse(event(0, "mutate")) as Record<string, unknown>),
      success: false,
      error_code: "C:/private/path",
    };
    expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify(row))).toThrow("invalid error_code");
  });

  test("rejects non-contiguous sequence", () => {
    expect(() =>
      summarizeGatewayBenchmarkTrace([
        event(0, "search"),
        event(2, "mutate")
      ].join("\n"))
    ).toThrow("sequence must be contiguous");
  });
});