import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texturing hot-path routing", () => {
  test("optional local CLI planning stays conditional and cannot bypass native quality", async () => {
    const [skill, boot, planner] = await Promise.all([
      source("../.agents/skills/lazydesigner-texturing/SKILL.md"),
      source("../distribution/authoring-AGENTS.md"),
      source("scripts/authoring/plan-texture-treatment.ts"),
    ]);
    expect(skill).toContain("Optional deterministic CLI");
    expect(skill).toContain("PLAN_NOT_APPLIED");
    expect(skill).toContain("Known exact-RGBA edits remain on the direct Gateway path");
    expect(boot).toContain("read-only");
    expect(boot).toContain("lazydesigner.exe plan-texture-treatment");
    expect(boot).toContain("four-tool Gateway");
    expect(planner).toContain('visual_verdict: "UNVERIFIED"');
    // Source guidance, not a Codex behavioral or native art-quality PASS.
  });

  test("advanced editor-state tools stay conditional while consolidated material authoring stays primary", async () => {
    const skill = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));
    const supportStart = skill.indexOf("## Conditional Support — Not Default Routing");
    const support = skill.slice(supportStart);

    expect(supportStart).toBeGreaterThan(-1);
    expect(support).toMatch(/not normal hot path/i);
    expect(support).toMatch(/Conditional on user intent/i);

    for (const tool of [
      "color_picker_tool",
      "copy_brush_tool",
      "paint_settings",
      "create_brush_preset",
      "load_brush_preset",
      "texture_selection",
      "texture_layer_management",
      "add_texture_group",
      "list_materials",
      "get_material_info",
      "import_texture_set",
    ]) expect(support).toContain(tool);

    for (const direct of [
      "create_texture",
      "draw_shape_tool",
      "paint_fill_tool",
      "paint_with_brush",
      "eraser_tool",
      "manage_material",
      "manage_material_instances",
    ]) expect(skill).toContain(direct);

    expect(support).toMatch(/no extra discovery\/readback/i);
    expect(support).not.toContain("manage_material");
    expect(skill).not.toContain("create_pbr_material / configure_material / assign_texture_channel");
  });
});
