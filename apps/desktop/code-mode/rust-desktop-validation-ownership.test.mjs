// TEST_AUTHORED_NOT_RUN — source-level ownership/refusal contracts only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Tauri owns native commands while candidate checks stay provisional',async()=>{
  const [parent,verification,capture,rustTests,owners]=await Promise.all([
    read('../src-tauri/src/desktop_authoring.rs'),
    read('../src-tauri/src/desktop_authoring/material_candidate_verification.rs'),
    read('../src-tauri/src/desktop_authoring/review_capture_validation.rs'),
    read('../src-tauri/src/desktop_authoring/tests.rs'),
    read('../src-tauri/src/desktop_authoring/README.md')
  ]);
  assert.match(parent,/mod material_candidate_verification;/);
  assert.match(parent,/mod review_capture_validation;/);
  assert.match(parent,/use material_candidate_verification::/);
  assert.match(parent,/use review_capture_validation::/);
  assert.match(parent,/pub fn rust_editor_apply_preview_semantic_material/);
  assert.match(parent,/pub async fn rust_editor_export_review_capture/);
  assert.match(parent,/fn detached_edit<F>/);
  assert.match(parent,/pub async fn rust_editor_save_copy/);
  assert.match(verification,/pub\(super\) fn preview_semantic_candidate/);
  assert.match(verification,/pub\(super\) fn apply_checked_semantic_candidate/);
  for(const code of ['SEMANTIC_PREVIEW_NATIVE_MISMATCH',
    'SEMANTIC_PREVIEW_SOURCE_STALE','SEMANTIC_PREVIEW_CANDIDATE_STALE',
    'SEMANTIC_PREVIEW_APPLY_MISMATCH','NOT_GRANTED']){
    assert.ok(verification.includes(code),code);
  }
  assert.match(verification,/\*session=candidate/);
  assert.match(capture,/pub\(super\) fn decode_review_capture_png/);
  assert.match(capture,/pub\(super\) fn review_capture_source/);
  for(const code of ['REVIEW_CAPTURE_FORMAT_INVALID','REVIEW_CAPTURE_PNG_UNSUPPORTED',
    'REVIEW_CAPTURE_MODEL_UNSAVED','REVIEW_CAPTURE_CANONICAL_COPY_REQUIRED',
    'RUST_EDITOR_SOURCE_CHANGED']){
    assert.ok(capture.includes(code),code);
  }
  assert.match(capture,/storage::read_bounded\(path, MAX_MODEL_BYTES\)/);
  for(const child of [capture,verification]){
    assert.doesNotMatch(child,/#\[tauri::command|pub struct EditorState|pub async fn rust_editor_|\bFileDialog::new/);
    assert.doesNotMatch(child,/\bstorage::publish_new\w*\s*\(/);
  }
  assert.match(parent,/storage::publish_new_png/);
  assert.match(rustTests,/preview_semantic_candidate/);
  assert.match(rustTests,/apply_checked_semantic_candidate/);
  assert.match(rustTests,/decode_review_capture_png/);
  assert.match(rustTests,/review_capture_source/);
  assert.match(owners,/only GUI-side/);
});
