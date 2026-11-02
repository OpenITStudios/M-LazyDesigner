import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
  type FaceTexturePixelMapping,
  type TexturePixelMetrics,
} from "../uv/facePixelMapping";
import {
  planFaceScopedTextureSelection,
  type NativeFaceFootprint,
} from "./selectionPlanning";
import {
  applyPaintTransactionRgba,
  type PaintTransactionOperation,
} from "./paintTransaction";
import {
  computeTextureRevision,
  requireTextureRevisionMatch,
} from "./revision";
import type { TextureTreatmentFace } from "./treatmentPlan";

/**
 * One material's explicitly authored face-local pixel clusters, compiled to
 * EXISTING paint_texture_transaction.operations (one native Undo).
 *
 * This pure source-side compiler does NOT examine reference images, attest an
 * approved artist choice, or revalidate live Cube/UV ownership at mutation.
 * The caller must obtain a fresh native inventory, preserve the complete
 * transaction's exact texture revision, and verify mapped views after painting.
 */
export type ClusterPixelRole =
  | "shadow" | "highlight" | "accent" | "identity" | "detail";

export type ClusterRun = Readonly<{
  x: number;
  y: number;
  width: number;
}>;

export type ClusterShape =
  | Readonly<{ kind: "rect"; x: number; y: number; width: number; height: number }>
  | Readonly<{ kind: "runs"; runs: readonly ClusterRun[] }>;

export type ReferenceClusterClaim = Readonly<{
  image_id: string;
  image_sha256: string;
  image_region_id: string;
  part_id: string;
  observation_id: string;
}>;

export type ReferencePixelCluster = Readonly<{
  cluster_id: string;
  role: ClusterPixelRole;
  shape: ClusterShape;
  /** A concrete, face-bound source observation, not a style guess. */
  source_observation_id: string;
}>;

export type ClusterFaceAuthoring = Readonly<TextureTreatmentFace & {
  source_claim: ReferenceClusterClaim;
  clusters: readonly ReferencePixelCluster[];
  /** Protected from 'detail' clusters only. Shading/identity may be intentional. */
  quiet_zones?: readonly ClusterShape[];
}>;

export type ClusterNativeFace = Readonly<NativeFaceFootprint & {
  /** Native CubeFace UV corners and quarter-turn, not an image crop. */
  uv: readonly number[] | null;
  rotation: number | null;
}>;

export type ClusterPalette = Readonly<{
  base: string;
  shadow?: string;
  highlight?: string;
  accent?: string;
  identity?: string;
  detail?: string;
}>;

export type ClusterCompositionInput = Readonly<{
  texture_uuid: string;
  expected_revision: string;
  bitmap: Uint8ClampedArray;
  bitmap_width: number;
  bitmap_height: number;
  logical_uv_width: number;
  logical_uv_height: number;
  /** Must be the current complete native Cube-face inventory for the asset. */
  native_faces: readonly ClusterNativeFace[];
  faces: readonly ClusterFaceAuthoring[];
  palette: ClusterPalette;
  /**
   * Transparent = all selected alpha must be zero.
   * Uniform = all selected pixels must be the same opaque RGB.
   * Never overwrite an already-detailed atlas by default.
   */
  source_mode: "transparent_template" | "uniform_opaque_template";
}>;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const MAX_FACES = 16;
const MAX_CLUSTERS = 48;
const MAX_SHAPES_PER_FACE = 16;
const MAX_SHAPE_RUNS = 128;
const MAX_PAINT_PIXELS = 8192;
const MAX_INVENTORY_FACES = 1536;
const MAX_ATLAS_PIXELS = 1048576;

function faceId(face: TextureTreatmentFace): string {
  return face.cube_uuid + ":" + face.face;
}

function boundedName(name: unknown): boolean {
  return typeof name === "string" && name.trim().length > 0 &&
    name.length <= 128;
}

function requireBounds(
  x: number, y: number, width: number, height: number,
  faceWidth: number, faceHeight: number, context: string
): void {
  if (![x, y, width, height].every(Number.isSafeInteger) ||
      x < 0 || y < 0 || width < 1 || height < 1 ||
      x + width > faceWidth || y + height > faceHeight) {
    throw new Error("CLUSTER_SHAPE_OUT_OF_BOUNDS: " + context);
  }
}

/** Local pixel enumeration is small and intentional; no random speckle. */
function shapePixels(
  shape: ClusterShape,
  width: number,
  height: number,
  context: string
): number[] {
  if (!shape || (shape.kind !== "rect" && shape.kind !== "runs")) {
    throw new Error("CLUSTER_SHAPE_UNSUPPORTED: " + context);
  }
  const indices = new Set<number>();
  const append = (x: number, y: number, w: number, h: number) => {
    requireBounds(x, y, w, h, width, height, context);
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        indices.add(row * width + col);
        if (indices.size > MAX_PAINT_PIXELS) {
          throw new Error("CLUSTER_PIXEL_BUDGET: " + context);
        }
      }
    }
  };
  if (shape.kind === "rect") {
    append(shape.x, shape.y, shape.width, shape.height);
  } else {
    if (!Array.isArray(shape.runs) || shape.runs.length < 1 ||
        shape.runs.length > MAX_SHAPE_RUNS) {
      throw new Error("CLUSTER_RUN_BUDGET: " + context);
    }
    for (const run of shape.runs) {
      if (!run) throw new Error("CLUSTER_RUN_INVALID: " + context);
      append(run.x, run.y, run.width, 1);
    }
  }
  // Every authored cluster is a single connected 4-neighbor mass. Deliberate
  // separate glints should be authored as separate, source-observed clusters.
  if (indices.size > 1) {
    const start = indices.values().next().value as number;
    const visited = new Set<number>([start]);
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const pixel = queue[qi];
      const x = pixel % width, y = Math.floor(pixel / width);
      const neighbors = [
        ...(x > 0 ? [pixel - 1] : []),
        ...(x + 1 < width ? [pixel + 1] : []),
        ...(y > 0 ? [pixel - width] : []),
        ...(y + 1 < height ? [pixel + width] : []),
      ];
      for (const neighbor of neighbors) {
        if (indices.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (visited.size !== indices.size) {
      throw new Error("CLUSTER_DISCONNECTED: " + context);
    }
  }
  return [...indices].sort((a, b) => a - b);
}

function requireReferenceClaim(claim: ReferenceClusterClaim): void {
  if (!claim || !boundedName(claim.image_id) ||
      !boundedName(claim.image_region_id) ||
      !boundedName(claim.part_id) ||
      !boundedName(claim.observation_id) ||
      typeof claim.image_sha256 !== "string" ||
      !DIGEST.test(claim.image_sha256)) {
    throw new Error("CLUSTER_REFERENCE_CLAIM_INVALID");
  }
}

function requirePalette(palette: ClusterPalette): void {
  if (!palette || !COLOR.test(palette.base)) {
    throw new Error("CLUSTER_PALETTE_BASE_REQUIRED");
  }
  for (const color of Object.values(palette)) {
    if (color !== undefined && (typeof color !== "string" ||
        !COLOR.test(color))) {
      throw new Error("CLUSTER_PALETTE_COLOR_INVALID");
    }
  }
}

function requireDistinctAtlasFaces(
  targets: readonly ClusterNativeFace[],
  mappings: ReadonlyMap<string, FaceTexturePixelMapping>
): void {
  for (let i = 0; i < targets.length; i++) {
    const a = mappings.get(faceId(targets[i]))!.rect;
    for (let j = i + 1; j < targets.length; j++) {
      const b = mappings.get(faceId(targets[j]))!.rect;
      if (a[0] < b[2] && b[0] < a[2] &&
          a[1] < b[3] && b[1] < a[3]) {
        // Do not author different style intentions onto one shared texel,
        // even if the existing face-scope selection permits exact UV reuse.
        throw new Error("CLUSTER_SHARED_UV_REVIEW_REQUIRED");
      }
    }
  }
}

export async function compileReferencePixelClusterPaint(
  input: ClusterCompositionInput
) {
  const width = input.bitmap_width, height = input.bitmap_height;
  if (!boundedName(input.texture_uuid) ||
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > MAX_ATLAS_PIXELS ||
      !(input.bitmap instanceof Uint8ClampedArray) ||
      input.bitmap.length !== width * height * 4) {
    throw new Error("CLUSTER_ATLAS_INVALID");
  }
  if (!/^sha256:\d+x\d+:[a-f0-9]{64}$/.test(input.expected_revision)) {
    throw new Error("CLUSTER_ATLAS_REVISION_REQUIRED");
  }
  if (!Array.isArray(input.native_faces) ||
      input.native_faces.length < 1 ||
      input.native_faces.length > MAX_INVENTORY_FACES ||
      !Array.isArray(input.faces) || input.faces.length < 1 ||
      input.faces.length > MAX_FACES ||
      (input.source_mode !== "transparent_template" &&
       input.source_mode !== "uniform_opaque_template")) {
    throw new Error("CLUSTER_INVENTORY_OR_MODE_INVALID");
  }
  requirePalette(input.palette);
  // Snapshot caller-owned pixels before the asynchronous SHA-256 operation.
  // A mutable input buffer must never alter the verified source used for
  // template inspection, preview or the output transaction plan.
  const sourceBitmap = new Uint8ClampedArray(input.bitmap);
  const actualRevision = await computeTextureRevision(sourceBitmap, width, height);
  requireTextureRevisionMatch(input.expected_revision, actualRevision,
    "Cluster composition atlas");

  const metrics: TexturePixelMetrics = {
    width, displayHeight: height,
    uvWidth: input.logical_uv_width,
    uvHeight: input.logical_uv_height,
  };
  const native = new Map<string, ClusterNativeFace>();
  const mapping = new Map<string, FaceTexturePixelMapping>();
  const footprints: NativeFaceFootprint[] = [];
  for (const face of input.native_faces) {
    if (!face || !boundedName(face.cube_uuid) ||
        !FACE_KEYS.includes(face.face) ||
        typeof face.enabled !== "boolean" ||
        typeof face.native_material_name !== "string" ||
        face.native_material_name.length > 128 ||
        (face.texture_uuid !== null &&
          !boundedName(face.texture_uuid))) {
      throw new Error("CLUSTER_NATIVE_FACE_INVALID");
    }
    const key = faceId(face);
    if (native.has(key)) throw new Error("CLUSTER_NATIVE_FACE_DUPLICATE");
    native.set(key, face);
    let rect: readonly [number, number, number, number] | null = null;
    if (face.enabled && face.texture_uuid === null) {
      throw new Error("CLUSTER_NATIVE_TEXTURE_UNRESOLVED: " + key);
    }
    if (face.enabled && face.texture_uuid === input.texture_uuid) {
      if (!face.uv || face.rotation === null) {
        throw new Error("CLUSTER_NATIVE_UV_UNAVAILABLE: " + key);
      }
      const current = mapFaceUvToTexturePixels(face.uv, metrics, key);
      // Includes quarter-turn and exact physical texel alignment guards.
      faceLocalPixelSize(current, face.rotation, key);
      mapping.set(key, current);
      rect = current.rect;
      if (face.rect && face.rect.some((value, index) =>
        value !== rect![index])) {
        throw new Error("CLUSTER_NATIVE_UV_RECT_MISMATCH: " + key);
      }
    }
    footprints.push({
      cube_uuid: face.cube_uuid,
      face: face.face,
      enabled: face.enabled,
      texture_uuid: face.texture_uuid,
      native_material_name: face.native_material_name,
      rect,
    });
  }

  const cubeFaceSets = new Map<string, Set<string>>();
  for (const item of input.native_faces) {
    const found = cubeFaceSets.get(item.cube_uuid) ?? new Set<string>();
    found.add(item.face);
    cubeFaceSets.set(item.cube_uuid, found);
  }
  for (const faceSet of cubeFaceSets.values()) {
    if (faceSet.size !== FACE_KEYS.length ||
        FACE_KEYS.some(face => !faceSet.has(face))) {
      throw new Error("CLUSTER_NATIVE_FACE_INVENTORY_INCOMPLETE");
    }
  }

  const targetIds = new Set<string>();
  const targetBindings: ClusterNativeFace[] = [];
  const targetFaces: TextureTreatmentFace[] = [];
  for (const plan of input.faces) {
    if (!plan || !boundedName(plan.cube_uuid) ||
        !FACE_KEYS.includes(plan.face)) {
      throw new Error("CLUSTER_FACE_TARGET_INVALID");
    }
    requireReferenceClaim(plan.source_claim);
    const key = faceId(plan);
    if (targetIds.has(key)) throw new Error("CLUSTER_FACE_TARGET_DUPLICATE");
    targetIds.add(key);
    const binding = native.get(key);
    if (!binding?.enabled ||
        binding.texture_uuid !== input.texture_uuid ||
        !mapping.has(key)) {
      throw new Error("CLUSTER_FACE_TARGET_UNRESOLVED: " + key);
    }
    targetBindings.push(binding);
    targetFaces.push({ cube_uuid: plan.cube_uuid, face: plan.face });
  }

  const scope = planFaceScopedTextureSelection({
    texture_uuid: input.texture_uuid,
    bitmap_width: width,
    bitmap_height: height,
    faces: footprints,
    face_targets: targetFaces,
  });
  requireDistinctAtlasFaces(targetBindings, mapping);
  if (scope.covered_pixels > MAX_PAINT_PIXELS) {
    throw new Error("CLUSTER_PIXEL_BUDGET");
  }

  // A source template must be either transparent or genuinely flat before
  // overwriting it. Partial alpha, previously detailed painting and hidden
  // shared texels are out of scope for this initial cluster authoring path.
  let firstOpaqueRgb: string | null = null;
  for (let row = 0; row < scope.target_rect.height; row++) {
    for (let col = 0; col < scope.target_rect.width; col++) {
      if (!scope.target_mask[row * scope.target_rect.width + col]) continue;
      const offset = ((scope.target_rect.y + row) * width +
        scope.target_rect.x + col) * 4;
      const alpha = sourceBitmap[offset + 3];
      if (input.source_mode === "transparent_template") {
        if (alpha !== 0) throw new Error("CLUSTER_SOURCE_NOT_TRANSPARENT");
      } else {
        if (alpha !== 255) throw new Error("CLUSTER_SOURCE_NOT_OPAQUE");
        const rgb = [sourceBitmap[offset], sourceBitmap[offset + 1],
          sourceBitmap[offset + 2]].join(":");
        if (firstOpaqueRgb !== null && firstOpaqueRgb !== rgb) {
          throw new Error("CLUSTER_SOURCE_ALREADY_DETAILED");
        }
        firstOpaqueRgb = rgb;
      }
    }
  }

  const operations: PaintTransactionOperation[] = [];
  const observed: Array<{ face: string; source: ReferenceClusterClaim;
    clusters: number; quiet_pixels: number }> = [];
  let totalClusters = 0, detailPixels = 0, identityPixels = 0;
  for (const plan of input.faces) {
    const key = faceId(plan);
    const current = mapping.get(key)!;
    const binding = native.get(key)!;
    const [localWidth, localHeight] = faceLocalPixelSize(
      current, binding.rotation!, key
    );
    if (!Array.isArray(plan.clusters) || plan.clusters.length < 1 ||
        plan.clusters.length > MAX_SHAPES_PER_FACE ||
        !Array.isArray(plan.quiet_zones ?? []) ||
        (plan.quiet_zones?.length ?? 0) > MAX_SHAPES_PER_FACE) {
      throw new Error("CLUSTER_FACE_SHAPE_BUDGET: " + key);
    }
    totalClusters += plan.clusters.length;
    if (totalClusters > MAX_CLUSTERS) throw new Error("CLUSTER_TOTAL_BUDGET");

    const quiet = new Set<number>();
    for (const [index, shape] of (plan.quiet_zones ?? []).entries()) {
      for (const pixel of shapePixels(shape, localWidth, localHeight,
        key + ".quiet[" + index + "]")) quiet.add(pixel);
    }
    const owned = new Set<number>();
    const ids = new Set<string>();
    const colorGroups = new Map<string, { color: string;
      coordinates: Array<{ x: number; y: number }> }>();
    for (const [index, cluster] of plan.clusters.entries()) {
      if (!cluster || !boundedName(cluster.cluster_id) ||
          !boundedName(cluster.source_observation_id) ||
          cluster.source_observation_id !== plan.source_claim.observation_id ||
          ids.has(cluster.cluster_id) ||
          !["shadow", "highlight", "accent", "identity", "detail"]
            .includes(cluster.role)) {
        throw new Error("CLUSTER_INTENT_INVALID: " + key);
      }
      ids.add(cluster.cluster_id);
      const color = input.palette[cluster.role];
      if (typeof color !== "string" || !COLOR.test(color)) {
        throw new Error("CLUSTER_ROLE_COLOR_REQUIRED: " + cluster.role);
      }
      const pixels = shapePixels(cluster.shape, localWidth, localHeight,
        key + "." + cluster.cluster_id);
      for (const pixel of pixels) {
        if (owned.has(pixel)) {
          throw new Error("CLUSTER_OVERLAPPING_INTENTS: " + key);
        }
        if (cluster.role === "detail" && quiet.has(pixel)) {
          throw new Error("CLUSTER_QUIET_ZONE_DETAIL: " + key);
        }
        owned.add(pixel);
        if (cluster.role === "detail") detailPixels++;
        if (cluster.role === "identity") identityPixels++;
        const localX = pixel % localWidth, localY =
          Math.floor(pixel / localWidth);
        const atlas = mapFaceLocalPixelToAtlasPixel(
          current, binding.rotation!, localX, localY, key
        );
        let group = colorGroups.get(color.toLowerCase());
        if (!group) {
          group = { color, coordinates: [] };
          colorGroups.set(color.toLowerCase(), group);
        }
        group.coordinates.push(atlas);
      }
    }
    const [left, top, right, bottom] = current.rect;
    operations.push({
      operation: "fill_rect",
      color: input.palette.base,
      rect: { x: left, y: top, width: right - left,
        height: bottom - top },
    });
    for (const group of colorGroups.values()) {
      operations.push({
        operation: "set_pixels", color: group.color,
        coordinates: group.coordinates,
      });
    }
    observed.push({
      face: key, source: { ...plan.source_claim },
      clusters: plan.clusters.length, quiet_pixels: quiet.size,
    });
  }
  if (operations.length < 1 || operations.length > 64) {
    throw new Error("CLUSTER_TRANSACTION_OPERATION_BUDGET");
  }

  // This preflight uses the canonical existing bitmap operation executor.
  // It proves a bounded proposed result for an immutable source snapshot,
  // not a live native or approved reference-to-surface correspondence.
  const proposed = applyPaintTransactionRgba(sourceBitmap, width, height,
    operations);
  let changedPixels = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    if (sourceBitmap[offset] === proposed.pixels[offset] &&
        sourceBitmap[offset + 1] === proposed.pixels[offset + 1] &&
        sourceBitmap[offset + 2] === proposed.pixels[offset + 2] &&
        sourceBitmap[offset + 3] === proposed.pixels[offset + 3]) continue;
    const x = pixel % width, y = Math.floor(pixel / width);
    const localX = x - scope.target_rect.x;
    const localY = y - scope.target_rect.y;
    if (localX < 0 || localY < 0 ||
        localX >= scope.target_rect.width ||
        localY >= scope.target_rect.height ||
        scope.target_mask[localY * scope.target_rect.width + localX] !== 1) {
      throw new Error("CLUSTER_PAINT_LEAKED_OUTSIDE_OWNED_FACES");
    }
    changedPixels++;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (changedPixels === 0) {
    throw new Error("CLUSTER_PAINT_NO_CHANGE");
  }
  const changedRect = [minX, minY, maxX + 1, maxY + 1] as const;
  return {
    state: "source_compiled_needs_native_revalidation" as const,
    transaction: {
      texture_id: input.texture_uuid,
      expected_revision: actualRevision,
      operations,
    },
    source_scope: observed,
    summary: {
      face_count: targetFaces.length,
      cluster_count: totalClusters,
      quiet_zone_count: input.faces.reduce((n, face) =>
        n + (face.quiet_zones?.length ?? 0), 0),
      detail_pixels: detailPixels,
      identity_pixels: identityPixels,
      covered_face_pixels: scope.covered_pixels,
      changed_pixels: changedPixels,
      changed_rect: changedRect,
    },
    provenance: {
      reference_claims: "CALLER_DECLARED_NOT_IMAGE_ATTESTED" as const,
      native_inventory: "CALLER_SNAPSHOT_NOT_RECHECKED" as const,
      mutation_authorized: false as const,
      visual_verdict: "not_evaluated" as const,
    },
    note: "Source plan only. Recheck current Cube/UV/material bindings in the live project before passing operations to paint_texture_transaction; that tool's exact-operations branch verifies bitmap revision but does NOT independently attest face ownership.",
  };
}
