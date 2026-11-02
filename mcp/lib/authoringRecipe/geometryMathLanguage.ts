import { z } from "zod";

/**
 * Geometry Construction Language v1. Typed, bounded source parameters only.
 * The AI declares forms/relationships; the existing Recipe compiler owns
 * Cubes, persistence, native Project/Group affinity and Undo.
 *
 * Units: Blockbench model units. Input is NOT a verified image observation.
 * v1 and v2 are frozen for stored Recipe reconstruction.
 * Versions 1–8 remain source-frozen. V9 adds opt-in mathematical
 * dimension relationships between semantic parts; no silent migration.
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


/**
 * V6: exact 90-degree axis-aligned orientation of source-local Cuboids.
 * No new native rotation or arbitrary matrix/eval surface.
 */
export const geometryMathOrientedInstanceSchema = z.object({
  ...partBase,
  method: z.literal("ORIENT"),
  source_part_id: id,
  quarter_turn: z.object({
    axis,
    steps: z.number().int().min(1).max(3),
  }).strict(),
  reflect_axis: axis.optional(),
  repeat: z.object({
    axis,
    count: z.number().int().min(2).max(16),
    spacing: z.number().finite().min(-32).max(32).refine(
      value => Math.abs(value) >= 1,
      "Repeated instances require nonzero model-unit spacing."
    ),
  }).strict().optional(),
}).strict();

export const geometryMathPartV6Schema = z.union([
  geometryMathPartV5Schema,
  geometryMathOrientedInstanceSchema,
]);
/**
 * V7 positional FACE_ANCHOR: select one actual Cuboid face in each of two
 * existing semantic parts and solve the placement with the canonical Recipe
 * ANCHOR constraint engine. Explicit repeat_index disambiguates array
 * copies; no inferred nearest face, Bone ownership or UV conversion.
 */
const mathFaceSide = z.enum([
  "POS_X", "NEG_X", "POS_Y", "NEG_Y", "POS_Z", "NEG_Z",
]);
const mathFaceSelector = z.object({
  part_id: id,
  cube_id: id,
  face: mathFaceSide,
  repeat_index: z.number().int().min(0).max(15).optional(),
}).strict();

export const geometryMathFaceAnchorSchema = z.object({
  kind: z.literal("FACE_ANCHOR"),
  id,
  moving: mathFaceSelector,
  fixed: mathFaceSelector,
  tangent_offset: vec3.optional(),
}).strict();

/**
 * V8: exact placed-Cuboid clearance, never a whole-scene collision claim.
 * minimum_gap=0 permits touching, but forbids strictly positive overlap
 * on all three axes. A positive gap is Euclidean AABB-to-AABB distance
 * in model units, not centre distance or bounding-envelope separation.
 */
export const geometryMathClearanceSchema = z.object({
  id,
  part_a_id: id,
  part_b_id: id,
  minimum_gap: z.number().finite().min(0).max(8).optional(),
}).strict();

/**
 * V9 DIMENSION_LINK binds one target BOX dimension to an existing
 * semantic part's source-local bounding-box extent, not to texture,
 * screen measurements, or an arbitrary evaluated expression.
 *
 * Derived extent = source extent * numerator / denominator + delta.
 * The result MUST be an exact representable integer model-unit size
 * within native BOX UV limits. No implicit rounding or clamping.
 */
export const geometryMathDimensionLinkSchema = z.object({
  id,
  target_part_id: id,
  target_axis: axis,
  source_part_id: id,
  source_axis: axis,
  numerator: z.number().int().min(1).max(16),
  denominator: z.number().int().min(1).max(16),
  delta: z.number().int().min(-16).max(16).optional(),
}).strict();

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
const programV6Fields = {
  ...programFields,
  parts: z.array(geometryMathPartV6Schema).min(1).max(8),
};
const programV7Fields = {
  ...programV6Fields,
  face_anchors: z.array(geometryMathFaceAnchorSchema).max(12).optional(),
};
const programV8Fields = {
  ...programV7Fields,
  clearances: z.array(geometryMathClearanceSchema).max(16).optional(),
};
const programV9Fields = {
  ...programV8Fields,
  dimension_links: z.array(geometryMathDimensionLinkSchema).max(16).optional(),
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
  z.object({ version: z.literal(6), ...programV6Fields }).strict(),
  z.object({ version: z.literal(7), ...programV7Fields }).strict(),
  z.object({ version: z.literal(8), ...programV8Fields }).strict(),
  z.object({ version: z.literal(9), ...programV9Fields }).strict(),
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
      if (part.method !== "INSTANCE" && part.method !== "ORIENT") return;
      if (!known.has(part.source_part_id) ||
        part.source_part_id === part.id) {
        ctx.addIssue({
          code: "custom", path: ["parts", index, "source_part_id"],
          message: "INSTANCE must reference another known semantic part.",
        });
      }
    });
  }
  if (program.version >= 5) {
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
      if ((part.method === "INSTANCE" || part.method === "ORIENT") &&
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
  if (program.version === 7 || program.version === 8 ||
    program.version === 9) {
    const connectors = new Set(program.parts.filter(part =>
      part.method === "CONNECT"
    ).map(part => part.id));
    const faceLinks = program.face_anchors ?? [];
    const linkIds = faceLinks.map(link => link.id);
    if (new Set([...linkIds, ...anchors.map(anchor => anchor.id)]).size !==
      linkIds.length + anchors.length) {
      ctx.addIssue({
        code: "custom", path: ["face_anchors"],
        message: "FACE_ANCHOR and ANCHOR IDs must be unique together.",
      });
    }
    faceLinks.forEach((link, index) => {
      const moving = link.moving.part_id;
      const fixed = link.fixed.part_id;
      if (!known.has(moving) || !known.has(fixed) ||
        moving === fixed || connectors.has(moving) || connectors.has(fixed)) {
        ctx.addIssue({
          code: "custom", path: ["face_anchors", index],
          message: "FACE_ANCHOR requires two distinct non-CONNECT parts.",
        });
      }
      const first = link.moving.face;
      const second = link.fixed.face;
      const sameAxis = first.slice(4) === second.slice(4);
      const opposed = first.slice(0, 3) !== second.slice(0, 3);
      if (!sameAxis || !opposed) {
        ctx.addIssue({
          code: "custom", path: ["face_anchors", index],
          message: "FACE_ANCHOR faces must have opposite normals along one axis.",
        });
      }
      const normalAxis = "XYZ".indexOf(first.slice(4));
      if (normalAxis >= 0 &&
        Math.abs(link.tangent_offset?.[normalAxis] ?? 0) > 1e-9) {
        ctx.addIssue({
          code: "custom", path: ["face_anchors", index, "tangent_offset"],
          message: "FACE_ANCHOR offset must be tangent to its face.",
        });
      }
    });
  }
  if (program.version === 8 || program.version === 9) {
    const relations = program.clearances ?? [];
    const claimedIds = [
      ...anchors.map(link => link.id),
      ...(program.face_anchors ?? []).map(link => link.id),
      ...relations.map(link => link.id),
      ...(program.version === 9 ? (program.dimension_links ?? []).map(
        link => link.id
      ) : []),
    ];
    if (new Set(claimedIds).size !== claimedIds.length) {
      ctx.addIssue({
        code: "custom",
        path: program.version === 9 ? ["dimension_links"] : ["clearances"],
        message: "All geometry relation IDs must be unique.",
      });
    }
    relations.forEach((link, index) => {
      if (!known.has(link.part_a_id) || !known.has(link.part_b_id) ||
        link.part_a_id === link.part_b_id) {
        ctx.addIssue({
          code: "custom", path: ["clearances", index],
          message: "CLEARANCE requires two distinct known semantic parts.",
        });
      }
    });
  }
  if (program.version === 9) {
    const definitions = new Map(program.parts.map(part => [
      part.id, part
    ] as const));
    const claims = new Set<string>();
    (program.dimension_links ?? []).forEach((link, index) => {
      const source = definitions.get(link.source_part_id);
      const target = definitions.get(link.target_part_id);
      if (!source || !target || source.method === "CONNECT" ||
        target.method !== "BOX" || source.id === target.id) {
        ctx.addIssue({
          code: "custom",
          path: ["dimension_links", index],
          message: "DIMENSION_LINK requires distinct known source and BOX target parts; CONNECT is not a dimension source.",
        });
      }
      const slot = link.target_part_id + ":" + link.target_axis;
      if (claims.has(slot)) {
        ctx.addIssue({
          code: "custom",
          path: ["dimension_links", index],
          message: "A BOX target dimension may have exactly one dimension owner.",
        });
      }
      claims.add(slot);
    });
  }
});

export type GeometryMathPart = z.infer<typeof geometryMathPartSchema>;
export type GeometryMathPartV4 = z.infer<typeof geometryMathPartV4Schema>;
export type GeometryMathPartV5 = z.infer<typeof geometryMathPartV5Schema>;
export type GeometryMathPartV6 = z.infer<typeof geometryMathPartV6Schema>;
export type GeometryMathOrientedInstance =
  z.infer<typeof geometryMathOrientedInstanceSchema>;
export type GeometryMathLoftPart = z.infer<typeof geometryMathLoftPartSchema>;
export type GeometryMathConnectorPart = z.infer<typeof geometryMathConnectorPartSchema>;
export type GeometryMathProgram = z.infer<typeof geometryMathProgramSchema>;
export type GeometryMathFaceAnchor =
  z.infer<typeof geometryMathFaceAnchorSchema>;
export type GeometryMathClearance =
  z.infer<typeof geometryMathClearanceSchema>;
export type GeometryMathDimensionLink =
  z.infer<typeof geometryMathDimensionLinkSchema>;
export type GeometryMathVersion = GeometryMathProgram["version"];
export type GeometryMathAnchor = z.infer<typeof geometryMathAnchorSchema>;
