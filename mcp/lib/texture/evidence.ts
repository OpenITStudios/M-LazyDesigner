import { z } from "zod";
import { analyzeTextureColorProfile } from "@/lib/texture/colorProfile";
import { analyzeTexturePixelCraft } from "@/lib/texture/pixelCraft";
import { textureIdOptionalSchema } from "@/lib/zodObjects";
import { ENTITY_RENDER_PROFILE_NAMES } from "@/lib/texture/renderProfile";
import {
  computeTextureRevision,
  requireTextureRevisionDimensions,
  requireTextureRevisionMatch,
} from "@/lib/texture/revision";

export const textureRevisionSchema = z
  .string()
  .regex(/^sha256:\d+x\d+:[0-9a-f]{64}$/)
  .describe("Full decoded-RGBA texture revision returned by LazyDesigner.");

export const textureEvidenceRegionSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()
  .describe("Bounded bitmap-pixel region [x,y,width,height].");

export const textureEvidenceOptionsSchema = z
  .object({
    region: textureEvidenceRegionSchema.optional(),
    expected_revision: textureRevisionSchema.optional(),
  })
  .strict();

/**
 * Public focused-evidence contract used by the runtime get_texture adapter.
 * It supports bounded PNG evidence plus optional optimistic revision checking
 * without placing raw RGBA in structuredContent. Render semantics are opt-in:
 * normal texture reads do not perform a second alpha-analysis scan.
 *
 * This remains a plain ZodObject because runtime wiring intentionally reuses
 * its `.shape`; cross-field render semantics are validated by the alpha wrapper.
 */
export const focusedGetTextureParameters = z
  .object({
    texture: textureIdOptionalSchema,
    region: textureEvidenceRegionSchema.optional(),
    expected_revision: textureRevisionSchema.optional(),
    render_profile: z
      .enum(ENTITY_RENDER_PROFILE_NAMES)
      .optional()
      .describe(
        "Optional Vanilla render intent for interpreting alpha in this evidence region. Use minecraft_material_code instead for custom materials."
      ),
    minecraft_material_code: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional literal Minecraft entity material code for render-aware alpha interpretation."
      ),
  })
  .strict();

export type TextureEvidenceRegion = z.infer<typeof textureEvidenceRegionSchema>;
export type TextureEvidenceOptions = z.infer<typeof textureEvidenceOptionsSchema>;

function requireTextureRgbaLength(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): void {
  const expected = width * height * 4;
  if (!Number.isSafeInteger(expected) || pixels.byteLength !== expected) {
    throw new Error(
      `Texture evidence RGBA length mismatch: expected ${expected} bytes for ${width}x${height}, received ${pixels.byteLength}.`
    );
  }
}

export function normalizeTextureEvidenceRegion(
  region: TextureEvidenceRegion | undefined,
  width: number,
  height: number
): TextureEvidenceRegion {
  const [validatedWidth, validatedHeight] = requireTextureRevisionDimensions(
    width,
    height
  );
  if (!region) {
    return { x: 0, y: 0, width: validatedWidth, height: validatedHeight };
  }

  const parsed = textureEvidenceRegionSchema.parse(region);
  const right = parsed.x + parsed.width;
  const bottom = parsed.y + parsed.height;
  if (
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(bottom) ||
    right > validatedWidth ||
    bottom > validatedHeight
  ) {
    throw new Error(
      `Texture evidence region [${parsed.x},${parsed.y},${parsed.width},${parsed.height}] exceeds bitmap bounds ${validatedWidth}x${validatedHeight}.`
    );
  }
  return parsed;
}

export function textureEvidenceRegionToLogicalUv(
  region: TextureEvidenceRegion,
  bitmapWidth: number,
  bitmapHeight: number,
  uvWidth: number,
  uvHeight: number
): [number, number, number, number] {
  const normalized = normalizeTextureEvidenceRegion(
    region,
    bitmapWidth,
    bitmapHeight
  );
  const [validatedUvWidth, validatedUvHeight] = requireTextureRevisionDimensions(
    uvWidth,
    uvHeight
  );
  return [
    (normalized.x / bitmapWidth) * validatedUvWidth,
    (normalized.y / bitmapHeight) * validatedUvHeight,
    ((normalized.x + normalized.width) / bitmapWidth) * validatedUvWidth,
    ((normalized.y + normalized.height) / bitmapHeight) * validatedUvHeight,
  ];
}

export function cropTextureRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  region?: TextureEvidenceRegion
): Uint8ClampedArray {
  const normalized = normalizeTextureEvidenceRegion(region, width, height);
  requireTextureRgbaLength(pixels, width, height);

  const cropped = new Uint8ClampedArray(normalized.width * normalized.height * 4);
  for (let row = 0; row < normalized.height; row += 1) {
    const sourceStart = ((normalized.y + row) * width + normalized.x) * 4;
    const sourceEnd = sourceStart + normalized.width * 4;
    const targetStart = row * normalized.width * 4;
    cropped.set(pixels.subarray(sourceStart, sourceEnd), targetStart);
  }
  return cropped;
}

export async function buildTextureEvidenceSnapshot(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: TextureEvidenceOptions = {}
) {
  const parsed = textureEvidenceOptionsSchema.parse(options);
  const region = normalizeTextureEvidenceRegion(parsed.region, width, height);
  requireTextureRgbaLength(pixels, width, height);

  const revision = await computeTextureRevision(pixels, width, height);
  requireTextureRevisionMatch(
    parsed.expected_revision,
    revision,
    "Texture evidence source"
  );

  const rgba = cropTextureRgba(pixels, width, height, region);
  const full =
    region.x === 0 &&
    region.y === 0 &&
    region.width === width &&
    region.height === height;

  return {
    inspection: full ? ("full_atlas" as const) : ("region" as const),
    revision,
    bitmap: { width, height },
    region,
    byte_length: rgba.byteLength,
    rgba,
  };
}


/**
 * Read-only palette/cluster diagnostics from the SAME verified decoded-RGBA
 * crop that supplies get_texture's PNG. The full-atlas revision is passed
 * through unchanged; neither output compares source art or grants visual PASS.
 */
export function buildTextureCraftEvidence(
  snapshot: Pick<Awaited<ReturnType<typeof buildTextureEvidenceSnapshot>>,
    "revision" | "region" | "rgba">
) {
  const revision = textureRevisionSchema.parse(snapshot.revision);
  const region = textureEvidenceRegionSchema.parse(snapshot.region);
  if (snapshot.rgba.byteLength !== region.width * region.height * 4) {
    throw new Error("TEXTURE_CRAFT_SNAPSHOT_REGION_MISMATCH");
  }
  const provenance = {
    evidence_revision: revision,
    source_region: { ...region },
    evidence_scope: "REQUESTED_PNG_REGION" as const,
  };
  return {
    color_profile: {
      ...analyzeTextureColorProfile(snapshot.rgba, region.width, region.height),
      ...provenance,
    },
    pixel_craft: {
      ...analyzeTexturePixelCraft(snapshot.rgba, region.width, region.height),
      ...provenance,
    },
  };
}
