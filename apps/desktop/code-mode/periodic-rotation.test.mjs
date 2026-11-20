// SOURCE_AUTHORED_NOT_RUN — mocked SDK contract, not local/native testing.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {serializePeriodicRotation,validPeriodicRotationReceipt}
  from './periodic-rotation.mjs';
const SHA='a'.repeat(64),clip='00000000-0000-4000-8000-000000007801';
const bone='00000000-0000-4000-8000-000000000001';
const intent={expected_revision:0,animation_uuid:clip,name:'antenna_idle',
 length_seconds:1,max_error_degrees:1,tracks:[{bone_uuid:bone,
 base_rotation:[0,10,0],amplitude:[0,12,0],phase_degrees:90}]};
const id=t=>{
 const h=createHash('sha256').update(
 'lazydesigner:animation-periodic-rotation-v1\0'+clip+'\0'+bone+'\0'+t)
 .digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
 '-8'+h.slice(17,20)+'-'+h.slice(20,32);
};
const first=[0,22,0];
const ops=[
 {op:'create_animation',uuid:clip,name:intent.name,length:1},
 ...Array.from({length:9},(_,i)=>({
   op:'add_bone_transform_keyframe',animation_uuid:clip,bone_uuid:bone,
   keyframe_uuid:id(i*8192),channel:'rotation',time:i/8,
   value:i===8?first:[0,10+12*Math.sin(Math.PI/2+Math.PI*2*i/8),0],
 })),
 {op:'set_animation_loop_mode',animation_uuid:clip,mode:'loop'},
];
const evidence={
 scope:'source_bound_periodic_bone_rotation_candidate',
 animation_uuid:clip,sampling_strategy:'conservative_scalar_linear_sine_chord',
 max_error_degrees:1,loop_mode:'loop',track_count:1,keyframe_count:9,
 tracks:[{bone_uuid:bone,segments:8,keyframe_count:9,
 conservative_scalar_error_bound_degrees:0.9252754126,
 seam_endpoint_values_identical:true}],
 source_identity:'EXACT_SAVED_BONE_UUIDS',pose_contact_verdict:'UNVERIFIED',
 continuous_euler_motion_verdict:'SCALAR_LINEAR_BOUND_ONLY',
 native_playback_verdict:'NOT_EXECUTED',visual_verdict:'UNVERIFIED',
 write_authority:'NOT_GRANTED'
};
const fake=()=>({
 status:'OK',sha256:SHA,summary:{revision:0},
 plan:{expected_revision:0,operations:ops,correction_scope:null},
 preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
 mutation:{revision:1,operation_count:ops.length,
 changed_uuids:[clip,...ops.slice(1,-1).map(v=>v.keyframe_uuid)]},
 candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
 write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
 motion_evidence:evidence,write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'
});
test('A1 one SHA-bound periodic clip proposal, no approval or mutation',async()=>{
 let approvals=0,calls=0;
 const c=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
 authorizeMutation:async()=>{approvals++;return true;},
 runner:async argv=>{
  calls++;assert.equal(argv[0],'plan-periodic-rotation');
  assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
  assert.deepEqual(JSON.parse(await readFile(argv[argv.indexOf('--intent')+1],'utf8')),intent);
  return fake();
 }});
 const response=await c.planPeriodicRotation({input:'/abs/model.bbmodel',
 expectedSha256:SHA,intent});
 assert.equal(response.motion_evidence.keyframe_count,9);
 assert.equal(response.write_authority,'NOT_GRANTED');
 assert.equal(calls,1);assert.equal(approvals,0);
});
test('A1 refuses invalid artist input and false receipt authority',async()=>{
 for(const r of [
  {...intent,expected_revision:1},
  {...intent,max_error_degrees:0},
  {...intent,tracks:[]},
  {...intent,tracks:[{...intent.tracks[0],amplitude:[0,0,0]}]},
  {...intent,unknown:true},
 ])assert.throws(()=>serializePeriodicRotation(r));
 for(const forged of [
  {...fake(),write_authority:'GRANTED'},
  {...fake(),motion_evidence:{...evidence,visual_verdict:'MET'}},
  {...fake(),plan:{...fake().plan,operations:ops.map((v,i)=>
    i===1?{...v,keyframe_uuid:'wrong'}:v)}},
  {...fake(),motion_evidence:{...evidence,
    tracks:[{...evidence.tracks[0],segments:16}]}},
 ]){
  assert.equal(validPeriodicRotationReceipt(forged,intent,SHA),false);
  const c=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
   runner:async()=>forged});
  await assert.rejects(c.planPeriodicRotation({input:'/abs/model.bbmodel',
   expectedSha256:SHA,intent}),/CODE_MODE_PERIODIC_ROTATION_RECEIPT_INVALID/);
 }
});
