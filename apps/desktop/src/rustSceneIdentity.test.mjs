// SOURCE-AUTHORED_NOT_RUN: repository local/CI test hold remains active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canRefreshPaintSources, sameSceneInputs } from './rustSceneIdentity.ts';

test('same geometry and texture bytes reuse derived scene across new IPC object identities', () => {
  const first = { structure:'cube,uv,bones', sources:['data:image/png;base64,A', null] };
  assert.equal(sameSceneInputs(null, first), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:[...first.sources] }), true);
  assert.equal(sameSceneInputs(first, { structure:'cube,moved,uv,bones', sources:[...first.sources] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:['data:image/png;base64,B', null] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:['data:image/png;base64,A'] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:[null, null] }), false);
});

test('scene matching is non-mutating and a stale texture completion cannot be accepted by a matching key', () => {
  const prior = { structure:'cube', sources:['rgba-a'] };
  const before = JSON.stringify(prior);
  assert.equal(sameSceneInputs(prior, { structure:'cube', sources:['rgba-b'] }), false);
  assert.equal(JSON.stringify(prior), before);
});

test('only existing embedded PNG replacements use the material-only scene path', () => {
  const old = { structure:'cube-uv-bone-identity', sources:['png-A','png-B',null] };
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A2','png-B',null]}),true);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A2','png-B2',null]}),true);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:[...old.sources]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:'cube-position-changed',sources:['png-A2','png-B',null]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A',null,null]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A','png-B','png-new']}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A']}),false);
  assert.equal(canRefreshPaintSources(null,old),false);
});

test('material-only refresh keeps native structure and falls back on any other change', async () => {
  const {readFile} = await import('node:fs/promises');
  const text = await readFile(new URL('./RustViewport.svelte',import.meta.url),'utf8');
  assert.match(text,/if \(refreshPaintSources\(identity\)\) return;/);
  assert.match(text,/material\.userData\.previewTextureIndex/);
  assert.match(text,/reconcileTextures\(\);/);
  assert.match(text,/material\.needsUpdate = true;/);
  assert.match(text,/material\.side = previewRenderSide\(texture \? texturePreviewSides\[index\] : null\)/);

});
