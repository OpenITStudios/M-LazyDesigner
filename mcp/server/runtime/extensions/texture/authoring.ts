/// <reference types="three" />
/// <reference types="blockbench-types" />
import textureUvCasebook from "../../../../../docs/03-authoring/texture/decision-cases.md" with { type: "text" };
import {
  createTextureUvCaseReader,
  suggestTextureUvTechnicalKnowledge,
} from "@/lib/texture/knowledgeCases";
import {
  ensureTextureDiagnosticInvocationContext,
  isTextureDiagnosticBudgetExceeded,
  readTextureDiagnosticRegion,
  readTextureDiagnosticSample,
  textureDiagnosticReadMetrics,
} from "@/lib/texture/diagnosticReadContext";

import { getAllToolDefinitions } from "@/lib/factories";
import {
  faceLocalPixelSize,
  mapFaceLocalPixelToAtlasPixel,
  mapFaceUvToTexturePixels,
} from "@/lib/uv/facePixelMapping";
import {
  analyzeTextureSeamContinuity,
  analyzeCrossCubeSeamContinuity,
  projectNativeCubeSeamEdgeToWorld,
  summarizeTextureSeamScanEvidence,
  summarizeTextureModelFaceInventory,
  type TextureModelFaceInventoryOmission,
  type CrossCubeSeamEdgeInput,
  type TextureSeamAlphaSemantics,
  type TextureSeamContinuityIntent,
  type TextureSeamEdgeInput,
  type TextureSeamRgba,
  type TextureSeamSkippedFace,
} from "@/lib/texture/seamContinuity";
import {
  analyzePbrTextureContent,
  type PbrContentTextureInput,
} from "@/lib/texture/pbrContent";
import { analyzeTextureMaterialStatus } from "@/lib/texture/materialStatus";
import {
  fullTextureRgba,
  requireUnchangedTextureBitmap,
} from "@/lib/texture/bitmapRuntime";
import {
  computeTextureRevision,
  requireTextureRevisionMatch,
} from "@/lib/texture/revision";
import { textureRevisionSchema } from "@/lib/texture/evidence";
import {
  buildTextureTreatmentCrossCubeSeamHandoff,
  requireTextureTreatmentSeamPlanReady,
  type TextureTreatmentNativeFaceBinding,
  planTextureTreatment,
} from "@/lib/texture/treatmentPlan";

type RuntimeToolDefinition = {
  execute: (
    args: Record<string, unknown>,
    context?: unknown
  ) => Promise<unknown>;
};

type MaterialConfigLike = {
  color_value?: number[];
  mer_value?: number[];
  subsurface_value?: number;
  saved: boolean;
  getFilePath?: () => string;
};

type RuntimeCubeFace = CubeFace & {
  UVToLocal?: (point: [number, number]) => {
    x: number;
    y: number;
    z: number;
  };
};

const FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;
const SEAM_FACE_BUDGET = 64;
const SEAM_SAMPLES_PER_EDGE = 4;
const PBR_SAMPLE_BUDGET = 4096;

let wired = false;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function runtimeDefinition(name: string): RuntimeToolDefinition {
  const definition = getAllToolDefinitions()[name] as
    | RuntimeToolDefinition
    | undefined;
  if (!definition) throw new Error(`Texture authoring wiring requires ${name}.`);
  return definition;
}

function inverseFaceRotation(
  x: number,
  y: number,
  rotation: number
): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [y, 1 - x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [1 - y, x];
    default:
      return [x, y];
  }
}

function faceBoundaryPoint(
  face: RuntimeCubeFace,
  localX: number,
  localY: number
): [number, number, number] | null {
  if (typeof face.UVToLocal !== "function") return null;
  const [rawX, rawY] = inverseFaceRotation(localX, localY, face.rotation);
  const uv: [number, number] = [
    face.uv[0] + (face.uv[2] - face.uv[0]) * rawX,
    face.uv[1] + (face.uv[3] - face.uv[1]) * rawY,
  ];
  const point = face.UVToLocal(uv);
  if (
    !point ||
    ![point.x, point.y, point.z].every(
      (value) => typeof value === "number" && Number.isFinite(value)
    )
  ) {
    return null;
  }
  return [point.x, point.y, point.z];
}

function pixelAt(
  context: unknown,
  texture: Texture,
  mapping: ReturnType<typeof mapFaceUvToTexturePixels>,
  rotation: number,
  localX: number,
  localY: number,
  contextLabel: string
): TextureSeamRgba | null {
  const atlas = mapFaceLocalPixelToAtlasPixel(
    mapping,
    rotation,
    localX,
    localY,
    contextLabel
  );
  if (
    atlas.x < 0 ||
    atlas.y < 0 ||
    atlas.x >= texture.width ||
    atlas.y >= texture.display_height
  ) {
    return null;
  }
  try {
    const pixel = readTextureDiagnosticRegion(
      context,
      texture,
      atlas.x,
      atlas.y,
      1,
      1
    ).pixels;
    return [pixel[0], pixel[1], pixel[2], pixel[3]];
  } catch (error) {
    if (isTextureDiagnosticBudgetExceeded(error)) throw error;
    return null;
  }
}

function sampledEdge(
  context: unknown,
  texture: Texture,
  face: RuntimeCubeFace,
  mapping: ReturnType<typeof mapFaceUvToTexturePixels>,
  edge: "left" | "right" | "top" | "bottom",
  localWidth: number,
  localHeight: number,
  contextLabel: string
): TextureSeamRgba[] | null {
  const length = edge === "left" || edge === "right" ? localHeight : localWidth;
  const count = Math.max(1, Math.min(SEAM_SAMPLES_PER_EDGE, length));
  const samples: TextureSeamRgba[] = [];

  for (let index = 0; index < count; index += 1) {
    const t = (index + 0.5) / count;
    const x =
      edge === "left"
        ? 0
        : edge === "right"
          ? localWidth - 1
          : Math.min(localWidth - 1, Math.floor(t * localWidth));
    const y =
      edge === "top"
        ? 0
        : edge === "bottom"
          ? localHeight - 1
          : Math.min(localHeight - 1, Math.floor(t * localHeight));
    const sample = pixelAt(
      context,
      texture,
      mapping,
      face.rotation,
      x,
      y,
      contextLabel
    );
    if (!sample) return null;
    samples.push(sample);
  }
  return samples;
}

export function seamContinuityRuntime(context?: unknown) {
  if (typeof Cube === "undefined" || typeof Texture === "undefined" ||
      !Array.isArray(Cube.all)) {
    return {
      state: "unavailable" as const,
      reason: "blockbench_texture_runtime_unavailable" as const,
    };
  }

  const cubes = [...Cube.all];
  const registeredTextures = Array.isArray(Texture.all)
    ? new Set<Texture>(Texture.all) : null;
  const projectTextures =
    typeof Project !== "undefined" && Array.isArray(Project?.textures)
      ? new Set<Texture>(Project.textures)
      : null;
  // A registered face may point to a matching Texture object while
  // Project.textures and Texture.all contain different/duplicate atlases.
  // Such a partial inventory cannot attest model-wide material ownership.
  const textureInventoriesMatch = registeredTextures && projectTextures &&
    Texture.all.length === Project.textures.length &&
    registeredTextures.size === Texture.all.length &&
    projectTextures.size === Project.textures.length &&
    Texture.all.every(texture => projectTextures.has(texture));
  const textureInventoryState = textureInventoriesMatch
    ? ("verified" as const)
    : registeredTextures || projectTextures
      ? ("partial" as const)
      : ("unavailable" as const);

  const outliner = typeof Outliner !== "undefined" &&
      Array.isArray(Outliner?.elements)
    ? [...Outliner.elements] : null;
  const cubeObjects = new Set<unknown>(cubes);
  const outlinerObjects = outliner ? new Set<unknown>(outliner) : null;
  const outlinerCounts = outliner ? {
    element_count: outliner.length,
    cube_entry_count: outliner.filter(item => cubeObjects.has(item)).length,
    non_cube_count: outliner.filter(item => !cubeObjects.has(item)).length,
    missing_cube_count: cubes.filter(cube => !outlinerObjects!.has(cube)).length,
    duplicate_entry_count: outliner.length - outlinerObjects!.size,
  } : null;
  // Cube UUID collisions must be known before sampling the *first*
  // duplicate; otherwise its edges could appear to share native ownership
  // with a second Cube that is encountered later.
  const cubeIdCounts = new Map<string, number>();
  let invalidCubeIds = 0;
  for (const cube of cubes) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim()) {
      invalidCubeIds += 1;
    } else {
      cubeIdCounts.set(cube.uuid, (cubeIdCounts.get(cube.uuid) ?? 0) + 1);
    }
  }
  const duplicateCubeUuidCount = invalidCubeIds +
    [...cubeIdCounts.values()].reduce(
      (count, occurrences) => count + Math.max(0, occurrences - 1), 0
    );
  let missingFaceSlots = 0;
  let disabledFaces = 0;
  let untexturedFaces = 0;
  let foreignTextureFaces = 0;
  let resolverErrorFaces = 0;
  let eligibleTexturedFaces = 0;
  const modelOmissions: TextureModelFaceInventoryOmission[] = [];
  const modelOmit = (
    cubeUuid: string, face: string,
    reason: TextureModelFaceInventoryOmission["reason"]
  ): void => {
    if (modelOmissions.length < 12) {
      modelOmissions.push({ cube_uuid: cubeUuid, face, reason });
    }
  };

  const edges: TextureSeamEdgeInput[] = [];
  let scannedFaces = 0;
  let skippedAnimated = 0;
  let skippedMapping = 0;
  let budgetSkipped = 0;
  const omissionExamples: TextureSeamSkippedFace[] = [];
  const noteSkipped = (
    cubeUuid: string,
    face: string,
    reason: TextureSeamSkippedFace["reason"]
  ): void => {
    if (omissionExamples.length < 12) {
      omissionExamples.push({ cube_uuid: cubeUuid, face, reason });
    }
  };

  for (const cube of cubes) {
    const cubeUuid = typeof cube.uuid === "string" && cube.uuid.trim()
      ? cube.uuid : "__unidentified_cube__";
    const cubeIdentityAmbiguous =
      cubeUuid === "__unidentified_cube__" ||
      cubeIdCounts.get(cubeUuid) !== 1;
    for (const faceKey of FACE_KEYS) {
      const face = cube.faces?.[faceKey] as RuntimeCubeFace | undefined;
      if (!face) {
        missingFaceSlots += 1;
        modelOmit(cubeUuid, faceKey, "face_slot_missing");
        continue;
      }
      if (face.enabled === false) {
        disabledFaces += 1;
        modelOmit(cubeUuid, faceKey, "face_disabled");
        continue;
      }
      if (typeof face.getTexture !== "function") {
        resolverErrorFaces += 1;
        modelOmit(cubeUuid, faceKey, "texture_resolver_failed");
        continue;
      }
      let texture: ReturnType<RuntimeCubeFace["getTexture"]>;
      try {
        texture = face.getTexture();
      } catch {
        resolverErrorFaces += 1;
        modelOmit(cubeUuid, faceKey, "texture_resolver_failed");
        continue;
      }
      if (!texture) {
        untexturedFaces += 1;
        modelOmit(cubeUuid, faceKey, "texture_not_resolved");
        continue;
      }
      if ((registeredTextures && !registeredTextures.has(texture)) ||
          (projectTextures && !projectTextures.has(texture))) {
        foreignTextureFaces += 1;
        modelOmit(cubeUuid, faceKey, "texture_outside_project");
        continue;
      }
      eligibleTexturedFaces += 1;
      if (cubeIdentityAmbiguous) {
        // Mapping a collision as if it were a unique Cube could create
        // fictitious same-Cube seam pairs. Keep it in the unexamined ledger.
        skippedMapping += 1;
        noteSkipped(cubeUuid, faceKey, "mapping_unavailable");
        continue;
      }
      if (texture.height !== texture.display_height) {
        skippedAnimated += 1;
        noteSkipped(cubeUuid, faceKey, "animated_texture");
        continue;
      }
      if (scannedFaces >= SEAM_FACE_BUDGET) {
        budgetSkipped += 1;
        noteSkipped(cubeUuid, faceKey, "sampling_budget");
        continue;
      }

      const contextLabel = `${cube.name}.${faceKey} seam`;
      try {
        const mapping = mapFaceUvToTexturePixels(
          face.uv,
          {
            width: texture.width,
            displayHeight: texture.display_height,
            uvWidth: texture.getUVWidth(),
            uvHeight: texture.getUVHeight(),
          },
          contextLabel
        );
        const [localWidth, localHeight] = faceLocalPixelSize(
          mapping,
          face.rotation,
          contextLabel
        );
        const boundary: Record<
          "left" | "right" | "top" | "bottom",
          [[number, number], [number, number]]
        > = {
          left: [[0, 0], [0, 1]],
          right: [[1, 0], [1, 1]],
          top: [[0, 0], [1, 0]],
          bottom: [[0, 1], [1, 1]],
        };

        let complete = true;
        const faceEdges: TextureSeamEdgeInput[] = [];
        for (const edge of ["left", "right", "top", "bottom"] as const) {
          const start = faceBoundaryPoint(face, ...boundary[edge][0]);
          const end = faceBoundaryPoint(face, ...boundary[edge][1]);
          const samples = sampledEdge(
            context,
            texture,
            face,
            mapping,
            edge,
            localWidth,
            localHeight,
            contextLabel
          );
          if (!start || !end || !samples) {
            complete = false;
            break;
          }
          faceEdges.push({
            cube_uuid: cubeUuid,
            cube_name: cube.name,
            face: faceKey,
            edge,
            start,
            end,
            samples,
          });
        }
        if (!complete) {
          skippedMapping += 1;
          noteSkipped(cubeUuid, faceKey, "mapping_unavailable");
          continue;
        }
        edges.push(...faceEdges);
        scannedFaces += 1;
      } catch (error) {
        if (isTextureDiagnosticBudgetExceeded(error)) {
          budgetSkipped += 1;
          noteSkipped(cubeUuid, faceKey, "sampling_budget");
        } else {
          skippedMapping += 1;
          noteSkipped(cubeUuid, faceKey, "mapping_unavailable");
        }
      }
    }
  }

  const scan = summarizeTextureSeamScanEvidence({
    face_budget: SEAM_FACE_BUDGET,
    scanned_faces: scannedFaces,
    skipped_animated_faces: skippedAnimated,
    skipped_mapping_faces: skippedMapping,
    budget_skipped_faces: budgetSkipped,
    samples_per_edge_max: SEAM_SAMPLES_PER_EDGE,
    skipped_examples: omissionExamples,
  });
  const modelFaceInventory = summarizeTextureModelFaceInventory({
    cube_count: cubes.length,
    duplicate_cube_uuid_count: duplicateCubeUuidCount,
    missing_face_slot_count: missingFaceSlots,
    disabled_face_count: disabledFaces,
    untextured_enabled_face_count: untexturedFaces,
    foreign_texture_enabled_face_count: foreignTextureFaces,
    resolver_error_enabled_face_count: resolverErrorFaces,
    eligible_textured_face_count: eligibleTexturedFaces,
    texture_inventory_state: textureInventoryState,
    outliner_element_count: outlinerCounts?.element_count ?? null,
    outliner_cube_entry_count: outlinerCounts?.cube_entry_count ?? null,
    outliner_non_cube_count: outlinerCounts?.non_cube_count ?? null,
    outliner_missing_cube_count: outlinerCounts?.missing_cube_count ?? null,
    outliner_duplicate_entry_count: outlinerCounts?.duplicate_entry_count ?? null,
    sampled_faces: scannedFaces,
    skipped_animated_faces: skippedAnimated,
    skipped_mapping_faces: skippedMapping,
    budget_skipped_faces: budgetSkipped,
    omission_examples: modelOmissions,
  });
  const seam = analyzeTextureSeamContinuity(edges);
  return {
    ...seam,
    // Keep the existing advisory result, but do not return a falsely empty
    // reasons list when the bounded scan skipped requested model surfaces.
    gate: {
      ...seam.gate,
      reasons: [
        ...seam.gate.reasons,
        ...(scan.unexamined_face_count > 0 ? ["SEAM_SCAN_PARTIAL"] : []),
        ...(modelFaceInventory.unexamined_enabled_face_count > 0 ||
          modelFaceInventory.missing_face_slot_count > 0
          ? ["MODEL_FACE_OWNERSHIP_OR_SAMPLING_INCOMPLETE"] : []),
        ...(modelFaceInventory.inventory_state !== "cube_face_slots_enumerated"
          ? ["MODEL_SCENE_INVENTORY_UNVERIFIED"] : []),
      ],
    },
    scan,
    model_face_inventory: modelFaceInventory,
    efficiency: {
      bounded: true,
      full_atlas_scan: false,
      edge_samples_only: true,
    },
  };
}

/**
 * A future approved material/continuity source may explicitly declare
 * physical Cube edges. A material name or coincident endpoint alone does not
 * authorize continuous-surface comparison. This API is deliberately NOT
 * registered as a Runtime/Gateway operation; the active list_textures seam
 * response stays intra-Cube until this contract is integrated and verified.
 */
export type DeclaredNativeCrossCubeSeamEdge = {
  cube_uuid: string;
  face: (typeof FACE_KEYS)[number];
  edge: "left" | "right" | "top" | "bottom";
  continuity_intent: TextureSeamContinuityIntent;
  surface_id: string | null;
  material_id: string | null;
  /** UUID resolved by CubeFace.getTexture at approved declaration time. */
  expected_texture_uuid: string;
  /** Exact native CubeFace.material_name; "" is a valid default. */
  expected_native_material_name: string;
};

export const DECLARED_CROSS_CUBE_NATIVE_EDGE_LIMIT = 64;
const DECLARED_CROSS_CUBE_SKIP_EXAMPLE_LIMIT = 12;

export function inspectDeclaredNativeCrossCubeSeams(
  declarations: readonly DeclaredNativeCrossCubeSeamEdge[],
  context?: unknown,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  if (!Array.isArray(declarations) ||
      declarations.length > DECLARED_CROSS_CUBE_NATIVE_EDGE_LIMIT) {
    throw new Error(
      "CROSS_CUBE_DECLARATION_INVALID: at most 64 explicit native seam edges may be inspected."
    );
  }
  const keys = new Set<string>();
  for (const declaration of declarations as readonly DeclaredNativeCrossCubeSeamEdge[]) {
    if (!declaration ||
        typeof declaration.cube_uuid !== "string" ||
        !declaration.cube_uuid.trim() ||
        !FACE_KEYS.includes(declaration.face) ||
        !["left", "right", "top", "bottom"].includes(declaration.edge) ||
        !["REQUIRED", "INTENTIONAL_BOUNDARY", "UNSPECIFIED"].includes(
          declaration.continuity_intent
        ) ||
        (declaration.surface_id !== null &&
          (typeof declaration.surface_id !== "string" || !declaration.surface_id.trim())) ||
        (declaration.material_id !== null &&
          (typeof declaration.material_id !== "string" || !declaration.material_id.trim())) ||
        typeof declaration.expected_texture_uuid !== "string" ||
        !declaration.expected_texture_uuid.trim() ||
        typeof declaration.expected_native_material_name !== "string" ||
        (declaration.continuity_intent === "REQUIRED" &&
          (!declaration.surface_id || !declaration.material_id))) {
      throw new Error(
        "CROSS_CUBE_DECLARATION_INVALID: require Cube UUID, face, edge, explicit intent, and material/surface identity for REQUIRED seams."
      );
    }
    const key = declaration.cube_uuid + ":" +
      declaration.face + ":" + declaration.edge;
    if (keys.has(key)) {
      throw new Error("CROSS_CUBE_DECLARATION_INVALID: a Cube face edge was declared twice.");
    }
    keys.add(key);
  }

  const empty = analyzeCrossCubeSeamContinuity([], 6, alphaSemantics);
  if (declarations.length === 0) {
    return {
      ...empty,
      state: "not_evaluated" as const,
      declaration_state: "missing" as const,
      sampled_declared_edge_count: 0,
      omitted_declared_edge_count: 0,
      binding_mismatch_count: 0,
      comparison_state: "not_evaluated" as const,
      texture_revision_attested: false as const,
      material_approval_attested: false as const,
      diagnostic_io: null,
      omission_examples: [],
      omission_examples_truncated: false,
      note: "Cross-Cube continuity requires approved explicit material and surface intent. No native sampling or visual verdict was performed.",
    };
  }
  if (typeof Cube === "undefined" || typeof Texture === "undefined" ||
      !Array.isArray(Cube.all)) {
    return {
      ...empty,
      state: "unavailable" as const,
      declaration_state: "explicit" as const,
      reason: "blockbench_cross_cube_runtime_unavailable" as const,
      sampled_declared_edge_count: 0,
      omitted_declared_edge_count: declarations.length,
      binding_mismatch_count: 0,
      comparison_state: "not_evaluated" as const,
      texture_revision_attested: false as const,
      material_approval_attested: false as const,
      diagnostic_io: null,
      omission_examples: declarations.slice(0, DECLARED_CROSS_CUBE_SKIP_EXAMPLE_LIMIT)
        .map(item => ({
          cube_uuid: item.cube_uuid, face: item.face,
          edge: item.edge, reason: "native_runtime_unavailable",
        })),
      omission_examples_truncated: declarations.length > DECLARED_CROSS_CUBE_SKIP_EXAMPLE_LIMIT,
      gate: {
        ...empty.gate,
        reasons: ["CROSS_CUBE_NATIVE_EVIDENCE_PARTIAL"],
      },
    };
  }
  const cubes = new Map<string, Cube>();
  for (const cube of Cube.all) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() ||
        cubes.has(cube.uuid)) {
      throw new Error(
        "CROSS_CUBE_NATIVE_OWNER_AMBIGUOUS: source Cube UUIDs must be unique and non-empty."
      );
    }
    cubes.set(cube.uuid, cube);
  }
  const nativeContext = ensureTextureDiagnosticInvocationContext(context);
  const boundary: Record<DeclaredNativeCrossCubeSeamEdge["edge"],
    [[number, number], [number, number]]> = {
    left: [[0, 0], [0, 1]],
    right: [[1, 0], [1, 1]],
    top: [[0, 0], [1, 0]],
    bottom: [[0, 1], [1, 1]],
  };
  const sampled: CrossCubeSeamEdgeInput[] = [];
  const omissions: Array<{
    cube_uuid: string; face: string; edge: string; reason: string;
  }> = [];
  let omittedCount = 0;
  let bindingMismatchCount = 0;
  const omit = (declaration: DeclaredNativeCrossCubeSeamEdge, reason: string) => {
    omittedCount += 1;
    if (reason === "native_texture_binding_changed" ||
        reason === "native_texture_inventory_unverified" ||
        reason === "native_material_binding_changed" ||
        reason === "native_binding_changed_during_sampling") {
      bindingMismatchCount += 1;
    }
    if (omissions.length < DECLARED_CROSS_CUBE_SKIP_EXAMPLE_LIMIT) {
      omissions.push({
        cube_uuid: declaration.cube_uuid,
        face: declaration.face,
        edge: declaration.edge,
        reason,
      });
    }
  };
  for (const declaration of declarations as readonly DeclaredNativeCrossCubeSeamEdge[]) {
    const cube = cubes.get(declaration.cube_uuid);
    const face = cube?.faces[declaration.face] as RuntimeCubeFace | undefined;
    if (!cube || !face || face.enabled === false ||
        typeof face.getTexture !== "function") {
      omit(declaration, "cube_or_face_unavailable");
      continue;
    }
    let texture: ReturnType<RuntimeCubeFace["getTexture"]>;
    try {
      texture = face.getTexture();
    } catch {
      omit(declaration, "texture_unavailable");
      continue;
    }
    if (!texture) {
      omit(declaration, "texture_unavailable");
      continue;
    }
    const nativeTextures = Array.isArray(Texture.all) ? Texture.all : [];
    const projectTextures =
      typeof Project !== "undefined" && Array.isArray(Project?.textures)
        ? Project.textures
        : null;
    if (!nativeTextures.includes(texture) ||
        (projectTextures && !projectTextures.includes(texture))) {
      omit(declaration, "native_texture_inventory_unverified");
      continue;
    }
    // Blockbench resolves single-texture, group and plugin face overrides in
    // getTexture(); raw face.texture alone is not the rendered identity.
    if (texture.uuid !== declaration.expected_texture_uuid) {
      omit(declaration, "native_texture_binding_changed");
      continue;
    }
    if (face.material_name !== declaration.expected_native_material_name) {
      omit(declaration, "native_material_binding_changed");
      continue;
    }
    if (texture.height !== texture.display_height) {
      omit(declaration, "animated_texture_unverified");
      continue;
    }
    const mesh = cube.mesh;
    if (!mesh || typeof mesh.updateWorldMatrix !== "function" ||
        !mesh.matrixWorld ||
        typeof mesh.matrixWorld.elements?.length !== "number" ||
        mesh.matrixWorld.elements.length !== 16) {
      omit(declaration, "world_transform_unavailable");
      continue;
    }
    try {
      // CubeFace.UVToLocal emits mesh-local vectors (after subtracting Cube
      // origin); parent-group pivots and rotations live in matrixWorld.
      mesh.updateWorldMatrix(true, false);
      const nativeUv = [...face.uv];
      const nativeRotation = face.rotation;
      const worldMatrix = [...mesh.matrixWorld.elements];
      const localStart = faceBoundaryPoint(face, ...boundary[declaration.edge][0]);
      const localEnd = faceBoundaryPoint(face, ...boundary[declaration.edge][1]);
      if (!localStart || !localEnd) {
        omit(declaration, "native_edge_mapping_unavailable");
        continue;
      }
      const world = projectNativeCubeSeamEdgeToWorld({
        face: declaration.face,
        local_start: localStart,
        local_end: localEnd,
        matrix_world: mesh.matrixWorld.elements,
      });
      const mapping = mapFaceUvToTexturePixels(
        face.uv,
        {
          width: texture.width,
          displayHeight: texture.display_height,
          uvWidth: texture.getUVWidth(),
          uvHeight: texture.getUVHeight(),
        },
        declaration.cube_uuid + ":" + declaration.face + " cross-Cube seam"
      );
      const [localWidth, localHeight] = faceLocalPixelSize(
        mapping, face.rotation, "cross-Cube native face pixels"
      );
      const samples = sampledEdge(
        nativeContext,
        texture,
        face,
        mapping,
        declaration.edge,
        localWidth,
        localHeight,
        "cross-Cube native face samples"
      );
      if (!samples || samples.length < 2) {
        omit(declaration, "insufficient_exact_texel_samples");
        continue;
      }
      let resolvedAfter: ReturnType<RuntimeCubeFace["getTexture"]>;
      try {
        resolvedAfter = face.getTexture();
      } catch {
        omit(declaration, "native_binding_changed_during_sampling");
        continue;
      }
      if (!resolvedAfter ||
          resolvedAfter.uuid !== declaration.expected_texture_uuid ||
          !nativeTextures.includes(resolvedAfter) ||
          (projectTextures && !projectTextures.includes(resolvedAfter)) ||
          face.material_name !== declaration.expected_native_material_name ||
          Reflect.get(face, "enabled") === false ||
          face.rotation !== nativeRotation ||
          nativeUv.length !== face.uv.length ||
          nativeUv.some((coordinate, index) => coordinate !== face.uv[index]) ||
          worldMatrix.some((coordinate, index) =>
            coordinate !== mesh.matrixWorld.elements[index])) {
        omit(declaration, "native_binding_changed_during_sampling");
        continue;
      }
      sampled.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        face: declaration.face,
        edge: declaration.edge,
        ...world,
        samples,
        continuity_intent: declaration.continuity_intent,
        surface_id: declaration.surface_id,
        material_id: declaration.material_id,
      });
    } catch (error) {
      omit(declaration, isTextureDiagnosticBudgetExceeded(error)
        ? "pixel_budget_exhausted"
        : "native_world_or_pixel_evidence_unverified");
    }
  }

  const reviewed = analyzeCrossCubeSeamContinuity(
    sampled, 6, alphaSemantics
  );
  return {
    ...reviewed,
    declaration_state: "explicit" as const,
    state: sampled.length === 0 ? ("not_evaluated" as const) :
      reviewed.state,
    sampled_declared_edge_count: sampled.length,
    omitted_declared_edge_count: omittedCount,
    binding_mismatch_count: bindingMismatchCount,
    comparison_state: reviewed.compared_pair_count === 0
      ? ("not_evaluated" as const)
      : omittedCount > 0
        ? ("partial" as const)
        : ("advisory_only" as const),
    // The declaration is caller-supplied, not an approval document.
    // Bounded per-edge pixel reads are not a revision-pinned atlas snapshot.
    texture_revision_attested: false as const,
    material_approval_attested: false as const,
    omission_examples: omissions,
    omission_examples_truncated: omittedCount > omissions.length,
    // Source-backed sampling != matching-SHA installed Blockbench acceptance.
    native_sampling_attested: false as const,
    scene_coverage_attested: false as const,
    visual_verdict: "not_evaluated" as const,
    gate: {
      ...reviewed.gate,
      reasons: [
        ...reviewed.gate.reasons,
        ...(omittedCount > 0 ? ["CROSS_CUBE_NATIVE_EVIDENCE_PARTIAL"] : []),
        ...(bindingMismatchCount > 0 ? ["CROSS_CUBE_NATIVE_BINDING_STALE"] : []),
      ],
    },
    diagnostic_io: textureDiagnosticReadMetrics(nativeContext),
  };
}

/**
 * Source-only, unregistered read-window revision gate for the *already
 * declared* native cross-Cube sampler. This checks exactly the referenced
 * flattened atlases, not all project variants/channels or every model face.
 *
 * A caller must pin canonical full decoded-RGBA revisions gathered from
 * current Texture evidence. It never grants material/reference approval.
 */
export async function inspectRevisionPinnedNativeCrossCubeSeams(
  declarations: readonly DeclaredNativeCrossCubeSeamEdge[],
  expectedTextureRevisions: Readonly<Record<string, string>>,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  if (!Array.isArray(declarations) ||
      declarations.length > DECLARED_CROSS_CUBE_NATIVE_EDGE_LIMIT) {
    throw new Error(
      "CROSS_CUBE_REVISION_SCOPE_INVALID: at most 64 explicitly declared face edges are supported."
    );
  }
  if (declarations.length === 0) {
    if (!expectedTextureRevisions ||
        Object.keys(expectedTextureRevisions).length !== 0) {
      throw new Error(
        "CROSS_CUBE_REVISION_SCOPE_INVALID: an empty edge request cannot carry orphan atlas revisions."
      );
    }
    return {
      ...inspectDeclaredNativeCrossCubeSeams([]),
      bitmap_revision_evidence: {
        state: "not_evaluated" as const,
        scope: "declared_edge_textures_only" as const,
        observed_atlas_count: 0,
        atlases: [],
        source_bytes_matched_during_read: false as const,
        whole_scene_revision_attested: false as const,
      },
    };
  }
  // Cheap declaration identity check before decoding a potentially large
  // bitmap. Exact semantic validation remains in the canonical sampler.
  const owners = new Set<string>();
  for (const edge of declarations) {
    if (!edge || typeof edge.cube_uuid !== "string" ||
        !edge.cube_uuid.trim() ||
        !FACE_KEYS.includes(edge.face) ||
        !["left", "right", "top", "bottom"].includes(edge.edge) ||
        typeof edge.expected_texture_uuid !== "string" ||
        !edge.expected_texture_uuid.trim()) {
      throw new Error(
        "CROSS_CUBE_REVISION_SCOPE_INVALID: malformed declared Cube-face texture ownership."
      );
    }
    const key = edge.cube_uuid + ":" + edge.face + ":" + edge.edge;
    if (owners.has(key)) {
      throw new Error(
        "CROSS_CUBE_REVISION_SCOPE_INVALID: duplicated declared Cube-face edge."
      );
    }
    owners.add(key);
  }
  const uuids = [...new Set(declarations.map(edge =>
    edge.expected_texture_uuid
  ))].sort();
  if (!expectedTextureRevisions || uuids.length > 8 ||
      uuids.some(uuid => !uuid || !uuid.trim()) ||
      Object.keys(expectedTextureRevisions).sort().join("\u0000") !==
        uuids.join("\u0000")) {
    throw new Error(
      "CROSS_CUBE_REVISION_SCOPE_INVALID: supply exact revision keys for 1..8 referenced texture UUIDs."
    );
  }
  for (const uuid of uuids) {
    textureRevisionSchema.parse(expectedTextureRevisions[uuid]);
  }
  if (typeof Project === "undefined" || !Project ||
      typeof Texture === "undefined" || !Array.isArray(Texture.all) ||
      typeof Cube === "undefined" || !Array.isArray(Cube.all) ||
      !Array.isArray(Project.textures)) {
    throw new Error(
      "CROSS_CUBE_REVISION_NATIVE_UNAVAILABLE: require a current Blockbench project and complete Texture inventory."
    );
  }

  const project = Project;
  const nativeTextures = [...Texture.all];
  const projectTextures = [...Project.textures];
  const selected: Array<{
    uuid: string;
    texture: Texture;
    original: ReturnType<typeof fullTextureRgba>;
    revision: string;
  }> = [];
  let totalPixels = 0;
  for (const uuid of uuids) {
    const matches = nativeTextures.filter(texture => texture.uuid === uuid);
    if (matches.length !== 1 || !projectTextures.includes(matches[0])) {
      throw new Error(
        "CROSS_CUBE_REVISION_NATIVE_SCOPE: each declared atlas must resolve unambiguously inside this project."
      );
    }
    const texture = matches[0];
    const width = texture.width, height = texture.height;
    const pixels = width * height;
    totalPixels += pixels;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width <= 0 || height <= 0 ||
        !Number.isSafeInteger(pixels) || pixels > 1_048_576 ||
        totalPixels > 2_097_152 ||
        texture.layers_enabled === true ||
        (texture.frameCount ?? 1) !== 1 ||
        texture.height !== texture.display_height) {
      throw new Error(
        "CROSS_CUBE_REVISION_BITMAP_UNSUPPORTED: requires bounded flattened static decoded RGBA atlases."
      );
    }
    const original = fullTextureRgba(texture);
    if (original.width !== width || original.height !== height ||
        original.pixels.length !== pixels * 4) {
      throw new Error(
        "CROSS_CUBE_REVISION_BITMAP_UNSUPPORTED: decoded bitmap disagrees with pinned atlas dimensions."
      );
    }
    selected.push({
      uuid, texture,
      // Protect the pinned source even if a nonstandard native callback
      // reuses its ImageData buffer across subsequent reads.
      original: {
        ...original,
        pixels: new Uint8ClampedArray(original.pixels),
      },
      revision: "",
    });
  }

  // Hash computation is asynchronous. Bind the *declared face state* as
  // well as the bitmap bytes: a face can be moved/reassigned while crypto
  // runs even if the atlas image is unchanged.
  const readDeclaredFrame = () => {
    return declarations.map(edge => {
      if (!Array.isArray(Cube.all)) {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: native Cube owner inventory unavailable."
        );
      }
      const matching = Cube.all.filter(cube => cube.uuid === edge.cube_uuid);
      const cube = matching[0];
      const face = cube?.faces[edge.face] as RuntimeCubeFace | undefined;
      if (matching.length !== 1 || !face || face.enabled === false ||
          typeof face.getTexture !== "function") {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: declared face owner disappeared or is not visible."
        );
      }
      const texture = face.getTexture();
      if (!texture || texture.uuid !== edge.expected_texture_uuid ||
          !nativeTextures.includes(texture) ||
          !projectTextures.includes(texture) ||
          face.material_name !== edge.expected_native_material_name) {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: declared face material/texture binding is stale."
        );
      }
      const mesh = cube.mesh;
      if (!mesh || typeof mesh.updateWorldMatrix !== "function" ||
          !mesh.matrixWorld || mesh.matrixWorld.elements?.length !== 16 ||
          !Array.isArray(face.uv) || face.uv.length !== 4 ||
          face.uv.some(value => !Number.isFinite(value))) {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: face UV or mesh world transform unavailable."
        );
      }
      mesh.updateWorldMatrix(true, false);
      const world = Array.from(mesh.matrixWorld.elements);
      if (world.length !== 16 || world.some(value => !Number.isFinite(value))) {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: nonfinite face world transform."
        );
      }
      return {
        cube, face, texture, mesh,
        uv: [...face.uv],
        rotation: face.rotation,
        material: face.material_name,
        enabled: face.enabled,
        matrix: world,
      };
    });
  };
  const declaredFrame = readDeclaredFrame();
  const requireDeclaredFrameFresh = (phase: string) => {
    const current = readDeclaredFrame();
    const stale = current.some((edge, index) => {
      const before = declaredFrame[index];
      return edge.cube !== before.cube ||
        edge.face !== before.face ||
        edge.texture !== before.texture ||
        edge.mesh !== before.mesh ||
        edge.rotation !== before.rotation ||
        edge.material !== before.material ||
        edge.enabled !== before.enabled ||
        edge.uv.some((value, i) => value !== before.uv[i]) ||
        edge.matrix.some((value, i) => value !== before.matrix[i]);
    });
    if (stale) {
      throw new Error(
        "CROSS_CUBE_REVISION_SOURCE_CHANGED: declared geometry/UV/material binding changed " +
          phase + "."
      );
    }
  };

  const ensureFresh = (phase: string) => {
    requireDeclaredFrameFresh(phase);
    if (typeof Project === "undefined" || Project !== project ||
        typeof Texture === "undefined" ||
        !Array.isArray(Texture.all) ||
        !Array.isArray(Project.textures) ||
        Texture.all.length !== nativeTextures.length ||
        Project.textures.length !== projectTextures.length ||
        nativeTextures.some(texture => !Texture.all.includes(texture)) ||
        projectTextures.some(texture => !Project.textures.includes(texture))) {
      throw new Error(
        "CROSS_CUBE_REVISION_SOURCE_CHANGED: project/atlas inventory changed " + phase + "."
      );
    }
    for (const { texture, uuid, original } of selected) {
      if (texture.uuid !== uuid || texture.layers_enabled === true ||
          (texture.frameCount ?? 1) !== 1 ||
          texture.height !== texture.display_height ||
          texture.width !== original.width ||
          texture.height !== original.height) {
        throw new Error(
          "CROSS_CUBE_REVISION_SOURCE_CHANGED: atlas metadata changed " + phase + "."
        );
      }
      requireUnchangedTextureBitmap(
        original, fullTextureRgba(texture),
        "CROSS_CUBE_REVISION_SOURCE_CHANGED: decoded pixels changed " +
          phase + " for " + uuid + "."
      );
    }
  };

  for (const entry of selected) {
    entry.revision = await computeTextureRevision(
      entry.original.pixels, entry.original.width, entry.original.height
    );
    requireTextureRevisionMatch(
      expectedTextureRevisions[entry.uuid], entry.revision,
      "CROSS_CUBE_REVISION_STALE: " + entry.uuid
    );
  }
  // Crypto.digest yields. Re-read all full source bitmaps after awaits
  // before allowing the bounded edge sampler to consume cached pixels.
  ensureFresh("before edge sampling");
  const result = inspectDeclaredNativeCrossCubeSeams(
    declarations,
    ensureTextureDiagnosticInvocationContext(undefined),
    alphaSemantics
  );
  // Never return a successful revision receipt if a paint operation changed
  // a covered atlas during the edge sampling phase.
  ensureFresh("after edge sampling");
  return {
    ...result,
    bitmap_revision_evidence: {
      state: "matched_during_read" as const,
      scope: "declared_edge_textures_only" as const,
      observed_atlas_count: selected.length,
      atlases: selected.map(({ uuid, revision }) => ({
        texture_uuid: uuid,
        decoded_rgba_revision: revision,
      })),
      source_bytes_matched_during_read: true as const,
      whole_scene_revision_attested: false as const,
    },
    // Source-level hash agreement is not installed Runtime/visual acceptance.
    texture_revision_attested: false as const,
    native_sampling_attested: false as const,
    scene_coverage_attested: false as const,
    material_approval_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/**
 * Pure Texture treatment plan -> current native binding handoff. Existing
 * FaceTreatment assignments and explicit seam_pairs own the semantic scope;
 * no matching-color/material guess or user approval is inferred. The live
 * inspector rechecks each face after sampled RGBA reads.
 *
 * UNREGISTERED: the existing list_textures API remains intra-Cube only.
 */
function buildNativeTreatmentCrossCubeHandoff(
  plan: ReturnType<typeof planTextureTreatment>
) {
  // Reject post-planning seam/material/evidence mutations before reading
  // Blockbench globals or any texture pixels.
  requireTextureTreatmentSeamPlanReady(plan);
  if (typeof Cube === "undefined" || typeof Texture === "undefined" ||
      !Array.isArray(Cube.all) || !Array.isArray(Texture.all)) {
    throw new Error(
      "TEXTURE_SEAM_HANDOFF_NATIVE_UNAVAILABLE: current Cube and Texture inventories are required."
    );
  }
  const nativeCubes = new Map<string, Cube>();
  for (const cube of Cube.all) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() ||
        nativeCubes.has(cube.uuid)) {
      throw new Error(
        "TEXTURE_SEAM_HANDOFF_NATIVE_UNAVAILABLE: native Cube UUIDs are missing or ambiguous."
      );
    }
    nativeCubes.set(cube.uuid, cube);
  }
  const bindings: TextureTreatmentNativeFaceBinding[] = [];
  for (const region of plan.regions) {
    for (const target of region.face_targets) {
      const face = nativeCubes.get(target.cube_uuid)?.faces[target.face];
      if (!face || typeof face.getTexture !== "function" ||
          typeof face.material_name !== "string") {
        throw new Error(
          "TEXTURE_SEAM_HANDOFF_NATIVE_UNAVAILABLE: declared treatment face cannot be inspected."
        );
      }
      const texture = face.getTexture();
      if (texture && (!Texture.all.includes(texture) ||
          (typeof Project !== "undefined" && Array.isArray(Project?.textures) &&
           !Project.textures.includes(texture)))) {
        throw new Error(
          "TEXTURE_SEAM_HANDOFF_NATIVE_UNAVAILABLE: resolved face atlas does not belong to the current texture inventory."
        );
      }
      bindings.push({
        cube_uuid: target.cube_uuid,
        face: target.face,
        texture_uuid: texture ? texture.uuid : null,
        native_material_name: face.material_name,
      });
    }
  }
  return buildTextureTreatmentCrossCubeSeamHandoff(plan, bindings);
}

function reviewOnlyTreatmentHandoffReceipt(
  handoff: ReturnType<typeof buildTextureTreatmentCrossCubeSeamHandoff>
) {
  return {
    source: handoff.source,
    state: handoff.state,
    scope: handoff.scope,
    declared_pair_count: handoff.declared_pair_count,
    reference_observations: handoff.reference_observations.map(record => ({
      ...record,
      observed_edges: [
        { ...record.observed_edges[0] },
        { ...record.observed_edges[1] },
      ],
    })),
    assertion_provenance: "CALLER_DECLARATION_UNVERIFIED" as const,
    native_binding_attested: false as const,
    material_approval_attested: false as const,
    texture_revision_attested: false as const,
    scene_coverage_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/** Existing unregistered treatment-bound inspection; no public change. */
export function inspectTreatmentBoundNativeCrossCubeSeams(
  plan: ReturnType<typeof planTextureTreatment>,
  context?: unknown,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  const handoff = buildNativeTreatmentCrossCubeHandoff(plan);
  const inspected = inspectDeclaredNativeCrossCubeSeams(
    handoff.declarations, context, alphaSemantics
  );
  return {
    ...inspected,
    treatment_handoff: reviewOnlyTreatmentHandoffReceipt(handoff),
  };
}

/**
 * Revision-pinned treatment-owned read window. Keeps the *same* canonical
 * plan/native ownership and read-only sampler, with an additional exact
 * decoded RGBA freshness check for only the explicitly declared edge atlases.
 * Does not attest independently authorized reference material.
 */
export async function inspectRevisionPinnedTreatmentCrossCubeSeams(
  plan: ReturnType<typeof planTextureTreatment>,
  expectedTextureRevisions: Readonly<Record<string, string>>,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  const handoff = buildNativeTreatmentCrossCubeHandoff(plan);
  const inspected = await inspectRevisionPinnedNativeCrossCubeSeams(
    handoff.declarations, expectedTextureRevisions, alphaSemantics
  );
  return {
    ...inspected,
    treatment_handoff: reviewOnlyTreatmentHandoffReceipt(handoff),
  };
}

function sampleTexture(
  context: unknown,
  texture: Texture
): Uint8ClampedArray | null {
  const width = texture.width;
  const height = texture.display_height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  try {
    const total = width * height;
    if (total <= PBR_SAMPLE_BUDGET) {
      return readTextureDiagnosticRegion(
        context,
        texture,
        0,
        0,
        width,
        height
      ).pixels;
    }
    if (typeof document === "undefined") return null;
    const scale = Math.sqrt(PBR_SAMPLE_BUDGET / total);
    const targetWidth = Math.max(1, Math.floor(width * scale));
    const targetHeight = Math.max(1, Math.floor(height * scale));
    return readTextureDiagnosticSample(
      context,
      texture,
      targetWidth,
      targetHeight,
      () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Texture PBR diagnostic sample canvas is unavailable.");
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          texture.canvas,
          0,
          0,
          width,
          height,
          0,
          0,
          targetWidth,
          targetHeight
        );
        return new Uint8ClampedArray(
          ctx.getImageData(0, 0, targetWidth, targetHeight).data
        );
      }
    ).pixels;
  } catch (error) {
    if (isTextureDiagnosticBudgetExceeded(error)) throw error;
    return null;
  }
}

function pbrContentRuntime(context?: unknown) {
  if (typeof TextureGroup === "undefined" || typeof Texture === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_material_runtime_unavailable" as const,
    };
  }

  const inputs: PbrContentTextureInput[] = [];
  const unavailable: Array<{ uuid: string; name: string; channel: string }> = [];
  let budgetSkipped = 0;

  for (const group of TextureGroup.all ?? []) {
    if (group.is_material !== true) continue;
    const config = group.material_config as unknown as MaterialConfigLike;
    const mersEnabled = Number(config.subsurface_value ?? 0) > 0;
    for (const texture of group.getTextures()) {
      const channel = texture.pbr_channel || "color";
      if (channel !== "normal" && channel !== "height" && channel !== "mer") {
        continue;
      }
      let pixels: Uint8ClampedArray | null = null;
      try {
        pixels = sampleTexture(context, texture);
      } catch (error) {
        if (isTextureDiagnosticBudgetExceeded(error)) {
          budgetSkipped += 1;
          continue;
        }
        throw error;
      }
      if (!pixels) {
        unavailable.push({
          uuid: texture.uuid,
          name: texture.name,
          channel,
        });
        continue;
      }
      inputs.push({
        uuid: texture.uuid,
        name: texture.name,
        channel,
        pixels,
        mers_enabled: channel === "mer" && mersEnabled,
      });
    }
  }

  return {
    ...analyzePbrTextureContent(inputs),
    unavailable: unavailable.slice(0, 6),
    unavailable_truncated: unavailable.length > 6,
    efficiency: {
      bounded: true,
      sample_budget_per_texture: PBR_SAMPLE_BUDGET,
      active_pbr_only: true,
      budget_skipped_textures: budgetSkipped,
    },
  };
}

function materialStatus(group: TextureGroup) {
  const config = group.material_config as unknown as MaterialConfigLike;
  let filePath = "";
  try {
    filePath =
      typeof config.getFilePath === "function" ? config.getFilePath() : "";
  } catch {
    filePath = "";
  }
  return analyzeTextureMaterialStatus({
    uuid: group.uuid,
    name: group.name,
    textures: group.getTextures().map((texture: Texture) => ({
      uuid: texture.uuid,
      name: texture.name,
      channel: texture.pbr_channel || "color",
      width: texture.width,
      height: texture.height,
    })),
    color_value: config.color_value ?? null,
    mer_value: config.mer_value ?? null,
    subsurface_value: config.subsurface_value ?? 0,
    saved: config.saved,
    file_path: filePath,
  });
}

function resolveMaterial(reference: unknown): TextureGroup | null {
  if (typeof reference !== "string" || !reference) return null;
  const uuid = (TextureGroup.all ?? []).find(
    (group: TextureGroup) => group.uuid === reference && group.is_material
  );
  if (uuid) return uuid;
  const matches = (TextureGroup.all ?? []).filter(
    (group: TextureGroup) => group.name === reference && group.is_material
  );
  return matches.length === 1 ? matches[0] : null;
}

function materialWorkflowGuidance() {
  return {
    route:
      "list_materials → get_material_info(one material) → manage_material(create/configure/assign_channel) → list_textures validation → material preview → manage_material(save)",
    channels: {
      color: "texture or uniform RGBA",
      depth: "normal OR height, never both",
      surface:
        "MER RGB = metalness/emissive/roughness; MERS uses MER texture alpha for subsurface when subsurface_value>0",
    },
    note:
      "Material instances are per-face overrides and do not replace the PBR channel model.",
  };
}

function augmentStructuredResult(
  result: unknown,
  additions: Record<string, unknown>
): unknown {
  const record = objectRecord(result);
  const structured = record ? objectRecord(record.structuredContent) : null;
  if (!record || !structured) return result;
  return {
    ...record,
    structuredContent: {
      ...structured,
      ...additions,
    },
  };
}

function wireTextureReads(): void {
  const listTextures = runtimeDefinition("list_textures");
  const originalListTextures = listTextures.execute.bind(listTextures);
  listTextures.execute = async (args, context) => {
    const invocationContext =
      ensureTextureDiagnosticInvocationContext(context);
    const result = await originalListTextures(args, invocationContext);
    if (args.diagnostics !== true) return result;
    const scope =
      typeof args.diagnostic_scope === "string"
        ? args.diagnostic_scope
        : "full";
    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (!record || !structured) return result;
    const alignment = objectRecord(structured.production_alignment);
    const includePbr = scope === "pbr" || scope === "full";

    // Existing K5/K6 caller: opt-in list_textures diagnostics available via
    // normal Gateway invoke_capability. Never infer source reference approval
    // from matching UV rectangles or flat pixels.
    const uv = (scope === "uv" || scope === "full")
      ? objectRecord(structured.uv_audit) : null;
    const reuse = objectRecord(uv?.exact_reuse);
    const overlap = objectRecord(uv?.partial_overlap);
    const optimization = objectRecord(structured.optimization_opportunities);
    const coverage = (scope === "coverage" || scope === "full")
      ? objectRecord(optimization?.coverage) : null;
    const coverageReview = objectRecord(coverage?.review);
    const flat = objectRecord(coverageReview?.solid_color_faces);
    const validCount = (value: unknown): number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0
        ? value : 0;
    const signals = {
      exact_reuse_region_count: uv?.state === "available"
        ? validCount(reuse?.region_count) : 0,
      partial_overlap_pair_count: uv?.state === "available"
        ? validCount(overlap?.pair_count) : 0,
      solid_color_face_count: coverage
        ? validCount(flat?.count) : 0,
      scanned_face_count: coverage
        ? validCount(coverage.scanned_faces) : 0,
    };
    const hasCaseEvidence =
      signals.exact_reuse_region_count > 0 ||
      signals.partial_overlap_pair_count > 0 ||
      (signals.solid_color_face_count > 0 && signals.scanned_face_count > 0);
    let knowledgeGuidance: unknown = null;
    if (hasCaseEvidence) {
      try {
        const reader = createTextureUvCaseReader(textureUvCasebook);
        knowledgeGuidance = suggestTextureUvTechnicalKnowledge(
          signals, id => reader.read(id)
        );
      } catch {
        // Failure of optional authored knowledge must not suppress existing
        // authoritative native diagnostics. Do not fabricate an alternate case.
        knowledgeGuidance = [{
          state: "REVIEW_REQUIRED",
          reason: "TEXTURE_UV_KNOWLEDGE_SOURCE_UNAVAILABLE",
          mutation_authorized: false,
          visual_verdict: "not_evaluated",
        }];
      }
    }
    return {
      ...record,
      structuredContent: {
        ...structured,
        ...(scope === "seam" || scope === "full"
          ? { seam_continuity: seamContinuityRuntime(invocationContext) }
          : {}),
        ...(alignment || includePbr
          ? {
              production_alignment: {
                ...(alignment ?? {}),
                ...(includePbr
                  ? { pbr_content: pbrContentRuntime(invocationContext) }
                  : {}),
              },
            }
          : {}),
        ...(knowledgeGuidance ? { knowledge_guidance: knowledgeGuidance } : {}),
        diagnostic_io: textureDiagnosticReadMetrics(invocationContext),
      },
    };
  };

  const listMaterials = runtimeDefinition("list_materials");
  const originalListMaterials = listMaterials.execute.bind(listMaterials);
  listMaterials.execute = async (args, context) => {
    const result = await originalListMaterials(args, context);
    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (!record || !structured || !Array.isArray(structured.materials)) {
      return result;
    }
    const statuses = new Map(
      (TextureGroup.all ?? [])
        .filter((group: TextureGroup) => group.is_material)
        .map((group: TextureGroup) => [group.uuid, materialStatus(group)])
    );
    return {
      ...record,
      structuredContent: {
        ...structured,
        materials: structured.materials.map((value) => {
          const material = objectRecord(value);
          const uuid = typeof material?.uuid === "string" ? material.uuid : "";
          return material
            ? { ...material, authoring_status: statuses.get(uuid) ?? null }
            : value;
        }),
        workflow: materialWorkflowGuidance(),
      },
    };
  };

  const getMaterialInfo = runtimeDefinition("get_material_info");
  const originalGetMaterialInfo = getMaterialInfo.execute.bind(getMaterialInfo);
  getMaterialInfo.execute = async (args, context) => {
    const result = await originalGetMaterialInfo(args, context);
    const group = resolveMaterial(args.material);
    return augmentStructuredResult(result, {
      authoring_status: group ? materialStatus(group) : null,
      workflow: materialWorkflowGuidance(),
    });
  };
}

function wireMaterialMutationReceipt(): void {
  const manageMaterial = runtimeDefinition("manage_material");
  const originalManageMaterial = manageMaterial.execute.bind(manageMaterial);

  manageMaterial.execute = async (args, context) => {
    const result = await originalManageMaterial(args, context);
    const group =
      args.operation === "create"
        ? resolveMaterial(args.name)
        : resolveMaterial(args.material);
    const status = group ? materialStatus(group) : null;
    const record = objectRecord(result);
    const structured = record ? objectRecord(record.structuredContent) : null;
    if (record) {
      return {
        ...record,
        structuredContent: {
          ...(structured ?? {}),
          operation: args.operation,
          authoring_status: status,
          workflow: materialWorkflowGuidance(),
        },
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text:
            typeof result === "string"
              ? result
              : `Material ${String(args.operation)} completed.`,
        },
      ],
      structuredContent: {
        operation: args.operation,
        authoring_status: status,
        workflow: materialWorkflowGuidance(),
      },
    };
  };
}

/**
 * Adds bounded texture seam/PBR diagnostics and a coherent material authoring
 * receipt without adding MCP tools or changing existing mutation semantics.
 */
export function wireTextureAuthoringRuntime(): void {
  if (wired) return;
  wireTextureReads();
  wireMaterialMutationReceipt();
  wired = true;
}
