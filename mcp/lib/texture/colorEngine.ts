export type Rgba = [number, number, number, number];

export type Oklab = {
  L: number;
  a: number;
  b: number;
};

export type Oklch = {
  L: number;
  C: number;
  h: number;
};

export type ShadeRampOptions = {
  steps: number;
  shadowLightnessDelta?: number;
  highlightLightnessDelta?: number;
  shadowHueShift?: number;
  highlightHueShift?: number;
  shadowChromaScale?: number;
  highlightChromaScale?: number;
};

export type OrderedDitherMatrix = "bayer2" | "bayer4" | "bayer8";

export type GradientMapMode = "nearest" | "blend" | "ordered";

export type GradientMapOptions = {
  mode?: GradientMapMode;
  matrix?: OrderedDitherMatrix;
  /** Limit a gradient map to a chromatic family inside an explicit transaction ROI. */
  sourceHueColor?: string;
  hueToleranceDegrees?: number;
  minimumChroma?: number;
};

export type PalettizeOptions = {
  dither?: "none" | "ordered";
  matrix?: OrderedDitherMatrix;
};

export type PaletteExtractionOptions = {
  maxSamples?: number;
  alphaThreshold?: number;
};

export type TextureColorComputeMetrics = {
  oklab_cache_hits: number;
  oklab_cache_misses: number;
  palette_cache_hits: number;
  palette_cache_misses: number;
  nearest_cache_hits: number;
  nearest_cache_misses: number;
  pair_cache_hits: number;
  pair_cache_misses: number;
  palette_comparisons: number;
  cache_bypasses: number;
  oklab_peak_entries: number;
  oklab_admission_disabled: boolean;
  oklab_hit_ratio: number;
};

type PreparedPalette = {
  key: string;
  colors: Rgba[];
  labs: Oklab[];
};

type TwoNearestResult = {
  first: number;
  second: number;
  firstDistance: number;
  secondDistance: number;
};

export type TextureColorComputeContext = {
  labs: Map<number, Oklab>;
  palettes: Map<string, PreparedPalette>;
  nearest: Map<string, Map<number, number>>;
  pairs: Map<string, Map<number, TwoNearestResult>>;
  metrics: TextureColorComputeMetrics;
  policy: {
    oklab_admission_enabled: boolean;
  };
};

const MAX_OKLAB_CACHE_ENTRIES = 4096;
const MAX_PALETTE_CACHE_ENTRIES = 32;
const MAX_PALETTE_LOOKUP_ENTRIES = 4096;
const OKLAB_ENTROPY_SAMPLE_MISSES = 512;
const OKLAB_MIN_USEFUL_HIT_RATIO = 0.05;

function refreshOklabCacheMetrics(
  context: TextureColorComputeContext
): void {
  const total =
    context.metrics.oklab_cache_hits +
    context.metrics.oklab_cache_misses;
  context.metrics.oklab_hit_ratio =
    total === 0 ? 0 : context.metrics.oklab_cache_hits / total;
  context.metrics.oklab_peak_entries = Math.max(
    context.metrics.oklab_peak_entries,
    context.labs.size
  );
}

function maybeDisableOklabAdmission(
  context: TextureColorComputeContext
): void {
  if (!context.policy.oklab_admission_enabled) return;
  if (
    context.metrics.oklab_cache_misses < OKLAB_ENTROPY_SAMPLE_MISSES
  ) {
    return;
  }
  refreshOklabCacheMetrics(context);
  if (
    context.metrics.oklab_hit_ratio < OKLAB_MIN_USEFUL_HIT_RATIO
  ) {
    context.policy.oklab_admission_enabled = false;
    context.metrics.oklab_admission_disabled = true;
  }
}

export function createTextureColorComputeContext(): TextureColorComputeContext {
  return {
    labs: new Map(),
    palettes: new Map(),
    nearest: new Map(),
    pairs: new Map(),
    metrics: {
      oklab_cache_hits: 0,
      oklab_cache_misses: 0,
      palette_cache_hits: 0,
      palette_cache_misses: 0,
      nearest_cache_hits: 0,
      nearest_cache_misses: 0,
      pair_cache_hits: 0,
      pair_cache_misses: 0,
      palette_comparisons: 0,
      cache_bypasses: 0,
      oklab_peak_entries: 0,
      oklab_admission_disabled: false,
      oklab_hit_ratio: 0,
    },
    policy: {
      oklab_admission_enabled: true,
    },
  };
}

function rgbaKeyChannels(
  red: number,
  green: number,
  blue: number,
  alpha: number
): number {
  return (
    ((red & 0xff) << 24) |
    ((green & 0xff) << 16) |
    ((blue & 0xff) << 8) |
    (alpha & 0xff)
  ) >>> 0;
}

function rgbaKey(rgba: Rgba): number {
  return rgbaKeyChannels(rgba[0], rgba[1], rgba[2], rgba[3]);
}

function rgbaChannelsToOklab(
  red: number,
  green: number,
  blue: number
): Oklab {
  const r = srgbChannelToLinear(red / 255);
  const g = srgbChannelToLinear(green / 255);
  const b = srgbChannelToLinear(blue / 255);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    L: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function oklabForChannels(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  context?: TextureColorComputeContext
): Oklab {
  if (!context) return rgbaChannelsToOklab(red, green, blue);
  const key = rgbaKeyChannels(red, green, blue, alpha);
  const cached = context.labs.get(key);
  if (cached) {
    context.metrics.oklab_cache_hits += 1;
    refreshOklabCacheMetrics(context);
    return cached;
  }
  const lab = rgbaChannelsToOklab(red, green, blue);
  context.metrics.oklab_cache_misses += 1;
  maybeDisableOklabAdmission(context);
  if (
    context.policy.oklab_admission_enabled &&
    context.labs.size < MAX_OKLAB_CACHE_ENTRIES
  ) {
    context.labs.set(key, lab);
    refreshOklabCacheMetrics(context);
  } else {
    context.metrics.cache_bypasses += 1;
  }
  return lab;
}

function oklabFor(
  rgba: Rgba,
  context?: TextureColorComputeContext
): Oklab {
  return oklabForChannels(
    rgba[0],
    rgba[1],
    rgba[2],
    rgba[3],
    context
  );
}

function preparePalette(
  palette: readonly string[],
  context?: TextureColorComputeContext
): PreparedPalette {
  const key = palette.join("|").toUpperCase();
  if (context) {
    const cached = context.palettes.get(key);
    if (cached) {
      context.metrics.palette_cache_hits += 1;
      return cached;
    }
  }

  const colors = palette.map(parseHexRgba);
  const prepared = {
    key,
    colors,
    labs: colors.map((color) => oklabFor(color, context)),
  };
  if (context) {
    context.metrics.palette_cache_misses += 1;
    if (context.palettes.size < MAX_PALETTE_CACHE_ENTRIES) {
      context.palettes.set(key, prepared);
    } else {
      context.metrics.cache_bypasses += 1;
    }
  }
  return prepared;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function srgbChannelToLinear(value: number): number {
  const c = clamp01(value);
  return c <= 0.04045
    ? c / 12.92
    : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(value: number): number {
  const c = clamp01(value);
  return c <= 0.0031308
    ? 12.92 * c
    : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function byte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

export function parseHexRgba(value: string): Rgba {
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value)) {
    throw new Error("Expected #RRGGBB or #RRGGBBAA color.");
  }
  const hex = value.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255,
  ];
}

export function rgbaToHex(
  rgba: Rgba,
  includeAlpha = rgba[3] !== 255
): string {
  const parts = rgba.map((component) =>
    Math.min(255, Math.max(0, Math.round(component)))
      .toString(16)
      .padStart(2, "0")
  );
  return `#${parts.slice(0, includeAlpha ? 4 : 3).join("").toUpperCase()}`;
}

export function rgbaToOklab(rgba: Rgba): Oklab {
  return rgbaChannelsToOklab(rgba[0], rgba[1], rgba[2]);
}

function oklabChannelsToRgba(
  lightness: number,
  a: number,
  b: number,
  alpha = 255
): Rgba {
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot * lRoot * lRoot;
  const m = mRoot * mRoot * mRoot;
  const s = sRoot * sRoot * sRoot;

  const r =
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g =
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue =
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [
    byte(linearChannelToSrgb(r)),
    byte(linearChannelToSrgb(g)),
    byte(linearChannelToSrgb(blue)),
    Math.min(255, Math.max(0, Math.round(alpha))),
  ];
}

export function oklabToRgba(lab: Oklab, alpha = 255): Rgba {
  return oklabChannelsToRgba(lab.L, lab.a, lab.b, alpha);
}

export function oklabToOklch(lab: Oklab): Oklch {
  const C = Math.hypot(lab.a, lab.b);
  const h =
    C < 1e-12
      ? 0
      : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return { L: lab.L, C, h };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const radians = (lch.h * Math.PI) / 180;
  return {
    L: lch.L,
    a: lch.C * Math.cos(radians),
    b: lch.C * Math.sin(radians),
  };
}

function shortestHueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function interpolateOklch(left: Oklch, right: Oklch, t: number): Oklch {
  const hueDelta = shortestHueDelta(left.h, right.h);
  return {
    L: left.L + (right.L - left.L) * t,
    C: left.C + (right.C - left.C) * t,
    h: (left.h + hueDelta * t + 360) % 360,
  };
}

export function generateShadeRamp(
  baseHex: string,
  options: ShadeRampOptions
): string[] {
  const steps = options.steps;
  if (!Number.isInteger(steps) || steps < 2 || steps > 16) {
    throw new Error("Shade ramp steps must be an integer from 2 to 16.");
  }

  const base = parseHexRgba(baseHex);
  const baseLch = oklabToOklch(rgbaToOklab(base));
  const shadow: Oklch = {
    L: clamp01(
      baseLch.L + (options.shadowLightnessDelta ?? -0.22)
    ),
    C: Math.max(
      0,
      baseLch.C * (options.shadowChromaScale ?? 1.08)
    ),
    h:
      (baseLch.h + (options.shadowHueShift ?? -8) + 360) %
      360,
  };
  const highlight: Oklch = {
    L: clamp01(
      baseLch.L + (options.highlightLightnessDelta ?? 0.22)
    ),
    C: Math.max(
      0,
      baseLch.C * (options.highlightChromaScale ?? 0.88)
    ),
    h:
      (baseLch.h + (options.highlightHueShift ?? 8) + 360) %
      360,
  };

  const colors: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const t = index / (steps - 1);
    let lch: Oklch;
    if (t <= 0.5) {
      lch = interpolateOklch(shadow, baseLch, t * 2);
    } else {
      lch = interpolateOklch(baseLch, highlight, (t - 0.5) * 2);
    }
    colors.push(
      rgbaToHex(oklabToRgba(oklchToOklab(lch), base[3]))
    );
  }
  return colors;
}

function oklabDistanceSquared(left: Oklab, right: Oklab): number {
  const dL = left.L - right.L;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return dL * dL + da * da + db * db;
}

function nearestPaletteIndexFromLabs(
  rgba: Rgba,
  labs: readonly Oklab[],
  context?: TextureColorComputeContext
): number {
  if (labs.length === 0) {
    throw new Error("Palette must contain at least one color.");
  }
  const target = oklabFor(rgba, context);
  if (context) context.metrics.palette_comparisons += labs.length;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < labs.length; index += 1) {
    const distance = oklabDistanceSquared(target, labs[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function nearestPaletteIndex(
  rgba: Rgba,
  palette: readonly string[]
): number {
  if (palette.length === 0) {
    throw new Error("Palette must contain at least one color.");
  }
  return nearestPaletteIndexFromLabs(
    rgba,
    palette.map((color) => rgbaToOklab(parseHexRgba(color)))
  );
}

function twoNearestPaletteIndicesFromLabs(
  rgba: Rgba,
  labs: readonly Oklab[],
  context?: TextureColorComputeContext
): {
  first: number;
  second: number;
  firstDistance: number;
  secondDistance: number;
} {
  if (labs.length === 0) {
    throw new Error("Palette must contain at least one color.");
  }
  const target = oklabFor(rgba, context);
  if (context) context.metrics.palette_comparisons += labs.length;
  let first = 0;
  let second = 0;
  let firstDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < labs.length; index += 1) {
    const distance = oklabDistanceSquared(target, labs[index]);
    if (distance < firstDistance) {
      second = first;
      secondDistance = firstDistance;
      first = index;
      firstDistance = distance;
    } else if (distance < secondDistance) {
      second = index;
      secondDistance = distance;
    }
  }

  if (labs.length === 1) {
    second = first;
    secondDistance = firstDistance;
  }
  return { first, second, firstDistance, secondDistance };
}

function nearestPaletteIndexPrepared(
  rgba: Rgba,
  palette: PreparedPalette,
  context?: TextureColorComputeContext
): number {
  if (!context) {
    return nearestPaletteIndexFromLabs(rgba, palette.labs);
  }
  const colorKey = rgbaKey(rgba);
  let lookup = context.nearest.get(palette.key);
  const cached = lookup?.get(colorKey);
  if (cached !== undefined) {
    context.metrics.nearest_cache_hits += 1;
    return cached;
  }
  const result = nearestPaletteIndexFromLabs(rgba, palette.labs, context);
  context.metrics.nearest_cache_misses += 1;
  if (!lookup) {
    lookup = new Map();
    context.nearest.set(palette.key, lookup);
  }
  if (lookup.size < MAX_PALETTE_LOOKUP_ENTRIES) {
    lookup.set(colorKey, result);
  } else {
    context.metrics.cache_bypasses += 1;
  }
  return result;
}

function twoNearestPaletteIndicesPrepared(
  rgba: Rgba,
  palette: PreparedPalette,
  context?: TextureColorComputeContext
): TwoNearestResult {
  if (!context) {
    return twoNearestPaletteIndicesFromLabs(rgba, palette.labs);
  }
  const colorKey = rgbaKey(rgba);
  let lookup = context.pairs.get(palette.key);
  const cached = lookup?.get(colorKey);
  if (cached) {
    context.metrics.pair_cache_hits += 1;
    return cached;
  }
  const result = twoNearestPaletteIndicesFromLabs(
    rgba,
    palette.labs,
    context
  );
  context.metrics.pair_cache_misses += 1;
  if (!lookup) {
    lookup = new Map();
    context.pairs.set(palette.key, lookup);
  }
  if (lookup.size < MAX_PALETTE_LOOKUP_ENTRIES) {
    lookup.set(colorKey, result);
  } else {
    context.metrics.cache_bypasses += 1;
  }
  return result;
}

const BAYER_2 = [[0, 2], [3, 1]] as const;

function expandBayer(matrix: readonly (readonly number[])[]): number[][] {
  const size = matrix.length;
  const nextSize = size * 2;
  const next = Array.from({ length: nextSize }, () =>
    Array<number>(nextSize).fill(0)
  );
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = matrix[y][x] * 4;
      next[y][x] = value;
      next[y][x + size] = value + 2;
      next[y + size][x] = value + 3;
      next[y + size][x + size] = value + 1;
    }
  }
  return next;
}

const BAYER_4 = expandBayer(BAYER_2);
const BAYER_8 = expandBayer(BAYER_4);

function matrixInfo(matrix: OrderedDitherMatrix) {
  if (matrix === "bayer2") {
    return { size: 2, values: BAYER_2, max: 4 };
  }
  if (matrix === "bayer4") {
    return { size: 4, values: BAYER_4, max: 16 };
  }
  return { size: 8, values: BAYER_8, max: 64 };
}

function orderedThresholdFromInfo(
  info: ReturnType<typeof matrixInfo>,
  x: number,
  y: number
): number {
  return (info.values[y % info.size][x % info.size] + 0.5) / info.max;
}

function interpolateOklab(left: Oklab, right: Oklab, t: number): Oklab {
  return {
    L: left.L + (right.L - left.L) * t,
    a: left.a + (right.a - left.a) * t,
    b: left.b + (right.b - left.b) * t,
  };
}

function rampPosition(
  lightness: number,
  rampLength: number
): {
  leftIndex: number;
  rightIndex: number;
  localT: number;
} {
  if (rampLength <= 1) {
    return { leftIndex: 0, rightIndex: 0, localT: 0 };
  }
  const position = clamp01(lightness) * (rampLength - 1);
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(rampLength - 1, leftIndex + 1);
  return {
    leftIndex,
    rightIndex,
    localT: position - leftIndex,
  };
}


type GradientHueSelection = {
  hue: number;
  tolerance: number;
  minimumChroma: number;
};

function prepareGradientHueSelection(
  options: GradientMapOptions,
  context?: TextureColorComputeContext
): GradientHueSelection | null {
  if (!options.sourceHueColor) {
    if (options.hueToleranceDegrees !== undefined || options.minimumChroma !== undefined) {
      throw new Error("Hue-family tolerance/chroma requires an explicit sourceHueColor.");
    }
    return null;
  }
  const tolerance = options.hueToleranceDegrees ?? 20;
  const minimumChroma = options.minimumChroma ?? 0.035;
  if (!Number.isFinite(tolerance) || tolerance < 5 || tolerance > 60 ||
      !Number.isFinite(minimumChroma) || minimumChroma < 0.015 || minimumChroma > 0.3) {
    throw new Error("Hue-family tolerance or minimum chroma is outside its supported bounds.");
  }
  const source = oklabToOklch(oklabFor(parseHexRgba(options.sourceHueColor), context));
  if (source.C < minimumChroma) {
    throw new Error("Hue-family source color is near-neutral; do not infer a chromatic material family.");
  }
  return { hue: source.h, tolerance, minimumChroma };
}

function gradientHueSelected(
  lab: Oklab,
  selection: GradientHueSelection | null
): boolean {
  if (!selection) return true;
  const color = oklabToOklch(lab);
  return color.C >= selection.minimumChroma &&
    Math.abs(shortestHueDelta(selection.hue, color.h)) <= selection.tolerance;
}

function requirePreservingHueRamp(
  rampLabs: readonly Oklab[],
  selection: GradientHueSelection | null
): void {
  if (!selection) return;
  for (let index = 1; index < rampLabs.length; index += 1) {
    if (!(rampLabs[index].L > rampLabs[index - 1].L + 1e-4)) {
      throw new Error("Hue-family recoloring requires strictly increasing Oklab-lightness ramp anchors.");
    }
  }
}

export function gradientMapRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  ramp: readonly string[],
  options: GradientMapOptions = {},
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new Error("Gradient map requires a valid RGBA bitmap.");
  }
  if (ramp.length < 2 || ramp.length > 16) {
    throw new Error("Gradient map ramp must contain 2 to 16 colors.");
  }

  const prepared = preparePalette(ramp, context);
  const colors = prepared.colors;
  const labs = prepared.labs;
  const selection = prepareGradientHueSelection(options, context);
  requirePreservingHueRamp(labs, selection);
  const mode = options.mode ?? (selection ? "blend" : "nearest");
  const matrix = options.matrix ?? "bayer4";
  const ditherMatrix = mode === "ordered" ? matrixInfo(matrix) : null;
  const output = new Uint8ClampedArray(pixels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha === 0) continue;

      const source: Rgba = [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        alpha,
      ];
      const sourceLab = oklabFor(source, context);
      if (!gradientHueSelected(sourceLab, selection)) continue;
      const position = rampPosition(sourceLab.L, ramp.length);
      let mapped: Rgba;

      if (mode === "nearest") {
        mapped = colors[
          position.localT < 0.5
            ? position.leftIndex
            : position.rightIndex
        ];
      } else if (mode === "blend") {
        const left = labs[position.leftIndex];
        const right = labs[position.rightIndex];
        mapped = oklabChannelsToRgba(
          left.L + (right.L - left.L) * position.localT,
          left.a + (right.a - left.a) * position.localT,
          left.b + (right.b - left.b) * position.localT,
          alpha
        );
      } else {
        const threshold = orderedThresholdFromInfo(ditherMatrix!, x, y);
        mapped = colors[
          position.localT > threshold
            ? position.rightIndex
            : position.leftIndex
        ];
      }

      output[offset] = mapped[0];
      output[offset + 1] = mapped[1];
      output[offset + 2] = mapped[2];
      output[offset + 3] = alpha;
    }
  }
  return output;
}

export function palettizeRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly string[],
  options: PalettizeOptions = {},
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new Error("Palettize requires a valid RGBA bitmap.");
  }
  if (palette.length < 1 || palette.length > 64) {
    throw new Error("Palette must contain 1 to 64 colors.");
  }

  const prepared = preparePalette(palette, context);
  const parsed = prepared.colors;
  const output = new Uint8ClampedArray(pixels);
  const dither = options.dither ?? "none";
  const matrix = options.matrix ?? "bayer4";
  const ditherMatrix = dither === "ordered" ? matrixInfo(matrix) : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha === 0) continue;
      const source: Rgba = [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        alpha,
      ];

      let index: number;
      if (dither === "none" || palette.length === 1) {
        index = nearestPaletteIndexPrepared(source, prepared, context);
      } else {
        const nearest = twoNearestPaletteIndicesPrepared(source, prepared, context);
        if (
          nearest.first === nearest.second ||
          nearest.firstDistance === 0
        ) {
          index = nearest.first;
        } else {
          const total =
            nearest.firstDistance + nearest.secondDistance;
          const secondWeight =
            total === 0 ? 0 : nearest.firstDistance / total;
          index =
            secondWeight > orderedThresholdFromInfo(ditherMatrix!, x, y)
              ? nearest.second
              : nearest.first;
        }
      }

      const mapped = parsed[index];
      output[offset] = mapped[0];
      output[offset + 1] = mapped[1];
      output[offset + 2] = mapped[2];
      output[offset + 3] = alpha;
    }
  }
  return output;
}

type PalettePoint = {
  L: number;
  a: number;
  b: number;
};

type PaletteBox = {
  points: PalettePoint[];
};

function boxRange(box: PaletteBox): {
  axis: keyof PalettePoint;
  span: number;
} {
  let bestAxis: keyof PalettePoint = "L";
  let bestSpan = -1;
  for (const axis of ["L", "a", "b"] as const) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const point of box.points) {
      min = Math.min(min, point[axis]);
      max = Math.max(max, point[axis]);
    }
    const span = max - min;
    if (span > bestSpan) {
      bestSpan = span;
      bestAxis = axis;
    }
  }
  return { axis: bestAxis, span: bestSpan };
}

function averageBox(box: PaletteBox): Oklab {
  const sum = box.points.reduce(
    (acc, point) => ({
      L: acc.L + point.L,
      a: acc.a + point.a,
      b: acc.b + point.b,
    }),
    { L: 0, a: 0, b: 0 }
  );
  const count = Math.max(1, box.points.length);
  return {
    L: sum.L / count,
    a: sum.a / count,
    b: sum.b / count,
  };
}

export function extractPaletteMedianCut(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  paletteSize: number,
  options: PaletteExtractionOptions = {}
): string[] {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new Error("Palette extraction requires a valid RGBA bitmap.");
  }
  if (!Number.isInteger(paletteSize) || paletteSize < 1 || paletteSize > 32) {
    throw new Error("Palette size must be an integer from 1 to 32.");
  }

  const maxSamples = options.maxSamples ?? 4096;
  const alphaThreshold = options.alphaThreshold ?? 8;
  if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
    throw new Error("maxSamples must be a positive integer.");
  }

  const pixelCount = width * height;
  const stride = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const points: PalettePoint[] = [];
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += stride) {
    const offset = pixelIndex * 4;
    const alpha = pixels[offset + 3];
    if (alpha < alphaThreshold) continue;
    const lab = rgbaToOklab([
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      alpha,
    ]);
    points.push(lab);
  }
  if (points.length === 0) return [];

  const boxes: PaletteBox[] = [{ points }];
  while (boxes.length < paletteSize) {
    let bestIndex = -1;
    let bestScore = -1;
    let bestAxis: keyof PalettePoint = "L";

    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box.points.length < 2) continue;
      const range = boxRange(box);
      const score = range.span * box.points.length;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
        bestAxis = range.axis;
      }
    }
    if (bestIndex < 0) break;

    const [box] = boxes.splice(bestIndex, 1);
    box.points.sort((left, right) => left[bestAxis] - right[bestAxis]);
    const middle = Math.floor(box.points.length / 2);
    boxes.push(
      { points: box.points.slice(0, middle) },
      { points: box.points.slice(middle) }
    );
  }

  return boxes
    .filter((box) => box.points.length > 0)
    .map(averageBox)
    .sort((left, right) => left.L - right.L)
    .map((lab) => rgbaToHex(oklabToRgba(lab)));
}


export type AutoLevelsOptions = {
  lowClipPercent?: number;
  highClipPercent?: number;
  strength?: number;
};

export type PosterizeOptions = {
  levels: number;
  strength?: number;
};

export type SpatialGradientType =
  | "linear"
  | "reflected"
  | "radial"
  | "diamond"
  | "conical";

export type SpatialGradientOptions = {
  type?: SpatialGradientType;
  start: { x: number; y: number };
  end: { x: number; y: number };
  mode?: GradientMapMode;
  matrix?: OrderedDitherMatrix;
};

export type HeightFieldOptions = {
  source?: "lightness" | "alpha";
  invert?: boolean;
};

export type DirectionalShadeOptions = HeightFieldOptions & {
  azimuthDegrees?: number;
  elevationDegrees?: number;
  depth?: number;
  ambient?: number;
  strength?: number;
};

export type ErrorDiffusionOptions = {
  strength?: number;
  serpentine?: boolean;
};

function requireBitmap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    pixels.byteLength !== width * height * 4
  ) {
    throw new Error(`${label} requires a valid RGBA bitmap.`);
  }
}

function selectKth(values: number[], k: number): number {
  let left = 0;
  let right = values.length - 1;

  while (left < right) {
    const middle = (left + right) >>> 1;
    const a = values[left];
    const b = values[middle];
    const c = values[right];
    const pivot =
      a < b
        ? b < c
          ? b
          : a < c
            ? c
            : a
        : a < c
          ? a
          : b < c
            ? c
            : b;

    let i = left;
    let j = right;
    while (i <= j) {
      while (values[i] < pivot) i += 1;
      while (values[j] > pivot) j -= 1;
      if (i <= j) {
        const temp = values[i];
        values[i] = values[j];
        values[j] = temp;
        i += 1;
        j -= 1;
      }
    }

    if (k <= j) right = j;
    else if (k >= i) left = i;
    else return values[k];
  }

  return values[k];
}

function percentile(values: number[], t: number): number {
  if (values.length === 0) return 0;
  const position = clamp01(t) * (values.length - 1);
  const low = Math.floor(position);
  const high = Math.min(values.length - 1, low + 1);
  const local = position - low;
  const lowValue = selectKth(values, low);
  const highValue = high === low ? lowValue : selectKth(values, high);
  return lowValue + (highValue - lowValue) * local;
}

export function autoLevelsRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: AutoLevelsOptions = {},
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  requireBitmap(pixels, width, height, "Auto levels");
  const lowClip = options.lowClipPercent ?? 0.5;
  const highClip = options.highClipPercent ?? 0.5;
  const strength = clamp01(options.strength ?? 1);
  if (
    !Number.isFinite(lowClip) ||
    !Number.isFinite(highClip) ||
    lowClip < 0 ||
    highClip < 0 ||
    lowClip + highClip >= 100
  ) {
    throw new Error("Auto levels clip percentages must be non-negative and sum to less than 100.");
  }

  const values: number[] = [];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    values.push(oklabForChannels(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          pixels[offset + 3],
          context
        ).L);
  }
  if (values.length === 0) return new Uint8ClampedArray(pixels);
  const low = percentile(values, lowClip / 100);
  const high = percentile(values, 1 - highClip / 100);
  if (!(high > low + 1e-9)) return new Uint8ClampedArray(pixels);

  const output = new Uint8ClampedArray(pixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if (alpha === 0) continue;
    const lab = oklabForChannels(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      alpha,
      context
    );
    const normalized = clamp01((lab.L - low) / (high - low));
    const adjusted = lab.L + (normalized - lab.L) * strength;
    const mapped = oklabChannelsToRgba(
      adjusted,
      lab.a,
      lab.b,
      alpha
    );
    output[offset] = mapped[0];
    output[offset + 1] = mapped[1];
    output[offset + 2] = mapped[2];
  }
  return output;
}

export type TexturePointwiseColorTransform = (rgba: Rgba) => Rgba;

export function createPosterizeColorTransform(
  options: PosterizeOptions,
  context?: TextureColorComputeContext
): TexturePointwiseColorTransform {
  const levels = options.levels;
  if (!Number.isInteger(levels) || levels < 2 || levels > 32) {
    throw new Error("Posterize levels must be an integer from 2 to 32.");
  }
  const strength = clamp01(options.strength ?? 1);
  return (source: Rgba): Rgba => {
    if (source[3] === 0) return source;
    const lab = oklabFor(source, context);
    const quantized = Math.round(lab.L * (levels - 1)) / (levels - 1);
    return oklabChannelsToRgba(
      lab.L + (quantized - lab.L) * strength,
      lab.a,
      lab.b,
      source[3]
    );
  };
}

export function createGradientMapColorTransform(
  ramp: readonly string[],
  options: GradientMapOptions = {},
  context?: TextureColorComputeContext
): TexturePointwiseColorTransform {
  if (ramp.length < 2 || ramp.length > 16) {
    throw new Error("Gradient map ramp must contain 2 to 16 colors.");
  }
  const selection = prepareGradientHueSelection(options, context);
  const mode = options.mode ?? (selection ? "blend" : "nearest");
  if (mode === "ordered") {
    throw new Error(
      "Prepared pointwise gradient transform does not support coordinate-dependent ordered mode."
    );
  }
  const prepared = preparePalette(ramp, context);
  requirePreservingHueRamp(prepared.labs, selection);
  return (source: Rgba): Rgba => {
    if (source[3] === 0) return source;
    const sourceLab = oklabFor(source, context);
    if (!gradientHueSelected(sourceLab, selection)) return source;
    const position = rampPosition(sourceLab.L, prepared.colors.length);
    if (mode === "nearest") {
      const mapped =
        prepared.colors[
          position.localT < 0.5
            ? position.leftIndex
            : position.rightIndex
        ];
      return [mapped[0], mapped[1], mapped[2], source[3]];
    }
    const left = prepared.labs[position.leftIndex];
    const right = prepared.labs[position.rightIndex];
    return oklabChannelsToRgba(
      left.L + (right.L - left.L) * position.localT,
      left.a + (right.a - left.a) * position.localT,
      left.b + (right.b - left.b) * position.localT,
      source[3]
    );
  };
}

export function createPalettizeColorTransform(
  palette: readonly string[],
  options: PalettizeOptions = {},
  context?: TextureColorComputeContext
): TexturePointwiseColorTransform {
  if (palette.length < 1 || palette.length > 64) {
    throw new Error("Palette must contain 1 to 64 colors.");
  }
  if ((options.dither ?? "none") !== "none") {
    throw new Error(
      "Prepared pointwise palettize transform does not support coordinate-dependent ordered dithering."
    );
  }
  const prepared = preparePalette(palette, context);
  return (source: Rgba): Rgba => {
    if (source[3] === 0) return source;
    const index = nearestPaletteIndexPrepared(source, prepared, context);
    const mapped = prepared.colors[index];
    return [mapped[0], mapped[1], mapped[2], source[3]];
  };
}

export function posterizeLightnessRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: PosterizeOptions,
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  requireBitmap(pixels, width, height, "Posterize");
  const levels = options.levels;
  if (!Number.isInteger(levels) || levels < 2 || levels > 32) {
    throw new Error("Posterize levels must be an integer from 2 to 32.");
  }
  const strength = clamp01(options.strength ?? 1);
  const output = new Uint8ClampedArray(pixels);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if (alpha === 0) continue;
    const lab = oklabForChannels(
      pixels[offset],
      pixels[offset + 1],
      pixels[offset + 2],
      alpha,
      context
    );
    const quantized = Math.round(lab.L * (levels - 1)) / (levels - 1);
    const mapped = oklabChannelsToRgba(
      lab.L + (quantized - lab.L) * strength,
      lab.a,
      lab.b,
      alpha
    );
    output[offset] = mapped[0];
    output[offset + 1] = mapped[1];
    output[offset + 2] = mapped[2];
  }
  return output;
}

function gradientT(
  x: number,
  y: number,
  options: SpatialGradientOptions
): number {
  const dx = options.end.x - options.start.x;
  const dy = options.end.y - options.start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) {
    throw new Error("Spatial gradient requires distinct start and end points.");
  }

  const px = x + 0.5 - options.start.x;
  const py = y + 0.5 - options.start.y;
  const linear = (px * dx + py * dy) / lengthSquared;
  const type = options.type ?? "linear";

  if (type === "linear") return clamp01(linear);
  if (type === "reflected") {
    const wrapped = Math.abs(linear);
    const whole = Math.floor(wrapped);
    const local = wrapped - whole;
    return whole % 2 === 0 ? local : 1 - local;
  }

  const radius = Math.sqrt(lengthSquared);
  if (type === "radial") {
    return clamp01(Math.hypot(px, py) / radius);
  }
  if (type === "diamond") {
    return clamp01((Math.abs(px) + Math.abs(py)) / radius);
  }

  const baseAngle = Math.atan2(dy, dx);
  const angle = Math.atan2(py, px);
  let normalized = (angle - baseAngle) / (Math.PI * 2);
  normalized -= Math.floor(normalized);
  return normalized;
}

function rampColorAt(
  rampColors: readonly Rgba[],
  rampLabs: readonly Oklab[],
  t: number,
  mode: GradientMapMode,
  matrix: ReturnType<typeof matrixInfo> | null,
  x: number,
  y: number
): Rgba {
  const position = rampPosition(t, rampColors.length);
  if (mode === "nearest") {
    return rampColors[
      position.localT < 0.5
        ? position.leftIndex
        : position.rightIndex
    ];
  }
  if (mode === "blend") {
    return oklabToRgba(
      interpolateOklab(
        rampLabs[position.leftIndex],
        rampLabs[position.rightIndex],
        position.localT
      )
    );
  }
  return rampColors[
    position.localT >
    orderedThresholdFromInfo(matrix!, x, y)
      ? position.rightIndex
      : position.leftIndex
  ];
}

export function generateSpatialGradientRgba(
  width: number,
  height: number,
  ramp: readonly string[],
  options: SpatialGradientOptions
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Spatial gradient requires positive integer dimensions.");
  }
  if (ramp.length < 2 || ramp.length > 16) {
    throw new Error("Spatial gradient ramp must contain 2 to 16 colors.");
  }
  const colors = ramp.map(parseHexRgba);
  const labs = colors.map(rgbaToOklab);
  const mode = options.mode ?? "blend";
  const matrix =
    mode === "ordered"
      ? matrixInfo(options.matrix ?? "bayer4")
      : null;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mapped = rampColorAt(
        colors,
        labs,
        gradientT(x, y, options),
        mode,
        matrix,
        x,
        y
      );
      const offset = (y * width + x) * 4;
      output[offset] = mapped[0];
      output[offset + 1] = mapped[1];
      output[offset + 2] = mapped[2];
      output[offset + 3] = mapped[3];
    }
  }
  return output;
}

export function heightFieldFromRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: HeightFieldOptions = {},
  context?: TextureColorComputeContext
): Float32Array {
  requireBitmap(pixels, width, height, "Height field");
  const source = options.source ?? "lightness";
  const invert = options.invert === true;
  const field = new Float32Array(width * height);

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    let value =
      source === "alpha"
        ? pixels[offset + 3] / 255
        : oklabForChannels(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          pixels[offset + 3],
          context
        ).L;
    if (invert) value = 1 - value;
    field[index] = clamp01(value);
  }
  return field;
}

function clampedField(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  return field[cy * width + cx];
}

export function sobelHeightGradient(
  field: Float32Array,
  width: number,
  height: number
): { dx: Float32Array; dy: Float32Array } {
  if (
    field.length !== width * height ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Sobel height gradient requires a valid scalar field.");
  }

  const dx = new Float32Array(field.length);
  const dy = new Float32Array(field.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tl = clampedField(field, width, height, x - 1, y - 1);
      const tc = clampedField(field, width, height, x, y - 1);
      const tr = clampedField(field, width, height, x + 1, y - 1);
      const ml = clampedField(field, width, height, x - 1, y);
      const mr = clampedField(field, width, height, x + 1, y);
      const bl = clampedField(field, width, height, x - 1, y + 1);
      const bc = clampedField(field, width, height, x, y + 1);
      const br = clampedField(field, width, height, x + 1, y + 1);

      const index = y * width + x;
      dx[index] = (tr + 2 * mr + br - tl - 2 * ml - bl) / 8;
      dy[index] = (bl + 2 * bc + br - tl - 2 * tc - tr) / 8;
    }
  }
  return { dx, dy };
}

function fillHeightRow(
  pixels: Uint8ClampedArray,
  width: number,
  y: number,
  options: HeightFieldOptions,
  target: Float32Array,
  context?: TextureColorComputeContext
): void {
  const source = options.source ?? "lightness";
  const invert = options.invert === true;
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    let value =
      source === "alpha"
        ? pixels[offset + 3] / 255
        : oklabForChannels(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          pixels[offset + 3],
          context
        ).L;
    if (invert) value = 1 - value;
    target[x] = clamp01(value);
  }
}

function sobelFromRows(
  previous: Float32Array,
  current: Float32Array,
  next: Float32Array,
  x: number
): { dx: number; dy: number } {
  const left = Math.max(0, x - 1);
  const right = Math.min(current.length - 1, x + 1);

  const tl = previous[left];
  const tc = previous[x];
  const tr = previous[right];
  const ml = current[left];
  const mr = current[right];
  const bl = next[left];
  const bc = next[x];
  const br = next[right];

  return {
    dx: (tr + 2 * mr + br - tl - 2 * ml - bl) / 8,
    dy: (bl + 2 * bc + br - tl - 2 * tc - tr) / 8,
  };
}

export function directionalShadeRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: DirectionalShadeOptions = {},
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  requireBitmap(pixels, width, height, "Directional shade");
  const azimuth = ((options.azimuthDegrees ?? 315) * Math.PI) / 180;
  const elevation = ((options.elevationDegrees ?? 45) * Math.PI) / 180;
  const depth = Math.max(0, options.depth ?? 2);
  const ambient = clamp01(options.ambient ?? 0.35);
  const strength = clamp01(options.strength ?? 1);

  const lx = Math.cos(elevation) * Math.cos(azimuth);
  const ly = Math.cos(elevation) * Math.sin(azimuth);
  const lz = Math.sin(elevation);

  // Sobel needs only three height rows. Stream them instead of materializing
  // full height/dx/dy Float32 images.
  let previous = new Float32Array(width);
  let current = new Float32Array(width);
  let next = new Float32Array(width);
  fillHeightRow(pixels, width, 0, options, previous, context);
  fillHeightRow(pixels, width, 0, options, current, context);
  fillHeightRow(
    pixels,
    width,
    Math.min(1, height - 1),
    options,
    next,
    context
  );

  const output = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha === 0) continue;

      const gradient = sobelFromRows(previous, current, next, x);
      let nx = -gradient.dx * depth;
      let ny = -gradient.dy * depth;
      let nz = 1;
      const nLength = Math.hypot(nx, ny, nz) || 1;
      nx /= nLength;
      ny /= nLength;
      nz /= nLength;

      const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
      const lab = oklabForChannels(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        alpha,
        context
      );
      const shadeDelta = (diffuse - 0.5) * (1 - ambient) * 0.5;
      const targetL = clamp01(lab.L + shadeDelta);
      const mapped = oklabChannelsToRgba(
        lab.L + (targetL - lab.L) * strength,
        lab.a,
        lab.b,
        alpha
      );
      output[offset] = mapped[0];
      output[offset + 1] = mapped[1];
      output[offset + 2] = mapped[2];
    }

    const recycled = previous;
    previous = current;
    current = next;
    next = recycled;
    fillHeightRow(
      pixels,
      width,
      Math.min(height - 1, y + 2),
      options,
      next,
      context
    );
  }
  return output;
}

export function palettizeErrorDiffusionRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly string[],
  options: ErrorDiffusionOptions = {},
  context?: TextureColorComputeContext
): Uint8ClampedArray {
  requireBitmap(pixels, width, height, "Error diffusion");
  if (palette.length < 1 || palette.length > 64) {
    throw new Error("Palette must contain 1 to 64 colors.");
  }
  const strength = clamp01(options.strength ?? 1);
  const serpentine = options.serpentine !== false;
  const prepared = preparePalette(palette, context);
  const parsed = prepared.colors;
  const labs = prepared.labs;
  const output = new Uint8ClampedArray(pixels);
  const errorRows = [
    new Float32Array((width + 2) * 3),
    new Float32Array((width + 2) * 3),
  ];

  for (let y = 0; y < height; y += 1) {
    const forward = !serpentine || y % 2 === 0;
    const current = errorRows[y % 2];
    const next = errorRows[(y + 1) % 2];
    next.fill(0);

    for (let step = 0; step < width; step += 1) {
      const x = forward ? step : width - 1 - step;
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      if (alpha === 0) continue;

      const errorIndex = (x + 1) * 3;
      const sourceLab = oklabForChannels(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        alpha,
        context
      );
      const adjustedL = clamp01(
        sourceLab.L + current[errorIndex] * strength
      );
      const adjustedA =
        sourceLab.a + current[errorIndex + 1] * strength;
      const adjustedB =
        sourceLab.b + current[errorIndex + 2] * strength;
      const adjusted = oklabChannelsToRgba(
        adjustedL,
        adjustedA,
        adjustedB,
        alpha
      );
      const paletteIndex = nearestPaletteIndexPrepared(adjusted, prepared, context);
      const mapped = parsed[paletteIndex];
      const mappedLab = labs[paletteIndex];

      output[offset] = mapped[0];
      output[offset + 1] = mapped[1];
      output[offset + 2] = mapped[2];
      output[offset + 3] = alpha;

      const eL = adjustedL - mappedLab.L;
      const ea = adjustedA - mappedLab.a;
      const eb = adjustedB - mappedLab.b;
      const sign = forward ? 1 : -1;

      const addError = (
        row: Float32Array,
        px: number,
        weight: number
      ) => {
        if (px < 0 || px >= width) return;
        const index = (px + 1) * 3;
        row[index] += eL * weight;
        row[index + 1] += ea * weight;
        row[index + 2] += eb * weight;
      };

      addError(current, x + sign, 7 / 16);
      addError(next, x - sign, 3 / 16);
      addError(next, x, 5 / 16);
      addError(next, x + sign, 1 / 16);
    }
  }
  return output;
}
