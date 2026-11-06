import { describe, expect, test } from "bun:test";
import {
  readSourceImports,
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
});
