// Source-authored only; tests are NOT_EXECUTED while the repo hold applies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceOncePlayhead } from './rustAnimationPlayback.ts';

test('one-shot preview advances in seconds from frame elapsed milliseconds', () => {
  assert.deepEqual(advanceOncePlayhead(0.25, 125, 2), {
    time: 0.375, finished: false,
  });
  assert.deepEqual(advanceOncePlayhead(0.375, 0, 2), {
    time: 0.375, finished: false,
  });
});

test('once playback returns the playhead to start and reports completion', () => {
  assert.deepEqual(advanceOncePlayhead(1.75, 250, 2), {
    time: 0, finished: true,
  });
  assert.deepEqual(advanceOncePlayhead(1, 10_000, 2), {
    time: 0, finished: true,
  });
  assert.deepEqual(advanceOncePlayhead(2, 0, 2), {
    time: 0, finished: true,
  });
});

test('invalid durations, backwards time and impossible playback positions are refused', () => {
  for (const [time, elapsed, length] of [
    [0, -1, 1], [0, Infinity, 1], [NaN, 16, 1], [0, 16, 0],
    [0, 16, -1], [2, 16, 1], [-1, 16, 1], [0, 16, 3601],
  ]) {
    assert.equal(advanceOncePlayhead(time, elapsed, length), null);
  }
});

test('the computed preview step is fresh data and does not mutate source inputs', () => {
  const state = Object.freeze({ time: 0.2, length: 1 });
  const result = advanceOncePlayhead(state.time, 40, state.length);
  assert.ok(result);
  assert.ok(Math.abs(result.time - 0.24) < 1e-10);
  assert.equal(result.finished, false);
  assert.deepEqual(state, { time: 0.2, length: 1 });
});
