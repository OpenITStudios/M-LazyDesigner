// Source-authored only. Repository tests remain ON_HOLD / NOT_EXECUTED.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRustCodeModeClient, openRustCodeModeProject, normalizedCorrectionScope } from './client.mjs';

const BIN = '/abs/lazydesigner-authoring';
const SHA = 'a'.repeat(64);

function geometryReview(affectedCount) {
  return {scope:'affected_vs_same_bone_axis_aligned_cube_aabb',
    affected_cube_count:affectedCount,checked_pair_count:1,
    introduced_overlap_count:0,preexisting_overlap_count:0,
    resolved_overlap_count:0,unsupported_neighbor_count:0,
    introduced_samples:[],samples_truncated:false,
    rotated_neighbor_obb:{
      scope:'affected_vs_rotated_direct_same_bone_cube_obb',
      checked_pair_count:0,introduced_intersection_count:0,
      preexisting_intersection_count:0,resolved_intersection_count:0,
      introduced_touching_count:0,unsupported_neighbor_count:0,
      introduced_samples:[],samples_truncated:false,
      whole_model_collision_verdict:'UNVERIFIED',
    },
    whole_model_collision_verdict:'UNVERIFIED'};
}


test('Code Mode forwards only SHA-bound reference/capture paths from trusted SDK', async () => {
  const input='/abs/model.bbmodel';
  const source='a'.repeat(64), reference='b'.repeat(64), capture='c'.repeat(64);
  const calls=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    runner:async argv=>{
      calls.push(argv);
      return {status:'OK',source_model_sha256:source,
        reference_png_sha256:reference,capture_png_sha256:capture,
        comparison:{scope:'operator_selected_saved_png_pair',
          visual_verdict:'UNVERIFIED'}};
    },
  });
  const value=await client.inspectVisualPair({
    input,expectedSha256:source,
    referencePng:'/abs/reference.png',capturePng:'/abs/capture.png',
    referenceSha256:reference,captureSha256:capture,
  });
  assert.equal(value.comparison.visual_verdict,'UNVERIFIED');
  assert.deepEqual(calls,[[ 'inspect-visual-pair',
    '--input',input,'--expected-sha256',source,
    '--reference','/abs/reference.png','--reference-sha256',reference,
    '--capture','/abs/capture.png','--capture-sha256',capture
  ]]);
  await assert.rejects(client.inspectVisualPair({
    input,expectedSha256:source,referencePng:'relative.png',
    capturePng:'/abs/capture.png',referenceSha256:reference,
    captureSha256:capture,
  }));
  await assert.rejects(client.inspectVisualPair({
    input,expectedSha256:source,referencePng:'/abs/reference.png',
    capturePng:'/abs/capture.png',referenceSha256:'stale',
    captureSha256:capture,
  }));
  assert.equal(calls.length,1);
});

test('P0 semantic material SDK obtains one native guarded source-only proposal, never requests approval', async () => {
  const intent={
    expected_revision:0,reference_png_sha256:'b'.repeat(64),
    cube_uuid:'cube-a',texture_uuid:'texture-a',
    face:'north',material:'painted_metal',
    light_corner:'upper_left',contrast:'balanced',
    source_base_rgba:[90,110,130,255],
    shadow_rgb:[52,62,80],highlight_rgb:[160,175,195],
    protected_regions:[],expected_before_pixels:[],
  };
  const operation={
    op:'paint_cube_face_regions_guarded',cube_uuid:intent.cube_uuid,
    texture_uuid:intent.texture_uuid,
    regions:[{face:'north',from:[0,0],to:[1,1],
      rgba:[160,175,195,255],erase:false},
      {face:'north',from:[3,3],to:[4,4],
        rgba:[52,62,80,255],erase:false}],
  };
  const receipt={
    status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations:[operation],
      correction_scope:{texture_uuid:intent.texture_uuid,
        allowed_regions:[{from:[1,2],to:[5,6]}],
        preserve_alpha:true,protected_regions:[],
        expected_before_pixels:[],
        editable_before_rgba:[intent.source_base_rgba]}},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:1,changed_uuids:['texture-a']},
      candidate_sha256:'c'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    material_evidence:{scope:'source_selected_face_semantic_metal_candidate',
      material:'painted_metal',cube_uuid:intent.cube_uuid,
      texture_uuid:intent.texture_uuid,face:intent.face,
      reference_png_sha256:intent.reference_png_sha256,
      reference_authority:'NOT_VERIFIED_BY_RUST',
      style_quality:'NOT_EVALUATED',visual_verdict:'UNVERIFIED',
      detail_boundary_guard:'one_face_local_texel_around_non_base_rgba',
      skipped_near_existing_detail_pixels:0,
      candidate_pixels:2,light_pixels:1,shadow_pixels:1,
      write_authority:'NOT_GRANTED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
  };
  let nativeCalls=0,approvedCalls=0;
  const client=createRustCodeModeClient({
    binary:BIN,authorizeMutation:()=>{approvedCalls++;return true;},
    runner:async argv=>{
      nativeCalls++;
      assert.equal(argv[0],'plan-semantic-material');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
      const request=JSON.parse(await readFile(argv[argv.indexOf('--intent')+1],'utf8'));
      assert.deepEqual(request,intent);
      return receipt;
    },
  });
  const proposal=await client.planSemanticMaterial({
    input:'/abs/model.bbmodel',expectedSha256:SHA,intent,
  });
  assert.equal(proposal.plan.operations.length,1);
  assert.equal(proposal.preflight.write_authority,'NOT_GRANTED');
  assert.equal(proposal.material_evidence.reference_authority,'NOT_VERIFIED_BY_RUST');
  for(const invalid of [
    {...intent,face:'front'}, {...intent,material:'wood'},
    {...intent,shadow_rgb:[8,9,256]},
    {...intent,source_base_rgba:[90,110,130,0]},
    {...intent,expected_revision:1},
    {...intent,untrusted_approval:true},
  ]){
    await assert.rejects(client.planSemanticMaterial({
      input:'/abs/model.bbmodel',expectedSha256:SHA,intent:invalid,
    }),/CODE_MODE_SEMANTIC_MATERIAL_INPUT_INVALID/);
  }
  assert.equal(nativeCalls,1);
  assert.equal(approvedCalls,0);
  for(const forged of [
    {...receipt,material_evidence:{...receipt.material_evidence,
      reference_authority:'APPROVED'}},
    {...receipt,material_evidence:{...receipt.material_evidence,
      detail_boundary_guard:'BYPASSED'}},
    {...receipt,material_evidence:{...receipt.material_evidence,
      light_pixels:0,shadow_pixels:2}},
    {...receipt,plan:{...receipt.plan,operations:[{...operation,
      regions:[{...operation.regions[0],rgba:[1,1,1,255]}]}]}},
    {...receipt,plan:{...receipt.plan,operations:[{...operation,
      regions:[{...operation.regions[0],from:[],to:[]}]}]}},
    {...receipt,preflight:{...receipt.preflight,write_authority:'GRANTED'}},
    {...receipt,plan:{...receipt.plan,
      correction_scope:{...receipt.plan.correction_scope,editable_before_rgba:[]}}},
  ]){
    const client=createRustCodeModeClient({binary:BIN,runner:async()=>forged});
    await assert.rejects(client.planSemanticMaterial({
      input:'/abs/model.bbmodel',expectedSha256:SHA,intent,
    }),/CODE_MODE_SEMANTIC_MATERIAL_RECEIPT_INVALID/);
  }
});

// SOURCE_AUTHORED_NOT_RUN: G1 assembly is a read-only, SHA-pinned
// temporary Rust request and never asks a trusted host for write approval.
test('G1 Geometry assembly composes an exact Rust plan without mutation permission', async () => {
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'bone-g1',name:'body',origin:[0,0,0]},
    parent_uuid:null,cubes:[],
  }]};
  let calls=0, approved=0;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:async()=>{approved++;return true;},
    runner:async argv=>{
      calls++;
      assert.equal(argv[0],'plan-geometry-assembly');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
      const forwarded=JSON.parse(await readFile(argv[argv.indexOf('--assembly')+1],'utf8'));
      assert.deepEqual(forwarded,assembly);
      return {status:'OK',sha256:SHA,summary:{revision:0},
        plan:{expected_revision:0,operations:[{
          op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null,
        }],correction_scope:null},
        preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
          mutation:{revision:1,operation_count:1,changed_uuids:['bone-g1']},
          candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
          write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
        write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
    },
  });
  const receipt=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.equal(receipt.plan.operations[0].bone.uuid,'bone-g1');
  assert.equal(receipt.preflight.write_authority,'NOT_GRANTED');
  assert.equal(approved,0);
  for(const invalid of [
    {...assembly,expected_revision:1},
    {...assembly,parts:[]},
    {...assembly,parts:[{...assembly.parts[0],cubes:[{number:Infinity}]}]},
  ]){
    await assert.rejects(client.planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:invalid,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_INPUT_INVALID/);
  }
  assert.equal(calls,1);
  assert.equal(approved,0);
  const forged=createRustCodeModeClient({
    binary:BIN,
    runner:async()=>({
      status:'OK',sha256:SHA,summary:{revision:0},
      plan:{expected_revision:0,operations:[{
        op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null,
      }],correction_scope:null},
      preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
        mutation:{revision:1,operation_count:1,changed_uuids:['bone-g1']},
        candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
        write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
      write_authority:'GRANTED',visual_verdict:'UNVERIFIED',
    }),
  });
  await assert.rejects(forged.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
});

// SOURCE_AUTHORED_NOT_RUN: the G3 rectangular-frame shortcut stays within
// the existing SHA-bound G1 plan. Guest and SDK never generate geometry.
test('G3 frame G1 contract binds all four explicitly declared panel IDs',async()=>{
  const ids=['left','right','bottom','top'].map(side=>'portal-'+side);
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'bone-portal',name:'portal_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],frames:[{
      name:'portal',center:[0,0,0],size:[10,8,2],
      border:1,normal_axis:'Z',cube_uuids:ids,
    }],
  }]};
  const bounds=[
    [[-5,-4,-1],[-4,4,1]],[[4,-4,-1],[5,4,1]],
    [[-4,-4,-1],[4,-3,1]],[[-4,3,-1],[4,4,1]],
  ];
  const operations=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((uuid,i)=>({op:'add_cube',bone_uuid:'bone-portal',cube:{
      uuid,name:'portal_'+['left','right','bottom','top'][i],
      from:bounds[i][0],to:bounds[i][1],box_uv:true,
    }})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:5,
        changed_uuids:['bone-portal',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0,approvals=0;
  const build=runner=>createRustCodeModeClient({
    binary:BIN, runner,
    authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['bone-portal',...ids]);
  assert.equal(result.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{...operations[1].cube,uuid:'extra'}},
      ...operations.slice(2),
    ]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],bone_uuid:'foreign-bone'},
      ...operations.slice(2),
    ]}},
    {...receipt,preflight:{...receipt.preflight,mutation:{
      ...receipt.preflight.mutation,
      changed_uuids:['bone-portal','other',...ids.slice(1)],
    }}},
  ]){
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: G3.1 cavity uses the existing Rust G1 planner.
// UUID mapping and source SHA are checked without a second JS geometry solver.
test('G3.1 hollow box binds all five panel IDs and does not gain Apply permission',async()=>{
  const ids=['a0','a1','b0','b1','back'].map(s=>'cavity-'+s);
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'cavity-bone',name:'container_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],hollow_boxes:[{
      name:'container',center:[0,0,0],size:[10,8,6],
      wall:1,open_face:'POS_Z',cube_uuids:ids,
    }],
  }]};
  const operations=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((uuid,index)=>({op:'add_cube',bone_uuid:'cavity-bone',
      cube:{uuid,box_uv:true,name:'container_'+
        ['wall_a_low','wall_a_high','wall_b_low','wall_b_high','back'][index]}})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:6,
        changed_uuids:['cavity-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0,approvals=0;
  const build=runner=>createRustCodeModeClient({
    binary:BIN,runner,
    authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['cavity-bone',...ids]);
  assert.equal(result.preflight.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{...operations[1].cube,uuid:'unexpected'}},
      ...operations.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],bone_uuid:'foreign'},
      ...operations.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{...operations[1].cube,box_uv:false}},
      ...operations.slice(2)]}},
    {...receipt,preflight:{...receipt.preflight,mutation:{
      ...receipt.preflight.mutation,changed_uuids:['cavity-bone','wrong',...ids.slice(1)]}}},
  ]) {
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  const bad={...assembly,parts:[{...assembly.parts[0],
    hollow_boxes:[{...assembly.parts[0].hollow_boxes[0],cube_uuids:ids.slice(1)}]}]};
  await assert.rejects(build(async()=>receipt).planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:bad,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  assert.equal(calls,1);
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: a curved G3.2 blockout still crosses the single
// G1 Rust read-only route, with exact UUID owners and no new write power.
test('G3.2 curved arch binds piers and crown IDs without inferring geometry',async()=>{
  const ids=['left','right','curve1','curve2','curve3','curve4','curve5']
    .map(n=>'arch-'+n);
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'arch-bone',name:'arch_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],arches:[{
      name:'doorway',center:[0,0,0],size:[19,12,4],
      span_axis:'X',wall:2,rise:6,cube_uuids:ids,
    }],
  }]};
  const names=['left_pier','right_pier','curve_1','curve_2',
    'curve_3','curve_4','curve_5'];
  const ops=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((uuid,i)=>({op:'add_cube',bone_uuid:'arch-bone',
      cube:{uuid,name:'doorway_'+names[i],box_uv:true}})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations:ops,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:8,
        changed_uuids:['arch-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0, approvals=0;
  const build=runner=>createRustCodeModeClient({
    binary:BIN,runner,
    authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['arch-bone',...ids]);
  assert.equal(result.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,uuid:'other'}},
      ...ops.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],bone_uuid:'foreign-bone'},...ops.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,name:'not-a-pier'}},
      ...ops.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,box_uv:false}},
      ...ops.slice(2)]}},
    {...receipt,preflight:{...receipt.preflight,mutation:{
      ...receipt.preflight.mutation,
      changed_uuids:['arch-bone','forged',...ids.slice(1)]}}},
  ]) {
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  const bad={...assembly,parts:[{...assembly.parts[0],
    arches:[{...assembly.parts[0].arches[0],cube_uuids:ids.slice(1)}]}]};
  await assert.rejects(build(async()=>receipt).planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:bad,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  assert.equal(calls,1);
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: mock only the G1 transport/identity contract,
// never the physical output of Rust rasterization or native verification.
test('G3.3 variable-radius sweep binds seed-derived IDs and remains read-only',async()=>{
  const seed='00000000-0000-4000-8000-000000003501';
  const uuid=i=>{
    const hash=createHash('sha256').update(
      'lazydesigner:geometry-sweep-v1\0'+seed+'\0'+i).digest('hex');
    return hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+
      '-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
  };
  const ids=[uuid(0),uuid(1)];
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'sweep-bone',name:'branch_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],sweeps:[{
      name:'branch',uuid_seed:seed,stations:[
        {position:[-4,0,0],radius:2},
        {position:[0,2,0],radius:3},
        {position:[4,3,1],radius:2},
      ],
    }],
  }]};
  const ops=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((id,i)=>({op:'add_cube',cube:{
      uuid:id,name:'branch_v_'+i,box_uv:true,
    },bone_uuid:'sweep-bone'})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations:ops,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:3,
        changed_uuids:['sweep-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0,approvals=0;
  const build=runner=>createRustCodeModeClient({
    binary:BIN,runner,
    authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['sweep-bone',...ids]);
  assert.equal(result.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,uuid:'unlisted'}},ops[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,name:'other'}},ops[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],bone_uuid:'foreign'},ops[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],{...ops[1],cube:{...ops[1].cube,box_uv:false}},ops[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      ops[0],ops[2],ops[1]]}},
    {...receipt,preflight:{...receipt.preflight,mutation:{
      ...receipt.preflight.mutation,changed_uuids:['sweep-bone','other',ids[1]]}}},
  ]){
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  const invalid={...assembly,parts:[{...assembly.parts[0],
    sweeps:[{...assembly.parts[0].sweeps[0],stations:[]}]}]};
  await assert.rejects(build(async()=>receipt).planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:invalid,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  assert.equal(calls,1);
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: Catmull–Rom is an opt-in source declaration.
// Rust alone computes interpolation; Node validates the selected route,
// source SHA, output UUID/parent binding and absence of write authority.
test('G3.4a adaptive Catmull-Rom sweep is opt-in and keeps G1 read-only',async()=>{
  const seed='00000000-0000-4000-8000-000000003501';
  const uuid=index=>{
    const h=createHash('sha256').update(
      'lazydesigner:geometry-sweep-v1\0'+seed+'\0'+index).digest('hex');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
      '-8'+h.slice(17,20)+'-'+h.slice(20,32);
  };
  const ids=[uuid(0),uuid(1)];
  const base={name:'branch',uuid_seed:seed,
    stations:[
      {position:[-4,0,0],radius:2},
      {position:[0,2,0],radius:3},
      {position:[4,3,1],radius:2},
    ]};
  const curved={...base,interpolation:'CENTRIPETAL_CATMULL_ROM',
    max_chord_error:0.5};
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'curve-bone',name:'curve_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],sweeps:[curved],
  }]};
  const operations=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((id,i)=>({op:'add_cube',bone_uuid:'curve-bone',
      cube:{uuid:id,name:'branch_v_'+i,box_uv:true}})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:3,
        changed_uuids:['curve-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let approvals=0,calls=0;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:async()=>{approvals++;return true;},
    runner:async argv=>{
      calls++;
      assert.equal(argv[0],'plan-geometry-assembly');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
      assert.deepEqual(JSON.parse(await readFile(
        argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
      return receipt;
    },
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['curve-bone',...ids]);
  assert.equal(result.write_authority,'NOT_GRANTED');
  assert.equal(result.visual_verdict,'UNVERIFIED');
  assert.equal(calls,1);
  assert.equal(approvals,0);

  // A successful fake Rust reply cannot bypass the Code Mode contract.
  const forged=createRustCodeModeClient({binary:BIN,runner:async()=>({
    ...receipt,write_authority:'GRANTED',
  })});
  await assert.rejects(forged.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  for(const input of [
    {...curved,max_chord_error:undefined},
    {...curved,max_chord_error:0.1},
    {...curved,interpolation:'CATMULL_UNBOUNDED'},
    {...curved,stations:curved.stations.slice(0,2)},
    {...base,interpolation:'LINEAR',max_chord_error:0.5},
  ]){
    const invalid={...assembly,parts:[{...assembly.parts[0],sweeps:[input]}]};
    const fake=createRustCodeModeClient({binary:BIN,runner:async()=>receipt});
    await assert.rejects(fake.planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:invalid,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
});

// SOURCE_AUTHORED_NOT_RUN: the G3.4b transported anisotropic profile uses
// the exact G1 Rust SHA-bound planner; mocked Cubes prove only SDK identity.
test('G3.4b profile sweep binds versioned IDs and keeps mutation unapproved',async()=>{
  const seed='00000000-0000-4000-8000-000000004501';
  const uuid=i=>{
    const h=createHash('sha256').update(
      'lazydesigner:geometry-profile-v1\0'+seed+'\0'+i).digest('hex');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
      '-8'+h.slice(17,20)+'-'+h.slice(20,32);
  };
  const ids=[uuid(0),uuid(1)];
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'profile-bone',name:'profile_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],profile_sweeps:[{
      name:'vent',uuid_seed:seed,up_axis:'Y',cross_section:'RECTANGLE',
      stations:[
        {position:[-5,0,0],half_width:2,half_height:2},
        {position:[0,0,0],half_width:3,half_height:2,twist_degrees:90},
        {position:[0,0,5],half_width:3,half_height:2,twist_degrees:90},
      ],
    }],
  }]};
  const operations=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((id,i)=>({op:'add_cube',bone_uuid:'profile-bone',
      cube:{uuid:id,name:'vent_v_'+i,box_uv:true}})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:3,
        changed_uuids:['profile-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0,approvals=0;
  const build=runner=>createRustCodeModeClient({binary:BIN,runner,
    authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const result=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.deepEqual(result.plan.operations.map(op=>
    op.op==='add_bone'?op.bone.uuid:op.cube.uuid),['profile-bone',...ids]);
  assert.equal(result.preflight.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{
        ...operations[1].cube,uuid:'other'}},operations[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],bone_uuid:'wrong'},operations[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{
        ...operations[1].cube,name:'wrong'}},operations[2]]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{
        ...operations[1].cube,box_uv:false}},operations[2]]}},
    {...receipt,preflight:{...receipt.preflight,mutation:{
      ...receipt.preflight.mutation,
      changed_uuids:['profile-bone','forged',ids[1]]}}},
  ]){
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  for(const changed of [
    {up_axis:'INVALID'},
    {cross_section:'MESH'},
    {stations:[]},
  ]){
    const input={...assembly,parts:[{...assembly.parts[0],
      profile_sweeps:[{...assembly.parts[0].profile_sweeps[0],...changed}]}]};
    await assert.rejects(build(async()=>receipt).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:input,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  for (const twist_degrees of [-181,181,'90',null]) {
    const original=assembly.parts[0].profile_sweeps[0];
    const stations=original.stations.map((s,i)=>
      i===1?{...s,twist_degrees}:s);
    const invalid={...assembly,parts:[{...assembly.parts[0],
      profile_sweeps:[{...original,stations}]}]};
    await assert.rejects(build(async()=>receipt).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:invalid,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: G3.5 axial blockouts reuse the SHA-bound G1
// planner. Mock receipts verify ID/permission checks, not voxel fidelity.
test('G3.5 LOFT and REVOLVE bind one Rust plan without write grant',async()=>{
  const seed='00000000-0000-4000-8000-000000005501';
  const id=(kind,i)=>{
    const h=createHash('sha256').update(
      'lazydesigner:geometry-'+kind+'-v1\\0'+seed+'\\0'+i).digest('hex');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+
      '-8'+h.slice(17,20)+'-'+h.slice(20,32);
  };
  const ids=[id('loft',0),id('loft',1),id('revolve',0),id('revolve',1)];
  const loft={name:'tower',uuid_seed:seed,origin:[0,0,0],axis:'Y',
    sections:[{height:0,center:[0,0],size:[6,6]},
      {height:8,center:[2,0],size:[4,4]}]};
  const revolve={name:'ring',uuid_seed:seed,origin:[20,0,0],axis:'Y',
    sections:[{height:0,outer_radius:6,inner_radius:2},
      {height:8,outer_radius:6,inner_radius:2}]};
  const assembly={expected_revision:0,parts:[{
    bone:{uuid:'axial-bone',name:'axial_bone',origin:[0,0,0]},
    parent_uuid:null,cubes:[],lofts:[loft],revolves:[revolve],
  }]};
  const operations=[
    {op:'add_bone',bone:assembly.parts[0].bone,parent_uuid:null},
    ...ids.map((uuid,i)=>({op:'add_cube',bone_uuid:'axial-bone',
      cube:{uuid,name:(i<2?'tower_v_':'ring_v_')+(i%2),box_uv:true}})),
  ];
  const receipt={status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:operations.length,
        changed_uuids:['axial-bone',...ids]},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'};
  let calls=0,approvals=0;
  const build=runner=>createRustCodeModeClient({
    binary:BIN,runner,authorizeMutation:async()=>{approvals++;return true;},
  });
  const client=build(async argv=>{
    calls++;
    assert.equal(argv[0],'plan-geometry-assembly');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
    assert.deepEqual(JSON.parse(await readFile(
      argv[argv.indexOf('--assembly')+1],'utf8')),assembly);
    return receipt;
  });
  const planned=await client.planGeometryAssembly({
    input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
  });
  assert.equal(planned.preflight.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const forged of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],bone_uuid:'other'},...operations.slice(2)]}},
    {...receipt,plan:{...receipt.plan,operations:[
      operations[0],{...operations[1],cube:{
        ...operations[1].cube,uuid:'unclaimed'}},...operations.slice(2)]}},
  ]){
    await assert.rejects(build(async()=>forged).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  for(const mutation of [
    {lofts:[{...loft,axis:'INVALID'}]},
    {lofts:[{...loft,sections:[loft.sections[0]]}]},
    {revolves:[{...revolve,origin:[0,0,100]}]},
    {revolves:[{...revolve,sections:[
      revolve.sections[0],{height:8,outer_radius:2,inner_radius:2}]}]},
  ]){
    const invalid={...assembly,parts:[{...assembly.parts[0],...mutation}]};
    await assert.rejects(build(async()=>receipt).planGeometryAssembly({
      input:'/abs/model.bbmodel',expectedSha256:SHA,assembly:invalid,
    }),/CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID/);
  }
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: G2 face alignment uses only a read-only Rust
// plan. No host write approval is requested, and fabricated grants refuse.
test('Code Mode G2 forwards exact face attachment and refuses a forged receipt',async()=>{
  const attachment={
    expected_revision:0,anchor_cube_uuid:'anchor',
    moving_cube_uuid:'moving',anchor_face:'east',moving_face:'west',
    clearance:2,tangent_offset:[1,-1],
  };
  const receipt={
    status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations:[{
      op:'translate_cube',uuid:'moving',delta:[-4,1,-1],
    }],correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:1,changed_uuids:['moving']},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    diagnostic:{scope:'same_bone_axis_aligned_face_attachment',
      anchor_cube_uuid:'anchor',moving_cube_uuid:'moving',
      parent_bone_uuid:'root',anchor_face:'east',moving_face:'west',
      clearance:2,tangent_axes:[1,2],tangent_offset:[1,-1],
      delta:[-4,1,-1],collision_verdict:'NOT_EVALUATED',
      aabb_overlap_review:geometryReview(1),visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
  };
  let calls=0,approvals=0;
  const client=createRustCodeModeClient({
    binary:BIN,authorizeMutation:async()=>{approvals++;return true;},
    runner:async argv=>{
      calls++;
      assert.equal(argv[0],'plan-geometry-attachment');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1,SHA);
      const sent=JSON.parse(await readFile(argv[argv.indexOf('--attachment')+1],'utf8'));
      assert.deepEqual(sent,attachment);
      return receipt;
    },
  });
  const result=await client.planGeometryAttachment({
    input:'/abs/model.bbmodel',expectedSha256:SHA,attachment,
  });
  assert.equal(result.plan.operations[0].uuid,'moving');
  assert.equal(result.diagnostic.collision_verdict,'NOT_EVALUATED');
  const rotated={...geometryReview(1).rotated_neighbor_obb,
    checked_pair_count:1,introduced_intersection_count:1,
    introduced_samples:[{cube_uuids:['moving','rotated'],
      penetration_depth:1.25}]};
  const withRotated={...receipt,diagnostic:{...receipt.diagnostic,
    aabb_overlap_review:{...geometryReview(1),rotated_neighbor_obb:rotated}}};
  const supplemental=createRustCodeModeClient({
    binary:BIN,runner:async()=>withRotated,
  });
  const reviewed=await supplemental.planGeometryAttachment({
    input:'/abs/model.bbmodel',expectedSha256:SHA,attachment,
  });
  assert.equal(reviewed.diagnostic.aabb_overlap_review
    .rotated_neighbor_obb.introduced_intersection_count,1);
  assert.equal(reviewed.diagnostic.collision_verdict,'NOT_EVALUATED');
  assert.equal(approvals,0);
  for(const invalid of [
    {...attachment,expected_revision:1},
    {...attachment,clearance:Infinity},
    {...attachment,tangent_offset:[NaN,0]},
  ]){
    await assert.rejects(client.planGeometryAttachment({
      input:'/abs/model.bbmodel',expectedSha256:SHA,attachment:invalid,
    }),/CODE_MODE_GEOMETRY_ATTACHMENT_INPUT_INVALID/);
  }
  assert.equal(calls,1);
  for(const fake of [
    {...receipt,write_authority:'GRANTED'},
    {...receipt,plan:{...receipt.plan,operations:[{
      op:'translate_cube',uuid:'wrong',delta:[-4,1,-1]
    }]}},
    {...receipt,diagnostic:{...receipt.diagnostic,collision_verdict:'CLEAR'}},
    {...receipt,diagnostic:{...receipt.diagnostic,
      aabb_overlap_review:{...geometryReview(1),whole_model_collision_verdict:'CLEAR'}}},
    {...receipt,diagnostic:{...receipt.diagnostic,
      aabb_overlap_review:{...geometryReview(1),
        rotated_neighbor_obb:{...geometryReview(1).rotated_neighbor_obb,
          whole_model_collision_verdict:'CLEAR'}}}},
    {...receipt,diagnostic:{...receipt.diagnostic,
      aabb_overlap_review:{...geometryReview(1),
        rotated_neighbor_obb:{...geometryReview(1).rotated_neighbor_obb,
          introduced_intersection_count:1,
          introduced_samples:[{cube_uuids:['other','rotated'],
            penetration_depth:1}]}}}},
    {...receipt,diagnostic:{...receipt.diagnostic,
      aabb_overlap_review:{...geometryReview(1),introduced_overlap_count:1,
        introduced_samples:[{cube_uuids:['other','unknown'],overlap:[1,2,3]}]}}},
  ]){
    const forged=createRustCodeModeClient({
      binary:BIN,runner:async()=>fake,
    });
    await assert.rejects(forged.planGeometryAttachment({
      input:'/abs/model.bbmodel',expectedSha256:SHA,attachment,
    }),/CODE_MODE_GEOMETRY_ATTACHMENT_RECEIPT_INVALID/);
  }
  assert.equal(approvals,0);
});

// SOURCE_AUTHORED_NOT_RUN: G2.2 is exactly one read-only Rust resize
// and dependency batch, with no implicit apply or persistent relation.
test('Code Mode G2.2 sends explicit dependencies and refuses forged approvals',async()=>{
  const propagation={
    expected_revision:0,resize_cube_uuid:'base',
    from:[0,0,0],to:[6,4,4],uv_policy:'manual_preserve',
    links:[{anchor_cube_uuid:'base',moving_cube_uuid:'arm',
      anchor_face:'east',moving_face:'west',
      clearance:1,tangent_offset:[0,0]}],
  };
  const operations=[
    {op:'reframe_cube',uuid:'base',
      from:[0,0,0],to:[6,4,4],uv_policy:'manual_preserve'},
    {op:'translate_cube',uuid:'arm',delta:[-3,0,0]},
  ];
  const valid={
    status:'OK',sha256:SHA,summary:{revision:0},
    plan:{expected_revision:0,operations,correction_scope:null},
    preflight:{status:'VALIDATED_NOT_APPLIED',base_revision:0,
      mutation:{revision:1,operation_count:2,changed_uuids:['base','arm']},
      candidate_sha256:'b'.repeat(64),candidate_summary:{revision:1},
      write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED'},
    diagnostic:{scope:'one_shot_same_bone_resize_propagation',
      resize_cube_uuid:'base',parent_bone_uuid:'root',dependency_count:1,
      translated_count:1,unchanged_count:0,ordered_links:[{
        anchor_cube_uuid:'base',moving_cube_uuid:'arm',
        delta:[-3,0,0],tangent_axes:[1,2],status:'translation_planned',
      }],persistent_constraints:false,collision_verdict:'NOT_EVALUATED',
      aabb_overlap_review:geometryReview(2),visual_verdict:'UNVERIFIED'},
    write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
  };
  let reads=0,approvals=0;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:async()=>{approvals++;return true;},
    runner:async argv=>{
      reads++;
      assert.equal(argv[0],'plan-geometry-resize-propagation');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      const src=JSON.parse(await readFile(argv[argv.indexOf('--propagation')+1],'utf8'));
      assert.deepEqual(src,propagation);
      return valid;
    },
  });
  const proposed=await client.planGeometryResizePropagation({
    input:'/abs/model.bbmodel',expectedSha256:SHA,propagation,
  });
  assert.deepEqual(proposed.plan.operations,operations);
  assert.equal(proposed.diagnostic.persistent_constraints,false);
  assert.equal(approvals,0);
  for(const invalid of [
    {...propagation,expected_revision:1},
    {...propagation,links:[]},
    {...propagation,links:Array.from({length:33},()=>propagation.links[0])},
    {...propagation,links:[{...propagation.links[0],clearance:Infinity}]},
  ]){
    await assert.rejects(client.planGeometryResizePropagation({
      input:'/abs/model.bbmodel',expectedSha256:SHA,propagation:invalid,
    }),/CODE_MODE_GEOMETRY_PROPAGATION_INPUT_INVALID/);
  }
  assert.equal(reads,1);
  for(const wrong of [
    {...valid,write_authority:'GRANTED'},
    {...valid,preflight:{...valid.preflight,write_authority:'GRANTED'}},
    {...valid,plan:{...valid.plan,operations:[operations[0],{
      op:'translate_cube',uuid:'unrequested',delta:[-3,0,0],
    }]}},
    {...valid,diagnostic:{...valid.diagnostic,persistent_constraints:true}},
    {...valid,diagnostic:{...valid.diagnostic,ordered_links:[{
      ...valid.diagnostic.ordered_links[0],anchor_cube_uuid:'wrong_parent',
    }]}},
    {...valid,preflight:{...valid.preflight,mutation:{
      ...valid.preflight.mutation,changed_uuids:['base','wrong_child'],
    }}},
    {...valid,diagnostic:{...valid.diagnostic,collision_verdict:'CLEAR'}},
    {...valid,diagnostic:{...valid.diagnostic,
      aabb_overlap_review:{...geometryReview(2),affected_cube_count:1}}},
    {...valid,diagnostic:{...valid.diagnostic,
      aabb_overlap_review:{...geometryReview(2),introduced_overlap_count:1,
        introduced_samples:[{cube_uuids:['arm','other'],overlap:[0,1,1]}]}}},
    {...valid,diagnostic:{...valid.diagnostic,ordered_links:[{
      ...valid.diagnostic.ordered_links[0],delta:[-5,0,0],
    }]}}
  ]){
    const forged=createRustCodeModeClient({
      binary:BIN,runner:async()=>wrong,
    });
    await assert.rejects(forged.planGeometryResizePropagation({
      input:'/abs/model.bbmodel',expectedSha256:SHA,propagation,
    }),/CODE_MODE_GEOMETRY_PROPAGATION_RECEIPT_INVALID/);
  }
  assert.equal(approvals,0);
});

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

test('Code Mode pages all six faces or attention-only candidates from one SHA-pinned Rust read', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      if (argv[0] === 'inspect') {
        return {status:'OK', sha256:SHA, summary:{revision:0}};
      }
      calls.push(argv);
      assert.equal(argv[0], 'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      const queries = JSON.parse(await readFile(argv[argv.indexOf('--queries') + 1], 'utf8'));
      const attentionOnly = queries.requests[0].attention_only === true;
      assert.deepEqual(queries, { requests: [attentionOnly
        ? {kind:'model_texture_coverage',offset:1,limit:2,attention_only:true}
        : {kind:'model_texture_coverage',offset:0,limit:2}] });
      return {status:'OK',sha256:SHA,summary:{revision:0},results:[
        {kind:'model_texture_coverage',coverage:{
          scope:'saved_face_texture_coverage_page',
          visual_verdict:'UNVERIFIED',face_coverage_verdict:'UNVERIFIED',
          attention_only:attentionOnly,total_cubes:3,
          offset:attentionOnly ? 1 : 0,limit:2,
          reviewed_cubes:2,returned_cubes:attentionOnly ? 1 : 2,
          returned_faces:attentionOnly ? 1 : 12,
          review_candidates:1,fully_transparent_faces:1,
          partially_transparent_faces:0,translucent_faces:0,
          unresolved_reference_or_mapping_faces:0,
          next_offset:attentionOnly ? null : 2,
          cubes:attentionOnly ? [{cube_uuid:'cube-3',review_candidates:1,faces:[
            {side:'up',reference_kind:'uuid',texture_uuid:'texture-1',
              status:'fully_transparent_pixels',reason:null,
              alpha_pixels:{sampled:4,transparent:4,translucent:0,opaque:0}},
          ]}] : [],
        }},
      ]};
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const full = await project.inspectBatch([
    {kind:'model_texture_coverage',offset:0,limit:2},
  ]);
  assert.equal(full.results[0].coverage.attention_only,false);
  assert.equal(full.results[0].coverage.reviewed_cubes,2);
  const focus = await project.inspectBatch([
    {kind:'model_texture_coverage',offset:1,limit:2,attention_only:true},
  ]);
  assert.equal(focus.results[0].coverage.attention_only,true);
  assert.equal(focus.results[0].coverage.returned_cubes,1);
  assert.equal(focus.results[0].coverage.returned_faces,1);
  assert.equal(focus.results[0].coverage.cubes[0].faces[0].status,'fully_transparent_pixels');
  assert.equal(focus.results[0].coverage.face_coverage_verdict,'UNVERIFIED');
  for (const query of [
    {kind:'model_texture_coverage',offset:0,limit:9,attention_only:true},
    {kind:'model_texture_coverage',offset:0,limit:2,attention_only:'true'},
    {kind:'model_texture_coverage',offset:0,limit:2,attention_only:1},
    {kind:'model_texture_coverage',offset:0,limit:2,attention_only:null},
    {kind:'model_texture_coverage',offset:0,limit:2,attention_only:true,unsafe:true},
  ]) {
    await assert.rejects(project.inspectBatch([query]));
  }
  assert.equal(calls.length,2);
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

// SOURCE_AUTHORED_NOT_RUN: a part name and stage resolve via one native
// batch without scanning catalogs or exposing arbitrary operations.
test('named target orientation uses one SHA-bound read and refuses wrong domains',async()=>{
  let calls=0;
  const client=createRustCodeModeClient({binary:BIN,runner:async argv=>{
    calls++;
    assert.equal(argv[0],'inspect-batch');
    assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
    const q=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
    assert.deepEqual(q,{requests:[{
      kind:'authoring_target',domain:'texturing',category:'cubes',name:'Helmet',
    }]});
    return {status:'OK',sha256:SHA,summary:{revision:0},results:[{
      kind:'authoring_target',target:{
        scope:'saved_model_named_target_orientation',status:'EXACT_MATCH',
        selected:{identity:{uuid:'cube-helmet',name:'Helmet',index:0}},
        candidate_operations:['paint_cube_face_regions_guarded'],
        source_blockers:[],
        write_authority:'NOT_GRANTED',visual_verdict:'UNVERIFIED',
      },
    }]};
  }});
  const result=await client.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,requests:[{
      kind:'authoring_target',domain:'texturing',category:'cubes',name:'Helmet',
    }],
  });
  assert.equal(result.results[0].target.selected.identity.uuid,'cube-helmet');
  assert.equal(result.results[0].target.write_authority,'NOT_GRANTED');
  assert.equal(calls,1);
  for(const invalid of [
    {domain:'geometry',category:'textures',name:'Helmet'},
    {domain:'UV',category:'cubes',name:'Helmet'},
    {domain:'texturing',category:'cubes',name:' Helmet'},
    {domain:'texturing',category:'cubes',name:'Helmet',unsafe:true},
    {domain:'texturing',category:'cubes'},
    {domain:'texturing',category:'cubes',name:'x'.repeat(129)},
  ]) {
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,
      requests:[{kind:'authoring_target',...invalid}],
    }));
  }
  assert.equal(calls,1);
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

// SOURCE_AUTHORED_NOT_RUN. Repeated read-only queries inside one Rust
// inspection may share native work; never reuse responses across SHA checks.
test('Code Mode coalesces only identical selectors inside one SHA-pinned batch', async () => {
  let cliCalls = 0;
  let tempQueries;
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async argv => {
      cliCalls++;
      assert.equal(argv[0], 'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1], SHA);
      tempQueries = argv[argv.indexOf('--queries')+1];
      const payload = JSON.parse(await readFile(tempQueries, 'utf8'));
      assert.deepEqual(payload, {requests: [
        {kind:'cube_uv_sharing',uuid:'cube-a',texture_uuid:'atlas-a'},
        {kind:'audit'},
      ]});
      return {status:'OK',sha256:SHA,summary:{revision:0},results:[
        {kind:'cube_uv_sharing',uv_sharing:{visual_verdict:'UNVERIFIED',declared_overlap_pairs:2}},
        {kind:'audit',audit:{scope:'static_metadata_only'}},
      ]};
    },
  });
  const first = {kind:'cube_uv_sharing',uuid:'cube-a',texture_uuid:'atlas-a'};
  const reordered = {texture_uuid:'atlas-a',kind:'cube_uv_sharing',uuid:'cube-a'};
  const request = {input:'/abs/model.bbmodel',expectedSha256:SHA,
    requests:[first,{kind:'audit'},reordered,first]};
  const response = await client.inspectBatch(request);
  assert.equal(cliCalls,1);
  assert.equal(response.results.length,4);
  assert.deepEqual(response.results[0],response.results[2]);
  assert.deepEqual(response.results[0],response.results[3]);
  assert.notStrictEqual(response.results[0],response.results[2]);
  assert.equal(response.results[1].audit.scope,'static_metadata_only');
  assert.equal(response.sha256,SHA);
  response.results[0].uv_sharing.declared_overlap_pairs = 999;
  assert.equal(response.results[2].uv_sharing.declared_overlap_pairs,2);
  await assert.rejects(readFile(tempQueries,'utf8'), error=>error.code==='ENOENT');
});

test('Code Mode duplicate inspection refuses stale, missing, mismatched or oversized receipts', async () => {
  const repeated = [{kind:'audit'},{kind:'audit'}];
  for(const incorrect of [
    {status:'OK',sha256:SHA,results:[]},
    {status:'OK',sha256:'0'.repeat(64),results:[{kind:'audit',audit:{}}]},
    {status:'OK',sha256:SHA,results:[{kind:'cube',audit:{}}]},
  ]){
    let calls=0;
    const client=createRustCodeModeClient({
      binary:BIN,runner:async ()=>{calls++;return incorrect;},
    });
    await assert.rejects(client.inspectBatch({
      input:'/abs/model.bbmodel',expectedSha256:SHA,requests:repeated,
    }),/CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID/);
    assert.equal(calls,1);
  }
  const oversized=createRustCodeModeClient({
    binary:BIN,runner:async ()=>({status:'OK',sha256:SHA,
      results:[{kind:'audit',audit:{large:'x'.repeat(50*1024)}}]}),
  });
  await assert.rejects(oversized.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,requests:repeated,
  }),/CODE_MODE_INSPECT_BATCH_RESULT_TOO_LARGE/);
  let staleCalls=0;
  const stale=createRustCodeModeClient({binary:BIN,
    runner:async ()=>{staleCalls++;throw Error('SOURCE_SHA256_STALE');},
  });
  await assert.rejects(stale.inspectBatch({
    input:'/abs/model.bbmodel',expectedSha256:SHA,requests:repeated,
  }),/SOURCE_SHA256_STALE/);
  assert.equal(staleCalls,1);
});

// SOURCE_AUTHORED_NOT_RUN: unique selectors must not bypass the same native
// SHA, result-order and byte-budget checks enforced for duplicate batches.
test('Code Mode validates Rust receipts for unique inspection selectors', async () => {
  const request = {
    input:'/abs/model.bbmodel',expectedSha256:SHA,
    requests:[{kind:'audit'},{kind:'catalog',category:'cubes',limit:1}],
  };
  const audit={kind:'audit',audit:{visual_verdict:'UNVERIFIED'}};
  const catalog={kind:'catalog',catalog:{entries:[],total:0,next_offset:null}};
  for (const invalid of [
    {status:'OK',results:[audit,catalog]},
    {status:'OK',sha256:'b'.repeat(64),results:[audit,catalog]},
    {status:'OK',sha256:SHA,results:[audit]},
    {status:'OK',sha256:SHA,results:[audit,catalog,audit]},
    {status:'OK',sha256:SHA,results:[catalog,audit]},
    {status:'OK',sha256:SHA,results:[audit,null]},
  ]) {
    let calls=0;
    const client=createRustCodeModeClient({
      binary:BIN,runner:async argv=>{
        calls++;
        assert.equal(argv[0],'inspect-batch');
        return invalid;
      },
    });
    await assert.rejects(client.inspectBatch(request),
      /CODE_MODE_INSPECT_BATCH_RECEIPT_INVALID/);
    assert.equal(calls,1);
  }
  const oversized=createRustCodeModeClient({
    binary:BIN,runner:async ()=>({
      status:'OK',sha256:SHA,
      results:[{kind:'audit',audit:{data:'x'.repeat(97*1024)}}],
    }),
  });
  await assert.rejects(oversized.inspectBatch({
    ...request,requests:[{kind:'audit'}],
  }),/CODE_MODE_INSPECT_BATCH_RESULT_TOO_LARGE/);
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

// SOURCE_AUTHORED_NOT_RUN: do not calculate UV coordinates inside JS.
// The native face projector alone determines where a row span actually lands.
test('material face span selectors stay bounded until native projection',async()=>{
  const query={kind:'material_face_patch',
    texture_uuid:'texture-1',cube_uuid:'cube-1',face:'north',
    region:{from:[1,5],to:[2,6]},
    face_spans:[{y:0,x0:0,x1:1}]};
  let batchCalls=0;
  const client=createRustCodeModeClient({
    binary:BIN,
    runner:async argv=>{
      if(argv[0]==='inspect')
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      assert.equal(argv[0],'inspect-batch');
      const data=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
      assert.deepEqual(data.requests,[query]);
      batchCalls++;
      return {status:'OK',sha256:SHA,summary:{revision:0},
        results:[{kind:'material_face_patch',binding:{
          scope:'source_explicit_cube_face_patch',status:'bound_source_only',
          cluster_footprint:{scope:'saved_face_local_to_atlas',
            status:'within_selected_patch',span_count:1,visual_verdict:'UNVERIFIED'},
        }}]};
    },
  });
  const project=await openRustCodeModeProject(client,'/abs/model.bbmodel');
  assert.equal((await project.inspectBatch([query])).results[0]
    .binding.cluster_footprint.span_count,1);
  for(const spans of [
    [],[{y:0,x0:0,x1:0}],[{y:256,x0:0,x1:1}],
    [{y:0,x0:0,x1:1,file:'/secret'}],
    Array.from({length:65},()=>({y:0,x0:0,x1:1})),
  ])await assert.rejects(project.inspectBatch([
    {...query,face_spans:spans}
  ]),/MATERIAL_FACE_SPANS_INVALID/);
  assert.equal(batchCalls,1);
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


test('Bedrock animation export uses exact SHA, trusted approval and one CLI write', async () => {
  const calls = [];
  const approvals = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: async (request) => { approvals.push(request); return true; },
    runner: async (args) => {
      calls.push(args);
      return { status: 'OK', source_sha256: SHA, output_sha256: SHA,
        bytes: 128, format: 'minecraft:animation', curve_fidelity: 'adaptive_bezier_approximation' };
    },
  });
  const receipt = await client.exportAnimations({
    input: '/abs/model.bbmodel', output: '/abs/model.animation.json', expectedSha256: SHA,
  });
  assert.equal(receipt.format, 'minecraft:animation');
  assert.equal(receipt.curve_fidelity, 'adaptive_bezier_approximation');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].operation, 'exportAnimations');
  assert.equal(approvals[0].expectedSha256, SHA);
  assert.equal(approvals[0].output, '/abs/model.animation.json');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'export-animation');
  assert.ok(calls[0].includes('--expected-sha256'));
  const denied = createRustCodeModeClient({
    binary: BIN, runner: async () => { throw new Error('must not run'); },
  });
  await assert.rejects(denied.exportAnimations({
    input: '/abs/model.bbmodel', output: '/abs/model.animation.json', expectedSha256: SHA,
  }), /CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
});


test('asset handoff is a single SHA-bound read without PNG data or write authority', async () => {
  const calls = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      if (argv[0] === 'inspect') {
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      }
      calls.push(argv);
      assert.equal(argv[0], 'inspect-batch');
      assert.ok(argv.includes('--expected-sha256'));
      const queryPath = argv[argv.indexOf('--queries') + 1];
      const queries = JSON.parse(await readFile(queryPath, 'utf8'));
      assert.deepEqual(queries, {requests: [
        {kind:'asset_handoff',texture_uuid:'texture-1'},
      ]});
      return {status:'OK',sha256:SHA,summary:{revision:0},
        results:[{kind:'asset_handoff',handoff:{
          scope:'bedrock_single_atlas_export_handoff',status:'blocked',
          visual_verdict:'UNVERIFIED',native_verdict:'NOT_EXECUTED',
          selected_texture_uuid:'texture-1',blockers:['SELECTED_TEXTURE_NOT_BOUND'],
          total_issues:6,issue_offset:0,next_issue_offset:null,
          issues:[],
          geometry:{status:'source_exportable',sha256:'a'.repeat(64),bytes:100,
            visible_bounds_source:'computed_static',
            visible_bounds:{width:2,height:2,offset:[0,0,0]}},
          texture:{status:'blocked',reason:'PAINT_EXPORT_TEXTURE_UNSUPPORTED'},
          animation:{status:'not_required'},
          faces:{total:6,selected_texture:0,other_texture:0,unresolved:0,
            unset:0,false_reference:6,explicitly_absent:0},
        }}]};
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const result = await project.inspectBatch([
    {kind:'asset_handoff',texture_uuid:'texture-1'},
  ]);
  assert.equal(result.results[0].kind,'asset_handoff');
  assert.equal(result.results[0].handoff.native_verdict,'NOT_EXECUTED');
  assert.equal(result.results[0].handoff.geometry.visible_bounds_source,'computed_static');
  assert.deepEqual(result.results[0].handoff.geometry.visible_bounds,
    {width:2,height:2,offset:[0,0,0]});
  assert.equal(calls.length,1);
  await assert.rejects(project.inspectBatch([
    {kind:'asset_handoff',texture_uuid:'texture-1',file_path:'/secrets'},
  ]),/Unknown inspection selector or field/);
  await assert.rejects(project.inspectBatch([
    {kind:'asset_handoff'},
  ]),/Missing required inspection selector field/);
  assert.equal(calls.length,1);
});


test('asset_handoff pages exact Cube-face issues with strict bounded read selectors', async () => {
  const reads = [];
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async (argv) => {
      if (argv[0] === 'inspect') {
        return {status:'OK',sha256:SHA,summary:{revision:0}};
      }
      assert.equal(argv[0], 'inspect-batch');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      const requests = JSON.parse(
        await readFile(argv[argv.indexOf('--queries') + 1], 'utf8')
      ).requests;
      reads.push(requests);
      const offset = requests[0].offset ?? 0;
      const issues = [
        {cube_uuid:'cube-1',face:'north',problem:'false_reference',
          reference_kind:'false',referenced_texture_uuid:null},
        {cube_uuid:'cube-2',face:'east',problem:'other_texture',
          reference_kind:'uuid',referenced_texture_uuid:'texture-2'},
      ];
      return {status:'OK',sha256:SHA,summary:{revision:0},
        results:[{kind:'asset_handoff',handoff:{
          scope:'bedrock_single_atlas_export_handoff',status:'blocked',
          visual_verdict:'UNVERIFIED',native_verdict:'NOT_EXECUTED',
          selected_texture_uuid:'texture-1',faces:{
            total:12,selected_texture:10,other_texture:1,
            unresolved:0,unset:0,false_reference:1,explicitly_absent:0,
          },total_issues:2,issue_offset:offset,
          next_issue_offset:offset === 0 ? 1 : null,
          issues:[issues[offset]],
          geometry:{status:'source_exportable',sha256:SHA,bytes:128},
          texture:{status:'source_exportable',sha256:SHA,bytes:256},
          animation:{status:'not_required',sha256:null,bytes:null},
          blockers:['MULTIPLE_REFERENCED_TEXTURES','IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES'],
        }}]};
    },
  });
  const project = await openRustCodeModeProject(client, '/abs/model.bbmodel');
  const first = await project.inspectBatch([
    {kind:'asset_handoff',texture_uuid:'texture-1',offset:0,limit:1},
  ]);
  assert.equal(first.results[0].handoff.issues[0].face,'north');
  assert.equal(first.results[0].handoff.next_issue_offset,1);
  const second = await project.inspectBatch([
    {kind:'asset_handoff',texture_uuid:'texture-1',offset:1,limit:1},
  ]);
  assert.equal(second.results[0].handoff.issues[0].cube_uuid,'cube-2');
  assert.equal(second.results[0].handoff.issues[0].referenced_texture_uuid,'texture-2');
  assert.equal(second.results[0].handoff.next_issue_offset,null);
  assert.deepEqual(reads,[
    [{kind:'asset_handoff',texture_uuid:'texture-1',offset:0,limit:1}],
    [{kind:'asset_handoff',texture_uuid:'texture-1',offset:1,limit:1}],
  ]);
  for (const bad of [
    {kind:'asset_handoff',texture_uuid:'texture-1',limit:0},
    {kind:'asset_handoff',texture_uuid:'texture-1',limit:33},
    {kind:'asset_handoff',texture_uuid:'texture-1',offset:393217},
    {kind:'asset_handoff',texture_uuid:'texture-1',offset:-1},
    {kind:'asset_handoff',texture_uuid:'texture-1',limit:1,filename:'secret.png'},
  ]) {
    await assert.rejects(project.inspectBatch([bad]));
  }
  assert.equal(reads.length,2);
});


test('precise face texture correction uses one SHA-pinned approved Rust plan', async () => {
  const approvals = [];
  const writtenPlans = [];
  const operation = {
    op: 'assign_cube_face_texture', cube_uuid: 'cube-1',
    face: 'north', texture_uuid: 'texture-1',
  };
  const client = createRustCodeModeClient({
    binary: BIN,
    authorizeMutation: async (request) => {
      approvals.push(request);
      return request.operation === 'apply' && request.expectedSha256 === SHA;
    },
    runner: async (argv) => {
      assert.equal(argv[0], 'apply');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      const file = argv[argv.indexOf('--plan') + 1];
      writtenPlans.push(JSON.parse(await readFile(file, 'utf8')));
      return {status:'OK',mutation:{
        revision:1,operation_count:1,changed_uuids:['cube-1'],
      }};
    },
  });
  const result = await client.apply({
    input:'/abs/model.bbmodel',output:'/abs/one-face.bbmodel',
    expectedSha256:SHA,operations:[operation],
  });
  assert.deepEqual(writtenPlans, [{expected_revision:0,operations:[operation]}]);
  assert.equal(approvals.length,1);
  assert.deepEqual(approvals[0].operationKinds,['assign_cube_face_texture']);
  assert.equal(approvals[0].operationCount,1);
  assert.match(approvals[0].planSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.mutation.changed_uuids[0],'cube-1');
  const noApproval = createRustCodeModeClient({
    binary:BIN,runner:async()=>{throw Error('write must never run');},
  });
  await assert.rejects(noApproval.apply({
    input:'/abs/model.bbmodel',output:'/abs/one-face.bbmodel',
    expectedSha256:SHA,operations:[operation],
  }),/CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
});

test('authored visible_box uses one host-approved SHA-pinned Rust edit', async () => {
  const operation = {op:'set_visible_box',bounds:[6,6,1]};
  const approvals=[];
  const plans=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:async request=>{
      approvals.push(request);
      return request.operation==='apply' && request.expectedSha256===SHA;
    },
    runner:async argv=>{
      assert.equal(argv[0],'apply');
      assert.equal(argv[argv.indexOf('--expected-sha256')+1],SHA);
      plans.push(JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8')));
      return {status:'OK',mutation:{
        revision:1,operation_count:1,changed_uuids:['project-visible-box'],
      }};
    },
  });
  const result=await client.apply({
    input:'/abs/model.bbmodel',output:'/abs/model-visible.bbmodel',
    expectedSha256:SHA,operations:[operation],
  });
  assert.deepEqual(plans,[{expected_revision:0,operations:[operation]}]);
  assert.deepEqual(approvals[0].operationKinds,['set_visible_box']);
  assert.equal(approvals[0].operationCount,1);
  assert.match(approvals[0].planSha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(result.mutation.changed_uuids,['project-visible-box']);
  const untrusted=createRustCodeModeClient({
    binary:BIN,runner:async()=>{throw Error('write should not be called');},
  });
  await assert.rejects(untrusted.apply({
    input:'/abs/model.bbmodel',output:'/abs/model-visible.bbmodel',
    expectedSha256:SHA,operations:[operation],
  }),/CODE_MODE_MUTATION_AUTHORITY_REQUIRED/);
});

test('Code Mode forwards inner protected pixels and exact-before preconditions to Rust',async()=>{
  const approval=[],launches=[];
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:request=>{approval.push(request);return true;},
    runner:async argv=>{
      launches.push(argv[0]);
      assert.equal(argv[0],'apply');
      const plan=JSON.parse(await readFile(argv[argv.indexOf('--plan')+1],'utf8'));
      assert.deepEqual(plan.correction_scope,{
        texture_uuid:'00000000-0000-4000-8000-000000007101',
        allowed_regions:[{from:[1,1],to:[6,6]}],
        preserve_alpha:true,
        protected_regions:[{from:[2,2],to:[4,4]}],
        expected_before_pixels:[{at:[4,4],rgba:[60,70,80,255]}],
      });
      return {status:'OK',source_sha256:SHA,
        output_sha256:'b'.repeat(64),summary:{revision:1},
        mutation:{revision:1,operation_count:1,changed_uuids:[]},
        correction_scope:{status:'enforced',
          texture_uuid:'00000000-0000-4000-8000-000000007101',
          protected_regions:1,expected_before_pixels:1,
          editable_before_rgba:0,visual_verdict:'UNVERIFIED'}};
    },
  });
  const correctionScope={
    textureUuid:'00000000-0000-4000-8000-000000007101',
    allowedRegions:[{from:[1,1],to:[6,6]}],
    preserveAlpha:true,
    protectedRegions:[{from:[2,2],to:[4,4]}],
    expectedBeforePixels:[{at:[4,4],rgba:[60,70,80,255]}],
  };
  await client.apply({
    input:'/abs/model.bbmodel',output:'/abs/model-edited.bbmodel',
    expectedSha256:SHA,correctionScope,
    operations:[{op:'paint_texture_pixel',texture_index:0,x:4,y:4,
      rgba:[80,90,100,255]}],
  });
  assert.equal(launches.length,1);
  assert.deepEqual(approval[0].correctionScope.protectedRegions,[
    {from:[2,2],to:[4,4]},
  ]);
  assert.deepEqual(approval[0].correctionScope.expectedBeforePixels,[
    {at:[4,4],rgba:[60,70,80,255]},
  ]);
  for(const invalid of [
    {...correctionScope,protectedRegions:[{from:[2,2],to:[2,3]}]},
    {...correctionScope,expectedBeforePixels:[
      {at:[4,4],rgba:[60,70,80,255]},
      {at:[4,4],rgba:[60,70,80,255]},
    ]},
    {...correctionScope,expectedBeforePixels:[{at:[256,1],
      rgba:[60,70,80,255]}]},
    {...correctionScope,expectedBeforePixels:[{at:[4,4],
      rgba:[60,70,800,255]}]},
    {...correctionScope,protectedRegions:[{from:[-1,0],to:[1,1]}]},
  ]) {
    await assert.rejects(client.apply({
      input:'/abs/model.bbmodel',output:'/abs/model-invalid.bbmodel',
      expectedSha256:SHA,correctionScope:invalid,
      operations:[{op:'paint_texture_pixel',texture_index:0,x:4,y:4,
        rgba:[80,90,100,255]}],
    }),/CORRECTION_SCOPE_INVALID|coordinate/);
  }
  assert.equal(launches.length,1);
  assert.equal(approval.length,1);
});

test('reviewed source-color allowlist is sent as exact RGBA preimage guard',async()=>{
  let approvals=0,invocations=0;
  const client=createRustCodeModeClient({
    binary:BIN,
    authorizeMutation:descriptor=>{
      approvals++;
      assert.deepEqual(descriptor.correctionScope.editableBeforeRgba,[
        [80,90,100,255],
      ]);
      return true;
    },
    runner:async argv=>{
      invocations++;
      const native=JSON.parse(await readFile(
        argv[argv.indexOf('--plan')+1],'utf8'));
      assert.deepEqual(native.correction_scope.editable_before_rgba,[
        [80,90,100,255],
      ]);
      return {status:'OK',source_sha256:SHA,
        output_sha256:'b'.repeat(64),summary:{revision:1},
        mutation:{revision:1,operation_count:1,changed_uuids:[]},
        correction_scope:{status:'enforced',
          texture_uuid:'00000000-0000-4000-8000-000000007101',
          protected_regions:0,expected_before_pixels:0,
          editable_before_rgba:1,visual_verdict:'UNVERIFIED'}};
    },
  });
  const base={
    textureUuid:'00000000-0000-4000-8000-000000007101',
    allowedRegions:[{from:[1,1],to:[5,5]}],
    preserveAlpha:true,
    editableBeforeRgba:[[80,90,100,255]],
  };
  const apply=scope=>client.apply({
    input:'/abs/model.bbmodel',output:'/abs/model-next.bbmodel',
    expectedSha256:SHA,
    correctionScope:scope,
    operations:[{op:'paint_texture_pixel',texture_index:0,
      x:1,y:1,rgba:[100,110,130,255]}],
  });
  await apply(base);
  assert.equal(invocations,1);
  assert.equal(approvals,1);
  for(const bad of [
    {...base,editableBeforeRgba:[]},
    {...base,editableBeforeRgba:[[80,90,100,255],[80,90,100,255]]},
    {...base,editableBeforeRgba:[[80,90,100,300]]},
    {...base,editableBeforeRgba:[[80,90,100]]},
    {...base,editableBeforeRgba:17},
    {...base,editableBeforeRgba:Array.from({length:8192},
      (_,i)=>[i%256,Math.floor(i/256),100,255])},
  ]) {
    await assert.rejects(apply(bad),/CORRECTION_SCOPE_INVALID/);
  }
  assert.equal(invocations,1);
  assert.equal(approvals,1);
});

test('scoped Rust Paint never reports success from missing or mismatched native guard receipts',async()=>{
  const scope={textureUuid:'00000000-0000-4000-8000-000000007101',
    allowedRegions:[{from:[1,1],to:[3,3]}],preserveAlpha:true,
    editableBeforeRgba:[[80,90,100,255]]};
  const valid={status:'OK',source_sha256:SHA,
    output_sha256:'b'.repeat(64),summary:{revision:1},
    correction_scope:{status:'enforced',texture_uuid:scope.textureUuid,
      protected_regions:0,expected_before_pixels:0,
      editable_before_rgba:1,visual_verdict:'UNVERIFIED'},
    mutation:{revision:1,operation_count:1,changed_uuids:[]}};
  const bad=[
    {...valid,correction_scope:undefined},
    {...valid,correction_scope:{...valid.correction_scope,editable_before_rgba:0}},
    {...valid,correction_scope:{...valid.correction_scope,texture_uuid:'other'}},
    {...valid,correction_scope:{...valid.correction_scope,visual_verdict:'ACCEPTED'}},
    {...valid,source_sha256:'c'.repeat(64)},
    {...valid,output_sha256:'bad'},
    {...valid,mutation:{...valid.mutation,operation_count:0}},
    {...valid,summary:{revision:0}},
  ];
  for(const response of bad){
    let calls=0;
    const client=createRustCodeModeClient({binary:BIN,
      authorizeMutation:()=>true,
      runner:async argv=>{
        calls++;
        assert.equal(argv[0],'apply');
        return response;
      },
    });
    await assert.rejects(client.apply({
      input:'/abs/model.bbmodel',output:'/abs/unverified.bbmodel',
      expectedSha256:SHA,correctionScope:scope,
      operations:[{op:'paint_texture_pixel',texture_index:0,
        x:1,y:1,rgba:[100,110,120,255]}],
    }),/CODE_MODE_RUST_CORRECTION_RECEIPT_UNVERIFIED/);
    assert.equal(calls,1); // no automatic retry after possible publication
  }
});

test('semanticMap accepts only exact SHA-bound small Rust identity pages', async () => {
  const calls = [];
  const semantic = {
    scope: 'validated_rust_semantic_identity_map', revision: 0,
    category: 'cubes', offset: 0, total: 1, next_offset: null,
    counts: { cubes: 1, bones: 0, textures: 0, animations: 0 },
    entries: [{ kind: 'cube', index: 0, uuid: 'cube-1', name: 'Helmet',
      parent_uuid: null, declared_textured_faces: 4 }],
    write_authority: 'NOT_GRANTED',
    visual_verdict: 'UNVERIFIED', effective_material: 'UNVERIFIED',
  };
  const client = createRustCodeModeClient({
    binary: BIN, runner: async (argv) => {
      calls.push(argv);
      return { status: 'OK', sha256: SHA, summary: { revision: 0 }, map: semantic };
    },
  });
  const response = await client.semanticMap({
    input: '/abs/model.bbmodel', expectedSha256: SHA, category: 'cubes',
    offset: 0, limit: 2,
  });
  assert.equal(response.map.entries[0].parent_uuid, null);
  assert.deepEqual(calls[0], [
    'semantic-map', '--input', '/abs/model.bbmodel',
    '--expected-sha256', SHA, '--category', 'cubes',
    '--offset', '0', '--limit', '2',
  ]);
  await assert.rejects(client.semanticMap({
    input: '/abs/model.bbmodel', expectedSha256: SHA,
    category: 'invalid', limit: 2,
  }), /CODE_MODE_SEMANTIC_MAP_QUERY_INVALID/);
  await assert.rejects(client.semanticMap({
    input: '/abs/model.bbmodel', expectedSha256: SHA,
    category: 'cubes', limit: 25,
  }), /CODE_MODE_SEMANTIC_MAP_QUERY_INVALID/);
  assert.equal(calls.length, 1);

  for (const invalid of [
    { sha256: 'b'.repeat(64) },
    { map: { ...semantic, write_authority: 'GRANTED' } },
    { map: { ...semantic, entries: [{ ...semantic.entries[0], index: 8 }] } },
    { map: { ...semantic, revision: 1 } },
    { map: { ...semantic, category: 'textures' } },
  ]) {
    const bad = createRustCodeModeClient({ binary: BIN, runner: async () => ({
      status: 'OK', sha256: SHA, summary: { revision: 0 },
      map: semantic, ...invalid,
    }) });
    await assert.rejects(bad.semanticMap({
      input: '/abs/model.bbmodel', expectedSha256: SHA, category: 'cubes',
    }), /CODE_MODE_SEMANTIC_MAP_RECEIPT_INVALID/);
  }
});

test('Code Mode preflight uses exact Rust edit plan but never requests write approval', async () => {
  const operations = [{ op: 'translate_cube', uuid: 'cube-1', delta: [1, 0, 0] }];
  const calls = [];
  let tempFile = null;
  const client = createRustCodeModeClient({
    binary: BIN,
    runner: async argv => {
      calls.push(argv[0]);
      assert.equal(argv[0], 'preflight');
      assert.equal(argv[argv.indexOf('--expected-sha256') + 1], SHA);
      assert.equal(argv.includes('--output'), false);
      tempFile = argv[argv.indexOf('--plan') + 1];
      const plan = JSON.parse(await readFile(tempFile, 'utf8'));
      assert.deepEqual(plan, { expected_revision: 0, operations });
      return {
        status: 'OK', sha256: SHA, summary: { revision: 0 },
        preflight: {
          status: 'VALIDATED_NOT_APPLIED', base_revision: 0,
          mutation: { revision: 1, operation_count: 1, changed_uuids: ['cube-1'] },
          candidate_sha256: 'b'.repeat(64),
          candidate_summary: { revision: 1 },
          write_authority: 'NOT_GRANTED', visual_verdict: 'UNVERIFIED',
        },
      };
    },
  });
  // No authorizeMutation callback: preflight is NOT a mutation capability.
  const receipt = await client.preflight({
    input: '/abs/model.bbmodel', expectedSha256: SHA, operations,
  });
  assert.equal(receipt.preflight.status, 'VALIDATED_NOT_APPLIED');
  assert.deepEqual(calls, ['preflight']);
  await assert.rejects(readFile(tempFile, 'utf8'), { code: 'ENOENT' });
  await assert.rejects(client.preflight({
    input: '/abs/model.bbmodel', expectedSha256: SHA, operations: [],
  }), /operations must contain/);
  assert.deepEqual(calls, ['preflight']);
  for (const bad of [
    { sha256: 'c'.repeat(64) },
    { preflight: { ...receipt.preflight, write_authority: 'GRANTED' } },
    { preflight: { ...receipt.preflight, candidate_sha256: 'invalid' } },
    { preflight: { ...receipt.preflight, mutation: { revision: 1,
      operation_count: 2, changed_uuids: [] } } },
  ]) {
    const invalid = createRustCodeModeClient({ binary: BIN, runner: async () => ({
      ...receipt, ...bad,
    }) });
    await assert.rejects(invalid.preflight({
      input: '/abs/model.bbmodel', expectedSha256: SHA, operations,
    }), /CODE_MODE_PREFLIGHT_RECEIPT_INVALID/);
  }
});

test('Rust adapter timing observer reports only allowed command, duration and success', async () => {
  const samples = [];
  const client=createRustCodeModeClient({
    binary:BIN,
    onNativeCall: sample => samples.push(sample),
    runner:async argv=>({
      status:argv[0]==='inspect'?'OK':'ERROR',
      ...(argv[0]==='inspect'?{sha256:SHA,summary:{revision:0}}:
        {code:'SOURCE_SHA256_STALE'}),
    }),
  });
  await client.inspect({input:'/abs/source.bbmodel'});
  await assert.rejects(client.audit({
    input:'/abs/source.bbmodel',expectedSha256:SHA,
  }),/SOURCE_SHA256_STALE/);
  assert.deepEqual(samples.map(s=>s.command),['inspect','inspect']);
  assert.deepEqual(samples.map(s=>s.success),[true,false]);
  assert.ok(samples.every(s=>Number.isSafeInteger(s.duration_ms)&&s.duration_ms>=0));
  assert.ok(samples.every(s=>Object.keys(s).sort().join(',')===
    'command,duration_ms,success'));
  assert.equal(JSON.stringify(samples).includes('/abs/source.bbmodel'),false);
  assert.equal(JSON.stringify(samples).includes(SHA),false);
});

test('failing native observer cannot change Rust command results', async () => {
  const client=createRustCodeModeClient({
    binary:BIN,
    onNativeCall:()=>{throw Error('BROKEN_METRICS');},
    runner:async()=>({status:'OK',sha256:SHA,summary:{revision:0}}),
  });
  const result=await client.inspect({input:'/abs/source.bbmodel'});
  assert.equal(result.status,'OK');
});


// SOURCE_AUTHORED_NOT_RUN: exact original-color guard supports many swatches
// but never treats a page as approval to change any unobserved source pixel.
test('source correction transport admits many reviewed RGBAs without a 16-slot ceiling',()=>{
  const swatches=Array.from({length:36},(_,i)=>[i,50,90,255]);
  const scope=normalizedCorrectionScope({
    textureUuid:'00000000-0000-4000-8000-000000007101',
    allowedRegions:[{from:[0,0],to:[64,64]}],preserveAlpha:true,
    editableBeforeRgba:swatches,
  });
  assert.deepEqual(scope.editable_before_rgba,swatches);
});


// SOURCE_AUTHORED_NOT_RUN: inspection paging lets the reviewer reach
// every saved swatch without asking the agent to load all colors at once.
test('exact source color selector pages can be requested without broad atlas reads', async()=>{
  let calls=0;
  const client=createRustCodeModeClient({binary:BIN,runner:async argv=>{
    if(argv[0]==='inspect')return {
      status:'OK',sha256:SHA,summary:{revision:0},
    };
    calls++;
    assert.equal(argv[0],'inspect-batch');
    const req=JSON.parse(await readFile(argv[argv.indexOf('--queries')+1],'utf8'));
    assert.deepEqual(req,{requests:[{
      kind:'texture_source_colors',texture_uuid:'atlas-one',
      region:{from:[1,2],to:[5,6]},offset:16,limit:32,
    }]});
    return {status:'OK',sha256:SHA,summary:{revision:0},results:[{
      kind:'texture_source_colors',colors:{
        scope:'saved_physical_atlas_original_rgba_colors',
        texture_uuid:'atlas-one',region:{from:[1,2],to:[5,6]},
        sampled_pixels:16,unique_rgba:17,offset:16,limit:32,
        next_offset:null,histogram_complete:true,complete:false,
        reason:'SOURCE_COLORS_PAGED',
        colors:[{rgba:[9,8,7,255],pixels:1}],
        visual_verdict:'UNVERIFIED',texture_completion_attested:false,
      },
    }]};
  }});
  const project=await openRustCodeModeProject(client,'/abs/model.bbmodel');
  const query={kind:'texture_source_colors',texture_uuid:'atlas-one',
    region:{from:[1,2],to:[5,6]},offset:16,limit:32};
  const response=await project.inspectBatch([query]);
  assert.equal(response.results[0].colors.colors.length,1);
  assert.equal(response.results[0].colors.next_offset,null);
  assert.equal(calls,1);
  for(const bad of [
    {...query,limit:65},
    {...query,offset:-1},
    {...query,filename:'../private.png'},
  ])await assert.rejects(project.inspectBatch([bad]));
  assert.equal(calls,1);
});
