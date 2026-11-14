import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTextureRevision } from "../lib/texture/revision";
import {
  compareTexturePairBytes, parseTexturePairInput, runTexturePairCli,
  type TexturePairInput,
} from "../scripts/authoring/analyze-texture-pair";

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const item of bytes) {
    value ^= item;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, content: Buffer): Buffer {
  const typeBytes = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(content.length);
  const digest = Buffer.alloc(4);
  digest.writeUInt32BE(crc(Buffer.concat([typeBytes, content])));
  return Buffer.concat([size, typeBytes, content, digest]);
}
function png(width: number, height: number, pixels: Uint8Array) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // non-interlaced RGBA8
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    rows[start] = 0; // filter type None
    rows.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      start + 1
    );
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sample() {
  const sourcePixels = new Uint8Array([
    20, 30, 40, 255, 20, 30, 40, 255,
    20, 30, 40, 255, 20, 30, 40, 255,
  ]);
  const candidatePixels = new Uint8Array(sourcePixels);
  candidatePixels[4] = 200; // second pixel, only allowed mask
  const sourcePng = png(2, 2, sourcePixels);
  const candidatePng = png(2, 2, candidatePixels);
  const input: TexturePairInput = {
    schema: "lazydesigner-texture-pair-input-v1",
    mode: "VARIANT",
    source: {
      png_file: "base.png", png_sha256: sha(sourcePng),
      project_uuid: "project-one", texture_uuid: "blue-base",
    },
    candidate: {
      png_file: "variant.png", png_sha256: sha(candidatePng),
      project_uuid: "project-one", texture_uuid: "red-variant",
    },
    allowed_change_regions: [{ x: 1, y: 0, width: 1, height: 1 }],
    require_alpha_identity: true,
  };
  return { sourcePixels, candidatePixels, sourcePng, candidatePng, input };
}

describe("read-only texture PNG pair evidence CLI", () => {
  test("validated actual PNG bytes report exact allowed change, not native or visual PASS", async () => {
    const fixture = sample();
    fixture.input.source.full_rgba_revision = await computeTextureRevision(
      new Uint8ClampedArray(fixture.sourcePixels), 2, 2
    );
    fixture.input.candidate.full_rgba_revision = await computeTextureRevision(
      new Uint8ClampedArray(fixture.candidatePixels), 2, 2
    );
    const report = await compareTexturePairBytes(
      parseTexturePairInput(fixture.input),
      fixture.sourcePng, fixture.candidatePng, "a".repeat(64)
    );
    expect(report.png_integrity).toBe("SHA256_MATCHED");
    expect(report.revision_claims_matched).toEqual({
      source: true, candidate: true,
    });
    expect(report.changed_region).toEqual({
      changed: true, rect: { x: 1, y: 0, width: 1, height: 1 },
      changed_pixels: 1,
    });
    expect(report.change_scope).toMatchObject({
      state: "WITHIN_DECLARED_REGIONS",
      changed_outside_declared_regions: 0,
      declared_mask_authority: "CALLER_DECLARATION_UNVERIFIED",
    });
    expect(report.alpha).toMatchObject({
      changed_pixels: 0, state: "UNCHANGED",
    });
    expect(report.native_origin_verified).toBe(false);
    expect(report.current_project_binding_verified).toBe(false);
    expect(report.visual_verdict).toBe("UNVERIFIED");
    expect(report.automatic_correction).toBe(false);
  });

  test("detects hidden out-of-mask edits and forbidden alpha changes", async () => {
    const fixture = sample();
    const pixels = new Uint8Array(fixture.candidatePixels);
    pixels[0] = 222; // unexpected first pixel outside the declared mask
    pixels[15] = 0; // unexpected fourth-pixel alpha
    const after = png(2, 2, pixels);
    fixture.input.candidate.png_sha256 = sha(after);
    const report = await compareTexturePairBytes(
      fixture.input, fixture.sourcePng, after
    );
    expect(report.review_required).toBe(true);
    expect(report.change_scope).toMatchObject({
      state: "OUTSIDE_DECLARED_REGIONS",
      changed_outside_declared_regions: 2,
    });
    expect(report.alpha).toMatchObject({
      state: "CHANGED_VIOLATION", changed_pixels: 1,
    });
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("no allowed region cannot silently become an approved mask", async () => {
    const fixture = sample();
    delete fixture.input.allowed_change_regions;
    const report = await compareTexturePairBytes(
      fixture.input, fixture.sourcePng, fixture.candidatePng
    );
    expect(report.change_scope).toMatchObject({
      state: "NOT_DECLARED", changed_outside_declared_regions: null,
    });
    expect(report.review_required).toBe(true);
    expect(report.next_action).toBe(
      "DECLARE_CHANGE_SCOPE_OR_REVIEW_FRESH_NATIVE_MODEL_VIEWS"
    );
    expect(report.visual_verdict).toBe("UNVERIFIED");
  });

  test("rejects inconsistent project/texture claims and unsafe input paths", () => {
    const fixture = sample();
    const wrong = structuredClone(fixture.input);
    wrong.candidate.project_uuid = "other-project";
    expect(() => parseTexturePairInput(wrong))
      .toThrow("TEXTURE_PAIR_DECLARED_IDENTITY_CONFLICT");
    const same = structuredClone(fixture.input);
    same.candidate.texture_uuid = same.source.texture_uuid;
    expect(() => parseTexturePairInput(same))
      .toThrow("TEXTURE_PAIR_DECLARED_IDENTITY_CONFLICT");
    const escape = structuredClone(fixture.input);
    escape.source.png_file = "../outside.png";
    expect(() => parseTexturePairInput(escape))
      .toThrow("TEXTURE_PAIR_IMAGE_DECLARATION_INVALID");
    const invalid = structuredClone(fixture.input);
    invalid.allowed_change_regions = [{ x: 0, y: -1, width: 1, height: 1 }];
    expect(() => parseTexturePairInput(invalid))
      .toThrow("TEXTURE_PAIR_REGIONS_INVALID");
    expect(() => parseTexturePairInput({
      ...fixture.input, user_approved: true,
    })).toThrow("TEXTURE_PAIR_MANIFEST_INVALID");
  });

  test("mismatched PNG SHA or native revision claims are not accepted", async () => {
    const fixture = sample();
    const digestMismatch = structuredClone(fixture.input);
    digestMismatch.candidate.png_sha256 = "0".repeat(64);
    await expect(compareTexturePairBytes(
      digestMismatch, fixture.sourcePng, fixture.candidatePng
    )).rejects.toThrow("TEXTURE_PAIR_PNG_UNVERIFIED");
    const revisionMismatch = structuredClone(fixture.input);
    revisionMismatch.candidate.full_rgba_revision =
      "sha256:2x2:" + "f".repeat(64);
    await expect(compareTexturePairBytes(
      revisionMismatch, fixture.sourcePng, fixture.candidatePng
    )).rejects.toThrow("TEXTURE_PAIR_RGBA_REVISION_MISMATCH");
    const dimensions = structuredClone(fixture.input);
    const other = png(1, 1, new Uint8Array([20, 30, 40, 255]));
    dimensions.candidate.png_sha256 = sha(other);
    await expect(compareTexturePairBytes(
      dimensions, fixture.sourcePng, other
    )).rejects.toThrow("TEXTURE_PAIR_BITMAP_DIMENSIONS_MISMATCH");
  });

  test("file CLI reads only sibling PNGs, keeps files unchanged, and returns bounded JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "texture-pair-cli-"));
    const fixture = sample();
    const manifest = join(directory, "pair.json");
    try {
      await writeFile(join(directory, fixture.input.source.png_file), fixture.sourcePng);
      await writeFile(join(directory, fixture.input.candidate.png_file), fixture.candidatePng);
      const data = JSON.stringify(fixture.input);
      await writeFile(manifest, data);
      const result = await runTexturePairCli(["--input", manifest, "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema: "lazydesigner-texture-pair-report-v1",
        native_origin_verified: false,
        visual_verdict: "UNVERIFIED",
        changed_region: { changed_pixels: 1 },
      });
      expect(await readFile(manifest, "utf8")).toBe(data);
      expect(await readFile(join(directory, "base.png"))).toEqual(fixture.sourcePng);
      expect((await runTexturePairCli(["--help"])).stdout).toContain("RGBA");
      await writeFile(manifest, "{private-entry:");
      const rejected = await runTexturePairCli(["--input", manifest, "--json"]);
      expect(rejected.exitCode).toBe(2);
      expect(rejected.stderr).not.toContain("private-entry");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a directory masquerading as a PNG is rejected on every host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "texture-pair-directory-"));
    try {
      const fixture = sample();
      await mkdir(join(directory, "base.png"));
      await writeFile(join(directory, "variant.png"), fixture.candidatePng);
      const manifest = join(directory, "pair.json");
      await writeFile(manifest, JSON.stringify(fixture.input));
      const result = await runTexturePairCli(["--input", manifest, "--json"]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("TEXTURE_PAIR_PNG_FILE_INVALID");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("the managed route and future compiled smoke are authored but not executed", async () => {
    const [manager, packaging] = await Promise.all([
      Bun.file("../distribution/cli.ts").text(),
      Bun.file("../distribution/package.ts").text(),
    ]);
    expect(manager).toContain('command === "analyze-texture-pair"');
    expect(manager).toContain("runTexturePairCli(raw)");
    expect(packaging).toContain("Compiled manager texture pair route smoke failed.");
  });
});
