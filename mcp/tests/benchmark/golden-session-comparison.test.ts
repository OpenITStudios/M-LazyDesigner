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
    task_id: "golden-geometry-correction",
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
    otherTask.task_id = "golden-rigid-authoring";

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
    baseline.task_id = candidate.task_id = "golden-articulated-authoring";
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
    input.candidate.task_id = input.baseline.task_id = "golden-texture-correction";
    input.baseline_exposure.task_id = input.candidate_exposure.task_id =
      "golden-texture-correction";
    expect(() => compareGeometryKnowledgeGoldenPair(input))
      .toThrow("R5_GEOMETRY_PAIR_TASK_NOT_GEOMETRY_RELEVANT");
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
