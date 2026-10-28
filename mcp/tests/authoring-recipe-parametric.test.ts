import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import {
  assessRecipeFeatureOptimization,
  assessRecipeNativeCoincidence,
  fingerprintRecipeRiskReviewScope,
  type RecipeRiskReviewEvidenceReference,
} from "@/lib/authoringRecipe/planning";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
  type RecipeNativeSurfaceSnapshot,
  type RecipeParentAuthoredState,
} from "@/lib/authoringRecipe/nativeState";
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

describe("native-parent-aware Recipe geometry coincidence review", () => {
  function coincidenceRecipe(): AuthoringRecipe {
    return {
      schema: 1, compiler_version: 1,
      id: "coincident-prop", name: "Co-located geometry",
      prototypes: [{
        id: "shell", name: "shell", size: [2, 2, 2],
        semantic_group: "shell",
      }],
      patterns: [{
        kind: "LINEAR", id: "shells", prototype_id: "shell",
        count: 2, axis: "X", spacing: 0,
      }],
    };
  }

  function parentState(uuid: string): RecipeParentAuthoredState {
    return {
      uuid, name: "Bone " + uuid,
      origin: [0, 0, 0], rotation: [0, 0, 0],
      visibility: true, export: true, mirror_uv: false, reset: false,
      bedrock_binding: null,
    };
  }

  function native(
    recipe: AuthoringRecipe,
    groups: readonly (string | null)[]
  ): AuthoringRecipeNativeSnapshot {
    const cubes = compileAuthoringRecipe(recipe).placements;
    if (groups.length !== cubes.length) throw new Error("invalid fixture group count");
    return {
      schema: 1, recipe_id: recipe.id,
      cubes: cubes.map((cube, i) => ({
        uuid: "native-" + cube.id,
        recipe_id: recipe.id, instance_id: cube.id,
        name: cube.name, from: [...cube.from], to: [...cube.to],
        origin: [...cube.origin], rotation: [...cube.rotation],
        inflate: cube.inflate,
        parent_path: groups[i] ? [groups[i]!] : [],
        parent_authored_state: groups[i] ? [parentState(groups[i]!)] : [],
      })),
    };
  }

  test("exact co-located Cubes under one verified parent remain review-only, never automatic savings", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["same-bone", "same-bone"]);
    const original = structuredClone(snapshot);
    const scan = assessRecipeNativeCoincidence(recipe, snapshot);
    expect(scan).toMatchObject({
      state: "REVIEW_ONLY",
      scope: "EXACT_RECIPE_OWNED_NATIVE_AUTHORED_GEOMETRY",
      inspected_native_cube_count: 2, coincident_group_count: 1,
      coincident_native_cube_count: 2,
      estimated_removable_cube_count: null,
      native_mutation_executed: false,
      visual_verdict: "NOT_EVALUATED",
      candidate_examples: [{
        group_size: 2, parent_path: ["same-bone"],
        instance_id_examples: ["shells:0", "shells:1"],
        native_uuid_examples: ["native-shells:0", "native-shells:1"],
        safe_to_delete: false,
      }],
    });
    expect(snapshot).toEqual(original);
    expect(compileAuthoringRecipe(recipe).metrics.realized_cube_count).toBe(2);
  });

  test("identical Recipe coordinates under different Bones are never treated as native coincident", () => {
    const recipe = coincidenceRecipe();
    const scan = assessRecipeNativeCoincidence(
      recipe, native(recipe, ["arm-left", "arm-right"])
    );
    expect(scan.coincident_group_count).toBe(0);
    expect(scan.coincident_native_cube_count).toBe(0);
    expect(scan.state).toBe("REVIEW_ONLY");
  });

  test("missing ancestry, inconsistent Group state and ambiguous native IDs fail closed", () => {
    const recipe = coincidenceRecipe();
    const absent = native(recipe, [null, null]);
    delete absent.cubes[1]!.parent_path;
    expect(() => assessRecipeNativeCoincidence(recipe, absent))
      .toThrow("RECIPE_OPTIMIZATION_PARENT_EVIDENCE_REQUIRED");

    const inconsistent = native(recipe, ["same-bone", "same-bone"]);
    inconsistent.cubes[1]!.parent_authored_state![0]!.rotation[1] = 30;
    expect(() => assessRecipeNativeCoincidence(recipe, inconsistent))
      .toThrow("RECIPE_OPTIMIZATION_PARENT_STATE_CONFLICT");

    const badParentId = native(recipe, ["same", "same"]);
    badParentId.cubes[0]!.parent_path![0] = " ";
    expect(() => assessRecipeNativeCoincidence(recipe, badParentId))
      .toThrow("RECIPE_OPTIMIZATION_PARENT_EVIDENCE_REQUIRED");

    const identity = native(recipe, [null, null]);
    identity.cubes[1]!.uuid = identity.cubes[0]!.uuid;
    expect(() => assessRecipeNativeCoincidence(recipe, identity))
      .toThrow("RECIPE_OPTIMIZATION_NATIVE_UUID_AMBIGUOUS");

    const drift = native(recipe, [null, null]);
    drift.cubes[0]!.from[0] += 1;
    expect(() => assessRecipeNativeCoincidence(recipe, drift))
      .toThrow("RECIPE_NATIVE_STATE_MISMATCH");
  });

  test("constraint and symmetry-linked coincidences carry owner evidence without removal eligibility", () => {
    const recipe = coincidenceRecipe();
    recipe.constraints = [{
      kind: "ANCHOR", id: "shell_anchor",
      source_instance_id: "shells:1", target_instance_id: "shells:0",
      axes: ["X"], source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
    }];
    recipe.symmetry = [{
      id: "shell_mirror", source_instance_id: "shells:0",
      target_instance_id: "mirrored-shell",
      plane: { axis: "X", position: 1 },
      uv_policy: "SHARE", texture_policy: "MIRROR", rig_policy: "MIRROR",
    }];
    const scan = assessRecipeNativeCoincidence(
      recipe, native(recipe, ["same", "same", "same"])
    );
    expect(scan).toMatchObject({
      coincident_group_count: 1,
      coincident_native_cube_count: 3,
      candidate_examples: [{
        group_size: 3,
        anchor_constraint_count: 1,
        anchor_constraint_examples: ["shell_anchor"],
        symmetry_relation_count: 1,
        symmetry_relation_examples: ["shell_mirror"],
        safe_to_delete: false,
      }],
    });
  });


  function surfaceFixture(
    snapshot: AuthoringRecipeNativeSnapshot
  ): RecipeNativeSurfaceSnapshot {
    return {
      project_uuid: "review-project-1",
      native_source_fingerprint: fingerprintAuthoringRecipeNativeSnapshot(snapshot),
      logical_uv_width: 32, logical_uv_height: 32,
      textures: [
        { uuid: "atlas-main", width: 32, height: 32,
          image_sha256: "a".repeat(64), group_uuid: null, pbr_channel: "color" },
        { uuid: "atlas-detail", width: 32, height: 32,
          image_sha256: "b".repeat(64), group_uuid: "detail-material", pbr_channel: "color" },
      ],
      material_groups: [{
        uuid: "detail-material", is_material: true,
        material_config_sha256: "c".repeat(64),
      }],
      animations: { clips: [] },
      cubes: snapshot.cubes.map(cube => ({
        uuid: cube.uuid, instance_id: cube.instance_id,
        visibility: true, export: true, box_uv: true,
        autouv: 1, mirror_uv: false,
        uv_offset: [0, 0],
        faces: (["north", "south", "east", "west", "up", "down"] as const)
          .map(face => ({
            face, uv: [0, 0, 4, 4] as [number, number, number, number],
            rotation: 0, enabled: true, texture_ref: "atlas-main",
            material_name: "",
          })),
      })),
    };
  }

  test("read-only surface comparison distinguishes UV differences from material/visibility differences", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["shared", "shared"]);
    const surface = surfaceFixture(snapshot);
    const source = structuredClone(surface);
    const matched = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(matched).toMatchObject({
      surface_evidence_state: "SNAPSHOT_BOUND",
      groups_with_uv_differences: 0,
      groups_with_material_differences: 0,
      groups_with_unverified_material: 0,
      candidate_examples: [{
        uv_mapping_state: "MATCHED_FIELDS",
        material_binding_state: "MATCHED_FIELDS",
        safe_to_delete: false,
      }],
    });
    surface.cubes[1]!.uv_offset = [8, 0];
    const uvChanged = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(uvChanged).toMatchObject({
      groups_with_uv_differences: 1,
      groups_with_material_differences: 0,
      candidate_examples: [{
        uv_mapping_state: "DIFFERENT",
        material_binding_state: "MATCHED_FIELDS",
      }],
    });
    surface.cubes[1]!.faces[0]!.texture_ref = "atlas-detail";
    surface.cubes[1]!.visibility = false;
    const materialsChanged = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(materialsChanged).toMatchObject({
      groups_with_uv_differences: 1,
      groups_with_material_differences: 1,
      candidate_examples: [{
        uv_mapping_state: "DIFFERENT",
        material_binding_state: "DIFFERENT",
        material_or_visibility_difference: true,
      }],
    });
    expect(materialsChanged.native_mutation_executed).toBe(false);
    expect(source.cubes[1]!.uv_offset).toEqual([0, 0]);
  });

  test("unknown/default face textures fail closed as unverified, not material equivalence", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    surface.cubes[0]!.faces[0]!.texture_ref = null;
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report).toMatchObject({
      groups_with_unverified_material: 1,
      candidate_examples: [{ material_binding_state: "UNVERIFIED",
        uv_mapping_state: "MATCHED_FIELDS", safe_to_delete: false }],
    });
  });

  test("surface snapshots reject stale native sources, ambiguous identities and incomplete face/texture data", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const valid = surfaceFixture(snapshot);
    const stale = structuredClone(valid);
    stale.native_source_fingerprint = "sha256:" + "f".repeat(64);
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, stale))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_SOURCE_STALE");

    const missingCube = structuredClone(valid);
    missingCube.cubes.pop();
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, missingCube))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_SCOPE_INVALID");

    const duplicateCube = structuredClone(valid);
    duplicateCube.cubes[1]!.uuid = duplicateCube.cubes[0]!.uuid;
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, duplicateCube))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_CUBE_IDENTITY_OR_UV_INVALID");

    const missingFace = structuredClone(valid);
    missingFace.cubes[0]!.faces.pop();
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, missingFace))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_FACE_OR_TEXTURE_INVALID");

    const unknownTexture = structuredClone(valid);
    unknownTexture.cubes[0]!.faces[0]!.texture_ref = "unknown-atlas";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, unknownTexture))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_FACE_OR_TEXTURE_INVALID");

    const malformedRevision = structuredClone(valid);
    malformedRevision.textures[0]!.image_sha256 = "not-a-real-sha";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, malformedRevision))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_TEXTURE_INVALID");
  });

  test("atlas image revision changes invalidate the surface evidence identity without claiming visual PASS", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    const before = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    surface.textures[0]!.image_sha256 = "c".repeat(64);
    const after = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(after.surface_snapshot_fingerprint).not.toBe(before.surface_snapshot_fingerprint);
    expect(after.candidate_examples[0]?.safe_to_delete).toBe(false);
    expect(after.visual_verdict).toBe("NOT_EVALUATED");
  });

  test("Recipe Service binds optional surface data to a stable owned native snapshot, without native mutation", async () => {
    const recipe = coincidenceRecipe();
    const snap = native(recipe, [null, null]);
    const current = structuredClone(snap);
    let reads = 0, surfaces = 0, adapters = 0;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => { reads++; return structuredClone(current); },
      readCoincidenceSurface: (_recipeId, source) => {
        surfaces++;
        return surfaceFixture(source);
      },
      createApplyAdapter: () => { adapters++; throw new Error("No mutation requested"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    expect(report).toMatchObject({
      surface_evidence_state: "SNAPSHOT_BOUND",
      groups_with_uv_differences: 0,
      native_mutation_executed: false,
    });
    expect(reads).toBe(2);
    expect(surfaces).toBe(1);
    expect(adapters).toBe(0);
    expect(service.registrySize()).toBe(0);

    const drifting = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(current),
      readCoincidenceSurface: (_id, source) => {
        current.cubes[0]!.from[0] += 1;
        return surfaceFixture(source);
      },
      createApplyAdapter: () => { throw new Error("should not mutate"); },
    });
    await expect(drifting.inspectStoredGeometryCoincidence({ recipe_id: recipe.id }))
      .rejects.toThrow("RECIPE_OPTIMIZATION_NATIVE_CHANGED_DURING_INSPECTION");
  });


  test("per-face material-instance changes preserve distinct visual semantics on coincident Cubes", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    const matched = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(matched.groups_with_material_differences).toBe(0);
    expect(matched.candidate_examples[0]).toMatchObject({
      material_binding_state: "MATCHED_FIELDS",
      animation_binding_state: "NO_PARENT_BONE_TRACKS_OBSERVED",
    });
    surface.cubes[1]!.faces[0]!.material_name = "emissive";
    const changed = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(changed.groups_with_material_differences).toBe(1);
    expect(changed.candidate_examples[0]).toMatchObject({
      material_binding_state: "DIFFERENT",
      safe_to_delete: false,
    });
    expect(changed.estimated_removable_cube_count).toBeNull();
  });

  test("PBR companion channels and TextureGroup config contribute to source revision", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    surface.textures[0]!.group_uuid = "detail-material";
    surface.textures[1]!.pbr_channel = "normal";
    const first = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(first).toMatchObject({
      surface_evidence_state: "SNAPSHOT_BOUND",
      groups_with_material_differences: 0,
      groups_with_unverified_material: 0,
      candidate_examples: [{ material_binding_state: "MATCHED_FIELDS" }],
    });
    surface.textures[1]!.image_sha256 = "d".repeat(64);
    const normalChanged = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(normalChanged.surface_snapshot_fingerprint)
      .not.toBe(first.surface_snapshot_fingerprint);
    surface.material_groups[0]!.material_config_sha256 = "e".repeat(64);
    const configChanged = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(configChanged.surface_snapshot_fingerprint)
      .not.toBe(normalChanged.surface_snapshot_fingerprint);

    surface.material_groups[0]!.material_config_sha256 = null;
    expect(assessRecipeNativeCoincidence(recipe, snapshot, surface))
      .toMatchObject({
        groups_with_unverified_material: 1,
        candidate_examples: [{ material_binding_state: "UNVERIFIED" }],
      });
  });

  test("unknown/ambiguous material groups, PBR channels and face instances are rejected", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const valid = surfaceFixture(snapshot);
    const unresolved = structuredClone(valid);
    unresolved.material_groups = [];
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, unresolved))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_TEXTURE_INVALID");
    const ambiguous = structuredClone(valid);
    ambiguous.material_groups.push(structuredClone(ambiguous.material_groups[0]!));
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, ambiguous))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_MATERIAL_GROUP_INVALID");
    const invalidInstance = structuredClone(valid);
    invalidInstance.cubes[0]!.faces[0]!.material_name = null as unknown as string;
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, invalidInstance))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_FACE_OR_TEXTURE_INVALID");
    const channels = structuredClone(valid);
    channels.textures.push({
      uuid: "atlas-height", width: 32, height: 32,
      image_sha256: "f".repeat(64), group_uuid: "detail-material",
      pbr_channel: "height",
    }, {
      uuid: "atlas-normal", width: 32, height: 32,
      image_sha256: "d".repeat(64), group_uuid: "detail-material",
      pbr_channel: "normal",
    });
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, channels))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_PBR_CHANNEL_AMBIGUOUS");
  });

  test("current ancestor BoneAnimator tracks protect Geometry, never promise animation-free deletion", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["animated-bone", "animated-bone"]);
    const surface = surfaceFixture(snapshot);
    surface.animations = { clips: [{
      uuid: "clip:walk",
      clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "animated-bone",
        position_keyframes: 2, rotation_keyframes: 4, scale_keyframes: 0,
        keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const observed = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(observed).toMatchObject({
      groups_with_authored_bone_animation: 1,
      groups_with_unverified_animation: 0,
      candidate_examples: [{
        animation_binding_state: "BONE_TRACKS_PRESENT",
        animated_ancestor_count: 1,
        animated_clip_count: 1,
        animated_clip_examples: ["clip:walk"],
        safe_to_delete: false,
      }],
    });
    surface.animations = null;
    const unavailable = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(unavailable).toMatchObject({
      groups_with_authored_bone_animation: 0,
      groups_with_unverified_animation: 1,
      candidate_examples: [{ animation_binding_state: "UNVERIFIED" }],
    });
    surface.animations = { clips: [] };
    const withoutTracks = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(withoutTracks.candidate_examples[0]).toMatchObject({
      animation_binding_state: "NO_PARENT_BONE_TRACKS_OBSERVED",
      safe_to_delete: false,
    });
  });

  test("animation evidence must have unique clips, valid ancestor UUIDs and bounded keyed channels", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const valid = surfaceFixture(snapshot);
    valid.animations = { clips: [{
      uuid: "clip:a", clip_settings_sha256: "c".repeat(64),
      bone_tracks: [{ bone_uuid: "bone", position_keyframes: 0,
        rotation_keyframes: 3, scale_keyframes: 0,
        keyframe_content_sha256: "d".repeat(64) }],
    }] };
    const wrong = structuredClone(valid);
    wrong.animations!.clips[0]!.bone_tracks[0]!.bone_uuid = "unrelated-bone";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, wrong))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_TRACK_INVALID");
    const duplicate = structuredClone(valid);
    duplicate.animations!.clips.push(structuredClone(duplicate.animations!.clips[0]!));
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, duplicate))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_IDENTITY_INVALID");
    const invalidCount = structuredClone(valid);
    invalidCount.animations!.clips[0]!.bone_tracks[0]!.rotation_keyframes = -1;
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, invalidCount))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_TRACK_INVALID");
  });

  test("same-count native keyframe/clip revisions invalidate scoped motion identity", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.animations = { clips: [{
      uuid: "clip:walk", clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "bone", position_keyframes: 1,
        rotation_keyframes: 2, scale_keyframes: 0,
        keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const initial = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    const matched = initial.candidate_examples[0]!;
    expect(matched.animation_binding_state).toBe("BONE_TRACKS_PRESENT");
    expect(matched.animated_clip_count).toBe(1);
    expect(matched.animated_motion_source_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

    // A changed keyframe value/interpolation can keep the same count and UUID.
    surface.animations.clips[0]!.bone_tracks[0]!.keyframe_content_sha256 = "e".repeat(64);
    const edited = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(edited.candidate_examples[0]!.animated_motion_source_fingerprint)
      .not.toBe(matched.animated_motion_source_fingerprint);
    expect(edited.surface_snapshot_fingerprint).not.toBe(initial.surface_snapshot_fingerprint);
    expect(edited.candidate_examples[0]!.animated_clip_count).toBe(1);
    expect(edited.candidate_examples[0]!.safe_to_delete).toBe(false);

    // Clip timing/loop or Molang settings are a separate motion dependency.
    surface.animations.clips[0]!.clip_settings_sha256 = "f".repeat(64);
    const settingsEdited = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(settingsEdited.candidate_examples[0]!.animated_motion_source_fingerprint)
      .not.toBe(edited.candidate_examples[0]!.animated_motion_source_fingerprint);

    surface.animations = null;
    const unavailable = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(unavailable.candidate_examples[0]!.animated_motion_source_fingerprint).toBeNull();
    expect(unavailable.candidate_examples[0]!.animation_binding_state).toBe("UNVERIFIED");
  });

  test("missing or malformed keyed content digests never certify motion continuity", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.animations = { clips: [{
      uuid: "clip:walk", clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "bone", position_keyframes: 1,
        rotation_keyframes: 1, scale_keyframes: 0,
        keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const missingSettings = structuredClone(surface);
    missingSettings.animations!.clips[0]!.clip_settings_sha256 = "";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, missingSettings))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_IDENTITY_INVALID");

    const missingTrack = structuredClone(surface);
    missingTrack.animations!.clips[0]!.bone_tracks[0]!.keyframe_content_sha256 = "";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, missingTrack))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_TRACK_INVALID");

    const invalidTrack = structuredClone(surface);
    invalidTrack.animations!.clips[0]!.bone_tracks[0]!.keyframe_content_sha256 = "wrong";
    expect(() => assessRecipeNativeCoincidence(recipe, snapshot, invalidTrack))
      .toThrow("RECIPE_OPTIMIZATION_SURFACE_ANIMATION_TRACK_INVALID");
  });


  test("missing UV/material/motion evidence remains unknown, never a low-risk merge", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const unmeasured = assessRecipeNativeCoincidence(recipe, snapshot);
    expect(unmeasured).toMatchObject({
      state: "REVIEW_ONLY",
      optimization_risk_summary: {
        scope: "ALL_COINCIDENT_RECIPE_GROUPS",
        evidence_incomplete_groups: 1,
        structural_dependency_groups: 0,
        observed_difference_or_motion_groups: 0,
        manual_visual_review_groups: 0,
        automatic_removal_allowed: false,
      },
      candidate_examples: [{
        optimization_risk: {
          category: "EVIDENCE_INCOMPLETE",
          recommended_review: "OBTAIN_MISSING_NATIVE_EVIDENCE",
          native_removal_authorized: false,
          reason_codes: [
            "UV_EVIDENCE_UNAVAILABLE",
            "MATERIAL_EVIDENCE_UNAVAILABLE",
            "ANIMATION_EVIDENCE_UNAVAILABLE",
            "RENDERED_EQUIVALENCE_UNVERIFIED",
          ],
        },
        safe_to_delete: false,
      }],
    });
    expect(unmeasured.estimated_removable_cube_count).toBeNull();
  });

  test("matching authored fields still require native visual, rig and export review", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    const unchanged = structuredClone(surface);
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report).toMatchObject({
      optimization_risk_summary: {
        manual_visual_review_groups: 1,
        evidence_incomplete_groups: 0,
        structural_dependency_groups: 0,
        observed_difference_or_motion_groups: 0,
      },
      candidate_examples: [{
        optimization_risk: {
          category: "MANUAL_VISUAL_REVIEW",
          reason_codes: ["RENDERED_EQUIVALENCE_UNVERIFIED"],
          recommended_review: "VERIFY_NATIVE_VISUAL_RIG_AND_EXPORT",
          native_removal_authorized: false,
        },
      }],
      visual_verdict: "NOT_EVALUATED",
      native_mutation_executed: false,
    });
    expect(surface).toEqual(unchanged);
  });

  test("observed UV and material differences outrank missing motion evidence, retaining every reason", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.cubes[1]!.uv_offset = [8, 0];
    surface.cubes[1]!.faces[0]!.material_name = "emissive";
    surface.animations = null;
    const reported = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(reported).toMatchObject({
      optimization_risk_summary: {
        observed_difference_or_motion_groups: 1,
        evidence_incomplete_groups: 0,
        manual_visual_review_groups: 0,
      },
      candidate_examples: [{
        optimization_risk: {
          category: "OBSERVED_DIFFERENCE_OR_MOTION",
          reason_codes: [
            "UV_MAPPING_DIFFERENT",
            "MATERIAL_BINDING_DIFFERENT",
            "ANIMATION_EVIDENCE_UNAVAILABLE",
            "RENDERED_EQUIVALENCE_UNVERIFIED",
          ],
          recommended_review: "INSPECT_UV_MATERIAL_AND_MOTION_DEPENDENCIES",
          native_removal_authorized: false,
        },
      }],
    });
  });

  test("observed face-material differences remain visible even when material evidence is incomplete", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    // One face now has no resolved texture, so a comparison cannot claim
    // equivalent materials, but the differing assignment is still observed.
    surface.cubes[0]!.faces[0]!.texture_ref = null;
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report).toMatchObject({
      groups_with_material_differences: 1,
      groups_with_unverified_material: 1,
      optimization_risk_summary: {
        observed_difference_or_motion_groups: 1,
        evidence_incomplete_groups: 0,
      },
      candidate_examples: [{
        material_binding_state: "UNVERIFIED",
        material_or_visibility_difference: true,
        optimization_risk: {
          category: "OBSERVED_DIFFERENCE_OR_MOTION",
          reason_codes: [
            "MATERIAL_BINDING_DIFFERENT",
            "MATERIAL_EVIDENCE_UNAVAILABLE",
            "RENDERED_EQUIVALENCE_UNVERIFIED",
          ],
          native_removal_authorized: false,
        },
        safe_to_delete: false,
      }],
    });
  });

  test("keyed ancestor animation is an observed motion dependency without a false geometry savings claim", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.animations = { clips: [{
      uuid: "clip:walk",
      clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "bone", position_keyframes: 1, rotation_keyframes: 2,
        scale_keyframes: 0, keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const first = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(first).toMatchObject({
      optimization_risk_summary: { observed_difference_or_motion_groups: 1 },
      candidate_examples: [{
        optimization_risk: {
          category: "OBSERVED_DIFFERENCE_OR_MOTION",
          reason_codes: ["ANIMATED_PARENT_BONE", "RENDERED_EQUIVALENCE_UNVERIFIED"],
        },
        animation_binding_state: "BONE_TRACKS_PRESENT",
        safe_to_delete: false,
      }],
    });
    surface.animations.clips[0]!.bone_tracks[0]!.keyframe_content_sha256 = "d".repeat(64);
    const changed = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(changed.candidate_examples[0]!.animated_motion_source_fingerprint)
      .not.toBe(first.candidate_examples[0]!.animated_motion_source_fingerprint);
    expect(changed.candidate_examples[0]!.optimization_risk.category)
      .toBe("OBSERVED_DIFFERENCE_OR_MOTION");
    expect(changed.native_mutation_executed).toBe(false);
  });

  test("anchor and symmetry dependencies take priority while preserving independent UV and animation warnings", () => {
    const recipe = coincidenceRecipe();
    recipe.constraints = [{
      kind: "ANCHOR", id: "shell-anchor",
      source_instance_id: "shells:1", target_instance_id: "shells:0",
      axes: ["X"], source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
    }];
    recipe.symmetry = [{
      id: "mirror-shell", source_instance_id: "shells:0",
      target_instance_id: "mirror",
      plane: { axis: "X", position: 1 },
      uv_policy: "SHARE", texture_policy: "MIRROR", rig_policy: "MIRROR",
    }];
    const snapshot = native(recipe, ["bone", "bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.cubes[2]!.uv_offset = [4, 0];
    surface.animations = { clips: [{
      uuid: "clip:walk", clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "bone", position_keyframes: 0, rotation_keyframes: 1,
        scale_keyframes: 0, keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report).toMatchObject({
      optimization_risk_summary: {
        structural_dependency_groups: 1,
        observed_difference_or_motion_groups: 0,
        evidence_incomplete_groups: 0,
        manual_visual_review_groups: 0,
      },
      candidate_examples: [{
        group_size: 3,
        optimization_risk: {
          category: "STRUCTURAL_DEPENDENCY",
          reason_codes: [
            "ANCHOR_CONSTRAINT_PRESENT",
            "SYMMETRY_RELATION_PRESENT",
            "UV_MAPPING_DIFFERENT",
            "ANIMATED_PARENT_BONE",
            "RENDERED_EQUIVALENCE_UNVERIFIED",
          ],
          recommended_review: "REVIEW_RELATIONSHIP_OWNERSHIP",
          native_removal_authorized: false,
        },
        safe_to_delete: false,
      }],
    });
    expect(report.estimated_removable_cube_count).toBeNull();
  });

  test("risk summary covers every coincident group even when candidate examples are truncated", () => {
    const recipe = coincidenceRecipe();
    recipe.patterns = Array.from({ length: 9 }, (_, i) => ({
      kind: "LINEAR" as const,
      id: "duplicate-cluster-" + i, prototype_id: "shell",
      count: 2, axis: "X" as const, spacing: 0,
      start: [i * 6, 0, 0] as [number, number, number],
    }));
    const compiled = compileAuthoringRecipe(recipe);
    expect(compiled.placements).toHaveLength(18);
    const report = assessRecipeNativeCoincidence(
      recipe, native(recipe, Array(18).fill(null))
    );
    expect(report).toMatchObject({
      coincident_group_count: 9,
      candidate_examples_truncated: true,
      optimization_risk_summary: {
        scope: "ALL_COINCIDENT_RECIPE_GROUPS",
        evidence_incomplete_groups: 9,
        structural_dependency_groups: 0,
        observed_difference_or_motion_groups: 0,
        manual_visual_review_groups: 0,
        automatic_removal_allowed: false,
      },
      visual_verdict: "NOT_EVALUATED",
      native_mutation_executed: false,
    });
    expect(report.candidate_examples).toHaveLength(8);
    expect(report.candidate_examples.every((group) =>
      group.optimization_risk.native_removal_authorized === false
    )).toBe(true);
  });


  test("risk review batches missing UV/material/animation evidence once per owner with exact Cube scope", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, ["same-bone", "same-bone"]);
    const report = assessRecipeNativeCoincidence(recipe, snapshot);
    const plan = report.optimization_review_plan;
    expect(plan).toMatchObject({
      state: "PREPARED_SOURCE_ONLY",
      scope: "DEDUPLICATED_OWNER_CHECKS_FOR_COINCIDENT_GROUPS",
      check_count: 4,
      group_check_count: 4,
      native_review_executed: false,
      native_mutation_authorized: false,
      visual_verdict: "NOT_EVALUATED",
    });
    expect(plan.batches.map(batch => batch.check_id)).toEqual([
      "NATIVE_UV_MAPPING",
      "NATIVE_MATERIAL_BINDING",
      "NATIVE_BONE_ANIMATION",
      "NATIVE_VISUAL_AND_EXPORT",
    ]);
    for (const batch of plan.batches) {
      expect(batch).toMatchObject({
        candidate_group_count: 1,
        execution_state: "NOT_EXECUTED",
        instance_scope: {
          count: 2, examples: ["shells:0", "shells:1"],
          examples_truncated: false,
        },
        native_cube_scope: {
          count: 2, examples: ["native-shells:0", "native-shells:1"],
          examples_truncated: false,
        },
        anchor_relation_scope: { count: 0 },
        symmetry_relation_scope: { count: 0 },
      });
    }
    expect(report.candidate_examples[0]!.optimization_review).toMatchObject({
      state: "PREPARED_SOURCE_ONLY",
      check_ids: plan.batches.map(batch => batch.check_id),
      native_review_executed: false,
      native_removal_authorized: false,
    });
    expect(report.estimated_removable_cube_count).toBeNull();
  });

  test("all matching authored UV/material fields still request only native visual/export review", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    const unchanged = structuredClone(surface);
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report.optimization_review_plan).toMatchObject({
      check_count: 1, group_check_count: 1,
      batches: [{
        check_id: "NATIVE_VISUAL_AND_EXPORT",
        evidence_owner: "REFERENCE_VISUAL_EXPORT_OWNER",
        trigger_reason_codes: ["RENDERED_EQUIVALENCE_UNVERIFIED"],
        candidate_group_count: 1,
        execution_state: "NOT_EXECUTED",
      }],
    });
    expect(report.candidate_examples[0]!.optimization_review.check_ids)
      .toEqual(["NATIVE_VISUAL_AND_EXPORT"]);
    expect(surface).toEqual(unchanged);
    expect(report.native_mutation_executed).toBe(false);
  });

  test("observed material differences and unresolved material proof produce one targeted review batch", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    surface.cubes[0]!.faces[0]!.texture_ref = null;
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    const batches = report.optimization_review_plan.batches;
    expect(batches.map(batch => batch.check_id)).toEqual([
      "NATIVE_MATERIAL_BINDING", "NATIVE_VISUAL_AND_EXPORT",
    ]);
    expect(batches[0]).toMatchObject({
      check_id: "NATIVE_MATERIAL_BINDING",
      trigger_reason_codes: [
        "MATERIAL_BINDING_DIFFERENT",
        "MATERIAL_EVIDENCE_UNAVAILABLE",
      ],
      candidate_group_count: 1,
      native_cube_scope: { count: 2 },
    });
    expect(report.optimization_review_plan.check_count).toBe(2);
    expect(report.candidate_examples[0]!.optimization_review.check_ids)
      .toEqual(["NATIVE_MATERIAL_BINDING", "NATIVE_VISUAL_AND_EXPORT"]);
  });

  test("Anchor/Symmetry and animated Bone produce distinct owner reviews with scoped relation/clip IDs", () => {
    const recipe = coincidenceRecipe();
    recipe.constraints = [{
      kind: "ANCHOR", id: "shell-anchor",
      source_instance_id: "shells:1", target_instance_id: "shells:0",
      axes: ["X"], source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
    }];
    recipe.symmetry = [{
      id: "mirror-shell", source_instance_id: "shells:0",
      target_instance_id: "mirror", plane: { axis: "X", position: 1 },
      uv_policy: "SHARE", texture_policy: "MIRROR", rig_policy: "MIRROR",
    }];
    const snapshot = native(recipe, ["bone", "bone", "bone"]);
    const surface = surfaceFixture(snapshot);
    surface.cubes[2]!.uv_offset = [6, 0];
    surface.animations = { clips: [{
      uuid: "clip:walk", clip_settings_sha256: "a".repeat(64),
      bone_tracks: [{
        bone_uuid: "bone", position_keyframes: 1,
        rotation_keyframes: 2, scale_keyframes: 0,
        keyframe_content_sha256: "b".repeat(64),
      }],
    }] };
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report.optimization_review_plan.batches.map(batch => batch.check_id))
      .toEqual([
        "RECIPE_ANCHOR_RELATION",
        "RECIPE_SYMMETRY_RELATION",
        "NATIVE_UV_MAPPING",
        "NATIVE_BONE_ANIMATION",
        "NATIVE_VISUAL_AND_EXPORT",
      ]);
    expect(report.optimization_review_plan).toMatchObject({
      check_count: 5, group_check_count: 5,
      batches: [
        {
          evidence_owner: "SAVED_RECIPE",
          anchor_relation_scope: { count: 1, examples: ["shell-anchor"] },
        },
        {
          evidence_owner: "SAVED_RECIPE",
          symmetry_relation_scope: { count: 1, examples: ["mirror-shell"] },
        },
        { instance_scope: { count: 3 } },
        { animation_clip_scope: { count: 1, examples: ["clip:walk"] } },
        { native_cube_scope: { count: 3 } },
      ],
    });
    expect(report.candidate_examples[0]!.optimization_risk.category)
      .toBe("STRUCTURAL_DEPENDENCY");
    expect(report.optimization_review_plan.native_mutation_authorized).toBe(false);
  });

  test("deduped reviews cover all nine groups and exact IDs even when preview is truncated", () => {
    const recipe = coincidenceRecipe();
    recipe.patterns = Array.from({ length: 9 }, (_, i) => ({
      kind: "LINEAR" as const,
      id: "duplicate-cluster-" + i,
      prototype_id: "shell", count: 2,
      axis: "X" as const, spacing: 0,
      start: [i * 6, 0, 0] as [number, number, number],
    }));
    const snapshot = native(recipe, Array(18).fill(null));
    const report = assessRecipeNativeCoincidence(recipe, snapshot);
    expect(report.candidate_examples_truncated).toBe(true);
    expect(report.candidate_examples).toHaveLength(8);
    const plan = report.optimization_review_plan;
    expect(plan).toMatchObject({
      state: "PREPARED_SOURCE_ONLY",
      check_count: 4,
      group_check_count: 36,
      native_review_executed: false,
    });
    for (const batch of plan.batches) {
      expect(batch).toMatchObject({
        candidate_group_count: 9,
        instance_scope: { count: 18, examples_truncated: true },
        native_cube_scope: { count: 18, examples_truncated: true },
      });
      expect(batch.instance_scope.examples).toHaveLength(12);
      expect(batch.native_cube_scope.examples).toHaveLength(12);
    }
    expect(plan.batches[3]!.check_id).toBe("NATIVE_VISUAL_AND_EXPORT");
    expect(report.optimization_risk_summary.evidence_incomplete_groups).toBe(9);
  });

  test("an observed UV mismatch scopes UV review only to its cohort, not unrelated matching Cubes", () => {
    const recipe = coincidenceRecipe();
    recipe.patterns = [
      { kind: "LINEAR", id: "cluster-a", prototype_id: "shell",
        count: 2, axis: "X", spacing: 0, start: [0, 0, 0] },
      { kind: "LINEAR", id: "cluster-b", prototype_id: "shell",
        count: 2, axis: "X", spacing: 0, start: [8, 0, 0] },
    ];
    const snapshot = native(recipe, Array(4).fill(null));
    const surface = surfaceFixture(snapshot);
    const modified = surface.cubes.find(cube => cube.instance_id === "cluster-a:1");
    expect(modified).toBeDefined();
    modified!.uv_offset = [4, 0];
    const report = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(report.coincident_group_count).toBe(2);
    expect(report.optimization_review_plan.batches.map(batch => batch.check_id))
      .toEqual(["NATIVE_UV_MAPPING", "NATIVE_VISUAL_AND_EXPORT"]);
    expect(report.optimization_review_plan.batches[0]).toMatchObject({
      candidate_group_count: 1,
      instance_scope: {
        count: 2, examples: ["cluster-a:0", "cluster-a:1"],
      },
      native_cube_scope: {
        count: 2, examples: ["native-cluster-a:0", "native-cluster-a:1"],
      },
      execution_state: "NOT_EXECUTED",
    });
    expect(report.optimization_review_plan.batches[1]).toMatchObject({
      candidate_group_count: 2,
      instance_scope: { count: 4 },
    });
    expect(report.optimization_review_plan.group_check_count).toBe(3);
  });

  test("no coincident Recipe geometry creates no optimizer review work", () => {
    const recipe = coincidenceRecipe();
    const pattern = recipe.patterns[0]!;
    if (pattern.kind !== "LINEAR") throw new Error("Unexpected fixture pattern.");
    pattern.spacing = 4;
    const snapshot = native(recipe, [null, null]);
    const report = assessRecipeNativeCoincidence(recipe, snapshot);
    expect(report).toMatchObject({
      coincident_group_count: 0,
      optimization_review_plan: {
        state: "PREPARED_SOURCE_ONLY",
        check_count: 0, group_check_count: 0, batches: [],
        native_review_executed: false,
        native_mutation_authorized: false,
      },
    });
    expect(report.candidate_examples).toEqual([]);
  });


  test("review source identity pins Recipe, native, UV/material/motion and all six-check work", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const report = assessRecipeNativeCoincidence(
      recipe, snapshot, surfaceFixture(snapshot)
    );
    const identity = report.review_source_identity;
    expect(identity).toMatchObject({
      schema: 1,
      recipe_id: recipe.id,
      native_source_fingerprint: report.native_snapshot_fingerprint,
      surface_source_fingerprint: report.surface_snapshot_fingerprint,
      project_uuid: "review-project-1",
    });
    for (const id of [
      identity.recipe_source_fingerprint,
      identity.native_source_fingerprint,
      identity.surface_source_fingerprint,
      identity.review_plan_fingerprint,
      identity.source_binding_fingerprint,
    ]) {
      expect(id).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(report.optimization_review_plan.source_readiness).toEqual({
      state: "SOURCE_FIELDS_OBSERVED_REVIEW_PENDING",
      source_fields_present_check_count: 0,
      source_fields_incomplete_check_count: 0,
      native_proof_required_check_count: 1,
      native_review_executed: false,
    });
    expect(report.optimization_review_plan.batches[0]).toMatchObject({
      check_id: "NATIVE_VISUAL_AND_EXPORT",
      source_readiness: "NATIVE_PROOF_REQUIRED",
      execution_state: "NOT_EXECUTED",
    });
  });

  test("review readiness never treats absent UV/material/animation as verified", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const report = assessRecipeNativeCoincidence(recipe, snapshot);
    expect(report.review_source_identity).toMatchObject({
      project_uuid: null, surface_source_fingerprint: null,
    });
    expect(report.optimization_review_plan.source_readiness).toEqual({
      state: "SOURCE_INCOMPLETE",
      source_fields_present_check_count: 0,
      source_fields_incomplete_check_count: 3,
      native_proof_required_check_count: 1,
      native_review_executed: false,
    });
    expect(report.optimization_review_plan.batches.map(b => b.source_readiness))
      .toEqual([
        "SOURCE_FIELDS_INCOMPLETE",
        "SOURCE_FIELDS_INCOMPLETE",
        "SOURCE_FIELDS_INCOMPLETE",
        "NATIVE_PROOF_REQUIRED",
      ]);
  });

  test("constraint-only Recipe metadata drift invalidates review despite unchanged compiled Cubes", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const before = assessRecipeNativeCoincidence(recipe, snapshot);
    const next = structuredClone(recipe);
    next.constraints = [{
      kind: "ANCHOR", id: "shells-cluster-anchor",
      source_instance_id: "shells:1", target_instance_id: "shells:0",
      axes: ["X"],
      source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
    }];
    const after = assessRecipeNativeCoincidence(next, snapshot);
    expect(after.native_snapshot_fingerprint).toBe(before.native_snapshot_fingerprint);
    expect(after.review_source_identity.recipe_source_fingerprint)
      .not.toBe(before.review_source_identity.recipe_source_fingerprint);
    expect(after.review_source_identity.review_plan_fingerprint)
      .not.toBe(before.review_source_identity.review_plan_fingerprint);
    expect(after.review_source_identity.source_binding_fingerprint)
      .not.toBe(before.review_source_identity.source_binding_fingerprint);
    expect(after.optimization_review_plan.batches[0].check_id)
      .toBe("RECIPE_ANCHOR_RELATION");
    expect(snapshot.cubes).toHaveLength(2);
  });

  test("bitmap-only drift invalidates source identity without pretending native Geometry changed", () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const surface = surfaceFixture(snapshot);
    const before = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    surface.textures[0].image_sha256 = "e".repeat(64);
    const after = assessRecipeNativeCoincidence(recipe, snapshot, surface);
    expect(after.review_source_identity.native_source_fingerprint)
      .toBe(before.review_source_identity.native_source_fingerprint);
    expect(after.review_source_identity.recipe_source_fingerprint)
      .toBe(before.review_source_identity.recipe_source_fingerprint);
    expect(after.review_source_identity.surface_source_fingerprint)
      .not.toBe(before.review_source_identity.surface_source_fingerprint);
    expect(after.review_source_identity.review_plan_fingerprint)
      .toBe(before.review_source_identity.review_plan_fingerprint);
    expect(after.review_source_identity.source_binding_fingerprint)
      .not.toBe(before.review_source_identity.source_binding_fingerprint);
    expect(after.native_mutation_executed).toBe(false);
  });

  test("Recipe Service checks current source without executing any risk review or native mutation", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    let adapters = 0;
    let activeSurface = surfaceFixture(snapshot);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      readCoincidenceSurface: () => structuredClone(activeSurface),
      createApplyAdapter: () => {
        adapters++;
        throw new Error("review-only must not make Apply adapters");
      },
    });
    const prior = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const current = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: prior.review_source_identity,
    });
    expect(current).toMatchObject({
      state: "SOURCE_CURRENT",
      comparison_scope: "CALLER_SUPPLIED_REVIEW_SOURCE_DRIFT_ONLY",
      changed_source_parts: [],
      current_review_source_identity: prior.review_source_identity,
      current_review_plan: {
        check_count: 1, source_readiness: {
          state: "SOURCE_FIELDS_OBSERVED_REVIEW_PENDING",
        },
        native_review_executed: false,
      },
      native_verification_executed: false,
      visual_verdict: "NOT_EVALUATED",
      native_mutation_authorized: false,
    });
    expect(adapters).toBe(0);

    // Same Cube geometry, but a per-face material assignment changed.
    activeSurface.cubes[0].faces[0].material_name = "new_material";
    const stale = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: prior.review_source_identity,
    });
    expect(stale).toMatchObject({
      state: "SOURCE_STALE",
      changed_source_parts: ["UV_MATERIAL_ANIMATION", "REVIEW_PLAN"],
      current_review_plan: { check_count: 2 },
      native_verification_executed: false,
      native_mutation_authorized: false,
    });
    expect(adapters).toBe(0);
  });

  test("freshness detects saved Recipe dependency changes that leave native geometry unchanged", async () => {
    let recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      readCoincidenceSurface: (_id, nativeSource) => surfaceFixture(nativeSource),
      createApplyAdapter: () => { throw new Error("No native Apply during review."); },
    });
    const baseline = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    recipe = structuredClone(recipe);
    recipe.constraints = [{
      kind: "ANCHOR", id: "same-geometry-dependency",
      source_instance_id: "shells:1", target_instance_id: "shells:0",
      axes: ["X"], source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
    }];
    const result = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: baseline.review_source_identity,
    });
    expect(result.state).toBe("SOURCE_STALE");
    expect(result.changed_source_parts).toEqual(["RECIPE", "REVIEW_PLAN"]);
    expect(result.current_review_source_identity.native_source_fingerprint)
      .toBe(baseline.review_source_identity.native_source_fingerprint);
    expect(result.current_review_plan.batches[0].check_id)
      .toBe("RECIPE_ANCHOR_RELATION");
  });

  test("missing native surface stays incomplete and malformed caller baselines fail before a read", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    let readCount = 0;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => { readCount++; return snapshot; },
      createApplyAdapter: () => { throw new Error("No native Apply."); },
    });
    const baseline = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const result = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: baseline.review_source_identity,
    });
    expect(result).toMatchObject({
      state: "SOURCE_INCOMPLETE",
      changed_source_parts: [],
      current_review_plan: {
        source_readiness: { state: "SOURCE_INCOMPLETE" },
        native_review_executed: false,
      },
      native_mutation_authorized: false,
    });
    const previousReads = readCount;
    await expect(service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: {
        ...baseline.review_source_identity,
        recipe_source_fingerprint: "sha256:" + "f".repeat(64),
      },
    })).rejects.toThrow("RECIPE_OPTIMIZATION_REVIEW_BASELINE_INVALID");
    expect(readCount).toBe(previousReads);
  });

  test("freshness distinguishes project changes and native parent changes from Recipe changes", async () => {
    const recipe = coincidenceRecipe();
    let owned = native(recipe, [null, null]);
    let projectId = "review-project-1";
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(owned),
      readCoincidenceSurface: (_id, snap) => {
        const surface = surfaceFixture(snap);
        surface.project_uuid = projectId;
        return surface;
      },
      createApplyAdapter: () => { throw new Error("No native Apply."); },
    });
    const baseline = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    projectId = "other-project";
    const switched = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: baseline.review_source_identity,
    });
    expect(switched.state).toBe("SOURCE_STALE");
    expect(switched.changed_source_parts).toEqual(["UV_MATERIAL_ANIMATION", "PROJECT"]);

    projectId = "review-project-1";
    owned = native(recipe, ["bone", "bone"]);
    const moved = await service.checkStoredGeometryOptimizationReviewFreshness({
      recipe_id: recipe.id,
      expected_review_source_identity: baseline.review_source_identity,
    });
    expect(moved.state).toBe("SOURCE_STALE");
    expect(moved.changed_source_parts).toContain("NATIVE_GEOMETRY");
    expect(moved.changed_source_parts).toContain("UV_MATERIAL_ANIMATION");
    expect(moved.changed_source_parts).not.toContain("RECIPE");
  });

  test("an in-flight saved Recipe mutation fails closed before returning a mixed-source report", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      readCoincidenceSurface: (_id, source) => {
        recipe.constraints = [{
          kind: "ANCHOR", id: "concurrently-updated-anchor",
          source_instance_id: "shells:1", target_instance_id: "shells:0",
          axes: ["X"], source_anchor: ["MIN", "MIN", "MIN"],
          target_anchor: ["MIN", "MIN", "MIN"],
        }];
        return surfaceFixture(source);
      },
      createApplyAdapter: () => { throw new Error("No native mutation."); },
    });
    await expect(service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id }))
      .rejects.toThrow("RECIPE_OPTIMIZATION_RECIPE_CHANGED_DURING_INSPECTION");
  });


  /** A claimant's reference is deliberately NOT an authenticated owner receipt. */
  function ownerReferenceClaims(
    report: ReturnType<typeof assessRecipeNativeCoincidence>
  ): RecipeRiskReviewEvidenceReference[] {
    return report.optimization_review_plan.batches.map(batch => ({
      check_id: batch.check_id,
      evidence_owner: batch.evidence_owner,
      source_binding_fingerprint: report.review_source_identity.source_binding_fingerprint,
      evidence_ref: "synthetic-unattested:" + batch.check_id,
      full_scope: {
        check_id: batch.check_id,
        evidence_owner: batch.evidence_owner,
        candidate_group_count: batch.candidate_group_count,
        trigger_reason_codes: [...batch.trigger_reason_codes],
        instance_ids: [...batch.instance_scope.examples],
        native_cube_uuids: [...batch.native_cube_scope.examples],
        anchor_relation_ids: [...batch.anchor_relation_scope.examples],
        symmetry_relation_ids: [...batch.symmetry_relation_scope.examples],
        animation_clip_ids: [...batch.animation_clip_scope.examples],
      },
    }));
  }

  test("complete same-source review references bind only as unverified claims, never a PASS", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    let adapterRequests = 0;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      readCoincidenceSurface: (_, owned) => surfaceFixture(owned),
      createApplyAdapter: () => {
        adapterRequests++;
        throw new Error("No native Apply for review reconciliation.");
      },
    });
    const initial = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const references = ownerReferenceClaims(initial);
    expect(references).toHaveLength(1);
    const reconciled = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: initial.review_source_identity,
      references,
    });
    expect(reconciled).toMatchObject({
      state: "REFERENCES_BOUND_UNATTESTED",
      source_freshness_state: "SOURCE_CURRENT",
      reconciliation_scope: "CALLER_SUPPLIED_REFERENCE_SCOPE_MATCH_ONLY",
      check_count: 1,
      submitted_reference_count: 1,
      matched_unattested_reference_count: 1,
      checks: [{
        check_id: "NATIVE_VISUAL_AND_EXPORT",
        state: "REFERENCE_BOUND_UNATTESTED",
        source_readiness: "NATIVE_PROOF_REQUIRED",
        owner_provenance_verified: false,
        native_check_executed: false,
      }],
      owner_provenance_verified: false,
      verified_evidence_count: 0,
      native_review_executed: false,
      review_approved: false,
      safe_to_delete: false,
      native_mutation_authorized: false,
      visual_verdict: "NOT_EVALUATED",
    });
    expect(adapterRequests).toBe(0);
    expect(service.registrySize()).toBe(0);
    expect(service.evidenceRegistrySize()).toBe(0);
  });

  test("unsubmitted owner evidence remains missing even with a current Recipe source", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      readCoincidenceSurface: (_, owned) => surfaceFixture(owned),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const first = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const result = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: first.review_source_identity,
      references: [],
    });
    expect(result).toMatchObject({
      state: "REFERENCES_MISSING",
      submitted_reference_count: 0,
      matched_unattested_reference_count: 0,
      checks: [{ state: "REFERENCE_MISSING" }],
      native_mutation_authorized: false,
    });
  });

  test("a claim cannot replace missing UV/material/motion source fields", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snapshot),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const current = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const refs = ownerReferenceClaims(current);
    expect(refs).toHaveLength(4);
    const result = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: current.review_source_identity,
      references: refs,
    });
    expect(result).toMatchObject({
      state: "SOURCE_INCOMPLETE",
      source_freshness_state: "SOURCE_INCOMPLETE",
      submitted_reference_count: 4,
      matched_unattested_reference_count: 1,
      verified_evidence_count: 0,
      native_mutation_authorized: false,
    });
    expect(result.checks.map(c => c.state)).toEqual([
      "SOURCE_INCOMPLETE",
      "SOURCE_INCOMPLETE",
      "SOURCE_INCOMPLETE",
      "REFERENCE_BOUND_UNATTESTED",
    ]);
  });

  test("the full scope digest detects omitted IDs beyond the twelve displayed examples", async () => {
    const recipe = coincidenceRecipe();
    recipe.patterns = Array.from({ length: 9 }, (_, i) => ({
      kind: "LINEAR" as const, id: "coincident-" + i,
      prototype_id: "shell", count: 2,
      axis: "X" as const, spacing: 0,
      start: [i * 6, 0, 0] as [number, number, number],
    }));
    const snap = native(recipe, Array(18).fill(null));
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snap),
      readCoincidenceSurface: (_, owned) => surfaceFixture(owned),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    expect(report).toMatchObject({
      coincident_group_count: 9,
      optimization_review_plan: { check_count: 1 },
    });
    expect(report.optimization_review_plan.batches[0].native_cube_scope).toMatchObject({
      count: 18, examples_truncated: true,
    });
    const claim = ownerReferenceClaims(report)[0]!;
    expect(claim.full_scope.instance_ids).toHaveLength(12);
    const partial = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [claim],
    });
    expect(partial).toMatchObject({
      state: "REFERENCES_MISMATCHED",
      checks: [{ state: "SCOPE_MISMATCH" }],
      verified_evidence_count: 0,
      safe_to_delete: false,
    });
    claim.full_scope.instance_ids = snap.cubes.map(cube => cube.instance_id);
    claim.full_scope.native_cube_uuids = snap.cubes.map(cube => cube.uuid);
    expect(fingerprintRecipeRiskReviewScope(claim.full_scope))
      .toBe(report.optimization_review_plan.batches[0].full_scope_fingerprint);
    // Display order and claimant enumeration order are not significance.
    claim.full_scope.native_cube_uuids.reverse();
    expect(fingerprintRecipeRiskReviewScope(claim.full_scope))
      .toBe(report.optimization_review_plan.batches[0].full_scope_fingerprint);
    const full = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [claim],
    });
    expect(full.state).toBe("REFERENCES_BOUND_UNATTESTED");
    expect(full.native_review_executed).toBe(false);
  });

  test("wrong Cube IDs or mismatched source identity never match the current review", async () => {
    const recipe = coincidenceRecipe();
    const snap = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snap),
      readCoincidenceSurface: (_, owned) => surfaceFixture(owned),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const scopeWrong = ownerReferenceClaims(report);
    scopeWrong[0]!.full_scope.native_cube_uuids[1] = "different-but-valid-uuid";
    const mismatched = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: scopeWrong,
    });
    expect(mismatched).toMatchObject({
      state: "REFERENCES_MISMATCHED",
      checks: [{ state: "SCOPE_MISMATCH" }],
    });
    const wrongSource = ownerReferenceClaims(report);
    wrongSource[0]!.source_binding_fingerprint = "sha256:" + "f".repeat(64);
    const rejectedSource = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: wrongSource,
    });
    expect(rejectedSource).toMatchObject({
      state: "REFERENCES_MISMATCHED",
      checks: [{ state: "SOURCE_BINDING_MISMATCH" }],
    });
  });

  test("stale Recipe review baselines override obsolete check references without asserting validity", async () => {
    const recipe = coincidenceRecipe();
    const snap = native(recipe, [null, null]);
    const surface = surfaceFixture(snap);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snap),
      readCoincidenceSurface: () => structuredClone(surface),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const old = ownerReferenceClaims(report);
    surface.cubes[0]!.faces[0]!.material_name = "new-emissive";
    const result = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: old,
    });
    expect(result).toMatchObject({
      state: "SOURCE_STALE",
      source_freshness_state: "SOURCE_STALE",
      changed_source_parts: ["UV_MATERIAL_ANIMATION", "REVIEW_PLAN"],
      submitted_reference_count: 1,
      verified_evidence_count: 0,
      review_approved: false,
    });
    expect(result.checks.every(check => check.state === "SOURCE_STALE")).toBe(true);
  });

  test("duplicate/unplanned owner claims and malformed scope are rejected before any proof promotion", async () => {
    const recipe = coincidenceRecipe();
    const snap = native(recipe, [null, null]);
    let reads = 0;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => { reads++; return structuredClone(snap); },
      readCoincidenceSurface: (_, owned) => surfaceFixture(owned),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    const ref = ownerReferenceClaims(report)[0]!;
    const beforeReads = reads;
    await expect(service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [ref, structuredClone(ref)],
    })).rejects.toThrow("RECIPE_OPTIMIZATION_REVIEW_REFERENCES_INVALID");
    expect(reads).toBe(beforeReads);

    const invalid = structuredClone(ref);
    invalid.full_scope.native_cube_uuids.push(invalid.full_scope.native_cube_uuids[0]!);
    await expect(service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [invalid],
    })).rejects.toThrow("RECIPE_OPTIMIZATION_REVIEW_FULL_SCOPE_INVALID");
    expect(reads).toBe(beforeReads);

    const wrongOwner = structuredClone(ref);
    wrongOwner.evidence_owner = "NATIVE_UV_OWNER";
    wrongOwner.full_scope.evidence_owner = "NATIVE_UV_OWNER";
    await expect(service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [wrongOwner],
    })).rejects.toThrow("RECIPE_OPTIMIZATION_REVIEW_FULL_SCOPE_INVALID");
    expect(reads).toBe(beforeReads);

    const unplanned = structuredClone(ref);
    unplanned.check_id = "RECIPE_ANCHOR_RELATION";
    unplanned.evidence_owner = "SAVED_RECIPE";
    unplanned.full_scope.check_id = "RECIPE_ANCHOR_RELATION";
    unplanned.full_scope.evidence_owner = "SAVED_RECIPE";
    unplanned.full_scope.trigger_reason_codes = ["ANCHOR_CONSTRAINT_PRESENT"];
    await expect(service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [unplanned],
    })).rejects.toThrow("RECIPE_OPTIMIZATION_REVIEW_CHECK_NOT_PLANNED");
  });

  test("when there is no coincidence, no claimed evidence is required or accepted", async () => {
    const recipe = coincidenceRecipe();
    const pattern = recipe.patterns[0]!;
    if (pattern.kind !== "LINEAR") throw new Error("unexpected fixture");
    pattern.spacing = 6;
    const snap = native(recipe, [null, null]);
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => structuredClone(snap),
      createApplyAdapter: () => { throw new Error("No Apply"); },
    });
    const report = await service.inspectStoredGeometryCoincidence({ recipe_id: recipe.id });
    expect(report.optimization_review_plan.check_count).toBe(0);
    const result = await service.reconcileStoredGeometryOptimizationReviewEvidence({
      recipe_id: recipe.id,
      expected_review_source_identity: report.review_source_identity,
      references: [],
    });
    expect(result).toMatchObject({
      state: "NO_REVIEW_CANDIDATES",
      check_count: 0,
      submitted_reference_count: 0,
      verified_evidence_count: 0,
      review_approved: false,
      safe_to_delete: false,
    });
  });

  test("existing Recipe Service reads stored native source without applying any mutation", async () => {
    const recipe = coincidenceRecipe();
    const snapshot = native(recipe, [null, null]);
    let readCount = 0;
    let mutationCount = 0;
    const service = createAuthoringRecipeService({
      readStoredRecipe: () => recipe,
      readOwned: () => { readCount++; return snapshot; },
      createApplyAdapter: () => {
        mutationCount++;
        throw new Error("Read-only inspection must not request a native adapter.");
      },
    });
    const report = await service.inspectStoredGeometryCoincidence({
      recipe_id: recipe.id,
    });
    expect(report).toMatchObject({
      inspected_native_cube_count: 2,
      coincident_group_count: 1,
      native_mutation_executed: false,
      optimization_review_plan: {
        check_count: 4, group_check_count: 4,
        native_review_executed: false,
      },
    });
    expect(readCount).toBe(1);
    expect(mutationCount).toBe(0);
    expect(service.registrySize()).toBe(0);
    expect(service.evidenceRegistrySize()).toBe(0);
  });
});

