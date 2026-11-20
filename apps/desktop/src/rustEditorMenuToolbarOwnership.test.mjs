// TEST_AUTHORED_NOT_RUN: source UI/authority regression, not Svelte or Windows PASS.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('Rust menu and toolbar preserve original labels, bindings and disabled gates',async()=>{
  const [page,chrome]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustEditorMenuToolbar.svelte')
  ]);
  assert.match(page,/<RustEditorMenuToolbar\b/);
  for(const n of ['menu','transformTool','reviewViewId'])
    assert.match(page,new RegExp('bind:'+n+'\\b'));
  for(const phrase of ['aria-label="Editor menu"','aria-label="Editor mode"',
    'aria-label="Model actions"','aria-label="Edit operations"',
    'aria-label="Viewport transform tools"','aria-label="Review camera direction"',
    'Capture PNG','Export Bedrock Geometry…','Export Bedrock Animations…',
    'Recover Checkpoint…','Legacy Workspace','Save Copy…']){
    assert.ok(chrome.includes(phrase),phrase);
  }
  assert.match(chrome,/disabled=\{!snapshot \|\| snapshot.dirty \|\| !snapshot.sourceName \|\|/);
  assert.match(chrome,/validSemanticPreview \|\| validExternalPreview \|\| workspaceMode === 'animate'/);
  assert.match(chrome,/onclick=\{\(\) => \{ frameModel\(\); closeMenus\(\); \}\}/);
  assert.match(chrome,/onclick=\{\(\) => transformTool = transformTool === 'scale' \? null : 'scale'\}/);
  assert.match(chrome,/onchange=\{clearSemanticComparison\}/);
  assert.match(page,/onkeydown=\{hotkeys\} onclick=\{outsideClick\}/);
  for(const fn of ['saveCopy','requestNew','requestOpen','history','selectWorkspace',
    'exportReviewCapture','openRecoveryDialog','clearSemanticComparison'])
    assert.match(page,new RegExp('(?:async )?function '+fn+'\\('));
  assert.doesNotMatch(chrome,/@tauri-apps|\binvoke\s*\(|localStorage|createCodeModeHost|rust_editor_apply/);
});
