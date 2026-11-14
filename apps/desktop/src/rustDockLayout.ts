// UI-only panel placement. Never store model data or Rust document revisions.
// The pinned Blockbench 5.2.1 reference supports more slots; this bounded
// slice implements left/right, folded rails and one vertical panel splitter.
export type DockPanel = 'textures' | 'inspector';
export type DockSide = 'left' | 'right';
export type DockLayout = {
  version: 1;
  leftPanel: DockPanel;
  leftWidth: number;
  rightWidth: number;
  hidden: { textures: boolean; inspector: boolean };
  inspectorSplit: number;
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

export const RUST_DOCK_LAYOUT_KEY = 'lazydesigner.rust.edit.docks.v1';
export const DOCK_SPLITTER = 6;
export const DOCK_RAIL = 30;
export const MIN_DOCK = 160;
export const MAX_DOCK = 520;
export const MIN_VIEWPORT = 320;

export function defaultDockLayout(): DockLayout {
  return {
    version: 1, leftPanel: 'textures',
    leftWidth: 210, rightWidth: 288,
    hidden: { textures: false, inspector: false },
    inspectorSplit: 52,
  };
}

export function oppositePanel(panel: DockPanel): DockPanel {
  return panel === 'textures' ? 'inspector' : 'textures';
}

const finite = (value: unknown, lower: number, upper: number) =>
  typeof value === 'number' && Number.isFinite(value) &&
  value >= lower && value <= upper;

export function restoreDockLayout(text: string | null): DockLayout | null {
  if (!text || text.length > 2048) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const hidden = obj.hidden;
    if (obj.version !== 1 ||
        (obj.leftPanel !== 'textures' && obj.leftPanel !== 'inspector') ||
        !finite(obj.leftWidth, MIN_DOCK, MAX_DOCK) ||
        !finite(obj.rightWidth, MIN_DOCK, MAX_DOCK) ||
        !finite(obj.inspectorSplit, 20, 80) ||
        !hidden || typeof hidden !== 'object' || Array.isArray(hidden)) return null;
    const flags = hidden as Record<string, unknown>;
    if (typeof flags.textures !== 'boolean' || typeof flags.inspector !== 'boolean') return null;
    return {
      version: 1,
      leftPanel: obj.leftPanel,
      leftWidth: Math.round(obj.leftWidth as number),
      rightWidth: Math.round(obj.rightWidth as number),
      hidden: { textures: flags.textures, inspector: flags.inspector },
      inspectorSplit: Math.round(obj.inspectorSplit as number),
    };
  } catch {
    return null;
  }
}

export function serializeDockLayout(layout: DockLayout): string {
  // Only the UI layout fields are persisted, never document or editor state.
  return JSON.stringify(layout);
}

export function swapDockSides(layout: DockLayout): DockLayout {
  return { ...layout, leftPanel: oppositePanel(layout.leftPanel) };
}

export function setDockHidden(layout: DockLayout, panel: DockPanel, hidden: boolean): DockLayout {
  return { ...layout, hidden: { ...layout.hidden, [panel]: hidden } };
}

export function setInspectorSplit(layout: DockLayout, percent: number): DockLayout {
  if (!Number.isFinite(percent)) return layout;
  return { ...layout, inspectorSplit: Math.round(Math.min(80, Math.max(20, percent))) };
}

export function measureDocks(layout: DockLayout, width: number): MeasuredDocks {
  const rightPanel = oppositePanel(layout.leftPanel);
  // Only an explicit user action folds a dock. On narrower windows the
  // algorithm shrinks dock widths to preserve the viewport instead of
  // silently hiding a user's editor panel.
  const leftHidden = layout.hidden[layout.leftPanel];
  const rightHidden = layout.hidden[rightPanel];
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
