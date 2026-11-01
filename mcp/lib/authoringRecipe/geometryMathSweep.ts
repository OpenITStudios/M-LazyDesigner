import type { RecipeVec3 } from "./contracts";
import type { GeometryMathPart } from "./geometryMathLanguage";
import { partitionMathVoxelVolume, type MathCuboid } from "./geometryMathVoxel";

type Sweep = Extract<GeometryMathPart, { method: "SWEEP" }>;
type Knot = Sweep["knots"][number];
type Sample = { position: RecipeVec3; radius: number };

const MAX_SAMPLES = 96;
const MAX_DEPTH = 8;
const DISTANCE_EPS = 1e-5;

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

function sampleSweep(part: Sweep): Sample[] {
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
      // The midpoint alone misses an S-curve whose inflection crosses the
      // chord. Quarter samples provide an additional bounded deviation gate.
      const quarter = evaluate((3 * fromT + toT) / 4);
      const threeQuarter = evaluate((fromT + 3 * toT) / 4);
      const chordError = Math.max(...[quarter, mid, threeQuarter].map(
        sample => Math.sqrt(pointSegmentDistance(
          sample.position, a.position, b.position
        ).distanceSquared)
      ));
      const tooLong = distance(a.position, b.position) > 1.5;
      const radiusDelta = Math.abs(a.radius - b.radius) > 0.75;
      if (chordError > part.max_chord_error ||
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
 * Isotropic variable-radius sweep (union of local tapered capsule sections).
 * Circular sections have no moving-frame/twist ambiguity; anisotropic
 * rectangular sections require a future explicit rotation-minimizing frame
 * contract, NOT a silent reinterpretation of v1.
 */
export function sweepMathVolume(part: Sweep): MathCuboid[] {
  const samples = sampleSweep(part);
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
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i]!, b = samples[i + 1]!;
      const nearest = pointSegmentDistance(center, a.position, b.position);
      const radius = a.radius + (b.radius - a.radius) * nearest.t;
      if (nearest.distanceSquared <= radius * radius) return true;
    }
    return false;
  });
}
