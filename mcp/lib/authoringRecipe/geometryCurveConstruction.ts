import type {
  AuthoringRecipe,
  RecipeCubePrototype,
  RecipePattern,
  RecipeVec3,
} from "./contracts";
import type { GeometryCurveObservation } from "./geometryCurves";
import { isNativePlanarCubeSpan, reviewGeometryCurveObservations } from "./geometryCurves";
import { planRecipeFeatureRepresentations } from "./featureDecision";
import { compileAuthoringRecipe } from "./compiler";
import {
  requireBoxUvRepresentableSpan,
  validateCubeGeometrySpan,
} from "@/lib/geometry/cubeSpan";

const EPSILON = 1e-7;
const DEGREES = 180 / Math.PI;

/**
 * Opt-in source-only construction of Bedrock Cube Recipe candidates.
 * Centerline coordinates are supplied, never guessed from a reference image.
 * Native mutation, visual approval and Bone construction remain separate.
 */
export type PlanarCurveConstructionSummary = {
  state: "SOURCE_COMPILED_NATIVE_UNVERIFIED";
  feature_id: string;
  source_claim_ids: string[];
  segment_count: number;
  construction: "SINGLE_CUBOID" | "SEGMENTED_CUBOIDS";
  complexity_escalation_review: boolean;
  rig_review_required: boolean;
  preserved_other_features: true;
  reference_content_attested: false;
  native_mutation_executed: false;
  visual_verdict: "NOT_EVALUATED";
};

type Sample = GeometryCurveObservation["samples"][number];
type CurveSegment = { start: Sample; end: Sample };

function planSegment(segment: CurveSegment, patternId: string, featureId: string, index: number) {
  const { start, end } = segment;
  const delta = end.center.map((value, axis) => value - start.center[axis]!) as RecipeVec3;
  const length = Math.hypot(...delta);
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_DEGENERATE_SPAN");
  }
  const moving = [0, 1, 2].filter(axis => Math.abs(delta[axis]!) > EPSILON);
  if (!isNativePlanarCubeSpan(start.center, end.center)) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_NONPLANAR: requires verified multi-axis transforms.");
  }
  const primary = moving.reduce((best, axis) =>
    Math.abs(delta[axis]!) > Math.abs(delta[best]!) ? axis : best
  );
  const secondary = moving.find(axis => axis !== primary);
  const rotation: RecipeVec3 = [0, 0, 0];
  if (secondary !== undefined) {
    if (primary === 0 && secondary === 1) rotation[2] = Math.atan(delta[1] / delta[0]) * DEGREES;
    else if (primary === 1 && secondary === 0) rotation[2] = -Math.atan(delta[0] / delta[1]) * DEGREES;
    else if (primary === 0 && secondary === 2) rotation[1] = -Math.atan(delta[2] / delta[0]) * DEGREES;
    else if (primary === 2 && secondary === 0) rotation[1] = Math.atan(delta[0] / delta[2]) * DEGREES;
    else if (primary === 1 && secondary === 2) rotation[0] = Math.atan(delta[2] / delta[1]) * DEGREES;
    else if (primary === 2 && secondary === 1) rotation[0] = -Math.atan(delta[1] / delta[2]) * DEGREES;
  }
  const transverse = [0, 1, 2].filter(axis => axis !== primary);
  // Deliberate voxel stepping: a Cube cannot taper continuously at both ends.
  const width = (start.cross_section[0] + end.cross_section[0]) / 2;
  const depth = (start.cross_section[1] + end.cross_section[1]) / 2;
  const size: RecipeVec3 = [0, 0, 0];
  size[primary] = length;
  size[transverse[0]!] = width;
  size[transverse[1]!] = depth;
  const center = start.center.map((value, axis) =>
    value / 2 + end.center[axis]! / 2
  ) as RecipeVec3;
  const from = center.map((value, axis) => value - size[axis]! / 2) as RecipeVec3;
  const to = center.map((value, axis) => value + size[axis]! / 2) as RecipeVec3;
  validateCubeGeometrySpan(from, to, 0, patternId);
  // Recipe v1 inherits native Box UV on new Cubes; avoid fractional texel loss.
  requireBoxUvRepresentableSpan(from, to, patternId);
  if (rotation.some(value => !Number.isFinite(value) || Math.abs(value) > 45 + EPSILON)) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_ROTATION_UNSUPPORTED");
  }
  const prototype: RecipeCubePrototype = {
    id: patternId,
    name: featureId + "_segment_" + (index + 1),
    size,
    origin: size.map(value => value / 2) as RecipeVec3,
    rotation,
  };
  const pattern: RecipePattern = {
    kind: "LINEAR",
    id: patternId,
    prototype_id: patternId,
    feature_id: featureId,
    count: 1,
    axis: "Z",
    spacing: 0,
    start: from,
  };
  return { prototype, pattern };
}

/**
 * Returns an existing-schema Recipe ready for the existing plan/apply service.
 * Does not modify the caller's Recipe or Blockbench. Explicit regeneration
 * preserves matching sample-pair instance IDs and protects foreign ownership.
 */
export function buildPlanarCurveRecipeCandidate(
  recipe: AuthoringRecipe,
  observation: GeometryCurveObservation,
  options: { replace_generated?: boolean } = {}
): { next_recipe: AuthoringRecipe; summary: PlanarCurveConstructionSummary } {
  const decisions = planRecipeFeatureRepresentations(recipe.feature_intents ?? []).decisions;
  const feature = recipe.feature_intents?.find(entry => entry.id === observation.feature_id);
  if (!feature) throw new Error("RECIPE_CURVE_CONSTRUCTION_FEATURE_UNKNOWN");
  const routes = new Map(decisions.map(decision => [decision.id, decision.route] as const));
  const review = reviewGeometryCurveObservations(
    recipe.feature_intents ?? [], routes, [observation.feature_id], [observation]
  ).get(observation.feature_id)!;
  if (review.state !== "DECLARED_SOURCE_PARAMETERS_UNVERIFIED") {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_REFERENCE_REQUIRED");
  }
  if (review.intervals.some(interval => interval.direction_change_degrees > 90 + EPSILON)) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_BACKTRACK_REVIEW_REQUIRED");
  }
  const prefix = "curve:" + observation.feature_id + ":";
  const featurePatterns = recipe.patterns.filter(pattern =>
    pattern.feature_id === observation.feature_id
  );
  const hasForeign = featurePatterns.some(pattern =>
    !pattern.id.startsWith(prefix) ||
    pattern.kind !== "LINEAR" ||
    pattern.count !== 1 ||
    pattern.spacing !== 0 ||
    pattern.prototype_id !== pattern.id
  );
  if (hasForeign) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_EXISTING_FEATURE_PROTECTED");
  }
  if (featurePatterns.length && options.replace_generated !== true) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_EXPLICIT_REPLACEMENT_REQUIRED");
  }
  const oldIds = new Set(featurePatterns.map(pattern => pattern.id));
  const oldInstances = new Set([...oldIds].map(id => id + ":0"));
  if ((recipe.constraints ?? []).some(relation =>
    oldInstances.has(relation.source_instance_id) ||
    oldInstances.has(relation.target_instance_id)) ||
    (recipe.symmetry ?? []).some(relation =>
      oldInstances.has(relation.source_instance_id) ||
      oldInstances.has(relation.target_instance_id))) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_DECLARED_RELATION_PROTECTED");
  }
  if (recipe.patterns.some(pattern =>
    pattern.feature_id !== observation.feature_id &&
    (pattern.id.startsWith(prefix) || pattern.prototype_id.startsWith(prefix)))) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_FOREIGN_PATTERN_COLLISION");
  }
  const remainingPatterns = recipe.patterns.filter(pattern => !oldIds.has(pattern.id));
  const remainingPrototypes = recipe.prototypes.filter(prototype => !oldIds.has(prototype.id));
  if (remainingPatterns.some(pattern => oldIds.has(pattern.prototype_id))) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_SHARED_PROTOTYPE_PROTECTED");
  }
  const samples = observation.samples;
  const single = !review.direction_or_thickness_variation_observed &&
    review.joint_boundaries_observed === 0;
  const segments: CurveSegment[] = single
    ? [{ start: samples[0]!, end: samples[samples.length - 1]! }]
    : samples.slice(1).map((end, index) => ({ start: samples[index]!, end }));
  const planned = segments.map((segment, index) =>
    planSegment(segment, prefix + segment.start.id + ":" + segment.end.id, observation.feature_id, index)
  );
  if (new Set(planned.map(row => row.pattern.id)).size !== planned.length ||
    planned.some(row =>
      remainingPatterns.some(pattern => pattern.id === row.pattern.id) ||
      remainingPrototypes.some(prototype => prototype.id === row.prototype.id))) {
    throw new Error("RECIPE_CURVE_CONSTRUCTION_ID_COLLISION");
  }
  const next_recipe: AuthoringRecipe = {
    ...recipe,
    prototypes: [...remainingPrototypes, ...planned.map(row => row.prototype)],
    patterns: [...remainingPatterns, ...planned.map(row => row.pattern)],
  };
  compileAuthoringRecipe(next_recipe);
  return {
    next_recipe,
    summary: {
      state: "SOURCE_COMPILED_NATIVE_UNVERIFIED",
      feature_id: observation.feature_id,
      source_claim_ids: review.source_claim_ids,
      segment_count: segments.length,
      construction: single ? "SINGLE_CUBOID" : "SEGMENTED_CUBOIDS",
      complexity_escalation_review: review.complexity_escalation_review,
      rig_review_required: review.joint_boundaries_observed > 0 ||
        (feature.geometry_reasons ?? []).includes("MOTION"),
      preserved_other_features: true,
      reference_content_attested: false,
      native_mutation_executed: false,
      visual_verdict: "NOT_EVALUATED",
    },
  };
}
