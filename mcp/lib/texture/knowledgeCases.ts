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

/** Hypothetical case boundaries from trusted, pinned K3 Markdown.
 * They are advisory prose, NOT observed user reference data or an apply gate.
 */
export type TextureUvDecisionExamples = Readonly<{
  decision: string;
  positive_hypothesis: string;
  reject_hypothesis: string;
  ambiguous_hypothesis: string;
}>;

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
      decision_examples: TextureUvDecisionExamples;
      required_evidence: string;
      reference_scope: "CURRENT_USER_REFERENCE_NOT_ATTESTED";
      target_compatibility: "UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH";
      decision_readiness: "REVIEW_REQUIRED";
      mutation_authorized: false;
      visual_verdict: "not_evaluated";
    };

const MAX_SOURCE_BYTES = 32_768;
const MAX_CASE_CHARS = 7_000;
const MAX_CASE_FIELD_CHARS = 800;
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
  decisionExamples: TextureUvDecisionExamples;
  requiredEvidence: string;
};

/** One exact authored case field, no markup inference or duplicate index.
 * Keep each evidence boundary bounded instead of forwarding a whole casebook.
 */
function readCaseField(body: string, label: string): string {
  const prefix = `- **${label}:** `;
  const matches = body.split("\n").filter(line => line.startsWith(prefix));
  const value = matches.length === 1
    ? matches[0]!.slice(prefix.length).trim() : "";
  if (!value || value.length > MAX_CASE_FIELD_CHARS) {
    throw new Error("TEXTURE_KNOWLEDGE_CASE_FIELD_INVALID");
  }
  return value;
}

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
    const decisionExamples = {
      decision: readCaseField(body, "Decision"),
      positive_hypothesis: readCaseField(body, "Positive case (hypothetical)"),
      reject_hypothesis: readCaseField(body, "Reject case (hypothetical)"),
      ambiguous_hypothesis: readCaseField(body, "Ambiguous case (hypothetical)"),
    };
    const requiredEvidence = readCaseField(body, "Required evidence");
    return {
      id: expectedIds[index]!,
      section,
      guidance: body,
      decisionExamples,
      requiredEvidence,
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
      decision_examples: { ...entry.decisionExamples },
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


// K5/K6: a bounded technical diagnostic can identify which *candidate*
// reference question merits a review. It cannot verify the actual artwork.
export type TextureUvTechnicalKnowledgeSignals = Readonly<{
  exact_reuse_region_count?: unknown;
  partial_overlap_pair_count?: unknown;
  solid_color_face_count?: unknown;
  scanned_face_count?: unknown;
}>;

export type TextureUvTechnicalKnowledgeHint = Readonly<{
  state: "REVIEW_REQUIRED";
  source_state: "SOURCE_CANDIDATE";
  case_id: "UV-P01" | "TEX-P01";
  trigger: "UV_PIXEL_OWNERSHIP_REVIEW" | "FLAT_TEXTURE_REFERENCE_REVIEW";
  observed: Readonly<Record<string, number>>;
  source_sha256: string;
  section_sha256: string;
  required_evidence: string;
  decision_examples: TextureUvDecisionExamples;
  reference_scope: "CURRENT_USER_REFERENCE_NOT_ATTESTED";
  target_compatibility: "UNKNOWN_CURRENT_BEDROCK_AND_BLOCKBENCH";
  mutation_authorized: false;
  visual_verdict: "not_evaluated";
}>;

/**
 * Advisory K3 case selection from a currently requested native diagnostic.
 * It does not classify artistic intent, trigger new diagnostic reads or use
 * filename/material-name heuristics. No source lookup on the empty fast path.
 */
export function suggestTextureUvTechnicalKnowledge(
  signals: TextureUvTechnicalKnowledgeSignals,
  readCase: (id: TextureUvCaseId) => TextureUvCaseSelection
): TextureUvTechnicalKnowledgeHint[] {
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? value : 0;
  const reused = count(signals.exact_reuse_region_count);
  const overlapping = count(signals.partial_overlap_pair_count);
  const solid = count(signals.solid_color_face_count);
  const scanned = count(signals.scanned_face_count);
  const hints: TextureUvTechnicalKnowledgeHint[] = [];

  function add(
    id: "UV-P01" | "TEX-P01",
    trigger: TextureUvTechnicalKnowledgeHint["trigger"],
    observed: Record<string, number>
  ) {
    const caseEvidence = readCase(id);
    if (caseEvidence.state !== "SOURCE_CANDIDATE") return;
    hints.push({
      state: "REVIEW_REQUIRED",
      source_state: "SOURCE_CANDIDATE",
      case_id: id,
      trigger,
      observed,
      source_sha256: caseEvidence.source_sha256,
      section_sha256: caseEvidence.section_sha256,
      required_evidence: caseEvidence.required_evidence,
      decision_examples: { ...caseEvidence.decision_examples },
      reference_scope: caseEvidence.reference_scope,
      target_compatibility: caseEvidence.target_compatibility,
      mutation_authorized: false,
      visual_verdict: "not_evaluated",
    });
  }

  if (reused > 0 || overlapping > 0) {
    add("UV-P01", "UV_PIXEL_OWNERSHIP_REVIEW", {
      exact_reuse_region_count: reused,
      partial_overlap_pair_count: overlapping,
    });
  }
  // Flat source pixels alone cannot tell whether the artwork is unfinished.
  // This case asks the artist to review reference-material identity, not to paint.
  if (solid > 0 && scanned > 0) {
    add("TEX-P01", "FLAT_TEXTURE_REFERENCE_REVIEW", {
      solid_color_face_count: solid,
      scanned_face_count: scanned,
    });
  }
  // No K3 cross-Cube or emissive case without explicit seam pair and material/
  // renderer binding. Existing intra-Cube scans and MERS file names are insufficient.
  return hints;
}
