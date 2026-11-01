import { describe, expect, test } from "bun:test";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import {
  reviewGeometryCurveObservations,
  type GeometryCurveObservation,
} from "@/lib/authoringRecipe/geometryCurves";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";
import { reviewRecipeKnowledge } from "@/lib/authoringRecipe/knowledgePlanning";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { createAuthoringRecipeService } from "@/lib/authoringRecipe/service";
import { buildPlanarCurveRecipeCandidate } from "@/lib/authoringRecipe/geometryCurveConstruction";
import { readBundledRecipeKnowledgeIndex } from "@/server/runtime/recipes/authoring/knowledgeRuntime";

function recipe(): AuthoringRecipe {
  return {
    schema: 1, compiler_version: 1, id: "curve-review", name: "Curved appendage",
    prototypes: [{ id: "mass", name: "mass", size: [2, 2, 2] }],
    patterns: [{
      kind: "LINEAR", id: "mass-pattern", prototype_id: "mass",
      count: 1, axis: "Z", spacing: 0, feature_id: "appendage",
    }],
    feature_intents: [{
      id: "appendage", label: "dragon tail", visual_role: "THREE_DIMENSIONAL",
      evidence: "SUPPORTED", evidence_refs: ["reference:side", "reference:top"],
      geometry_reasons: ["SILHOUETTE", "MOTION"],
    }],
  };
}
function sample(
  id: string,
  center: [number, number, number],
  width: number,
  ref = "reference:side",
  joint_after = false
): GeometryCurveObservation["samples"][number] {
  return {
    id, center, cross_section: [width, width], evidence_ref: ref,
    ...(joint_after ? { joint_after: true } : {}),
  };
}
function straight(): GeometryCurveObservation {
  return {
    feature_id: "appendage", samples: [
      sample("base", [0, 0, 0], 2),
      sample("middle", [0, 0, 4], 2),
      sample("tip", [0, 0, 8], 2, "reference:top"),
    ],
  };
}
function curved(): GeometryCurveObservation {
  return {
    feature_id: "appendage", samples: [
      sample("base", [0, 0, 0], 2),
      sample("bend", [0, 0, 4], 1.5),
      sample("tip", [3, 0, 7], 0.5, "reference:top"),
    ],
  };
}
function analyze(
  observation: GeometryCurveObservation,
  input = recipe()
) {
  const decisions = planRecipeFeatureRepresentations(input.feature_intents!).decisions;
  const routes = new Map(decisions.map(d => [d.id, d.route] as const));
  return reviewGeometryCurveObservations(
    input.feature_intents!, routes, ["appendage"], [observation]
  ).get("appendage")!;
}

describe("R3 explicit curved/organic strategy alternatives", () => {
  test("a straight constant section suggests one rotated rigid Cuboid, not microsegments", () => {
    const input = straight(), original = structuredClone(input);
    const result = analyze(input);
    expect(result).toMatchObject({
      feature_id: "appendage",
      state: "DECLARED_SOURCE_PARAMETERS_UNVERIFIED",
      source_claim_ids: ["reference:side", "reference:top"],
      direction_or_thickness_variation_observed: false,
      joint_boundaries_observed: 0,
      complexity_escalation_review: false,
      reference_content_attested: false,
      native_cubes_generated: false,
      visual_verdict: "NOT_EVALUATED",
    });
    expect(result.sampled_total_length).toBe(8);
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals.every(e =>
      e.direction_change_degrees === 0 && !e.cross_section_changed
    )).toBe(true);
    expect(result.alternatives.map(e => e.strategy))
      .toEqual(["SINGLE_ROTATED_CUBOID_REVIEW"]);
    expect(input).toEqual(original);
  });

  test("a bending and tapering path exposes both reviewed alternatives without Cube coordinates", () => {
    const result = analyze(curved());
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0]).toMatchObject({
      from_sample_id: "base", to_sample_id: "bend",
      length: 4, cross_section_changed: true,
    });
    expect(result.intervals[1]?.direction_change_degrees).toBeCloseTo(45);
    expect(result.intervals[1]?.cross_section_changed).toBe(true);
    expect(result.direction_or_thickness_variation_observed).toBe(true);
    expect(result.alternatives.map(e => e.strategy)).toEqual([
      "SINGLE_ROTATED_CUBOID_REVIEW",
      "SEGMENTED_CUBOIDS_REVIEW",
    ]);
    expect(result.alternatives[0]?.rationale).toContain("only an approximation");
    expect(result.alternatives[1]?.constraints).toContain(
      "Per-segment varying widths require distinct authored prototypes in Recipe v1."
    );
    expect(result.alternatives[1]?.constraints).toContain(
      "A Recipe positional ANCHOR is not a Bone hierarchy or joint pivot."
    );
    expect(result).not.toHaveProperty("cube_positions");
    expect(result.native_cubes_generated).toBe(false);
  });

  test("explicit articulation boundaries prevent a single rigid alternative", () => {
    const input = straight();
    input.samples = [
      sample("base", [0, 0, 0], 2, "reference:side", true),
      ...input.samples.slice(1),
    ];
    const result = analyze(input);
    expect(result.joint_boundaries_observed).toBe(1);
    expect(result.direction_or_thickness_variation_observed).toBe(false);
    expect(result.alternatives.map(e => e.strategy))
      .toEqual(["SEGMENTED_CUBOIDS_REVIEW"]);
    expect(result.reference_content_attested).toBe(false);
  });

  test("multiple source samples trigger complexity review, not a style Cube quota", () => {
    const input: GeometryCurveObservation = {
      feature_id: "appendage",
      samples: Array.from({ length: 5 }, (_, i) =>
        sample("p" + i, [0, i, i * 2], 2)
      ),
    };
    const result = analyze(input);
    expect(result.intervals).toHaveLength(4);
    expect(result.complexity_escalation_review).toBe(true);
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0]?.strategy).toBe("SINGLE_ROTATED_CUBOID_REVIEW");
  });

  test("missing or conflicting reference ownership refuses numerical authority", () => {
    const unknownClaim = curved();
    unknownClaim.samples = unknownClaim.samples.map(s => ({
      ...s, evidence_ref: "reference:invented",
    }));
    const invalid = analyze(unknownClaim);
    expect(invalid).toMatchObject({
      state: "REFERENCE_EVIDENCE_REQUIRED",
      intervals: [], source_claim_ids: [],
      sampled_total_length: null, alternatives: [],
      native_cubes_generated: false,
    });
    const provisional = recipe();
    provisional.feature_intents![0]!.evidence = "PROVISIONAL";
    expect(analyze(curved(), provisional).alternatives).toEqual([]);
    const conflicting = recipe();
    conflicting.feature_intents![0]!.evidence = "CONFLICTING";
    expect(analyze(curved(), conflicting).state).toBe("REFERENCE_EVIDENCE_REQUIRED");
    const texture = recipe();
    texture.feature_intents![0]!.visual_role = "SURFACE_DETAIL";
    texture.feature_intents![0]!.geometry_reasons = [];
    expect(analyze(curved(), texture).alternatives).toEqual([]);
  });

  test("degenerate and unbounded source samples fail closed without affecting other Recipes", () => {
    const base = curved();
    const fail = (observations: GeometryCurveObservation[]) =>
      reviewGeometryCurveObservations(
        recipe().feature_intents!,
        new Map([["appendage", "GEOMETRY"] as const]),
        ["appendage"], observations
      );
    const doubled: GeometryCurveObservation = {
      feature_id: "appendage", samples: [
        sample("a", [0, 0, 0], 2),
        sample("b", [0, 0, 0], 2),
      ],
    };
    expect(() => fail([doubled])).toThrow("RECIPE_CURVE_DEGENERATE_SPAN");
    const sameIds: GeometryCurveObservation = {
      feature_id: "appendage", samples: [
        sample("a", [0, 0, 0], 2), sample("a", [1, 0, 0], 2),
      ],
    };
    expect(() => fail([sameIds])).toThrow("RECIPE_CURVE_OBSERVATION_INVALID");
    const zeroWidth: GeometryCurveObservation = {
      feature_id: "appendage", samples: [
        sample("a", [0, 0, 0], 2), sample("b", [1, 0, 0], 0),
      ],
    };
    expect(() => fail([zeroWidth])).toThrow("RECIPE_CURVE_OBSERVATION_INVALID");
    const infinity = curved();
    infinity.samples = [{ ...infinity.samples[0]!, center: [Infinity, 0, 0] },
      ...infinity.samples.slice(1)];
    expect(() => fail([infinity])).toThrow("RECIPE_CURVE_OBSERVATION_INVALID");
    const lastJoint = straight();
    lastJoint.samples = [...lastJoint.samples.slice(0, -1),
      { ...lastJoint.samples.at(-1)!, joint_after: true }];
    expect(() => fail([lastJoint])).toThrow("RECIPE_CURVE_OBSERVATION_INVALID");
    expect(() => fail([base, base])).toThrow("RECIPE_CURVE_OBSERVATION_SCOPE_INVALID");
    expect(() => fail([{ ...base, feature_id: "not-selected" }]))
      .toThrow("RECIPE_CURVE_OBSERVATION_FEATURE_NOT_SELECTED");
    expect(() => fail([{ ...base, samples: Array.from({ length: 13 }, (_, i) =>
      sample("p" + i, [i, 0, 0], 1)) }]))
      .toThrow("RECIPE_CURVE_OBSERVATION_INVALID");
  });

  test("existing Recipe planning consumes explicit curve samples but never changes compiled placements", async () => {
    const input = recipe();
    const before = structuredClone(input);
    const index = readBundledRecipeKnowledgeIndex()!;
    const without = reviewRecipeKnowledge(input, index);
    expect(without.geometry_proposals[0]?.curve_review).toBeUndefined();
    const reviewed = reviewRecipeKnowledge(input, index, {
      curve_observations: [curved()],
    });
    expect(reviewed.geometry_proposals[0]?.curve_review).toMatchObject({
      state: "DECLARED_SOURCE_PARAMETERS_UNVERIFIED",
      native_cubes_generated: false,
      alternatives: [
        { strategy: "SINGLE_ROTATED_CUBOID_REVIEW" },
        { strategy: "SEGMENTED_CUBOIDS_REVIEW" },
      ],
    });
    const compiled = compileAuthoringRecipe(input);
    const native = {
      schema: 1 as const, recipe_id: input.id,
      cubes: compiled.placements.map((part, i) => ({
        uuid: "native-" + i,
        recipe_id: input.id,
        instance_id: part.id,
        name: part.name, from: part.from, to: part.to,
        origin: part.origin, rotation: part.rotation, inflate: part.inflate,
      })),
    };
    let reads = 0;
    const service = createAuthoringRecipeService({
      readOwned: () => native,
      readStoredRecipe: () => input,
      readKnowledgeIndex: () => { reads++; return index; },
      createApplyAdapter: () => { throw new Error("R3 never mutates native."); },
    });
    const plan = await service.planStored(input, [curved()]);
    expect(reads).toBe(1);
    expect(plan.recipe_knowledge?.geometry_proposals[0]?.curve_review)
      .toMatchObject({
        state: "DECLARED_SOURCE_PARAMETERS_UNVERIFIED",
        joint_boundaries_observed: 0,
        native_cubes_generated: false,
      });
    expect(plan.summary).toBeDefined();
    expect(input).toEqual(before);
    expect(compileAuthoringRecipe(input).placements).toEqual(compiled.placements);
    const ordinary = await service.plan(input, input);
    expect(ordinary.recipe_knowledge?.geometry_proposals[0]?.curve_review)
      .toBeUndefined();
  });
});


describe("R3a opt-in planar Curve to native Recipe construction", () => {
  const draft = (): AuthoringRecipe => ({
    ...recipe(), prototypes: [], patterns: [],
  });

  test("straight source samples combine into one exact Cube plan without input mutation", () => {
    const input = draft(), original = structuredClone(input);
    const result = buildPlanarCurveRecipeCandidate(input, straight());
    const placements = compileAuthoringRecipe(result.next_recipe).placements;
    expect(result.summary).toMatchObject({
      state: "SOURCE_COMPILED_NATIVE_UNVERIFIED",
      construction: "SINGLE_CUBOID", segment_count: 1,
      native_mutation_executed: false, reference_content_attested: false,
    });
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      from: [-1, -1, 0], to: [1, 1, 8], origin: [0, 0, 4],
      rotation: [0, 0, 0],
    });
    expect(input).toEqual(original);
  });

  test("planar bend and stepped taper become two concrete rotated Cuboids", () => {
    const result = buildPlanarCurveRecipeCandidate(draft(), curved());
    const placements = compileAuthoringRecipe(result.next_recipe).placements;
    expect(placements).toHaveLength(2);
    expect(placements[0]!.rotation).toEqual([0, 0, 0]);
    expect(placements[1]!.rotation.filter(v => v !== 0)).toHaveLength(1);
    expect(Math.abs(placements[1]!.rotation[1])).toBeCloseTo(45);
    expect(placements[1]!.origin).toEqual([1.5, 0, 5.5]);
    expect(result.summary.source_claim_ids).toEqual(["reference:side","reference:top"]);
    expect(result.summary.rig_review_required).toBe(true);
    expect(placements.every(p => p.to.every((v,i) => v > p.from[i]!))).toBe(true);
  });

  test("articulation retains separate segments and requires a rig review", () => {
    const observation = straight();
    observation.samples[0]!.joint_after = true;
    const result = buildPlanarCurveRecipeCandidate(draft(), observation);
    expect(result.summary.segment_count).toBe(2);
    expect(result.summary.rig_review_required).toBe(true);
  });

  test("replacement is explicit, retains sample-pair identities and preserves other features", () => {
    const initial = buildPlanarCurveRecipeCandidate(draft(), curved());
    const withOther: AuthoringRecipe = {
      ...initial.next_recipe,
      prototypes: [...initial.next_recipe.prototypes, {id:"other",name:"other",size:[2,2,2]}],
      patterns: [...initial.next_recipe.patterns, {
        kind:"LINEAR",id:"other-pattern",prototype_id:"other",count:1,
        axis:"X",spacing:0,start:[20,0,0],feature_id:"other-feature",
      }],
      feature_intents: [...initial.next_recipe.feature_intents!, {
        id:"other-feature",label:"Other structure",visual_role:"THREE_DIMENSIONAL",
        evidence:"SUPPORTED",evidence_refs:["reference:side"],geometry_reasons:["VOLUME"],
      }],
    };
    const prior = structuredClone(withOther);
    const adjusted = curved();
    adjusted.samples[1]!.center = [0,0,5];
    expect(() => buildPlanarCurveRecipeCandidate(withOther,adjusted))
      .toThrow("RECIPE_CURVE_CONSTRUCTION_EXPLICIT_REPLACEMENT_REQUIRED");
    const replaced = buildPlanarCurveRecipeCandidate(withOther, adjusted, {
      replace_generated: true,
    });
    const formerIds = withOther.patterns.slice(0,2).map(p => p.id);
    expect(replaced.next_recipe.patterns[0]!.id).toBe("other-pattern");
    expect(replaced.next_recipe.patterns.slice(1).map(p=>p.id)).toEqual(formerIds);
    expect(withOther).toEqual(prior);
    expect(compileAuthoringRecipe(replaced.next_recipe).placements).toHaveLength(3);
  });

  test("unsupported 3D, unknown claim, backtracking, and subunit Box UV reject", () => {
    const nonplanar = curved();
    nonplanar.samples[2]!.center = [3,2,7];
    expect(() => buildPlanarCurveRecipeCandidate(draft(),nonplanar))
      .toThrow("RECIPE_CURVE_CONSTRUCTION_NONPLANAR");
    const unknown = curved();
    unknown.samples[1]!.evidence_ref = "reference:unverified";
    expect(() => buildPlanarCurveRecipeCandidate(draft(),unknown))
      .toThrow("RECIPE_CURVE_CONSTRUCTION_REFERENCE_REQUIRED");
    const backtrack = straight();
    backtrack.samples[2]!.center = [0,0,1];
    expect(() => buildPlanarCurveRecipeCandidate(draft(),backtrack))
      .toThrow("RECIPE_CURVE_CONSTRUCTION_BACKTRACK_REVIEW_REQUIRED");
    const thin = curved();
    thin.samples[1]!.cross_section = [0.4,0.4];
    thin.samples[2]!.cross_section = [0.4,0.4];
    expect(() => buildPlanarCurveRecipeCandidate(draft(),thin))
      .toThrow(/sub-unit Box UV/);
  });

  test("hand-authored features and declared constraints cannot be overwritten", () => {
    expect(() => buildPlanarCurveRecipeCandidate(recipe(),curved()))
      .toThrow("RECIPE_CURVE_CONSTRUCTION_EXISTING_FEATURE_PROTECTED");
    const generated = buildPlanarCurveRecipeCandidate(draft(),curved()).next_recipe;
    const related: AuthoringRecipe = {
      ...generated,
      constraints: [{
        kind:"ANCHOR",id:"relationship",
        source_instance_id:generated.patterns[0]!.id+":0",
        target_instance_id:generated.patterns[1]!.id+":0",
        axes:["X"],source_anchor:["CENTER","CENTER","CENTER"],
        target_anchor:["CENTER","CENTER","CENTER"],
      }],
    };
    expect(() => buildPlanarCurveRecipeCandidate(related,curved(),{
      replace_generated:true,
    })).toThrow("RECIPE_CURVE_CONSTRUCTION_DECLARED_RELATION_PROTECTED");
  });

  test("existing Recipe service plans the candidate without native Undo", async () => {
    const previous: AuthoringRecipe = {
      schema:1, compiler_version:1, id:"curve-review",name:"Curved appendage",
      prototypes:[],patterns:[],feature_intents:[],
    };
    const next: AuthoringRecipe = {
      ...previous, feature_intents: structuredClone(recipe().feature_intents),
    };
    const service = createAuthoringRecipeService({
      readOwned: () => ({schema:1,recipe_id:previous.id,cubes:[]}),
      readStoredRecipe: () => previous,
      readKnowledgeIndex: () => null,
      createApplyAdapter: () => { throw new Error("Native apply not run by source test."); },
    });
    const planned = await service.planCurveConstruction(previous,next,curved());
    expect(planned.plan_id).toBeTruthy();
    expect(planned.curve_construction.segment_count).toBe(2);
    expect(planned.curve_construction.native_mutation_executed).toBe(false);
    expect(service.registrySize()).toBe(1);
    const stored = await service.planCurveConstructionStored(next,curved());
    expect(stored.curve_construction.segment_count).toBe(2);
    expect(service.registrySize()).toBe(2);
  });
});
