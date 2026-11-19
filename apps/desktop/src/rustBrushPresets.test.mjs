// SOURCE_AUTHORED_NOT_RUN: these helpers never authorize native edits.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planSurfacePattern,readBrushPresets,serializeBrushPresets,
  upsertBrushPreset} from './rustBrushPresets.ts';
const settings={
  radius:3,tip:'diamond',inkMode:'shade_ink',
  shadeRamp:'#111111,#555555,#ffffff',shadeDirection:'lighten',
  patternMode:'dots',patternPeriod:3,patternPhaseX:1,patternPhaseY:2,
};
test('preset roundtrip stores only parameter settings, no bitmap authority',()=>{
  const one=upsertBrushPreset([],'a','Crosshatch',settings);
  const restored=readBrushPresets(serializeBrushPresets(one));
  assert.deepEqual(restored,one);
  assert.equal(Object.hasOwn(restored[0],'sourcePng'),false);
  const edited=upsertBrushPreset(restored,'b','Crosshatch',
    {...settings,patternMode:'diagonal'});
  assert.equal(edited.length,1);
  assert.equal(edited[0].id,'a');
  assert.equal(edited[0].settings.patternMode,'diagonal');
});
test('invalid local-storage versions and settings never enter Paint',()=>{
  assert.deepEqual(readBrushPresets('not json'),[]);
  assert.deepEqual(readBrushPresets('{"schemaVersion":2,"presets":[]}'),[]);
  assert.deepEqual(readBrushPresets(JSON.stringify({schemaVersion:1,
    presets:[{id:'bad',name:'x',settings:{...settings,radius:0}}]})),[]);
  assert.equal(upsertBrushPreset([],'a',' ',settings),null);
  assert.equal(planSurfacePattern('dots',0,0,0),null);
  assert.deepEqual(planSurfacePattern('checker',2,1,2),
    {kind:'checker',period:2,phase:[1,2]});
});
