import { createHash } from "node:crypto";

/**
 * Source-faithful Bedrock Cube -> GLB still-render contract.
 * Pure, import-safe and scoped to existing LazyDesigner-authored Cube geometry.
 */
export const PUBLICATION_UNITS_PER_MINECRAFT_BLOCK = 16;
export const PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT =
  1 / PUBLICATION_UNITS_PER_MINECRAFT_BLOCK;

export type PublicationPrimitiveBinding = Readonly<{
  face_keys: readonly string[];
  material_name: string;
  texture_uuid: string;
}>;

export type PublicationCubeManifest = Readonly<{
  cube_uuid: string;
  group_ancestry_uuids: readonly string[];
  source_world_matrix: readonly number[];
  expected_blender_bounds_min: readonly [number, number, number];
  expected_blender_bounds_max: readonly [number, number, number];
  position_sha256: string;
  uv_sha256: string;
  gltf_uv_sha256: string;
  uv_vertex_count: number;
  normal_sha256: string | null;
  index_sha256: string;
  primitives: readonly PublicationPrimitiveBinding[];
}>;

export type PublicationSourceManifest = Readonly<{
  schema_version: 1;
  target_kind: "ACTIVE_PROJECT_VISIBLE_EXPORTABLE_CUBES";
  project_uuid: string;
  pose_mode: "EDIT_STATIC_VERIFIED";
  source_sha256: string;
  source_units_per_minecraft_block: 16;
  gltf_units_per_blockbench_unit: number;
  cubes: readonly PublicationCubeManifest[];
}>;

type SourceFace = Readonly<{
  face_key: string;
  texture_uuid: string;
  material_name: string | null | undefined;
}>;
type SourceGroup = Readonly<{
  start: number;
  count: number;
  materialIndex?: number;
}>;

/**
 * Predict Blender glTF 2.0 import world-space AABB without a second geometry
 * parser. THREE Matrix4 stores column-major values and the exporter operates
 * in glTF Y-up coordinates. Blender glTF importer maps (x,y,z)->(x,-z,y).
 * Source scale is the declared 1/16 scene-unit conversion.
 *
 * These are expected bounds, not native import acceptance evidence.
 */
export function expectedPublicationBlenderBounds(
  positions: readonly number[],
  worldMatrix: readonly number[],
): {
  min: [number, number, number];
  max: [number, number, number];
} {
  if (worldMatrix.length !== 16 ||
      positions.length === 0 || positions.length % 3 !== 0 ||
      [...worldMatrix, ...positions].some(value => !Number.isFinite(value))) {
    throw new Error("PUBLICATION_SOURCE_BOUNDS_INPUT_INVALID");
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    const gltfX = (worldMatrix[0]! * x + worldMatrix[4]! * y +
      worldMatrix[8]! * z + worldMatrix[12]!) *
      PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT;
    const gltfY = (worldMatrix[1]! * x + worldMatrix[5]! * y +
      worldMatrix[9]! * z + worldMatrix[13]!) *
      PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT;
    const gltfZ = (worldMatrix[2]! * x + worldMatrix[6]! * y +
      worldMatrix[10]! * z + worldMatrix[14]!) *
      PUBLICATION_GLTF_UNITS_PER_BLOCKBENCH_UNIT;
    const rotated = [gltfX, -gltfZ, gltfY];
    if (rotated.some(value => !Number.isFinite(value))) {
      throw new Error("PUBLICATION_SOURCE_BOUNDS_OVERFLOW");
    }
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis]!, rotated[axis]!);
      max[axis] = Math.max(max[axis]!, rotated[axis]!);
    }
  }
  return { min, max };
}

/**
 * Blockbench's bundled glTF exporter flips V for TEXCOORD_0 in its own
 * detached output (v_glTF = 1 - v_preview). It also writes Float32 values.
 * Fingerprint the actual expected GLB accessor, not the unflipped native UV.
 */
export function expectedPublicationGltfUvSha256(uv: readonly number[]): string {
  if (uv.length === 0 || uv.length % 2 !== 0 ||
      uv.some(value => !Number.isFinite(value))) {
    throw new Error("PUBLICATION_SOURCE_UV_FINGERPRINT_INVALID");
  }
  const data = Buffer.allocUnsafe(uv.length * 4);
  for (let i = 0; i < uv.length; i += 2) {
    data.writeFloatLE(uv[i]!, i * 4);
    data.writeFloatLE(1 - uv[i + 1]!, (i + 1) * 4);
  }
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Bedrock per-face material names are geometry slot identities, NOT proof of
 * an opaque, cutout, translucent or emissive shader. Until that exact
 * render-controller binding can be resolved, never flatten them to albedo.
 */
export function requireSupportedPublicationFaceMaterial(
  materialName: unknown,
  cubeUuid: string,
  faceKey: string,
): void {
  if (materialName == null || materialName === "") return;
  throw new Error(
    "PUBLICATION_UNSUPPORTED_FACE_MATERIAL: Cube " + cubeUuid +
    " face " + faceKey +
    " declares a material slot; resolve its authored render-profile before rendering.",
  );
}

/**
 * Blockbench Cube native preview groups may merge *consecutive* faces that
 * reference the same texture. A group represents consecutive six-indexed
 * quads, not arbitrary material indices or one-to-one face groups.
 */
export function derivePublicationPrimitiveBindings(
  cubeUuid: string,
  faces: readonly SourceFace[],
  groups: readonly SourceGroup[],
  indexCount: number,
): PublicationPrimitiveBinding[] {
  if (!faces.length || !groups.length || indexCount !== faces.length * 6) {
    throw new Error("PUBLICATION_FACE_PRIMITIVE_INVENTORY_MISMATCH: " + cubeUuid);
  }
  const bindings: PublicationPrimitiveBinding[] = [];
  let next = 0;
  for (const group of groups) {
    const materialIndex = group.materialIndex;
    if (!Number.isSafeInteger(group.start) || group.start !== next ||
        !Number.isSafeInteger(group.count) || group.count < 6 ||
        group.count % 6 !== 0 ||
        typeof materialIndex !== "number" ||
        !Number.isSafeInteger(materialIndex) ||
        materialIndex !== group.start / 6 ||
        group.start + group.count > indexCount) {
      throw new Error("PUBLICATION_FACE_GROUP_BINDING_INVALID: " + cubeUuid);
    }
    const first = group.start / 6;
    const last = (group.start + group.count) / 6;
    const selected = faces.slice(first, last);
    if (!selected.length || selected.some(f => !f.face_key || !f.texture_uuid)) {
      throw new Error("PUBLICATION_FACE_SOURCE_MISSING: " + cubeUuid);
    }
    for (const face of selected) {
      requireSupportedPublicationFaceMaterial(face.material_name, cubeUuid, face.face_key);
      if (face.texture_uuid !== selected[0]!.texture_uuid) {
        throw new Error("PUBLICATION_GROUP_MERGED_DIFFERENT_TEXTURES: " + cubeUuid);
      }
    }
    bindings.push({
      face_keys: selected.map(f => f.face_key),
      texture_uuid: selected[0]!.texture_uuid,
      material_name: "ld_color_" + selected[0]!.texture_uuid,
    });
    next += group.count;
  }
  if (next !== indexCount) {
    throw new Error("PUBLICATION_FACE_GROUP_BINDING_COVERAGE_MISMATCH: " + cubeUuid);
  }
  return bindings;
}
