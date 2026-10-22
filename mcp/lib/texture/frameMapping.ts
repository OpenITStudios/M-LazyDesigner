export type TextureFrameLayout = {
  bitmap_width: number;
  bitmap_height: number;
  display_height: number;
  frame_count: number;
};

function requirePositiveInteger(value: number, context: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer.`);
  }
  return value;
}

export function resolveTextureFrameLayout(
  bitmapWidth: number,
  bitmapHeight: number,
  displayHeight: number,
  context: string
): TextureFrameLayout {
  const width = requirePositiveInteger(bitmapWidth, `${context} bitmap width`);
  const height = requirePositiveInteger(bitmapHeight, `${context} bitmap height`);
  const frameHeight = requirePositiveInteger(
    displayHeight,
    `${context} display/frame height`
  );

  if (frameHeight > height || height % frameHeight !== 0) {
    throw new Error(
      `${context} bitmap height ${height} is not an exact stack of ${frameHeight}-pixel frames.`
    );
  }

  const frameCount = height / frameHeight;
  return {
    bitmap_width: width,
    bitmap_height: height,
    display_height: frameHeight,
    frame_count: frameCount,
  };
}

export function requireTextureFrameIndex(
  layout: TextureFrameLayout,
  frameIndex: number,
  context: string
): number {
  if (
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    frameIndex >= layout.frame_count
  ) {
    throw new Error(
      `${context} frame index ${frameIndex} is outside 0..${layout.frame_count - 1}.`
    );
  }
  return frameIndex;
}

export function textureFrameRect(
  layout: TextureFrameLayout,
  frameIndex: number,
  context: string
): [number, number, number, number] {
  const frame = requireTextureFrameIndex(layout, frameIndex, context);
  const top = frame * layout.display_height;
  return [0, top, layout.bitmap_width, top + layout.display_height];
}

export function mapFrameLocalPixelToBitmapPixel(
  layout: TextureFrameLayout,
  frameIndex: number,
  localX: number,
  localY: number,
  context: string
): { x: number; y: number } {
  const frame = requireTextureFrameIndex(layout, frameIndex, context);
  if (!Number.isInteger(localX) || !Number.isInteger(localY)) {
    throw new Error(`${context} requires integer frame-local pixel coordinates.`);
  }
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= layout.bitmap_width ||
    localY >= layout.display_height
  ) {
    throw new Error(
      `${context} frame-local pixel (${localX}, ${localY}) is outside 0..${layout.bitmap_width - 1} × 0..${layout.display_height - 1}.`
    );
  }

  return {
    x: localX,
    y: frame * layout.display_height + localY,
  };
}

/**
 * Absolute bitmap-space pixels may address any frame in an animated texture,
 * but one direct exact-pixel stroke must not accidentally span two frames.
 * No native current-frame selection is inferred: the caller still checks the
 * Blockbench active canvas and its offset before and during the edit.
 */
export function requireSingleFrameBitmapPixels(
  layout: TextureFrameLayout,
  coordinates: readonly { x: number; y: number }[],
  context: string
): number {
  if (coordinates.length === 0) {
    throw new Error(`${context} requires at least one bitmap pixel.`);
  }
  let selectedFrame: number | null = null;
  for (const { x, y } of coordinates) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new Error(`${context} requires safe integer bitmap coordinates.`);
    }
    const frame = Math.floor(y / layout.display_height);
    requireTextureFrameIndex(layout, frame, context);
    mapFrameLocalPixelToBitmapPixel(
      layout, frame, x, y - frame * layout.display_height, context
    );
    if (selectedFrame !== null && frame !== selectedFrame) {
      throw new Error(
        `${context} crosses animated texture frame boundaries. Submit one exact-pixel transaction per frame.`
      );
    }
    selectedFrame = frame;
  }
  return selectedFrame!;
}
