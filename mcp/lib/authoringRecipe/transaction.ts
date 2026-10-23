import type { AuthoringRecipe, CompiledCubePlacement } from "@/lib/authoringRecipe/contracts";
import { planIncrementalRecipeRebuild } from "@/lib/authoringRecipe/incremental";
import {
  assertAuthoringRecipeNativeMatchesCompiled,
  fingerprintAuthoringRecipeNativeSnapshot,
  type AuthoringRecipeNativeSnapshot,
} from "@/lib/authoringRecipe/nativeState";

/**
 * Ephemeral native Undo provenance. Its ID is meaningful only while the
 * original Blockbench history entry is still the current top of history.
 */
export type RecipeNativeUndoProvenance = {
  token: string;
  project_uuid: string;
  undo_index: number;
};

export type AuthoringRecipeApplyAdapter = {
  readOwned(recipeId: string): Promise<AuthoringRecipeNativeSnapshot> | AuthoringRecipeNativeSnapshot;
  /** Read-only, all-upsert preflight; must complete before native Undo. */
  preflightUpserts?(
    placements: readonly CompiledCubePlacement[],
    before: AuthoringRecipeNativeSnapshot
  ): Promise<void> | void;
  beginUndo?(affectedInstanceIds: readonly string[]): Promise<void> | void;
  upsert(
    placement: CompiledCubePlacement,
    existingUuid: string | null,
    recipeId: string
  ): Promise<string> | string;
  remove(instanceId: string, uuid: string, recipeId: string): Promise<void> | void;
  restore?(snapshot: AuthoringRecipeNativeSnapshot): Promise<void> | void;
  /**
   * Read-only final native safety check while the same Undo edit is open.
   * May veto an edit; it must never commit, undo or modify geometry.
   */
  verifyBeforeCommit?(context: {
    before: AuthoringRecipeNativeSnapshot;
    after: AuthoringRecipeNativeSnapshot;
    affectedInstanceIds: readonly string[];
  }): Promise<void> | void;
  commitUndo?(binding: {
    recipe_id: string;
    native_source_fingerprint_before: string;
    native_source_fingerprint_after: string;
  }): Promise<RecipeNativeUndoProvenance | void> | RecipeNativeUndoProvenance | void;
  cancelUndo?(): Promise<void> | void;
  /** Exact-top native edit only. Implemented by the Blockbench adapter. */
  revertCommittedUndo?(binding: {
    recipe_id: string;
    provenance: RecipeNativeUndoProvenance;
    native_source_fingerprint_before: string;
    native_source_fingerprint_after: string;
  }): Promise<void> | void;
};

export type AuthoringRecipeApplyReceipt = {
  schema: 1;
  execution: "applied" | "metadata_only" | "unchanged";
  recipe_id: string;
  previous_recipe_fingerprint: string;
  next_recipe_fingerprint: string;
  native_source_fingerprint_before: string;
  native_source_fingerprint_after: string;
  native_undo_provenance?: RecipeNativeUndoProvenance;
  created_instance_ids: string[];
  updated_instance_ids: string[];
  removed_instance_ids: string[];
  preserved_instance_ids: string[];
  metadata_only_instance_ids: string[];
  symmetry_changed_relation_ids: string[];
  affected_count: number;
  recipe_affected_count: number;
  invalidates: {
    geometry_structure: boolean;
    uv_mapping: boolean;
    texture_appearance: boolean;
    animation_motion: boolean;
  };
};

export async function applyAuthoringRecipeIncrementalAtomic(
  previousRecipe: AuthoringRecipe,
  nextRecipe: AuthoringRecipe,
  expectedNativeSourceFingerprint: string,
  adapter: AuthoringRecipeApplyAdapter
): Promise<AuthoringRecipeApplyReceipt> {
  const rebuild = planIncrementalRecipeRebuild(previousRecipe,nextRecipe);
  const before = await adapter.readOwned(previousRecipe.id);
  const actualBeforeFingerprint = fingerprintAuthoringRecipeNativeSnapshot(before);
  if (actualBeforeFingerprint !== expectedNativeSourceFingerprint) {
    throw new Error("STALE_RECIPE_PLAN: native owned state changed after planning.");
  }
  assertAuthoringRecipeNativeMatchesCompiled(before,previousRecipe);

  if (rebuild.metrics.native_affected_count === 0) {
    const semanticChanged =
      rebuild.metadata_only_instance_ids.length > 0 ||
      rebuild.symmetry_changed_relation_ids.length > 0;
    return {
      schema: 1,
      execution: semanticChanged ? "metadata_only" : "unchanged",
      recipe_id: nextRecipe.id,
      previous_recipe_fingerprint: rebuild.previous_recipe_fingerprint,
      next_recipe_fingerprint: rebuild.next_recipe_fingerprint,
      native_source_fingerprint_before: actualBeforeFingerprint,
      native_source_fingerprint_after: actualBeforeFingerprint,
      created_instance_ids: [], updated_instance_ids: [], removed_instance_ids: [],
      preserved_instance_ids: [...rebuild.preserved_instance_ids],
      metadata_only_instance_ids: [...rebuild.metadata_only_instance_ids],
      symmetry_changed_relation_ids: [...rebuild.symmetry_changed_relation_ids],
      affected_count: 0,
      recipe_affected_count: rebuild.metrics.affected_count,
      invalidates: {
        geometry_structure: false,
        uv_mapping: rebuild.semantic_invalidation.uv_mapping,
        texture_appearance:
          rebuild.semantic_invalidation.texture_appearance,
        animation_motion:
          rebuild.semantic_invalidation.animation_motion,
      },
    };
  }

  const beforeByInstance = new Map(before.cubes.map((cube) => [cube.instance_id,cube]));
  const affectedIds = [...new Set([
    ...rebuild.upserts.map((placement) => placement.id),
    ...rebuild.remove_instance_ids,
  ])].sort();
  const created: string[] = [];
  const updated: string[] = [];
  if (adapter.preflightUpserts) {
    await adapter.preflightUpserts(rebuild.upserts, structuredClone(before));
    const checked = await adapter.readOwned(previousRecipe.id);
    if (fingerprintAuthoringRecipeNativeSnapshot(checked) !== actualBeforeFingerprint) {
      throw new Error("RECIPE_PREFLIGHT_STATE_CHANGED: geometry changed before Undo.");
    }
  }
  await adapter.beginUndo?.(affectedIds);
  try {
    for (const instanceId of rebuild.remove_instance_ids) {
      const existing = beforeByInstance.get(instanceId);
      if (!existing) throw new Error("RECIPE_APPLY_PRECONDITION_FAILED: removal target " + instanceId + " is missing.");
      await adapter.remove(instanceId, existing.uuid, previousRecipe.id);
    }
    for (const placement of rebuild.upserts) {
      const existing = beforeByInstance.get(placement.id) ?? null;
      const uuid = await adapter.upsert(placement, existing?.uuid ?? null, nextRecipe.id);
      if (!uuid) throw new Error("RECIPE_APPLY_POSTCONDITION_FAILED: adapter returned empty Cube UUID for " + placement.id + ".");
      (existing ? updated : created).push(placement.id);
    }
    const after = await adapter.readOwned(nextRecipe.id);
    assertAuthoringRecipeNativeMatchesCompiled(after,nextRecipe);
    const afterFingerprint = fingerprintAuthoringRecipeNativeSnapshot(after);
    if (afterFingerprint === actualBeforeFingerprint) {
      throw new Error("RECIPE_APPLY_POSTCONDITION_FAILED: affected transaction did not change native owned state.");
    }
    if (adapter.verifyBeforeCommit) {
      // Pass detached snapshots to the read-only guard and prove that the
      // check did not itself mutate the native model.
      await adapter.verifyBeforeCommit({
        before: structuredClone(before),
        after: structuredClone(after),
        affectedInstanceIds: affectedIds,
      });
      const checked = await adapter.readOwned(nextRecipe.id);
      if (fingerprintAuthoringRecipeNativeSnapshot(checked) !== afterFingerprint) {
        throw new Error(
          "RECIPE_PRECOMMIT_STATE_CHANGED: a verification hook changed the native model."
        );
      }
      assertAuthoringRecipeNativeMatchesCompiled(checked, nextRecipe);
    }
    // Construct the receipt before committing. Commit must be the last
    // potentially stateful operation; nothing may throw after it succeeds.
    const receipt: AuthoringRecipeApplyReceipt = {
      schema: 1, execution: "applied", recipe_id: nextRecipe.id,
      previous_recipe_fingerprint: rebuild.previous_recipe_fingerprint,
      next_recipe_fingerprint: rebuild.next_recipe_fingerprint,
      native_source_fingerprint_before: actualBeforeFingerprint,
      native_source_fingerprint_after: afterFingerprint,
      created_instance_ids: created.sort(),
      updated_instance_ids: updated.sort(),
      removed_instance_ids: [...rebuild.remove_instance_ids],
      preserved_instance_ids: [...rebuild.preserved_instance_ids],
      metadata_only_instance_ids: [...rebuild.metadata_only_instance_ids],
      symmetry_changed_relation_ids: [...rebuild.symmetry_changed_relation_ids],
      affected_count: rebuild.metrics.native_affected_count,
      recipe_affected_count: rebuild.metrics.affected_count,
      invalidates: {
        geometry_structure: true,
        uv_mapping: true,
        texture_appearance: true,
        animation_motion: true,
      },
    };
    const provenance = await adapter.commitUndo?.({
      recipe_id: nextRecipe.id,
      native_source_fingerprint_before: actualBeforeFingerprint,
      native_source_fingerprint_after: afterFingerprint,
    });
    if (provenance) receipt.native_undo_provenance = provenance;
    return receipt;
  } catch (error) {
    // Always attempt cancellation even if a custom restore hook failed.
    // Never use an unscoped Undo.undo(): it could revert unrelated work.
    const rollbackFailures: string[] = [];
    try {
      await adapter.restore?.(before);
    } catch (failure) {
      rollbackFailures.push("restore: " + String(failure));
    }
    try {
      await adapter.cancelUndo?.();
    } catch (failure) {
      rollbackFailures.push("cancel: " + String(failure));
    }
    try {
      const restored = await adapter.readOwned(previousRecipe.id);
      if (fingerprintAuthoringRecipeNativeSnapshot(restored) !== actualBeforeFingerprint) {
        rollbackFailures.push("native state differs from the original recipe snapshot");
      }
    } catch (failure) {
      rollbackFailures.push("readback: " + String(failure));
    }
    if (rollbackFailures.length) {
      throw new Error(
        "RECIPE_APPLY_ROLLBACK_UNVERIFIED: " + rollbackFailures.join("; "),
        { cause: error }
      );
    }
    throw error;
  }
}

/**
 * Explicit post-commit revert for a single receipt from the existing authoring
 * evidence registry. No history search, no guessed Undo index, and no
 * automatic rollback from landmark/visual diagnostics.
 */
export async function revertLastAuthoringRecipeApply(
  receipt: AuthoringRecipeApplyReceipt,
  expectedAfterFingerprint: string,
  adapter: AuthoringRecipeApplyAdapter
): Promise<{
  execution: "reverted";
  recipe_id: string;
  native_source_fingerprint_after_revert: string;
}> {
  if (receipt.execution !== "applied" || !receipt.native_undo_provenance ||
      !adapter.revertCommittedUndo) {
    throw new Error("RECIPE_POSTCOMMIT_UNDO_UNAVAILABLE: no attributable native Undo entry.");
  }
  if (receipt.native_source_fingerprint_after !== expectedAfterFingerprint) {
    throw new Error("RECIPE_POSTCOMMIT_FINGERPRINT_MISMATCH: use the exact apply receipt.");
  }
  const current = await adapter.readOwned(receipt.recipe_id);
  if (fingerprintAuthoringRecipeNativeSnapshot(current) !== expectedAfterFingerprint) {
    throw new Error("RECIPE_POSTCOMMIT_STATE_CHANGED: native recipe state differs after apply.");
  }
  try {
    await adapter.revertCommittedUndo({
      recipe_id: receipt.recipe_id,
      provenance: receipt.native_undo_provenance,
      native_source_fingerprint_before: receipt.native_source_fingerprint_before,
      native_source_fingerprint_after: receipt.native_source_fingerprint_after,
    });
  } catch (error) {
    // Undo may have begun before a native callback failed. Do not issue a
    // second undo automatically or claim the model was restored.
    throw new Error("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED: " + String(error), {
      cause: error,
    });
  }
  // The native Undo may already have run: any readback exception is an
  // uncertain recovery outcome, never an invitation to retry Undo.
  try {
    const after = await adapter.readOwned(receipt.recipe_id);
    if (fingerprintAuthoringRecipeNativeSnapshot(after) !== receipt.native_source_fingerprint_before) {
      throw new Error("native recipe fingerprint did not return to before-state");
    }
  } catch (error) {
    throw new Error("RECIPE_POSTCOMMIT_UNDO_UNVERIFIED: " + String(error), {
      cause: error,
    });
  }
  return {
    execution: "reverted",
    recipe_id: receipt.recipe_id,
    native_source_fingerprint_after_revert: receipt.native_source_fingerprint_before,
  };
}
