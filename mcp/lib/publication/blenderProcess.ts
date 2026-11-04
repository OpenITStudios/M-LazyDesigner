/** Trusted publication Blender 5.2 worker and subprocess lifecycle. 
 * One implementation shared by the Blockbench Runtime and the Gateway Blender adapter.
 * No editor globals, user-provided Python, or second render engine.
 */
import { createHash } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { blenderRenderArgs } from "@/lib/publication/contracts";
import blenderWorker from "../../server/publication/worker/render.py" with { type: "text" };
import coreAssetsSource from "../../server/publication/worker/core_assets.py" with { type: "text" };
import cameraDirectorSource from "../../server/publication/worker/camera_director.py" with { type: "text" };
import lightingDirectorSource from "../../server/publication/worker/lighting_director.py" with { type: "text" };
import compositorDirectorSource from "../../server/publication/worker/compositor_director.py" with { type: "text" };
import qualityReportSource from "../../server/publication/worker/quality_report.py" with { type: "text" };

export const BLENDER_CORE_MODULES = [
  ["core_assets.py", coreAssetsSource],
  ["camera_director.py", cameraDirectorSource],
  ["lighting_director.py", lightingDirectorSource],
  ["compositor_director.py", compositorDirectorSource],
  ["quality_report.py", qualityReportSource],
] as const;

export { blenderWorker as BLENDER_PUBLICATION_WORKER };

/** Content identity for the one trusted Python worker bundle, shared by both render owners. */
export const BLENDER_WORKER_SHA256 = createHash("sha256")
  .update(
    [["render.py", blenderWorker], ...BLENDER_CORE_MODULES]
      .map(([name, source]) => name + "\0" + source)
      .join("\0"),
  )
  .digest("hex");

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
    let processError: Error | null = null;
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
      // A prior process 'error' may already be waiting for close.
      if (graceTimer !== null) clearTimeout(graceTimer);
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
      if (settled || stopReason || processError) return;
      // Node can emit 'error' before 'close'. The latter confirms both the
      // subprocess and its stdio are no longer using our temporary GLB.
      processError = new Error("PUBLICATION_BLENDER_PROCESS_ERROR: " + error.message);
      graceTimer = setTimeout(() => finish(new Error(
        "PUBLICATION_BLENDER_EXIT_UNCONFIRMED: Blender process error without confirmed close. " +
        "The isolated job directory must be retained.",
      )), terminationGraceMs);
    });
    child.on("close", (code, signalName) => {
      if (stopReason === "TIMEOUT") {
        finish(new Error("PUBLICATION_BLENDER_TIMEOUT: Cycles render exceeded the configured deadline."));
      } else if (stopReason === "CANCELLED") {
        finish(new Error("PUBLICATION_BLENDER_CANCELLED: output was not promoted."));
      } else if (processError) {
        finish(processError);
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


