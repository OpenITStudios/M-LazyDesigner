import {
  SdkErrorCode,
  SdkError,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import type { GatewayConnectionManager } from "./connectionManager";
import type { GatewayEffectApplication } from "../capabilities/effects";
import type { BlockitAuthoringPhaseAffinity } from "../../lib/runtime/affinity";
import type { JsonRecord } from "../contracts/protocol";

export type GatewayBackendErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "CAPABILITY_NOT_FOUND"
  | "BACKEND_CALL_INTERRUPTED"
  | "OUTCOME_UNKNOWN"
  | "PROJECT_CONTEXT_LOST"
  | "GATEWAY_BUSY"
  | "GATEWAY_QUEUE_EXPIRED"
  | "GATEWAY_QUEUE_CANCELLED";

export class GatewayBackendError extends Error {
  constructor(
    readonly code: GatewayBackendErrorCode,
    message: string,
    readonly safeToRetry: boolean = false,
    readonly details: JsonRecord = {}
  ) {
    super(message);
    this.name = "GatewayBackendError";
  }
}

export type HealthProbe =
  | { online: true; health: JsonRecord; signature: string }
  | { online: false; error: string };

export type GatewayRuntimeStatus = {
  gateway: "ready";
  affinity: {
    project_uuid: string | null;
    authoring_phase: BlockitAuthoringPhaseAffinity | null;
  };
  runtime: {
    online: boolean;
    endpoint: string;
    mcp_client_ready: boolean;
    protocol_era?: "modern" | "legacy" | null;
    catalog_stale: boolean;
    runtime_signature: string | null;
    connected_signature: string | null;
    catalog_count: number;
    health: JsonRecord | null;
  };
  connection: ReturnType<GatewayConnectionManager["snapshot"]>;
  operations: {
    active: number;
    queued: number;
    max_queue_depth: number;
    completed: number;
    failed: number;
    timed_out: number;
    rejected_busy: number;
    expired_before_start: number;
    cancelled_before_start: number;
    outcome_unknown: number;
    read_interrupted: number;
    metric_sample_limit: number;
    queue_wait_sample_count: number;
    duration_sample_count: number;
    queue_wait_p50_ms: number | null;
    queue_wait_p95_ms: number | null;
    duration_p50_ms: number | null;
    duration_p95_ms: number | null;
    last_queue_wait_ms?: number | null;
    max_queue_wait_ms?: number;
    last_duration_ms?: number | null;
    max_duration_ms?: number;
  };
  last_error: string | null;
};

export type GatewayRuntimeCallResult = JsonRecord & {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type GatewayRuntimeInvocation = {
  result: GatewayRuntimeCallResult;
  readOnly: boolean;
  /** Existing backend health/project preflight identity; no additional status. */
  verifiedProjectUuid: string | null;
  /** Verified within the serialized preflight, before any native tool call. */
  phaseBefore: BlockitAuthoringPhaseAffinity | null;
  /** Backend-validated once; reused by Control instead of re-parsing affinity receipts. */
  effectApplication?: GatewayEffectApplication;
};

export type RuntimeGenerationChangeEvent = {
  previous_signature: string | null;
  next_signature: string;
  /** Project affinity was verified against the new Runtime's health. */
  project_uuid: string | null;
  connection_generation: number;
  reconnect_count: number;
};

export type BlockitRuntimeBackendOptions = {
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxQueueDepth?: number;
  maxQueueWaitMs?: number;
  catalogLeaseMs?: number;
  onRuntimeGenerationChange?: (event: RuntimeGenerationChangeEvent) => void;
  /** Current Runtime loss invalidates Control facts without ending the Gateway. */
  onRuntimeUnavailable?: () => void;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isRequestTimeoutError(error: unknown): boolean {
  return error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout;
}

export function isRuntimeProjectContextError(error: unknown): boolean {
  return error instanceof SdkHttpError && error.status === 409;
}

export function normalizePositiveInteger(
  value: number,
  fallback: number,
  minimum: number
): number {
  return Number.isFinite(value) && value >= minimum ? Math.trunc(value) : fallback;
}

export function normalizeNonNegativeInteger(
  value: number,
  fallback: number
): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

export function normalizeRuntimeCallResult(
  result: unknown
): GatewayRuntimeCallResult {
  if (isRecord(result) && Array.isArray(result.content)) {
    return result as GatewayRuntimeCallResult;
  }

  return {
    content: [
      {
        type: "text",
        text: "LazyDesigner Runtime returned a non-standard deferred tool result.",
      },
    ],
    structuredContent: { runtime_result: result },
  };
}

export function normalizeGatewayManagedResult(
  phaseAffinityUpdated: boolean,
  result: GatewayRuntimeCallResult
): GatewayRuntimeCallResult {
  if (!phaseAffinityUpdated || result.isError === true) {
    return result;
  }

  return {
    ...result,
    content: [
      {
        type: "text",
        text: "This LazyDesigner Gateway authoring phase switched. Continue the same task; its Runtime catalog will refresh automatically on the next capability request.",
      },
    ],
    structuredContent: {
      ...(isRecord(result.structuredContent) ? result.structuredContent : {}),
      gateway_catalog_invalidated: true,
      client_reconnect_required: false,
      new_chat_required: false,
      action:
        "continue same task through Gateway; Runtime catalog refreshes automatically",
    },
  };
}
