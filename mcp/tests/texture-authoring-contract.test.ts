import { describe, expect, test } from "bun:test";
import { getAllToolDefinitions } from "@/lib/factories";
import {
  paintWithBrushParameters,
  registerPaintTools,
  isExactPixelAuthoringRequest,
  normalizeTexturePixelRegion,
  paintFillToolParameters,
  requirePaintCoordinates,
  requireTextureCoordinatesWithinBounds,
  texturePixelRectToUvTag,
} from "@/server/tools/paint";
import {
  mapFaceUvToTexturePixels,
  requireFiniteInspectableFaceUv,
  requireFiniteInspectableVector2,
} from "@/server/tools/element-inspection";
import { boxUvFootprint, packBoxUvOffsets } from "@/lib/boxUvLayout";
import { listTexturesParameters } from "@/server/tools/texture";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

describe("texturing authoring contract", () => {
  test("texture inventory is cheap by default and diagnostics remain explicit", () => {
    const baseline = listTexturesParameters.parse({});
    expect(baseline.diagnostics).toBe(false);
    expect(baseline.diagnostic_scope).toBe("full");

    const uvOnly = listTexturesParameters.parse({
      diagnostics: true,
      diagnostic_scope: "uv",
    });
    expect(uvOnly).toEqual({ diagnostics: true, diagnostic_scope: "uv" });

    const legacyFull = listTexturesParameters.parse({ diagnostics: true });
    expect(legacyFull).toEqual({
      diagnostics: true,
      diagnostic_scope: "full",
    });
  });

  test("fill surface omits unsupported synthetic tolerance", async () => {
    expect(Object.keys(paintFillToolParameters.shape)).not.toContain("tolerance");
    const paint = await source("server/tools/paint/primitives.ts");
    const fill = paint;
    expect(fill).not.toContain("tolerance");
    expect(fill).not.toContain("requireNativeFillTolerance");
  });

  test("coordinate-driven paint operations reject empty work before runtime mutation", () => {
    expect(() => requirePaintCoordinates([], "paint_with_brush")).toThrow(
      "requires at least one coordinate"
    );
    expect(() =>
      requirePaintCoordinates([{ x: 4, y: 8 }], "paint_with_brush")
    ).not.toThrow();
  });

  // Native stroke lifecycle is verified by paint-stroke and paint-tool-selection executors.

  test("brush and eraser honor connected versus separated stroke semantics", async () => {
    const paint = await source("server/tools/paint/brush.ts");

    const eraser = paint;
    expect(eraser).toContain('requirePaintCoordinates(coordinates, "eraser_tool")');
    expect(eraser).toContain("movePaintTool");
    expect(eraser).toContain("!connect_strokes");

    const brush = paint;
    expect(brush).toContain(
      'requirePaintCoordinates(coordinates, "paint_with_brush")'
    );
    expect(brush).toContain("BarItems.brush_tool.select()");
    // Native blend behavior is covered by brush-blend-default.test.ts.
    expect(brush).toContain("movePaintTool");
    expect(brush).toContain("!connect_strokes");
    expect(brush).not.toContain("Painter.editCircle");
    expect(brush).not.toContain("Painter.editSquare");
  });

  test("Box UV packing derives native footprint and avoids overlap deterministically", () => {
    expect(boxUvFootprint([-1, 0, -1], [1, 10, 1])).toEqual([8, 12]);

    const footprints = [
      [8, 12],
      [8, 5],
      [8, 5],
      [10, 4],
      [10, 4],
      [6, 13],
      [6, 13],
    ] as const;
    const offsets = packBoxUvOffsets([], footprints, 128, 128);
    const regions = footprints.map(([width, height], index) => ({
      x: offsets[index][0],
      y: offsets[index][1],
      width,
      height,
    }));

    for (let i = 0; i < regions.length; i += 1) {
      expect(regions[i].x).toBeGreaterThanOrEqual(0);
      expect(regions[i].y).toBeGreaterThanOrEqual(0);
      expect(regions[i].x + regions[i].width).toBeLessThanOrEqual(128);
      expect(regions[i].y + regions[i].height).toBeLessThanOrEqual(128);
      for (let j = i + 1; j < regions.length; j += 1) {
        expect(rectanglesOverlap(regions[i], regions[j])).toBe(false);
      }
    }

    const afterExisting = packBoxUvOffsets(
      [{ x: 0, y: 0, width: 8, height: 12 }],
      [[8, 12]],
      128,
      128
    );
    expect(afterExisting[0]).not.toEqual([0, 0]);

    expect(() =>
      packBoxUvOffsets([], [[20, 20]], 16, 16)
    ).toThrow("exceeds the 16×16 logical UV canvas");
  });

  test("place_cube returns packed Box UV continuation state without locking geometry early", async () => {
    const cubes = await source("server/tools/geometry/cubes.ts");
    for (const marker of [
      "packBoxUvOffsets(",
      "currentBoxUvOccupancy()",
      "box_uv_region:",
      '"auto_packed_unlocked" as const',
    ]) {
      expect(cubes).toContain(marker);
    }

    const start = cubes.indexOf("const plannedOffset = plannedBoxUvOffsets");
    const end = cubes.indexOf("return cube;", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const placement = cubes.slice(start, end);
    expect(placement).toContain("uv_offset: plannedOffset");
    expect(placement).toContain("autouv: 1");
    expect(placement).not.toContain("autouv: 0");
  });

  test("Cube inspection exposes finite authored UV state and face rectangles", async () => {
    expect(requireFiniteInspectableVector2([8, 16], "fixture")).toEqual([8, 16]);
    expect(() =>
      requireFiniteInspectableVector2([8, Number.NaN], "fixture")
    ).toThrow();

    expect(
      requireFiniteInspectableFaceUv([0, 0, 4, 8], "fixture")
    ).toEqual([0, 0, 4, 8]);
    expect(() =>
      requireFiniteInspectableFaceUv([0, 0, 4, Number.POSITIVE_INFINITY], "fixture")
    ).toThrow();

    const inspection = await source("server/tools/element/inspection.ts");
    for (const marker of [
      "CUBE_FACE_KEYS",
      'mode: cube.box_uv ? ("box_uv" as const) : ("per_face" as const)',
      "box_uv: cube.box_uv === true",
      "uv_offset: requireFiniteInspectableVector2",
      "autouv: cube.autouv",
      "mirror_uv: cube.mirror_uv === true",
      "face.uv",
      "rotation: face.rotation",
      "const enabled = face.enabled !== false;",
      "uv: inspectCubeUv(cube)",
    ]) {
      expect(inspection).toContain(marker);
    }

    for (const face of ["north", "south", "east", "west", "up", "down"]) {
      expect(inspection).toContain(`"${face}"`);
    }
  });
  test("Cube face UV maps to native Painter texture-space pixels without losing orientation", () => {
    expect(
      mapFaceUvToTexturePixels(
        [2, 4, 6, 12],
        { width: 64, displayHeight: 64, uvWidth: 16, uvHeight: 16 },
        "fixture"
      )
    ).toEqual({
      corners: [8, 16, 24, 48],
      rect: [8, 16, 24, 48],
      size: [16, 32],
      flip_u: false,
      flip_v: false,
    });

    expect(
      mapFaceUvToTexturePixels(
        [6, 12, 2, 4],
        { width: 64, displayHeight: 64, uvWidth: 16, uvHeight: 16 },
        "fixture"
      )
    ).toEqual({
      corners: [24, 48, 8, 16],
      rect: [8, 16, 24, 48],
      size: [16, 32],
      flip_u: true,
      flip_v: true,
    });

    expect(
      mapFaceUvToTexturePixels(
        [0.25, 0.25, 1.25, 1.25],
        { width: 16, displayHeight: 16, uvWidth: 16, uvHeight: 16 },
        "fixture"
      ).rect
    ).toEqual([0, 0, 2, 2]);

    expect(() =>
      mapFaceUvToTexturePixels(
        [0, 0, 4, 4],
        { width: 0, displayHeight: 16, uvWidth: 16, uvHeight: 16 },
        "fixture"
      )
    ).toThrow("finite positive texture dimension");
  });

  test("Cube inspection exposes semantic texture-space mapping state for every face", async () => {
    const inspection = await source("server/tools/element/inspection.ts");

    for (const marker of [
      "Texture.getDefault()",
      "texture.width",
      "texture.display_height",
      "texture.getUVWidth()",
      "texture.getUVHeight()",
      'state: "no_texture"',
      'state: "texture_error"',
      'state: "animated_texture_unsupported"',
      "texture_space:",
      "effective_texture:",
      "mapping_state:",
      "paintable:",
      "texture_pixels:",
      "mapFaceUvToTexturePixels(",
      '"disabled_face" as const',
    ]) {
      expect(inspection).toContain(marker);
    }
  });

  test("T3 region bounds round-trip between texture pixels and authored UV space", () => {
    expect(
      normalizeTexturePixelRegion(
        { x: 23, y: 47 },
        { x: 8, y: 16 },
        64,
        64,
        "fixture"
      )
    ).toEqual({ rect: [8, 16, 24, 48], size: [16, 32] });

    const uvTag = texturePixelRectToUvTag(
      [8, 16, 24, 48],
      64,
      64,
      16,
      16,
      "fixture"
    );
    expect(uvTag).toEqual([2, 4, 6, 12]);
    expect(
      mapFaceUvToTexturePixels(
        uvTag,
        { width: 64, displayHeight: 64, uvWidth: 16, uvHeight: 16 },
        "fixture"
      ).rect
    ).toEqual([8, 16, 24, 48]);

    expect(() =>
      normalizeTexturePixelRegion(
        { x: -1, y: 0 },
        { x: 2, y: 2 },
        16,
        16,
        "fixture"
      )
    ).toThrow("outside texture bounds");
  });

  test("T3 bounded shape authoring passes an exact clip through native Painter", async () => {
    const paint = await source("server/tools/paint/primitives.ts");
    const shape = paint;

    for (const marker of [
      "bounded region authoring requires mirror painting to be disabled",
      "normalizeTexturePixelRegion(",
      "texturePixelRectToUvTag(",
      "start.x,",
      "uvTag,",
      "useShapeTool(texture, end.x, end.y, {}, uvTag)",
      'bounded: true',
      "affected_rect: region.rect",
      "affected_size: region.size",
    ]) {
      expect(shape).toContain(marker);
    }
  });

  test("T3 exact pixel authoring is narrow, bounded, and one Undo unit", async () => {
    expect(
      isExactPixelAuthoringRequest([{ x: 3, y: 4 }], {
        size: 1,
        opacity: 255,
        softness: 0,
        shape: "square",
        blendMode: "default",
        connectStrokes: false,
        mirrorPainting: false,
        lockAlpha: false,
        eraseMode: false,
      })
    ).toBe(true);
    expect(
      isExactPixelAuthoringRequest([{ x: 3, y: 4 }], {
        size: 2,
        opacity: 255,
        softness: 0,
        shape: "square",
        blendMode: "default",
        connectStrokes: false,
        mirrorPainting: false,
        lockAlpha: false,
        eraseMode: false,
      })
    ).toBe(false);
    expect(
      isExactPixelAuthoringRequest([{ x: 3, y: 4 }], {
        size: 3,
        opacity: 255,
        softness: 0,
        shape: "square",
        blendMode: "default",
        connectStrokes: false,
        mirrorPainting: false,
        lockAlpha: false,
        eraseMode: false,
      })
    ).toBe(false);

    expect(() =>
      requireTextureCoordinatesWithinBounds(
        [{ x: 16, y: 0 }],
        16,
        16,
        "fixture"
      )
    ).toThrow("outside texture bounds");

    const paint = await source("server/tools/paint/brush.ts");
    const brush = paint;
    for (const marker of [
      "isExactPixelAuthoringRequest(coordinates",
      'brush_settings?.blend_mode ?? "default"',
      "Decide the direct deterministic path before mutating native tool",
      "texture.getActiveCanvas()",
      "Undo.initEdit(undoAspects)",
      "texture.edit(",
      "env.ctx.fillRect(",
      'mode: "exact_pixels"',
      "affected_rect: bounds.rect",
      'Undo.finishEdit("Paint exact texture pixels")',
      "Undo.cancelEdit(true)",
    ]) {
      expect(brush).toContain(marker);
    }
    expect(brush).toContain("startPaintTool");
    expect(brush).toContain("movePaintTool");

  });

  test("brush executor preserves size-1 pixels and delegates size-2 to native Painter", async () => {
    if (!getAllToolDefinitions().paint_with_brush) registerPaintTools();
    const tool = getAllToolDefinitions().paint_with_brush;
    const writes: number[][] = [];
    const cleared: number[][] = [];
    const nativeCalls: unknown[][] = [];
    const undoCalls: string[] = [];
    class FixtureNumSlider {
      value = 0;
      change(modifier: (value: number) => number) { this.value = modifier(this.value); }
      update() {}
    }
    const controls = {
      slider_brush_size: new FixtureNumSlider(),
      slider_brush_opacity: new FixtureNumSlider(),
      slider_brush_softness: new FixtureNumSlider(),
      brush_shape: {value:"square"},
      blend_mode: {value:"default"},
      brush_tool: { select: () => nativeCalls.push(["select"]) },
    };
    const ctx = {
      save() {},
      restore() {},
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      clearRect: (x: number, y: number, width: number, height: number) => {
        cleared.push([x, y, width, height]);
      },
      fillRect: (x: number, y: number, width: number, height: number) => {
        expect(cleared.at(-1)).toEqual([x, y, width, height]);
        writes.push([x, y, width, height]);
      },
    };
    const active = {
      canvas: { width: 16, height: 16 },
      offset: [0, 0],
      ctx,
    };
    const texture = {
      uuid: "brush-fixture",
      id: "0",
      name: "brush-fixture",
      width: 16,
      height: 16,
      display_height: 16,
      layers_enabled: false,
      layers: [],
      getActiveCanvas: () => active,
      edit: (callback: (canvas: typeof active.canvas, env: typeof active) => void) =>
        callback(active.canvas, active),
    };
    const globals = {
      NumSlider: FixtureNumSlider,
      Project: { textures: [texture] },
      Texture: { selected: texture, all: [texture], getDefault: () => texture },
      BarItems: controls,
      ColorPanel: { set() {} },
      Canvas: { updateAll() {} },
      Undo: {
        initEdit: () => undoCalls.push("init"),
        finishEdit: () => undoCalls.push("finish"),
        cancelEdit: () => undoCalls.push("cancel"),
      },
      Painter: {
        mirror_painting: false,
        lock_alpha: false,
        erase_mode: false,
        startPaintTool: (target: unknown, x: number, y: number) => {
          expect(target).toBe(texture);
          nativeCalls.push(["start", controls.slider_brush_size.value, x, y]);
        },
        stopPaintTool: () => nativeCalls.push(["stop"]),
      },
    };
    const saved = Object.keys(globals).map((key) =>
      [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    try {
      for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      }
      for (const size of [1, 2]) {
        writes.length = 0;
        cleared.length = 0;
        nativeCalls.length = 0;
        undoCalls.length = 0;
        const result = await tool.execute(paintWithBrushParameters.parse({
          coordinates: [{ x: 3, y: 4 }],
          brush_settings: {
            size, opacity: 255, softness: 0, shape: "square",
            blend_mode: "default", color: "#11223380",
          },
          connect_strokes: false,
        }));
        if (size === 1) {
          expect(writes).toEqual([[3, 4, 1, 1]]);
          expect(cleared).toEqual([[3, 4, 1, 1]]);
          expect(nativeCalls).toEqual([]);
          expect(undoCalls).toEqual(["init", "finish"]);
          expect(typeof result).not.toBe("string");
          if (typeof result === "string") throw new Error("Expected exact-pixel receipt.");
          expect(result.structuredContent).toMatchObject({
            mode: "exact_pixels", affected_rect: [3, 4, 4, 5], affected_size: [1, 1],
          });
        } else {
          expect(writes).toEqual([]);
          expect(cleared).toEqual([]);
          expect(undoCalls).toEqual([]);
          expect(nativeCalls).toEqual([["select"], ["start", 2, 3, 4], ["stop"]]);
        }
      }
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  test("create_texture sizes its fresh canvas to authored dimensions before filling", async () => {
    const textureSource = await source("server/tools/texture/create.ts");
    const executeStart = textureSource.indexOf("async execute({");
    const executeEnd = textureSource.indexOf("const result = {", executeStart);
    expect(executeStart).toBeGreaterThanOrEqual(0);
    expect(executeEnd).toBeGreaterThan(executeStart);
    const createExecute = textureSource.slice(executeStart, executeEnd);
    for (const marker of [
      "ctx.canvas.width !== texture.width",
      "ctx.canvas.height !== texture.height",
      "ctx.canvas.width = texture.width;",
      "ctx.canvas.height = texture.height;",
      "ctx.fillRect(0, 0, texture.width, texture.height)",
    ]) {
      expect(createExecute).toContain(marker);
    }
  });

  test("flatten_layers uses native Blockbench semantics and rejects approximation", async () => {
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

});
