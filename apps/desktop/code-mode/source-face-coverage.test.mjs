// SOURCE_AUTHORED_NOT_RUN: mocked CLI receipts, no native model evidence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceCoverageReader,sourceFacesForImageReviewer,MAX_SOURCE_COVERAGE_PAGES}
  from './source-face-coverage.mjs';
const SHA='a'.repeat(64);
const sides=['north','east','south','west','up','down'];

test('bounded reviewer scan returns saved Cube/Face IDs without extra calls',async()=>{
  let calls=0;
  const model={expectedSha256:SHA,inspectBatch:async req=>{
    calls++;
    assert.deepEqual(req,[{kind:'model_texture_coverage',
      offset:0,limit:8,attention_only:false}]);
    return {sha256:SHA,results:[{kind:'model_texture_coverage',coverage:{
      scope:'saved_face_texture_coverage_page',
      offset:0,total_cubes:1,reviewed_cubes:1,next_offset:null,
      cubes:[{cube_uuid:'cube',faces:sides.map(side=>({
        side,status:'resolved',texture_uuid:'atlas',
      }))}],
    }}]};
  }};
  assert.equal(MAX_SOURCE_COVERAGE_PAGES,128);
  const review=await sourceFacesForImageReviewer(model);
  assert.equal(review.complete,true);
  assert.equal(review.faces.length,6);
  assert.equal(review.source_model_sha256,SHA);
  assert.equal(calls,1);
});
test('stale Rust SHA cannot feed reviewer source coverage',async()=>{
  const bad={expectedSha256:SHA,inspectBatch:async()=>({
    sha256:'b'.repeat(64),results:[{kind:'model_texture_coverage',
      coverage:{offset:0}}],
  })};
  await assert.rejects(sourceCoverageReader(bad)(0,null),
    /CODE_MODE_COVERAGE_BATCH_INVALID/);
});
