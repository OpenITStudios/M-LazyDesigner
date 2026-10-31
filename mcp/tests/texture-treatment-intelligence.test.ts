import { describe, expect, test } from "bun:test";
import { analyzeRenderAwareAlpha } from "@/lib/textureAlphaSemantics";
import {
  getTextureSurfacePatternRecipe,
  TEXTURE_SURFACE_PATTERN_NAMES,
} from "@/lib/textureSurfacePattern";
import {
  buildTextureTreatmentCrossCubeSeamHandoff,
  requireTextureTreatmentSeamPlanReady,
  planTextureTreatment,
  type TextureTreatmentPlanInput,
  type TextureTreatmentNativeFaceBinding,
} from "@/lib/textureTreatmentPlan";
import { VANILLA_TEXTURE_KNOWLEDGE } from "@/lib/textureVanillaKnowledge";
import { reviewTexturePatternPhysicalFit } from "@/lib/texture/surfacePattern";

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
  test("K6 shared texels review conflicting authored region styling without rewriting UV", () => {
    const shared = (): TextureTreatmentPlanInput => ({
      required_faces: [
        { cube_uuid: "left", face: "north" },
        { cube_uuid: "right", face: "north" },
      ],
      regions: [
        {
          region: "source", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          identity_colors: ["#AA3300"],
          face_targets: [{ cube_uuid: "left", face: "north", treatment: "PAINT" }],
        },
        {
          region: "shared", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          identity_colors: ["#aa3300"],
          face_targets: [{ cube_uuid: "right", face: "north", treatment: "SHARED",
            shared_with: { cube_uuid: "left", face: "north" } }],
        },
      ],
    });
    const compatible = shared();
    const allowed = planTextureTreatment(compatible);
    expect(allowed.readiness.state).toBe("ready");
    expect(allowed.face_coverage.visual_verdict).toBe("not_evaluated");
    // Matching source declaration is not authenticated actual UV reuse.
    const color = shared();
    color.regions[1]!.identity_colors = ["#0000ff"];
    expect(planTextureTreatment(color).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_IDENTITY_CONFLICT",
    });
    const pattern = shared();
    pattern.regions[1]!.surface_pattern = "wood_grain";
    expect(planTextureTreatment(pattern).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_PATTERN_CONFLICT",
    });
    const render = shared();
    render.regions[1]!.render_profile = "cutout";
    expect(planTextureTreatment(render).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_RENDER_CONFLICT",
    });
    const pbr = shared();
    pbr.regions[1]!.pbr_intent = "normal";
    expect(planTextureTreatment(pbr).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_PBR_CONFLICT",
    });
    // A declared identity on only one side is missing evidence, never
    // permission to share those pixels or copy the first side's palette.
    const leftOnly = shared();
    leftOnly.regions[1]!.identity_colors = [];
    expect(planTextureTreatment(leftOnly).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_IDENTITY_UNVERIFIED",
    });
    const rightOnly = shared();
    rightOnly.regions[0]!.identity_colors = [];
    expect(planTextureTreatment(rightOnly).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_IDENTITY_UNVERIFIED",
    });
    const blank = shared();
    blank.regions[1]!.identity_colors = ["   "];
    expect(planTextureTreatment(blank).readiness.unresolved).toContainEqual({
      region: "shared", reason: "SHARED_UV_IDENTITY_UNVERIFIED",
    });
    // Formatting and case differences alone are not a different palette.
    const normalized = shared();
    normalized.regions[1]!.identity_colors = [" #aa3300 "];
    expect(planTextureTreatment(normalized).readiness.state).toBe("ready");
    // Both sides without declared colors remain only structurally ready;
    // no artistic identity/visual PASS is inferred.
    const unspecified = shared();
    unspecified.regions[0]!.identity_colors = [];
    unspecified.regions[1]!.identity_colors = [];
    expect(planTextureTreatment(unspecified).readiness.state).toBe("ready");

    // An authoring intent change after ready must be rechecked before seam handoff.
    allowed.regions[1]!.identity_colors = ["#ffff00"];
    expect(() => requireTextureTreatmentSeamPlanReady(allowed))
      .toThrow("post-planning source or continuity intent became unresolved");
    const staleIdentity = planTextureTreatment(shared());
    staleIdentity.regions[0]!.identity_colors = [];
    expect(() => requireTextureTreatmentSeamPlanReady(staleIdentity))
      .toThrow("post-planning source or continuity intent became unresolved");
  });



  test("source-bound shared UV must not treat different observed marks as the same artwork", () => {
    const sha = "a".repeat(64);
    const left = { cube_uuid: "left", face: "north" as const };
    const right = { cube_uuid: "right", face: "north" as const };
    const claim = (face: typeof left, regionId = "same_mark") => ({
      image_id: "FRONT",
      image_sha256: sha,
      image_region_id: regionId,
      part_id: "panel",
      face: { ...face },
    });
    const patternObservation = (imageRegionId: string) => ({
      image_id: "FRONT", image_sha256: sha,
      image_region_id: imageRegionId, part_id: "panel",
      cluster_shapes: "Large grouped patches with deliberately crisp breaks",
      value_placement: "Body in dark values with restrained brighter edge marks",
      detail_distribution: "Small central identity mark; most surface stays quiet",
    });
    const fixture = (): TextureTreatmentPlanInput => ({
      required_faces: [left, right],
      reference_context: {
        fingerprint: "b".repeat(64),
        images: [{
          id: "FRONT", sha256: sha, view: "front",
          integrity: "VERIFIED", status: "APPROVED", used_by: ["TEXTURE"],
          regions: [
            { id: "same_mark", part_id: "panel", evidence_role: "SURFACE_DETAIL",
              visibility: "DIRECT", box_uv: [0.1, 0.1, 0.3, 0.3], related_part_id: null },
            { id: "unique_mark", part_id: "panel", evidence_role: "SURFACE_DETAIL",
              visibility: "DIRECT", box_uv: [0.5, 0.1, 0.7, 0.3], related_part_id: null },
          ],
        }],
      },
      regions: [
        {
          region: "source", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          identity_colors: ["#aabbcc"],
          face_targets: [{ ...left, treatment: "PAINT" }],
          reference_surfaces: [claim(left)],
          pattern_observation: patternObservation("same_mark"),
        },
        {
          region: "reused", evidence: "observed",
          surface_pattern: "painted_metal", render_profile: "opaque",
          identity_colors: ["#aabbcc"],
          face_targets: [{ ...right, treatment: "SHARED", shared_with: left }],
          reference_surfaces: [claim(right)],
          pattern_observation: patternObservation("same_mark"),
        },
      ],
    });
    const compatible = planTextureTreatment(fixture());
    expect(compatible.readiness.state).toBe("ready");
    expect(compatible.reference_surface_evidence).toMatchObject({
      state: "claim_metadata_matched", matched_claim_count: 2,
      visual_verdict: "not_evaluated", mutation_authorized: false,
    });
    expect(() => requireTextureTreatmentSeamPlanReady(compatible)).not.toThrow();

    // Both image/region claims are individually current and valid, but
    // represent different visible marks: identical palette is insufficient.
    const distinct = fixture();
    distinct.regions[1]!.reference_surfaces![0]!.image_region_id = "unique_mark";
    const reviewed = planTextureTreatment(distinct);
    expect(reviewed.reference_surface_evidence.state).toBe("claim_metadata_matched");
    expect(reviewed.readiness.state).toBe("review_required");
    expect(reviewed.readiness.unresolved).toContainEqual({
      region: "reused", reason: "SHARED_UV_REFERENCE_ARTWORK_UNVERIFIED",
    });

    // One source face unbound never authorizes shared artwork.
    const sourceMissing = fixture();
    sourceMissing.regions[0]!.reference_surfaces = [];
    const missingReview = planTextureTreatment(sourceMissing);
    expect(missingReview.readiness.unresolved).toContainEqual({
      region: "reused", reason: "SHARED_UV_REFERENCE_ARTWORK_UNVERIFIED",
    });

    // Post-planning edits must not inherit previously ready seam handoffs.
    compatible.regions[1]!.reference_surfaces![0]!.image_region_id = "unique_mark";
    expect(() => requireTextureTreatmentSeamPlanReady(compatible))
      .toThrow("post-planning source or continuity intent became unresolved");

    // No reference mode remains a structural planning pass only. Never
    // reinterpret historical explicit SHARED intents as visual approval.
    const legacy = fixture();
    delete legacy.reference_context;
    legacy.regions[0]!.reference_surfaces = undefined;
    legacy.regions[1]!.reference_surfaces = undefined;
    legacy.regions[0]!.pattern_observation = undefined;
    legacy.regions[1]!.pattern_observation = undefined;
    expect(planTextureTreatment(legacy).readiness.state).toBe("ready");
  });

  test("P0 explicit source/face claims fail closed on stale or unsupported reference facts", () => {
    const digest = "b".repeat(64);
    const face = { cube_uuid: "panel", face: "north" as const };
    const fixture = (): TextureTreatmentPlanInput => ({
      required_faces: [face],
      reference_context: { fingerprint: "a".repeat(64), images: [{
        id: "FRONT", sha256: digest, view: "front",
        integrity: "VERIFIED", status: "APPROVED", used_by: ["TEXTURE"],
        regions: [{ id: "badge", part_id: "body", evidence_role: "SURFACE_DETAIL",
          visibility: "DIRECT", box_uv: [0.2, 0.2, 0.6, 0.6], related_part_id: null }],
      }] },
      regions: [{ region: "badge", evidence: "observed",
        surface_pattern: "painted_metal", render_profile: "opaque",
        face_targets: [{ ...face, treatment: "PAINT" }],
        reference_surfaces: [{ image_id: "FRONT", image_sha256: digest,
          image_region_id: "badge", part_id: "body", face }],
        pattern_observation: {
          image_id: "FRONT", image_sha256: digest,
          image_region_id: "badge", part_id: "body",
          cluster_shapes: "Large connected paint islands with stepped corners",
          value_placement: "Dark body planes and narrow lighter painted rims",
          detail_distribution: "Badge is detailed; surrounding body remains quiet",
        },
      }],
    });
    const original = fixture();
    const ready = planTextureTreatment(original);
    expect(ready.readiness.state).toBe("ready");
    expect(ready.regions[0].pattern_observation).toMatchObject({
      image_region_id: "badge",
      cluster_shapes: "Large connected paint islands with stepped corners",
    });
    expect(ready.reference_surface_evidence).toMatchObject({
      state: "claim_metadata_matched", matched_claim_count: 1,
      current_reference_read_attested: false,
      native_face_mapping_attested: false,
      mutation_authorized: false, visual_verdict: "not_evaluated",
    });
    expect(() => requireTextureTreatmentSeamPlanReady(ready)).not.toThrow();
    original.regions[0]!.pattern_observation!.cluster_shapes =
      "New textual edit that is not in the returned deep-copied plan";
    expect(ready.regions[0].pattern_observation?.cluster_shapes)
      .toBe("Large connected paint islands with stepped corners");
    original.reference_context!.images[0]!.sha256 = "c".repeat(64);
    expect(ready.reference_context?.images[0]?.sha256).toBe(digest);
    const cases: Array<[(v: TextureTreatmentPlanInput) => void, string]> = [
      [v => { v.regions[0]!.reference_surfaces![0]!.image_sha256 = "c".repeat(64); }, "REFERENCE_SURFACE_SOURCE_STALE"],
      [v => { v.regions[0]!.reference_surfaces![0]!.part_id = "wrong"; }, "REFERENCE_SURFACE_PART_MISMATCH"],
      [v => { v.reference_context!.images[0]!.view = null; }, "REFERENCE_SURFACE_VIEW_UNRESOLVED"],
      [v => { v.reference_context!.images[0]!.status = "DRAFT"; }, "REFERENCE_SURFACE_SOURCE_NOT_APPROVED"],
      [v => { v.reference_context!.images[0]!.status = null; }, "REFERENCE_SURFACE_SOURCE_NOT_APPROVED"],
      [v => { v.reference_context!.images[0]!.regions![0]!.evidence_role = "PRIMARY_VOLUME"; }, "REFERENCE_SURFACE_NOT_VISIBLE_DETAIL"],
      [v => { v.reference_context!.images[0]!.regions![0]!.visibility = "OCCLUDED";
        v.reference_context!.images[0]!.regions![0]!.box_uv = null; }, "REFERENCE_SURFACE_NOT_VISIBLE_DETAIL"],
      [v => { v.regions[0]!.reference_surfaces = []; }, "REFERENCE_SURFACE_FACE_UNBOUND"],
      [v => { delete v.reference_context; }, "REFERENCE_SURFACE_CONTEXT_REQUIRED"],
    ];
    for (const [mutate, reason] of cases) {
      const data = fixture(); mutate(data);
      expect(planTextureTreatment(data).readiness.unresolved).toContainEqual({
        region: reason === "REFERENCE_SURFACE_CONTEXT_REQUIRED" ? "*" : "badge", reason,
      });
    }
    // One integrated selection case: art-recipe titles do not establish
    // that the current reference really shows those cluster/value/details.
    const patternCases: Array<[(v: TextureTreatmentPlanInput) => void, string]> = [
      [v => { v.regions[0]!.pattern_observation = undefined; },
        "SURFACE_PATTERN_SOURCE_OBSERVATION_REQUIRED"],
      [v => { v.regions[0]!.pattern_observation!.image_sha256 = "c".repeat(64); },
        "SURFACE_PATTERN_SOURCE_STALE"],
      [v => { v.regions[0]!.pattern_observation!.part_id = "other_part"; },
        "SURFACE_PATTERN_SOURCE_REGION_UNVERIFIED"],
      [v => { v.regions[0]!.reference_surfaces = []; },
        "SURFACE_PATTERN_SOURCE_FACE_UNBOUND"],
      [v => { v.regions[0]!.surface_pattern = "wood_grain"; },
        "SURFACE_PATTERN_SOURCE_DIRECTION_REQUIRED"],
      [v => { v.regions[0]!.evidence = "inferred"; },
        "SURFACE_PATTERN_SOURCE_NOT_OBSERVED"],
    ];
    for (const [mutate, reason] of patternCases) {
      const data = fixture(); mutate(data);
      expect(planTextureTreatment(data).readiness.unresolved).toContainEqual({
        region: "badge", reason,
      });
    }
    const explicitDirection = fixture();
    explicitDirection.regions[0]!.surface_pattern = "wood_grain";
    explicitDirection.regions[0]!.pattern_observation!.source_direction =
      "Visible elongated clusters follow the panel's horizontal long edge";
    const directionPlan = planTextureTreatment(explicitDirection);
    expect(directionPlan.readiness.state).toBe("ready");
    expect(directionPlan.reference_surface_evidence.visual_verdict).toBe("not_evaluated");

    const vagueObservation = fixture();
    vagueObservation.regions[0]!.pattern_observation!.cluster_shapes = "metal";
    expect(() => planTextureTreatment(vagueObservation))
      .toThrow("TEXTURE_PATTERN_OBSERVATION_INVALID");

    const stale = planTextureTreatment(fixture());
    stale.regions[0]!.reference_surfaces![0]!.image_sha256 = "c".repeat(64);
    expect(() => requireTextureTreatmentSeamPlanReady(stale))
      .toThrow("post-planning source or continuity intent became unresolved");
    const mutatedObservation = planTextureTreatment(fixture());
    mutatedObservation.regions[0].pattern_observation!.image_sha256 = "c".repeat(64);
    expect(() => requireTextureTreatmentSeamPlanReady(mutatedObservation))
      .toThrow("post-planning source or continuity intent became unresolved");
    const duplicate = fixture();
    duplicate.regions[0]!.reference_surfaces = [
      ...duplicate.regions[0]!.reference_surfaces!,
      { ...duplicate.regions[0]!.reference_surfaces![0]! },
    ];
    expect(() => planTextureTreatment(duplicate)).toThrow("TEXTURE_REFERENCE_CLAIM_DUPLICATE");
    const foreign = fixture();
    foreign.regions[0]!.reference_surfaces![0]!.face = { cube_uuid: "foreign", face: "north" };
    expect(() => planTextureTreatment(foreign)).toThrow("TEXTURE_REFERENCE_CLAIM_OUT_OF_SCOPE");
    const legacy = fixture();
    delete legacy.reference_context; delete legacy.regions[0]!.reference_surfaces;
    legacy.regions[0]!.pattern_observation = undefined;
    expect(planTextureTreatment(legacy).readiness.state).toBe("ready");
    expect(planTextureTreatment(legacy).reference_surface_evidence.state).toBe("not_requested");
  });


  test("pattern face pixel capacity measures exact UV pixels, rotation and signed flips", () => {
    const base = {
      pattern: "wood_grain" as const,
      face: "north" as const,
      cube_size: [4, 2, 2],
      uv: [0, 0, 8, 4],
      rotation: 0,
      texture_metrics: {
        width: 16, displayHeight: 16,
        uvWidth: 16, uvHeight: 16,
      },
      detail_intent: {
        minimum_pixels_per_model_unit: 2,
        orientation: {
          atlas: { axis: "u" as const, sign: 1 as const },
          expected_face: { axis: "u" as const, sign: 1 as const },
        },
      },
    };
    const matched = reviewTexturePatternPhysicalFit(base);
    expect(matched.state).toBe("metrics_consistent");
    expect(matched.face_local_physical_pixels).toEqual([8, 4]);
    expect(matched.pixels_per_model_unit).toEqual([2, 2]);
    expect(matched.orientation).toMatchObject({
      state: "consistent_with_declared_mapping",
      actual_face: { axis: "u", sign: 1 },
      uv_flip_u: false,
      uv_flip_v: false,
    });
    expect(matched.source_pattern_axis_attested).toBe(false);
    expect(matched.painting_authorized).toBe(false);
    expect(matched.visual_verdict).toBe("not_evaluated");

    const thin = reviewTexturePatternPhysicalFit({
      ...base,
      uv: [0, 0, 4, 4],
    });
    expect(thin.pixels_per_model_unit).toEqual([1, 2]);
    expect(thin.reasons).toContain("TEXTURE_PATTERN_TEXEL_DENSITY_INSUFFICIENT");
    expect(thin.state).toBe("review_required");

    const flipped = reviewTexturePatternPhysicalFit({
      ...base,
      uv: [8, 0, 0, 4],
    });
    expect(flipped.orientation?.actual_face).toEqual({ axis: "u", sign: -1 });
    expect(flipped.reasons).toContain("TEXTURE_PATTERN_DIRECTION_MISMATCH");

    const quarter = reviewTexturePatternPhysicalFit({
      ...base,
      rotation: 90,
      detail_intent: {
        ...base.detail_intent,
        orientation: {
          atlas: { axis: "u", sign: 1 },
          expected_face: { axis: "v", sign: 1 },
        },
      },
    });
    expect(quarter.orientation?.actual_face).toEqual({ axis: "v", sign: 1 });
    expect(quarter.face_local_physical_pixels).toEqual([4, 8]);
    // Rotation changes the physical texel axes: [4,8] pixels across a
    // [4,2]-unit face yields [1,4] px/unit, below the requested [2,2].
    // Matching motif direction must NOT hide insufficient detail density.
    expect(quarter.pixels_per_model_unit).toEqual([1, 4]);
    expect(quarter.state).toBe("review_required");
    expect(quarter.reasons).toContain("TEXTURE_PATTERN_TEXEL_DENSITY_INSUFFICIENT");
    const quarterLowerTarget = reviewTexturePatternPhysicalFit({
      ...base,
      rotation: 90,
      detail_intent: {
        minimum_pixels_per_model_unit: 1,
        orientation: {
          atlas: { axis: "u", sign: 1 },
          expected_face: { axis: "v", sign: 1 },
        },
      },
    });
    expect(quarterLowerTarget.state).toBe("metrics_consistent");
    expect(quarterLowerTarget.orientation?.actual_face)
      .toEqual({ axis: "v", sign: 1 });
  });

  test("pattern direction and detail thresholds are explicit, with no material guessing", () => {
    const args = {
      pattern: "fur_cluster" as const,
      face: "north" as const,
      cube_size: [2, 2, 2],
      uv: [0, 0, 2, 2],
      rotation: 0,
      texture_metrics: {
        width: 16, displayHeight: 16,
        uvWidth: 16, uvHeight: 16,
      },
      detail_intent: { minimum_pixels_per_model_unit: 1 },
    };
    expect(reviewTexturePatternPhysicalFit(args).reasons)
      .toContain("TEXTURE_PATTERN_DIRECTION_INTENT_REQUIRED");
    const unavailable = reviewTexturePatternPhysicalFit({
      ...args, uv: [0.5, 0, 2, 2],
    });
    expect(unavailable.reasons)
      .toContain("TEXTURE_PATTERN_FACE_PIXEL_GRID_UNVERIFIED");
    const quiet = reviewTexturePatternPhysicalFit({
      ...args, pattern: "concrete_speckle",
    });
    expect(quiet.state).toBe("metrics_consistent");
    expect(quiet.orientation).toBeNull();
    expect(quiet.pattern_directionality).toBe("none");
    expect(quiet.reference_face_correspondence_attested).toBe(false);
    expect(() => reviewTexturePatternPhysicalFit({
      ...args, detail_intent: { minimum_pixels_per_model_unit: 0 },
    })).toThrow("TEXTURE_PATTERN_DENSITY_TARGET_INVALID");

    const onePixel = reviewTexturePatternPhysicalFit({
      ...args,
      uv: [0, 0, 1, 2],
      detail_intent: {
        minimum_pixels_per_model_unit: 0.5,
        orientation: {
          atlas: { axis: "u", sign: 1 },
          expected_face: { axis: "u", sign: 1 },
        },
      },
    });
    expect(onePixel.reasons)
      .toContain("TEXTURE_PATTERN_DIRECTION_TEXELS_INSUFFICIENT");
  });

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
    expect(planTextureTreatment({
      required_faces: [{ cube_uuid: "boot", face: "down" }],
      regions: [{
        ...base, face_targets: [
          { cube_uuid: "boot", face: "down", treatment: "SHARED" },
        ],
      }],
    }).readiness.unresolved).toContainEqual({
      region: "cloth", reason: "SHARED_UV_SOURCE_REQUIRED",
    });
    expect(planTextureTreatment({
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


function explicitSeamTreatment(): TextureTreatmentPlanInput {
  const left = { cube_uuid: "panel-left", face: "north" as const };
  const right = { cube_uuid: "panel-right", face: "north" as const };
  const underside = { cube_uuid: "panel-left", face: "down" as const };
  return {
    required_faces: [left, right, underside],
    regions: [{
      region: "continuous-front",
      evidence: "observed",
      surface_pattern: "painted_metal",
      render_profile: "opaque",
      face_targets: [
        { ...left, treatment: "PAINT" },
        { ...right, treatment: "PAINT" },
        { ...underside, treatment: "INTENTIONAL_FLAT" },
      ],
    }],
    seam_pairs: [{
      left: { ...left, edge: "right" },
      right: { ...right, edge: "left" },
      continuity_intent: "REQUIRED",
      surface_id: "panel-front",
      material_id: "surface-metal",
      reference_observation: {
        reference_id: "ref:front-panel",
        reference_revision: "source-v1",
        observation_id: "observation:front-joint",
        observed_edges: [
          { ...left, edge: "right" },
          { ...right, edge: "left" },
        ],
      },
    }],
  };
}
function nativeSeamFaceBindings(): TextureTreatmentNativeFaceBinding[] {
  return [
    { cube_uuid: "panel-left", face: "north", texture_uuid: "base-left", native_material_name: "" },
    { cube_uuid: "panel-right", face: "north", texture_uuid: "base-right", native_material_name: "" },
    { cube_uuid: "panel-left", face: "down", texture_uuid: "base-left", native_material_name: "" },
  ];
}

describe("texture treatment-owned cross-Cube seam handoff", () => {
  test("only explicit observed per-face pair becomes bounded review-only native declarations", () => {
    const input = explicitSeamTreatment();
    const plan = planTextureTreatment(input);
    expect(plan.readiness.state).toBe("ready");
    const handoff = buildTextureTreatmentCrossCubeSeamHandoff(
      plan, nativeSeamFaceBindings()
    );
    expect(handoff.state).toBe("review_required");
    expect(handoff.source).toBe("texture_treatment_plan");
    expect(handoff.scope).toBe("explicit_face_inventory");
    expect(handoff.declared_pair_count).toBe(1);
    expect(handoff.declarations).toEqual([
      {
        cube_uuid: "panel-left", face: "north", edge: "right",
        continuity_intent: "REQUIRED",
        surface_id: "panel-front", material_id: "surface-metal",
        expected_texture_uuid: "base-left",
        expected_native_material_name: "",
      },
      {
        cube_uuid: "panel-right", face: "north", edge: "left",
        continuity_intent: "REQUIRED",
        surface_id: "panel-front", material_id: "surface-metal",
        expected_texture_uuid: "base-right",
        expected_native_material_name: "",
      },
    ]);
    expect(handoff.reference_observations).toEqual([{
      reference_id: "ref:front-panel",
      reference_revision: "source-v1",
      observation_id: "observation:front-joint",
      observed_edges: [
        { cube_uuid: "panel-left", face: "north", edge: "right" },
        { cube_uuid: "panel-right", face: "north", edge: "left" },
      ],
      assertion_provenance: "CALLER_DECLARATION_UNVERIFIED",
    }]);
    expect(handoff.native_binding_attested).toBe(false);
    expect(handoff.texture_revision_attested).toBe(false);
    expect(handoff.material_approval_attested).toBe(false);
    expect(handoff.scene_coverage_attested).toBe(false);
    expect(handoff.visual_verdict).toBe("not_evaluated");
  });

  test("treatment owner never guesses seams from complete face inventory alone", () => {
    const input = explicitSeamTreatment();
    delete input.seam_pairs;
    const plan = planTextureTreatment(input);
    expect(plan.readiness.state).toBe("ready");
    const result = buildTextureTreatmentCrossCubeSeamHandoff(
      plan, nativeSeamFaceBindings()
    );
    expect(result.state).toBe("not_evaluated");
    expect(result.declarations).toEqual([]);
    expect(result.declared_pair_count).toBe(0);
  });

  test("unobserved surfaces and missing semantic identifiers cannot become continuous seams", () => {
    const inferred = explicitSeamTreatment();
    inferred.regions[0].evidence = "inferred";
    const inferredPlan = planTextureTreatment(inferred);
    expect(inferredPlan.readiness.state).toBe("review_required");
    expect(inferredPlan.readiness.unresolved).toContainEqual({
      region: "*", reason: "SEAM_OBSERVED_REFERENCE_REQUIRED",
    });
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      inferredPlan, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const unnamed = explicitSeamTreatment();
    unnamed.seam_pairs![0].material_id = null;
    const planned = planTextureTreatment(unnamed);
    expect(planned.readiness.unresolved).toContainEqual({
      region: "*", reason: "SEAM_SURFACE_AND_MATERIAL_REQUIRED",
    });
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      planned, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
  });

  test("cross-region render/PBR disagreements block inferred shared material ownership", () => {
    const input = explicitSeamTreatment();
    input.regions = [
      {
        ...input.regions[0],
        face_targets: input.regions[0].face_targets!.filter(
          face => face.cube_uuid === "panel-left"
        ),
      },
      {
        region: "other", evidence: "observed",
        surface_pattern: "painted_metal", render_profile: "translucent",
        pbr_intent: "none",
        face_targets: [
          { cube_uuid: "panel-right", face: "north", treatment: "PAINT" },
        ],
      },
    ];
    const plan = planTextureTreatment(input);
    expect(plan.readiness.unresolved).toContainEqual({
      region: "*", reason: "SEAM_RENDER_OR_PBR_COHORT_MISMATCH",
    });
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
  });

  test("duplicate, same-Cube and out-of-scope seam edges fail before a native handoff", () => {
    const repeated = explicitSeamTreatment();
    repeated.seam_pairs = [repeated.seam_pairs![0], repeated.seam_pairs![0]];
    expect(() => planTextureTreatment(repeated)).toThrow(
      "TEXTURE_SEAM_PAIR_DUPLICATE"
    );
    const oneCube = explicitSeamTreatment();
    oneCube.seam_pairs = [{
      ...oneCube.seam_pairs![0],
      right: { cube_uuid: "panel-left", face: "down", edge: "left" },
    }];
    expect(() => planTextureTreatment(oneCube)).toThrow(
      "TEXTURE_SEAM_PAIR_DUPLICATE"
    );
    const incomplete = explicitSeamTreatment();
    incomplete.required_faces = undefined;
    const planned = planTextureTreatment(incomplete);
    expect(planned.readiness.state).toBe("review_required");
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      planned, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
  });

  test("the complete native face inventory and consistent material-name mapping are required", () => {
    const plan = planTextureTreatment(explicitSeamTreatment());
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, nativeSeamFaceBindings().slice(0, 2)
    )).toThrow("TEXTURE_SEAM_HANDOFF_SCOPE_INVALID");
    const foreign = nativeSeamFaceBindings();
    foreign[2] = { ...foreign[2], cube_uuid: "not-in-plan" };
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, foreign
    )).toThrow("TEXTURE_SEAM_HANDOFF_SCOPE_INVALID");
    const untextured = nativeSeamFaceBindings();
    untextured[1].texture_uuid = null;
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, untextured
    )).toThrow("TEXTURE_SEAM_HANDOFF_BINDING_UNAVAILABLE");
    const mismatchedMaterial = nativeSeamFaceBindings();
    mismatchedMaterial[1].native_material_name = "entity_emissive";
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, mismatchedMaterial
    )).toThrow("TEXTURE_SEAM_HANDOFF_NATIVE_MATERIAL_MISMATCH");
  });

  test("REQUIRED seams must carry exact edge-scoped reference observations, not only observed=true", () => {
    const missing = explicitSeamTreatment();
    delete missing.seam_pairs![0].reference_observation;
    const plan = planTextureTreatment(missing);
    expect(plan.readiness.state).toBe("review_required");
    expect(plan.readiness.unresolved).toContainEqual({
      region: "*", reason: "SEAM_REFERENCE_OBSERVATION_REQUIRED",
    });
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      plan, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const wrong = explicitSeamTreatment();
    wrong.seam_pairs![0].reference_observation!.observed_edges[0].edge = "top";
    expect(() => planTextureTreatment(wrong))
      .toThrow("TEXTURE_SEAM_REFERENCE_SCOPE_MISMATCH");
  });

  test("malformed source provenance and observation reuse cannot justify different edges", () => {
    const bad = explicitSeamTreatment();
    bad.seam_pairs![0].reference_observation!.observation_id = " ";
    expect(() => planTextureTreatment(bad))
      .toThrow("TEXTURE_SEAM_REFERENCE_INVALID");
    const tooLong = explicitSeamTreatment();
    tooLong.seam_pairs![0].reference_observation!.reference_id = "x".repeat(257);
    expect(() => planTextureTreatment(tooLong))
      .toThrow("TEXTURE_SEAM_REFERENCE_INVALID");
  });

  test("one observation cannot silently authorize two unrelated edge pairs", () => {
    const input = explicitSeamTreatment();
    const original = input.seam_pairs![0];
    input.seam_pairs = [original, {
      ...original,
      left: { ...original.left, edge: "top" },
      right: { ...original.right, edge: "bottom" },
      reference_observation: {
        ...original.reference_observation!,
        observed_edges: [
          { ...original.left, edge: "top" },
          { ...original.right, edge: "bottom" },
        ],
      },
    }];
    expect(() => planTextureTreatment(input))
      .toThrow("TEXTURE_SEAM_REFERENCE_REUSED");
  });

  test("post-plan changes to material and observed reference cannot inherit stale ready verdict", () => {
    const changedMaterial = planTextureTreatment(explicitSeamTreatment());
    changedMaterial.seam_pairs[0].material_id = null;
    expect(() => requireTextureTreatmentSeamPlanReady(changedMaterial))
      .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");
    expect(() => buildTextureTreatmentCrossCubeSeamHandoff(
      changedMaterial, nativeSeamFaceBindings()
    )).toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const changedEvidence = planTextureTreatment(explicitSeamTreatment());
    changedEvidence.regions[0].evidence = "inferred";
    expect(() => requireTextureTreatmentSeamPlanReady(changedEvidence))
      .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const removedReference = planTextureTreatment(explicitSeamTreatment());
    delete removedReference.seam_pairs[0].reference_observation;
    expect(() => requireTextureTreatmentSeamPlanReady(removedReference))
      .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const removedFace = planTextureTreatment(explicitSeamTreatment());
    removedFace.regions[0].face_targets.pop();
    expect(() => requireTextureTreatmentSeamPlanReady(removedFace))
      .toThrow("TEXTURE_SEAM_HANDOFF_PLAN_NOT_READY");

    const duplicateEdge = planTextureTreatment(explicitSeamTreatment());
    duplicateEdge.seam_pairs.push({ ...duplicateEdge.seam_pairs[0] });
    expect(() => requireTextureTreatmentSeamPlanReady(duplicateEdge))
      .toThrow("TEXTURE_SEAM_PAIR_DUPLICATE");
  });

  test("the source observation is deep-copied and remains unverified even when the plan is ready", () => {
    const input = explicitSeamTreatment();
    const plan = planTextureTreatment(input);
    expect(plan.seam_reference_evidence_state).toBe("caller_observation_unverified");
    input.seam_pairs![0].reference_observation!.observed_edges[0].edge = "top";
    input.seam_pairs![0].reference_observation!.reference_revision = "source-v2";
    expect(plan.seam_pairs[0].reference_observation!.observed_edges[0].edge)
      .toBe("right");
    expect(plan.seam_pairs[0].reference_observation!.reference_revision)
      .toBe("source-v1");
    const handoff = buildTextureTreatmentCrossCubeSeamHandoff(plan, nativeSeamFaceBindings());
    handoff.reference_observations[0].observed_edges[0].edge = "bottom";
    expect(plan.seam_pairs[0].reference_observation!.observed_edges[0].edge)
      .toBe("right");
    expect(handoff.material_approval_attested).toBe(false);
  });

  test("planning retains independent copies of authored seam pair endpoints", () => {
    const input = explicitSeamTreatment();
    const plan = planTextureTreatment(input);
    input.seam_pairs![0].left.edge = "top";
    expect(plan.seam_pairs[0].left.edge).toBe("right");
  });
});
