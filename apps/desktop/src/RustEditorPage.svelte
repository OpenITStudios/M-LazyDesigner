<script lang="ts">
  import './rust-editor.css';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, tick } from 'svelte';
  import RustViewport from './RustViewport.svelte';
  import { prepareBoneTransformPose, samplePreparedBoneTransformPose, projectedTransformTimelineRows } from './rustAnimationPose';
  import { supportedFaceUvRotation } from './rustTextureProjection';
  import { advanceAnimationPlayhead } from './rustAnimationPlayback';
  import { parseFiniteEditorNumber } from './rustNumericInput';
  import { reconcilePaintTextureSelection } from './rustPaintSelection';
  import { isPreviewTransportFailure, reconcileTexturePreview } from './rustSnapshotTransport';
  import { canChangeWorkspace, type WorkspaceMode } from './rustWorkspaceMode';
  import { extendPaintStroke, type PaintPoint } from './rustPaintStroke';
  import type { CubeView, EditorSnapshot, EditOperation, HierarchyNode, TransformChannel, TransformKeyframeView, Vec3, Vec4 } from './rustEditorTypes';
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
  type Row = { uuid: string; name: string; depth: number; kind: 'cube' | 'bone'; visible: boolean };

  let snapshot: EditorSnapshot | null = null;
  let selectedId: string | null = null;
  let selectedBoneId: string | null = null;
  // UI-only tool selection. Geometry and history remain Rust-owned.
  let transformTool: 'translate' | 'rotate' | 'scale' | null = 'translate';
  let selectedFace = 'north';
  let workspaceMode: WorkspaceMode = 'edit';
  // UI-only selection and input buffers; animation data is owned by Rust.
  let selectedAnimationId: string | null = null;
  let selectedKeyframeUuid: string | null = null;
  let newAnimationName = 'animation.new';
  let newAnimationLength = 1;
  let animationTime = 0;
  let animationChannel: TransformChannel = 'rotation';
  let animationValue: Vec3 = [0, 0, 0];
  // View-only requestAnimationFrame playback; it never writes to the Rust model.
  let playbackActive = false;
  let playbackFrame: number | null = null;
  let playbackPreviousTimestamp: number | null = null;
  let playbackSource: { epoch: number; revision: number; animationUuid: string } | null = null;
  let paintTextureIndex = 0;
  let requestedAtlasWidth = 128;
  let requestedAtlasHeight = 128;
  let paintColor = '#e53935';
  let paintAlpha = 255;
  let paintTool: 'pencil' | 'eraser' | 'rectangle' = 'pencil';
  let paintRadius = 1;
  let paintStroke: { pointerId: number; textureIndex: number; epoch: number; revision: number; points: PaintPoint[]; rgba: [number, number, number, number]; radius: number; erase: boolean; rectangle: boolean; overflow: boolean } | null = null;
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

  function makeRows(nodes: HierarchyNode[], cubes: CubeView[], bones: EditorSnapshot['bones'], folded: Set<string>): Row[] {
    const cubesById = new Map(cubes.map((cube) => [cube.uuid, cube] as const));
    const bonesById = new Map(bones.map((bone) => [bone.uuid, bone] as const));
    const rows: Row[] = [];
    function walk(items: HierarchyNode[], depth: number) {
      for (const item of items) {
        if (typeof item === 'string') {
          const cube = cubesById.get(item);
          rows.push({ uuid: item, name: cube?.name ?? 'Cube', depth, kind: 'cube', visible: cube?.visible ?? true });
        } else {
          const bone = bonesById.get(item.uuid);
          rows.push({ uuid: item.uuid, name: bone?.name ?? 'Bone', depth, kind: 'bone', visible: bone?.visible ?? true });
          if (!folded.has(item.uuid)) walk(item.children, depth + 1);
        }
      }
    }
    walk(nodes, 0);
    return rows;
  }

  $: selectedCube = snapshot?.cubes.find((cube) => cube.uuid === selectedId) ?? null;
  $: selectedBone = snapshot?.bones.find((bone) => bone.uuid === selectedBoneId) ?? null;
  $: selectedAnimation = snapshot?.animations.find((animation) => animation.uuid === selectedAnimationId)
    ?? snapshot?.animations[0] ?? null;
  $: selectedKeyframe = selectedAnimation?.transformKeyframes.find(
    (frame) => frame.uuid === selectedKeyframeUuid,
  ) ?? null;
  $: timelineRows = projectedTransformTimelineRows(
    selectedAnimation, snapshot?.bones ?? [],
  );
  // Group/validate/sort source keyframes only when the Rust animation
  // snapshot changes, not whenever requestAnimationFrame advances the time.
  $: preparedBonePose = prepareBoneTransformPose(selectedAnimation);
  // Derived view-only pose: Rust owns the animation and exported values.
  $: previewBoneTransforms = workspaceMode === 'animate'
    ? samplePreparedBoneTransformPose(preparedBonePose, animationTime) : null;
  $: rows = makeRows(snapshot?.hierarchy ?? [], snapshot?.cubes ?? [], snapshot?.bones ?? [], collapsed);
  $: faceUv = selectedCube?.faces[selectedFace]?.uv ?? [0, 0, 0, 0];
  $: faceRotation = supportedFaceUvRotation(selectedCube?.faces[selectedFace]);

  // Source-backed once/loop/hold playback is admitted only for the strict
  // numeric-linear projection. Stale snapshots and unknown clips pause.
  function pauseAnimationPlayback() {
    if (playbackFrame !== null) window.cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
    playbackPreviousTimestamp = null;
    playbackSource = null;
    playbackActive = false;
  }
  function stopAnimationPlayback() {
    pauseAnimationPlayback();
    animationTime = 0;
  }
  function animationPlaybackTick(timestamp: number) {
    playbackFrame = null;
    const current = selectedAnimation;
    if (!playbackActive || !playbackSource || !snapshot || busy || loading ||
        newDialog || confirmDiscard || paintStroke ||
        document.hidden || workspaceMode !== 'animate' ||
        snapshot.epoch !== playbackSource.epoch ||
        snapshot.revision !== playbackSource.revision ||
        !current?.previewSupported || current.uuid !== playbackSource.animationUuid ||
        current.transformKeyframes.length === 0) {
      pauseAnimationPlayback();
      return;
    }
    const elapsed = playbackPreviousTimestamp === null
      ? 0 : Math.max(0, timestamp - playbackPreviousTimestamp);
    playbackPreviousTimestamp = timestamp;
    const next = advanceAnimationPlayhead(
      animationTime, elapsed, current.length, current.loopMode,
    );
    if (!next) { pauseAnimationPlayback(); return; }
    animationTime = next.time;
    if (next.finished) {
      // Once resets to start; hold keeps its final pose. Loop never finishes.
      pauseAnimationPlayback();
      return;
    }
    playbackFrame = window.requestAnimationFrame(animationPlaybackTick);
  }
  function toggleAnimationPlayback() {
    if (playbackActive) { pauseAnimationPlayback(); return; }
    if (!snapshot || busy || loading || newDialog || confirmDiscard ||
        workspaceMode !== 'animate' || document.hidden ||
        !selectedAnimation?.previewSupported ||
        selectedAnimation.transformKeyframes.length === 0 ||
        selectedAnimation.length <= 0) return;
    playbackSource = {
      epoch: snapshot.epoch, revision: snapshot.revision,
      animationUuid: selectedAnimation.uuid,
    };
    if (animationTime >= selectedAnimation.length) animationTime = 0;
    playbackPreviousTimestamp = null;
    playbackActive = true;
    playbackFrame = window.requestAnimationFrame(animationPlaybackTick);
  }
  function onAnimationVisibilityChanged() {
    if (document.hidden) pauseAnimationPlayback();
  }
  function selectWorkspace(mode: WorkspaceMode) {
    if (!canChangeWorkspace(Boolean(snapshot), busy, loading, Boolean(paintStroke))) return;
    if (mode !== workspaceMode) pauseAnimationPlayback();
    workspaceMode = mode;
    closeMenus();
  }
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
  function toggleRowVisibility(row: Row) {
    if (!snapshot || busy || loading || paintStroke) return;
    // The Rust operation handles group descendants in one Undo transaction.
    apply([{ op: 'set_node_visibility', uuid: row.uuid, visible: !row.visible }]);
  }
  function showError(cause: unknown) {
    if (cause && typeof cause === 'object' && 'message' in cause &&
        typeof cause.message === 'string') error = cause.message;
    else if (typeof cause === 'string') error = cause;
    else error = 'The native authoring operation could not be completed.';
  }
  function accept(incoming: EditorSnapshot): EditorSnapshot {
    // A missing image body is valid only with the exact prior epoch and key.
    const next = reconcileTexturePreview(snapshot, incoming);
    // Any document receipt invalidates the frame-clock identity. Resume is
    // always explicit; never replay a stale animation after Undo/Open/Save.
    pauseAnimationPlayback();
    // The index identifies an atlas only within its owning Rust session.
    // A new model can have the same texture count but different texture data.
    paintTextureIndex = reconcilePaintTextureSelection(
      snapshot?.epoch ?? null, next.epoch, paintTextureIndex, next.textureNames.length,
    );
    if (snapshot && snapshot.epoch !== next.epoch) {
      selectedAnimationId = null;
      selectedKeyframeUuid = null;
      animationTime = 0;
      animationChannel = 'rotation';
      animationValue = [0, 0, 0];
    }
    snapshot = next;
    // Only an empty source model can change atlas dimensions; discard stale
    // UI drafts after any authoritative Rust snapshot or Undo receipt.
    requestedAtlasWidth = next.textureResolution[0];
    requestedAtlasHeight = next.textureResolution[1];
    if (selectedAnimationId && !next.animations.some((animation) => animation.uuid === selectedAnimationId)) {
      selectedAnimationId = null;
    }
    if (selectedId && !next.cubes.some((cube) => cube.uuid === selectedId)) selectedId = null;
    if (selectedBoneId && !next.bones.some((bone) => bone.uuid === selectedBoneId)) selectedBoneId = null;
    notice = '';
    return next;
  }
  async function command(name: string, args: Record<string, unknown>): Promise<EditorSnapshot | null> {
    if (busy) return null;
    busy = true; closeMenus(); error = '';
    try {
      const reuse = (name === 'rust_editor_apply' || name === 'rust_editor_undo' || name === 'rust_editor_redo')
        ? { knownPreviewSourceKey: snapshot?.previewSourceKey ?? null } : {};
      const next = await invoke<EditorSnapshot>(name, { ...args, ...reuse });
      return accept(next);
    } catch (cause) {
      if (isPreviewTransportFailure(cause)) {
        // Rust may have COMMITTED the edit before this derived IPC preview
        // was refused. Refresh once with the canonical full snapshot; never
        // replay an uncertain edit or reuse unverified texture buffers.
        try {
          const latest = await invoke<EditorSnapshot | null>('rust_editor_snapshot');
          if (latest) accept(latest);
          else {
            pauseAnimationPlayback();
            snapshot = null;
            selectedId = null;
            selectedBoneId = null;
          }
          error = 'Texture preview transfer was rejected. The model view has been refreshed from Rust; review it before editing again.';
        } catch (refreshError) {
          showError(refreshError);
        }
      } else {
        showError(cause);
      }
      return null;
    } finally { busy = false; }
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
  function openLegacyWorkspace() {
    closeMenus();
    // Legacy unmounts this native-close listener. Do not strand an unsaved
    // Rust model in the background with no active close protection.
    if (loading || busy || paintStroke || snapshot?.dirty) {
      error = 'Save a new .bbmodel copy before switching to Legacy Workspace.';
      return;
    }
    onLegacy();
  }
  type GeometryExportReceipt = { sha256: string; byteCount: number };
  type AnimationExportReceipt = GeometryExportReceipt & {
    curveFidelity: 'native' | 'adaptive_bezier_approximation';
  };
  async function exportGeometry() {
    if (!snapshot || busy || loading || paintStroke) return;
    const epoch = snapshot.epoch;
    const revision = snapshot.revision;
    busy = true; closeMenus(); error = '';
    try {
      const receipt = await invoke<GeometryExportReceipt | null>(
        'rust_editor_export_bedrock_geometry',
        { expectedEpoch: epoch, expectedRevision: revision },
      );
      if (receipt) {
        notice = 'Bedrock geometry exported (' + receipt.byteCount +
          ' bytes). The editable .bbmodel and history remain unchanged.';
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function exportAnimations() {
    if (!snapshot || busy || loading || paintStroke) return;
    const epoch = snapshot.epoch;
    const revision = snapshot.revision;
    busy = true; closeMenus(); error = '';
    try {
      const receipt = await invoke<AnimationExportReceipt | null>(
        'rust_editor_export_bedrock_animations',
        { expectedEpoch: epoch, expectedRevision: revision },
      );
      if (receipt) {
        notice = 'Bedrock animations exported (' + receipt.byteCount +
          ' bytes). The editable .bbmodel and history remain unchanged.' +
          (receipt.curveFidelity === 'adaptive_bezier_approximation'
            ? ' Bezier curves were approximated using bounded adaptive keyframes.' : '');
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
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
    if (!snapshot || transformTool !== 'translate' || busy || selectedId !== uuid) return false;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
      operations: [{ op: 'translate_cube', uuid, delta }],
    });
    await tick();
    return next !== null;
  }
  async function rotateFromViewport(uuid: string, rotation: Vec3): Promise<boolean> {
    if (!snapshot || transformTool !== 'rotate' || busy || selectedId !== uuid) return false;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
      operations: [{ op: 'set_cube_rotation', uuid, rotation }],
    });
    await tick();
    return next !== null;
  }
  async function scaleFromViewport(uuid: string, factors: Vec3): Promise<boolean> {
    if (!snapshot || transformTool !== 'scale' || busy || selectedId !== uuid) return false;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
      operations: [{ op: 'scale_cube', uuid, factors }],
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
  async function addBone() {
    if (!snapshot || busy) return;
    const parentUuid = selectedBoneId;
    const existing = new Set(snapshot.bones.map((bone) => bone.uuid));
    const next = await command('rust_editor_add_bone', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      parentUuid,
    });
    if (next) {
      selectedId = null;
      selectedBoneId = next.bones.find((bone) => !existing.has(bone.uuid))?.uuid ?? null;
      // A new child must remain reachable in the existing Outliner.
      if (parentUuid) {
        const opened = new Set(collapsed);
        opened.delete(parentUuid);
        collapsed = opened;
      }
    }
  }

  function revealOutlinerPath(nodes: HierarchyNode[], uuid: string, open: Set<string>): boolean {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node === uuid) return true;
      } else {
        if (node.uuid === uuid || revealOutlinerPath(node.children, uuid, open)) {
          open.delete(node.uuid);
          return true;
        }
      }
    }
    return false;
  }

  // Hierarchy navigation is read from the current Rust snapshot only.
  function outlinerParentId(nodes: HierarchyNode[], uuid: string, parent = ''): string {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node === uuid) return parent;
      } else {
        if (node.uuid === uuid) return parent;
        const found = outlinerParentId(node.children, uuid, node.uuid);
        if (found) return found;
      }
    }
    return '';
  }
  function boneContains(nodes: HierarchyNode[], ancestor: string, target: string): boolean {
    const descendantsContain = (children: HierarchyNode[]): boolean =>
      children.some((child) => typeof child !== 'string' &&
        (child.uuid === target || descendantsContain(child.children)));
    return nodes.some((node) => typeof node !== 'string' &&
      (node.uuid === ancestor
        ? descendantsContain(node.children)
        : boneContains(node.children, ancestor, target)));
  }

  async function renameSelected(uuid: string, previousName: string, input: HTMLInputElement) {
    // The Inspector only requests a typed Rust transaction. Neither Svelte
    // nor the Outliner owns a second name or animation-track data store.
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'edit') {
      input.value = previousName;
      return;
    }
    const name = input.value.trim();
    if (name === previousName) { input.value = previousName; return; }
    if (!name || [...name].length > 128 || [...name].some((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
      error = 'Enter a valid name (1–128 characters, without control characters).';
      input.value = previousName;
      return;
    }
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{ op: 'rename_node', uuid, name }],
    });
    // A failed or stale edit must never leave an uncommitted name in the UI.
    // Read back the authoritative Rust receipt, including a trimmed name.
    input.value = next?.cubes.find((cube) => cube.uuid === uuid)?.name ??
      next?.bones.find((bone) => bone.uuid === uuid)?.name ?? previousName;
  }

  async function reparentSelected(parentUuid: string | null) {
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'edit') return;
    const uuid = selectedId ?? selectedBoneId;
    if (!uuid) return;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{ op: 'reparent_node', uuid, parent_uuid: parentUuid }],
    });
    if (next) {
      const visible = new Set(collapsed);
      revealOutlinerPath(next.hierarchy, uuid, visible);
      collapsed = visible;
    }
  }
  async function duplicateSelectedCube() {
    if (!snapshot || !selectedId || busy || loading || workspaceMode !== 'edit') return;
    const sourceUuid = selectedId;
    const oldIds = new Set(snapshot.cubes.map((cube) => cube.uuid));
    const next = await command('rust_editor_duplicate_cube', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      sourceUuid,
    });
    if (!next) return;
    const duplicate = next.cubes.find((cube) => !oldIds.has(cube.uuid));
    if (!duplicate) return;
    selectedId = duplicate.uuid;
    selectedBoneId = null;
    const open = new Set(collapsed);
    revealOutlinerPath(next.hierarchy, duplicate.uuid, open);
    collapsed = open;
  }
  async function deleteSelected() {
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'edit') return;
    const operation: EditOperation | null = selectedId
      ? { op: 'remove_cube', uuid: selectedId }
      : selectedBoneId ? { op: 'remove_empty_bone', uuid: selectedBoneId } : null;
    if (!operation) return;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [operation],
    });
    if (next) { selectedId = null; selectedBoneId = null; }
  }

  function updateAnimationLength(text: string) {
    const value = parseFiniteEditorNumber(text);
    if (value === null || value <= 0 || value > 3600) {
      error = 'Animation length must be between 0 and 3600 seconds.';
      return;
    }
    newAnimationLength = value;
  }
  async function setSelectedAnimationLength(input: HTMLInputElement) {
    const selected = selectedAnimation;
    if (!snapshot || !selected || !selected.previewSupported ||
        busy || loading || workspaceMode !== 'animate') {
      if (selected) input.value = String(selected.length);
      return;
    }
    const length = parseFiniteEditorNumber(input.value);
    if (length === null || length < 0 || length > 3600) {
      error = 'Clip length must be a finite number between 0 and 3600 seconds.';
      input.value = String(selected.length);
      return;
    }
    if (length === selected.length) return;
    pauseAnimationPlayback();
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{
        op: 'set_animation_length', animation_uuid: selected.uuid, length,
      }],
    });
    // Refuse silently dropping keyframes when shortening; the Rust Core
    // rejects conflicting lengths and leaves the original clip intact.
    const updated = next?.animations.find((animation) => animation.uuid === selected.uuid);
    input.value = String(updated?.length ?? selected.length);
    if (updated && selectedAnimation?.uuid === selected.uuid) {
      animationTime = Math.min(animationTime, updated.length);
      notice = 'Animation length saved. Keyframes and Bone tracks were preserved.';
    }
  }

  function selectTransformKeyframe(frame: TransformKeyframeView) {
    pauseAnimationPlayback();
    selectedKeyframeUuid = frame.uuid;
    selectedId = null;
    selectedBoneId = frame.boneUuid;
    animationChannel = frame.channel;
    animationTime = frame.time;
    animationValue = [...frame.value] as Vec3;
  }
  function selectAnimationChannel(channel: TransformChannel) {
    if (channel === animationChannel) return;
    pauseAnimationPlayback();
    animationChannel = channel;
    selectedKeyframeUuid = null;
    animationValue = channel === 'scale' ? [1, 1, 1] : [0, 0, 0];
  }

  function updateAnimationTime(text: string) {
    pauseAnimationPlayback();
    const value = parseFiniteEditorNumber(text);
    if (value === null || value < 0 || !selectedAnimation || value > selectedAnimation.length) {
      error = 'Keyframe time must be inside the selected animation.';
      return;
    }
    animationTime = value;
  }
  function updateAnimationAxis(axis: number, text: string) {
    pauseAnimationPlayback();
    const value = parseFiniteEditorNumber(text);
    if (value === null || (animationChannel === 'scale'
      ? value < 0 || value > 100 : Math.abs(value) > 100_000)) {
      error = animationChannel === 'scale'
        ? 'Scale must be between 0 and 100 for the supported preview.'
        : 'Transform value must be finite and inside the supported limit.';
      return;
    }
    const next = [...animationValue] as Vec3;
    next[axis] = value;
    animationValue = next;
  }
  async function createAnimation() {
    if (!snapshot || busy || loading || !newAnimationName.trim()) return;
    const old = new Set(snapshot.animations.map((animation) => animation.uuid));
    const next = await command('rust_editor_create_animation', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      name: newAnimationName.trim(), length: newAnimationLength,
    });
    if (next) {
      selectedAnimationId = next.animations.find((animation) => !old.has(animation.uuid))?.uuid ?? null;
      selectedKeyframeUuid = null;
      animationTime = 0;
      animationChannel = 'rotation';
      animationValue = [0, 0, 0];
    }
  }
  async function addTransformKeyframe() {
    if (!snapshot || !selectedAnimation?.previewSupported || !selectedBoneId ||
        busy || loading || workspaceMode !== 'animate') return;
    if (animationTime < 0 || animationTime > selectedAnimation.length) {
      error = 'Keyframe time must be inside the selected animation.';
      return;
    }
    const animationUuid = selectedAnimation.uuid;
    const keyframeUuid = crypto.randomUUID();
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{
        op: 'add_bone_transform_keyframe', animation_uuid: animationUuid,
        bone_uuid: selectedBoneId, keyframe_uuid: keyframeUuid,
        channel: animationChannel, time: animationTime, value: animationValue,
      }],
    });
    if (next) {
      selectedKeyframeUuid = next.animations.find((item) =>
        item.uuid === animationUuid)?.transformKeyframes.find((frame) =>
        frame.uuid === keyframeUuid)?.uuid ?? null;
      notice = animationChannel + ' keyframe saved in Rust.';
    }
  }
  async function updateTransformKeyframe() {
    if (!snapshot || !selectedAnimation?.previewSupported || !selectedKeyframe ||
        busy || loading || workspaceMode !== 'animate') return;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{
        op: 'update_bone_transform_keyframe',
        animation_uuid: selectedAnimation.uuid,
        bone_uuid: selectedKeyframe.boneUuid,
        keyframe_uuid: selectedKeyframe.uuid,
        channel: selectedKeyframe.channel,
        time: animationTime, value: animationValue,
      }],
    });
    if (next) notice = 'Transform keyframe updated in Rust.';
  }
  async function removeTransformKeyframe() {
    if (!snapshot || !selectedAnimation?.previewSupported || !selectedKeyframe ||
        busy || loading || workspaceMode !== 'animate') return;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{
        op: 'remove_bone_transform_keyframe',
        animation_uuid: selectedAnimation.uuid,
        bone_uuid: selectedKeyframe.boneUuid,
        keyframe_uuid: selectedKeyframe.uuid,
        channel: selectedKeyframe.channel,
      }],
    });
    if (next) {
      selectedKeyframeUuid = null;
      notice = 'Transform keyframe removed; Undo restores it.';
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

  function boneRotation(axis: number, text: string) {
    if (!selectedBone || workspaceMode !== 'edit') return;
    const value = parseFiniteEditorNumber(text);
    if (value === null) { error = 'Enter a finite decimal Bone rotation angle.'; return; }
    const angles = [...selectedBone.rotation] as Vec3;
    angles[axis] = value;
    if (angles[axis] !== selectedBone.rotation[axis]) {
      apply([{ op: 'set_bone_rotation', uuid: selectedBone.uuid, rotation: angles }]);
    }
  }

  function boxOffset(axis: number, text: string) {
    if (!selectedCube || !selectedCube.boxUv) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null || !Number.isInteger(value)) {
      error = 'Box UV offset must be a finite integer.';
      return;
    }
    const offset: [number, number] = [...selectedCube.uvOffset];
    offset[axis] = value;
    if (offset[axis] !== selectedCube.uvOffset[axis]) {
      apply([{ op: 'set_box_uv_offset', uuid: selectedCube.uuid, offset }]);
    }
  }

  async function newPaintTexture() {
    if (!snapshot || busy || loading || !!paintStroke || workspaceMode !== 'paint' ||
        !snapshot.paintTextureAddable) {
      error = 'New Paint textures require a supported atlas, fewer than 16 textures, and no per-texture UV rules.';
      return;
    }
    const before = snapshot.textureNames.length;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch,
      expectedRevision: snapshot.revision,
      operations: [{
        op: 'create_paint_texture', uuid: crypto.randomUUID(),
        name: 'paint_' + (before + 1) + '.png',
      }],
    });
    if (next) paintTextureIndex = before;
  }


  function setEmptyAtlasResolution() {
    if (!snapshot || busy || loading || paintStroke ||
        workspaceMode !== 'paint' || !snapshot.atlasResolutionEditable) return;
    const width = requestedAtlasWidth, height = requestedAtlasHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        width < 1 || height < 1 || width > 256 || height > 256) {
      error = 'Atlas width and height must each be integers from 1 to 256.';
      return;
    }
    if (width === snapshot.textureResolution[0] &&
        height === snapshot.textureResolution[1]) return;
    apply([{ op: 'set_empty_atlas_resolution', width, height }]);
  }

  async function importPngTexture() {
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'paint' ||
        !snapshot.paintTextureAddable) return;
    const epoch = snapshot.epoch;
    const revision = snapshot.revision;
    const previousCount = snapshot.textureNames.length;
    busy = true;
    closeMenus();
    error = '';
    try {
      // Native Rust owns file selection and validation. The approved embedded
      // PNG may appear in the existing bounded snapshot preview, not as a path.
      const next = await invoke<EditorSnapshot | null>('rust_editor_import_paint_png', {
        expectedEpoch: epoch, expectedRevision: revision,
      });
      if (next) {
        accept(next);
        paintTextureIndex = previousCount;
        notice = next.texturePreviewSources[previousCount]
          ? 'Embedded RGBA8 PNG imported. Select a Cube to assign it; no existing UV was changed.'
          : 'PNG imported, but preview is unavailable under the current project texture budget.';
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  type PaintPngExportReceipt = { sha256: string; byteCount: number };
  async function exportPngTexture() {
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'paint' ||
        !snapshot.paintExportableTextures[paintTextureIndex]) return;
    const textureUuid = snapshot.textureUuids[paintTextureIndex];
    if (!textureUuid) return;
    const epoch = snapshot.epoch;
    const revision = snapshot.revision;
    busy = true;
    closeMenus();
    error = '';
    try {
      const receipt = await invoke<PaintPngExportReceipt | null>('rust_editor_export_paint_png', {
        expectedEpoch: epoch, expectedRevision: revision, textureUuid,
      });
      if (receipt) notice = 'PNG exported (' + receipt.byteCount +
        ' bytes). The Rust model and original files remain unchanged.';
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  async function assignSelectedTexture() {
    if (!snapshot || busy || loading || paintStroke || workspaceMode !== 'paint' ||
        snapshot.scopedTexturePreview ||
        !selectedId || !snapshot.texturePreviewSources[paintTextureIndex]) return;
    const textureUuid = snapshot.textureUuids[paintTextureIndex];
    if (!textureUuid) return;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{
        op: 'assign_cube_texture', cube_uuid: selectedId, texture_uuid: textureUuid,
      }],
    });
    if (next) notice = 'Texture assigned to supported Cube faces. Face UV and hidden faces were preserved.';
  }

  async function enableImportedPaintTexture() {
    if (!snapshot || busy || loading || paintStroke ||
        !snapshot.paintAdoptableTextures[paintTextureIndex] ||
        !snapshot.texturePreviewSources[paintTextureIndex]) return;
    const index = paintTextureIndex;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{ op: 'enable_imported_paint_texture', texture_index: index }],
    });
    if (next) notice = 'Imported RGBA8 PNG validated for painting; the original bitmap is unchanged until the first stroke.';
  }

  function paintPoint(event: PointerEvent, target: HTMLImageElement): PaintPoint | null {
    if (!snapshot) return null;
    const rect = target.getBoundingClientRect();
    const [width, height] = snapshot.textureResolution;
    if (!rect.width || !rect.height) return null;
    const x = Math.floor((event.clientX - rect.left) / rect.width * width);
    const y = Math.floor((event.clientY - rect.top) / rect.height * height);
    return x >= 0 && y >= 0 && x < width && y < height ? [x, y] : null;
  }

  function startPaintStroke(event: PointerEvent) {
    if (!snapshot || busy || paintStroke || event.button !== 0 ||
        !snapshot.paintEditableTextures[paintTextureIndex]) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLImageElement)) return;
    const first = paintPoint(event, target);
    if (!first || !/^#[0-9a-fA-F]{6}$/.test(paintColor) ||
        !Number.isInteger(paintAlpha) || paintAlpha < 0 || paintAlpha > 255 ||
        !Number.isInteger(paintRadius) || paintRadius < 1 || paintRadius > 8) return;
    const rgba: [number, number, number, number] = [
      parseInt(paintColor.slice(1, 3), 16), parseInt(paintColor.slice(3, 5), 16),
      parseInt(paintColor.slice(5, 7), 16), paintAlpha,
    ];
    paintStroke = {
      pointerId: event.pointerId, textureIndex: paintTextureIndex,
      epoch: snapshot.epoch, revision: snapshot.revision, points: [first], rgba,
      radius: paintRadius, erase: paintTool === 'eraser',
      rectangle: paintTool === 'rectangle', overflow: false,
    };
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePaintStroke(event: PointerEvent) {
    const stroke = paintStroke;
    if (!stroke || stroke.pointerId !== event.pointerId || !snapshot || stroke.overflow) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLImageElement)) return;
    const point = paintPoint(event, target);
    // Outside the atlas: do not extrapolate or paint unintended edges.
    if (!point) return;
    const [width, height] = snapshot.textureResolution;
    if (stroke.rectangle) {
      paintStroke = { ...stroke, points: [stroke.points[0], point] };
      return;
    }
    const next = extendPaintStroke(stroke.points, point, width, height);
    if (next) paintStroke = { ...stroke, points: next };
    else paintStroke = { ...stroke, overflow: true };
  }

  function finishPaintStroke(event: PointerEvent, cancelled = false) {
    const captured = paintStroke;
    if (!captured || captured.pointerId !== event.pointerId) return;
    // A quick drag may have no final pointermove. Include its pointerup
    // position before committing, but never sample on cancel/lost capture.
    if (!cancelled) movePaintStroke(event);
    const stroke = paintStroke ?? captured;
    paintStroke = null;
    const target = event.currentTarget;
    if (target instanceof HTMLImageElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    if (cancelled) return;
    if (stroke.overflow) {
      error = 'Stroke exceeds the 4,096-point limit. No pixels were changed.';
      return;
    }
    if (!snapshot || busy ||
        snapshot.epoch !== stroke.epoch || snapshot.revision !== stroke.revision ||
        !snapshot.paintEditableTextures[stroke.textureIndex]) return;
    if (stroke.rectangle) {
      apply([{ op: 'paint_texture_rectangle', texture_index: stroke.textureIndex,
        from: stroke.points[0], to: stroke.points[stroke.points.length - 1],
        rgba: stroke.rgba, erase: false }]);
    } else {
      apply([{ op: 'paint_texture_brush', texture_index: stroke.textureIndex,
        points: stroke.points, radius: stroke.radius,
        rgba: stroke.rgba, erase: stroke.erase }]);
    }
    event.preventDefault();
  }

  function uvEdit(index: number, text: string) {
    if (!selectedCube || selectedCube.boxUv) return;
    const value = parseFiniteEditorNumber(text);
    if (value === null) { error = 'Enter a finite decimal UV coordinate.'; return; }
    const uv = [...faceUv] as Vec4; uv[index] = value;
    if (uv[index] !== faceUv[index]) apply([{ op: 'set_face_uv', uuid: selectedCube.uuid, face: selectedFace, uv }]);
  }
  function uvRotate(text: string) {
    if (!selectedCube || selectedCube.boxUv || busy || loading || workspaceMode !== 'edit') return;
    const rotation = Number(text);
    if (faceRotation === null || ![0, 90, 180, 270].includes(rotation)) {
      error = 'Unsupported UV rotation. Use 0°, 90°, 180° or 270°.';
      return;
    }
    if (rotation !== faceRotation) {
      apply([{ op: 'set_face_uv_rotation', uuid: selectedCube.uuid,
        face: selectedFace, rotation }]);
    }
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
    // Same rename control as the Inspector. F2 changes only keyboard focus;
    // the actual label mutation still requires a Rust EditOperation.
    if (event.key === 'F2' && !loading && !paintStroke &&
        workspaceMode === 'edit' && (selectedId || selectedBoneId)) {
      const id = selectedId ?? selectedBoneId;
      const input = document.getElementById(
        'rust-' + (selectedId ? 'cube' : 'bone') + '-name-' + id,
      );
      if (input instanceof HTMLInputElement && !input.disabled) {
        event.preventDefault(); input.focus(); input.select();
      }
      return;
    }
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
    document.addEventListener('visibilitychange', onAnimationVisibilityChanged);
    window.addEventListener('blur', pauseAnimationPlayback);
    // Protect the Rust model before a native window close. The document
    // and its dirty flag remain owned by the same Rust/Tauri session.
    let disposed = false;
    let unlistenClose: (() => void) | null = null;
    if (isTauri()) {
      void getCurrentWindow().onCloseRequested((event) => {
        if (loading || busy) {
          // Never discard an active native save or edit transaction.
          event.preventDefault();
          return;
        }
        if (snapshot?.dirty || paintStroke) {
          try {
            const discard = window.confirm(
              'This Rust model has unsaved changes. Close without saving them?'
            );
            if (!discard) event.preventDefault();
          } catch {
            // A failed dialog must not silently lose unsaved changes.
            event.preventDefault();
          }
        }
      }).then((unlisten) => {
        if (disposed) unlisten();
        else unlistenClose = unlisten;
      }).catch(() => {
        error = 'Close protection is unavailable. Save a model copy before exiting.';
      });
    }
    void load();
    return () => {
      disposed = true;
      unlistenClose?.();
      pauseAnimationPlayback();
      document.removeEventListener('visibilitychange', onAnimationVisibilityChanged);
      window.removeEventListener('blur', pauseAnimationPlayback);
      observer.disconnect();
    };
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
            <button type="button" class="texture-item" class:active={paintTextureIndex === index}
              aria-pressed={paintTextureIndex === index} title={name}
              disabled={!!paintStroke} onclick={() => paintTextureIndex = index}>
              <span class="texture-square"></span><span>{name}</span><small>{index + 1}</small>
            </button>
          {/each}
        </div>
      {:else}
        <p class="empty-label">No textures</p>
      {/if}
      <p class="dock-note">Generated textures can be painted directly. Compatible imported RGBA8 PNGs may be enabled explicitly in Paint.</p>
   {/if}
  </aside>
{/snippet}

{#snippet paintWorkspace()}
  <section class="paint-workspace" aria-label="Paint workspace">
    <div class="paint-workspace-heading">
      <div><strong>Paint</strong><p>Pixel atlas · Rust-owned strokes and Undo/Redo</p></div>
      <span>RGBA8 · 256 × 256 maximum · {snapshot?.scopedTexturePreview
        ? '3D preview follows Cube scopes' : '3D preview follows Paint texture selection'}</span>
    </div>
    {#if snapshot}
      <section class="paint-starter paint-workspace-tools" aria-label="Basic Rust-owned Paint">
          <div class="dock-title"><span>ATLAS &amp; BRUSH</span></div>
          {#if snapshot.atlasResolutionEditable}
            <div class="paint-atlas-resolution" role="group" aria-label="New empty model atlas size">
              <label>Atlas width
                <input type="number" min="1" max="256" step="1"
                  bind:value={requestedAtlasWidth} disabled={busy || loading}/>
              </label>
              <label>Atlas height
                <input type="number" min="1" max="256" step="1"
                  bind:value={requestedAtlasHeight} disabled={busy || loading}/>
              </label>
              <button type="button" onclick={setEmptyAtlasResolution}
                disabled={busy || loading || !Number.isInteger(requestedAtlasWidth) ||
                  !Number.isInteger(requestedAtlasHeight) ||
                  requestedAtlasWidth < 1 || requestedAtlasWidth > 256 ||
                  requestedAtlasHeight < 1 || requestedAtlasHeight > 256}
                title="Apply project atlas dimensions before creating Cubes, textures or animations">
                Set Atlas Size
              </button>
            </div>
            <p class="hint">Choose the atlas size before importing PNG or adding model elements; existing model UV is never resized implicitly.</p>
          {/if}
          <button type="button" onclick={() => void newPaintTexture()} disabled={busy || loading ||
            !!paintStroke || !snapshot.paintTextureAddable}>
            New RGBA8 Texture
          </button>
          <button type="button" onclick={() => void importPngTexture()}
            disabled={busy || loading || !!paintStroke || !snapshot.paintTextureAddable}
            title="Choose a local RGBA8 PNG with the same dimensions as this project; the source file is never modified">
            Import PNG…
          </button>
          <p class="hint">Import accepts embedded RGBA8 PNG at {snapshot.textureResolution[0]} × {snapshot.textureResolution[1]} px (up to 1 MiB); the local file is not modified.</p>
          {#if snapshot.paintAdoptableTextures[paintTextureIndex] &&
            snapshot.texturePreviewSources[paintTextureIndex]}
            <button type="button" onclick={() => void enableImportedPaintTexture()}
              disabled={busy || loading || !!paintStroke}
              title="Validate this embedded RGBA8 PNG before enabling direct edits">
              Enable Painting for Imported PNG
            </button>
            <p class="hint">Opt in to edit this compatible imported PNG. Original PNG bytes are unchanged until the first stroke; Undo restores the prior state.</p>
          {/if}
          {#if snapshot.textureNames.length}
            <label>Texture
              <select bind:value={paintTextureIndex} disabled={busy || !!paintStroke}>
                {#each snapshot.textureNames as name, i}
                  <option value={i}>{name}</option>
                {/each}
              </select>
            </label>
            <button type="button" onclick={() => void exportPngTexture()}
              disabled={busy || loading || !!paintStroke ||
                !snapshot.paintExportableTextures[paintTextureIndex] ||
                !snapshot.textureUuids[paintTextureIndex]}
              title="Export the exact validated embedded RGBA8 PNG bytes as a new file; never overwrite originals">
              Export PNG…
            </button>
            <button type="button" onclick={() => void assignSelectedTexture()}
              disabled={busy || loading || !!paintStroke || !selectedId ||
                snapshot.scopedTexturePreview ||
                !snapshot.textureUuids[paintTextureIndex] ||
                !snapshot.texturePreviewSources[paintTextureIndex]}
              title="Assign this texture to all non-null faces of the selected Cube; keep face UV and invisible faces unchanged">
              Apply Texture to Cube
            </button>
            {#if snapshot.scopedTexturePreview}
              <p class="hint">Scoped attachable materials are preview-only; global Cube texture assignment is unsupported.</p>
            {/if}
            {#if !selectedId}
              <p class="hint">Select a Cube in the Outliner to apply the chosen texture.</p>
            {/if}
          {/if}
          {#if snapshot.paintEditableTextures[paintTextureIndex] &&
            snapshot.texturePreviewSources[paintTextureIndex]}
            <label>Tool
              <select bind:value={paintTool} disabled={busy || !!paintStroke}>
                <option value="pencil">Pencil</option>
                <option value="eraser">Eraser</option>
                <option value="rectangle">Filled Rectangle</option>
              </select>
            </label>
            {#if paintTool !== 'rectangle'}
              <label>Radius
                <input type="number" min="1" max="8" step="1" bind:value={paintRadius}
                  disabled={busy || !!paintStroke}/>
              </label>
            {/if}
            <label>Color <input type="color" bind:value={paintColor}
              disabled={busy || !!paintStroke || paintTool === 'eraser'}/></label>
            <label>Alpha
              <input type="number" min="0" max="255" step="1" bind:value={paintAlpha} disabled={busy || !!paintStroke}/>
            </label>
            <img class="paint-atlas paint-workspace-atlas" draggable="false"
              src={snapshot.texturePreviewSources[paintTextureIndex] ?? ''}
              alt="Editable texture atlas; drag to paint one Rust-owned stroke"
              onpointerdown={startPaintStroke} onpointermove={movePaintStroke}
              onpointerup={finishPaintStroke}
              onpointercancel={(event) => finishPaintStroke(event, true)}
              onlostpointercapture={(event) => finishPaintStroke(event, true)}/>
            <p class="dock-note">Pencil and Eraser use circular strokes. Filled Rectangle uses two corners. Each completed gesture is one Rust Undo step. Atlas selection changes only the Paint preview, not saved model face references.</p>
          {:else}
            <p class="dock-note">Only LazyDesigner-owned or explicitly enabled embedded RGBA8 PNGs can be painted. External paths, layers and unsupported formats stay read-only.</p>
          {/if}
        </section>
    {/if}
  </section>
{/snippet}


{#snippet animateWorkspace()}
  <section class="animate-workspace" aria-label="Rust animation keyframe editor">
    <div class="animate-heading">
      <strong>Animate · Bone transforms</strong>
      <span>Rust-owned .bbmodel · Once-only linear Rotation / Position / Scale · No effects or Molang</span>
    </div>
    {#if snapshot}
      <div class="animate-create">
        <label>Animation name
          <input type="text" bind:value={newAnimationName} maxlength="128" disabled={busy}/>
        </label>
        <label>Length (seconds)
          <input type="number" min="0.001" max="3600" step="any"
            value={newAnimationLength} disabled={busy}
            onchange={(event) => updateAnimationLength(event.currentTarget.value)}/>
        </label>
        <button type="button" disabled={busy || loading || !newAnimationName.trim()}
          onclick={() => void createAnimation()}>New Animation</button>
      </div>
      {#if snapshot.animations.length}
        <div class="animate-list" aria-label="Animation selection">
          {#each snapshot.animations as animation}
            <button type="button" class:active={selectedAnimation?.uuid === animation.uuid}
              aria-pressed={selectedAnimation?.uuid === animation.uuid}
              onclick={() => {
                pauseAnimationPlayback();
                selectedAnimationId = animation.uuid;
                selectedKeyframeUuid = null;
                animationTime = 0;
                animationChannel = 'rotation';
                animationValue = [0, 0, 0];
              }}>
              {animation.name} ({animation.length}s)
            </button>
          {/each}
        </div>
      {:else}
        <p class="hint">Create an Animation to begin. Existing imported animation data remains preserved.</p>
      {/if}
      {#if selectedAnimation}
        <section class="animate-track" aria-label="Selected animation timeline">
          <div class="animate-track-title">
            <strong>{selectedAnimation.name}</strong>
            <span>Length {selectedAnimation.length}s · {selectedAnimation.transformKeyframes.length} supported transform keyframes</span>
          </div>
          <label class="animate-clip-length">Selected clip length (seconds)
            <input type="number" min="0" max="3600" step="any"
              aria-label="Edit selected animation length"
              value={selectedAnimation.length}
              disabled={busy || loading || !selectedAnimation.previewSupported}
              onchange={(event) => void setSelectedAnimationLength(event.currentTarget)}/>
          </label>
          <p class="hint">Length edits are Rust Undo steps. Shortening cannot delete or move existing keyframes; a conflicting length is refused. Unsupported imported tracks stay read-only.</p>
          <p class="hint">Select a Bone, choose a Rotation/Position/Scale channel and enter numeric values. Scale is limited to 0–100; negative scales remain unsupported.</p>
          {#if selectedAnimation.previewSupported}
            <div class="animate-playback-controls" role="group" aria-label="Bone transform pose playback controls">
              <button type="button" aria-pressed={playbackActive}
                disabled={busy || loading || selectedAnimation.length <= 0 ||
                  selectedAnimation.transformKeyframes.length === 0}
                onclick={toggleAnimationPlayback}>
                {playbackActive ? 'Pause' : 'Play'}
              </button>
              <button type="button" disabled={busy || (!playbackActive && animationTime === 0)}
                onclick={stopAnimationPlayback}>Stop</button>
              <span>Once · 1× · {animationTime.toFixed(2)}s / {selectedAnimation.length}s</span>
            </div>
            <label class="animate-scrub">Scrub Bone pose: {animationTime.toFixed(2)}s
              <input type="range" min="0" max={selectedAnimation.length}
                step="0.01" bind:value={animationTime}
                oninput={pauseAnimationPlayback}
                disabled={busy || selectedAnimation.length <= 0}
                aria-label="Scrub static Bone transform pose"/>
            </label>
            <p class="hint">Play/Pause previews only supported numeric linear Bone Rotation, Position and Scale. No sound, effects, Molang, loop or controller evaluation.</p>
            {#if timelineRows.length > 0}
              <div class="animate-timeline" aria-label="Bone transform keyframe timeline">
                {#each timelineRows as row (row.boneUuid + ':' + row.channel)}
                  <div class="animate-timeline-row">
                    <span class="animate-timeline-bone" title={row.boneName + ' · ' + row.channel}>{row.boneName} · {row.channel}</span>
                    <div class="animate-timeline-lane" role="group"
                      aria-label={row.channel + ' keyframes for ' + row.boneName}>
                      {#each row.frames as frame (frame.uuid)}
                        <button type="button" class="animate-timeline-marker"
                          class:active={selectedKeyframeUuid === frame.uuid}
                          aria-pressed={selectedKeyframeUuid === frame.uuid}
                          aria-label={row.boneName + ' ' + row.channel + ' keyframe at ' + frame.time + ' seconds'}
                          title={row.boneName + ' · ' + row.channel + ' · ' + frame.time + 's'}
                          style:left={(selectedAnimation.length > 0
                            ? (frame.time / selectedAnimation.length) * 100 : 0) + '%'}
                          disabled={busy || loading}
                          onclick={() => selectTransformKeyframe(frame)}></button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <p class="hint">Pose preview unavailable: this Animation contains unsupported tracks, expressions or interpolation. Original data is preserved.</p>
          {/if}
          <div class="animate-keyframe-editor">
            <label>Transform channel
              <select value={animationChannel}
                disabled={busy || loading || !selectedAnimation.previewSupported}
                aria-label="Select Bone transform channel"
                onchange={(event) => selectAnimationChannel(
                  event.currentTarget.value as TransformChannel)}>
                <option value="rotation">Rotation (degrees)</option>
                <option value="position">Position (offset)</option>
                <option value="scale">Scale (multiplier)</option>
              </select>
            </label>
            <label>Time (seconds)
              <input type="number" min="0" max={selectedAnimation.length} step="any"
                value={animationTime} disabled={busy}
                onchange={(event) => updateAnimationTime(event.currentTarget.value)}/>
            </label>
            {#each [0, 1, 2] as axis}
              <label>{animationChannel} {AXES[axis]}
                <input type="number" step="any" value={animationValue[axis]} disabled={busy}
                  onchange={(event) => updateAnimationAxis(axis, event.currentTarget.value)}/>
              </label>
            {/each}
            <button type="button" disabled={busy || !selectedBoneId || !selectedAnimation.previewSupported}
              onclick={() => void addTransformKeyframe()}>Add {animationChannel} Keyframe</button>
            <button type="button" disabled={busy || !selectedKeyframe || !selectedAnimation.previewSupported}
              onclick={() => void updateTransformKeyframe()}>Update Selected Keyframe</button>
            <button type="button" disabled={busy || !selectedKeyframe || !selectedAnimation.previewSupported}
              title="Remove only the selected supported keyframe; Undo restores it"
              onclick={() => void removeTransformKeyframe()}>Delete Selected Keyframe</button>
          </div>
          <p class="hint">Target Bone: {snapshot.bones.find((bone) => bone.uuid === selectedBoneId)?.name ?? 'Select a Bone in Outliner'}</p>
          <div class="animate-keyframe-list" aria-label="Existing supported transform keyframes">
            {#each selectedAnimation.transformKeyframes as frame}
              <button type="button" class:active={selectedKeyframe?.uuid === frame.uuid}
                aria-pressed={selectedKeyframe?.uuid === frame.uuid}
                title={'Select ' + frame.channel + ' keyframe at ' + frame.time + ' seconds'}
                onclick={() => selectTransformKeyframe(frame)}>
                {frame.time}s · {snapshot.bones.find((bone) => bone.uuid === frame.boneUuid)?.name ?? frame.boneUuid}
                · {frame.channel} [{frame.value.join(', ')}]
              </button>
            {/each}
          </div>
        </section>
      {/if}
      {#if snapshot.animationCount > snapshot.animations.length}
        <p class="hint">Only the first 256 supported Animation records are projected; all source data is preserved.</p>
      {/if}
    {/if}
  </section>
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
                class:muted={!row.visible}
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
                <button type="button" class="outliner-visibility" class:is-hidden={!row.visible}
                  disabled={busy || loading || !!paintStroke}
                  aria-label={(row.visible ? 'Hide ' : 'Show ') + row.kind + ' ' + row.name}
                  title={(row.visible ? 'Hide ' : 'Show ') + row.kind + (row.kind === 'bone' ? ' and descendants' : '')}
                  onclick={() => toggleRowVisibility(row)}>{row.visible ? 'Hide' : 'Show'}</button>
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
            <div class="property-group">
              <label for={'rust-cube-name-' + selectedCube.uuid}>Cube name</label>
              <input id={'rust-cube-name-' + selectedCube.uuid} class="node-name-input"
                aria-label="Rename selected Cube" type="text" maxlength="128"
                value={selectedCube.name} autocomplete="off"
                disabled={busy || loading || !!paintStroke || workspaceMode !== 'edit'}
                onchange={(event) => void renameSelected(
                  selectedCube.uuid, selectedCube.name, event.currentTarget)}/>
            </div>
            <div class="property-group">
              <label>Parent Bone</label>
              <select aria-label="Move Cube to another Bone"
                title="Reparent the selected Cube without changing its stored local coordinates"
                value={outlinerParentId(snapshot?.hierarchy ?? [], selectedCube.uuid)}
                disabled={busy || loading || workspaceMode !== 'edit' || !snapshot?.bones.length}
                onchange={(event) => void reparentSelected(event.currentTarget.value || null)}>
                <option value="" disabled>Select Bone</option>
                {#each snapshot?.bones ?? [] as bone (bone.uuid)}
                  <option value={bone.uuid}>{bone.name}</option>
                {/each}
              </select>
              <p class="hint">Keep local transforms. World-space pose can change if the new Bone is rotated.</p>
            </div>
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
                <p class="hint">Box UV face rectangles are derived from Cube bounds and atlas offset.</p>
                <div class="uv-fields">
                  {#each [0,1] as axis}
                    <label><span>{axis === 0 ? 'U' : 'V'}</span>
                      <input aria-label={'Box UV offset ' + (axis === 0 ? 'U' : 'V')}
                        type="number" step="1" disabled={busy}
                        value={selectedCube.uvOffset[axis]}
                        onchange={(event) => boxOffset(axis, event.currentTarget.value)}/>
                    </label>
                  {/each}
                </div>
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
                <div class="uv-fields">
                  <label><span>UV Rotation</span>
                    <select aria-label={'UV rotation for ' + selectedFace}
                      disabled={busy || loading || workspaceMode !== 'edit' || faceRotation === null}
                      title="Rotate the selected Cube face UV without changing atlas pixels; manual edits disable Auto UV"
                      value={faceRotation ?? ''}
                      onchange={(event) => uvRotate(event.currentTarget.value)}>
                      {#each [0,90,180,270] as degrees}
                        <option value={degrees}>{degrees}°</option>
                      {/each}
                    </select>
                  </label>
                </div>
                {#if faceRotation === null}
                  <p class="hint">Unsupported imported face rotation is preserved and cannot be edited.</p>
                {/if}
              {/if}
            </div>
          </div>
        {:else if selectedBone}
          <div class="property-scroll">
            <div class="property-group">
              <label for={'rust-bone-name-' + selectedBone.uuid}>Bone name</label>
              <input id={'rust-bone-name-' + selectedBone.uuid} class="node-name-input"
                aria-label="Rename selected Bone" type="text" maxlength="128"
                value={selectedBone.name} autocomplete="off"
                disabled={busy || loading || !!paintStroke || workspaceMode !== 'edit'}
                onchange={(event) => void renameSelected(
                  selectedBone.uuid, selectedBone.name, event.currentTarget)}/>
            </div>
            <div class="property-group">
              <label>Parent Bone</label>
              <select aria-label="Move Bone to another parent"
                title="Reparent the selected Bone without changing saved local transforms"
                value={outlinerParentId(snapshot?.hierarchy ?? [], selectedBone.uuid)}
                disabled={busy || loading || workspaceMode !== 'edit'}
                onchange={(event) => void reparentSelected(event.currentTarget.value || null)}>
                <option value="">Root</option>
                {#each snapshot?.bones ?? [] as bone (bone.uuid)}
                  {#if bone.uuid !== selectedBone.uuid &&
                    !boneContains(snapshot?.hierarchy ?? [], selectedBone.uuid, bone.uuid)}
                    <option value={bone.uuid}>{bone.name}</option>
                  {/if}
                {/each}
              </select>
              <p class="hint">Keep local transforms. Reparenting can change the world-space pose.</p>
            </div>
            <div class="property-group">
              <label>Bone origin (read-only)</label>
              <p class="hint">{selectedBone.origin.join(', ')}</p>
            </div>
            <div class="property-group">
              <label>Bone bind rotation (degrees)</label>
              <div class="xyz-fields">
                {#each [0, 1, 2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Bone rotation ' + AXES[axis]}
                      type="number" step="any"
                      disabled={busy || workspaceMode !== 'edit'}
                      title="Change the Bone bind rotation using one Rust Undo transaction"
                      value={selectedBone.rotation[axis]}
                      onchange={(event) => boneRotation(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <p class="hint">{workspaceMode === 'edit'
              ? 'Bone bind rotation is stored in Rust and affects its child Cubes.'
              : 'Switch to Edit to change the bind pose. Animation keyframes remain in Animate.'}</p>
          </div>
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
                <button role="menuitem" onclick={() => void exportGeometry()}
                  disabled={!snapshot || busy || loading || !!paintStroke}
                  title="Export a separate Minecraft Bedrock geometry JSON. This does not replace your editable .bbmodel.">
                  Export Bedrock Geometry…
                </button>
                <button role="menuitem" onclick={() => void exportAnimations()}
                  disabled={!snapshot || busy || loading || !!paintStroke}
                  title="Export a separate Minecraft Bedrock animation JSON. Unsupported curves are refused without affecting the editable .bbmodel.">
                  Export Bedrock Animations…
                </button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={openLegacyWorkspace}>Legacy Workspace</button>
              {:else if item === 'edit'}
                <button role="menuitem" onclick={() => history('undo')} disabled={!snapshot?.canUndo || busy}>Undo <kbd>Ctrl+Z</kbd></button>
                <button role="menuitem" onclick={() => history('redo')} disabled={!snapshot?.canRedo || busy}>Redo <kbd>Ctrl+Y</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => void addCube()} disabled={!snapshot || busy}>Add Cube</button>
                <button role="menuitem" onclick={() => void addBone()} disabled={!snapshot || busy}>Add Bone</button>
                <button role="menuitem" onclick={() => void duplicateSelectedCube()}
                  disabled={!snapshot || busy || loading || workspaceMode !== 'edit' || !selectedId}>
                  Duplicate Selected Cube
                </button>
                <button role="menuitem" onclick={() => void deleteSelected()}
                  disabled={!snapshot || busy || (!selectedId && !selectedBoneId)}>
                  Delete Selected Cube / Empty Bone
                </button>
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
      <button class="mode" class:active={workspaceMode === 'edit'}
        aria-pressed={workspaceMode === 'edit'} disabled={!snapshot || busy || !!paintStroke}
        onclick={() => selectWorkspace('edit')}>Edit</button>
      <button class="mode" class:active={workspaceMode === 'paint'}
        aria-pressed={workspaceMode === 'paint'} disabled={!snapshot || busy || !!paintStroke}
        onclick={() => selectWorkspace('paint')}>Paint</button>
      <button class="mode" class:active={workspaceMode === 'animate'}
        aria-pressed={workspaceMode === 'animate'} disabled={!snapshot || busy || !!paintStroke}
        title="Author bounded Bone rotation keyframes in Rust; supported numeric linear rotation playback is a read-only preview"
        onclick={() => selectWorkspace('animate')}>Animate</button>
    </div>
  </header>

  <div class="editor-toolbar">
    <div class="tool-group" role="group" aria-label="Model actions">
      <button disabled={busy} onclick={requestNew}>New</button>
      <button disabled={busy} onclick={requestOpen}>Open</button>
      <button disabled={!snapshot || busy} onclick={() => void saveCopy()}>Save Copy</button>
      <button disabled={!snapshot || busy || loading || !!paintStroke}
        title="Export separate Minecraft Bedrock geometry without changing the editable .bbmodel"
        onclick={() => void exportGeometry()}>Export Geo</button>
    </div>
    <div class="tool-separator"></div>
    <div class="tool-group" role="group" aria-label="Edit operations">
      {#if workspaceMode === 'edit'}
        <button disabled={!snapshot || busy} onclick={() => void addCube()}>Add Cube</button>
        <button disabled={!snapshot || busy} onclick={() => void addBone()}>Add Bone</button>
        <button disabled={!snapshot || busy || loading || !selectedId}
          title="Copy selected Cube with its faces and UV next to the source, using one Rust Undo step"
          onclick={() => void duplicateSelectedCube()}>Duplicate</button>
        <button disabled={!snapshot || busy || (!selectedId && !selectedBoneId)}
          title="Delete the selected Cube or an empty Bone; Undo restores it"
          onclick={() => void deleteSelected()}>Delete</button>
      {/if}
      <button disabled={!snapshot?.canUndo || busy} onclick={() => history('undo')}>Undo</button>
      <button disabled={!snapshot?.canRedo || busy} onclick={() => history('redo')}>Redo</button>
    </div>
    <div class="tool-separator"></div>
    {#if workspaceMode === 'edit'}
      <div class="tool-group" role="group" aria-label="Viewport transform tools">
        <button class:active={transformTool === 'translate'} aria-pressed={transformTool === 'translate'}
          title="Move the selected Cube with the 3D gizmo"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'translate' ? null : 'translate'}>Move</button>
        <button class:active={transformTool === 'rotate'} aria-pressed={transformTool === 'rotate'}
          title="Rotate the selected Cube with the 3D gizmo"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'rotate' ? null : 'rotate'}>Rotate</button>
        <button class:active={transformTool === 'scale'} aria-pressed={transformTool === 'scale'}
          title="Scale selected Cube about its pivot using the 3D gizmo (0–4×; Auto UV becomes manual)"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'scale' ? null : 'scale'}>Scale</button>
      </div>
    {/if}
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
    <main class="editor-viewport" class:paint-mode={workspaceMode === 'paint'}
      class:animate-mode={workspaceMode === 'animate'}
      aria-label={workspaceMode === 'paint' ? 'Paint atlas and 3D model preview'
        : workspaceMode === 'animate' ? 'Animation editor and bind-pose 3D preview' : 'Model edit viewport'}>
      {#if workspaceMode === 'paint'}
        {@render paintWorkspace()}
      {:else if workspaceMode === 'animate'}
        {@render animateWorkspace()}
      {/if}
      <div class="workspace-model-preview" class:paint-preview={workspaceMode !== 'edit'}>
      {#if snapshot}
        <RustViewport bind:this={viewport} cubes={snapshot.cubes} bones={snapshot.bones}
          hierarchy={snapshot.hierarchy}
          texturePreviewSources={snapshot.texturePreviewSources}
          texturePreviewSides={snapshot.texturePreviewSides}
          texturePreviewResolutions={snapshot.texturePreviewResolutions}
          scopedTexturePreview={snapshot.scopedTexturePreview}
          textureResolution={snapshot.textureResolution}
          previewTextureIndex={paintTextureIndex}
          previewBoneTransforms={previewBoneTransforms}
          {selectedId} onSelect={selectCube}
          transformMode={workspaceMode === 'edit' ? transformTool : null}
          canTransform={workspaceMode === 'edit' && transformTool !== null && !busy && !loading && !newDialog && !confirmDiscard}
          onTranslate={moveFromViewport} onRotate={rotateFromViewport}
          onScale={scaleFromViewport}/>
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
      </div>
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
      workspaceMode === 'paint'
        ? 'Paint atlas · one stroke per Rust Undo · visual parity unverified'
        : workspaceMode === 'animate'
        ? playbackActive
          ? 'Animate · once-only static rotation playback · source-only; visual parity unverified'
          : 'Animate · Play/Pause/Stop numeric Bone transforms · advanced tracks unsupported'
        : selectedId && transformTool === 'translate'
        ? 'Move gizmo · release to commit one Rust edit · visual parity unverified'
        : selectedId && transformTool === 'rotate'
        ? 'Rotate gizmo · release to commit one Rust edit · visual parity unverified'
        : selectedId && transformTool === 'scale'
        ? 'Scale gizmo · pivot-based resize, Auto UV becomes manual · visual parity unverified'
        : 'Embedded PNG preview subset · visual parity unverified'
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

<style>
  .paint-starter { display: grid; gap: 8px; padding: 10px; border-top: 1px solid #374151; }
  .paint-starter label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .paint-starter select { min-width: 0; max-width: 100%; flex: 1; }
  .paint-starter .paint-atlas { display: block; width: 100%; max-width: 256px; height: auto; aspect-ratio: auto; image-rendering: pixelated; touch-action: none; cursor: crosshair; border: 1px solid #475569; background-color: #4b5563; background-image: linear-gradient(45deg,#374151 25%,transparent 25%),linear-gradient(-45deg,#374151 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#374151 75%),linear-gradient(-45deg,transparent 75%,#374151 75%); background-size: 12px 12px; }
</style>
