export type TexturePixelMetrics = {
  width: number;
  displayHeight: number;
  uvWidth: number;
  uvHeight: number;
};

export const SUPPORTED_FACE_ROTATIONS = [0, 90, 180, 270] as const;
export type SupportedFaceRotation = (typeof SUPPORTED_FACE_ROTATIONS)[number];

export type FaceTexturePixelMapping = {
  corners: [number, number, number, number];
  rect: [number, number, number, number];
  size: [number, number];
  flip_u: boolean;
  flip_v: boolean;
  /** Exact authored UV lies wholly within the current texture frame. */
  in_bounds: boolean;
};

export function requireFiniteFaceUv(
  values: readonly number[],
  context: string
): [number, number, number, number] {
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `${context} contains a non-finite authored face UV rectangle and cannot be mapped safely.`
    );
  }
  return [values[0], values[1], values[2], values[3]];
}

export function requirePositiveTextureMetric(
  value: number,
  context: string
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${context} must be a finite positive texture dimension for UV-to-pixel mapping.`
    );
  }
  return value;
}

export function requireSupportedFaceRotation(
  value: number,
  context: string
): SupportedFaceRotation {
  if (!SUPPORTED_FACE_ROTATIONS.includes(value as SupportedFaceRotation)) {
    throw new Error(
      `${context} uses unsupported face rotation ${value}. Expected 0, 90, 180, or 270 degrees.`
    );
  }
  return value as SupportedFaceRotation;
}

/** A logical UV fraction is valid when it maps to a complete physical texel.
 * Tolerate machine-level floating arithmetic, never an actual subpixel.
 */
export function isIntegralPhysicalPixelCoordinate(value: number): boolean {
  return Number.isFinite(value) &&
    Math.abs(value - Math.round(value)) <= 1e-9;
}

/** Accept signed U/V corners; bounds and rotation remain native-owned. */
export function requireUvPhysicalPixelGrid(
  coordinates: readonly number[],
  physicalPixelsPerUvUnit: readonly [number, number],
  context: string
): void {
  if (coordinates.length !== 4 ||
      coordinates.some((value) => !Number.isFinite(value)) ||
      physicalPixelsPerUvUnit.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("UV_PHYSICAL_GRID_INVALID: " + context +
      " requires finite UV corners and positive pixel scales.");
  }
  if (coordinates.some((value, axis) =>
    !isIntegralPhysicalPixelCoordinate(value * physicalPixelsPerUvUnit[axis % 2])
  )) {
    throw new Error("UV_NON_INTEGRAL_PIXEL_MAPPING: " + context +
      " must lie on complete physical texels, not necessarily integer logical UV coordinates.");
  }
}

function roundNativePainterCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mapFaceUvToTexturePixels(
  values: readonly number[],
  metrics: TexturePixelMetrics,
  context: string
): FaceTexturePixelMapping {
  const uv = requireFiniteFaceUv(values, context);
  const width = requirePositiveTextureMetric(metrics.width, `${context} texture width`);
  const displayHeight = requirePositiveTextureMetric(
    metrics.displayHeight,
    `${context} texture display height`
  );
  const uvWidth = requirePositiveTextureMetric(metrics.uvWidth, `${context} UV width`);
  const uvHeight = requirePositiveTextureMetric(metrics.uvHeight, `${context} UV height`);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(displayHeight)) {
    throw new Error(
      `${context} texture frame pixel dimensions must be positive safe integers.`
    );
  }

  const factorX = width / uvWidth;
  const factorY = displayHeight / uvHeight;
  const corners = [
    uv[0] * factorX,
    uv[1] * factorY,
    uv[2] * factorX,
    uv[3] * factorY,
  ] as [number, number, number, number];

  if (corners.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `${context} produced a non-finite texture-space coordinate and cannot be mapped safely.`
    );
  }

  const left = Math.floor(
    roundNativePainterCoordinate(Math.min(corners[0], corners[2]))
  );
  const top = Math.floor(
    roundNativePainterCoordinate(Math.min(corners[1], corners[3]))
  );
  const right = Math.ceil(
    roundNativePainterCoordinate(Math.max(corners[0], corners[2]))
  );
  const bottom = Math.ceil(
    roundNativePainterCoordinate(Math.max(corners[1], corners[3]))
  );

  return {
    corners,
    rect: [left, top, right, bottom],
    size: [right - left, bottom - top],
    flip_u: corners[2] < corners[0],
    flip_v: corners[3] < corners[1],
    // Compare unrounded corners: rounding to Painter display precision
    // must never conceal an actual subpixel excursion beyond the bitmap.
    in_bounds:
      Math.min(corners[0], corners[2]) >= 0 &&
      Math.min(corners[1], corners[3]) >= 0 &&
      Math.max(corners[0], corners[2]) <= width &&
      Math.max(corners[1], corners[3]) <= displayHeight,
  };
}

export function requireExactFacePixelGrid(
  mapping: FaceTexturePixelMapping,
  context: string
): [number, number] {
  if (!mapping.in_bounds) {
    throw new Error(
      `${context} face UV lies outside the active texture frame. Exact-pixel painting cannot address pixels beyond bitmap bounds.`
    );
  }
  if (!mapping.corners.every(isIntegralPhysicalPixelCoordinate)) {
    throw new Error(
      `${context} does not map to exact physical pixel boundaries. Face-local exact painting requires integral texture-pixel UV boundaries.`
    );
  }

  // Native Painter uses integer pixel addresses. Normalize insignificant
  // floating drift after validating alignment, never a true fractional texel.
  const pixelCorners = mapping.corners.map((value) => Math.round(value));
  const uPixels = Math.abs(pixelCorners[2] - pixelCorners[0]);
  const vPixels = Math.abs(pixelCorners[3] - pixelCorners[1]);
  if (
    !Number.isInteger(uPixels) ||
    !Number.isInteger(vPixels) ||
    uPixels <= 0 ||
    vPixels <= 0 ||
    mapping.size[0] !== uPixels ||
    mapping.size[1] !== vPixels
  ) {
    throw new Error(
      `${context} does not define a positive exact face pixel grid.`
    );
  }
  return [uPixels, vPixels];
}

export function faceLocalPixelSize(
  mapping: FaceTexturePixelMapping,
  rotationValue: number,
  context: string
): [number, number] {
  const [uPixels, vPixels] = requireExactFacePixelGrid(mapping, context);
  const rotation = requireSupportedFaceRotation(rotationValue, context);
  return rotation === 90 || rotation === 270
    ? [vPixels, uPixels]
    : [uPixels, vPixels];
}

/**
 * Maps one caller-visible face-local pixel back to the underlying texture atlas.
 * Blockbench CubeFace.UVToLocal rotates normalized UV once per 90 degrees as
 * [x, y] -> [1 - y, x]; this applies the discrete inverse of that transform.
 */
export function mapFaceLocalPixelToAtlasPixel(
  mapping: FaceTexturePixelMapping,
  rotationValue: number,
  localX: number,
  localY: number,
  context: string
): { x: number; y: number } {
  if (!Number.isInteger(localX) || !Number.isInteger(localY)) {
    throw new Error(`${context} requires integer face-local pixel coordinates.`);
  }

  const [uPixels, vPixels] = requireExactFacePixelGrid(mapping, context);
  const rotation = requireSupportedFaceRotation(rotationValue, context);
  const [localWidth, localHeight] = faceLocalPixelSize(
    mapping,
    rotation,
    context
  );
  if (
    localX < 0 ||
    localY < 0 ||
    localX >= localWidth ||
    localY >= localHeight
  ) {
    throw new Error(
      `${context} local pixel (${localX}, ${localY}) is outside face bounds 0..${localWidth - 1} × 0..${localHeight - 1}.`
    );
  }

  let uIndex: number;
  let vIndex: number;
  switch (rotation) {
    case 0:
      uIndex = localX;
      vIndex = localY;
      break;
    case 90:
      uIndex = localY;
      vIndex = vPixels - 1 - localX;
      break;
    case 180:
      uIndex = uPixels - 1 - localX;
      vIndex = vPixels - 1 - localY;
      break;
    case 270:
      uIndex = uPixels - 1 - localY;
      vIndex = localX;
      break;
  }

  const [left, top, right, bottom] = mapping.rect;
  return {
    x: mapping.flip_u ? right - 1 - uIndex : left + uIndex,
    y: mapping.flip_v ? bottom - 1 - vIndex : top + vIndex,
  };
}
