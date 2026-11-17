// Source-authored Node regression only; NOT_EXECUTED under repo test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { poseBoneIdsToUpdate, prepareBoneTransformPose, samplePreparedBoneTransformPose, projectedBoneRotationPose, projectedBoneTransformPose, projectedRotationTimelineRows, projectedTransformTimelineRows } from './rustAnimationPose.ts';

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


// SOURCE_AUTHORED_NOT_RUN: Blockbench 5.2.1 Step is an outgoing segment
// mode. It holds the prior value until the next authored exact key time.
test('numeric Step holds prior Bone values and snaps on the next keyframe time', () => {
  const clip = {
    ...animation([]),
    transformKeyframes: [
      {uuid:'p0',boneUuid:'bone-a',channel:'position',
        time:0,value:[0,0,0],interpolation:'step'},
      {uuid:'p1',boneUuid:'bone-a',channel:'position',
        time:1,value:[2,0,0],interpolation:'linear'},
      {uuid:'p2',boneUuid:'bone-a',channel:'position',
        time:2,value:[4,0,0],interpolation:'linear'},
      {uuid:'r0',boneUuid:'bone-a',channel:'rotation',
        time:0,value:[0,0,0],interpolation:'linear'},
      {uuid:'r2',boneUuid:'bone-a',channel:'rotation',
        time:2,value:[0,90,0],interpolation:'linear'},
      {uuid:'s0',boneUuid:'bone-a',channel:'scale',
        time:0,value:[1,1,1],interpolation:'step'},
      {uuid:'s2',boneUuid:'bone-a',channel:'scale',
        time:2,value:[2,2,2],interpolation:'linear'},
      {uuid:'q0',boneUuid:'bone-b',channel:'rotation',
        time:0,value:[10,0,0],interpolation:'step'},
      {uuid:'q2',boneUuid:'bone-b',channel:'rotation',
        time:2,value:[60,0,0],interpolation:'linear'},
    ],
  };
  const original = JSON.stringify(clip);
  const prepared = prepareBoneTransformPose(clip);
  assert.ok(prepared);
  const expected = [
    [0,   [0,0,0], 0,   [1,1,1], 10],
    [0.5, [0,0,0], 22.5,[1,1,1], 10],
    [1,   [2,0,0], 45,  [1,1,1], 10],
    [1.5, [3,0,0], 67.5,[1,1,1], 10],
    [2,   [4,0,0], 90,  [2,2,2], 60],
  ];
  for (const [time, position, ry, scale, secondRotation] of expected) {
    const pose=samplePreparedBoneTransformPose(prepared,time);
    assert.deepEqual(pose['bone-a'].position,position);
    assert.deepEqual(pose['bone-a'].rotation,[0,ry,0]);
    assert.deepEqual(pose['bone-a'].scale,scale);
    assert.deepEqual(pose['bone-b'].rotation,[secondRotation,0,0]);
    assert.deepEqual(pose,projectedBoneTransformPose(clip,time));
  }
  assert.equal(JSON.stringify(clip),original);
  assert.deepEqual(projectedTransformTimelineRows(clip,[
    {uuid:'bone-a',name:'Body'},{uuid:'bone-b',name:'Arm'}
  ])[0].frames[0].interpolation,'step');
});


// SOURCE_AUTHORED_NOT_RUN: pinned Blockbench SplineCurve uses indexed,
// uniform Catmull-Rom y values and the neighbouring numeric keyframes.
test('Catmull-Rom uses adjacent keys on three Bone transform channels', () => {
  const clip = {
    ...animation([]), length: 3, loopMode: 'once',
    transformKeyframes: [
      {uuid:'p0',boneUuid:'root',channel:'position',time:0,
        value:[0,0,0],interpolation:'linear'},
      {uuid:'p1',boneUuid:'root',channel:'position',time:1,
        value:[0,0,0],interpolation:'catmullrom'},
      {uuid:'p2',boneUuid:'root',channel:'position',time:2,
        value:[10,0,0],interpolation:'linear'},
      {uuid:'p3',boneUuid:'root',channel:'position',time:3,
        value:[10,0,0],interpolation:'linear'},
      {uuid:'r0',boneUuid:'root',channel:'rotation',time:0,
        value:[0,0,0],interpolation:'step'},
      {uuid:'r1',boneUuid:'root',channel:'rotation',time:1,
        value:[0,90,0],interpolation:'catmullrom'},
      {uuid:'r2',boneUuid:'root',channel:'rotation',time:2,
        value:[0,0,0],interpolation:'linear'},
      {uuid:'s0',boneUuid:'root',channel:'scale',time:0,
        value:[1,1,1],interpolation:'catmullrom'},
      {uuid:'s2',boneUuid:'root',channel:'scale',time:2,
        value:[2,2,2],interpolation:'linear'},
    ],
  };
  const before=JSON.stringify(clip);
  const prepared=prepareBoneTransformPose(clip);
  assert.ok(prepared);
  const at0=samplePreparedBoneTransformPose(prepared,0.5);
  // Linear preceding + Catmull after still selects the spline segment.
  assert.deepEqual(at0.root.position,[-0.625,0,0]);
  assert.deepEqual(at0.root.rotation,[0,0,0]); // Step takes priority
  assert.deepEqual(at0.root.scale,[1.203125,1.203125,1.203125]);
  const at1=samplePreparedBoneTransformPose(prepared,1);
  assert.deepEqual(at1.root.position,[0,0,0]);
  assert.deepEqual(at1.root.rotation,[0,90,0]);
  const quarter=samplePreparedBoneTransformPose(prepared,1.25);
  assert.deepEqual(quarter.root.position,[2.03125,0,0]);
  const midpoint=samplePreparedBoneTransformPose(prepared,1.5);
  assert.deepEqual(midpoint.root.position,[5,0,0]);
  const threeQuarter=samplePreparedBoneTransformPose(prepared,1.75);
  assert.deepEqual(threeQuarter.root.position,[7.96875,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(prepared,3).root.position,[10,0,0]);
  assert.deepEqual(projectedBoneTransformPose(clip,1.25),quarter);
  assert.equal(JSON.stringify(clip),before);
  assert.equal(Object.getPrototypeOf(quarter),null);
  assert.equal(projectedTransformTimelineRows(clip,[{uuid:'root',name:'Root'}])
    .find(row=>row.channel==='position').frames[1].interpolation,'catmullrom');
});

test('Catmull-Rom loop neighbours wrap at track edges without editing keyframes', () => {
  const make = (loopMode) => ({
    ...animation([]), loopMode,
    transformKeyframes: [
      {uuid:'a',boneUuid:'arm',channel:'position',time:0,
        value:[0,0,0],interpolation:'catmullrom'},
      {uuid:'b',boneUuid:'arm',channel:'position',time:1,
        value:[5,0,0],interpolation:'catmullrom'},
      {uuid:'c',boneUuid:'arm',channel:'position',time:2,
        value:[10,0,0],interpolation:'linear'},
    ],
  });
  const once=prepareBoneTransformPose(make('once'));
  const loop=prepareBoneTransformPose(make('loop'));
  assert.ok(once && loop);
  assert.deepEqual(samplePreparedBoneTransformPose(once,0.5).arm.position,[2.1875,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(loop,0.5).arm.position,[1.875,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(once,1.5).arm.position,[7.8125,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(loop,1.5).arm.position,[8.125,0,0]);
  // Loop time wrapping is owned separately by the existing playhead helper.
  assert.equal(samplePreparedBoneTransformPose(loop,2.5),null);
});


// SOURCE_AUTHORED_NOT_RUN: Blockbench stores four per-axis Bezier handles.
// Monotone time inversion is evaluated directly rather than approximated by
// a precomputed fixed-200-point source-array sample.
test('Bezier Pose uses per-axis time and value handles on three Bone channels', () => {
  const handles = (leftValue, rightValue) => ({
    linked:false,
    leftTime:[-0.5,-0.5,-0.5],leftValue,
    rightTime:[0.5,0.5,0.5],rightValue,
  });
  const clip = {
    ...animation([]),
    transformKeyframes: [
      {uuid:'p0',boneUuid:'rig',channel:'position',time:0,
        value:[0,0,0],interpolation:'bezier',
        bezier:handles([0,0,0],[8,0,0])},
      {uuid:'p2',boneUuid:'rig',channel:'position',time:2,
        value:[10,0,0],interpolation:'bezier',
        bezier:handles([-1,0,0],[0,0,0])},
      {uuid:'r0',boneUuid:'rig',channel:'rotation',time:0,
        value:[0,0,0],interpolation:'bezier',
        bezier:handles([0,0,0],[0,15,0])},
      {uuid:'r2',boneUuid:'rig',channel:'rotation',time:2,
        value:[0,90,0],interpolation:'bezier',
        bezier:handles([0,-15,0],[0,0,0])},
      {uuid:'s0',boneUuid:'rig',channel:'scale',time:0,
        value:[1,1,1],interpolation:'bezier',
        bezier:handles([0,0,0],[0.2,0.2,0.2])},
      {uuid:'s2',boneUuid:'rig',channel:'scale',time:2,
        value:[2,2,2],interpolation:'bezier',
        bezier:handles([-0.2,-0.2,-0.2],[0,0,0])},
    ],
  };
  const source=JSON.stringify(clip);
  const prepared=prepareBoneTransformPose(clip);
  assert.ok(prepared);
  const mid=samplePreparedBoneTransformPose(prepared,1);
  assert.ok(Math.abs(mid.rig.position[0] - 7.625) < 1e-6);
  assert.deepEqual(mid.rig.position.slice(1),[0,0]);
  assert.ok(Math.abs(mid.rig.rotation[1] - 45) < 1e-6);
  assert.ok(Math.abs(mid.rig.scale[0] - 1.5) < 1e-6);
  assert.deepEqual(samplePreparedBoneTransformPose(prepared,0).rig.position,[0,0,0]);
  assert.deepEqual(samplePreparedBoneTransformPose(prepared,2).rig.position,[10,0,0]);
  assert.deepEqual(projectedBoneTransformPose(clip,1),mid);
  const frame=projectedTransformTimelineRows(clip,[{uuid:'rig',name:'Rig'}])
    .find(row=>row.channel==='position').frames[0];
  assert.equal(frame.interpolation,'bezier');
  assert.deepEqual(frame.bezier.rightValue,[8,0,0]);
  assert.equal(Object.getPrototypeOf(mid),null);
  assert.equal(JSON.stringify(clip),source);
});

test('Bezier time inversion handles different per-axis controls and mixed modes', () => {
  const generic=(rightTime,leftTime) => ({
    linked:false,
    leftTime:[-0.1,-0.1,-0.1],leftValue:[0,0,0],
    rightTime,rightValue:[0,0,0],
  });
  const afterHandle=(leftTime) => ({
    linked:false,leftTime,leftValue:[0,0,0],
    rightTime:[0.1,0.1,0.1],rightValue:[0,0,0],
  });
  const clip={
    ...animation([]),
    transformKeyframes:[
      {uuid:'a',boneUuid:'rig',channel:'position',time:0,
        value:[0,0,0],interpolation:'bezier',
        bezier:generic([0.1,0.5,0.8])},
      {uuid:'b',boneUuid:'rig',channel:'position',time:2,
        value:[10,10,10],interpolation:'bezier',
        bezier:afterHandle([-0.8,-0.5,-0.1])},
      {uuid:'s0',boneUuid:'rig',channel:'scale',time:0,
        value:[1,1,1],interpolation:'step'},
      {uuid:'s2',boneUuid:'rig',channel:'scale',time:2,
        value:[2,2,2],interpolation:'bezier',
        bezier:afterHandle([-0.5,-0.5,-0.5])},
    ],
  };
  const prepared=prepareBoneTransformPose(clip);
  assert.ok(prepared);
  const pose=samplePreparedBoneTransformPose(prepared,1);
  assert.ok(pose.rig.position.every(Number.isFinite));
  assert.notEqual(pose.rig.position[0],pose.rig.position[2]);
  assert.deepEqual(pose.rig.scale,[1,1,1]); // Step stays authoritative
  assert.deepEqual(samplePreparedBoneTransformPose(prepared,2).rig.scale,[2,2,2]);
  assert.equal(samplePreparedBoneTransformPose(prepared,2.01),null);
});

test('unsafe Bezier preview metadata and crossed control times refuse atomically', () => {
  const valid={
    linked:false,
    leftTime:[-0.1,-0.1,-0.1],leftValue:[0,0,0],
    rightTime:[0.1,0.1,0.1],rightValue:[0,0,0],
  };
  const base={uuid:'a',boneUuid:'rig',channel:'position',time:0,
    value:[0,0,0],interpolation:'bezier',bezier:valid};
  const mk=keys=>({...animation([]),transformKeyframes:keys});
  for(const bezier of [
    undefined,
    {...valid,linked:true,rightValue:[1,0,0]},
    {...valid,leftTime:[0.1,-0.1,-0.1]},
    {...valid,rightTime:[Number.POSITIVE_INFINITY,0.1,0.1]},
    {...valid,rightValue:[100001,0,0]},
    {...valid,rightValue:[1,0]},
    {...valid,leftValue:null},
  ]) {
    assert.equal(prepareBoneTransformPose(mk([{...base,bezier}])),null);
  }
  const after={uuid:'b',boneUuid:'rig',channel:'position',
    time:2,value:[10,0,0],interpolation:'bezier',
    bezier:{...valid,leftTime:[-1.8,-1.8,-1.8]}};
  const crossing={...base,bezier:{...valid,rightTime:[1.8,1.8,1.8]}};
  assert.equal(prepareBoneTransformPose(mk([crossing,after])),null);
  assert.equal(projectedBoneTransformPose(mk([crossing,after]),1),null);
  assert.equal(prepareBoneTransformPose(mk([
    {...base,interpolation:'linear',bezier:valid},
  ])),null);
});

test('unknown or malformed interpolation cannot produce a false supported pose', () => {
  const base = {uuid:'k0',boneUuid:'bone',channel:'position',
    time:0,value:[0,0,0],interpolation:'step'};
  const mk = frame => ({...animation([]),transformKeyframes:[frame]});
  for (const interpolation of ['bezier','ease','STEP',null,42]) {
    assert.equal(prepareBoneTransformPose(mk({...base,interpolation})),null);
    assert.equal(projectedBoneTransformPose(mk({...base,interpolation}),0),null);
  }
  // The old test-only rotation shape has no mode and remains linear for
  // backwards compatibility. Real Rust/Tauri emits the saved mode always.
  assert.deepEqual(projectedBoneTransformPose(mk({
    uuid:'k1',boneUuid:'bone',channel:'position',
    time:1,value:[1,0,0],
  }),0)['bone'].position,[1,0,0]);
  assert.equal(projectedBoneTransformPose({
    ...mk(base),previewSupported:false,
  },0),null);
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

test('preview updates only active Bone tracks and restores prior tracks on clip switch', () => {
  const sparse = Object.assign(Object.create(null), {
    'arm': {rotation:[0,15,0],position:[0,0,0],scale:[1,1,1]},
    'leg': {rotation:[0,0,25],position:[0,0,0],scale:[1,1,1]},
  });
  const previous = new Set(['head','arm']);
  const original = JSON.stringify(sparse);
  assert.deepEqual(poseBoneIdsToUpdate(previous,sparse),['head','arm','leg']);
  assert.deepEqual(poseBoneIdsToUpdate(new Set(['arm','leg']),null),['arm','leg']);
  assert.deepEqual(poseBoneIdsToUpdate(new Set(),sparse),['arm','leg']);
  assert.deepEqual(poseBoneIdsToUpdate(new Set(),null),[]);
  assert.equal(JSON.stringify(sparse),original);
  assert.deepEqual([...previous],['head','arm']);
});

test('viewport reuses Bone pivots and invalidates sparse track state on rebuild', async () => {
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('./RustViewport.svelte',import.meta.url),'utf8');
  assert.match(source,/poseBoneIdsToUpdate\(posedBones, pose\)/);
  assert.match(source,/const bound = bonePivots\.get\(uuid\)/);
  assert.match(source,/posedBones = nextPosed;/);
  assert.match(source,/posedBones\.clear\(\)/);
  assert.doesNotMatch(source,/for \(const \[uuid, \{ pivot, bindRotation, bindPosition \}\] of bonePivots\)/);
});
