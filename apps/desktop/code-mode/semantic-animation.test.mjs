// SOURCE_AUTHORED_NOT_RUN: mocked transport, not native animation proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {serializeSemanticAnimation,validSemanticAnimationReceipt}
  from './semantic-animation.mjs';

const SHA='a'.repeat(64);
const clip='00000000-0000-4000-8000-000000008811';
const bone='00000000-0000-4000-8000-000000000001';
const intent={expected_revision:0,animation_uuid:clip,name:'slam',
 length_seconds:1,loop_mode:'once',poses:[
  {time:0,phase:'neutral',transforms:[{bone_uuid:bone,channel:'rotation',value:[0,0,0]}]},
  {time:0.5,phase:'impact',transforms:[{bone_uuid:bone,channel:'rotation',value:[30,0,0]}]},
  {time:1,phase:'recovery',transforms:[{bone_uuid:bone,channel:'rotation',value:[0,0,0]}]},
 ],contacts:[{bone_uuid:bone,kind:'grip',start:0.25,end:0.75}]};
const key=i=>{
 const h=createHash('sha256').update(
  'lazydesigner:animation-semantic-poses-v1\0'+clip+'\0'+bone+'\0rotation\0'+i)
  .digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
  '-8'+h.slice(17,20)+'-'+h.slice(20,32);
};
const operations=[
 {op:'create_animation',uuid:clip,name:'slam',length:1},
 ...[0,0.5,1].map((time,i)=>({
  op:'add_bone_transform_keyframe',animation_uuid:clip,bone_uuid:bone,
  keyframe_uuid:key(i),channel:'rotation',time,
  value:i===1?[30,0,0]:[0,0,0],
 })),
 {op:'set_animation_loop_mode',animation_uuid:clip,mode:'once'},
];
const evidence={
 scope:'source_bound_semantic_pose_candidate',animation_uuid:clip,
 loop_mode:'once',pose_count:3,keyframe_count:3,track_count:1,
 tracks:[{bone_uuid:bone,channel:'rotation',key_count:3,
  maximum_authored_segment_speed:60,has_large_euler_step:false,
  loop_endpoint_equal:null,loop_endpoint_velocity_delta:null}],
 contact_windows:[{bone_uuid:bone,kind:'grip',start:0.25,end:0.75,
  observed_world_samples:0,
  contact_verdict:'REQUIRES_NATIVE_WORLD_SPACE_OBSERVATION'}],
 temporal_review_times:[0,0.25,0.5,0.75,1],
 numeric_motion_verdict:'AUTHORED_LINEAR_SEGMENTS_ONLY',
 world_contact_verdict:'UNVERIFIED',native_playback_verdict:'NOT_EXECUTED',
 visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED',
};
const receipt=()=>({
 status:'OK',sha256:SHA,summary:{revision:0},
 plan:{expected_revision:0,operations,correction_scope:null},
 preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
  mutation:{revision:1,operation_count:5,
   changed_uuids:[clip,...operations.slice(1,-1).map(o=>o.keyframe_uuid)]},
  candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
  write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
 motion_evidence:evidence,write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
});
test('semantic action compiles once through source-SHA-bound Rust, never requests write',async()=>{
 let calls=0,approvals=0,temp;
 const client=createRustCodeModeClient({binary:'/trusted/rust',
  authorizeMutation:async()=>{approvals++;return true;},
  runner:async argv=>{
   calls++;
   assert.equal(argv[0],'plan-semantic-animation');
   assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
   temp=argv[argv.indexOf('--intent')+1];
   assert.deepEqual(JSON.parse(await readFile(temp,'utf8')),intent);
   return receipt();
  }});
 const result=await client.planSemanticAnimation({
  input:'/abs/model.bbmodel',expectedSha256:SHA,intent,
 });
 assert.equal(result.plan.operations.length,5);
 assert.equal(result.motion_evidence.world_contact_verdict,'UNVERIFIED');
 assert.equal(approvals,0);
 assert.equal(calls,1);
 await assert.rejects(readFile(temp,'utf8'),{code:'ENOENT'});
});
test('invalid phase/IDs, clock, missing contact owner, or forged proof fail closed',async()=>{
 for(const input of [
  {...intent,expected_revision:1},
  {...intent,animation_uuid:null},
  {...intent,animation_uuid:123},
  {...intent,poses:[]},
  {...intent,poses:intent.poses.map((p,i)=>i===1?{...p,phase:'ghost'}:p)},
  {...intent,poses:intent.poses.map((p,i)=>i===1?{...p,time:0}:p)},
  {...intent,poses:intent.poses.map((p,i)=>i===1?{...p,transforms:[
   ...p.transforms,{...p.transforms[0]}]}:p)},
  {...intent,poses:intent.poses.map((p,i)=>i===1?{...p,transforms:[
   {...p.transforms[0],value:[Infinity,0,0]}]}:p)},
  {...intent,contacts:[{bone_uuid:'unknown',kind:'planted',start:0,end:0.5}]},
  {...intent,extra:'untrusted'},
 ])assert.throws(()=>serializeSemanticAnimation(input));
 for(const forged of [
  {...receipt(),sha256:'c'.repeat(64)},
  {...receipt(),plan:{...receipt().plan,operations:operations.map((o,i)=>
   i===2?{...o,value:[999,0,0]}:o)}},
  {...receipt(),motion_evidence:{...evidence,world_contact_verdict:'PASS'}},
  {...receipt(),motion_evidence:{...evidence,temporal_review_times:[0,0.5,0.2,1]}},
  {...receipt(),motion_evidence:{...evidence,
   contact_windows:[{...evidence.contact_windows[0],observed_world_samples:99}]}},
  {...receipt(),preflight:{...receipt().preflight,write_authority:'GRANTED'}},
 ]) {
  assert.equal(validSemanticAnimationReceipt(forged,intent,SHA),false);
  const client=createRustCodeModeClient({binary:'/trusted/rust',runner:async()=>forged});
  await assert.rejects(client.planSemanticAnimation({
   input:'/abs/model.bbmodel',expectedSha256:SHA,intent,
  }),/CODE_MODE_SEMANTIC_ANIMATION_RECEIPT_INVALID/);
 }
});


// SOURCE_AUTHORED_NOT_RUN — derived follow-through remains a read-only Rust
// plan. Fake reports exercise only SDK trust boundaries, not IK/visual quality.
test('explicit one-level cape follower stays within Bone/channel and one preflight',async()=>{
 const child='00000000-0000-4000-8000-000000008812';
 const lag={driver_bone_uuid:bone,follower_bone_uuid:child,
  channel:'rotation',lag_seconds:0.1,gain:0.5,rest_value:[0,0,0]};
 const input={...intent,contacts:[],followers:[lag],
  poses:intent.poses.map((pose,index)=>({...pose,time:[0,0.4,0.8][index]}))};
 const sourceOps=[
  operations[0],
  ...operations.slice(1,-1).map((op,index)=>({...op,time:[0,0.4,0.8][index]})),
 ];
 const followerKey=i=>{
  const h=createHash('sha256').update(
   'lazydesigner:animation-semantic-poses-v1\0'+clip+'\0'+child+
   '\0rotation\0'+i).digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
   '-8'+h.slice(17,20)+'-'+h.slice(20,32);
 };
 const derived=[0,0.1,0.5,0.9,1].map((time,i)=>({
  op:'add_bone_transform_keyframe',animation_uuid:clip,
  bone_uuid:child,keyframe_uuid:followerKey(i),channel:'rotation',time,
  value:i===2?[15,0,0]:[0,0,0],
 }));
 const combined=[...sourceOps,...derived,operations.at(-1)];
 const secondReport={
  ...evidence,contact_windows:[],pose_count:3,keyframe_count:8,track_count:2,
  tracks:[
   {...evidence.tracks[0],maximum_authored_segment_speed:75},
   {bone_uuid:child,channel:'rotation',key_count:5,
    maximum_authored_segment_speed:37.5,has_large_euler_step:false,
    loop_endpoint_equal:null,loop_endpoint_velocity_delta:null},
  ],
  temporal_review_times:[0,0.1,0.4,0.5,0.8,0.9,1],
  secondary_verdict:'SOURCE_LINEAR_LAG_ONLY',
  secondary_followers:[{
   ...lag,driver_key_count:3,derived_key_count:5,
   sampling_model:'SOURCE_LINEAR_DELAYED_DELTA',contact_verdict:'UNVERIFIED',
   loop_or_settle_endpoint_values_equal:true,
  }],
 };
 const candidate={
  ...receipt(),plan:{...receipt().plan,operations:combined},
  preflight:{...receipt().preflight,mutation:{
   revision:1,operation_count:combined.length,
   changed_uuids:[clip,...combined.slice(1,-1).map(o=>o.keyframe_uuid)],
  }},
  motion_evidence:secondReport,
 };
 assert.equal(validSemanticAnimationReceipt(candidate,input,SHA),true);
 let approvals=0,calls=0;
 const client=createRustCodeModeClient({binary:'/trusted/rust',
  authorizeMutation:async()=>{approvals++;return true;},
  runner:async argv=>{
   calls++;
   assert.equal(argv[0],'plan-semantic-animation');
   assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
   assert.deepEqual(JSON.parse(await readFile(argv[argv.indexOf('--intent')+1],'utf8')),input);
   return candidate;
  }});
 const planned=await client.planSemanticAnimation({
  input:'/abs/model.bbmodel',expectedSha256:SHA,intent:input,
 });
 assert.equal(planned.motion_evidence.secondary_followers[0].derived_key_count,5);
 assert.equal(planned.motion_evidence.world_contact_verdict,'UNVERIFIED');
 assert.equal(calls,1);assert.equal(approvals,0);
 for(const invalid of [
  {...input,followers:null},
  {...input,followers:[{...lag,lag_seconds:0}]},
  {...input,followers:[{...lag,driver_bone_uuid:child}]},
  {...input,followers:[{...lag,follower_bone_uuid:bone}]},
  {...input,followers:[lag,lag]},
  {...input,followers:[{...lag,channel:'scale'}]},
  {...input,followers:[{...lag,gain:Infinity}]},
  {...input,followers:[{...lag,rest_value:[NaN,0,0]}]},
 ]) assert.throws(()=>serializeSemanticAnimation(invalid));
 for(const forged of [
  {...candidate,motion_evidence:{...secondReport,secondary_verdict:'PHYSICS_PASS'}},
  {...candidate,motion_evidence:{...secondReport,
   secondary_followers:[{...secondReport.secondary_followers[0],
    contact_verdict:'VERIFIED'}]}},
  {...candidate,plan:{...candidate.plan,operations:combined.map((op,i)=>
   i===4?{...op,bone_uuid:'other'}:op)}},
  {...candidate,plan:{...candidate.plan,operations:combined.map((op,i)=>
   i===4?{...op,keyframe_uuid:'forged'}:op)}},
  {...candidate,plan:{...candidate.plan,operations:combined.map((op,i)=>
   i===8?{...op,value:[100,0,0]}:op)}},
  {...candidate,plan:{...candidate.plan,operations:[
   ...combined.slice(0,-1),{op:'remove_cube',uuid:'other'},combined.at(-1),
  ]}},
 ]) assert.equal(validSemanticAnimationReceipt(forged,input,SHA),false);
});
