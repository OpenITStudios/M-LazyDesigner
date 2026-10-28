import { boxUvSubunitAxes, validateCubeGeometrySpan } from "./cubeSpan";

export const GEOMETRY_QUALITY_EPSILON = 1e-6;
export const GEOMETRY_QUALITY_EXAMPLE_LIMIT = 6;

export type GeometryCubeQualityInput = {
  uuid: string;
  name: string;
  from: readonly number[];
  to: readonly number[];
  origin?: readonly number[];
  rotation?: readonly number[];
  inflate?: number;
  box_uv?: boolean;
};

export type GeometryGroupQualityInput = {
  uuid: string;
  name: string;
};

type GeometryAxis = "x" | "y" | "z";

type PrecisionExample = {
  cube_uuid: string;
  cube_name: string;
  field: "from" | "to" | "origin" | "rotation" | "inflate";
  axis: GeometryAxis | null;
  current: number;
  suggested: number;
  delta: number;
};

type DegenerateExample = {
  cube_uuid: string;
  cube_name: string;
  size: [number, number, number];
  invalid_axes: GeometryAxis[];
};

type PlaneLikeExample = {
  cube_uuid: string;
  cube_name: string;
  size: [number, number, number];
  zero_axis: GeometryAxis;
};

function bounded<T>(values: readonly T[], limit: number) {
  return {
    examples: values.slice(0, limit),
    examples_truncated: values.length > limit,
  };
}

function precisionSuggestion(value: number, epsilon: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const delta = Math.abs(value - rounded);
  return delta > 0 && delta <= epsilon ? rounded : null;
}

function vectorSize(from: readonly number[], to: readonly number[]): [number, number, number] {
  return [
    Number(to[0]) - Number(from[0]),
    Number(to[1]) - Number(from[1]),
    Number(to[2]) - Number(from[2]),
  ];
}

function spanClass(value: number): "negative" | "zero" | "positive" | "nonfinite" {
  if (!Number.isFinite(value)) return "nonfinite";
  if (value < 0) return "negative";
  if (value === 0) return "zero";
  return "positive";
}

function preservesSpanClass(
  cube: GeometryCubeQualityInput,
  field: "from" | "to",
  axis: number,
  suggested: number
): boolean {
  if (cube.from.length < 3 || cube.to.length < 3) return true;
  const before = Number(cube.to[axis]) - Number(cube.from[axis]);
  const after =
    field === "from"
      ? Number(cube.to[axis]) - suggested
      : suggested - Number(cube.from[axis]);
  return spanClass(before) === spanClass(after);
}

export function analyzeGeometryHygiene(
  cubes: readonly GeometryCubeQualityInput[],
  groups: readonly GeometryGroupQualityInput[],
  options: { epsilon?: number; exampleLimit?: number } = {}
) {
  const epsilon = options.epsilon ?? GEOMETRY_QUALITY_EPSILON;
  const exampleLimit = options.exampleLimit ?? GEOMETRY_QUALITY_EXAMPLE_LIMIT;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new Error("Geometry hygiene epsilon must be finite and positive.");
  }
  if (!Number.isInteger(exampleLimit) || exampleLimit <= 0) {
    throw new Error("Geometry hygiene example limit must be a positive integer.");
  }

  const precisionExamples: PrecisionExample[] = [];
  const precisionCubeIds = new Set<string>();
  const axes = ["x", "y", "z"] as const;

  for (const cube of cubes) {
    const vectors = [
      ["from", cube.from],
      ["to", cube.to],
      ["origin", cube.origin],
      ["rotation", cube.rotation],
    ] as const;

    for (const [field, values] of vectors) {
      if (!values) continue;
      for (let index = 0; index < 3; index += 1) {
        const current = Number(values[index]);
        const suggested = precisionSuggestion(current, epsilon);
        if (suggested === null) continue;
        if (
          (field === "from" || field === "to") &&
          !preservesSpanClass(cube, field, index, suggested)
        ) {
          continue;
        }
        precisionCubeIds.add(cube.uuid);
        precisionExamples.push({
          cube_uuid: cube.uuid,
          cube_name: cube.name,
          field,
          axis: axes[index],
          current,
          suggested,
          delta: suggested - current,
        });
      }
    }

    if (cube.inflate !== undefined) {
      const current = Number(cube.inflate);
      const suggested = precisionSuggestion(current, epsilon);
      if (suggested !== null) {
        precisionCubeIds.add(cube.uuid);
        precisionExamples.push({
          cube_uuid: cube.uuid,
          cube_name: cube.name,
          field: "inflate",
          axis: null,
          current,
          suggested,
          delta: suggested - current,
        });
      }
    }
  }

  const degenerateExamples: DegenerateExample[] = [];
  const planeLikeExamples: PlaneLikeExample[] = [];
  const subunitBoxUvExamples: Array<{
    cube_uuid: string;
    cube_name: string;
    size: [number, number, number];
    axes: GeometryAxis[];
  }> = [];
  for (const cube of cubes) {
    if (cube.from.length < 3 || cube.to.length < 3) continue;
    const size = vectorSize(cube.from, cube.to);
    const invalidAxes = axes.filter(
      (_, index) => !Number.isFinite(size[index]) || size[index] < 0
    );
    const zeroAxes = axes.filter((_, index) => size[index] === 0);

    if (invalidAxes.length > 0 || zeroAxes.length >= 2) {
      degenerateExamples.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        size,
        invalid_axes: [
          ...new Set([
            ...invalidAxes,
            ...(zeroAxes.length >= 2 ? zeroAxes : []),
          ]),
        ],
      });
      continue;
    }

    if (cube.box_uv === true) {
      const riskyAxes = boxUvSubunitAxes(cube.from, cube.to);
      if (riskyAxes.length > 0) {
        subunitBoxUvExamples.push({
          cube_uuid: cube.uuid,
          cube_name: cube.name,
          size,
          axes: riskyAxes,
        });
      }
    }
    if (zeroAxes.length === 1) {
      planeLikeExamples.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        size,
        zero_axis: zeroAxes[0],
      });
    }
  }

  const groupsByName = new Map<string, GeometryGroupQualityInput[]>();
  for (const group of groups) {
    const entries = groupsByName.get(group.name) ?? [];
    entries.push(group);
    groupsByName.set(group.name, entries);
  }
  const duplicateNames = [...groupsByName.entries()]
    .filter(([, entries]) => entries.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entries]) => ({
      name,
      count: entries.length,
      groups: entries
        .slice()
        .sort((left, right) => left.uuid.localeCompare(right.uuid))
        .slice(0, exampleLimit)
        .map((group) => ({ uuid: group.uuid, name: group.name })),
      groups_truncated: entries.length > exampleLimit,
    }));
  const duplicateGroupCount = duplicateNames.reduce(
    (count, entry) => count + entry.count,
    0
  );

  const precisionBounded = bounded(precisionExamples, exampleLimit);
  const degenerateBounded = bounded(degenerateExamples, exampleLimit);
  const planeLikeBounded = bounded(planeLikeExamples, exampleLimit);
  const subunitBoxUvBounded = bounded(subunitBoxUvExamples, exampleLimit);
  const duplicateBounded = bounded(duplicateNames, exampleLimit);
  const reviewRequired =
    precisionExamples.length > 0 ||
    degenerateExamples.length > 0 ||
    subunitBoxUvExamples.length > 0 ||
    duplicateNames.length > 0;

  return {
    state: reviewRequired ? ("review_required" as const) : ("clean" as const),
    precision: {
      epsilon,
      drift_count: precisionExamples.length,
      affected_cube_count: precisionCubeIds.size,
      ...precisionBounded,
    },
    plane_like_cubes: {
      count: planeLikeExamples.length,
      ...planeLikeBounded,
    },
    degenerate_cubes: {
      count: degenerateExamples.length,
      ...degenerateBounded,
    },
    box_uv_subunit: {
      count: subunitBoxUvExamples.length,
      ...subunitBoxUvBounded,
      note: "Positive Cube axes under one model unit are under-resolved by native Box UV. Plane-like zero axes and per-face UV are not classified. This is a UV representation risk, not proof that small 3D geometry is visually unnecessary.",
    },
    duplicate_bone_names: {
      name_count: duplicateNames.length,
      group_count: duplicateGroupCount,
      ...duplicateBounded,
    },
  };
}


/**
 * Measures potential simplification shape and surface mapping changes without
 * touching Blockbench state. The corner movement bound is conservative and
 * independent of Euler order: each component rotation moves a point within
 * 2*r*sin(delta/2) and the triangle inequality composes rotations.
 *
 * Bounds are parent-local, NOT world-space or animation/visual acceptance.
 */
export type CubeSimplificationFidelityInput = {
  cube: GeometryCubeQualityInput & {
    /** When absent, an unverified face inventory is NOT an untextured Cube. */
    uv_faces?: readonly {
      face: "north" | "south" | "east" | "west" | "up" | "down";
      texture?: unknown;
      enabled?: boolean;
    }[];
  };
  update: {
    id: string;
    from?: readonly number[];
    to?: readonly number[];
    rotation?: readonly number[];
  };
};

function simplifyFiniteTriple(
  values: readonly number[] | undefined,
  context: string
): [number, number, number] {
  if (!Array.isArray(values) || values.length !== 3 ||
      !values.every(Number.isFinite)) {
    throw new Error(
      "SIMPLIFY_FIDELITY_INVALID_VECTOR: " + context + " must contain three finite numbers."
    );
  }
  return [values[0], values[1], values[2]];
}

function simplifyFiniteMetric(value: number, description: string): number {
  if (!Number.isFinite(value)) {
    throw new Error("SIMPLIFY_FIDELITY_NONFINITE: " + description);
  }
  return Object.is(value, -0) ? 0 : value;
}

export function analyzeCubeSimplificationFidelity(
  changes: readonly CubeSimplificationFidelityInput[]
) {
  if (!Array.isArray(changes) || changes.length > 32) {
    throw new Error("SIMPLIFY_FIDELITY_BUDGET: at most 32 Cube changes per review.");
  }
  const seen = new Set<string>();
  const perCube = changes.map(({ cube, update }) => {
    if (!cube || !update || typeof cube.uuid !== "string" ||
        !cube.uuid || cube.uuid !== update.id || seen.has(cube.uuid)) {
      throw new Error("SIMPLIFY_FIDELITY_IDENTITY: unique exact Cube UUID required.");
    }
    seen.add(cube.uuid);
    const from = simplifyFiniteTriple(cube.from, cube.uuid + " from");
    const to = simplifyFiniteTriple(cube.to, cube.uuid + " to");
    const nextFrom = simplifyFiniteTriple(update.from ?? from, cube.uuid + " new from");
    const nextTo = simplifyFiniteTriple(update.to ?? to, cube.uuid + " new to");
    const rotation = simplifyFiniteTriple(cube.rotation ?? [0,0,0], cube.uuid + " rotation");
    const nextRotation = simplifyFiniteTriple(update.rotation ?? rotation, cube.uuid + " new rotation");
    const inflate = cube.inflate ?? 0;
    validateCubeGeometrySpan(from, to, inflate, "Simplify source " + cube.uuid);
    validateCubeGeometrySpan(nextFrom, nextTo, inflate, "Simplify result " + cube.uuid);

    const beforeSize = to.map((n,i) => n - from[i]) as [number,number,number];
    const afterSize = nextTo.map((n,i) => n - nextFrom[i]) as [number,number,number];
    const extentChanged = beforeSize.some((n,i) => n !== afterSize[i]);
    let worstExtentRatio = 1;
    for (let axis = 0; axis < 3; axis++) {
      const before = beforeSize[axis], after = afterSize[axis];
      if ((before === 0) !== (after === 0)) {
        throw new Error("SIMPLIFY_FIDELITY_SPAN_CLASS_CHANGED: plane-to-volume change is not implicit simplification.");
      }
      if (before === 0) continue;
      worstExtentRatio = simplifyFiniteMetric(
        Math.max(worstExtentRatio, before / after, after / before),
        "Cube physical surface extent scale"
      );
    }

    // Corresponding inflated cuboid corners move by at most the norm of
    // their greatest per-axis endpoint differences before new rotation.
    const boundChange = simplifyFiniteMetric(Math.hypot(...[0,1,2].map(axis =>
      Math.max(
        Math.abs(nextFrom[axis] - from[axis]),
        Math.abs(nextTo[axis] - to[axis])
      )
    )), "Cube bounds displacement");
    const angles = [0,1,2].map(axis => {
      const mod = Math.abs(nextRotation[axis] - rotation[axis]) % 360;
      return Math.min(mod, 360 - mod);
    });
    let angularBound = 0;
    if (angles.some(d => d !== 0)) {
      const pivot = simplifyFiniteTriple(cube.origin, cube.uuid + " pivot");
      const radius = simplifyFiniteMetric(Math.hypot(...[0,1,2].map(axis =>
        Math.max(
          Math.abs(nextFrom[axis] - inflate - pivot[axis]),
          Math.abs(nextTo[axis] + inflate - pivot[axis])
        )
      )), "Cube maximum corner-to-pivot radius");
      angularBound = simplifyFiniteMetric(
        angles.reduce((total,angle) =>
          total + 2 * radius * Math.sin(angle * Math.PI / 360), 0
        ), "rotated Cube corner displacement"
      );
    }
    const driftBound = simplifyFiniteMetric(
      boundChange + angularBound, "parent-local corner drift upper bound"
    );
    // Only the two physical axes of each textured, enabled Cube face
    // determine whether its fixed UV rectangle will stretch. A Z-only
    // thickness edit does not change a textured north/south X-Y face.
    const faceAxes = {
      north: [0, 1], south: [0, 1],
      east: [2, 1], west: [2, 1],
      up: [0, 2], down: [0, 2],
    } as const;
    const faceInventory = cube.uv_faces;
    const faceIds = Array.isArray(faceInventory)
      ? faceInventory.map((face) => face?.face) : [];
    const inventoryComplete = Array.isArray(faceInventory) &&
      faceInventory.length === 6 &&
      faceIds.every((id) => typeof id === "string" && id in faceAxes) &&
      new Set(faceIds).size === 6;
    const mappedFaces = inventoryComplete
      ? faceInventory!.filter((face) =>
          face.enabled !== false &&
          face.texture !== false && face.texture !== null &&
          face.texture !== undefined
        )
      : [];
    const mappedFaceCount = inventoryComplete ? mappedFaces.length : null;
    const textureStretchRisk = mappedFaces.some((face) =>
      faceAxes[face.face].some((axis) => {
        if (beforeSize[axis] === afterSize[axis]) return false;
        // Zero spans remain zero by the topology guard above. Changing a
        // positive physical extent changes texel scale on this face.
        const before = beforeSize[axis], after = afterSize[axis];
        return before > 0 && after > 0 &&
          Math.max(before / after, after / before) >
          1 + GEOMETRY_QUALITY_EPSILON;
      })
    );

    return {
      cube_uuid: cube.uuid,
      cube_name: cube.name,
      parent_local_corner_drift_upper_bound: driftBound,
      parent_local_bounds_movement_upper_bound: boundChange,
      parent_local_rotation_movement_upper_bound: angularBound,
      projected_outline_drift_upper_bound: driftBound,
      before_size_xyz: beforeSize,
      after_size_xyz: afterSize,
      max_physical_extent_scale_ratio: worstExtentRatio,
      mapped_face_count: mappedFaceCount,
      face_inventory_complete: inventoryComplete,
      mapped_texture_stretch_risk: textureStretchRisk,
      box_uv_template_review_required: cube.box_uv === true && extentChanged,
      pivot_field_preserved: true as const,
      uv_coordinate_fields_preserved: true as const,
    };
  });
  return {
    state: perCube.length ? ("geometry_change_requires_review" as const) : ("no_change" as const),
    coordinate_scope: "parent_local_conservative_upper_bound" as const,
    visual_verdict: "not_evaluated" as const,
    animation_pose_sweep: "not_evaluated" as const,
    cube_count: perCube.length,
    max_corner_drift_upper_bound: perCube.reduce((v,c) =>
      Math.max(v,c.parent_local_corner_drift_upper_bound),0),
    max_physical_extent_scale_ratio: perCube.reduce((v,c) =>
      Math.max(v,c.max_physical_extent_scale_ratio),1),
    mapped_texture_stretch_risk_count: perCube.filter(c =>
      c.mapped_texture_stretch_risk).length,
    incomplete_face_inventory_count: perCube.filter(c =>
      !c.face_inventory_complete).length,
    box_uv_template_review_count: perCube.filter(c =>
      c.box_uv_template_review_required).length,
    per_cube: perCube,
    note:
      "Conservative parent-local geometry bound only, not world-space or " +
      "pose-swept silhouette PASS. Unchanged pivot/UV fields do not prove " +
      "painted artwork, texture density or reference shape fidelity. " +
      "Recheck Box-UV templates after size changes.",
  };
}
