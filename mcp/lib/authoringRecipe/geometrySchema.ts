import { z } from "zod";
import { geometryMathProgramSchema } from "./geometryMathLanguage";

/**
 * Shared, import-safe AI/native contract for the existing advanced Geometry
 * Recipe owners. No Blockbench globals or external data loading at module scope.
 * Source handles remain caller assertions, not attested image references.
 */
export const geometryVec3Schema = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
]);

const geometryAxisSchema = z.enum(["X", "Y", "Z"]);
const geometryFeatureIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const sourceHandleSchema = z.string().trim().min(1).max(160);
const geometryReasonsSchema = z.array(z.enum([
  "SILHOUETTE", "VOLUME", "NEGATIVE_SPACE", "CONTACT",
  "LAYERING", "TRANSFORM", "MOTION", "TECHNICAL",
])).max(8).refine(values => new Set(values).size === values.length, {
  message: "Geometry reasons must be unique.",
});

const featureBase = {
  id: geometryFeatureIdSchema,
  label: z.string().trim().min(1).max(128),
  evidence_refs: z.array(sourceHandleSchema).min(1).max(8)
    .refine(values => new Set(values).size === values.length, {
      message: "Reference handles must be unique per feature.",
    }),
  geometry_reasons: geometryReasonsSchema.optional(),
  replace_generated: z.boolean().optional(),
};

const repeatPatternSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LINEAR"),
    axis: geometryAxisSchema,
    start: geometryVec3Schema,
    spacing: z.number().finite(),
    count: z.number().int().min(1).max(128),
  }).strict(),
  z.object({
    kind: z.literal("GRID"),
    axes: z.tuple([geometryAxisSchema, geometryAxisSchema]),
    start: geometryVec3Schema,
    spacing: z.tuple([z.number().finite(), z.number().finite()]),
    counts: z.tuple([z.number().int().min(1).max(128), z.number().int().min(1).max(128)]),
  }).strict(),
  z.object({
    kind: z.literal("RADIAL"),
    axis: geometryAxisSchema,
    center: geometryVec3Schema,
    radius: z.number().finite().positive(),
    count: z.number().int().min(1).max(128),
  }).strict(),
]);

const curveSampleSchema = z.object({
  id: geometryFeatureIdSchema,
  center: geometryVec3Schema,
  cross_section: z.tuple([z.number().finite().positive(), z.number().finite().positive()]),
  evidence_ref: sourceHandleSchema,
  joint_after: z.boolean().optional(),
}).strict();

export const advancedGeometryFeatureSchema = z.discriminatedUnion("kind", [
  z.object({
    ...featureBase,
    kind: z.literal("cuboid"),
    from: geometryVec3Schema,
    to: geometryVec3Schema,
    pivot: geometryVec3Schema.optional(),
    rotation: geometryVec3Schema.optional(),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("frame"),
    center: geometryVec3Schema,
    size: geometryVec3Schema,
    border: z.number().finite().positive(),
    normal_axis: geometryAxisSchema,
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("repeat"),
    size: geometryVec3Schema,
    rotation: geometryVec3Schema.optional(),
    pattern: repeatPatternSchema,
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("hollow_box"),
    center: geometryVec3Schema,
    size: geometryVec3Schema,
    wall: z.number().finite().min(1)
      .describe("Wall thickness in Blockbench model units; at least one unit."),
    open_face: z.enum(["POS_X", "NEG_X", "POS_Y", "NEG_Y", "POS_Z", "NEG_Z"])
      .describe("Open side of the box in exact model coordinates."),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("arch"),
    center: geometryVec3Schema,
    size: geometryVec3Schema,
    wall: z.number().finite().min(1)
      .describe("Border thickness of the arched opening."),
    rise: z.number().finite().min(1)
      .describe("Additional opening height from the side to the center."),
    span_axis: z.enum(["X", "Z"])
      .describe("Horizontal axis of the arched opening; vertical is +Y."),
    columns: z.number().int().min(3).max(31).optional()
      .describe("Optional odd number of voxel columns; omitted chooses a bounded count from width."),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("voxel_cylinder"),
    center: geometryVec3Schema,
    axis: geometryAxisSchema
      .describe("Axis of the cylinder or tube; cross-section is voxelized."),
    radius: z.number().int().min(2).max(16)
      .describe("Outer radius in whole Blockbench model units."),
    inner_radius: z.number().int().min(0).max(15).default(0)
      .describe("Zero produces a solid cylinder; positive produces a hollow tube."),
    length: z.number().finite().min(1)
      .describe("Positive axial length in Blockbench model units."),
  }).strict(),
  // Opt-in hard-shape methods; all remain native Cuboid Recipe features.
  z.object({
    ...featureBase,
    kind: z.literal("staircase").describe("Straight solid staircase with explicit ascent direction"),
    base_center: geometryVec3Schema.describe("Footprint center on bottom Y plane."),
    direction: z.enum(["POS_X", "NEG_X", "POS_Z", "NEG_Z"]),
    steps: z.number().int().min(2).max(32),
    tread: z.number().int().min(1).max(8),
    rise: z.number().int().min(1).max(8),
    width: z.number().int().min(1).max(32),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("pitched_roof").describe("Symmetrical stepped gable roof; solid or connected shell"),
    eave_center: geometryVec3Schema.describe("Roof footprint center at eave Y level."),
    ridge_axis: z.enum(["X", "Z"]),
    steps: z.number().int().min(2).max(16),
    tread: z.number().int().min(1).max(8),
    rise: z.number().int().min(1).max(8),
    length: z.number().int().min(1).max(64),
    profile: z.enum(["SOLID", "SHELL"]).default("SOLID"),
    thickness: z.number().int().min(1).max(16).default(2),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("beveled_box").describe("Rectangular mass with voxel-beveled X/Z corners"),
    center: geometryVec3Schema,
    size: z.tuple([
      z.number().int().min(3).max(32),
      z.number().int().min(1).max(32),
      z.number().int().min(3).max(32),
    ]),
    bevel: z.number().int().min(1).max(8),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("voxel_ellipsoid").describe("Filled oval/sphere or upper half dome via disjoint native Cubes"),
    center: geometryVec3Schema.describe("Full ellipsoid center; upper dome has Y equator base."),
    radii: z.tuple([
      z.number().int().min(2).max(8),
      z.number().int().min(2).max(8),
      z.number().int().min(2).max(8),
    ]),
    upper_half: z.boolean().default(false),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("voxel_cone").describe("Filled voxel cone or tapered frustum along X, Y or Z"),
    center: geometryVec3Schema,
    axis: geometryAxisSchema,
    base_radius: z.number().int().min(2).max(8),
    tip_radius: z.number().int().min(0).max(8).default(0),
    height: z.number().int().min(2).max(16),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("voxel_torus").describe("Connected 3D voxel torus or wheel with a true central hole"),
    center: geometryVec3Schema,
    axis: geometryAxisSchema.describe("Normal of the torus ring plane."),
    major_radius: z.number().int().min(3).max(8),
    tube_radius: z.number().int().min(1).max(3),
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("program"),
    program: geometryMathProgramSchema,
  }).strict(),
  z.object({
    ...featureBase,
    kind: z.literal("curve"),
    samples: z.array(curveSampleSchema).min(2).max(12),
  }).strict(),
]);

export type AdvancedGeometryFeature = z.infer<typeof advancedGeometryFeatureSchema>;

const identity = z.string().trim().min(1).max(128);
const nativeFields = {
  expected_project_uuid: identity,
  parent_group_uuid: identity,
  /** Create is the default; revise requires the exact saved Recipe ID. */
  mode: z.enum(["create", "revise"]).optional().default("create"),
  target_recipe_id: z.string().regex(/^advgeo:[0-9a-f]{48}$/).optional(),
  features: z.array(advancedGeometryFeatureSchema).min(1).max(8),
};

function geometryRequestIssues(
  value: { mode: "create" | "revise"; target_recipe_id?: string;
    features: Array<{ id: string }> }
): Array<{ message: string; path: string[] }> {
  const issues: Array<{ message: string; path: string[] }> = [];
  const ids = value.features.map(feature => feature.id);
  if (new Set(ids).size !== ids.length) {
    issues.push({
      message: "Advanced Geometry feature IDs must be unique.",
      path: ["features"],
    });
  }
  if (value.mode === "revise" && !value.target_recipe_id) {
    issues.push({
      message: "Revising Geometry requires the exact saved Recipe ID.",
      path: ["target_recipe_id"],
    });
  }
  if (value.mode === "create" && value.target_recipe_id !== undefined) {
    issues.push({
      message: "Create must not target an existing Recipe; choose revise.",
      path: ["target_recipe_id"],
    });
  }
  return issues;
}

export const advancedGeometryNativeInputSchema =
  z.object(nativeFields).strict().superRefine((value, ctx) => {
    for (const issue of geometryRequestIssues(value)) {
      ctx.addIssue({code: "custom", ...issue});
    }
  });

export const advancedGeometryApplyInputSchema = z.object({
  ...nativeFields,
  expected_plan_id: z.string().regex(/^geometryplan:[0-9a-f]{64}$/),
  expected_scene_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict().superRefine((value, ctx) => {
  for (const issue of geometryRequestIssues(value)) {
    ctx.addIssue({code: "custom", ...issue});
  }
});

export const advancedGeometryInspectionSchema = z.object({
  operation: z.literal("inspect"),
  expected_project_uuid: identity,
  target_recipe_id: z.string().regex(/^advgeo:[0-9a-f]{48}$/).optional(),
}).strict();

export const advancedGeometryCommandSchema = z.discriminatedUnion("operation", [
  advancedGeometryInspectionSchema,
  z.object({
    operation: z.literal("plan"),
    ...nativeFields,
  }).strict(),
  z.object({
    operation: z.literal("apply"),
    ...nativeFields,
    expected_plan_id: z.string().regex(/^geometryplan:[0-9a-f]{64}$/),
    expected_scene_revision: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }).strict(),
]).superRefine((value, ctx) => {
  if (value.operation === "inspect") return;
  for (const issue of geometryRequestIssues(value)) {
    ctx.addIssue({code: "custom", ...issue});
  }
});

export type AdvancedGeometryCommand = z.infer<typeof advancedGeometryCommandSchema>;
