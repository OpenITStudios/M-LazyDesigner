// TEST_AUTHORED_NOT_RUN: native Project Navigation ownership guard only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('saved preferences have one persistence owner and preserve native safety',async()=>{
  const [nav,prefs,tests]=await Promise.all([
    read('../src-tauri/src/project_navigation.rs'),
    read('../src-tauri/src/project_navigation/saved_project_preferences.rs'),
    read('../src-tauri/src/project_navigation/tests.rs'),
  ]);
  assert.match(nav,/mod saved_project_preferences;/);
  assert.match(nav,/use saved_project_preferences::\*;/);
  assert.match(nav,/pub\(crate\) fn action\(/);
  assert.match(nav,/pub\(crate\) fn projection\(/);
  assert.match(nav,/pub\(crate\) fn registered_delete_target\(/);
  assert.match(nav,/fn scan_registered_models\(/);
  assert.match(nav,/struct ProjectNavigationPreferences \{/);
  assert.match(prefs,/pub\(super\) fn empty_navigation_preferences/);
  assert.match(prefs,/pub\(super\) fn read_navigation_preferences_with_raw_at/);
  assert.match(prefs,/pub\(super\) fn write_navigation_preferences_expected_at/);
  assert.match(prefs,/pub\(super\) fn restore_project_preferences_at/);
  assert.match(prefs,/MAX_REGISTERED_PROJECTS/);
  assert.match(prefs,/MAX_RECYCLED_PROJECT_MARKERS/);
  assert.match(prefs,/replace_metadata_if_unchanged/);
  assert.match(prefs,/preserve_damaged_metadata/);
  assert.match(prefs,/Current preferences are not corrupt; restore refused/);
  assert.match(prefs,/Preferences changed during restore/);
  assert.match(tests,/restore_project_preferences_at/);
  assert.match(tests,/empty_navigation_preferences/);
  assert.doesNotMatch(prefs,/Command::new|FileDialog::new|pub\(crate\) fn projection|pub\(crate\) fn action/);
});
