import { describe, expect, test } from "bun:test";
import {
  fullTextureRgba,
  requireEmptyTextureBeforeUvRepack,
} from "@/lib/textureBitmapRuntime";

describe("texture bitmap runtime memory contract", () => {
  test("UV repack guard distinguishes a strictly empty bitmap from authored or hidden RGB", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    const texture = {
      name: "atlas", width: 4, height: 4, display_height: 4,
      frameCount: 1, layers_enabled: false,
      canvas: { width: 4, height: 4 },
      ctx: { getImageData: () => ({ data: pixels }) },
    } as unknown as Texture;

    expect(() => requireEmptyTextureBeforeUvRepack(texture, "fixture"))
      .not.toThrow();
    // Alpha 0 is not proof of an empty authored canvas. RGB may be used
    // by non-opacity render profiles or restored during later edits.
    pixels[0] = 255;
    expect(() => requireEmptyTextureBeforeUvRepack(texture, "fixture"))
      .toThrow("UV_PAINTED_ATLAS_REPACK_BLOCKED");
    pixels[0] = 0;
    pixels[3] = 255;
    expect(() => requireEmptyTextureBeforeUvRepack(texture, "fixture"))
      .toThrow("UV_PAINTED_ATLAS_REPACK_BLOCKED");
  });

  test("UV repack refuses layered, animated, or inconsistent bitmap sources", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    const texture = {
      name: "complex", width: 4, height: 4, display_height: 4,
      frameCount: 1, layers_enabled: false,
      canvas: { width: 4, height: 4 },
      ctx: { getImageData: () => ({ data: pixels }) },
    };
    const check = () =>
      requireEmptyTextureBeforeUvRepack(texture as unknown as Texture, "fixture");
    texture.layers_enabled = true;
    expect(check).toThrow("UV_ATLAS_REPACK_UNSAFE_STATE");
    texture.layers_enabled = false;
    texture.frameCount = 2;
    expect(check).toThrow("UV_ATLAS_REPACK_UNSAFE_STATE");
    texture.frameCount = 1;
    texture.display_height = 2;
    expect(check).toThrow("UV_ATLAS_REPACK_UNSAFE_STATE");
    texture.display_height = 4;
    texture.width = 8;
    expect(check).toThrow("UV_ATLAS_REPACK_BITMAP_MISMATCH");
    texture.width = 4;
    texture.ctx.getImageData = () => ({ data: new Uint8ClampedArray(3) });
    expect(check).toThrow("UV_ATLAS_REPACK_BITMAP_MISMATCH");
  });


  test("fullTextureRgba reuses the invocation-owned ImageData buffer", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    const texture = {
      name: "atlas",
      canvas: { width: 4, height: 4 },
      ctx: {
        getImageData() {
          return { data: pixels };
        },
      },
    } as unknown as Texture;

    const snapshot = fullTextureRgba(texture);

    expect(snapshot.pixels).toBe(pixels);
    expect(snapshot.width).toBe(4);
    expect(snapshot.height).toBe(4);
  });
});
