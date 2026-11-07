/// <reference types="three" />
/// <reference types="blockbench-types" />
declare const THREE: typeof import("three");
import { z } from "zod";
import { createHash } from "node:crypto";
import { createTool, type ToolSpec } from "@/lib/factories";
import { captureScreenshot, captureAppScreenshot } from "@/lib/blockbench/capture";
import { captureNativeCubeSilhouette } from "@/lib/blockbench/silhouetteCapture";
import { extractVerifiedPngAlpha } from "@/lib/reference/pngAlphaEvidence";
import {
  composeNativeFourSideSheet,
  FOUR_SIDE_CAPTURE_ORDER,
  type FourSideCaptureImage,
  type FourSideCaptureView,
} from "@/lib/reference/fourSideSheet";
import { imageContent } from "@/lib/protocol/imageContent";
import { createNativeVisualIngestionProbe } from "@/lib/protocol/visualIngestionProbe";
import { assessVisualPartCorrespondence } from "@/lib/reference/partCorrespondence";
import { readRecipePartCaptureScope } from "@/server/runtime/recipes/authoring/service";
import {
  compareReferenceLandmarkProjection,
  type LandmarkProjectionObservation,
} from "@/lib/reference/landmarkEvidence";
import { readRenderedModelBounds, type RenderedModelBounds, type Vec3 } from "@/lib/geometry/renderedModelBounds";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { vector3Schema, projectionEnum } from "@/lib/schemas/common";
import {
  MODEL_VIEWS,
  VISUAL_EVIDENCE_TARGETS,
  type ModelView,
  type VisualEvidenceResolution,
  type VisualEvidenceRisk,
  type VisualEvidenceTarget,
} from "@/lib/reference/visualEvidence";
export type {
  ModelView,
  VisualEvidenceResolution,
  VisualEvidenceRisk,
  VisualEvidenceTarget,
} from "@/lib/reference/visualEvidence";

const CAPTURE_SIZE = 512;
const FRAME_PADDING = 0.12;
const PERSPECTIVE_FOV = 45;

const modelViewEnum = z.enum(MODEL_VIEWS);
const visualEvidenceTargetEnum = z.enum(VISUAL_EVIDENCE_TARGETS);

/**
 * Request-local, lossless PNG transport deduplication. Every native view is
 * still captured and accounted for; only byte-identical image items with the
 * same diagnostic role may share one content.image in the SAME response.
 * Never carry this ledger across calls, projects, revisions, or captures.
 * A hash proves byte identity, not visual quality or camera equivalence.
 */
export type CaptureImageDeliveryLedger = Map<string, {
  view: ModelView;
  base64: string;
}>;

export function recordCaptureImageDelivery(
  ledger: CaptureImageDeliveryLedger,
  role: "MODEL" | "SILHOUETTE",
  view: ModelView,
  base64: string
): { image_sha256: string; send_image: boolean; reused_from_view: ModelView | null } {
  const image_sha256 = createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex");
  const key = role + ":" + image_sha256;
  const previous = ledger.get(key);
  // Do not alias hash collisions, different diagnostic roles or merely similar pixels.
  if (previous?.base64 === base64) {
    return { image_sha256, send_image: false, reused_from_view: previous.view };
  }
  if (!previous) ledger.set(key, { view, base64 });
  return { image_sha256, send_image: true, reused_from_view: null };
}

/**
 * Current-capture dependency identity. This is a native observation guard,
 * not a persistent image cache, a visual score, or a reference attestation.
 * Capture only happens on demand; never hash bitmaps on an ordinary Cube edit.
 */
export type VisualCaptureDependencyInput = Readonly<{
  project_uuid: string;
  cubes: readonly unknown[];
  groups: readonly unknown[];
  textures: readonly unknown[];
  /** Canonical native TextureGroup inventory, if observable. */
  texture_groups?: readonly unknown[];
  pose: unknown;
  presentation: unknown;
  reference_binding: unknown;
}>;

export function fingerprintVisualCaptureDependencies(
  input: VisualCaptureDependencyInput
): string {
  if (!input.project_uuid || !Array.isArray(input.cubes) ||
      !Array.isArray(input.groups) || !Array.isArray(input.textures)) {
    throw new Error("VISUAL_CAPTURE_DEPENDENCY_INPUT_INVALID");
  }
  return createHash("sha256")
    .update(JSON.stringify(["mivubi-lazydesigner-capture-v1", input]))
    .digest("hex");
}

export type VisualNativeCaptureSnapshot = Readonly<{
  project_uuid: string;
  dependency_sha256: string;
  coverage: "TRACKED" | "PARTIAL";
  unresolved: readonly string[];
  texture_pixels_hashed: number;
}>;

export function assessVisualCaptureFreshness(
  before: VisualNativeCaptureSnapshot,
  after: VisualNativeCaptureSnapshot
): { state: "MATCHED" | "STALE" | "UNVERIFIED"; reason: string | null } {
  if (before.project_uuid !== after.project_uuid ||
      before.dependency_sha256 !== after.dependency_sha256) {
    return { state: "STALE", reason: "NATIVE_CAPTURE_DEPENDENCIES_CHANGED" };
  }
  if (before.coverage !== "TRACKED" || after.coverage !== "TRACKED" ||
      before.unresolved.length > 0 || after.unresolved.length > 0 ||
      JSON.stringify(before.unresolved) !== JSON.stringify(after.unresolved)) {
    return { state: "UNVERIFIED", reason: "NATIVE_CAPTURE_DEPENDENCY_COVERAGE_INCOMPLETE" };
  }
  return { state: "MATCHED", reason: null };
}

const CAPTURE_TEXTURE_PIXEL_BUDGET = 4_194_304;
const CAPTURE_FACE_KEYS = ["north", "south", "east", "west", "up", "down"] as const;

/**
 * Sample directly from the installed editor. Hash only visual dependencies,
 * not Outliner expanded/selected UI state. Missing read access never becomes
 * a fabricated clean snapshot. Bounded texture reads prevent huge atlas costs.
 */
/** Internal native capture reader, exported only for disposable fake-native regressions. */
export function readNativeVisualCaptureSnapshot(referenceBinding: unknown): VisualNativeCaptureSnapshot {
  if (!Project?.uuid || typeof Cube === "undefined" ||
      !Array.isArray(Cube.all)) {
    throw new Error("VISUAL_CAPTURE_NATIVE_PROJECT_UNAVAILABLE");
  }
  const unresolved = new Set<string>();
  const cubeRows = [...Cube.all].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const seenCubes = new Set<string>();
  const cubes = cubeRows.map(cube => {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim() ||
        seenCubes.has(cube.uuid)) {
      unresolved.add("CUBE_UUID_AMBIGUOUS");
    }
    seenCubes.add(cube.uuid);
    const faces = CAPTURE_FACE_KEYS.map(faceKey => {
      const face = cube.faces?.[faceKey];
      if (!face) {
        unresolved.add("CUBE_FACE_UNAVAILABLE");
        return [faceKey, null];
      }
      return [
        faceKey, face.enabled ?? null, face.texture ?? null,
        [...(face.uv ?? [])], face.rotation ?? null,
        face.material_name ?? null,
      ];
    });
    let worldMatrix: number[] | null = null;
    if (cube.mesh) {
      try {
        cube.mesh.updateWorldMatrix(true, false);
        const matrix = cube.mesh.matrixWorld?.elements;
        if (matrix && matrix.length === 16) {
          worldMatrix = Array.from(matrix);
          if (worldMatrix.some(n => !Number.isFinite(n))) {
            worldMatrix = null;
          }
        }
      } catch {
        // A failed native pose observation cannot certify an unchanged pose.
      }
    }
    if (cube.visibility !== false && !worldMatrix) {
      unresolved.add("CUBE_WORLD_POSE_UNAVAILABLE");
    }
    return [
      cube.uuid, cube.from, cube.to, cube.origin, cube.rotation,
      cube.inflate ?? null, cube.visibility !== false,
      cube.export !== false, cube.box_uv ?? null,
      cube.autouv ?? null, cube.mirror_uv ?? null,
      cube.uv_offset ?? null, cube.parent instanceof Group
        ? cube.parent.uuid : null, faces, worldMatrix,
    ];
  });
  const groups = (typeof Group !== "undefined" && Array.isArray(Group.all)
    ? [...Group.all].sort((a, b) => a.uuid.localeCompare(b.uuid))
        .map(g => [
          g.uuid, g.origin, g.rotation, g.visibility ?? null,
          g.parent instanceof Group ? g.parent.uuid : "root",
        ])
    : (unresolved.add("GROUP_INVENTORY_UNAVAILABLE"), []));
  const meshes = typeof Mesh !== "undefined" && Array.isArray(Mesh.all)
    ? Mesh.all.filter(mesh => mesh.visibility !== false).length
    : 0;
  if (meshes > 0) unresolved.add("NON_CUBE_GEOMETRY_NOT_TRACKED");
  let texturePixelsHashed = 0;
  const textureGroups: unknown[] = [];
  const groupIds = new Set<string>();
  if (typeof TextureGroup === "undefined" || !Array.isArray(TextureGroup.all)) {
    unresolved.add("TEXTURE_GROUP_INVENTORY_UNAVAILABLE");
  } else {
    for (const group of [...TextureGroup.all].sort((a, b) =>
      String(a.uuid).localeCompare(String(b.uuid)))) {
      if (typeof group.uuid !== "string" || !group.uuid ||
          groupIds.has(group.uuid)) {
        unresolved.add("TEXTURE_GROUP_UUID_AMBIGUOUS");
      }
      groupIds.add(group.uuid);
      textureGroups.push([group.uuid, group.name, group.is_material]);
    }
  }
  const textures: unknown[] = [];
  const textureIds = new Set<string>();
  if (typeof Texture === "undefined" || !Array.isArray(Texture.all)) {
    unresolved.add("TEXTURE_INVENTORY_UNAVAILABLE");
  } else {
    for (const texture of [...Texture.all].sort((a, b) =>
      String(a.uuid).localeCompare(String(b.uuid)))) {
      if (typeof texture.uuid !== "string" || !texture.uuid ||
          textureIds.has(texture.uuid)) {
        unresolved.add("TEXTURE_UUID_AMBIGUOUS");
      }
      textureIds.add(texture.uuid);
      if (texture.group && !groupIds.has(texture.group)) {
        unresolved.add("TEXTURE_GROUP_REFERENCE_UNRESOLVED");
      }
      // Source-strip hashes cannot prove the actual animation frame used for
      // each camera shot. A frame could advance and return to its initial
      // value between the before/after native snapshots.
      const frameCount = texture.frameCount;
      if (typeof frameCount === "number" && frameCount > 1) {
        unresolved.add("ANIMATED_TEXTURE_FRAME_PHASE_UNTRACKED");
      }
      const ctx = texture.ctx;
      const width = ctx?.canvas?.width;
      const height = ctx?.canvas?.height;
      let bitmapSha: string | null = null;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
          !width || !height) {
        unresolved.add("TEXTURE_PIXEL_CANVAS_UNAVAILABLE");
      } else if (width * height > CAPTURE_TEXTURE_PIXEL_BUDGET - texturePixelsHashed) {
        unresolved.add("TEXTURE_HASH_BUDGET_EXCEEDED");
      } else {
        try {
          const pixels = ctx.getImageData(0, 0, width, height).data;
          if (pixels.byteLength !== width * height * 4) {
            unresolved.add("TEXTURE_PIXEL_LENGTH_INVALID");
          } else {
            bitmapSha = createHash("sha256")
              .update(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))
              .digest("hex");
            texturePixelsHashed += width * height;
          }
        } catch {
          unresolved.add("TEXTURE_PIXEL_READ_UNAVAILABLE");
        }
      }
      textures.push([
        texture.uuid, texture.width, texture.height,
        texture.display_height ?? null, texture.uv_width ?? null,
        texture.uv_height ?? null, bitmapSha,
        // Appearance can change while every underlying RGBA sample stays
        // unchanged; bind native material and animation source properties.
        texture.name ?? null, texture.id ?? null,
        texture.visible ?? null, texture.render_mode ?? null,
        texture.render_sides ?? null, texture.wrap_mode ?? null,
        texture.group ?? null, texture.pbr_channel ?? null,
        texture.use_as_default ?? null,
        frameCount ?? null, texture.currentFrame ?? null,
        texture.frame_time ?? null, texture.frame_order_type ?? null,
        texture.frame_order ?? null, texture.frame_interpolate ?? null,
      ]);
    }
  }
  const animation = typeof AnimationItem !== "undefined"
    ? (AnimationItem as unknown as { selected?: { uuid?: string } }).selected
    : undefined;
  const timeline = (globalThis as unknown as { Timeline?: { time?: number } }).Timeline;
  const pose = {
    selected_animation_uuid: animation?.uuid ?? null,
    timeline_time: timeline?.time ?? null,
  };
  const shading = typeof settings === "undefined" ? null : settings.shading?.value;
  if (typeof shading !== "boolean") unresolved.add("SHADING_STATE_UNAVAILABLE");
  const presentation = {
    format: typeof Format === "undefined" ? null : Format.id,
    view_mode: Project.view_mode ?? null,
    shading,
    brightness: Settings.get("brightness"),
  };
  const dependency_sha256 = fingerprintVisualCaptureDependencies({
    project_uuid: Project.uuid,
    cubes, groups, textures, texture_groups: textureGroups, pose, presentation,
    reference_binding: referenceBinding,
  });
  return {
    project_uuid: Project.uuid,
    dependency_sha256,
    coverage: unresolved.size ? "PARTIAL" : "TRACKED",
    unresolved: [...unresolved].sort(),
    texture_pixels_hashed: texturePixelsHashed,
  };
}

/**
 * Image transport for one canonical capture invocation. Byte metrics are
 * not image tokens or Codex billing. No additional renderer calls.
 */
export type CaptureImageTrafficRow = Readonly<{
  kind: "MODEL" | "SILHOUETTE" | "FOUR_SIDE_SHEET";
  png_bytes: number;
  delivery: "DELIVERED" | "EXACT_REUSE" | "DIAGNOSTIC_NOT_SENT";
}>;

export function summarizeCaptureImageTraffic(rows: readonly CaptureImageTrafficRow[]) {
  if (rows.some(row =>
    !Number.isSafeInteger(row.png_bytes) || row.png_bytes < 0 ||
    !["MODEL", "SILHOUETTE", "FOUR_SIDE_SHEET"].includes(row.kind) ||
    !["DELIVERED", "EXACT_REUSE", "DIAGNOSTIC_NOT_SENT"].includes(row.delivery)
  )) throw new Error("CAPTURE_IMAGE_TRAFFIC_INVALID");
  const bytes = (filter: (row: CaptureImageTrafficRow) => boolean) =>
    rows.filter(filter).reduce((sum, row) => sum + row.png_bytes, 0);
  const count = (delivery: CaptureImageTrafficRow["delivery"]) =>
    rows.filter(row => row.delivery === delivery).length;
  return {
    generated_image_count: rows.length,
    generated_png_bytes: bytes(() => true),
    delivered_image_count: count("DELIVERED"),
    delivered_png_bytes: bytes(row => row.delivery === "DELIVERED"),
    reused_exact_image_count: count("EXACT_REUSE"),
    reused_exact_png_bytes: bytes(row => row.delivery === "EXACT_REUSE"),
    diagnostic_not_sent_image_count: count("DIAGNOSTIC_NOT_SENT"),
    diagnostic_not_sent_png_bytes: bytes(row => row.delivery === "DIAGNOSTIC_NOT_SENT"),
    model_image_count: rows.filter(row => row.kind === "MODEL").length,
    silhouette_image_count: rows.filter(row => row.kind === "SILHOUETTE").length,
    four_side_sheet_image_count: rows.filter(row => row.kind === "FOUR_SIDE_SHEET").length,
    api_token_usage: null as null,
  };
}

function encodedPngBytes(base64: string): number {
  return Math.floor(base64.length * 3 / 4) -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

type FrontDirection = "+z" | "-z";
type FramingInput =
  | { mode: "model" }
  | { mode: "explicit"; min: Vec3; max: Vec3 };

interface CameraSpec {
  view: ModelView;
  projection: "orthographic" | "perspective";
  position: Vec3;
  target: Vec3;
  up: Vec3;
  zoom?: number;
  fov?: number;
}

export type ApprovedReferenceBoardSlot =
  | "upper_left"
  | "upper_front"
  | "upper_back"
  | "lower_top"
  | "lower_front_left_3q";

type ReferenceComparisonEntry = {
  view: ModelView;
  reference_slot: ApprovedReferenceBoardSlot | null;
  primary_evidence: readonly string[];
};

export function modelViewReferenceContract(
  view: ModelView
): ReferenceComparisonEntry {
  switch (view) {
    case "front":
      return {
        view,
        reference_slot: "upper_front",
        primary_evidence: ["width", "height", "silhouette", "count"],
      };
    case "back":
      return {
        view,
        reference_slot: "upper_back",
        primary_evidence: ["width", "height", "rear_topology", "asymmetry"],
      };
    case "left":
      return {
        view,
        reference_slot: "upper_left",
        primary_evidence: ["length", "height", "depth", "attachment"],
      };
    case "top":
      return {
        view,
        reference_slot: "lower_top",
        primary_evidence: ["width", "length", "depth", "negative_space"],
      };
    case "front_left_3q":
      return {
        view,
        reference_slot: "lower_front_left_3q",
        primary_evidence: ["layering", "attachment", "orientation", "depth"],
      };
    case "right":
      return {
        view,
        reference_slot: null,
        primary_evidence: ["length", "height", "depth", "attachment"],
      };
    case "bottom":
      return {
        view,
        reference_slot: null,
        primary_evidence: ["width", "length", "underside", "negative_space"],
      };
    case "front_right_3q":
      return {
        view,
        reference_slot: null,
        primary_evidence: ["layering", "attachment", "orientation", "depth"],
      };
  }
}

const MODEL_VIEW_SELECTION_ORDER: readonly ModelView[] = [
  "front",
  "left",
  "top",
  "back",
  "front_left_3q",
  "right",
  "bottom",
  "front_right_3q",
];

function orthogonalExpansionView(view: ModelView): ModelView {
  switch (view) {
    case "front":
    case "back":
      return "left";
    case "left":
    case "right":
      return "front";
    case "top":
    case "bottom":
      return "front_left_3q";
    case "front_left_3q":
    case "front_right_3q":
      return "front";
  }
}

const DETAIL_384_TARGETS = new Set<VisualEvidenceTarget>([
  "depth",
  "negative_space",
  "orientation",
  "asymmetry",
]);

const DETAIL_512_TARGETS = new Set<VisualEvidenceTarget>([
  "attachment",
  "layering",
  "rear_topology",
  "underside",
]);

export function selectCaptureSizeForEvidence(
  targets: readonly VisualEvidenceTarget[],
  risk: VisualEvidenceRisk = "LOW"
): VisualEvidenceResolution {
  let size: VisualEvidenceResolution = 256;
  if (targets.some((target) => DETAIL_512_TARGETS.has(target))) size = 512;
  else if (targets.some((target) => DETAIL_384_TARGETS.has(target))) size = 384;

  if (risk === "HIGH") return 512;
  if (risk === "MEDIUM" && size < 384) return 384;
  return size;
}

export function selectModelViewsForEvidence(
  targets: readonly VisualEvidenceTarget[],
  risk: VisualEvidenceRisk = "LOW"
) {
  const requested = [...new Set(targets)];
  const uncovered = new Set<VisualEvidenceTarget>(requested);
  const selected: ModelView[] = [];
  const coverage: Array<{
    view: ModelView;
    targets: VisualEvidenceTarget[];
  }> = [];

  while (uncovered.size > 0 && selected.length < 5) {
    let best:
      | {
          view: ModelView;
          covers: VisualEvidenceTarget[];
          referencePaired: boolean;
        }
      | undefined;

    for (const view of MODEL_VIEW_SELECTION_ORDER) {
      if (selected.includes(view)) continue;
      const contract = modelViewReferenceContract(view);
      const covers = contract.primary_evidence.filter(
        (target): target is VisualEvidenceTarget =>
          uncovered.has(target as VisualEvidenceTarget)
      );
      if (covers.length === 0) continue;

      const candidate = {
        view,
        covers,
        referencePaired: contract.reference_slot !== null,
      };
      if (
        !best ||
        candidate.covers.length > best.covers.length ||
        (candidate.covers.length === best.covers.length &&
          candidate.referencePaired &&
          !best.referencePaired)
      ) {
        best = candidate;
      }
    }

    if (!best) break;
    selected.push(best.view);
    coverage.push({ view: best.view, targets: best.covers });
    best.covers.forEach((target) => uncovered.delete(target));
  }

  const minimumViews = [...selected];
  if (uncovered.size === 0 && risk === "MEDIUM" && selected.length > 0 && selected.length < 5) {
    const orthogonal = orthogonalExpansionView(selected[0]!);
    if (!selected.includes(orthogonal)) selected.push(orthogonal);
  }
  if (uncovered.size === 0 && risk === "HIGH") {
    for (const view of ["front", "left", "top"] as const) {
      if (selected.length >= 5) break;
      if (!selected.includes(view)) selected.push(view);
    }
  }

  return {
    requested_targets: requested,
    risk,
    minimum_views: minimumViews,
    views: selected,
    coverage,
    uncovered_targets: [...uncovered],
    expansion:
      selected.length === minimumViews.length
        ? []
        : selected.filter((view) => !minimumViews.includes(view)),
  };
}

/**
 * Automatic silhouette capture: only canonical views supporting the
 * silhouette claim receive the extra mask; orthogonal risk-expanded views
 * still supply their ordinary shaded PNGs. Explicit requested views retain
 * mask-per-view semantics. No visual verdict is produced.
 */
export function selectSilhouetteCaptureViews(
  selectedViews: readonly ModelView[],
  targets: readonly VisualEvidenceTarget[] | undefined,
  explicitViews: boolean
): ModelView[] {
  if (!targets?.includes("silhouette")) return [];
  if (explicitViews) return [...selectedViews];
  return selectedViews.filter(view =>
    modelViewReferenceContract(view).primary_evidence.includes("silhouette")
  );
}

/** Resolve camera selection without overriding explicit view intent. */
export function resolveCaptureViewSelection(
  views: readonly ModelView[] | undefined,
  targets: readonly VisualEvidenceTarget[] | undefined,
  risk: VisualEvidenceRisk = "LOW"
) {
  if (!views?.length) return selectModelViewsForEvidence(targets ?? [], risk);
  const requested = [...new Set(targets ?? [])];
  const covered = new Set<VisualEvidenceTarget>();
  const coverage = views.map((view) => {
    const targets = modelViewReferenceContract(view).primary_evidence.filter(
      (target): target is VisualEvidenceTarget =>
        requested.includes(target as VisualEvidenceTarget)
    );
    for (const target of targets) covered.add(target);
    return { view, targets };
  });
  return {
    requested_targets: requested,
    risk,
    minimum_views: [...views],
    views: [...views],
    coverage,
    uncovered_targets: requested.filter((target) => !covered.has(target)),
    expansion: [] as ModelView[],
  };
}

export function buildModelViewReferenceComparison(
  views: readonly ModelView[]
) {
  return {
    board_layout: "UPPER:LEFT|FRONT|BACK;LOWER:TOP|FRONT_LEFT_3Q",
    views: views.map(modelViewReferenceContract),
    difference_first: true,
    visual_verdict: "not_evaluated" as const,
  };
}

export const captureScreenshotParameters = z.object({});

export const captureAppScreenshotParameters = z.object({});

export const setCameraAngleParameters = z.object({
  position: vector3Schema.describe("Camera position."),
  target: vector3Schema.optional().describe("Camera target position."),
  rotation: vector3Schema.optional().describe("Camera rotation."),
  projection: projectionEnum.describe("Camera projection type."),
  zoom: z.number().positive().optional().describe("Orthographic camera zoom."),
});

const finiteFramingCoordinateSchema = z.number().finite();

const explicitFramingSchema = z
  .object({
    mode: z.literal("explicit"),
    min: z.tuple([
      finiteFramingCoordinateSchema,
      finiteFramingCoordinateSchema,
      finiteFramingCoordinateSchema,
    ]),
    max: z.tuple([
      finiteFramingCoordinateSchema,
      finiteFramingCoordinateSchema,
      finiteFramingCoordinateSchema,
    ]),
  })
  .refine(
    (value) =>
      value.max.every((entry, axis) => {
        const span = entry - value.min[axis];
        return span > 0 && Number.isFinite(span);
      }),
    {
      message:
        "Each explicit max axis must be greater than min and produce a finite span.",
      path: ["max"],
    }
  );

const landmarkPairSchema = z.object({
  reference_image_id: z.string().trim().min(1).max(160),
  reference_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  landmark_id: z.string().trim().min(1).max(96),
  reference_uv: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]),
  view: modelViewEnum,
  model_cube_uuid: z.string().trim().min(1).max(160),
}).strict();

const correspondenceRegionSchema = z.object({
  id: z.string().trim().min(1).max(96),
  part_id: z.string().trim().min(1).max(96),
  evidence_role: z.enum(["PRIMARY_VOLUME", "SURFACE_DETAIL", "CONTACT", "NEGATIVE_SPACE"]),
  visibility: z.enum(["DIRECT", "PARTIAL", "OCCLUDED"]),
  box_uv: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  related_part_id: z.string().trim().min(1).max(96).nullable(),
}).strict();

/**
 * Opt-in consumer for an already delivered Control status reference.
 * All source fields are caller-declared; Runtime cannot read the Gateway's
 * Reference Package or attest that the source pixels were actually viewed.
 * No review outcome is accepted in capture parameters.
 */
const referenceCorrespondenceSchema = z.object({
  recipe_id: z.string().trim().min(1).max(128),
  reference: z.object({
    package_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    current_package_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    images: z.array(z.object({
      id: z.string().trim().min(1).max(160),
      sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
      integrity: z.enum(["VERIFIED", "MISSING", "INVALID"]),
      status: z.string().nullable(),
      view: modelViewEnum.nullable(),
      regions: z.array(correspondenceRegionSchema).max(16),
    }).strict()).min(1).max(4),
    parts: z.array(z.object({
      id: z.string().trim().min(1).max(96),
      role: z.string().nullable(),
    }).strict()).max(24),
  }).strict(),
  proposals: z.array(z.object({
    image_id: z.string().trim().min(1).max(160),
    region_id: z.string().trim().min(1).max(96),
    part_id: z.string().trim().min(1).max(96),
    native_cube_uuids: z.array(z.string().trim().min(1).max(160)).max(64),
  }).strict()).min(1).max(16),
}).strict();

const uniqueModelViewsSchema = z
  .array(modelViewEnum)
  .min(1)
  .max(5)
  .refine((views) => new Set(views).size === views.length, {
    message: "views must contain unique canonical view names.",
  });

export const captureModelViewsParameters = z
  .object({
  size: z.number().int().min(32).max(1024).optional().describe("PNG square size. Omitted: 256/384/512 by evidence_targets detail/risk, else 512. 32-64: icons only."),
  highlight_missing_textures: z.boolean().default(false).describe("Temporarily brighten missing-texture materials, then restore. Diagnostic only: no shaded comparison/UI flash."),
  ai_ingestion_probe: z.boolean().default(false).describe("Opt-in one-shot AI pixel-perception challenge, one extra diagnostic PNG. Never normal QA or auto-run."),
  reference_correspondence: referenceCorrespondenceSchema.optional().describe(
    "Opt-in region→saved recipe Cube UUID candidates. Use current status image metadata. Verify recipe/native identity; PROVISIONAL capture provenance, never visual PASS or mutation."
  ),
  landmark_pairs: z.array(landmarkPairSchema).min(1).max(16).optional().describe(
    "Read-only projected Cube-center→image ID/SHA-256 pairs. Explicit views required; no calibration/visual verdict."
  ),
  views: uniqueModelViewsSchema.optional().describe(
    "Canonical views; omit for minimum evidence_targets coverage."
  ),
  evidence_targets: z
    .array(visualEvidenceTargetEnum)
    .min(1)
    .max(13)
    .optional()
    .describe(
      "Unanswered visual claims. Omitted views deterministically cover these targets."
    ),
  verification_risk: z
    .enum(["LOW", "MEDIUM", "HIGH"])
    .default("LOW")
    .describe(
      "LOW=minimal; MEDIUM=+1 orthogonal; HIGH=front/left/top if possible."
    ),
  front_direction: z
    .enum(["+z", "-z"])
    .describe(
      "Explicit object front, no default: prevents mirrored comparison."
    ),
  framing: z
    .union([
      z.object({ mode: z.literal("model") }),
      explicitFramingSchema,
    ])
    .optional()
    .default({ mode: "model" }),
})
  .superRefine((value, ctx) => {
    if (!value.views?.length && !value.evidence_targets?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide explicit views or evidence_targets.",
        path: ["views"],
      });
    }
    if (value.landmark_pairs?.length) {
      if (!value.views?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Landmark projections require explicitly matched canonical views.",
          path: ["views"],
        });
      }
      const keys = new Set<string>();
      const sources = new Map<string, { sha: string; view: ModelView }>();
      for (const [index, row] of value.landmark_pairs.entries()) {
        if (value.views?.length && !value.views.includes(row.view)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "The landmark view must be included in explicit capture views.",
            path: ["landmark_pairs", index, "view"],
          });
        }
        const key = JSON.stringify([row.reference_image_id, row.landmark_id, row.view]);
        if (keys.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate source-image landmark identity.",
            path: ["landmark_pairs", index],
          });
        }
        keys.add(key);
        const prior = sources.get(row.reference_image_id);
        if (prior && (prior.sha !== row.reference_sha256 || prior.view !== row.view)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Source image ID cannot map to different byte hashes or views.",
            path: ["landmark_pairs", index, "reference_image_id"],
          });
        }
        sources.set(row.reference_image_id, { sha: row.reference_sha256, view: row.view });
      }
    }
  });

export const cameraToolDocs: ToolSpec[] = [
  {
    name: "capture_screenshot",
    description:
      "Returns the image data of the current editor view. This is a branch-only observation helper when that specific editor view carries evidence that canonical views cannot answer. For normal reference-driven geometry review, prefer `capture_model_views` so framing/orientation are deterministic.",
    annotations: {
      title: "Capture Screenshot",
      readOnlyHint: true,
    },
    parameters: captureScreenshotParameters,
    status: STATUS_STABLE,
  },
  {
    name: "capture_app_screenshot",
    description:
      "Source-preserved generic Blockbench full-application screenshot helper. It is disabled in the normal LazyDesigner Bedrock Entity surface; use `capture_model_views` or `capture_screenshot` for model evidence.",
    annotations: {
      title: "Capture App Screenshot",
      readOnlyHint: true,
    },
    parameters: captureAppScreenshotParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "set_camera_angle",
    description:
      "Source-preserved generic editor-camera mutation helper. It is disabled in the normal LazyDesigner Bedrock Entity surface because `capture_model_views` provides deterministic observation without mutating the active editor camera.",
    annotations: {
      title: "Set Camera Angle",
      destructiveHint: true,
    },
    parameters: setCameraAngleParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "capture_model_views",
    description:
      "Captures deterministic labeled square PNG views without changing the active editor camera. Provide explicit views, or evidence_targets plus optional verification_risk. Optional landmark_pairs project rendered Cube centers; optional reference_correspondence attaches current saved recipe-owned Cube identity and provisional source-region associations to the same fresh capture. Both are read-only diagnostics, never solved camera calibration, automatic geometric correction, or visual PASS.",
    annotations: {
      title: "Capture Model Views",
      readOnlyHint: true,
    },
    parameters: captureModelViewsParameters,
    status: STATUS_STABLE,
  },
];

function resizePreview(preview: Preview, width: number, height: number): void {
  const runtimePreview = preview as Preview & {
    resize: (width: number, height: number) => Preview;
  };
  runtimePreview.resize(width, height);
}

function boundsFromExplicit(
  framing: Extract<FramingInput, { mode: "explicit" }>
): RenderedModelBounds {
  const { min, max } = framing;
  const size: Vec3 = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const center: Vec3 = [
    min[0] + size[0] / 2,
    min[1] + size[1] / 2,
    min[2] + size[2] / 2,
  ];

  return {
    min: [...min],
    max: [...max],
    center,
    size_xyz: size,
    dimensions: { width: size[0], height: size[1], length: size[2] },
    footprint: {
      min_xz: [min[0], min[2]],
      max_xz: [max[0], max[2]],
      size: { width: size[0], length: size[2] },
    },
  };
}

function scale(value: Vec3, scalar: number): Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1e-8) {
    throw new Error("Cannot derive a canonical camera direction from a zero vector.");
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function objectAxes(frontDirection: FrontDirection): {
  front: Vec3;
  right: Vec3;
} {
  const sign = frontDirection === "+z" ? 1 : -1;
  return { front: [0, 0, sign], right: [sign, 0, 0] };
}

function principalDirection(
  view: Exclude<ModelView, "front_left_3q" | "front_right_3q">,
  frontDirection: FrontDirection
): { direction: Vec3; up: Vec3 } {
  const { front, right } = objectAxes(frontDirection);
  switch (view) {
    case "front":
      return { direction: front, up: [0, 1, 0] };
    case "back":
      return { direction: scale(front, -1), up: [0, 1, 0] };
    case "left":
      return { direction: scale(right, -1), up: [0, 1, 0] };
    case "right":
      return { direction: right, up: [0, 1, 0] };
    case "top":
      return { direction: [0, 1, 0], up: scale(front, -1) };
    case "bottom":
      return { direction: [0, -1, 0], up: front };
  }
}

function principalSpans(
  view: ModelView,
  bounds: RenderedModelBounds
): [number, number] {
  const [width, height, length] = bounds.size_xyz;
  switch (view) {
    case "front":
    case "back":
      return [width, height];
    case "left":
    case "right":
      return [length, height];
    case "top":
    case "bottom":
      return [width, length];
    default:
      throw new Error(`${view} is not an orthographic principal view.`);
  }
}

function orthographicZoom(
  preview: Preview,
  horizontalSpan: number,
  verticalSpan: number
): number {
  const paddedWidth = Math.max(horizontalSpan * (1 + FRAME_PADDING * 2), 1e-4);
  const paddedHeight = Math.max(verticalSpan * (1 + FRAME_PADDING * 2), 1e-4);

  // Official Preview.resize() uses left/right = ±width/80 and
  // top/bottom = ±height/80, so the zoom=1 world span is width/40 × height/40.
  const zoom = Math.min(
    preview.width / 40 / paddedWidth,
    preview.height / 40 / paddedHeight
  );
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error("Unable to calculate canonical orthographic framing.");
  }
  return zoom;
}

function cameraSpec(
  preview: Preview,
  view: ModelView,
  frontDirection: FrontDirection,
  bounds: RenderedModelBounds
): CameraSpec {
  const target = bounds.center;
  const maxSpan = Math.max(...bounds.size_xyz, 1);

  if (view !== "front_left_3q" && view !== "front_right_3q") {
    const { direction, up } = principalDirection(view, frontDirection);
    const distance = Math.max(64, maxSpan * 4 + 32);
    const [horizontalSpan, verticalSpan] = principalSpans(view, bounds);
    return {
      view,
      projection: "orthographic",
      position: add(target, scale(direction, distance)),
      target: [...target],
      up,
      zoom: orthographicZoom(preview, horizontalSpan, verticalSpan),
    };
  }

  const { front, right } = objectAxes(frontDirection);
  const side = view === "front_left_3q" ? scale(right, -1) : right;
  const horizontal = normalize(add(front, side));
  const elevation = (30 * Math.PI) / 180;
  const direction = normalize([
    horizontal[0] * Math.cos(elevation),
    Math.sin(elevation),
    horizontal[2] * Math.cos(elevation),
  ]);
  const radius = 0.5 * Math.hypot(...bounds.size_xyz) * (1 + FRAME_PADDING * 2);
  const distance = Math.max(
    16,
    radius / Math.sin((PERSPECTIVE_FOV * Math.PI) / 360)
  );

  return {
    view,
    projection: "perspective",
    position: add(target, scale(direction, distance)),
    target: [...target],
    up: [0, 1, 0],
    fov: PERSPECTIVE_FOV,
  };
}

/** Camera settings applied for capture; not independent native pose attestation. */
export function captureCameraSpecMetadata(spec: CameraSpec) {
  return {
    projection: spec.projection,
    position: [...spec.position],
    target: [...spec.target],
    up: [...spec.up],
    zoom: spec.zoom ?? null,
    fov: spec.fov ?? null,
  };
}

export function prepareOffscreenPreview(preview: Preview, size = CAPTURE_SIZE): void {
  resizePreview(preview, size, size);

  // Preview.resize() updates the active projection only. Normalize both bases so
  // switching between principal and 3/4 views stays deterministic.
  preview.camPers.aspect = 1;
  preview.camPers.updateProjectionMatrix();
  preview.camOrtho.left = -size / 80;
  preview.camOrtho.right = size / 80;
  preview.camOrtho.top = size / 80;
  preview.camOrtho.bottom = -size / 80;
  preview.camOrtho.updateProjectionMatrix();
}

function applyCamera(preview: Preview, spec: CameraSpec): void {
  preview.setProjectionMode(spec.projection === "orthographic");
  const camera = preview.camera;
  camera.position.fromArray(spec.position);
  camera.up.fromArray(spec.up);
  preview.controls.target.fromArray(spec.target);
  camera.lookAt(preview.controls.target);

  const distance = Math.hypot(
    spec.position[0] - spec.target[0],
    spec.position[1] - spec.target[1],
    spec.position[2] - spec.target[2]
  );

  if (spec.projection === "orthographic") {
    preview.camOrtho.zoom = spec.zoom ?? 1;
    preview.camOrtho.near = -Math.max(200, distance * 2);
    preview.camOrtho.far = Math.max(20_000, distance * 4);
    preview.camOrtho.updateProjectionMatrix();
  } else {
    preview.camPers.fov = spec.fov ?? PERSPECTIVE_FOV;
    preview.camPers.aspect = 1;
    preview.camPers.near = Math.max(0.01, distance / 10_000);
    preview.camPers.far = Math.max(20_000, distance * 4);
    preview.camPers.updateProjectionMatrix();
  }

  preview.controls.update();
}

export function withShadedCapture<T>(capture: () => T): T {
  const shading = typeof settings === "undefined" ? undefined : settings.shading;
  if (typeof shading?.value !== "boolean") {
    throw new Error("Blockbench shading state is unavailable; comparison capture requires Shading ON.");
  }
  const previous = shading.value;
  try {
    shading.value = true;
    Canvas.updateShading();
    return capture();
  } finally {
    shading.value = previous;
    Canvas.updateShading();
  }
}

export function withMissingTextureHighlight<T>(enabled: boolean, capture: () => T): T {
  if (!enabled) return capture();
  const materials = (Canvas as unknown as {emptyMaterials?: Array<{uniforms?: {BRIGHTNESS?: {value:number}}}>}).emptyMaterials;
  if (!Array.isArray(materials)) throw new Error("Native missing-texture materials are unavailable.");
  const uniforms = [...new Set(materials.map(material => material.uniforms?.BRIGHTNESS).filter((uniform): uniform is {value:number} => !!uniform))];
  if (uniforms.some(uniform => !Number.isFinite(uniform.value))) throw new Error("Missing-texture brightness is invalid.");
  const previous = uniforms.map(uniform => uniform.value);
  try {
    uniforms.forEach(uniform => uniform.value=2.5);
    return capture();
  } finally {uniforms.forEach((uniform,index)=>uniform.value=previous[index]);}
}

/**
 * Use Blockbench's actual rendered Cube vertices rather than invented local
 * corners; the mean is transform-safe across Cube rotation and parent groups.
 * Only visible, unambiguously identified Cube UUIDs can enter this read.
 */
function renderedCubeCenter(uuid: string): Vec3 {
  const cube = Cube.all.find((item) => item.uuid === uuid);
  if (!cube || !cube.mesh || cube.visibility === false) {
    throw new Error("REFERENCE_LANDMARK_CUBE_UNAVAILABLE: " + uuid);
  }
  let node: THREE.Object3D | null = cube.mesh;
  while (node) {
    if (!node.visible) throw new Error("REFERENCE_LANDMARK_CUBE_HIDDEN: " + uuid);
    node = node.parent;
  }
  cube.mesh.updateWorldMatrix(true, false);
  const vertices = cube.getGlobalVertexPositions();
  if (!Array.isArray(vertices) || vertices.length !== 8 ||
      vertices.some((v) => v.length !== 3 || v.some((n) => !Number.isFinite(n)))) {
    throw new Error("REFERENCE_LANDMARK_CUBE_GEOMETRY_INVALID: " + uuid);
  }
  return [0, 1, 2].map(
    (axis) => vertices.reduce((sum, v) => sum + v[axis]!, 0) / vertices.length
  ) as Vec3;
}

function captureLandmarkProjections(
  preview: Preview,
  view: ModelView,
  pairs: readonly z.infer<typeof landmarkPairSchema>[]
): LandmarkProjectionObservation[] {
  if (pairs.length === 0) return [];
  const camera = preview.camera;
  camera.updateMatrixWorld(true);
  return pairs.filter((row) => row.view === view).map((row) => {
    const point = renderedCubeCenter(row.model_cube_uuid);
    const projected = new THREE.Vector3(...point).project(camera);
    return compareReferenceLandmarkProjection({
      ...row,
      model_anchor: "CUBE_CENTER",
      model_world_point: point,
      projected_uv: [(projected.x + 1) / 2, (1 - projected.y) / 2],
      ndc_depth: projected.z,
    });
  });
}

function captureOffscreenPng(preview: Preview, highlightMissing = false): string {
  let dataUrl: string | undefined;
  withShadedCapture(() => withMissingTextureHighlight(highlightMissing, () => Canvas.withoutGizmos(() => {
    preview.render();
    dataUrl = preview.canvas.toDataURL("image/png");
  })));
  if (!dataUrl) {
    throw new Error("Blockbench returned no image data for canonical model view capture.");
  }
  return dataUrl;
}

export function registerCameraTools() {
  createTool(cameraToolDocs[0].name, {
    ...cameraToolDocs[0],
    async execute() {
      return captureScreenshot();
    },
  }, cameraToolDocs[0].status, false);

  createTool(cameraToolDocs[1].name, {
    ...cameraToolDocs[1],
    async execute() {
      return captureAppScreenshot();
    },
  }, cameraToolDocs[1].status, false);

  createTool(cameraToolDocs[2].name, {
    ...cameraToolDocs[2],
    async execute(angle: { position: number[]; target?: number[]; rotation?: number[]; projection: string; zoom?: number }) {
      const preview = Preview.selected;
      if (!preview) throw new Error("No preview found in the Blockbench editor.");

      // @ts-expect-error Blockbench accepts an AnglePreset-like object here.
      preview.loadAnglePreset({ ...angle });
      if (angle.zoom !== undefined && preview.isOrtho) {
        preview.camOrtho.zoom = angle.zoom;
        preview.camOrtho.updateProjectionMatrix();
        preview.controls.update();
      }
      return captureScreenshot();
    },
  }, cameraToolDocs[2].status, false);

  createTool(cameraToolDocs[3].name, {
    ...cameraToolDocs[3],
    async execute({ views, evidence_targets, verification_risk, front_direction, framing, highlight_missing_textures, landmark_pairs, reference_correspondence, size, ai_ingestion_probe }) {
      // Measure the whole capture invocation, including both native dependency
      // snapshots, rather than excluding the potentially expensive first read.
      const captureStartedAtMs = Date.now();
      if (!Project) {
        throw new Error(
          "No project is open. Open or create the intended Bedrock project before capturing model views."
        );
      }
      if (!Preview.selected) {
        throw new Error("No active Blockbench preview is available.");
      }

      // Capture framing needs exact rendered extents, not a second expensive
      // pairwise surface-quality diagnostic for every view/animation pose.
      // The existing inspect_model_bounds owner still performs that review.
      const observed = readRenderedModelBounds({ includeSurfaceWarnings: false });
      const selection = resolveCaptureViewSelection(
        views as ModelView[] | undefined,
        evidence_targets as VisualEvidenceTarget[] | undefined,
        verification_risk as VisualEvidenceRisk
      );
      if (selection.views.length === 0 ||
          (!views?.length && selection.uncovered_targets.length > 0)) {
        throw new Error(
          `Unable to select canonical model views for evidence targets: ${selection.uncovered_targets.join(", ") || "none selected"}.`
        );
      }
      const selectedViews = selection.views;
      // Request-specific, never triggered by arbitrary info-gain camera selection.
      const explicitFourSideCapture = Boolean(
        views?.length === FOUR_SIDE_CAPTURE_ORDER.length &&
        FOUR_SIDE_CAPTURE_ORDER.every(view => views.includes(view))
      );
      const silhouetteCaptureViews = selectSilhouetteCaptureViews(
        selectedViews, evidence_targets as VisualEvidenceTarget[] | undefined,
        Boolean(views?.length)
      );
      // Validate actual native recipe ownership before doing expensive captures.
      const requestedCorrespondenceUuids = reference_correspondence
        ? [...new Set<string>(reference_correspondence.proposals.flatMap(
            (claim: z.infer<typeof referenceCorrespondenceSchema>["proposals"][number]) => claim.native_cube_uuids
          ))]
        : [];
      const correspondenceBefore = reference_correspondence
        ? readRecipePartCaptureScope(
            reference_correspondence.recipe_id, requestedCorrespondenceUuids
          )
        : null;
      const captureProjectUuid = Project.uuid;
      const captureSize =
        size ??
        (evidence_targets?.length
          ? selectCaptureSizeForEvidence(
              evidence_targets as VisualEvidenceTarget[],
              verification_risk as VisualEvidenceRisk
            )
          : CAPTURE_SIZE);
      const framingInput = framing as FramingInput;
      if (framingInput.mode === "model") {
        if (!observed.bounds || observed.rendered_cube_count === 0) {
          throw new Error("Model framing requires visible Cube geometry to capture.");
        }
      } else if (observed.rendered_cube_count === 0) {
        throw new Error("Explicit framing requires visible Cube geometry to capture.");
      }

      const framingBounds =
        framingInput.mode === "explicit"
          ? boundsFromExplicit(framingInput)
          : observed.bounds!;

      const capturePreview = Screencam.NoAAPreview;
      if (!capturePreview || capturePreview === Preview.selected) {
        throw new Error(
          "Blockbench offscreen screenshot preview is unavailable; canonical capture refuses to mutate the active editor camera."
        );
      }
      prepareOffscreenPreview(capturePreview, captureSize);
      // Runtime cannot attest the Gateway's approved Reference Package.
      // These are caller-declared identities for capture consistency only.
      const referenceBinding = reference_correspondence
        ? {
            package_fingerprint: reference_correspondence.reference.package_fingerprint,
            current_package_fingerprint: reference_correspondence.reference.current_package_fingerprint,
          }
        : (landmark_pairs ?? []).map(pair => [
            pair.reference_image_id, pair.reference_sha256, pair.view,
          ]);
      const dependencyBefore = readNativeVisualCaptureSnapshot(referenceBinding);

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];
      const imageDigests: Array<{view: ModelView; sha256: string}> = [];
      const imageLedger: CaptureImageDeliveryLedger = new Map();
      const imageTraffic: CaptureImageTrafficRow[] = [];
      const captures: Array<{
        view: ModelView;
        projection: "orthographic" | "perspective";
        image_sha256: string;
        image_delivery: "content.image" | "same_response_exact_png";
        reused_from_view: ModelView | null;
        capture_contract_sha256: string;
        width: number;
        height: number;
        png_bytes: number;
        camera_spec: ReturnType<typeof captureCameraSpecMetadata>;
        landmark_projections?: LandmarkProjectionObservation[];
        silhouette_evidence?: {
          state: "AVAILABLE" | "UNVERIFIED";
          reason: string | null;
          scope: "VISIBLE_CUBES_SOLID_GEOMETRY";
          image_sha256: string | null;
          foreground_pixels: number | null;
          native_cube_count: number | null;
          visual_verdict: "NOT_EVALUATED";
          source_camera_calibrated: false;
          texture_alpha_evaluated: false;
          automatic_correction: false;
        };
      }> = [];

      const nativeFourSidePngs: FourSideCaptureImage[] = [];
      for (const view of selectedViews) {
        const spec = cameraSpec(
          capturePreview,
          view,
          front_direction as FrontDirection,
          framingBounds
        );
        applyCamera(capturePreview, spec);
        const landmarkProjections = captureLandmarkProjections(
          capturePreview, view, landmark_pairs ?? []
        );
        const image = imageContent(captureOffscreenPng(capturePreview, highlight_missing_textures), "image/png")
          .content[0];

        const modelImageDelivery = recordCaptureImageDelivery(
          imageLedger, "MODEL", view, image.data
        );
        const modelPngBytes = encodedPngBytes(image.data);
        if (explicitFourSideCapture && FOUR_SIDE_CAPTURE_ORDER.some(side => side === view)) {
          nativeFourSidePngs.push({
            view: view as FourSideCaptureView,
            projection: spec.projection,
            image_sha256: modelImageDelivery.image_sha256,
            png_bytes: Buffer.from(image.data, "base64"),
          });
        }
        imageTraffic.push({
          kind: "MODEL", png_bytes: modelPngBytes,
          delivery: modelImageDelivery.send_image ? "DELIVERED" : "EXACT_REUSE",
        });
        content.push({
          type: "text",
          text: modelImageDelivery.reused_from_view
            ? `VIEW ${view}: PNG is byte-identical to MODEL VIEW ${modelImageDelivery.reused_from_view} in this response (SHA-256 ${modelImageDelivery.image_sha256}). Its own camera/view identity remains distinct; no quality verdict is implied.`
            : `VIEW ${view}`,
        });
        if (modelImageDelivery.send_image) {
          content.push(image);
        }
        // Opt-in only: a second transparent capture is useful for silhouette
        // review, but must not double image/context cost for ordinary capture.
        let silhouetteEvidence: (typeof captures)[number]["silhouette_evidence"];
        if (silhouetteCaptureViews.includes(view)) {
          const base = {
            scope: "VISIBLE_CUBES_SOLID_GEOMETRY" as const,
            visual_verdict: "NOT_EVALUATED" as const,
            source_camera_calibrated: false as const,
            texture_alpha_evaluated: false as const,
            automatic_correction: false as const,
          };
          try {
            const native = captureNativeCubeSilhouette(capturePreview);
            const silhouetteImage = imageContent(native.png_data_url, "image/png").content[0];
            const pngBytes = Buffer.from(silhouetteImage.data, "base64");
            const sha256 = createHash("sha256").update(pngBytes).digest("hex");
            const alpha = extractVerifiedPngAlpha({
              png_bytes: pngBytes,
              expected_sha256: sha256,
              view,
              provenance: "OFFSCREEN_RENDER_ALPHA",
            });
            if (alpha.state === "AVAILABLE") {
              let foreground = 0;
              for (const pixel of alpha.mask.pixels) foreground += pixel;
              silhouetteEvidence = {
                ...base, state: "AVAILABLE", reason: null,
                image_sha256: sha256,
                foreground_pixels: foreground,
                native_cube_count: native.rendered_cube_count,
              };
              const maskDelivery = recordCaptureImageDelivery(
                imageLedger, "SILHOUETTE", view, silhouetteImage.data
              );
              imageTraffic.push({
                kind: "SILHOUETTE", png_bytes: pngBytes.byteLength,
                delivery: maskDelivery.send_image ? "DELIVERED" : "EXACT_REUSE",
              });
              content.push({
                type: "text",
                text: `SILHOUETTE VIEW ${view}: visible solid Cube geometry only; not source-matched or visually approved.` +
                  (maskDelivery.reused_from_view
                    ? ` Exact PNG already included for SILHOUETTE VIEW ${maskDelivery.reused_from_view} (SHA-256 ${maskDelivery.image_sha256}).`
                    : ""),
              });
              if (maskDelivery.send_image) {
                content.push(silhouetteImage);
              }
            } else {
              imageTraffic.push({
                kind: "SILHOUETTE", png_bytes: pngBytes.byteLength,
                delivery: "DIAGNOSTIC_NOT_SENT",
              });
              silhouetteEvidence = {
                ...base, state: "UNVERIFIED", reason: alpha.reason,
                image_sha256: sha256,
                foreground_pixels: null,
                native_cube_count: native.rendered_cube_count,
              };
            }
          } catch {
            // No scores or masks from native failures; retain ordinary shaded
            // capture and expose a bounded unresolved diagnostic.
            silhouetteEvidence = {
              ...base, state: "UNVERIFIED",
              reason: "NATIVE_CUBE_SILHOUETTE_UNAVAILABLE",
              image_sha256: null,
              foreground_pixels: null,
              native_cube_count: null,
            };
          }
        }
        if (reference_correspondence) {
          imageDigests.push({ view, sha256: modelImageDelivery.image_sha256 });
        }
        const capture_contract_sha256 = createHash("sha256")
          .update(JSON.stringify([
            "capture-view-v1", dependencyBefore.dependency_sha256,
            view, captureCameraSpecMetadata(spec),
            captureSize, front_direction, highlight_missing_textures,
            modelImageDelivery.image_sha256,
          ])).digest("hex");
        captures.push({
          view,
          projection: spec.projection,
          image_sha256: modelImageDelivery.image_sha256,
          capture_contract_sha256,
          image_delivery: modelImageDelivery.send_image
            ? "content.image" : "same_response_exact_png",
          reused_from_view: modelImageDelivery.reused_from_view,
          width: captureSize,
          height: captureSize,
          png_bytes: modelPngBytes,
          camera_spec: captureCameraSpecMetadata(spec),
          ...(landmark_pairs?.length ? { landmark_projections: landmarkProjections } : {}),
          ...(silhouetteEvidence ? { silhouette_evidence: silhouetteEvidence } : {}),
        });
      }

      const dependencyAfter = readNativeVisualCaptureSnapshot(referenceBinding);
      const dependencyFreshness = assessVisualCaptureFreshness(
        dependencyBefore, dependencyAfter
      );
      if (dependencyFreshness.state === "STALE") {
        throw new Error(
          "MODEL_CAPTURE_STALE: project/geometry/UV/texture/pose or " +
          "presentation changed while capturing. Repeat affected views."
        );
      }

      // Deterministic 2x2 from four captures of ONE already authored native model.
      // No image generation, new view, retouching, or additional camera render.
      // A failed receipt leaves the four original observations intact, but
      // produces NO presentation sheet and cannot be called reference READY.
      const fourSideSheetResult = explicitFourSideCapture
        ? composeNativeFourSideSheet({
            project_uuid_before: captureProjectUuid,
            project_uuid_after: Project.uuid,
            dependency_freshness: dependencyFreshness.state,
            images: nativeFourSidePngs,
          })
        : null;
      if (fourSideSheetResult?.state === "AVAILABLE") {
        imageTraffic.push({
          kind: "FOUR_SIDE_SHEET",
          png_bytes: fourSideSheetResult.png_bytes.byteLength,
          delivery: "DELIVERED",
        });
        content.push({
          type: "text",
          text: "FOUR_SIDE_SHEET: deterministic FRONT|RIGHT / BACK|LEFT image " +
            "assembled from exactly four native orthographic Blockbench captures " +
            "in this same project invocation. It is a presentation image ONLY: " +
            "source comparison, geometry quality, rig, UV, Bedrock export and " +
            "user approval remain NOT_EVALUATED.",
        });
        content.push({
          type: "image",
          data: Buffer.from(fourSideSheetResult.png_bytes).toString("base64"),
          mimeType: "image/png",
        });
      } else if (fourSideSheetResult) {
        content.push({
          type: "text",
          text: "FOUR_SIDE_SHEET_UNVERIFIED: " + fourSideSheetResult.reason +
            ". Existing single-view captures are retained, but no final 2x2 " +
            "sheet or visual approval is asserted.",
        });
      }

      let partCorrespondenceEvidence = null;
      if (reference_correspondence && correspondenceBefore) {
        const after = readRecipePartCaptureScope(
          reference_correspondence.recipe_id, requestedCorrespondenceUuids
        );
        if (Project.uuid !== captureProjectUuid ||
            correspondenceBefore.project_uuid !== after.project_uuid ||
            correspondenceBefore.native_snapshot_fingerprint !==
              after.native_snapshot_fingerprint ||
            correspondenceBefore.capture_dependency_fingerprint !==
              after.capture_dependency_fingerprint) {
          throw new Error(
            "PART_CORRESPONDENCE_CAPTURE_STALE: recipe-owned native state or project changed during capture."
          );
        }
        const captureEvidenceHandle = "modelcapture:" + createHash("sha256")
          .update(JSON.stringify({
            project_uuid: captureProjectUuid,
            native: after.native_snapshot_fingerprint,
            capture_dependencies: after.capture_dependency_fingerprint,
            front_direction, framing_bounds: {
              min: [...framingBounds.min], max: [...framingBounds.max],
            },
            image_digests: imageDigests,
          }))
          .digest("hex");
        const assessment = assessVisualPartCorrespondence({
          reference: reference_correspondence.reference,
          model: {
            project_uuid: after.project_uuid,
            recipe_id: after.recipe_id,
            identities: after.identities,
            native_snapshot_fingerprint: correspondenceBefore.native_snapshot_fingerprint,
            current_native_snapshot_fingerprint: after.native_snapshot_fingerprint,
            capture_dependency_fingerprint: correspondenceBefore.capture_dependency_fingerprint,
            current_capture_dependency_fingerprint: after.capture_dependency_fingerprint,
            capture: {
              project_uuid: after.project_uuid,
              native_snapshot_fingerprint: after.native_snapshot_fingerprint,
              capture_dependency_fingerprint: after.capture_dependency_fingerprint,
              evidence_handle: captureEvidenceHandle,
              views: selectedViews,
              image_digests: imageDigests,
            },
          },
          // Deliberately omit review: freshly captured model images have
          // not yet been visually inspected with approved source pixels.
          proposals: reference_correspondence.proposals,
        });
        partCorrespondenceEvidence = {
          ...assessment,
          model_capture_evidence_handle: captureEvidenceHandle,
          project_uuid: after.project_uuid,
          recipe_id: after.recipe_id,
          native_snapshot_fingerprint: after.native_snapshot_fingerprint,
          capture_dependency_fingerprint: after.capture_dependency_fingerprint,
          native_scope: after.native_scope,
          capture_scene_scope: "ALL_NATIVE_CUBES" as const,
          verified_native_target_count: after.verified_count,
          recipe_owned_snapshot_stable_during_capture: true,
          capture_dependencies_stable_during_capture: true,
          model_scope_limits: [
            "NON_CUBE_SCENE_ELEMENTS_NOT_COVERED",
            "ANIMATED_PREVIEW_TRANSFORMS_NOT_COVERED",
            "GPU_MATERIAL_STATE_NOT_ATTESTED",
          ],
          source_authority: "CALLER_SUPPLIED_NOT_VERIFIED_BY_RUNTIME" as const,
          review_state: "PENDING_ACTUAL_IMAGE_COMPARISON" as const,
          automatic_correction: false,
          model_images: imageDigests,
        };
      }

      // Separate synthetic image for a one-time client compatibility check.
      // It is neither model evidence nor an animation pose.
      const ingestionProbe=ai_ingestion_probe?createNativeVisualIngestionProbe():null;
      if(ai_ingestion_probe){
        if(!ingestionProbe)throw new Error("AI_INGESTION_PROBE_MISSING");
        content.push({type:"text",text:
          "AI_IMAGE_INGESTION_CHALLENGE: Read the separate 4x3 color grid and return 12 capital letters left-to-right, top-to-bottom using R red, G green, B blue, Y yellow, C cyan, M magenta. The answer is ONLY in the PNG. Verify against receipt nonce/SHA-256 independently. This is not model visual evidence."});
        content.push(ingestionProbe.image);
      }
      const format = Format as { id?: string } | undefined;
      const structuredContent = {
        project: {
          uuid: Project.uuid,
          name: Project.name,
          format: format?.id ?? null,
        },
        count: captures.length,
        total_png_bytes: captures.reduce((sum, capture) => sum + capture.png_bytes, 0),
        evidence_freshness: {
          state: dependencyFreshness.state,
          reason: dependencyFreshness.reason,
          project_uuid: dependencyBefore.project_uuid,
          native_dependency_sha256: dependencyBefore.dependency_sha256,
          coverage: dependencyBefore.coverage,
          unresolved: dependencyBefore.unresolved,
          texture_pixels_hashed: dependencyBefore.texture_pixels_hashed,
          reference_authority: "CALLER_DECLARED_NOT_RUNTIME_VERIFIED",
          cross_invocation_reuse_allowed: false,
          native_renderer_attested: false,
          visual_verdict: "NOT_EVALUATED",
        },
        image_transport: {
          policy: "LOSSLESS_SAME_RESPONSE_EXACT_PNG",
          ...summarizeCaptureImageTraffic(imageTraffic),
          capture_processing_ms: Math.max(0, Date.now() - captureStartedAtMs),
          measurement_scope: "THIS_MODEL_CAPTURE_RESPONSE_ONLY",
          all_requested_views_captured: true,
          cross_revision_reuse: false,
          visual_verdict: "NOT_EVALUATED",
        },
        front_direction,
        framing_mode: framingInput.mode,
        framing_bounds: { min: [...framingBounds.min], max: [...framingBounds.max] },
        native_current_pose_bounds: observed.bounds,
        view_selection: {
          mode: views?.length ? "explicit" : "information_gain",
          silhouette_mask_views: silhouetteCaptureViews,
          silhouette_mask_policy: views?.length
            ? "EXPLICIT_VIEW_SET" : "CANONICAL_TARGET_SUPPORT_ONLY",
          requested_targets: selection.requested_targets,
          verification_risk: selection.risk,
          minimum_views: selection.minimum_views,
          expansion_views: selection.expansion,
          coverage: selection.coverage,
          selected_views: selectedViews,
          uncovered_targets: selection.uncovered_targets,
        },
        resolution_selection: {
          mode: size === undefined && evidence_targets?.length ? "adaptive" : "explicit_or_default",
          requested_size: size ?? null,
          selected_size: captureSize,
        },
        captures,
        ...(fourSideSheetResult ? {
          four_side_sheet: fourSideSheetResult.state === "AVAILABLE"
            ? {
                state: "AVAILABLE" as const,
                layout: "FRONT|RIGHT;BACK|LEFT" as const,
                source_views: fourSideSheetResult.source_views,
                source_image_sha256: fourSideSheetResult.source_image_sha256,
                source_project_uuid: captureProjectUuid,
                source_dependency_sha256: dependencyBefore.dependency_sha256,
                image_sha256: fourSideSheetResult.image_sha256,
                width: fourSideSheetResult.width,
                height: fourSideSheetResult.height,
                png_bytes: fourSideSheetResult.png_bytes.byteLength,
                provenance: fourSideSheetResult.provenance,
                visual_verdict: "NOT_EVALUATED" as const,
                authoring_ready: false as const,
                extra_camera_views: 0 as const,
              }
            : {
                state: "UNVERIFIED" as const,
                reason: fourSideSheetResult.reason,
                visual_verdict: "NOT_EVALUATED" as const,
                authoring_ready: false as const,
              },
        } : {}),
        ...(ingestionProbe?{ai_image_ingestion_probe:ingestionProbe.receipt}:{}),
        ...(partCorrespondenceEvidence
          ? { part_correspondence: partCorrespondenceEvidence }
          : {}),
        ...(landmark_pairs?.length ? {
          landmark_diagnosis: {
            state: "DIAGNOSTIC_ONLY" as const,
            pairing_authority: "CALLER_SUPPLIED_REFERENCE_ID_AND_SHA256" as const,
            source_camera_calibrated: false,
            automatic_correction: false,
            requested_count: landmark_pairs.length,
            projection_count: captures.reduce(
              (sum, row) => sum + (row.landmark_projections?.length ?? 0), 0
            ),
          },
        } : {}),
        reference_comparison: buildModelViewReferenceComparison(
          captures.map((capture) => capture.view)
        ),
        offscreen_capture: true,
        render_evidence: {
          diagnostic_missing_texture_highlight: highlight_missing_textures,
          shading: true,
          brightness: Settings.get("brightness"),
          view_mode: Project.view_mode,
          source: "blockbench_preview",
          camera_spec_source: "offscreen_capture_plan",
          native_camera_attested: false,
          in_game_verified: false,
        },
        active_editor_camera_untouched: true,
        warnings: observed.warnings.length,
        surface_quality_warning_scan: "NOT_RUN_FOR_CAPTURE",
      };

      if (dependencyFreshness.state === "UNVERIFIED") {
        content.unshift({
          type: "text",
          text: "Capture scene-dependency coverage is incomplete (" +
            dependencyBefore.unresolved.join(", ") +
            "). This is not a native freshness certificate or visual PASS; " +
            "do not reuse it across invocations.",
        });
      }
      content.unshift({
        type: "text",
        text:
          "Canonical model views captured for observation only. Use reference_comparison to map captures to the approved five-preview board, judge differences directly, and treat correspondence metadata as non-scoring evidence only; this tool does not judge resemblance.",
      });

      if (views?.length && selection.uncovered_targets.length) {
        content.unshift({
          type: "text",
          text: `Explicit views do not cover canonical evidence target(s): ${selection.uncovered_targets.join(", ")}. Keep those claims UNVERIFIED until supported by direct evidence; this capture is not a full-claim PASS.`,
        });
      }
      return { content, structuredContent };
    },
  }, cameraToolDocs[3].status);
}
