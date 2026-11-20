// TEST_AUTHORED_NOT_RUN: typed Svelte ownership/guard source assertions only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(p,import.meta.url),'utf8');
test('3D Paint toggles and preset UI retain one parent/native authoring owner',async()=>{
  const [page,controls,presets]=await Promise.all([
    read('./RustEditorPage.svelte'),read('./RustSurfacePaintControls.svelte'),
    read('./RustBrushPresetControls.svelte')
  ]);
  assert.match(page,/<RustSurfacePaintControls\b/);
  assert.match(page,/strokeActive=\{!!paintStroke\}/);
  assert.match(page,/selectionDragging=\{!!surfaceMaskDrag\}/);
  assert.match(page,/candidatePending=\{validSemanticPreview \|\| validExternalPreview\}/);
  for(const name of ["surfacePaint3d","surfaceBrushRadius","surfaceBrushTip","surfacePatternMode","surfacePatternPeriod","surfacePatternPhaseX","surfacePatternPhaseY","selectedBrushPresetId","brushPresetName","surfaceGrayscalePreview","surfaceSampleMode","surfaceSelectMode","surfaceSelectOperation","surfaceInkMode","surfaceShadeDirection","surfaceShadeRamp","surfaceSeamEnabled","surfaceSourceBase","surfaceProtectMode"]){
    assert.match(page,new RegExp('bind:'+name+'\\b'));
    assert.match(controls,new RegExp('export let '+name+':'));
  }
  assert.match(controls,/aria-label="Source-bound 3D pixel painting"/);
  assert.match(controls,/if\(surfaceSampleMode\)surfaceSelectMode=false/);
  assert.match(controls,/if\(surfaceSelectMode\)surfaceSampleMode=false/);
  assert.match(controls,/disabled=\{busy \|\| !validSurfaceSelection\}/);
  assert.match(controls,/disabled=\{busy \|\| selectionDragging \|\| !protectedRegionCount\}/);
  assert.match(controls,/surfacePaint3d && !surfacePaintEnabled/);
  assert.match(controls,/<RustBrushPresetControls\b/);
  assert.match(presets,/class="brush-presets"/);
  assert.match(presets,/onclick=\{saveBrushPreset\}/);
  assert.match(presets,/disabled=\{busy \|\| strokeActive\}/);
  assert.match(presets,/No image, Cube identity, selection or Paint permission is stored/);
  for(const component of [controls,presets]){
    assert.doesNotMatch(component,/@tauri-apps|\binvoke\s*\(|rust_editor_apply|\blocalStorage\s*\.|createCodeModeHost/);
  }
  for(const name of ['persistBrushPresets','currentBrushSettings','paintFromViewport',
    'startPaintStroke','finishPaintStroke','invertSurfaceSelection'])
    assert.match(page,new RegExp('(?:async )?function '+name+'\\('));
});
