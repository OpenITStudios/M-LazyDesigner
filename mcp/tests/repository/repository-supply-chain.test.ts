import { describe, expect, test } from "bun:test";

type ActionRef = {
  action: string;
  revision: string;
  note: string;
};

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

function actionRefs(workflow: string): ActionRef[] {
  return [...workflow.matchAll(/^\s*-?\s*uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#\s*(.+))?$/gm)].map(
    (match) => ({
      action: match[1],
      revision: match[2],
      note: (match[3] ?? "").trim(),
    })
  );
}

function expectImmutableActions(workflow: string, expectedActions: string[]): void {
  const refs = actionRefs(workflow);
  expect([...new Set(refs.map((entry) => entry.action))].sort()).toEqual([...expectedActions].sort());
  for (const ref of refs) {
    expect(ref.revision).toMatch(/^[0-9a-f]{40}$/);
    if (ref.note) expect(ref.note).toMatch(/^v\d+(?:\.\d+){0,2}$/);
  }
  expect(workflow).not.toMatch(/^\s*-?\s*uses:\s+[^\s]+@(main|master|latest|v\d+)\s*$/gm);
}

describe("repository workflow supply chain", () => {
  test("active verification and distribution workflows pin trusted Actions to immutable revisions", async () => {
    const [repository, authoring, mcp, release, distribution] = await Promise.all([
      source("../.github/workflows/repository-verify.yml"),
      source("../.github/workflows/authoring-policy-verify.yml"),
      source("../.github/workflows/mcp-verify.yml"),
      source("../.github/workflows/release-verify.yml"),
      source("../.github/workflows/managed-distribution.yml"),
    ]);

    for (const workflow of [repository, authoring, release]) {
      expectImmutableActions(workflow, ["actions/checkout", "oven-sh/setup-bun"]);
    }
    expectImmutableActions(mcp, [
      "actions/checkout",
      "oven-sh/setup-bun",
      "actions/upload-artifact",
    ]);
    expectImmutableActions(distribution, [
      "actions/checkout",
      "oven-sh/setup-bun",
      "actions/upload-artifact",
      "actions/download-artifact",
    ]);
  });

  test("verification workflows install only the dependency surface they execute", async () => {
    const [mcpWorkflow, repositoryWorkflow, authoringWorkflow, releaseWorkflow, bunVersion] = await Promise.all([
      source("../.github/workflows/mcp-verify.yml"),
      source("../.github/workflows/repository-verify.yml"),
      source("../.github/workflows/authoring-policy-verify.yml"),
      source("../.github/workflows/release-verify.yml"),
      source("../.bun-version"),
    ]);

    expect(bunVersion.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await Bun.file("bun.lock").exists()).toBe(true);

    for (const workflow of [mcpWorkflow, repositoryWorkflow, authoringWorkflow, releaseWorkflow]) {
      expect(workflow).toContain('bun-version-file: ".bun-version"');
      expect(workflow).toContain("contents: read");
      expect(workflow).toContain("persist-credentials: false");
    }

    expect(repositoryWorkflow).toContain("timeout-minutes: 5");
    expect(authoringWorkflow).toContain("timeout-minutes: 5");
    expect(mcpWorkflow).toContain("timeout-minutes: 10");
    expect(releaseWorkflow).toContain("timeout-minutes: 10");
    expect(mcpWorkflow).toContain("bun install --frozen-lockfile");
    expect(mcpWorkflow).toContain("bun run verify:full");
    expect(mcpWorkflow).toContain('EXPECTED_SHA: ${{ github.sha }}');
    expect(mcpWorkflow).toContain('test "$actual_sha" = "$EXPECTED_SHA"');
    expect(mcpWorkflow).not.toMatch(/contents:\s*write/i);
    expect(mcpWorkflow).not.toMatch(/verify:[^\s"]*live/i);
    expect(releaseWorkflow).toContain("bun install --frozen-lockfile");
    expect(authoringWorkflow).toContain("bun install --frozen-lockfile");
    expect(authoringWorkflow).not.toContain("--production");
    expect(repositoryWorkflow).toContain("bun install --frozen-lockfile");
  });

  test("MCP verification publishes only a read-only exact-SHA verified compatibility artifact", async () => {
    const workflow = await source("../.github/workflows/mcp-verify.yml");
    expect(workflow).toContain("bun run ./scripts/operations/verified-build-artifact.ts write-ci");
    expect(workflow).toContain("bun run verify:full");
    expect(workflow).toContain("name: lazydesigner-mcp-verified");
    expect(workflow).toContain("mcp/dist/lazydesigner_mcp.js");
    expect(workflow).toContain("mcp/dist/lazydesigner-build-provenance.json");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).not.toMatch(/contents:\s*write/i);
    expect(workflow).not.toContain("git push");
  });

  test("static and executable verifiers remain available on demand", async () => {
    const [repo, mcp, json] = await Promise.all([
      source("../.github/workflows/repository-verify.yml"),
      source("../.github/workflows/mcp-verify.yml"),
      source("package.json"),
    ]);
    const scripts = JSON.parse(json).scripts as Record<string, string>;
    expect(repo).toContain("bun run verify:repository");
    expect(mcp).toContain("bun run verify:full");
    expect(mcp).not.toContain("verify:affected");
    expect(scripts["verify:affected"]).toContain("run-affected-execution.ts");
    expect(repo).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(repo).not.toMatch(/^  push:|^  pull_request:|^  schedule:/m);
    expect(mcp).toMatch(/^on:\n  push:\n    branches:\n      - Local\n  workflow_dispatch:/m);
    expect(mcp).not.toMatch(/^  pull_request:|^  schedule:/m);
  });

  test("repository hygiene retains canonical static verification", async () => {
    const workflow = await source("../.github/workflows/repository-verify.yml");
    const scripts = JSON.parse(await source("package.json")).scripts as Record<string, string>;
    expect(workflow).toContain("bun run verify:repository");
    expect(scripts["verify:repository"]).toBe("bun test tests/repository/*.test.ts");
    expect(await Bun.file("../.editorconfig").exists()).toBe(true);
    expect(await Bun.file("../SECURITY.md").exists()).toBe(true);
  });

  test("Bash workflow summaries do not use unsafe command-substitution backticks", async () => {
    const workflows = [
      await source("../.github/workflows/mcp-verify.yml"),
      await source("../.github/workflows/head-proof.yml"),
    ];

    for (const workflow of workflows) {
      for (const line of workflow.split("\n")) {
        if (!/\becho\s+"/.test(line)) continue;
        const body = line.slice(line.indexOf("echo") + 4);
        expect(body).not.toMatch(/(^|[^\\])`/);
      }
    }
  });

  test("supply-chain policy retains least-privilege and pinned-action boundaries", async () => {
    const rules = await source("../GITHUB_RULES.md");
    expect(rules).toMatch(/least-privilege/i);
    expect(rules).toMatch(/pinned\/trusted action versions/i);
    expect(rules).toMatch(/event-derived strings as untrusted input/i);
    expect(rules).toMatch(/pull_request_target/);
  });
});
