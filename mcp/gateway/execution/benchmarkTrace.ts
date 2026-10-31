import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { MODEL_VIEWS } from "../../lib/reference/visualEvidence";

export type BenchmarkTraceKind =
  | "search"
  | "describe"
  | "inspect"
  | "mutate"
  | "verify"
  | "recovery";

export type BenchmarkTraceEvent = {
  schema: "lazydesigner-gateway-benchmark-trace-v1";
  sequence: number;
  task_id: string;
  source_sha: string;
  timestamp: string;
  kind: BenchmarkTraceKind;
  capability: string | null;
  success: boolean;
  latency_ms: number;
  result_bytes: number | null;
  read_only: boolean | null;
  verification_class: string | null;
  /** Optional to keep older v1 benchmark trace files readable. */
  error_code?: string | null;
  /** Opt-in Golden trace only: hashes of actual returned model-view PNGs. */
  capture_evidence?: BenchmarkCaptureEvidence;
};

/** Stable content identity, not visual correctness or image-pixel storage. */
export type BenchmarkCaptureEvidence = {
  project_uuid: string;
  reference_package_fingerprint: string;
  front_direction: "-z" | "+z";
  shading: boolean;
  diagnostic_missing_texture_highlight: boolean;
  views: Array<{ view: string; png_sha256: string }>;
  evidence_ref: string;
};

export function benchmarkCaptureEvidenceRef(
  input: Omit<BenchmarkCaptureEvidence, "evidence_ref">
): string {
  return "golden-capture:v1:" + createHash("sha256").update(JSON.stringify([
    input.project_uuid, input.reference_package_fingerprint,
    input.front_direction, input.shading,
    input.diagnostic_missing_texture_highlight,
    input.views.map(row => [row.view, row.png_sha256]),
  ])).digest("hex");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Only returned PNGs, not a pre-existing path or a tool's claimed digest. */
function captureProofFromResult(
  result: unknown,
  fingerprint: string | null
): BenchmarkCaptureEvidence | null {
  if (!fingerprint) return null;
  const response = recordValue(result);
  const structured = recordValue(response?.structuredContent);
  const project = recordValue(structured?.project);
  const render = recordValue(structured?.render_evidence);
  const captures = structured?.captures;
  const content = response?.content;
  if (!project || typeof project.uuid !== "string" || !project.uuid.trim() ||
      !Array.isArray(captures) || captures.length < 1 ||
      captures.length > 5 || !Array.isArray(content) ||
      (structured?.front_direction !== "-z" &&
       structured?.front_direction !== "+z") ||
      typeof render?.shading !== "boolean" ||
      typeof render.diagnostic_missing_texture_highlight !== "boolean") {
    return null;
  }
  const views: BenchmarkCaptureEvidence["views"] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const candidate of captures) {
    const row = recordValue(candidate);
    const view = row?.view;
    if (typeof view !== "string" ||
        !(MODEL_VIEWS as readonly string[]).includes(view) ||
        seen.has(view)) return null;
    const labelIndex = content.findIndex((item: unknown, index: number) => {
      const label = recordValue(item);
      return index >= cursor &&
        label?.type === "text" && label.text === `VIEW ${view}`;
    });
    const image = labelIndex >= 0 ? recordValue(content[labelIndex + 1]) : null;
    if (!image || image.type !== "image" ||
        image.mimeType !== "image/png" ||
        typeof image.data !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return null;
    const png = Buffer.from(image.data, "base64");
    if (png.length <= 8 ||
        [137,80,78,71,13,10,26,10].some((n,i) => png[i] !== n) ||
        (typeof row?.png_bytes === "number" &&
         row.png_bytes !== png.length)) return null;
    views.push({
      view, png_sha256: createHash("sha256").update(png).digest("hex"),
    });
    seen.add(view);
    cursor = labelIndex + 2;
  }
  const data: Omit<BenchmarkCaptureEvidence, "evidence_ref"> = {
    project_uuid: project.uuid,
    reference_package_fingerprint: fingerprint,
    front_direction: structured!.front_direction as "-z" | "+z",
    shading: render.shading as boolean,
    diagnostic_missing_texture_highlight:
      render.diagnostic_missing_texture_highlight as boolean,
    views,
  };
  return { ...data, evidence_ref: benchmarkCaptureEvidenceRef(data) };
}

type BenchmarkTraceRecorderOptions = {
  path: string;
  taskId: string;
  sourceSha: string;
  referenceFingerprint: string | null;
};

function payloadBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return null;
  }
}

function safeErrorCode(result: unknown): string | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return null;
  const code = (structured as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)
    ? code
    : null;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

export class BenchmarkTraceRecorder {
  private sequence = 0;
  private writeTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly options: BenchmarkTraceRecorderOptions | null
  ) {}

  static fromEnvironment(
    env: Record<string, string | undefined> = process.env
  ): BenchmarkTraceRecorder {
    const path = env.LAZYDESIGNER_BENCHMARK_TRACE_PATH;
    if (!path) return new BenchmarkTraceRecorder(null);

    const taskId = env.LAZYDESIGNER_BENCHMARK_TASK_ID;
    const sourceSha = env.LAZYDESIGNER_BENCHMARK_SOURCE_SHA;
    if (!taskId) {
      throw new Error(
        "LAZYDESIGNER_BENCHMARK_TASK_ID is required when benchmark trace capture is enabled."
      );
    }
    if (!sourceSha || !/^[0-9a-f]{40}$/.test(sourceSha)) {
      throw new Error(
        "LAZYDESIGNER_BENCHMARK_SOURCE_SHA must be an exact 40-character Git SHA when benchmark trace capture is enabled."
      );
    }

    const referenceFingerprint =
      env.LAZYDESIGNER_BENCHMARK_REFERENCE_FINGERPRINT ?? null;
    if (referenceFingerprint !== null &&
        !/^[0-9a-f]{64}$/.test(referenceFingerprint)) {
      throw new Error("LAZYDESIGNER_BENCHMARK_REFERENCE_FINGERPRINT must be a lowercase SHA-256.");
    }
    return new BenchmarkTraceRecorder({
      path, taskId, sourceSha, referenceFingerprint,
    });
  }

  get enabled(): boolean {
    return this.options !== null;
  }

  startedAt(): number {
    return Date.now();
  }

  record(input: {
    startedAt: number;
    kind: BenchmarkTraceKind;
    capability?: string | null;
    success: boolean;
    result?: unknown;
    readOnly?: boolean | null;
    verificationClass?: string | null;
  }): void {
    if (!this.options) return;

    const captured = input.success && input.kind === "verify" &&
      input.capability === "capture_model_views"
      ? captureProofFromResult(input.result, this.options.referenceFingerprint)
      : null;
    const event: BenchmarkTraceEvent = {
      schema: "lazydesigner-gateway-benchmark-trace-v1",
      sequence: this.sequence++,
      task_id: this.options.taskId,
      source_sha: this.options.sourceSha,
      timestamp: new Date().toISOString(),
      kind: input.kind,
      capability: input.capability ?? null,
      success: input.success,
      latency_ms: elapsedMs(input.startedAt),
      result_bytes:
        input.result === undefined ? null : payloadBytes(input.result),
      read_only: input.readOnly ?? null,
      verification_class: input.verificationClass ?? null,
      // Persist bounded error identifiers, never diagnostic messages or paths.
      error_code: input.success ? null : safeErrorCode(input.result),
      ...(captured ? { capture_evidence: captured } : {}),
    };

    const path = this.options.path;
    this.writeTail = this.writeTail
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, JSON.stringify(event) + "\n", "utf8");
      })
      .catch((error) => {
        console.error(
          "[LazyDesigner Gateway] benchmark trace write failed:",
          error instanceof Error ? error.message : String(error)
        );
      });
  }

  async flush(): Promise<void> {
    await this.writeTail;
  }
}
