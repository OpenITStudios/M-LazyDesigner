/// <reference types="three" />
/// <reference types="blockbench-types" />
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
  summarizeTextureSeamScanEvidence,
  type TextureSeamEdgeInput,
  type TextureSeamRgba,
  type TextureSeamSkippedFace,
} from "@/lib/texture/seamContinuity";
import {
  analyzePbrTextureContent,
  type PbrContentTextureInput,
} from "@/lib/texture/pbrContent";
import { analyzeTextureMaterialStatus } from "@/lib/texture/materialStatus";

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

function seamContinuityRuntime(context?: unknown) {
  if (typeof Cube === "undefined" || typeof Texture === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "blockbench_texture_runtime_unavailable" as const,
    };
  }

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

  for (const cube of Cube.all ?? []) {
    for (const faceKey of FACE_KEYS) {
      const face = cube.faces[faceKey] as RuntimeCubeFace | undefined;
      if (!face || face.enabled === false) continue;
      const texture = face.getTexture();
      if (!texture) continue;
      if (texture.height !== texture.display_height) {
        skippedAnimated += 1;
        noteSkipped(cube.uuid, faceKey, "animated_texture");
        continue;
      }
      if (scannedFaces >= SEAM_FACE_BUDGET) {
        budgetSkipped += 1;
        noteSkipped(cube.uuid, faceKey, "sampling_budget");
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
            cube_uuid: cube.uuid,
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
          noteSkipped(cube.uuid, faceKey, "mapping_unavailable");
          continue;
        }
        edges.push(...faceEdges);
        scannedFaces += 1;
      } catch (error) {
        if (isTextureDiagnosticBudgetExceeded(error)) {
          budgetSkipped += 1;
          noteSkipped(cube.uuid, faceKey, "sampling_budget");
        } else {
          skippedMapping += 1;
          noteSkipped(cube.uuid, faceKey, "mapping_unavailable");
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
      ],
    },
    scan,
    efficiency: {
      bounded: true,
      full_atlas_scan: false,
      edge_samples_only: true,
    },
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