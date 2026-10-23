import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/planning";
import { expandRecipePattern } from "@/lib/authoringRecipe/patterns";
import { runParametricEfficiencyBenchmark } from "@/scripts/benchmark/benchmark-parametric-authoring";

describe("Parametric Authoring Engine G0-G2", () => {
  test("linear/grid/radial patterns expand deterministically", () => {
    expect(expandRecipePattern({ kind: "LINEAR", id: "line", prototype_id: "cube", count: 3, axis: "X", spacing: 2 }).map((instance) => instance.translation)).toEqual([[0,0,0],[2,0,0],[4,0,0]]);
    expect(expandRecipePattern({ kind: "GRID", id: "grid", prototype_id: "cube", counts: [2,2], axes: ["X","Y"], spacing: [3,5] }).map((instance) => instance.translation)).toEqual([[0,0,0],[0,5,0],[3,0,0],[3,5,0]]);
    const radial = expandRecipePattern({ kind: "RADIAL", id: "radial", prototype_id: "cube", count: 4, axis: "Z", radius: 2, rotate_with_pattern: true });
    expect(radial).toHaveLength(4);
    expect(radial[0].translation).toEqual([2,0,0]);
    expect(radial[1].rotation).toEqual([0,0,90]);
  });

  test("compiler realizes repeated recipe into exact bounded cube placements", () => {
    const recipe: AuthoringRecipe = { schema: 1, compiler_version: 1, id: "fixture", name: "fixture", prototypes: [{ id: "board", name: "board", size: [8,1,4] }], patterns: [{ kind: "LINEAR", id: "shelves", prototype_id: "board", count: 3, axis: "Y", spacing: 4 }] };
    const compiled = compileAuthoringRecipe(recipe);
    expect(compiled.placements).toHaveLength(3);
    expect(compiled.placements[2]).toMatchObject({ from: [0,8,0], to: [8,9,4], source_pattern_id: "shelves" });
    expect(compiled.metrics).toMatchObject({ prototype_count: 1, pattern_count: 1, instance_count: 3, unique_geometry_count: 1, repeated_instance_count: 2 });
  });

  test("semantic feature evidence routes stitched details to Texture but keeps horns and joints as Geometry", () => {
    const plan = planRecipeFeatureRepresentations([
      { id: "horn", label: "horn silhouette", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["SILHOUETTE"] },
      { id: "seam", label: "painted cloth seam", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
      { id: "joint", label: "articulated wrist", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["MOTION", "TRANSFORM"] },
      { id: "noise", label: "unreferenced filler", visual_role: "UNNECESSARY",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
    ]);
    expect(plan.state).toBe("ready");
    expect(plan.decisions.map((entry) => [entry.id, entry.route])).toEqual([
      ["horn", "GEOMETRY"], ["joint", "GEOMETRY"],
      ["noise", "OMIT"], ["seam", "TEXTURE"],
    ]);
    expect(plan.summary.texture_handoff.examples[0]).toMatchObject({
      id: "seam", reason: "NO_REQUIRED_3D_CONTRIBUTION",
    });
    expect(plan.summary.geometry.count).toBe(2);
    expect(plan.summary.omitted.count).toBe(1);
    expect(plan.summary.visual_verdict).toBe("not_evaluated");
  });

  test("recipe compiler cannot turn surface-only features into Cube patterns", () => {
    const base: AuthoringRecipe = {
      schema: 1, compiler_version: 1, id: "character", name: "Character",
      prototypes: [
        { id: "horn_cube", name: "horn", size: [2, 5, 2] },
        { id: "wrist_cube", name: "wrist", size: [2, 3, 2] },
        { id: "stitch_cube", name: "stitch", size: [0.25, 0.25, 1] },
      ],
      feature_intents: [
        { id: "horn", label: "horn", visual_role: "THREE_DIMENSIONAL",
          evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["SILHOUETTE"] },
        { id: "wrist", label: "wrist joint", visual_role: "THREE_DIMENSIONAL",
          evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["MOTION"] },
        { id: "stitches", label: "stitched cloth", visual_role: "SURFACE_DETAIL",
          evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
      ],
      patterns: [
        { kind: "LINEAR", id: "horn", prototype_id: "horn_cube", count: 1,
          axis: "X", spacing: 0, feature_id: "horn" },
        { kind: "LINEAR", id: "wrist", prototype_id: "wrist_cube", count: 1,
          axis: "X", spacing: 0, feature_id: "wrist" },
      ],
    };
    const compiled = compileAuthoringRecipe(base);
    expect(compiled.placements.map((entry) => entry.prototype_id).sort())
      .toEqual(["horn_cube", "wrist_cube"]);
    expect(compiled.feature_plan?.texture_handoff).toMatchObject({ count: 1 });
    expect(compiled.feature_plan?.visual_verdict).toBe("not_evaluated");
    expect(() => compileAuthoringRecipe({
      ...base,
      patterns: [...base.patterns, { kind: "LINEAR", id: "stitch",
        prototype_id: "stitch_cube", count: 12, axis: "X",
        spacing: 0.2, feature_id: "stitches" }],
    })).toThrow("FEATURE_REPRESENTATION_MISMATCH");
    expect(() => compileAuthoringRecipe({
      ...base, patterns: base.patterns.map(({ feature_id: _id, ...pattern }) => pattern),
    })).toThrow("FEATURE_PATTERN_OWNER_REQUIRED");
    expect(() => compileAuthoringRecipe({
      ...base, patterns: [base.patterns[0]],
    })).toThrow("FEATURE_GEOMETRY_UNREALIZED");
    expect(() => compileAuthoringRecipe({
      ...base, patterns: [{ ...base.patterns[0], feature_id: "missing_feature" }],
    })).toThrow("FEATURE_PATTERN_OWNER_UNKNOWN");
    expect(() => compileAuthoringRecipe({
      ...base, feature_intents: base.feature_intents?.map((entry) =>
        entry.id === "horn" ? { ...entry, evidence: "PROVISIONAL" as const } : entry
      ),
    })).toThrow("FEATURE_DECISION_REVIEW_REQUIRED");
  });

  test("conflicting or unsupported visual evidence cannot authorize arbitrary 3D features", () => {
    const plan = planRecipeFeatureRepresentations([
      { id: "graphic", label: "graphic", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"], geometry_reasons: ["SILHOUETTE"] },
      { id: "guessed", label: "unverified panel", visual_role: "THREE_DIMENSIONAL",
        evidence: "UNAVAILABLE", geometry_reasons: ["VOLUME"] },
      { id: "ornament", label: "unjustified Cube", visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
    ]);
    expect(plan.state).toBe("review_required");
    expect(plan.summary.unresolved.count).toBe(3);
    const missingReference = planRecipeFeatureRepresentations([
      { id: "unsupported_mark", label: "painted mark", visual_role: "SURFACE_DETAIL",
        evidence: "SUPPORTED" },
    ]);
    expect(missingReference.decisions[0]).toMatchObject({
      route: "REVIEW_REQUIRED", reason: "SUPPORTED_EVIDENCE_REFERENCE_MISSING",
    });
    expect(() => planRecipeFeatureRepresentations([
      { id: "dup", label: "a", visual_role: "SURFACE_DETAIL", evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
      { id: "dup", label: "b", visual_role: "SURFACE_DETAIL", evidence: "SUPPORTED", evidence_refs: ["fixture:approved_reference_view"] },
    ])).toThrow("FEATURE_IDENTITY_DUPLICATED");
    const legacy: AuthoringRecipe = {
      schema: 1, compiler_version: 1, id: "legacy", name: "Legacy",
      prototypes: [{ id: "cube", name: "cube", size: [1, 1, 1] }],
      patterns: [{ kind: "LINEAR", id: "line", prototype_id: "cube",
        count: 2, axis: "X", spacing: 2 }],
    };
    expect(compileAuthoringRecipe(legacy).placements).toHaveLength(2);
    expect(compileAuthoringRecipe(legacy)).not.toHaveProperty("feature_plan");
  });

  test("invalid recipe structure fails closed before native mutation", () => {
    expect(() => compileAuthoringRecipe({ schema: 1, compiler_version: 1, id: "bad", name: "bad", prototypes: [{ id: "cube", name: "cube", size: [0,1,1] }], patterns: [] })).toThrow(/size must be positive/);
    expect(() => expandRecipePattern({ kind: "GRID", id: "bad-grid", prototype_id: "cube", counts: [2,2], axes: ["X","X"], spacing: [1,1] })).toThrow(/axes must be distinct/);
  });

  test("repeated-structure benchmark proves static savings without wall-clock claims", () => {
    const results = runParametricEfficiencyBenchmark();
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.wall_clock_claim).toBe("not_measured");
      expect(result.quality_contract.deterministic).toBe(true);
      expect(result.quality_contract.finite_geometry).toBe(true);
      expect(result.quality_contract.compiled_cube_count).toBe(result.quality_contract.expected_cube_count);
      expect(result.savings.payload_bytes).toBeGreaterThan(0);
      expect(result.savings.payload_ratio).toBeGreaterThan(0.25);
    }
    const large = results.filter((result) => result.quality_contract.compiled_cube_count > 32);
    expect(large.length).toBeGreaterThan(0);
    expect(large.every((result) => result.savings.manage_cubes_calls > 0)).toBe(true);
  });
});
