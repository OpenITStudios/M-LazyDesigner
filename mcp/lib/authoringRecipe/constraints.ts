import type {
  RecipeAnchorConstraint, RecipeAnchorPosition, RecipeConstraint, RecipeCubePrototype, RecipeInstance, RecipeVec3,
} from "@/lib/authoringRecipe/contracts";

const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;

function factor(position: RecipeAnchorPosition): number {
  if (position === "MIN") return 0;
  if (position === "CENTER") return 0.5;
  return 1;
}

function requireOffset(value: readonly number[] | undefined): RecipeVec3 {
  const source = value ?? [0,0,0];
  if (source.length !== 3 || source.some((entry) => !Number.isFinite(entry))) {
    throw new Error("Recipe constraint offset must contain three finite values.");
  }
  return [source[0], source[1], source[2]];
}

function sizeOf(prototype: RecipeCubePrototype): RecipeVec3 {
  const size = prototype.size;
  if (size.length !== 3 || size.some((entry) => !Number.isFinite(entry) || entry <= 0)) {
    throw new Error("Recipe constraint requires positive finite prototype size for " + prototype.id + ".");
  }
  return [size[0], size[1], size[2]];
}

function anchorCoordinate(translation: RecipeVec3, size: RecipeVec3, anchor: RecipeAnchorPosition, axis: number): number {
  return translation[axis] + size[axis] * factor(anchor);
}

function validateConstraint(constraint: RecipeAnchorConstraint): void {
  if (!constraint.id || !constraint.source_instance_id || !constraint.target_instance_id) {
    throw new Error("Recipe anchor constraint requires non-empty id/source/target.");
  }
  if (constraint.source_instance_id === constraint.target_instance_id) {
    throw new Error("Recipe anchor constraint cannot target the same instance as its source.");
  }
  if (constraint.axes.length === 0 || new Set(constraint.axes).size !== constraint.axes.length) {
    throw new Error("Recipe anchor constraint axes must be non-empty and unique.");
  }
  requireOffset(constraint.offset);
}

export function solveRecipeConstraints(
  instances: readonly RecipeInstance[],
  prototypes: ReadonlyMap<string, RecipeCubePrototype>,
  constraints: readonly RecipeConstraint[]
): RecipeInstance[] {
  const instanceById = new Map(instances.map((instance) => {
    if (instance.translation.length !== 3 ||
        instance.translation.some((value) => !Number.isFinite(value))) {
      throw new Error("RECIPE_CONSTRAINT_INPUT_NONFINITE: " + instance.id +
        " must have finite translation coordinates.");
    }
    return [instance.id, {
      ...instance, translation: [...instance.translation] as RecipeVec3,
    }] as const;
  }));
  if (instanceById.size !== instances.length) throw new Error("Recipe constraints require unique instance IDs.");
  const constraintsBySource = new Map<string, RecipeAnchorConstraint[]>();
  const constraintIds = constraints.map((constraint) => constraint.id);
  if (constraintIds.some((id) => !id) || new Set(constraintIds).size !== constraintIds.length) {
    throw new Error("Recipe constraint IDs must be unique and non-empty.");
  }
  for (const raw of constraints) {
    if (raw.kind !== "ANCHOR") throw new Error("Unsupported recipe constraint kind.");
    validateConstraint(raw);
    if (!instanceById.has(raw.source_instance_id)) throw new Error("Recipe constraint " + raw.id + " references missing source instance " + raw.source_instance_id + ".");
    if (!instanceById.has(raw.target_instance_id)) throw new Error("Recipe constraint " + raw.id + " references missing target instance " + raw.target_instance_id + ".");
    const list = constraintsBySource.get(raw.source_instance_id) ?? [];
    list.push(raw); constraintsBySource.set(raw.source_instance_id, list);
  }

  const state = new Map<string, "VISITING" | "DONE">();
  const solve = (instanceId: string): RecipeInstance => {
    const currentState = state.get(instanceId);
    if (currentState === "DONE") return instanceById.get(instanceId)!;
    if (currentState === "VISITING") throw new Error("Recipe constraint cycle detected at instance " + instanceId + ".");
    state.set(instanceId, "VISITING");
    const source = instanceById.get(instanceId)!;
    const sourcePrototype = prototypes.get(source.prototype_id);
    if (!sourcePrototype) throw new Error("Recipe constraint source prototype " + source.prototype_id + " is missing.");
    const sourceSize = sizeOf(sourcePrototype);
    const axisClaims = new Map<number, { value: number; constraint: string }>();

    for (const constraint of constraintsBySource.get(instanceId) ?? []) {
      const target = solve(constraint.target_instance_id);
      const targetPrototype = prototypes.get(target.prototype_id);
      if (!targetPrototype) throw new Error("Recipe constraint target prototype " + target.prototype_id + " is missing.");
      const targetSize = sizeOf(targetPrototype);
      const offset = requireOffset(constraint.offset);
      for (const axisName of constraint.axes) {
        const axis = AXIS_INDEX[axisName];
        const targetCoordinate = anchorCoordinate(target.translation, targetSize, constraint.target_anchor[axis], axis);
        const sourceAnchorOffset = sourceSize[axis] * factor(constraint.source_anchor[axis]);
        const desired = targetCoordinate + offset[axis] - sourceAnchorOffset;
        if (!Number.isFinite(desired)) {
          throw new Error("RECIPE_CONSTRAINT_NONFINITE_COORDINATE: " +
            constraint.id + " overflows " + instanceId + " axis " + axisName + ".");
        }
        const existing = axisClaims.get(axis);
        if (existing && Math.abs(existing.value - desired) > 1e-9) {
          throw new Error("Recipe constraint conflict on " + instanceId + " axis " + axisName + ": " + existing.constraint + " and " + constraint.id + " disagree.");
        }
        axisClaims.set(axis, { value: desired, constraint: constraint.id });
      }
    }

    const translation = [...source.translation] as RecipeVec3;
    for (const [axis, claim] of axisClaims) translation[axis] = claim.value;
    const solved = { ...source, translation };
    instanceById.set(instanceId, solved);
    state.set(instanceId, "DONE");
    return solved;
  };

  return instances.map((instance) => solve(instance.id));
}
