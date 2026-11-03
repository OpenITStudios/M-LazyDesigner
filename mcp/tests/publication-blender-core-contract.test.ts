import { describe, expect, test } from "bun:test";
import { publicationDiagnosticsSchema } from "@/lib/publication/diagnostics";

const worker = (name: string) =>
  Bun.file(new URL("../server/publication/worker/" + name, import.meta.url)).text();

const TEST_MODULES = [
  "core_assets.py", "camera_director.py", "lighting_director.py",
  "compositor_director.py", "quality_report.py",
] as const;

describe("Modular Blender Core source owners", () => {
  test("packages all trusted modules, with no dynamic user Python execution", async () => {
    const entry = await worker("render.py");
    const executor = await Bun.file(new URL("../server/publication/execute.ts", import.meta.url)).text();
    for (const name of TEST_MODULES) {
      expect(executor).toContain('"' + name + '"');
    }
    for (const line of [
      "from core_assets import", "from camera_director import",
      "from lighting_director import", "from compositor_director import",
      "from quality_report import",
    ]) expect(entry).toContain(line);
    expect(entry).toContain("sys.path.insert(0, str(Path(__file__).resolve().parent))");
    expect(entry).not.toContain("exec(compile(");
    expect(executor).toContain("BLENDER_CORE_MODULES");
    expect(executor).toContain("publicationDiagnosticsSchema.parse");
    expect(executor).toContain("inspectPublicationPng(png");
    expect(executor).toContain("verifyPublicationSourceCurrent(");
  });

  test("camera and studio light rig derive from geometry, never subject labels", async () => {
    const camera = await worker("camera_director.py");
    const lights = await worker("lighting_director.py");
    expect(camera).toContain("MAX_AUTO_CANDIDATES = 15");
    expect(camera).toContain("MAX_SCORING_MESHES = 128");
    expect(camera).toContain("full_points = _world_points(meshes)");
    expect(camera).toContain("MAX_FINAL_CANDIDATES = 3");
    expect(camera).toContain("FIT_MULTIPLIERS =");
    expect(camera).toContain("bpy.context.view_layer.update()");
    expect(camera).toContain("_hull_area(");
    expect(camera).toContain("PUBLICATION_CAMERA_SUBJECT_CLIPPED");
    for (const part of ["LD_Key", "LD_Fill", "LD_Rim", "is_shadow_catcher"]) {
      expect(lights).toContain(part);
    expect(lights).toContain("MAX_AREA_LIGHT_WATTS");
    expect(lights).toContain("key_to_fill_energy_ratio");
    expect(lights).toContain("distance_to_subject");
    }
  });

  test("actual image statistics cannot be mistaken for artistic approval", async () => {
    const report = await worker("quality_report.py");
    expect(report).toContain("image.pixels.foreach_get(rgba)");
    expect(report).toContain("make_visual_evidence_png(job)");
    expect(report).toContain("DOWNSAMPLED_FINAL_CYCLES_PNG");
    expect(report).toContain("EVIDENCE_MAX_SIDE = 384");
    expect(report).toContain('"artistic_quality": "NOT_EVALUATED"');
    expect(report).not.toContain('"artistic_quality": "PASS"');
  });
});

const valid = {
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
    frame_safe: true,
    quality_is_artistic_score: false,
  },
  lighting: {
    world: {
      background_color: [0.05, 0.07, 0.12, 1],
      background_color_role: "ACTIVE_PROCEDURAL_WORLD",
      world_strength: 0.7,
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
    hdr_environment: "NONE_BUNDLED",
    hdri_sha256: null,
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
    sampling: { samples: 128, adaptive_threshold: 0.02, denoising: true },
    device: { requested: "auto", actual: "CPU", backend: null },
    render_size: [2048, 2048],
  },
  image: {
    image_dimensions: [2048, 2048],
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
    dimensions: [384, 384],
    source: "DOWNSAMPLED_FINAL_CYCLES_PNG",
    artistic_approval: false,
  },
  warnings: [], artistic_quality: "NOT_EVALUATED", source_model_edited: false,
};

describe("Measured Cycles report strict validation", () => {
  test("accepts factual scene, camera and output observations", () => {
    expect(publicationDiagnosticsSchema.parse(valid)).toMatchObject({
      artistic_quality: "NOT_EVALUATED",
    });
  });
  test("device backend and GPU-to-CPU fallback cannot be mislabeled", () => {
    const asDevice = (device: Record<string, unknown>) =>
      publicationDiagnosticsSchema.safeParse({
        ...valid,
        render: { ...valid.render, device },
      }).success;
    expect(asDevice({
      requested: "auto", actual: "CPU", backend: null,
      fallback_reason: "GPU_RENDER_EXCEPTION",
    })).toBe(true);
    expect(asDevice({
      requested: "auto", actual: "GPU", backend: "OPTIX",
    })).toBe(true);
    expect(asDevice({
      requested: "auto", actual: "GPU", backend: null,
    })).toBe(false);
    expect(asDevice({
      requested: "cpu", actual: "CPU", backend: null,
      fallback_reason: "GPU_RENDER_EXCEPTION",
    })).toBe(false);
    expect(asDevice({
      requested: "auto", actual: "CPU", backend: "CUDA",
    })).toBe(false);
  });

  test("rejects fake PASS, invalid projected frame and pixel mismatches", () => {
    for (const broken of [
      { ...valid, artistic_quality: "PASS" },
      { ...valid, camera: { ...valid.camera, frame_safe: false } },
      { ...valid, camera: { ...valid.camera, candidate_count: 100 } },
      { ...valid, image: { ...valid.image, high_luminance_fraction: NaN } },
      { ...valid, image: { ...valid.image, image_dimensions: [512, 512] } },
      { ...valid, source_model_edited: true },
      { ...valid, camera: { ...valid.camera, framing_fit_attempts: 9 } },
      { ...valid, lighting: { ...valid.lighting, key_to_fill_energy_ratio: 123 } },
      { ...valid, lighting: { ...valid.lighting, world: {
        ...valid.lighting.world,
        background_color_role: "HDRI_FALLBACK_UNUSED",
      } } },
      { ...valid, camera: { ...valid.camera, projected_hull_area: 0.9 } },
      { ...valid, image: { ...valid.image,
        projected_frame_roi: { ...valid.image.projected_frame_roi,
          bounds_ndc: [0.02, 0.02, 0.5, 0.5] } } },
      { ...valid, preview: { ...valid.preview, artistic_approval: true } },
      { ...valid, preview: { ...valid.preview, dimensions: [4096, 4096] } },
      { ...valid, preview: { ...valid.preview, source: "GENERATED_AI_IMAGE" } },
    ]) {
      expect(publicationDiagnosticsSchema.safeParse(broken).success).toBe(false);
    }
  });
});
