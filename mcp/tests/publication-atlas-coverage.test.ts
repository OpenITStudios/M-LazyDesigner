import { describe, expect, test } from "bun:test";
import { verifyVisibleAtlasPixelsOpaque } from "@/lib/publication/atlasCoverage";

const rgba = new Uint8ClampedArray([
  255, 255, 255, 255, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
]);

describe("Blockbench atlas alpha fidelity", () => {
  test("keeps untouched transparent padding when all mapped pixels are opaque", () => {
    expect(verifyVisibleAtlasPixelsOpaque(rgba, 2, 2, 2, 2, [[0, 0, 1, 1]])).toEqual({
      transparent_pixels_outside_mapped_uv: 3,
      sampled_pixels: 1,
    });
  });

  test("rejects unknown alpha where a real face samples a texel", () => {
    expect(() => verifyVisibleAtlasPixelsOpaque(rgba, 2, 2, 2, 2, [
      [0, 0, 2, 1],
    ])).toThrow("PUBLICATION_VISIBLE_ATLAS_ALPHA_SEMANTICS_UNVERIFIED");
  });

  test("fails closed on missing, empty and out-of-bounds UV regions", () => {
    for (const rectangles of [
      [],
      [[0, 0, 0, 1]],
      [[0, 0, 3, 2]],
      [[-1, 0, 1, 1]],
      [[0, 0, Infinity, 1]],
    ]) {
      expect(() => verifyVisibleAtlasPixelsOpaque(
        rgba, 2, 2, 2, 2,
        rectangles as [number, number, number, number][],
      )).toThrow();
    }
  });

  test("uses authored logical UV texture dimensions for high-res pixel atlas", () => {
    const highRes = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 3; i < highRes.length; i += 4) highRes[i] = 255;
    highRes[3] = 0;
    expect(() => verifyVisibleAtlasPixelsOpaque(
      highRes, 4, 4, 2, 2, [[0, 0, 1, 1]],
    )).toThrow("PUBLICATION_VISIBLE_ATLAS_ALPHA_SEMANTICS_UNVERIFIED");
    expect(verifyVisibleAtlasPixelsOpaque(
      highRes, 4, 4, 2, 2, [[1, 1, 2, 2]],
    )).toMatchObject({ transparent_pixels_outside_mapped_uv: 1 });
  });
});
