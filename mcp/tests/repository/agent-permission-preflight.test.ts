import { describe, expect, test } from "bun:test";
import { evaluatePreflight } from "../../../.agents/permissions/preflight.mjs";

type Case = {
  id: string;
  request: Record<string, unknown>;
  expected: "allow" | "ask" | "deny";
};

describe("repository agent permission preflight", () => {
  test("positive, negative, approval, lane-crossing and path-escape cases", async () => {
    const corpus = JSON.parse(await Bun.file("tests/fixtures/agent-permission-cases.json").text()) as { schemaVersion: 1; cases: Case[] };
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(corpus.cases.map(item => item.expected))).toEqual(new Set(["allow", "ask", "deny"]));
    expect(new Set(corpus.cases.map(item => item.id)).size).toBe(corpus.cases.length);
    for (const item of corpus.cases) {
      const result = evaluatePreflight(item.request);
      expect(result.decision, item.id + ": " + result.reason).toBe(item.expected);
      expect(result.reason.length, item.id).toBeGreaterThan(5);
    }
  });

  test("source mutations require pinned working branch and explicitly declared file paths", () => {
    const request = {
      lane: "DEVELOPMENT", task: "DEVELOP", action: "source-write",
      path: "docs/README.md", authorized_scope: true,
    };
    expect(evaluatePreflight({ ...request, task_scope_paths: ["docs/README.md"] }).decision).toBe("ask");
    expect(evaluatePreflight({ ...request, branch: "Local" }).decision).toBe("ask");
    expect(evaluatePreflight({
      ...request, branch: "Local", task_scope_paths: ["mcp/server/net.ts"],
    }).decision).toBe("deny");
    expect(evaluatePreflight({
      ...request, branch: "Local", task_scope_paths: ["docs/README.md"],
    }).decision).toBe("allow");
    expect(evaluatePreflight({
      ...request, branch: "Harness", task_scope_paths: ["docs/README.md"],
    }).decision).toBe("allow");
    expect(evaluatePreflight({
      ...request, branch: "Harness2", task_scope_paths: ["docs/README.md"],
    }).decision).toBe("deny");
  });

  test("specialist selection never enlarges the active work-lane permission", () => {
    const task = { lane: "IN_USE", task: "REPAIR", action: "source-write", path: "mcp/server/net.ts", authorized_scope: true };
    expect(evaluatePreflight(task).decision).toBe("deny");
    expect(evaluatePreflight({ ...task, specialist: "lazydesigner-mcp-development" }).decision).toBe("deny");
    expect(evaluatePreflight({ ...task, specialist: "lazydesigner-blockbench-development" }).decision).toBe("deny");
  });

  test("preflight is routed through the existing canonical development contract", async () => {
    const [root, standard, taxonomy] = await Promise.all([
      Bun.file("../AGENTS.md").text(),
      Bun.file("../docs/04-system/development-operating-standard.md").text(),
      Bun.file("../docs/04-system/skill-taxonomy.md").text(),
    ]);
    expect(root).toContain("permission preflight");
    expect(standard).toContain(".agents/permissions/preflight.mjs");
    expect(standard).toContain("not a claim of machine-enforced Runtime permissions");
    expect(taxonomy).toContain("SKILL_SYSTEM");
    expect(taxonomy).toContain("ASSET_AUTHORING");
  });
});
