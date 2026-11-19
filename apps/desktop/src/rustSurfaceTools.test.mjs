// SOURCE_AUTHORED_NOT_RUN: UI projections/selection are not write authority.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseShadeRamp,bindSourceSelection,
  selectionSeedForStroke} from './rustSurfaceTools.ts';
test('a ramp uses exact user colors, no fixed 8/16/32 swatch ceiling',()=>{
  const shades=Array.from({length:48},(_,i)=>
    '#'+[i,50+i,100+i].map(n=>n.toString(16).padStart(2,'0')).join(''));
  assert.equal(parseShadeRamp(shades.join(', ')).length,48);
  assert.equal(parseShadeRamp('#010203,#010203'),null);
  assert.equal(parseShadeRamp('#10203'),null);
  assert.equal(parseShadeRamp('#112233'),null);
});
test('source selection binds full native identity and cannot silently detach',()=>{
  const hit={cubeUuid:'cube',textureUuid:'texture',
    face:'north',epoch:2,revision:3,sourceUv:[0,0,4,4],
    sourceRotation:0,texel:[0,0],textureIndex:0,size:[4,4],contextKey:'a'};
  const result={revision:3,cube_uuid:'cube',texture_uuid:'texture',
    face:'north',seed:[0,0],source_rgba:[100,120,130,255],
    pixel_count:2,atlas_rows:[{y:0,x0:0,x1:2}],
    source_authority:'RUST_SAVED_RGBA8',write_authority:'NOT_GRANTED'};
  const selection=bindSourceSelection(hit,result,128,128);
  assert.equal(selection.pixelCount,2);
  assert.deepEqual(selectionSeedForStroke(selection,hit),[0,0]);
  assert.equal(selectionSeedForStroke(selection,{...hit,revision:4}),null);
  assert.equal(selectionSeedForStroke(selection,{...hit,face:'east'}),null);
  assert.equal(bindSourceSelection(hit,{...result,pixel_count:3},128,128),null);
});
