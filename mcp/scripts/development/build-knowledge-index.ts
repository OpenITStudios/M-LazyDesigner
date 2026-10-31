import { lstat, readFile } from "node:fs/promises";
import {
  describeKnowledgeSource, diffKnowledgeIndex, indexMarkdownKnowledge,
  knowledgeIndexFingerprint, knowledgeIndexIntegrityFingerprint, type KnowledgeIndexSnapshot,
  type KnowledgeSection, type KnowledgeSourceEvidence,
} from "../../lib/semantic/knowledge";

/** Read-only, offline maintenance inventory, not a Runtime case registry,
 * training dataset, authority to promote sources, or automatic web refresh.
 * Explicit input paths remain available for narrower or different audits.
 */
export const DEFAULT_SOURCES = [
  "prompts/bedrock_entity_workflow.md",
  "../.agents/skills/lazydesigner-modelling/SKILL.md",
  "../.agents/skills/lazydesigner-texturing/SKILL.md",
  "../.agents/skills/lazydesigner-animation/SKILL.md",
  "../docs/02-reference/art-direction.md",
  "../docs/03-authoring/modelling/decision-cases.md",
  "../docs/03-authoring/texture/decision-cases.md",
  "../docs/03-authoring/animation/knowledge-coverage.md",
] as const;

type ParsedPreviousKnowledgeIndex = KnowledgeIndexSnapshot & { integrity_verified: boolean };

export function parsePreviousKnowledgeIndex(value: unknown): ParsedPreviousKnowledgeIndex {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Previous knowledge index must be an object.");
  const report = value as Record<string, unknown>;
  if (report.schema !== 1 || report.proof_scope !== "REPO_OWNED_KNOWLEDGE_INDEX" ||
      !Array.isArray(report.sections) || report.sections.length > 50000 ||
      typeof report.fingerprint !== "string")
    throw new Error("Previous knowledge index schema is invalid.");
  const sections = report.sections as KnowledgeSection[];
  const sectionIds = new Set<string>();
  for (const s of sections) {
    if (!s || typeof s.id !== "string" || !s.id ||
        typeof s.source !== "string" || !s.source ||
        typeof s.heading !== "string" ||
        !Array.isArray(s.heading_path) || s.heading_path.length === 0 ||
        s.heading_path.length > 6 || !s.heading_path.every(h => typeof h === "string") ||
        !Number.isSafeInteger(s.level) || s.level < 1 || s.level > 6 ||
        !Number.isSafeInteger(s.bytes) || s.bytes < 0 ||
        !Number.isSafeInteger(s.token_proxy) || s.token_proxy < 0 ||
        !Array.isArray(s.search_terms) || s.search_terms.length > 24 ||
        !s.search_terms.every(term => typeof term === "string") ||
        !/^[0-9a-f]{64}$/.test(s.sha256) ||
        !Number.isSafeInteger(s.start_line) || s.start_line < 1 ||
        !Number.isSafeInteger(s.end_line) || s.end_line < s.start_line ||
        sectionIds.has(s.id))
      throw new Error("Previous knowledge index contains invalid or duplicate sections.");
    sectionIds.add(s.id);
  }
  const evidence = report.sources;
  if (evidence !== undefined && (
    !Array.isArray(evidence) || evidence.length > 50000 ||
    evidence.some((e: KnowledgeSourceEvidence) =>
      !e || typeof e.source !== "string" ||
      !/^[0-9a-f]{64}$/.test(e.content_sha256) ||
      (e.origin !== "REPOSITORY" && e.origin !== "EXTERNAL_SNAPSHOT") ||
      (e.origin === "EXTERNAL_SNAPSHOT" &&
        (typeof e.upstream_url !== "string" || typeof e.upstream_revision !== "string" ||
          (e.compatible_with !== undefined && !Array.isArray(e.compatible_with))))
    )
  )) throw new Error("Previous knowledge source provenance is malformed.");
  const sources = evidence as KnowledgeSourceEvidence[] | undefined;
  if (sources && new Set(sources.map(source => source.source)).size !== sources.length)
    throw new Error("Previous knowledge index contains duplicate source evidence.");
  if (knowledgeIndexFingerprint(sections, sources) !== report.fingerprint)
    throw new Error("Previous knowledge index fingerprint mismatch.");
  const integrity_verified = report.integrity_fingerprint !== undefined;
  if (integrity_verified && (
    typeof report.integrity_fingerprint !== "string" ||
    knowledgeIndexIntegrityFingerprint(sections, sources) !== report.integrity_fingerprint
  )) throw new Error("Previous knowledge index integrity fingerprint mismatch.");
  return { sections, ...(sources ? { sources } : {}), integrity_verified };
}

async function main() {
  const args = process.argv.slice(2);
  const position = args.indexOf("--previous");
  if (args.filter(a => a === "--previous").length > 1)
    throw new Error("Duplicate --previous option.");
  let previousPath: string | undefined;
  if (position >= 0) {
    previousPath = args[position + 1];
    if (!previousPath || previousPath.startsWith("--"))
      throw new Error("--previous requires a saved JSON index.");
    args.splice(position, 2);
  }
  if (args.some(a => a.startsWith("--"))) throw new Error("Unknown knowledge index option.");
  const inputs = args.length ? args : [...DEFAULT_SOURCES];
  if (new Set(inputs).size !== inputs.length) throw new Error("Duplicate knowledge source paths.");
  let previous: ParsedPreviousKnowledgeIndex | undefined;
  if (previousPath) {
    const stat = await lstat(previousPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 8 * 1024 * 1024)
      throw new Error("Previous index must be a bounded regular file.");
    previous = parsePreviousKnowledgeIndex(JSON.parse(await readFile(previousPath, "utf8")));
  }
  const inputsWithContent = await Promise.all(inputs.map(async source => ({
    source, markdown: await readFile(source, "utf8"),
  })));
  const sources = inputsWithContent.map(x => describeKnowledgeSource(x.source, x.markdown));
  const priorSources = new Map((previous?.sources ?? []).map(x => [x.source, x]));
  const oldSections = new Map<string, KnowledgeSection[]>();
  for (const section of previous?.sections ?? []) {
    const list = oldSections.get(section.source) ?? [];
    list.push(section);
    oldSections.set(section.source, list);
  }
  let reused_source_count = 0;
  const sections = inputsWithContent.flatMap((input, i) => {
    const evidence = sources[i]!;
    const prior = priorSources.get(input.source);
    if (previous?.integrity_verified === true &&
        prior?.origin === "REPOSITORY" &&
        prior.content_sha256 === evidence.content_sha256 &&
        oldSections.has(input.source)) {
      reused_source_count++;
      return oldSections.get(input.source) ?? [];
    }
    return indexMarkdownKnowledge(input.source, input.markdown);
  });
  const fingerprint = knowledgeIndexFingerprint(sections, sources);
  const integrity_fingerprint = knowledgeIndexIntegrityFingerprint(sections, sources);
  console.log(JSON.stringify({
    schema: 1, proof_scope: "REPO_OWNED_KNOWLEDGE_INDEX",
    fingerprint, integrity_fingerprint,
    sources, source_count: sources.length, reused_source_count,
    section_count: sections.length,
    total_bytes: sections.reduce((sum,s) => sum + s.bytes, 0),
    total_token_proxy: sections.reduce((sum,s) => sum + s.token_proxy, 0),
    ...(previous ? { revision_delta: diffKnowledgeIndex(previous, { sections, sources }) } : {}),
    sections,
  }, null, 2));
}
if (import.meta.main) main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
