import { describe, expect, test } from "bun:test";
import {
  readSourceImports,
  readSourceAstEvidence,
  explainSourceDependency,
  inspectKnowledgeSourceSites,
  sourceInspectionMermaid,
  sourceInspectionMarkdown,
  summarizeSourceReachability,
} from "../../scripts/development/audit-source-reachability";

describe("source reachability is a review-only dependency audit", () => {
  const graph = {
    "index.ts": ["lib/active.ts", "lib/shared.ts"],
    "gateway/index.ts": ["gateway/live.ts"],
    "lib/active.ts": [],
    "lib/shared.ts": [],
    "gateway/live.ts": [],
    "scripts/report.ts": ["lib/tool.ts", "lib/shared.ts"],
    "lib/tool.ts": [],
    "tests/asset.test.ts": ["lib/test-only.ts", "lib/shared.ts"],
    "lib/test-only.ts": [],
    "lib/compat.ts": ["lib/active.ts"],
    "lib/orphan.ts": [],
  } as const;
  const roots = {
    runtime: ["index.ts", "gateway/index.ts"],
    tooling: ["scripts/report.ts"],
    tests: ["tests/asset.test.ts"],
  } as const;
  const owners = [
    "lib/active.ts", "lib/shared.ts", "gateway/live.ts",
    "lib/tool.ts", "lib/test-only.ts", "lib/compat.ts", "lib/orphan.ts",
  ];

  test("separates Runtime, tooling, tests-only and unreferenced source", () => {
    const result = summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 20, owners
    );
    expect(result).toMatchObject({
      authority: "STATIC_IMPORT_GRAPH_REVIEW_ONLY",
      total_source_modules: 7,
      classes: {
        RUNTIME_REACHABLE: 3,
        TOOLING_REACHABLE: 1,
        TYPE_ONLY_REFERENCED: 0,
        TEST_ONLY: 1,
        EXTERNAL_COMPATIBILITY_REVIEW: 1,
        UNREFERENCED_REVIEW: 1,
      },
      missing_roots: [],
      review_candidate_count: 2,
      review_offset: 0,
      review_next_offset: null,
      // Orphan candidates MUST precede legitimate facade review entries,
      // even when compatibility names sort first alphabetically.
      review_examples: ["lib/orphan.ts", "lib/compat.ts"],
      review_examples_truncated: false,
    });
    expect(result.limitations).toContain("Never auto-remove");
    expect(summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 20, owners
    )).toEqual(result);
  });

  test("orphan-first pages expose all candidates beyond the bounded first page", () => {
    const first = summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 1, owners
    );
    expect(first).toMatchObject({
      review_candidate_count: 2, review_offset: 0,
      review_next_offset: 1, review_examples: ["lib/orphan.ts"],
      review_examples_truncated: true,
    });
    const second = summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 1, owners, graph, 1
    );
    expect(second).toMatchObject({
      review_candidate_count: 2, review_offset: 1,
      review_next_offset: null, review_examples: ["lib/compat.ts"],
      review_examples_truncated: false,
    });
    expect(summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 1, owners, graph, 2
    ).review_examples).toEqual([]);
    const countOnly = summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 0, owners
    );
    expect(countOnly.review_candidate_count).toBe(2);
    expect(countOnly.review_examples).toEqual([]);
    expect(countOnly.review_examples_truncated).toBe(true);
    expect(countOnly.review_next_offset).toBeNull();
    expect(() => summarizeSourceReachability(
      graph, roots, [], [], [], 1, owners, graph, -1
    )).toThrow("review offset");
    expect(() => summarizeSourceReachability(
      graph, roots, [], [], [], 1, owners, graph, 1.5
    )).toThrow("review offset");
  });

  test("source paths absent from graph and missing entrypoints are never silently cleared", () => {
    expect(() => summarizeSourceReachability(
      graph, roots, [], [], [], 20, ["lib/phantom.ts"]
    )).toThrow("SOURCE_AUDIT_UNKNOWN_REVIEW_PATH");
    const missing = summarizeSourceReachability(
      graph, { ...roots, tooling: ["scripts/missing.ts"] },
      [], ["lib/active.ts -> ./missing", "lib/active.ts -> ./missing"],
      ["lib/active.ts"], 1, owners
    );
    expect(missing.missing_roots).toEqual(["scripts/missing.ts"]);
    expect(missing.unresolved_local_imports).toEqual([
      "lib/active.ts -> ./missing",
    ]);
    expect(missing.dynamic_import_file_count).toBe(1);
    expect(missing.review_examples).toHaveLength(1);
    expect(missing.review_examples_truncated).toBe(true);
    expect(() => summarizeSourceReachability(graph, roots, [], [], [], 101))
      .toThrow("sample limit");
    expect(() => summarizeSourceReachability(graph, roots, [], [], [], -1))
      .toThrow("sample limit");
  });

  test("parses real TS import/export/type/require and marks nonliteral branches uncertain", () => {
    const value = readSourceImports(`
      import type { A } from "./typeOnly";
      import { source } from "@/lib/live";
      export * from "./compatibility";
      export { item } from "./other";
      type ExternalType = import("./typeReference").ExternalType;
      const deferred = import("./dynamic");
      const required = require("./required");
      const unknown = import("./optional/" + suffix);
    `, "fixture.ts");
    expect(value.specifiers).toEqual([
      "./compatibility", "./dynamic", "./other",
      "./required", "./typeOnly", "./typeReference", "@/lib/live",
    ].sort((left, right) => left.localeCompare(right)));
    expect(value.runtimeSpecifiers).toEqual([
      "./compatibility", "./dynamic", "./other", "./required", "@/lib/live",
    ].sort((left, right) => left.localeCompare(right)));
    expect(value.typeOnlySpecifiers).toEqual([
      "./typeOnly", "./typeReference",
    ].sort((left, right) => left.localeCompare(right)));
    expect(value.hasNonLiteralImport).toBe(true);
  });

  test("mixed clauses retain value edges while type-only reexports never impersonate Runtime imports", () => {
    const parsed = readSourceImports(`
      import { type X, type Y } from "./type-components";
      export { type Private } from "./type-exports";
      export type * from "./type-star";
      import type DefaultType from "./type-default";
      import { type Label, liveFunction } from "./mixed";
      export { type SourceType, service } from "./mixed-exports";
      import "./side-effects";
      import type { Alias } from "./dual";
      import { used } from "./dual";
      const lazy = import("./lazy-runtime");
    `);
    expect(parsed.runtimeSpecifiers).toEqual([
      "./dual", "./lazy-runtime", "./mixed",
      "./mixed-exports", "./side-effects",
    ].sort((left, right) => left.localeCompare(right)));
    expect(parsed.typeOnlySpecifiers).toEqual([
      "./type-components", "./type-default",
      "./type-exports", "./type-star",
    ].sort((left, right) => left.localeCompare(right)));
    expect(parsed.specifiers).toContain("./dual");
    expect(parsed.hasNonLiteralImport).toBe(false);
  });

  test("type-only compiled modules are owned but not counted as live Runtime imports", () => {
    const valueGraph = {
      "index.ts": ["lib/loaded.ts"],
      "lib/loaded.ts": [],
      "lib/definitions.ts": [],
      "lib/nested-definition.ts": [],
      "tests/policy.test.ts": ["lib/test-only.ts"],
      "lib/test-only.ts": [],
    };
    const sourceGraph = {
      ...valueGraph,
      "index.ts": ["lib/loaded.ts", "lib/definitions.ts"],
      "lib/definitions.ts": ["lib/nested-definition.ts"],
    };
    const report = summarizeSourceReachability(
      valueGraph,
      { runtime: ["index.ts"], tooling: [], tests: ["tests/policy.test.ts"] },
      [], [], [], 20,
      ["lib/loaded.ts", "lib/definitions.ts", "lib/nested-definition.ts", "lib/test-only.ts"],
      sourceGraph
    );
    expect(report.classes).toMatchObject({
      RUNTIME_REACHABLE: 1,
      TOOLING_REACHABLE: 0,
      TYPE_ONLY_REFERENCED: 2,
      TEST_ONLY: 1,
      UNREFERENCED_REVIEW: 0,
    });
    expect(report.review_examples).toEqual([]);
    // Without the complete source graph, a type-only module would be an
    // orphan candidate. With source edges it retains a compile-time owner.
    const incomplete = summarizeSourceReachability(
      valueGraph,
      { runtime: ["index.ts"], tooling: [], tests: ["tests/policy.test.ts"] },
      [], [], [], 20,
      ["lib/definitions.ts", "lib/nested-definition.ts", "lib/loaded.ts", "lib/test-only.ts"]
    );
    expect(incomplete.classes.UNREFERENCED_REVIEW).toBe(2);
  });

  test("manual JavaScript modules are parseable as source but not auto-certified Runtime", () => {
    const js = readSourceImports(`
      import { createHash } from "node:crypto";
      import "./manual-helper.mjs";
      const optional = import("./optional/" + extension);
    `, "scripts/qa/manual.mjs");
    expect(js.runtimeSpecifiers).toContain("./manual-helper.mjs");
    expect(js.hasNonLiteralImport).toBe(true);
    const manual = summarizeSourceReachability(
      { ...graph, "scripts/qa/manual.mjs": [] }, roots, [], [], [], 20,
      ["scripts/qa/manual.mjs"]
    );
    expect(manual.classes.UNREFERENCED_REVIEW).toBe(1);
    expect(manual.review_examples).toEqual(["scripts/qa/manual.mjs"]);
    expect(manual.limitations).toContain("Never auto-remove");
  });

  test("a compatibility facade is a review candidate, not auto-deleted dead code", () => {
    const out = summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"],
      [], [], 0, ["lib/compat.ts", "lib/orphan.ts"]
    );
    expect(out.classes.EXTERNAL_COMPATIBILITY_REVIEW).toBe(1);
    expect(out.classes.UNREFERENCED_REVIEW).toBe(1);
    expect(out.review_examples).toEqual([]);
    expect(out.review_examples_truncated).toBe(true);
  });

  test("AST source witnesses preserve source line/column, type-only and literal dynamic imports", () => {
    const evidence = readSourceAstEvidence([
      'import type { A } from "./types";',
      'import { live } from "./live";',
      'export type { D } from "./other";',
      'const lazy = import("./lazy");',
      'const unknown = import("./variant/" + suffix);',
      'const maybe = require("./shadowed");',
      'const member = some.require("./member");',
      '// import { Fake } from "./comment";',
    ].join("\n"), "lib/inspect.ts");
    const exact = evidence.imports.filter(site => site.specifier !== null);
    expect(exact.map(site => site.kind)).toEqual([
      "IMPORT", "IMPORT", "EXPORT", "DYNAMIC_IMPORT", "REQUIRE", "MEMBER_REQUIRE",
    ]);
    expect(exact.map(site => site.line)).toEqual([1, 2, 3, 4, 6, 7]);
    expect(exact[0]?.column).toBe(24);
    expect(exact[0]?.runtime_capable).toBe(false);
    expect(exact[1]?.runtime_capable).toBe(true);
    expect(evidence.imports.filter(site => site.specifier === null))
      .toMatchObject([{ kind: "DYNAMIC_IMPORT", line: 5 }]);
  });

  test("source graph impact is conservative with exact witnesses and bounded cycles", () => {
    const files = ["lib/changed.ts", "lib/user.ts", "lib/top.ts", "lib/unrelated.ts"];
    const edge = (path: string, dependency: string, line: number) => ({
      path, dependency, line, column: 8, specifier: "./" + dependency.split("/").at(-1),
      kind: "IMPORT" as const, runtime_capable: true,
    });
    const graph = {
      files, edges: [
        edge("lib/user.ts", "lib/changed.ts", 4),
        edge("lib/top.ts", "lib/user.ts", 7),
        edge("lib/user.ts", "lib/top.ts", 12),
      ],
      obligations: [
        { path: "lib/top.ts", line: 15, column: 12, specifier: null,
          kind: "DYNAMIC_IMPORT" as const, runtime_capable: true,
          reason: "NONLITERAL_IMPORT" as const },
      ],
    };
    const result = explainSourceDependency(graph,
      { mode: "IMPACT", source: "lib/changed.ts" });
    expect(result.status).toBe("FOUND");
    expect(result.routes.map(route => route.path)).toEqual(["lib/user.ts", "lib/top.ts"]);
    expect(result.routes[1]?.steps.map(step => step.witness.line)).toEqual([4, 7]);
    expect(result.relevant_obligations).toHaveLength(1);
    expect(result.global_obligation_count).toBe(1);
    expect(explainSourceDependency(graph, {
      mode: "TRACE", source: "lib/top.ts", target: "lib/changed.ts",
    }).routes[0]?.steps.map(step => step.witness.line)).toEqual([7, 4]);
    expect(explainSourceDependency(graph, {
      mode: "TRACE", source: "lib/changed.ts", target: "lib/unrelated.ts",
    }).status).toBe("NO_PATH");
    expect(explainSourceDependency(graph, {
      mode: "IMPACT", source: "lib/phantom.ts",
    }).status).toBe("UNKNOWN_SOURCE");
    expect(explainSourceDependency(graph, {
      mode: "TRACE", source: "lib/top.ts", target: "lib/changed.ts", maxHops: 1,
    }).status).toBe("DEPTH_LIMIT");
    expect(explainSourceDependency(graph, {
      mode: "IMPACT", source: "lib/changed.ts", resultLimit: 1,
    }).truncated).toBe(true);
  });

  test("generic knowledge API sites and exact literal references are distinct from consumption", () => {
    const key = "knowledge:docs/modelling/standard#uv";
    const production = readSourceAstEvidence([
      'import { selectKnowledgeSections as choose } from "../../lib/semantic/knowledge";',
      'const selected = choose({ query: "UV" });',
      'const declared = "' + key + '";',
      '// "' + key + '"',
      'const unrelated = selectKnowledgeSections();',
    ].join("\n"), "scripts/development/plan.ts", key);
    const proofOnly = readSourceAstEvidence(
      'const known = "' + key + '";', "tests/knowledge.test.ts", key
    );
    expect(production.knowledge_literals).toMatchObject([
      { path: "scripts/development/plan.ts", line: 3 },
    ]);
    expect(production.knowledge_api_candidates).toMatchObject([
      { line: 2, api: "selectKnowledgeSections" },
    ]);
    const report = inspectKnowledgeSourceSites(key, [production, proofOnly]);
    expect(report.evidence_class).toBe("EXACT_AST_LITERAL_REFERENCE_NOT_CONSUMPTION_PROOF");
    expect(report.literal_source_count).toBe(1);
    expect(report.literal_test_count).toBe(1);
    expect(report.generic_candidate_count).toBe(1);
    expect(report.interpretation).toContain("not prove");
    expect(inspectKnowledgeSourceSites(key, [readSourceAstEvidence(
      'import { indexMarkdownKnowledge } from "../../lib/semantic/knowledge";\n' +
      'indexMarkdownKnowledge("x", "# a");', "scripts/other.ts", key
    )]).evidence_class).toBe("GENERIC_KNOWLEDGE_API_CANDIDATE");
    expect(inspectKnowledgeSourceSites(key, [
      readSourceAstEvidence('const unrelated = "other";', "scripts/other.ts", key),
    ]).evidence_class).toBe("NO_SOURCE_WITNESS");
    expect(inspectKnowledgeSourceSites(key, [proofOnly]).evidence_class)
      .toBe("DECLARATION_ONLY");
    expect(report.catalog_registration).toBe("NOT_CHECKED");
    expect(() => readSourceAstEvidence("", "a.ts", "not-a-knowledge-id")).toThrow();
  });

  test("source import Mermaid and Markdown are witness-backed projections only", () => {
    const report = explainSourceDependency({
      files: ["a.ts", "b.ts"],
      edges: [{
        path: "b.ts", dependency: "a.ts", line: 3, column: 9,
        specifier: "./a", kind: "IMPORT", runtime_capable: true,
      }],
      obligations: [],
    }, { mode: "IMPACT", source: "a.ts" });
    expect(sourceInspectionMermaid(report)).toContain("flowchart LR");
    expect(sourceInspectionMarkdown(report)).toContain("b.ts:3:9");
    expect(sourceInspectionMarkdown(report)).toContain("not function-call");
  });


  test("no importer never becomes a fabricated FOUND impact", () => {
    const graph = { files: ["lib/changed.ts", "lib/unrelated.ts"], edges: [],
      obligations: [] };
    const result = explainSourceDependency(graph, {
      mode: "IMPACT", source: "lib/changed.ts",
    });
    expect(result.status).toBe("NO_PATH");
    expect(result.routes).toEqual([]);
    expect(result.source_scope).toBe("MCP_TSCONFIG_AND_STANDALONE_SCRIPT_JS");
    expect(result.inspected_file_count).toBe(2);
    expect(result.possible_dependency_gap_count).toBe(0);
  });

  test("computed imports remain a gap instead of falsely clearing impact", () => {
    const graph = {
      files: ["lib/changed.ts", "lib/unknown.ts"], edges: [],
      obligations: [{
        path: "lib/unknown.ts", line: 7, column: 3, specifier: null,
        kind: "DYNAMIC_IMPORT" as const, runtime_capable: true,
        reason: "NONLITERAL_IMPORT" as const,
      }],
    };
    const impact = explainSourceDependency(graph, {
      mode: "IMPACT", source: "lib/changed.ts",
    });
    expect(impact.status).toBe("INCOMPLETE_EVIDENCE");
    expect(impact.possible_dependency_gap_count).toBe(1);
    expect(impact.relevant_obligation_count).toBe(1);
    expect(impact.global_obligation_count).toBe(1);
    expect(explainSourceDependency(graph, {
      mode: "TRACE", source: "lib/unknown.ts", target: "lib/changed.ts",
    }).status).toBe("INCOMPLETE_EVIDENCE");
    const excluded = {
      ...graph, obligations: [
        { ...graph.obligations[0]!, reason: "EXCLUDED_NON_CODE" as const },
      ],
    };
    expect(explainSourceDependency(excluded, {
      mode: "IMPACT", source: "lib/changed.ts",
    }).status).toBe("NO_PATH");
    expect(explainSourceDependency(excluded, {
      mode: "IMPACT", source: "lib/changed.ts",
    }).global_obligation_count).toBe(1);
  });

  test("a result count equal to the requested limit is not truncation", () => {
    const graph = {
      files: ["changed.ts", "user.ts"], obligations: [],
      edges: [{
        path: "user.ts", dependency: "changed.ts", line: 1, column: 1,
        specifier: "./changed", kind: "IMPORT" as const, runtime_capable: true,
      }],
    };
    const result = explainSourceDependency(graph, {
      mode: "IMPACT", source: "changed.ts", resultLimit: 1,
    });
    expect(result.status).toBe("FOUND");
    expect(result.truncated).toBe(false);
    expect(result.route_count).toBe(1);
  });

  test("Recipe knowledge API candidates are admitted only from exact value imports", () => {
    const id = "knowledge:docs/03-authoring/modelling/standard#geometry";
    const recipe = readSourceAstEvidence([
      'import { suggestRecipeKnowledge as choose } from "@/lib/authoringRecipe/knowledgeSelection";',
      'import { resolveRecipeKnowledgeLinks } from "@/lib/authoringRecipe/knowledge";',
      'choose(recipe, index);',
      'resolveRecipeKnowledgeLinks(recipe, index);',
    ].join("\n"), "lib/authoringRecipe/knowledgePlanning.ts", id);
    expect(recipe.knowledge_api_candidates.map(site => site.api)).toEqual([
      "suggestRecipeKnowledge", "resolveRecipeKnowledgeLinks",
    ]);
    expect(inspectKnowledgeSourceSites(id, [recipe]).evidence_class)
      .toBe("GENERIC_KNOWLEDGE_API_CANDIDATE");
    const onlyType = readSourceAstEvidence([
      'import type { suggestRecipeKnowledge } from "@/lib/authoringRecipe/knowledgeSelection";',
      'import { type resolveRecipeKnowledgeLinks } from "@/lib/authoringRecipe/knowledge";',
      'const choose = 3;',
    ].join("\n"), "lib/authoringRecipe/typeOnly.ts", id);
    expect(onlyType.knowledge_api_candidates).toEqual([]);
    expect(inspectKnowledgeSourceSites(id, [onlyType]).evidence_class)
      .toBe("NO_SOURCE_WITNESS");
  });

  test("relevant unresolved witness counts report samples without hiding debt", () => {
    const graph = {
      files: ["changed.ts", "unknown.ts"], edges: [],
      obligations: Array.from({ length: 45 }, (_, i) => ({
        path: "unknown.ts", line: i + 1, column: 1,
        specifier: null, kind: "DYNAMIC_IMPORT" as const,
        runtime_capable: true, reason: "NONLITERAL_IMPORT" as const,
      })),
    };
    const report = explainSourceDependency(graph, {
      mode: "IMPACT", source: "changed.ts",
    });
    expect(report.status).toBe("INCOMPLETE_EVIDENCE");
    expect(report.relevant_obligation_count).toBe(45);
    expect(report.relevant_obligations).toHaveLength(40);
    expect(report.relevant_obligations_truncated).toBe(true);
    expect(sourceInspectionMarkdown(report)).toContain("possible dependency gaps: 45");
  });


  test("source witnesses preserve content identity across source changes", () => {
    const before = readSourceAstEvidence('import "./example";', "lib/example.ts");
    const after = readSourceAstEvidence('import "./example";\n// edited',
      "lib/example.ts");
    expect(before.imports[0]?.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(before.imports[0]?.source_sha256).not.toBe(after.imports[0]?.source_sha256);
    expect(before.imports[0]?.line).toBe(after.imports[0]?.line);
  });

  test("self trace is identity rather than proof of an import edge", () => {
    const self = explainSourceDependency({ files: ["lib/a.ts"], edges: [],
      obligations: [] }, {
      mode: "TRACE", source: "lib/a.ts", target: "lib/a.ts",
    });
    expect(self.status).toBe("SAME_SOURCE_NO_IMPORT_EDGE");
    expect(self.route_count).toBe(0);
    expect(self.routes).toEqual([]);
    expect(self.interpretation).toContain("no import edge");
  });

});
