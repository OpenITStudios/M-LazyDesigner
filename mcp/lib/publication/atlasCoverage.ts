/** Verify only the pixels actually sampled by native face UV rectangles.
 *
 * A Blockbench RGBA atlas often has transparent UNUSED pixels between mapped
 * islands. Those do not establish cutout semantics on visible model faces.
 * Conversely, alpha INSIDE used UVs is blocked until a verified per-zone
 * Bedrock render_profile (cutout/blend/mask) is supplied. Never infer its role.
 */
export type AtlasRect = readonly [number, number, number, number];

export function verifyVisibleAtlasPixelsOpaque(
  rgba: Uint8ClampedArray,
  bitmapWidth: number,
  bitmapHeight: number,
  textureWidth: number,
  textureHeight: number,
  uvRects: readonly AtlasRect[],
): { transparent_pixels_outside_mapped_uv: number; sampled_pixels: number } {
  if (![bitmapWidth, bitmapHeight, textureWidth, textureHeight].every(
    n => Number.isSafeInteger(n) && n > 0 && n <= 8192
  ) || rgba.length !== bitmapWidth * bitmapHeight * 4 ||
      uvRects.length === 0 || uvRects.length > 100_000) {
    throw new Error("PUBLICATION_ATLAS_UV_COVERAGE_INVALID_INPUT");
  }
  const used = new Uint8Array(bitmapWidth * bitmapHeight);
  for (const rect of uvRects) {
    if (rect.length !== 4 || rect.some(v => !Number.isFinite(v))) {
      throw new Error("PUBLICATION_ATLAS_FACE_UV_INVALID");
    }
    const left = Math.min(rect[0], rect[2]) * bitmapWidth / textureWidth;
    const right = Math.max(rect[0], rect[2]) * bitmapWidth / textureWidth;
    const top = Math.min(rect[1], rect[3]) * bitmapHeight / textureHeight;
    const bottom = Math.max(rect[1], rect[3]) * bitmapHeight / textureHeight;
    if (left < 0 || top < 0 || right > bitmapWidth || bottom > bitmapHeight ||
        left >= right || top >= bottom) {
      throw new Error("PUBLICATION_ATLAS_FACE_UV_OUTSIDE_TEXTURE");
    }
    const x0 = Math.floor(left);
    const x1 = Math.min(bitmapWidth, Math.ceil(right));
    const y0 = Math.floor(top);
    const y1 = Math.min(bitmapHeight, Math.ceil(bottom));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) used[y * bitmapWidth + x] = 1;
    }
  }
  let outside = 0;
  let sampled = 0;
  for (let i = 0; i < used.length; i++) {
    if (used[i]) {
      sampled++;
      if (rgba[4 * i + 3] !== 255) {
        throw new Error("PUBLICATION_VISIBLE_ATLAS_ALPHA_SEMANTICS_UNVERIFIED");
      }
    } else if (rgba[4 * i + 3] !== 255) {
      outside++;
    }
  }
  if (!sampled) throw new Error("PUBLICATION_ATLAS_NO_SAMPLED_PIXEL");
  return {
    transparent_pixels_outside_mapped_uv: outside,
    sampled_pixels: sampled,
  };
}
