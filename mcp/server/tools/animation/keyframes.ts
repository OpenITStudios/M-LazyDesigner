/// <reference types="three" />
/// <reference types="blockbench-types" />

import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { resolveUniqueKeyframeMatchIndexes } from "@/lib/animation/keyframeMatching";
export { resolveUniqueKeyframeMatchIndexes } from "@/lib/animation/keyframeMatching";
import {
  animationGraphEditorParameters,
  manageKeyframesParameters,
} from "./keyframeSchema";
export {
  animationGraphEditorParameters,
  manageKeyframesParameters,
} from "./keyframeSchema";
import {
  resolveAnimationClip as resolveAnimation,
  resolveAnimationRigGroup as resolveRigGroup,
  toArrayVector3,
} from "./shared";
import { requireValidPlannedKeyframeTimes } from "../animation-batch";

export const manageKeyframesToolDoc: ToolSpec = {
  name: "manage_keyframes",
  description:
    "Creates, edits, deletes, or selects keyframes for one animation bone and channel. Numeric and authored Molang values are preserved.",
  annotations: {
    title: "Manage Keyframes",
    destructiveHint: true,
  },
  parameters: manageKeyframesParameters,
  status: STATUS_EXPERIMENTAL,
};

export const animationGraphEditorToolDoc: ToolSpec = {
  name: "animation_graph_editor",
  description:
    "Applies a curve/interpolation edit to one animation bone channel.",
  annotations: {
    title: "Animation Graph Editor",
    destructiveHint: true,
  },
  parameters: animationGraphEditorParameters,
  status: STATUS_EXPERIMENTAL,
};

function keyframeContinuationState(keyframe: BBKeyframe) {
  return {
    uuid: keyframe.uuid,
    time: keyframe.time,
    interpolation: keyframe.interpolation,
  };
}

export function registerAnimationKeyframeTools(): void {
  createTool(
    manageKeyframesToolDoc.name,
    {
      ...manageKeyframesToolDoc,
      parameters: manageKeyframesParameters,
      async execute({ animation_id, action, bone_name, channel, keyframes }) {
        const animation = resolveAnimation(animation_id);
        const group = resolveRigGroup(bone_name);
        const existingAnimator = animation.animators[group.uuid] as BoneAnimator | undefined;
        const buildResult = (
          affectedKeyframes: Array<ReturnType<typeof keyframeContinuationState>>,
          overwrittenKeyframeCount = 0
        ) => {
          const result = {
            action,
            animation: { uuid: animation.uuid, name: animation.name },
            bone: { uuid: group.uuid, name: group.name },
            channel,
            affected_count: affectedKeyframes.length,
            affected_keyframes: affectedKeyframes,
            ...(overwrittenKeyframeCount > 0
              ? { overwritten_keyframes: overwrittenKeyframeCount }
              : {}),
          };
          return {
            content: [
              {
                type: "text" as const,
                text:
                  overwrittenKeyframeCount > 0
                    ? `${action} affected ${affectedKeyframes.length} keyframe(s) for ${group.name}.${channel}, replacing ${overwrittenKeyframeCount} coincident keyframe(s).`
                    : `${action} affected ${affectedKeyframes.length} keyframe(s) for ${group.name}.${channel}.`,
              },
            ],
            structuredContent: result,
          };
        };
  
        const applyValues = (
          keyframe: BBKeyframe,
          values: number | string | Array<number | string> | undefined
        ) => {
          if (values === undefined) return;
          if (typeof values === "number" || typeof values === "string") {
            keyframe.uniform = true;
            keyframe.set("x", values);
          } else {
            keyframe.uniform = false;
            keyframe.set("x", values[0]);
            keyframe.set("y", values[1]);
            keyframe.set("z", values[2]);
          }
        };
  
        const resolveRequestedTargets = (): BBKeyframe[] => {
          if (!existingAnimator || !existingAnimator[channel]?.length) {
            throw new Error(`No keyframes found for ${group.name}.${channel}`);
          }
          const channelKeyframes = existingAnimator[channel] as BBKeyframe[];
          const matchedIndexes = resolveUniqueKeyframeMatchIndexes(
            channelKeyframes.map((keyframe) => keyframe.time),
            keyframes.map((keyframe) => keyframe.time)
          );
          return matchedIndexes.map((index) => channelKeyframes[index]);
        };
  
        if (action === "select") {
          if (animation !== AnimationItem.selected) {
            throw new Error(
              `Cannot select keyframes from animation "${animation.name}" because it is not the selected Blockbench animation.`
            );
          }
          const targetKeyframes = resolveRequestedTargets();
  
          Undo.initSelection({ timeline: true });
          try {
            Timeline.unselect();
            existingAnimator!.select();
            targetKeyframes.forEach((keyframe) => {
              keyframe.selected = true;
              if (!Timeline.selected.includes(keyframe)) {
                Timeline.selected.push(keyframe);
              }
            });
            updateKeyframeSelection();
            Undo.finishSelection("Select keyframes");
          } catch (error) {
            Undo.cancelSelection(true);
            updateKeyframeSelection();
            throw error;
          }
  
          Animator.preview();
          return buildResult(targetKeyframes.map(keyframeContinuationState));
        }
  
        const plannedCreateTimes =
          action === "create"
            ? keyframes.map((keyframe) => Timeline.snapTime(keyframe.time, animation))
            : [];
        if (action === "create") {
          requireValidPlannedKeyframeTimes(
            plannedCreateTimes,
            "manage_keyframes create",
            true
          );
        }
        const targetKeyframes = action === "create" ? [] : resolveRequestedTargets();
        let affectedKeyframes =
          action === "delete" ? targetKeyframes.map(keyframeContinuationState) : [];
        const createCasualties: BBKeyframe[] = [];
  
        Undo.initEdit({
          animations: [animation],
        });
  
        try {
          let animator = existingAnimator;
          if (!animator) {
            const createdAnimator = animation.getBoneAnimator(group);
            if (!createdAnimator) {
              throw new Error(
                `Cannot create animation data for Group "${group.name}" in animation "${animation.name}".`
              );
            }
            animator = createdAnimator;
          }
          const createdKeyframes: BBKeyframe[] = [];
  
          switch (action) {
            case "create":
              keyframes.forEach((kf, index) => {
                const keyframe = animator!.addKeyframe({
                  channel,
                  data_points: [{}],
                  time: plannedCreateTimes[index],
                  interpolation: kf.interpolation ?? "linear",
                });
                if (!keyframe) {
                  throw new Error(`Channel "${channel}" is unavailable for ${group.name}.`);
                }
                applyValues(keyframe, kf.values);
                // Collect same-time casualties so the create receipt reports
                // what native replace semantics evicted.
                keyframe.replaceOthers(createCasualties);
  
                if (kf.interpolation === "bezier" && kf.bezier_handles) {
                  // @ts-ignore
                  if (kf.bezier_handles.left_time !== undefined)
                    keyframe.bezier_left_time = toArrayVector3(kf.bezier_handles.left_time);
                  // @ts-ignore
                  if (kf.bezier_handles.left_value)
                    keyframe.bezier_left_value = toArrayVector3(kf.bezier_handles.left_value);
                  // @ts-ignore
                  if (kf.bezier_handles.right_time !== undefined)
                    keyframe.bezier_right_time = toArrayVector3(kf.bezier_handles.right_time);
                  // @ts-ignore
                  if (kf.bezier_handles.right_value)
                    keyframe.bezier_right_value = toArrayVector3(kf.bezier_handles.right_value);
                }
                createdKeyframes.push(keyframe);
              });
              animation.setLength();
              affectedKeyframes = createdKeyframes.map(keyframeContinuationState);
              break;
  
            case "delete":
              targetKeyframes.forEach((keyframe) => keyframe.remove());
              break;
  
            case "edit":
              keyframes.forEach((kf, index) => {
                const keyframe = targetKeyframes[index];
                applyValues(keyframe, kf.values);
                  if (kf.interpolation) {
                    keyframe.interpolation = kf.interpolation;
                  }
                  if (kf.interpolation === "bezier" && kf.bezier_handles) {
                    // @ts-ignore
                    if (kf.bezier_handles.left_time !== undefined)
                      keyframe.bezier_left_time = toArrayVector3(kf.bezier_handles.left_time);
                    // @ts-ignore
                    if (kf.bezier_handles.left_value)
                      keyframe.bezier_left_value = toArrayVector3(kf.bezier_handles.left_value);
                    // @ts-ignore
                    if (kf.bezier_handles.right_time !== undefined)
                      keyframe.bezier_right_time = toArrayVector3(kf.bezier_handles.right_time);
                    // @ts-ignore
                    if (kf.bezier_handles.right_value)
                      keyframe.bezier_right_value = toArrayVector3(kf.bezier_handles.right_value);
                  }
              });
              affectedKeyframes = targetKeyframes.map(keyframeContinuationState);
              break;
          }
  
          Undo.finishEdit(`${action} keyframes`);
          recordCurrentCapabilitySemanticHistoryEffect("manage_keyframes");
        } catch (error) {
          Undo.cancelEdit(true);
          Animator.preview();
          updateKeyframeSelection();
          throw error;
        }
  
        Animator.preview();
        return buildResult(affectedKeyframes, createCasualties.length);
      },
    },
    manageKeyframesToolDoc.status
  );

  createTool(
    animationGraphEditorToolDoc.name,
    {
      ...animationGraphEditorToolDoc,
      parameters: animationGraphEditorParameters,
      async execute({
        animation_id,
        bone_name,
        channel,
        axis,
        action,
        keyframe_range,
        custom_curve,
      }) {
        const animation = resolveAnimation(animation_id);
        const group = resolveRigGroup(bone_name);
  
        const animator = animation.animators[group.uuid];
        if (!animator || !animator[channel]?.length) {
          throw new Error(`No keyframes found for ${group.name}.${channel}`);
        }
        if (action === "custom") {
          if (!custom_curve) {
            throw new Error("custom_curve is required for 'custom' action.");
          }
          if (custom_curve.control_point_1[0] > 0) {
            throw new Error(
              "custom_curve.control_point_1 is the left Bezier handle and its time offset must be <= 0."
            );
          }
          if (custom_curve.control_point_2[0] < 0) {
            throw new Error(
              "custom_curve.control_point_2 is the right Bezier handle and its time offset must be >= 0."
            );
          }
        }
  
        const keyframes = (animator[channel] as BBKeyframe[]).filter((kf: BBKeyframe) => {
          if (!keyframe_range) return true;
          return kf.time >= keyframe_range.start && kf.time <= keyframe_range.end;
        });
        if (!keyframes.length) {
          throw new Error(`No keyframes found for ${group.name}.${channel} in the requested range.`);
        }
  
        const axisIndexes =
          axis === "all"
            ? [0, 1, 2]
            : [axis === "x" ? 0 : axis === "y" ? 1 : 2];
        const setBezierComponents = (
          keyframe: BBKeyframe,
          property:
            | "bezier_left_time"
            | "bezier_left_value"
            | "bezier_right_time"
            | "bezier_right_value",
          value: number
        ) => {
          const handle = keyframe[property] as number[];
          axisIndexes.forEach((axisIndex) => {
            handle[axisIndex] = value;
          });
        };
  
        Undo.initEdit({
          animations: [animation],
        });
  
        try {
          keyframes.forEach((kf: BBKeyframe, index: number) => {
            switch (action) {
              case "linear":
                kf.interpolation = "linear";
                break;
  
              case "stepped":
                kf.interpolation = "step";
                break;
  
              case "smooth":
                kf.interpolation = "catmullrom";
                break;
  
              case "ease_in":
              case "ease_out":
              case "ease_in_out": {
                kf.interpolation = "bezier";
                const next = keyframes[index + 1];
                if (!next) break;
  
                const duration = next.time - kf.time;
                setBezierComponents(kf, "bezier_left_time", 0);
                setBezierComponents(kf, "bezier_right_time", duration);
  
                if (action === "ease_in") {
                  setBezierComponents(
                    kf,
                    "bezier_right_time",
                    duration * 0.6
                  );
                } else if (action === "ease_out") {
                  setBezierComponents(
                    kf,
                    "bezier_left_time",
                    -duration * 0.4
                  );
                } else {
                  setBezierComponents(
                    kf,
                    "bezier_left_time",
                    -duration * 0.3
                  );
                  setBezierComponents(
                    kf,
                    "bezier_right_time",
                    duration * 0.7
                  );
                }
                break;
              }
  
              case "custom":
                kf.interpolation = "bezier";
                setBezierComponents(
                  kf,
                  "bezier_left_time",
                  custom_curve!.control_point_1[0]
                );
                setBezierComponents(
                  kf,
                  "bezier_left_value",
                  custom_curve!.control_point_1[1]
                );
                setBezierComponents(
                  kf,
                  "bezier_right_time",
                  custom_curve!.control_point_2[0]
                );
                setBezierComponents(
                  kf,
                  "bezier_right_value",
                  custom_curve!.control_point_2[1]
                );
                break;
            }
          });
  
          Undo.finishEdit("Modify animation curves");
          recordCurrentCapabilitySemanticHistoryEffect("animation_graph_editor");
        } catch (error) {
          Undo.cancelEdit(true);
          Animator.preview();
          updateKeyframeSelection();
          throw error;
        }
  
        Animator.preview();
        updateKeyframeSelection();
  
        const result = {
          action,
          animation: { uuid: animation.uuid, name: animation.name },
          bone: { uuid: group.uuid, name: group.name },
          channel,
          axis: axis ?? null,
          affected_count: keyframes.length,
          affected_keyframes: keyframes.map(keyframeContinuationState),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${action} curve to ${keyframes.length} keyframes in ${bone_name}.${channel}`,
            },
          ],
          structuredContent: result,
        };
      },
    },
    animationGraphEditorToolDoc.status
  );
}