import { describe, expect, test } from "bun:test";
import { indexExplicitDocumentationEdges } from "../../lib/semantic/knowledge";
import {
  buildDocumentationGraph, explainDocumentationPath, auditDocumentationNavigation,
  documentationTraceMarkdown, documentationTraceMermaid, documentResourceId,
} from "../../lib/semantic/documentation-graph";

const docs = [
  { path: "docs/README.md", markdown: "# Root\n[System](04-system/README.md)" },
  { path: "docs/04-system/README.md",
    markdown: "# System\n[Architecture](knowledge-architecture.md)\n[Missing](missing.md)" },
  { path: "docs/04-system/knowledge-architecture.md",
    markdown: "# Architecture\n[[docs/04-system/README.md|System Router]]" },
];
describe("source-backed documentation architecture", () => {
  test("stable IDs, preserved source line witnesses and unresolved targets", () => {
    const graph = buildDocumentationGraph(docs);
    expect(graph.proof_scope).toBe("AUTHORED_NAVIGATION_ONLY");
    expect(documentResourceId("docs/README.md")).toBe("document:docs/README");
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0]?.line).toBe(2);
    expect(graph.edges.some(x => x.relation === "EXPLICIT_OBSIDIAN_WIKILINK")).toBe(true);
    expect(graph.unresolved).toMatchObject([
      { from: "docs/04-system/README.md", to: "docs/04-system/missing.md", line: 3 },
    ]);
  });
  test("shortest directed trace and explicit reverse with original witness", () => {
    const graph = buildDocumentationGraph(docs);
    const trace = explainDocumentationPath(graph, "document:docs/README",
      "docs/04-system/knowledge-architecture.md");
    expect(trace.status).toBe("FOUND");
    expect(trace.nodes).toEqual(["docs/README.md", "docs/04-system/README.md",
      "docs/04-system/knowledge-architecture.md"]);
    expect(trace.steps.map(step => step.witness.line)).toEqual([2, 2]);
    expect(explainDocumentationPath(graph, "docs/04-system/README.md",
      "docs/README.md").status).toBe("NO_PATH");
    const reverse = explainDocumentationPath(graph, "docs/04-system/README.md",
      "docs/README.md", { bothDirections: true });
    expect(reverse.steps[0]?.direction).toBe("REVERSE");
    expect(reverse.steps[0]?.witness.from).toBe("docs/README.md");
  });
  test("unknown, depth limits, duplicate IDs and path escapes fail closed", () => {
    const graph = buildDocumentationGraph(docs);
    expect(explainDocumentationPath(graph, "docs/missing.md",
      "docs/README.md").status).toBe("UNKNOWN_RESOURCE");
    expect(explainDocumentationPath(graph, "docs/README.md",
      "docs/04-system/knowledge-architecture.md",
      { maxHops: 1 }).status).toBe("DEPTH_LIMIT");
    expect(() => buildDocumentationGraph([docs[0]!, docs[0]!])).toThrow();
    expect(() => documentResourceId("docs/../foo.md")).toThrow();
    expect(() => explainDocumentationPath(graph, "docs/README.md",
      "docs/README.md", { maxHops: 7 })).toThrow();
  });
  test("derived Obsidian and Mermaid projections never claim runtime proof", () => {
    const trace = explainDocumentationPath(buildDocumentationGraph(docs),
      "docs/README.md", "docs/04-system/knowledge-architecture.md");
    const markdown = documentationTraceMarkdown(trace);
    expect(markdown).toContain("[[docs/README.md|document:docs/README]]");
    expect(markdown).toContain("docs/README.md:2");
    expect(markdown).toContain("Pele-compatible");
    expect(documentationTraceMermaid(trace)).toContain("flowchart LR");
    expect(markdown).toContain("not proof of source imports");
  });
  test("unrouted documents are review items; not retired documentation", () => {
    const result = auditDocumentationNavigation(buildDocumentationGraph([
      ...docs, { path: "docs/04-system/unlinked.md", markdown: "# Unlinked" },
    ]));
    expect(result.unreachable_paths).toEqual(["docs/04-system/unlinked.md"]);
    expect(result.unresolved_link_count).toBe(1);
  });
  test("links in comments, fences, inline code, images, escaped and fuzzy wiki are ignored", () => {
    const tick = String.fromCharCode(96);
    const input = [
      "[Valid](real.md)",
      String.fromCharCode(92) + "[Escaped](escaped.md)",
      tick + "[Inline](inline.md)" + tick,
      "<!-- [Comment](comment.md) -->",
      "~~~~text", "[Fenced](fenced.md)", "~~~~",
      "    [Indented](indented.md)", "![Image](image.md)",
      "[[Ambiguous Note]]", "[[docs/other.md|Exact note]]",
    ].join("\n");
    const edges = indexExplicitDocumentationEdges("docs/README.md", input);
    expect(edges.map(edge => edge.to)).toEqual(["docs/real.md", "docs/other.md"]);
  });

  test("multiline HTML comment markers cannot open a false Markdown fence", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = [
      "<!--", fence + "md", "-->",
      "[Real](valid.md)",
      fence + "md", "[Fenced](hidden.md)", fence,
      "[Also real](more.md)",
    ].join("\n");
    expect(indexExplicitDocumentationEdges("docs/README.md", source)
      .map(edge => edge.to)).toEqual(["docs/valid.md", "docs/more.md"]);
  });

  test("multiline inline-code spans do not suppress later documentation routes", () => {
    const tick = String.fromCharCode(96);
    const source = [
      tick + "[Hidden](fake.md)",
      tick.repeat(3), "the span ends" + tick,
      "[Actual](real.md)",
    ].join("\n");
    expect(indexExplicitDocumentationEdges("docs/README.md", source)
      .map(edge => edge.to)).toEqual(["docs/real.md"]);
  });

  test("document graph keeps source content hash for each exact link witness", () => {
    const original = explainDocumentationPath(buildDocumentationGraph(docs),
      "docs/README.md", "docs/04-system/knowledge-architecture.md");
    expect(original.steps[0]?.witness.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    const edited = docs.map(item => item.path === "docs/README.md"
      ? { ...item, markdown: item.markdown + "\nAdditional explicit routing rationale." }
      : item);
    const changed = explainDocumentationPath(buildDocumentationGraph(edited),
      "docs/README.md", "docs/04-system/knowledge-architecture.md");
    expect(changed.steps[0]?.witness.source_sha256)
      .not.toBe(original.steps[0]?.witness.source_sha256);
    expect(changed.steps[1]?.witness.source_sha256)
      .toBe(original.steps[1]?.witness.source_sha256);
    expect(documentationTraceMarkdown(changed)).toContain("SHA-256");
  });

});
