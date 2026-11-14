// Node 24 source authored regression, NOT_EXECUTED under test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectedCubeBounds } from './rustCubeProjection.ts';

test('default Cube keeps saved dimensions and center', () => {
  assert.deepEqual(projectedCubeBounds([0, 0, 0], [4, 6, 8], 0, [1, 1, 1]),
    { center: [2, 3, 4], size: [4, 6, 8] });
});

test('inflate and stretch compose about the original Cube center', () => {
  assert.deepEqual(projectedCubeBounds([0, 0, 0], [4, 6, 8], 1, [2, 0.5, 1.5]),
    { center: [2, 3, 4], size: [12, 4, 15] });
  assert.deepEqual(projectedCubeBounds([-2, -2, -2], [2, 2, 2], -1, [1, 1, 1]),
    { center: [0, 0, 0], size: [2, 2, 2] });
});

test('invalid, inverted and nonfinite derived sizes are not drawn as valid Cube solids', () => {
  assert.equal(projectedCubeBounds([0, 0, 0], [2, 2, 2], 0, [-1, 1, 1]), null);
  assert.equal(projectedCubeBounds([0, 0, 0], [2, 2, 2], -1, [1, 1, 1]), null);
  assert.equal(projectedCubeBounds([0, 0, 0], [2, 2, 2], Infinity, [1, 1, 1]), null);
  assert.equal(projectedCubeBounds([0, 0, 0], [2, 2, 2], 0, [1, NaN, 1]), null);
});
