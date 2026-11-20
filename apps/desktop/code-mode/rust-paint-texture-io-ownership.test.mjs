// TEST_AUTHORED_NOT_RUN — source-only native command ownership and refusals.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('Paint IO keeps public Tauri commands while delegating the exact original signatures',async()=>{
  const [parent,child,readme]=await Promise.all([
    read('../src-tauri/src/desktop_authoring.rs'),
    read('../src-tauri/src/desktop_authoring/paint_texture_io.rs'),
    read('../src-tauri/src/desktop_authoring/README.md'),
  ]);
  assert.match(parent,/mod paint_texture_io;/);
  for(const [cmd,fn] of [
    ['rust_editor_read_texture_preview','read_selected_atlas_preview'],
    ['rust_editor_import_paint_png','import_selected_paint_png'],
    ['rust_editor_export_paint_png','export_selected_paint_png']]){
    assert.match(parent,new RegExp('pub (?:async )?fn '+cmd+'\\('));
    assert.match(parent,new RegExp('paint_texture_io::'+fn+'\\('));
    assert.match(child,new RegExp('pub\\(super\\) (?:async )?fn '+fn+'\\('));
  }
  assert.match(parent,/pub async fn rust_editor_export_review_capture\(/);
  assert.match(parent,/pub async fn rust_editor_save_copy\(/);
  assert.match(parent,/fn detached_edit<F>/);
  assert.match(readme,/paint_texture_io\.rs/);
  assert.doesNotMatch(child,/#\[tauri::command/);
});
test('original read-only atlas and import/export source guards remain with native Rust',async()=>{
  const child=await read('../src-tauri/src/desktop_authoring/paint_texture_io.rs');
  for(const expected of ['SELECTED_PREVIEW_KEY_INVALID','SELECTED_PREVIEW_IDENTITY_STALE',
    'SELECTED_PREVIEW_UV_MISMATCH','SELECTED_PROJECT_ATLAS_ONLY',
    'RUST_VALIDATED_EMBEDDED_PNG','PAINT_NAME_INVALID','MAX_IMPORT_PNG_BYTES',
    'PAINT_TEXTURE_NOT_FOUND','PAINT_EXPORT_TEXTURE_UNSUPPORTED']){
    assert.ok(child.includes(expected),expected);
  }
  assert.match(child,/frozen_read_session\(&state\.store,expected_epoch,expected_revision\)/);
  assert.match(child,/EditOperation::ImportPaintTexture/);
  assert.match(child,/detached_edit\(/);
  assert.match(child,/let _lease = write_lease\(&state\.pending_edit\)/);
  assert.match(child,/verify_publication_source\(/);
  assert.match(child,/storage::publish_new_png\(&path, &bytes, MAX_EXPORT_PNG_BYTES\)/);
  assert.doesNotMatch(child,/pub fn rust_editor_apply\(|createCodeModeHost|pub struct EditorState/);
});
