// TEST_AUTHORED_NOT_RUN: source guards and minimal refused paths; no host/Cargo/CI execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {inspectSelectedVisualPair} from './selected-visual-pair-inspection.mjs';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('selected visual inspection denies unbound, wrong project SHA, and guest extra args',async()=>{
  const sha='a'.repeat(64);
  const state={selected:()=>({expectedSha256:sha}),visualPair:null};
  await assert.rejects(inspectSelectedVisualPair({project:'p0'},state),
    /CODE_MODE_VISUAL_PAIR_UNBOUND/);
  await assert.rejects(inspectSelectedVisualPair({project:'p0',fake:'option'},state),
    /CODE_MODE_VISUAL_PAIR_ARGUMENT_UNSUPPORTED/);
  await assert.rejects(inspectSelectedVisualPair({project:'p0'},{
    ...state,visualPair:{modelSha:'b'.repeat(64)}
  }),/CODE_MODE_VISUAL_CAPTURE_MODEL_STALE/);
});
test('review inspection reads and publishes only current host-owned evidence',async()=>{
  const [host,inspector]=await Promise.all([
    read('./host.mjs'),read('./selected-visual-pair-inspection.mjs')
  ]);
  assert.match(host,/inspectSelectedVisualPair: \(args\) => inspectSelectedVisualPair/);
  for(const property of ['activeExecution','verifiedMultiViewRead']){
    assert.match(host,new RegExp('get '+property+'\\(\\)'));
  }
  for(const property of ['pagedFaceLedger','verifiedGeometryLandmark','verifiedMultiViewRead']){
    assert.match(host,new RegExp('set '+property+'\\(value\\)'));
    assert.match(inspector,new RegExp('state\\.'+property));
  }
  assert.match(host,/texturingReadiness: \(args\) => inspectTexturingReadiness\(args/);
  assert.match(host,/authorizeMutation: async \(request\) =>/);
  assert.match(host,/permitWriteLaunch: \(request\) =>/);
  for(const refusal of ['CODE_MODE_VISUAL_REVIEW_SESSION_STALE',
    'CODE_MODE_MATERIAL_FACE_BINDING_UNVERIFIED',
    'CODE_MODE_VISUAL_CAPTURE_MODEL_STALE','CODE_MODE_REVIEWED_FACE_SOURCE_UNVERIFIED',
    'CODE_MODE_GEOMETRY_LANDMARK_MASK_UNVERIFIED']){
    assert.ok(inspector.includes(refusal),refusal);
  }
  assert.doesNotMatch(inspector,/\bspawn\s*\(|\bexecFile\s*\(|\bauthorizeMutation\s*\(|\bpublish_new\w*\s*\(/);
});
