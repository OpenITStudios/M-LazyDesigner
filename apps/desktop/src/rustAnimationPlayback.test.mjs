// Source-authored only; tests are NOT_EXECUTED while the repo hold applies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceOncePlayhead, advanceAnimationPlayhead } from './rustAnimationPlayback.ts';

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

test('loop playback wraps without stopping; hold retains its terminal pose', () => {
  const wrapped = advanceAnimationPlayhead(0.8, 450, 1, 'loop');
  assert.ok(wrapped);
  assert.ok(Math.abs(wrapped.time - 0.25) < 1e-10);
  assert.equal(wrapped.finished, false);
  const multiLoop = advanceAnimationPlayhead(0.8, 2_450, 1, 'loop');
  assert.ok(multiLoop);
  assert.ok(Math.abs(multiLoop.time - 0.25) < 1e-10);
  assert.equal(multiLoop.finished, false);
  assert.deepEqual(advanceAnimationPlayhead(0.8, 450, 1, 'hold'), {
    time: 1, finished: true,
  });
  assert.deepEqual(advanceAnimationPlayhead(0.5, 250, 1, 'hold'), {
    time: 0.75, finished: false,
  });
  assert.deepEqual(advanceAnimationPlayhead(0.8, 450, 1, 'once'), {
    time: 0, finished: true,
  });
  assert.equal(advanceAnimationPlayhead(0.5, 100, 1, 'unsupported'), null);
  assert.equal(advanceAnimationPlayhead(0.5, 100, 0, 'loop'), null);
  assert.equal(advanceAnimationPlayhead(-1, 100, 1, 'hold'), null);
});

test('the computed preview step is fresh data and does not mutate source inputs', () => {
  const state = Object.freeze({ time: 0.2, length: 1 });
  const result = advanceOncePlayhead(state.time, 40, state.length);
  assert.ok(result);
  assert.ok(Math.abs(result.time - 0.24) < 1e-10);
  assert.equal(result.finished, false);
  assert.deepEqual(state, { time: 0.2, length: 1 });
});
