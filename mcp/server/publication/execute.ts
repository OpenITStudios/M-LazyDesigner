/// <reference types="blockbench-types" />
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { inspectPublicationPng } from "@/lib/publication/pngIntegrity";
import { getRuntimeLifecycleSnapshot, runRuntimeOperationExclusive } from "@/lib/runtime/lifecycle";
import { validateHdriBytes } from "@/lib/publication/environment";
import {
  publicationDiagnosticsSchema,
  compactPublicationDiagnostics,
  type PublicationDiagnostics,
} from "@/lib/publication/diagnostics";

import blenderWorker from "./worker/render.py" with { type: "text" };
import coreAssetsSource from "./worker/core_assets.py" with { type: "text" };
import cameraDirectorSource from "./worker/camera_director.py" with { type: "text" };
import lightingDirectorSource from "./worker/lighting_director.py" with { type: "text" };
import compositorDirectorSource from "./worker/compositor_director.py" with { type: "text" };
import qualityReportSource from "./worker/quality_report.py" with { type: "text" };

const BLENDER_CORE_MODULES = [
  ["core_assets.py", coreAssetsSource],
  ["camera_director.py", cameraDirectorSource],
  ["lighting_director.py", lightingDirectorSource],
  ["compositor_director.py", compositorDirectorSource],
  ["quality_report.py", qualityReportSource],
] as const;
import {
  blenderRenderArgs,
  makePublicationJob,
  publicationRenderParameters,
  type PublicationRenderRequest,
  type PublicationJob,
} from "@/lib/publication/contracts";
import {
  snapshotDetachedPublicationGlb,
  verifyPublicationSourceCurrent,
  type DetachedPublicationSnapshot,
} from "./snapshot";

type ScopedPublicationFs = Pick<
  typeof import("node:fs"),
  "existsSync" | "statSync" | "mkdirSync" | "writeFileSync" |
  "readFileSync" | "unlinkSync" | "rmdirSync"
>;

export type PublicationRenderPhase =
  | "PREPARING_ASSETS"
  | "RENDERING_CYCLES"
  | "VERIFYING_OUTPUT"
  | "PUBLISHING"
  | "FINISHED"
  | "CANCELLING"
  | "CANCELLED"
  | "FAILED";

export type PublicationRenderReceipt = {
  state: "RENDERED_DRAFT";
  source_project_uuid: string;
  source_sha256: string;
  glb_sha256: string;
  worker_sha256: string;
  cube_count: number;
  material_count: number;
  blender_target: "5.2.x";
  engine: "CYCLES";
  quality: PublicationRenderRequest["quality"];
  render_settings: Pick<PublicationJob,
    "background" | "camera" | "look" | "samples" | "noise_threshold" |
    "device" | "view_transform"
  > & { environment: { mode: "studio" | "hdri"; sha256: string | null } };
  diagnostics: ReturnType<typeof compactPublicationDiagnostics>;
  visual_evidence: {
    kind: "DOWNSAMPLED_FINAL_CYCLES_PNG";
    png_sha256: string;
    byte_length: number;
    width: number;
    height: number;
    visual_review: "NOT_EVALUATED";
  };
  output_path: string;
  output_png_sha256: string;
  output_png_bytes: number;
  width: number;
  height: number;
  editor_state: "UNTOUCHED_BY_SNAPSHOT_AND_SOURCE_RECHECKED";
  visual_quality: "NOT_EVALUATED";
  live_minecraft_verified: false;
};

function hash(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// Owned by the completed publication receipt, not by a second job registry.
// Weak keys allow old preview buffers to be reclaimed after a new job begins.
const validatedEvidence = new WeakMap<PublicationRenderReceipt, Buffer>();

export function getPublicationEvidenceBytes(receipt: PublicationRenderReceipt): Buffer {
  const bytes = validatedEvidence.get(receipt);
  if (!bytes || receipt.state !== "RENDERED_DRAFT") {
    throw new Error("PUBLICATION_RENDER_EVIDENCE_NOT_AVAILABLE");
  }
  if (bytes.length !== receipt.visual_evidence.byte_length ||
      bytes.length > 2_000_000 ||
      hash(bytes) !== receipt.visual_evidence.png_sha256) {
    throw new Error("PUBLICATION_RENDER_EVIDENCE_CHECKSUM_MISMATCH");
  }
  // Return a copy so a consumer cannot modify future observations.
  return Buffer.from(bytes);
}

function renderPermissions(directory: string): {
  fs: ScopedPublicationFs;
  childProcess: typeof import("node:child_process");
} {
  if (typeof requireNativeModule !== "function") {
    throw new Error("PUBLICATION_DESKTOP_PERMISSIONS_REQUIRED");
  }
  const fs = requireNativeModule("fs", {
    scope: directory,
    message: "Save a LazyDesigner publication PNG and temporary Blender render assets in this directory.",
    optional: true,
  }) as ScopedPublicationFs | undefined;
  if (!fs) throw new Error("PUBLICATION_FILESYSTEM_PERMISSION_DENIED");
  const childProcess = requireNativeModule("child_process", {
    message: "Launch the locally installed Blender 5.2 renderer for this explicit publication render request.",
    optional: true,
  });
  if (!childProcess) throw new Error("PUBLICATION_PROCESS_PERMISSION_DENIED");
  return { fs, childProcess };
}


/**
 * Wait for confirmed Blender process close before touching its input files.
 * When a process ignores termination, preserve its job directory rather than
 * deleting a GLB/script it might still be reading.
 */
export async function runBlender(
  childProcess: typeof import("node:child_process"),
  executable: string,
  workerPath: string,
  jobPath: string,
  cwd: string,
  timeoutMs = 15 * 60 * 1000,
  terminationGraceMs = 12_000,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("PUBLICATION_BLENDER_CANCELLED");
  const argv = blenderRenderArgs(workerPath, jobPath);
  await new Promise<void>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = childProcess.spawn(executable, argv, {
        cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new Error("PUBLICATION_BLENDER_LAUNCH_FAILED: " + String(error)));
      return;
    }

    let settled = false;
    let stopReason: "TIMEOUT" | "CANCELLED" | null = null;
    let stderr = "";
    let stdout = "";
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const collect = (chunk: unknown, current: string): string =>
      (current + String(chunk)).slice(-8192);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const terminate = (reason: "TIMEOUT" | "CANCELLED") => {
      if (settled || stopReason) return;
      stopReason = reason;
      try { child.kill(); } catch { /* exit may remain uncertain */ }
      graceTimer = setTimeout(() => finish(new Error(
        "PUBLICATION_BLENDER_EXIT_UNCONFIRMED: Blender did not close after termination. " +
        "The isolated job directory must be retained.",
      )), terminationGraceMs);
    };
    const onAbort = () => terminate("CANCELLED");
    const timeoutTimer = setTimeout(() => terminate("TIMEOUT"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout?.on("data", chunk => { stdout = collect(chunk, stdout); });
    child.stderr?.on("data", chunk => { stderr = collect(chunk, stderr); });
    child.on("error", error => {
      if (!stopReason) finish(new Error(
        "PUBLICATION_BLENDER_PROCESS_ERROR: " + error.message,
      ));
    });
    child.on("close", (code, signalName) => {
      if (stopReason === "TIMEOUT") {
        finish(new Error("PUBLICATION_BLENDER_TIMEOUT: Cycles render exceeded the configured deadline."));
      } else if (stopReason === "CANCELLED") {
        finish(new Error("PUBLICATION_BLENDER_CANCELLED: output was not promoted."));
      } else if (code !== 0) {
        finish(new Error(
          "PUBLICATION_BLENDER_RENDER_FAILED: exit=" + String(code) +
          " signal=" + String(signalName) + " " + stderr.slice(-1800),
        ));
      } else if (!stdout.includes("LAZYDESIGNER_RENDER_OUTPUT=")) {
        finish(new Error("PUBLICATION_BLENDER_OUTPUT_RECEIPT_MISSING"));
      } else {
        finish();
      }
    });
  });
}

/**
 * One source of truth for human plugin UI and MCP Runtime capability.
 * Blender is an explicitly selected local executable, never a network service.
 * External PNG is deliberately DRAFT until independent artistic/user review.
 */
/** Called within the native serialized Runtime operation before returning a job ID. */
export type PreparedPublicationRender = Readonly<{
  request: PublicationRenderRequest;
  snapshot: DetachedPublicationSnapshot;
  runtime_generation: number;
}>;

export async function preparePublicationRender(input: unknown): Promise<PreparedPublicationRender> {
  const request = publicationRenderParameters.parse(input);
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) {
    throw new Error("PUBLICATION_RUNTIME_GENERATION_REQUIRED");
  }
  const snapshot = await snapshotDetachedPublicationGlb();
  if (getRuntimeLifecycleSnapshot().owner_generation !== generation) {
    throw new Error("PUBLICATION_RUNTIME_GENERATION_CHANGED_DURING_SNAPSHOT");
  }
  return { request, snapshot, runtime_generation: generation };
}

/** Cycles may run after the native queue releases: it consumes only immutable GLB bytes. */
export async function renderPreparedPublication(
  prepared: PreparedPublicationRender,
  signal?: AbortSignal,
  onPhase?: (phase: PublicationRenderPhase) => void,
): Promise<PublicationRenderReceipt> {
  const { request, snapshot } = prepared;
  onPhase?.("PREPARING_ASSETS");
  const assertActive = () => {
    if (signal?.aborted) throw new Error("PUBLICATION_BLENDER_CANCELLED");
  };
  assertActive();
  const outputDirectory = dirname(request.output_path);
  const { fs, childProcess } = renderPermissions(outputDirectory);
  if (!fs.existsSync(outputDirectory) ||
      !fs.statSync(outputDirectory).isDirectory()) {
    throw new Error("PUBLICATION_OUTPUT_DIRECTORY_NOT_FOUND");
  }
  if (fs.existsSync(request.output_path)) {
    throw new Error("PUBLICATION_OUTPUT_EXISTS: choose a new PNG name; overwrite is disabled.");
  }
  // A user-provided HDRI is a separate, explicit filesystem permission.
  // The Blender worker never reads arbitrary user paths, only copied verified
  // bytes in its own isolated render job directory.
  let hdriSource: Buffer | null = null;
  let hdriSha: string | null = null;
  let hdriSuffix: ".hdr" | ".exr" | null = null;
  if (request.environment.mode === "hdri") {
    const sourcePath = request.environment.hdri_path!;
    const inputDirectory = dirname(sourcePath);
    const inputFs = requireNativeModule("fs", {
      scope: inputDirectory,
      message: "Read the selected HDRI environment image for this one Blender render.",
      optional: true,
    }) as ScopedPublicationFs | undefined;
    if (!inputFs) throw new Error("PUBLICATION_HDRI_READ_PERMISSION_DENIED");
    if (!inputFs.existsSync(sourcePath)) throw new Error("PUBLICATION_HDRI_SOURCE_MISSING");
    const stat = inputFs.statSync(sourcePath);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || stat.size < 16) {
      throw new Error("PUBLICATION_HDRI_FILE_INVALID_OR_OVERSIZED");
    }
    const raw = inputFs.readFileSync(sourcePath);
    hdriSource = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    validateHdriBytes(sourcePath, hdriSource);
    hdriSha = hash(hdriSource);
    hdriSuffix = /\.exr$/i.test(sourcePath) ? ".exr" : ".hdr";
  }
  const workdir = join(outputDirectory, ".lazydesigner-render-" + randomBytes(12).toString("hex"));
  // Unique fresh workdir: never reuse or follow paths provided by a model.
  fs.mkdirSync(workdir);
  const glbPath = join(workdir, "model.glb");
  const workerPath = join(workdir, "render.py");
  const jobPath = join(workdir, "job.json");
  const tempOutput = join(workdir, "output.png");
  const reportPath = join(workdir, "report.json");
  const evidencePath = join(workdir, "evidence.png");
  const hdriTarget = hdriSuffix ? join(workdir, "environment" + hdriSuffix) : null;
  const moduleFiles = BLENDER_CORE_MODULES.map(([name, source]) => ({
    path: join(workdir, name), source,
  }));
  // Source identity covers the ENTIRE trusted Blender Core, not only entry.py.
  const workerSha = hash(
    [["render.py", blenderWorker], ...BLENDER_CORE_MODULES]
      .map(([name, source]) => name + "\0" + source).join("\0"),
  );
  let preserveTemporaryJob = false;
  try {
    fs.writeFileSync(glbPath, snapshot.glb, { flag: "wx" });
    fs.writeFileSync(workerPath, blenderWorker, { flag: "wx" });
    for (const module of moduleFiles) {
      fs.writeFileSync(module.path, module.source, { flag: "wx" });
    }
    if (hdriTarget && hdriSource && hdriSha) {
      fs.writeFileSync(hdriTarget, hdriSource, { flag: "wx" });
      hdriSource = null; // Release large source bytes before Cycles starts.
    }
    const job = makePublicationJob(
      { ...request, output_path: tempOutput },
      {
        project_uuid: snapshot.project_uuid,
        sha256: snapshot.source_sha256,
        glb_path: glbPath,
        mesh_count: snapshot.cube_count,
        materials: snapshot.materials,
        ...(hdriTarget && hdriSha
          ? { environment_asset: { path: hdriTarget, sha256: hdriSha } }
          : {}),
      },
    );
    fs.writeFileSync(jobPath, JSON.stringify(job), { flag: "wx" });
    onPhase?.("RENDERING_CYCLES");
    await runBlender(childProcess, request.blender_executable, workerPath, jobPath, workdir,
      15 * 60 * 1000, 12_000, signal);
    assertActive();
    onPhase?.("VERIFYING_OUTPUT");
    if (!fs.existsSync(tempOutput)) throw new Error("PUBLICATION_OUTPUT_MISSING");
    const raw = fs.readFileSync(tempOutput);
    const png = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    inspectPublicationPng(png, request.width, request.height);
    if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size > 64_000) {
      throw new Error("PUBLICATION_RENDER_DIAGNOSTICS_MISSING_OR_OVERSIZED");
    }
    let diagnostics: PublicationDiagnostics;
    try {
      diagnostics = publicationDiagnosticsSchema.parse(
        JSON.parse(fs.readFileSync(reportPath, "utf8") as string),
      );
    } catch (error) {
      throw new Error("PUBLICATION_RENDER_DIAGNOSTICS_INVALID: " + String(error));
    }
    if (diagnostics.asset.mesh_count !== snapshot.cube_count ||
        diagnostics.asset.material_count !== snapshot.material_count ||
        diagnostics.image.image_dimensions[0] !== request.width ||
        diagnostics.image.image_dimensions[1] !== request.height) {
      throw new Error("PUBLICATION_RENDER_DIAGNOSTICS_SOURCE_MISMATCH");
    }
    if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile() ||
        fs.statSync(evidencePath).size > 2_000_000 ||
        fs.statSync(evidencePath).size < 57) {
      throw new Error("PUBLICATION_RENDER_EVIDENCE_MISSING_OR_OVERSIZED");
    }
    const evidenceRaw = fs.readFileSync(evidencePath);
    const evidenceBytes = Buffer.isBuffer(evidenceRaw) ? evidenceRaw : Buffer.from(evidenceRaw);
    inspectPublicationPng(
      evidenceBytes,
      diagnostics.preview.dimensions[0],
      diagnostics.preview.dimensions[1],
    );
    onPhase?.("PUBLISHING");
    // Run the last native source fingerprint and the exclusive final write in
    // one serialized Runtime operation. Blender itself rendered immutable
    // detached GLB bytes without occupying this queue.
    await runRuntimeOperationExclusive(prepared.runtime_generation, async () => {
      assertActive();
      verifyPublicationSourceCurrent(snapshot.project_uuid, snapshot.source_sha256);
      if (fs.existsSync(request.output_path)) {
        throw new Error("PUBLICATION_OUTPUT_RACE_COLLISION");
      }
      assertActive();
      fs.writeFileSync(request.output_path, png, { flag: "wx" });
      const result = fs.readFileSync(request.output_path);
      const persisted = Buffer.isBuffer(result) ? result : Buffer.from(result);
      if (hash(persisted) !== hash(png)) {
        throw new Error("PUBLICATION_OUTPUT_READBACK_MISMATCH: verify the file manually.");
      }
    }, { signal });
    const completed: PublicationRenderReceipt = {
      state: "RENDERED_DRAFT",
      source_project_uuid: snapshot.project_uuid,
      source_sha256: snapshot.source_sha256,
      glb_sha256: snapshot.glb_sha256,
      worker_sha256: workerSha,
      cube_count: snapshot.cube_count,
      material_count: snapshot.material_count,
      blender_target: "5.2.x",
      engine: "CYCLES",
      quality: request.quality,
      render_settings: {
        background: job.background,
        camera: job.camera,
        look: job.look,
        samples: job.samples,
        noise_threshold: job.noise_threshold,
        device: job.device,
        view_transform: job.view_transform,
        environment: { mode: job.environment.mode, sha256: job.environment.hdri_sha256 },
      },
      diagnostics: compactPublicationDiagnostics(diagnostics),
      visual_evidence: {
        kind: "DOWNSAMPLED_FINAL_CYCLES_PNG",
        png_sha256: hash(evidenceBytes),
        byte_length: evidenceBytes.length,
        width: diagnostics.preview.dimensions[0],
        height: diagnostics.preview.dimensions[1],
        visual_review: "NOT_EVALUATED",
      },
      output_path: request.output_path,
      output_png_sha256: hash(png),
      output_png_bytes: png.length,
      width: request.width,
      height: request.height,
      editor_state: "UNTOUCHED_BY_SNAPSHOT_AND_SOURCE_RECHECKED",
      visual_quality: "NOT_EVALUATED",
      live_minecraft_verified: false,
    };
    validatedEvidence.set(completed, evidenceBytes);
    return completed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PUBLICATION_BLENDER_EXIT_UNCONFIRMED")) {
      preserveTemporaryJob = true;
    }
    throw error;
  } finally {
    // A process that did not confirm exit may still be using the input GLB.
    if (preserveTemporaryJob) {
      console.warn("[LazyDesigner Render] Process exit unconfirmed; isolated job preserved:", workdir);
    } else {
      // Blockbench ScopedFS.rmSync is not reliably synchronous. Delete only
      // the four known files created for this job, then its empty directory.
      try {
        for (const file of [
          glbPath, workerPath, jobPath, tempOutput, reportPath, evidencePath,
          ...(hdriTarget ? [hdriTarget] : []),
          ...moduleFiles.map(item => item.path),
        ]) {
          if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        fs.rmdirSync(workdir);
      } catch {
        console.warn("[LazyDesigner Render] Temporary render job cleanup failed:", workdir);
      }
    }
  }
}


/** Compatibility path for direct explicit callers; normal AI/UI use nonblocking jobs. */
export async function renderPublication(input: unknown, signal?: AbortSignal): Promise<PublicationRenderReceipt> {
  const generation = getRuntimeLifecycleSnapshot().owner_generation;
  if (generation === null) throw new Error("PUBLICATION_RUNTIME_GENERATION_REQUIRED");
  const prepared = await runRuntimeOperationExclusive(
    generation, () => preparePublicationRender(input), { signal },
  );
  return renderPreparedPublication(prepared, signal);
}
