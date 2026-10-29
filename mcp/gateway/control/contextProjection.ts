import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/semantic/canonical";
import {
  buildAssetHealthSummary,
  type AssetHealthSummary,
} from "../../lib/authoring/assetHealth";
import type { ControlAuthoringDomain } from "./types";
import type { ControlWorkspaceProjection } from "./workspace";
import type {
  ControlReferenceProjection,
  ControlReferenceSemanticFacts,
  ControlReferenceStage,
  ControlReferenceStructuredFact,
} from "./referencePackage";
import {
  semanticDerivedArtifactStamp,
  type SemanticDerivedArtifactStamp,
} from "../development/semanticArtifact";
import { semanticRevisionForDependencies } from "../development/semanticDependencies";
import { semanticDependenciesForSurface } from "../development/semanticDependencyMatrix";

export type ControlContextType =
  | "GEOMETRY_CONTEXT"
  | "TEXTURE_CONTEXT"
  | "ANIMATION_CONTEXT";

export type ControlStageSemanticFacts = {
  parts: ControlReferenceStructuredFact[];
  articulation: ControlReferenceStructuredFact[];
  materials: ControlReferenceStructuredFact[];
  animation_guidance: ControlReferenceStructuredFact[];
  constraints: string[];
};

export type ControlStageDecisionPacket = {
  parts?: ControlReferenceStructuredFact[];
  articulation?: ControlReferenceStructuredFact[];
  materials?: ControlReferenceStructuredFact[];
  motion?: ControlReferenceStructuredFact[];
  constraints?: string[];
  cross_view_evidence?: ControlReferenceProjection["cross_view_evidence"];
};

export type ControlStageContext = {
  context_type: ControlContextType | null;
  context_hash: string;
  semantic: SemanticDerivedArtifactStamp;
  original_user_intent: string | null;
  current_user_delta: string | null;
  selected_profile: string | null;
  reference_package_id_or_hash: string | null;
  workspace_revision_or_hash: string | null;
  stage_readiness: string | null;
  blocking_unknowns: string[];
  non_blocking_unknowns_relevant_to_stage: string[];
  requirements: ControlReferenceProjection["requirements"];
  semantic_facts: ControlStageSemanticFacts;
  decision_packet: ControlStageDecisionPacket;
  asset_health: AssetHealthSummary;
  // Present only when the current stage has omitted source reference facts.
  // This points to canonical data, not to another Control-owned copy.
  reference_recovery?: {
    source_path: string | null;
    omitted_sections: NonNullable<ControlReferenceProjection["truncated_sections"]>;
  };
  reference_document: string | null;
  reference_image_ids: string[];
  workspace: {
    asset: string | null;
    current_stage: string | null;
    gates: ControlWorkspaceProjection["gates"];
    next_step: string | null;
  };
};

const EMPTY_SEMANTIC_FACTS: ControlReferenceSemanticFacts = {
  parts: [],
  articulation: [],
  materials: [],
  animation_guidance: [],
  constraints: [],
};

const GEOMETRY_PART_KEYS = [
  "id",
  "role",
  "parent",
  "symmetry",
  "motion",
  "evidence",
  "representation",
  "depth",
  "attachment",
  "contact",
  "must_exist",
  "uv_cohort",
  "uv_identity_priority",
  "uv_reuse_policy",
  "uv_density_multiplier",
  "uv_rotation_policy",
] as const;

const ARTICULATION_KEYS = [
  "id",
  "parent",
  "child",
  "motion",
  "pivot_region",
  "axis",
  "preferred_axis",
  "bend_direction",
  "rotation_min",
  "rotation_max",
  "twist_policy",
  "overlap",
  "clearance",
  "contact_invariant",
  "risk",
  "evidence",
] as const;

const MATERIAL_KEYS = [
  "id",
  "name",
  "base_color",
  "surface",
  "surface_character",
  "affected_parts",
  "emissive",
  "pbr",
  "evidence",
] as const;

const MOTION_KEYS = [
  "name",
  "type",
  "purpose",
  "participants",
  "key_poses",
  "contact_events",
  "evidence",
] as const;

function contextType(domain: ControlAuthoringDomain | null): ControlContextType | null {
  if (domain === "GEOMETRY") return "GEOMETRY_CONTEXT";
  if (domain === "TEXTURING") return "TEXTURE_CONTEXT";
  if (domain === "ANIMATION") return "ANIMATION_CONTEXT";
  return null;
}

function referenceStage(domain: ControlAuthoringDomain | null): ControlReferenceStage | null {
  if (domain === "GEOMETRY") return "GEOMETRY";
  if (domain === "TEXTURING") return "TEXTURE";
  if (domain === "ANIMATION") return "ANIMATION";
  return null;
}

export function readinessForAuthoringDomain(
  domain: ControlAuthoringDomain | null,
  reference: ControlReferenceProjection
): string | null {
  if (domain === "GEOMETRY") return reference.readiness.geometry;
  if (domain === "TEXTURING") return reference.readiness.texture;
  if (domain === "ANIMATION") return reference.readiness.animation;
  return reference.readiness.overall;
}

function imagesForStage(
  stage: ControlReferenceStage | null,
  reference: ControlReferenceProjection
) {
  if (!stage) return [];
  return reference.images.filter((image) => image.used_by.includes(stage));
}

function stringField(
  fact: ControlReferenceStructuredFact,
  key: string
): string | null {
  const value = fact[key];
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

function geometryParts(
  parts: readonly ControlReferenceStructuredFact[]
): ControlReferenceStructuredFact[] {
  return parts.filter((part) => {
    const role = stringField(part, "role");
    return role !== "TEXTURE" && role !== "ANIMATION_ONLY" && role !== "OMIT";
  });
}

function animationParts(
  parts: readonly ControlReferenceStructuredFact[]
): ControlReferenceStructuredFact[] {
  return parts.filter((part) => {
    const role = stringField(part, "role");
    const motion = stringField(part, "motion");
    return (
      role === "ANIMATION_ONLY" ||
      role === "EFFECT" ||
      motion === "ARTICULATED" ||
      motion === "FLEXIBLE"
    );
  });
}

function compactFact(
  fact: ControlReferenceStructuredFact,
  keys: readonly string[]
): ControlReferenceStructuredFact {
  const out: ControlReferenceStructuredFact = {};
  for (const key of keys) {
    const value = fact[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function compactFacts(
  facts: readonly ControlReferenceStructuredFact[],
  keys: readonly string[]
): ControlReferenceStructuredFact[] {
  return facts
    .map((fact) => compactFact(fact, keys))
    .filter((fact) => Object.keys(fact).length > 0);
}

export function semanticFactsForAuthoringDomain(
  domain: ControlAuthoringDomain | null,
  reference: ControlReferenceProjection
): ControlStageSemanticFacts {
  const facts = reference.semantic_facts ?? EMPTY_SEMANTIC_FACTS;

  if (domain === "GEOMETRY") {
    return {
      parts: geometryParts(facts.parts),
      articulation: facts.articulation,
      materials: [],
      animation_guidance: [],
      constraints: facts.constraints,
    };
  }

  if (domain === "TEXTURING") {
    return {
      parts: [],
      articulation: [],
      materials: facts.materials,
      animation_guidance: [],
      constraints: facts.constraints,
    };
  }

  if (domain === "ANIMATION") {
    return {
      parts: animationParts(facts.parts),
      articulation: facts.articulation,
      materials: [],
      animation_guidance: facts.animation_guidance,
      constraints: facts.constraints,
    };
  }

  return {
    parts: [],
    articulation: [],
    materials: [],
    animation_guidance: [],
    constraints: facts.constraints,
  };
}

export function decisionPacketForAuthoringDomain(
  domain: ControlAuthoringDomain | null,
  reference: ControlReferenceProjection
): ControlStageDecisionPacket {
  const facts = semanticFactsForAuthoringDomain(domain, reference);
  const packet: ControlStageDecisionPacket = {};

  if (domain === "GEOMETRY") {
    const parts = compactFacts(facts.parts, GEOMETRY_PART_KEYS);
    const articulation = compactFacts(facts.articulation, ARTICULATION_KEYS);
    if (parts.length > 0) packet.parts = parts;
    if (articulation.length > 0) packet.articulation = articulation;
  } else if (domain === "TEXTURING") {
    const materials = compactFacts(facts.materials, MATERIAL_KEYS);
    if (materials.length > 0) packet.materials = materials;
  } else if (domain === "ANIMATION") {
    const parts = compactFacts(facts.parts, GEOMETRY_PART_KEYS);
    const articulation = compactFacts(facts.articulation, ARTICULATION_KEYS);
    const motion = compactFacts(facts.animation_guidance, MOTION_KEYS);
    if (parts.length > 0) packet.parts = parts;
    if (articulation.length > 0) packet.articulation = articulation;
    if (motion.length > 0) packet.motion = motion;
  }

  // Forward source-bound evidence through the existing active Geometry packet.
  if (domain === "GEOMETRY" && reference.cross_view_evidence) {
    packet.cross_view_evidence = reference.cross_view_evidence;
  }

  if (facts.constraints.length > 0) {
    packet.constraints = [...facts.constraints];
  }

  return packet;
}

const OMITTED_SECTIONS_BY_DOMAIN = {
  GEOMETRY: ["parts", "articulation", "constraints", "unknowns.blocking", "unknowns.non_blocking"],
  TEXTURING: ["materials", "constraints", "unknowns.blocking", "unknowns.non_blocking"],
  ANIMATION: ["parts", "articulation", "animation_guidance", "constraints", "unknowns.blocking", "unknowns.non_blocking"],
} as const;

/** Report omissions only when they affect the current specialist's decision input. */
export function relevantTruncatedSectionsForAuthoringDomain(
  domain: ControlAuthoringDomain | null,
  reference: ControlReferenceProjection
): NonNullable<ControlReferenceProjection["truncated_sections"]> {
  const omitted = reference.truncated_sections ?? [];
  if (!domain || domain === "CORE") return [...omitted];
  const relevant: readonly string[] = OMITTED_SECTIONS_BY_DOMAIN[domain];
  return omitted.filter((section) => relevant.includes(section));
}

export function stageReferenceSemanticFingerprint(
  domain: ControlAuthoringDomain | null,
  reference: ControlReferenceProjection
): string {
  const stage = referenceStage(domain);
  const images = imagesForStage(stage, reference);
  const omitted = relevantTruncatedSectionsForAuthoringDomain(domain, reference);
  const payload = canonicalJson({
    asset_name: reference.asset_name,
    asset_kind: reference.asset_kind,
    intent: reference.intent,
    selected_profile: reference.selected_profile,
    requirements: reference.requirements,
    readiness: readinessForAuthoringDomain(domain, reference),
    blocking_unknowns:
      readinessForAuthoringDomain(domain, reference) === "BLOCKED"
        ? reference.blocking_unknowns
        : [],
    non_blocking_unknowns: reference.non_blocking_unknowns,
    document: stage ? reference.documents[stage] ?? null : null,
    images,
    semantic_facts: semanticFactsForAuthoringDomain(domain, reference),
    // Source facts beyond the bounded projection must still invalidate the
    // stage when changed. Keep unaffected complete-stage reuse unchanged.
    ...(omitted.length > 0
      ? { omitted_sections: omitted, incomplete_source_revision: reference.fingerprint }
      : {}),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function buildControlStageContext(input: {
  domain: ControlAuthoringDomain | null;
  reference: ControlReferenceProjection;
  workspace: ControlWorkspaceProjection;
  currentUserDelta?: string | null;
}): ControlStageContext {
  const stage = referenceStage(input.domain);
  const type = contextType(input.domain);
  const stageReadiness = readinessForAuthoringDomain(input.domain, input.reference);
  const referenceDocument = stage ? input.reference.documents[stage] ?? null : null;
  const referenceImages = imagesForStage(stage, input.reference);
  const referenceImageIds = referenceImages.map((image) => image.id);
  const blockingUnknowns = stageReadiness === "BLOCKED"
    ? [...input.reference.blocking_unknowns]
    : [];
  const relevantNonBlocking = [...input.reference.non_blocking_unknowns];
  const semanticFacts = semanticFactsForAuthoringDomain(
    input.domain,
    input.reference
  );
  const decisionPacket = decisionPacketForAuthoringDomain(
    input.domain,
    input.reference
  );
  const omitted = relevantTruncatedSectionsForAuthoringDomain(
    input.domain,
    input.reference
  );
  const stageReferenceFingerprint = stageReferenceSemanticFingerprint(
    input.domain,
    input.reference
  );
  const assetHealth = buildAssetHealthSummary({
    domain: input.domain,
    reference: input.reference,
    workspace: input.workspace,
  });

  const hashPayload = canonicalJson({
    type,
    delta: input.currentUserDelta?.trim() || null,
    stage_reference: stageReferenceFingerprint,
    workspace: input.workspace.fingerprint,
    // Stage context is a routing+graph consumer. Its identity must rotate
    // with those canonical revisions, even when the reference/workspace
    // bytes are unchanged; schema-only changes must not invalidate it.
    semantic_revision: semanticRevisionForDependencies(
      semanticDependenciesForSurface("AI_STAGE_CONTEXT")
    ),
  });

  return {
    context_type: type,
    context_hash: createHash("sha256").update(hashPayload).digest("hex"),
    semantic: semanticDerivedArtifactStamp("AI_STAGE_CONTEXT"),
    original_user_intent: input.reference.intent,
    current_user_delta: input.currentUserDelta?.trim() || null,
    selected_profile: input.reference.selected_profile,
    reference_package_id_or_hash: input.reference.fingerprint,
    workspace_revision_or_hash: input.workspace.fingerprint,
    stage_readiness: stageReadiness,
    blocking_unknowns: blockingUnknowns,
    non_blocking_unknowns_relevant_to_stage: relevantNonBlocking,
    requirements: input.reference.requirements,
    semantic_facts: semanticFacts,
    decision_packet: decisionPacket,
    asset_health: assetHealth,
    ...(omitted.length > 0
      ? { reference_recovery: {
          source_path: input.reference.source_path,
          omitted_sections: omitted,
        } }
      : {}),
    reference_document: referenceDocument,
    reference_image_ids: referenceImageIds,
    workspace: {
      asset: input.workspace.asset,
      current_stage: input.workspace.current_stage,
      gates: input.workspace.gates,
      next_step: input.workspace.next_step,
    },
  };
}