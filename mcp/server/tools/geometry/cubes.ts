/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  cubeGeometryEffect as validatedCubeGeometryEffect,
  cubeVisualScope as validatedCubeVisualScope,
  cubeSemanticScopesFromChangedFields,
} from "@/lib/receipts/cubeMutation";
import {
  recordCurrentCapabilitySemanticHistoryEffect,
  recordCurrentSemanticHistoryEffect,
} from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { autoUvEnum, cubeSchema, faceEnum } from "@/lib/schemas/geometry";
import { readRenderedCubeBounds, isEffectivelyVisible } from "@/lib/geometry/renderedModelBounds";
import { analyzeCubeSimplificationFidelity } from "@/lib/geometry/quality";
import { STATUS_STABLE } from "@/lib/constants";
import { resolveCoreCube, resolveCoreGroup, resolveUniqueUuid } from "@/lib/core/identity";
import { requireOpenProject } from "@/lib/core/project";
import {
  hasFiniteCubeSpan,
  requireFiniteCubeSpan,
  requireBoxUvRepresentableSpan,
  requireDistinctCubeBatchPlacements,
  validateCubeGeometrySpan,
} from "@/lib/geometry/cubeSpan";
export { validateCubeGeometrySpan } from "@/lib/geometry/cubeSpan";
import {
  BoxUvCapacityError,
  boxUvFootprint,
  packBoxUvOffsets,
  type BoxUvRegion,
} from "@/lib/uv/boxLayout";
import {
  analyzeStaticCubeContainment,
  analyzeStaticMarginalProjection,
  analyzeStaticCubeMergeCandidates,
  prioritizeGeometryConstructionReview,
  type SurfaceEvidenceCube,
} from "@/lib/geometry/surfaceEvidence";

const finiteVec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const finiteVec2Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
]);
const faceUvOverridesSchema = z
  .array(
    z.object({
      face: faceEnum.describe("Face whose per-face UV rectangle is overridden."),
      uv: z
        .array(z.number().finite())
        .length(4)
        .describe("Finite custom UV rectangle [u1,v1,u2,v2] for this face."),
    })
  )
  .min(1)
  .max(6)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.face)).size === entries.length,
    { message: "Each custom-UV Cube face may appear at most once." }
  )
  .describe(
    "Per-face UV overrides; switches the Cube to per-face UV mode; unlisted faces keep their current UV."
  );
function hasNonZeroRotation(rotation?: readonly number[]): boolean {
  return rotation?.some((value) => value !== 0) ?? false;
}

const placeCubeElementSchema = cubeSchema
  .extend({
    from: finiteVec3Schema.describe(
      "Required finite Cube start coordinates [x,y,z]."
    ),
    to: finiteVec3Schema.describe(
      "Required finite Cube end coordinates [x,y,z]."
    ),
    origin: finiteVec3Schema
      .optional()
      .describe(
        "Cube pivot [x,y,z]. Required for non-zero rotation; optional otherwise."
      ),
    rotation: finiteVec3Schema
      .optional()
      .default([0, 0, 0])
      .describe(
        "Cube rotation in degrees [x,y,z]; non-zero rotation requires origin."
      ),
    group: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional per-Cube Group UUID or unique exact-name parent override; use `root` for explicit root. Omit to inherit the top-level group."
      ),
    inflate: z
      .number()
      .finite()
      .optional()
      .describe("Optional finite Bedrock Cube inflation authored at creation."),
  })
  .refine(
    (element) =>
      !hasNonZeroRotation(element.rotation) || element.origin !== undefined,
    {
      message:
        "A rotated Cube requires an explicit origin/pivot. Provide origin explicitly — provisional suggestion: center [(from[0]+to[0])/2, (from[1]+to[1])/2, (from[2]+to[2])/2] or the parent Group pivot when the rotation is attachment/joint-owned. Do not rely on automatic [0,0,0].",
      path: ["origin"],
    }
  )
  .refine((element) => hasFiniteCubeSpan(element.from, element.to), {
    message:
      "Cube from/to must produce a finite per-axis size; finite endpoints that overflow during subtraction are rejected.",
    path: ["to"],
  });

const cubeCorrectionUpdateSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "Exact Cube UUID; names and selection are not accepted for batch correction."
      ),
    origin: finiteVec3Schema
      .optional()
      .describe(
        "New pivot. Origin-only preserves visual position; with from/to/rotation it is an authored transform rewrite."
      ),
    from: finiteVec3Schema
      .optional()
      .describe("New authored Cube from coordinates."),
    to: finiteVec3Schema
      .optional()
      .describe("New authored Cube to coordinates."),
    rotation: finiteVec3Schema
      .optional()
      .describe(
        "New rotation in degrees. Activating non-zero rotation requires origin; an already-rotated Cube may reuse its pivot."
      ),
    uv_offset: finiteVec2Schema
      .optional()
      .describe("Finite box-UV offset [u,v] for this Cube."),
    autouv: autoUvEnum
      .optional()
      .describe("Auto UV setting: 0 disabled, 1 enabled, 2 relative."),
    mirror_uv: z.boolean().optional().describe("Whether to mirror Box UVs."),
    faces: faceUvOverridesSchema.optional(),
    visibility: z
      .boolean()
      .optional()
      .describe("New Cube visibility."),
  })
  .strict()
  .refine(
    (update) =>
      update.origin !== undefined ||
      update.from !== undefined ||
      update.to !== undefined ||
      update.rotation !== undefined ||
      update.uv_offset !== undefined ||
      update.autouv !== undefined ||
      update.mirror_uv !== undefined ||
      update.faces !== undefined ||
      update.visibility !== undefined,
    {
      message:
        "Each update must change at least one authored field: origin, from, to, rotation, uv_offset, autouv, mirror_uv, or visibility.",
    }
  );

export const placeCubeParameters = z
  .object({
    elements: z
      .array(placeCubeElementSchema)
      .min(1)
      .describe(
        "Cubes to place. Each requires finite from/to; rotated Cubes also require origin."
      ),
    group: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional Group UUID or unique exact name; omit/use `root` only for intentional root placement."
      ),
    faces: z
      .union([z.literal(true).describe("Use inherited project UV mode."), faceUvOverridesSchema])
      .optional()
      .default(true)
      .describe(
        "UV intent: true/default = inherited project UV mode; explicit rectangles = per-face UV mode."
      ),
  })
  .strict();

export const modifyCubeParameters = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Required Cube UUID or unique exact name; selection is never an implicit target."
    ),
  name: z.string().min(1).optional().describe("New non-empty Cube name."),
  origin: finiteVec3Schema
    .optional()
    .describe(
      "Cube pivot; origin-only preserves position, with from/to/rotation it rewrites the transform."
    ),
  from: finiteVec3Schema
    .optional()
    .describe("Starting point of the cube."),
  to: finiteVec3Schema
    .optional()
    .describe("Ending point of the cube."),
  rotation: finiteVec3Schema
    .optional()
    .describe(
      "Cube rotation; activating non-zero requires origin; already-rotated may reuse its pivot."
    ),
  autouv: autoUvEnum
    .optional()
    .describe(
      "Auto UV setting. 0 = disabled, 1 = enabled, 2 = relative auto UV."
    ),
  uv_offset: finiteVec2Schema
    .optional()
    .describe("Finite box-UV offset [u,v] exported by Bedrock when this Cube uses box UV."),
  mirror_uv: z.boolean().optional().describe("Whether to mirror the UVs."),
  faces: faceUvOverridesSchema.optional(),

  inflate: z.number().finite().optional().describe("Finite Bedrock Cube inflation amount."),

  visibility: z
    .boolean()
    .optional()
    .describe("Whether the cube is visible or not."),
}).strict().refine(
  (update) =>
    Object.entries(update).some(
      ([key, value]) => key !== "id" && value !== undefined
    ),
  {
    message:
      "modify_cube requires at least one authored field change in addition to id. Inspect the target and send the intended correction; an id-only request is not progress.",
  }
)
.superRefine((update, ctx) => {
  if (
    update.from !== undefined &&
    update.to !== undefined &&
    !hasFiniteCubeSpan(update.from, update.to)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Cube from/to must produce a finite per-axis size; finite endpoints that overflow during subtraction are rejected.",
      path: ["to"],
    });
  }
});

export const modifyCubesBatchParameters = z.object({
  updates: z
    .array(cubeCorrectionUpdateSchema)
    .min(1)
    .max(32)
    .refine(
      (updates) => new Set(updates.map((update) => update.id)).size === updates.length,
      {
        message: "Each Cube UUID may appear only once in a batch correction.",
      }
    )
    .describe(
      "1-32 explicit Cube transform/Box-UV/visibility updates applied in one Undo unit."
    ),
}).strict();

export const simplifyCubesParameters = z.object({
  ids: z.array(z.string().min(1)).min(1).max(32).refine(ids => new Set(ids).size === ids.length, "Duplicate Cube UUIDs."),
  increment: z.number().finite().positive().describe("Grid increment in model units for bounds, degrees for rotation."),
  fields: z.array(z.enum(["bounds", "rotation"])).min(1).refine(fields => new Set(fields).size === fields.length, "Duplicate fields."),
  dry_run: z.boolean().default(true).describe("Return proposed corrections without mutation; false applies one Undo unit. UV and pivots are preserved."),
}).strict();

export function planCubeSimplification(cubes: Array<Pick<Cube, "uuid" | "name" | "from" | "to" | "rotation" | "inflate">>, request: z.infer<typeof simplifyCubesParameters>) {
  const round = (values: readonly number[]) => values.map(value => {
    const result = Math.round(value / request.increment) * request.increment;
    if (!Number.isFinite(result)) throw new Error("Simplification produced non-finite coordinates.");
    return Object.is(result, -0) ? 0 : result;
  }) as [number, number, number];
  return request.ids.flatMap(id => {
    const cube = resolveUniqueUuid(cubes, id, {
      kind: "Cube",
      notFoundHint: "Inspect current Cube UUIDs before retrying simplification.",
    });
    const update: BatchUpdate = { id };
    if (request.fields.includes("bounds")) {
      const from = round(cube.from), to = round(cube.to);
      validateCubeGeometrySpan(from, to, cube.inflate ?? 0, `Simplify ${cube.name}`);
      if (to.some((value, axis) => cube.to[axis] > cube.from[axis] && value <= from[axis])) {
        throw new Error(`Simplify ${cube.name} would collapse a positive axis; choose a smaller increment.`);
      }
      if (from.some((value, axis) => value !== cube.from[axis])) update.from = from;
      if (to.some((value, axis) => value !== cube.to[axis])) update.to = to;
    }
    if (request.fields.includes("rotation")) {
      const rotation = round(cube.rotation);
      if (rotation.some((value, axis) => value !== cube.rotation[axis])) update.rotation = rotation;
    }
    return Object.keys(update).length > 1 ? [update] : [];
  });
}

function withCubeOperation<T extends z.ZodType>(
  schema: T,
  operation: "create" | "update" | "batch_update" | "simplify"
) {
  return z.intersection(
    z.object({ operation: z.literal(operation) }),
    z.preprocess((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const { operation: _operation, ...payload } = value as Record<string, unknown>;
      return payload;
    }, schema)
  );
}

export const cubeToolBranches = {
  create: withCubeOperation(placeCubeParameters, "create"),
  update: withCubeOperation(modifyCubeParameters, "update"),
  batch_update: withCubeOperation(
    modifyCubesBatchParameters,
    "batch_update"
  ),
  simplify: withCubeOperation(simplifyCubesParameters, "simplify"),
} as const;

export const cubeToolDocs: ToolSpec[] = [
  {
    name: "manage_cubes",
    description:
      "Creates or updates Bedrock Cubes. Use create for placement, update for one target, batch_update for 1-32 UUID corrections, or simplify for explicit bounds/rotation rounding with dry-run default. Simplify preserves UV/pivots and rejects collapsed axes; it does not reduce Cube count or evaluate visual fidelity.",
    annotations: {
      title: "Place Cube",
      destructiveHint: true,
    },
    parameters: z.union([
      cubeToolBranches.create,
      cubeToolBranches.update,
      cubeToolBranches.batch_update,
      cubeToolBranches.simplify,
    ]),
    branches: {
      discriminator: "operation",
      schemas: cubeToolBranches,
    },
    status: STATUS_STABLE,
  },
];

const cubeToolInputSchema: Record<string, z.ZodType> = {
  operation: z
    .enum(["create", "update", "batch_update", "simplify"])
    .describe("Cube operation; provide the fields required by that operation."),
  elements: z.unknown().optional().describe("Cube placement payload."),
  updates: z.unknown().optional().describe("Bounded Cube correction payload."),
  ids: z.array(z.string()).optional().describe("Explicit Cube UUIDs to simplify."),
  increment: z.number().optional().describe("Positive rounding increment."),
  fields: z.array(z.enum(["bounds", "rotation"])).optional(),
  dry_run: z.boolean().optional(),
  group: z.string().optional().describe("Parent Group UUID or exact name."),
  faces: z.unknown().optional().describe("Optional per-face UV payload."),
  id: z.string().optional().describe("Cube UUID or exact unique name."),
  name: z.string().optional().describe("New Cube name."),
  origin: z.unknown().optional().describe("Cube pivot."),
  from: z.unknown().optional().describe("Cube start coordinates."),
  to: z.unknown().optional().describe("Cube end coordinates."),
  rotation: z.unknown().optional().describe("Cube rotation."),
  autouv: z.string().optional().describe("Box-UV auto mode."),
  uv_offset: z.unknown().optional().describe("Box-UV offset."),
  mirror_uv: z.boolean().optional().describe("Mirror Cube UVs."),
  inflate: z.number().optional().describe("Cube inflation."),
  visibility: z.boolean().optional().describe("Cube visibility."),
};

type PlaceCubeElement = z.infer<typeof placeCubeElementSchema>;
type BatchUpdate = z.infer<typeof cubeCorrectionUpdateSchema>;

type CubeTransformIntent = {
  origin?: readonly number[];
  from?: readonly number[];
  to?: readonly number[];
  rotation?: readonly number[];
};

function isPivotOnlyCorrection(update: CubeTransformIntent): boolean {
  return (
    update.origin !== undefined &&
    update.from === undefined &&
    update.to === undefined &&
    update.rotation === undefined
  );
}

function requireIntentionalRotationActivation(
  cube: Cube,
  requestedRotation?: readonly number[],
  requestedOrigin?: readonly number[]
): void {
  if (
    requestedRotation === undefined ||
    !hasNonZeroRotation(requestedRotation) ||
    hasNonZeroRotation(cube.rotation) ||
    requestedOrigin !== undefined
  ) {
    return;
  }

  const center: [number, number, number] = [
    (cube.from[0] + cube.to[0]) / 2,
    (cube.from[1] + cube.to[1]) / 2,
    (cube.from[2] + cube.to[2]) / 2,
  ];
  throw new Error(
    `Cube "${cube.name}" (${cube.uuid}) is currently unrotated. Activating a non-zero rotation requires an explicit origin/pivot in the same update. Provisional center ${JSON.stringify(center)} or the parent Group pivot are suitable when attachment/joint-owned; do not silently reuse the existing origin ${JSON.stringify(cube.origin)}.`
  );
}

function requirePivotTransferMesh(cube: Cube): void {
  if (!cube.mesh) {
    throw new Error(
      `Cube "${cube.name}" (${cube.uuid}) has no preview mesh, so a pivot-only transfer cannot safely preserve its visual position. Use inspect_elements(mode=detail)/canonical views and retry only when the Cube is present in the active rendered project.`
    );
  }
}

function currentBoxUvOccupancy(): BoxUvRegion[] {
  const regions: BoxUvRegion[] = [];
  for (const cube of Cube.all ?? []) {
    if (cube.box_uv !== true) continue;
    const offset = [...cube.uv_offset] as [number, number];
    if (offset.some((value) => !Number.isFinite(value))) {
      throw new Error(
        `Existing Box-UV Cube ${cube.name} (${cube.uuid}) has a non-finite uv_offset. Resolve its UV state before placing more Box-UV Cubes.`
      );
    }
    const [width, height] = boxUvFootprint(cube.from, cube.to);
    regions.push({ x: offset[0], y: offset[1], width, height });
  }
  return regions;
}

function boxUvRegionState(cube: Cube) {
  if (cube.box_uv !== true) return null;
  const [width, height] = boxUvFootprint(cube.from, cube.to);
  const [u, v] = cube.uv_offset;
  return {
    logical_rect: [u, v, u + width, v + height] as [number, number, number, number],
    size: [width, height] as [number, number],
  };
}

const CUBE_FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
type CubeFaceKey = (typeof CUBE_FACE_KEYS)[number];

function cubeFaceUvs(cube: Cube): Record<CubeFaceKey, number[]> {
  return Object.fromEntries(
    CUBE_FACE_KEYS.map((face) => [face, [...cube.faces[face].uv]])
  ) as Record<CubeFaceKey, number[]>;
}

function faceUvsEqual(
  before: Record<CubeFaceKey, number[]>,
  after: Record<CubeFaceKey, number[]>
): boolean {
  return CUBE_FACE_KEYS.every((face) =>
    before[face].every((value, index) => value === after[face][index])
  );
}

function finalCubeState(cube: Cube) {
  const from = [...cube.from] as [number, number, number];
  const to = [...cube.to] as [number, number, number];
  requireFiniteCubeSpan(from, to, `Cube ${cube.name} (${cube.uuid})`);
  const size = [
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  ] as [number, number, number];
  const uvOffset = [...cube.uv_offset] as [number, number];
  if (uvOffset.length !== 2 || uvOffset.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Cube ${cube.name} (${cube.uuid}) has a non-finite box-UV offset and cannot be reported safely.`
    );
  }
  const inflate = cube.inflate ?? 0;
  if (!Number.isFinite(inflate)) {
    throw new Error(
      `Cube ${cube.name} (${cube.uuid}) has a non-finite inflate value and cannot be reported safely.`
    );
  }
  const origin = [...cube.origin] as [number, number, number];
  if (origin.length !== 3 || origin.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Cube ${cube.name} (${cube.uuid}) has a non-finite origin and cannot be reported safely.`
    );
  }
  const rotation = [...cube.rotation] as [number, number, number];
  if (
    rotation.length !== 3 ||
    rotation.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `Cube ${cube.name} (${cube.uuid}) has a non-finite rotation and cannot be reported safely.`
    );
  }

  return {
    uuid: cube.uuid,
    name: cube.name,
    from,
    to,
    size,
    origin,
    rotation,
    inflate,
    box_uv: cube.box_uv,
    uv_offset: uvOffset,
    box_uv_region: boxUvRegionState(cube),
    mirror_uv: cube.mirror_uv,
    autouv: cube.autouv,
    visibility: cube.visibility !== false,
    face_uvs: cubeFaceUvs(cube),
  };
}

type CubeAuthoredState = ReturnType<typeof finalCubeState>;

function cubeVisualScope(cubes: readonly Cube[]) {
  try {
    const observed = readRenderedCubeBounds(cubes.map((cube) => cube.uuid));
    if (!observed.bounds) return null;
    return validatedCubeVisualScope({
      cube_uuids: cubes.map((cube) => cube.uuid),
      framing: {
        min: observed.bounds.min,
        max: observed.bounds.max,
      },
    });
  } catch {
    // Visual scoping is optional evidence optimization; authoring success remains authoritative.
    return null;
  }
}

function vec3Delta(
  after: readonly number[],
  before: readonly number[]
): [number, number, number] {
  return [
    after[0] - before[0],
    after[1] - before[1],
    after[2] - before[2],
  ];
}

function vec3Equal(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function vec2Equal(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function cubeStateCenter(state: CubeAuthoredState): [number, number, number] {
  return [
    state.from[0] + state.size[0] / 2,
    state.from[1] + state.size[1] / 2,
    state.from[2] + state.size[2] / 2,
  ];
}

function cubeGeometryEffect(before: CubeAuthoredState, after: CubeAuthoredState) {
  const changedFields: string[] = [];
  if (before.name !== after.name) changedFields.push("name");
  if (!vec3Equal(before.from, after.from)) changedFields.push("from");
  if (!vec3Equal(before.to, after.to)) changedFields.push("to");
  if (!vec3Equal(before.origin, after.origin)) changedFields.push("origin");
  if (!vec3Equal(before.rotation, after.rotation)) changedFields.push("rotation");
  if (before.inflate !== after.inflate) changedFields.push("inflate");
  if (before.box_uv !== after.box_uv) changedFields.push("box_uv");
  if (!vec2Equal(before.uv_offset, after.uv_offset)) changedFields.push("uv_offset");
  if (before.mirror_uv !== after.mirror_uv) changedFields.push("mirror_uv");
  if (before.autouv !== after.autouv) changedFields.push("autouv");
  if (before.visibility !== after.visibility) changedFields.push("visibility");
  if (!faceUvsEqual(before.face_uvs, after.face_uvs)) changedFields.push("faces");

  return validatedCubeGeometryEffect({
    changed_fields: changedFields,
    center_delta: vec3Delta(cubeStateCenter(after), cubeStateCenter(before)),
    size_delta: vec3Delta(after.size, before.size),
    origin_delta: vec3Delta(after.origin, before.origin),
    rotation_delta: vec3Delta(after.rotation, before.rotation),
    inflate_delta: after.inflate - before.inflate,
    uv_offset_delta: [
      after.uv_offset[0] - before.uv_offset[0],
      after.uv_offset[1] - before.uv_offset[1],
    ] as [number, number],
    mirror_uv_changed: before.mirror_uv !== after.mirror_uv,
    autouv_changed: before.autouv !== after.autouv,
    visibility_changed: before.visibility !== after.visibility,
    faces_changed: changedFields.includes("faces"),
  });
}

type ModifyCubeRequest = z.infer<typeof modifyCubeParameters>;
type PlaceCubeRequest = z.infer<typeof placeCubeParameters>;
type ModifyCubesBatchRequest = z.infer<typeof modifyCubesBatchParameters>;

function modifyCubeRequestWouldChange(
  cube: Cube,
  update: ModifyCubeRequest
): boolean {
  return (
    (update.name !== undefined && update.name !== cube.name) ||
    (update.origin !== undefined && !vec3Equal(update.origin, cube.origin)) ||
    (update.from !== undefined && !vec3Equal(update.from, cube.from)) ||
    (update.to !== undefined && !vec3Equal(update.to, cube.to)) ||
    (update.rotation !== undefined && !vec3Equal(update.rotation, cube.rotation)) ||
    (update.uv_offset !== undefined && !vec2Equal(update.uv_offset, cube.uv_offset)) ||
    (update.faces === undefined && update.autouv !== undefined && Number(update.autouv) !== cube.autouv) ||
    (update.mirror_uv !== undefined && update.mirror_uv !== cube.mirror_uv) ||
    (update.faces !== undefined && (
      cube.box_uv !== false || cube.autouv !== 0 || update.faces.some(({ face, uv }) =>
        uv.some((value, index) => value !== cube.faces[face].uv[index])
      )
    )) ||
    (update.inflate !== undefined && update.inflate !== (cube.inflate ?? 0)) ||
    (update.visibility !== undefined && update.visibility !== (cube.visibility !== false))
  );
}

function resolveUniqueCube(reference: string): Cube {
  return resolveCoreCube(
    reference,
    "Use inspect_elements with mode=outline/search, then mode=detail to confirm the intended UUID."
  );
}

function resolvePlacementGroup(reference?: string): Group | "root" {
  if (reference === undefined || reference === "root") return "root";
  return resolveCoreGroup(
    reference,
    'Use inspect_elements with mode=outline to confirm the intended Group UUID. Omit group or pass "root" only when root placement is intentional.'
  );
}

export function registerCubesTools() {
  const executeCreateCubes = async ({ elements, faces, group }: PlaceCubeRequest) => {
      requireOpenProject("placing Cubes");
      const defaultOutlinerGroup = resolvePlacementGroup(group);
      const placements: Array<{ element: PlaceCubeElement; outlinerGroup: Group | "root" }> = elements.map((element: PlaceCubeElement) => ({
        element,
        outlinerGroup:
          element.group !== undefined
            ? resolvePlacementGroup(element.group)
            : defaultOutlinerGroup,
      }));
      placements.forEach(({ element }) =>
        validateCubeGeometrySpan(
          element.from,
          element.to,
          element.inflate ?? 0,
          `Cube ${element.name} creation`
        )
      );
      const customFaceUvs = Array.isArray(faces);
      let contributionPreflight: {
        containment: ReturnType<typeof analyzeStaticCubeContainment>;
        projection: ReturnType<typeof analyzeStaticMarginalProjection>;
        merges: ReturnType<typeof analyzeStaticCubeMergeCandidates>;
      } | null = null;
      if (!customFaceUvs) {
        // AI-generated duplicate masses add elements/UVs without shape value.
        // Keep explicit per-face layers and distinct bones/pivots available.
        requireDistinctCubeBatchPlacements(placements.map(({ element, outlinerGroup }) => ({
          name: element.name,
          parent_id: outlinerGroup === "root" ? "root" : outlinerGroup.uuid,
          from: element.from,
          to: element.to,
          origin: element.origin,
          rotation: element.rotation,
          inflate: element.inflate,
        })));
      }
      // Per-face UV may intentionally layer identical masses, so preserve
      // the duplicate exception; still return non-destructive Geometry review.
      // Structural-only contribution evidence is computed before native
      // Undo; no post-commit diagnostic work can turn success into failure.
      const pending: SurfaceEvidenceCube[] = placements.map(
        ({ element, outlinerGroup }, index) => ({
          uuid: "pending-cube:" + index,
          name: element.name,
          from: element.from,
          to: element.to,
          rotation: element.rotation,
          origin: element.origin ?? [0, 0, 0],
          inflate: element.inflate ?? 0,
          parent_id: outlinerGroup === "root" ? "root" : outlinerGroup.uuid,
        })
      );
      const existing: SurfaceEvidenceCube[] = (Cube.all ?? [])
        .filter((cube: Cube) => cube.visibility !== false && isEffectivelyVisible(cube.mesh))
        .map((cube: Cube) => ({
          uuid: cube.uuid,
          name: cube.name,
          from: cube.from,
          to: cube.to,
          rotation: cube.rotation,
          origin: cube.origin,
          inflate: cube.inflate ?? 0,
          parent_id: typeof Group !== "undefined" && cube.parent instanceof Group
            ? cube.parent.uuid
            : cube.parent === "root" ? "root" : null,
        }));
      const source = [...existing, ...pending];
      const scope = { target_cube_ids: pending.map((item) => item.uuid) };
      contributionPreflight = {
        containment: analyzeStaticCubeContainment(source, scope),
        projection: analyzeStaticMarginalProjection(source, scope),
        merges: analyzeStaticCubeMergeCandidates(source, scope),
      };
      // Feed one source-comparison question back to Codex from actual
      // structural construction evidence; no automatic shape edits.
      const primaryFormReview = contributionPreflight
        ? prioritizeGeometryConstructionReview(contributionPreflight)
        : null;
      const autoPackBoxUv = !customFaceUvs && Project?.box_uv === true;
      let plannedBoxUvOffsets: [number, number][] | null = null;
      let deferredBoxUvTemplate = false;

      if (autoPackBoxUv) {
        // Inherited Box UV must not realize under-resolved fractional details.
        for (const { element } of placements) {
          requireBoxUvRepresentableSpan(element.from, element.to, `Cube ${element.name} creation`);
        }
        const textureWidth = Project?.texture_width;
        const textureHeight = Project?.texture_height;
        if (
          typeof textureWidth !== "number" ||
          typeof textureHeight !== "number"
        ) {
          throw new Error(
            "Box-UV auto-layout requires finite logical project texture dimensions."
          );
        }
        const footprints = placements.map(({ element }) =>
          boxUvFootprint(element.from, element.to)
        );
        try {
          plannedBoxUvOffsets = packBoxUvOffsets(
            currentBoxUvOccupancy(),
            footprints,
            textureWidth,
            textureHeight
          );
        } catch (error) {
          if (!(error instanceof BoxUvCapacityError)) throw error;
          // Geometry must not depend on fitting a provisional atlas. Keep
          // authored UVs untouched; the native production template owns layout.
          deferredBoxUvTemplate = true;
        }
      }

      Undo.initEdit({
        elements: [],
        outliner: true,
        collections: [],
      });

      let cubes: Cube[];
      try {
        cubes = placements.map(({ element, outlinerGroup }, index) => {
          const cube = new Cube({
            autouv: customFaceUvs ? 0 : 1,
            name: element.name,
            from: element.from as [number, number, number],
            to: element.to as [number, number, number],
            origin: (element.origin ?? [0, 0, 0]) as [number, number, number],
            rotation: element.rotation as [number, number, number],
            ...(element.inflate !== undefined ? { inflate: element.inflate } : {}),
            ...(customFaceUvs ? { box_uv: false } : {}),
          }).init();

          cube.addTo(outlinerGroup);

          if (customFaceUvs) {
            faces.forEach(({ face, uv }) => {
              cube.faces[face].extend({
                uv: uv as [number, number, number, number],
              });
            });
          } else {
            const plannedOffset = plannedBoxUvOffsets?.[index];
            if (plannedOffset) {
              cube.extend({
                box_uv: true,
                uv_offset: plannedOffset,
                autouv: 1,
              });
            }
            cube.mapAutoUV();
          }

          return cube;
        });

        Undo.finishEdit("Agent placed cubes", { elements: cubes });
        recordCurrentCapabilitySemanticHistoryEffect("manage_cubes");
      } catch (error) {
        Undo.cancelEdit(true);
        Canvas.updateAll();
        throw error;
      }

      Canvas.updateAll();
      const capturedContribution = contributionPreflight;
      const result = {
        execution: "applied" as const,
        visual_verdict: "not_evaluated" as const,
        added: cubes.length,
        uv_mode: customFaceUvs ? "per_face" as const : "inherited" as const,
        box_uv_layout: plannedBoxUvOffsets
          ? ("auto_packed_unlocked" as const)
          : deferredBoxUvTemplate
            ? ("deferred_for_native_template" as const)
            : null,
        cubes: cubes.map((cube: Cube) => {
          const { face_uvs: _faceUvs, ...state } = finalCubeState(cube);
          return state;
        }),
        visual_scope: cubeVisualScope(cubes),
        ...(capturedContribution && (
          capturedContribution.containment.contained_candidate_count > 0 ||
          capturedContribution.projection.no_new_projected_outline_count > 0 ||
          capturedContribution.merges.merge_candidate_count > 0 ||
          capturedContribution.containment.state === "partial" ||
          capturedContribution.projection.state === "partial" ||
          capturedContribution.merges.state === "partial"
        ) ? {
          geometry_contribution_review: (() => {
            const realId = (id: string) => {
              if (!id.startsWith("pending-cube:")) return id;
              const index = Number(id.slice("pending-cube:".length));
              return cubes[index]?.uuid ?? id;
            };
            return {
              ...capturedContribution.containment,
              examples: capturedContribution.containment.examples.map((entry) => ({
                ...entry, cube_uuid: realId(entry.cube_uuid),
                containing_cube_uuid: realId(entry.containing_cube_uuid),
              })),
              marginal_projection: {
                ...capturedContribution.projection,
                examples: capturedContribution.projection.examples.map((entry) => ({
                  ...entry, cube_uuid: realId(entry.cube_uuid),
                })),
              },
              merge_candidates: {
                ...capturedContribution.merges,
                examples: capturedContribution.merges.examples.map((entry) => ({
                  ...entry,
                  cube_uuids: entry.cube_uuids.map(realId) as [string, string],
                })),
              },
              ...(primaryFormReview ? {
                primary_form_followup: {
                  ...primaryFormReview,
                  candidate_cube_uuids: primaryFormReview.candidate_cube_uuids.map(realId),
                },
              } : {}),
            };
          })(),
        } : {}),
      };
      const uvNote = plannedBoxUvOffsets
        ? " Box-UV offsets are provisional, not UV Layout PASS. After user Geometry approval, generate and verify the native production UV template before painting."
        : deferredBoxUvTemplate
          ? " Box-UV template packing was deferred because the provisional canvas or occupancy cannot fit the geometry. After user Geometry approval, use create_texture(type=template) and verify UV Layout before painting."
          : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Placed ${cubes.length} Cube${cubes.length === 1 ? "" : "s"} with ${customFaceUvs ? "explicit per-face UV overrides" : "inherited Bedrock UV mode"}.${uvNote} Execution succeeded; reference fidelity was not evaluated.`,
          },
        ],
        structuredContent: result,
      };
    }

  const executeUpdateCube = async ({
      id,
      name,
      origin,
      from,
      to,
      rotation,
      uv_offset,
      autouv,
      mirror_uv,
      inflate,
      faces,
      visibility,
    }: ModifyCubeRequest) => {
      requireOpenProject("modifying a Cube");
      const cubes = [resolveUniqueCube(id)];
      const before = finalCubeState(cubes[0]);

      cubes.forEach((cube) =>
        requireIntentionalRotationActivation(cube, rotation, origin)
      );
      if (from !== undefined || to !== undefined || inflate !== undefined) {
        validateCubeGeometrySpan(
          from ?? cubes[0].from,
          to ?? cubes[0].to,
          inflate ?? (cubes[0].inflate ?? 0),
          `Cube ${cubes[0].name} (${cubes[0].uuid}) update`
        );
      }
      if ((from !== undefined || to !== undefined) && faces === undefined &&
          (cubes[0].box_uv === true ||
            (cubes[0].box_uv !== false && Project?.box_uv === true))) {
        requireBoxUvRepresentableSpan(
          from ?? cubes[0].from,
          to ?? cubes[0].to,
          `Cube ${cubes[0].name} (${cubes[0].uuid}) update`,
          { from: cubes[0].from, to: cubes[0].to }
        );
      }
      if (!modifyCubeRequestWouldChange(cubes[0], {
        id, name, origin, from, to, rotation, uv_offset, autouv, mirror_uv, inflate, faces, visibility,
      })) {
        throw new Error(
          `modify_cube request for Cube ${cubes[0].name} (${cubes[0].uuid}) has no authored effect; every supplied value already matches current state.`
        );
      }

      const pivotOnly = isPivotOnlyCorrection({ origin, from, to, rotation });
      if (pivotOnly) {
        cubes.forEach(requirePivotTransferMesh);
      }

      Undo.initEdit({
        elements: cubes,
        outliner: true,
        collections: [],
      });

      try {
        cubes.forEach((cube) => {
          if (pivotOnly) {
            cube.transferOrigin(origin as [number, number, number]);
          }

          cube.extend({
            ...(name !== undefined ? { name } : {}),
            ...(!pivotOnly && origin !== undefined
              ? { origin: origin as [number, number, number] }
              : {}),
            ...(from !== undefined ? { from: from as [number, number, number] } : {}),
            ...(to !== undefined ? { to: to as [number, number, number] } : {}),
            ...(rotation !== undefined
              ? { rotation: rotation as [number, number, number] }
              : {}),
            ...(uv_offset !== undefined
              ? { uv_offset: uv_offset as [number, number] }
              : {}),
            ...(autouv !== undefined
              ? { autouv: Number(autouv) as 0 | 1 | 2 }
              : {}),
            ...(mirror_uv !== undefined ? { mirror_uv } : {}),
            ...(faces !== undefined ? { box_uv: false, autouv: 0 } : {}),
            ...(inflate !== undefined ? { inflate } : {}),
            ...(visibility !== undefined ? { visibility } : {}),
          });
          faces?.forEach(({ face, uv }) => {
            cube.faces[face].extend({ uv: uv as [number, number, number, number] });
          });
        });

        Undo.finishEdit("Agent modified cubes");
      } catch (error) {
        Undo.cancelEdit(true);
        Canvas.updateAll();
        throw error;
      }

      Canvas.updateAll();
      const after = finalCubeState(cubes[0]);
      const geometryEffect = cubeGeometryEffect(before, after);
      recordCurrentSemanticHistoryEffect(
        cubeSemanticScopesFromChangedFields(geometryEffect.changed_fields)
      );
      const result = {
        execution: "applied" as const,
        visual_verdict: "not_evaluated" as const,
        modified: cubes.length,
        before,
        after,
        geometry_effect: geometryEffect,
        id: cubes[0].uuid,
        name: cubes[0].name,
        changed_fields: geometryEffect.changed_fields,
        visual_scope: cubeVisualScope(cubes),
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              geometryEffect.changed_fields.length === 0
                ? `Applied request to Cube ${cubes[0].name} (${cubes[0].uuid}), but no geometry/visibility field changed. This is not evidence of correction; reference fidelity was not evaluated.`
                : `Applied authored update to Cube ${cubes[0].name} (${cubes[0].uuid}). Structural effect recorded; reference fidelity was not evaluated.`,
          },
        ],
        structuredContent: result,
      };
    }

  const executeBatchUpdateCubes = async ({ updates }: ModifyCubesBatchRequest) => {
      requireOpenProject("modifying Cubes");

      const targets: Array<{
        cube: Cube;
        update: BatchUpdate;
        pivotOnly: boolean;
        before: CubeAuthoredState;
      }> = updates.map((update: BatchUpdate) => {
        const cube = resolveUniqueUuid(Cube.all ?? [], update.id, {
          kind: "Cube",
          notFoundHint:
            "Use inspect_elements with mode=outline/search, then mode=detail to confirm the exact target UUID before retrying the correction.",
        });

        requireIntentionalRotationActivation(
          cube,
          update.rotation,
          update.origin
        );
        if (update.from !== undefined || update.to !== undefined) {
          validateCubeGeometrySpan(
            update.from ?? cube.from,
            update.to ?? cube.to,
            cube.inflate ?? 0,
            `Cube ${cube.name} (${cube.uuid}) batch update`
          );
        }
        if ((update.from !== undefined || update.to !== undefined) &&
            update.faces === undefined &&
            (cube.box_uv === true ||
              (cube.box_uv !== false && Project?.box_uv === true))) {
          requireBoxUvRepresentableSpan(
            update.from ?? cube.from,
            update.to ?? cube.to,
            `Cube ${cube.name} (${cube.uuid}) batch update`,
            { from: cube.from, to: cube.to }
          );
        }
        if (!modifyCubeRequestWouldChange(cube, update)) {
          throw new Error(
            `Batch update for Cube ${cube.name} (${cube.uuid}) has no authored effect; every supplied value already matches current state.`
          );
        }

        const pivotOnly = isPivotOnlyCorrection(update);
        if (pivotOnly) {
          requirePivotTransferMesh(cube);
        }

        return { cube, update, pivotOnly, before: finalCubeState(cube) };
      });

      Undo.initEdit({
        elements: targets.map(({ cube }) => cube),
        outliner: true,
        collections: [],
      });

      try {
        for (const { cube, update, pivotOnly } of targets) {
          if (pivotOnly) {
            cube.transferOrigin(update.origin as [number, number, number]);
          }

          cube.extend({
            ...(!pivotOnly && update.origin !== undefined
              ? { origin: update.origin }
              : {}),
            ...(update.from !== undefined ? { from: update.from } : {}),
            ...(update.to !== undefined ? { to: update.to } : {}),
            ...(update.rotation !== undefined ? { rotation: update.rotation } : {}),
            ...(update.uv_offset !== undefined ? { uv_offset: update.uv_offset } : {}),
            ...(update.autouv !== undefined
              ? { autouv: Number(update.autouv) as 0 | 1 | 2 }
              : {}),
            ...(update.mirror_uv !== undefined ? { mirror_uv: update.mirror_uv } : {}),
            ...(update.faces !== undefined ? { box_uv: false, autouv: 0 } : {}),
            ...(update.visibility !== undefined
              ? { visibility: update.visibility }
              : {}),
          });
          update.faces?.forEach(({ face, uv }) => {
            cube.faces[face].extend({ uv: uv as [number, number, number, number] });
          });
        }

        Undo.finishEdit("Agent modified multiple cubes");
      } catch (error) {
        Undo.cancelEdit(true);
        Canvas.updateAll();
        throw error;
      }

      Canvas.updateAll();
      const effects = targets.map(({ cube, before }) => {
        const after = finalCubeState(cube);
        return {
          before,
          after,
          geometry_effect: cubeGeometryEffect(before, after),
        };
      });
      const geometryVisibilityFields = new Set([
        "from",
        "to",
        "origin",
        "rotation",
        "visibility",
      ]);
      const effectiveGeometryTargets = effects.filter(({ geometry_effect }) =>
        geometry_effect.changed_fields.some((field) =>
          geometryVisibilityFields.has(field)
        )
      ).length;
      const changedFieldCounts = effects.reduce<Record<string, number>>(
        (counts, { geometry_effect }) => {
          for (const field of geometry_effect.changed_fields) {
            counts[field] = (counts[field] ?? 0) + 1;
          }
          return counts;
        },
        {}
      );
      recordCurrentSemanticHistoryEffect(
        cubeSemanticScopesFromChangedFields(Object.keys(changedFieldCounts))
      );
      const result = {
        execution: "applied" as const,
        visual_verdict: "not_evaluated" as const,
        modified: targets.length,
        effective_geometry_targets: effectiveGeometryTargets,
        changed_field_counts: changedFieldCounts,
        effects,
        visual_scope: cubeVisualScope(targets.map(({ cube }) => cube)),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: `Applied authored updates to ${targets.length} Cubes in one Undo unit; ${effectiveGeometryTargets} target(s) changed geometry/visibility. Structural effects recorded; reference fidelity was not evaluated.`,
          },
        ],
        structuredContent: result,
      };
    }

  createTool(cubeToolDocs[0].name, {
    ...cubeToolDocs[0],
    inputSchema: cubeToolInputSchema,
    async execute(request) {
      if (request.operation === "create") return executeCreateCubes(request);
      if (request.operation === "update") return executeUpdateCube(request);
      if (request.operation === "simplify") {
        requireOpenProject("simplifying Cubes");
        const updates = planCubeSimplification(Cube.all, request);
        const fidelity = analyzeCubeSimplificationFidelity(updates.map((update) => {
          const cube = resolveUniqueUuid(Cube.all ?? [], update.id, {
            kind: "Cube",
            notFoundHint: "Inspect the exact Cube UUID before simplifying.",
          });
          return {
            cube: {
              uuid: cube.uuid,
              name: cube.name,
              from: cube.from,
              to: cube.to,
              rotation: cube.rotation,
              origin: cube.origin,
              inflate: cube.inflate ?? 0,
              box_uv: cube.box_uv,
              uv_faces: cube.faces
                ? Object.entries(cube.faces).map(([face, data]) => ({
                    face: face as CubeFaceDirection,
                    texture: (data as CubeFace & { texture?: unknown }).texture,
                    enabled: data.enabled !== false,
                  }))
                : undefined,
            },
            update,
          };
        }));
        if (request.dry_run || updates.length === 0) return {
          content: [{
            type: "text" as const,
            text: String(updates.length) +
              " Cube correction(s) planned; no mutation. Parent-local shape " +
              "and physical UV scale risks measured; visual fidelity not evaluated.",
          }],
          structuredContent: {
            execution: request.dry_run ? "planned" : "unchanged",
            updates,
            simplification_fidelity: fidelity,
          },
        };
        // Existing face texture ownership is an actual pre-Undo safety gate.
        // Explicit batch_update remains available after reviewing a remap.
        if (fidelity.incomplete_face_inventory_count > 0) {
          throw new Error(
            "SIMPLIFY_UV_INVENTORY_UNVERIFIED: native face texture ownership is " +
            "unavailable. No Undo started; inspect Cube faces first."
          );
        }
        if (fidelity.mapped_texture_stretch_risk_count > 0) {
          throw new Error(
            "SIMPLIFY_TEXTURE_MAPPING_REVIEW_REQUIRED: snapping Cube bounds " +
            "would alter painted-face physical dimensions while keeping UV " +
            "coordinates. No Undo started. Review the dry-run report; use " +
            "explicit batch_update after approving a UV remap."
          );
        }
        const result = await executeBatchUpdateCubes({ updates });
        return {
          ...result,
          structuredContent: {
            ...result.structuredContent,
            simplification_fidelity: fidelity,
          },
        };
      }
      return executeBatchUpdateCubes(request);
    },
  }, cubeToolDocs[0].status);
}