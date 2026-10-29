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
