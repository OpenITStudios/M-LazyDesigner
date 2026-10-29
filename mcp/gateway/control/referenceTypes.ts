import type { ModelView } from "../../lib/reference/visualEvidence";
import type { ReferenceImageLandmark } from "../../lib/reference/landmarkEvidence";
import type { ReferenceImageRegion } from "../../lib/reference/imageRegionEvidence";
import type { CrossViewIssue, ReferencePartObservation } from "../../lib/reference/crossViewEvidence";

export type ControlProfile =
  | "PROP_FURNITURE"
  | "VEHICLE"
  | "HUMANOID"
  | "CREATURE"
  | "MECHANICAL"
  | "PLANT_FOLIAGE"
  | "GENERIC";

export type ControlReferenceAssetKind = "MODEL" | "PARTICLE";
export type ControlReferenceStage = "GEOMETRY" | "TEXTURE" | "ANIMATION";

export type ControlReferenceFactValue =
  | string
  | number
  | boolean
  | string[];

export type ControlReferenceStructuredFact = Record<
  string,
  ControlReferenceFactValue
>;

export type ControlReferenceSemanticFacts = {
  parts: ControlReferenceStructuredFact[];
  articulation: ControlReferenceStructuredFact[];
  materials: ControlReferenceStructuredFact[];
  animation_guidance: ControlReferenceStructuredFact[];
  constraints: string[];
};

/** Source semantic constraints tied to image-byte identity; never visual approval. */
export type ControlReferenceCrossViewEvidence = {
  state: "available" | "unavailable";
  readiness: "conflicting" | "consistent_with_available_constraints" |
    "insufficient_comparable_constraints" | null;
  comparable_dimension_count: number | null;
  attachment_comparison_count: number | null;
  conflict_count: number | null;
  conflict_examples: CrossViewIssue[];
  conflict_examples_truncated: boolean;
  reason?: string;
  visual_verdict: "not_evaluated";
};

export type ControlReferenceProjection = {
  available: boolean;
  source_path: string | null;
  package_root: string | null;
  fingerprint: string | null;
  schema: string | null;
  asset_name: string | null;
  asset_kind: ControlReferenceAssetKind | null;
  intent: string | null;
  selected_profile: ControlProfile | null;
  requirements: {
    dimensions_blocks: {
      width: number | null;
      height: number | null;
      length: number | null;
    } | null;
    player_relative_scale: string | null;
    animation_required: boolean | null;
  };
  readiness: {
    overall: string | null;
    geometry: string | null;
    texture: string | null;
    animation: string | null;
  };
  particle: {
    identifier: string | null;
    particle_json: string | null;
    texture_reference: string | null;
    texture_png: string | null;
    texture_state: string | null;
    recommended_locator: string | null;
    recommended_animation: string | null;
    trigger_intent: string | null;
    trigger_time_seconds: number | null;
    bind_to_actor: boolean | null;
    review_state: string | null;
  } | null;
  blocking_unknowns: string[];
  non_blocking_unknowns: string[];
  documents: Partial<Record<ControlReferenceStage, string>>;
  images: Array<{
    id: string;
    file: string;
    role: string | null;
    used_by: ControlReferenceStage[];
    status: string | null;
    /** Canonical single-view label; null for composite/unspecified sheets. */
    view?: ModelView | null;
    /** Source-image observations, not model vertices or solved camera calibration. */
    landmarks?: ReferenceImageLandmark[];
    /** Authored regions tied to semantic parts. Not automatic segmentation. */
    regions?: ReferenceImageRegion[];
    /** Explicit world dimensions, not inferred from image pixels. */
    part_world_constraints?: Array<Omit<ReferencePartObservation, "view">>;
    /** Read-time source-byte identity, not an approval or visual verdict. */
    sha256?: string | null;
    bytes?: number | null;
    media_type?: "image/png" | "image/jpeg" | "image/webp" | null;
    integrity?: "VERIFIED" | "MISSING" | "INVALID";
  }>;
  /** Existing canonical source-level cross-view evidence (Geometry only). */
  cross_view_evidence?: ControlReferenceCrossViewEvidence;
  /**
   * Decision-critical facts already owned by REFERENCE.json. Optional for
   * compatibility with older callers; Control projects only the active-stage
   * subset rather than retransmitting every semantic section.
   */
  semantic_facts?: ControlReferenceSemanticFacts;
  /**
   * Sections with omitted rows, structured-fact fields, or nested list items.
   * A nonempty set requires source re-orientation before relying on the
   * projected facts as complete. The canonical REFERENCE.json remains intact.
   */
  truncated_sections?: Array<
    | "parts"
    | "articulation"
    | "materials"
    | "animation_guidance"
    | "constraints"
    | "unknowns.blocking"
    | "unknowns.non_blocking"
  >;
  unavailable_reason?:
    | "REFERENCE_PATH_UNAVAILABLE"
    | "REFERENCE_NOT_FOUND"
    | "REFERENCE_UNREADABLE"
    | "REFERENCE_INVALID";
};
