import { z } from "zod";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";

/**
 * Presentation rendering is deliberately separate from Bedrock render_profile,
 * visual QA capture and native model persistence.
 */
export const publicationRenderParameters = z.object({
  blender_executable: z.string().min(1).max(1024).refine(isAbsoluteFilesystemPath, {
    message: "Select an absolute, installed Blender executable path.",
  }),
  output_path: z.string().min(5).max(2048).refine(
    (value) => isAbsoluteFilesystemPath(value) && /\.png$/i.test(value),
    "Select an absolute .png output file.",
  ),
  quality: z.enum(["preview", "publication", "high"]).default("publication"),
  width: z.number().int().min(256).max(4096).default(2048),
  height: z.number().int().min(256).max(4096).default(2048),
  background: z.enum(["dark", "light", "transparent"]).default("dark"),
  camera: z.object({
    yaw_degrees: z.number().finite().min(-180).max(180).default(38),
    elevation_degrees: z.number().finite().min(-30).max(80).default(18),
    projection: z.enum(["perspective", "orthographic"]).default("perspective"),
  }).default({}),
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
  output_path: string;
  width: number;
  height: number;
  quality: PublicationRenderRequest["quality"];
  background: PublicationRenderRequest["background"];
  camera: PublicationRenderRequest["camera"];
  samples: number;
  noise_threshold: number;
  materials: Record<string, {
    color_uuid: string;
    texture_sha256: string;
    alpha_mode: "OPAQUE" | "MASK" | "BLEND";
    pbr: "NONE" | "UNSUPPORTED";
  }>;
};

export function makePublicationJob(
  request: PublicationRenderRequest,
  source: { project_uuid: string; sha256: string; glb_path: string; materials: PublicationJob["materials"] },
): PublicationJob {
  const quality = PUBLICATION_QUALITY[request.quality];
  return {
    schema_version: 1,
    source_project_uuid: source.project_uuid,
    source_sha256: source.sha256,
    glb_path: source.glb_path,
    output_path: request.output_path,
    width: request.width,
    height: request.height,
    quality: request.quality,
    background: request.background,
    camera: request.camera,
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
