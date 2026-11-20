// TEST_AUTHORED_NOT_RUN: ownership guard, not native or Cargo validation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
const base='../src-tauri/src/desktop_authoring';
test('frozen GUI projection is separated from Tauri edit and file authority',async()=>{
  const [parent,view,tests]=await Promise.all([
    read(base+'.rs'),read(base+'/snapshot_projection.rs'),read(base+'/tests.rs')
  ]);
  assert.match(parent,/mod snapshot_projection;/);
  assert.match(parent,/use snapshot_projection::\*;/);
  assert.match(parent,/fn detached_edit<F>\(/);
  assert.match(parent,/check_epoch\(&guard, expected_epoch\)/);
  assert.match(parent,/pub fn rust_editor_apply\(/);
  assert.match(parent,/fn current_detached\(/);
  assert.match(view,/pub\(super\) struct ProjectionReuse/);
  assert.match(view,/pub\(super\) preview: Option/);
  assert.match(view,/pub\(super\) geometry: Option/);
  assert.match(view,/pub\(super\) animation: Option/);
  assert.match(view,/pub\(super\) fn project_frozen/);
  assert.match(view,/pub\(super\) fn freeze_projection/);
  assert.match(view,/pub\(super\) fn project_detached/);
  assert.match(view,/snapshot\.geometry_reused/);
  assert.match(view,/snapshot\.animations_reused/);
  assert.match(view,/preview_sources_reused/);
  assert.match(tests,/borrowed_vec3_projection_matches_previous_owned_decoder/);
  assert.match(tests,/project_with_preview_reuse/);
  assert.match(tests,/freeze_projection/);
  assert.doesNotMatch(view,/\bdetached_edit\s*<|pub fn rust_editor_apply|\brust_editor_save_copy\b|\brust_editor_recovery_restore\b|\bpublish_new\w*\s*\(/);
});
