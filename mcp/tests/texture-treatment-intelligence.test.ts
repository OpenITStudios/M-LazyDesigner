import { describe, expect, test } from "bun:test";
import { analyzeRenderAwareAlpha } from "@/lib/textureAlphaSemantics";
import {
  getTextureSurfacePatternRecipe,
  TEXTURE_SURFACE_PATTERN_NAMES,
} from "@/lib/textureSurfacePattern";
import { planTextureTreatment } from "@/lib/textureTreatmentPlan";
import { VANILLA_TEXTURE_KNOWLEDGE } from "@/lib/textureVanillaKnowledge";

function pixels(alpha: readonly number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alpha.length * 4);
  alpha.forEach((value, index) => {
    out[index * 4] = 80;
    out[index * 4 + 1] = 120;
    out[index * 4 + 2] = 160;
    out[index * 4 + 3] = value;
  });
  return out;
}

describe("texture treatment intelligence", () => {
  test("surface recipes describe pixel language without selecting render behavior", () => {
    expect(TEXTURE_SURFACE_PATTERN_NAMES.length).toBeGreaterThanOrEqual(12);
    const glass = getTextureSurfacePatternRecipe("clean_glass");
    const metal = getTextureSurfacePatternRecipe("brushed_metal");
    expect(glass.domain).toBe("surface_pattern");
    expect(glass.render_profile_inference).toBe("forbidden");
    expect(glass.avoid.join(" ")).toContain("translucency inference");
    expect(metal.cluster_language).toContain("hard clusters");
  });

  test("alpha diagnostics distinguish cutout, blend, emissive mask, and custom semantics", () => {
    const sample = pixels([0, 128, 255]);
    const cutout = analyzeRenderAwareAlpha({ pixels: sample, render_profile: "cutout" });
    const blend = analyzeRenderAwareAlpha({ pixels: sample, render_profile: "translucent" });
    const glow = analyzeRenderAwareAlpha({ pixels: sample, render_profile: "emissive_mask" });
    const custom = analyzeRenderAwareAlpha({
      pixels: sample,
      minecraft_material_code: "custom:unknown",
    });

    expect(cutout.state).toBe("review_required");
    expect(cutout.reasons).toContain("CUTOUT_INTERMEDIATE_ALPHA_REVIEW");
    expect(blend.state).toBe("ready");
    expect(blend.interpretation).toBe("alpha_controls_blended_opacity");
    expect(glow.state).toBe("ready");
    expect(glow.interpretation).toContain("not_opacity");
    expect(custom.state).toBe("unverified");
  });

  test("treatment planner keeps pattern, render profile, and PBR independent", () => {
    const plan = planTextureTreatment({
      identity_colors: ["dark teal", "orange"],
      regions: [
        {
          region: "body",
          evidence: "observed",
          surface_pattern: "painted_metal",
          render_profile: "opaque",
          pbr_intent: "optional",
        },
        {
          region: "window",
          evidence: "observed",
          surface_pattern: "clean_glass",
          render_profile: "translucent",
          pbr_intent: "none",
        },
        {
          region: "lamp",
          evidence: "inferred",
          surface_pattern: "emissive_panel",
          render_profile: "emissive_mask",
          pbr_intent: "none",
        },
      ],
    });

    expect(plan.readiness.state).toBe("ready");
    expect(plan.regions[1].render_contract?.minecraft_material_code).toBe("entity_alphablend");
    expect(plan.regions[1].surface_pattern?.pattern).toBe("clean_glass");
    expect(plan.regions[2].render_contract?.alpha_semantics).toBe("emissive_mask");
    expect(plan.rules.pattern_does_not_select_render_profile).toBe(true);
    expect(plan.readiness.scope).toBe("regions_only");
    expect(plan.face_coverage.visual_verdict).toBe("not_evaluated");
  });

  test("face-inventory treatment planning detects missing undersides before readiness", () => {
    const planned = planTextureTreatment({
      required_faces: [
        { cube_uuid: "boot", face: "north" },
        { cube_uuid: "boot", face: "down" },
        { cube_uuid: "boot", face: "south" },
      ],
      regions: [{
        region: "boots", evidence: "observed",
        surface_pattern: "painted_metal", render_profile: "opaque",
        face_targets: [{ cube_uuid: "boot", face: "north", treatment: "PAINT" }],
      }],
    });
    expect(planned.readiness.state).toBe("review_required");
    expect(planned.readiness.scope).toBe("explicit_face_inventory");
    expect(planned.face_coverage.state).toBe("incomplete");
    if (planned.face_coverage.state !== "incomplete") throw Error("expected missing");
    expect(planned.face_coverage.missing_count).toBe(2);
    expect(planned.face_coverage.missing_examples).toContain("boot:down");
    expect(planned.readiness.unresolved).toContainEqual({
      region: "*", reason: "FACE_ASSIGNMENT_INCOMPLETE",
    });

    const complete = planTextureTreatment({
      required_faces: [
        { cube_uuid: "boot", face: "north" },
        { cube_uuid: "boot", face: "down" },
      ],
      regions: [{
        region: "boots", evidence: "observed",
        surface_pattern: "painted_metal", render_profile: "opaque",
        face_targets: [
          { cube_uuid: "boot", face: "north", treatment: "PAINT" },
          { cube_uuid: "boot", face: "down", treatment: "INTENTIONAL_FLAT" },
        ],
      }],
    });
    expect(complete.readiness.state).toBe("ready");
    expect(complete.face_coverage.state).toBe("assigned");
    expect(complete.face_coverage.visual_verdict).toBe("not_evaluated");
  });

  test("treatment inventory refuses duplicate ownership and unresolved aliases", () => {
    const base = { region: "cloth", evidence: "observed" as const,
      surface_pattern: "painted_metal" as const, render_profile: "opaque" as const };
    expect(() => planTextureTreatment({
      regions: [base], required_faces: [
        { cube_uuid: "boot", face: "down" },
        { cube_uuid: "boot", face: "down" },
      ],
    })).toThrow("duplicate Cube/face");
    expect(() => planTextureTreatment({
      required_faces: [{ cube_uuid: "boot", face: "down" }],
      regions: [{
        ...base, face_targets: [
          { cube_uuid: "boot", face: "down", treatment: "SHARED" },
        ],
      }],
    }).readiness.unresolved).toContainEqual({
      region: "cloth", reason: "SHARED_UV_SOURCE_REQUIRED",
    });
    expect(() => planTextureTreatment({
      regions: [{
        ...base, face_targets: [
          { cube_uuid: "boot", face: "down", treatment: "PAINT" },
        ],
      }],
    }).readiness.unresolved).toContainEqual({
      region: "*", reason: "FACE_INVENTORY_REQUIRED",
    });
  });

  test("planner leaves unresolved reference decisions explicit instead of guessing", () => {
    const plan = planTextureTreatment({
      regions: [{ region: "unknown panel", evidence: "unknown" }],
    });
    expect(plan.readiness.state).toBe("review_required");
    expect(plan.readiness.unresolved.map((item) => item.reason)).toEqual([
      "SURFACE_PATTERN_UNRESOLVED",
      "RENDER_PROFILE_UNRESOLVED",
      "REFERENCE_EVIDENCE_UNKNOWN",
    ]);
  });

  test("vanilla corpus is reference knowledge, not copied texture assets or network runtime", () => {
    expect(VANILLA_TEXTURE_KNOWLEDGE.runtime_network_required).toBe(false);
    expect(VANILLA_TEXTURE_KNOWLEDGE.copied_texture_assets_required).toBe(false);
    expect(VANILLA_TEXTURE_KNOWLEDGE.principles.join(" ")).toContain("ordered");
    expect(VANILLA_TEXTURE_KNOWLEDGE.anti_patterns.join(" ")).toContain("intermediate alpha");
  });
});
