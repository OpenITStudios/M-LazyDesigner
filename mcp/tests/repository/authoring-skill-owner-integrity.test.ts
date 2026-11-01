import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("canonical authoring Skill ownership", () => {
  test("authoring phase regressions use current LazyDesigner specialist paths", async () => {
    const phaseSurface = await source("tests/authoring-phase-surface.test.ts");

    for (const canonical of [
      ".agents/skills/lazydesigner-modelling/SKILL.md",
      ".agents/skills/lazydesigner-texturing/SKILL.md",
      ".agents/skills/lazydesigner-animation/SKILL.md",
    ]) {
      expect(phaseSurface).toContain(canonical);
    }

    for (const retired of [
      ".agents/skills/blockit-bedrock-entity-mcp/SKILL.md",
      ".agents/skills/blockbench-bedrock-modelling/SKILL.md",
      ".agents/skills/blockit-bedrock-texturing/SKILL.md",
      ".agents/skills/blockit-bedrock-animation/SKILL.md",
    ]) {
      expect(phaseSurface).not.toContain(retired);
    }
  });

  test("domain specialists keep selected craft in canonical source owners", async () => {
    const [direction, geometry, texture, animation, modellingSkill, texturingSkill, animationSkill] = await Promise.all([
      source("../docs/02-reference/art-direction.md"),
      source("../docs/03-authoring/modelling/decision-cases.md"),
      source("../docs/03-authoring/texture/decision-cases.md"),
      source("../docs/03-authoring/animation/standard.md"),
      source("../.agents/skills/lazydesigner-modelling/SKILL.md"),
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("../.agents/skills/lazydesigner-animation/SKILL.md"),
    ]);
    for (const id of ["VC-FORM","VC-MATERIAL","VC-STYLE","VC-VARIANT","VC-MOTION","VC-EXPRESSION","VC-EMISSION"]) expect(direction).toContain(id);
    expect(geometry).toContain("VC-FORM");
    expect(texture).toContain("VC-EMISSION");
    expect(animation).toContain("Artist-Craft Motion Decisions");
    expect(modellingSkill).toContain("existing G-P cases");
    expect(texturingSkill).toContain("case-tex-p01");
    expect(animationSkill).toContain("Artist-Craft Motion Decisions");
  });

  test("particle authoring remains a bounded Animation specialist route", async () => {
    const [registration, animation] = await Promise.all([
      source("server/runtime/registration.ts"),
      source("../.agents/skills/lazydesigner-animation/SKILL.md"),
    ]);

    expect(registration).toContain("registerParticleTools()");
    expect(registration).toContain("registerParticleResources()");
    expect(animation).toContain("inspect_particle / manage_particle");
    expect(animation).toContain("Particle is asset-only");
  });
});
