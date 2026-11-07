import { describe, expect, test } from "bun:test";
import {
  ASSET_PROFILE_CONTRACTS,
  ASSET_PROFILE_IDS,
  getAssetProfileContract,
  isAssetProfileId,
  legacyAssetProfileForReferenceKind,
  resolveAssetProfileSelection,
  supportsAssetAuthoringDomain,
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
    // Particle's authoring owner is the existing ANIMATION Runtime surface,
    // but an authoring-domain allowance never implies animation-clip QA.
    expect(supportsAssetAuthoringDomain("particle", "ANIMATION")).toBe(true);
    expect(supportsAssetAuthoringDomain("particle", "GEOMETRY")).toBe(false);
    expect(lifecycleForDomain("ANIMATION", ws, "particle")).toMatchObject({
      ready: true, blocked: false, orientation_required: false, reasons: [],
    });
    ws.gates.texturing = "NOT_STARTED";
    expect(lifecycleForDomain("ANIMATION", ws, "particle")).toMatchObject({
      ready: false, blocked: false, orientation_required: true,
      reasons: ["ASSET_PROFILE_TEXTURE_REQUIREMENT_UNRESOLVED"],
    });
    expect(lifecycleForDomain("ANIMATION", ws, "entity").reasons).toContain(
      "GEOMETRY_APPROVAL_REQUIRED"
    );
  });

  test("declared authoring domains are not identical to output approval gates", () => {
    for (const id of ASSET_PROFILE_IDS) {
      const contract = getAssetProfileContract(id);
      expect(new Set(contract.authoring_domains).size).toBe(contract.authoring_domains.length);
      expect(contract.authoring_domains.length).toBeGreaterThan(0);
    }
    expect(ASSET_PROFILE_CONTRACTS.particle.stages.animation).toBe("NOT_APPLICABLE");
    expect(supportsAssetAuthoringDomain("particle", "ANIMATION")).toBe(true);
    expect(supportsAssetAuthoringDomain("item_icon", "ANIMATION")).toBe(false);
    expect(supportsAssetAuthoringDomain("item_icon", "TEXTURING")).toBe(true);
  });

  test("explicit Asset Profile identity is strict, compatible and never inferred from modelling subtype", () => {
    expect(resolveAssetProfileSelection({referenceAssetKind:"MODEL"})).toEqual({
      state:"RESOLVED", asset_profile_id:"entity", basis:"LEGACY_KIND",
    });
    expect(resolveAssetProfileSelection({referenceAssetKind:"PARTICLE"})).toEqual({
      state:"RESOLVED", asset_profile_id:"particle", basis:"LEGACY_KIND",
    });
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"attachable",referenceAssetKind:"MODEL"}))
      .toMatchObject({state:"RESOLVED",asset_profile_id:"attachable",basis:"EXPLICIT"});
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"item_icon"}))
      .toMatchObject({state:"RESOLVED",asset_profile_id:"item_icon",basis:"EXPLICIT"});
    for (const explicitAssetProfileId of ["HUMANOID","bedrock_entity","constructor","__proto__","unknown",""]) {
      expect(resolveAssetProfileSelection({explicitAssetProfileId,referenceAssetKind:"MODEL"}))
        .toEqual({state:"CONFLICT",reason:"ASSET_PROFILE_ID_INVALID"});
    }
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"item_icon",referenceAssetKind:"MODEL"}))
      .toEqual({state:"CONFLICT",reason:"ASSET_PROFILE_KIND_CONFLICT"});
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"entity",referenceAssetKind:"PARTICLE"}))
      .toEqual({state:"CONFLICT",reason:"ASSET_PROFILE_KIND_CONFLICT"});
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"particle",referenceAssetKind:"PARTICLE"}))
      .toMatchObject({state:"RESOLVED",asset_profile_id:"particle"});
    expect(resolveAssetProfileSelection({referenceAssetKind:"ICON"}))
      .toEqual({state:"UNRESOLVED",reason:"UNKNOWN_REFERENCE_ASSET_KIND"});
    expect(resolveAssetProfileSelection({explicitAssetProfileId:"item_icon",referenceAssetKind:"ICON"}))
      .toEqual({state:"UNRESOLVED",reason:"UNKNOWN_REFERENCE_ASSET_KIND"});
    expect(resolveAssetProfileSelection({}))
      .toEqual({state:"UNRESOLVED",reason:"ASSET_PROFILE_ID_MISSING"});
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

  test("non-Entity finalization never mistakes a stale Entity .bbmodel for its own output", () => {
    const ws = workspace();
    ws.current_stage = "FINALIZATION";
    ws.finalization_native_revision = {
      state: "STALE", reason: "FINALIZATION_NATIVE_CHECKPOINT_MISMATCH",
    };
    const icon = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: reference(),
      asset_profile_id: "item_icon",
    });
    expect(icon.overall).toBe("INCOMPLETE");
    expect(icon.blockers).not.toContain("FINALIZATION_NATIVE_CHECKPOINT_STALE");
    const entity = buildAssetHealthSummary({
      domain: "TEXTURING", workspace: ws, reference: reference(),
    });
    expect(entity.overall).toBe("BLOCKED");
    expect(entity.blockers).toContain("FINALIZATION_NATIVE_CHECKPOINT_STALE");
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
