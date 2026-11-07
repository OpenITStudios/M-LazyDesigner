import { describe, expect, test } from "bun:test";
import { BEDROCK_ENTITY_REGISTRATION_FAMILIES } from
  "@/lib/capabilities/registrationProfile";

const read = (path: string) => Bun.file(path).text();

describe("visual asset scope and source-to-Runtime integration boundary", () => {
  test("Fog/E1 stays removed from the Blockbench product and code", async () => {
    expect(await Bun.file("lib/bedrock/environmentVisualPlanning.ts").exists()).toBe(false);
    expect(await Bun.file("tests/bedrock-environment-visual-planning.test.ts").exists()).toBe(false);
    const product = await read("../docs/01-product/visual-asset-expansion.md");
    const continuation = await read("../docs/05-operations/next-action.md");
    expect(product).toContain("Fog/E1 was explicitly withdrawn");
    expect(product).not.toContain("## E1 —");
    expect(product).not.toContain("| **E1** |");
    expect(continuation).not.toContain("**E1 — SOURCE_PLAN_AUTHORED");
    expect(continuation).not.toContain("environmentVisualPlanning.ts");
  });

  test("Texture Variant has one existing production executor contract, not a new Gateway", async () => {
    const [runtime, extension, registration, variant] = await Promise.all([
      read("server/runtime/contracts/texture.ts"),
      read("server/runtime/extensions.ts"),
      read("server/runtime/registration.ts"),
      read("lib/texture/variantPlan.ts"),
    ]);
    expect(BEDROCK_ENTITY_REGISTRATION_FAMILIES).toContain("textures");
    expect(registration).toContain("registerTextureTools();");
    expect(registration).toContain("applyRuntimeExtensionPipeline();");
    expect(extension).toContain("wireTextureRuntimeContracts");
    expect(runtime).toContain('requireRuntimeToolDefinition("create_texture")');
    expect(runtime).toContain('args.type === "variant"');
    expect(runtime).toContain("createTextureVariantParameters.parse(args)");
    expect(runtime).toContain("planTextureVariantFromBase({");
    expect(runtime).toContain("variant_creation: plan");
    expect(variant).toContain("same_bitmap_dimensions_and_existing_uv_mapping");
  });

  test("model export and project creation do not claim Block or Skin pack codecs", async () => {
    const [creation, modelExport] = await Promise.all([
      read("server/tools/project/project.ts"),
      read("server/tools/io/export.ts"),
    ]);
    expect(creation).toContain("newProject(Formats.bedrock)");
    expect(modelExport).toContain('BLOCKIT_MODEL_CODEC_IDS = ["bedrock", "project"]');
    expect(modelExport).toContain("bedrock_animation");
    expect(modelExport).toContain("requireBedrockEntityProject()");
    expect(modelExport).not.toContain('"skin_pack"');
    expect(modelExport).not.toContain('"block_visual"');
  });

  test("retained planners remain pure contracts without newly invented Runtime tools", async () => {
    for (const path of [
      "lib/bedrock/blockVisualCompatibility.ts",
      "lib/bedrock/attachableBinding.ts",
      "lib/bedrock/attachableContextPreview.ts",
      "lib/bedrock/blockVisualPlanning.ts",
      "lib/texture/itemIconPlanning.ts",
      "lib/texture/blockFlipbookPlanning.ts",
      "lib/texture/appearanceVariantContinuity.ts",
      "lib/bedrock/blockInteractionBounds.ts",
      "lib/texture/classicSkinPlanning.ts",
    ]) {
      const source = await read(path);
      expect(source.length, path).toBeGreaterThan(30);
      expect(source, path).not.toContain("createTool(");
    }
    const activeMap = await read("../docs/04-system/implementation-map.md");
    expect(activeMap).toContain("## Visual Asset Expansion — Source to Runtime Closure");
    expect(activeMap).toContain("Existing source-wired path");
  });
});
