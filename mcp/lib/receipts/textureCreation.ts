import { z } from "zod";
import { textureVariantPlanReceiptSchema } from "../texture/variantPlan";

/**
 * create_texture has TWO real Runtime result shapes:
 * - blank/template: native textureInventoryEntry with nested bitmap;
 * - variant: the Runtime extension's compact texture identity and validated
 *   source/target plan. It is not an unsupported or retired capability.
 *
 * None of these receipts proves image appearance or UV acceptance.
 */
const bitmapDimension = z.number().int().positive();

export const textureInventoryCreationReceiptSchema = z.object({
  texture: z.object({
    uuid: z.string().min(1),
    name: z.string().min(1),
    bitmap: z.object({
      width: bitmapDimension,
      height: bitmapDimension,
    }),
  }),
}).passthrough().refine((receipt) => !Object.hasOwn(receipt, "variant_creation"), {
  message: "A texture variant must be validated against its source-owned plan.",
});


export const textureVariantNativeContinuityReceiptSchema = z.object({
  state: z.literal("RUNTIME_PRECOMMIT_VARIANT_CONTINUITY_OBSERVED"),
  project_uuid: z.string().min(1),
  source_texture_uuid: z.string().min(1),
  variant_texture_uuid: z.string().min(1),
  target_group_uuid: z.string().min(1),
  source_rgba_revision: z.string().regex(
    /^sha256:[1-9]\d*x[1-9]\d*:[0-9a-f]{64}$/
  ),
  uv_mapped_faces_sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  uv_mapped_face_count: z.number().int().nonnegative(),
  project_logical_uv: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  source_and_variant_rgba_equal_at_creation: z.literal(true),
  uv_mapping_unchanged_during_creation: z.literal(true),
  visual_verified: z.literal(false),
  minecraft_verified: z.literal(false),
});

export const textureVariantCreationReceiptSchema = z.object({
  texture: z.object({
    uuid: z.string().min(1),
    name: z.string().min(1),
    width: bitmapDimension,
    height: bitmapDimension,
    group: z.string().min(1),
    pbr_channel: z.literal("color"),
  }),
  variant_creation: textureVariantPlanReceiptSchema,
  variant_native_continuity: textureVariantNativeContinuityReceiptSchema.optional(),
}).superRefine((value, ctx) => {
  const texture = value.texture;
  const plan = value.variant_creation;
  if (texture.uuid === plan.source_texture_uuid) {
    ctx.addIssue({
      code: "custom", path: ["texture", "uuid"],
      message: "Variant UUID must differ from its source atlas UUID.",
    });
  }
  if (texture.name !== plan.requested_name) {
    ctx.addIssue({
      code: "custom", path: ["texture", "name"],
      message: "Created variant name must match the planned variant.",
    });
  }
  if (texture.group !== plan.target_group_uuid) {
    ctx.addIssue({
      code: "custom", path: ["texture", "group"],
      message: "Created variant must belong to the planned non-material group.",
    });
  }
  if (texture.width !== plan.bitmap.width || texture.height !== plan.bitmap.height) {
    ctx.addIssue({
      code: "custom", path: ["texture"],
      message: "Created variant must retain its source atlas bitmap dimensions.",
    });
  }

  const continuity = value.variant_native_continuity;
  if (continuity && (
    continuity.source_texture_uuid !== plan.source_texture_uuid ||
    continuity.variant_texture_uuid !== texture.uuid ||
    continuity.target_group_uuid !== plan.target_group_uuid
  )) {
    ctx.addIssue({
      code: "custom", path: ["variant_native_continuity"],
      message: "Runtime native variant continuity must bind exact source, variant and group.",
    });
  }
});


export const textureCreationReceiptSchema = z.union([
  textureInventoryCreationReceiptSchema,
  textureVariantCreationReceiptSchema,
]);

/** Verify the actual branch, not just any response resembling a texture. */
export function isTextureCreationReceipt(value: unknown, requestedType = "blank"): boolean {
  if (requestedType === "variant") {
    return textureVariantCreationReceiptSchema.safeParse(value).success;
  }
  if (requestedType === "blank" || requestedType === "template") {
    return textureInventoryCreationReceiptSchema.safeParse(value).success;
  }
  return false;
}
