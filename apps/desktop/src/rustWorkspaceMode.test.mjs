// Source-authored Node 24 regressions; NOT_EXECUTED while tests are held.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canChangeWorkspace } from './rustWorkspaceMode.ts';

test('an active model can switch between Edit and Paint when idle', () => {
  assert.equal(canChangeWorkspace(true, false, false, false), true);
});

test('mode navigation does not interrupt pointer capture or Rust transactions', () => {
  assert.equal(canChangeWorkspace(false, false, false, false), false);
  assert.equal(canChangeWorkspace(true, true, false, false), false);
  assert.equal(canChangeWorkspace(true, false, true, false), false);
  assert.equal(canChangeWorkspace(true, false, false, true), false);
  assert.equal(canChangeWorkspace(true, true, true, true), false);
});
