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
};

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
  const animationExcluded = animationRequirement === false;
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
  if (stages.geometry === "BLOCKED") blockers.push("GEOMETRY_BLOCKED");
  if (stages.uv_layout === "BLOCKED") blockers.push("UV_LAYOUT_BLOCKED");
  if (stages.texturing === "BLOCKED") blockers.push("TEXTURING_BLOCKED");
  if (stages.animation === "BLOCKED") blockers.push("ANIMATION_BLOCKED");
  blockers.push(
    ...input.workspace.blockers.filter((entry) => !blockers.includes(entry))
  );

  const requiredStates = [
    stages.reference,
    stages.geometry,
    stages.uv_layout,
    stages.texturing,
    ...(!animationExcluded ? [stages.animation] : []),
  ];

  const overall: AssetHealthSummary["overall"] =
    blockers.length > 0 || requiredStates.includes("BLOCKED")
      ? "BLOCKED"
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
      "Declared workspace/reference gate summary only, not independent user approval, visual/native/export proof. Unknown Animation requirement never implies NOT_REQUIRED.",
  };
}
