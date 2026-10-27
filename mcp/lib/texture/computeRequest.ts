import { z } from "zod";
import {
  type GradientMapMode,
  type OrderedDitherMatrix,
} from "@/lib/texture/colorEngine";
import type {
  TextureComputeRect,
  TextureComputeStep,
} from "@/lib/texture/computePipeline";
import { requiredHexColorSchema } from "@/lib/zodObjects";

const matrixSchema = z.enum(["bayer2", "bayer4", "bayer8"]);
const gradientModeSchema = z.enum(["nearest", "blend", "ordered"]);
const paletteSchema = z.array(requiredHexColorSchema).min(1).max(64);
const rampSchema = z.array(requiredHexColorSchema).min(2).max(16);
const faceTargetSchema = z.object({
  cube_uuid: z.string().trim().min(1),
  face: z.enum(["north","south","east","west","up","down"]),
}).strict();
const faceTargetsSchema = z.array(faceTargetSchema).min(1).max(64)
  .refine((items) => new Set(items.map((f) => f.cube_uuid+":"+f.face)).size === items.length,
    "face_targets must be unique.");

const targetRectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const autoLevelsArgs = z.object({
  low_clip_percent: z.number().min(0).max(49).optional(),
  high_clip_percent: z.number().min(0).max(49).optional(),
  strength: z.number().min(0).max(1).optional(),
}).strict().refine(
  (value) =>
    (value.low_clip_percent ?? 0.5) +
      (value.high_clip_percent ?? 0.5) <
    100,
  "auto_levels clip percentages must sum to less than 100."
);

const directionalShadeArgs = z.object({
  source: z.enum(["lightness", "alpha"]).optional(),
  invert: z.boolean().optional(),
  azimuth_degrees: z.number().finite().optional(),
  elevation_degrees: z.number().finite().min(-89).max(89).optional(),
  depth: z.number().finite().min(0).max(32).optional(),
  ambient: z.number().min(0).max(1).optional(),
  strength: z.number().min(0).max(1).optional(),
}).strict();

const posterizeArgs = z.object({
  levels: z.number().int().min(2).max(32),
  strength: z.number().min(0).max(1).optional(),
}).strict();

const hueSelectionArgs = {
  source_hue_color: requiredHexColorSchema.optional(),
  hue_tolerance_degrees: z.number().finite().min(5).max(60).optional(),
  minimum_chroma: z.number().finite().min(0.015).max(0.3).optional(),
};

const gradientArgs = z.object({
  ramp: rampSchema,
  mode: gradientModeSchema.optional(),
  matrix: matrixSchema.optional(),
  ...hueSelectionArgs,
}).strict();

const generatedGradientArgs = z.object({
  base_color: requiredHexColorSchema,
  steps: z.number().int().min(2).max(16),
  shadow_lightness_delta: z.number().min(-1).max(0).optional(),
  highlight_lightness_delta: z.number().min(0).max(1).optional(),
  shadow_hue_shift: z.number().finite().min(-180).max(180).optional(),
  highlight_hue_shift: z.number().finite().min(-180).max(180).optional(),
  shadow_chroma_scale: z.number().finite().min(0).max(4).optional(),
  highlight_chroma_scale: z.number().finite().min(0).max(4).optional(),
  mode: gradientModeSchema.optional(),
  matrix: matrixSchema.optional(),
  ...hueSelectionArgs,
}).strict();

const palettizeArgs = z.object({
  palette: paletteSchema,
  dither: z.enum(["none", "ordered"]).optional(),
  matrix: matrixSchema.optional(),
}).strict();

const paletteDiffusionArgs = z.object({
  palette: paletteSchema,
  strength: z.number().min(0).max(1).optional(),
  serpentine: z.boolean().optional(),
}).strict();

export const textureComputeOperationNames = [
  "auto_levels",
  "directional_shade",
  "posterize",
  "gradient_map",
  "generated_gradient_map",
  "palettize",
  "palette_diffusion",
] as const;

export type TextureComputeOperationName =
  (typeof textureComputeOperationNames)[number];

type RawStep = {
  operation: TextureComputeOperationName;
  args?: Record<string, unknown>;
};

function gradientOptions(
  value: {
    mode?: GradientMapMode;
    matrix?: OrderedDitherMatrix;
    source_hue_color?: string;
    hue_tolerance_degrees?: number;
    minimum_chroma?: number;
  }
) {
  if (!value.source_hue_color &&
      (value.hue_tolerance_degrees !== undefined || value.minimum_chroma !== undefined)) {
    throw new Error("Hue-family tolerance/chroma requires source_hue_color.");
  }
  return {
    ...(value.mode === undefined ? {} : { mode: value.mode }),
    ...(value.matrix === undefined ? {} : { matrix: value.matrix }),
    ...(value.source_hue_color === undefined ? {} : { sourceHueColor: value.source_hue_color }),
    ...(value.hue_tolerance_degrees === undefined ? {} : { hueToleranceDegrees: value.hue_tolerance_degrees }),
    ...(value.minimum_chroma === undefined ? {} : { minimumChroma: value.minimum_chroma }),
  };
}

export function parseTextureComputeSteps(
  raw: readonly RawStep[]
): TextureComputeStep[] {
  if (raw.length < 1 || raw.length > 12) {
    throw new Error("Texture compute pipeline requires 1 to 12 steps.");
  }

  return raw.map((step, index): TextureComputeStep => {
    const args = step.args ?? {};
    const prefix = `compute[${index}] ${step.operation}`;

    try {
      switch (step.operation) {
        case "auto_levels": {
          const parsed = autoLevelsArgs.parse(args);
          return {
            operation: "auto_levels",
            options: {
              ...(parsed.low_clip_percent === undefined
                ? {}
                : { lowClipPercent: parsed.low_clip_percent }),
              ...(parsed.high_clip_percent === undefined
                ? {}
                : { highClipPercent: parsed.high_clip_percent }),
              ...(parsed.strength === undefined
                ? {}
                : { strength: parsed.strength }),
            },
          };
        }

        case "directional_shade": {
          const parsed = directionalShadeArgs.parse(args);
          return {
            operation: "directional_shade",
            options: {
              ...(parsed.source === undefined
                ? {}
                : { source: parsed.source }),
              ...(parsed.invert === undefined
                ? {}
                : { invert: parsed.invert }),
              ...(parsed.azimuth_degrees === undefined
                ? {}
                : { azimuthDegrees: parsed.azimuth_degrees }),
              ...(parsed.elevation_degrees === undefined
                ? {}
                : { elevationDegrees: parsed.elevation_degrees }),
              ...(parsed.depth === undefined
                ? {}
                : { depth: parsed.depth }),
              ...(parsed.ambient === undefined
                ? {}
                : { ambient: parsed.ambient }),
              ...(parsed.strength === undefined
                ? {}
                : { strength: parsed.strength }),
            },
          };
        }

        case "posterize": {
          const parsed = posterizeArgs.parse(args);
          return {
            operation: "posterize",
            options: {
              levels: parsed.levels,
              ...(parsed.strength === undefined
                ? {}
                : { strength: parsed.strength }),
            },
          };
        }

        case "gradient_map": {
          const parsed = gradientArgs.parse(args);
          return {
            operation: "gradient_map",
            ramp: parsed.ramp,
            options: gradientOptions(parsed),
          };
        }

        case "generated_gradient_map": {
          const parsed = generatedGradientArgs.parse(args);
          return {
            operation: "generated_gradient_map",
            base_color: parsed.base_color,
            ramp: {
              steps: parsed.steps,
              ...(parsed.shadow_lightness_delta === undefined
                ? {}
                : {
                    shadowLightnessDelta:
                      parsed.shadow_lightness_delta,
                  }),
              ...(parsed.highlight_lightness_delta === undefined
                ? {}
                : {
                    highlightLightnessDelta:
                      parsed.highlight_lightness_delta,
                  }),
              ...(parsed.shadow_hue_shift === undefined
                ? {}
                : { shadowHueShift: parsed.shadow_hue_shift }),
              ...(parsed.highlight_hue_shift === undefined
                ? {}
                : { highlightHueShift: parsed.highlight_hue_shift }),
              ...(parsed.shadow_chroma_scale === undefined
                ? {}
                : {
                    shadowChromaScale:
                      parsed.shadow_chroma_scale,
                  }),
              ...(parsed.highlight_chroma_scale === undefined
                ? {}
                : {
                    highlightChromaScale:
                      parsed.highlight_chroma_scale,
                  }),
            },
            options: gradientOptions(parsed),
          };
        }

        case "palettize": {
          const parsed = palettizeArgs.parse(args);
          return {
            operation: "palettize",
            palette: parsed.palette,
            options: {
              ...(parsed.dither === undefined
                ? {}
                : { dither: parsed.dither }),
              ...(parsed.matrix === undefined
                ? {}
                : { matrix: parsed.matrix }),
            },
          };
        }

        case "palette_diffusion": {
          const parsed = paletteDiffusionArgs.parse(args);
          return {
            operation: "palette_diffusion",
            palette: parsed.palette,
            options: {
              ...(parsed.strength === undefined
                ? {}
                : { strength: parsed.strength }),
              ...(parsed.serpentine === undefined
                ? {}
                : { serpentine: parsed.serpentine }),
            },
          };
        }
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : String(error);
      throw new Error(`${prefix} is invalid: ${reason}`);
    }
  });
}



export type ParsedTextureComputeRequest = {
  steps: TextureComputeStep[];
  target_rect: TextureComputeRect | null;
  face_targets: z.infer<typeof faceTargetSchema>[] | null;
};

/**
 * Request-local targeting inside compute[0].args, no public envelope change.
 * Native face_targets require verified material/UV ownership before mutation.
 */
export function parseTextureComputeRequest(
  raw: readonly RawStep[]
): ParsedTextureComputeRequest {
  let targetRect: TextureComputeRect | null = null;
  let faceTargets: z.infer<typeof faceTargetSchema>[] | null = null;
  const normalized = raw.map((step, index): RawStep => {
    const args = step.args ?? {};
    const hasRect = Object.prototype.hasOwnProperty.call(args, "target_rect");
    const hasFaces = Object.prototype.hasOwnProperty.call(args, "face_targets");
    if (!hasRect && !hasFaces) return step;
    if (index !== 0) {
      throw new Error("Texture compute target_rect/face_targets must be declared only on compute[0].args.");
    }
    if (hasRect && hasFaces) {
      throw new Error("Texture compute target_rect and face_targets are mutually exclusive.");
    }
    try {
      if (hasRect) targetRect = targetRectSchema.parse(args.target_rect);
      if (hasFaces) faceTargets = faceTargetsSchema.parse(args.face_targets);
    } catch (error) {
      throw new Error("compute[0] target_rect/face_targets is invalid: " +
        (error instanceof Error ? error.message : String(error)));
    }
    const operationArgs = { ...args };
    delete operationArgs.target_rect;
    delete operationArgs.face_targets;
    return { ...step, args: operationArgs };
  });
  const steps = parseTextureComputeSteps(normalized);
  const selectiveHue = steps.some((step) =>
    (step.operation === "gradient_map" || step.operation === "generated_gradient_map") &&
    step.options?.sourceHueColor !== undefined
  );
  if (faceTargets && (!selectiveHue || steps.length !== 1)) {
    throw new Error("Texture face_targets require one selective gradient step with source_hue_color.");
  }
  if (selectiveHue && ((!targetRect && !faceTargets) || steps.length !== 1)) {
    throw new Error(
      "Selective hue-family recoloring requires exactly one gradient step with an explicit target_rect or face_targets."
    );
  }
  return { steps, target_rect: targetRect, face_targets: faceTargets };
}
