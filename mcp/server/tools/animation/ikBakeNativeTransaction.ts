/// <reference types="blockbench-types" />

import {
  requireNativeIkBakeMutationPreflight,
  type NativeIkBakeMutationInventory,
  type planNativeIkBakedKeyframes,
} from "@/lib/animation/ikBakeKeyframePlan";
import type { analyzeNativeIkBakeReadiness } from "@/lib/animation/ikBakeReadiness";

/**
 * Internal, UNREGISTERED keyframe writer. Does not invoke sampleIK(),
 * change timeline time, change selection, or dispatch preview events.
 * Its caller must independently prove source provenance, native sampling
 * completion and full editor restoration before this can become a
 * production MCP operation. No public capability routes to this function.
 */
export function writePreparedNativeIkBakeKeyframes(input: {
  animation: BBAnimation;
  readiness: ReturnType<typeof analyzeNativeIkBakeReadiness>;
  plan: ReturnType<typeof planNativeIkBakedKeyframes>;
}) {
  const { animation, readiness, plan } = input;
  if (typeof Blockbench === "undefined" || Blockbench.version !== "5.2.2" ||
      typeof Format === "undefined" || Format.id !== "bedrock" ||
      typeof Modes === "undefined" || Modes.animate !== true ||
      typeof AnimationItem === "undefined" ||
      AnimationItem.selected !== animation ||
      typeof Group === "undefined" || !Array.isArray(Group.all) ||
      typeof BoneAnimator === "undefined" ||
      typeof NullObject === "undefined" || !Array.isArray(NullObject.all) ||
      typeof Undo === "undefined" || typeof Timeline === "undefined" ||
      !Number.isFinite(Timeline.time)) {
    throw new Error(
      "IK_BAKE_NATIVE_WRITE_CONTEXT_UNVERIFIED: require exact Blockbench 5.2.2, " +
      "selected Bedrock clip and complete native animation/Undo runtime."
    );
  }

  const groupIds = new Set<string>();
  for (const group of Group.all) {
    if (typeof group.uuid !== "string" || !group.uuid ||
        groupIds.has(group.uuid)) {
      throw new Error("IK_BAKE_NATIVE_GROUP_IDENTITY_AMBIGUOUS");
    }
    groupIds.add(group.uuid);
  }
  const boneAnimators = new Map<string, BoneAnimator>();
  const rotationTracks: NativeIkBakeMutationInventory["rotation_tracks"][number][] = [];
  for (const id of readiness.expected_sampled_group_uuids) {
    if (!groupIds.has(id)) {
      throw new Error("IK_BAKE_NATIVE_BONE_NOT_FOUND: " + id);
    }
    const animator = animation.animators[id];
    if (!(animator instanceof BoneAnimator) ||
        animator.animation !== animation ||
        !Array.isArray(animator.rotation)) {
      throw new Error("IK_BAKE_NATIVE_ANIMATOR_UNRESOLVED: " + id);
    }
    boneAnimators.set(id, animator);
    rotationTracks.push({
      bone_uuid: id,
      existing_keyframe_count: animator.rotation.length,
    });
  }

  const nodes = new Map<string, NullObject>();
  for (const node of NullObject.all) {
    if (nodes.has(node.uuid)) {
      throw new Error("IK_BAKE_NATIVE_CONTROLLER_IDENTITY_AMBIGUOUS");
    }
    nodes.set(node.uuid, node);
  }
  const controllers: Array<{
    uuid: string;
    animator: GeneralAnimator;
    keys: BBKeyframe[];
  }> = [];
  for (const item of readiness.examples) {
    const node = nodes.get(item.controller_uuid);
    if (!node || node.ik_target !== item.target_uuid) {
      throw new Error(
        "IK_BAKE_NATIVE_CONTROLLER_TARGET_CHANGED: " + item.controller_uuid
      );
    }
    const nativeSource = (node as NullObject & { ik_source?: string }).ik_source ||
      (node.parent instanceof Group ? node.parent.uuid : null);
    if (nativeSource !== item.source_uuid) {
      throw new Error(
        "IK_BAKE_NATIVE_CONTROLLER_SOURCE_CHANGED: " + item.controller_uuid
      );
    }
    const animator = animation.animators[item.controller_uuid];
    if (!animator || animator.animation !== animation ||
        !Array.isArray(animator.keyframes)) {
      throw new Error(
        "IK_BAKE_NATIVE_CONTROLLER_KEYS_UNAVAILABLE: " + item.controller_uuid
      );
    }
    const keys = [...animator.keyframes] as BBKeyframe[];
    if (keys.some((key) =>
      key.animator !== animator || typeof key.remove !== "function"
    )) {
      throw new Error("IK_BAKE_NATIVE_CONTROLLER_KEY_IDENTITY_UNVERIFIED");
    }
    controllers.push({ uuid: item.controller_uuid, animator, keys });
  }

  const expectedControllerIds = new Set(controllers.map((item) => item.uuid));
  for (const node of NullObject.all) {
    if (!node.ik_target || expectedControllerIds.has(node.uuid)) continue;
    const state = animation.animators[node.uuid];
    if (state && !Array.isArray(state.keyframes)) {
      throw new Error("IK_BAKE_NATIVE_UNREPRESENTED_CONTROLLER_STATE");
    }
    if (state?.keyframes.length) {
      throw new Error(
        "IK_BAKE_NATIVE_UNREPRESENTED_CONTROLLER_KEYS: native baking would remove unplanned authored keys."
      );
    }
  }
  const inventory: NativeIkBakeMutationInventory = {
    animation_uuid: animation.uuid,
    selected_animation_uuid: AnimationItem.selected?.uuid ?? null,
    animation_length: animation.length,
    snapping_fps: animation.snapping,
    rotation_tracks: rotationTracks,
    controller_tracks: controllers.map((item) => ({
      controller_uuid: item.uuid,
      existing_keyframe_count: item.keys.length,
    })),
  };
  const preflight = requireNativeIkBakeMutationPreflight({
    plan, readiness, inventory,
  });
  const timelineTime = Timeline.time;
  let editOpen = false;
  Undo.initEdit({ animations: [animation] });
  editOpen = true;
  try {
    // The one full-animation Undo captures removed controller keys and all
    // created bone rotations. No nested native createKeyframe() transactions.
    for (const controller of controllers) {
      for (const keyframe of controller.keys) keyframe.remove();
      if (controller.animator.keyframes.length !== 0) {
        throw new Error(
          "IK_BAKE_NATIVE_CONTROLLER_POSTCONDITION_FAILED: controller " +
          controller.uuid + " retained removed keyframes."
        );
      }
    }

    const inserted = new Map<string, BBKeyframe[]>();
    for (const key of plan.keyframes) {
      const animator = boneAnimators.get(key.bone_uuid)!;
      const created = animator.addKeyframe({
        channel: "rotation",
        time: key.time,
        interpolation: "linear",
        data_points: [{
          x: key.values[0], y: key.values[1], z: key.values[2],
        }],
      });
      if (!created || created.animator !== animator ||
          created.channel !== "rotation" ||
          created.interpolation !== "linear" ||
          created.time !== key.time ||
          !animator.rotation.includes(created)) {
        throw new Error(
          "IK_BAKE_NATIVE_ROTATION_POSTCONDITION_FAILED: inserted keyframe " +
          "did not match its bone/channel/clock."
        );
      }
      const values = created.getArray(0);
      if (!Array.isArray(values) || values.length !== 3 ||
          !values.every((value, axis) =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value - key.values[axis]) <= 1e-6
          )) {
        throw new Error(
          "IK_BAKE_NATIVE_ROTATION_POSTCONDITION_FAILED: keyframe values differ from solved pose."
        );
      }
      const frames = inserted.get(key.bone_uuid) ?? [];
      frames.push(created);
      inserted.set(key.bone_uuid, frames);
    }
    for (const [uuid, animator] of boneAnimators) {
      const expected = inserted.get(uuid) ?? [];
      if (animator.rotation.length !== expected.length ||
          expected.some((key) => !animator.rotation.includes(key))) {
        throw new Error(
          "IK_BAKE_NATIVE_ROTATION_POSTCONDITION_FAILED: unexpected bone rotation keys."
        );
      }
    }
    if (Timeline.time !== timelineTime || AnimationItem.selected !== animation) {
      throw new Error(
        "IK_BAKE_NATIVE_EDITOR_STATE_CHANGED: keyframe write changed the selected clip or playhead."
      );
    }
    Undo.finishEdit("Bake native IK rotation keyframes");
    editOpen = false;
  } catch (error) {
    if (editOpen) Undo.cancelEdit(true);
    throw error;
  }

  return {
    ...preflight,
    state: "NATIVE_WRITE_COMPLETED" as const,
    native_keyframe_mutation_applied: true as const,
    controller_keyframes_removed: preflight.controller_keyframes_to_remove,
    keyframes_created: preflight.planned_native_keyframe_count,
    preview_restoration_verified: false as const,
    playback_or_export_verified: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
    note: "Internal writer only. A completed Undo transaction does not attest " +
      "native solver provenance, pose restoration, visual playback, save/reopen or export.",
  };
}
