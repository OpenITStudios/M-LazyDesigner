// SOURCE_AUTHORED_NOT_RUN — no native/local/CI execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRustCodeModeClient} from './client.mjs';
import {normalizedGeometryVoidZones,validGeometryVoidEvidence} from './geometry-void.mjs';
const SHA='a'.repeat(64);
const bone={uuid:'bone-one',name:'body',origin:[0,0,0]};
const cube={uuid:'cube-one',name:'panel',from:[0,0,0],to:[2,10,10],
  type:'cube',faces:{}};
const voids=[{bone_uuid:bone.uuid,from:[0.5,2,2],to:[1,8,8]}];
const assembly={expected_revision:0,parts:[{bone,parent_uuid:null,cubes:[cube]}],
  void_zones:voids};
const evidence={
 scope:'new_bone_saved_cube_bounds_empty_zone',
 zones:voids,zones_checked:1,tested_cube_checks:1,
 local_bounds_verdict:'CLEAR_OF_PROPOSED_AXIS_ALIGNED_CUBES',
 whole_model_contact_verdict:'UNVERIFIED',through_hole_verdict:'UNVERIFIED',
 visual_verdict:'UNVERIFIED',write_authority:'NOT_GRANTED',
};
const response=()=>({
 status:'OK',sha256:SHA,summary:{revision:0},
 plan:{expected_revision:0,operations:[
   {op:'add_bone',bone,parent_uuid:null},
   {op:'add_cube',cube,bone_uuid:bone.uuid},
 ],correction_scope:null},
 preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
   mutation:{revision:1,operation_count:2,changed_uuids:[bone.uuid,cube.uuid]},
   candidate_sha256:'c'.repeat(64),candidate_summary:{revision:1},
   write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
 write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
 void_evidence:evidence,
});
test('G5 transports opt-in clear zones through existing SHA-bound Rust planner',async()=>{
 let calls=0,approval=0;
 const client=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
  authorizeMutation:async()=>{approval++;return true;},
  runner:async argv=>{
   calls++;assert.equal(argv[0],'plan-geometry-assembly');
   assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
   const payload=JSON.parse(await readFile(argv[argv.indexOf('--assembly')+1],'utf8'));
   assert.equal(payload.void_zones,undefined);
   assert.deepEqual(JSON.parse(await readFile(argv[argv.indexOf('--void-zones')+1],'utf8')),voids);
   return response();
  }});
 const result=await client.planGeometryAssembly({
  input:'/abs/model.bbmodel',expectedSha256:SHA,assembly});
 assert.equal(result.void_evidence.write_authority,'NOT_GRANTED');
 assert.equal(calls,1);assert.equal(approval,0);
});
test('G5 rejects malformed zones and forged mutation/clearance evidence',async()=>{
 for(const bad of [
  {...voids[0],from:[1,1,1],to:[1,4,4]},
  {...voids[0],bone_uuid:'unknown'},
  {...voids[0],extra:true},
 ]){
   assert.throws(()=>normalizedGeometryVoidZones({...assembly,void_zones:[bad]}));
 }
 for(const forged of [
  {...evidence,write_authority:'GRANTED'},
  {...evidence,through_hole_verdict:'CLEAR'},
  {...evidence,zones_checked:0},
  {...evidence,zones:[{...voids[0],to:[2,8,8]}]},
  {...evidence,extra:'PASS'}
 ]){
  assert.equal(validGeometryVoidEvidence(forged,voids),false);
  const client=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
   runner:async()=>({...response(),void_evidence:forged})});
  await assert.rejects(client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly
  }),/CODE_MODE_GEOMETRY_VOID_EVIDENCE_INVALID/);
 }
});
