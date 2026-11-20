// SOURCE_AUTHORED_NOT_RUN: static source guards, not compiled/native evidence.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=(p)=>readFile(new URL(p,import.meta.url),'utf8');
test('Animation presentation retains parent-owned Rust edits, playback and selection',async()=>{
  const [parent,child]=await Promise.all([read('./RustEditorPage.svelte'),read('./RustAnimationWorkspace.svelte')]);
  assert.match(parent,/<RustAnimationWorkspace\b/);
  assert.match(parent,/bind:newAnimationName/);
  assert.match(parent,/bind:animationTime/);
  assert.match(parent,/onSelectAnimation=\{selectAnimationForWorkspace\}/);
  assert.match(parent,/function selectAnimationForWorkspace\(uuid:string\)/);
  for(const action of ['setSelectedAnimationLength','createAnimation','addTransformKeyframe',
    'updateTransformKeyframe','removeTransformKeyframe']){
    assert.match(parent,new RegExp('(?:async )?function '+action+'\\('));
  }
  assert.match(child,/aria-label="Rust animation keyframe editor"/);
  assert.match(child,/aria-label="Bone transform keyframe timeline"/);
  assert.match(child,/onclick=\{\(\) => onSelectAnimation\(animation.uuid\)\}/);
  assert.match(child,/bind:value=\{animationTime\}/);
  assert.match(child,/!selectedAnimation.previewSupported/);
  assert.match(child,/setSelectedAnimationLength\(event.currentTarget\)/);
  assert.doesNotMatch(child,/@tauri-apps|\binvoke\s*\(|localStorage|createCodeModeHost|rust_editor_apply/);
});
test('Texture list and dock delegate mutations and state to parent',async()=>{
  const [parent,child]=await Promise.all([read('./RustEditorPage.svelte'),read('./RustTexturesDock.svelte')]);
  assert.match(parent,/<RustTexturesDock\b/);
  assert.match(parent,/onSelectTexture=\{selectPaintTexture\}/);
  assert.match(parent,/function selectPaintTexture\(index:number\)/);
  assert.match(parent,/clearSemanticPreview\(\);\s*clearSurfaceProtection\(\);\s*selectedTexturePreview = null/);
  assert.match(child,/aria-label="Textures panel"/);
  assert.match(child,/onclick=\{\(\) => onSelectTexture\(index\)\}/);
  assert.match(child,/disabled=\{selectionLocked\}/);
  assert.match(child,/onclick=\{onRestore\}/);
  assert.doesNotMatch(child,/@tauri-apps|\binvoke\s*\(|localStorage|createCodeModeHost|rust_editor_apply|clearSemanticPreview/);
});
