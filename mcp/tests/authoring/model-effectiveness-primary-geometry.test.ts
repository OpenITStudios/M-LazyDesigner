import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("model creation effectiveness — primary geometry", () => {
  test("Cube mutation results separate execution from visual acceptance", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    expect((cubes.match(/visual_verdict: \"not_evaluated\" as const/g) ?? []).length).toBe(3);
    expect((cubes.match(/execution: \"applied\" as const/g) ?? []).length).toBe(3);
    expect(cubes.toLowerCase()).toContain("reference fidelity was not evaluated");
    expect(cubes).toContain("reference fidelity was not evaluated");
  });

  test("successful placement cannot authorize visual PASS or secondary detail", async () => {
    const [modelling, workflow] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n")),
      source("prompts/bedrock_entity_workflow.md"),
    ]);

    for (const text of [modelling, workflow]) {
      expect(text.toLowerCase()).toContain("tool success");
      expect(text).toContain("PASS");
      expect(text.toLowerCase()).toContain("secondary");
    }
    expect(modelling).toMatch(/primary PASS[^\n]*identity-weighted secondary geometry/);
    expect(modelling).toMatch(/Tool success.*cannot justify `PASS`/);
    expect(workflow).toMatch(/After primary `PASS`, add (?:only )?identity-weighted detail/);
  });

  test("geometry size-warning guidance distinguishes approved scale from native format limits", async () => {
    const [skill, verification, standard] = await Promise.all([
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-modelling/references/verification.md"),
      source("../docs/03-authoring/modelling/standard.md"),
    ]);
    expect(skill).toContain("scale/format warnings");
    expect(verification).toContain("Format.cube_size_limiter");
    expect(verification).toContain("Bedrock Entity");
    expect(verification).toContain("Bedrock Block");
    expect(verification).toContain("one Undo");
    expect(verification).toContain("16 Blockbench units");
    expect(verification).toContain("relevant total");
    expect(standard).toContain("whole-form envelope");
    expect(standard.replace(/\s+/g, " ")).toContain("not a universal Bedrock Entity size box");
  });

  test("under-constrained geometry remains provisional rather than success-by-placement", async () => {
    const modelling = await Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n"));
    expect(modelling).toContain("PROVISIONAL");
    expect(modelling).toContain("placement never verifies it");
    expect(modelling).toContain("Material `UNRESOLVED` → `BLOCKED`");
    expect(modelling).toContain("Tool success, coordinates, bounds, hierarchy, validators, or similarity scores cannot justify `PASS`");
  });
});
