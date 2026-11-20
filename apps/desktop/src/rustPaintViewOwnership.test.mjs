// TEST_AUTHORED_NOT_RUN: source-level view ownership, not Svelte/native parity.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('Paint candidate dialogs retain source-bound review and parent-owned native guards',async()=>{
  const [parent,external,semantic]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustPaintExternalCandidate.svelte'),
    read('./RustPaintSemanticCandidate.svelte')]);
  assert.match(parent,/<RustPaintExternalCandidate\b/);
  assert.match(parent,/<RustPaintSemanticCandidate\b/);
  assert.match(parent,/bind:externalReviewed/);
  assert.match(parent,/bind:semanticReviewed/);
  assert.match(parent,/bind:selectedFace/);
  assert.match(parent,/matchedRenders=\{matchingRenderedMaterialPair/);
  assert.match(external,/aria-label="External pixel editor PNG"/);
  assert.match(external,/!matchedRenders/);
  assert.match(semantic,/aria-label="Semantic painted-metal candidate"/);
  assert.match(semantic,/!semanticReadyForApply/);
  for(const view of [external,semantic]){
    assert.doesNotMatch(view,/@tauri-apps|\binvoke\s*\(|createCodeModeHost|EditorSession|rust_editor_apply|localStorage/);
    assert.match(view,/\.paint-starter \{/);
  }
});
test('Atlas view forwards original pointer gestures and mask overlays without bitmap ownership',async()=>{
  const [parent,atlas]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustPaintAtlasCanvas.svelte')]);
  assert.match(parent,/<RustPaintAtlasCanvas\b/);
  assert.match(parent,/function finishPaintStroke\(/);
  assert.match(atlas,/use:drawSurfaceSelectionOverlay/);
  for(const action of ['onpointerdown={startPaintStroke}','onpointermove={movePaintStroke}',
    'onpointerup={finishPaintStroke}',
    'onpointercancel={(event) => finishPaintStroke(event, true)}',
    'onlostpointercapture={(event) => finishPaintStroke(event, true)}']){
    assert.ok(atlas.includes(action),action);
  }
  assert.match(atlas,/\{#each guardedSurfaceMasks as rect\}/);
  assert.match(atlas,/pendingSurfaceMask/);
  assert.doesNotMatch(atlas,/\binvoke\s*\(|rust_editor_apply|localStorage|paint_texture_brush/);
});
