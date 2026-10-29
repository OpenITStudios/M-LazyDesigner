import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  selectKnowledgeSections,
  type KnowledgeSection,
} from "@/lib/semantic/knowledge";

/**
 * K4 read-only selection of the four source-grounded Texture/UV candidate cards.
 * This is NOT an authoring executor, a new knowledge index, or a reference verifier.
 * The canonical case descriptions live only in decision-cases.md.
 */
export const TEXTURE_UV_CASE_SOURCE_PATH =
  "docs/03-authoring/texture/decision-cases.md";

export const TEXTURE_UV_CASE_IDS = [
  "UV-P01",
  "TEX-P01",
  "TEX-P02",
  "TEX-P03",
] as const;

export type TextureUvCaseId = (typeof TEXTURE_UV_CASE_IDS)[number];

export type TextureUvKnowledgePin = {
  expected_source_sha256?: string;
  expected_section_sha256?: string;
};

export type TextureUvCaseSelection =
  | {
      state: "REVIEW_REQUIRED";
      reason:
        | "CASE_UNKNOWN"
        | "QUERY_INVALID"
        | "NO_CASE_MATCH"
        | "AMBIGUOUS_CASE"
        | "SOURCE_REVISION_INVALID"
        | "SOURCE_STALE"
        | "SECTION_REVISION_INVALID"
        | "SECTION_STALE";
      mutation_authorized: false;
      visual_verdict: "not_evaluated";
    }
  | {
      state: "SOURCE_CANDIDATE";
      case_id: TextureUvCaseId;
      title: string;
      source: string;
      source_sha256: string;
      section_id: string;
      section_sha256: string;
      guidance_text: string;
      required_evidence: string;
      reference_scope: "CURRENT_USER_REFERENCE_NOT_ATTESTED";
      target_compatibility: "UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH";
      decision_readiness: "REVIEW_REQUIRED";
      mutation_authorized: false;
      visual_verdict: "not_evaluated";
    };

const MAX_SOURCE_BYTES = 32_768;
const MAX_CASE_CHARS = 7_000;
const DIGEST = /^[a-f0-9]{64}$/;
const CASE_HEADING = /^(?:UV|TEX)-P\d{2} /;
const CASE_FIELDS = [
  "**Decision:**",
  "**Source fact (inspected):**",
  "**Positive case (hypothetical):**",
  "**Reject case (hypothetical):**",
  "**Ambiguous case (hypothetical):**",
  "**Required evidence:**",
  "**Owner / consumer:**",
  "**Test and proof:**",
  "**Source IDs / risk:**",
  "**Status:**",
] as const;

function refuse(
  reason: Extract<TextureUvCaseSelection, { state: "REVIEW_REQUIRED" }>["reason"]
): TextureUvCaseSelection {
  return {
    state: "REVIEW_REQUIRED",
    reason,
    mutation_authorized: false,
    visual_verdict: "not_evaluated",
  };
}

function pinReason(
  requested: string | undefined,
  actual: string,
  invalid: "SOURCE_REVISION_INVALID" | "SECTION_REVISION_INVALID",
  stale: "SOURCE_STALE" | "SECTION_STALE"
) {
  if (requested === undefined) return null;
  if (!DIGEST.test(requested)) return invalid;
  return requested === actual ? null : stale;
}

type CaseEntry = {
  id: TextureUvCaseId;
  section: KnowledgeSection;
  guidance: string;
  requiredEvidence: string;
};

/**
 * Bun-embeddable, content-addressed reader. The source must be trusted
 * repository Markdown; never pass user text or network content as a casebook.
 * Indexes lazily, only when the owner actually requests a candidate.
 */
export function createTextureUvCaseReader(markdown: string) {
  if (typeof markdown !== "string" || !markdown.trim() ||
      new TextEncoder().encode(markdown).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("TEXTURE_KNOWLEDGE_SOURCE_INVALID");
  }
  const sections = indexMarkdownKnowledge(TEXTURE_UV_CASE_SOURCE_PATH, markdown)
    .filter(section => CASE_HEADING.test(section.heading));
  const expectedIds = [...TEXTURE_UV_CASE_IDS];
  if (sections.length !== expectedIds.length ||
      sections.some((section, index) =>
        section.level !== 2 ||
        !section.heading.startsWith(expectedIds[index] + " "))) {
    throw new Error("TEXTURE_KNOWLEDGE_CASE_INVENTORY_INCOMPLETE");
  }

  const lines = markdown.split(/\r?\n/);
  const entries: CaseEntry[] = sections.map((section, index) => {
    // indexMarkdownKnowledge counts the heading as start_line; the body starts
    // at the next 1-based line. Do not carry adjacent cases into the excerpt.
    const body = lines.slice(section.start_line, section.end_line)
      .join("\n").trimEnd();
    if (!body || body.length > MAX_CASE_CHARS ||
        CASE_FIELDS.some(field => !body.includes(field))) {
      throw new Error("TEXTURE_KNOWLEDGE_CASE_CONTENT_INVALID");
    }
    const required = body.match(/^- \*\*Required evidence:\*\*\s*(.+)$/m);
    if (!required?.[1]?.trim()) {
      throw new Error("TEXTURE_KNOWLEDGE_CASE_EVIDENCE_MISSING");
    }
    return {
      id: expectedIds[index]!,
      section,
      guidance: body,
      requiredEvidence: required[1].trim(),
    };
  });
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const source = describeKnowledgeSource(TEXTURE_UV_CASE_SOURCE_PATH, markdown);
  // Reuse the canonical selector, but only leaf titles may match queries.
  // The shared "Texture & UV" parent is deliberately excluded from ranking.
  const titleSections = sections.map(section => ({
    ...section, heading_path: [section.heading], search_terms: [],
  }));

  function read(
    id: string,
    pin: TextureUvKnowledgePin = {}
  ): TextureUvCaseSelection {
    if (!TEXTURE_UV_CASE_IDS.some(caseId => caseId === id)) {
      return refuse("CASE_UNKNOWN");
    }
    const entry = byId.get(id as TextureUvCaseId);
    if (!entry) return refuse("CASE_UNKNOWN");
    const sourceFailure = pinReason(
      pin.expected_source_sha256, source.content_sha256,
      "SOURCE_REVISION_INVALID", "SOURCE_STALE"
    );
    if (sourceFailure) return refuse(sourceFailure);
    const sectionFailure = pinReason(
      pin.expected_section_sha256, entry.section.sha256,
      "SECTION_REVISION_INVALID", "SECTION_STALE"
    );
    if (sectionFailure) return refuse(sectionFailure);
    return {
      state: "SOURCE_CANDIDATE",
      case_id: entry.id,
      title: entry.section.heading,
      source: TEXTURE_UV_CASE_SOURCE_PATH,
      source_sha256: source.content_sha256,
      section_id: entry.section.id,
      section_sha256: entry.section.sha256,
      guidance_text: entry.guidance,
      required_evidence: entry.requiredEvidence,
      reference_scope: "CURRENT_USER_REFERENCE_NOT_ATTESTED",
      target_compatibility: "UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH",
      decision_readiness: "REVIEW_REQUIRED",
      mutation_authorized: false,
      visual_verdict: "not_evaluated",
    };
  }

  function select(
    query: string,
    pin: TextureUvKnowledgePin = {}
  ): TextureUvCaseSelection {
    if (typeof query !== "string" || query.trim().length < 3 ||
        query.length > 256) return refuse("QUERY_INVALID");
    const selected = selectKnowledgeSections({
      sections: titleSections,
      query, limit: 4, maxTokenProxy: 20_000,
    });
    if (selected.length === 0) return refuse("NO_CASE_MATCH");
    if (selected.length > 1 && selected[0]!.score === selected[1]!.score) {
      return refuse("AMBIGUOUS_CASE");
    }
    const entry = entries.find(item => item.section.id === selected[0]!.id);
    return entry ? read(entry.id, pin) : refuse("CASE_UNKNOWN");
  }

  return { read, select, source_sha256: source.content_sha256 };
}
