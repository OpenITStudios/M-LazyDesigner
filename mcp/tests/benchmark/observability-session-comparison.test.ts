import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  compareObservabilitySessions,
} from "../../scripts/reporting/compare-observability-sessions";
import type {
  FinalGoldenSessionReport,
} from "../../scripts/reporting/compare-golden-sessions";
import type { UsageDocument, UsageRun } from "../../scripts/evaluate/validate-astra-usage";

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
  test("reports source-provided token reduction only with exact trace and Golden evidence", () => {
    const report = compareObservabilitySessions(input());
    expect(report.quality_gate).toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
    expect(report.decision).toBe("MEASURED_TOKEN_REDUCTION");
    expect(report.provider.token_claim_available).toBe(true);
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
