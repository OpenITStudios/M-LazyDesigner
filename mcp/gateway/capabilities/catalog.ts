import {
  CAPABILITY_LIFECYCLE_SEARCH_PENALTY,
  CAPABILITY_TIER_BOOST,
  getCapabilityMetadata,
  type CapabilityTier,
} from "../../lib/capabilities/metadata";
import {
  bestSemanticMatchForTool,
  bm25CapabilityScores,
  capabilityQueryTokens,
} from "./intelligence";
import { evaluateCapabilityPreconditions } from "./graph";
import type {
  BackendTool,
  CapabilitySearchContext,
  CapabilitySummary,
} from "../contracts/protocol";

export function classifyCapabilityTier(
  tool: BackendTool
): CapabilityTier {
  return getCapabilityMetadata(tool.name).tier;
}

export function summarizeCapability(
  tool: BackendTool
): CapabilitySummary {
  return {
    capability_id: tool.name,
    description: tool.description ?? "",
    tier: classifyCapabilityTier(tool),
    read_only: tool.annotations?.readOnlyHint === true,
    destructive: tool.annotations?.destructiveHint === true,
    idempotent: tool.annotations?.idempotentHint === true,
  };
}


/**
 * Remove generic agent/tool vocabulary before semantic and BM25 discovery.
 * Preserve meaningful short authoring terms (UV, IK, 3D, UI, FX): discarding
 * them would return a false no-match before looking at the Runtime catalog.
 */
const NON_DECISIVE_QUERY_TERMS = new Set([
  "a", "an", "and", "apa", "are", "bagaimana", "can", "capability",
  "capabilities", "cara", "dan", "dengan", "developer", "do", "for",
  "how", "in", "ini", "is", "me", "of", "on", "please", "saya",
  "that", "the", "this", "to", "tolong", "tool", "tools",
  "action", "actions", "untuk", "with", "yang", "you",
]);

function substantiveQueryTerms(query: string): string[] {
  return [...new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter(
      (term) => term.length >= 2 && !NON_DECISIVE_QUERY_TERMS.has(term)
    )
  )];
}

function normalizeCapabilityQuery(query: string): string {
  return query.trim().toLowerCase();
}

function exactCapabilityMatch(
  tools: readonly BackendTool[],
  query: string
): BackendTool | null {
  const normalized = normalizeCapabilityQuery(query);
  if (!normalized) return null;
  return (
    tools.find(
      (tool) => tool.name.toLowerCase() === normalized
    ) ?? null
  );
}

function normalizedIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function singularIdentifier(value: string): string {
  return value
    .split("_")
    .map((part) =>
      part.length > 3 && part.endsWith("s")
        ? part.slice(0, -1)
        : part
    )
    .join("_");
}

function nearCapabilityNameScore(
  toolName: string,
  query: string
): number {
  const tool = normalizedIdentifier(toolName);
  const candidate = normalizedIdentifier(query);
  if (!tool || !candidate) return 0;
  if (tool === candidate) return 100;
  if (singularIdentifier(tool) === singularIdentifier(candidate)) {
    return 36;
  }
  return 0;
}

export function searchCapabilityCatalog(
  tools: readonly BackendTool[],
  query: string,
  limit: number,
  context?: CapabilitySearchContext
): CapabilitySummary[] {
  const exact = exactCapabilityMatch(tools, query);
  if (exact) return [summarizeCapability(exact)];

  const boundedLimit = Math.max(
    1,
    Math.min(50, Math.trunc(limit))
  );
  const hasQuery = normalizeCapabilityQuery(query).length > 0;
  // Ignore generic assistant/tooling words before ranking. Preserve semantic
  // examples and synonyms by feeding the same meaningful query to BOTH rankers.
  const effectiveQuery = substantiveQueryTerms(query).join(" ");
  // A generic-only discovery query has no actionable intent and should not
  // traverse the catalog or compute ranking weights.
  if (hasQuery && effectiveQuery.length === 0) return [];
  // Query expansion is shared across both ranking strategies and all tools.
  // No persistent query cache: a Runtime catalog or Stage may change at any time.
  const queryTokens = capabilityQueryTokens(effectiveQuery);
  // Empty discovery lists non-maintenance capabilities without a BM25 query.
  const bm25Scores = effectiveQuery.length > 0
    ? bm25CapabilityScores(tools, effectiveQuery, queryTokens)
    : new Map<string, number>();
  // Lexical relevance is a bounded secondary signal, not an intent override.
  const maxBm25 = Math.max(1, ...bm25Scores.values());

  // Only relevant, discoverable candidates need readiness/graph scoring.
  // Keep every ranked candidate's original score and safety semantics.
  return tools
    .map((tool) => {
      const metadata = getCapabilityMetadata(tool.name);
      const tier = metadata.tier;
      const semantic = bestSemanticMatchForTool(
        tool, effectiveQuery, context, queryTokens
      );
      const bm25 = bm25Scores.get(tool.name) ?? 0;
      const nearName = nearCapabilityNameScore(tool.name, query);
      return { tool, metadata, tier, semantic, bm25, nearName };
    })
    .filter(({ metadata, tier, semantic, bm25, nearName }) => {
      if (metadata.discoveryMode === "exact_only") return false;
      if (!hasQuery) return tier !== "maintenance";
      if (effectiveQuery.length === 0) return false;
      return semantic.matched || bm25 > 0 || nearName > 0;
    })
    .map(({ tool, metadata, tier, semantic, bm25, nearName }) => {
      const preconditions = evaluateCapabilityPreconditions(
        tool.name, semantic.branch, context?.facts
      );
      // BLOCKED/UNKNOWN are ranking signals, never silent exclusions.
      const eligibilityAdjustment =
        preconditions.eligibility === "READY" ? 4 :
        preconditions.eligibility === "BLOCKED" ? -6 : -2;
      return {
        tool,
        semantic,
        preconditions,
        score:
          semantic.score +
          (bm25 / maxBm25) * 12 +
          nearName +
          eligibilityAdjustment +
          CAPABILITY_TIER_BOOST[tier] +
          CAPABILITY_LIFECYCLE_SEARCH_PENALTY[metadata.lifecycle.stage],
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.tool.name.localeCompare(right.tool.name)
    )
    .slice(0, boundedLimit)
    .map(({ tool, semantic, preconditions }) => ({
      ...summarizeCapability(tool),
      ...(semantic.branch
        ? { branch: semantic.branch }
        : {}),
      ...(hasQuery && semantic.matched && semantic.reason
        ? { why: semantic.reason }
        : {}),
      ...(preconditions.eligibility !== "READY"
        ? {
            eligibility: preconditions.eligibility,
            ...(preconditions.missing.length > 0
              ? { requires: preconditions.missing }
              : preconditions.unknown.length > 0
                ? { requires: preconditions.unknown }
                : {}),
            ...(preconditions.predecessor
              ? { predecessor: preconditions.predecessor }
              : {}),
          }
        : {}),
    }));
}
