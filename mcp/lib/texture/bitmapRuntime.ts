/// <reference types="blockbench-types" />

export function fullTextureRgba(texture: Texture): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const width = texture.canvas.width;
  const height = texture.canvas.height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      `Texture "${texture.name}" has no positive decoded bitmap dimensions.`
    );
  }
  const data = texture.ctx.getImageData(0, 0, width, height).data;
  return {
    // getImageData already returns an invocation-owned Uint8ClampedArray.
    // Callers treat this snapshot as immutable; mutation planners clone only
    // when they need a writable candidate.
    pixels: data,
    width,
    height,
  };
}

/**
 * A revision-checked paint plan can cross asynchronous digest/encoding steps.
 * Compare the current decoded bitmap with its original snapshot immediately
 * before starting Undo; no second hash or model-facing revision is required.
 */
export function requireUnchangedTextureBitmap(
  expected: { pixels: Uint8ClampedArray; width: number; height: number },
  actual: { pixels: Uint8ClampedArray; width: number; height: number },
  mismatchMessage = "Texture bitmap changed during paint transaction planning. Refresh the texture revision before applying a new transaction; no native mutation was applied."
): void {
  if (
    expected.width !== actual.width ||
    expected.height !== actual.height ||
    expected.pixels.byteLength !== actual.pixels.byteLength ||
    expected.pixels.some((value, index) => value !== actual.pixels[index])
  ) {
    throw new Error(mismatchMessage);
  }
}

export function rgbaToPngDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) {
    throw new Error("Texture evidence PNG encoding requires a 2D canvas context.");
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png", 1);
}


export function cropRgbaRect(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rect: readonly [number, number, number, number]
): {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  left: number;
  top: number;
} {
  const [left, top, right, bottom] = rect;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new Error("Texture evidence crop requires a valid RGBA bitmap.");
  }
  if (
    ![left, top, right, bottom].every(Number.isSafeInteger) ||
    left < 0 ||
    top < 0 ||
    right <= left ||
    bottom <= top ||
    right > width ||
    bottom > height
  ) {
    throw new Error("Texture evidence crop is outside bitmap bounds.");
  }

  const cropWidth = right - left;
  const cropHeight = bottom - top;
  const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    const sourceStart = ((top + y) * width + left) * 4;
    const sourceEnd = sourceStart + cropWidth * 4;
    crop.set(
      pixels.subarray(sourceStart, sourceEnd),
      y * cropWidth * 4
    );
  }
  return {
    pixels: crop,
    width: cropWidth,
    height: cropHeight,
    left,
    top,
  };
}

export function rgbaRectToPngDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rect: readonly [number, number, number, number]
): string {
  const crop = cropRgbaRect(pixels, width, height, rect);
  return rgbaToPngDataUrl(crop.pixels, crop.width, crop.height);
}
