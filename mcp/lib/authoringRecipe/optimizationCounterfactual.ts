import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";

/**
 * The FIRST narrow source-only Geometry-reduction experiment, not a removal
 * engine or another similarity checker. The native Recipe coincidence owner
 * has already validated the exact Cube inventory, ancestry, UV, material,
 * and authored Bone animation before passing a bounded summary here.
 *
 * Only one unconstrained, non-symmetrical, zero-spaced LINEAR Recipe pattern
 * is supported. Its last instance can be omitted in a cloned Recipe without
 * moving or rewriting any retained Cube. Native visuals, controller effects,
 * export and actual safe savings remain UNKNOWN in every result.
 */
export type RecipeCoincidenceCounterfactualInput = {
  coincident_group_count: number;
  coincident_group_size: number | null;
  native_recipe_cube_count: number;
  risk_category: string | null;
  /**
   * Already-resolved exact owner UUID for the last instance of the one
   * candidate pattern. This is NOT permission to remove that native Cube.
   */
  hypothetical_removed_native_cube_uuid: string | null;
};

const SOURCE_ONLY_BOUNDARY = {
  native_mutation_executed: false as const,
  native_reduction_measured: null,
  native_removal_authorized: false as const,
  visual_verdict: "NOT_EVALUATED" as const,
  next_recipe_included: false as const,
};

export function previewRecipeCoincidenceCounterfactual(
  recipe: AuthoringRecipe,
  source: RecipeCoincidenceCounterfactualInput
) {
  const unavailable = (reason: string) => ({
    state: "NOT_PREPARED" as const,
    reason,
    simulation: null,
    ...SOURCE_ONLY_BOUNDARY,
  });

  if (source.coincident_group_count === 0) {
    return unavailable("NO_EXACT_AUTHORED_NATIVE_COINCIDENCE");
  }
  if ((recipe.constraints?.length ?? 0) > 0 ||
      (recipe.symmetry?.length ?? 0) > 0) {
    return unavailable("RECIPE_RELATIONSHIPS_REQUIRE_PRESERVATION");
  }
  if (recipe.feature_intents !== undefined) {
    return unavailable("FEATURE_SEMANTICS_REQUIRE_INDEPENDENT_REVIEW");
  }
  const pattern = recipe.patterns[0];
  if (recipe.patterns.length !== 1 || recipe.prototypes.length !== 1 ||
      !pattern || pattern.kind !== "LINEAR" || pattern.spacing !== 0 ||
      !Number.isSafeInteger(pattern.count) || pattern.count < 2) {
    return unavailable("PATTERN_OUTSIDE_NARROW_COUNTERFACTUAL_SCOPE");
  }
  if (source.coincident_group_count !== 1 ||
      source.coincident_group_size !== pattern.count ||
      source.native_recipe_cube_count !== pattern.count) {
    return unavailable("NATIVE_COINCIDENCE_DOES_NOT_COVER_PATTERN");
  }
  if (source.risk_category !== "MANUAL_VISUAL_REVIEW") {
    return unavailable(
      source.risk_category === "EVIDENCE_INCOMPLETE"
        ? "SOURCE_UV_MATERIAL_OR_ANIMATION_INCOMPLETE"
        : "OBSERVED_DIFFERENCE_OR_DEPENDENCY"
    );
  }
  if (typeof source.hypothetical_removed_native_cube_uuid !== "string" ||
      source.hypothetical_removed_native_cube_uuid.length === 0 ||
      source.hypothetical_removed_native_cube_uuid.trim() !==
        source.hypothetical_removed_native_cube_uuid) {
    return unavailable("NATIVE_COUNTERFACTUAL_TARGET_UNRESOLVED");
  }

  const draft = structuredClone(recipe);
  const draftPattern = draft.patterns[0];
  if (!draftPattern || draftPattern.kind !== "LINEAR") {
    return unavailable("PATTERN_OUTSIDE_NARROW_COUNTERFACTUAL_SCOPE");
  }
  draftPattern.count = pattern.count - 1;

  // Canonical incremental planning already compiles BOTH recipes and reports
  // exact compiled counts. Do not compile them again just for this preview.
  // This is pure: the edited draft is neither returned nor stored/applied.
  const rebuild = planIncrementalRecipeRebuild(recipe, draft);
  const expectedRemovedId = pattern.id + ":" + (pattern.count - 1);
  const expectedPreservedIds = Array.from(
    { length: pattern.count - 1 },
    (_, index) => pattern.id + ":" + index
  ).sort();
  if (rebuild.metrics.previous_cube_count !== pattern.count ||
      rebuild.metrics.next_cube_count !== pattern.count - 1 ||
      rebuild.remove_instance_ids.length !== 1 ||
      rebuild.remove_instance_ids[0] !== expectedRemovedId ||
      rebuild.upserts.length !== 0 ||
      rebuild.metadata_only_instance_ids.length !== 0 ||
      rebuild.symmetry_changed_relation_ids.length !== 0 ||
      rebuild.constraint_propagated_instance_ids.length !== 0 ||
      rebuild.preserved_instance_ids.length !== expectedPreservedIds.length ||
      rebuild.preserved_instance_ids.some(
        (id, index) => id !== expectedPreservedIds[index]
      )) {
    return unavailable("COUNTERFACTUAL_REBUILD_NOT_REMOVAL_ONLY");
  }
  return {
    state: "SOURCE_COUNTERFACTUAL_ONLY" as const,
    reason: "PURE_RECIPE_COMPILE_DELTA_NOT_NATIVE_SAVINGS",
    simulation: {
      pattern_id: pattern.id,
      pattern_kind: "LINEAR" as const,
      pattern_count_before: pattern.count,
      pattern_count_in_draft: draftPattern.count,
      compiled_recipe_cube_count_before: rebuild.metrics.previous_cube_count,
      compiled_recipe_cube_count_in_draft: rebuild.metrics.next_cube_count,
      compiled_recipe_cube_delta: rebuild.metrics.next_cube_count -
        rebuild.metrics.previous_cube_count,
      counterfactual_removed_instance_id: expectedRemovedId,
      counterfactual_removed_native_cube_uuid:
        source.hypothetical_removed_native_cube_uuid,
      source_recipe_fingerprint_before: rebuild.previous_recipe_fingerprint,
      source_recipe_fingerprint_in_draft: rebuild.next_recipe_fingerprint,
      unchanged_compiled_instance_count: rebuild.preserved_instance_ids.length,
    },
    ...SOURCE_ONLY_BOUNDARY,
  };
}
