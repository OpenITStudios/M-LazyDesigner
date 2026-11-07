import { createHash } from "node:crypto";

/**
 * T1 source-only Minecraft Bedrock block flipbook review.
 *
 * A native Texture owner must supply the vertical strip's actual RGBA8
 * pixels, atlas inventory and current file revision. This planner cannot
 * attest PNG encoding, terrain_texture.json bytes, GPU blending, loop
 * smoothness, the Minecraft runtime or production Resource Pack writes.
 */
export type BlockFlipbookTarget = {
  atlas_tile: string;
  atlas_index?: number;
  atlas_tile_variant?: number;
};

export type BlockFlipbookTerrainTile = {
  atlas_tile: string;
  /** Ordered terrain_texture.json texture array; NOT a variant inventory. */
  texture_paths: readonly string[];
};

export type BlockFlipbookExistingEntry = BlockFlipbookTarget & {
  flipbook_texture: string;
};

export type BlockFlipbookPlanningInput = {
  target_bedrock_version: string;
  /** Extensionless vertical strip path under textures/blocks/. */
  flipbook_texture: string;
  frame_size: number;
  strip_width: number;
  strip_height: number;
  /** Exact row-major RGBA8 strip bytes, not a PNG file or image URL. */
  rgba: ArrayLike<number>;
  /** Explicit physical frame indices, including intentional repeats. */
  frame_order: readonly number[];
  ticks_per_frame: number;
  blend_frames: boolean;
  replicate?: number;
  target: BlockFlipbookTarget;
  terrain_tiles: readonly BlockFlipbookTerrainTile[];
  existing_flipbooks: readonly BlockFlipbookExistingEntry[];
  source_refs: readonly string[];
  style_lock_id?: string;
};

export type BlockFlipbookIssue =
  | "TERRAIN_ATLAS_TILE_NOT_FOUND"
  | "TERRAIN_ATLAS_INDEX_REQUIRED"
  | "TERRAIN_ATLAS_INDEX_OUT_OF_RANGE"
  | "TERRAIN_ATLAS_TEXTURE_MISMATCH"
  | "ATLAS_INDEX_REQUIRED_FOR_VARIANT"
  | "FLIPBOOK_TARGET_ALREADY_CLAIMED";

export type BlockFlipbookWarning =
  | "PNG_STRIP_NOT_NATIVELY_ATTESTED"
  | "TERRAIN_ATLAS_BYTES_NOT_VERIFIED"
  | "BEDROCK_VERSION_NOT_LIVE_VERIFIED"
  | "LOOP_WRAP_VISUAL_REVIEW_REQUIRED"
  | "FRAME_TIMING_NOT_LIVE_VERIFIED"
  | "ATLAS_VARIANT_SOURCE_REVIEW_REQUIRED"
  | "BLENDED_PIXEL_FRAMES_REVIEW"
  | "UNREFERENCED_STRIP_FRAMES"
  | "REPEATED_ADJACENT_FRAMES_REVIEW"
  | "ONE_DISTINCT_PLAYBACK_FRAME_REVIEW"
  | "FULLY_TRANSPARENT_FRAME_REVIEW"
  | "STYLE_LOCK_VISUAL_REVIEW_REQUIRED";

export type BlockFlipbookPlanningResult = {
  state: "BLOCKED_BY_DECLARED_SOURCE" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  target_bedrock_version: string;
  source_fingerprint: string;
  strip_bitmap_sha256: string;
  proposed_json_path: "textures/flipbook_textures.json";
  candidate_flipbook_entry: {
    flipbook_texture: string;
    atlas_tile: string;
    atlas_index?: number;
    atlas_tile_variant?: number;
    frames: number[];
    ticks_per_frame: number;
    blend_frames: boolean;
    replicate?: number;
  };
  strip: {
    width: number;
    height: number;
    frame_size: number;
    physical_frame_count: number;
    frame_sha256: string[];
    transparent_frame_count: number;
  };
  playback: {
    frame_order: number[];
    duration_ticks: number;
    duration_seconds: number;
    distinct_frame_count: number;
    loop_wrap: {
      from_frame: number;
      to_frame: number;
      changed_visible_pixel_count: number;
      changed_visible_pixel_ratio: number;
      /** Technical pixel difference; never a loop-quality verdict. */
      same_visible_pixels: boolean;
    };
  };
  issues: BlockFlipbookIssue[];
  warnings: BlockFlipbookWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  png_encoded: false;
  resource_pack_written: false;
};

const TILE_KEY = /^[a-z0-9_][a-z0-9_.-]{0,127}$/;
const BLOCK_PATH = /^textures\/blocks\/[a-z0-9_./-]+$/;
const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const MAX_FRAMES = 128;
const MAX_FRAME_SIZE = 128;
const MAX_PIXELS = 262_144;
const MAX_SEQUENCE = 256;
const MAX_TERRAIN_TILES = 512;
const MAX_EXISTING_FLIPBOOKS = 512;
const MAX_SOURCE_REFS = 8;

function exact(value: unknown, label: string, max = 192): string {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > max || value.trim() !== value) {
    throw new Error("BLOCK_FLIPBOOK_IDENTITY_INVALID: " + label);
  }
  return value;
}
function tileKey(value: unknown): string {
  const key = exact(value, "atlas_tile");
  if (!TILE_KEY.test(key)) {
    throw new Error("BLOCK_FLIPBOOK_ATLAS_TILE_INVALID");
  }
  return key;
}
function texturePath(value: unknown): string {
  const path = exact(value, "flipbook_texture");
  if (!BLOCK_PATH.test(path) || path.includes("//") ||
      path.endsWith(".png") ||
      path.slice("textures/blocks/".length).split("/")
        .some(segment => !segment || segment === "." || segment === "..")) {
    throw new Error("BLOCK_FLIPBOOK_TEXTURE_PATH_INVALID");
  }
  return path;
}
function natural(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < minimum || value > maximum) {
    throw new Error("BLOCK_FLIPBOOK_NUMBER_INVALID: " + label);
  }
  return value;
}
function atlasIndex(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : natural(value, label, 0, 127);
}
function target(input: unknown): BlockFlipbookTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("BLOCK_FLIPBOOK_TARGET_INVALID");
  }
  const obj = input as BlockFlipbookTarget;
  return {
    atlas_tile: tileKey(obj.atlas_tile),
    ...(obj.atlas_index === undefined ? {} :
      { atlas_index: atlasIndex(obj.atlas_index, "atlas_index") }),
    ...(obj.atlas_tile_variant === undefined ? {} :
      { atlas_tile_variant: atlasIndex(obj.atlas_tile_variant, "atlas_tile_variant") }),
  };
}
function targetIdentity(t: BlockFlipbookTarget): string {
  // Explicit zero and omitted default describe the same target for collision.
  return JSON.stringify([t.atlas_tile, t.atlas_index ?? 0, t.atlas_tile_variant ?? 0]);
}
function digest(data: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}
function ratio(n: number, total: number): number {
  return Number((n / total).toFixed(4));
}

/** Source-size policy; these limits are bounded work budgets, NOT Bedrock maxima. */
export function planBedrockBlockFlipbook(
  input: BlockFlipbookPlanningInput
): BlockFlipbookPlanningResult {
  if (!input || typeof input !== "object") {
    throw new Error("BLOCK_FLIPBOOK_INPUT_INVALID");
  }
  const version = exact(input.target_bedrock_version, "target_bedrock_version", 32);
  if (!VERSION.test(version)) {
    throw new Error("BLOCK_FLIPBOOK_VERSION_INVALID");
  }
  const path = texturePath(input.flipbook_texture);
  const selected = target(input.target);
  const size = natural(input.frame_size, "frame_size", 1, MAX_FRAME_SIZE);
  const width = natural(input.strip_width, "strip_width", 1, MAX_FRAME_SIZE);
  const height = natural(input.strip_height, "strip_height", 1, MAX_PIXELS);
  if (width !== size || height % size !== 0) {
    throw new Error("BLOCK_FLIPBOOK_STRIP_MUST_BE_VERTICAL_SQUARE_FRAMES");
  }
  const count = height / size;
  if (count < 2 || count > MAX_FRAMES || width * height > MAX_PIXELS) {
    throw new Error("BLOCK_FLIPBOOK_STRIP_BUDGET_INVALID");
  }
  const ticks = natural(input.ticks_per_frame, "ticks_per_frame", 1, 1200);
  if (typeof input.blend_frames !== "boolean") {
    throw new Error("BLOCK_FLIPBOOK_BLEND_MODE_INVALID");
  }
  const replicate = input.replicate === undefined ? undefined :
    natural(input.replicate, "replicate", 1, 16);
  if (!Array.isArray(input.frame_order) || input.frame_order.length < 1 ||
      input.frame_order.length > MAX_SEQUENCE) {
    throw new Error("BLOCK_FLIPBOOK_PLAYBACK_SEQUENCE_INVALID");
  }
  const frame_order = input.frame_order.map(index => {
    if (typeof index !== "number" || !Number.isSafeInteger(index) ||
        index < 0 || index >= count) {
      throw new Error("BLOCK_FLIPBOOK_FRAME_INDEX_OUT_OF_RANGE");
    }
    return index;
  });
  if (!Array.isArray(input.source_refs) ||
      input.source_refs.length < 1 || input.source_refs.length > MAX_SOURCE_REFS ||
      input.source_refs.some(ref => typeof ref !== "string" ||
        ref.length === 0 || ref.length > 160 || ref.trim() !== ref) ||
      new Set(input.source_refs).size !== input.source_refs.length) {
    throw new Error("BLOCK_FLIPBOOK_REFERENCE_IDENTITY_INVALID");
  }
  const style = input.style_lock_id === undefined ? null :
    exact(input.style_lock_id, "style_lock_id", 128);

  if (!Array.isArray(input.terrain_tiles) ||
      input.terrain_tiles.length > MAX_TERRAIN_TILES ||
      !Array.isArray(input.existing_flipbooks) ||
      input.existing_flipbooks.length > MAX_EXISTING_FLIPBOOKS) {
    throw new Error("BLOCK_FLIPBOOK_INVENTORY_BUDGET_INVALID");
  }
  const terrain = new Map<string, string[]>();
  for (const item of input.terrain_tiles) {
    if (!item || typeof item !== "object" ||
        !Array.isArray(item.texture_paths) ||
        !item.texture_paths.length || item.texture_paths.length > 64) {
      throw new Error("BLOCK_FLIPBOOK_TERRAIN_INVENTORY_INVALID");
    }
    const key = tileKey(item.atlas_tile);
    if (terrain.has(key)) {
      throw new Error("BLOCK_FLIPBOOK_TERRAIN_INVENTORY_AMBIGUOUS");
    }
    terrain.set(key, item.texture_paths.map(texturePath));
  }
  const existing = new Set<string>();
  for (const item of input.existing_flipbooks) {
    if (!item || typeof item !== "object") {
      throw new Error("BLOCK_FLIPBOOK_EXISTING_ENTRY_INVALID");
    }
    texturePath(item.flipbook_texture);
    const key = targetIdentity(target(item));
    if (existing.has(key)) {
      throw new Error("BLOCK_FLIPBOOK_EXISTING_TARGET_AMBIGUOUS");
    }
    existing.add(key);
  }

  const expectedBytes = width * height * 4;
  if (!input.rgba || typeof input.rgba !== "object" ||
      !Number.isSafeInteger(input.rgba.length) ||
      input.rgba.length !== expectedBytes) {
    throw new Error("BLOCK_FLIPBOOK_RGBA_LENGTH_INVALID");
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) {
    const component = input.rgba[i];
    if (typeof component !== "number" || !Number.isInteger(component) ||
        component < 0 || component > 255) {
      throw new Error("BLOCK_FLIPBOOK_RGBA_COMPONENT_INVALID");
    }
    bytes[i] = component;
  }

  const issues: BlockFlipbookIssue[] = [];
  const warnings: BlockFlipbookWarning[] = [
    "PNG_STRIP_NOT_NATIVELY_ATTESTED",
    "TERRAIN_ATLAS_BYTES_NOT_VERIFIED",
    "BEDROCK_VERSION_NOT_LIVE_VERIFIED",
    "FRAME_TIMING_NOT_LIVE_VERIFIED",
    "LOOP_WRAP_VISUAL_REVIEW_REQUIRED",
  ];
  const tile = terrain.get(selected.atlas_tile);
  const index = selected.atlas_index;
  if (!tile) issues.push("TERRAIN_ATLAS_TILE_NOT_FOUND");
  else if (index === undefined && tile.length > 1) {
    issues.push("TERRAIN_ATLAS_INDEX_REQUIRED");
  } else if (index !== undefined && index >= tile.length) {
    issues.push("TERRAIN_ATLAS_INDEX_OUT_OF_RANGE");
  } else if (selected.atlas_tile_variant === undefined &&
      tile[index ?? 0] !== path) {
    issues.push("TERRAIN_ATLAS_TEXTURE_MISMATCH");
  }
  if (selected.atlas_tile_variant !== undefined) {
    if (index === undefined) issues.push("ATLAS_INDEX_REQUIRED_FOR_VARIANT");
    // A flattened texture path array is not a proof of terrain variations.
    warnings.push("ATLAS_VARIANT_SOURCE_REVIEW_REQUIRED");
  }
  if (existing.has(targetIdentity(selected))) {
    issues.push("FLIPBOOK_TARGET_ALREADY_CLAIMED");
  }
  if (input.blend_frames) warnings.push("BLENDED_PIXEL_FRAMES_REVIEW");
  if (style) warnings.push("STYLE_LOCK_VISUAL_REVIEW_REQUIRED");
  const referenced = new Set(frame_order);
  if (referenced.size < count) warnings.push("UNREFERENCED_STRIP_FRAMES");
  if (referenced.size === 1) warnings.push("ONE_DISTINCT_PLAYBACK_FRAME_REVIEW");
  if (frame_order.some((frame, i) =>
    i > 0 && frame === frame_order[i - 1])) {
    warnings.push("REPEATED_ADJACENT_FRAMES_REVIEW");
  }

  const frameBytes = size * size * 4;
  const frame_sha256: string[] = [];
  let transparentFrames = 0;
  for (let frame = 0; frame < count; frame++) {
    const raw = bytes.subarray(frame * frameBytes, (frame + 1) * frameBytes);
    frame_sha256.push(digest(raw));
    let anyVisible = false;
    for (let i = 3; i < raw.length; i += 4) {
      if (raw[i]! > 0) { anyVisible = true; break; }
    }
    if (!anyVisible) transparentFrames++;
  }
  if (transparentFrames) warnings.push("FULLY_TRANSPARENT_FRAME_REVIEW");

  const fromFrame = frame_order[frame_order.length - 1]!;
  const toFrame = frame_order[0]!;
  const fromStart = fromFrame * frameBytes;
  const toStart = toFrame * frameBytes;
  let changedPixels = 0;
  for (let i = 0; i < frameBytes; i += 4) {
    const alphaA = bytes[fromStart + i + 3]!;
    const alphaB = bytes[toStart + i + 3]!;
    // Ignore hidden RGB when both endpoints are fully transparent.
    const changed = alphaA !== alphaB ||
      ((alphaA !== 0 || alphaB !== 0) &&
        (bytes[fromStart + i] !== bytes[toStart + i] ||
         bytes[fromStart + i + 1] !== bytes[toStart + i + 1] ||
         bytes[fromStart + i + 2] !== bytes[toStart + i + 2]));
    if (changed) changedPixels++;
  }

  const bitmap = digest(bytes);
  const normalized = {
    contract: "bedrock-block-flipbook-t1-source-v1",
    version, path, selected, size, width, height, bitmap,
    frame_order, ticks, blend_frames: input.blend_frames,
    replicate: replicate ?? null, style_lock_id: style,
    sources: [...input.source_refs].sort(),
    terrain: [...terrain.entries()].sort(([a], [b]) => a.localeCompare(b)),
    existing_targets: [...existing].sort(),
  };
  const source_fingerprint = "sha256:" + createHash("sha256")
    .update(JSON.stringify(normalized)).digest("hex");

  return {
    state: issues.length
      ? "BLOCKED_BY_DECLARED_SOURCE"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    target_bedrock_version: version,
    source_fingerprint,
    strip_bitmap_sha256: bitmap,
    proposed_json_path: "textures/flipbook_textures.json",
    candidate_flipbook_entry: {
      flipbook_texture: path,
      atlas_tile: selected.atlas_tile,
      ...(index === undefined ? {} : { atlas_index: index }),
      ...(selected.atlas_tile_variant === undefined ? {} :
        { atlas_tile_variant: selected.atlas_tile_variant }),
      frames: [...frame_order],
      ticks_per_frame: ticks,
      blend_frames: input.blend_frames,
      ...(replicate === undefined ? {} : { replicate }),
    },
    strip: {
      width, height, frame_size: size, physical_frame_count: count,
      frame_sha256, transparent_frame_count: transparentFrames,
    },
    playback: {
      frame_order: [...frame_order],
      duration_ticks: frame_order.length * ticks,
      duration_seconds: frame_order.length * ticks / 20,
      distinct_frame_count: referenced.size,
      loop_wrap: {
        from_frame: fromFrame, to_frame: toFrame,
        changed_visible_pixel_count: changedPixels,
        changed_visible_pixel_ratio: ratio(changedPixels, size * size),
        same_visible_pixels: changedPixels === 0,
      },
    },
    issues, warnings,
    native_verified: false, visual_verified: false,
    minecraft_verified: false, png_encoded: false,
    resource_pack_written: false,
  };
}
