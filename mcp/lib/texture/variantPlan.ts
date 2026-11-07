import { z } from "zod";
import { textureIdSchema } from "@/lib/zodObjects";

/**
 * Public variant-creation contract used by the runtime create_texture adapter.
 * The legacy blank/template schema remains authoritative for existing creation
 * modes while this strict branch owns type=variant requests.
 */
export const createTextureVariantParameters = z
  .object({
    type: z.literal("variant"),
    name: z.string().min(1).describe("Non-empty variant texture name."),
    source_texture_id: textureIdSchema
      .min(1)
      .describe("Established base-color atlas UUID/ID/unique exact name to duplicate."),
    group: z
      .string()
      .min(1)
      .describe("Explicit non-material TextureGroup UUID or unique exact name for the variant."),
  })
  .strict();

export type TextureVariantSource = {
  uuid: string;
  name: string;
  width: number;
  height: number;
  role: "base_color_candidate" | "explicit_variant" | "pbr_support";
};

export type TextureVariantGroup = {
  uuid: string;
  name: string;
  is_material: boolean;
};

export type TextureVariantPlanInput = {
  source: TextureVariantSource;
  base_color_candidates: readonly TextureVariantSource[];
  target_group: TextureVariantGroup;
  requested_name: string;
  existing_texture_names: readonly string[];
};

/**
 * The pure variant planner owns the proof contract returned by Runtime.
 * Consumers must not independently guess variant source/group/bitmap fields.
 */
export const textureVariantPlanReceiptSchema = z.object({
  source_texture_uuid: z.string().min(1),
  source_texture_name: z.string().min(1),
  requested_name: z.string().min(1),
  target_group_uuid: z.string().min(1),
  target_group_name: z.string().min(1),
  bitmap: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  resulting_role: z.literal("explicit_variant"),
  preserves_base_role: z.literal(true),
  mapping_contract: z.literal("same_bitmap_dimensions_and_existing_uv_mapping"),
});

function requirePositiveBitmapDimension(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

/**
 * Pure preflight for public variant-from-base creation. The plan keeps one
 * established base atlas authoritative and requires an explicit non-material
 * group for the variant, matching the production-role semantics.
 */
export function planTextureVariantFromBase(input: TextureVariantPlanInput) {
  const requestedName = input.requested_name.trim();
  if (!requestedName) {
    throw new Error("Texture variant requires a non-empty requested name.");
  }
  if (input.existing_texture_names.includes(requestedName)) {
    throw new Error(
      `Texture name "${requestedName}" already exists; variant creation must remain deterministic.`
    );
  }

  requirePositiveBitmapDimension(input.source.width, "Variant source width");
  requirePositiveBitmapDimension(input.source.height, "Variant source height");

  if (input.source.role !== "base_color_candidate") {
    throw new Error(
      `Variant source "${input.source.name}" (${input.source.uuid}) is not the base-color atlas.`
    );
  }
  if (
    input.base_color_candidates.length !== 1 ||
    input.base_color_candidates[0]?.uuid !== input.source.uuid
  ) {
    throw new Error(
      `Variant-from-base requires exactly one established base-color atlas matching the source; found ${input.base_color_candidates.length}.`
    );
  }
  if (input.target_group.is_material) {
    throw new Error(
      `Variant target group "${input.target_group.name}" must be a non-material TextureGroup so the production base role is preserved.`
    );
  }

  return {
    source_texture_uuid: input.source.uuid,
    source_texture_name: input.source.name,
    requested_name: requestedName,
    target_group_uuid: input.target_group.uuid,
    target_group_name: input.target_group.name,
    bitmap: {
      width: input.source.width,
      height: input.source.height,
    },
    resulting_role: "explicit_variant" as const,
    preserves_base_role: true as const,
    mapping_contract: "same_bitmap_dimensions_and_existing_uv_mapping" as const,
  };
}

/** Source validation of native observations taken around the existing variant Undo. */
export type TextureVariantNativeTextureIdentity = {
  uuid: string;
  name: string;
  width: number;
  height: number;
  display_height: number;
  uv_width: number;
  uv_height: number;
  group_uuid: string | null;
  pbr_channel: string;
};
export type TextureVariantMappedUvIdentity = {
  mapped_face_count: number;
  mapped_face_sha256: string;
  project_logical_uv: readonly [number, number];
};
export type TextureVariantNativeBefore = {
  project_uuid: string;
  source: TextureVariantNativeTextureIdentity;
  mapping: TextureVariantMappedUvIdentity;
  /** SHA-256 of actual full decoded RGBA bytes, with dimensions. */
  source_rgba_revision: string;
};
export type TextureVariantNativeAfter = {
  project_uuid: string;
  source: TextureVariantNativeTextureIdentity;
  variant: TextureVariantNativeTextureIdentity;
  mapping: TextureVariantMappedUvIdentity;
  target_group_uuid: string;
  target_group_is_valid: boolean;
  source_remains_base_color: boolean;
  source_registered_once: boolean;
  variant_registered_once: boolean;
  variant_name_count: number;
  /** Runtime performs byte-for-byte checks against the pre-Undo source. */
  source_rgba_unchanged: boolean;
  variant_rgba_matches_source: boolean;
};

const NATIVE_VARIANT_SHA = /^sha256:[0-9a-f]{64}$/;
const NATIVE_VARIANT_RGBA_REVISION =
  /^sha256:([1-9]\d*)x([1-9]\d*):[0-9a-f]{64}$/;

/**
 * Reconcile exactly observed native source and variant state *before*
 * Undo.finishEdit. Returning a consistent source receipt here is not a
 * native integration test or an appearance/user approval.
 */
export function reconcileTextureVariantNativeContinuity(
  plan: ReturnType<typeof planTextureVariantFromBase>,
  before: TextureVariantNativeBefore,
  after: TextureVariantNativeAfter
) {
  const validTexture = (texture: TextureVariantNativeTextureIdentity): boolean =>
    Boolean(texture && typeof texture.uuid === "string" && texture.uuid &&
      typeof texture.name === "string" && texture.name &&
      Number.isSafeInteger(texture.width) && texture.width > 0 &&
      Number.isSafeInteger(texture.height) && texture.height > 0 &&
      Number.isSafeInteger(texture.display_height) && texture.display_height > 0 &&
      Number.isSafeInteger(texture.uv_width) && texture.uv_width > 0 &&
      Number.isSafeInteger(texture.uv_height) && texture.uv_height > 0 &&
      (texture.group_uuid === null ||
        (typeof texture.group_uuid === "string" && texture.group_uuid.length > 0)) &&
      typeof texture.pbr_channel === "string" && texture.pbr_channel.length > 0);
  const validMapping = (mapping: TextureVariantMappedUvIdentity): boolean =>
    Boolean(mapping && Number.isSafeInteger(mapping.mapped_face_count) &&
      mapping.mapped_face_count >= 0 &&
      NATIVE_VARIANT_SHA.test(mapping.mapped_face_sha256) &&
      Array.isArray(mapping.project_logical_uv) &&
      mapping.project_logical_uv.length === 2 &&
      mapping.project_logical_uv.every(n => Number.isSafeInteger(n) && n > 0));
  if (!plan || !before || !after ||
      typeof before.project_uuid !== "string" || !before.project_uuid ||
      !validTexture(before.source) || !validMapping(before.mapping) ||
      !validTexture(after.source) || !validTexture(after.variant) ||
      !validMapping(after.mapping)) {
    throw new Error("TEXTURE_VARIANT_NATIVE_OBSERVATION_INVALID");
  }
  const revision = NATIVE_VARIANT_RGBA_REVISION.exec(
    before.source_rgba_revision
  );
  if (!revision ||
      Number(revision[1]) !== before.source.width ||
      Number(revision[2]) !== before.source.height) {
    throw new Error("TEXTURE_VARIANT_NATIVE_SOURCE_REVISION_INVALID");
  }
  if (before.source.uuid !== plan.source_texture_uuid ||
      before.source.name !== plan.source_texture_name ||
      before.source.width !== plan.bitmap.width ||
      before.source.height !== plan.bitmap.height ||
      before.project_uuid !== after.project_uuid ||
      JSON.stringify(before.source) !== JSON.stringify(after.source) ||
      JSON.stringify(before.mapping) !== JSON.stringify(after.mapping) ||
      after.source_remains_base_color !== true ||
      after.source_registered_once !== true ||
      after.source_rgba_unchanged !== true) {
    throw new Error("TEXTURE_VARIANT_NATIVE_SOURCE_CHANGED");
  }
  if (after.target_group_uuid !== plan.target_group_uuid ||
      after.target_group_is_valid !== true ||
      after.variant.uuid === before.source.uuid ||
      after.variant.name !== plan.requested_name ||
      after.variant.group_uuid !== plan.target_group_uuid ||
      after.variant.pbr_channel !== "color" ||
      after.variant.width !== plan.bitmap.width ||
      after.variant.height !== plan.bitmap.height ||
      after.variant.display_height !== before.source.display_height ||
      after.variant.uv_width !== before.source.uv_width ||
      after.variant.uv_height !== before.source.uv_height ||
      after.variant_registered_once !== true ||
      after.variant_name_count !== 1 ||
      after.variant_rgba_matches_source !== true) {
    throw new Error("TEXTURE_VARIANT_NATIVE_CREATED_STATE_MISMATCH");
  }
  return {
    state: "RUNTIME_PRECOMMIT_VARIANT_CONTINUITY_OBSERVED" as const,
    project_uuid: before.project_uuid,
    source_texture_uuid: before.source.uuid,
    variant_texture_uuid: after.variant.uuid,
    target_group_uuid: plan.target_group_uuid,
    source_rgba_revision: before.source_rgba_revision,
    uv_mapped_faces_sha256: before.mapping.mapped_face_sha256,
    uv_mapped_face_count: before.mapping.mapped_face_count,
    project_logical_uv: [...before.mapping.project_logical_uv] as [number, number],
    source_and_variant_rgba_equal_at_creation: true as const,
    uv_mapping_unchanged_during_creation: true as const,
    visual_verified: false as const,
    minecraft_verified: false as const,
  };
}
