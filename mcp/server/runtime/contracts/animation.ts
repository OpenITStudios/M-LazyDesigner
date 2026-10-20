/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  getAllToolDefinitions,
  extractShape,
  withToolBranch,
  invalidateToolRegistrationRuntimeCaches,
} from "@/lib/factories";
import { resolveCoreAnimation } from "@/lib/core/identity";
import { withTemporaryAnimationPreview } from "@/lib/animation/previewState";
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

function captureContinuationContent(result: unknown): unknown[] {
  if (!isRecord(result) || !Array.isArray(result.content)) return [];
  return result.content.filter((item) => {
    if (!isRecord(item)) return false;
    if (item.type === "image") return true;
    return (
      item.type === "text" &&
      typeof item.text === "string" &&
      item.text.startsWith("VIEW ")
    );
  });
}

/**
 * Native capture must yield a complete set for each requested time.
 * Never turn an inner tool failure or partial media/metadata into a successful
 * multi-time receipt; a retry would require fresh state inspection.
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
    throw new Error(
      "ANIMATION_CAPTURE_INCOMPLETE: native capture failed or returned fewer view receipts than requested; no batch evidence is accepted."
    );
  }
  const mediaCount = result.content.filter(
    (item) => isRecord(item) && item.type === "image" &&
      typeof item.data === "string" && item.data.length > 0
  ).length;
  if (mediaCount < expectedViewCount) {
    throw new Error(
      "ANIMATION_CAPTURE_INCOMPLETE: missing PNG image content for one or more requested views; no batch evidence is accepted."
    );
  }
  return result.structuredContent as JsonRecord & { captures: unknown[] };
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
  const content: unknown[] = [
    {
      type: "text" as const,
      text: `Captured ${preview.times.length} bounded pose sample(s) from animation "${animation.name}" without changing the active editor camera or persistent timeline state.`,
    },
  ];
  const samples: Array<{
    time: number;
    captures: unknown[];
  }> = [];
  let commonStructured: JsonRecord = {};

  for (const time of preview.times) {
    const observed = await withTemporaryAnimationPreview(
      animationPreviewPort() as never,
      animation as never,
      time,
      () =>
        definition.execute(
          baseRequest as unknown as Record<string, unknown>,
          context
        )
    );

    const structured = requireCompleteAnimationCaptureSample(observed, expectedViewCount);
    content.push({ type: "text" as const, text: `ANIMATION_TIME ${time}` });
    content.push(...captureContinuationContent(observed));
    const captures = structured.captures as unknown[];
    samples.push({ time, captures });
    if (Object.keys(commonStructured).length === 0) {
      const { captures: _captures, count: _count, ...rest } = structured;
      commonStructured = rest;
    }
  }

  return {
    content,
    structuredContent: {
      ...commonStructured,
      count: samples.reduce((sum, sample) => sum + sample.captures.length, 0),
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
      },
      samples,
    },
  };
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