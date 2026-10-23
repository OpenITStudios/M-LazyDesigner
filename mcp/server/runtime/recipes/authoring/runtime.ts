/// <reference types="blockbench-types" />

import { randomUUID } from "node:crypto";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";
import type { RecipeNativeUndoProvenance } from "@/lib/authoringRecipe/transaction";
import type { CompiledCubePlacement } from "@/lib/authoringRecipe/contracts";
import type { AuthoringRecipeApplyAdapter } from "@/lib/authoringRecipe/transaction";
import {
  requireBoxUvRepresentableSpan,
  validateCubeGeometrySpan,
} from "@/lib/geometry/cubeSpan";
import type { AuthoringRecipeNativeSnapshot } from "@/lib/authoringRecipe/nativeState";
import {
  authoringRecipeOwnershipPatch,
  readAuthoringRecipeCubeOwnership,
} from "./ownership";

/**
 * Private attestation carried by Blockbench's original UndoSystem.save object.
 * Upstream Blockbench 5.2.1 stores that same object as history-entry.before.
 * No separate history, registry, or mutable global map is created.
 */
const RECIPE_UNDO_PROVENANCE = Symbol("lazydesigner.recipe.nativeUndo");

type NativeUndoMark = {
  token: string;
  recipe_id: string;
  project_uuid: string;
  native_source_fingerprint_before: string;
  native_source_fingerprint_after: string;
};

type MarkedUndoEntry = {
  action?: string;
  before?: { [RECIPE_UNDO_PROVENANCE]?: NativeUndoMark };
};

function requireProject(): void {
  if (!Project) throw new Error("Parametric recipe apply requires an open Blockbench project.");
}

function recipeOwnedCubes(recipeId: string): Cube[] {
  requireProject();
  const owned: Cube[] = [];
  const seen = new Set<string>();
  for (const cube of Cube.all ?? []) {
    const ownership = readAuthoringRecipeCubeOwnership(cube);
    if (!ownership || ownership.recipe_id !== recipeId) continue;
    if (seen.has(ownership.instance_id)) {
      throw new Error("Duplicate parametric recipe ownership for instance " + ownership.instance_id + ".");
    }
    seen.add(ownership.instance_id);
    owned.push(cube);
  }
  return owned;
}

function cubeState(cube: Cube, recipeId: string) {
  const ownership = readAuthoringRecipeCubeOwnership(cube);
  if (!ownership || ownership.recipe_id !== recipeId) {
    throw new Error("Cube " + cube.uuid + " is not owned by recipe " + recipeId + ".");
  }
  return {
    uuid: cube.uuid,
    recipe_id: ownership.recipe_id,
    instance_id: ownership.instance_id,
    name: cube.name,
    from: [...cube.from] as [number,number,number],
    to: [...cube.to] as [number,number,number],
    origin: [...cube.origin] as [number,number,number],
    rotation: [...cube.rotation] as [number,number,number],
    inflate: cube.inflate ?? 0,
  };
}

export function readBlockbenchAuthoringRecipeOwnedState(recipeId: string): AuthoringRecipeNativeSnapshot {
  return {
    schema: 1,
    recipe_id: recipeId,
    cubes: recipeOwnedCubes(recipeId)
      .map((cube) => cubeState(cube,recipeId))
      .sort((a,b) => a.instance_id.localeCompare(b.instance_id)),
  };
}

function resolveOwnedCube(recipeId: string, instanceId: string, uuid: string): Cube {
  const cube = (Cube.all ?? []).find((candidate: Cube) => candidate.uuid === uuid);
  if (!cube) throw new Error("Recipe-owned Cube UUID " + uuid + " is missing.");
  const ownership = readAuthoringRecipeCubeOwnership(cube);
  if (!ownership || ownership.recipe_id !== recipeId || ownership.instance_id !== instanceId) {
    throw new Error("Recipe-owned Cube identity changed for " + instanceId + ".");
  }
  return cube;
}

function extendPlacement(cube: Cube, placement: CompiledCubePlacement, recipeId: string): void {
  cube.extend({
    name: placement.name,
    from: [...placement.from] as [number,number,number],
    to: [...placement.to] as [number,number,number],
    origin: [...placement.origin] as [number,number,number],
    rotation: [...placement.rotation] as [number,number,number],
    inflate: placement.inflate,
    ...authoringRecipeOwnershipPatch({ recipe_id: recipeId, instance_id: placement.id }),
  } as any);
}

export function createBlockbenchAuthoringRecipeApplyAdapter(recipeId: string): AuthoringRecipeApplyAdapter {
  let created: Cube[] = [];
  let existingAtBegin: Cube[] = [];
  let activeUndoSave: unknown | null = null;
  let undoIndexAtBegin: number | null = null;
  let projectUuidAtBegin: string | null = null;
  const requireOwnedUndo = () => {
    if (!activeUndoSave || Undo.current_save !== activeUndoSave ||
        undoIndexAtBegin === null || Undo.index !== undoIndexAtBegin ||
        !Project || Project.uuid !== projectUuidAtBegin) {
      throw new Error(
        "RECIPE_NATIVE_UNDO_OWNERSHIP_LOST: another editor operation changed the active Undo transaction."
      );
    }
  };
  return {
    readOwned: (requestedRecipeId) => {
      if (requestedRecipeId !== recipeId) throw new Error("Parametric recipe adapter recipe identity mismatch.");
      return readBlockbenchAuthoringRecipeOwnedState(recipeId);
    },
    preflightUpserts: (placements, before) => {
      const byInstance = new Map(before.cubes.map((cube) => [cube.instance_id, cube]));
      for (const placement of placements) {
        validateCubeGeometrySpan(
          placement.from, placement.to, placement.inflate,
          `Recipe Cube ${placement.name} (${placement.id})`
        );
        const old = byInstance.get(placement.id);
        const existing = old
          ? resolveOwnedCube(recipeId, placement.id, old.uuid)
          : null;
        const usesBoxUv = existing
          ? existing.box_uv === true
          : Project?.box_uv === true;
        if (!usesBoxUv) continue;
        requireBoxUvRepresentableSpan(
          placement.from, placement.to,
          `Recipe Cube ${placement.name} (${placement.id})`,
          old ? { from: old.from, to: old.to } : undefined
        );
      }
    },
    beginUndo: (affectedInstanceIds) => {
      if (Undo.current_save) throw new Error("Finish the current Blockbench edit before applying a parametric recipe.");
      created = [];
      const affected = new Set(affectedInstanceIds);
      const existing = recipeOwnedCubes(recipeId).filter((cube) => {
        const ownership = readAuthoringRecipeCubeOwnership(cube)!;
        return affected.has(ownership.instance_id);
      });
      existingAtBegin = existing;
      const undoIndex = Undo.index;
      projectUuidAtBegin = Project.uuid;
      Undo.initEdit({
        elements: existing,
        outliner: true,
        collections: [],
      });
      activeUndoSave = Undo.current_save ?? null;
      undoIndexAtBegin = undoIndex;
      requireOwnedUndo();
    },
    upsert: (placement, existingUuid, requestedRecipeId) => {
      if (requestedRecipeId !== recipeId) throw new Error("Parametric recipe upsert identity mismatch.");
      if (existingUuid) {
        const cube = resolveOwnedCube(recipeId, placement.id, existingUuid);
        extendPlacement(cube,placement,recipeId);
        return cube.uuid;
      }
      if (recipeOwnedCubes(recipeId).some((cube) => readAuthoringRecipeCubeOwnership(cube)?.instance_id === placement.id)) {
        throw new Error("Parametric recipe create target already exists: " + placement.id + ".");
      }
      const cube = new Cube({
        autouv: 1,
        name: placement.name,
        from: [...placement.from] as [number,number,number],
        to: [...placement.to] as [number,number,number],
        origin: [...placement.origin] as [number,number,number],
        rotation: [...placement.rotation] as [number,number,number],
        inflate: placement.inflate,
      }).init();
      cube.addTo("root");
      extendPlacement(cube,placement,recipeId);
      cube.mapAutoUV();
      created.push(cube);
      return cube.uuid;
    },
    remove: (instanceId, uuid, requestedRecipeId) => {
      if (requestedRecipeId !== recipeId) throw new Error("Parametric recipe removal identity mismatch.");
      resolveOwnedCube(recipeId,instanceId,uuid).remove();
    },
    verifyBeforeCommit: ({ affectedInstanceIds }) => {
      requireOwnedUndo();
      // Verify all newly authored cubes still exist and carry exact recipe
      // ownership. This does not substitute for reference-image visual QA.
      const affected = new Set(affectedInstanceIds);
      for (const cube of created) {
        if (!(Cube.all ?? []).includes(cube)) {
          throw new Error("RECIPE_NATIVE_PRECOMMIT_MISSING_CUBE: " + cube.uuid);
        }
        const owner = readAuthoringRecipeCubeOwnership(cube);
        if (!owner || owner.recipe_id !== recipeId ||
            !affected.has(owner.instance_id)) {
          throw new Error("RECIPE_NATIVE_PRECOMMIT_OWNERSHIP_MISMATCH: " + cube.uuid);
        }
      }
    },
    commitUndo: (binding) => {
      requireOwnedUndo();
      if (binding.recipe_id !== recipeId) {
        throw new Error("RECIPE_NATIVE_UNDO_RECIPE_MISMATCH");
      }
      const actualAfter = fingerprintAuthoringRecipeNativeSnapshot(
        readBlockbenchAuthoringRecipeOwnedState(recipeId)
      );
      if (actualAfter !== binding.native_source_fingerprint_after) {
        throw new Error("RECIPE_NATIVE_UNDO_STATE_CHANGED");
      }
      const token = randomUUID();
      const provenance: NativeUndoMark = {
        token,
        recipe_id: recipeId,
        project_uuid: projectUuidAtBegin!,
        native_source_fingerprint_before: binding.native_source_fingerprint_before,
        native_source_fingerprint_after: binding.native_source_fingerprint_after,
      };
      // Stamp the live BEFORE save *before* finishEdit. This is the exact
      // object Blockbench places in history[index].before on native commit;
      // nothing needs to mutate or throw after finishEdit succeeds.
      Object.defineProperty(Undo.current_save as object, RECIPE_UNDO_PROVENANCE, {
        value: provenance, writable: false, configurable: false,
      });
      // Update dependent rendered state *before* committing the native edit.
      // After finishEdit succeeds we must not risk another throwing operation.
      Canvas.updateAll();
      // UndoSystem.save.load() removes elements present in the opposite
      // snapshot but not this one. Include surviving updated Cubes and new
      // Cubes in the post-save; omit deleted Cubes so redo removes them.
      // Outliner is recorded in both directions for create/remove ordering.
      const surviving = existingAtBegin.filter((cube) =>
        (Cube.all ?? []).includes(cube)
      );
      Undo.finishEdit("LazyDesigner parametric recipe", {
        elements: [...surviving, ...created],
        outliner: true,
        collections: [],
      });
      activeUndoSave = null;
      undoIndexAtBegin = null;
      projectUuidAtBegin = null;
      created = [];
      existingAtBegin = [];
      return {
        token,
        project_uuid: provenance.project_uuid,
        undo_index: Undo.index,
      } satisfies RecipeNativeUndoProvenance;
    },
    cancelUndo: () => {
      // Native Blockbench 5.2 cancelEdit(true) replays this transaction's
      // before-save. Do NOT cancel another tool's active edit.
      requireOwnedUndo();
      Undo.cancelEdit(true);
      activeUndoSave = null;
      undoIndexAtBegin = null;
      projectUuidAtBegin = null;
      created = [];
      existingAtBegin = [];
      Canvas.updateAll();
    },
    revertCommittedUndo: (binding) => {
      requireProject();
      if (binding.recipe_id !== recipeId ||
          Project.uuid !== binding.provenance.project_uuid ||
          Undo.current_save ||
          Undo.index !== Undo.history.length ||
          Undo.index !== binding.provenance.undo_index ||
          Undo.index < 1) {
        throw new Error("RECIPE_NATIVE_UNDO_NOT_TOP: refusing an intervening or unrelated edit.");
      }
      const last = Undo.history[Undo.index - 1] as MarkedUndoEntry | undefined;
      const mark = last?.before?.[RECIPE_UNDO_PROVENANCE];
      if (last?.action !== "LazyDesigner parametric recipe" || !mark ||
          mark.token !== binding.provenance.token ||
          mark.recipe_id !== recipeId ||
          mark.project_uuid !== Project.uuid ||
          mark.native_source_fingerprint_before !== binding.native_source_fingerprint_before ||
          mark.native_source_fingerprint_after !== binding.native_source_fingerprint_after) {
        throw new Error("RECIPE_NATIVE_UNDO_IDENTITY_MISMATCH: top history entry is not this apply.");
      }
      // Last-chance synchronous recheck: no await between validation and undo.
      const current = readBlockbenchAuthoringRecipeOwnedState(recipeId);
      if (fingerprintAuthoringRecipeNativeSnapshot(current) !==
          binding.native_source_fingerprint_after) {
        throw new Error("RECIPE_NATIVE_UNDO_STATE_CHANGED: model differs from the committed recipe.");
      }
      Undo.undo();
      const restored = readBlockbenchAuthoringRecipeOwnedState(recipeId);
      if (Undo.index !== binding.provenance.undo_index - 1 ||
          fingerprintAuthoringRecipeNativeSnapshot(restored) !==
            binding.native_source_fingerprint_before) {
        throw new Error("RECIPE_NATIVE_UNDO_RESTORE_UNVERIFIED: native Undo did not restore original state.");
      }
    },
  };
}
