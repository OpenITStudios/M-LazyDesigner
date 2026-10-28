import type { VerificationRisk } from "@/lib/orchestration/deltaVerification";
import type { VerificationEvidenceHandle } from "@/lib/orchestration/evidenceRegistry";
import type { VerificationEvidenceRequest } from "@/lib/orchestration/evidencePlan";
import type { ModelView, VisualEvidenceTarget } from "@/lib/reference/visualEvidence";

export type MinecraftQualityClass =
  | "REQUIRED_PART"
  | "TOPOLOGY_ATTACHMENT"
  | "PRIMARY_FORM"
  | "NEGATIVE_SPACE_CONTACT"
  | "RIG_MOTION_READINESS"
  | "SECONDARY_DETAIL"
  | "TEXTURE_MATERIAL"
  | "ANIMATION_MOTION"
  | "UNCLASSIFIED";

export type MinecraftQualityOwner =
  | "GEOMETRY"
  | "RIG"
  | "TEXTURE"
  | "ANIMATION"
  | "UNKNOWN";

export type MinecraftCauseFamily =
  | "MISSING_REQUIRED_PART"
  | "EXTRA_UNSUPPORTED_PART"
  | "WRONG_ATTACHMENT"
  | "POSITION_MISMATCH"
  | "SIZE_MISMATCH"
  | "ORIENTATION_MISMATCH"
  | "LAYER_SEPARATION"
  | "CONTACT_GAP"
  | "PIVOT_MISMATCH"
  | "MATERIAL_MISMATCH"
  | "MOTION_MISMATCH"
  | "UNKNOWN";

export type MinecraftRepairRoute =
  | "ADD_MASS"
  | "REMOVE_MASS"
  | "REATTACH"
  | "TRANSLATE"
  | "RESIZE"
  | "ROTATE"
  | "LAYER_OFFSET"
  | "RIG_INSPECTION"
  | "TEXTURE_EDIT"
  | "ANIMATION_EDIT"
  | "MORE_EVIDENCE";

export type MinecraftEvidenceNeed =
  | {
      action: "CAPTURE_VISUAL_EVIDENCE";
      capability: "capture_model_views";
      evidence_targets: VisualEvidenceTarget[];
      verification_risk: VerificationRisk;
      selection: "RUNTIME_MINIMUM_TARGET_COVERAGE";
    }
  | {
      action: "INSPECT_RIG_STATE";
      capability: "inspect_elements";
    }
  | {
      action: "INSPECT_TEXTURE_STATE";
      capability: "get_texture";
    }
  | {
      action: "INSPECT_ANIMATION_STATE";
      capability: "inspect_animation";
    }
  | {
      action: "CLASSIFY_CAUSE";
      capability: null;
    }
  | null;

export type VerificationDiscrepancy = {
  code: string;
  severity: "INFO" | "REVIEW" | "BLOCKING";
  summary: string;
  views?: ModelView[];
  evidence_targets?: VisualEvidenceTarget[];
  /**
   * Explicit evidence classification only. Producers must not infer this from
   * prose wording. Missing classification stays UNCLASSIFIED downstream.
   */
  quality_class?: MinecraftQualityClass;
  owner?: MinecraftQualityOwner;
  cause_family?: MinecraftCauseFamily;
};

/**
 * Correction and convergence use discrepancy code as an identity key.
 * Duplicate identities must never silently overwrite other claims.
 */
export function duplicateDiscrepancyCodes(
  items: readonly Pick<VerificationDiscrepancy, "code">[]
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const code = typeof item.code === "string" ? item.code.trim() : "";
    if (!code) continue;
    if (seen.has(code)) duplicates.add(code);
    seen.add(code);
  }
  return [...duplicates];
}

export function assertUniqueDiscrepancyCodes(
  items: readonly Pick<VerificationDiscrepancy, "code">[]
): void {
  if (items.some((item) => typeof item.code !== "string" ||
      !item.code.trim() || item.code !== item.code.trim())) {
    throw new Error("INVALID_DISCREPANCY_CODE: use a nonempty, trimmed identity.");
  }
  const duplicate = duplicateDiscrepancyCodes(items);
  if (duplicate.length) {
    throw new Error(
      "DUPLICATE_DISCREPANCY_CODE: " + duplicate.join(", ") +
      ". Each correction claim needs its own stable code."
    );
  }
}

export type CompactVerificationEvidence = {
  evidence_handle: VerificationEvidenceHandle;
  domain: VerificationEvidenceRequest["domain"];
  source: VerificationEvidenceRequest["source"];
  state: "CLEAR" | "REVIEW_REQUIRED" | "BLOCKED";
  discrepancy_count: number;
  discrepancies: VerificationDiscrepancy[];
};

const MAX_DISCREPANCIES = 6;

const SEVERITY_PRIORITY: Readonly<Record<VerificationDiscrepancy["severity"], number>> = {
  BLOCKING: 0,
  REVIEW: 1,
  INFO: 2,
};

const QUALITY_PRIORITY: Readonly<Record<MinecraftQualityClass, number>> = {
  REQUIRED_PART: 0,
  TOPOLOGY_ATTACHMENT: 1,
  PRIMARY_FORM: 2,
  NEGATIVE_SPACE_CONTACT: 3,
  RIG_MOTION_READINESS: 4,
  TEXTURE_MATERIAL: 5,
  ANIMATION_MOTION: 5,
  SECONDARY_DETAIL: 6,
  UNCLASSIFIED: 7,
};

const CAUSE_REPAIR_ROUTE: Readonly<Record<MinecraftCauseFamily, MinecraftRepairRoute>> = {
  MISSING_REQUIRED_PART: "ADD_MASS",
  EXTRA_UNSUPPORTED_PART: "REMOVE_MASS",
  WRONG_ATTACHMENT: "REATTACH",
  POSITION_MISMATCH: "TRANSLATE",
  SIZE_MISMATCH: "RESIZE",
  ORIENTATION_MISMATCH: "ROTATE",
  LAYER_SEPARATION: "LAYER_OFFSET",
  CONTACT_GAP: "LAYER_OFFSET",
  PIVOT_MISMATCH: "RIG_INSPECTION",
  MATERIAL_MISMATCH: "TEXTURE_EDIT",
  MOTION_MISMATCH: "ANIMATION_EDIT",
  UNKNOWN: "MORE_EVIDENCE",
};

/** Validate untrusted cause codes against the one canonical diagnosis-to-route map. */
export function isMinecraftCauseFamily(value: unknown): value is MinecraftCauseFamily {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CAUSE_REPAIR_ROUTE, value);
}

function qualityClassOf(
  discrepancy: VerificationDiscrepancy
): MinecraftQualityClass {
  return discrepancy.quality_class ?? "UNCLASSIFIED";
}

/**
 * Difference-first ordering for Minecraft authoring.
 *
 * This never classifies free-form prose. It only uses explicit producer-owned
 * quality metadata, otherwise preserving original order among equally ranked
 * UNCLASSIFIED discrepancies.
 */
export function prioritizeMinecraftDiscrepancies(
  discrepancies: readonly VerificationDiscrepancy[]
): VerificationDiscrepancy[] {
  return discrepancies
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      SEVERITY_PRIORITY[left.item.severity] -
        SEVERITY_PRIORITY[right.item.severity] ||
      QUALITY_PRIORITY[qualityClassOf(left.item)] -
        QUALITY_PRIORITY[qualityClassOf(right.item)] ||
      left.index - right.index
    )
    .map(({ item }) => item);
}

export function diagnoseMinecraftDiscrepancy(
  discrepancy: VerificationDiscrepancy
): {
  evidence_backed: boolean;
  owner: MinecraftQualityOwner;
  cause_family: MinecraftCauseFamily;
  repair_route: MinecraftRepairRoute;
  needs_more_evidence: boolean;
} {
  const owner = discrepancy.owner ?? "UNKNOWN";
  const cause = discrepancy.cause_family ?? "UNKNOWN";
  const evidenceBacked = owner !== "UNKNOWN" && cause !== "UNKNOWN";
  return {
    evidence_backed: evidenceBacked,
    owner,
    cause_family: cause,
    repair_route: evidenceBacked ? CAUSE_REPAIR_ROUTE[cause] : "MORE_EVIDENCE",
    needs_more_evidence: !evidenceBacked,
  };
}

/**
 * Selects the minimum existing evidence path needed to resolve an uncertain
 * Minecraft discrepancy. Visual requests pass only evidence targets + risk;
 * capture_model_views owns deterministic minimum view/resolution selection.
 */
export function selectMinecraftEvidenceNeed(
  discrepancy: VerificationDiscrepancy,
  verificationRisk: VerificationRisk = "LOW"
): MinecraftEvidenceNeed {
  const diagnosis = diagnoseMinecraftDiscrepancy(discrepancy);
  if (diagnosis.evidence_backed) return null;

  if (diagnosis.owner === "RIG") {
    return { action: "INSPECT_RIG_STATE", capability: "inspect_elements" };
  }
  if (diagnosis.owner === "TEXTURE") {
    return { action: "INSPECT_TEXTURE_STATE", capability: "get_texture" };
  }
  if (diagnosis.owner === "ANIMATION") {
    return { action: "INSPECT_ANIMATION_STATE", capability: "inspect_animation" };
  }

  const targets = [...new Set(discrepancy.evidence_targets ?? [])];
  if (targets.length > 0) {
    return {
      action: "CAPTURE_VISUAL_EVIDENCE",
      capability: "capture_model_views",
      evidence_targets: targets,
      verification_risk: verificationRisk,
      selection: "RUNTIME_MINIMUM_TARGET_COVERAGE",
    };
  }

  return { action: "CLASSIFY_CAUSE", capability: null };
}

export function minecraftQualityFocus(
  discrepancies: readonly VerificationDiscrepancy[],
  verificationRisk: VerificationRisk = "LOW"
): {
  code: string;
  severity: VerificationDiscrepancy["severity"];
  quality_class: MinecraftQualityClass;
  owner: MinecraftQualityOwner;
  cause_family: MinecraftCauseFamily;
  repair_route: MinecraftRepairRoute;
  evidence_backed_cause: boolean;
  evidence_need: MinecraftEvidenceNeed;
  views: ModelView[];
  evidence_targets: VisualEvidenceTarget[];
} | null {
  const focus = prioritizeMinecraftDiscrepancies(discrepancies)[0];
  if (!focus) return null;
  const diagnosis = diagnoseMinecraftDiscrepancy(focus);
  return {
    code: focus.code,
    severity: focus.severity,
    quality_class: qualityClassOf(focus),
    owner: diagnosis.owner,
    cause_family: diagnosis.cause_family,
    repair_route: diagnosis.repair_route,
    evidence_backed_cause: diagnosis.evidence_backed,
    evidence_need: selectMinecraftEvidenceNeed(focus, verificationRisk),
    views: [...(focus.views ?? [])],
    evidence_targets: [...(focus.evidence_targets ?? [])],
  };
}

export function compactVerificationEvidence(
  request: VerificationEvidenceRequest,
  handle: VerificationEvidenceHandle,
  discrepancies: readonly VerificationDiscrepancy[]
): CompactVerificationEvidence {
  const prioritized = prioritizeMinecraftDiscrepancies(discrepancies);
  const bounded = prioritized.slice(0, MAX_DISCREPANCIES);
  const state = request.source === null || discrepancies.some((item) => item.severity === "BLOCKING")
    ? "BLOCKED"
    : discrepancies.some((item) => item.severity === "REVIEW")
      ? "REVIEW_REQUIRED"
      : "CLEAR";

  return {
    evidence_handle: handle,
    domain: request.domain,
    source: request.source,
    state,
    discrepancy_count: discrepancies.length,
    discrepancies: bounded,
  };
}
