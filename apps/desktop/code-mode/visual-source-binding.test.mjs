// SOURCE_AUTHORED_NOT_RUN: trust-zone data remains source-only evidence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compactMaskMismatch,boundGeometryLandmark,
  pinnedReviewImageLeaseValid} from './visual-source-binding.mjs';

test('unavailable pixel localization remains unavailable, never accepted',()=>{
  const result=compactMaskMismatch({});
  assert.equal(result.status,'UNAVAILABLE');
  assert.deepEqual(result.priority_regions,[]);
  assert.throws(()=>compactMaskMismatch({silhouette:{
    status:'alpha_overlap_measured',
    localization:{status:'pixel_mask_mismatch_measured',priority_regions:[]},
  }}),/CODE_MODE_VISUAL_MASK_LOCALIZATION_INVALID/);
});
test('unbound landmark and missing selected PNG cannot prove visual readiness',()=>{
  assert.equal(boundGeometryLandmark(undefined,[]),null);
  assert.throws(()=>boundGeometryLandmark({
    cubeUuid:'cube',viewId:'front',mismatchKind:'missing',
    regionBounds:[0,0,4,4],landmarkLabel:'Body',
  },[]),/CODE_MODE_GEOMETRY_LANDMARK_BINDING_INVALID/);
  assert.equal(pinnedReviewImageLeaseValid({
    path:'/definitely-not-a-real-file.png',sha256:'a'.repeat(64),
  }),false);
});
