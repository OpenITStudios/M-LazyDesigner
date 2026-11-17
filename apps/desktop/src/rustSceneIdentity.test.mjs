// SOURCE-AUTHORED_NOT_RUN: repository local/CI test hold remains active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canRefreshPaintSources, sceneRenderStructure, sameSceneInputs, singleCubeRotationUpdate } from './rustSceneIdentity.ts';

test('same geometry and texture bytes reuse derived scene across new IPC object identities', () => {
  const first = { structure:'cube,uv,bones', sources:['data:image/png;base64,A', null] };
  assert.equal(sameSceneInputs(null, first), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:[...first.sources] }), true);
  assert.equal(sameSceneInputs(first, { structure:'cube,moved,uv,bones', sources:[...first.sources] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:['data:image/png;base64,B', null] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:['data:image/png;base64,A'] }), false);
  assert.equal(sameSceneInputs(first, { structure:first.structure, sources:[null, null] }), false);
});

test('scene matching is non-mutating and a stale texture completion cannot be accepted by a matching key', () => {
  const prior = { structure:'cube', sources:['rgba-a'] };
  const before = JSON.stringify(prior);
  assert.equal(sameSceneInputs(prior, { structure:'cube', sources:['rgba-b'] }), false);
  assert.equal(JSON.stringify(prior), before);
});

test('only existing embedded PNG replacements use the material-only scene path', () => {
  const old = { structure:'cube-uv-bone-identity', sources:['png-A','png-B',null] };
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A2','png-B',null]}),true);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A2','png-B2',null]}),true);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:[...old.sources]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:'cube-position-changed',sources:['png-A2','png-B',null]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A',null,null]}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A','png-B','png-new']}),false);
  assert.equal(canRefreshPaintSources(old,{structure:old.structure,sources:['png-A']}),false);
  assert.equal(canRefreshPaintSources(null,old),false);
});

test('material-only refresh keeps native structure and falls back on any other change', async () => {
  const {readFile} = await import('node:fs/promises');
  const text = await readFile(new URL('./RustViewport.svelte',import.meta.url),'utf8');
  assert.match(text,/if \(refreshPaintSources\(identity\)\) return;/);
  assert.match(text,/material\.userData\.previewTextureIndex/);
  assert.match(text,/paintMaterialsByTexture\.get\(index\)/);
  assert.match(text,/paintMaterialsByTexture = new Map\(\)/);
  assert.match(text,/paintMaterialsByTexture\.clear\(\)/);
  assert.match(text,/reconcileTextures\(\);/);
  assert.match(text,/material\.needsUpdate = true;/);
  assert.match(text,/material\.side = previewRenderSide\(texture \? texturePreviewSides\[index\] : null\)/);

});

test('render identity ignores Cube/Bone labels and Outliner expansion only', () => {
  const cube = {
    uuid:'cube-a', name:'Old name', from:[0,0,0], to:[2,3,4],
    origin:[0,0,0], rotation:[0,0,0], inflate:0, stretch:[1,1,1],
    visible:true, renderOrder:0, boxUv:false, uvOffset:[0,0], autoUv:0,
    color:2, faces:{north:{uv:[0,0,2,2], texture:'atlas-a'}},
    previewTextureIndex:0,
  };
  const bone = {
    uuid:'bone-a', name:'Body', origin:[0,0,0], rotation:[0,0,0], visible:true,
  };
  const hierarchy=[{uuid:'bone-a',isOpen:true,children:['cube-a']}];
  const options=[['double'],[[16,16]],false,[16,16],0];
  const key=(cubes,bones,nodes,opts=options)=>
    sceneRenderStructure(cubes,bones,nodes,...opts);
  const original=JSON.stringify({cube,bone,hierarchy,options});
  const saved=key([cube],[bone],hierarchy);
  assert.equal(saved,key([{...cube,name:'New name'}],[{...bone,name:'Torso'}],[
    {uuid:'bone-a',isOpen:false,children:['cube-a']},
  ]));
  assert.equal(saved,key([{...cube}],[{...bone}],hierarchy));
  assert.notEqual(saved,key([{...cube,from:[1,0,0]}],[bone],hierarchy));
  assert.notEqual(saved,key([{...cube,faces:{north:{uv:[1,0,2,2],texture:'atlas-a'}}}],[bone],hierarchy));
  assert.notEqual(saved,key([cube],[{...bone,origin:[1,0,0]}],hierarchy));
  assert.notEqual(saved,key([cube],[bone],[{uuid:'bone-a',children:[]}]));
  assert.notEqual(saved,key([cube],[bone],hierarchy,[['front'],[[16,16]],false,[16,16],0]));
  assert.notEqual(saved,key([cube],[bone],hierarchy,[['double'],[[16,16]],false,[16,16],1]));
  assert.equal(JSON.stringify({cube,bone,hierarchy,options}),original);
});


// SOURCE-AUTHORED_NOT_RUN: a single Cube rotation is the only GPU in-place
// update admitted by this derived scene identity. No data-owner mutation.
test('one isolated Cube rotation updates the existing pivot without mesh rebuild', () => {
  const cube = (uuid, rotation=[0,0,0]) => ({
    uuid, name:'Part', from:[0,0,0], to:[2,3,4], origin:[0,0,0],
    rotation, inflate:0, stretch:[1,1,1], visible:true, renderOrder:0,
    boxUv:false, uvOffset:[0,0], autoUv:0, color:1,
    faces:{north:{uv:[0,0,2,2], texture:'atlas'}}, previewTextureIndex:0,
  });
  const bones=[{uuid:'root',name:'Body',origin:[0,0,0],rotation:[0,0,0],visible:true}];
  const hierarchy=[{uuid:'root',children:['A','B']}];
  const toScene=(cs,opts={})=>({
    structure:sceneRenderStructure(cs,opts.bones??bones,
      opts.hierarchy??hierarchy,['double'],[[16,16]],false,[16,16],0),
    sources:opts.sources??['atlas-png'],
  });
  const first=toScene([cube('A'),cube('B')]);
  const rotated=toScene([cube('A',[0,45,0]),cube('B')]);
  assert.deepEqual(singleCubeRotationUpdate(first,rotated),
    {uuid:'A',rotation:[0,45,0]});
  assert.equal(singleCubeRotationUpdate(first,first),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([cube('A',[0,45,0]),cube('B',[0,12,0])])),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([cube('A',[0,45,0]),cube('B')],{sources:['atlas-changed']})),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([cube('A',[0,45,0]),cube('B')],{hierarchy:[{uuid:'root',children:['B','A']}]})),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([cube('A',[0,45,0]),cube('B')],{bones:[{...bones[0],rotation:[10,0,0]}]})),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([{...cube('A',[0,45,0]),from:[1,0,0]},cube('B')])),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([{...cube('A',[0,45,0]),faces:{north:{uv:[1,0,3,2],texture:'atlas'}}},cube('B')])),null);
  assert.equal(singleCubeRotationUpdate(first,
    toScene([cube('A',[0,45,0])])),null);
  assert.equal(singleCubeRotationUpdate({structure:'invalid json',sources:['atlas-png']},rotated),null);
  assert.equal(singleCubeRotationUpdate(null,rotated),null);
});

test('accepted gizmo updates reuse derived scene only on confirmed Rust success', async () => {
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('./RustViewport.svelte',import.meta.url),'utf8');
  assert.match(source,/if \(refreshCubeRotation\(identity\)\) return;/);
  assert.match(source,/if \(!accepted\) projectedScene = null;/);
  assert.match(source,/else if \(edit.op === 'set_cube_rotation'\) accepted = await onRotate/);
  assert.match(source,/pivot.rotation.set\(/);
  assert.match(source,/rebuild\(cubes, bones, hierarchy\);/);
});

test('renderer uses the semantic structure key for selection-independent rebuild', async () => {
  const {readFile} = await import('node:fs/promises');
  const source = await readFile(new URL('./RustViewport.svelte', import.meta.url),'utf8');
  assert.match(source,/structure: sceneRenderStructure\(/);
  assert.doesNotMatch(source,/structure: JSON\.stringify\(\[/);
  assert.match(source,/if \(sameSceneInputs\(projectedScene, identity\)\) return;/);
});
