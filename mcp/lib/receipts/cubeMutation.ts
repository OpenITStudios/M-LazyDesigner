import { z } from "zod";

const vector2Schema = z.array(z.number().finite()).length(2);
const vector3Schema = z.array(z.number().finite()).length(3);

/** Exact authored fields emitted by the native Cube geometry-effect producer. */
export const CUBE_CHANGED_FIELDS = [
  "name", "from", "to", "origin", "rotation", "inflate",
  "box_uv", "uv_offset", "mirror_uv", "autouv", "visibility", "faces",
] as const;
const KNOWN_CUBE_CHANGED_FIELDS: ReadonlySet<string> = new Set(CUBE_CHANGED_FIELDS);

export const cubeGeometryEffectSchema = z.object({
  changed_fields: z.array(z.enum(CUBE_CHANGED_FIELDS)),
  center_delta: vector3Schema,
  size_delta: vector3Schema,
  origin_delta: vector3Schema,
  rotation_delta: vector3Schema,
  inflate_delta: z.number().finite(),
  uv_offset_delta: vector2Schema,
  mirror_uv_changed: z.boolean(),
  autouv_changed: z.boolean(),
  visibility_changed: z.boolean(),
  faces_changed: z.boolean(),
});

export const cubeVisualScopeSchema = z.object({
  cube_uuids: z.array(z.string().min(1)).min(1).max(32),
  framing: z.object({
    min: vector3Schema,
    max: vector3Schema,
  }),
});

/**
 * Minimum native identity/geometry proof for a completed Cube creation.
 * Visual scope is intentionally optional: Blockbench may be unable to frame
 * the geometry even when the authored Cube is present.
 */
export const cubeCreationReceiptSchema = z.object({
  execution: z.literal("applied"),
  added: z.number().int().positive(),
  cubes: z.array(z.object({
    uuid: z.string().min(1),
    name: z.string().min(1),
    from: vector3Schema,
    to: vector3Schema,
  })).min(1),
}).superRefine((receipt, context) => {
  if (receipt.added !== receipt.cubes.length) {
    context.addIssue({
      code: "custom",
      path: ["added"],
      message: "Created Cube count must match the reported native Cube identities.",
    });
  }
  if (new Set(receipt.cubes.map(cube => cube.uuid)).size !== receipt.cubes.length) {
    context.addIssue({
      code: "custom",
      path: ["cubes"],
      message: "Created Cube identities must be unique.",
    });
  }
});

export function isCubeCreationReceipt(value: unknown): boolean {
  return cubeCreationReceiptSchema.safeParse(value).success;
}

export const cubeNoChangeReceiptSchema = z.strictObject({
  execution: z.enum(["planned", "unchanged"]),
  updates: z.array(z.object({ id: z.string().min(1) }).passthrough()),
}).superRefine((receipt, context) => {
  if (receipt.execution === "unchanged" && receipt.updates.length !== 0) {
    context.addIssue({
      code: "custom",
      path: ["updates"],
      message: "Unchanged simplification cannot contain pending corrections.",
    });
  }
});

export function cubeGeometryEffect<T extends Record<string, unknown>>(
  effect: T
): T {
  cubeGeometryEffectSchema.parse(effect);
  return effect;
}

export function cubeVisualScope<T extends Record<string, unknown>>(
  scope: T
): T {
  cubeVisualScopeSchema.parse(scope);
  return scope;
}

/** Source-verified simplify preview; a label alone is never no-change proof. */
export function isCubeNoChangeReceipt(value: unknown): boolean {
  return cubeNoChangeReceiptSchema.safeParse(value).success;
}

export function cubeChangedFieldsFromResult(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as Record<string, unknown>;
  const fields = new Set<string>();

  let malformedEffect = false;
  const add = (candidate: unknown, required: boolean) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      if (required) malformedEffect = true;
      return;
    }
    const item = candidate as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(item, "geometry_effect")) {
      if (required) malformedEffect = true;
      return;
    }
    const parsed = cubeGeometryEffectSchema.safeParse(item.geometry_effect);
    if (!parsed.success) {
      malformedEffect = true;
      return;
    }
    for (const field of parsed.data.changed_fields) fields.add(field);
  };

  add(root, false);
  if (Array.isArray(root.effects)) {
    for (const effect of root.effects) add(effect, true);
  } else if (root.effects !== undefined) {
    malformedEffect = true;
  }
  // A mixed valid/malformed batch cannot be precisely scoped: return an empty
  // set so the canonical Control fallback invalidates every dependent scope.
  return malformedEffect ? [] : [...fields];
}

export function cubeVisualScopeFromResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  // A single Zod parse both verifies and projects the bounded visual scope.
  // Re-parsing the same receipt wastes work and can re-read mutable getters.
  const parsed = cubeVisualScopeSchema.safeParse(root.visual_scope);
  return parsed.success ? parsed.data : null;
}

export type CubeSemanticScope =
  | "GEOMETRY_STRUCTURE"
  | "UV_MAPPING"
  | "TEXTURE_APPEARANCE"
  | "ANIMATION_MOTION";

const CUBE_UV_FIELDS = new Set([
  "faces",
  "box_uv",
  "uv_offset",
  "mirror_uv",
  "autouv",
]);

const CUBE_SHAPE_FIELDS = new Set([
  "from",
  "to",
  "inflate",
]);

const CUBE_MOTION_READINESS_FIELDS = new Set([
  "origin",
  "rotation",
]);

export function cubeSemanticScopesFromChangedFields(
  changedFields: readonly string[]
): CubeSemanticScope[] {
  if (changedFields.length === 0 ||
      changedFields.some((field) => !KNOWN_CUBE_CHANGED_FIELDS.has(field))) {
    return [
      "GEOMETRY_STRUCTURE",
      "UV_MAPPING",
      "TEXTURE_APPEARANCE",
      "ANIMATION_MOTION",
    ];
  }

  const stale = new Set<CubeSemanticScope>(["GEOMETRY_STRUCTURE"]);
  if (changedFields.some((field) => CUBE_UV_FIELDS.has(field))) {
    stale.add("UV_MAPPING");
    stale.add("TEXTURE_APPEARANCE");
  }
  if (changedFields.some((field) => CUBE_SHAPE_FIELDS.has(field))) {
    stale.add("UV_MAPPING");
    stale.add("TEXTURE_APPEARANCE");
    stale.add("ANIMATION_MOTION");
  }
  if (
    changedFields.some((field) =>
      CUBE_MOTION_READINESS_FIELDS.has(field)
    )
  ) {
    stale.add("ANIMATION_MOTION");
  }
  return [...stale];
}
