import type { RecipeVec3 } from "./contracts";
import type { GeometryDimensionBounds } from "./geometryMathDimensionConstraints";
import type {
  GeometryMathCalibrationUncertainty,
  GeometryMathScaleContext,
  GeometryMathUncertaintyTarget,
} from "./geometryMathLanguage";

/**
 * V12 uncertainty is a source-declared interval, not a statistical
 * confidence interval, independent reference verification or a guessed
 * Minecraft/real-world scale. This module is a pure read-only pre-native
 * acceptance function inside the SAME Geometry Construction Language.
 *
 * All factors are positive and all target magnitudes are nonnegative.
 * Therefore interval propagation is monotone and needs no sampling:
 *
 *   METERS: [mLow * 16 / metersPerBlockHigh,
 *            mHigh * 16 / metersPerBlockLow]
 *   PLAYER_HEIGHTS: [hLow * playerBlocksLow * 16,
 *                    hHigh * playerBlocksHigh * 16]
 *
 * v11's exact nominal values are retained. The optional v12 ranges must
 * include those nominals and are used here solely to judge robustness of
 * the already constructed native Cuboids.
 */
const AXES = ["X", "Y", "Z"] as const;
const MODEL_UNITS_PER_BLOCK = 16;
const EPSILON = 1e-7;
const MAX_PARTS = 8;
const MAX_TARGETS = 16;

type ClosedInterval = { minimum: number; maximum: number };
export type GeometryScaleUncertaintyAssessment = {
  id: string;
  part_id: string;
  axis: "X" | "Y" | "Z";
  actual_model_units: number;
  declared_possible_model_units: ClosedInterval;
  tolerance_model_units: number;
  /** Caller declarations only; neither outcome verifies reference content. */
  source_evidence: "DECLARED_SPEC" | "REFERENCE_CLAIM";
  external_reference_verified: false;
  state:
    | "ALL_DECLARED_VALUES_FIT"
    | "SOME_DECLARED_VALUES_FIT"
    | "NO_DECLARED_VALUES_FIT";
};

function requireRange(
  value: ClosedInterval,
  lowerLimit: number,
  upperLimit: number,
  id: string
): ClosedInterval {
  if (!Number.isFinite(value.minimum) ||
    !Number.isFinite(value.maximum) ||
    value.minimum < lowerLimit ||
    value.maximum > upperLimit ||
    value.minimum > value.maximum) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_CALIBRATION_INVALID: " + id);
  }
  return value;
}

function calibrationInterval(
  context: GeometryMathScaleContext,
  uncertainty: GeometryMathCalibrationUncertainty | undefined,
  kind: "meters_per_block" | "player_height_blocks",
  low: number,
  high: number
): ClosedInterval {
  const nominal = context[kind]?.value;
  if (nominal === undefined || !Number.isFinite(nominal)) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_CALIBRATION_MISSING: " + kind);
  }
  const declared = uncertainty?.[kind];
  const interval = requireRange({
    minimum: declared?.min_value ?? nominal,
    maximum: declared?.max_value ?? nominal,
  }, low, high, kind);
  if (nominal < interval.minimum || nominal > interval.maximum) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_NOMINAL_OUTSIDE_RANGE: " + kind);
  }
  return interval;
}

function convertTargetInterval(
  target: GeometryMathUncertaintyTarget,
  context: GeometryMathScaleContext,
  uncertainty?: GeometryMathCalibrationUncertainty
): ClosedInterval {
  const minimum = target.min_value, maximum = target.max_value;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) ||
    minimum < 0 || maximum < minimum || maximum > 4096 ||
    !Number.isFinite(target.tolerance_model_units) ||
    target.tolerance_model_units < 0 ||
    target.tolerance_model_units > 16) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_RANGE_INVALID: " + target.id);
  }
  let lowerFactor: number, upperFactor: number;
  switch (target.unit) {
    case "MODEL_UNITS":
      lowerFactor = upperFactor = 1;
      break;
    case "BLOCKS":
      lowerFactor = upperFactor = MODEL_UNITS_PER_BLOCK;
      break;
    case "METERS":
    case "CENTIMETERS": {
      const calibration = calibrationInterval(
        context, uncertainty, "meters_per_block", 0.01, 100
      );
      const unitFactor = target.unit === "CENTIMETERS" ? 0.01 : 1;
      lowerFactor = MODEL_UNITS_PER_BLOCK * unitFactor /
        calibration.maximum;
      upperFactor = MODEL_UNITS_PER_BLOCK * unitFactor /
        calibration.minimum;
      break;
    }
    case "PLAYER_HEIGHTS": {
      const calibration = calibrationInterval(
        context, uncertainty, "player_height_blocks", 0.5, 4
      );
      lowerFactor = calibration.minimum * MODEL_UNITS_PER_BLOCK;
      upperFactor = calibration.maximum * MODEL_UNITS_PER_BLOCK;
      break;
    }
    default:
      throw new Error("GEOMETRY_MATH_UNCERTAINTY_UNIT_UNSUPPORTED");
  }
  const interval = {
    minimum: minimum * lowerFactor,
    maximum: maximum * upperFactor,
  };
  if (!Number.isFinite(interval.minimum) ||
    !Number.isFinite(interval.maximum) ||
    interval.minimum < 0 || interval.maximum < interval.minimum) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_NUMERIC_OVERFLOW: " + target.id);
  }
  return interval;
}

/**
 * Return a tri-state assessment. SOME is intentionally NOT a source
 * success or a verified reference verdict; it requires a tighter
 * calibration/measurement or an explicit acceptable native tolerance.
 * Outcomes are based only on caller-declared intervals.
 */
export function assessGeometryScaleUncertainty(
  parts: readonly GeometryDimensionBounds[],
  context: GeometryMathScaleContext,
  targets: readonly GeometryMathUncertaintyTarget[],
  calibrationUncertainty?: GeometryMathCalibrationUncertainty
): GeometryScaleUncertaintyAssessment[] {
  if (context.model_units_per_block !== MODEL_UNITS_PER_BLOCK ||
    parts.length < 1 || parts.length > MAX_PARTS ||
    targets.length < 1 || targets.length > MAX_TARGETS) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_INPUT_BUDGET");
  }
  // Validate every declared calibration even if a target does not use it.
  // This prevents silently preserving contradictory source claims.
  for (const kind of ["meters_per_block", "player_height_blocks"] as const) {
    if (calibrationUncertainty?.[kind]) calibrationInterval(
      context, calibrationUncertainty, kind,
      kind === "meters_per_block" ? 0.01 : 0.5,
      kind === "meters_per_block" ? 100 : 4
    );
  }
  const byId = new Map(parts.map(part => [part.id, part] as const));
  if (byId.size !== parts.length) {
    throw new Error("GEOMETRY_MATH_UNCERTAINTY_PART_ID_DUPLICATE");
  }
  const claimedAxes = new Set<string>();
  const claimedIds = new Set<string>();

  return [...targets].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  ).map(target => {
    const owner = target.part_id + ":" + target.axis;
    if (claimedIds.has(target.id) || claimedAxes.has(owner)) {
      throw new Error("GEOMETRY_MATH_UNCERTAINTY_TARGET_DUPLICATE: " +
        target.id);
    }
    claimedIds.add(target.id);
    claimedAxes.add(owner);
    const part = byId.get(target.part_id);
    const axis = AXES.indexOf(target.axis);
    if (!part || axis < 0) {
      throw new Error("GEOMETRY_MATH_UNCERTAINTY_PART_OR_AXIS_UNKNOWN: " +
        target.id);
    }
    const actual = part.max[axis]! - part.min[axis]!;
    if (!Number.isFinite(actual) || actual <= 0) {
      throw new Error("GEOMETRY_MATH_UNCERTAINTY_ACTUAL_SPAN_INVALID: " +
        target.id);
    }
    const expected = convertTargetInterval(target, context,
      calibrationUncertainty);
    const tolerance = target.tolerance_model_units;
    // For ALL, every source-declared plausible size must fit inside
    // the allowed tolerance of the ONE already-realized native span.
    const all = expected.minimum >= actual - tolerance - EPSILON &&
      expected.maximum <= actual + tolerance + EPSILON;
    // SOME means intersection only: insufficient to guarantee the
    // whole authored interval will be accepted. Do not silently PASS.
    const some = expected.maximum >= actual - tolerance - EPSILON &&
      expected.minimum <= actual + tolerance + EPSILON;
    return {
      id: target.id,
      part_id: target.part_id,
      axis: target.axis,
      actual_model_units: actual,
      declared_possible_model_units: expected,
      tolerance_model_units: tolerance,
      source_evidence: target.evidence.kind,
      external_reference_verified: false as const,
      state: all
        ? "ALL_DECLARED_VALUES_FIT" as const
        : some
          ? "SOME_DECLARED_VALUES_FIT" as const
          : "NO_DECLARED_VALUES_FIT" as const,
    };
  });
}

/**
 * The single existing Geometry plan/apply preflight calls this *after*
 * the original dimension/ANCHOR/CLEARANCE construction but before native
 * Cube allocation. No mutation or automatic target fit is attempted.
 */
export function requireGeometryScaleUncertainty(
  parts: readonly GeometryDimensionBounds[],
  context: GeometryMathScaleContext,
  targets: readonly GeometryMathUncertaintyTarget[],
  calibrationUncertainty?: GeometryMathCalibrationUncertainty
): void {
  const assessed = assessGeometryScaleUncertainty(parts, context, targets,
    calibrationUncertainty);
  for (const assessment of assessed) {
    if (assessment.state === "ALL_DECLARED_VALUES_FIT") continue;
    const code = assessment.state === "SOME_DECLARED_VALUES_FIT"
      ? "GEOMETRY_MATH_UNCERTAINTY_REVIEW_REQUIRED"
      : "GEOMETRY_MATH_UNCERTAINTY_INCOMPATIBLE";
    const range = assessment.declared_possible_model_units;
    throw new Error(code + ": " + assessment.id +
      " [part=" + assessment.part_id +
      ";axis=" + assessment.axis +
      ";actual=" + assessment.actual_model_units +
      ";declared=" + range.minimum + ".." + range.maximum +
      ";tolerance=" + assessment.tolerance_model_units +
      ";reference_verified=false]");
  }
}
