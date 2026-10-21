import type {
  UvLayoutPlan,
  UvLayoutReceipt,
} from "@/lib/uv/contracts";
import type {
  UvNativeMutationInstruction,
  UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  assertUvNativeInstructionsApplied,
  assertUvPlanSourceFresh,
  fingerprintUvNativeSource,
  translateUvPlanToNativeInstructions,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import { requireValidUvLayoutPlan } from "@/lib/uv/validatePlan";
import { buildUvLayoutReceipt } from "@/lib/uv/receipt";

export type UvApplyAdapter = {
  readSource(): Promise<UvNativeSourceSnapshot> | UvNativeSourceSnapshot;
  apply(
    instructions: readonly UvNativeMutationInstruction[]
  ): Promise<void> | void;
  restore(
    snapshot: UvNativeSourceSnapshot
  ): Promise<void> | void;
  beginUndo?(
    instructions: readonly UvNativeMutationInstruction[]
  ): Promise<void> | void;
  commitUndo?(): Promise<void> | void;
  cancelUndo?(): Promise<void> | void;
};

/**
 * Applied UV mutations must never be silently retried when native rollback or
 * Undo commit cannot be proven. Preserve the original fault and recovery errors.
 */
export class UvTransactionOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true;

  constructor(
    readonly originalFailure: unknown,
    readonly recoveryFailures: readonly unknown[]
  ) {
    const originalMessage = originalFailure instanceof Error
      ? originalFailure.message : String(originalFailure);
    super(
      "UV_OUTCOME_UNKNOWN: " + originalMessage +
      ". Native UV state or Undo history may be partially changed; inspect the " +
      "current project before another mutation.",
      { cause: originalFailure }
    );
    this.name = "UvTransactionOutcomeUnknownError";
  }
}

export async function applyUvLayoutPlanAtomic(
  plan: UvLayoutPlan,
  expectedSourceFingerprint: string,
  adapter: UvApplyAdapter
): Promise<UvLayoutReceipt> {
  requireValidUvLayoutPlan(plan);
  if (plan.moved_island_ids.length === 0) {
    throw new Error(
      "UV_NO_OP_PLAN: a native UV transaction requires at least one changed island."
    );
  }
  const before = await adapter.readSource();
  assertUvPlanSourceFresh(expectedSourceFingerprint, before);
  const instructions = translateUvPlanToNativeInstructions(plan);

  let undoStarted = false;
  let mutationStarted = false;
  let commitStarted = false;
  try {
    // beginUndo is non-mutating by contract. An adapter that partially opens
    // a native Undo edit before throwing must clean it up at its own boundary.
    await adapter.beginUndo?.(instructions);
    undoStarted = true;
    mutationStarted = true;
    await adapter.apply(instructions);
    const after = await adapter.readSource();
    assertUvNativeInstructionsApplied(instructions, after);
    const afterFingerprint = fingerprintUvNativeSource(after);
    if (afterFingerprint === expectedSourceFingerprint && instructions.length > 0) {
      throw new Error(
        "UV_APPLY_POSTCONDITION_FAILED: native UV source fingerprint did not change."
      );
    }
    // Build receipt before the irreversible native Undo-commit boundary.
    const receipt = buildUvLayoutReceipt(
      plan,
      expectedSourceFingerprint,
      afterFingerprint
    );
    commitStarted = true;
    await adapter.commitUndo?.();
    return receipt;
  } catch (error) {
    if (!undoStarted) throw error;

    // A failing finishEdit may have committed an Undo record already. Do not
    // reverse it blindly, cancel an unrelated edit or auto-retry the mutation.
    if (commitStarted) {
      throw new UvTransactionOutcomeUnknownError(error, []);
    }

    const recoveryFailures: unknown[] = [];
    if (mutationStarted) {
      try {
        await adapter.restore(before);
      } catch (restoreError) {
        recoveryFailures.push(restoreError);
      }
    }
    try {
      await adapter.cancelUndo?.();
    } catch (cancelError) {
      recoveryFailures.push(cancelError);
    }
    if (mutationStarted) {
      // Both native restore and cancelEdit may affect UV bytes. Confirm the
      // fingerprint only after the full cleanup sequence is complete.
      try {
        const restored = await adapter.readSource();
        if (fingerprintUvNativeSource(restored) !== expectedSourceFingerprint) {
          throw new Error("UV_ROLLBACK_MISMATCH: native UV source did not return to the saved snapshot.");
        }
      } catch (verificationError) {
        recoveryFailures.push(verificationError);
      }
    }

    if (recoveryFailures.length > 0) {
      throw new UvTransactionOutcomeUnknownError(error, recoveryFailures);
    }
    throw error;
  }
}
