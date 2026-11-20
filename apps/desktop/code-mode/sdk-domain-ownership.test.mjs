// TEST_AUTHORED_NOT_RUN: source owner/category parity checks, not process execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Code Mode SDK maintains shared input, inspection and Geometry review owners',async()=>{
  const [client,primitives,selectors,overlap]=await Promise.all([
    read('./client.mjs'),read('./sdk-inputs.mjs'),
    read('./inspection-selectors.mjs'),read('./geometry-overlap-review.mjs')]);
  for(const name of ['sdk-inputs.mjs','inspection-selectors.mjs','geometry-overlap-review.mjs']){
    assert.ok(client.includes("'./"+name+"'"));
  }
  for(const str of ['const PLAN_LIMIT = 64 * 1024','function nonempty',
    'function wholeNumber'])assert.ok(primitives.includes(str));
  for(const str of ['export function serializeInspectionQueries',
    'MATERIAL_FACE_SPANS_INVALID','AUTHORING_TARGET_DOMAIN_MISMATCH',
    'INSPECT_BATCH_SIZE_INVALID'])assert.ok(selectors.includes(str));
  assert.match(overlap,/export function validAxisAlignedOverlapReview/);
  assert.match(overlap,/export function validRotatedNeighborObbReview/);
  assert.match(overlap,/whole_model_collision_verdict/);
  assert.match(client,/function checkedScopedApplyReceipt/);
  assert.match(client,/function requestWrite\(/);
  for(const source of [primitives,selectors,overlap]){
    assert.doesNotMatch(source,/node:child_process|\beval\s*\(|\binvoke\s*\(|authorizeMutation|createRustCodeModeClient|node:fs/);
  }
});
