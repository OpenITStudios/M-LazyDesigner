import { z } from "zod";
import { textureRevisionSchema } from "./evidence";
import type {
  ClusterCompositionInput,
  ClusterNativeFace,
} from "./clusterComposition";

/**
 * Canonical compact author intent for future existing-capability integration.
 * The AI NEVER provides native Cube inventories, UV maps or raw RGBA. Those
 * are resolved by the existing native texture owner at the time of execution.
 *
 * INTERNAL ONLY: no public Runtime/Gateway registration or generated API
 * change is authorized by this source schema alone.
 */
const name = z.string().trim().min(1).max(128);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/,
  "Exact opaque #RRGGBB color is required.");
const natural = z.number().int().nonnegative();
const positive = z.number().int().positive();
const localRect = z.object({
  kind: z.literal("rect"),
  x: natural, y: natural, width: positive, height: positive,
}).strict();
const localRun = z.object({
  x: natural, y: natural, width: positive,
}).strict();
const localRuns = z.object({
  kind: z.literal("runs"),
  runs: z.array(localRun).min(1).max(128),
}).strict();
const clusterShape = z.discriminatedUnion("kind", [localRect, localRuns]);
const faceName = z.enum(["north", "south", "east", "west", "up", "down"]);

const cluster = z.object({
  cluster_id: name,
  role: z.enum(["shadow", "highlight", "accent", "identity", "detail"]),
  shape: clusterShape,
  source_observation_id: name,
  expected_source_colors: z.array(hex).min(1).max(8).optional(),
}).strict();
const face = z.object({
  cube_uuid: name,
  face: faceName,
  source_claim: z.object({
    image_id: name,
    image_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    image_region_id: name,
    part_id: name,
    observation_id: name,
  }).strict(),
  clusters: z.array(cluster).min(1).max(16),
  quiet_zones: z.array(clusterShape).max(16).optional(),
}).strict();
const palette = z.object({
  base: hex,
  shadow: hex.optional(),
  highlight: hex.optional(),
  accent: hex.optional(),
  identity: hex.optional(),
  detail: hex.optional(),
}).strict();

/**
 * Strict authoring request, ready to become an existing Runtime capability
 * branch only once its canonical generator and descriptor are available.
 */
export const nativeClusterAuthoringRequestSchema = z.object({
  texture_id: name,
  expected_revision: textureRevisionSchema,
  faces: z.array(face).min(1).max(16),
  palette,
  source_mode: z.enum([
    "transparent_template",
    "uniform_opaque_template",
    "existing_painted_patch",
  ]),
}).strict().superRefine((request, ctx) => {
  const ids = new Set<string>();
  let count = 0;
  for (const [index, item] of request.faces.entries()) {
    const faceId = item.cube_uuid + ":" + item.face;
    if (ids.has(faceId)) {
      ctx.addIssue({
        code: "custom", path: ["faces", index],
        message: "CLUSTER_REQUEST_DUPLICATE_FACE",
      });
    }
    ids.add(faceId);
    const clusterIds = new Set<string>();
    for (const [clusterIndex, entry] of item.clusters.entries()) {
      count++;
      if (clusterIds.has(entry.cluster_id) ||
          entry.source_observation_id !== item.source_claim.observation_id) {
        ctx.addIssue({
          code: "custom", path: ["faces", index, "clusters", clusterIndex],
          message: "CLUSTER_REQUEST_OBSERVATION_OR_ID_MISMATCH",
        });
      }
      clusterIds.add(entry.cluster_id);
      const before = entry.expected_source_colors;
      if (request.source_mode === "existing_painted_patch") {
        if (!before || new Set(before.map(x => x.toLowerCase())).size !== before.length) {
          ctx.addIssue({
            code: "custom",
            path: ["faces", index, "clusters", clusterIndex, "expected_source_colors"],
            message: "CLUSTER_PATCH_EXPECTED_SOURCE_COLORS_REQUIRED",
          });
        }
      } else if (before !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["faces", index, "clusters", clusterIndex, "expected_source_colors"],
          message: "CLUSTER_REQUEST_SOURCE_COLORS_NOT_FOR_TEMPLATE",
        });
      }
      if (!request.palette[entry.role]) {
        ctx.addIssue({
          code: "custom",
          path: ["palette", entry.role],
          message: "CLUSTER_REQUEST_ROLE_PALETTE_MISSING",
        });
      }
    }
  }
  if (count > 48) {
    ctx.addIssue({
      code: "custom", path: ["faces"],
      message: "CLUSTER_REQUEST_TOTAL_CLUSTER_BUDGET",
    });
  }
});

export type NativeClusterAuthoringRequest =
  z.infer<typeof nativeClusterAuthoringRequestSchema>;

export type ResolvedNativeClusterSource = Readonly<{
  texture_uuid: string;
  bitmap: Uint8ClampedArray;
  bitmap_width: number;
  bitmap_height: number;
  logical_uv_width: number;
  logical_uv_height: number;
  native_faces: readonly ClusterNativeFace[];
}>;

/**
 * Pure adapter from compact author intent + TRUTHFUL native readback to the
 * existing cluster compiler. No source state or approval is inferred.
 */
export function materializeNativeClusterCompositionInput(
  raw: unknown,
  native: ResolvedNativeClusterSource
): ClusterCompositionInput {
  const request = nativeClusterAuthoringRequestSchema.parse(raw);
  if (!native || typeof native.texture_uuid !== "string" ||
      !native.texture_uuid.trim() ||
      !Number.isSafeInteger(native.bitmap_width) ||
      !Number.isSafeInteger(native.bitmap_height) ||
      native.bitmap_width < 1 || native.bitmap_height < 1 ||
      native.bitmap_width * native.bitmap_height > 1_048_576 ||
      !(native.bitmap instanceof Uint8ClampedArray) ||
      native.bitmap.length !== native.bitmap_width * native.bitmap_height * 4 ||
      !Number.isFinite(native.logical_uv_width) ||
      !Number.isFinite(native.logical_uv_height) ||
      native.logical_uv_width <= 0 || native.logical_uv_height <= 0 ||
      !Array.isArray(native.native_faces) ||
      native.native_faces.length < 1 ||
      native.native_faces.length > 1536) {
    throw new Error("CLUSTER_REQUEST_NATIVE_SOURCE_UNAVAILABLE");
  }
  // The texture name/ID is resolved by the native Runtime before this call.
  // The output always pins its *resolved UUID*, never the caller's display name.
  return {
    texture_uuid: native.texture_uuid,
    expected_revision: request.expected_revision,
    bitmap: native.bitmap,
    bitmap_width: native.bitmap_width,
    bitmap_height: native.bitmap_height,
    logical_uv_width: native.logical_uv_width,
    logical_uv_height: native.logical_uv_height,
    native_faces: native.native_faces,
    faces: request.faces,
    palette: request.palette,
    source_mode: request.source_mode,
  };
}
