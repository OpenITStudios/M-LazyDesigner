import type {
  BenchmarkTraceEvent,
  BenchmarkTraceKind,
} from "../../gateway/runtime/benchmarkTrace";

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
    if (event.error_code !== undefined &&
        event.error_code !== null &&
        (typeof event.error_code !== "string" ||
         !/^[A-Z][A-Z0-9_]{0,79}$/.test(event.error_code))) {
      throw new Error(`Trace line ${index + 1} has an invalid error_code.`);
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
  return values.reduce<number>(
    (total, value) => total + (value ?? 0),
    0
  );
}

function count(
  events: readonly BenchmarkTraceEvent[],
  kind: BenchmarkTraceKind
): number {
  return events.filter((event) => event.kind === kind).length;
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

  const failed = ordered.filter((event) => !event.success);
  const failuresByCode: Record<string, number> = {};
  for (const event of failed) {
    if (event.error_code) {
      failuresByCode[event.error_code] = (failuresByCode[event.error_code] ?? 0) + 1;
    }
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