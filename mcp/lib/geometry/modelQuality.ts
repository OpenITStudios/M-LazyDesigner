export type QualityVec3 = [number, number, number];

export type QualityBounds = {
  min: QualityVec3;
  max: QualityVec3;
};

export type ProjectedEnvelopeView = "front" | "side" | "top";

const METRIC_PRECISION = 4;
const PIVOT_COINCIDENT_EPSILON = 1e-6;
const DEFAULT_EXAMPLE_LIMIT = 6;
const VIEW_ORDER: readonly ProjectedEnvelopeView[] = ["front", "side", "top"];

function roundMetric(value: number): number {
  return Number(value.toFixed(METRIC_PRECISION));
}

function finiteVec3(value: readonly number[]): QualityVec3 | null {
  if (value.length < 3 || !value.slice(0, 3).every(Number.isFinite)) return null;
  return [value[0], value[1], value[2]];
}

function normalizeBounds(
  value: { min: readonly number[]; max: readonly number[] } | null | undefined
): QualityBounds | null {
  if (!value) return null;
  const min = finiteVec3(value.min);
  const max = finiteVec3(value.max);
  if (!min || !max) return null;
  if (max.some((entry, axis) => entry <= min[axis])) return null;
  return { min, max };
}

function rectForView(bounds: QualityBounds, view: ProjectedEnvelopeView) {
  const axes: [number, number] =
    view === "front" ? [0, 1] : view === "side" ? [2, 1] : [0, 2];
  const [u, v] = axes;
  return {
    axes,
    min: [bounds.min[u], bounds.min[v]] as [number, number],
    max: [bounds.max[u], bounds.max[v]] as [number, number],
  };
}

function rectangleMetrics(
  model: ReturnType<typeof rectForView>,
  reference: ReturnType<typeof rectForView>
) {
  const modelWidth = model.max[0] - model.min[0];
  const modelHeight = model.max[1] - model.min[1];
  const referenceWidth = reference.max[0] - reference.min[0];
  const referenceHeight = reference.max[1] - reference.min[1];
  const modelArea = modelWidth * modelHeight;
  const referenceArea = referenceWidth * referenceHeight;
  const overlapWidth = Math.max(
    0,
    Math.min(model.max[0], reference.max[0]) -
      Math.max(model.min[0], reference.min[0])
  );
  const overlapHeight = Math.max(
    0,
    Math.min(model.max[1], reference.max[1]) -
      Math.max(model.min[1], reference.min[1])
  );
  const intersection = overlapWidth * overlapHeight;
  const union = modelArea + referenceArea - intersection;
  const modelCenter: [number, number] = [
    (model.min[0] + model.max[0]) / 2,
    (model.min[1] + model.max[1]) / 2,
  ];
  const referenceCenter: [number, number] = [
    (reference.min[0] + reference.max[0]) / 2,
    (reference.min[1] + reference.max[1]) / 2,
  ];

  return {
    iou: roundMetric(union > 0 ? intersection / union : 0),
    source_coverage: roundMetric(
      referenceArea > 0 ? intersection / referenceArea : 0
    ),
    model_precision: roundMetric(modelArea > 0 ? intersection / modelArea : 0),
    model_size: [roundMetric(modelWidth), roundMetric(modelHeight)] as [
      number,
      number,
    ],
    reference_size: [
      roundMetric(referenceWidth),
      roundMetric(referenceHeight),
    ] as [number, number],
    center_delta: [
      roundMetric(modelCenter[0] - referenceCenter[0]),
      roundMetric(modelCenter[1] - referenceCenter[1]),
    ] as [number, number],
  };
}

function volumeMetrics(model: QualityBounds, reference: QualityBounds) {
  const modelSize: QualityVec3 = [
    model.max[0] - model.min[0],
    model.max[1] - model.min[1],
    model.max[2] - model.min[2],
  ];
  const referenceSize: QualityVec3 = [
    reference.max[0] - reference.min[0],
    reference.max[1] - reference.min[1],
    reference.max[2] - reference.min[2],
  ];
  const overlap: QualityVec3 = [0, 1, 2].map((axis) =>
    Math.max(
      0,
      Math.min(model.max[axis], reference.max[axis]) -
        Math.max(model.min[axis], reference.min[axis])
    )
  ) as QualityVec3;
  const modelVolume = modelSize[0] * modelSize[1] * modelSize[2];
  const referenceVolume = referenceSize[0] * referenceSize[1] * referenceSize[2];
  const intersection = overlap[0] * overlap[1] * overlap[2];
  const union = modelVolume + referenceVolume - intersection;
  const modelCenter: QualityVec3 = [
    (model.min[0] + model.max[0]) / 2,
    (model.min[1] + model.max[1]) / 2,
    (model.min[2] + model.max[2]) / 2,
  ];
  const referenceCenter: QualityVec3 = [
    (reference.min[0] + reference.max[0]) / 2,
    (reference.min[1] + reference.max[1]) / 2,
    (reference.min[2] + reference.max[2]) / 2,
  ];

  return {
    iou: roundMetric(union > 0 ? intersection / union : 0),
    source_coverage: roundMetric(
      referenceVolume > 0 ? intersection / referenceVolume : 0
    ),
    model_precision: roundMetric(modelVolume > 0 ? intersection / modelVolume : 0),
    center_delta: modelCenter.map((value, axis) =>
      roundMetric(value - referenceCenter[axis])
    ) as QualityVec3,
    dimension_ratio: {
      width: roundMetric(modelSize[0] / referenceSize[0]),
      height: roundMetric(modelSize[1] / referenceSize[1]),
      length: roundMetric(modelSize[2] / referenceSize[2]),
    },
  };
}

/**
 * Cheap coarse fidelity metric inspired by multi-view silhouette comparison.
 * It compares axis-aligned projected envelopes only; it deliberately does not
 * claim silhouette or visual fidelity.
 */
export function analyzeProjectedEnvelopeFidelity(input: {
  model_bounds: { min: readonly number[]; max: readonly number[] } | null | undefined;
  reference_bounds: { min: readonly number[]; max: readonly number[] } | null | undefined;
}) {
  const model = normalizeBounds(input.model_bounds);
  if (!model) {
    return {
      state: "unavailable" as const,
      reason: "model_bounds_unavailable_or_non_positive" as const,
    };
  }
  const reference = normalizeBounds(input.reference_bounds);
  if (!reference) {
    return {
      state: "unavailable" as const,
      reason: "reference_bounds_unavailable_or_non_positive" as const,
    };
  }

  const views = {
    front: {
      axes: ["x", "y"] as const,
      ...rectangleMetrics(rectForView(model, "front"), rectForView(reference, "front")),
    },
    side: {
      axes: ["z", "y"] as const,
      ...rectangleMetrics(rectForView(model, "side"), rectForView(reference, "side")),
    },
    top: {
      axes: ["x", "z"] as const,
      ...rectangleMetrics(rectForView(model, "top"), rectForView(reference, "top")),
    },
  };

  const reviewOrder = [...VIEW_ORDER].sort(
    (left, right) =>
      views[left].iou - views[right].iou ||
      VIEW_ORDER.indexOf(left) - VIEW_ORDER.indexOf(right)
  );
  const averageIou =
    VIEW_ORDER.reduce((sum, view) => sum + views[view].iou, 0) /
    VIEW_ORDER.length;

  return {
    state: "available" as const,
    metric_basis: "axis_aligned_projected_envelopes" as const,
    silhouette_fidelity: false as const,
    visual_verdict: "not_evaluated" as const,
    views,
    average_iou: roundMetric(averageIou),
    worst_view: reviewOrder[0],
    review_order: reviewOrder,
    volume_envelope: volumeMetrics(model, reference),
    note:
      "Coarse envelope alignment only. Use fresh canonical model views/reference comparison for visual fidelity; raw 3D reference bounds must not redefine target dimensions.",
  };
}

export type RigGroupInput = {
  uuid: string;
  name: string;
  origin: readonly number[];
  parent_uuid?: string | null;
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distance(first: QualityVec3, second: QualityVec3): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2]
  );
}


type RigMirrorSide = "left" | "right";

/** Explicit name conventions are advisory evidence, never a symmetry requirement. */
function namedRigSide(name: string): { side: RigMirrorSide; key: string } | null {
  const prefix = /^(left|right|l|r)[\s._-]+(.+)$/i.exec(name);
  const suffix = /^(.+?)[\s._-]+(left|right|l|r)$/i.exec(name);
  const camel = /^(Left|Right)([A-Z].*)$/.exec(name);
  const sideToken = prefix?.[1] ?? camel?.[1] ?? suffix?.[2];
  const partName = prefix?.[2] ?? camel?.[2] ?? suffix?.[1];
  if (!sideToken || !partName) return null;
  const key = partName.replace(/[\s._-]+/g, "").toLowerCase();
  if (!key) return null;
  return { side: /^(left|l)$/i.test(sideToken) ? "left" : "right", key };
}

function namedMirrorPivotEvidence(groups: readonly RigGroupInput[], exampleLimit: number) {
  const named = new Map<string, { left: RigGroupInput[]; right: RigGroupInput[] }>();
  for (const group of groups) {
    const parsed = namedRigSide(group.name);
    if (!parsed || !finiteVec3(group.origin)) continue;
    const bucket: { left: RigGroupInput[]; right: RigGroupInput[] } =
      named.get(parsed.key) ?? { left: [], right: [] };
    bucket[parsed.side].push(group);
    named.set(parsed.key, bucket);
  }
  const pairs: Array<{
    key: string;
    left: RigGroupInput;
    right: RigGroupInput;
    local_plane_x: number;
    height_delta: number;
    depth_delta: number;
    lateral_separation: number;
  }> = [];
  let ambiguousPairNames = 0;
  for (const [key, sides] of [...named].sort(([a], [b]) => a.localeCompare(b))) {
    if (sides.left.length === 0 || sides.right.length === 0) continue;
    if (sides.left.length !== 1 || sides.right.length !== 1) {
      ambiguousPairNames += 1;
      continue;
    }
    const left = sides.left[0]!;
    const right = sides.right[0]!;
    const a = finiteVec3(left.origin);
    const b = finiteVec3(right.origin);
    if (!a || !b) continue;
    const localPlane = a[0] / 2 + b[0] / 2;
    const heightDelta = Math.abs(a[1] - b[1]);
    const depthDelta = Math.abs(a[2] - b[2]);
    const lateralSeparation = Math.abs(a[0] - b[0]);
    if (![localPlane, heightDelta, depthDelta, lateralSeparation].every(Number.isFinite)) continue;
    pairs.push({
      key, left, right, local_plane_x: localPlane,
      height_delta: heightDelta, depth_delta: depthDelta,
      lateral_separation: lateralSeparation,
    });
  }
  // Two or more named counterparts are needed even to estimate a shared
  // coordinate plane. The estimate is not a user-approved symmetry constraint.
  const cohortPlane = pairs.length >= 2 ? median(pairs.map((pair) => pair.local_plane_x)) : null;
  return {
    pair_count: pairs.length,
    ambiguous_name_pair_count: ambiguousPairNames,
    cohort_mirror_plane_x: cohortPlane === null ? null : roundMetric(cohortPlane),
    max_cohort_plane_deviation: cohortPlane === null ? null : roundMetric(
      Math.max(...pairs.map((pair) => Math.abs(pair.local_plane_x - cohortPlane)))
    ),
    examples: pairs.slice(0, exampleLimit).map((pair) => ({
      part_key: pair.key,
      left_uuid: pair.left.uuid, right_uuid: pair.right.uuid,
      left_name: pair.left.name, right_name: pair.right.name,
      local_mirror_plane_x: roundMetric(pair.local_plane_x),
      pivot_height_delta: roundMetric(pair.height_delta),
      pivot_depth_delta: roundMetric(pair.depth_delta),
      lateral_separation: roundMetric(pair.lateral_separation),
      cohort_plane_deviation: cohortPlane === null ? null
        : roundMetric(Math.abs(pair.local_plane_x - cohortPlane)),
    })),
    examples_truncated: pairs.length > exampleLimit,
    note: "Side-name pairing is advisory pivot evidence. Asymmetry may be intentional; the cohort X-plane estimate is not an approved symmetry plane, an authored correction, or a visual verdict.",
  };
}

export function analyzeRigGraph(
  groups: readonly RigGroupInput[],
  exampleLimit = DEFAULT_EXAMPLE_LIMIT
) {
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1) {
    throw new Error("Rig graph example limit must be a positive integer.");
  }
  if (groups.length === 0) {
    return {
      state: "empty" as const,
      group_count: 0,
      root_count: 0,
      leaf_count: 0,
      max_depth: 0,
      review_hints: [] as string[],
    };
  }

  const byUuid = new Map<string, RigGroupInput>();
  const duplicateUuids = new Set<string>();
  for (const group of groups) {
    if (byUuid.has(group.uuid)) duplicateUuids.add(group.uuid);
    else byUuid.set(group.uuid, group);
  }

  const invalidOrigins = groups.filter((group) => !finiteVec3(group.origin));
  const unresolvedParents = groups.filter(
    (group) => group.parent_uuid && !byUuid.has(group.parent_uuid)
  );
  const roots = groups.filter((group) => !group.parent_uuid);
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parent_uuid || !byUuid.has(group.parent_uuid)) continue;
    const list = children.get(group.parent_uuid) ?? [];
    list.push(group.uuid);
    children.set(group.parent_uuid, list);
  }

  const depthMemo = new Map<string, number>();
  const cycleUuids = new Set<string>();
  const depthOf = (uuid: string, path: Set<string>): number => {
    const cached = depthMemo.get(uuid);
    if (cached !== undefined) return cached;
    if (path.has(uuid)) {
      path.forEach((member) => cycleUuids.add(member));
      cycleUuids.add(uuid);
      return 0;
    }
    const group = byUuid.get(uuid);
    if (!group || !group.parent_uuid || !byUuid.has(group.parent_uuid)) {
      depthMemo.set(uuid, 0);
      return 0;
    }
    const nextPath = new Set(path);
    nextPath.add(uuid);
    const depth = depthOf(group.parent_uuid, nextPath) + 1;
    depthMemo.set(uuid, depth);
    return depth;
  };

  let maxDepth = 0;
  for (const group of groups) {
    maxDepth = Math.max(maxDepth, depthOf(group.uuid, new Set()));
  }

  const pivotDistances: number[] = [];
  const coincidentExamples: Array<{
    parent_uuid: string;
    parent_name: string;
    child_uuid: string;
    child_name: string;
    distance: number;
  }> = [];
  let coincidentCount = 0;
  for (const group of groups) {
    if (!group.parent_uuid) continue;
    const parent = byUuid.get(group.parent_uuid);
    const childOrigin = finiteVec3(group.origin);
    const parentOrigin = parent ? finiteVec3(parent.origin) : null;
    if (!parent || !childOrigin || !parentOrigin) continue;
    const measured = distance(parentOrigin, childOrigin);
    pivotDistances.push(measured);
    if (measured <= PIVOT_COINCIDENT_EPSILON) {
      coincidentCount += 1;
      if (coincidentExamples.length < exampleLimit) {
        coincidentExamples.push({
          parent_uuid: parent.uuid,
          parent_name: parent.name,
          child_uuid: group.uuid,
          child_name: group.name,
          distance: roundMetric(measured),
        });
      }
    }
  }

  const critical =
    duplicateUuids.size > 0 ||
    invalidOrigins.length > 0 ||
    unresolvedParents.length > 0 ||
    cycleUuids.size > 0;
  const reviewHints: string[] = [];
  if (roots.length > 1) reviewHints.push("MULTIPLE_ROOT_GROUPS");
  if (coincidentCount > 0) reviewHints.push("COINCIDENT_PARENT_CHILD_PIVOT");

  const mirrorEvidence = critical ? null : namedMirrorPivotEvidence(groups, exampleLimit);
  const pivotMedian = median(pivotDistances);
  const pivotMean =
    pivotDistances.length > 0
      ? pivotDistances.reduce((sum, value) => sum + value, 0) /
        pivotDistances.length
      : null;

  return {
    state: critical ? ("invalid_graph" as const) : ("valid_graph" as const),
    group_count: groups.length,
    root_count: roots.length,
    leaf_count: groups.filter((group) => (children.get(group.uuid)?.length ?? 0) === 0)
      .length,
    branch_group_count: groups.filter((group) => (children.get(group.uuid)?.length ?? 0) > 1)
      .length,
    max_depth: maxDepth,
    roots: roots.slice(0, exampleLimit).map((group) => ({
      uuid: group.uuid,
      name: group.name,
    })),
    roots_truncated: roots.length > exampleLimit,
    invalid_origin_count: invalidOrigins.length,
    unresolved_parent_count: unresolvedParents.length,
    duplicate_uuid_count: duplicateUuids.size,
    cycle_group_count: cycleUuids.size,
    pivot_edges: {
      measured_count: pivotDistances.length,
      min: pivotDistances.length > 0 ? roundMetric(Math.min(...pivotDistances)) : null,
      median: pivotMedian === null ? null : roundMetric(pivotMedian),
      mean: pivotMean === null ? null : roundMetric(pivotMean),
      max: pivotDistances.length > 0 ? roundMetric(Math.max(...pivotDistances)) : null,
      coincident_count: coincidentCount,
      coincident_examples: coincidentExamples,
      examples_truncated: coincidentCount > coincidentExamples.length,
    },
    ...(mirrorEvidence && mirrorEvidence.pair_count > 0 ? { mirrored_pivot_candidates: mirrorEvidence } : {}),
    review_hints: reviewHints,
  };
}

export function summarizeSurfaceQualityWarnings(warnings: readonly string[]) {
  const counts = {
    z_fighting: 0,
    micro_gap: 0,
    coplanar_edge_gap: 0,
    shallow_penetration: 0,
  };
  let scanLimited = false;
  let diagnosticsUnavailable = 0;
  let additionalWarningsOmitted = 0;

  for (const warning of warnings) {
    if (warning.startsWith("Possible z-fighting:")) counts.z_fighting += 1;
    else if (warning.startsWith("Possible micro-gap:")) counts.micro_gap += 1;
    else if (warning.startsWith("Possible coplanar edge-gap:")) {
      counts.coplanar_edge_gap += 1;
    } else if (warning.startsWith("Possible shallow penetration:")) {
      counts.shallow_penetration += 1;
    } else if (warning.startsWith("Surface-quality diagnostics stopped after")) {
      scanLimited = true;
    } else if (
      warning.startsWith("Surface-quality diagnostics unavailable") ||
      warning.startsWith("Surface-quality pair diagnostics unavailable")
    ) {
      diagnosticsUnavailable += 1;
    } else {
      const omitted = warning.match(/^(\d+) additional surface-quality warning\(s\) were omitted/);
      if (omitted) additionalWarningsOmitted += Number(omitted[1]);
    }
  }

  const categorizedRiskCount =
    counts.z_fighting +
    counts.micro_gap +
    counts.coplanar_edge_gap +
    counts.shallow_penetration;
  const hasKnownRisk = categorizedRiskCount > 0 || additionalWarningsOmitted > 0;
  const scanComplete = !scanLimited && diagnosticsUnavailable === 0;
  const detailsComplete = additionalWarningsOmitted === 0;

  return {
    state: hasKnownRisk
      ? ("review_required" as const)
      : scanComplete
        ? ("no_bounded_risk_reported" as const)
        : ("incomplete" as const),
    visual_verdict: "not_evaluated" as const,
    counts,
    categorized_risk_count: categorizedRiskCount,
    additional_warnings_omitted: additionalWarningsOmitted,
    diagnostics_unavailable_count: diagnosticsUnavailable,
    scan_complete: scanComplete,
    details_complete: detailsComplete,
    note:
      "Bounded geometric review hints only; absence of reported risk is not visual PASS.",
  };
}
