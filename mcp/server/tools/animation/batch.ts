/// <reference types="three" />
/// <reference types="blockbench-types" />

import {
  countAnimationClipboardKeyframes,
  keyframeBelongsToAnimation,
  planMirroredBatchKeyframes,
  planSmoothedBatchKeyframes,
  planBatchScaleOverwriteTargets,
  requireValidPlannedBatchTrackTimes,
  requireValidPlannedKeyframeTimes,
  requireValidPlannedPasteChannelTimes,
  reverseBatchTimeBounds,
  selectBatchKeyframes,
} from "@/lib/animation/batchPlanning";
export {
  countAnimationClipboardKeyframes,
  keyframeBelongsToAnimation,
  planMirroredBatchKeyframes,
  planSmoothedBatchKeyframes,
  planBatchScaleOverwriteTargets,
  requireValidPlannedBatchTrackTimes,
  requireValidPlannedKeyframeTimes,
  requireValidPlannedPasteChannelTimes,
  reverseBatchTimeBounds,
  selectBatchKeyframes,
} from "@/lib/animation/batchPlanning";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import {
  animationCopyPasteParameters,
  batchKeyframeOperationsParameters,
} from "./batchSchema";
export {
  animationCopyPasteParameters,
  batchKeyframeOperationsParameters,
} from "./batchSchema";
import {
  resolveAnimationClip as resolveAnimation,
  resolveAnimationRigGroup as resolveRigGroup,
  toArrayVector3,
} from "./shared";

export const batchKeyframeOperationsToolDoc: ToolSpec = {
  name: "batch_keyframe_operations",
  description:
    "Applies one bounded batch operation to selected, ranged, patterned, or all keyframes.",
  annotations: {
    title: "Batch Keyframe Operations",
    destructiveHint: true,
  },
  parameters: batchKeyframeOperationsParameters,
  status: STATUS_EXPERIMENTAL,
};

export const animationCopyPasteToolDoc: ToolSpec = {
  name: "animation_copy_paste",
  description:
    "Copies, pastes, or mirrors keyframes between animation bones. Copy/paste targets must be explicit; mirror_paste requires an axis.",
  annotations: {
    title: "Animation Copy/Paste",
    destructiveHint: true,
  },
  parameters: animationCopyPasteParameters,
  status: STATUS_EXPERIMENTAL,
};

export function registerAnimationBatchTools(): void {
  createTool(
    batchKeyframeOperationsToolDoc.name,
    {
      ...batchKeyframeOperationsToolDoc,
      parameters: batchKeyframeOperationsParameters,
      async execute({ selection, range, pattern, operation, parameters = {} }) {
        const animation = resolveAnimation();
        const targetTimelineKeyframes = Object.values(animation.animators).flatMap(animator => animator.keyframes).filter(
          (kf) => keyframeBelongsToAnimation(kf, animation)
        );
        const targetSelectedKeyframes = (Timeline.selected as _Keyframe[]).filter(
          (kf) => keyframeBelongsToAnimation(kf, animation)
        );
  
        const keyframes = selectBatchKeyframes(
          targetTimelineKeyframes,
          targetSelectedKeyframes,
          selection,
          {
            ...(range ? { range } : {}),
            ...(pattern ? { pattern } : {}),
          }
        );
  
        if (operation === "mirror" && !parameters.mirror_axis) {
          throw new Error("Mirror axis required for mirror operation.");
        }
  
        if (operation === "offset" || operation === "mirror") {
          const movesTime =
            operation === "offset" && (parameters.offset_time ?? 0) !== 0;
          const replacedKeyframes: _Keyframe[] = [];
          const mirrorKeyframes =
            operation === "mirror"
              ? planMirroredBatchKeyframes(keyframes)
              : [];
          if (operation === "offset" && parameters.offset_time !== undefined) {
            requireValidPlannedKeyframeTimes(
              keyframes.map(
                (keyframe: _Keyframe) => keyframe.time + parameters.offset_time!
              ),
              "Batch keyframe offset"
            );
          }
  
          Undo.initEdit({
            keyframes: operation === "mirror" ? mirrorKeyframes : keyframes,
          });
  
          try {
            if (operation === "offset") {
              keyframes.forEach((kf: _Keyframe) => {
                if (parameters.offset_time !== undefined) {
                  kf.time += parameters.offset_time;
                }
  
                if (parameters.offset_values && kf.transform) {
                  const [offsetX, offsetY, offsetZ] = parameters.offset_values;
                  const offsetsMatch = offsetX === offsetY && offsetX === offsetZ;
  
                  if (kf.uniform && !offsetsMatch) {
                    kf.uniform = false;
                  }
  
                  if (kf.uniform) {
                    kf.offset("x", offsetX);
                  } else {
                    kf.offset("x", offsetX);
                    kf.offset("y", offsetY);
                    kf.offset("z", offsetZ);
                  }
                }
              });
  
              if (movesTime) {
                keyframes.forEach((kf: _Keyframe) => {
                  kf.replaceOthers(replacedKeyframes);
                });
                Undo.addKeyframeCasualties(replacedKeyframes);
                animation.setLength();
              }
            } else {
              const mirrorAxis = parameters.mirror_axis!;
              const mirrorAxisIndex =
                mirrorAxis === "x" ? 0 : mirrorAxis === "y" ? 1 : 2;
              mirrorKeyframes.forEach((kf: _Keyframe) => {
                // blockbench-types@5.1.0 declares axisLetter, while the runtime Keyframe.flip contract uses numeric indexes.
                // @ts-expect-error Runtime Blockbench expects 0|1|2 here.
                kf.flip(mirrorAxisIndex);
              });
            }
  
            Undo.finishEdit(`Batch keyframe operation: ${operation}`);
            recordCurrentCapabilitySemanticHistoryEffect("batch_keyframe_operations");
          } catch (error) {
            Undo.cancelEdit(true);
            Animator.preview();
            updateKeyframeSelection();
            throw error;
          }
  
          Animator.preview();
          if (operation === "offset") {
            const result = {
              operation,
              source_keyframes: keyframes.length,
              overwritten_keyframes: replacedKeyframes.length,
            };
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Offset updated ${keyframes.length} keyframe(s) and overwrote ${replacedKeyframes.length} existing keyframe(s).`,
                },
              ],
              structuredContent: result,
            };
          }
          return `Mirrored ${mirrorKeyframes.length} transform keyframe(s) across ${parameters.mirror_axis} axis`;
        }
  
        if (operation === "bake") {
          const interval =
            parameters.bake_interval ?? 1 / animation.snapping;
          if (!Number.isFinite(interval) || interval <= 0) {
            throw new Error(
              "Bake interval must be a finite number greater than 0."
            );
          }
  
          const originalTimelineTime = Timeline.time;
          const animators = new Set(keyframes.map((kf) => kf.animator));
          const bakeSamples: Array<{
            animator: any;
            channel: string;
            time: number;
            values: any[];
          }> = [];
          let editStarted = false;
  
          try {
            animators.forEach((animator: any) => {
              const channels = ["rotation", "position", "scale"];
              channels.forEach((channel) => {
                const channelKfs = animator[channel];
                const selectedKfs = keyframes.filter((kf) => kf.animator === animator && kf.channel === channel);
                if (!channelKfs || selectedKfs.length < 2) return;
  
                const startTime = Math.min(...selectedKfs.map((kf: _Keyframe) => kf.time));
                const endTime = Math.max(...selectedKfs.map((kf: _Keyframe) => kf.time));
  
                for (let time = startTime; time <= endTime; time += interval) {
                  const targetTime = Timeline.snapTime(time, animation);
                  if (targetTime < startTime || targetTime > endTime) continue;
                  const alreadyExists = channelKfs.some(
                    (kf: _Keyframe) => Math.abs(kf.time - targetTime) < 0.001
                  );
                  const alreadyPlanned = bakeSamples.some(
                    (sample) =>
                      sample.animator === animator &&
                      sample.channel === channel &&
                      Math.abs(sample.time - targetTime) < 0.001
                  );
                  if (alreadyExists || alreadyPlanned) continue;
  
                  Timeline.time = targetTime;
                  const values = animator.interpolate(channel, true);
                  if (!Array.isArray(values) || values.length < 3 ||
                      !values.slice(0, 3).every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
                    throw new Error(
                      `Could not sample ${channel} values while baking animation.`
                    );
                  }
                  bakeSamples.push({
                    animator,
                    channel,
                    time: targetTime,
                    values: [...values],
                  });
                }
              });
            });
  
            Timeline.time = originalTimelineTime;
  
            if (bakeSamples.length) {
              Undo.initEdit({
                animations: [animation],
              });
              editStarted = true;
  
              bakeSamples.forEach((sample) => {
                const keyframe = sample.animator.addKeyframe({
                  channel: sample.channel,
                  time: sample.time,
                  interpolation: "linear",
                  data_points: [
                    {
                      x: sample.values[0],
                      y: sample.values[1],
                      z: sample.values[2],
                    },
                  ],
                });
                if (!keyframe) {
                  throw new Error(
                    `Channel "${sample.channel}" is unavailable while baking animation.`
                  );
                }
              });
  
              animation.setLength();
              Undo.finishEdit("Batch keyframe operation: bake");
              recordCurrentCapabilitySemanticHistoryEffect("batch_keyframe_operations");
              editStarted = false;
            }
          } catch (error) {
            if (editStarted) {
              Undo.cancelEdit(true);
            }
            throw error;
          } finally {
            Timeline.time = originalTimelineTime;
            Animator.preview();
            updateKeyframeSelection();
          }
  
          const result = {
            operation,
            source_keyframes: keyframes.length,
            created_keyframes: bakeSamples.length,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Bake used ${keyframes.length} source keyframe(s) and created ${bakeSamples.length} new keyframe(s).`,
              },
            ],
            structuredContent: result,
          };
        }
  
        if (operation === "scale") {
          const pivot = parameters.scale_pivot ?? 0;
          const factor = parameters.scale_factor ?? 1;
          if (!Number.isFinite(pivot)) {
            throw new Error("Scale pivot must be a finite number.");
          }
          if (!Number.isFinite(factor)) {
            throw new Error("Scale factor must be a finite number.");
          }
  
          const stretchStates = keyframes.map((keyframe: _Keyframe) => ({
            keyframe,
            time: keyframe.time,
            bezierLeftTime:
              keyframe.interpolation === "bezier"
                ? [...keyframe.bezier_left_time]
                : undefined,
            bezierRightTime:
              keyframe.interpolation === "bezier"
                ? [...keyframe.bezier_right_time]
                : undefined,
          }));
          const plannedTimes = stretchStates.map(({ time }) =>
            Timeline.snapTime(pivot + (time - pivot) * factor, animation)
          );
          requireValidPlannedBatchTrackTimes(
            stretchStates.map(({ keyframe }) => keyframe),
            plannedTimes,
            "Batch keyframe scale",
          );
          // Native replaceOthers can remove unselected keyframes. Full-animation
          // Undo already covers these; do not add a duplicate casualty hook.
          const expectedOverwrites = planBatchScaleOverwriteTargets(
            keyframes, targetTimelineKeyframes, plannedTimes
          );
          const replacedKeyframes: _Keyframe[] = [];
  
          Undo.initEdit({
            animations: [animation],
          });
  
          try {
            stretchStates.forEach(
              ({ keyframe, bezierLeftTime, bezierRightTime }, index) => {
                keyframe.time = plannedTimes[index];
  
                if (bezierLeftTime && bezierRightTime) {
                  for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
                    keyframe.bezier_left_time[axisIndex] =
                      bezierLeftTime[axisIndex] * factor;
                    keyframe.bezier_right_time[axisIndex] =
                      bezierRightTime[axisIndex] * factor;
                  }
                }
              }
            );
  
            stretchStates.forEach(({ keyframe }) => {
              keyframe.replaceOthers(replacedKeyframes);
            });
            const actualOverwrites = new Set(replacedKeyframes);
            if (
              actualOverwrites.size !== expectedOverwrites.length ||
              replacedKeyframes.length !== expectedOverwrites.length ||
              expectedOverwrites.some(keyframe => !actualOverwrites.has(keyframe))
            ) {
              throw new Error(
                "Batch keyframe scale native overwrite identities differed from preflight; cancelling the full animation edit."
              );
            }
  
            animation.setLength();
            Undo.finishEdit("Batch keyframe operation: scale");
            recordCurrentCapabilitySemanticHistoryEffect("batch_keyframe_operations");
          } catch (error) {
            Undo.cancelEdit(true);
            Animator.preview();
            updateKeyframeSelection();
            throw error;
          }
  
          Animator.preview();
          updateKeyframeSelection();
          const result = {
            operation,
            source_keyframes: keyframes.length,
            overwritten_keyframes: replacedKeyframes.length,
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Scale moved ${keyframes.length} keyframe(s) and overwrote ${replacedKeyframes.length} existing keyframe(s).`,
              },
            ],
            structuredContent: result,
          };
        }
  
        if (operation === "reverse") {
          const { start: startTime, end: endTime } =
            reverseBatchTimeBounds(keyframes.map((kf: _Keyframe) => kf.time));
  
          Undo.initEdit({
            keyframes,
          });
  
          try {
            keyframes.forEach((kf: _Keyframe) => {
              kf.time = endTime + startTime - kf.time;
  
              if (kf.transform && kf.data_points.length > 1) {
                kf.data_points.reverse();
              }
  
              if (kf.interpolation === "bezier") {
                const rightTime = [...kf.bezier_right_time];
                const rightValue = [...kf.bezier_right_value];
                const leftTime = [...kf.bezier_left_time];
                const leftValue = [...kf.bezier_left_value];
  
                for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
                  kf.bezier_right_time[axisIndex] = -leftTime[axisIndex];
                  kf.bezier_right_value[axisIndex] = leftValue[axisIndex];
                  kf.bezier_left_time[axisIndex] = -rightTime[axisIndex];
                  kf.bezier_left_value[axisIndex] = rightValue[axisIndex];
                }
              }
            });
  
            Undo.finishEdit("Batch keyframe operation: reverse");
            recordCurrentCapabilitySemanticHistoryEffect("batch_keyframe_operations");
          } catch (error) {
            Undo.cancelEdit(true);
            Animator.preview();
            updateKeyframeSelection();
            throw error;
          }
  
          Animator.preview();
          updateKeyframeSelection();
          return `Performed ${operation} on ${keyframes.length} keyframes`;
        }
  
        if (operation === "smooth") {
          const transformKeyframes =
            planSmoothedBatchKeyframes(keyframes);
  
          Undo.initEdit({
            keyframes: transformKeyframes,
          });
  
          try {
            transformKeyframes.forEach((kf: _Keyframe) => {
              kf.interpolation = "catmullrom";
            });
            Undo.finishEdit("Batch keyframe operation: smooth");
            recordCurrentCapabilitySemanticHistoryEffect("batch_keyframe_operations");
          } catch (error) {
            Undo.cancelEdit(true);
            Animator.preview();
            updateKeyframeSelection();
            throw error;
          }
  
          Animator.preview();
          updateKeyframeSelection();
          return `Performed ${operation} on ${transformKeyframes.length} transform keyframes`;
        }
  
        throw new Error(`Unsupported batch keyframe operation: ${operation}`);
      },
    },
    batchKeyframeOperationsToolDoc.status
  );

  createTool(
    animationCopyPasteToolDoc.name,
    {
      ...animationCopyPasteToolDoc,
      parameters: animationCopyPasteParameters,
      async execute({ action, source, target }) {
        // @ts-ignore
        if (!global.animationClipboard) {
          // @ts-ignore
          global.animationClipboard = null;
        }
  
        switch (action) {
          case "copy": {
            if (!source) {
              throw new Error("Source data required for copy operation.");
            }
  
            const srcAnimation = resolveAnimation(source.animation);
            const srcBone = resolveRigGroup(source.bone);
  
            const animator = srcAnimation.animators[srcBone.uuid];
            if (!animator) {
              throw new Error(`No animation data for bone "${source.bone}".`);
            }
  
            const copiedData: any = {
              bone_name: source.bone,
              channels: {},
            };
  
            source.channels.forEach((channel) => {
              if (!animator[channel]) return;
  
              let keyframes = animator[channel] as _Keyframe[];
              const timeRange = source.time_range;
              if (timeRange) {
                keyframes = keyframes.filter(
                  (kf: _Keyframe) =>
                    kf.time >= timeRange.start &&
                    kf.time <= timeRange.end
                );
              }
  
              copiedData.channels[channel] = keyframes.map((kf: _Keyframe) => ({
                time: kf.time,
                data_points: kf.data_points.map((_, dataPointIndex) => {
                  const [x, y, z] = kf.getArray(dataPointIndex);
                  return { x, y, z };
                }),
                interpolation: kf.interpolation,
                ...(channel === "scale" ? { uniform: kf.uniform === true } : {}),
                ...(kf.interpolation === "bezier"
                  ? { bezier_linked: kf.bezier_linked === true }
                  : {}),
                // @ts-ignore
                bezier_left_time: toArrayVector3(kf.bezier_left_time),
                // @ts-ignore
                bezier_left_value: toArrayVector3(kf.bezier_left_value),
                // @ts-ignore
                bezier_right_time: toArrayVector3(kf.bezier_right_time),
                // @ts-ignore
                bezier_right_value: toArrayVector3(kf.bezier_right_value),
              }));
            });
  
            const copiedKeyframeCount = countAnimationClipboardKeyframes(
              copiedData.channels
            );
            if (copiedKeyframeCount === 0) {
              throw new Error(
                `No keyframes matched the requested channels/time range for "${source.bone}". Clipboard was not changed.`
              );
            }
  
            // @ts-ignore
            global.animationClipboard = copiedData;

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Copied animation data from "${source.bone}" (${Object.keys(
                    copiedData.channels
                  ).join(", ")}).`,
                },
              ],
              structuredContent: {
                action: "copy",
                scope: "animation_clipboard_only",
                source: {
                  animation: { uuid: srcAnimation.uuid, name: srcAnimation.name },
                  bone: { uuid: srcBone.uuid, name: srcBone.name },
                  channels: Object.keys(copiedData.channels),
                },
                copied_keyframes: copiedKeyframeCount,
              },
            };
          }
  
          case "paste":
          case "mirror_paste": {
            if (!target) {
              throw new Error("Target data required for paste operation.");
            }
  
            // @ts-ignore
            if (!global.animationClipboard) {
              throw new Error("No animation data in clipboard. Copy first.");
            }
  
            const tgtAnimation = resolveAnimation(target.animation);
            const tgtBone = resolveRigGroup(target.bone);
            const existingAnimator = tgtAnimation.animators[tgtBone.uuid] as BoneAnimator | undefined;
  
            // @ts-ignore
            const clipboardData = global.animationClipboard;
            const pastedKeyframeCount = countAnimationClipboardKeyframes(
              clipboardData.channels
            );
            if (pastedKeyframeCount === 0) {
              throw new Error(
                "Animation clipboard contains no keyframe data. Copy a non-empty animation range first."
              );
            }
            const mirrorAxis =
              action === "mirror_paste" ? target.mirror_axis! : null;
            const mirrorAxisIndex = mirrorAxis === "x" ? 0 : mirrorAxis === "y" ? 1 : mirrorAxis === "z" ? 2 : null;
            const timeOffset = target.time_offset ?? 0;
            const plannedPasteTimesByChannel = Object.fromEntries(
              Object.entries(
                clipboardData.channels as Record<string, Array<{ time: number }>>
              ).map(([channel, channelKeyframes]) => [
                channel,
                channelKeyframes.map((keyframe) =>
                  Timeline.snapTime(keyframe.time + timeOffset, tgtAnimation)
                ),
              ])
            ) as Record<string, number[]>;
            requireValidPlannedPasteChannelTimes(plannedPasteTimesByChannel);
            const replacedKeyframes: _Keyframe[] = [];
  
            Undo.initEdit({
              animations: [tgtAnimation],
            });
  
            try {
              let animator = existingAnimator;
              if (!animator) {
                const createdAnimator = tgtAnimation.getBoneAnimator(tgtBone);
                if (!createdAnimator) {
                  throw new Error(
                    `Cannot paste animation data into Group "${tgtBone.name}" in animation "${tgtAnimation.name}".`
                  );
                }
                animator = createdAnimator;
              }
  
              Object.entries(clipboardData.channels as Record<string, any[]>).forEach(
                ([channel, keyframes]: [string, any[]]) => {
                  keyframes.forEach((kfData, index) => {
                    const dataPoints = kfData.data_points.map(
                      (point: { x: number | string; y: number | string; z: number | string }) => ({
                        x: point.x,
                        y: point.y,
                        z: point.z,
                      })
                    );
                    const targetTime = plannedPasteTimesByChannel[channel][index];
  
                    const keyframe = animator!.addKeyframe({
                      channel,
                      data_points: dataPoints,
                      time: targetTime,
                      interpolation: kfData.interpolation,
                      ...(channel === "scale" &&
                      typeof kfData.uniform === "boolean"
                        ? { uniform: kfData.uniform }
                        : {}),
                      ...(kfData.interpolation === "bezier" &&
                      typeof kfData.bezier_linked === "boolean"
                        ? { bezier_linked: kfData.bezier_linked }
                        : {}),
                    });
                    if (!keyframe) {
                      throw new Error(
                        `Channel "${channel}" is unavailable for ${tgtBone.name}.`
                      );
                    }
                    keyframe.replaceOthers(replacedKeyframes);
  
                    if (kfData.interpolation === "bezier") {
                      // @ts-ignore
                      if (kfData.bezier_left_time !== undefined)
                        keyframe.bezier_left_time = [...kfData.bezier_left_time] as ArrayVector3;
                      // @ts-ignore
                      if (kfData.bezier_left_value)
                        keyframe.bezier_left_value = [...kfData.bezier_left_value] as ArrayVector3;
                      // @ts-ignore
                      if (kfData.bezier_right_time !== undefined)
                        keyframe.bezier_right_time = [...kfData.bezier_right_time] as ArrayVector3;
                      // @ts-ignore
                      if (kfData.bezier_right_value)
                        keyframe.bezier_right_value = [...kfData.bezier_right_value] as ArrayVector3;
                    }
  
                    if (mirrorAxisIndex !== null) {
                      // blockbench-types@5.1.0 declares axisLetter, while the runtime Keyframe.flip contract uses numeric indexes.
                      // @ts-expect-error Runtime Blockbench expects 0|1|2 here.
                      keyframe.flip(mirrorAxisIndex);
                    }
                  });
                }
              );
  
              tgtAnimation.setLength();
              Undo.finishEdit(`${action} animation data`);
              recordCurrentCapabilitySemanticHistoryEffect("animation_copy_paste");
            } catch (error) {
              Undo.cancelEdit(true);
              Animator.preview();
              updateKeyframeSelection();
              throw error;
            }
  
            Animator.preview();
  
            const result = {
              action,
              pasted_keyframes: pastedKeyframeCount,
              overwritten_keyframes: replacedKeyframes.length,
            };
            return {
              content: [
                {
                  type: "text" as const,
                  text: `${action === "mirror_paste" ? "Mirrored paste" : "Paste"} wrote ${pastedKeyframeCount} keyframe(s) to "${tgtBone.name}" and overwrote ${replacedKeyframes.length} existing keyframe(s).`,
                },
              ],
              structuredContent: result,
            };
          }
        }
      },
    },
    animationCopyPasteToolDoc.status
  );
}