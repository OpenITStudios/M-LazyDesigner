// SOURCE_ONLY; Node, Rust and native pixel-art QA remain NOT_EXECUTED.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {normalizedMaterialWorkPacket,materialWorkPacketDigest,
  validateMaterialWorkPacketOperations} from './material-work-packet.mjs';

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
    }],
  };
}
function scope(){
  return {texture_uuid:'tier2-atlas',allowed_regions:[REGION],
    preserve_alpha:true};
}
function ops(rgb=[55,65,80,255]){
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
  ];
  for(const value of cases){
    assert.throws(()=>normalizedMaterialWorkPacket(value),
      /MATERIAL_WORK_PACKET_INVALID/);
  }
});
test('propagation cannot paint outside reviewer scope, change face or sneak palette noise',()=>{
  const p=normalizedMaterialWorkPacket(packet());
  const cases=[
    [scope(),[{op:'paint_texture_pixel',texture_index:0,x:9,y:9,
      rgba:[55,65,80,255]}],'CODE_MODE_MATERIAL_WORK_PACKET_FACE_PAINT_REQUIRED'],
    [{...scope(),allowed_regions:[{from:[0,0],to:[1,1]}]},ops(),
      'CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH'],
    [{...scope(),preserve_alpha:false},ops(),
      'CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH'],
    [scope(),[{...ops()[0],regions:[{...ops()[0].regions[0],face:'west'}]}],
      'CODE_MODE_MATERIAL_WORK_PACKET_UNPLANNED_PAINT'],
    [scope(),ops([37,39,40,255]),
      'CODE_MODE_MATERIAL_WORK_PACKET_UNPLANNED_PAINT'],
    [scope(),ops([90,105,125,255]),
      'CODE_MODE_MATERIAL_WORK_PACKET_BASE_ONLY'],
  ];
  for(const [scoped,operations,error] of cases) {
    assert.throws(()=>validateMaterialWorkPacketOperations(p,scoped,operations),
      new RegExp(error));
  }
});
test('a small identity detail can use a single color without fake forced shading',()=>{
  const p=packet();
  p.shadingIntent='SURFACE_DETAIL';
  p.palette=[{role:'detail',rgb:[180,20,20],
    purpose:'Preserve the exact painted red face trace.'}];
  p.facePlans=p.facePlans.map(({shadowPlacement,highlightPlacement,...face})=>face);
  assert.equal(validateMaterialWorkPacketOperations(
    normalizedMaterialWorkPacket(p),scope(),ops([180,20,20,255])),true);
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
