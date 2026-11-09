import type {
  AuthoringRecipe,
  RecipeFeatureIntent,
} from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
export type { AdvancedGeometryFeature } from "./geometrySchema";
import { buildPlanarCurveRecipeCandidate } from "./geometryCurveConstruction";
import { compileAuthoringRecipe } from "./compiler";
import { hasDeclaredPrimaryFormReason } from "./featureDecision";
import { requireGeometryBoundedRevision } from "./geometryMathVariation";
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
  // Cuboid/Repeat own one pattern; other source-owned methods emit parts.
  const isOwnedId = (id: string) =>
    feature.kind === "cuboid" || feature.kind === "repeat"
      ? id === prefix.slice(0, -1)
      : id.startsWith(prefix);
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
  ) || !unchanged(
    sortById((previous.advanced_geometry_source ?? []).filter(feature =>
      !selected.has(feature.id)
    )),
    sortById((candidate.advanced_geometry_source ?? []).filter(feature =>
      !selected.has(feature.id)
    ))
  )) {
    throw new Error("ADVANCED_GEOMETRY_UNRELATED_FEATURE_CHANGED");
  }
}

/**
 * A persisted shape parameter is useful to AI only while it still reproduces
 * the saved Recipe feature cohort. Do not silently treat source labels as
 * geometry identity after manual edits, partial imports or template changes.
 *
 * This is exact Recipe/source equivalence, NOT visual/reference approval.
 * Legacy Recipes may continue without source parameters.
 */
export function reviewStoredAdvancedGeometrySource(recipe: AuthoringRecipe): {
  state: "AVAILABLE_MATCHED_SOURCE" | "LEGACY_SOURCE_UNAVAILABLE" | "SOURCE_RECIPE_MISMATCH";
  source_features: AdvancedGeometryFeature[];
  visual_verdict: "NOT_EVALUATED";
} {
  const sources = recipe.advanced_geometry_source;
  const empty = (state:
    "LEGACY_SOURCE_UNAVAILABLE" | "SOURCE_RECIPE_MISMATCH") => ({
    state,
    source_features: [] as AdvancedGeometryFeature[],
    visual_verdict: "NOT_EVALUATED" as const,
  });
  if (!sources) return empty("LEGACY_SOURCE_UNAVAILABLE");
  try {
    if (!Array.isArray(sources) || sources.length === 0 ||
      sources.length > MAX_FEATURES ||
      new Set(sources.map(source => source.id)).size !== sources.length) {
      return empty("SOURCE_RECIPE_MISMATCH");
    }
    const expected = buildAdvancedGeometryRecipeCandidate({
      schema: recipe.schema,
      compiler_version: recipe.compiler_version,
      id: recipe.id,
      name: recipe.name,
      prototypes: [],
      patterns: [],
    }, sources).next_recipe;
    const selected = new Set(sources.map(source => source.id));
    // A persisted source cohort can legitimately be moved by explicit
    // Recipe ANCHOR constraints. Reconstruct those transformations only
    // when every endpoint belongs to this exact source-owned cohort.
    // External dependencies remain unverified rather than guessed.
    const sourceInstanceIds = new Set(
      expected.patterns.flatMap(pattern => {
        if (pattern.kind === "GRID") {
          return Array.from({ length: pattern.counts[0] * pattern.counts[1] },
            (_, index) => pattern.id + ":" + index);
        }
        return Array.from({ length: pattern.count },
          (_, index) => pattern.id + ":" + index);
      })
    );
    // Reconstruct only relationships that can affect this source cohort.
    // An unrelated feature may depend on the cohort without changing it;
    // a source-owned instance depending on an external target cannot be
    // reconstructed safely and must remain a mismatch.
    const scopedConstraints = (recipe.constraints ?? []).filter(row =>
      sourceInstanceIds.has(row.source_instance_id));
    if (scopedConstraints.some(row =>
      !sourceInstanceIds.has(row.target_instance_id))) {
      return empty("SOURCE_RECIPE_MISMATCH");
    }
    const scopedSymmetry: NonNullable<AuthoringRecipe["symmetry"]>[number][] = [];
    const selectedMirrorIds = new Set(sourceInstanceIds);
    for (const relation of recipe.symmetry ?? []) {
      if (selectedMirrorIds.has(relation.source_instance_id)) {
        scopedSymmetry.push(relation);
        selectedMirrorIds.add(relation.target_instance_id);
      } else if (selectedMirrorIds.has(relation.target_instance_id)) {
        return empty("SOURCE_RECIPE_MISMATCH");
      }
    }
    // Canonical symmetry emits targets in relation order; a later mirror may
    // depend on an earlier mirror. Validate that exact dependency order,
    // rather than assuming every source must be a primitive pattern instance.
    const generatedIds = new Set(sourceInstanceIds);
    for (const relation of scopedSymmetry) {
      if (!generatedIds.has(relation.source_instance_id) ||
          generatedIds.has(relation.target_instance_id)) {
        return empty("SOURCE_RECIPE_MISMATCH");
      }
      generatedIds.add(relation.target_instance_id);
    }
    expected.constraints = structuredClone(scopedConstraints);
    expected.symmetry = structuredClone(scopedSymmetry);
    const ownerByPattern = new Map(
      recipe.patterns.map(pattern => [pattern.id, pattern.feature_id] as const)
    );
    const sortPlacement = (value: ReturnType<typeof compileAuthoringRecipe>) =>
      value.placements.map(placement => placement)
        .sort((left, right) => left.id.localeCompare(right.id));
    const actual = sortPlacement(compileAuthoringRecipe(recipe))
      .filter(placement => selected.has(ownerByPattern.get(
        placement.source_pattern_id
      ) ?? ""));
    const expectedPlacements = sortPlacement(compileAuthoringRecipe(expected));
    const actualFeatures = (recipe.feature_intents ?? [])
      .filter(feature => selected.has(feature.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const expectedFeatures = (expected.feature_intents ?? [])
      .sort((left, right) => left.id.localeCompare(right.id));
    if (JSON.stringify(actual) !== JSON.stringify(expectedPlacements) ||
      JSON.stringify(actualFeatures) !== JSON.stringify(expectedFeatures)) {
      return empty("SOURCE_RECIPE_MISMATCH");
    }
    return {
      state: "AVAILABLE_MATCHED_SOURCE",
      source_features: structuredClone(sources),
      visual_verdict: "NOT_EVALUATED",
    };
  } catch {
    return empty("SOURCE_RECIPE_MISMATCH");
  }
}

/**
 * Native revise must be grounded in the exact persisted Advanced Geometry
 * source cohort, not just a coincident feature_intents label. A legacy Recipe
 * may remain readable/editable by its existing primitive owner, but its
 * missing shape parameters cannot authorize parametric replacement.
 *
 * Pure source gate only: native Cube identity, project state and Undo are
 * independently checked by the current Runtime transaction.
 */
export function requireStoredAdvancedGeometryRevisionSource(
  recipe: AuthoringRecipe,
  selectedFeatureIds: readonly string[]
): void {
  const review = reviewStoredAdvancedGeometrySource(recipe);
  if (review.state === "SOURCE_RECIPE_MISMATCH") {
    throw new Error(
      "ADVANCED_GEOMETRY_SAVED_SOURCE_DRIFT: do not revise until stored parameters match the Recipe."
    );
  }
  if (review.state !== "AVAILABLE_MATCHED_SOURCE") {
    throw new Error(
      "ADVANCED_GEOMETRY_SAVED_SOURCE_REQUIRED: legacy Recipe has no verified Advanced Geometry parameters."
    );
  }
  const owned = new Set(review.source_features.map(feature => feature.id));
  if (selectedFeatureIds.some(id => !owned.has(id))) {
    throw new Error(
      "ADVANCED_GEOMETRY_REVISION_FEATURE_NOT_OWNED: select an exact persisted Advanced Geometry source feature."
    );
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
  const priorShapeSources = source.advanced_geometry_source ?? [];
  if (!Array.isArray(priorShapeSources) ||
    priorShapeSources.length > MAX_FEATURES ||
    new Set(priorShapeSources.map(feature => feature.id)).size !== priorShapeSources.length) {
    throw new Error("ADVANCED_GEOMETRY_STORED_SOURCE_INVALID");
  }
  const ids = features.map(feature => requireIdentity(feature.id, "feature"));
  if (new Set(ids).size !== ids.length) {
    throw new Error("ADVANCED_GEOMETRY_FEATURE_DUPLICATE");
  }
  // Only a brand-new, empty Recipe may reorder a batch. Existing authoring
  // history and source revisions retain caller order and native ownership.
  // Explicit SILHOUETTE/VOLUME intents precede secondary 3D features; an
  // absent reason is NOT evidence of primary-form importance.
  const initialConstruction =
    source.patterns.length === 0 && source.prototypes.length === 0 &&
    priorShapeSources.length === 0;
  const orderedFeatures = initialConstruction
    ? [
        ...features.filter(feature =>
          hasDeclaredPrimaryFormReason(feature.geometry_reasons)),
        ...features.filter(feature =>
          !hasDeclaredPrimaryFormReason(feature.geometry_reasons)),
      ]
    : features;
  let next = structuredClone(source);
  const rows: AdvancedGeometrySummary["shape_families"] = [];
  for (const feature of orderedFeatures) {
    // Explicit v14 variation bounds protect already-saved feature identity.
    // Reuse the canonical Recipe revision path, not a separate solver or tool.
    requireGeometryBoundedRevision(
      priorShapeSources.find(source => source.id === feature.id),
      feature
    );
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
    // Do not compile a partial initial batch: a valid ANCHOR or SYMMETRY
    // may reference a later feature. The canonical compiler checks the
    // complete candidate once all feature cohorts exist.
    if (next.patterns.length <= before) {
      throw new Error("ADVANCED_GEOMETRY_FEATURE_SIZE_INVALID");
    }
    rows.push({
      feature_id: feature.id, kind: feature.kind,
      native_cube_candidates: 0,
      rig_review_required: (feature.geometry_reasons ?? []).includes("MOTION"),
    });
  }
  // Preserve editable source for unrelated shapes and update only the
  // requested cohorts. `replace_generated` is an invocation permission, not a
  // persisted shape parameter; never serialize it into the project source.
  const selectedShapeIds = new Set(features.map(feature => feature.id));
  const authoredShapeSources = features.map(feature => {
    const { replace_generated: _permission, ...parameters } = feature;
    return structuredClone(parameters) as AdvancedGeometryFeature;
  });
  next.advanced_geometry_source = [
    ...priorShapeSources.filter(feature => !selectedShapeIds.has(feature.id)),
    ...authoredShapeSources,
  ].sort((left, right) => left.id.localeCompare(right.id));
  const compiled = compileAuthoringRecipe(next);
  // Count realized instances only after the complete dependency graph has
  // compiled; the number can include legitimate compiler-owned symmetry.
  for (const row of rows) {
    if (row.kind === "curve") continue; // Curve builder owns its segment count.
    const patternIds = new Set(next.patterns.filter(pattern =>
      pattern.feature_id === row.feature_id).map(pattern => pattern.id));
    const count = compiled.placements.filter(placement =>
      patternIds.has(placement.source_pattern_id)).length;
    if (count < 1 || count > MAX_FEATURE_CUBES) {
      throw new Error("ADVANCED_GEOMETRY_FEATURE_SIZE_INVALID");
    }
    row.native_cube_candidates = count;
  }
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
