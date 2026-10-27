import {
  autoLevelsRgba,
  createGradientMapColorTransform,
  createPalettizeColorTransform,
  createPosterizeColorTransform,
  createTextureColorComputeContext,
  directionalShadeRgba,
  generateShadeRamp,
  gradientMapRgba,
  palettizeErrorDiffusionRgba,
  palettizeRgba,
  posterizeLightnessRgba,
  type AutoLevelsOptions,
  type DirectionalShadeOptions,
  type ErrorDiffusionOptions,
  type GradientMapOptions,
  type PalettizeOptions,
  type PosterizeOptions,
  type ShadeRampOptions,
  type Rgba,
  type TextureColorComputeContext,
  type TextureColorComputeMetrics,
  type TexturePointwiseColorTransform,
} from "@/lib/texture/colorEngine";

export type TextureComputeStep =
  | {
      operation: "auto_levels";
      options?: AutoLevelsOptions;
    }
  | {
      operation: "directional_shade";
      options?: DirectionalShadeOptions;
    }
  | {
      operation: "posterize";
      options: PosterizeOptions;
    }
  | {
      operation: "gradient_map";
      ramp: readonly string[];
      options?: GradientMapOptions;
    }
  | {
      operation: "generated_gradient_map";
      base_color: string;
      ramp: ShadeRampOptions;
      options?: GradientMapOptions;
    }
  | {
      operation: "palettize";
      palette: readonly string[];
      options?: PalettizeOptions;
    }
  | {
      operation: "palette_diffusion";
      palette: readonly string[];
      options?: ErrorDiffusionOptions;
    };

export type TextureComputeExecutionPath =
  | "full_atlas"
  | "bounded_roi"
  | "direct"
  | "fused_pointwise"
  | "streaming_spatial"
  | "nearest_palette"
  | "ordered_palette"
  | "ordered_gradient"
  | "error_diffusion"
  | "sample_first_palette_check";

export type TextureComputeCostPlan = {
  optimized_step_count: number;
  selected_paths: TextureComputeExecutionPath[];
  estimated_full_pixel_passes: number;
  estimated_pixel_visits_baseline: number;
  estimated_pixel_visits_upper_bound: number;
  estimated_peak_temporary_bytes: number;
  palette_preflight_checks: number;
  palette_preflight_sample_visits: number;
  unique_color_sample: {
    sampled_pixels: number;
    unique_colors: number;
    unique_ratio: number;
  };
};

export type TextureComputeReceipt = {
  operation_count: number;
  requested_operation_count: number;
  operations: TextureComputeStep["operation"][];
  skipped_operations: TextureComputeStep["operation"][];
  rewrites: string[];
  changed_pixels: number;
  changed_rect: [number, number, number, number] | null;
  color_cache: TextureColorComputeMetrics;
  execution: {
    fused_groups: number;
    fused_steps: number;
    unique_color_transforms: number;
    scalar_transform_calls: number;
    prepared_generated_ramps: number;
    transient_sample_buffers: number;
    actual_palette_comparisons: number;
    planner: TextureComputeCostPlan;
    region: {
      bounded: boolean;
      mask_scope?: "exact_cube_faces";
      covered_pixels?: number;
      target_rect: [number, number, number, number];
      compute_rect: [number, number, number, number];
      halo: number;
      atlas_pixels: number;
      target_pixels: number;
      compute_pixels: number;
    };
  };
};

export type TextureComputeResult = {
  pixels: Uint8ClampedArray;
  receipt: TextureComputeReceipt;
};

export type TextureComputeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function requireTextureComputeRect(
  rect: TextureComputeRect,
  width: number,
  height: number
): TextureComputeRect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (
    !Number.isSafeInteger(rect.x) ||
    !Number.isSafeInteger(rect.y) ||
    !Number.isSafeInteger(rect.width) ||
    !Number.isSafeInteger(rect.height) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(bottom) ||
    right > width ||
    bottom > height
  ) {
    throw new Error(
      `Texture compute target_rect [${rect.x},${rect.y},${rect.width},${rect.height}] is outside bitmap bounds ${width}x${height}.`
    );
  }
  return rect;
}

function textureComputeStepHalo(step: TextureComputeStep): number {
  return step.operation === "directional_shade" ? 1 : 0;
}

function requireRoiSafeStep(step: TextureComputeStep): void {
  if (step.operation === "palette_diffusion") {
    throw new Error(
      "Texture compute target_rect does not yet support palette_diffusion because error propagation crosses the bounded ROI."
    );
  }
  if (
    (step.operation === "gradient_map" ||
      step.operation === "generated_gradient_map") &&
    step.options?.mode === "ordered"
  ) {
    throw new Error(
      "Texture compute target_rect does not yet support ordered gradient mapping because Bayer phase must remain atlas-relative."
    );
  }
  if (
    step.operation === "palettize" &&
    step.options?.dither === "ordered"
  ) {
    throw new Error(
      "Texture compute target_rect does not yet support ordered palettize because Bayer phase must remain atlas-relative."
    );
  }
}

function expandTextureComputeRect(
  rect: TextureComputeRect,
  halo: number,
  width: number,
  height: number
): TextureComputeRect {
  const left = Math.max(0, rect.x - halo);
  const top = Math.max(0, rect.y - halo);
  const right = Math.min(width, rect.x + rect.width + halo);
  const bottom = Math.min(height, rect.y + rect.height + halo);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function extractTextureComputeRect(
  pixels: Uint8ClampedArray,
  sourceWidth: number,
  rect: TextureComputeRect
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(rect.width * rect.height * 4);
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = ((rect.y + row) * sourceWidth + rect.x) * 4;
    output.set(
      pixels.subarray(sourceOffset, sourceOffset + rowBytes),
      row * rowBytes
    );
  }
  return output;
}

function writeTextureComputeRect(
  target: Uint8ClampedArray,
  targetWidth: number,
  rect: TextureComputeRect,
  patch: Uint8ClampedArray
): void {
  const rowBytes = rect.width * 4;
  for (let row = 0; row < rect.height; row += 1) {
    const targetOffset = ((rect.y + row) * targetWidth + rect.x) * 4;
    target.set(
      patch.subarray(row * rowBytes, (row + 1) * rowBytes),
      targetOffset
    );
  }
}

function changedRectForPatch(
  before: Uint8ClampedArray,
  patch: Uint8ClampedArray,
  sourceWidth: number,
  rect: TextureComputeRect
): {
  count: number;
  rect: [number, number, number, number] | null;
} {
  let count = 0;
  let left = rect.x + rect.width;
  let top = rect.y + rect.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceOffset = ((rect.y + y) * sourceWidth + rect.x + x) * 4;
      const patchOffset = (y * rect.width + x) * 4;
      if (
        before[sourceOffset] === patch[patchOffset] &&
        before[sourceOffset + 1] === patch[patchOffset + 1] &&
        before[sourceOffset + 2] === patch[patchOffset + 2] &&
        before[sourceOffset + 3] === patch[patchOffset + 3]
      ) {
        continue;
      }

      count += 1;
      const globalX = rect.x + x;
      const globalY = rect.y + y;
      left = Math.min(left, globalX);
      top = Math.min(top, globalY);
      right = Math.max(right, globalX);
      bottom = Math.max(bottom, globalY);
    }
  }

  return {
    count,
    rect:
      count === 0
        ? null
        : [left, top, right + 1, bottom + 1],
  };
}

function changedRect(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number
): {
  count: number;
  rect: [number, number, number, number] | null;
} {
  let count = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (
      before[offset] === after[offset] &&
      before[offset + 1] === after[offset + 1] &&
      before[offset + 2] === after[offset + 2] &&
      before[offset + 3] === after[offset + 3]
    ) {
      continue;
    }

    count += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  return {
    count,
    rect:
      count === 0
        ? null
        : [left, top, right + 1, bottom + 1],
  };
}

function optimizeTextureComputeSteps(
  steps: readonly TextureComputeStep[]
): {
  steps: TextureComputeStep[];
  skipped: TextureComputeStep["operation"][];
  rewrites: string[];
} {
  const optimized: TextureComputeStep[] = [];
  const skipped: TextureComputeStep["operation"][] = [];
  const rewrites: string[] = [];

  for (const step of steps) {
    if (
      step.operation === "auto_levels" &&
      step.options?.strength === 0
    ) {
      skipped.push(step.operation);
      continue;
    }
    if (
      step.operation === "directional_shade" &&
      step.options?.strength === 0
    ) {
      skipped.push(step.operation);
      continue;
    }
    if (
      step.operation === "posterize" &&
      step.options.strength === 0
    ) {
      skipped.push(step.operation);
      continue;
    }
    if (
      step.operation === "palette_diffusion" &&
      step.options?.strength === 0
    ) {
      optimized.push({
        operation: "palettize",
        palette: step.palette,
        options: { dither: "none" },
      });
      rewrites.push("palette_diffusion(strength=0)->palettize(nearest)");
      continue;
    }
    if (
      step.operation === "palettize" &&
      step.palette.length === 1 &&
      step.options?.dither === "ordered"
    ) {
      optimized.push({
        ...step,
        options: { ...step.options, dither: "none" },
      });
      rewrites.push("single_color_ordered_palettize->nearest");
      continue;
    }
    if (
      step.operation === "gradient_map" &&
      step.options?.mode === "ordered" &&
      new Set(step.ramp.map((color) => color.toUpperCase())).size === 1
    ) {
      optimized.push({
        ...step,
        options: { ...step.options, mode: "nearest" },
      });
      rewrites.push("constant_ordered_gradient->nearest");
      continue;
    }
    optimized.push(step);
  }

  if (optimized.length === 0) {
    throw new Error(
      "Texture compute pipeline contains only no-op steps; no authored change is required."
    );
  }
  return { steps: optimized, skipped, rewrites };
}

function packedRgbAt(
  pixels: Uint8ClampedArray,
  offset: number
): number {
  return (
    (pixels[offset] << 16) |
    (pixels[offset + 1] << 8) |
    pixels[offset + 2]
  ) >>> 0;
}

function paletteRgbSet(palette: readonly string[]): Set<number> {
  return new Set(
    palette.map((color) => Number.parseInt(color.slice(1, 7), 16))
  );
}

function bitmapAlreadyInPalette(
  pixels: Uint8ClampedArray,
  palette: readonly string[]
): boolean {
  const allowed = paletteRgbSet(palette);
  const pixelCount = pixels.length / 4;

  // Cheaply reject likely non-compliant inputs before paying for a proof scan.
  const sampleCount = Math.min(64, pixelCount);
  const stride = Math.max(1, Math.floor(pixelCount / sampleCount));
  for (let index = 0; index < pixelCount; index += stride) {
    const offset = index * 4;
    if (pixels[offset + 3] === 0) continue;
    if (!allowed.has(packedRgbAt(pixels, offset))) return false;
  }

  // A skip requires proof; only compliant-looking inputs pay for the full scan.
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    if (!allowed.has(packedRgbAt(pixels, offset))) return false;
  }
  return true;
}

function isFusiblePointwiseStep(step: TextureComputeStep): boolean {
  if (step.operation === "posterize") return true;
  if (step.operation === "gradient_map") {
    return (step.options?.mode ?? "nearest") !== "ordered";
  }
  if (step.operation === "generated_gradient_map") {
    return (step.options?.mode ?? "nearest") !== "ordered";
  }
  if (step.operation === "palettize") {
    return (step.options?.dither ?? "none") === "none";
  }
  return false;
}

function estimateUniqueColorSample(
  pixels: Uint8ClampedArray,
  maxSamples = 256
): TextureComputeCostPlan["unique_color_sample"] {
  const pixelCount = pixels.length / 4;
  const sampledPixels = Math.min(maxSamples, pixelCount);
  if (sampledPixels === 0) {
    return { sampled_pixels: 0, unique_colors: 0, unique_ratio: 0 };
  }
  const stride = Math.max(1, Math.floor(pixelCount / sampledPixels));
  const unique = new Set<number>();
  let visited = 0;
  for (
    let index = 0;
    index < pixelCount && visited < sampledPixels;
    index += stride
  ) {
    unique.add(rgbaPackedKey(pixels, index * 4));
    visited += 1;
  }
  return {
    sampled_pixels: visited,
    unique_colors: unique.size,
    unique_ratio: visited === 0 ? 0 : unique.size / visited,
  };
}

function buildTextureComputeCostPlan(
  steps: readonly TextureComputeStep[],
  pixels: Uint8ClampedArray,
  atlasPixels: number,
  computeWidth: number,
  computeHeight: number,
  targetPixels: number,
  bounded: boolean
): TextureComputeCostPlan {
  const computePixels = computeWidth * computeHeight;
  const selected = new Set<TextureComputeExecutionPath>();
  selected.add(bounded ? "bounded_roi" : "full_atlas");

  let executionPasses = 0;
  let palettePreflightChecks = 0;

  for (let index = 0; index < steps.length; ) {
    const step = steps[index];
    if (isFusiblePointwiseStep(step)) {
      let cursor = index + 1;
      while (
        cursor < steps.length &&
        isFusiblePointwiseStep(steps[cursor])
      ) {
        cursor += 1;
      }
      if (cursor - index >= 2) {
        executionPasses += 1;
        selected.add("fused_pointwise");
        for (let groupIndex = index; groupIndex < cursor; groupIndex += 1) {
          const item = steps[groupIndex];
          if (item.operation === "palettize") {
            selected.add("nearest_palette");
            palettePreflightChecks += 1;
            selected.add("sample_first_palette_check");
          }
        }
        index = cursor;
        continue;
      }
    }

    executionPasses += 1;
    if (step.operation === "directional_shade") {
      selected.add("streaming_spatial");
    } else if (step.operation === "palettize") {
      const dither = step.options?.dither ?? "none";
      selected.add(dither === "ordered" ? "ordered_palette" : "nearest_palette");
      palettePreflightChecks += 1;
      selected.add("sample_first_palette_check");
    } else if (step.operation === "palette_diffusion") {
      selected.add("error_diffusion");
      palettePreflightChecks += 1;
      selected.add("sample_first_palette_check");
    } else if (
      (step.operation === "gradient_map" ||
        step.operation === "generated_gradient_map") &&
      step.options?.mode === "ordered"
    ) {
      selected.add("ordered_gradient");
    } else {
      selected.add("direct");
    }
    index += 1;
  }

  const sampleVisits =
    palettePreflightChecks * Math.min(64, computePixels);
  const baselineVisits =
    executionPasses * computePixels + sampleVisits;
  const upperBoundVisits =
    baselineVisits + palettePreflightChecks * computePixels;

  const hasStreamingSpatial = steps.some(
    (step) => step.operation === "directional_shade"
  );
  const spatialRowsBytes = hasStreamingSpatial
    ? computeWidth * 3 * Float32Array.BYTES_PER_ELEMENT
    : 0;
  const operationPeak =
    (bounded ? computePixels * 4 : 0) +
    computePixels * 4 +
    spatialRowsBytes;
  const assemblyPeak = bounded
    ? computePixels * 4 + targetPixels * 4 + atlasPixels * 4
    : computePixels * 4;

  return {
    optimized_step_count: steps.length,
    selected_paths: [...selected],
    estimated_full_pixel_passes: executionPasses,
    estimated_pixel_visits_baseline: baselineVisits,
    estimated_pixel_visits_upper_bound: upperBoundVisits,
    estimated_peak_temporary_bytes: Math.max(operationPeak, assemblyPeak),
    palette_preflight_checks: palettePreflightChecks,
    palette_preflight_sample_visits: sampleVisits,
    unique_color_sample: estimateUniqueColorSample(pixels),
  };
}

function rgbaPackedKey(
  pixels: Uint8ClampedArray,
  offset: number
): number {
  return (
    ((pixels[offset] & 0xff) << 24) |
    ((pixels[offset + 1] & 0xff) << 16) |
    ((pixels[offset + 2] & 0xff) << 8) |
    (pixels[offset + 3] & 0xff)
  ) >>> 0;
}

function compileFusedPointwiseTransforms(
  steps: readonly TextureComputeStep[],
  context: TextureColorComputeContext
): {
  transforms: TexturePointwiseColorTransform[];
  prepared_generated_ramps: number;
} {
  const transforms: TexturePointwiseColorTransform[] = [];
  let preparedGeneratedRamps = 0;

  for (const step of steps) {
    if (step.operation === "posterize") {
      transforms.push(
        createPosterizeColorTransform(step.options, context)
      );
      continue;
    }
    if (step.operation === "gradient_map") {
      transforms.push(
        createGradientMapColorTransform(
          step.ramp,
          step.options,
          context
        )
      );
      continue;
    }
    if (step.operation === "generated_gradient_map") {
      const ramp = generateShadeRamp(step.base_color, step.ramp);
      preparedGeneratedRamps += 1;
      transforms.push(
        createGradientMapColorTransform(
          ramp,
          step.options,
          context
        )
      );
      continue;
    }
    if (step.operation === "palettize") {
      transforms.push(
        createPalettizeColorTransform(
          step.palette,
          step.options,
          context
        )
      );
      continue;
    }
    throw new Error(
      `Texture compute fusion received non-pointwise operation ${step.operation}.`
    );
  }

  return {
    transforms,
    prepared_generated_ramps: preparedGeneratedRamps,
  };
}

function applyFusedPointwiseSteps(
  pixels: Uint8ClampedArray,
  steps: readonly TextureComputeStep[],
  context: TextureColorComputeContext
): {
  pixels: Uint8ClampedArray;
  unique_color_transforms: number;
  scalar_transform_calls: number;
  prepared_generated_ramps: number;
} {
  const output = new Uint8ClampedArray(pixels);
  const transformed = new Map<number, Rgba>();
  const compiled = compileFusedPointwiseTransforms(steps, context);
  let scalarTransformCalls = 0;

  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    const key = rgbaPackedKey(pixels, offset);
    let mapped = transformed.get(key);
    if (!mapped) {
      mapped = [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
      ];
      for (const transform of compiled.transforms) {
        mapped = transform(mapped);
        scalarTransformCalls += 1;
      }
      transformed.set(key, mapped);
    }
    output[offset] = mapped[0];
    output[offset + 1] = mapped[1];
    output[offset + 2] = mapped[2];
    output[offset + 3] = mapped[3];
  }

  return {
    pixels: output,
    unique_color_transforms: transformed.size,
    scalar_transform_calls: scalarTransformCalls,
    prepared_generated_ramps: compiled.prepared_generated_ramps,
  };
}

function applyStep(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  step: TextureComputeStep,
  context: TextureColorComputeContext
): Uint8ClampedArray {
  switch (step.operation) {
    case "auto_levels":
      return autoLevelsRgba(pixels, width, height, step.options, context);

    case "directional_shade":
      return directionalShadeRgba(pixels, width, height, step.options, context);

    case "posterize":
      return posterizeLightnessRgba(
        pixels,
        width,
        height,
        step.options,
        context
      );

    case "gradient_map":
      return gradientMapRgba(
        pixels,
        width,
        height,
        step.ramp,
        step.options,
        context
      );

    case "generated_gradient_map": {
      const ramp = generateShadeRamp(step.base_color, step.ramp);
      return gradientMapRgba(
        pixels,
        width,
        height,
        ramp,
        step.options,
        context
      );
    }

    case "palettize":
      return palettizeRgba(
        pixels,
        width,
        height,
        step.palette,
        step.options,
        context
      );

    case "palette_diffusion":
      return palettizeErrorDiffusionRgba(
        pixels,
        width,
        height,
        step.palette,
        step.options,
        context
      );
  }
}

export function applyTextureComputePipeline(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  steps: readonly TextureComputeStep[],
  targetRect?: TextureComputeRect,
  targetMask?: Uint8Array
): TextureComputeResult {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    source.byteLength !== width * height * 4
  ) {
    throw new Error("Texture compute pipeline requires a valid RGBA bitmap.");
  }
  if (steps.length < 1 || steps.length > 12) {
    throw new Error("Texture compute pipeline requires 1 to 12 steps.");
  }

  const selectiveHue = steps.some((step) =>
    (step.operation === "gradient_map" || step.operation === "generated_gradient_map") &&
    step.options?.sourceHueColor !== undefined
  );
  if (selectiveHue && (!targetRect || steps.length !== 1)) {
    throw new Error("Selective hue-family recoloring requires exactly one gradient step and explicit target_rect.");
  }
  const plan = optimizeTextureComputeSteps(steps);
  const target = targetRect
    ? requireTextureComputeRect(targetRect, width, height)
    : { x: 0, y: 0, width, height };
  let coveredPixels = 0;
  if (targetMask !== undefined) {
    if (!targetRect || !(targetMask instanceof Uint8Array) ||
        targetMask.length !== target.width * target.height) {
      throw new Error("FACE_SCOPE_MASK_INVALID: exact ROI mask required.");
    }
    for (const bit of targetMask) {
      if (bit !== 0 && bit !== 1) throw new Error("FACE_SCOPE_MASK_INVALID: expected 0/1 texels.");
      coveredPixels += bit;
    }
    if (coveredPixels === 0) throw new Error("FACE_SCOPE_MASK_EMPTY: zero face-owned texels.");
  }
  if (targetRect) {
    for (const step of plan.steps) requireRoiSafeStep(step);
  }
  const halo = targetRect
    ? plan.steps.reduce(
        (total, step) => total + textureComputeStepHalo(step),
        0
      )
    : 0;
  const computeRect = targetRect
    ? expandTextureComputeRect(target, halo, width, height)
    : target;
  const computeWidth = computeRect.width;
  const computeHeight = computeRect.height;
  const context = createTextureColorComputeContext();
  let pixels: Uint8ClampedArray<ArrayBufferLike> = targetRect
    ? extractTextureComputeRect(source, width, computeRect)
    : source;
  const costPlan = buildTextureComputeCostPlan(
    plan.steps,
    pixels,
    width * height,
    computeWidth,
    computeHeight,
    target.width * target.height,
    targetRect !== undefined
  );
  const executed: TextureComputeStep["operation"][] = [];
  const skipped = [...plan.skipped];
  let fusedGroups = 0;
  let fusedSteps = 0;
  let uniqueColorTransforms = 0;
  let scalarTransformCalls = 0;
  let preparedGeneratedRamps = 0;

  for (let index = 0; index < plan.steps.length; ) {
    const step = plan.steps[index];

    if (
      (step.operation === "palettize" ||
        step.operation === "palette_diffusion") &&
      bitmapAlreadyInPalette(pixels, step.palette)
    ) {
      skipped.push(step.operation);
      index += 1;
      continue;
    }

    if (isFusiblePointwiseStep(step)) {
      const group: TextureComputeStep[] = [step];
      let cursor = index + 1;
      while (
        cursor < plan.steps.length &&
        isFusiblePointwiseStep(plan.steps[cursor])
      ) {
        group.push(plan.steps[cursor]);
        cursor += 1;
      }

      if (group.length >= 2) {
        const fused = applyFusedPointwiseSteps(
          pixels,
          group,
          context
        );
        pixels = fused.pixels;
        executed.push(...group.map((item) => item.operation));
        fusedGroups += 1;
        fusedSteps += group.length;
        uniqueColorTransforms += fused.unique_color_transforms;
        scalarTransformCalls += fused.scalar_transform_calls;
        preparedGeneratedRamps += fused.prepared_generated_ramps;
        index = cursor;
        continue;
      }
    }

    pixels = applyStep(pixels, computeWidth, computeHeight, step, context);
    executed.push(step.operation);
    index += 1;
  }

  let outputPixels: Uint8ClampedArray<ArrayBufferLike> = pixels;
  let changed: ReturnType<typeof changedRect>;
  if (targetRect) {
    const targetPatch = extractTextureComputeRect(
      pixels,
      computeWidth,
      {
        x: target.x - computeRect.x,
        y: target.y - computeRect.y,
        width: target.width,
        height: target.height,
      }
    );
    if (targetMask) {
      // Restore every unselected byte before computing the authoritative
      // change count, PNG crop and native one-Undo texture transaction.
      for (let index=0;index<targetMask.length;index++) {
        if (targetMask[index] === 1) continue;
        const x=index%target.width, y=Math.floor(index/target.width);
        const sourceOffset=((target.y+y)*width+target.x+x)*4;
        targetPatch.set(source.subarray(sourceOffset,sourceOffset+4),index*4);
      }
    }
    changed = changedRectForPatch(source, targetPatch, width, target);
    outputPixels = new Uint8ClampedArray(source);
    writeTextureComputeRect(outputPixels, width, target, targetPatch);
  } else {
    changed = changedRect(source, pixels, width, height);
  }
  if (changed.count === 0) {
    throw new Error(
      "Texture compute pipeline produced no authored pixel change."
    );
  }

  return {
    pixels: outputPixels,
    receipt: {
      operation_count: executed.length,
      requested_operation_count: steps.length,
      operations: executed,
      skipped_operations: skipped,
      rewrites: plan.rewrites,
      changed_pixels: changed.count,
      changed_rect: changed.rect,
      color_cache: { ...context.metrics },
      execution: {
        fused_groups: fusedGroups,
        fused_steps: fusedSteps,
        unique_color_transforms: uniqueColorTransforms,
        scalar_transform_calls: scalarTransformCalls,
        prepared_generated_ramps: preparedGeneratedRamps,
        transient_sample_buffers: 0,
        actual_palette_comparisons:
          context.metrics.palette_comparisons,
        planner: costPlan,
        region: {
          bounded: targetRect !== undefined,
          ...(targetMask ? {
            mask_scope: "exact_cube_faces" as const,
            covered_pixels: coveredPixels,
          } : {}),
          target_rect: [
            target.x,
            target.y,
            target.x + target.width,
            target.y + target.height,
          ],
          compute_rect: [
            computeRect.x,
            computeRect.y,
            computeRect.x + computeRect.width,
            computeRect.y + computeRect.height,
          ],
          halo,
          atlas_pixels: width * height,
          target_pixels: target.width * target.height,
          compute_pixels: computeRect.width * computeRect.height,
        },
      },
    },
  };
}
