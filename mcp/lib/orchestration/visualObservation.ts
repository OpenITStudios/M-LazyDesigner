import type {
  MinecraftCauseFamily,
  MinecraftQualityClass,
  MinecraftQualityOwner,
  VerificationDiscrepancy,
} from "@/lib/orchestration/compactEvidence";
import { duplicateDiscrepancyCodes, isMinecraftCauseFamily } from "@/lib/orchestration/compactEvidence";
import {
  MODEL_VIEWS,
  VISUAL_EVIDENCE_TARGETS,
  type ModelView,
  type VisualEvidenceTarget,
} from "@/lib/reference/visualEvidence";

export type VisualObservationCriterion =
  | "REQUIRED_PART_COMPLETENESS"
  | "UNSUPPORTED_EXTRA_PART"
  | "TOPOLOGY_ATTACHMENT"
  | "SILHOUETTE_PROPORTION"
  | "DEPTH_LAYERING"
  | "NEGATIVE_SPACE_CONTACT"
  | "PIVOT_MOTION_READINESS"
  | "SECONDARY_GEOMETRY_DETAIL"
  | "TEXTURE_IDENTITY_MARKING"
  | "TEXTURE_MATERIAL_REGION"
  | "TEXTURE_MAPPED_CONTINUITY"
  | "TEXTURE_PIXEL_READABILITY"
  | "ANIMATION_POSE_SILHOUETTE"
  | "ANIMATION_CONTACT"
  | "ANIMATION_TIMING_PHASE"
  | "ANIMATION_WEIGHT_TRANSFER"
  | "ANIMATION_SECONDARY_MOTION";

export type StructuredVisualObservation = {
  code: string;
  criterion: VisualObservationCriterion;
  severity: VerificationDiscrepancy["severity"];
  summary: string;
  evidence: {
    current_evidence_ref: string | null;
    reference_evidence_ref?: string | null;
    views?: ModelView[];
    evidence_targets?: VisualEvidenceTarget[];
    phase_or_time?: string | null;
  };
  /**
   * Cause may be supplied only when separately supported by evidence.
   * The compiler never derives cause from summary text.
   */
  cause_family?: MinecraftCauseFamily;
};

export type CompiledVisualObservation =
  | {
      state: "SUPPORTED";
      discrepancy: VerificationDiscrepancy;
    }
  | {
      state: "UNVERIFIED";
      discrepancy: null;
      reason:
        | "CURRENT_EVIDENCE_REQUIRED"
        | "REFERENCE_EVIDENCE_REQUIRED"
        | "OBSERVATION_INVALID";
    };

type CriterionContract = {
  quality_class: MinecraftQualityClass;
  owner: MinecraftQualityOwner;
  requires_reference: boolean;
};

const CRITERION_CONTRACT: Readonly<
  Record<VisualObservationCriterion, CriterionContract>
> = {
  REQUIRED_PART_COMPLETENESS: {
    quality_class: "REQUIRED_PART",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  UNSUPPORTED_EXTRA_PART: {
    quality_class: "REQUIRED_PART",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  TOPOLOGY_ATTACHMENT: {
    quality_class: "TOPOLOGY_ATTACHMENT",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  SILHOUETTE_PROPORTION: {
    quality_class: "PRIMARY_FORM",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  DEPTH_LAYERING: {
    quality_class: "PRIMARY_FORM",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  NEGATIVE_SPACE_CONTACT: {
    quality_class: "NEGATIVE_SPACE_CONTACT",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  PIVOT_MOTION_READINESS: {
    quality_class: "RIG_MOTION_READINESS",
    owner: "RIG",
    requires_reference: false,
  },
  SECONDARY_GEOMETRY_DETAIL: {
    quality_class: "SECONDARY_DETAIL",
    owner: "GEOMETRY",
    requires_reference: true,
  },
  TEXTURE_IDENTITY_MARKING: {
    quality_class: "TEXTURE_MATERIAL",
    owner: "TEXTURE",
    requires_reference: true,
  },
  TEXTURE_MATERIAL_REGION: {
    quality_class: "TEXTURE_MATERIAL",
    owner: "TEXTURE",
    requires_reference: true,
  },
  TEXTURE_MAPPED_CONTINUITY: {
    quality_class: "TEXTURE_MATERIAL",
    owner: "TEXTURE",
    requires_reference: false,
  },
  TEXTURE_PIXEL_READABILITY: {
    quality_class: "TEXTURE_MATERIAL",
    owner: "TEXTURE",
    requires_reference: true,
  },
  ANIMATION_POSE_SILHOUETTE: {
    quality_class: "ANIMATION_MOTION",
    owner: "ANIMATION",
    requires_reference: true,
  },
  ANIMATION_CONTACT: {
    quality_class: "ANIMATION_MOTION",
    owner: "ANIMATION",
    requires_reference: false,
  },
  ANIMATION_TIMING_PHASE: {
    quality_class: "ANIMATION_MOTION",
    owner: "ANIMATION",
    requires_reference: true,
  },
  ANIMATION_WEIGHT_TRANSFER: {
    quality_class: "ANIMATION_MOTION",
    owner: "ANIMATION",
    requires_reference: true,
  },
  ANIMATION_SECONDARY_MOTION: {
    quality_class: "ANIMATION_MOTION",
    owner: "ANIMATION",
    requires_reference: true,
  },
};

/** A source-dependent Geometry shape claim must name the actual compared view. */
const GEOMETRY_VIEW_CRITERIA: ReadonlySet<VisualObservationCriterion> = new Set([
  "REQUIRED_PART_COMPLETENESS",
  "UNSUPPORTED_EXTRA_PART",
  "TOPOLOGY_ATTACHMENT",
  "SILHOUETTE_PROPORTION",
  "DEPTH_LAYERING",
  "NEGATIVE_SPACE_CONTACT",
  "SECONDARY_GEOMETRY_DETAIL",
]);

/** A generic Geometry cause must not masquerade as a different structural failure. */
const SPECIFIC_CAUSE_CRITERIA: Partial<Record<
  MinecraftCauseFamily, readonly VisualObservationCriterion[]
>> = {
  MISSING_REQUIRED_PART: ["REQUIRED_PART_COMPLETENESS"],
  EXTRA_UNSUPPORTED_PART: ["UNSUPPORTED_EXTRA_PART"],
  WRONG_ATTACHMENT: ["TOPOLOGY_ATTACHMENT", "NEGATIVE_SPACE_CONTACT"],
  CONTACT_GAP: ["TOPOLOGY_ATTACHMENT", "NEGATIVE_SPACE_CONTACT"],
};

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function knownLabels<T extends string>(
  values: readonly T[] | undefined,
  valid: readonly T[]
): boolean {
  return values === undefined || (
    Array.isArray(values) && values.length <= valid.length &&
    values.every((value) => valid.includes(value))
  );
}

function causeCompatible(
  criterion: VisualObservationCriterion,
  owner: MinecraftQualityOwner,
  cause: MinecraftCauseFamily
): boolean {
  if (cause === "UNKNOWN") return true;
  if (owner === "TEXTURE") return cause === "MATERIAL_MISMATCH";
  if (owner === "ANIMATION") return cause === "MOTION_MISMATCH";
  if (owner === "RIG") return cause === "PIVOT_MISMATCH";
  if (owner !== "GEOMETRY") return false;

  const allowed = SPECIFIC_CAUSE_CRITERIA[cause];
  if (allowed && !allowed.includes(criterion)) return false;
  // A part-presence claim must not turn a size/position observation into an
  // add/remove-mass operation, nor should a silhouette claim invent a part.
  if (criterion === "REQUIRED_PART_COMPLETENESS") return cause === "MISSING_REQUIRED_PART";
  if (criterion === "UNSUPPORTED_EXTRA_PART") return cause === "EXTRA_UNSUPPORTED_PART";
  return cause !== "PIVOT_MISMATCH" &&
    cause !== "MATERIAL_MISMATCH" && cause !== "MOTION_MISMATCH";
}

/**
 * Converts one explicit, evidence-backed visual observation into the existing
 * correction discrepancy vocabulary.
 *
 * No NLP/prose inference happens here. Criterion selects the quality owner;
 * cause remains evidence-owned and optional.
 */
export function compileStructuredVisualObservation(
  input: StructuredVisualObservation
): CompiledVisualObservation {
  // Well-formed metadata is necessary but does not attest that reference
  // pixels, native captures or their pairing were independently reviewed.
  // Unrecognized codes must never enter sorting or causal repair routing.
  if (
    !input || typeof input !== "object" ||
    !input.evidence || typeof input.evidence !== "object" ||
    !Object.prototype.hasOwnProperty.call(CRITERION_CONTRACT, input.criterion) ||
    !["INFO", "REVIEW", "BLOCKING"].includes(input.severity) ||
    !knownLabels(input.evidence.views, MODEL_VIEWS) ||
    !knownLabels(input.evidence.evidence_targets, VISUAL_EVIDENCE_TARGETS) ||
    (input.cause_family !== undefined && !isMinecraftCauseFamily(input.cause_family)) ||
    !nonEmpty(input.code) ||
    !nonEmpty(input.summary) ||
    input.summary.trim().length > 240
  ) {
    return {
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "OBSERVATION_INVALID",
    };
  }

  if (!nonEmpty(input.evidence.current_evidence_ref)) {
    return {
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "CURRENT_EVIDENCE_REQUIRED",
    };
  }

  const contract = CRITERION_CONTRACT[input.criterion];
  if (
    contract.requires_reference &&
    !nonEmpty(input.evidence.reference_evidence_ref)
  ) {
    return {
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "REFERENCE_EVIDENCE_REQUIRED",
    };
  }

  // Source and model evidence labels are not interchangeable. For material
  // Geometry comparisons, require at least one real view identity to be
  // checked by the reviewing client; this is NOT native image attestation.
  if (contract.requires_reference && (
    input.evidence.reference_evidence_ref?.trim() ===
      input.evidence.current_evidence_ref?.trim() ||
    (GEOMETRY_VIEW_CRITERIA.has(input.criterion) &&
      !input.evidence.views?.length)
  )) {
    return {
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "OBSERVATION_INVALID",
    };
  }

  const cause = input.cause_family;
  if (cause !== undefined && !causeCompatible(input.criterion, contract.owner, cause)) {
    return {
      state: "UNVERIFIED",
      discrepancy: null,
      reason: "OBSERVATION_INVALID",
    };
  }

  return {
    state: "SUPPORTED",
    discrepancy: {
      code: input.code.trim(),
      severity: input.severity,
      summary: input.summary.trim(),
      quality_class: contract.quality_class,
      owner: contract.owner,
      ...(cause !== undefined ? { cause_family: cause } : {}),
      ...(input.evidence.views?.length
        ? { views: [...new Set(input.evidence.views)] }
        : {}),
      ...(input.evidence.evidence_targets?.length
        ? {
            evidence_targets: [
              ...new Set(input.evidence.evidence_targets),
            ],
          }
        : {}),
    },
  };
}

export function compileStructuredVisualObservations(
  inputs: readonly StructuredVisualObservation[]
): {
  supported: VerificationDiscrepancy[];
  unverified: Array<{
    code: string;
    reason: Exclude<
      CompiledVisualObservation,
      { state: "SUPPORTED" }
    >["reason"];
  }>;
} {
  const supported: VerificationDiscrepancy[] = [];
  const unverified: Array<{
    code: string;
    reason:
      | "CURRENT_EVIDENCE_REQUIRED"
      | "REFERENCE_EVIDENCE_REQUIRED"
      | "OBSERVATION_INVALID";
  }> = [];

  const duplicateCodes = new Set(duplicateDiscrepancyCodes(inputs));
  for (const input of inputs) {
    const normalizedCode = typeof input.code === "string" ? input.code.trim() : "";
    if (duplicateCodes.has(normalizedCode)) {
      unverified.push({ code: normalizedCode, reason: "OBSERVATION_INVALID" });
      continue;
    }
    const result = compileStructuredVisualObservation(input);
    if (result.state === "SUPPORTED") {
      supported.push(result.discrepancy);
    } else {
      unverified.push({
        code: normalizedCode,
        reason: result.reason,
      });
    }
  }

  return { supported, unverified };
}
