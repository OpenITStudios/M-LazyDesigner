import type {
  RecipeConstraint,
  RecipeCubePrototype,
  RecipeInstance,
  RecipePattern,
  RecipeVec3,
} from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
import {
  geometryMathProgramSchema,
  type GeometryMathPart,
  type GeometryMathVersion,
} from "./geometryMathLanguage";
import { MATH_PROGRAM_MAX_CUBOIDS,
  type MathCuboid } from "./geometryMathVoxel";
import { extrudeMathProfile } from "./geometryMathProfile";
import { sweepMathVolume } from "./geometryMathSweep";
import { revolveMathProfile } from "./geometryMathRevolve";
import { solveRecipeConstraints } from "./constraints";

/**
 * Bridges a declarative Geometry Construction Language v1 program into the
 * EXISTING Recipe v1 Cube prototypes and patterns. It owns no independent
 * state, native editor operation, MCP capability or history.
 */
type ProgramFeature = Extract<AdvancedGeometryFeature, { kind: "program" }>;
type Pieces = {
  prototypes: RecipeCubePrototype[];
  patterns: RecipePattern[];
};
type BoxFactory = (
  id: string, name: string, featureId: string,
  from: RecipeVec3, to: RecipeVec3
) => Pieces;

type LocalPart = {
  id: string;
  at: RecipeVec3;
  boxes: MathCuboid[];
  min: RecipeVec3;
  max: RecipeVec3;
};

function realizePart(
  part: GeometryMathPart, version: GeometryMathVersion
): MathCuboid[] {
  if (part.method === "BOX") {
    const half = part.size.map(value => value / 2) as RecipeVec3;
    return [{
      id: "box",
      from: half.map(value => -value) as RecipeVec3,
      to: half,
    }];
  }
  if (part.method === "EXTRUDE") return extrudeMathProfile(part, version);
  if (part.method === "SWEEP") return sweepMathVolume(part, version);
  if (part.method === "REVOLVE") return revolveMathProfile(part, version);
  // The union exhausts its known methods. Never silently choose a fallback.
  throw new Error("GEOMETRY_MATH_UNSUPPORTED_METHOD");
}

function minMax(boxes: readonly MathCuboid[]): {
  min: RecipeVec3; max: RecipeVec3;
} {
  if (!boxes.length) throw new Error("GEOMETRY_MATH_EMPTY_PART");
  const min: RecipeVec3 = [0, 1, 2].map(axis =>
    Math.min(...boxes.map(box => box.from[axis]!))
  ) as RecipeVec3;
  const max: RecipeVec3 = [0, 1, 2].map(axis =>
    Math.max(...boxes.map(box => box.to[axis]!))
  ) as RecipeVec3;
  if (min.some((value, i) => !Number.isFinite(value) ||
    !Number.isFinite(max[i]) || max[i]! - value < 1)) {
    throw new Error("GEOMETRY_MATH_PART_BOUNDS_INVALID");
  }
  return { min, max };
}

function compareSourceIds(
  left: string, right: string, version: GeometryMathVersion
): number {
  // Locale-dependent collation can reorder Recipe patterns and therefore
  // compiled placement/transaction fingerprints on other machines.
  // V1/V2 retain their historical order; v3 uses stable codepoint order.
  return version === 3
    ? (left < right ? -1 : left > right ? 1 : 0)
    : left.localeCompare(right);
}

function canonicalConstraints(
  anchors: NonNullable<ProgramFeature["program"]["anchors"]>,
  version: GeometryMathVersion
): RecipeConstraint[] {
  return [...anchors]
    .sort((left, right) => compareSourceIds(left.id, right.id, version))
    .map(anchor => ({
    kind: "ANCHOR",
    id: anchor.id,
    source_instance_id: anchor.source_part_id,
    target_instance_id: anchor.target_part_id,
    axes: [...anchor.axes],
    source_anchor: [...anchor.source_anchor],
    target_anchor: [...anchor.target_anchor],
    ...(anchor.offset ? { offset: [...anchor.offset] as RecipeVec3 } : {}),
  }));
}

export function buildGeometryMathProgramPieces(
  feature: ProgramFeature, makeBox: BoxFactory
): Pieces {
  // Re-validate at the builder boundary as callers may be internal. Reusing
  // this single strict schema also validates persisted source on inspection.
  const program = geometryMathProgramSchema.parse(feature.program);
  const parts: LocalPart[] = [...program.parts]
    .sort((left, right) => compareSourceIds(
      left.id, right.id, program.version
    ))
    .map(part => {
      const boxes = realizePart(part, program.version);
      const { min, max } = minMax(boxes);
      return {
        id: part.id,
        at: [...part.at] as RecipeVec3,
        boxes, min, max,
      };
    });

  const count = parts.reduce((sum, part) => sum + part.boxes.length, 0);
  if (count < 1 || count > MATH_PROGRAM_MAX_CUBOIDS) {
    throw new Error(
      "GEOMETRY_MATH_PROGRAM_NATIVE_BUDGET: " +
      "combine fewer details or simplify the source, max 64 Cuboids."
    );
  }

  // A semantic part is represented temporarily by its full axis-aligned
  // bounds. The existing Recipe ANCHOR solver then solves the dependency
  // graph, detects cycles and conflicting axis claims, and returns ONE rigid
  // translation for every part. This is not Bone parenting or animation.
  const prototypes = new Map<string, RecipeCubePrototype>(
    parts.map(part => [part.id, {
      id: part.id, name: part.id,
      size: part.max.map((value, axis) =>
        value - part.min[axis]!) as RecipeVec3,
    }])
  );
  const initial: RecipeInstance[] = parts.map(part => ({
    id: part.id, prototype_id: part.id,
    translation: part.min.map((value, axis) =>
      value + part.at[axis]!) as RecipeVec3,
    rotation: [0, 0, 0], scale: [1, 1, 1],
  }));
  const solved = solveRecipeConstraints(
    initial, prototypes, canonicalConstraints(
      program.anchors ?? [], program.version
    )
  );
  const byId = new Map(solved.map(instance => [
    instance.id, instance.translation,
  ] as const));
  const output: Pieces = { prototypes: [], patterns: [] };

  for (const part of parts) {
    const targetMin = byId.get(part.id);
    if (!targetMin) throw new Error("GEOMETRY_MATH_PART_SOLVER_IDENTITY_MISSING");
    const translation: RecipeVec3 = [0, 1, 2].map(axis =>
      targetMin[axis]! - part.min[axis]!
    ) as RecipeVec3;
    for (const box of part.boxes) {
      const from = box.from.map((value, axis) =>
        value + translation[axis]!) as RecipeVec3;
      const to = box.to.map((value, axis) =>
        value + translation[axis]!) as RecipeVec3;
      const patternId = [
        "shape", "program", feature.id, "part", part.id, box.id,
      ].join(":");
      const name = [
        feature.label.slice(0, 42), part.id.slice(0, 28), box.id,
      ].join("_");
      const built = makeBox(
        patternId, name, feature.id, from, to
      );
      output.prototypes.push(...built.prototypes);
      output.patterns.push(...built.patterns);
    }
  }
  return output;
}
