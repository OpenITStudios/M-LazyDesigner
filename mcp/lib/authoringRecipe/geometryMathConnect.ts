import type { RecipeVec3 } from "./contracts";
import type {
  GeometryMathConnectorPart,
  GeometryMathPart,
} from "./geometryMathLanguage";
import type { MathCuboid } from "./geometryMathVoxel";
import { sweepMathVolume } from "./geometryMathSweep";

const AXES = ["X", "Y", "Z"] as const;
const EPSILON = 1e-7;

type Repetition = {
  axis: "X" | "Y" | "Z";
  count: number;
  spacing: number;
};

/**
 * Inputs are PRE-SOLVED semantic source parts, never arbitrary scene
 * selections. The existing Recipe ANCHOR solver has already positioned
 * these parts and the existing LINEAR expander will realize repeats.
 */
export type GeometryConnectorSource = {
  id: string;
  world_min: RecipeVec3;
  world_max: RecipeVec3;
  translation: RecipeVec3;
  local_boxes: readonly MathCuboid[];
  repeat?: Repetition;
};

type ConnectorEndpoint = GeometryMathConnectorPart["start"];

function sourceBoxes(
  part: GeometryConnectorSource
): Array<{ from: RecipeVec3; to: RecipeVec3 }> {
  const result: Array<{ from: RecipeVec3; to: RecipeVec3 }> = [];
  const axis = part.repeat
    ? AXES.indexOf(part.repeat.axis) : -1;
  for (let i = 0; i < (part.repeat?.count ?? 1); i++) {
    const offset = (part.repeat?.spacing ?? 0) * i;
    for (const box of part.local_boxes) {
      const shift = [0, 1, 2].map(d =>
        part.translation[d]! + (d === axis ? offset : 0)
      ) as RecipeVec3;
      result.push({
        from: [0, 1, 2].map(d =>
          box.from[d]! + shift[d]!
        ) as RecipeVec3,
        to: [0, 1, 2].map(d =>
          box.to[d]! + shift[d]!
        ) as RecipeVec3,
      });
    }
  }
  return result;
}

function within(point: RecipeVec3, box: {
  from: RecipeVec3; to: RecipeVec3;
}): boolean {
  return [0, 1, 2].every(d =>
    point[d]! >= box.from[d]! - EPSILON &&
    point[d]! <= box.to[d]! + EPSILON
  );
}

function resolveEndpoint(
  endpoint: ConnectorEndpoint,
  sources: ReadonlyMap<string, GeometryConnectorSource>,
  version: 5 | 6
): {
  point: RecipeVec3;
  boxes: ReturnType<typeof sourceBoxes>;
  normal: RecipeVec3 | null;
} {
  const source = sources.get(endpoint.part_id);
  if (!source) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_UNKNOWN_PART: " + endpoint.part_id
    );
  }
  const factor = (value: "MIN" | "CENTER" | "MAX") =>
    value === "MIN" ? 0 : value === "CENTER" ? 0.5 : 1;
  const point: RecipeVec3 = [0, 1, 2].map(axis =>
    source.world_min[axis]! +
    (source.world_max[axis]! - source.world_min[axis]!) *
      factor(endpoint.anchor[axis]!) +
    (endpoint.offset?.[axis] ?? 0)
  ) as RecipeVec3;
  if (point.some(value => !Number.isFinite(value))) {
    throw new Error("GEOMETRY_MATH_CONNECT_ENDPOINT_NONFINITE");
  }
  const boxes = sourceBoxes(source);
  if (!boxes.some(box => within(point, box))) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_ENDPOINT_NOT_ON_SOURCE: " + source.id
    );
  }
  if (version === 5) {
    return { point, boxes, normal: null };
  }
  // V6 face-aware attachment must have ONE unambiguous outward normal
  // and the endpoint must lie on that actual source Cuboid face.
  const faces = endpoint.anchor.flatMap((a, index) =>
    a === "CENTER" ? [] : [{
      index, sign: a === "MAX" ? 1 : -1,
    }]
  );
  if (faces.length !== 1) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_FACE_NORMAL_AMBIGUOUS: " + source.id
    );
  }
  const { index: axis, sign } = faces[0]!;
  if (Math.abs(endpoint.offset?.[axis] ?? 0) > EPSILON) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_NORMAL_OFFSET_UNSUPPORTED: " + source.id
    );
  }
  const onActualFace = boxes.some(box =>
    Math.abs(point[axis]! -
      (sign > 0 ? box.to[axis]! : box.from[axis]!)) <= EPSILON &&
    [0, 1, 2].every(i => i === axis ||
      (point[i]! >= box.from[i]! - EPSILON &&
       point[i]! <= box.to[i]! + EPSILON))
  );
  if (!onActualFace) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_SURFACE_FACE_MISSING: " + source.id
    );
  }
  const normal: RecipeVec3 = [0, 0, 0];
  normal[axis] = sign;
  return { point, boxes, normal };
}

function connectedNativeVolume(
  generated: readonly MathCuboid[],
  source: readonly { from: RecipeVec3; to: RecipeVec3 }[]
): boolean {
  for (const a of generated) {
    for (const b of source) {
      const overlap = [0, 1, 2].map(axis =>
        Math.min(a.to[axis]!, b.to[axis]!) -
        Math.max(a.from[axis]!, b.from[axis]!)
      );
      if (overlap.every(span => span >= -EPSILON) &&
        overlap.filter(span => span > EPSILON).length >= 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A v5 CONNECT describes attachment constraints, not freehand world
 * coordinates. A start/end part, explicit bbox-face anchor, radius and
 * optionally authored intermediate offsets form an existing v2+ SWEEP.
 *
 * The endpoint is rejected unless it is in actual source Cuboid volume,
 * not merely a location on an empty corner of an enclosing bounding box.
 * Afterwards generated Cuboids must share a face or real volume with each
 * source. This proves structural contact only, not correct art, rig or UV.
 */
export function buildMathConnector(
  part: GeometryMathConnectorPart,
  sources: ReadonlyMap<string, GeometryConnectorSource>,
  version: 5 | 6 = 5
): MathCuboid[] {
  const start = resolveEndpoint(part.start, sources, version);
  const end = resolveEndpoint(part.end, sources, version);
  const separation = Math.hypot(...[0, 1, 2].map(axis =>
    end.point[axis]! - start.point[axis]!
  ));
  if (!Number.isFinite(separation) || separation < 1e-5) {
    throw new Error("GEOMETRY_MATH_CONNECT_DEGENERATE_ENDPOINTS");
  }
  const knots = [{
    position: start.point,
    radius: part.radius[0],
  }];
  for (const waypoint of part.via ?? []) {
    const position: RecipeVec3 = [0, 1, 2].map(axis =>
      start.point[axis]! * (1 - waypoint.fraction) +
      end.point[axis]! * waypoint.fraction +
      waypoint.offset[axis]!
    ) as RecipeVec3;
    knots.push({ position, radius: waypoint.radius });
  }
  knots.push({ position: end.point, radius: part.radius[1] });

  if (version === 6) {
    // The outgoing path must depart the start's exposed outward face,
    // then approach the end from outside its exposed face. This excludes
    // connectors that secretly tunnel through the wrong side of a part.
    const startVector = [0, 1, 2].map(i =>
      knots[1]!.position[i]! - start.point[i]!
    );
    const endVector = [0, 1, 2].map(i =>
      end.point[i]! - knots[knots.length - 2]!.position[i]!
    );
    const dot = (a: readonly number[], b: readonly number[]) =>
      a.reduce((sum, value, axis) => sum + value * b[axis]!, 0);
    if (dot(startVector, start.normal!) <= EPSILON ||
      dot(endVector, end.normal!) >= -EPSILON) {
      throw new Error(
        "GEOMETRY_MATH_CONNECT_SURFACE_ORIENTATION_MISMATCH: " + part.id
      );
    }
  }

  // The language schema is the authority for finite radii, monotonic
  // waypoint fractions and bounded knot count; the original SWEEP kernel
  // validates path degeneracy and preserves connected voxel occupancy.
  const sweep: Extract<GeometryMathPart, { method: "SWEEP" }> = {
    id: part.id,
    at: [0, 0, 0],
    method: "SWEEP",
    interpolation: part.interpolation,
    knots,
    max_chord_error: part.max_chord_error,
  };
  const boxes = sweepMathVolume(sweep, version);
  if (!connectedNativeVolume(boxes, start.boxes) ||
    !connectedNativeVolume(boxes, end.boxes)) {
    throw new Error(
      "GEOMETRY_MATH_CONNECT_NATIVE_CONTACT_MISSING: " + part.id
    );
  }
  return boxes;
}
