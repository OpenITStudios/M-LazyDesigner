import { normalizeBedrockGeometryIdentifier } from "./projectIdentity";

/** A1 source planner only: no Blockbench globals, Resource Pack writes or native proof. */
export type AttachableModelBone = {
  uuid: string;
  name: string;
  parent_uuid: string | null;
};
export type AttachableBindingInput = {
  expected_project_uuid: string;
  attachable_identifier: string;
  item_identifier: string;
  /** Explicit item mapping opt-in, rather than an implicit renamed item. */
  explicit_item_mapping?: boolean;
  geometry_identifier: string;
  target_bone_uuid: string;
  model_bones: readonly AttachableModelBone[];
  holder: {
    entity_identifier: string;
    /** Caller-observed names, never a verified live inventory. */
    bone_names: readonly string[];
  };
  binding:
    | { strategy: "ITEM_SLOT"; preview_slot: "main_hand" | "off_hand" }
    | { strategy: "DIRECT_BONE"; holder_bone_name: string };
  source_refs: readonly string[];
};
export type AttachableBindingReview = {
  state: "SOURCE_SLOT_BINDING_PLANNED" | "DIRECT_BONE_REQUIRES_RIG_REVIEW";
  project_uuid: string;
  attachable_identifier: string;
  item_identifier: string;
  explicit_item_mapping_required: boolean;
  geometry_identifier: string;
  selected_model_bone: { uuid: string; name: string };
  holder_entity_identifier: string;
  binding_strategy: AttachableBindingInput["binding"]["strategy"];
  candidate_geometry_binding: string | null;
  preview_slot: "main_hand" | "off_hand" | null;
  review_gates: readonly (
    | "HOLDER_SLOT_RESOLUTION_UNVERIFIED"
    | "FIRST_AND_THIRD_PERSON_FIT_UNVERIFIED"
    | "DIRECT_BONE_COMBINED_RIG_REQUIRED"
    | "HOLDER_ANIMATION_AND_BONE_PARENTAGE_UNVERIFIED"
    | "RESOURCE_REFERENCES_NOT_COMPILED"
    | "EXPLICIT_ITEM_MAPPING_NOT_COMPILED"
  )[];
  native_verified: false;
  minecraft_verified: false;
};

const ID = /^[a-z0-9_][a-z0-9_.-]{0,63}:[a-z0-9_][a-z0-9_./-]{0,127}$/;
const BONE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const UUID = /^[A-Za-z0-9_-]{1,128}$/;
const SLOT_BINDING = "q.item_slot_to_bone_name(context.item_slot)";

function exact(value: unknown, field: string, max = 160): string {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > max || value.trim() !== value) {
    throw new Error("ATTACHABLE_SOURCE_IDENTITY_INVALID: " + field);
  }
  return value;
}
function id(value: unknown, field: string): string {
  const candidate = exact(value, field, 192);
  if (!ID.test(candidate) || candidate.includes("//") ||
      candidate.split(":")[1]!.split("/").some(s => s === "." || s === "..")) {
    throw new Error("ATTACHABLE_BEDROCK_IDENTIFIER_INVALID: " + field);
  }
  return candidate;
}
function checkModelBones(input: AttachableBindingInput): AttachableModelBone {
  const bones = input.model_bones;
  if (!Array.isArray(bones) || bones.length === 0 || bones.length > 256) {
    throw new Error("ATTACHABLE_MODEL_BONE_BUDGET_INVALID");
  }
  const byId = new Map<string, AttachableModelBone>();
  const names = new Set<string>();
  for (const bone of bones) {
    if (!bone || typeof bone.uuid !== "string" ||
        typeof bone.name !== "string" ||
        !UUID.test(bone.uuid) || !BONE.test(bone.name) ||
        (bone.parent_uuid !== null &&
          (typeof bone.parent_uuid !== "string" ||
           !UUID.test(bone.parent_uuid)))) {
      throw new Error("ATTACHABLE_MODEL_BONE_IDENTITY_INVALID");
    }
    if (byId.has(bone.uuid) || names.has(bone.name)) {
      throw new Error("ATTACHABLE_MODEL_BONE_AMBIGUOUS");
    }
    byId.set(bone.uuid, bone);
    names.add(bone.name);
  }
  for (const bone of bones) {
    const visited = new Set<string>();
    let cursor: AttachableModelBone | undefined = bone;
    while (cursor) {
      if (visited.has(cursor.uuid)) throw new Error("ATTACHABLE_MODEL_BONE_CYCLE");
      visited.add(cursor.uuid);
      if (cursor.parent_uuid === null) break;
      const parent = byId.get(cursor.parent_uuid);
      if (!parent) throw new Error("ATTACHABLE_MODEL_BONE_PARENT_UNKNOWN");
      cursor = parent;
    }
  }
  const selected = byId.get(exact(input.target_bone_uuid, "target_bone_uuid", 128));
  if (!selected) throw new Error("ATTACHABLE_MODEL_TARGET_BONE_NOT_FOUND");
  return selected;
}
function checkHolder(input: AttachableBindingInput): Set<string> {
  const bones = input.holder?.bone_names;
  if (!Array.isArray(bones) || bones.length === 0 || bones.length > 128) {
    throw new Error("ATTACHABLE_HOLDER_BONE_INVENTORY_INVALID");
  }
  const names = new Set<string>();
  for (const name of bones) {
    if (typeof name !== "string" || !BONE.test(name) || names.has(name)) {
      throw new Error("ATTACHABLE_HOLDER_BONE_AMBIGUOUS");
    }
    names.add(name);
  }
  return names;
}

/**
 * Item-slot query is official and preferred; its actual bone resolution is
 * controlled by the runtime holder, not an inferred right/left bone name.
 * Direct-holder-bone copies always require an independent combined-rig review.
 */
export function planBedrockAttachableBinding(
  input: AttachableBindingInput
): AttachableBindingReview {
  const project = exact(input.expected_project_uuid, "expected_project_uuid", 128);
  const attachable = id(input.attachable_identifier, "attachable_identifier");
  const item = id(input.item_identifier, "item_identifier");
  if (input.explicit_item_mapping !== undefined &&
      typeof input.explicit_item_mapping !== "boolean") {
    throw new Error("ATTACHABLE_EXPLICIT_ITEM_MAPPING_INVALID");
  }
  const distinctItemId = attachable !== item;
  if (distinctItemId && input.explicit_item_mapping !== true) {
    throw new Error("ATTACHABLE_ITEM_IDENTIFIER_MISMATCH");
  }
  const geometry = exact(input.geometry_identifier, "geometry_identifier", 192);
  if (normalizeBedrockGeometryIdentifier(geometry) !== geometry) {
    throw new Error("ATTACHABLE_GEOMETRY_IDENTIFIER_NOT_CANONICAL");
  }
  const holder = id(input.holder?.entity_identifier, "holder.entity_identifier");
  if (!Array.isArray(input.source_refs) ||
      input.source_refs.length === 0 || input.source_refs.length > 8 ||
      input.source_refs.some(ref => typeof ref !== "string" ||
        ref.length === 0 || ref.length > 160 || ref.trim() !== ref) ||
      new Set(input.source_refs).size !== input.source_refs.length) {
    throw new Error("ATTACHABLE_SOURCE_REFERENCES_INVALID");
  }
  const bone = checkModelBones(input);
  const holderBones = checkHolder(input);
  if (!input.binding || typeof input.binding !== "object") {
    throw new Error("ATTACHABLE_BINDING_STRATEGY_INVALID");
  }
  const base = {
    project_uuid: project,
    attachable_identifier: attachable,
    item_identifier: item,
    explicit_item_mapping_required: distinctItemId,
    geometry_identifier: geometry,
    selected_model_bone: { uuid: bone.uuid, name: bone.name },
    holder_entity_identifier: holder,
    native_verified: false as const,
    minecraft_verified: false as const,
  };
  if (input.binding.strategy === "ITEM_SLOT") {
    if (bone.parent_uuid !== null) {
      throw new Error("ATTACHABLE_SLOT_TARGET_MUST_BE_TOP_LEVEL_BONE");
    }
    if (input.binding.preview_slot !== "main_hand" &&
        input.binding.preview_slot !== "off_hand") {
      throw new Error("ATTACHABLE_SLOT_UNSUPPORTED_OR_UNVERIFIED");
    }
    return {
      ...base,
      state: "SOURCE_SLOT_BINDING_PLANNED",
      binding_strategy: "ITEM_SLOT",
      candidate_geometry_binding: SLOT_BINDING,
      preview_slot: input.binding.preview_slot,
      review_gates: [
        "HOLDER_SLOT_RESOLUTION_UNVERIFIED",
        "FIRST_AND_THIRD_PERSON_FIT_UNVERIFIED",
        "RESOURCE_REFERENCES_NOT_COMPILED",
        ...(distinctItemId ? ["EXPLICIT_ITEM_MAPPING_NOT_COMPILED" as const] : []),
      ],
    };
  }
  if (input.binding.strategy === "DIRECT_BONE") {
    const name = exact(input.binding.holder_bone_name,
      "binding.holder_bone_name", 128);
    if (!holderBones.has(name)) {
      throw new Error("ATTACHABLE_HOLDER_TARGET_BONE_NOT_FOUND");
    }
    return {
      ...base,
      state: "DIRECT_BONE_REQUIRES_RIG_REVIEW",
      binding_strategy: "DIRECT_BONE",
      candidate_geometry_binding: null,
      preview_slot: null,
      review_gates: [
        "DIRECT_BONE_COMBINED_RIG_REQUIRED",
        "HOLDER_ANIMATION_AND_BONE_PARENTAGE_UNVERIFIED",
        "FIRST_AND_THIRD_PERSON_FIT_UNVERIFIED",
        "RESOURCE_REFERENCES_NOT_COMPILED",
        ...(distinctItemId ? ["EXPLICIT_ITEM_MAPPING_NOT_COMPILED" as const] : []),
      ],
    };
  }
  throw new Error("ATTACHABLE_BINDING_STRATEGY_INVALID");
}
