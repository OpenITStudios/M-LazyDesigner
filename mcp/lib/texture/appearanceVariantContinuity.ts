import { createHash } from "node:crypto";
import { normalizeBedrockGeometryIdentifier } from "../bedrock/projectIdentity";
import { inspectEntityRenderMaterialCode } from "./renderProfile";
import {
  planTextureVariantFromBase,
  type TextureVariantPlanInput,
} from "./variantPlan";

/**
 * V1 source-only continuity review for one planned Entity texture variant.
 *
 * Reuses create_texture(type=variant)'s existing pure preflight. It neither
 * constructs new bitmaps nor writes client_entity/render_controller JSON.
 * Caller-supplied UV hashes, bone inventories and material codes are claims,
 * not native Blockbench observations or Minecraft runtime proof.
 */
export type AppearanceVariantMode =
  "TEXTURE_ONLY" | "MATERIAL_CHANGE" | "GEOMETRY_OVERRIDE";

export type AppearanceVariantBone = {
  uuid: string;
  name: string;
  parent_uuid: string | null;
  pivot: readonly [number, number, number];
};

export type AppearanceVariantSnapshot = {
  geometry_identifier: string;
  uv_mapping_sha256: string;
  bones: readonly AppearanceVariantBone[];
  material_code: string;
};

export type AppearanceVariantRenderIntent = {
  controller_identifier: string;
  base_texture_slot: string;
  variant_texture_slot: string;
  base_geometry_slot: string;
  variant_geometry_slot?: string;
  base_material_slot: string;
  variant_material_slot?: string;
};

export type AppearanceVariantContinuityInput = {
  expected_project_uuid: string;
  entity_identifier: string;
  /** Canonical Texture owner request; no substitute duplicate planner. */
  texture_create: TextureVariantPlanInput;
  mode: AppearanceVariantMode;
  baseline: AppearanceVariantSnapshot;
  proposed: AppearanceVariantSnapshot & {
    bitmap_width: number;
    bitmap_height: number;
  };
  render: AppearanceVariantRenderIntent;
  source_refs: readonly string[];
};

export type AppearanceVariantContinuityIssue =
  | "VARIANT_BITMAP_DIMENSIONS_CHANGED"
  | "TEXTURE_ONLY_GEOMETRY_CHANGED"
  | "TEXTURE_ONLY_UV_CHANGED"
  | "TEXTURE_ONLY_RIG_CHANGED"
  | "TEXTURE_ONLY_MATERIAL_CHANGED"
  | "MATERIAL_VARIANT_GEOMETRY_CHANGED"
  | "MATERIAL_VARIANT_UV_CHANGED"
  | "MATERIAL_VARIANT_RIG_CHANGED"
  | "MATERIAL_VARIANT_NO_MATERIAL_CHANGE"
  | "GEOMETRY_VARIANT_REQUIRES_NEW_GEOMETRY_IDENTIFIER"
  | "GEOMETRY_VARIANT_RENDER_SLOT_REQUIRED"
  | "MATERIAL_VARIANT_RENDER_SLOT_REQUIRED";

export type AppearanceVariantContinuityWarning =
  | "TEXTURE_BITMAP_NOT_NATIVE_ATTESTED"
  | "UV_MAPPING_FINGERPRINT_CALLER_SUPPLIED"
  | "BONE_INVENTORY_CALLER_SUPPLIED"
  | "RENDER_CONTROLLER_SELECTOR_NOT_COMPILED"
  | "VISUAL_VARIANT_FIDELITY_NOT_EVALUATED"
  | "MATERIAL_CHANGE_RENDER_REVIEW"
  | "GEOMETRY_CHANGE_RIG_AND_UV_REVIEW"
  | "CUSTOM_RENDER_MATERIAL_UNVERIFIED";

export type AppearanceVariantContinuityReview = {
  state: "BLOCKED_BY_DECLARED_CONTINUITY" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  source_fingerprint: string;
  mode: AppearanceVariantMode;
  project_uuid: string;
  entity_identifier: string;
  /** Exact result of the existing Texture Variant owner, not a new executor. */
  texture_creation: ReturnType<typeof planTextureVariantFromBase>;
  changed: {
    geometry: boolean;
    uv_mapping: boolean;
    rig: boolean;
    material: boolean;
  };
  /** Hints only: no render controller JSON or MoLang authored. */
  candidate_render_references: {
    controller: string;
    base_texture: string;
    variant_texture: string;
    base_geometry: string;
    variant_geometry: string | null;
    base_material: string;
    variant_material: string | null;
  };
  issues: AppearanceVariantContinuityIssue[];
  warnings: AppearanceVariantContinuityWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  resource_pack_written: false;
};

const SHA = /^sha256:[0-9a-f]{64}$/;
const ENTITY_ID = /^[a-z0-9_][a-z0-9_.-]{0,63}:[a-z0-9_][a-z0-9_.-]{0,127}$/;
const UUID = /^[A-Za-z0-9_-]{1,128}$/;
const BONE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const MATERIAL_CODE = /^[A-Za-z0-9_.:-]+$/;
const SLOT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROLLER = /^controller\.render\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const MAX_BONES = 256;

function exact(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string" || !value || value.length > max ||
      value.trim() !== value) {
    throw new Error("APPEARANCE_VARIANT_IDENTITY_INVALID: " + label);
  }
  return value;
}
function fingerprint(value: unknown, label: string): string {
  const hash = exact(value, label, 71);
  if (!SHA.test(hash)) throw new Error("APPEARANCE_VARIANT_FINGERPRINT_INVALID: " + label);
  return hash;
}
function slot(value: unknown, label: string): string {
  const name = exact(value, label, 128);
  if (!SLOT.test(name)) throw new Error("APPEARANCE_VARIANT_RENDER_SLOT_INVALID: " + label);
  return name;
}
function geometry(value: unknown): string {
  const identifier = exact(value, "geometry_identifier", 192);
  try {
    if (normalizeBedrockGeometryIdentifier(identifier) !== identifier) {
      throw new Error("not canonical");
    }
  } catch {
    throw new Error("APPEARANCE_VARIANT_GEOMETRY_IDENTIFIER_INVALID");
  }
  return identifier;
}
function boneInventory(
  values: readonly AppearanceVariantBone[],
  label: string
): AppearanceVariantBone[] {
  if (!Array.isArray(values) || !values.length || values.length > MAX_BONES) {
    throw new Error("APPEARANCE_VARIANT_RIG_INVENTORY_INVALID: " + label);
  }
  const byId = new Map<string, AppearanceVariantBone>();
  const names = new Set<string>();
  const rows: AppearanceVariantBone[] = [];
  for (const bone of values) {
    if (!bone || typeof bone.uuid !== "string" || !UUID.test(bone.uuid) ||
        typeof bone.name !== "string" || !BONE_NAME.test(bone.name) ||
        (bone.parent_uuid !== null &&
          (typeof bone.parent_uuid !== "string" || !UUID.test(bone.parent_uuid))) ||
        !Array.isArray(bone.pivot) || bone.pivot.length !== 3 ||
        bone.pivot.some(n => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error("APPEARANCE_VARIANT_RIG_BONE_INVALID: " + label);
    }
    if (byId.has(bone.uuid) || names.has(bone.name)) {
      throw new Error("APPEARANCE_VARIANT_RIG_BONE_AMBIGUOUS: " + label);
    }
    const normalized = {
      uuid: bone.uuid, name: bone.name,
      parent_uuid: bone.parent_uuid,
      pivot: [bone.pivot[0], bone.pivot[1], bone.pivot[2]] as [number,number,number],
    };
    byId.set(normalized.uuid, normalized);
    names.add(normalized.name);
    rows.push(normalized);
  }
  for (const bone of rows) {
    const visited = new Set<string>();
    let cursor: AppearanceVariantBone | undefined = bone;
    while (cursor) {
      if (visited.has(cursor.uuid)) {
        throw new Error("APPEARANCE_VARIANT_RIG_BONE_CYCLE: " + label);
      }
      visited.add(cursor.uuid);
      if (cursor.parent_uuid === null) break;
      const parent = byId.get(cursor.parent_uuid);
      if (!parent) {
        throw new Error("APPEARANCE_VARIANT_RIG_PARENT_UNKNOWN: " + label);
      }
      cursor = parent;
    }
  }
  return rows.sort((a,b) => a.uuid.localeCompare(b.uuid));
}
function snapshot(value: AppearanceVariantSnapshot, label: string) {
  if (!value || typeof value !== "object") {
    throw new Error("APPEARANCE_VARIANT_SNAPSHOT_INVALID: " + label);
  }
  const material = exact(value.material_code, label+".material_code", 128);
  if (!MATERIAL_CODE.test(material)) {
    throw new Error("APPEARANCE_VARIANT_MATERIAL_CODE_INVALID: " + label);
  }
  return {
    geometry_identifier: geometry(value.geometry_identifier),
    uv_mapping_sha256: fingerprint(value.uv_mapping_sha256, label+".uv"),
    bones: boneInventory(value.bones, label),
    material_code: material,
  };
}

/**
 * Source continuity only. A geometrical variant must declare its own
 * geometry and render slot; changed rig/UV may be intentional but remain
 * visual/native REVIEW REQUIRED rather than silently treated as equivalent.
 */
export function reviewBedrockAppearanceVariantContinuity(
  input: AppearanceVariantContinuityInput
): AppearanceVariantContinuityReview {
  if (!input || typeof input !== "object") {
    throw new Error("APPEARANCE_VARIANT_INPUT_INVALID");
  }
  const project = exact(input.expected_project_uuid, "project_uuid", 128);
  const entity = exact(input.entity_identifier, "entity_identifier", 192);
  if (!ENTITY_ID.test(entity)) {
    throw new Error("APPEARANCE_VARIANT_ENTITY_IDENTIFIER_INVALID");
  }
  if (!["TEXTURE_ONLY","MATERIAL_CHANGE","GEOMETRY_OVERRIDE"].includes(input.mode)) {
    throw new Error("APPEARANCE_VARIANT_MODE_INVALID");
  }
  if (!Array.isArray(input.source_refs) || !input.source_refs.length ||
      input.source_refs.length > 8 ||
      input.source_refs.some(x => typeof x !== "string" || !x ||
        x.length > 160 || x.trim() !== x) ||
      new Set(input.source_refs).size !== input.source_refs.length) {
    throw new Error("APPEARANCE_VARIANT_SOURCE_REFS_INVALID");
  }

  // This original planner owns the one-base-color selection, dimensions,
  // non-material TextureGroup, existing-name collision and variant role.
  // Do not duplicate or loosen that preflight.
  if (!input.texture_create || typeof input.texture_create !== "object" ||
      typeof input.texture_create.requested_name !== "string" ||
      input.texture_create.requested_name.trim() !== input.texture_create.requested_name) {
    throw new Error("APPEARANCE_VARIANT_TEXTURE_SOURCE_INVALID");
  }
  const texture_creation = planTextureVariantFromBase(input.texture_create);
  const baseline = snapshot(input.baseline, "baseline");
  const proposed = snapshot(input.proposed, "proposed");
  if (!Number.isSafeInteger(input.proposed.bitmap_width) ||
      !Number.isSafeInteger(input.proposed.bitmap_height) ||
      input.proposed.bitmap_width < 1 || input.proposed.bitmap_height < 1) {
    throw new Error("APPEARANCE_VARIANT_BITMAP_DIMENSIONS_INVALID");
  }

  const render = input.render;
  if (!render || typeof render !== "object") {
    throw new Error("APPEARANCE_VARIANT_RENDER_INTENT_INVALID");
  }
  const controller = exact(render.controller_identifier, "controller_identifier", 192);
  if (!CONTROLLER.test(controller)) {
    throw new Error("APPEARANCE_VARIANT_RENDER_CONTROLLER_INVALID");
  }
  const baseTextureSlot = slot(render.base_texture_slot, "base_texture_slot");
  const variantTextureSlot = slot(render.variant_texture_slot, "variant_texture_slot");
  if (baseTextureSlot === variantTextureSlot) {
    throw new Error("APPEARANCE_VARIANT_TEXTURE_SLOT_AMBIGUOUS");
  }
  const baseGeometrySlot = slot(render.base_geometry_slot, "base_geometry_slot");
  const variantGeometrySlot = render.variant_geometry_slot === undefined
    ? null : slot(render.variant_geometry_slot, "variant_geometry_slot");
  const baseMaterialSlot = slot(render.base_material_slot, "base_material_slot");
  const variantMaterialSlot = render.variant_material_slot === undefined
    ? null : slot(render.variant_material_slot, "variant_material_slot");

  const changed = {
    geometry: baseline.geometry_identifier !== proposed.geometry_identifier,
    uv_mapping: baseline.uv_mapping_sha256 !== proposed.uv_mapping_sha256,
    rig: JSON.stringify(baseline.bones) !== JSON.stringify(proposed.bones),
    material: baseline.material_code !== proposed.material_code,
  };
  const issues: AppearanceVariantContinuityIssue[] = [];
  if (input.proposed.bitmap_width !== texture_creation.bitmap.width ||
      input.proposed.bitmap_height !== texture_creation.bitmap.height) {
    issues.push("VARIANT_BITMAP_DIMENSIONS_CHANGED");
  }
  if (input.mode === "TEXTURE_ONLY" || input.mode === "MATERIAL_CHANGE") {
    if (changed.geometry) issues.push(input.mode === "TEXTURE_ONLY"
      ? "TEXTURE_ONLY_GEOMETRY_CHANGED" : "MATERIAL_VARIANT_GEOMETRY_CHANGED");
    if (changed.uv_mapping) issues.push(input.mode === "TEXTURE_ONLY"
      ? "TEXTURE_ONLY_UV_CHANGED" : "MATERIAL_VARIANT_UV_CHANGED");
    if (changed.rig) issues.push(input.mode === "TEXTURE_ONLY"
      ? "TEXTURE_ONLY_RIG_CHANGED" : "MATERIAL_VARIANT_RIG_CHANGED");
    if (input.mode === "TEXTURE_ONLY" && changed.material) {
      issues.push("TEXTURE_ONLY_MATERIAL_CHANGED");
    }
    if (input.mode === "MATERIAL_CHANGE" && !changed.material) {
      issues.push("MATERIAL_VARIANT_NO_MATERIAL_CHANGE");
    }
  } else if (!changed.geometry) {
    // A geometry variant may not overwrite the shared base geometry ID.
    issues.push("GEOMETRY_VARIANT_REQUIRES_NEW_GEOMETRY_IDENTIFIER");
  }
  if (changed.geometry && (!variantGeometrySlot ||
      variantGeometrySlot === baseGeometrySlot)) {
    issues.push("GEOMETRY_VARIANT_RENDER_SLOT_REQUIRED");
  }
  if (changed.material && (!variantMaterialSlot ||
      variantMaterialSlot === baseMaterialSlot)) {
    issues.push("MATERIAL_VARIANT_RENDER_SLOT_REQUIRED");
  }

  const baseMaterial = inspectEntityRenderMaterialCode(baseline.material_code);
  const variantMaterial = inspectEntityRenderMaterialCode(proposed.material_code);
  const warnings: AppearanceVariantContinuityWarning[] = [
    "TEXTURE_BITMAP_NOT_NATIVE_ATTESTED",
    "UV_MAPPING_FINGERPRINT_CALLER_SUPPLIED",
    "BONE_INVENTORY_CALLER_SUPPLIED",
    "RENDER_CONTROLLER_SELECTOR_NOT_COMPILED",
    "VISUAL_VARIANT_FIDELITY_NOT_EVALUATED",
  ];
  if (changed.material) warnings.push("MATERIAL_CHANGE_RENDER_REVIEW");
  if (changed.geometry || changed.rig || changed.uv_mapping) {
    warnings.push("GEOMETRY_CHANGE_RIG_AND_UV_REVIEW");
  }
  if (baseMaterial.verification === "unverified_custom" ||
      variantMaterial.verification === "unverified_custom") {
    warnings.push("CUSTOM_RENDER_MATERIAL_UNVERIFIED");
  }

  const normalized = {
    contract: "entity-appearance-variant-v1",
    project, entity, mode: input.mode,
    texture_creation,
    baseline, proposed: {
      ...proposed,
      bitmap: [input.proposed.bitmap_width, input.proposed.bitmap_height],
    },
    render: {
      controller, baseTextureSlot, variantTextureSlot,
      baseGeometrySlot, variantGeometrySlot,
      baseMaterialSlot, variantMaterialSlot,
    },
    source_refs: [...input.source_refs].sort(),
  };
  return {
    state: issues.length > 0
      ? "BLOCKED_BY_DECLARED_CONTINUITY"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    source_fingerprint: "sha256:" + createHash("sha256")
      .update(JSON.stringify(normalized)).digest("hex"),
    mode: input.mode,
    project_uuid: project,
    entity_identifier: entity,
    texture_creation,
    changed,
    candidate_render_references: {
      controller,
      base_texture: "Texture."+baseTextureSlot,
      variant_texture: "Texture."+variantTextureSlot,
      base_geometry: "Geometry."+baseGeometrySlot,
      variant_geometry: changed.geometry && variantGeometrySlot
        ? "Geometry."+variantGeometrySlot : null,
      base_material: "Material."+baseMaterialSlot,
      variant_material: changed.material && variantMaterialSlot
        ? "Material."+variantMaterialSlot : null,
    },
    issues, warnings,
    native_verified: false,
    visual_verified: false,
    minecraft_verified: false,
    resource_pack_written: false,
  };
}
