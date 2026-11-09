import { createHash } from "node:crypto";
import {
  evaluateHarnessProbe,
  verifyHarnessContextBytes,
  requireHarnessContextBytes,
  type HarnessProbeInput,
} from "../../scripts/evaluate/evaluate-harness-candidate";
import { describe, expect, test } from "bun:test";
import {
  compareAcceptedGoldenSessions,
  type FinalGoldenSessionReport,
} from "../../scripts/reporting/compare-golden-sessions";
import {
  compareGeometryKnowledgeGoldenPair,
  type GeometryKnowledgePairInput,
  type GeometryKnowledgeExposure,
} from "../../scripts/reporting/compare-geometry-knowledge";
import casebook from "../../../docs/03-authoring/modelling/decision-cases.md" with { type: "text" };
import goldenCorpus from "../fixtures/golden-task-cases.json";
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
} from "../../lib/semantic/knowledge";

function accepted(sha: string, calls: number): FinalGoldenSessionReport {
  return {
    schema: 1,
    report: "golden-session-final",
    task_id: "golden-full-asset-authoring",
    source_sha: sha,
    proof_scope: "LIVE_BLOCKBENCH",
    state: "ACCEPTED",
    quality_verdict: "PASS",
    accepted_result: true,
    pipeline_provenance: {
      input_asset_sha256: "a".repeat(64),
      output_asset_sha256: "c".repeat(64),
      input_project_uuid: "benchmark-project-active",
      reference_package_fingerprint: "b".repeat(64),
      control_task_context_id: "task:abcdef1234567890abcd",
      runtime_build_identity: "runtime-" + sha.slice(0, 8),
      artifact_revision: "sha256:" + "c".repeat(64),
    },
    metrics: {
      tool_calls_to_accepted_result: calls,
      decision_required_calls: calls - 1,
      // Synthetic accepted runs have exactly 'calls' events across kinds,
      // not an invented total disconnected from the per-tool breakdown.
      search_calls: calls - 3,
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
      tool_result_bytes: 4000,
      total_tokens: 5000,
    },
  };
}

describe("accepted golden session comparison", () => {
  test("reports per-metric deltas without aggregate scoring", () => {
    const report = compareAcceptedGoldenSessions({
      baseline: accepted(
        "1234567890abcdef1234567890abcdef12345678",
        5
      ),
      candidate: accepted(
        "abcdef1234567890abcdef1234567890abcdef12",
        3
      ),
    });

    expect(report.quality_gate).toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
    expect(
      report.metrics.tool_calls_to_accepted_result
        .delta_candidate_minus_baseline
    ).toBe(-2);
    expect(report).not.toHaveProperty("score");
    expect(report).not.toHaveProperty("winner");
  });

  test("direct accepted comparison refuses identical recorded Gateway sessions", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.gateway_session_id = "a".repeat(32);
    candidate.gateway_session_id = "a".repeat(32);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("cannot reuse the same Gateway recorder session");

    candidate.gateway_session_id = "b".repeat(32);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .not.toThrow();

    candidate.gateway_session_id = "NOT-A-RECORDER-NONCE";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("invalid Gateway recorder session ID");

    // Historical final reports lacking this opt-in field still permit
    // a non-causal, per-metric comparison without claimed run attestation.
    baseline.gateway_session_id = undefined;
    candidate.gateway_session_id = undefined;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .not.toThrow();
  });

  test("accepted comparison rejects artifact_revision not matching the saved output digest", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    candidate.pipeline_provenance.artifact_revision = "free-text-revision";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("artifact_revision matching the saved output_asset_sha256");
    candidate.pipeline_provenance.artifact_revision = "sha256:" + "c".repeat(64);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate })).not.toThrow();
  });

  test("rejects golden metrics conflicting with supplied model usage", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    candidate.usage = { model: "gpt-6.1-sol", total_tokens: 300 };
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("golden metrics total_tokens conflicts");
    candidate.usage.total_tokens = 5000;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate })).not.toThrow();
  });

  test("rejects comparisons that changed the reference authority", () => {
    const baseline = accepted(
      "1234567890abcdef1234567890abcdef12345678",
      5
    );
    const candidate = accepted(
      "abcdef1234567890abcdef1234567890abcdef12",
      3
    );
    candidate.pipeline_provenance.reference_package_fingerprint = "c".repeat(64);
    expect(() =>
      compareAcceptedGoldenSessions({ baseline, candidate })
    ).toThrow("same reference package fingerprint");
  });


  test("refuses source-only or missing-proof comparisons even with matching PASS labels", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.proof_scope = "LOCAL_CODE";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("requires LIVE_BLOCKBENCH proof");
    baseline.proof_scope = undefined;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("requires LIVE_BLOCKBENCH proof");
    baseline.proof_scope = "LIVE_BLOCKBENCH";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate })
      .quality_gate).toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
  });

  test("every Golden Task comparison requires saved output digests on both sides", () => {
    for (const task of goldenCorpus.tasks.map(entry => entry.id)) {
      const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
      const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
      baseline.task_id = task;
      candidate.task_id = task;
      baseline.pipeline_provenance.output_asset_sha256 = null;
      expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
        .toThrow("requires a valid changed output_asset_sha256");
      baseline.pipeline_provenance.output_asset_sha256 = "c".repeat(64);
      candidate.pipeline_provenance.output_asset_sha256 = "a".repeat(64);
      expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
        .toThrow("requires a valid changed output_asset_sha256");
      candidate.pipeline_provenance.output_asset_sha256 = "d".repeat(64);
      candidate.pipeline_provenance.artifact_revision = "sha256:" + "d".repeat(64);
      expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
        .not.toThrow();
    }
  });

  test("refuses a missing live project provenance on either comparison side", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    candidate.pipeline_provenance.input_project_uuid = null;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("requires a live input_project_uuid");
  });

  test("rejects comparisons starting from a different or unknown model", () => {
    const baseline = accepted(
      "1234567890abcdef1234567890abcdef12345678", 5
    );
    const candidate = accepted(
      "abcdef1234567890abcdef1234567890abcdef12", 3
    );
    candidate.pipeline_provenance.input_asset_sha256 = "d".repeat(64);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("same valid input_asset_sha256");
    candidate.pipeline_provenance.input_asset_sha256 = null;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("same valid input_asset_sha256");
    candidate.pipeline_provenance.input_asset_sha256 = baseline.pipeline_provenance.input_asset_sha256;
    expect(compareAcceptedGoldenSessions({ baseline, candidate }).quality_gate)
      .toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
  });

  test("comparison rejects absent or input-identical correction output", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.pipeline_provenance.output_asset_sha256 = null;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("baseline accepted Golden comparison requires a valid changed output_asset_sha256");
    baseline.pipeline_provenance.output_asset_sha256 = "c".repeat(64);
    candidate.pipeline_provenance.output_asset_sha256 = "a".repeat(64);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("candidate accepted Golden comparison requires a valid changed output_asset_sha256");
    candidate.pipeline_provenance.output_asset_sha256 = "d".repeat(64);
    candidate.pipeline_provenance.artifact_revision = "sha256:" + "d".repeat(64);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate })).not.toThrow();
  });

  test("rejects incomplete or cross-task comparisons", () => {
    const incomplete = accepted(
      "1234567890abcdef1234567890abcdef12345678",
      5
    );
    incomplete.state = "INCOMPLETE";

    expect(() =>
      compareAcceptedGoldenSessions({
        baseline: incomplete,
        candidate: accepted(
          "abcdef1234567890abcdef1234567890abcdef12",
          3
        ),
      })
    ).toThrow("ACCEPTED");

    const otherTask = accepted(
      "abcdef1234567890abcdef1234567890abcdef12",
      3
    );
    otherTask.task_id = "golden-retired-case";

    expect(() =>
      compareAcceptedGoldenSessions({
        baseline: accepted(
          "1234567890abcdef1234567890abcdef12345678",
          5
        ),
        candidate: otherTask,
      })
    ).toThrow("requires a known canonical Golden task ID");
  });
  test("requires identical starting asset bytes for modern Golden Tasks too", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.task_id = candidate.task_id = "golden-full-asset-authoring";
    candidate.pipeline_provenance.input_asset_sha256 = "d".repeat(64);
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("same valid input_asset_sha256");
    candidate.pipeline_provenance.input_asset_sha256 = null;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("same valid input_asset_sha256");
    candidate.pipeline_provenance.input_asset_sha256 = baseline.pipeline_provenance.input_asset_sha256;
    expect(compareAcceptedGoldenSessions({ baseline, candidate }).input_asset_comparable).toBe(true);
  });


  test("rejects arbitrary synthetic IDs rather than comparing them as canonical Golden Tasks", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.task_id = "A_known_transform";
    candidate.task_id = "A_known_transform";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("requires a known canonical Golden task ID");
  });

  test("rejects invalid or negative efficiency inputs instead of reporting a fictitious improvement", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    candidate.metrics!.tool_calls_to_accepted_result = -4;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("invalid tool_calls_to_accepted_result metric");
    candidate.metrics!.tool_calls_to_accepted_result = Number.NaN;
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("invalid tool_calls_to_accepted_result metric");
  });

  test("rejects tampered accepted call totals even when both reports claim PASS", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    const unchanged = compareAcceptedGoldenSessions({ baseline, candidate });
    expect(unchanged.metrics.tool_calls_to_accepted_result
      .delta_candidate_minus_baseline).toBe(-2);

    const phantomSavings = structuredClone(candidate);
    phantomSavings.metrics!.tool_calls_to_accepted_result = 2;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: phantomSavings,
    })).toThrow("call metrics do not reconcile");

    const fabricatedBreakdown = structuredClone(candidate);
    fabricatedBreakdown.metrics!.search_calls = 5;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: fabricatedBreakdown,
    })).toThrow("call metrics do not reconcile");

    const missingBreakdown = structuredClone(candidate);
    missingBreakdown.metrics!.verify_calls = null;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: missingBreakdown,
    })).toThrow("requires complete non-negative integer call metrics");
  });

  test("rejects contradictory decision/readback and timing claims in accepted reports", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);

    for (const invalid of [
      { key: "decision_required_calls" as const, value: 4 },
      { key: "redundant_readbacks" as const, value: 2 },
      { key: "mutate_calls" as const, value: 0 },
      { key: "verify_calls" as const, value: 0 },
    ]) {
      const row = structuredClone(candidate);
      row.metrics![invalid.key] = invalid.value;
      expect(() => compareAcceptedGoldenSessions({
        baseline, candidate: row,
      })).toThrow("call metrics do not reconcile");
    }

    const fractional = structuredClone(candidate);
    fractional.metrics!.inspect_calls = 0.5;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: fractional,
    })).toThrow("requires complete non-negative integer call metrics");

    const impossibleTime = structuredClone(candidate);
    impossibleTime.metrics!.accepted_result_ms = 1100;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: impossibleTime,
    })).toThrow("accepted_result_ms exceeds wall_time_ms");

    // Unknown wall time does not authorize a fabricated zero.
    const unmeasured = structuredClone(candidate);
    unmeasured.metrics!.wall_time_ms = null;
    expect(() => compareAcceptedGoldenSessions({
      baseline, candidate: unmeasured,
    })).not.toThrow();
  });

  test("comparison refuses malformed reference and Control provenance hashes", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    candidate.pipeline_provenance.reference_package_fingerprint = "not-a-sha";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("complete end-to-end pipeline provenance");
    candidate.pipeline_provenance.reference_package_fingerprint = "b".repeat(64);
    candidate.pipeline_provenance.control_task_context_id = "task:not-hex";
    expect(() => compareAcceptedGoldenSessions({ baseline, candidate }))
      .toThrow("complete end-to-end pipeline provenance");
  });

  test("reports Astra/Sol provenance without inventing cost or model identity", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.usage = { model: "gpt-6-astra", telemetry_source: "codex", total_tokens: 5000 };
    candidate.usage = { model: "gpt-6.1-sol", telemetry_source: "codex", total_tokens: 5000 };
    const crossModel = compareAcceptedGoldenSessions({ baseline, candidate });
    expect(crossModel.model_pair).toEqual({
      baseline: "gpt-6-astra", candidate: "gpt-6.1-sol", state: "CROSS_MODEL",
    });
    expect(crossModel.api_cost_comparison).toBe("NOT_MEASURED");
    expect(crossModel.rule).toContain("not API pricing");
    candidate.usage.model = null;
    expect(compareAcceptedGoldenSessions({ baseline, candidate }).model_pair.state).toBe("UNVERIFIED");
  });

});



describe("Harness² candidate evidence gate (authored contracts)", () => {
  const SHA = "1234567890abcdef1234567890abcdef12345678";
  function probe(): HarnessProbeInput {
    const baseline = accepted(SHA, 5);
    const candidate = accepted(SHA, 3);
    baseline.gateway_session_id = "a".repeat(32);
    candidate.gateway_session_id = "b".repeat(32);
    baseline.usage = { model: "same-model", telemetry_source: "observed", total_tokens: 5000 };
    candidate.usage = { model: "same-model", telemetry_source: "observed", total_tokens: 5000 };
    return {
      schema: 1, proposal_id: "geometry-context-01", domain: "GEOMETRY",
      baseline_harness_sha256: "1".repeat(64),
      candidate_harness_sha256: "2".repeat(64),
      session_pair: {
        baseline_session_id: "a".repeat(32),
        candidate_session_id: "b".repeat(32),
      },
      baseline, candidate,
    };
  }

  test("accepted same-input probe is review-only with existing per-metric deltas", () => {
    const assessed = evaluateHarnessProbe(probe());
    expect(assessed.status).toBe("REVIEW_REQUIRED");
    expect(assessed.comparison?.quality_gate).toBe("BOTH_ACCEPTED_PASS_SAME_REFERENCE");
    expect(assessed.comparison?.metrics.tool_calls_to_accepted_result
      .delta_candidate_minus_baseline).toBe(-2);
    expect(assessed).not.toHaveProperty("score");
    expect(assessed).not.toHaveProperty("winner");
    expect(assessed).not.toHaveProperty("promoted");
    expect(assessed.evidence).toBe("SUPPLIED_GOLDEN_REPORTS_NOT_INDEPENDENTLY_CORRELATED");
  });

  test("live quality FAIL vetoes cheaper candidate without comparing partial cost", () => {
    const input = probe();
    input.candidate.quality_verdict = "FAIL";
    input.candidate.state = "INCOMPLETE";
    input.candidate.accepted_result = false;
    input.candidate.metrics = null;
    const assessed = evaluateHarnessProbe(input);
    expect(assessed.status).toBe("REJECTED_QUALITY");
    expect(assessed.reasons).toContain("CANDIDATE_QUALITY_FAIL");
    expect(assessed.comparison).toBeNull();
  });

  test("unverified candidate, even with fewer calls, remains inconclusive", () => {
    const input = probe();
    input.candidate.quality_verdict = "UNVERIFIED";
    input.candidate.state = "INCOMPLETE";
    input.candidate.accepted_result = null;
    expect(evaluateHarnessProbe(input).status).toBe("INCONCLUSIVE");
    input.candidate.proof_scope = "LOCAL_CODE";
    expect(evaluateHarnessProbe(input).reasons).toContain("NATIVE_PROOF_MISSING");
  });

  test("mismatched task, source, reference, starting bytes and runtime invalidate the pair", () => {
    const corruptions: Array<[string, (value: HarnessProbeInput) => void]> = [
      ["TASK_MISMATCH", v => { v.candidate.task_id = "unrelated-task"; }],
      ["SOURCE_SHA_MISMATCH", v => { v.candidate.source_sha = "a".repeat(40); }],
      ["REFERENCE_MISMATCH", v => {
        v.candidate.pipeline_provenance.reference_package_fingerprint = "d".repeat(64);
      }],
      ["START_ASSET_MISMATCH", v => {
        v.candidate.pipeline_provenance.input_asset_sha256 = "d".repeat(64);
      }],
      ["RUNTIME_MISMATCH", v => {
        v.candidate.pipeline_provenance.runtime_build_identity = "different-runtime";
      }],
    ];
    for (const [reason, corrupt] of corruptions) {
      const input = probe();
      corrupt(input);
      const assessed = evaluateHarnessProbe(input);
      expect(assessed.status).toBe("INCONCLUSIVE");
      expect(assessed.reasons).toContain(reason);
      expect(assessed.comparison).toBeNull();
    }
  });

  test("session reuse and missing independent run identifiers are inconclusive", () => {
    const input = probe();
    expect(evaluateHarnessProbe(input).status).toBe("REVIEW_REQUIRED");

    // Repeating the same result under two labels is not a paired native run.
    input.session_pair!.candidate_session_id =
      input.session_pair!.baseline_session_id;
    const same = evaluateHarnessProbe(input);
    expect(same.status).toBe("INCONCLUSIVE");
    expect(same.reasons).toContain("SESSION_REUSE_SUSPECTED");
    expect(same.comparison).toBeNull();

    input.session_pair = undefined;
    const unknown = evaluateHarnessProbe(input);
    expect(unknown.status).toBe("INCONCLUSIVE");
    expect(unknown.reasons).toContain("SESSION_IDENTITIES_MISSING");

    input.session_pair = {
      baseline_session_id: "a".repeat(32),
      candidate_session_id: "../unsafe-path",
    };
    expect(evaluateHarnessProbe(input).reasons)
      .toContain("SESSION_IDENTITIES_MISSING");

    input.session_pair.candidate_session_id = "b".repeat(32);
    expect(evaluateHarnessProbe(input).status).toBe("REVIEW_REQUIRED");

    input.candidate.state = "INCOMPLETE";
    input.candidate.quality_verdict = "FAIL";
    input.candidate.accepted_result = false;
    input.candidate.metrics = null;
    expect(evaluateHarnessProbe(input).status).toBe("REJECTED_QUALITY");
    input.session_pair = undefined;
    expect(evaluateHarnessProbe(input).status).toBe("INCONCLUSIVE");
  });

  test("requires declared sessions to match recorder-derived Golden IDs", () => {
    const good = probe();
    expect(evaluateHarnessProbe(good).status).toBe("REVIEW_REQUIRED");

    const swapped = probe();
    swapped.session_pair!.baseline_session_id = "b".repeat(32);
    swapped.session_pair!.candidate_session_id = "a".repeat(32);
    const mismatch = evaluateHarnessProbe(swapped);
    expect(mismatch.status).toBe("INCONCLUSIVE");
    expect(mismatch.reasons).toContain("RECORDED_GATEWAY_SESSION_MISMATCH");
    expect(mismatch.comparison).toBeNull();

    const missing = probe();
    missing.candidate.gateway_session_id = null;
    const unknown = evaluateHarnessProbe(missing);
    expect(unknown.status).toBe("INCONCLUSIVE");
    expect(unknown.reasons).toContain("RECORDED_GATEWAY_SESSION_MISSING");

    const reused = probe();
    reused.candidate.gateway_session_id = reused.baseline.gateway_session_id;
    expect(evaluateHarnessProbe(reused).reasons)
      .toContain("RECORDED_GATEWAY_SESSION_REUSED");

    const legacy = probe();
    delete legacy.baseline.gateway_session_id;
    delete legacy.candidate.gateway_session_id;
    expect(evaluateHarnessProbe(legacy).status).toBe("INCONCLUSIVE");

    // Even a reported quality FAIL cannot be called a controlled result
    // if the candidate session identity cannot be correlated.
    missing.candidate.quality_verdict = "FAIL";
    missing.candidate.state = "INCOMPLETE";
    missing.candidate.accepted_result = false;
    missing.candidate.metrics = null;
    expect(evaluateHarnessProbe(missing).status).toBe("INCONCLUSIVE");
  });

  test("Control task context and candidate project provenance cannot drift", () => {
    const input = probe();
    // A different Control packet may have selected a different stage or
    // authoring authority even when the starting model and reference match.
    input.candidate.pipeline_provenance.control_task_context_id =
      "task:" + "d".repeat(20);
    const changed = evaluateHarnessProbe(input);
    expect(changed.status).toBe("INCONCLUSIVE");
    expect(changed.reasons).toContain("CONTROL_TASK_CONTEXT_MISMATCH");
    expect(changed.comparison).toBeNull();

    // Missing candidate Control authority is also incomparable.
    input.candidate.pipeline_provenance.control_task_context_id = null;
    expect(evaluateHarnessProbe(input).reasons)
      .toContain("CONTROL_TASK_CONTEXT_MISMATCH");

    // A claimed live FAIL with no project identity is not an anchored negative.
    input.candidate.pipeline_provenance.control_task_context_id =
      input.baseline.pipeline_provenance.control_task_context_id;
    input.candidate.state = "INCOMPLETE";
    input.candidate.quality_verdict = "FAIL";
    input.candidate.accepted_result = false;
    input.candidate.metrics = null;
    input.candidate.pipeline_provenance.input_project_uuid = null;
    const unboundFailure = evaluateHarnessProbe(input);
    expect(unboundFailure.status).toBe("INCONCLUSIVE");
    expect(unboundFailure.reasons).toContain("CANDIDATE_PROJECT_UNBOUND");

    // A distinct disposable project UUID is allowed when its starting
    // bytes, Control context and other independent evidence still match.
    input.candidate.pipeline_provenance.input_project_uuid =
      "separate-disposable-project";
    expect(evaluateHarnessProbe(input).status).toBe("REJECTED_QUALITY");

    input.candidate.state = "ACCEPTED";
    input.candidate.quality_verdict = "PASS";
    input.candidate.accepted_result = true;
    input.candidate.metrics = structuredClone(input.baseline.metrics);
    expect(evaluateHarnessProbe(input).status).toBe("REVIEW_REQUIRED");
  });

  test("unknown or changed model cannot silently support a causal harness gain", () => {
    const input = probe();
    input.candidate.usage!.model = null;
    expect(evaluateHarnessProbe(input).reasons).toContain("MODEL_IDENTITY_UNKNOWN");
    input.candidate.usage!.model = "different-model";
    expect(evaluateHarnessProbe(input).reasons).toContain("MODEL_MISMATCH");
  });


  test("telemetry provenance must be comparable for a controlled efficiency result", () => {
    const input = probe();
    input.candidate.usage!.telemetry_source = null;
    const noSource = evaluateHarnessProbe(input);
    expect(noSource.status).toBe("INCONCLUSIVE");
    expect(noSource.reasons).toContain("TELEMETRY_SOURCE_UNKNOWN");
    expect(noSource.comparison).toBeNull();

    input.candidate.usage!.telemetry_source = "different-provider-estimate";
    const differentSource = evaluateHarnessProbe(input);
    expect(differentSource.status).toBe("INCONCLUSIVE");
    expect(differentSource.reasons).toContain("TELEMETRY_SOURCE_MISMATCH");
    expect(differentSource.comparison).toBeNull();

    input.candidate.usage!.telemetry_source = input.baseline.usage!.telemetry_source;
    expect(evaluateHarnessProbe(input).status).toBe("REVIEW_REQUIRED");
  });

  test("bad or unchanged context hashes and source-only baselines fail closed", () => {
    const input = probe();
    input.candidate_harness_sha256 = input.baseline_harness_sha256;
    expect(() => evaluateHarnessProbe(input)).toThrow("distinct declared context SHA-256");
    input.candidate_harness_sha256 = "invalid";
    expect(() => evaluateHarnessProbe(input)).toThrow("distinct declared context SHA-256");
    input.candidate_harness_sha256 = "2".repeat(64);
    input.baseline.proof_scope = "LOCAL_CODE";
    expect(() => evaluateHarnessProbe(input)).toThrow("requires LIVE_BLOCKBENCH");
  });


  test("selected context bytes must match declared SHA-256 before treating them as verified input", () => {
    const input = probe();
    const original = Buffer.from("baseline-geometry-guidance-v1", "utf8");
    const revised = Buffer.from("candidate-geometry-guidance-v1", "utf8");
    input.baseline_harness_sha256 = createHash("sha256").update(original).digest("hex");
    input.candidate_harness_sha256 = createHash("sha256").update(revised).digest("hex");
    const result = verifyHarnessContextBytes(input, original, revised);
    expect(result).toEqual({
      status: "SELECTED_BYTES_MATCH_DECLARATIONS_NOT_AGENT_CONSUMPTION",
      baseline_bytes: original.byteLength,
      candidate_bytes: revised.byteLength,
    });
    expect(evaluateHarnessProbe(input).status).toBe("REVIEW_REQUIRED");

    expect(() => verifyHarnessContextBytes(input, revised, original))
      .toThrow("HARNESS_CONTEXT_BYTE_IDENTITY_MISMATCH");
    expect(() => verifyHarnessContextBytes(input,
      Buffer.from("tampered-baseline"), revised
    )).toThrow("HARNESS_CONTEXT_BYTE_IDENTITY_MISMATCH");
    expect(() => verifyHarnessContextBytes(input, Buffer.alloc(0), revised))
      .toThrow("1..262144 bytes");
    expect(() => verifyHarnessContextBytes(input, original, Buffer.alloc(262145)))
      .toThrow("1..262144 bytes");
  });

  test("Harness CLI review and quality veto require verified selected context files", () => {
    const input = probe();
    const original = Buffer.from("harness-geometry-baseline", "utf8");
    const revised = Buffer.from("harness-geometry-candidate", "utf8");
    input.baseline_harness_sha256 = createHash("sha256").update(original).digest("hex");
    input.candidate_harness_sha256 = createHash("sha256").update(revised).digest("hex");
    const acceptedPair = evaluateHarnessProbe(input);
    expect(acceptedPair.status).toBe("REVIEW_REQUIRED");
    const withoutFiles = requireHarnessContextBytes(acceptedPair, null);
    expect(withoutFiles.status).toBe("INCONCLUSIVE");
    expect(withoutFiles.reasons).toContain("HARNESS_CONTEXT_BYTES_NOT_CHECKED");
    expect(withoutFiles.comparison).toBeNull();
    const checked = verifyHarnessContextBytes(input, original, revised);
    expect(requireHarnessContextBytes(acceptedPair, checked).status).toBe("REVIEW_REQUIRED");

    input.candidate.quality_verdict = "FAIL";
    input.candidate.state = "INCOMPLETE";
    input.candidate.accepted_result = false;
    input.candidate.metrics = null;
    const qualityVeto = evaluateHarnessProbe(input);
    expect(qualityVeto.status).toBe("REJECTED_QUALITY");
    expect(requireHarnessContextBytes(qualityVeto, null).status).toBe("INCONCLUSIVE");
    expect(requireHarnessContextBytes(qualityVeto, checked).status).toBe("REJECTED_QUALITY");

    input.session_pair = undefined;
    const unresolved = evaluateHarnessProbe(input);
    expect(unresolved.status).toBe("INCONCLUSIVE");
    expect(requireHarnessContextBytes(unresolved, null)).toBe(unresolved);
  });

  test("identical context bytes are not a second candidate", () => {
    const input = probe();
    const same = Buffer.from("same-guidance", "utf8");
    const hash = createHash("sha256").update(same).digest("hex");
    input.baseline_harness_sha256 = hash;
    input.candidate_harness_sha256 = hash;
    expect(() => verifyHarnessContextBytes(input, same, same))
      .toThrow("HARNESS_CONTEXT_IDENTICAL_BYTES");
    expect(() => evaluateHarnessProbe(input)).toThrow("distinct declared context SHA-256");
  });

  test("contradictory FAIL and missing saved artifact cannot be promoted", () => {
    const invalid = probe();
    invalid.candidate.quality_verdict = "FAIL";
    expect(() => evaluateHarnessProbe(invalid)).toThrow("FAIL candidate cannot claim ACCEPTED");
    const unsaved = probe();
    unsaved.candidate.pipeline_provenance.output_asset_sha256 = null;
    expect(() => evaluateHarnessProbe(unsaved)).toThrow("valid changed output_asset_sha256");
  });
});

describe("R5 Geometry Knowledge controlled Golden comparison (synthetic contract only)", () => {
  const sourcePath = "docs/03-authoring/modelling/decision-cases.md";
  const caseSection = indexMarkdownKnowledge(sourcePath, casebook)
    .find(section => section.heading === "G-P05 Joint Pivot And Bone Parenting")!;
  const caseSource = describeKnowledgeSource(sourcePath, casebook);
  const sourceSha = "a".repeat(40);
  const protocolSha = "f".repeat(64);

  function syntheticPair(): GeometryKnowledgePairInput {
    const baseline = accepted(sourceSha, 7);
    const candidate = accepted(sourceSha, 5);
    baseline.usage = {
      model: "gpt-6", telemetry_source: "verified-provider-usage", total_tokens: 5000,
    };
    candidate.usage = {
      model: "gpt-6", telemetry_source: "verified-provider-usage", total_tokens: 5000,
    };
    baseline.pipeline_provenance.runtime_build_identity = "source-aligned-runtime";
    candidate.pipeline_provenance.runtime_build_identity = "source-aligned-runtime";
    baseline.pipeline_provenance.input_project_uuid = "independent-control-project";
    candidate.pipeline_provenance.input_project_uuid = "independent-candidate-project";
    const evidence = (mode: GeometryKnowledgeExposure["mode"],
      report: FinalGoldenSessionReport): GeometryKnowledgeExposure => ({
      mode, task_id: report.task_id, source_sha: report.source_sha,
      input_project_uuid: report.pipeline_provenance.input_project_uuid!,
      benchmark_session_id: "runner:" + mode,
      feature_id: "joint-hinge",
      reference_claim_ids: ["reference:front", "reference:side"],
      structured_response_ref: "capture:" + mode,
      structured_response_sha256:
        (mode === "CONTROL_NO_CURATED_GUIDANCE" ? "1" : "2").repeat(64),
      protocol_sha256: protocolSha,
      environment: {
        operating_system: "windows-x64",
        blockbench_version: "4.12.0",
        target_bedrock_version: "1.21.0",
      },
      curated_case: mode === "CONTROL_NO_CURATED_GUIDANCE" ? null : {
        feature_id: "joint-hinge",
        section_id: caseSection.id, section_sha256: caseSection.sha256,
        source_sha256: caseSource.content_sha256,
        heading: caseSection.heading, source_path: sourcePath,
        guidance_state: "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF",
      },
    });
    return {
      baseline, candidate,
      baseline_exposure: evidence("CONTROL_NO_CURATED_GUIDANCE", baseline),
      candidate_exposure: evidence("CANDIDATE_CURATED_GUIDANCE", candidate),
    };
  }

  test("reports valid paired deltas but never a causal winner or measured model improvement", () => {
    const input = syntheticPair();
    const before = structuredClone(input);
    const report = compareGeometryKnowledgeGoldenPair(input);
    expect(report).toMatchObject({
      report: "geometry-knowledge-golden-pair",
      experiment_status: "MATCHED_ACCEPTED_REPORTS_FOR_HUMAN_REVIEW",
      attribution: "NOT_CAUSALLY_ATTESTED",
      capture_authentication: "EXTERNAL_REVIEW_REQUIRED",
      quality_gate: "BOTH_ACCEPTED_PASS_SAME_REFERENCE",
      intervention: {
        feature_id: "joint-hinge",
        section_id: caseSection.id,
        section_sha256: caseSection.sha256,
        source_sha256: caseSource.content_sha256,
      },
    });
    expect(report.metrics.tool_calls_to_accepted_result
      .delta_candidate_minus_baseline).toBe(-2);
    expect(report).not.toHaveProperty("winner");
    expect(report).not.toHaveProperty("quality_score");
    expect(report).not.toHaveProperty("causal_improvement");
    expect(input).toEqual(before);
  });

  test("rejects different code builds, Control contexts and reused benchmark sessions", () => {
    const input = syntheticPair();
    input.candidate.source_sha = "b".repeat(40);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SOURCE_BUILD_OR_CONTROL_CHANGED");
    input.candidate.source_sha = sourceSha;
    input.candidate.pipeline_provenance.runtime_build_identity = "different-runtime";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SOURCE_BUILD_OR_CONTROL_CHANGED");
    input.candidate.pipeline_provenance.runtime_build_identity = "source-aligned-runtime";
    input.candidate.pipeline_provenance.control_task_context_id =
      "task:abcdef1234567890fedc";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SOURCE_BUILD_OR_CONTROL_CHANGED");
    input.candidate.pipeline_provenance.control_task_context_id =
      input.baseline.pipeline_provenance.control_task_context_id;
    input.candidate_exposure.benchmark_session_id =
      input.baseline_exposure.benchmark_session_id;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_INDEPENDENT_SESSION_REQUIRED");
    input.candidate_exposure.benchmark_session_id =
      "runner:CANDIDATE_CURATED_GUIDANCE";
    // The same initial .bbmodel may retain the very same authored Project UUID.
    input.candidate.pipeline_provenance.input_project_uuid =
      input.baseline.pipeline_provenance.input_project_uuid;
    input.candidate_exposure.input_project_uuid =
      input.baseline_exposure.input_project_uuid;
    expect(() => compareGeometryKnowledgeGoldenPair(input)).not.toThrow();
  });

  test("requires the same known AI model and rejects unrelated or incomplete tasks", () => {
    const input = syntheticPair();
    input.candidate.usage!.model = null;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SAME_KNOWN_MODEL_REQUIRED");
    input.candidate.usage!.model = "different-model";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SAME_KNOWN_MODEL_REQUIRED");
    input.candidate.usage!.model = "gpt-6";
    input.candidate.usage!.telemetry_source = null;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_SAME_KNOWN_TELEMETRY_SOURCE_REQUIRED");
    input.candidate.usage!.telemetry_source = "verified-provider-usage";
    input.candidate.task_id = input.baseline.task_id = "golden-retired-case";
    input.baseline_exposure.task_id = input.candidate_exposure.task_id =
      "golden-retired-case";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("requires a known canonical Golden task ID");
    const missing = syntheticPair();
    missing.candidate.proof_scope = "LOCAL_CODE";
    expect(() => compareGeometryKnowledgeGoldenPair(missing))
      .toThrow("requires LIVE_BLOCKBENCH proof");
    const incomplete = syntheticPair();
    incomplete.baseline.state = "INCOMPLETE";
    expect(() => compareGeometryKnowledgeGoldenPair(incomplete))
      .toThrow("must be an ACCEPTED");
  });

  test("rejects changed input/reference, protocol, view claims and runtime environment", () => {
    const input = syntheticPair();
    input.candidate.pipeline_provenance.input_asset_sha256 = "e".repeat(64);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("same valid input_asset_sha256");
    input.candidate.pipeline_provenance.input_asset_sha256 = "a".repeat(64);
    input.candidate.pipeline_provenance.reference_package_fingerprint = "c".repeat(64);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("same reference package fingerprint");
    input.candidate.pipeline_provenance.reference_package_fingerprint = "b".repeat(64);
    input.candidate_exposure.protocol_sha256 = "9".repeat(64);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_FEATURE_PROTOCOL_OR_CLAIMS_CHANGED");
    input.candidate_exposure.protocol_sha256 = protocolSha;
    input.candidate_exposure.reference_claim_ids = ["reference:top"];
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_FEATURE_PROTOCOL_OR_CLAIMS_CHANGED");
    input.candidate_exposure.reference_claim_ids =
      ["reference:front", "reference:side"];
    input.candidate_exposure.environment.blockbench_version = "not-the-same";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_ENVIRONMENT_CHANGED");
  });

  test("refuses to call an unobserved or ungrounded knowledge condition an intervention", () => {
    const input = syntheticPair();
    input.baseline_exposure.curated_case =
      structuredClone(input.candidate_exposure.curated_case);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_INTERVENTION_NOT_ISOLATED");
    input.baseline_exposure.curated_case = null;
    input.candidate_exposure.curated_case = null;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_INTERVENTION_NOT_ISOLATED");
    input.candidate_exposure.mode = "CONTROL_NO_CURATED_GUIDANCE";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CANDIDATE_OWNERSHIP_MISMATCH");
  });

  test("requires exact current G1 source/section SHA, not a plausible heading", () => {
    const input = syntheticPair();
    const knowledge = input.candidate_exposure.curated_case!;
    knowledge.section_sha256 = "0".repeat(64);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CASE_SOURCE_STALE_OR_UNKNOWN");
    knowledge.section_sha256 = caseSection.sha256;
    knowledge.source_sha256 = "0".repeat(64);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CASE_SOURCE_STALE_OR_UNKNOWN");
    knowledge.source_sha256 = caseSource.content_sha256;
    knowledge.feature_id = "wrong-part";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CASE_PROVENANCE_INVALID");
    knowledge.feature_id = "joint-hinge";
    knowledge.heading = "G-P06 Negative Space Versus Painted Shadow";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CASE_SOURCE_STALE_OR_UNKNOWN");
    knowledge.heading = caseSection.heading;
    knowledge.section_id = "knowledge:not-registered";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CASE_SOURCE_STALE_OR_UNKNOWN");
  });

  test("requires content-addressed response captures and unambiguous source identity", () => {
    const input = syntheticPair();
    input.candidate_exposure.structured_response_sha256 = "not-a-hash";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_INVALID_RESPONSE_HASH");
    input.candidate_exposure.structured_response_sha256 = "2".repeat(64);
    input.candidate_exposure.structured_response_ref =
      input.baseline_exposure.structured_response_ref;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_DISTINCT_RESPONSE_CAPTURES_REQUIRED");
    input.candidate_exposure.structured_response_ref = "capture:candidate";
    input.candidate_exposure.structured_response_sha256 =
      input.baseline_exposure.structured_response_sha256;
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_DISTINCT_RESPONSE_CAPTURES_REQUIRED");
    input.candidate_exposure.structured_response_sha256 = "2".repeat(64);
    input.candidate_exposure.structured_response_ref = " ";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_INVALID_RESPONSE_REF");
    input.candidate_exposure.structured_response_ref = "capture:candidate";
    input.candidate_exposure.source_sha = "b".repeat(40);
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_CANDIDATE_OWNERSHIP_MISMATCH");
    input.candidate_exposure.source_sha = sourceSha;
    input.candidate_exposure.reference_claim_ids = ["reference:front", "reference:front"];
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_REFERENCE_CLAIMS_INVALID");
  });
});
