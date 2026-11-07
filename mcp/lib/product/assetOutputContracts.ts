import {
  getAssetProfileContract,
  type AssetOutputContractId,
  type AssetProfileId,
} from "./assetProfiles";

/**
 * One source-only output contract per Asset Profile output identity.
 * An expected deliverable is not an exporter, a native receipt, approval,
 * or evidence that a Resource/Behavior Pack has been written.
 */
export type AssetOutputDeliveryKind = "FILE" | "HANDOFF" | "REVIEW";
export type AssetOutputTrigger = "REQUIRED" | "WHEN_REQUESTED" | "WHEN_REFERENCED";
export type AssetOutputEvidenceClass =
  | "NATIVE_PROJECT_READBACK"
  | "FILE_READBACK_AND_IDENTITY"
  | "NATIVE_COMPILE_AND_FILE_READBACK"
  | "PNG_READBACK_AND_PIXEL_REVIEW"
  | "BINDING_REFERENCE_REVIEW"
  | "NATIVE_HOLDER_VISUAL_REVIEW"
  | "FORMAT_COMPATIBILITY_REVIEW"
  | "FRAME_AND_ATLAS_REVIEW"
  | "SKIN_UV_AND_METADATA_REVIEW"
  | "PARTICLE_RESOURCE_REVIEW";

export type AssetOutputRequirement = Readonly<{
  id: string;
  delivery_kind: AssetOutputDeliveryKind;
  trigger: AssetOutputTrigger;
  /** Required proof to pursue later; never evidence already obtained. */
  evidence_class: AssetOutputEvidenceClass;
}>;

/**
 * These are requirements and handoffs, not alternative codecs or validators.
 * The existing output_contract field in assetProfiles.ts is the sole mapping
 * from a profile to its output definition.
 */
export const ASSET_OUTPUT_CONTRACTS = {
  entity_model: [
    { id: "editable_bbmodel", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "NATIVE_PROJECT_READBACK" },
    { id: "entity_geometry_json", delivery_kind: "FILE", trigger: "WHEN_REQUESTED", evidence_class: "FILE_READBACK_AND_IDENTITY" },
    { id: "entity_animation_json", delivery_kind: "FILE", trigger: "WHEN_REQUESTED", evidence_class: "NATIVE_COMPILE_AND_FILE_READBACK" },
    { id: "entity_texture_png", delivery_kind: "FILE", trigger: "WHEN_REQUESTED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
  ],
  attachable_visual: [
    { id: "attachable_bbmodel", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "NATIVE_PROJECT_READBACK" },
    { id: "attachable_binding_review", delivery_kind: "REVIEW", trigger: "REQUIRED", evidence_class: "BINDING_REFERENCE_REVIEW" },
    { id: "holder_fit_review", delivery_kind: "REVIEW", trigger: "REQUIRED", evidence_class: "NATIVE_HOLDER_VISUAL_REVIEW" },
    { id: "attachable_texture_png", delivery_kind: "FILE", trigger: "WHEN_REQUESTED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
    { id: "attachable_resource_handoff", delivery_kind: "HANDOFF", trigger: "WHEN_REQUESTED", evidence_class: "BINDING_REFERENCE_REVIEW" },
  ],
  custom_block_visual: [
    { id: "block_geometry_json", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "FILE_READBACK_AND_IDENTITY" },
    { id: "block_texture_png", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
    { id: "block_compatibility_review", delivery_kind: "REVIEW", trigger: "REQUIRED", evidence_class: "FORMAT_COMPATIBILITY_REVIEW" },
    { id: "block_source_project", delivery_kind: "FILE", trigger: "WHEN_REQUESTED", evidence_class: "NATIVE_PROJECT_READBACK" },
  ],
  item_icon_sprite: [
    { id: "item_icon_png", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
    { id: "item_atlas_handoff", delivery_kind: "HANDOFF", trigger: "REQUIRED", evidence_class: "BINDING_REFERENCE_REVIEW" },
  ],
  block_flipbook: [
    { id: "flipbook_strip_png", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
    { id: "flipbook_definition_handoff", delivery_kind: "HANDOFF", trigger: "REQUIRED", evidence_class: "FRAME_AND_ATLAS_REVIEW" },
    { id: "terrain_atlas_handoff", delivery_kind: "HANDOFF", trigger: "REQUIRED", evidence_class: "BINDING_REFERENCE_REVIEW" },
  ],
  classic_player_skin: [
    { id: "skin_png", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
    { id: "skin_metadata_handoff", delivery_kind: "HANDOFF", trigger: "REQUIRED", evidence_class: "SKIN_UV_AND_METADATA_REVIEW" },
  ],
  bedrock_particle: [
    { id: "particle_definition_json", delivery_kind: "FILE", trigger: "REQUIRED", evidence_class: "FILE_READBACK_AND_IDENTITY" },
    { id: "particle_dependency_review", delivery_kind: "REVIEW", trigger: "REQUIRED", evidence_class: "PARTICLE_RESOURCE_REVIEW" },
    { id: "particle_texture_png", delivery_kind: "FILE", trigger: "WHEN_REFERENCED", evidence_class: "PNG_READBACK_AND_PIXEL_REVIEW" },
  ],
} as const satisfies Readonly<
  Record<AssetOutputContractId, readonly AssetOutputRequirement[]>
>;

export type AssetOutputDeliverableId =
  (typeof ASSET_OUTPUT_CONTRACTS)[AssetOutputContractId][number]["id"];

export type AssetOutputPlan = Readonly<{
  asset_profile_id: AssetProfileId;
  output_contract: AssetOutputContractId;
  state: "SOURCE_PLAN_ONLY" | "CONDITIONAL_REFERENCE_UNRESOLVED";
  /** Requirements triggered by the user, fixed contract, or confirmed references. */
  deliverables: readonly AssetOutputRequirement[];
  /** A missing dependency inventory cannot establish that a file is unnecessary. */
  unresolved_conditionals: readonly string[];
  native_verified: false;
  files_written: false;
  minecraft_verified: false;
}>;

function uniqueIds(value: readonly string[] | undefined, label: string): Set<string> {
  if (value === undefined) return new Set<string>();
  if (!Array.isArray(value) || value.some(
    (entry) => typeof entry !== "string" || entry.trim() !== entry || entry.length === 0
  )) {
    throw new Error("ASSET_OUTPUT_" + label + "_INVALID");
  }
  const unique = new Set(value);
  if (unique.size !== value.length) {
    throw new Error("ASSET_OUTPUT_" + label + "_DUPLICATE");
  }
  return unique;
}

/**
 * Plan exactly the requested/required output identities. This pure function
 * never checks file bytes or invokes native tools. When a resource dependency
 * inventory is absent, do not silently treat WHEN_REFERENCED as optional.
 *
 * An explicit user request can include a WHEN_REFERENCED deliverable even
 * before its upstream reference inventory exists.
 */
export function planAssetOutputRequirements(input: {
  asset_profile_id: AssetProfileId;
  requested?: readonly string[];
  /** Caller-declared complete reference inventory, not authenticated here; omitted = unknown. */
  referenced?: readonly string[] | null;
}): AssetOutputPlan {
  const profile = getAssetProfileContract(input.asset_profile_id);
  // Widen the literal tuple union for uniform map/filter operations.
  const contract: readonly AssetOutputRequirement[] =
    ASSET_OUTPUT_CONTRACTS[profile.output_contract];
  const byId = new Map<string, AssetOutputRequirement>(
    contract.map((entry) => [entry.id, entry] as const)
  );
  const requested = uniqueIds(input.requested, "REQUEST");
  const referenced = input.referenced == null
    ? null : uniqueIds(input.referenced, "REFERENCE");

  for (const id of requested) {
    if (!byId.has(id)) throw new Error("ASSET_OUTPUT_UNSUPPORTED_FOR_PROFILE");
  }
  if (referenced !== null) {
    for (const id of referenced) {
      const entry = byId.get(id);
      if (!entry || entry.trigger !== "WHEN_REFERENCED") {
        throw new Error("ASSET_OUTPUT_REFERENCE_NOT_CONDITIONAL");
      }
    }
  }

  const deliverables = contract.filter((entry) =>
    entry.trigger === "REQUIRED" || requested.has(entry.id) ||
    (entry.trigger === "WHEN_REFERENCED" && referenced?.has(entry.id) === true)
  );
  const unresolved = contract
    .filter((entry) => entry.trigger === "WHEN_REFERENCED" &&
      referenced === null && !requested.has(entry.id))
    .map((entry) => entry.id);

  return {
    asset_profile_id: input.asset_profile_id,
    output_contract: profile.output_contract,
    state: unresolved.length > 0
      ? "CONDITIONAL_REFERENCE_UNRESOLVED" : "SOURCE_PLAN_ONLY",
    deliverables,
    unresolved_conditionals: unresolved,
    native_verified: false,
    files_written: false,
    minecraft_verified: false,
  };
}
