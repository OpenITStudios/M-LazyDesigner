// SOURCE_AUTHORED_NOT_RUN: Node 24 UI regressions held for PC-local phase.
import assert from 'node:assert/strict';
import test from 'node:test';
import {makeRows,revealOutlinerPath,outlinerParentId,boneContains}
  from './rustOutlinerView.ts';

const hierarchy=[
  {uuid:'root',children:['body',{uuid:'arm',children:['hand']}]},
  'free',
];
const cubes=[
  {uuid:'body',name:'Body',visible:true},
  {uuid:'hand',name:'Hand',visible:false},
  {uuid:'free',name:'Standalone',visible:true},
];
const bones=[
  {uuid:'root',name:'Root',visible:true},
  {uuid:'arm',name:'Arm',visible:false},
];

test('Outliner rows keep original hierarchy depth and visibility without editing source',()=>{
  const initial=JSON.stringify({hierarchy,cubes,bones});
  const rows=makeRows(hierarchy,cubes,bones,new Set());
  assert.deepEqual(rows.map(({uuid,depth,kind,visible})=>({uuid,depth,kind,visible})),[
    {uuid:'root',depth:0,kind:'bone',visible:true},
    {uuid:'body',depth:1,kind:'cube',visible:true},
    {uuid:'arm',depth:1,kind:'bone',visible:false},
    {uuid:'hand',depth:2,kind:'cube',visible:false},
    {uuid:'free',depth:0,kind:'cube',visible:true},
  ]);
  assert.deepEqual(makeRows(hierarchy,cubes,bones,new Set(['root']))
    .map(row=>row.uuid),['root','free']);
  assert.equal(JSON.stringify({hierarchy,cubes,bones}),initial);
});
test('Outliner reveal only expands ancestors of an exact saved UUID',()=>{
  const collapsed=new Set(['root','arm','unrelated']);
  assert.equal(revealOutlinerPath(hierarchy,'hand',collapsed),true);
  assert.deepEqual([...collapsed],['unrelated']);
  assert.equal(revealOutlinerPath(hierarchy,'absent',collapsed),false);
  assert.deepEqual([...collapsed],['unrelated']);
});
test('Outliner parent and bone ancestry remain source-derived and bounded',()=>{
  assert.equal(outlinerParentId(hierarchy,'arm'),'root');
  assert.equal(outlinerParentId(hierarchy,'hand'),'arm');
  assert.equal(outlinerParentId(hierarchy,'free'),'');
  assert.equal(outlinerParentId(hierarchy,'not-found'),'');
  assert.equal(boneContains(hierarchy,'root','arm'),true);
  assert.equal(boneContains(hierarchy,'arm','root'),false);
  assert.equal(boneContains(hierarchy,'root','hand'),false);
});
