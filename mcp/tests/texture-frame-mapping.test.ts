import { describe, expect, test } from "bun:test";
import { buildTextureEvidenceDeliveryMetadata } from "@/lib/textureEvidenceDelivery";
import {
  mapFrameLocalPixelToBitmapPixel,
  requireSingleFrameBitmapPixels,
  requireTextureFrameIndex,
  resolveTextureFrameLayout,
  textureFrameRect,
} from "@/lib/textureFrameMapping";
import { registerPaintBrushTools } from "@/server/tools/paint/brush";
import { getAllToolDefinitions } from "@/lib/factories";

describe("texture frame mapping", () => {
  test("resolves one static frame without special casing", () => {
    expect(resolveTextureFrameLayout(64, 32, 32, "Static texture")).toEqual({
      bitmap_width: 64,
      bitmap_height: 32,
      display_height: 32,
      frame_count: 1,
    });
  });

  test("resolves an exact vertical frame stack", () => {
    const layout = resolveTextureFrameLayout(16, 48, 16, "Animated texture");
    expect(layout.frame_count).toBe(3);
    expect(textureFrameRect(layout, 0, "Animated texture")).toEqual([0, 0, 16, 16]);
    expect(textureFrameRect(layout, 2, "Animated texture")).toEqual([0, 32, 16, 48]);
  });

  test("maps frame-local pixels to the stacked physical bitmap", () => {
    const layout = resolveTextureFrameLayout(16, 48, 16, "Animated texture");
    expect(
      mapFrameLocalPixelToBitmapPixel(layout, 1, 0, 0, "Animated texture")
    ).toEqual({ x: 0, y: 16 });
    expect(
      mapFrameLocalPixelToBitmapPixel(layout, 2, 15, 15, "Animated texture")
    ).toEqual({ x: 15, y: 47 });
  });


  test("absolute bitmap pixel requests resolve to exactly one animated frame", () => {
    const layout = resolveTextureFrameLayout(16, 48, 16, "Animated");
    expect(requireSingleFrameBitmapPixels(layout, [
      { x: 0, y: 16 }, { x: 15, y: 31 },
    ], "Animated")).toBe(1);
    expect(requireSingleFrameBitmapPixels(layout, [
      { x: 0, y: 32 }, { x: 15, y: 47 },
    ], "Animated")).toBe(2);
    expect(requireSingleFrameBitmapPixels(
      resolveTextureFrameLayout(16, 16, 16, "Static"),
      [{ x: 15, y: 15 }], "Static"
    )).toBe(0);
    expect(() => requireSingleFrameBitmapPixels(layout, [
      { x: 0, y: 15 }, { x: 0, y: 16 },
    ], "Animated")).toThrow("crosses animated texture frame boundaries");
    for (const point of [
      { x: 16, y: 16 }, { x: 0, y: 48 }, { x: 0, y: -1 },
      { x: 0.5, y: 16 }, { x: 0, y: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(() => requireSingleFrameBitmapPixels(layout, [point], "Animated"))
        .toThrow();
    }
    expect(() => requireSingleFrameBitmapPixels(layout, [], "Animated"))
      .toThrow("at least one bitmap pixel");
    expect(() => resolveTextureFrameLayout(16, 2 ** 53, 16, "Animated"))
      .toThrow("positive integer");
  });

  test("exact brush paints only requested animated frame and refuses native frame drift", async () => {
    const g = globalThis as Record<string, any>;
    const keys = ["Project", "Texture", "Painter", "Undo", "Canvas"];
    const prior = Object.fromEntries(keys.map(k => [k, g[k]]));
    let selectedOffset: [number, number] = [0, 16];
    let editOffset: [number, number] = [0, 16];
    const written: Array<[number, number]> = [];
    const bitmap = new Uint8ClampedArray(16 * 48 * 4);
    let writeBehavior: "normal" | "ignored" | "wrong" = "normal";
    const history = { started: 0, finished: 0, cancelled: 0 };
    const texture = {
      uuid: "animated", name: "animated", id: "animated",
      width: 16, height: 48, display_height: 16,
      layers_enabled: false,
      getActiveCanvas: () => ({
        canvas: { width: 16, height: 16 }, offset: selectedOffset,
      }),
      edit(callback: (
        canvas: { width: number; height: number },
        env: Record<string, any>
      )) {
        const offset = editOffset;
        const ctx = {
          save() {}, restore() {},
          getImageData(x: number, y: number, w: number, h: number) {
            const pixels = new Uint8ClampedArray(w * h * 4);
            for (let row = 0; row < h; row++) {
              const from = ((y + offset[1] + row) * 16 + (x + offset[0])) * 4;
              pixels.set(bitmap.subarray(from, from + w * 4), row * w * 4);
            }
            return { data: pixels };
          },
          clearRect(_x: number, _y: number, _w: number, _h: number) {},
          fillRect(x: number, y: number) {
            if (writeBehavior === "ignored") return;
            const realX = x + offset[0] + (writeBehavior === "wrong" ? 1 : 0);
            const realY = y + offset[1];
            bitmap.set([255, 0, 0, 255], (realY * 16 + realX) * 4);
            written.push([realX, realY]);
          },
          globalAlpha: 0, globalCompositeOperation: "", fillStyle: "",
        };
        callback({ width: 16, height: 16 }, { ctx, offset });
      },
    };
    g.Project = { textures: [texture] };
    g.Texture = { all: [texture], selected: texture, getDefault: () => texture };
    g.Painter = { mirror_painting: false, lock_alpha: false, erase_mode: false };
    g.Canvas = { updateAll() {} };
    g.Undo = {
      initEdit() { history.started++; },
      finishEdit() { history.finished++; },
      cancelEdit() { history.cancelled++; },
    };
    try {
      if (!getAllToolDefinitions().paint_with_brush) registerPaintBrushTools();
      const tool = getAllToolDefinitions().paint_with_brush;
      const run = async (coordinates: Array<{ x: number; y: number }>) =>
        tool.execute(await tool.parameterSchema.parseAsync({
          texture_id: "animated",
          coordinates,
          connect_strokes: false,
          brush_settings: { color: "#ff0000", size: 1, opacity: 255,
            softness: 0, shape: "square", blend_mode: "default" },
        }));

      const result = await run([{ x: 0, y: 16 }, { x: 5, y: 31 }]);
      expect(result.structuredContent).toMatchObject({
        mode: "exact_pixels",
        affected_rect: [0, 16, 6, 32],
        pixels_requested: 2,
      });
      expect(written).toEqual([[0, 16], [5, 31]]);
      expect(history).toEqual({ started: 1, finished: 1, cancelled: 0 });

      await expect(run([{ x: 0, y: 15 }, { x: 0, y: 16 }]))
        .rejects.toThrow("crosses animated texture frame boundaries");
      expect(history.started).toBe(1);

      selectedOffset = [0, 0];
      await expect(run([{ x: 1, y: 16 }]))
        .rejects.toThrow("outside the active texture canvas/layer");
      expect(history.started).toBe(1);

      selectedOffset = [0, 16];
      editOffset = [0, 0];
      await expect(run([{ x: 1, y: 16 }]))
        .rejects.toThrow("outside the active texture canvas/layer");
      expect(written).toEqual([[0, 16], [5, 31]]);
      expect(history).toEqual({ started: 2, finished: 1, cancelled: 1 });

      editOffset = [0, 16];
      writeBehavior = "ignored";
      await expect(run([{ x: 1, y: 16 }]))
        .rejects.toThrow("did not apply the requested RGBA");
      expect(history).toEqual({ started: 3, finished: 1, cancelled: 2 });

      writeBehavior = "wrong";
      await expect(run([{ x: 1, y: 16 }]))
        .rejects.toThrow("did not apply the requested RGBA");
      expect(history).toEqual({ started: 4, finished: 1, cancelled: 3 });
    } finally {
      for (const key of keys) {
        if (prior[key] === undefined) delete g[key];
        else g[key] = prior[key];
      }
    }
  });


  test("animated frame-local UV metadata never uses stacked bitmap height", () => {
    const revision = "sha256:2x6:" + "a".repeat(64);
    const data = {
      inspection: "region" as const,
      revision,
      bitmap: { width: 2, height: 6 },
      display_height: 2,
      source_byte_length: 8,
      uv_width: 128,
      uv_height: 128,
    };
    for (let frame = 0; frame < 3; frame++) {
      const result = buildTextureEvidenceDeliveryMetadata({
        ...data,
        region: { x: 0, y: frame * 2, width: 1, height: 2 },
      });
      expect(result.logical_uv).toEqual([0, 0, 64, 128]);
      expect(result.frame).toMatchObject({
        state: "single_frame",
        frame_index: frame,
        frame_range: [frame, frame],
        frame_bitmap_rect: [0, frame * 2, 2, frame * 2 + 2],
        region_in_frame: { x: 0, y: 0, width: 1, height: 2 },
      });
    }
    // Legacy static callers remain single-image/UV without a frame envelope.
    const staticMetadata = buildTextureEvidenceDeliveryMetadata({
      ...data, bitmap: { width: 2, height: 2 },
      region: { x: 0, y: 0, width: 1, height: 2 },
    });
    expect(staticMetadata.logical_uv).toEqual([0, 0, 64, 128]);
    expect("frame" in staticMetadata).toBe(false);
  });

  test("rejects non-integral frame stacks", () => {
    expect(() =>
      resolveTextureFrameLayout(16, 48, 20, "Animated texture")
    ).toThrow();
  });

  test("rejects invalid frame indices and local pixels", () => {
    const layout = resolveTextureFrameLayout(16, 48, 16, "Animated texture");
    expect(() => requireTextureFrameIndex(layout, -1, "Animated texture")).toThrow();
    expect(() => requireTextureFrameIndex(layout, 3, "Animated texture")).toThrow();
    expect(() =>
      mapFrameLocalPixelToBitmapPixel(layout, 1, 16, 0, "Animated texture")
    ).toThrow();
    expect(() =>
      mapFrameLocalPixelToBitmapPixel(layout, 1, 0.5, 0, "Animated texture")
    ).toThrow();
  });
});
