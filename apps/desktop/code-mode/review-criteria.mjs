/**
 * Ephemeral, operator-owned projection of approved/current reference decisions
 * into one SHA-bound Code Mode visual review. Not a durable asset registry,
 * image classifier or authority granted to model-authored Deno code.
 */
import {normalizedCorrectionScope} from './client.mjs';

const ID=/^[a-z][a-z0-9_-]{0,63}$/;
const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-zA-Z0-9_-]{1,128}$/;
const VIEWS=new Set(['front','back','left','right','top','bottom','three_quarter']);
const VERDICTS=new Set(['MET','VIOLATED','UNVERIFIED']);
const sourceRegion=value=>value && typeof value==='object' &&
  !Array.isArray(value) &&
  Object.keys(value).length===2 &&
  Object.hasOwn(value,'id') && Object.hasOwn(value,'boxUv') &&
  // The canonical Reference parser permits per-image IDs up to 96 chars.
  // Source labels are untrusted evidence (never code/atlas coordinates).
  typeof value.id==='string' && value.id.length>0 &&
  value.id.length<=96 && value.id.trim()===value.id &&
  !/[\x00-\x1f\x7f]/.test(value.id) &&
  Array.isArray(value.boxUv) && value.boxUv.length===4 &&
  value.boxUv.every(n=>typeof n==='number' &&
    Number.isFinite(n) && n>=0 && n<=1) &&
  value.boxUv[0]<value.boxUv[2] && value.boxUv[1]<value.boxUv[3];

function invalid(code){throw new Error(code);}
function object(value,keys,code){
  return value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).every(key=>keys.includes(key)) ||
    invalid(code);
}
function statement(text,min=20){
  return typeof text==='string' && text.length>=min &&
    text.length<=240 && text===text.trim() &&
    !/[\x00-\x1f\x7f]/.test(text);
}
function rectangles(textureUuid,values){
  if(!UUID.test(textureUuid??'') || !Array.isArray(values) ||
      values.length<1 || values.length>16) invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
  try{
    return normalizedCorrectionScope({textureUuid,allowedRegions:values,
      preserveAlpha:true}).allowed_regions.map(region=>Object.freeze({
        from:Object.freeze([...region.from]),to:Object.freeze([...region.to]),
      }));
  }catch{
    invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
  }
}
const inside=(a,b)=>a.from[0]>=b.from[0] &&
  a.from[1]>=b.from[1] && a.to[0]<=b.to[0] && a.to[1]<=b.to[1];
const overlaps=(a,b)=>a.from[0]<b.to[0] && a.to[0]>b.from[0] &&
  a.from[1]<b.to[1] && a.to[1]>b.from[1];

export function boundReviewCriteria(raw,selectedViews){
  if(raw===undefined)return null;
  if(!Array.isArray(raw) || raw.length<1 || raw.length>12 ||
      !Array.isArray(selectedViews)) invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
  const selected=new Map(selectedViews.map(view=>[view.viewId,view.reference.sha256]));
  const seen=new Set();let corrective=0;
  const items=raw.map(item=>{
    object(item,['id','partId','kind','requirement','viewId',
      'referencePngSha256','textureUuid','allowedRegions','protectedRegions',
      'sourceRegion'],
      'CODE_MODE_REVIEW_CRITERIA_INVALID');
    if(!ID.test(item.id??'') || !ID.test(item.partId??'') ||
       !['PRESERVE','CORRECT','MATCH_REFERENCE'].includes(item.kind) ||
       !statement(item.requirement) || !VIEWS.has(item.viewId) ||
       !SHA.test(item.referencePngSha256??'') ||
       selected.get(item.viewId)!==item.referencePngSha256 ||
       (item.sourceRegion!==undefined && !sourceRegion(item.sourceRegion)) ||
       seen.has(item.id)) invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
    seen.add(item.id);
    const common={id:item.id,partId:item.partId,kind:item.kind,
      requirement:item.requirement,viewId:item.viewId,
      referencePngSha256:item.referencePngSha256,
      ...(item.sourceRegion?{sourceRegion:Object.freeze({
        id:item.sourceRegion.id,
        boxUv:Object.freeze([...item.sourceRegion.boxUv]),
      })}:{})};
    if(item.kind==='CORRECT'){
      corrective++;
      // Visual issue IDs in the existing Rust reviewer contract are capped
      // at 48 characters; never create an unaddressable correction ID.
      if(item.id.length>48 || item.protectedRegions!==undefined)
        invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
      return Object.freeze({...common,textureUuid:item.textureUuid,
        allowedRegions:Object.freeze(rectangles(item.textureUuid,item.allowedRegions))});
    }
    if(item.kind==='MATCH_REFERENCE'){
      // Source approved image regions have no demonstrated current-model
      // acceptance or native atlas mapping. They are comparison obligations,
      // never protected pixels or writable corrections.
      if(!item.sourceRegion || item.textureUuid!==undefined ||
         item.allowedRegions!==undefined || item.protectedRegions!==undefined){
        invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
      }
      return Object.freeze(common);
    }
    if(item.allowedRegions!==undefined ||
       (item.textureUuid===undefined)!==(item.protectedRegions===undefined)){
      invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
    }
    return Object.freeze({...common,...(item.textureUuid?{
      textureUuid:item.textureUuid,
      protectedRegions:Object.freeze(rectangles(item.textureUuid,item.protectedRegions)),
    }:{})});
  });
  if(corrective>6)invalid('CODE_MODE_REVIEW_CRITERIA_INVALID');
  // Pure source-reference matching and native-preservation-only reviews
  // cannot authorize painting without an explicit independent CORRECT
  // criterion mapped to real Rust atlas ownership.
  // A declared correction may not overlap an approved/protected identity
  // on the same physical texture, even if the reviewer overlooks it.
  for(const edit of items.filter(x=>x.kind==='CORRECT')){
    for(const guard of items.filter(x=>x.kind==='PRESERVE' &&
        x.textureUuid===edit.textureUuid)){
      if(edit.allowedRegions.some(a=>guard.protectedRegions.some(b=>overlaps(a,b))))
        invalid('CODE_MODE_REVIEW_CRITERIA_PROTECTED_OVERLAP');
    }
  }
  return Object.freeze(items);
}
export function criterionPermitsPaint(criteria,intent,scope){
  if(!criteria)return true; // Existing direct/exact-RGBA API remains compatible.
  const matched=criteria.find(item=>item.kind==='CORRECT' &&
    item.id===intent?.issueId && item.partId===intent?.partId &&
    item.textureUuid===scope?.texture_uuid);
  return !!matched && Array.isArray(scope.allowed_regions) &&
    scope.allowed_regions.length>0 && scope.allowed_regions.every(region=>
    matched.allowedRegions.some(allowed=>inside(region,allowed))) &&
    criteria.filter(item=>item.kind==='PRESERVE' &&
      item.textureUuid===scope.texture_uuid).every(item=>
        scope.allowed_regions.every(region=>
          item.protectedRegions.every(protectedArea=>!overlaps(region,protectedArea))));
}
export function checkedCriterionReview(criteria,claims,decision,issues,scope){
  if(criteria===null){
    if(claims!==undefined)invalid('CODE_MODE_REVIEW_CRITERIA_UNBOUND');
    return null;
  }
  if(!Array.isArray(claims) || claims.length!==criteria.length){
    invalid('CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID');
  }
  const seen=new Set();
  const checked=claims.map(claim=>{
    object(claim,['id','verdict','observation'],
      'CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID');
    const item=criteria.find(x=>x.id===claim.id);
    if(!item || seen.has(claim.id) || !VERDICTS.has(claim.verdict) ||
       !statement(claim.observation)){
      invalid('CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID');
    }
    seen.add(claim.id);
    return Object.freeze({...claim});
  });
  if(criteria.some(c=>!seen.has(c.id)))invalid('CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID');
  const status=new Map(checked.map(x=>[x.id,x.verdict]));
  if(criteria.some(x=>x.kind==='PRESERVE' && status.get(x.id)==='VIOLATED'))
    invalid('CODE_MODE_REVIEW_APPROVED_IDENTITY_REGRESSED');
  // The source blueprint is NOT an already-approved current asset. A
  // mismatched source requirement needs its own reviewer-selected native
  // correction target; it cannot silently inherit the current Paint scope.
  if(criteria.some(x=>x.kind==='MATCH_REFERENCE' &&
      status.get(x.id)==='VIOLATED'))
    invalid('CODE_MODE_REVIEW_REFERENCE_MISMATCH_UNSCOPED');
  const violated=criteria.filter(x=>x.kind==='CORRECT' &&
    status.get(x.id)==='VIOLATED');
  if(violated.length && criteria.some(x=>x.kind!=='CORRECT' &&
      status.get(x.id)!=='MET'))
    invalid('CODE_MODE_REVIEW_OTHER_REQUIREMENT_UNVERIFIED');
  const unknown=checked.some(x=>x.verdict==='UNVERIFIED');
  const expected=violated.length?'REJECTED':unknown?'UNVERIFIED':'ACCEPTED';
  if(decision!==expected)invalid('CODE_MODE_REVIEW_CRITERIA_DECISION_CONFLICT');
  if(expected==='REJECTED'){
    if(!Array.isArray(issues) || issues.length!==violated.length ||
       issues.some(issue=>!violated.some(item=>item.id===issue.id &&
         item.partId===issue.partId)) ||
       !violated.some(item=>criterionPermitsPaint(criteria,{
         issueId:item.id,partId:item.partId,
       },{
         texture_uuid:scope?.textureUuid,
         allowed_regions:scope?.allowedRegions??[],
       }))){
      invalid('CODE_MODE_REVIEW_CRITERIA_CORRECTION_UNBOUND');
    }
  }else if(issues.length>0 || scope!==null){
    invalid('CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID');
  }
  return Object.freeze({
    status:expected==='ACCEPTED'?'ALL_MET':
      expected==='REJECTED'?'CORRECTIONS_REQUIRED':'UNVERIFIED',
    assessments:Object.freeze(checked),
    source:'OPERATOR_SELECTED_REFERENCE_AND_INDEPENDENT_REVIEW_DECLARATION',
    visual_verdict:'UNVERIFIED',
  });
}
