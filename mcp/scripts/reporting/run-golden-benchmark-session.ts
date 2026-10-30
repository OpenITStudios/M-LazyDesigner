import { mkdir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import goldenCorpus from "../../tests/fixtures/golden-task-cases.json";
import {
  summarizeGatewayBenchmarkTrace,
} from "./summarize-gateway-benchmark-trace";
import type {
  GoldenAuthoringDocument,
  GoldenTraceEvent,
} from "./evaluate-golden-authoring-runs";
import type { BenchmarkTraceEvent } from "../../gateway/runtime/benchmarkTrace";
import { LiveMcpClient, structuredObject } from "../verify/live-e2e-common";
import { readReferencePackageProjection } from "../../gateway/control/referencePackage";

type GoldenTask = (typeof goldenCorpus.tasks)[number];

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL("../../../workspace/", import.meta.url)));
const MCP_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const FIXTURE_ROOT = resolve(MCP_ROOT, "tests/fixtures/golden/full-asset");

function fixtureSourcePath(path: string): string {
  const absolute = resolve(MCP_ROOT, path);
  const rel = relative(FIXTURE_ROOT, absolute);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("Golden benchmark source must remain within its dedicated fixture directory.");
  }
  return absolute;
}

/** Reject production project data at the benchmark boundary; live caller resolves symlinks. */
export function assertGoldenDisposablePath(path: string, workspaceRoot = WORKSPACE_ROOT): void {
  const rel = relative(workspaceRoot, resolve(path));
  if (!rel || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))) {
    throw new Error("Golden benchmark refuses repository workspace assets; use a fresh disposable seed.");
  }
}

/** One existing runner preflight; do not create another model validator or engine. */
export function validateGoldenSeedContent(task: GoldenTask, value: unknown): void {
  if (task.seed_kind !== "BLANK_DISPOSABLE" || task.start_stage !== "geometry") {
    throw new Error("Golden full-asset task requires a blank Geometry seed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Golden seed must be a Blockbench JSON object.");
  }
  const model = value as Record<string, unknown>;
  const meta = model.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta) ||
      (meta as Record<string, unknown>).model_format !== "bedrock" ||
      typeof (meta as Record<string, unknown>).format_version !== "string") {
    throw new Error("Golden seed requires Bedrock .bbmodel metadata.");
  }
  for (const key of ["elements", "groups", "outliner", "textures", "animations"] as const) {
    if (!Array.isArray(model[key]) || (model[key] as unknown[]).length !== 0) {
      throw new Error("Golden full-asset seed must be blank: " + key);
    }
  }
}

/** Same immutable source seed for all baseline/candidate arms, never a historical model. */
export async function assertCanonicalGoldenSeed(task: GoldenTask, inputPath: string): Promise<void> {
  const canonical = fixtureSourcePath(task.fixture.seed_path);
  const [canonicalBytes, incomingBytes] = await Promise.all([
    readFile(canonical), readFile(inputPath),
  ]);
  validateGoldenSeedContent(task, JSON.parse(canonicalBytes.toString("utf8")));
  validateGoldenSeedContent(task, JSON.parse(incomingBytes.toString("utf8")));
  const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  if (digest(canonicalBytes) !== digest(incomingBytes)) {
    throw new Error("Golden starting model must match the canonical fresh fixture seed bytes.");
  }
}

/** Consume Control's existing Reference Package read/integrity, not another reference engine. */
export async function requireGoldenReferenceReady(task: GoldenTask) {
  const source = fixtureSourcePath(task.fixture.reference_package_path);
  const projection = await readReferencePackageProjection(source);
  const raw = JSON.parse(await readFile(source, "utf8")) as {
    approval?: { brief?: string; visual_authority?: string; package_generation?: string };
    unknowns?: { blocking?: string[] };
  };
  if (!projection.available || !projection.fingerprint) {
    throw new Error("Golden Reference Package is missing or invalid.");
  }
  const approval = raw.approval;
  if (approval?.brief !== "APPROVED" || approval.visual_authority !== "APPROVED" ||
      approval.package_generation !== "APPROVED" ||
      raw.unknowns?.blocking?.length ||
      projection.readiness.overall !== "READY" ||
      projection.readiness.geometry !== "READY" ||
      projection.readiness.texture !== "READY" ||
      projection.readiness.animation !== "READY") {
    throw new Error("Golden reference requires explicit visual approval and stage readiness.");
  }
  if (projection.images.length === 0 || !projection.images.some(image =>
    image.status === "APPROVED" && image.integrity === "VERIFIED" &&
    image.used_by.includes("GEOMETRY") && image.used_by.includes("TEXTURE") &&
    image.used_by.includes("ANIMATION") && image.media_type === "image/png")) {
    throw new Error("Golden benchmark requires an approved, verified PNG reference for all stages.");
  }
  // Package-declared approval is only a preflight assertion. Final quality
  // still requires actual live visuals and documented human acceptance.
  return projection.fingerprint;
}

export type GoldenSessionPaths = {
  directory: string;
  trace: string;
  trace_report: string;
  golden_run_draft: string;
};

function exactGitSha(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not resolve current Git SHA: ${result.stderr.toString().trim()}`
    );
  }
  const sha = result.stdout.toString().trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Current Git HEAD is not an exact 40-character SHA.");
  }
  return sha;
}

function taskById(taskId: string): GoldenTask {
  const task = goldenCorpus.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new Error(
      `Unknown golden task "${taskId}". Available: ${goldenCorpus.tasks
        .map((entry) => entry.id)
        .join(", ")}`
    );
  }
  return task;
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function goldenSessionPaths(
  taskId: string,
  outputRoot = ".cache/golden-sessions",
  startedAt = new Date()
): GoldenSessionPaths {
  const directory = resolve(
    outputRoot,
    `${taskId}-${safeTimestamp(startedAt)}`
  );
  return {
    directory,
    trace: join(directory, "trace.ndjson"),
    trace_report: join(directory, "trace-report.json"),
    golden_run_draft: join(directory, "golden-run-draft.json"),
  };
}

/**
 * Pin an exact editable starting model for a Golden benchmark.
 * This is benchmark-only work, never part of the normal Codex MCP hot path.
 */
export async function fingerprintGoldenInputModel(path: string): Promise<string> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== ".bbmodel") {
    throw new Error("Golden benchmark requires an absolute starting input .bbmodel file.");
  }
  const bytes = await readFile(path);
  if (bytes.byteLength === 0) {
    throw new Error("Golden benchmark starting input .bbmodel must not be empty.");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

type LiveStartingModelBaseline = {
  inputAssetSha256: string;
  projectUuid: string;
  runtimeBuildIdentity: string;
  seedPath: string;
  workingPath: string;
};

/**
 * Verify the active Bedrock project is an unmodified, separately saved
 * working copy of the seed. Reuse for any seeded Golden Task.
 */
export async function verifyGoldenStartingLiveProject(
  seedPath: string,
  snapshot: unknown
): Promise<Pick<LiveStartingModelBaseline, "inputAssetSha256" | "projectUuid">> {
  const data = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown> : {};
  const project = data.project && typeof data.project === "object"
    ? data.project as Record<string, unknown> : {};
  const format = data.format && typeof data.format === "object"
    ? data.format as Record<string, unknown> : {};

  if (format.id !== "bedrock" || project.saved !== true ||
      typeof project.uuid !== "string" || !project.uuid.trim() ||
      typeof project.save_path !== "string" || !isAbsolute(project.save_path)) {
    throw new Error("Golden benchmark requires a saved, active Bedrock .bbmodel project with a stable UUID.");
  }

  const savedPath = project.save_path;
  if (extname(savedPath).toLowerCase() !== ".bbmodel") {
    throw new Error("Golden benchmark working copy must be an editable .bbmodel.");
  }

  const [seedReal, savedReal] = await Promise.all([
    realpath(seedPath),
    realpath(savedPath),
  ]);
  const canonical = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  if (canonical(seedReal) === canonical(savedReal)) {
    throw new Error("Golden benchmark must edit a separate working copy, not the immutable seed.");
  }

  const [inputAssetSha256, workingSha256] = await Promise.all([
    fingerprintGoldenInputModel(seedPath),
    fingerprintGoldenInputModel(savedPath),
  ]);
  if (workingSha256 !== inputAssetSha256) {
    throw new Error("Golden benchmark active Blockbench model differs from the starting seed bytes.");
  }

  return { inputAssetSha256, projectUuid: project.uuid.trim() };
}

/** Benchmark-only saved-file evidence. A changed hash does not establish native/visual PASS. */
export async function fingerprintGoldenSavedOutputModel(
  seedPath: string,
  workingPath: string,
  expectedInputSha256: string
): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(expectedInputSha256)) {
    throw new Error("Golden saved output requires the initial SHA-256.");
  }
  if (!isAbsolute(seedPath) || !isAbsolute(workingPath) ||
      extname(seedPath).toLowerCase() !== ".bbmodel" ||
      extname(workingPath).toLowerCase() !== ".bbmodel") {
    throw new Error("Golden saved output requires absolute .bbmodel paths.");
  }
  const [seedReal, workingReal] = await Promise.all([realpath(seedPath), realpath(workingPath)]);
  const canonical = (p: string) => process.platform === "win32" ? p.toLowerCase() : p;
  if (canonical(seedReal) === canonical(workingReal)) {
    throw new Error("Golden output cannot overwrite the immutable seed.");
  }
  if (await fingerprintGoldenInputModel(seedReal) !== expectedInputSha256) {
    throw new Error("Golden immutable seed was modified during the session.");
  }
  const bytes = await readFile(workingReal);
  if (!bytes.byteLength) throw new Error("Golden saved .bbmodel is empty.");
  let model: unknown;
  try { model = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Golden saved .bbmodel is not valid JSON."); }
  if (!model || typeof model !== "object" || Array.isArray(model) ||
      !("meta" in model) || !model.meta || typeof model.meta !== "object" ||
      !("format_version" in model.meta) || typeof model.meta.format_version !== "string") {
    throw new Error("Golden saved .bbmodel lacks Blockbench document metadata.");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

async function preflightGoldenStartingModel(seedPath: string, task: GoldenTask): Promise<LiveStartingModelBaseline> {
  assertGoldenDisposablePath(await realpath(seedPath));
  await assertCanonicalGoldenSeed(task, seedPath);
  const client = new LiveMcpClient({
    expectedPhase: task.start_stage as "geometry" | "texturing" | "animation",
    requiredTools: ["get_project_info"],
  });
  const { buildIdentity } = await client.preflight();
  const projectInfo = structuredObject(
    await client.callTool("get_project_info", {}, "inspection"),
    "get_project_info"
  );
  const baseline = await verifyGoldenStartingLiveProject(seedPath, projectInfo);
  // The saved path was validated in verifyGoldenStartingLiveProject.
  const workingPath = (projectInfo.project as { save_path: string }).save_path;
  assertGoldenDisposablePath(await realpath(workingPath));
  return { ...baseline, runtimeBuildIdentity: buildIdentity, seedPath, workingPath };
}

export function buildGoldenRunDraft(input: {
  task: GoldenTask;
  sourceSha: string;
  traceEvents: readonly BenchmarkTraceEvent[];
  wallTimeMs: number;
  inputAssetSha256?: string | null;
  outputAssetSha256?: string | null;
  inputProjectUuid?: string | null;
  runtimeBuildIdentity?: string | null;
}): GoldenAuthoringDocument {
  if (input.inputProjectUuid != null && !input.inputProjectUuid.trim()) {
    throw new Error("Golden session inputProjectUuid must be a nonempty string.");
  }
  if (input.inputAssetSha256 != null &&
    !/^[0-9a-f]{64}$/.test(input.inputAssetSha256)) {
    throw new Error("Golden session inputAssetSha256 must be a lowercase SHA-256.");
  }
  if (input.outputAssetSha256 != null && !/^[0-9a-f]{64}$/.test(input.outputAssetSha256)) {
    throw new Error("Golden outputAssetSha256 must be a lowercase SHA-256.");
  }
  // Never borrow events from another task or source revision.
  for (const event of input.traceEvents) {
    if (event.source_sha !== input.sourceSha || event.task_id !== input.task.id) {
      throw new Error("Golden session trace does not match the selected task_id and source SHA.");
    }
  }
  const trace: GoldenTraceEvent[] = input.traceEvents.map((event) => ({
    index: event.sequence,
    kind: event.kind,
    success: event.success,
    ...(event.capability ? { capability: event.capability } : {}),
    required_for_decision: null,
    result_bytes: event.result_bytes,
    latency_ms: event.latency_ms,
  }));

  return {
    schema: "lazydesigner-golden-authoring-runs-v1",
    runs: [
      {
        task_id: input.task.id,
        source_sha: input.sourceSha,
        proof_scope: "LIVE_BLOCKBENCH",
        model: null,
        pipeline_provenance: {
          input_asset_sha256: input.inputAssetSha256 ?? null,
          output_asset_sha256: input.outputAssetSha256 ?? null,
          input_project_uuid: input.inputProjectUuid ?? null,
          reference_package_fingerprint: null,
          control_task_context_id: null,
          runtime_build_identity: input.runtimeBuildIdentity ?? null,
          artifact_revision: null,
        },
        quality_verdict: "UNVERIFIED",
        accepted_result: null,
        user_corrections: null,
        correction_rounds: null,
        wall_time_ms: input.wallTimeMs,
        accepted_result_ms: null,
        token_usage: {
          total_tokens: null,
          input_tokens: null,
          cached_input_tokens: null,
          output_tokens: null,
          reasoning_tokens: null,
        },
        trace,
        acceptance_evidence: [...input.task.acceptance, "human_acceptance"].map((criterion) => ({
          criterion,
          verdict: "UNVERIFIED",
          evidence_ref: null,
        })),
      },
    ],
  };
}

async function finalizeSession(input: {
  task: GoldenTask;
  sourceSha: string;
  paths: GoldenSessionPaths;
  startedAtMs: number;
  startingBaseline: LiveStartingModelBaseline | null;
}): Promise<void> {
  const traceFile = Bun.file(input.paths.trace);
  if (!(await traceFile.exists())) {
    console.error(
      "[LazyDesigner Benchmark] No trace file was produced; no report/draft generated."
    );
    return;
  }

  const traceText = await traceFile.text();
  const report = summarizeGatewayBenchmarkTrace(traceText);
  const wallTimeMs = Math.max(0, Date.now() - input.startedAtMs);
  let outputAssetSha256: string | null = null;
  if (input.startingBaseline) {
    try {
      outputAssetSha256 = await fingerprintGoldenSavedOutputModel(
        input.startingBaseline.seedPath, input.startingBaseline.workingPath,
        input.startingBaseline.inputAssetSha256
      );
    } catch (error) {
      // Keep the draft UNVERIFIED and retain the trace when the output fails.
      console.error("[LazyDesigner Benchmark] Saved output unverified:",
        error instanceof Error ? error.message : String(error));
    }
  }
  const draft = buildGoldenRunDraft({
    task: input.task,
    sourceSha: input.sourceSha,
    traceEvents: report.events,
    wallTimeMs,
    inputAssetSha256: input.startingBaseline?.inputAssetSha256,
    outputAssetSha256,
    inputProjectUuid: input.startingBaseline?.projectUuid,
    runtimeBuildIdentity: input.startingBaseline?.runtimeBuildIdentity,
  });

  await Bun.write(
    input.paths.trace_report,
    JSON.stringify(report, null, 2) + "\n"
  );
  await Bun.write(
    input.paths.golden_run_draft,
    JSON.stringify(draft, null, 2) + "\n"
  );

  console.error(
    `[LazyDesigner Benchmark] Session artifacts: ${input.paths.directory}`
  );
  console.error(
    "[LazyDesigner Benchmark] Draft remains UNVERIFIED; add complete Reference → Control → Runtime → artifact provenance, decision labels, and acceptance evidence before claiming accepted-result efficiency."
  );
}

async function main(): Promise<void> {
  const taskId = process.argv[2];
  const outputRoot = process.argv[3] ?? ".cache/golden-sessions";
  const inputModelPath = process.argv[4];
  if (!taskId) {
    throw new Error(
      "Usage: bun run benchmark:golden-session -- <golden-task-id> [output-root] <fresh-disposable-seed.bbmodel>"
    );
  }

  const task = taskById(taskId);
  // All current Golden tasks require a fresh source seed. Normal asset authoring is unchanged.
  if (!inputModelPath) {
    throw new Error("Every Golden Task requires a fresh disposable starting .bbmodel.");
  }
  // Refuse pending/unapproved references before connecting to native Runtime.
  await requireGoldenReferenceReady(task);
  const startingBaseline = await preflightGoldenStartingModel(inputModelPath, task);
  const sourceSha = exactGitSha();
  const paths = goldenSessionPaths(task.id, outputRoot);
  await mkdir(paths.directory, { recursive: true });

  const startedAtMs = Date.now();
  const child = Bun.spawn(["bun", "run", "./gateway/index.ts"], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      LAZYDESIGNER_BENCHMARK_TRACE_PATH: paths.trace,
      LAZYDESIGNER_BENCHMARK_TASK_ID: task.id,
      LAZYDESIGNER_BENCHMARK_SOURCE_SHA: sourceSha,
    },
  });

  let stopping = false;
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const exitCode = await child.exited;
  await finalizeSession({
    task,
    sourceSha,
    paths,
    startedAtMs,
    startingBaseline,
  });

  process.exitCode = exitCode;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      "[LazyDesigner Benchmark]",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  });
}
