import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlenderRenderProvider } from "@/gateway/providers/blenderRender";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import {
  BLENDER_COMPLETION_KIND,
  blenderCompletionSchema,
  blenderCompletionPaths,
  MAX_BLENDER_COMPLETION_BYTES,
} from "@/lib/publication/renderCompletion";

/** Synthetic factual diagnostics only: NOT evidence of Blender execution. */
const diagnostics = {
  schema_version: 1, status: "RENDERED_DIAGNOSTICS_NOT_VISUAL_APPROVAL",
  asset: {
    mesh_count: 1, polygon_count: 12, vertex_count: 24, material_count: 1,
    world_min: [0, 0, 0], world_max: [1, 1, 1],
    bounding_radius: 0.866, source_fidelity_visual: "NOT_EVALUATED",
  },
  camera: {
    mode: "auto", requested_yaw_degrees: 38, requested_elevation_degrees: 18,
    resolved_yaw_degrees: 38, resolved_elevation_degrees: 18,
    projection: "perspective", candidate_count: 15,
    projected_bounds: [0.1, 0.1, 0.9, 0.9],
    projected_area: 0.64, projected_hull_area: 0.52,
    framing_fit_multiplier: 1, framing_fit_attempts: 1,
    frame_safe: true, quality_is_artistic_score: false,
  },
  lighting: {
    world: {
      background_color: [0.05, 0.07, 0.12, 1],
      background_color_role: "ACTIVE_PROCEDURAL_WORLD", world_strength: 0.7,
    },
    ground: { mode: "dark", shadow_catcher: false, position_z: -0.002 },
    lights: [
      { name: "LD_Key", power: 180, size: 2, position: [1, 2, 3],
        distance_to_subject: 3.7, color_rgb: [1, 0.85, 0.72] },
      { name: "LD_Fill", power: 70, size: 2.8, position: [2, 1, 3],
        distance_to_subject: 3.7, color_rgb: [0.67, 0.79, 1] },
      { name: "LD_Rim", power: 240, size: 1.6, position: [1, 3, 2],
        distance_to_subject: 3.7, color_rgb: [0.87, 0.94, 1] },
    ],
    key_to_fill_energy_ratio: 2.57143,
    hdr_environment: "NONE_BUNDLED", hdri_sha256: null,
    source_geometry_edited: false,
  },
  compositor: {
    node_group: "LD_Publication_Compositor",
    highlight_glow_enabled: true, glow_strength: 0.08,
    glow_threshold: 2, pixel_art_filtering: "CLOSEST_IN_MATERIALS",
    automatic_artistic_approval: false,
  },
  render: {
    engine: "CYCLES", view_transform: "AgX",
    sampling: { samples: 32, adaptive_threshold: 0.08, denoising: true },
    device: { requested: "auto", actual: "CPU", backend: null },
    render_size: [256, 256],
  },
  image: {
    image_dimensions: [256, 256],
    sampled_pixels: 9216, visible_samples: 9216,
    mean_visible_luminance: 0.4, high_luminance_fraction: 0.01,
    near_black_visible_fraction: 0.14, nonopaque_fraction: 0,
    analysis_type: "MEASURED_DOWNSAMPLED_CYCLES_PNG", artistic_quality_score: null,
    projected_frame_roi: {
      source: "BLENDER_LOADED_CYCLES_PNG",
      region_type: "PROJECTED_BOUNDS_RECT_NOT_SEGMENTATION",
      bounds_ndc: [0.1, 0.1, 0.9, 0.9],
      sampled_pixels: 5929, visible_samples: 5929,
      mean_visible_luminance: 0.43,
      near_black_fraction: 0.16, near_white_fraction: 0.01,
      artistic_quality_score: null,
    },
  },
  preview: {
    dimensions: [128, 128],
    source: "DOWNSAMPLED_FINAL_CYCLES_PNG", artistic_approval: false,
  },
  warnings: [], artistic_quality: "NOT_EVALUATED", source_model_edited: false,
};
const request = publicationRenderParameters.parse({
  blender_executable: "/opt/blender-5.2/blender",
  output_path: "/tmp/model.png",
  quality: "preview", width: 256, height: 256,
});
const stored = {
  kind: BLENDER_COMPLETION_KIND,
  schema_version: 1,
  job_id: "blender_" + "a".repeat(24),
  started_at: "2026-11-04T00:00:00.000Z",
  completed_at: "2026-11-04T00:01:00.000Z",
  source_project_uuid: "project-1",
  source_sha256: "a".repeat(64), source_manifest_sha256: "b".repeat(64),
  glb_sha256: "c".repeat(64), worker_sha256: "d".repeat(64),
  cube_count: 1, material_count: 1,
  request,
  output_png_sha256: "e".repeat(64), output_png_bytes: 1024,
  preview_sha256: "f".repeat(64), preview_bytes: 512,
  preview_dimensions: [128, 128],
  diagnostics,
};

describe("Gateway completed-render durable receipt contract", () => {
  test("one versioned factual receipt is admissible without claiming visual approval", () => {
    expect(blenderCompletionSchema.parse(stored)).toMatchObject({
      kind: BLENDER_COMPLETION_KIND, job_id: stored.job_id,
      request: { output_path: "/tmp/model.png" },
    });
    expect(blenderCompletionPaths(request.output_path)).toEqual({
      receipt_path: "/tmp/model.png.lazydesigner.json",
      preview_path: "/tmp/model.png.lazydesigner.preview.png",
    });
    expect(MAX_BLENDER_COMPLETION_BYTES).toBeLessThan(128 * 1024);
  });

  test("tampered dimensions, inventory, claims or unknown fields refuse recovery", () => {
    for (const candidate of [
      { ...stored, kind: "unknown" },
      { ...stored, job_id: "render_" + "a".repeat(24) },
      { ...stored, source_sha256: "not-sha" },
      { ...stored, output_png_bytes: -1 },
      { ...stored, output_png_bytes: 200 * 1024 * 1024 },
      { ...stored, cube_count: 2 },
      { ...stored, preview_dimensions: [4000, 4000] },
      { ...stored, diagnostics: {
        ...diagnostics, image: { ...diagnostics.image, image_dimensions: [300, 300] },
      } },
      { ...stored, diagnostics: { ...diagnostics, artistic_quality: "PASS" } },
      { ...stored, source_editor_current: true },
    ]) {
      expect(blenderCompletionSchema.safeParse(candidate).success).toBe(false);
    }
  });
});


function chunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.alloc(12 + data.length);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, "ascii");
  data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return bytes;
}

function syntheticRgbaPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowBytes;
    raw[offset] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = offset + 1 + x * 4;
      raw[pixel] = 80; raw[pixel + 1] = 120;
      raw[pixel + 2] = 170; raw[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("Gateway restart completion recovery (synthetic files; no Blender)", () => {
  test("recovers only SHA-matching completed PNG and preview, rejects altered bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lazydesigner-recovery-"));
    try {
      const outputPath = join(directory, "asset.png");
      const paths = blenderCompletionPaths(outputPath);
      const png = syntheticRgbaPng(256, 256);
      const preview = syntheticRgbaPng(128, 128);
      const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      const receipt = {
        ...stored,
        request: publicationRenderParameters.parse({
          ...request, output_path: outputPath,
        }),
        output_png_sha256: sha256(png), output_png_bytes: png.length,
        preview_sha256: sha256(preview), preview_bytes: preview.length,
      };
      expect(blenderCompletionSchema.safeParse(receipt).success).toBe(true);
      await writeFile(outputPath, png);
      await writeFile(paths.preview_path, preview);
      await writeFile(paths.receipt_path, JSON.stringify(receipt));

      const provider = new BlenderRenderProvider();
      const restored = await provider.recover(paths.receipt_path);
      expect(restored).toMatchObject({
        job_id: receipt.job_id, state: "RENDERED_DRAFT", phase: "FINISHED",
        receipt: {
          output_png_sha256: receipt.output_png_sha256,
          source_revision: "FROZEN_HANDOFF_NOT_LIVE_EDITOR",
          completion_receipt_path: paths.receipt_path,
        },
      });
      expect(provider.preview(receipt.job_id).content[1]?.type).toBe("image");
      await provider.close();

      const corrupted = Buffer.from(png);
      corrupted[40] = corrupted[40]! ^ 1;
      await writeFile(outputPath, corrupted);
      const afterRestart = new BlenderRenderProvider();
      await expect(afterRestart.recover(paths.receipt_path))
        .rejects.toThrow("PUBLICATION_BLENDER_COMPLETION_OUTPUT_SHA_MISMATCH");
      await afterRestart.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
