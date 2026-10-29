import { describe, expect, test } from "bun:test";
import {
  describeKnowledgeSource,
  indexMarkdownKnowledge,
  selectKnowledgeSections,
  type KnowledgeSection,
} from "@/lib/semantic/knowledge";

const DOC_PATH = "../docs/03-authoring/texture/decision-cases.md";
const SOURCE_ID = "docs/03-authoring/texture/decision-cases.md";
const CASE_IDS = ["UV-P01", "TEX-P01", "TEX-P02", "TEX-P03"] as const;

const markdown = () => Bun.file(DOC_PATH).text();

function cases(text: string): KnowledgeSection[] {
  return indexMarkdownKnowledge(SOURCE_ID, text).filter((section) =>
    /^(UV-P01|TEX-P01|TEX-P02|TEX-P03) /.test(section.heading)
  );
}

function caseText(text: string, section: KnowledgeSection): string {
  return text.split(/\r?\n/).slice(section.start_line - 1, section.end_line).join("\n");
}

/**
 * K3-only fixture: reuses the canonical section selector with leaf-case titles,
 * mirroring the established Geometry G1 method. This is NOT a production
 * Texture/UV selection API, source-reference authenticator, or mutation gate.
 */
function selectUniqueTitle(query: string, sections: readonly KnowledgeSection[]) {
  const leaves = sections.map((section) => ({
    ...section,
    heading_path: [section.heading],
    search_terms: [],
  }));
  const ranked = selectKnowledgeSections({
    sections: leaves,
    query,
    limit: 4,
    maxTokenProxy: 20_000,
  });
  return ranked.length > 0 &&
    (ranked.length === 1 || ranked[0]!.score > ranked[1]!.score)
      ? ranked[0]!.heading.match(/^(UV-P01|TEX-P01|TEX-P02|TEX-P03) /)?.[1] ?? null
      : null;
}

describe("K3 Texture and UV decision cases — source-only selection fixture", () => {
  test("exactly four separately indexed source-grounded cases exist", async () => {
    const text = await markdown();
    const sections = cases(text);
    expect(sections.map((section) => section.heading.split(" ", 1)[0])).toEqual([...CASE_IDS]);
    expect(new Set(sections.map((s) => s.id)).size).toBe(CASE_IDS.length);
    for (const section of sections) {
      const body = caseText(text, section);
      for (const required of [
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
      ]) {
        expect(body).toContain(required);
      }
      expect(section.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("distinct title queries select only their named case; generic and ambiguous cases abstain", async () => {
    const sections = cases(await markdown());
    const valid: Array<[string, string]> = [
      ["mirrored texel reuse asymmetric identity", "UV-P01"],
      ["reference material palette pixel clusters", "TEX-P01"],
      ["cross cube seam observed continuity", "TEX-P02"],
      ["emissive eyes material pbr render", "TEX-P03"],
    ];
    for (const [query, expected] of valid) {
      expect(selectUniqueTitle(query, sections)).toBe(expected);
    }
    // "material" appears in two distinct titles. No arbitrary tie-break.
    expect(selectUniqueTitle("material", sections)).toBeNull();
    expect(selectUniqueTitle("animation rig pivot", sections)).toBeNull();
    expect(selectUniqueTitle("unknown", sections)).toBeNull();
  });

  test("a changed case body changes only its source section hash", async () => {
    const before = await markdown();
    const oldCases = cases(before);
    expect(before).toContain("mirrored mark alignment");
    const changed = before.replace(
      "mirrored mark alignment",
      "mirrored mark alignment UPDATED FOR STALE FIXTURE"
    );
    const newCases = cases(changed);
    expect(newCases[0]!.sha256).not.toBe(oldCases[0]!.sha256);
    for (let i = 1; i < oldCases.length; i++) {
      expect(newCases[i]!.sha256).toBe(oldCases[i]!.sha256);
    }
    const beforeSource = describeKnowledgeSource(SOURCE_ID, before);
    const newSource = describeKnowledgeSource(SOURCE_ID, changed);
    expect(beforeSource.content_sha256).not.toBe(newSource.content_sha256);
  });

  test("pinned source IDs carry real full-file SHA-256, but never imply external rights or acceptance", async () => {
    const text = await markdown();
    const ledger = text.split(/\r?\n/).filter((line) => /^\| S\d{2} \|/.test(line));
    expect(ledger).toHaveLength(11);
    for (const line of ledger) {
      expect(line).toMatch(/\bS\d{2}\b/);
      expect(line).toMatch(/`[a-f0-9]{64}`/);
      expect(line).toMatch(/`[a-f0-9]{40}`/);
    }
    expect(text).toContain("**UNREGISTERED**");
    expect(text).toContain("NOT EXECUTED");
    expect(text).toContain("Mojang EULA");
    expect(text).toContain("GPL-3.0");
    expect(text).toContain("single confirmed current Bedrock runtime version");
  });
});
