// TEST_AUTHORED_NOT_RUN: Outliner/Properties presentation has no model authority.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Outliner and Properties use one source snapshot and original parent callbacks',async()=>{
  const [page,outliner,properties]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustOutlinerPanel.svelte'),
    read('./RustElementProperties.svelte')]);
  assert.match(page,/<RustOutlinerPanel\b/);
  assert.match(page,/<RustElementProperties\b/);
  assert.match(page,/bind:selectedFace/);
  assert.match(page,/function toggleRowVisibility\(/);
  assert.match(page,/async function renameSelected\(/);
  assert.match(page,/async function reparentSelected\(/);
  assert.match(outliner,/role="tree"/);
  assert.match(outliner,/onclick=\{\(\) => toggleRowVisibility\(row\)\}/);
  assert.match(outliner,/collapsed.has\(row.uuid\)/);
  assert.match(properties,/aria-label="Rename selected Cube"/);
  assert.match(properties,/aria-label="Move Bone to another parent"/);
  assert.match(properties,/faceRotation === null/);
  assert.match(properties,/boneContains\(/);
  for(const child of [outliner,properties]){
    assert.doesNotMatch(child,/@tauri-apps|\binvoke\s*\(|createCodeModeHost|rust_editor_apply|EditorSession|localStorage/);
  }
  assert.match(page,/onpointerdown=\{startInspectorResize\}/);
});
