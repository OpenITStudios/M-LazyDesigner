import type { RecipeVec3 } from "./contracts";
import type { GeometryMathPart, GeometryMathVersion } from "./geometryMathLanguage";
import { partitionMathVoxelVolume, type MathCuboid } from "./geometryMathVoxel";

type Sweep = Extract<GeometryMathPart, { method: "SWEEP" }>;
type Knot = Sweep["knots"][number];
type Sample = { position: RecipeVec3; radius: number };

const MAX_SAMPLES = 96;
const MAX_DEPTH = 8;
const DISTANCE_EPS = 1e-5;
const SURFACE_EPS = 1e-9;

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function lerp3(a: RecipeVec3, b: RecipeVec3, t: number): RecipeVec3 {
  return [0, 1, 2].map(i => a[i]! * (1 - t) + b[i]! * t) as RecipeVec3;
}

function extrapolate(a: RecipeVec3, b: RecipeVec3): RecipeVec3 {
  return [0, 1, 2].map(i => 2 * a[i]! - b[i]!) as RecipeVec3;
}

/**
 * Barry–Goldman centripetal Catmull–Rom construction. Endpoint ghosts are
 * extrapolated, so all four parameter intervals stay strictly positive.
 * α = 1/2 uses sqrt(chord length) for the nonuniform knot times.
 *
 * Only the centerline is interpolated cubically. Radius is interpolated
 * linearly between input stations to avoid unapproved overshoot.
 */
function centripetalSegment(
  points: readonly Knot[], segment: number, fraction: number
): RecipeVec3 {
  const p1 = points[segment]!.position;
  const p2 = points[segment + 1]!.position;
  const p0 = segment === 0
    ? extrapolate(p1, p2) : points[segment - 1]!.position;
  const p3 = segment + 2 === points.length
    ? extrapolate(p2, p1) : points[segment + 2]!.position;
  const t0 = 0;
  const t1 = t0 + Math.sqrt(distance(p0, p1));
  const t2 = t1 + Math.sqrt(distance(p1, p2));
  const t3 = t2 + Math.sqrt(distance(p2, p3));
  const t = t1 + (t2 - t1) * fraction;
  const mix = (a: RecipeVec3, b: RecipeVec3, at: number, start: number, end: number) =>
    lerp3(a, b, (at - start) / (end - start));
  const a1 = mix(p0, p1, t, t0, t1);
  const a2 = mix(p1, p2, t, t1, t2);
  const a3 = mix(p2, p3, t, t2, t3);
  const b1 = mix(a1, a2, t, t0, t2);
  const b2 = mix(a2, a3, t, t1, t3);
  return mix(b1, b2, t, t1, t2);
}

function pointSegmentDistance(
  p: RecipeVec3, a: RecipeVec3, b: RecipeVec3
): { distanceSquared: number; t: number } {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const denominator = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  if (denominator <= DISTANCE_EPS ** 2) {
    return {
      distanceSquared: (p[0] - a[0]) ** 2 +
        (p[1] - a[1]) ** 2 + (p[2] - a[2]) ** 2,
      t: 0,
    };
  }
  const t = Math.max(0, Math.min(1, (
    (p[0] - a[0]) * d[0] +
    (p[1] - a[1]) * d[1] +
    (p[2] - a[2]) * d[2]
  ) / denominator));
  return {
    distanceSquared: (p[0] - a[0] - t * d[0]) ** 2 +
      (p[1] - a[1] - t * d[1]) ** 2 +
      (p[2] - a[2] - t * d[2]) ** 2,
    t,
  };
}

/**
 * A centripetal Catmull–Rom segment is cubic in its local parameter.
 * Recovering the two interior cubic Bézier control points from evaluations
 * at 1/3 and 2/3 yields a *conservative* chord deviation bound:
 * every point on the cubic is a convex combination of its four controls,
 * and distance to the convex chord segment is a convex function.
 *
 * Midpoint-only or quarter-sample errors do NOT provide this guarantee.
 */
function cubicChordDeviationBound(
  evaluate: (t: number) => Sample,
  fromT: number,
  start: Sample,
  toT: number,
  end: Sample
): number {
  const third = (toT - fromT) / 3;
  const p1 = evaluate(fromT + third).position;
  const p2 = evaluate(fromT + 2 * third).position;
  const control1: RecipeVec3 = [0, 1, 2].map(axis => {
    const a = start.position[axis]!, d = end.position[axis]!;
    const first = 27 * p1[axis]! - 8 * a - d;
    const second = 27 * p2[axis]! - a - 8 * d;
    return (2 * first - second) / 18;
  }) as RecipeVec3;
  const control2: RecipeVec3 = [0, 1, 2].map(axis => {
    const a = start.position[axis]!, d = end.position[axis]!;
    const first = 27 * p1[axis]! - 8 * a - d;
    const second = 27 * p2[axis]! - a - 8 * d;
    return (2 * second - first) / 18;
  }) as RecipeVec3;
  const bound = Math.max(
    Math.sqrt(pointSegmentDistance(
      control1, start.position, end.position
    ).distanceSquared),
    Math.sqrt(pointSegmentDistance(
      control2, start.position, end.position
    ).distanceSquared)
  );
  if (!Number.isFinite(bound)) {
    throw new Error("GEOMETRY_MATH_SWEEP_BEZIER_BOUND_NONFINITE");
  }
  return bound;
}

function sampleSweep(part: Sweep, version: GeometryMathVersion): Sample[] {
  const nodes = part.knots;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const span = distance(nodes[i]!.position, nodes[i + 1]!.position);
    if (!Number.isFinite(span) || span <= DISTANCE_EPS) {
      throw new Error("GEOMETRY_MATH_SWEEP_DEGENERATE_PATH");
    }
  }
  if (part.interpolation === "LINEAR") {
    return nodes.map(knot => ({
      position: [...knot.position] as RecipeVec3, radius: knot.radius,
    }));
  }
  const samples: Sample[] = [{
    position: [...nodes[0]!.position] as RecipeVec3,
    radius: nodes[0]!.radius,
  }];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const first = nodes[i]!, last = nodes[i + 1]!;
    const evaluate = (t: number): Sample => ({
      position: centripetalSegment(nodes, i, t),
      radius: first.radius + (last.radius - first.radius) * t,
    });
    const recurse = (
      fromT: number, a: Sample, toT: number, b: Sample, depth: number
    ): void => {
      const midT = (fromT + toT) / 2;
      const mid = evaluate(midT);
      // Keep exact R3l/v1 source behaviour for saved .bbmodel Recipes.
      // Only v2 has a conservative cubic Bézier chord bound.
      const chordErrorBound = version === 1
        ? Math.max(...[
          evaluate((3 * fromT + toT) / 4),
          mid,
          evaluate((fromT + 3 * toT) / 4),
        ].map(sample => Math.sqrt(pointSegmentDistance(
          sample.position, a.position, b.position
        ).distanceSquared)))
        : cubicChordDeviationBound(evaluate, fromT, a, toT, b);
      const tooLong = distance(a.position, b.position) > 1.5;
      const radiusDelta = Math.abs(a.radius - b.radius) > 0.75;
      if (chordErrorBound > part.max_chord_error ||
          tooLong || radiusDelta) {
        if (depth >= MAX_DEPTH) {
          throw new Error("GEOMETRY_MATH_SWEEP_ADAPTIVE_LIMIT");
        }
        recurse(fromT, a, midT, mid, depth + 1);
        recurse(midT, mid, toT, b, depth + 1);
      } else {
        samples.push(b);
        if (samples.length > MAX_SAMPLES) {
          throw new Error("GEOMETRY_MATH_SWEEP_SAMPLE_BUDGET");
        }
      }
    };
    recurse(0, evaluate(0), 1, evaluate(1), 0);
  }
  // Endpoints must remain from the canonical caller knot sequence.
  samples[0] = {
    position: [...nodes[0]!.position] as RecipeVec3,
    radius: nodes[0]!.radius,
  };
  samples[samples.length - 1] = {
    position: [...nodes[nodes.length - 1]!.position] as RecipeVec3,
    radius: nodes[nodes.length - 1]!.radius,
  };
  return samples;
}

/**
 * A varying-radius sweep is the union of all spheres centered on the
 * segment with radius r(t)=r0+t*dr. Nearest-point comparison against
 * r(t_nearest) is WRONG for a changing radius (it can discard valid mass).
 *
 * Membership is the exact minimum of a quadratic:
 *   q(t) = |p-(a+t*d)|² - (r0+t*dr)², 0<=t<=1.
 * Convex segments check the stationary minimum plus both endpoints;
 * concave/linear segments have their minimum at an endpoint.
 */
type SphereSweepSegment = {
  start: RecipeVec3;
  delta: RecipeVec3;
  radius: number;
  radiusDelta: number;
  quadraticA: number;
  low: RecipeVec3;
  high: RecipeVec3;
};

function prepareSphereSegments(samples: readonly Sample[]): SphereSweepSegment[] {
  return samples.slice(1).map((end, index) => {
    const start = samples[index]!;
    const delta = [0, 1, 2].map(axis =>
      end.position[axis]! - start.position[axis]!
    ) as RecipeVec3;
    const radiusDelta = end.radius - start.radius;
    const quadraticA = delta.reduce((sum, d) => sum + d * d, 0) -
      radiusDelta * radiusDelta;
    const radius = Math.max(start.radius, end.radius);
    const low = [0, 1, 2].map(axis =>
      Math.min(start.position[axis]!, end.position[axis]!) - radius
    ) as RecipeVec3;
    const high = [0, 1, 2].map(axis =>
      Math.max(start.position[axis]!, end.position[axis]!) + radius
    ) as RecipeVec3;
    if (!Number.isFinite(quadraticA) ||
      [...low, ...high].some(value => !Number.isFinite(value))) {
      throw new Error("GEOMETRY_MATH_SWEEP_SEGMENT_NONFINITE");
    }
    return {
      start: start.position, delta,
      radius: start.radius, radiusDelta, quadraticA, low, high,
    };
  });
}

function insideSphereSweep(
  point: RecipeVec3, segment: SphereSweepSegment
): boolean {
  if ([0, 1, 2].some(axis =>
    point[axis]! < segment.low[axis]! ||
    point[axis]! > segment.high[axis]!
  )) return false;
  const w = [0, 1, 2].map(axis =>
    point[axis]! - segment.start[axis]!
  );
  const dot = w.reduce((sum, value, axis) =>
    sum + value * segment.delta[axis]!, 0
  );
  const squared = w.reduce((sum, value) => sum + value * value, 0);
  const a = segment.quadraticA;
  const b = -2 * (dot + segment.radius * segment.radiusDelta);
  const c = squared - segment.radius * segment.radius;
  if (![a, b, c].every(Number.isFinite)) {
    throw new Error("GEOMETRY_MATH_SWEEP_QUADRATIC_NONFINITE");
  }
  if (c <= SURFACE_EPS ||
    a + b + c <= SURFACE_EPS) return true;
  if (a <= 0) return false;
  const t = -b / (2 * a);
  return t > 0 && t < 1 &&
    (a * t + b) * t + c <= SURFACE_EPS;
}

/**
 * Isotropic variable-radius sweep: exact membership of the piecewise-linear
 * union of varying-radius spheres, with conservative cubic chord sampling.
 * Circular sections need no moving frame; anisotropic sections require an
 * explicit rotation-minimizing frame contract in a future version.
 */
export function sweepMathVolume(
  part: Sweep, version: GeometryMathVersion
): MathCuboid[] {
  const samples = sampleSweep(part, version);
  const segments = version === 2 ? prepareSphereSegments(samples) : null;
  const maxRadius = Math.max(...samples.map(s => s.radius));
  const low: RecipeVec3 = [0, 1, 2].map(axis =>
    Math.floor(Math.min(...samples.map(s => s.position[axis]!)) -
      maxRadius - 0.5)
  ) as RecipeVec3;
  const high: RecipeVec3 = [0, 1, 2].map(axis =>
    Math.ceil(Math.max(...samples.map(s => s.position[axis]!)) +
      maxRadius + 0.5)
  ) as RecipeVec3;
  const gridSize = [0, 1, 2].map(axis => high[axis]! - low[axis]!)
    as [number, number, number];
  return partitionMathVoxelVolume(low, gridSize, (x, y, z) => {
    const center: RecipeVec3 = [
      low[0] + x + 0.5,
      low[1] + y + 0.5,
      low[2] + z + 0.5,
    ];
    if (version === 1) {
      // Legacy R3l membership: nearest chord point against interpolated
      // radius. This was not the mathematically exact sphere union but MUST
      // remain stable for existing source-owned Recipe v1 cohorts.
      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i]!, b = samples[i + 1]!;
        const nearest = pointSegmentDistance(center, a.position, b.position);
        const radius = a.radius + (b.radius - a.radius) * nearest.t;
        if (nearest.distanceSquared <= radius * radius) return true;
      }
      return false;
    }
    return segments!.some(segment => insideSphereSweep(center, segment));
  });
}
