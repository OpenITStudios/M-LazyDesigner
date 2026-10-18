import { describe, expect, test } from "bun:test";
import { inspectTestInventoryRow, summarizeTestInventory } from
  "../../scripts/development/audit-test-inventory";

describe("test inventory heuristics are review candidates, not deletion decisions", () => {
  test("recognizes source-text contracts without calling them stale", () => {
    const textOnly = inspectTestInventoryRow({
      path: "tests/repository/policy.test.ts",
      source: `import { test, expect } from "bun:test";
        const content = await Bun.file("../AGENTS.md").text();
        expect(content).toContain("Required rule");`,
    });
    expect(textOnly.owner).toBe("repository");
    expect(textOnly.has_source_text_assertions).toBe(true);
    expect(textOnly.has_direct_runtime_import).toBe(false);
    expect(textOnly.needs_manual_review).toBe(true);
  });

  test("pure behavioral imports stay out of source-text review candidates", () => {
    const actual = inspectTestInventoryRow({
      path: "tests/texture-mask.test.ts",
      source: `import { applyMaskedColor } from "@/lib/texture/maskedOps";
        test("preserves RGBA", () => {
          expect(applyMaskedColor(...)).toEqual([1, 2, 3, 4]);
        });`,
    });
    expect(actual.owner).toBe("other");
    expect(actual.has_direct_runtime_import).toBe(true);
    expect(actual.needs_manual_review).toBe(false);
  });

  test("mixed tests still require human inspection, never automatic retirement", () => {
    const rows = [
      {
        path: "tests/texture-mask.test.ts",
        source: 'import { op } from "@/lib/texture/maskedOps"; expect(op()).toBe(true);',
      },
      {
        path: "tests/repository/policy.test.ts",
        source: 'const s = await Bun.file("AGENTS.md").text(); expect(s).toContain("rule");',
      },
      {
        path: "gateway/control/readiness.test.ts",
        source: 'import { ready } from "@/gateway/control/readiness"; const s = await Bun.file("policy.md").text(); expect(s).toMatch(/ready/);',
      },
    ];
    const out = summarizeTestInventory(rows, 1);
    expect(out.total_test_files).toBe(3);
    expect(out.classification).toBe("HEURISTIC_REVIEW_ONLY");
    expect(out.by_owner).toMatchObject({ repository: 1, gateway: 1, other: 1 });
    expect(out.source_assertion_review_candidates).toBe(2);
    expect(out.direct_runtime_import_candidates).toBe(2);
    expect(out.mixed_source_and_runtime_candidates).toBe(1);
    expect(out.review_examples).toHaveLength(1);
    expect(out.examples_truncated).toBe(true);
    expect(out.limitations).toContain("do not prove staleness");
  });

  test("inventory output is deterministic and invalid bounds fail closed", () => {
    const row = { path: "tests/alpha.test.ts", source: 'test("alpha", () => {})' };
    const other = { path: "tests/charlie.test.ts", source: 'test("charlie", () => {})' };
    expect(summarizeTestInventory([other, row])).toEqual(summarizeTestInventory([row, other]));
    expect(() => summarizeTestInventory([row, row])).toThrow("duplicate file paths");
    expect(() => summarizeTestInventory([row], 101)).toThrow("sample limit");
    expect(() => summarizeTestInventory([row], -1)).toThrow("sample limit");
  });
});
