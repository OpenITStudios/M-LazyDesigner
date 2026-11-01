import { z } from "zod";

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
