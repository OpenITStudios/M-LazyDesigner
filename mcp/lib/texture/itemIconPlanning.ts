import { createHash } from "node:crypto";
import {
  analyzeTexturePixelCraft,
  type TexturePixelCraftOptions,
} from "./pixelCraft";

/**
 * I1 source-only handoff for one Minecraft item icon / static sprite.
 *
 * Existing Pixel Art owns creative authoring; Texture owns actual RGBA
 * extraction and PNG/atlas writes. This planner checks caller-provided bytes
 * and exact identifiers, reuses PixelCraft, but does NOT generate images,
 * infer native style, authenticate Resource Pack inventory or certify pixels.
 */
export type ItemIconAtlasEntry = {
  key: string;
  texture_path: string;
};

export type ItemIconPlanningInput = {
  item_identifier: string;
  atlas_key: string;
  /** Canonical Resource Pack path without .png extension. */
  texture_path: string;
  existing_atlas_entries: readonly ItemIconAtlasEntry[];
  target_mode: "MINECRAFT_NATIVE" | "MIVUBI_HD_PIXEL";
  alpha_intent: "TRANSPARENT" | "OPAQUE" | "FLEXIBLE";
  width: number;
  height: number;
  /** Raw row-major RGBA8, NOT encoded PNG bytes. */
  rgba: ArrayLike<number>;
  source_refs: readonly string[];
  style_lock_id?: string;
};

export type ItemIconPlanningIssue =
  | "ITEM_ICON_EMPTY_BITMAP"
  | "ATLAS_KEY_ALREADY_OWNED"
  | "ALPHA_INTENT_CONFLICT";

export type ItemIconPlanningWarning =
  | "PNG_ENCODING_NOT_ATTESTED"
  | "PIXEL_GRID_AUTHORING_NOT_ATTESTED"
  | "NATIVE_SIZE_READABILITY_REVIEW_REQUIRED"
  | "ITEM_COMPONENT_VERSION_UNVERIFIED"
  | "ATLAS_INVENTORY_NATIVE_UNVERIFIED"
  | "STYLE_LOCK_VISUAL_COMPARISON_REQUIRED"
  | "NON_SQUARE_ICON_CANVAS_REVIEW"
  | "ALPHA_FRINGE_REVIEW"
  | "HIDDEN_RGB_ON_TRANSPARENT_PIXELS_REVIEW"
  | "VISIBLE_PIXELS_TOUCH_CANVAS_EDGE"
  | "PALETTE_COMPLEXITY_REVIEW"
  | "PIXEL_CRAFT_FOCUSED_REGION_REQUIRED";

export type ItemIconPlanningResult = {
  state: "BLOCKED_BY_DECLARED_SOURCE" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  item_identifier: string;
  atlas_entry: ItemIconAtlasEntry;
  /** Advisory key mapping, not a Behavior Pack or Resource Pack file. */
  minecraft_icon_candidate: { textures: { default: string } };
  proposed_png_path: string;
  target_mode: ItemIconPlanningInput["target_mode"];
  bitmap_sha256: string;
  source_fingerprint: string;
  canvas: {
    width: number;
    height: number;
    pixel_count: number;
    visible_pixels: number;
    transparent_pixels: number;
    partial_alpha_pixels: number;
    hidden_rgb_transparent_pixels: number;
    unique_visible_rgb_colors: number;
    visible_bounds: {
      min_x: number;
      min_y: number;
      max_x: number;
      max_y: number;
    } | null;
  };
  /** Existing exact PixelCraft analytical evidence. Never a style verdict. */
  pixel_craft: ReturnType<typeof analyzeTexturePixelCraft>;
  issues: ItemIconPlanningIssue[];
  warnings: ItemIconPlanningWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  png_encoded: false;
  atlas_writes_performed: false;
};

const ITEM_ID = /^[a-z0-9_][a-z0-9_.-]{0,63}:[a-z0-9_][a-z0-9_./-]{0,127}$/;
const ATLAS_KEY = /^(?:[a-z0-9_][a-z0-9_.-]{0,63}:)?[a-z0-9_][a-z0-9_./-]{0,127}$/;
const TEXTURE_PATH = /^textures\/[a-z0-9_./-]+$/;
const MAX_CANVAS_SIDE = 256;
const MAX_CANVAS_PIXELS = MAX_CANVAS_SIDE * MAX_CANVAS_SIDE;
const MAX_ATLAS_ENTRIES = 4096;
const MAX_SOURCE_REFS = 8;

function nonempty(value: unknown, field: string, max = 192): string {
  if (typeof value !== "string" || value.length < 1 ||
      value.length > max || value.trim() !== value) {
    throw new Error("ITEM_ICON_IDENTITY_INVALID: " + field);
  }
  return value;
}
function safeSegments(value: string, rest: string): boolean {
  return !value.includes("\\") && !value.includes("//") &&
    rest.split("/").every(s => s.length > 0 && s !== "." && s !== "..");
}
function requireItemId(value: unknown): string {
  const candidate = nonempty(value, "item_identifier");
  if (!ITEM_ID.test(candidate) ||
      !safeSegments(candidate, candidate.split(":")[1]!)) {
    throw new Error("ITEM_ICON_ITEM_IDENTIFIER_INVALID");
  }
  return candidate;
}
function requireAtlasKey(value: unknown): string {
  const key = nonempty(value, "atlas_key");
  if (!ATLAS_KEY.test(key) || !safeSegments(key, key.split(":").at(-1)!)) {
    throw new Error("ITEM_ICON_ATLAS_KEY_INVALID");
  }
  return key;
}
function requireTexturePath(value: unknown): string {
  const path = nonempty(value, "texture_path");
  if (!TEXTURE_PATH.test(path) ||
      !safeSegments(path, path.slice("textures/".length))) {
    throw new Error("ITEM_ICON_TEXTURE_PATH_INVALID");
  }
  return path;
}

export function planBedrockItemIcon(input: ItemIconPlanningInput): ItemIconPlanningResult {
  if (!input || typeof input !== "object") {
    throw new Error("ITEM_ICON_INPUT_INVALID");
  }
  const item = requireItemId(input.item_identifier);
  const atlas = requireAtlasKey(input.atlas_key);
  const path = requireTexturePath(input.texture_path);
  if (!path.startsWith("textures/items/") || path.endsWith(".png")) {
    throw new Error("ITEM_ICON_TEXTURE_PATH_MUST_BE_EXTENSIONLESS_ITEM_PATH");
  }
  if (input.target_mode !== "MINECRAFT_NATIVE" &&
      input.target_mode !== "MIVUBI_HD_PIXEL") {
    throw new Error("ITEM_ICON_TARGET_MODE_INVALID");
  }
  if (input.alpha_intent !== "TRANSPARENT" &&
      input.alpha_intent !== "OPAQUE" && input.alpha_intent !== "FLEXIBLE") {
    throw new Error("ITEM_ICON_ALPHA_INTENT_INVALID");
  }
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) ||
      input.width < 1 || input.height < 1 ||
      input.width > MAX_CANVAS_SIDE || input.height > MAX_CANVAS_SIDE ||
      input.width * input.height > MAX_CANVAS_PIXELS) {
    throw new Error("ITEM_ICON_CANVAS_INVALID_OR_OVER_BUDGET");
  }
  if (!Array.isArray(input.existing_atlas_entries) ||
      input.existing_atlas_entries.length > MAX_ATLAS_ENTRIES) {
    throw new Error("ITEM_ICON_ATLAS_INVENTORY_INVALID");
  }
  const atlasInventory = new Map<string, string>();
  for (const entry of input.existing_atlas_entries) {
    if (!entry || typeof entry !== "object") {
      throw new Error("ITEM_ICON_ATLAS_INVENTORY_INVALID");
    }
    const key = requireAtlasKey(entry.key);
    const existingPath = requireTexturePath(entry.texture_path);
    if (atlasInventory.has(key)) {
      throw new Error("ITEM_ICON_ATLAS_INVENTORY_AMBIGUOUS");
    }
    atlasInventory.set(key, existingPath);
  }
  if (!Array.isArray(input.source_refs) ||
      input.source_refs.length < 1 || input.source_refs.length > MAX_SOURCE_REFS ||
      input.source_refs.some(s => typeof s !== "string" ||
        !s.trim() || s.trim() !== s || s.length > 160) ||
      new Set(input.source_refs).size !== input.source_refs.length) {
    throw new Error("ITEM_ICON_SOURCE_REFS_INVALID");
  }
  if (input.style_lock_id !== undefined) {
    nonempty(input.style_lock_id, "style_lock_id", 128);
  }
  const pixelCount = input.width * input.height;
  const expectedLength = pixelCount * 4;
  if (!input.rgba || typeof input.rgba !== "object" ||
      !Number.isSafeInteger(input.rgba.length) ||
      input.rgba.length !== expectedLength) {
    throw new Error("ITEM_ICON_RGBA_BUFFER_SIZE_INVALID");
  }

  const bytes = new Uint8Array(expectedLength);
  let visible = 0;
  let transparent = 0;
  let partialAlpha = 0;
  let hiddenRgb = 0;
  let minX = input.width;
  let minY = input.height;
  let maxX = -1;
  let maxY = -1;
  const palette = new Set<number>();
  for (let i = 0; i < expectedLength; i++) {
    const component = input.rgba[i];
    if (typeof component !== "number" || !Number.isInteger(component) ||
        component < 0 || component > 255) {
      throw new Error("ITEM_ICON_RGBA_COMPONENT_INVALID");
    }
    bytes[i] = component;
  }
  for (let index = 0; index < pixelCount; index++) {
    const offset = index * 4;
    const r = bytes[offset]!;
    const g = bytes[offset + 1]!;
    const b = bytes[offset + 2]!;
    const a = bytes[offset + 3]!;
    if (a === 0) {
      transparent++;
      if ((r | g | b) !== 0) hiddenRgb++;
      continue;
    }
    visible++;
    if (a < 255) partialAlpha++;
    palette.add((r << 16) | (g << 8) | b);
    const x = index % input.width;
    const y = Math.floor(index / input.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bounds = visible === 0 ? null : {
    min_x: minX, min_y: minY, max_x: maxX, max_y: maxY,
  };

  // Do not duplicate color-cluster / orphan-pixel / alpha-edge heuristics.
  // For >16,384 pixels, PixelCraft returns its honest UNAVAILABLE result.
  const pixel_craft = analyzeTexturePixelCraft(bytes, input.width, input.height);

  const issues: ItemIconPlanningIssue[] = [];
  if (visible === 0) issues.push("ITEM_ICON_EMPTY_BITMAP");
  if (atlasInventory.has(atlas)) issues.push("ATLAS_KEY_ALREADY_OWNED");
  if ((input.alpha_intent === "TRANSPARENT" && transparent === 0) ||
      (input.alpha_intent === "OPAQUE" && transparent + partialAlpha > 0)) {
    issues.push("ALPHA_INTENT_CONFLICT");
  }

  const warnings: ItemIconPlanningWarning[] = [
    "PNG_ENCODING_NOT_ATTESTED",
    "PIXEL_GRID_AUTHORING_NOT_ATTESTED",
    "NATIVE_SIZE_READABILITY_REVIEW_REQUIRED",
    "ITEM_COMPONENT_VERSION_UNVERIFIED",
    "ATLAS_INVENTORY_NATIVE_UNVERIFIED",
  ];
  if (input.style_lock_id) warnings.push("STYLE_LOCK_VISUAL_COMPARISON_REQUIRED");
  if (input.width !== input.height) warnings.push("NON_SQUARE_ICON_CANVAS_REVIEW");
  if (partialAlpha > 0) warnings.push("ALPHA_FRINGE_REVIEW");
  if (hiddenRgb > 0) warnings.push("HIDDEN_RGB_ON_TRANSPARENT_PIXELS_REVIEW");
  if (bounds && (bounds.min_x === 0 || bounds.min_y === 0 ||
      bounds.max_x === input.width - 1 || bounds.max_y === input.height - 1)) {
    warnings.push("VISIBLE_PIXELS_TOUCH_CANVAS_EDGE");
  }
  if (Math.min(input.width, input.height) <= 32 && palette.size > 64) {
    warnings.push("PALETTE_COMPLEXITY_REVIEW");
  }
  if (pixel_craft.state === "unavailable") {
    warnings.push("PIXEL_CRAFT_FOCUSED_REGION_REQUIRED");
  }

  const bitmap_sha256 = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  const source_fingerprint = "sha256:" + createHash("sha256")
    .update(JSON.stringify({
      contract: "item-icon-i1-source-v1",
      item, atlas, path,
      target_mode: input.target_mode,
      alpha_intent: input.alpha_intent,
      dimensions: [input.width, input.height],
      bitmap_sha256,
      source_refs: [...input.source_refs].sort(),
      style_lock_id: input.style_lock_id ?? null,
      atlas_inventory: [...atlasInventory.entries()].sort(([a], [b]) =>
        a.localeCompare(b)),
    }))
    .digest("hex");

  return {
    state: issues.length > 0
      ? "BLOCKED_BY_DECLARED_SOURCE"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    item_identifier: item,
    atlas_entry: { key: atlas, texture_path: path },
    minecraft_icon_candidate: { textures: { default: atlas } },
    proposed_png_path: path + ".png",
    target_mode: input.target_mode,
    bitmap_sha256, source_fingerprint,
    canvas: {
      width: input.width, height: input.height,
      pixel_count: pixelCount, visible_pixels: visible,
      transparent_pixels: transparent, partial_alpha_pixels: partialAlpha,
      hidden_rgb_transparent_pixels: hiddenRgb,
      unique_visible_rgb_colors: palette.size,
      visible_bounds: bounds,
    },
    pixel_craft, issues, warnings,
    native_verified: false,
    visual_verified: false,
    minecraft_verified: false,
    png_encoded: false,
    atlas_writes_performed: false,
  };
}
