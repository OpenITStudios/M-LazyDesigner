// Source-authored Node regression only; NOT_EXECUTED under repo test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { projectedBoneRotationPose } from './rustAnimationPose.ts';

const rotation = (boneUuid, time, values) => ({
  uuid: `kf-${boneUuid}-${time}`, boneUuid, time, rotation: values,
});
const animation = (frames, previewSupported = true) => ({
  uuid: 'anim-1', name: 'rotation', length: 2,
  rotationKeyframes: frames, previewSupported,
});

test('single Bone linear rotation scrubs between authored frames and clamps ends', () => {
  const data = animation([
    rotation('bone-a', 1, [0, 90, 0]),
    rotation('bone-a', 0, [0, 0, 0]),
  ]);
  assert.deepEqual(projectedBoneRotationPose(data, 0)['bone-a'], [0, 0, 0]);
  assert.deepEqual(projectedBoneRotationPose(data, 0.5)['bone-a'], [0, 45, 0]);
  assert.deepEqual(projectedBoneRotationPose(data, 1.5)['bone-a'], [0, 90, 0]);
});

test('independent Bone tracks contribute offsets without mutating the source', () => {
  const data = animation([
    rotation('bone-a', 0, [10, 20, 30]),
    rotation('bone-a', 2, [20, 40, 60]),
    rotation('bone-b', 0, [-10, 0, 0]),
    rotation('bone-b', 2, [10, 0, 0]),
  ]);
  const saved = JSON.stringify(data);
  const pose = projectedBoneRotationPose(data, 1);
  assert.deepEqual(pose['bone-a'], [15, 30, 45]);
  assert.deepEqual(pose['bone-b'], [0, 0, 0]);
  assert.equal(JSON.stringify(data), saved);
  assert.equal(Object.getPrototypeOf(pose), null);
});

test('empty supported animation stays in bind pose; refused track never fakes pose', () => {
  assert.deepEqual(Object.keys(projectedBoneRotationPose(animation([]), 1)), []);
  assert.equal(projectedBoneRotationPose(animation([], false), 1), null);
  assert.equal(projectedBoneRotationPose(null, 1), null);
  assert.equal(projectedBoneRotationPose(animation([]), Number.NaN), null);
  assert.equal(projectedBoneRotationPose(animation([]), 3), null);
});

test('duplicate, invalid and excessive frames fail closed', () => {
  const a = rotation('bone-a', 1, [0, 0, 0]);
  assert.equal(projectedBoneRotationPose(animation([a, {...a, uuid: 'another'}]), 1), null);
  assert.equal(projectedBoneRotationPose(animation([rotation('bone-a', 0, [Infinity, 0, 0])]), 0), null);
  assert.equal(projectedBoneRotationPose(animation([rotation('bone-a', 0, [0, 0])]), 0), null);
  assert.equal(projectedBoneRotationPose(animation([rotation('', 0, [0, 0, 0])]), 0), null);
  assert.equal(projectedBoneRotationPose(animation([rotation('bone-a', 3, [0, 0, 0])]), 0), null);
});
