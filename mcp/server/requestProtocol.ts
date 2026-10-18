import { getCapabilityMetadata } from "@/lib/capabilities/metadata";
import {
  normalizeAuthoringPhaseAffinity,
} from "@/lib/runtime/affinity";
import type { McpAuthoringPhase } from "@/lib/capabilities/authoringStage";

export type RuntimeRequestEnvelope = {
  method: string | null;
  capability: string | null;
  routeName: string | null;
  protocolVersion: string | null;
  targetAuthoringPhase: McpAuthoringPhase | null;
  id: string | number | null;
};

export interface SerializedWebResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ReadableStream<Uint8Array>;
  finalize?: () => Promise<void>;
}

export function readRequestEnvelope (
  body: string
): RuntimeRequestEnvelope {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        method: null,
        capability: null,
        routeName: null,
        protocolVersion: null,
        targetAuthoringPhase: null,
        id: null,
      };
    }

    const record = parsed as {
      method?: unknown;
      id?: unknown;
      params?: {
        name?: unknown;
        uri?: unknown;
        _meta?: { "io.modelcontextprotocol/protocolVersion"?: unknown };
        arguments?: { target_phase?: unknown };
      };
    };

    const capability =
      record.method === "tools/call" &&
      typeof record.params?.name === "string"
        ? record.params.name
        : null;

    const routeName = capability ??
      (record.method === "resources/read" && typeof record.params?.uri === "string"
        ? record.params.uri
        : record.method === "prompts/get" && typeof record.params?.name === "string"
          ? record.params.name
          : null);
    const version = record.params?._meta?.["io.modelcontextprotocol/protocolVersion"];
    const protocolVersion = typeof version === "string" ? version : null;

    const capabilityEffects = capability
      ? getCapabilityMetadata(capability).effects
      : null;

    let targetAuthoringPhase: McpAuthoringPhase | null = null;
    if (capabilityEffects?.phaseAffinity === "update_from_result") {
      try {
        targetAuthoringPhase = normalizeAuthoringPhaseAffinity(
          record.params?.arguments?.target_phase
        );
      } catch {
        targetAuthoringPhase = null;
      }
    }

    return {
      method: typeof record.method === "string" ? record.method : null,
      capability,
      routeName,
      protocolVersion,
      targetAuthoringPhase,
      id:
        typeof record.id === "string" || typeof record.id === "number"
          ? record.id
          : null,
    };
  } catch {
    return {
      method: null,
      capability: null,
      routeName: null,
      protocolVersion: null,
      targetAuthoringPhase: null,
      id: null,
    };
  }
}

/**
 * Decode the 2026 name sentinel strictly; never use a mirrored header
 * as an authority to select a native capability.
 */
function decodeMcpNameHeader (value: string): string | null {
  if (!value.startsWith("=?base64?")) return value;
  const match = /^=\?base64\?([A-Za-z0-9+/]+={0,2})\?=$/.exec(value);
  if (!match || match[1].length % 4 !== 0) return null;
  const decoded = Buffer.from(match[1], "base64");
  if (decoded.toString("base64") !== match[1]) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return null;
  }
}

/**
 * Guard mirrored routing metadata before selecting Runtime project/phase
 * authority. Full MCP protocol and tool parameter validation remain SDK-owned.
 */
export function validateMcpRoutingHeaders (
  envelope: RuntimeRequestEnvelope,
  headers: {
    protocolVersion: string | null;
    method: string | null;
    name: string | null;
  }
): { code: number; message: string } | null {
  const modernVersion = "2026-07-28";
  const modern =
    headers.protocolVersion === modernVersion ||
    envelope.protocolVersion === modernVersion;
  const mismatch = (reason: string) => ({
    code: modern ? -32020 : -32000,
    message: `Bad Request: MCP routing headers disagree with the JSON-RPC body (${reason}).`,
  });

  // Missing/invalid body _meta is a JSON-RPC parameter failure, not a
  // contradictory routing header. Reject before SDK dispatch with -32602
  // while retaining HTTP 400 and the fail-closed native request boundary.
  // A genuinely contradictory method header still keeps the stricter
  // routing-mismatch classification.
  if (modern && headers.protocolVersion === modernVersion &&
      envelope.protocolVersion === null) {
    if (headers.method && envelope.method && headers.method !== envelope.method) {
      return mismatch("Mcp-Method");
    }
    return {
      code: -32602,
      message: "Invalid params: missing io.modelcontextprotocol/protocolVersion in request _meta.",
    };
  }

  if (modern && (
    headers.protocolVersion !== modernVersion ||
    envelope.protocolVersion !== modernVersion
  )) return mismatch("protocol version header is missing or mismatched");

  if (modern && (!headers.method || !envelope.method)) {
    return mismatch("required Mcp-Method header or method is missing");
  }
  if (headers.method && envelope.method && headers.method !== envelope.method) {
    return mismatch("Mcp-Method");
  }
  const namedMethod = envelope.method === "tools/call" ||
    envelope.method === "resources/read" ||
    envelope.method === "prompts/get";
  if (modern && namedMethod && (!headers.name || !envelope.routeName)) {
    return mismatch("required Mcp-Name header or named argument is missing");
  }
  if (headers.name && envelope.routeName &&
      decodeMcpNameHeader(headers.name) !== envelope.routeName) {
    return mismatch("Mcp-Name");
  }
  return null;
}

export function projectContextErrorBody (
  id: string | number | null,
  message: string
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32002, message },
    id,
  });
}

export function isSuccessfulToolCallResponse (
  response: SerializedWebResponse
): boolean {
  if (response.status !== 200 || typeof response.body !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(response.body) as {
      error?: unknown;
      result?: { isError?: unknown };
    };
    return parsed.error === undefined && parsed.result?.isError !== true;
  } catch {
    return false;
  }
}