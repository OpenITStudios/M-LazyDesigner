import type { AuthoringRecipe, CompiledAuthoringRecipe, CompiledCubePlacement, RecipeCubePrototype, RecipeInstance, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import { expandRecipePattern } from "@/lib/authoringRecipe/patterns";
import { solveRecipeConstraints } from "@/lib/authoringRecipe/constraints";
import { applyRecipeSymmetry } from "@/lib/authoringRecipe/symmetry";
import { planRecipeFeatureRepresentations } from "@/lib/authoringRecipe/featureDecision";

function requireVec3(value: readonly number[], label: string): RecipeVec3 {
  if (value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) throw new Error(label + " must contain three finite values.");
  return [value[0], value[1], value[2]];
}

function validatePrototype(prototype: RecipeCubePrototype): void {
  if (!prototype.id || !prototype.name) throw new Error("Recipe prototype requires non-empty id and name.");
  const size = requireVec3(prototype.size, "Prototype " + prototype.id + " size");
  if (size.some((entry) => entry <= 0)) throw new Error("Prototype " + prototype.id + " size must be positive on every axis.");
  if (prototype.inflate !== undefined && !Number.isFinite(prototype.inflate)) throw new Error("Prototype " + prototype.id + " inflate must be finite.");
  if (prototype.origin) requireVec3(prototype.origin, "Prototype " + prototype.id + " origin");
  if (prototype.rotation) requireVec3(prototype.rotation, "Prototype " + prototype.id + " rotation");
}

function addVec3(a: RecipeVec3, b: RecipeVec3): RecipeVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function realizeCube(prototype: RecipeCubePrototype, instance: RecipeInstance, patternId: string, index: number): CompiledCubePlacement {
  const size = requireVec3(prototype.size, "Prototype " + prototype.id + " size");
  if (instance.scale.some((entry) => entry !== 1)) throw new Error("Authoring Recipe v1 keeps instances lightweight and does not realize per-instance scale yet.");
  const from = [...instance.translation] as RecipeVec3;
  const to: RecipeVec3 = [from[0] + size[0], from[1] + size[1], from[2] + size[2]];
  const baseRotation = prototype.rotation ?? [0, 0, 0];
  const rotation = addVec3(requireVec3(baseRotation, "Prototype " + prototype.id + " rotation"), instance.rotation);
  const baseOrigin = prototype.origin ?? [size[0] / 2, size[1] / 2, size[2] / 2];
  const origin = addVec3(requireVec3(baseOrigin, "Prototype " + prototype.id + " origin"), instance.translation);
  return {
    id: instance.id, name: prototype.name + "_" + (index + 1), prototype_id: prototype.id,
    from, to, origin, rotation, inflate: prototype.inflate ?? 0,
    semantic_group: instance.semantic_group ?? prototype.semantic_group,
    source_pattern_id: patternId, instance_index: index,
  };
}

export function compileAuthoringRecipe(recipe: AuthoringRecipe): CompiledAuthoringRecipe {
  if (recipe.schema !== 1 || recipe.compiler_version !== 1) throw new Error("Unsupported Authoring Recipe version.");
  if (!recipe.id || !recipe.name) throw new Error("Authoring Recipe requires non-empty id and name.");
  const prototypeIds = recipe.prototypes.map((prototype) => prototype.id);
  if (new Set(prototypeIds).size !== prototypeIds.length) throw new Error("Authoring Recipe prototype IDs must be unique.");
  recipe.prototypes.forEach(validatePrototype);
  const prototypeById = new Map(recipe.prototypes.map((prototype) => [prototype.id, prototype]));
  const featurePlan = recipe.feature_intents !== undefined
    ? planRecipeFeatureRepresentations(recipe.feature_intents)
    : null;
  // An unresolved, uninstantiated texture/optional feature must not block
  // unrelated proven structural geometry. Only a Cube pattern depending on
  // unresolved evidence is an authoring blocker.
  if (featurePlan) {
    const routeById = new Map(featurePlan.decisions.map((entry) => [entry.id, entry.route]));
    const referencedGeometryFeatures = new Set<string>();
    for (const pattern of recipe.patterns) {
      if (!pattern.feature_id) {
        throw new Error(
          "FEATURE_PATTERN_OWNER_REQUIRED: Cube pattern " + pattern.id +
          " needs a semantic feature_id when the recipe declares feature_intents."
        );
      }
      const route = routeById.get(pattern.feature_id);
      if (!route) {
        throw new Error("FEATURE_PATTERN_OWNER_UNKNOWN: " + pattern.id +
          " references " + pattern.feature_id);
      }
      if (route === "REVIEW_REQUIRED") {
        const decision = featurePlan.decisions.find((entry) => entry.id === pattern.feature_id);
        throw new Error(
          "FEATURE_DECISION_REVIEW_REQUIRED: Cube pattern " + pattern.id +
          " relies on unverified feature " + pattern.feature_id +
          " (" + decision?.reason + ")."
        );
      }
      if (route !== "GEOMETRY") {
        throw new Error(
          "FEATURE_REPRESENTATION_MISMATCH: Cube pattern " + pattern.id +
          " references " + route + " feature " + pattern.feature_id +
          ". Surface detail belongs to Texture; OMIT does not create geometry."
        );
      }
      referencedGeometryFeatures.add(pattern.feature_id);
    }
    for (const decision of featurePlan.decisions) {
      if (decision.route === "GEOMETRY" &&
          !referencedGeometryFeatures.has(decision.id)) {
        throw new Error(
          "FEATURE_GEOMETRY_UNREALIZED: required 3D feature " + decision.id +
          " has no Cube pattern. Create necessary Geometry or return to reference review."
        );
      }
    }
  }
  const patternIds = recipe.patterns.map((pattern) => pattern.id);
  if (new Set(patternIds).size !== patternIds.length) throw new Error("Authoring Recipe pattern IDs must be unique.");
  const expanded = recipe.patterns.flatMap((pattern) => {
    const prototype = prototypeById.get(pattern.prototype_id);
    if (!prototype) throw new Error("Pattern " + pattern.id + " references unknown prototype " + pattern.prototype_id + ".");
    return expandRecipePattern(pattern).map((instance, index) => ({
      instance,
      pattern_id: pattern.id,
      local_index: index,
    }));
  });
  const solvedInstances = solveRecipeConstraints(
    expanded.map((entry) => entry.instance),
    prototypeById,
    recipe.constraints ?? []
  );
  const symmetry = applyRecipeSymmetry(
    solvedInstances,
    prototypeById,
    recipe.symmetry ?? []
  );
  const expandedOwnerById = new Map(
    expanded.map((entry) => [
      entry.instance.id,
      { pattern_id: entry.pattern_id, local_index: entry.local_index },
    ])
  );
  const symmetryOwnerById = new Map(
    symmetry.relationships.map((relation, index) => [
      relation.target_instance_id,
      { pattern_id: "symmetry:" + relation.id, local_index: index },
    ])
  );
  const placements: CompiledCubePlacement[] = symmetry.instances.map((instance) => {
    const prototype = prototypeById.get(instance.prototype_id)!;
    const owner =
      expandedOwnerById.get(instance.id) ??
      symmetryOwnerById.get(instance.id);
    if (!owner) throw new Error("Compiled instance " + instance.id + " has no recipe owner.");
    return realizeCube(
      prototype,
      instance,
      owner.pattern_id,
      owner.local_index
    );
  });
  const placementIds = placements.map((placement) => placement.id);
  if (new Set(placementIds).size !== placementIds.length) throw new Error("Compiled Authoring Recipe produced duplicate instance IDs.");
  const uniqueGeometryCount = new Set(placements.map((placement) => placement.prototype_id)).size;
  return {
    schema: 1, compiler_version: recipe.compiler_version, recipe_id: recipe.id, placements,
    symmetry_relationships: symmetry.relationships,
    ...(featurePlan ? { feature_plan: featurePlan.summary } : {}),
    metrics: {
      prototype_count: recipe.prototypes.length, pattern_count: recipe.patterns.length,
      instance_count: placements.length, realized_cube_count: placements.length,
      unique_geometry_count: uniqueGeometryCount,
      repeated_instance_count: placements.length - uniqueGeometryCount,
      symmetry_generated_count: symmetry.relationships.length,
    },
  };
}
