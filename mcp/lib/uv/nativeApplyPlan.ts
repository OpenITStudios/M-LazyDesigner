import type { SemanticUvPlacement } from "@/lib/uv/semanticPlanner";
import type { CubeFaceKey } from "@/lib/uv/authoringRecipeUv";
import {
  requireSupportedFaceRotation,
  type SupportedFaceRotation,
  requireUvPhysicalPixelGrid,
} from "@/lib/uv/facePixelMapping";
import { physicalPixelsPerUvUnit } from "@/lib/uv/density";

export type NativeUvTarget = {
  island_id: string;
  cube_uuid: string;
  face: CubeFaceKey;
  current_uv: readonly [number, number, number, number];
  current_rotation: number;
  expected_recipe_id?: string;
  expected_instance_id?: string;
};

/** Semantic MaxRects placements are in physical atlas pixels, not native logical UV. */
export type NativeUvAtlasMapping = Readonly<{
  bitmap_width: number;
  bitmap_height: number;
  logical_width: number;
  logical_height: number;
}>;

export type NativeUvApplyOperation = {
  island_id: string;
  cube_uuid: string;
  face: CubeFaceKey;
  uv: [number, number, number, number];
  rotation: SupportedFaceRotation;
  shared_with?: string;
  expected_recipe_id?: string;
  expected_instance_id?: string;
};

function deriveFaceRotation(current: number, packedQuarterTurn: boolean): SupportedFaceRotation {
  // A placement's rotated flag describes an additional atlas quarter-turn.
  // It never resets the face's already-authored native orientation.
  return requireSupportedFaceRotation(
    (current + (packedQuarterTurn ? 90 : 0)) % 360,
    "Semantic UV native face"
  );
}

function preserveSignedUvCorners(
  placement: SemanticUvPlacement,
  nativeUv: readonly [number, number, number, number],
  atlas: NativeUvAtlasMapping,
  pixelScale: readonly [number, number]
): [number, number, number, number] {
  const [u0, v0, u1, v1] = nativeUv;
  if (nativeUv.some((value) => !Number.isFinite(value)) ||
      u0 === u1 || v0 === v1) {
    throw new Error(
      "UV_FACE_ORIENTATION_UNRESOLVED: island " + placement.id +
      " needs finite, non-collapsed native U/V direction before applying a new rectangle."
    );
  }
  const physical = [placement.x, placement.y, placement.width, placement.height];
  if (!physical.every((value) => Number.isSafeInteger(value)) ||
      placement.width <= 0 || placement.height <= 0 ||
      placement.x < 0 || placement.y < 0 ||
      placement.x + placement.width > atlas.bitmap_width ||
      placement.y + placement.height > atlas.bitmap_height) {
    throw new Error(
      "UV_NATIVE_PLACEMENT_INVALID: island " + placement.id +
      " requires positive whole-pixel extents inside the declared physical bitmap."
    );
  }
  // Convert once at the native boundary; packing and sharing keep physical
  // pixel coordinates, while Blockbench face UV is in project logical units.
  const x0 = placement.x / pixelScale[0];
  const y0 = placement.y / pixelScale[1];
  const x1 = (placement.x + placement.width) / pixelScale[0];
  const y1 = (placement.y + placement.height) / pixelScale[1];
  requireUvPhysicalPixelGrid([x0, y0, x1, y1], pixelScale,
    "native semantic UV island " + placement.id);
  return [
    u0 < u1 ? x0 : x1,
    v0 < v1 ? y0 : y1,
    u0 < u1 ? x1 : x0,
    v0 < v1 ? y1 : y0,
  ];
}

export function compileNativeUvApplyPlan(
  placements: readonly SemanticUvPlacement[],
  targets: readonly NativeUvTarget[],
  atlas: NativeUvAtlasMapping
) {
  if (!atlas ||
      !Number.isSafeInteger(atlas.bitmap_width) || atlas.bitmap_width <= 0 ||
      !Number.isSafeInteger(atlas.bitmap_height) || atlas.bitmap_height <= 0 ||
      !Number.isSafeInteger(atlas.logical_width) || atlas.logical_width <= 0 ||
      !Number.isSafeInteger(atlas.logical_height) || atlas.logical_height <= 0) {
    throw new Error(
      "UV_NATIVE_ATLAS_MAPPING_REQUIRED: native semantic UV compilation requires explicit positive physical bitmap and logical project dimensions."
    );
  }
  const pixelScale = physicalPixelsPerUvUnit(
    atlas.logical_width, atlas.logical_height, atlas.bitmap_width, atlas.bitmap_height
  );
  const targetByIsland = new Map<string, NativeUvTarget>();
  for (const target of targets) {
    if (!target.island_id || targetByIsland.has(target.island_id)) {
      throw new Error("Native UV targets require unique non-empty island IDs.");
    }
    requireSupportedFaceRotation(
      target.current_rotation, "Native UV target " + target.island_id
    );
    if (
      (target.expected_recipe_id === undefined) !==
      (target.expected_instance_id === undefined)
    ) {
      throw new Error("Native UV target ownership must provide recipe and instance identity together.");
    }
    targetByIsland.set(target.island_id, target);
  }

  const operations: NativeUvApplyOperation[] = [];
  const unresolved: string[] = [];
  for (const placement of placements) {
    const target = targetByIsland.get(placement.id);
    if (!target) {
      unresolved.push(placement.id);
      continue;
    }
    operations.push({
      island_id: placement.id,
      cube_uuid: target.cube_uuid,
      face: target.face,
      uv: preserveSignedUvCorners(placement, target.current_uv, atlas, pixelScale),
      rotation: deriveFaceRotation(target.current_rotation, placement.rotated),
      shared_with: placement.shared_with,
      expected_recipe_id: target.expected_recipe_id,
      expected_instance_id: target.expected_instance_id,
    });
  }

  return {
    operations: operations.sort((a, b) => a.island_id.localeCompare(b.island_id)),
    unresolved: unresolved.sort(),
    complete: unresolved.length === 0,
  };
}
