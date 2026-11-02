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


/**
 * Verify the actual native Bedrock AnimationCodec key inventory before
 * finishing the creation Undo transaction. A key's exported timecode is
 * generated by Blockbench's own Keyframe.getTimecodeString(), which can
 * quantize imported fractional times to the active snapping grid.
 *
 * This is track/time fidelity evidence ONLY; no pose interpolation, contact,
 * visual playback, persistence or Minecraft execution is certified.
 */
export type NativeCreationTimingTrack = {
  bone_id: string;
  channel: "position" | "rotation" | "scale" | "sound" | "particle";
  source_times: readonly number[];
  imported_times: readonly number[];
  exported_times: readonly number[];
};

// Native replacement identity window is 0.0001 seconds. Do not demand
// tighter agreement than formatted timecode precision at common frame rates.
export const NATIVE_CREATION_TIMING_TOLERANCE = 0.0001;

export function requireNativeCreationTimingIntegrity(
  tracks: readonly NativeCreationTimingTrack[]
) {
  if (!Array.isArray(tracks)) {
    throw new Error("ANIMATION_NATIVE_TIMING_INVENTORY_UNAVAILABLE");
  }
  let checkedKeyCount = 0;
  for (const track of tracks) {
    if (!track || typeof track.bone_id !== "string" ||
        !track.bone_id.trim() ||
        !["position", "rotation", "scale", "sound", "particle"].includes(track.channel) ||
        !Array.isArray(track.source_times) ||
        !Array.isArray(track.imported_times) ||
        !Array.isArray(track.exported_times)) {
      throw new Error("ANIMATION_NATIVE_TIMING_TRACK_INVALID");
    }
    if (track.source_times.length !== track.imported_times.length ||
        track.imported_times.length !== track.exported_times.length) {
      throw new Error(
        "ANIMATION_NATIVE_TIMING_KEY_LOSS: " + track.bone_id + "." + track.channel +
        " source/import/export key counts differ."
      );
    }
    const ordered = [
      [...track.source_times],
      [...track.imported_times],
      [...track.exported_times],
    ].map((times) => times.sort((a, b) => a - b));
    if (ordered.some((times) =>
      times.some((time) => !Number.isFinite(time) || time < 0 || time > 10000)
    )) {
      throw new Error("ANIMATION_NATIVE_TIMING_NONFINITE");
    }
    const [source, imported, exported] = ordered;
    for (let i = 0; i < source.length; i += 1) {
      if (i > 0 && nativeKeyframeTimesCollide(exported[i - 1], exported[i])) {
        throw new Error(
          "ANIMATION_NATIVE_TIMING_EXPORT_COLLISION: " + track.bone_id + "." +
          track.channel + " would overwrite a source key on Bedrock export."
        );
      }
      if (Math.abs(source[i] - imported[i]) > NATIVE_CREATION_TIMING_TOLERANCE) {
        throw new Error(
          "ANIMATION_NATIVE_TIMING_IMPORT_DRIFT: " + track.bone_id + "." +
          track.channel + " key " + i + " differs from authored time."
        );
      }
      if (Math.abs(source[i] - exported[i]) > NATIVE_CREATION_TIMING_TOLERANCE) {
        throw new Error(
          "ANIMATION_NATIVE_TIMING_EXPORT_SNAP: " + track.bone_id + "." +
          track.channel + " key " + i + " would move on Bedrock export."
        );
      }
    }
    checkedKeyCount += source.length;
  }
  return {
    state: "CODEC_TIMES_MATCHED" as const,
    checked_track_count: tracks.length,
    checked_keyframe_count: checkedKeyCount,
    tolerance_seconds: NATIVE_CREATION_TIMING_TOLERANCE,
    native_timing_readback_required: true as const,
    native_export_timecodes_required: true as const,
    native_playback_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}


/**
 * Resolve the native export grid of a NEW clip without moving authored keys.
 *
 * Upstream Blockbench uses Timeline.snapTime(time, animation) with an
 * effective FPS clamped to 1..120; imported Animation.snapping is a 10..500
 * integer setting. We may adjust ONLY the newly imported clip's snapping,
 * inside its existing Undo transaction, then require the actual native
 * getTimecodeString() values to pass the independent readback gate.
 *
 * This pure source planner does not mutate Blockbench, infer visual quality,
 * sample IK, or claim that any imported/editor state is verified.
 */
export type NativeCreationSnappingTrack = Pick<
  NativeCreationTimingTrack, "bone_id" | "channel" | "source_times"
>;

export const NATIVE_CREATION_MAX_EFFECTIVE_FPS = 120;

export function planNativeCreationSnapping(
  tracks: readonly NativeCreationSnappingTrack[],
  importedSnapping: number
) {
  if (!Number.isInteger(importedSnapping) ||
      importedSnapping < 10 || importedSnapping > 500) {
    throw new Error("ANIMATION_NATIVE_SNAPPING_BASELINE_INVALID");
  }
  if (!Array.isArray(tracks)) {
    throw new Error("ANIMATION_NATIVE_SNAPPING_TRACKS_INVALID");
  }

  const sourceTimes = new Set<number>();
  const sortedTracks: number[][] = [];
  let sourceKeyCount = 0;
  for (const track of tracks) {
    if (!track || typeof track.bone_id !== "string" ||
        !track.bone_id.trim() ||
        !["position", "rotation", "scale", "sound", "particle"].includes(track.channel) ||
        !Array.isArray(track.source_times)) {
      throw new Error("ANIMATION_NATIVE_SNAPPING_TRACK_INVALID");
    }
    const ordered = [...track.source_times].sort((a, b) => a - b);
    for (let index = 0; index < ordered.length; index += 1) {
      const time = ordered[index];
      if (!Number.isFinite(time) || time < 0 || time > 10000) {
        throw new Error("ANIMATION_NATIVE_SNAPPING_SOURCE_TIME_INVALID");
      }
      if (index > 0 && nativeKeyframeTimesCollide(ordered[index - 1], time)) {
        throw new Error("ANIMATION_NATIVE_SNAPPING_SOURCE_COLLISION");
      }
      sourceTimes.add(time);
    }
    sortedTracks.push(ordered);
    sourceKeyCount += ordered.length;
  }

  const preservesTimes = (fps: number): boolean => {
    const snapped = (time: number) => Math.round(time * fps) / fps;
    for (const time of sourceTimes) {
      if (Math.abs(time - snapped(time)) > NATIVE_CREATION_TIMING_TOLERANCE) {
        return false;
      }
    }
    for (const ordered of sortedTracks) {
      for (let index = 1; index < ordered.length; index += 1) {
        if (nativeKeyframeTimesCollide(
          snapped(ordered[index - 1]), snapped(ordered[index])
        )) {
          return false;
        }
      }
    }
    return true;
  };

  const baselineEffectiveFps = Math.min(
    importedSnapping, NATIVE_CREATION_MAX_EFFECTIVE_FPS
  );
  let selectedFps = importedSnapping;
  let state: "KEEP_NATIVE" | "ADJUST_NEW_CLIP" = "KEEP_NATIVE";
  if (!preservesTimes(baselineEffectiveFps)) {
    let candidate: number | null = null;
    for (let fps = 10; fps <= NATIVE_CREATION_MAX_EFFECTIVE_FPS; fps += 1) {
      if (preservesTimes(fps)) {
        candidate = fps;
        break;
      }
    }
    if (candidate === null) {
      throw new Error(
        "ANIMATION_NATIVE_SNAPPING_UNREPRESENTABLE: no supported " +
        "10..120 FPS export grid preserves all authored source times. " +
        "Adjust source keyframe times before creating a clip."
      );
    }
    selectedFps = candidate;
    state = "ADJUST_NEW_CLIP";
  }

  return {
    state,
    baseline_snapping_fps: importedSnapping,
    applied_snapping_fps: selectedFps,
    effective_export_fps: Math.min(
      selectedFps, NATIVE_CREATION_MAX_EFFECTIVE_FPS
    ),
    source_key_count: sourceKeyCount,
    scope: "NEW_NATIVE_CLIP_ONLY" as const,
    native_playback_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}
