/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { readAuthoringRecipeCubeOwnership } from "@/server/runtime/recipes/authoring/ownership";
import { createBlockbenchAuthoringRecipeService } from "@/server/runtime/recipes/authoring/service";
import {
  mapFaceUvToTexturePixels,
  requireFiniteFaceUv,
  requirePositiveTextureMetric,
  type TexturePixelMetrics,
} from "@/lib/uv/facePixelMapping";

export { mapFaceUvToTexturePixels };

export const inspectElementParameters = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Exact Cube, Group, Locator, or Null Object UUID, or exact unique name; prefer UUID after discovery."
    ),
  detail: z
    .enum(["geometry", "uv"])
    .optional()
    .default("geometry")
    .describe("Geometry transform by default; request `uv` only when UV mapping needs inspection."),
  recipe_optimization_review: z
    .boolean()
    .optional()
    .describe(
      "Opt-in read-only Geometry coincidence/risk/review report for an exact Recipe-owned Cube UUID. Never simplifies or removes Geometry."
    ),
});

export const elementInspectionToolDocs: ToolSpec[] = [
  {
    name: "inspect_element",
    description:
      "Returns focused authored state for one element. Defaults to compact geometry/hierarchy data; opt in to UV detail or a read-only Recipe-owned Cube optimization review.",
    annotations: {
      title: "Inspect Authored Element",
      readOnlyHint: true,
    },
    parameters: inspectElementParameters,
    status: STATUS_STABLE,
  },
];

type InspectableElement = Cube | Group | Locator | NullObject;

function elementType(
  element: InspectableElement
): "cube" | "group" | "locator" | "null_object" {
  if (element instanceof Cube) return "cube";
  if (element instanceof Group) return "group";
  if (element instanceof Locator) return "locator";
  return "null_object";
}

function resolveInspectableElement(reference: string): InspectableElement {
  if (!Project) {
    throw new Error(
      "No project is open. Open or create the intended Bedrock project before inspecting an element."
    );
  }

  const candidates: InspectableElement[] = [
    ...Cube.all,
    ...Group.all,
    ...Locator.all,
    ...NullObject.all,
  ];

  const uuidMatch = candidates.find((element) => element.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = candidates.filter((element) => element.name === reference);
  if (nameMatches.length > 1) {
    const choices = nameMatches
      .map(
        (element) =>
          `${elementType(element)} "${element.name}" (${element.uuid})`
      )
      .join(", ");
    throw new Error(
      `Element name "${reference}" is ambiguous. Use an exact UUID. Candidates: ${choices}`
    );
  }

  if (nameMatches.length === 1) return nameMatches[0];

  throw new Error(
    `Element "${reference}" not found. Use inspect_elements with mode=outline/search to locate the intended authored element, then mode=detail with its UUID.`
  );
}

function parentInfo(
  element: InspectableElement
): { uuid: string; name: string } | null {
  return element.parent instanceof Group
    ? { uuid: element.parent.uuid, name: element.parent.name }
    : null;
}

export function requireFiniteInspectableVector3(
  values: readonly number[],
  context: string
): [number, number, number] {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `${context} contains a non-finite authored transform and cannot be reported safely.`
    );
  }
  return [values[0], values[1], values[2]];
}

export function requireFiniteInspectableVector2(
  values: readonly number[],
  context: string
): [number, number] {
  if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `${context} contains non-finite authored UV state and cannot be reported safely.`
    );
  }
  return [values[0], values[1]];
}

export function requireFiniteInspectableFaceUv(
  values: readonly number[],
  context: string
): [number, number, number, number] {
  return requireFiniteFaceUv(values, context);
}

export function requireFiniteInspectableScalar(value: number, context: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${context} contains a non-finite authored scalar and cannot be reported safely.`
    );
  }
  return value;
}

type EffectiveTextureSpace =
  | {
      state: "mapped";
      texture: {
        uuid: string;
        name: string;
        id: string;
        width: number;
        height: number;
        display_height: number;
        uv_width: number;
        uv_height: number;
      };
      metrics: TexturePixelMetrics;
    }
  | {
      state: "no_texture" | "texture_error" | "animated_texture_unsupported";
      texture: {
        uuid: string;
        name: string;
        id: string;
        width: number;
        height: number;
        display_height: number;
        uv_width: number;
        uv_height: number;
      } | null;
      metrics: null;
    };

function inspectEffectiveTextureSpace(
  texture: Texture | null = Texture.getDefault()
): EffectiveTextureSpace {
  if (!texture) {
    return { state: "no_texture", texture: null, metrics: null };
  }

  const textureInfo = {
    uuid: texture.uuid,
    name: texture.name,
    id: texture.id,
    width: texture.width,
    height: texture.height,
    display_height: texture.display_height,
    uv_width: texture.getUVWidth(),
    uv_height: texture.getUVHeight(),
  };

  if (texture.error) {
    return { state: "texture_error", texture: textureInfo, metrics: null };
  }

  const metrics = {
    width: requirePositiveTextureMetric(
      textureInfo.width,
      `Texture ${texture.name} (${texture.uuid}) width`
    ),
    displayHeight: requirePositiveTextureMetric(
      textureInfo.display_height,
      `Texture ${texture.name} (${texture.uuid}) display height`
    ),
    uvWidth: requirePositiveTextureMetric(
      textureInfo.uv_width,
      `Texture ${texture.name} (${texture.uuid}) UV width`
    ),
    uvHeight: requirePositiveTextureMetric(
      textureInfo.uv_height,
      `Texture ${texture.name} (${texture.uuid}) UV height`
    ),
  };

  if (textureInfo.height !== textureInfo.display_height) {
    return {
      state: "animated_texture_unsupported",
      texture: textureInfo,
      metrics: null,
    };
  }

  return {
    state: "mapped",
    texture: textureInfo,
    metrics,
  };
}

/** Bind exact painted-face metrics, never borrow those of another atlas. */
function inspectFaceTextureSpace(face: CubeFace): EffectiveTextureSpace {
  if (face.texture === null) {
    return { state: "no_texture", texture: null, metrics: null };
  }
  return inspectEffectiveTextureSpace(face.getTexture() || null);
}

const CUBE_FACE_KEYS = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;
type CubeFaceKey = (typeof CUBE_FACE_KEYS)[number];

export const UV_FACE_ASPECT_REVIEW_FACTOR = 1.25;
export const UV_CUBE_DENSITY_SPREAD_REVIEW_FACTOR = 2;
export const UV_MODEL_TEXEL_DENSITY_REVIEW_FACTOR = 2;
export const UV_MODEL_TEXEL_DENSITY_MATERIAL_AREA_FRACTION = 0.05;
export const UV_MODEL_TEXEL_DENSITY_EXAMPLE_LIMIT = 6;

export type FaceUvQuality =
  | {
      state: "degenerate";
      geometry_size: [number, number];
      uv_size: [number, number];
    }
  | {
      state: "measured";
      geometry_size: [number, number];
      uv_size: [number, number];
      geometry_aspect_ratio: number;
      uv_aspect_ratio: number;
      best_aspect_alignment: "direct" | "rotated_90";
      face_rotation: number;
      aspect_space: "logical_uv" | "physical_pixels";
      aspect_ratio_scale_error: number;
      aspect_state: "matched" | "review_required";
      logical_uv_units_per_model_unit_axes: { width: number; height: number };
      physical_pixels_per_model_unit_axes: { width: number; height: number } | null;
      logical_uv_area_per_model_area: number;
    };

function ratioScaleError(first: number, second: number): number {
  return Math.max(first / second, second / first);
}

/**
 * Measure the authored rotation, never the better of two hypothetical mappings.
 * Pixel-axis scale owns texel aspect when a texture is available. The historical
 * best_aspect_alignment key now reports that actual alignment for compatibility.
 * All verdicts remain construction review hints, not visual approval.
 */
export function summarizeFaceUvQuality(
  geometrySize: readonly [number, number],
  uv: readonly [number, number, number, number],
  faceRotation: number = 0,
  pixelsPerUvUnit?: readonly [number, number]
): FaceUvQuality {
  const width = Math.abs(geometrySize[0]);
  const height = Math.abs(geometrySize[1]);
  const uvWidth = Math.abs(uv[2] - uv[0]);
  const uvHeight = Math.abs(uv[3] - uv[1]);
  const geometry: [number, number] = [width, height];
  const uvSize: [number, number] = [uvWidth, uvHeight];
  const rotation = ((faceRotation % 360) + 360) % 360;

  if (
    ![width, height, uvWidth, uvHeight].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isInteger(rotation / 90) ||
    (pixelsPerUvUnit !== undefined && !pixelsPerUvUnit.every((value) => Number.isFinite(value) && value > 0))
  ) {
    return { state: "degenerate", geometry_size: geometry, uv_size: uvSize };
  }

  const rotated = rotation === 90 || rotation === 270;
  const logicalAxes = {
    width: (rotated ? uvHeight : uvWidth) / width,
    height: (rotated ? uvWidth : uvHeight) / height,
  };
  const physicalAxes = pixelsPerUvUnit === undefined ? null : {
    width: (rotated ? uvHeight * pixelsPerUvUnit[1] : uvWidth * pixelsPerUvUnit[0]) / width,
    height: (rotated ? uvWidth * pixelsPerUvUnit[0] : uvHeight * pixelsPerUvUnit[1]) / height,
  };
  const effectiveAxes = physicalAxes ?? logicalAxes;
  const geometryAspect = width / height;
  const uvAspect = uvWidth / uvHeight;
  const aspectError = ratioScaleError(effectiveAxes.width, effectiveAxes.height);
  const logicalArea = logicalAxes.width * logicalAxes.height;
  if (![geometryAspect, uvAspect, aspectError, logicalArea, ...Object.values(logicalAxes), ...Object.values(effectiveAxes)]
    .every((value) => Number.isFinite(value) && value > 0)) {
    return { state: "degenerate", geometry_size: geometry, uv_size: uvSize };
  }

  return {
    state: "measured",
    geometry_size: geometry,
    uv_size: uvSize,
    geometry_aspect_ratio: geometryAspect,
    uv_aspect_ratio: uvAspect,
    best_aspect_alignment: rotated ? "rotated_90" : "direct",
    face_rotation: rotation,
    aspect_space: physicalAxes === null ? "logical_uv" : "physical_pixels",
    aspect_ratio_scale_error: aspectError,
    aspect_state:
      aspectError > UV_FACE_ASPECT_REVIEW_FACTOR
        ? "review_required"
        : "matched",
    logical_uv_units_per_model_unit_axes: logicalAxes,
    physical_pixels_per_model_unit_axes: physicalAxes,
    logical_uv_area_per_model_area: logicalArea,
  };
}

function cubeFaceGeometrySize(
  size: readonly [number, number, number],
  face: CubeFaceKey
): [number, number] {
  const [x, y, z] = size.map(Math.abs) as [number, number, number];
  if (face === "north" || face === "south") return [x, y];
  if (face === "east" || face === "west") return [z, y];
  return [x, z];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeUvDensity(values: readonly number[]) {
  if (values.length === 0) {
    return {
      state: "unavailable" as const,
      measured_faces: 0,
      min: null,
      median: null,
      max: null,
      spread_factor: null,
    };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = min > 0 ? max / min : null;
  return {
    state:
      spread !== null && spread > UV_CUBE_DENSITY_SPREAD_REVIEW_FACTOR
        ? ("review_required" as const)
        : ("consistent" as const),
    measured_faces: values.length,
    min,
    median: median(values),
    max,
    spread_factor: spread,
  };
}

export type ProjectTexelDensitySample = {
  cube_uuid: string;
  cube_name: string;
  face: string;
  model_area: number;
  logical_uv_units_per_model_unit: number;
  physical_pixels_per_model_unit: number | null;
};

function weightedMedian(
  samples: readonly ProjectTexelDensitySample[],
  value: (sample: ProjectTexelDensitySample) => number
): number | null {
  const valid = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.model_area) &&
        sample.model_area > 0 &&
        Number.isFinite(value(sample)) &&
        value(sample) > 0
    )
    .sort((a, b) => value(a) - value(b));
  if (valid.length === 0) return null;

  const totalWeight = valid.reduce((sum, sample) => sum + sample.model_area, 0);
  let cumulative = 0;
  for (const sample of valid) {
    cumulative += sample.model_area;
    if (cumulative >= totalWeight / 2) return value(sample);
  }
  return value(valid[valid.length - 1]);
}

function densityRatio(value: number, reference: number): number {
  return Math.max(value / reference, reference / value);
}

function projectDensityExample(
  sample: ProjectTexelDensitySample,
  reference: number,
  basis: "logical_uv" | "physical_pixels"
) {
  const value = basis === "physical_pixels"
    ? sample.physical_pixels_per_model_unit!
    : sample.logical_uv_units_per_model_unit;
  return {
    cube_uuid: sample.cube_uuid,
    cube_name: sample.cube_name,
    face: sample.face,
    model_area: sample.model_area,
    logical_uv_units_per_model_unit:
      sample.logical_uv_units_per_model_unit,
    physical_pixels_per_model_unit: sample.physical_pixels_per_model_unit,
    model_units_per_physical_pixel:
      sample.physical_pixels_per_model_unit !== null &&
      sample.physical_pixels_per_model_unit > 0
        ? 1 / sample.physical_pixels_per_model_unit
        : null,
    relative_to_reference:
      value < reference
        ? ("lower_density" as const)
        : ("higher_density" as const),
    ratio_to_reference: densityRatio(value, reference),
    comparison_basis: basis,
  };
}

/**
 * Model-wide linear texel-density audit. Major mapped surface-area drift becomes
 * review_required, while tiny high-detail exceptions stay visible as
 * localized_variance. This is a UV construction diagnostic, not a visual score.
 */
export function summarizeProjectTexelDensity(
  samples: readonly ProjectTexelDensitySample[],
  exampleLimit: number = UV_MODEL_TEXEL_DENSITY_EXAMPLE_LIMIT
) {
  const valid = samples.filter(
    (sample) =>
      Number.isFinite(sample.model_area) &&
      sample.model_area > 0 &&
      Number.isFinite(sample.logical_uv_units_per_model_unit) &&
      sample.logical_uv_units_per_model_unit > 0
  );
  if (valid.length === 0) {
    return {
      state: "unavailable" as const,
      measured_faces: 0,
      measured_model_area: 0,
      reference_logical_uv_units_per_model_unit: null,
      reference_physical_pixels_per_model_unit: null,
      reference_model_units_per_physical_pixel: null,
      min_logical_uv_units_per_model_unit: null,
      max_logical_uv_units_per_model_unit: null,
      spread_factor: null,
      comparison_basis: "unavailable" as const,
      physical_density_complete: false,
      comparison_reference: null,
      comparison_spread_factor: null,
      outlier_faces: 0,
      outlier_model_area_fraction: null,
      examples: [],
      examples_truncated: false,
    };
  }

  const reference = weightedMedian(
    valid,
    (sample) => sample.logical_uv_units_per_model_unit
  );
  if (reference === null) {
    throw new Error("Project texel-density reference could not be derived.");
  }

  const physicalSamples = valid.filter(
    (sample) =>
      sample.physical_pixels_per_model_unit !== null &&
      Number.isFinite(sample.physical_pixels_per_model_unit) &&
      sample.physical_pixels_per_model_unit > 0
  );
  const physicalReference = weightedMedian(
    physicalSamples,
    (sample) => sample.physical_pixels_per_model_unit as number
  );

  // Real pixel density varies by atlas dimensions even with identical UV
  // coordinates. Only claim physical comparison when all sampled faces have
  // known bitmap metrics; otherwise retain explicitly logical evidence.
  const physicalComplete = physicalSamples.length === valid.length;
  const comparisonBasis = physicalComplete
    ? ("physical_pixels" as const)
    : ("logical_uv" as const);
  const comparisonReference = physicalComplete ? physicalReference! : reference;
  const comparedDensity = (sample: ProjectTexelDensitySample) =>
    physicalComplete
      ? sample.physical_pixels_per_model_unit!
      : sample.logical_uv_units_per_model_unit;

  const totalArea = valid.reduce((sum, sample) => sum + sample.model_area, 0);
  const outliers = valid
    .filter(
      (sample) =>
        densityRatio(comparedDensity(sample), comparisonReference) >=
        UV_MODEL_TEXEL_DENSITY_REVIEW_FACTOR
    )
    .sort(
      (a, b) =>
        densityRatio(comparedDensity(b), comparisonReference) -
          densityRatio(comparedDensity(a), comparisonReference) ||
        b.model_area - a.model_area
    );
  const outlierArea = outliers.reduce(
    (sum, sample) => sum + sample.model_area,
    0
  );
  const outlierAreaFraction = totalArea > 0 ? outlierArea / totalArea : 0;
  const min = Math.min(
    ...valid.map((sample) => sample.logical_uv_units_per_model_unit)
  );
  const max = Math.max(
    ...valid.map((sample) => sample.logical_uv_units_per_model_unit)
  );
  const state =
    outliers.length === 0
      ? ("consistent" as const)
      : outlierAreaFraction >=
          UV_MODEL_TEXEL_DENSITY_MATERIAL_AREA_FRACTION
        ? ("review_required" as const)
        : ("localized_variance" as const);
  const examples = outliers
    .slice(0, exampleLimit)
    .map((sample) =>
      projectDensityExample(sample, comparisonReference, comparisonBasis)
    );

  return {
    state,
    measured_faces: valid.length,
    measured_model_area: totalArea,
    reference_logical_uv_units_per_model_unit: reference,
    reference_physical_pixels_per_model_unit: physicalReference,
    reference_model_units_per_physical_pixel:
      physicalReference !== null && physicalReference > 0
        ? 1 / physicalReference
        : null,
    min_logical_uv_units_per_model_unit: min,
    max_logical_uv_units_per_model_unit: max,
    spread_factor: min > 0 ? max / min : null,
    comparison_basis: comparisonBasis,
    physical_density_complete: physicalComplete,
    comparison_reference: comparisonReference,
    comparison_spread_factor:
      Math.max(...valid.map(comparedDensity)) /
      Math.min(...valid.map(comparedDensity)),
    outlier_faces: outliers.length,
    outlier_model_area_fraction: outlierAreaFraction,
    examples,
    examples_truncated: outliers.length > examples.length,
  };
}

function cubeSize(cube: Cube): [number, number, number] {
  const from = requireFiniteInspectableVector3(cube.from, `Cube ${cube.name} (${cube.uuid}) from`);
  const to = requireFiniteInspectableVector3(cube.to, `Cube ${cube.name} (${cube.uuid}) to`);
  const size = [
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2],
  ] as [number, number, number];
  if (size.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `Cube ${cube.name} (${cube.uuid}) has a non-finite derived size; exact authored correction state cannot be reported safely.`
    );
  }
  return size;
}

function safeProjectCubeSize(cube: Cube): [number, number, number] | null {
  if (
    cube.from.length !== 3 ||
    cube.to.length !== 3 ||
    cube.from.some((value) => !Number.isFinite(value)) ||
    cube.to.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const size = [
    cube.to[0] - cube.from[0],
    cube.to[1] - cube.from[1],
    cube.to[2] - cube.from[2],
  ] as [number, number, number];
  return size.every(Number.isFinite) ? size : null;
}

function physicalPixelsPerUvAxes(
  textureSpace: EffectiveTextureSpace
): [number, number] | undefined {
  if (textureSpace.state !== "mapped") return undefined;
  const x = textureSpace.metrics.width / textureSpace.metrics.uvWidth;
  const y =
    textureSpace.metrics.displayHeight / textureSpace.metrics.uvHeight;
  if (![x, y].every((value) => Number.isFinite(value) && value > 0)) {
    return undefined;
  }
  return [x, y];
}

function inspectProjectTexelDensity() {
  const samples: ProjectTexelDensitySample[] = [];
  let excludedDegenerateFaces = 0;
  let excludedAspectReviewFaces = 0;
  let excludedInvalidFaces = 0;

  for (const cube of Cube.all ?? []) {
    if (cube.export === false) continue;
    const size = safeProjectCubeSize(cube);
    if (!size) {
      excludedInvalidFaces += CUBE_FACE_KEYS.length;
      continue;
    }

    for (const faceKey of CUBE_FACE_KEYS) {
      const face = cube.faces[faceKey];
      if (!face || face.enabled === false || face.texture === null) continue;
      const faceTextureSpace = inspectFaceTextureSpace(face);
      if (faceTextureSpace.state === "no_texture") continue;
      const physicalScale = physicalPixelsPerUvAxes(faceTextureSpace);
      const uv = [...face.uv];
      if (uv.length !== 4 || uv.some((value) => !Number.isFinite(value))) {
        excludedInvalidFaces += 1;
        continue;
      }
      // A valid UV rectangle must still lie inside the face's actual bitmap
      // before it can contribute evidence of painted texel density.
      if (faceTextureSpace.state === "mapped" && !mapFaceUvToTexturePixels(
        uv, faceTextureSpace.metrics,
        `Cube ${cube.name} (${cube.uuid}) face ${faceKey}`
      ).in_bounds) {
        excludedInvalidFaces += 1;
        continue;
      }
      const geometrySize = cubeFaceGeometrySize(size, faceKey);
      const quality = summarizeFaceUvQuality(
        geometrySize,
        uv as [number, number, number, number],
        face.rotation,
        physicalScale
      );
      if (quality.state === "degenerate") {
        excludedDegenerateFaces += 1;
        continue;
      }
      if (quality.aspect_state === "review_required") {
        excludedAspectReviewFaces += 1;
        continue;
      }

      const logicalLinear = Math.sqrt(
        quality.logical_uv_area_per_model_area
      );
      const modelArea =
        Math.abs(geometrySize[0]) * Math.abs(geometrySize[1]);
      const pixelAxes = quality.physical_pixels_per_model_unit_axes;
      samples.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        face: faceKey,
        model_area: modelArea,
        logical_uv_units_per_model_unit: logicalLinear,
        physical_pixels_per_model_unit:
          pixelAxes === null ? null : Math.sqrt(pixelAxes.width * pixelAxes.height),
      });
    }
  }

  return {
    ...summarizeProjectTexelDensity(samples),
    excluded_degenerate_faces: excludedDegenerateFaces,
    excluded_aspect_review_faces: excludedAspectReviewFaces,
    excluded_invalid_faces: excludedInvalidFaces,
    verdict: "review_hint_only" as const,
    note:
      "Physical pixels/model-unit are compared only when every included face has mapped texture metrics; otherwise comparison_basis identifies a logical-UV-only fallback. Untextured faces cannot prove painted detail. Findings remain review hints, never visual PASS.",
  };
}

function inspectCubeUv(cube: Cube) {
  const textureSpace = inspectEffectiveTextureSpace();
  const size = cubeSize(cube);
  const densityValues: number[] = [];
  let enabledFaceCount = 0;
  let degenerateFaceCount = 0;
  let aspectReviewFaceCount = 0;

  const faces = Object.fromEntries(
    CUBE_FACE_KEYS.map((faceKey) => {
      const face = cube.faces[faceKey];
      const enabled = face.enabled !== false;
      const faceTextureSpace = enabled
        ? inspectFaceTextureSpace(face)
        : null;
      const uv = requireFiniteInspectableFaceUv(
        face.uv,
        `Cube ${cube.name} (${cube.uuid}) face ${faceKey}`
      );
      const pixelMapping =
        faceTextureSpace?.state === "mapped"
          ? mapFaceUvToTexturePixels(
              uv,
              faceTextureSpace.metrics,
              `Cube ${cube.name} (${cube.uuid}) face ${faceKey}`
            )
          : null;
      const quality = faceTextureSpace !== null &&
        faceTextureSpace.state !== "no_texture"
        ? summarizeFaceUvQuality(
            cubeFaceGeometrySize(size, faceKey),
            uv,
            face.rotation,
            physicalPixelsPerUvAxes(faceTextureSpace)
          )
        : null;

      let physicalPixelAreaPerModelArea: number | null = null;
      let logicalUvUnitsPerModelUnit: number | null = null;
      let physicalPixelsPerModelUnit: number | null = null;
      let modelUnitsPerPhysicalPixel: number | null = null;

      if (enabled) enabledFaceCount += 1;
      if (quality?.state === "degenerate") {
        degenerateFaceCount += 1;
      } else if (quality?.state === "measured") {
        logicalUvUnitsPerModelUnit = Math.sqrt(
          quality.logical_uv_area_per_model_area
        );
        if (pixelMapping === null || pixelMapping.in_bounds) {
          densityValues.push(logicalUvUnitsPerModelUnit);
        }
        if (quality.aspect_state === "review_required") {
          aspectReviewFaceCount += 1;
        }
        if (quality.physical_pixels_per_model_unit_axes !== null) {
          const axes = quality.physical_pixels_per_model_unit_axes;
          physicalPixelAreaPerModelArea = axes.width * axes.height;
          physicalPixelsPerModelUnit = Math.sqrt(
            physicalPixelAreaPerModelArea
          );
          modelUnitsPerPhysicalPixel =
            physicalPixelsPerModelUnit > 0
              ? 1 / physicalPixelsPerModelUnit
              : null;
        }
      }

      return [
        faceKey,
        {
          uv,
          rotation: face.rotation,
          enabled,
          paintable: enabled && pixelMapping !== null && pixelMapping.in_bounds,
          mapping_state: enabled
            ? faceTextureSpace!.state
            : ("disabled_face" as const),
          texture_space: faceTextureSpace === null
            ? { state: "disabled_face" as const, effective_texture: null }
            : {
                state: faceTextureSpace.state,
                effective_texture: faceTextureSpace.texture,
              },
          texture_pixels: pixelMapping,
          quality:
            quality === null
              ? null
              : {
                  ...quality,
                  logical_uv_units_per_model_unit:
                    logicalUvUnitsPerModelUnit,
                  physical_pixel_area_per_model_area:
                    physicalPixelAreaPerModelArea,
                  physical_pixels_per_model_unit:
                    physicalPixelsPerModelUnit,
                  model_units_per_physical_pixel:
                    modelUnitsPerPhysicalPixel,
                },
        },
      ];
    })
  );

  return {
    mode: cube.box_uv ? ("box_uv" as const) : ("per_face" as const),
    box_uv: cube.box_uv === true,
    uv_offset: requireFiniteInspectableVector2(
      cube.uv_offset,
      `Cube ${cube.name} (${cube.uuid}) uv_offset`
    ),
    autouv: cube.autouv,
    mirror_uv: cube.mirror_uv === true,
    texture_space: {
      state: textureSpace.state,
      effective_texture: textureSpace.texture,
      scope: "default_texture" as const,
    },
    quality_summary: {
      enabled_faces: enabledFaceCount,
      degenerate_faces: degenerateFaceCount,
      aspect_review_faces: aspectReviewFaceCount,
      texel_density: summarizeUvDensity(densityValues),
      project_texel_density: inspectProjectTexelDensity(),
      verdict: "review_hint_only" as const,
      note:
        "Face mapping and physical density use the resolved face texture. Untextured or out-of-bounds UV faces are not paintable; their authored UV remains available for repair. Project density omits out-of-bounds mapped faces. The top-level texture_space names only the default atlas. Seam quality and visual acceptance remain unverified.",
    },
    faces,
  };
}

function inspectCube(cube: Cube, detail: "geometry" | "uv") {
  const size = cubeSize(cube);
  return {
    uuid: cube.uuid,
    name: cube.name,
    type: "cube" as const,
    authored_space: "blockbench_model" as const,
    parent: parentInfo(cube),
    from: requireFiniteInspectableVector3(cube.from, `Cube ${cube.name} (${cube.uuid}) from`),
    to: requireFiniteInspectableVector3(cube.to, `Cube ${cube.name} (${cube.uuid}) to`),
    size,
    center: [
      cube.from[0] + size[0] / 2,
      cube.from[1] + size[1] / 2,
      cube.from[2] + size[2] / 2,
    ] as [number, number, number],
    origin: requireFiniteInspectableVector3(cube.origin, `Cube ${cube.name} (${cube.uuid}) origin`),
    rotation: requireFiniteInspectableVector3(cube.rotation, `Cube ${cube.name} (${cube.uuid}) rotation`),
    inflate: requireFiniteInspectableScalar(
      cube.inflate ?? 0,
      `Cube ${cube.name} (${cube.uuid}) inflate`
    ),
    export: cube.export !== false,
    ...(detail === "uv" ? { uv: inspectCubeUv(cube) } : {}),
    visibility: cube.visibility !== false,
  };
}

function inspectGroup(group: Group) {
  return {
    uuid: group.uuid,
    name: group.name,
    type: "group" as const,
    authored_space: "blockbench_model" as const,
    parent: parentInfo(group),
    origin: requireFiniteInspectableVector3(group.origin, `Group ${group.name} (${group.uuid}) origin`),
    rotation: requireFiniteInspectableVector3(group.rotation, `Group ${group.name} (${group.uuid}) rotation`),
    export: group.export !== false,
    visibility: group.visibility !== false,
    children_count: group.children?.length ?? 0,
  };
}

function inspectLocator(locator: Locator) {
  return {
    uuid: locator.uuid,
    name: locator.name,
    type: "locator" as const,
    authored_space: "blockbench_model" as const,
    parent: parentInfo(locator),
    position: requireFiniteInspectableVector3(locator.position, `Locator ${locator.name} (${locator.uuid}) position`),
    rotation: requireFiniteInspectableVector3(locator.rotation, `Locator ${locator.name} (${locator.uuid}) rotation`),
    ignore_inherited_scale: locator.ignore_inherited_scale,
    export: locator.export !== false,
    visibility: locator.visibility !== false,
  };
}

function inspectNullObject(element: NullObject) {
  return {
    uuid: element.uuid,
    name: element.name,
    type: "null_object" as const,
    authored_space: "blockbench_model" as const,
    parent: parentInfo(element),
    position: requireFiniteInspectableVector3(element.position, `Null Object ${element.name} (${element.uuid}) position`),
    ik_target: element.ik_target || null,
    ik_source: element.ik_source || null,
    ik_pole: element.ik_pole || null,
    lock_ik_target_rotation: element.lock_ik_target_rotation,
    export: element.export !== false,
    visibility: element.visibility !== false,
  };
}

/**
 * Canonical inspection executor used by both inspect_element and the
 * existing inspect_elements(mode=detail) consolidated route. Opt-in Recipe
 * review is a read from the current native service, not a new tool/engine.
 * It never calls Recipe Apply, native Undo or an animation preview.
 */
export async function inspectElementSource(
  input: z.input<typeof inspectElementParameters>
) {
  const { id, detail = "geometry", recipe_optimization_review } =
    inspectElementParameters.parse(input);
  const element = resolveInspectableElement(id);
  let recipeReview: Awaited<
    ReturnType<
      ReturnType<typeof createBlockbenchAuthoringRecipeService>["inspectStoredGeometryCoincidence"]
    >
  > | null = null;
  let ownerIdentity: { recipe_id: string; instance_id: string } | null = null;
  if (recipe_optimization_review === true) {
    if (!(element instanceof Cube)) {
      throw new Error(
        "RECIPE_OPTIMIZATION_CUBE_REQUIRED: opt-in review requires an exact Recipe-owned Cube UUID."
      );
    }
    if (id !== element.uuid) {
      throw new Error(
        "RECIPE_OPTIMIZATION_UUID_REQUIRED: use the exact native Cube UUID, not a name."
      );
    }
    ownerIdentity = readAuthoringRecipeCubeOwnership(element);
    if (!ownerIdentity) {
      throw new Error(
        "RECIPE_OPTIMIZATION_OWNERSHIP_REQUIRED: selected Cube is not owned by a saved Recipe."
      );
    }
    const project = Project;
    const service = createBlockbenchAuthoringRecipeService();
    recipeReview = await service.inspectStoredGeometryCoincidence({
      recipe_id: ownerIdentity.recipe_id,
      selected_instance_id: ownerIdentity.instance_id,
    });
    // Bind the selected target to this same currently active project and
    // exact Cube identity; the report itself already checked Recipe/native
    // ownership, UV, material, animation and stored-Recipe source drift.
    const after = readAuthoringRecipeCubeOwnership(element);
    if (!Project || Project !== project ||
        recipeReview.surface_project_uuid !== project.uuid ||
        !(Cube.all ?? []).includes(element) ||
        element.uuid !== id || !after ||
        after.recipe_id !== ownerIdentity.recipe_id ||
        after.instance_id !== ownerIdentity.instance_id) {
      throw new Error(
        "RECIPE_OPTIMIZATION_SELECTED_CUBE_CHANGED_DURING_INSPECTION"
      );
    }
  }
  const result =
    element instanceof Cube
      ? inspectCube(element, detail)
      : element instanceof Group
        ? inspectGroup(element)
        : element instanceof Locator
          ? inspectLocator(element)
          : inspectNullObject(element);
  const detailSummary =
    element instanceof Cube && detail === "uv" ? " with UV mapping detail" : "";
  const reviewSummary = recipeReview === null ? ""
    : ` Recipe-owned source review: ${recipeReview.coincident_group_count} coincident group(s); no native review or deletion executed.`;
  return {
    content: [{
      type: "text" as const,
      text: `Inspected ${result.type} "${result.name}" (${result.uuid})${detailSummary}.${reviewSummary}`,
    }],
    structuredContent: recipeReview === null ? result : {
      ...result,
      recipe_optimization_review: {
        selected_cube_uuid: element.uuid,
        selected_recipe_id: ownerIdentity!.recipe_id,
        selected_instance_id: ownerIdentity!.instance_id,
        ...recipeReview,
      },
    },
  };
}

export function registerElementInspectionTools() {
  createTool(
    elementInspectionToolDocs[0].name,
    {
      ...elementInspectionToolDocs[0],
      async execute(args) {
        return inspectElementSource(args);
      },
    },
    elementInspectionToolDocs[0].status
  );
}
