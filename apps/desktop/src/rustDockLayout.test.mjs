// Source-authored Node 24 TypeScript regression cases; NOT_EXECUTED.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultDockLayout, restoreDockLayout, serializeDockLayout,
  swapDockSides, setDockHidden, setInspectorSplit, measureDocks, resizeDock,
  DOCK_RAIL, MIN_VIEWPORT, DOCK_SPLITTER,
} from './rustDockLayout.ts';

test('default arrangement matches the first Rust Edit source and survives restore', () => {
  const original = defaultDockLayout();
  assert.equal(original.leftPanel, 'textures');
  assert.equal(original.inspectorSplit, 52);
  assert.deepEqual(restoreDockLayout(serializeDockLayout(original)), original);
});

test('switching sides preserves panel visibility, widths, and vertical split', () => {
  const original = setInspectorSplit(setDockHidden(defaultDockLayout(), 'textures', true), 70);
  const swapped = swapDockSides(original);
  assert.equal(swapped.leftPanel, 'inspector');
  assert.equal(swapped.hidden.textures, true);
  assert.equal(swapped.inspectorSplit, 70);
  assert.deepEqual(swapDockSides(swapped), original);
});

test('invalid, future or oversized storage never restores model or unbounded CSS', () => {
  assert.equal(restoreDockLayout(null), null);
  assert.equal(restoreDockLayout('{bad'), null);
  assert.equal(restoreDockLayout('x'.repeat(2050)), null);
  assert.equal(restoreDockLayout('{"version":2}'), null);
  assert.equal(restoreDockLayout('{"version":1,"leftPanel":"float"}'), null);
  assert.equal(restoreDockLayout(serializeDockLayout({ ...defaultDockLayout(), rightWidth: 99999 })), null);
  assert.equal(restoreDockLayout(serializeDockLayout({ ...defaultDockLayout(), inspectorSplit: NaN })), null);
});

test('narrow window preserves visible dock content and model viewport', () => {
  const model = measureDocks(defaultDockLayout(), 780);
  assert.equal(model.leftHidden, false);
  assert.equal(model.rightHidden, false);
  assert.ok(780 - model.leftWidth - model.rightWidth - 2 * DOCK_SPLITTER >= MIN_VIEWPORT);
});

test('explicitly folded panel becomes a reachable small rail', () => {
  const hidden = setDockHidden(defaultDockLayout(), 'textures', true);
  const measured = measureDocks(hidden, 780);
  assert.equal(measured.leftHidden, true);
  assert.equal(measured.leftWidth, DOCK_RAIL);
});

test('bounded splitter and keyboard resizing never alter unrelated panel identity', () => {
  const initial = defaultDockLayout();
  const wider = resizeDock(initial, 'right', 400, 900);
  assert.ok(wider.rightWidth >= 288);
  assert.equal(wider.leftPanel, initial.leftPanel);
  assert.equal(initial.rightWidth, 288);
  assert.equal(setInspectorSplit(initial, 200).inspectorSplit, 80);
  assert.equal(setInspectorSplit(initial, -10).inspectorSplit, 20);
});

test('hidden dock cannot be resized accidentally', () => {
  const folded = setDockHidden(defaultDockLayout(), 'inspector', true);
  assert.deepEqual(resizeDock(folded, 'right', 400, 1100), folded);
});
