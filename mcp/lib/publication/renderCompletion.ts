import { z } from "zod";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import { publicationDiagnosticsSchema } from "@/lib/publication/diagnostics";

/** Durable outcome for completed Gateway-owned renders, not for active jobs.
 * No process ID, credentials, or automatic resurrection after Gateway restart.
 */
export const BLENDER_COMPLETION_KIND = "lazydesigner.blender-completion.v1" as const;
export const BLENDER_COMPLETION_SUFFIX = ".lazydesigner.json";
export const BLENDER_PREVIEW_SUFFIX = ".lazydesigner.preview.png";
export const MAX_BLENDER_COMPLETION_BYTES = 96 * 1024;
export const MAX_BLENDER_PREVIEW_BYTES = 2_000_000;
export const MAX_BLENDER_PNG_BYTES = 96 * 1024 * 1024;

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const jobId = z.string().regex(/^blender_[a-f0-9]{24}$/);

export const blenderCompletionSchema = z.object({
  kind: z.literal(BLENDER_COMPLETION_KIND),
  schema_version: z.literal(1),
  job_id: jobId,
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  source_project_uuid: z.string().min(1).max(160),
  source_sha256: sha,
  source_manifest_sha256: sha,
  glb_sha256: sha,
  worker_sha256: sha,
  cube_count: z.number().int().min(1).max(10_000),
  material_count: z.number().int().min(1).max(128),
  request: publicationRenderParameters,
  output_png_sha256: sha,
  output_png_bytes: z.number().int().min(57).max(MAX_BLENDER_PNG_BYTES),
  preview_sha256: sha,
  preview_bytes: z.number().int().min(57).max(MAX_BLENDER_PREVIEW_BYTES),
  preview_dimensions: z.tuple([
    z.number().int().min(1).max(384),
    z.number().int().min(1).max(384),
  ]),
  diagnostics: publicationDiagnosticsSchema,
}).strict().superRefine((data, context) => {
  if (data.diagnostics.asset.mesh_count !== data.cube_count ||
      data.diagnostics.asset.material_count !== data.material_count ||
      data.diagnostics.image.image_dimensions[0] !== data.request.width ||
      data.diagnostics.image.image_dimensions[1] !== data.request.height ||
      data.diagnostics.preview.dimensions[0] !== data.preview_dimensions[0] ||
      data.diagnostics.preview.dimensions[1] !== data.preview_dimensions[1]) {
    context.addIssue({
      code: "custom",
      message: "Completion dimensions or source inventory do not match its measured Cycles report.",
    });
  }
});
export type BlenderCompletion = z.infer<typeof blenderCompletionSchema>;

export function blenderCompletionPaths(outputPath: string): {
  receipt_path: string;
  preview_path: string;
} {
  return {
    receipt_path: outputPath + BLENDER_COMPLETION_SUFFIX,
    preview_path: outputPath + BLENDER_PREVIEW_SUFFIX,
  };
}
