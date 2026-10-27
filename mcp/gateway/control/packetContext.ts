import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/semantic/canonical";
import type { DevelopmentResolution } from "../development/intent";
import type { ControlReferenceProjection } from "./referenceTypes";
import type { ControlWorkspaceProjection } from "./workspace";
import type {
  ControlContextHandle,
  ControlSnapshot,
} from "./types";
import { stageReferenceSemanticFingerprint } from "./contextProjection";
import type { ContextResolutionIssue } from "./contexts";
import { semanticRevisionForDependencies } from "../development/semanticDependencies";

export type ControlContextDelivery = {
  required: ControlContextHandle[];
  optional: ControlContextHandle[];
  cached_ids: string[];
  invalidated_ids: string[];
  unavailable?: ContextResolutionIssue[];
};

export type ControlTaskMode = "ASSET_AUTHORING" | "SYSTEM_DEVELOPMENT";

function runtimeContextIdentity(snapshot: ControlSnapshot): string {
  // Build identity can survive a Runtime restart. The Runtime signature
  // includes instance, Stage and exposed surface, so it owns task-cohort
  // freshness. Fall back to the build only if no signature is available.
  return snapshot.runtime.runtime_signature ?? snapshot.runtime.build_identity ?? "offline";
}

export function taskContextId(
  snapshot: ControlSnapshot,
  workspace: ControlWorkspaceProjection,
  reference: ControlReferenceProjection,
  mode: ControlTaskMode,
  development: DevelopmentResolution | null,
  currentUserDelta: string | null
): string {
  const payload =
    mode === "SYSTEM_DEVELOPMENT"
      ? {
          mode,
          runtime: runtimeContextIdentity(snapshot),
          development_domain:
            development?.domain ?? "no-development-domain",
          development_intent:
            development?.intent ?? "no-development-intent",
        }
      : {
          mode,
          project_affinity:
            snapshot.project.affinity_uuid ?? "unbound",
          authoring_phase:
            snapshot.authoring.phase ?? "unknown",
          runtime: runtimeContextIdentity(snapshot),
          workspace:
            workspace.fingerprint ?? "no-workspace-state",
          reference:
            stageReferenceSemanticFingerprint(
              snapshot.authoring.domain,
              reference
            ),
          user_delta:
            currentUserDelta ?? "no-user-delta",
        };
  return `task:${createHash("sha256")
    .update(canonicalJson(payload))
    .digest("hex")
    .slice(0, 20)}`;
}

function contextFamily(id: string): string {
  const at = id.lastIndexOf("@");
  const versionless = at > 0 ? id.slice(0, at) : id;

  // Only one specialist and one Geometry profile may be active. Treat their
  // concrete labels as members of a broad supersession family so a phase/profile
  // change explicitly invalidates the prior handle instead of leaving two
  // authoritative guidance sources live in the client context.
  if (versionless.startsWith("ctx:skill/")) return "ctx:skill";
  if (versionless.startsWith("ctx:profile/")) return "ctx:profile";
  return versionless;
}

export function filterContext(
  snapshot: ControlSnapshot,
  knownContextIds: readonly string[],
  mode: ControlTaskMode
): ControlContextDelivery {
  if (mode === "SYSTEM_DEVELOPMENT") {
    return { required: [], optional: [], cached_ids: [], invalidated_ids: [] };
  }

  const known = new Set(knownContextIds);
  const current = [...snapshot.context.required, ...snapshot.context.optional];
  const currentIds = new Set(current.map((handle) => handle.id));
  const semanticallyFreshIds = new Set(
    current
      .filter(
        (handle) =>
          handle.semantic_revision ===
          semanticRevisionForDependencies(handle.semantic_dependencies)
      )
      .map((handle) => handle.id)
  );
  const currentFamilies = new Set(current.map((handle) => contextFamily(handle.id)));

  return {
    required: snapshot.context.required.filter(
      (handle) =>
        !known.has(handle.id) || !semanticallyFreshIds.has(handle.id)
    ),
    optional: snapshot.context.optional.filter(
      (handle) =>
        !known.has(handle.id) || !semanticallyFreshIds.has(handle.id)
    ),
    cached_ids: current
      .filter(
        (handle) =>
          known.has(handle.id) && semanticallyFreshIds.has(handle.id)
      )
      .map((handle) => handle.id),
    invalidated_ids: knownContextIds.filter(
      (id) =>
        (!currentIds.has(id) &&
          (currentFamilies.has(contextFamily(id)) ||
            // A geometry-only profile must be discarded when Texturing or
            // Animation no longer requires any modelling profile. Likewise,
            // an unresolved stage must not retain the previous specialist.
            contextFamily(id) === "ctx:profile" ||
            contextFamily(id) === "ctx:skill")) ||
        (currentIds.has(id) && !semanticallyFreshIds.has(id))
    ),
  };
}
