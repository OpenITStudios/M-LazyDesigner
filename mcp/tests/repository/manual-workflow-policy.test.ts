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

describe("Local Full CI and protected manual release workflows", () => {
  test("only authorized non-publishing workflows run on Local pushes", async () => {
    const names = (await readdir("../.github/workflows")).filter((n) => n.endsWith(".yml")).sort();
    expect(names).toEqual([...FILES].sort());
    const auto = new Set([
      "mcp-verify.yml",
      "dependency-security.yml",
      "mcp-conformance.yml",
      "desktop-verify.yml",
      "release-readiness.yml",
    ]);
    expect(auto.size).toBe(5);
    for (const file of FILES) {
      const yaml = await Bun.file(`../.github/workflows/${file}`).text();
      if (auto.has(file)) {
        expect(triggers(yaml), file).toEqual(["push", "workflow_dispatch"]);
        expect(yaml, file).toMatch(/^  push:\n    branches:\n      - Local\n  workflow_dispatch:/m);
        expect(yaml, file).not.toMatch(/^    (?:tags|paths|paths-ignore):/m);
        expect(yaml, file).not.toMatch(/contents:\s*write/);
      } else {
        expect(triggers(yaml), file).toEqual(["workflow_dispatch"]);
      }
      expect(yaml, file).not.toMatch(/^  (?:pull_request|schedule|workflow_run|release|create|delete):/m);
      expect(yaml, file).toContain("contents: read");
    }
  });

  test("Rust lockfile generation remains opt-in and cannot bypass security gates", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("contains(github.event.head_commit.message, '[rust-lock-refresh]')");
    expect(yaml).toContain("rustup run 1.98.1 cargo remove --manifest-path apps/desktop/src-tauri/Cargo.toml zip serde_yaml ureq");
    expect(yaml).toContain("cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --locked");
    expect(yaml).toContain("source.json");
    expect(yaml).toContain("SHA256SUMS.txt");
    expect(yaml).toContain("READ_ONLY_CANDIDATE_NOT_COMMITTED");
    expect(yaml).toContain("if-no-files-found: error");
    expect(yaml).toContain("run: bun run security:audit");
    expect(yaml).not.toContain("contents: write");
  });

  test("automatic MCP source verification is full, manual texture focus remains available", async () => {
    const workflow = await Bun.file("../.github/workflows/mcp-verify.yml").text();
    expect(workflow).toContain("default: full");
    expect(workflow).toContain("options:\n          - full\n          - texture");
    expect(workflow).toContain("if: ${{ github.event_name == 'push' || inputs.verification != 'texture' }}");
    expect(workflow).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.verification == 'texture' }}");
    expect(workflow).toContain("run: bun run verify:full");
    expect(workflow).toContain("run: bun run verify:texture:focused");
    expect(workflow).toContain("requiredSteps.map(name => steps[name])");
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
