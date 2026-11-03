import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  compareObservabilitySessions,
} from "../../scripts/reporting/compare-observability-sessions";
import type {
  FinalGoldenSessionReport,
} from "../../scripts/reporting/compare-golden-sessions";
import type { UsageDocument, UsageRun } from "../../scripts/evaluate/validate-astra-usage";
import { renderObservabilityHtml } from "../../scripts/reporting/render-observability-report";

const TASK = "golden-full-asset-authoring";
const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);

function golden(sha: string, calls: number): FinalGoldenSessionReport {
  const output = sha === BASE ? "d".repeat(64) : "e".repeat(64);
  return {
    schema: 1,
    report: "golden-session-final",
    task_id: TASK,
    source_sha: sha,
    proof_scope: "LIVE_BLOCKBENCH",
    state: "ACCEPTED",
    quality_verdict: "PASS",
    accepted_result: true,
    pipeline_provenance: {
      input_asset_sha256: "a".repeat(64),
      output_asset_sha256: output,
      input_project_uuid: "disposable-golden-project",
      reference_package_fingerprint: "b".repeat(64),
      control_task_context_id: "task:abcdef1234567890abcd",
      runtime_build_identity: "runtime-" + sha.slice(0, 8),
      artifact_revision: "sha256:" + output,
    },
    metrics: {
      tool_calls_to_accepted_result: calls,
      decision_required_calls: calls,
      search_calls: 0,
      describe_calls: 0,
      inspect_calls: 1,
      mutate_calls: 1,
      verify_calls: 1,
      recovery_calls: 0,
      redundant_readbacks: 0,
      correction_rounds: 1,
      user_corrections: 1,
      wall_time_ms: 1000,
      accepted_result_ms: 900,
      tool_result_bytes: 400,
      total_tokens: null,
    },
    usage: {
      model: "same-reported-model",
      telemetry_source: "explicit-codex-otel-export",
      total_tokens: null,
    },
  };
}

function trace(sha: string, latency: number): string {
  return JSON.stringify({
    schema: "lazydesigner-gateway-benchmark-trace-v1",
    sequence: 0, task_id: TASK, source_sha: sha,
    timestamp: "2026-11-03T12:00:00.000Z",
    kind: "mutate", capability: "manage_cubes",
    success: true, latency_ms: latency, result_bytes: 90,
    read_only: false, verification_class: "visual",
    mcp_images: {
      delivered_count: 0, delivered_bytes: 0,
      png_count: 0, png_bytes: 0,
    },
  }) + "\n";
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

function usageRun(
  variant: UsageRun["variant"],
  gatewayTrace: string,
  totalTokens: number | null
): UsageRun {
  const usage = {
    total_tokens: totalTokens,
    input_tokens: null, cached_input_tokens: null,
    output_tokens: null, reasoning_tokens: null,
  };
  return {
    task_id: TASK, variant,
    quality_verdict: "PASS",
    task_success: true,
    accepted_result: true,
    user_corrections: 1,
    gateway_trace_sha256: sha256(gatewayTrace),
    usage,
    model_events: [{
      kind: "response",
      event_id: variant + "-response-id",
      source: "codex-otel-explicit-export",
      ...usage,
    }],
    calls: {
      total: 1, search: 0, describe: 0,
      inspect: 0, mutate: 1, verify: 0, recovery: 0,
    },
  };
}

function input() {
  const leftTrace = trace(BASE, 100);
  const rightTrace = trace(CANDIDATE, 60);
  const usage: UsageDocument = {
    schema: "lazydesigner-astra-usage-v1",
    proof_scope: "LIVE_BLOCKBENCH",
    source_sha: null, // The two accepted Golden revisions may differ.
    model: "same-reported-model",
    telemetry_source: "explicit-codex-otel-export",
    runs: [
      usageRun("baseline", leftTrace, 1200),
      usageRun("zero_waste", rightTrace, 900),
    ],
  };
  return {
    baseline: { final: golden(BASE, 4), gatewayTrace: leftTrace },
    candidate: { final: golden(CANDIDATE, 2), gatewayTrace: rightTrace },
    usage,
  };
}

describe("correlated offline observability comparison", () => {
  test("renders a standalone non-networked offline report without claiming a full timeline", () => {
    const report = compareObservabilitySessions(input());
    const html = renderObservabilityHtml(report);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("Baseline Gateway timeline");
    expect(html).toContain("Candidate Gateway timeline");
    expect(html).toContain("Start not measured");
    expect(html).toContain("No timed bar");
    expect(html).toContain("Quality-gated comparison");
    expect(html).toContain("Evidence-linked investigation");
    expect(html).toContain("Verified-feedback review");
    expect(html).toContain("REVIEW_CANDIDATE");
    expect(html).toContain("Golden proof");
    expect(html).toContain("submitted provider events");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img");
    expect(report.gateway.inspection.baseline.timeline.observed_window_ms).toBeNull();
    expect(report.gateway.inspection.baseline.timeline.measured_start_events).toBe(0);
  });

  test("positions time bars only using observed start timestamps", () => {
    const data = input();
    const left = JSON.parse(data.baseline.gatewayTrace);
    left.started_at = "2026-11-03T11:59:59.900Z";
    data.baseline.gatewayTrace = JSON.stringify(left) + "\n";
    data.usage.runs[0]!.gateway_trace_sha256 = sha256(data.baseline.gatewayTrace);
    const report = compareObservabilitySessions(data);
    const timeline = report.gateway.inspection.baseline.timeline;
    expect(timeline.total_events).toBe(1);
    expect(timeline.measured_start_events).toBe(1);
    expect(timeline.observed_window_ms).toBe(100);
    expect(timeline.events[0]).toMatchObject({
      sequence: 0, offset_ms: 0, latency_ms: 100,
    });
    const html = renderObservabilityHtml(report);
    expect(html).toContain("Observed first-start to last-recorded-end span");
    expect(html).toContain('style="left:0.000%;width:100.000%"');
    expect(html).toContain("Incomplete start timestamps");
  });

  test("never executes untrusted task labels or capability metadata as HTML", () => {
    const report = compareObservabilitySessions(input());
    report.task_id = '<img src=x onerror="alert(1)">';
    report.gateway.inspection.baseline.timeline.events[0]!.capability =
      '<script>alert("evil")</script>';
    report.gateway.inspection.baseline.hotspots[0]!.capability =
      '<a onclick="attack()">bad</a>';
    const html = renderObservabilityHtml(report);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<a onclick');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;evil&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;a onclick=&quot;attack()&quot;&gt;bad&lt;/a&gt;");
  });

  test("caps visible events while preserving the source event sequences", () => {
    const data = input();
    const events = Array.from({ length: 86 }, (_, index) => ({
      ...JSON.parse(trace(BASE, 4)),
      sequence: index,
      started_at: new Date(Date.parse("2026-11-03T00:00:00.000Z") + index * 10).toISOString(),
      latency_ms: 4,
    }));
    data.baseline.gatewayTrace = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    data.usage.runs[0]!.gateway_trace_sha256 = sha256(data.baseline.gatewayTrace);
    const report = compareObservabilitySessions(data);
    const timeline = report.gateway.inspection.baseline.timeline;
    expect(timeline).toMatchObject({
      total_events: 86,
      measured_start_events: 86,
      omitted_events: 26,
      observed_window_ms: 854,
    });
    expect(timeline.events).toHaveLength(60);
    expect(timeline.events[0]!.sequence).toBe(0);
    expect(timeline.events[29]!.sequence).toBe(29);
    expect(timeline.events[30]!.sequence).toBe(56);
    expect(timeline.events[59]!.sequence).toBe(85);
    const html = renderObservabilityHtml(report);
    expect(html).toContain("26 intermediate events omitted");
    expect(html).toContain('id="baseline-event-85"');
    expect(html).not.toContain('id="baseline-event-41"');
  });

  test("reports source-provided token reduction only with exact trace and Golden evidence", () => {
    const report = compareObservabilitySessions(input());
    expect(report.quality_gate).toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
    expect(report.decision).toBe("MEASURED_TOKEN_REDUCTION");
    expect(report.provider.token_claim_available).toBe(true);
    expect(report.feedback).toMatchObject({
      scope: "OFFLINE_VERIFICATION_AND_REVIEW_ONLY",
      disposition: "REVIEW_CANDIDATE",
      never_auto_promote: true,
    });
    expect(report.feedback.evidence_gaps).toContain("BASELINE_TIMELINE_START_PARTIAL");
    expect(report.feedback.evidence_gaps).toContain("CANDIDATE_QUEUE_DETAIL_PARTIAL");
    expect(report.provider.total_tokens).toEqual({
      baseline: 1200, candidate: 900, delta_candidate_minus_baseline: -300,
    });
    expect(report.gateway.exact_file_binding).toEqual({
      baseline: true, candidate: true,
    });
    expect(report.gateway.calls).toEqual({
      baseline: 1, candidate: 1, delta_candidate_minus_baseline: 0,
    });
    expect(report.gateway.latency_sum_ms.delta_candidate_minus_baseline).toBe(-40);
    expect(report.gateway.queue_wait_ms).toEqual({
      baseline: null, candidate: null, delta_candidate_minus_baseline: null,
    });
    expect(report.limitations).toContain("does not authenticate Codex-exported records");
    expect(report).not.toHaveProperty("winner");
    expect(report).not.toHaveProperty("estimated_api_cost");
  });

  test("missing trace SHA or provider event coverage never becomes a measured claim", () => {
    const withoutBinding = input();
    withoutBinding.usage.runs[0]!.gateway_trace_sha256 = null;
    const unbound = compareObservabilitySessions(withoutBinding);
    expect(unbound.provider.token_claim_available).toBe(false);
    expect(unbound.provider.total_tokens.baseline).toBeNull();
    expect(unbound.decision).toBe("INSUFFICIENT_LINKED_USAGE_EVIDENCE");
    expect(unbound.feedback.disposition).toBe("HOLD_OR_NO_EFFICIENCY_GAIN");
    expect(unbound.feedback.recommended_checks).toContain(
      "VERIFY_EXPLICIT_PROVIDER_EXPORT_AND_EXACT_TRACE_BINDINGS");

    const unknown = input();
    unknown.usage.runs[1]!.usage.total_tokens = null;
    unknown.usage.runs[1]!.model_events![0]!.total_tokens = null;
    const missing = compareObservabilitySessions(unknown);
    expect(missing.provider.complete_response_events.candidate).toBe(false);
    expect(missing.provider.token_claim_available).toBe(false);

    const oldStyle = input();
    oldStyle.usage.runs[0]!.model_events = [];
    expect(compareObservabilitySessions(oldStyle).provider.token_claim_available).toBe(false);
  });

  test("wrong trace fingerprints, reused traces and altered source identities are rejected", () => {
    const mismatch = input();
    mismatch.usage.runs[1]!.gateway_trace_sha256 = "a".repeat(64);
    expect(() => compareObservabilitySessions(mismatch)).toThrow("exact NDJSON");

    const wrongSource = input();
    wrongSource.candidate.gatewayTrace = trace(BASE, 60);
    expect(() => compareObservabilitySessions(wrongSource)).toThrow("Golden task_id and source SHA");

    const sameSource = input();
    sameSource.candidate.final.source_sha = BASE;
    sameSource.candidate.gatewayTrace = sameSource.baseline.gatewayTrace;
    sameSource.usage.runs[1]!.gateway_trace_sha256 = sha256(sameSource.candidate.gatewayTrace);
    expect(() => compareObservabilitySessions(sameSource)).toThrow("same Gateway trace bytes");
  });

  test("a correction regression blocks savings even when tokens decline", () => {
    const data = input();
    data.usage.runs[1]!.user_corrections = 2;
    data.candidate.final.metrics!.user_corrections = 2;
    const report = compareObservabilitySessions(data);
    expect(report.decision).toBe("CORRECTION_REGRESSION");
    expect(report.feedback.disposition).toBe("REJECT_CANDIDATE");
    expect(report.feedback.recommended_checks).toContain(
      "REVIEW_CORRECTIONS_BEFORE_ANY_PROMOTION");
    expect(report.provider.token_claim_available).toBe(false);
    expect(report.provider.total_tokens.candidate).toBeNull();
  });

  test("rejects contradictory acceptance, provenance, model and source telemetry", () => {
    const badAcceptance = input();
    badAcceptance.usage.runs[1]!.accepted_result = false;
    expect(() => compareObservabilitySessions(badAcceptance)).toThrow("contradicts accepted Golden");

    const badGolden = input();
    badGolden.candidate.final.pipeline_provenance.input_asset_sha256 = "f".repeat(64);
    expect(() => compareObservabilitySessions(badGolden)).toThrow("same valid input_asset_sha256");

    const badModel = input();
    badModel.usage.model = "different-model";
    expect(() => compareObservabilitySessions(badModel)).toThrow("Golden model conflicts");

    const badSource = input();
    badSource.usage.source_sha = BASE;
    expect(() => compareObservabilitySessions(badSource)).toThrow("or be null for a cross-SHA");

    const badCorrections = input();
    badCorrections.usage.runs[0]!.user_corrections = 99;
    expect(() => compareObservabilitySessions(badCorrections)).toThrow("correction counts disagree");
  });

  test("declines token claims if client model identity or event provenance is missing", () => {
    const missingModel = input();
    missingModel.usage.model = null;
    const result = compareObservabilitySessions(missingModel);
    expect(result.provider.token_claim_available).toBe(false);

    const missingEventId = input();
    delete missingEventId.usage.runs[0]!.model_events![0]!.event_id;
    expect(compareObservabilitySessions(missingEventId).provider.token_claim_available).toBe(false);

    const missingSource = input();
    delete missingSource.usage.runs[0]!.model_events![0]!.source;
    expect(compareObservabilitySessions(missingSource).provider.token_claim_available).toBe(false);
  });
});
