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
  type GeometryMathPartV4,
  type GeometryMathPartV6,
  type GeometryMathConnectorPart,
  type GeometryMathVersion,
  type GeometryMathDimensionLink,
} from "./geometryMathLanguage";
import { MATH_PROGRAM_MAX_CUBOIDS,
  type MathCuboid } from "./geometryMathVoxel";
import { extrudeMathProfile } from "./geometryMathProfile";
import { sweepMathVolume } from "./geometryMathSweep";
import { revolveMathProfile } from "./geometryMathRevolve";
import { loftMathVolume } from "./geometryMathLoft";
import { rotateMathCuboidsQuarterTurns } from "./geometryMathOrthogonal";
import { prepareGeometryFaceAnchors } from "./geometryMathFaceAnchors";
import { requireGeometryMathClearances } from "./geometryMathClearance";
import {
  requireGeometryDimensionConstraints,
} from "./geometryMathDimensionConstraints";
import {
  buildMathConnector,
  type GeometryConnectorSource,
} from "./geometryMathConnect";
import { solveRecipeConstraints } from "./constraints";

/**
 * Bridges a versioned Geometry Construction Language program into the
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

type InstanceRepeat = NonNullable<Extract<
  GeometryMathPartV4, { method: "INSTANCE" }
>["repeat"]>;
type GeometryMathConstructiblePart = Exclude<
  GeometryMathPartV6, { method: "CONNECT" }
>;
type LocalPart = {
  id: string;
  at: RecipeVec3;
  boxes: MathCuboid[];
  min: RecipeVec3;
  max: RecipeVec3;
  repeat?: InstanceRepeat;
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
  return version >= 3
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

/**
 * Structural instancing (v4+) is a source operation, not a second
 * native Recipe engine. A referenced part is resolved once (including
 * its own INSTANCE dependencies), then its immutable local geometry is
 * reused by value under a new semantic part ID and independent placement.
 *
 * Reflection uses the source-local bounding-box midplane and preserves
 * axis-aligned native Cuboid spans. No source 'at', Group, UV mirroring,
 * Bone/pivot or animation data is inherited or manufactured.
 */
function realizeStructuredParts(
  parts: readonly GeometryMathConstructiblePart[],
  version: 4 | 5 | 6 | 7 | 8 | 9 | 10,
  dimensionLinks: readonly GeometryMathDimensionLink[] = []
): LocalPart[] {
  const definitions = new Map(parts.map(part => [part.id, part] as const));
  // Dimension relationships are an input to the existing part resolver.
  // Dependency edges share the same visiting/cycle guard with INSTANCE
  // source references; no second graph/constraint solver is introduced.
  const dimensionsByTarget = new Map<string, GeometryMathDimensionLink[]>();
  for (const link of dimensionLinks) {
    const rows = dimensionsByTarget.get(link.target_part_id) ?? [];
    rows.push(link);
    dimensionsByTarget.set(link.target_part_id, rows);
  }
  for (const rows of dimensionsByTarget.values()) {
    rows.sort((a, b) =>
      a.target_axis < b.target_axis ? -1 :
      a.target_axis > b.target_axis ? 1 : 0
    );
  }
  const completed = new Map<string, LocalPart>();
  const visiting = new Set<string>();

  const resolve = (partId: string): LocalPart => {
    const cached = completed.get(partId);
    if (cached) return cached;
    if (visiting.has(partId)) {
      throw new Error(
        (version === 9 || version === 10
          ? "GEOMETRY_MATH_DIMENSION_OR_INSTANCE_CYCLE: "
          : "GEOMETRY_MATH_INSTANCE_CYCLE: ") +
        [...visiting, partId].join(" -> ")
      );
    }
    const definition = definitions.get(partId);
    if (!definition) {
      throw new Error(
        "GEOMETRY_MATH_INSTANCE_SOURCE_MISSING: " + partId
      );
    }
    visiting.add(partId);
    try {
      let boxes: MathCuboid[];
      let repeat: InstanceRepeat | undefined;
      if (definition.method === "INSTANCE" ||
        definition.method === "ORIENT") {
        const original = resolve(definition.source_part_id);
        // Cloning an already repeated assembly would otherwise silently
        // discard its array. Nested repetition requires a separate,
        // explicitly bounded composition contract.
        if (original.repeat !== undefined) {
          throw new Error(
            "GEOMETRY_MATH_INSTANCE_REPEATED_SOURCE_UNSUPPORTED"
          );
        }
        repeat = definition.repeat;
        const reflectedAxis = definition.reflect_axis === undefined
          ? -1 : ["X", "Y", "Z"].indexOf(definition.reflect_axis);
        if (definition.reflect_axis !== undefined && reflectedAxis < 0) {
          throw new Error("GEOMETRY_MATH_INSTANCE_REFLECTION_AXIS_INVALID");
        }
        boxes = original.boxes.map(box => {
          const from = [...box.from] as RecipeVec3;
          const to = [...box.to] as RecipeVec3;
          if (reflectedAxis >= 0) {
            const planeTwice = original.min[reflectedAxis]! +
              original.max[reflectedAxis]!;
            from[reflectedAxis] = planeTwice - box.to[reflectedAxis]!;
            to[reflectedAxis] = planeTwice - box.from[reflectedAxis]!;
          }
          return { id: box.id, from, to };
        });
        if (definition.method === "ORIENT") {
          // Reflection (when requested) precedes the exact quarter turn.
          // Both operate on local Cube geometry, not Blockbench pivots.
          boxes = rotateMathCuboidsQuarterTurns(
            boxes, original.min, original.max,
            definition.quarter_turn.axis, definition.quarter_turn.steps
          );
        }
      } else if (definition.method === "LOFT") {
        boxes = loftMathVolume(definition, version >= 6 ? 6 : 5);
      } else if ((version === 9 || version === 10) &&
        definition.method === "BOX") {
        // Each linked BOX axis is derived from a source-local enclosing
        // extent, including a declared LINEAR assembly envelope.
        // No arbitrary expression, implicit scaling of native Cube
        // transforms, clamping or silent fraction-to-voxel rounding.
        const size = [...definition.size] as RecipeVec3;
        for (const link of dimensionsByTarget.get(definition.id) ?? []) {
          const source = resolve(link.source_part_id);
          const sourceAxis = "XYZ".indexOf(link.source_axis);
          const targetAxis = "XYZ".indexOf(link.target_axis);
          if (sourceAxis < 0 || targetAxis < 0) {
            throw new Error("GEOMETRY_MATH_DIMENSION_AXIS_INVALID: " + link.id);
          }
          const sourceExtent = source.max[sourceAxis]! -
            source.min[sourceAxis]!;
          const measured = sourceExtent * link.numerator /
            link.denominator + (link.delta ?? 0);
          if (!Number.isFinite(measured) || !Number.isFinite(sourceExtent) ||
            sourceExtent <= 0) {
            throw new Error("GEOMETRY_MATH_DIMENSION_NONFINITE: " + link.id);
          }
          // Limited FP tolerance only removes harmless multiplication
          // noise. A true half-unit cannot be silently rounded.
          const unit = Math.round(measured);
          if (Math.abs(measured - unit) > 1e-9) {
            throw new Error(
              "GEOMETRY_MATH_DIMENSION_NONINTEGER: " + link.id
            );
          }
          if (!Number.isSafeInteger(unit) || unit < 1 || unit > 32) {
            throw new Error(
              "GEOMETRY_MATH_DIMENSION_NATIVE_SPAN_INVALID: " + link.id
            );
          }
          size[targetAxis] = unit;
        }
        boxes = realizePart({ ...definition, size }, version);
      } else {
        boxes = realizePart(definition, version);
      }
      const { min, max } = minMax(boxes);
      if (repeat !== undefined) {
        const axis = ["X", "Y", "Z"].indexOf(repeat.axis);
        const shift = (repeat.count - 1) * repeat.spacing;
        if (axis < 0 || !Number.isFinite(shift)) {
          throw new Error("GEOMETRY_MATH_INSTANCE_REPEAT_INVALID");
        }
        // ANCHOR sees the full repeated assembly bounds, while each
        // member remains an original Recipe LINEAR pattern instance.
        if (shift < 0) min[axis] = min[axis]! + shift;
        else max[axis] = max[axis]! + shift;
      }
      const result: LocalPart = {
        id: definition.id,
        at: [...definition.at] as RecipeVec3,
        boxes, min, max,
        ...(repeat ? { repeat } : {}),
      };
      completed.set(partId, result);
      return result;
    } catch (error) {
      // Preserve the machine-readable error prefix while identifying the
      // exact semantic instance chain for a bounded AI repair.
      if (!(error instanceof Error)) throw error;
      throw new Error(
        error.message + " [part=" + definition.id +
        ";method=" + definition.method + ";math_version=" + version + "]",
        { cause: error }
      );
    } finally {
      visiting.delete(partId);
    }
  };

  return [...parts]
    .sort((a, b) => compareSourceIds(a.id, b.id, version))
    .map(part => resolve(part.id));
}

export function buildGeometryMathProgramPieces(
  feature: ProgramFeature, makeBox: BoxFactory
): Pieces {
  // Re-validate at the builder boundary as callers may be internal. Reusing
  // this single strict schema also validates persisted source on inspection.
  const program = geometryMathProgramSchema.parse(feature.program);
  const parts: LocalPart[] = program.version === 10
    ? realizeStructuredParts(
      program.parts.filter((part):
        part is GeometryMathConstructiblePart =>
        part.method !== "CONNECT"),
      10, program.dimension_links ?? []
    )
    : program.version === 9
      ? realizeStructuredParts(
      program.parts.filter((part):
        part is GeometryMathConstructiblePart =>
        part.method !== "CONNECT"),
      9, program.dimension_links ?? []
    )
    : program.version === 8
      ? realizeStructuredParts(
      program.parts.filter((part):
        part is GeometryMathConstructiblePart =>
        part.method !== "CONNECT"),
      8
    )
    : program.version === 7
      ? realizeStructuredParts(
      program.parts.filter((part):
        part is GeometryMathConstructiblePart =>
        part.method !== "CONNECT"),
      7
    )
    : program.version === 6
      ? realizeStructuredParts(
      program.parts.filter((part):
        part is GeometryMathConstructiblePart =>
        part.method !== "CONNECT"),
      6
    )
    : program.version === 5
      ? realizeStructuredParts(
        program.parts.filter((part):
          part is GeometryMathConstructiblePart =>
          part.method !== "CONNECT"),
        5
      )
    : program.version === 4
      ? realizeStructuredParts(program.parts, 4)
      : [...program.parts]
        .sort((left, right) => compareSourceIds(
          left.id, right.id, program.version
        ))
        .map(part => {
          try {
            const boxes = realizePart(part, program.version);
            const { min, max } = minMax(boxes);
            return {
              id: part.id,
              at: [...part.at] as RecipeVec3,
              boxes, min, max,
            };
          } catch (error) {
            // Keep exact v1/v2 errors and v3 part identity unchanged.
            if (program.version !== 3 || !(error instanceof Error)) throw error;
            throw new Error(
              error.message + " [part=" + part.id +
              ";method=" + part.method + ";math_version=3]",
              { cause: error }
            );
          }
        });

  const requireNativeBudget = (scope: readonly LocalPart[]): void => {
    const count = scope.reduce((sum, part) =>
      sum + part.boxes.length * (part.repeat?.count ?? 1), 0
    );
    if (count < 1 || count > MATH_PROGRAM_MAX_CUBOIDS) {
      throw new Error(
        "GEOMETRY_MATH_PROGRAM_NATIVE_BUDGET: " +
        "combine fewer details or simplify the source, max 64 Cuboids."
      );
    }
  };
  // Check the ordinary source cohort BEFORE solving, for every version.
  // V5+ checks AGAIN after deriving connectors from solved parts. An
  // over-budget instance/LOFT must not allocate connector voxel volumes.
  requireNativeBudget(parts);

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
  // V7+ exact source-local Cube faces become ordinary Recipe ANCHOR
  // constraints. The single canonical solver/Undo owner is unchanged.
  const faceAnchors = (program.version === 7 ||
    program.version === 8 || program.version === 9 ||
    program.version === 10)
    ? prepareGeometryFaceAnchors(parts, program.face_anchors ?? [])
    : null;
  const standardConstraints = canonicalConstraints(
    program.anchors ?? [], program.version
  );
  const solved = solveRecipeConstraints(
    initial, prototypes,
    faceAnchors
      ? [...standardConstraints, ...faceAnchors.constraints]
      : standardConstraints
  );
  const byId = new Map(solved.map(instance => [
    instance.id, instance.translation,
  ] as const));
  // Confirm real positive-area face contact after all canonical ANCHOR
  // dependencies have resolved. No second constraint solver or native pass.
  faceAnchors?.verify(byId);

  if (program.version >= 5) {
    // A CONNECT references geometrically realized, ANCHOR-solved parts,
    // not arbitrary scene selections or an unverified bounding-box point.
    const sources = new Map<string, GeometryConnectorSource>();
    for (const part of parts) {
      const worldMin = byId.get(part.id);
      if (!worldMin) {
        throw new Error("GEOMETRY_MATH_CONNECT_SOURCE_UNSOLVED: " + part.id);
      }
      const translation: RecipeVec3 = [0, 1, 2].map(axis =>
        worldMin[axis]! - part.min[axis]!
      ) as RecipeVec3;
      const worldMax: RecipeVec3 = [0, 1, 2].map(axis =>
        worldMin[axis]! + part.max[axis]! - part.min[axis]!
      ) as RecipeVec3;
      sources.set(part.id, {
        id: part.id,
        world_min: [...worldMin] as RecipeVec3,
        world_max: worldMax,
        translation,
        local_boxes: part.boxes,
        ...(part.repeat ? { repeat: part.repeat } : {}),
      });
    }
    const connectors = program.parts.filter((part):
      part is GeometryMathConnectorPart =>
      part.method === "CONNECT"
    ).sort((left, right) => compareSourceIds(
      left.id, right.id, program.version
    ));
    for (const connector of connectors) {
      try {
        const boxes = buildMathConnector(
          connector, sources, program.version === 5 ? 5 : 6
        );
        const { min, max } = minMax(boxes);
        parts.push({
          id: connector.id,
          at: [0, 0, 0],
          boxes, min, max,
        });
        // The connector has already been realized in solved model-space.
        // Its own anchor is unavailable by schema; no secondary solver.
        byId.set(connector.id, [...min] as RecipeVec3);
        if (program.version === 8 || program.version === 9 ||
          program.version === 10) {
          // Derived CONNECT coordinates are already in model space.
          // A zero translation makes them comparable with solved parts
          // without interpreting them as ANCHOR dependencies.
          sources.set(connector.id, {
            id: connector.id,
            world_min: [...min] as RecipeVec3,
            world_max: [...max] as RecipeVec3,
            translation: [0, 0, 0],
            local_boxes: boxes,
          });
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new Error(
          error.message + " [part=" + connector.id +
          ";method=CONNECT;math_version=" + program.version + "]",
          { cause: error }
        );
      }
    }
    parts.sort((a, b) => compareSourceIds(a.id, b.id, program.version));
    requireNativeBudget(parts);
    if (program.version === 8 || program.version === 9 ||
      program.version === 10) {
      // V8+ face contact must not permit *other* Cuboids of the same
      // two semantic parts to interpenetrate. Explicit CLEARANCE pairs
      // may also require a Euclidean distance from 0–8 model units.
      // Checks occur after canonical ANCHOR and derived CONNECT only;
      // no auto-moving parts or global-scene clearance claims.
      requireGeometryMathClearances(
        sources,
        program.clearances ?? [],
        program.face_anchors ?? []
      );
    }
  }
  if (program.version === 10) {
    // Bounds are those of the fully constructed program, including
    // dimension-derived BOX sizes, signed LINEAR repetition and the
    // optional post-ANCHOR CONNECT cohort. This is a read-only source
    // acceptance gate before the SAME native Recipe Cuboid factory.
    requireGeometryDimensionConstraints(
      parts.map(part => ({
        id: part.id,
        min: part.min,
        max: part.max,
      })),
      program.dimension_constraints ?? []
    );
  }
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
      try {
        const built = makeBox(
          patternId, name, feature.id, from, to
        );
        if (part.repeat) {
          const pattern = built.patterns[0];
          // The existing Recipe LINEAR expander and native transaction
          // execute the repetition; no duplicate Cuboid placement loop.
          if (built.patterns.length !== 1 ||
            !pattern || pattern.kind !== "LINEAR" ||
            pattern.count !== 1 || built.prototypes.length !== 1) {
            throw new Error("GEOMETRY_MATH_INSTANCE_NATIVE_PATTERN_UNEXPECTED");
          }
          pattern.count = part.repeat.count;
          pattern.axis = part.repeat.axis;
          pattern.spacing = part.repeat.spacing;
        }
        output.prototypes.push(...built.prototypes);
        output.patterns.push(...built.patterns);
      } catch (error) {
        if (program.version < 3 || !(error instanceof Error)) throw error;
        throw new Error(
          error.message + " [part=" + part.id +
          ";cube=" + box.id + ";math_version=" + program.version + "]",
          { cause: error }
        );
      }
    }
  }
  return output;
}
