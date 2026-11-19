// SOURCE_AUTHORED_NOT_RUN. No native WebView2 transfer tests executed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {matchingSelectedTexturePreview,selectedTexturePreviewSources}
  from './rustSelectedTexturePreview.ts';
const preview={epoch:4,revision:7,textureIndex:1,
  textureUuid:'atlas-2',textureSource:'data:image/png;base64,AAAABBBB',
  textureResolution:[2048,2048],sourceAuthority:'RUST_VALIDATED_EMBEDDED_PNG',
  writeAuthority:'NOT_GRANTED',previewScope:'SELECTED_PROJECT_ATLAS_ONLY'};
const snapshot={epoch:4,revision:7,scopedTexturePreview:false,
  textureNames:['atlas-1','atlas-2'],
  textureUuids:['atlas-1','atlas-2'],
  textureResolution:[2048,2048],
  texturePreviewSources:['data:image/png;base64,AAABBB',null]};
test('on-demand viewport source is exactly one current selected atlas',()=>{
  assert.equal(matchingSelectedTexturePreview(snapshot,preview,1),true);
  assert.deepEqual(selectedTexturePreviewSources(snapshot,preview,1),[
    snapshot.texturePreviewSources[0],preview.textureSource]);
  assert.equal(snapshot.texturePreviewSources[1],null);
  assert.equal(matchingSelectedTexturePreview(snapshot,preview,0),false);
  assert.equal(matchingSelectedTexturePreview(snapshot,{...preview,revision:8},1),false);
  assert.equal(matchingSelectedTexturePreview({...snapshot,scopedTexturePreview:true},
    preview,1),false);
  assert.equal(matchingSelectedTexturePreview({...snapshot,textureResolution:[4096,4096]},
    preview,1),false);
});
