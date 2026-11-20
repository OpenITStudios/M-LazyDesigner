// SOURCE_AUTHORED_NOT_RUN: no WebView/Windows test executed.
import assert from 'node:assert/strict';
import test from 'node:test';
import {drawSurfaceSelectionOverlay} from './rustSelectionOverlay.ts';
test('source-bound selection canvas action is read-only and updates view',()=>{
  const calls=[],ctx={clearRect:(...v)=>calls.push(['clear',...v]),
    fillRect:(...v)=>calls.push(['fill',...v]),
    set fillStyle(value){calls.push(['style',value]);}};
  const canvas={width:8,height:8,getContext:k=>k==='2d'?ctx:null};
  const rows=[{y:1,x0:2,x1:4}],before=JSON.stringify(rows);
  const action=drawSurfaceSelectionOverlay(canvas,{rows,width:8,height:8,raster:null});
  assert.deepEqual(calls.filter(v=>v[0]==='fill'),[['fill',2,1,2,1]]);
  assert.equal(JSON.stringify(rows),before);
  action.update({rows:[],width:8,height:8,raster:null});
  assert.equal(calls.filter(v=>v[0]==='fill').length,1);
});
