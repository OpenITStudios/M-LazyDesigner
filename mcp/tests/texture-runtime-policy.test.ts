import { describe, expect, test } from "bun:test";
import {
  bedrockGeometryIdentifierInputSchema,
  resolveBedrockProjectModelIdentifier,
} from "@/lib/bedrockProjectIdentity";
import {
  PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  requirePaintTransactionV1Target,
} from "@/lib/paintTransactionPolicy";
import { buildTextureEvidenceSnapshot } from "@/lib/textureEvidence";
import { buildTextureEvidenceDeliveryMetadata } from "@/lib/textureEvidenceDelivery";
import { planBedrockGeometryWrite } from "@/lib/bedrockExportIntegrity";
import { requireDirectBedrockGeometryWriteV1 } from "@/lib/bedrockExportWritePolicy";

describe("texture runtime wiring policy", () => {
  test("new Bedrock projects own deterministic native geometry identifiers", () => {
    expect(resolveBedrockProjectModelIdentifier("Small Cannon Boat")).toBe(
      "geometry.small_cannon_boat"
    );
    expect(resolveBedrockProjectModelIdentifier("ignored", "custom.boat")).toBe(
      "geometry.custom.boat"
    );
    expect(resolveBedrockProjectModelIdentifier("ignored", "Geometry.Custom_Boat")).toBe(
      "geometry.Custom_Boat"
    );
    expect(
      bedrockGeometryIdentifierInputSchema.safeParse("geometry.valid_model").success
    ).toBe(true);
    expect(
      bedrockGeometryIdentifierInputSchema.safeParse("geometry.bad-model").success
    ).toBe(false);
    expect(() => resolveBedrockProjectModelIdentifier("🚗🚗")).toThrow(
      "explicit model_identifier"
    );
  });

  test("exact paint transaction v1 has one domain-specific name and fails closed on layered textures", () => {
    expect(PAINT_TEXTURE_TRANSACTION_TOOL_NAME).toBe("paint_texture_transaction");
    expect(
      requirePaintTransactionV1Target({
        texture_uuid: "base-uuid",
        texture_name: "base",
        layers_enabled: false,
      }).texture_uuid
    ).toBe("base-uuid");
    expect(() =>
      requirePaintTransactionV1Target({
        texture_uuid: "layered-uuid",
        texture_name: "layered",
        layers_enabled: true,
      })
    ).toThrow("native Painter tools");
  });

  test("focused texture delivery keeps PNG image payload separate from compact metadata", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const snapshot = await buildTextureEvidenceSnapshot(pixels, 2, 2, {
      region: { x: 1, y: 0, width: 1, height: 2 },
    });
    const metadata = buildTextureEvidenceDeliveryMetadata({
      inspection: snapshot.inspection,
      revision: snapshot.revision,
      bitmap: snapshot.bitmap,
      region: snapshot.region,
      source_byte_length: snapshot.byte_length,
      uv_width: 128,
      uv_height: 128,
    });

    expect(metadata.logical_uv).toEqual([64, 0, 128, 128]);
    expect(metadata.image).toMatchObject({
      delivery: "content.image",
      mime_type: "image/png",
      width: 1,
      height: 2,
    });
    expect("rgba" in metadata).toBe(false);
    expect(JSON.stringify(metadata)).not.toContain("rgba");
  });


  test("focused animated PNG readback binds absolute bitmap region to one frame-local UV map", async () => {
    const pixels = new Uint8ClampedArray(2 * 6 * 4);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 2; x++) {
      pixels.set([10 * (Math.floor(y / 2) + 1) + x, y, 0, 255], (y * 2 + x) * 4);
    }
    const region = { x: 1, y: 2, width: 1, height: 2 };
    const cropped = await buildTextureEvidenceSnapshot(pixels, 2, 6, { region });
    const build = (snapshot: typeof cropped) => buildTextureEvidenceDeliveryMetadata({
      inspection: snapshot.inspection,
      revision: snapshot.revision,
      bitmap: snapshot.bitmap,
      region: snapshot.region,
      display_height: 2,
      source_byte_length: snapshot.byte_length,
      uv_width: 128,
      uv_height: 128,
    });
    const metadata = build(cropped);
    expect(Array.from(cropped.rgba)).toEqual([
      21, 2, 0, 255,
      21, 3, 0, 255,
    ]);
    expect(metadata).toMatchObject({
      inspection: "region",
      bitmap: { width: 2, height: 6 },
      region: { x: 1, y: 2, width: 1, height: 2 },
      logical_uv: [64, 0, 128, 128],
      frame: {
        state: "single_frame",
        frame_count: 3,
        frame_index: 1,
        frame_range: [1, 1],
        frame_bitmap_rect: [0, 2, 2, 4],
        region_in_frame: { x: 1, y: 0, width: 1, height: 2 },
        uv_coordinate_space: "frame_local",
      },
      image: { width: 1, height: 2, source_byte_length: 8 },
    });
    expect("rgba" in metadata).toBe(false);

    // Optimistic revision remains the full bitmap, not just this one frame.
    const changedFrameZero = pixels.slice();
    changedFrameZero[0] += 1;
    await expect(buildTextureEvidenceSnapshot(changedFrameZero, 2, 6, {
      region,
      expected_revision: cropped.revision,
    })).rejects.toThrow("Texture evidence source changed since");
  });

  test("cross-frame crops retain bitmap evidence without inventing one UV region", async () => {
    const pixels = new Uint8ClampedArray(2 * 6 * 4);
    const spanning = await buildTextureEvidenceSnapshot(pixels, 2, 6, {
      region: { x: 0, y: 3, width: 1, height: 2 },
    });
    const crossFrameMetadata = buildTextureEvidenceDeliveryMetadata({
      inspection: spanning.inspection,
      revision: spanning.revision,
      bitmap: spanning.bitmap,
      region: spanning.region,
      display_height: 2,
      source_byte_length: spanning.byte_length,
      uv_width: 128,
      uv_height: 128,
    });
    expect(crossFrameMetadata).toMatchObject({
      region: { x: 0, y: 3, width: 1, height: 2 },
      logical_uv: null,
      frame: {
        state: "spans_frames",
        frame_count: 3,
        frame_index: null,
        frame_range: [1, 2],
        frame_bitmap_rect: null,
        region_in_frame: null,
        uv_coordinate_space: "not_applicable",
      },
      image: { width: 1, height: 2 },
    });

    const all = await buildTextureEvidenceSnapshot(pixels, 2, 6);
    const full = buildTextureEvidenceDeliveryMetadata({
      inspection: all.inspection,
      revision: all.revision,
      bitmap: all.bitmap,
      region: all.region,
      display_height: 2,
      source_byte_length: all.byte_length,
      uv_width: 128,
      uv_height: 128,
    });
    expect(full.inspection).toBe("full_atlas");
    expect(full.logical_uv).toBeNull();
    expect(full.frame).toMatchObject({
      state: "spans_frames", frame_range: [0, 2], frame_count: 3,
    });

    expect(() => buildTextureEvidenceDeliveryMetadata({
      inspection: spanning.inspection,
      revision: spanning.revision,
      bitmap: spanning.bitmap,
      region: spanning.region,
      display_height: 4,
      source_byte_length: spanning.byte_length,
      uv_width: 128,
      uv_height: 128,
    })).toThrow("not an exact stack");
    expect(() => buildTextureEvidenceDeliveryMetadata({
      inspection: spanning.inspection,
      revision: spanning.revision,
      bitmap: spanning.bitmap,
      region: spanning.region,
      display_height: 2,
      source_byte_length: 3,
      uv_width: 128,
      uv_height: 128,
    })).toThrow("must match the exact cropped RGBA region");
    expect(() => buildTextureEvidenceDeliveryMetadata({
      inspection: spanning.inspection,
      revision: spanning.revision,
      bitmap: spanning.bitmap,
      region: { ...spanning.region, y: 6 },
      display_height: 2,
      source_byte_length: spanning.byte_length,
      uv_width: 128,
      uv_height: 128,
    })).toThrow("exceeds bitmap bounds");
  });

  test("focused get_texture passes displayed frame height to receipt metadata", async () => {
    const source = await Bun.file("server/runtime/contracts/texture.ts").text();
    const start = source.indexOf("const metadata = buildTextureEvidenceDeliveryMetadata({");
    const end = source.indexOf("const png = rgbaToPngDataUrl(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(source).toContain("display_height: texture.display_height");
    expect(source.slice(start, end)).toContain("display_height: sourceIdentity.display_height");
    expect(source.slice(end)).toContain("snapshot.rgba");
    expect(source.slice(end)).toContain("snapshot.region.width");
    expect(source.slice(end)).toContain("snapshot.region.height");
  });

  test("get_texture readback refuses bitmap changes in other animated frames and layout drift", async () => {
    const { requireUnchangedTextureBitmap } = await import("@/lib/textureBitmapRuntime");
    const { requireStableTextureEvidenceIdentity } =
      await import("@/lib/textureEvidenceDelivery");
    const first = {
      uuid: "animated", id: "animated", name: "animated",
      width: 2, height: 6, display_height: 2, uv_width: 128, uv_height: 128,
    };
    expect(() => requireStableTextureEvidenceIdentity(first, { ...first })).not.toThrow();
    for (const field of [
      "uuid", "id", "name", "width", "height", "display_height",
      "uv_width", "uv_height",
    ] as const) {
      const drift = { ...first, [field]: field === "id" || field === "name" ||
        field === "uuid" ? "changed" : first[field] + 1 };
      expect(() => requireStableTextureEvidenceIdentity(first, drift))
        .toThrow("get_texture texture identity or frame/UV layout changed");
    }

    const pixels = new Uint8ClampedArray(2 * 6 * 4);
    const captured = { pixels, width: 2, height: 6 };
    const later = { ...captured, pixels: pixels.slice() };
    later.pixels[0] = 255; // Frame zero changed; requested crop may be frame one.
    expect(() => requireUnchangedTextureBitmap(captured, later,
      "get_texture decoded bitmap changed during evidence readback"
    )).toThrow("get_texture decoded bitmap changed");
    expect(() => requireUnchangedTextureBitmap(captured,
      { ...captured, pixels: pixels.slice() },
      "get_texture decoded bitmap changed during evidence readback"
    )).not.toThrow();

    const source = await Bun.file("server/runtime/contracts/texture.ts").text();
    const start = source.indexOf("async function getFocusedTextureEvidence(");
    const end = source.indexOf("export function wireTextureRuntimeContracts", start);
    const block = source.slice(start, end);
    const capture = block.indexOf("const sourceIdentity = textureEvidenceSourceIdentity(texture)");
    const asyncDigest = block.indexOf("await buildTextureEvidenceSnapshot(");
    const identityGuard = block.indexOf("requireStableTextureEvidenceIdentity(");
    const bitmapGuard = block.indexOf("requireUnchangedTextureBitmap(");
    const metadata = block.indexOf("const metadata = buildTextureEvidenceDeliveryMetadata({");
    const png = block.indexOf("const png = rgbaToPngDataUrl(");
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(asyncDigest).toBeGreaterThan(capture);
    expect(identityGuard).toBeGreaterThan(asyncDigest);
    expect(bitmapGuard).toBeGreaterThan(identityGuard);
    expect(metadata).toBeGreaterThan(bitmapGuard);
    expect(png).toBeGreaterThan(metadata);
    expect(block).toContain("display_height: sourceIdentity.display_height");
    expect(block).toContain("texture: sourceIdentity");
  });

  test("Bedrock geometry v1 writes only new or explicitly owned single-geometry files", () => {
    expect(
      requireDirectBedrockGeometryWriteV1(
        planBedrockGeometryWrite({
          destination_exists: false,
          overwrite_requested: false,
          expected_identifier: "geometry.fixture",
        })
      ).action
    ).toBe("CREATE_NEW");

    const single = {
      "minecraft:geometry": [
        { description: { identifier: "geometry.fixture" }, bones: [] },
      ],
    };
    expect(
      requireDirectBedrockGeometryWriteV1(
        planBedrockGeometryWrite({
          destination_exists: true,
          overwrite_requested: true,
          existing_document: single,
          expected_identifier: "geometry.fixture",
        })
      ).action
    ).toBe("REPLACE_SINGLE");

    const multi = {
      "minecraft:geometry": [
        { description: { identifier: "geometry.fixture" }, bones: [] },
        { description: { identifier: "geometry.other" }, bones: [] },
      ],
    };
    expect(() =>
      requireDirectBedrockGeometryWriteV1(
        planBedrockGeometryWrite({
          destination_exists: true,
          overwrite_requested: true,
          existing_document: multi,
          expected_identifier: "geometry.fixture",
        })
      )
    ).toThrow("refuses direct writes to multi-geometry files");
  });
});
