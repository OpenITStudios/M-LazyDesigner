import { z } from "zod";

/**
 * Geometry Construction Language v1. Typed, bounded source parameters only.
 * The AI declares forms/relationships; the existing Recipe compiler owns
 * Cubes, persistence, native Project/Group affinity and Undo.
 *
 * Units: Blockbench model units. Input is NOT a verified image observation.
 * v1 and v2 are frozen for stored Recipe reconstruction.
 * Mathematical v1-v3 and instancing v4 are source-frozen. V5 adds
 * explicit LOFT/CONNECT methods without migrating existing Recipes.
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

/**
 * V4 geometric instancing reuses a previously declared semantic part's
 * source-local Cuboids. The optional reflection flips its local shape
 * around its own axis-aligned bounding-box centre; the instance's 'at'
 * is independent of the source's placement. Optional signed linear
 * repetition reuses canonical Recipe LINEAR pattern expansion; not a
 * second placement engine. No UV, Bone, joint or negative-determinant
 * transform is implicitly authored.
 */
export const geometryMathInstancePartSchema = z.object({
  ...partBase,
  method: z.literal("INSTANCE"),
  source_part_id: id,
  reflect_axis: axis.optional(),
  repeat: z.object({
    axis,
    count: z.number().int().min(2).max(16),
    // Signed distance: negative means repetition toward the negative axis.
    spacing: z.number().finite().min(-32).max(32).refine(
      value => Math.abs(value) >= 1,
      "Repeated instances need nonzero model-unit spacing."
    ),
  }).strict().optional(),
}).strict();

export const geometryMathPartV4Schema = z.union([
  geometryMathPartSchema,
  geometryMathInstancePartSchema,
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

/**
 * V5 adds profile-driven axis-aligned LOFT and derived endpoint CONNECT.
 * LOFT stations vary both rectangular cross-section and local centre;
 * CONNECT anchors to existing semantic parts, not guessed world points.
 * Neither is a native mesh, arbitrary code, new Recipe or a Bone joint.
 */
export const geometryMathLoftPartSchema = z.object({
  ...partBase,
  method: z.literal("LOFT"),
  axis,
  sections: z.array(z.object({
    height: z.number().int().min(0).max(32),
    center: z.tuple([
      z.number().finite().min(-16).max(16),
      z.number().finite().min(-16).max(16),
    ]),
    size: z.tuple([
      z.number().int().min(1).max(32),
      z.number().int().min(1).max(32),
    ]),
  }).strict()).min(2).max(12),
}).strict();

const faceAnchor = z.tuple([anchor, anchor, anchor]).refine(
  values => values.some(value => value !== "CENTER"),
  "CONNECT endpoint must specify at least one boundary face."
);
const connectorEndpoint = z.object({
  part_id: id,
  anchor: faceAnchor,
  offset: vec3.optional(),
}).strict();

export const geometryMathConnectorPartSchema = z.object({
  id,
  method: z.literal("CONNECT"),
  start: connectorEndpoint,
  end: connectorEndpoint,
  radius: z.tuple([
    z.number().finite().min(1).max(8),
    z.number().finite().min(1).max(8),
  ]),
  interpolation: z.enum(["LINEAR", "CENTRIPETAL_CATMULL_ROM"]),
  via: z.array(z.object({
    fraction: z.number().finite().gt(0).lt(1),
    offset: vec3,
    radius: z.number().finite().min(1).max(8),
  }).strict()).max(4).optional(),
  max_chord_error: z.number().finite().min(0.25).max(1),
}).strict().superRefine((part, ctx) => {
  const waypoints = part.via ?? [];
  for (let i = 1; i < waypoints.length; i++) {
    if (waypoints[i]!.fraction <= waypoints[i - 1]!.fraction) {
      ctx.addIssue({
        code: "custom", path: ["via", i, "fraction"],
        message: "CONNECT fractions must be strictly increasing.",
      });
    }
  }
});

export const geometryMathPartV5Schema = z.union([
  geometryMathPartV4Schema,
  geometryMathLoftPartSchema,
  geometryMathConnectorPartSchema,
]);

const programFields = {
  parts: z.array(geometryMathPartSchema).min(1).max(8),
  anchors: z.array(geometryMathAnchorSchema).max(16).optional(),
};
const programV4Fields = {
  ...programFields,
  parts: z.array(geometryMathPartV4Schema).min(1).max(8),
};
const programV5Fields = {
  ...programFields,
  parts: z.array(geometryMathPartV5Schema).min(1).max(8),
};

/**
 * The source version selects numerical semantics; it is never defaulted.
 * All previous source versions remain readable and reconstructable.
 */
export const geometryMathProgramSchema = z.discriminatedUnion("version", [
  z.object({ version: z.literal(1), ...programFields }).strict(),
  z.object({ version: z.literal(2), ...programFields }).strict(),
  z.object({ version: z.literal(3), ...programFields }).strict(),
  z.object({ version: z.literal(4), ...programV4Fields }).strict(),
  z.object({ version: z.literal(5), ...programV5Fields }).strict(),
]).superRefine((program, ctx) => {
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
  if (program.version >= 4) {
    program.parts.forEach((part, index) => {
      if (part.method !== "INSTANCE") return;
      if (!known.has(part.source_part_id) ||
        part.source_part_id === part.id) {
        ctx.addIssue({
          code: "custom", path: ["parts", index, "source_part_id"],
          message: "INSTANCE must reference another known semantic part.",
        });
      }
    });
  }
  if (program.version === 5) {
    const connectors = new Set(program.parts.filter(part =>
      part.method === "CONNECT"
    ).map(part => part.id));
    if (connectors.size === program.parts.length) {
      ctx.addIssue({
        code: "custom", path: ["parts"],
        message: "CONNECT requires at least one constructible source part.",
      });
    }
    program.parts.forEach((part, index) => {
      if (part.method === "INSTANCE" &&
        connectors.has(part.source_part_id)) {
        ctx.addIssue({
          code: "custom", path: ["parts", index, "source_part_id"],
          message: "INSTANCE cannot source a CONNECT output.",
        });
      }
      if (part.method !== "CONNECT") return;
      for (const field of ["start", "end"] as const) {
        const target = part[field].part_id;
        if (!known.has(target) || connectors.has(target)) {
          ctx.addIssue({
            code: "custom", path: ["parts", index, field, "part_id"],
            message: "CONNECT endpoints must name existing non-CONNECT parts.",
          });
        }
      }
    });
    anchors.forEach((entry, index) => {
      if (connectors.has(entry.source_part_id) ||
        connectors.has(entry.target_part_id)) {
        ctx.addIssue({
          code: "custom", path: ["anchors", index],
          message: "CONNECT parts are derived after ANCHOR solving; cannot be ANCHOR endpoints.",
        });
      }
    });
  }
});

export type GeometryMathPart = z.infer<typeof geometryMathPartSchema>;
export type GeometryMathPartV4 = z.infer<typeof geometryMathPartV4Schema>;
export type GeometryMathPartV5 = z.infer<typeof geometryMathPartV5Schema>;
export type GeometryMathLoftPart = z.infer<typeof geometryMathLoftPartSchema>;
export type GeometryMathConnectorPart = z.infer<typeof geometryMathConnectorPartSchema>;
export type GeometryMathProgram = z.infer<typeof geometryMathProgramSchema>;
export type GeometryMathVersion = GeometryMathProgram["version"];
export type GeometryMathAnchor = z.infer<typeof geometryMathAnchorSchema>;
