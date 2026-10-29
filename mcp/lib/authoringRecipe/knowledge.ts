import type { AuthoringRecipe, RecipeKnowledgeLink } from "@/lib/authoringRecipe/contracts";
import type {
  KnowledgeCompatibility,
  KnowledgeIndexSnapshot,
  KnowledgeSection,
  KnowledgeSourceEvidence,
} from "@/lib/semantic/knowledge";

/** Opt-in source bytes belong to Recipe retrieval, never the generic index. */
export type RecipeKnowledgeSnapshot = KnowledgeIndexSnapshot & {
  source_contents?: Readonly<Record<string, string>>;
};

/**
 * Recipe is the authoring owner. This module binds existing indexed knowledge
 * to Recipe features; it does not create a second index, validation engine,
 * asset state store, or source of visual approval.
 */
export const RECIPE_KNOWLEDGE_MAX_LINKS = 256;
const HASH = /^[a-f0-9]{64}$/;

export type RecipeKnowledgeIssueReason =
  | "SECTION_MISSING"
  | "SECTION_STALE"
  | "SOURCE_PROVENANCE_MISSING"
  | "SOURCE_INCOMPATIBLE"
  | "SOURCE_STALE"
  | "UPSTREAM_REVISION_STALE"
  | "SOURCE_PROVENANCE_CHANGED";

export type RecipeKnowledgeResolution = {
  state: "NOT_BOUND" | "CURRENT_SOURCE_SNAPSHOT" | "REVIEW_REQUIRED";
  matched: Array<{
    feature_id: string;
    section_id: string;
    section_sha256: string;
    source_sha256: string;
    upstream_revision?: string;
    source: string;
    heading: string;
    source_origin: KnowledgeSourceEvidence["origin"];
  }>;
  issues: Array<{
    feature_id: string;
    section_id: string;
    reason: RecipeKnowledgeIssueReason;
  }>;
  evidence_boundary: "INDEX_METADATA_ONLY_NOT_VISUAL_OR_RUNTIME_PROOF";
};

export function validateRecipeKnowledgeLinks(recipe: AuthoringRecipe): void {
  const links = recipe.knowledge_links;
  if (links === undefined) return; // Schema-1 Recipe compatibility.
  if (!Array.isArray(links) || links.length > RECIPE_KNOWLEDGE_MAX_LINKS) {
    throw new Error("RECIPE_KNOWLEDGE_LINK_BUDGET_INVALID");
  }
  const featureIds = new Set((recipe.feature_intents ?? []).map(feature => feature.id));
  const seen = new Set<string>();
  const sectionHashes = new Map<string, string>();
  const perFeature = new Map<string, number>();
  for (const link of links) {
    if (!link || typeof link.feature_id !== "string" ||
        !featureIds.has(link.feature_id) ||
        typeof link.section_id !== "string" ||
        !link.section_id.startsWith("knowledge:") ||
        link.section_id.length > 512 ||
        typeof link.section_sha256 !== "string" ||
        !HASH.test(link.section_sha256) ||
        typeof link.source_sha256 !== "string" ||
        !HASH.test(link.source_sha256) ||
        (link.upstream_revision !== undefined &&
          (typeof link.upstream_revision !== "string" ||
           !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(link.upstream_revision)))) {
      throw new Error("RECIPE_KNOWLEDGE_LINK_INVALID");
    }
    const key = JSON.stringify([link.feature_id, link.section_id]);
    if (seen.has(key)) throw new Error("RECIPE_KNOWLEDGE_LINK_DUPLICATED");
    seen.add(key);
    const pinnedRevision = JSON.stringify([
      link.section_sha256, link.source_sha256, link.upstream_revision ?? null,
    ]);
    const existingHash = sectionHashes.get(link.section_id);
    if (existingHash && existingHash !== pinnedRevision) {
      throw new Error("RECIPE_KNOWLEDGE_LINK_CONFLICTING_REVISION");
    }
    sectionHashes.set(link.section_id, pinnedRevision);
    const count = (perFeature.get(link.feature_id) ?? 0) + 1;
    if (count > 8) throw new Error("RECIPE_KNOWLEDGE_FEATURE_BUDGET_EXCEEDED");
    perFeature.set(link.feature_id, count);
  }
}

export function isEligibleRecipeKnowledgeSource(
  source: KnowledgeSourceEvidence | undefined,
  compatibleWith?: KnowledgeCompatibility
): source is KnowledgeSourceEvidence {
  if (!source || !HASH.test(source.content_sha256) || !source.source) return false;
  if (source.origin === "REPOSITORY") return true;
  if (source.origin !== "EXTERNAL_SNAPSHOT" ||
      !compatibleWith ||
      !["MINECRAFT_BEDROCK", "BLOCKBENCH"].includes(compatibleWith.product) ||
      !/^\d+(?:\.\d+){1,3}$/.test(compatibleWith.version) ||
      !source.upstream_url.startsWith("https://") ||
      !source.upstream_revision) return false;
  return source.compatible_with?.some(version =>
    version.product === compatibleWith.product &&
    version.version === compatibleWith.version) === true;
}

export function indexRecipeKnowledge(
  snapshot: KnowledgeIndexSnapshot,
  compatibleWith?: KnowledgeCompatibility
): {
  sections: Map<string, KnowledgeSection>;
  sources: Map<string, KnowledgeSourceEvidence>;
  eligibleSections: KnowledgeSection[];
} {
  if (!snapshot || !Array.isArray(snapshot.sections) ||
      snapshot.sections.length > 50_000 ||
      (snapshot.sources !== undefined &&
        (!Array.isArray(snapshot.sources) || snapshot.sources.length > 50_000))) {
    throw new Error("RECIPE_KNOWLEDGE_INDEX_INVALID");
  }
  const sources = new Map<string, KnowledgeSourceEvidence>();
  for (const source of snapshot.sources ?? []) {
    if (!source || typeof source.source !== "string" || !source.source ||
        sources.has(source.source)) {
      throw new Error("RECIPE_KNOWLEDGE_SOURCE_DUPLICATED_OR_INVALID");
    }
    sources.set(source.source, source);
  }
  const sections = new Map<string, KnowledgeSection>();
  const eligibleSections: KnowledgeSection[] = [];
  for (const section of snapshot.sections) {
    if (!section || typeof section.id !== "string" ||
        !section.id.startsWith("knowledge:") ||
        typeof section.source !== "string" || !section.source ||
        typeof section.sha256 !== "string" || !HASH.test(section.sha256) ||
        sections.has(section.id)) {
      throw new Error("RECIPE_KNOWLEDGE_SECTION_DUPLICATED_OR_INVALID");
    }
    sections.set(section.id, section);
    if (isEligibleRecipeKnowledgeSource(sources.get(section.source), compatibleWith)) {
      eligibleSections.push(section);
    }
  }
  return { sections, sources, eligibleSections };
}

/** Source-snapshot matching is advisory, not evidence of a correct asset. */
export function resolveRecipeKnowledgeLinks(
  recipe: AuthoringRecipe,
  snapshot: KnowledgeIndexSnapshot,
  compatibleWith?: KnowledgeCompatibility
): RecipeKnowledgeResolution {
  validateRecipeKnowledgeLinks(recipe);
  const index = indexRecipeKnowledge(snapshot, compatibleWith);
  const matched: RecipeKnowledgeResolution["matched"] = [];
  const issues: RecipeKnowledgeResolution["issues"] = [];
  for (const link of recipe.knowledge_links ?? []) {
    const section = index.sections.get(link.section_id);
    const source = section ? index.sources.get(section.source) : undefined;
    const reason: RecipeKnowledgeIssueReason | null =
      !section ? "SECTION_MISSING" :
      section.sha256 !== link.section_sha256 ? "SECTION_STALE" :
      !source ? "SOURCE_PROVENANCE_MISSING" :
      !isEligibleRecipeKnowledgeSource(source, compatibleWith) ? "SOURCE_INCOMPATIBLE" :
      source.content_sha256 !== link.source_sha256 ? "SOURCE_STALE" :
      source.origin === "EXTERNAL_SNAPSHOT" &&
        source.upstream_revision !== link.upstream_revision ? "UPSTREAM_REVISION_STALE" :
      source.origin === "REPOSITORY" &&
        link.upstream_revision !== undefined ? "SOURCE_PROVENANCE_CHANGED" : null;
    if (reason) {
      issues.push({ feature_id: link.feature_id, section_id: link.section_id, reason });
    } else if (section && source) {
      matched.push({
        feature_id: link.feature_id, section_id: section.id,
        section_sha256: section.sha256, source_sha256: source.content_sha256,
        ...(source.origin === "EXTERNAL_SNAPSHOT"
          ? { upstream_revision: source.upstream_revision } : {}),
        source: section.source, heading: section.heading,
        source_origin: source.origin,
      });
    }
  }
  matched.sort((a,b) => a.feature_id.localeCompare(b.feature_id) ||
    a.section_id.localeCompare(b.section_id));
  issues.sort((a,b) => a.feature_id.localeCompare(b.feature_id) ||
    a.section_id.localeCompare(b.section_id));
  return {
    state: issues.length > 0 ? "REVIEW_REQUIRED" :
      matched.length > 0 ? "CURRENT_SOURCE_SNAPSHOT" : "NOT_BOUND",
    matched, issues,
    evidence_boundary: "INDEX_METADATA_ONLY_NOT_VISUAL_OR_RUNTIME_PROOF",
  };
}

/**
 * Explicitly pin selected sections to the Recipe. No guessed reference claims,
 * implicit native edit, or automatic persistence. A caller decides what to bind.
 */
export function bindRecipeKnowledge(
  recipe: AuthoringRecipe,
  snapshot: KnowledgeIndexSnapshot,
  selections: readonly { feature_id: string; section_id: string }[],
  compatibleWith?: KnowledgeCompatibility
): AuthoringRecipe {
  if (!Array.isArray(selections) || selections.length > RECIPE_KNOWLEDGE_MAX_LINKS) {
    throw new Error("RECIPE_KNOWLEDGE_BIND_SELECTION_INVALID");
  }
  const index = indexRecipeKnowledge(snapshot, compatibleWith);
  const featureIds = new Set((recipe.feature_intents ?? []).map(feature => feature.id));
  const links: RecipeKnowledgeLink[] = selections.map(selection => {
    if (!selection || !featureIds.has(selection.feature_id)) {
      throw new Error("RECIPE_KNOWLEDGE_BIND_FEATURE_UNKNOWN");
    }
    const section = index.sections.get(selection.section_id);
    if (!section) throw new Error("RECIPE_KNOWLEDGE_BIND_SECTION_UNKNOWN");
    const source = index.sources.get(section.source);
    if (!isEligibleRecipeKnowledgeSource(
      source, compatibleWith
    )) throw new Error("RECIPE_KNOWLEDGE_BIND_SOURCE_INELIGIBLE");
    return {
      feature_id: selection.feature_id,
      section_id: section.id,
      section_sha256: section.sha256,
      source_sha256: source.content_sha256,
      ...(source.origin === "EXTERNAL_SNAPSHOT"
        ? { upstream_revision: source.upstream_revision } : {}),
    };
  });
  const next = structuredClone(recipe);
  if (links.length > 0) {
    next.knowledge_links = links.sort((a,b) =>
      a.feature_id.localeCompare(b.feature_id) ||
      a.section_id.localeCompare(b.section_id));
  } else {
    delete next.knowledge_links;
  }
  validateRecipeKnowledgeLinks(next);
  return next;
}
