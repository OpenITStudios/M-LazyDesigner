/**
 * Rust editor dock UI interaction controller.
 *
 * Source-owned layout state stays in RustEditorPage.svelte: all properties
 * are live get/set references to that ONE Svelte state, not a second store.
 * Handles only panel floating, attach/separate tabs, keyboard/focus,
 * resizing and browser-local panel layout preferences. No Rust model,
 * asset path, Undo, native file access, Tauri IPC or Agent permission.
 *
 * SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
 */
import {tick} from 'svelte';
import {
  defaultDockLayout,serializeDockLayout,
  resizeDock,swapDockSides,setDockHidden,setInspectorSplit,
  attachDockTabs,detachDockTabs,selectDockTab,
  measureFloatRect,floatDock,dockPanel,dockSide,moveFloat,resizeFloat,
  dropSideForPointer,crossedDragThreshold,
  RUST_DOCK_LAYOUT_KEY,
  type DockLayout,type DockPanel,type DockSide,type FloatRect,type MeasuredDocks
} from './rustDockLayout';

export type FloatingGesture = {
    panel: DockPanel;
    pointerId: number;
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    original: FloatRect;
    baseline: DockLayout;
    moved: boolean;
  };
export type DockResize = {
    side: DockSide; pointerId: number; startX: number;
    startWidth: number; baseline: DockLayout;
  };
export type InspectorResize = {
    pointerId: number; startY: number; startPercent: number;
    height: number; baseline: DockLayout;
  };

export type RustDockInteractionState = {
  dockLayout: DockLayout;
  floatingGesture: FloatingGesture | null;
  floatingOnTop: DockPanel | null;
  pendingDockSide: DockSide | null;
  dockPersistenceError: boolean;
  dockResize: DockResize | null;
  inspectorResize: InspectorResize | null;
  readonly editorWidth: number;
  readonly editorHeight: number;
  readonly editorBody: HTMLDivElement;
  readonly measuredDocks: MeasuredDocks;
  readonly closeMenus: () => void;
};

export function createRustDockInteractions(dock:RustDockInteractionState) {
  // Panel state is UI-only; never persist the active model, UUID, paths, or
  // Rust document/Undo revisions through browser storage.
  function persistDocks() {
    try {
      window.localStorage.setItem(RUST_DOCK_LAYOUT_KEY, serializeDockLayout(dock.dockLayout));
      dock.dockPersistenceError = false;
    } catch {
      dock.dockPersistenceError = true;
    }
  }
  function setLayout(next: DockLayout) {
    dock.dockLayout = next;
    persistDocks();
    dock.closeMenus();
  }
  function floatPanel(panel: DockPanel) {
    dock.floatingGesture = null;
    dock.pendingDockSide = null;
    dock.floatingOnTop = panel;
    setLayout(floatDock(dock.dockLayout, panel, dock.editorWidth, dock.editorHeight));
    void tick().then(() => {
      document.querySelector<HTMLElement>(
        '.rust-editor .rust-floating-window[data-panel="' + panel + '"] .floating-title'
      )?.focus();
    });
  }

  function attachPanel(panel: DockPanel, side: DockSide) {
    dock.floatingGesture = null;
    dock.pendingDockSide = null;
    setLayout(dockPanel(dock.dockLayout, panel, side));
    void tick().then(() => {
      const owner = document.querySelector<HTMLElement>(
        '.rust-editor .' + (panel === 'textures' ? 'textures-dock' : 'inspector-dock')
      );
      owner?.querySelector<HTMLElement>('.dock-controls button')?.focus();
    });
  }

  function returnPanel(panel: DockPanel) {
    attachPanel(panel, dockSide(dock.dockLayout, panel));
  }

  function startFloating(panel: DockPanel, kind: 'move' | 'resize', event: PointerEvent) {
    if (event.button !== 0 || dock.floatingGesture || dock.dockResize || dock.inspectorResize ||
        (kind === 'move' && event.target instanceof Element &&
          !!event.target.closest('button'))) return;
    const original = dock.dockLayout.floating[panel];
    if (!original) return;
    dock.floatingGesture = {
      panel, kind, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      original: measureFloatRect(original, dock.editorWidth, dock.editorHeight),
      baseline: dock.dockLayout, moved: false,
    };
    dock.pendingDockSide = null;
    dock.floatingOnTop = panel;
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      dock.floatingGesture = null;
      return;
    }
    event.preventDefault();
  }

  function moveFloating(event: PointerEvent) {
    const state = dock.floatingGesture;
    if (!state || state.pointerId !== event.pointerId) return;
    const x = event.clientX - state.startX;
    const y = event.clientY - state.startY;
    if (crossedDragThreshold(x, y)) state.moved = true;
    if (!state.moved) return;
    if (state.kind === 'move') {
      dock.dockLayout = moveFloat(
        state.baseline, state.panel, state.original.x + x, state.original.y + y,
        dock.editorWidth, dock.editorHeight,
      );
      const rect = dock.editorBody.getBoundingClientRect();
      dock.pendingDockSide = dropSideForPointer(event.clientX - rect.left, dock.editorWidth);
    } else {
      dock.dockLayout = resizeFloat(
        state.baseline, state.panel,
        state.original.width + x, state.original.height + y,
        dock.editorWidth, dock.editorHeight,
      );
    }
  }

  function finishFloating(event: PointerEvent, cancelled = false) {
    const gesture = dock.floatingGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const rect = dock.editorBody.getBoundingClientRect();
    const side = !cancelled && gesture.kind === 'move' && gesture.moved
      ? dropSideForPointer(event.clientX - rect.left, dock.editorWidth) : null;
    dock.floatingGesture = null;
    dock.pendingDockSide = null;
    if (cancelled) dock.dockLayout = gesture.baseline;
    else if (side) attachPanel(gesture.panel, side);
    else persistDocks();
  }

  function keyFloatingMove(panel: DockPanel, event: KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const axis = arrows[event.key];
    const rect = dock.dockLayout.floating[panel];
    if (!axis || !rect) return;
    const step = event.shiftKey ? 25 : 10;
    setLayout(moveFloat(
      dock.dockLayout, panel, rect.x + axis[0] * step, rect.y + axis[1] * step,
      dock.editorWidth, dock.editorHeight,
    ));
    event.preventDefault();
  }

  function keyFloatingSize(panel: DockPanel, event: KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const axis = arrows[event.key];
    const rect = dock.dockLayout.floating[panel];
    if (!axis || !rect) return;
    const step = event.shiftKey ? 25 : 10;
    setLayout(resizeFloat(
      dock.dockLayout, panel,
      rect.width + axis[0] * step, rect.height + axis[1] * step,
      dock.editorWidth, dock.editorHeight,
    ));
    event.preventDefault();
  }

  function hideDock(panel: DockPanel, hidden: boolean) {
    setLayout(setDockHidden(dock.dockLayout, panel, hidden));
    // The initiating button is unmounted on fold/restore. Preserve keyboard focus
    // on the corresponding visible rail or panel control after Svelte updates.
    void tick().then(() => {
      const owner = document.querySelector<HTMLElement>(
        '.rust-editor .' + (panel === 'textures' ? 'textures-dock' : 'inspector-dock')
      );
      const target = owner?.querySelector<HTMLElement>(
        hidden ? '.dock-rail' : '.dock-controls button'
      );
      target?.focus();
    });
  }
  function swapDocks() {
    setLayout(swapDockSides(dock.dockLayout));
  }
  function resetDocks() {
    setLayout(defaultDockLayout());
  }

  function focusActiveTab() {
    void tick().then(() => {
      document.querySelector<HTMLElement>('.rust-editor .attached-tab[aria-selected="true"]')?.focus();
    });
  }

  function attachTabs(side: DockSide) {
    dock.floatingGesture = null;
    dock.pendingDockSide = null;
    setLayout(attachDockTabs(dock.dockLayout, side));
    focusActiveTab();
  }

  function separateTabs() {
    if (dock.dockLayout.attachedSide === null) return;
    const panel = dock.dockLayout.activeAttached;
    setLayout(detachDockTabs(dock.dockLayout));
    void tick().then(() => {
      const slot = document.querySelector<HTMLElement>(
        '.rust-editor .' + (panel === 'textures' ? 'textures-dock' : 'inspector-dock')
      );
      slot?.querySelector<HTMLElement>('.dock-controls button')?.focus();
    });
  }

  function activateAttachedTab(panel: DockPanel) {
    if (dock.dockLayout.attachedSide === null) return;
    setLayout(selectDockTab(dock.dockLayout, panel));
  }

  function keyAttachedTab(event: KeyboardEvent, panel: DockPanel) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const next: DockPanel = event.key === 'Home' ? 'textures'
      : event.key === 'End' ? 'inspector'
      : panel === 'textures' ? 'inspector' : 'textures';
    event.preventDefault();
    activateAttachedTab(next);
    focusActiveTab();
  }
  function startDockResize(side: DockSide, event: PointerEvent) {
    if (event.button !== 0 || dock.dockResize || dock.inspectorResize ||
        (side === 'left' ? dock.measuredDocks.leftHidden : dock.measuredDocks.rightHidden)) return;
    const node = event.currentTarget as HTMLElement;
    dock.dockResize = {
      side, pointerId: event.pointerId, startX: event.clientX,
      startWidth: side === 'left' ? dock.measuredDocks.leftWidth : dock.measuredDocks.rightWidth,
      baseline: dock.dockLayout,
    };
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      dock.dockResize = null;
      return;
    }
    event.preventDefault();
  }
  function moveDockResize(event: PointerEvent) {
    const state = dock.dockResize;
    if (!state || state.pointerId !== event.pointerId) return;
    const direction = state.side === 'left' ? 1 : -1;
    dock.dockLayout = resizeDock(
      state.baseline, state.side,
      state.startWidth + (event.clientX - state.startX) * direction,
      dock.editorWidth,
    );
  }
  function finishDockResize(event: PointerEvent, cancelled = false) {
    if (!dock.dockResize || dock.dockResize.pointerId !== event.pointerId) return;
    const state = dock.dockResize;
    dock.dockResize = null;
    if (cancelled) dock.dockLayout = state.baseline;
    else persistDocks();
  }
  function keyDockResize(side: DockSide, event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const sign = event.key === 'ArrowRight' ? 1 : -1;
    const outward = side === 'left' ? sign : -sign;
    const step = event.shiftKey ? 25 : 10;
    const oldWidth = side === 'left' ? dock.measuredDocks.leftWidth : dock.measuredDocks.rightWidth;
    setLayout(resizeDock(dock.dockLayout, side, oldWidth + outward * step, dock.editorWidth));
    event.preventDefault();
  }
  function startInspectorResize(event: PointerEvent) {
    if (event.button !== 0 || dock.inspectorResize || dock.dockResize) return;
    const node = event.currentTarget as HTMLElement;
    const parent = node.parentElement;
    if (!parent || parent.clientHeight < 120) return;
    dock.inspectorResize = {
      pointerId: event.pointerId, startY: event.clientY,
      startPercent: dock.dockLayout.inspectorSplit,
      height: parent.clientHeight, baseline: dock.dockLayout,
    };
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      dock.inspectorResize = null;
      return;
    }
    event.preventDefault();
  }
  function moveInspectorResize(event: PointerEvent) {
    const state = dock.inspectorResize;
    if (!state || state.pointerId !== event.pointerId) return;
    const percent = state.startPercent + (event.clientY - state.startY) / state.height * 100;
    dock.dockLayout = setInspectorSplit(state.baseline, percent);
  }
  function finishInspectorResize(event: PointerEvent, cancelled = false) {
    if (!dock.inspectorResize || dock.inspectorResize.pointerId !== event.pointerId) return;
    const state = dock.inspectorResize;
    dock.inspectorResize = null;
    if (cancelled) dock.dockLayout = state.baseline;
    else persistDocks();
  }
  function keyInspectorResize(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const step = event.shiftKey ? 10 : 5;
    const sign = event.key === 'ArrowDown' ? 1 : -1;
    setLayout(setInspectorSplit(dock.dockLayout, dock.dockLayout.inspectorSplit + sign * step));
    event.preventDefault();
  }
  // Expose only operations used by the editor view; internal helpers and
  // persistence bookkeeping remain encapsulated in this UI-only module.
  return {
    floatPanel,
    attachPanel,
    returnPanel,
    startFloating,
    moveFloating,
    finishFloating,
    keyFloatingMove,
    keyFloatingSize,
    hideDock,
    swapDocks,
    resetDocks,
    attachTabs,
    separateTabs,
    activateAttachedTab,
    keyAttachedTab,
    startDockResize,
    moveDockResize,
    finishDockResize,
    keyDockResize,
    startInspectorResize,
    moveInspectorResize,
    finishInspectorResize,
    keyInspectorResize
  };
}
