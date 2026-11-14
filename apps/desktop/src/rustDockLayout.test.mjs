// Source-authored Node 24 TypeScript regression cases; NOT_EXECUTED.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultDockLayout, restoreDockLayout, serializeDockLayout,
  swapDockSides, setDockHidden, setInspectorSplit, measureDocks, resizeDock,
  DOCK_RAIL, MIN_VIEWPORT, DOCK_SPLITTER,
  LEGACY_DOCK_LAYOUT_KEY, LEGACY_DOCK_LAYOUT_V2_KEY, RUST_DOCK_LAYOUT_KEY,
  attachDockTabs, detachDockTabs, selectDockTab, floatDock, dockPanel,
  moveFloat, resizeFloat, measureFloatRect, dropSideForPointer, dockSide,
  crossedDragThreshold,
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


test('legacy v1 layout migrates to v3 without losing dock order or sizes', () => {
  const legacy = {
    version: 1, leftPanel: 'inspector', leftWidth: 230, rightWidth: 260,
    hidden: { textures: true, inspector: false }, inspectorSplit: 64,
  };
  const migrated = restoreDockLayout(JSON.stringify(legacy));
  assert.equal(migrated?.version, 3);
  assert.equal(migrated?.leftPanel, 'inspector');
  assert.equal(migrated?.rightWidth, 260);
  assert.equal(migrated?.hidden.textures, true);
  assert.equal(migrated?.floating.textures, null);
  assert.equal(migrated?.inspectorSplit, 64);
  assert.equal(migrated?.attachedSide, null);
  assert.equal(migrated?.activeAttached, 'textures');
  assert.notEqual(LEGACY_DOCK_LAYOUT_KEY, RUST_DOCK_LAYOUT_KEY);
});

test('floating one real panel replaces its dock content with a return rail', () => {
  const baseline = defaultDockLayout();
  const floated = floatDock(baseline, 'textures', 980, 600);
  const measured = measureDocks(floated, 980);
  assert.ok(floated.floating.textures);
  assert.equal(floated.floating.inspector, null);
  assert.equal(measured.leftHidden, true);
  assert.equal(measured.leftWidth, DOCK_RAIL);
  assert.deepEqual(baseline.floating, { textures: null, inspector: null });
  assert.deepEqual(restoreDockLayout(serializeDockLayout(floated)), floated);
});

test('reattaching to occupied side swaps dock order but never duplicates a panel', () => {
  const floated = floatDock(defaultDockLayout(), 'textures', 980, 600);
  const attached = dockPanel(floated, 'textures', 'right');
  assert.equal(attached.floating.textures, null);
  assert.equal(dockSide(attached, 'textures'), 'right');
  assert.equal(dockSide(attached, 'inspector'), 'left');
  assert.equal(measureDocks(attached, 980).rightHidden, false);
  assert.equal(measureDocks(attached, 980).leftHidden, false);
});

test('moving/resizing floating windows stays within the editor viewport', () => {
  const floated = floatDock(defaultDockLayout(), 'inspector', 820, 450);
  const moved = moveFloat(floated, 'inspector', 3000, 5000, 820, 450);
  const rect = moved.floating.inspector;
  assert.ok(rect);
  assert.ok(rect.x + rect.width <= 820);
  assert.ok(rect.y + rect.height <= 450);
  const larger = resizeFloat(moved, 'inspector', 1500, 1400, 820, 450);
  const next = larger.floating.inspector;
  assert.ok(next);
  assert.ok(next.width <= 820 && next.height <= 450);
  assert.ok(next.x + next.width <= 820 && next.y + next.height <= 450);
  assert.equal(moveFloat(moved, 'inspector', Number.NaN, 0, 820, 450), moved);
  assert.equal(resizeFloat(moved, 'inspector', 0, Number.NaN, 820, 450), moved);
  assert.ok(measureFloatRect({x:900,y:900,width:300,height:300},820,450).x <= 520);
});

test('dock drop targets require a real bounded pointer inside the editor', () => {
  assert.equal(dropSideForPointer(20, 980), 'left');
  assert.equal(dropSideForPointer(970, 980), 'right');
  assert.equal(dropSideForPointer(490, 980), null);
  assert.equal(dropSideForPointer(-2, 980), null);
  assert.equal(dropSideForPointer(100, Number.POSITIVE_INFINITY), null);
});

test('untrusted v3 persistence rejects future versions and malformed float geometry', () => {
  const base = defaultDockLayout();
  const floated = floatDock(base, 'inspector', 980, 600);
  const invalid = [
    { ...floated, version: 4 },
    { ...floated, floating: { ...floated.floating, inspector: { x: -3, y: 0, width: 300, height: 250 } } },
    { ...floated, floating: { ...floated.floating, inspector: { x: 0, y: 0, width: 99999, height: 250 } } },
    { ...floated, hidden: { ...floated.hidden, inspector: true } },
    { ...floated, floating: { ...floated.floating, inspector: 'javascript:bad' } },
  ];
  for (const value of invalid) assert.equal(restoreDockLayout(JSON.stringify(value)), null);
});

test('folding a floating panel closes the float and keeps restore affordance', () => {
  const floated = floatDock(defaultDockLayout(), 'textures', 980, 600);
  const hidden = setDockHidden(floated, 'textures', true);
  assert.equal(hidden.floating.textures, null);
  assert.equal(hidden.hidden.textures, true);
  assert.equal(measureDocks(hidden, 980).leftWidth, DOCK_RAIL);
});

test('a plain title click and incidental pointer noise never docks a floating panel', () => {
  assert.equal(crossedDragThreshold(0, 0), false);
  assert.equal(crossedDragThreshold(3, 4), false);
  assert.equal(crossedDragThreshold(8, 0), true);
  assert.equal(crossedDragThreshold(Number.NaN, 9), false);
  assert.equal(crossedDragThreshold(0, Infinity), false);
});


test('legacy v2 floating preferences migrate to v3 without discarding geometry', () => {
  const v2 = {
    version: 2, leftPanel: 'inspector', leftWidth: 230, rightWidth: 270,
    hidden: { textures: false, inspector: false }, inspectorSplit: 35,
    floating: { textures: { x: 20, y: 12, width: 280, height: 340 }, inspector: null },
  };
  const migrated = restoreDockLayout(JSON.stringify(v2));
  assert.equal(migrated?.version, 3);
  assert.equal(migrated?.attachedSide, null);
  assert.equal(migrated?.floating.textures.width, 280);
  assert.equal(migrated?.inspectorSplit, 35);
  assert.deepEqual(restoreDockLayout(serializeDockLayout(migrated)), migrated);
  assert.notEqual(LEGACY_DOCK_LAYOUT_V2_KEY, RUST_DOCK_LAYOUT_KEY);
});

test('attached tabs keep one active panel and free the opposite dock slot', () => {
  const original = defaultDockLayout();
  const tabs = attachDockTabs(original, 'right');
  assert.equal(tabs.attachedSide, 'right');
  assert.equal(tabs.activeAttached, 'inspector');
  assert.equal(measureDocks(tabs, 1100).leftWidth, DOCK_RAIL);
  assert.ok(measureDocks(tabs, 1100).rightWidth >= 160);
  assert.equal(measureDocks(tabs, 1100).rightHidden, false);
  assert.equal(tabs.floating.textures, null);
  assert.equal(tabs.floating.inspector, null);
  assert.deepEqual(restoreDockLayout(serializeDockLayout(tabs)), tabs);
  assert.equal(original.attachedSide, null);
});

test('tab selection changes only layout and reverses cleanly', () => {
  const original = defaultDockLayout();
  const tabs = attachDockTabs(original, 'left');
  const selected = selectDockTab(tabs, 'inspector');
  assert.equal(selected.activeAttached, 'inspector');
  assert.equal(selected.attachedSide, 'left');
  assert.equal(selectDockTab(selected, 'inspector'), selected);
  assert.equal(detachDockTabs(selected).leftPanel, 'textures');
  assert.equal(detachDockTabs(selected).attachedSide, null);
  assert.deepEqual(detachDockTabs(original), original);
  assert.deepEqual(selectDockTab(original, 'inspector'), original);
});

test('attaching from float and fold explicitly restores both real panels', () => {
  let layout = setDockHidden(defaultDockLayout(), 'inspector', true);
  layout = floatDock(layout, 'textures', 1050, 650);
  const tabs = attachDockTabs(layout, 'left');
  assert.equal(tabs.hidden.inspector, false);
  assert.equal(tabs.hidden.textures, false);
  assert.equal(tabs.floating.textures, null);
  assert.equal(tabs.attachedSide, 'left');
  assert.equal(setDockHidden(tabs, 'textures', true).attachedSide, null);
  assert.equal(floatDock(tabs, 'textures', 1050, 650).attachedSide, null);
  assert.equal(dockPanel(tabs, 'textures', 'right').attachedSide, null);
});

test('swapping attached dock side preserves tab selection and model-free widths', () => {
  const tabs = selectDockTab(attachDockTabs(defaultDockLayout(), 'right'), 'textures');
  const swapped = swapDockSides(tabs);
  assert.equal(swapped.attachedSide, 'left');
  assert.equal(swapped.activeAttached, 'textures');
  assert.equal(swapped.leftWidth, tabs.leftWidth);
  assert.deepEqual(swapDockSides(swapped), tabs);
});

test('malformed attached tab storage fails closed', () => {
  const tabs = attachDockTabs(defaultDockLayout(), 'left');
  const invalid = [
    { ...tabs, attachedSide: 'bottom' },
    { ...tabs, activeAttached: 'unknown' },
    { ...tabs, hidden: { textures: true, inspector: false } },
    { ...tabs, floating: { textures: {x: 0, y: 0, width: 230, height: 220}, inspector: null } },
    { ...tabs, attachedSide: undefined },
    { ...tabs, version: 5 },
  ];
  for (const value of invalid) assert.equal(restoreDockLayout(JSON.stringify(value)), null);
});
