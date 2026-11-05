import { GatewayBackendError } from "../runtime/backendContract";
import type { JsonRecord } from "../contracts/protocol";
import { recoveryForGatewayError } from "../runtime/recovery";

export type GatewayToolContext = {
  mcpReq?: {
    _meta?: Record<string, unknown>;
    signal?: AbortSignal;
  };
};

const TRACE_META_KEYS = ["traceparent", "tracestate", "baggage"] as const;

export function traceMetaFromContext(
  context?: GatewayToolContext
): JsonRecord | undefined {
  const source = context?.mcpReq?._meta;
  if (!source) return undefined;

  const traceMeta: JsonRecord = {};
  for (const key of TRACE_META_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0 && value.length <= 8192) {
      traceMeta[key] = value;
    }
  }
  return Object.keys(traceMeta).length > 0 ? traceMeta : undefined;
}

function errorRecord(error: unknown): {
  code: string;
  message: string;
  safeToRetry: boolean;
  details: JsonRecord;
} | null {
  if (error instanceof GatewayBackendError) {
    return {
      code: error.code,
      message: error.message,
      safeToRetry: error.safeToRetry,
      details: error.details,
    };
  }

  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code !== "string") return null;
  const details =
    candidate.details &&
    typeof candidate.details === "object" &&
    !Array.isArray(candidate.details)
      ? candidate.details as JsonRecord
      : {};
  return {
    code: candidate.code,
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : String(candidate.code),
    safeToRetry: candidate.safeToRetry === true,
    details,
  };
}

export function gatewayErrorResult(error: unknown) {
  const known = errorRecord(error);
  if (known) {
    const recovery = recoveryForGatewayError(
      known.code,
      known.safeToRetry,
      known.details
    );
    return {
      isError: true,
      content: [
        { type: "text" as const, text: `${known.code}: ${known.message}` },
      ],
      structuredContent: {
        // Details add diagnostics only: never allow a nested tool/transport
        // payload to replace the authoritative error identity or recovery.
        ...known.details,
        code: known.code,
        message: known.message,
        recovery,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `GATEWAY_ERROR: ${message}` }],
    structuredContent: {
      code: "GATEWAY_ERROR",
      message,
      recovery: recoveryForGatewayError("GATEWAY_ERROR", false),
    },
  };
}
