import { describe, expect, test } from "bun:test";

describe("semantic snapshot affected-execution ownership", () => {
  test("affected planner remains available on demand without an automatic GitHub worktree", async () => {
    const [workflow, pkg, planner, snapshot] = await Promise.all([
      Bun.file("../.github/workflows/mcp-verify.yml").text(),
      Bun.file("package.json").text(),
      Bun.file("scripts/development/plan-affected-execution.ts").text(),
      Bun.file("scripts/development/snapshot-semantic-registry.ts").text(),
    ]);
    const scripts = JSON.parse(pkg).scripts as Record<string, string>;
    expect(scripts["plan:affected"]).toContain("plan-affected-execution.ts");
    expect(scripts["verify:affected"]).toContain("run-affected-execution.ts");
    expect(scripts["snapshot:semantic-registry"]).toContain("snapshot-semantic-registry.ts");
    expect(planner).toContain("planAffectedExecution");
    expect(snapshot).toContain("CAPABILITY_SEMANTIC_REGISTRY");
    expect(workflow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n    paths:\n(?:      - .+\n)+  workflow_dispatch:/m);
    expect(workflow).toContain("bun run verify:full");
    expect(workflow).not.toContain("git worktree add --detach");
    expect(workflow).not.toContain("--previous-semantic-snapshot");
  });
});
