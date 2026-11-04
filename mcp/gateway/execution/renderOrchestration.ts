import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  makeAutomaticPublicationRequest,
} from "@/lib/publication/contracts";
import { PUBLICATION_HANDOFF_KIND } from "@/lib/publication/handoffContract";
import type { BlockitRuntimeBackend } from "../runtime/backend";
import type { JsonRecord } from "../contracts/protocol";
import type { BlenderRenderProvider } from "../providers/blenderRender";

/** One native Blockbench export through the existing serialized Runtime backend. */
export type NativePublicationHandoff = (
  directory: string, signal: AbortSignal,
) => Promise<string>;

const SHA = /^[a-f0-9]{64}$/;
const HANDOFF_DIR = /^\.lazydesigner-blender-handoff-[a-f0-9]{24}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Native result identity must match the verified Gateway-bound Blockbench tab. */
export function createNativePublicationHandoff(
  backend: Pick<BlockitRuntimeBackend, "invokeCapabilityWithMetadata">,
): NativePublicationHandoff {
  return async (directory, signal) => {
    // A native export with uncertain outcome must NOT be replayed.
    const invocation = await backend.invokeCapabilityWithMetadata(
      "render_publication", { operation: "handoff", request: { directory } },
      undefined, signal,
    );
    const receipt = invocation.result.structuredContent;
    if (invocation.result.isError === true || !record(receipt) ||
        typeof receipt.handoff_path !== "string" ||
        receipt.handoff_kind !== PUBLICATION_HANDOFF_KIND ||
        typeof receipt.project_uuid !== "string" ||
        !SHA.test(String(receipt.source_sha256)) ||
        !SHA.test(String(receipt.glb_sha256))) {
      throw new Error(
        "PUBLICATION_AUTO_HANDOFF_UNCONFIRMED: native export did not return a complete trusted source receipt. Inspect before retrying.",
      );
    }
    if (!invocation.verifiedProjectUuid ||
        invocation.verifiedProjectUuid !== receipt.project_uuid) {
      throw new Error(
        "PUBLICATION_AUTO_SOURCE_AFFINITY_MISMATCH: native handoff is not bound to the verified Blockbench project.",
      );
    }
    return receipt.handoff_path;
  };
}

/** Cross-app routing only. The Blender provider owns the actual render job. */
export function startAutomaticPublication(
  blender: BlenderRenderProvider,
  prepareNativeHandoff: NativePublicationHandoff | undefined,
  options: unknown,
  config: { blender_executable?: string; output_directory?: string } = {
    blender_executable: process.env.LAZYDESIGNER_BLENDER_EXECUTABLE,
    output_directory: process.env.LAZYDESIGNER_RENDER_OUTPUT_DIRECTORY,
  },
): JsonRecord {
  if (!prepareNativeHandoff) {
    throw new Error("PUBLICATION_AUTO_NATIVE_RUNTIME_UNAVAILABLE");
  }
  const { directory, request } = makeAutomaticPublicationRequest(
    options, config, randomBytes(12).toString("hex"),
  );
  try {
    const output = fs.lstatSync(directory);
    const binary = fs.lstatSync(request.blender_executable);
    if (!output.isDirectory() || output.isSymbolicLink() ||
        !binary.isFile() || binary.isSymbolicLink()) {
      throw new Error("INVALID_FILESYSTEM_TARGET");
    }
  } catch {
    throw new Error(
      "PUBLICATION_AUTO_CONFIG_PATH_UNAVAILABLE: configure an existing shared output directory and Blender executable.",
    );
  }
  // This callback resolves the source once. It does not create a second job,
  // retry native mutations, or let Blender claim the current editor state.
  return blender.startPreparedHandoff(async signal => {
    const handoff_path = await prepareNativeHandoff(directory, signal);
    if (basename(handoff_path) !== "handoff.json" ||
        !HANDOFF_DIR.test(basename(dirname(handoff_path))) ||
        resolve(dirname(dirname(handoff_path))) !== resolve(directory)) {
      throw new Error("PUBLICATION_AUTO_HANDOFF_OUTSIDE_CONFIGURED_DIRECTORY");
    }
    return { handoff_path, request };
  });
}
