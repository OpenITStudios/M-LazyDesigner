import type {
  AuthoringRecipe,
  RecipeFeatureRoute,
  RecipeGeometryReason,
} from "@/lib/authoringRecipe/contracts";
import {
  RECIPE_GEOMETRY_CASE_SOURCE_PATH,
  type RecipeKnowledgeResolution,
  type RecipeKnowledgeSnapshot,
} from "@/lib/authoringRecipe/knowledge";
import type { RecipeKnowledgeSuggestion } from "@/lib/authoringRecipe/knowledgeSelection";

const MAX_FEATURE_PROPOSALS = 8;
const MAX_CASE_OPTIONS = 3;

/**
 * R1 is an explanation before a candidate Recipe is compiled, NOT a geometry
 * generator. Fields are extracted from an exact, already hash-verified G1 case.
 * They are never interpreted as executable commands or as reference evidence.
 */
export type GeometryConstructionProposal = {
  feature_id: string;
  feature_route: RecipeFeatureRoute;
  /** Supplied by the authoring caller; not independently image-attested. */
  reference_claim_ids: string[];
  knowledge: Array<{
    section_id: string;
    section_sha256: string;
    source_sha256: string;
    usage: "ADVISORY_ONLY";
  }>;
  options: Array<{
    strategy: string;
    contribution: RecipeGeometryReason[];
    apply_when: string[];
    reject_when: string[];
    missing_evidence: string[];
    recipe_guidance: string[];
    visual_or_native_proof_needed: string[];
  }>;
  verdict: "PROPOSAL_ONLY" | "MORE_REFERENCE_EVIDENCE_REQUIRED";
  mutation_authorized: false;
  visual_verdict: "NOT_EVALUATED";
};

type CaseFields = {
  decision: string;
  apply: string;
  reject: string;
  recipe: string;
  proof: string;
};

function caseFields(markdown: string): CaseFields | null {
  const lines = markdown.split(/\r?\n/);
  const field = (name: string): string | null => {
    const prefix = "- **" + name + ":** ";
    const matches = lines.filter(line => line.startsWith(prefix));
    if (matches.length !== 1) return null;
    const body = matches[0]!.slice(prefix.length).trim();
    return body.length > 0 && body.length <= 600 ? body : null;
  };
  const decision = field("Decision");
  const apply = field("Apply");
  const reject = field("Reject/defer");
  const recipe = field("Recipe decision");
  const proof = field("Proof required");
  return decision && apply && reject && recipe && proof
    ? { decision, apply, reject, recipe, proof } : null;
}

/**
 * Existing Recipe feature representation remains the sole routing authority.
 * Only exact G1 repository sections with full content integrity and a unique
 * title-based feature match can contribute candidates. A stale explicit link
 * is blocked by the caller, and an explicitly linked feature cannot silently
 * switch to a different knowledge section.
 */
export function proposeGeometryConstruction(
  recipe: AuthoringRecipe,
  snapshot: RecipeKnowledgeSnapshot,
  binding: RecipeKnowledgeResolution,
  suggestions: readonly RecipeKnowledgeSuggestion[]
): GeometryConstructionProposal[] {
  if (binding.state === "REVIEW_REQUIRED") return [];
  if (suggestions.length > MAX_FEATURE_PROPOSALS) {
    throw new Error("RECIPE_GEOMETRY_PROPOSAL_FEATURE_BUDGET_EXCEEDED");
  }
  const features = new Map((recipe.feature_intents ?? []).map(
    feature => [feature.id, feature] as const
  ));
  const caseSource = typeof snapshot.source_contents?.[
    RECIPE_GEOMETRY_CASE_SOURCE_PATH
  ] === "string" ? snapshot.sources?.find(source =>
    source.source === RECIPE_GEOMETRY_CASE_SOURCE_PATH &&
    source.origin === "REPOSITORY"
  ) : undefined;
  const explicitlyBound = new Map<string, Set<string>>();
  for (const link of recipe.knowledge_links ?? []) {
    const ids = explicitlyBound.get(link.feature_id) ?? new Set<string>();
    ids.add(link.section_id);
    explicitlyBound.set(link.feature_id, ids);
  }
  const matched = new Set(binding.matched.map(
    link => JSON.stringify([link.feature_id, link.section_id])
  ));

  return suggestions.flatMap((suggestion): GeometryConstructionProposal[] => {
    const feature = features.get(suggestion.feature_id);
    if (!feature || feature.visual_role !== "THREE_DIMENSIONAL") return [];
    const refs = feature.evidence === "SUPPORTED"
      ? [...(feature.evidence_refs ?? [])] : [];
    const options: GeometryConstructionProposal["options"] = [];
    const knowledge: GeometryConstructionProposal["knowledge"] = [];
    const permitted = explicitlyBound.get(feature.id);

    if (caseSource) for (const section of suggestion.sections) {
      if (options.length >= MAX_CASE_OPTIONS) break;
      if (section.source !== RECIPE_GEOMETRY_CASE_SOURCE_PATH ||
          section.guidance?.guidance_source_state !==
            "CONTENT_HASH_MATCHED_NOT_VISUAL_PROOF" ||
          section.guidance.guidance_truncated ||
          !/^G-P0[1-8] /.test(section.heading) ||
          (permitted && (!permitted.has(section.section_id) ||
            !matched.has(JSON.stringify([feature.id, section.section_id]))))) {
        continue;
      }
      const fields = caseFields(section.guidance.guidance_text);
      if (!fields) continue; // Incomplete case cannot become a proposal.
      knowledge.push({
        section_id: section.section_id,
        section_sha256: section.section_sha256,
        source_sha256: caseSource.content_sha256,
        usage: "ADVISORY_ONLY",
      });
      options.push({
        strategy: section.heading,
        contribution: [...(feature.geometry_reasons ?? [])],
        apply_when: [fields.apply],
        reject_when: [fields.reject],
        // Case applicability is a separate visual question even when feature
        // evidence_refs exist; source hashes cannot attest image contents.
        missing_evidence: ["Verify on the current approved reference: " + fields.apply],
        recipe_guidance: [fields.decision, fields.recipe],
        visual_or_native_proof_needed: [fields.proof],
      });
    }

    const supported = suggestion.feature_route === "GEOMETRY" && refs.length > 0;
    return [{
      feature_id: feature.id,
      feature_route: suggestion.feature_route,
      reference_claim_ids: refs,
      knowledge,
      options,
      verdict: supported && options.length > 0
        ? "PROPOSAL_ONLY" as const
        : "MORE_REFERENCE_EVIDENCE_REQUIRED" as const,
      mutation_authorized: false as const,
      visual_verdict: "NOT_EVALUATED" as const,
    }];
  });
}
