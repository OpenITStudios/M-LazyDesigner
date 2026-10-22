import { describe, expect, test } from "bun:test";
import { getAllToolDefinitions, tools } from "@/lib/factories";
import { PAINT_TEXTURE_TRANSACTION_TOOL_NAME } from "@/lib/paintTransactionPolicy";
import { getToolRegistrationFamily } from "@/server/tools";
import { createProjectParameters } from "@/server/tools/project";
import {
  TEXTURE_RUNTIME_EXACT_BRUSH_SETTINGS,
  TEXTURE_RUNTIME_PROJECT_INPUT,
} from "../../scripts/verify/verify-texture-runtime-live";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture runtime live acceptance contract", () => {
  test("actual live fixture payload matches the canonical project schema", () => {
    expect(createProjectParameters.safeParse(TEXTURE_RUNTIME_PROJECT_INPUT).success).toBe(true);
  });
  test("runtime surface exposes the transaction, variant, and focused evidence contracts without regressing legacy texture creation", () => {
    const definitions = getAllToolDefinitions();
    const createTexture = definitions.create_texture;
    const getTexture = definitions.get_texture;
    const paintTransaction = definitions[PAINT_TEXTURE_TRANSACTION_TOOL_NAME];
    const exactBrush = definitions.paint_with_brush;
    const paintSettings = definitions.paint_settings;
    const layerManagement = definitions.texture_layer_management;

    expect(createTexture).toBeDefined();
    expect(getTexture).toBeDefined();
    expect(paintTransaction).toBeDefined();
    expect(exactBrush).toBeDefined();
    expect(paintSettings).toBeDefined();
    expect(layerManagement).toBeDefined();
    expect(tools[PAINT_TEXTURE_TRANSACTION_TOOL_NAME]?.enabled).toBe(true);
    expect(tools.paint_with_brush?.enabled).toBe(true);
    expect(tools.texture_layer_management?.enabled).toBe(true);
    expect(getToolRegistrationFamily(PAINT_TEXTURE_TRANSACTION_TOOL_NAME)).toBe("paint");
    expect(getToolRegistrationFamily("create_texture")).toBe("textures");
    expect(getToolRegistrationFamily("get_texture")).toBe("textures");
    expect(getToolRegistrationFamily("paint_with_brush")).toBe("paint");
    expect(getToolRegistrationFamily("texture_layer_management")).toBe("paint");
    expect(exactBrush.parameterSchema.safeParse({
      texture_id: "base-texture",
      coordinates: [{ x: 1, y: 1 }],
      connect_strokes: false,
      brush_settings: {
        ...TEXTURE_RUNTIME_EXACT_BRUSH_SETTINGS,
        color: "#00CC66FF",
      },
    }).success).toBe(true);
    expect(layerManagement.parameterSchema.safeParse({
      action: "create_layer",
      texture_id: "variant-texture",
      layer_name: "acceptance_ink",
    }).success).toBe(true);
    expect(paintSettings.parameterSchema.safeParse({
      mirror_painting: { enabled: false },
      lock_alpha: false,
      color_erase_mode: false,
    }).success).toBe(true);

    const blank = createTexture.parameterSchema.safeParse({ name: "blank" });
    expect(blank.success).toBe(true);
    if (blank.success) {
      expect(blank.data.type).toBe("blank");
    }
    expect(
      createTexture.parameterSchema.safeParse({
        type: "template",
        name: "template",
      }).success
    ).toBe(true);

    expect(
      createTexture.parameterSchema.safeParse({
        type: "variant",
        name: "variant",
        source_texture_id: "base-texture",
        group: "variant-group",
      }).success
    ).toBe(true);
    expect(
      createTexture.parameterSchema.safeParse({
        type: "variant",
        name: "variant",
        group: "variant-group",
      }).success
    ).toBe(false);
    expect(
      createTexture.parameterSchema.safeParse({
        type: "variant",
        name: "variant",
        source_texture_id: "base-texture",
        group: "variant-group",
        width: 128,
      }).success
    ).toBe(false);

    const revision = `sha256:4x4:${"a".repeat(64)}`;
    expect(
      getTexture.parameterSchema.safeParse({
        texture: "base-texture",
        region: { x: 0, y: 0, width: 4, height: 4 },
        expected_revision: revision,
      }).success
    ).toBe(true);
    expect(
      getTexture.parameterSchema.safeParse({
        texture: "base-texture",
        region: { x: 0, y: 0, width: 0, height: 4 },
      }).success
    ).toBe(false);
    expect(
      getTexture.parameterSchema.safeParse({
        texture: "base-texture",
        unknown_evidence_field: true,
      }).success
    ).toBe(false);

    expect(
      paintTransaction.parameterSchema.safeParse({
        texture_id: "base-texture",
        expected_revision: revision,
        operations: [
          {
            operation: "fill_rect",
            color: "#112233FF",
            rect: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      paintTransaction.parameterSchema.safeParse({
        texture_id: "base-texture",
        expected_revision: revision,
        compute: [
          {
            operation: "generated_gradient_map",
            args: {
              base_color: "#845442",
              steps: 5,
              mode: "nearest",
            },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      paintTransaction.parameterSchema.safeParse({
        texture_id: "base-texture",
        expected_revision: revision,
        compute: [{ operation: "posterize", args: { levels: 4 } }],
        operations: [
          {
            operation: "fill_rect",
            color: "#112233FF",
            rect: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }).success
    ).toBe(false);

    expect(
      paintTransaction.parameterSchema.safeParse({
        texture_id: "base-texture",
        expected_revision: revision,
        mutations: [
          {
            operation: "paint_pixels",
            color: "#112233FF",
            coordinates: [{ x: 0, y: 0 }],
          },
        ],
      }).success
    ).toBe(false);
  });

  test("one disposable live verifier owns the end-to-end Blockbench boundary", async () => {
    const script = await source("scripts/verify/verify-texture-runtime-live.ts");
    const pkg = JSON.parse(await source("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.["verify:texture-runtime-live"]).toBe(
      "bun run ./scripts/verify/verify-texture-runtime-live.ts"
    );
    for (const marker of [
      "project_uuid",
      "get_project_info",
      "PAINT_TEXTURE_TRANSACTION_TOOL_NAME",
      "expected_revision",
      "changed since",
      "fill_rect",
      "set_pixels",
      "undo",
      "redo",
      "variant_target_isolation",
      "focused_png_delivery",
      "stale_revision_rejected",
      "exact_brush_base_revision",
      "layered_brush_composite_revision",
      "exact_brush_undo_redo",
      "layer_target_receipt",
      "layered_transaction_rejected",
      "layered_composite_readback",
      "layered_variant_isolation",
    ]) {
      expect(script).toContain(marker);
    }
    expect(script).toContain('type: "variant"');
    expect(script).toContain('is_material: false');
    expect(script).toContain('region: { x: 0, y: 0, width: 4, height: 4 }');
    expect(script).toContain("JSON.stringify(baseBefore).includes(\"rgba\") === false");
    expect(script).not.toContain("custom JSON");
    expect(script).toContain('mode === "exact_pixels"');
    expect(script).toContain('verification_scope === "native_edit_canvas_rgba"');
    expect(script).toContain('layeredTarget.layer_uuid === inkLayer.uuid');
    expect(script).toContain('revisionOf(layeredUndo, "get_texture layered brush undo")');
    expect(script).toContain('revisionOf(layeredRedo, "get_texture layered brush redo")');
  });
});