// Node 24 source-authored regressions; NOT_EXECUTED under test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPaintStrokeInPlace,extendPaintStroke, MAX_STROKE_POINTS } from './rustPaintStroke.ts';

test('fast horizontal and diagonal drags include intermediate pixels', () => {
  assert.deepEqual(extendPaintStroke([[1, 2]], [4, 2], 16, 16),
    [[1, 2], [2, 2], [3, 2], [4, 2]]);
  assert.deepEqual(extendPaintStroke([[1, 1]], [4, 4], 16, 16),
    [[1, 1], [2, 2], [3, 3], [4, 4]]);
  assert.deepEqual(extendPaintStroke([], [0, 0], 16, 16), [[0, 0]]);
});

test('duplicate samples and invalid targets do not corrupt the stroke', () => {
  const original = [[2, 3]];
  assert.deepEqual(extendPaintStroke(original, [2, 3], 16, 16), original);
  assert.equal(extendPaintStroke(original, [-1, 2], 16, 16), null);
  assert.equal(extendPaintStroke(original, [Number.NaN, 2], 16, 16), null);
  assert.equal(extendPaintStroke(original, [16, 2], 16, 16), null);
  assert.equal(extendPaintStroke(original, [3, 2], 512, 16), null);
  assert.deepEqual(original, [[2, 3]]);
});

test('stroke sampling stops at the bounded Rust transaction limit', () => {
  const points = Array.from({ length: MAX_STROKE_POINTS }, () => [0, 0]);
  assert.equal(extendPaintStroke(points, [1, 0], 256, 256), null);
});

test('the final pointer position is a valid endpoint even without an intermediate move', () => {
  const initial = [[1, 2]];
  assert.deepEqual(extendPaintStroke(initial, [5, 2], 16, 16),
    [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2]]);
  assert.deepEqual(extendPaintStroke(initial, [1, 2], 16, 16), initial);
});


// SOURCE_AUTHORED_NOT_RUN: the 3D path only appends new segments and never
// re-copies the entire transient pointer history per pointermove event.
test('in-place 3D gesture append matches legacy immutable pixel interpolation',()=>{
  const points=[[1,1]];
  assert.equal(appendPaintStrokeInPlace(points,[5,4],16,16),true);
  assert.deepEqual(points,extendPaintStroke([[1,1]],[5,4],16,16));
  const snapshot=structuredClone(points);
  assert.equal(appendPaintStrokeInPlace(points,[16,4],16,16),false);
  assert.deepEqual(points,snapshot);
  const full=Array.from({length:MAX_STROKE_POINTS},()=>[0,0]);
  assert.equal(appendPaintStrokeInPlace(full,[1,0],256,256),false);
  assert.equal(full.length,MAX_STROKE_POINTS);
});
