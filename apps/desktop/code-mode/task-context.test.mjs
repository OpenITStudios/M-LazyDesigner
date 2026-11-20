// SOURCE-AUTHORED only. No Node/Windows/localtest execution authorized.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactTaskContext, preflightGuidance } from './task-context.mjs';

const SHA = 'a'.repeat(64);
const UUID = 'cube-helmet';
const query = Object.freeze({
  project: 'p0', expectedSha256: SHA,
  domain: 'texturing', category: 'cubes', name: 'Helmet',
});
const faces = ['north','east','south','west','up','down'].map(side => ({
  side, reference_kind: 'uuid', texture_uuid: 'armor-atlas',
  uv_zero_span: false,
}));
const exact = Object.freeze({
  status:'OK', sha256:SHA, summary:{revision:0,cubes:1,bones:1},
  results:[{kind:'authoring_target', target:{
    scope:'saved_model_named_target_orientation',
    domain:'texturing', category:'cubes', requested_name:'Helmet',
    status:'EXACT_MATCH', candidate_count:1, candidates_truncated:false,
    candidates:[{uuid:UUID,name:'Helmet',index:0}],
    selected:{identity:{uuid:UUID,name:'Helmet',index:0},source:{
      element:{uuid:UUID,kind:'cube',name:'Helmet',parent_uuid:'head-bone',
        from:[0,0,0],to:[4,4,4],origin:[0,0,0],
        faces:{north:{uv:[0,0,4,4],texture:'armor-atlas'}}},
      surfaces:{cube_uuid:UUID,visual_verdict:'UNVERIFIED',
        effective_material:'UNVERIFIED',
        uv:{box_uv:false,auto_uv:0,per_texture_rules:false},
        faces},
    }},
    candidate_operations:['paint_cube_face_regions_guarded'],
    source_blockers:[],
    visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED',
  }}],
});

test('exact task context compacts existing Rust inspect batch without raw face or image', () => {
  const ctx = compactTaskContext(exact, query);
  assert.equal(ctx.scope,'sha_bound_semantic_task_context');
  assert.equal(ctx.source_model_sha256,SHA);
  assert.equal(ctx.source_revision,0);
  assert.equal(ctx.target.uuid,UUID);
  assert.equal(ctx.target.parent_uuid,'head-bone');
  assert.deepEqual(ctx.target.geometry.from,[0,0,0]);
  assert.equal(ctx.target.face_links.length,6);
  assert.equal(ctx.target.uv.auto_uv,0);
  assert.equal(ctx.target.face_links[0].reference_kind,'uuid');
  assert.equal(ctx.write_authority,'NOT_GRANTED');
  assert.equal(ctx.visual_verdict,'UNVERIFIED');
  assert.match(ctx.next,/without an identical Rust planner preflight/);
  assert.equal(ctx.target.faces,undefined);
  assert.equal(JSON.stringify(ctx).includes('"source":{'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(ctx)) < 8192);
});

test('ambiguous target is not silently chosen as an edit target', () => {
  const target = {
    ...exact.results[0].target,
    status:'AMBIGUOUS_NAME', candidate_count:2,
    candidates:[{uuid:'one',name:'Helmet',index:0},
      {uuid:'two',name:'Helmet',index:1}],
    selected:null, candidate_operations:[],
  };
  const ctx=compactTaskContext({...exact,results:[{
    kind:'authoring_target',target,
  }]},query);
  assert.equal(ctx.target,null);
  assert.equal(ctx.status,'AMBIGUOUS_NAME');
  assert.deepEqual(ctx.candidate_operations,[]);
  assert.match(ctx.next,/Resolve the exact/);
});

test('task context rejects mismatched sources, false authority and invented artistic verdicts', () => {
  const change = (field,value) => ({
    ...exact,results:[{kind:'authoring_target',target:{
      ...exact.results[0].target,[field]:value,
    }}],
  });
  assert.throws(() => compactTaskContext({...exact,sha256:'b'.repeat(64)},query),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
  assert.throws(() => compactTaskContext(change('visual_verdict','PASS'),query),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
  assert.throws(() => compactTaskContext(change('write_authority','GRANTED'),query),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
  assert.throws(() => compactTaskContext(change('source_blockers',['code']),query),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
  assert.throws(() => compactTaskContext(change('selected',null),query),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
  assert.throws(() => compactTaskContext(exact,{...query,domain:'geometry'}),
    /CODE_MODE_TASK_CONTEXT_RECEIPT_INVALID/);
});

test('preflight guidance only considers a fully formed single rename optional', () => {
  const rename = [{op:'rename_node',uuid:UUID,name:'Helmet New'}];
  const report=preflightGuidance({operations:rename});
  assert.equal(report.recommendation,'OPTIONAL');
  assert.equal(report.write_authority,'NOT_GRANTED');
  assert.equal(report.visual_verdict,'UNVERIFIED');
  assert.equal(report.validation_authority,'RUST_APPLY_ALWAYS_REQUIRED');
  assert.deepEqual(report.reasons,[]);
  assert.equal(preflightGuidance({
    operations:[{...rename[0],code:'unexpected'}],
  }).recommendation,'RECOMMENDED');
  assert.equal(preflightGuidance({
    operations:[{op:'translate_cube',uuid:UUID,delta:[1,0,0]}],
  }).recommendation,'RECOMMENDED');
  const painted=preflightGuidance({
    operations:[{op:'paint_texture_pixel',texture_index:0,x:1,y:2,rgba:[1,2,3,255]}],
    correctionScope:{textureUuid:'atlas',allowedRegions:[{from:[1,1],to:[3,3]}]},
  });
  assert.ok(painted.reasons.includes('TEXTURE_CORRECTION_SCOPE'));
  assert.equal(painted.recommendation,'RECOMMENDED');
  const multi=preflightGuidance({operations:[...rename,...rename]});
  assert.ok(multi.reasons.includes('MULTI_OPERATION_PLAN'));
  assert.equal(multi.operation_count,2);
  assert.throws(() => preflightGuidance({operations:[]}),
    /CODE_MODE_PREFLIGHT_GUIDANCE_PLAN_INVALID/);
  assert.throws(() => preflightGuidance({operations:new Array(129).fill(rename[0])}),
    /CODE_MODE_PREFLIGHT_GUIDANCE_PLAN_INVALID/);
});
