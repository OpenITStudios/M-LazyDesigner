import { boxUvSubunitAxes } from "./cubeSpan";

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
