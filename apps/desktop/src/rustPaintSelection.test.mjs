// Node 24 source-authored regressions; NOT_EXECUTED under test hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcilePaintTextureSelection } from './rustPaintSelection.ts';

test('a Rust session change clears a same-index selection from another model', () => {
  assert.equal(reconcilePaintTextureSelection(7, 8, 1, 2), 0);
  assert.equal(reconcilePaintTextureSelection(null, 8, 1, 2), 0);
});

test('painting, Undo/Redo and Save Copy preserve selection within one session', () => {
  assert.equal(reconcilePaintTextureSelection(8, 8, 1, 2), 1);
  assert.equal(reconcilePaintTextureSelection(8, 8, 0, 2), 0);
});

test('texture removal or corrupted UI index returns to the first texture', () => {
  assert.equal(reconcilePaintTextureSelection(8, 8, 2, 2), 0);
  assert.equal(reconcilePaintTextureSelection(8, 8, -1, 2), 0);
  assert.equal(reconcilePaintTextureSelection(8, 8, 1.5, 2), 0);
  assert.equal(reconcilePaintTextureSelection(8, 8, 0, 0), 0);
});
