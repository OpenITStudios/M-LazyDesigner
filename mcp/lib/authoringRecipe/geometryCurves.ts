import type {
  RecipeFeatureIntent,
  RecipeFeatureRoute,
  RecipeVec3,
} from "@/lib/authoringRecipe/contracts";

const MAX_OBSERVED_FEATURES = 8;
const MAX_SAMPLES_PER_FEATURE = 12;
const EPSILON = 1e-7;
const ANGULAR_NUMERIC_TOLERANCE_DEGREES = 1e-4; // Not an aesthetic threshold.

/** Explicit, transient source parameters. Never extracted from labels or images. */
export type GeometryCurveObservation = {
  feature_id: string;
  samples: readonly {
    id: string;
    center: RecipeVec3;
    /** Rectangular width/depth proxy in the same stated coordinate frame. */
    cross_section: [number, number];
    /** Existing caller-supplied feature evidence handle, not its visual proof. */
    evidence_ref: string;
    /** A real requested articulation boundary AFTER this point. */
    joint_after?: boolean;
  }[];
};

export type GeometryCurveReview = {
  feature_id: string;
  state: "DECLARED_SOURCE_PARAMETERS_UNVERIFIED" |
    "REFERENCE_EVIDENCE_REQUIRED";
  /** These are measured input intervals, NOT proposed native Cube placements. */
  intervals: Array<{
    from_sample_id: string;
    to_sample_id: string;
    length: number;
    direction_change_degrees: number;
    cross_section_changed: boolean;
    required_joint: boolean;
  }>;
  sampled_total_length: number | null;
  source_claim_ids: string[];
  alternatives: Array<{
    strategy: "SINGLE_ROTATED_CUBOID_REVIEW" | "SEGMENTED_CUBOIDS_REVIEW";
    rationale: string;
    constraints: string[];
    existing_recipe_operations: string[];
    quality_evidence_required: string[];
  }>;
  /** Observed numeric differences are not a perceptual quality threshold. */
  direction_or_thickness_variation_observed: boolean;
  joint_boundaries_observed: number;
  complexity_escalation_review: boolean;
  reference_content_attested: false;
  native_cubes_generated: false;
  visual_verdict: "NOT_EVALUATED";
};

const finite = (value: number): boolean =>
  typeof value === "number" && Number.isFinite(value);

function validateObservations(
  input: readonly GeometryCurveObservation[]
): void {
  if (!Array.isArray(input) || input.length > MAX_OBSERVED_FEATURES ||
      new Set(input.map(item => item?.feature_id)).size !== input.length) {
    throw new Error("RECIPE_CURVE_OBSERVATION_SCOPE_INVALID");
  }
  for (const item of input) {
    if (!item || typeof item.feature_id !== "string" ||
        !item.feature_id.trim() || item.feature_id.length > 128 ||
        !Array.isArray(item.samples) ||
        item.samples.length < 2 ||
        item.samples.length > MAX_SAMPLES_PER_FEATURE) {
      throw new Error("RECIPE_CURVE_OBSERVATION_INVALID");
    }
    const seen = new Set<string>();
    for (const [index, sample] of item.samples.entries()) {
      if (!sample || typeof sample.id !== "string" ||
          sample.id.length < 1 || sample.id.length > 128 ||
          seen.has(sample.id) ||
          !Array.isArray(sample.center) || sample.center.length !== 3 ||
          sample.center.some(value => !finite(value)) ||
          !Array.isArray(sample.cross_section) ||
          sample.cross_section.length !== 2 ||
          sample.cross_section.some(value => !finite(value) || value <= 0) ||
          typeof sample.evidence_ref !== "string" ||
          !sample.evidence_ref.trim() ||
          sample.evidence_ref.length > 160 ||
          (sample.joint_after !== undefined &&
            typeof sample.joint_after !== "boolean") ||
          (index === item.samples.length - 1 && sample.joint_after === true)) {
        throw new Error("RECIPE_CURVE_OBSERVATION_INVALID");
      }
      seen.add(sample.id);
    }
  }
}

const differs = (a: number, b: number): boolean =>
  Math.abs(a - b) > EPSILON * Math.max(1, Math.abs(a), Math.abs(b));

const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * Source-only alternative evaluation. It can measure DECLARED geometry, not
 * attest the current reference, infer Cuboid Euler rotations or create rigs.
 */
function reviewOne(
  feature: RecipeFeatureIntent,
  route: RecipeFeatureRoute,
  observation: GeometryCurveObservation
): GeometryCurveReview {
  const available = new Set(feature.evidence_refs ?? []);
  const refs = [...new Set(observation.samples.map(s => s.evidence_ref))].sort();
  const readyForReview = feature.evidence === "SUPPORTED" &&
    route === "GEOMETRY" &&
    refs.every(ref => available.has(ref));

  const empty = (
    state: GeometryCurveReview["state"]
  ): GeometryCurveReview => ({
    feature_id: feature.id,
    state,
    intervals: [],
    sampled_total_length: null,
    source_claim_ids: readyForReview ? refs : [],
    alternatives: [],
    direction_or_thickness_variation_observed: false,
    joint_boundaries_observed: 0,
    complexity_escalation_review: false,
    reference_content_attested: false,
    native_cubes_generated: false,
    visual_verdict: "NOT_EVALUATED",
  });
  if (!readyForReview) return empty("REFERENCE_EVIDENCE_REQUIRED");

  const points = observation.samples;
  const vectors: RecipeVec3[] = [];
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1]!.center;
    const after = points[i]!.center;
    const diff: RecipeVec3 = [
      after[0] - before[0],
      after[1] - before[1],
      after[2] - before[2],
    ];
    const length = Math.hypot(...diff);
    if (!finite(length) || length <= EPSILON) {
      throw new Error("RECIPE_CURVE_DEGENERATE_SPAN");
    }
    vectors.push(diff.map(v => v / length) as RecipeVec3);
    lengths.push(length);
  }
  const intervals: GeometryCurveReview["intervals"] = [];
  let variation = false;
  let joints = 0;
  let total = 0;
  for (let i = 0; i < vectors.length; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const dir = vectors[i]!;
    const prior = i > 0 ? vectors[i - 1]! : dir;
    const cos = Math.max(-1, Math.min(1, dot(prior, dir)));
    const rawTurn = i > 0 ? Math.acos(cos) * 180 / Math.PI : 0;
    const turn = rawTurn <= ANGULAR_NUMERIC_TOLERANCE_DEGREES ? 0 : rawTurn;
    const change = differs(from.cross_section[0], to.cross_section[0]) ||
      differs(from.cross_section[1], to.cross_section[1]);
    if (turn > 0 || change) variation = true;
    const joint = from.joint_after === true;
    if (joint) joints++;
    const length = lengths[i]!;
    total += length;
    if (!finite(total)) throw new Error("RECIPE_CURVE_NONFINITE_LENGTH");
    intervals.push({
      from_sample_id: from.id,
      to_sample_id: to.id,
      length,
      direction_change_degrees: turn,
      cross_section_changed: change,
      required_joint: joint,
    });
  }

  const alternatives: GeometryCurveReview["alternatives"] = [];
  if (joints === 0) {
    alternatives.push({
      strategy: "SINGLE_ROTATED_CUBOID_REVIEW",
      rationale: variation
        ? "A single rigid Cuboid is only an approximation: sample direction or cross-section changes."
        : "Declared intervals are straight with a constant cross-section.",
      constraints: [
        "Only one rigid owner; the intended silhouette and volume must be independently confirmed.",
        "Native rotation, pivot and UV compatibility are not established by samples.",
      ],
      existing_recipe_operations: [
        "A caller may author one Cube prototype and one LINEAR(count=1) pattern.",
      ],
      quality_evidence_required: [
        "Compare front/side/3-4 reference views at intended scale.",
      ],
    });
  }
  if (variation || joints > 0) {
    alternatives.push({
      strategy: "SEGMENTED_CUBOIDS_REVIEW",
      rationale: joints > 0
        ? "Explicit joint boundaries prevent merging across required articulation."
        : "Source samples show a direction or cross-section change; visual materiality is unverified.",
      constraints: [
        "Each segment must earn material silhouette, volume or motion value.",
        "Per-segment varying widths require distinct authored prototypes in Recipe v1.",
        "A Recipe positional ANCHOR is not a Bone hierarchy or joint pivot.",
      ],
      existing_recipe_operations: [
        "A caller may author separately sized prototypes and individual LINEAR(count=1) patterns.",
        "Use existing ANCHOR only for verified contact dependencies.",
      ],
      quality_evidence_required: [
        "Compare front/side/3-4 contour, depth and any required extreme poses.",
      ],
    });
  }

  return {
    feature_id: feature.id,
    state: "DECLARED_SOURCE_PARAMETERS_UNVERIFIED",
    intervals,
    sampled_total_length: total,
    source_claim_ids: refs,
    alternatives,
    direction_or_thickness_variation_observed: variation,
    joint_boundaries_observed: joints,
    complexity_escalation_review: intervals.length >= 4,
    reference_content_attested: false,
    native_cubes_generated: false,
    visual_verdict: "NOT_EVALUATED",
  };
}

/** Exact feature ownership; observations for a different inspected feature are refused. */
export function reviewGeometryCurveObservations(
  features: readonly RecipeFeatureIntent[],
  routes: ReadonlyMap<string, RecipeFeatureRoute>,
  selectedFeatureIds: readonly string[],
  observations: readonly GeometryCurveObservation[] = []
): Map<string, GeometryCurveReview> {
  validateObservations(observations);
  const owners = new Map(features.map(feature => [feature.id, feature] as const));
  const requested = new Set(selectedFeatureIds);
  if (observations.some(item =>
    !owners.has(item.feature_id) || !requested.has(item.feature_id))) {
    throw new Error("RECIPE_CURVE_OBSERVATION_FEATURE_NOT_SELECTED");
  }
  return new Map(observations.map(item => {
    const feature = owners.get(item.feature_id)!;
    return [item.feature_id, reviewOne(
      feature, routes.get(item.feature_id) ?? "REVIEW_REQUIRED", item
    )] as const;
  }));
}
