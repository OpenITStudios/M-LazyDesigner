/// <reference types="blockbench-types" />

export const RECIPE_ID_PROPERTY = "lazydesigner_recipe_id";
export const RECIPE_INSTANCE_ID_PROPERTY = "lazydesigner_recipe_instance_id";
export const PROJECT_RECIPE_STORE_PROPERTY =
  "lazydesigner_authoring_recipe_store";

export type AuthoringRecipeCubeOwnership = {
  recipe_id: string;
  instance_id: string;
};

type DeletableProperty = { delete(): void };

let recipeIdProperty: DeletableProperty | null = null;
let recipeInstanceProperty: DeletableProperty | null = null;
let projectRecipeStoreProperty: DeletableProperty | null = null;

function validateIdentity(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(label + " must be a string.");
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(label + " is invalid.");
  }
  return normalized;
}

function staleProperty(
  target: { properties?: Record<string, DeletableProperty> },
  name: string
): DeletableProperty | null {
  return target.properties?.[name] ?? null;
}

export function registerAuthoringRecipeOwnershipProperties(): void {
  if (
    recipeIdProperty ||
    recipeInstanceProperty ||
    projectRecipeStoreProperty
  ) return;
  // A previous hot-reload generation may have registered the same private
  // property before this module state existed. Remove only our namespaced
  // owners, then recreate them under the current plugin generation.
  const cubeTarget = Cube as typeof Cube & {
    properties?: Record<string, DeletableProperty>;
  };
  const projectTarget = ModelProject as typeof ModelProject & {
    properties?: Record<string, DeletableProperty>;
  };
  staleProperty(cubeTarget, RECIPE_ID_PROPERTY)?.delete();
  staleProperty(cubeTarget, RECIPE_INSTANCE_ID_PROPERTY)?.delete();
  staleProperty(
    projectTarget,
    PROJECT_RECIPE_STORE_PROPERTY
  )?.delete();
  recipeIdProperty = new Property(Cube, "string", RECIPE_ID_PROPERTY, {
    default: "",
    export: false,
  }) as unknown as DeletableProperty;
  recipeInstanceProperty = new Property(
    Cube,
    "string",
    RECIPE_INSTANCE_ID_PROPERTY,
    {
      default: "",
      export: false,
    }
  ) as unknown as DeletableProperty;
  projectRecipeStoreProperty = new Property(
    ModelProject,
    "string",
    PROJECT_RECIPE_STORE_PROPERTY,
    {
      default: "",
      export: false,
    }
  ) as unknown as DeletableProperty;
}

export function unregisterAuthoringRecipeOwnershipProperties(): void {
  // Native Property.delete() can fail after Blockbench upgrades. Clear our
  // local ownership first and attempt every release, not only the first one.
  const owned = [
    projectRecipeStoreProperty,
    recipeInstanceProperty,
    recipeIdProperty,
  ];
  projectRecipeStoreProperty = null;
  recipeInstanceProperty = null;
  recipeIdProperty = null;
  for (const property of owned) {
    try {
      property?.delete();
    } catch (error) {
      console.warn("[LazyDesigner] Recipe ownership property cleanup failed", error);
    }
  }
}

export function readAuthoringRecipeCubeOwnership(
  cube: unknown
): AuthoringRecipeCubeOwnership | null {
  if (!cube || typeof cube !== "object" || Array.isArray(cube)) {
    throw new Error("Recipe ownership requires a Cube-like object.");
  }
  const record = cube as Record<string, unknown>;
  const rawRecipe = record[RECIPE_ID_PROPERTY];
  const rawInstance = record[RECIPE_INSTANCE_ID_PROPERTY];
  const recipeEmpty = rawRecipe === undefined || rawRecipe === null || rawRecipe === "";
  const instanceEmpty = rawInstance === undefined || rawInstance === null || rawInstance === "";
  if (recipeEmpty && instanceEmpty) return null;
  if (recipeEmpty !== instanceEmpty) {
    throw new Error("Recipe ownership is incomplete; recipe and instance identity must be authored together.");
  }
  return {
    recipe_id: validateIdentity(rawRecipe, "Recipe ownership recipe_id", 128),
    instance_id: validateIdentity(rawInstance, "Recipe ownership instance_id", 256),
  };
}

export function authoringRecipeOwnershipPatch(
  ownership: AuthoringRecipeCubeOwnership
): Record<string, string> {
  return {
    [RECIPE_ID_PROPERTY]: validateIdentity(ownership.recipe_id, "Recipe ownership recipe_id", 128),
    [RECIPE_INSTANCE_ID_PROPERTY]: validateIdentity(ownership.instance_id, "Recipe ownership instance_id", 256),
  };
}

export function readAuthoringRecipeStoreProperty(
  project: unknown
): unknown {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new Error("Recipe store requires a Project-like object.");
  }
  return (project as Record<string, unknown>)[
    PROJECT_RECIPE_STORE_PROPERTY
  ];
}

export function authoringRecipeStorePropertyPatch(
  serializedStore: string
): Record<string, string> {
  if (typeof serializedStore !== "string") {
    throw new Error("Recipe store property must be serialized text.");
  }
  return {
    [PROJECT_RECIPE_STORE_PROPERTY]: serializedStore,
  };
}
