export const ROOT_MOTION_BLOCKBENCH_UNITS_PER_BLOCK = 16;
export const ROOT_MOTION_TRACK_LIMIT = 3;

export type RootMotionKeyframeInput = {
  time: number;
  value: readonly unknown[];
  /** Explicit native readback cardinality; absent in legacy pure callers. */
  data_point_count?: number;
};

export type RootMotionTrackInput = {
  uuid: string;
  name: string;
  keyframes: readonly RootMotionKeyframeInput[];
};

type Vec3 = [number, number, number];

/** Accept only finite numeric values or unambiguous decimal literal strings.
 * Number(null), Number(false) and Number("") would fabricate a zero position.
 */
const DECIMAL_NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function finiteVec3(value: readonly unknown[]): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const numbers = value.map((entry) => {
    if (typeof entry === "number") return entry;
    if (typeof entry !== "string") return NaN;
    const literal = entry.trim();
    return DECIMAL_NUMERIC_VALUE.test(literal) ? Number(literal) : NaN;
  });
  if (!numbers.every(Number.isFinite)) return null;
  return numbers as Vec3;
}

function magnitude(value: readonly number[]): number {
  return Math.hypot(...value);
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function vectorRounded(value: readonly number[]): Vec3 {
  return [rounded(value[0]), rounded(value[1]), rounded(value[2])];
}

export function analyzeRootMotionTrack(
  track: RootMotionTrackInput,
  unitsPerBlock: number = ROOT_MOTION_BLOCKBENCH_UNITS_PER_BLOCK
) {
  if (!Number.isFinite(unitsPerBlock) || unitsPerBlock <= 0) {
    throw new Error("Root-motion unitsPerBlock must be finite and positive.");
  }

  const ignored = track.keyframes.length;
  const unavailable = (reason: string, numericCount: number, ignoredCount: number) => ({
    state: "unavailable" as const,
    reason,
    track: { uuid: track.uuid, name: track.name },
    numeric_keyframes: numericCount,
    ignored_keyframes: ignoredCount,
  });

  // A single getArray(0) cannot certify a native pre/post discontinuity.
  // Do not create a plausible root path from an unread or two-point key.
  if (track.keyframes.some((frame) =>
    frame.data_point_count !== undefined && frame.data_point_count !== 1
  )) {
    return unavailable("non_single_native_data_point", 0, ignored);
  }

  const numeric = track.keyframes.map((keyframe) => ({
    time: keyframe.time,
    value: finiteVec3(keyframe.value),
  })).filter(
    (sample): sample is { time: number; value: Vec3 } =>
      Number.isFinite(sample.time) && sample.time >= 0 && sample.value !== null
  ).sort((left, right) => left.time - right.time);

  // Never bridge a Molang expression or malformed middle key: its real
  // position may differ arbitrarily from the two surrounding numeric poses.
  if (numeric.length !== ignored) {
    return unavailable("non_numeric_or_invalid_position_keyframes",
      numeric.length, ignored - numeric.length);
  }

  // Duplicate same-time keys may encode a step. Picking the final array
  // element is not evidence of a continuous authored root trajectory.
  if (numeric.some((entry, index) =>
    index > 0 && entry.time === numeric[index - 1]!.time
  )) {
    return unavailable("duplicate_position_keyframe_time", numeric.length, 0);
  }
  const deduped = numeric;

  if (deduped.length < 2) {
    return {
      state: "unavailable" as const,
      reason: "insufficient_numeric_position_keyframes" as const,
      track: { uuid: track.uuid, name: track.name },
      numeric_keyframes: deduped.length,
      ignored_keyframes: ignored - numeric.length,
    };
  }

  const start = deduped[0];
  const end = deduped[deduped.length - 1];
  const duration = end.time - start.time;
  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      state: "unavailable" as const,
      reason: "non_positive_numeric_time_span" as const,
      track: { uuid: track.uuid, name: track.name },
      numeric_keyframes: deduped.length,
      ignored_keyframes: ignored - numeric.length,
    };
  }

  const displacementUnits: Vec3 = [
    end.value[0] - start.value[0],
    end.value[1] - start.value[1],
    end.value[2] - start.value[2],
  ];
  const displacementBlocks: Vec3 = displacementUnits.map(
    (value) => value / unitsPerBlock
  ) as Vec3;
  const velocityBlocksPerSecond: Vec3 = displacementBlocks.map(
    (value) => value / duration
  ) as Vec3;
  const horizontalDistanceBlocks = Math.hypot(
    displacementBlocks[0],
    displacementBlocks[2]
  );
  const distance3dBlocks = magnitude(displacementBlocks);

  const segmentSpeeds: number[] = [];
  for (let index = 1; index < deduped.length; index += 1) {
    const previous = deduped[index - 1];
    const current = deduped[index];
    const dt = current.time - previous.time;
    if (dt <= 0) continue;
    const dx = (current.value[0] - previous.value[0]) / unitsPerBlock;
    const dz = (current.value[2] - previous.value[2]) / unitsPerBlock;
    segmentSpeeds.push(Math.hypot(dx, dz) / dt);
  }
  const meanSegmentSpeed = segmentSpeeds.length
    ? segmentSpeeds.reduce((sum, value) => sum + value, 0) / segmentSpeeds.length
    : 0;
  const variance = segmentSpeeds.length
    ? segmentSpeeds.reduce(
        (sum, value) => sum + (value - meanSegmentSpeed) ** 2,
        0
      ) / segmentSpeeds.length
    : 0;
  const coefficientOfVariation =
    meanSegmentSpeed > 1e-9 ? Math.sqrt(variance) / meanSegmentSpeed : 0;

  const absDisplacement = displacementBlocks.map(Math.abs);
  const dominantIndex = absDisplacement.indexOf(Math.max(...absDisplacement));
  const dominantAxis = distance3dBlocks <= 1e-9 ? "none" : (["x", "y", "z"] as const)[dominantIndex];
  const horizontalSpeed = horizontalDistanceBlocks / duration;

  return {
    state: "available" as const,
    track: { uuid: track.uuid, name: track.name },
    units_per_block: unitsPerBlock,
    numeric_keyframes: deduped.length,
    ignored_keyframes: ignored - numeric.length,
    time_span: {
      start: rounded(start.time),
      end: rounded(end.time),
      duration: rounded(duration),
    },
    displacement_blockbench_units: vectorRounded(displacementUnits),
    displacement_blocks: vectorRounded(displacementBlocks),
    distance_blocks: rounded(distance3dBlocks),
    horizontal_distance_blocks: rounded(horizontalDistanceBlocks),
    velocity_blocks_per_second: vectorRounded(velocityBlocksPerSecond),
    horizontal_speed_blocks_per_second: rounded(horizontalSpeed),
    dominant_axis: dominantAxis,
    speed_consistency: {
      segment_count: segmentSpeeds.length,
      mean_horizontal_speed: rounded(meanSegmentSpeed),
      coefficient_of_variation: rounded(coefficientOfVariation),
      state:
        segmentSpeeds.length < 2
          ? ("insufficient_segments" as const)
          : coefficientOfVariation <= 0.1
            ? ("stable" as const)
            : ("variable" as const),
    },
  };
}

export function analyzeRootMotionTracks(
  tracks: readonly RootMotionTrackInput[],
  options: { unitsPerBlock?: number; limit?: number } = {}
) {
  const limit = options.limit ?? ROOT_MOTION_TRACK_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Root-motion track limit must be a positive integer.");
  }

  const analyzed = tracks.map((track) =>
    analyzeRootMotionTrack(
      track,
      options.unitsPerBlock ?? ROOT_MOTION_BLOCKBENCH_UNITS_PER_BLOCK
    )
  );
  const unevaluated = analyzed.filter((entry) => entry.state === "unavailable");
  const available = analyzed
    .filter((entry) => entry.state === "available")
    .sort(
      (left, right) =>
        right.horizontal_distance_blocks - left.horizontal_distance_blocks ||
        right.distance_blocks - left.distance_blocks ||
        left.track.name.localeCompare(right.track.name) ||
        left.track.uuid.localeCompare(right.track.uuid)
    );

  if (available.length === 0) {
    return {
      state: "unavailable" as const,
      reason: "no_numeric_root_position_motion" as const,
      root_track_count: tracks.length,
      diagnostics: analyzed.slice(0, limit),
      diagnostics_truncated: analyzed.length > limit,
    };
  }

  return {
    state: "available" as const,
    root_track_count: tracks.length,
    unevaluated_root_track_count: unevaluated.length,
    unevaluated_examples: unevaluated.slice(0, limit),
    unevaluated_examples_truncated: unevaluated.length > limit,
    primary: available[0],
    candidates: available.slice(0, limit),
    candidates_truncated: available.length > limit,
  };
}
