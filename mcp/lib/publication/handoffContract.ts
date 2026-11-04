/** Signed-by-content (not authenticated) local Blockbench -> Gateway Blender handoff.
 * The caller explicitly chooses the directory. Every payload is treated as
 * untrusted until GLB/source structural and checksum preflight succeeds.
 */
import type { PublicationSourceManifest } from "@/lib/publication/sourceManifest";
import type { PublicationJob } from "@/lib/publication/contracts";

export const PUBLICATION_HANDOFF_KIND = "lazydesigner.blockbench-glb-handoff.v1" as const;
export const MAX_PUBLICATION_HANDOFF_BYTES = 12 * 1024 * 1024;
export const MAX_PUBLICATION_HANDOFF_GLB_BYTES = 96 * 1024 * 1024;

export type PublicationHandoff = Readonly<{
  kind: typeof PUBLICATION_HANDOFF_KIND;
  schema_version: 1;
  project_uuid: string;
  source_sha256: string;
  source_manifest_sha256: string;
  glb_sha256: string;
  cube_count: number;
  material_count: number;
  source_manifest: PublicationSourceManifest;
  materials: PublicationJob["materials"];
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const MATERIAL_NAME = /^ld_color_[A-Za-z0-9_-]{1,160}$/;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Bounded, deterministic structural admission before touching Blender. */
export function parsePublicationHandoff(value: unknown): PublicationHandoff {
  if (!object(value) || value.kind !== PUBLICATION_HANDOFF_KIND ||
      value.schema_version !== 1 ||
      typeof value.project_uuid !== "string" ||
      value.project_uuid.length < 1 || value.project_uuid.length > 160 ||
      !SHA256.test(String(value.source_sha256)) ||
      !SHA256.test(String(value.source_manifest_sha256)) ||
      !SHA256.test(String(value.glb_sha256)) ||
      !Number.isSafeInteger(value.cube_count) ||
      !Number.isSafeInteger(value.material_count) ||
      (value.cube_count as number) < 1 || (value.cube_count as number) > 10000 ||
      (value.material_count as number) < 1 ||
      (value.material_count as number) > 128 ||
      !object(value.source_manifest) || !object(value.materials)) {
    throw new Error("PUBLICATION_HANDOFF_HEADER_INVALID");
  }
  const manifest = value.source_manifest;
  if (manifest.schema_version !== 1 ||
      manifest.target_kind !== "ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES" ||
      manifest.project_uuid !== value.project_uuid ||
      manifest.source_sha256 !== value.source_sha256 ||
      manifest.pose_mode !== "EDIT_STATIC_VERIFIED" ||
      !Array.isArray(manifest.cubes) ||
      manifest.cubes.length !== value.cube_count) {
    throw new Error("PUBLICATION_HANDOFF_SOURCE_MANIFEST_INVALID");
  }
  const cubeIds = new Set<string>();
  for (const cube of manifest.cubes) {
    if (!object(cube) || typeof cube.cube_uuid !== "string" ||
        !cube.cube_uuid || cube.cube_uuid.length > 160 ||
        cubeIds.has(cube.cube_uuid) ||
        !SHA256.test(String(cube.gltf_uv_sha256)) ||
        !SHA256.test(String(cube.index_sha256)) ||
        !SHA256.test(String(cube.blender_triangle_sha256)) ||
        !Number.isSafeInteger(cube.uv_vertex_count) ||
        (cube.uv_vertex_count as number) < 3 ||
        !Array.isArray(cube.primitives) ||
        cube.primitives.length < 1 || cube.primitives.length > 6 ||
        !Array.isArray(cube.expected_blender_bounds_min) ||
        !Array.isArray(cube.expected_blender_bounds_max) ||
        cube.expected_blender_bounds_min.length !== 3 ||
        cube.expected_blender_bounds_max.length !== 3 ||
        [...cube.expected_blender_bounds_min, ...cube.expected_blender_bounds_max]
          .some(v => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error("PUBLICATION_HANDOFF_CUBE_PROVENANCE_INVALID");
    }
    cubeIds.add(cube.cube_uuid);
  }
  const names = Object.keys(value.materials);
  if (names.length !== value.material_count) {
    throw new Error("PUBLICATION_HANDOFF_MATERIAL_COUNT_MISMATCH");
  }
  for (const name of names) {
    const receipt = value.materials[name];
    if (!MATERIAL_NAME.test(name) || !object(receipt) ||
        typeof receipt.color_uuid !== "string" ||
        name !== "ld_color_" + receipt.color_uuid ||
        receipt.alpha_mode !== "OPAQUE" ||
        (receipt.pbr !== "NONE" && receipt.pbr !== "MAPPED") ||
        !object(receipt.gltf) || !object(receipt.import_png_sha256) ||
        !SHA256.test(String(receipt.texture_sha256))) {
      throw new Error("PUBLICATION_HANDOFF_MATERIAL_PROVENANCE_INVALID");
    }
    const expected: string[] = ["base"];
    if (receipt.gltf.metallic_roughness_texture === true) expected.push("mer");
    if (receipt.gltf.normal_texture === true) expected.push("normal");
    if (receipt.gltf.emissive_texture === true) expected.push("emission");
    const pngs = receipt.import_png_sha256;
    const roles = Object.keys(pngs).sort();
    if (roles.join(",") !== expected.sort().join(",") ||
        roles.some(role => !SHA256.test(String(pngs[role])))) {
      throw new Error("PUBLICATION_HANDOFF_IMAGE_PROVENANCE_INVALID");
    }
  }
  return value as unknown as PublicationHandoff;
}
