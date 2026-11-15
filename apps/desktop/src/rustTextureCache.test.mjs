// Node 24 source-authored tests; NOT_EXECUTED under repository hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveTextureRequest } from './rustTextureCache.ts';

test('stale load cannot evict a newer cache entry for the same PNG source', () => {
  const previous = { source: 'data:image/png;base64,same', texture: {} };
  const current = { source: previous.source, texture: {} };
  const cache = new Map([[0, current]]);
  assert.equal(isActiveTextureRequest(cache, 0, previous), false);
  assert.equal(isActiveTextureRequest(cache, 0, current), true);
  assert.deepEqual(cache.get(0), current);
});

test('removed or replaced texture entry ignores old asynchronous callbacks', () => {
  const original = { source: 'one', texture: {} };
  const cache = new Map([[1, original]]);
  cache.delete(1);
  assert.equal(isActiveTextureRequest(cache, 1, original), false);
  cache.set(1, { source: 'two', texture: {} });
  assert.equal(isActiveTextureRequest(cache, 1, original), false);
  assert.equal(isActiveTextureRequest(cache, 0, original), false);
});

test('only an active texture load may schedule its result after Paint and Undo', () => {
  const current = new Map();
  const first = { source: 'rgba-a', texture: {} };
  let frames = 0;
  const completed = (entry) => {
    if (isActiveTextureRequest(current, 0, entry)) frames++;
  };
  current.set(0, first);
  const second = { source: 'rgba-b', texture: {} };
  current.set(0, second);
  completed(first);
  assert.equal(frames, 0);
  completed(second);
  assert.equal(frames, 1);

  // An Undo can restore an identical encoded PNG, but its request identity
  // differs from a previously disposed GPU resource.
  const restored = { source: first.source, texture: {} };
  current.set(0, restored);
  completed(first);
  assert.equal(frames, 1);
  completed(restored);
  assert.equal(frames, 2);
  current.clear();
  completed(restored);
  assert.equal(frames, 2);
});
