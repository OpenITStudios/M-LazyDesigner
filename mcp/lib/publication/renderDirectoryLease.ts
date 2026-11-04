import { join } from "node:path";

/**
 * Cooperative render admission for the ONE caller-selected output directory.
 * No daemon, GPU scheduler, or silent stale-lock breaking. mkdirSync is atomic
 * across independent Blockbench/Gateway processes using the same directory.
 *
 * This deliberately does NOT claim a host-wide GPU lock when output directories
 * differ. Owners must release only after confirmed Blender child exit.
 */
export const PUBLICATION_RENDER_LEASE_NAME = ".lazydesigner-cycles-active";

export type RenderDirectoryLeaseFs = {
  mkdirSync(path: string): unknown;
  rmdirSync(path: string): unknown;
};

export function acquirePublicationRenderDirectoryLease(
  fs: RenderDirectoryLeaseFs,
  outputDirectory: string,
): () => void {
  const lock = join(outputDirectory, PUBLICATION_RENDER_LEASE_NAME);
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    // A denied/unwritable output directory is NOT proof of another renderer.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      "PUBLICATION_RENDER_OUTPUT_DIRECTORY_BUSY: another Cycles job may be running " +
      "or a previous exit may be unconfirmed. Never delete its lease automatically.",
    );
  }
  let released = false;
  return () => {
    if (released) return;
    // Fail closed: the owner must not silently advertise that a still-present
    // lock was removed if another process replaced it after manual intervention.
    fs.rmdirSync(lock);
    released = true;
  };
}
