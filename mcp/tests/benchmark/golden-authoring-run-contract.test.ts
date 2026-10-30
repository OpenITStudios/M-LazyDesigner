import { describe, expect, test } from "bun:test";
import goldenCorpus from "../fixtures/golden-task-cases.json";
import {
  summarizeGoldenAuthoringDocument,
  validateGoldenAuthoringDocument,
  type GoldenAuthoringDocument,
} from "../../scripts/reporting/evaluate-golden-authoring-runs";
const fullTask = goldenCorpus.tasks[0]!;

function acceptedRun(): GoldenAuthoringDocument {
  return {
    schema: "lazydesigner-golden-authoring-runs-v1",
    runs: [
      {
        task_id: "golden-full-asset-authoring",
        source_sha: "1234567890abcdef1234567890abcdef12345678",
        proof_scope: "LIVE_BLOCKBENCH",
        model: "gpt-5.6-sol",
        pipeline_provenance: {
          input_asset_sha256: "c".repeat(64),
          output_asset_sha256: "d".repeat(64),
          input_project_uuid: "blockbench-project-correction",
          reference_package_fingerprint: "a".repeat(64),
          control_task_context_id: "task:1234567890abcdef1234",
          runtime_build_identity: "runtime-build-accepted",
          artifact_revision: "artifact-revision-accepted",
        },
        quality_verdict: "PASS",
        accepted_result: true,
        user_corrections: 1,
        correction_rounds: 1,
        wall_time_ms: 12000,
        accepted_result_ms: 10000,
        token_usage: {
          total_tokens: 4200,
          input_tokens: 3000,
          cached_input_tokens: 1200,
          output_tokens: 800,
          reasoning_tokens: 400,
        },
        trace: [
          {
            index: 0,
            kind: "inspect",
            success: true,
            capability: "inspect_elements",
            required_for_decision: true,
            result_bytes: 900,
            latency_ms: 100,
          },
          {
            index: 1,
            kind: "mutate",
            success: true,
            capability: "manage_cubes",
            required_for_decision: true,
            result_bytes: 1200,
            latency_ms: 180,
          },
          {
            index: 2,
            kind: "verify",
            success: true,
            capability: "capture_model_views",
            required_for_decision: true,
            result_bytes: 2400,
            latency_ms: 350,
          },
        ],
        acceptance_evidence: [
          ...fullTask.acceptance.map(criterion => ({
            criterion, verdict: "PASS" as const, evidence_ref: "synthetic:" + criterion,
          })),
          { criterion: "human_acceptance", verdict: "PASS", evidence_ref: "synthetic-human-review" },
        ],
      },
    ],
  };
}

describe("golden authoring accepted-result benchmark", () => {
  test("current Golden tasks reject accepted claims without distinct persisted output", () => {
    expect(goldenCorpus.tasks).toHaveLength(1);
    for (const task of goldenCorpus.tasks) {
      const document = acceptedRun();
      const run = document.runs[0]!;
      run.task_id = task.id;
      run.acceptance_evidence = [...task.acceptance, "human_acceptance"].map(
        criterion => ({
          criterion,
          verdict: "PASS" as const,
          evidence_ref: "example-human-asserted:" + criterion,
        })
      );
      run.pipeline_provenance.output_asset_sha256 = null;
      expect(() => validateGoldenAuthoringDocument(document))
        .toThrow("output_asset_sha256");
      run.pipeline_provenance.output_asset_sha256 =
        run.pipeline_provenance.input_asset_sha256;
      expect(() => validateGoldenAuthoringDocument(document))
        .toThrow("output_asset_sha256");
      run.pipeline_provenance.output_asset_sha256 = "d".repeat(64);
      expect(() => validateGoldenAuthoringDocument(document)).not.toThrow();
    }
  });

  test("an earlier successful verification cannot accept a newer mutation", () => {
    const document = acceptedRun();
    document.runs[0]!.trace.push({
      index: 3, kind: "mutate", success: true,
      capability: "manage_cubes", required_for_decision: true,
    });
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("successful final verification after the last mutation");
    document.runs[0]!.trace.push({
      index: 4, kind: "verify", success: false,
      capability: "capture_model_views", required_for_decision: true,
    });
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("successful final verification after the last mutation");
    document.runs[0]!.trace[4]!.success = true;
    expect(() => validateGoldenAuthoringDocument(document)).not.toThrow();
  });

  test("a failed final verification invalidates an earlier successful check even without later mutations", () => {
    const document = acceptedRun();
    document.runs[0]!.trace.push({
      index: 3, kind: "verify", success: false,
      capability: "capture_model_views", required_for_decision: true,
    });
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("successful final verification after the last mutation");
  });

  test("an unsuccessful or unknown last mutation still requires a fresh verification", () => {
    const document = acceptedRun();
    document.runs[0]!.trace.push({
      index: 3, kind: "mutate", success: false,
      capability: "manage_cubes", required_for_decision: true,
    });
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("successful final verification after the last mutation");
  });


  test("contradictory additional FAIL evidence prevents accepted quality", () => {
    const doc = acceptedRun();
    doc.runs[0]!.acceptance_evidence.push({
      criterion: "reference_visual_hidden_mismatch",
      verdict: "FAIL",
      evidence_ref: "review:actual-visible-mismatch",
    });
    expect(() => validateGoldenAuthoringDocument(doc))
      .toThrow("accepted result cannot contain FAIL acceptance evidence");
  });

  test("reports efficiency only after explicit accepted PASS evidence", () => {
    const summary = summarizeGoldenAuthoringDocument(acceptedRun());
    expect(summary.runs[0]?.metrics_available).toBe(true);
    expect(summary.runs[0]?.metrics.tool_calls_to_accepted_result).toBe(3);
    expect(summary.runs[0]?.metrics.redundant_readbacks).toBe(0);
    expect(summary.runs[0]?.metrics.total_tokens).toBe(4200);
    expect(summary.aggregate.accepted_measured_runs).toBe(1);
    expect(summary.aggregate.quality_score).toBeNull();
  });

  test("rejects accepted-result claims without PASS quality", () => {
    const document = acceptedRun();
    document.runs[0]!.quality_verdict = "UNVERIFIED";
    expect(() => validateGoldenAuthoringDocument(document)).toThrow(
      "cannot be accepted unless quality_verdict is PASS"
    );
  });

  test("rejects accepted-result claims without complete end-to-end provenance", () => {
    const document = acceptedRun();
    document.runs[0]!.pipeline_provenance.runtime_build_identity = null;
    expect(() => validateGoldenAuthoringDocument(document)).toThrow(
      "requires complete Reference → Control → Runtime → artifact provenance"
    );
  });

  test("rejects accepted-result claims with missing evidence references", () => {
    const document = acceptedRun();
    document.runs[0]!.acceptance_evidence[0]!.evidence_ref = null;
    expect(() => validateGoldenAuthoringDocument(document)).toThrow(
      "accepted result requires PASS evidence_ref"
    );
  });

  test("does not expose efficiency metrics for unaccepted runs", () => {
    const document = acceptedRun();
    document.runs[0]!.accepted_result = null;
    document.runs[0]!.quality_verdict = "UNVERIFIED";
    document.runs[0]!.acceptance_evidence =
      document.runs[0]!.acceptance_evidence.map((entry) => ({
        ...entry,
        verdict: "UNVERIFIED",
        evidence_ref: null,
      }));

    const summary = summarizeGoldenAuthoringDocument(document);
    expect(summary.runs[0]?.metrics_available).toBe(false);
    expect(summary.runs[0]?.metrics.tool_calls_to_accepted_result).toBeNull();
    expect(summary.aggregate.accepted_measured_runs).toBe(0);
  });

  test("counts non-decision inspection as redundant readback only after acceptance", () => {
    const document = acceptedRun();
    document.runs[0]!.trace.push({
      index: 3,
      kind: "inspect",
      success: true,
      capability: "inspect_elements",
      required_for_decision: false,
      result_bytes: 500,
      latency_ms: 80,
    });

    const summary = summarizeGoldenAuthoringDocument(document);
    expect(summary.runs[0]?.metrics.redundant_readbacks).toBe(1);
    expect(summary.runs[0]?.metrics.tool_calls_to_accepted_result).toBe(4);
  });

  test("rejects accepted corrections without the exact starting model hash", () => {
    const missing = acceptedRun();
    missing.runs[0]!.pipeline_provenance.input_asset_sha256 = null;
    expect(() => validateGoldenAuthoringDocument(missing))
      .toThrow("accepted result requires starting input_asset_sha256");

    const malformed = acceptedRun();
    malformed.runs[0]!.pipeline_provenance.input_asset_sha256 = "not-a-hash";
    expect(() => validateGoldenAuthoringDocument(malformed))
      .toThrow("must be a 64-character lowercase hex SHA-256");
  });

  test("accepted corrections require distinct persisted output bytes", () => {
    const missing = acceptedRun();
    missing.runs[0]!.pipeline_provenance.output_asset_sha256 = null;
    expect(() => validateGoldenAuthoringDocument(missing))
      .toThrow("accepted result requires output_asset_sha256");
    const invalid = acceptedRun();
    invalid.runs[0]!.pipeline_provenance.output_asset_sha256 = "not-a-hash";
    expect(() => validateGoldenAuthoringDocument(invalid))
      .toThrow("output_asset_sha256 must be a 64-character lowercase hex SHA-256");
    const unchanged = acceptedRun();
    unchanged.runs[0]!.pipeline_provenance.output_asset_sha256 = "c".repeat(64);
    expect(() => validateGoldenAuthoringDocument(unchanged))
      .toThrow("different from starting input_asset_sha256");
  });

  test("rejects accepted corrections without live active-project identity", () => {
    const document = acceptedRun();
    document.runs[0]!.pipeline_provenance.input_project_uuid = null;
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("live input_project_uuid");

    document.runs[0]!.pipeline_provenance.input_project_uuid = " ";
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("input_project_uuid must be a non-empty string");
  });

  test("accepted new-model tasks require a verified starting model", () => {
    const document = acceptedRun();
    const run = document.runs[0]!;
    run.task_id = "golden-full-asset-authoring";
    run.acceptance_evidence = [
      ...goldenCorpus.tasks.find(task => task.id === "golden-full-asset-authoring")!.acceptance,
      "human_acceptance",
    ].map((criterion) => ({
      criterion, verdict: "PASS" as const, evidence_ref: "verified:" + criterion,
    }));
    run.pipeline_provenance.input_asset_sha256 = null;
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("accepted result requires starting input_asset_sha256");
    run.pipeline_provenance.input_asset_sha256 = "c".repeat(64);
    run.pipeline_provenance.input_project_uuid = null;
    expect(() => validateGoldenAuthoringDocument(document))
      .toThrow("live input_project_uuid");
    run.pipeline_provenance.input_project_uuid = "saved-new-benchmark-seed";
    expect(() => validateGoldenAuthoringDocument(document)).not.toThrow();
  });

  test("rejects source-only accepted quality", () => {
    const doc = acceptedRun();
    doc.runs[0]!.proof_scope = "LOCAL_CODE";
    expect(() => validateGoldenAuthoringDocument(doc)).toThrow("requires LIVE_BLOCKBENCH");
  });

  test("requires recorded human review, never inferred from the tool result", () => {
    const doc = acceptedRun();
    doc.runs[0]!.acceptance_evidence = doc.runs[0]!.acceptance_evidence.filter(
      entry => entry.criterion !== "human_acceptance"
    );
    expect(() => validateGoldenAuthoringDocument(doc)).toThrow("human_acceptance PASS evidence");
  });

  test("rejects contradictory duplicate criterion evidence", () => {
    const doc = acceptedRun();
    doc.runs[0]!.acceptance_evidence.unshift({
      criterion: "reference_fidelity",
      verdict: "FAIL",
      evidence_ref: "visual:reference-mismatch",
    });
    expect(() => validateGoldenAuthoringDocument(doc)).toThrow("duplicate criteria");
  });

  test("requires successful mutation and verification observations", () => {
    for (const kind of ["mutate", "verify"] as const) {
      const doc = acceptedRun();
      const event = doc.runs[0]!.trace.find(x => x.kind === kind)!;
      event.success = false;
      expect(() => validateGoldenAuthoringDocument(doc))
        .toThrow(`recorded successful ${kind === "mutate" ? "mutation" : "verification"} trace`);
    }
  });

  test("accepted trace must have no missing or reordered events", () => {
    const doc = acceptedRun();
    doc.runs[0]!.trace[2]!.index = 5;
    expect(() => validateGoldenAuthoringDocument(doc)).toThrow("ordered, contiguous trace");
  });

  test("retired old project-named IDs are not accepted", () => {
    const doc = acceptedRun();
    doc.runs[0]!.task_id = "golden-mechanical-lift";
    expect(() => validateGoldenAuthoringDocument(doc)).toThrow("not in the golden task corpus");
  });

  test("template remains unmeasured and references a real golden task", async () => {
    const template = await Bun.file(
      "tests/fixtures/golden-authoring-run-template.json"
    ).json() as GoldenAuthoringDocument;
    validateGoldenAuthoringDocument(template);
    expect(template.runs[0]?.accepted_result).toBeNull();
    expect(template.runs[0]?.quality_verdict).toBe("UNVERIFIED");
  });
});
