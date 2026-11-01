/// <reference types="blockbench-types" />

export const RECIPE_ID_PROPERTY = "lazydesigner_recipe_id";
export const RECIPE_INSTANCE_ID_PROPERTY = "lazydesigner_recipe_instance_id";
export const PROJECT_RECIPE_STORE_PROPERTY =
  "lazydesigner_authoring_recipe_store";

/**
 * Blockbench's native geometry Undo save does not snapshot arbitrary custom
 * Project properties. Attach the canonical Recipe-store before/after strings
 * to the SAME native history entry; do not maintain a separate undo stack.
 * Symbol.for survives plugin hot reload within the same editor process.
 */
const RECIPE_STORE_UNDO_MARK = Symbol.for("lazydesigner.recipe.store.undo.v1");

export type RecipeStoreUndoMark = Readonly<{
  project_uuid: string;
  recipe_id: string;
  before: string;
  after: string;
}>;

let recipeHistoryListeners: Array<{ delete(): void }> = [];

export function isRecipeStoreUndoSynchronized(): boolean {
  return recipeHistoryListeners.length === 2;
}

export function attachRecipeStoreUndoMark(
  save: object,
  mark: RecipeStoreUndoMark
): void {
  if (!isRecipeStoreUndoSynchronized()) {
    throw new Error("RECIPE_STORE_UNDO_LISTENER_UNAVAILABLE");
  }
  if (!mark.project_uuid || !mark.recipe_id ||
    mark.before === mark.after ||
    typeof mark.before !== "string" || typeof mark.after !== "string" ||
    Object.prototype.hasOwnProperty.call(save, RECIPE_STORE_UNDO_MARK)) {
    throw new Error("RECIPE_STORE_UNDO_MARK_INVALID");
  }
  Object.defineProperty(save, RECIPE_STORE_UNDO_MARK, {
    value: Object.freeze({ ...mark }), configurable: false, enumerable: false,
  });
}

export function readRecipeStoreUndoMark(save: unknown): RecipeStoreUndoMark | null {
  if (!save || typeof save !== "object") return null;
  const mark = (save as Record<PropertyKey, unknown>)[RECIPE_STORE_UNDO_MARK];
  if (!mark || typeof mark !== "object") return null;
  const data = mark as Partial<RecipeStoreUndoMark>;
  if (typeof data.project_uuid !== "string" ||
    typeof data.recipe_id !== "string" ||
    typeof data.before !== "string" ||
    typeof data.after !== "string") return null;
  return data as RecipeStoreUndoMark;
}

function reconcileRecipeStoreHistory(
  direction: "undo" | "redo",
  payload: unknown
): void {
  const entry = (payload as { entry?: { before?: Record<PropertyKey, unknown> } } | null)?.entry;
  const mark = entry?.before?.[RECIPE_STORE_UNDO_MARK] as RecipeStoreUndoMark | undefined;
  if (!mark) return;
  try {
    if (!Project || Project.uuid !== mark.project_uuid) {
      throw new Error("RECIPE_STORE_HISTORY_PROJECT_CHANGED");
    }
    const actual = readAuthoringRecipeStoreProperty(Project);
    const expected = direction === "undo" ? mark.after : mark.before;
    if (actual !== expected) {
      throw new Error("RECIPE_STORE_HISTORY_SOURCE_DRIFT");
    }
    (Project as unknown as Record<string, unknown>)[PROJECT_RECIPE_STORE_PROPERTY] =
      direction === "undo" ? mark.before : mark.after;
  } catch (error) {
    // Blockbench has already applied native geometry Undo/Redo at this point.
    // Never throw into the editor or overwrite unverified Project metadata.
    // The next Recipe plan must refuse the conflicting stored source.
    console.error("[LazyDesigner] Recipe store Undo/Redo synchronization blocked", error);
  }
}

function registerRecipeHistoryListeners(): void {
  if (isRecipeStoreUndoSynchronized()) return;
  const created: Array<{ delete(): void }> = [];
  try {
    created.push(Blockbench.on("undo", event =>
      reconcileRecipeStoreHistory("undo", event)));
    created.push(Blockbench.on("redo", event =>
      reconcileRecipeStoreHistory("redo", event)));
    recipeHistoryListeners = created;
  } catch (error) {
    for (const listener of created) {
      try { listener.delete(); } catch { /* best-effort partial listener cleanup */ }
    }
    recipeHistoryListeners = [];
    throw error;
  }
}

function unregisterRecipeHistoryListeners(): void {
  for (const listener of recipeHistoryListeners.splice(0)) {
    try { listener.delete(); }
    catch (error) {
      console.warn("[LazyDesigner] Recipe history listener cleanup failed", error);
    }
  }
}


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
  ) {
    registerRecipeHistoryListeners();
    return;
  }
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
  registerRecipeHistoryListeners();
}

export function unregisterAuthoringRecipeOwnershipProperties(): void {
  unregisterRecipeHistoryListeners();
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
