// TEST_AUTHORED_NOT_RUN: Rust source ownership, NOT an executed Cargo test.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');
const owner='../src-tauri/src/authoring/';
test('One Rust document/session owns transactions; categorized rules preserve admission',async()=>{
  const [root,document,uv,hierarchy,animation]=await Promise.all([
    read(owner+'mod.rs'),read(owner+'document_validation.rs'),
    read(owner+'cube_uv_rules.rs'),read(owner+'hierarchy_rules.rs'),
    read(owner+'animation_frame_rules.rs'),
  ]);
  for(const name of ['document_validation','cube_uv_rules','hierarchy_rules',
    'animation_frame_rules']){
    assert.ok(root.includes('mod '+name+';'),'Missing category '+name);
  }
  assert.match(root,/pub struct AuthoringDocument/);
  assert.match(root,/pub struct EditorSession/);
  assert.match(root,/pub fn apply_with_correction_scope/);
  assert.match(root,/pub fn undo\(/);
  assert.match(root,/pub fn redo\(/);
  assert.match(root,/pub use cube_uv_rules::has_per_texture_uv_rules/);
  assert.match(document,/pub\(super\) fn validate_outliner/);
  assert.match(document,/OUTLINER_CUBE_REFERENCE_INVALID/);
  assert.match(uv,/pub fn has_per_texture_uv_rules/);
  assert.match(uv,/CUBE_BOX_UV_RULESET_UNSUPPORTED/);
  assert.match(uv,/CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED/);
  assert.match(uv,/CUBE_FACE_TEXTURE_UNSUPPORTED/);
  assert.match(hierarchy,/pub\(super\) fn has_external_uuid_references/);
  assert.match(hierarchy,/pub\(super\) fn find_visibility_group/);
  assert.match(animation,/pub\(super\) fn editable_transform_clip/);
  assert.match(animation,/bezier::valid_track_segments/);
  assert.match(animation,/timeline_markers::valid_saved_markers/);
  assert.match(animation,/effects::valid_effect_track/);
  for(const module of [document,uv,hierarchy,animation]){
    assert.doesNotMatch(module,/\bimpl EditorSession\b|pub struct EditorSession|\bpub fn (?:undo|redo|apply_with_correction_scope)\b/);
    assert.doesNotMatch(module,/publish_new|std::fs|FileDialog|\beval\s*\(/);
  }
});
