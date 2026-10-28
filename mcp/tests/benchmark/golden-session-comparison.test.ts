import { describe, expect, test } from "bun:test";
import {
  compareAcceptedGoldenSessions,
  type FinalGoldenSessionReport,
} from "../../scripts/reporting/compare-golden-sessions";

function accepted(sha: string, calls: number): FinalGoldenSessionReport {
  return {
    schema: 1,
    report: "golden-session-final",
    task_id: "golden-existing-model-correction",
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
      artifact_revision: "artifact-" + sha.slice(0, 8),
    },
    metrics: {
      tool_calls_to_accepted_result: calls,
      decision_required_calls: calls - 1,
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
    for (const task of ["golden-existing-model-correction", "golden-prop-chair",
      "golden-mechanical-lift", "golden-humanoid-fisherman",
      "golden-organic-flower", "golden-layered-cutout-display",
      "golden-pbr-machine", "golden-particle-smoke"]) {
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
    otherTask.task_id = "golden-prop-chair";

    expect(() =>
      compareAcceptedGoldenSessions({
        baseline: accepted(
          "1234567890abcdef1234567890abcdef12345678",
          5
        ),
        candidate: otherTask,
      })
    ).toThrow("same golden task_id");
  });
  test("requires identical starting asset bytes for modern Golden Tasks too", () => {
    const baseline = accepted("1234567890abcdef1234567890abcdef12345678", 5);
    const candidate = accepted("abcdef1234567890abcdef1234567890abcdef12", 3);
    baseline.task_id = candidate.task_id = "golden-mechanical-lift";
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
