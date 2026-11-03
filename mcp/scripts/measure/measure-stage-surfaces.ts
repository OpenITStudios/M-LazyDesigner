import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  applyMcpToolSurface,
  getMcpSurfaceToolNames,
} from "@/server/runtime/registration";
import createNetServer from "@/server/net";
import { DEFAULT_MCP_REGISTRATION_PROFILE } from "@/lib/capabilities/registrationProfile";
import {
  MCP_AUTHORING_STAGES,
  type McpAuthoringStage,
} from "@/lib/capabilities/authoringStage";

const HOST = "127.0.0.1";
const ENDPOINT = "/bb-mcp";
const PROTOCOL_VERSION = "2025-06-18";
const CATALOG_TOOL_COUNT = 55;

const EXPECTED_STAGE_TOOL_COUNTS: Record<McpAuthoringStage, number> = {
  geometry: 48,
  texturing: 48,
  // Animation intentionally excludes create_project plus editor-selection helpers;
  // project lifecycle and Cube/Group selection belong to AUTHORING before the
  // approved handoff into the Animation surface.
  animation: 19,
};

type ListedTool = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
};

type JsonRpcBody = {
  result?: {
    protocolVersion?: string;
    instructions?: string;
    tools?: ListedTool[];
  };
  error?: { message?: string };
};

type ToolRow = {
  name: string;
  payload_chars: number;
  input_schema_chars: number;
  description_chars: number;
};

type StageMetrics = {
  tool_count: number;
  stage_owned_tool_count: number;
  initialize_instructions_chars: number;
  tools_list_response_chars: number;
  tools_array_chars: number;
  input_schema_chars: number;
  description_chars: number;
  average_tool_payload_chars: number;
  per_tool_payload_chars: {
    p50: number;
    p90: number;
    p95: number;
    max: number;
  };
  largest_tools: ToolRow[];
};

type MeasuredStage = {
  metrics: Omit<StageMetrics, "stage_owned_tool_count">;
  tool_names: string[];
};

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function postMcp(
  baseUrl: string,
  body: unknown,
  protocolVersion = false
): Promise<{ response: Response; text: string; json: JsonRpcBody }> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    connection: "close",
  });
  if (protocolVersion) {
    headers.set("mcp-protocol-version", PROTOCOL_VERSION);
  }

  const response = await fetch(`${baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = JSON.parse(text) as JsonRpcBody;
  return { response, text, json };
}

async function measureStage(stage: McpAuthoringStage): Promise<MeasuredStage> {
  applyMcpToolSurface(DEFAULT_MCP_REGISTRATION_PROFILE, stage);
  const expectedNames = getMcpSurfaceToolNames(
    DEFAULT_MCP_REGISTRATION_PROFILE,
    stage
  );

  if (expectedNames.length !== EXPECTED_STAGE_TOOL_COUNTS[stage]) {
    throw new Error(
      `${stage} source surface exposes ${expectedNames.length} tools; expected ${EXPECTED_STAGE_TOOL_COUNTS[stage]}.`
    );
  }

  const server = createNetServer(
    { createServer: (options, callback) => createHttpServer(options, callback) },
    {
      port: 0,
      endpoint: ENDPOINT,
      host: HOST,
    }
  );

  try {
    if (!server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
    }

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error(`Expected an IPv4 listener while measuring ${stage}.`);
    }
    const tcpAddress = address as AddressInfo;
    const baseUrl = `http://${HOST}:${tcpAddress.port}`;

    const initialized = await postMcp(baseUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: `blockit-${stage}-surface-measurement`,
          version: "1.0.0",
        },
      },
    });
    if (initialized.response.status !== 200) {
      throw new Error(
        `${stage} initialize failed (${initialized.response.status}): ${initialized.text}`
      );
    }
    if (initialized.json.result?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `${stage} returned unexpected protocol version ${initialized.json.result?.protocolVersion ?? "missing"}.`
      );
    }
    const instructions = initialized.json.result?.instructions ?? "";
    if (!instructions.includes(`ACTIVE STAGE: ${stage.toUpperCase()}`)) {
      throw new Error(`${stage} initialize lost its active-stage contract.`);
    }

    const listed = await postMcp(
      baseUrl,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      },
      true
    );
    if (listed.response.status !== 200 || listed.json.error) {
      throw new Error(
        `${stage} tools/list failed: ${listed.json.error?.message ?? listed.text}`
      );
    }

    const tools = listed.json.result?.tools ?? [];
    const actualNames = tools
      .map((tool) => tool.name ?? "<unnamed>")
      .sort((a, b) => a.localeCompare(b));
    const expectedSorted = [...expectedNames].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedSorted)) {
      throw new Error(
        `${stage} runtime tools/list diverged from the source-owned stage surface.`
      );
    }

    const rows = tools.map((tool): ToolRow => ({
      name: tool.name ?? "<unnamed>",
      payload_chars: JSON.stringify(tool).length,
      input_schema_chars: JSON.stringify(tool.inputSchema ?? {}).length,
      description_chars: tool.description?.length ?? 0,
    }));
    const payloadSizes = rows.map((row) => row.payload_chars);
    const totalPayload = payloadSizes.reduce((sum, value) => sum + value, 0);

    return {
      tool_names: actualNames,
      metrics: {
        tool_count: tools.length,
        initialize_instructions_chars: instructions.length,
        tools_list_response_chars: listed.text.length,
        tools_array_chars: JSON.stringify(tools).length,
        input_schema_chars: rows.reduce(
          (sum, row) => sum + row.input_schema_chars,
          0
        ),
        description_chars: rows.reduce(
          (sum, row) => sum + row.description_chars,
          0
        ),
        average_tool_payload_chars:
          rows.length > 0 ? Math.round(totalPayload / rows.length) : 0,
        per_tool_payload_chars: {
          p50: percentile(payloadSizes, 0.5),
          p90: percentile(payloadSizes, 0.9),
          p95: percentile(payloadSizes, 0.95),
          max: payloadSizes.length > 0 ? Math.max(...payloadSizes) : 0,
        },
        largest_tools: [...rows]
          .sort(
            (a, b) =>
              b.payload_chars - a.payload_chars || a.name.localeCompare(b.name)
          )
          .slice(0, 8),
      },
    };
  } finally {
    server.closeActiveSockets();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

async function main(): Promise<void> {
  const measured = {} as Record<McpAuthoringStage, MeasuredStage>;
  for (const stage of MCP_AUTHORING_STAGES) {
    measured[stage] = await measureStage(stage);
  }

  const stageSets = MCP_AUTHORING_STAGES.map(
    (stage) => new Set(measured[stage].tool_names)
  );
  const sharedAllStageTools = [...stageSets[0]].filter((name) =>
    stageSets.slice(1).every((set) => set.has(name))
  );
  const union = new Set(
    MCP_AUTHORING_STAGES.flatMap((stage) => measured[stage].tool_names)
  );
  if (union.size !== CATALOG_TOOL_COUNT) {
    throw new Error(
      `Stage union exposes ${union.size} unique tools; expected the ${CATALOG_TOOL_COUNT}-tool callable catalog.`
    );
  }

  const stages = Object.fromEntries(
    MCP_AUTHORING_STAGES.map((stage) => {
      const metrics: StageMetrics = {
        ...measured[stage].metrics,
        stage_owned_tool_count:
          measured[stage].metrics.tool_count - sharedAllStageTools.length,
      };
      return [stage, metrics];
    })
  ) as Record<McpAuthoringStage, StageMetrics>;

  const heaviestStage = [...MCP_AUTHORING_STAGES].sort(
    (a, b) =>
      stages[b].tools_list_response_chars - stages[a].tools_list_response_chars
  )[0];

  console.log(
    JSON.stringify(
      {
        protocol_version: PROTOCOL_VERSION,
        callable_catalog_tool_count: CATALOG_TOOL_COUNT,
        shared_core_tool_count: sharedAllStageTools.length,
        shared_core_tools: sharedAllStageTools.sort((a, b) => a.localeCompare(b)),
        heaviest_stage_by_tools_list_chars: heaviestStage,
        stages,
        proof_note:
          "Measures source-owned stage-filtered MCP tools/list over the real loopback transport; it is not installed-client token usage or Authoring Efficiency proof.",
      },
      null,
      2
    )
  );
}

await main();