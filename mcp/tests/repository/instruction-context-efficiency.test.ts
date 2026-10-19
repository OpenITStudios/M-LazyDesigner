import { describe, expect, test } from "bun:test";

async function text(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("repository instruction/context efficiency", () => {
  test("persistent repository instruction files stay bounded without losing core safety semantics", async () => {
    const [root, mcp] = await Promise.all([
      text("../AGENTS.md"),
      text("AGENTS.md"),
    ]);

    expect(root.length).toBeLessThan(9_500);
    expect(mcp.length).toBeLessThan(9_000);

    for (const invariant of [
      "Capability/intelligence loss is forbidden as an efficiency technique",
      "structuredContent",
      "Cost to Accepted Result",
      "persistent Gateway",
      "not auto-retried",
      "Tests are evidence",
    ]) {
      expect(mcp).toContain(invariant);
    }
  });

  test("prompt-cache contract keeps common prefix, stage extension, dynamic tail and compaction distinct", async () => {
    const contract = await text("../docs/04-system/prompt-cache-and-compaction.md");

    for (const invariant of [
      "CROSS-STAGE COMMON PREFIX CANDIDATE",
      "STAGE-STABLE EXTENSION",
      "DYNAMIC TAIL",
      "measure:model-context",
      "continuationCheckpoint.ts",
      "response | compaction",
      "map:development",
      "benchmark:zero-waste-total",
      "Never sum static-prefix bytes and dynamic bytes",
    ]) {
      expect(contract).toContain(invariant);
    }
    expect(contract).toContain("does not own arbitrary Codex/chat history");
    expect(contract).toContain("Quality PASS");
  });

  test("Local scoped-on-push and manual full/texture MCP verification provide distinct evidence", async () => {
    const [workflow, pkg] = await Promise.all([
      text("../.github/workflows/mcp-verify.yml"),
      text("package.json"),
    ]);
    const scripts = JSON.parse(pkg).scripts as Record<string, string>;
    expect(workflow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n    paths:\n(?:      - .+\n)+  workflow_dispatch:/m);
    expect(workflow).toContain("Verify focused repository contracts and types");
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).not.toMatch(/^  (?:pull_request|schedule|workflow_run):/m);
    expect(workflow).toContain("default: full");
    expect(workflow).toContain("options:\n          - full\n          - texture");
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.verification == 'texture' }}");
    expect(workflow).toContain("run: bun run verify:texture:focused");
    expect(workflow).toContain("required_steps: requiredSteps");
    expect(workflow).toContain("MCP_TEXTURE_SOURCE_NON_NATIVE");
    expect(workflow).toContain("MCP_SOURCE_NON_NATIVE");
    expect(workflow).toContain("requiredSteps.map(name => steps[name])");
    expect(workflow).toContain("bun-version-file: \".bun-version\"");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("run: bun run verify:full");
    expect(scripts["verify:texture:focused"]).toContain("tests/texture-seam-continuity.test.ts");
    expect(scripts["verify:texture:focused"]).toContain("tests/texture-geometry-signal-compiler.test.ts");
    expect(scripts["verify:texture:focused"]).toContain("tests/texture-masks.test.ts");
    expect(scripts["verify:texture:focused"]).toContain("tests/texture-treatment-intelligence.test.ts");
    expect(scripts["verify:texture:focused"]).toContain("bun run typecheck");
    expect(scripts["verify:texture:focused"]).not.toContain("verify:benchmarks");
    expect(scripts["verify:texture:focused"]).not.toContain("bun run build");
  });

  test("pinned Bun is single-source across Linux and Windows verification", async () => {
    const [versionFile, repositoryWorkflow, mcpWorkflow, managedWorkflow, desktopWorkflow, pkg] =
      await Promise.all([
        text("../.bun-version"),
        text("../.github/workflows/repository-verify.yml"),
        text("../.github/workflows/mcp-verify.yml"),
        text("../.github/workflows/managed-distribution.yml"),
        text("../.github/workflows/desktop-verify.yml"),
        text("package.json"),
      ]);
    const version = versionFile.trim();
    // A stable exact version; this is not a requirement to remain on any
    // one historical release. A future upgrade edits the canonical pin.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(repositoryWorkflow).toContain('bun-version-file: ".bun-version"');
    expect(mcpWorkflow).toContain('bun-version-file: ".bun-version"');
    expect(managedWorkflow).toContain('bun-version-file: .bun-version');
    for (const windowsWorkflow of [managedWorkflow, desktopWorkflow]) {
      expect(windowsWorkflow).toContain(".bun-version");
      expect(windowsWorkflow).toContain("bun-windows-x64-baseline.zip");
      expect(windowsWorkflow).toContain("bun-v${{ steps.bun-pin.outputs.version }}");
    }
    // Do not silently switch typecheck or regenerate dependencies as a
    // side effect of the Bun runtime pin; these require separate proof.
    const scripts = JSON.parse(pkg).scripts as Record<string, string>;
    expect(scripts.typecheck).toBe("tsc --noEmit");
    expect(scripts["typecheck:gateway"]).toContain("tsc -p gateway/tsconfig.json");
    expect(mcpWorkflow).toContain("bun install --frozen-lockfile");
  });

  test("manual repository verification stays independent of automatic MCP verification", async () => {
    const [repositoryWorkflow, mcpWorkflow, pkg] = await Promise.all([
      text("../.github/workflows/repository-verify.yml"),
      text("../.github/workflows/mcp-verify.yml"),
      text("package.json"),
    ]);
    const scripts = JSON.parse(pkg).scripts as Record<string, string>;
    expect(repositoryWorkflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(mcpWorkflow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n    paths:\n(?:      - .+\n)+  workflow_dispatch:/m);
    expect(repositoryWorkflow).toContain("bun run verify:repository");
    expect(mcpWorkflow).toContain("bun run verify:full");
    expect(scripts["verify:repository"]).toBe("bun test tests/repository/*.test.ts");
    expect(scripts["verify:full"]).toContain("bun run verify:mcp");
    expect(mcpWorkflow).not.toContain("docs/04-system/prompt-cache-and-compaction.md");
  });

});
