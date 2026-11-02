import { nativeKeyframeTimesCollide } from "@/lib/animation/batchPlanning";
import type {
  CompiledMotionRecipe,
  CompiledMotionKeyframe,
  MotionVec3,
} from "@/lib/animation/motionRecipe";

/**
 * Explicit BONE-LOCAL position holds only. These values are NOT world-space
 * contact points, foot IK, collision constraints, or native sampling evidence.
 */
export type ContactConstraint = {
  bone: string;
  channel: "position";
  start: number;
  end: number;
  value: MotionVec3;
};

export const LOCAL_CONTACT_CONSTRAINT_LIMIT = 64;

function finiteVec3(value: unknown): value is MotionVec3 {
  return Array.isArray(value) && value.length === 3 &&
    value.every((component) =>
      typeof component === "number" && Number.isFinite(component)
    );
}

function sameValue(left: MotionVec3, right: MotionVec3): boolean {
  return left.every((value, index) => value === right[index]);
}

function frameAt(
  frames: readonly CompiledMotionKeyframe[],
  time: number
): CompiledMotionKeyframe | undefined {
  return frames.find((frame) => frame.time === time);
}

function assertSafeInsertion(
  frames: readonly CompiledMotionKeyframe[],
  time: number,
  bone: string
): void {
  for (const frame of frames) {
    // Native replacement is channel-scoped. A nearby rotation-only key
    // is not a collision with an inserted position key.
    if (frame.position !== undefined &&
        frame.time !== time &&
        nativeKeyframeTimesCollide(frame.time, time)) {
      throw new Error(
        "Local contact boundary for " + bone +
        " collides with a native position keyframe within 0.0001 seconds."
      );
    }
  }
}

export function applyContactConstraints(
  recipe: CompiledMotionRecipe,
  constraints: readonly ContactConstraint[]
): CompiledMotionRecipe {
  if (!Array.isArray(constraints) ||
      constraints.length > LOCAL_CONTACT_CONSTRAINT_LIMIT) {
    throw new Error("Local contact constraints exceed the supported 64-interval budget.");
  }

  // Complete preflight before producing new pose data. No contact is inferred
  // from bone names, motion archetype, or the location of a keyframe.
  const byBone = new Map<string, ContactConstraint[]>();
  for (const constraint of constraints) {
    if (!constraint ||
        typeof constraint.bone !== "string" ||
        !constraint.bone.trim() ||
        constraint.channel !== "position") {
      throw new Error("Local contact requires an explicit bone and position channel.");
    }
    if (!Number.isFinite(recipe.duration) ||
        !Number.isFinite(constraint.start) ||
        !Number.isFinite(constraint.end) ||
        constraint.start < 0 ||
        constraint.end < constraint.start ||
        constraint.end > recipe.duration) {
      throw new Error("Contact constraint requires a finite non-negative range within the motion duration.");
    }
    if (!finiteVec3(constraint.value)) {
      throw new Error("Contact constraint value must contain three finite values.");
    }
    const frames = recipe.bones[constraint.bone];
    if (!frames || !frames.some((frame) => frame.position !== undefined)) {
      throw new Error(
        "Local contact requires an existing authored position track for bone " +
        constraint.bone + "."
      );
    }
    if (frames.some((frame) =>
      frame.position !== undefined &&
      frame.interpolation !== undefined &&
      frame.interpolation !== "linear"
    )) {
      throw new Error(
        "Local contact cannot guarantee a hold across nonlinear/step/Bezier " +
        "position interpolation for bone " + constraint.bone + "."
      );
    }

    const existing = byBone.get(constraint.bone) ?? [];
    for (const previous of existing) {
      const overlaps = Math.max(previous.start, constraint.start) <=
        Math.min(previous.end, constraint.end);
      if (overlaps && !sameValue(previous.value, constraint.value)) {
        throw new Error(
          "Conflicting local contact targets overlap for bone " + constraint.bone + "."
        );
      }
    }
    existing.push(constraint);
    byBone.set(constraint.bone, existing);
  }

  const bones = { ...recipe.bones };
  for (const [bone, requests] of byBone) {
    const next = bones[bone].map((frame) => ({ ...frame }));
    for (const constraint of requests) {
      assertSafeInsertion(next, constraint.start, bone);
      assertSafeInsertion(next, constraint.end, bone);
      for (const frame of next) {
        if (frame.time >= constraint.start && frame.time <= constraint.end) {
          frame.position = [...constraint.value] as MotionVec3;
        }
      }
      for (const time of new Set([constraint.start, constraint.end])) {
        const existing = frameAt(next, time);
        if (existing) {
          existing.position = [...constraint.value] as MotionVec3;
        } else {
          next.push({ time, position: [...constraint.value] as MotionVec3 });
        }
      }
      next.sort((a, b) => a.time - b.time);
    }
    bones[bone] = next;
  }
  return { ...recipe, bones };
}
