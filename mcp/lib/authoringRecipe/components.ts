import type {
  AuthoringRecipe, GridPattern, LinearPattern, RadialPattern, RecipeConstraint, RecipeFeatureIntent, RecipePattern, RecipeSymmetryRelation, RecipeVec3,
} from "@/lib/authoringRecipe/contracts";

export type RecipePatternOverride = {
  pattern_id: string;
  count?: number;
  counts?: [number, number];
  spacing?: number | [number, number];
  radius?: number;
  rotate_with_pattern?: boolean;
};

export type RecipeComponentDefinition = {
  id: string;
  name: string;
  recipe: AuthoringRecipe;
};

export type RecipeComponentInstance = {
  id: string;
  component_id: string;
  translation?: RecipeVec3;
  pattern_overrides?: RecipePatternOverride[];
};

function addVec3(a: readonly number[] | undefined, b: RecipeVec3): RecipeVec3 {
  const source = a ?? [0,0,0];
  if (source.length !== 3 || source.some((value) => !Number.isFinite(value))) {
    throw new Error("Component translation source must contain three finite values.");
  }
  return [source[0] + b[0], source[1] + b[1], source[2] + b[2]];
}

function namespace(local: string, instanceId: string): string {
  if (!local || !instanceId) throw new Error("Component namespace IDs must be non-empty.");
  return instanceId + "/" + local;
}

function overridePattern(pattern: RecipePattern, override: RecipePatternOverride | undefined): RecipePattern {
  if (!override) return structuredClone(pattern);
  if (pattern.kind === "LINEAR") {
    if (override.counts !== undefined || Array.isArray(override.spacing) || override.radius !== undefined || override.rotate_with_pattern !== undefined) {
      throw new Error("LINEAR pattern override contains fields owned by another pattern kind.");
    }
    return { ...pattern, ...(override.count !== undefined ? { count: override.count } : {}), ...(typeof override.spacing === "number" ? { spacing: override.spacing } : {}) } satisfies LinearPattern;
  }
  if (pattern.kind === "GRID") {
    if (override.count !== undefined || typeof override.spacing === "number" || override.radius !== undefined || override.rotate_with_pattern !== undefined) {
      throw new Error("GRID pattern override contains fields owned by another pattern kind.");
    }
    return { ...pattern, ...(override.counts !== undefined ? { counts: [...override.counts] as [number,number] } : {}), ...(Array.isArray(override.spacing) ? { spacing: [...override.spacing] as [number,number] } : {}) } satisfies GridPattern;
  }
  if (override.counts !== undefined || Array.isArray(override.spacing)) {
    throw new Error("RADIAL pattern override contains fields owned by another pattern kind.");
  }
  return {
    ...pattern,
    ...(override.count !== undefined ? { count: override.count } : {}),
    ...(override.radius !== undefined ? { radius: override.radius } : {}),
    ...(override.rotate_with_pattern !== undefined ? { rotate_with_pattern: override.rotate_with_pattern } : {}),
  } satisfies RadialPattern;
}

function composePattern(pattern: RecipePattern, instance: RecipeComponentInstance, prototypeMap: ReadonlyMap<string,string>, override: RecipePatternOverride | undefined): RecipePattern {
  const translated = instance.translation ?? [0,0,0];
  if (translated.some((value) => !Number.isFinite(value))) throw new Error("Component instance translation must be finite.");
  const owned = overridePattern(pattern, override);
  const common = {
    ...owned,
    id: namespace(owned.id, instance.id),
    prototype_id: prototypeMap.get(owned.prototype_id) ?? namespace(owned.prototype_id, instance.id),
    ...(owned.feature_id ? { feature_id: namespace(owned.feature_id, instance.id) } : {}),
  };
  if (owned.kind === "RADIAL") {
    return { ...common, kind: "RADIAL", center: addVec3(owned.center, translated) } as RadialPattern;
  }
  return { ...common, start: addVec3(owned.start, translated) } as LinearPattern | GridPattern;
}

function composeConstraint(constraint: RecipeConstraint, instanceId: string): RecipeConstraint {
  return {
    ...constraint,
    id: namespace(constraint.id, instanceId),
    source_instance_id: namespace(constraint.source_instance_id, instanceId),
    target_instance_id: namespace(constraint.target_instance_id, instanceId),
    offset: constraint.offset ? [...constraint.offset] as RecipeVec3 : undefined,
  };
}

function composeSymmetry(relation: RecipeSymmetryRelation, instance: RecipeComponentInstance): RecipeSymmetryRelation {
  const translation = instance.translation ?? [0,0,0];
  const axisIndex = relation.plane.axis === "X" ? 0 : relation.plane.axis === "Y" ? 1 : 2;
  return {
    ...relation,
    id: namespace(relation.id, instance.id),
    source_instance_id: namespace(relation.source_instance_id, instance.id),
    target_instance_id: namespace(relation.target_instance_id, instance.id),
    plane: {
      ...relation.plane,
      position: relation.plane.position + translation[axisIndex],
    },
    semantic_pair: relation.semantic_pair ? { ...relation.semantic_pair } : undefined,
  };
}

export function composeAuthoringComponents(
  root: Pick<AuthoringRecipe, "schema" | "compiler_version" | "id" | "name">,
  definitions: readonly RecipeComponentDefinition[],
  instances: readonly RecipeComponentInstance[]
): AuthoringRecipe {
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  if (definitionById.size !== definitions.length || definitions.some((definition) => !definition.id || !definition.name)) {
    throw new Error("Component definitions require unique non-empty IDs and names.");
  }
  const instanceIds = instances.map((instance) => instance.id);
  if (instanceIds.some((id) => !id) || new Set(instanceIds).size !== instanceIds.length) {
    throw new Error("Component instances require unique non-empty IDs.");
  }
  const prototypes: AuthoringRecipe["prototypes"] = [];
  const patterns: AuthoringRecipe["patterns"] = [];
  const constraints: NonNullable<AuthoringRecipe["constraints"]> = [];
  const symmetry: NonNullable<AuthoringRecipe["symmetry"]> = [];
  const featureIntents: RecipeFeatureIntent[] = [];
  let withFeaturePlan = false;
  let withoutFeaturePlan = false;

  for (const instance of instances) {
    const definition = definitionById.get(instance.component_id);
    if (!definition) throw new Error("Component instance " + instance.id + " references unknown component " + instance.component_id + ".");
    if (definition.recipe.schema !== root.schema || definition.recipe.compiler_version !== root.compiler_version) {
      throw new Error("Component " + definition.id + " recipe version does not match the root recipe.");
    }
    if (definition.recipe.feature_intents !== undefined) {
      withFeaturePlan = true;
      for (const feature of definition.recipe.feature_intents) {
        featureIntents.push({ ...structuredClone(feature), id: namespace(feature.id, instance.id) });
      }
    } else {
      withoutFeaturePlan = true;
    }
    const overrideByPattern = new Map((instance.pattern_overrides ?? []).map((override) => [override.pattern_id, override]));
    if (overrideByPattern.size !== (instance.pattern_overrides ?? []).length) throw new Error("Component instance " + instance.id + " has duplicate pattern overrides.");
    for (const override of instance.pattern_overrides ?? []) {
      if (!definition.recipe.patterns.some((pattern) => pattern.id === override.pattern_id)) {
        throw new Error("Component instance " + instance.id + " override references unknown pattern " + override.pattern_id + ".");
      }
    }
    const prototypeMap = new Map<string,string>();
    for (const prototype of definition.recipe.prototypes) {
      const nextId = namespace(prototype.id, instance.id);
      prototypeMap.set(prototype.id, nextId);
      prototypes.push({ ...prototype, id: nextId, name: instance.id + "_" + prototype.name, origin: prototype.origin ? [...prototype.origin] as RecipeVec3 : undefined, rotation: prototype.rotation ? [...prototype.rotation] as RecipeVec3 : undefined, size: [...prototype.size] as RecipeVec3 });
    }
    for (const pattern of definition.recipe.patterns) {
      patterns.push(composePattern(pattern, instance, prototypeMap, overrideByPattern.get(pattern.id)));
    }
    for (const constraint of definition.recipe.constraints ?? []) constraints.push(composeConstraint(constraint, instance.id));
    for (const relation of definition.recipe.symmetry ?? []) symmetry.push(composeSymmetry(relation, instance));
  }

  if (withFeaturePlan && withoutFeaturePlan) {
    throw new Error(
      "FEATURE_COMPONENT_SCOPE_INCOMPLETE: cannot silently mix feature-planned " +
      "and legacy components; declare feature intent for each component in this composition."
    );
  }
  return {
    schema: root.schema, compiler_version: root.compiler_version, id: root.id, name: root.name,
    prototypes, patterns,
    ...(withFeaturePlan ? { feature_intents: featureIntents } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
    ...(symmetry.length > 0 ? { symmetry } : {}),
  };
}
