// TEST_AUTHORED_NOT_RUN: source guard, not proof of Rust/native execution.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('observed Blockbench snapshot rules have one source reader and unchanged probe',async()=>{
  const [nav,reader,nativeTests]=await Promise.all([
    read('../src-tauri/src/project_navigation.rs'),
    read('../src-tauri/src/project_navigation/blockbench_navigation_snapshot.rs'),
    read('../src-tauri/src/project_navigation/tests.rs'),
  ]);
  assert.match(nav,/mod blockbench_navigation_snapshot;/);
  assert.match(nav,/use blockbench_navigation_snapshot::\*;/);
  assert.match(nav,/pub\(crate\) fn probe\(blockbench_running: bool/);
  assert.match(nav,/pub\(crate\) fn registered_delete_target\(/);
  assert.match(nav,/pub\(crate\) fn action\(/);
  assert.match(nav,/struct NavigationSnapshot \{/);
  for(const n of ['valid_profile_id','observed_at_unix_ms',
    'project_navigation_snapshot_path','valid_navigation_generation',
    'navigation_snapshot_is_valid','read_navigation_snapshot',
    'hide_recycled_model_history','read_visible_navigation_snapshot',
    'navigation_revision_token','project_session_fresh','live_open_models'])
    assert.match(reader,new RegExp('pub\\(super\\) fn '+n+'\\('));
  for(const control of ['snapshot.schema == 4','snapshot.open_models.len() <= 64',
    'snapshot.recent_models.len() <= 128','512 * 1024',
    'PROJECT_SESSION_LEASE_TTL_MS: u64 = 30_000',
    'snapshot.recent_models.retain'])
    assert.ok(reader.includes(control),control);
  assert.match(nativeTests,/project_session_fresh/);
  assert.match(nativeTests,/navigation_snapshot_is_valid/);
  assert.doesNotMatch(reader,/Command::new|FileDialog::new|pub\(crate\) fn action\(|\bwrite_navigation_preferences_expected_at\b|\breplace_metadata_if_unchanged\b/);
});
