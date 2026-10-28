import type {
  RecipeFeatureDecision,
  RecipeFeatureIntent,
  RecipeFeaturePlanSummary,
  RecipeFeatureRoute,
  RecipeGeometryReason,
  AuthoringRecipe,
  CompiledAuthoringRecipe,
} from "@/lib/authoringRecipe/contracts";

// Feature evidence is supplied by reference-aware Modelling, not inferred
// from Cube names, coordinate sizes, or any unverified visual similarity score.
const REASONS: readonly RecipeGeometryReason[] = [
  "SILHOUETTE", "VOLUME", "NEGATIVE_SPACE", "CONTACT", "LAYERING",
  "TRANSFORM", "MOTION", "TECHNICAL",
];
const ROLES = ["THREE_DIMENSIONAL", "SURFACE_DETAIL", "UNNECESSARY"] as const;
const EVIDENCE = ["SUPPORTED", "PROVISIONAL", "CONFLICTING", "UNAVAILABLE"] as const;
const MAX_FEATURES = 256;
const EXAMPLE_LIMIT = 12;

export function planRecipeFeatureRepresentations(
  features: readonly RecipeFeatureIntent[]
): { state: "ready" | "review_required"; decisions: RecipeFeatureDecision[]; summary: RecipeFeaturePlanSummary } {
  if (!Array.isArray(features) || features.length > MAX_FEATURES) {
    throw new Error("FEATURE_PLAN_BUDGET_EXCEEDED: semantic features must fit the 256-feature planning budget.");
  }
  const seen = new Set<string>();
  const decisions: RecipeFeatureDecision[] = features.map((feature) => {
    if (typeof feature.id !== "string" || !feature.id.trim() || feature.id.length > 128 ||
        typeof feature.label !== "string" || !feature.label.trim() || feature.label.length > 256) {
      throw new Error("FEATURE_IDENTITY_INVALID: feature ID and label must be non-empty and bounded.");
    }
    if (seen.has(feature.id)) {
      throw new Error("FEATURE_IDENTITY_DUPLICATED: " + feature.id);
    }
    seen.add(feature.id);
    if (!ROLES.includes(feature.visual_role) || !EVIDENCE.includes(feature.evidence)) {
      throw new Error("FEATURE_INTENT_INVALID: unknown visual role or evidence state for " + feature.id);
    }
    const refs = feature.evidence_refs ?? [];
    if (!Array.isArray(refs) || refs.length > 8 ||
        refs.some((ref) => typeof ref !== "string" ||
          !ref.trim() || ref.length > 160)) {
      throw new Error("FEATURE_EVIDENCE_REFERENCE_INVALID: " + feature.id);
    }
    const reasons = feature.geometry_reasons ?? [];
    if (!Array.isArray(reasons) ||
        reasons.some((reason) => !REASONS.includes(reason)) ||
        new Set(reasons).size !== reasons.length) {
      throw new Error("FEATURE_GEOMETRY_REASON_INVALID: " + feature.id);
    }
    let route: RecipeFeatureRoute;
    let reason: string;
    if (feature.evidence !== "SUPPORTED") {
      route = "REVIEW_REQUIRED";
      reason = "EVIDENCE_" + feature.evidence;
    } else if (refs.length === 0) {
      route = "REVIEW_REQUIRED";
      reason = "SUPPORTED_EVIDENCE_REFERENCE_MISSING";
    } else if (feature.visual_role === "THREE_DIMENSIONAL") {
      route = reasons.length > 0 ? "GEOMETRY" : "REVIEW_REQUIRED";
      reason = reasons.length > 0 ? "REQUIRED_3D_CONTRIBUTION" : "GEOMETRY_PURPOSE_UNPROVEN";
    } else if (reasons.length > 0) {
      route = "REVIEW_REQUIRED";
      reason = "THREE_DIMENSIONAL_NEED_CONFLICTS_WITH_SURFACE_OR_OMIT";
    } else if (feature.visual_role === "SURFACE_DETAIL") {
      route = "TEXTURE";
      reason = "NO_REQUIRED_3D_CONTRIBUTION";
    } else {
      route = "OMIT";
      reason = "EXPLICITLY_UNNECESSARY_FEATURE";
    }
    return {
      id: feature.id,
      label: feature.label.trim(),
      route,
      reason,
      geometry_reasons: [...reasons],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const compact = (route: RecipeFeatureRoute) => {
    const entries = decisions.filter((entry) => entry.route === route);
    return {
      count: entries.length,
      examples: entries.slice(0, EXAMPLE_LIMIT).map(({ id, label, reason }) => ({
        id, label, reason,
      })),
      examples_truncated: entries.length > EXAMPLE_LIMIT,
    };
  };
  const state = decisions.some((entry) => entry.route === "REVIEW_REQUIRED")
    ? ("review_required" as const) : ("ready" as const);
  return {
    state,
    decisions,
    summary: {
      state,
      geometry: compact("GEOMETRY"),
      texture_handoff: compact("TEXTURE"),
      omitted: compact("OMIT"),
      unresolved: compact("REVIEW_REQUIRED"),
      visual_verdict: "not_evaluated",
      note: "Feature routing requires explicit source references and 3D necessities. Source references are caller-provided and not independently checked here. Texture is a handoff, not painted pixels; no route proves visual fidelity or authorizes native deletion.",
    },
  };
}

/**
 * Review-only representation-change impact for existing Recipe-owned Cubes.
 * Feature evidence remains caller supplied. This reads compiled instances and
 * their pattern/symmetry ownership; it does not inspect Blockbench, remove
 * Cubes, paint an atlas or estimate visual fidelity/native savings.
 */
export function assessCompiledRecipeFeatureOptimization(
  recipe: AuthoringRecipe,
  compiled: CompiledAuthoringRecipe,
  proposedFeatures: readonly RecipeFeatureIntent[]
) {
  if (recipe.feature_intents === undefined) {
    throw new Error("FEATURE_OPTIMIZATION_OWNERSHIP_REQUIRED: legacy Recipe has no explicit feature evidence.");
  }
  if (!Array.isArray(proposedFeatures) || proposedFeatures.length === 0) {
    throw new Error("FEATURE_OPTIMIZATION_PROPOSALS_REQUIRED");
  }
  if (compiled.recipe_id !== recipe.id ||
      compiled.metrics.realized_cube_count !== compiled.placements.length) {
    throw new Error("FEATURE_OPTIMIZATION_COMPILED_RECIPE_MISMATCH");
  }

  const currentDecisions = new Map(
    planRecipeFeatureRepresentations(recipe.feature_intents).decisions.map(
      (entry) => [entry.id, entry] as const
    )
  );
  const proposed = planRecipeFeatureRepresentations(proposedFeatures).decisions;
  const featureByPattern = new Map(
    recipe.patterns.map((pattern) => [pattern.id, pattern.feature_id] as const)
  );
  const ownedByInstance = new Map<string, string>();
  const compiledInstanceIds = new Set(compiled.placements.map((placement) => placement.id));
  if (compiledInstanceIds.size !== compiled.placements.length) {
    throw new Error("FEATURE_OPTIMIZATION_COMPILED_INSTANCE_IDENTITY_AMBIGUOUS");
  }

  for (const placement of compiled.placements) {
    const feature = featureByPattern.get(placement.source_pattern_id);
    if (feature !== undefined) ownedByInstance.set(placement.id, feature);
  }
  // The canonical Recipe compiler emits symmetry relations in dependency
  // order. A mirrored Cube inherits source feature ownership, never a guessed
  // semantic_group or matching display name.
  for (const relation of compiled.symmetry_relationships) {
    const owner = ownedByInstance.get(relation.source_instance_id);
    if (!owner || !compiledInstanceIds.has(relation.target_instance_id) ||
        ownedByInstance.has(relation.target_instance_id)) {
      throw new Error("FEATURE_OPTIMIZATION_SYMMETRY_OWNER_UNVERIFIED");
    }
    ownedByInstance.set(relation.target_instance_id, owner);
  }
  if (ownedByInstance.size !== compiled.placements.length) {
    throw new Error("FEATURE_OPTIMIZATION_INSTANCE_OWNER_UNVERIFIED");
  }
  const instancesByFeature = new Map<string, string[]>();
  for (const placement of compiled.placements) {
    const owner = ownedByInstance.get(placement.id)!;
    const items = instancesByFeature.get(owner) ?? [];
    items.push(placement.id);
    instancesByFeature.set(owner, items);
  }

  type Action =
    | "KEEP_GEOMETRY"
    | "TEXTURE_HANDOFF_ONLY"
    | "NO_NATIVE_CHANGE"
    | "NATIVE_REMOVAL_REVIEW_REQUIRED"
    | "GEOMETRY_CREATION_REQUIRED"
    | "REFERENCE_REVIEW_REQUIRED";

  const candidates = proposed.map((decision) => {
    const current = currentDecisions.get(decision.id);
    const instanceIds = instancesByFeature.get(decision.id) ?? [];
    let action: Action;
    if (!current || decision.route === "REVIEW_REQUIRED") {
      action = "REFERENCE_REVIEW_REQUIRED";
    } else if (decision.route === "GEOMETRY") {
      action = instanceIds.length > 0 ? "KEEP_GEOMETRY" : "GEOMETRY_CREATION_REQUIRED";
    } else if (instanceIds.length > 0) {
      // Never silently convert already-authored 3D Geometry to Texture/Omit.
      action = "NATIVE_REMOVAL_REVIEW_REQUIRED";
    } else {
      action = decision.route === "TEXTURE" ? "TEXTURE_HANDOFF_ONLY" : "NO_NATIVE_CHANGE";
    }
    return {
      feature_id: decision.id,
      current_route: current?.route ?? null,
      proposed_route: decision.route,
      action,
      realized_recipe_cube_count: instanceIds.length,
      instance_id_examples: instanceIds.slice(0, 8),
      examples_truncated: instanceIds.length > 8,
      // Native presence, effect on silhouette and deletion remain unverified.
      proposed_native_cube_deletion: false as const,
    };
  });

  const reviewActions = new Set<Action>([
    "REFERENCE_REVIEW_REQUIRED",
    "NATIVE_REMOVAL_REVIEW_REQUIRED",
    "GEOMETRY_CREATION_REQUIRED",
  ]);
  const nativeDeletionCandidates = candidates.filter(
    (item) => item.action === "NATIVE_REMOVAL_REVIEW_REQUIRED"
  );
  return {
    state: candidates.some((item) => reviewActions.has(item.action))
      ? ("review_required" as const) : ("ready" as const),
    scope: "COMPILED_RECIPE_ONLY" as const,
    visual_verdict: "NOT_EVALUATED" as const,
    native_mutation_executed: false as const,
    estimated_native_cube_savings: null,
    proposal_count: candidates.length,
    review_required_count: candidates.filter(
      (item) => reviewActions.has(item.action)
    ).length,
    possible_native_removal_review_instance_count: nativeDeletionCandidates.reduce(
      (sum, item) => sum + item.realized_recipe_cube_count, 0
    ),
    candidates,
  };
}

