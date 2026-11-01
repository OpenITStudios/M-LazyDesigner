import type { RecipeCubePrototype, RecipePattern, RecipeVec3 } from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
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
  return buildRepeat(feature);
}
