import { createHash } from "node:crypto";
import type { AuthoringRecipe, CompiledCubePlacement, RecipeVec3 } from "@/lib/authoringRecipe/contracts";
import { compileAuthoringRecipe } from "@/lib/authoringRecipe/compiler";

/** Authored ancestor Group state, not a sampled animation pose or new registry. */
export type RecipeParentAuthoredState = {
  uuid: string;
  name: string;
  origin: RecipeVec3;
  rotation: RecipeVec3;
  visibility: boolean;
  export: boolean;
  mirror_uv: boolean;
  reset: boolean;
  bedrock_binding: string | null;
};

export type RecipeNativeParentGroup = {
  uuid: string;
  name: string;
  origin: readonly number[];
  rotation: readonly number[];
  parent?: unknown;
  visibility?: boolean;
  export?: boolean;
  mirror_uv?: boolean;
  reset?: boolean;
  bedrock_binding?: string | null;
};

function parentVec3(value: unknown, label: string): RecipeVec3 {
  if (!Array.isArray(value) || value.length !== 3 ||
      value.some((coordinate) => typeof coordinate !== "number" ||
        !Number.isFinite(coordinate))) {
    throw new Error("RECIPE_NATIVE_PARENT_TRANSFORM_INVALID: " + label +
      " requires exactly three finite coordinates.");
  }
  return [value[0], value[1], value[2]];
}

/** Single bounded pure owner of parent identity AND authored transforms. */
export function snapshotRecipeNativeParentHierarchy(
  cubeUuid: string,
  parent: unknown,
  isNativeGroup: (value: unknown) => value is RecipeNativeParentGroup
): { parent_path: string[]; parent_authored_state: RecipeParentAuthoredState[] } {
  if (parent === "root") return { parent_path: [], parent_authored_state: [] };
  const visited = new Set<object>();
  const ids = new Set<string>();
  const states: RecipeParentAuthoredState[] = [];
  let current = parent;
  for (let depth = 0; depth < 64; depth++) {
    if (!isNativeGroup(current) || visited.has(current)) {
      throw new Error("RECIPE_NATIVE_PARENT_UNKNOWN: Cube " + cubeUuid +
        " has invalid or cyclic Group ancestry.");
    }
    const group = current;
    if (typeof group.uuid !== "string" || !group.uuid.trim() ||
        ids.has(group.uuid) || typeof group.name !== "string" ||
        !group.name.trim()) {
      throw new Error("RECIPE_NATIVE_PARENT_UNKNOWN: Cube " + cubeUuid +
        " has a duplicate or invalid Group identity.");
    }
    visited.add(group);
    ids.add(group.uuid);
    states.push({
      uuid: group.uuid,
      name: group.name,
      origin: parentVec3(group.origin, "Group " + group.uuid + " origin"),
      rotation: parentVec3(group.rotation, "Group " + group.uuid + " rotation"),
      visibility: group.visibility !== false,
      export: group.export !== false,
      mirror_uv: group.mirror_uv === true,
      reset: group.reset === true,
      bedrock_binding: typeof group.bedrock_binding === "string" &&
        group.bedrock_binding !== "" ? group.bedrock_binding : null,
    });
    if (group.parent === "root" || group.parent === null ||
        group.parent === undefined) {
      const rootToLeaf = states.reverse();
      return {
        parent_path: rootToLeaf.map((entry) => entry.uuid),
        parent_authored_state: rootToLeaf,
      };
    }
    current = group.parent;
  }
  throw new Error("RECIPE_NATIVE_PARENT_UNKNOWN: Cube " + cubeUuid +
    " exceeds the 64-Group traversal limit.");
}

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
  /** Native adapter emits this; optional only for legacy pure-state fixtures. */
  parent_authored_state?: RecipeParentAuthoredState[];
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
