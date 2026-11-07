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
export type AssetAuthoringDomain = "GEOMETRY" | "TEXTURING" | "ANIMATION";
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
  /** Existing MCP authoring domains; not independent registered tool surfaces. */
  authoring_domains: readonly AssetAuthoringDomain[];
  /** Output-quality gates, not the domains that host those capabilities. */
  stages: Readonly<Record<AssetStageGate, AssetStageRequirement>>;
  output_contract: AssetOutputContractId;
}>;

/**
 * Stage gates and domain eligibility are different axes; neither is native
 * capability availability, user approval, nor proof of an output codec.
 * Profile-specific fit, skin-UV, flipbook, particle and output checks are NOT
 * satisfied by these four existing Entity lifecycle gates.
 */
export const ASSET_PROFILE_CONTRACTS = {
  entity: {
    category: "models_3d",
    authoring_domains: ["GEOMETRY", "TEXTURING", "ANIMATION"],
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "CONDITIONAL" },
    output_contract: "entity_model",
  },
  attachable: {
    category: "models_3d",
    authoring_domains: ["GEOMETRY", "TEXTURING", "ANIMATION"],
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "CONDITIONAL" },
    output_contract: "attachable_visual",
  },
  custom_block: {
    category: "models_3d",
    authoring_domains: ["GEOMETRY", "TEXTURING"],
    stages: { geometry: "REQUIRED", uv_layout: "REQUIRED", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "custom_block_visual",
  },
  item_icon: {
    category: "textures_2d",
    authoring_domains: ["TEXTURING"],
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "item_icon_sprite",
  },
  animated_texture: {
    category: "textures_2d",
    authoring_domains: ["TEXTURING"],
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "block_flipbook",
  },
  player_skin: {
    category: "textures_2d",
    authoring_domains: ["TEXTURING"],
    stages: { geometry: "NOT_APPLICABLE", uv_layout: "NOT_APPLICABLE", texturing: "REQUIRED", animation: "NOT_APPLICABLE" },
    output_contract: "classic_player_skin",
  },
  particle: {
    category: "visual_effects",
    authoring_domains: ["TEXTURING", "ANIMATION"],
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

export function supportsAssetAuthoringDomain(
  id: AssetProfileId,
  domain: AssetAuthoringDomain
): boolean {
  return getAssetProfileContract(id).authoring_domains.includes(domain);
}

/**
 * Resolve only intent identity. No mutation, approval, Runtime registration,
 * Reference schema change, or implicit modelling subtype -> Asset Profile.
 */
export type AssetProfileSelection =
  | { state: "RESOLVED"; asset_profile_id: AssetProfileId; basis: "EXPLICIT" | "LEGACY_KIND" }
  | { state: "UNRESOLVED"; reason: "ASSET_PROFILE_ID_MISSING" | "UNKNOWN_REFERENCE_ASSET_KIND" }
  | { state: "CONFLICT"; reason: "ASSET_PROFILE_ID_INVALID" | "ASSET_PROFILE_KIND_CONFLICT" };

export function resolveAssetProfileSelection(input: {
  /** Canonical future field; NOT the legacy modelling selected_profile. */
  explicitAssetProfileId?: unknown;
  /** Current Reference asset.kind: MODEL | PARTICLE, not profile. */
  referenceAssetKind?: unknown;
}): AssetProfileSelection {
  const explicit = input.explicitAssetProfileId;
  const kind = input.referenceAssetKind;
  if (explicit !== null && explicit !== undefined) {
    if (!isAssetProfileId(explicit)) {
      return { state: "CONFLICT", reason: "ASSET_PROFILE_ID_INVALID" };
    }
    if (kind === null || kind === undefined) {
      return { state: "RESOLVED", asset_profile_id: explicit, basis: "EXPLICIT" };
    }
    if (kind !== "MODEL" && kind !== "PARTICLE") {
      return { state: "UNRESOLVED", reason: "UNKNOWN_REFERENCE_ASSET_KIND" };
    }
    const isModelProfile = getAssetProfileContract(explicit).category === "models_3d";
    if ((kind === "MODEL" && !isModelProfile) ||
        (kind === "PARTICLE" && explicit !== "particle")) {
      return { state: "CONFLICT", reason: "ASSET_PROFILE_KIND_CONFLICT" };
    }
    return { state: "RESOLVED", asset_profile_id: explicit, basis: "EXPLICIT" };
  }
  if (kind === null || kind === undefined) {
    return { state: "UNRESOLVED", reason: "ASSET_PROFILE_ID_MISSING" };
  }
  const legacy = legacyAssetProfileForReferenceKind(kind);
  return legacy
    ? { state: "RESOLVED", asset_profile_id: legacy, basis: "LEGACY_KIND" }
    : { state: "UNRESOLVED", reason: "UNKNOWN_REFERENCE_ASSET_KIND" };
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
