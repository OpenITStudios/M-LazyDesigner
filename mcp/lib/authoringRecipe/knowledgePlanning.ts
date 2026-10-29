import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import type { KnowledgeIndexSnapshot } from "@/lib/semantic/knowledge";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { resolveRecipeKnowledgeLinks } from "@/lib/authoringRecipe/knowledge";
import {
  suggestRecipeKnowledge,
  type RecipeKnowledgeSelectionOptions,
} from "@/lib/authoringRecipe/knowledgeSelection";

/**
 * One Recipe planning view: compiled geometry intent plus source-bound
 * knowledge guidance. Read-only; user reference and Validation own approval.
 * This separate composition keeps the large legacy planning module unchanged.
 */
export function prepareKnowledgeAwareRecipe(
  recipe: AuthoringRecipe,
  knowledgeIndex: KnowledgeIndexSnapshot,
  options: RecipeKnowledgeSelectionOptions = {}
) {
  const compiled = compileAuthoringRecipe(recipe);
  return {
    recipe_id: compiled.recipe_id,
    compiled,
    ...reviewRecipeKnowledge(recipe, knowledgeIndex, options),
  };
}


/** Compose guidance separately from compilation; incremental planning already compiled. */
export function reviewRecipeKnowledge(
  recipe: AuthoringRecipe,
  knowledgeIndex: KnowledgeIndexSnapshot,
  options: RecipeKnowledgeSelectionOptions = {}
) {
  const featureIds = options.feature_ids ??
    [...(recipe.feature_intents ?? [])].map(feature => feature.id).sort().slice(0, 8);
  const total = recipe.feature_intents?.length ?? 0;
  return {
    knowledge: resolveRecipeKnowledgeLinks(
      recipe, knowledgeIndex, options.compatible_with
    ),
    suggestions: suggestRecipeKnowledge(recipe, knowledgeIndex, {
      max_per_feature: 2, max_token_proxy: 500,
      ...options, feature_ids: featureIds,
    }),
    total_feature_count: total,
    omitted_feature_count: Math.max(0, total - featureIds.length),
    execution_boundary: "SOURCE_PLANNING_ONLY_NO_NATIVE_MUTATION_OR_VISUAL_PROOF" as const,
  };
}

/** Exact compiled ownership including symmetry; display names never select features. */
export function featureIdForRecipeInstance(
  recipe: AuthoringRecipe,
  instanceId: string
): string | null {
  const compiled = compileAuthoringRecipe(recipe);
  const placement = compiled.placements.find(entry => entry.id === instanceId);
  if (!placement) throw new Error("RECIPE_KNOWLEDGE_INSTANCE_NOT_OWNED");
  let patternId = placement.source_pattern_id;
  if (patternId.startsWith("symmetry:")) {
    const relation = compiled.symmetry_relationships.find(
      entry => entry.target_instance_id === instanceId
    );
    const original = compiled.placements.find(
      entry => entry.id === relation?.source_instance_id
    );
    patternId = original?.source_pattern_id ?? "";
  }
  return recipe.patterns.find(pattern => pattern.id === patternId)?.feature_id ?? null;
}


/** Lazy advisory composition shared by planStored and explicit Runtime inspection. */
export async function collectRecipeKnowledge(
  recipe: AuthoringRecipe,
  readIndex: (() => Promise<KnowledgeIndexSnapshot | null> |
    KnowledgeIndexSnapshot | null) | undefined,
  featureIds?: readonly string[]
) {
  if ((recipe.feature_intents?.length ?? 0) === 0 &&
      (recipe.knowledge_links?.length ?? 0) === 0) return null;
  const snapshot = readIndex ? await readIndex() : null;
  if (snapshot === null) {
    return {
      source_state: "UNAVAILABLE" as const,
      reason: "RECIPE_KNOWLEDGE_INDEX_UNAVAILABLE" as const,
      knowledge: null,
      suggestions: [],
      execution_boundary: "SOURCE_PLANNING_ONLY_NO_NATIVE_MUTATION_OR_VISUAL_PROOF" as const,
    };
  }
  return {
    source_state: "AVAILABLE" as const,
    ...reviewRecipeKnowledge(recipe, snapshot,
      { ...(featureIds ? { feature_ids: featureIds } : {}) }),
  };
}
