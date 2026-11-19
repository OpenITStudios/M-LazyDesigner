// SOURCE_AUTHORED_NOT_RUN: alpha-only readback is a view gate, not model data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {atlasAlphaIndex,alphaFromImageData,
  isVisibleAlphaTexel} from './rustVisibleTexel.ts';
test('UV alpha sampling matches bottom-left Three.js origin and raster PNG rows',()=>{
  assert.equal(atlasAlphaIndex([.25,.75],4,4),5);
  assert.equal(atlasAlphaIndex([.25,.25],4,4),13);
  for(const uv of [[0,.5],[1,.5],[.5,0],[.5,1],[-.1,.5],[.5,2]]) {
    assert.equal(atlasAlphaIndex(uv,4,4),null);
  }
});
test('alpha threshold selects deeper face only for actual transparent texels',()=>{
  const rgba=new Uint8ClampedArray(4*4*4);
  rgba[(5*4)+3]=2;rgba[(13*4)+3]=3;
  const mask=alphaFromImageData(rgba,4,4);
  assert.equal(mask.length,16);
  assert.equal(isVisibleAlphaTexel(mask,[.25,.75],4,4),false);
  assert.equal(isVisibleAlphaTexel(mask,[.25,.25],4,4),true);
  assert.equal(isVisibleAlphaTexel(new Uint8Array(4),[.25,.25],4,4),false);
  assert.equal(alphaFromImageData(new Uint8ClampedArray(3),4,4),null);
});

// SOURCE_AUTHORED_NOT_RUN: 2K input guards, not WebView/renderer proof.
test('2048 atlas alpha lookup remains bounded at the last texel',()=>{
  assert.equal(atlasAlphaIndex([2047.5/2048,0.5/2048],2048,2048),2048*2048-1);
  assert.equal(atlasAlphaIndex([.5,.5],4097,2048),null);
  const alpha=new Uint8Array(2048*2048*4);
  alpha[alpha.length-1]=255;
  const mask=alphaFromImageData(new Uint8ClampedArray(alpha),2048,2048);
  assert.equal(mask?.length,2048*2048);
  assert.equal(mask?.[2048*2048-1],255);
});
