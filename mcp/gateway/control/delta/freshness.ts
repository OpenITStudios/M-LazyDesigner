import {
  capabilityDefaultStaleScopes,
} from "../../../lib/capabilities/manifest";
import { assetDomainsForScopes } from "../../../lib/authoring/assetDependencyGraph";
import { isSemanticHistoryEffect } from "../../../lib/authoring/semanticHistory";
import {
  cubeChangedFieldsFromResult,
  cubeSemanticScopesFromChangedFields,
} from "../../../lib/receipts/cubeMutation";
import {
  removedElementSemanticScopes,
  renamedElementSemanticScopes,
} from "../../../lib/authoring/elementSemanticScopes";
import { modifyGroupReceiptSchema } from "../../../lib/receipts/groupMutation";
import { removeElementReceiptSchema } from "../../../lib/receipts/removeElement";
import { renameElementReceiptSchema } from "../../../lib/receipts/renameElement";
import type {
  ControlAuthoringDomain,
  ControlDelta,
  ControlFreshnessScope,
} from "../types";
import {
  ALL_FRESHNESS_SCOPES,
  STATE_MUTATIONS,
} from "./policy";
import { manifestEntryForBranch } from "../../capabilities/manifest";
import type { CapabilityBranchHint } from "../../capabilities/types";
import { isRenderProfileNoWriteReceipt } from "../../../lib/receipts/renderProfile";
import {
  record,
  authoritativeReceipt,
  cubeStateNeutral,
  particleTextureHandoffRequired,
  animationTimelineStateNeutral,
  animationControllerResourceStateNeutral,
  directAnimationStateNeutral,
  materialPersistenceReceiptComplete,
} from "./receipts";

export function particleHasAuthoredEffect(value: unknown): boolean {
  const candidate = authoritativeReceipt(value);
  // Missing/partial native write evidence must never establish a no-op.
  if (!candidate ||
      !Object.prototype.hasOwnProperty.call(candidate, "wrote_to_path") ||
      !Object.prototype.hasOwnProperty.call(candidate, "preview_path")) return true;

  const wroteToPath = candidate.wrote_to_path;
  const previewPath = candidate.preview_path;
  return (
    (typeof wroteToPath === "string" && wroteToPath.length > 0) ||
    (typeof previewPath === "string" && previewPath.length > 0)
  );
}

export function renderProfileStateNeutral(
  value: unknown,
  branch?: CapabilityBranchHint
): boolean {
  // The requested operation, not the receipt label alone, owns no-write.
  if (branch?.field !== "operation") return false;
  const candidate = authoritativeReceipt(value);
  return candidate !== null &&
    candidate.operation === branch.value &&
    isRenderProfileNoWriteReceipt(candidate);
}

export function textureLayerMetadataOnly(value: unknown): boolean {
  const candidate = authoritativeReceipt(value);
  return candidate !== null &&
    (candidate.operation === "rename_layer" ||
      (candidate.operation === "batch_metadata" &&
        candidate.recomposed === false));
}

export function renameElementStateNeutral(value: unknown): boolean {
  const candidate = authoritativeReceipt(value);
  if (!candidate) return false;
  const parsed = renameElementReceiptSchema.safeParse(candidate);
  return parsed.success &&
    (parsed.data.execution === "planned" ||
      parsed.data.execution === "unchanged");
}

function semanticHistoryEffectFromResult(result: unknown): {
  stale: ControlFreshnessScope[];
  workspace_projection: boolean;
  acceptance_gates: boolean;
} | null {
  const candidate = authoritativeReceipt(result);
  if (!candidate) return null;
  // Read only once: return the same history value that passed validation.
  const semanticEffect = candidate.semantic_effect;
  return isSemanticHistoryEffect(semanticEffect) ? semanticEffect : null;
}

/**
 * Only the direct save tool or the consolidated save branch can use file
 * persistence evidence to declare an authoring-state no-op. A successful
 * configure/create/assign call with an unrelated save-shaped payload is
 * not evidence that its authored material state was unchanged.
 */
function isMaterialPersistenceOnly(
  capability: string,
  result: unknown,
  branch?: CapabilityBranchHint
): boolean {
  if (capability === "save_material_config") {
    return materialPersistenceReceiptComplete(result);
  }
  return capability === "manage_material" &&
    branch?.field === "operation" &&
    branch.value === "save" &&
    materialPersistenceReceiptComplete(result);
}

export function capabilityMutatesState(
  capability: string,
  succeeded: boolean,
  result: unknown,
  branch?: CapabilityBranchHint,
  receiptFacts?: Pick<
    MutationEvidenceAnalysis,
    "materialPersistenceOnly" | "textureLayerMetadataOnly" |
    "particleTextureHandoff" | "historyEffect" |
    "animationControllerResourceNeutral"
  >
): boolean {
  if (!succeeded || !STATE_MUTATIONS.has(capability)) return false;
  const branchOperationClass =
    manifestEntryForBranch(capability, branch)?.operationClass;
  if (
    branchOperationClass &&
    branchOperationClass !== "MUTATION"
  ) {
    return false;
  }
  if (capability === "undo" || capability === "redo") {
    const semanticEffect = receiptFacts?.historyEffect === undefined
      ? semanticHistoryEffectFromResult(result)
      : receiptFacts.historyEffect;
    if (semanticEffect && semanticEffect.stale.length === 0) return false;
  }
  // The native simplify branch alone produces planned/unchanged Cube previews.
  // A preview-shaped receipt for another operation cannot preserve evidence.
  if (
    capability === "manage_cubes" &&
    branch?.field === "operation" &&
    branch.value === "simplify" &&
    cubeStateNeutral(result)
  ) return false;
  if (capability === "rename_element" && renameElementStateNeutral(result)) return false;
  if (
    capability === "texture_layer_management" &&
    (receiptFacts?.textureLayerMetadataOnly ?? textureLayerMetadataOnly(result))
  ) {
    return false;
  }
  if (capability === "manage_particle") {
    if (receiptFacts?.particleTextureHandoff ??
      particleTextureHandoffRequired(result)) return false;
    return particleHasAuthoredEffect(result);
  }
  if (
    capability === "manage_animation_timeline" ||
    capability === "animation_timeline"
  ) {
    return !animationTimelineStateNeutral(result);
  }
  if (
    capability === "manage_animation_controller" &&
    (receiptFacts?.animationControllerResourceNeutral ??
      animationControllerResourceStateNeutral(result, branch))
  ) {
    return false;
  }
  if (
    (capability === "manage_keyframes" ||
      capability === "animation_copy_paste") &&
    directAnimationStateNeutral(capability, result)
  ) {
    return false;
  }
  if (receiptFacts?.materialPersistenceOnly ??
    isMaterialPersistenceOnly(capability, result, branch)) return false;
  if (capability === "manage_render_profile") {
    return !renderProfileStateNeutral(result, branch);
  }
  return true;
}

export function effectChangedFields(value: unknown): string[] {
  const authoritative = authoritativeReceipt(value);
  return authoritative ? cubeChangedFieldsFromResult(authoritative) : [];
}

export type MutationEvidenceAnalysis = Readonly<{
  mutates: boolean;
  geometryScopes?: ReturnType<typeof geometryFreshnessScopes>;
  /** Receipt classifications derived once per invocation (not a cross-call cache). */
  materialPersistenceOnly?: boolean;
  textureLayerMetadataOnly?: boolean;
  particleTextureHandoff?: boolean;
  historyEffect?: ReturnType<typeof semanticHistoryEffectFromResult>;
  animationControllerResourceNeutral?: boolean;
}>;

export function geometryInvalidation(
  capability: string,
  result: unknown,
  geometryScopes?: ReturnType<typeof geometryFreshnessScopes>
): ControlAuthoringDomain[] {
  // The request-local analysis already derived this scope for freshness.
  // Preserve the historical default invalidation on incomplete Cube receipts.
  if (geometryScopes) {
    if (capability === "manage_cubes") {
      return assetDomainsForScopes(
        geometryScopes.precise
          ? geometryScopes.stale
          : capabilityDefaultStaleScopes(capability)
      );
    }
    if (
      capability === "modify_group" ||
      capability === "remove_element" ||
      capability === "rename_element"
    ) {
      return assetDomainsForScopes(geometryScopes.stale);
    }
  }
  if (capability === "manage_cubes") {
    const changedFields = effectChangedFields(result);
    const scopes =
      changedFields.length > 0
        ? cubeSemanticScopesFromChangedFields(changedFields)
        : capabilityDefaultStaleScopes(capability);
    return assetDomainsForScopes(scopes);
  }

  if (capability === "modify_group") {
    // One receipt parser decides both domain and freshness precision.
    return assetDomainsForScopes(geometryFreshnessScopes(capability, result).stale);
  }

  if (capability === "remove_element" || capability === "rename_element") {
    // Use the same receipt-scoped facts as freshness/verification. A remove
    // or rename need not invalidate Animation or mapped Texturing when its
    // authoritative receipt proves those dependencies were untouched.
    return assetDomainsForScopes(geometryFreshnessScopes(capability, result).stale);
  }

  const scopes = capabilityDefaultStaleScopes(capability);
  return scopes.length > 0
    ? assetDomainsForScopes(scopes)
    : ["GEOMETRY"];
}

function semanticHistoryInvalidation(
  result: unknown,
  preparedEffect?: ReturnType<typeof semanticHistoryEffectFromResult>
): {
  authoring_domains: ControlAuthoringDomain[];
  workspace_projection: boolean;
  acceptance_gates: boolean;
} | null {
  const effect = preparedEffect === undefined
    ? semanticHistoryEffectFromResult(result)
    : preparedEffect;
  if (!effect) return null;

  return {
    authoring_domains: assetDomainsForScopes(effect.stale),
    workspace_projection: effect.workspace_projection,
    acceptance_gates: effect.acceptance_gates,
  };
}

export function mutationInvalidation(
  capability: string,
  domain: ControlAuthoringDomain,
  succeeded: boolean,
  result: unknown,
  branch?: CapabilityBranchHint,
  analysis?: MutationEvidenceAnalysis
): ControlDelta["invalidates"] {
  if (succeeded && (capability === "undo" || capability === "redo")) {
    const historyInvalidation = semanticHistoryInvalidation(
      result, analysis?.historyEffect
    );
    if (historyInvalidation) return historyInvalidation;
  }

  if (
    succeeded &&
    (analysis?.materialPersistenceOnly ??
      isMaterialPersistenceOnly(capability, result, branch))
  ) {
    return {
      authoring_domains: [],
      workspace_projection: true,
      acceptance_gates: false,
    };
  }

  if (
    succeeded &&
    capability === "texture_layer_management" &&
    (analysis?.textureLayerMetadataOnly ?? textureLayerMetadataOnly(result))
  ) {
    return {
      authoring_domains: [],
      workspace_projection: true,
      acceptance_gates: false,
    };
  }

  const mutates = analysis?.mutates ??
    capabilityMutatesState(capability, succeeded, result, branch);
  let affectedDomains: ControlAuthoringDomain[] = [];
  if (mutates) {
    if (capability === "create_project") {
      affectedDomains = ["GEOMETRY", "TEXTURING", "ANIMATION"];
    } else if (capability === "undo" || capability === "redo") {
      affectedDomains = ["GEOMETRY", "TEXTURING", "ANIMATION"];
    } else if (domain === "GEOMETRY") {
      affectedDomains = geometryInvalidation(
        capability, result, analysis?.geometryScopes
      );
    }
    else if (domain === "TEXTURING") affectedDomains = ["TEXTURING"];
    else if (domain === "ANIMATION") affectedDomains = ["ANIMATION"];
    else affectedDomains = ["CORE"];
  }
  return {
    authoring_domains: [...new Set(affectedDomains)],
    workspace_projection: mutates,
    acceptance_gates: mutates,
  };
}

export function geometryFreshnessScopes(
  capability: string,
  result: unknown
): { stale: ControlFreshnessScope[]; precise: boolean } {
  if (capability === "manage_cubes") {
    const changedFields = effectChangedFields(result);
    if (changedFields.length === 0) {
      return {
        stale: [
          "GEOMETRY_STRUCTURE",
          "UV_MAPPING",
          "TEXTURE_APPEARANCE",
          "ANIMATION_MOTION",
        ],
        precise: false,
      };
    }

    return {
      stale: cubeSemanticScopesFromChangedFields(changedFields),
      precise: true,
    };
  }

  if (capability === "modify_group") {
    const candidate = authoritativeReceipt(result);
    const parsed = candidate ? modifyGroupReceiptSchema.safeParse(candidate) : null;
    if (parsed?.success) {
      const stale: ControlFreshnessScope[] = ["GEOMETRY_STRUCTURE"];
      if (parsed.data.changed_fields.some(
        field => field === "origin" || field === "rotation"
      )) {
        stale.push("ANIMATION_MOTION");
      }
      return { stale, precise: true };
    }
    // Partial, malformed, or subtree-translation receipts cannot prove that
    // Animation was unaffected. Use the existing conservative default.
    return { stale: capabilityDefaultStaleScopes(capability), precise: false };
  }

  if (capability === "remove_element") {
    const candidate = authoritativeReceipt(result);
    const parsed = candidate ? removeElementReceiptSchema.safeParse(candidate) : null;
    if (parsed?.success) {
      const { removed_root: removedRoot, removed_counts: removedCounts,
        affected_animations: affectedAnimations } = parsed.data;
      if (removedRoot.type === "group") {
        const stale: ControlFreshnessScope[] = ["GEOMETRY_STRUCTURE"];
        if (removedCounts.elements > 0) {
          stale.push("UV_MAPPING", "TEXTURE_APPEARANCE");
        }
        if (affectedAnimations > 0) stale.push("ANIMATION_MOTION");
        return { stale, precise: true };
      }
      return {
        stale: removedElementSemanticScopes(removedRoot.type),
        precise: true,
      };
    }
    // A partial count can silently drop UV/Texture/Animation changes. Only
    // the producer-validated full receipt can justify narrow invalidation.
    return { stale: capabilityDefaultStaleScopes(capability), precise: false };
  }

  if (capability === "rename_element") {
    const candidate = authoritativeReceipt(result);
    const parsed = candidate ? renameElementReceiptSchema.safeParse(candidate) : null;
    if (parsed?.success && parsed.data.execution === "applied") {
      if ("changes" in parsed.data) {
        // Batch Group renames report exact animation-reference impact.
        return {
          stale: parsed.data.affected_animations === 0
            ? ["GEOMETRY_STRUCTURE"]
            : renamedElementSemanticScopes("group"),
          precise: true,
        };
      }
      // Single-element rename has an explicit final native element type.
      return {
        stale: renamedElementSemanticScopes(parsed.data.element.type),
        precise: true,
      };
    }
    // Text labels and partial element IDs cannot demonstrate that references
    // or dependent Animation evidence stayed unchanged.
    return { stale: capabilityDefaultStaleScopes(capability), precise: false };
  }

  const defaults = capabilityDefaultStaleScopes(capability);
  return {
    stale: defaults.length > 0 ? defaults : ["GEOMETRY_STRUCTURE"],
    precise: true,
  };
}

/**
 * One call-local receipt interpretation feeds invalidation and freshness.
 * Never cache across MCP calls: Undo, manual edits and project changes can
 * invalidate even byte-identical input objects.
 */
export function analyzeMutationEvidence(
  capability: string,
  domain: ControlAuthoringDomain,
  succeeded: boolean,
  result: unknown,
  branch?: CapabilityBranchHint
): MutationEvidenceAnalysis {
  // Only classify relevant receipt families, then share those decisions
  // across mutation, invalidation and next-intent selection in this call.
  const receiptFacts = {
    ...(succeeded &&
    (capability === "save_material_config" ||
      capability === "manage_material" &&
        branch?.field === "operation" && branch.value === "save")
      ? { materialPersistenceOnly: isMaterialPersistenceOnly(capability, result, branch) }
      : {}),
    ...(succeeded && capability === "texture_layer_management"
      ? { textureLayerMetadataOnly: textureLayerMetadataOnly(result) }
      : {}),
    ...(succeeded && capability === "manage_particle"
      ? { particleTextureHandoff: particleTextureHandoffRequired(result) }
      : {}),
    ...(succeeded && (capability === "undo" || capability === "redo")
      ? { historyEffect: semanticHistoryEffectFromResult(result) }
      : {}),
    ...(succeeded && capability === "manage_animation_controller" &&
      branch?.field === "resource_kind"
      ? {
          animationControllerResourceNeutral:
            animationControllerResourceStateNeutral(result, branch),
        }
      : {}),
  };
  const mutates = capabilityMutatesState(
    capability, succeeded, result, branch, receiptFacts
  );
  return {
    ...receiptFacts,
    mutates,
    ...(mutates && domain === "GEOMETRY"
      ? { geometryScopes: geometryFreshnessScopes(capability, result) }
      : {}),
  };
}

export function staleScopesForMutation(
  capability: string,
  domain: ControlAuthoringDomain,
  result: unknown,
  geometryScopes?: ReturnType<typeof geometryFreshnessScopes>,
  historyEffect?: ReturnType<typeof semanticHistoryEffectFromResult>
): { stale: ControlFreshnessScope[]; precise: boolean } {
  if (domain === "GEOMETRY") {
    return geometryScopes ?? geometryFreshnessScopes(capability, result);
  }

  if (domain === "TEXTURING") {
    const defaults = capabilityDefaultStaleScopes(capability);
    if (defaults.length > 0) {
      return { stale: defaults, precise: true };
    }
    return {
      stale: ["TEXTURE_APPEARANCE", "MATERIAL_RENDER"],
      precise: false,
    };
  }

  if (capability === "create_project") {
    return {
      stale: [...ALL_FRESHNESS_SCOPES],
      precise: false,
    };
  }

  if (capability === "undo" || capability === "redo") {
    const semanticEffect = historyEffect === undefined
      ? semanticHistoryEffectFromResult(result)
      : historyEffect;
    if (semanticEffect) {
      return {
        stale: semanticEffect.stale,
        precise: true,
      };
    }
    return {
      stale: [...ALL_FRESHNESS_SCOPES],
      precise: false,
    };
  }

  if (domain === "ANIMATION") {
    const defaults = capabilityDefaultStaleScopes(capability);
    if (defaults.length > 0) {
      return { stale: defaults, precise: true };
    }
    return {
      stale: [
        "ANIMATION_MOTION",
        "ANIMATION_CONTROLLER",
        "ANIMATION_EFFECTS",
        "PARTICLE_SYSTEM",
      ],
      precise: false,
    };
  }

  return { stale: [], precise: false };
}


export function authoritativeRevisionEvidence(
  capability: string,
  result: unknown
): ControlDelta["revision_evidence"] {
  if (capability !== "paint_texture_transaction") return {};
  const candidate = authoritativeReceipt(result);
  const revision = candidate ? record(candidate.revision) : null;
  return typeof revision?.after === "string" && revision.after.length > 0
    ? { TEXTURE_APPEARANCE: revision.after }
    : {};
}

export function mutationFreshness(
  capability: string,
  domain: ControlAuthoringDomain,
  succeeded: boolean,
  result: unknown,
  branch?: CapabilityBranchHint,
  analysis?: MutationEvidenceAnalysis
): ControlDelta["freshness"] {
  if (!succeeded) {
    return {
      basis: "UNKNOWN_OUTCOME",
      stale: [],
      fresh: [],
      unknown: [...ALL_FRESHNESS_SCOPES],
    };
  }

  const mutates = analysis?.mutates ??
    capabilityMutatesState(capability, true, result, branch);
  if (!mutates) {
    return {
      basis: "NO_CHANGE",
      stale: [],
      fresh: [...ALL_FRESHNESS_SCOPES],
      unknown: [],
    };
  }

  const { stale, precise } = staleScopesForMutation(
    capability, domain, result, analysis?.geometryScopes,
    analysis?.historyEffect
  );
  const staleSet = new Set(stale);
  return {
    basis: precise ? "PRECISE_EFFECT" : "CONSERVATIVE_EFFECT",
    stale,
    fresh: ALL_FRESHNESS_SCOPES.filter((scope) => !staleSet.has(scope)),
    unknown: [],
  };
}