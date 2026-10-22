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
      action:
        typeof details.action === "string"
          ? details.action
          : "select intended Blockbench tab, then explicitly rebind Gateway project affinity",
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

  if (
    code === "BACKEND_UNAVAILABLE" &&
    (details.receipt_issue === "MISSING_PROJECT_UUID" ||
      details.receipt_issue === "MISSING_AUTHORING_PHASE")
  ) {
    // Native mutation reported success but lacked an authoritative affinity
    // receipt. Never imply that the project/Stage definitely stayed unchanged.
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
