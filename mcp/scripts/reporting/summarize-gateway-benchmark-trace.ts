import type {
  BenchmarkTraceEvent,
  BenchmarkTraceKind,
} from "../../gateway/runtime/benchmarkTrace";

// The report is a consumer of a recorded trace, never a validator of
// artistic quality. Unknown/malformed event kinds cannot be silently
// omitted from the per-kind totals.
const TRACE_KINDS: readonly BenchmarkTraceKind[] = [
  "search", "describe", "inspect", "mutate", "verify", "recovery",
];

function parseTrace(text: string): BenchmarkTraceEvent[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Benchmark trace is empty.");
  }

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Trace line ${index + 1} is not valid JSON.`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Trace line ${index + 1} must be an object.`);
    }
    const event = parsed as BenchmarkTraceEvent;
    if (event.schema !== "lazydesigner-gateway-benchmark-trace-v1") {
      throw new Error(`Trace line ${index + 1} has an unsupported schema.`);
    }
    if (!Number.isInteger(event.sequence) || event.sequence < 0) {
      throw new Error(`Trace line ${index + 1} has an invalid sequence.`);
    }
    if (typeof event.task_id !== "string" || event.task_id.length === 0) {
      throw new Error(`Trace line ${index + 1} has an invalid task_id.`);
    }
    if (!/^[0-9a-f]{40}$/.test(event.source_sha)) {
      throw new Error(`Trace line ${index + 1} has an invalid source_sha.`);
    }
    if (!Number.isFinite(event.latency_ms) || event.latency_ms < 0) {
      throw new Error(`Trace line ${index + 1} has an invalid latency_ms.`);
    }
    if (typeof event.success !== "boolean") {
      throw new Error(`Trace line ${index + 1} has an invalid success flag.`);
    }
    if (!TRACE_KINDS.includes(event.kind)) {
      throw new Error(`Trace line ${index + 1} has an invalid kind.`);
    }
    if (event.result_bytes !== null &&
        (!Number.isSafeInteger(event.result_bytes) || event.result_bytes < 0)) {
      // Missing, negative, fractional or string payload sizes must not be
      // counted as measured bytes or become NaN in summary calculations.
      throw new Error(`Trace line ${index + 1} has invalid result_bytes.`);
    }
    if (typeof event.timestamp !== "string" ||
        !Number.isFinite(Date.parse(event.timestamp))) {
      throw new Error(`Trace line ${index + 1} has an invalid timestamp.`);
    }
    if (event.mcp_images !== undefined && event.mcp_images !== null) {
      const row = event.mcp_images;
      const fields = [
        row.delivered_count, row.delivered_bytes,
        row.png_count, row.png_bytes,
      ];
      if (fields.some(n => !Number.isSafeInteger(n) || n < 0) ||
          row.png_count > row.delivered_count ||
          row.png_bytes > row.delivered_bytes ||
          (row.delivered_count === 0 && row.delivered_bytes !== 0) ||
          (row.png_count === 0 && row.png_bytes !== 0)) {
        throw new Error(`Trace line ${index + 1} has invalid MCP image metrics.`);
      }
    }
    if (event.started_at !== undefined &&
        (typeof event.started_at !== "string" ||
         !Number.isFinite(Date.parse(event.started_at)))) {
      throw new Error(`Trace line ${index + 1} has invalid start time.`);
    }
    if (event.correlation !== undefined) {
      const c = event.correlation;
      if (!c || !/^[0-9a-f]{32}$/.test(c.trace_id) ||
          /^0+$/.test(c.trace_id) ||
          !/^[0-9a-f]{16}$/.test(c.span_id) || /^0+$/.test(c.span_id) ||
          (c.parent_span_id !== null &&
           (!/^[0-9a-f]{16}$/.test(c.parent_span_id) ||
            /^0+$/.test(c.parent_span_id))) ||
          (c.origin !== "CLIENT_TRACEPARENT" && c.origin !== "GATEWAY_LOCAL") ||
          (c.task_context_ref !== null &&
           !/^[0-9a-f]{64}$/.test(c.task_context_ref)) ||
          (c.cohort_boundary !== null && c.cohort_boundary !== "CONTINUE" &&
           c.cohort_boundary !== "COMPLETE")) {
        throw new Error(`Trace line ${index + 1} has invalid correlation.`);
      }
    }
    if (event.queue_timing !== undefined && event.queue_timing !== null) {
      const q = event.queue_timing;
      if (!Number.isFinite(q.queue_wait_ms) || q.queue_wait_ms < 0 ||
          !Number.isFinite(q.operation_duration_ms) || q.operation_duration_ms < 0) {
        throw new Error(`Trace line ${index + 1} has invalid queue timing.`);
      }
    }
    if (event.error_code !== undefined &&
        event.error_code !== null &&
        (typeof event.error_code !== "string" ||
         !/^[A-Z][A-Z0-9_]{0,79}$/.test(event.error_code))) {
      throw new Error(`Trace line ${index + 1} has an invalid error_code.`);
    }
    if (event.success && event.error_code != null) {
      // The Gateway's opt-in trace recorder always stores null for successful
      // operations. Contradictory rows must not enter failure classification.
      throw new Error(`Trace line ${index + 1} has error_code on a successful event.`);
    }
    return event;
  });
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)] ?? null;
}

function sum(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>(
    (total, value) => total + (value ?? 0),
    0
  );
  // Many individually safe sizes can overflow a JS exact integer when
  // aggregated; report unknown instead of an imprecise efficiency claim.
  return Number.isSafeInteger(total) ? total : null;
}

function count(
  events: readonly BenchmarkTraceEvent[],
  kind: BenchmarkTraceKind
): number {
  return events.filter((event) => event.kind === kind).length;
}

type ErrorGroupingBasis = "TASK_CONTEXT_HASH" | "TRACE_ID" | "LEGACY_UNSCOPED";

/**
 * Preserve correlation boundaries without persisting new identities.
 * A task context takes precedence over a trace ID: a single client trace
 * may span multiple Control tasks. With no task context, a trace is only
 * an observational grouping. Historical rows without correlation form
 * their own unscoped, investigative-only cohort.
 */
function failureCorrelationScope(
  event: BenchmarkTraceEvent
): { key: string; basis: ErrorGroupingBasis } {
  const correlation = event.correlation;
  if (correlation?.task_context_ref) {
    return {
      key: "context:" + correlation.task_context_ref,
      basis: "TASK_CONTEXT_HASH",
    };
  }
  if (correlation) {
    return { key: "trace:" + correlation.trace_id, basis: "TRACE_ID" };
  }
  return { key: "legacy:unscoped", basis: "LEGACY_UNSCOPED" };
}

/**
 * Offline *code-label* classification, not a second Gateway recovery policy.
 * The trace omits receipt_issue, safeToRetry and native outcome evidence.
 * In particular BACKEND_UNAVAILABLE can mean an offline Runtime OR a
 * mutation that occurred before its authority receipt was rejected.
 */
type RecordedFailureClass =
  | "NATIVE_OUTCOME_UNCERTAIN"
  | "READ_TRANSPORT_INTERRUPTED"
  | "PROJECT_AFFINITY_LOST"
  | "CAPABILITY_PRECONDITION_BLOCKED"
  | "CAPABILITY_NOT_FOUND"
  | "QUEUE_PRE_EXECUTION"
  | "REFERENCE_CONSTRAINT"
  | "BACKEND_UNAVAILABLE_AMBIGUOUS"
  | "OTHER_UNCLASSIFIED";

function recordedFailureClass(code: string | null | undefined): RecordedFailureClass {
  switch (code) {
    case "OUTCOME_UNKNOWN":
      return "NATIVE_OUTCOME_UNCERTAIN";
    case "BACKEND_CALL_INTERRUPTED":
      return "READ_TRANSPORT_INTERRUPTED";
    case "PROJECT_CONTEXT_LOST":
      return "PROJECT_AFFINITY_LOST";
    case "CAPABILITY_PRECONDITION_BLOCKED":
      return "CAPABILITY_PRECONDITION_BLOCKED";
    case "CAPABILITY_NOT_FOUND":
      return "CAPABILITY_NOT_FOUND";
    case "GATEWAY_BUSY":
    case "GATEWAY_QUEUE_EXPIRED":
    case "GATEWAY_QUEUE_CANCELLED":
      return "QUEUE_PRE_EXECUTION";
    case "BACKEND_UNAVAILABLE":
      return "BACKEND_UNAVAILABLE_AMBIGUOUS";
    default:
      return code?.startsWith("REFERENCE_")
        ? "REFERENCE_CONSTRAINT" : "OTHER_UNCLASSIFIED";
  }
}

export function summarizeGatewayBenchmarkTrace(text: string) {
  const events = parseTrace(text);
  const taskIds = new Set(events.map((event) => event.task_id));
  const sourceShas = new Set(events.map((event) => event.source_sha));
  if (taskIds.size !== 1) {
    throw new Error("Benchmark trace must contain exactly one task_id.");
  }
  if (sourceShas.size !== 1) {
    throw new Error("Benchmark trace must contain exactly one source_sha.");
  }

  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index]!.sequence !== index) {
      throw new Error(
        `Benchmark trace sequence must be contiguous from 0; expected ${index}.`
      );
    }
  }

  const correlated = ordered.filter((event) => event.correlation != null);
  const spanKeys = correlated.map((event) =>
    event.correlation!.trace_id + ":" + event.correlation!.span_id);
  if (new Set(spanKeys).size !== spanKeys.length) {
    throw new Error("Trace correlation contains duplicate span IDs.");
  }
  const measuredQueue = ordered.flatMap((event) =>
    event.queue_timing ? [event.queue_timing] : []);
  const queueWaits = measuredQueue.map((t) => t.queue_wait_ms);
  const queueDurations = measuredQueue.map((t) => t.operation_duration_ms);
  // Advisory analysis of existing Gateway metadata; not a quality evaluator.
  const capabilityRows = new Map<string, {
    calls: number; failures: number; latencies: number[];
    responseBytes: number; allBytesKnown: boolean;
  }>();
  const repeatedErrors = new Map<string, {
    capability: string; error_code: string;
    grouping_basis: ErrorGroupingBasis;
    sequences: number[];
  }>();
  for (const event of ordered) {
    if (typeof event.capability !== "string" || !event.capability) continue;
    const row = capabilityRows.get(event.capability) ?? {
      calls: 0, failures: 0, latencies: [], responseBytes: 0,
      allBytesKnown: true,
    };
    row.calls++;
    if (!event.success) row.failures++;
    row.latencies.push(event.latency_ms);
    if (event.result_bytes === null) row.allBytesKnown = false;
    else row.responseBytes += event.result_bytes;
    capabilityRows.set(event.capability, row);
    if (!event.success && event.error_code) {
      const scope = failureCorrelationScope(event);
      const key = JSON.stringify([
        event.capability, event.error_code, scope.key,
      ]);
      const group = repeatedErrors.get(key) ?? {
        capability: event.capability,
        error_code: event.error_code,
        grouping_basis: scope.basis,
        sequences: [],
      };
      group.sequences.push(event.sequence);
      repeatedErrors.set(key, group);
    }
  }
  const topCapabilities = [...capabilityRows.entries()].map(([capability, row]) => ({
    capability,
    calls: row.calls,
    failures: row.failures,
    observed_latency_sum_ms: row.latencies.reduce((sum, n) => sum + n, 0),
    latency_p95_ms: percentile(row.latencies, 0.95),
    response_bytes: row.allBytesKnown && Number.isSafeInteger(row.responseBytes)
      ? row.responseBytes : null,
  })).sort((a, b) =>
    b.observed_latency_sum_ms - a.observed_latency_sum_ms ||
    a.capability.localeCompare(b.capability)
  ).slice(0, 5);

  const findings: Array<{
    code: "REPEATED_ERROR_CODE" | "QUEUE_WAIT_OUTWEIGHS_OPERATION";
    disposition: "INVESTIGATE_ONLY";
    capability: string | null;
    error_code: string | null;
    /** Only present for correlated repeat-error groups, never invented for legacy. */
    grouping_basis?: "TASK_CONTEXT_HASH" | "TRACE_ID";
    observed_events: number;
    example_sequences: number[];
  }> = [...repeatedErrors.values()]
    .filter((row) => row.sequences.length >= 2)
    .sort((a, b) =>
      b.sequences.length - a.sequences.length ||
      a.sequences[0]! - b.sequences[0]!
    )
    .slice(0, 3).map((row) => ({
      code: "REPEATED_ERROR_CODE" as const,
      disposition: "INVESTIGATE_ONLY" as const,
      capability: row.capability,
      error_code: row.error_code,
      ...(row.grouping_basis === "LEGACY_UNSCOPED"
        ? {} : { grouping_basis: row.grouping_basis }),
      observed_events: row.sequences.length,
      example_sequences: row.sequences.slice(0, 6),
    }));
  const queueCandidates = ordered.filter((event) => {
    const timing = event.queue_timing;
    return timing != null && timing.queue_wait_ms >= 10 &&
      timing.queue_wait_ms > timing.operation_duration_ms;
  });
  if (measuredQueue.length >= 3 && queueCandidates.length >= 2) {
    findings.push({
      code: "QUEUE_WAIT_OUTWEIGHS_OPERATION",
      disposition: "INVESTIGATE_ONLY",
      capability: null, error_code: null,
      observed_events: queueCandidates.length,
      example_sequences: queueCandidates.slice(0, 6).map((e) => e.sequence),
    });
  }
  const failed = ordered.filter((event) => !event.success);
  const failuresByCode: Record<string, number> = {};
  const failureClasses: Partial<Record<RecordedFailureClass, number>> = {};
  for (const event of failed) {
    if (event.error_code) {
      failuresByCode[event.error_code] = (failuresByCode[event.error_code] ?? 0) + 1;
    }
    const failureClass = recordedFailureClass(event.error_code);
    failureClasses[failureClass] = (failureClasses[failureClass] ?? 0) + 1;
  }
  const latencies = ordered.map((event) => event.latency_ms);
  const knownMedia = ordered.filter(event => event.mcp_images != null);
  const allMediaKnown = knownMedia.length === ordered.length;
  const mediaSum = (key: keyof NonNullable<BenchmarkTraceEvent["mcp_images"]>) =>
    allMediaKnown
      ? knownMedia.reduce((total, event) => total + event.mcp_images![key], 0)
      : null;
  return {
    schema: 1,
    report: "gateway-benchmark-trace",
    proof_scope:
      "Objective Gateway execution metadata only. This report does not prove accepted-result quality, reference fidelity, or live visual correctness.",
    task_id: ordered[0]!.task_id,
    source_sha: ordered[0]!.source_sha,
    calls: {
      total: ordered.length,
      search: count(ordered, "search"),
      describe: count(ordered, "describe"),
      inspect: count(ordered, "inspect"),
      mutate: count(ordered, "mutate"),
      verify: count(ordered, "verify"),
      recovery: count(ordered, "recovery"),
      failed: failed.length,
    },
    payload: {
      result_bytes: sum(ordered.map((event) => event.result_bytes)),
    },
    correlation: {
      measured_events: correlated.length,
      unmeasured_events: ordered.length - correlated.length,
      trace_count: new Set(correlated.map((event) => event.correlation!.trace_id)).size,
      client_parented_events: correlated.filter((event) =>
        event.correlation!.origin === "CLIENT_TRACEPARENT").length,
      scoped_context_events: correlated.filter((event) =>
        event.correlation!.task_context_ref !== null).length,
    },
    queue_timing: {
      measured_events: measuredQueue.length,
      unmeasured_events: ordered.length - measuredQueue.length,
      observed_queue_wait_ms: measuredQueue.length
        ? queueWaits.reduce((sum, value) => sum + value, 0) : null,
      queue_wait_p50_ms: percentile(queueWaits, 0.5),
      queue_wait_p95_ms: percentile(queueWaits, 0.95),
      operation_duration_p95_ms: percentile(queueDurations, 0.95),
      note: "Observed native-queue admissions only. Duration includes Gateway connection/catalog/preflight; not pure Blockbench execution. Missing measurements are unknown, not zero.",
    },
    mcp_images: {
      measured_events: knownMedia.length,
      unmeasured_events: ordered.length - knownMedia.length,
      delivered_count: mediaSum("delivered_count"),
      delivered_bytes: mediaSum("delivered_bytes"),
      png_count: mediaSum("png_count"),
      png_bytes: mediaSum("png_bytes"),
      note: "Actual Gateway response image-content bytes only. Unmeasured historical/invalid events return null; image counts are not AI-ingestion, token, latency or visual-acceptance proof.",
    },
    failures: {
      by_code: failuresByCode,
      unclassified: failed.filter((event) => !event.error_code).length,
    },
    latency: {
      total_ms: latencies.reduce((total, latency) => total + latency, 0),
      max_ms: Math.max(...latencies),
      p50_ms: percentile(latencies, 0.5),
      p95_ms: percentile(latencies, 0.95),
    },
    capabilities: [...new Set(
      ordered
        .map((event) => event.capability)
        .filter((value): value is string => value !== null)
    )],
    diagnostics: {
      scope: "RECORDED_GATEWAY_EVENTS_ONLY",
      interpretation: "Observed tool latency is summed across calls, not wall time. Repeated errors are grouped within matching Control task-context hashes, or trace IDs when context is unavailable; historical unscoped events remain exploratory and are never merged with correlated events. Findings require investigation and do not prove a common root cause, waste, provider token usage or quality acceptance.",
      top_capabilities_by_observed_latency: topCapabilities,
      findings: findings.slice(0, 4),
      failure_evidence: {
        scope: "RECORDED_ERROR_CODES_ONLY_NO_NATIVE_RECEIPT_DETAILS" as const,
        by_class: failureClasses,
        ambiguous_or_unclassified_events:
          (failureClasses.BACKEND_UNAVAILABLE_AMBIGUOUS ?? 0) +
          (failureClasses.OTHER_UNCLASSIFIED ?? 0),
        interpretation: "These groups classify recorded error identifiers only. BACKEND_UNAVAILABLE may represent offline transport or an incomplete native authority receipt; trace data cannot distinguish them. No retry permission, root-cause inference, executed mutation outcome, accepted quality or native visual proof is derived.",
      },
      accepted_result: "UNVERIFIED",
      provider_token_usage: null,
    },
    events: ordered,
  };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    throw new Error(
      "Usage: bun run report:gateway-trace -- <gateway-trace.ndjson>"
    );
  }
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Trace file not found: ${path}`);
  console.log(
    JSON.stringify(summarizeGatewayBenchmarkTrace(await file.text()), null, 2)
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}