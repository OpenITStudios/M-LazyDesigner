export type AnimationPreviewFlags = {
  selected?: boolean;
  playing?: boolean;
};

export type AnimationPreviewTimeline = {
  time: number;
  playing?: boolean;
  setTime(value: number): void;
};

export type AnimationPreviewPort<TAnimation extends AnimationPreviewFlags> = {
  animations: readonly TAnimation[];
  timeline: AnimationPreviewTimeline;
  getSelectedAnimation(): TAnimation | null;
  setSelectedAnimation(animation: TAnimation | null): void;
  preview(): void;
  showDefaultPose?(): void;
  suspendEffects?(): () => void;
};

type AnimationFlagSnapshot<TAnimation extends AnimationPreviewFlags> = {
  animation: TAnimation;
  selected: boolean | undefined;
  playing: boolean | undefined;
};

function restoreOptionalBoolean(
  target: AnimationPreviewFlags,
  key: "selected" | "playing",
  value: boolean | undefined
): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function restoreTimelinePlaying(
  timeline: AnimationPreviewTimeline,
  value: boolean | undefined
): void {
  if (value === undefined) {
    delete timeline.playing;
  } else {
    timeline.playing = value;
  }
}


export const TEMPORARY_ANIMATION_POSE_SAMPLE_LIMIT = 8;

/**
 * Sequential bounded preview observations, reusing the existing transactional
 * save/restore helper for EVERY sample. This does not attest that Blockbench
 * evaluated a specific animation frame; that needs a native callback.
 * Only an explicitly invoked consumer runs preview or changes Timeline time.
 */
export async function captureTemporaryAnimationPoseSequence<
  TAnimation extends AnimationPreviewFlags,
  TResult,
>(
  port: AnimationPreviewPort<TAnimation>,
  target: TAnimation,
  durationSeconds: number,
  timesSeconds: readonly number[],
  observeAtTime: (timeSeconds: number) => TResult | Promise<TResult>
): Promise<Array<{ time_seconds: number; value: TResult }>> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
      !Array.isArray(timesSeconds) || timesSeconds.length < 2 ||
      timesSeconds.length > TEMPORARY_ANIMATION_POSE_SAMPLE_LIMIT ||
      timesSeconds.some((time, index) =>
        !Number.isFinite(time) || time < 0 || time > durationSeconds ||
        (index > 0 && time <= timesSeconds[index - 1]))) {
    throw new Error("Temporary pose sample times must be strictly ascending, in-duration and bounded to 2..8.");
  }
  const results: Array<{ time_seconds: number; value: TResult }> = [];
  for (const time of timesSeconds) {
    const value = await withTemporaryAnimationPreview(port, target, time,
      () => observeAtTime(time));
    // Never keep a mutable THREE mesh or time-varying source reference:
    // later preview steps must not rewrite earlier observed evidence.
    results.push({ time_seconds: time, value: structuredClone(value) });
  }
  return results;
}

export async function withTemporaryAnimationPreview<
  TAnimation extends AnimationPreviewFlags,
  TResult,
>(
  port: AnimationPreviewPort<TAnimation>,
  target: TAnimation,
  time: number,
  observe: () => TResult | Promise<TResult>
): Promise<TResult> {
  if (!Number.isFinite(time) || time < 0) {
    throw new Error(
      "Temporary animation preview time must be a finite value >= 0."
    );
  }
  if (!port.animations.includes(target)) {
    throw new Error(
      "Temporary animation preview target must belong to the current project animation set."
    );
  }

  const flags: AnimationFlagSnapshot<TAnimation>[] = port.animations.map(
    (animation) => ({
      animation,
      selected: animation.selected,
      playing: animation.playing,
    })
  );
  const previousSelected = port.getSelectedAnimation();
  const previousTime = port.timeline.time;
  const previousTimelinePlaying = port.timeline.playing;
  const hadPlayingAnimation = flags.some(
    (snapshot) => snapshot.playing === true
  );

  let restoreEffects: (() => void) | undefined;
  let setupStarted = false;
  let operationFailed = false;
  let operationFailure: unknown;
  let result!: TResult;

  try {
    restoreEffects = port.suspendEffects?.();
    setupStarted = true;

    port.animations.forEach((animation) => {
      animation.selected = false;
      animation.playing = false;
    });

    target.selected = true;
    target.playing = true;
    port.setSelectedAnimation(target);
    port.timeline.playing = false;
    port.timeline.setTime(time);
    port.preview();

    result = await observe();
  } catch (error) {
    operationFailed = true;
    operationFailure = error;
  }

  const restoreFailures: unknown[] = [];
  if (setupStarted) {
    try {
      flags.forEach(({ animation, selected, playing }) => {
        restoreOptionalBoolean(animation, "selected", selected);
        restoreOptionalBoolean(animation, "playing", playing);
      });
      port.setSelectedAnimation(previousSelected);
      restoreTimelinePlaying(port.timeline, previousTimelinePlaying);
      port.timeline.setTime(previousTime);

      if (hadPlayingAnimation) {
        port.preview();
      } else if (port.showDefaultPose) {
        port.showDefaultPose();
      } else {
        port.preview();
      }
    } catch (error) {
      restoreFailures.push(error);
    }
  }

  if (restoreEffects) {
    try {
      restoreEffects();
    } catch (error) {
      restoreFailures.push(error);
    }
  }

  if (operationFailed && restoreFailures.length > 0) {
    throw new AggregateError(
      [operationFailure, ...restoreFailures],
      "Temporary animation preview failed and state restoration also failed."
    );
  }
  if (operationFailed) {
    throw operationFailure;
  }
  if (restoreFailures.length === 1) {
    throw restoreFailures[0];
  }
  if (restoreFailures.length > 1) {
    throw new AggregateError(
      restoreFailures,
      "Temporary animation preview state restoration failed."
    );
  }

  return result;
}
