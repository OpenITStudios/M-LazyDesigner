import {
  isCreateProjectReceipt,
  isPhaseTransitionReceipt,
} from "../../../lib/receipts/authorityTransition";
import {
  isAnimationControllerReceipt,
  isAnimationControllerCompileOnlyResourceReceipt,
} from "../../../lib/receipts/animationController";
import type { CapabilityBranchHint } from "../../capabilities/types";
import { isAnimationEffectsReceipt } from "../../../lib/receipts/animationEffects";
import {
  isBoneRiggingDeletionReceipt,
  isBoneRiggingStateReceipt,
  isNativeIkControllerReceipt,
} from "../../../lib/receipts/boneRigging";
import { isGroupMutationReceipt } from "../../../lib/receipts/groupMutation";
import { isCubeNoChangeReceipt } from "../../../lib/receipts/cubeMutation";
import { isLocatorMutationReceipt } from "../../../lib/receipts/locatorMutation";
import { isMaterialInstanceMutationReceipt } from "../../../lib/receipts/materialInstances";
import {
  isMaterialMutationReceipt,
  isMaterialPersistenceReceipt,
} from "../../../lib/receipts/materialMutation";
import { isVerifiedParticleWriteReceipt } from "../../../lib/receipts/particleMutation";
import { isRenderProfileMutationReceipt } from "../../../lib/receipts/renderProfile";
import { nestedOperationClassForAction } from "../../capabilities/manifest";
import { isTextureGroupReceipt } from "../../../lib/receipts/textureGroup";
import { isRemoveElementReceipt } from "../../../lib/receipts/removeElement";
import { isAppliedRenameElementReceipt } from "../../../lib/receipts/renameElement";

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Select exactly one producer-owned receipt interpretation.
 *
 * A flat structuredContent object is already the canonical payload used by
 * GatewayCapabilityExecutor. For MCP-envelope inputs, structuredContent
 * supersedes outer/display fields; contradictory envelopes must never make
 * one successful "planned" or "complete" candidate win over an applied/unknown
 * authoritative receipt. Missing or malformed inner payload fails closed.
 */
export function resultCandidates(value: unknown): Record<string, unknown>[] {
  const root = record(value);
  if (!root) return [];
  if (Object.prototype.hasOwnProperty.call(root, "structuredContent")) {
    const structured = record(root.structuredContent);
    return structured ? [structured] : [];
  }
  return [root];
}

export function cubeStateNeutral(value: unknown): boolean {
  return resultCandidates(value).some(isCubeNoChangeReceipt);
}

export function locatorReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isLocatorMutationReceipt);
}

export function boneRiggingDeletionReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isBoneRiggingDeletionReceipt);
}

export function boneRiggingStateReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isBoneRiggingStateReceipt);
}

export function nativeIkControllerReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isNativeIkControllerReceipt);
}

export function groupReceiptComplete(capability: string, value: unknown): boolean {
  return resultCandidates(value).some((candidate) =>
    isGroupMutationReceipt(capability, candidate)
  );
}

export function particleTextureHandoffRequired(value: unknown): boolean {
  return resultCandidates(value).some((candidate) => {
    const dependency = record(candidate.texture_dependency);
    return dependency?.status === "REQUIRES_TEXTURING";
  });
}

export function animationTimelineStateNeutral(value: unknown): boolean {
  return resultCandidates(value).some((candidate) => {
    const action = typeof candidate.action === "string" ? candidate.action : null;
    const scope = typeof candidate.scope === "string" ? candidate.scope : null;
    const operationClass =
      action === null
        ? null
        : nestedOperationClassForAction("manage_animation_timeline", action);
    return (
      candidate.changed === false ||
      scope === "timeline_view_only" ||
      scope === "animation_clipboard_only" ||
      operationClass === "QUERY" ||
      operationClass === "CONTROL"
    );
  });
}

export function directAnimationStateNeutral(
  capability: string,
  value: unknown
): boolean {
  return resultCandidates(value).some((candidate) => {
    if (capability === "manage_keyframes") {
      return candidate.action === "select";
    }
    if (capability === "animation_copy_paste") {
      return (
        candidate.action === "copy" &&
        candidate.scope === "animation_clipboard_only"
      );
    }
    return false;
  });
}

export function materialPersistenceReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isMaterialPersistenceReceipt);
}

export function animationControllerResourceStateNeutral(
  value: unknown,
  branch?: CapabilityBranchHint
): boolean {
  // A write:null label must match the requested resource branch; a native
  // controller mutation cannot borrow a compile-only resource receipt.
  if (branch?.field !== "resource_kind") return false;
  return resultCandidates(value).some(
    candidate =>
      candidate.resource_kind === branch.value &&
      isAnimationControllerCompileOnlyResourceReceipt(candidate)
  );
}

export function animationControllerReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isAnimationControllerReceipt);
}

export function textureGroupReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isTextureGroupReceipt);
}

export function materialMutationReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isMaterialMutationReceipt);
}

export function materialInstanceMutationReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isMaterialInstanceMutationReceipt);
}

export function particleMutationReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isVerifiedParticleWriteReceipt);
}

export function removeElementReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isRemoveElementReceipt);
}

export function renderProfileMutationReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isRenderProfileMutationReceipt);
}

export function animationEffectsReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isAnimationEffectsReceipt);
}


export function renameElementReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isAppliedRenameElementReceipt);
}

export function createProjectReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isCreateProjectReceipt);
}

export function phaseTransitionReceiptComplete(value: unknown): boolean {
  return resultCandidates(value).some(isPhaseTransitionReceipt);
}

type ContinuationReceiptValidator = (value: unknown) => boolean;

const CONTINUATION_RECEIPT_VALIDATORS: Readonly<
  Record<string, ContinuationReceiptValidator>
> = {
  create_project: createProjectReceiptComplete,
  switch_authoring_phase: phaseTransitionReceiptComplete,
  manage_animation_effects: animationEffectsReceiptComplete,
  manage_particle: particleMutationReceiptComplete,
  manage_animation_controller: animationControllerReceiptComplete,
  add_texture_group: textureGroupReceiptComplete,
  manage_material: materialMutationReceiptComplete,
  create_pbr_material: materialMutationReceiptComplete,
  configure_material: materialMutationReceiptComplete,
  assign_texture_channel: materialMutationReceiptComplete,
  import_texture_set: materialMutationReceiptComplete,
  save_material_config: materialPersistenceReceiptComplete,
  manage_material_instances: materialInstanceMutationReceiptComplete,
  set_face_material_instance: materialInstanceMutationReceiptComplete,
  bulk_set_material_instances: materialInstanceMutationReceiptComplete,
  clear_material_instances: materialInstanceMutationReceiptComplete,
  manage_render_profile: renderProfileMutationReceiptComplete,
  remove_element: removeElementReceiptComplete,
  rename_element: renameElementReceiptComplete,
  manage_locator: locatorReceiptComplete,
  manage_null_object: locatorReceiptComplete,
  bone_rigging: (value) => {
    // The MCP wrapper contributes exactly one authoritative candidate.
    // Reuse it across the existing independent native/state/deletion guards.
    const candidate = resultCandidates(value)[0];
    return candidate !== undefined && (
      isNativeIkControllerReceipt(candidate) ||
      isBoneRiggingStateReceipt(candidate) ||
      isBoneRiggingDeletionReceipt(candidate)
    );
  },
  add_group: (value) => groupReceiptComplete("add_group", value),
  modify_group: (value) => groupReceiptComplete("modify_group", value),
  reparent_element: (value) => groupReceiptComplete("reparent_element", value),
};

export const CONTINUATION_RECEIPT_CAPABILITIES = Object.freeze(
  Object.keys(CONTINUATION_RECEIPT_VALIDATORS).sort((a, b) =>
    a.localeCompare(b)
  )
);

export function receiptSupportsContinuation(
  capability: string,
  value: unknown
): boolean {
  return CONTINUATION_RECEIPT_VALIDATORS[capability]?.(value) ?? false;
}
