// SOURCE_AUTHORED_NOT_RUN: UI projections/selection are not write authority.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseShadeRamp,bindSourceSelection,
  selectionSeedForStroke,selectionStepsForStroke} from './rustSurfaceTools.ts';
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

// SOURCE_AUTHORED_NOT_RUN: malformed overlap row markers cannot masquerade
// as a clean unique selection overlay, even with the expected pixel count.
test('selection receipt rejects unordered or overlapping row spans',()=>{
  const hit={cubeUuid:'a',textureUuid:'texture',face:'north',
    epoch:1,revision:2,sourceUv:[0,0,4,4],sourceRotation:0,
    texel:[0,0],textureIndex:0,size:[4,4],contextKey:'key'};
  const receipt={revision:2,cube_uuid:'a',texture_uuid:'texture',
    face:'north',seed:[0,0],source_rgba:[80,100,110,255],
    pixel_count:4,atlas_rows:[{y:0,x0:0,x1:2},{y:0,x0:1,x1:3}],
    source_authority:'RUST_SAVED_RGBA8',write_authority:'NOT_GRANTED'};
  assert.equal(bindSourceSelection(hit,receipt,16,16),null);
});

// SOURCE_AUTHORED_NOT_RUN: preview capacity never caps selected pixels.
test('compound selection is source-bound and omits complex overlays safely',()=>{
  const hit={cubeUuid:'cube',textureUuid:'texture',face:'north',epoch:2,
    revision:3,sourceUv:[0,0,2048,2048],sourceRotation:0,texel:[0,0],
    textureIndex:0,size:[2048,2048],contextKey:'base'};
  const steps=[{mode:'replace',seed:[0,0]},{mode:'add',seed:[1,1]},
    {mode:'invert'}];
  const response={revision:3,cube_uuid:'cube',texture_uuid:'texture',
    face:'north',seed:[0,0],source_rgba:[100,120,130,255],
    pixel_count:3000000,atlas_rows:[],preview_complete:false,
    selection_steps:steps,source_authority:'RUST_SAVED_RGBA8',
    write_authority:'NOT_GRANTED'};
  const selection=bindSourceSelection(hit,response,2048,2048,steps);
  assert.equal(selection.pixelCount,3000000);
  assert.equal(selection.previewComplete,false);
  assert.equal(selectionStepsForStroke(selection,hit).length,3);
  assert.equal(selectionSeedForStroke(selection,hit),null);
  assert.equal(selectionStepsForStroke(selection,{...hit,revision:4}),null);
  assert.equal(bindSourceSelection(hit,{...response,preview_complete:true},
    2048,2048,steps),null);
  assert.equal(bindSourceSelection(hit,{...response,selection_steps:[{mode:'add',seed:[0,0]}]},
    2048,2048),null);
});
