/// <reference types="blockbench-types" />
/** Blockbench owns ONLY this immutable, explicit local GLB handoff.
 * Blender/Gateway never receives a native Cube/Texture reference or Undo owner.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import {
  MAX_PUBLICATION_HANDOFF_BYTES,
  PUBLICATION_HANDOFF_KIND,
  parsePublicationHandoff,
} from "@/lib/publication/handoffContract";
import { snapshotDetachedPublicationGlb } from "./snapshot";

export const publicationHandoffParameters = z.object({
  // Optional caller-owned nonce makes an interrupted export discoverable
  // without enumerating unrelated directories or replaying the mutation.
  handoff_id: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  directory: z.string().min(1).max(2048).refine(
    value => isAbsoluteFilesystemPath(value) &&
      !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value) &&
      !/[\x00-\x1f]/.test(value),
    "Select an absolute, existing, user-approved local directory for GLB handoff.",
  ),
}).strict();

type HandoffFs = Pick<typeof import("node:fs"),
  "existsSync" | "statSync" | "mkdirSync" | "writeFileSync" |
  "unlinkSync" | "rmdirSync">;

export async function preparePublicationHandoff(input: unknown): Promise<{
  handoff_path: string;
  glb_path: string;
  project_uuid: string;
  source_sha256: string;
  glb_sha256: string;
  cube_count: number;
  material_count: number;
  handoff_kind: typeof PUBLICATION_HANDOFF_KIND;
}> {
  const { directory, handoff_id } = publicationHandoffParameters.parse(input);
  if (typeof requireNativeModule !== "function") {
    throw new Error("PUBLICATION_HANDOFF_DESKTOP_PERMISSIONS_REQUIRED");
  }
  const fs = requireNativeModule("fs", {
    scope: directory,
    message: "Save the current authored Blockbench model as a verified immutable GLB handoff for Blender MCP rendering.",
    optional: true,
  }) as HandoffFs | undefined;
  if (!fs) throw new Error("PUBLICATION_HANDOFF_PERMISSION_DENIED");
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error("PUBLICATION_HANDOFF_DIRECTORY_UNAVAILABLE");
  }
  // Invoked within the same serialized native MCP Runtime as other tools.
  const source = await snapshotDetachedPublicationGlb();
  const document = parsePublicationHandoff({
    kind: PUBLICATION_HANDOFF_KIND,
    schema_version: 1,
    project_uuid: source.project_uuid,
    source_sha256: source.source_sha256,
    source_manifest_sha256: source.source_manifest_sha256,
    glb_sha256: source.glb_sha256,
    cube_count: source.cube_count,
    material_count: source.material_count,
    source_manifest: source.source_manifest,
    materials: source.materials,
  });
  const json = Buffer.from(JSON.stringify(document));
  if (json.length > MAX_PUBLICATION_HANDOFF_BYTES) {
    throw new Error("PUBLICATION_HANDOFF_SOURCE_MANIFEST_TOO_LARGE");
  }
  const ownerDir = join(
    directory,
    ".lazydesigner-blender-handoff-" + (handoff_id ?? randomBytes(12).toString("hex")),
  );
  const glbPath = join(ownerDir, "model.glb");
  const handoffPath = join(ownerDir, "handoff.json");
  fs.mkdirSync(ownerDir);
  try {
    fs.writeFileSync(glbPath, source.glb, { flag: "wx" });
    fs.writeFileSync(handoffPath, json, { flag: "wx" });
  } catch (error) {
    // Remove ONLY the two files generated for this specific failed handoff.
    try {
      for (const path of [handoffPath, glbPath]) {
        if (fs.existsSync(path)) fs.unlinkSync(path);
      }
      fs.rmdirSync(ownerDir);
    } catch { /* Keep a partial owned directory for explicit inspection. */ }
    throw error;
  }
  return {
    handoff_path: handoffPath,
    glb_path: glbPath,
    project_uuid: source.project_uuid,
    source_sha256: source.source_sha256,
    glb_sha256: source.glb_sha256,
    cube_count: source.cube_count,
    material_count: source.material_count,
    handoff_kind: PUBLICATION_HANDOFF_KIND,
  };
}
