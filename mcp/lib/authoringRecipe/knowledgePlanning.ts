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
    knowledge: resolveRecipeKnowledgeLinks(
      recipe, knowledgeIndex, options.compatible_with
    ),
    suggestions: suggestRecipeKnowledge(recipe, knowledgeIndex, options),
    execution_boundary: "SOURCE_PLANNING_ONLY_NO_NATIVE_MUTATION_OR_VISUAL_PROOF" as const,
  };
}
