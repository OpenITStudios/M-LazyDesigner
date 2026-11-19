// SOURCE_AUTHORED_NOT_RUN: SDK contract fixtures; native tests on hold.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRustCodeModeClient} from './client.mjs';
import {validGeometryImpact} from './geometry-impact.mjs';
const SHA='a'.repeat(64),CUBE='00000000-0000-4000-8000-000000007402';
const BONE='00000000-0000-4000-8000-000000007401';
const PEER='00000000-0000-4000-8000-000000007403';
const query={kind:'geometry_impact',cube_uuid:CUBE,change:'reshape'};
const impact={
 scope:'saved_geometry_impact_advisory',cube_uuid:CUBE,change:'reshape',
 parent_bone_uuid:BONE,ancestor_count:1,ancestor_bone_uuids:[BONE],
 ancestors_truncated:false,dimensions:[3,5,4],
 same_parent_cube_uuids:[PEER],same_parent_cube_count:1,same_parent_truncated:false,
 declared_texture_uuids:['tex'],same_atlas_cube_uuids:[PEER],
 same_atlas_cube_count:1,same_atlas_truncated:false,texture_relations_complete:true,
 matching_animation_uuids:['clip'],matching_animation_count:1,
 matching_animation_truncated:false,animation_relation_verdict:'EXACT_KEYS_ONLY',
 review_reasons:['SAME_PARENT_NEIGHBORS_NOT_CONTACT_PROOF',
 'SAVED_UV_AND_ATLAS_REQUIRE_REVIEW','OTHER_ATLAS_USERS_NOT_UV_ALIAS_PROOF',
 'ANIMATED_BONE_POSES_REQUIRE_REVIEW','REFERENCE_VISUAL_FIDELITY_UNVERIFIED'],
 collision_verdict:'UNVERIFIED',visual_verdict:'UNVERIFIED',
 write_authority:'NOT_GRANTED',source_change_verdict:'NOT_APPLIED',
};
const receipt=(value)=>({status:'OK',sha256:SHA,summary:{revision:0},
 results:[{kind:'geometry_impact',impact:value}]});
test('G4 impact reuses one SHA-bound inspect-batch and grants no mutation',async()=>{
 let calls=0,approvals=0;
 const client=createRustCodeModeClient({
  binary:'/abs/lazydesigner-authoring',
  authorizeMutation:async()=>{approvals++;return true;},
  runner:async args=>{
   calls++;assert.equal(args[0],'inspect-batch');
   assert.equal(args[args.indexOf('--expected-sha256')+1],SHA);
   assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--queries')+1],'utf8')),
    {requests:[query]});
   return receipt(impact);
  },
 });
 const out=await client.inspectBatch({input:'/abs/source.bbmodel',
  expectedSha256:SHA,requests:[query]});
 assert.equal(out.results[0].impact.write_authority,'NOT_GRANTED');
 assert.equal(calls,1);assert.equal(approvals,0);
});
test('G4 forbids fabricated permission, visual PASS and relationships',async()=>{
 for(const mutated of [
  {...impact,write_authority:'GRANTED'},
  {...impact,visual_verdict:'MET'},
  {...impact,cube_uuid:'wrong'},
  {...impact,same_parent_cube_count:5},
  {...impact,dimensions:[1,0,1]},
  {...impact,source_change_verdict:'APPLIED'},
  {...impact,review_reasons:['REFERENCE_VISUAL_FIDELITY_UNVERIFIED','FAKE_PASS']},
  {...impact,extra:'untrusted'},
 ]){
  assert.equal(validGeometryImpact(mutated,query),false);
  const client=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
   runner:async()=>receipt(mutated)});
  await assert.rejects(client.inspectBatch({input:'/abs/source.bbmodel',
   expectedSha256:SHA,requests:[query]}),/CODE_MODE_GEOMETRY_IMPACT_RECEIPT_INVALID/);
 }
 const client=createRustCodeModeClient({binary:'/abs/lazydesigner-authoring',
  runner:async()=>receipt(impact)});
 await assert.rejects(client.inspectBatch({input:'/abs/source.bbmodel',
  expectedSha256:SHA,requests:[{...query,change:'auto_apply'}]}));
});
