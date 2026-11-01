import { createHash } from "node:crypto";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";
import { advancedGeometryFeatureSchema } from "@/lib/authoringRecipe/geometrySchema";

export const AUTHORING_RECIPE_STORE_SCHEMA = 1 as const;
export const AUTHORING_RECIPE_STORE_MAX_RECIPES = 64;
export const AUTHORING_RECIPE_STORE_MAX_BYTES = 262_144;

export type AuthoringRecipeStoreDocument = {
  schema: typeof AUTHORING_RECIPE_STORE_SCHEMA;
  recipes: AuthoringRecipe[];
};

export function emptyAuthoringRecipeStore(): AuthoringRecipeStoreDocument {
  return { schema: AUTHORING_RECIPE_STORE_SCHEMA, recipes: [] };
}

function validateStore(document: AuthoringRecipeStoreDocument): AuthoringRecipeStoreDocument {
  if (document.schema !== AUTHORING_RECIPE_STORE_SCHEMA) throw new Error("Unsupported authoring recipe store schema.");
  if (!Array.isArray(document.recipes) || document.recipes.length > AUTHORING_RECIPE_STORE_MAX_RECIPES) {
    throw new Error("Authoring recipe store exceeds the bounded recipe count.");
  }
  const ids = document.recipes.map((recipe) => recipe.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("Authoring recipe store requires unique non-empty recipe IDs.");
  }
  for (const recipe of document.recipes) {
    compileAuthoringRecipe(recipe);
    if (recipe.advanced_geometry_source !== undefined) {
      const sources = recipe.advanced_geometry_source;
      if (!recipe.id.startsWith("advgeo:") || !Array.isArray(sources) ||
        sources.length < 1 || sources.length > 8) {
        throw new Error("RECIPE_ADVANCED_SOURCE_SCOPE_INVALID");
      }
      const ids = new Set<string>();
      const namedFeatures = new Set((recipe.feature_intents ?? []).map(entry => entry.id));
      const patternOwners = new Set(recipe.patterns.map(entry => entry.feature_id));
      for (const source of sources) {
        const parsed = advancedGeometryFeatureSchema.safeParse(source);
        if (!parsed.success ||
          ids.has(parsed.data?.id ?? "") ||
          !namedFeatures.has(parsed.data!.id) ||
          !patternOwners.has(parsed.data!.id) ||
          parsed.data!.replace_generated === true) {
          throw new Error("RECIPE_ADVANCED_SOURCE_INVALID: every source must own an existing 3D feature and native Recipe pattern.");
        }
        ids.add(parsed.data!.id);
      }
    }
  }
  return {
    schema: AUTHORING_RECIPE_STORE_SCHEMA,
    recipes: [...document.recipes]
      .map((recipe) => structuredClone(recipe))
      .sort((a,b) => a.id.localeCompare(b.id)),
  };
}

export function serializeAuthoringRecipeStore(document: AuthoringRecipeStoreDocument): string {
  const normalized = validateStore(document);
  const serialized = JSON.stringify(normalized);
  const bytes = new TextEncoder().encode(serialized).length;
  if (bytes > AUTHORING_RECIPE_STORE_MAX_BYTES) {
    throw new Error("Authoring recipe store exceeds the bounded serialized size.");
  }
  return serialized;
}

export function parseAuthoringRecipeStore(value: unknown): AuthoringRecipeStoreDocument {
  if (value === undefined || value === null || value === "") return emptyAuthoringRecipeStore();
  if (typeof value !== "string") throw new Error("Authoring recipe store must be a serialized string.");
  if (new TextEncoder().encode(value).length > AUTHORING_RECIPE_STORE_MAX_BYTES) {
    throw new Error("Authoring recipe store exceeds the bounded serialized size.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("Authoring recipe store contains invalid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Authoring recipe store document must be an object.");
  return validateStore(parsed as AuthoringRecipeStoreDocument);
}

export function upsertAuthoringRecipeStore(
  document: AuthoringRecipeStoreDocument,
  recipe: AuthoringRecipe
): AuthoringRecipeStoreDocument {
  compileAuthoringRecipe(recipe);
  const recipes = document.recipes.filter((candidate) => candidate.id !== recipe.id);
  recipes.push(structuredClone(recipe));
  const next = validateStore({ schema: AUTHORING_RECIPE_STORE_SCHEMA, recipes });
  serializeAuthoringRecipeStore(next);
  return next;
}

export function removeAuthoringRecipeFromStore(
  document: AuthoringRecipeStoreDocument,
  recipeId: string
): AuthoringRecipeStoreDocument {
  const next = validateStore({
    schema: AUTHORING_RECIPE_STORE_SCHEMA,
    recipes: document.recipes.filter((recipe) => recipe.id !== recipeId),
  });
  serializeAuthoringRecipeStore(next);
  return next;
}

export function findAuthoringRecipeInStore(
  document: AuthoringRecipeStoreDocument,
  recipeId: string
): AuthoringRecipe | null {
  const recipe = document.recipes.find((candidate) => candidate.id === recipeId);
  return recipe ? structuredClone(recipe) : null;
}

export function fingerprintAuthoringRecipeStore(document: AuthoringRecipeStoreDocument): string {
  return "sha256:" + createHash("sha256").update(serializeAuthoringRecipeStore(document)).digest("hex");
}
