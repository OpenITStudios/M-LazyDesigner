import {
  IK_BAKE_MAX_WORK_UNITS,
  type analyzeNativeIkBakeReadiness,
} from "./ikBakeReadiness";

export type NativeIkLocalRotationTrack = Readonly<{
  group_uuid: string;
  /** Exactly one local Euler rotation for each native sampleIK() frame. */
  rotations: readonly (readonly number[])[];
}>;

export type NativeIkKeyframePlanInput = Readonly<{
  animation_uuid: string;
  duration_seconds: number;
  snapping_fps: number;
  /** Exact eligible bone UUIDs emitted by the native IK solver. */
  expected_group_uuids: readonly string[];
  /** Native Euler/quaternion corrections must already have been applied. */
  tracks: readonly NativeIkLocalRotationTrack[];
}>;

export type PlannedNativeIkRotationKeyframe = Readonly<{
  bone_uuid: string;
  channel: "rotation";
  time: number;
  values: readonly [number, number, number];
  interpolation: "linear";
}>;

/**
 * Native sampleIK() accumulates Timeline.time += 1/fps and checks <= length.
 * Its frame count can differ by one from floor(length*fps)+1 due to IEEE-754
 * addition (e.g. 1 second / 20 fps gives 20 samples). Mimic the actual loop,
 * while keeping a strict pre-allocation upper bound.
 */
export function nativeIkFrameTimes(duration: number, fps: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 200 ||
      !Number.isSafeInteger(fps) || fps < 1 || fps > 144) {
    throw new Error("IK_BAKE_SAMPLE_CLOCK_INVALID: require <=200s and integer 1..144 fps.");
  }
  const upperBound = Math.ceil(duration * fps) + 1;
  if (upperBound > IK_BAKE_MAX_WORK_UNITS) {
    throw new Error("IK_BAKE_SAMPLE_BUDGET_EXCEEDED: native time sampling exceeds source budget.");
  }
  const timeline: number[] = [];
  const interval = 1 / fps;
  let time = 0;
  while (time <= duration && time <= 200) {
    if (timeline.length >= IK_BAKE_MAX_WORK_UNITS) {
      throw new Error("IK_BAKE_SAMPLE_BUDGET_EXCEEDED: native clock exceeded source budget.");
    }
    // Upstream bake_ik_animation creates keyframes at i / snapping,
    // rather than directly using the accumulated Timeline clock.
    timeline.push(timeline.length / fps);
    time += interval;
  }
  if (timeline.length < 2) {
    throw new Error("IK_BAKE_INSUFFICIENT_NATIVE_FRAMES: at least two IK solver sample frames required.");
  }
  return timeline;
}

function equalRotation(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.every((value, i) => value === right[i]);
}

function isZeroRotation(values: readonly number[]): boolean {
  return values.every((value) => value === 0);
}

function canonicalAngle(value: number): number {
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Prepare deterministic native IK rotation keyframes AFTER real sampleIK()
 * and after the matching native pre-rotation quaternion conversion.
 *
 * An explicit source snapshot/sample claim is not independently attested by
 * this pure function. It must not authorize native mutation or UI restoration.
 */
export function planNativeIkBakedKeyframes(input: NativeIkKeyframePlanInput) {
  if (!input || typeof input.animation_uuid !== "string" ||
      !input.animation_uuid.trim()) {
    throw new Error("IK_BAKE_CLIP_ID_INVALID: exact authored clip required.");
  }
  const times = nativeIkFrameTimes(input.duration_seconds, input.snapping_fps);
  const expected = input.expected_group_uuids;
  const tracks = input.tracks;
  if (!Array.isArray(expected) || expected.length === 0 ||
      expected.length > IK_BAKE_MAX_WORK_UNITS ||
      expected.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(expected).size !== expected.length ||
      !Array.isArray(tracks) || tracks.length !== expected.length) {
    throw new Error("IK_BAKE_TRACK_INVENTORY_MISMATCH: exact expected solver bone IDs required.");
  }
  if (times.length * expected.length > IK_BAKE_MAX_WORK_UNITS) {
    throw new Error("IK_BAKE_SAMPLE_BUDGET_EXCEEDED: aggregate bone/frame samples exceed the source budget.");
  }
  const byId = new Map<string, NativeIkLocalRotationTrack>();
  for (const track of tracks) {
    if (!track || typeof track.group_uuid !== "string" ||
        byId.has(track.group_uuid) || !expected.includes(track.group_uuid)) {
      throw new Error("IK_BAKE_TRACK_INVENTORY_MISMATCH: duplicate or unplanned native bone output.");
    }
    byId.set(track.group_uuid, track);
  }
  const baked: PlannedNativeIkRotationKeyframe[] = [];
  let originalSampleCount = 0;
  let constantNonZeroTrackCount = 0;
  let sourceMaxRoundingErrorDegrees = 0;
  for (const uuid of expected) {
    const track = byId.get(uuid);
    if (!track || !Array.isArray(track.rotations) ||
        track.rotations.length !== times.length) {
      throw new Error("IK_BAKE_SAMPLING_INCOMPLETE: bone " + uuid +
        " did not return an exact sample for every native clock frame.");
    }
    const angles = track.rotations.map((raw) => {
      if (!Array.isArray(raw) || raw.length !== 3 ||
          raw.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new Error("IK_BAKE_SAMPLE_NONFINITE: bone " + uuid +
          " contains an invalid native rotation.");
      }
      return raw.map((v) => {
        const rounded = canonicalAngle(v);
        if (!Number.isFinite(rounded)) {
          throw new Error("IK_BAKE_SAMPLE_NONFINITE: rounded rotation overflow.");
        }
        sourceMaxRoundingErrorDegrees = Math.max(
          sourceMaxRoundingErrorDegrees, Math.abs(v-rounded)
        );
        return rounded;
      }) as [number, number, number];
    });
    originalSampleCount += angles.length;
    if (angles.every((value) => equalRotation(value, angles[0]))) {
      if (!isZeroRotation(angles[0])) {
        // Upstream's adjacent-equality filter can drop every key in a
        // constant, nonzero solved pose. Retain one key at time zero so
        // deleting the IK controller does not erase that static rotation.
        constantNonZeroTrackCount++;
        baked.push({
          bone_uuid: uuid, channel: "rotation", time: 0,
          values: angles[0], interpolation: "linear",
        });
      }
      continue;
    }
    for (let index = 0; index < angles.length; index++) {
      const here = angles[index];
      const prev = index > 0 ? angles[index-1] : null;
      const next = index + 1 < angles.length ? angles[index+1] : null;
      if ((!prev || equalRotation(prev,here)) &&
          (!next || equalRotation(next,here))) continue;
      baked.push({
        bone_uuid: uuid, channel: "rotation",
        time: times[index], values: here, interpolation: "linear",
      });
    }
  }
  if (!baked.length) {
    throw new Error("IK_BAKE_ZERO_ROTATION_OUTPUT: solver produced no non-neutral keyframe changes.");
  }
  return {
    state: "PREPARED_SOURCE_ONLY" as const,
    sample_origin: "CALLER_SUPPLIED_NOT_ATTESTED" as const,
    native_ik_baked: false as const,
    native_undo_verified: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
    animation_uuid: input.animation_uuid,
    duration_seconds: input.duration_seconds,
    snapping_fps: input.snapping_fps,
    expected_bone_count: expected.length,
    frame_count_per_bone: times.length,
    total_native_rotation_samples: originalSampleCount,
    planned_rotation_keyframe_count: baked.length,
    preserved_nonzero_static_tracks: constantNonZeroTrackCount,
    max_rounding_error_degrees: Number(sourceMaxRoundingErrorDegrees.toFixed(7)),
    keyframes: baked,
    note: "Native solver rotation plan only. Does not sample, bake, remove IK controllers, author keyframes, restore preview, or prove Bedrock playback.",
  };
}

/**
 * A source-only preflight of the intended authored-state delta.
 *
 * A caller-supplied sample or readiness object does NOT attest that
 * sampleIK() ran or that the editor preview has been restored. Only
 * an internal, separately accepted live native orchestration may pass its
 * fresh captured result to the unregistered native transaction adapter.
 */
export type NativeIkBakeMutationInventory = Readonly<{
  animation_uuid: string;
  animation_length: number;
  snapping_fps: number;
  selected_animation_uuid: string | null;
  rotation_tracks: readonly {
    bone_uuid: string;
    existing_keyframe_count: number;
  }[];
  controller_tracks: readonly {
    controller_uuid: string;
    existing_keyframe_count: number;
  }[];
}>;

export function requireNativeIkBakeMutationPreflight(input: {
  plan: ReturnType<typeof planNativeIkBakedKeyframes>;
  readiness: ReturnType<typeof analyzeNativeIkBakeReadiness>;
  inventory: NativeIkBakeMutationInventory;
}) {
  const { plan, readiness, inventory } = input;
  if (!plan || plan.state !== "PREPARED_SOURCE_ONLY" ||
      plan.sample_origin !== "CALLER_SUPPLIED_NOT_ATTESTED" ||
      plan.native_ik_baked !== false ||
      !readiness || readiness.state !== "candidate_source_only" ||
      readiness.blocking_reasons.length !== 0 ||
      readiness.native_ik_baked !== false) {
    throw new Error("IK_BAKE_MUTATION_NOT_ELIGIBLE: unresolved source plan or native readiness.");
  }
  if (!inventory || inventory.animation_uuid !== plan.animation_uuid ||
      inventory.selected_animation_uuid !== inventory.animation_uuid ||
      !Number.isFinite(inventory.animation_length) ||
      !Number.isSafeInteger(inventory.snapping_fps) ||
      inventory.animation_uuid !== readiness.animation_uuid ||
      inventory.animation_length !== readiness.duration_seconds ||
      inventory.snapping_fps !== readiness.snapping_fps) {
    throw new Error("IK_BAKE_MUTATION_CLIP_IDENTITY_MISMATCH: fresh selected clip required.");
  }
  const sampleTimes = nativeIkFrameTimes(
    inventory.animation_length, inventory.snapping_fps
  );
  const expectedBones = readiness.expected_sampled_group_uuids;
  if (!Array.isArray(expectedBones) || expectedBones.length === 0 ||
      plan.duration_seconds !== inventory.animation_length ||
      plan.snapping_fps !== inventory.snapping_fps ||
      plan.expected_bone_count !== expectedBones.length ||
      plan.frame_count_per_bone !== sampleTimes.length ||
      plan.total_native_rotation_samples !== expectedBones.length * sampleTimes.length ||
      plan.planned_rotation_keyframe_count !== plan.keyframes.length ||
      plan.keyframes.length < 1 ||
      plan.keyframes.length > IK_BAKE_MAX_WORK_UNITS ||
      !Array.isArray(inventory.rotation_tracks) ||
      inventory.rotation_tracks.length !== expectedBones.length) {
    throw new Error("IK_BAKE_MUTATION_SAMPLE_MISMATCH: planned bones/frames differ from current clip.");
  }
  const expectedSet = new Set(expectedBones);
  const actualBoneSet = new Set<string>();
  for (const track of inventory.rotation_tracks) {
    if (!track || !expectedSet.has(track.bone_uuid) ||
        actualBoneSet.has(track.bone_uuid)) {
      throw new Error("IK_BAKE_MUTATION_BONE_IDENTITY_MISMATCH: incomplete or duplicate bone track.");
    }
    actualBoneSet.add(track.bone_uuid);
    // A native IK bake must not erase or silently combine existing authored
    // rotation tracks without a separately approved reconciliation policy.
    if (track.existing_keyframe_count !== 0) {
      throw new Error("IK_BAKE_MUTATION_EXISTING_ROTATION_KEYS: bone " +
        track.bone_uuid + " already owns authored rotation keyframes.");
    }
  }

  if (readiness.examples_truncated ||
      !Array.isArray(readiness.examples) ||
      readiness.examples.length !== readiness.active_controller_count ||
      !Array.isArray(inventory.controller_tracks) ||
      inventory.controller_tracks.length !== readiness.active_controller_count) {
    throw new Error("IK_BAKE_MUTATION_CONTROLLER_SCOPE_INCOMPLETE: full IK controller identity is required.");
  }
  const controllerIds = new Set(readiness.examples.map((row) => row.controller_uuid));
  const observedControllers = new Set<string>();
  let removedKeyframes = 0;
  for (const track of inventory.controller_tracks) {
    if (!track || !controllerIds.has(track.controller_uuid) ||
        observedControllers.has(track.controller_uuid) ||
        !Number.isSafeInteger(track.existing_keyframe_count) ||
        track.existing_keyframe_count <= 0) {
      throw new Error("IK_BAKE_MUTATION_CONTROLLER_IDENTITY_MISMATCH: stale or duplicate IK controller.");
    }
    observedControllers.add(track.controller_uuid);
    removedKeyframes += track.existing_keyframe_count;
  }
  if (removedKeyframes !== readiness.expected_controller_keyframes_removed) {
    throw new Error("IK_BAKE_MUTATION_CONTROLLER_KEY_COUNT_CHANGED: IK keyframes changed since inspection.");
  }

  const plannedIds = new Set<string>();
  for (const keyframe of plan.keyframes) {
    if (!keyframe || !expectedSet.has(keyframe.bone_uuid) ||
        keyframe.channel !== "rotation" ||
        keyframe.interpolation !== "linear" ||
        !Number.isFinite(keyframe.time) ||
        keyframe.time < 0 || keyframe.time > inventory.animation_length ||
        !sampleTimes.includes(keyframe.time) ||
        !Array.isArray(keyframe.values) || keyframe.values.length !== 3 ||
        !keyframe.values.every(Number.isFinite)) {
      throw new Error("IK_BAKE_MUTATION_KEYFRAME_INVALID: exact finite native clock values required.");
    }
    const id = keyframe.bone_uuid + ":" + keyframe.time;
    if (plannedIds.has(id)) {
      throw new Error("IK_BAKE_MUTATION_DUPLICATE_KEYFRAME: duplicate bone/time pair.");
    }
    plannedIds.add(id);
  }
  return {
    state: "SOURCE_PREFLIGHT_ONLY" as const,
    animation_uuid: inventory.animation_uuid,
    selected_bone_count: expectedSet.size,
    planned_native_keyframe_count: plan.keyframes.length,
    controller_keyframes_to_remove: removedKeyframes,
    native_ik_baked: false as const,
    undo_executed: false as const,
    visual_verdict: "NOT_EVALUATED" as const,
  };
}
