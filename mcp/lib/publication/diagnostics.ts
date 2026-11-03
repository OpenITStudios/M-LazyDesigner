import { z } from "zod";

/**
 * Blender Core observations are measured from the actual Cycles PNG and the
 * isolated imported scene. They are NOT an LLM quality score or QA approval.
 */
const boundedFloat = z.number().finite();
const unitFraction = boundedFloat.min(0).max(1);
const vector3 = z.tuple([boundedFloat, boundedFloat, boundedFloat]);
const vector4 = z.tuple([boundedFloat, boundedFloat, boundedFloat, boundedFloat]);

export const publicationDiagnosticsSchema = z.object({
  schema_version: z.literal(1),
  status: z.literal("RENDERED_DIAGNOSTICS_NOT_VISUAL_APPROVAL"),
  asset: z.object({
    mesh_count: z.number().int().min(1).max(10_000),
    polygon_count: z.number().int().min(1).max(10_000_000),
    vertex_count: z.number().int().min(1).max(10_000_000),
    material_count: z.number().int().min(1).max(128),
    world_min: vector3,
    world_max: vector3,
    bounding_radius: boundedFloat.positive(),
    source_fidelity_visual: z.literal("NOT_EVALUATED"),
  }).strict(),
  camera: z.object({
    mode: z.enum(["auto", "manual"]),
    requested_yaw_degrees: boundedFloat,
    requested_elevation_degrees: boundedFloat,
    resolved_yaw_degrees: boundedFloat,
    resolved_elevation_degrees: boundedFloat,
    projection: z.enum(["perspective", "orthographic"]),
    candidate_count: z.number().int().min(1).max(15),
    projected_bounds: vector4,
    projected_area: boundedFloat.min(0).max(1),
    projected_hull_area: boundedFloat.min(0).max(1),
    framing_fit_multiplier: boundedFloat.min(1).max(3),
    framing_fit_attempts: z.number().int().min(1).max(6),
    frame_safe: z.literal(true),
    quality_is_artistic_score: z.literal(false),
  }).strict(),
  lighting: z.object({
    world: z.object({
      background_color: vector4,
      background_color_role: z.enum([
        "ACTIVE_PROCEDURAL_WORLD", "HDRI_FALLBACK_UNUSED",
      ]),
      world_strength: boundedFloat.min(0).max(3),
    }).strict(),
    ground: z.object({
      mode: z.enum(["dark", "light", "transparent"]),
      shadow_catcher: z.boolean(),
      position_z: boundedFloat,
    }).strict(),
    lights: z.array(z.object({
      name: z.enum(["LD_Key", "LD_Fill", "LD_Rim"]),
      power: boundedFloat.min(0).max(50_000_000),
      size: boundedFloat.min(0.01),
      position: vector3,
      color_rgb: z.tuple([
        unitFraction, unitFraction, unitFraction,
      ]),
      distance_to_subject: boundedFloat.min(0),
    }).strict()).length(3),
    key_to_fill_energy_ratio: boundedFloat.min(0).nullable(),
    hdr_environment: z.enum(["NONE_BUNDLED", "USER_PROVIDED"]),
    hdri_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    source_geometry_edited: z.literal(false),
  }).strict(),
  compositor: z.object({
    node_group: z.string().min(1).max(128),
    highlight_glow_enabled: z.boolean(),
    glow_strength: unitFraction,
    glow_threshold: boundedFloat.min(0.5).max(20),
    pixel_art_filtering: z.literal("CLOSEST_IN_MATERIALS"),
    automatic_artistic_approval: z.literal(false),
  }).strict(),
  render: z.object({
    engine: z.literal("CYCLES"),
    view_transform: z.enum(["AgX", "Standard"]),
    sampling: z.object({
      samples: z.number().int().min(1).max(256),
      adaptive_threshold: boundedFloat.min(0).max(1),
      denoising: z.literal(true),
    }).strict(),
    device: z.object({
      requested: z.enum(["auto", "cpu"]),
      actual: z.enum(["CPU", "GPU"]),
      backend: z.enum(["OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"]).nullable(),
      fallback_reason: z.literal("GPU_RENDER_EXCEPTION").optional(),
    }).strict(),
    render_size: z.tuple([z.number().int().min(256).max(4096), z.number().int().min(256).max(4096)]),
  }).strict(),
  image: z.object({
    image_dimensions: z.tuple([z.number().int().min(256).max(4096), z.number().int().min(256).max(4096)]),
    sampled_pixels: z.number().int().min(1).max(20_000),
    visible_samples: z.number().int().min(1).max(20_000),
    mean_visible_luminance: boundedFloat.min(0),
    high_luminance_fraction: unitFraction,
    near_black_visible_fraction: unitFraction,
    nonopaque_fraction: unitFraction,
    analysis_type: z.literal("MEASURED_DOWNSAMPLED_CYCLES_PNG"),
    artistic_quality_score: z.null(),
    projected_frame_roi: z.object({
      source: z.literal("BLENDER_LOADED_CYCLES_PNG"),
      region_type: z.literal("PROJECTED_BOUNDS_RECT_NOT_SEGMENTATION"),
      bounds_ndc: vector4,
      sampled_pixels: z.number().int().min(1).max(20_000),
      visible_samples: z.number().int().min(1).max(20_000),
      mean_visible_luminance: boundedFloat.min(0),
      near_black_fraction: unitFraction,
      near_white_fraction: unitFraction,
      artistic_quality_score: z.null(),
    }).strict(),
  }).strict(),
  preview: z.object({
    dimensions: z.tuple([
      z.number().int().min(1).max(384),
      z.number().int().min(1).max(384),
    ]),
    source: z.literal("DOWNSAMPLED_FINAL_CYCLES_PNG"),
    artistic_approval: z.literal(false),
  }).strict(),
  warnings: z.array(z.string().min(1).max(256)).max(16),
  artistic_quality: z.literal("NOT_EVALUATED"),
  source_model_edited: z.literal(false),
}).strict().superRefine((data, ctx) => {
  if (data.asset.world_min.some((n, i) => n > data.asset.world_max[i]!)) {
    ctx.addIssue({ code: "custom", message: "Invalid source world bounds." });
  }
  if (data.image.image_dimensions[0] !== data.render.render_size[0] ||
      data.image.image_dimensions[1] !== data.render.render_size[1]) {
    ctx.addIssue({ code: "custom", message: "Measured PNG size differs from Cycles job." });
  }
  if ((data.lighting.hdr_environment === "USER_PROVIDED") !==
      (data.lighting.hdri_sha256 !== null)) {
    ctx.addIssue({ code: "custom", message: "HDRI light must have a verified source digest." });
  }
  const lightColors = data.lighting.lights;
  if (data.lighting.hdr_environment === "USER_PROVIDED" &&
      data.lighting.world.background_color_role !== "HDRI_FALLBACK_UNUSED") {
    ctx.addIssue({ code: "custom", message: "HDRI world color role is inconsistent." });
  }
  if (data.lighting.hdr_environment === "NONE_BUNDLED" &&
      data.lighting.world.background_color_role !== "ACTIVE_PROCEDURAL_WORLD") {
    ctx.addIssue({ code: "custom", message: "Procedural world color role is inconsistent." });
  }
  const keyLight = lightColors.find(light => light.name === "LD_Key");
  const fillLight = lightColors.find(light => light.name === "LD_Fill");
  const rimLight = lightColors.find(light => light.name === "LD_Rim");
  if (!keyLight || !fillLight || !rimLight ||
      fillLight.power <= 1e-6 && data.lighting.key_to_fill_energy_ratio !== null ||
      fillLight.power > 1e-6 && (
        data.lighting.key_to_fill_energy_ratio === null ||
        Math.abs(data.lighting.key_to_fill_energy_ratio -
          keyLight.power / fillLight.power) >
          Math.max(0.001, keyLight.power / fillLight.power * 1e-4)
      )) {
    ctx.addIssue({ code: "custom", message: "Reported three-light energy ratio is inconsistent." });
  }
  const device = data.render.device;
  if ((device.actual === "GPU") !== (device.backend !== null)) {
    ctx.addIssue({ code: "custom", message: "Rendered device/backend mismatch." });
  }
  if (device.fallback_reason && (
      device.requested !== "auto" || device.actual !== "CPU" ||
      device.backend !== null)) {
    ctx.addIssue({ code: "custom", message: "CPU fallback must be truthful." });
  }
  if (data.preview.dimensions[0] > data.image.image_dimensions[0] ||
      data.preview.dimensions[1] > data.image.image_dimensions[1]) {
    ctx.addIssue({ code: "custom", message: "Preview must never enlarge the Cycles PNG." });
  }
  const roi = data.image.projected_frame_roi;
  if (roi.bounds_ndc.some((value, i) =>
      Math.abs(value - data.camera.projected_bounds[i]!) > 0.05) ||
      roi.visible_samples > roi.sampled_pixels ||
      data.camera.projected_hull_area > data.camera.projected_area + 0.0001) {
    ctx.addIssue({ code: "custom", message: "Projected camera region/geometry metrics are inconsistent." });
  }
  if (data.camera.mode === "manual" && data.camera.candidate_count !== 1) {
    ctx.addIssue({ code: "custom", message: "Manual camera cannot search additional views." });
  }
});

export type PublicationDiagnostics = z.infer<typeof publicationDiagnosticsSchema>;

/** Keep tool output compact even when the worker has more detailed telemetry. */
export function compactPublicationDiagnostics(report: PublicationDiagnostics) {
  return {
    asset: {
      mesh_count: report.asset.mesh_count,
      polygon_count: report.asset.polygon_count,
      material_count: report.asset.material_count,
      world_min: report.asset.world_min,
      world_max: report.asset.world_max,
    },
    camera: report.camera,
    lights: report.lighting.lights,
    renderer: report.render,
    image: report.image,
    preview: report.preview,
    warnings: report.warnings,
    artistic_quality: "NOT_EVALUATED" as const,
  };
}
