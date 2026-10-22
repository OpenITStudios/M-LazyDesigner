import { describe, expect, test } from "bun:test";
import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
  requireExactFacePixelGrid,
  requireFiniteFaceUv,
  requirePositiveTextureMetric,
  requireSupportedFaceRotation,
} from "@/lib/uv/facePixelMapping";

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("face pixel mapping ownership", () => {
  test("maps logical UV coordinates directly at 1x pixel density", () => {
    expect(
      mapFaceUvToTexturePixels(
        [1, 2, 5, 6],
        { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
        "fixture"
      )
    ).toEqual({
      corners: [1, 2, 5, 6],
      rect: [1, 2, 5, 6],
      size: [4, 4],
      flip_u: false,
      flip_v: false,
      in_bounds: true,
    });
  });

  test("preserves U and V direction while normalizing only the returned bounds", () => {
    const uFlipped = mapFaceUvToTexturePixels(
      [5, 2, 1, 6],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );
    expect(uFlipped.rect).toEqual([1, 2, 5, 6]);
    expect(uFlipped.size).toEqual([4, 4]);
    expect(uFlipped.flip_u).toBe(true);
    expect(uFlipped.flip_v).toBe(false);

    const vFlipped = mapFaceUvToTexturePixels(
      [1, 6, 5, 2],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );
    expect(vFlipped.rect).toEqual([1, 2, 5, 6]);
    expect(vFlipped.flip_u).toBe(false);
    expect(vFlipped.flip_v).toBe(true);
  });

  test("scales logical UV into higher-density physical texture pixels", () => {
    expect(
      mapFaceUvToTexturePixels(
        [2, 3, 4, 5],
        { width: 256, displayHeight: 256, uvWidth: 128, uvHeight: 128 },
        "fixture"
      )
    ).toEqual({
      corners: [4, 6, 8, 10],
      rect: [4, 6, 8, 10],
      size: [4, 4],
      flip_u: false,
      flip_v: false,
      in_bounds: true,
    });
  });

  test("90/270 face rotation and flipped UV remain bijective at 2x pixel resolution", () => {
    const metrics = { width: 256, displayHeight: 256, uvWidth: 128, uvHeight: 128 };
    const expectedPixels = Array.from({ length: 12 }, (_, index) =>
      `${4 + index % 4},${6 + Math.floor(index / 4)}`
    ).sort();
    for (const flipU of [false, true]) {
      for (const flipV of [false, true]) {
        const uv = [
          flipU ? 4 : 2, flipV ? 4.5 : 3,
          flipU ? 2 : 4, flipV ? 3 : 4.5,
        ];
        const mapping = mapFaceUvToTexturePixels(uv, metrics, "2x");
        expect(mapping).toMatchObject({
          rect: [4, 6, 8, 9], size: [4, 3],
          in_bounds: true, flip_u: flipU, flip_v: flipV,
        });
        for (const rotation of [0, 90, 180, 270]) {
          const [w, h] = faceLocalPixelSize(mapping, rotation, "2x");
          expect([w, h]).toEqual(rotation === 90 || rotation === 270 ? [3, 4] : [4, 3]);
          const visited: string[] = [];
          for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
            const p = mapFaceLocalPixelToAtlasPixel(mapping, rotation, x, y, "2x");
            visited.push(`${p.x},${p.y}`);
          }
          // Exhaustive cardinality and coverage proves no swapped, repeated,
          // skipped, or out-of-bounds face-local texel for either orientation.
          expect(visited.sort()).toEqual(expectedPixels);
        }
        const at90 = mapFaceLocalPixelToAtlasPixel(mapping, 90, 0, 0, "2x");
        const at270 = mapFaceLocalPixelToAtlasPixel(mapping, 270, 0, 0, "2x");
        expect(at90).toEqual({ x: flipU ? 7 : 4, y: flipV ? 6 : 8 });
        expect(at270).toEqual({ x: flipU ? 4 : 7, y: flipV ? 8 : 6 });
      }
    }
  });

  test("out-of-atlas UV stays observable but cannot authorize exact pixel painting", () => {
    const metrics = { width: 256, displayHeight: 256, uvWidth: 128, uvHeight: 128 };
    const outside = mapFaceUvToTexturePixels([127, 0, 129, 2], metrics, "outside");
    expect(outside).toMatchObject({
      rect: [254, 0, 258, 4], in_bounds: false,
    });
    expect(() => requireExactFacePixelGrid(outside, "outside"))
      .toThrow("outside the active texture frame");
    expect(() => mapFaceLocalPixelToAtlasPixel(outside, 90, 0, 0, "outside"))
      .toThrow("outside the active texture frame");

    const subpixelOutside = mapFaceUvToTexturePixels(
      [-0.001, 0, 1, 1], metrics, "outside"
    );
    // Native Painter display rounding is allowed in the diagnostic rect,
    // but cannot turn an authored negative corner into safe exact painting.
    expect(subpixelOutside.in_bounds).toBe(false);
    expect(() => requireExactFacePixelGrid(subpixelOutside, "outside"))
      .toThrow("outside the active texture frame");

    const exactEdge = mapFaceUvToTexturePixels([126, 0, 128, 2], metrics, "edge");
    expect(exactEdge.in_bounds).toBe(true);
    expect(() => requireExactFacePixelGrid(exactEdge, "edge")).not.toThrow();
    expect(mapFaceLocalPixelToAtlasPixel(exactEdge, 270, 0, 0, "edge"))
      .toEqual({ x: 255, y: 0 });

    expect(() => mapFaceUvToTexturePixels([0, 0, 1, 1], {
      ...metrics, displayHeight: 255.5,
    }, "invalid")).toThrow("safe integers");
  });

  test("maps face-local pixels through Blockbench 0/90/180/270 rotation semantics", () => {
    const mapping = mapFaceUvToTexturePixels(
      [10, 20, 14, 23],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );

    expect(faceLocalPixelSize(mapping, 0, "fixture")).toEqual([4, 3]);
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 0, 0, 0, "fixture")).toEqual({ x: 10, y: 20 });
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 0, 3, 2, "fixture")).toEqual({ x: 13, y: 22 });

    expect(faceLocalPixelSize(mapping, 90, "fixture")).toEqual([3, 4]);
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 90, 0, 0, "fixture")).toEqual({ x: 10, y: 22 });
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 90, 2, 3, "fixture")).toEqual({ x: 13, y: 20 });

    expect(faceLocalPixelSize(mapping, 180, "fixture")).toEqual([4, 3]);
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 180, 0, 0, "fixture")).toEqual({ x: 13, y: 22 });
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 180, 3, 2, "fixture")).toEqual({ x: 10, y: 20 });

    expect(faceLocalPixelSize(mapping, 270, "fixture")).toEqual([3, 4]);
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 270, 0, 0, "fixture")).toEqual({ x: 13, y: 20 });
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 270, 2, 3, "fixture")).toEqual({ x: 10, y: 22 });
  });

  test("applies authored U/V direction after local rotation mapping", () => {
    const mapping = mapFaceUvToTexturePixels(
      [14, 23, 10, 20],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );
    expect(mapping.flip_u).toBe(true);
    expect(mapping.flip_v).toBe(true);
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 0, 0, 0, "fixture")).toEqual({ x: 13, y: 22 });
    expect(mapFaceLocalPixelToAtlasPixel(mapping, 90, 0, 0, "fixture")).toEqual({ x: 13, y: 20 });
  });

  test("exact face-local mapping rejects fractional grids, bad rotations, and out-of-range pixels", () => {
    const fractional = mapFaceUvToTexturePixels(
      [0.25, 0, 1.25, 1],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );
    expect(() => requireExactFacePixelGrid(fractional, "fixture")).toThrow();
    expect(() => requireSupportedFaceRotation(45, "fixture")).toThrow();

    const exact = mapFaceUvToTexturePixels(
      [0, 0, 4, 3],
      { width: 128, displayHeight: 128, uvWidth: 128, uvHeight: 128 },
      "fixture"
    );
    expect(() => mapFaceLocalPixelToAtlasPixel(exact, 0, 4, 0, "fixture")).toThrow();
    expect(() => mapFaceLocalPixelToAtlasPixel(exact, 90, 3, 0, "fixture")).toThrow();
    expect(() => mapFaceLocalPixelToAtlasPixel(exact, 0, 0.5, 0, "fixture")).toThrow();
  });

  test("rejects non-finite UVs and non-positive texture metrics", () => {
    expect(() => requireFiniteFaceUv([0, Number.NaN, 1, 1], "fixture")).toThrow();
    expect(() => requireFiniteFaceUv([0, 0, 1], "fixture")).toThrow();
    expect(() => requirePositiveTextureMetric(0, "fixture")).toThrow();
    expect(() => requirePositiveTextureMetric(Number.POSITIVE_INFINITY, "fixture")).toThrow();
  });

  test("inspect_element consumes the shared mapping owner instead of carrying a second implementation", async () => {
    const inspection = await source("server/tools/element/inspection.ts");
    expect(inspection).toContain('from "@/lib/uv/facePixelMapping"');
    expect(inspection).toContain("mapFaceUvToTexturePixels(");
    expect(inspection).not.toContain("function roundNativePainterCoordinate");
    expect(inspection).not.toContain("function requirePositiveTextureMetric");
  });
});
