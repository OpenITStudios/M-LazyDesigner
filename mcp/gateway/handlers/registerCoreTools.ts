import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { BlockitRuntimeBackend } from "../runtime/backend";
import {
  GATEWAY_TOOLS,
  type JsonRecord,
} from "../contracts/protocol";
import { projectCapabilityInputSchema } from "../capabilities/schemaProjection";
import { nestedOperationClassForArguments } from "../capabilities/manifest";
import { STATE_MUTATIONS } from "../control/delta/policy";
import { readRequiredAuthoringContext } from "../control/contexts";
import {
  buildControlPacket,
  projectControlPacketForGateway,
  CONTROL_ROUTING_POLICY,
  projectCapabilitiesForSearch,
} from "../control";
import {
  authoringDomainForCapability,
  sourceOwnerForCapability,
} from "../development/sourceOwners";
import type { LocalCapabilityRegistry } from "../providers/registry";
import { projectGatewayStatus } from "../presentation/statusProjection";
import {
  readReferencePackageProjection,
  readReferenceFactPage,
  REFERENCE_FACT_PAGE_SECTIONS,
} from "../control/referencePackage";
import { readReferenceImageEvidence, summarizeReferenceAlphaSilhouette } from "../control/referenceImageEvidence";
import { summarizeReferencePartRegions } from "../../lib/reference/imageRegionEvidence";
import {
  gatewayDescribeOutputSchema,
  gatewaySearchOutputSchema,
  gatewayStatusOutputSchema,
} from "../contracts/outputSchemas";
import {
  capabilityDescriptionRevision,
  semanticRecordForCapabilityBranch,
} from "../capabilities/semanticRegistry";
import { semanticDerivedArtifactStamp } from "../development/semanticArtifact";
import { capabilitySemanticId } from "../../lib/semantic/identity";
import { getCapabilityMetadata } from "../../lib/capabilities/metadata";
import type { GatewaySurfaceProfile } from "../surface/profile";
import type { GatewaySessionState } from "../session/state";
import {
  gatewayErrorResult,
  type GatewayToolContext,
} from "../execution/gatewayErrors";
import type { BenchmarkTraceRecorder } from "../execution/benchmarkTrace";
import type {
  ProjectObservationRecorder,
  ProjectObservationTool,
} from "../execution/projectObservation";

type GatewayToolDefinition = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  outputSchema?: z.ZodTypeAny;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

type GatewayToolHandler = (
  args: JsonRecord,
  context?: GatewayToolContext
) => Promise<unknown>;

export type CoreGatewayRegistrationDeps = {
  server: McpServer;
  backend: BlockitRuntimeBackend;
  localCapabilities: LocalCapabilityRegistry;
  session: GatewaySessionState;
  surfaceProfile: GatewaySurfaceProfile;
  experimentalTools: () => readonly string[];
  trace?: BenchmarkTraceRecorder | null;
  /** L0 counters are internal; no MCP schema or AI-visible payload changes. */
  projectObservation?: ProjectObservationRecorder | null;
  onGatewayToolRequest?: () => void;
  invoke: (
    capability: string,
    args: JsonRecord,
    context?: GatewayToolContext,
    controlOptions?: {
      taskContextId?: string | null;
      cohortBoundary?: "CONTINUE" | "COMPLETE";
    }
  ) => Promise<unknown>;
};

const statusInput = z.object({
  adopt_active_project: z.boolean().default(false).describe("Bind selected project."),
  known_context_ids: z.array(z.string().min(1).max(160)).max(16).default([])
    .describe("IDs for Skill/Profile contents still present in the client's active context. After compaction/restart omit stale IDs so Control reissues handles; handles are not instructions."),
  workspace_path: z.string().min(1).optional().describe("Workspace directory or README.md path."),
  reference_package_path: z.string().min(1).optional().describe("Reference Package directory or REFERENCE.json path."),
  include_reference_images: z.boolean().default(false)
    .describe("Attach source images for review; default status stays text-only."),
  reference_fact_request: z.object({
    section: z.enum(REFERENCE_FACT_PAGE_SECTIONS),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(24).default(8),
    expected_reference_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional().describe("Page omitted active-stage REFERENCE.json facts; require current fingerprint, never bulk-load."),
  reference_image_ids: z.array(z.string().min(1).max(160)).min(1).max(4).optional()
    .describe("Select up to four REFERENCE.json image IDs."),
  current_user_delta: z.string().max(1000).optional().describe("Current correction/change request."),
  task_mode: z.enum(["ASSET_AUTHORING", "SYSTEM_DEVELOPMENT"]).default("ASSET_AUTHORING")
    .describe("Authoring or development."),
  task_intent: z.string().max(500).optional().describe("Concrete system-development task intent."),
  known_semantic_revisions: z.object({
    routing: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    graph: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    schema_projection: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    aggregate: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict().optional().describe("Cached semantic revisions; status returns changed surfaces only."),
});

const searchInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(8).default(CONTROL_ROUTING_POLICY.search_limit),
});

const describeInput = z.object({
  capability: z.string().min(1),
  detail: z.enum(["input", "full"]).default("input"),
  branch: z.object({
    field: z.string().min(1),
    value: z.string().min(1),
  }).strict().optional().describe("Consolidated schema branch."),
});

const invokeInput = z.object({
  capability: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  task_context_id: z.string().min(1).max(160).optional()
    .describe("Reuse current Control task_context_id for known mutations from one intent."),
  cohort_boundary: z.enum(["CONTINUE", "COMPLETE"]).default("COMPLETE")
    .describe("CONTINUE defers cohort verification; COMPLETE emits merged verification."),
});

export function registerCoreGatewayTools(
  deps: CoreGatewayRegistrationDeps
): void {
  const {
    server,
    backend,
    localCapabilities,
    session,
    surfaceProfile,
    experimentalTools,
    trace,
    invoke,
  } = deps;
  const registerNativeGatewayTool = server.registerTool.bind(server) as unknown as (
    name: string,
    definition: GatewayToolDefinition,
    handler: GatewayToolHandler
  ) => void;
  const registerGatewayTool = (
    name: string,
    definition: GatewayToolDefinition,
    handler: GatewayToolHandler
  ): void => {
    registerNativeGatewayTool(name, definition, async (args, context) => {
      // The executor observes invocations with its validated project preflight.
      // The outer wrapper owns only status/search/describe observations.
      const observeHere = name !== GATEWAY_TOOLS.invokeCapability &&
        deps.projectObservation?.active === true;
      const startedAt = observeHere ? performance.now() : 0;
      try {
        const response = await handler(args, context);
        if (observeHere) {
          try {
            deps.projectObservation?.record({
              tool: name as ProjectObservationTool,
              args,
              result: response,
              durationMs: performance.now() - startedAt,
            });
          } catch { /* L0 cannot affect MCP responses */ }
        }
        return response;
      } catch (error) {
        if (observeHere) {
          try {
            deps.projectObservation?.record({
              tool: name as ProjectObservationTool,
              args,
              result: {
                isError: true,
                structuredContent: { code: "GATEWAY_HANDLER_FAILURE" },
              },
              durationMs: performance.now() - startedAt,
            });
          } catch { /* L0 cannot affect MCP errors */ }
        }
        throw error;
      } finally {
        // Only real client tool requests reach this observer. Evidence must
        // never change an MCP response or interrupt a native mutation.
        try { deps.onGatewayToolRequest?.(); } catch { /* advisory */ }
      }
    });
  };

  registerGatewayTool(
    GATEWAY_TOOLS.status,
    {
      title: "LazyDesigner Status",
      description:
        "Returns compact Runtime health and Control orientation/context.",
      inputSchema: statusInput.shape,
      outputSchema: gatewayStatusOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs, context) => {
      const startedAt = trace?.startedAt() ?? 0;
      const traceparent = context?.mcpReq?._meta?.traceparent;
      try {
        const {
          adopt_active_project,
          known_context_ids,
          workspace_path,
          reference_package_path,
          include_reference_images,
          reference_image_ids,
          reference_fact_request,
          current_user_delta,
          task_mode,
          task_intent,
          known_semantic_revisions,
        } = statusInput.parse(rawArgs);
        const status = adopt_active_project
          ? await backend.adoptActiveProject()
          : await backend.getStatus();
        // The requested UUID persists across Runtime downtime for safe
        // explicit rebind, but is not proof of an active project.
        if (status.runtime.mcp_client_ready) {
          session.onVerifiedRuntimeStatus(
            status.affinity.project_uuid,
            status.affinity.authoring_phase
          );
        } else {
          session.onRuntimeUnavailable();
        }
        const control = await buildControlPacket(status, {
          knownContextIds: known_context_ids,
          workspacePath: workspace_path,
          referencePackagePath: reference_package_path,
          currentUserDelta: current_user_delta,
          taskMode: task_mode,
          taskIntent: task_intent,
        });
        // Transport the exact active Skill/profile bytes when the client has
        // not acknowledged still-loaded content. A path or SHA alone is not
        // instruction delivery. Keep these out of the compact Control packet.
        const neededContext = task_mode === "ASSET_AUTHORING" &&
          status.runtime.mcp_client_ready ? control.context.required : [];
        if (neededContext.length > 2) {
          throw new Error("CONTEXT_DELIVERY_SCOPE_UNBOUNDED");
        }
        const deliveredContext = await Promise.all(
          neededContext.map(async (handle) => ({
            handle,
            source: await readRequiredAuthoringContext(handle),
          }))
        );

        // Keep binary evidence out of Control's compact status context.
        // Deliver it only after explicit request, using IDs selected by the
        // existing stage projection. A later model capture uses those same
        // canonical view labels for manual image-pair review.
        let referenceEvidence: Awaited<ReturnType<typeof readReferenceImageEvidence>> | null = null;
        let referencePartRoles: Array<{ id: string; role: string | null }> = [];
        let referenceFactEvidence: Awaited<ReturnType<typeof readReferenceFactPage>> | null = null;
        if (reference_fact_request) {
          if (include_reference_images || task_mode !== "ASSET_AUTHORING" ||
              !reference_package_path || !control.reference.available) {
            throw new Error("REFERENCE_FACT_CONTEXT_REQUIRED: use a bound asset Reference Package without image batching.");
          }
          if (control.reference.fingerprint !==
              reference_fact_request.expected_reference_fingerprint) {
            throw new Error("REFERENCE_FACT_REVISION_CHANGED: refresh Control status before requesting facts.");
          }
          const omitted = control.stage_context?.reference_recovery?.omitted_sections ?? [];
          if (!omitted.includes(reference_fact_request.section)) {
            throw new Error("REFERENCE_FACT_NOT_OMITTED: request only a section omitted by the active-stage projection.");
          }
          referenceFactEvidence = await readReferenceFactPage(
            reference_package_path,
            {
              section: reference_fact_request.section,
              offset: reference_fact_request.offset,
              limit: reference_fact_request.limit,
              expectedFingerprint: reference_fact_request.expected_reference_fingerprint,
            }
          );
        }
        if (!include_reference_images && reference_image_ids !== undefined) {
          throw new Error("REFERENCE_IMAGE_SELECTION_INVALID: set include_reference_images=true.");
        }
        if (include_reference_images) {
          if (task_mode !== "ASSET_AUTHORING" || !reference_package_path ||
              !control.reference.available) {
            throw new Error("REFERENCE_IMAGE_CONTEXT_REQUIRED: bind a readable Reference Package.");
          }
          const stageIds = control.stage_context?.reference_image_ids ?? [];
          const ids = reference_image_ids ?? stageIds;
          const hasActiveStage = control.stage_context?.context_type != null;
          if (!ids.length || ids.length > 4 ||
              (hasActiveStage && ids.some((id) => !stageIds.includes(id)))) {
            throw new Error(
              "REFERENCE_IMAGE_SELECTION_INVALID: select 1-4 declared active-stage image IDs."
            );
          }
          const source = await readReferencePackageProjection(reference_package_path);
          if (source.fingerprint !== control.reference.fingerprint) {
            throw new Error("REFERENCE_IMAGE_REVISION_CHANGED: refresh Control status.");
          }
          referencePartRoles = (source.semantic_facts?.parts ?? []).flatMap((part) =>
            typeof part.id === "string"
              ? [{ id: part.id, role: typeof part.role === "string" ? part.role : null }]
              : []
          );
          referenceEvidence = await readReferenceImageEvidence(source, ids);
        }

        // An explicit Control orientation is a client-facing decision, not
        // proof that the client saw the approved reference pixels.
        const authoringContextCue = task_mode !== "ASSET_AUTHORING" ? "" :
          !control.reference.available
            ? " REFERENCE_UNBOUND: for reference-driven decisions, bind the approved reference_package_path and review its actual images before visual claims."
            : ` For a deferred cohort, copy current control.task_context_id=${control.task_context_id} into the outer invoke_capability.task_context_id; reorient after a changed intent, reference or project.`;
        const registeredExperimentalTools = experimentalTools();
        const response = {
          content: [
            {
              type: "text" as const,
              text: (
                task_mode === "SYSTEM_DEVELOPMENT"
                  ? "Development routing ready."
                  : !status.runtime.online
                    ? "Control ready; Runtime offline."
                    : control.system === "DEGRADED"
                      ? "Control status degraded; inspect blockers."
                      : "Control status ready."
              ) + authoringContextCue,
            },
            ...deliveredContext.map(({ handle, source }) => ({
              type: "text" as const,
              text: `AUTHORING_CONTEXT_BEGIN id=${handle.id} path=${handle.path} sha256=${handle.sha256}\n${source}\nAUTHORING_CONTEXT_END id=${handle.id}\nThis is source delivery, not proof that the client applied the instructions. Acknowledge this ID in known_context_ids only while these exact instructions remain loaded.`,
            })),
            ...(referenceEvidence ?? []).flatMap((image) => [
              {
                type: "text" as const,
                text: "REFERENCE_IMAGE " + image.id +
                  " VIEW " + (image.view ?? "COMPOSITE_OR_UNKNOWN") +
                  " STATUS " + (image.status ?? "UNSPECIFIED") +
                  " SHA256 " + image.sha256 +
                  ". Compare the actual image with the matching fresh Blockbench capture; labels alone are not visual proof.",
              },
              { type: "image" as const, data: image.data, mimeType: image.mime_type },
            ]),
          ],
          structuredContent: {
            ...projectGatewayStatus(status, known_semantic_revisions),
            gateway_surface: {
              profile: surfaceProfile,
              stable_gateway_tool_count: 4,
              experimental_direct_tools: [...registeredExperimentalTools],
              projected_client_tool_count:
                4 + registeredExperimentalTools.length,
            },
            control: projectControlPacketForGateway(control),
            ...(referenceFactEvidence
              ? { reference_fact_evidence: referenceFactEvidence }
              : {}),
            ...(referenceEvidence ? {
              reference_image_evidence: {
                reference_fingerprint: control.reference.fingerprint,
                source: "reference_package_file_bytes",
                model_image_capture_required: true,
                visual_verdict: "not_evaluated",
                pairing_rule: "Match only compatible explicitly known image views with current Blockbench model captures; composite/unknown views require actual visual interpretation. Status is not approval.",
                semantic_part_grounding: summarizeReferencePartRegions(
                  referenceEvidence.map((image) => ({
                    id: image.id, view: image.view, sha256: image.sha256,
                    status: image.status, regions: image.regions,
                  })),
                  referencePartRoles
                ),
                images: referenceEvidence.map((image) => ({
                  id: image.id,
                  view: image.view,
                  status: image.status,
                  landmarks: image.landmarks,
                  regions: image.regions,
                  ...(image.part_world_constraints
                    ? { part_world_constraints: image.part_world_constraints }
                    : {}),
                  sha256: image.sha256,
                  mime_type: image.mime_type,
                  bytes: image.bytes,
                  alpha_silhouette: summarizeReferenceAlphaSilhouette(image),
                })),
              },
            } : {}),
          },
        };
        // Only a completed status response issues a new client cohort identity.
        // A failed image/fact read or offline Runtime cannot authorize reuse.
        session.recordIssuedControlTaskId(
          status.runtime.mcp_client_ready ? control.task_context_id : null,
          task_mode
        );
        trace?.record({ startedAt, traceparent, kind: "inspect",
          capability: "status", success: true, result: response,
          readOnly: true, verificationClass: null });
        return response;
      } catch (error) {
        const response = gatewayErrorResult(error);
        trace?.record({ startedAt, traceparent, kind: "inspect",
          capability: "status", success: false, result: response,
          readOnly: true, verificationClass: null });
        return response;
      }
    }
  );

  registerGatewayTool(
    GATEWAY_TOOLS.searchCapabilities,
    {
      title: "Search LazyDesigner Capabilities",
      description:
        "Search exposed capabilities by intent; returns bounded routing and safety hints.",
      inputSchema: searchInput.shape,
      outputSchema: gatewaySearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs, context) => {
      const startedAt = trace?.startedAt() ?? 0;
      const traceparent = context?.mcpReq?._meta?.traceparent;
      try {
        const { query, limit } = searchInput.parse(rawArgs);
        const runtimeCapabilities = await backend.searchCapabilities(query, limit, {
          facts: session.facts,
        });
        const rawCapabilities = await localCapabilities.search(
          query,
          runtimeCapabilities,
          limit
        );
        // Avoid engineering source-owner enrichment on the model-facing hot path.
        const capabilities = projectCapabilitiesForSearch(rawCapabilities);
        const response = {
          content: [
            {
              type: "text" as const,
              text: capabilities.length > 0
                ? `${capabilities.length} capabilities.`
                : "No relevant capability found. Use a more specific authoring intent or an exact known capability name.",
            },
          ],
          structuredContent: { capabilities },
        };
        trace?.record({
          startedAt,
          traceparent,
          kind: "search",
          success: true,
          result: response,
          readOnly: true,
          verificationClass: null,
        });
        return response;
      } catch (error) {
        const response = gatewayErrorResult(error);
        trace?.record({
          startedAt,
          traceparent,
          kind: "search",
          success: false,
          result: response,
          readOnly: true,
          verificationClass: null,
        });
        return response;
      }
    }
  );

  registerGatewayTool(
    GATEWAY_TOOLS.describeCapability,
    {
      title: "Describe LazyDesigner Capability",
      description:
        "Returns one capability schema; detail=full adds metadata only when needed.",
      inputSchema: describeInput.shape,
      outputSchema: gatewayDescribeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs, context) => {
      const startedAt = trace?.startedAt() ?? 0;
      const traceparent = context?.mcpReq?._meta?.traceparent;
      let tracedCapability: string | null = null;
      try {
        const { capability, detail, branch } = describeInput.parse(rawArgs);
        tracedCapability = capability;
        const tool =
          (await localCapabilities.describe(capability)) ??
          (await backend.describeCapability(capability));
        const projection = projectCapabilityInputSchema(
          capability,
          tool.inputSchema ?? {},
          branch
        );
        const semanticRecord = semanticRecordForCapabilityBranch(
          capability,
          branch
        );
        const semanticId =
          semanticRecord?.id ?? capabilitySemanticId(capability, branch);
        // The default input-only path needs no lifecycle/tier metadata.
        // Defer that lookup to detail=full without changing the wire payload.
        let capabilityPayload: Record<string, unknown>;
        if (detail === "full") {
          const metadata = getCapabilityMetadata(capability);
          capabilityPayload = {
            description: tool.description ?? "",
            inputSchema: projection.inputSchema,
            ...(tool.outputSchema !== undefined
              ? { outputSchema: tool.outputSchema }
              : {}),
            ...(tool.annotations &&
            Object.keys(tool.annotations).length > 0
              ? { annotations: tool.annotations }
              : {}),
            lifecycle: metadata.lifecycle,
            operation_class:
              semanticRecord?.operationClass ?? metadata.operationClass,
            ...(metadata.stateClass !== null
              ? { state_class: metadata.stateClass }
              : {}),
            execution_class:
              semanticRecord?.executionClass ?? metadata.executionClass,
            verification_class:
              semanticRecord?.verificationClass ?? metadata.verificationClass,
            control: {
              authoring_domain: authoringDomainForCapability(capability),
              source_owner: sourceOwnerForCapability(capability),
            },
          };
        } else {
          capabilityPayload = { inputSchema: projection.inputSchema };
        }
        const semanticRevision = capabilityDescriptionRevision({
          semantic_id: semanticId,
          detail,
          ...capabilityPayload,
        });
        const response = {
          content: [
            {
              type: "text" as const,
              text: "Schema ready.",
            },
          ],
          structuredContent: {
            capability: {
              semantic_id: semanticId,
              semantic_revision: semanticRevision,
              semantic: semanticDerivedArtifactStamp("DESCRIBE_REPORT"),
              ...capabilityPayload,
            },
          },
        };
        trace?.record({
          startedAt,
          traceparent,
          kind: "describe",
          capability: tracedCapability,
          success: true,
          result: response,
          readOnly: true,
          verificationClass: null,
        });
        return response;
      } catch (error) {
        const response = gatewayErrorResult(error);
        trace?.record({
          startedAt,
          traceparent,
          kind: "describe",
          capability: tracedCapability,
          success: false,
          result: response,
          readOnly: true,
          verificationClass: null,
        });
        return response;
      }
    }
  );

  registerGatewayTool(
    GATEWAY_TOOLS.invokeCapability,
    {
      title: "Invoke LazyDesigner Capability",
      description:
        "Invokes one exact capability; mutations are serialized and never auto-retried.",
      inputSchema: invokeInput.shape,
    },
    async (rawArgs, context) => {
      try {
        const {
          capability,
          arguments: args,
          task_context_id,
          cohort_boundary,
        } = invokeInput.parse(rawArgs);
        const taskContextId = task_context_id?.trim() || null;
        if (cohort_boundary === "CONTINUE" && !taskContextId) {
          // An invalid deferred cohort must not perform a native mutation
          // and then appear to have postponed its verification.
          return gatewayErrorResult({
            code: "COHORT_TASK_CONTEXT_REQUIRED",
            message: "No native call was made. Call status with the current Reference Package, Workspace and latest user correction; pass its control.task_context_id as the outer invoke_capability.task_context_id for CONTINUE. Use COMPLETE for a standalone call.",
            safeToRetry: true,
            details: { executed: false },
          });
        }
        if (taskContextId && taskContextId !== session.currentIssuedControlTaskId) {
          // A stale/non-issued ID must not merge verification across a new
          // status, project, Runtime or authoring Stage.
          return gatewayErrorResult({
            code: "COHORT_TASK_CONTEXT_STALE",
            message: "No native call was made. This task_context_id was not issued by the most recent valid Control status. Reorient with the current Reference Package, Workspace and user correction; use that ID, or omit it for standalone COMPLETE.",
            safeToRetry: true,
            details: { executed: false },
          });
        }
        // A first authoring mutation needs one valid Control orientation.
        // Reuse it for later known capabilities; never require status per edit.
        // QUERY branches remain available without a prior authoring status.
        if (STATE_MUTATIONS.has(capability) &&
            nestedOperationClassForArguments(capability, args) !== "QUERY" &&
            !session.hasAuthoringOrientation) {
          return gatewayErrorResult({
            code: "AUTHORING_CONTROL_ORIENTATION_REQUIRED",
            message: "No native call was made. Call status in ASSET_AUTHORING mode to receive the active Skill/Reference/Workspace context before an authoring mutation. Reuse that orientation for subsequent known operations.",
            safeToRetry: true,
            details: { executed: false },
          });
        }
        return invoke(capability, args, context, {
          taskContextId,
          cohortBoundary: cohort_boundary,
        });
      } catch (error) {
        return gatewayErrorResult(error);
      }
    }
  );
}
