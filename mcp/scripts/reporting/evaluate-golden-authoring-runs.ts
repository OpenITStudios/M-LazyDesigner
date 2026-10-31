import goldenCorpus from "../../tests/fixtures/golden-task-cases.json";
import {
  capabilityOperationClassByName,
  capabilityStageByName,
} from "../../lib/capabilities/manifest";

export type GoldenQualityVerdict = "PASS" | "FAIL" | "UNVERIFIED";
export type GoldenTraceKind =
  | "search"
  | "describe"
  | "inspect"
  | "mutate"
  | "verify"
  | "recovery";

export type GoldenTraceEvent = {
  index: number;
  kind: GoldenTraceKind;
  /** Recorded Gateway outcome; missing means unverified legacy/manual trace. */
  success?: boolean;
  capability?: string;
  required_for_decision: boolean | null;
  result_bytes?: number | null;
  latency_ms?: number | null;
};

export type GoldenAcceptanceEvidence = {
  criterion: string;
  verdict: GoldenQualityVerdict;
  evidence_ref: string | null;
};

export type GoldenPipelineProvenance = {
  /** Exact initial .bbmodel bytes; required for comparable accepted Golden Tasks. */
  input_asset_sha256?: string | null;
  /** SHA-256 of the persisted final .bbmodel; not visual acceptance. */
  output_asset_sha256?: string | null;
  /** From the read-only live get_project_info preflight, not from filenames. */
  input_project_uuid?: string | null;
  reference_package_fingerprint: string | null;
  control_task_context_id: string | null;
  runtime_build_identity: string | null;
  artifact_revision: string | null;
};

export type GoldenAuthoringRun = {
  task_id: string;
  source_sha: string;
  proof_scope: "LOCAL_CODE" | "LIVE_BLOCKBENCH";
  model: string | null;
  pipeline_provenance: GoldenPipelineProvenance;
  quality_verdict: GoldenQualityVerdict;
  accepted_result: boolean | null;
  user_corrections: number | null;
  correction_rounds: number | null;
  wall_time_ms: number | null;
  accepted_result_ms: number | null;
  token_usage?: {
    total_tokens: number | null;
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
  };
  trace: GoldenTraceEvent[];
  acceptance_evidence: GoldenAcceptanceEvidence[];
};

export type GoldenAuthoringDocument = {
  schema: "lazydesigner-golden-authoring-runs-v1";
  runs: GoldenAuthoringRun[];
};

const taskById = new Map(
  goldenCorpus.tasks.map((task) => [task.id, task] as const)
);

function requireNonNegativeNullable(value: unknown, field: string): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be null or a finite non-negative number.`);
  }
}

function validateRun(run: GoldenAuthoringRun, index: number): void {
  const prefix = `runs[${index}]`;
  const task = taskById.get(run.task_id);
  if (!task) throw new Error(`${prefix}.task_id is not in the golden task corpus.`);
  if (!/^[0-9a-f]{40}$/.test(run.source_sha)) {
    throw new Error(`${prefix}.source_sha must be an exact 40-character Git SHA.`);
  }
  if (!["LOCAL_CODE", "LIVE_BLOCKBENCH"].includes(run.proof_scope)) {
    throw new Error(`${prefix}.proof_scope is invalid.`);
  }
  if (!["PASS", "FAIL", "UNVERIFIED"].includes(run.quality_verdict)) {
    throw new Error(`${prefix}.quality_verdict is invalid.`);
  }
  if (run.accepted_result !== null && typeof run.accepted_result !== "boolean") {
    throw new Error(`${prefix}.accepted_result must be boolean or null.`);
  }

  const provenance = run.pipeline_provenance;
  if (!provenance || typeof provenance !== "object") {
    throw new Error(`${prefix}.pipeline_provenance is required.`);
  }
  for (const field of [
    "reference_package_fingerprint",
    "control_task_context_id",
    "runtime_build_identity",
    "artifact_revision",
  ] as const) {
    const value = provenance[field];
    if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
      throw new Error(`${prefix}.pipeline_provenance.${field} must be null or a non-empty string.`);
    }
  }
  if (provenance.input_project_uuid != null &&
    (typeof provenance.input_project_uuid !== "string" ||
      provenance.input_project_uuid.trim().length === 0)) {
    throw new Error(`${prefix}.pipeline_provenance.input_project_uuid must be a non-empty string.`);
  }
  for (const field of ["input_asset_sha256", "output_asset_sha256"] as const) {
    const hash = provenance[field];
    if (hash != null && (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash))) {
      throw new Error(`${prefix}.pipeline_provenance.${field} must be a 64-character lowercase hex SHA-256.`);
    }
  }
  if (
    provenance.reference_package_fingerprint !== null &&
    !/^[0-9a-f]{64}$/.test(provenance.reference_package_fingerprint)
  ) {
    throw new Error(`${prefix}.pipeline_provenance.reference_package_fingerprint must be a 64-character lowercase hex fingerprint.`);
  }
  if (
    provenance.control_task_context_id !== null &&
    !/^task:[0-9a-f]{20}$/.test(provenance.control_task_context_id)
  ) {
    throw new Error(`${prefix}.pipeline_provenance.control_task_context_id must be a Control task context id.`);
  }

  requireNonNegativeNullable(run.user_corrections, `${prefix}.user_corrections`);
  requireNonNegativeNullable(run.correction_rounds, `${prefix}.correction_rounds`);
  requireNonNegativeNullable(run.wall_time_ms, `${prefix}.wall_time_ms`);
  requireNonNegativeNullable(run.accepted_result_ms, `${prefix}.accepted_result_ms`);

  if (!Array.isArray(run.trace)) throw new Error(`${prefix}.trace must be an array.`);
  const traceIndices = run.trace.map((event) => event.index);
  if (new Set(traceIndices).size !== traceIndices.length) {
    throw new Error(`${prefix}.trace indices must be unique.`);
  }
  for (const [eventIndex, event] of run.trace.entries()) {
    if (!Number.isInteger(event.index) || event.index < 0) {
      throw new Error(`${prefix}.trace[${eventIndex}].index must be a non-negative integer.`);
    }
    if (!["search", "describe", "inspect", "mutate", "verify", "recovery"].includes(event.kind)) {
      throw new Error(`${prefix}.trace[${eventIndex}].kind is invalid.`);
    }
    if (event.success !== undefined && typeof event.success !== "boolean") {
      throw new Error(`${prefix}.trace[${eventIndex}].success must be boolean when present.`);
    }
    if (
      event.required_for_decision !== null &&
      typeof event.required_for_decision !== "boolean"
    ) {
      throw new Error(
        `${prefix}.trace[${eventIndex}].required_for_decision must be boolean or null.`
      );
    }
    if (event.result_bytes !== undefined) {
      requireNonNegativeNullable(event.result_bytes, `${prefix}.trace[${eventIndex}].result_bytes`);
    }
    if (event.latency_ms !== undefined) {
      requireNonNegativeNullable(event.latency_ms, `${prefix}.trace[${eventIndex}].latency_ms`);
    }
  }

  if (!Array.isArray(run.acceptance_evidence)) {
    throw new Error(`${prefix}.acceptance_evidence must be an array.`);
  }
  const evidenceByCriterion = new Map(
    run.acceptance_evidence.map((entry) => [entry.criterion, entry] as const)
  );
  if (evidenceByCriterion.size !== run.acceptance_evidence.length) {
    throw new Error(`${prefix}.acceptance_evidence contains duplicate criteria.`);
  }
  for (const [evidenceIndex, entry] of run.acceptance_evidence.entries()) {
    if (typeof entry.criterion !== "string" || entry.criterion.trim().length === 0) {
      throw new Error(`${prefix}.acceptance_evidence[${evidenceIndex}].criterion is invalid.`);
    }
    if (!["PASS", "FAIL", "UNVERIFIED"].includes(entry.verdict)) {
      throw new Error(`${prefix}.acceptance_evidence[${evidenceIndex}].verdict is invalid.`);
    }
    if (entry.evidence_ref !== null &&
      (typeof entry.evidence_ref !== "string" || entry.evidence_ref.trim().length === 0)) {
      throw new Error(`${prefix}.acceptance_evidence[${evidenceIndex}].evidence_ref is invalid.`);
    }
  }
  for (const criterion of task.acceptance) {
    if (!evidenceByCriterion.has(criterion)) {
      throw new Error(
        `${prefix}.acceptance_evidence is missing required criterion "${criterion}".`
      );
    }
  }

  if (run.accepted_result === true) {
    // Every Golden Task needs a saved and content-addressed final .bbmodel.
    // A tool trace and a manually declared PASS do not prove persistence.
    if (!provenance.output_asset_sha256) {
      throw new Error(
        `${prefix} accepted result requires output_asset_sha256 from a saved .bbmodel.`
      );
    }
    if (provenance.output_asset_sha256 === provenance.input_asset_sha256) {
      throw new Error(
        `${prefix} accepted result requires output_asset_sha256 different from starting input_asset_sha256.`
      );
    }
    // Require verified seed identity for every accepted task, not just
    // corrections. Otherwise two successful runs may start from different
    // models and make their token/call comparison meaningless.
    if (!provenance.input_asset_sha256 || !provenance.input_project_uuid) {
      throw new Error(
        `${prefix} accepted result requires starting input_asset_sha256 and live input_project_uuid for model-comparable measurement.`
      );
    }
    if (run.proof_scope !== "LIVE_BLOCKBENCH") {
      throw new Error(`${prefix} accepted result requires LIVE_BLOCKBENCH proof, not source-only execution.`);
    }
    if (run.quality_verdict !== "PASS") {
      throw new Error(`${prefix} cannot be accepted unless quality_verdict is PASS.`);
    }
    // A run cannot claim full PASS while its own evidence reports a material
    // FAIL, even when the failed item is an additional non-corpus criterion.
    if (run.acceptance_evidence.some(entry => entry.verdict === "FAIL")) {
      throw new Error(
        `${prefix} accepted result cannot contain FAIL acceptance evidence.`
      );
    }
    if (
      !run.pipeline_provenance.reference_package_fingerprint ||
      !run.pipeline_provenance.control_task_context_id ||
      !run.pipeline_provenance.runtime_build_identity ||
      !run.pipeline_provenance.artifact_revision
    ) {
      throw new Error(
        `${prefix} accepted result requires complete Reference → Control → Runtime → artifact provenance.`
      );
    }
    if (!run.trace.some((event) => event.kind === "mutate" && event.success === true)) {
      throw new Error(`${prefix} accepted result requires a recorded successful mutation trace event.`);
    }
    if (!run.trace.some((event) => event.kind === "verify" && event.success === true)) {
      throw new Error(`${prefix} accepted result requires a recorded successful verification trace event.`);
    }
    if (run.trace.some((event, i) => event.index !== i)) {
      throw new Error(`${prefix} accepted result requires an ordered, contiguous trace starting at 0.`);
    }
    if (run.trace.some((event) => event.required_for_decision === null)) {
      throw new Error(
        `${prefix} accepted result requires decision labels for every trace event.`
      );
    }
    // A successful check from BEFORE the latest edit cannot establish the
    // quality of the final model. A later failed verify also invalidates
    // an earlier successful check. This orders EXISTING trace events; it
    // never adds another readback or invents native visual acceptance.
    const lastMutationIndex = run.trace.findLastIndex((event) =>
      event.kind === "mutate"
    );
    const lastVerificationIndex = run.trace.findLastIndex((event) =>
      event.kind === "verify"
    );
    if (lastVerificationIndex <= lastMutationIndex ||
        run.trace[lastVerificationIndex]?.success !== true) {
      throw new Error(
        `${prefix} accepted result requires a successful final verification after the last mutation.`
      );
    }
    // A complete authored object must actually visit its required phases.
    // Previously a lone Cube mutation + front capture could be labelled a
    // fully accepted Geometry/Texture/Animation result by synthetic evidence
    // strings alone. Reuse the canonical tool manifest, not another tool map.
    // This proves only trace coverage; each real visual/natively persisted
    // result still needs independent current-revision criterion evidence.
    for (const phase of task.phases) {
      if (!run.trace.some(event =>
        event.kind === "mutate" && event.success === true &&
        typeof event.capability === "string" &&
        capabilityStageByName(event.capability) === phase &&
        capabilityOperationClassByName(event.capability) === "MUTATION"
      )) {
        throw new Error(
          `${prefix} accepted full-asset result requires a successful ${phase} authoring mutation trace event.`
        );
      }
    }
    const humanAcceptance = evidenceByCriterion.get("human_acceptance");
    if (humanAcceptance?.verdict !== "PASS" || !humanAcceptance.evidence_ref) {
      throw new Error(`${prefix} accepted result requires documented human_acceptance PASS evidence.`);
    }
    for (const criterion of task.acceptance) {
      const evidence = evidenceByCriterion.get(criterion)!;
      if (evidence.verdict !== "PASS" || !evidence.evidence_ref) {
        throw new Error(
          `${prefix} accepted result requires PASS evidence_ref for "${criterion}".`
        );
      }
    }
  }

  if (run.accepted_result_ms !== null && run.wall_time_ms !== null &&
      run.accepted_result_ms > run.wall_time_ms) {
    throw new Error(`${prefix}.accepted_result_ms cannot exceed wall_time_ms.`);
  }
}

export function validateGoldenAuthoringDocument(
  document: GoldenAuthoringDocument
): void {
  if (document.schema !== "lazydesigner-golden-authoring-runs-v1") {
    throw new Error("Unsupported golden authoring run schema.");
  }
  if (!Array.isArray(document.runs) || document.runs.length === 0) {
    throw new Error("At least one golden authoring run is required.");
  }
  document.runs.forEach(validateRun);
}

function count(run: GoldenAuthoringRun, kind: GoldenTraceKind): number {
  return run.trace.filter((event) => event.kind === kind).length;
}

function nullableSum(values: Array<number | null | undefined>): number | null {
  if (values.some((value) => value === null || value === undefined)) return null;
  return values.reduce<number>(
    (sum, value) => sum + (value as number),
    0
  );
}

export function summarizeGoldenAuthoringDocument(
  document: GoldenAuthoringDocument
) {
  validateGoldenAuthoringDocument(document);

  const runs = document.runs.map((run) => {
    const task = taskById.get(run.task_id)!;
    const accepted = run.accepted_result === true && run.quality_verdict === "PASS";
    const redundantReadbacks = run.trace.filter(
      (event) =>
        event.kind === "inspect" &&
        event.required_for_decision === false
    ).length;
    const decisionRequiredCalls = run.trace.filter(
      (event) => event.required_for_decision === true
    ).length;

    return {
      task_id: run.task_id,
      profile: task.profile,
      proof_scope: run.proof_scope,
      source_sha: run.source_sha,
      quality_verdict: run.quality_verdict,
      accepted_result: run.accepted_result,
      pipeline_provenance: run.pipeline_provenance,
      metrics_available: accepted,
      metrics: {
        tool_calls_to_accepted_result: accepted ? run.trace.length : null,
        decision_required_calls: accepted ? decisionRequiredCalls : null,
        search_calls: accepted ? count(run, "search") : null,
        describe_calls: accepted ? count(run, "describe") : null,
        inspect_calls: accepted ? count(run, "inspect") : null,
        mutate_calls: accepted ? count(run, "mutate") : null,
        verify_calls: accepted ? count(run, "verify") : null,
        recovery_calls: accepted ? count(run, "recovery") : null,
        redundant_readbacks: accepted ? redundantReadbacks : null,
        correction_rounds: accepted ? run.correction_rounds : null,
        user_corrections: accepted ? run.user_corrections : null,
        wall_time_ms: accepted ? run.wall_time_ms : null,
        accepted_result_ms: accepted ? run.accepted_result_ms : null,
        tool_result_bytes: accepted
          ? nullableSum(run.trace.map((event) => event.result_bytes))
          : null,
        total_tokens: accepted ? run.token_usage?.total_tokens ?? null : null,
      },
    };
  });

  const acceptedRuns = runs.filter((run) => run.metrics_available);
  return {
    schema: 1,
    benchmark: "golden-authoring-cost-to-accepted-result",
    rule:
      "Efficiency metrics are reportable only for exact-SHA runs whose quality verdict is PASS and whose required acceptance criteria have explicit PASS evidence. No aggregate quality score is computed.",
    runs,
    aggregate: {
      total_runs: runs.length,
      accepted_measured_runs: acceptedRuns.length,
      quality_score: null,
      tool_calls_to_accepted_result:
        acceptedRuns.length > 0
          ? acceptedRuns.reduce(
              (sum, run) =>
                sum + (run.metrics.tool_calls_to_accepted_result ?? 0),
              0
            )
          : null,
      correction_rounds:
        acceptedRuns.length > 0 &&
        acceptedRuns.every((run) => run.metrics.correction_rounds !== null)
          ? acceptedRuns.reduce(
              (sum, run) => sum + (run.metrics.correction_rounds ?? 0),
              0
            )
          : null,
      total_tokens:
        acceptedRuns.length > 0 &&
        acceptedRuns.every((run) => run.metrics.total_tokens !== null)
          ? acceptedRuns.reduce(
              (sum, run) => sum + (run.metrics.total_tokens ?? 0),
              0
            )
          : null,
    },
  };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    throw new Error(
      "Usage: bun run report:golden-authoring -- <golden-authoring-runs.json>"
    );
  }
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Run file not found: ${path}`);
  const document = (await file.json()) as GoldenAuthoringDocument;
  console.log(JSON.stringify(summarizeGoldenAuthoringDocument(document), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
