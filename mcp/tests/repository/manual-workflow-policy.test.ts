import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const FILES = [
  "authoring-policy-verify.yml", "dependency-security.yml",
  "desktop-draft-release.yml", "desktop-verify.yml", "head-proof.yml",
  "managed-distribution.yml", "mcp-conformance.yml",
  "mcp-verify.yml", "release-readiness.yml", "release-verify.yml",
  "repository-verify.yml",
] as const;

function triggers(yaml: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf("on:");
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith(" ") && !line.startsWith("#")) break;
    const match = /^  ([a-z_]+):/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

describe("manual-only GitHub Actions", () => {
  test("every registered workflow has workflow_dispatch as its only event", async () => {
    const names = (await readdir("../.github/workflows")).filter((n) => n.endsWith(".yml")).sort();
    expect(names).toEqual([...FILES].sort());
    for (const file of FILES) {
      const yaml = await Bun.file(`../.github/workflows/${file}`).text();
      expect(triggers(yaml), file).toEqual(["workflow_dispatch"]);
      expect(yaml).toContain("contents: read");
    }
  });

  test("verification and draft releases preserve their original proof boundaries", async () => {
    const [mcp, release, managed, desktop] = await Promise.all([
      Bun.file("../.github/workflows/mcp-verify.yml").text(),
      Bun.file("../.github/workflows/release-verify.yml").text(),
      Bun.file("../.github/workflows/managed-distribution.yml").text(),
      Bun.file("../.github/workflows/desktop-draft-release.yml").text(),
    ]);
    expect(mcp).toContain("bun run verify:full");
    expect(mcp).toContain("bun install --frozen-lockfile");
    expect(mcp).toContain("write-ci");
    expect(mcp).toContain("name: Record ChatGPT-readable non-native verification");
    expect(mcp).toContain("schema: 'lazydesigner-cloud-source-evidence-v1'");
    expect(mcp).toContain("native_blockbench: 'NOT_EXECUTED'");
    expect(mcp).toContain("name: lazydesigner-cloud-source-evidence");
    expect(mcp).toContain("if-no-files-found: warn");
    expect(release).toContain('test "$REF_NAME" = "Local"');
    expect(release).toContain("git merge-base --is-ancestor origin/main HEAD");
    expect(managed).toContain("gh release create");
    expect(managed).toContain("--draft");
    expect(managed).toContain("startsWith(github.ref, 'refs/tags/lazydesigner-v')");
    expect(desktop).toContain("github.ref == 'refs/heads/main'");
  });
});
