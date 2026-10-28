import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { assessRecipeFeatureOptimization } from "@/lib/authoringRecipe/planning";
import { rewriteAuthoringRecipeForSemanticEdit } from "@/lib/authoringRecipe/semanticRewrite";
import {
  compileSemanticGeometryEdit,
  type SemanticGeometryEditIntent,
} from "@/lib/authoringRecipe/semanticEdit";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  deriveReferenceCorrectionVectors,
  compileReferenceCorrectionsToGeometryIntents,
} from "@/lib/reference/correction";

function chairRecipe(): AuthoringRecipe {
  return {
    schema: 1,
    compiler_version: 1,
    id: "chair",
    name: "chair",
    prototypes: [
      {
        id: "seat_proto",
        name: "seat",
        size: [8, 2, 8],
        semantic_group: "seat",
      },
      {
        id: "leg_proto",
        name: "leg",
        size: [2, 6, 2],
        semantic_group: "leg",
      },
    ],
    patterns: [
      {
        kind: "LINEAR",
        id: "seat",
        prototype_id: "seat_proto",
        count: 1,
        axis: "X",
        spacing: 0,
        start: [0, 6, 0],
        semantic_group: "seat",
      },
      {
        kind: "LINEAR",
        id: "leg",
        prototype_id: "leg_proto",
        count: 1,
        axis: "X",
        spacing: 0,
        start: [0, 0, 0],
        semantic_group: "leg",
      },
    ],
    constraints: [
      {
        kind: "ANCHOR",
        id: "leg_follows_seat_right_edge",
        source_instance_id: "leg:0",
        target_instance_id: "seat:0",
        axes: ["X"],
        source_anchor: ["MIN", "MIN", "MIN"],
        target_anchor: ["MAX", "MIN", "MIN"],
        offset: [-2, 0, 0],
      },
    ],
  };
}

describe("lightweight parametric authoring relationships", () => {
  test("anchor constraint follows a resized primary mass without reauthoring the dependent pattern", () => {
    const beforeRecipe = chairRecipe();
    const before = compileAuthoringRecipe(beforeRecipe);
    const beforeLeg = before.placements.find((entry) => entry.id === "leg:0")!;
    expect(beforeLeg.from[0]).toBe(6);

    const nextRecipe = rewriteAuthoringRecipeForSemanticEdit(beforeRecipe, {
      target: { semantic_group: "seat" },
      operation: {
        kind: "RESIZE_AXIS",
        axis: "X",
        mode: "SET",
        value: 12,
        anchor: "MIN",
      },
    });
    const after = compileAuthoringRecipe(nextRecipe);
    const afterSeat = after.placements.find((entry) => entry.id === "seat:0")!;
    const afterLeg = after.placements.find((entry) => entry.id === "leg:0")!;

    expect(afterSeat.to[0]).toBe(12);
    expect(afterLeg.from[0]).toBe(10);
    expect(afterLeg.to[0]).toBe(12);
  });

  test("reference BOUNDS correction preserves center and pivot while propagating dependent Geometry", () => {
    const before = compileAuthoringRecipe(chairRecipe());
    const intents = compileReferenceCorrectionsToGeometryIntents(
      deriveReferenceCorrectionVectors([{
        kind: "BOUNDS", instance_id: "seat:0", axis: "X",
        expected: 12, actual: 8,
      }])
    );
    expect(intents).toEqual([{
      target: { instance_ids: ["seat:0"] },
      operation: { kind: "RESIZE_AXIS", axis: "X", mode: "ADD", value: 4, anchor: "CENTER" },
    }]);
    const after = compileAuthoringRecipe(rewriteAuthoringRecipeForSemanticEdit(
      chairRecipe(), intents[0]!
    ));
    const beforeSeat = before.placements.find((p) => p.id === "seat:0")!;
    const afterSeat = after.placements.find((p) => p.id === "seat:0")!;
    const afterLeg = after.placements.find((p) => p.id === "leg:0")!;
    expect(afterSeat.from).toEqual([-2, 6, 0]);
    expect(afterSeat.to).toEqual([10, 8, 8]);
    expect(afterSeat.origin).toEqual(beforeSeat.origin);
    expect(afterLeg.from[0]).toBe(8);
  });

  test("MIN/CENTER/MAX recipe resizes preserve the actual pivot of an independent part", () => {
    const base = chairRecipe();
    base.constraints = [];
    base.prototypes[0]!.origin = [3, 1, 4];
    const before = compileAuthoringRecipe(base);
    for (const anchor of ["MIN", "CENTER", "MAX"] as const) {
      const intent = {
        target: { instance_ids: ["seat:0"] },
        operation: { kind: "RESIZE_AXIS" as const, axis: "X" as const,
          mode: "ADD" as const, value: 4, anchor },
      };
      const expected = compileSemanticGeometryEdit(before, intent).upserts[0]!;
      const realized = compileAuthoringRecipe(rewriteAuthoringRecipeForSemanticEdit(base, intent));
      const actual = realized.placements.find((p) => p.id === "seat:0")!;
      expect(actual.from).toEqual(expected.from);
      expect(actual.to).toEqual(expected.to);
      expect(actual.origin).toEqual(expected.origin);
      expect(actual.rotation).toEqual(expected.rotation);
    }
    expect(base.prototypes[0]!.size).toEqual([8, 2, 8]);
    expect(base.patterns[0]!.kind).toBe("LINEAR");
  });

  test("resize cannot silently violate the anchor of a constrained child", () => {
    expect(() => rewriteAuthoringRecipeForSemanticEdit(chairRecipe(), {
      target: { instance_ids: ["leg:0"] },
      operation: { kind: "RESIZE_AXIS", axis: "X", mode: "ADD", value: 2, anchor: "CENTER" },
    })).toThrow("SEMANTIC_REWRITE_RESULT_MISMATCH");
  });

  test("constrained source translation cannot report an edit that the anchor solver overwrites", () => {
    const recipe = chairRecipe();
    const original = compileAuthoringRecipe(recipe);
    const intent: SemanticGeometryEditIntent = {
      target: { instance_ids: ["leg:0"] },
      operation: { kind: "TRANSLATE", delta: [2, 0, 0] },
    };
    const predicted = compileSemanticGeometryEdit(original, intent);
    expect(predicted.upserts[0]!.from[0]).toBe(8);
    // The leg's X translation is owned by the seat-edge constraint. Changing
    // its underlying pattern start alone would be silently overwritten.
    expect(() => rewriteAuthoringRecipeForSemanticEdit(recipe, intent))
      .toThrow("SEMANTIC_REWRITE_RESULT_MISMATCH");
    expect(compileAuthoringRecipe(recipe)).toEqual(original);
  });

  test("translation stays valid along unconstrained axes and propagates from the owner", () => {
    const base = chairRecipe();
    const moveLegY = rewriteAuthoringRecipeForSemanticEdit(base, {
      target: { instance_ids: ["leg:0"] },
      operation: { kind: "TRANSLATE", delta: [0, 2, 0] },
    });
    const movedLeg = compileAuthoringRecipe(moveLegY).placements
      .find((placement) => placement.id === "leg:0")!;
    expect(movedLeg.from).toEqual([6, 2, 0]);
    expect(movedLeg.origin).toEqual([7, 5, 1]);

    const moveSeatX = rewriteAuthoringRecipeForSemanticEdit(base, {
      target: { instance_ids: ["seat:0"] },
      operation: { kind: "TRANSLATE", delta: [2, 0, 0] },
    });
    const after = compileAuthoringRecipe(moveSeatX);
    expect(after.placements.find((placement) => placement.id === "seat:0")!.from[0])
      .toBe(2);
    expect(after.placements.find((placement) => placement.id === "leg:0")!.from[0])
      .toBe(8);
  });

  test("semantic correction proposals refuse finite-but-collapsed and invalid Geometry", () => {
    const compiled = compileAuthoringRecipe(chairRecipe());
    expect(() => compileSemanticGeometryEdit(compiled, {
      target: { semantic_group: "seat" },
      operation: { kind: "TRANSLATE", delta: [1e308, 0, 0] },
    })).toThrow("SEMANTIC_CORRECTION_SPAN_COLLAPSED");

    const imperfect = chairRecipe();
    imperfect.prototypes[0]!.size = [3, 2, 8];
    expect(() => compileSemanticGeometryEdit(compileAuthoringRecipe(imperfect), {
      target: { semantic_group: "seat" },
      operation: { kind: "TRANSLATE", delta: [1e16, 0, 0] },
    })).toThrow("SEMANTIC_CORRECTION_RIGID_DISTORTION");

    const rotated = chairRecipe();
    rotated.prototypes[0]!.rotation = [1e308, 0, 0];
    expect(() => compileSemanticGeometryEdit(compileAuthoringRecipe(rotated), {
      target: { semantic_group: "seat" },
      operation: { kind: "ROTATE_AXIS", axis: "X", delta_degrees: 1e308 },
    })).toThrow("SEMANTIC_CORRECTION_NONFINITE");

    expect(() => compileSemanticGeometryEdit(compiled, {
      target: { semantic_group: "leg" },
      operation: { kind: "INFLATE", mode: "SET", value: -1 },
    })).toThrow(/collapses 2 rendered axes/);
    expect(() => compileSemanticGeometryEdit(compiled, {
      target: { semantic_group: "leg" },
      operation: { kind: "INFLATE", mode: "SET", value: -2 },
    })).toThrow(/negative rendered span/);

    // A thin 3D part remains valid when explicit Per-face UV is intended.
    const thin = compileSemanticGeometryEdit(compiled, {
      target: { semantic_group: "leg" },
      operation: { kind: "RESIZE_AXIS", axis: "X",
        mode: "SET", value: 0.25, anchor: "MIN" },
    });
    expect(thin.upserts).toHaveLength(1);
    expect(thin.upserts[0]!.to[0] - thin.upserts[0]!.from[0])
      .toBeCloseTo(0.25);
    expect(thin.application_boundary).toBe("RECIPE_REWRITE_REQUIRED");
  });

  test("recipe rewriting rejects collapsed constraint-dependent Cubes before returning", () => {
    expect(() => rewriteAuthoringRecipeForSemanticEdit(chairRecipe(), {
      target: { semantic_group: "seat" },
      operation: { kind: "RESIZE_AXIS", axis: "X",
        mode: "SET", value: 1e308, anchor: "MIN" },
    })).toThrow("RECIPE_REALIZED_SPAN_COLLAPSED");
  });

  test("incremental rebuild distinguishes dependency propagation from directly authored geometry", () => {
    const beforeRecipe = chairRecipe();
    const nextRecipe = rewriteAuthoringRecipeForSemanticEdit(beforeRecipe, {
      target: { semantic_group: "seat" },
      operation: {
        kind: "RESIZE_AXIS",
        axis: "X",
        mode: "ADD",
        value: 4,
        anchor: "MIN",
      },
    });

    const rebuild = planIncrementalRecipeRebuild(beforeRecipe, nextRecipe);

    expect(rebuild.upserts.map((entry) => entry.id)).toEqual([
      "leg:0",
      "seat:0",
    ]);
    expect(rebuild.constraint_propagated_instance_ids).toEqual(["leg:0"]);
    expect(rebuild.metrics.constraint_propagated_count).toBe(1);
    expect(rebuild.metrics.native_affected_count).toBe(2);
  });

  test("direct edits of the constrained child are not mislabeled as propagation", () => {
    const beforeRecipe = chairRecipe();
    const nextRecipe: AuthoringRecipe = structuredClone(beforeRecipe);
    const leg = nextRecipe.prototypes.find((entry) => entry.id === "leg_proto")!;
    leg.size = [3, 6, 2];

    const rebuild = planIncrementalRecipeRebuild(beforeRecipe, nextRecipe);

    expect(rebuild.upserts.map((entry) => entry.id)).toContain("leg:0");
    expect(rebuild.constraint_propagated_instance_ids).toEqual([]);
  });
});

describe("read-only feature representation impact for compiled Recipe geometry", () => {
  function featureRecipe(): AuthoringRecipe {
    return {
      schema: 1, compiler_version: 1,
      id: "crest", name: "crest",
      prototypes: [{
        id: "horn_cube", name: "horn", size: [2, 4, 2],
        semantic_group: "crest",
      }],
      patterns: [{
        kind: "LINEAR", id: "horns", feature_id: "horn",
        prototype_id: "horn_cube", count: 2, axis: "X", spacing: 5,
      }],
      feature_intents: [
        {
          id: "horn", label: "Crest horns",
          visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
          evidence_refs: ["image:front:crest"], geometry_reasons: ["SILHOUETTE"],
        },
        {
          id: "crest_mark", label: "Painted crest motif",
          visual_role: "SURFACE_DETAIL", evidence: "SUPPORTED",
          evidence_refs: ["image:front:mark"], geometry_reasons: [],
        },
      ],
      symmetry: [{
        id: "mirrored_horn", source_instance_id: "horns:0",
        target_instance_id: "mirrored-horn",
        plane: { axis: "X", position: 0 },
        uv_policy: "SHARE", texture_policy: "MIRROR", rig_policy: "MIRROR",
      }],
    };
  }

  test("a suggested 3D-to-texture change counts pattern and mirrored instances but cannot delete Cubes", () => {
    const recipe = featureRecipe();
    const unchanged = structuredClone(recipe);
    const report = assessRecipeFeatureOptimization(recipe, [
      {
        id: "horn", label: "Crest horns",
        visual_role: "SURFACE_DETAIL", evidence: "SUPPORTED",
        evidence_refs: ["image:front:crest"], geometry_reasons: [],
      },
      {
        id: "crest_mark", label: "Painted crest motif",
        visual_role: "SURFACE_DETAIL", evidence: "SUPPORTED",
        evidence_refs: ["image:front:mark"], geometry_reasons: [],
      },
    ]);
    expect(report).toMatchObject({
      state: "review_required",
      scope: "COMPILED_RECIPE_ONLY",
      visual_verdict: "NOT_EVALUATED",
      native_mutation_executed: false,
      estimated_native_cube_savings: null,
      review_required_count: 1,
      possible_native_removal_review_instance_count: 3,
    });
    expect(report.candidates).toEqual([
      {
        feature_id: "horn", current_route: "GEOMETRY", proposed_route: "TEXTURE",
        action: "NATIVE_REMOVAL_REVIEW_REQUIRED", realized_recipe_cube_count: 3,
        instance_id_examples: ["horns:0", "horns:1", "mirrored-horn"],
        examples_truncated: false, proposed_native_cube_deletion: false,
      },
      {
        feature_id: "crest_mark", current_route: "TEXTURE", proposed_route: "TEXTURE",
        action: "TEXTURE_HANDOFF_ONLY", realized_recipe_cube_count: 0,
        instance_id_examples: [], examples_truncated: false,
        proposed_native_cube_deletion: false,
      },
    ]);
    expect(recipe).toEqual(unchanged);
    expect(compileAuthoringRecipe(recipe).metrics.realized_cube_count).toBe(3);
  });

  test("unverified evidence and new 3D needs remain review-required without inventing Geometry", () => {
    const recipe = featureRecipe();
    const unverified = assessRecipeFeatureOptimization(recipe, [{
      id: "horn", label: "Crest horns", visual_role: "SURFACE_DETAIL",
      evidence: "PROVISIONAL", evidence_refs: ["image:side:provisional"],
      geometry_reasons: [],
    }]);
    expect(unverified.candidates[0]).toMatchObject({
      proposed_route: "REVIEW_REQUIRED",
      action: "REFERENCE_REVIEW_REQUIRED",
      realized_recipe_cube_count: 3,
    });

    const addGeometry = assessRecipeFeatureOptimization(recipe, [{
      id: "crest_mark", label: "Painted crest motif",
      visual_role: "THREE_DIMENSIONAL", evidence: "SUPPORTED",
      evidence_refs: ["image:front:mark"], geometry_reasons: ["SILHOUETTE"],
    }]);
    expect(addGeometry.candidates[0]).toMatchObject({
      current_route: "TEXTURE",
      proposed_route: "GEOMETRY",
      action: "GEOMETRY_CREATION_REQUIRED",
      realized_recipe_cube_count: 0,
    });
    expect(addGeometry.native_mutation_executed).toBe(false);
  });


  test("a retained dependent feature blocks Geometry-to-Texture handoff before native removal", () => {
    const recipe = featureRecipe();
    recipe.prototypes.push({
      id: "leg_cube", name: "support_leg", size: [1, 3, 1],
      semantic_group: "leg",
    });
    recipe.patterns.push({
      kind: "LINEAR", id: "legs", feature_id: "leg",
      prototype_id: "leg_cube", count: 1, axis: "X", spacing: 0,
      start: [0, 0, 0],
    });
    recipe.feature_intents!.push({
      id: "leg", label: "Supporting leg", visual_role: "THREE_DIMENSIONAL",
      evidence: "SUPPORTED", evidence_refs: ["reference:side:leg"],
      geometry_reasons: ["CONTACT"],
    });
    recipe.constraints = [{
      kind: "ANCHOR", id: "leg_follows_horn",
      source_instance_id: "legs:0", target_instance_id: "horns:0",
      axes: ["X"],
      source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MAX", "MIN", "MIN"],
      offset: [0, 0, 0],
    }];
    const baseline = structuredClone(recipe);
    const hornProposal = {
      id: "horn", label: "Crest horns",
      visual_role: "SURFACE_DETAIL" as const, evidence: "SUPPORTED" as const,
      evidence_refs: ["reference:front:crest"], geometry_reasons: [],
    };
    const legProposal = {
      id: "leg", label: "Supporting leg",
      visual_role: "UNNECESSARY" as const, evidence: "SUPPORTED" as const,
      evidence_refs: ["reference:side:leg"], geometry_reasons: [],
    };

    const single = assessRecipeFeatureOptimization(recipe, [hornProposal]);
    expect(single).toMatchObject({
      state: "review_required",
      review_required_count: 1,
      constraint_dependency_review_feature_count: 1,
      possible_native_removal_review_instance_count: 3,
      native_mutation_executed: false,
    });
    expect(single.candidates[0]).toMatchObject({
      feature_id: "horn",
      action: "CONSTRAINT_DEPENDENCY_REVIEW_REQUIRED",
      realized_recipe_cube_count: 3,
      proposed_native_cube_deletion: false,
      constraint_impact: {
        constraint_count: 1,
        retained_peer_constraint_count: 1,
        retained_dependent_constraint_count: 1,
        examples: [{
          id: "leg_follows_horn", role: "ANCHOR_TARGET",
          source_instance_id: "legs:0", target_instance_id: "horns:0",
          peer_feature_id: "leg", peer_route: "GEOMETRY",
        }],
      },
    });

    const legOnly = assessRecipeFeatureOptimization(recipe, [legProposal]);
    expect(legOnly.candidates[0]).toMatchObject({
      action: "CONSTRAINT_DEPENDENCY_REVIEW_REQUIRED",
      constraint_impact: {
        constraint_count: 1, retained_peer_constraint_count: 1,
        retained_dependent_constraint_count: 0,
        examples: [{ role: "DEPENDENT_SOURCE", peer_feature_id: "horn" }],
      },
    });

    // Even if both features are explicitly reclassified, their ANCHOR must
    // be separately resolved. No Recipe/Undo mutation or native savings claim.
    const both = assessRecipeFeatureOptimization(recipe, [hornProposal, legProposal]);
    expect(both.constraint_dependency_review_feature_count).toBe(0);
    expect(both.candidates.every((item) =>
      item.action === "NATIVE_REMOVAL_REVIEW_REQUIRED"
    )).toBe(true);
    expect(both.candidates.map((item) =>
      item.constraint_impact?.constraint_count
    )).toEqual([1, 1]);
    expect(recipe).toEqual(baseline);
    expect(compileAuthoringRecipe(recipe).metrics.realized_cube_count).toBe(4);
  });

  test("constraints internal to one feature require cleanup but do not invent an external dependent", () => {
    const recipe = featureRecipe();
    recipe.constraints = [{
      kind: "ANCHOR", id: "horn_chain",
      source_instance_id: "horns:1", target_instance_id: "horns:0",
      axes: ["Y"],
      source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MAX", "MIN"],
      offset: [0, 0, 0],
    }];
    const result = assessRecipeFeatureOptimization(recipe, [{
      id: "horn", label: "Crest horns",
      visual_role: "UNNECESSARY", evidence: "SUPPORTED",
      evidence_refs: ["reference:front:crest"], geometry_reasons: [],
    }]);
    expect(result.candidates[0]).toMatchObject({
      action: "NATIVE_REMOVAL_REVIEW_REQUIRED",
      constraint_impact: {
        constraint_count: 1,
        retained_peer_constraint_count: 0,
        retained_dependent_constraint_count: 0,
        examples: [{ id: "horn_chain", peer_feature_id: "horn" }],
      },
    });
    expect(result.native_mutation_executed).toBe(false);
  });

  test("legacy/unowned features and empty proposals fail closed without assigning implicit Cube owners", () => {
    expect(() => assessRecipeFeatureOptimization(chairRecipe(), [{
      id: "seat", label: "Seat", visual_role: "UNNECESSARY",
      evidence: "SUPPORTED", evidence_refs: ["image:front"],
    }])).toThrow("FEATURE_OPTIMIZATION_OWNERSHIP_REQUIRED");
    expect(() => assessRecipeFeatureOptimization(featureRecipe(), []))
      .toThrow("FEATURE_OPTIMIZATION_PROPOSALS_REQUIRED");
  });
});
