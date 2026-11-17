// SOURCE-AUTHORED_NOT_RUN: repository local/CI test hold remains active.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sameSceneInputs } from './rustSceneIdentity.ts';

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
