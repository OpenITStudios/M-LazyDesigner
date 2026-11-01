import { z } from "zod";

/**
 * Geometry Construction Language v1. Typed, bounded source parameters only.
 * The AI declares forms/relationships; the existing Recipe compiler owns
 * Cubes, persistence, native Project/Group affinity and Undo.
 *
 * Units: Blockbench model units. Input is NOT a verified image observation.
 * v1 is frozen: changes to raster/solver semantics require a new version.
 */
const axis = z.enum(["X", "Y", "Z"]);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const vec3 = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
]);
const uvPoint = z.tuple([
  z.number().int().min(-32).max(32),
  z.number().int().min(-32).max(32),
]);
const ring = z.array(uvPoint).min(3).max(24);
const partBase = {
  id,
  at: vec3.describe("Unconstrained local placement in model coordinates."),
};
const positiveSize = z.tuple([
  z.number().int().min(1).max(32),
  z.number().int().min(1).max(32),
  z.number().int().min(1).max(32),
]);

/**
 * Each operation has a small independent mathematical contract.
 * No code expression, arbitrary function, mesh payload or executable script.
 */
export const geometryMathPartSchema = z.discriminatedUnion("method", [
  z.object({
    ...partBase,
    method: z.literal("BOX"),
    size: positiveSize,
  }).strict(),
  z.object({
    ...partBase,
    method: z.literal("EXTRUDE"),
    plane: z.enum(["XY", "XZ", "YZ"]),
    outline: ring.describe("Simple polygon in local, integer-spaced UV coordinates."),
    holes: z.array(ring).max(4).optional(),
    depth: z.number().int().min(1).max(32),
  }).strict(),
  z.object({
    ...partBase,
    method: z.literal("SWEEP"),
    interpolation: z.enum(["LINEAR", "CENTRIPETAL_CATMULL_ROM"]),
    knots: z.array(z.object({
      position: vec3,
      radius: z.number().finite().min(1).max(8),
    }).strict()).min(2).max(12),
    max_chord_error: z.number().finite().min(0.25).max(1),
  }).strict(),
  z.object({
    ...partBase,
    method: z.literal("REVOLVE"),
    axis,
    sections: z.array(z.object({
      height: z.number().int().min(0).max(32),
      outer_radius: z.number().int().min(1).max(12),
      inner_radius: z.number().int().min(0).max(11),
    }).strict()).min(2).max(12),
  }).strict(),
]);

const anchor = z.enum(["MIN", "CENTER", "MAX"]);
export const geometryMathAnchorSchema = z.object({
  kind: z.literal("ANCHOR"),
  id,
  source_part_id: id,
  target_part_id: id,
  axes: z.array(axis).min(1).max(3).refine(
    value => new Set(value).size === value.length,
    "Each attachment axis must be unique."
  ),
  source_anchor: z.tuple([anchor, anchor, anchor]),
  target_anchor: z.tuple([anchor, anchor, anchor]),
  offset: vec3.optional(),
}).strict();

/**
 * Nodes are *semantic parts*, not individual native Cube IDs. An attachment
 * derives the translation of the whole part using the canonical Recipe
 * ANCHOR solver. Different axes may use independent anchors if consistent.
 */
export const geometryMathProgramSchema = z.object({
  version: z.literal(1),
  parts: z.array(geometryMathPartSchema).min(1).max(8),
  anchors: z.array(geometryMathAnchorSchema).max(16).optional(),
}).strict().superRefine((program, ctx) => {
  const ids = program.parts.map(part => part.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate semantic part IDs.", path: ["parts"] });
  }
  const known = new Set(ids);
  const anchors = program.anchors ?? [];
  if (new Set(anchors.map(entry => entry.id)).size !== anchors.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate anchor IDs.", path: ["anchors"] });
  }
  anchors.forEach((entry, index) => {
    if (!known.has(entry.source_part_id) || !known.has(entry.target_part_id) ||
      entry.source_part_id === entry.target_part_id) {
      ctx.addIssue({
        code: "custom", path: ["anchors", index],
        message: "Anchor must link two distinct known semantic parts.",
      });
    }
  });
});

export type GeometryMathPart = z.infer<typeof geometryMathPartSchema>;
export type GeometryMathProgram = z.infer<typeof geometryMathProgramSchema>;
export type GeometryMathAnchor = z.infer<typeof geometryMathAnchorSchema>;
