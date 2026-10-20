/// <reference types="three" />
/// <reference types="blockbench-types" />
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { inspectAnimationParameters } from "./inspectionSchema";
import { readCurrentBonePoseSnapshot } from "./currentPose";
export { inspectAnimationParameters } from "./inspectionSchema";



export const animationInspectionToolDocs: ToolSpec[] = [
  {
    name: "inspect_animation",
    description:
      "Inspects authored Bedrock Animation clips or AnimationControllers. Use bone for focused authored-bone transforms, state for focused controller-state detail, and include_effect_keyframes only when full authored Animation effects are required.",
    annotations: {
      title: "Inspect Animation Clip or Controller",
      readOnlyHint: true,
    },
    parameters: inspectAnimationParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

type TransformChannel = "rotation" | "position" | "scale";
type EffectDataPoint = KeyframeDataPoint & {
  effect?: string;
  locator?: string;
  bind_to_actor?: boolean;
  script?: string;
  file?: string;
};
type InspectableAnimationItem = BBAnimation | AnimationController;
type ControllerStateView = AnimationControllerState & {
  animations: Array<{
    uuid: string;
    key: string;
    animation: string;
    blend_value: string | number;
  }>;
  transitions: Array<{ uuid: string; target: string; condition: string }>;
  sounds: Array<{ uuid?: string; effect?: string }>;
  particles: Array<{
    uuid?: string;
    effect?: string;
    locator?: string;
    bind_to_actor?: boolean;
    pre_effect_script?: string;
  }>;
  blend_transition_curve?: Record<string, number>;
};

function isAnimationController(
  item: InspectableAnimationItem
): item is AnimationController {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function resolveAnimationItem(reference?: string): InspectableAnimationItem {
  const allItems = AnimationItem.all as unknown as InspectableAnimationItem[];
  if (reference === undefined) {
    const selected = AnimationItem.selected as unknown as InspectableAnimationItem | null;
    if (!selected) {
      throw new Error(
        "No AnimationItem selected. Pass an exact Animation/AnimationController UUID or unique exact name."
      );
    }
    return selected;
  }

  const uuidMatch = allItems.find((item) => item.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = allItems.filter((item) => item.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `AnimationItem name "${reference}" is ambiguous. Use an exact UUID. Candidates: ${nameMatches
        .map((item) => `${item.name} (${item.uuid})`)
        .join(", ")}`
    );
  }
  throw new Error(
    `AnimationItem "${reference}" not found. Pass an exact Animation/AnimationController UUID or unique exact name.`
  );
}

function resolveGroup(reference: string): Group {
  const uuidMatch = Group.all.find((group: Group) => group.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const nameMatches = Group.all.filter((group: Group) => group.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Group name "${reference}" is ambiguous. Use an exact UUID. Candidates: ${nameMatches
        .map((group: Group) => `${group.name} (${group.uuid})`)
        .join(", ")}`
    );
  }
  throw new Error(
    `Group "${reference}" not found. Use inspect_elements(mode=outline) to confirm the intended Group UUID.`
  );
}

export function resolveUniqueControllerState<
  T extends { uuid: string; name: string },
>(states: readonly T[], reference: string): T {
  const uuidMatch = states.find((state) => state.uuid === reference);
  if (uuidMatch) return uuidMatch;
  const nameMatches = states.filter((state) => state.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `AnimationController state name "${reference}" is ambiguous. Use an exact state UUID.`
    );
  }
  throw new Error(`AnimationController state "${reference}" not found.`);
}

function summarizeControllerState(state: ControllerStateView, index: number) {
  return {
    index,
    uuid: state.uuid,
    name: state.name,
    animation_count: state.animations.length,
    transition_count: state.transitions.length,
    sound_count: state.sounds.length,
    particle_count: state.particles.length,
    has_on_entry: Boolean(
      state.on_entry && state.on_entry.replace(/[\n\s;.]+/g, "")
    ),
    has_on_exit: Boolean(
      state.on_exit && state.on_exit.replace(/[\n\s;.]+/g, "")
    ),
    blend_transition: state.blend_transition ?? 0,
    has_blend_transition_curve: Boolean(
      state.blend_transition_curve &&
        Object.keys(state.blend_transition_curve).length
    ),
    blend_via_shortest_path: Boolean(state.blend_via_shortest_path),
  };
}

function inspectControllerState(
  controller: AnimationController,
  reference: string
) {
  const state = resolveUniqueControllerState(
    controller.states as ControllerStateView[],
    reference
  );
  const allItems = AnimationItem.all as unknown as InspectableAnimationItem[];
  return {
    uuid: state.uuid,
    name: state.name,
    animations: state.animations.map((link, index) => {
      const loaded = link.animation
        ? allItems.find(
            (item) => item.uuid === link.animation && !isAnimationController(item)
          )
        : undefined;
      return {
        index,
        uuid: link.uuid,
        animation_key: link.key,
        loaded_animation_uuid: link.animation || null,
        loaded_animation_name: loaded?.name || null,
        blend_value: link.blend_value ?? null,
      };
    }),
    transitions: state.transitions.map((transition, index) => {
      const target = controller.states.find(
        (candidate) => candidate.uuid === transition.target
      );
      return {
        index,
        uuid: transition.uuid,
        target_uuid: transition.target || null,
        target_name: target?.name || null,
        condition: transition.condition || "",
      };
    }),
    sounds: state.sounds.map((sound, index) => ({
      index,
      uuid: sound.uuid || null,
      effect: sound.effect || null,
    })),
    particles: state.particles.map((particle, index) => ({
      index,
      uuid: particle.uuid || null,
      effect: particle.effect || null,
      locator: particle.locator || null,
      bind_to_actor: particle.bind_to_actor === false ? false : true,
      pre_effect_script: particle.pre_effect_script || null,
    })),
    on_entry: state.on_entry || null,
    on_exit: state.on_exit || null,
    blend_transition: state.blend_transition ?? 0,
    blend_transition_curve:
      state.blend_transition_curve &&
      Object.keys(state.blend_transition_curve).length
        ? { ...state.blend_transition_curve }
        : null,
    blend_via_shortest_path: Boolean(state.blend_via_shortest_path),
  };
}

function inspectAnimationController(
  controller: AnimationController,
  stateReference?: string
) {
  const initial = controller.states.find(
    (state) => state.uuid === controller.initial_state
  );
  const base = {
    authored_space: "blockbench_animation_controller" as const,
    controller: {
      uuid: controller.uuid,
      name: controller.name,
      path: controller.path || null,
      initial_state: controller.initial_state
        ? { uuid: controller.initial_state, name: initial?.name || null }
        : null,
    },
    state_count: controller.states.length,
  };

  if (stateReference) {
    return {
      ...base,
      focused_state: inspectControllerState(controller, stateReference),
    };
  }
  return {
    ...base,
    states: (controller.states as ControllerStateView[]).map(
      summarizeControllerState
    ),
    focused_state: null,
  };
}

function inspectKeyframe(keyframe: BBKeyframe) {
  return {
    uuid: keyframe.uuid,
    time: keyframe.time,
    values: keyframe.data_points.map((_, index) => keyframe.getArray(index)),
    uniform: keyframe.uniform,
    interpolation: keyframe.interpolation,
    bezier:
      keyframe.interpolation === "bezier"
        ? {
            linked: keyframe.bezier_linked,
            left_time: [...keyframe.bezier_left_time],
            left_value: [...keyframe.bezier_left_value],
            right_time: [...keyframe.bezier_right_time],
            right_value: [...keyframe.bezier_right_value],
          }
        : null,
  };
}

function inspectChannel(animator: BoneAnimator, channel: TransformChannel) {
  const keyframes = ((animator[channel] as BBKeyframe[] | undefined) ?? [])
    .slice()
    .sort((a, b) => a.time - b.time || a.uuid.localeCompare(b.uuid));
  return {
    keyframe_count: keyframes.length,
    keyframes: keyframes.map(inspectKeyframe),
  };
}

function normalizePreEffectScript(script: string | undefined): string | null {
  if (!script || !script.replace(/[\n\s;.]+/g, "")) return null;
  return script.match(/;$/) ? script : `${script};`;
}

export function countEffectiveEffectDataPoints(
  points: readonly { effect?: string | null }[]
): number {
  return points.reduce(
    (count, point) => count + (point.effect ? 1 : 0),
    0
  );
}

export function countEffectiveTimelineScriptLines(
  points: readonly { script?: string | null }[]
): number {
  const script = points[0]?.script;
  if (typeof script !== "string") return 0;
  return script
    .split("\n")
    .filter((line) => Boolean(line.replace(/[\s;]/g, ""))).length;
}

function inspectParticleEffects(animation: BBAnimation, includeKeyframes: boolean) {
  const existingEffects = animation.animators.effects;
  if (!existingEffects) {
    return {
      has_animator: false,
      animator: null,
      particle: {
        keyframe_count: 0,
        particle_count: 0,
        ...(includeKeyframes ? { keyframes: [] } : {}),
      },
      sound: {
        keyframe_count: 0,
        sound_count: 0,
        ...(includeKeyframes ? { keyframes: [] } : {}),
      },
      timeline: {
        keyframe_count: 0,
        script_count: 0,
        ...(includeKeyframes ? { keyframes: [] } : {}),
      },
    };
  }
  if (!(existingEffects instanceof EffectAnimator)) {
    throw new Error(
      `Animation "${animation.name}" has a non-EffectAnimator stored at animation.animators.effects.`
    );
  }

  const particleKeyframes = ((existingEffects.particle as BBKeyframe[] | undefined) ?? [])
    .slice()
    .sort((a, b) => a.time - b.time || a.uuid.localeCompare(b.uuid));
  const inspectedKeyframes = particleKeyframes.map((keyframe) => ({
    uuid: keyframe.uuid,
    time: keyframe.time,
    particles: keyframe.data_points.map((dataPoint, dataPointIndex) => {
      const particle = dataPoint as EffectDataPoint;
      return {
        data_point_index: dataPointIndex,
        effect: particle.effect || null,
        locator: particle.locator || null,
        // Native preview file is preserved on the data point, but it was
        // previously invisible to inspect_animation diagnostics.
        preview_file: typeof particle.file === "string" && particle.file.length > 0
          ? particle.file : null,
        bind_to_actor: particle.bind_to_actor === false ? false : null,
        pre_effect_script: normalizePreEffectScript(particle.script),
      };
    }),
  }));

  const soundKeyframes = ((existingEffects.sound as BBKeyframe[] | undefined) ?? [])
    .slice()
    .sort((a, b) => a.time - b.time || a.uuid.localeCompare(b.uuid));
  const inspectedSoundKeyframes = soundKeyframes.map((keyframe) => ({
    uuid: keyframe.uuid,
    time: keyframe.time,
    sounds: keyframe.data_points.map((dataPoint, dataPointIndex) => {
      const sound = dataPoint as EffectDataPoint;
      return {
        data_point_index: dataPointIndex,
        effect: sound.effect || null,
        locator: sound.locator || null,
      };
    }),
  }));

  const timelineKeyframes = ((existingEffects.timeline as BBKeyframe[] | undefined) ?? [])
    .slice()
    .sort((a, b) => a.time - b.time || a.uuid.localeCompare(b.uuid));
  const inspectedTimelineKeyframes = timelineKeyframes.map((keyframe) => ({
    uuid: keyframe.uuid,
    time: keyframe.time,
    scripts: keyframe.data_points.map((dataPoint, dataPointIndex) => {
      const timeline = dataPoint as EffectDataPoint;
      return {
        data_point_index: dataPointIndex,
        script: typeof timeline.script === "string" ? timeline.script : null,
      };
    }),
  }));

  return {
    has_animator: true,
    animator: { uuid: existingEffects.uuid, name: existingEffects.name },
    particle: {
      keyframe_count: inspectedKeyframes.length,
      particle_count: inspectedKeyframes.reduce(
        (count, keyframe) =>
          count + countEffectiveEffectDataPoints(keyframe.particles),
        0
      ),
      ...(includeKeyframes ? { keyframes: inspectedKeyframes } : {}),
    },
    sound: {
      keyframe_count: inspectedSoundKeyframes.length,
      sound_count: inspectedSoundKeyframes.reduce(
        (count, keyframe) =>
          count + countEffectiveEffectDataPoints(keyframe.sounds),
        0
      ),
      ...(includeKeyframes ? { keyframes: inspectedSoundKeyframes } : {}),
    },
    timeline: {
      keyframe_count: inspectedTimelineKeyframes.length,
      script_count: inspectedTimelineKeyframes.reduce(
        (count, keyframe) =>
          count + countEffectiveTimelineScriptLines(keyframe.scripts),
        0
      ),
      ...(includeKeyframes ? { keyframes: inspectedTimelineKeyframes } : {}),
    },
  };
}

function summarizeBoneAnimators(animation: BBAnimation) {
  return Object.values(animation.animators)
    .filter((animator): animator is BoneAnimator => animator instanceof BoneAnimator)
    .map((animator) => {
      const group = Group.all.find(
        (candidate: Group) => candidate.uuid === animator.uuid
      );
      return {
        animator: { uuid: animator.uuid, name: animator.name },
        group: group ? { uuid: group.uuid, name: group.name } : null,
        channels: {
          rotation: ((animator.rotation as BBKeyframe[] | undefined) ?? []).length,
          position: ((animator.position as BBKeyframe[] | undefined) ?? []).length,
          scale: ((animator.scale as BBKeyframe[] | undefined) ?? []).length,
        },
      };
    })
    .sort((a, b) => {
      const aName = a.group?.name ?? a.animator.name;
      const bName = b.group?.name ?? b.animator.name;
      return (
        aName.localeCompare(bName) ||
        a.animator.uuid.localeCompare(b.animator.uuid)
      );
    });
}

export function registerAnimationInspectionTools() {
  createTool(
    animationInspectionToolDocs[0].name,
    {
      ...animationInspectionToolDocs[0],
      async execute({ animation_id, bone, state, include_effect_keyframes }) {
        const item = resolveAnimationItem(animation_id);
        if (isAnimationController(item)) {
          if (bone !== undefined) {
            throw new Error(
              "`bone` applies only to authored Animation inspection; use `state` for AnimationController detail."
            );
          }
          if (include_effect_keyframes) {
            throw new Error(
              "`include_effect_keyframes` applies only to authored Animation effect keyframes, not controller state effects."
            );
          }
          const result = inspectAnimationController(item, state);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }
        if (state !== undefined) {
          throw new Error(
            "`state` applies only to AnimationController inspection; use `bone` for authored Animation detail."
          );
        }

        const animation = item;
        const animationSummary = {
          uuid: animation.uuid,
          name: animation.name,
          loop: animation.loop,
          length: animation.length,
          snapping: animation.snapping,
          anim_time_update: animation.anim_time_update || null,
          blend_weight: animation.blend_weight || null,
        };

        if (bone !== undefined) {
          const group = resolveGroup(bone);
          const existingAnimator = animation.animators[group.uuid];
          if (existingAnimator && !(existingAnimator instanceof BoneAnimator)) {
            throw new Error(
              `Animator stored for Group "${group.name}" (${group.uuid}) is not a BoneAnimator.`
            );
          }
          const animator = existingAnimator as BoneAnimator | undefined;
          const focusedBone = {
            group: { uuid: group.uuid, name: group.name },
            has_animator: !!animator,
            animator: animator
              ? { uuid: animator.uuid, name: animator.name }
              : null,
            channels: animator
              ? {
                  rotation: inspectChannel(animator, "rotation"),
                  position: inspectChannel(animator, "position"),
                  scale: inspectChannel(animator, "scale"),
                }
              : {
                  rotation: { keyframe_count: 0, keyframes: [] },
                  position: { keyframe_count: 0, keyframes: [] },
                  scale: { keyframe_count: 0, keyframes: [] },
                },
          };
          const result = {
            authored_space: "blockbench_animation" as const,
            animation: animationSummary,
            focused_bone: focusedBone,
            current_pose_snapshot: readCurrentBonePoseSnapshot(animation, group),
            ...(include_effect_keyframes
              ? { effects: inspectParticleEffects(animation, true) }
              : {}),
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        }

        const boneAnimators = summarizeBoneAnimators(animation);
        const effects = inspectParticleEffects(animation, include_effect_keyframes);
        const result = {
          authored_space: "blockbench_animation" as const,
          animation: animationSummary,
          bone_animator_count: boneAnimators.length,
          bone_animators: boneAnimators,
          effects,
          focused_bone: null,
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result) },
          ],
          structuredContent: result,
        };
      },
    },
    animationInspectionToolDocs[0].status
  );
}
