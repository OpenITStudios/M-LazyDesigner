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

  test("visual craft crosswalk covers all source notes and dossiers exactly once", async () => {
    const [geometry, texture, animation, maturity] = await Promise.all([
      source("../docs/03-authoring/modelling/research-sources.md"),
      source("../docs/03-authoring/texture/research-sources.md"),
      source("../docs/03-authoring/animation/research-sources.md"),
      source("../docs/04-system/authoring-knowledge-maturity.md"),
    ]);
    const noteIds = (text: string, prefix: string): string[] =>
      [...text.matchAll(new RegExp("^### (" + prefix + "-\\d{2}) —", "gm"))]
        .map(match => match[1]!);
    const notes = [
      ...noteIds(geometry, "GK"),
      ...noteIds(texture, "TK"),
      ...noteIds(animation, "AK"),
    ];
    expect(noteIds(geometry, "GK")).toHaveLength(16);
    expect(noteIds(texture, "TK")).toHaveLength(19);
    expect(noteIds(animation, "AK")).toHaveLength(21);
    const marker = "## Visual Craft Source Disposition Crosswalk — maintenance only";
    const start = maturity.indexOf(marker);
    expect(start).toBeGreaterThan(0);
    const dossierIds = [...maturity.slice(0, start).matchAll(/^\| (CX-\d{2}) /gm)]
      .map(match => match[1]!);
    expect(dossierIds).toHaveLength(15);
    const crosswalk = maturity.slice(start).split("\n## ")[0]!;
    const rows = crosswalk.split("\n").filter(line =>
      /^\| (?:VC-[A-Z]+|EVIDENCE_ONLY) \|/.test(line));
    expect(rows.map(row => row.split("|")[1]!.trim())).toEqual([
      "VC-FORM", "VC-MATERIAL", "VC-STYLE", "VC-VARIANT",
      "VC-MOTION", "VC-EXPRESSION", "VC-EMISSION", "EVIDENCE_ONLY",
    ]);
    const mapped: string[] = [];
    for (const row of rows) {
      const columns = row.split("|").slice(1, -1).map(cell => cell.trim());
      expect(columns).toHaveLength(6);
      for (let index = 0; index < 4; index++) {
        const ids = [...columns[index + 1]!.matchAll(/\b(?:GK|TK|AK|CX)-\d{2}\b/g)]
          .map(match => match[0]);
        expect(ids.every(id => id.startsWith(["GK", "TK", "AK", "CX"][index] + "-")))
          .toBe(true);
        mapped.push(...ids);
      }
    }
    expect(mapped).toHaveLength(71);
    expect(new Set(mapped).size).toBe(71);
    expect(mapped.sort()).toEqual([...notes, ...dossierIds].sort());
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
