/// <reference types="blockbench-types" />
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";

import blenderWorker from "./worker/render.py" with { type: "text" };
import {
  blenderRenderArgs,
  makePublicationJob,
  publicationRenderParameters,
  type PublicationRenderRequest,
} from "@/lib/publication/contracts";
import {
  snapshotDetachedPublicationGlb,
  verifyPublicationSourceCurrent,
} from "./snapshot";

type ScopedPublicationFs = Pick<
  typeof import("node:fs"),
  "existsSync" | "statSync" | "mkdirSync" | "writeFileSync" |
  "readFileSync" | "unlinkSync" | "rmdirSync"
>;

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

function validatedPng(data: Buffer, width: number, height: number): void {
  if (data.length < 24 || data.length > 96 * 1024 * 1024 ||
      data.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("PUBLICATION_OUTPUT_PNG_INVALID_OR_OVERSIZED");
  }
  if (data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) {
    throw new Error("PUBLICATION_OUTPUT_DIMENSIONS_UNEXPECTED");
  }
}

async function runBlender(
  childProcess: typeof import("node:child_process"),
  executable: string,
  workerPath: string,
  jobPath: string,
  cwd: string,
): Promise<void> {
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
    let finished = false;
    let stderr = "";
    let stdout = "";
    const collect = (chunk: unknown, current: string): string =>
      (current + String(chunk)).slice(-8192);
    child.stdout?.on("data", chunk => { stdout = collect(chunk, stdout); });
    child.stderr?.on("data", chunk => { stderr = collect(chunk, stderr); });
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("PUBLICATION_BLENDER_TIMEOUT: bounded render exceeded 15 minutes."));
    }, 15 * 60 * 1000);
    child.on("error", error =>
      finish(new Error("PUBLICATION_BLENDER_PROCESS_ERROR: " + error.message)));
    child.on("close", (code, signal) => {
      if (code !== 0) {
        finish(new Error(
          "PUBLICATION_BLENDER_RENDER_FAILED: exit=" + String(code) +
          " signal=" + String(signal) + " " + stderr.slice(-1800),
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
export async function renderPublication(input: unknown): Promise<PublicationRenderReceipt> {
  const request = publicationRenderParameters.parse(input);
  const outputDirectory = dirname(request.output_path);
  const { fs, childProcess } = renderPermissions(outputDirectory);
  if (!fs.existsSync(outputDirectory) ||
      !fs.statSync(outputDirectory).isDirectory()) {
    throw new Error("PUBLICATION_OUTPUT_DIRECTORY_NOT_FOUND");
  }
  if (fs.existsSync(request.output_path)) {
    throw new Error("PUBLICATION_OUTPUT_EXISTS: choose a new PNG name; overwrite is disabled.");
  }
  const snapshot = await snapshotDetachedPublicationGlb();
  const workdir = join(outputDirectory, ".lazydesigner-render-" + randomBytes(12).toString("hex"));
  // Unique fresh workdir: never reuse or follow paths provided by a model.
  fs.mkdirSync(workdir);
  const glbPath = join(workdir, "model.glb");
  const workerPath = join(workdir, "render.py");
  const jobPath = join(workdir, "job.json");
  const tempOutput = join(workdir, "output.png");
  const workerSha = hash(blenderWorker);
  try {
    fs.writeFileSync(glbPath, snapshot.glb, { flag: "wx" });
    fs.writeFileSync(workerPath, blenderWorker, { flag: "wx" });
    const job = makePublicationJob(
      { ...request, output_path: tempOutput },
      {
        project_uuid: snapshot.project_uuid,
        sha256: snapshot.source_sha256,
        glb_path: glbPath,
        mesh_count: snapshot.cube_count,
        materials: snapshot.materials,
      },
    );
    fs.writeFileSync(jobPath, JSON.stringify(job), { flag: "wx" });
    await runBlender(childProcess, request.blender_executable, workerPath, jobPath, workdir);
    if (!fs.existsSync(tempOutput)) throw new Error("PUBLICATION_OUTPUT_MISSING");
    const raw = fs.readFileSync(tempOutput);
    const png = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    validatedPng(png, request.width, request.height);
    verifyPublicationSourceCurrent(snapshot.project_uuid, snapshot.source_sha256);
    // Exclusive destination create. No silent replacement and no success
    // receipt for an uncertain or partially overwritten result.
    if (fs.existsSync(request.output_path)) {
      throw new Error("PUBLICATION_OUTPUT_RACE_COLLISION");
    }
    fs.writeFileSync(request.output_path, png, { flag: "wx" });
    const result = fs.readFileSync(request.output_path);
    const persisted = Buffer.isBuffer(result) ? result : Buffer.from(result);
    if (hash(persisted) !== hash(png)) {
      throw new Error("PUBLICATION_OUTPUT_READBACK_MISMATCH: verify the file manually.");
    }
    return {
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
      output_path: request.output_path,
      output_png_sha256: hash(png),
      output_png_bytes: png.length,
      width: request.width,
      height: request.height,
      editor_state: "UNTOUCHED_BY_SNAPSHOT_AND_SOURCE_RECHECKED",
      visual_quality: "NOT_EVALUATED",
      live_minecraft_verified: false,
    };
  } finally {
    // Blockbench's ScopedFS rmSync is not reliably synchronous. Delete only
    // the four known files that this fresh job owns, then remove the empty dir.
    // Never recurse into or follow arbitrary paths during renderer cleanup.
    try {
      for (const file of [glbPath, workerPath, jobPath, tempOutput]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      fs.rmdirSync(workdir);
    } catch {
      // Leave unremoved temporary files for explicit, safe recovery. Never
      // touch the existing editor project or another job's directories.
      console.warn("[LazyDesigner Render] Temporary render job cleanup failed:", workdir);
    }
  }
}
