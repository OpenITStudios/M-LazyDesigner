// SOURCE TESTS ONLY; not executed while the repository test hold applies.
import assert from 'node:assert/strict';
import test from 'node:test';
import { planCubeLocalTranslation, planCubeLocalRotation, planCubeLocalScale } from './rustMoveGizmo.ts';

test('move delta uses the selected cube parent-local transform, not world offset', () => {
  const edit = planCubeLocalTranslation(
    'cube-a', [2, -3, 1], [3.5, -2.25, -4],
  );
  assert.deepEqual(edit, {
    op: 'translate_cube', uuid: 'cube-a', delta: [1.5, 0.75, -5],
  });
});

test('identity and stationary/noisy gestures do not produce model writes', () => {
  assert.equal(planCubeLocalTranslation('', [0, 0, 0], [1, 0, 0]), null);
  assert.equal(planCubeLocalTranslation('cube', [1, 2, 3], [1, 2, 3]), null);
  assert.equal(planCubeLocalTranslation('cube', [0, 0, 0], [1e-7, 0, 0]), null);
});

test('nonfinite, malformed or excessive gestures fail closed', () => {
  assert.equal(planCubeLocalTranslation('cube', [0, 0, 0], [Number.NaN, 1, 1]), null);
  assert.equal(planCubeLocalTranslation('cube', [0, 0], [1, 1]), null);
  assert.equal(planCubeLocalTranslation('cube', [0, 0, 0], [100_001, 0, 0]), null);
  assert.equal(planCubeLocalTranslation('cube', [Number.POSITIVE_INFINITY, 0, 0], [2, 0, 0]), null);
});

test('planning a move does not modify the observed preview coordinates', () => {
  const from = [2, 0, 1];
  const to = [3, 0, 1];
  planCubeLocalTranslation('cube', from, to);
  assert.deepEqual(from, [2, 0, 1]);
  assert.deepEqual(to, [3, 0, 1]);
});

test('rotation preserves unchanged axes and commits one Rust-owned absolute edit', () => {
  assert.deepEqual(planCubeLocalRotation('cube-a', [12.5, 0, -15], [12.500000001, 45.23456789, -15]), {
    op: 'set_cube_rotation', uuid: 'cube-a',
    rotation: [12.5, 45.2346, -15],
  });
});

test('rotation rejects stationary, invalid, and excessive gestures', () => {
  assert.equal(planCubeLocalRotation('cube', [0, 0, 0], [0, 0, 0]), null);
  assert.equal(planCubeLocalRotation('cube', [30, 15, 0], [30 + 1e-7, 15, 0]), null);
  assert.equal(planCubeLocalRotation('', [0, 0, 0], [0, 0, 90]), null);
  assert.equal(planCubeLocalRotation('cube', [0, 0], [0, 0, 90]), null);
  assert.equal(planCubeLocalRotation('cube', [0, 0, 0], [Infinity, 0, 0]), null);
  assert.equal(planCubeLocalRotation('cube', [0, 0, 0], [100_001, 0, 0]), null);
});

test('rotation planning does not mutate either Euler vector', () => {
  const original = [0, 22.5, 0];
  const preview = [0, 45, 0];
  planCubeLocalRotation('cube', original, preview);
  assert.deepEqual(original, [0, 22.5, 0]);
  assert.deepEqual(preview, [0, 45, 0]);
});

test('scale proposal uses per-axis local factors and leaves source untouched', () => {
  const start = [1, 2, 1];
  const end = [1.5, 1, 2.00001];
  assert.deepEqual(planCubeLocalScale('cube-a', start, end), {
    op: 'scale_cube', uuid: 'cube-a', factors: [1.5, 0.5, 2],
  });
  assert.deepEqual(start, [1, 2, 1]);
  assert.deepEqual(end, [1.5, 1, 2.00001]);
});

test('scale rejects no-op, negative, zero, missing and nonfinite gestures', () => {
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [1, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [1.000001, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [0, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [-1, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [4.1, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1, 1], [Infinity, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 0, 1], [2, 2, 1]), null);
  assert.equal(planCubeLocalScale('', [1, 1, 1], [2, 1, 1]), null);
  assert.equal(planCubeLocalScale('cube', [1, 1], [2, 1]), null);
});
