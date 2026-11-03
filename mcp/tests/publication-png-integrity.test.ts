import { describe, expect, test } from "bun:test";
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
