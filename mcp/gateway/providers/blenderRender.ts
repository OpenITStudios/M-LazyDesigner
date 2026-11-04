/** Gateway-owned Blender renderer. This is an MCP capability, not a second
 * Gateway or a Blockbench plugin. It consumes only a verified immutable GLB
 * handoff and keeps one bounded Blender child-process job per Gateway process.
 */
import { randomBytes, createHash } from "node:crypto";
import * as childProcess from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  lstat, stat, readFile, writeFile, mkdtemp, rm, realpath,
} from "node:fs/promises";
import { basename, dirname, join, resolve, extname } from "node:path";
import { publicationRenderParameters, makePublicationJob, type PublicationRenderRequest } from "@/lib/publication/contracts";
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
    operation: z.literal("start"),
    handoff_path: z.string().min(1).max(2048),
    request: publicationRenderParameters,
  }).strict(),
  z.object({
    operation: z.literal("status"),
    // Omit job_id to recover latest process-local job after a lost start response.
    job_id: z.string().regex(ID).optional(),
  }).strict(),
  z.object({
    operation: z.literal("preview"),
    job_id: z.string().regex(ID),
  }).strict(),
  z.object({
    operation: z.literal("cancel"),
    job_id: z.string().regex(ID),
  }).strict(),
]);

export const BLENDER_RENDER_TOOL: BackendTool = {
  name: BLENDER_RENDER_CAPABILITY,
  description: "Control the Blender 5.2 Cycles renderer through the main LazyDesigner MCP Gateway, independently of the Blockbench plugin. First use render_publication operation=handoff in Blockbench to export a verified GLB+manifest. Then blender_render operation=start consumes that handoff and starts a Blender child process owned by the Gateway. status, preview and cancel use the returned job ID (status may omit it to recover the latest process-local job). A frozen snapshot is never claimed as the current editor state; the final PNG remains an unapproved DRAFT.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  // The same Zod contract validates local calls and the schema advertised to AI.
  // Branch selection is sourced from the canonical Gateway branch manifest.
  inputSchema: z.toJSONSchema(blenderRenderControlParameters),
};

export function shouldProbeBlenderRender(query: string): boolean {
  return /\bblender\b|\bcycles\b|blender_render|blender mcp|glb handoff/i.test(query);
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
  error_code: string | null;
  source_sha256: string | null;
  controller: AbortController;
  receipt: RenderReceipt | null;
  preview: Buffer | null;
  task: Promise<void> | null;
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
  };
}

function assertRunning(job: Job): void {
  if (job.controller.signal.aborted) {
    throw new Error("PUBLICATION_BLENDER_CANCELLED");
  }
}

async function verifyHandoff(path: string): Promise<{
  document: PublicationHandoff;
  glb: Buffer;
  directory: string;
}> {
  if (!isAbsoluteFilesystemPath(path) || basename(path) !== "handoff.json" ||
      !HANDOFF_DIR.test(basename(dirname(path))) ||
      /[\x00-\x1f]/.test(path)) {
    throw new Error("PUBLICATION_BLENDER_HANDOFF_PATH_INVALID");
  }
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

/** One Gateway-owned process, not a persistent render farm or native editor. */
export class BlenderRenderProvider {
  private current: Job | null = null;
  private retired = false;

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
    if (existsSync(request.output_path)) {
      throw new Error("PUBLICATION_OUTPUT_EXISTS: overwrite disabled.");
    }
    const workdir = await mkdtemp(join(outputDirectory, ".lazydesigner-blender-job-"));
    const glbPath = join(workdir, "model.glb");
    const workerPath = join(workdir, "render.py");
    const jobPath = join(workdir, "job.json");
    const outputPath = join(workdir, "output.png");
    const reportPath = join(workdir, "report.json");
    const evidencePath = join(workdir, "evidence.png");
    let preserve = false;
    try {
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
      job.phase = "PUBLISHING";
      // Deliberately synchronous no-overwrite output promotion: cancel
      // cannot interleave between the final check and atomic exclusive write.
      if (existsSync(request.output_path)) {
        throw new Error("PUBLICATION_BLENDER_OUTPUT_RACE_COLLISION");
      }
      writeFileSync(request.output_path, png, { flag: "wx" });
      if (hash(readFileSync(request.output_path)) !== hash(png)) {
        throw new Error("PUBLICATION_BLENDER_OUTPUT_READBACK_MISMATCH");
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
        try { await rm(workdir, { recursive: true, force: true }); }
        catch { console.warn("[LazyDesigner Blender MCP] Isolated job cleanup failed:", workdir); }
      }
    }
  }

  start(handoffPath: unknown, requestArgs: unknown): JsonRecord {
    if (this.retired) throw new Error("PUBLICATION_BLENDER_GATEWAY_RETIRED");
    if (this.current && ["RUNNING", "CANCELLING", "EXIT_UNCONFIRMED"].includes(this.current.state)) {
      throw new Error("PUBLICATION_BLENDER_JOB_BUSY");
    }
    if (typeof handoffPath !== "string" ||
        !isAbsoluteFilesystemPath(handoffPath) ||
        basename(handoffPath) !== "handoff.json" ||
        !HANDOFF_DIR.test(basename(dirname(handoffPath)))) {
      throw new Error("PUBLICATION_BLENDER_HANDOFF_PATH_INVALID");
    }
    const request = publicationRenderParameters.parse(requestArgs);
    const job: Job = {
      id: "blender_" + randomBytes(12).toString("hex"),
      state: "RUNNING", phase: "PREPARING_ASSETS",
      started_at: new Date().toISOString(), error_code: null,
      source_sha256: null, controller: new AbortController(),
      receipt: null, preview: null, task: null,
    };
    this.current = job;
    job.task = Promise.resolve().then(() => this.execute(job, handoffPath, request))
      .then(receipt => {
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
      });
    return status(job);
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

  invoke(args: JsonRecord): Result {
    const operation = blenderRenderControlParameters.parse(args);
    switch (operation.operation) {
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
        return {
          content: [{
            type: "text",
            text: "Blender job " + current.job_id + ": " + current.state +
              " (" + current.phase + "). No visual approval.",
          }],
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
