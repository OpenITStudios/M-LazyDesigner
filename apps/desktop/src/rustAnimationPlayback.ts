// Read-only elapsed-time playback for admitted Rust/Tauri numeric Bone poses.
// Blockbench v5.2.1 supports once, loop and hold. This is a bounded editor
// preview (not Minecraft or native Blockbench playback proof) and never edits
// authored keyframes, the Rust session, or Undo history.
export type PreviewLoopMode = 'once' | 'loop' | 'hold';
export type OncePlaybackStep = { time: number; finished: boolean };

/** Step the view-only playhead under one of the source-backed loop modes. */
export function advanceAnimationPlayhead(
  current: number, elapsedMs: number, length: number,
  // An unsupported imported mode is an explicit no-preview result.
  mode: PreviewLoopMode | 'unsupported',
): OncePlaybackStep | null {
  if (![current, elapsedMs, length].every(Number.isFinite) ||
      length <= 0 || length > 3600 || current < 0 || current > length ||
      elapsedMs < 0 || !['once', 'loop', 'hold'].includes(mode)) return null;
  const absolute = current + elapsedMs / 1000;
  if (!Number.isFinite(absolute)) return null;
  if (mode === 'loop') {
    return { time: absolute % length, finished: false };
  }
  if (absolute >= length) {
    return { time: mode === 'once' ? 0 : length, finished: true };
  }
  return { time: absolute, finished: false };
}

/** Preserve the previous public one-shot API. */
export function advanceOncePlayhead(
  current: number, elapsedMs: number, length: number,
): OncePlaybackStep | null {
  return advanceAnimationPlayhead(current, elapsedMs, length, 'once');
}
