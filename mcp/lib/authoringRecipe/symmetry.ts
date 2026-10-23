import type {
  CompiledSymmetryRelationship, RecipeCubePrototype, RecipeInstance, RecipeSymmetryRelation, RecipeVec3,
} from "@/lib/authoringRecipe/contracts";

const AXIS_INDEX = { X: 0, Y: 1, Z: 2 } as const;

function hasRotation(values: readonly number[]): boolean {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("RECIPE_SYMMETRY_ROTATION_INVALID: rotation must contain three finite values.");
  }
  return values.some((value) => Math.abs(value) > 1e-9);
}

function requireRelation(relation: RecipeSymmetryRelation): void {
  if (!relation.id || !relation.source_instance_id || !relation.target_instance_id) {
    throw new Error("Recipe symmetry relation requires non-empty id/source/target.");
  }
  if (relation.source_instance_id === relation.target_instance_id) {
    throw new Error("Recipe symmetry source and target must be different instances.");
  }
  if (!Number.isFinite(relation.plane.position)) {
    throw new Error("Recipe symmetry plane position must be finite.");
  }
}

export function applyRecipeSymmetry(
  solvedInstances: readonly RecipeInstance[],
  prototypes: ReadonlyMap<string, RecipeCubePrototype>,
  relations: readonly RecipeSymmetryRelation[]
): { instances: RecipeInstance[]; relationships: CompiledSymmetryRelationship[] } {
  const relationIds = relations.map((relation) => relation.id);
  if (relationIds.some((id) => !id) || new Set(relationIds).size !== relationIds.length) {
    throw new Error("Recipe symmetry relation IDs must be unique and non-empty.");
  }
  const byId = new Map(solvedInstances.map((instance) => [instance.id, instance]));
  if (byId.size !== solvedInstances.length) throw new Error("Recipe symmetry requires unique source instance IDs.");
  const output = solvedInstances.map((instance) => {
    if (instance.translation.length !== 3 ||
        instance.translation.some((value) => !Number.isFinite(value))) {
      throw new Error("RECIPE_SYMMETRY_INPUT_NONFINITE: " + instance.id +
        " must have finite translation coordinates.");
    }
    hasRotation(instance.rotation); // validate numeric values even without mirror relations
    return {
      ...instance,
      translation: [...instance.translation] as RecipeVec3,
      rotation: [...instance.rotation] as RecipeVec3,
    };
  });
  const outputById = new Map(output.map((instance) => [instance.id, instance]));
  const relationships: CompiledSymmetryRelationship[] = [];

  for (const relation of relations) {
    requireRelation(relation);
    const source = outputById.get(relation.source_instance_id);
    if (!source) throw new Error("Recipe symmetry " + relation.id + " references missing source instance " + relation.source_instance_id + ".");
    if (outputById.has(relation.target_instance_id)) {
      throw new Error("Recipe symmetry " + relation.id + " target instance already exists: " + relation.target_instance_id + ".");
    }
    const prototype = prototypes.get(source.prototype_id);
    if (!prototype) throw new Error("Recipe symmetry source prototype " + source.prototype_id + " is missing.");
    if (hasRotation(source.rotation) || hasRotation(prototype.rotation ?? [0,0,0])) {
      throw new Error("Recipe symmetry v1 refuses rotated source instance " + source.id + "; native handed rotation mirroring requires an explicit orientation policy.");
    }
    const axis = AXIS_INDEX[relation.plane.axis];
    const size = prototype.size;
    if (size.length !== 3 || size.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Recipe symmetry requires positive finite prototype size for " + prototype.id + ".");
    }
    const translation = [...source.translation] as RecipeVec3;
    translation[axis] =
      relation.plane.position * 2 -
      (source.translation[axis] + size[axis]);
    if (!Number.isFinite(translation[axis])) {
      throw new Error("RECIPE_SYMMETRY_COORDINATE_NONFINITE: " +
        relation.id + " reflected coordinate overflow.");
    }
    const target: RecipeInstance = {
      ...source,
      id: relation.target_instance_id,
      translation,
      semantic_group: relation.semantic_pair?.target ?? source.semantic_group,
    };
    output.push(target);
    outputById.set(target.id, target);
    relationships.push({
      id: relation.id,
      source_instance_id: source.id,
      target_instance_id: target.id,
      plane: { ...relation.plane },
      uv_policy: relation.uv_policy,
      texture_policy: relation.texture_policy,
      rig_policy: relation.rig_policy,
      semantic_pair: relation.semantic_pair ? { ...relation.semantic_pair } : undefined,
    });
  }
  return { instances: output, relationships };
}
