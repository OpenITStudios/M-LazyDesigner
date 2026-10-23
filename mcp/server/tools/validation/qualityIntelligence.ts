/// <reference types="three" />
/// <reference types="blockbench-types" />
import {
  ensureTextureDiagnosticInvocationContext,
  hasTextureDiagnosticRegion,
  isTextureDiagnosticBudgetExceeded,
  readTextureDiagnosticRegion,
} from "@/lib/texture/diagnosticReadContext";

import { getAllToolDefinitions } from "@/lib/factories";
import { isIntegralPhysicalPixelCoordinate } from "@/lib/uv/facePixelMapping";
import { analyzeGeometryHygiene } from "@/lib/geometry/quality";
import { analyzeTextureColorProfile } from "@/lib/texture/colorProfile";
import { analyzeTexturePixelCraft } from "@/lib/texture/pixelCraft";
import {
  analyzeRootMotionTracks,
  type RootMotionTrackInput,
} from "@/lib/animation/rootMotionAnalysis";
import {
  analyzeRigGraph,
  summarizeSurfaceQualityWarnings,
} from "@/lib/geometry/modelQuality";
import {
  analyzeTextureOptimizationOpportunities,
  type TextureFacePatchInput,
  type TextureScanOmission,
} from "@/lib/texture/optimization";
import {
  analyzeAnimationQuality,
  type AnimationQualityChannel,
  type AnimationQualityTrackInput,
} from "@/lib/animation/quality";
import {
  analyzeAnimationCraftEvidence,
  type AnimationCraftTrackInput,
} from "@/lib/animation/craftEvidence";

const wiredTools = new Set<string>();
const CUBE_FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const TEXTURE_OPTIMIZATION_PIXEL_BUDGET = 32_768;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}


function geometryHygieneRuntime() {
  if (typeof Cube === "undefined" || typeof Group === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_geometry_runtime_unavailable" as const,
    };
  }
  return analyzeGeometryHygiene(
    (Cube.all ?? []).map((cube: Cube) => ({
      uuid: cube.uuid,
      name: cube.name,
      from: [...cube.from],
      to: [...cube.to],
      origin: [...cube.origin],
      rotation: [...cube.rotation],
      inflate: cube.inflate ?? 0,
      box_uv: cube.box_uv === true ||
        (cube.box_uv !== false && Project?.box_uv === true),
    })),
    (Group.all ?? []).map((group: Group) => ({
      uuid: group.uuid,
      name: group.name,
    }))
  );
}

function surfaceQualitySummaryRuntime(
  structuredContent: Record<string, unknown>
) {
  const warnings = Array.isArray(structuredContent.warnings)
    ? structuredContent.warnings.filter(
        (warning): warning is string => typeof warning === "string"
      )
    : [];
  return summarizeSurfaceQualityWarnings(warnings);
}

function rigGraphRuntime() {
  if (typeof Group === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_group_runtime_unavailable" as const,
    };
  }

  return analyzeRigGraph(
    (Group.all ?? []).map((group: Group) => ({
      uuid: group.uuid,
      name: group.name,
      origin: [...group.origin],
      parent_uuid:
        group.parent instanceof Group ? group.parent.uuid : null,
    }))
  );
}

function textureColorProfileRuntime(
  structuredContent: Record<string, unknown>
) {
  if (typeof Texture === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_texture_runtime_unavailable" as const,
    };
  }
  const textureInfo = objectRecord(structuredContent.texture);
  const uuid = typeof textureInfo?.uuid === "string" ? textureInfo.uuid : null;
  const texture = uuid
    ? Texture.all.find((candidate: Texture) => candidate.uuid === uuid)
    : undefined;
  if (!texture) {
    return {
      state: "unavailable" as const,
      reason: "inspected_texture_not_resolved" as const,
    };
  }

  try {
    const ctx = texture.ctx;
    const width = ctx?.canvas?.width ?? texture.width;
    const height =
      ctx?.canvas?.height ?? texture.display_height ?? texture.height;
    if (
      !ctx ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return {
        state: "unavailable" as const,
        reason: "texture_pixel_canvas_unavailable" as const,
      };
    }
    const pixels = ctx.getImageData(0, 0, width, height).data;
    return analyzeTextureColorProfile(pixels, width, height);
  } catch {
    return {
      state: "unavailable" as const,
      reason: "texture_pixel_read_failed" as const,
    };
  }
}


function texturePixelCraftRuntime(
  structuredContent: Record<string, unknown>
) {
  if (typeof Texture === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_texture_runtime_unavailable" as const,
    };
  }
  const textureInfo = objectRecord(structuredContent.texture);
  const uuid = typeof textureInfo?.uuid === "string" ? textureInfo.uuid : null;
  const texture = uuid
    ? Texture.all.find((candidate: Texture) => candidate.uuid === uuid)
    : undefined;
  if (!texture) {
    return {
      state: "unavailable" as const,
      reason: "inspected_texture_not_resolved" as const,
    };
  }

  try {
    const ctx = texture.ctx;
    const bitmapWidth = ctx?.canvas?.width ?? texture.width;
    const bitmapHeight =
      ctx?.canvas?.height ?? texture.display_height ?? texture.height;
    if (
      !ctx ||
      !Number.isInteger(bitmapWidth) ||
      !Number.isInteger(bitmapHeight) ||
      bitmapWidth <= 0 ||
      bitmapHeight <= 0
    ) {
      return {
        state: "unavailable" as const,
        reason: "texture_pixel_canvas_unavailable" as const,
      };
    }

    const regionInfo = objectRecord(structuredContent.region);
    const region =
      regionInfo &&
      ["x", "y", "width", "height"].every(
        (key) =>
          typeof regionInfo[key] === "number" &&
          Number.isInteger(regionInfo[key])
      )
        ? {
            x: regionInfo.x as number,
            y: regionInfo.y as number,
            width: regionInfo.width as number,
            height: regionInfo.height as number,
          }
        : { x: 0, y: 0, width: bitmapWidth, height: bitmapHeight };

    if (
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > bitmapWidth ||
      region.y + region.height > bitmapHeight
    ) {
      return {
        state: "unavailable" as const,
        reason: "texture_evidence_region_invalid" as const,
      };
    }

    const pixels = ctx.getImageData(
      region.x,
      region.y,
      region.width,
      region.height
    ).data;
    return {
      ...analyzeTexturePixelCraft(
        pixels,
        region.width,
        region.height
      ),
      source_region: region,
    };
  } catch {
    return {
      state: "unavailable" as const,
      reason: "texture_pixel_read_failed" as const,
    };
  }
}

export function textureOptimizationRuntime(context?: unknown) {
  if (typeof Cube === "undefined" || typeof Texture === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_texture_runtime_unavailable" as const,
    };
  }

  const patches: TextureFacePatchInput[] = [];
  const omissions: TextureScanOmission[] = [];
  // Invocation-local: never reuse pixels across edits or texture identities.
  const regions = new Map<string, Uint8ClampedArray>();
  let pixelBudgetUsed = 0;

  const omit = (
    kind: TextureScanOmission["kind"],
    cube: Cube,
    face: string
  ) => omissions.push({ kind, cube_uuid: cube.uuid, cube_name: cube.name, face });

  // Scan each orientation across the model before proceeding to the next.
  // Under a finite shared pixel budget, a cube-major north-first traversal
  // could exhaust reads before ever visiting small soles/undersides. Prefer
  // a fixed coverage-first order; omissions still mark incomplete evidence.
  const faceScanOrder = ["down", "up", "south", "north", "west", "east"] as const;
  const scanCubes = [...(Cube.all ?? [])].sort((a, b) =>
    a.uuid.localeCompare(b.uuid)
  );
  for (const faceKey of faceScanOrder) {
    for (const cube of scanCubes) {
      const face = cube.faces[faceKey];
      if (!face || face.enabled === false) continue;

      const texture = face.getTexture();
      if (!texture) {
        omit(face.texture === null ? "blank" : "unresolved_texture", cube, faceKey);
        continue;
      }

      const uv = [...face.uv];
      if (uv.length !== 4 || uv.some((value) => !Number.isFinite(value))) {
        omit("invalid_uv", cube, faceKey);
        continue;
      }
      const ctx = texture.ctx;
      const pixelWidth = ctx?.canvas?.width;
      const pixelHeight = ctx?.canvas?.height;
      const uvWidth = texture.getUVWidth();
      const uvHeight = texture.getUVHeight();
      if (
        !ctx ||
        !Number.isInteger(pixelWidth) ||
        !Number.isInteger(pixelHeight) ||
        pixelWidth <= 0 ||
        pixelHeight <= 0 ||
        !Number.isFinite(uvWidth) ||
        !Number.isFinite(uvHeight) ||
        uvWidth <= 0 ||
        uvHeight <= 0
      ) {
        omit("non_integral_pixel_mapping", cube, faceKey);
        continue;
      }

      const ratioX = pixelWidth / uvWidth;
      const ratioY = pixelHeight / uvHeight;
      const mapped = [
        uv[0] * ratioX,
        uv[1] * ratioY,
        uv[2] * ratioX,
        uv[3] * ratioY,
      ];
      if (mapped.some((value) => !isIntegralPhysicalPixelCoordinate(value))) {
        omit("non_integral_pixel_mapping", cube, faceKey);
        continue;
      }

      // The grid predicate allows machine epsilon; pixel reads still require
      // exact integer region coordinates and dimensions.
      const texelCorners = mapped.map((value) => Math.round(value));
      const left = Math.min(texelCorners[0], texelCorners[2]);
      const top = Math.min(texelCorners[1], texelCorners[3]);
      const right = Math.max(texelCorners[0], texelCorners[2]);
      const bottom = Math.max(texelCorners[1], texelCorners[3]);
      const width = right - left;
      const height = bottom - top;
      if (width <= 0 || height <= 0) {
        omit("degenerate_uv", cube, faceKey);
        continue;
      }
      if (
        left < 0 ||
        top < 0 ||
        right > pixelWidth ||
        bottom > pixelHeight
      ) {
        omit("non_integral_pixel_mapping", cube, faceKey);
        continue;
      }

      const pixelCount = width * height;
      const regionKey = JSON.stringify([texture.uuid, left, top, width, height]);
      const cached = regions.get(regionKey);
      const sharedCached = hasTextureDiagnosticRegion(
        context,
        texture,
        left,
        top,
        width,
        height
      );
      if (
        !cached &&
        !sharedCached &&
        pixelBudgetUsed + pixelCount > TEXTURE_OPTIMIZATION_PIXEL_BUDGET
      ) {
        omit("budget", cube, faceKey);
        continue;
      }

      try {
        const shared = cached
          ? { pixels: cached, cache_hit: true }
          : readTextureDiagnosticRegion(
              context,
              texture,
              left,
              top,
              width,
              height
            );
        const pixels = shared.pixels;
        if (!cached) {
          regions.set(regionKey, pixels);
          if (!shared.cache_hit) pixelBudgetUsed += pixelCount;
        }
        patches.push({
          cube_uuid: cube.uuid,
          cube_name: cube.name,
          face: faceKey,
          texture_uuid: texture.uuid,
          texture_name: texture.name,
          uv,
          width,
          height,
          pixels,
        });
      } catch (error) {
        omit(
          isTextureDiagnosticBudgetExceeded(error)
            ? "budget"
            : "non_integral_pixel_mapping",
          cube,
          faceKey
        );
      }
    }
  }

  return {
    ...analyzeTextureOptimizationOpportunities(patches, omissions),
    pixel_budget: TEXTURE_OPTIMIZATION_PIXEL_BUDGET,
    pixel_budget_basis: "unique_texture_regions" as const,
    pixel_budget_used: pixelBudgetUsed,
  };
}

function isAnimationControllerRuntime(item: unknown): boolean {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function resolveAuthoredAnimationRuntime(
  structuredContent: Record<string, unknown>
): BBAnimation | null {
  if (
    structuredContent.authored_space !== "blockbench_animation" ||
    typeof AnimationItem === "undefined"
  ) {
    return null;
  }
  const animationInfo = objectRecord(structuredContent.animation);
  const animationUuid =
    typeof animationInfo?.uuid === "string" ? animationInfo.uuid : null;
  if (!animationUuid) return null;
  const item = (AnimationItem.all as unknown[]).find(
    (candidate) => objectRecord(candidate)?.uuid === animationUuid
  );
  if (!item || isAnimationControllerRuntime(item)) return null;
  return item as BBAnimation;
}

function rootMotionRuntime(structuredContent: Record<string, unknown>) {
  if (
    typeof Group === "undefined" ||
    typeof BoneAnimator === "undefined"
  ) {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_runtime_unavailable" as const,
    };
  }

  const animation = resolveAuthoredAnimationRuntime(structuredContent);
  if (!animation) {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_not_resolved" as const,
    };
  }

  const rootGroups = Group.all.filter((group: Group) => {
    const parent = group.parent as unknown;
    return parent === "root" || parent === null || parent === undefined;
  });
  const tracks: RootMotionTrackInput[] = [];
  for (const group of rootGroups) {
    const animator = animation.animators[group.uuid];
    if (!(animator instanceof BoneAnimator)) continue;
    const keyframes = ((animator.position as BBKeyframe[] | undefined) ?? [])
      .slice()
      .sort((left, right) => left.time - right.time)
      .map((keyframe) => ({
        time: keyframe.time,
        value: keyframe.getArray(0) as unknown[],
      }));
    if (keyframes.length === 0) continue;
    tracks.push({ uuid: group.uuid, name: group.name, keyframes });
  }

  return analyzeRootMotionTracks(tracks);
}

function animationQualityRuntime(structuredContent: Record<string, unknown>) {
  if (typeof Group === "undefined" || typeof BoneAnimator === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_runtime_unavailable" as const,
    };
  }
  const animation = resolveAuthoredAnimationRuntime(structuredContent);
  if (!animation) {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_not_resolved" as const,
    };
  }

  const tracks: AnimationQualityTrackInput[] = [];
  for (const animator of Object.values(animation.animators)) {
    if (!(animator instanceof BoneAnimator)) continue;
    const group = Group.all.find((candidate: Group) => candidate.uuid === animator.uuid);
    const isRoot = Boolean(
      group &&
        (group.parent === "root" || group.parent === null || group.parent === undefined)
    );

    for (const channel of ["position", "rotation", "scale"] as const satisfies readonly AnimationQualityChannel[]) {
      const keyframes = ((animator[channel] as BBKeyframe[] | undefined) ?? []).map(
        (keyframe) => ({
          time: keyframe.time,
          value: keyframe.getArray(0) as unknown[],
          interpolation: keyframe.interpolation,
          has_multiple_data_points: keyframe.data_points.length > 1,
        })
      );
      if (keyframes.length === 0) continue;
      tracks.push({
        group_uuid: animator.uuid,
        group_name: group?.name ?? animator.name,
        is_root: isRoot,
        channel,
        keyframes,
      });
    }
  }

  return analyzeAnimationQuality({
    loop_mode: String(animation.loop),
    length: animation.length,
    tracks,
  });
}


function animationCraftRuntime(structuredContent: Record<string, unknown>) {
  if (typeof Group === "undefined" || typeof BoneAnimator === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_runtime_unavailable" as const,
    };
  }
  const animation = resolveAuthoredAnimationRuntime(structuredContent);
  if (!animation) {
    return {
      state: "unavailable" as const,
      reason: "authored_animation_not_resolved" as const,
    };
  }

  const tracks: AnimationCraftTrackInput[] = [];
  for (const animator of Object.values(animation.animators)) {
    if (!(animator instanceof BoneAnimator)) continue;
    const group = Group.all.find(
      (candidate: Group) => candidate.uuid === animator.uuid
    );

    for (const channel of ["position", "rotation", "scale"] as const) {
      const keyframes = ((animator[channel] as BBKeyframe[] | undefined) ?? [])
        .slice()
        .sort((left, right) => left.time - right.time)
        .map((keyframe) => ({
          time: keyframe.time,
          value: keyframe.getArray(0) as unknown[],
        }));
      if (keyframes.length === 0) continue;
      tracks.push({
        group_uuid: animator.uuid,
        group_name: group?.name ?? animator.name,
        channel,
        keyframes,
      });
    }
  }

  return analyzeAnimationCraftEvidence({
    length: animation.length,
    tracks,
  });
}

type ToolAugmentation = {
  field: string;
  read: (
    structuredContent: Record<string, unknown>,
    context?: unknown
  ) => unknown;
};

function wireTool(
  toolName: string,
  augmentations: readonly ToolAugmentation[]
): void {
  if (wiredTools.has(toolName)) return;
  const definition = getAllToolDefinitions()[toolName];
  if (!definition) return;
  const execute = definition.execute;
  definition.execute = async (args, context) => {
    const invocationContext =
      toolName === "list_textures"
        ? ensureTextureDiagnosticInvocationContext(context)
        : context;
    const result = await execute(args, invocationContext);
    if (
      (toolName === "inspect_animation" && args.diagnostics !== true) ||
      (toolName === "list_textures" &&
        (args.diagnostics !== true ||
          !["coverage", "full"].includes(
            typeof args.diagnostic_scope === "string"
              ? args.diagnostic_scope
              : "full"
          )))
    ) return result;
    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (!structured) return result;

    const additions: Record<string, unknown> = {};
    for (const augmentation of augmentations) {
      additions[augmentation.field] = augmentation.read(
        structured,
        invocationContext
      );
    }

    return {
      ...record,
      structuredContent: {
        ...structured,
        ...additions,
      },
    } as typeof result;
  };
  wiredTools.add(toolName);
}

/**
 * Adds bounded, read-only authoring intelligence to existing focused read tools.
 * No MCP Tool is added and no input/public discovery schema changes.
 */
export function wireAuthoringQualityIntelligence(): void {
  wireTool("inspect_model_bounds", [
    { field: "geometry_hygiene", read: () => geometryHygieneRuntime() },
    { field: "surface_quality_summary", read: surfaceQualitySummaryRuntime },
    { field: "rig_graph", read: () => rigGraphRuntime() },
  ]);
  wireTool("list_textures", [
    {
      field: "optimization_opportunities",
      read: (_structured, context) => textureOptimizationRuntime(context),
    },
  ]);
  wireTool("get_texture", [
    { field: "color_profile", read: textureColorProfileRuntime },
    { field: "pixel_craft", read: texturePixelCraftRuntime },
  ]);
  wireTool("inspect_animation", [
    { field: "root_motion", read: rootMotionRuntime },
    { field: "animation_quality", read: animationQualityRuntime },
    { field: "animation_craft", read: animationCraftRuntime },
  ]);
}