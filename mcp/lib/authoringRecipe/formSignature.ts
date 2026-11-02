import type {
  AuthoringRecipe,
  RecipeFeatureIntent,
  RecipeFeatureRoute,
  RecipeGeometryReason,
} from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";
import { planRecipeFeatureRepresentations } from "./featureDecision";

/**
 * An ephemeral Form Signature projection of the ONE canonical Recipe.
 *
 * No second style policy, persistent design state, inferred anatomy or
 * reference-image claim. In particular, geometry reasons do not establish
 * primary-mass rank, identity landmarks, style or variation permission.
 */
const MAX_VISIBLE_SIGNATURES = 8;
const MAX_VISIBLE_SOURCE_CONTRACTS = 16;

export type RecipeFormSignature = {
  feature_id: string;
  label: string;
  representation: RecipeFeatureRoute;
  declared_evidence: RecipeFeatureIntent["evidence"];
  evidence_refs: string[];
  declared_3d_contributions: RecipeGeometryReason[];
  /** Neither primary rank nor an artistic identity is inferable from a label. */
  design_role: "NOT_DECLARED";
  variation_policy: "NO_DECLARED_VARIATION_BOUNDS" |
    "SOURCE_DECLARED_BOUNDS_UNVERIFIED";
  /** Only a checked Recipe source/candidate may be supplied by the caller. */
  parameter_source: {
    kind: AdvancedGeometryFeature["kind"];
    parts: Array<{ id: string; method: string; references: string[] }>;
    contract_ids: string[];
    omitted_contract_count: number;
    variation_bounds?: Array<{
      id: string;
      part_id: string;
      station_index: number;
      parameter: "half_width" | "half_height" | "twist_degrees";
      min_value: number;
      max_value: number;
      evidence: "DECLARED_SPEC" | "REFERENCE_CLAIM";
    }>;
    omitted_variation_bound_count?: number;
  } | null;
};

function describeParameterSource(
  source: AdvancedGeometryFeature
): NonNullable<RecipeFormSignature["parameter_source"]> {
  if (source.kind !== "program") {
    return {
      kind: source.kind,
      parts: [],
      contract_ids: [],
      omitted_contract_count: 0,
    };
  }
  const program = source.program;
  const contracts: string[] = [];
  const add = (kind: string, values: readonly { id: string }[] | undefined) => {
    for (const value of values ?? []) contracts.push(kind + ":" + value.id);
  };
  add("ANCHOR", program.anchors);
  if ("face_anchors" in program) add("FACE_ANCHOR", program.face_anchors);
  if ("clearances" in program) add("CLEARANCE", program.clearances);
  if ("dimension_links" in program) add("DIMENSION_LINK", program.dimension_links);
  if ("dimension_constraints" in program) {
    add("DIMENSION_CONSTRAINT", program.dimension_constraints);
  }
  if ("scale_targets" in program) add("SCALE_TARGET", program.scale_targets);
  if ("measured_dimensions" in program) {
    add("MEASURED_DIMENSION", program.measured_dimensions);
  }
  if ("uncertainty_targets" in program) {
    add("UNCERTAINTY_TARGET", program.uncertainty_targets);
  }
  if (program.version === 14) {
    add("VARIATION_BOUND", program.variation_bounds);
    add("VARIATION_INVARIANT", program.variation_invariants);
  }
  contracts.sort();
  return {
    kind: "program",
    parts: program.parts.map(part => ({
      id: part.id,
      method: part.method,
      references: "source_part_id" in part
        ? [part.source_part_id]
        : "start" in part ? [part.start.part_id, part.end.part_id] : [],
    })).sort((a, b) => a.id.localeCompare(b.id)),
    contract_ids: contracts.slice(0, MAX_VISIBLE_SOURCE_CONTRACTS),
    omitted_contract_count: Math.max(0, contracts.length - MAX_VISIBLE_SOURCE_CONTRACTS),
    ...(program.version === 14 ? {
      variation_bounds: program.variation_bounds
        .slice(0, MAX_VISIBLE_SOURCE_CONTRACTS).map(bound => ({
          id: bound.id,
          part_id: bound.part_id,
          station_index: bound.station_index,
          parameter: bound.parameter,
          min_value: bound.min_value,
          max_value: bound.max_value,
          evidence: bound.evidence.kind,
        })),
      omitted_variation_bound_count: Math.max(0,
        program.variation_bounds.length - MAX_VISIBLE_SOURCE_CONTRACTS),
    } : {}),
  };
}

/**
 * Pure, bounded AI context. The source_cohorts argument is NOT an evidence
 * verifier: the only consumers pass either freshly compiled candidates or
 * parameters already compared against the stored Recipe/native snapshot.
 * Knowledge planning without source attestation passes no cohorts.
 */
export function projectRecipeFormSignatures(
  recipe: Pick<AuthoringRecipe, "feature_intents">,
  options: {
    feature_ids?: readonly string[];
    source_cohorts?: readonly AdvancedGeometryFeature[];
  } = {}
) {
  const intents = recipe.feature_intents ?? [];
  const decisions = planRecipeFeatureRepresentations(intents).decisions;
  const byIntent = new Map(intents.map(intent => [intent.id, intent] as const));
  const byDecision = new Map(decisions.map(decision => [decision.id, decision] as const));
  const sources = options.source_cohorts ?? [];
  if (new Set(sources.map(source => source.id)).size !== sources.length) {
    throw new Error("FORM_SIGNATURE_DUPLICATE_SOURCE_ID");
  }
  const bySource = new Map(sources.map(source => [source.id, source] as const));
  const selectedIds = [...new Set(options.feature_ids ?? intents.map(item => item.id))]
    .sort((a, b) => a.localeCompare(b));
  const missing = selectedIds.filter(id => !byIntent.has(id));
  const known = selectedIds.filter(id => byIntent.has(id));
  const signatures: RecipeFormSignature[] = known
    .slice(0, MAX_VISIBLE_SIGNATURES).map(id => {
      const intent = byIntent.get(id)!;
      const decision = byDecision.get(id)!;
      const source = decision.route === "GEOMETRY" ? bySource.get(id) : undefined;
      return {
        feature_id: id,
        label: intent.label,
        representation: decision.route,
        declared_evidence: intent.evidence,
        evidence_refs: [...(intent.evidence_refs ?? [])],
        declared_3d_contributions: [...decision.geometry_reasons],
        design_role: "NOT_DECLARED",
        variation_policy: source?.kind === "program" &&
          source.program.version === 14
          ? "SOURCE_DECLARED_BOUNDS_UNVERIFIED"
          : "NO_DECLARED_VARIATION_BOUNDS",
        parameter_source: source ? describeParameterSource(source) : null,
      };
    });
  return {
    state: missing.length > 0 ? "FOCUS_REVIEW_REQUIRED" as const
      : intents.length === 0 ? "NO_DECLARED_FEATURES" as const
      : "DECLARED_SOURCE_ONLY" as const,
    total_declared_features: intents.length,
    selected_feature_count: known.length,
    omitted_feature_count: Math.max(0, known.length - signatures.length),
    missing_focus_ids: missing.slice(0, MAX_VISIBLE_SIGNATURES),
    missing_focus_count: missing.length,
    signatures,
    reference_content_attested: false as const,
    native_geometry_attested: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
  };
}
