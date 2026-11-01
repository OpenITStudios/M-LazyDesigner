import type { AuthoringRecipe, RecipeFeatureIntent } from "@/lib/authoringRecipe/contracts";
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
  type KnowledgeSection,
} from "@/lib/semantic/knowledge";

export type RecipeKnowledgeSelectionOptions = {
  /** Optional bounded current-task words; user reference remains authoritative. */
  query?: string;
  compatible_with?: KnowledgeCompatibility;
  max_per_feature?: number;
  max_token_proxy?: number;
  /** Bounded, relevance-first implicit Recipe planning; direct callers remain unchanged. */
  auto_focus_limit?: number;
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
 * Small, source-authored problem-alias fallback for an unresolved G1 case.
 * Never invents semantic facts: aliases are read only from the same
 * source/section-hash verified excerpts used for actual Recipe guidance.
 * Ambiguous aliases abstain rather than guessing a case.
 */
const PROBLEM_SIGNAL_PREFIX = "- **Problem signals:** ";
const PROBLEM_STOP_WORDS = new Set([
  "and", "are", "but", "dari", "dan", "does", "for", "from",
  "has", "have", "instead", "into", "its", "look", "looks",
  "not", "of", "only", "pada", "that", "the", "this", "too",
  "untuk", "yang", "terlalu", "tidak", "was", "were", "with",
]);

function problemWords(input: string): string[] {
  return [...new Set(
    (input.toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]+/g) ?? [])
      .filter(word => word.length >= 3 && !PROBLEM_STOP_WORDS.has(word))
  )];
}

function findUniqueProblemSignalCase(
  cases: readonly KnowledgeSection[],
  featureLabel: string,
  readExcerpt: ReturnType<typeof createRecipeKnowledgeExcerptReader>
): (KnowledgeSection & { score: number }) | null {
  const actual = new Set(problemWords(featureLabel));
  if (actual.size < 2) return null;
  const matching: Array<KnowledgeSection & { score: number }> = [];
  for (const section of cases) {
    const excerpt = readExcerpt(section); // verifies actual canonical source bytes
    if (!excerpt || excerpt.guidance_truncated) continue;
    const entries = excerpt.guidance_text.split(/\r?\n/)
      .filter(line => line.startsWith(PROBLEM_SIGNAL_PREFIX));
    if (entries.length !== 1) continue;
    const text = entries[0]!.slice(PROBLEM_SIGNAL_PREFIX.length).trim();
    if (!text || text.length > 240) continue;
    const phrases = text.split(";").map(phrase => phrase.trim());
    if (phrases.length > 5 || phrases.some(phrase => !phrase)) continue;
    const score = phrases.reduce((best, phrase) => {
      const words = problemWords(phrase);
      // Require a complete, discriminative authored phrase, not shared nouns
      // such as "sofa", "door", "texture" or "geometry" alone.
      return words.length >= 2 && words.length <= 8 &&
        words.every(word => actual.has(word))
        ? Math.max(best, words.length * 3) : best;
    }, 0);
    if (score > 0) matching.push({ ...section, score });
  }
  // Two matching problems are not one feature; require explicit scoped input.
  return matching.length === 1 ? matching[0]! : null;
}

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
        (typeof options.query !== "string" || options.query.length > 256)) ||
      (options.auto_focus_limit !== undefined &&
        (!Number.isInteger(options.auto_focus_limit) ||
         options.auto_focus_limit < 1 || options.auto_focus_limit > 8))) {
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
  // G1 title matching remains the first route, without parent-heading noise.
  // A narrowly curated problem-signal phrase may help only if no unique
  // case-title match exists. No new index, registry, tool or source authority.
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
  const decisions = planRecipeFeatureRepresentations(features).decisions;
  const routes = new Map(decisions.map(decision => [decision.id, decision.route]));

  // One source-hashed case matcher is shared by implicit priority and selected
  // guidance. This does not treat a title or source match as approved artwork.
  const caseMatches = new Map<string, (KnowledgeSection & { score: number }) | null>();
  const matchingCase = (feature: RecipeFeatureIntent) => {
    if (caseMatches.has(feature.id)) return caseMatches.get(feature.id)!;
    const titles = selectKnowledgeSections({
      sections: caseTitles, query: feature.label, limit: 8, maxTokenProxy: 8_000,
    });
    // Parent headings, generic nouns and ambiguous matches never choose a case.
    const labelTerms = new Set(problemWords(feature.label));
    const strongTitles = titles.filter(section =>
      problemWords(section.heading).filter(word => labelTerms.has(word)).length >= 2
    );
    const matchedTitle = strongTitles.length > 0 &&
      (strongTitles.length === 1 ||
        strongTitles[0]!.score > strongTitles[1]!.score)
      ? strongTitles[0]! : null;
    const matched = matchedTitle ??
      findUniqueProblemSignalCase(caseTitles, feature.label, readExcerpt);
    caseMatches.set(feature.id, matched);
    return matched;
  };

  // Only implicit Recipe planning opts in. Explicit feature IDs and existing
  // direct readers retain their semantics. Rank verified, fitting, distinct
  // cases ahead of alphabetic filler; pinned links are the strongest owner.
  // Never expand the eight-feature planning budget or read research notebooks.
  const linked = new Set((recipe.knowledge_links ?? []).map(link => link.feature_id));
  const selected = requested !== undefined
    ? features.filter(feature => requested.includes(feature.id))
    : options.auto_focus_limit === undefined ? features
    : features.map(feature => {
      const matched = matchingCase(feature);
      const excerpt = matched &&
        Number.isFinite(matched.token_proxy) &&
        matched.token_proxy >= 0 && matched.token_proxy <= tokenBudget
        ? readExcerpt(matched) : null;
      return {
        feature,
        priority: (linked.has(feature.id) ? 2 : 0) +
          (excerpt && !excerpt.guidance_truncated ? 1 : 0),
      };
    }).sort((a, b) => b.priority - a.priority ||
      a.feature.id.localeCompare(b.feature.id))
      .slice(0, options.auto_focus_limit)
      .map(entry => entry.feature);

  return [...selected].sort((a,b) => a.id.localeCompare(b.id)).map(feature => {
    const matchedCase = matchingCase(feature);
    const query = [
      feature.label, recipe.name, (feature.geometry_reasons ?? []).join(" "),
      options.query ?? "",
    ].join(" ").slice(0, 512);

    // The previous global ranking consumed slot/token budget on G1 cases
    // matched only by the shared parent heading or generic Recipe context.
    // Filtering those AFTER selection could discard a uniquely matched G1
    // case (e.g. "surface cloth markings" -> G-P03) entirely.
    //
    // Reserve at most ONE case by the feature's own title evidence FIRST,
    // then allocate the remaining budget to the ordinary workflow corpus.
    // The source index/selector and eligibility rules stay canonical.
    const selectedCase = matchedCase &&
      Number.isFinite(matchedCase.token_proxy) &&
      matchedCase.token_proxy >= 0 &&
      matchedCase.token_proxy <= tokenBudget ? [matchedCase] : [];
    const remainingLimit = limit - selectedCase.length;
    const remainingBudget = tokenBudget -
      selectedCase.reduce((sum, caseSection) => sum + caseSection.token_proxy, 0);
    const otherSections = remainingLimit > 0 && remainingBudget > 0
      ? selectKnowledgeSections({
        sections: index.eligibleSections.filter(section =>
          section.source !== RECIPE_GEOMETRY_CASE_SOURCE_PATH),
        query,
        limit: remainingLimit,
        maxTokenProxy: remainingBudget,
      })
      : [];
    const sections = [...selectedCase, ...otherSections].map(section => {
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
