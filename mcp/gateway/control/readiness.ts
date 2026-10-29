import type { ControlReferenceProjection } from "./referenceTypes";
import type { ControlWorkspaceProjection } from "./workspace";
import type {
  ControlAuthoringDomain,
  ControlReadiness,
  ControlSnapshot,
} from "./types";
import type { ControlTaskMode } from "./packetContext";
import { relevantTruncatedSectionsForAuthoringDomain } from "./contextProjection";
import { animationRequirementConflict } from "../../lib/authoring/assetHealth";

export type LifecycleProjection = {
  ready: boolean;
  blocked: boolean;
  orientation_required: boolean;
  reasons: string[];
};

export const NOT_REQUIRED_LIFECYCLE: LifecycleProjection = {
  ready: true,
  blocked: false,
  orientation_required: false,
  reasons: [],
};

function normalizedGate(value: string | null): string | null {
  return value?.trim().toUpperCase() || null;
}

export function lifecycleForDomain(
  domain: ControlAuthoringDomain | null,
  workspace: ControlWorkspaceProjection
): LifecycleProjection {
  if (!domain || domain === "CORE") {
    return { ready: false, blocked: false, orientation_required: true, reasons: ["AUTHORING_DOMAIN_UNRESOLVED"] };
  }

  if (domain === "GEOMETRY") {
    return { ready: true, blocked: false, orientation_required: false, reasons: [] };
  }

  if (!workspace.available) {
    return {
      ready: false,
      blocked: false,
      orientation_required: true,
      reasons: ["WORKSPACE_LIFECYCLE_UNAVAILABLE"],
    };
  }

  const geometry = normalizedGate(workspace.gates.geometry);
  const uv = normalizedGate(workspace.gates.uv_layout);
  const texturing = normalizedGate(workspace.gates.texturing);
  const reasons: string[] = [];

  if (geometry !== "APPROVED") reasons.push("GEOMETRY_APPROVAL_REQUIRED");
  if (uv !== "PASS") reasons.push("UV_LAYOUT_PASS_REQUIRED");
  if (domain === "ANIMATION" && texturing !== "APPROVED") {
    reasons.push("TEXTURE_APPROVAL_REQUIRED");
  }

  return {
    ready: reasons.length === 0,
    blocked: reasons.length > 0,
    orientation_required: false,
    reasons,
  };
}

export function buildReadiness(
  snapshot: ControlSnapshot,
  workspace: ControlWorkspaceProjection,
  reference: ControlReferenceProjection,
  mode: ControlTaskMode,
  lifecycle: LifecycleProjection,
  activeReferenceReadiness: string | null
): ControlReadiness {
  // Readiness describes the Runtime transport consistently across task modes.
  // System development may proceed independently of Runtime, but must never
  // misreport an unready MCP client as runtime_ready.
  const handshakePending =
    snapshot.runtime.online &&
    snapshot.runtime.mcp_client_ready === false &&
    !snapshot.blockers.includes("RUNTIME_CLIENT_NOT_READY");
  const runtimeReady =
    snapshot.runtime.online &&
    snapshot.runtime.mcp_client_ready === true &&
    !snapshot.runtime.catalog_stale &&
    !snapshot.blockers.includes("RUNTIME_CLIENT_NOT_READY");
  // Missing internal evidence differs from an initial handshake or known
  // failure: do not claim readiness and give the caller an actionable reason.
  const clientStateUnknown =
    snapshot.runtime.online &&
    snapshot.runtime.mcp_client_ready === undefined &&
    !snapshot.blockers.includes("RUNTIME_CLIENT_NOT_READY");

  if (mode === "SYSTEM_DEVELOPMENT") {
    return {
      modelling_start: "NEEDS_ORIENTATION",
      runtime_ready: runtimeReady,
      project_ready: false,
      domain_ready: false,
      context_ready: true,
      workspace_state: "NOT_REQUIRED",
      reasons: [
        "SYSTEM_DEVELOPMENT_MODE",
        ...(handshakePending ? ["RUNTIME_HANDSHAKE_PENDING"] : []),
        ...(clientStateUnknown ? ["RUNTIME_CLIENT_STATE_UNKNOWN"] : []),
        ...(snapshot.blockers.includes("RUNTIME_CLIENT_NOT_READY")
          ? ["RUNTIME_CLIENT_NOT_READY"]
          : []),
      ],
    };
  }

  const projectReady = snapshot.project.binding === "BOUND";
  const domainReady = snapshot.authoring.domain !== null;
  const requiredContextUnavailable =
    snapshot.blockers.includes("REQUIRED_CONTEXT_UNAVAILABLE");
  // This only proves required Skill/Profile handles are resolvable in Control.
  // The client is responsible for actually loading their contents; a handle
  // hash alone is not evidence that the AI has read or applied the guidance.
  const contextReady =
    snapshot.context.required.length > 0 && !requiredContextUnavailable;
  const referenceStatus = activeReferenceReadiness?.trim().toUpperCase() || null;
  const activeReferenceBlocked = referenceStatus === "BLOCKED";
  // A declared non-ready source must never be promoted to start READY.
  // A missing declaration retains legacy orientation behavior for now.
  const activeReferencePending = referenceStatus !== null &&
    referenceStatus !== "READY" && !activeReferenceBlocked;
  const animationRequirementMismatch =
    snapshot.authoring.domain === "ANIMATION" &&
    workspace.available &&
    animationRequirementConflict(reference, workspace);
  const projectionIncomplete =
    relevantTruncatedSectionsForAuthoringDomain(snapshot.authoring.domain, reference).length > 0;
  const workspaceIncomplete = (workspace.blockers_omitted_count ?? 0) > 0;
  const workspaceIssues = workspace.available ? (workspace.workspace_issues ?? []) : [];
  const workspaceBlockersUnresolved = workspace.available && workspace.blockers.length > 0;
  const reasons: string[] = [];

  if (!snapshot.runtime.online) reasons.push("RUNTIME_OFFLINE");
  if (handshakePending) reasons.push("RUNTIME_HANDSHAKE_PENDING");
  if (clientStateUnknown) reasons.push("RUNTIME_CLIENT_STATE_UNKNOWN");
  if (snapshot.runtime.catalog_stale) reasons.push("CATALOG_STALE");
  if (snapshot.blockers.includes("RUNTIME_CLIENT_NOT_READY")) reasons.push("RUNTIME_CLIENT_NOT_READY");
  if (snapshot.blockers.includes("PROJECT_CONTEXT_UNVERIFIED")) reasons.push("PROJECT_CONTEXT_UNVERIFIED");
  if (!projectReady) reasons.push("PROJECT_NOT_BOUND");
  if (!domainReady) reasons.push("AUTHORING_DOMAIN_UNRESOLVED");
  if (requiredContextUnavailable) reasons.push("REQUIRED_CONTEXT_UNAVAILABLE");
  else if (!contextReady) reasons.push("REQUIRED_CONTEXT_UNRESOLVED");
  if (!reference.available) reasons.push("REFERENCE_PACKAGE_UNAVAILABLE");
  if (projectionIncomplete) reasons.push("REFERENCE_PROJECTION_INCOMPLETE");
  if (workspaceIncomplete) reasons.push("WORKSPACE_PROJECTION_INCOMPLETE");
  if (workspaceBlockersUnresolved) reasons.push("WORKSPACE_BLOCKERS_REQUIRE_REVIEW");
  reasons.push(...workspaceIssues);
  if (activeReferenceBlocked) reasons.push("REFERENCE_STAGE_BLOCKED");
  if (activeReferencePending) {
    reasons.push(referenceStatus === "NEEDS_REVIEW"
      ? "REFERENCE_STAGE_NEEDS_REVIEW"
      : referenceStatus === "NOT_REQUIRED"
        ? "REFERENCE_STAGE_NOT_REQUIRED"
        : "REFERENCE_STAGE_READINESS_INVALID");
  }
  if (animationRequirementMismatch) reasons.push("ANIMATION_REQUIREMENT_CONFLICT");
  reasons.push(...lifecycle.reasons.filter((reason) => !reasons.includes(reason)));

  // The first healthy /health probe still needs orientation, not a false
  // "connection failed" blocker. A previously failed MCP stays blocked.
  const blocked =
    (!runtimeReady && !handshakePending) ||
    (snapshot.project.affinity_uuid !== null && !projectReady) ||
    activeReferenceBlocked ||
    requiredContextUnavailable ||
    lifecycle.blocked;

  return {
    modelling_start: blocked
      ? "BLOCKED"
      : runtimeReady && projectReady && domainReady && contextReady &&
          reference.available && !activeReferencePending &&
          !animationRequirementMismatch &&
          !projectionIncomplete && !workspaceIncomplete &&
          !workspaceBlockersUnresolved && workspaceIssues.length === 0 &&
          !lifecycle.orientation_required
        ? "READY"
        : "NEEDS_ORIENTATION",
    runtime_ready: runtimeReady,
    project_ready: projectReady,
    domain_ready: domainReady,
    context_ready: contextReady,
    workspace_state: workspace.available ? "AVAILABLE" : "UNAVAILABLE",
    reasons,
  };
}


