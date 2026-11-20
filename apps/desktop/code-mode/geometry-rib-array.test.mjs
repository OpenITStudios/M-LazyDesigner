// SOURCE_AUTHORED_NOT_RUN: validates G6 transport/identity, not native
// geometry quality or actual Blockbench reopen. No CI/local test dispatch.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';

const SHA='a'.repeat(64);
const seed='00000000-0000-4000-8000-000000007901';
const uuid=i=>{
  const h=createHash('sha256').update(
    'lazydesigner:geometry-rib-array-v1\0'+seed+'\0'+i).digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
    '-8'+h.slice(17,20)+'-'+h.slice(20,32);
};
const rib={name:'armor_rib',uuid_seed:seed,axis:'X',
  from:[0,0,0],to:[20,4,6],count:4,thickness:2};
const bone={uuid:'rib-bone',name:'body',origin:[0,0,0]};
const assembly={expected_revision:0,parts:[{
  bone,parent_uuid:null,cubes:[],rib_arrays:[rib],
}]};
const ops=[
  {op:'add_bone',bone,parent_uuid:null},
  ...Array.from({length:4},(_,i)=>({
    op:'add_cube',bone_uuid:bone.uuid,
    cube:{uuid:uuid(i),name:'armor_rib_rib_'+i,box_uv:true},
  })),
];
const receipt=()=>({
  status:'OK',sha256:SHA,summary:{revision:0},
  plan:{expected_revision:0,operations:ops,correction_scope:null},
  preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
    mutation:{revision:1,operation_count:ops.length,
      changed_uuids:[bone.uuid,...ops.slice(1).map(x=>x.cube.uuid)]},
    candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
  write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
});
test('G6 one source-bound G1 proposal includes indexed ribs, no Apply',async()=>{
  let calls=0, approvals=0;
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',
    authorizeMutation:async()=>{approvals++;return true;},
    runner:async args=>{
      calls++;
      assert.equal(args[0],'plan-geometry-assembly');
      assert.equal(args[args.indexOf('--expected-sha256')+1],SHA);
      assert.deepEqual(JSON.parse(await readFile(
        args[args.indexOf('--assembly')+1],'utf8')),assembly);
      return receipt();
    },
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations,ops);
  assert.equal(result.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);assert.equal(approvals,0);
});
test('G6 rejects incorrect parameters and generated Cube ownership',async()=>{
  const runner=async()=>receipt();
  const build=()=>createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',runner,
  });
  for(const invalid of [
    {...rib,count:1},
    {...rib,count:0},
    {...rib,thickness:0},
    {...rib,axis:'W'},
    {...rib,from:[3,0,0],to:[2,4,6]},
    {...rib,to:[21,4,6]},
    {...rib,thickness:6},
    {...rib,uuid_seed:''},
    {...rib,count:129},
  ]){
    const input={...assembly,parts:[{
      ...assembly.parts[0],rib_arrays:[invalid],
    }]};
    await assert.rejects(build().planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:input,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  const forged=receipt();
  forged.plan.operations[1]={...forged.plan.operations[1],
    cube:{...forged.plan.operations[1].cube,uuid:'spoofed'}};
  const client=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',runner:async()=>forged,
  });
  await assert.rejects(client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  const granted={...receipt(),write_authority:'GRANTED'};
  const bad=createRustCodeModeClient({
    binary:'/abs/lazydesigner-authoring',runner:async()=>granted,
  });
  await assert.rejects(bad.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
});
