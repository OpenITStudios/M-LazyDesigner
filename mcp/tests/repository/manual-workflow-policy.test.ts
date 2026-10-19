import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const MANUAL_DISTRIBUTION = ["desktop-draft-release.yml", "managed-distribution.yml"] as const;
const RETIRED_CI = [
  "authoring-policy-verify.yml",
  "dependency-security.yml",
  "desktop-verify.yml",
  "head-proof.yml",
  "mcp-conformance.yml",
  "mcp-verify.yml",
  "release-readiness.yml",
  "release-verify.yml",
  "repository-verify.yml"
] as const;

describe("disabled CI policy on Local", () => {
  test("no CI verification workflow remains runnable from GitHub Actions", async () => {
    const workflowFiles = (await readdir("../.github/workflows")).filter(name => /\.ya?ml$/.test(name)).sort();
    expect(workflowFiles).toEqual([...MANUAL_DISTRIBUTION].sort());
    for (const path of workflowFiles) {
      const source = await Bun.file("../.github/workflows/" + path).text();
      expect(source).toContain("  workflow_dispatch:");
      expect(source).not.toMatch(/^  (?:push|pull_request|schedule|workflow_run):/m);
    }
  });

  test("historical verification workflows remain inert, recoverable, and outside workflow discovery", async () => {
    const archive = (await readdir("../.github/disabled-workflows")).filter(name => /\.ya?ml$/.test(name)).sort();
    expect(archive).toEqual([...RETIRED_CI].sort());
    for (const name of archive) {
      const source = await Bun.file("../.github/disabled-workflows/" + name).text();
      expect(source).toContain("name:");
    }
  });

  test("Tauri dependency checks are local and explicit, never implied by disabled CI", async () => {
    const manifest = JSON.parse(await Bun.file("../apps/desktop/package.json").text());
    const lock = JSON.parse(await Bun.file("../apps/desktop/package-lock.json").text());
    expect(lock.packages[""].dependencies["@tauri-apps/api"]).toBe(manifest.dependencies["@tauri-apps/api"]);
    expect(lock.packages[""].devDependencies["@tauri-apps/cli"]).toBe(manifest.devDependencies["@tauri-apps/cli"]);
  });
});
