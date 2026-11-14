<script lang="ts">
  import './rust-editor.css';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, tick } from 'svelte';
  import RustViewport from './RustViewport.svelte';
  import { parseFiniteEditorNumber } from './rustNumericInput';
  import type { CubeView, EditorSnapshot, EditOperation, HierarchyNode, Vec3, Vec4 } from './rustEditorTypes';
  import {
    defaultDockLayout, restoreDockLayout, serializeDockLayout,
    measureDocks, resizeDock, swapDockSides, setDockHidden, setInspectorSplit,
    attachDockTabs, detachDockTabs, selectDockTab,
    measureFloatRect, floatDock, dockPanel, dockSide, moveFloat, resizeFloat,
    dropSideForPointer, crossedDragThreshold,
    RUST_DOCK_LAYOUT_KEY, LEGACY_DOCK_LAYOUT_V2_KEY, LEGACY_DOCK_LAYOUT_KEY,
    DOCK_SPLITTER, MIN_DOCK, MAX_DOCK,
    type DockLayout, type DockPanel, type DockSide, type FloatRect,
  } from './rustDockLayout';

  export let onLegacy: () => void = () => {};
  type Menu = 'file' | 'edit' | 'view' | null;
  type Row = { uuid: string; name: string; depth: number; kind: 'cube' | 'bone' };

  let snapshot: EditorSnapshot | null = null;
  let selectedId: string | null = null;
  let selectedBoneId: string | null = null;
  // Move is the only implemented viewport gizmo. No fabricated Rotate/Scale.
  let moveTool = true;
  let selectedFace = 'north';
  let menu: Menu = null;
  let loading = true;
  let busy = false;
  let error = '';
  let notice = '';
  let newDialog = false;
  let newName = 'New Model';
  let allowDiscard = false;
  let confirmDiscard: 'new' | 'open' | null = null;
  let collapsed = new Set<string>();
  let nameInput: HTMLInputElement;
  let discardCancel: HTMLButtonElement;
  let viewport: { frameModel: () => void } | undefined;
  let editorBody: HTMLDivElement;
  let editorWidth = 980;
  let editorHeight = 550;
  let dockLayout: DockLayout = defaultDockLayout();
  type FloatingGesture = {
    panel: DockPanel;
    pointerId: number;
    kind: 'move' | 'resize';
    startX: number;
    startY: number;
    original: FloatRect;
    baseline: DockLayout;
    moved: boolean;
  };
  let floatingGesture: FloatingGesture | null = null;
  let floatingOnTop: DockPanel | null = null;
  let pendingDockSide: DockSide | null = null;
  let dockPersistenceError = false;
  type DockResize = {
    side: DockSide; pointerId: number; startX: number;
    startWidth: number; baseline: DockLayout;
  };
  type InspectorResize = {
    pointerId: number; startY: number; startPercent: number;
    height: number; baseline: DockLayout;
  };
  let dockResize: DockResize | null = null;
  let inspectorResize: InspectorResize | null = null;

  $: measuredDocks = measureDocks(dockLayout, editorWidth);
  $: gridTemplate = [
    measuredDocks.leftWidth + 'px', DOCK_SPLITTER + 'px', 'minmax(0, 1fr)',
    DOCK_SPLITTER + 'px', measuredDocks.rightWidth + 'px',
  ].join(' ');
  $: floatingTextures = dockLayout.floating.textures
    ? measureFloatRect(dockLayout.floating.textures, editorWidth, editorHeight) : null;
  $: floatingInspector = dockLayout.floating.inspector
    ? measureFloatRect(dockLayout.floating.inspector, editorWidth, editorHeight) : null;

  const AXES = ['X', 'Y', 'Z'] as const;
  const FACES = ['north', 'east', 'south', 'west', 'up', 'down'] as const;

  function makeRows(nodes: HierarchyNode[], cubes: CubeView[], folded: Set<string>): Row[] {
    const cubeNames = new Map(cubes.map((cube) => [cube.uuid, cube.name] as const));
    const boneNames = new Map((snapshot?.bones ?? []).map((bone) => [bone.uuid, bone.name] as const));
    const rows: Row[] = [];
    function walk(items: HierarchyNode[], depth: number) {
      for (const item of items) {
        if (typeof item === 'string') {
          rows.push({ uuid: item, name: cubeNames.get(item) ?? 'Cube', depth, kind: 'cube' });
        } else {
          rows.push({ uuid: item.uuid, name: boneNames.get(item.uuid) ?? 'Bone', depth, kind: 'bone' });
          if (!folded.has(item.uuid)) walk(item.children, depth + 1);
        }
      }
    }
    walk(nodes, 0);
    return rows;
  }

  $: selectedCube = snapshot?.cubes.find((cube) => cube.uuid === selectedId) ?? null;
  $: rows = makeRows(snapshot?.hierarchy ?? [], snapshot?.cubes ?? [], collapsed);
  $: faceUv = selectedCube?.faces[selectedFace]?.uv ?? [0, 0, 0, 0];

  function closeMenus() { menu = null; }
  function outsideClick(event: MouseEvent) {
    if (menu && event.target instanceof Element && !event.target.closest('.rust-menu-bar')) closeMenus();
  }
  function selectCube(id: string | null) {
    selectedId = id;
    selectedBoneId = null;
  }
  function toggleBone(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }
  function selectRow(row: Row) {
    if (row.kind === 'cube') selectCube(row.uuid);
    else { selectedId = null; selectedBoneId = row.uuid; }
  }
  function showError(cause: unknown) {
    if (cause && typeof cause === 'object' && 'message' in cause &&
        typeof cause.message === 'string') error = cause.message;
    else if (typeof cause === 'string') error = cause;
    else error = 'The native authoring operation could not be completed.';
  }
  function accept(next: EditorSnapshot) {
    snapshot = next;
    if (selectedId && !next.cubes.some((cube) => cube.uuid === selectedId)) selectedId = null;
    if (selectedBoneId && !next.bones.some((bone) => bone.uuid === selectedBoneId)) selectedBoneId = null;
    notice = '';
  }
  async function command(name: string, args: Record<string, unknown>): Promise<EditorSnapshot | null> {
    if (busy) return null;
    busy = true; closeMenus(); error = '';
    try {
      const next = await invoke<EditorSnapshot>(name, args);
      accept(next);
      return next;
    } catch (cause) { showError(cause); return null; }
    finally { busy = false; }
  }
  async function load() {
    loading = true;
    try {
      const model = await invoke<EditorSnapshot | null>('rust_editor_snapshot');
      if (model) accept(model);
      else snapshot = null;
    } catch (cause) { showError(cause); }
    finally { loading = false; }
  }
  async function beginNew(discard = false) {
    allowDiscard = discard;
    newDialog = true;
    newName = 'New Model';
    closeMenus();
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }
  async function commitNew() {
    if (!newName.trim()) { error = 'Enter a model name.'; return; }
    const next = await command('rust_editor_new', {
      name: newName, expectedEpoch: snapshot?.epoch ?? 0, discard: allowDiscard,
    });
    if (next) {
      selectedId = null; selectedBoneId = null;
      newDialog = false; allowDiscard = false;
      await tick(); viewport?.frameModel();
    }
  }
  async function openModel(discard = false) {
    if (busy) return;
    busy = true; closeMenus(); error = '';
    try {
      const model = await invoke<EditorSnapshot | null>('rust_editor_open', {
        expectedEpoch: snapshot?.epoch ?? 0, discard,
      });
      if (model) {
        selectedId = null; selectedBoneId = null;
        accept(model); await tick(); viewport?.frameModel();
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  function requestNew() {
    if (loading || busy) return;
    if (snapshot?.dirty) {
      confirmDiscard = 'new';
      void tick().then(() => discardCancel?.focus());
    } else void beginNew();
    closeMenus();
  }
  function requestOpen() {
    if (loading || busy) return;
    if (snapshot?.dirty) {
      confirmDiscard = 'open';
      void tick().then(() => discardCancel?.focus());
    } else void openModel();
    closeMenus();
  }
  function discardAndContinue() {
    const action = confirmDiscard; confirmDiscard = null;
    if (action === 'new') void beginNew(true);
    if (action === 'open') void openModel(true);
  }
  async function saveCopy() {
    if (!snapshot || busy) return;
    busy = true; closeMenus(); error = '';
    try {
      const next = await invoke<EditorSnapshot | null>('rust_editor_save_copy', {
        expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      });
      if (next) { accept(next); notice = 'Saved a new .bbmodel copy without overwriting the original.'; }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  function apply(operations: EditOperation[]) {
    if (!snapshot) return;
    void command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision, operations,
    });
  }

  async function moveFromViewport(uuid: string, delta: Vec3): Promise<boolean> {
    // A pointer gesture may request one Rust edit. The viewport never mutates
    // the authored document and must restore its preview on any refusal.
    if (!snapshot || !moveTool || busy || selectedId !== uuid) return false;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
      operations: [{ op: 'translate_cube', uuid, delta }],
    });
    await tick();
    return next !== null;
  }
  async function addCube() {
    if (!snapshot) return;
    const previous = new Set(snapshot.cubes.map((cube) => cube.uuid));
    const next = await command('rust_editor_add_cube', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision, parentUuid: selectedBoneId,
    });
    if (next) {
      selectedId = next.cubes.find((cube) => !previous.has(cube.uuid))?.uuid ?? null;
      selectedBoneId = null;
      await tick(); viewport?.frameModel();
    }
  }
  function history(direction: 'undo' | 'redo') {
    if (!snapshot) return;
    void command(direction === 'undo' ? 'rust_editor_undo' : 'rust_editor_redo', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
    });
  }
  function position(axis: number, text: string) {
    if (!selectedCube) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null) { error = 'Enter a finite decimal coordinate.'; return; }
    const delta: Vec3 = [0, 0, 0];
    delta[axis] = value - selectedCube.from[axis];
    if (delta[axis] !== 0) apply([{ op: 'translate_cube', uuid: selectedCube.uuid, delta }]);
  }
  function size(axis: number, text: string) {
    if (!selectedCube) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null || value <= 0) { error = 'Size must be a positive finite decimal number.'; return; }
    if (value === selectedCube.to[axis] - selectedCube.from[axis]) return;
    const to = [...selectedCube.to] as Vec3;
    to[axis] = selectedCube.from[axis] + value;
    apply([{ op: 'set_cube_bounds', uuid: selectedCube.uuid, from: selectedCube.from, to }]);
  }
  function rotation(axis: number, text: string) {
    if (!selectedCube) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null) { error = 'Enter a finite decimal rotation angle.'; return; }
    const angles = [...selectedCube.rotation] as Vec3;
    angles[axis] = value;
    if (angles[axis] !== selectedCube.rotation[axis]) {
      apply([{ op: 'set_cube_rotation', uuid: selectedCube.uuid, rotation: angles }]);
    }
  }

  function uvEdit(index: number, text: string) {
    if (!selectedCube || selectedCube.boxUv) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null) { error = 'Enter a finite decimal UV coordinate.'; return; }
    const uv = [...faceUv] as Vec4; uv[index] = value;
    if (uv[index] !== faceUv[index]) apply([{ op: 'set_face_uv', uuid: selectedCube.uuid, face: selectedFace, uv }]);
  }
  function hotkeys(event: KeyboardEvent) {
    if (event.key === 'Escape' && floatingGesture) {
      const gesture = floatingGesture;
      floatingGesture = null;
      pendingDockSide = null;
      dockLayout = gesture.baseline;
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (confirmDiscard) confirmDiscard = null;
      else if (newDialog) newDialog = false;
      closeMenus(); return;
    }
    if (newDialog || confirmDiscard) {
      if (event.key === 'Tab') {
        const container = document.querySelector<HTMLElement>('.rust-modal-backdrop');
        const focusables = Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault(); first.focus();
        }
      }
      return;
    }
    if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); requestNew(); }
    if (key === 'o') { event.preventDefault(); requestOpen(); }
    if (key === 's' && event.shiftKey) { event.preventDefault(); void saveCopy(); }
    if (key === 'z') {
      event.preventDefault();
      history(event.shiftKey ? 'redo' : 'undo');
    }
    if (key === 'y') { event.preventDefault(); history('redo'); }
  }

  // Panel state is UI-only; never persist the active model, UUID, paths, or
  // Rust document/Undo revisions through browser storage.
  function persistDocks() {
    try {
      window.localStorage.setItem(RUST_DOCK_LAYOUT_KEY, serializeDockLayout(dockLayout));
      dockPersistenceError = false;
    } catch {
      dockPersistenceError = true;
    }
  }
  function setLayout(next: DockLayout) {
    dockLayout = next;
    persistDocks();
    closeMenus();
  }
  function floatPanel(panel: DockPanel) {
    floatingGesture = null;
    pendingDockSide = null;
    floatingOnTop = panel;
    setLayout(floatDock(dockLayout, panel, editorWidth, editorHeight));
    void tick().then(() => {
      document.querySelector<HTMLElement>(
        '.rust-editor .rust-floating-window[data-panel="' + panel + '"] .floating-title'
      )?.focus();
    });
  }

  function attachPanel(panel: DockPanel, side: DockSide) {
    floatingGesture = null;
    pendingDockSide = null;
    setLayout(dockPanel(dockLayout, panel, side));
    void tick().then(() => {
      const owner = document.querySelector<HTMLElement>(
        '.rust-editor .' + (panel === 'textures' ? 'textures-dock' : 'inspector-dock')
      );
      owner?.querySelector<HTMLElement>('.dock-controls button')?.focus();
    });
  }

  function returnPanel(panel: DockPanel) {
    attachPanel(panel, dockSide(dockLayout, panel));
  }

  function startFloating(panel: DockPanel, kind: 'move' | 'resize', event: PointerEvent) {
    if (event.button !== 0 || floatingGesture || dockResize || inspectorResize ||
        (kind === 'move' && event.target instanceof Element &&
          !!event.target.closest('button'))) return;
    const original = dockLayout.floating[panel];
    if (!original) return;
    floatingGesture = {
      panel, kind, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      original: measureFloatRect(original, editorWidth, editorHeight),
      baseline: dockLayout, moved: false,
    };
    pendingDockSide = null;
    floatingOnTop = panel;
    const target = event.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      floatingGesture = null;
      return;
    }
    event.preventDefault();
  }

  function moveFloating(event: PointerEvent) {
    const state = floatingGesture;
    if (!state || state.pointerId !== event.pointerId) return;
    const x = event.clientX - state.startX;
    const y = event.clientY - state.startY;
    if (crossedDragThreshold(x, y)) state.moved = true;
    if (!state.moved) return;
    if (state.kind === 'move') {
      dockLayout = moveFloat(
        state.baseline, state.panel, state.original.x + x, state.original.y + y,
        editorWidth, editorHeight,
      );
      const rect = editorBody.getBoundingClientRect();
      pendingDockSide = dropSideForPointer(event.clientX - rect.left, editorWidth);
    } else {
      dockLayout = resizeFloat(
        state.baseline, state.panel,
        state.original.width + x, state.original.height + y,
        editorWidth, editorHeight,
      );
    }
  }

  function finishFloating(event: PointerEvent, cancelled = false) {
    const gesture = floatingGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const rect = editorBody.getBoundingClientRect();
    const side = !cancelled && gesture.kind === 'move' && gesture.moved
      ? dropSideForPointer(event.clientX - rect.left, editorWidth) : null;
    floatingGesture = null;
    pendingDockSide = null;
    if (cancelled) dockLayout = gesture.baseline;
    else if (side) attachPanel(gesture.panel, side);
    else persistDocks();
  }

  function keyFloatingMove(panel: DockPanel, event: KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const axis = arrows[event.key];
    const rect = dockLayout.floating[panel];
    if (!axis || !rect) return;
    const step = event.shiftKey ? 25 : 10;
    setLayout(moveFloat(
      dockLayout, panel, rect.x + axis[0] * step, rect.y + axis[1] * step,
      editorWidth, editorHeight,
    ));
    event.preventDefault();
  }

  function keyFloatingSize(panel: DockPanel, event: KeyboardEvent) {
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const axis = arrows[event.key];
    const rect = dockLayout.floating[panel];
    if (!axis || !rect) return;
    const step = event.shiftKey ? 25 : 10;
    setLayout(resizeFloat(
      dockLayout, panel,
      rect.width + axis[0] * step, rect.height + axis[1] * step,
      editorWidth, editorHeight,
    ));
    event.preventDefault();
  }

  function hideDock(panel: DockPanel, hidden: boolean) {
    setLayout(setDockHidden(dockLayout, panel, hidden));
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
    setLayout(swapDockSides(dockLayout));
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
    floatingGesture = null;
    pendingDockSide = null;
    setLayout(attachDockTabs(dockLayout, side));
    focusActiveTab();
  }

  function separateTabs() {
    if (dockLayout.attachedSide === null) return;
    const panel = dockLayout.activeAttached;
    setLayout(detachDockTabs(dockLayout));
    void tick().then(() => {
      const slot = document.querySelector<HTMLElement>(
        '.rust-editor .' + (panel === 'textures' ? 'textures-dock' : 'inspector-dock')
      );
      slot?.querySelector<HTMLElement>('.dock-controls button')?.focus();
    });
  }

  function activateAttachedTab(panel: DockPanel) {
    if (dockLayout.attachedSide === null) return;
    setLayout(selectDockTab(dockLayout, panel));
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
    if (event.button !== 0 || dockResize || inspectorResize ||
        (side === 'left' ? measuredDocks.leftHidden : measuredDocks.rightHidden)) return;
    const node = event.currentTarget as HTMLElement;
    dockResize = {
      side, pointerId: event.pointerId, startX: event.clientX,
      startWidth: side === 'left' ? measuredDocks.leftWidth : measuredDocks.rightWidth,
      baseline: dockLayout,
    };
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      dockResize = null;
      return;
    }
    event.preventDefault();
  }
  function moveDockResize(event: PointerEvent) {
    const state = dockResize;
    if (!state || state.pointerId !== event.pointerId) return;
    const direction = state.side === 'left' ? 1 : -1;
    dockLayout = resizeDock(
      state.baseline, state.side,
      state.startWidth + (event.clientX - state.startX) * direction,
      editorWidth,
    );
  }
  function finishDockResize(event: PointerEvent, cancelled = false) {
    if (!dockResize || dockResize.pointerId !== event.pointerId) return;
    const state = dockResize;
    dockResize = null;
    if (cancelled) dockLayout = state.baseline;
    else persistDocks();
  }
  function keyDockResize(side: DockSide, event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const sign = event.key === 'ArrowRight' ? 1 : -1;
    const outward = side === 'left' ? sign : -sign;
    const step = event.shiftKey ? 25 : 10;
    const oldWidth = side === 'left' ? measuredDocks.leftWidth : measuredDocks.rightWidth;
    setLayout(resizeDock(dockLayout, side, oldWidth + outward * step, editorWidth));
    event.preventDefault();
  }
  function startInspectorResize(event: PointerEvent) {
    if (event.button !== 0 || inspectorResize || dockResize) return;
    const node = event.currentTarget as HTMLElement;
    const parent = node.parentElement;
    if (!parent || parent.clientHeight < 120) return;
    inspectorResize = {
      pointerId: event.pointerId, startY: event.clientY,
      startPercent: dockLayout.inspectorSplit,
      height: parent.clientHeight, baseline: dockLayout,
    };
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      inspectorResize = null;
      return;
    }
    event.preventDefault();
  }
  function moveInspectorResize(event: PointerEvent) {
    const state = inspectorResize;
    if (!state || state.pointerId !== event.pointerId) return;
    const percent = state.startPercent + (event.clientY - state.startY) / state.height * 100;
    dockLayout = setInspectorSplit(state.baseline, percent);
  }
  function finishInspectorResize(event: PointerEvent, cancelled = false) {
    if (!inspectorResize || inspectorResize.pointerId !== event.pointerId) return;
    const state = inspectorResize;
    inspectorResize = null;
    if (cancelled) dockLayout = state.baseline;
    else persistDocks();
  }
  function keyInspectorResize(event: KeyboardEvent) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const step = event.shiftKey ? 10 : 5;
    const sign = event.key === 'ArrowDown' ? 1 : -1;
    setLayout(setInspectorSplit(dockLayout, dockLayout.inspectorSplit + sign * step));
    event.preventDefault();
  }

  onMount(() => {
    try {
      const current = window.localStorage.getItem(RUST_DOCK_LAYOUT_KEY);
      const previous = window.localStorage.getItem(LEGACY_DOCK_LAYOUT_V2_KEY);
      const original = window.localStorage.getItem(LEGACY_DOCK_LAYOUT_KEY);
      const stored = restoreDockLayout(current)
        ?? restoreDockLayout(previous)
        ?? restoreDockLayout(original);
      if (stored) dockLayout = stored;
    } catch {
      dockPersistenceError = true;
    }
    const observer = new ResizeObserver((records) => {
      const width = records[0]?.contentRect.width;
      const height = records[0]?.contentRect.height;
      if (width && Number.isFinite(width)) editorWidth = width;
      if (height && Number.isFinite(height)) editorHeight = height;
    });
    observer.observe(editorBody);
    void load();
    return () => observer.disconnect();
  });
</script>

{#snippet textureDock(side: DockSide | 'float' | 'tabs')}
  <aside class="dock-column textures-dock"
    id={side === 'float' ? 'float-textures' : side === 'tabs' ? 'tab-content-textures' : 'dock-' + side}
    data-side={side} aria-label="Textures panel">
    {#if side !== 'float' && side !== 'tabs' &&
      (dockLayout.hidden.textures || dockLayout.floating.textures)}
      <button type="button" class="dock-rail" title="Restore Textures to this side"
        onclick={() => dockLayout.floating.textures
          ? returnPanel('textures') : hideDock('textures', false)}>
        {dockLayout.floating.textures ? 'Dock Textures' : 'Show Textures'}
      </button>
    {:else}
      {#if side !== 'tabs'}
      <div class="dock-title">
        <span>TEXTURES</span>
        {#if side !== 'float'}
          <div class="dock-controls">
            <button type="button" title="Move Textures to the opposite side"
              onclick={swapDocks}>Move</button>
            <button type="button" title="Float Textures in the editor"
              onclick={() => floatPanel('textures')}>Float</button>
            <button type="button" title="Fold Textures panel"
              onclick={() => hideDock('textures', true)}>Fold</button>
          </div>
        {/if}
      </div>
      {/if}

      {#if snapshot?.textureNames.length}
        <div class="texture-list">
          {#each snapshot.textureNames as name, index}
            <div class="texture-item" title={name}><span class="texture-square"></span><span>{name}</span><small>{index + 1}</small></div>
          {/each}
        </div>
      {:else}
        <p class="empty-label">No textures</p>
      {/if}
      <p class="dock-note">Texture painting is not available in this Edit slice.</p>
    {/if}
  </aside>
{/snippet}

{#snippet inspectorDock(side: DockSide | 'float' | 'tabs')}
  <aside class="dock-column inspector-dock"
    id={side === 'float' ? 'float-inspector' : side === 'tabs' ? 'tab-content-inspector' : 'dock-' + side}
    data-side={side} aria-label="Outliner and properties panels">
    {#if side !== 'float' && side !== 'tabs' &&
      (dockLayout.hidden.inspector || dockLayout.floating.inspector)}
      <button type="button" class="dock-rail" title="Restore Outliner and Properties to this side"
        onclick={() => dockLayout.floating.inspector
          ? returnPanel('inspector') : hideDock('inspector', false)}>
        {dockLayout.floating.inspector ? 'Dock Outliner' : 'Show Outliner'}
      </button>
    {:else}

      <section class="dock-panel outliner" style:flex-basis={dockLayout.inspectorSplit + '%'}>
        <div class="dock-title">
          <span>OUTLINER</span>
          {#if side !== 'float' && side !== 'tabs'}
            <div class="dock-controls">
              <button type="button" title="Move Outliner and Properties to the opposite side"
                onclick={swapDocks}>Move</button>
              <button type="button" title="Float Outliner and Properties in the editor"
                onclick={() => floatPanel('inspector')}>Float</button>
              <button type="button" title="Fold Outliner and Properties"
                onclick={() => hideDock('inspector', true)}>Fold</button>
            </div>
          {/if}
        </div>
        {#if rows.length}
          <div class="outliner-list" role="tree" aria-label="Model hierarchy">
            {#each rows as row (row.uuid)}
              <div class="outliner-row" class:selected={selectedId === row.uuid || selectedBoneId === row.uuid}
                style:padding-left={(6 + row.depth * 14) + 'px'} role="presentation">
                {#if row.kind === 'bone'}
                  <button class="collapse" aria-label="Toggle group" aria-expanded={!collapsed.has(row.uuid)}
                    onclick={() => toggleBone(row.uuid)}>{collapsed.has(row.uuid) ? '▸' : '▾'}</button>
                {:else}
                  <span class="collapse-spacer"></span>
                {/if}
                <button class="outliner-label" role="treeitem" aria-selected={selectedId === row.uuid || selectedBoneId === row.uuid}
                  onclick={() => selectRow(row)}>
                  <span class="item-kind" aria-hidden="true">{row.kind === 'bone' ? '◇' : '□'}</span>
                  <span class="truncate" title={row.name}>{row.name}</span>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-label">No model elements</p>
        {/if}
      </section>
      <div class="dock-splitter-horizontal" role="separator" aria-label="Resize Outliner and Properties"
        aria-orientation="horizontal" tabindex="0"
        aria-valuemin="20" aria-valuemax="80" aria-valuenow={dockLayout.inspectorSplit}
        onpointerdown={startInspectorResize} onpointermove={moveInspectorResize}
        onpointerup={finishInspectorResize}
        onpointercancel={(event) => finishInspectorResize(event, true)}
        onlostpointercapture={(event) => finishInspectorResize(event, true)}
        onkeydown={keyInspectorResize}></div>

      <section class="dock-panel properties">
        <div class="dock-title">ELEMENT</div>
        {#if selectedCube}
          <div class="property-scroll">
            <p class="selected-name" title={selectedCube.name}>{selectedCube.name}</p>
            <div class="property-group">
              <label>Position</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Position ' + AXES[axis]} type="number" step="any"
                      disabled={busy}
                      title="Change Cube position (Auto UV remaps in Rust)"
                      value={selectedCube.from[axis]}
                      onchange={(event) => position(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label>Size</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Size ' + AXES[axis]} type="number" step="any" min="0.001"
                      disabled={busy}
                      title="Change Cube size (one edge at a time; UV remaps in Rust)"
                      value={selectedCube.to[axis] - selectedCube.from[axis]}
                      onchange={(event) => size(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label>Rotation (degrees)</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Rotation ' + AXES[axis]} type="number" step="any"
                      disabled={busy} value={selectedCube.rotation[axis]}
                      onchange={(event) => rotation(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            {#if selectedCube.boxUv}
              <p class="hint">Box UV remaps Size and preserves the box offset. Per-face UV editing remains unavailable.</p>
            {:else if selectedCube.autoUv !== 0}
              <p class="hint">Auto UV mode {selectedCube.autoUv} remaps Move and single-edge Size in Rust. Manual face UV edits disable Auto UV for the selected Cube.</p>
            {/if}
            <div class="property-group">
              <label for="uv-face">UV Face</label>
              <select id="uv-face" bind:value={selectedFace}
                disabled={busy || selectedCube.boxUv}>
                {#each FACES as face}
                  <option value={face}>{face}</option>
                {/each}
              </select>
              {#if selectedCube.boxUv}
                <p class="hint">Box UV face rectangles are derived from Cube bounds and offset.</p>
              {:else}
                <div class="uv-fields">
                  {#each [0,1,2,3] as i}
                    <label><span>{['U1','V1','U2','V2'][i]}</span>
                      <input aria-label={'UV ' + (i + 1)} type="number" step="any"
                        disabled={busy}
                        title={selectedCube.autoUv !== 0 ? 'Manual UV edits disable Auto UV on this Cube' : 'Change face UV'}
                        value={faceUv[i] ?? 0}
                        onchange={(event) => uvEdit(i, event.currentTarget.value)}/>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else if selectedBoneId}
          <p class="empty-label">Bone selected. Add Cube to this bone.</p>
        {:else}
          <p class="empty-label">Select a Cube to edit Position, Size or UV.</p>
        {/if}
      </section>
    {/if}
  </aside>
{/snippet}


{#snippet attachedDock(side: DockSide)}
  <aside class="dock-column attached-dock" id={'dock-' + side} data-side={side}
    aria-label="Attached editor panels">
    <div class="attached-toolbar">
      <div class="attached-tablist" role="tablist" aria-label="Attached panel tabs">
        <button type="button" class="attached-tab" role="tab" id="attached-tab-textures"
          aria-controls="attached-panel-content"
          aria-selected={dockLayout.activeAttached === 'textures'}
          tabindex={dockLayout.activeAttached === 'textures' ? 0 : -1}
          onclick={() => activateAttachedTab('textures')}
          onkeydown={(event) => keyAttachedTab(event, 'textures')}>Textures</button>
        <button type="button" class="attached-tab" role="tab" id="attached-tab-inspector"
          aria-controls="attached-panel-content"
          aria-selected={dockLayout.activeAttached === 'inspector'}
          tabindex={dockLayout.activeAttached === 'inspector' ? 0 : -1}
          onclick={() => activateAttachedTab('inspector')}
          onkeydown={(event) => keyAttachedTab(event, 'inspector')}>Outliner / Properties</button>
      </div>
      <button type="button" class="attached-separate" onclick={separateTabs}
        title="Separate attached panels into left and right docks">Separate</button>
    </div>
    <div class="attached-panel-host" role="tabpanel" id="attached-panel-content" tabindex="0"
      aria-labelledby={'attached-tab-' + dockLayout.activeAttached}>
      {#if dockLayout.activeAttached === 'textures'}
        {@render textureDock('tabs')}
      {:else}
        {@render inspectorDock('tabs')}
      {/if}
    </div>
  </aside>
{/snippet}

{#snippet attachedReturnRail(side: DockSide)}
  <aside class="dock-column attached-return-rail" id={'dock-' + side} data-side={side}
    aria-label="Separated panel docking location">
    <button type="button" class="dock-rail" onclick={separateTabs}
      title="Separate attached panels back into left and right docks">Separate Panels</button>
  </aside>
{/snippet}

{#snippet floatingPanel(panel: DockPanel)}
  {#if dockLayout.floating[panel]}
    {@const rect = panel === 'textures' ? floatingTextures : floatingInspector}
    {#if rect}
      <section class="rust-floating-window" class:front={floatingOnTop === panel} data-panel={panel}
        aria-label={panel === 'textures' ? 'Floating Textures' : 'Floating Outliner and Properties'}
        style:left={rect.x + 'px'} style:top={rect.y + 'px'}
        style:width={rect.width + 'px'} style:height={rect.height + 'px'}
        onfocusin={() => floatingOnTop = panel}>
        <div class="floating-title" tabindex="0" role="group"
          aria-label={'Move floating ' + panel + ' panel with arrow keys, or drag it to a dock edge'}
          onpointerdown={(event) => startFloating(panel, 'move', event)}
          onpointermove={moveFloating}
          onpointerup={finishFloating}
          onpointercancel={(event) => finishFloating(event, true)}
          onlostpointercapture={(event) => finishFloating(event, true)}
          onkeydown={(event) => keyFloatingMove(panel, event)}>
          <strong>{panel === 'textures' ? 'Textures' : 'Outliner / Properties'}</strong>
          <div class="floating-actions">
            <button type="button" onclick={() => attachPanel(panel, 'left')}>Dock Left</button>
            <button type="button" onclick={() => attachPanel(panel, 'right')}>Dock Right</button>
            <button type="button" onclick={() => hideDock(panel, true)}>Fold</button>
          </div>
        </div>
        {#if panel === 'textures'}
          {@render textureDock('float')}
        {:else}
          {@render inspectorDock('float')}
        {/if}
        <button type="button" class="floating-resize-handle"
          aria-label={'Resize floating ' + panel + ' panel with arrow keys or drag'}
          onpointerdown={(event) => startFloating(panel, 'resize', event)}
          onpointermove={moveFloating}
          onpointerup={finishFloating}
          onpointercancel={(event) => finishFloating(event, true)}
          onlostpointercapture={(event) => finishFloating(event, true)}
          onkeydown={(event) => keyFloatingSize(panel, event)}></button>
      </section>
    {/if}
  {/if}
{/snippet}

<svelte:window onkeydown={hotkeys} onclick={outsideClick}/>

<div class="rust-editor" aria-label="LazyDesigner Rust native editor">
  <header class="rust-titlebar">
    <nav class="rust-menu-bar" aria-label="Editor menu">
      {#each ['file', 'edit', 'view'] as item}
        <div class="menu-holder">
          <button class="menubar-button" aria-expanded={menu === item}
            onclick={() => menu = menu === item ? null : item as Menu}>
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
          {#if menu === item}
            <div class="menu-popup" role="menu">
              {#if item === 'file'}
                <button role="menuitem" onclick={requestNew} disabled={busy || loading}>New Model <kbd>Ctrl+N</kbd></button>
                <button role="menuitem" onclick={requestOpen} disabled={busy || loading}>Open Model… <kbd>Ctrl+O</kbd></button>
                <button role="menuitem" onclick={() => void saveCopy()} disabled={!snapshot || busy}>Save Copy… <kbd>Ctrl+Shift+S</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => { closeMenus(); onLegacy(); }}>Legacy Workspace</button>
              {:else if item === 'edit'}
                <button role="menuitem" onclick={() => history('undo')} disabled={!snapshot?.canUndo || busy}>Undo <kbd>Ctrl+Z</kbd></button>
                <button role="menuitem" onclick={() => history('redo')} disabled={!snapshot?.canRedo || busy}>Redo <kbd>Ctrl+Y</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => void addCube()} disabled={!snapshot || busy}>Add Cube</button>
              {:else}
                <button role="menuitem" disabled={!snapshot || busy} onclick={() => { viewport?.frameModel(); closeMenus(); }}>Frame Model</button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => hideDock('textures', !dockLayout.hidden.textures)}>
                  {dockLayout.hidden.textures ? 'Show Textures' : 'Fold Textures'}
                </button>
                <button role="menuitem" onclick={() => hideDock('inspector', !dockLayout.hidden.inspector)}>
                  {dockLayout.hidden.inspector ? 'Show Outliner / Properties' : 'Fold Outliner / Properties'}
                </button>
                <button role="menuitem" onclick={swapDocks}>Swap Left / Right Docks</button>
                <button role="menuitem" onclick={() => attachTabs('left')}>Attach Panels as Tabs — Left</button>
                <button role="menuitem" onclick={() => attachTabs('right')}>Attach Panels as Tabs — Right</button>
                <button role="menuitem" disabled={dockLayout.attachedSide === null}
                  onclick={separateTabs}>Separate Attached Panels</button>
                <button role="menuitem" onclick={() => dockLayout.floating.textures
                  ? returnPanel('textures') : floatPanel('textures')}>
                  {dockLayout.floating.textures ? 'Dock Textures' : 'Float Textures'}
                </button>
                <button role="menuitem" onclick={() => dockLayout.floating.inspector
                  ? returnPanel('inspector') : floatPanel('inspector')}>
                  {dockLayout.floating.inspector ? 'Dock Outliner / Properties' : 'Float Outliner / Properties'}
                </button>
                <button role="menuitem" onclick={resetDocks}>Reset Dock Layout</button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </nav>
    <div class="document-name" title={snapshot?.sourceName ?? snapshot?.name ?? 'No active model'}>
      {snapshot?.name ?? 'LazyDesigner'}{#if snapshot?.dirty}<span aria-label="Unsaved changes"> •</span>{/if}
    </div>
    <div class="mode-tabs" role="group" aria-label="Editor mode">
      <span class="mode active" aria-current="page">Edit</span>
      <button class="mode" disabled title="Paint mode is not implemented yet">Paint</button>
      <button class="mode" disabled title="Animate mode is not implemented yet">Animate</button>
    </div>
  </header>

  <div class="editor-toolbar">
    <div class="tool-group" role="group" aria-label="Model actions">
      <button disabled={busy} onclick={requestNew}>New</button>
      <button disabled={busy} onclick={requestOpen}>Open</button>
      <button disabled={!snapshot || busy} onclick={() => void saveCopy()}>Save Copy</button>
    </div>
    <div class="tool-separator"></div>
    <div class="tool-group" role="group" aria-label="Edit operations">
      <button disabled={!snapshot || busy} onclick={() => void addCube()}>Add Cube</button>
      <button disabled={!snapshot?.canUndo || busy} onclick={() => history('undo')}>Undo</button>
      <button disabled={!snapshot?.canRedo || busy} onclick={() => history('redo')}>Redo</button>
    </div>
    <div class="tool-separator"></div>
    <div class="tool-group" role="group" aria-label="Viewport transform tools">
      <button class:active={moveTool} aria-pressed={moveTool}
        title="Move the selected Cube with the 3D gizmo"
        disabled={!snapshot || busy || loading}
        onclick={() => moveTool = !moveTool}>Move</button>
    </div>
    <div class="tool-spacer"></div>
    <button onclick={() => viewport?.frameModel()} disabled={!snapshot || busy}>Frame</button>
  </div>

  <div class="editor-body" bind:this={editorBody} style:grid-template-columns={gridTemplate}>
    {#if dockLayout.attachedSide === 'left'}
      {@render attachedDock('left')}
    {:else if dockLayout.attachedSide === 'right'}
      {@render attachedReturnRail('left')}
    {:else if dockLayout.leftPanel === 'textures'}
      {@render textureDock('left')}
    {:else}
      {@render inspectorDock('left')}
    {/if}
    <div class="dock-edge" role="separator" aria-label="Resize left dock" aria-controls="dock-left"
      aria-orientation="vertical" tabindex={measuredDocks.leftHidden ? -1 : 0}
      aria-valuemin={MIN_DOCK} aria-valuemax={MAX_DOCK}
      aria-valuenow={measuredDocks.leftWidth}
      class:inactive={measuredDocks.leftHidden}
      onpointerdown={(event) => startDockResize('left', event)}
      onpointermove={moveDockResize}
      onpointerup={finishDockResize}
      onpointercancel={(event) => finishDockResize(event, true)}
      onlostpointercapture={(event) => finishDockResize(event, true)}
      onkeydown={(event) => keyDockResize('left', event)}></div>
    <main class="editor-viewport" aria-label="Model edit viewport">
      {#if snapshot}
        <RustViewport bind:this={viewport} cubes={snapshot.cubes} bones={snapshot.bones}
          hierarchy={snapshot.hierarchy} {selectedId} onSelect={selectCube}
          canMove={moveTool && !busy && !loading && !newDialog && !confirmDiscard}
          onTranslate={moveFromViewport}/>
      {:else}
        <div class="empty-editor">
          <h2>{loading ? 'Loading editor…' : 'No model open'}</h2>
          <p>Create a Bedrock Entity project or open a compatible Blockbench .bbmodel.</p>
          <div class="empty-actions">
            <button onclick={requestNew} disabled={busy || loading}>New Model</button>
            <button onclick={requestOpen} disabled={busy || loading}>Open Model…</button>
          </div>
        </div>
      {/if}
    </main>


    <div class="dock-edge" role="separator" aria-label="Resize right dock" aria-controls="dock-right"
      aria-orientation="vertical" tabindex={measuredDocks.rightHidden ? -1 : 0}
      aria-valuemin={MIN_DOCK} aria-valuemax={MAX_DOCK}
      aria-valuenow={measuredDocks.rightWidth}
      class:inactive={measuredDocks.rightHidden}
      onpointerdown={(event) => startDockResize('right', event)}
      onpointermove={moveDockResize}
      onpointerup={finishDockResize}
      onpointercancel={(event) => finishDockResize(event, true)}
      onlostpointercapture={(event) => finishDockResize(event, true)}
      onkeydown={(event) => keyDockResize('right', event)}></div>
    {#if dockLayout.attachedSide === 'right'}
      {@render attachedDock('right')}
    {:else if dockLayout.attachedSide === 'left'}
      {@render attachedReturnRail('right')}
    {:else if dockLayout.leftPanel === 'textures'}
      {@render inspectorDock('right')}
    {:else}
      {@render textureDock('right')}
    {/if}
    {#if floatingGesture?.kind === 'move'}
      <div class="floating-drop-zone left" class:active={pendingDockSide === 'left'} aria-hidden="true">Dock Left</div>
      <div class="floating-drop-zone right" class:active={pendingDockSide === 'right'} aria-hidden="true">Dock Right</div>
    {/if}
    {@render floatingPanel('textures')}
    {@render floatingPanel('inspector')}
  </div>

  <footer class="editor-statusbar" aria-live="polite">
    <span>{snapshot ? snapshot.cubes.length + ' Cubes · ' + snapshot.bones.length + ' Bones' : 'No model'}</span>
    <span class="status-middle">{notice || (dockPersistenceError
      ? 'Dock layout is session-only; preferences cannot be saved'
      : snapshot ? (
      selectedId && moveTool
        ? 'Move gizmo · release to commit one Rust edit · visual parity unverified'
        : 'Untextured geometry preview · visual parity unverified'
    ) : 'Native Rust authoring core')}</span>
    <span>{snapshot ? 'Revision ' + snapshot.revision + (snapshot.dirty ? ' · Unsaved' : '') : 'Edit mode'}</span>
  </footer>

  {#if error}
    <div class="error-bar" role="alert">
      <span>{error}</span>
      <button onclick={() => error = ''} aria-label="Dismiss error">×</button>
    </div>
  {/if}
</div>

{#if newDialog}
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="new-model-title">
      <h2 id="new-model-title">New Bedrock Model</h2>
      <p>Creates an editable model using the Rust engine.</p>
      <form onsubmit={(event) => { event.preventDefault(); void commitNew(); }}>
        <label for="model-name">Model name</label>
        <input id="model-name" bind:this={nameInput} bind:value={newName} maxlength="80" required/>
        <div class="dialog-buttons">
          <button type="button" onclick={() => { newDialog = false; allowDiscard = false; }}>Cancel</button>
          <button type="submit" class="primary" disabled={busy || !newName.trim()}>Create</button>
        </div>
      </form>
    </section>
  </div>
{/if}

{#if confirmDiscard}
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p>The current model has unsaved edits. Export a copy before replacing the active session.</p>
      <div class="dialog-buttons">
        <button bind:this={discardCancel} onclick={() => confirmDiscard = null}>Cancel</button>
        <button class="danger" onclick={discardAndContinue}>Discard and continue</button>
      </div>
    </section>
  </div>
{/if}
