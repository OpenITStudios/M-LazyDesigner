import type { RecipeVec3 } from "./contracts";
import type { GeometryMathProfileSweepPart } from "./geometryMathLanguage";
import {
  MATH_PROGRAM_MAX_VOXELS,
  partitionMathVoxelVolume,
  type MathCuboid,
} from "./geometryMathVoxel";

/**
 * Opt-in v13 source-local elliptical/rectangular section sweep.
 *
 * The authored polyline, half-extents, twist and initial up axis specify
 * the geometry completely; no style preset, random detail, inferred curve,
 * native mesh, arbitrary executable expression or Bone transform.
 *
 * Each segment is a flat-ended generalized prism. Its cross-section at
 * axial coordinate t uses linear interpolation of declared half-extents
 * and twist. Consecutive segment frames are parallel-transported by the
 * minimum rotation between their tangents. Their volumes are UNIONED,
 * sampled at 1-model-unit cell centres and partitioned by the existing
 * deterministic Cuboid rasterizer. This is not exact mesh/CAD coverage:
 * the existing connectivity, coverage and Cube-count guards fail closed.
 */
type Vec3 = RecipeVec3;
type Station = GeometryMathProfileSweepPart["stations"][number];
type Segment = {
  start: Station;
  end: Station;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
  length: number;
  low: Vec3;
  high: Vec3;
};

const EPS = 1e-8;
const TAU_DEGREES = Math.PI / 180;
// Half-extent changes of at least one native model unit should produce a
// visible radial difference at the one-unit voxel scale. This is a
// representability guard, not a new style/geometry-size policy.
const MATERIAL_TAPER_DELTA = 1;
const MIN_OBSERVED_TAPER = 0.5;
const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 =>
  [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, factor: number): Vec3 =>
  [a[0] * factor, a[1] * factor, a[2] * factor];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

function normalized(v: Vec3, reason: string): Vec3 {
  const size = length(v);
  if (!Number.isFinite(size) || size < EPS) {
    throw new Error(reason);
  }
  return mul(v, 1 / size);
}

/** Proper rotation, not a mirrored frame or a Blockbench Euler transform. */
function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return add(
    add(mul(v, cos), mul(cross(axis, v), sin)),
    mul(axis, dot(axis, v) * (1 - cos))
  );
}

function segmentFrames(part: GeometryMathProfileSweepPart): Segment[] {
  const axis: Vec3 = part.up_axis === "X" ? [1, 0, 0] :
    part.up_axis === "Y" ? [0, 1, 0] : [0, 0, 1];
  let previousTangent: Vec3 | null = null;
  let previousNormal: Vec3 | null = null;
  const segments: Segment[] = [];

  for (let index = 0; index + 1 < part.stations.length; index++) {
    const start = part.stations[index]!;
    const end = part.stations[index + 1]!;
    const delta = sub(end.position, start.position);
    const span = length(delta);
    if (!Number.isFinite(span) || span < 1) {
      throw new Error("GEOMETRY_MATH_PROFILE_SWEEP_STATION_SEPARATION");
    }
    const tangent = mul(delta, 1 / span);
    let normal: Vec3;
    if (previousTangent === null || previousNormal === null) {
      // Authored up axis is required; no guessed fallback or arbitrary roll.
      normal = normalized(
        sub(axis, mul(tangent, dot(axis, tangent))),
        "GEOMETRY_MATH_PROFILE_SWEEP_UP_AXIS_PARALLEL"
      );
    } else {
      const cosine = Math.max(-1, Math.min(1, dot(previousTangent, tangent)));
      if (cosine < -1 + EPS) {
        throw new Error("GEOMETRY_MATH_PROFILE_SWEEP_REVERSAL_UNSUPPORTED");
      }
      const rotation = cross(previousTangent, tangent);
      const sine = length(rotation);
      const transported = sine < EPS
        ? previousNormal
        : rotateAroundAxis(
          previousNormal,
          mul(rotation, 1 / sine),
          Math.atan2(sine, cosine)
        );
      // Re-orthogonalize after numerical transport without changing roll.
      normal = normalized(
        sub(transported, mul(tangent, dot(transported, tangent))),
        "GEOMETRY_MATH_PROFILE_SWEEP_FRAME_DEGENERATE"
      );
    }
    const binormal = normalized(
      cross(tangent, normal),
      "GEOMETRY_MATH_PROFILE_SWEEP_FRAME_DEGENERATE"
    );
    const radius = Math.max(
      Math.hypot(start.half_width, start.half_height),
      Math.hypot(end.half_width, end.half_height)
    );
    const low = [0, 1, 2].map(d =>
      Math.min(start.position[d]!, end.position[d]!) - radius
    ) as Vec3;
    const high = [0, 1, 2].map(d =>
      Math.max(start.position[d]!, end.position[d]!) + radius
    ) as Vec3;
    segments.push({start, end, tangent, normal, binormal,
      length: span, low, high});
    previousNormal = normal;
    previousTangent = tangent;
  }
  return segments;
}

function insideSegment(
  position: Vec3,
  segment: Segment,
  profile: GeometryMathProfileSweepPart["cross_section"]
): boolean {
  if ([0, 1, 2].some(d =>
    position[d]! < segment.low[d]! - EPS ||
    position[d]! > segment.high[d]! + EPS
  )) return false;

  const offset = sub(position, segment.start.position);
  const axial = dot(offset, segment.tangent);
  // Strict flat-end cap: clamping an outside point would make an infinite
  // extension of the endpoint's section.
  if (axial < -EPS || axial > segment.length + EPS) return false;
  const t = Math.max(0, Math.min(1, axial / segment.length));
  const center = add(segment.start.position,
    mul(segment.tangent, segment.length * t));
  const width = segment.start.half_width +
    (segment.end.half_width - segment.start.half_width) * t;
  const height = segment.start.half_height +
    (segment.end.half_height - segment.start.half_height) * t;
  const twist = (
    segment.start.twist_degrees +
    (segment.end.twist_degrees - segment.start.twist_degrees) * t
  ) * TAU_DEGREES;
  const sin = Math.sin(twist), cos = Math.cos(twist);
  const n = add(mul(segment.normal, cos), mul(segment.binormal, sin));
  const b = add(mul(segment.binormal, cos), mul(segment.normal, -sin));
  const relative = sub(position, center);
  const u = dot(relative, n) / width;
  const v = dot(relative, b) / height;
  if (profile === "RECTANGLE") {
    return Math.abs(u) <= 1 + EPS && Math.abs(v) <= 1 + EPS;
  }
  return u * u + v * v <= 1 + EPS;
}

/**
 * The global 6-connected mass check cannot establish that each authored
 * consecutive sweep segment is connected to the next. For instance a third
 * nonadjacent segment may connect two disjoint contributions elsewhere.
 *
 * Each 1-unit raster cell carries a 7-bit segment-membership mask (at most
 * eight stations). Adjacent segments must share an occupied voxel OR have
 * occupied voxels touching through a full face. A mere edge/corner touch
 * is not a native-Cuboid volume connection. This is source structure,
 * not a visual, tangent-continuity or material/rig quality verdict.
 */
export function requireProfileSweepSequentialContact(
  ownership: Uint8Array,
  grid: readonly [number, number, number],
  segmentCount: number
): void {
  const [nx, ny, nz] = grid;
  for (let segment = 0; segment + 1 < segmentCount; segment++) {
    const first = 1 << segment;
    const second = 1 << (segment + 1);
    let linked = false;
    for (let index = 0; index < ownership.length && !linked; index++) {
      if (!(ownership[index]! & first)) continue;
      if (ownership[index]! & second) {
        linked = true;
        break;
      }
      const x = index % nx;
      const z = Math.floor(index / nx) % nz;
      const y = Math.floor(index / (nx * nz));
      linked =
        (x > 0 && Boolean(ownership[index - 1]! & second)) ||
        (x + 1 < nx && Boolean(ownership[index + 1]! & second)) ||
        (z > 0 && Boolean(ownership[index - nx]! & second)) ||
        (z + 1 < nz && Boolean(ownership[index + nx]! & second)) ||
        (y > 0 && Boolean(ownership[index - nx * nz]! & second)) ||
        (y + 1 < ny && Boolean(ownership[index + nx * nz]! & second));
    }
    if (!linked) {
      throw new Error(
        "GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED: " +
        segment + " -> " + (segment + 1)
      );
    }
  }
}

type TaperBand = {
  cells: number;
  radial_width: number;
  radial_height: number;
};
type TaperObservation = { start: TaperBand; end: TaperBand };

function observeTaperVoxel(
  point: Vec3, segment: Segment, observation: TaperObservation
): void {
  // Check just the first/last native axial model-unit neighbourhood.
  // Short segments may lack distinct samples; that is insufficient
  // resolution to claim a material taper survived voxelization.
  const axial = dot(sub(point, segment.start.position), segment.tangent);
  const band = Math.min(1, segment.length / 3);
  const nearStart = axial <= band + EPS;
  const nearEnd = segment.length - axial <= band + EPS;
  if (!nearStart && !nearEnd) return;

  const t = Math.max(0, Math.min(1, axial / segment.length));
  const center = add(segment.start.position,
    mul(segment.tangent, segment.length * t));
  const angle = (segment.start.twist_degrees +
    (segment.end.twist_degrees - segment.start.twist_degrees) * t
  ) * TAU_DEGREES;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const normal = add(mul(segment.normal, cos), mul(segment.binormal, sin));
  const binormal = add(mul(segment.binormal, cos), mul(segment.normal, -sin));
  const relative = sub(point, center);
  const width = Math.abs(dot(relative, normal));
  const height = Math.abs(dot(relative, binormal));
  const record = (target: TaperBand): void => {
    target.cells++;
    target.radial_width = Math.max(target.radial_width, width);
    target.radial_height = Math.max(target.radial_height, height);
  };
  if (nearStart) record(observation.start);
  if (nearEnd) record(observation.end);
}

function requireMaterialTaperSignal(
  segments: readonly Segment[],
  observations: readonly TaperObservation[]
): void {
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const deltaWidth = segment.end.half_width - segment.start.half_width;
    const deltaHeight = segment.end.half_height - segment.start.half_height;
    const significantWidth = Math.abs(deltaWidth) >= MATERIAL_TAPER_DELTA;
    const significantHeight = Math.abs(deltaHeight) >= MATERIAL_TAPER_DELTA;
    if (!significantWidth && !significantHeight) continue;
    const observed = observations[index]!;
    if (observed.start.cells === 0 || observed.end.cells === 0) {
      throw new Error(
        "GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED: segment=" +
        index + ";reason=ENDPOINT_BAND_MISSING"
      );
    }
    for (const [axis, expected, field] of [
      ["WIDTH", deltaWidth, "radial_width"],
      ["HEIGHT", deltaHeight, "radial_height"],
    ] as const) {
      if (Math.abs(expected) < MATERIAL_TAPER_DELTA) continue;
      // Use each cell's actual local twisted section frame, not a global
      // XYZ bounding box that can hide anisotropic taper and curvature.
      const observedDelta = (
        observed.end[field] - observed.start[field]
      ) * Math.sign(expected);
      if (!Number.isFinite(observedDelta) ||
          observedDelta < MIN_OBSERVED_TAPER - EPS) {
        throw new Error(
          "GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED: segment=" +
          index + ";axis=" + axis
        );
      }
    }
  }
}

export function sweepMathProfileVolume(
  part: GeometryMathProfileSweepPart
): MathCuboid[] {
  const segments = segmentFrames(part);
  if (segments.length === 0) {
    throw new Error("GEOMETRY_MATH_PROFILE_SWEEP_NO_SEGMENTS");
  }
  const low: Vec3 = [0, 1, 2].map(d =>
    Math.floor(Math.min(...segments.map(s => s.low[d]!)) - 0.5)
  ) as Vec3;
  const high: Vec3 = [0, 1, 2].map(d =>
    Math.ceil(Math.max(...segments.map(s => s.high[d]!)) + 0.5)
  ) as Vec3;
  const grid = [0, 1, 2].map(d => high[d]! - low[d]!)
    as [number, number, number];
  // Respect the SAME shared voxel grid budget BEFORE allocating a compact
  // segment membership bitmap. This is 1 byte/cell, not a second raster.
  const volume = grid[0] * grid[1] * grid[2];
  if (grid.some(n => !Number.isSafeInteger(n) || n < 1 || n > 64) ||
      !Number.isSafeInteger(volume) || volume > MATH_PROGRAM_MAX_VOXELS) {
    throw new Error("GEOMETRY_MATH_VOXEL_GRID_BUDGET");
  }
  const ownership = new Uint8Array(volume);
  const represented = new Uint8Array(segments.length);
  // Only inspect endpoint-band samples for declared material tapers.
  // No extra voxel raster, persisted geometry source, or native action.
  const needsTaperReview = segments.map(segment =>
    Math.abs(segment.end.half_width - segment.start.half_width) >=
      MATERIAL_TAPER_DELTA ||
    Math.abs(segment.end.half_height - segment.start.half_height) >=
      MATERIAL_TAPER_DELTA
  );
  const taperObservations: TaperObservation[] = segments.map(() => ({
    start: { cells: 0, radial_width: 0, radial_height: 0 },
    end: { cells: 0, radial_width: 0, radial_height: 0 },
  }));
  const boxes = partitionMathVoxelVolume(low, grid, (x, y, z) => {
    const point: Vec3 = [low[0] + x + 0.5,
      low[1] + y + 0.5, low[2] + z + 0.5];
    let included = false;
    const index = (y * grid[2] + z) * grid[0] + x;
    for (let i = 0; i < segments.length; i++) {
      if (!insideSegment(point, segments[i]!, part.cross_section)) continue;
      ownership[index] |= 1 << i;
      represented[i] = 1;
      if (needsTaperReview[i]) {
        observeTaperVoxel(point, segments[i]!, taperObservations[i]!);
      }
      included = true;
    }
    return included;
  });
  if (represented.some(v => v === 0)) {
    throw new Error(
      "GEOMETRY_MATH_PROFILE_SWEEP_SEGMENT_LOST: " +
      "a declared path segment is absent at one-model-unit resolution."
    );
  }
  requireProfileSweepSequentialContact(ownership, grid, segments.length);
  requireMaterialTaperSignal(segments, taperObservations);
  return boxes;
}
