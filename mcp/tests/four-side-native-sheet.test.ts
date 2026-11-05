import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  composeNativeFourSideSheet,
  encodeFourSideRgbaPng,
  FOUR_SIDE_CAPTURE_ORDER,
  type FourSideCaptureImage,
  type FourSideCaptureView,
} from "@/lib/reference/fourSideSheet";
import { decodeVerifiedPngRgba } from "@/lib/reference/pngAlphaEvidence";

const PANEL = 64;
const paints = [40, 91, 153, 208];

function captured(view: FourSideCaptureView, pigment: number, size = PANEL): FourSideCaptureImage {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pigment;
    pixels[i + 1] = 32;
    pixels[i + 2] = 21;
    pixels[i + 3] = 255;
  }
  const png_bytes = encodeFourSideRgbaPng(size, size, pixels);
  return {
    view,
    projection: "orthographic",
    image_sha256: createHash("sha256").update(png_bytes).digest("hex"),
    png_bytes,
  };
}

function input() {
  return {
    project_uuid_before: "same-blockbench-project",
    project_uuid_after: "same-blockbench-project",
    dependency_freshness: "MATCHED" as const,
    images: FOUR_SIDE_CAPTURE_ORDER.map((view, i) => captured(view, paints[i])),
  };
}

describe("native four-side sheet — deterministic geometry-first presentation", () => {
  test("composes only 4 existing view pixels into fixed 2x2 and no additional illustration", () => {
    // Input order must not change the board order.
    const supplied = input();
    const result = composeNativeFourSideSheet({
      ...supplied, images: supplied.images.slice().reverse(),
    });
    expect(result.state).toBe("AVAILABLE");
    if (result.state !== "AVAILABLE") return;
    expect(result.source_views).toEqual(["front", "right", "back", "left"]);
    expect(result.source_image_sha256).toEqual(supplied.images.map(row => row.image_sha256));
    expect(result.provenance).toBe("SAME_NATIVE_MODEL_FOUR_ORTHOGRAPHIC_VIEWS");
    expect(result.visual_verdict).toBe("NOT_EVALUATED");
    expect(result.authoring_ready).toBe(false);
    expect(result.width).toBe(PANEL * 2);
    expect(result.height).toBe(PANEL * 2);
    const decoded = decodeVerifiedPngRgba({
      png_bytes: result.png_bytes,
      expected_sha256: result.image_sha256,
    });
    expect(decoded.state).toBe("AVAILABLE");
    if (decoded.state !== "AVAILABLE") return;
    // Pick locations away from the label overlays; the base screenshots are copied.
    const sample = (x: number, y: number) => decoded.rgba[(y * decoded.width + x) * 4];
    expect([sample(30, 50), sample(30 + PANEL, 50),
      sample(30, 50 + PANEL), sample(30 + PANEL, 50 + PANEL)])
      .toEqual(paints);
    expect(sample(PANEL, PANEL)).toBe(84); // fixed separator
    expect(sample(12, 12)).not.toBe(paints[0]); // short native label
    const repeat = composeNativeFourSideSheet(input());
    expect(repeat.state).toBe("AVAILABLE");
    if (repeat.state === "AVAILABLE") expect(repeat.image_sha256).toBe(result.image_sha256);
  });

  test("rejects a missing, duplicate or substituted directional view", () => {
    const good = input();
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.slice(0, 3),
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_VIEW_SET_INVALID" });
    expect(composeNativeFourSideSheet({
      ...good, images: [...good.images.slice(0, 3), good.images[0]],
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_VIEW_SET_INVALID" });
  });

  test("rejects project drift, incomplete dependency tracking and perspective views", () => {
    const good = input();
    expect(composeNativeFourSideSheet({
      ...good, project_uuid_after: "different-project",
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_PROJECT_IDENTITY_CHANGED" });
    expect(composeNativeFourSideSheet({
      ...good, dependency_freshness: "UNVERIFIED",
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_DEPENDENCY_FRESHNESS_UNVERIFIED" });
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.map(row => row.view === "front"
        ? { ...row, projection: "perspective" as const } : row),
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_PROJECTION_NOT_ORTHOGRAPHIC" });
  });

  test("rejects corrupted PNG, bad SHA, inconsistent dimensions and too-small panels", () => {
    const good = input();
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.map((row, i) => i === 1
        ? { ...row, image_sha256: "0".repeat(64) } : row),
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_SOURCE_PNG_IMAGE_IDENTITY_MISMATCH" });
    const tampered = Uint8Array.from(good.images[1].png_bytes);
    tampered[tampered.length - 8] ^= 255;
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.map((row, i) => i === 1
        ? { ...row, png_bytes: tampered } : row),
    }).state).toBe("UNVERIFIED");
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.map((row, i) => i === 2
        ? captured(row.view, paints[i], 80) : row),
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_FRAME_DIMENSIONS_DIFFER" });
    expect(composeNativeFourSideSheet({
      ...good, images: good.images.map((row, i) => captured(row.view, paints[i], 32)),
    })).toMatchObject({ state: "UNVERIFIED", reason: "FOUR_SIDE_PANEL_TOO_SMALL_FOR_LABELS" });
  });
});
