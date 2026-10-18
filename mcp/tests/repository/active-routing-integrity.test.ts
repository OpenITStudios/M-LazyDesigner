import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

function backtickedLazyDesignerSkillNames(text: string): string[] {
  return [...text.matchAll(/`(lazydesigner-[a-z0-9-]+)`/g)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
}

describe("active routing integrity", () => {
  test("active repository skill references resolve to canonical skill packages", async () => {
    const canonical = new Set(
      (await readdir("../.agents/skills", { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    );

    const [root, developmentBrief, mcpDevelopment, blockbenchDevelopment] = await Promise.all([
      source("../AGENTS.md"),
      source("../.agents/skills/lazydesigner-development-brief/SKILL.md"),
      source("../.agents/skills/lazydesigner-mcp-development/SKILL.md"),
      source("../.agents/skills/lazydesigner-blockbench-development/SKILL.md"),
    ]);

    const referenced = new Set([
      ...backtickedLazyDesignerSkillNames(root),
      ...backtickedLazyDesignerSkillNames(developmentBrief),
      ...backtickedLazyDesignerSkillNames(mcpDevelopment),
      ...backtickedLazyDesignerSkillNames(blockbenchDevelopment),
    ]);

    for (const name of referenced) {
      expect(canonical.has(name), name).toBe(true);
      expect(await Bun.file(`../.agents/skills/${name}/SKILL.md`).exists(), name).toBe(true);
    }

    for (const retired of [
      ".agents/skills/blockit-bedrock-entity-mcp/SKILL.md",
      ".agents/skills/blockbench-bedrock-modelling/SKILL.md",
      ".agents/skills/blockit-bedrock-texturing/SKILL.md",
      ".agents/skills/blockit-bedrock-animation/SKILL.md",
    ]) expect(root).not.toContain(retired);
  });

  test("full Local CI does not replace canonical specialist routing", async () => {
    const [workflow, root, taxonomy] = await Promise.all([
      source("../.github/workflows/mcp-verify.yml"),
      source("../AGENTS.md"),
      source("../docs/04-system/skill-taxonomy.md"),
    ]);

    expect(workflow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n  workflow_dispatch:/m);
    expect(workflow).toContain("bun run verify:full");
    expect(workflow).not.toMatch(/^  pull_request:|^  schedule:/m);
    expect(root).toContain("LazyDesigner Control");
    for (const skill of [
      "lazydesigner-modelling",
      "lazydesigner-texturing",
      "lazydesigner-animation",
    ]) {
      expect(taxonomy).toContain(skill);
    }
    for (const retired of [
      ".agents/skills/blockbench-bedrock-modelling/",
      ".agents/skills/blockit-bedrock-texturing/",
      ".agents/skills/blockit-bedrock-animation/",
    ]) expect(root).not.toContain(retired);
  });

});
