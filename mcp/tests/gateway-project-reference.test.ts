import { describe, expect, test } from "bun:test";

describe("Gateway TypeScript project reference", () => {
  test("project graph composes semantic core and Gateway without changing production bundle output", async () => {
    const graph = JSON.parse(
      await Bun.file("tsconfig.project-graph.json").text()
    );
    const gateway = JSON.parse(
      await Bun.file("gateway/tsconfig.project.json").text()
    );

    expect(graph.references).toEqual([
      { path: "./tsconfig.semantic-core.json" },
      { path: "./tsconfig.gateway-shared.json" },
      { path: "./tsconfig.runtime-project.json" },
      { path: "./gateway/tsconfig.project.json" },
    ]);
    expect(gateway.references).toContainEqual({
      path: "../tsconfig.semantic-core.json",
    });
    expect(gateway.references).toContainEqual({
      path: "../tsconfig.gateway-shared.json",
    });
    expect(gateway.compilerOptions.composite).toBe(true);
    expect(gateway.compilerOptions.emitDeclarationOnly).toBe(true);
    expect(gateway.compilerOptions.outDir).toBe("../.cache/gateway-project");
    expect(gateway.include).toContain("../package.json");
    expect(gateway.include).not.toContain("../lib/capabilities/metadata.ts");
  });

  test("CI and canonical MCP verification execute the composite graph", async () => {
    const pkg = JSON.parse(await Bun.file("package.json").text());
    const workflow = await Bun.file("../.github/disabled-workflows/mcp-verify.yml").text();

    expect(pkg.scripts["verify:project-graph"]).toContain(
      "tsc -b tsconfig.project-graph.json"
    );
    expect(pkg.scripts["verify:mcp"]).toContain("bun run verify:types");
    expect(pkg.scripts["verify:types"]).toContain("bun run verify:project-graph");
    expect(workflow).toContain("bun run verify:full");
  });
});
