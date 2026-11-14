// Rust Edit panel layout: UI-only preference, never an asset state owner.
// Blockbench v5.2.1 includes further slots/attachments; the implemented
// subset is left/right grouping plus in-window floating and reattachment.
export type DockPanel = 'textures' | 'inspector';
export type DockSide = 'left' | 'right';
export type FloatRect = { x: number; y: number; width: number; height: number };
export type DockLayout = {
  version: 2;
  leftPanel: DockPanel;
  leftWidth: number;
  rightWidth: number;
  hidden: { textures: boolean; inspector: boolean };
  inspectorSplit: number;
  floating: { textures: FloatRect | null; inspector: FloatRect | null };
};
export type MeasuredDocks = {
  leftPanel: DockPanel;
  rightPanel: DockPanel;
  leftHidden: boolean;
  rightHidden: boolean;
  leftWidth: number;
  rightWidth: number;
  centerMin: number;
};

export const RUST_DOCK_LAYOUT_KEY = 'lazydesigner.rust.edit.docks.v2';
export const LEGACY_DOCK_LAYOUT_KEY = 'lazydesigner.rust.edit.docks.v1';
export const DOCK_SPLITTER = 6;
export const DOCK_RAIL = 30;
export const MIN_DOCK = 160;
export const MAX_DOCK = 520;
export const MIN_VIEWPORT = 320;
export const MIN_FLOAT_WIDTH = 220;
export const MIN_FLOAT_HEIGHT = 160;
export const MAX_FLOAT_WIDTH = 820;
export const MAX_FLOAT_HEIGHT = 760;
const MAX_COORD = 8192;
const MAX_PREFERENCE_BYTES = 2048;

const finite = (value: unknown, lower: number, upper: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lower && value <= upper;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), Math.max(lo, hi));

export function defaultDockLayout(): DockLayout {
  return {
    version: 2, leftPanel: 'textures',
    leftWidth: 210, rightWidth: 288,
    hidden: { textures: false, inspector: false },
    inspectorSplit: 52,
    floating: { textures: null, inspector: null },
  };
}
export function oppositePanel(panel: DockPanel): DockPanel {
  return panel === 'textures' ? 'inspector' : 'textures';
}
export function dockSide(layout: DockLayout, panel: DockPanel): DockSide {
  return layout.leftPanel === panel ? 'left' : 'right';
}

function parseFloatRect(input: unknown): FloatRect | null | undefined {
  if (input === null) return null;
  if (!isRecord(input) ||
      !finite(input.x, 0, MAX_COORD) || !finite(input.y, 0, MAX_COORD) ||
      !finite(input.width, MIN_FLOAT_WIDTH, MAX_FLOAT_WIDTH) ||
      !finite(input.height, MIN_FLOAT_HEIGHT, MAX_FLOAT_HEIGHT)) return undefined;
  return {
    x: Math.round(input.x), y: Math.round(input.y),
    width: Math.round(input.width), height: Math.round(input.height),
  };
}

export function restoreDockLayout(text: string | null): DockLayout | null {
  if (!text || text.length > MAX_PREFERENCE_BYTES) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || (raw.version !== 1 && raw.version !== 2) ||
        (raw.leftPanel !== 'textures' && raw.leftPanel !== 'inspector') ||
        !finite(raw.leftWidth, MIN_DOCK, MAX_DOCK) ||
        !finite(raw.rightWidth, MIN_DOCK, MAX_DOCK) ||
        !finite(raw.inspectorSplit, 20, 80) ||
        !isRecord(raw.hidden) ||
        typeof raw.hidden.textures !== 'boolean' ||
        typeof raw.hidden.inspector !== 'boolean') return null;
    let floating: DockLayout['floating'] = { textures: null, inspector: null };
    if (raw.version === 2) {
      if (!isRecord(raw.floating)) return null;
      const textures = parseFloatRect(raw.floating.textures);
      const inspector = parseFloatRect(raw.floating.inspector);
      if (textures === undefined || inspector === undefined) return null;
      floating = { textures, inspector };
      if ((raw.hidden.textures && textures !== null) ||
          (raw.hidden.inspector && inspector !== null)) return null;
    }
    return {
      version: 2, leftPanel: raw.leftPanel,
      leftWidth: Math.round(raw.leftWidth),
      rightWidth: Math.round(raw.rightWidth),
      hidden: { textures: raw.hidden.textures, inspector: raw.hidden.inspector },
      inspectorSplit: Math.round(raw.inspectorSplit), floating,
    };
  } catch { return null; }
}

export function serializeDockLayout(layout: DockLayout): string {
  // Whitelist the only UI preferences, never spread unknown object fields.
  return JSON.stringify({
    version: 2, leftPanel: layout.leftPanel,
    leftWidth: layout.leftWidth, rightWidth: layout.rightWidth,
    hidden: { textures: layout.hidden.textures, inspector: layout.hidden.inspector },
    inspectorSplit: layout.inspectorSplit,
    floating: {
      textures: layout.floating.textures,
      inspector: layout.floating.inspector,
    },
  });
}
export function swapDockSides(layout: DockLayout): DockLayout {
  return { ...layout, leftPanel: oppositePanel(layout.leftPanel) };
}
export function setDockHidden(layout: DockLayout, panel: DockPanel, hidden: boolean): DockLayout {
  return {
    ...layout,
    hidden: { ...layout.hidden, [panel]: hidden },
    floating: { ...layout.floating, [panel]: null },
  };
}
export function setInspectorSplit(layout: DockLayout, percent: number): DockLayout {
  if (!Number.isFinite(percent)) return layout;
  return { ...layout, inspectorSplit: Math.round(clamp(percent, 20, 80)) };
}

export function measureDocks(layout: DockLayout, width: number): MeasuredDocks {
  const rightPanel = oppositePanel(layout.leftPanel);
  const leftHidden = layout.hidden[layout.leftPanel] || layout.floating[layout.leftPanel] !== null;
  const rightHidden = layout.hidden[rightPanel] || layout.floating[rightPanel] !== null;
  let leftWidth = leftHidden ? DOCK_RAIL : layout.leftWidth;
  let rightWidth = rightHidden ? DOCK_RAIL : layout.rightWidth;
  const available = Math.max(0, (Number.isFinite(width) ? width : 980) -
    MIN_VIEWPORT - 2 * DOCK_SPLITTER);
  let overflow = Math.max(0, leftWidth + rightWidth - available);
  const rightMinimum = rightHidden ? DOCK_RAIL : MIN_DOCK;
  const leftMinimum = leftHidden ? DOCK_RAIL : MIN_DOCK;
  const rightReduction = Math.min(overflow, Math.max(0, rightWidth - rightMinimum));
  rightWidth -= rightReduction;
  overflow -= rightReduction;
  const leftReduction = Math.min(overflow, Math.max(0, leftWidth - leftMinimum));
  leftWidth -= leftReduction;
  return {
    leftPanel: layout.leftPanel, rightPanel,
    leftHidden, rightHidden, leftWidth, rightWidth, centerMin: MIN_VIEWPORT,
  };
}
export function resizeDock(
  layout: DockLayout, side: DockSide, requestedWidth: number, viewportWidth: number,
): DockLayout {
  if (!Number.isFinite(requestedWidth) || !Number.isFinite(viewportWidth)) return layout;
  const measured = measureDocks(layout, viewportWidth);
  if (side === 'left' ? measured.leftHidden : measured.rightHidden) return layout;
  const other = side === 'left' ? measured.rightWidth : measured.leftWidth;
  const maximum = Math.min(MAX_DOCK, viewportWidth - 2 * DOCK_SPLITTER - MIN_VIEWPORT - other);
  const next = Math.round(Math.min(Math.max(MIN_DOCK, maximum), Math.max(MIN_DOCK, requestedWidth)));
  return side === 'left' ? { ...layout, leftWidth: next } : { ...layout, rightWidth: next };
}

export function measureFloatRect(rect: FloatRect, width: number, height: number): FloatRect {
  // The titlebar and controls remain visible when a window is resized.
  const viewWidth = Math.max(MIN_FLOAT_WIDTH, Number.isFinite(width) ? width : 980);
  const viewHeight = Math.max(MIN_FLOAT_HEIGHT, Number.isFinite(height) ? height : 600);
  const w = clamp(rect.width, MIN_FLOAT_WIDTH, Math.min(MAX_FLOAT_WIDTH, viewWidth));
  const h = clamp(rect.height, MIN_FLOAT_HEIGHT, Math.min(MAX_FLOAT_HEIGHT, viewHeight));
  return {
    x: Math.round(clamp(rect.x, 0, viewWidth - w)),
    y: Math.round(clamp(rect.y, 0, viewHeight - h)),
    width: Math.round(w), height: Math.round(h),
  };
}
export function floatDock(
  layout: DockLayout, panel: DockPanel, width: number, height: number,
): DockLayout {
  const position = measureFloatRect({
    x: panel === 'textures' ? 56 : 125,
    y: panel === 'textures' ? 40 : 75,
    width: panel === 'textures' ? 280 : 360,
    height: panel === 'textures' ? 330 : 420,
  }, width, height);
  return {
    ...layout, hidden: { ...layout.hidden, [panel]: false },
    floating: { ...layout.floating, [panel]: position },
  };
}
export function dockPanel(layout: DockLayout, panel: DockPanel, side: DockSide): DockLayout {
  return {
    ...layout,
    leftPanel: side === 'left' ? panel : oppositePanel(panel),
    hidden: { ...layout.hidden, [panel]: false },
    floating: { ...layout.floating, [panel]: null },
  };
}
export function moveFloat(
  layout: DockLayout, panel: DockPanel, x: number, y: number,
  viewportWidth: number, viewportHeight: number,
): DockLayout {
  const rect = layout.floating[panel];
  if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return layout;
  return {
    ...layout,
    floating: {
      ...layout.floating,
      [panel]: measureFloatRect({ ...rect, x, y }, viewportWidth, viewportHeight),
    },
  };
}
export function resizeFloat(
  layout: DockLayout, panel: DockPanel, width: number, height: number,
  viewportWidth: number, viewportHeight: number,
): DockLayout {
  const rect = layout.floating[panel];
  if (!rect || !Number.isFinite(width) || !Number.isFinite(height)) return layout;
  return {
    ...layout,
    floating: {
      ...layout.floating,
      [panel]: measureFloatRect({ ...rect, width, height }, viewportWidth, viewportHeight),
    },
  };
}
export function crossedDragThreshold(deltaX: number, deltaY: number): boolean {
  return Number.isFinite(deltaX) && Number.isFinite(deltaY) &&
    Math.hypot(deltaX, deltaY) > 5;
}
export function dropSideForPointer(x: number, viewportWidth: number): DockSide | null {
  if (!Number.isFinite(x) || !Number.isFinite(viewportWidth) ||
      x < 0 || x > viewportWidth || viewportWidth < 2 * MIN_DOCK + MIN_VIEWPORT) return null;
  const targetWidth = Math.min(100, Math.max(48, viewportWidth * .12));
  if (x <= targetWidth) return 'left';
  if (x >= viewportWidth - targetWidth) return 'right';
  return null;
}
