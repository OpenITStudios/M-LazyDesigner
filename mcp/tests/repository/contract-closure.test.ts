import { describe, expect, test } from "bun:test";

async function text(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("MCP dependency closure", () => {
  test("verification layers compose without rerunning repository/authoring subsets in the full gate", async () => {
    const packageJson = JSON.parse(await text("package.json")) as { scripts: Record<string, string> };

    // Installer filesystem cases retain their deadlines in a fresh process.
    expect(packageJson.scripts["test:runtime"]).toBe("bun test tests/*.test.ts tests/benchmark/*.test.ts tests/contracts/*.test.ts tests/development/*.test.ts tests/live/*.test.ts tests/runtime/*.test.ts --path-ignore-patterns '**/managed-install.test.ts' && bun test tests/managed-install.test.ts");
    expect(packageJson.scripts["verify:closure"]).toBe("bun run verify:repository && bun run verify:authoring && bun run docs:check");
    expect(packageJson.scripts["verify:closure"]).not.toContain("verify:mcp");
    expect(packageJson.scripts["verify:mcp"]).toBe(
      "bun run verify:types && bun run verify:contracts && bun run verify:benchmarks && bun run verify:surface-guards && bun run build"
    );
    expect(packageJson.scripts["verify:contracts"]).toContain("bun run test:runtime");
    expect(packageJson.scripts["verify:contracts"]).toContain("bun run verify:authoring");
    expect(packageJson.scripts["verify:benchmarks"]).toContain("bun run benchmark:zero-waste-total");
    expect(packageJson.scripts["verify:benchmarks"]).not.toContain("bun run benchmark:zero-waste-workflow");
    expect(packageJson.scripts["verify:full"]).toBe("bun run verify:repository && bun run verify:mcp");
    expect(packageJson.scripts["verify:release"]).toBe(
      "bun run security:audit && bun run verify:full"
    );
    expect(packageJson.scripts["verify:contracts"]).toContain("bun run docs:check");
  });

  test("generated docs and runtime prompt manifest share the same freshness gate", async () => {
    const freshness = await text("scripts/verify/verify-generated-artifacts-fresh.ts");
    const packageJson = JSON.parse(await text("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(freshness).toContain('{ file: "api.json"');
    expect(freshness).toContain('{ file: "index.html"');
    expect(freshness).toContain('file: "../prompts/manifest.json"');
    expect(freshness).toContain('runBuildScript("generate:owned-artifacts")');
    expect(packageJson.scripts["generate:owned-artifacts"]).toContain(
      "bun run docs:build"
    );
    expect(packageJson.scripts["generate:owned-artifacts"]).toContain(
      "bun run prompts:build"
    );
    expect(packageJson.scripts["generate:owned-artifacts"]).toContain(
      "bun run generate:hybrid4-schemas"
    );
  });

  test("documentation hierarchy keeps semantic owners separated", async () => {
    const [docs, flow, reference, authoring, system, operations] = await Promise.all([
      text("../docs/README.md"),
      text("../docs/01-product/flow.md"),
      text("../docs/02-reference/README.md"),
      text("../docs/03-authoring/README.md"),
      text("../docs/04-system/README.md"),
      text("../docs/05-operations/README.md"),
    ]);

    for (const domain of ["01-product", "02-reference", "03-authoring", "04-system", "05-operations"]) {
      expect(docs).toContain(domain);
    }
    expect(flow).toMatch(/end-to-end|workflow/i);
    expect(reference).toMatch(/reference/i);
    expect(authoring).toMatch(/authoring/i);
    expect(system).toMatch(/system|control/i);
    expect(operations).toMatch(/operations|continuation|proof/i);
  });

  test("authoring stage mirrors are owned by authoring docs and local runbook", async () => {
    const [workflow, runbook, phaseContract] = await Promise.all([
      text("../docs/03-authoring/workflow.md"),
      text("../docs/05-operations/local-acceptance-runbook.md"),
      text("lib/capabilities/authoringStage.ts"),
    ]);

    expect(workflow).toMatch(/USER APPROVAL or authorized autonomous verification/i);
    expect(workflow).toContain("UV Layout PASS");
    expect(workflow).toMatch(/Animation begins only after canonical readiness/i);
    expect(runbook).toContain("Geometry↔Texturing stays on the shared AUTHORING surface");
    expect(runbook).toMatch(/UV readiness preflight[\s\S]*user Geometry APPROVED[\s\S]*UV Layout PASS/);
    expect(phaseContract).toContain("UV Readiness Preflight");
    expect(phaseContract).toContain("Animation Readiness Preflight");
  });

  test("on-demand static and authoring checks retain the existing canonical owners", async () => {
    const [repositoryFlow, authoringFlow, mcpFlow, docs, pkg] = await Promise.all([
      text("../.github/disabled-workflows/repository-verify.yml"),
      text("../.github/disabled-workflows/authoring-policy-verify.yml"),
      text("../.github/disabled-workflows/mcp-verify.yml"),
      text("../docs/README.md"),
      text("package.json"),
    ]);
    const scripts = JSON.parse(pkg).scripts as Record<string, string>;
    expect(docs).toContain("02-reference/");
    expect(docs).toContain("03-authoring/");
    expect(docs).toContain("04-system/");
    expect(scripts["verify:repository"]).toBe("bun test tests/repository/*.test.ts");
    expect(scripts["verify:authoring"]).toBe("bun test tests/authoring/*.test.ts");
    expect(repositoryFlow).toContain("bun run verify:repository");
    expect(authoringFlow).toContain("bun run verify:authoring");
    expect(mcpFlow).toContain("bun run verify:full");
    for (const flow of [repositoryFlow, authoringFlow]) {
      expect(flow).toMatch(/^on:\n  workflow_dispatch:/m);
    }
    expect(mcpFlow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n    paths:\n(?:      - .+\n)+  workflow_dispatch:/m);
    for (const flow of [repositoryFlow, authoringFlow, mcpFlow]) {
      expect(flow).not.toContain("docs/knowledge/");
      expect(flow).not.toContain("docs/foundation/");
    }
  });
  test("on-demand full source verification excludes installed or live Blockbench execution", async () => {
    const packageText = await Bun.file("package.json").text();
    const scripts = JSON.parse(packageText).scripts as Record<string, string>;
    const workflow = await text("../.github/disabled-workflows/mcp-verify.yml");
    expect(scripts["verify:full"]).toBe("bun run verify:repository && bun run verify:mcp");
    expect(scripts["verify:full"]).not.toContain(":live");
    expect(workflow).toContain("bun run verify:full");
    expect(workflow).toContain("live_local_tests: excluded");
  });


});
