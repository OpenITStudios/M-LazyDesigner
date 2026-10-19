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
  test("routine Local push is scoped while release and full build remain manual", async () => {
    const names = (await readdir("../.github/workflows")).filter(n => n.endsWith(".yml")).sort();
    expect(names).toEqual([...FILES].sort());
    const automatic = new Set(["mcp-verify.yml","desktop-verify.yml","mcp-conformance.yml","dependency-security.yml"]);
    for (const file of FILES) {
      const yaml = await Bun.file("../.github/workflows/" + file).text();
      if (automatic.has(file)) {
        expect(triggers(yaml), file).toEqual(["push","workflow_dispatch"]);
        expect(yaml, file).toContain("  push:\n    branches:\n      - Local\n    paths:");
      } else {
        expect(triggers(yaml), file).toEqual(["workflow_dispatch"]);
      }
      expect(yaml, file).not.toMatch(/^  (?:pull_request|schedule|workflow_run|release|create|delete):/m);
      expect(yaml, file).toContain("contents: read");
    }
    const mcp = await Bun.file("../.github/workflows/mcp-verify.yml").text();
    const desktop = await Bun.file("../.github/workflows/desktop-verify.yml").text();
    expect(mcp).toContain("Verify focused repository contracts and types");
    expect(mcp).toContain("bun run verify:repository && bun run typecheck && bun run typecheck:gateway");
    expect(mcp).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(mcp).toContain("run: bun run verify:full");
    expect(desktop).toContain("focused-source:");
    expect(desktop).toContain("Verify Desktop source and locked Rust tests");
    expect(desktop).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(desktop).toContain("run: npm run build:app");
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

  test("candidate RustSec target classification is evidence-only and fails on graph drift", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("Classify candidate RustSec advisories by locked Windows and Linux target graphs");
    expect(yaml).toContain("--filter-platform x86_64-pc-windows-msvc");
    expect(yaml).toContain("--filter-platform x86_64-unknown-linux-gnu");
    expect(yaml).toContain("rust-upstream-candidate/rustsec-targets.json");
    expect(yaml).toContain("Candidate warning is newly present in Windows graph");
    expect(yaml).toContain("Expected exactly five known candidate warnings; re-triage all new IDs");
    expect(yaml).toContain("strict_rustsec_denials_unchanged");
    expect(yaml).not.toContain("contents: write");
  });

  test("candidate RustSec scan records warnings without weakening production denials", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("Audit generated Rust lockfile with fresh RustSec database (candidate only)");
    expect(yaml).toContain("cargo-audit\" audit --json --file apps/desktop/src-tauri/Cargo.lock --deny unmaintained --deny unsound --deny yanked");
    expect(yaml).toContain("Generated candidate contains vulnerability advisories; cannot be accepted");
    expect(yaml).toContain("RustSec JSON response did not contain authoritative vulnerability count");
    expect(yaml).toContain("rust-upstream-candidate/rustsec.json");
    expect(yaml).not.toContain("contents: write");
  });

  test("same-run Windows Cargo candidate is verified before disposable locked checks", async () => {
    const yaml = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(yaml).toContain("rust-upstream-windows:");
    expect(yaml).toContain("needs: rust-upstream-candidate");
    expect(yaml).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(yaml).toContain("Candidate source identity mismatch.");
    expect(yaml).toContain("Candidate checksum mismatch: $path");
    expect(yaml).toContain("if ($entry['version'] -ne '2.12.3')");
    expect(yaml).toContain("ConvertFrom-Json -AsHashtable");
    expect(yaml).toContain("run: npm audit --audit-level=high");
    expect(yaml).toContain("ConvertFrom-Json -AsHashtable");
    expect(yaml).toContain("$lock[\'packages\'][\'node_modules/\' + $name]");
    expect(yaml).toContain("run: npm ci");
    expect(yaml).toContain("run: npm run verify:source");
    expect(yaml).toContain("run: npm run build:app:shell");
    expect(yaml).toContain("Silent-install candidate shell only in temporary GitHub runner");
    expect(yaml).toContain("Candidate NSIS shell executable missing after silent-install.");
    expect(yaml).toContain("excludes managed-resource bootstrap, publish, signed release");
    expect(yaml).toContain("contents: read");
    expect(yaml).not.toContain("contents: write");
  });

  test("Cargo advisory audit is mandatory and preserves dependency-security integrity", async () => {
    const workflow = await Bun.file("../.github/workflows/dependency-security.yml").text();
    expect(workflow).toContain("rustsec-audit:");
    expect(workflow).toContain("cargo install cargo-audit --locked --version 0.22.2");
    expect(workflow).toContain("audit --file apps/desktop/src-tauri/Cargo.lock --deny unmaintained --deny unsound --deny yanked");
    expect(workflow).not.toContain("--no-fetch");
    const auditCommand = workflow.split("\n").find(line => line.includes("cargo-audit\" audit --file"));
    expect(auditCommand).toBeDefined();
    expect(auditCommand).not.toContain("--ignore");
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
    const auditCommand = yaml.split("\n").find(line => line.includes("cargo-audit\" audit --file"));
    expect(auditCommand).toBeDefined();
    expect(auditCommand).not.toContain("--ignore");
  });

  test("MCP pushes use focused checks; manual full and texture are available", async () => {
    const yaml = await Bun.file("../.github/workflows/mcp-verify.yml").text();
    expect(yaml).toContain("default: full");
    expect(yaml).toContain("options:\n          - full\n          - texture");
    expect(yaml).toContain("if: github.event_name == 'push'");
    expect(yaml).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(yaml).toContain("bun run verify:repository && bun run typecheck && bun run typecheck:gateway");
    expect(yaml).toContain("bun run verify:full");
    expect(yaml).toContain("bun run verify:texture:focused");
    expect(yaml).toContain("requiredSteps.map(name => steps[name])");
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
