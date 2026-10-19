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

  test("aligned Cargo/npm candidate is strictly opt-in and read-only", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("contains(github.event.head_commit.message, '[rust-upstream-review]')");
    expect(yaml).toContain('cargo update --manifest-path "$MANIFEST" -p tauri --precise 2.12.3');
    expect(yaml).toContain("@tauri-apps/api@2.12.3");
    expect(yaml).toContain("@tauri-apps/cli@2.12.3");
    expect(yaml).toContain('"tauri-utils": "2.10.2"');
    expect(yaml).toContain("apps/desktop/package.json");
    expect(yaml).toContain("apps/desktop/package-lock.json");
    expect(yaml).toContain("REVIEW_ONLY_NOT_COMMITTED");
    expect(yaml).toContain("SHA256SUMS.txt");
    expect(yaml).not.toContain("contents: write");
  });

  test("same-run Windows Cargo candidate is verified before disposable locked checks", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("rust-upstream-windows:");
    expect(yaml).toContain("needs: rust-upstream-candidate");
    expect(yaml).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(yaml).toContain("Candidate source identity or same-run provenance mismatch.");
    expect(yaml).toContain("Candidate checksum mismatch: $path");
    expect(yaml).toContain("Tauri npm candidate lock mismatch: $name");
    expect(yaml).toContain("run: npm ci");
    expect(yaml).toContain("run: npm run verify:source");
    expect(yaml).toContain("contents: read");
    expect(yaml).not.toContain("contents: write");
  });

  test("Cargo advisory audit is mandatory and preserves dependency-security integrity", async () => {
    const workflow = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(workflow).toContain("rustsec-audit:");
    expect(workflow).toContain("cargo install cargo-audit --locked --version 0.22.2");
    expect(workflow).toContain("audit --file apps/desktop/src-tauri/Cargo.lock --deny unmaintained --deny unsound --deny yanked");
    expect(workflow).not.toContain("--no-fetch");
    expect(workflow).not.toContain("--ignore");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("git diff --exit-code -- apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock");
    expect(workflow).toContain("run: bun run security:audit");
  });

  test("RustSec retains strict denials and classifies the Windows Cargo graph", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("Classify RustSec dependencies for the Windows Cargo target");
    expect(yaml).toContain("cargo metadata --locked --format-version 1");
    expect(yaml).toContain("--filter-platform x86_64-pc-windows-msvc");
    expect(yaml).toContain("Resolved target dependency is not proof of unsafe API reachability.");
    expect(yaml).toContain("--deny unmaintained --deny unsound --deny yanked");
    expect(yaml).not.toContain("--ignore");
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
