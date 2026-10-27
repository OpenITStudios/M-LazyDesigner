export function countAnimationClipboardKeyframes(
  channels: Record<string, readonly unknown[]>
): number {
  return Object.values(channels).reduce(
    (count, keyframes) => count + keyframes.length,
    0
  );
}

export function keyframeBelongsToAnimation(
  keyframe: { animator?: { animation?: unknown } | null },
  animation: unknown
): boolean {
  return keyframe.animator?.animation === animation;
}

export function requireValidPlannedKeyframeTimes(
  times: readonly number[],
  context: string,
  rejectExactDuplicates = false
): void {
  times.forEach((time, index) => {
    if (!Number.isFinite(time) || time < 0 || time > 10000) {
      throw new Error(
        `${context} would place keyframe ${index} at invalid time ${time}; Blockbench authored keyframe time must stay within 0..10000 seconds.`
      );
    }
  });

  if (rejectExactDuplicates && new Set(times).size !== times.length) {
    throw new Error(
      `${context} would collapse multiple selected keyframes onto the same effective time. Use a different scale factor/pivot or reduce the selection.`
    );
  }
}

/**
 * Blockbench Keyframe.replaceOthers() removes another same-track keyframe
 * when abs(time delta) < 0.0001. Keep the scale planner in native parity.
 */
export const NATIVE_KEYFRAME_REPLACE_TIME_TOLERANCE = 0.0001;

export function nativeKeyframeTimesCollide(left: number, right: number): boolean {
  return Math.abs(left - right) < NATIVE_KEYFRAME_REPLACE_TIME_TOLERANCE;
}

/**
 * Planned keyframe times are unique only within one animator/channel track.
 * Distinct bones and distinct channels may share snapped timestamps.
 */
export function requireValidPlannedBatchTrackTimes<
  T extends { animator: object | null | undefined; channel: string }
>(
  keyframes: readonly T[],
  plannedTimes: readonly number[],
  context: string
): void {
  if (keyframes.length !== plannedTimes.length) {
    throw new Error(`${context} received mismatched keyframes and planned times.`);
  }
  requireValidPlannedKeyframeTimes(plannedTimes, context);
  const tracks = new Map<object, Map<string, number[]>>();
  keyframes.forEach((keyframe, index) => {
    const animator = keyframe.animator;
    if (!animator || typeof animator !== "object" || !keyframe.channel) {
      throw new Error(`${context} requires a known animator and channel for every selected keyframe.`);
    }
    let channels = tracks.get(animator);
    if (!channels) {
      channels = new Map<string, number[]>();
      tracks.set(animator, channels);
    }
    const times = channels.get(keyframe.channel) ?? [];
    times.push(plannedTimes[index]);
    channels.set(keyframe.channel, times);
  });
  for (const channels of tracks.values()) {
    for (const times of channels.values()) {
      const sorted = [...times].sort((a, b) => a - b);
      for (let index = 1; index < sorted.length; index++) {
        if (nativeKeyframeTimesCollide(sorted[index - 1], sorted[index])) {
          throw new Error(
            `${context} would collapse multiple selected keyframes onto the same effective time. Use a different scale factor/pivot or reduce the selection.`
          );
        }
      }
    }
  }
}

/**
 * Predict the unselected keyframes that native replaceOthers() will remove.
 * Full-animation Undo owns these casualties even when not selected.
 */
export function planBatchScaleOverwriteTargets<
  T extends { animator: object | null | undefined; channel: string; time: number }
>(
  selected: readonly T[],
  all: readonly T[],
  plannedTimes: readonly number[]
): T[] {
  if (selected.length !== plannedTimes.length) {
    throw new Error("Batch scale overwrite planning received mismatched keyframes and planned times.");
  }
  const selectedSet = new Set(selected);
  const casualties = new Set<T>();
  // Build one stable candidate index per invocation. Keep original per-track
  // order, selected-key exclusion and native collision tolerance intact.
  const byAnimator = new Map<T["animator"], Map<string, T[]>>();
  for (const candidate of all) {
    const animator = candidate.animator;
    let channels = byAnimator.get(animator);
    if (!channels) {
      channels = new Map<string, T[]>();
      byAnimator.set(animator, channels);
    }
    let track = channels.get(candidate.channel);
    if (!track) {
      track = [];
      channels.set(candidate.channel, track);
    }
    track.push(candidate);
  }

  selected.forEach((keyframe, index) => {
    const track = byAnimator.get(keyframe.animator)?.get(keyframe.channel) ?? [];
    for (const candidate of track) {
      if (
        candidate !== keyframe &&
        !selectedSet.has(candidate) &&
        nativeKeyframeTimesCollide(candidate.time, plannedTimes[index])
      ) {
        casualties.add(candidate);
      }
    }
  });
  return [...casualties];
}

export function requireValidPlannedPasteChannelTimes(
  channels: Readonly<Record<string, readonly number[]>>
): void {
  Object.entries(channels).forEach(([channel, times]) => {
    requireValidPlannedKeyframeTimes(
      times,
      `Animation paste ${channel} channel`,
      true
    );
  });
}



/**
 * Batch bake interpolates authored numeric channels; it does NOT sample IK
 * solver poses. Bound the full invocation before changing Timeline or Undo.
 */
export const ANIMATION_BAKE_SAMPLE_VISIT_LIMIT = 16_384;

export function requireBoundedNumericBakeSamplePlan(
  ranges: readonly Readonly<{ start: number; end: number }>[],
  interval: number
) {
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new Error("BAKE_INTERVAL_INVALID: interval must be finite and positive.");
  }
  if (!ranges.length) {
    throw new Error("BAKE_NO_ELIGIBLE_TRACKS: select two distinct-time keys on one authored numeric track.");
  }
  let plannedVisits = 0;
  for (const range of ranges) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) ||
        range.start < 0 || range.end > 10000 || range.end <= range.start) {
      throw new Error("BAKE_TRACK_RANGE_INVALID: invalid or coincident selected keyframe times.");
    }
    const visits = Math.ceil((range.end - range.start) / interval) + 1;
    if (!Number.isSafeInteger(visits) ||
        visits > ANIMATION_BAKE_SAMPLE_VISIT_LIMIT - plannedVisits) {
      throw new Error("BAKE_SAMPLE_BUDGET_EXCEEDED: maximum " +
        ANIMATION_BAKE_SAMPLE_VISIT_LIMIT + " total numeric sampling visits.");
    }
    plannedVisits += visits;
  }
  return {
    planned_sample_visits: plannedVisits,
    eligible_track_count: ranges.length,
    sample_visit_limit: ANIMATION_BAKE_SAMPLE_VISIT_LIMIT,
    bake_kind: "numeric_keyframe_interpolation" as const,
    native_ik_baked: false as const,
  };
}

export type BatchSelectionMode = "all" | "selected" | "range" | "pattern";

export type BatchSelectionRange = Readonly<{
  start: number;
  end: number;
}>;

export type BatchSelectionPattern = Readonly<{
  interval: number;
  offset: number;
}>;

export function selectBatchKeyframes<T extends { time: number }>(
  all: readonly T[],
  selected: readonly T[],
  selection: BatchSelectionMode,
  options: Readonly<{
    range?: BatchSelectionRange;
    pattern?: BatchSelectionPattern;
    tolerance?: number;
  }> = {}
): T[] {
  const tolerance = options.tolerance ?? 0.001;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error("Batch selection tolerance must be finite and greater than 0.");
  }

  let result: T[];
  switch (selection) {
    case "all":
      result = [...all];
      break;
    case "selected":
      result = [...selected];
      break;
    case "range": {
      const range = options.range;
      if (!range) throw new Error("Range required for range selection.");
      result = all.filter(
        (keyframe) => keyframe.time >= range.start && keyframe.time <= range.end
      );
      break;
    }
    case "pattern": {
      const pattern = options.pattern;
      if (!pattern) throw new Error("Pattern required for pattern selection.");
      if (!Number.isFinite(pattern.interval) || pattern.interval <= 0) {
        throw new Error("Pattern interval must be finite and greater than 0.");
      }
      if (!Number.isFinite(pattern.offset)) {
        throw new Error("Pattern offset must be finite.");
      }
      result = all.filter((keyframe) => {
        const relativeTime = keyframe.time - pattern.offset;
        // JavaScript remainder may be almost one interval at an exact
        // decimal multiple (e.g. 0.3 % 0.1). Compare distance to the nearest
        // interval boundary on either side, including negative remainders.
        const remainder = Math.abs(relativeTime % pattern.interval);
        return Math.min(remainder, pattern.interval - remainder) < tolerance;
      });
      break;
    }
  }

  if (result.length === 0) {
    throw new Error("No keyframes found matching selection criteria.");
  }
  return result;
}

export function planMirroredBatchKeyframes<
  T extends { transform?: unknown; channel?: unknown }
>(keyframes: readonly T[]): T[] {
  const mirrored = keyframes.filter(
    (keyframe) => Boolean(keyframe.transform) && keyframe.channel !== "scale"
  );
  if (mirrored.length === 0) {
    throw new Error(
      "No position or rotation transform keyframes found matching selection criteria for mirror."
    );
  }
  return mirrored;
}

export function planSmoothedBatchKeyframes<
  T extends { transform?: unknown }
>(keyframes: readonly T[]): T[] {
  const smoothed = keyframes.filter((keyframe) => Boolean(keyframe.transform));
  if (smoothed.length === 0) {
    throw new Error(
      "No transform keyframes found matching selection criteria for smooth."
    );
  }
  return smoothed;
}

export function reverseBatchTimeBounds(
  times: readonly number[]
): Readonly<{ start: number; end: number }> {
  if (times.length === 0 || !times.every(Number.isFinite)) {
    throw new Error("Reverse planning requires at least one finite keyframe time.");
  }
  return {
    start: Math.min(...times),
    end: Math.max(...times),
  };
}
