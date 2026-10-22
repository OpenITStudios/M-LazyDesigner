import { describe, expect, test } from "bun:test";
import {
  textureLayerManagementParameters,
} from "@/server/tools/paint";
import {
  preflightLayerMetadataBatch,
  requireFlatLayerStructure,
  resolveExactBrushLayerTarget,
  requireExactBrushLayerUnchanged,
} from "@/server/tools/paint/layerState";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("texture layer management hardening", () => {
  test("layer-targeted actions require explicit semantic identity", () => {
    for (const action of [
      "delete_layer",
      "duplicate_layer",
      "merge_down",
      "set_opacity",
      "set_blend_mode",
      "move_layer",
      "rename_layer",
    ] as const) {
      expect(
        textureLayerManagementParameters.safeParse({
          action,
          ...(action === "set_opacity" ? { opacity: 50 } : {}),
          ...(action === "set_blend_mode" ? { blend_mode: "multiply" } : {}),
          ...(action === "move_layer" ? { target_index: 0 } : {}),
          ...(action === "rename_layer" ? { layer_name: "renamed" } : {}),
        }).success,
        action
      ).toBe(false);
    }

    expect(
      textureLayerManagementParameters.safeParse({
        action: "set_opacity",
        layer_id: "layer-a",
        opacity: 50,
      }).success
    ).toBe(true);

    expect(
      textureLayerManagementParameters.safeParse({
        action: "flatten_layers",
      }).success
    ).toBe(true);
  });

  test("batch_metadata accepts explicit coherent metadata updates only", () => {
    expect(
      textureLayerManagementParameters.safeParse({
        action: "batch_metadata",
        updates: [
          { layer_id: "shadow", opacity: 60, blend_mode: "multiply" },
          { layer_id: "highlight", name: "highlights", target_index: 2 },
        ],
      }).success
    ).toBe(true);

    expect(
      textureLayerManagementParameters.safeParse({
        action: "batch_metadata",
        updates: [{ layer_id: "shadow" }],
      }).success
    ).toBe(false);

    expect(
      textureLayerManagementParameters.safeParse({
        action: "batch_metadata",
      }).success
    ).toBe(false);
  });


  test("exact brush uses active native pixel layer identity, never implicit bitmap fallback", () => {
    const a = { uuid: "layer-a", name: "Ink", type: "pixel_layer" };
    const b = { uuid: "layer-b", name: "Shade", type: "pixel_layer" };
    let active: unknown = a;
    const texture = {
      name: "Atlas",
      layers_enabled: true,
      layers: [a, b],
      selected_layer: a,
      getActiveLayer: () => active,
    } as unknown as Texture;

    const target = resolveExactBrushLayerTarget(texture);
    expect(target).toMatchObject({
      mode: "active_layer", layer: a, layer_uuid: "layer-a",
    });
    expect(() => requireExactBrushLayerUnchanged(texture, target)).not.toThrow();

    active = b;
    expect(() => requireExactBrushLayerUnchanged(texture, target))
      .toThrow("differs from the selected texture layer");
    (texture as any).selected_layer = b;
    expect(() => requireExactBrushLayerUnchanged(texture, target))
      .toThrow("active layer changed during native painting");

    (texture as any).layers = [];
    expect(() => resolveExactBrushLayerTarget(texture))
      .toThrow("no pixel layers");
    (texture as any).layers = [a, b];
    active = { uuid: "foreign", name: "Foreign", type: "pixel_layer" };
    expect(() => resolveExactBrushLayerTarget(texture))
      .toThrow("not owned by the target texture");

    active = a;
    (texture as any).selected_layer = a;
    (texture as any).layers = [a, { ...b, uuid: "layer-a" }];
    expect(() => resolveExactBrushLayerTarget(texture))
      .toThrow("UUID is missing or ambiguous");

    (texture as any).layers = [a, b];
    (a as any).type = "layer_group";
    expect(() => resolveExactBrushLayerTarget(texture))
      .toThrow("not a layer group or unsupported layer kind");

    const plain = { ...texture, layers_enabled: false, getActiveLayer: undefined } as unknown as Texture;
    expect(resolveExactBrushLayerTarget(plain)).toEqual({
      mode: "base_texture", layer: null, layer_uuid: null,
    });
    const baseTarget = resolveExactBrushLayerTarget(plain);
    expect(() => requireExactBrushLayerUnchanged(plain, baseTarget)).not.toThrow();
    (plain as any).layers_enabled = true;
    expect(() => requireExactBrushLayerUnchanged(plain, baseTarget)).toThrow();
  });

  test("layer binding is resolved before Undo and rechecked around Texture.edit", async () => {
    const source = await Bun.file("server/tools/paint/brush.ts").text();
    const start = source.indexOf("if (exactPixelMode) {");
    const end = source.indexOf('Undo.finishEdit("Paint exact texture pixels")', start);
    const block = source.slice(start, end);
    const capture = block.indexOf("const layerTarget = resolveExactBrushLayerTarget(texture)");
    const undo = block.indexOf("Undo.initEdit(undoAspects)");
    const callback = block.indexOf("texture.edit(");
    const beforeWrite = block.indexOf("requireExactBrushLayerUnchanged(texture, layerTarget)", callback);
    const nativeWrite = block.indexOf("env.ctx.fillRect(");
    const afterWrite = block.lastIndexOf("requireExactBrushLayerUnchanged(texture, layerTarget)");
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(undo).toBeGreaterThan(capture);
    expect(callback).toBeGreaterThan(undo);
    expect(beforeWrite).toBeGreaterThan(callback);
    expect(nativeWrite).toBeGreaterThan(beforeWrite);
    expect(afterWrite).toBeGreaterThan(nativeWrite);
    expect(block).toContain("undoAspects.layers = [layerTarget.layer]");
    expect(block).toContain("undoAspects.textures = [texture]");
    expect(source).toContain('verification_scope: "native_edit_canvas_rgba"');
  });

  test("runtime resolves layers inside the requested texture instead of global selection", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");
    const layerState = await source("server/tools/paint/layerState.ts");
    expect(layerState).toContain("export function resolveManagedTextureLayer(");
    expect(layerState).toContain("const uuidMatch = layers.find");
    expect(layerState).toContain("const nameMatches = layers.filter");
    expect(layerState).toContain("Pass the exact layer UUID");
    expect(paint).toContain("resolveManagedTextureLayer(texture, layer_id!)");
    expect(paint).not.toContain("if (!TextureLayer.selected)");
    expect(paint).not.toContain("const layerToDelete = TextureLayer.selected");
    expect(paint).not.toContain("TextureLayer.selected.mergeDown(false)");
  });

  test("Undo scopes follow native Blockbench layer semantics instead of double-snapshotting", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");

    expect(paint).not.toContain(
      "textures: [texture],\n                layers: texture.layers,\n                bitmap: true"
    );

    for (const action of ["set_opacity", "set_blend_mode", "rename_layer"]) {
      const start = paint.indexOf(`if (action === "${action}")`);
      const end = paint.indexOf("\n              if (action ===", start + 1);
      const block = paint.slice(start, end === -1 ? undefined : end);
      expect(block, action).toContain("Undo.initEdit({ layers: [target] })");
      expect(block, action).not.toContain("bitmap: true");
      expect(block, action).not.toContain("textures: [texture]");
    }

    const moveStart = paint.indexOf('if (action === "move_layer")');
    const moveEnd = paint.indexOf('if (action === "rename_layer")', moveStart);
    const move = paint.slice(moveStart, moveEnd);
    expect(move).toContain("Undo.initEdit({ textures: [texture] })");
    expect(move).not.toContain("bitmap: true");
  });

  test("batch metadata preflights once and recomposes at most once", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");
    const start = paint.indexOf('if (action === "batch_metadata")');
    const end = paint.indexOf('if (action === "create_layer")', start);
    const block = paint.slice(start, end);

    expect(block).toContain("preflightLayerMetadataBatch(");
    expect(block).toContain("Undo.initEdit(undoAspects)");
    expect(block.match(/texture\.updateChangesAfterEdit\(\)/g)?.length ?? 0).toBe(1);
    expect(block.match(/refreshLayerInterface\(/g)?.length ?? 0).toBe(2);
    expect(block).toContain("update_count:");
    expect(block).toContain("recomposed:");
    expect(block).toContain("changes:");
  });

  test("batch metadata rejects duplicate targets and final name collisions before Undo", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");

    const layerState = await source("server/tools/paint/layerState.ts");
    expect(layerState).toContain("requireDistinctBatchLayerTargets");
    expect(layerState).toContain("contains duplicate layer target");
    expect(layerState).toContain("would create duplicate layer name");
    const preflight = layerState.slice(
      layerState.indexOf("export function preflightLayerMetadataBatch"),
      layerState.indexOf("export type LayerMetadataBatchPlan")
    );
    expect(paint).toContain("preflightLayerMetadataBatch(");
    expect(preflight).not.toContain("Undo.initEdit");
  });

  test("batch metadata rejects an all-no-op cohort before Undo", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");
    const layerState = await source("server/tools/paint/layerState.ts");
    const preflight = layerState.slice(
      layerState.indexOf("export function preflightLayerMetadataBatch"),
      layerState.indexOf("export type LayerMetadataBatchPlan")
    );
    expect(preflight).toContain("const anyChange = resolved.some");
    expect(preflight).toContain("already matches the requested final layer metadata");
    expect(preflight).not.toContain("Undo.initEdit");
    const beforeUndo = paint.slice(
      paint.indexOf('if (action === "batch_metadata")'),
      paint.indexOf("Undo.initEdit(undoAspects)")
    );
    expect(beforeUndo).toContain("preflightLayerMetadataBatch(");
  });

  test("flatten is native-only and fails closed when native semantics are unavailable", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");
    const start = paint.indexOf('if (action === "flatten_layers")');
    const block = paint.slice(start);

    const nativeGate = await source("lib/blockbench/nativeFeatureGates.ts");
    expect(block).toContain("supportsNativeTextureFlatten(texture)");
    expect(nativeGate).toContain('typeof (texture as { flatten?: unknown }).flatten === "function"');
    expect(block).toContain("Refusing approximate fallback");
    expect(block).toContain("texture.flatten()");
    expect(block).not.toContain('document.createElement("canvas")');
    expect(block).not.toContain('globalCompositeOperation = "source-over"');
  });

  test("layer mutations return compact continuation state", async () => {
    const paint = await source("server/tools/paint/selectionLayers.ts");

    for (const marker of [
      "layerContinuationState(texture",
      "textureLayerContinuationState(texture)",
      "structuredContent:",
      "removed_layer:",
      "previous_index:",
      "previous_name:",
      "flattened_layer_count:",
      "native_flatten: true",
    ]) {
      expect(paint).toContain(marker);
    }
  });

  test("no-op and ambiguity checks run before Undo", async () => {
    const layerState = await source("server/tools/paint/layerState.ts");
    expect(layerState).toContain("already has opacity");
    expect(layerState).toContain("already uses blend mode");
    expect(layerState).toContain("already at index");
    expect(layerState).toContain("already has the exact name");
    expect(layerState).toContain("collides case-insensitively");
  });
});

describe("Blockbench 5.2 native texture layer group boundary", () => {
  const flat = {
    layers: [
      { uuid: "a", type: "pixel_layer", parent_uuid: "" },
      { uuid: "b", type: "pixel_layer", parent_uuid: "" },
    ],
  } as unknown as Texture;
  const nested = {
    layers: [
      { uuid: "group", type: "layer_group", parent_uuid: "" },
      { uuid: "a", type: "pixel_layer", parent_uuid: "group" },
      { uuid: "b", type: "pixel_layer", parent_uuid: "" },
    ],
  } as unknown as Texture;

  test("flat pixel stacks keep the existing structural-operation guard open", () => {
    for (const action of [
      "create_layer", "delete_layer", "duplicate_layer",
      "merge_down", "move_layer", "flatten_layers", "batch_metadata",
    ]) {
      expect(() => requireFlatLayerStructure(flat, action)).not.toThrow();
    }
  });

  test("native layer group structures fail closed before structural mutations", () => {
    for (const action of [
      "create_layer", "delete_layer", "duplicate_layer",
      "merge_down", "move_layer", "flatten_layers",
    ]) {
      expect(() => requireFlatLayerStructure(nested, action)).toThrow(
        /native Blockbench texture layer groups\/parent links/i
      );
    }
  });

  test("orphaned parent links and unknown native layer items also fail closed", () => {
    const parentLinkOnly = {
      layers: [{ uuid: "a", type: "pixel_layer", parent_uuid: "missing-group" }],
    } as unknown as Texture;
    const futureItem = {
      layers: [{ uuid: "future", type: "procedural_layer" }],
    } as unknown as Texture;
    expect(() => requireFlatLayerStructure(parentLinkOnly, "move_layer")).toThrow(/flat pixel-layer stack/);
    expect(() => requireFlatLayerStructure(futureItem, "move_layer")).toThrow(/flat pixel-layer stack/);
  });

  test("batch order changes are rejected before layer resolution and Undo", async () => {
    expect(() => preflightLayerMetadataBatch(nested, [
      { layer_id: "a", target_index: 0 },
    ])).toThrow(/flat pixel-layer stack/);
    const runtime = await Bun.file("server/tools/paint/selectionLayers.ts").text();
    expect(runtime).toContain("requireFlatLayerStructure(texture, action)");
    expect(runtime).toContain("preflightLayerMetadataBatch(");
  });
});
