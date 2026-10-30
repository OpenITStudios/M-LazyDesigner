import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { summarizeReferenceAlphaSilhouette } from "@/gateway/control/referenceImageEvidence";
import {
  compareBoundPngAlphaEvidence,
  decodeVerifiedPngRgba,
  extractVerifiedPngAlpha,
} from "@/lib/reference/pngAlphaEvidence";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const title = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([title, data])));
  return Buffer.concat([size, title, data, checksum]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

function pngFromAlpha(
  rows: readonly string[],
  filters: readonly number[] = rows.map(() => 0),
  splitIdat = false,
  colorType = 6
): Buffer {
  const width = rows[0]!.length;
  const height = rows.length;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const rgba = Buffer.alloc(width * height * 4);
  [...rows.join("")].forEach((digit, i) => { rgba[i * 4 + 3] = digit === "1" ? 255 : 0; });
  const encodedRows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * width * 4, (y + 1) * width * 4);
    const filter = filters[y]!;
    const scan = Buffer.alloc(row.length + 1);
    scan[0] = filter;
    for (let i = 0; i < row.length; i++) {
      const left = i >= 4 ? row[i - 4]! : 0;
      const upper = y > 0 ? rgba[(y - 1) * width * 4 + i]! : 0;
      const upperLeft = y > 0 && i >= 4 ? rgba[(y - 1) * width * 4 + i - 4]! : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left :
        filter === 2 ? upper : filter === 3 ? Math.floor((left + upper) / 2) :
        paeth(left, upper, upperLeft);
      scan[i + 1] = (row[i]! - prediction + 256) & 255;
    }
    encodedRows.push(scan);
  }
  const compressed = deflateSync(Buffer.concat(encodedRows));
  const idats = splitIdat
    ? [chunk("IDAT", compressed.subarray(0, 2)), chunk("IDAT", compressed.subarray(2))]
    : [chunk("IDAT", compressed)];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), ...idats, chunk("IEND", Buffer.alloc(0)),
  ]);
}

function digest(png: Uint8Array): string {
  return createHash("sha256").update(png).digest("hex");
}

function extract(png: Uint8Array, expected_sha256 = digest(png)) {
  return extractVerifiedPngAlpha({
    png_bytes: png, expected_sha256, view: "front", provenance: "APPROVED_ALPHA",
  });
}

describe("verified PNG alpha for reference silhouette", () => {
  test("on-demand Control image projection summarizes actual approved alpha without raw pixels", () => {
    const png = pngFromAlpha(["01", "10"]);
    const summary = summarizeReferenceAlphaSilhouette({
      id: "IMG_FRONT",
      status: "APPROVED",
      view: "front",
      landmarks: [],
      regions: [],
      sha256: digest(png),
      mime_type: "image/png",
      bytes: png.length,
      data: png.toString("base64"),
    });
    expect(summary).toMatchObject({
      state: "AVAILABLE",
      foreground_pixels: 2,
      frame: { width: 2, height: 2 },
      visual_verdict: "NOT_EVALUATED",
      model_comparison_performed: false,
    });
    expect(JSON.stringify(summary)).not.toContain('"pixels":[');
  });

  test("verified RGBA sampling shares the strict PNG parser, including fully opaque pixels", () => {
    for (let filter = 0; filter <= 4; filter++) {
      const png = pngFromAlpha(["11", "10"], [filter, filter], true);
      const decoded = decodeVerifiedPngRgba({
        png_bytes: png, expected_sha256: digest(png),
      });
      expect(decoded.state).toBe("AVAILABLE");
      if (decoded.state !== "AVAILABLE") throw new Error("Expected verified PNG pixels");
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(2);
      expect([decoded.rgba[3], decoded.rgba[7], decoded.rgba[11], decoded.rgba[15]])
        .toEqual([255, 255, 255, 0]);
    }
    const opaque = pngFromAlpha(["11", "11"]);
    const data = decodeVerifiedPngRgba({
      png_bytes: opaque, expected_sha256: digest(opaque),
    });
    expect(data.state).toBe("AVAILABLE");
    // A wholly opaque PNG has color data even when it has no alpha silhouette.
    expect(extract(opaque).reason).toBe("OPAQUE_OR_EMPTY_ALPHA_MASK");
    expect(decodeVerifiedPngRgba({
      png_bytes: opaque, expected_sha256: "f".repeat(64),
    }).reason).toBe("PNG_IMAGE_IDENTITY_MISMATCH");
    const bad = Buffer.from(opaque);
    bad[40] ^= 1;
    expect(decodeVerifiedPngRgba({
      png_bytes: bad, expected_sha256: digest(bad),
    }).reason).toBe("PNG_CHUNK_CHECKSUM_INVALID");
  });

  test("supports every PNG filter and split IDAT without inventing segmentation", () => {
    const expected = [0, 1, 1, 0, 1, 0, 0, 1];
    for (let filter = 0; filter <= 4; filter++) {
      const png = pngFromAlpha(["0110", "1001"], [filter, filter], true);
      const result = extract(png);
      expect(result.state).toBe("AVAILABLE");
      expect(result.mask?.pixels).toEqual(Uint8Array.from(expected));
      expect(result.sha256).toBe(digest(png));
    }
  });

  test("rejects changed bytes, corrupt CRC, missing end and opaque background", () => {
    const png = pngFromAlpha(["01", "10"]);
    expect(extract(png, "f".repeat(64)).reason).toBe("PNG_IMAGE_IDENTITY_MISMATCH");
    const tampered = Buffer.from(png);
    tampered[40] ^= 1;
    expect(extract(tampered).reason).toBe("PNG_CHUNK_CHECKSUM_INVALID");
    expect(extract(png.subarray(0, png.length - 12)).reason).toBe("PNG_INCOMPLETE");
    expect(extract(pngFromAlpha(["11", "11"])).reason).toBe("OPAQUE_OR_EMPTY_ALPHA_MASK");
    expect(extract(pngFromAlpha(["00", "00"])).reason).toBe("OPAQUE_OR_EMPTY_ALPHA_MASK");
  });

  test("rejects unsupported layout, inflated dimensions and non-image payload", () => {
    expect(extract(pngFromAlpha(["01", "10"], [0, 0], false, 2)).reason)
      .toBe("PNG_LAYOUT_UNSUPPORTED");
    expect(extract(Buffer.from("not png")).reason).toBe("PNG_INVALID_OR_OVERSIZE");
    const png = pngFromAlpha(["01", "10"]);
    const huge = Buffer.from(png);
    huge.writeUInt32BE(1_000_000, 16);
    huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    expect(extract(huge).reason).toBe("PNG_IMAGE_DIMENSIONS_UNSUPPORTED");
  });

  test("binds source and captured PNG bytes to diagnostic comparison only", () => {
    const reference = pngFromAlpha(["00000", "01110", "01010", "01110", "00000"]);
    const model = pngFromAlpha(["00000", "00100", "01110", "00100", "00000"]);
    const request = {
      reference: {
        id: "IMG_FRONT", sha256: digest(reference), integrity: "VERIFIED" as const,
        status: "APPROVED", view: "front" as const, mime_type: "image/png",
      },
      capture: {
        project_uuid: "project-a", evidence_handle: "modelcapture:" + "c".repeat(64),
        view: "front" as const, image_sha256: digest(model), width: 5, height: 5,
      },
      reference_png: reference, capture_png: model,
      pairing: "REVIEWED_SAME_FRAME" as const,
    };
    const result = compareBoundPngAlphaEvidence(request);
    expect(result.state).toBe("DIAGNOSTIC_ONLY");
    expect(result.metrics?.iou).toBeCloseTo(4 / 9, 4);
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
    expect(compareBoundPngAlphaEvidence({ ...request, pairing: "UNVERIFIED" }).reason)
      .toBe("CAMERA_AND_FRAMING_PAIRING_UNVERIFIED");
    expect(compareBoundPngAlphaEvidence({ ...request, capture: {
      ...request.capture, image_sha256: "a".repeat(64),
    } }).reason).toBe("MODEL_PNG_IMAGE_IDENTITY_MISMATCH");
    expect(compareBoundPngAlphaEvidence({ ...request, reference: {
      ...request.reference, view: null,
    } }).reason).toBe("REFERENCE_VIEW_UNAVAILABLE");
  });
});
