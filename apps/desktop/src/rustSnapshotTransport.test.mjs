// TEST_AUTHORED_NOT_RUN: local/CI hold is active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canReusePreviewInCommand, isPreviewTransportFailure, reconcileTexturePreview } from './rustSnapshotTransport.ts';
const base={epoch:1,revision:0,previewSourceKey:'k',previewSourcesReused:false,
 textureNames:['atlas'],texturePreviewSources:['data:image/png;base64,QUJD']};

test('only exact prior epoch and native texture key can reuse image payload',()=>{
 const incoming={...base,revision:1,previewSourcesReused:true,texturePreviewSources:[]};
 const next=reconcileTexturePreview(base,incoming);
 assert.deepEqual(next.texturePreviewSources,base.texturePreviewSources);
 assert.equal(next.previewSourcesReused,false);
 assert.deepEqual(incoming.texturePreviewSources,[]);
});

test('missing, stale, extra or partial bodies never silently reuse',()=>{
 const incoming={...base,revision:1,previewSourcesReused:true,texturePreviewSources:[]};
 const cases=[
  [null,incoming],
  [base,{...incoming,epoch:2}],
  [base,{...incoming,previewSourceKey:'different'}],
  [base,{...incoming,texturePreviewSources:['forged']}],
  [{...base,texturePreviewSources:[]},incoming],
 ];
 for(const [previous,wire] of cases)assert.throws(
   ()=>reconcileTexturePreview(previous,wire),/RUST_EDITOR_PREVIEW_REUSE_STALE/);
 assert.throws(()=>reconcileTexturePreview(base,{...base,texturePreviewSources:[]}),
   /RUST_EDITOR_PREVIEW_SOURCES_INCOMPLETE/);
});

test('full snapshot preserves intentionally missing PNG sources',()=>{
 const full={...base,texturePreviewSources:[null]};
 assert.equal(reconcileTexturePreview(null,full),full);
});

test('only exact preview transport errors qualify for a full read-only Rust refresh', () => {
  assert.equal(isPreviewTransportFailure(new Error('RUST_EDITOR_PREVIEW_REUSE_STALE')), true);
  assert.equal(isPreviewTransportFailure(new Error('RUST_EDITOR_PREVIEW_SOURCES_INCOMPLETE')), true);
  for (const unrelated of [
    new Error('DOCUMENT_REVISION_STALE'),
    new Error('RUST_EDITOR_SOURCE_CHANGED'),
    new Error('RUST_EDITOR_PREVIEW_REUSE_STALE_OTHER'),
    'RUST_EDITOR_PREVIEW_REUSE_STALE',
    null,
  ]) assert.equal(isPreviewTransportFailure(unrelated), false);
});

// This is a source contract, NOT native execution proof.
test('a rejected preview response cannot trigger another Rust mutation', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('./RustEditorPage.svelte', import.meta.url), 'utf8');
  const handler = source.slice(
    source.indexOf("if (isPreviewTransportFailure(cause))"),
    source.indexOf("async function load()"));
  assert.match(handler, /invoke<EditorSnapshot \| null>\('rust_editor_snapshot'\)/);
  assert.doesNotMatch(handler, /invoke<EditorSnapshot>\('rust_editor_apply'/);
  assert.doesNotMatch(handler, /invoke<EditorSnapshot>\('rust_editor_undo'/);
});

test('only implemented Rust snapshot-returning commands receive the PNG reuse hint', () => {
  for (const supported of [
    'rust_editor_apply', 'rust_editor_undo', 'rust_editor_redo',
    'rust_editor_add_cube', 'rust_editor_duplicate_cube',
    'rust_editor_add_bone', 'rust_editor_create_animation',
    'rust_editor_add_rotation_keyframe',
  ]) assert.equal(canReusePreviewInCommand(supported), true);
  for (const unsupported of [
    'rust_editor_open', 'rust_editor_new', 'rust_editor_save_copy',
    'rust_editor_import_paint_png', 'rust_editor_export_bedrock_geometry',
    'rust_editor_snapshot', 'unknown',
  ]) assert.equal(canReusePreviewInCommand(unsupported), false);
});
