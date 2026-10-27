import { CAPABILITY_CORE_MANIFEST } from "../../lib/capabilities/manifest";
import { CAPABILITY_BRANCH_MANIFEST } from "./manifest";
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


/**
 * Explicit requests for absent Runtime capabilities must not select an
 * unrelated executor through word overlap. A natural-language request may
 * use a registered alternative only when it advertises the same intent.
 * This is a filter ahead of the existing ranker, not a separate router.
 */
function containsOrderedTerms(
  haystack: readonly string[],
  phrase: readonly string[]
): boolean {
  if (phrase.length === 0 || phrase.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - phrase.length; start++) {
    if (phrase.every((term, offset) => haystack[start + offset] === term)) {
      return true;
    }
  }
  return false;
}

function toolAdvertisesIntent(
  tool: BackendTool,
  phrase: readonly string[],
  requiresMutation: boolean
): boolean {
  // A read-only inspector may discuss editing, but must not be used as a
  // substitute for an explicitly declared native mutation.
  if (requiresMutation && tool.annotations?.readOnlyHint === true) return false;
  const exactPhrase = phrase.join(" ");
  return (
    containsOrderedTerms(substantiveQueryTerms(tool.description ?? ""), phrase) ||
    getCapabilityMetadata(tool.name).searchAliases.some(
      (alias) => substantiveQueryTerms(alias).join(" ") === exactPhrase
    ) ||
    CAPABILITY_BRANCH_MANIFEST.some(
      (entry) => entry.capability === tool.name &&
        entry.semantic?.intents.some(
          (intent) => containsOrderedTerms(substantiveQueryTerms(intent), phrase)
        )
    )
  );
}

/**
 * null: ordinary search (no known unavailable intent);
 * empty set: missing explicit identity or no valid replacement;
 * nonempty set: only these active alternatives may be ranked.
 */
function alternativesForUnavailableIntent(
  tools: readonly BackendTool[],
  query: string,
  queryTerms: readonly string[]
): ReadonlySet<string> | null {
  if (queryTerms.length === 0) return null;
  const registered = new Set(tools.map((tool) => tool.name.toLowerCase()));
  const normalizedQuery = queryTerms.join(" ");
  const canonicalName = normalizedIdentifier(normalizedQuery);
  const absent = new Map<
    string,
    Array<{ phrase: readonly string[]; requiresMutation: boolean }>
  >();
  const requireIntent = (
    capability: string,
    phrase: readonly string[],
    requiresMutation = false
  ): void => {
    const entries = absent.get(capability) ?? [];
    entries.push({ phrase, requiresMutation });
    absent.set(capability, entries);
  };

  if (CAPABILITY_CORE_MANIFEST.has(canonicalName) &&
      !registered.has(canonicalName)) {
    // Literal API identifiers cannot silently become a different tool.
    if (query.trim().toLowerCase() === canonicalName) return new Set();
    requireIntent(canonicalName, queryTerms);
  }

  if (queryTerms.length >= 2) {
    for (const [capability, definition] of CAPABILITY_CORE_MANIFEST) {
      if (registered.has(capability)) continue;
      if (definition.aliases?.some((alias) => {
        const terms = substantiveQueryTerms(alias);
        return terms.length >= 2 && terms.join(" ") === normalizedQuery;
      })) requireIntent(capability, queryTerms);
    }

    for (const entry of CAPABILITY_BRANCH_MANIFEST) {
      if (registered.has(entry.capability)) continue;
      for (const intent of entry.semantic?.intents ?? []) {
        const terms = substantiveQueryTerms(intent);
        if (terms.length >= 2 && containsOrderedTerms(queryTerms, terms)) {
          requireIntent(entry.capability, terms, entry.operationClass === "MUTATION");
        }
      }
    }
  }

  if (absent.size === 0) return null;
  const requirements = [...absent.values()];
  return new Set(
    tools.filter((tool) => requirements.every((alternatives) =>
      alternatives.some(({ phrase, requiresMutation }) =>
        toolAdvertisesIntent(tool, phrase, requiresMutation)
      )
    )).map((tool) => tool.name)
  );
}


/**
 * Deleting geometry is not a Cube update, an inspector or a generic click.
 * Only apply this safety gate to explicit model-element removal requests;
 * texture, UV and animation deletion remain with their own domain owners.
 */
function requestsElementRemoval(queryTerms: readonly string[]): boolean {
  const words = new Set(queryTerms);
  const removal = ["remove", "delete", "hapus", "hapuskan"]
    .some((word) => words.has(word));
  const element = [
    "cube", "cubes", "cuboid", "kubus", "group", "grup",
    "bone", "tulang", "element", "elemen",
  ].some((word) => words.has(word));
  if (!removal || !element) return false;
  if (["texture", "tekstur", "pixel", "pixels", "uv", "animation",
      "animasi", "material"].some((word) => words.has(word))) return false;
  // "Remove from parent" can be a hierarchy change, not object deletion.
  if ((words.has("from") && (words.has("parent") || words.has("bone"))) ||
      (words.has("dari") && words.has("induk"))) return false;
  return true;
}

function advertisesElementRemoval(tool: BackendTool): boolean {
  if (tool.annotations?.readOnlyHint === true) return false;
  const definition = CAPABILITY_CORE_MANIFEST.get(tool.name);
  if (definition && definition.stage !== "geometry") return false;
  const semantics = CAPABILITY_BRANCH_MANIFEST
    .filter((entry) => entry.capability === tool.name);
  const phrases = [
    tool.name,
    ...(definition?.aliases ?? []),
    ...semantics.flatMap((entry) => [
      ...(entry.semantic?.intents ?? []),
      ...(entry.semantic?.verbs ?? []),
    ]),
    ...(!definition ? [tool.description ?? ""] : []),
  ];
  if (!phrases.some((phrase) => substantiveQueryTerms(phrase)
    .some((word) => word === "delete" || word === "remove"))) {
    return false;
  }
  // Unknown extensions must explicitly mention model elements rather than
  // getting permission merely by using a destructive verb.
  return definition !== undefined || phrases.some((phrase) =>
    ["cube", "cubes", "cuboid", "group", "bone", "element", "geometry"]
      .some((word) => substantiveQueryTerms(phrase).includes(word))
  );
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
  const queryTerms = substantiveQueryTerms(query);
  const effectiveQuery = queryTerms.join(" ");
  // A generic-only discovery query has no actionable intent and should not
  // traverse the catalog or compute ranking weights.
  if (hasQuery && effectiveQuery.length === 0) return [];
  const alternatives = alternativesForUnavailableIntent(tools, query, queryTerms);
  if (alternatives !== null && alternatives.size === 0) return [];
  const discoverableTools = alternatives === null
    ? tools
    : tools.filter((tool) => alternatives.has(tool.name));
  const elementRemoval = requestsElementRemoval(queryTerms);
  const candidateTools = elementRemoval
    ? discoverableTools.filter(advertisesElementRemoval)
    : discoverableTools;
  // Keep safety-limited action evidence at the catalog boundary, rather than
  // teaching every semantic noun that deleting means updating a Cube.
  // General synonym and branch semantics remain with the existing ranker.
  const baseTokens = capabilityQueryTokens(effectiveQuery);
  const queryTokens = elementRemoval
    ? new Set([...baseTokens, "remove"])
    : baseTokens;
  // Empty discovery lists non-maintenance capabilities without a BM25 query.
  const bm25Scores = effectiveQuery.length > 0
    ? bm25CapabilityScores(candidateTools, effectiveQuery, queryTokens)
    : new Map<string, number>();
  // Lexical relevance is a bounded secondary signal, not an intent override.
  const maxBm25 = Math.max(1, ...bm25Scores.values());

  // Only relevant, discoverable candidates need readiness/graph scoring.
  // Keep every ranked candidate's original score and safety semantics.
  return candidateTools
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
