import {
  normalizeTextureEvidenceRegion,
  textureEvidenceRegionToLogicalUv,
  textureRevisionSchema,
} from "@/lib/texture/evidence";
import {
  resolveTextureFrameLayout,
  textureFrameRect,
} from "@/lib/texture/frameMapping";

export type TextureEvidenceDeliveryInput = {
  inspection: "full_atlas" | "region";
  revision: string;
  bitmap: { width: number; height: number };
  region: { x: number; y: number; width: number; height: number };
  /** One native displayed frame; omit only for legacy static bitmap callers. */
  display_height?: number;
  source_byte_length: number;
  uv_width: number;
  uv_height: number;
};

/**
 * Machine-readable evidence metadata intentionally excludes raw RGBA. Runtime
 * wiring should encode only the requested crop as PNG and deliver it through one
 * MCP image content item while structuredContent carries this compact receipt.
 */
export function buildTextureEvidenceDeliveryMetadata(
  input: TextureEvidenceDeliveryInput
) {
  const revision = textureRevisionSchema.parse(input.revision);
  const region = normalizeTextureEvidenceRegion(
    input.region,
    input.bitmap.width,
    input.bitmap.height
  );
  const expectedBytes = region.width * region.height * 4;
  if (!Number.isSafeInteger(expectedBytes) ||
      input.source_byte_length !== expectedBytes) {
    throw new Error(
      "Texture evidence source byte length must match the exact cropped RGBA region."
    );
  }

  const frames = resolveTextureFrameLayout(
    input.bitmap.width,
    input.bitmap.height,
    input.display_height ?? input.bitmap.height,
    "Texture evidence"
  );
  const firstFrame = Math.floor(region.y / frames.display_height);
  const lastFrame = Math.floor(
    (region.y + region.height - 1) / frames.display_height
  );
  const oneFrame = firstFrame === lastFrame;
  // Crop coordinates in the request and PNG are absolute bitmap pixels.
  // Logical UV maps within a single frame, not across the vertical animation
  // strip. A spanning crop has no single meaningful UV rectangle.
  const frameLocalRegion = oneFrame
    ? { ...region, y: region.y - firstFrame * frames.display_height }
    : null;
  const logicalUv = frameLocalRegion
    ? textureEvidenceRegionToLogicalUv(
        frameLocalRegion,
        frames.bitmap_width,
        frames.display_height,
        input.uv_width,
        input.uv_height
      )
    : null;

  return {
    inspection: input.inspection,
    revision,
    bitmap: input.bitmap,
    region,
    logical_uv: logicalUv,
    ...(frames.frame_count > 1
      ? {
          // Identifies where the requested bitmap crop lies; this does not
          // claim the installed Blockbench Painter currently displays it.
          frame: {
            state: oneFrame ? ("single_frame" as const) : ("spans_frames" as const),
            frame_count: frames.frame_count,
            frame_index: oneFrame ? firstFrame : null,
            frame_range: [firstFrame, lastFrame] as [number, number],
            frame_bitmap_rect: oneFrame
              ? textureFrameRect(frames, firstFrame, "Texture evidence")
              : null,
            region_in_frame: frameLocalRegion,
            uv_coordinate_space: oneFrame
              ? ("frame_local" as const)
              : ("not_applicable" as const),
          },
        }
      : {}),
    image: {
      delivery: "content.image" as const,
      mime_type: "image/png" as const,
      width: region.width,
      height: region.height,
      source_byte_length: input.source_byte_length,
    },
  };
}
