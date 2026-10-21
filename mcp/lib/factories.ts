import { z } from "zod";
import type { IMCPTool, IMCPPrompt, IMCPResource, StatusType } from "@/types";
import { isDeepStrictEqual } from "node:util";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import type { McpServer, GetPromptResult, PromptArgument, ToolAnnotations } from "@modelcontextprotocol/server";

/**
 * Declarative tool spec for documentation and registration.
 * Contains everything except the `execute` implementation.
 */
export type ToolBranchSchemas = {
  discriminator: string;
  schemas: Readonly<Record<string, z.ZodType<any, any>>>;
};

export interface ToolSpec {
  name: string;
  description: string;
  annotations?: ToolAnnotations;
  parameters: z.ZodType<any, any>;
  branches?: ToolBranchSchemas;
  status: StatusType;
}

/**
 * Declarative prompt spec for documentation and registration.
 */
export interface PromptSpec {
  name: string;
  description: string;
  title?: string;
  argsSchema?: z.ZodObject<any>;
  status: StatusType;
}

/**
 * Declarative resource spec for documentation and registration.
 */
export interface ResourceSpec {
  name: string;
  description: string;
  uriTemplate: string;
  title?: string;
}

/**
 * User-visible list of tool details.
 */
export const tools: Record<string, IMCPTool> = {};

/**
 * User-visible list of prompt details.
 */
export const prompts: Record<string, IMCPPrompt> = {};

/**
 * User-visible list of resource details.
 */
export const resources: Record<string, IMCPResource> = {};

export interface ToolContext {
  reportProgress: (progress: { progress: number; total: number }) => void;
}

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

type ToolContentItem = TextContent | ImageContent;

type ToolResult = string | { content: ToolContentItem[]; structuredContent?: unknown };

interface ToolDefinition {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType<any, any>>;
  parameterSchema: z.ZodType<any, any>;
  branchSchemas?: ToolBranchSchemas;
  outputSchema?: z.ZodType<any, any>;
  execute: (args: any, context?: ToolContext) => Promise<ToolResult>;
  annotations?: ToolAnnotations;
}

/**
 * Store tool definitions for request-owned server reconstruction
 */
const toolDefinitions: Record<string, ToolDefinition> = {};
const toolCatalogOrdered: string[] = [];
const toolInvocationCache = new Map<
  string,
  (args: unknown, extra: unknown) => Promise<unknown>
>();
let enabledToolDefinitionsCache: Record<string, ToolDefinition> | null = null;
let enabledToolRegistrationCache:
  | Array<{ name: string; definition: ToolDefinition }>
  | null = null;
let resourceRegistrationCache: Array<[string, ResourceDefinition]> | null = null;
let promptRegistrationCache: Array<[string, PromptDefinition]> | null = null;

function getToolCallbackCacheKey(toolName: string): string {
  return `${toolName}`;
}

/**
 * Invalidate only the phase/profile-sensitive tool surface. Tool callbacks,
 * resources and prompts are generation-stable and must survive ordinary
 * authoring-surface changes.
 */
export function invalidateToolRegistrationRuntimeCaches(): void {
  enabledToolDefinitionsCache = null;
  enabledToolRegistrationCache = null;
}

function invalidateResourceRegistrationRuntimeCache(): void {
  resourceRegistrationCache = null;
}

function invalidatePromptRegistrationRuntimeCache(): void {
  promptRegistrationCache = null;
}

function compactStringResult(
  name: string,
  result: string
): { content: ToolContentItem[]; structuredContent?: unknown } {
  const text = result.trim();
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return {
        content: [{ type: "text", text: `${name} returned structured data.` }],
        structuredContent: JSON.parse(text),
      };
    } catch {
      // Preserve ordinary text when a string only resembles JSON.
    }
  }

  return { content: [{ type: "text", text: result }] };
}

function normalizeToolResultForRuntime(
  name: string,
  result: Exclude<ToolResult, string>
): { content: ToolContentItem[]; structuredContent?: unknown } {
  if (result.structuredContent !== undefined && result.content.length === 1) {
    return compactMirroredStructuredContent(name, result);
  }

  if (result.content.length !== 1) {
    return compactMirroredStructuredContent(name, result);
  }

  const [item] = result.content;
  if (item.type !== "text") {
    return compactMirroredStructuredContent(name, result);
  }

  const text = item.text.trim();
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    try {
      return {
        content: [{ type: "text", text: `${name} returned structured data.` }],
        structuredContent: JSON.parse(text),
      };
    } catch {
      return compactMirroredStructuredContent(name, result);
    }
  }

  return compactMirroredStructuredContent(name, result);
}

function getToolInvocation(name: string, toolDef: ToolDefinition) {
  const cacheKey = getToolCallbackCacheKey(name);
  const existing = toolInvocationCache.get(cacheKey);
  if (existing) return existing;

  const callback = async (args: unknown, _extra: unknown) => {
    const reportProgress: ToolContext["reportProgress"] = () => {};
    const context: ToolContext = { reportProgress };
    const validatedArgs = await toolDef.parameterSchema.parseAsync(args);
    const result = await toolDef.execute(
      validatedArgs as Record<string, unknown>,
      context
    );

    if (typeof result === "string") {
      return compactStringResult(name, result);
    }

    const normalized = normalizeToolResultForRuntime(name, result);
    if (toolDef.outputSchema && normalized.structuredContent !== undefined) {
      normalized.structuredContent = await toolDef.outputSchema.parseAsync(
        normalized.structuredContent
      );
    }
    return normalized;
  };

  toolInvocationCache.set(cacheKey, callback);
  return callback;
}

/**
 * Extracts the SDK-compatible object shape used for MCP registration/listing.
 * The original complete schema is retained separately for runtime validation.
 */
export function extractShape(
  schema: z.ZodType<any, any>
): Record<string, z.ZodType<any, any>> {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, z.ZodType<any, any>>;
  }

  if (schema instanceof z.ZodPipe) {
    return extractShape(schema.in as unknown as z.ZodType<any, any>);
  }

  if (schema instanceof z.ZodIntersection) {
    return {
      ...extractShape(schema._def.left as z.ZodType<any, any>),
      ...extractShape(schema._def.right as z.ZodType<any, any>),
    };
  }

  if (schema instanceof z.ZodUnion) {
    const optionShapes = schema.options.map((option) =>
      extractShape(option as z.ZodType<any, any>)
    );
    const fieldNames = new Set(optionShapes.flatMap((shape) => Object.keys(shape)));

    return Object.fromEntries(
      [...fieldNames].map((fieldName) => {
        const variants = optionShapes
          .map((shape) => shape[fieldName])
          .filter(
            (field): field is z.ZodType<any, any> => field !== undefined
          );
        const [first, second, ...rest] = variants;
        if (!first) {
          throw new Error(`Union field "${fieldName}" has no schema.`);
        }

        const field = second
          ? z.union([first, second, ...rest] as [
              z.ZodType<any, any>,
              z.ZodType<any, any>,
              ...z.ZodType<any, any>[],
            ])
          : first;
        const requiredInEveryOption =
          variants.length === optionShapes.length &&
          variants.every((variant) => !variant.isOptional());

        return [fieldName, requiredInEveryOption ? field : field.optional()];
      })
    );
  }

  return {};
}

/**
 * Keep the public discriminator and primitive validation in one exact schema.
 * The branch envelope rejects fields outside the advertised shape, then the
 * retained executor schema remains authoritative for refinements and semantics.
 */
export function withToolBranch<
  TOutput,
  K extends string,
  V extends string
>(
  schema: z.ZodType<TOutput, any>,
  field: K,
  value: V
) {
  return z
    .object({ ...extractShape(schema), [field]: z.literal(value) })
    .strict()
    .transform((input, ctx): TOutput & Record<K, V> => {
      const { [field]: _branch, ...payload } = input;
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue as any);
        return z.NEVER;
      }
      return {
        ...(parsed.data as Record<string, unknown>),
        [field]: value,
      } as TOutput & Record<K, V>;
    });
}

/**
 * Avoid sending the same machine-readable payload twice when a tool mirrors
 * structuredContent as a single JSON text content item. Concise human summaries,
 * images, and intentionally different text remain untouched.
 */
function compactMirroredStructuredContent(
  toolName: string,
  result: Exclude<ToolResult, string>
): Exclude<ToolResult, string> {
  if (result.structuredContent === undefined || result.content.length !== 1) {
    return result;
  }

  const [contentItem] = result.content;
  if (contentItem.type !== "text") {
    return result;
  }

  const text = contentItem.text.trim();
  // Human summaries dominate the normal response path; never serialize the
  // (possibly large) structured receipt just to compare ordinary prose.
  if (!(
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  )) return result;

  // Compare JSON values, not whitespace/key ordering. Pretty-printed Runtime
  // mirrors are still duplicate machine-readable evidence, but different
  // text, warnings, external locators and media must remain untouched.
  try {
    if (!isDeepStrictEqual(JSON.parse(text), result.structuredContent)) {
      return result;
    }
  } catch {
    return result;
  }

  return {
    ...result,
    content: [
      {
        type: "text",
        text: `${toolName} returned structured data.`,
      },
    ],
  };
}

/**
 * Stores one MCP tool definition for documentation and registration.
 * @param name - The exact MCP tool name.
 * @param tool - The tool configuration.
 * @param tool.description - The description of the tool.
 * @param tool.annotations - Annotations for the tool (title, hints).
 * @param tool.parameters - Zod schema for input parameters (supports ZodObject or ZodEffects from .refine()).
 * @param tool.execute - The async function to execute when the tool is called.
 * @param status - The status of the tool (stable, experimental, deprecated).
 * @param enabled - Whether the tool is enabled.
 * @returns - The created tool metadata.
 * @throws - If a tool with the same name already exists.
 */
export function createTool<TOutput>(
  name: string,
  tool: {
    description: string;
    annotations?: ToolAnnotations;
    parameters: z.ZodType<TOutput, any>;
    inputSchema?: Record<string, z.ZodType<any, any>>;
    branches?: ToolBranchSchemas;
    outputSchema?: z.ZodType<any, any>;
    execute: (args: TOutput, context?: ToolContext) => Promise<ToolResult>;
  },
  status: IMCPTool["status"] = "stable",
  enabled: boolean = true
) {
  if (tools[name]) {
    throw new Error(`Tool with name "${name}" already exists.`);
  }

  const inputSchema = tool.inputSchema ?? extractShape(tool.parameters);

  const toolDef: ToolDefinition = {
    title: tool.annotations?.title ?? tool.description,
    description: tool.description,
    inputSchema,
    parameterSchema: tool.parameters,
    branchSchemas: tool.branches,
    outputSchema: tool.outputSchema,
    execute: tool.execute,
    annotations: tool.annotations,
  };

  toolDefinitions[name] = toolDef;
  toolCatalogOrdered.push(name);
  invalidateToolRegistrationRuntimeCaches();

  tools[name] = {
    name,
    description: toolDef.description,
    enabled,
    status,
  };

  return tools[name];
}

export function getAllToolDefinitions() {
  return toolDefinitions;
}

export function getToolBranchSchemas(
  name: string
): ToolBranchSchemas | null {
  return toolDefinitions[name]?.branchSchemas ?? null;
}

export function getEnabledToolDefinitions() {
  if (enabledToolDefinitionsCache) {
    return enabledToolDefinitionsCache;
  }

  const enabled = Object.fromEntries(
    toolCatalogOrdered
      .map((name) => [name, toolDefinitions[name]] as const)
      .filter(([name]) => tools[name]?.enabled)
  );

  enabledToolDefinitionsCache = enabled;
  return enabled;
}

export function getEnabledToolRegistrationEntries() {
  if (enabledToolRegistrationCache) {
    return enabledToolRegistrationCache;
  }

  const enabled = getEnabledToolDefinitions();
  const entries = Object.entries(enabled)
    .map(([name, definition]) => ({ name, definition }))
    .sort((left, right) => left.name.localeCompare(right.name));

  enabledToolRegistrationCache = entries;
  return entries;
}

function getToolRegistrationEntries(
  allowedToolNames?: readonly string[]
): Array<{ name: string; definition: ToolDefinition }> {
  if (allowedToolNames === undefined) {
    return getEnabledToolRegistrationEntries();
  }

  return allowedToolNames.map((name) => {
    const definition = toolDefinitions[name];
    if (!definition) {
      throw new Error(`Requested MCP tool "${name}" has no registered definition.`);
    }
    return { name, definition };
  });
}

/**
 * Registers enabled tools, or one explicit request-scoped subset, on a server.
 * Explicit subsets reuse canonical definitions/callbacks without mutating
 * global `tools.enabled`, so simultaneous Gateway phases remain isolated.
 */
export function registerToolsOnServer(
  server: unknown,
  allowedToolNames?: readonly string[]
) {
  const typedServer = server as {
    server?: McpServer["server"];
    registerTool: (
      toolName: string,
      definition: {
        title: string;
        description: string;
        inputSchema: z.ZodType;
        outputSchema?: z.ZodType;
        annotations?: ToolAnnotations;
      },
      callback: (args: unknown, extra: unknown) => Promise<unknown>
    ) => void;
  };

  for (const { name, definition: toolDef } of getToolRegistrationEntries(
    allowedToolNames
  )) {
    typedServer.registerTool(
      name,
      {
        title: toolDef.title,
        description: toolDef.description,
        // SDK v2 accepts the canonical Standard Schema object directly.
        // Union/intersection branch semantics and branch-local required fields
        // stay source-owned by parameterSchema.
        inputSchema: toolDef.parameterSchema,
        outputSchema: toolDef.outputSchema,
        annotations: toolDef.annotations,
      },
      getToolInvocation(name, toolDef)
    );
  }
}

interface ResourceDefinition {
  name: string;
  uriTemplate: string;
  metadata: {
    title?: string;
    description?: string;
  };
  listCallback?: () => Promise<{
    resources: Array<{
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }>;
  }>;
  readCallback: (
    uri: URL,
    variables: Record<string, string>
  ) => Promise<{
    contents: Array<
      | { uri: string; text: string; mimeType?: string }
      | { uri: string; blob: string; mimeType?: string }
    >;
  }>;
}

const resourceDefinitions: Record<string, ResourceDefinition> = {};

export function createResource(
  name: string,
  config: {
    uriTemplate: string;
    title?: string;
    description: string;
    listCallback?: () => Promise<{
      resources: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
      }>;
    }>;
    readCallback: (
      uri: URL,
      variables: Record<string, string>
    ) => Promise<{
      contents: Array<
        | { uri: string; text: string; mimeType?: string }
        | { uri: string; blob: string; mimeType?: string }
      >;
    }>;
  }
) {
  if (resources[name]) {
    throw new Error(`Resource with name "${name}" already exists.`);
  }

  const resourceDef: ResourceDefinition = {
    name,
    uriTemplate: config.uriTemplate,
    metadata: {
      title: config.title,
      description: config.description,
    },
    listCallback: config.listCallback,
    readCallback: config.readCallback,
  };

  resourceDefinitions[name] = resourceDef;
  invalidateResourceRegistrationRuntimeCache();

  resources[name] = {
    name,
    description: config.description,
    uriTemplate: config.uriTemplate,
  };

  return resources[name];
}

export function getAllResourceDefinitions() {
  return resourceDefinitions;
}

export function registerResourcesOnServer(server: unknown) {
  const typedServer = server as {
    registerResource: (
      resourceName: string,
      uriOrTemplate: ResourceTemplate,
      metadata: {
        title?: string;
        description?: string;
      },
      readCallback: (
        uri: URL,
        variables: Record<string, string | string[]>
      ) => Promise<{
        contents: Array<
          | { uri: string; text: string; mimeType?: string }
          | { uri: string; blob: string; mimeType?: string }
        >;
      }>
    ) => void;
  };

  if (!resourceRegistrationCache) {
    resourceRegistrationCache = Object.entries(resourceDefinitions);
  }

  for (const [name, resourceDef] of resourceRegistrationCache) {
    typedServer.registerResource(
      name,
      new ResourceTemplate(resourceDef.uriTemplate, {
        list: resourceDef.listCallback,
      }),
      resourceDef.metadata,
      async (uri: URL, variables: Record<string, string | string[]>) => {
        const normalizedVariables = Object.fromEntries(
          Object.entries(variables).map(([key, value]) => {
            if (Array.isArray(value)) {
              return [key, value[0] ?? ""];
            }
            return [key, value];
          })
        ) as Record<string, string>;

        return resourceDef.readCallback(uri, normalizedVariables);
      }
    );
  }
}

interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema?: z.ZodObject<z.ZodRawShape>;
  generate: (args: Record<string, unknown>) => Promise<GetPromptResult>;
}

const promptDefinitions: Record<string, PromptDefinition> = {};

function promptArgumentsFromShape(
  shape: Readonly<Record<string, unknown>> | undefined
): PromptArgument[] {
  if (!shape) return [];

  return Object.entries(shape).map(([name, rawField]) => {
    const field = rawField as z.ZodType<any, any>;
    return {
      name,
      description: z.globalRegistry.get(field)?.description,
      required: !field.safeParse(undefined).success,
    };
  });
}

export function createPrompt<T extends z.ZodRawShape = Record<string, never>>(
  name: string,
  prompt: {
    title?: string;
    description: string;
    argsSchema?: z.ZodObject<T>;
    generate?: (
      args: z.infer<z.ZodObject<T>>
    ) => GetPromptResult | Promise<GetPromptResult>;
  },
  status: IMCPPrompt["status"] = "stable",
  enabled: boolean = true
) {
  if (prompts[name]) {
    throw new Error(`Prompt with name "${name}" already exists.`);
  }

  const argsShape = prompt.argsSchema?.shape;

  if (enabled && prompt.generate && argsShape) {
    const promptDef: PromptDefinition = {
      name,
      title: prompt.title || prompt.description,
      description: prompt.description,
      argsSchema: prompt.argsSchema,
      generate: async (args: Record<string, unknown>) =>
        prompt.generate!(args as z.infer<z.ZodObject<T>>),
    };

    promptDefinitions[name] = promptDef;
  }

  invalidatePromptRegistrationRuntimeCache();

  prompts[name] = {
    name,
    arguments: promptArgumentsFromShape(argsShape),
    description: prompt.description,
    enabled,
    status,
  };

  return prompts[name];
}

export function getAllPromptDefinitions() {
  return promptDefinitions;
}

export function registerPromptsOnServer(server: unknown) {
  const typedServer = server as {
    registerPrompt: (
      promptName: string,
      definition: {
        title: string;
        description: string;
        argsSchema?: z.ZodType;
      },
      callback: (
        args: Record<string, unknown>,
        extra: unknown
      ) => Promise<GetPromptResult>
    ) => void;
  };

  if (!promptRegistrationCache) {
    promptRegistrationCache = Object.entries(promptDefinitions);
  }

  for (const [name, promptDef] of promptRegistrationCache) {
    typedServer.registerPrompt(
      name,
      {
        title: promptDef.title,
        description: promptDef.description,
        argsSchema: promptDef.argsSchema,
      },
      async (args: Record<string, unknown>, _extra: unknown) =>
        promptDef.generate(args)
    );
  }
}
