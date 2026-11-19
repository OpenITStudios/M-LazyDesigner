// SOURCE_ONLY; Node, Rust and native pixel-art QA remain NOT_EXECUTED.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRustCodeModeClient} from './client.mjs';
import {normalizedMaterialWorkPacket,materialWorkPacketDigest,
  validateMaterialWorkPacketOperations,compileMaterialClusterPaint,
  paintOperationsFingerprint,materialFaceClusters}
  from './material-work-packet.mjs';
import {normalizedMaterialBrushComposition,compileMaterialBrushComposition,
  prepareMaterialBrushComposition}
  from './material-brush-composition.mjs';

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
test('form-shading value roles require ordered luminance, not distinct RGB alone',()=>{
  const inverted=packet();
  inverted.palette=[
    {...packet().palette[0],rgb:[250,185,30]},
    packet().palette[1],
    {...packet().palette[2],rgb:[35,45,60]},
  ];
  assert.throws(()=>normalizedMaterialWorkPacket(inverted),
    /MATERIAL_WORK_PACKET_INVALID/);
  const falseDeep=packet();
  falseDeep.palette.push({role:'deep_shadow',rgb:[210,160,120],
    purpose:'A wrongly brighter deep shadow must be refused.'});
  assert.throws(()=>normalizedMaterialWorkPacket(falseDeep),
    /MATERIAL_WORK_PACKET_INVALID/);
  // Hue-shifted artist ramps remain valid; no fixed number of shades,
  // monotone per-channel ramp, minimum contrast or mandatory noise.
  const shifted=packet();
  shifted.palette=[
    {...packet().palette[0],rgb:[72,45,106]},
    {...packet().palette[1],rgb:[90,105,125]},
    {...packet().palette[2],rgb:[145,164,130]},
  ];
  assert.equal(normalizedMaterialWorkPacket(shifted).palette.length,3);
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

function brushPacket(){
  const p=packet();
  const face=p.facePlans[0];
  delete face.clusters;
  face.brushComposition={
    mask:{
      reason:'Select only the reviewer-marked helmet material and preserve its quiet border.',
      paintable:[0,1,2,3].map(y=>({y,x0:0,x1:4})),
      rest:[{y:0,x0:3,x1:4}],
    },
    strokes:[
      {id:'joint-shadow',role:'shadow',
        formReason:'Place an intentionally connected dark joint mass near the recessed edge.',
        points:[[0,0],[0,1],[1,1]],radius:0,tip:'square',taper:'none'},
      {id:'bevel-highlight',role:'highlight',
        formReason:'Keep the light-facing bevel as a small separate connected mass.',
        points:[[3,2],[3,3]],radius:0,tip:'diamond',taper:'none'},
    ],
  };
  return p;
}
test('one prepared brush source binds normalized intent to exact compiled pixel spans',()=>{
  const draft=brushPacket().facePlans[0].brushComposition;
  const roles=['shadow','base','highlight'];
  const prepared=prepareMaterialBrushComposition(draft,roles);
  assert.deepEqual(prepared.composition,normalizedMaterialBrushComposition(draft,roles));
  assert.deepEqual(prepared.clusters,compileMaterialBrushComposition(draft,roles));
  assert.equal(Object.isFrozen(prepared),true);
  assert.equal(Object.isFrozen(prepared.clusters),true);
  assert.equal(Object.isFrozen(prepared.composition),true);
});
test('source-selected brush masks compile into native guarded face-local Paint operations',()=>{
  const source=brushPacket();
  const plan=normalizedMaterialWorkPacket(source);
  assert.equal(plan.facePlans[0].clusters,undefined);
  assert.equal(plan.facePlans[0].brushComposition.mask.rest.length,1);
  const clusters=materialFaceClusters(plan.facePlans[0],plan.palette);
  assert.deepEqual(clusters.map(c=>c.role),['shadow','highlight']);
  assert.throws(()=>materialFaceClusters(plan.facePlans[0],[
    {role:'base',rgb:[90,105,125]}]),
    /MATERIAL_BRUSH_COMPOSITION_INVALID/);
  assert.deepEqual(clusters[0].spans,[
    {y:0,x0:0,x1:1},{y:1,x0:0,x1:2},
  ]);
  assert.deepEqual(clusters[1].spans,[
    {y:2,x0:3,x1:4},{y:3,x0:3,x1:4},
  ]);
  const compiled=compileMaterialClusterPaint(source);
  assert.equal(compiled[0].op,'paint_cube_face_regions_guarded');
  assert.equal(compiled[0].regions.length,4);
  assert.equal(validateMaterialWorkPacketOperations(plan,scope(),compiled),true);
  assert.equal(materialWorkPacketDigest(source),materialWorkPacketDigest(plan));
  const samePixelsDifferentPaths=structuredClone(source);
  samePixelsDifferentPaths.facePlans[0].brushComposition.strokes[0].points=[
    [0,0],[0,1],[0,1] // invalid duplicate endpoint must not normalize
  ];
  assert.throws(()=>normalizedMaterialWorkPacket(samePixelsDifferentPaths),
    /MATERIAL_BRUSH_COMPOSITION_INVALID|MATERIAL_WORK_PACKET_INVALID/);
});
test('artist palette shade walk uses only selected swatches, never synthesizes a RGB ramp',()=>{
  const plan=brushPacket();
  const strokes=plan.facePlans[0].brushComposition.strokes;
  const authored=compileMaterialClusterPaint(plan);
  const {role:_shadow,...shadow}=strokes[0];
  const {role:_highlight,...highlight}=strokes[1];
  strokes[0]={...shadow,shadeWalk:{from:'base',steps:-1}};
  strokes[1]={...highlight,shadeWalk:{from:'base',steps:1}};
  const normalized=normalizedMaterialWorkPacket(plan);
  assert.equal(normalized.facePlans[0].brushComposition.strokes[0].role,undefined);
  assert.equal(normalized.facePlans[0].brushComposition.strokes[0].shadeWalk.steps,-1);
  assert.deepEqual(materialFaceClusters(normalized.facePlans[0],normalized.palette)
    .map(c=>c.role),['shadow','highlight']);
  assert.deepEqual(compileMaterialClusterPaint(plan),authored);
  assert.notEqual(materialWorkPacketDigest(plan),materialWorkPacketDigest(brushPacket()));
  const bad=[
    {shadeWalk:{from:'accent',steps:1}},
    {shadeWalk:{from:'base',steps:2}},
    {shadeWalk:{from:'highlight',steps:1}},
    {shadeWalk:{from:'base',steps:-1},role:'shadow'},
    {shadeWalk:{from:'base',steps:0}},
  ];
  for(const change of bad){
    const altered=brushPacket();
    const brush=altered.facePlans[0].brushComposition.strokes[0];
    delete brush.role;
    Object.assign(brush,change);
    assert.throws(()=>normalizedMaterialWorkPacket(altered),
      /MATERIAL_BRUSH_COMPOSITION_INVALID/);
  }
});
test('rest mask, off-mask strokes, overlapping shade roles and unsafe brush controls refuse',()=>{
  const original=brushPacket();
  const b=original.facePlans[0].brushComposition;
  const cases=[
    {...b,mask:{...b.mask,rest:[{y:0,x0:4,x1:5}]}},
    {...b,strokes:[{...b.strokes[0],points:[[0,0],[5,0]]},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],radius:3},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],tip:'soft'},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],taper:'random'},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],role:'fake-role'},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],points:[[0,0],[1,1]]},
      {...b.strokes[1],points:[[1,1],[2,1]]}]},
    {...b,strokes:[{...b.strokes[0],points:[[3,0],[2,0]]},b.strokes[1]]},
    {...b,strokes:[{...b.strokes[0],points:[[0,0],[0,3]],radius:2},
      {...b.strokes[1],points:[[3,2],[3,3]],radius:1}]},
  ];
  for(const bad of cases){
    const input=brushPacket();
    input.facePlans[0].brushComposition=bad;
    assert.throws(()=>normalizedMaterialWorkPacket(input),
      /MATERIAL_BRUSH_COMPOSITION_INVALID|MATERIAL_WORK_PACKET_INVALID/);
  }
  const overlap=brushPacket();
  overlap.facePlans[0].clusters=packet().facePlans[0].clusters;
  assert.throws(()=>normalizedMaterialWorkPacket(overlap),
    /MATERIAL_WORK_PACKET_INVALID/);
  const alpha=brushPacket();
  alpha.shadingIntent='ALPHA_SILHOUETTE';
  assert.throws(()=>normalizedMaterialWorkPacket(alpha),
    /MATERIAL_WORK_PACKET_INVALID/);
  const detail=brushPacket();
  detail.shadingIntent='SURFACE_DETAIL';
  assert.throws(()=>normalizedMaterialWorkPacket(detail),
    /MATERIAL_WORK_PACKET_INVALID/);
  const spanless=brushPacket();
  spanless.facePlans[0].brushComposition.mask.paintable=[];
  assert.throws(()=>normalizedMaterialWorkPacket(spanless),
    /MATERIAL_BRUSH_COMPOSITION_INVALID/);
});
test('pixel brush tip/taper is deterministic and preserves quiet mask pixels',()=>{
  const body={
    mask:{reason:'Only the selected metal rim is editable; the rest must stay clear.',
      paintable:[0,1,2,3,4].map(y=>({y,x0:0,x1:7})),
      rest:[{y:0,x0:0,x1:7}]},
    strokes:[{id:'tapered-rim',role:'highlight',
      formReason:'Taper the painted edge light toward both ends of the rim.',
      points:[[1,2],[5,2]],radius:1,tip:'diamond',taper:'ends'}],
  };
  const r=compileMaterialBrushComposition(body,['highlight']);
  assert.equal(r.length,1);
  assert.ok(r[0].spans.some(s=>s.y===1));
  assert.ok(r[0].spans.every(s=>s.y!==0));
  assert.deepEqual(r,compileMaterialBrushComposition(
    normalizedMaterialBrushComposition(body,['highlight']),['highlight']));
  const same=structuredClone(body);
  same.strokes[0].tip='square';
  assert.notDeepEqual(compileMaterialBrushComposition(same,['highlight']),r);
});
test('three-anchor curved highlight is connected and remains a guarded Paint plan',()=>{
  const source=brushPacket();
  const brush=source.facePlans[0].brushComposition;
  brush.mask.paintable=Array.from({length:10},(_,y)=>({y,x0:0,x1:11}));
  brush.mask.rest=[{y:0,x0:0,x1:11}];
  brush.strokes=[
    {id:'lower-joint',role:'shadow',
      formReason:'Preserve the dark metal joint below the bright helmet bevel.',
      points:[[2,8],[8,8]],radius:0,tip:'square',taper:'none'},
    {id:'curved-rim',shadeWalk:{from:'base',steps:1},
      formReason:'Paint the selected raised bevel as a curved cluster, not a flat stripe.',
      points:[[2,6],[5,1],[8,6]],pathKind:'quadratic',
      radius:0,tip:'diamond',taper:'none'},
  ];
  source.facePlans[0].atlasRegion={from:[0,0],to:[11,10]};
  const p=normalizedMaterialWorkPacket(source);
  const compiled=compileMaterialClusterPaint(p);
  const curve=materialFaceClusters(p.facePlans[0],p.palette)[1];
  assert.equal(curve.role,'highlight');
  assert.ok(curve.spans.length>1);
  assert.ok(new Set(curve.spans.map(s=>s.y)).size>1);
  assert.ok(curve.spans.every(s=>s.y!==0));
  assert.equal(validateMaterialWorkPacketOperations(p,{
    texture_uuid:'tier2-atlas',allowed_regions:[{from:[0,0],to:[11,10]}],
    preserve_alpha:true,
  },compiled),true);
  assert.deepEqual(compileMaterialClusterPaint(source),compiled);
  const straight=structuredClone(source);
  straight.facePlans[0].brushComposition.strokes[1].pathKind='polyline';
  assert.notDeepEqual(compileMaterialClusterPaint(straight),compiled);
});
test('curve mode refuses incorrect anchors and path directions outside mask',()=>{
  for(const data of [
    {pathKind:'quadratic',points:[[1,1],[2,2]]},
    {pathKind:'quadratic',points:[[1,1],[2,2],[3,3],[4,4]]},
    {pathKind:'cubic',points:[[1,1],[2,2],[3,3]]},
    {pathKind:'quadratic',points:[[1,1],[1,1],[4,5]]},
    {pathKind:'quadratic',points:[[0,0],[1,3],[2,5]]},
  ]){
    const input=brushPacket();
    Object.assign(input.facePlans[0].brushComposition.strokes[1],data);
    assert.throws(()=>normalizedMaterialWorkPacket(input),
      /MATERIAL_BRUSH_COMPOSITION_INVALID|MATERIAL_WORK_PACKET_INVALID/);
  }
});
test('sparse-mask row compaction keeps curve 4-connected and protected rest empty',()=>{
  const mask={mask:{
    reason:'Rest row must stay protected beneath the reviewed curved metal glint.',
    paintable:Array.from({length:6},(_,y)=>({y,x0:0,x1:8})),
    rest:[{y:0,x0:0,x1:8}]},
    strokes:[{id:'painted-rim',role:'highlight',
      formReason:'Create a short intentional curved reflective mass for this bevel.',
      points:[[1,3],[4,2],[6,4]],pathKind:'quadratic',
      radius:0,tip:'square',taper:'none'}],
  };
  const [cluster]=compileMaterialBrushComposition(mask,['highlight']);
  const positions=new Set();
  for(const s of cluster.spans){
    assert.notEqual(s.y,0);
    for(let x=s.x0;x<s.x1;x++)positions.add(s.y*256+x);
  }
  assert.ok(positions.size>=5);
  const first=[...positions][0],seen=new Set([first]),q=[first];
  for(let i=0;i<q.length;i++){
    const v=q[i],px=v%256,py=Math.floor(v/256);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=px+dx,y=py+dy,n=y*256+x;
      if(x>=0&&x<256&&y>=0&&y<256&&positions.has(n)&&!seen.has(n)){
        seen.add(n);q.push(n);
      }
    }
  }
  assert.equal(seen.size,positions.size);
});
test('sparse row-span compaction preserves physical face-local x1=256',()=>{
  const source={
    mask:{reason:'One entire pixel-row mask establishes the exact 256-wide boundary.',
      paintable:[{y:4,x0:0,x1:256}],rest:[]},
    strokes:[{id:'full-row-contract',role:'highlight',
      formReason:'Synthetic boundary fixture, not a proposed professional shading pattern.',
      points:[[0,4],[255,4]],radius:0,tip:'square',taper:'none'}],
  };
  assert.deepEqual(compileMaterialBrushComposition(source,['highlight'])[0].spans,
    [{y:4,x0:0,x1:256}]);
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
