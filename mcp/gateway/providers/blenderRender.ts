/** Gateway-owned Blender renderer. This is an MCP capability, not a second
 * Gateway or a Blockbench plugin. It consumes only a verified immutable GLB
 * handoff and keeps one bounded Blender child-process job per Gateway process.
 */
import { randomBytes, createHash } from "node:crypto";
import * as childProcess from "node:child_process";
import * as nodeFs from "node:fs";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import {
  acquirePublicationHandoffUseLease,
  acquirePublicationRenderDirectoryLease,
  PUBLICATION_HANDOFF_USE_LEASE_NAME,
} from "@/lib/publication/renderDirectoryLease";
import {
  BLENDER_COMPLETION_SUFFIX, MAX_BLENDER_COMPLETION_BYTES,
  MAX_BLENDER_PNG_BYTES, MAX_BLENDER_PREVIEW_BYTES,
  BLENDER_COMPLETION_KIND, blenderCompletionPaths, blenderCompletionSchema,
 
} from "@/lib/publication/renderCompletion";
import {
  lstat, stat, readFile, writeFile, mkdtemp, rm, realpath,
  readdir,
} from "node:fs/promises";
import { basename, dirname, join, resolve, extname } from "node:path";
import {
  publicationRenderParameters, publicationAutomaticOptions,
  makePublicationJob, type PublicationRenderRequest,
} from "@/lib/publication/contracts";
import { MAX_PUBLICATION_HANDOFF_BYTES, MAX_PUBLICATION_HANDOFF_GLB_BYTES, parsePublicationHandoff, type PublicationHandoff } from "@/lib/publication/handoffContract";
import { inspectPublicationGlb } from "@/lib/publication/glbIntegrity";
import { inspectPublicationPng } from "@/lib/publication/pngIntegrity";
import { publicationDiagnosticsSchema, compactPublicationDiagnostics } from "@/lib/publication/diagnostics";
import { validateHdriBytes } from "@/lib/publication/environment";
import {
  BLENDER_CORE_MODULES, BLENDER_PUBLICATION_WORKER, BLENDER_WORKER_SHA256,
  runBlender,
} from "@/lib/publication/blenderProcess";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import type { BackendTool, JsonRecord } from "../contracts/protocol";
import { z } from "zod";

export const BLENDER_RENDER_CAPABILITY = "blender_render";
const HANDOFF_DIR = /^\.lazydesigner-blender-handoff-[a-f0-9]{24}$/;
const ID = /^blender_[a-f0-9]{24}$/;
const SHA = /^[a-f0-9]{64}$/;
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

export const blenderRenderControlParameters = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("auto"),
    options: publicationAutomaticOptions.optional(),
  }).strict(),
  z.object({
    operation: z.literal("start"),
    handoff_path: z.string().min(1).max(2048),
    request: publicationRenderParameters,
  }).strict(),
  z.object({
    operation: z.literal("status"),
    // Omit job_id to recover latest process-local job after a lost start response.
    job_id: z.string().regex(ID).optional(),
    include_preview: z.boolean().default(false),
  }).strict(),
  z.object({
    operation: z.literal("preview"),
    job_id: z.string().regex(ID),
  }).strict(),
  z.object({
    operation: z.literal("cancel"),
    job_id: z.string().regex(ID),
  }).strict(),
  z.object({
    operation: z.literal("recover"),
    receipt_path: z.string().min(1).max(2048),
  }).strict(),
  z.object({
    operation: z.literal("release"),
    handoff_path: z.string().min(1).max(2048),
  }).strict(),
]);

export const BLENDER_RENDER_TOOL: BackendTool = {
  name: BLENDER_RENDER_CAPABILITY,
  description: "Cycles rendering through the existing LazyDesigner Gateway. operation=auto prepares a native Blockbench GLB handoff and starts the same independent Blender worker with one call, using LAZYDESIGNER_BLENDER_EXECUTABLE and LAZYDESIGNER_RENDER_OUTPUT_DIRECTORY configured once on a shared host. Manual start/status/preview/cancel/recover/release remain available. Failed native exports are not auto-retried, and a PNG is always an unapproved DRAFT.",
  // Conservative tool-level metadata: operation=release deletes an explicitly selected handoff.
  // QUERY branches remain classified individually in the Gateway branch manifest.
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  // The same Zod contract validates local calls and the schema advertised to AI.
  // Branch selection is sourced from the canonical Gateway branch manifest.
  inputSchema: z.toJSONSchema(blenderRenderControlParameters),
};

export function shouldProbeBlenderRender(query: string): boolean {
  return /\bblender\b|\bcycles\b|blender_render|blender mcp|glb handoff|\b(?:render|rendering)\b.*\b(?:model|asset|objek|blockbench)\b|\b(?:model|asset|objek|blockbench)\b.*\b(?:render|rendering)\b/i.test(query);
}

type State = "RUNNING" | "CANCELLING" | "RENDERED_DRAFT" |
  "FAILED" | "CANCELLED" | "EXIT_UNCONFIRMED";
type Phase = "PREPARING_ASSETS" | "RENDERING_CYCLES" |
  "VERIFYING_OUTPUT" | "PUBLISHING" | "FINISHED" | "FAILED" | "CANCELLING" | "CANCELLED";

type RenderReceipt = Readonly<{
  state: "RENDERED_DRAFT";
  source_project_uuid: string;
  source_sha256: string;
  source_manifest_sha256: string;
  source_revision: "FROZEN_HANDOFF_NOT_LIVE_EDITOR";
  glb_sha256: string;
  /** Hash of the exact bundled Python sources that produced this render. */
  worker_sha256: string;
  render_settings: Readonly<{
    quality: PublicationRenderRequest["quality"];
    width: number;
    height: number;
    samples: number;
    noise_threshold: number;
    background: PublicationRenderRequest["background"];
    camera: PublicationRenderRequest["camera"];
    look: PublicationRenderRequest["look"];
    device: PublicationRenderRequest["device"];
    view_transform: PublicationRenderRequest["view_transform"];
    environment: Readonly<{ mode: "studio" | "hdri"; sha256: string | null }>;
  }>;
  output_path: string;
  /** Durable completion sidecar, distinct from the immutable source handoff. */
  completion_receipt_path: string;
  output_png_sha256: string;
  output_png_bytes: number;
  preview_sha256: string;
  preview_dimensions: readonly [number, number];
  blender_target: "5.2.x";
  engine: "CYCLES";
  diagnostics: ReturnType<typeof compactPublicationDiagnostics>;
  visual_quality: "NOT_EVALUATED";
}>;

type Job = {
  id: string;
  state: State;
  phase: Phase;
  started_at: string;
  handoff_path: string | null;
  handoff_verified: boolean;
  error_code: string | null;
  source_sha256: string | null;
  controller: AbortController;
  receipt: RenderReceipt | null;
  preview: Buffer | null;
  task: Promise<void> | null;
  automatic: boolean;
  handoff_cleanup: "NOT_APPLICABLE" | "PENDING" | "RELEASED" | "REQUIRES_REVIEW";
};

type Result = JsonRecord & {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
  structuredContent: JsonRecord;
};

function status(job: Job): JsonRecord {
  return {
    job_id: job.id,
    state: job.state,
    phase: job.phase,
    started_at: job.started_at,
    source_sha256: job.source_sha256,
    error_code: job.error_code,
    receipt: job.receipt,
    output_is_visual_qa: false,
    handoff_cleanup: job.handoff_cleanup,
    ...(job.handoff_cleanup === "REQUIRES_REVIEW" && job.handoff_path
      ? {
          handoff_path: job.handoff_path,
          handoff_path_status: job.handoff_verified
            ? "VERIFIED_NATIVE_RECEIPT"
            : "EXPECTED_ONLY_UNVERIFIED",
        } : {}),
  };
}

function assertRunning(job: Job): void {
  if (job.controller.signal.aborted) {
    throw new Error("PUBLICATION_BLENDER_CANCELLED");
  }
}

function requireHandoffPath(path: string): void {
  if (!isAbsoluteFilesystemPath(path) || basename(path) !== "handoff.json" ||
      !HANDOFF_DIR.test(basename(dirname(path))) ||
      /[\x00-\x1f]/.test(path)) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_PATH_INVALID");
  }
}

async function readVerifiedHandoff(path: string): Promise<{
  document: PublicationHandoff;
  glb: Buffer;
  directory: string;
}> {
  requireHandoffPath(path);
  const directory = dirname(path);
  const [dirStat, jsonStat, canonical] = await Promise.all([
    lstat(directory), lstat(path), realpath(path),
  ]);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() ||
      !jsonStat.isFile() || jsonStat.isSymbolicLink() ||
      dirname(canonical) !== await realpath(directory) ||
      jsonStat.size < 64 || jsonStat.size > MAX_PUBLICATION_HANDOFF_BYTES) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_FILE_INVALID");
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_PUBLICATION_HANDOFF_BYTES) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_FILE_TOO_LARGE");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("PUBLICATION_BLENDER_HANDOFF_JSON_INVALID"); }
  const document = parsePublicationHandoff(parsed);
  if (hash(JSON.stringify(document.source_manifest)) !==
      document.source_manifest_sha256) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_MANIFEST_SHA_MISMATCH");
  }
  const glbPath = join(directory, "model.glb");
  const glbStat = await lstat(glbPath);
  if (!glbStat.isFile() || glbStat.isSymbolicLink() ||
      glbStat.size < 32 || glbStat.size > MAX_PUBLICATION_HANDOFF_GLB_BYTES) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_GLB_SIZE_INVALID");
  }
  const glb = await readFile(glbPath);
  if (glb.length > MAX_PUBLICATION_HANDOFF_GLB_BYTES ||
      hash(glb) !== document.glb_sha256) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_GLB_SHA_MISMATCH");
  }
  const inventory = inspectPublicationGlb(
    glb, document.cube_count, document.material_count,
    document.source_manifest.cubes, document.materials,
  );
  const recorded = inventory.verified_image_png_sha256;
  for (const receipt of Object.values(document.materials)) {
    const name = receipt.color_uuid;
    const expected = receipt.import_png_sha256!;
    const names: Record<string, string> = {
      base: "ld_base_" + name,
      ...(expected.mer ? { mer: "ld_mer_" + name } : {}),
      ...(expected.normal ? { normal: "ld_normal_" + name } : {}),
      ...(expected.emission ? {
        emission: (expected.mer ? "ld_emission_" : "ld_base_") + name,
      } : {}),
    };
    for (const [kind, texture] of Object.entries(names)) {
      if (!SHA.test(expected[kind as keyof typeof expected] ?? "") ||
          recorded[texture] !== expected[kind as keyof typeof expected]) {
        throw new Error("PUBLICATION_BLENDER_HANDOFF_IMAGE_SHA_MISMATCH:" + texture);
      }
    }
  }
  return { document, glb, directory };
}

/** Protect the short-lived verified read against release in another Gateway. */
async function verifyHandoff(path: string): ReturnType<typeof readVerifiedHandoff> {
  requireHandoffPath(path);
  const release = acquirePublicationHandoffUseLease(nodeFs, dirname(path));
  try {
    return await readVerifiedHandoff(path);
  } finally {
    release();
  }
}

/** One Gateway-owned process, not a persistent render farm or native editor. */
export class BlenderRenderProvider {
  private current: Job | null = null;
  private retired = false;
  private readonly releasingHandoffs = new Set<string>();
  private recovering = false;

  async isAvailable(): Promise<boolean> {
    // Discoverable even when Blockbench is offline. The explicit Blender
    // executable/path/permissions are verified by start, not background probes.
    return true;
  }

  private requireJob(id: unknown): Job {
    const current = this.current;
    if (typeof id !== "string" || !ID.test(id) ||
        !current || current.id !== id) {
      throw new Error("PUBLICATION_BLENDER_JOB_NOT_FOUND_OR_EXPIRED");
    }
    return current;
  }

  private async execute(job: Job, handoffPath: string, request: PublicationRenderRequest): Promise<RenderReceipt> {
    assertRunning(job);
    const { document, glb, directory } = await verifyHandoff(handoffPath);
    job.source_sha256 = document.source_sha256;
    assertRunning(job);
    const outputDirectory = dirname(request.output_path);
    if (resolve(outputDirectory) === resolve(directory)) {
      throw new Error("PUBLICATION_BLENDER_OUTPUT_MUST_BE_SEPARATE_FROM_HANDOFF");
    }
    const [outDir, executable] = await Promise.all([
      stat(outputDirectory), stat(request.blender_executable),
    ]);
    if (!outDir.isDirectory() || !executable.isFile()) {
      throw new Error("PUBLICATION_BLENDER_OUTPUT_OR_EXECUTABLE_INVALID");
    }
    const completionPaths = blenderCompletionPaths(request.output_path);
    if (existsSync(request.output_path) ||
        existsSync(completionPaths.receipt_path) ||
        existsSync(completionPaths.preview_path)) {
      throw new Error("PUBLICATION_OUTPUT_EXISTS: PNG or durable receipt already exists; overwrite disabled.");
    }
    const releaseDirectoryLease =
      acquirePublicationRenderDirectoryLease(nodeFs, outputDirectory);
    let workdir: string | null = null;
    let preserve = false;
    try {
      workdir = await mkdtemp(join(outputDirectory, ".lazydesigner-blender-job-"));
      const glbPath = join(workdir, "model.glb");
      const workerPath = join(workdir, "render.py");
      const jobPath = join(workdir, "job.json");
      const outputPath = join(workdir, "output.png");
      const reportPath = join(workdir, "report.json");
      const evidencePath = join(workdir, "evidence.png");
      assertRunning(job);
      await Promise.all([
        writeFile(glbPath, glb, { flag: "wx" }),
        writeFile(workerPath, BLENDER_PUBLICATION_WORKER, { flag: "wx" }),
        ...BLENDER_CORE_MODULES.map(([name, code]) =>
          writeFile(join(workdir, name), code, { flag: "wx" })),
      ]);
      assertRunning(job);
      let environment_asset: { path: string; sha256: string } | undefined;
      if (request.environment.mode === "hdri") {
        const path = request.environment.hdri_path!;
        const st = await stat(path);
        if (!st.isFile() || st.size < 16 || st.size > 64 * 1024 * 1024) {
          throw new Error("PUBLICATION_BLENDER_HDRI_INVALID");
        }
        const source = await readFile(path);
        validateHdriBytes(path, source);
        const copied = join(workdir, "environment" + extname(path).toLowerCase());
        await writeFile(copied, source, { flag: "wx" });
        environment_asset = { path: copied, sha256: hash(source) };
      }
      assertRunning(job);
      const spec = makePublicationJob(
        { ...request, output_path: outputPath },
        { project_uuid: document.project_uuid, sha256: document.source_sha256,
          glb_path: glbPath, mesh_count: document.cube_count,
          materials: document.materials, ...(environment_asset ? { environment_asset } : {}) },
      );
      await writeFile(jobPath, JSON.stringify(spec), { flag: "wx" });
      assertRunning(job);
      job.phase = "RENDERING_CYCLES";
      await runBlender(childProcess,
        request.blender_executable, workerPath, jobPath, workdir,
        15 * 60 * 1000, 12_000, job.controller.signal);
      assertRunning(job);
      job.phase = "VERIFYING_OUTPUT";
      const [pngStat, reportStat, previewStat] = await Promise.all([
        stat(outputPath), stat(reportPath), stat(evidencePath),
      ]);
      if (!pngStat.isFile() || pngStat.size < 57 ||
          pngStat.size > 96 * 1024 * 1024 ||
          !reportStat.isFile() || reportStat.size > 64_000 ||
          !previewStat.isFile() || previewStat.size < 57 ||
          previewStat.size > 2_000_000) {
        throw new Error("PUBLICATION_BLENDER_OUTPUT_INVENTORY_INVALID_OR_OVERSIZED");
      }
      const [png, reportBytes, evidence] = await Promise.all([
        readFile(outputPath), readFile(reportPath), readFile(evidencePath),
      ]);
      inspectPublicationPng(png, request.width, request.height);
      const report = publicationDiagnosticsSchema.parse(
        JSON.parse(reportBytes.toString("utf8")),
      );
      if (report.asset.mesh_count !== document.cube_count ||
          report.asset.material_count !== document.material_count ||
          report.image.image_dimensions[0] !== request.width ||
          report.image.image_dimensions[1] !== request.height) {
        throw new Error("PUBLICATION_BLENDER_RENDER_DIAGNOSTICS_SOURCE_MISMATCH");
      }
      inspectPublicationPng(evidence,
        report.preview.dimensions[0], report.preview.dimensions[1]);
      assertRunning(job);
      // A completed receipt is reconstructible after Gateway restart without
      // asserting that the native editor still matches its immutable handoff.
      const completion = blenderCompletionSchema.parse({
        kind: BLENDER_COMPLETION_KIND,
        schema_version: 1,
        job_id: job.id,
        started_at: job.started_at,
        completed_at: new Date().toISOString(),
        source_project_uuid: document.project_uuid,
        source_sha256: document.source_sha256,
        source_manifest_sha256: document.source_manifest_sha256,
        glb_sha256: document.glb_sha256,
        worker_sha256: BLENDER_WORKER_SHA256,
        cube_count: document.cube_count,
        material_count: document.material_count,
        request,
        output_png_sha256: hash(png),
        output_png_bytes: png.length,
        preview_sha256: hash(evidence),
        preview_bytes: evidence.length,
        preview_dimensions: [
          report.preview.dimensions[0], report.preview.dimensions[1],
        ],
        diagnostics: report,
      });
      const completionBytes = Buffer.from(JSON.stringify(completion));
      if (completionBytes.length > MAX_BLENDER_COMPLETION_BYTES) {
        throw new Error("PUBLICATION_BLENDER_COMPLETION_RECEIPT_OVERSIZED");
      }
      assertRunning(job);
      job.phase = "PUBLISHING";
      // Write only known, exclusive files. Sidecar last is the commit marker
      // for completed outcome recovery after a Gateway restart.
      const published: Array<{ path: string; sha256: string }> = [];
      try {
        for (const [path, bytes] of [
          [request.output_path, png],
          [completionPaths.preview_path, evidence],
          [completionPaths.receipt_path, completionBytes],
        ] as const) {
          writeFileSync(path, bytes, { flag: "wx" });
          published.push({ path, sha256: hash(bytes) });
          if (hash(readFileSync(path)) !== hash(bytes)) {
            throw new Error("PUBLICATION_BLENDER_OUTPUT_READBACK_MISMATCH:" + path);
          }
        }
      } catch (error) {
        // Revert only bytes exactly matching this attempted publication.
        // Never delete a file replaced by another actor during a failure.
        for (const item of published.reverse()) {
          try {
            if (existsSync(item.path) &&
                hash(readFileSync(item.path)) === item.sha256) {
              unlinkSync(item.path);
            }
          } catch { /* Preserve uncertain files for explicit inspection. */ }
        }
        throw error;
      }
      job.preview = Buffer.from(evidence);
      return {
        state: "RENDERED_DRAFT",
        source_project_uuid: document.project_uuid,
        source_sha256: document.source_sha256,
        source_manifest_sha256: document.source_manifest_sha256,
        source_revision: "FROZEN_HANDOFF_NOT_LIVE_EDITOR",
        glb_sha256: document.glb_sha256,
        worker_sha256: BLENDER_WORKER_SHA256,
        render_settings: {
          quality: request.quality,
          width: spec.width, height: spec.height,
          samples: spec.samples, noise_threshold: spec.noise_threshold,
          background: spec.background, camera: spec.camera, look: spec.look,
          device: spec.device, view_transform: spec.view_transform,
          environment: {
            mode: spec.environment.mode,
            sha256: spec.environment.hdri_sha256,
          },
        },
        output_path: request.output_path,
        completion_receipt_path: completionPaths.receipt_path,
        output_png_sha256: hash(png),
        output_png_bytes: png.length,
        preview_sha256: hash(evidence),
        preview_dimensions: [
          report.preview.dimensions[0], report.preview.dimensions[1],
        ],
        blender_target: "5.2.x", engine: "CYCLES",
        diagnostics: compactPublicationDiagnostics(report),
        visual_quality: "NOT_EVALUATED",
      };
    } catch (error) {
      preserve = error instanceof Error &&
        error.message.startsWith("PUBLICATION_BLENDER_EXIT_UNCONFIRMED");
      throw error;
    } finally {
      if (preserve) {
        console.warn("[LazyDesigner Blender MCP] Unconfirmed process exit; retained isolated assets:", workdir);
      } else {
        if (workdir) {
          try { await rm(workdir, { recursive: true, force: true }); }
          catch { console.warn("[LazyDesigner Blender MCP] Isolated job cleanup failed:", workdir); }
        }
        try { releaseDirectoryLease(); }
        catch { console.warn("[LazyDesigner Blender MCP] Directory-scoped Cycles lease cleanup failed:", outputDirectory); }
      }
    }
  }

  private launchJob(
    handoffPath: string | null,
    render: (job: Job) => Promise<RenderReceipt>,
    automatic = false,
  ): JsonRecord {
    if (this.retired) throw new Error("PUBLICATION_BLENDER_GATEWAY_RETIRED");
    if (this.recovering) throw new Error("PUBLICATION_BLENDER_RECOVERY_IN_PROGRESS");
    if (this.current && (
      ["RUNNING", "CANCELLING", "EXIT_UNCONFIRMED"].includes(this.current.state) ||
      this.current.handoff_cleanup === "PENDING"
    )) {
      // A completed Cycles frame is not the end of an automatic job while
      // its owned GLB handoff is still being verified/released. Preserve
      // this job's cleanup status and source identity until it is terminal.
      throw new Error("PUBLICATION_BLENDER_JOB_BUSY");
    }
    const job: Job = {
      id: "blender_" + randomBytes(12).toString("hex"),
      state: "RUNNING", phase: "PREPARING_ASSETS",
      started_at: new Date().toISOString(), handoff_path: handoffPath,
      handoff_verified: !automatic,
      error_code: null, source_sha256: null, controller: new AbortController(),
      receipt: null, preview: null, task: null, automatic,
      handoff_cleanup: automatic ? "PENDING" : "NOT_APPLICABLE",
    };
    this.current = job;
    job.task = Promise.resolve().then(() => render(job))
      .then(receipt => {
        if (job.controller.signal.aborted || job.state === "CANCELLING") {
          job.state = "CANCELLED";
          job.phase = "CANCELLED";
          return;
        }
        job.receipt = receipt;
        job.state = "RENDERED_DRAFT";
        job.phase = "FINISHED";
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        job.error_code = message.slice(0, 800);
        job.state = message.startsWith("PUBLICATION_BLENDER_EXIT_UNCONFIRMED")
          ? "EXIT_UNCONFIRMED"
          : job.controller.signal.aborted ? "CANCELLED" : "FAILED";
        job.phase = job.state === "CANCELLED" ? "CANCELLED" : "FAILED";
      }).finally(async () => {
        if (!job.automatic) return;
        if (!job.handoff_verified || !job.handoff_path ||
            job.state === "EXIT_UNCONFIRMED") {
          job.handoff_cleanup = "REQUIRES_REVIEW";
          return;
        }
        try {
          // Only a verified, owned handoff is released after terminal Cycles
          // process closure. PNG and completed receipt remain untouched.
          // Internal terminal cleanup must remain allowed during Gateway
          // shutdown, after the owned worker has definitively exited.
          await this.releaseHandoff(job.handoff_path, true);
          job.handoff_cleanup = "RELEASED";
        } catch (error) {
          job.handoff_cleanup = "REQUIRES_REVIEW";
          console.warn("[LazyDesigner Blender MCP] Automatic handoff cleanup needs review:", error);
        }
      });
    return status(job);
  }

  start(handoffPath: unknown, requestArgs: unknown): JsonRecord {
    if (typeof handoffPath !== "string" || this.releasingHandoffs.has(handoffPath)) {
      throw new Error("PUBLICATION_BLENDER_HANDOFF_PATH_INVALID");
    }
    requireHandoffPath(handoffPath);
    const request = publicationRenderParameters.parse(requestArgs);
    return this.launchJob(handoffPath, job => this.execute(job, handoffPath, request));
  }

  /** Accept an execution-owned prepared handoff; do not inspect the native editor. */
  startPreparedHandoff(
    expectedHandoffPath: string,
    prepare: (signal: AbortSignal) => Promise<{
      handoff_path: string;
      request: PublicationRenderRequest;
    }>,
  ): JsonRecord {
    requireHandoffPath(expectedHandoffPath);
    // The planned location is an inspection hint, NOT proof of a created GLB.
    return this.launchJob(expectedHandoffPath, async job => {
      assertRunning(job);
      const prepared = await prepare(job.controller.signal);
      if (prepared.handoff_path !== expectedHandoffPath) {
        throw new Error("PUBLICATION_AUTO_HANDOFF_PATH_MISMATCH");
      }
      requireHandoffPath(prepared.handoff_path);
      // Only a verified native response allows terminal automatic release.
      // An unknown/aborted export is never deleted on a guessed path.
      job.handoff_verified = true;
      assertRunning(job);
      const request = publicationRenderParameters.parse(prepared.request);
      return this.execute(job, prepared.handoff_path, request);
    }, true);
  }

  status(id: unknown): JsonRecord {
    if (id === undefined) {
      if (!this.current) {
        throw new Error("PUBLICATION_BLENDER_JOB_NOT_FOUND_OR_EXPIRED");
      }
      return status(this.current);
    }
    return status(this.requireJob(id));
  }

  cancel(id: unknown): JsonRecord {
    const job = this.requireJob(id);
    if (job.state === "RUNNING" && job.phase !== "PUBLISHING") {
      job.state = "CANCELLING";
      job.phase = "CANCELLING";
      job.controller.abort();
    }
    return status(job);
  }

  /**
   * Recover only a COMPLETED job from its durable, exclusive receipt marker.
   * This never resurrects Blender after Gateway restart or claims a live model.
   */
  async recover(receiptPath: string): Promise<JsonRecord> {
    if (this.retired) throw new Error("PUBLICATION_BLENDER_GATEWAY_RETIRED");
    if (this.current && (
      ["RUNNING", "CANCELLING", "EXIT_UNCONFIRMED"].includes(this.current.state) ||
      this.current.handoff_cleanup === "PENDING"
    )) {
      throw new Error("PUBLICATION_BLENDER_JOB_BUSY");
    }
    if (!isAbsoluteFilesystemPath(receiptPath) ||
        !receiptPath.endsWith(BLENDER_COMPLETION_SUFFIX) ||
        receiptPath.length > 2048 || /[\x00-\x1f]/.test(receiptPath)) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_PATH_INVALID");
    }
    if (this.recovering) throw new Error("PUBLICATION_BLENDER_RECOVERY_IN_PROGRESS");
    this.recovering = true;
    try {
    const st = await lstat(receiptPath);
    if (!st.isFile() || st.isSymbolicLink() ||
        st.size < 64 || st.size > MAX_BLENDER_COMPLETION_BYTES) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_FILE_INVALID");
    }
    const bytes = await readFile(receiptPath);
    if (bytes.length > MAX_BLENDER_COMPLETION_BYTES) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_OVERSIZED");
    }
    let parsed: unknown;
    try { parsed = JSON.parse(bytes.toString("utf8")); }
    catch { throw new Error("PUBLICATION_BLENDER_COMPLETION_JSON_INVALID"); }
    const data = blenderCompletionSchema.parse(parsed);
    const paths = blenderCompletionPaths(data.request.output_path);
    if (paths.receipt_path !== receiptPath) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_OUTPUT_AFFINITY_MISMATCH");
    }
    const [pngInfo, previewInfo] = await Promise.all([
      lstat(data.request.output_path), lstat(paths.preview_path),
    ]);
    if (!pngInfo.isFile() || pngInfo.isSymbolicLink() ||
        pngInfo.size !== data.output_png_bytes ||
        pngInfo.size > MAX_BLENDER_PNG_BYTES ||
        !previewInfo.isFile() || previewInfo.isSymbolicLink() ||
        previewInfo.size !== data.preview_bytes ||
        previewInfo.size > MAX_BLENDER_PREVIEW_BYTES) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_OUTPUT_INVENTORY_INVALID");
    }
    const [png, previewBytes] = await Promise.all([
      readFile(data.request.output_path), readFile(paths.preview_path),
    ]);
    if (hash(png) !== data.output_png_sha256 ||
        hash(previewBytes) !== data.preview_sha256) {
      throw new Error("PUBLICATION_BLENDER_COMPLETION_OUTPUT_SHA_MISMATCH");
    }
    inspectPublicationPng(png, data.request.width, data.request.height);
    inspectPublicationPng(previewBytes,
      data.preview_dimensions[0], data.preview_dimensions[1]);
    const renderReceipt: RenderReceipt = {
      state: "RENDERED_DRAFT",
      source_project_uuid: data.source_project_uuid,
      source_sha256: data.source_sha256,
      source_manifest_sha256: data.source_manifest_sha256,
      source_revision: "FROZEN_HANDOFF_NOT_LIVE_EDITOR",
      glb_sha256: data.glb_sha256,
      worker_sha256: data.worker_sha256,
      render_settings: {
        quality: data.request.quality,
        width: data.request.width, height: data.request.height,
        samples: data.diagnostics.render.sampling.samples,
        noise_threshold: data.diagnostics.render.sampling.adaptive_threshold,
        background: data.request.background, camera: data.request.camera,
        look: data.request.look, device: data.request.device,
        view_transform: data.request.view_transform,
        environment: {
          mode: data.request.environment.mode,
          sha256: data.diagnostics.lighting.hdri_sha256,
        },
      },
      output_path: data.request.output_path,
      completion_receipt_path: receiptPath,
      output_png_sha256: data.output_png_sha256,
      output_png_bytes: data.output_png_bytes,
      preview_sha256: data.preview_sha256,
      preview_dimensions: data.preview_dimensions,
      blender_target: "5.2.x", engine: "CYCLES",
      diagnostics: compactPublicationDiagnostics(data.diagnostics),
      visual_quality: "NOT_EVALUATED",
    };
    const record: Job = {
      id: data.job_id, state: "RENDERED_DRAFT", phase: "FINISHED",
      started_at: data.started_at, handoff_path: null,
      source_sha256: data.source_sha256,
      error_code: null, controller: new AbortController(),
      receipt: renderReceipt, preview: Buffer.from(previewBytes),
      task: Promise.resolve(), automatic: false, handoff_cleanup: "NOT_APPLICABLE",
      handoff_verified: false,
    };
    if (this.retired) throw new Error("PUBLICATION_BLENDER_GATEWAY_RETIRED");
    this.current = record;
    return status(record);
    } finally {
      this.recovering = false;
    }
  }

  /** Explicit, source-verified cleanup. Never recursively delete user folders. */
  async releaseHandoff(handoffPath: string, internalTerminalCleanup = false): Promise<JsonRecord> {
    if (this.retired && !internalTerminalCleanup) {
      throw new Error("PUBLICATION_BLENDER_GATEWAY_RETIRED");
    }
    if (!isAbsoluteFilesystemPath(handoffPath) ||
        basename(handoffPath) !== "handoff.json" ||
        !HANDOFF_DIR.test(basename(dirname(handoffPath))) ||
        this.releasingHandoffs.has(handoffPath)) {
      throw new Error("PUBLICATION_BLENDER_HANDOFF_PATH_INVALID");
    }
    const current = this.current;
    if (current?.handoff_path === handoffPath &&
        (["RUNNING", "CANCELLING", "EXIT_UNCONFIRMED"].includes(current.state) ||
          (!internalTerminalCleanup && current.handoff_cleanup === "PENDING"))) {
      // Automatic release has exclusive ownership until it resolves.
      // A second explicit release is not permission to race that cleanup.
      throw new Error("PUBLICATION_BLENDER_HANDOFF_IN_USE");
    }
    this.releasingHandoffs.add(handoffPath);
    let releaseLease: (() => void) | null = null;
    try {
      const directory = dirname(handoffPath);
      // Acquire BEFORE reading. Another Gateway currently verifying this
      // handoff prevents deletion; a concurrent new reader fails closed.
      releaseLease = acquirePublicationHandoffUseLease(nodeFs, directory);
      const { document } = await readVerifiedHandoff(handoffPath);
      const contents = (await readdir(directory)).sort();
      if (contents.join("\0") !== [
        PUBLICATION_HANDOFF_USE_LEASE_NAME, "handoff.json", "model.glb",
      ].sort().join("\0")) {
        throw new Error("PUBLICATION_BLENDER_HANDOFF_CONTAINS_UNOWNED_FILES");
      }
      // Exact owned files only; do not recursively delete other user assets.
      nodeFs.unlinkSync(join(directory, "handoff.json"));
      nodeFs.unlinkSync(join(directory, "model.glb"));
      releaseLease();
      releaseLease = null;
      nodeFs.rmdirSync(directory);
      return {
        released: true, source_project_uuid: document.project_uuid,
        source_sha256: document.source_sha256, handoff_path: handoffPath,
      };
    } finally {
      // Safe even if verification fails or a partial handoff is encountered.
      try { releaseLease?.(); }
      finally { this.releasingHandoffs.delete(handoffPath); }
    }
  }

  preview(id: unknown): Result {
    const job = this.requireJob(id);
    const receipt = job.receipt;
    if (job.state !== "RENDERED_DRAFT" || !receipt || !job.preview ||
        hash(job.preview) !== receipt.preview_sha256 ||
        job.preview.length > 2_000_000) {
      throw new Error("PUBLICATION_BLENDER_PREVIEW_NOT_READY");
    }
    return {
      content: [
        { type: "text", text: "Actual Blender Cycles PNG preview from frozen GLB " +
          receipt.glb_sha256.slice(0, 12) + ". NOT a live Blockbench render or visual approval." },
        { type: "image", data: job.preview.toString("base64"), mimeType: "image/png" },
      ],
      structuredContent: { job_id: job.id, state: job.state,
        source_sha256: receipt.source_sha256,
        output_png_sha256: receipt.output_png_sha256,
        preview_sha256: receipt.preview_sha256, visual_quality: "NOT_EVALUATED" },
    };
  }

  async invoke(args: JsonRecord): Promise<Result> {
    const operation = blenderRenderControlParameters.parse(args);
    switch (operation.operation) {
      case "auto":
        // auto is routed by the local capability registry through the
        // Gateway execution owner; the Blender adapter never calls Blockbench.
        throw new Error("PUBLICATION_AUTO_GATEWAY_EXECUTION_REQUIRED");
      case "start": {
        const started = this.start(operation.handoff_path, operation.request);
        return {
          content: [{
            type: "text",
            text: "Gateway Blender Cycles job started: " + started.job_id +
              ". Poll blender_render operation=status; this does not confirm a PNG.",
          }],
          structuredContent: started,
        };
      }
      case "status": {
        const current = this.status(operation.job_id);
        // The actual image is included only when explicitly requested and
        // the current job is already a verified completed DRAFT. No image
        // token cost during RUNNING/CANCELLING/FAILED status checks.
        const finishedPreview = operation.include_preview &&
          current.state === "RENDERED_DRAFT"
            ? this.preview(current.job_id)
            : null;
        const receipt = current.receipt as RenderReceipt | null;
        const error = typeof current.error_code === "string" ? current.error_code : null;
        const cleanup = current.handoff_cleanup;
        const terminal = ["RENDERED_DRAFT", "FAILED", "CANCELLED"].includes(String(current.state));
        return {
          content: [{
            type: "text",
            text: "Blender job " + current.job_id + ": " + current.state +
              " (" + current.phase + ")." +
              (receipt ? " PNG saved at " + receipt.output_path + "." : "") +
              (error ? " Error: " + error + "." : "") +
              (cleanup === "REQUIRES_REVIEW"
                ? " Handoff requires inspection; any expected path is NOT proof that a file exists. Do not automatically repeat an uncertain native export."
                : terminal && cleanup === "PENDING"
                  ? " Automatic handoff cleanup is pending; do not replace this job yet."
                  : "") +
              (finishedPreview ? " Actual verified Cycles preview attached." : "") +
              " Visual quality remains NOT_EVALUATED.",
          }, ...(finishedPreview ? finishedPreview.content.slice(1) : [])],
          structuredContent: current,
        };
      }
      case "cancel": {
        const current = this.cancel(operation.job_id);
        return {
          content: [{
            type: "text",
            text: "Blender job " + current.job_id + ": " + current.state +
              ". Cancellation is not a confirmed process exit.",
          }],
          structuredContent: current,
        };
      }
      case "preview": return this.preview(operation.job_id);
      case "recover": {
        const current = await this.recover(operation.receipt_path);
        return {
          content: [{
            type: "text",
            text: "Validated completed Blender PNG receipt restored: " +
              current.job_id + ". This does not restart Blender or approve visual quality.",
          }],
          structuredContent: current,
        };
      }
      case "release": {
        const result = await this.releaseHandoff(operation.handoff_path);
        return {
          content: [{
            type: "text",
            text: "Explicit verified Blockbench GLB handoff released: " + operation.handoff_path,
          }],
          structuredContent: result,
        };
      }
    }
  }

  async close(): Promise<void> {
    this.retired = true;
    const job = this.current;
    if (job && job.state === "RUNNING" && job.phase !== "PUBLISHING") {
      this.cancel(job.id);
    }
    await job?.task;
  }
}
