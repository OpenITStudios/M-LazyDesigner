/// <reference types="blockbench-types" />

import { randomUUID } from "node:crypto";
import {
  fingerprintAuthoringRecipeNativeSnapshot,
  snapshotRecipeNativeParentHierarchy,
  type RecipeNativeParentGroup,
} from "@/lib/authoringRecipe/nativeState";
import type { RecipeNativeUndoProvenance } from "@/lib/authoringRecipe/transaction";
import type { AuthoringRecipe } from "@/lib/authoringRecipe/contracts";
import {
  findAuthoringRecipeInStore,
  parseAuthoringRecipeStore,
  serializeAuthoringRecipeStore,
  upsertAuthoringRecipeStore,
} from "@/lib/authoringRecipe/store";
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
  readAuthoringRecipeStoreProperty,
  attachRecipeStoreUndoMark,
  readRecipeStoreUndoMark,
  isRecipeStoreUndoSynchronized,
  PROJECT_RECIPE_STORE_PROPERTY,
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
  const parentState = snapshotRecipeNativeParentHierarchy(
    cube.uuid, cube.parent,
    (value): value is RecipeNativeParentGroup =>
      typeof Group !== "undefined" && value instanceof Group
  );
  return {
    uuid: cube.uuid,
    recipe_id: ownership.recipe_id,
    instance_id: ownership.instance_id,
    ...parentState,
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

type PendingRecipeStoreRevision = {
  project_uuid: string;
  before: string;
  after: string;
  previous_recipe: AuthoringRecipe;
  next_recipe: AuthoringRecipe;
};

/** Native ModelProject Property owner, not an independent recipe database. */
function currentProjectRecipeStoreString(): string {
  requireProject();
  const raw = readAuthoringRecipeStoreProperty(Project);
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    throw new Error("RECIPE_STORE_NATIVE_PROPERTY_INVALID");
  }
  return raw;
}

export function createBlockbenchAuthoringRecipeApplyAdapter(recipeId: string): AuthoringRecipeApplyAdapter {
  let pendingStore: PendingRecipeStoreRevision | null = null;
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
    preflightRecipeSource: (previousRecipe, nextRecipe) => {
      requireProject();
      if (!isRecipeStoreUndoSynchronized()) {
        throw new Error("RECIPE_STORE_NATIVE_UNDO_SYNC_UNAVAILABLE");
      }
      if (previousRecipe.id !== recipeId || nextRecipe.id !== recipeId) {
        throw new Error("RECIPE_STORE_RECIPE_ID_MISMATCH");
      }
      const before = currentProjectRecipeStoreString();
      const document = parseAuthoringRecipeStore(before);
      const previousStored = findAuthoringRecipeInStore(document, recipeId);
      if (previousStored === null) {
        // The first adoption may start from an explicitly empty Recipe
        // with no Cuboids, constraints, feature claims or symmetry.
        if (previousRecipe.prototypes.length ||
          previousRecipe.patterns.length ||
          (previousRecipe.feature_intents ?? []).length ||
          (previousRecipe.constraints ?? []).length ||
          (previousRecipe.symmetry ?? []).length ||
          (previousRecipe.knowledge_links ?? []).length) {
          throw new Error("RECIPE_STORE_ADOPTION_EXISTING_SOURCE_REQUIRED");
        }
      } else if (JSON.stringify(previousStored) !== JSON.stringify(previousRecipe)) {
        throw new Error("RECIPE_STORE_SOURCE_CHANGED: re-plan against the saved Recipe.");
      }
      const after = serializeAuthoringRecipeStore(
        upsertAuthoringRecipeStore(document, nextRecipe)
      );
      if (after === before) {
        throw new Error("RECIPE_STORE_SOURCE_NOOP: native mutation has no source revision.");
      }
      pendingStore = {
        project_uuid: Project.uuid,
        before, after,
        previous_recipe: structuredClone(previousRecipe),
        next_recipe: structuredClone(nextRecipe),
      };
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
      if (!pendingStore || !Project || Project.uuid !== pendingStore.project_uuid ||
          currentProjectRecipeStoreString() !== pendingStore.before) {
        throw new Error("RECIPE_STORE_PREFLIGHT_STALE: plan the current source again.");
      }
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
      const store = pendingStore;
      if (!store || store.project_uuid !== Project.uuid ||
        JSON.stringify(store.previous_recipe) !== JSON.stringify(binding.previous_recipe) ||
        JSON.stringify(store.next_recipe) !== JSON.stringify(binding.next_recipe) ||
        currentProjectRecipeStoreString() !== store.before) {
        throw new Error("RECIPE_STORE_COMMIT_SOURCE_STALE");
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
      // Prepare both native geometry Undo provenance and Recipe metadata
      // in the very same Blockbench history entry, never a second stack.
      Object.defineProperty(Undo.current_save as object, RECIPE_UNDO_PROVENANCE, {
        value: provenance, writable: false, configurable: false,
      });
      attachRecipeStoreUndoMark(Undo.current_save as object, {
        project_uuid: store.project_uuid, recipe_id: recipeId,
        before: store.before, after: store.after,
      });
      // Canvas must be updated before the final native commit. Metadata
      // is written after all fallible precommit checks and before finishEdit.
      Canvas.updateAll();
      (Project as unknown as Record<string, unknown>)[PROJECT_RECIPE_STORE_PROPERTY] =
        store.after;
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
      pendingStore = null;
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
      let metadataIssue: Error | null = null;
      if (pendingStore) {
        try {
          const current = currentProjectRecipeStoreString();
          if (current !== pendingStore.before && current !== pendingStore.after) {
            throw new Error("RECIPE_STORE_ROLLBACK_SOURCE_CHANGED");
          }
          if (current === pendingStore.after) {
            (Project as unknown as Record<string, unknown>)[PROJECT_RECIPE_STORE_PROPERTY] =
              pendingStore.before;
          }
        } catch (error) {
          metadataIssue = error instanceof Error ? error : new Error(String(error));
        }
      }
      // Attempt the attributed native cancellation even if Recipe metadata
      // changed unexpectedly. Never erase foreign metadata to force success.
      Undo.cancelEdit(true);
      activeUndoSave = null;
      undoIndexAtBegin = null;
      projectUuidAtBegin = null;
      created = [];
      existingAtBegin = [];
      pendingStore = null;
      Canvas.updateAll();
      if (metadataIssue) throw metadataIssue;
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
      const sourceMark = readRecipeStoreUndoMark(last?.before);
      if (sourceMark && (sourceMark.project_uuid !== Project.uuid ||
        sourceMark.recipe_id !== recipeId ||
        currentProjectRecipeStoreString() !== sourceMark.after)) {
        throw new Error("RECIPE_STORE_UNDO_SOURCE_CHANGED");
      }
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
      if (sourceMark && currentProjectRecipeStoreString() !== sourceMark.before) {
        throw new Error("RECIPE_STORE_UNDO_RESTORE_UNVERIFIED");
      }
      if (Undo.index !== binding.provenance.undo_index - 1 ||
          fingerprintAuthoringRecipeNativeSnapshot(restored) !==
            binding.native_source_fingerprint_before) {
        throw new Error("RECIPE_NATIVE_UNDO_RESTORE_UNVERIFIED: native Undo did not restore original state.");
      }
    },
  };
}
