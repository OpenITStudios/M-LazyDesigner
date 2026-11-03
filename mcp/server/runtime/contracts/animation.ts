/// <reference types="blockbench-types" />

import { z } from "zod";
import { createHash } from "node:crypto";
import {
  getAllToolDefinitions,
  extractShape,
  withToolBranch,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import { resolveCoreAnimation } from "@/lib/core/identity";
import { withTemporaryAnimationPreview } from "@/lib/animation/previewState";
import { readRenderedModelBounds } from "@/lib/geometry/renderedModelBounds";
import { sharedPoseFraming,samePoseBounds,comparePoseCameraReceipts,
  type PoseFrame,type PoseBounds } from "@/lib/animation/evidenceFraming";
import { selectNativePoseDiagnosticRoute } from "@/lib/animation/poseDiagnosticScope";
import {
  inspectObservedAdditiveEulerPose,
  compareObservedEulerToExactAuthoredRotationKey,
  IK_EXACT_EULER_KEYFRAME_LIMIT,
} from "@/lib/rig/fabrik";
import {
  readDirectLocatorCandidates,
  readCurrentBonePoseSnapshot,
  CURRENT_POSE_LOCATOR_LIMIT,
} from "../../tools/animation/currentPose";
import {
  analyzeObservedAnimationLocatorTrajectories,
  analyzeObservedAnimationJointOriginFrames,
  ANIMATION_JOINT_ORIGIN_MAX_GROUPS,
  type ObservedAnimationLocatorFrame,
  type ObservedAnimationJointOriginFrame,
} from "@/lib/animation/contactEvidence";
import {
  analyzeGeometryPoseSequence,
  GEOMETRY_WORLD_OBB_SAMPLE_LIMIT,
  type GeometryPoseObbSnapshot,
} from "@/lib/geometry/surfaceEvidence";
import { orientedBoxFromCube } from "@/lib/geometry/blockbenchCubeObb";
import { isEffectivelyVisible } from "@/lib/geometry/renderedModelBounds";
import { animationChannelEnum } from "@/lib/schemas/animation";
import { animationIdOptionalSchema } from "@/lib/schemas/ids";
import {
  captureModelViewsParameters,
  resolveCaptureViewSelection,
} from "../../tools/inspection/camera";
import { inspectAnimationParameters } from "../../tools/animation/inspectionSchema";
import {
  animationCopyPasteParameters,
  batchKeyframeOperationsParameters,
} from "../../tools/animation/batchSchema";
import {
  animationGraphEditorParameters,
  manageKeyframesParameters,
} from "../../tools/animation/keyframeSchema";
import { animationTimelineParameters } from "../../tools/animation/timelineSchema";

type JsonRecord = Record<string, unknown>;

type RuntimeToolDefinition = {
  title: string;
  description: string;
  annotations?: Record<string, unknown>;
  inputSchema: Record<string, z.ZodType>;
  parameterSchema: z.ZodType;
  execute: (
    args: Record<string, unknown>,
    context?: unknown
  ) => Promise<unknown>;
};

const animationPreviewParameters = z
  .object({
    animation_id: z
      .string()
      .min(1)
      .describe("Authored Animation UUID or unique exact name."),
    times: z
      .array(z.number().finite().min(0).max(10000))
      .min(1)
      .max(5)
      .refine((times) => new Set(times).size === times.length, {
        message: "Animation preview times must be unique.",
      })
      .describe("Explicit animation sample times (seconds)."),
  })
  .strict();

// Preserve base capture validation (explicit views or evidence targets,
// paired landmarks, and view identities) across the Animation extension.
const captureModelViewsWithAnimationBase = captureModelViewsParameters.safeExtend({
  animation_preview: animationPreviewParameters
    .optional()
    .describe(
      "Optional authored-Animation pose samples; views × times must be ≤8 images."
    ),
});

export const animationAwareCaptureModelViewsParameters =
  captureModelViewsWithAnimationBase.superRefine((request, ctx) => {
    const sampleCount = request.animation_preview?.times.length ?? 1;
    // Evidence targets are expanded to actual canonical views at capture time.
    // Apply the same eight-image limit before native posing/screenshot work,
    // including implicit MEDIUM/HIGH verification-risk expansion.
    const actualViewCount = resolveCaptureViewSelection(
      request.views, request.evidence_targets, request.verification_risk
    ).views.length;
    // Optional native Cube-silhouette evidence can add a second PNG for
    // every shaded view. Reserve the worst-case media budget before capture.
    const possibleImagesPerView = request.evidence_targets?.includes("silhouette") ? 2 : 1;
    if (actualViewCount * sampleCount * possibleImagesPerView > 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["animation_preview", "times"],
        message:
          "Animation visual evidence is bounded to at most 8 images per call (resolved views × times × optional silhouette images <= 8). Reduce sample times, evidence targets/risk, or explicit views.",
      });
    }
  });

const focusedAnimationTimeRange = z
  .object({
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
  })
  .strict()
  .refine((value) => value.start <= value.end, {
    message: "Animation inspection time_range start must be <= end.",
    path: ["end"],
  });

const focusedInspectAnimationBase = inspectAnimationParameters.extend({
  channel: animationChannelEnum
    .optional()
    .describe(
      "Optional transform channel filter for focused bone inspection. Requires bone."
    ),
  time_range: focusedAnimationTimeRange
    .optional()
    .describe(
      "Optional inclusive keyframe time range for focused bone inspection. Requires bone."
    ),
  diagnostics: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Include compact authored-Animation technical diagnostics. No visual quality score is produced."
    ),
});

export const focusedInspectAnimationParameters =
  focusedInspectAnimationBase.superRefine((request, ctx) => {
    if (request.bone === undefined && request.channel !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channel"],
        message: "channel requires focused bone inspection.",
      });
    }
    if (request.bone === undefined && request.time_range !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["time_range"],
        message: "time_range requires focused bone inspection.",
      });
    }
  });

function withTimelineBranch<T extends z.ZodType>(
  schema: T,
  operation: "keyframes" | "graph" | "timeline" | "copy_paste"
) {
  return withToolBranch(schema, "operation", operation);
}

const { operation: batchOperationSchema, ...batchPayloadShape } =
  extractShape(batchKeyframeOperationsParameters);
const batchTimelineBranch = z.object({
  ...batchPayloadShape,
  operation: z.literal("batch"),
  batch_operation: batchOperationSchema,
  animation_id: animationIdOptionalSchema,
}).transform((value, ctx) => {
  const { operation: _operation, batch_operation, animation_id, ...payload } = value;
  const parsed = batchKeyframeOperationsParameters.safeParse({ ...payload, operation: batch_operation });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: issue.path.map((part) => part === "operation" ? "batch_operation" : part) });
    }
    return z.NEVER;
  }
  const { operation, ...result } = parsed.data;
  return { ...result, operation: "batch" as const, batch_operation: operation, animation_id };
});

/**
 * Corrected consolidated timeline contract. The public branch discriminator is
 * `operation`; the batch primitive's own operation is exposed as
 * `batch_operation` so one request never has to satisfy two conflicting values.
 */
export const optimizedAnimationTimelineParameters = z.union([
  withTimelineBranch(manageKeyframesParameters, "keyframes"),
  withTimelineBranch(animationGraphEditorParameters, "graph"),
  withTimelineBranch(animationTimelineParameters, "timeline"),
  batchTimelineBranch,
  withTimelineBranch(animationCopyPasteParameters, "copy_paste"),
]);

let animationRuntimeContractsWired = false;

// Whole-capture session guard. withTemporaryAnimationPreview() only protects
// one port object, while animationPreviewPort() creates a new port per sample.
// Without a session guard, concurrent multi-time capture calls can interleave.
let activeAnimationPreviewCapture = false;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRuntimeToolDefinition(name: string): RuntimeToolDefinition {
  const definitions = getAllToolDefinitions() as unknown as Record<
    string,
    RuntimeToolDefinition
  >;
  const definition = definitions[name];
  if (!definition) {
    throw new Error(
      `Cannot wire Animation capability ${name}: its canonical runtime definition is unavailable.`
    );
  }
  return definition;
}

function authoredAnimationItems(): Array<{
  selected?: boolean;
  playing?: boolean;
  select?: () => void;
}> {
  return (AnimationItem.all ?? []) as unknown as Array<{
    selected?: boolean;
    playing?: boolean;
    select?: () => void;
  }>;
}

function animationPreviewPort() {
  const items = authoredAnimationItems();
  const runtimeAnimator = Animator as unknown as {
    preview: () => void;
    showDefaultPose?: () => void;
  };

  return {
    animations: items,
    timeline: Timeline,
    getSelectedAnimation: () =>
      AnimationItem.selected as unknown as (typeof items)[number] | null,
    setSelectedAnimation: (item: (typeof items)[number] | null) => {
      if (item && typeof item.select === "function") {
        item.select();
        return;
      }
      items.forEach((candidate) => {
        candidate.selected = false;
      });
    },
    preview: () => runtimeAnimator.preview(),
    ...(typeof runtimeAnimator.showDefaultPose === "function"
      ? { showDefaultPose: () => runtimeAnimator.showDefaultPose!() }
      : {}),
  };
}

function requireAnimationSampleTime(animation: BBAnimation, time: number): void {
  const length = animation.length;
  if (!Number.isFinite(length) || length < 0) {
    throw new Error(
      `Animation "${animation.name}" has an invalid authored length ${String(length)}.`
    );
  }
  if (time > length + 1e-6) {
    throw new Error(
      `Animation sample time ${time} exceeds "${animation.name}" length ${length}. Request explicit times inside the current clip.`
    );
  }
}


/** Keep diagnostic mask labels with their images in multi-pose responses. */
export function captureContinuationContent(result: unknown): unknown[] {
  if (!isRecord(result) || !Array.isArray(result.content)) return [];
  return result.content.filter((item) => {
    if (!isRecord(item)) return false;
    if (item.type === "image") return true;
    return item.type === "text" &&
      typeof item.text === "string" &&
      (item.text.startsWith("VIEW ") ||
       item.text.startsWith("SILHOUETTE VIEW "));
  });
}

type DeliveredCaptureImage = { sha256: string; bytes: number };

function imageIdentityFromContent(value: JsonRecord): DeliveredCaptureImage {
  const data = value.data;
  if (value.mimeType !== "image/png" || typeof data !== "string" ||
      data.length === 0 || data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: invalid PNG image payload.");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength < 8 || bytes.toString("base64") !== data ||
      !bytes.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      )) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: invalid or noncanonical PNG bytes.");
  }
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
}

/**
 * Verify EVERY named view against its actual shaded PNG bytes or a previous
 * same-response byte-identical shaded view. Images and silhouette masks are
 * separate diagnostic roles. Counting all image items is not proof that a
 * model image exists for each view. No cross-time alias is accepted.
 */
export function requireCompleteAnimationCaptureSample(
  result: unknown,
  expectedViewCount: number
): JsonRecord & { captures: unknown[] } {
  if (!Number.isInteger(expectedViewCount) || expectedViewCount < 1 ||
      !isRecord(result) || result.isError === true ||
      !isRecord(result.structuredContent) ||
      !Array.isArray(result.structuredContent.captures) ||
      result.structuredContent.captures.length !== expectedViewCount ||
      !Array.isArray(result.content)) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: native capture or view receipts are incomplete.");
  }
  const structured = result.structuredContent;
  const records = structured.captures;
  const labels = new Map<string, string>();
  const silhouetteLabels = new Map<string, string>();
  const modelImages = new Map<string, DeliveredCaptureImage>();
  const maskImages = new Map<string, DeliveredCaptureImage>();
  const viewOrder: string[] = [];
  let current: { role: "MODEL" | "SILHOUETTE"; view: string } | null = null;
  let deliveredImageCount = 0;

  for (const value of result.content) {
    if (!isRecord(value)) {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: unrecognized content item.");
    }
    if (value.type === "text" && typeof value.text === "string") {
      const model = /^VIEW ([a-z0-9_]+)(?::|$)/.exec(value.text);
      const silhouette = /^SILHOUETTE VIEW ([a-z0-9_]+)(?::|$)/.exec(value.text);
      if (model) {
        if (labels.has(model[1])) {
          throw new Error("ANIMATION_CAPTURE_INCOMPLETE: duplicate model-view label.");
        }
        labels.set(model[1], value.text);
        viewOrder.push(model[1]);
        current = { role: "MODEL", view: model[1] };
      } else if (silhouette) {
        if (silhouetteLabels.has(silhouette[1]) ||
            !labels.has(silhouette[1])) {
          throw new Error("ANIMATION_CAPTURE_INCOMPLETE: orphan silhouette label.");
        }
        silhouetteLabels.set(silhouette[1], value.text);
        current = { role: "SILHOUETTE", view: silhouette[1] };
      } else {
        current = null; // Native capture summaries are preambles, not images.
      }
      continue;
    }
    if (value.type !== "image" || !current) {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: unlabeled or unsupported media.");
    }
    const image = imageIdentityFromContent(value);
    const target = current.role === "MODEL" ? modelImages : maskImages;
    if (target.has(current.view)) {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: duplicate image for one view/role.");
    }
    target.set(current.view, image);
    deliveredImageCount++;
    current = null;
  }

  if (viewOrder.length !== expectedViewCount) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: some model views lack labels.");
  }
  const directModels = new Map<string, DeliveredCaptureImage>();
  const directMasks = new Map<string, DeliveredCaptureImage>();
  for (let index = 0; index < records.length; index++) {
    const capture = records[index];
    if (!isRecord(capture) || typeof capture.view !== "string" ||
        capture.view !== viewOrder[index] ||
        typeof capture.image_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(capture.image_sha256) ||
        !Number.isSafeInteger(capture.png_bytes) ||
        (capture.png_bytes as number) < 8) {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: view/PNG receipt identity invalid.");
    }
    const view = capture.view;
    const currentImage = modelImages.get(view);
    if (capture.image_delivery === "content.image") {
      if (!currentImage || currentImage.sha256 !== capture.image_sha256 ||
          currentImage.bytes !== capture.png_bytes ||
          capture.reused_from_view !== null) {
        throw new Error("ANIMATION_CAPTURE_INCOMPLETE: model PNG bytes differ from receipt.");
      }
      directModels.set(view, currentImage);
    } else if (capture.image_delivery === "same_response_exact_png") {
      const from = capture.reused_from_view;
      const prior = typeof from === "string" ? directModels.get(from) : null;
      if (currentImage || !prior || prior.sha256 !== capture.image_sha256 ||
          prior.bytes !== capture.png_bytes ||
          !labels.get(view)?.includes(
            "MODEL VIEW " + from + " in this response (SHA-256 " +
            capture.image_sha256 + ")"
          )) {
        throw new Error("ANIMATION_CAPTURE_INCOMPLETE: stale or unbound model PNG alias.");
      }
    } else {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: unknown image delivery policy.");
    }

    const silhouette = isRecord(capture.silhouette_evidence)
      ? capture.silhouette_evidence : null;
    const mask = maskImages.get(view);
    const maskLabel = silhouetteLabels.get(view);
    if (silhouette?.state === "AVAILABLE") {
      if (typeof silhouette.image_sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(silhouette.image_sha256) ||
          !maskLabel) {
        throw new Error("ANIMATION_CAPTURE_INCOMPLETE: silhouette identity missing.");
      }
      if (mask) {
        if (mask.sha256 !== silhouette.image_sha256) {
          throw new Error("ANIMATION_CAPTURE_INCOMPLETE: silhouette PNG mismatch.");
        }
        directMasks.set(view, mask);
      } else {
        const alias = /Exact PNG already included for SILHOUETTE VIEW ([a-z0-9_]+) \(SHA-256 ([a-f0-9]{64})\)\./.exec(maskLabel);
        const prior = alias ? directMasks.get(alias[1]) : null;
        if (!alias || !prior ||
            prior.sha256 !== silhouette.image_sha256 ||
            alias[2] !== silhouette.image_sha256) {
          throw new Error("ANIMATION_CAPTURE_INCOMPLETE: unbound silhouette alias.");
        }
      }
    } else if (silhouette === null || silhouette.state === "UNVERIFIED") {
      if (mask || maskLabel) {
        throw new Error("ANIMATION_CAPTURE_INCOMPLETE: unsupported silhouette media.");
      }
    } else {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: silhouette state invalid.");
    }
  }

  const traffic = structured.image_transport;
  if (!isRecord(traffic) ||
      traffic.policy !== "LOSSLESS_SAME_RESPONSE_EXACT_PNG" ||
      traffic.delivered_image_count !== deliveredImageCount ||
      traffic.generated_image_count !==
        (traffic.delivered_image_count as number) +
        (traffic.reused_exact_image_count as number) +
        (traffic.diagnostic_not_sent_image_count as number)) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: image traffic/receipt mismatch.");
  }
  const totalModelBytes = records.reduce((total, item) =>
    total + ((item as JsonRecord).png_bytes as number), 0);
  if (structured.total_png_bytes !== totalModelBytes ||
      !Number.isSafeInteger(structured.warnings) ||
      (structured.warnings as number) < 0) {
    throw new Error("ANIMATION_CAPTURE_INCOMPLETE: model-byte or warning summary mismatch.");
  }
  return structured as JsonRecord & { captures: unknown[] };
}

/** Sum actual per-pose transport, never reuse the first pose's counters. */
export function aggregateAnimationCaptureTraffic(rows: readonly unknown[]) {
  if (rows.length < 1 || rows.some(row => !isRecord(row))) {
    throw new Error("ANIMATION_CAPTURE_TRAFFIC_UNVERIFIED");
  }
  const keys = [
    "generated_image_count", "generated_png_bytes",
    "delivered_image_count", "delivered_png_bytes",
    "reused_exact_image_count", "reused_exact_png_bytes",
    "diagnostic_not_sent_image_count", "diagnostic_not_sent_png_bytes",
    "model_image_count", "silhouette_image_count",
    "capture_processing_ms",
  ] as const;
  const counters = {} as Record<(typeof keys)[number], number>;
  for (const key of keys) {
    let sum = 0;
    for (const row of rows) {
      const value = (row as JsonRecord)[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) ||
          value < 0 || !Number.isSafeInteger(sum + value)) {
        throw new Error("ANIMATION_CAPTURE_TRAFFIC_UNVERIFIED: " + key);
      }
      sum += value;
    }
    counters[key] = sum;
  }
  return {
    policy: "LOSSLESS_EXACT_PNG_WITHIN_EACH_POSE" as const,
    ...counters,
    measurement_scope: "ALL_ANIMATION_POSE_SAMPLES" as const,
    cross_pose_reuse: false as const,
    all_requested_views_captured: true as const,
    api_token_usage: null as null,
    visual_verdict: "NOT_EVALUATED" as const,
  };
}


/**
 * Read geometry at the SAME native preview time already requested for the
 * screenshot. This reader never advances Timeline, authors, or opens Undo.
 * Hidden/unsupported Cubes keep stable UUID identity with a null OBB, so
 * missing visibility evidence cannot certify unnecessary geometry.
 */
function observeNativeAnimationGeometryPose(
  animationId: string,
  timeSeconds: number
): GeometryPoseObbSnapshot {
  if (typeof Cube === "undefined" || !Project ||
      typeof Project.uuid !== "string" || !Project.uuid.trim()) {
    throw new Error("GEOMETRY_POSE_NATIVE_PROJECT_UNAVAILABLE");
  }
  const all = [...(Cube.all ?? [])].sort((a: Cube, b: Cube) =>
    a.uuid.localeCompare(b.uuid));
  const selected = all.slice(0, GEOMETRY_WORLD_OBB_SAMPLE_LIMIT);
  return {
    project_uuid: Project.uuid,
    animation_uuid: animationId,
    time_seconds: timeSeconds,
    omitted_cube_count: all.length - selected.length,
    cubes: selected.map((cube: Cube) => {
      let obb: ReturnType<typeof orientedBoxFromCube> | null = null;
      if (cube.visibility !== false && isEffectivelyVisible(cube.mesh)) {
        try {
          obb = orientedBoxFromCube(cube);
        } catch {
          // Missing or invalid native world matrix: no invented OBB.
        }
      }
      return {
        uuid: cube.uuid,
        name: cube.name,
        parent_id: typeof Group !== "undefined" && cube.parent instanceof Group
          ? cube.parent.uuid
          : cube.parent === "root" ? "root" : null,
        obb,
      };
    }),
  };
}


/**
 * Same-frame, read-only Locator positions via the existing passive native
 * reader. The optional trajectory output does NOT infer a foot/grip role.
 * Sampling takes place only after the underlying image capture succeeded;
 * full native preview state restoration remains unverified.
 */
function observeNativeAnimationLocatorFrame(
  animation: BBAnimation,
  time: number
): ObservedAnimationLocatorFrame {
  if (typeof Project === "undefined" || !Project ||
      typeof Project.uuid !== "string" || !Project.uuid.trim() ||
      typeof Group === "undefined" || !Array.isArray(Group.all) ||
      typeof Locator === "undefined" || !Array.isArray(Locator.all) ||
      typeof AnimationItem === "undefined" ||
      typeof Timeline === "undefined" ||
      AnimationItem.selected !== animation ||
      Timeline.playing !== false || Timeline.time !== time) {
    throw new Error("ANIMATION_LOCATOR_PREVIEW_CONTEXT_UNVERIFIED");
  }
  const projectUuid = Project.uuid;
  const nativeLocators = Locator.all;
  if (nativeLocators.length > CURRENT_POSE_LOCATOR_LIMIT) {
    throw new Error("ANIMATION_LOCATOR_GLOBAL_BUDGET_EXCEEDED");
  }
  const ownerGroups = Group.all.filter((group: Group) =>
    nativeLocators.some((locator: Locator) => locator.parent === group)
  );
  const seen = new Set<string>();
  const markers: ObservedAnimationLocatorFrame["markers"][number][] = [];
  for (const group of ownerGroups) {
    const result = readDirectLocatorCandidates(group);
    if (result.state === "UNVERIFIED" ||
        result.observed_count !== result.count) {
      throw new Error("ANIMATION_LOCATOR_WORLD_READ_INCOMPLETE");
    }
    for (const marker of result.candidates) {
      if (marker.state !== "OBSERVED" ||
          !marker.world_position ||
          seen.has(marker.uuid)) {
        throw new Error("ANIMATION_LOCATOR_IDENTITY_OR_WORLD_UNVERIFIED");
      }
      seen.add(marker.uuid);
      markers.push({
        locator_uuid: marker.uuid,
        parent_group_uuid: group.uuid,
        world_position: [...marker.world_position] as [number,number,number],
      });
    }
  }
  // Root/unparented or ambiguously-parented Locators are not invented as
  // complete observations; fail the diagnostic, not the image capture.
  if (markers.length !== nativeLocators.length ||
      !Project || Project.uuid !== projectUuid ||
      AnimationItem.selected !== animation ||
      Timeline.time !== time) {
    throw new Error("ANIMATION_LOCATOR_INVENTORY_OR_CONTEXT_CHANGED");
  }
  return {
    project_uuid: projectUuid,
    animation_uuid: animation.uuid,
    time_seconds: time,
    markers: markers.sort((a,b) => a.locator_uuid.localeCompare(b.locator_uuid)),
  };
}


/**
 * Passive Group origins for the exact known Locator-to-ancestor hierarchy.
 * This uses the existing readCurrentBonePoseSnapshot identity/read fence.
 * No random Group selection, animation re-evaluation, contact-role guessing,
 * Timeline write, Undo edit or native IK correction is performed.
 */

/**
 * Passive native THREE mesh quaternion read, only for the exact current Group
 * parent mesh. Scaling/shear or an extra render-space parent makes an Euler
 * projection unsafe; leave position evidence intact but omit orientation.
 */
function readNativeAnimationGroupWorldQuaternion(group: Group) {
  if (typeof THREE === "undefined" ||
      typeof THREE.Quaternion !== "function" ||
      typeof Canvas === "undefined" || !Canvas.scene) {
    throw new Error("ANIMATION_MESH_ORIENTATION_RUNTIME_UNAVAILABLE");
  }
  const mesh=group.mesh as unknown as THREE.Object3D;
  const parent=mesh?.parent;
  const expected=group.parent instanceof Group
    ? group.parent.mesh : Canvas.scene;
  if (!mesh || parent!==expected ||
      typeof mesh.getWorldQuaternion!=="function" ||
      typeof parent?.getWorldQuaternion!=="function") {
    throw new Error("ANIMATION_MESH_ORIENTATION_PARENT_UNVERIFIED");
  }
  let ancestor: THREE.Object3D | null=mesh, attached=false;
  while (ancestor) {
    const scale=ancestor.scale;
    if (!scale || ![scale.x,scale.y,scale.z].every(Number.isFinite) ||
        Math.min(scale.x,scale.y,scale.z)<=0 ||
        Math.max(scale.x,scale.y,scale.z)-
          Math.min(scale.x,scale.y,scale.z)>
            1e-4*Math.max(1,scale.x,scale.y,scale.z)) {
      throw new Error("ANIMATION_MESH_ORIENTATION_SCALE_UNSUPPORTED");
    }
    if (ancestor===Canvas.scene) {attached=true;break;}
    ancestor=ancestor.parent;
  }
  if (!attached) throw new Error("ANIMATION_MESH_ORIENTATION_SCENE_UNVERIFIED");
  const read=(node:THREE.Object3D) => {
    const q=node.getWorldQuaternion(new THREE.Quaternion());
    const tuple=[q.x,q.y,q.z,q.w] as [number,number,number,number];
    const magnitude=Math.hypot(...tuple);
    if (!tuple.every(Number.isFinite) ||
        Math.abs(magnitude-1)>1e-3) {
      throw new Error("ANIMATION_MESH_ORIENTATION_QUATERNION_INVALID");
    }
    return tuple;
  };
  const world=read(mesh),parentWorld=read(parent);
  return {world_quaternion_xyzw:world,parent_world_quaternion_xyzw:parentWorld};
}


/**
 * Current-frame read-only Blockbench additive Euler preflight.
 *
 * Source: upstream v5.2.2 BoneAnimator.displayRotation. This observes
 * bone.mesh.pre_rotation and bone.mesh.fix_rotation independently of world
 * quaternion. It cannot identify authored keyframes or certify playback.
 */
function readNativeAnimationGroupEulerContext(
  group: Group, animation: BBAnimation
): ReturnType<typeof inspectObservedAdditiveEulerPose> {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const,reason,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  if (typeof Format==="undefined" || !Format ||
      typeof BoneAnimator==="undefined") {
    return unavailable("IK_EULER_NATIVE_FORMAT_UNAVAILABLE");
  }
  const animator=animation.animators?.[group.uuid];
  if (!(animator instanceof BoneAnimator)) {
    return unavailable("IK_EULER_NATIVE_BONE_ANIMATOR_UNAVAILABLE");
  }
  const mesh=group.mesh as unknown as THREE.Object3D & {
    fix_rotation?: THREE.Euler;
    pre_rotation?: THREE.Euler;
  };
  const rotation=mesh?.rotation,pre=mesh?.pre_rotation,fix=mesh?.fix_rotation;
  if (!rotation || !pre || !fix) {
    return unavailable("IK_EULER_NATIVE_PRE_ROTATION_UNAVAILABLE");
  }
  const format=Format as {
    euler_order?: string;
    per_animator_rotation_interpolation?: boolean;
    quaternion_interpolation?: boolean;
  };
  const settings=animator as BoneAnimator & {
    rotation_global?: boolean;
    quaternion_interpolation?: boolean;
  };
  const quaternionInterpolation=format.per_animator_rotation_interpolation===true
    ? settings.quaternion_interpolation
    : format.quaternion_interpolation;
  const blend=animation.blend_weight;
  const blendIsLiteralOne=blend===undefined || blend===null ||
    blend===1 ||
    (typeof blend==="string" &&
      (blend.trim()==="" || blend.trim()==="1"));
  const sample=(e:THREE.Euler)=>[e.x,e.y,e.z] as [number,number,number];
  return inspectObservedAdditiveEulerPose({
    mesh_rotation_radians:sample(rotation),
    pre_animation_rotation_radians:sample(pre),
    fix_rotation_radians:sample(fix),
    format_euler_order:format.euler_order ?? "",
    mesh_euler_order:rotation.order,
    pre_animation_euler_order:pre.order,
    fix_euler_order:fix.order,
    rotation_global:settings.rotation_global === false ? false : true,
    animation_override:animation.override===true,
    quaternion_interpolation:quaternionInterpolation===false ? false : true,
    single_clip_blend_literal_one:blendIsLiteralOne,
  });
}


/** Snapshot the native rotation channel without evaluating MoLang or editing.
 * Only existing literal numeric KeyframeDataPoint x/y/z are considered.
 * The pure source comparator validates every frame and exact sample time.
 */
function readNativeExactRotationKeyParity(
  group: Group,
  animation: BBAnimation,
  time: number,
  observed: ReturnType<typeof inspectObservedAdditiveEulerPose>
): ReturnType<typeof compareObservedEulerToExactAuthoredRotationKey> {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const, reason,
    native_rotation_authorized:false as const,
    native_keyframe_authorized:false as const,
    native_export_verified:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  if (observed.state!=="SOURCE_ONLY_OBSERVED_ADDITIVE_EULER_DELTA" ||
      typeof BoneAnimator==="undefined") {
    return unavailable("IK_EULER_EXACT_NATIVE_PREVIEW_UNAVAILABLE");
  }
  const animator=animation.animators?.[group.uuid];
  if (!(animator instanceof BoneAnimator)) {
    return unavailable("IK_EULER_EXACT_NATIVE_BONE_ANIMATOR_MISSING");
  }
  const track=animator.rotation as BBKeyframe[] | undefined;
  if (!Array.isArray(track) || track.length>IK_EXACT_EULER_KEYFRAME_LIMIT) {
    return unavailable("IK_EULER_EXACT_NATIVE_CHANNEL_BUDGET_INVALID");
  }
  try {
    return compareObservedEulerToExactAuthoredRotationKey({
      observed,
      time_seconds: time,
      animation_length_seconds: animation.length,
      rotation_keyframes: track.map((key) => ({
        uuid:key.uuid,
        time:key.time,
        interpolation:key.interpolation,
        data_points: Array.isArray(key.data_points)
          ? key.data_points.map((point) => ({
              x:point.x, y:point.y, z:point.z,
            })) : [],
      })),
    });
  } catch {
    return unavailable("IK_EULER_EXACT_NATIVE_CHANNEL_READ_FAILED");
  }
}

function observeNativeAnimationJointOriginFrame(
  animation: BBAnimation,
  time: number,
  locatorFrame: ObservedAnimationLocatorFrame
): ObservedAnimationJointOriginFrame {
  if (typeof Group === "undefined" || !Array.isArray(Group.all) ||
      typeof Project === "undefined" || !Project ||
      Project.uuid !== locatorFrame.project_uuid ||
      animation.uuid !== locatorFrame.animation_uuid ||
      time !== locatorFrame.time_seconds ||
      locatorFrame.markers.length === 0) {
    throw new Error("ANIMATION_JOINT_ORIGIN_CONTEXT_UNVERIFIED");
  }
  const byUuid = new Map<string, Group>();
  for (const group of Group.all) {
    if (typeof group.uuid !== "string" || !group.uuid.trim() ||
        byUuid.has(group.uuid)) {
      throw new Error("ANIMATION_JOINT_GROUP_UUID_AMBIGUOUS");
    }
    byUuid.set(group.uuid, group);
  }
  const selected = new Map<string, Group>();
  for (const marker of locatorFrame.markers) {
    let group = byUuid.get(marker.parent_group_uuid);
    if (!group) throw new Error("ANIMATION_JOINT_LOCATOR_PARENT_MISSING");
    const seenAncestors = new Set<string>();
    while (group) {
      if (seenAncestors.has(group.uuid)) {
        throw new Error("ANIMATION_JOINT_CYCLIC_HIERARCHY");
      }
      seenAncestors.add(group.uuid);
      selected.set(group.uuid, group);
      if (selected.size > ANIMATION_JOINT_ORIGIN_MAX_GROUPS) {
        throw new Error("ANIMATION_JOINT_ORIGIN_BUDGET_EXCEEDED");
      }
      const parent: unknown = group.parent;
      if (parent === null || parent === "root") break;
      if (!(parent instanceof Group) || !Group.all.includes(parent)) {
        throw new Error("ANIMATION_JOINT_ANCESTRY_UNVERIFIED");
      }
      group = parent;
    }
  }
  const groups: ObservedAnimationJointOriginFrame["groups"][number][] = [];
  for (const group of selected.values()) {
    const snapshot = readCurrentBonePoseSnapshot(animation, group);
    if (snapshot.state !== "OBSERVED" ||
        snapshot.project_uuid !== locatorFrame.project_uuid ||
        snapshot.animation_uuid !== animation.uuid ||
        snapshot.group_uuid !== group.uuid ||
        snapshot.timeline_time_observed !== time ||
        !Array.isArray(snapshot.bone_origin_world) ||
        snapshot.bone_origin_world.some((v) => !Number.isFinite(v))) {
      throw new Error("ANIMATION_JOINT_NATIVE_WORLD_SNAPSHOT_UNVERIFIED");
    }
    const parent = group.parent instanceof Group ? group.parent : null;
    let orientation: ReturnType<typeof readNativeAnimationGroupWorldQuaternion> | null=null;
    let orientationFailure: string | null=null;
    try {
      orientation=readNativeAnimationGroupWorldQuaternion(group);
    } catch (error) {
      orientationFailure=error instanceof Error ? error.message :
        "ANIMATION_MESH_ORIENTATION_READ_FAILED";
    }
    const eulerReview=orientation
      ? readNativeAnimationGroupEulerContext(group,animation)
      : {
          state:"unavailable" as const,
          reason:"IK_EULER_WORLD_ORIENTATION_UNAVAILABLE",
          native_euler_authorized:false as const,
          native_keyframe_authorized:false as const,
          visual_verdict:"not_evaluated" as const,
        };
    const exactSourceParity=readNativeExactRotationKeyParity(
      group,animation,time,eulerReview
    );
    groups.push({
      group_uuid: group.uuid,
      parent_group_uuid: parent?.uuid ?? null,
      world_position: [...snapshot.bone_origin_world] as [number,number,number],
      ...(orientation ? orientation : {}),
      ...(orientationFailure
        ? {orientation_unavailable_reason:orientationFailure} : {}),
      euler_pose_review:eulerReview,
      euler_exact_keyframe_review:exactSourceParity,
    });
  }
  if (typeof Project === "undefined" || !Project ||
      Project.uuid !== locatorFrame.project_uuid ||
      typeof AnimationItem === "undefined" ||
      AnimationItem.selected !== animation ||
      typeof Timeline === "undefined" || Timeline.time !== time ||
      groups.length !== selected.size) {
    throw new Error("ANIMATION_JOINT_ORIGIN_READ_CONTEXT_CHANGED");
  }
  return {
    project_uuid: locatorFrame.project_uuid,
    animation_uuid: animation.uuid,
    time_seconds: time,
    groups: groups.sort((a,b) => a.group_uuid.localeCompare(b.group_uuid)),
  };
}

async function captureAnimationSamples(
  definition: RuntimeToolDefinition,
  request: z.infer<typeof animationAwareCaptureModelViewsParameters>,
  context?: unknown
) {
  const preview = request.animation_preview;
  if (!preview) {
    return definition.execute(request as unknown as Record<string, unknown>, context);
  }
  if (activeAnimationPreviewCapture) {
    throw new Error("ANIMATION_PREVIEW_CAPTURE_ALREADY_ACTIVE");
  }
  activeAnimationPreviewCapture = true;
  try {

  const animation = resolveCoreAnimation(preview.animation_id, {
    allowSelected: false,
    notFoundHint:
      "Pass an exact authored Animation UUID or unique exact Animation name.",
  });
  preview.times.forEach((time) => requireAnimationSampleTime(animation, time));

  const { animation_preview: _animationPreview, ...baseRequest } = request;
  const expectedViewCount = resolveCaptureViewSelection(
    request.views, request.evidence_targets, request.verification_risk
  ).views.length;

  const captureStartedAtMs = Date.now();
  // Separate native sampling from PNG capture: no image is produced while
  // establishing the shared envelope of the requested event-time poses.
  const sourceProject = Project?.uuid;
  const observedPoses: PoseFrame[] = [];
  const crossPoseComparison = preview.times.length >= 2;
  for(const time of crossPoseComparison ? preview.times : []) {
    const bounds = await withTemporaryAnimationPreview(
      animationPreviewPort() as never,animation as never,time,()=>{
        if(!sourceProject || Project?.uuid!==sourceProject)
          throw new Error("ANIMATION_FRAMING_PROJECT_CHANGED");
        const observed = readRenderedModelBounds({includeSurfaceWarnings:false});
        if(!observed.bounds)throw new Error("ANIMATION_FRAMING_NO_VISIBLE_CUBES");
        return {min:[...observed.bounds.min] as [number,number,number],
          max:[...observed.bounds.max] as [number,number,number]};
      }
    );
    observedPoses.push({time,bounds});
  }
  const callerFrame = baseRequest.framing.mode==="explicit"
    ? baseRequest.framing : undefined;
  const sharedFrame=crossPoseComparison
    ? sharedPoseFraming(observedPoses,callerFrame) : null;
  const fixedCaptureRequest=sharedFrame
    ? {...baseRequest,framing:sharedFrame.framing} : baseRequest;
  if(Project?.uuid!==sourceProject)throw new Error("ANIMATION_FRAMING_PROJECT_CHANGED");

  const content: unknown[] = [
    {
      type: "text" as const,
      text: `Captured ${preview.times.length} bounded pose sample(s) from animation "${animation.name}". Known Timeline/selection readback checked; full native restoration not attested.`,
    },
  ];
  const samples: Array<{
    time: number;
    captures: unknown[];
    image_transport: JsonRecord;
    total_png_bytes: number;
    warnings: number;
    evidence_freshness: unknown;
    framing_bounds: unknown;
    part_correspondence?: unknown;
    landmark_diagnosis?: unknown;
  }> = [];
  let commonStructured: JsonRecord = {};
  const nativePoseScope=selectNativePoseDiagnosticRoute(
    preview.times.length,request.evidence_targets
  );
  const compareGeometry = nativePoseScope.geometry;
  const collectLocator = nativePoseScope.locators;
  const collectJoint = nativePoseScope.joints;
  const geometrySnapshots: GeometryPoseObbSnapshot[] = [];
  const geometryReadFailures: string[] = [];
  const locatorFrames: ObservedAnimationLocatorFrame[] = [];
  const locatorReadFailures: string[] = [];
  const jointOriginFrames: ObservedAnimationJointOriginFrame[] = [];
  const jointOriginReadFailures: string[] = [];

  for (const time of preview.times) {
    const observed = await withTemporaryAnimationPreview(
      animationPreviewPort() as never,
      animation as never,
      time,
      async () => {
        const result = await definition.execute(
          fixedCaptureRequest as unknown as Record<string, unknown>,
          context
        );
        // Confirm native screenshot evidence before reading optional OBBs.
        const structured = requireCompleteAnimationCaptureSample(
          result, expectedViewCount
        );
        if(crossPoseComparison) {
          const prepass=observedPoses.find(s=>s.time===time);
          if(!prepass || !samePoseBounds(prepass.bounds,structured.native_current_pose_bounds)){
            throw new Error("ANIMATION_POSE_BOUNDS_CHANGED_DURING_CAPTURE");
          }
        }
        let geometry: GeometryPoseObbSnapshot | null = null;
        let geometryFailure: string | null = null;
        if (compareGeometry) {
          try {
            geometry = observeNativeAnimationGeometryPose(animation.uuid, time);
          } catch (error) {
            geometryFailure = error instanceof Error ? error.message : String(error);
          }
        }
        let locatorFrame: ObservedAnimationLocatorFrame | null = null;
        let locatorFailure: string | null = null;
        if (collectLocator) {
          try {
            locatorFrame = observeNativeAnimationLocatorFrame(animation, time);
          } catch (error) {
            locatorFailure = error instanceof Error ? error.message : String(error);
          }
        }
        let jointOriginFrame: ObservedAnimationJointOriginFrame | null = null;
        let jointOriginFailure: string | null = null;
        if (collectJoint && locatorFrame) {
          try {
            jointOriginFrame = observeNativeAnimationJointOriginFrame(
              animation, time, locatorFrame
            );
          } catch (error) {
            jointOriginFailure = error instanceof Error
              ? error.message : String(error);
          }
        }
        return { result, structured, geometry, geometryFailure,
          locatorFrame, locatorFailure, jointOriginFrame, jointOriginFailure };
      }
    );

    content.push({ type: "text" as const, text: `ANIMATION_TIME ${time}` });
    content.push(...captureContinuationContent(observed.result));
    const captures = observed.structured.captures as unknown[];
    const traffic = observed.structured.image_transport;
    if (!isRecord(traffic)) {
      throw new Error("ANIMATION_CAPTURE_INCOMPLETE: per-pose traffic is missing.");
    }
    samples.push({
      time, captures,
      image_transport: traffic,
      total_png_bytes: observed.structured.total_png_bytes as number,
      warnings: observed.structured.warnings as number,
      evidence_freshness: observed.structured.evidence_freshness ?? null,
      framing_bounds: observed.structured.framing_bounds ?? null,
      ...(observed.structured.part_correspondence !== undefined
        ? { part_correspondence: observed.structured.part_correspondence } : {}),
      ...(observed.structured.landmark_diagnosis !== undefined
        ? { landmark_diagnosis: observed.structured.landmark_diagnosis } : {}),
    });
    if (observed.geometry) geometrySnapshots.push(observed.geometry);
    if (observed.geometryFailure) geometryReadFailures.push(observed.geometryFailure);
    if (observed.locatorFrame) locatorFrames.push(observed.locatorFrame);
    if (observed.locatorFailure) locatorReadFailures.push(observed.locatorFailure);
    if (observed.jointOriginFrame) jointOriginFrames.push(observed.jointOriginFrame);
    if (observed.jointOriginFailure) jointOriginReadFailures.push(observed.jointOriginFailure);
    if (Object.keys(commonStructured).length === 0) {
      const {
        captures: _captures,
        count: _count,
        image_transport: _imageTransport,
        total_png_bytes: _totalPngBytes,
        evidence_freshness: _evidenceFreshness,
        framing_bounds: _framingBounds,
        part_correspondence: _partCorrespondence,
        landmark_diagnosis: _landmarkDiagnosis,
        warnings: _warnings,
        ...rest
      } = observed.structured;
      commonStructured = rest;
    }
  }

  // Secondary diagnostics MUST NOT turn an otherwise valid image batch
  // into a tool failure. Partial/native-invalid evidence stays explicit.
  let geometryPoseReview: Record<string, unknown> | null = null;
  if (compareGeometry) {
    if (geometryReadFailures.length > 0 ||
        geometrySnapshots.length !== preview.times.length) {
      geometryPoseReview = {
        state: "unavailable",
        reason: "native_world_obb_observation_incomplete",
        requested_sample_count: preview.times.length,
        observed_sample_count: geometrySnapshots.length,
        failure_count: geometryReadFailures.length,
        geometry_mutation_authorized: false,
        note: "Screenshot capture succeeded, but optional world-OBB observations were incomplete. No negative Geometry conclusion is supported.",
      };
    } else {
      try {
        geometryPoseReview = {
          ...analyzeGeometryPoseSequence(geometrySnapshots),
          capture_observation_source: "native_animation_preview_world_obb",
          note: "World OBBs were observed during existing screenshot preview callbacks. Unsampled animation frames, materials, opacity and visual fidelity remain unverified. Never auto-delete Geometry.",
        };
      } catch (error) {
        geometryPoseReview = {
          state: "unavailable",
          reason: "geometry_pose_comparison_unavailable",
          diagnostic: error instanceof Error ? error.message : String(error),
          requested_sample_count: preview.times.length,
          geometry_mutation_authorized: false,
        };
      }
    }
  }

  // Pure role-free displacement diagnostics; a marker moving in world-space
  // is not a planted foot or a verified contact violation.
  const locatorTrajectoryReview = collectLocator
    ? locatorReadFailures.length > 0 || locatorFrames.length !== preview.times.length
      ? {
          state: "unavailable" as const,
          reason: "native_locator_observation_incomplete",
          requested_frame_count: preview.times.length,
          observed_frame_count: locatorFrames.length,
          failure_count: locatorReadFailures.length,
          physical_contact_verified: false as const,
          native_preview_restoration_attested: false as const,
          ik_correction_authorized: false as const,
          visual_verdict: "not_evaluated" as const,
        }
      : {
          ...analyzeObservedAnimationLocatorTrajectories(locatorFrames),
          observation_source: "current_native_preview_callback_unverified_restoration" as const,
        }
    : null;

  // Optional joint origins are independent of image/Locator success. Never
  // promote these preview callbacks to full-state-isolated IK evidence.
  const jointOriginReview = collectJoint
    ? jointOriginReadFailures.length > 0 ||
        jointOriginFrames.length !== preview.times.length
      ? {
          state: "unavailable" as const,
          reason: "native_joint_origin_observation_incomplete",
          requested_frame_count: preview.times.length,
          observed_frame_count: jointOriginFrames.length,
          failure_count: jointOriginReadFailures.length,
          native_preview_restoration_attested: false as const,
          native_ik_bake_authorized: false as const,
          contact_roles_inferred: false as const,
          visual_verdict: "not_evaluated" as const,
        }
      : analyzeObservedAnimationJointOriginFrames(jointOriginFrames)
    : null;

  return {
    content,
    structuredContent: {
      ...commonStructured,
      count: samples.reduce((sum, sample) => sum + sample.captures.length, 0),
      total_png_bytes: samples.reduce((sum, sample) => sum + sample.total_png_bytes, 0),
      warnings: samples.reduce((sum, sample) => sum + sample.warnings, 0),
      image_transport: {
        ...aggregateAnimationCaptureTraffic(samples.map(sample => sample.image_transport)),
        animation_capture_elapsed_ms: Math.max(0, Date.now() - captureStartedAtMs),
      },
      shared_pose_framing: sharedFrame,
      native_pose_diagnostic_scope: nativePoseScope,
      pose_camera_comparability: comparePoseCameraReceipts(samples.map(sample=>({
        time:sample.time,
        framing_bounds:sample.framing_bounds as PoseBounds,
        captures:sample.captures as Array<{view:string;camera_spec:unknown}>,
      }))),
      animation_preview: {
        animation: {
          uuid: animation.uuid,
          name: animation.name,
          length: animation.length,
          loop: animation.loop,
        },
        times: [...preview.times],
        sample_count: samples.length,
        persistent_timeline_state_restored: true,
        restoration_verification_scope: "KNOWN_TIMELINE_SELECTION_FLAGS_ONLY",
        full_native_state_restoration_attested: false,
        scene_dependency_proof_scope: "PER_POSE_ONLY",
      },
      samples,
      ...(geometryPoseReview ? { geometry_pose_review: geometryPoseReview } : {}),
      ...(locatorTrajectoryReview ? { locator_trajectory_review: locatorTrajectoryReview } : {}),
      ...(jointOriginReview ? { joint_origin_review: jointOriginReview } : {}),
    },
  };
  } finally {
    activeAnimationPreviewCapture = false;
  }
}

function keyframesForChannel(
  animator: BoneAnimator,
  channel: "rotation" | "position" | "scale"
): BBKeyframe[] {
  return (((animator[channel] as BBKeyframe[] | undefined) ?? []) as BBKeyframe[])
    .slice()
    .sort((left, right) => left.time - right.time || left.uuid.localeCompare(right.uuid));
}

function sameEffectiveKeyframeValue(left: BBKeyframe, right: BBKeyframe): boolean {
  try {
    return JSON.stringify(left.getArray(0)) === JSON.stringify(right.getArray(0));
  } catch {
    return false;
  }
}

function buildAnimationDiagnostics(animation: BBAnimation) {
  const length = animation.length;
  const channels = ["rotation", "position", "scale"] as const;
  let transformKeyframeCount = 0;
  let keysOutsideLength = 0;
  let danglingBoneAnimators = 0;
  let loopEndpointMismatchCandidates = 0;

  for (const animator of Object.values(animation.animators ?? {})) {
    if (!(animator instanceof BoneAnimator)) continue;
    if (!Group.all.some((group: Group) => group.uuid === animator.uuid)) {
      danglingBoneAnimators += 1;
    }

    for (const channel of channels) {
      const keyframes = keyframesForChannel(animator, channel);
      transformKeyframeCount += keyframes.length;
      keysOutsideLength += keyframes.filter(
        (keyframe) => keyframe.time > length + 1e-6
      ).length;

      if (animation.loop && length > 0) {
        const start = keyframes.find((keyframe) => Math.abs(keyframe.time) < 1e-6);
        const end = keyframes.find(
          (keyframe) => Math.abs(keyframe.time - length) < 1e-6
        );
        if (start && end && !sameEffectiveKeyframeValue(start, end)) {
          loopEndpointMismatchCandidates += 1;
        }
      }
    }
  }

  let effectKeyframeCount = 0;
  let effectsOutsideLength = 0;
  const effects = animation.animators.effects;
  if (effects instanceof EffectAnimator) {
    for (const channel of ["particle", "sound", "timeline"] as const) {
      const keyframes = ((effects[channel] as BBKeyframe[] | undefined) ?? []);
      effectKeyframeCount += keyframes.length;
      effectsOutsideLength += keyframes.filter(
        (keyframe) => keyframe.time > length + 1e-6
      ).length;
    }
  }

  return {
    scope: "authored_animation_technical" as const,
    transform_keyframe_count: transformKeyframeCount,
    effect_keyframe_count: effectKeyframeCount,
    keys_outside_length: keysOutsideLength,
    effects_outside_length: effectsOutsideLength,
    dangling_bone_animators: danglingBoneAnimators,
    loop_endpoint_mismatch_candidates: loopEndpointMismatchCandidates,
    note:
      "Diagnostics identify technical review candidates only; they do not score motion quality or create PASS/FAIL.",
  };
}

function filterChannelState(
  rawChannel: unknown,
  timeRange?: { start: number; end: number }
): unknown {
  if (!isRecord(rawChannel) || !Array.isArray(rawChannel.keyframes)) {
    return rawChannel;
  }
  if (!timeRange) return rawChannel;

  const keyframes = rawChannel.keyframes.filter((entry) => {
    if (!isRecord(entry) || typeof entry.time !== "number") return false;
    return entry.time >= timeRange.start && entry.time <= timeRange.end;
  });
  return {
    ...rawChannel,
    keyframe_count: keyframes.length,
    keyframes,
  };
}

function filterFocusedAnimationResult(
  structured: JsonRecord,
  request: z.infer<typeof focusedInspectAnimationParameters>
): JsonRecord {
  let next: JsonRecord = { ...structured };

  if (request.bone !== undefined && isRecord(structured.focused_bone)) {
    const focusedBone = structured.focused_bone;
    if (isRecord(focusedBone.channels)) {
      const channels = focusedBone.channels;
      const selectedChannels = request.channel
        ? [request.channel]
        : (["rotation", "position", "scale"] as const);
      const filteredChannels = Object.fromEntries(
        selectedChannels.map((channel) => [
          channel,
          filterChannelState(
            channels[channel],
            request.time_range
          ),
        ])
      );
      next = {
        ...next,
        focused_bone: {
          ...focusedBone,
          channels: filteredChannels,
        },
        inspection_filter: {
          channel: request.channel ?? null,
          time_range: request.time_range ?? null,
        },
      };
    }
  }

  if (request.diagnostics) {
    if (structured.authored_space === "blockbench_animation") {
      const animation = resolveCoreAnimation(request.animation_id, {
        allowSelected: true,
      });
      next = {
        ...next,
        diagnostics: buildAnimationDiagnostics(animation),
      };
    } else {
      next = {
        ...next,
        diagnostics: {
          scope: "animation_controller",
          supported: false,
          note:
            "Compact technical diagnostics currently target authored Animation clips; controller inspection remains identity/state focused.",
        },
      };
    }
  }

  return next;
}

async function executeOptimizedAnimationTimeline(
  request: z.infer<typeof optimizedAnimationTimelineParameters>,
  context?: unknown
) {
  const operation = request.operation;
  if (operation === "batch") {
    const {
      operation: _operation,
      batch_operation,
      animation_id,
      ...batchArgs
    } = request;

    if (animation_id !== undefined) {
      const animation = resolveCoreAnimation(animation_id, {
        allowSelected: false,
      });
      if (AnimationItem.selected !== animation) {
        Timeline.pause();
        animation.select();
        if (AnimationItem.selected !== animation) {
          throw new Error(
            `Could not select animation "${animation.name}" for the batch operation.`
          );
        }
      }
    }

    return requireRuntimeToolDefinition("batch_keyframe_operations").execute(
      {
        ...batchArgs,
        operation: batch_operation,
      },
      context
    );
  }

  const target =
    operation === "keyframes"
      ? "manage_keyframes"
      : operation === "graph"
        ? "animation_graph_editor"
        : operation === "timeline"
          ? "animation_timeline"
          : "animation_copy_paste";
  const { operation: _operation, ...args } = request;
  return requireRuntimeToolDefinition(target).execute(args, context);
}

/**
 * Adds focused, lower-context Animation contracts while preserving the mature
 * canonical executors. No new public Runtime tool is introduced.
 */
export function wireAnimationRuntimeContracts(): void {
  if (animationRuntimeContractsWired) return;

  const inspectDefinition = requireRuntimeToolDefinition("inspect_animation");
  const originalInspect = inspectDefinition.execute.bind(inspectDefinition);
  inspectDefinition.parameterSchema = focusedInspectAnimationParameters;
  inspectDefinition.inputSchema = {
    ...inspectDefinition.inputSchema,
    channel: animationChannelEnum.optional().describe("Focused bone transform channel."),
    time_range: focusedAnimationTimeRange.optional(),
    diagnostics: z.boolean().optional().default(false),
  };
  inspectDefinition.execute = async (rawArgs, context) => {
    const request = focusedInspectAnimationParameters.parse(rawArgs);
    const {
      channel: _channel,
      time_range: _timeRange,
      diagnostics: _diagnostics,
      ...baseRequest
    } = request;
    const result = await originalInspect(baseRequest, context);
    if (!isRecord(result) || !isRecord(result.structuredContent)) return result;

    const structuredContent = filterFocusedAnimationResult(
      result.structuredContent,
      request
    );
    return {
      ...result,
      content: [
        {
          type: "text" as const,
          text:
            request.bone !== undefined || request.diagnostics
              ? "inspect_animation returned focused Animation evidence."
              : "inspect_animation returned structured Animation evidence.",
        },
      ],
      structuredContent,
    };
  };

  const timelineDefinition = requireRuntimeToolDefinition(
    "manage_animation_timeline"
  );
  timelineDefinition.parameterSchema = optimizedAnimationTimelineParameters;
  timelineDefinition.inputSchema = {
    ...timelineDefinition.inputSchema,
    operation: z
      .enum(["keyframes", "graph", "timeline", "batch", "copy_paste"])
      .describe("Animation timeline branch."),
    batch_operation: z
      .enum(["offset", "scale", "reverse", "mirror", "smooth", "bake"])
      .optional()
      .describe("Required only when operation=batch."),
    animation_id: animationIdOptionalSchema,
  };
  timelineDefinition.execute = async (rawArgs, context) =>
    executeOptimizedAnimationTimeline(
      optimizedAnimationTimelineParameters.parse(rawArgs),
      context
    );

  const captureDefinition = requireRuntimeToolDefinition("capture_model_views");
  const originalCaptureDefinition: RuntimeToolDefinition = {
    ...captureDefinition,
    inputSchema: { ...captureDefinition.inputSchema },
    execute: captureDefinition.execute.bind(captureDefinition),
  };
  captureDefinition.parameterSchema = animationAwareCaptureModelViewsParameters;
  captureDefinition.inputSchema = {
    ...captureDefinition.inputSchema,
    animation_preview: animationPreviewParameters.optional(),
  };
  captureDefinition.execute = async (rawArgs, context) => {
    const request = animationAwareCaptureModelViewsParameters.parse(rawArgs);
    return captureAnimationSamples(originalCaptureDefinition, request, context);
  };

  animationRuntimeContractsWired = true;
  invalidateToolRegistrationRuntimeCaches();
}