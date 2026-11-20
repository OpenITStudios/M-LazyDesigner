// TEST_AUTHORED_NOT_RUN: source-level Tauri reference/candidate ownership.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('public material preview commands retain their exact entrypoints',async()=>{
  const [parent,preview,readme] = await Promise.all([
    read('../src-tauri/src/desktop_authoring.rs'),
    read('../src-tauri/src/desktop_authoring/material_candidate_previews.rs'),
    read('../src-tauri/src/desktop_authoring/README.md')
  ]);
  assert.match(parent,/mod material_candidate_previews;/);
  for(const [command,implementation] of [
    ['rust_editor_choose_semantic_reference','choose_semantic_reference'],
    ['rust_editor_preview_semantic_material','preview_semantic_material'],
    ['rust_editor_preview_external_face_png','preview_external_face_png']
  ]){
    assert.match(parent,new RegExp('pub (?:async )?fn '+command+'\\('));
    assert.match(preview,new RegExp('pub\\(super\\) (?:async )?fn '+implementation+'\\('));
    assert.match(parent,new RegExp('material_candidate_previews::'+implementation+'\\('));
  }
  assert.match(parent,/pub fn rust_editor_apply_preview_semantic_material\(/);
  assert.match(parent,/pub fn rust_editor_apply_external_face_png\(/);
  assert.match(parent,/fn detached_edit<F>/);
  assert.match(readme,/material_candidate_previews\.rs/);
  assert.doesNotMatch(preview,/#\[tauri::command\]|storage::publish_new|write_lease\(|detached_edit\(/);
});
test('source PNG identity and revision rules remain in the source-bound preview owner',async()=>{
  const preview=await read('../src-tauri/src/desktop_authoring/material_candidate_previews.rs');
  for(const value of ['MAX_IMPORT_PNG_BYTES','SEMANTIC_REFERENCE_PNG_INVALID',
    'SEMANTIC_REFERENCE_PNG_UNSUPPORTED','SEMANTIC_PREVIEW_REVISION_MISMATCH',
    'SEMANTIC_PREVIEW_SOURCE_STALE','SEMANTIC_PREVIEW_TEXTURE_AMBIGUOUS',
    'EXTERNAL_TEXTURE_SOURCE_STALE','EXTERNAL_TEXTURE_IDENTITY_INVALID',
    'USER_SELECTED_NOT_ARTISTICALLY_VERIFIED','NOT_GRANTED','UNVERIFIED']){
    assert.ok(preview.includes(value),value);
  }
  assert.match(preview,/frozen_read_session\(&state\.store,expected_epoch,expected_revision\)/);
  assert.match(preview,/candidate\.apply_external_face_texture\(&intent,&candidate_input\)/);
  assert.match(preview,/preview_semantic_candidate\(&source,&intent\)/);
  assert.match(preview,/storage::read_bounded\(&path,MAX_IMPORT_PNG_BYTES\)/);
  assert.doesNotMatch(preview,/\bpub async fn rust_editor_\w+\s*\(/);
});
