// TEST_AUTHORED_NOT_RUN: read-only host ownership guard; no Node/native execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Texture readiness reads live host ledger but cannot mutate source or approve artwork',async()=>{
  const [host,readiness]=await Promise.all([read('./host.mjs'),
    read('./texturing-readiness.mjs')]);
  assert.match(host,/texturingReadiness: \(args\) => inspectTexturingReadiness\(args, \{/);
  assert.match(host,/get visualPair\(\) \{ return visualPair; \}/);
  assert.match(host,/get pagedFaceLedger\(\) \{ return pagedFaceLedger; \}/);
  assert.match(host,/get visualViews\(\) \{ return visualViews; \}/);
  for(const guard of ['SOURCE_FACE_SCAN_DUPLICATE_FACE','SOURCE_FACE_SCAN_INCOMPLETE',
    'REVIEWED_FACE_SOURCE_INSPECTION_INVALID','REQUIRED_SOURCE_FACES_UNREVIEWED',
    'CURRENT_REVISION_NOT_ACCEPTED_BY_REVIEWER',
    'REVIEWER_DECLARED_READY_FOR_USER_DECISION','texture_completion_attested:false']){
    assert.ok(readiness.includes(guard),guard);
  }
  for(const importName of ['visual-source-binding','source-face-coverage',
    'approved-reference-package'])assert.ok(readiness.includes(importName));
  assert.doesNotMatch(readiness,/authorizeMutation|createRustCodeModeHost|\bregister\(|\bimportPng\s*\(|\bapply\s*\(/);
});
