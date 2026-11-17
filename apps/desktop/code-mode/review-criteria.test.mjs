// Source-authored only. Native/Node/local tests are held.
import test from 'node:test';
import assert from 'node:assert/strict';
import {boundReviewCriteria,criterionPermitsPaint,checkedCriterionReview}
  from './review-criteria.mjs';

const SHA='a'.repeat(64);
const selected=[{viewId:'front',reference:{sha256:SHA}}];
const crop={from:[4,4],to:[8,8]};
const decisions=[
  {id:'keep-shield',partId:'tier1-shield',kind:'PRESERVE',
    requirement:'Keep the original Tier 1 shield outline and accent pattern unchanged.',
    viewId:'front',referencePngSha256:SHA,textureUuid:'pillar-atlas',
    protectedRegions:[{from:[0,0],to:[4,4]}]},
  {id:'fix-helmet',partId:'tier2-helmet',kind:'CORRECT',
    requirement:'Replace the flat helmet bar with directional metal shading and bevels.',
    viewId:'front',referencePngSha256:SHA,textureUuid:'pillar-atlas',
    allowedRegions:[crop]},
];
const claims=[
  {id:'keep-shield',verdict:'MET',
    observation:'The original Tier 1 shield outline remains visually untouched.'},
  {id:'fix-helmet',verdict:'VIOLATED',
    observation:'The Tier 2 helmet still reads as one flat horizontal bar.'},
];
const issue=[{id:'fix-helmet',partId:'tier2-helmet',kind:'FLAT_SHADING',
  observation:'Flat metal bar dominates the helmet.'}];
const scope={textureUuid:'pillar-atlas',allowedRegions:[crop],
  preserveAlpha:true};
test('approved and corrective criteria bind exact selected image SHA and physical atlas',()=>{
  const criteria=boundReviewCriteria(decisions,selected);
  assert.equal(criteria.length,2);
  assert.equal(checkedCriterionReview(criteria,claims,'REJECTED',issue,scope).status,
    'CORRECTIONS_REQUIRED');
  assert.equal(criterionPermitsPaint(criteria,{
    issueId:'fix-helmet',partId:'tier2-helmet',
  },{texture_uuid:'pillar-atlas',allowed_regions:[crop]}),true);
  assert.equal(criterionPermitsPaint(criteria,{
    issueId:'fix-helmet',partId:'tier1-shield',
  },{texture_uuid:'pillar-atlas',allowed_regions:[crop]}),false);
  assert.equal(criterionPermitsPaint(criteria,{
    issueId:'fix-helmet',partId:'tier2-helmet',
  },{texture_uuid:'pillar-atlas',allowed_regions:[{from:[0,0],to:[4,4]}]}),false);
});
test('no new reference image, silent missing correction or overlapping identity can authorize art',()=>{
  for(const mutation of [
    [{...decisions[1],referencePngSha256:'b'.repeat(64)}],
    [{...decisions[1],viewId:'back'}],
    [{...decisions[1],allowedRegions:[{from:[3,3],to:[8,8]}]}],
  ]){
    assert.throws(()=>boundReviewCriteria([decisions[0],...mutation],selected),
      /CODE_MODE_REVIEW_CRITERIA_/);
  }
  // A preservation-only review may acknowledge already-approved artwork;
  // without a CORRECT criterion it cannot authorize a Paint operation.
  const preserveOnly=boundReviewCriteria([{...decisions[0]}],selected);
  assert.equal(preserveOnly.length,1);
  assert.equal(criterionPermitsPaint(preserveOnly,{
    issueId:'fix-helmet',partId:'tier2-helmet',
  },{texture_uuid:'pillar-atlas',allowed_regions:[crop]}),false);
  assert.throws(()=>boundReviewCriteria([decisions[0],{
    ...decisions[1],id:'keep-shield',
  }],selected),/CODE_MODE_REVIEW_CRITERIA_INVALID/);
});
test('reviewer may not invent acceptance, omit a criterion or violate locked identity',()=>{
  const criteria=boundReviewCriteria(decisions,selected);
  assert.throws(()=>checkedCriterionReview(criteria,claims,'ACCEPTED',issue,scope),
    /CODE_MODE_REVIEW_CRITERIA_DECISION_CONFLICT/);
  assert.throws(()=>checkedCriterionReview(criteria,claims.slice(1),
    'REJECTED',issue,scope),/CODE_MODE_REVIEW_CRITERIA_FEEDBACK_INVALID/);
  assert.throws(()=>checkedCriterionReview(criteria,[
    {...claims[0],verdict:'VIOLATED'},claims[1],
  ],'REJECTED',issue,scope),/CODE_MODE_REVIEW_APPROVED_IDENTITY_REGRESSED/);
  assert.throws(()=>checkedCriterionReview(criteria,claims,'REJECTED',[
    {...issue[0],id:'wrong-helmet'},
  ],scope),/CODE_MODE_REVIEW_CRITERIA_CORRECTION_UNBOUND/);
  assert.throws(()=>checkedCriterionReview(criteria,claims,'REJECTED',issue,{
    ...scope,allowedRegions:[{from:[1,1],to:[5,5]}],
  }),/CODE_MODE_REVIEW_CRITERIA_CORRECTION_UNBOUND/);
});
test('approved source-image regions are review observations, never atlas positions',()=>{
  const sourceEvidence={id:'shield_details',boxUv:[0.1,0.1,0.45,0.8]};
  const typed=boundReviewCriteria([{
    ...decisions[0],sourceRegion:sourceEvidence,
  },decisions[1]],selected);
  assert.deepEqual(typed[0].sourceRegion,sourceEvidence);
  assert.equal(typed[0].textureUuid,'pillar-atlas');
  assert.throws(()=>boundReviewCriteria([{
    ...decisions[0],sourceRegion:{id:'shield_details',
      boxUv:[1,0,0,0.8]},
  },decisions[1]],selected),/CODE_MODE_REVIEW_CRITERIA_INVALID/);
});
test('approved source image must not impersonate prior acceptance of the current model',()=>{
  const sourceOnly={
    id:'match-shield',
    partId:'tier1-shield',kind:'MATCH_REFERENCE',
    requirement:'The modeled shield must reproduce the approved reference silhouette and marks.',
    viewId:'front',referencePngSha256:SHA,
    sourceRegion:{id:'shield_artwork',boxUv:[0.1,0.1,0.4,0.7]},
  };
  const criteria=boundReviewCriteria([sourceOnly,decisions[1]],selected);
  assert.equal(criteria[0].kind,'MATCH_REFERENCE');
  assert.equal(criteria[0].textureUuid,undefined);
  assert.equal(criteria[0].protectedRegions,undefined);
  assert.equal(checkedCriterionReview(criteria,[
    {id:'match-shield',verdict:'MET',
      observation:'Shield appearance matches the selected approved blueprint.'},
    claims[1],
  ],'REJECTED',issue,scope).status,'CORRECTIONS_REQUIRED');
  assert.throws(()=>checkedCriterionReview(criteria,[
    {id:'match-shield',verdict:'VIOLATED',
      observation:'The modeled shield still differs from the reference image.'},
    claims[1],
  ],'REJECTED',issue,scope),/CODE_MODE_REVIEW_REFERENCE_MISMATCH_UNSCOPED/);
  assert.throws(()=>checkedCriterionReview(criteria,[
    {id:'match-shield',verdict:'UNVERIFIED',
      observation:'The shield surface is hidden in the provided camera angle.'},
    claims[1],
  ],'REJECTED',issue,scope),/CODE_MODE_REVIEW_OTHER_REQUIREMENT_UNVERIFIED/);
  assert.throws(()=>boundReviewCriteria([
    {...sourceOnly,textureUuid:'tier-atlas'},decisions[1],
  ],selected),/CODE_MODE_REVIEW_CRITERIA_INVALID/);
  assert.equal(criterionPermitsPaint(criteria,{
    issueId:'match-shield',partId:'tier1-shield',
  },{texture_uuid:'tier-atlas',allowed_regions:[crop]}),false);
});
test('all criteria must be acknowledged to declare review ready; unresolved is not accepted',()=>{
  const criteria=boundReviewCriteria(decisions,selected);
  const accepted=claims.map(item=>({...item,verdict:'MET'}));
  const all=checkedCriterionReview(criteria,accepted,'ACCEPTED',[],null);
  assert.equal(all.status,'ALL_MET');
  assert.equal(all.visual_verdict,'UNVERIFIED');
  const uncertain=claims.map((item,i)=>i===1?{
    ...item,verdict:'UNVERIFIED',
  }:item);
  assert.equal(checkedCriterionReview(criteria,uncertain,
    'UNVERIFIED',[],null).status,'UNVERIFIED');
  assert.equal(checkedCriterionReview(null,undefined,'UNVERIFIED',[],null),null);
});
