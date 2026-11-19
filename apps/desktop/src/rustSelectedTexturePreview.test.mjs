// SOURCE_AUTHORED_NOT_RUN. Source identity reuse is not GPU/native proof.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchingSelectedTexturePreview,selectedTexturePreviewSources,
  bindSelectedTexturePreview} from './rustSelectedTexturePreview.ts';
const digest='a'.repeat(64);
const preview={epoch:4,revision:7,textureIndex:1,
  textureUuid:'atlas-2',textureSource:'data:image/png;base64,AAAABBBB',
  sourceSha256:digest,sourceReused:false,
  textureResolution:[2048,2048],sourceAuthority:'RUST_VALIDATED_EMBEDDED_PNG',
  writeAuthority:'NOT_GRANTED',previewScope:'SELECTED_PROJECT_ATLAS_ONLY'};
const snapshot={epoch:4,revision:7,scopedTexturePreview:false,
  textureNames:['atlas-1','atlas-2'],textureUuids:['atlas-1','atlas-2'],
  textureResolution:[2048,2048],
  texturePreviewSources:['data:image/png;base64,AAABBB',null]};
test('manual selection projects exactly one current atlas',()=>{
  assert.equal(matchingSelectedTexturePreview(snapshot,preview,1),true);
  assert.deepEqual(selectedTexturePreviewSources(snapshot,preview,1),[
    snapshot.texturePreviewSources[0],preview.textureSource]);
  assert.equal(snapshot.texturePreviewSources[1],null);
  assert.equal(matchingSelectedTexturePreview(snapshot,preview,0),false);
  assert.equal(matchingSelectedTexturePreview({...snapshot,scopedTexturePreview:true},
    preview,1),false);
});
test('unchanged Rust source key reuses preview across revisions without payload',()=>{
  const current={...snapshot,revision:8};
  const reused={...preview,revision:8,textureSource:null,sourceReused:true};
  const next=bindSelectedTexturePreview(current,reused,preview,1);
  assert.equal(next?.textureSource,preview.textureSource);
  assert.equal(next?.revision,8);
  assert.equal(bindSelectedTexturePreview(current,
    {...reused,sourceSha256:'b'.repeat(64)},preview,1),null);
  assert.equal(bindSelectedTexturePreview(current,
    {...reused,epoch:9},preview,1),null);
  assert.equal(bindSelectedTexturePreview(current,
    {...reused,textureUuid:'other'},preview,1),null);
  assert.equal(bindSelectedTexturePreview(current,
    {...reused,sourceReused:false},preview,1),null);
});
