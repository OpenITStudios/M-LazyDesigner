export const AUTHORING_RECIPE_SCHEMA_VERSION = 1 as const;
export const AUTHORING_RECIPE_COMPILER_VERSION = 1 as const;

export type RecipeVec3 = [number, number, number];

/** Explicit semantic feature evidence, not guesses from Cube names/size. */
export type RecipeGeometryReason =
  | "SILHOUETTE" | "VOLUME" | "NEGATIVE_SPACE" | "CONTACT"
  | "LAYERING" | "TRANSFORM" | "MOTION" | "TECHNICAL";
export type RecipeFeatureIntent = {
  id: string;
  label: string;
  visual_role: "THREE_DIMENSIONAL" | "SURFACE_DETAIL" | "UNNECESSARY";
  evidence: "SUPPORTED" | "PROVISIONAL" | "CONFLICTING" | "UNAVAILABLE";
  /** Bounded caller-supplied reference/view claim IDs, not independent visual proof. */
  evidence_refs?: string[];
  geometry_reasons?: RecipeGeometryReason[];
};
export type RecipeFeatureRoute = "GEOMETRY" | "TEXTURE" | "OMIT" | "REVIEW_REQUIRED";
export type RecipeFeatureDecision = {
  id: string;
  label: string;
  route: RecipeFeatureRoute;
  reason: string;
  geometry_reasons: RecipeGeometryReason[];
};
type RecipeFeatureExamples = {
  count: number;
  examples: Array<{ id: string; label: string; reason: string }>;
  examples_truncated: boolean;
};
export type RecipeFeaturePlanSummary = {
  state: "ready" | "review_required";
  geometry: RecipeFeatureExamples;
  texture_handoff: RecipeFeatureExamples;
  omitted: RecipeFeatureExamples;
  unresolved: RecipeFeatureExamples;
  visual_verdict: "not_evaluated";
  note: string;
};

export type RecipeCubePrototype = {
  id: string;
  name: string;
  size: RecipeVec3;
  origin?: RecipeVec3;
  rotation?: RecipeVec3;
  inflate?: number;
  semantic_group?: string;
};

export type RecipeInstance = {
  id: string;
  prototype_id: string;
  translation: RecipeVec3;
  rotation: RecipeVec3;
  scale: RecipeVec3;
  semantic_group?: string;
};

export type LinearPattern = {
  feature_id?: string;
  kind: "LINEAR";
  id: string;
  prototype_id: string;
  count: number;
  axis: "X" | "Y" | "Z";
  spacing: number;
  start?: RecipeVec3;
  semantic_group?: string;
};

export type GridPattern = {
  feature_id?: string;
  kind: "GRID";
  id: string;
  prototype_id: string;
  counts: [number, number];
  axes: ["X" | "Y" | "Z", "X" | "Y" | "Z"];
  spacing: [number, number];
  start?: RecipeVec3;
  semantic_group?: string;
};

export type RadialPattern = {
  feature_id?: string;
  kind: "RADIAL";
  id: string;
  prototype_id: string;
  count: number;
  axis: "X" | "Y" | "Z";
  radius: number;
  center?: RecipeVec3;
  rotate_with_pattern?: boolean;
  semantic_group?: string;
};

export type RecipePattern = LinearPattern | GridPattern | RadialPattern;

export type RecipeAnchorPosition = "MIN" | "CENTER" | "MAX";

export type RecipeAnchorConstraint = {
  kind: "ANCHOR";
  id: string;
  source_instance_id: string;
  target_instance_id: string;
  axes: Array<"X" | "Y" | "Z">;
  source_anchor: [
    RecipeAnchorPosition,
    RecipeAnchorPosition,
    RecipeAnchorPosition
  ];
  target_anchor: [
    RecipeAnchorPosition,
    RecipeAnchorPosition,
    RecipeAnchorPosition
  ];
  offset?: RecipeVec3;
};

export type RecipeConstraint = RecipeAnchorConstraint;

export type RecipeSymmetryRelation = {
  id: string;
  source_instance_id: string;
  target_instance_id: string;
  plane: {
    axis: "X" | "Y" | "Z";
    position: number;
  };
  semantic_pair?: {
    source: string;
    target: string;
  };
  uv_policy: "SHARE" | "UNIQUE";
  texture_policy: "MIRROR" | "UNIQUE";
  rig_policy: "MIRROR" | "INDEPENDENT";
};

export type CompiledSymmetryRelationship = {
  id: string;
  source_instance_id: string;
  target_instance_id: string;
  plane: RecipeSymmetryRelation["plane"];
  uv_policy: RecipeSymmetryRelation["uv_policy"];
  texture_policy: RecipeSymmetryRelation["texture_policy"];
  rig_policy: RecipeSymmetryRelation["rig_policy"];
  semantic_pair?: RecipeSymmetryRelation["semantic_pair"];
};

export type AuthoringRecipe = {
  schema: typeof AUTHORING_RECIPE_SCHEMA_VERSION;
  compiler_version: typeof AUTHORING_RECIPE_COMPILER_VERSION;
  id: string;
  name: string;
  prototypes: RecipeCubePrototype[];
  patterns: RecipePattern[];
  /** Optional all-feature routing; legacy recipes keep their original behavior. */
  feature_intents?: RecipeFeatureIntent[];
  constraints?: RecipeConstraint[];
  symmetry?: RecipeSymmetryRelation[];
};

export type CompiledCubePlacement = {
  id: string;
  name: string;
  prototype_id: string;
  from: RecipeVec3;
  to: RecipeVec3;
  origin: RecipeVec3;
  rotation: RecipeVec3;
  inflate: number;
  semantic_group?: string;
  source_pattern_id: string;
  instance_index: number;
};

export type AuthoringRecipeMetrics = {
  prototype_count: number;
  pattern_count: number;
  instance_count: number;
  realized_cube_count: number;
  unique_geometry_count: number;
  repeated_instance_count: number;
  symmetry_generated_count: number;
};

export type CompiledAuthoringRecipe = {
  schema: 1;
  compiler_version: number;
  recipe_id: string;
  placements: CompiledCubePlacement[];
  symmetry_relationships: CompiledSymmetryRelationship[];
  feature_plan?: RecipeFeaturePlanSummary;
  metrics: AuthoringRecipeMetrics;
};
