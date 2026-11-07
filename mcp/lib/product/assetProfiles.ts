/**
 * Canonical Minecraft visual-asset intent. An Asset Profile is NOT a Runtime
 * Registration Profile, Blockbench Format, modelling subtype or capability set.
 * This is source contract metadata; it does not register native executors.
 */
export const ASSET_PROFILE_IDS = [
  "entity",
  "attachable",
  "custom_block",
  "item_icon",
  "animated_texture",
  "player_skin",
  "particle",
] as const;

export type AssetProfileId = (typeof ASSET_PROFILE_IDS)[number];
export type AssetCategoryId = "models_3d" | "textures_2d" | "visual_effects";
export type AssetStageRequirement = "REQUIRED" | "CONDITIONAL" | "NOT_APPLICABLE";
export type AssetStageGate = "geometry" | "uv_layout" | "texturing" | "animation";
export type AssetOutputContractId =
  | "entity_model"
  | "attachable_visual"
  | "custom_block_visual"
  | "item_icon_sprite"
  | "block_flipbook"
  | "classic_player_skin"
  | "bedrock_particle";

export type AssetProfileContract = Readonly<{
  category: AssetCategoryId;
  stages: Readonly<Record<AssetStageGate, AssetStageRequirement>>;
  output_contract: AssetOutputContractId;
}>;

/**
 * Stage applicability, not Stage approval or the existence of a Runtime route.
 * Profile-specific fit, skin-UV, flipbook, particle and output checks are NOT
 * satisfied by these four existing Entity lifecycle gates.
 */
export const ASSET_PROFILE_CONTRACTS = {
  entity: {
    category: "models_3d",
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "CONDITIONAL" },
    output_contract: "entity_model",
  },
  attachable: {
    category: "models_3d",
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "CONDITIONAL" },
    output_contract: "attachable_visual",
  },
  custom_block: {
    category: "models_3d",
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "custom_block_visual",
  },
  item_icon: {
    category: "textures_2d",
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "item_icon_sprite",
  },
  animated_texture: {
    category: "textures_2d",
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "block_flipbook",
  },
  player_skin: {
    category: "textures_2d",
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "classic_player_skin",
  },
  particle: {
    category: "visual_effects",
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "CONDITIONAL", animation: "NOT_APPLICABLE" },
    output_contract: "bedrock_particle",
  },
} as const satisfies Readonly<Record<AssetProfileId, AssetProfileContract>>;

export function isAssetProfileId(value: unknown): value is AssetProfileId {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ASSET_PROFILE_CONTRACTS, value);
}

export function getAssetProfileContract(id: AssetProfileId): AssetProfileContract {
  if (!isAssetProfileId(id)) throw new Error("UNKNOWN_ASSET_PROFILE");
  return ASSET_PROFILE_CONTRACTS[id];
}

/**
 * A compatibility inference only for legacy Reference Package asset_kind.
 * A MODEL may later denote other asset profiles; never use this helper to
 * override an explicit new Asset Profile or interpret selected_profile.
 */
export function legacyAssetProfileForReferenceKind(kind: unknown): AssetProfileId | null {
  if (kind === "MODEL") return "entity";
  if (kind === "PARTICLE") return "particle";
  return null;
}
