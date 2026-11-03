import { createHash } from "node:crypto";
import {
  compareAcceptedGoldenSessions,
  type FinalGoldenSessionReport,
} from "./compare-golden-sessions";
import { summarizeGatewayBenchmarkTrace } from "./summarize-gateway-benchmark-trace";
import { renderObservabilityHtml } from "./render-observability-report";
import {
  effectiveTotalTokens,
  validateAstraUsageDocument,
  type UsageDocument,
  type UsageRun,
} from "../evaluate/validate-astra-usage";

type Session = {
  final: FinalGoldenSessionReport;
  gatewayTrace: string;
};

type ObservabilityInput = {
  baseline: Session;
  candidate: Session;
  usage: UsageDocument;
};

type PairValue = {
  baseline: number | null;
  candidate: number | null;
  delta_candidate_minus_baseline: number | null;
};

function pair(baseline: number | null, candidate: number | null): PairValue {
  return {
    baseline,
    candidate,
    delta_candidate_minus_baseline:
      baseline !== null && candidate !== null ? candidate - baseline : null,
  };
}

function traceDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sourceEventTotal(run: UsageRun): number | null {
  const events = run.model_events ?? [];
  // Aggregate-only counts cannot establish complete response/compaction coverage.
  if (events.length === 0 ||
      events.some((event) =>
        typeof event.event_id !== "string" || !event.event_id.trim() ||
        typeof event.source !== "string" || !event.source.trim() ||
        !Number.isSafeInteger(event.total_tokens))) return null;
  const total = effectiveTotalTokens(run);
  return total !== null && Number.isSafeInteger(total) ? total : null;
}

type GatewayTraceReport = ReturnType<typeof summarizeGatewayBenchmarkTrace>;

/** Bounded Gateway metadata preview: never infer missing timestamps or a full-session wall time. */
function timelinePreview(report: GatewayTraceReport) {
  const events = report.events;
  const startMs = events.map((event) => {
    if (!event.started_at) return null;
    const time = Date.parse(event.started_at);
    return Number.isFinite(time) ? time : null;
  });
  let earliest: number | null = null;
  let latestEnd: number | null = null;
  let measured = 0;
  for (let index = 0; index < events.length; index += 1) {
    const time = startMs[index];
    if (typeof time !== "number") continue;
    measured++;
    earliest = earliest === null ? time : Math.min(earliest, time);
    const end = time + events[index]!.latency_ms;
    latestEnd = latestEnd === null ? end : Math.max(latestEnd, end);
  }
  const complete = measured === events.length && earliest !== null &&
    latestEnd !== null && Number.isFinite(latestEnd - earliest);
  const span = complete ? latestEnd! - earliest! : null;
  const excerpt = events.length <= 60
    ? events
    : [...events.slice(0, 30), ...events.slice(-30)];
  // The trace parser proves sequence indices are contiguous from zero.
  return {
    total_events: events.length,
    measured_start_events: measured,
    observed_window_ms: span,
    omitted_events: events.length - excerpt.length,
    events: excerpt.map((event) => {
      const time = startMs[event.sequence] ?? null;
      return {
        sequence: event.sequence,
        kind: event.kind,
        capability: event.capability === null
          ? null : event.capability.slice(0, 96),
        success: event.success,
        error_code: event.error_code ?? null,
        latency_ms: event.latency_ms,
        offset_ms: time !== null && earliest !== null ? time - earliest : null,
        queue_wait_ms: event.queue_timing?.queue_wait_ms ?? null,
      };
    }),
  };
}

function matchSession(
  label: "baseline" | "candidate",
  session: Session,
  usage: UsageRun,
) {
  const report = summarizeGatewayBenchmarkTrace(session.gatewayTrace);
  const digest = traceDigest(session.gatewayTrace);
  if (report.task_id !== session.final.task_id ||
      report.source_sha !== session.final.source_sha) {
    throw new Error(
      label + " Gateway trace must match the accepted Golden task_id and source SHA."
    );
  }
  if (usage.task_id !== report.task_id) {
    throw new Error(label + " usage task_id does not match Gateway/Golden evidence.");
  }
  const providedDigest = usage.gateway_trace_sha256;
  if (providedDigest != null && providedDigest !== digest) {
    throw new Error(label + " usage gateway_trace_sha256 does not match the exact NDJSON file.");
  }
  const bound = providedDigest === digest;
  const modelTokens = bound ? sourceEventTotal(usage) : null;
  if (session.final.metrics?.total_tokens !== null &&
      session.final.metrics?.total_tokens !== undefined &&
      modelTokens !== null &&
      session.final.metrics.total_tokens !== modelTokens) {
    throw new Error(label + " Golden token metric conflicts with bound provider events.");
  }
  if (session.final.usage?.total_tokens !== null &&
      session.final.usage?.total_tokens !== undefined &&
      modelTokens !== null &&
      session.final.usage.total_tokens !== modelTokens) {
    throw new Error(label + " Golden usage conflicts with bound provider events.");
  }
  const goldenCorrections = session.final.metrics?.user_corrections;
  if (goldenCorrections != null && usage.user_corrections != null &&
      goldenCorrections !== usage.user_corrections) {
    throw new Error(label + " Golden and normalized usage correction counts disagree.");
  }

  return {
    report,
    digest,
    bound,
    modelTokens,
    completeProviderEvents: modelTokens !== null,
  };
}

/**
 * Offline, fail-closed source comparison. This does not read Codex private
 * session files, install an OTel collector, call a model or change authoring.
 * A trace-file hash binds the supplied normalized usage row to one specific
 * Gateway log. It does not independently authenticate provider/Otel records.
 */
export function compareObservabilitySessions(input: ObservabilityInput) {
  const golden = compareAcceptedGoldenSessions({
    baseline: input.baseline.final,
    candidate: input.candidate.final,
  });
  validateAstraUsageDocument(input.usage);
  if (input.usage.runs.length !== 2) {
    throw new Error("Observability comparison requires exactly one baseline and one zero_waste usage run.");
  }
  const before = input.usage.runs.find((run) => run.variant === "baseline");
  const after = input.usage.runs.find((run) => run.variant === "zero_waste");
  if (!before || !after) {
    throw new Error("Observability comparison requires both usage variants.");
  }
  if (before.quality_verdict === "FAIL" ||
      after.quality_verdict === "FAIL" ||
      before.task_success === false || after.task_success === false ||
      before.accepted_result === false || after.accepted_result === false) {
    throw new Error("Usage quality/success evidence contradicts accepted Golden reports.");
  }

  if (input.usage.source_sha !== null &&
      (input.usage.source_sha !== input.baseline.final.source_sha ||
       input.usage.source_sha !== input.candidate.final.source_sha)) {
    throw new Error("Usage document source_sha must match both runs or be null for a cross-SHA comparison.");
  }
  const baseline = matchSession("baseline", input.baseline, before);
  const candidate = matchSession("candidate", input.candidate, after);
  if (baseline.digest === candidate.digest) {
    throw new Error("Baseline and candidate cannot reuse the same Gateway trace bytes.");
  }

  const model = typeof input.usage.model === "string" &&
    input.usage.model.trim() ? input.usage.model.trim() : null;
  const telemetrySource = typeof input.usage.telemetry_source === "string" &&
    input.usage.telemetry_source.trim() ? input.usage.telemetry_source.trim() : null;
  for (const [label, session] of [
    ["baseline", input.baseline],
    ["candidate", input.candidate],
  ] as const) {
    const provenModel = session.final.usage?.model?.trim();
    if (model && provenModel && model !== provenModel) {
      throw new Error(label + " Golden model conflicts with the supplied provider model.");
    }
  }
  const correctionPair = pair(before.user_corrections, after.user_corrections);
  const hasCorrectionRegression = correctionPair.delta_candidate_minus_baseline !== null &&
    correctionPair.delta_candidate_minus_baseline > 0;
  const qualityMatched = before.quality_verdict === "PASS" &&
    after.quality_verdict === "PASS" &&
    before.task_success === true && after.task_success === true &&
    before.accepted_result === true && after.accepted_result === true;
  const crossModel = golden.model_pair.state === "CROSS_MODEL";
  const usageComparable = baseline.bound && candidate.bound &&
    baseline.completeProviderEvents && candidate.completeProviderEvents &&
    model !== null && telemetrySource !== null && !crossModel &&
    correctionPair.delta_candidate_minus_baseline !== null &&
    !hasCorrectionRegression && qualityMatched;

  const tokenPair = pair(
    usageComparable ? baseline.modelTokens : null,
    usageComparable ? candidate.modelTokens : null
  );

  const decision = hasCorrectionRegression
    ? "CORRECTION_REGRESSION"
    : usageComparable
      ? tokenPair.delta_candidate_minus_baseline! < 0
        ? "MEASURED_TOKEN_REDUCTION"
        : "NO_MEASURED_TOKEN_REDUCTION"
      : "INSUFFICIENT_LINKED_USAGE_EVIDENCE";

  const evidenceGaps: string[] = [];
  for (const [label, report] of [
    ["BASELINE", baseline.report], ["CANDIDATE", candidate.report],
  ] as const) {
    if (report.events.some((event) => !event.started_at)) {
      evidenceGaps.push(label + "_TIMELINE_START_PARTIAL");
    }
    if (report.queue_timing.unmeasured_events > 0) {
      evidenceGaps.push(label + "_QUEUE_DETAIL_PARTIAL");
    }
    if (report.mcp_images.unmeasured_events > 0) {
      evidenceGaps.push(label + "_IMAGE_DELIVERY_PARTIAL");
    }
  }
  if (!usageComparable) evidenceGaps.push("PROVIDER_USAGE_COMPARISON_UNVERIFIED");
  if (crossModel) evidenceGaps.push("MODEL_IDENTITY_MISMATCH");
  const investigativeFindings = [
    ...baseline.report.diagnostics.findings,
    ...candidate.report.diagnostics.findings,
  ];
  const feedbackChecks = [
    ...(decision === "CORRECTION_REGRESSION"
      ? ["REVIEW_CORRECTIONS_BEFORE_ANY_PROMOTION"] : []),
    ...(decision === "MEASURED_TOKEN_REDUCTION"
      ? ["REVIEW_SUBMITTED_EVENT_COVERAGE_BEFORE_CLAIMING_SESSION_SAVINGS"] : []),
    ...(decision === "NO_MEASURED_TOKEN_REDUCTION"
      ? ["DO_NOT_PROMOTE_FOR_TOKEN_SAVINGS_ALONE"] : []),
    ...(!usageComparable ? ["VERIFY_EXPLICIT_PROVIDER_EXPORT_AND_EXACT_TRACE_BINDINGS"] : []),
    ...(investigativeFindings.some((finding) => finding.code === "REPEATED_ERROR_CODE")
      ? ["INSPECT_ERROR_CONTEXT_BEFORE_RETRY"] : []),
    ...(investigativeFindings.some((finding) => finding.code === "QUEUE_WAIT_OUTWEIGHS_OPERATION")
      ? ["INVESTIGATE_QUEUE_PRESSURE_WITHOUT_CHANGING_MUTATION_ORDER"] : []),
  ].slice(0, 6);

  return {
    schema: 1,
    report: "observability-session-comparison",
    proof_scope: "OFFLINE_CORRELATED_EVIDENCE",
    task_id: golden.task_id,
    quality_gate: golden.quality_gate,
    source_sha: {
      baseline: input.baseline.final.source_sha,
      candidate: input.candidate.final.source_sha,
    },
    gateway: {
      inspection: {
        baseline: {
          timeline: timelinePreview(baseline.report),
          findings: baseline.report.diagnostics.findings,
          hotspots: baseline.report.diagnostics.top_capabilities_by_observed_latency,
        },
        candidate: {
          timeline: timelinePreview(candidate.report),
          findings: candidate.report.diagnostics.findings,
          hotspots: candidate.report.diagnostics.top_capabilities_by_observed_latency,
        },
      },
      baseline_trace_sha256: baseline.digest,
      candidate_trace_sha256: candidate.digest,
      exact_file_binding: { baseline: baseline.bound, candidate: candidate.bound },
      client_parented_events: {
        baseline: baseline.report.correlation.client_parented_events,
        candidate: candidate.report.correlation.client_parented_events,
      },
      calls: pair(baseline.report.calls.total, candidate.report.calls.total),
      latency_sum_ms: pair(
        baseline.report.latency.total_ms, candidate.report.latency.total_ms
      ),
      response_bytes: pair(
        baseline.report.payload.result_bytes, candidate.report.payload.result_bytes
      ),
      delivered_image_bytes: pair(
        baseline.report.mcp_images.delivered_bytes,
        candidate.report.mcp_images.delivered_bytes
      ),
      queue_wait_ms: pair(
        baseline.report.queue_timing.observed_queue_wait_ms,
        candidate.report.queue_timing.observed_queue_wait_ms
      ),
      coverage: {
        baseline: {
          calls: baseline.report.calls.total,
          timed_queue_events: baseline.report.queue_timing.measured_events,
          image_measured_events: baseline.report.mcp_images.measured_events,
        },
        candidate: {
          calls: candidate.report.calls.total,
          timed_queue_events: candidate.report.queue_timing.measured_events,
          image_measured_events: candidate.report.mcp_images.measured_events,
        },
      },
    },
    provider: {
      token_scope: "SUBMITTED_SOURCE_EVENTS_ONLY",
      source_attested: telemetrySource !== null,
      model_known: model !== null,
      complete_response_events: {
        baseline: baseline.completeProviderEvents,
        candidate: candidate.completeProviderEvents,
      },
      token_claim_available: usageComparable,
      total_tokens: tokenPair,
      user_corrections: correctionPair,
    },
    decision,
    feedback: {
      scope: "OFFLINE_VERIFICATION_AND_REVIEW_ONLY",
      disposition: decision === "CORRECTION_REGRESSION"
        ? "REJECT_CANDIDATE" as const
        : decision === "MEASURED_TOKEN_REDUCTION"
          ? "REVIEW_CANDIDATE" as const
          : "HOLD_OR_NO_EFFICIENCY_GAIN" as const,
      evidence_gaps: evidenceGaps,
      recommended_checks: feedbackChecks,
      never_auto_promote: true as const,
    },
    limitations:
      "Exact Gateway file SHA binds normalized usage to a selected run, but does not authenticate Codex-exported records, prove all client response events were submitted, or establish continuous W3C client-to-Runtime tracing. Quality is supplied by accepted Golden reports. Summed Gateway call durations are not elapsed wall time; partial queue/image coverage remains partial. No API price, Codex allowance savings, or causal optimization winner is inferred.",
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const html = args.length === 6 && args[5] === "--html";
  if (args.length !== 5 && !html) {
    throw new Error(
      "Usage: bun run compare:observability -- <baseline-final.json> <candidate-final.json> <baseline-trace.ndjson> <candidate-trace.ndjson> <normalized-usage.json> [--html]"
    );
  }
  const files = args.slice(0, 5).map((path) => Bun.file(path));
  for (let index = 0; index < files.length; index++) {
    if (!(await files[index]!.exists())) {
      throw new Error("Comparison input missing at index " + index + ".");
    }
  }
  const [baselineFinal, candidateFinal, baselineTrace, candidateTrace, usage] =
    await Promise.all([
      files[0]!.json(), files[1]!.json(),
      files[2]!.text(), files[3]!.text(), files[4]!.json(),
    ]);
  const report = compareObservabilitySessions({
    baseline: { final: baselineFinal as FinalGoldenSessionReport, gatewayTrace: baselineTrace },
    candidate: { final: candidateFinal as FinalGoldenSessionReport, gatewayTrace: candidateTrace },
    usage: usage as UsageDocument,
  });
  // Read-only stdout output: the caller may save a local HTML file explicitly.
  console.log(html ? renderObservabilityHtml(report) : JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
