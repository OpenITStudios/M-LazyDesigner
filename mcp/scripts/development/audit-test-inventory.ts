import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// On-demand audit only. This is not a registry, test runner, or proof that a
// flagged test is stale. It makes test-suite maintenance measurable before any
// test is merged, rewritten, or retired.
export type TestInventoryRow = { path: string; source: string };
export type TestInventoryEntry = {
  path: string;
  owner: string;
  has_source_text_assertions: boolean;
  has_direct_runtime_import: boolean;
  needs_manual_review: boolean;
};

const EXCLUDED_DIRS = new Set([
  "node_modules", "dist", ".git", ".cache", "coverage", "target", "build",
]);

function testOwner(path: string): string {
  const p = path.replaceAll("\\", "/").replace(/^mcp\//, "");
  for (const [prefix, owner] of [
    ["tests/repository/", "repository"],
    ["tests/authoring/", "authoring"],
    ["tests/benchmark/", "benchmark"],
    ["tests/contracts/", "contracts"],
    ["tests/development/", "development"],
    ["tests/live/", "live"],
    ["tests/runtime/", "runtime"],
    ["gateway/", "gateway"],
  ] as const) {
    if (p.startsWith(prefix)) return owner;
  }
  return "other";
}

export function inspectTestInventoryRow(row: TestInventoryRow): TestInventoryEntry {
  const textSourceRead = /\b(?:Bun\.file|readFile|readFileSync)\s*\(/.test(row.source);
  const literalAssertion = /\b(?:toContain|toMatch)\s*\(|\.includes\s*\(/.test(row.source);
  const directRuntimeImport =
    /\bfrom\s*["'](?:@\/|\.\.\/\.\.\/(?:lib|server|gateway)\/|\.\.\/lib\/|\.\.\/gateway\/)/.test(row.source);
  // Text-source assertions are REVIEW CANDIDATES, not automatically invalid.
  // Mixed executable+source tests can be valid and should retain coverage.
  const sourceAssertions = textSourceRead && literalAssertion;
  return {
    path: row.path.replaceAll("\\", "/"),
    owner: testOwner(row.path),
    has_source_text_assertions: sourceAssertions,
    has_direct_runtime_import: directRuntimeImport,
    needs_manual_review: sourceAssertions,
  };
}

export function summarizeTestInventory(rows: readonly TestInventoryRow[], sampleLimit = 16) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 0 || sampleLimit > 100) {
    throw new Error("Test inventory sample limit must be 0..100.");
  }
  const entries = rows.map(inspectTestInventoryRow)
    .sort((a, b) => a.path.localeCompare(b.path));
  const paths = entries.map((item) => item.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Test inventory contains duplicate file paths.");
  }
  const owners: Record<string, number> = {};
  for (const row of entries) owners[row.owner] = (owners[row.owner] ?? 0) + 1;
  const review = entries.filter((entry) => entry.needs_manual_review);
  return {
    schema: "lazydesigner-test-inventory-v1",
    classification: "HEURISTIC_REVIEW_ONLY" as const,
    total_test_files: entries.length,
    by_owner: Object.fromEntries(Object.entries(owners).sort(([a], [b]) => a.localeCompare(b))),
    source_assertion_review_candidates: review.length,
    direct_runtime_import_candidates: entries.filter((entry) => entry.has_direct_runtime_import).length,
    mixed_source_and_runtime_candidates: entries.filter(
      (entry) => entry.has_source_text_assertions && entry.has_direct_runtime_import
    ).length,
    review_examples: review.slice(0, sampleLimit).map((entry) => entry.path),
    examples_truncated: review.length > sampleLimit,
    limitations: "Source-text heuristics do not prove staleness, behavior coverage, ownership validity, or a safe deletion. Review live owners, exact assertions and replacements individually.",
  };
}

async function listTestPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) await visit(fullPath);
      } else if (entry.isFile() && /\.(?:test|spec)\.tsx?$/.test(entry.name)) {
        found.push(fullPath);
      }
    }
  }
  await visit(root);
  return found.sort();
}

export async function auditRepositoryTests(root: string, sampleLimit = 16) {
  const paths = await listTestPaths(root);
  const rows = await Promise.all(paths.map(async (path) => ({
    path: relative(root, path).split(sep).join("/"),
    source: await readFile(path, "utf8"),
  })));
  return summarizeTestInventory(rows, sampleLimit);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitFlag = args.find((arg) => arg.startsWith("--sample-limit="));
  if (args.some((arg) => !arg.startsWith("--sample-limit="))) {
    throw new Error("Only --sample-limit=0..100 is supported.");
  }
  const limit = limitFlag ? Number(limitFlag.split("=")[1]) : 16;
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  console.log(JSON.stringify(await auditRepositoryTests(projectRoot, limit), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
