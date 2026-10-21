type MetricSet = {
  tool_calls_to_accepted_result: number | null;
  decision_required_calls: number | null;
  search_calls: number | null;
  describe_calls: number | null;
  inspect_calls: number | null;
  mutate_calls: number | null;
  verify_calls: number | null;
  recovery_calls: number | null;
  redundant_readbacks: number | null;
  correction_rounds: number | null;
  user_corrections: number | null;
  wall_time_ms: number | null;
  accepted_result_ms: number | null;
  tool_result_bytes: number | null;
  total_tokens: number | null;
};

export type FinalGoldenSessionReport = {
  schema: number;
  report: "golden-session-final";
  task_id: string;
  source_sha: string;
  state: "ACCEPTED" | "INCOMPLETE";
  quality_verdict: "PASS" | "FAIL" | "UNVERIFIED";
  accepted_result: boolean | null;
  pipeline_provenance: {
    input_asset_sha256?: string | null;
    output_asset_sha256?: string | null;
    reference_package_fingerprint: string | null;
    control_task_context_id: string | null;
    runtime_build_identity: string | null;
    artifact_revision: string | null;
  };
  metrics: MetricSet | null;
  // Optional telemetry emitted by the existing golden-session finalizer.
  // Missing model data must never be interpreted as a known model identity.
  usage?: {
    model: string | null;
    telemetry_source?: string | null;
    total_tokens?: number | null;
  } | null;
};

const METRIC_KEYS: readonly (keyof MetricSet)[] = [
  "tool_calls_to_accepted_result",
  "decision_required_calls",
  "search_calls",
  "describe_calls",
  "inspect_calls",
  "mutate_calls",
  "verify_calls",
  "recovery_calls",
  "redundant_readbacks",
  "correction_rounds",
  "user_corrections",
  "wall_time_ms",
  "accepted_result_ms",
  "tool_result_bytes",
  "total_tokens",
];

function validateAcceptedReport(
  value: FinalGoldenSessionReport,
  label: string
): void {
  if (
    !value ||
    value.report !== "golden-session-final" ||
    value.state !== "ACCEPTED" ||
    value.quality_verdict !== "PASS" ||
    value.accepted_result !== true ||
    !value.metrics
  ) {
    throw new Error(
      `${label} must be an ACCEPTED golden-session-final report with PASS quality and metrics.`
    );
  }
  // Two independently supplied usage records must not report contradictory
  // token totals as a cross-model efficiency comparison.
  if (value.usage?.total_tokens != null && value.metrics.total_tokens != null &&
      value.usage.total_tokens !== value.metrics.total_tokens) {
    throw new Error(`${label} golden metrics total_tokens conflicts with usage telemetry.`);
  }
  if (!/^[0-9a-f]{40}$/.test(value.source_sha)) {
    throw new Error(`${label}.source_sha must be an exact 40-character Git SHA.`);
  }
  if (
    !value.pipeline_provenance ||
    !value.pipeline_provenance.reference_package_fingerprint ||
    !value.pipeline_provenance.control_task_context_id ||
    !value.pipeline_provenance.runtime_build_identity ||
    !value.pipeline_provenance.artifact_revision
  ) {
    throw new Error(`${label} must contain complete end-to-end pipeline provenance.`);
  }
}

export function compareAcceptedGoldenSessions(input: {
  baseline: FinalGoldenSessionReport;
  candidate: FinalGoldenSessionReport;
}) {
  validateAcceptedReport(input.baseline, "baseline");
  validateAcceptedReport(input.candidate, "candidate");

  if (input.baseline.task_id !== input.candidate.task_id) {
    throw new Error("Accepted-session comparison requires the same golden task_id.");
  }
  if (
    input.baseline.pipeline_provenance.reference_package_fingerprint !==
    input.candidate.pipeline_provenance.reference_package_fingerprint
  ) {
    throw new Error(
      "Accepted-session comparison requires the same reference package fingerprint."
    );
  }
  // The same reference is insufficient when the candidate starts from an
  // easier/already-corrected model. This applies to every Golden Task, not just
  // the historical existing-model-correction fixture. Even fresh-asset tasks
  // must fingerprint their initial (possibly empty) project state.
  const firstInput = input.baseline.pipeline_provenance.input_asset_sha256;
  const secondInput = input.candidate.pipeline_provenance.input_asset_sha256;
  if (!firstInput || !secondInput || !/^[a-f0-9]{64}$/.test(firstInput) ||
    !/^[a-f0-9]{64}$/.test(secondInput) || firstInput !== secondInput) {
    throw new Error(
      "Accepted-session comparisons require the same valid input_asset_sha256."
    );
  }

  if (input.baseline.task_id === "golden-existing-model-correction") {
    for (const [label, report] of [
      ["baseline", input.baseline], ["candidate", input.candidate],
    ] as const) {
      const output = report.pipeline_provenance.output_asset_sha256;
      if (!output || !/^[0-9a-f]{64}$/.test(output) ||
          output === report.pipeline_provenance.input_asset_sha256) {
        throw new Error(`${label} accepted correction requires a valid changed output_asset_sha256.`);
      }
    }
  }
  const baselineModel = input.baseline.usage?.model?.trim() || null;
  const candidateModel = input.candidate.usage?.model?.trim() || null;
  const modelPairState = !baselineModel || !candidateModel
    ? "UNVERIFIED"
    : baselineModel === candidateModel
      ? "SAME_MODEL"
      : "CROSS_MODEL";

  const metrics = Object.fromEntries(
    METRIC_KEYS.map((key) => {
      const baseline = input.baseline.metrics![key];
      const candidate = input.candidate.metrics![key];
      return [
        key,
        {
          baseline,
          candidate,
          delta_candidate_minus_baseline:
            baseline !== null && candidate !== null
              ? candidate - baseline
              : null,
        },
      ];
    })
  );

  return {
    schema: 1,
    report: "golden-session-comparison",
    task_id: input.baseline.task_id,
    baseline_source_sha: input.baseline.source_sha,
    candidate_source_sha: input.candidate.source_sha,
    reference_package_fingerprint:
      input.baseline.pipeline_provenance.reference_package_fingerprint,
    input_asset_sha256: firstInput,
    input_asset_comparable: true,
    model_pair: {
      baseline: baselineModel,
      candidate: candidateModel,
      state: modelPairState,
    },
    api_cost_comparison: "NOT_MEASURED" as const,
    quality_gate: "BOTH_ACCEPTED_PASS_SAME_REFERENCE",
    metrics,
    rule:
      "This report presents per-metric deltas only. Identical input and reference are required. Model IDs come only from supplied telemetry; token deltas are not API pricing or Codex allowance savings. No aggregate score or winner is inferred.",
  };
}

async function main(): Promise<void> {
  const baselinePath = process.argv[2];
  const candidatePath = process.argv[3];
  if (!baselinePath || !candidatePath) {
    throw new Error(
      "Usage: bun run compare:golden-sessions -- <baseline-final.json> <candidate-final.json>"
    );
  }

  const baselineFile = Bun.file(baselinePath);
  const candidateFile = Bun.file(candidatePath);
  if (!(await baselineFile.exists())) {
    throw new Error(`Baseline report not found: ${baselinePath}`);
  }
  if (!(await candidateFile.exists())) {
    throw new Error(`Candidate report not found: ${candidatePath}`);
  }

  console.log(
    JSON.stringify(
      compareAcceptedGoldenSessions({
        baseline: (await baselineFile.json()) as FinalGoldenSessionReport,
        candidate: (await candidateFile.json()) as FinalGoldenSessionReport,
      }),
      null,
      2
    )
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
