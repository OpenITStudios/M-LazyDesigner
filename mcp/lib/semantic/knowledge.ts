import { createHash } from "node:crypto";
import { posix } from "node:path";

export type KnowledgeCompatibility = {
  product: "MINECRAFT_BEDROCK" | "BLOCKBENCH";
  version: string;
};

export type ExternalKnowledgeProvenance = {
  upstream_url: string;
  upstream_revision: string;
  compatible_with?: readonly KnowledgeCompatibility[];
};

export type KnowledgeSourceEvidence =
  | { origin: "REPOSITORY"; source: string; content_sha256: string }
  | ({ origin: "EXTERNAL_SNAPSHOT"; source: string; content_sha256: string } & ExternalKnowledgeProvenance);

export type KnowledgeIndexSnapshot = {
  sections: readonly KnowledgeSection[];
  sources?: readonly KnowledgeSourceEvidence[]; // absent in legacy schema-1 output
};

export type KnowledgeRevisionDelta = {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
  affected_sources: string[];
};

const exactVersion = (value: string) => /^\d+(?:\.\d+){1,3}$/.test(value);

/** Attach source-level evidence to actual Markdown bytes; no external fetch. */
export function describeKnowledgeSource(
  source: string, markdown: string, upstream?: ExternalKnowledgeProvenance
): KnowledgeSourceEvidence {
  if (!source.trim() || source.includes("\0")) throw new Error("Knowledge source path is missing.");
  const identity = { source, content_sha256: sha256(markdown) };
  if (!upstream) return { origin: "REPOSITORY", ...identity };
  let url: URL;
  try { url = new URL(upstream.upstream_url); }
  catch { throw new Error("External provenance requires HTTPS URL."); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("External provenance requires HTTPS URL without credentials.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(upstream.upstream_revision)) {
    throw new Error("External provenance requires pinned upstream revision.");
  }
  const versions = upstream.compatible_with;
  if (versions !== undefined && (
    !Array.isArray(versions) || versions.length === 0 || versions.length > 32 ||
    versions.some(v => !v || !["MINECRAFT_BEDROCK","BLOCKBENCH"].includes(v.product) ||
      typeof v.version !== "string" || !exactVersion(v.version)) ||
    new Set(versions.map(v => v.product + ":" + v.version)).size !== versions.length
  )) throw new Error("Compatibility must declare unique exact versions.");
  return {
    origin: "EXTERNAL_SNAPSHOT", ...identity,
    upstream_url: url.href, upstream_revision: upstream.upstream_revision,
    ...(versions ? { compatible_with: versions.map(v => ({ ...v })) } : {}),
  };
}

export type KnowledgeSection = {
  id: string;
  source: string;
  heading: string;
  heading_path: string[];
  level: number;
  start_line: number;
  end_line: number;
  bytes: number;
  token_proxy: number;
  search_terms: string[];
  sha256: string;
};

export type KnowledgeSelection = KnowledgeSection & {
  score: number;
};

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sectionId(source: string, headingPath: readonly string[]): string {
  const file = source
    .replaceAll("\\", "/")
    .replace(/^\.\.\//, "")
    .replace(/\.md$/i, "")
    .split("/")
    .map(slug)
    .filter(Boolean)
    .join("/");
  const path = headingPath.map(slug).filter(Boolean).join("/");
  return `knowledge:${file}${path ? `#${path}` : ""}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "when",
  "only", "then", "use", "using", "one", "not", "are", "but", "can",
  "current", "authoring", "lazydesigner",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length > 2 &&
        !STOP_WORDS.has(token)
    );
}

function searchTerms(
  headingPath: readonly string[],
  body: string,
  limit = 24
): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens(headingPath.join(" "))) {
    counts.set(token, (counts.get(token) ?? 0) + 4);
  }
  for (const token of tokens(body)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

type MarkdownFence = { marker: string; size: number };

/**
 * Share the same CommonMark-style fence boundary between knowledge sections
 * and explicit documentation links. A shorter run or a line with trailing
 * content must not end an active fence.
 */
function advanceMarkdownFence(
  line: string,
  current: MarkdownFence | null
): { fence: MarkdownFence | null; boundary: boolean } {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return { fence: current, boundary: false };
  const run = match[1]!;
  const marker = run[0]!;
  const suffix = match[2]!;
  if (current) {
    if (current.marker === marker && run.length >= current.size && suffix.trim() === "") {
      return { fence: null, boundary: true };
    }
    return { fence: current, boundary: false };
  }
  // Backtick fences cannot contain backticks in their opening info string.
  if (marker === "`" && suffix.includes("`")) {
    return { fence: null, boundary: false };
  }
  return { fence: { marker, size: run.length }, boundary: true };
}

/**
 * Parse ATX Markdown headings into addressable, content-hashed knowledge sections.
 *
 * Headings inside fenced code are ignored. Each section owns only its body up to
 * the next heading; hierarchy is carried separately in heading_path so retrieval
 * can load one exact section without retransmitting sibling content.
 */
export function indexMarkdownKnowledge(
  source: string,
  text: string
): KnowledgeSection[] {
  const lines = text.split(/\r?\n/);
  const sections: KnowledgeSection[] = [];
  const headingStack: Array<{ level: number; heading: string }> = [];
  let fence: MarkdownFence | null = null;
  const proseState: DocumentationProse = { comment: false, inlineTicks: 0 };
  let active:
    | {
        id: string;
        heading: string;
        heading_path: string[];
        level: number;
        start_line: number;
        body_start_line: number;
      }
    | null = null;

  function finish(endLineExclusive: number): void {
    if (!active) return;
    const body = lines
      .slice(active.body_start_line - 1, endLineExclusive - 1)
      .join("\n")
      .trimEnd();
    sections.push({
      id: active.id,
      source,
      heading: active.heading,
      heading_path: active.heading_path,
      level: active.level,
      start_line: active.start_line,
      end_line: Math.max(active.start_line, endLineExclusive - 1),
      bytes: byteLength(body),
      token_proxy: Math.ceil(body.length / 4),
      search_terms: searchTerms(active.heading_path, body),
      sha256: sha256(body),
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const insideNonProse = proseState.comment || proseState.inlineTicks > 0;
    if (!insideNonProse) {
      const transition = advanceMarkdownFence(line, fence);
      fence = transition.fence;
      if (transition.boundary || fence !== null) continue;
    } else if (fence !== null) {
      continue;
    }
    // Read the original heading text (including legitimate inline code),
    // but require the heading marker to be visible outside HTML comments
    // and multiline code spans. This reuses the navigation prose masker.
    const visible = documentationProse(line, proseState);
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!headingMatch || !visible.startsWith(headingMatch[1]!)) continue;

    finish(index + 1);

    const level = headingMatch[1]!.length;
    const heading = headingMatch[2]!.trim();
    while (
      headingStack.length > 0 &&
      headingStack[headingStack.length - 1]!.level >= level
    ) {
      headingStack.pop();
    }
    headingStack.push({ level, heading });
    const headingPath = headingStack.map((entry) => entry.heading);
    active = {
      id: sectionId(source, headingPath),
      heading,
      heading_path: headingPath,
      level,
      start_line: index + 1,
      body_start_line: index + 2,
    };
  }

  finish(lines.length + 1);

  const seen = new Set<string>();
  for (const section of sections) {
    if (seen.has(section.id)) {
      throw new Error(
        `Duplicate knowledge section id "${section.id}" in ${source}. Rename one heading path to make semantic ownership explicit.`
      );
    }
    seen.add(section.id);
  }
  return sections;
}

export function knowledgeIndexFingerprint(
  sections: readonly KnowledgeSection[],
  sources?: readonly KnowledgeSourceEvidence[]
): string {
  const stable = sections
    .map((section) => ({
      id: section.id,
      source: section.source,
      start_line: section.start_line,
      end_line: section.end_line,
      sha256: section.sha256,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!sources) return sha256(JSON.stringify(stable)); // original schema-1 compatibility
  const evidence = [...sources].sort((a, b) => a.source.localeCompare(b.source));
  return sha256(JSON.stringify({ sections: stable, sources: evidence }));
}

/**
 * Full checksum for metadata reused from a prior index. The existing
 * knowledgeIndexFingerprint remains the legacy identity/position checksum.
 * This is tamper-evident consistency, not source authentication.
 */
export function knowledgeIndexIntegrityFingerprint(
  sections: readonly KnowledgeSection[],
  sources?: readonly KnowledgeSourceEvidence[]
): string {
  const fields = sections.map(section => ({
    id: section.id, source: section.source, heading: section.heading,
    heading_path: section.heading_path, level: section.level,
    start_line: section.start_line, end_line: section.end_line,
    bytes: section.bytes, token_proxy: section.token_proxy,
    search_terms: section.search_terms, sha256: section.sha256,
  })).sort((a,b) => a.id.localeCompare(b.id));
  const evidence = sources ? [...sources].sort((a,b) => a.source.localeCompare(b.source)) : [];
  return sha256(JSON.stringify({schema:1,sections:fields,sources:evidence}));
}

/** Pure revision comparison; moving line numbers cannot dirty stable content. */
export function diffKnowledgeIndex(
  before: KnowledgeIndexSnapshot, after: KnowledgeIndexSnapshot
): KnowledgeRevisionDelta {
  const index = (sections: readonly KnowledgeSection[]) => {
    const indexed = new Map<string, KnowledgeSection>();
    for (const section of sections) {
      if (!section.id || !section.source || indexed.has(section.id)) {
        throw new Error("Duplicate or missing knowledge section identity.");
      }
      indexed.set(section.id, section);
    }
    return indexed;
  };
  const sourceIndex = (sources?: readonly KnowledgeSourceEvidence[]) => {
    const indexed = new Map<string, KnowledgeSourceEvidence>();
    for (const source of sources ?? []) {
      if (!source.source || indexed.has(source.source)) {
        throw new Error("Duplicate or missing knowledge source evidence.");
      }
      indexed.set(source.source, source);
    }
    return indexed;
  };
  const a = index(before.sections), b = index(after.sections);
  const previousSources = sourceIndex(before.sources);
  const nextSources = sourceIndex(after.sources);
  const semanticSource = (source?: KnowledgeSourceEvidence): string => {
    if (!source) return "UNKNOWN";
    if (source.origin === "REPOSITORY") return "REPOSITORY";
    return JSON.stringify({
      origin: source.origin, url: source.upstream_url,
      revision: source.upstream_revision,
      compatibility: (source.compatible_with ?? [])
        .map(v => v.product + ":" + v.version).sort(),
    });
  };
  const delta: KnowledgeRevisionDelta = {
    added: [], changed: [], removed: [], unchanged: [], affected_sources: [],
  };
  const affected = new Set<string>();
  for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const was = a.get(id), now = b.get(id);
    if (!was && now) { delta.added.push(id); affected.add(now.source); }
    else if (was && !now) { delta.removed.push(id); affected.add(was.source); }
    else if (was && now) {
      const provenanceChanged = before.sources !== undefined &&
        semanticSource(previousSources.get(was.source)) !==
        semanticSource(nextSources.get(now.source));
      if (was.source !== now.source || was.sha256 !== now.sha256 ||
          JSON.stringify(was.heading_path) !== JSON.stringify(now.heading_path) ||
          provenanceChanged) {
        delta.changed.push(id); affected.add(was.source); affected.add(now.source);
      } else delta.unchanged.push(id);
    }
  }
  delta.affected_sources = [...affected].sort();
  return delta;
}

export function selectKnowledgeSections(input: {
  sections: readonly KnowledgeSection[];
  query: string;
  limit?: number;
  maxTokenProxy?: number;
  compatibleWith?: KnowledgeCompatibility; // strict opt-in, unknown is excluded
  sourceEvidence?: readonly KnowledgeSourceEvidence[];
}): KnowledgeSelection[] {
  const queryTerms = new Set(tokens(input.query));
  const requestedLimit = input.limit ?? 8;
  const requestedBudget = input.maxTokenProxy ?? 1200;
  if (!Number.isFinite(requestedLimit) || !Number.isFinite(requestedBudget)) {
    return []; // Invalid external limits must not disable bounding.
  }
  const boundedLimit = Math.max(1, Math.trunc(requestedLimit));
  const budget = Math.max(1, Math.trunc(requestedBudget));
  if (input.compatibleWith && (
    !["MINECRAFT_BEDROCK", "BLOCKBENCH"].includes(input.compatibleWith.product) ||
    !exactVersion(input.compatibleWith.version)
  )) return [];
  const sources = new Map<string, KnowledgeSourceEvidence>();
  for (const evidence of input.sourceEvidence ?? []) {
    if (sources.has(evidence.source)) throw new Error("Duplicate knowledge source evidence.");
    sources.set(evidence.source, evidence);
  }

  const ranked = input.sections
    .filter(section => {
      if (!input.compatibleWith) return true;
      const evidence = sources.get(section.source);
      return evidence?.origin === "EXTERNAL_SNAPSHOT" &&
        evidence.compatible_with?.some(v =>
          v.product === input.compatibleWith!.product &&
          v.version === input.compatibleWith!.version
        ) === true;
    })
    .map((section) => {
      const headingTerms = new Set(tokens(section.heading_path.join(" ")));
      let score = 0;
      for (const term of queryTerms) {
        if (headingTerms.has(term)) score += 12;
        if (section.search_terms.includes(term)) score += 3;
      }
      return { ...section, score };
    })
    .filter((section) => section.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.token_proxy - right.token_proxy ||
        left.id.localeCompare(right.id)
    );

  const selected: KnowledgeSelection[] = [];
  let used = 0;
  for (const section of ranked) {
    if (selected.length >= boundedLimit) break;
    if (!Number.isFinite(section.token_proxy) || section.token_proxy < 0) continue;
    if (used + section.token_proxy > budget) continue;
    selected.push(section);
    used += section.token_proxy;
  }
  return selected;
}

/**
 * Direct canonical-document navigation edges. Source and target IDs are derived
 * from checked-in paths and are stable across content-only revisions. A file
 * relocation requires updating its canonical link owner.
 *
 * This is a bounded navigation graph, NOT inferred semantic dependency or
 * independent documentation authority.
 */
export type ExplicitDocumentationEdge = {
  from: string;
  to: string;
  label: string;
  from_id: string;
  to_id: string;
  line: number;
  relation: "EXPLICIT_MARKDOWN_LINK" | "EXPLICIT_OBSIDIAN_WIKILINK";
};

type DocumentationProse = { comment: boolean; inlineTicks: number };

/* Mask HTML comments and inline code while keeping original column offsets. */
function documentationProse(line: string, state: DocumentationProse): string {
  const tick = String.fromCharCode(96);
  let result = "";
  for (let i = 0; i < line.length;) {
    if (state.comment) {
      if (line.startsWith("-->", i)) { state.comment = false; result += "   "; i += 3; }
      else { result += " "; i++; }
    } else if (state.inlineTicks || line[i] === tick) {
      let run = 0;
      while (line[i + run] === tick) run++;
      if (run && !state.inlineTicks) state.inlineTicks = run;
      else if (run && state.inlineTicks === run) state.inlineTicks = 0;
      result += " ".repeat(run || 1); i += run || 1;
    } else if (line.startsWith("<!--", i)) {
      state.comment = true; result += "    "; i += 4;
    } else { result += line[i]; i++; }
  }
  return result;
}
function escapedDocumentLink(value: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

/** Exact authored navigation, never inferred ownership or import dependency. */
export function indexExplicitDocumentationEdges(
  source: string, markdown: string
): ExplicitDocumentationEdge[] {
  if (!/^docs\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.md$/.test(source) ||
      source.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Documentation router source must be a canonical docs/*.md path.");
  }
  const edges: ExplicitDocumentationEdge[] = [];
  let fence: MarkdownFence | null = null;
  const state: DocumentationProse = { comment: false, inlineTicks: 0 };
  const add = (to: string, label: string, line: number,
    relation: ExplicitDocumentationEdge["relation"]) => {
    edges.push({ from: source, to, label, line, relation,
      from_id: "document:" + source.slice(0, -3),
      to_id: "document:" + to.slice(0, -3) });
  };
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    // A marker inside an HTML comment or multiline inline code is not a fence.
    const insideNonProse = state.comment || state.inlineTicks > 0;
    if (!insideNonProse) {
      const transition = advanceMarkdownFence(line, fence);
      fence = transition.fence;
      if (transition.boundary || fence !== null || /^( {4}|\t)/.test(line)) continue;
    } else if (fence !== null) {
      continue;
    }
    const prose = documentationProse(line, state);
    for (const match of prose.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
      if (match.index === undefined || escapedDocumentLink(prose, match.index) ||
          (match.index > 0 && prose[match.index - 1] === "!")) continue;
      const href = match[2]!;
      if (href.startsWith("/") || href.startsWith("#") || href.startsWith("//") ||
          /^[a-z][a-z\d+.-]*:/i.test(href)) continue;
      const relative = href.split("#", 1)[0]!;
      if (!relative.endsWith(".md") || /[\\?%:]/.test(relative)) continue;
      const target = posix.normalize(posix.join(posix.dirname(source), relative));
      if (!/^docs\//.test(target) || target.split("/").some(part => part === "..")) continue;
      add(target, match[1]!.trim(), index + 1, "EXPLICIT_MARKDOWN_LINK");
    }
    for (const match of prose.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      if (match.index === undefined || match[1] === "!" ||
          escapedDocumentLink(prose, match.index)) continue;
      const [path, alias] = match[2]!.split("|", 2);
      const target = path!.split("#", 1)[0]!.trim();
      // Only repo-root exact paths: fuzzy Obsidian basename matching is not authority.
      if (!/^docs\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.md$/.test(target) ||
          target.split("/").some(part => part === "." || part === "..")) continue;
      add(target, alias?.trim() || target, index + 1, "EXPLICIT_OBSIDIAN_WIKILINK");
    }
  }
  return edges;
}
