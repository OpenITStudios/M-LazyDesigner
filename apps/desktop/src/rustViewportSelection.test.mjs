// SOURCE-AUTHORED_NOT_RUN: repository local/CI test hold remains active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { cubeSelectionColors, selectionTargetIds } from './rustViewportSelection.ts';

test('selection updates highlight without changing base colors or geometry data', () => {
  const base = { uuid: 'cube-a', color: 0x7b8ca1, from: [0, 0, 0], to: [4, 4, 4] };
  const before = JSON.stringify(base);
  assert.deepEqual(cubeSelectionColors('cube-a', 'cube-a', base.color), {
    untextured: 0x80b8ef, outline: 0xf8fafc,
  });
  assert.deepEqual(cubeSelectionColors('cube-a', 'cube-b', base.color), {
    untextured: base.color, outline: 0x46535f,
  });
  assert.deepEqual(cubeSelectionColors('cube-a', null, base.color), {
    untextured: base.color, outline: 0x46535f,
  });
  assert.equal(JSON.stringify(base), before);
});

test('viewport selection reaction is separate from geometry and texture rebuild reaction', async () => {
  const source = await readFile(new URL('./RustViewport.svelte', import.meta.url), 'utf8');
  assert.match(source, /\$: if \(ready\) rebuild\(cubes, bones, hierarchy,/);
  assert.match(source, /updateSelection\(selectedId\);/);
  assert.doesNotMatch(source, /\$: if \(ready\) rebuild\(cubes, bones, hierarchy, selectedId/);
});

test('selection changes touch only previous and current Cube, not every projected Cube', () => {
  assert.deepEqual(selectionTargetIds(null, 'a'), ['a']);
  assert.deepEqual(selectionTargetIds('a', 'b'), ['a', 'b']);
  assert.deepEqual(selectionTargetIds('b', null), ['b']);
  assert.deepEqual(selectionTargetIds('a', 'a'), []);
  assert.deepEqual(selectionTargetIds(null, null), []);
  const base = 0x99aabb;
  assert.equal(cubeSelectionColors('a', 'b', base).untextured, base);
  assert.equal(cubeSelectionColors('b', 'b', base).outline, 0xf8fafc);
});

test('GPU scene reconstructs selection index, while raycast keeps its complete list', async () => {
  const source = await readFile(new URL('./RustViewport.svelte', import.meta.url), 'utf8');
  assert.match(source, /meshesByCube\.set\(cube\.uuid, mesh\)/);
  assert.match(source, /meshesByCube = new Map\(\)/);
  assert.match(source, /renderedSelection = null/);
  assert.match(source, /ray\.intersectObjects\(pickMeshes, false\)/);
});
