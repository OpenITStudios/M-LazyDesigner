// Source-authored regression only: Node/localtest remains ON_HOLD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_IDLE_MS, RECOVERY_MAX_PENDING_MS,
  recoveryCheckpointDelay, recoveryCheckpointNeeded,
} from './rustRecoverySchedule.ts';

test('checkpoint only unsaved and not-yet-backed-up Rust revisions', () => {
  const saved = { epoch: 8, revision: 3 };
  assert.equal(recoveryCheckpointNeeded({ ...saved, dirty: true }, saved), false);
  assert.equal(recoveryCheckpointNeeded({ epoch: 8, revision: 4, dirty: true }, saved), true);
  assert.equal(recoveryCheckpointNeeded({ epoch: 9, revision: 3, dirty: true }, saved), true);
  assert.equal(recoveryCheckpointNeeded({ epoch: 9, revision: 3, dirty: false }, saved), false);
  assert.equal(recoveryCheckpointNeeded({ epoch: 9, revision: 0, dirty: true }, null), true);
});

test('recovery delay has idle and continuous-edit upper bounds', () => {
  assert.equal(recoveryCheckpointDelay(0, 0), RECOVERY_IDLE_MS);
  assert.equal(recoveryCheckpointDelay(90_000, 0), RECOVERY_IDLE_MS);
  assert.equal(recoveryCheckpointDelay(110_000, 0), 10_000);
  assert.equal(recoveryCheckpointDelay(RECOVERY_MAX_PENDING_MS, 0), 0);
  assert.equal(recoveryCheckpointDelay(200_000, 0), 0);
  assert.equal(recoveryCheckpointDelay(NaN, 0), RECOVERY_IDLE_MS);
});
