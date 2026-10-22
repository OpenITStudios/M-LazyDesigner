/// <reference types="blockbench-types" />

import { z } from "zod";
import { DEFAULT_BEDROCK_UV_RESOLUTION } from "../project/project";
import { pbrChannelEnum } from "@/lib/schemas/texture";

export type TextureProductionRole =
  | "base_color_candidate"
  | "explicit_variant"
  | "pbr_support";

export type TextureRoleMetadata = {
  pbr_channel?: string | null;
  has_group: boolean;
  group_is_material?: boolean | null;
};

export function classifyTextureProductionRole(
  metadata: TextureRoleMetadata
): TextureProductionRole {
  const channel = metadata.pbr_channel ?? "color";
  if (channel !== "color") return "pbr_support";
  if (metadata.has_group && metadata.group_is_material === false) {
    return "explicit_variant";
  }
  return "base_color_candidate";
}

export function isAiProductionColorCanvas(
  width: number,
  height: number
): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width === height &&
    width >= DEFAULT_BEDROCK_UV_RESOLUTION &&
    width % DEFAULT_BEDROCK_UV_RESOLUTION === 0
  );
}

export function isProvisionalTextureCanvas(
  width: number,
  height: number
): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width === height &&
    width >= 16 &&
    width <= 1024 &&
    width % 16 === 0
  );
}

export const UV_ATLAS_AUDIT_EXAMPLE_LIMIT = 6;

export type UvAtlasUsage = {
  cube_uuid: string;
  cube_name: string;
  face: string;
  uv: readonly number[];
  // Distinct texture bitmaps are separate UV overlap ownership domains.
  // Optional for imported/legacy diagnostic fixtures with unknown identity.
  texture_uuid?: string | null;
  box_uv: boolean;
  autouv: number;
  mirror_uv: boolean;
  face_rotation: number;
  surface_area?: number;
  pixel_scale?: readonly [number, number];
};

type NormalizedUvUsage = UvAtlasUsage & {
  rect: [number, number, number, number];
};

function normalizedUvRect(
  values: readonly number[]
): [number, number, number, number] | null {
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return [
    Math.min(values[0], values[2]),
    Math.min(values[1], values[3]),
    Math.max(values[0], values[2]),
    Math.max(values[1], values[3]),
  ];
}

function uvUsageExample(usage: UvAtlasUsage) {
  return {
    cube_uuid: usage.cube_uuid,
    cube_name: usage.cube_name,
    face: usage.face,
    ...(usage.texture_uuid ? { texture_uuid: usage.texture_uuid } : {}),
    uv: [...usage.uv],
    box_uv: usage.box_uv,
    autouv: usage.autouv,
    mirror_uv: usage.mirror_uv,
    face_rotation: usage.face_rotation,
  };
}

function uvRectArea(rect: readonly number[]): number {
  return Math.max(0, rect[2] - rect[0]) * Math.max(0, rect[3] - rect[1]);
}

function uvRectsEqual(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function uvRectIntersection(
  a: readonly number[],
  b: readonly number[]
): [number, number, number, number] | null {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  if (left >= right || top >= bottom) return null;
  return [left, top, right, bottom];
}

function boundedExamples<T>(
  values: readonly T[],
  limit: number
): { examples: T[]; examples_truncated: boolean } {
  return {
    examples: values.slice(0, limit),
    examples_truncated: values.length > limit,
  };
}

export function buildUvAtlasAudit(
  usages: readonly UvAtlasUsage[],
  logicalWidth: number | null | undefined,
  logicalHeight: number | null | undefined,
  exampleLimit: number = UV_ATLAS_AUDIT_EXAMPLE_LIMIT
) {
  if (
    typeof logicalWidth !== "number" ||
    typeof logicalHeight !== "number" ||
    !Number.isFinite(logicalWidth) ||
    !Number.isFinite(logicalHeight) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0
  ) {
    return {
      state: "unavailable" as const,
      reason: "logical_uv_canvas_unavailable" as const,
      enabled_faces: usages.length,
    };
  }

  const width = logicalWidth;
  const height = logicalHeight;
  const invalidUv: UvAtlasUsage[] = [];
  const valid: NormalizedUvUsage[] = [];

  for (const usage of usages) {
    const rect = normalizedUvRect(usage.uv);
    if (!rect) {
      invalidUv.push(usage);
      continue;
    }
    valid.push({ ...usage, rect });
  }

  const outOfBounds = valid.filter(
    ({ rect }) =>
      rect[0] < 0 ||
      rect[1] < 0 ||
      rect[2] > width ||
      rect[3] > height
  );
  const fractionalUv = valid.filter(({ uv }) =>
    uv.some((value) => !Number.isInteger(value))
  );
  const nonIntegralPixels = valid.filter(({ uv, pixel_scale = [1, 1] }) =>
    pixel_scale.some(value => !Number.isFinite(value) || value <= 0) ||
    uv.some((value, axis) => !Number.isInteger(value * pixel_scale[axis % 2]))
  );
  const degenerateUv = valid.filter(({ rect }) => uvRectArea(rect) === 0);
  const collapsedSurfaceUv = degenerateUv.filter(({ surface_area }) => surface_area === undefined || surface_area > 0);

  const unlockedByCube = new Map<string, UvAtlasUsage>();
  for (const usage of valid) {
    if (usage.box_uv && usage.autouv !== 0 && !unlockedByCube.has(usage.cube_uuid)) {
      unlockedByCube.set(usage.cube_uuid, usage);
    }
  }
  const unlocked = [...unlockedByCube.values()];

  const reusable = valid.filter(({ rect }) => uvRectArea(rect) > 0);
  const exactReuseMap = new Map<string, NormalizedUvUsage[]>();
  for (const usage of reusable) {
    // Equal logical rectangles on different bitmap UUIDs are not reused
    // physical texels. Preserve legacy one-atlas behavior when UUID is absent.
    const key = JSON.stringify([usage.texture_uuid ?? null, ...usage.rect]);
    const group = exactReuseMap.get(key) ?? [];
    group.push(usage);
    exactReuseMap.set(key, group);
  }

  const exactReuseGroups = [...exactReuseMap.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      rect: group[0].rect,
      owner_count: group.length,
      owners: group
        .slice(0, exampleLimit)
        .map((usage) => uvUsageExample(usage)),
      owners_truncated: group.length > exampleLimit,
    }));

  const sorted = [...reusable].sort(
    (a, b) =>
      a.rect[0] - b.rect[0] ||
      a.rect[2] - b.rect[2] ||
      a.rect[1] - b.rect[1]
  );
  let partialOverlapPairCount = 0;
  const partialOverlapExamples: Array<{
    a: ReturnType<typeof uvUsageExample>;
    b: ReturnType<typeof uvUsageExample>;
    intersection: [number, number, number, number];
  }> = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b.rect[0] >= a.rect[2]) break;
      // Different known bitmap owners cannot collide physically even when
      // their logical UV coordinates overlap. Unknown identity stays
      // conservative instead of suppressing a possible same-atlas conflict.
      if (a.texture_uuid && b.texture_uuid &&
          a.texture_uuid !== b.texture_uuid) continue;
      if (uvRectsEqual(a.rect, b.rect)) continue;
      const intersection = uvRectIntersection(a.rect, b.rect);
      if (!intersection) continue;
      partialOverlapPairCount += 1;
      if (partialOverlapExamples.length < exampleLimit) {
        partialOverlapExamples.push({
          a: uvUsageExample(a),
          b: uvUsageExample(b),
          intersection,
        });
      }
    }
  }

  const reasons: string[] = [];
  if (invalidUv.length > 0) reasons.push("INVALID_UV");
  if (outOfBounds.length > 0) reasons.push("OUT_OF_BOUNDS");
  if (nonIntegralPixels.length > 0) reasons.push("NON_INTEGRAL_PIXEL_MAPPING");
  if (unlocked.length > 0) reasons.push("BOX_UV_AUTOUV_UNLOCKED");
  if (partialOverlapPairCount > 0) reasons.push("PARTIAL_OVERLAP");
  if (collapsedSurfaceUv.length > 0) reasons.push("COLLAPSED_SURFACE_UV");

  const invalidBounded = boundedExamples(
    invalidUv.map(uvUsageExample),
    exampleLimit
  );
  const outOfBoundsBounded = boundedExamples(
    outOfBounds.map(uvUsageExample),
    exampleLimit
  );
  const fractionalBounded = boundedExamples(
    fractionalUv.map(uvUsageExample),
    exampleLimit
  );
  const degenerateBounded = boundedExamples(
    degenerateUv.map(uvUsageExample),
    exampleLimit
  );
  const unlockedBounded = boundedExamples(
    unlocked.map(uvUsageExample),
    exampleLimit
  );
  const reuseBounded = boundedExamples(exactReuseGroups, exampleLimit);

  // Exact rectangle union in logical UV units; reuse/partial overlap must not
  // inflate occupancy. Clip to the canvas while retaining out-of-bounds errors.
  const clipped = reusable.map(({ rect }) => [
    Math.max(0, rect[0]), Math.max(0, rect[1]),
    Math.min(width, rect[2]), Math.min(height, rect[3]),
  ]).filter(r => r[2] > r[0] && r[3] > r[1]);
  const xs = [...new Set(clipped.flatMap(r => [r[0], r[2]]))].sort((a, b) => a - b);
  let occupiedArea = 0;
  for (let i = 1; i < xs.length; i++) {
    const intervals = clipped.filter(r => r[0] < xs[i] && r[2] > xs[i - 1])
      .map(r => [r[1], r[3]]).sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    let span = 0;
    for (const [lo, hi] of intervals) {
      span += Math.max(0, hi - Math.max(lo, end));
      end = Math.max(end, hi);
    }
    occupiedArea += (xs[i] - xs[i - 1]) * span;
  }
  const bounds = clipped.length ? {
    min: [Math.min(...clipped.map(r => r[0])), Math.min(...clipped.map(r => r[1]))],
    max: [Math.max(...clipped.map(r => r[2])), Math.max(...clipped.map(r => r[3]))],
  } : null;

  return {
    state: "available" as const,
    logical_canvas: { width, height },
    packing: {
      units: "logical_uv_units" as const,
      face_area: reusable.reduce((sum, usage) => sum + uvRectArea(usage.rect), 0),
      occupied_area: occupiedArea,
      occupancy_ratio: occupiedArea / (width * height),
      occupied_bounds: bounds,
      occupied_size: bounds ? [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]] : [0, 0],
      padding: "unverified" as const,
      // Native Box-UV nets contain valid touching faces. A global face-gap
      // threshold cannot certify island padding or a smaller feasible atlas.
    },
    enabled_faces: usages.length,
    valid_uv_faces: valid.length,
    invalid_uv: {
      count: invalidUv.length,
      ...invalidBounded,
    },
    out_of_bounds: {
      count: outOfBounds.length,
      ...outOfBoundsBounded,
    },
    fractional_uv: {
      count: fractionalUv.length,
      ...fractionalBounded,
    },
    non_integral_pixel_mapping: {
      count: nonIntegralPixels.length,
      ...boundedExamples(nonIntegralPixels.map(uvUsageExample), exampleLimit),
    },
    degenerate_uv: {
      count: degenerateUv.length,
      ...degenerateBounded,
    },
    collapsed_surface_uv: {
      count: collapsedSurfaceUv.length,
      ...boundedExamples(collapsedSurfaceUv.map(uvUsageExample), exampleLimit),
    },
    unlocked_box_uv_cubes: {
      count: unlocked.length,
      ...unlockedBounded,
    },
    exact_reuse: {
      region_count: exactReuseGroups.length,
      ...reuseBounded,
    },
    partial_overlap: {
      pair_count: partialOverlapPairCount,
      examples: partialOverlapExamples,
      examples_truncated: partialOverlapPairCount > partialOverlapExamples.length,
    },
    production_gate: {
      state: reasons.length === 0 ? ("ready" as const) : ("review_required" as const),
      reasons,
    },
  };
}

const CUBE_FACE_KEYS = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;

export function collectUvAtlasUsages(): UvAtlasUsage[] {
  if (!Project) return [];

  const usages: UvAtlasUsage[] = [];
  for (const cube of Cube.all) {
    for (const faceKey of CUBE_FACE_KEYS) {
      const face = cube.faces[faceKey];
      if (!face || face.enabled === false || face.texture === null) continue;
      const size = cube.size();
      const texture = face.getTexture();
      const axes = faceKey === "up" || faceKey === "down" ? [0, 2] : faceKey === "east" || faceKey === "west" ? [2, 1] : [0, 1];
      usages.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        face: faceKey,
        texture_uuid: texture?.uuid ?? null,
        uv: [...face.uv],
        box_uv: cube.box_uv === true,
        autouv: cube.autouv,
        mirror_uv: cube.mirror_uv === true,
        face_rotation: face.rotation,
        surface_area: Math.abs(size[axes[0]] * size[axes[1]]),
        pixel_scale: texture ? [
          texture.width / texture.getUVWidth(),
          // Animated bitmap height stacks all frames vertically. Logical UV
          // V maps into one displayed frame, not the entire PNG frame stack.
          texture.display_height / texture.getUVHeight(),
        ] : undefined,
      });
    }
  }
  return usages;
}

function textureGroupFor(texture: Texture): TextureGroup | null {
  if (!texture.group) return null;
  return (
    TextureGroup.all.find(
      (group: TextureGroup) => group.uuid === texture.group
    ) ?? null
  );
}

export function textureProductionRole(texture: Texture): TextureProductionRole {
  const group = textureGroupFor(texture);
  return classifyTextureProductionRole({
    pbr_channel: texture.pbr_channel ?? "color",
    has_group: Boolean(texture.group),
    group_is_material: group?.is_material ?? null,
  });
}

function safeTextureRatio(
  pixels: number,
  uvUnits: number
): number | null {
  if (
    !Number.isFinite(pixels) ||
    !Number.isFinite(uvUnits) ||
    pixels <= 0 ||
    uvUnits <= 0
  ) {
    return null;
  }
  return pixels / uvUnits;
}

export function textureInventoryEntry(texture: Texture) {
  const group = textureGroupFor(texture);
  const uvWidth = texture.getUVWidth();
  const uvHeight = texture.getUVHeight();
  const displayHeight = texture.display_height;

  return {
    name: texture.name,
    uuid: texture.uuid,
    id: texture.id,
    role: textureProductionRole(texture),
    group: group
      ? {
          uuid: group.uuid,
          name: group.name,
          is_material: group.is_material,
        }
      : null,
    pbr_channel: texture.pbr_channel || "color",
    is_default: Texture.getDefault()?.uuid === texture.uuid,
    is_selected: Texture.selected?.uuid === texture.uuid,
    bitmap: {
      width: texture.width,
      height: texture.height,
      display_height: displayHeight,
    },
    logical_uv: {
      width: uvWidth,
      height: uvHeight,
    },
    physical_pixels_per_uv_unit: {
      x: safeTextureRatio(texture.width, uvWidth),
      y: safeTextureRatio(displayHeight, uvHeight),
    },
    animated: texture.height !== displayHeight,
    render_mode: texture.render_mode,
    render_sides: texture.render_sides,
  };
}

export function currentTextureInventory() {
  const textures = Project?.textures ?? Texture.all;
  const entries = textures.map(textureInventoryEntry);
  const baseColorCandidates = entries.filter(
    (entry) => entry.role === "base_color_candidate"
  );
  const explicitVariants = entries.filter(
    (entry) => entry.role === "explicit_variant"
  );
  const pbrSupport = entries.filter(
    (entry) => entry.role === "pbr_support"
  );

  return {
    state:
      baseColorCandidates.length === 0
        ? ("none" as const)
        : baseColorCandidates.length === 1
          ? ("single" as const)
          : ("fragmented" as const),
    base_color_candidates: baseColorCandidates.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      group: entry.group,
      bitmap: entry.bitmap,
    })),
    explicit_variants: explicitVariants.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      group: entry.group,
      bitmap: entry.bitmap,
    })),
    pbr_support: pbrSupport.map((entry) => ({
      uuid: entry.uuid,
      name: entry.name,
      pbr_channel: entry.pbr_channel,
      group: entry.group,
      bitmap: entry.bitmap,
    })),
    default_texture_uuid: Texture.getDefault()?.uuid ?? null,
    selected_texture_uuid: Texture.selected?.uuid ?? null,
    textures: entries,
  };
}

export function requireTextureCreationPreflight(params: {
  width: number;
  height: number;
  data?: string;
  pbr_channel?: z.infer<typeof pbrChannelEnum>;
  textureGroup?: TextureGroup;
}): void {
  const requestedRole = classifyTextureProductionRole({
    pbr_channel: params.pbr_channel ?? "color",
    has_group: Boolean(params.textureGroup),
    group_is_material: params.textureGroup?.is_material ?? null,
  });

  const existingTextures = Project?.textures ?? Texture.all;
  const existingBase = existingTextures.filter(
    (texture) => textureProductionRole(texture) === "base_color_candidate"
  );

  if (requestedRole === "base_color_candidate") {
    if (existingBase.length > 0) {
      const [first] = existingBase;
      throw new Error(
        `A base-color atlas already exists: "${first.name}" (${first.uuid}). Reuse that atlas instead of creating a color texture per body part/material zone. Explicit color variants must be placed in an explicit non-material TextureGroup.`
      );
    }
    if (
      params.data === undefined &&
      !isAiProductionColorCanvas(params.width, params.height) &&
      !isProvisionalTextureCanvas(params.width, params.height)
    ) {
      throw new Error(
        `New AI-authored base-color atlases must use a square 128-based canvas (128, 256, 384, 512, ...) for production; provisional 16-based 16..1024 also allowed. Received ${params.width}×${params.height}. Existing imported texture data may retain authored dimensions.`
      );
    }
    return;
  }

  if (requestedRole === "explicit_variant") {
    if (existingBase.length !== 1) {
      throw new Error(
        `An explicit color variant requires exactly one established base-color atlas; found ${existingBase.length}. Resolve the base atlas first.`
      );
    }
    if (
      params.data === undefined &&
      (params.width !== existingBase[0].width ||
        params.height !== existingBase[0].height)
    ) {
      throw new Error(
        `A new AI-authored color variant must match the base atlas bitmap size ${existingBase[0].width}×${existingBase[0].height}; received ${params.width}×${params.height}.`
      );
    }
    return;
  }

  if (params.textureGroup?.is_material !== true) {
    throw new Error(
      "PBR support textures require an explicit material TextureGroup. Use create_pbr_material/add the support texture to that material instead of a variant/non-material group."
    );
  }

  if (params.data !== undefined) return;

  if (existingBase.length !== 1) {
    throw new Error(
      `A new PBR support texture requires exactly one established base-color atlas; found ${existingBase.length}. Create/resolve the base atlas first.`
    );
  }
  if (
    params.width !== existingBase[0].width ||
    params.height !== existingBase[0].height
  ) {
    throw new Error(
      `New PBR support textures must match the base atlas bitmap size ${existingBase[0].width}×${existingBase[0].height}; received ${params.width}×${params.height}.`
    );
  }
}