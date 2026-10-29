import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";
import { indexRecipeKnowledge } from "@/lib/authoringRecipe/knowledge";
import {
  selectKnowledgeSections,
  type KnowledgeCompatibility,
  type KnowledgeIndexSnapshot,
} from "@/lib/semantic/knowledge";

export type RecipeKnowledgeSelectionOptions = {
  /** Optional bounded current-task words; user reference remains authoritative. */
  query?: string;
  compatible_with?: KnowledgeCompatibility;
  max_per_feature?: number;
  max_token_proxy?: number;
  /** Exact bounded semantic feature selection for native Recipe inspection. */
  feature_ids?: readonly string[];
};

export type RecipeKnowledgeSuggestion = {
  feature_id: string;
  feature_route: "GEOMETRY" | "TEXTURE" | "OMIT" | "REVIEW_REQUIRED";
  sections: Array<{
    section_id: string;
    section_sha256: string;
    source: string;
    heading: string;
    start_line: number;
    end_line: number;
    score: number;
  }>;
  evidence_boundary: "ADVISORY_CANDIDATES_NOT_REFERENCE_OR_VISUAL_PROOF";
};

/**
 * Context-aware on-demand retrieval through the ONE existing knowledge index.
 * It does not auto-promote feature evidence, choose a visual style, or bind
 * references without a subsequent explicit Recipe decision.
 */
export function suggestRecipeKnowledge(
  recipe: AuthoringRecipe,
  snapshot: KnowledgeIndexSnapshot,
  options: RecipeKnowledgeSelectionOptions = {}
): RecipeKnowledgeSuggestion[] {
  const limit = options.max_per_feature ?? 3;
  const tokenBudget = options.max_token_proxy ?? 700;
  if (!Number.isInteger(limit) || limit < 1 || limit > 4 ||
      !Number.isInteger(tokenBudget) || tokenBudget < 20 || tokenBudget > 2_000 ||
      (options.query !== undefined &&
        (typeof options.query !== "string" || options.query.length > 256))) {
    throw new Error("RECIPE_KNOWLEDGE_SELECTION_BUDGET_INVALID");
  }
  const requested = options.feature_ids;
  if (requested !== undefined &&
      (!Array.isArray(requested) || requested.length > 8 ||
       requested.some(id => typeof id !== "string" || !id.trim() || id.length > 128) ||
       new Set(requested).size !== requested.length)) {
    throw new Error("RECIPE_KNOWLEDGE_SELECTION_FEATURE_SCOPE_INVALID");
  }
  const index = indexRecipeKnowledge(snapshot, options.compatible_with);
  const features = recipe.feature_intents ?? [];
  const knownIds = new Set(features.map(feature => feature.id));
  if (requested?.some(id => !knownIds.has(id))) {
    throw new Error("RECIPE_KNOWLEDGE_SELECTION_FEATURE_UNKNOWN");
  }
  const selected = requested === undefined
    ? features
    : features.filter(feature => requested.includes(feature.id));
  const decisions = planRecipeFeatureRepresentations(features).decisions;
  const routes = new Map(decisions.map(decision => [decision.id, decision.route]));
  return [...selected].sort((a,b) => a.id.localeCompare(b.id)).map(feature => {
    const query = [
      feature.label, recipe.name, (feature.geometry_reasons ?? []).join(" "),
      options.query ?? "",
    ].join(" ").slice(0, 512);
    const sections = selectKnowledgeSections({
      sections: index.eligibleSections,
      query,
      limit,
      maxTokenProxy: tokenBudget,
    }).map(section => ({
      section_id: section.id,
      section_sha256: section.sha256,
      source: section.source,
      heading: section.heading,
      start_line: section.start_line,
      end_line: section.end_line,
      score: section.score,
    }));
    return {
      feature_id: feature.id,
      feature_route: routes.get(feature.id)!,
      sections,
      evidence_boundary: "ADVISORY_CANDIDATES_NOT_REFERENCE_OR_VISUAL_PROOF" as const,
    };
  });
}
