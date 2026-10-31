import { describe, expect, test } from "bun:test";
import goldenCorpus from "../fixtures/golden-task-cases.json";
import { benchmarkCaptureEvidenceRef, type BenchmarkCaptureEvidence } from "../../gateway/execution/benchmarkTrace";
import {
  finalizeGoldenSession,
} from "../../scripts/reporting/finalize-golden-session";
import type {
  GoldenAuthoringDocument,
} from "../../scripts/reporting/evaluate-golden-authoring-runs";
import type {
  UsageDocument,
} from "../../scripts/evaluate/validate-astra-usage";

const fullTask = goldenCorpus.tasks[0]!;
const STATIC_VISUAL = new Set([
  "reference_fidelity", "silhouette_proportion",
  "required_parts_and_negative_space", "mapped_texture_and_palette",
]);
function captureFixture(): BenchmarkCaptureEvidence {
  const payload: Omit<BenchmarkCaptureEvidence, "evidence_ref"> = {
    project_uuid: "golden-fixture-live-project",
    reference_package_fingerprint: "c".repeat(64),
    front_direction: "-z", shading: true,
    diagnostic_missing_texture_highlight: false,
    views: [
      { view: "front", png_sha256: "1".repeat(64) },
      { view: "left", png_sha256: "2".repeat(64) },
      { view: "back", png_sha256: "3".repeat(64) },
    ],
  };
  return { ...payload, evidence_ref: benchmarkCaptureEvidenceRef(payload) };
}


function golden(): GoldenAuthoringDocument {
  return {
    schema: "lazydesigner-golden-authoring-runs-v1",
    runs: [
      {
        task_id: "golden-full-asset-authoring",
        source_sha: "1234567890abcdef1234567890abcdef12345678",
        proof_scope: "LIVE_BLOCKBENCH",
        model: null,
        pipeline_provenance: {
          reference_package_fingerprint: null,
          control_task_context_id: null,
          runtime_build_identity: null,
          artifact_revision: null,
        },
        quality_verdict: "UNVERIFIED",
        accepted_result: null,
        user_corrections: null,
        correction_rounds: null,
        wall_time_ms: 1000,
        accepted_result_ms: null,
        token_usage: {
          total_tokens: null,
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
        },
        trace: [
          {
            index: 0,
            kind: "inspect",
            capability: "inspect_elements",
            required_for_decision: null,
            result_bytes: 100,
            latency_ms: 10,
          },
        ],
        acceptance_evidence: [
          ...fullTask.acceptance.map(criterion => ({
            criterion, verdict: "UNVERIFIED" as const, evidence_ref: null,
          })),
          { criterion: "human_acceptance", verdict: "UNVERIFIED", evidence_ref: null },
        ],
      },
    ],
  };
}

function usage(sourceSha: string): UsageDocument {
  return {
    schema: "lazydesigner-astra-usage-v1",
    proof_scope: "LIVE_BLOCKBENCH",
    source_sha: sourceSha,
    model: "gpt-5.6-sol",
    telemetry_source: "codex",
    runs: [
      {
        task_id: "golden-full-asset-authoring",
        variant: "zero_waste",
        quality_verdict: "UNVERIFIED",
        task_success: null,
        accepted_result: null,
        user_corrections: null,
        usage: {
          total_tokens: null,
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
        },
        calls: {
          total: 1,
          search: 0,
          describe: 0,
          inspect: 1,
          mutate: 0,
          verify: 0,
          recovery: 0,
        },
      },
    ],
  };
}


function acceptedGolden(): GoldenAuthoringDocument {
  const doc = golden();
  const run = doc.runs[0]!;
  run.quality_verdict = "PASS";
  run.accepted_result = true;
  run.user_corrections = 1;
  run.correction_rounds = 1;
  run.accepted_result_ms = 700;
  run.pipeline_provenance = {
    input_asset_sha256: "a".repeat(64),
    output_asset_sha256: "b".repeat(64),
    input_project_uuid: "golden-fixture-live-project",
    reference_package_fingerprint: "c".repeat(64),
    control_task_context_id: "task:1234567890abcdef1234",
    runtime_build_identity: "installed-build-fixture",
    artifact_revision: "saved-asset-fixture",
  };
  run.trace = [
    {
      index: 0, kind: "mutate", success: true,
      capability: "manage_cubes", required_for_decision: true,
    },
    {
      index: 1, kind: "mutate", success: true,
      capability: "paint_texture_transaction", required_for_decision: true,
    },
    {
      index: 2, kind: "mutate", success: true,
      capability: "create_animation", required_for_decision: true,
    },
    {
      index: 3, kind: "verify", success: true,
      capability: "capture_model_views", required_for_decision: true,
      capture_evidence: captureFixture(),
    },
  ];
  run.acceptance_evidence = run.acceptance_evidence.map(entry => ({
    ...entry, verdict: "PASS" as const,
    evidence_ref: STATIC_VISUAL.has(entry.criterion)
      ? captureFixture().evidence_ref
      : "human-asserted-fixture:" + entry.criterion,
  }));
  return doc;
}

function acceptedUsage(sourceSha: string): UsageDocument {
  const doc = usage(sourceSha);
  doc.runs[0]!.quality_verdict = "PASS";
  doc.runs[0]!.task_success = true;
  doc.runs[0]!.accepted_result = true;
  doc.runs[0]!.calls = {
    total: 4, search: 0, describe: 0, inspect: 0,
    mutate: 3, verify: 1, recovery: 0,
  };
  return doc;
}

describe("golden session finalizer", () => {
  test("keeps an unresolved draft incomplete and withholds metrics", () => {
    const report = finalizeGoldenSession({ golden: golden() });
    expect(report.state).toBe("INCOMPLETE");
    expect(report.metrics).toBeNull();
    expect(report.unresolved).toEqual({
      decision_labels: 1,
      acceptance_evidence: fullTask.acceptance.length + 1,
    });
  });

  test("rejects usage telemetry from a different exact SHA", () => {
    expect(() =>
      finalizeGoldenSession({
        golden: golden(),
        usage: usage("abcdef1234567890abcdef1234567890abcdef12"),
      })
    ).toThrow("does not match golden run");
  });

  test("rejects inconsistent model identity across golden and client telemetry", () => {
    const goldenRun = golden();
    goldenRun.runs[0]!.model = "gpt-6.1-sol";
    expect(() => finalizeGoldenSession({
      golden: goldenRun,
      usage: usage("1234567890abcdef1234567890abcdef12345678"),
    })).toThrow("model identity conflicts");
  });

  test("rejects contradictory source-provided token totals", () => {
    const goldenRun = golden();
    goldenRun.runs[0]!.token_usage!.total_tokens = 100;
    const measured = usage("1234567890abcdef1234567890abcdef12");
    measured.runs[0]!.usage.total_tokens = 200;
    expect(() => finalizeGoldenSession({
      golden: goldenRun, usage: measured,
    })).toThrow("source_sha");
    measured.source_sha = "1234567890abcdef1234567890abcdef12345678";
    expect(() => finalizeGoldenSession({
      golden: goldenRun, usage: measured,
    })).toThrow("total_tokens conflicts");
  });


  test("accepted Golden quality refuses usage telemetry lacking a source SHA", () => {
    const goldenDoc = acceptedGolden();
    const telemetry = acceptedUsage(goldenDoc.runs[0]!.source_sha);
    telemetry.source_sha = null;
    expect(() => finalizeGoldenSession({ golden: goldenDoc, usage: telemetry }))
      .toThrow("Accepted Golden usage requires exact matching source_sha and LIVE_BLOCKBENCH proof");
  });

  test("accepted Golden quality refuses source-only usage telemetry even with matching SHA", () => {
    const goldenDoc = acceptedGolden();
    const telemetry = acceptedUsage(goldenDoc.runs[0]!.source_sha);
    telemetry.proof_scope = "LOCAL_CODE";
    expect(() => finalizeGoldenSession({ golden: goldenDoc, usage: telemetry }))
      .toThrow("Accepted Golden usage requires exact matching source_sha and LIVE_BLOCKBENCH proof");
  });

  test("accepted Golden quality allows matching live telemetry but never authenticates external PASS", () => {
    const goldenDoc = acceptedGolden();
    const telemetry = acceptedUsage(goldenDoc.runs[0]!.source_sha);
    const report = finalizeGoldenSession({ golden: goldenDoc, usage: telemetry });
    expect(report).toMatchObject({
      state: "ACCEPTED", quality_verdict: "PASS",
      proof_scope: "LIVE_BLOCKBENCH",
      usage: { model: "gpt-5.6-sol", calls_total: 4 },
    });
    expect(report.metrics?.tool_calls_to_accepted_result).toBe(4);
  });

  test("incomplete Golden drafts may retain SHA-unknown telemetry only as diagnostics", () => {
    const partialUsage = usage("1234567890abcdef1234567890abcdef12345678");
    partialUsage.source_sha = null;
    const report = finalizeGoldenSession({ golden: golden(), usage: partialUsage });
    expect(report.state).toBe("INCOMPLETE");
    expect(report.metrics).toBeNull();
  });

  test("merges same-SHA telemetry without upgrading quality", () => {
    const report = finalizeGoldenSession({
      golden: golden(),
      usage: usage("1234567890abcdef1234567890abcdef12345678"),
    });
    expect(report.state).toBe("INCOMPLETE");
    expect(report.usage).toMatchObject({
      variant: "zero_waste",
      model: "gpt-5.6-sol",
      telemetry_source: "codex",
      calls_total: 1,
      total_tokens: null,
    });
  });
});