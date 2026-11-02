import type {
  GeometryMathMeasurementEvidence,
  GeometryMathMeasuredDimension,
  GeometryMathScaleContext,
  GeometryMathScaleTarget,
} from "./geometryMathLanguage";
import type {
  GeometryDimensionBounds,
} from "./geometryMathDimensionConstraints";
import type { RecipeVec3 } from "./contracts";

/**
 * Opt-in v11 measurement conversion and scale acceptance. One explicitly
 * measured BOX size can be calculated from a source-declared native unit,
 * but this is not an inference/resizing solver, a new source authority,
 * real-world calibration service or visual/reference proof.
 *
 * The existing modelling standard declares 16 native model units/block.
 * Real meters/block and player height have NO universal default here.
 * Every non-native conversion therefore requires caller-declared
 * calibration, which remains an unverified claim until external review.
 */
const AXES = ["X", "Y", "Z"] as const;
const MODEL_UNITS_PER_BLOCK = 16;
const EPSILON = 1e-7;
const MAX_PARTS = 8;
const MAX_TARGETS = 16;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A REFERENCE_CLAIM can point only to a source handle already declared on
 * the same Advanced Geometry feature. This protects provenance identity,
 * NOT the existence, contents, scale accuracy or user approval of a file.
 */
export function requireGeometryScaleClaimsBound(
  context: GeometryMathScaleContext,
  targets: readonly GeometryMathScaleTarget[],
  evidenceRefs: readonly string[],
  measuredDimensions: readonly GeometryMathMeasuredDimension[] = []
): void {
  if (context.model_units_per_block !== MODEL_UNITS_PER_BLOCK) {
    throw new Error("GEOMETRY_MATH_SCALE_MODEL_UNIT_POLICY_INVALID");
  }
  if (targets.length > MAX_TARGETS ||
    measuredDimensions.length > MAX_TARGETS) {
    throw new Error("GEOMETRY_MATH_SCALE_TARGET_BUDGET_EXCEEDED");
  }
  const available = new Set(evidenceRefs);
  const claims: GeometryMathMeasurementEvidence[] = [
    ...(context.meters_per_block
      ? [context.meters_per_block.evidence] : []),
    ...(context.player_height_blocks
      ? [context.player_height_blocks.evidence] : []),
    ...targets.map(target => target.evidence),
    ...measuredDimensions.map(target => target.evidence),
  ];
  for (const claim of claims) {
    if (claim.kind !== "REFERENCE_CLAIM") continue;
    if (!available.has(claim.source_ref)) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_SOURCE_REF_UNBOUND: " + claim.source_ref
      );
    }
  }
}

function unitsToModelUnits(
  unit: GeometryMathScaleTarget["unit"],
  context: GeometryMathScaleContext
): number {
  if (unit === "MODEL_UNITS") return 1;
  if (unit === "BLOCKS") return MODEL_UNITS_PER_BLOCK;
  if (unit === "PLAYER_HEIGHTS") {
    const height = context.player_height_blocks?.value;
    if (height === undefined) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_PLAYER_HEIGHT_CALIBRATION_MISSING"
      );
    }
    const factor = height * MODEL_UNITS_PER_BLOCK;
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_PLAYER_HEIGHT_CALIBRATION_INVALID"
      );
    }
    return factor;
  }
  const meters = context.meters_per_block?.value;
  if (meters === undefined) {
    throw new Error(
      "GEOMETRY_MATH_SCALE_PHYSICAL_CALIBRATION_MISSING"
    );
  }
  if (!Number.isFinite(meters) || meters <= 0) {
    throw new Error(
      "GEOMETRY_MATH_SCALE_PHYSICAL_CALIBRATION_INVALID"
    );
  }
  const factor = MODEL_UNITS_PER_BLOCK / meters;
  if (unit === "METERS") return factor;
  if (unit === "CENTIMETERS") return factor / 100;
  throw new Error("GEOMETRY_MATH_SCALE_UNSUPPORTED_UNIT");
}

/**
 * An explicit v11 MEASURED_DIMENSION can generate the size of one native
 * BOX axis from a declared unit and calibration. It is a single bounded
 * source-parameter calculation, not an arbitrary expression, optimisation,
 * estimated image measurement or scene transform.
 *
 * Exact-unit preflight: anything that does not resolve to an integer 1..32
 * native BOX model units is rejected, not silently rounded/clamped. The
 * tiny epsilon only accommodates floating multiplication noise around
 * integers; it is NOT an artistic quantisation policy.
 */
export function resolveGeometryMeasuredBoxSize(
  partId: string,
  authoredSize: RecipeVec3,
  context: GeometryMathScaleContext,
  measurements: readonly GeometryMathMeasuredDimension[]
): RecipeVec3 {
  const result: RecipeVec3 = [...authoredSize] as RecipeVec3;
  const claimed = new Set<string>();
  for (const measurement of measurements) {
    if (measurement.target_part_id !== partId) continue;
    const axis = AXES.indexOf(measurement.target_axis);
    if (axis < 0 || claimed.has(measurement.target_axis)) {
      throw new Error(
        "GEOMETRY_MATH_MEASURED_AXIS_AMBIGUOUS: " + measurement.id
      );
    }
    claimed.add(measurement.target_axis);
    const factor = unitsToModelUnits(measurement.unit, context);
    const converted = measurement.value * factor;
    const nearestInteger = Math.round(converted);
    if (!Number.isFinite(converted) || converted <= 0 ||
      Math.abs(converted - nearestInteger) > 1e-9) {
      throw new Error(
        "GEOMETRY_MATH_MEASURED_DIMENSION_NONINTEGER: " + measurement.id
      );
    }
    if (!Number.isSafeInteger(nearestInteger) ||
      nearestInteger < 1 || nearestInteger > 32) {
      throw new Error(
        "GEOMETRY_MATH_MEASURED_DIMENSION_NATIVE_SPAN_INVALID: " +
        measurement.id
      );
    }
    result[axis] = nearestInteger;
  }
  return result;
}

/**
 * Assertions are evaluated on actual constructed semantic part envelopes,
 * after DIMENSION_LINK resolution, FACE_ANCHOR placement and optional
 * derived CONNECT. For signed LINEAR repeats, an envelope includes the
 * deliberately empty space between distant copies: this function never
 * treats that space as solid material or an approved real-world dimension.
 */
export function requireGeometryScaleTargets(
  parts: readonly GeometryDimensionBounds[],
  context: GeometryMathScaleContext,
  targets: readonly GeometryMathScaleTarget[]
): void {
  if (!targets.length) return;
  if (parts.length < 1 || parts.length > MAX_PARTS ||
    targets.length > MAX_TARGETS) {
    throw new Error("GEOMETRY_MATH_SCALE_TARGET_BUDGET_EXCEEDED");
  }
  const byId = new Map(parts.map(part => [part.id, part] as const));
  if (byId.size !== parts.length) {
    throw new Error("GEOMETRY_MATH_SCALE_PART_ID_DUPLICATE");
  }
  const claims = new Set<string>();

  for (const target of [...targets].sort((a, b) =>
    compareIds(a.id, b.id))) {
    const part = byId.get(target.part_id);
    if (!part) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_TARGET_PART_UNKNOWN: " + target.part_id
      );
    }
    const axis = AXES.indexOf(target.axis);
    if (axis < 0) {
      throw new Error("GEOMETRY_MATH_SCALE_TARGET_AXIS_INVALID");
    }
    const owner = target.part_id + ":" + target.axis;
    if (claims.has(owner)) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_TARGET_AXIS_DUPLICATE: " + owner
      );
    }
    claims.add(owner);

    const actual = part.max[axis]! - part.min[axis]!;
    const factor = unitsToModelUnits(target.unit, context);
    const minimum = target.min_value * factor;
    const maximum = target.max_value * factor;
    if (![actual, factor, minimum, maximum].every(Number.isFinite) ||
      actual <= 0 || factor <= 0 ||
      minimum < 0 || maximum < minimum) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_TARGET_NUMERIC_INVALID: " + target.id
      );
    }
    if (actual + EPSILON < minimum ||
      actual - EPSILON > maximum) {
      throw new Error(
        "GEOMETRY_MATH_SCALE_TARGET_VIOLATION: " + target.id +
        " [part=" + target.part_id +
        ";axis=" + target.axis +
        ";unit=" + target.unit +
        ";actual_model_units=" + actual +
        ";target_model_units=" + minimum + ".." + maximum + "]"
      );
    }
  }
}
