import type {
  RecipeFeatureDecision,
  RecipeFeatureIntent,
  RecipeFeaturePlanSummary,
  RecipeFeatureRoute,
  RecipeGeometryReason,
} from "@/lib/authoringRecipe/contracts";

// Feature evidence is supplied by reference-aware Modelling, not inferred
// from Cube names, coordinate sizes, or any unverified visual similarity score.
const REASONS: readonly RecipeGeometryReason[] = [
  "SILHOUETTE", "VOLUME", "NEGATIVE_SPACE", "CONTACT", "LAYERING",
  "TRANSFORM", "MOTION", "TECHNICAL",
];
const ROLES = ["THREE_DIMENSIONAL", "SURFACE_DETAIL", "UNNECESSARY"] as const;
const EVIDENCE = ["SUPPORTED", "PROVISIONAL", "CONFLICTING", "UNAVAILABLE"] as const;
const MAX_FEATURES = 256;
const EXAMPLE_LIMIT = 12;

export function planRecipeFeatureRepresentations(
  features: readonly RecipeFeatureIntent[]
): { state: "ready" | "review_required"; decisions: RecipeFeatureDecision[]; summary: RecipeFeaturePlanSummary } {
  if (!Array.isArray(features) || features.length > MAX_FEATURES) {
    throw new Error("FEATURE_PLAN_BUDGET_EXCEEDED: semantic features must fit the 256-feature planning budget.");
  }
  const seen = new Set<string>();
  const decisions: RecipeFeatureDecision[] = features.map((feature) => {
    if (typeof feature.id !== "string" || !feature.id.trim() || feature.id.length > 128 ||
        typeof feature.label !== "string" || !feature.label.trim() || feature.label.length > 256) {
      throw new Error("FEATURE_IDENTITY_INVALID: feature ID and label must be non-empty and bounded.");
    }
    if (seen.has(feature.id)) {
      throw new Error("FEATURE_IDENTITY_DUPLICATED: " + feature.id);
    }
    seen.add(feature.id);
    if (!ROLES.includes(feature.visual_role) || !EVIDENCE.includes(feature.evidence)) {
      throw new Error("FEATURE_INTENT_INVALID: unknown visual role or evidence state for " + feature.id);
    }
    const refs = feature.evidence_refs ?? [];
    if (!Array.isArray(refs) || refs.length > 8 ||
        refs.some((ref) => typeof ref !== "string" ||
          !ref.trim() || ref.length > 160)) {
      throw new Error("FEATURE_EVIDENCE_REFERENCE_INVALID: " + feature.id);
    }
    const reasons = feature.geometry_reasons ?? [];
    if (!Array.isArray(reasons) ||
        reasons.some((reason) => !REASONS.includes(reason)) ||
        new Set(reasons).size !== reasons.length) {
      throw new Error("FEATURE_GEOMETRY_REASON_INVALID: " + feature.id);
    }
    let route: RecipeFeatureRoute;
    let reason: string;
    if (feature.evidence !== "SUPPORTED") {
      route = "REVIEW_REQUIRED";
      reason = "EVIDENCE_" + feature.evidence;
    } else if (refs.length === 0) {
      route = "REVIEW_REQUIRED";
      reason = "SUPPORTED_EVIDENCE_REFERENCE_MISSING";
    } else if (feature.visual_role === "THREE_DIMENSIONAL") {
      route = reasons.length > 0 ? "GEOMETRY" : "REVIEW_REQUIRED";
      reason = reasons.length > 0 ? "REQUIRED_3D_CONTRIBUTION" : "GEOMETRY_PURPOSE_UNPROVEN";
    } else if (reasons.length > 0) {
      route = "REVIEW_REQUIRED";
      reason = "THREE_DIMENSIONAL_NEED_CONFLICTS_WITH_SURFACE_OR_OMIT";
    } else if (feature.visual_role === "SURFACE_DETAIL") {
      route = "TEXTURE";
      reason = "NO_REQUIRED_3D_CONTRIBUTION";
    } else {
      route = "OMIT";
      reason = "EXPLICITLY_UNNECESSARY_FEATURE";
    }
    return {
      id: feature.id,
      label: feature.label.trim(),
      route,
      reason,
      geometry_reasons: [...reasons],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  const compact = (route: RecipeFeatureRoute) => {
    const entries = decisions.filter((entry) => entry.route === route);
    return {
      count: entries.length,
      examples: entries.slice(0, EXAMPLE_LIMIT).map(({ id, label, reason }) => ({
        id, label, reason,
      })),
      examples_truncated: entries.length > EXAMPLE_LIMIT,
    };
  };
  const state = decisions.some((entry) => entry.route === "REVIEW_REQUIRED")
    ? ("review_required" as const) : ("ready" as const);
  return {
    state,
    decisions,
    summary: {
      state,
      geometry: compact("GEOMETRY"),
      texture_handoff: compact("TEXTURE"),
      omitted: compact("OMIT"),
      unresolved: compact("REVIEW_REQUIRED"),
      visual_verdict: "not_evaluated",
      note: "Feature routing requires explicit source references and 3D necessities. Source references are caller-provided and not independently checked here. Texture is a handoff, not painted pixels; no route proves visual fidelity or authorizes native deletion.",
    },
  };
}
