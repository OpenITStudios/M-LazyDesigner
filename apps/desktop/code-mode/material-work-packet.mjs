/**
 * Bounded source-only artistic plan for reviewer-authorized Rust material
 * propagation. This is an untrusted guest PROPOSAL, not approved reference
 * evidence, a pixel composer, a renderer, or a new persistent truth store.
 * Rust is the sole bitmap/transaction/UV authority.
 */
import {createHash} from 'node:crypto';

const SHA=/^[0-9a-f]{64}$/;
const TOKEN=/^[a-z][a-z0-9_-]{0,63}$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const FACES=new Set(['north','east','south','west','up','down']);
const MATERIALS=new Set(['metal','wood','stone','cloth','skin','glass','other']);
const INTENTS=new Set(['FORM_SHADING','SURFACE_DETAIL','ALPHA_SILHOUETTE']);
const ROLES=new Set(['deep_shadow','shadow','base','highlight','edge_light','accent','detail']);
const MAX_FACES=8;
function fail(){throw new TypeError('MATERIAL_WORK_PACKET_INVALID');}
function object(v,fields){
  if(!v || typeof v!=='object' || Array.isArray(v) ||
     Object.keys(v).some(k=>!fields.includes(k)))fail();
  return v;
}
function statement(v, min=16, max=220){
  if(typeof v!=='string' || v.length<min || v.length>max ||
     v!==v.trim() || /[\x00-\x1f\x7f]/.test(v))fail();
  return v;
}
function rgb(v){
  if(!Array.isArray(v) || v.length!==3 ||
     !v.every(n=>Number.isInteger(n) && n>=0 && n<=255))fail();
  return Object.freeze([...v]);
}
function rectangle(v){
  object(v,['from','to']);
  const valid=p=>Array.isArray(p) && p.length===2 &&
    p.every(n=>Number.isInteger(n) && n>=0 && n<=256);
  if(!valid(v.from)||!valid(v.to)||
     v.from.some((n,i)=>n>=v.to[i]))fail();
  return Object.freeze({
    from:Object.freeze([...v.from]),to:Object.freeze([...v.to]),
  });
}
const key=rect=>JSON.stringify([rect.from,rect.to]);
/**
 * Reject malformed inputs BEFORE host permission and Rust source reads.
 * Valid fields describe intent. Nothing in this helper verifies form,
 * lighting, connected clusters or visual similarity to approved art.
 */
export function normalizedMaterialWorkPacket(value){
  if(value===undefined)return undefined;
  object(value,['sourceModelSha256','referencePngSha256',
    'issueId','approachId','partId','textureUuid','material','shadingIntent',
    'reviewedIssueObservation','styleIntent','lightDirection','lightRationale',
    'palette','facePlans']);
  if(!SHA.test(value.sourceModelSha256) ||
     !SHA.test(value.referencePngSha256) ||
     ![value.issueId,value.approachId,value.partId].every(x=>
       typeof x==='string' && TOKEN.test(x)) ||
     !(typeof value.textureUuid==='string' && ID.test(value.textureUuid)) ||
     !MATERIALS.has(value.material) ||
     !INTENTS.has(value.shadingIntent))fail();
  const plan={
    sourceModelSha256:value.sourceModelSha256,
    referencePngSha256:value.referencePngSha256,
    issueId:value.issueId,approachId:value.approachId,
    partId:value.partId,textureUuid:value.textureUuid,
    material:value.material,shadingIntent:value.shadingIntent,
    reviewedIssueObservation:statement(value.reviewedIssueObservation),
    styleIntent:statement(value.styleIntent),
    lightDirection:statement(value.lightDirection),
    lightRationale:statement(value.lightRationale),
  };
  if(!Array.isArray(value.palette) ||
     value.palette.length<1 || value.palette.length>8)fail();
  plan.palette=Object.freeze(value.palette.map(entry=>{
    object(entry,['role','rgb','purpose']);
    if(!ROLES.has(entry.role))fail();
    return Object.freeze({role:entry.role,rgb:rgb(entry.rgb),
      purpose:statement(entry.purpose,12)});
  }));
  const roles=plan.palette.map(x=>x.role);
  if(new Set(roles).size!==roles.length)fail();
  if(value.shadingIntent==='FORM_SHADING'){
    if(!['shadow','base','highlight'].every(r=>roles.includes(r)))fail();
    const triple=plan.palette.filter(p=>
      ['shadow','base','highlight'].includes(p.role)).map(x=>x.rgb.join(','));
    if(new Set(triple).size!==3)fail();
  }
  if(!Array.isArray(value.facePlans) ||
     value.facePlans.length<1 || value.facePlans.length>MAX_FACES)fail();
  plan.facePlans=Object.freeze(value.facePlans.map(face=>{
    object(face,['cubeUuid','face','atlasRegion','formCue',
      'shadowPlacement','highlightPlacement','clusterPlan']);
    if(typeof face.cubeUuid!=='string' || !ID.test(face.cubeUuid) ||
       !FACES.has(face.face))fail();
    if(value.shadingIntent==='FORM_SHADING' &&
       (face.shadowPlacement===undefined ||
        face.highlightPlacement===undefined))fail();
    const atlasRegion=rectangle(face.atlasRegion);
    const area=(atlasRegion.to[0]-atlasRegion.from[0])*
      (atlasRegion.to[1]-atlasRegion.from[1]);
    if(area>4096)fail();
    return Object.freeze({
      cubeUuid:face.cubeUuid,face:face.face,
      atlasRegion,
      formCue:statement(face.formCue),
      ...(face.shadowPlacement!==undefined ?
        {shadowPlacement:statement(face.shadowPlacement)}:{}),
      ...(face.highlightPlacement!==undefined ?
        {highlightPlacement:statement(face.highlightPlacement)}:{}),
      clusterPlan:statement(face.clusterPlan),
    });
  }));
  const faceKeys=plan.facePlans.map(x=>x.cubeUuid+':'+x.face);
  const rectKeys=plan.facePlans.map(x=>key(x.atlasRegion));
  if(new Set(faceKeys).size!==faceKeys.length ||
     new Set(rectKeys).size!==rectKeys.length)fail();
  const normalized=Object.freeze(plan);
  if(Buffer.byteLength(JSON.stringify(normalized),'utf8')>12000)fail();
  return normalized;
}

export function materialWorkPacketDigest(packet){
  const normalized=normalizedMaterialWorkPacket(packet);
  if(!normalized)throw new TypeError('MATERIAL_WORK_PACKET_REQUIRED');
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * The Rust correction scope must equal the planned atlas rectangles; every
 * operation must use the existing guarded Cube face-local mutation. This
 * prevents broad unowned PNG edits disguised behind an artistic paragraph.
 */
export function validateMaterialWorkPacketOperations(packet,scope,operations){
  if(!packet || !scope || !Array.isArray(scope.allowed_regions) ||
     !Array.isArray(operations) || !operations.length) {
    throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH');
  }
  const expected=new Set(packet.facePlans.map(x=>key(x.atlasRegion)));
  const actual=scope.allowed_regions.map(key);
  if(actual.length!==expected.size ||
     new Set(actual).size!==expected.size ||
     actual.some(k=>!expected.has(k))) {
    throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH');
  }
  if(scope.texture_uuid!==packet.textureUuid ||
     (packet.shadingIntent==='FORM_SHADING' && scope.preserve_alpha!==true)) {
    throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_SCOPE_MISMATCH');
  }
  const expectedFaces=new Set(packet.facePlans.map(x=>x.cubeUuid+':'+x.face));
  const touched=new Set(),appliedRoles=new Set();
  const palette=new Map(packet.palette.map(v=>[v.rgb.join(','),v.role]));
  for(const op of operations){
    if(!op || op.op!=='paint_cube_face_regions_guarded' ||
       op.texture_uuid!==packet.textureUuid ||
       !(typeof op.cube_uuid==='string' && ID.test(op.cube_uuid)) ||
       !Array.isArray(op.regions) || op.regions.length<1) {
      throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_FACE_PAINT_REQUIRED');
    }
    for(const region of op.regions){
      const faceKey=op.cube_uuid+':'+region?.face;
      if(!expectedFaces.has(faceKey) ||
         !Array.isArray(region?.from) || !Array.isArray(region?.to) ||
         region.from.length!==2 || region.to.length!==2 ||
         ![...region.from,...region.to].every(n=>
           Number.isInteger(n) && n>=0 && n<=256) ||
         region.from.some((n,i)=>n>=region.to[i]) ||
         typeof region.erase!=='boolean' ||
         !Array.isArray(region?.rgba) || region.rgba.length!==4 ||
         !region.rgba.every(n=>Number.isInteger(n) && n>=0 && n<=255) ||
         (packet.shadingIntent==='FORM_SHADING' &&
          (region.erase!==false || region.rgba[3]!==255)) ||
         (region.erase!==true &&
          !palette.has(region.rgba.slice(0,3).join(',')))) {
        throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_UNPLANNED_PAINT');
      }
      touched.add(faceKey);
      if(!region.erase){
        appliedRoles.add(palette.get(region.rgba.slice(0,3).join(',')));
      }
    }
  }
  if(touched.size!==expectedFaces.size) {
    throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_UNPAINTED_FACE');
  }
  // The literal paint must use at least one shade beyond base/accent:
  // a bare base fill cannot masquerade as form-shading propagation.
  // This does NOT prove the shade location or cluster quality.
  if(packet.shadingIntent==='FORM_SHADING' &&
     !['shadow','highlight','deep_shadow','edge_light']
       .some(role=>appliedRoles.has(role))) {
    throw new Error('CODE_MODE_MATERIAL_WORK_PACKET_BASE_ONLY');
  }
  return true;
}
