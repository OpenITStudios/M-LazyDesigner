import type { GatewayRuntimeStatus } from "../runtime/backend";
import {
  resolveDevelopmentIntent,
  type DevelopmentResolution,
} from "../development/intent";
import { contextForAuthoringDomain, type ContextResolutionIssue } from "./contexts";
import { buildControlSnapshot } from "./snapshot";
import {
  buildControlStageContext,
  type ControlStageContext,
} from "./contextProjection";
import { readReferencePackageProjection } from "./referencePackage";
import { readWorkspaceProjection } from "./workspace";
import type {
  ControlReadiness,
  ControlSnapshot,
} from "./types";
import {
  filterContext,
  taskContextId,
  type ControlContextDelivery,
  type ControlTaskMode,
} from "./packetContext";
import {
  buildReadiness,
  lifecycleForDomain,
  NOT_REQUIRED_LIFECYCLE,
} from "./readiness";
import {
  emptyWorkspace,
  referenceSummary,
  workspaceSummary,
  type ControlReferenceSummary,
  type ControlWorkspaceSummary,
} from "./packetData";

export type {
  ControlContextDelivery,
  ControlTaskMode,
} from "./packetContext";
export type {
  ControlReferenceSummary,
  ControlWorkspaceSummary,
} from "./packetData";

export type ControlPacket = Omit<ControlSnapshot, "context" | "mode"> & {
  mode: ControlTaskMode;
  task_context_id: string;
  readiness: ControlReadiness;
  workspace: ControlWorkspaceSummary;
  reference: ControlReferenceSummary;
  stage_context: ControlStageContext | null;
  development: DevelopmentResolution | null;
  context: ControlContextDelivery;
};

export async function buildControlPacket(
  status: GatewayRuntimeStatus,
  options: {
    knownContextIds?: readonly string[];
    workspacePath?: string | null;
    referencePackagePath?: string | null;
    currentUserDelta?: string | null;
    taskMode?: ControlTaskMode;
    taskIntent?: string | null;
    /** Internal test seam; the public Gateway schema is unchanged. */
    contextResolver?: typeof contextForAuthoringDomain;
  } = {}
): Promise<ControlPacket> {
  const baseSnapshot = buildControlSnapshot(status);
  const mode = options.taskMode ?? "ASSET_AUTHORING";
  const development =
    mode === "SYSTEM_DEVELOPMENT"
      ? resolveDevelopmentIntent(options.taskIntent ?? "")
      : null;

  const workspace =
    mode === "ASSET_AUTHORING"
      ? await readWorkspaceProjection(status, options.workspacePath)
      : emptyWorkspace();

  const reference =
    mode === "ASSET_AUTHORING"
      ? await readReferencePackageProjection(options.referencePackagePath)
      : await readReferencePackageProjection(null);

  const resolvedContext =
    mode === "ASSET_AUTHORING"
      ? await (options.contextResolver ?? contextForAuthoringDomain)(
          baseSnapshot.authoring.domain,
          reference.selected_profile
        )
      : { required: [], optional: [], unavailable: [] as ContextResolutionIssue[] };
  const contextUnavailable = resolvedContext.unavailable.length > 0;

  const snapshot: ControlSnapshot = {
    ...baseSnapshot,
    context: {
      required: resolvedContext.required,
      optional: resolvedContext.optional,
    },
    blockers: contextUnavailable
      ? [...baseSnapshot.blockers, "REQUIRED_CONTEXT_UNAVAILABLE"]
      : baseSnapshot.blockers,
  };

  const stageContext =
    mode === "ASSET_AUTHORING"
      ? buildControlStageContext({
          domain: snapshot.authoring.domain,
          reference,
          workspace,
          currentUserDelta: options.currentUserDelta,
        })
      : null;

  const lifecycle =
    mode === "ASSET_AUTHORING"
      ? lifecycleForDomain(snapshot.authoring.domain, workspace)
      : NOT_REQUIRED_LIFECYCLE;

  const workspaceBlockers =
    mode === "ASSET_AUTHORING"
      ? workspace.blockers.map(
          (_, index) => `WORKSPACE_BLOCKER_${index + 1}`
        )
      : [];
  const workspaceIssues =
    mode === "ASSET_AUTHORING" ? (workspace.workspace_issues ?? []) : [];
  const referenceBlockers =
    stageContext?.stage_readiness === "BLOCKED"
      ? ["REFERENCE_STAGE_BLOCKED"]
      : [];
  const lifecycleBlockers = lifecycle.blocked
    ? lifecycle.reasons
    : [];
  const finalizationBlockers =
    mode !== "ASSET_AUTHORING" ? []
      : [
          ...(workspace.finalization_native_revision?.state === "STALE"
            ? ["FINALIZATION_NATIVE_CHECKPOINT_STALE"] : []),
          ...(["FINALIZATION", "COMPLETE"].includes(
            workspace.current_stage?.trim().toUpperCase() ?? ""
          ) && stageContext?.asset_health.overall === "BLOCKED"
            ? ["FINALIZATION_UPSTREAM_GATES_BLOCKED"] : []),
        ];
  const blockers = [
    ...snapshot.blockers,
    ...((workspace.blockers_omitted_count ?? 0) > 0
      ? ["WORKSPACE_PROJECTION_INCOMPLETE"]
      : []),
    ...workspaceBlockers,
    ...workspaceIssues,
    ...finalizationBlockers,
    ...referenceBlockers,
    ...lifecycleBlockers.filter(
      (reason) => !snapshot.blockers.includes(reason)
    ),
  ];

  // A missing required handle cannot be satisfied by an old client-side copy.
  // Reissue still-available handles and explicitly invalidate old context IDs.
  const knownContextIds = options.knownContextIds ?? [];
  const deliveredContext = filterContext(
    snapshot, contextUnavailable ? [] : knownContextIds, mode
  );
  if (contextUnavailable) {
    deliveredContext.invalidated_ids = [...new Set(knownContextIds)];
  }

  return {
    ...snapshot,
    mode,
    system:
      snapshot.system === "READY" &&
      (contextUnavailable || blockers.length > snapshot.blockers.length)
        ? "DEGRADED"
        : snapshot.system,
    task_context_id: taskContextId(
      snapshot,
      workspace,
      reference,
      mode,
      development,
      options.currentUserDelta?.trim() || null
    ),
    readiness: buildReadiness(
      snapshot,
      workspace,
      reference,
      mode,
      lifecycle,
      stageContext?.stage_readiness ?? null
    ),
    workspace: workspaceSummary(workspace),
    reference: referenceSummary(reference),
    stage_context: stageContext,
    development,
    context: {
      ...deliveredContext,
      ...(contextUnavailable ? { unavailable: resolvedContext.unavailable } : {}),
    },
    blockers,
  };
}

export {
  projectControlPacketForGateway,
  projectControlPacketForGatewayWithDiagnostics,
} from "./gatewayProjection";
