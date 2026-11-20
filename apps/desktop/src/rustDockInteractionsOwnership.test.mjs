// TEST_AUTHORED_NOT_RUN. Source-only controller/UI ownership and preserved wiring.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');

test('Dock interactions use one live parent-owned state and unchanged CSS/view callers',async()=>{
  const [page,actions,layout,inspector]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./rustDockInteractions.ts'),
    read('./rustDockLayout.ts'),read('./rustInspectorViewOwnership.test.mjs')
  ]);
  assert.match(page,/createRustDockInteractions\(\{/);
  assert.match(page,/get dockLayout\(\) \{ return dockLayout; \}/);
  assert.match(page,/set dockLayout\(value:DockLayout\) \{ dockLayout = value; \}/);
  assert.match(page,/get floatingGesture\(\) \{ return floatingGesture; \}/);
  assert.match(page,/set floatingGesture\(value:FloatingGesture\|null\)/);
  assert.match(page,/get editorBody\(\) \{ return editorBody; \}/);
  assert.match(page,/onpointerdown=\{startInspectorResize\}/);
  assert.match(page,/onpointerdown=\{\(event\) => startDockResize\('left', event\)\}/);
  assert.match(page,/function hotkeys\(event: KeyboardEvent\)/);
  assert.match(page,/dockLayout = stored;/);
  assert.match(page,/strokeActive=\{!!paintStroke\}/);
  assert.match(actions,/export function createRustDockInteractions\(/);
  for(const method of ['floatPanel','attachPanel','returnPanel',
    'startFloating','moveFloating','finishFloating','keyFloatingMove','keyFloatingSize',
    'hideDock','swapDocks','resetDocks','attachTabs','separateTabs',
    'activateAttachedTab','keyAttachedTab','startDockResize','moveDockResize',
    'finishDockResize','keyDockResize','startInspectorResize','moveInspectorResize',
    'finishInspectorResize','keyInspectorResize']) {
    assert.match(actions,new RegExp('function '+method+'\\('));
    assert.doesNotMatch(page,new RegExp('function '+method+'\\('));
  }
  assert.match(actions,/window\.localStorage\.setItem\(RUST_DOCK_LAYOUT_KEY/);
  assert.match(actions,/target\.setPointerCapture\(event\.pointerId\)/);
  // Cancellation is handled by the view's lost-pointer-capture events.
  assert.match(page,/onlostpointercapture=\{\(event\) => finishFloating\(event, true\)\}/);
  assert.match(actions,/event\.preventDefault\(\)/);
  assert.match(inspector,/startInspectorResize/);
  assert.match(layout,/export function measureDocks/);
  assert.doesNotMatch(actions,/@tauri-apps|\binvoke\(|rust_editor_|AuthoringDocument|EditorSession/);
});
