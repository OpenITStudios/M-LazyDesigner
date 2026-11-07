import { createHash } from "node:crypto";
import { analyzeTexturePixelCraft } from "./pixelCraft";

/**
 * S1 import-safe 64x64 classic Bedrock skin source review.
 *
 * UV extents are derived from Mojang's humanoid custom wide/slim geometry
 * with Box UV face layout. Their ownership belongs to the native template:
 * this source planner cannot prove face orientation, rendered model fit,
 * actual PNG bytes, or a working skins.json pack.
 */
export type ClassicSkinBodyProfile = "STEVE_WIDE" | "ALEX_SLIM";
export type ClassicSkinPart =
  | "head" | "body" | "right_arm" | "left_arm" | "right_leg" | "left_leg";
export type ClassicSkinDeclaredEntry = {
  localization_name: string;
  texture: string;
  geometry: string;
};
export type ClassicSkinPlanningInput = {
  body_profile: ClassicSkinBodyProfile;
  pack_localization_name: string;
  skin_localization_name: string;
  /** Exact root-level PNG filename, not a path or image content. */
  texture_filename: string;
  /** Skin pack access type; a user declaration, not a license check. */
  skin_type: "free" | "paid";
  width: number;
  height: number;
  /** Source RGBA8 buffer, row-major, exactly 64*64*4 bytes. */
  rgba: ArrayLike<number>;
  existing_skins: readonly ClassicSkinDeclaredEntry[];
  source_refs: readonly string[];
  style_lock_id?: string;
};
export type ClassicSkinPlanningWarning =
  | "BASE_SURFACE_TRANSPARENCY_REVIEW"
  | "BASE_PART_COMPLETELY_TRANSPARENT_REVIEW"
  | "OVERLAY_WITH_UNPAINTED_BASE_REVIEW"
  | "PARTIAL_ALPHA_BEDROCK_RENDER_REVIEW"
  | "UNUSED_TEMPLATE_PIXEL_REVIEW"
  | "SLIM_ARM_UNUSED_COLUMNS_REVIEW"
  | "SHARED_TEXTURE_FILENAME_REVIEW"
  | "STYLE_LOCK_VISUAL_REVIEW"
  | "UV_FACE_ORIENTATION_NOT_ATTESTED"
  | "PNG_FILE_NOT_ENCODED_OR_VERIFIED"
  | "SKIN_PACK_METADATA_NOT_COMPILED"
  | "BODY_PROFILE_NATIVE_PREVIEW_REQUIRED";
export type ClassicSkinPlanningIssue =
  | "SKIN_HAS_NO_MAPPED_VISIBLE_PIXELS"
  | "SKIN_LOCALIZATION_NAME_ALREADY_PRESENT";
export type ClassicSkinPartReport = {
  part: ClassicSkinPart;
  base_mapped_pixels: number;
  base_visible_pixels: number;
  base_transparent_pixels: number;
  overlay_mapped_pixels: number;
  overlay_visible_pixels: number;
  overlay_partial_alpha_pixels: number;
};
export type ClassicSkinPlanningResult = {
  state: "BLOCKED_BY_DECLARED_SOURCE" | "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED";
  body_profile: ClassicSkinBodyProfile;
  model_geometry: "geometry.humanoid.custom" | "geometry.humanoid.customSlim";
  arm_width_pixels: 4 | 3;
  candidate_skins_json_entry: {
    localization_name: string;
    geometry: "geometry.humanoid.custom" | "geometry.humanoid.customSlim";
    texture: string;
    type: "free" | "paid";
  };
  candidate_localization_key: string;
  proposed_png_filename: string;
  bitmap_sha256: string;
  source_fingerprint: string;
  canvas: {
    width: 64;
    height: 64;
    mapped_visible_pixels: number;
    base_mapped_pixels: number;
    base_transparent_pixels: number;
    overlay_mapped_pixels: number;
    overlay_visible_pixels: number;
    unused_visible_pixels: number;
    slim_unused_arm_visible_pixels: number;
    partial_alpha_mapped_pixels: number;
  };
  parts: ClassicSkinPartReport[];
  /** Shared PixelCraft diagnostics, never a player-skin quality verdict. */
  pixel_craft: ReturnType<typeof analyzeTexturePixelCraft>;
  issues: ClassicSkinPlanningIssue[];
  warnings: ClassicSkinPlanningWarning[];
  native_verified: false;
  visual_verified: false;
  minecraft_verified: false;
  png_encoded: false;
  skin_pack_written: false;
};

const SIZE = 64;
const LIMIT_SKINS = 128;
const LIMIT_SOURCES = 8;
const SLUG = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FILENAME = /^[a-z0-9_][a-z0-9_-]{0,63}\.png$/;
const EXACT_GEOMETRY = new Set([
  "geometry.humanoid.custom", "geometry.humanoid.customSlim",
]);
const TEMPLATE = [
  { part: "head", base: [0, 0], overlay: [32, 0], height: 8, depth: 8, width: 8 },
  { part: "body", base: [16, 16], overlay: [16, 32], height: 12, depth: 4, width: 8 },
  { part: "right_arm", base: [40, 16], overlay: [40, 32], height: 12, depth: 4, width: 4 },
  { part: "left_arm", base: [32, 48], overlay: [48, 48], height: 12, depth: 4, width: 4 },
  { part: "right_leg", base: [0, 16], overlay: [0, 32], height: 12, depth: 4, width: 4 },
  { part: "left_leg", base: [16, 48], overlay: [0, 48], height: 12, depth: 4, width: 4 },
] as const;

function exact(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string" || !value ||
      value.trim() !== value || value.length > max) {
    throw new Error("CLASSIC_SKIN_IDENTITY_INVALID: " + label);
  }
  return value;
}
function slug(value: unknown, label: string): string {
  const name = exact(value, label, 64);
  if (!SLUG.test(name)) throw new Error("CLASSIC_SKIN_LOCALIZATION_INVALID: " + label);
  return name;
}
function file(value: unknown): string {
  const name = exact(value, "texture_filename", 68);
  if (!FILENAME.test(name)) throw new Error("CLASSIC_SKIN_FILENAME_INVALID");
  return name;
}

/** Mark the six actual Cube faces, not the entire 2D UV bounding rectangle. */
function markBox(
  labels: Uint8Array,
  origin: readonly [number, number],
  width: number,
  depth: number,
  height: number,
  label: number
): void {
  const [u, v] = origin;
  const faces = [
    [u + depth, v, width, depth],              // top
    [u + depth + width, v, width, depth],      // bottom
    [u, v + depth, depth, height],             // first side
    [u + depth, v + depth, width, height],     // front
    [u + depth + width, v + depth, depth, height],
    [u + depth + width + depth, v + depth, width, height],
  ];
  for (const [x, y, w, h] of faces) {
    if (x < 0 || y < 0 || x + w > SIZE || y + h > SIZE) {
      throw new Error("CLASSIC_SKIN_TEMPLATE_OUT_OF_BOUNDS");
    }
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const index = py * SIZE + px;
        if (labels[index] !== 0) {
          throw new Error("CLASSIC_SKIN_TEMPLATE_FACES_OVERLAP");
        }
        labels[index] = label;
      }
    }
  }
}

function skinMask(profile: ClassicSkinBodyProfile) {
  const labels = new Uint8Array(SIZE * SIZE);
  const partReports: ClassicSkinPartReport[] = [];
  for (const [index, item] of TEMPLATE.entries()) {
    const w = item.part === "left_arm" || item.part === "right_arm"
      ? (profile === "ALEX_SLIM" ? 3 : 4)
      : item.width;
    const part = item.part;
    const base = [item.base[0], item.base[1]] as [number, number];
    const overlay = [item.overlay[0], item.overlay[1]] as [number, number];
    markBox(labels, base, w, item.depth, item.height, index * 2 + 1);
    markBox(labels, overlay, w, item.depth, item.height, index * 2 + 2);
    partReports.push({
      part,
      base_mapped_pixels: 0, base_visible_pixels: 0,
      base_transparent_pixels: 0,
      overlay_mapped_pixels: 0, overlay_visible_pixels: 0,
      overlay_partial_alpha_pixels: 0,
    });
  }
  const ignoredSlim = new Set<number>();
  if (profile === "ALEX_SLIM") {
    // Mojang's slim UV cubes are 3x12x4 at the same four arm offsets.
    // Bounding-rectangle columns beyond a 14-wide cube net are ignored.
    for (const item of TEMPLATE.filter(row => row.part.endsWith("_arm"))) {
      for (const [u, v] of [item.base, item.overlay]) {
        for (let y = v; y < v + 16; y++) {
          for (let x = u + 14; x < u + 16; x++) {
            if (labels[y * SIZE + x] !== 0) {
              throw new Error("CLASSIC_SKIN_SLIM_UNUSED_UV_OVERLAP");
            }
            ignoredSlim.add(y * SIZE + x);
          }
        }
      }
    }
  }
  return { labels, partReports, ignoredSlim };
}

export function planBedrockClassicSkin(
  input: ClassicSkinPlanningInput
): ClassicSkinPlanningResult {
  if (!input || typeof input !== "object") {
    throw new Error("CLASSIC_SKIN_INPUT_INVALID");
  }
  if (input.body_profile !== "STEVE_WIDE" && input.body_profile !== "ALEX_SLIM") {
    throw new Error("CLASSIC_SKIN_PROFILE_UNSUPPORTED");
  }
  // Modern 64x64 only. 64x32 legacy and 128x128 HD are valid separate
  // Bedrock cases but deliberately NOT silently handled by this contract.
  if (input.width !== SIZE || input.height !== SIZE) {
    throw new Error("CLASSIC_SKIN_MODERN_64_ONLY");
  }
  if (input.skin_type !== "free" && input.skin_type !== "paid") {
    throw new Error("CLASSIC_SKIN_TYPE_INVALID");
  }
  const packName = slug(input.pack_localization_name, "pack_localization_name");
  const skinName = slug(input.skin_localization_name, "skin_localization_name");
  const texture = file(input.texture_filename);
  const style = input.style_lock_id === undefined
    ? null : exact(input.style_lock_id, "style_lock_id", 128);
  if (!Array.isArray(input.source_refs) || !input.source_refs.length ||
      input.source_refs.length > LIMIT_SOURCES ||
      input.source_refs.some(ref =>
        typeof ref !== "string" || !ref || ref.trim() !== ref || ref.length > 160) ||
      new Set(input.source_refs).size !== input.source_refs.length) {
    throw new Error("CLASSIC_SKIN_SOURCE_REFS_INVALID");
  }
  if (!Array.isArray(input.existing_skins) ||
      input.existing_skins.length > LIMIT_SKINS) {
    throw new Error("CLASSIC_SKIN_INVENTORY_INVALID");
  }
  const existingNames = new Set<string>();
  const existingTextures = new Set<string>();
  for (const current of input.existing_skins) {
    if (!current || typeof current !== "object") {
      throw new Error("CLASSIC_SKIN_INVENTORY_INVALID");
    }
    const name = slug(current.localization_name, "existing.localization_name");
    const t = file(current.texture);
    if (!EXACT_GEOMETRY.has(exact(current.geometry, "existing.geometry", 64))) {
      throw new Error("CLASSIC_SKIN_EXISTING_GEOMETRY_UNSUPPORTED");
    }
    if (existingNames.has(name)) {
      throw new Error("CLASSIC_SKIN_INVENTORY_AMBIGUOUS");
    }
    existingNames.add(name);
    existingTextures.add(t);
  }
  const pixelCount = SIZE * SIZE;
  if (!input.rgba || typeof input.rgba !== "object" ||
      !Number.isSafeInteger(input.rgba.length) ||
      input.rgba.length !== pixelCount * 4) {
    throw new Error("CLASSIC_SKIN_RGBA_LENGTH_INVALID");
  }
  const bitmap = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < bitmap.length; i++) {
    const n = input.rgba[i];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error("CLASSIC_SKIN_RGBA_COMPONENT_INVALID");
    }
    bitmap[i] = n;
  }
  const { labels, partReports, ignoredSlim } = skinMask(input.body_profile);
  let mappedVisible = 0;
  let basePixels = 0;
  let baseTransparent = 0;
  let overlayPixels = 0;
  let overlayVisible = 0;
  let unusedVisible = 0;
  let slimIgnoredVisible = 0;
  let partialAlpha = 0;
  for (let i = 0; i < pixelCount; i++) {
    const alpha = bitmap[i * 4 + 3]!;
    const tag = labels[i]!;
    if (tag === 0) {
      if (alpha > 0) {
        unusedVisible++;
        if (ignoredSlim.has(i)) slimIgnoredVisible++;
      }
      continue;
    }
    const row = partReports[Math.floor((tag - 1) / 2)]!;
    if (tag % 2 === 1) {
      basePixels++;
      row.base_mapped_pixels++;
      if (alpha > 0) {
        mappedVisible++;
        row.base_visible_pixels++;
      } else {
        baseTransparent++;
        row.base_transparent_pixels++;
      }
    } else {
      overlayPixels++;
      row.overlay_mapped_pixels++;
      if (alpha > 0) {
        mappedVisible++;
        overlayVisible++;
        row.overlay_visible_pixels++;
        if (alpha < 255) row.overlay_partial_alpha_pixels++;
      }
    }
    if (alpha > 0 && alpha < 255) partialAlpha++;
  }

  const geometry = input.body_profile === "STEVE_WIDE"
    ? "geometry.humanoid.custom" as const
    : "geometry.humanoid.customSlim" as const;
  const issues: ClassicSkinPlanningIssue[] = [];
  if (mappedVisible === 0) issues.push("SKIN_HAS_NO_MAPPED_VISIBLE_PIXELS");
  if (existingNames.has(skinName)) {
    issues.push("SKIN_LOCALIZATION_NAME_ALREADY_PRESENT");
  }
  const warnings: ClassicSkinPlanningWarning[] = [
    "UV_FACE_ORIENTATION_NOT_ATTESTED",
    "PNG_FILE_NOT_ENCODED_OR_VERIFIED",
    "SKIN_PACK_METADATA_NOT_COMPILED",
    "BODY_PROFILE_NATIVE_PREVIEW_REQUIRED",
  ];
  if (baseTransparent) warnings.push("BASE_SURFACE_TRANSPARENCY_REVIEW");
  if (partReports.some(r => r.base_visible_pixels === 0)) {
    warnings.push("BASE_PART_COMPLETELY_TRANSPARENT_REVIEW");
  }
  if (partReports.some(r => r.base_visible_pixels === 0 && r.overlay_visible_pixels > 0)) {
    warnings.push("OVERLAY_WITH_UNPAINTED_BASE_REVIEW");
  }
  if (partialAlpha) warnings.push("PARTIAL_ALPHA_BEDROCK_RENDER_REVIEW");
  if (unusedVisible) warnings.push("UNUSED_TEMPLATE_PIXEL_REVIEW");
  if (slimIgnoredVisible) warnings.push("SLIM_ARM_UNUSED_COLUMNS_REVIEW");
  if (existingTextures.has(texture)) warnings.push("SHARED_TEXTURE_FILENAME_REVIEW");
  if (style) warnings.push("STYLE_LOCK_VISUAL_REVIEW");

  const bitmap_sha256 = "sha256:" + createHash("sha256")
    .update(bitmap).digest("hex");
  const source_fingerprint = "sha256:" + createHash("sha256")
    .update(JSON.stringify({
      contract: "classic-bedrock-skin-s1-64-v1",
      body_profile: input.body_profile, packName, skinName, texture,
      type: input.skin_type, bitmap_sha256, style,
      source_refs: [...input.source_refs].sort(),
      existing_skins: [...input.existing_skins]
        .map(row => [row.localization_name, row.texture, row.geometry])
        .sort((a,b) => a[0]!.localeCompare(b[0]!)),
    })).digest("hex");

  return {
    state: issues.length
      ? "BLOCKED_BY_DECLARED_SOURCE"
      : "SOURCE_REVIEW_REQUIRED_NATIVE_UNVERIFIED",
    body_profile: input.body_profile,
    model_geometry: geometry,
    arm_width_pixels: input.body_profile === "STEVE_WIDE" ? 4 : 3,
    candidate_skins_json_entry: {
      localization_name: skinName, geometry,
      texture, type: input.skin_type,
    },
    candidate_localization_key: "skin." + packName + "." + skinName,
    proposed_png_filename: texture,
    bitmap_sha256, source_fingerprint,
    canvas: {
      width: 64, height: 64,
      mapped_visible_pixels: mappedVisible,
      base_mapped_pixels: basePixels,
      base_transparent_pixels: baseTransparent,
      overlay_mapped_pixels: overlayPixels,
      overlay_visible_pixels: overlayVisible,
      unused_visible_pixels: unusedVisible,
      slim_unused_arm_visible_pixels: slimIgnoredVisible,
      partial_alpha_mapped_pixels: partialAlpha,
    },
    parts: partReports,
    pixel_craft: analyzeTexturePixelCraft(bitmap, SIZE, SIZE),
    issues, warnings,
    native_verified: false, visual_verified: false, minecraft_verified: false,
    png_encoded: false, skin_pack_written: false,
  };
}
