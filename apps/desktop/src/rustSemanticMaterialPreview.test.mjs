// SOURCE_AUTHORED_NOT_RUN; native/Node tests held by repository profile.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceRgb,matchingSemanticCandidate,semanticViewportSources}
  from './rustSemanticMaterialPreview.ts';
const snapshot={epoch:2,revision:5,
  texturePreviewSources:['data:image/png;base64,QUJD','data:image/png;base64,REVG'],
  textureUuids:['t0','t1']};
const intent={expected_revision:5,reference_png_sha256:'a'.repeat(64),
  cube_uuid:'c0',texture_uuid:'t1',face:'north',material:'painted_metal',
  light_corner:'upper_left',contrast:'subtle',source_base_rgba:[80,90,110,255],
  shadow_rgb:[40,50,60],highlight_rgb:[150,160,180]};
const candidate={epoch:2,revision:5,sourceModelSha256:'b'.repeat(64),
  candidateSha256:'c'.repeat(64),referencePngSha256:'a'.repeat(64),
  cubeUuid:'c0',textureUuid:'t1',textureIndex:1,
  candidatePngSource:'data:image/png;base64,QUJDREVGRw==',
  previewScope:'RUST_THREEJS_EPHEMERAL_CANDIDATE',
  visualVerdict:'UNVERIFIED',writeAuthority:'NOT_GRANTED',intent};
test('candidate overrides exactly one texture on the same authoritative model',()=>{
  assert.equal(matchingSemanticCandidate(snapshot,candidate,
    'c0','north',1,'a'.repeat(64)),true);
  assert.equal(semanticViewportSources(snapshot,candidate,false,true),
    snapshot.texturePreviewSources);
  const overlay=semanticViewportSources(snapshot,candidate,true,true);
  assert.equal(overlay[0],snapshot.texturePreviewSources[0]);
  assert.equal(overlay[1],candidate.candidatePngSource);
  assert.equal(snapshot.texturePreviewSources[1],'data:image/png;base64,REVG');
});
test('stale epoch, revision, selection, reference and forged approval never display',()=>{
  const values=[
    [{...snapshot,epoch:3},candidate,'c0','north',1,'a'.repeat(64)],
    [{...snapshot,revision:6},candidate,'c0','north',1,'a'.repeat(64)],
    [snapshot,candidate,'other','north',1,'a'.repeat(64)],
    [snapshot,candidate,'c0','south',1,'a'.repeat(64)],
    [snapshot,candidate,'c0','north',0,'a'.repeat(64)],
    [snapshot,candidate,'c0','north',1,null],
    [snapshot,{...candidate,writeAuthority:'GRANTED'},'c0','north',1,'a'.repeat(64)],
    [snapshot,{...candidate,candidatePngSource:'invalid'},'c0','north',1,'a'.repeat(64)],
    [snapshot,{...candidate,sourceModelSha256:'missing'},'c0','north',1,'a'.repeat(64)],
  ];
  for(const [s,c,id,face,index,sha] of values) {
    assert.equal(matchingSemanticCandidate(s,c,id,face,index,sha),false);
    assert.equal(semanticViewportSources(s,c,true,false),s.texturePreviewSources);
  }
});
test('UI swatch parsing accepts exact RGB without derived palettes',()=>{
  assert.deepEqual(sourceRgb('#5a6e82'),[90,110,130]);
  assert.equal(sourceRgb('#fff'),null);
  assert.equal(sourceRgb('red'),null);
});
