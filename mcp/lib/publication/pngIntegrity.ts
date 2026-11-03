import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

/** Strict PNG publication output validation, not a perceptual image-quality score.
 * Check the complete RGBA8 PNG container and bounded decompressed scanlines
 * before marking a filesystem render as delivered. This does not compare
 * pixels to the authored source or certify artistic quality.
 */
const PNG_SIGNATURE = "89504e470d0a1a0a";
const MAX_PNG_BYTES = 96 * 1024 * 1024;
const MAX_PNG_CHUNK = 32 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 12_000_000;

export type PublicationPngIntegrity = Readonly<{
  width: number;
  height: number;
  idat_bytes: number;
  chunk_count: number;
  color_type: 6;
  bit_depth: 8;
}>;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Accept only a full, bounded, PNG-filtered RGBA8 image data stream. */
function verifyIdatScanlines(
  chunks: readonly Buffer[],
  width: number,
  height: number,
  expectedRgbaSha256?: string,
): void {
  // RGBA8/zero-interlace has one filter byte plus four bytes per pixel/row.
  // The output bound prevents small PNG containers from inflating indefinitely.
  const stride = width * 4 + 1;
  const expectedBytes = stride * height;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(chunks), {
      maxOutputLength: expectedBytes + 1,
    });
  } catch {
    throw new Error("PUBLICATION_OUTPUT_PNG_PAYLOAD_INVALID");
  }
  if (inflated.length !== expectedBytes) {
    throw new Error("PUBLICATION_OUTPUT_PNG_DECOMPRESSED_SIZE_INVALID");
  }
  const sha = expectedRgbaSha256 === undefined ? null : createHash("sha256");
  const rowSize = width * 4;
  let previous = sha ? Buffer.alloc(rowSize) : null;
  let decoded = sha ? Buffer.allocUnsafe(rowSize) : null;
  for (let row = 0; row < height; row++) {
    const start = row * stride;
    const filter = inflated[start]!;
    if (filter > 4) {
      throw new Error("PUBLICATION_OUTPUT_PNG_FILTER_INVALID");
    }
    if (!sha || !previous || !decoded) continue;
    for (let i = 0; i < rowSize; i++) {
      const left = i < 4 ? 0 : decoded[i - 4]!;
      const above = previous[i]!;
      const upperLeft = i < 4 ? 0 : previous[i - 4]!;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const dl = Math.abs(estimate - left);
        const da = Math.abs(estimate - above);
        const dc = Math.abs(estimate - upperLeft);
        predictor = dl <= da && dl <= dc ? left : da <= dc ? above : upperLeft;
      }
      decoded[i] = (inflated[start + 1 + i]! + predictor) & 0xff;
    }
    sha.update(decoded);
    const prior = previous;
    previous = decoded;
    decoded = prior;
  }
  if (sha && sha.digest("hex") !== expectedRgbaSha256) {
    throw new Error("PUBLICATION_OUTPUT_PNG_SOURCE_PIXELS_MISMATCH");
  }
}

export function inspectPublicationPng(
  png: Buffer,
  expectedWidth: number,
  expectedHeight: number,
  expectedRgbaSha256?: string,
): PublicationPngIntegrity {
  if (expectedRgbaSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(expectedRgbaSha256)) {
    throw new Error("PUBLICATION_OUTPUT_PNG_SOURCE_DIGEST_INVALID");
  }
  if (!Buffer.isBuffer(png) ||
      png.length < 57 || png.length > MAX_PNG_BYTES ||
      png.toString("hex", 0, 8) !== PNG_SIGNATURE ||
      !Number.isSafeInteger(expectedWidth) || !Number.isSafeInteger(expectedHeight) ||
      expectedWidth < 1 || expectedHeight < 1 ||
      expectedWidth > 8192 || expectedHeight > 8192 ||
      expectedWidth * expectedHeight > MAX_OUTPUT_PIXELS ||
      png.readUInt32BE(16) !== expectedWidth ||
      png.readUInt32BE(20) !== expectedHeight) {
    throw new Error("PUBLICATION_OUTPUT_PNG_HEADER_INVALID");
  }
  let at = 8;
  let count = 0;
  let idatBytes = 0;
  let seenIHDR = false;
  let seenIEND = false;
  let inIDAT = false;
  let afterIDAT = false;
  const idatChunks: Buffer[] = [];
  while (at < png.length) {
    if (png.length - at < 12) throw new Error("PUBLICATION_OUTPUT_PNG_CHUNK_TRUNCATED");
    const length = png.readUInt32BE(at);
    if (length > MAX_PNG_CHUNK || length > png.length - at - 12) {
      throw new Error("PUBLICATION_OUTPUT_PNG_CHUNK_LENGTH_INVALID");
    }
    const type = png.toString("ascii", at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error("PUBLICATION_OUTPUT_PNG_CHUNK_TYPE_INVALID");
    const bodyStart = at + 8;
    const end = bodyStart + length;
    if (crc32(png, at + 4, end) !== png.readUInt32BE(end)) {
      throw new Error("PUBLICATION_OUTPUT_PNG_CRC_MISMATCH");
    }
    if (count === 0) {
      if (type !== "IHDR" || length !== 13 || seenIHDR ||
          png[bodyStart + 8] !== 8 || png[bodyStart + 9] !== 6 ||
          png[bodyStart + 10] !== 0 || png[bodyStart + 11] !== 0 ||
          png[bodyStart + 12] !== 0) {
        throw new Error("PUBLICATION_OUTPUT_PNG_RGBA8_REQUIRED");
      }
      seenIHDR = true;
    } else if (type === "IHDR") {
      throw new Error("PUBLICATION_OUTPUT_PNG_MULTIPLE_IHDR");
    }
    if (type === "PLTE" && (inIDAT || afterIDAT)) {
      throw new Error("PUBLICATION_OUTPUT_PNG_CHUNK_ORDER_INVALID");
    }
    if (!(type === "IHDR" || type === "PLTE" || type === "IDAT" ||
          type === "IEND") && type[0] === type[0]!.toUpperCase()) {
      throw new Error("PUBLICATION_OUTPUT_PNG_UNKNOWN_CRITICAL_CHUNK");
    }
    if (type === "IDAT") {
      if (afterIDAT) throw new Error("PUBLICATION_OUTPUT_PNG_NONCONSECUTIVE_IDAT");
      inIDAT = true;
      idatBytes += length;
      idatChunks.push(png.subarray(bodyStart, end));
    } else if (inIDAT) {
      inIDAT = false;
      afterIDAT = true;
    }
    if (type === "IEND") {
      if (length !== 0 || !seenIHDR || idatBytes === 0 || end + 4 !== png.length) {
        throw new Error("PUBLICATION_OUTPUT_PNG_IEND_INVALID");
      }
      seenIEND = true;
      break;
    }
    at = end + 4;
    count++;
    if (count > 16_384) throw new Error("PUBLICATION_OUTPUT_PNG_TOO_MANY_CHUNKS");
  }
  if (!seenIEND) throw new Error("PUBLICATION_OUTPUT_PNG_MISSING_IEND");
  verifyIdatScanlines(idatChunks, expectedWidth, expectedHeight, expectedRgbaSha256);
  return {
    width: expectedWidth,
    height: expectedHeight,
    idat_bytes: idatBytes,
    chunk_count: count + 1,
    color_type: 6,
    bit_depth: 8,
  };
}
