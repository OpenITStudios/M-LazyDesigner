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

/** Synthetic metadata only: these are not native Runtime receipts. */
function correlatedError(
  sequence: number,
  traceDigit: string,
  contextDigit: string | null
) {
  return {
    ...JSON.parse(event(sequence, "mutate")),
    success: false,
    error_code: "OUTCOME_UNKNOWN",
    correlation: {
      trace_id: traceDigit.repeat(32),
      span_id: (sequence + 1).toString(16).padStart(16, "0"),
      parent_span_id: null,
      origin: "GATEWAY_LOCAL",
      task_context_ref: contextDigit === null ? null : contextDigit.repeat(64),
      cohort_boundary: null,
    },
  };
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

  test("separates same-code errors across Control task contexts even under one trace", () => {
    const separateContexts = [
      correlatedError(0, "a", "1"),
      correlatedError(1, "a", "2"),
    ];
    const unrelated = summarizeGatewayBenchmarkTrace(
      separateContexts.map(row => JSON.stringify(row)).join("\n")
    );
    expect(unrelated.failures.by_code).toEqual({ OUTCOME_UNKNOWN: 2 });
    expect(unrelated.diagnostics.findings).toEqual([]);

    // Different W3C traces may still belong to the same Control task.
    // Partition by the existing task-context digest before trace identity.
    const matchedContext = summarizeGatewayBenchmarkTrace([
      ...separateContexts,
      correlatedError(2, "b", "1"),
    ].map(row => JSON.stringify(row)).join("\n"));
    expect(matchedContext.failures.by_code).toEqual({ OUTCOME_UNKNOWN: 3 });
    expect(matchedContext.diagnostics.findings).toEqual([{
      code: "REPEATED_ERROR_CODE",
      disposition: "INVESTIGATE_ONLY",
      capability: "manage_cubes",
      error_code: "OUTCOME_UNKNOWN",
      grouping_basis: "TASK_CONTEXT_HASH",
      observed_events: 2,
      example_sequences: [0, 2],
    }]);
    expect(matchedContext.diagnostics.interpretation)
      .toContain("do not prove a common root cause");
  });

  test("does not merge trace-only, task-scoped and legacy-unscoped error groups", () => {
    const independentTraces = [
      correlatedError(0, "a", null),
      correlatedError(1, "b", null),
    ];
    const separate = summarizeGatewayBenchmarkTrace(
      independentTraces.map(row => JSON.stringify(row)).join("\n")
    );
    expect(separate.diagnostics.findings).toEqual([]);

    const repeatedTrace = summarizeGatewayBenchmarkTrace([
      ...independentTraces,
      correlatedError(2, "a", null),
    ].map(row => JSON.stringify(row)).join("\n"));
    expect(repeatedTrace.diagnostics.findings).toEqual([{
      code: "REPEATED_ERROR_CODE",
      disposition: "INVESTIGATE_ONLY",
      capability: "manage_cubes",
      error_code: "OUTCOME_UNKNOWN",
      grouping_basis: "TRACE_ID",
      observed_events: 2,
      example_sequences: [0, 2],
    }]);

    const legacy = {
      ...JSON.parse(event(0, "mutate")),
      success: false,
      error_code: "OUTCOME_UNKNOWN",
    };
    const unscopedAndCorrelated = summarizeGatewayBenchmarkTrace([
      legacy, correlatedError(1, "a", null),
    ].map(row => JSON.stringify(row)).join("\n"));
    expect(unscopedAndCorrelated.diagnostics.findings).toEqual([]);

    // Backward-compatible exploratory legacy grouping retains the old
    // result shape, without inventing a task or a trace identifier.
    const historical = summarizeGatewayBenchmarkTrace([
      legacy, { ...legacy, sequence: 1 },
    ].map(row => JSON.stringify(row)).join("\n"));
    expect(historical.diagnostics.findings).toEqual([{
      code: "REPEATED_ERROR_CODE",
      disposition: "INVESTIGATE_ONLY",
      capability: "manage_cubes",
      error_code: "OUTCOME_UNKNOWN",
      observed_events: 2,
      example_sequences: [0, 1],
    }]);

    // Same trace is insufficient when one event has an explicit task
    // context and the other does not.
    const partiallyScoped = summarizeGatewayBenchmarkTrace([
      correlatedError(0, "a", "1"),
      correlatedError(1, "a", null),
    ].map(row => JSON.stringify(row)).join("\n"));
    expect(partiallyScoped.diagnostics.findings).toEqual([]);
  });

  test("classifies failures only to the extent supported by recorded error codes", () => {
    // These are known code identities, not native receipt or root-cause data.
    const codes: Array<string | null> = [
      "OUTCOME_UNKNOWN",
      "BACKEND_CALL_INTERRUPTED",
      "PROJECT_CONTEXT_LOST",
      "CAPABILITY_PRECONDITION_BLOCKED",
      "CAPABILITY_NOT_FOUND",
      "GATEWAY_BUSY",
      "GATEWAY_QUEUE_EXPIRED",
      "GATEWAY_QUEUE_CANCELLED",
      "REFERENCE_AMBIGUOUS",
      "BACKEND_UNAVAILABLE",
      "GATEWAY_ERROR",
      "UNREGISTERED_NATIVE_CODE",
      null,
    ];
    const rows = codes.map((code, index) => ({
      ...JSON.parse(event(index, "mutate")),
      success: false,
      error_code: code,
    }));
    const report = summarizeGatewayBenchmarkTrace(
      rows.map(row => JSON.stringify(row)).join("\n")
    );
    expect(report.calls.failed).toBe(codes.length);
    expect(report.failures.unclassified).toBe(1);
    expect(report.failures.by_code.BACKEND_UNAVAILABLE).toBe(1);
    expect(report.diagnostics.failure_evidence).toEqual({
      scope: "RECORDED_ERROR_CODES_ONLY_NO_NATIVE_RECEIPT_DETAILS",
      by_class: {
        NATIVE_OUTCOME_UNCERTAIN: 1,
        READ_TRANSPORT_INTERRUPTED: 1,
        PROJECT_AFFINITY_LOST: 1,
        CAPABILITY_PRECONDITION_BLOCKED: 1,
        CAPABILITY_NOT_FOUND: 1,
        QUEUE_PRE_EXECUTION: 3,
        REFERENCE_CONSTRAINT: 1,
        BACKEND_UNAVAILABLE_AMBIGUOUS: 1,
        OTHER_UNCLASSIFIED: 3,
      },
      ambiguous_or_unclassified_events: 4,
      interpretation: expect.stringContaining(
        "trace data cannot distinguish them"
      ),
    });
    expect(report.diagnostics.failure_evidence.interpretation)
      .toContain("No retry permission");
    expect(report.diagnostics.accepted_result).toBe("UNVERIFIED");
  });

  test("does not classify contradictory success and error-code trace rows", () => {
    const succeeded = {
      ...JSON.parse(event(0, "mutate")),
      success: true,
      error_code: "OUTCOME_UNKNOWN",
    };
    expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify(succeeded)))
      .toThrow("error_code on a successful event");

    const valid = { ...succeeded, error_code: null };
    const report = summarizeGatewayBenchmarkTrace(JSON.stringify(valid));
    expect(report.calls.failed).toBe(0);
    expect(report.diagnostics.failure_evidence.by_class).toEqual({});
    expect(report.diagnostics.failure_evidence.ambiguous_or_unclassified_events)
      .toBe(0);

    // Unnamed failed errors remain unknown rather than being assigned a
    // guessed Runtime cause, even on a familiar capability.
    const unnamed = {
      ...succeeded, success: false, error_code: null,
    };
    const unresolved = summarizeGatewayBenchmarkTrace(JSON.stringify(unnamed));
    expect(unresolved.diagnostics.failure_evidence.by_class)
      .toEqual({ OTHER_UNCLASSIFIED: 1 });
  });

  test("rejects private paths masquerading as error codes", () => {
    const row = {
      ...(JSON.parse(event(0, "mutate")) as Record<string, unknown>),
      success: false,
      error_code: "C:/private/path",
    };
    expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify(row))).toThrow("invalid error_code");
  });

  test("rejects malformed core trace byte and kind measurements", () => {
    const base = JSON.parse(event(0, "mutate")) as Record<string, unknown>;
    for (const invalid of [
      -1, 1.5, "100", undefined, Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify({
        ...base, result_bytes: invalid,
      }))).toThrow("invalid result_bytes");
    }
    for (const kind of ["unknown", null, 123]) {
      expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify({
        ...base, kind,
      }))).toThrow("invalid kind");
    }
    for (const timestamp of [null, "not-a-date", undefined]) {
      expect(() => summarizeGatewayBenchmarkTrace(JSON.stringify({
        ...base, timestamp,
      }))).toThrow("invalid timestamp");
    }
  });

  test("retains nullable legacy bytes and refuses unsafe aggregated precision", () => {
    const first = {
      ...JSON.parse(event(0, "mutate")),
      result_bytes: null,
    };
    const second = {
      ...JSON.parse(event(1, "mutate")),
      result_bytes: 100,
    };
    const partial = summarizeGatewayBenchmarkTrace(
      [first, second].map(row => JSON.stringify(row)).join("\n")
    );
    expect(partial.payload.result_bytes).toBeNull();
    expect(partial.diagnostics.top_capabilities_by_observed_latency[0]
      ?.response_bytes).toBeNull();

    // Individual events may carry safe integers, while their sum is no
    // longer exactly representable. Never show that total as measured.
    const overflow = [0, 1].map(index => ({
      ...JSON.parse(event(index, "mutate")),
      result_bytes: Number.MAX_SAFE_INTEGER,
    }));
    const report = summarizeGatewayBenchmarkTrace(
      overflow.map(row => JSON.stringify(row)).join("\n")
    );
    expect(report.payload.result_bytes).toBeNull();
    expect(report.diagnostics.top_capabilities_by_observed_latency[0]
      ?.response_bytes).toBeNull();
    expect(report.calls.total).toBe(2);
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