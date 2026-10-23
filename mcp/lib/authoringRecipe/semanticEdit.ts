import type { CompiledAuthoringRecipe, CompiledCubePlacement, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import { validateCubeGeometrySpan } from "@/lib/geometry/cubeSpan";

export type SemanticGeometryTarget = {
  instance_ids?: readonly string[];
  prototype_id?: string;
  semantic_group?: string;
};

export type SemanticGeometryOperation =
  | { kind: "TRANSLATE"; delta: RecipeVec3 }
  | {
      kind: "RESIZE_AXIS";
      axis: "X" | "Y" | "Z";
      mode: "SET" | "ADD" | "MULTIPLY";
      value: number;
      anchor?: "MIN" | "CENTER" | "MAX";
    }
  | {
      kind: "ROTATE_AXIS";
      axis: "X" | "Y" | "Z";
      delta_degrees: number;
    }
  | {
      kind: "INFLATE";
      mode: "SET" | "ADD" | "MULTIPLY";
      value: number;
    };

export type SemanticGeometryEditIntent = {
  target: SemanticGeometryTarget;
  operation: SemanticGeometryOperation;
};

export type SemanticGeometryEditPlan = {
  upserts: CompiledCubePlacement[];
  affected_instance_ids: string[];
  preserved_instance_ids: string[];
  application_boundary: "RECIPE_REWRITE_REQUIRED";
  diagnostics: {
    selected_by: "INSTANCE_IDS" | "PROTOTYPE_ID" | "SEMANTIC_GROUP";
    affected_count: number;
  };
};

const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;

function finiteVec3(value: readonly number[], label: string): RecipeVec3 {
  if (value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(label + " must contain three finite values.");
  }
  return [value[0], value[1], value[2]];
}

function resolveTargets(compiled: CompiledAuthoringRecipe, target: SemanticGeometryTarget) {
  const selectors = [
    target.instance_ids && target.instance_ids.length > 0 ? "INSTANCE_IDS" : null,
    target.prototype_id ? "PROTOTYPE_ID" : null,
    target.semantic_group ? "SEMANTIC_GROUP" : null,
  ].filter(Boolean) as SemanticGeometryEditPlan["diagnostics"]["selected_by"][];

  if (selectors.length !== 1) {
    throw new Error("Semantic geometry edit requires exactly one target selector.");
  }

  const selectedBy = selectors[0];
  let placements: CompiledCubePlacement[];
  if (selectedBy === "INSTANCE_IDS") {
    const ids = new Set(target.instance_ids);
    placements = compiled.placements.filter((placement) => ids.has(placement.id));
    if (placements.length !== ids.size) {
      const found = new Set(placements.map((placement) => placement.id));
      const missing = [...ids].filter((id) => !found.has(id));
      throw new Error("Semantic geometry edit references missing instances: " + missing.join(", ") + ".");
    }
  } else if (selectedBy === "PROTOTYPE_ID") {
    placements = compiled.placements.filter((placement) => placement.prototype_id === target.prototype_id);
  } else {
    placements = compiled.placements.filter((placement) => placement.semantic_group === target.semantic_group);
  }

  if (placements.length === 0) {
    throw new Error("Semantic geometry edit target resolved to no owned instances.");
  }
  return { placements, selectedBy };
}

function transformPlacement(
  placement: CompiledCubePlacement,
  operation: SemanticGeometryOperation
): CompiledCubePlacement {
  if (operation.kind === "TRANSLATE") {
    const delta = finiteVec3(operation.delta, "Semantic geometry translation");
    const add = (value: RecipeVec3): RecipeVec3 => [
      value[0] + delta[0],
      value[1] + delta[1],
      value[2] + delta[2],
    ];
    return { ...placement, from: add(placement.from), to: add(placement.to), origin: add(placement.origin) };
  }

  if (operation.kind === "ROTATE_AXIS") {
    if (!Number.isFinite(operation.delta_degrees)) {
      throw new Error("Semantic geometry rotation delta must be finite.");
    }
    const rotation = [...placement.rotation] as RecipeVec3;
    rotation[AXIS_INDEX[operation.axis]] += operation.delta_degrees;
    return { ...placement, rotation };
  }

  if (operation.kind === "INFLATE") {
    if (!Number.isFinite(operation.value)) throw new Error("Semantic geometry inflate value must be finite.");
    const next =
      operation.mode === "SET" ? operation.value :
      operation.mode === "ADD" ? placement.inflate + operation.value :
      placement.inflate * operation.value;
    if (!Number.isFinite(next)) throw new Error("Semantic geometry inflate result must be finite.");
    return { ...placement, inflate: next };
  }

  if (!Number.isFinite(operation.value)) throw new Error("Semantic geometry resize value must be finite.");
  const axis = AXIS_INDEX[operation.axis];
  const current = placement.to[axis] - placement.from[axis];
  const next =
    operation.mode === "SET" ? operation.value :
    operation.mode === "ADD" ? current + operation.value :
    current * operation.value;
  if (!(next > 0) || !Number.isFinite(next)) {
    throw new Error("Semantic geometry resize must produce a positive finite dimension.");
  }

  const anchor = operation.anchor ?? "CENTER";
  const from = [...placement.from] as RecipeVec3;
  const to = [...placement.to] as RecipeVec3;
  if (anchor === "MIN") {
    to[axis] = from[axis] + next;
  } else if (anchor === "MAX") {
    from[axis] = to[axis] - next;
  } else {
    const center = (from[axis] + to[axis]) / 2;
    from[axis] = center - next / 2;
    to[axis] = center + next / 2;
  }
  return { ...placement, from, to };
}

/**
 * Validate proposed semantic corrections using the canonical Cube span
 * owner, without inferring whether valid small Geometry is artistically needed.
 */
function requireValidSemanticPlacement(
  previous: CompiledCubePlacement,
  proposed: CompiledCubePlacement,
  operation: SemanticGeometryOperation
): CompiledCubePlacement {
  const label = "Semantic correction " + previous.id;
  for (const field of ["from", "to", "origin", "rotation"] as const) {
    const values = proposed[field];
    if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("SEMANTIC_CORRECTION_NONFINITE: " + label +
        " produced invalid " + field + " coordinates.");
    }
  }
  if (proposed.to.some((value, axis) =>
      previous.to[axis] > previous.from[axis] &&
      value <= proposed.from[axis])) {
    throw new Error("SEMANTIC_CORRECTION_SPAN_COLLAPSED: " + label +
      " lost a previously positive authored Cube axis.");
  }
  validateCubeGeometrySpan(proposed.from, proposed.to, proposed.inflate, label);
  if (operation.kind === "TRANSLATE") {
    // Translation must preserve size and pivot relative to the mass.
    // Allow ordinary floating-point noise, not a material width/pivot drift.
    for (let axis = 0; axis < 3; axis++) {
      const originalSize = previous.to[axis] - previous.from[axis];
      const nextSize = proposed.to[axis] - proposed.from[axis];
      const originalPivot = previous.origin[axis] - previous.from[axis];
      const nextPivot = proposed.origin[axis] - proposed.from[axis];
      const tolerance = 1e-9 * Math.max(1, Math.abs(originalSize), Math.abs(originalPivot));
      if (![originalSize, nextSize, originalPivot, nextPivot].every(Number.isFinite) ||
          Math.abs(nextSize - originalSize) > tolerance ||
          Math.abs(nextPivot - originalPivot) > tolerance) {
        throw new Error("SEMANTIC_CORRECTION_RIGID_DISTORTION: " + label +
          " changed authored size or pivot offset while translating.");
      }
    }
  }
  return proposed;
}

export function compileSemanticGeometryEdit(
  compiled: CompiledAuthoringRecipe,
  intent: SemanticGeometryEditIntent
): SemanticGeometryEditPlan {
  const { placements, selectedBy } = resolveTargets(compiled, intent.target);
  const affectedIds = new Set(placements.map((placement) => placement.id));
  const upserts = placements.map((placement) =>
    requireValidSemanticPlacement(
      placement, transformPlacement(placement, intent.operation),
      intent.operation
    ));
  return {
    upserts,
    affected_instance_ids: [...affectedIds].sort(),
    preserved_instance_ids: compiled.placements
      .filter((placement) => !affectedIds.has(placement.id))
      .map((placement) => placement.id)
      .sort(),
    application_boundary: "RECIPE_REWRITE_REQUIRED",
    diagnostics: { selected_by: selectedBy, affected_count: upserts.length },
  };
}
