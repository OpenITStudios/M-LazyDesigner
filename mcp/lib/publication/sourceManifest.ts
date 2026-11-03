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
  position_sha256: string;
  uv_sha256: string;
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
    if (!Number.isSafeInteger(group.start) || group.start !== next ||
        !Number.isSafeInteger(group.count) || group.count < 6 ||
        group.count % 6 !== 0 ||
        !Number.isSafeInteger(group.materialIndex) ||
        group.materialIndex !== group.start / 6 ||
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
