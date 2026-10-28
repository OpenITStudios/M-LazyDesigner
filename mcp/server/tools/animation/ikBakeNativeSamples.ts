/**
 * Post-sampling decoder for an explicitly supplied native sampleIK() result.
 * Blockbench's actual sampleIK() has significant preview side effects;
 * this module deliberately NEVER invokes it.
 */
import {
  planNativeIkBakedKeyframes,
  type NativeIkKeyframePlanInput,
} from "@/lib/animation/ikBakeKeyframePlan";

type NativeIkSolverFrame = {
  array: readonly number[];
  euler?: THREE.Euler;
};

export function prepareNativeIkBakeFromExistingSamples(input: {
  animation_uuid: string;
  duration_seconds: number;
  snapping_fps: number;
  expected_group_uuids: readonly string[];
  samples: Readonly<Record<string, readonly NativeIkSolverFrame[]>>;
}) {
  if (typeof Group === "undefined" || !Array.isArray(Group.all)) {
    throw new Error("IK_BAKE_GROUP_RUNTIME_UNAVAILABLE: no complete native Group registry.");
  }
  if (!input.samples || typeof input.samples !== "object" ||
      Array.isArray(input.samples)) {
    throw new Error("IK_BAKE_SAMPLES_UNAVAILABLE: an actual solver sample record is required.");
  }
  const groups = new Map<string, Group>();
  for (const group of Group.all) {
    if (groups.has(group.uuid)) {
      throw new Error("IK_BAKE_GROUP_IDENTITY_AMBIGUOUS: duplicate native Group UUID.");
    }
    groups.set(group.uuid, group);
  }
  const expected = new Set(input.expected_group_uuids);
  if (expected.size !== input.expected_group_uuids.length ||
      Object.keys(input.samples).length !== expected.size ||
      Object.keys(input.samples).some((id) => !expected.has(id))) {
    throw new Error("IK_BAKE_SAMPLING_INCOMPLETE: unexpected or missing native solver bone outputs.");
  }
  const tracks: NativeIkKeyframePlanInput["tracks"][number][] = [];
  for (const uuid of input.expected_group_uuids) {
    const group = groups.get(uuid);
    const frames = input.samples[uuid];
    if (!group || !Array.isArray(frames)) {
      throw new Error("IK_BAKE_SAMPLING_INCOMPLETE: bone " + uuid + " is unavailable.");
    }
    const rawRotation = group.rotation;
    if (!Array.isArray(rawRotation) || rawRotation.length !== 3 ||
        !rawRotation.every(Number.isFinite)) {
      throw new Error("IK_BAKE_GROUP_ROTATION_INVALID: native bone origin rotation missing.");
    }
    const rotated = rawRotation.some((v) => Math.abs(v) > 1e-6);
    const scene = (group as Group & {
      scene_object?: { fix_rotation?: THREE.Euler };
    }).scene_object;
    const fix = scene?.fix_rotation;
    if (rotated &&
        (!fix || ![fix.x,fix.y,fix.z].every(Number.isFinite))) {
      throw new Error("IK_BAKE_PRE_ROTATION_UNVERIFIED: native fixed Euler unavailable for " + uuid);
    }
    const rotations = frames.map((frame) => {
      const raw = frame?.array;
      if (!Array.isArray(raw) || raw.length !== 3 ||
          !raw.every((v) => typeof v === "number" && Number.isFinite(v))) {
        throw new Error("IK_BAKE_SAMPLE_NONFINITE: invalid solver rotation " + uuid);
      }
      if (!rotated) return [...raw];
      const euler = frame.euler;
      if (!euler || ![euler.x,euler.y,euler.z].every(Number.isFinite) ||
          typeof THREE === "undefined") {
        throw new Error("IK_BAKE_PRE_ROTATION_UNVERIFIED: native solver Euler unavailable.");
      }
      // Blockbench 5.2.2: base.setFromEuler(fix_rotation);
      // add.setFromEuler(solverEuler); base.premultiply(add);
      // euler.setFromQuaternion(base); subtract fix_rotation (radians).
      // Use dedicated quaternions so this decoder never mutates native samples.
      const combined = new THREE.Quaternion().setFromEuler(fix!);
      const sampleQuaternion = new THREE.Quaternion().setFromEuler(euler);
      combined.premultiply(sampleQuaternion);
      const adjusted = new THREE.Euler().setFromQuaternion(
        combined, euler.order
      );
      const toDegrees = 180 / Math.PI;
      return [
        (adjusted.x - fix!.x) * toDegrees,
        (adjusted.y - fix!.y) * toDegrees,
        (adjusted.z - fix!.z) * toDegrees,
      ];
    });
    tracks.push({group_uuid:uuid,rotations});
  }
  return planNativeIkBakedKeyframes({
    animation_uuid: input.animation_uuid,
    duration_seconds: input.duration_seconds,
    snapping_fps: input.snapping_fps,
    expected_group_uuids: input.expected_group_uuids,
    tracks,
  });
}
