import type {
  RecipeConstraint, RecipeVec3,
} from "./contracts";
import type { GeometryMathFaceAnchor } from "./geometryMathLanguage";
import type { MathCuboid } from "./geometryMathVoxel";

type Axis = "X" | "Y" | "Z";
type FaceSelector = GeometryMathFaceAnchor["moving"];
export type FaceAnchorPart = {
  id: string;
  min: RecipeVec3;
  max: RecipeVec3;
  boxes: readonly MathCuboid[];
  repeat?: { axis: Axis; count: number; spacing: number };
};
type Box = { from: RecipeVec3; to: RecipeVec3 };
type Face = {
  part: FaceAnchorPart;
  box: Box;
  center: RecipeVec3;
  axis: number;
  sign: 1 | -1;
};
type FacePair = {
  id: string;
  moving: Face;
  fixed: Face;
  tangentOffset: RecipeVec3;
};
const AXES: readonly Axis[] = ["X", "Y", "Z"];
const EPSILON = 1e-7;

function requireFace(selector: FaceSelector, parts: ReadonlyMap<string, FaceAnchorPart>): Face {
  const part = parts.get(selector.part_id);
  if (!part) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_PART_UNKNOWN: " + selector.part_id);
  }
  const base = part.boxes.find(box => box.id === selector.cube_id);
  if (!base) {
    throw new Error(
      "GEOMETRY_MATH_FACE_ANCHOR_CUBE_UNKNOWN: " +
      selector.part_id + ":" + selector.cube_id
    );
  }
  if (part.boxes.filter(box => box.id === selector.cube_id).length !== 1) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_CUBE_ID_AMBIGUOUS");
  }
  if (part.repeat && selector.repeat_index === undefined) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_REPEAT_INDEX_REQUIRED");
  }
  if (!part.repeat && selector.repeat_index !== undefined) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_REPEAT_INDEX_UNEXPECTED");
  }
  const index = selector.repeat_index ?? 0;
  if (part.repeat && (index < 0 || index >= part.repeat.count)) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_REPEAT_INDEX_OUT_OF_RANGE");
  }
  const repeatAxis = part.repeat ? AXES.indexOf(part.repeat.axis) : -1;
  const shift = (part.repeat?.spacing ?? 0) * index;
  const candidate: Box = {
    from: base.from.map((v, axis) =>
      v + (axis === repeatAxis ? shift : 0)) as RecipeVec3,
    to: base.to.map((v, axis) =>
      v + (axis === repeatAxis ? shift : 0)) as RecipeVec3,
  };
  const faceAxis = AXES.indexOf(selector.face.slice(4) as Axis);
  const sign: 1 | -1 = selector.face.startsWith("POS_") ? 1 : -1;
  if (faceAxis < 0 || !Number.isFinite(shift)) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_AXIS_INVALID");
  }
  const center = [0, 1, 2].map(axis => axis === faceAxis
    ? (sign === 1 ? candidate.to[axis]! : candidate.from[axis]!)
    : (candidate.from[axis]! + candidate.to[axis]!) / 2
  ) as RecipeVec3;
  if (![...center, ...candidate.from, ...candidate.to].every(Number.isFinite)) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_COORDINATE_NONFINITE");
  }
  const facePlane = center[faceAxis]!;
  // A Cube's own face is not necessarily an exposed face of the WHOLE
  // semantic part. Reject any other Cube/copy with positive-area material
  // immediately outside the requested plane; no artificial internal joints.
  for (let copy = 0; copy < (part.repeat?.count ?? 1); copy++) {
    const extra = (part.repeat?.spacing ?? 0) * copy;
    for (const other of part.boxes) {
      if (other.id === base.id && copy === index) continue;
      const from = other.from.map((v, axis) =>
        v + (axis === repeatAxis ? extra : 0));
      const to = other.to.map((v, axis) =>
        v + (axis === repeatAxis ? extra : 0));
      const blocksExterior = sign === 1
        ? from[faceAxis]! <= facePlane + EPSILON &&
          to[faceAxis]! > facePlane + EPSILON
        : from[faceAxis]! < facePlane - EPSILON &&
          to[faceAxis]! >= facePlane - EPSILON;
      if (!blocksExterior) continue;
      const tangentAxes = [0, 1, 2].filter(axis => axis !== faceAxis);
      if (tangentAxes.every(axis =>
        Math.min(candidate.to[axis]!, to[axis]!) -
        Math.max(candidate.from[axis]!, from[axis]!) > EPSILON
      )) {
        throw new Error(
          "GEOMETRY_MATH_FACE_ANCHOR_SURFACE_OCCLUDED: " +
          part.id + ":" + selector.cube_id
        );
      }
    }
  }
  return { part, box: candidate, center, axis: faceAxis, sign };
}

function buildPair(
  link: GeometryMathFaceAnchor,
  parts: ReadonlyMap<string, FaceAnchorPart>
): FacePair {
  const moving = requireFace(link.moving, parts);
  const fixed = requireFace(link.fixed, parts);
  if (moving.part.id === fixed.part.id ||
    moving.axis !== fixed.axis || moving.sign === fixed.sign) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_NORMAL_MISMATCH: " + link.id);
  }
  const tangentOffset = [...(link.tangent_offset ?? [0, 0, 0])] as RecipeVec3;
  if (tangentOffset.some(v => !Number.isFinite(v)) ||
    Math.abs(tangentOffset[moving.axis]!) > EPSILON) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_OFFSET_NOT_TANGENT: " + link.id);
  }
  return { id: link.id, moving, fixed, tangentOffset };
}

export type PreparedFaceAnchors = {
  constraints: RecipeConstraint[];
  /** Source-only assertions checked again AFTER the canonical solver. */
  verify: (solvedMinByPartId: ReadonlyMap<string, RecipeVec3>) => void;
};

/**
 * Converts selected visible geometric faces into the EXISTING Recipe
 * per-axis ANCHOR constraints. Prototypes represent WHOLE part envelopes.
 * Offset = fixed local face centre - moving local face centre +
 * tangent offset. The solver owns the actual dependency graph/cycles.
 */
export function prepareGeometryFaceAnchors(
  parts: readonly FaceAnchorPart[],
  links: readonly GeometryMathFaceAnchor[]
): PreparedFaceAnchors {
  if (!links.length) return { constraints: [], verify: () => undefined };
  const byId = new Map(parts.map(part => [part.id, part] as const));
  if (byId.size !== parts.length) {
    throw new Error("GEOMETRY_MATH_FACE_ANCHOR_PART_ID_DUPLICATE");
  }
  const pairs = [...links]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(link => buildPair(link, byId));
  const constraints: RecipeConstraint[] = pairs.map((pair): RecipeConstraint => {
    const offset: RecipeVec3 = [0, 1, 2].map(axis =>
      pair.fixed.center[axis]! - pair.fixed.part.min[axis]! -
      (pair.moving.center[axis]! - pair.moving.part.min[axis]!) +
      pair.tangentOffset[axis]!
    ) as RecipeVec3;
    if (offset.some(v => !Number.isFinite(v))) {
      throw new Error("GEOMETRY_MATH_FACE_ANCHOR_OFFSET_NONFINITE: " + pair.id);
    }
    return {
      kind: "ANCHOR",
      id: pair.id,
      source_instance_id: pair.moving.part.id,
      target_instance_id: pair.fixed.part.id,
      source_anchor: ["MIN", "MIN", "MIN"],
      target_anchor: ["MIN", "MIN", "MIN"],
      axes: ["X", "Y", "Z"],
      offset,
    };
  });
  const verify = (solved: ReadonlyMap<string, RecipeVec3>): void => {
    for (const pair of pairs) {
      const movingMin = solved.get(pair.moving.part.id);
      const fixedMin = solved.get(pair.fixed.part.id);
      if (!movingMin || !fixedMin) {
        throw new Error("GEOMETRY_MATH_FACE_ANCHOR_SOLVED_IDENTITY_MISSING");
      }
      const movingShift = movingMin.map((v, axis) =>
        v - pair.moving.part.min[axis]!);
      const fixedShift = fixedMin.map((v, axis) =>
        v - pair.fixed.part.min[axis]!);
      const axis = pair.moving.axis;
      const movingPlane = pair.moving.center[axis]! + movingShift[axis]!;
      const fixedPlane = pair.fixed.center[axis]! + fixedShift[axis]!;
      if (!Number.isFinite(movingPlane) || !Number.isFinite(fixedPlane) ||
        Math.abs(movingPlane - fixedPlane) > EPSILON) {
        throw new Error("GEOMETRY_MATH_FACE_ANCHOR_PLANE_MISMATCH: " + pair.id);
      }
      const tangents = [0, 1, 2].filter(i => i !== axis);
      if (!tangents.every(i => {
        const movingStart = pair.moving.box.from[i]! + movingShift[i]!;
        const movingEnd = pair.moving.box.to[i]! + movingShift[i]!;
        const fixedStart = pair.fixed.box.from[i]! + fixedShift[i]!;
        const fixedEnd = pair.fixed.box.to[i]! + fixedShift[i]!;
        return Math.min(movingEnd, fixedEnd) -
          Math.max(movingStart, fixedStart) > EPSILON;
      })) {
        throw new Error("GEOMETRY_MATH_FACE_ANCHOR_CONTACT_MISSING: " + pair.id);
      }
    }
  };
  return { constraints, verify };
}
