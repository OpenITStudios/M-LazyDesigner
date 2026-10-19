import { describe, expect, test } from "bun:test";
import { consolidatedInspectionToolDocs, consolidatedMaterialToolDocs } from "@/server/tools";
import { paintToolDocs } from "@/server/tools/paint";
import {
  buildUvAtlasAudit,
  createTextureParameters,
  textureToolDocs,
} from "@/server/tools/texture";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture production discipline", () => {
  test("template creation delegates UV layout and pixel density to Blockbench's native generator", async () => {
    const template = createTextureParameters.parse({
      name: "template",
      type: "template",
      pixel_density: 16,
      rearrange_uv: true,
      power_of_two: true,
      keep_multi_texture_occupancy: true,
      padding: false,
    });
    expect(template.type).toBe("template");
    expect(template.pixel_density).toBe(16);
    expect(template.rearrange_uv).toBe(true);
    expect(() =>
      createTextureParameters.parse({
        name: "template",
        type: "template",
        data: "data:image/png;base64,AA==",
      })
    ).toThrow("owns bitmap generation");

    const texture = await source("server/tools/texture/create.ts");
    for (const marker of [
      'if (type === "template")',
      "TextureGenerator",
      "generator.generateTemplate",
      "Native template generation finished without a valid UV atlas",
      "resolution: pixel_density",
      "rearrange_uv",
      "double_use: keep_multi_texture_occupancy",
      "native UV generation",
      "uv_locked: true",
    ]) {
      expect(texture).toContain(marker);
    }
  });

  test("texture creation keeps 16x16 provisional defaults while production sizing and UV ownership stay explicit", async () => {
    const [standard, skill] = await Promise.all([
      source("../docs/03-authoring/texture/standard.md"),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
    ]);
    const provisional = createTextureParameters.parse({ name: "fixture" });
    const shape = paintToolDocs.find((tool) => tool.name === "draw_shape_tool");
    const brush = paintToolDocs.find((tool) => tool.name === "paint_with_brush");

    expect(provisional.width).toBe(16);
    expect(provisional.height).toBe(16);
    expect(shape).toBeDefined();
    expect(brush).toBeDefined();
    expect(skill).toContain("pass explicit width/height from the current project UV contract");
    expect(skill).toContain("do not rely on omitted size");
    expect(skill).toContain("16×16 blank default is compatibility/provisional behavior");
    expect(standard).toContain("create_texture(type=blank)");
    expect(standard).toContain("create_texture(type=template)");
    expect(standard).toContain("before Texture Styling");
  });

  test("production standard owns one base atlas and 128-based canvases", async () => {
    const standard = await source("../docs/03-authoring/texture/standard.md");
    expect(standard).toContain("128×128");
    expect(standard).toContain("256×256");
    expect(standard).toContain("384×384");
    expect(standard).toContain("512×512");
    expect(standard).toContain("one base-color atlas PNG for the whole model");
    expect(standard).toContain("Do not optimize atlas occupancy as a quality score");
  });

  test("Texture Styling cannot be completed by technical state or placeholder fill", async () => {
    const [standard, skill] = await Promise.all([
      source("../docs/03-authoring/texture/standard.md"),
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
    ]);
    expect(standard).toContain("A placeholder/flat fill may make geometry readable early");
    expect(standard).toContain("is not production completion");
    expect(standard).toContain("Creating an atlas, clearing it, or filling it with one color is **not Texture Styling completion**");
    expect(standard).toContain("Material-Family Palette Ramps");
    expect(standard).toContain("value and hue");
    expect(standard).toContain("Texture Verify asks whether the atlas pixels");
    expect(standard).toContain("fresh Texture Atlas image");
    expect(standard).toContain("fresh affected model view(s)");
    expect(skill).toContain("flat rectangles");
    expect(skill).toContain("generic palette");
    expect(skill).toContain("copied unrelated texture");
    expect(skill).toContain("mapped model-view evidence");
  });

  test("global UV audit is owned by list_textures instead of element inspection", async () => {
    const textureSource = await source("server/tools/texture/read.ts");
    const list = textureToolDocs.find((tool) => tool.name === "list_textures");
    expect(list).toBeDefined();
    expect(textureSource).toContain("buildUvAtlasAudit(");
    expect(textureSource).toContain("uv_audit: uvAudit");
    expect(consolidatedInspectionToolDocs.description).toContain("Bedrock elements");
    expect(consolidatedInspectionToolDocs.description).not.toContain("global UV audit");
  });

  test("global UV audit reports current production-gate semantics", () => {
    const review = buildUvAtlasAudit(
      [
        {
          cube_uuid: "a",
          cube_name: "a",
          face: "north",
          uv: [0, 0, 8, 8],
          box_uv: true,
          autouv: 1,
          mirror_uv: false,
          face_rotation: 0,
        },
        {
          cube_uuid: "b",
          cube_name: "b",
          face: "north",
          uv: [4, 4, 12, 12],
          box_uv: true,
          autouv: 0,
          mirror_uv: false,
          face_rotation: 0,
        },
      ],
      128,
      128
    );

    expect(review.state).toBe("available");
    if (review.state !== "available") throw new Error("expected available audit");
    expect(review.partial_overlap.pair_count).toBe(1);
    expect(review.unlocked_box_uv_cubes.count).toBe(1);
    expect(review.production_gate.state).toBe("review_required");
    expect(review.production_gate.reasons).toContain("PARTIAL_OVERLAP");
    expect(review.production_gate.reasons).toContain("BOX_UV_AUTOUV_UNLOCKED");
  });

  test("texturing skill routes global audit first and face inspection conditionally", async () => {
    const skill = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));
    expect(skill).toMatch(/readiness\s+→ list_textures\(diagnostics=true, diagnostic_scope=uv\|coverage\|seam\|pbr\|full\)/i);
    expect(skill).toMatch(/discovery\s+→ list_textures\(\)/i);
    expect(skill).toMatch(/face mapping\s+→ inspect_elements\(mode=detail\) only when needed/i);
    expect(skill).toContain("final Box UV locked with `autouv=0`");
    expect(skill).toMatch(/no invalid\/out-of-bounds\/partial-overlap/);
  });

  test("texturing uses consolidated material facade instead of public primitive aliases", async () => {
    const [skill, docs] = await Promise.all([
      Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n")),
      source("docs/api.json"),
    ]);
    expect(skill).toContain("manage_material");
    expect(skill).not.toContain("create_pbr_material / configure_material / assign_texture_channel");
    expect(skill).not.toContain("save_material_config");
    expect(consolidatedMaterialToolDocs.name).toBe("manage_material");
    expect(consolidatedMaterialToolDocs.description).toContain("PBR material");
    expect(docs).toContain('"name": "manage_material"');
    expect(docs).not.toContain('"name": "create_pbr_material"');
  });

  test("Texturing keeps semantic ownership while using shared AUTHORING capabilities for upstream correction", async () => {
    const skill = await Promise.all([source("../.agents/skills/lazydesigner-texturing/SKILL.md"), source("../.agents/skills/lazydesigner-texturing/references/fidelity-styling-verification.md")]).then((parts) => parts.join("\n"));
    expect(skill).toContain("Geometry/UV capabilities remain available in the shared AUTHORING Runtime Surface for **Modelling-owned** bounded upstream correction");
    expect(skill).toContain("must not borrow Cube/UV mutation");
    expect(skill).toContain("No Geometry↔Texturing Runtime Surface switch");
    expect(skill).toContain("HANDOFF_REQUIRED");
    expect(skill).toContain("switch_authoring_phase");
    expect(skill).toContain("AUTHORING↔Animation");
    expect(skill).not.toContain("target_phase: geometry");
  });
});
