/**
 * Post-sampling decoder for an explicitly supplied native sampleIK() result.
 * Blockbench's actual sampleIK() has significant preview side effects;
 * this module deliberately NEVER invokes it.
 */
import {
  nativeIkFrameTimes,
  planNativeIkBakedKeyframes,
  type NativeIkKeyframePlanInput,
} from "@/lib/animation/ikBakeKeyframePlan";
import {
  IK_BAKE_MAX_WORK_UNITS,
  analyzeNativeIkBakeReadiness,
} from "@/lib/animation/ikBakeReadiness";

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
  if (!Array.isArray(input.expected_group_uuids)) {
    throw new Error("IK_BAKE_TRACK_INVENTORY_MISMATCH: expected bone IDs are missing.");
  }
  const expected = new Set(input.expected_group_uuids);
  const nativeFrameCount = nativeIkFrameTimes(
    input.duration_seconds, input.snapping_fps
  ).length;
  if (expected.size * nativeFrameCount > IK_BAKE_MAX_WORK_UNITS) {
    throw new Error("IK_BAKE_SAMPLE_BUDGET_EXCEEDED: native sample normalization exceeds aggregate budget.");
  }
  if (expected.size !== input.expected_group_uuids.length ||
      Object.keys(input.samples).length !== expected.size ||
      Object.keys(input.samples).some((id) => !expected.has(id))) {
    throw new Error("IK_BAKE_SAMPLING_INCOMPLETE: unexpected or missing native solver bone outputs.");
  }
  const tracks: NativeIkKeyframePlanInput["tracks"][number][] = [];
  for (const uuid of input.expected_group_uuids) {
    const group = groups.get(uuid);
    const frames = input.samples[uuid];
    if (!group || !Array.isArray(frames) ||
        frames.length !== nativeFrameCount) {
      throw new Error("IK_BAKE_SAMPLING_INCOMPLETE: bone " + uuid +
        " did not supply exactly every native clock frame.");
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

function normalizeIkBakeMolang(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\n/g, "");
}

/** Read-only, exact native source snapshot shared by inspection and pre-Undo. */
export function captureNativeIkBakeReadiness(item: BBAnimation) {
  if (typeof Group === "undefined" || !Array.isArray(Group.all) ||
      typeof NullObject === "undefined" || !Array.isArray(NullObject.all) ||
      typeof AnimationItem === "undefined") {
    return {
      state: "unavailable" as const,
      reason: "native_ik_inventory_unavailable" as const,
      native_ik_baked: false as const,
    };
  }
  const groups = Group.all.map((group: Group) => {
    const native = group as Group & {
      scene_object?: { fix_rotation?: unknown };
      mesh?: unknown;
    };
    return {
      uuid: group.uuid,
      parent_uuid: group.parent instanceof Group ? group.parent.uuid : null,
      rotation: Array.isArray(group.rotation) ? [...group.rotation] : [],
      transform_available: Boolean(native.scene_object && native.mesh),
      native_fix_rotation_available: Boolean(native.scene_object?.fix_rotation),
    };
  });
  // Bound native Undo-copy inspection across the entire controller set;
  // do not materialize unbounded authored keyframe payloads in diagnostics.
  let remainingKeyframeSnapshotBudget = IK_BAKE_MAX_WORK_UNITS;
  const controllers = NullObject.all.map((node: NullObject) => {
    const native = node as NullObject & {
      ik_source?: string;
      ik_pole?: string;
    };
    const animator = item.animators[node.uuid] as unknown as {
      position?: unknown[];
      keyframes?: Array<{
        uuid?: string;
        getUndoCopy?: (save: boolean, options?: { absolute_paths: boolean }) => unknown;
      }>;
    } | undefined;
    const keyframes = Array.isArray(animator?.keyframes)
      ? animator.keyframes : [];
    const snapshotAllowed = keyframes.length <= remainingKeyframeSnapshotBudget;
    if (snapshotAllowed) remainingKeyframeSnapshotBudget -= keyframes.length;
    const keyframeCopies = snapshotAllowed
      ? keyframes.map((keyframe) => {
          if (typeof keyframe?.getUndoCopy !== "function") return null;
          try {
            // Source-parity snapshot: captures numeric/Molang components,
            // interpolation and Bezier handles, not just stable UUIDs.
            return keyframe.getUndoCopy(true, { absolute_paths: false });
          } catch {
            return null;
          }
        })
      : [];
    return {
      uuid: node.uuid,
      target_uuid: node.ik_target || null,
      source_uuid: native.ik_source || null,
      parent_group_uuid: node.parent instanceof Group ? node.parent.uuid : null,
      pole_uuid: native.ik_pole || null,
      lock_target_rotation: node.lock_ik_target_rotation === true,
      position_keyframes: Array.isArray(animator?.position)
        ? animator.position.length : 0,
      total_keyframes: Array.isArray(animator?.keyframes)
        ? animator.keyframes.length : 0,
      keyframe_uuids: keyframes.map((keyframe) =>
        typeof keyframe?.uuid === "string" ? keyframe.uuid : ""
      ),
      keyframe_undo_copies: keyframeCopies,
    };
  });
  return analyzeNativeIkBakeReadiness({
    blockbench_version: typeof Blockbench !== "undefined" ? Blockbench.version : "",
    format_id: typeof Format !== "undefined" ? Format.id : "",
    animate_mode: typeof Modes !== "undefined" && Modes.animate === true,
    selected_clip_uuid: AnimationItem.selected?.uuid ?? null,
    animation_uuid: item.uuid,
    duration_seconds: item.length,
    snapping_fps: item.snapping,
    // Authored numeric Molang is still authored semantics. It must not
    // disappear simply because its runtime representation is non-string.
    anim_time_update: normalizeIkBakeMolang(item.anim_time_update),
    blend_weight: normalizeIkBakeMolang(item.blend_weight),
    groups,
    locator_uuids: typeof Locator !== "undefined" && Array.isArray(Locator.all)
      ? Locator.all.map((locator: Locator) => locator.uuid) : [],
    controllers,
    unsupported_armature_count: (() => {
      const armature = (
        globalThis as unknown as {
          ArmatureBone?: { all?: unknown[] };
        }
      ).ArmatureBone;
      return Array.isArray(armature?.all) ? armature.all.length : null;
    })(),
  });
}
