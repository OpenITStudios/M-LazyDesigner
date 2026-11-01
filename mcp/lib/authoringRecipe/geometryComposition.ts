import type {
  AuthoringRecipe,
  RecipeFeatureIntent,
} from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
export type { AdvancedGeometryFeature } from "./geometrySchema";
import { buildPlanarCurveRecipeCandidate } from "./geometryCurveConstruction";
import { compileAuthoringRecipe } from "./compiler";
import {
  buildGeometryShapePieces,
  requireIdentity,
  MAX_FEATURES,
  MAX_FEATURE_CUBES,
  MAX_TOTAL_CUBES,
} from "./geometryShapeBuilders";

export type AdvancedGeometrySummary = {
  scope: "SOURCE_ONLY_NOT_VISUALLY_ATTESTED";
  feature_count: number;
  instance_count: number;
  shape_families: Array<{
    feature_id: string;
    kind: AdvancedGeometryFeature["kind"];
    native_cube_candidates: number;
    rig_review_required: boolean;
  }>;
  reference_content_attested: false;
  native_mutation_executed: false;
  visual_verdict: "NOT_EVALUATED";
};

function protectCurrentFeature(
  recipe: AuthoringRecipe,
  feature: AdvancedGeometryFeature
): AuthoringRecipe {
  const prefix = feature.kind === "curve"
    ? "curve:" + feature.id + ":"
    : "shape:" + feature.kind + ":" + feature.id + ":";
  const existing = recipe.patterns.filter(pattern => pattern.feature_id === feature.id);
  const isOwnedId = (id: string) =>
    feature.kind === "curve" || feature.kind === "frame" ||
    feature.kind === "hollow_box" || feature.kind === "arch" ||
    feature.kind === "voxel_cylinder"
      ? id.startsWith(prefix)
      : id === prefix.slice(0, -1);
  if (existing.some(pattern =>
    !isOwnedId(pattern.id) ||
    (feature.kind !== "curve" && pattern.prototype_id !== pattern.id))) {
    throw new Error("ADVANCED_GEOMETRY_FOREIGN_FEATURE_PROTECTED: " + feature.id);
  }
  if (existing.length && feature.replace_generated !== true) {
    throw new Error("ADVANCED_GEOMETRY_EXPLICIT_REPLACEMENT_REQUIRED: " + feature.id);
  }
  const ids = new Set(existing.map(pattern => pattern.id));
  const instances = new Set(existing.flatMap(pattern =>
    pattern.kind === "LINEAR" ? Array.from({length: pattern.count}, (_, n) =>
      pattern.id + ":" + n) :
    pattern.kind === "GRID" ? Array.from({length: pattern.counts[0] * pattern.counts[1]}, (_, n) =>
      pattern.id + ":" + n) :
    Array.from({length: pattern.count}, (_, n) => pattern.id + ":" + n)
  ));
  if ((recipe.constraints ?? []).some(relation =>
    instances.has(relation.source_instance_id) ||
    instances.has(relation.target_instance_id)) ||
    (recipe.symmetry ?? []).some(relation =>
      instances.has(relation.source_instance_id) ||
      instances.has(relation.target_instance_id))) {
    throw new Error("ADVANCED_GEOMETRY_LINKED_FEATURE_PROTECTED: " + feature.id);
  }
  if (recipe.patterns.some(pattern =>
    pattern.feature_id !== feature.id &&
    (ids.has(pattern.prototype_id) || isOwnedId(pattern.id)))) {
    throw new Error("ADVANCED_GEOMETRY_CROSS_FEATURE_OWNER_PROTECTED");
  }
  const remainingPatterns = recipe.patterns.filter(pattern => !ids.has(pattern.id));
  const remainingPrototypes = recipe.prototypes.filter(prototype => !ids.has(prototype.id));
  const before = recipe.feature_intents ?? [];
  const prior = before.find(entry => entry.id === feature.id);
  const newFeature: RecipeFeatureIntent = {
    id: feature.id,
    label: feature.label,
    visual_role: "THREE_DIMENSIONAL",
    evidence: "SUPPORTED",
    evidence_refs: [...feature.evidence_refs],
    geometry_reasons: feature.geometry_reasons?.length
      ? [...feature.geometry_reasons] : ["VOLUME", "SILHOUETTE"],
  };
  if (prior && prior.visual_role !== "THREE_DIMENSIONAL") {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_REPRESENTATION_PROTECTED");
  }
  return {
    ...recipe,
    prototypes: remainingPrototypes,
    patterns: remainingPatterns,
    feature_intents: [...before.filter(entry => entry.id !== feature.id), newFeature],
  };
}

/**
 * Source-scope isolation for the existing Recipe plan/apply service.
 * An advanced feature command never carries permission to rewrite unrelated
 * geometry, constraints, symmetry, source bindings or saved model identity.
 */
export function requireAdvancedGeometryChangeScope(
  previous: AuthoringRecipe,
  candidate: AuthoringRecipe,
  features: readonly AdvancedGeometryFeature[]
): void {
  if (previous.id !== candidate.id ||
    previous.schema !== candidate.schema ||
    previous.compiler_version !== candidate.compiler_version ||
    previous.name !== candidate.name ||
    JSON.stringify(previous.constraints ?? []) !== JSON.stringify(candidate.constraints ?? []) ||
    JSON.stringify(previous.symmetry ?? []) !== JSON.stringify(candidate.symmetry ?? []) ||
    JSON.stringify(previous.knowledge_links ?? []) !== JSON.stringify(candidate.knowledge_links ?? [])) {
    throw new Error("ADVANCED_GEOMETRY_OUT_OF_SCOPE_RECIPE_CHANGE");
  }
  const selected = new Set(features.map(feature => feature.id));
  const sortById = <T extends {id: string}>(items: readonly T[]): T[] =>
    [...items].sort((left, right) => left.id.localeCompare(right.id));
  const owned = (recipe: AuthoringRecipe) => new Set(
    recipe.patterns.filter(pattern => selected.has(pattern.feature_id ?? ""))
      .map(pattern => pattern.prototype_id)
  );
  const previousSelectedPrototypes = owned(previous);
  const candidateSelectedPrototypes = owned(candidate);
  const unchanged = (before: unknown, after: unknown) =>
    JSON.stringify(before) === JSON.stringify(after);
  if (!unchanged(
    sortById(previous.patterns.filter(pattern => !selected.has(pattern.feature_id ?? ""))),
    sortById(candidate.patterns.filter(pattern => !selected.has(pattern.feature_id ?? "")))
  ) || !unchanged(
    sortById(previous.prototypes.filter(proto => !previousSelectedPrototypes.has(proto.id))),
    sortById(candidate.prototypes.filter(proto => !candidateSelectedPrototypes.has(proto.id)))
  ) || !unchanged(
    sortById((previous.feature_intents ?? []).filter(feature => !selected.has(feature.id))),
    sortById((candidate.feature_intents ?? []).filter(feature => !selected.has(feature.id)))
  )) {
    throw new Error("ADVANCED_GEOMETRY_UNRELATED_FEATURE_CHANGED");
  }
}

/**
 * One feature-level planner, not a new Recipe engine or Blockbench mutation
 * path. All shapes become existing Recipe v1 prototypes and patterns.
 * Previous unrelated feature structure and native identifiers are preserved.
 */
export function buildAdvancedGeometryRecipeCandidate(
  source: AuthoringRecipe,
  features: readonly AdvancedGeometryFeature[]
): { next_recipe: AuthoringRecipe; summary: AdvancedGeometrySummary } {
  if (!Array.isArray(features) || features.length < 1 || features.length > MAX_FEATURES) {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_BUDGET_INVALID");
  }
  const ids = features.map(feature => requireIdentity(feature.id, "feature"));
  if (new Set(ids).size !== ids.length) {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_DUPLICATE");
  }
  let next = structuredClone(source);
  const rows: AdvancedGeometrySummary["shape_families"] = [];
  for (const feature of features) {
    if (typeof feature.label !== "string" || !feature.label.trim() ||
      feature.label.length > 128 ||
      !Array.isArray(feature.evidence_refs) ||
      feature.evidence_refs.length < 1 || feature.evidence_refs.length > 8 ||
      feature.evidence_refs.some(ref => typeof ref !== "string" || !ref.trim())) {
      throw new Error("ADVANCED_GEOMETRY_SOURCE_OR_LABEL_REQUIRED: " + feature.id);
    }
    if (feature.kind === "curve") {
      if (feature.samples.some(sample =>
        !sample || !/^[a-zA-Z0-9_-]{1,64}$/.test(sample.id))) {
        throw new Error("ADVANCED_GEOMETRY_CURVE_SAMPLE_ID_INVALID");
      }
      // Curve owns its own exact generated-feature safety rules; feature data
      // are supplied explicitly before invoking the existing R3a constructor.
      const previous = next.feature_intents?.find(entry => entry.id === feature.id);
      const intention: RecipeFeatureIntent = {
        id: feature.id, label: feature.label, visual_role: "THREE_DIMENSIONAL",
        evidence: "SUPPORTED", evidence_refs: [...feature.evidence_refs],
        geometry_reasons: feature.geometry_reasons?.length
          ? [...feature.geometry_reasons] : ["SILHOUETTE"],
      };
      next.feature_intents = [
        ...(next.feature_intents ?? []).filter(entry => entry.id !== feature.id),
        intention,
      ];
      if (previous && previous.visual_role !== "THREE_DIMENSIONAL") {
        throw new Error("ADVANCED_GEOMETRY_FEATURE_REPRESENTATION_PROTECTED");
      }
      const result = buildPlanarCurveRecipeCandidate(next,
        { feature_id: feature.id, samples: feature.samples },
        { replace_generated: feature.replace_generated });
      next = result.next_recipe;
      rows.push({
        feature_id: feature.id, kind: "curve",
        native_cube_candidates: result.summary.segment_count,
        rig_review_required: result.summary.rig_review_required,
      });
      continue;
    }
    next = protectCurrentFeature(next, feature);
    const before = next.patterns.length;
    const pieces = buildGeometryShapePieces(feature);
    next.prototypes.push(...pieces.prototypes);
    next.patterns.push(...pieces.patterns);
    const compiled = compileAuthoringRecipe(next);
    const count = compiled.placements.filter(placement =>
      pieces.patterns.some(pattern => placement.source_pattern_id === pattern.id)
    ).length;
    if (next.patterns.length <= before || count < 1 || count > MAX_FEATURE_CUBES) {
      throw new Error("ADVANCED_GEOMETRY_FEATURE_SIZE_INVALID");
    }
    rows.push({
      feature_id: feature.id, kind: feature.kind,
      native_cube_candidates: count,
      rig_review_required: (feature.geometry_reasons ?? []).includes("MOTION"),
    });
  }
  const compiled = compileAuthoringRecipe(next);
  // Compare only newly requested feature cohorts. Other authored Cubes
  // can legitimately have coincident coordinates under distinct Bones.
  // Native parent-aware placement guards retain final authority on apply.
  const selected = new Set(features.map(feature => feature.id));
  const featureByPattern = new Map(next.patterns.map(pattern =>
    [pattern.id, pattern.feature_id] as const
  ));
  const occupied = new Set<string>();
  for (const placement of compiled.placements) {
    const owner = featureByPattern.get(placement.source_pattern_id);
    if (!owner || !selected.has(owner)) continue;
    const key = JSON.stringify([
      owner, placement.semantic_group ?? null,
      placement.from, placement.to, placement.origin,
      placement.rotation, placement.inflate,
    ]);
    if (occupied.has(key)) {
      throw new Error("ADVANCED_GEOMETRY_DUPLICATE_CUBE_PLACEMENT");
    }
    occupied.add(key);
  }
  if (compiled.placements.length > MAX_TOTAL_CUBES) {
    throw new Error("ADVANCED_GEOMETRY_TOTAL_CUBE_BUDGET_EXCEEDED");
  }
  return {
    next_recipe: next,
    summary: {
      scope: "SOURCE_ONLY_NOT_VISUALLY_ATTESTED",
      feature_count: rows.length,
      instance_count: compiled.placements.length,
      shape_families: rows,
      reference_content_attested: false,
      native_mutation_executed: false,
      visual_verdict: "NOT_EVALUATED",
    },
  };
}
