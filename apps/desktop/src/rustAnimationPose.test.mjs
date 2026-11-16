// Source-authored Node regression only; NOT_EXECUTED under repo test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareBoneTransformPose, samplePreparedBoneTransformPose, projectedBoneRotationPose, projectedBoneTransformPose, projectedRotationTimelineRows, projectedTransformTimelineRows } from './rustAnimationPose.ts';

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


test('timeline rows follow Rust Bone order and sort each Bone keyframe time', () => {
  const data = animation([
    rotation('bone-b', 2, [0, 90, 0]),
    rotation('bone-a', 1, [45, 0, 0]),
    rotation('bone-a', 0, [0, 0, 0]),
    rotation('bone-b', 0, [0, 0, 0]),
  ]);
  const original = JSON.stringify(data);
  const rows = projectedRotationTimelineRows(data, [
    { uuid: 'bone-a', name: 'Arm' },
    { uuid: 'bone-b', name: 'Head' },
  ]);
  assert.deepEqual(rows.map((row) => row.boneUuid), ['bone-a', 'bone-b']);
  assert.deepEqual(rows[0].frames.map((frame) => frame.time), [0, 1]);
  assert.deepEqual(rows[1].frames.map((frame) => frame.time), [0, 2]);
  assert.deepEqual(rows.map((row) => row.boneName), ['Arm', 'Head']);
  assert.equal(JSON.stringify(data), original);
});

test('timeline does not expose malformed or unsupported imported keyframes', () => {
  const bones = [{ uuid: 'bone-a', name: 'Root' }];
  const valid = rotation('bone-a', 0, [0, 0, 0]);
  assert.deepEqual(projectedRotationTimelineRows(animation([valid], false), bones), []);
  assert.deepEqual(projectedRotationTimelineRows(
    animation([rotation('missing', 0, [0, 0, 0])]), bones,
  ), []);
  assert.deepEqual(projectedRotationTimelineRows(
    animation([valid, { ...valid, time: 1 }]), bones,
  ), []);
  assert.deepEqual(projectedRotationTimelineRows(
    animation([rotation('bone-a', 0, [100001, 0, 0])]), bones,
  ), []);
  assert.deepEqual(projectedRotationTimelineRows(animation([]), bones), []);
});


test('Rotation Position and Scale keyframes linearly interpolate independently', () => {
  const keys = [
    { uuid:'rot0', boneUuid:'bone-a', channel:'rotation', time:0, value:[0,0,0] },
    { uuid:'rot1', boneUuid:'bone-a', channel:'rotation', time:2, value:[0,90,0] },
    { uuid:'pos0', boneUuid:'bone-a', channel:'position', time:0, value:[0,0,0] },
    { uuid:'pos1', boneUuid:'bone-a', channel:'position', time:2, value:[4,2,0] },
    { uuid:'scale0', boneUuid:'bone-a', channel:'scale', time:0, value:[1,1,1] },
    { uuid:'scale1', boneUuid:'bone-a', channel:'scale', time:2, value:[2,0,1] },
    { uuid:'child', boneUuid:'bone-b', channel:'position', time:0, value:[1,0,0] },
  ];
  const clip = { ...animation([]), transformKeyframes:keys };
  const before = JSON.stringify(clip);
  const pose = projectedBoneTransformPose(clip, 1);
  assert.deepEqual(pose['bone-a'], {
    rotation: [0,45,0], position: [2,1,0], scale: [1.5,0.5,1],
  });
  assert.deepEqual(pose['bone-b'], {
    rotation: [0,0,0], position: [1,0,0], scale: [1,1,1],
  });
  assert.deepEqual(projectedBoneRotationPose(clip,1)['bone-a'], [0,45,0]);
  assert.equal(Object.getPrototypeOf(pose), null);
  assert.equal(JSON.stringify(clip),before);
});

// SOURCE-AUTHORED_NOT_RUN: model revision swaps produce a new prepared view,
// whereas playback reuses validated and time-sorted data for every frame.
test('prepared pose matches direct scrubbing and refreshes on new snapshot', () => {
  const clip = {
    ...animation([]),
    transformKeyframes: [
      { uuid:'p2', boneUuid:'bone-a', channel:'position', time:2, value:[4,0,0] },
      { uuid:'p0', boneUuid:'bone-a', channel:'position', time:0, value:[0,0,0] },
      { uuid:'r1', boneUuid:'bone-a', channel:'rotation', time:1, value:[0,45,0] },
    ],
  };
  const saved = JSON.stringify(clip);
  const prepared = prepareBoneTransformPose(clip);
  assert.ok(prepared);
  for (const time of [0, 0.25, 0.5, 1, 1.5, 2]) {
    assert.deepEqual(samplePreparedBoneTransformPose(prepared, time),
      projectedBoneTransformPose(clip, time));
  }
  assert.equal(Object.getPrototypeOf(samplePreparedBoneTransformPose(prepared, 1)), null);
  for (const time of [-1, 2.01, Number.NaN, Infinity]) {
    assert.equal(samplePreparedBoneTransformPose(prepared, time), null);
  }
  const revision = {
    ...clip,
    transformKeyframes: clip.transformKeyframes.map((frame) => frame.uuid === 'p2'
      ? {...frame, value:[8,0,0]} : frame),
  };
  const updated = prepareBoneTransformPose(revision);
  assert.deepEqual(samplePreparedBoneTransformPose(prepared, 1)['bone-a'].position, [2,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(updated, 1)['bone-a'].position, [4,0,0]);
  assert.equal(JSON.stringify(clip), saved);
  assert.equal(prepareBoneTransformPose(null), null);
  assert.equal(samplePreparedBoneTransformPose(null, 0), null);
  assert.equal(prepareBoneTransformPose({...clip, previewSupported:false}), null);
  assert.equal(prepareBoneTransformPose({...clip, transformKeyframes:[
    ...clip.transformKeyframes, {...clip.transformKeyframes[0],uuid:'p3'}
  ]}), null);
});

test('per-Bone channel timeline groups and orders by Rust Bone list and time', () => {
  const clip = {
    ...animation([]),
    transformKeyframes: [
      {uuid:'s1',boneUuid:'bone-b',channel:'scale',time:2,value:[2,2,2]},
      {uuid:'p1',boneUuid:'bone-a',channel:'position',time:1,value:[1,0,0]},
      {uuid:'r0',boneUuid:'bone-b',channel:'rotation',time:0,value:[0,0,0]},
      {uuid:'p0',boneUuid:'bone-a',channel:'position',time:0,value:[0,0,0]},
    ],
  };
  const rows = projectedTransformTimelineRows(clip, [
    {uuid:'bone-a',name:'Arm'}, {uuid:'bone-b',name:'Head'},
  ]);
  assert.deepEqual(rows.map((row)=>[row.boneName,row.channel]),[
    ['Arm','position'],['Head','rotation'],['Head','scale'],
  ]);
  assert.deepEqual(rows[0].frames.map((frame)=>frame.time),[0,1]);
  assert.deepEqual(projectedRotationTimelineRows(clip,[
    {uuid:'bone-a',name:'Arm'}, {uuid:'bone-b',name:'Head'},
  ]).map((row)=>row.boneUuid),['bone-b']);
});

test('unsupported transform axes and channel/time collisions refuse preview', () => {
  const valid = {uuid:'k1',boneUuid:'bone',channel:'scale',time:1,value:[1,1,1]};
  const mk = (frames) => ({...animation([]),transformKeyframes:frames});
  for(const bad of [
    {...valid,value:[-1,1,1]},
    {...valid,value:[101,1,1]},
    {...valid,value:[Infinity,1,1]},
    {...valid,channel:'visibility'},
    {...valid,time:3},
  ]) {
    assert.equal(projectedBoneTransformPose(mk([bad]),1),null);
  }
  const duplicate={...valid,uuid:'k2',value:[2,2,2]};
  assert.equal(projectedBoneTransformPose(mk([valid,duplicate]),1),null);
  const sameUuidDifferentChannel={...valid,channel:'position',value:[0,0,0]};
  assert.equal(projectedBoneTransformPose(mk([valid,sameUuidDifferentChannel]),1),null);
  assert.deepEqual(projectedTransformTimelineRows(mk([valid]),[
    {uuid:'unmatched',name:'Unknown'},
  ]),[]);
});
