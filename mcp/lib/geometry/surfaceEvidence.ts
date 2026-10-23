import {
  analyzeOrientedBoxContainment,
  type OrientedBox,
} from "@/lib/geometry/orientedBoxContact";

export const GEOMETRY_SURFACE_EPSILON = 1e-5;
export const GEOMETRY_SURFACE_EXAMPLE_LIMIT = 8;

export type SurfaceEvidenceCube = {
  uuid: string;
  name: string;
  from: readonly number[];
  to: readonly number[];
  inflate?: number;
  rotation?: readonly number[];
  /** Explicit Cube pivot in local coordinates; needed for possible merge parity. */
  origin?: readonly number[];
  /** Exact shared rigid transform owner; unknown parent means no inference. */
  parent_id?: string | null;
};

export const GEOMETRY_CONTAINMENT_PAIR_BUDGET = 65_536;
export const GEOMETRY_WORLD_OBB_SAMPLE_LIMIT = 256;
export const GEOMETRY_WORLD_OBB_TARGET_LIMIT = 24;
export const GEOMETRY_WORLD_OBB_PAIR_BUDGET = 4_096;

/**
 * Native Cube world-space OBBs as seen at ONE current preview transform.
 * Parent identity is required: boxes under unrelated Bones can overlap at
 * this pose but separate later. No native state or animation is sampled here.
 */
export type GeometryWorldObbInput = {
  uuid: string;
  name: string;
  parent_id: string | null;
  obb: OrientedBox | null;
};

/** Advisory current-preview containment, sharing the canonical SAT/OBB math. */
export function analyzeCurrentPreviewObbContainment(
  cubes: readonly GeometryWorldObbInput[],
  options: {
    omitted_cube_count?: number;
    exampleLimit?: number;
    targetLimit?: number;
    pairBudget?: number;
  } = {}
) {
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const targetLimit = options.targetLimit ?? GEOMETRY_WORLD_OBB_TARGET_LIMIT;
  const pairBudget = options.pairBudget ?? GEOMETRY_WORLD_OBB_PAIR_BUDGET;
  const omitted = options.omitted_cube_count ?? 0;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 32 ||
      !Number.isInteger(targetLimit) || targetLimit < 1 ||
      targetLimit > GEOMETRY_WORLD_OBB_TARGET_LIMIT ||
      !Number.isInteger(pairBudget) || pairBudget < 1 ||
      pairBudget > GEOMETRY_WORLD_OBB_PAIR_BUDGET ||
      !Number.isInteger(omitted) || omitted < 0) {
    throw new Error("World OBB geometry review budgets are invalid.");
  }
  const unique = new Set(cubes.map((cube) => cube.uuid));
  if (unique.size !== cubes.length || cubes.some((cube) => !cube.uuid.trim())) {
    throw new Error("World OBB review requires unique nonempty native Cube UUIDs.");
  }
  const rotated = (obb: OrientedBox | null) => Boolean(obb && obb.axes.some(
    (axis) => Math.max(...axis.map(Math.abs)) < 1 - GEOMETRY_SURFACE_EPSILON
  ));
  const sorted = [...cubes].sort((a, b) =>
    Number(rotated(b.obb)) - Number(rotated(a.obb)) ||
    a.uuid.localeCompare(b.uuid)
  );
  const sampled = sorted.slice(0, GEOMETRY_WORLD_OBB_SAMPLE_LIMIT);
  const byParent = new Map<string, GeometryWorldObbInput[]>();
  for (const cube of sampled) {
    if (!cube.parent_id) continue;
    const peers = byParent.get(cube.parent_id) ?? [];
    peers.push(cube);
    byParent.set(cube.parent_id, peers);
  }
  const examples: Array<{
    cube_uuid: string;
    cube_name: string;
    containing_cube_uuid: string;
    containing_cube_name: string;
    parent_id: string;
    minimum_signed_clearance: number;
    world_rotation_involved: boolean;
  }> = [];
  let checked = 0;
  let unsupported = 0;
  let checkedPairs = 0;
  let candidateCount = 0;
  let truncated = sampled.length < cubes.length || omitted > 0;
  for (const target of sampled) {
    if (checked + unsupported >= targetLimit) {
      truncated = true;
      break;
    }
    if (!target.parent_id || !target.obb) {
      unsupported += 1;
      continue;
    }
    // Validate even when the Cube has no same-parent peers: malformed
    // preview axes or a plane cannot be reported as fully reviewed.
    try {
      analyzeOrientedBoxContainment(target.obb, target.obb);
      if (target.obb.halfSizes.some((size) => size <= GEOMETRY_SURFACE_EPSILON)) {
        unsupported += 1;
        continue;
      }
    } catch {
      unsupported += 1;
      continue;
    }
    const peers = (byParent.get(target.parent_id) ?? [])
      .filter((candidate) => candidate.uuid !== target.uuid);
    // Unknown preview mesh/transform invalidates negative conclusions; it
    // cannot be treated as absence of a containing sibling.
    if (peers.some((peer) => !peer.obb)) {
      unsupported += 1;
      continue;
    }
    if (checkedPairs + peers.length > pairBudget) {
      truncated = true;
      break;
    }
    let best: GeometryWorldObbInput | null = null;
    let bestVolume = Number.POSITIVE_INFINITY;
    let bestMargin = 0;
    let failed = false;
    checkedPairs += peers.length;
    for (const peer of peers) {
      try {
        const result = analyzeOrientedBoxContainment(
          peer.obb!, target.obb
        );
        if (!result.contained) continue;
        const size = peer.obb!.halfSizes;
        const volume = 8 * size[0] * size[1] * size[2];
        if (!Number.isFinite(volume)) {
          failed = true;
          break;
        }
        if (!best || volume < bestVolume ||
            (volume === bestVolume && peer.uuid < best.uuid)) {
          best = peer;
          bestVolume = volume;
          bestMargin = result.minimum_signed_clearance;
        }
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) {
      unsupported += 1;
      continue;
    }
    checked += 1;
    if (best) {
      candidateCount += 1;
      if (examples.length < exampleLimit) {
        examples.push({
          cube_uuid: target.uuid,
          cube_name: target.name,
          containing_cube_uuid: best.uuid,
          containing_cube_name: best.name,
          parent_id: target.parent_id,
          minimum_signed_clearance: Number(bestMargin.toPrecision(6)),
          world_rotation_involved: rotated(target.obb) || rotated(best.obb),
        });
      }
    }
  }
  return {
    state: truncated || unsupported > 0
      ? ("partial" as const) : ("available" as const),
    scope: "single_current_preview_world_obb" as const,
    pose_sweep: "not_evaluated" as const,
    visual_verdict: "not_evaluated" as const,
    sampled_cube_count: sampled.length,
    omitted_cube_count: omitted + Math.max(0, cubes.length - sampled.length),
    checked_target_count: checked,
    unsupported_target_count: unsupported,
    unvisited_target_count: sampled.length - checked - unsupported,
    checked_pair_count: checkedPairs,
    contained_candidate_count: candidateCount,
    examples,
    examples_truncated: candidateCount > examples.length || truncated,
    note: "World OBB containment uses the current preview mesh matrices, including Cube and Group rotations. It does not sample animation time or prove silhouette, opacity, mapped texture, alpha, visibility states, motion clearance or semantic redundancy. Inspect relevant poses before changing Geometry. Never auto-delete.",
  };
}


export const GEOMETRY_POSE_OBSERVATION_LIMIT = 8;
export const GEOMETRY_POSE_TARGET_LIMIT = 24;
export const GEOMETRY_POSE_PAIR_BUDGET = 4_096;

export type GeometryPoseObbSnapshot = {
  project_uuid: string;
  animation_uuid: string;
  time_seconds: number;
  /** One bounded preview-world OBB read per native Cube. */
  cubes: readonly GeometryWorldObbInput[];
  omitted_cube_count?: number;
};
export type GeometryPoseSamplingWindow = {
  start: number;
  end: number;
  max_gap_seconds: number;
};

/**
 * Aggregates already observed OBB frames without ever changing Timeline or
 * authoring state. Numeric frames are caller-supplied, not native attested.
 *
 * An observed pose transition can protect important Geometry. Conversely,
 * even 100% containment at sampled times is never permission to delete it:
 * unknown visibility/alpha, rig semantics and in-between frames can matter.
 */
export function analyzeGeometryPoseSequence(
  snapshots: readonly GeometryPoseObbSnapshot[],
  options: {
    target_cube_ids?: readonly string[];
    sampling_window?: GeometryPoseSamplingWindow;
    exampleLimit?: number;
    pairBudget?: number;
  } = {}
) {
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const pairBudget = options.pairBudget ?? GEOMETRY_POSE_PAIR_BUDGET;
  if (!Array.isArray(snapshots) ||
      snapshots.length < 1 ||
      snapshots.length > GEOMETRY_POSE_OBSERVATION_LIMIT ||
      !Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 32 ||
      !Number.isInteger(pairBudget) || pairBudget < 1 ||
      pairBudget > GEOMETRY_POSE_PAIR_BUDGET) {
    throw new Error("GEOMETRY_POSE_SAMPLE_BUDGET_INVALID");
  }
  const base = snapshots[0];
  if (!base.project_uuid.trim() || !base.animation_uuid.trim()) {
    throw new Error("GEOMETRY_POSE_IDENTITY_REQUIRED");
  }
  const observed = [...snapshots].sort((a, b) => a.time_seconds - b.time_seconds);
  const baseIds = new Set(observed[0].cubes.map((cube) => cube.uuid));
  let omitted = 0;
  for (let i = 0; i < observed.length; i++) {
    const frame = observed[i];
    if (frame.project_uuid !== base.project_uuid ||
        frame.animation_uuid !== base.animation_uuid) {
      throw new Error("GEOMETRY_POSE_CROSS_PROJECT_OR_ANIMATION");
    }
    if (!Number.isFinite(frame.time_seconds) || frame.time_seconds < 0 ||
        (i > 0 && frame.time_seconds <= observed[i - 1].time_seconds)) {
      throw new Error("GEOMETRY_POSE_TIME_INVALID_OR_DUPLICATED");
    }
    const count = frame.omitted_cube_count ?? 0;
    if (!Number.isInteger(count) || count < 0 ||
        frame.cubes.length > GEOMETRY_WORLD_OBB_SAMPLE_LIMIT) {
      throw new Error("GEOMETRY_POSE_SNAPSHOT_BUDGET_INVALID");
    }
    const ids = frame.cubes.map((cube) => cube.uuid);
    if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
      throw new Error("GEOMETRY_POSE_DUPLICATE_CUBE_ID");
    }
    omitted += count;
  }

  const window = options.sampling_window;
  if (window && (!Number.isFinite(window.start) || !Number.isFinite(window.end) ||
      !Number.isFinite(window.max_gap_seconds) ||
      window.start < 0 || window.end <= window.start ||
      window.max_gap_seconds <= 0)) {
    throw new Error("GEOMETRY_POSE_WINDOW_INVALID");
  }
  const times = observed.map((frame) => frame.time_seconds);
  const interval = window && observed.length >= 2 &&
    Math.abs(times[0] - window.start) <= GEOMETRY_SURFACE_EPSILON &&
    Math.abs(times[times.length - 1] - window.end) <= GEOMETRY_SURFACE_EPSILON &&
    times.every((time, index) => index === 0 ||
      time - times[index - 1] <= window.max_gap_seconds + GEOMETRY_SURFACE_EPSILON);
  const windowCoverage = window
    ? (interval ? "bounded_sample_schedule_met" as const : "incomplete" as const)
    : "unspecified" as const;
  const requested = options.target_cube_ids
    ? [...options.target_cube_ids].sort()
    : [...baseIds].sort();
  if (requested.length > GEOMETRY_WORLD_OBB_SAMPLE_LIMIT ||
      new Set(requested).size !== requested.length ||
      requested.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("GEOMETRY_POSE_TARGET_ID_INVALID_OR_EXCEEDS_BUDGET");
  }
  const targets = requested.slice(0, GEOMETRY_POSE_TARGET_LIMIT);
  const multiPose = observed.length >= 2;
  let truncated = targets.length < requested.length || omitted > 0;
  let pairs = 0, unverified = 0, exposed = 0, alwaysContained = 0;
  let notContained = 0;
  const entries: Array<{
    cube_uuid: string;
    outcome:
      "POSE_DEPENDENT_RETAIN" | "CONTAINED_AT_SAMPLED_POSES_REVIEW" |
      "NO_CONTAINMENT_OBSERVED" | "UNVERIFIED";
    reason: string;
    time_observations: Array<{
      time_seconds: number;
      containing_cube_uuid: string | null;
    }>;
  }> = [];

  for (const id of targets) {
    const appearances: Array<{ time_seconds: number; containing_cube_uuid: string | null }> = [];
    let reason: string | null = null;
    let anchorParent: string | null = null;
    for (const frame of observed) {
      const frameById = new Map(frame.cubes.map((cube) => [cube.uuid, cube]));
      if (frameById.size !== baseIds.size ||
          [...baseIds].some((candidate) => !frameById.has(candidate))) {
        reason = "POSE_CUBE_SET_CHANGED";
        break;
      }
      const target = frameById.get(id);
      if (!target || !target.parent_id || !target.obb) {
        reason = "POSE_TARGET_UNAVAILABLE";
        break;
      }
      if (anchorParent !== null && target.parent_id !== anchorParent) {
        reason = "POSE_PARENT_CHANGED";
        break;
      }
      anchorParent = target.parent_id;
      const peers = frame.cubes.filter((peer) =>
        peer.uuid !== id && peer.parent_id === target.parent_id
      );
      if (peers.length > GEOMETRY_WORLD_OBB_SAMPLE_LIMIT ||
          pairs + peers.length > pairBudget) {
        reason = "POSE_PAIR_BUDGET_EXCEEDED";
        truncated = true;
        break;
      }
      pairs += peers.length;
      if (peers.some((peer) => !peer.obb)) {
        reason = "POSE_PEER_WORLD_OBB_UNAVAILABLE";
        break;
      }
      let nearest: { id: string; volume: number } | null = null;
      try {
        // Validate the target independently so malformed/planar OBBs never
        // pass simply because no sibling exists.
        analyzeOrientedBoxContainment(target.obb, target.obb);
        if (target.obb.halfSizes.some((size) => size <= GEOMETRY_SURFACE_EPSILON)) {
          reason = "POSE_DEGENERATE_GEOMETRY";
          break;
        }
        for (const peer of peers) {
          const geometry = analyzeOrientedBoxContainment(peer.obb!, target.obb);
          if (!geometry.contained) continue;
          const [x, y, z] = peer.obb!.halfSizes;
          const volume = 8 * x * y * z;
          if (!Number.isFinite(volume)) throw new Error("nonfinite volume");
          if (!nearest || volume < nearest.volume ||
              (volume === nearest.volume && peer.uuid < nearest.id)) {
            nearest = { id: peer.uuid, volume };
          }
        }
      } catch {
        reason = "POSE_OBB_INVALID";
        break;
      }
      appearances.push({ time_seconds: frame.time_seconds,
        containing_cube_uuid: nearest?.id ?? null });
    }
    const containment = appearances.filter((entry) =>
      entry.containing_cube_uuid !== null).length;
    const complete = !reason && multiPose && appearances.length === observed.length;
    const outcome = !complete ? "UNVERIFIED" as const :
      containment === observed.length ? "CONTAINED_AT_SAMPLED_POSES_REVIEW" as const :
      containment > 0 ? "POSE_DEPENDENT_RETAIN" as const :
      "NO_CONTAINMENT_OBSERVED" as const;
    if (outcome === "UNVERIFIED") unverified++;
    else if (outcome === "POSE_DEPENDENT_RETAIN") exposed++;
    else if (outcome === "CONTAINED_AT_SAMPLED_POSES_REVIEW") alwaysContained++;
    else notContained++;
    entries.push({
      cube_uuid: id, outcome,
      reason: (!multiPose ? "ADDITIONAL_POSE_OBSERVATIONS_REQUIRED" : reason) ??
        (outcome === "POSE_DEPENDENT_RETAIN"
        ? "CURRENT_POSE_CONTAINMENT_CHANGES"
        : outcome === "CONTAINED_AT_SAMPLED_POSES_REVIEW"
        ? "CONTAINED_AT_OBSERVED_TIMES_ONLY"
        : "NO_STRICT_SAME_PARENT_CONTAINMENT"),
      time_observations: appearances,
    });
  }
  // Surface first the shapes that become exposed under articulation;
  // review-only always-contained masses next, then unverified/marginal data.
  const rank = (outcome: (typeof entries)[number]["outcome"]) =>
    outcome === "POSE_DEPENDENT_RETAIN" ? 0 :
    outcome === "CONTAINED_AT_SAMPLED_POSES_REVIEW" ? 1 :
    outcome === "UNVERIFIED" ? 2 : 3;
  entries.sort((a, b) => rank(a.outcome) - rank(b.outcome) ||
    a.cube_uuid.localeCompare(b.cube_uuid));
  return {
    state: !multiPose ? "insufficient_pose_samples" as const :
      truncated || unverified > 0 || windowCoverage !== "bounded_sample_schedule_met"
        ? "partial" as const : "sampled_times_only" as const,
    scope: "caller_supplied_world_obb_pose_samples" as const,
    sample_provenance: "not_native_attested" as const,
    visual_verdict: "not_evaluated" as const,
    geometry_mutation_authorized: false as const,
    project_uuid: base.project_uuid,
    animation_uuid: base.animation_uuid,
    observed_times_seconds: times,
    sampling_window_coverage: windowCoverage,
    compared_target_count: targets.length,
    unverified_target_count: unverified,
    pose_dependent_retain_count: exposed,
    contained_at_sampled_poses_review_count: alwaysContained,
    no_containment_observed_count: notContained,
    checked_pair_count: pairs,
    omitted_cube_count: omitted,
    examples: entries.slice(0, exampleLimit),
    examples_truncated: entries.length > exampleLimit || truncated,
    note: "Per-pose world-OBB samples are caller-provided numeric observations, not independently native attested. Becoming uncontained in another sampled pose protects Geometry from removal. Always contained is only a review candidate: between-frame motion, alpha, visibility, UV, contact and mapped visual quality are not proved. Never auto-delete.",
  };
}

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

/**
 * Exact union area of peer rectangles clipped to a target projection.
 * Coordinate sweeps avoid the false "bounding box covered" result when
 * separate rectangles leave a hole in the middle.
 */
type ProjectedRect = { u0: number; v0: number; u1: number; v1: number };
function projectedRect(
  bounds: NonNullable<ReturnType<typeof cubeBounds>>,
  axes: readonly [Axis, Axis]
): ProjectedRect {
  return { u0: bounds.min[axes[0]], u1: bounds.max[axes[0]],
    v0: bounds.min[axes[1]], v1: bounds.max[axes[1]] };
}
function coveredProjectedArea(
  target: ProjectedRect, peers: readonly ProjectedRect[]
): number {
  const clipped = peers.map((peer) => ({
    u0: Math.max(target.u0, peer.u0),
    u1: Math.min(target.u1, peer.u1),
    v0: Math.max(target.v0, peer.v0),
    v1: Math.min(target.v1, peer.v1),
  })).filter((rect) => rect.u1 > rect.u0 && rect.v1 > rect.v0);
  const stops = [...new Set([target.u0, target.u1,
    ...clipped.flatMap((rect) => [rect.u0, rect.u1])])].sort((a, b) => a - b);
  let covered = 0;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const u0 = stops[index], u1 = stops[index + 1];
    if (u1 <= u0) continue;
    const spans = clipped.filter((rect) => rect.u0 < u1 && rect.u1 > u0)
      .map((rect) => [rect.v0, rect.v1] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let length = 0;
    let last = Number.NEGATIVE_INFINITY;
    for (const [start, end] of spans) {
      if (end <= last) continue;
      length += end - Math.max(start, last);
      last = end;
    }
    covered += (u1 - u0) * length;
  }
  return Math.min(
    (target.u1 - target.u0) * (target.v1 - target.v0),
    Math.max(0, covered)
  );
}

const GEOMETRY_PROJECTION_TARGET_LIMIT = 16;
const GEOMETRY_PROJECTION_MAX_PEERS = 128;
const GEOMETRY_PROJECTION_PAIR_BUDGET = 4_096;
const PROJECTION_VIEWS = [
  { id: "front", axes: [0, 1] as const },
  { id: "side", axes: [2, 1] as const },
  { id: "top", axes: [0, 2] as const },
] as const;

/**
 * Parent-local X/Y/Z projected outline contribution, not a rendered image,
 * occlusion test or proof of 3D necessity. It can identify when multiple
 * other Cubes collectively cover a target's projection in all three views.
 */
export function analyzeStaticMarginalProjection(
  cubes: readonly SurfaceEvidenceCube[],
  options: {
    target_cube_ids?: readonly string[];
    exampleLimit?: number;
    pairBudget?: number;
  } = {}
) {
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const pairBudget = options.pairBudget ?? GEOMETRY_PROJECTION_PAIR_BUDGET;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 32 ||
      !Number.isInteger(pairBudget) || pairBudget < 1 ||
      pairBudget > GEOMETRY_PROJECTION_PAIR_BUDGET) {
    throw new Error("Geometry projected contribution budgets are invalid.");
  }
  const selectedIds = options.target_cube_ids
    ? new Set(options.target_cube_ids) : null;
  const ordered = [...cubes].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const targets = ordered.filter((cube) => !selectedIds || selectedIds.has(cube.uuid));
  const byParent = new Map<string, SurfaceEvidenceCube[]>();
  for (const cube of ordered) {
    if (cube.parent_id) {
      const cohort = byParent.get(cube.parent_id) ?? [];
      cohort.push(cube);
      byParent.set(cube.parent_id, cohort);
    }
  }
  const observed: Array<{
    cube_uuid: string;
    cube_name: string;
    parent_id: string;
    projected_added_area: { front: number; side: number; top: number };
    projected_added_ratio: { front: number; side: number; top: number };
    outcome: "NO_ADDITIONAL_PROJECTED_OUTLINE" | "ADDS_PROJECTED_OUTLINE";
  }> = [];
  let checked = 0, unsupported = 0, checkedPairs = 0;
  let zeroOutlineCount = 0, changedOutlineCount = 0;
  let truncated = false;
  const compact = (value: number) => Number(value.toPrecision(8));
  for (const cube of targets) {
    if (checked + unsupported >= GEOMETRY_PROJECTION_TARGET_LIMIT) {
      truncated = true; break;
    }
    const ownBounds = cubeBounds(cube);
    const finiteProjection = ownBounds && PROJECTION_VIEWS.every(({ axes }) =>
      Number.isFinite(
        (ownBounds.max[axes[0]] - ownBounds.min[axes[0]]) *
        (ownBounds.max[axes[1]] - ownBounds.min[axes[1]])
      )
    );
    if (!cube.parent_id || !ownBounds || !finiteProjection ||
        (cube.rotation !== undefined &&
          (!finite3(cube.rotation) || hasRotation(cube, GEOMETRY_SURFACE_EPSILON)))) {
      unsupported += 1; continue;
    }
    const siblings = (byParent.get(cube.parent_id) ?? [])
      .filter((peer) => peer.uuid !== cube.uuid);
    // If any peer has unknown rotation or invalid bounds, a zero-outline
    // conclusion would be incomplete. Do not infer absence from a subset.
    if (siblings.length > GEOMETRY_PROJECTION_MAX_PEERS ||
        siblings.some((peer) => !cubeBounds(peer) ||
          (peer.rotation !== undefined &&
            (!finite3(peer.rotation) || hasRotation(peer, GEOMETRY_SURFACE_EPSILON))))) {
      unsupported += 1; continue;
    }
    if (checkedPairs + siblings.length > pairBudget) {
      truncated = true; break;
    }
    checkedPairs += siblings.length;
    const peerBounds = siblings.map((peer) => cubeBounds(peer)!);
    if (peerBounds.some((bounds) => PROJECTION_VIEWS.some(({ axes }) =>
      !Number.isFinite(
        (bounds.max[axes[0]] - bounds.min[axes[0]]) *
        (bounds.max[axes[1]] - bounds.min[axes[1]])
      )
    ))) {
      unsupported += 1;
      continue;
    }
    const amounts = {} as Record<(typeof PROJECTION_VIEWS)[number]["id"], number>;
    const ratios = {} as Record<(typeof PROJECTION_VIEWS)[number]["id"], number>;
    let contributes = false;
    for (const view of PROJECTION_VIEWS) {
      const rectangle = projectedRect(ownBounds, view.axes);
      const area = (rectangle.u1 - rectangle.u0) *
        (rectangle.v1 - rectangle.v0);
      const covered = coveredProjectedArea(rectangle,
        peerBounds.map((bound) => projectedRect(bound, view.axes)));
      const added = Math.max(0, area - covered);
      const relative = area > 0 ? added / area : 0;
      amounts[view.id] = compact(added);
      ratios[view.id] = compact(relative);
      if (relative > Number.EPSILON * 64) contributes = true;
    }
    checked += 1;
    if (contributes) changedOutlineCount += 1;
    else zeroOutlineCount += 1;
    observed.push({
      cube_uuid: cube.uuid, cube_name: cube.name, parent_id: cube.parent_id,
      projected_added_area: amounts,
      projected_added_ratio: ratios,
      outcome: contributes ? "ADDS_PROJECTED_OUTLINE" :
        "NO_ADDITIONAL_PROJECTED_OUTLINE",
    });
  }
  // Non-contributing projected silhouettes are the actionable review
  // examples; avoid drowning them out under abundant required main masses.
  observed.sort((a, b) =>
    (a.outcome === b.outcome ? 0 :
      a.outcome === "NO_ADDITIONAL_PROJECTED_OUTLINE" ? -1 : 1) ||
    a.cube_uuid.localeCompare(b.cube_uuid)
  );
  const examples = observed.slice(0, exampleLimit);
  return {
    state: truncated || unsupported > 0 ? ("partial" as const) : ("available" as const),
    scope: "parent_local_axis_aligned_projected_union" as const,
    checked_target_count: checked,
    unsupported_target_count: unsupported,
    unvisited_target_count: targets.length - checked - unsupported,
    checked_pair_count: checkedPairs,
    no_new_projected_outline_count: zeroOutlineCount,
    adds_projected_outline_count: changedOutlineCount,
    examples,
    examples_truncated: observed.length > examples.length || truncated,
    note: "Measures exact union of axis-aligned orthographic silhouettes in shared parent-local coordinates, not screenshot pixels or actual visible surfaces. A zero-outline Cube can still be required for volume, alpha, depth, contacts, animation, material or visibility states. No automatic deletion or quality PASS.",
  };
}

const GEOMETRY_MERGE_PAIR_BUDGET = 4_096;
/**
 * Recommends only mathematically rectangular adjacent mass unions.
 * UV, texture, pivot, rig and visibility differences remain mandatory
 * external review: this never performs a native merge.
 */
export function analyzeStaticCubeMergeCandidates(
  cubes: readonly SurfaceEvidenceCube[],
  options: {
    target_cube_ids?: readonly string[];
    exampleLimit?: number;
    pairBudget?: number;
  } = {}
) {
  const exampleLimit = options.exampleLimit ?? GEOMETRY_SURFACE_EXAMPLE_LIMIT;
  const pairBudget = options.pairBudget ?? GEOMETRY_MERGE_PAIR_BUDGET;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 32 ||
      !Number.isInteger(pairBudget) || pairBudget < 1 ||
      pairBudget > GEOMETRY_MERGE_PAIR_BUDGET) {
    throw new Error("Geometry merge candidate budgets are invalid.");
  }
  const ordered = [...cubes].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const selected = options.target_cube_ids
    ? new Set(options.target_cube_ids) : null;
  const targets = ordered.filter((cube) => !selected || selected.has(cube.uuid));
  const eligible = (cube: SurfaceEvidenceCube) =>
    Boolean(cube.parent_id && finite3(cube.origin) &&
      (cube.inflate ?? 0) === 0 &&
      (cube.rotation === undefined ||
        (finite3(cube.rotation) && !hasRotation(cube, GEOMETRY_SURFACE_EPSILON))) &&
      cubeBounds(cube));
  const byParent = new Map<string, SurfaceEvidenceCube[]>();
  for (const cube of ordered.filter(eligible)) {
    const cohort = byParent.get(cube.parent_id!) ?? [];
    cohort.push(cube);
    byParent.set(cube.parent_id!, cohort);
  }
  const seenPairs = new Set<string>();
  const examples: Array<{
    cube_uuids: [string, string];
    axis: "x" | "y" | "z";
    merged_from: [number, number, number];
    merged_to: [number, number, number];
    requirement: "UV_TEXTURE_PIVOT_RIG_REVIEW";
  }> = [];
  let checkedTargets = 0, unsupported = 0;
  let checkedPairs = 0, candidateCount = 0, truncated = false;
  for (const cube of targets) {
    if (checkedTargets + unsupported >= GEOMETRY_PROJECTION_TARGET_LIMIT) {
      truncated = true; break;
    }
    if (!eligible(cube)) {
      unsupported += 1; continue;
    }
    const peers = (byParent.get(cube.parent_id!) ?? []).filter((item) =>
      item.uuid !== cube.uuid);
    if (peers.length > GEOMETRY_PROJECTION_MAX_PEERS ||
        checkedPairs + peers.length > pairBudget) {
      truncated = true; break;
    }
    checkedPairs += peers.length;
    checkedTargets += 1;
    for (const peer of peers) {
      const ids = [cube.uuid, peer.uuid].sort();
      const key = JSON.stringify(ids);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      if (!cube.origin!.every((value, axis) => value === peer.origin![axis])) {
        continue;
      }
      const a = cubeBounds(cube)!;
      const b = cubeBounds(peer)!;
      for (const axis of [0, 1, 2] as const) {
        const others = ([0, 1, 2] as const).filter((index) => index !== axis);
        if (!others.every((index) =>
          a.min[index] === b.min[index] && a.max[index] === b.max[index]
        )) continue;
        if (!(a.max[axis] === b.min[axis] ||
            b.max[axis] === a.min[axis])) continue;
        candidateCount += 1;
        if (examples.length < exampleLimit) {
          examples.push({
            cube_uuids: ids as [string, string],
            axis: (["x", "y", "z"] as const)[axis],
            merged_from: a.min.map((value, i) => Math.min(value, b.min[i]))
              as [number, number, number],
            merged_to: a.max.map((value, i) => Math.max(value, b.max[i]))
              as [number, number, number],
            requirement: "UV_TEXTURE_PIVOT_RIG_REVIEW",
          });
        }
        break;
      }
    }
  }
  return {
    state: truncated || unsupported > 0 ? ("partial" as const) : ("available" as const),
    checked_target_count: checkedTargets,
    unsupported_target_count: unsupported,
    unvisited_target_count: targets.length - checkedTargets - unsupported,
    checked_pair_count: checkedPairs,
    merge_candidate_count: candidateCount,
    examples,
    examples_truncated: candidateCount > examples.length || truncated,
    note: "Exactly face-adjacent, same-parent, same-origin, unrotated and uninflated Cubes can form one rectangular mass. This is geometry-only potential, not permission to merge: preserve UV/texture, independent visibility, pivot, rig and pose before any authored mutation.",
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

  const boundedExamples = Math.min(32, Math.max(1, exampleLimit));
  const containment = analyzeStaticCubeContainment(cubes, {
    exampleLimit: boundedExamples,
  });
  const marginalProjection = analyzeStaticMarginalProjection(cubes, {
    exampleLimit: boundedExamples,
  });
  const mergeCandidates = analyzeStaticCubeMergeCandidates(cubes, {
    exampleLimit: boundedExamples,
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
    rest_pose_marginal_projection_review: marginalProjection,
    rest_pose_merge_candidates: mergeCandidates,
    note: complete
      ? "Same-facing coplanar overlap is a deterministic texture-surface blocker. Positive-volume overlap is structural evidence only, not automatically a texture defect."
      : "Evidence is intentionally partial because rotated/group-transformed/mesh or invalid geometry is outside this bounded axis-aligned scan. Partial evidence must not be promoted to a clean whole-model surface verdict.",
  };
}
