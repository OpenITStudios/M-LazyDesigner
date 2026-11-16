// Source-authored only. Repository tests remain ON_HOLD / NOT_EXECUTED.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRustCodeModeClient, openRustCodeModeProject } from './client.mjs';

const BIN = '/abs/lazydesigner-authoring';
const SHA = 'a'.repeat(64);

test('Code Mode routes focused read directly without model echo', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 }, element: { uuid: 'cube-1', kind: 'cube' } };
    },
  });
  const result = await client.inspect({ input: '/abs/model.bbmodel', uuid: 'cube-1' });
  assert.deepEqual(calls, [['inspect', '--input', '/abs/model.bbmodel', '--uuid', 'cube-1']]);
  assert.equal(result.element.kind, 'cube');
});

test('Code Mode delegates a single bounded atomic Rust transaction', async () => {
  let plan = null;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: async (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (argv) => {
      assert.equal(argv[0], 'apply');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return { status: 'OK', mutation: { revision: 1, operation_count: 1, changed_uuids: ['cube-1'] } };
    },
  });
  const receipt = await client.apply({
    input: '/abs/model.bbmodel', output: '/abs/model-next.bbmodel', expectedSha256: SHA,
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
  });
  assert.deepEqual(plan, { expected_revision: 0, operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }] });
  assert.equal(receipt.mutation.revision, 1);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].operationCount, 1);
  assert.deepEqual(approvals[0].operationKinds, ['translate_cube']);
  assert.match(approvals[0].planSha256, /^[a-f0-9]{64}$/);
});

test('Code Mode catalog and metadata inspection remain read-only and bounded', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 }, catalog: { entries: [], next_offset: null }, asset: { source_kind: 'embedded_png' } };
    },
  });
  await client.catalog({ input: '/abs/model.bbmodel', kind: 'cubes', limit: 2, offset: 1 });
  await client.inspectTexture({ input: '/abs/model.bbmodel', index: 0 });
  await client.inspectAnimation({ input: '/abs/model.bbmodel', uuid: 'an-existing-animation-id' });
  assert.deepEqual(calls[0], ['inspect', '--input', '/abs/model.bbmodel', '--list', 'cubes', '--offset', '1', '--limit', '2']);
  assert.deepEqual(calls[1], ['inspect', '--input', '/abs/model.bbmodel', '--texture-index', '0']);
  assert.deepEqual(calls[2], ['inspect', '--input', '/abs/model.bbmodel', '--animation-uuid', 'an-existing-animation-id']);
  await assert.rejects(client.catalog({ input: '/abs/model.bbmodel', kind: 'textures', limit: 65 }));
  assert.equal(calls.length, 3);
});

test('Code Mode sends bounded source texture-coverage pages using one read batch', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      const queries = JSON.parse(await readFile(argv[argv.indexOf('--queries') + 1], 'utf8'));
      assert.deepEqual(queries, { requests: [{
        kind: 'model_texture_coverage', offset: 0, limit: 2,
      }] });
      return { status: 'OK', sha256: SHA, summary: { revision: 0 },
        results: [{ kind: 'model_texture_coverage', coverage: {
          scope: 'saved_face_texture_coverage_page', visual_verdict: 'UNVERIFIED',
          total_cubes: 2, reviewed_cubes: 2, next_offset: null,
          review_candidates: 1, cubes: [],
        } }] };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectBatch([
    { kind: 'model_texture_coverage', offset: 0, limit: 2 },
  ]);
  assert.equal(result.results[0].coverage.visual_verdict, 'UNVERIFIED');
  assert.equal(result.results[0].coverage.review_candidates, 1);
  assert.equal(calls.length, 1);
  await assert.rejects(project.inspectBatch([
    { kind: 'model_texture_coverage', offset: 0, limit: 9 },
  ]), /limit/);
  await assert.rejects(project.inspectBatch([
    { kind: 'model_texture_coverage', offset: 0, limit: 2, unsafe: true },
  ]), /Unknown inspection selector or field/);
  assert.equal(calls.length, 1);
});

test('Code Mode forwards strict explicit UV-sharing selector without allowing unknown query fields', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      const queries = JSON.parse(await readFile(argv[argv.indexOf('--queries') + 1], 'utf8'));
      assert.deepEqual(queries, { requests: [{
        kind: 'cube_uv_sharing', uuid: 'cube-1', texture_uuid: 'texture-1',
      }] });
      return { status: 'OK', sha256: SHA, summary: { revision: 0 },
        results: [{ kind: 'cube_uv_sharing', uv_sharing: {
          scope: 'explicit_texture_uv_overlap', cube_uuid: 'cube-1',
          texture_uuid: 'texture-1', declared_overlap_pairs: 1,
          unresolved_explicit_faces: 0, implicit_reference_faces: 0,
          report_truncated: false, visual_verdict: 'UNVERIFIED', overlaps: [],
        } }] };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const response = await project.inspectBatch([
    { kind: 'cube_uv_sharing', uuid: 'cube-1', texture_uuid: 'texture-1' },
  ]);
  assert.equal(response.results[0].uv_sharing.declared_overlap_pairs, 1);
  assert.equal(response.results[0].uv_sharing.visual_verdict, 'UNVERIFIED');
  assert.equal(calls.length, 1);
  await assert.rejects(project.inspectBatch([{
    kind: 'cube_uv_sharing', uuid: 'cube-1', texture_uuid: 'texture-1',
    unsafe: true,
  }]), /Unknown inspection selector or field/);
  assert.equal(calls.length, 1);
});

test('Code Mode batches focused read selectors into a single Rust CLI call', async () => {
  const calls = [];
  let queryFile;
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      assert.equal(argv[0], 'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      queryFile = argv[argv.indexOf('--queries') + 1];
      const payload = JSON.parse(await readFile(queryFile, 'utf8'));
      assert.deepEqual(payload, { requests: [
        { kind: 'catalog', category: 'cubes', limit: 3 },
        { kind: 'cube_surfaces', uuid: 'cube-1' },
        { kind: 'cube_face_alpha', uuid: 'cube-1' },
        { kind: 'audit' },
      ] });
      return { status: 'OK', sha256: SHA, summary: { revision: 0 },
        results: [
          { kind: 'catalog', catalog: { entries: [], total: 1, next_offset: null } },
          { kind: 'cube_surfaces', surfaces: { cube_uuid: 'cube-1',
            visual_verdict: 'UNVERIFIED' } },
          { kind: 'cube_face_alpha', face_alpha: { face_count: 6,
            visual_verdict: 'UNVERIFIED' } },
          { kind: 'audit', audit: { visual_verdict: 'UNVERIFIED' } },
        ] };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const before = calls.length;
  const result = await project.inspectBatch([
    { kind: 'catalog', category: 'cubes', limit: 3 },
    { kind: 'cube_surfaces', uuid: 'cube-1' },
    { kind: 'cube_face_alpha', uuid: 'cube-1' },
    { kind: 'audit' },
  ]);
  assert.equal(calls.length - before, 1);
  assert.equal(result.results.length, 4);
  assert.equal(result.results[2].face_alpha.visual_verdict, 'UNVERIFIED');
  await assert.rejects(readFile(queryFile, 'utf8'), (error) => error.code === 'ENOENT');
});

test('Code Mode rejects unknown or excessive read batches before starting the CLI', async () => {
  let calls = 0;
  const client = createRustCodeModeClient({
    binary: BIN, runner: async () => { calls++; return { status: 'OK' }; },
  });
  const base = { input: '/abs/model.bbmodel', expectedSha256: SHA };
  const invalid = [
    [],
    Array.from({ length: 9 }, () => ({ kind: 'audit' })),
    [{ kind: 'unknown' }],
    [{ kind: 'audit', unrelated: true }],
    [{ kind: 'cube', uuid: '' }],
    [{ kind: 'catalog', category: 'objects' }],
    [{ kind: 'catalog', category: 'cubes', limit: 65 }],
    [{ kind: 'animation_track', animation_uuid: 'a' }],
    [{ kind: 'texture', index: -1 }],
  ];
  for (const requests of invalid) {
    await assert.rejects(client.inspectBatch({ ...base, requests }));
  }
  await assert.rejects(client.inspectBatch({
    input: '/abs/model.bbmodel', expectedSha256: 'bad',
    requests: [{ kind: 'audit' }],
  }));
  assert.equal(calls, 0);
});

test('invalid SHA, nonfinite fields and unbounded batches fail before invoking CLI', async () => {
  let count = 0;
  const client = createRustCodeModeClient({ binary: BIN, runner: async () => {
    count++;
    return { status: 'OK' };
  } });
  const base = { input: '/abs/model.bbmodel', output: '/abs/next.bbmodel' };
  await assert.rejects(client.apply({ ...base, expectedSha256: 'bad', operations: [{ op: 'remove_cube', uuid: 'cube-1' }] }));
  await assert.rejects(client.apply({ ...base, expectedSha256: SHA, operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [Infinity, 0, 0] }] }));
  await assert.rejects(client.apply({ ...base, expectedSha256: SHA, operations: Array.from({ length: 129 }, () => ({ op: 'remove_cube', uuid: 'cube-1' })) }));
  assert.equal(count, 0);
});


// SOURCE_AUTHORED_NOT_RUN: typed Code Mode can change the outgoing numeric
// interpolation of one Bone channel with the same trusted Rust plan/lease.
test('Code Mode forwards explicit Step interpolation without hiding host approval', async () => {
  const operation = {
    op:'set_bone_transform_keyframe_interpolation',
    animation_uuid:'clip-1',bone_uuid:'bone-1',keyframe_uuid:'key-1',
    channel:'rotation',interpolation:'step',
  };
  let plan;
  const approvals=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:(request)=>{
      approvals.push(request);
      return request.operation==='apply'&&request.expectedSha256===SHA;
    },
    runner:async(argv)=>{
      plan=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:1,changed_uuids:['key-1'],
      }};
    },
  });
  const receipt=await client.apply({
    input:'/abs/rig.bbmodel',output:'/abs/rig-step.bbmodel',
    expectedSha256:SHA,operations:[operation],
  });
  assert.deepEqual(plan,{expected_revision:0,operations:[operation]});
  assert.deepEqual(approvals[0].operationKinds,[
    'set_bone_transform_keyframe_interpolation',
  ]);
  assert.equal(approvals[0].operationCount,1);
  assert.deepEqual(receipt.mutation.changed_uuids,['key-1']);
});

test('Code Mode routes supported transform-channel reads and refuses unknown channels', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 },
        track: { scope: 'linear_bone_transform', recognized: true, channel: 'scale', keyframes: [] } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  await project.inspectAnimationTransformTrack('clip', 'bone', 'scale', { offset: 1, limit: 2 });
  assert.deepEqual(calls.at(-1), [
    'inspect', '--input', '/abs/model.bbmodel', '--animation-uuid', 'clip',
    '--bone-uuid', 'bone', '--track-channel', 'scale', '--frame-offset', '1',
    '--frame-limit', '2', '--expected-sha256', SHA,
  ]);
  const before = calls.length;
  await assert.rejects(project.inspectAnimationTransformTrack('clip', 'bone', 'unknown'));
  await assert.rejects(project.inspectBatch([
    { kind: 'animation_transform_track', animation_uuid: 'clip', bone_uuid: 'bone', channel: 'other' },
  ]));
  assert.equal(calls.length, before);
});



// SOURCE_AUTHORED_NOT_RUN: a Catmull-Rom interpolation change is one
// explicit, SHA-pinned edit under the same trusted host authorization.
test('Code Mode submits Catmull-Rom Bone interpolation as one Rust edit', async () => {
  const operation = {
    op: 'set_bone_transform_keyframe_interpolation',
    animation_uuid: 'clip-1', bone_uuid: 'bone-1',
    keyframe_uuid: 'key-1', channel: 'position',
    interpolation: 'catmullrom',
  };
  let plan;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: request => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async argv => {
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:1,changed_uuids:['key-1'],
      }};
    },
  });
  const receipt = await client.apply({
    input:'/abs/rig.bbmodel',output:'/abs/rig-spline.bbmodel',
    expectedSha256:SHA,operations:[operation],
  });
  assert.deepEqual(plan,{expected_revision:0,operations:[operation]});
  assert.deepEqual(approvals[0].operationKinds,[
    'set_bone_transform_keyframe_interpolation',
  ]);
  assert.equal(approvals[0].operationCount,1);
  assert.deepEqual(receipt.mutation.changed_uuids,['key-1']);
});


// SOURCE_AUTHORED_NOT_RUN: exact Blockbench Bezier handle arrays are authored
// through one host-approved Rust plan and never evaluated in the JS guest.



// SOURCE_AUTHORED_NOT_RUN: no persistent marker UUID exists in Blockbench's
// .bbmodel timeline marker copy; the editing selector is saved time.
test('Code Mode submits Timeline Marker phases through one approved Rust plan', async () => {
  const operations=[
    {op:'add_animation_timeline_marker',animation_uuid:'clip-1',
      time:0.25,name:'anticipation',color:4},
    {op:'add_animation_timeline_marker',animation_uuid:'clip-1',
      time:0.5,name:'weapon_contact',color:3},
  ];
  const approvals=[];
  let plan;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:request=>{
      approvals.push(request);
      return request.operation==='apply' && request.expectedSha256===SHA;
    },
    runner:async argv=>{
      plan=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:2,changed_uuids:['clip-1'],
      }};
    },
  });
  const receipt=await client.apply({
    input:'/abs/robot.bbmodel',output:'/abs/robot-marked.bbmodel',
    expectedSha256:SHA,operations,
  });
  assert.equal(approvals.length,1);
  assert.deepEqual(approvals[0].operationKinds,
    ['add_animation_timeline_marker','add_animation_timeline_marker']);
  assert.equal(approvals[0].operationCount,2);
  assert.deepEqual(plan,{expected_revision:0,operations});
  assert.deepEqual(receipt.mutation.changed_uuids,['clip-1']);
});

test('Code Mode batch reads Timeline Markers and Sound Events without execution', async () => {
  const calls=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    runner:async argv=>{
      calls.push(argv);
      if(argv[0]==='inspect'){
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      }
      const batch=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(batch,{requests:[
        {kind:'animation_timeline_markers',animation_uuid:'clip-1',offset:0,limit:2},
        {kind:'animation_effect_events',animation_uuid:'clip-1',offset:0,limit:1},
      ]});
      return {status:'OK',sha256:SHA,summary:{revision:0},results:[
        {kind:'animation_timeline_markers',markers:{
          scope:'saved_timeline_markers',recognized:true,
          visual_verdict:'UNVERIFIED',playback_verdict:'NOT_EXECUTED',
          animation_uuid:'clip-1',clip_length:2,total_markers:2,
          offset:0,next_offset:null,markers:[
            {name:'anticipation',time:0.25,color:4},
            {name:'contact',time:0.5,color:3},
          ],
        }},
        {kind:'animation_effect_events',effects:{
          scope:'saved_sound_particle_markers',recognized:true,
          visual_verdict:'UNVERIFIED',playback_verdict:'NOT_EXECUTED',
          animation_uuid:'clip-1',clip_length:2,total_events:1,
          offset:0,next_offset:null,events:[{
            uuid:'sound-k',channel:'sound',time:0.5,
            data_points:[{effect:'robot.hit'}],
          }],
        }},
      ]};
    },
  });
  const project=await openRustCodeModeProject(client,'/abs/robot.bbmodel');
  const result=await project.inspectBatch([
    {kind:'animation_timeline_markers',animation_uuid:'clip-1',offset:0,limit:2},
    {kind:'animation_effect_events',animation_uuid:'clip-1',offset:0,limit:1},
  ]);
  assert.equal(calls.length,2);
  assert.equal(result.results[0].markers.playback_verdict,'NOT_EXECUTED');
  assert.equal(result.results[0].markers.markers[1].name,'contact');
  assert.equal(result.results[1].effects.playback_verdict,'NOT_EXECUTED');
  for(const request of [
    {kind:'animation_timeline_markers',animation_uuid:'clip-1',limit:33},
    {kind:'animation_timeline_markers',animation_uuid:'clip-1',script:'unsafe'},
    {kind:'animation_timeline_markers',animation_uuid:''},
  ]) {
    await assert.rejects(project.inspectBatch([request]));
  }
  assert.equal(calls.length,2);
});

// SOURCE_AUTHORED_NOT_RUN: Sound/Particle marker edits remain inside the
// trusted host's one Rust transaction; no audio or emitter is executed.
test('Code Mode writes bounded Sound and Particle markers with one approval', async () => {
  const operations=[
    {op:'add_animation_effect_event',animation_uuid:'clip-1',
      keyframe_uuid:'key-sound',channel:'sound',time:0.5,
      points:[{effect:'robot.attack'}]},
    {op:'add_animation_effect_event',animation_uuid:'clip-1',
      keyframe_uuid:'key-particle',channel:'particle',time:0.5,
      points:[{effect:'studio:robot_sparks',locator:'weapon_tip',
        bind_to_actor:false}]},
  ];
  const approvals=[];
  let plan;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:request=>{
      approvals.push(request);
      return request.operation==='apply' && request.expectedSha256===SHA;
    },
    runner:async argv=>{
      plan=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:2,changed_uuids:['key-sound','key-particle'],
      }};
    },
  });
  const receipt=await client.apply({
    input:'/abs/robot.bbmodel',output:'/abs/robot-effects.bbmodel',
    expectedSha256:SHA,operations,
  });
  assert.equal(approvals.length,1);
  assert.deepEqual(approvals[0].operationKinds,
    ['add_animation_effect_event','add_animation_effect_event']);
  assert.equal(approvals[0].operationCount,2);
  assert.deepEqual(plan,{expected_revision:0,operations});
  assert.deepEqual(receipt.mutation.changed_uuids,
    ['key-sound','key-particle']);
});

test('Code Mode reads paged Sound/Particle source markers without guest playback', async () => {
  const calls=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    runner:async argv=>{
      calls.push(argv);
      if(argv[0]==='inspect'){
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      }
      const query=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(query,{requests:[{
        kind:'animation_effect_events',animation_uuid:'clip-1',offset:0,limit:1,
      }]});
      return {status:'OK',sha256:SHA,summary:{revision:0},
        results:[{kind:'animation_effect_events',effects:{
          scope:'saved_sound_particle_markers',recognized:true,
          visual_verdict:'UNVERIFIED',playback_verdict:'NOT_EXECUTED',
          animation_uuid:'clip-1',clip_length:2,total_events:1,
          offset:0,next_offset:null,events:[{uuid:'k',channel:'sound',
            time:1,data_points:[{effect:'robot.attack'}]}],
        }}]};
    },
  });
  const project=await openRustCodeModeProject(client,'/abs/robot.bbmodel');
  const response=await project.inspectBatch([{
    kind:'animation_effect_events',animation_uuid:'clip-1',offset:0,limit:1,
  }]);
  assert.equal(response.results[0].effects.playback_verdict,'NOT_EXECUTED');
  assert.equal(calls.length,2);
  for(const request of [
    {kind:'animation_effect_events',animation_uuid:'clip-1',limit:17},
    {kind:'animation_effect_events',animation_uuid:'clip-1',execute:true},
    {kind:'animation_effect_events',animation_uuid:''},
  ]) {
    await assert.rejects(project.inspectBatch([request]));
  }
  assert.equal(calls.length,2);
});

// SOURCE_AUTHORED_NOT_RUN: a whole Animation Clip variant is an approved
// semantic Rust edit, not a guest script that copies keyframes individually.
test('Code Mode duplicates a complete Bone Animation Clip in one approved plan', async () => {
  const operation = {
    op: 'duplicate_animation_clip',
    source_uuid: 'clip-walk',
    new_uuid: 'clip-attack',
    new_name: 'attack',
  };
  const approvals = [];
  let plan;
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: request => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async argv => {
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:1,changed_uuids:['clip-attack'],
      }};
    },
  });
  const result = await client.apply({
    input:'/abs/walk.bbmodel',output:'/abs/walk-attack.bbmodel',
    expectedSha256:SHA,operations:[operation],
  });
  assert.deepEqual(plan,{expected_revision:0,operations:[operation]});
  assert.equal(approvals.length,1);
  assert.deepEqual(approvals[0].operationKinds,['duplicate_animation_clip']);
  assert.equal(approvals[0].operationCount,1);
  assert.deepEqual(result.mutation.changed_uuids,['clip-attack']);
});

test('Code Mode sends complete Bezier Bone handles in one approved Rust edit', async () => {
  const handles={
    linked:false,
    leftTime:[-0.25,-0.3,-0.4],
    leftValue:[-1,0,0],
    rightTime:[0.5,0.4,0.3],
    rightValue:[3,0,0],
  };
  const operations=[
    {op:'add_bone_transform_keyframe',animation_uuid:'clip-1',
      bone_uuid:'bone-1',keyframe_uuid:'key-1',
      channel:'position',time:0,value:[0,0,0]},
    {op:'set_bone_transform_keyframe_bezier',animation_uuid:'clip-1',
      bone_uuid:'bone-1',keyframe_uuid:'key-1',
      channel:'position',handles},
  ];
  let plan;
  const approvals=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation: request=>{
      approvals.push(request);
      return request.operation==='apply' && request.expectedSha256===SHA;
    },
    runner:async argv=>{
      plan=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      return {status:'OK',mutation:{
        revision:1,operation_count:2,changed_uuids:['key-1'],
      }};
    },
  });
  const receipt=await client.apply({
    input:'/abs/rig.bbmodel',output:'/abs/rig-curved.bbmodel',
    expectedSha256:SHA,operations,
  });
  assert.deepEqual(plan,{expected_revision:0,operations});
  assert.equal(approvals.length,1);
  assert.deepEqual(approvals[0].operationKinds,[
    'add_bone_transform_keyframe','set_bone_transform_keyframe_bezier',
  ]);
  assert.equal(approvals[0].operationCount,2);
  assert.deepEqual(receipt.mutation.changed_uuids,['key-1']);
});

// SOURCE_AUTHORED_NOT_RUN: one approved Rust subtree command replaces
// per-Bone/per-Cube AI operations without bypassing host authorization.
test('Code Mode forwards one approved Bone subtree copy without per-child operations', async () => {
  const operation = {
    op: 'duplicate_bone_subtree', source_uuid: 'root-1',
    new_uuid: 'root-2', name_suffix: '_right',
  };
  let plan;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (argv) => {
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return { status: 'OK', mutation: {
        revision: 1, operation_count: 1, changed_uuids: ['root-2'],
      } };
    },
  });
  const result = await client.apply({
    input: '/abs/model.bbmodel', output: '/abs/model-clone.bbmodel',
    expectedSha256: SHA, operations: [operation],
  });
  assert.deepEqual(plan, { expected_revision: 0, operations: [operation] });
  assert.deepEqual(approvals[0].operationKinds, ['duplicate_bone_subtree']);
  assert.equal(approvals[0].operationCount, 1);
  assert.deepEqual(result.mutation.changed_uuids, ['root-2']);
});


// SOURCE_AUTHORED_NOT_RUN: the trusted host approves a single plan whose
// Rust operations clone and reflect the whole hierarchy, not one child call.
test('Code Mode groups nested rig duplication and symmetry in one approved plan', async () => {
  const operations = [
    {op:'duplicate_bone_subtree',source_uuid:'left-arm',
      new_uuid:'right-arm',name_suffix:'_right'},
    {op:'reflect_bone_subtree',uuid:'right-arm',
      axis:'x',center:8,uv_policy:'mirror'},
  ];
  let recorded;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary:BIN,
    authorizeMutation: (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (argv) => {
      recorded = JSON.parse(await readFile(argv[argv.indexOf('--plan')+1], 'utf8'));
      return {status:'OK',mutation:{revision:1,operation_count:2,
        changed_uuids:['right-arm']}};
    },
  });
  const result=await client.apply({input:'/abs/robot.bbmodel',
    output:'/abs/robot-symmetric.bbmodel',expectedSha256:SHA,operations});
  assert.deepEqual(recorded,{expected_revision:0,operations});
  assert.deepEqual(approvals[0].operationKinds,
    ['duplicate_bone_subtree','reflect_bone_subtree']);
  assert.equal(approvals[0].operationCount,2);
  assert.deepEqual(result.mutation.changed_uuids,['right-arm']);
});


// SOURCE_AUTHORED_NOT_RUN: the AI specifies face-local shading zones without
// translating them into atlas UV pixels or requesting one PNG write per zone.
test('Code Mode submits ordered Cube face-local shading as one approved Rust edit', async () => {
  const regions = [
    { face: 'north', from: [0,0], to: [4,4], rgba: [100,70,50,255], erase: false },
    { face: 'north', from: [0,0], to: [4,1], rgba: [175,130,95,255], erase: false },
    { face: 'north', from: [0,3], to: [4,4], rgba: [45,30,20,255], erase: false },
  ];
  const operation = {
    op: 'paint_cube_face_regions_guarded', cube_uuid: 'cube-1',
    texture_uuid: 'atlas-1', regions,
  };
  let plan;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: request => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async argv => {
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return {status:'OK',mutation:{revision:1,operation_count:1,
        changed_uuids:['atlas-1']}};
    },
  });
  const result = await client.apply({
    input:'/abs/model.bbmodel', output:'/abs/model-shaded.bbmodel',
    expectedSha256:SHA, operations:[operation],
  });
  assert.deepEqual(plan, {expected_revision:0,operations:[operation]});
  assert.deepEqual(approvals[0].operationKinds,['paint_cube_face_regions_guarded']);
  assert.equal(approvals[0].operationCount,1);
  assert.deepEqual(result.mutation.changed_uuids,['atlas-1']);
});


// SOURCE_AUTHORED_NOT_RUN: one SHA-pinned, explicitly approved palette
// cohort transaction replaces repeated read/paint loops. The swatches
// are literal source evidence, not generated from material labels.
test('Code Mode forwards selected multi-Cube palette remapping as one approved Rust edit', async () => {
  const operation = {
    op: 'recolor_cube_faces_palette_guarded',
    texture_uuid: 'atlas-1',
    targets: [
      { cube_uuid: 'body-1', faces: ['north', 'east'] },
      { cube_uuid: 'body-2', faces: ['north'] },
    ],
    palette: [
      { from: [80, 60, 40], to: [25, 95, 175] },
      { from: [130, 100, 70], to: [50, 165, 220] },
    ],
  };
  let plan;
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: request => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async argv => {
      plan = JSON.parse(await readFile(argv[argv.indexOf('--plan') + 1], 'utf8'));
      return { status: 'OK', mutation: {
        revision: 1, operation_count: 1, changed_uuids: ['atlas-1'],
      } };
    },
  });
  const result = await client.apply({
    input: '/abs/source.bbmodel', output: '/abs/variant.bbmodel',
    expectedSha256: SHA, operations: [operation],
  });
  assert.deepEqual(plan, { expected_revision: 0, operations: [operation] });
  assert.equal(approvals.length, 1);
  assert.deepEqual(approvals[0].operationKinds, ['recolor_cube_faces_palette_guarded']);
  assert.equal(approvals[0].operationCount, 1);
  assert.deepEqual(result.mutation.changed_uuids, ['atlas-1']);
});

test('Code Mode forwards a semantic Cube-face paint batch as one approved Rust operation', async () => {
  let plan;
  const patches = [
    { face: 'north', rgba: [200, 40, 30, 255], erase: false },
    { face: 'up', rgba: [40, 80, 200, 255], erase: false },
  ];
  const operation = {
    op: 'paint_cube_uv_faces', cube_uuid: 'cube-1',
    texture_uuid: 'atlas-1', faces: patches,
  };
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (args) => {
      plan = JSON.parse(await readFile(args[args.indexOf('--plan') + 1], 'utf8'));
      return { status: 'OK', mutation: { revision: 1, operation_count: 1,
        changed_uuids: ['atlas-1'] } };
    },
  });
  await client.apply({
    input: '/abs/model.bbmodel', output: '/abs/model-faces.bbmodel',
    expectedSha256: SHA, operations: [operation],
  });
  assert.deepEqual(plan, { expected_revision: 0, operations: [operation] });
  assert.deepEqual(approvals[0].operationKinds, ['paint_cube_uv_faces']);
  assert.equal(approvals[0].operationCount, 1);
});

test('CLI failures are not reported as successful model mutations', async () => {
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async () => true,
    runner: async () => ({ status: 'ERROR', code: 'SOURCE_SHA256_STALE' }),
  });
  await assert.rejects(client.exportGeometry({
    input: '/abs/model.bbmodel', output: '/abs/model.geo.json', expectedSha256: SHA,
  }), /SOURCE_SHA256_STALE/);
});

test('Code Mode rechecks the exact approval descriptor before launching Rust', async () => {
  let invoked = 0;
  let approved = null;
  let launchChecks = 0;
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: async (request) => {
      approved = request;
      return true;
    },
    permitWriteLaunch: (request) => {
      launchChecks++;
      assert.strictEqual(request, approved);
      // The guest could have closed after approval while the SDK created
      // the temporary edit-plan file; deny this stale session lease.
      return false;
    },
    runner: async () => {
      invoked++;
      return { status: 'OK' };
    },
  });
  await assert.rejects(client.apply({
    input: '/abs/model.bbmodel', output: '/abs/next.bbmodel',
    expectedSha256: SHA, operations: [
      { op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] },
    ],
  }), /CODE_MODE_MUTATION_SESSION_STALE/);
  assert.equal(approved.operation, 'apply');
  await assert.rejects(client.newModel({
    output: '/abs/new.bbmodel', name: 'New', modelIdentifier: 'new',
  }), /CODE_MODE_MUTATION_SESSION_STALE/);
  await assert.rejects(client.exportGeometry({
    input: '/abs/model.bbmodel', output: '/abs/model.geo.json',
    expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_SESSION_STALE/);
  assert.equal(launchChecks, 3);
  assert.equal(invoked, 0);
});

test('Code Mode denies mutations without trusted host authorization', async () => {
  let invoked = 0;
  const client = createRustCodeModeClient({
    binary: BIN, runner: async () => { invoked++; return { status: 'OK' }; },
  });
  const input = '/abs/model.bbmodel';
  const output = '/abs/model-next.bbmodel';
  await assert.rejects(client.apply({
    input, output, expectedSha256: SHA,
    operations: [{ op: 'remove_cube', uuid: 'cube-1' }],
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.newModel({
    output, name: 'New Model', modelIdentifier: 'model',
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.importPng({
    input, output, png: '/abs/p.png', uuid: 'texture-uuid', name: 'p.png',
    expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.exportPng({
    input, output: '/abs/result.png', textureUuid: 'texture-uuid', expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  await assert.rejects(client.exportGeometry({
    input, output: '/abs/result.geo.json', expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
  assert.equal(invoked, 0);
});

test('denied trusted-host approval cannot invoke Rust or create a plan', async () => {
  let invoked = 0;
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async () => false,
    runner: async () => { invoked++; return { status: 'OK' }; },
  });
  await assert.rejects(client.apply({
    input: '/abs/model.bbmodel', output: '/abs/next.bbmodel', expectedSha256: SHA,
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }],
  }), /CODE_MODE_MUTATION_NOT_APPROVED/);
  assert.equal(invoked, 0);
});

test('client can request a SHA-pinned read without changing legacy unpinned reads', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (args) => {
      calls.push(args);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  await client.inspect({ input: '/abs/model.bbmodel', uuid: 'cube-1', expectedSha256: SHA });
  assert.deepEqual(calls[0], [
    'inspect', '--input', '/abs/model.bbmodel', '--uuid', 'cube-1',
    '--expected-sha256', SHA,
  ]);
  await assert.rejects(client.inspect({
    input: '/abs/model.bbmodel', expectedSha256: 'bad-hash',
  }));
  assert.equal(calls.length, 1);
});

test('Code Mode reports six saved manual UV alpha regions without inventing face quality', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--face-alpha-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          face_alpha: {
            scope: 'saved_manual_face_uv_alpha', cube_uuid: 'cube-1',
            visual_verdict: 'UNVERIFIED', face_coverage_verdict: 'UNVERIFIED',
            effective_material: 'UNVERIFIED', face_count: 6,
            faces: [
              { side: 'north', saved_reference_kind: 'index',
                alpha: { status: 'measured', region: {
                  scope: 'saved_manual_uv_alpha_pixels', sampled_pixels: 16,
                  transparent_pixels: 14, translucent_pixels: 1, opaque_pixels: 1,
                  pixel_rect: [0, 0, 4, 4],
                } } },
              { side: 'south', saved_reference_kind: 'null',
                alpha: { status: 'unsupported', reason: 'NO_EXPLICIT_TEXTURE_REFERENCE' } },
            ],
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const inspection = await project.inspectCubeFaceAlpha('cube-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--face-alpha-uuid', 'cube-1', '--expected-sha256', SHA,
  ]);
  assert.equal(inspection.face_alpha.faces[0].alpha.region.transparent_pixels, 14);
  assert.equal(inspection.face_alpha.faces[1].alpha.status, 'unsupported');
  assert.equal(inspection.face_alpha.face_coverage_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectCubeFaceAlpha({
    input: '/abs/model.bbmodel', cubeUuid: '',
  }));
  await assert.rejects(client.inspectCubeFaceAlpha({
    input: '/abs/model.bbmodel', cubeUuid: 'cube-1', expectedSha256: 'invalid',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode reads bounded decoded atlas alpha evidence using a pinned source SHA', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--alpha-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          alpha: {
            kind: 'texture_alpha', texture_uuid: 'texture-1', texture_index: 0,
            inspection: {
              scope: 'decoded_embedded_rgba8_alpha', supported: true,
              visual_verdict: 'UNVERIFIED', face_coverage_verdict: 'UNVERIFIED',
              width: 16, height: 16, total_pixels: 256,
              transparent_pixels: 254, translucent_pixels: 1, opaque_pixels: 1,
              grid_size: [8, 8],
            },
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectTextureAlpha('texture-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--alpha-uuid', 'texture-1', '--expected-sha256', SHA,
  ]);
  assert.equal(result.alpha.inspection.transparent_pixels, 254);
  assert.equal(result.alpha.inspection.visual_verdict, 'UNVERIFIED');
  assert.equal(result.alpha.inspection.face_coverage_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectTextureAlpha({
    input: '/abs/model.bbmodel', textureUuid: '',
  }));
  await assert.rejects(client.inspectTextureAlpha({
    input: '/abs/model.bbmodel', textureUuid: 'texture-1',
    expectedSha256: 'stale-or-malformed',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode reads six authored Cube face links using an exact SHA without inferring texture coverage', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      if (argv.includes('--surface-uuid')) {
        return {
          status: 'OK', sha256: SHA, summary: { revision: 0 },
          surfaces: {
            scope: 'saved_geometry_and_face_references',
            cube_uuid: 'cube-1', visual_verdict: 'UNVERIFIED',
            effective_material: 'UNVERIFIED',
            faces: [
              { side: 'north', reference_kind: 'index', texture_index: 0,
                texture_uuid: 'texture-1', source_kind: 'embedded_png_declared' },
              { side: 'south', reference_kind: 'null', texture_index: null,
                texture_uuid: null, source_kind: null },
            ],
          },
        };
      }
      return { status: 'OK', sha256: SHA, summary: { revision: 0 } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectCubeSurfaces('cube-1');
  assert.deepEqual(calls[1], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--surface-uuid', 'cube-1', '--expected-sha256', SHA,
  ]);
  assert.equal(result.surfaces.visual_verdict, 'UNVERIFIED');
  assert.equal(result.surfaces.effective_material, 'UNVERIFIED');
  assert.equal(result.surfaces.faces[0].reference_kind, 'index');
  assert.equal(result.surfaces.faces[1].reference_kind, 'null');
  await assert.rejects(client.inspectCubeSurfaces({
    input: '/abs/model.bbmodel', cubeUuid: '',
  }));
  assert.equal(calls.length, 2);
});

test('Code Mode inspects bounded numeric Bone rotation frames without exposing opaque tracks', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      calls.push(argv);
      return {
        status: 'OK', sha256: SHA, summary: { revision: 0 },
        track: { scope: 'linear_bone_rotation', recognized: true,
          visual_verdict: 'UNVERIFIED', total_frames: 1, next_offset: null,
          animation_uuid: 'animation-1', bone_uuid: 'bone-1',
          keyframes: [{ uuid: 'key-1', time: 1, rotation: [0, 25, 0] }] },
      };
    },
  });
  const result = await client.inspectAnimationTrack({
    input: '/abs/model.bbmodel', animationUuid: 'animation-1',
    boneUuid: 'bone-1', offset: 0, limit: 16, expectedSha256: SHA,
  });
  assert.deepEqual(calls[0], [
    'inspect', '--input', '/abs/model.bbmodel',
    '--animation-uuid', 'animation-1', '--bone-uuid', 'bone-1',
    '--frame-offset', '0', '--frame-limit', '16', '--expected-sha256', SHA,
  ]);
  assert.deepEqual(result.track.keyframes[0].rotation, [0, 25, 0]);
  assert.equal(result.track.visual_verdict, 'UNVERIFIED');
  await assert.rejects(client.inspectAnimationTrack({
    input: '/abs/model.bbmodel', animationUuid: 'animation-1',
    boneUuid: 'bone-1', limit: 65,
  }));
  assert.equal(calls.length, 1);
});

test('Code Mode static model audit is read-only and explicit about unverified visuals', async () => {
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (argv) => {
      assert.deepEqual(argv, ['inspect', '--input', '/abs/model.bbmodel', '--audit', 'model']);
      return { status: 'OK', sha256: SHA,
        audit: { scope: 'static_metadata_only', visual_verdict: 'UNVERIFIED',
          faces: { total: 6, null_or_absent: 1 } } };
    },
  });
  const result = await client.audit({ input: '/abs/model.bbmodel' });
  assert.equal(result.audit.visual_verdict, 'UNVERIFIED');
});

test('path/SHA bound project reuses its identity without automatic mutation', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN, authorizeMutation: async (request) =>
      request.operation === 'apply' && request.expectedSha256 === SHA,
    runner: async (argv) => {
      calls.push(argv);
      if (argv[0] === 'inspect') {
        return { status: 'OK', sha256: SHA, summary: { revision: 0 },
          catalog: { kind: 'cubes', total: 1, entries: [], offset: 0, next_offset: null } };
      }
      return { status: 'OK', source_sha256: SHA, output_sha256: 'b'.repeat(64),
        summary: { revision: 1 },
        mutation: { revision: 1, operation_count: 1, changed_uuids: ['cube-1'] } };
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  assert.equal(project.expectedSha256, SHA);
  await project.catalog('cubes', { limit: 1 });
  await project.inspectAnimationTrack('animation-1', 'bone-1', { limit: 4 });
  const receipt = await project.apply({
    output: '/abs/model-next.bbmodel',
    operations: [{ op: 'translate_cube', uuid: 'cube-1', delta: [2, 0, 0] }],
  });
  assert.equal(receipt.source_sha256, project.expectedSha256);
  assert.equal(calls.filter((argv) => argv[0] === 'apply').length, 1);
  const readCalls = calls.filter((argv) => argv[0] === 'inspect');
  assert.equal(readCalls.length, 3);
  assert.equal(readCalls[0].includes('--expected-sha256'), false);
  assert.equal(readCalls[1][readCalls[1].indexOf('--expected-sha256') + 1], SHA);
  assert.equal(readCalls[2][readCalls[2].indexOf('--expected-sha256') + 1], SHA);
  assert.equal(readCalls[2][readCalls[2].indexOf('--frame-limit') + 1], '4');
});
