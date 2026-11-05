import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { decodeVerifiedPngRgba } from "./pngAlphaEvidence";

/**
 * Presentation derived ONLY from four orthographic PNG captures of the same
 * frozen Blockbench project. An illustration, file name, or camera label is
 * not a substitute for the native capture receipt. No new image generation.
 */
export const FOUR_SIDE_CAPTURE_ORDER = ["front", "right", "back", "left"] as const;
export type FourSideCaptureView = (typeof FOUR_SIDE_CAPTURE_ORDER)[number];

export type FourSideCaptureImage = Readonly<{
  view: FourSideCaptureView;
  projection: "orthographic" | "perspective";
  image_sha256: string;
  png_bytes: Uint8Array;
}>;

export type FourSideSheetInput = Readonly<{
  project_uuid_before: string;
  project_uuid_after: string;
  dependency_freshness: "MATCHED" | "STALE" | "UNVERIFIED";
  images: readonly FourSideCaptureImage[];
}>;

export type FourSideSheetResult =
  | Readonly<{
      state: "AVAILABLE";
      reason: null;
      png_bytes: Uint8Array;
      image_sha256: string;
      width: number;
      height: number;
      source_views: readonly FourSideCaptureView[];
      source_image_sha256: readonly string[];
      provenance: "SAME_NATIVE_MODEL_FOUR_ORTHOGRAPHIC_VIEWS";
      visual_verdict: "NOT_EVALUATED";
      authoring_ready: false;
    }>
  | Readonly<{
      state: "UNVERIFIED";
      reason: string;
      visual_verdict: "NOT_EVALUATED";
      authoring_ready: false;
    }>;

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_OUTPUT_PIXELS = 4_250_000;
const BG = [22, 27, 37, 255] as const;
const DIVIDER = [84, 91, 102, 255] as const;
const LABEL_BG = [40, 61, 86, 255] as const;
const LABEL_FG = [244, 248, 252, 255] as const;

// Independent bitmaps only identify four camera views, not four source models.
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
};

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name, "ascii");
  const encoded = Buffer.alloc(12 + data.length);
  encoded.writeUInt32BE(data.length, 0);
  type.copy(encoded, 4);
  encoded.set(data, 8);
  encoded.writeUInt32BE(checksum(encoded.subarray(4, 8 + data.length)), 8 + data.length);
  return encoded;
}

/** Simple non-interlaced RGBA PNG. No image codecs or external dependencies. */
export function encodeFourSideRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_OUTPUT_PIXELS ||
      rgba.byteLength !== width * height * 4) {
    throw new Error("FOUR_SIDE_PNG_BUFFER_INVALID");
  }
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0;
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

function paint(
  pixels: Uint8Array, width: number, height: number,
  x: number, y: number, color: readonly [number, number, number, number]
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const at = (y * width + x) * 4;
  pixels[at] = color[0];
  pixels[at + 1] = color[1];
  pixels[at + 2] = color[2];
  pixels[at + 3] = color[3];
}

function rectangle(
  pixels: Uint8Array, width: number, height: number,
  x: number, y: number, w: number, h: number,
  color: readonly [number, number, number, number]
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) paint(pixels, width, height, xx, yy, color);
  }
}

function label(
  pixels: Uint8Array, width: number, height: number,
  ox: number, oy: number, name: string, panelWidth: number, panelHeight: number
): void {
  // 5x7 pixel glyphs scaled 2x. The label has no illustration or extra panel.
  const scale = panelWidth >= 80 && panelHeight >= 40 ? 2 : 1;
  const textWidth = name.length * (6 * scale) - scale;
  const padding = 5;
  const x = ox + Math.max(2, Math.min(10, panelWidth - textWidth - padding * 2));
  const y = oy + (panelHeight >= 40 ? 10 : 2);
  rectangle(pixels, width, height, x, y, textWidth + padding * 2, 7 * scale + padding * 2, LABEL_BG);
  for (let index = 0; index < name.length; index++) {
    const glyph = GLYPHS[name[index]];
    if (!glyph) throw new Error("FOUR_SIDE_LABEL_UNSUPPORTED");
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < 5; gx++) if (row[gx] === "1") {
        rectangle(pixels, width, height,
          x + padding + index * 6 * scale + gx * scale,
          y + padding + gy * scale, scale, scale, LABEL_FG);
      }
    });
  }
}

/**
 * Fail-closed composition. Validates real byte identity, one project capture,
 * freshness and four orthographic views before arranging pixels in fixed 2x2.
 * Not a visual-quality PASS, geometry provenance certificate or UV/Bedrock proof.
 */
export function composeNativeFourSideSheet(input: FourSideSheetInput): FourSideSheetResult {
  const fail = (reason: string): FourSideSheetResult =>
    ({ state: "UNVERIFIED", reason, visual_verdict: "NOT_EVALUATED", authoring_ready: false });

  if (!input.project_uuid_before || input.project_uuid_before !== input.project_uuid_after)
    return fail("FOUR_SIDE_PROJECT_IDENTITY_CHANGED");
  if (input.dependency_freshness !== "MATCHED")
    return fail("FOUR_SIDE_DEPENDENCY_FRESHNESS_UNVERIFIED");
  if (input.images.length !== 4 ||
      new Set(input.images.map(row => row.view)).size !== 4 ||
      FOUR_SIDE_CAPTURE_ORDER.some(view => !input.images.some(row => row.view === view))) {
    return fail("FOUR_SIDE_VIEW_SET_INVALID");
  }

  const ordered = FOUR_SIDE_CAPTURE_ORDER.map(view =>
    input.images.find(row => row.view === view)!
  );
  if (ordered.some(row => row.projection !== "orthographic"))
    return fail("FOUR_SIDE_PROJECTION_NOT_ORTHOGRAPHIC");

  const decoded = ordered.map(row =>
    decodeVerifiedPngRgba({
      png_bytes: row.png_bytes,
      expected_sha256: row.image_sha256,
    })
  );
  const invalid = decoded.find(row => row.state !== "AVAILABLE");
  if (invalid && invalid.state !== "AVAILABLE")
    return fail("FOUR_SIDE_SOURCE_" + invalid.reason);
  const frames = decoded.filter((row): row is Extract<typeof row, { state: "AVAILABLE" }> =>
    row.state === "AVAILABLE"
  );
  if (frames.length !== 4) return fail("FOUR_SIDE_SOURCE_PNG_UNAVAILABLE");
  const panelWidth = frames[0].width;
  const panelHeight = frames[0].height;
  if (frames.some(frame => frame.width !== panelWidth || frame.height !== panelHeight))
    return fail("FOUR_SIDE_FRAME_DIMENSIONS_DIFFER");
  if (panelWidth < 48 || panelHeight < 28)
    return fail("FOUR_SIDE_PANEL_TOO_SMALL_FOR_LABELS");
  // Exactly 2x source dimensions: 512px capture becomes a 1024px board.
  // This stays inside the existing verified PNG decoder's one-million-pixel budget.
  const width = panelWidth * 2;
  const height = panelHeight * 2;
  if (width * height > MAX_OUTPUT_PIXELS)
    return fail("FOUR_SIDE_COMPOSITE_OVERSIZE");

  const rgba = new Uint8Array(width * height * 4);
  rectangle(rgba, width, height, 0, 0, width, height, BG);

  for (let i = 0; i < 4; i++) {
    const frame = frames[i];
    const ox = i % 2 === 0 ? 0 : panelWidth;
    const oy = i < 2 ? 0 : panelHeight;
    // Alpha compositing retains native source pixels and draws only labels/dividers.
    for (let y = 0; y < panelHeight; y++) {
      for (let x = 0; x < panelWidth; x++) {
        const pos = (y * panelWidth + x) * 4;
        const alpha = frame.rgba[pos + 3] / 255;
        const dst = ((y + oy) * width + (x + ox)) * 4;
        for (let channel = 0; channel < 3; channel++) {
          rgba[dst + channel] = Math.round(frame.rgba[pos + channel] * alpha + BG[channel] * (1 - alpha));
        }
        rgba[dst + 3] = 255;
      }
    }
    label(rgba, width, height, ox, oy, FOUR_SIDE_CAPTURE_ORDER[i].toUpperCase(), panelWidth, panelHeight);
  }
  // Thin dividers occupy the shared boundary pixels; no extra panels or resize.
  rectangle(rgba, width, height, panelWidth - 1, 0, 2, height, DIVIDER);
  rectangle(rgba, width, height, 0, panelHeight - 1, width, 2, DIVIDER);
  const png_bytes = encodeFourSideRgbaPng(width, height, rgba);
  const image_sha256 = createHash("sha256").update(png_bytes).digest("hex");
  return {
    state: "AVAILABLE",
    reason: null,
    png_bytes,
    image_sha256,
    width,
    height,
    source_views: [...FOUR_SIDE_CAPTURE_ORDER],
    source_image_sha256: ordered.map(row => row.image_sha256),
    provenance: "SAME_NATIVE_MODEL_FOUR_ORTHOGRAPHIC_VIEWS",
    visual_verdict: "NOT_EVALUATED",
    authoring_ready: false,
  };
}
