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
        TEST_ONLY: 1,
        EXTERNAL_COMPATIBILITY_REVIEW: 1,
        UNREFERENCED_REVIEW: 1,
      },
      missing_roots: [],
      review_examples: ["lib/compat.ts", "lib/orphan.ts"],
      review_examples_truncated: false,
    });
    expect(result.limitations).toContain("Never auto-remove");
    expect(summarizeSourceReachability(
      graph, roots, ["lib/compat.ts"], [], [], 20, owners
    )).toEqual(result);
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
    expect(value.hasNonLiteralImport).toBe(true);
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
