import { IK_BAKE_MAX_WORK_UNITS } from "./ikBakeReadiness";

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
