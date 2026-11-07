import { describe, expect, test } from "bun:test";
import {
  ASSET_PROFILE_CONTRACTS,
  ASSET_PROFILE_IDS,
  getAssetProfileContract,
  isAssetProfileId,
  legacyAssetProfileForReferenceKind,
} from "@/lib/product/assetProfiles";
import { buildAssetHealthSummary } from "@/lib/authoring/assetHealth";
import { lifecycleForDomain } from "@/gateway/control/readiness";
import { DEFAULT_MCP_REGISTRATION_PROFILE } from "@/lib/capabilities/registrationProfile";
import type { ControlWorkspaceProjection } from "@/gateway/control/workspace";

function workspace(): ControlWorkspaceProjection {
  return {
    available: true,
    source_path: null,
    fingerprint: "test",
    asset: "test",
    current_stage: "TEXTURING",
    gates: {
      geometry: "NOT_STARTED", uv_layout: "NOT_STARTED",
      texturing: "APPROVED", animation: "NOT_STARTED",
    },
    next_step: null,
    blockers: [],
  };
}

function reference(animationRequired: boolean | null = false) {
  return {
    available: true,
    requirements: { animation_required: animationRequired },
    readiness: {
      overall: "READY", geometry: "READY",
      texture: "READY", animation: "READY",
    },
  };
}

describe("seven canonical Asset Profiles (source contract only)", () => {
  test("seven distinct output intents belong to exactly three categories", () => {
    expect(ASSET_PROFILE_IDS).toHaveLength(7);
    expect(new Set(ASSET_PROFILE_IDS).size).toBe(7);
    expect(new Set(ASSET_PROFILE_IDS.map(id =>
      getAssetProfileContract(id).category))).toEqual(
      new Set(["models_3d", "textures_2d", "visual_effects"])
    );
    expect(new Set(ASSET_PROFILE_IDS.map(id =>
      getAssetProfileContract(id).output_contract)).size).toBe(7);
    expect(DEFAULT_MCP_REGISTRATION_PROFILE).toBe("bedrock_entity");
  });

  test("asset identity never aliases modelling subtype or Runtime profile", () => {
    for (const id of ASSET_PROFILE_IDS) expect(isAssetProfileId(id)).toBe(true);
    for (const legacy of ["bedrock_entity", "extended", "HUMANOID", "PROP_FURNITURE", "MODEL", "", null]) {
      expect(isAssetProfileId(legacy)).toBe(false);
    }
    expect(legacyAssetProfileForReferenceKind("MODEL")).toBe("entity");
    expect(legacyAssetProfileForReferenceKind("PARTICLE")).toBe("particle");
    expect(legacyAssetProfileForReferenceKind("SKIN")).toBeNull();
    expect(() => getAssetProfileContract("unknown" as never)).toThrow("UNKNOWN_ASSET_PROFILE");
  });

  test("2D/particle profiles do not inherit model Geometry or native UV gates", () => {
    for (const id of ["item_icon", "animated_texture", "player_skin", "particle"] as const) {
      const gates = ASSET_PROFILE_CONTRACTS[id].stages;
      expect(gates.geometry).toBe("NOT_APPLICABLE");
      expect(gates.uv_layout).toBe("NOT_APPLICABLE");
    }
    expect(ASSET_PROFILE_CONTRACTS.player_skin.output_contract).toBe("classic_player_skin");
    expect(ASSET_PROFILE_CONTRACTS.animated_texture.stages.animation)
      .toBe("NOT_APPLICABLE");
    expect(ASSET_PROFILE_CONTRACTS.particle.stages.animation)
      .toBe("NOT_APPLICABLE");
    expect(ASSET_PROFILE_CONTRACTS.entity.stages.animation).toBe("CONDITIONAL");
    expect(ASSET_PROFILE_CONTRACTS.attachable.stages.geometry).toBe("REQUIRED");
    expect(ASSET_PROFILE_CONTRACTS.custom_block.stages.uv_layout).toBe("REQUIRED");
  });

  test("explicit 2D lifecycle needs Texture, not Entity Geometry/UV approval", () => {
    const ws = workspace();
    const icon = lifecycleForDomain("TEXTURING", ws, "item_icon");
    expect(icon).toMatchObject({ ready: true, blocked: false, reasons: [] });
    expect(lifecycleForDomain("TEXTURING", ws)).toMatchObject({
      ready: false, blocked: true,
      reasons: ["GEOMETRY_APPROVAL_REQUIRED", "UV_LAYOUT_PASS_REQUIRED"],
    });
    expect(lifecycleForDomain("TEXTURING", ws, "custom_block").reasons).toEqual([
      "GEOMETRY_APPROVAL_REQUIRED", "UV_LAYOUT_PASS_REQUIRED",
    ]);
    expect(lifecycleForDomain("GEOMETRY", ws, "item_icon")).toMatchObject({
      ready: false, blocked: true,
      reasons: ["ASSET_PROFILE_STAGE_NOT_APPLICABLE"],
    });
    expect(lifecycleForDomain("ANIMATION", ws, "particle").reasons).toEqual([
      "ASSET_PROFILE_STAGE_NOT_APPLICABLE",
    ]);
  });

  test("non-Entity health omits irrelevant gates but cannot claim output READY", () => {
    const ws = workspace();
    const icon = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: reference(),
      asset_profile_id: "item_icon",
    });
    expect(icon.stages).toMatchObject({
      geometry: "NOT_REQUIRED", uv_layout: "NOT_REQUIRED",
      texturing: "PASS", animation: "NOT_REQUIRED",
    });
    expect(icon.overall).toBe("INCOMPLETE");
    expect(icon.note).toContain("not integrated");

    ws.gates.geometry = "APPROVED";
    ws.gates.uv_layout = "PASS";
    const legacyEntity = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: reference(),
    });
    const explicitEntity = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: reference(),
      asset_profile_id: "entity",
    });
    expect(explicitEntity).toEqual(legacyEntity);
    expect(legacyEntity.overall).toBe("READY");
  });

  test("profile-incompatible animation demand remains unresolved, not dropped", () => {
    const result = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: workspace(), reference: reference(true),
      asset_profile_id: "item_icon",
    });
    expect(result.stages.animation).toBe("UNVERIFIED");
    expect(result.overall).toBe("REVIEW");
  });
});
