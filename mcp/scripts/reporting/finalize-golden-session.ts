import {
  summarizeGoldenAuthoringDocument,
  validateGoldenAuthoringDocument,
  type GoldenAuthoringDocument,
} from "./evaluate-golden-authoring-runs";
import {
  effectiveTotalTokens,
  validateAstraUsageDocument,
  type UsageDocument,
  type UsageRun,
  type Variant,
} from "../evaluate/validate-astra-usage";

function matchingUsageRun(
  document: UsageDocument,
  taskId: string,
  variant: Variant
): UsageRun | null {
  const matches = document.runs.filter(
    (run) => run.task_id === taskId && run.variant === variant
  );
  if (matches.length > 1) {
    throw new Error(
      `Astra usage contains duplicate ${variant} runs for task ${taskId}.`
    );
  }
  return matches[0] ?? null;
}

export function finalizeGoldenSession(input: {
  golden: GoldenAuthoringDocument;
  usage?: UsageDocument;
  usageVariant?: Variant;
}) {
  validateGoldenAuthoringDocument(input.golden);
  if (input.golden.runs.length !== 1) {
    throw new Error(
      "Golden session finalizer expects exactly one run document."
    );
  }

  const run = input.golden.runs[0]!;
  const accepted =
    run.quality_verdict === "PASS" && run.accepted_result === true;

  const goldenSummary = summarizeGoldenAuthoringDocument(input.golden);
  const unresolvedDecisionLabels = run.trace.filter(
    (event) => event.required_for_decision === null
  ).length;
  const unresolvedAcceptanceEvidence = run.acceptance_evidence.filter(
    (entry) => entry.verdict !== "PASS" || entry.evidence_ref === null
  ).length;

  let usage: null | {
    variant: Variant;
    model: string | null;
    telemetry_source: string | null;
    total_tokens: number | null;
    calls_total: number | null;
    user_corrections: number | null;
  } = null;

  if (input.usage) {
    validateAstraUsageDocument(input.usage);
    if (
      input.usage.source_sha !== null &&
      input.usage.source_sha !== run.source_sha
    ) {
      throw new Error(
        `Astra usage source_sha ${input.usage.source_sha} does not match golden run ${run.source_sha}.`
      );
    }
    // Incomplete sessions may retain partial/unknown telemetry, but an
    // accepted quality claim must not combine run metrics with telemetry
    // lacking the same exact installed-source SHA and live proof scope.
    if (accepted && (input.usage.source_sha !== run.source_sha ||
        input.usage.proof_scope !== "LIVE_BLOCKBENCH")) {
      throw new Error(
        "Accepted Golden usage requires exact matching source_sha and LIVE_BLOCKBENCH proof."
      );
    }

    // The Golden run and client/provider telemetry must describe the same
    // model. A mismatched model label would make a valid run look like Sol/Astra.
    if (run.model !== null && input.usage.model !== null &&
        run.model.trim() !== input.usage.model.trim()) {
      throw new Error("Golden run model identity conflicts with usage telemetry model.");
    }

    const variant = input.usageVariant ?? "zero_waste";
    const usageRun = matchingUsageRun(input.usage, run.task_id, variant);
    if (!usageRun) {
      throw new Error(
        `Astra usage has no ${variant} run for task ${run.task_id}.`
      );
    }

    if (accepted) {
      if (
        usageRun.quality_verdict !== "PASS" ||
        usageRun.task_success !== true ||
        usageRun.accepted_result !== true
      ) {
        throw new Error(
          "Accepted golden run requires matching Astra usage to also be PASS, successful, and accepted."
        );
      }
    }

    const usageTotal = effectiveTotalTokens(usageRun);
    const goldenTotal = run.token_usage?.total_tokens ?? null;
    if (usageTotal !== null && goldenTotal !== null && usageTotal !== goldenTotal) {
      throw new Error("Golden run total_tokens conflicts with usage telemetry total_tokens.");
    }

    usage = {
      variant,
      model: input.usage.model,
      telemetry_source: input.usage.telemetry_source,
      total_tokens: usageTotal,
      calls_total: usageRun.calls.total,
      user_corrections: usageRun.user_corrections,
    };
  }

  return {
    schema: 1,
    report: "golden-session-final",
    task_id: run.task_id,
    source_sha: run.source_sha,
    proof_scope: run.proof_scope,
    state: accepted ? "ACCEPTED" : "INCOMPLETE",
    quality_verdict: run.quality_verdict,
    accepted_result: run.accepted_result,
    pipeline_provenance: run.pipeline_provenance,
    unresolved: {
      decision_labels: unresolvedDecisionLabels,
      acceptance_evidence: unresolvedAcceptanceEvidence,
    },
    metrics:
      accepted
        ? goldenSummary.runs[0]!.metrics
        : null,
    usage,
    rule:
      "Final efficiency metrics exist only after exact-SHA accepted quality evidence, complete end-to-end pipeline provenance, and complete decision labels. Optional token telemetry must match the same task and source SHA.",
  };
}

async function main(): Promise<void> {
  const goldenPath = process.argv[2];
  const usagePath = process.argv[3];
  const variant = process.argv[4] as Variant | undefined;

  if (!goldenPath) {
    throw new Error(
      "Usage: bun run finalize:golden-session -- <golden-run.json> [astra-usage.json] [baseline|zero_waste]"
    );
  }

  const goldenFile = Bun.file(goldenPath);
  if (!(await goldenFile.exists())) {
    throw new Error(`Golden run file not found: ${goldenPath}`);
  }
  const golden = (await goldenFile.json()) as GoldenAuthoringDocument;

  let usage: UsageDocument | undefined;
  if (usagePath) {
    const usageFile = Bun.file(usagePath);
    if (!(await usageFile.exists())) {
      throw new Error(`Astra usage file not found: ${usagePath}`);
    }
    usage = (await usageFile.json()) as UsageDocument;
  }

  console.log(
    JSON.stringify(
      finalizeGoldenSession({
        golden,
        ...(usage ? { usage } : {}),
        ...(variant ? { usageVariant: variant } : {}),
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