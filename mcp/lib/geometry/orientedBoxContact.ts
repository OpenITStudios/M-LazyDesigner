export type Vec3 = [number, number, number];

export type OrientedBox = {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  halfSizes: Vec3;
};

export type OrientedBoxContactClassification =
  | "separate"
  | "touching"
  | "intersecting";

export type OrientedBoxContactResult = {
  method: "obb_sat";
  classification: OrientedBoxContactClassification;
  signedAxisDistance: number;
  separation: number;
  penetrationDepth: number;
  normal: Vec3;
  testedAxes: number;
  exactForOrientedBoxes: true;
};

const AXIS_EPSILON = 1e-10;
const ORTHOGONAL_TOLERANCE = 1e-6;

function dot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [
    vector[0] * amount,
    vector[1] * amount,
    vector[2] * amount,
  ];
}

function magnitude(vector: Vec3): number {
  return Math.sqrt(dot(vector, vector));
}

function requireFiniteVec3(value: Vec3, context: string): Vec3 {
  if (value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`${context} must contain three finite values.`);
  }
  return [...value] as Vec3;
}

function normalizeAxis(value: Vec3, context: string): Vec3 {
  const axis = requireFiniteVec3(value, context);
  const length = magnitude(axis);
  if (!Number.isFinite(length) || length <= AXIS_EPSILON) {
    throw new Error(`${context} must be a non-zero finite axis.`);
  }
  return scale(axis, 1 / length);
}

function normalizeBox(box: OrientedBox, context: string): OrientedBox {
  const center = requireFiniteVec3(box.center, `${context} center`);
  const halfSizes = requireFiniteVec3(box.halfSizes, `${context} halfSizes`);
  if (halfSizes.some((value) => value < 0)) {
    throw new Error(`${context} halfSizes must be greater than or equal to 0.`);
  }

  const axes = box.axes.map((axis, index) =>
    normalizeAxis(axis, `${context} axis ${index}`)
  ) as [Vec3, Vec3, Vec3];

  for (let first = 0; first < axes.length; first += 1) {
    for (let second = first + 1; second < axes.length; second += 1) {
      if (Math.abs(dot(axes[first], axes[second])) > ORTHOGONAL_TOLERANCE) {
        throw new Error(`${context} axes must be mutually orthogonal.`);
      }
    }
  }

  return { center, axes, halfSizes };
}

function orientTowardOffset(axis: Vec3, offset: Vec3): Vec3 {
  return dot(axis, offset) < 0 ? scale(axis, -1) : axis;
}

function projectedRadius(box: OrientedBox, axis: Vec3): number {
  return box.halfSizes.reduce(
    (sum, halfSize, index) =>
      sum + halfSize * Math.abs(dot(box.axes[index], axis)),
    0
  );
}

/**
 * Exact rigid OBB containment, including rotated Cube axes.
 * The target's eight corners lie strictly inside the container iff
 * |center offset along each outer axis| + target projected half-radius
 * leaves a positive margin on each outer axis.
 *
 * This measures only one geometric snapshot, never opacity, rig intent,
 * actual camera occlusion, or future animation pose states.
 */
export function analyzeOrientedBoxContainment(
  outerInput: OrientedBox,
  targetInput: OrientedBox,
  tolerance = 1e-5
): {
  contained: boolean;
  minimum_signed_clearance: number;
  exactForOrientedBoxes: true;
} {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("OBB containment tolerance must be finite and nonnegative.");
  }
  const outer = normalizeBox(outerInput, "Container oriented box");
  const target = normalizeBox(targetInput, "Target oriented box");
  if (outer.halfSizes.some((size) => size <= tolerance) ||
      target.halfSizes.some((size) => size <= tolerance)) {
    return {
      contained: false,
      minimum_signed_clearance: 0,
      exactForOrientedBoxes: true,
    };
  }
  const offset = subtract(target.center, outer.center);
  const margins = outer.axes.map((axis, index) =>
    outer.halfSizes[index] -
    Math.abs(dot(offset, axis)) -
    projectedRadius(target, axis)
  );
  if (margins.some((margin) => !Number.isFinite(margin))) {
    throw new Error("OBB containment projection exceeded finite bounds.");
  }
  const clearance = Math.min(...margins);
  return {
    contained: clearance > tolerance,
    minimum_signed_clearance: clearance,
    exactForOrientedBoxes: true,
  };
}

/**
 * Exact separating-axis test for two oriented rectangular boxes.
 *
 * `signedAxisDistance` is the decisive SAT-axis gap (>0 when separate) or the
 * negative minimum translation depth (<0 when intersecting). It is not an
 * Euclidean surface distance.
 */
export function analyzeOrientedBoxContact(
  firstInput: OrientedBox,
  secondInput: OrientedBox,
  tolerance = 0.001
): OrientedBoxContactResult {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("OBB contact tolerance must be a finite value >= 0.");
  }

  const first = normalizeBox(firstInput, "First oriented box");
  const second = normalizeBox(secondInput, "Second oriented box");
  const offset = subtract(second.center, first.center);
  const candidates: Array<{ gap: number; axis: Vec3 }> = [];

  const consider = (rawAxis: Vec3): void => {
    const length = magnitude(rawAxis);
    if (!Number.isFinite(length) || length <= AXIS_EPSILON) return;

    let axis = scale(rawAxis, 1 / length);
    axis = orientTowardOffset(axis, offset);

    const centerDistance = Math.abs(dot(offset, axis));
    const overlap =
      projectedRadius(first, axis) +
      projectedRadius(second, axis) -
      centerDistance;

    candidates.push({
      gap: -overlap,
      axis,
    });
  };

  first.axes.forEach(consider);
  second.axes.forEach(consider);
  first.axes.forEach((firstAxis) => {
    second.axes.forEach((secondAxis) => {
      consider(cross(firstAxis, secondAxis));
    });
  });

  const decisive = candidates.reduce((best, candidate) =>
    candidate.gap > best.gap ? candidate : best
  );

  if (decisive.gap > tolerance) {
    return {
      method: "obb_sat",
      classification: "separate",
      signedAxisDistance: decisive.gap,
      separation: decisive.gap,
      penetrationDepth: 0,
      normal: decisive.axis,
      testedAxes: candidates.length,
      exactForOrientedBoxes: true,
    };
  }

  if (decisive.gap >= -tolerance) {
    return {
      method: "obb_sat",
      classification: "touching",
      signedAxisDistance: 0,
      separation: 0,
      penetrationDepth: 0,
      normal: decisive.axis,
      testedAxes: candidates.length,
      exactForOrientedBoxes: true,
    };
  }

  const penetrationDepth = -decisive.gap;
  return {
    method: "obb_sat",
    classification: "intersecting",
    signedAxisDistance: decisive.gap,
    separation: 0,
    penetrationDepth,
    normal: decisive.axis,
    testedAxes: candidates.length,
    exactForOrientedBoxes: true,
  };
}
