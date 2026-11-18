// UI-only scheduling of immutable Rust recovery checkpoints. No document
// persistence, dirty authority or file access belongs to this module.
export type RecoveryRevision = { epoch: number; revision: number; dirty?: boolean };
export const RECOVERY_IDLE_MS = 30_000;
export const RECOVERY_MAX_PENDING_MS = 120_000;

export function recoveryCheckpointNeeded(
  current: RecoveryRevision,
  saved: Pick<RecoveryRevision, 'epoch' | 'revision'> | null,
): boolean {
  return current.dirty === true &&
    (saved?.epoch !== current.epoch || saved?.revision !== current.revision);
}

export function recoveryCheckpointDelay(now: number, startedAt: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(startedAt)) {
    return RECOVERY_IDLE_MS;
  }
  return Math.min(RECOVERY_IDLE_MS,
    Math.max(0, RECOVERY_MAX_PENDING_MS - (now - startedAt)));
}
