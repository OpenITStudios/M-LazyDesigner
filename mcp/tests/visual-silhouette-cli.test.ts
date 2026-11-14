import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectVisualSilhouettePngs, parseVisualSilhouetteInput,
  runVisualSilhouetteCli, type VisualSilhouetteInput,
} from "../scripts/authoring/analyze-visual-silhouette";

function crc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tag: string, data: Buffer): Buffer {
  const name = Buffer.from(tag);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function png(rows: readonly string[]): Buffer {
  const width = rows[0]!.length, height = rows.length;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; // exact supported RGBA8
  const filtered = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      filtered[y * (width * 4 + 1) + 1 + x * 4 + 3] =
        rows[y]![x] === "1" ? 255 : 0;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(filtered)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sample() {
  const referencePng = png([
    "00000", "01110", "01010", "01110", "00000",
  ]);
  const capturePng = png([
    "00000", "00100", "01110", "00100", "00000",
  ]);
  const input: VisualSilhouetteInput = {
    schema: "lazydesigner-visual-silhouette-input-v1",
    reference: {
      png_file: "reference.png", id: "REF_FRONT",
      sha256: sha(referencePng),
      integrity: "VERIFIED", status: "APPROVED",
      view: "front", mime_type: "image/png",
    },
    capture: {
      png_file: "capture.png",
      project_uuid: "project-a",
      evidence_handle: "modelcapture:" + "c".repeat(64),
      view: "front", image_sha256: sha(capturePng),
      width: 5, height: 5,
    },
    pairing: "REVIEWED_SAME_FRAME",
  };
  return { referencePng, capturePng, input };
}

describe("read-only CLI for bounded reference/model alpha silhouettes", () => {
  test("SHA-bound actual PNG pixels produce diagnostic IoU, never visual PASS", () => {
    const { input, referencePng, capturePng } = sample();
    const copy = structuredClone(input);
    const report = inspectVisualSilhouettePngs(
      parseVisualSilhouetteInput(input),
      referencePng, capturePng, "a".repeat(64)
    );
    expect(report.comparison.state).toBe("DIAGNOSTIC_ONLY");
    expect(report.comparison.metrics?.iou).toBeCloseTo(4 / 9, 4);
    expect(report.comparison.metrics?.reference_only_pixels).toBe(4);
    expect(report.comparison.metrics?.model_only_pixels).toBe(1);
    expect(report.comparison.visual_verdict).toBe("NOT_EVALUATED");
    expect(report.comparison).toMatchObject({
      pairing_authority: "CALLER_DECLARED",
    });
    expect(report.native_capture_origin_attested).toBe(false);
    expect(report.camera_alignment_attested).toBe(false);
    expect(report.reference_approval_attested).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.automatic_correction).toBe(false);
    expect(input).toEqual(copy);
  });

  test("without reviewed frame pairing there are no misleading overlap metrics", () => {
    const { input, referencePng, capturePng } = sample();
    input.pairing = "UNVERIFIED";
    const report = inspectVisualSilhouettePngs(input, referencePng, capturePng);
    expect(report.comparison).toMatchObject({
      state: "UNVERIFIED",
      reason: "CAMERA_AND_FRAMING_PAIRING_UNVERIFIED",
      metrics: null,
      visual_verdict: "NOT_EVALUATED",
    });
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("reference approval, view and image identity are never inferred from filenames", () => {
    const { input, referencePng, capturePng } = sample();
    const draft = structuredClone(input);
    draft.reference.status = "DRAFT";
    expect(inspectVisualSilhouettePngs(
      draft, referencePng, capturePng
    ).comparison.reason).toBe("APPROVED_PNG_REFERENCE_UNAVAILABLE");
    const wrongView = structuredClone(input);
    wrongView.capture.view = "back";
    expect(inspectVisualSilhouettePngs(
      wrongView, referencePng, capturePng
    ).comparison.reason).toBe("VIEW_IDENTITY_DIFFERS");
    const tampered = Buffer.from(capturePng);
    tampered[tampered.length - 17] ^= 1;
    expect(inspectVisualSilhouettePngs(
      input, referencePng, tampered
    ).comparison.reason).toMatch(/^MODEL_PNG_/);
    expect(inspectVisualSilhouettePngs(
      input, referencePng, capturePng
    ).visual_verdict).toBe("UNVERIFIED");
  });

  test("opaque source and differing dimensions stay unverified", () => {
    const { input, capturePng } = sample();
    const opaque = png(["11111", "11111", "11111", "11111", "11111"]);
    const opaqueInput = structuredClone(input);
    opaqueInput.reference.sha256 = sha(opaque);
    expect(inspectVisualSilhouettePngs(
      opaqueInput, opaque, capturePng
    ).comparison.reason).toBe("REFERENCE_OPAQUE_OR_EMPTY_ALPHA_MASK");
    const smaller = png(["0000", "0110", "0110", "0000"]);
    const other = structuredClone(input);
    other.capture.image_sha256 = sha(smaller);
    other.capture.width = 4;
    other.capture.height = 4;
    expect(inspectVisualSilhouettePngs(
      other, sample().referencePng, smaller
    ).comparison.reason).toBe("FRAME_DIMENSIONS_DIFFER");
  });

  test("manifest disallows path traversal, fake handles, extra authority and same-file pairing", () => {
    const { input } = sample();
    const producerIds = structuredClone(input);
    producerIds.reference.id = "REFERENCE:FRONT";
    producerIds.capture.project_uuid = "project.uuid:one";
    expect(parseVisualSilhouetteInput(producerIds).capture.project_uuid)
      .toBe("project.uuid:one");
    const escape = structuredClone(input);
    escape.capture.png_file = "../capture.png";
    expect(() => parseVisualSilhouetteInput(escape))
      .toThrow("VISUAL_SILHOUETTE_CAPTURE_INVALID");
    const handle = structuredClone(input);
    handle.capture.evidence_handle = "modelcapture:invented";
    expect(() => parseVisualSilhouetteInput(handle))
      .toThrow("VISUAL_SILHOUETTE_CAPTURE_INVALID");
    const extra = { ...input, approved_by_user: true };
    expect(() => parseVisualSilhouetteInput(extra))
      .toThrow("VISUAL_SILHOUETTE_MANIFEST_INVALID");
    const same = structuredClone(input);
    same.capture.png_file = same.reference.png_file;
    expect(() => parseVisualSilhouetteInput(same))
      .toThrow("VISUAL_SILHOUETTE_DISTINCT_IMAGES_REQUIRED");
  });

  test("file CLI is read-only, JSON-safe and rejects a directory masquerading as PNG", async () => {
    const dir = await mkdtemp(join(tmpdir(), "visual-silhouette-cli-"));
    const { input, referencePng, capturePng } = sample();
    const path = join(dir, "visual.json");
    try {
      await writeFile(join(dir, input.reference.png_file), referencePng);
      await writeFile(join(dir, input.capture.png_file), capturePng);
      const json = JSON.stringify(input);
      await writeFile(path, json);
      const response = await runVisualSilhouetteCli(["--input", path, "--json"]);
      expect(response.exitCode).toBe(0);
      expect(JSON.parse(response.stdout)).toMatchObject({
        schema: "lazydesigner-visual-silhouette-cli-v1",
        visual_verdict: "UNVERIFIED",
        native_mutation: false,
        comparison: { state: "DIAGNOSTIC_ONLY" },
      });
      expect(await readFile(path, "utf8")).toBe(json);
      expect(await readFile(join(dir, "capture.png"))).toEqual(capturePng);
      await rm(join(dir, "capture.png"));
      await mkdir(join(dir, "capture.png"));
      const directory = await runVisualSilhouetteCli(["--input", path]);
      expect(directory.exitCode).toBe(2);
      expect(directory.stderr).toContain("VISUAL_SILHOUETTE_PNG_FILE_INVALID");
      const help = await runVisualSilhouetteCli(["--help"]);
      expect(help.exitCode).toBe(0);
      expect(help.stdout).toContain("lazydesigner-visual-silhouette-input-v1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed input never echoes private content and compiled route remains unexecuted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "visual-silhouette-input-"));
    const path = join(dir, "visual.json");
    try {
      await writeFile(path, "{do-not-echo-private-bytes:");
      const error = await runVisualSilhouetteCli(["--input", path, "--json"]);
      expect(error.exitCode).toBe(2);
      expect(error.stderr).toContain("VISUAL_SILHOUETTE_INPUT_JSON_INVALID");
      expect(error.stderr).not.toContain("do-not-echo-private-bytes");
      expect((await runVisualSilhouetteCli([
        "--input", path, "--apply",
      ])).exitCode).toBe(2);
      const [manager, packaging] = await Promise.all([
        Bun.file("../distribution/cli.ts").text(),
        Bun.file("../distribution/package.ts").text(),
      ]);
      expect(manager).toContain('command === "analyze-visual-silhouette"');
      expect(manager).toContain("runVisualSilhouetteCli(raw)");
      expect(packaging).toContain(
        "Compiled manager visual silhouette CLI route smoke failed."
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
