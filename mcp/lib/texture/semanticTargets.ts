import type { TextureTreatmentFace } from "./treatmentPlan";

/**
 * Compact, read-only bridge from exact native Cube/material labels to the
 * existing face_targets argument of paint_texture_transaction.
 *
 * Labels are navigation hints, NOT a classification of pixels, proof of
 * approved material identity, permission to paint, or a UV ownership check.
 */
export type TextureSemanticFace = TextureTreatmentFace & {
  cube_name: string;
  enabled: boolean;
  texture_uuid: string | null;
  native_material_name: string;
};

type TargetKind = "part" | "native_material";
type Group = {
  kind: TargetKind;
  label: string;
  normalized_label: string;
  original_labels: Set<string>;
  faces: TextureSemanticFace[];
};

const FACES = ["north", "south", "east", "west", "up", "down"] as const;
const MAX_INVENTORY_FACES = 1_536;
const MAX_CANDIDATES = 12;
const MAX_FACE_TARGETS = 64;

/** Normalization only improves label discovery; it must not merge native names silently. */
function normalizedLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function addGroup(
  groups: Map<string, Group>,
  kind: TargetKind,
  label: string,
  face: TextureSemanticFace
): void {
  if (!label.trim()) return;
  const normalized = normalizedLabel(label);
  const id = JSON.stringify([kind, normalized]);
  let group = groups.get(id);
  if (!group) {
    group = { kind, label: label.trim(), normalized_label: normalized,
      original_labels: new Set(), faces: [] };
    groups.set(id, group);
  }
  group.original_labels.add(label.trim());
  group.faces.push(face);
}

function faceId(face: TextureTreatmentFace): string {
  return JSON.stringify([face.cube_uuid, face.face]);
}

/**
 * Pure bounded analysis; a status of face_targets_candidate means the label
 * expansion is complete within this *snapshot*, never that a paint is safe.
 * The existing native face-scoped transaction performs the final UV,
 * texture/material, revision and unselected-owner checks.
 */
export function buildTextureSemanticCandidates(
  faces: readonly TextureSemanticFace[]
) {
  if (!Array.isArray(faces) || faces.length < 1 ||
      faces.length > MAX_INVENTORY_FACES) {
    throw new Error("SEMANTIC_TARGET_INVENTORY_BUDGET");
  }
  const seen = new Set<string>();
  const cubeNames = new Map<string, string>();
  const groups = new Map<string, Group>();
  let unresolved = 0;
  let disabled = 0;
  for (const face of faces) {
    if (!face || typeof face.cube_uuid !== "string" ||
        !face.cube_uuid.trim() || face.cube_uuid.length > 128 ||
        !FACES.includes(face.face) ||
        typeof face.cube_name !== "string" || face.cube_name.length > 128 ||
        typeof face.native_material_name !== "string" ||
        face.native_material_name.length > 128 ||
        typeof face.enabled !== "boolean" ||
        (face.texture_uuid !== null &&
          (typeof face.texture_uuid !== "string" ||
           !face.texture_uuid.trim() || face.texture_uuid.length > 128))) {
      throw new Error("SEMANTIC_TARGET_INVALID_FACE_INVENTORY");
    }
    const key = faceId(face);
    if (seen.has(key)) throw new Error("SEMANTIC_TARGET_DUPLICATE_FACE");
    seen.add(key);
    const previous = cubeNames.get(face.cube_uuid);
    if (previous !== undefined && previous !== face.cube_name) {
      throw new Error("SEMANTIC_TARGET_INCONSISTENT_CUBE_NAME");
    }
    cubeNames.set(face.cube_uuid, face.cube_name);
    if (!face.enabled) {
      disabled += 1;
      continue;
    }
    if (face.texture_uuid === null) unresolved += 1;
    addGroup(groups, "part", face.cube_name, face);
    if (face.native_material_name.trim()) {
      addGroup(groups, "native_material", face.native_material_name, face);
    }
  }

  const ordered = [...groups.values()].sort((left, right) =>
    (left.kind === right.kind ? 0 : left.kind === "native_material" ? -1 : 1) ||
    left.normalized_label.localeCompare(right.normalized_label));
  let remaining = MAX_FACE_TARGETS;
  let reviewCount = 0;
  const shown = ordered.slice(0, MAX_CANDIDATES).map(group => {
    const cubeIds = [...new Set(group.faces.map(face => face.cube_uuid))].sort();
    const textures = [...new Set(group.faces.map(face => face.texture_uuid)
      .filter((value): value is string => value !== null))];
    const materials = [...new Set(group.faces.map(face => face.native_material_name))];
    const reasons: string[] = [];
    if (group.original_labels.size > 1) reasons.push("NORMALIZED_LABEL_COLLISION");
    if (group.kind === "part" && cubeIds.length > 1) {
      reasons.push("AMBIGUOUS_PART_NAME");
    }
    if (group.faces.some(face => face.texture_uuid === null)) {
      reasons.push("UNRESOLVED_FACE_TEXTURE");
    }
    if (textures.length !== 1) reasons.push("MULTIPLE_OR_MISSING_TEXTURES");
    if (group.kind === "part" && materials.length > 1) {
      reasons.push("MIXED_NATIVE_MATERIALS");
    }
    if (group.faces.length > MAX_FACE_TARGETS) reasons.push("FACE_TARGET_LIMIT");
    if (!reasons.length && group.faces.length > remaining) {
      reasons.push("RESPONSE_FACE_BUDGET");
    }
    if (reasons.length) reviewCount += 1;
    const faceTargets = reasons.length ? null : group.faces
      .map(face => ({ cube_uuid: face.cube_uuid, face: face.face }))
      .sort((a, b) => a.cube_uuid.localeCompare(b.cube_uuid) ||
        FACES.indexOf(a.face) - FACES.indexOf(b.face));
    if (faceTargets) remaining -= faceTargets.length;
    return {
      kind: group.kind,
      label: group.label,
      normalized_label: group.normalized_label,
      status: reasons.length ? ("review_required" as const)
        : ("face_targets_candidate" as const),
      reasons,
      cube_count: cubeIds.length,
      cube_uuid_examples: cubeIds.slice(0, 4),
      face_count: group.faces.length,
      texture_uuid: textures.length === 1 ? textures[0] : null,
      native_material_name: materials.length === 1 ? materials[0] : null,
      face_targets: faceTargets,
      // Face targeting never certifies the material's artistic identity.
      semantic_material_verified: false as const,
      uv_ownership_verified: false as const,
      mutation_authorized: false as const,
    };
  });
  const omitted = ordered.length - shown.length;
  return {
    state: unresolved > 0 || omitted > 0 || reviewCount > 0
      ? ("partial" as const) : ("available" as const),
    scope: "native_cube_and_material_labels" as const,
    match_policy: "exact_after_label_normalization_with_collision_refusal" as const,
    inventory_face_count: faces.length,
    enabled_unresolved_texture_faces: unresolved,
    disabled_face_count: disabled,
    candidate_count: ordered.length,
    omitted_candidate_count: omitted,
    returned_face_target_count: MAX_FACE_TARGETS - remaining,
    native_materials: shown.filter(item => item.kind === "native_material"),
    parts: shown.filter(item => item.kind === "part"),
    note: "Choose only an exact intended label. The existing native face-scope/texture-revision guard must validate all owners before painting; same-hue identity marks on a selected face are not protected by face targeting.",
    mutation_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}
