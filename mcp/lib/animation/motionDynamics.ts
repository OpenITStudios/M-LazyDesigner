export type AnimationMotionChannel = "position" | "rotation" | "scale";

export type AnimationMotionTrackInput = {
  group_uuid: string;
  group_name: string;
  channel: AnimationMotionChannel;
  // Multiple native data points may encode pre/post discontinuities.
  keyframes: Array<{ time: number; value: readonly unknown[]; data_point_count?: number }>;
};

const EPSILON = 1e-9;
const DEFAULT_EXAMPLE_LIMIT = 6;

type Vec3 = [number, number, number];

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finiteVec3(value: readonly unknown[]): Vec3 | null {
  if (
    value.length < 3 ||
    !value.slice(0, 3).every(
      (entry) => typeof entry === "number" && Number.isFinite(entry)
    )
  ) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function angularDelta(from: number, to: number): number {
  let delta = ((to - from + 180) % 360 + 360) % 360 - 180;
  if (Object.is(delta, -0)) delta = 0;
  return delta;
}

function delta(
  channel: AnimationMotionChannel,
  from: Vec3,
  to: Vec3
): Vec3 {
  return channel === "rotation"
    ? [
        angularDelta(from[0], to[0]),
        angularDelta(from[1], to[1]),
        angularDelta(from[2], to[2]),
      ]
    : [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

function divide(value: Vec3, divisor: number): Vec3 {
  return [value[0] / divisor, value[1] / divisor, value[2] / divisor];
}

function magnitude(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function analyzeTrack(track: AnimationMotionTrackInput) {
  // getArray(0) alone cannot describe a native key with 0 or 2+ data points.
  // Refuse such numeric diagnostics rather than treating a step as smooth.
  if (track.keyframes.some((frame) =>
    frame.data_point_count !== undefined && frame.data_point_count !== 1
  )) {
    return {
      state: "unavailable" as const,
      reason: "non_single_native_data_point" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: 0,
    };
  }
  const unevaluatedKeyframes = track.keyframes.filter(
    (keyframe) => !Number.isFinite(keyframe.time) || keyframe.time < 0 ||
      finiteVec3(keyframe.value) === null
  ).length;
  if (unevaluatedKeyframes > 0) {
    return {
      state: "unavailable" as const,
      reason: "non_numeric_or_invalid_keyframes" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: track.keyframes.length - unevaluatedKeyframes,
    };
  }
  const sorted = track.keyframes
    .map((keyframe) => ({
      time: Number(keyframe.time),
      value: finiteVec3(keyframe.value),
    }))
    .filter(
      (entry): entry is { time: number; value: Vec3 } =>
        Number.isFinite(entry.time) && entry.time >= 0 && entry.value !== null
    )
    .sort((left, right) => left.time - right.time);

  // Equal timestamps may represent an ordered discontinuity, and choosing
  // the final entry silently fabricates an authored velocity/path.
  if (sorted.some((entry, index) =>
    index > 0 && entry.time === sorted[index - 1]!.time
  )) {
    return {
      state: "unavailable" as const,
      reason: "duplicate_keyframe_time" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: sorted.length,
    };
  }
  const samples = sorted;

  if (samples.length < 2) {
    return {
      state: "unavailable" as const,
      reason: "insufficient_distinct_numeric_times" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: samples.length,
    };
  }

  const segments: Array<{
    midpoint: number;
    velocity: Vec3;
    speed: number;
    distance: number;
  }> = [];
  let pathLength = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const dt = current.time - previous.time;
    if (dt <= 0) continue;
    const segmentDelta = delta(track.channel, previous.value, current.value);
    const distance = magnitude(segmentDelta);
    const velocity = divide(segmentDelta, dt);
    segments.push({
      midpoint: (previous.time + current.time) / 2,
      velocity,
      speed: magnitude(velocity),
      distance,
    });
    pathLength += distance;
  }

  if (segments.length === 0) {
    return {
      state: "unavailable" as const,
      reason: "insufficient_distinct_numeric_times" as const,
      group_uuid: track.group_uuid,
      group_name: track.group_name,
      channel: track.channel,
      numeric_keyframes: samples.length,
    };
  }

  const accelerations: Array<{
    midpoint: number;
    vector: Vec3;
    magnitude: number;
  }> = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const dt = current.midpoint - previous.midpoint;
    if (dt <= 0) continue;
    const vector = divide(subtract(current.velocity, previous.velocity), dt);
    accelerations.push({
      midpoint: (previous.midpoint + current.midpoint) / 2,
      vector,
      magnitude: magnitude(vector),
    });
  }

  const jerks: number[] = [];
  for (let index = 1; index < accelerations.length; index += 1) {
    const previous = accelerations[index - 1];
    const current = accelerations[index];
    const dt = current.midpoint - previous.midpoint;
    if (dt <= 0) continue;
    jerks.push(magnitude(divide(subtract(current.vector, previous.vector), dt)));
  }

  const displacement = magnitude(
    delta(track.channel, samples[0].value, samples[samples.length - 1].value)
  );
  const speeds = segments.map((segment) => segment.speed);
  const meanSpeed = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
  const speedVariance =
    speeds.reduce((sum, value) => sum + (value - meanSpeed) ** 2, 0) /
    speeds.length;
  const firstVelocity = segments[0].velocity;
  const lastVelocity = segments[segments.length - 1].velocity;

  return {
    state: "available" as const,
    group_uuid: track.group_uuid,
    group_name: track.group_name,
    channel: track.channel,
    numeric_keyframes: samples.length,
    segment_count: segments.length,
    path_length: round(pathLength),
    displacement: round(displacement),
    closed_path: displacement <= EPSILON && pathLength > EPSILON,
    path_to_displacement_ratio:
      displacement > EPSILON ? round(pathLength / displacement) : null,
    speed: {
      mean: round(meanSpeed),
      max: round(Math.max(...speeds)),
      coefficient_of_variation:
        meanSpeed > EPSILON ? round(Math.sqrt(speedVariance) / meanSpeed) : 0,
    },
    acceleration: {
      sample_count: accelerations.length,
      max: accelerations.length
        ? round(Math.max(...accelerations.map((entry) => entry.magnitude)))
        : 0,
    },
    jerk: {
      sample_count: jerks.length,
      max: jerks.length ? round(Math.max(...jerks)) : 0,
    },
    boundary_velocity_delta: round(
      magnitude(subtract(lastVelocity, firstVelocity))
    ),
  };
}

export function analyzeAnimationMotionDynamics(input: {
  loop_mode: string;
  tracks: readonly AnimationMotionTrackInput[];
  example_limit?: number;
}) {
  const exampleLimit = input.example_limit ?? DEFAULT_EXAMPLE_LIMIT;
  const analyzed = input.tracks.map(analyzeTrack);
  const available = analyzed.filter(
    (entry): entry is Extract<(typeof analyzed)[number], { state: "available" }> =>
      entry.state === "available"
  );
  const unevaluated = analyzed.filter((entry) => entry.state === "unavailable");
  const coverage = {
    unevaluated_track_count: unevaluated.length,
    unevaluated_examples: unevaluated.slice(0, exampleLimit),
    unevaluated_examples_truncated: unevaluated.length > exampleLimit,
  };

  if (available.length === 0) {
    return {
      state: "unavailable" as const,
      reason: "no_numeric_motion_tracks" as const,
      evaluated_tracks: input.tracks.length,
      ...coverage,
    };
  }

  const ranked = available
    .slice()
    .sort(
      (left, right) =>
        right.jerk.max - left.jerk.max ||
        right.acceleration.max - left.acceleration.max ||
        right.speed.max - left.speed.max ||
        left.group_name.localeCompare(right.group_name)
    );

  const boundary = input.loop_mode === "loop"
    ? available
        .filter((entry) => entry.segment_count >= 2)
        .slice()
        .sort(
          (left, right) =>
            right.boundary_velocity_delta - left.boundary_velocity_delta ||
            left.group_name.localeCompare(right.group_name)
        )
    : [];

  // Count each moving bone once per exact interior key time, across channels.
  // Shared timestamps are review evidence, not proof of rigid motion.
  const movingBones = new Set<string>();
  const bonesByTime = new Map<number, Set<string>>();
  for (let index = 0; index < analyzed.length; index += 1) {
    const analysis = analyzed[index];
    if (analysis.state !== "available" || analysis.path_length <= EPSILON) continue;
    const track = input.tracks[index];
    movingBones.add(track.group_uuid);
    const times = [...new Set(track.keyframes.map((keyframe) => keyframe.time))]
      .sort((left, right) => left - right);
    for (const time of times.slice(1, -1)) {
      const bones = bonesByTime.get(time) ?? new Set<string>();
      bones.add(track.group_uuid);
      bonesByTime.set(time, bones);
    }
  }
  const peak = [...bonesByTime.entries()].sort(
    (left, right) => right[1].size - left[1].size || left[0] - right[0]
  )[0];
  const peakRatio = movingBones.size ? (peak?.[1].size ?? 0) / movingBones.size : 0;

  return {
    state: "available" as const,
    evaluated_tracks: input.tracks.length,
    numeric_track_count: available.length,
    ...coverage,
    key_timing: {
      moving_bone_count: movingBones.size,
      peak_shared_interior_time: peak?.[0] ?? null,
      peak_shared_bone_count: peak?.[1].size ?? 0,
      peak_shared_bone_ratio: round(peakRatio),
      review_secondary_timing: movingBones.size >= 4 && peakRatio >= 0.8,
      note: "Exact interior authored key times per track, across fully numeric moving tracks only. Shared timing may be intentional for contact; review secondary motion before staggering. This does not measure pose synchrony or certify playback.",
    },
    examples: ranked.slice(0, exampleLimit),
    examples_truncated: ranked.length > exampleLimit,
    loop_boundary_velocity: {
      applicable: input.loop_mode === "loop",
      examples: boundary.slice(0, exampleLimit).map((entry) => ({
        group_uuid: entry.group_uuid,
        group_name: entry.group_name,
        channel: entry.channel,
        boundary_velocity_delta: entry.boundary_velocity_delta,
      })),
      examples_truncated: boundary.length > exampleLimit,
    },
    note:
      "Authored-key differences only, not interpolated playback. Tracks containing expressions or invalid keys are unevaluated, never bridged across missing values. Position uses Blockbench units, rotation uses shortest-angle degrees, and scale is unitless; no artistic PASS/FAIL is inferred.",
  };
}
