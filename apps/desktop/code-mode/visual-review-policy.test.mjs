// SOURCE_AUTHORED_NOT_RUN: held Code Mode source regression.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizedVisualReview,overlapsRectangle,
  correctionFitsReview,mergeReviewedPixelGuards} from './visual-review-policy.mjs';

test('reviewer declarations never certify native/visual source quality',()=>{
  const unknown=normalizedVisualReview({decision:'UNVERIFIED',issues:[]});
  assert.equal(unknown.status,'RECORDED');
  assert.equal(unknown.visual_verdict,'UNVERIFIED');
  const accepted=normalizedVisualReview({decision:'ACCEPTED',issues:[]});
  assert.equal(accepted.decision,'ACCEPTED');
  assert.equal(accepted.visual_verdict,'UNVERIFIED');
  assert.throws(()=>normalizedVisualReview({decision:'REJECTED',issues:[]}),
    /CODE_MODE_VISUAL_REVIEW_INVALID/);
});
test('selected multi-view evidence cannot omit a review',()=>{
  const good={decision:'ACCEPTED',issues:[],viewReviews:[
    {viewId:'front',decision:'ACCEPTED',observation:'front image reviewed'},
    {viewId:'back',decision:'ACCEPTED',observation:'back image reviewed'},
  ]};
  assert.equal(normalizedVisualReview(good,['front','back']).viewReviews.length,2);
  assert.throws(()=>normalizedVisualReview({...good,
    viewReviews:good.viewReviews.slice(0,1)},['front','back']),
    /CODE_MODE_VISUAL_VIEW_REVIEW_INVALID/);
});
test('reviewed pixel region and color guards cannot be expanded',()=>{
  const requested={texture_uuid:'metal',
    allowed_regions:[{from:[0,0],to:[4,4]}],
    preserve_alpha:true,editable_before_rgba:[[50,60,70,255]]};
  const reviewed={textureUuid:'metal',
    allowedRegions:[{from:[0,0],to:[4,4]}],
    preserveAlpha:true,protectedRegions:[{from:[0,0],to:[1,1]}],
    editableBeforeRgba:[[50,60,70,255]]};
  assert.equal(correctionFitsReview(requested,reviewed),true);
  const merged=mergeReviewedPixelGuards(requested,reviewed);
  assert.deepEqual(merged.protectedRegions,[{from:[0,0],to:[1,1]}]);
  assert.deepEqual(merged.editableBeforeRgba,[[50,60,70,255]]);
  assert.equal(overlapsRectangle({from:[0,0],to:[1,1]},
    {from:[1,1],to:[2,2]}),false);
  assert.equal(correctionFitsReview({...requested,
    allowed_regions:[{from:[0,0],to:[6,4]}]},reviewed),false);
  assert.throws(()=>mergeReviewedPixelGuards({...requested,
    editable_before_rgba:[[210,0,0,255]]},reviewed),
    /CODE_MODE_REVIEWED_SOURCE_COLOR_CONFLICT/);
});
