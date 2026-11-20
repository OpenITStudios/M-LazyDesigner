// TEST_AUTHORED_NOT_RUN: source-only CLI category and safety boundary assertions.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
const root='../src-tauri/src/bin/lazydesigner-authoring/';
test('CLI preserves one command route and separate bounded inspection owners',async()=>{
  const [main,projection,batch,routes]=await Promise.all([
    read('../src-tauri/src/bin/lazydesigner-authoring.rs'),
    read(root+'focused_projections.rs'),read(root+'inspection_batch.rs'),
    read(root+'command_routes.rs')]);
  assert.match(main,/fn ensure_source_sha/);
  assert.match(main,/fn main\(\)/);
  assert.match(main,/use command_routes::execute/);
  assert.match(projection,/pub\(super\) fn inspect_authoring_target_with_view/);
  assert.match(batch,/pub\(super\) enum InspectBatchQuery/);
  assert.match(batch,/pub\(super\) requests: Vec<InspectBatchQuery>/);
  assert.match(batch,/INSPECT_BATCH_RESULT_TOO_LARGE/);
  assert.match(routes,/pub\(super\) fn execute\(\)/);
  assert.match(routes,/ensure_source_sha/);
  assert.match(routes,/publish_new_animation/);
  assert.match(routes,/SOURCE_CHANGED_DURING_EXPORT/);
  assert.doesNotMatch(projection,/publish_new\s*\(|publish_new_animation\s*\(/);
  assert.doesNotMatch(batch,/publish_new\s*\(|publish_new_animation\s*\(/);
  assert.equal((main.match(/fn main\(\)/g)??[]).length,1);
});
