import type { ClusterCompositionInput, ClusterNativeFace } from "./clusterComposition";

const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const MAX_NATIVE_FACES = 1536;

type CurrentClusterNativeSnapshot = Readonly<{
  texture_uuid: string;
  bitmap_width: number;
  bitmap_height: number;
  logical_uv_width: number;
  logical_uv_height: number;
  native_faces: readonly ClusterNativeFace[];
}>;

function identity(face: ClusterNativeFace): string {
  return JSON.stringify([face.cube_uuid, face.face]);
}

function sameNumbers(
  left: readonly number[] | null,
  right: readonly number[] | null
): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length &&
    left.every((value, index) => Number.isFinite(value) && value === right[index]);
}

function exactNativeFaces(faces: readonly ClusterNativeFace[], label: string) {
  if (!Array.isArray(faces) || faces.length < 1 ||
      faces.length > MAX_NATIVE_FACES || faces.length % 6 !== 0) {
    throw new Error("CLUSTER_NATIVE_BINDING_INVENTORY_INVALID: " + label);
  }
  const byId = new Map<string, ClusterNativeFace>();
  const byCube = new Map<string, Set<string>>();
  for (const face of faces) {
    if (!face || typeof face.cube_uuid !== "string" ||
        !face.cube_uuid.trim() || !FACE_KEYS.includes(face.face) ||
        typeof face.enabled !== "boolean" ||
        typeof face.native_material_name !== "string" ||
        (face.texture_uuid !== null &&
          (typeof face.texture_uuid !== "string" || !face.texture_uuid.trim())) ||
        (face.uv !== null &&
          (!Array.isArray(face.uv) || face.uv.length !== 4 ||
            face.uv.some(x => !Number.isFinite(x)))) ||
        (face.rotation !== null &&
          (![0, 90, 180, 270].includes(face.rotation))) ||
        (face.rect !== null &&
          (!Array.isArray(face.rect) || face.rect.length !== 4 ||
            face.rect.some(x => !Number.isSafeInteger(x))))) {
      throw new Error("CLUSTER_NATIVE_BINDING_INVENTORY_INVALID: " + label);
    }
    const id = identity(face);
    if (byId.has(id)) throw new Error("CLUSTER_NATIVE_BINDING_DUPLICATE: " + id);
    byId.set(id, face);
    const keys = byCube.get(face.cube_uuid) ?? new Set<string>();
    keys.add(face.face);
    byCube.set(face.cube_uuid, keys);
  }
  for (const [cube, keys] of byCube) {
    if (keys.size !== FACE_KEYS.length) {
      throw new Error("CLUSTER_NATIVE_BINDING_INVENTORY_INCOMPLETE: " + cube);
    }
  }
  return byId;
}

/**
 * Read-only equality check between an externally compiled cluster snapshot
 * and current resolved native CubeFace/Texture bindings. A matching result
 * cannot attest reference artwork or user approval. The transaction must
 * keep checking the native snapshot throughout its one-Undo mutation.
 */
export function requireCurrentClusterNativeBindings(
  expected: Pick<ClusterCompositionInput,
    "texture_uuid" | "bitmap_width" | "bitmap_height" |
    "logical_uv_width" | "logical_uv_height" | "native_faces" | "faces">,
  current: CurrentClusterNativeSnapshot
) {
  if (expected.texture_uuid !== current.texture_uuid ||
      expected.bitmap_width !== current.bitmap_width ||
      expected.bitmap_height !== current.bitmap_height ||
      expected.logical_uv_width !== current.logical_uv_width ||
      expected.logical_uv_height !== current.logical_uv_height) {
    throw new Error("CLUSTER_NATIVE_ATLAS_BINDING_CHANGED");
  }
  const before = exactNativeFaces(expected.native_faces, "declared");
  const now = exactNativeFaces(current.native_faces, "current");
  if (before.size !== now.size) {
    throw new Error("CLUSTER_NATIVE_BINDING_INVENTORY_CHANGED");
  }
  for (const [id, candidate] of before) {
    const actual = now.get(id);
    if (!actual || candidate.enabled !== actual.enabled ||
        candidate.texture_uuid !== actual.texture_uuid ||
        candidate.native_material_name !== actual.native_material_name ||
        !sameNumbers(candidate.uv, actual.uv) ||
        candidate.rotation !== actual.rotation ||
        (candidate.rect !== null && !sameNumbers(candidate.rect, actual.rect))) {
      throw new Error("CLUSTER_NATIVE_FACE_BINDING_CHANGED: " + id);
    }
  }

  const targets = new Set<string>();
  for (const face of expected.faces) {
    if (!face || typeof face.cube_uuid !== "string" ||
        !FACE_KEYS.includes(face.face)) {
      throw new Error("CLUSTER_NATIVE_TARGET_INVALID");
    }
    const id = JSON.stringify([face.cube_uuid, face.face]);
    if (targets.has(id)) throw new Error("CLUSTER_NATIVE_TARGET_DUPLICATE");
    targets.add(id);
    const actual = now.get(id);
    if (!actual || !actual.enabled ||
        actual.texture_uuid !== expected.texture_uuid ||
        actual.uv === null || actual.rotation === null ||
        actual.rect === null) {
      throw new Error("CLUSTER_NATIVE_TARGET_UNRESOLVED: " + id);
    }
  }
  if (targets.size === 0 || targets.size > 16) {
    throw new Error("CLUSTER_NATIVE_TARGET_BUDGET");
  }
  return {
    state: "native_bindings_matched" as const,
    total_face_slots: now.size,
    target_face_count: targets.size,
    // Atlas bitmap revision remains owned by the existing paint transaction.
    bitmap_revision_attested: false as const,
    reference_pixels_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}
