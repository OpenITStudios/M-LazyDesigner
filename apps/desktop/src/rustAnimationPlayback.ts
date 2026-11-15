// Bounded UI-only elapsed-time playback for admitted Rust/Tauri linear poses.
// Pinned Blockbench Timeline.loop resets an 'once' clip to its start at completion.
// This helper never edits authored keyframes, the Rust session or Undo history.
export type OncePlaybackStep = { time: number; finished: boolean };

export function advanceOncePlayhead(
  current: number, elapsedMs: number, length: number,
): OncePlaybackStep | null {
  if (![current, elapsedMs, length].every(Number.isFinite) ||
      length <= 0 || length > 3600 || current < 0 || current > length ||
      elapsedMs < 0) return null;
  const time = Math.min(length, current + elapsedMs / 1000);
  return time >= length ? { time: 0, finished: true }
    : { time, finished: false };
}
