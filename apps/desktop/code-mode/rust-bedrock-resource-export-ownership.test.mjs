// TEST_AUTHORED_NOT_RUN: source ownership, caller API and refusal guards.
// To be executed only if the user separately authorizes local PC validation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('public native export commands are unchanged Tauri entrypoints',async()=>{
  const [parent,exporter,readme]=await Promise.all([
    read('../src-tauri/src/desktop_authoring.rs'),
    read('../src-tauri/src/desktop_authoring/bedrock_resource_exports.rs'),
    read('../src-tauri/src/desktop_authoring/README.md'),
  ]);
  assert.match(parent,/mod bedrock_resource_exports;/);
  for(const name of ['rust_editor_export_bedrock_geometry','rust_editor_export_bedrock_animations']){
    assert.match(parent,new RegExp('#\\[tauri::command\\]\\npub async fn '+name+'\\('));
  }
  assert.match(parent,/bedrock_resource_exports::export_geometry_resource\(state,expected_epoch,expected_revision\)\.await/);
  assert.match(parent,/bedrock_resource_exports::export_animation_resource\(state,expected_epoch,expected_revision\)\.await/);
  assert.match(parent,/pub async fn rust_editor_save_copy\(/);
  assert.match(parent,/fn detached_edit<F>/);
  assert.match(exporter,/pub\(super\) async fn export_geometry_resource\(/);
  assert.match(exporter,/pub\(super\) async fn export_animation_resource\(/);
  assert.match(readme,/bedrock_resource_exports\.rs/);
  assert.doesNotMatch(exporter,/#\[tauri::command\]/);
});
test('both exporters preserve the original source lease, path admission and fresh-only publication',async()=>{
  const [parent,exporter]=await Promise.all([
    read('../src-tauri/src/desktop_authoring.rs'),
    read('../src-tauri/src/desktop_authoring/bedrock_resource_exports.rs'),
  ]);
  for(const fragment of ['check_epoch(&guard, expected_epoch)?;',
    'active.session.summary().revision != expected_revision',
    'let Some(path) = chosen else { return Ok(None); };',
    'let _lease = write_lease(&state.pending_edit)?;',
    'freeze_publication(', 'verify_publication_source(']){
    assert.ok(exporter.includes(fragment),fragment);
  }
  assert.match(exporter,/storage::geometry_json\(&path\)/);
  assert.match(exporter,/storage::animation_json\(&path\)/);
  assert.match(exporter,/storage::publish_new_geometry\(&path, &bytes, MAX_MODEL_BYTES\)/);
  assert.match(exporter,/storage::publish_new_animation\(&path, &bytes, MAX_MODEL_BYTES\)/);
  assert.match(exporter,/bedrock_animation_curve_fidelity\(frozen.session.document\(\)\)/);
  assert.doesNotMatch(exporter,/save_copy|pub fn rust_editor_|createCodeModeHost/);
  assert.match(parent,/pub async fn rust_editor_export_review_capture\(/);
  assert.match(parent,/pub async fn rust_editor_recovery_restore\(/);
});
