// SOURCE_AUTHORED_NOT_RUN; no Node, Windows or native test performed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchingExternalTextureCandidate,externalTextureViewportSources}
  from './rustExternalTexturePreview.ts';
import {semanticReviewReady,matchingRenderedMaterialPair}
  from './rustSemanticMaterialPreview.ts';
const snapshot={epoch:4,revision:9,
 textureUuids:['a','b'],
 texturePreviewSources:['data:image/png;base64,AAAA','data:image/png;base64,BBBB']};
const intent={expected_revision:9,cube_uuid:'cube',texture_uuid:'b',
 face:'north',source_base_rgba:[80,90,110,255],
 protected_regions:[],expected_before_pixels:[]};
const candidate={epoch:4,revision:9,sourceModelSha256:'1'.repeat(64),
 candidateSha256:'2'.repeat(64),selectedPngSha256:'3'.repeat(64),
 cubeUuid:'cube',textureUuid:'b',textureIndex:1,face:'north',intent,
 candidatePngSource:'data:image/png;base64,CCCC',
 previewScope:'RUST_THREEJS_EPHEMERAL_CANDIDATE',
 visualVerdict:'UNVERIFIED',writeAuthority:'NOT_GRANTED'};
test('external overlay changes one texture, not the original snapshot',()=>{
  assert.equal(matchingExternalTextureCandidate(snapshot,candidate,'cube','north',1),true);
  const old=snapshot.texturePreviewSources;
  const overlay=externalTextureViewportSources(snapshot,candidate,true,true,old);
  assert.deepEqual(overlay,[old[0],candidate.candidatePngSource]);
  assert.equal(snapshot.texturePreviewSources[1],old[1]);
  assert.strictEqual(externalTextureViewportSources(snapshot,candidate,false,true,old),old);
});
test('stale selection, identity, source and forged approval are refused',()=>{
  const bad=[
    [ {...snapshot,epoch:6},candidate,'cube','north',1 ],
    [ {...snapshot,revision:10},candidate,'cube','north',1 ],
    [ snapshot,candidate,'other','north',1 ],
    [ snapshot,candidate,'cube','south',1 ],
    [ snapshot,candidate,'cube','north',0 ],
    [ snapshot,{...candidate,intent:{...intent,texture_uuid:'a'}},'cube','north',1 ],
    [ snapshot,{...candidate,writeAuthority:'GRANTED'},'cube','north',1 ],
    [ snapshot,{...candidate,sourceModelSha256:'bad'},'cube','north',1 ],
    [ snapshot,{...candidate,candidatePngSource:'bad'},'cube','north',1 ],
  ];
  for(const input of bad)assert.equal(matchingExternalTextureCandidate(...input),false);
});
test('external material Apply requires real matched render and acknowledgment',()=>{
  const source='data:image/png;base64,'+'A'.repeat(60);
  const changed='data:image/png;base64,'+'B'.repeat(60);
  assert.equal(semanticReviewReady(
    matchingRenderedMaterialPair(source,changed,'front','front'),true,true,true),true);
  assert.equal(semanticReviewReady(
    matchingRenderedMaterialPair(source,changed,'front','back'),true,true,true),false);
  assert.equal(semanticReviewReady(
    matchingRenderedMaterialPair(source,source,'front','front'),true,true,true),false);
  assert.equal(semanticReviewReady(true,true,true,false),false);
});
