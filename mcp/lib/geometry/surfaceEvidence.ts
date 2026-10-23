export const GEOMETRY_SURFACE_EPSILON = 1e-5;
export const GEOMETRY_SURFACE_EXAMPLE_LIMIT = 8;

export type SurfaceEvidenceCube = {
  uuid: string;
  name: string;
  from: readonly number[];
  to: readonly number[];
  inflate?: number;
  rotation?: readonly number[];
  /** Exact shared rigid transform owner; unknown parent means no inference. */
  parent_id?: string | null;
};

export const GEOMETRY_CONTAINMENT_PAIR_BUDGET = 65_536;

/**
 * Read-only, pre-Undo safe, same-parent rest-pose review.
 * Strict geometric enclosure cannot prove artistic redundancy or opacity.
 * The caller must never auto-delete or skip a Cube from these candidates.
 */
export function analyzeStaticCubeContainment(
  cubes: readonly SurfaceEvidenceCube[],
  options: {
    target_cube_ids?: readonly string[];
    exampleLimit?: number;
    pairBudget?: number;
  } = {}
) {
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const pairBudget = options.pairBudget ?? GEOMETRY_CONTAINMENT_PAIR_BUDGET;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 32 ||
      !Number.isInteger(pairBudget) || pairBudget < 1 ||
      pairBudget > GEOMETRY_CONTAINMENT_PAIR_BUDGET) {
    throw new Error("Geometry containment diagnostic example/budget limits are invalid.");
  }
  const namedTargets = options.target_cube_ids
    ? new Set(options.target_cube_ids)
    : null;
  const indexed = [...cubes].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const candidates = indexed.filter((cube) =>
    namedTargets === null || namedTargets.has(cube.uuid)
  );
  const eligible = indexed.filter((cube) =>
    typeof cube.parent_id === "string" && cube.parent_id.length > 0 &&
    (cube.rotation === undefined ||
      (finite3(cube.rotation) && !hasRotation(cube, GEOMETRY_SURFACE_EPSILON))) &&
    cubeBounds(cube) !== null
  );
  const byParent = new Map<string, SurfaceEvidenceCube[]>();
  for (const cube of eligible) {
    const id = cube.parent_id!;
    const cohort = byParent.get(id) ?? [];
    cohort.push(cube);
    byParent.set(id, cohort);
  }
  const examples: Array<{
    cube_uuid: string;
    cube_name: string;
    containing_cube_uuid: string;
    containing_cube_name: string;
    parent_id: string;
    reason: "STRICT_INTERIOR_REST_POSE";
  }> = [];
  let candidateCount = 0;
  let checkedPairs = 0;
  let unsupportedTargets = 0;
  let visitedTargets = 0;
  let truncated = false;
  for (const cube of candidates) {
    if (!cube.parent_id ||
        (cube.rotation !== undefined &&
          (!finite3(cube.rotation) || hasRotation(cube, GEOMETRY_SURFACE_EPSILON)))) {
      unsupportedTargets += 1;
      continue;
    }
    const inner = cubeBounds(cube);
    if (!inner) {
      unsupportedTargets += 1;
      continue;
    }
    visitedTargets += 1;
    let best: SurfaceEvidenceCube | null = null;
    let bestVolume = Number.POSITIVE_INFINITY;
    for (const other of byParent.get(cube.parent_id) ?? []) {
      if (other.uuid === cube.uuid) continue;
      if (checkedPairs >= pairBudget) {
        truncated = true;
        break;
      }
      checkedPairs += 1;
      const outer = cubeBounds(other)!;
      const interior = ([0, 1, 2] as const).every((axis) =>
        outer.min[axis] + GEOMETRY_SURFACE_EPSILON < inner.min[axis] &&
        inner.max[axis] < outer.max[axis] - GEOMETRY_SURFACE_EPSILON
      );
      if (!interior) continue;
      const volume = [0, 1, 2].reduce((product, axis) =>
        product * (outer.max[axis] - outer.min[axis]), 1
      );
      if (!best || volume < bestVolume ||
          (volume === bestVolume && other.uuid < best.uuid)) {
        best = other;
        bestVolume = volume;
      }
    }
    if (truncated) break;
    if (best) {
      candidateCount += 1;
      if (examples.length < exampleLimit) {
        examples.push({
          cube_uuid: cube.uuid,
          cube_name: cube.name,
          containing_cube_uuid: best.uuid,
          containing_cube_name: best.name,
          parent_id: cube.parent_id,
          reason: "STRICT_INTERIOR_REST_POSE",
        });
      }
    }
  }
  return {
    state: truncated || unsupportedTargets > 0
      ? ("partial" as const) : ("available" as const),
    checked_target_count: visitedTargets,
    unsupported_target_count: unsupportedTargets,
    unvisited_target_count: candidates.length - visitedTargets - unsupportedTargets,
    checked_pair_count: checkedPairs,
    contained_candidate_count: candidateCount,
    examples,
    examples_truncated: candidateCount > examples.length || truncated,
    note: "Strictly contained Cube under the same parent has no independent exposed rest-pose envelope when the enclosing Cube is opaque. Alpha, hidden states, animated visibility, materials and artistic intent are NOT verified. This is review evidence only: do not automatically remove or merge Geometry.",
  };
}

type Axis = 0 | 1 | 2;
type FaceName = "west" | "east" | "down" | "up" | "north" | "south";

type Face = {
  cube: SurfaceEvidenceCube;
  face: FaceName;
  axis: Axis;
  sign: -1 | 1;
  plane: number;
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
};

function finite3(values: readonly number[] | undefined): values is readonly [number, number, number] {
  return Boolean(values && values.length >= 3 && values.slice(0, 3).every(Number.isFinite));
}

function hasRotation(cube: SurfaceEvidenceCube, epsilon: number): boolean {
  if (!finite3(cube.rotation)) return false;
  return cube.rotation.some((value) => Math.abs(Number(value)) > epsilon);
}

function overlapAmount(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

function cubeBounds(cube: SurfaceEvidenceCube) {
  if (!finite3(cube.from) || !finite3(cube.to)) return null;
  const inflate = Number(cube.inflate ?? 0);
  if (!Number.isFinite(inflate)) return null;
  const min = [0, 1, 2].map((axis) => Math.min(Number(cube.from[axis]), Number(cube.to[axis])) - inflate);
  const max = [0, 1, 2].map((axis) => Math.max(Number(cube.from[axis]), Number(cube.to[axis])) + inflate);
  if (min.some((value, axis) => !Number.isFinite(value) || max[axis] - value <= 0)) return null;
  return { min, max };
}

function facesFor(cube: SurfaceEvidenceCube): Face[] {
  const bounds = cubeBounds(cube);
  if (!bounds) return [];
  const { min, max } = bounds;
  const definitions: Array<[FaceName, Axis, -1 | 1]> = [
    ["west", 0, -1], ["east", 0, 1],
    ["down", 1, -1], ["up", 1, 1],
    ["north", 2, -1], ["south", 2, 1],
  ];
  return definitions.map(([face, axis, sign]) => {
    const others = ([0, 1, 2] as Axis[]).filter((candidate) => candidate !== axis);
    return {
      cube,
      face,
      axis,
      sign,
      plane: sign < 0 ? min[axis] : max[axis],
      minA: min[others[0]],
      maxA: max[others[0]],
      minB: min[others[1]],
      maxB: max[others[1]],
    };
  });
}

/**
 * Deterministic same-facing coplanar overlap evidence for axis-aligned Cubes.
 * Rotated/group-transformed geometry must be treated as incomplete rather than
 * being promoted to a false clean verdict.
 */
export function analyzeAxisAlignedSurfaceEvidence(
  cubes: readonly SurfaceEvidenceCube[],
  options: {
    epsilon?: number;
    exampleLimit?: number;
    unsupportedTransformCount?: number;
    unsupportedMeshCount?: number;
  } = {}
) {
  const epsilon = options.epsilon ?? GEOMETRY_SURFACE_EPSILON;
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const invalid = cubes.filter((cube) => !cubeBounds(cube));
  const rotated = cubes.filter((cube) => hasRotation(cube, epsilon));
  const eligible = cubes.filter((cube) => cubeBounds(cube) && !hasRotation(cube, epsilon));
  const faces = eligible.flatMap(facesFor);
  const conflicts: Array<Record<string, unknown>> = [];
  const penetrations: Array<Record<string, unknown>> = [];

  for (let i = 0; i < eligible.length; i += 1) {
    const a = cubeBounds(eligible[i]);
    if (!a) continue;
    for (let j = i + 1; j < eligible.length; j += 1) {
      const b = cubeBounds(eligible[j]);
      if (!b) continue;
      const overlaps = ([0, 1, 2] as Axis[]).map((axis) => overlapAmount(a.min[axis], a.max[axis], b.min[axis], b.max[axis]));
      if (overlaps.every((value) => value > epsilon)) {
        penetrations.push({
          code: "POSITIVE_VOLUME_INTERSECTION",
          severity: "warning",
          a: { uuid: eligible[i].uuid, name: eligible[i].name },
          b: { uuid: eligible[j].uuid, name: eligible[j].name },
          overlap: overlaps.map((value) => Number(value.toFixed(5))),
        });
      }
    }
  }

  for (let i = 0; i < faces.length; i += 1) {
    const a = faces[i];
    for (let j = i + 1; j < faces.length; j += 1) {
      const b = faces[j];
      if (a.cube.uuid === b.cube.uuid || a.axis !== b.axis || a.sign !== b.sign) continue;
      if (Math.abs(a.plane - b.plane) > epsilon) continue;
      if (overlapAmount(a.minA, a.maxA, b.minA, b.maxA) <= epsilon) continue;
      if (overlapAmount(a.minB, a.maxB, b.minB, b.maxB) <= epsilon) continue;
      conflicts.push({
        code: "COPLANAR_SURFACE_OVERLAP",
        severity: "error",
        texture_risk: "z_fighting",
        a: { uuid: a.cube.uuid, name: a.cube.name, face: a.face },
        b: { uuid: b.cube.uuid, name: b.cube.name, face: b.face },
      });
    }
  }

  const containment = analyzeStaticCubeContainment(cubes, {
    exampleLimit: Math.min(32, Math.max(1, exampleLimit)),
  });

  const unsupportedTransformCount = options.unsupportedTransformCount ?? 0;
  const unsupportedMeshCount = options.unsupportedMeshCount ?? 0;
  const complete = invalid.length === 0 && rotated.length === 0 && unsupportedTransformCount === 0 && unsupportedMeshCount === 0;

  return {
    state: conflicts.length > 0 ? ("blocked" as const) : complete ? ("clean" as const) : ("partial" as const),
    scope: "axis_aligned_rest_pose" as const,
    complete,
    checked_cube_count: eligible.length,
    excluded_rotated_cube_count: rotated.length,
    invalid_cube_count: invalid.length,
    unsupported_transform_count: unsupportedTransformCount,
    unsupported_mesh_count: unsupportedMeshCount,
    coplanar_overlap_count: conflicts.length,
    coplanar_overlap_examples: conflicts.slice(0, exampleLimit),
    coplanar_overlap_examples_truncated: conflicts.length > exampleLimit,
    positive_volume_intersection_count: penetrations.length,
    positive_volume_examples: penetrations.slice(0, exampleLimit),
    positive_volume_examples_truncated: penetrations.length > exampleLimit,
    rest_pose_containment_review: containment,
    note: complete
      ? "Same-facing coplanar overlap is a deterministic texture-surface blocker. Positive-volume overlap is structural evidence only, not automatically a texture defect."
      : "Evidence is intentionally partial because rotated/group-transformed/mesh or invalid geometry is outside this bounded axis-aligned scan. Partial evidence must not be promoted to a clean whole-model surface verdict.",
  };
}
