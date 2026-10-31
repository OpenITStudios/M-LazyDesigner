import { describe, expect, test } from "bun:test";
import {
  indexMarkdownKnowledge,
  describeKnowledgeSource,
  diffKnowledgeIndex,
  indexExplicitDocumentationEdges,
  knowledgeIndexFingerprint,
  knowledgeIndexIntegrityFingerprint,
  selectKnowledgeSections,
} from "../lib/semantic/knowledge";
import { parsePreviousKnowledgeIndex } from "../scripts/development/build-knowledge-index";

describe("knowledge section compiler", () => {
  test("creates stable hierarchical ids and ignores fenced headings", () => {
    const text = [
      "# Workflow",
      "intro",
      "## UV Layout",
      "packing guidance",
      "```text",
      "## not a heading",
      "```",
      "### Stable Packing",
      "keep islands stable",
      "## Texture",
      "paint guidance",
    ].join("\n");

    const sections = indexMarkdownKnowledge(
      "prompts/bedrock_entity_workflow.md",
      text
    );

    expect(sections.map((section) => section.id)).toEqual([
      "knowledge:prompts/bedrock-entity-workflow#workflow",
      "knowledge:prompts/bedrock-entity-workflow#workflow/uv-layout",
      "knowledge:prompts/bedrock-entity-workflow#workflow/uv-layout/stable-packing",
      "knowledge:prompts/bedrock-entity-workflow#workflow/texture",
    ]);
    expect(sections.some((section) => section.heading === "not a heading")).toBe(
      false
    );
  });

  test("long fences do not expose shorter inner fences as knowledge headings", () => {
    const sections = indexMarkdownKnowledge("doc.md", [
      "# Actual",
      "````md",
      "```",
      "## Hidden",
      "```",
      "````",
      "## Visible",
    ].join("\n"));
    expect(sections.map(section => section.heading)).toEqual(["Actual", "Visible"]);
  });

  test("fences close only on a matching, sufficiently long, plain closing line", () => {
    const sections = indexMarkdownKnowledge("doc.md", [
      "# Start",
      "~~~~text",
      "~~~",
      "~~~~still-content",
      "## Hidden",
      "~~~~",
      "## Done",
    ].join("\n"));
    expect(sections.map(section => section.heading)).toEqual(["Start", "Done"]);
  });

  test("documentation links respect the same multiline fence boundaries", () => {
    const edges = indexExplicitDocumentationEdges("docs/index.md", [
      "[Available](present.md)",
      "````md",
      "```",
      "[Invisible](missing.md)",
      "````",
      "[Available again](present.md)",
    ].join("\n"));
    expect(edges.map(edge => edge.label)).toEqual(["Available", "Available again"]);
    expect(edges.map(edge => edge.line)).toEqual([1, 6]);
  });

  test("content changes alter only the affected section hash", () => {
    const before = indexMarkdownKnowledge(
      "doc.md",
      "# A\none\n# B\ntwo"
    );
    const after = indexMarkdownKnowledge(
      "doc.md",
      "# A\nONE\n# B\ntwo"
    );

    expect(before[0]?.sha256).not.toBe(after[0]?.sha256);
    expect(before[1]?.sha256).toBe(after[1]?.sha256);
    expect(knowledgeIndexFingerprint(before)).not.toBe(
      knowledgeIndexFingerprint(after)
    );
  });

  test("selects relevant sections under a token budget", () => {
    const sections = indexMarkdownKnowledge(
      "workflow.md",
      [
        "# Workflow",
        "general orientation",
        "## UV Layout",
        "stable packing texel density island padding",
        "## Texture Styling",
        "palette shading material paint pixels",
      ].join("\n")
    );

    const selected = selectKnowledgeSections({
      sections,
      query: "fix uv stable packing islands",
      maxTokenProxy: 200,
    });

    expect(selected[0]?.heading).toBe("UV Layout");
    expect(selected.some((section) => section.heading === "Texture Styling")).toBe(
      false
    );
  });

  test("never exceeds the knowledge token budget, including the first ranked section", () => {
    const large = indexMarkdownKnowledge(
      "long.md", "# Geometry UV Rig\n" + "geometry ".repeat(300)
    )[0]!;
    const small = indexMarkdownKnowledge(
      "short.md", "# Geometry\nsmall focused correction"
    )[0]!;
    expect(large.token_proxy).toBeGreaterThan(50);
    const selected = selectKnowledgeSections({
      sections: [large, small],
      query: "geometry uv rig",
      maxTokenProxy: 50,
    });
    expect(selected.map((section) => section.id)).toEqual([small.id]);
    expect(selected.reduce((sum, section) => sum + section.token_proxy, 0))
      .toBeLessThanOrEqual(50);
    expect(selectKnowledgeSections({
      sections: [large],
      query: "geometry uv rig",
      maxTokenProxy: 50,
    })).toEqual([]);
  });

  test("invalid non-finite retrieval limits and corrupt section sizes fail closed", () => {
    const section = indexMarkdownKnowledge("budget.md",
      "# Geometry\nsmall geometry guidance")[0]!;
    for (const requested of [
      { maxTokenProxy: Number.NaN },
      { maxTokenProxy: Number.POSITIVE_INFINITY },
      { limit: Number.NaN },
      { limit: Number.NEGATIVE_INFINITY },
    ]) {
      expect(selectKnowledgeSections({
        sections: [section],
        query: "geometry",
        ...requested,
      })).toEqual([]);
    }
    for (const corruptSize of [Number.NaN, -1]) {
      expect(selectKnowledgeSections({
        sections: [{ ...section, token_proxy: corruptSize }],
        query: "geometry",
        maxTokenProxy: 50,
      })).toEqual([]);
    }
  });

  test("retains duplicate authored role links so the canonical router can reject collisions", () => {
    const links = indexExplicitDocumentationEdges("docs/README.md", [
      "[Implementation Map](04-system/README.md)",
      "[Implementation Map](04-system/README.md)",
    ].join("\n"));
    expect(links).toHaveLength(2);
    expect(links.map((edge) => edge.label)).toEqual([
      "Implementation Map", "Implementation Map",
    ]);
    expect(links[0]?.to).toBe(links[1]?.to);
    expect(links[0]?.line).not.toBe(links[1]?.line);
  });

  test("explicit documentation links form a source-grounded, revision-stable graph", () => {
    const first = indexExplicitDocumentationEdges("docs/README.md", [
      "# Router",
      "Follow [System](04-system/README.md) for source ownership.",
      "[System again](04-system/README.md)",
      "[External](https://example.org/other.md)",
      "[Escape](../secret.md)",
      "```md",
      "[Fake](04-system/phantom.md)",
      "```",
      "![Image](04-system/decor.md)",
    ].join("\n"));
    const second = indexExplicitDocumentationEdges("docs/README.md",
      "# Changed prose\nFollow [System](04-system/README.md) for canonical ownership."
    );
    // Each authored link is evidence; target-level de-duplication would
    // conceal a duplicate canonical role before it reaches routing checks.
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      from: "docs/README.md",
      to: "docs/04-system/README.md",
      label: "System",
      from_id: "document:docs/README",
      to_id: "document:docs/04-system/README",
      relation: "EXPLICIT_MARKDOWN_LINK",
    });
    expect(second[0]?.to_id).toBe(first[0]?.to_id);
    const relocated = indexExplicitDocumentationEdges("docs/README.md",
      "Follow [System documentation router](05-operations/README.md) for an explicitly moved route."
    );
    expect(relocated[0]).toMatchObject({
      label: "System documentation router",
      to: "docs/05-operations/README.md",
    });
    expect(() => indexExplicitDocumentationEdges("../README.md", "# Invalid")).toThrow();
  });

  test("provenance is bound to source content and refuses ambiguous versions", () => {
    const source = "# Particle\nappearance";
    const repo = describeKnowledgeSource("docs/particle.md", source);
    expect(repo.origin).toBe("REPOSITORY");
    expect(repo.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    const external = describeKnowledgeSource("snapshots/particle.md", source, {
      upstream_url: "https://learn.microsoft.com/minecraft/",
      upstream_revision: "v1.21.0",
      compatible_with: [{ product: "MINECRAFT_BEDROCK", version: "1.21.0" }],
    });
    expect(external.origin).toBe("EXTERNAL_SNAPSHOT");
    expect(() => describeKnowledgeSource("snapshots/particle.md", source, {
      upstream_url: "http://example.com", upstream_revision: "v1",
    })).toThrow(/HTTPS/);
    expect(() => describeKnowledgeSource("snapshots/particle.md", source, {
      upstream_url: "https://example.com", upstream_revision: "v1",
      compatible_with: [{ product: "BLOCKBENCH", version: "latest" }],
    })).toThrow(/exact/);
  });

  test("unchanged sections survive source line shifts, but upstream revisions invalidate", () => {
    const source = "docs/model.md";
    const oldText = "# Geometry\nold\n# Texturing\nunchanged";
    const newText = "# Geometry\nnew\nextra\n# Texturing\nunchanged";
    const a = indexMarkdownKnowledge(source, oldText);
    const b = indexMarkdownKnowledge(source, newText);
    const diff = diffKnowledgeIndex({ sections: a }, { sections: b });
    expect(diff.changed).toEqual([a[0]!.id]);
    expect(diff.unchanged).toEqual([a[1]!.id]);
    expect(a[1]!.start_line).not.toBe(b[1]!.start_line);
    const meta = (rev: string) => describeKnowledgeSource(source, oldText, {
      upstream_url: "https://example.org/spec", upstream_revision: rev,
    });
    expect(diffKnowledgeIndex(
      { sections: a, sources: [meta("v1")] },
      { sections: a, sources: [meta("v2")] },
    ).changed).toHaveLength(2);
  });

  test("exact version matching never trusts sources with unknown compatibility", () => {
    const path = "snapshots/animation.md", markdown = "# Animation\ncontroller";
    const sections = indexMarkdownKnowledge(path, markdown);
    const evidence = describeKnowledgeSource(path, markdown, {
      upstream_url: "https://example.org/spec", upstream_revision: "v1",
      compatible_with: [{ product: "BLOCKBENCH", version: "5.2.1" }],
    });
    const select = (version: string, sourceEvidence = [evidence]) =>
      selectKnowledgeSections({
        sections, sourceEvidence, compatibleWith: { product: "BLOCKBENCH", version },
        query: "animation controller",
      });
    expect(select("5.2.1")).toHaveLength(1);
    expect(select("5.3.0")).toHaveLength(0);
    expect(select("latest")).toHaveLength(0);
    expect(select("5.2.1", [])).toHaveLength(0);
    expect(() => select("5.2.1", [evidence, evidence])).toThrow(/Duplicate/);
  });

  test("schema-1 baseline supports original reports and checks source-level provenance fingerprint", () => {
    const sections = indexMarkdownKnowledge("docs/a.md", "# A\ncontent");
    const legacy = {
      schema: 1, proof_scope: "REPO_OWNED_KNOWLEDGE_INDEX",
      fingerprint: knowledgeIndexFingerprint(sections), sections,
    };
    expect(parsePreviousKnowledgeIndex(legacy).sources).toBeUndefined();
    const sources = [describeKnowledgeSource("docs/a.md", "# A\ncontent")];
    const current = { ...legacy, sources, fingerprint: knowledgeIndexFingerprint(sections, sources) };
    expect(parsePreviousKnowledgeIndex(current).sources).toEqual(sources);
    expect(() => parsePreviousKnowledgeIndex({
      ...current, sources: [{...sources[0], content_sha256: "0".repeat(64)}],
    })).toThrow(/fingerprint/);
  });

  test("historic index search metadata cannot be reused with a partial fingerprint", () => {
    const markdown = "# Geometry\nscale rig pivot";
    const sections = indexMarkdownKnowledge("docs/geometry.md", markdown);
    const sources = [describeKnowledgeSource("docs/geometry.md", markdown)];
    const baseline = {
      schema: 1,
      proof_scope: "REPO_OWNED_KNOWLEDGE_INDEX",
      fingerprint: knowledgeIndexFingerprint(sections, sources),
      integrity_fingerprint: knowledgeIndexIntegrityFingerprint(sections, sources),
      sections, sources,
    };
    expect(parsePreviousKnowledgeIndex(baseline).integrity_verified).toBe(true);
    const poisoned = [{ ...sections[0]!, search_terms: ["unrelated"], token_proxy: 0 }];
    expect(knowledgeIndexFingerprint(poisoned, sources)).toBe(baseline.fingerprint);
    expect(() => parsePreviousKnowledgeIndex({ ...baseline, sections: poisoned }))
      .toThrow(/integrity fingerprint/);
    expect(parsePreviousKnowledgeIndex({ ...baseline, integrity_fingerprint: undefined })
      .integrity_verified).toBe(false);
    expect(() => parsePreviousKnowledgeIndex({
      ...baseline, sections: [sections[0]!, sections[0]!],
    })).toThrow(/duplicate sections/);
  });

  test("duplicate identities reject unsafe index deltas", () => {
    const section = indexMarkdownKnowledge("docs/a.md", "# A\ncontent")[0]!;
    expect(() => diffKnowledgeIndex(
      { sections: [section, section] }, { sections: [section] },
    )).toThrow(/Duplicate/);
  });

  test("duplicate semantic heading paths fail closed", () => {
    expect(() =>
      indexMarkdownKnowledge("doc.md", "# A\none\n# A\ntwo")
    ).toThrow(/Duplicate knowledge section id/);
  });
});

describe("conditional voxel 3D artist guidance", () => {
  test("one conditional style grammar remains indexed and projected through the existing handoffs", async () => {
    const path = "docs/02-reference/pixel-art/style-lock.md";
    const markdown = await Bun.file("../" + path).text();
    const sections = indexMarkdownKnowledge(path, markdown);
    const named = sections.filter(section =>
      section.heading === "Stylized Minecraft Voxel 3D — Conditional Artist Style Bible"
    );
    expect(named).toHaveLength(1);
    const selected = selectKnowledgeSections({
      sections, query: "stylized minecraft voxel 3d artist style bible",
      limit: 1, maxTokenProxy: 1500,
    });
    expect(selected.map(section => section.id)).toEqual([named[0]!.id]);
    expect(markdown).toContain("PROVISIONAL");
    expect(markdown).toContain("rather than photorealistic rendering");

    const [geometry, texture, animation] = await Promise.all([
      Bun.file("../docs/02-reference/package/geometry.md").text(),
      Bun.file("../docs/02-reference/package/texture.md").text(),
      Bun.file("../docs/02-reference/package/animation.md").text(),
    ]);
    expect(geometry).toContain("../pixel-art/style-lock.md#stylized-minecraft-voxel-3d");
    expect(texture).toContain("style_lock_id + relevant style constraints");
    expect(animation).toContain("../pixel-art/style-lock.md#stylized-minecraft-voxel-3d");
    expect(geometry).toContain("hidden depth");
    expect(animation).toContain("native playback remains unverified");
  });

  test("three existing domain case owners retain positive, negative, ambiguous and proof boundaries", async () => {
    const cases = [
      {
        path: "docs/03-authoring/modelling/decision-cases.md",
        heading: "G-P02 Primary Silhouette Mass",
        fields: ["**Apply:**", "**Reject/defer:**", "**Source evidence:**",
          "**Positive case (hypothetical):**", "**Ambiguous case (hypothetical):**",
          "**Proof required:**", "focal hierarchy"],
      },
      {
        path: "docs/03-authoring/texture/decision-cases.md",
        heading: "TEX-P01 Reference Material Palette Pixel Clusters",
        fields: ["**Decision:**", "**Positive case (hypothetical):**",
          "**Reject case (hypothetical):**", "**Ambiguous case (hypothetical):**",
          "**Artistic correction (hypothetical; NOT observed):**"],
      },
      {
        path: "docs/03-authoring/animation/knowledge-coverage.md",
        heading: "A01 — Biped Locomotion: Planted Foot and Weight (Candidate)",
        fields: ["**Apply:**", "**Reject/defer:**", "**Source facts (inspected internally):**",
          "**Positive case (hypothetical):**", "**Ambiguous case (hypothetical):**",
          "**Required evidence:**", "CANDIDATE / UNVERIFIED"],
      },
    ];
    for (const entry of cases) {
      const markdown = await Bun.file("../" + entry.path).text();
      const sections = indexMarkdownKnowledge(entry.path, markdown);
      const found = sections.filter(section => section.heading === entry.heading);
      expect(found).toHaveLength(1);
      const section = found[0]!;
      const body = markdown.split(/\r?\n/).slice(section.start_line, section.end_line).join("\n");
      for (const field of entry.fields) expect(body).toContain(field);
      expect(section.sha256).toMatch(/^[a-f0-9]{64}$/);
      if (entry.heading.startsWith("G-P02")) expect(body.length).toBeLessThan(1600);
    }
  });
});
