import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { deriveAlphaSilhouetteMask, compareBoundSilhouetteEvidence, type SilhouetteMask } from "./silhouetteEvidence";
import type { ModelView } from "./visualEvidence";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 1024 * 1024;

type Provenance = "APPROVED_ALPHA" | "OFFSCREEN_RENDER_ALPHA";
export type PngAlphaEvidenceInput = {
  png_bytes: Uint8Array;
  expected_sha256: string;
  view: ModelView;
  provenance: Provenance;
};
export type PngAlphaEvidence =
  | { state: "AVAILABLE"; sha256: string; mask: SilhouetteMask; reason: null }
  | { state: "UNVERIFIED"; reason: string; sha256: string | null; mask: null };

/** Bounded verified source pixels; only for read-only, explicitly scoped inspection. */
export type VerifiedPngRgbaEvidence =
  | { state: "AVAILABLE"; sha256: string; width: number; height: number;
      rgba: Uint8Array; reason: null }
  | { state: "UNVERIFIED"; reason: string; sha256: string | null;
      width: null; height: null; rgba: null };

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

/**
 * Decode only bounded, non-interlaced 8-bit RGBA PNGs with fully checked chunks.
 * Unsupported PNG layouts fail closed. This does not infer a subject mask from
 * an opaque photographic background and does not attest camera alignment.
 */
export function decodeVerifiedPngRgba(
  input: Pick<PngAlphaEvidenceInput, "png_bytes" | "expected_sha256">
): VerifiedPngRgbaEvidence {
  const unavailable = (reason: string, sha256: string | null = null): VerifiedPngRgbaEvidence =>
    ({ state: "UNVERIFIED", reason, sha256, width: null, height: null, rgba: null });
  if (!SHA256_HEX.test(input.expected_sha256)) return unavailable("EXPECTED_IMAGE_ID_INVALID");
  const png = Buffer.from(input.png_bytes);
  if (png.length > MAX_PNG_BYTES || png.length < 45 ||
      !png.subarray(0, 8).equals(PNG_SIGNATURE)) return unavailable("PNG_INVALID_OR_OVERSIZE");
  const sha256 = createHash("sha256").update(png).digest("hex");
  if (sha256 !== input.expected_sha256) return unavailable("PNG_IMAGE_IDENTITY_MISMATCH", sha256);

  let offset = 8;
  let width = 0, height = 0, rowBytes = 0;
  let sawHeader = false, sawData = false, sawEnd = false, dataSequenceEnded = false;
  const compressed: Buffer[] = [];
  while (offset < png.length) {
    if (png.length - offset < 12) return unavailable("PNG_CHUNK_TRUNCATED", sha256);
    const length = png.readUInt32BE(offset);
    if (length > png.length - offset - 12) return unavailable("PNG_CHUNK_TRUNCATED", sha256);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) return unavailable("PNG_CHUNK_TYPE_INVALID", sha256);
    const contentStart = offset + 8;
    const contentEnd = contentStart + length;
    const expectedCrc = png.readUInt32BE(contentEnd);
    if (checksum(png.subarray(offset + 4, contentEnd)) !== expectedCrc)
      return unavailable("PNG_CHUNK_CHECKSUM_INVALID", sha256);
    if (!sawHeader && type !== "IHDR") return unavailable("PNG_HEADER_REQUIRED", sha256);
    if (type === "IHDR") {
      if (sawHeader || length !== 13) return unavailable("PNG_HEADER_INVALID", sha256);
      width = png.readUInt32BE(contentStart);
      height = png.readUInt32BE(contentStart + 4);
      if (!width || !height || width * height > MAX_PIXELS)
        return unavailable("PNG_IMAGE_DIMENSIONS_UNSUPPORTED", sha256);
      const bitDepth = png[contentStart + 8];
      const colorType = png[contentStart + 9];
      const compression = png[contentStart + 10];
      const filter = png[contentStart + 11];
      const interlace = png[contentStart + 12];
      if (bitDepth !== 8 || colorType !== 6 || compression !== 0 ||
          filter !== 0 || interlace !== 0)
        return unavailable("PNG_LAYOUT_UNSUPPORTED", sha256);
      rowBytes = width * 4;
      sawHeader = true;
    } else if (type === "IDAT") {
      if (sawEnd || dataSequenceEnded) return unavailable("PNG_CHUNK_ORDER_INVALID", sha256);
      sawData = true;
      compressed.push(png.subarray(contentStart, contentEnd));
    } else if (type === "IEND") {
      if (length !== 0 || !sawData || sawEnd || contentEnd + 4 !== png.length)
        return unavailable("PNG_CHUNK_ORDER_INVALID", sha256);
      sawEnd = true;
    } else if (/^[A-Z]/.test(type)) {
      return unavailable("PNG_CRITICAL_CHUNK_UNSUPPORTED", sha256);
    }
    if (sawData && type !== "IDAT") dataSequenceEnded = true;
    offset = contentEnd + 4;
    if (sawEnd) break;
  }
  if (!sawEnd || !sawData) return unavailable("PNG_INCOMPLETE", sha256);

  const expectedRawBytes = height * (rowBytes + 1);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expectedRawBytes + 1 });
  } catch {
    return unavailable("PNG_DECOMPRESSION_FAILED", sha256);
  }
  if (raw.length !== expectedRawBytes) return unavailable("PNG_DECOMPRESSED_SIZE_INVALID", sha256);
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[sourceOffset++];
    if (filter > 4) return unavailable("PNG_FILTER_UNSUPPORTED", sha256);
    const row = new Uint8Array(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = previous[i];
      const upperLeft = i >= 4 ? previous[i - 4] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left :
        filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) :
        paeth(left, up, upperLeft);
      row[i] = (raw[sourceOffset++] + predictor) & 255;
    }
    rgba.set(row, y * rowBytes);
    previous = row;
  }
  return { state: "AVAILABLE", sha256, width, height, rgba, reason: null };
}

/** Original silhouette contract uses the same verified PNG decoder. */
export function extractVerifiedPngAlpha(input: PngAlphaEvidenceInput): PngAlphaEvidence {
  const decoded = decodeVerifiedPngRgba(input);
  if (decoded.state !== "AVAILABLE") {
    return {
      state: "UNVERIFIED", reason: decoded.reason,
      sha256: decoded.sha256, mask: null,
    };
  }
  const derived = deriveAlphaSilhouetteMask({
    image_sha256: decoded.sha256,
    view: input.view,
    width: decoded.width, height: decoded.height,
    rgba: decoded.rgba,
    provenance: input.provenance,
  });
  return derived.state === "AVAILABLE"
    ? { state: "AVAILABLE", sha256: decoded.sha256, mask: derived.mask, reason: null }
    : { state: "UNVERIFIED", reason: derived.reason, sha256: decoded.sha256, mask: null };
}

/** End-to-end bytes-to-diagnostic bridge; neither producer nor camera is emulated. */
export function compareBoundPngAlphaEvidence(input: {
  reference: Parameters<typeof compareBoundSilhouetteEvidence>[0]["reference"];
  capture: Parameters<typeof compareBoundSilhouetteEvidence>[0]["capture"];
  reference_png: Uint8Array;
  capture_png: Uint8Array;
  pairing: "REVIEWED_SAME_FRAME" | "UNVERIFIED";
}) {
  if (!input.reference.view) {
    return {
      state: "UNVERIFIED" as const, reason: "REFERENCE_VIEW_UNAVAILABLE",
      metrics: null, visual_verdict: "NOT_EVALUATED" as const,
      automatic_correction: false as const,
    };
  }
  const reference = extractVerifiedPngAlpha({
    png_bytes: input.reference_png, expected_sha256: input.reference.sha256,
    view: input.reference.view, provenance: "APPROVED_ALPHA",
  });
  const model = extractVerifiedPngAlpha({
    png_bytes: input.capture_png, expected_sha256: input.capture.image_sha256,
    view: input.capture.view, provenance: "OFFSCREEN_RENDER_ALPHA",
  });
  if (reference.state !== "AVAILABLE" || model.state !== "AVAILABLE") {
    return {
      state: "UNVERIFIED" as const,
      reason: reference.state !== "AVAILABLE" ? "REFERENCE_" + reference.reason : "MODEL_" + model.reason,
      metrics: null,
      visual_verdict: "NOT_EVALUATED" as const,
      automatic_correction: false as const,
    };
  }
  return compareBoundSilhouetteEvidence({
    reference: input.reference, capture: input.capture,
    reference_mask: reference.mask, model_mask: model.mask,
    pairing: input.pairing,
  });
}
