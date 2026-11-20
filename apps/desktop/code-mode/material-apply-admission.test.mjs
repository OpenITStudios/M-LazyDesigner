// TEST_AUTHORED_NOT_RUN: future authorized PC-local Node validation only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {prepareMaterialApplyAdmission} from './material-apply-admission.mjs';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('unreviewed structural edit remains only a proposed operation',async()=>{
  const operations=[{op:'add_cube',cube:{uuid:'cube-1'}}];
  const result=await prepareMaterialApplyAdmission({
    args:{operations},model:{expectedSha256:'a'.repeat(64)},
    visualPair:null,reviewVisualPair:undefined,visualViews:[],
    visualPreflights:new Map(),completedReviewedCorrections:new Set(),
    referenceMaster:null,
  });
  assert.equal(result.activeOperations,operations);
  assert.equal(result.reviewedTextureSession,false);
  assert.equal(result.pixelEdit,false);
  assert.equal(result.workPacket,undefined);
  assert.equal(result.paintPlanSha256,null);
});
test('unreviewed work packet and structural write in a reviewed host fail closed',async()=>{
  const bound={model:{expectedSha256:'a'.repeat(64)},visualViews:[],
    visualPreflights:new Map(),completedReviewedCorrections:new Set(),
    referenceMaster:null};
  await assert.rejects(prepareMaterialApplyAdmission({
    ...bound,args:{materialWorkPacket:{}},visualPair:null,reviewVisualPair:undefined,
  }),/CODE_MODE_MATERIAL_WORK_PACKET_REVIEW_REQUIRED/);
  await assert.rejects(prepareMaterialApplyAdmission({
    ...bound,args:{operations:[{op:'add_bone'}]},
    visualPair:{modelSha:'a'.repeat(64)},reviewVisualPair:()=>{},
  }),/CODE_MODE_REVIEWED_CORRECTION_PAINT_ONLY/);
});
test('source face, material cohort and six-view guards precede the original publisher',async()=>{
  const [host,admission,readme]=await Promise.all([
    read('./host.mjs'),read('./material-apply-admission.mjs'),read('./README.md')
  ]);
  assert.match(host,/await prepareMaterialApplyAdmission\(/);
  assert.match(host,/receipt = await p\.apply\(/);
  assert.match(host,/authorizeMutation: async \(request\) =>/);
  assert.match(host,/permitWriteLaunch: \(request\) =>/);
  assert.match(host,/completedReviewedCorrections\.add\(p\.expectedSha256\)/);
  for(const refusal of ['CODE_MODE_REVIEW_CRITERION_SCOPE_MISMATCH',
    'CODE_MODE_MATERIAL_SAMPLE_REQUIRED','CODE_MODE_MATERIAL_FORM_SAMPLE_PACKET_REQUIRED',
    'CODE_MODE_VISUAL_VIEW_COVERAGE_UNVERIFIED','CODE_MODE_MATERIAL_WORK_PACKET_BINDING_MISMATCH',
    'CODE_MODE_MATERIAL_WORK_PACKET_FACE_SOURCE_UNVERIFIED'])
    assert.ok(admission.includes(refusal),refusal);
  assert.match(admission,/await p\.inspectBatch\(/);
  assert.match(admission,/pinnedReviewBytes\(view\.reference\)/);
  assert.match(readme,/material-apply-admission\.mjs/);
  assert.doesNotMatch(admission,/\bauthorizeMutation\s*\(|\bpermitWriteLaunch\s*\(|\boutputPath\s*\(|\bp\.apply\s*\(|\bregister\s*\(/);
});
