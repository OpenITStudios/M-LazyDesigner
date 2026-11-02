import type { RecipeVec3 } from "./contracts";
import type {
  GeometryMathDimensionConstraint,
} from "./geometryMathLanguage";

/**
 * Pure v10 semantic dimension acceptance. This is deliberately NOT a
 * dimension solver, a geometry realizer, a second Recipe state owner or a
 * subjective style/beauty score. The existing part resolver computes
 * geometry first; this inspects those exact source-local extents.
 *
 * In an INSTANCE with signed LINEAR repeat, bounds cover the entire
 * array envelope, including intentionally empty spaces. A CONNECT
 * supplies its derived native-Cuboid bounds after canonical placement.
 */
export type GeometryDimensionBounds = {
  id: string;
  min: RecipeVec3;
  max: RecipeVec3;
};

const AXES = ["X", "Y", "Z"] as const;
const EPSILON = 1e-9;
const MAX_PARTS = 8;
const MAX_CONSTRAINTS = 16;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function requireGeometryDimensionConstraints(
  parts: readonly GeometryDimensionBounds[],
  constraints: readonly GeometryMathDimensionConstraint[]
): void {
  if (constraints.length === 0) return;
  if (parts.length < 1 || parts.length > MAX_PARTS ||
    constraints.length > MAX_CONSTRAINTS) {
    throw new Error("GEOMETRY_MATH_DIMENSION_CONSTRAINT_BUDGET");
  }
  const byId = new Map(parts.map(part => [part.id, part] as const));
  if (byId.size !== parts.length) {
    throw new Error("GEOMETRY_MATH_DIMENSION_CONSTRAINT_DUPLICATE_PART");
  }

  const extent = (partId: string, axis: typeof AXES[number]): number => {
    const part = byId.get(partId);
    if (!part) {
      throw new Error(
        "GEOMETRY_MATH_DIMENSION_CONSTRAINT_PART_MISSING: " + partId
      );
    }
    const index = AXES.indexOf(axis);
    const low = part.min[index], high = part.max[index];
    const span = high! - low!;
    if (!Number.isFinite(low) || !Number.isFinite(high) ||
      !Number.isFinite(span) || span <= 0) {
      throw new Error(
        "GEOMETRY_MATH_DIMENSION_CONSTRAINT_SPAN_INVALID: " +
        partId + ":" + axis
      );
    }
    return span;
  };

  const ids = constraints.map(item => item.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("GEOMETRY_MATH_DIMENSION_CONSTRAINT_DUPLICATE_ID");
  }

  for (const constraint of [...constraints]
    .sort((a, b) => compareIds(a.id, b.id))) {
    if (constraint.kind === "SPAN_BOUNDS") {
      const span = extent(constraint.part_id, constraint.axis);
      const { min_span: lower, max_span: upper } = constraint;
      if (![lower, upper].every(Number.isFinite) ||
        lower < 0 || upper > 64 || lower > upper) {
        throw new Error(
          "GEOMETRY_MATH_SPAN_BOUNDS_INVALID: " + constraint.id
        );
      }
      if (span + EPSILON < lower || span - EPSILON > upper) {
        throw new Error(
          "GEOMETRY_MATH_SPAN_BOUNDS_VIOLATION: " + constraint.id +
          " [part=" + constraint.part_id + ";axis=" + constraint.axis +
          ";span=" + span + ";range=" + lower + ".." + upper + "]"
        );
      }
      continue;
    }

    const numerator = extent(
      constraint.numerator_part_id, constraint.numerator_axis
    );
    const denominator = extent(
      constraint.denominator_part_id, constraint.denominator_axis
    );
    const lower = constraint.min_ratio, upper = constraint.max_ratio;
    if (![lower.numerator, lower.denominator,
      upper.numerator, upper.denominator].every(Number.isFinite) ||
      lower.denominator <= 0 || upper.denominator <= 0 ||
      lower.numerator < 0 || upper.numerator < 0) {
      throw new Error(
        "GEOMETRY_MATH_RATIO_BOUNDS_INVALID: " + constraint.id
      );
    }
    // Compare rational bounds by cross-multiplication. The source
    // denominators remain exact positive integers; finite native spans
    // are checked above. Never divide by an approximate or zero extent.
    const below = numerator * lower.denominator -
      denominator * lower.numerator;
    const above = numerator * upper.denominator -
      denominator * upper.numerator;
    if (![below, above].every(Number.isFinite)) {
      throw new Error(
        "GEOMETRY_MATH_RATIO_BOUNDS_OVERFLOW: " + constraint.id
      );
    }
    if (below < -EPSILON || above > EPSILON) {
      throw new Error(
        "GEOMETRY_MATH_RATIO_BOUNDS_VIOLATION: " + constraint.id +
        " [numerator_part=" + constraint.numerator_part_id +
        ";denominator_part=" + constraint.denominator_part_id +
        ";ratio=" + numerator / denominator + "]"
      );
    }
  }
}
