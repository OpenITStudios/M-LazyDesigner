import type { JsonRecord } from "../contracts/protocol";

export type GatewayRecoveryCategory =
  | "AVAILABILITY"
  | "AFFINITY"
  | "CAPABILITY"
  | "TRANSPORT"
  | "CAPACITY"
  | "REFERENCE"
  | "INTERNAL";

export type GatewayRecovery = {
  category: GatewayRecoveryCategory;
  safe_to_retry: boolean;
  state_uncertain: boolean;
  requires_status_refresh: boolean;
  requires_user_action: boolean;
  action: string | null;
};

export function recoveryForGatewayError(
  code: string,
  safeToRetry: boolean,
  details: JsonRecord = {}
): GatewayRecovery {
  if (code === "PROJECT_CONTEXT_LOST") {
    return {
      category: "AFFINITY",
      safe_to_retry: false,
      state_uncertain: false,
      requires_status_refresh: true,
      requires_user_action: true,
      // The operational recovery instruction is Gateway-owned, not a
      // caller- or Runtime-supplied diagnostic string.
      action: "select intended Blockbench tab, then call status with adopt_active_project=true",
    };
  }

  if (code === "OUTCOME_UNKNOWN") {
    return {
      category: "TRANSPORT",
      safe_to_retry: false,
      state_uncertain: true,
      requires_status_refresh: true,
      requires_user_action: false,
      action: "inspect current Blockbench state before deciding whether to retry",
    };
  }

  if (code === "BACKEND_CALL_INTERRUPTED") {
    return {
      category: "TRANSPORT",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: false,
      requires_user_action: false,
      action: "retry the read-only operation after Runtime connectivity recovers",
    };
  }

  // A receipt validation issue follows the native call. A new or malformed
  // issue code must not fall back to retryable transport unavailability:
  // the authored mutation may already have happened.
  if (code === "BACKEND_UNAVAILABLE" &&
      Object.hasOwn(details, "receipt_issue")) {
    // A successful native mutation may precede the failed authority receipt
    // validation. Missing AND contradictory project/Stage identity are
    // uncertain outcomes; never advise replay before state inspection.
    return {
      category: "AFFINITY",
      safe_to_retry: false,
      state_uncertain: true,
      requires_status_refresh: true,
      requires_user_action: false,
      action:
        "refresh Gateway status, inspect the actual Blockbench project/Stage and explicitly rebind if needed; never replay the mutation without state evidence",
    };
  }

  if (code === "BACKEND_UNAVAILABLE") {
    return {
      category: "AVAILABILITY",
      safe_to_retry: safeToRetry,
      state_uncertain: false,
      requires_status_refresh: true,
      requires_user_action: false,
      action: "continue through the same Gateway; retry after Runtime becomes available",
    };
  }

  if (code === "CAPABILITY_NOT_FOUND") {
    return {
      category: "CAPABILITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: false,
      requires_user_action: false,
      action: "refresh capability discovery for the current Runtime surface",
    };
  }

  if (code === "GATEWAY_QUEUE_EXPIRED" || code === "GATEWAY_QUEUE_CANCELLED") {
    return {
      category: code === "GATEWAY_QUEUE_EXPIRED" ? "CAPACITY" : "TRANSPORT",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: false,
      requires_user_action: false,
      action: code === "GATEWAY_QUEUE_EXPIRED"
        ? "retry when the Gateway queue has cleared; no native operation began"
        : "request was cancelled before native execution; retry only if still wanted",
    };
  }

  if (code === "GATEWAY_BUSY") {
    return {
      category: "CAPACITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: false,
      requires_user_action: false,
      action: "retry after the current serialized authoring operation completes",
    };
  }

  if (code === "AUTHORING_CONTROL_ORIENTATION_REQUIRED") {
    return {
      category: "CAPABILITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: true,
      requires_user_action: false,
      action: "obtain current ASSET_AUTHORING status and required specialist/reference evidence before retrying the unexecuted mutation",
    };
  }

  if (code === "COHORT_TASK_CONTEXT_REQUIRED" || code === "COHORT_TASK_CONTEXT_STALE") {
    // The Gateway rejected the request before the executor/native mutation.
    // Retry only after obtaining the *current* Control task identity.
    return {
      category: "CAPABILITY",
      safe_to_retry: true,
      state_uncertain: false,
      requires_status_refresh: true,
      requires_user_action: false,
      action: "call status with the current Reference Package, Workspace and latest user correction; copy control.task_context_id to the outer invoke_capability.task_context_id, or use COMPLETE for a standalone call",
    };
  }

  if (code.startsWith("REFERENCE_")) {
    return {
      category: "REFERENCE",
      safe_to_retry: safeToRetry,
      state_uncertain: false,
      requires_status_refresh: false,
      requires_user_action: code === "REFERENCE_AMBIGUOUS",
      action:
        code === "REFERENCE_AMBIGUOUS"
          ? "provide a more specific vanilla entity/model variant"
          : null,
    };
  }

  return {
    category: "INTERNAL",
    safe_to_retry: false,
    state_uncertain: false,
    requires_status_refresh: false,
    requires_user_action: false,
    action: null,
  };
}
