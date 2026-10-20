/// <reference types="three" />
/// <reference types="blockbench-types" />

declare const THREE: typeof import("three");

import {
  bindExplicitContactMarkers,
  prepareContactSamplingPlan,
  type ContactSamplingWindow,
  type ExplicitContactMarkerBinding,
} from "@/lib/animation/contactMarkerBinding";

export const CURRENT_POSE_LOCATOR_LIMIT = 16;

/**
 * Enumerates only native Locators directly owned by the inspected Group.
 * Marker purpose is deliberately UNASSIGNED: an attached Locator is not
 * automatically a planted foot, grip, impact target, or end effector.
 */
function readDirectLocatorCandidates(group: Group) {
  const scope = "DIRECT_CHILD_NATIVE_LOCATORS_ONLY" as const;
  const role = "UNASSIGNED_CONTACT_INTENT" as const;
  const unavailable = (reason: string) => ({
    state: "UNVERIFIED" as const,
    reason,
    scope,
    role,
    count: null,
    observed_count: 0,
    candidates: [],
    native_timeline_sampling_performed: false as const,
  });
  if (typeof Locator === "undefined" || !Array.isArray(Locator.all)) {
    return unavailable("NATIVE_LOCATOR_LIST_UNAVAILABLE");
  }
  if (!Array.isArray(group.children)) {
    return unavailable("NATIVE_GROUP_CHILDREN_UNAVAILABLE");
  }
  const direct = Locator.all.filter((locator) => locator.parent === group);
  if (direct.length > CURRENT_POSE_LOCATOR_LIMIT) {
    return unavailable("NATIVE_LOCATOR_EVIDENCE_LIMIT_EXCEEDED");
  }
  const identities = new Set<string>();
  for (const locator of direct) {
    if (typeof locator.uuid !== "string" || !locator.uuid.trim() ||
        identities.has(locator.uuid)) {
      return unavailable("AMBIGUOUS_NATIVE_LOCATOR_IDENTITY");
    }
    identities.add(locator.uuid);
  }

  const candidates = direct.map((locator) => {
    const identity = {
      uuid: locator.uuid,
      name: typeof locator.name === "string" ? locator.name : null,
    };
    const unavailableLocator = (reason: string) => ({
      ...identity,
      state: "UNVERIFIED" as const,
      reason,
      world_position: null,
    });
    if (!group.children.includes(locator)) {
      return unavailableLocator("LOCATOR_PARENT_CHILD_MISMATCH");
    }
    if (locator.visibility === false) {
      return unavailableLocator("LOCATOR_HIDDEN");
    }
    const mesh = locator.mesh;
    if (!mesh || typeof mesh.updateWorldMatrix !== "function" ||
        typeof mesh.getWorldPosition !== "function") {
      return unavailableLocator("NATIVE_LOCATOR_MESH_UNAVAILABLE");
    }
    let node: THREE.Object3D | null = mesh;
    let encounteredParent = false;
    let encounteredScene = false;
    while (node) {
      if (node.visible === false) {
        return unavailableLocator("LOCATOR_SCENE_HIDDEN");
      }
      if (node === group.mesh) encounteredParent = true;
      if (node === Canvas.scene) {
        encounteredScene = true;
        break;
      }
      node = node.parent;
    }
    if (!encounteredParent || !encounteredScene) {
      return unavailableLocator("LOCATOR_WORLD_HIERARCHY_UNVERIFIED");
    }
    try {
      mesh.updateWorldMatrix(true, false);
      const position = mesh.getWorldPosition(new THREE.Vector3());
      const world = [position.x, position.y, position.z];
      if (world.some((value) => !Number.isFinite(value))) {
        return unavailableLocator("LOCATOR_WORLD_POSITION_INVALID");
      }
      return {
        ...identity,
        state: "OBSERVED" as const,
        reason: null,
        world_position: world as [number, number, number],
      };
    } catch {
      return unavailableLocator("LOCATOR_WORLD_READ_FAILED");
    }
  }).sort((a, b) => a.uuid.localeCompare(b.uuid));

  const observed = candidates.filter((item) => item.state === "OBSERVED").length;
  return {
    state: direct.length === 0
      ? ("NONE" as const)
      : observed === direct.length
        ? ("AVAILABLE" as const) : ("PARTIAL" as const),
    reason: null,
    scope,
    role,
    count: direct.length,
    observed_count: observed,
    candidates,
    native_timeline_sampling_performed: false as const,
  };
}

/**
 * A passive read fence. We only certify that the editor identities and
 * structural snapshot dependencies did not change during synchronous native
 * position reads. It does not attest pose/time synchronization.
 */
function captureCurrentPoseReadFence(animation: BBAnimation, group: Group) {
  const projectUuid = Project.uuid;
  const animationUuid = animation.uuid;
  const animationLength = animation.length;
  const timelineTime = Timeline.time;
  const scene = Canvas.scene;
  const mesh = group.mesh;
  const chain: Array<{ node: THREE.Object3D; parent: THREE.Object3D | null; visible: boolean }> = [];
  let cursor: THREE.Object3D | null = mesh;
  while (cursor) {
    chain.push({ node: cursor, parent: cursor.parent, visible: cursor.visible });
    if (cursor === scene) break;
    cursor = cursor.parent;
  }

  const directLocators =
    typeof Locator !== "undefined" && Array.isArray(Locator.all)
      ? Locator.all.filter((locator) => locator.parent === group).map((locator) => ({
          instance: locator,
          uuid: locator.uuid,
          mesh: locator.mesh,
          parent: locator.parent,
          visible: locator.visibility,
          meshParent: locator.mesh?.parent,
          meshVisible: locator.mesh?.visible,
        }))
      : null;
  const children =
    Array.isArray(group.children) ? [...group.children] : null;

  return () => {
    if (Project.uuid !== projectUuid ||
        AnimationItem.selected !== animation ||
        !AnimationItem.all.includes(animation) ||
        animation.uuid !== animationUuid ||
        animation.length !== animationLength ||
        animation.playing !== true ||
        AnimationItem.all.some((item) =>
          item !== animation && item.playing === true) ||
        (typeof AnimationController !== "undefined" &&
          Boolean((AnimationController.selected as (BBAnimation & { selected_state?: unknown }) | null)?.selected_state)) ||
        Timeline.playing !== false ||
        Timeline.time !== timelineTime ||
        !Animator.open || Modes.animate !== true ||
        Group.all.includes(group) === false ||
        group.mesh !== mesh || group.visibility === false ||
        Canvas.scene !== scene ||
        chain.some((part) =>
          part.node.parent !== part.parent || part.node.visible !== part.visible)
    ) return false;

    if (children !== null &&
        (!Array.isArray(group.children) ||
          group.children.length !== children.length ||
          children.some((child, i) => group.children[i] !== child))) return false;
    if (directLocators !== null) {
      if (typeof Locator === "undefined" || !Array.isArray(Locator.all)) return false;
      const current = Locator.all.filter((locator) => locator.parent === group);
      if (current.length !== directLocators.length ||
          directLocators.some((before, i) =>
            current[i] !== before.instance ||
            current[i]?.uuid !== before.uuid ||
            current[i]?.mesh !== before.mesh ||
            current[i]?.parent !== before.parent ||
            current[i]?.visibility !== before.visible ||
            current[i]?.mesh?.parent !== before.meshParent ||
            current[i]?.mesh?.visible !== before.meshVisible)) return false;
    }
    return true;
  };
}

/**
 * Reads the native world position of a selected bone's existing preview
 * origin. It does not change Timeline.time, re-evaluate animations, invoke
 * Animator.preview, move a bone, or claim an end-effector contact point.
 */
export function readCurrentBonePoseSnapshot(animation: BBAnimation, group: Group) {
  const unverified = (reason: string) => ({
    state: "UNVERIFIED" as const,
    reason,
    source: "CURRENT_EDITOR_PREVIEW_ONLY" as const,
    frame_pose_synchronized: false as const,
    contact_marker_attested: false as const,
    native_animation_sampling_performed: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
  });

  if (typeof Project === "undefined" || !Project?.uuid ||
      typeof AnimationItem === "undefined" ||
      typeof Group === "undefined" ||
      typeof Timeline === "undefined" ||
      typeof Animator === "undefined" ||
      typeof Modes === "undefined" ||
      typeof Canvas === "undefined" ||
      typeof THREE === "undefined") {
    return unverified("NATIVE_PREVIEW_RUNTIME_UNAVAILABLE");
  }
  // The inspected animation is not necessarily the currently displayed one.
  // A passive snapshot is only meaningful for the selected, paused clip.
  if (!Array.isArray(AnimationItem.all) ||
      AnimationItem.selected !== animation ||
      !AnimationItem.all.includes(animation) ||
      !Animator.open || Modes.animate !== true || animation.playing !== true) {
    return unverified("INSPECTED_ANIMATION_NOT_ACTIVE_PREVIEW");
  }
  if (Timeline.playing) return unverified("TIMELINE_PLAYING");
  if (typeof AnimationController !== "undefined" &&
      (AnimationController.selected as (BBAnimation & { selected_state?: unknown }) | null)?.selected_state) {
    return unverified("ANIMATION_CONTROLLER_PREVIEW_ACTIVE");
  }
  if (!Number.isFinite(Timeline.time) || Timeline.time < 0 ||
      !Number.isFinite(animation.length) || Timeline.time > animation.length) {
    return unverified("TIMELINE_TIME_INVALID");
  }
  if (AnimationItem.all.some((item) =>
    item !== animation && item.playing === true
  )) {
    return unverified("MULTIPLE_ANIMATIONS_PLAYING");
  }
  if (!Array.isArray(Group.all) || !Group.all.includes(group) ||
      !group.uuid || group.visibility === false) {
    return unverified("GROUP_IDENTITY_OR_VISIBILITY_UNAVAILABLE");
  }
  const mesh = group.mesh;
  if (!mesh || typeof mesh.updateWorldMatrix !== "function" ||
      typeof mesh.getWorldPosition !== "function") {
    return unverified("NATIVE_GROUP_WORLD_MATRIX_UNAVAILABLE");
  }
  let node: THREE.Object3D | null = mesh;
  let attached = false;
  while (node) {
    if (node.visible === false) return unverified("GROUP_SCENE_HIDDEN");
    if (node === Canvas.scene) { attached = true; break; }
    node = node.parent;
  }
  if (!attached) return unverified("GROUP_OUTSIDE_ACTIVE_SCENE");

  const unchanged = captureCurrentPoseReadFence(animation, group);
  try {
    // Updates Three.js transient transform caches, not authored geometry or
    // animation keyframes. Never interpret this as reevaluating Timeline.time.
    mesh.updateWorldMatrix(true, false);
    const position = mesh.getWorldPosition(new THREE.Vector3());
    const world = [position.x, position.y, position.z];
    if (world.some((value) => !Number.isFinite(value))) {
      return unverified("NATIVE_GROUP_WORLD_POSITION_INVALID");
    }
    const locator_candidates = readDirectLocatorCandidates(group);
    if (!unchanged()) {
      return unverified("NATIVE_POSE_READ_CONTEXT_CHANGED");
    }
    return {
      state: "OBSERVED" as const,
      reason: null,
      source: "CURRENT_EDITOR_PREVIEW_ONLY" as const,
      project_uuid: Project.uuid,
      animation_uuid: animation.uuid,
      group_uuid: group.uuid,
      timeline_time_observed: Timeline.time,
      bone_origin_world: world as [number, number, number],
      locator_candidates,
      frame_pose_synchronized: false as const,
      contact_marker_attested: false as const,
      native_animation_sampling_performed: false as const,
      visual_verdict: "NOT_EVALUATED" as const,
      interpretation:
        "Current native bone origin and directly attached Locator candidates only; " +
        "Locator role is unassigned and neither these positions nor the displayed " +
        "time certify an end effector, physical contact, or animation frame sequence.",
    };
  } catch {
    return unverified("NATIVE_GROUP_POSE_READ_FAILED");
  }
}

/**
 * Scoped consumer of explicit semantic intent and the existing native pose
 * reader. This is internal only: focused inspect_animation has no role-binding
 * input, so it MUST NOT silently invent bindings from Locator names.
 */
export function resolveCurrentContactMarkerBindings(
  animation: BBAnimation,
  group: Group,
  bindings: readonly ExplicitContactMarkerBinding[],
  sampling_window?: ContactSamplingWindow
) {
  const snapshot = readCurrentBonePoseSnapshot(animation, group);
  const bound = bindExplicitContactMarkers({ snapshot, bindings });
  if (!sampling_window) return bound;
  return {
    ...bound,
    sampling_preflight: prepareContactSamplingPlan({
      snapshot, bindings, window: sampling_window,
      duration_seconds: animation.length,
    }),
  };
}
