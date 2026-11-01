import type { RecipeVec3 } from "./contracts";
import type { GeometryMathLoftPart } from "./geometryMathLanguage";
import {
  partitionMathVoxelVolume,
  type MathCuboid,
} from "./geometryMathVoxel";

/**
 * Version-5 profile-driven Cuboid LOFT: interpolate authored rectangular
 * sections in model units along a fixed X/Y/Z axis. The two perpendicular
 * directions may change width, depth and centre independently.
 *
 * This is a bounded piecewise-linear *volume*, then the existing voxel
 * partition into native axis-aligned Cuboids. It is NOT a new mesh format,
 * general swept frame, free rotation, subdivision surface or native Bone.
 */
const AXES = ["X", "Y", "Z"] as const;
const EPSILON = 1e-10;

export function loftMathVolume(part: GeometryMathLoftPart): MathCuboid[] {
  const sections = part.sections;
  if (sections[0]?.height !== 0) {
    throw new Error("GEOMETRY_MATH_LOFT_START_AT_ZERO");
  }
  for (let index = 1; index < sections.length; index++) {
    if (sections[index]!.height <= sections[index - 1]!.height) {
      throw new Error("GEOMETRY_MATH_LOFT_STATIONS_NOT_ASCENDING");
    }
  }
  const height = sections[sections.length - 1]!.height;
  if (height < 1) {
    throw new Error("GEOMETRY_MATH_LOFT_ZERO_HEIGHT");
  }
  const normal = AXES.indexOf(part.axis);
  if (normal < 0) {
    throw new Error("GEOMETRY_MATH_LOFT_AXIS_INVALID");
  }
  const perpendicular = [0, 1, 2].filter(axis => axis !== normal);
  const low: RecipeVec3 = [0, 0, 0];
  const size: [number, number, number] = [0, 0, 0];
  low[normal] = 0;
  size[normal] = height;

  // Section centre +/- half-size changes linearly between stations:
  // its extrema over each interval occur at an authored endpoint.
  for (let side = 0; side < 2; side++) {
    const min = Math.min(...sections.map(section =>
      section.center[side]! - section.size[side]! / 2
    ));
    const max = Math.max(...sections.map(section =>
      section.center[side]! + section.size[side]! / 2
    ));
    const worldLow = Math.floor(min);
    const worldHigh = Math.ceil(max);
    const range = worldHigh - worldLow;
    if (!Number.isSafeInteger(range) || range < 1 || range > 64) {
      throw new Error("GEOMETRY_MATH_LOFT_PROFILE_GRID_BUDGET");
    }
    low[perpendicular[side]!] = worldLow;
    size[perpendicular[side]!] = range;
  }

  const atHeight = (y: number): {
    center: readonly [number, number];
    size: readonly [number, number];
  } => {
    let sectionIndex = 0;
    while (sectionIndex + 2 < sections.length &&
      sections[sectionIndex + 1]!.height < y) {
      sectionIndex++;
    }
    const a = sections[sectionIndex]!;
    const b = sections[sectionIndex + 1]!;
    const t = (y - a.height) / (b.height - a.height);
    return {
      center: [
        a.center[0] + t * (b.center[0] - a.center[0]),
        a.center[1] + t * (b.center[1] - a.center[1]),
      ],
      size: [
        a.size[0] + t * (b.size[0] - a.size[0]),
        a.size[1] + t * (b.size[1] - a.size[1]),
      ],
    };
  };

  const layers = new Uint8Array(height);
  const boxes = partitionMathVoxelVolume(low, size, (x, y, z) => {
    const cell = [x, y, z];
    const axial = cell[normal]!;
    const section = atHeight(axial + 0.5);
    const u = low[perpendicular[0]!]! + cell[perpendicular[0]!]! + 0.5;
    const v = low[perpendicular[1]!]! + cell[perpendicular[1]!]! + 0.5;
    const inside = Math.abs(u - section.center[0]) <=
      section.size[0] / 2 + EPSILON &&
      Math.abs(v - section.center[1]) <=
      section.size[1] / 2 + EPSILON;
    if (inside) layers[axial] = 1;
    return inside;
  });
  if (layers.some(filled => filled === 0)) {
    throw new Error(
      "GEOMETRY_MATH_LOFT_RASTER_LAYER_LOST: " +
      "an authored axial section disappeared at one-model-unit resolution."
    );
  }
  return boxes;
}
