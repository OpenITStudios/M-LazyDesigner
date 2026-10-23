import { createHash } from "node:crypto";
import type { AuthoringRecipe, CompiledCubePlacement, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";

export type AuthoringRecipeNativeCubeState = {
  uuid: string;
  recipe_id: string;
  instance_id: string;
  name: string;
  from: RecipeVec3;
  to: RecipeVec3;
  origin: RecipeVec3;
  rotation: RecipeVec3;
  inflate: number;
  /** Root-to-leaf Group UUID ancestry, [] for root; emitted by native adapter.
   * Optional only for legacy pure-state fixtures and compatibility.
   * The recipe's own Cube transforms cannot attest to parent hierarchy.
   */
  parent_path?: string[];
};

export type AuthoringRecipeNativeSnapshot = {
  schema: 1;
  recipe_id: string;
  cubes: AuthoringRecipeNativeCubeState[];
};

function stableSnapshot(snapshot: AuthoringRecipeNativeSnapshot) {
  return {
    ...snapshot,
    cubes: [...snapshot.cubes].sort((a,b) => a.instance_id.localeCompare(b.instance_id)),
  };
}

export function fingerprintAuthoringRecipeNativeSnapshot(snapshot: AuthoringRecipeNativeSnapshot): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(stableSnapshot(snapshot))).digest("hex");
}

function vecEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value,index) => value === right[index]);
}

function placementMatchesState(placement: CompiledCubePlacement, state: AuthoringRecipeNativeCubeState): boolean {
  return state.instance_id === placement.id && state.name === placement.name &&
    vecEqual(state.from, placement.from) && vecEqual(state.to, placement.to) &&
    vecEqual(state.origin, placement.origin) && vecEqual(state.rotation, placement.rotation) &&
    state.inflate === placement.inflate;
}

export function assertAuthoringRecipeNativeMatchesCompiled(
  snapshot: AuthoringRecipeNativeSnapshot,
  recipe: AuthoringRecipe
): void {
  if (snapshot.recipe_id !== recipe.id) {
    throw new Error("RECIPE_NATIVE_STATE_MISMATCH: recipe identity changed.");
  }
  const compiled = compileAuthoringRecipe(recipe);
  const byInstance = new Map(snapshot.cubes.map((cube) => [cube.instance_id, cube]));
  if (byInstance.size !== snapshot.cubes.length) {
    throw new Error("RECIPE_NATIVE_STATE_MISMATCH: duplicate owned instance identity.");
  }
  if (compiled.placements.length !== snapshot.cubes.length) {
    throw new Error("RECIPE_NATIVE_STATE_MISMATCH: owned Cube count differs from compiled recipe.");
  }
  for (const placement of compiled.placements) {
    const state = byInstance.get(placement.id);
    if (!state || state.recipe_id !== recipe.id || !placementMatchesState(placement,state)) {
      throw new Error("RECIPE_NATIVE_STATE_MISMATCH: instance " + placement.id + " differs from compiled recipe.");
    }
  }
}
