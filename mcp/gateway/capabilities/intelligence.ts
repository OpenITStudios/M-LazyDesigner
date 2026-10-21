import { classifyMcpToolPhaseByName } from "../../lib/capabilities/authoringStage";
import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import type { BackendTool } from "../contracts/protocol";
import {
  CAPABILITY_BRANCH_MANIFEST,
  type CapabilitySemanticSpec,
} from "./manifest";
import type {
  CapabilityBranchHint,
  CapabilityRoutingContext,
} from "./types";

export type {
  CapabilityBranchHint,
  CapabilityRoutingContext,
} from "./types";

export type CapabilitySemanticEntry = {
  capability: string;
  branch?: CapabilityBranchHint;
  intents: readonly string[];
  nouns?: readonly string[];
  verbs?: readonly string[];
  excludes?: readonly string[];
  examples?: readonly string[];
};

export type CapabilitySemanticMatch = {
  capability: string;
  branch?: CapabilityBranchHint;
  score: number;
  matched: boolean;
  reason: string;
};

// The branch manifest is static. Index its semantic entries once instead of
// scanning and allocating new entry objects for every catalog search/tool.
const semanticEntriesByTool = new Map<string, CapabilitySemanticEntry[]>();
for (const entry of CAPABILITY_BRANCH_MANIFEST) {
  if (!entry.semantic) continue;
  const entries = semanticEntriesByTool.get(entry.capability) ?? [];
  entries.push({
    capability: entry.capability,
    ...(entry.branch ? { branch: entry.branch } : {}),
    ...(entry.semantic as CapabilitySemanticSpec),
  });
  semanticEntriesByTool.set(entry.capability, entries);
}

function semanticEntriesForTool(name: string): readonly CapabilitySemanticEntry[] {
  return semanticEntriesByTool.get(name) ?? [];
}

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  proportions: ["size", "dimensions", "scale", "length", "width", "height", "thickness"],
  resize: ["scale", "dimensions", "proportions", "bigger", "smaller", "taller", "shorter", "wider", "narrower"],
  taller: ["resize", "lengthen", "height", "proportions"],
  shorter: ["resize", "shorten", "height", "proportions"],
  wider: ["resize", "width", "proportions"],
  narrower: ["resize", "width", "proportions"],
  move: ["position", "translate", "shift", "geser"],
  rotate: ["rotation", "turn"],
  gradient: ["shade", "blend", "transition"],
  uv: ["mapping", "unwrap", "island", "atlas", "texel"],
  animation: ["animate", "timeline", "keyframe", "motion"],
  hierarchy: ["parent", "reparent", "bone", "group"],
  under: ["parent", "reparent", "hierarchy"],
  child: ["parent", "reparent", "hierarchy"],
  inspect: ["check", "read", "measure", "find"],
  create: ["add", "make", "build", "new"],
};

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function expandedTokens(query: string): Set<string> {
  const base = normalize(query);
  const out = new Set(base);
  for (const token of base) {
    for (const synonym of SYNONYMS[token] ?? []) {
      for (const expanded of normalize(synonym)) out.add(expanded);
    }
  }
  return out;
}

function entryText(entry: CapabilitySemanticEntry): {
  intent: Set<string>;
  noun: Set<string>;
  verb: Set<string>;
  exclude: Set<string>;
  example: Set<string>;
} {
  return {
    intent: new Set(normalize(entry.intents.join(" "))),
    noun: new Set(normalize((entry.nouns ?? []).join(" "))),
    verb: new Set(normalize((entry.verbs ?? []).join(" "))),
    exclude: new Set(normalize((entry.excludes ?? []).join(" "))),
    example: new Set(normalize((entry.examples ?? []).join(" "))),
  };
}

const semanticEntryTextCache = new WeakMap<
  CapabilitySemanticEntry,
  ReturnType<typeof entryText>
>();

function cachedEntryText(entry: CapabilitySemanticEntry): ReturnType<typeof entryText> {
  const existing = semanticEntryTextCache.get(entry);
  if (existing) return existing;
  const compiled = entryText(entry);
  semanticEntryTextCache.set(entry, compiled);
  return compiled;
}

export function capabilityQueryTokens(query: string): ReadonlySet<string> {
  return expandedTokens(query);
}

function overlap(tokens: ReadonlySet<string>, field: ReadonlySet<string>, weight: number): number {
  let value = 0;
  for (const token of tokens) if (field.has(token)) value += weight;
  return value;
}

function phaseBoost(capability: string, context?: CapabilityRoutingContext): number {
  const active = context?.authoringPhase;
  if (!active) return 0;
  const phase = classifyMcpToolPhaseByName(capability);
  if (!phase || phase === "core") return 2;
  return phase === active ? 18 : -8;
}

function genericCapabilityScore(
  tool: BackendTool,
  tokens: ReadonlySet<string>
): number {
  const metadata = getCapabilityMetadata(tool.name);
  const name = new Set(normalize(tool.name.replace(/[_.\/-]+/g, " ")));
  const description = new Set(normalize(tool.description ?? ""));
  const aliases = new Set(normalize(metadata.searchAliases.join(" ")));

  let score = overlap(tokens, name, 14);
  score += overlap(tokens, aliases, 10);
  score += overlap(tokens, description, 4);
  return score;
}


function bm25Tokens(text: string): string[] {
  return normalize(text).filter((token) => token.length > 1);
}

export function bm25CapabilityScores(
  tools: readonly BackendTool[],
  query: string,
  preparedQueryTokens?: ReadonlySet<string>
): ReadonlyMap<string, number> {
  const documents = tools.map((tool) => {
    const metadata = getCapabilityMetadata(tool.name);
    return bm25Tokens([
      tool.name,
      tool.name,
      tool.description ?? "",
      metadata.searchAliases.join(" "),
    ].join(" "));
  });
  const queryTokens = [...(preparedQueryTokens ?? expandedTokens(query))];
  if (queryTokens.length === 0 || documents.length === 0) return new Map();

  const documentFrequencies = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
    }
  }

  const averageLength =
    documents.reduce((sum, tokens) => sum + tokens.length, 0) /
    Math.max(documents.length, 1);
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map<string, number>();

  tools.forEach((tool, index) => {
    const tokens = documents[index] ?? [];
    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) ?? 0;
      if (frequency === 0) continue;
      const documentFrequency = documentFrequencies.get(token) ?? 0;
      const idf = Math.log(
        1 +
          (tools.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5)
      );
      const normalization =
        1 - b + b * (tokens.length / Math.max(averageLength, 1));
      score +=
        idf *
        ((frequency * (k1 + 1)) /
          (frequency + k1 * normalization));
    }
    scores.set(tool.name, score);
  });

  return scores;
}

export function semanticMatchesForTool(
  tool: BackendTool,
  query: string,
  context?: CapabilityRoutingContext,
  preparedQueryTokens?: ReadonlySet<string>
): CapabilitySemanticMatch[] {
  const queryTokens = preparedQueryTokens ?? expandedTokens(query);
  const entries = semanticEntriesForTool(tool.name);
  // These inputs belong to the tool/query, not to each operation branch.
  const genericEvidence = genericCapabilityScore(tool, queryTokens);
  const stageAdjustment = phaseBoost(tool.name, context);

  if (entries.length === 0) {
    return [{
      capability: tool.name,
      score: genericEvidence + stageAdjustment,
      matched: genericEvidence > 0,
      reason: genericEvidence > 0 ? "capability metadata match" : "no semantic match",
    }];
  }

  return entries.map((entry) => {
    const text = cachedEntryText(entry);
    const intentEvidence = overlap(queryTokens, text.intent, 12);
    const verbEvidence = overlap(queryTokens, text.verb, 9);
    const nounEvidence = overlap(queryTokens, text.noun, 7);
    const exampleEvidence = overlap(queryTokens, text.example, 5);
    const positiveEvidence =
      genericEvidence + intentEvidence + verbEvidence + nounEvidence + exampleEvidence;
    let score = positiveEvidence;
    score -= overlap(queryTokens, text.exclude, 12);
    if (positiveEvidence > 0) score += stageAdjustment;

    const reasonParts: string[] = [];
    if (overlap(queryTokens, text.intent, 1) > 0) reasonParts.push("intent");
    if (overlap(queryTokens, text.verb, 1) > 0) reasonParts.push("action");
    if (overlap(queryTokens, text.noun, 1) > 0) reasonParts.push("object");
    if (
      positiveEvidence > 0 &&
      context?.authoringPhase &&
      stageAdjustment > 0
    ) {
      reasonParts.push("active phase");
    }

    return {
      capability: entry.capability,
      ...(entry.branch ? { branch: entry.branch } : {}),
      score,
      matched: positiveEvidence > 0,
      reason: reasonParts.length > 0 ? reasonParts.join("+") : "no semantic match",
    };
  });
}

export function bestSemanticMatchForTool(
  tool: BackendTool,
  query: string,
  context?: CapabilityRoutingContext,
  preparedQueryTokens?: ReadonlySet<string>
): CapabilitySemanticMatch {
  return semanticMatchesForTool(tool, query, context, preparedQueryTokens)
    .sort((a, b) => b.score - a.score)[0]!;
}

export function listCapabilitySemantics(): readonly CapabilitySemanticEntry[] {
  return CAPABILITY_BRANCH_MANIFEST
    .filter((entry) => entry.semantic)
    .map((entry) => ({
      capability: entry.capability,
      ...(entry.branch ? { branch: entry.branch } : {}),
      ...(entry.semantic as CapabilitySemanticSpec),
    }));
}
