// Regression source only. Repository native and Node tests remain held.
import test from 'node:test';
import assert from 'node:assert/strict';
import {REVIEW_VIEW_IDS,reviewCameraAxes} from './rustReviewCapture.ts';
test('review capture uses six distinct fixed directions with valid camera up vectors',()=>{
  assert.deepEqual(REVIEW_VIEW_IDS,['front','back','left','right','top','bottom']);
  const found=new Set();
  for(const view of REVIEW_VIEW_IDS){
    const axes=reviewCameraAxes(view);
    assert.ok(axes);
    assert.equal(axes.direction.reduce((sum,x)=>sum+x*x,0),1);
    assert.equal(axes.up.reduce((sum,x)=>sum+x*x,0),1);
    assert.equal(axes.direction.reduce((sum,x,i)=>sum+x*axes.up[i],0),0);
    found.add(axes.direction.join(','));
  }
  assert.equal(found.size,6);
  assert.equal(reviewCameraAxes('unknown'),null);
});
