import { describe, expect, test } from "bun:test";
import {
  ASSET_OUTPUT_CONTRACTS,
  planAssetOutputRequirements,
} from "@/lib/product/assetOutputContracts";
import {
  ASSET_PROFILE_IDS,
  getAssetProfileContract,
} from "@/lib/product/assetProfiles";

const ids = (profile: (typeof ASSET_PROFILE_IDS)[number],
  options: { requested?: string[]; referenced?: string[] | null } = {}) =>
  planAssetOutputRequirements({ asset_profile_id: profile, ...options })
    .deliverables.map((entry) => entry.id);

describe("canonical visual asset output contracts", () => {
  test("one output contract and at least one file for every canonical profile", () => {
    for (const id of ASSET_PROFILE_IDS) {
      const outputId = getAssetProfileContract(id).output_contract;
      const entries = ASSET_OUTPUT_CONTRACTS[outputId];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((entry) =>
        entry.delivery_kind === "FILE" && entry.trigger === "REQUIRED")).toBe(true);
      expect(entries.every((entry) => entry.id.length > 0)).toBe(true);
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    }
    expect(Object.keys(ASSET_OUTPUT_CONTRACTS)).toHaveLength(7);
    expect(new Set(ASSET_PROFILE_IDS.map((id) =>
      getAssetProfileContract(id).output_contract)).size).toBe(7);
  });

  test("Entity retains an editable project and exports only when requested", () => {
    expect(ids("entity")).toEqual(["editable_bbmodel"]);
    expect(ids("entity", { requested: [
      "entity_animation_json", "entity_geometry_json",
    ] })).toEqual([
      "editable_bbmodel", "entity_geometry_json", "entity_animation_json",
    ]);
    const animation = ASSET_OUTPUT_CONTRACTS.entity_model
      .find((entry) => entry.id === "entity_animation_json");
    expect(animation?.evidence_class).toBe("NATIVE_COMPILE_AND_FILE_READBACK");
    expect(() => ids("entity", { requested: ["item_icon_png"] }))
      .toThrow("ASSET_OUTPUT_UNSUPPORTED_FOR_PROFILE");
  });

  test("Attachables require binding and real holder fit, not just model capture", () => {
    expect(ids("attachable")).toEqual([
      "attachable_bbmodel", "attachable_binding_review", "holder_fit_review",
    ]);
    expect(ids("attachable", { requested: ["attachable_resource_handoff"] }))
      .toContain("attachable_resource_handoff");
    expect(ASSET_OUTPUT_CONTRACTS.attachable_visual.find(
      (entry) => entry.id === "holder_fit_review"
    )?.evidence_class).toBe("NATIVE_HOLDER_VISUAL_REVIEW");
  });

  test("block visuals, icons, flipbooks and skins use distinct files and handoffs", () => {
    expect(ids("custom_block")).toEqual([
      "block_geometry_json", "block_texture_png", "block_compatibility_review",
    ]);
    expect(ids("item_icon")).toEqual(["item_icon_png", "item_atlas_handoff"]);
    expect(ids("animated_texture")).toEqual([
      "flipbook_strip_png", "flipbook_definition_handoff", "terrain_atlas_handoff",
    ]);
    expect(ids("player_skin")).toEqual(["skin_png", "skin_metadata_handoff"]);
    expect(ids("custom_block", { requested: ["block_source_project"] }))
      .toContain("block_source_project");
    expect(() => ids("animated_texture", { requested: ["entity_animation_json"] }))
      .toThrow("ASSET_OUTPUT_UNSUPPORTED_FOR_PROFILE");
  });

  test("Particle texture remains unresolved until its reference inventory is known", () => {
    const unknown = planAssetOutputRequirements({ asset_profile_id: "particle" });
    expect(unknown.state).toBe("CONDITIONAL_REFERENCE_UNRESOLVED");
    expect(unknown.unresolved_conditionals).toEqual(["particle_texture_png"]);
    expect(ids("particle")).toEqual([
      "particle_definition_json", "particle_dependency_review",
    ]);
    const confirmedNone = planAssetOutputRequirements({
      asset_profile_id: "particle", referenced: [],
    });
    expect(confirmedNone.state).toBe("SOURCE_PLAN_ONLY");
    expect(confirmedNone.unresolved_conditionals).toEqual([]);
    expect(ids("particle", { referenced: ["particle_texture_png"] })).toEqual([
      "particle_definition_json", "particle_dependency_review",
      "particle_texture_png",
    ]);
    const requested = planAssetOutputRequirements({
      asset_profile_id: "particle", requested: ["particle_texture_png"],
    });
    expect(requested.unresolved_conditionals).toEqual([]);
    expect(requested.deliverables.at(-1)?.id).toBe("particle_texture_png");
  });

  test("unknown, duplicate, or malformed output requests fail closed", () => {
    expect(() => ids("item_icon", { requested: ["item_icon_png", "item_icon_png"] }))
      .toThrow("ASSET_OUTPUT_REQUEST_DUPLICATE");
    expect(() => ids("item_icon", { requested: ["item_icon_png "] }))
      .toThrow("ASSET_OUTPUT_REQUEST_INVALID");
    expect(() => ids("item_icon", { requested: ["nonexistent"] }))
      .toThrow("ASSET_OUTPUT_UNSUPPORTED_FOR_PROFILE");
    expect(() => ids("item_icon", { requested: null as never }))
      .toThrow("ASSET_OUTPUT_REQUEST_INVALID");
    expect(() => ids("particle", { referenced: [
      "particle_texture_png", "particle_texture_png",
    ] })).toThrow("ASSET_OUTPUT_REFERENCE_DUPLICATE");
    expect(() => ids("particle", { referenced: ["particle_definition_json"] }))
      .toThrow("ASSET_OUTPUT_REFERENCE_NOT_CONDITIONAL");
    expect(() => ids("particle", { referenced: ["item_icon_png"] }))
      .toThrow("ASSET_OUTPUT_REFERENCE_NOT_CONDITIONAL");
    expect(() => planAssetOutputRequirements({
      asset_profile_id: "unknown" as never,
    })).toThrow("UNKNOWN_ASSET_PROFILE");
  });

  test("pure source plans never claim export, native, visual or game acceptance", () => {
    for (const profile of ASSET_PROFILE_IDS) {
      const plan = planAssetOutputRequirements({
        asset_profile_id: profile, referenced: [],
      });
      expect(plan.state).toBe("SOURCE_PLAN_ONLY");
      expect(plan.files_written).toBe(false);
      expect(plan.native_verified).toBe(false);
      expect(plan.minecraft_verified).toBe(false);
      expect(Object.hasOwn(plan, "visual_pass")).toBe(false);
      expect(Object.hasOwn(plan, "finalization_ready")).toBe(false);
    }
  });
});
