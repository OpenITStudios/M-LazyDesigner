// TEST_AUTHORED_NOT_RUN: local/CI hold is active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileTexturePreview } from './rustSnapshotTransport.ts';
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
