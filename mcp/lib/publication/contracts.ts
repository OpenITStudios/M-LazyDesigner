import { z } from "zod";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import { dirname, join } from "node:path";
import { publicationEnvironmentSchema, type PublicationEnvironmentJob } from "@/lib/publication/environment";

/**
 * Presentation rendering is deliberately separate from Bedrock render_profile,
 * visual QA capture and native model persistence.
 */
export const publicationRenderParameters = z.object({
  blender_executable: z.string().min(1).max(1024).refine(
    (value) => isAbsoluteFilesystemPath(value) &&
      /(?:^|[\\/])blender(?:\.exe)?$/i.test(value) &&
      !/[\x00-\x1f]/.test(value), {
      message: "Select an absolute installed Blender executable (blender or blender.exe).",
    }),
  output_path: z.string().min(5).max(2048).refine(
    (value) => isAbsoluteFilesystemPath(value) && /\.png$/i.test(value) &&
      !/[\x00-\x1f]/.test(value) && !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value),
    "Select an absolute .png output file.",
  ),
  quality: z.enum(["preview", "publication", "high"]).default("publication"),
  width: z.number().int().min(256).max(4096).default(2048),
  height: z.number().int().min(256).max(4096).default(2048),
  background: z.enum(["dark", "light", "transparent"]).default("dark"),
  environment: publicationEnvironmentSchema.default({ mode: "studio" }),
  device: z.enum(["auto", "cpu"]).default("auto"),
  view_transform: z.enum(["AgX", "Standard"]).default("AgX"),
  camera: z.object({
    mode: z.enum(["auto", "manual"]).default("auto"),
    framing_padding: z.number().finite().min(1.08).max(2.2).default(1.28),
    yaw_degrees: z.number().finite().min(-180).max(180).default(38),
    elevation_degrees: z.number().finite().min(-30).max(80).default(18),
    projection: z.enum(["perspective", "orthographic"]).default("perspective"),
  }).default({
    yaw_degrees: 38, elevation_degrees: 18, projection: "perspective",
    mode: "auto", framing_padding: 1.28,
  }),
  // Lighting is scene-wide, not selected by object type or asset category.
  look: z.object({
    key: z.number().finite().min(0.2).max(2.5).default(1),
    fill: z.number().finite().min(0).max(2).default(1),
    rim: z.number().finite().min(0).max(2).default(1),
    softness: z.number().finite().min(0.5).max(2.5).default(1),
    environment: z.number().finite().min(0).max(2).default(1),
    exposure_ev: z.number().finite().min(-3).max(3).default(0),
    glow_strength: z.number().finite().min(0).max(0.35).default(0.08),
    glow_threshold: z.number().finite().min(0.5).max(20).default(2),
    glow_size: z.number().finite().min(0.1).max(0.8).default(0.45),
  }).strict().default({
    key: 1, fill: 1, rim: 1, softness: 1, environment: 1, exposure_ev: 0,
    glow_strength: 0.08, glow_threshold: 2, glow_size: 0.45,
  }),
  overwrite: z.literal(false).optional().default(false),
}).strict().superRefine((input, context) => {
  if (input.width * input.height > 12_000_000) {
    context.addIssue({ code: "custom", message: "Maximum output area is 12 megapixels." });
  }
  if (input.output_path === input.blender_executable) {
    context.addIssue({ code: "custom", message: "Output path cannot be the Blender executable." });
  }
});

export type PublicationRenderRequest = z.infer<typeof publicationRenderParameters>;

export const PUBLICATION_IMAGE_ASPECTS = {
  square: [1, 1],
  landscape_16_9: [16, 9],
  landscape_4_3: [4, 3],
  portrait_4_5: [4, 5],
} as const;
export type PublicationImageAspect = keyof typeof PUBLICATION_IMAGE_ASPECTS;

/** Output framing is a presentation setting, not a model/object category. */
export function publicationImageSizeForPreset(
  quality: PublicationRenderRequest["quality"],
  aspect: PublicationImageAspect,
): { width: number; height: number } {
  const sides = PUBLICATION_IMAGE_ASPECTS[aspect];
  if (!sides || !(quality in PUBLICATION_QUALITY)) {
    throw new Error("PUBLICATION_IMAGE_PRESET_INVALID");
  }
  const longestEdge = quality === "preview" ? 640 : quality === "high" ? 3200 : 2048;
  const [a, b] = sides;
  const width = Math.round(longestEdge * a / Math.max(a, b));
  const height = Math.round(longestEdge * b / Math.max(a, b));
  if (width < 256 || height < 256 || width * height > 12_000_000) {
    throw new Error("PUBLICATION_IMAGE_PRESET_OUTSIDE_PIXEL_BUDGET");
  }
  return { width, height };
}



export const PUBLICATION_QUALITY = Object.freeze({
  preview: { samples: 32, noise_threshold: 0.08 },
  publication: { samples: 128, noise_threshold: 0.02 },
  high: { samples: 256, noise_threshold: 0.01 },
} as const);

export type PublicationJob = {
  schema_version: 1;
  source_project_uuid: string;
  source_sha256: string;
  glb_path: string;
  report_path: string;
  preview_path: string;
  environment: PublicationEnvironmentJob;
  device: PublicationRenderRequest["device"];
  view_transform: PublicationRenderRequest["view_transform"];
  expected_mesh_count: number;
  expected_material_count: number;
  output_path: string;
  width: number;
  height: number;
  quality: PublicationRenderRequest["quality"];
  background: PublicationRenderRequest["background"];
  camera: PublicationRenderRequest["camera"];
  look: PublicationRenderRequest["look"];
  samples: number;
  noise_threshold: number;
  materials: Record<string, {
    color_uuid: string;
    texture_sha256: string;
    alpha_mode: "OPAQUE" | "MASK" | "BLEND";
    pbr: "NONE" | "MAPPED";
    mer_sha256?: string;
    normal_sha256?: string;
    unused_alpha_pixels?: number;
  }>;
};

export function makePublicationJob(
  request: PublicationRenderRequest,
  source: {
    project_uuid: string; sha256: string; glb_path: string; mesh_count: number;
    materials: PublicationJob["materials"];
    environment_asset?: { path: string; sha256: string };
  },
): PublicationJob {
  const quality = PUBLICATION_QUALITY[request.quality];
  if (request.environment.mode === "hdri" && !source.environment_asset) {
    throw new Error("PUBLICATION_HDRI_ASSET_NOT_PREPARED");
  }
  const environment: PublicationEnvironmentJob = request.environment.mode === "hdri"
    ? {
      mode: "hdri",
      hdri_path: source.environment_asset!.path,
      hdri_sha256: source.environment_asset!.sha256,
    }
    : { mode: "studio", hdri_path: null, hdri_sha256: null };
  return {
    schema_version: 1,
    source_project_uuid: source.project_uuid,
    source_sha256: source.sha256,
    glb_path: source.glb_path,
    report_path: join(dirname(request.output_path), "report.json"),
    preview_path: join(dirname(request.output_path), "evidence.png"),
    environment,
    device: request.device,
    view_transform: request.view_transform,
    expected_mesh_count: source.mesh_count,
    expected_material_count: Object.keys(source.materials).length,
    output_path: request.output_path,
    width: request.width,
    height: request.height,
    quality: request.quality,
    background: request.background,
    camera: request.camera,
    look: request.look,
    samples: quality.samples,
    noise_threshold: quality.noise_threshold,
    materials: source.materials,
  };
}

export function blenderRenderArgs(workerPath: string, jobPath: string): string[] {
  if (!isAbsoluteFilesystemPath(workerPath) || !isAbsoluteFilesystemPath(jobPath)) {
    throw new Error("Render worker and job paths must be absolute.");
  }
  // No shell, no model-supplied Python, no user-supplied Blender CLI switches.
  return [
    "--background", "--factory-startup", "--disable-autoexec",
    "--python", workerPath, "--", jobPath,
  ];
}
