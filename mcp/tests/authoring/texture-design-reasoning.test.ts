import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture design reasoning", () => {
  test("canonical texture standard separates UV Layout, Texture Atlas, Texture Styling, and Texture Verify", async () => {
    const standard = await source("../docs/03-authoring/texture/standard.md");
    const modelling = await Promise.all([source("../.agents/skills/lazydesigner-modelling/SKILL.md"), source("../.agents/skills/lazydesigner-modelling/references/correction.md"), source("../.agents/skills/lazydesigner-modelling/references/uv-layout.md"), source("../.agents/skills/lazydesigner-modelling/references/verification.md")]).then((parts) => parts.join("\n"));
    const texturing = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));

    for (const term of [
      "UV LAYOUT",
      "TEXTURE ATLAS",
      "TEXTURE STYLING",
      "TEXTURE VERIFY",
      "material",
      "form",
      "contact",
      "edge",
      "identity",
    ]) expect(standard.toUpperCase()).toContain(term.toUpperCase());

    expect(standard).toContain("Texture Styling supports geometry; it does not repair geometry");
    expect(modelling).toContain("surface-only detail reserved for Texture");
    expect(await source("../docs/03-authoring/modelling/standard.md")).toContain("Use Texture for surface information");
    expect(texturing.toLowerCase()).toContain("atlas");
    expect(texturing).toContain("Texture Styling");
  });

  test("texture workflow requires staged material and form reasoning rather than a flat color fill", async () => {
    const texturing = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));

    for (const term of [
      "palette",
      "ramp",
      "material",
      "face",
      "form",
      "contact",
      "occlusion",
      "edge",
      "hue",
      "identity",
      "detail",
      "noise",
      "alpha",
    ]) expect(texturing.toLowerCase()).toContain(term);

    expect(texturing).toContain("BASE PASS");
    expect(texturing).toContain("VALUE / FORM PASS");
    expect(texturing).toContain("IDENTITY PASS");
    expect(texturing).toContain("SECONDARY DETAIL PASS");
    expect(texturing).toContain("VERIFY");
    // Pattern planning is a source-only helper; production Codex still uses
    // the existing Gateway capabilities and current mapped-view evidence.
    expect(texturing).toContain("not a callable Gateway capability");
    expect(texturing).toContain("pattern_observation");
    expect(texturing).toContain("invoke_capability");
    expect(texturing).toContain("capture_model_views");
  });

  test("texturing specialist closes a face coverage ledger before visual approval", async () => {
    const texturing = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));

    expect(texturing).toContain("Face Coverage Ledger");
    for (const state of [
      "UNPAINTED",
      "BASE_ONLY",
      "STYLED",
      "INTENTIONAL_FLAT",
      "INTENTIONAL_TRANSPARENT",
      "SHARED",
    ]) expect(texturing).toContain(state);
    expect(texturing).toContain("optimization_opportunities.coverage.gate");
    expect(texturing).toContain("FACE_ACCOUNTING_INCOMPLETE");
    expect(texturing).toContain("one `list_textures`");
    expect(texturing).toContain("material cohorts");
  });

  test("workflow prompt contains texture material and form stages", async () => {
    const [workflow, contract] = await Promise.all([
      source("prompts/bedrock_entity_workflow.md"),
      source("lib/prompts/contract.ts"),
    ]);

    expect(workflow).toContain("## Texture Styling");
    for (const stage of [
      "BASE PASS",
      "VALUE / FORM PASS",
      "IDENTITY PASS",
      "SECONDARY DETAIL PASS",
      "VERIFY",
    ]) expect(workflow).toContain(stage);
    for (const term of [
      "palette roles",
      "material zones",
      "face-aware shading",
      "contact/occlusion",
      "edge treatment",
      "identity marks",
    ]) expect(workflow).toContain(term);
    expect(contract).toContain("texturing: AUTHORING_WORKFLOW_SECTIONS");
  });

  test("texture standard keeps crisp pixel-art alpha intentional", async () => {
    const standard = await source("../docs/03-authoring/texture/standard.md");
    expect(standard).toContain("default authored alpha intent is **0 or 255**");
    expect(standard).toContain("Intermediate alpha is valid only when material behavior requires translucency/blending");
  });
});
