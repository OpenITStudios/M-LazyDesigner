import type {
  GeometryMathClearance,
  GeometryMathFaceAnchor,
} from "./geometryMathLanguage";
import {
  expandGeometrySourceBoxes,
  type GeometryConnectorSource,
} from "./geometryMathConnect";
import type { RecipeVec3 } from "./contracts";

/**
 * V8-only, source-bounded relation check after canonical ANCHOR solve and
 * derived CONNECT construction. This is not a placement solver, native scene
 * query, collision engine, mesh test or visual/rig/UV quality assertion.
 *
 * For two native Cuboids:
 *   positive-volume intersection iff all 3 AABB overlaps > EPSILON.
 *   exterior separation is norm of the 3 positive axis gaps.
 * Touching faces/edges/corners is permitted at minimum_gap = 0.
 *
 * Explicit relation pairs only; other scene geometry is out of scope.
 * All repeated instances use the EXACT canonical LINEAR placements used
 * by the existing CONNECT source expansion and Recipe pattern compiler.
 */
const EPSILON = 1e-7;
type Box = { from: RecipeVec3; to: RecipeVec3 };

type Pair = {
  first: string;
  second: string;
  minGap: number;
  relationId: string;
  kind: "FACE_ANCHOR" | "CLEARANCE";
};

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function requireGeometryMathClearances(
  sources: ReadonlyMap<string, GeometryConnectorSource>,
  clearances: readonly GeometryMathClearance[],
  faceAnchors: readonly GeometryMathFaceAnchor[]
): void {
  if (clearances.length === 0 && faceAnchors.length === 0) return;

  const boxesByPart = new Map<string, Box[]>();
  const resolveBoxes = (id: string): readonly Box[] => {
    const existing = boxesByPart.get(id);
    if (existing) return existing;
    const source = sources.get(id);
    if (!source) {
      throw new Error("GEOMETRY_MATH_CLEARANCE_SOURCE_MISSING: " + id);
    }
    const boxes = expandGeometrySourceBoxes(source);
    if (boxes.length < 1 || boxes.length > 64 ||
      boxes.some(box => box.from.some((n, axis) =>
        !Number.isFinite(n) || !Number.isFinite(box.to[axis]) ||
        box.to[axis]! <= n
      ))) {
      throw new Error("GEOMETRY_MATH_CLEARANCE_SOURCE_BOUNDS_INVALID: " + id);
    }
    boxesByPart.set(id, boxes);
    return boxes;
  };

  const pairs: Pair[] = [
    ...faceAnchors.map(link => ({
      first: link.moving.part_id,
      second: link.fixed.part_id,
      minGap: 0,
      relationId: link.id,
      kind: "FACE_ANCHOR" as const,
    })),
    ...clearances.map(link => ({
      first: link.part_a_id,
      second: link.part_b_id,
      minGap: link.minimum_gap ?? 0,
      relationId: link.id,
      kind: "CLEARANCE" as const,
    })),
  ].sort((a, b) =>
    compareIds(a.kind, b.kind) || compareIds(a.relationId, b.relationId)
  );

  for (const relation of pairs) {
    if (relation.first === relation.second ||
      !Number.isFinite(relation.minGap) ||
      relation.minGap < 0 || relation.minGap > 8) {
      throw new Error("GEOMETRY_MATH_CLEARANCE_RELATION_INVALID: " +
        relation.relationId);
    }
    const first = resolveBoxes(relation.first);
    const second = resolveBoxes(relation.second);

    for (const a of first) {
      for (const b of second) {
        const positiveOverlaps = [0, 1, 2].map(axis =>
          Math.min(a.to[axis]!, b.to[axis]!) -
          Math.max(a.from[axis]!, b.from[axis]!)
        );
        if (positiveOverlaps.some(value => !Number.isFinite(value))) {
          throw new Error("GEOMETRY_MATH_CLEARANCE_NUMERIC_OVERFLOW: " +
            relation.relationId);
        }
        if (positiveOverlaps.every(span => span > EPSILON)) {
          const code = relation.kind === "FACE_ANCHOR"
            ? "GEOMETRY_MATH_FACE_ANCHOR_INTERPENETRATION"
            : "GEOMETRY_MATH_CLEARANCE_INTERPENETRATION";
          throw new Error(code + ": " + relation.relationId +
            " [" + relation.first + "," + relation.second + "]");
        }
        if (relation.minGap === 0) continue;

        const distances = [0, 1, 2].map(axis => Math.max(
          0,
          a.from[axis]! - b.to[axis]!,
          b.from[axis]! - a.to[axis]!
        ));
        if (distances.some(value => !Number.isFinite(value))) {
          throw new Error("GEOMETRY_MATH_CLEARANCE_NUMERIC_OVERFLOW: " +
            relation.relationId);
        }
        const distance = Math.hypot(...distances);
        if (!Number.isFinite(distance) ||
          distance + EPSILON < relation.minGap) {
          throw new Error("GEOMETRY_MATH_CLEARANCE_GAP_VIOLATION: " +
            relation.relationId + " [" +
            relation.first + "," + relation.second + "]");
        }
      }
    }
  }
}
