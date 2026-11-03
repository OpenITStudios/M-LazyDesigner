import "@/server/tools";
import { promptDocs, resourceDocs } from "@/scripts/generate/internal/docs-manifest";
import {
  MCP_AUTHORING_PHASES,
  type McpAuthoringPhase,
} from "@/lib/authoringPhase";
import { selectMcpPhaseWorkflowBody } from "@/server/prompts";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import createNetServer from "@/server/net";

const HOST = "127.0.0.1";
const ENDPOINT = "/bb-mcp";
const PROTOCOL_VERSION = "2025-06-18";

// Regression ceilings, not token-usage targets. Consolidated operations must
// advertise their real nested schemas rather than hiding fields behind unknown.
// 2026-08-24: add_group gained the user-mandated coherent `groups` batch;
// ceilings were raised by its measured delta.
// 2026-09-02: Live phase orchestration adds one Core control tool. Catalog
// count and aggregate input-schema ceiling move by the measured capability delta.
// 2026-09-08: exact texture mutation gained one public revision-protected
// transaction tool; legacy paint operations remain available for interactive strokes.
// 2026-09-08: Prompt/Resource count and compact metadata join the same surface
// guard so coverage growth must be justified instead of hidden behind tool-only metrics.
// 2026-09-09: Texture authoring adds one explicit `manage_render_profile`
// boundary plus one on-demand texture-authoring knowledge Resource. Existing
// aggregate tool ceilings remain unchanged; only the measured catalog counts
// and Resource metadata ceilings move by that justified capability delta.
// 2026-09-10: named-plugin Cube/AO/noise/copy/palette/easing schemas.
// Loopback: 111603 response / 94148 schema / 11578 largest tool chars.
// 2026-09-17: current default Bedrock profile intentionally exposes 55 tools after
// retired/default-disabled compatibility helpers. Current canonical Particle and
// exact Paint transaction schemas are larger because their strict bounded branches
// are now fully advertised rather than hidden. Measured loopback: 112225 response /
// 94873 schema. Keep narrow regression headroom instead of weakening the guard.
// 2026-10-14: accept the already-shipped grounded-image correspondence,
// landmark/silhouette schemas and correction-continuation guidance. Local
// loopback measured 117671 response / 98626 schema / 12974 prompt source /
// 11404 AUTHORING prompt chars; capture payload is 6631 including metadata.
// Preserve strict branch validation and image provenance; this is a measured
// coverage baseline update, not token savings or native acceptance.
const SURFACE_BUDGET = {
  tool_count: 55,
  initialize_instructions_chars: 700,
  tools_list_response_chars: 118_000,
  input_schema_chars: 99_000,
  description_chars: 11_500,
  max_tool_payload_chars: 3_200,
  prompt_spec_count: 1,
  resource_spec_count: 10,
  canonical_prompt_source_chars: 13_000,
  phase_prompt_body_chars: {
    geometry: 11_500,
    texturing: 11_500,
    animation: 3_000,
  } satisfies Record<McpAuthoringPhase, number>,
  prompt_catalog_chars: 380,
  resource_catalog_chars: 3_000,
  prompt_description_chars: 220,
  resource_description_chars: 1_850,
} as const;

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
  error?: {
    message?: string;
  };
};

type BranchSchemaSummary = {
  required: string[];
  properties: string[];
  name_description: string | null;
  id_description: string | null;
};

type SurfaceMetrics = {
  protocol_version: string;
  initialize_instructions_chars: number;
  tool_count: number;
  tools_list_response_chars: number;
  tools_array_chars: number;
  input_schema_chars: number;
  description_chars: number;
  prompt_spec_count: number;
  prompt_names: string[];
  prompt_catalog_chars: number;
  prompt_description_chars: number;
  canonical_prompt_source_chars: number;
  phase_prompt_body_chars: Record<McpAuthoringPhase, number>;
  resource_spec_count: number;
  resource_names: string[];
  resource_catalog_chars: number;
  resource_description_chars: number;
  per_tool_payload_chars: {
    p50: number;
    p90: number;
    p95: number;
    max: number;
  };
  branch_schema_audit: Record<string, BranchSchemaSummary>;
  largest_tools: Array<{
    name: string;
    payload_chars: number;
    input_schema_chars: number;
    description_chars: number;
  }>;
  proof_note: string;
};

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

type ObjectSchema = {
  required?: string[];
  properties?: Record<string, { description?: string }>;
  anyOf?: ObjectSchema[];
  oneOf?: ObjectSchema[];
  allOf?: ObjectSchema[];
};

function mergeObjectSchemas(left: ObjectSchema, right: ObjectSchema): ObjectSchema {
  return {
    properties: {
      ...(left.properties ?? {}),
      ...(right.properties ?? {}),
    },
    required: [
      ...new Set([...(left.required ?? []), ...(right.required ?? [])]),
    ],
  };
}

function expandObjectSchemaBranches(schema: ObjectSchema): ObjectSchema[] {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives?.length) {
    const inherited: ObjectSchema = {
      properties: schema.properties,
      required: schema.required,
    };
    return alternatives.flatMap((variant) =>
      expandObjectSchemaBranches(variant).map((expanded) =>
        mergeObjectSchemas(inherited, expanded)
      )
    );
  }

  if (schema.allOf?.length) {
    return schema.allOf.reduce<ObjectSchema[]>(
      (accumulator, component) => {
        const expanded = expandObjectSchemaBranches(component);
        return accumulator.flatMap((base) =>
          expanded.map((part) => mergeObjectSchemas(base, part))
        );
      },
      [{ properties: schema.properties, required: schema.required }]
    );
  }

  return [schema];
}

function summarizeBranchSchema(
  tools: ListedTool[],
  toolName: string
): BranchSchemaSummary {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    throw new Error(`Expected ${toolName} on the default MCP surface.`);
  }

  const schema = (tool.inputSchema ?? {}) as ObjectSchema;
  const branches = expandObjectSchemaBranches(schema).filter(
    (branch) => branch.properties && Object.keys(branch.properties).length > 0
  );
  if (branches.length === 0) {
    throw new Error(
      `${toolName} tools/list schema exposes no measurable object branches.`
    );
  }

  const properties = Object.assign(
    {},
    ...branches.map((branch) => branch.properties ?? {})
  );
  const required = (branches[0]?.required ?? []).filter((field) =>
    branches.every((branch) => branch.required?.includes(field))
  );

  return {
    required: [...required].sort(),
    properties: Object.keys(properties).sort(),
    name_description: properties.name?.description ?? null,
    id_description: properties.id?.description ?? null,
  };
}

function assertAdvertisedBranchGuidance(
  audit: Record<string, BranchSchemaSummary>
): void {
  for (const [toolName, summary] of Object.entries(audit)) {
    if (!summary.required.includes("action")) {
      throw new Error(`${toolName} tools/list schema must require action.`);
    }
    if (!summary.name_description?.includes("Required when action=create")) {
      throw new Error(
        `${toolName} tools/list schema lost create-branch guidance on name.`
      );
    }
    if (!summary.id_description?.includes("Required when action=update")) {
      throw new Error(
        `${toolName} tools/list schema lost update-branch guidance on id.`
      );
    }
  }
}

function assertWithinSurfaceBudget(
  metrics: SurfaceMetrics,
  rows: SurfaceMetrics["largest_tools"]
): void {
  const failures: string[] = [];

  if (metrics.tool_count !== SURFACE_BUDGET.tool_count) {
    failures.push(
      `tool_count=${metrics.tool_count} expected exactly ${SURFACE_BUDGET.tool_count}`
    );
  }
  if (
    metrics.initialize_instructions_chars >
    SURFACE_BUDGET.initialize_instructions_chars
  ) {
    failures.push(
      `initialize_instructions_chars=${metrics.initialize_instructions_chars} exceeds ${SURFACE_BUDGET.initialize_instructions_chars}`
    );
  }
  if (
    metrics.tools_list_response_chars >
    SURFACE_BUDGET.tools_list_response_chars
  ) {
    failures.push(
      `tools_list_response_chars=${metrics.tools_list_response_chars} exceeds ${SURFACE_BUDGET.tools_list_response_chars}`
    );
  }
  if (metrics.input_schema_chars > SURFACE_BUDGET.input_schema_chars) {
    failures.push(
      `input_schema_chars=${metrics.input_schema_chars} exceeds ${SURFACE_BUDGET.input_schema_chars}`
    );
  }
  if (metrics.description_chars > SURFACE_BUDGET.description_chars) {
    failures.push(
      `description_chars=${metrics.description_chars} exceeds ${SURFACE_BUDGET.description_chars}`
    );
  }
  if (metrics.prompt_spec_count !== SURFACE_BUDGET.prompt_spec_count) {
    failures.push(
      `prompt_spec_count=${metrics.prompt_spec_count} expected exactly ${SURFACE_BUDGET.prompt_spec_count}`
    );
  }
  if (metrics.resource_spec_count !== SURFACE_BUDGET.resource_spec_count) {
    failures.push(
      `resource_spec_count=${metrics.resource_spec_count} expected exactly ${SURFACE_BUDGET.resource_spec_count}`
    );
  }
  if (
    metrics.canonical_prompt_source_chars >
    SURFACE_BUDGET.canonical_prompt_source_chars
  ) {
    failures.push(
      `canonical_prompt_source_chars=${metrics.canonical_prompt_source_chars} exceeds ${SURFACE_BUDGET.canonical_prompt_source_chars}`
    );
  }
  for (const phase of MCP_AUTHORING_PHASES) {
    const actual = metrics.phase_prompt_body_chars[phase];
    const limit = SURFACE_BUDGET.phase_prompt_body_chars[phase];
    if (actual > limit) {
      failures.push(
        `${phase}_prompt_body_chars=${actual} exceeds ${limit}`
      );
    }
  }
  if (metrics.prompt_catalog_chars > SURFACE_BUDGET.prompt_catalog_chars) {
    failures.push(
      `prompt_catalog_chars=${metrics.prompt_catalog_chars} exceeds ${SURFACE_BUDGET.prompt_catalog_chars}`
    );
  }
  if (metrics.resource_catalog_chars > SURFACE_BUDGET.resource_catalog_chars) {
    failures.push(
      `resource_catalog_chars=${metrics.resource_catalog_chars} exceeds ${SURFACE_BUDGET.resource_catalog_chars}`
    );
  }
  if (
    metrics.prompt_description_chars >
    SURFACE_BUDGET.prompt_description_chars
  ) {
    failures.push(
      `prompt_description_chars=${metrics.prompt_description_chars} exceeds ${SURFACE_BUDGET.prompt_description_chars}`
    );
  }
  if (
    metrics.resource_description_chars >
    SURFACE_BUDGET.resource_description_chars
  ) {
    failures.push(
      `resource_description_chars=${metrics.resource_description_chars} exceeds ${SURFACE_BUDGET.resource_description_chars}`
    );
  }
  for (const row of rows) {
    // Measured canonical-schema growth; unrelated tools retain the original cap.
    const expandedSchemaLimits: Record<string, number> = {
      manage_animation_timeline: 11_650, manage_animation_controller: 10_000,
      // Explicit simplify branch adds bounded targets/rounding/dry-run fields.
      manage_cubes: 8_400, manage_render_profile: 5_200, manage_particle: 6_500,
      manage_material: 3_800, create_animation: 3_450, create_texture: 3_450,
      manage_material_instances: 3_400,
      capture_model_views: 6_700,
      // Explicit palette/sampler and bounded noise/copy/Cube AO inputs.
      paint_settings: 3_500, paint_texture_transaction: 5_600,
    };
    const limit = expandedSchemaLimits[row.name] ?? SURFACE_BUDGET.max_tool_payload_chars;
    if (row.payload_chars > limit) failures.push(`${row.name} payload=${row.payload_chars} exceeds ${limit}`);
  }

  if (failures.length > 0) {
    throw new Error(`Default MCP surface regression:\n- ${failures.join("\n- ")}`);
  }
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

async function main(): Promise<void> {
  const server = createNetServer(
    {
      createServer: (options, callback) => createHttpServer(options, callback),
    },
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
      throw new Error("Expected an IPv4 TCP listener for MCP surface measurement.");
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
        clientInfo: { name: "blockit-surface-measurement", version: "1.0.0" },
      },
    });
    if (initialized.response.status !== 200) {
      throw new Error(
        `MCP initialize failed (${initialized.response.status}): ${initialized.text}`
      );
    }
    if (initialized.json.result?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(
        `Unexpected MCP protocol version: ${initialized.json.result?.protocolVersion ?? "missing"}`
      );
    }
    const initializeInstructions = initialized.json.result?.instructions ?? "";
    if (!initializeInstructions.trim()) {
      throw new Error("MCP initialize must expose compact namespace instructions.");
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
    if (listed.response.status !== 200) {
      throw new Error(
        `MCP tools/list failed (${listed.response.status}): ${listed.text}`
      );
    }
    if (listed.json.error) {
      throw new Error(`MCP tools/list error: ${listed.json.error.message ?? "unknown"}`);
    }

    const tools = listed.json.result?.tools ?? [];
    const rows = tools.map((tool) => {
      const payloadChars = JSON.stringify(tool).length;
      const inputSchemaChars = JSON.stringify(tool.inputSchema ?? {}).length;
      const descriptionChars = tool.description?.length ?? 0;
      return {
        name: tool.name ?? "<unnamed>",
        payload_chars: payloadChars,
        input_schema_chars: inputSchemaChars,
        description_chars: descriptionChars,
      };
    });

    const promptRows = promptDocs.map((prompt) => ({
      name: prompt.name,
      title: prompt.title ?? null,
      description: prompt.description,
      status: prompt.status,
      argument_names: Object.keys(prompt.argsSchema?.shape ?? {}).sort(),
    }));
    const resourceRows = resourceDocs.map((resource) => ({
      name: resource.name,
      title: resource.title ?? null,
      description: resource.description,
      uri_template: resource.uriTemplate,
    }));
    const canonicalPrompt = await Bun.file(
      "prompts/bedrock_entity_workflow.md"
    ).text();
    const phasePromptBodyChars = Object.fromEntries(
      MCP_AUTHORING_PHASES.map((phase) => [
        phase,
        selectMcpPhaseWorkflowBody(canonicalPrompt, phase).length,
      ])
    ) as Record<McpAuthoringPhase, number>;

    const payloadSizes = rows.map((row) => row.payload_chars);
    const branchSchemaAudit = Object.fromEntries(
      ["manage_locator", "manage_null_object"].map((toolName) => [
        toolName,
        summarizeBranchSchema(tools, toolName),
      ])
    );

    const metrics: SurfaceMetrics = {
      protocol_version: PROTOCOL_VERSION,
      initialize_instructions_chars: initializeInstructions.length,
      tool_count: tools.length,
      tools_list_response_chars: listed.text.length,
      tools_array_chars: JSON.stringify(tools).length,
      input_schema_chars: rows.reduce(
        (total, row) => total + row.input_schema_chars,
        0
      ),
      description_chars: rows.reduce(
        (total, row) => total + row.description_chars,
        0
      ),
      prompt_spec_count: promptRows.length,
      prompt_names: promptRows.map((row) => row.name).sort(),
      prompt_catalog_chars: JSON.stringify(promptRows).length,
      prompt_description_chars: promptRows.reduce(
        (total, row) => total + row.description.length,
        0
      ),
      canonical_prompt_source_chars: canonicalPrompt.length,
      phase_prompt_body_chars: phasePromptBodyChars,
      resource_spec_count: resourceRows.length,
      resource_names: resourceRows.map((row) => row.name).sort(),
      resource_catalog_chars: JSON.stringify(resourceRows).length,
      resource_description_chars: resourceRows.reduce(
        (total, row) => total + row.description.length,
        0
      ),
      per_tool_payload_chars: {
        p50: percentile(payloadSizes, 0.5),
        p90: percentile(payloadSizes, 0.9),
        p95: percentile(payloadSizes, 0.95),
        max: payloadSizes.length > 0 ? Math.max(...payloadSizes) : 0,
      },
      branch_schema_audit: branchSchemaAudit,
      largest_tools: [...rows]
        .sort((a, b) => b.payload_chars - a.payload_chars || a.name.localeCompare(b.name))
        .slice(0, 10),
      proof_note:
        "Tool metrics use the real loopback MCP surface. Prompt/Resource metrics guard source-owned documented coverage and phase-projected prompt character footprint; none of these values are installed-client token usage or live Cost to Accepted Result proof.",
    };

    console.log(JSON.stringify(metrics, null, 2));
    assertAdvertisedBranchGuidance(metrics.branch_schema_audit);
    assertWithinSurfaceBudget(metrics, rows);
  } finally {
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

await main();