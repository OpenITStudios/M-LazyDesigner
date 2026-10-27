/// <reference types="blockbench-types" />

import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { animationTimelineParameters } from "./timelineSchema";
export { animationTimelineParameters } from "./timelineSchema";
import {
  buildAnimationEasing,
  inspectAuthoredAnimationEasing,
} from "@/lib/animation/easing";
import {
  resolveAnimationClip,
  resolveAnimationRigGroup,
} from "./shared";
import { keyframeBelongsToAnimation } from "../animation-batch";

export const animationTimelineToolDoc: ToolSpec = {
  name: "animation_timeline",
  description:
    "Controls the explicit animation_id (or current clip when omitted). select/playback/time actions select that clip; property edits target it without changing selection. Returns affected UUID.",
  annotations: {
    title: "Animation Timeline",
    destructiveHint: true,
  },
  parameters: animationTimelineParameters,
  status: STATUS_EXPERIMENTAL,
};

export function normalizeAnimationMolangProperty(value: string | null): string {
  return value === null ? "" : value.trim().replace(/\n/g, "");
}

export function registerAnimationTimelineTool(): void {
  createTool(
    animationTimelineToolDoc.name,
    {
      ...animationTimelineToolDoc,
      parameters: animationTimelineParameters,
      async execute({ animation_id, action, time, length, fps, loop_mode, range, molang, bone_ids, easing }) {
        if (action === "delete" && !animation_id) throw new Error("Deleting a clip requires explicit animation_id.");
        const animation = resolveAnimationClip(animation_id);
        const timelineGroups = bone_ids?.map(resolveAnimationRigGroup);
        // Timeline is native global state. Resolve explicit identity before changing
        // selection; never let a different selected clip absorb the request.
        const timelineAction = ["select", "play", "pause", "stop", "set_time", "select_range", "expand_bones", "collapse_bones"].includes(action);
        if (timelineAction && AnimationItem.selected !== animation) {
          Timeline.pause();
          animation.select();
          if (AnimationItem.selected !== animation) {
            throw new Error(`Could not select animation "${animation.name}".`);
          }
        }
        const animationMolang = animation as BBAnimation & {
          anim_time_update?: string;
          blend_weight?: string;
        };
  
        const runPersistentAnimationEdit = (
          label: string,
          mutate: () => void
        ) => {
          Undo.initEdit({ animations: [animation] });
          try {
            mutate();
            Undo.finishEdit(label);
            recordCurrentCapabilitySemanticHistoryEffect("animation_timeline");
          } catch (error) {
            Undo.cancelEdit(true);
            Animator.preview();
            throw error;
          }
        };
  
        let result = "";
        let easingRefreshed = false;

        // Keep generated Molang timing in the SAME Undo transaction as the
        // duration/loop update. Exact script provenance is required:
        // caller-authored time expressions are never replaced automatically.
        const timingMutationRequested =
          action === "set_length" ||
          (action === "loop" && loop_mode !== animation.loop);
        const previousEasing = timingMutationRequested
          ? inspectAuthoredAnimationEasing(
              animation.uuid, animationMolang.anim_time_update || ""
            )
          : { state: "external" as const };
        if (previousEasing.state === "modified_generated") {
          throw new Error(
            "EASING_TIME_UPDATE_REQUIRES_REVIEW: generated easing was modified, " +
            "belongs to another clip, or has unknown provenance. Inspect or " +
            "explicitly clear anim_time_update before changing clip length/loop."
          );
        }
        const synchronizeEasing = () => {
          if (previousEasing.state !== "owned") return;
          if (typeof Format === "undefined" || Format.id !== "bedrock") {
            throw new Error("Easing time synchronization requires a Bedrock Entity project.");
          }
          const refreshed = buildAnimationEasing(
            animation.uuid, animation.length, animation.loop, {
              curve: previousEasing.curve,
              direction: previousEasing.direction,
              replace_existing: false,
            }
          );
          animation.extend({ anim_time_update: refreshed });
          easingRefreshed = true;
        };

        switch (action) {
          case "delete": {
            Timeline.pause();
            animation.remove(true, false);
            Animator.preview();
            recordCurrentCapabilitySemanticHistoryEffect("animation_timeline");
            return {
              content: [{ type: "text" as const, text: `Deleted animation "${animation.name}" from this project.` }],
              structuredContent: { action, deleted_animation_id: animation.uuid },
            };
          }
          case "set_easing": {
            if (typeof Format === "undefined" || Format.id !== "bedrock") {
              throw new Error("Easings supports only Minecraft Bedrock Entity (bedrock) projects.");
            }
            const previous = animationMolang.anim_time_update || "";
            if (previous && !easing!.replace_existing) {
              throw new Error("Animation already has anim_time_update; set replace_existing=true to replace it.");
            }
            const expression=buildAnimationEasing(animation.uuid,animation.length,animation.loop,easing!);
            if(expression===previous)throw new Error("Easing would not change this animation.");
            runPersistentAnimationEdit("Set whole-clip easing",()=>animation.extend({anim_time_update:expression}));
            Animator.preview();
            return {
              content:[{type:"text" as const,text:"Applied whole-clip easing. Timeline length/loop edits now synchronize exact managed easing; external editor changes still require reinspection."}],
              structuredContent:{action,animation_id:animation.uuid,anim_time_update:expression,previous_anim_time_update:previous||null,scope:"whole_clip_time"},
            };
          }
          case "expand_bones":
          case "collapse_bones": {
            const ids = new Set<string>();
            const visit = (group: Group) => {
              if (ids.has(group.uuid)) return;
              ids.add(group.uuid);
              group.children.forEach(child => { if (child instanceof Group) visit(child); });
            };
            timelineGroups!.forEach(visit);
            if (action === "expand_bones") {
              Object.values(animation.animators).forEach(animator => {
                if (ids.has(animator.uuid) && animator.keyframes.length) animator.addToTimeline();
              });
            } else {
              for (let i = Timeline.animators.length - 1; i >= 0; i--) {
                if (ids.has(Timeline.animators[i].uuid)) Timeline.animators.splice(i, 1);
              }
            }
            updateKeyframeSelection();
            return {
              content:[{type:"text" as const,text:`${action}: updated timeline visibility for ${ids.size} bone(s).`}],
              structuredContent:{action,bone_ids:[...ids],visible_animator_ids:Timeline.animators.map(a=>a.uuid),scope:"timeline_view_only"},
            };
          }
          case "select":
            result = `Selected animation "${animation.name}"`;
            break;
          case "play":
            Timeline.start();
            result = "Started animation playback";
            break;
  
          case "pause":
            Timeline.pause();
            result = "Paused animation playback";
            break;
  
          case "stop":
            Timeline.setTime(0);
            Timeline.pause();
            result = "Stopped animation playback";
            break;
  
          case "set_time":
            if (time === undefined) {
              throw new Error("Time parameter required for set_time action.");
            }
            Timeline.setTime(time);
            result = `Set timeline to ${time} seconds`;
            break;
  
          case "set_length":
            if (length === undefined) {
              throw new Error("Length parameter required for set_length action.");
            }
            runPersistentAnimationEdit("Change animation length", () => {
              animation.setLength(length);
              synchronizeEasing();
            });
            result = `Set animation length to ${animation.length} seconds` +
              (easingRefreshed ? "; managed easing timing refreshed" : "");
            break;
  
          case "set_fps":
            if (fps === undefined) {
              throw new Error("FPS parameter required for set_fps action.");
            }
            runPersistentAnimationEdit("Change animation snapping", () => {
              animation.extend({ snapping: fps });
            });
            Timeline.setTimecode(Timeline.time);
            result = `Set animation FPS to ${animation.snapping}`;
            break;
  
          case "loop":
            if (loop_mode === undefined) {
              throw new Error("Loop mode parameter required for loop action.");
            }
            if (loop_mode === animation.loop) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Loop mode is already ${animation.loop}; no authored change was required.`,
                  },
                ],
                structuredContent: {
                  action,
                  changed: false,
                  animation: { uuid: animation.uuid, name: animation.name },
                  loop_mode: animation.loop,
                },
              };
            }
            runPersistentAnimationEdit("Change animation loop mode", () => {
              animation.setLoop(loop_mode, false);
              synchronizeEasing();
            });
            result = `Set loop mode to ${animation.loop}` +
              (easingRefreshed ? "; managed easing timing refreshed" : "");
            break;
  
          case "set_anim_time_update":
          case "set_blend_weight": {
            if (molang === undefined) {
              throw new Error(`${action} requires molang; use null to clear.`);
            }
            const property =
              action === "set_anim_time_update"
                ? "anim_time_update"
                : "blend_weight";
            const nextValue = normalizeAnimationMolangProperty(molang);
            const currentValue = normalizeAnimationMolangProperty(
              animationMolang[property]
                ? String(animationMolang[property])
                : null
            );
            if (nextValue === currentValue) {
              throw new Error(
                `${action} would not change animation "${animation.name}".`
              );
            }
            runPersistentAnimationEdit(`Change animation ${property}`, () => {
              animation.extend({ [property]: nextValue });
            });
            const propertyResult = {
              action,
              animation: {
                uuid: animation.uuid,
                name: animation.name,
                anim_time_update: animationMolang.anim_time_update || null,
                blend_weight: animationMolang.blend_weight || null,
              },
            };
            Animator.preview();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Updated ${property} for animation "${animation.name}".`,
                },
              ],
              structuredContent: propertyResult,
            };
          }
  
          case "select_range":
            if (!range) {
              throw new Error(
                "Range parameter required for select_range action."
              );
            }
            (Timeline.keyframes as BBKeyframe[])
              .filter((kf) => keyframeBelongsToAnimation(kf, animation))
              .forEach((kf) => {
                if (kf.time >= range.start && kf.time <= range.end) {
                  kf.select();
                } else {
                  kf.selected = false;
                }
              });
            result = `Selected keyframes between ${range.start} and ${range.end} seconds`;
            break;
        }
  
        Animator.preview();
  
        return {
          content: [{ type: "text" as const, text: result }],
          structuredContent: {
            action,
            animation: { uuid: animation.uuid, name: animation.name },
            timeline_time: Timeline.time,
            ...(easingRefreshed ? { managed_easing_refreshed: true } : {}),
          },
        };
      },
    },
    animationTimelineToolDoc.status
  );
}
