// SOURCE_AUTHORED_NOT_RUN — mocked Rust CLI/SDK contract, NOT native testing.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {serializeExistingAnimationIntent,validExistingAnimationReviewReceipt}
  from './existing-animation-review.mjs';

const SHA='a'.repeat(64),clip='00000000-0000-4000-8000-000000009001',
 bone='00000000-0000-4000-8000-000000000001';
const k0='00000000-0000-4000-8000-000000009002';
const k1='00000000-0000-4000-8000-000000009003';
const k2='00000000-0000-4000-8000-000000009004';
const intent={expected_revision:0,animation_uuid:clip};
const analysis={
 scope:'source_bound_existing_numeric_animation_review',
 animation_uuid:clip,recognized:true,status:'needs_review',
 loop_mode:'loop',length_seconds:1,tracks_total:1,keyframe_count:3,
 issues_total:1,issues:[{kind:'loop_endpoint_value_difference',
  bone_uuid:bone,channel:'rotation',start_keyframe_uuid:k0,
  end_keyframe_uuid:k2,start_value:[0,0,0],end_value:[0.02,0,0],
  max_abs_axis_delta:0.02,bounded_close_candidate:true,
  native_continuity:'UNVERIFIED'}],
 track_summaries:[{bone_uuid:bone,channel:'rotation',key_count:3,
  first_time:0,last_time:1,contains_nonlinear_keys:false,
  max_authored_linear_segment_speed:40}],
 truncated:false,analysis_limit:'NUMERIC_SAVED_KEYS_ONLY',
 native_playback_verdict:'NOT_EXECUTED',
 visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED',
};
const base=()=>({
 status:'OK',sha256:SHA,summary:{revision:0},analysis,
 plan:null,preflight:null,correction_evidence:null,
 write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
});
const close={kind:'close_loop_endpoint',bone_uuid:bone,channel:'rotation',
 start_keyframe_uuid:k0,end_keyframe_uuid:k2,
 expected_start_value:[0,0,0],expected_end_value:[0.02,0,0],
 max_axis_delta:0.03};
const manual={kind:'replace_exact_key',bone_uuid:bone,channel:'rotation',
 keyframe_uuid:k1,expected_time:0.5,expected_value:[20,0,0],
 replacement_value:[21,0,0],max_axis_delta:2};
const proposal=c=>{
 const end=c.kind==='close_loop_endpoint';
 const key=end?k2:k1;
 const before=end?c.expected_end_value:c.expected_value;
 const after=end?c.expected_start_value:c.replacement_value;
 const time=end?1:c.expected_time;
 return {...base(),
  plan:{expected_revision:0,operations:[{
   op:'update_bone_transform_keyframe',animation_uuid:clip,
   bone_uuid:bone,channel:'rotation',
   keyframe_uuid:key,time,value:after,
  }],correction_scope:null},
  preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
   mutation:{revision:1,operation_count:1,changed_uuids:[key]},
   candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
   visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED'},
  correction_evidence:{
   scope:'source_bound_existing_animation_key_correction',
   kind:c.kind,animation_uuid:clip,bone_uuid:bone,channel:'rotation',
   keyframe_uuid:key,time,source_before:before,replacement:after,
   max_axis_delta:c.max_axis_delta,source_authority:'EXACT_SAVED_NUMERIC_KEY',
   native_playback_verdict:'NOT_EXECUTED',
   visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED'
  },
 };
};
test('existing numeric clip review is one SHA-bound Rust read with no approval',async()=>{
 let calls=0,approvals=0,transient=null;
 const client=createRustCodeModeClient({
  binary:'/trusted/lazydesigner-authoring',
  authorizeMutation:async()=>{approvals++;return true;},
  runner:async argv=>{
   calls++;assert.equal(argv[0],'review-existing-animation');
   assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
   transient=argv[argv.indexOf('--intent')+1];
   assert.deepEqual(JSON.parse(await readFile(transient,'utf8')),intent);
   return base();
  },
 });
 const result=await client.reviewExistingAnimation({
  input:'/abs/model.bbmodel',expectedSha256:SHA,intent,
 });
 assert.equal(result.analysis.issues[0].bone_uuid,bone);
 assert.equal(result.analysis.issues[0].bounded_close_candidate,true);
 assert.equal(result.plan,null);assert.equal(approvals,0);assert.equal(calls,1);
 await assert.rejects(readFile(transient,'utf8'),{code:'ENOENT'});
});
test('bounded endpoint closure and explicit key replacement use one native preflight',async()=>{
 for(const correction of [close,manual]){
  let calls=0,approvals=0;
  const native=proposal(correction);
  const request={...intent,correction};
  assert.equal(validExistingAnimationReviewReceipt(native,request,SHA),true);
  const client=createRustCodeModeClient({
   binary:'/trusted/lazydesigner-authoring',
   authorizeMutation:async()=>{approvals++;return true;},
   runner:async argv=>{
    calls++;
    assert.equal(argv[0],'review-existing-animation');
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--intent')+1],'utf8')),request);
    return native;
   },
  });
  const selected=await client.reviewExistingAnimation({
   input:'/abs/model.bbmodel',expectedSha256:SHA,intent:request,
  });
  assert.equal(selected.plan.operations.length,1);
  assert.equal(selected.preflight.status,'VALIDATED_NOT_APPLIED');
  assert.equal(calls,1);assert.equal(approvals,0);
 }
});
test('opaque clips remain read-only and never reveal an editable plan',async()=>{
 const unknown={...base(),analysis:{
  scope:'source_bound_existing_numeric_animation_review',
  animation_uuid:clip,recognized:false,status:'unsupported',
  reason:'OPAQUE_OR_UNSUPPORTED_CLIP',
  tracks_total:null,keyframe_count:null,issues_total:null,
  issues:[],track_summaries:[],truncated:false,
  native_playback_verdict:'NOT_EXECUTED',visual_verdict:'UNVERIFIED',
  write_authority:'NOT_GRANTED'
 }};
 assert.equal(validExistingAnimationReviewReceipt(unknown,intent,SHA),true);
 assert.equal(validExistingAnimationReviewReceipt(
  {...unknown,plan:proposal(close).plan},intent,SHA),false);
});
test('malformed source/authority/operations and unsafe corrections fail closed',async()=>{
 for(const bad of [
  {...intent,expected_revision:1},
  {...intent,animation_uuid:null},
  {...intent,extra:true},
  {...intent,correction:null},
  {...intent,correction:{...close,max_axis_delta:0.25}},
  {...intent,correction:{...close,expected_end_value:[Infinity,0,0]}},
  {...intent,correction:{...manual,replacement_value:[NaN,0,0]}},
  {...intent,correction:{...manual,channel:'scale',replacement_value:[-1,1,1]}},
 ])assert.throws(()=>serializeExistingAnimationIntent(bad));
 const request={...intent,correction:close};
 for(const forged of [
  {...proposal(close),sha256:'c'.repeat(64)},
  {...proposal(close),analysis:{...analysis,visual_verdict:'PASS'}},
  {...proposal(close),analysis:{...analysis,issues:[{...analysis.issues[0],
   bounded_close_candidate:'YES'}]}},
  {...proposal(close),plan:{...proposal(close).plan,operations:[{
   ...proposal(close).plan.operations[0],bone_uuid:'wrong-bone'}]}},
  {...proposal(close),plan:{...proposal(close).plan,operations:[
   proposal(close).plan.operations[0],{op:'remove_cube',uuid:'other'},
  ]}},
  {...proposal(close),preflight:{...proposal(close).preflight,
   write_authority:'GRANTED'}},
  {...proposal(close),correction_evidence:{...proposal(close).correction_evidence,
   native_playback_verdict:'PASS'}},
 ]) {
  assert.equal(validExistingAnimationReviewReceipt(forged,request,SHA),false);
  const client=createRustCodeModeClient({binary:'/trusted/rust',runner:async()=>forged});
  await assert.rejects(client.reviewExistingAnimation({
   input:'/abs/model.bbmodel',expectedSha256:SHA,intent:request,
  }),/CODE_MODE_EXISTING_ANIMATION_RECEIPT_INVALID/);
 }
});
