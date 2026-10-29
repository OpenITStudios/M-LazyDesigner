import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";
import {
  indexRecipeKnowledge,
  RECIPE_GEOMETRY_CASE_SOURCE_PATH,
  type RecipeKnowledgeSnapshot,
} from "@/lib/authoringRecipe/knowledge";
import { createRecipeKnowledgeExcerptReader } from "@/lib/authoringRecipe/knowledgeExcerpt";
import type { GeometryCurveObservation } from "@/lib/authoringRecipe/geometryCurves";
import {
  selectKnowledgeSections,
  type KnowledgeCompatibility,
} from "@/lib/semantic/knowledge";

export type RecipeKnowledgeSelectionOptions = {
  /** Optional bounded current-task words; user reference remains authoritative. */
  query?: string;
  compatible_with?: KnowledgeCompatibility;
  max_per_feature?: number;
  max_token_proxy?: number;
  /** Exact bounded semantic feature selection for native Recipe inspection. */
  feature_ids?: readonly string[];
  /** Optional explicit curve samples from current source evidence, never inferred. */
  curve_observations?: readonly GeometryCurveObservation[];
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
    guidance?: {
      guidance_text: string;
      guidance_truncated: boolean;
      guidance_source_state: "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF";
    };
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
  snapshot: RecipeKnowledgeSnapshot,
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
  const readExcerpt = createRecipeKnowledgeExcerptReader(snapshot);
  // The G1 casebook has a shared "Geometry Decision Cases" parent heading.
  // Do not let broad context words or the parent heading pick arbitrary cases.
  // Reuse the canonical section selector on each leaf title only.
  const caseTitles = index.eligibleSections
    .filter(section => section.source === RECIPE_GEOMETRY_CASE_SOURCE_PATH)
    .map(section => ({
      ...section,
      heading_path: [section.heading],
      search_terms: [],
    }));
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
    // For the eight provisional G1 decisions, require a UNIQUE case-title
    // match to the feature's own words. A tie abstains from case guidance.
    // Other existing knowledge sources retain their original selection.
    const titles = selectKnowledgeSections({
      sections: caseTitles,
      query: feature.label,
      limit: 8,
      maxTokenProxy: 8_000,
    });
    const matchedCaseId = titles.length > 0 &&
      (titles.length === 1 || titles[0]!.score > titles[1]!.score)
      ? titles[0]!.id : null;
    const query = [
      feature.label, recipe.name, (feature.geometry_reasons ?? []).join(" "),
      options.query ?? "",
    ].join(" ").slice(0, 512);
    const sections = selectKnowledgeSections({
      sections: index.eligibleSections,
      query,
      limit,
      maxTokenProxy: tokenBudget,
    }).filter(section =>
      section.source !== RECIPE_GEOMETRY_CASE_SOURCE_PATH ||
      section.id === matchedCaseId
    ).map(section => {
      const guidance = readExcerpt(section);
      return {
        section_id: section.id,
        section_sha256: section.sha256,
        source: section.source,
        heading: section.heading,
        start_line: section.start_line,
        end_line: section.end_line,
        score: section.score,
        ...(guidance ? { guidance } : {}),
      };
    });
    return {
      feature_id: feature.id,
      feature_route: routes.get(feature.id)!,
      sections,
      evidence_boundary: "ADVISORY_CANDIDATES_NOT_REFERENCE_OR_VISUAL_PROOF" as const,
    };
  });
}
