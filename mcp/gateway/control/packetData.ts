import type { ControlReferenceProjection } from "./referenceTypes";
import type { ControlWorkspaceProjection } from "./workspace";

export type ControlWorkspaceSummary = Pick<
  ControlWorkspaceProjection,
  "available" | "fingerprint" | "asset" | "unavailable_reason"
> & {
  /** Canonical README pointer when lifecycle/proof blockers require review. */
  blocker_recovery?: { source_path: string | null; omitted_count: number };
  /** Included only at Finalization/Complete; no native hash in normal authoring. */
  finalization_native_revision?: ControlWorkspaceProjection["finalization_native_revision"];
};

export type ControlReferenceSummary = Pick<
  ControlReferenceProjection,
  | "available"
  | "fingerprint"
  | "asset_name"
  | "asset_kind"
  | "selected_profile"
  | "particle"
  | "unavailable_reason"
>;

export function emptyWorkspace(): ControlWorkspaceProjection {
  return {
    available: false,
    source_path: null,
    fingerprint: null,
    asset: null,
    current_stage: null,
    gates: {
      geometry: null,
      uv_layout: null,
      texturing: null,
      animation: null,
    },
    next_step: null,
    blockers: [],
    unavailable_reason: "PROJECT_PATH_UNAVAILABLE",
  };
}

export function workspaceSummary(
  workspace: ControlWorkspaceProjection
): ControlWorkspaceSummary {
  // Only return a path when the agent needs the unresolved source facts.
  // Avoid copying free-form blocker text into every status response.
  const needsSourceReview = workspace.available && (
    workspace.blockers.length > 0 ||
    (workspace.workspace_issues?.length ?? 0) > 0 ||
    (workspace.blockers_omitted_count ?? 0) > 0
  );
  return {
    available: workspace.available,
    fingerprint: workspace.fingerprint,
    asset: workspace.asset,
    ...(workspace.finalization_native_revision
      ? { finalization_native_revision: workspace.finalization_native_revision }
      : {}),
    ...(needsSourceReview
      ? { blocker_recovery: {
          source_path: workspace.source_path,
          omitted_count: workspace.blockers_omitted_count ?? 0,
        } }
      : {}),
    ...(workspace.unavailable_reason
      ? { unavailable_reason: workspace.unavailable_reason }
      : {}),
  };
}

export function referenceSummary(
  reference: ControlReferenceProjection
): ControlReferenceSummary {
  return {
    available: reference.available,
    fingerprint: reference.fingerprint,
    asset_name: reference.asset_name,
    asset_kind: reference.asset_kind,
    selected_profile: reference.selected_profile,
    particle: reference.particle,
    ...(reference.unavailable_reason
      ? { unavailable_reason: reference.unavailable_reason }
      : {}),
  };
}
