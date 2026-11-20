// TEST_AUTHORED_NOT_RUN: source-level owner/refusal invariants only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const load=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Project manifest identity stays separate from navigation commands and prefs',async()=>{
  const [nav,identity,prefs,rustTests]=await Promise.all([
    load('../src-tauri/src/project_navigation.rs'),
    load('../src-tauri/src/project_navigation/project_manifest_identity.rs'),
    load('../src-tauri/src/project_navigation/saved_project_preferences.rs'),
    load('../src-tauri/src/project_navigation/tests.rs'),
  ]);
  assert.match(nav,/mod project_manifest_identity;/);
  assert.match(nav,/use project_manifest_identity::\*;/);
  assert.match(nav,/mod saved_project_preferences;/);
  assert.match(nav,/pub\(crate\) fn projection\(/);
  assert.match(nav,/pub\(crate\) fn action\(/);
  assert.match(nav,/pub\(crate\) fn registered_delete_target\(/);
  assert.match(nav,/fn navigation_paths\(/);
  assert.match(nav,/struct ProjectManifest \{/);
  assert.match(identity,/pub\(super\) fn read_project_manifest_state/);
  assert.match(identity,/pub\(super\) fn project_identity_map/);
  assert.match(identity,/pub\(super\) fn project_root_for_model/);
  assert.match(identity,/pub\(super\) fn write_project_manifest_bytes_at/);
  assert.match(identity,/ProjectManifestState::LegacyMarker/);
  assert.match(identity,/replace_metadata_if_unchanged\(path, bytes, expected, true\)/);
  assert.match(identity,/MAX_BYTES/);
  assert.match(identity,/\#\[cfg\(test\)\]\npub\(super\) fn write_project_manifest/);
  assert.match(rustTests,/read_project_manifest_state/);
  assert.match(rustTests,/project_identity_map/);
  assert.match(rustTests,/write_project_manifest/);
  assert.match(prefs,/fn restore_project_preferences_at/);
  assert.doesNotMatch(identity,/pub\(crate\) fn action\(|pub\(crate\) fn registered_delete_target|FileDialog::new|Command::new/);
  assert.doesNotMatch(identity,/fn read_navigation_preferences_with_raw_at|fn restore_project_preferences_at/);
});
