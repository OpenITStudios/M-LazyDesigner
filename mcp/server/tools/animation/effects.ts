/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  animationEffectContinuationState,
  animationEffectSameTime,
  applyEffectPayload,
  effectPointData,
  effectPointSnapshot,
  snapshotsEffectivelyEqual,
} from "./effectState";
export {
  effectiveTimelineScriptLines,
  normalizeEffectiveParticleScript,
} from "./effectState";
import { animationEffectsReceipt } from "@/lib/receipts/animationEffects";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { resolveCoreAnimation } from "@/lib/core/identity";
import { animationIdOptionalSchema } from "@/lib/schemas/ids";

type AnimationEffectChannel = "particle" | "sound" | "timeline";
type EffectPointSnapshot = {
  effect: string;
  locator: string;
  bind_to_actor: boolean;
  script: string;
  file: string;
};

const meaningfulTextSchema = (label: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${label} must contain a non-whitespace authored value.`,
  });

const meaningfulScriptSchema = z.string().refine(
  (value) => value.replace(/[\n\s;.]+/g, "").length > 0,
  { message: "Script must contain an authored statement or command." }
);

const clearableTextSchema = z.union([meaningfulTextSchema("Text"), z.null()]);
const clearableScriptSchema = z.union([meaningfulScriptSchema, z.null()]);

export const animationEffectOperationSchema = z
  .object({
    operation: z.enum(["add", "update", "remove"]),
    channel: z.enum(["particle", "sound", "timeline"]),
    keyframe_uuid: z.string().min(1).optional(),
    data_point_index: z.number().int().min(0).optional(),
    time: z.number().finite().min(0).max(10000).optional(),
    effect: meaningfulTextSchema("Effect identifier").optional(),
    locator: clearableTextSchema.optional(),
    bind_to_actor: z.union([z.boolean(), z.null()]).optional(),
    pre_effect_script: clearableScriptSchema.optional(),
    script: meaningfulScriptSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const isPointChannel = value.channel === "particle" || value.channel === "sound";
    const mutationFields = [
      value.time,
      value.effect,
      value.locator,
      value.bind_to_actor,
      value.pre_effect_script,
      value.script,
    ];

    if (value.operation === "add") {
      if (value.keyframe_uuid !== undefined || value.data_point_index !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keyframe_uuid"],
          message: "add targets time/channel, not an existing keyframe UUID or data-point index.",
        });
      }
      if (value.time === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["time"], message: "add requires time." });
      }
      if (isPointChannel && value.effect === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effect"], message: `${value.channel} add requires effect.` });
      }
      if (value.channel === "timeline" && value.script === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["script"], message: "timeline add requires script." });
      }
    } else {
      if (value.keyframe_uuid === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keyframe_uuid"], message: `${value.operation} requires keyframe_uuid.` });
      }
      if (isPointChannel && value.data_point_index === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_point_index"], message: `${value.channel} ${value.operation} requires data_point_index.` });
      }
      if (value.channel === "timeline" && value.data_point_index !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_point_index"], message: "timeline targets the keyframe UUID directly; omit data_point_index." });
      }
      if (value.operation === "update" && mutationFields.every((field) => field === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "update requires an authored field or time change." });
      }
      if (value.operation === "remove" && mutationFields.some((field) => field !== undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "remove accepts identity only; omit time/payload fields." });
      }
    }

    if (value.channel === "particle") {
      if (value.script !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["script"], message: "particle uses pre_effect_script, not timeline script." });
      }
    } else if (value.channel === "sound") {
      if (value.bind_to_actor !== undefined || value.pre_effect_script !== undefined || value.script !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["channel"], message: "sound owns only effect and locator payload fields." });
      }
    } else if (
      value.effect !== undefined ||
      value.locator !== undefined ||
      value.bind_to_actor !== undefined ||
      value.pre_effect_script !== undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["channel"], message: "timeline owns only script payload data." });
    }
  });

export const manageAnimationEffectsParameters = z
  .object({
    animation_id: animationIdOptionalSchema,
    operations: z
      .array(animationEffectOperationSchema)
      .min(1)
      .max(64)
      .describe("Ordered bounded effect mutations for one authored Animation."),
  })
  .strict();

export const animationEffectToolDocs: ToolSpec[] = [
  {
    name: "manage_animation_effects",
    description:
      "Adds, updates, or removes existing-Animation particle, sound, and timeline effect keyframes with exact keyframe/data-point identity, preflighted collisions, one Undo transaction, and bounded continuation state.",
    annotations: { title: "Manage Animation Effects", destructiveHint: true },
    parameters: manageAnimationEffectsParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

function resolveAnimation(reference?: string) {
  return resolveCoreAnimation(reference, {
    allowSelected: true,
    notFoundHint: "Pass an exact authored Animation UUID or exact unique Animation name.",
  });
}

export function registerAnimationEffectTools() {
  createTool(
    animationEffectToolDocs[0].name,
    {
      ...animationEffectToolDocs[0],
      parameters: manageAnimationEffectsParameters,
      async execute({ animation_id, operations }) {
        const animation = resolveAnimation(animation_id);
        const existingEffects = animation.animators.effects;
        if (existingEffects && !(existingEffects instanceof EffectAnimator)) {
          throw new Error(`Animation "${animation.name}" has a non-EffectAnimator stored at animation.animators.effects.`);
        }

        type SimKeyframe = {
          id: string;
          uuid: string | null;
          channel: AnimationEffectChannel;
          time: number;
          points: Array<{ id: string; snapshot: EffectPointSnapshot }>;
        };
        const channels: AnimationEffectChannel[] = ["particle", "sound", "timeline"];
        const sim: Record<AnimationEffectChannel, SimKeyframe[]> = {
          particle: [], sound: [], timeline: [],
        };
        const realPoints = new Map<string, KeyframeDataPoint>();

        channels.forEach((channel) => {
          const keyframes = existingEffects ? ((existingEffects[channel] as BBKeyframe[] | undefined) ?? []) : [];
          sim[channel] = keyframes.map((keyframe) => ({
            id: keyframe.uuid,
            uuid: keyframe.uuid,
            channel,
            time: keyframe.time,
            points: keyframe.data_points.map((point, index) => {
              const pointId = `${keyframe.uuid}:${index}`;
              realPoints.set(pointId, point);
              return { id: pointId, snapshot: effectPointSnapshot(point) };
            }),
          }));
        });

        const plannedTimes = operations.map((operation) =>
          operation.time === undefined ? undefined : Timeline.snapTime(operation.time, animation)
        );
        const targeted = new Set<string>();

        const keyframesAtTime = (channel: AnimationEffectChannel, time: number, excludeId?: string) =>
          sim[channel].filter((keyframe) => keyframe.id !== excludeId && animationEffectSameTime(keyframe.time, time));
        const findKeyframe = (channel: AnimationEffectChannel, uuid: string) =>
          sim[channel].find((keyframe) => keyframe.uuid === uuid);
        const findPoint = (channel: "particle" | "sound", uuid: string, index: number) => {
          const pointId = `${uuid}:${index}`;
          const keyframe = sim[channel].find((candidate) => candidate.points.some((point) => point.id === pointId));
          const point = keyframe?.points.find((candidate) => candidate.id === pointId);
          return keyframe && point ? { keyframe, point, pointId } : null;
        };

        operations.forEach((operation, index) => {
          const snappedTime = plannedTimes[index];
          if (snappedTime !== undefined && (!Number.isFinite(snappedTime) || snappedTime < 0 || snappedTime > 10000)) {
            throw new Error(`Effect operation ${index} resolves to invalid snapped time ${snappedTime}.`);
          }

          if (operation.operation === "add") {
            const targetTime = snappedTime!;
            const collisions = keyframesAtTime(operation.channel, targetTime);
            if (collisions.length > 1) {
              throw new Error(`Effect operation ${index} found ambiguous ${operation.channel} keyframes at ${targetTime}.`);
            }
            const snapshot = applyEffectPayload(operation.channel, { effect: "", locator: "", bind_to_actor: true, script: "", file: "" }, operation);
            if (operation.channel === "timeline") {
              if (collisions.length) throw new Error(`Timeline add at ${targetTime} collides with an existing keyframe.`);
              sim.timeline.push({ id: `add:${index}`, uuid: null, channel: "timeline", time: targetTime, points: [{ id: `add:${index}:0`, snapshot }] });
            } else if (collisions[0]) {
              if (collisions[0].points.length >= 1000) {
                throw new Error(`${operation.channel} keyframe at ${targetTime} already has the native maximum of 1000 data points.`);
              }
              collisions[0].points.push({ id: `add:${index}:point`, snapshot });
            } else {
              sim[operation.channel].push({ id: `add:${index}`, uuid: null, channel: operation.channel, time: targetTime, points: [{ id: `add:${index}:0`, snapshot }] });
            }
            return;
          }

          const targetKey = operation.channel === "timeline"
            ? `${operation.channel}:${operation.keyframe_uuid}`
            : `${operation.channel}:${operation.keyframe_uuid}:${operation.data_point_index}`;
          if (targeted.has(targetKey)) {
            throw new Error(`Effect target ${targetKey} appears more than once in one batch; author one final mutation per inspected identity.`);
          }
          targeted.add(targetKey);

          if (operation.channel === "timeline") {
            const keyframe = findKeyframe("timeline", operation.keyframe_uuid!);
            if (!keyframe) throw new Error(`Timeline keyframe "${operation.keyframe_uuid}" not found in current batch state.`);
            if (operation.operation === "remove") {
              sim.timeline.splice(sim.timeline.indexOf(keyframe), 1);
              return;
            }
            const nextTime = snappedTime ?? keyframe.time;
            if (keyframesAtTime("timeline", nextTime, keyframe.id).length) {
              throw new Error(`Timeline update for "${operation.keyframe_uuid}" collides at ${nextTime}.`);
            }
            const current = keyframe.points[0].snapshot;
            const next = applyEffectPayload("timeline", current, operation);
            if (animationEffectSameTime(nextTime, keyframe.time) && snapshotsEffectivelyEqual("timeline", current, next)) {
              throw new Error(`Timeline update for "${operation.keyframe_uuid}" is an effective no-op.`);
            }
            keyframe.time = nextTime;
            keyframe.points[0].snapshot = next;
            return;
          }

          const found = findPoint(operation.channel, operation.keyframe_uuid!, operation.data_point_index!);
          if (!found) {
            throw new Error(`${operation.channel} target ${operation.keyframe_uuid}:${operation.data_point_index} not found in current batch state.`);
          }
          if (operation.operation === "remove") {
            found.keyframe.points.splice(found.keyframe.points.indexOf(found.point), 1);
            if (!found.keyframe.points.length) sim[operation.channel].splice(sim[operation.channel].indexOf(found.keyframe), 1);
            return;
          }

          const nextTime = snappedTime ?? found.keyframe.time;
          const next = applyEffectPayload(operation.channel, found.point.snapshot, operation);
          if (animationEffectSameTime(nextTime, found.keyframe.time)) {
            if (snapshotsEffectivelyEqual(operation.channel, found.point.snapshot, next)) {
              throw new Error(`${operation.channel} update for ${operation.keyframe_uuid}:${operation.data_point_index} is an effective no-op.`);
            }
            found.point.snapshot = next;
            return;
          }
          if (keyframesAtTime(operation.channel, nextTime, found.keyframe.id).length) {
            throw new Error(`${operation.channel} move for ${operation.keyframe_uuid}:${operation.data_point_index} collides at ${nextTime}; moving does not implicitly merge identities.`);
          }
          found.keyframe.points.splice(found.keyframe.points.indexOf(found.point), 1);
          if (!found.keyframe.points.length) sim[operation.channel].splice(sim[operation.channel].indexOf(found.keyframe), 1);
          sim[operation.channel].push({ id: `move:${index}`, uuid: null, channel: operation.channel, time: nextTime, points: [{ id: found.pointId, snapshot: next }] });
        });

        type PlanResult = ReturnType<typeof animationEffectContinuationState> | { channel: AnimationEffectChannel; removed: { keyframe_uuid: string; data_point_index: number | null; remaining?: Array<{ effect: string; script: string }> } };
        const results: PlanResult[] = [];
        Undo.initEdit({ animations: [animation] });
        try {
          let effectAnimator = existingEffects as EffectAnimator | undefined;
          const ensureEffects = () => {
            if (!effectAnimator) {
              effectAnimator = new EffectAnimator(animation);
              animation.animators.effects = effectAnimator;
            }
            return effectAnimator;
          };
          const findRuntimeKeyframe = (channel: AnimationEffectChannel, uuid: string) => {
            const found = ((ensureEffects()[channel] as BBKeyframe[] | undefined) ?? []).find((keyframe) => keyframe.uuid === uuid);
            if (!found) throw new Error(`Preflight/runtime mismatch: ${channel} keyframe "${uuid}" disappeared.`);
            return found;
          };
          const findRuntimeAtTime = (channel: AnimationEffectChannel, time: number) =>
            (((ensureEffects()[channel] as BBKeyframe[] | undefined) ?? []).filter((keyframe) => animationEffectSameTime(keyframe.time, time)));
          const writeSnapshot = (point: KeyframeDataPoint, channel: AnimationEffectChannel, snapshot: EffectPointSnapshot) => {
            point.extend(effectPointData(channel, snapshot));
          };

          operations.forEach((operation, index) => {
            const snappedTime = plannedTimes[index];
            if (operation.operation === "add") {
              const targetTime = snappedTime!;
              const snapshot = applyEffectPayload(operation.channel, { effect: "", locator: "", bind_to_actor: true, script: "", file: "" }, operation);
              const effects = ensureEffects();
              // Same-time collision parity with particle/sound: merge into
              // the existing keyframe instead of stacking silent duplicates.
              if (operation.channel === "timeline") {
                const existingTimeline = findRuntimeAtTime("timeline", targetTime)[0];
                if (existingTimeline) {
                  if (operation.script !== undefined) {
                    existingTimeline.data_points[0].script = operation.script;
                  }
                  results.push(animationEffectContinuationState("timeline", existingTimeline, null));
                  return;
                }
              }
              if (operation.channel !== "timeline") {
                const existingAtTime = findRuntimeAtTime(operation.channel, targetTime)[0];
                if (existingAtTime) {
                  const point = new KeyframeDataPoint(existingAtTime);
                  writeSnapshot(point, operation.channel, snapshot);
                  existingAtTime.data_points.push(point);
                  results.push(animationEffectContinuationState(operation.channel, existingAtTime, existingAtTime.data_points.length - 1));
                  return;
                }
              }
              const keyframe = effects.addKeyframe({ channel: operation.channel, time: targetTime, data_points: [effectPointData(operation.channel, snapshot)] });
              if (!keyframe) throw new Error(`Could not create ${operation.channel} effect keyframe.`);
              results.push(animationEffectContinuationState(operation.channel, keyframe, operation.channel === "timeline" ? null : 0));
              return;
            }

            const keyframe = findRuntimeKeyframe(operation.channel, operation.keyframe_uuid!);
            if (operation.channel === "timeline") {
              if (operation.operation === "remove") {
                keyframe.remove();
                results.push({ channel: "timeline", removed: { keyframe_uuid: operation.keyframe_uuid!, data_point_index: null } });
                return;
              }
              if (snappedTime !== undefined) keyframe.time = snappedTime;
              if (operation.script !== undefined) keyframe.data_points[0].script = operation.script;
              results.push(animationEffectContinuationState("timeline", keyframe, null));
              return;
            }

            const inspectedPoint = realPoints.get(`${operation.keyframe_uuid}:${operation.data_point_index}`);
            const runtimeIndex = inspectedPoint ? keyframe.data_points.indexOf(inspectedPoint) : -1;
            if (runtimeIndex < 0) throw new Error(`Preflight/runtime mismatch: ${operation.channel} data point moved or disappeared.`);
            const point = keyframe.data_points[runtimeIndex];
            if (operation.operation === "remove") {
              const removedKeyframe = keyframe.data_points.length === 1;
              if (removedKeyframe) keyframe.remove();
              else keyframe.data_points.splice(runtimeIndex, 1);
              // Positional indices of surviving sibling points shift after a
              // remove; publish the remap so later calls cannot silently
              // retarget a stale data_point_index onto a different effect.
              const remainingEffects = removedKeyframe ? [] : keyframe.data_points.map((candidate) => {
                const snapshot = effectPointSnapshot(candidate);
                return { effect: snapshot.effect ?? "", script: snapshot.script ?? "" };
              });
              results.push({
                channel: operation.channel,
                removed: {
                  keyframe_uuid: operation.keyframe_uuid!,
                  data_point_index: operation.data_point_index!,
                  remaining: remainingEffects,
                },
              });
              return;
            }

            const next = applyEffectPayload(operation.channel, effectPointSnapshot(point), operation);
            if (snappedTime !== undefined && !animationEffectSameTime(snappedTime, keyframe.time)) {
              if (keyframe.data_points.length === 1) keyframe.remove();
              else keyframe.data_points.splice(runtimeIndex, 1);
              const moved = ensureEffects().addKeyframe({ channel: operation.channel, time: snappedTime, data_points: [effectPointData(operation.channel, next)] });
              if (!moved) throw new Error(`Could not move ${operation.channel} effect data point.`);
              results.push(animationEffectContinuationState(operation.channel, moved, 0));
            } else {
              writeSnapshot(point, operation.channel, next);
              results.push(animationEffectContinuationState(operation.channel, keyframe, keyframe.data_points.indexOf(point)));
            }
          });

          animation.setLength();
          Undo.finishEdit("Manage animation effects");
          recordCurrentCapabilitySemanticHistoryEffect("manage_animation_effects");
        } catch (error) {
          Undo.cancelEdit(true);
          Animator.preview();
          updateKeyframeSelection();
          throw error;
        }

        Animator.preview();
        const result = animationEffectsReceipt({
          animation: { uuid: animation.uuid, name: animation.name },
          operation_count: operations.length,
          results,
        });
        return {
          content: [{ type: "text" as const, text: `Managed ${operations.length} animation effect operation(s).` }],
          structuredContent: result,
        };
      },
    },
    animationEffectToolDocs[0].status
  );
}