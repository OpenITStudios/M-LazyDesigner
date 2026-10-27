export const TEXTURE_COLOR_PROFILE_MAX_SAMPLES = 4096;
export const TEXTURE_COLOR_PROFILE_PALETTE_SIZE = 6;
export const TEXTURE_HUE_FAMILY_EXAMPLE_LIMIT = 6;

export type TextureColorProfileOptions = {
  maxSamples?: number;
  paletteSize?: number;
};

type Bucket = {
  key: number;
  count: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

type HueFamilyBucket = {
  sector: number;
  count: number;
  r: number;
  g: number;
  b: number;
  luma_min: number;
  luma_max: number;
};

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function normalized(value: number): number {
  return Number(value.toFixed(4));
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

export function analyzeTextureColorProfile(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  options: TextureColorProfileOptions = {}
) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("Texture color profile requires positive integer dimensions.");
  }
  const totalPixels = width * height;
  if (!Number.isSafeInteger(totalPixels) || rgba.length < totalPixels * 4) {
    throw new Error("Texture color profile pixel buffer is smaller than the declared dimensions.");
  }

  const maxSamples = options.maxSamples ?? TEXTURE_COLOR_PROFILE_MAX_SAMPLES;
  const paletteSize = options.paletteSize ?? TEXTURE_COLOR_PROFILE_PALETTE_SIZE;
  if (!Number.isInteger(maxSamples) || maxSamples <= 0) {
    throw new Error("Texture color profile maxSamples must be a positive integer.");
  }
  if (!Number.isInteger(paletteSize) || paletteSize <= 0) {
    throw new Error("Texture color profile paletteSize must be a positive integer.");
  }

  const stride = Math.max(1, Math.ceil(totalPixels / maxSamples));
  const buckets = new Map<number, Bucket>();
  const hueBuckets = new Map<number, HueFamilyBucket>();
  let chromatic = 0;
  let sampled = 0;
  let transparent = 0;
  let translucent = 0;
  let opaque = 0;
  let visible = 0;
  let lumaMin = Number.POSITIVE_INFINITY;
  let lumaMax = Number.NEGATIVE_INFINITY;
  let lumaSum = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += stride) {
    const offset = pixelIndex * 4;
    const r = Number(rgba[offset]);
    const g = Number(rgba[offset + 1]);
    const b = Number(rgba[offset + 2]);
    const a = Number(rgba[offset + 3]);
    if (![r, g, b, a].every(Number.isFinite)) continue;
    sampled += 1;

    if (a <= 0) {
      transparent += 1;
      continue;
    }
    visible += 1;
    if (a >= 255) opaque += 1;
    else translucent += 1;

    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lumaMin = Math.min(lumaMin, luma);
    lumaMax = Math.max(lumaMax, luma);
    lumaSum += luma;

    // Sampled hue evidence is advisory: never equate colors with material IDs.
    // Center 30-degree sectors on 0/30/... so nearby reds cross the 0/360 seam.
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const chroma = maxChannel - minChannel;
    if (maxChannel > 0 && chroma >= 16 && chroma / maxChannel >= 0.18) {
      const wheel = maxChannel === r
        ? ((g - b) / chroma) % 6
        : maxChannel === g
          ? (b - r) / chroma + 2
          : (r - g) / chroma + 4;
      const hue = ((wheel * 60) % 360 + 360) % 360;
      const sector = Math.floor(((hue + 15) % 360) / 30);
      const family: HueFamilyBucket = hueBuckets.get(sector) ?? {
        sector, count: 0, r: 0, g: 0, b: 0,
        luma_min: Number.POSITIVE_INFINITY,
        luma_max: Number.NEGATIVE_INFINITY,
      };
      family.count += 1;
      family.r += r;
      family.g += g;
      family.b += b;
      family.luma_min = Math.min(family.luma_min, luma);
      family.luma_max = Math.max(family.luma_max, luma);
      hueBuckets.set(sector, family);
      chromatic += 1;
    }

    // 3-bit-per-channel buckets keep the payload compact while preserving
    // stable dominant-color families for pixel-art atlases.
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { key, count: 0, r: 0, g: 0, b: 0, a: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.a += a;
    buckets.set(key, bucket);
  }

  const palette = [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.key - right.key)
    .slice(0, paletteSize)
    .map((bucket) => {
      const r = bucket.r / bucket.count;
      const g = bucket.g / bucket.count;
      const b = bucket.b / bucket.count;
      const a = bucket.a / bucket.count;
      return {
        hex: rgbHex(r, g, b),
        rgba: [Math.round(r), Math.round(g), Math.round(b), Math.round(a)] as [
          number,
          number,
          number,
          number,
        ],
        visible_ratio: ratio(bucket.count, visible),
      };
    });

  const hueFamilies = [...hueBuckets.values()]
    .sort((left, right) => right.count - left.count || left.sector - right.sector);

  return {
    state: "available" as const,
    sampling: {
      total_pixels: totalPixels,
      sampled_pixels: sampled,
      stride,
      max_samples: maxSamples,
    },
    alpha: {
      visible_coverage: ratio(visible, sampled),
      transparent_ratio: ratio(transparent, sampled),
      translucent_ratio: ratio(translucent, sampled),
      opaque_ratio: ratio(opaque, sampled),
    },
    luma: visible
      ? {
          min: normalized(lumaMin),
          max: normalized(lumaMax),
          mean: normalized(lumaSum / visible),
          span: normalized(lumaMax - lumaMin),
        }
      : null,
    color_bucket_count: buckets.size,
    dominant_visible_ratio: palette[0]?.visible_ratio ?? 0,
    palette,
    hue_families: {
      family_count: hueFamilies.length,
      chromatic_visible_ratio: ratio(chromatic, visible),
      neutral_visible_ratio: ratio(visible - chromatic, visible),
      examples: hueFamilies.slice(0, TEXTURE_HUE_FAMILY_EXAMPLE_LIMIT).map((family) => ({
        center_hue_degrees: family.sector * 30,
        representative_hex: rgbHex(
          family.r / family.count, family.g / family.count, family.b / family.count
        ),
        visible_ratio: ratio(family.count, visible),
        luma_min: normalized(family.luma_min),
        luma_max: normalized(family.luma_max),
      })),
      examples_truncated: hueFamilies.length > TEXTURE_HUE_FAMILY_EXAMPLE_LIMIT,
      note: "Sampled hue families and shade ranges are advisory evidence only. Hue does not identify a material or authorize recoloring; transparent and near-neutral pixels are excluded.",
    },
  };
}
