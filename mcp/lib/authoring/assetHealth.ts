export type AssetHealthDomain =
  | "GEOMETRY"
  | "TEXTURING"
  | "ANIMATION"
  | "CORE";

export type AssetHealthStageState =
  | "PASS"
  | "REVIEW"
  | "BLOCKED"
  | "UNVERIFIED"
  | "NOT_REQUIRED";

export type AssetHealthSummary = {
  overall: "READY" | "REVIEW" | "BLOCKED" | "INCOMPLETE";
  active_domain: AssetHealthDomain | null;
  stages: {
    reference: AssetHealthStageState;
    geometry: AssetHealthStageState;
    uv_layout: AssetHealthStageState;
    texturing: AssetHealthStageState;
    animation: AssetHealthStageState;
  };
  blockers: string[];
  note: string;
};

export type AssetHealthReferenceLike = {
  available: boolean;
  requirements: {
    animation_required: boolean | null;
  };
  readiness: {
    overall: string | null;
    geometry: string | null;
    texture: string | null;
    animation: string | null;
  };
};

export type AssetHealthWorkspaceLike = {
  available: boolean;
  gates: {
    geometry: string | null;
    uv_layout: string | null;
    texturing: string | null;
    animation: string | null;
  };
  blockers: string[];
  animation_required?: boolean | null;
  /** Source declarations may conflict even when the first field says APPROVED. */
  workspace_issues?: string[];
  /** Omitted blocker rows must not permit a whole-asset READY summary. */
  blockers_omitted_count?: number;
};

/** Detect a confirmed requirement conflict without assigning new approval truth. */
export function animationRequirementConflict(
  reference: AssetHealthReferenceLike,
  workspace: AssetHealthWorkspaceLike
): boolean {
  const required = reference.requirements.animation_required;
  const declared = workspace.animation_required;
  return typeof required === "boolean" &&
    typeof declared === "boolean" &&
    required !== declared;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function workspaceGateState(
  value: string | null | undefined,
  passValues: readonly string[]
): AssetHealthStageState {
  const gate = normalized(value);
  if (!gate || gate === "NOT_STARTED") return "UNVERIFIED";
  if (passValues.includes(gate)) return "PASS";
  if (gate === "BLOCKED" || gate === "FAILED" || gate === "FAIL") {
    return "BLOCKED";
  }
  return "REVIEW";
}

function referenceReadinessForDomain(
  domain: AssetHealthDomain | null,
  reference: AssetHealthReferenceLike
): string | null {
  if (domain === "GEOMETRY") return reference.readiness.geometry;
  if (domain === "TEXTURING") return reference.readiness.texture;
  if (domain === "ANIMATION") return reference.readiness.animation;
  return reference.readiness.overall;
}

function referenceState(
  domain: AssetHealthDomain | null,
  reference: AssetHealthReferenceLike
): AssetHealthStageState {
  if (!reference.available) return "UNVERIFIED";
  const value = normalized(referenceReadinessForDomain(domain, reference));
  if (value === "BLOCKED") return "BLOCKED";
  // Reference handoff uses READY, not a technical validator's PASS.
  // Accepting PASS here could make a malformed reference claim look complete.
  if (value === "READY") return "PASS";
  return value ? "REVIEW" : "UNVERIFIED";
}

/**
 * Pure lifecycle summary. It intentionally depends only on structural inputs so
 * the shared lib layer never imports Gateway/Control ownership.
 */
export function buildAssetHealthSummary(input: {
  domain: AssetHealthDomain | null;
  reference: AssetHealthReferenceLike;
  workspace: AssetHealthWorkspaceLike;
}): AssetHealthSummary {
  // Unknown is not false: an unspecified animation requirement must not
  // silently become NOT_REQUIRED. Already APPROVED animation is sufficient
  // even when its original requirement was not projected.
  const animationRequirement = input.reference.requirements.animation_required;
  const requirementConflict = animationRequirementConflict(
    input.reference, input.workspace
  );
  const malformedRequirement = (input.workspace.workspace_issues ?? [])
    .some((reason) => reason.startsWith("WORKSPACE_ANIMATION_REQUIREMENT_"));
  // Only an explicit, uncontested Reference false permits NOT_REQUIRED.
  const animationExcluded = animationRequirement === false &&
    !requirementConflict && !malformedRequirement;
  // Stage reference and whole-package reference serve different decisions.
  // An active Geometry READY must not hide unresolved later-stage package
  // constraints in an all-asset readiness summary.
  const packageReferenceState = referenceState("CORE", input.reference);
  const stages: AssetHealthSummary["stages"] = {
    reference: referenceState(input.domain, input.reference),
    // A technical PASS must never substitute for a persisted user approval.
    geometry: input.workspace.available
      ? workspaceGateState(input.workspace.gates.geometry, ["APPROVED"])
      : "UNVERIFIED",
    // UV Layout is the technical Geometry-owned gate: only PASS is valid.
    uv_layout: input.workspace.available
      ? workspaceGateState(input.workspace.gates.uv_layout, ["PASS"])
      : "UNVERIFIED",
    texturing: input.workspace.available
      ? workspaceGateState(input.workspace.gates.texturing, ["APPROVED"])
      : "UNVERIFIED",
    animation: animationExcluded
      ? "NOT_REQUIRED"
      : input.workspace.available
        ? workspaceGateState(input.workspace.gates.animation, ["APPROVED"])
        : "UNVERIFIED",
  };

  const blockers: string[] = [];
  if (stages.reference === "BLOCKED") blockers.push("REFERENCE_STAGE_BLOCKED");
  if (packageReferenceState === "BLOCKED") {
    blockers.push("REFERENCE_PACKAGE_OVERALL_BLOCKED");
  }
  if (stages.geometry === "BLOCKED") blockers.push("GEOMETRY_BLOCKED");
  if (stages.uv_layout === "BLOCKED") blockers.push("UV_LAYOUT_BLOCKED");
  if (stages.texturing === "BLOCKED") blockers.push("TEXTURING_BLOCKED");
  if (stages.animation === "BLOCKED") blockers.push("ANIMATION_BLOCKED");
  blockers.push(
    ...input.workspace.blockers.filter((entry) => !blockers.includes(entry))
  );

  const requiredStates = [
    stages.reference,
    packageReferenceState,
    stages.geometry,
    stages.uv_layout,
    stages.texturing,
    ...(!animationExcluded ? [stages.animation] : []),
  ];

  // The Control workspace parser can return the first apparently APPROVED
  // gate alongside a conflicting later declaration. A gate summary must not
  // independently claim READY while Control correctly requests orientation.
  const sourceNeedsOrientation =
    requirementConflict ||
    (input.workspace.workspace_issues?.length ?? 0) > 0 ||
    (input.workspace.blockers_omitted_count ?? 0) > 0;
  const overall: AssetHealthSummary["overall"] =
    blockers.length > 0 || requiredStates.includes("BLOCKED")
      ? "BLOCKED"
      : sourceNeedsOrientation
        ? "REVIEW"
        : requiredStates.every((state) => state === "PASS")
          ? "READY"
          : requiredStates.some((state) => state === "REVIEW")
            ? "REVIEW"
            : "INCOMPLETE";

  return {
    overall,
    active_domain: input.domain,
    stages,
    blockers,
    note:
      "Declared gate summary, not independent approval or native/visual/export proof. Stage reference follows the active domain; whole-asset READY also requires Reference Package overall READY. Unknown Animation requirement never implies NOT_REQUIRED.",
  };
}
