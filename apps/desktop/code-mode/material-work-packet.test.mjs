// SOURCE_ONLY; Node, Rust and native pixel-art QA remain NOT_EXECUTED.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {normalizedMaterialWorkPacket,materialWorkPacketDigest,
  validateMaterialWorkPacketOperations,compileMaterialClusterPaint,
  paintOperationsFingerprint}
  from './material-work-packet.mjs';

const CUBE='00000000-0000-4000-8000-000000000002';
const MODEL='a'.repeat(64);
const REF='b'.repeat(64);
const REGION={from:[8,8],to:[12,12]};
function packet(){
  return {
    sourceModelSha256:MODEL,referencePngSha256:REF,
    issueId:'helmet-flat',approachId:'bevel-clusters',partId:'tier2-helmet',
    textureUuid:'tier2-atlas',material:'metal',
    shadingIntent:'FORM_SHADING',
    reviewedIssueObservation:'The metal helmet remains visually flat on the current source.',
    styleIntent:'Follow the accepted angular painted-metal helmet appearance.',
    lightDirection:'Upper-left key light relative to the helmet front.',
    lightRationale:'The top bevel receives accent light while the bottom recess stays dark.',
    palette:[
      {role:'shadow',rgb:[55,65,80],
        purpose:'Describe the joint recess and side contact.'},
      {role:'base',rgb:[90,105,125],
        purpose:'Carry the resting main material color.'},
      {role:'highlight',rgb:[145,155,168],
        purpose:'Make the illuminated bevel edge readable.'},
    ],
    facePlans:[{
      cubeUuid:CUBE,face:'east',atlasRegion:REGION,
      formCue:'The east panel joins the raised helmet frame and side recess.',
      shadowPlacement:'Local shadow mass follows the recessed joint under the bevel.',
      highlightPlacement:'A narrow value mass follows the outward illuminated edge.',
      clusterPlan:'Use controlled irregular connected stepped clusters, not full-width stripes.',
      clusters:[
        {id:'joint-shadow',role:'shadow',
          formReason:'The helmet joint needs one connected irregular shadow mass.',
          spans:[{y:0,x0:0,x1:2},{y:1,x0:0,x1:3}]},
        {id:'bevel-highlight',role:'highlight',
          formReason:'The bevel needs a small connected light facing pixel mass.',
          spans:[{y:2,x0:2,x1:4},{y:3,x0:3,x1:4}]},
      ],
    }],
  };
}
function scope(){
  return {texture_uuid:'tier2-atlas',allowed_regions:[REGION],
    preserve_alpha:true};
}
function ops(){
  return compileMaterialClusterPaint(packet());
}
function manualOps(rgb=[55,65,80,255]){
  return [{op:'paint_cube_face_regions_guarded',cube_uuid:CUBE,
    texture_uuid:'tier2-atlas',
    regions:[{face:'east',from:[0,0],to:[1,1],rgba:rgb,erase:false}]}];
}
test('a normalized source packet is bounded and binds real planned Paint targets',()=>{
  const p=normalizedMaterialWorkPacket(packet());
  assert.equal(p.shadingIntent,'FORM_SHADING');
  assert.equal(p.facePlans.length,1);
  assert.match(materialWorkPacketDigest(p),/^[0-9a-f]{64}$/);
  assert.equal(validateMaterialWorkPacketOperations(p,scope(),ops()),true);
  assert.equal(ops().length,1);
  assert.equal(ops()[0].regions.length,4);
  assert.deepEqual(ops()[0].regions[0],{
    face:'east',from:[0,0],to:[2,1],
    rgba:[55,65,80,255],erase:false,
  });
  assert.equal(Object.isFrozen(p),true);
  assert.equal(Object.isFrozen(p.facePlans[0].atlasRegion),true);
});
test('single-color fake FORM ramp, missing shading cues and extra JSON fields refuse',()=>{
  const cases=[
    {...packet(),palette:packet().palette.map(p=>({
      ...p,rgb:[90,105,125],
    }))},
    {...packet(),facePlans:[{...packet().facePlans[0],shadowPlacement:undefined}]},
    {...packet(),untrustedApproval:true},
    {...packet(),sourceModelSha256:'not-a-sha'},
    {...packet(),facePlans:[packet().facePlans[0],packet().facePlans[0]]},
    {...packet(),facePlans:[{...packet().facePlans[0],
      atlasRegion:{from:[0,0],to:[256,256]}}]},
    {...packet(),facePlans:[{...packet().facePlans[0],
      clusters:packet().facePlans[0].clusters.slice(0,1)}]},
    {...packet(),facePlans:[{...packet().facePlans[0],
      clusters:[{...packet().facePlans[0].clusters[0],
        spans:[{y:0,x0:0,x1:2},{y:3,x0:0,x1:3}]},
        packet().facePlans[0].clusters[1]]}]},
    {...packet(),facePlans:[{...packet().facePlans[0],
      clusters:[packet().facePlans[0].clusters[0],
        {...packet().facePlans[0].clusters[1],
          spans:[{y:1,x0:2,x1:4},{y:2,x0:3,x1:4}]}]}]},
    {...packet(),facePlans:[{...packet().facePlans[0],
      clusters:[{...packet().facePlans[0].clusters[0],
        extra:'fake-approval'},packet().facePlans[0].clusters[1]]}]},
  ];
  for(const value of cases){
    assert.throws(()=>normalizedMaterialWorkPacket(value),
      /MATERIAL_WORK_PACKET_INVALID/);
  }
});
test('form-shading cannot disguise full-width shadow/highlight bars as modeled shading',()=>{
  const striped=packet();
  striped.facePlans[0].clusters=[
    {id:'flat-shadow',role:'shadow',
      formReason:'Horizontal shadow band presented as helmet shape.',
      spans:[{y:0,x0:0,x1:4},{y:1,x0:0,x1:4}]},
    {id:'flat-highlight',role:'highlight',
      formReason:'Horizontal highlight band repeated across whole width.',
      spans:[{y:2,x0:0,x1:4},{y:3,x0:0,x1:4}]},
  ];
  assert.throws(()=>normalizedMaterialWorkPacket(striped),
    /MATERIAL_WORK_PACKET_INVALID/);
  // A real edge treatment with independently positioned masses remains
  // expressible; this guard is not a blanket ban on straight bevels.
  const edge=packet();
  edge.facePlans[0].clusters=[
    {...edge.facePlans[0].clusters[0],
      spans:[{y:0,x0:0,x1:2}]},
    {...edge.facePlans[0].clusters[1],
      spans:[{y:3,x0:3,x1:4}]},
  ];
  assert.equal(normalizedMaterialWorkPacket(edge).facePlans.length,1);
});
test('paint operation identity survives renamed reviewer plans but distinguishes changed pixels',()=>{
  const original=ops();
  const cosmetic=original.map(op=>({
    regions:op.regions.map(region=>({
      rgba:region.rgba,to:region.to,face:region.face,
      erase:region.erase,from:region.from,
    })),
    texture_uuid:op.texture_uuid,op:op.op,cube_uuid:op.cube_uuid,
  }));
  assert.equal(paintOperationsFingerprint(original),
    paintOperationsFingerprint(cosmetic));
  assert.equal(paintOperationsFingerprint(original).length,64);
  const changed=structuredClone(original);
  changed[0].regions[0].rgba=[56,65,80,255];
  assert.notEqual(paintOperationsFingerprint(original),
    paintOperationsFingerprint(changed));
  const changedOrder=structuredClone(original);
  changedOrder[0].regions.reverse();
  assert.notEqual(paintOperationsFingerprint(original),
    paintOperationsFingerprint(changedOrder));
  assert.throws(()=>paintOperationsFingerprint([]),
    /CODE_MODE_PAINT_PLAN_FINGERPRINT_INVALID/);
  assert.throws(()=>paintOperationsFingerprint([{op:'paint_texture_pixel',
    invalid:undefined}]),/CODE_MODE_PAINT_PLAN_FINGERPRINT_INVALID/);
});
test('compiled shading refuses arbitrary guest mutations or off-scope paint',()=>{
  const p=normalizedMaterialWorkPacket(packet());
  const painted=ops();
  const cases=[
    [scope(),manualOps(),'CODE_MODE_MATERIAL_CLUSTER_OPERATION_MISMATCH'],
    [{...scope(),allowed_regions:[{from:[0,0],to:[1,1]}]},painted,
      'CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH'],
    [{...scope(),preserve_alpha:false},painted,
      'CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH'],
    [scope(),[{...painted[0],regions:[{...painted[0].regions[0],
      rgba:[37,39,40,255]}]}],
      'CODE_MODE_MATERIAL_CLUSTER_OPERATION_MISMATCH'],
    [scope(),[{...painted[0],cube_uuid:'another-cube'}],
      'CODE_MODE_MATERIAL_CLUSTER_OPERATION_MISMATCH'],
    [scope(),[{...painted[0],regions:painted[0].regions.slice(0,1)}],
      'CODE_MODE_MATERIAL_CLUSTER_OPERATION_MISMATCH'],
  ];
  for(const [scoped,operations,error] of cases) {
    assert.throws(()=>validateMaterialWorkPacketOperations(p,scoped,operations),
      new RegExp(error));
  }
});
test('deterministic compiler preserves deliberate contiguous clusters, never invents noisy pixels',()=>{
  const input=packet();
  // Input span order is irrelevant; compiled source has a canonical order.
  const span=input.facePlans[0].clusters[0].spans;
  input.facePlans[0].clusters[0].spans=[span[1],span[0]];
  assert.deepEqual(compileMaterialClusterPaint(input),ops());
  assert.equal(normalizedMaterialWorkPacket(input).shadingIntent,'FORM_SHADING');
  assert.equal(normalizedMaterialWorkPacket(input).facePlans[0].clusters[0]
    .spans.length,2);
});
test('a small identity detail can use a single color without fake forced shading',()=>{
  const p=packet();
  p.shadingIntent='SURFACE_DETAIL';
  p.palette=[{role:'detail',rgb:[180,20,20],
    purpose:'Preserve the exact painted red face trace.'}];
  p.facePlans=p.facePlans.map(({shadowPlacement,highlightPlacement,clusters,...face})=>face);
  assert.equal(validateMaterialWorkPacketOperations(
    normalizedMaterialWorkPacket(p),scope(),manualOps([180,20,20,255])),true);
});

test('operator approval sees the plan digest and description but cannot bypass the Rust write guard',async()=>{
  let approvals=0,runs=0;
  const p=packet();
  const client=createRustCodeModeClient({
    binary:'/abs/rust-cli',
    runner:async()=>{runs++;throw Error('UNAUTHORIZED_NATIVE_LAUNCH');},
    authorizeMutation:request=>{
      approvals++;
      assert.equal(request.materialWorkPacketSha256,
        materialWorkPacketDigest(p));
      assert.equal(request.materialWorkPacket.styleIntent,p.styleIntent);
      assert.equal(request.operationKinds[0],'paint_cube_face_regions_guarded');
      return false;
    },
  });
  await assert.rejects(client.apply({
    input:'/abs/model.bbmodel',output:'/abs/model-candidate.bbmodel',
    expectedSha256:MODEL,operations:ops(),
    correctionScope:{textureUuid:'tier2-atlas',allowedRegions:[REGION],
      preserveAlpha:true},
    correctionIntent:{issueId:'helmet-flat',approachId:'bevel-clusters',
      partId:'tier2-helmet',material:'metal',treatment:'form_value_masses',
      cause:'Helmet shadow distribution is not consistent with its modeled bevel.',
      expectedChange:'Use one controlled shadow cluster on the lower joint.'},
    materialWorkPacket:p,
  }),/CODE_MODE_MUTATION_NOT_APPROVED/);
  assert.equal(approvals,1);
  assert.equal(runs,0);
});
