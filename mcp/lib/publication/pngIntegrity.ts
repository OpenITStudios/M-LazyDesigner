/** Strict PNG publication output validation, not a perceptual image-quality score.
 * Check all chunks and CRCs before marking a filesystem render as delivered.
 * Blender worker requests RGBA, 8-bit PNG; never accept a header-only fake.
 */
const PNG_SIGNATURE = "89504e470d0a1a0a";
const MAX_PNG_BYTES = 96 * 1024 * 1024;
const MAX_PNG_CHUNK = 32 * 1024 * 1024;

export type PublicationPngIntegrity = Readonly<{
  width: number;
  height: number;
  idat_bytes: number;
  chunk_count: number;
  color_type: 6;
  bit_depth: 8;
}>;

function crc32(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i]!;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectPublicationPng(
  png: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): PublicationPngIntegrity {
  if (!Buffer.isBuffer(png) ||
      png.length < 57 || png.length > MAX_PNG_BYTES ||
      png.toString("hex", 0, 8) !== PNG_SIGNATURE ||
      !Number.isSafeInteger(expectedWidth) || !Number.isSafeInteger(expectedHeight) ||
      expectedWidth < 1 || expectedHeight < 1 ||
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
    if (type === "IDAT") {
      if (afterIDAT) throw new Error("PUBLICATION_OUTPUT_PNG_NONCONSECUTIVE_IDAT");
      inIDAT = true;
      idatBytes += length;
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
  return {
    width: expectedWidth,
    height: expectedHeight,
    idat_bytes: idatBytes,
    chunk_count: count + 1,
    color_type: 6,
    bit_depth: 8,
  };
}
