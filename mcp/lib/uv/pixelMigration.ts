import type { UvLayoutPlan, UvRect } from "@/lib/uv/contracts";
import {
  assertUvPlanSourceFresh,
  translateUvPlanToNativeInstructions,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import { requireValidUvLayoutPlan } from "@/lib/uv/validatePlan";
import { physicalPixelsPerUvUnit } from "@/lib/uv/density";
import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
  requireUvPhysicalPixelGrid,
} from "@/lib/uv/facePixelMapping";
import { diffTextureRegion } from "@/lib/texture/regionDiff";

/** Read-only bitmap input, prepared from an established native texture snapshot. */
export type UvMigrationAtlas = Readonly<{
  texture_uuid: string;
  width: number;
  height: number;
  /** Migration of native layer or animation state is not implemented. */
  layers_enabled: false;
  frame_count: 1;
  pixels: Uint8ClampedArray;
}>;

export type UvMigrationCandidate = {
  texture_uuid: string;
  /** A fresh buffer; neither the input atlas nor the native project is modified. */
  pixels: Uint8ClampedArray;
  changed_pixels: number;
  affected_rect: { x: number; y: number; width: number; height: number } | null;
};

export const UV_MIGRATION_MAX_BITMAP_PIXELS = 4_194_304;
export const UV_MIGRATION_MAX_FACE_PIXEL_VISITS = 1_048_576;
export const UV_MIGRATION_MAX_TEXTURES = 16;
export const UV_MIGRATION_MAX_TOTAL_RGBA_BYTES = 67_108_864;

function physicalRect(
  rect: UvRect,
  scale: readonly [number, number],
  width: number,
  height: number,
  context: string
): { x: number; y: number; width: number; height: number } {
  const boundaries: [number, number, number, number] = [
    rect.x, rect.y, rect.x + rect.width, rect.y + rect.height,
  ];
  requireUvPhysicalPixelGrid(boundaries, scale, context);
  const [x, y, right, bottom] = boundaries.map((value, index) =>
    Math.round(value * scale[index % 2])
  );
  if (
    ![x, y, right, bottom].every(Number.isSafeInteger) ||
    x < 0 || y < 0 || right <= x || bottom <= y ||
    right > width || bottom > height
  ) {
    throw new Error("UV_PIXEL_MIGRATION_BOUNDS: " + context +
      " must occupy complete texels inside the current bitmap.");
  }
  return { x, y, width: right - x, height: bottom - y };
}

function pixelOffset(x: number, y: number, width: number, height: number): number {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
      x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error("UV_PIXEL_MIGRATION_BOUNDS: a face mapping escaped the bitmap.");
  }
  return y * width + x;
}

function rgbaIsZero(pixels: Uint8ClampedArray, pixel: number): boolean {
  const byte = pixel * 4;
  return pixels[byte] === 0 && pixels[byte + 1] === 0 &&
    pixels[byte + 2] === 0 && pixels[byte + 3] === 0;
}

/**
 * Prepares an independent candidate for every established, flattened static
 * atlas (base color, variants and PBR) from one pinned UV snapshot.
 *
 * The native U7 adapter deliberately still refuses painted-atlas repacks:
 * this pure helper is NOT permission to commit both bitmap and UV changes.
 * A future atomic native adapter must prove snapshot revision, all-layer and
 * image+UV Undo scope, postconditions, rollback and visual parity first.
 */
export function prepareUvPixelMigration(input: {
  plan: UvLayoutPlan;
  native_before: UvNativeSourceSnapshot;
  expected_source_fingerprint: string;
  atlases: readonly UvMigrationAtlas[];
}): {
  state: "candidate_only";
  moved_island_ids: string[];
  relocated_pixel_count: number;
  coalesced_shared_writes: number;
  candidates: UvMigrationCandidate[];
  native_apply_attested: false;
  scene_ownership_attested: false;
  visual_verdict: "not_evaluated";
} {
  const { plan, native_before: before, atlases } = input;
  requireValidUvLayoutPlan(plan);
  assertUvPlanSourceFresh(input.expected_source_fingerprint, before);
  if (plan.moved_island_ids.length === 0) {
    throw new Error("UV_PIXEL_MIGRATION_NO_OP: no UV island needs relocation.");
  }
  if (before.logical_width !== plan.before.logical_width ||
      before.logical_height !== plan.before.logical_height) {
    throw new Error("UV_PIXEL_MIGRATION_LOGICAL_MISMATCH: current UV scale is stale.");
  }
  if (atlases.length === 0 || atlases.length > UV_MIGRATION_MAX_TEXTURES) {
    throw new Error("UV_PIXEL_MIGRATION_ATLAS_SCOPE: require 1..16 explicit mapped atlases.");
  }
  const width = atlases[0].width, height = atlases[0].height;
  const atlasPixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 ||
      !Number.isSafeInteger(atlasPixels) ||
      atlasPixels > UV_MIGRATION_MAX_BITMAP_PIXELS) {
    throw new Error("UV_PIXEL_MIGRATION_BITMAP_BUDGET: bitmap dimensions exceed the bounded lossless migration budget.");
  }
  if (atlasPixels * 4 * atlases.length > UV_MIGRATION_MAX_TOTAL_RGBA_BYTES) {
    throw new Error("UV_PIXEL_MIGRATION_BITMAP_BUDGET: total dependent RGBA snapshot bytes exceed the bounded candidate budget.");
  }
  const seen = new Set<string>();
  for (const atlas of atlases) {
    if (!atlas.texture_uuid || seen.has(atlas.texture_uuid) ||
        atlas.width !== width || atlas.height !== height ||
        atlas.frame_count !== 1 || atlas.layers_enabled !== false ||
        !(atlas.pixels instanceof Uint8ClampedArray) ||
        atlas.pixels.length !== atlasPixels * 4) {
      throw new Error("UV_PIXEL_MIGRATION_ATLAS_SCOPE: require distinct, matching, decoded, flattened single-frame RGBA atlases.");
    }
    seen.add(atlas.texture_uuid);
  }
  const scale = physicalPixelsPerUvUnit(
    before.logical_width, before.logical_height, width, height
  );
  const moved = new Set(plan.moved_island_ids);
  const beforeById = new Map(plan.before.islands.map(island => [island.id, island]));
  const proposedById = new Map(plan.proposed.islands.map(island => [island.id, island]));
  const sourcePixels = new Set<number>();
  const fixedPixels = new Set<number>();
  const targetToSource = new Map<number, number>();
  let visits = 0, fixedVisits = 0, sharedWrites = 0;

  const requireBudget = (): void => {
    visits += 1;
    if (visits > UV_MIGRATION_MAX_FACE_PIXEL_VISITS) {
      throw new Error("UV_PIXEL_MIGRATION_TOUCH_BUDGET: too many face-local texels for one migration candidate.");
    }
  };
  const mapMovement = (from: number, to: number, islandId: string): void => {
    requireBudget();
    sourcePixels.add(from);
    const previous = targetToSource.get(to);
    if (previous !== undefined && previous !== from) {
      throw new Error("UV_PIXEL_MIGRATION_WRITE_CONFLICT: " + islandId +
        " would merge independently authored face texels at one destination.");
    }
    if (previous !== undefined) sharedWrites += 1;
    targetToSource.set(to, from);
  };

  // Protect complete unchanged islands, including their unpainted texels.
  // An uncovered gap in the bitmap is not permission to overwrite a fixed UV.
  for (const island of plan.before.islands) {
    if (moved.has(island.id)) continue;
    const rect = physicalRect(island.rect, scale, width, height,
      "fixed island " + island.id);
    fixedVisits += rect.width * rect.height;
    if (fixedVisits > UV_MIGRATION_MAX_BITMAP_PIXELS * 2) {
      throw new Error("UV_PIXEL_MIGRATION_FIXED_BUDGET: too many overlapping fixed-ownership texels to attest safely.");
    }
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        fixedPixels.add(y * width + x);
      }
    }
  }

  const nativeCubes = new Map(before.cubes.map(cube => [cube.uuid, cube]));
  const instructions = translateUvPlanToNativeInstructions(plan, before);
  const instructionByIsland = new Map(instructions.map(entry => [entry.island_id, entry]));
  const metrics = {
    width, displayHeight: height,
    uvWidth: before.logical_width, uvHeight: before.logical_height,
  };

  for (const islandId of plan.moved_island_ids) {
    const old = beforeById.get(islandId);
    const next = proposedById.get(islandId);
    const instruction = instructionByIsland.get(islandId);
    if (!old || !next || !instruction) {
      throw new Error("UV_PIXEL_MIGRATION_INCOMPLETE: missing before/after native island " + islandId + ".");
    }
    if (instruction.kind === "BOX_UV_OFFSET") {
      const origin = physicalRect(old.rect, scale, width, height,
        "Box UV source " + islandId);
      const target = physicalRect(next.rect, scale, width, height,
        "Box UV destination " + islandId);
      if (origin.width !== target.width || origin.height !== target.height) {
        throw new Error("UV_PIXEL_MIGRATION_RESAMPLE_REQUIRED: native Box UV nets must retain their physical footprint.");
      }
      for (let y = 0; y < origin.height; y += 1) {
        for (let x = 0; x < origin.width; x += 1) {
          mapMovement(
            pixelOffset(origin.x + x, origin.y + y, width, height),
            pixelOffset(target.x + x, target.y + y, width, height),
            islandId
          );
        }
      }
      continue;
    }
    const originalFace = nativeCubes.get(instruction.cube_uuid)?.faces.find(
      face => face.face === instruction.face
    );
    if (!originalFace) {
      throw new Error("UV_PIXEL_MIGRATION_INCOMPLETE: native source face unavailable for " + islandId + ".");
    }
    const originalMap = mapFaceUvToTexturePixels(
      originalFace.uv, metrics, "migration source " + islandId
    );
    const destinationMap = mapFaceUvToTexturePixels(
      instruction.uv, metrics, "migration target " + islandId
    );
    const originalSize = faceLocalPixelSize(
      originalMap, originalFace.rotation, "migration source " + islandId
    );
    const destinationSize = faceLocalPixelSize(
      destinationMap, instruction.rotation, "migration target " + islandId
    );
    if (originalSize[0] !== destinationSize[0] ||
        originalSize[1] !== destinationSize[1]) {
      throw new Error("UV_PIXEL_MIGRATION_RESAMPLE_REQUIRED: " + islandId +
        " changes face-local texel density or extent; lossless migration cannot resample.");
    }
    for (let y = 0; y < originalSize[1]; y += 1) {
      for (let x = 0; x < originalSize[0]; x += 1) {
        const from = mapFaceLocalPixelToAtlasPixel(
          originalMap, originalFace.rotation, x, y, "migration source " + islandId
        );
        const to = mapFaceLocalPixelToAtlasPixel(
          destinationMap, instruction.rotation, x, y, "migration target " + islandId
        );
        mapMovement(
          pixelOffset(from.x, from.y, width, height),
          pixelOffset(to.x, to.y, width, height),
          islandId
        );
      }
    }
  }

  for (const pixel of sourcePixels) {
    if (fixedPixels.has(pixel)) {
      throw new Error("UV_PIXEL_MIGRATION_SHARED_SCOPE: a moved island shares source texels with an unchanged island.");
    }
  }
  for (const [targetPixel] of targetToSource) {
    if (fixedPixels.has(targetPixel)) {
      throw new Error("UV_PIXEL_MIGRATION_FIXED_TARGET: moved pixels would overwrite unchanged UV ownership.");
    }
    if (!sourcePixels.has(targetPixel) &&
        atlases.some(atlas => !rgbaIsZero(atlas.pixels, targetPixel))) {
      throw new Error("UV_PIXEL_MIGRATION_OCCUPIED_TARGET: destination contains unrelated authored RGBA, including hidden RGB.");
    }
  }

  // All source and destination coordinates are resolved before the first copy.
  // A cyclic region swap is therefore safe: copies always read the unmodified
  // invocation-owned atlas snapshot, never an earlier candidate write.
  const candidates = atlases.map(atlas => {
    const candidate = new Uint8ClampedArray(atlas.pixels);
    for (const sourcePixel of sourcePixels) candidate.fill(0, sourcePixel * 4, sourcePixel * 4 + 4);
    for (const [targetPixel, sourcePixel] of targetToSource) {
      candidate.set(atlas.pixels.subarray(sourcePixel * 4, sourcePixel * 4 + 4), targetPixel * 4);
    }
    const asBytes = (bytes: Uint8ClampedArray) =>
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const delta = diffTextureRegion(asBytes(atlas.pixels), asBytes(candidate), width, height);
    return {
      texture_uuid: atlas.texture_uuid,
      pixels: candidate,
      changed_pixels: delta.changed_pixels,
      affected_rect: delta.rect,
    };
  });
  return {
    state: "candidate_only",
    moved_island_ids: [...plan.moved_island_ids].sort(),
    relocated_pixel_count: targetToSource.size,
    coalesced_shared_writes: sharedWrites,
    candidates,
    native_apply_attested: false,
    scene_ownership_attested: false,
    visual_verdict: "not_evaluated",
  };
}
