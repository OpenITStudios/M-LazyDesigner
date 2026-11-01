import type { RecipeCubePrototype, RecipePattern, RecipeVec3 } from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
import { buildGeometryPresetPieces } from "./geometryPresetBuilders";
import { buildGeometryMathProgramPieces } from "./geometryMathProgram";
import { requireBoxUvRepresentableSpan, validateCubeGeometrySpan } from "@/lib/geometry/cubeSpan";

/**
 * Deterministic native-Cuboid shape construction for Authoring Recipe v1.
 * Keeps pure shape mathematics separate from Recipe ownership/orchestration.
 * Neither edits Blockbench nor introduces a second authoring engine.
 */
const AXES = ["X", "Y", "Z"] as const;
export const MAX_FEATURES = 8;
export const MAX_FEATURE_CUBES = 128;
export const MAX_TOTAL_CUBES = 256;

function requireFiniteVector(value: readonly number[], label: string): RecipeVec3 {
  if (!Array.isArray(value) || value.length !== 3 ||
    value.some(item => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error("ADVANCED_GEOMETRY_VECTOR_INVALID: " + label);
  }
  return [value[0]!, value[1]!, value[2]!];
}

function requirePositiveSize(value: readonly number[], label: string): RecipeVec3 {
  const vector = requireFiniteVector(value, label);
  if (vector.some(item => item < 1)) {
    throw new Error("ADVANCED_GEOMETRY_BOX_UV_SIZE_REVIEW: " +
      label + " requires positive axes >= 1 for inherited Box UV.");
  }
  return vector;
}

function requireRotation(value: readonly number[] | undefined): RecipeVec3 {
  const rotation = requireFiniteVector(value ?? [0, 0, 0], "rotation");
  if (rotation.some(item => Math.abs(item) > 45) ||
    rotation.filter(item => item !== 0).length > 1) {
    throw new Error("ADVANCED_GEOMETRY_ROTATION_REVIEW: use at most one native axis within ±45 degrees.");
  }
  return rotation;
}

export function requireIdentity(value: string, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error("ADVANCED_GEOMETRY_ID_INVALID: " + label);
  }
  return value;
}

function requireCount(count: number, label: string): number {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FEATURE_CUBES) {
    throw new Error("ADVANCED_GEOMETRY_COUNT_INVALID: " + label);
  }
  return count;
}

type Pieces = {
  prototypes: RecipeCubePrototype[];
  patterns: RecipePattern[];
};

function makeBox(
  id: string,
  name: string,
  featureId: string,
  fromRaw: RecipeVec3,
  toRaw: RecipeVec3,
  rotationRaw?: RecipeVec3,
  pivotRaw?: RecipeVec3
): Pieces {
  const from = requireFiniteVector(fromRaw, "from");
  const to = requireFiniteVector(toRaw, "to");
  validateCubeGeometrySpan(from, to, 0, id);
  requireBoxUvRepresentableSpan(from, to, id);
  const size = requirePositiveSize(to.map((value, index) =>
    value - from[index]!) as RecipeVec3, "size");
  const rotation = requireRotation(rotationRaw);
  const pivot = pivotRaw === undefined
    ? from.map((value, index) => value + size[index]! / 2) as RecipeVec3
    : requireFiniteVector(pivotRaw, "pivot");
  const relativeOrigin = pivot.map((value, index) =>
    value - from[index]!) as RecipeVec3;
  return {
    prototypes: [{ id, name, size, rotation, origin: relativeOrigin }],
    patterns: [{
      kind: "LINEAR", id, feature_id: featureId,
      prototype_id: id, count: 1, axis: "Z", spacing: 0, start: from,
    }],
  };
}

function buildFrame(feature: Extract<AdvancedGeometryFeature, { kind: "frame" }>): Pieces {
  const center = requireFiniteVector(feature.center, "frame center");
  const size = requirePositiveSize(feature.size, "frame size");
  const border = feature.border;
  if (!Number.isFinite(border) || border < 1) {
    throw new Error("ADVANCED_GEOMETRY_FRAME_BORDER_INVALID");
  }
  const normal = AXES.indexOf(feature.normal_axis);
  if (normal < 0) throw new Error("ADVANCED_GEOMETRY_FRAME_AXIS_INVALID");
  const [a, b] = [0, 1, 2].filter(axis => axis !== normal);
  if (size[a!]! <= 2 * border || size[b!]! <= 2 * border) {
    throw new Error("ADVANCED_GEOMETRY_FRAME_OPENING_REQUIRED");
  }
  const low = center.map((value, index) => value - size[index]! / 2);
  const high = center.map((value, index) => value + size[index]! / 2);
  const piece = (label: string, aMin: number, aMax: number, bMin: number, bMax: number) => {
    const from = [...low] as RecipeVec3;
    const to = [...high] as RecipeVec3;
    from[a!] = aMin; to[a!] = aMax;
    from[b!] = bMin; to[b!] = bMax;
    return makeBox("shape:frame:" + feature.id + ":" + label,
      feature.label + "_" + label, feature.id, from, to);
  };
  const parts = [
    piece("left", low[a!]!, low[a!]! + border, low[b!]!, high[b!]!),
    piece("right", high[a!]! - border, high[a!]!, low[b!]!, high[b!]!),
    piece("bottom", low[a!]! + border, high[a!]! - border, low[b!]!, low[b!]! + border),
    piece("top", low[a!]! + border, high[a!]! - border, high[b!]! - border, high[b!]!),
  ];
  return {
    prototypes: parts.flatMap(part => part.prototypes),
    patterns: parts.flatMap(part => part.patterns),
  };
}

/**
 * An open-backed box with five disjoint wall panels. Panel corners never
 * overlap in volume; one intentionally empty face preserves the opening.
 * This is a true 3D hollow mass rather than an invisible inner Cube.
 */
function buildHollowBox(
  feature: Extract<AdvancedGeometryFeature, { kind: "hollow_box" }>
): Pieces {
  const center = requireFiniteVector(feature.center, "hollow box center");
  const size = requirePositiveSize(feature.size, "hollow box size");
  const wall = feature.wall;
  if (!Number.isFinite(wall) || wall < 1) {
    throw new Error("ADVANCED_GEOMETRY_HOLLOW_WALL_INVALID");
  }
  const normal: Record<typeof feature.open_face, number> = {
    POS_X: 0, NEG_X: 0, POS_Y: 1, NEG_Y: 1, POS_Z: 2, NEG_Z: 2,
  };
  const n = normal[feature.open_face];
  if (n === undefined) throw new Error("ADVANCED_GEOMETRY_HOLLOW_FACE_INVALID");
  const [a, b] = [0, 1, 2].filter(index => index !== n);
  if (size[a!]! - 2 * wall < 1 ||
      size[b!]! - 2 * wall < 1 ||
      size[n]! - wall < 1) {
    throw new Error(
      "ADVANCED_GEOMETRY_HOLLOW_CAVITY_REQUIRED: cavity must retain at least one model unit."
    );
  }
  const low = center.map((value, index) =>
    value - size[index]! / 2) as RecipeVec3;
  const high = center.map((value, index) =>
    value + size[index]! / 2) as RecipeVec3;
  const panel = (
    label: string,
    aLow: number, aHigh: number,
    bLow: number, bHigh: number,
    nLow: number = low[n]!, nHigh: number = high[n]!
  ) => {
    const from = [...low] as RecipeVec3;
    const to = [...high] as RecipeVec3;
    from[a!] = aLow; to[a!] = aHigh;
    from[b!] = bLow; to[b!] = bHigh;
    from[n] = nLow; to[n] = nHigh;
    return makeBox(
      "shape:hollow_box:" + feature.id + ":" + label,
      feature.label + "_" + label,
      feature.id, from, to
    );
  };
  const insideALow = low[a!]! + wall;
  const insideAHigh = high[a!]! - wall;
  const insideBLow = low[b!]! + wall;
  const insideBHigh = high[b!]! - wall;
  const openPositive = feature.open_face.startsWith("POS_");
  const parts = [
    panel("wall_a_low", low[a!]!, insideALow, low[b!]!, high[b!]!),
    panel("wall_a_high", insideAHigh, high[a!]!, low[b!]!, high[b!]!),
    panel("wall_b_low", insideALow, insideAHigh, low[b!]!, insideBLow),
    panel("wall_b_high", insideALow, insideAHigh, insideBHigh, high[b!]!),
    panel("back", insideALow, insideAHigh, insideBLow, insideBHigh,
      openPositive ? low[n]! : high[n]! - wall,
      openPositive ? low[n]! + wall : high[n]!),
  ];
  return {
    prototypes: parts.flatMap(part => part.prototypes),
    patterns: parts.flatMap(part => part.patterns),
  };
}

/**
 * A vertical semicircular opening approximated with one axis-aligned,
 * Bedrock-native Cuboid per voxel column. The empty interior has no
 * obstructing Cube; the +Y crown remains at least one unit thick.
 *
 * Sample the *closest* point to the crown within each column when computing
 * its bottom. This preserves the desired opening rather than accidentally
 * filling above the visible reference contour with a center-only estimate.
 */
function buildSteppedArch(
  feature: Extract<AdvancedGeometryFeature, { kind: "arch" }>
): Pieces {
  const center = requireFiniteVector(feature.center, "arch center");
  const size = requirePositiveSize(feature.size, "arch size");
  const widthAxis = feature.span_axis === "X" ? 0 :
    feature.span_axis === "Z" ? 2 : -1;
  if (widthAxis < 0) throw new Error("ADVANCED_GEOMETRY_ARCH_AXIS_INVALID");
  const width = size[widthAxis]!;
  const height = size[1];
  const wall = feature.wall;
  const rise = feature.rise;
  if (!Number.isFinite(wall) || !Number.isFinite(rise) ||
    wall < 1 || rise < 1 ||
    width - 2 * wall < 2 ||
    height - wall - rise < 1) {
    throw new Error(
      "ADVANCED_GEOMETRY_ARCH_OPENING_INVALID: reserve side walls, springline and a crown."
    );
  }
  const widthFloor = Math.min(15, Math.floor(width));
  const autoColumns = widthFloor % 2 === 0 ? widthFloor - 1 : widthFloor;
  const count = feature.columns ?? autoColumns;
  if (!Number.isInteger(count) || count < 3 || count > 31 ||
      count % 2 === 0 || width / count < 1) {
    throw new Error(
      "ADVANCED_GEOMETRY_ARCH_COLUMNS_INVALID: use an odd number of columns with width >= 1."
    );
  }
  const low = center.map((value, axis) =>
    value - size[axis]! / 2) as RecipeVec3;
  const high = center.map((value, axis) =>
    value + size[axis]! / 2) as RecipeVec3;
  const halfOpening = width / 2 - wall;
  const springline = high[1] - wall - rise;
  const stepWidth = width / count;
  const parts: Pieces[] = [];
  for (let index = 0; index < count; index++) {
    const x0 = low[widthAxis]! + index * stepWidth;
    const x1 = index === count - 1
      ? high[widthAxis]! : low[widthAxis]! + (index + 1) * stepWidth;
    const crown = center[widthAxis]!;
    const closest = x0 <= crown && x1 >= crown ? 0 :
      Math.min(Math.abs(x0 - crown), Math.abs(x1 - crown));
    const bottom = closest >= halfOpening ? low[1] :
      springline + rise *
        Math.sqrt(Math.max(0, 1 - (closest / halfOpening) ** 2));
    const from = [...low] as RecipeVec3;
    const to = [...high] as RecipeVec3;
    from[widthAxis] = x0;
    to[widthAxis] = x1;
    from[1] = bottom;
    parts.push(makeBox(
      "shape:arch:" + feature.id + ":column_" + index,
      feature.label + "_column_" + (index + 1),
      feature.id, from, to
    ));
  }
  return {
    prototypes: parts.flatMap(part => part.prototypes),
    patterns: parts.flatMap(part => part.patterns),
  };
}

/**
 * Deterministic one-unit voxel approximation of a solid cylinder or tube.
 * Every occupied cross-section cell belongs to exactly one row-run Cuboid,
 * avoiding overlapping volume and unnecessary one-Cube-per-voxel output.
 *
 * This is a low-poly/voxel silhouette decision, not a smooth native mesh.
 * The 4-connected mass and enclosed hole are explicitly checked before
 * emitting a candidate. Unconnected one-cell annuli fail closed instead of
 * becoming visually broken floating corner pieces.
 */
function buildVoxelCylinder(
  feature: Extract<AdvancedGeometryFeature, { kind: "voxel_cylinder" }>
): Pieces {
  const center = requireFiniteVector(feature.center, "voxel cylinder center");
  const axis = AXES.indexOf(feature.axis);
  const radius = feature.radius;
  const innerRadius = feature.inner_radius ?? 0;
  const length = feature.length;
  if (axis < 0 || !Number.isInteger(radius) || radius < 2 || radius > 16 ||
    !Number.isInteger(innerRadius) || innerRadius < 0 ||
    innerRadius >= radius || !Number.isFinite(length) || length < 1) {
    throw new Error("ADVANCED_GEOMETRY_VOXEL_CYLINDER_PARAMETERS_INVALID");
  }
  const axes = [0, 1, 2].filter(index => index !== axis);
  const [uAxis, vAxis] = axes;
  const diameter = radius * 2;
  const outerSquared = radius * radius;
  const innerSquared = innerRadius * innerRadius;

  const cells: boolean[][] = [];
  let occupiedCount = 0;
  for (let row = 0; row < diameter; row++) {
    const occupied: boolean[] = [];
    for (let column = 0; column < diameter; column++) {
      const u = column - radius + 0.5;
      const v = row - radius + 0.5;
      const squared = u * u + v * v;
      const filled = squared <= outerSquared &&
        (innerRadius === 0 || squared > innerSquared);
      occupied.push(filled);
      if (filled) occupiedCount++;
    }
    cells.push(occupied);
  }
  if (occupiedCount === 0) {
    throw new Error("ADVANCED_GEOMETRY_VOXEL_CYLINDER_EMPTY");
  }

  // Four-neighbour topology in the voxel cross-section. Diagonal contact
  // alone is not a reliable material connection for a Blockbench model.
  const neighbours = (point: number): number[] => {
    const row = Math.floor(point / diameter);
    const column = point % diameter;
    const result: number[] = [];
    if (column > 0) result.push(point - 1);
    if (column + 1 < diameter) result.push(point + 1);
    if (row > 0) result.push(point - diameter);
    if (row + 1 < diameter) result.push(point + diameter);
    return result;
  };
  const traversable = (point: number, filled: boolean) =>
    cells[Math.floor(point / diameter)]![point % diameter] === filled;
  const flood = (seeds: readonly number[], filled: boolean): Set<number> => {
    const visited = new Set<number>();
    const queue: number[] = [];
    for (const point of seeds) {
      if (!visited.has(point) && traversable(point, filled)) {
        visited.add(point);
        queue.push(point);
      }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      for (const neighbour of neighbours(queue[cursor]!)) {
        if (visited.has(neighbour) || !traversable(neighbour, filled)) continue;
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
    return visited;
  };
  const firstFilled = cells.flat().indexOf(true);
  if (flood([firstFilled], true).size !== occupiedCount) {
    throw new Error(
      "ADVANCED_GEOMETRY_VOXEL_CYLINDER_DISCONNECTED: " +
      "widen the tube wall or reduce inner_radius."
    );
  }
  if (innerRadius > 0) {
    const outsideSeeds: number[] = [];
    for (let index = 0; index < diameter * diameter; index++) {
      const row = Math.floor(index / diameter);
      const column = index % diameter;
      if (row === 0 || column === 0 ||
        row === diameter - 1 || column === diameter - 1) {
        outsideSeeds.push(index);
      }
    }
    const outside = flood(outsideSeeds, false);
    const innerVoid = cells.flat().reduce((count, filled, index) =>
      count + (!filled && !outside.has(index) ? 1 : 0), 0);
    if (innerVoid === 0) {
      throw new Error(
        "ADVANCED_GEOMETRY_VOXEL_CYLINDER_HOLE_NOT_ENCLOSED: " +
        "choose a wider wall or a smaller inner_radius."
      );
    }
  }

  const result: Pieces = { prototypes: [], patterns: [] };
  for (let row = 0; row < diameter; row++) {
    let start: number | null = null;
    let run = 0;
    for (let column = 0; column <= diameter; column++) {
      const occupied = column < diameter && cells[row]![column] === true;
      if (occupied && start === null) start = column;
      if (occupied || start === null) continue;
      const from = center.map((value, index) =>
        value - (index === axis ? length / 2 : radius)
      ) as RecipeVec3;
      const to = center.map((value, index) =>
        value + (index === axis ? length / 2 : radius)
      ) as RecipeVec3;
      from[uAxis!] = center[uAxis!] - radius + start;
      to[uAxis!] = center[uAxis!] - radius + column;
      from[vAxis!] = center[vAxis!] - radius + row;
      to[vAxis!] = center[vAxis!] - radius + row + 1;
      const id = "shape:voxel_cylinder:" + feature.id +
        ":row_" + row + ":run_" + run;
      const piece = makeBox(id, feature.label + "_row_" + row +
        "_run_" + run, feature.id, from, to);
      result.prototypes.push(...piece.prototypes);
      result.patterns.push(...piece.patterns);
      start = null;
      run++;
    }
  }
  if (result.patterns.length === 0 ||
    result.patterns.length > MAX_FEATURE_CUBES) {
    throw new Error("ADVANCED_GEOMETRY_VOXEL_CYLINDER_BUDGET_EXCEEDED");
  }
  return result;
}

function buildRepeat(feature: Extract<AdvancedGeometryFeature, { kind: "repeat" }>): Pieces {
  const size = requirePositiveSize(feature.size, "repeated size");
  const rotation = requireRotation(feature.rotation);
  const id = "shape:repeat:" + feature.id;
  const shape = feature.pattern;
  let pattern: RecipePattern;
  switch (shape.kind) {
    case "LINEAR": {
      requireCount(shape.count, "linear count");
      if (!Number.isFinite(shape.spacing)) {
        throw new Error("ADVANCED_GEOMETRY_SPACING_INVALID");
      }
      pattern = {
        kind: "LINEAR", id, prototype_id: id, feature_id: feature.id,
        count: shape.count, axis: shape.axis, spacing: shape.spacing,
        start: requireFiniteVector(shape.start, "linear start"),
      };
      break;
    }
    case "GRID": {
      const count = requireCount(shape.counts[0] * shape.counts[1], "grid count");
      if (!Number.isInteger(shape.counts[0]) || !Number.isInteger(shape.counts[1]) ||
        count !== shape.counts[0] * shape.counts[1] ||
        shape.axes[0] === shape.axes[1] ||
        shape.spacing.some(value => !Number.isFinite(value))) {
        throw new Error("ADVANCED_GEOMETRY_GRID_INVALID");
      }
      pattern = {
        kind: "GRID", id, prototype_id: id, feature_id: feature.id,
        counts: [...shape.counts], axes: [...shape.axes],
        spacing: [...shape.spacing],
        start: requireFiniteVector(shape.start, "grid start"),
      };
      break;
    }
    case "RADIAL": {
      requireCount(shape.count, "radial count");
      if (!Number.isFinite(shape.radius) || shape.radius <= 0) {
        throw new Error("ADVANCED_GEOMETRY_RADIUS_INVALID");
      }
      pattern = {
        kind: "RADIAL", id, prototype_id: id, feature_id: feature.id,
        count: shape.count, axis: shape.axis, radius: shape.radius,
        center: requireFiniteVector(shape.center, "radial center").map(
          (value, index) => value - size[index]! / 2
        ) as RecipeVec3,
        rotate_with_pattern: false,
      };
      break;
    }
  }
  return {
    prototypes: [{
      id, name: feature.label, size, rotation,
      origin: size.map(value => value / 2) as RecipeVec3,
    }],
    patterns: [pattern],
  };
}

export function buildGeometryShapePieces(
  feature: Exclude<AdvancedGeometryFeature, { kind: "curve" }>
): Pieces {
  if (feature.kind === "cuboid") {
    return makeBox("shape:cuboid:" + feature.id, feature.label,
      feature.id, feature.from, feature.to, feature.rotation, feature.pivot);
  }
  if (feature.kind === "frame") return buildFrame(feature);
  if (feature.kind === "hollow_box") return buildHollowBox(feature);
  if (feature.kind === "arch") return buildSteppedArch(feature);
  if (feature.kind === "voxel_cylinder") return buildVoxelCylinder(feature);
  if (feature.kind === "staircase" ||
      feature.kind === "pitched_roof" ||
      feature.kind === "beveled_box" ||
      feature.kind === "voxel_ellipsoid" ||
      feature.kind === "voxel_cone" ||
      feature.kind === "voxel_torus") {
    return buildGeometryPresetPieces(feature, makeBox);
  }
  if (feature.kind === "program") {
    return buildGeometryMathProgramPieces(feature, makeBox);
  }
  return buildRepeat(feature);
}
