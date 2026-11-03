import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { inspectPublicationPng } from "@/lib/publication/pngIntegrity";

/** True RGBA8 1x1 PNG generated from an opaque pixel, not a fake header. */
const RGBA8_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP40KPxHwAGuAKk08HVuAAAAABJRU5ErkJggg==",
  "base64",
);

describe("Publication PNG integrity", () => {
  test("accepts a complete RGBA8 PNG with valid CRC and terminal IEND", () => {
    const result = inspectPublicationPng(RGBA8_PNG, 1, 1);
    expect(result).toMatchObject({
      width: 1, height: 1, color_type: 6, bit_depth: 8,
      chunk_count: 3, idat_bytes: 13,
    });
  });
  test("rejects header-only, truncated, corrupted and trailing data", () => {
    expect(() => inspectPublicationPng(RGBA8_PNG.subarray(0, 24), 1, 1))
      .toThrow("PNG_HEADER_INVALID");
    expect(() => inspectPublicationPng(RGBA8_PNG.subarray(0, RGBA8_PNG.length - 8), 1, 1))
      .toThrow();
    const badCrc = Buffer.from(RGBA8_PNG);
    badCrc[45] = badCrc[45]! ^ 1;
    expect(() => inspectPublicationPng(badCrc, 1, 1))
      .toThrow("CRC_MISMATCH");
    expect(() => inspectPublicationPng(Buffer.concat([RGBA8_PNG, Buffer.alloc(2)]), 1, 1))
      .toThrow("IEND_INVALID");
    expect(() => inspectPublicationPng(RGBA8_PNG, 2, 1))
      .toThrow("PNG_HEADER_INVALID");
  });
  test("rejects non-RGBA8 pixel formats and invalid chunk boundaries", () => {
    const changedColorMode = Buffer.from(RGBA8_PNG);
    changedColorMode[25] = 2; // PNG IHDR color-type RGB, intentionally invalid.
    expect(() => inspectPublicationPng(changedColorMode, 1, 1)).toThrow();
    const brokenLength = Buffer.from(RGBA8_PNG);
    brokenLength.writeUInt32BE(0xffffffff, 8);
    expect(() => inspectPublicationPng(brokenLength, 1, 1))
      .toThrow("CHUNK_LENGTH_INVALID");
  });
});

/** Constructs valid-CRC RGBA8 fixtures so decoded-payload checks cannot be
 * bypassed by superficially valid PNG headers/chunks. */
function fixtureCrc(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fixtureChunk(type: string, payload: Buffer): Buffer {
  const bytes = Buffer.alloc(12 + payload.length);
  bytes.writeUInt32BE(payload.length, 0);
  bytes.write(type, 4, "ascii");
  payload.copy(bytes, 8);
  bytes.writeUInt32BE(fixtureCrc(bytes.subarray(4, 8 + payload.length)), 8 + payload.length);
  return bytes;
}

function fixtureRgbaPng(
  scanline: Buffer,
  options: { splitIdat?: boolean; compressed?: Buffer; critical?: boolean } = {},
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const compressed = options.compressed ?? deflateSync(scanline);
  const chunks = options.splitIdat
    ? [fixtureChunk("IDAT", compressed.subarray(0, 3)),
       fixtureChunk("IDAT", compressed.subarray(3))]
    : [fixtureChunk("IDAT", compressed)];
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    fixtureChunk("IHDR", header),
    ...(options.critical ? [fixtureChunk("ABCD", Buffer.alloc(0))] : []),
    ...chunks,
    fixtureChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("Publication PNG decoded-payload contract", () => {
  test("accepts valid PNG scanline filter modes and split IDAT chunks", () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const png = fixtureRgbaPng(Buffer.from([filter, 9, 12, 24, 255]), {
        splitIdat: true,
      });
      expect(inspectPublicationPng(png, 1, 1)).toMatchObject({
        width: 1, height: 1, chunk_count: 4,
      });
    }
  });
  test("rejects valid-CRC PNGs with broken deflate, short pixels or invalid filters", () => {
    const valid = Buffer.from([0, 9, 12, 24, 255]);
    expect(() => inspectPublicationPng(fixtureRgbaPng(valid, {
      compressed: Buffer.from([1, 2, 3, 4]),
    }), 1, 1)).toThrow("PNG_PAYLOAD_INVALID");
    expect(() => inspectPublicationPng(
      fixtureRgbaPng(Buffer.from([0, 9, 12, 24])), 1, 1,
    )).toThrow("PNG_DECOMPRESSED_SIZE_INVALID");
    expect(() => inspectPublicationPng(
      fixtureRgbaPng(Buffer.from([5, 9, 12, 24, 255])), 1, 1,
    )).toThrow("PNG_FILTER_INVALID");
  });
  test("bounds decompression and rejects unknown critical chunks", () => {
    expect(() => inspectPublicationPng(
      fixtureRgbaPng(Buffer.alloc(65_536)), 1, 1,
    )).toThrow("PNG_PAYLOAD_INVALID");
    expect(() => inspectPublicationPng(
      fixtureRgbaPng(Buffer.from([0, 1, 2, 3, 255]), { critical: true }), 1, 1,
    )).toThrow("PNG_UNKNOWN_CRITICAL_CHUNK");
  });
});
