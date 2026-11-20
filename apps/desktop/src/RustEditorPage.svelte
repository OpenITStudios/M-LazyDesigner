<script lang="ts">
  import './rust-editor.css';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, tick } from 'svelte';
  import { recoveryCheckpointDelay, recoveryCheckpointNeeded } from './rustRecoverySchedule';
  import RustViewport from './RustViewport.svelte';
  import RustRecoveryDialog from './RustRecoveryDialog.svelte';
  import RustLiveReadPairingDialog from './RustLiveReadPairingDialog.svelte';
  import type { ReviewViewId } from './rustReviewCapture';
  import { prepareBoneTransformPose, samplePreparedBoneTransformPose, projectedTransformTimelineRows } from './rustAnimationPose';
  import { supportedFaceUvRotation } from './rustTextureProjection';
  import { advanceAnimationPlayhead } from './rustAnimationPlayback';
  import { parseFiniteEditorNumber } from './rustNumericInput';
  import { reconcilePaintTextureSelection } from './rustPaintSelection';
  import { canReusePreviewInCommand, isOlderEditorSnapshot, isPreviewTransportFailure, reconcileEditorSnapshot } from './rustSnapshotTransport';
  import { canChangeWorkspace, type WorkspaceMode } from './rustWorkspaceMode';
  import { matchingSemanticCandidate, semanticViewportSources, sourceRgb,
    matchingRenderedMaterialPair, semanticIntentFingerprint,
    repeatedRejectedIntent, semanticReviewReady,
    type SemanticMaterialIntent, type SemanticMaterialDraft,
    type SemanticMaterialPreviewReceipt, type SemanticMaterialReferenceReceipt,
    type SemanticRejectReason
  } from './rustSemanticMaterialPreview';
  import { matchingExternalTextureCandidate,externalTextureViewportSources,
    type ExternalFaceTextureIntent,type ExternalFaceTextureDraft,
    type ExternalFaceTextureReceipt } from './rustExternalTexturePreview';
  import { extendPaintStroke, type PaintPoint } from './rustPaintStroke';
  import {drawSurfaceSelectionOverlay} from './rustSelectionOverlay';
  import { protectedAtlasRectangle,
    type ProtectionRect,type SurfaceGesture,type SurfaceSampleHit } from './rustSurfacePaint';
  import {parseShadeRamp,bindSourceSelection,selectionStepsForStroke,
    type SourceSelection,type SelectionStep,type SelectionMode,
    type SelectionRaster} from './rustSurfaceTools';
  import {MAX_PAINT_ATLAS_SIDE} from './rustEditorTypes';
  import {matchingSelectedTexturePreview,selectedTexturePreviewSources,
    bindSelectedTexturePreview,
    type SelectedTexturePreview,type SelectedTexturePreviewReceipt}
    from './rustSelectedTexturePreview';
import {BRUSH_PRESET_STORAGE_KEY,planSurfacePattern,readBrushPresets,
    serializeBrushPresets,upsertBrushPreset,validBrushSettings,
    type PatternMode,type BrushPreset,type BrushSettings} from './rustBrushPresets';
import type { EditorSnapshot, EditOperation, TransformChannel, TransformKeyframeView, Vec3, Vec4 } from './rustEditorTypes';
  import {makeRows,revealOutlinerPath,outlinerParentId,boneContains,
    type Row} from './rustOutlinerView';
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

  let snapshot: EditorSnapshot | null = null;
  // One optional, revision-bound, native-owned PNG shown only on request.
  let selectedTexturePreview:SelectedTexturePreview|null=null;
  let selectedId: string | null = null;
  let selectedBoneId: string | null = null;
  // UI-only tool selection. Geometry and history remain Rust-owned.
  let transformTool: 'translate' | 'rotate' | 'scale' | null = 'translate';
  let selectedFace = 'north';
  let workspaceMode: WorkspaceMode = 'edit';
  let reviewViewId: ReviewViewId = 'front';
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
  // Ephemeral user-review mask, bound to the atlas UUID and model epoch.
  // These rectangles are never persisted as a second bitmap/layer owner.
  let surfacePaint3d=false,surfaceProtectMode=false;
  let surfaceSampleMode=false,surfaceSeamEnabled=false;
  let surfaceSelectMode=false;
  let surfaceGrayscalePreview=false;
  let surfaceSelection:SourceSelection|null=null;
  let surfaceSelectOperation:Exclude<SelectionMode,'invert'>='replace';
  let surfaceInkMode:'color'|'shade_ink'='color';
  let surfaceShadeRamp='';
  let surfaceShadeDirection:'lighten'|'darken'='darken';
  let surfaceBrushRadius=1;
  let surfaceBrushTip:'square'|'diamond'='square';
  let surfacePatternMode:PatternMode='none';
  let surfacePatternPeriod=2,surfacePatternPhaseX=0,surfacePatternPhaseY=0;
  let brushPresets:BrushPreset[]=[];
  let brushPresetName='',selectedBrushPresetId='',brushPresetError='';
  let surfaceSourceBase='#5a6e82';
  let surfaceSampleStatus='';
  let surfaceProtectedRegions:ProtectionRect[]=[];
  let surfaceProtectionBinding:{epoch:number;textureUuid:string}|null=null;
  let surfaceMaskDrag:{pointerId:number;from:PaintPoint;to:PaintPoint;
    epoch:number;textureUuid:string}|null=null;
  // Temporary 3D presentation only; Rust owns the actual model and Undo.
  let semanticReferenceSha:string|null=null,semanticReferenceStatus='';
  let semanticReferenceImage:string|null=null;
  let semanticBase='#5a6e82',semanticShadow='#343e50',semanticHighlight='#a0afc3';
  let semanticCorner:SemanticMaterialIntent['light_corner']='upper_left';
  let semanticContrast:SemanticMaterialIntent['contrast']='subtle';
  let semanticPreview:SemanticMaterialDraft|null=null;
  let semanticShowCandidate=false,semanticViewedSource=false,
    semanticViewedCandidate=false,semanticReviewed=false;
  // Fixed-camera, source-bound visual snapshots. Never saved to .bbmodel.
  let semanticSourceCapture:string|null=null;
  let semanticCandidateCapture:string|null=null;
  let semanticCapturedView:ReviewViewId|null=null;
  let semanticRejectReason:SemanticRejectReason='flat_volume';
  let semanticRejected:{fingerprint:string;reason:SemanticRejectReason}|null=null;
  let semanticRejectionNote='';
  // View-only external editor candidate; Rust owns the bitmap and history.
  let externalBase='#5a6e82';
  let externalPreview:ExternalFaceTextureDraft|null=null;
  let externalShowCandidate=false,externalViewedSource=false,
    externalViewedCandidate=false,externalReviewed=false;
  let externalSourceCapture:string|null=null;
  let externalCandidateCapture:string|null=null;
  let externalCapturedView:ReviewViewId|null=null;
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
  type RecoveryEntry = {
    id: string; epoch: number; revision: number; sizeBytes: number;
    modifiedUnixMs: number; integrity: 'UNVERIFIED_UNTIL_OPEN';
  };
  type RecoveryReceipt = RecoveryEntry & { retentionComplete: boolean };
  let recoveryDialog = false;
  type LiveReadPairing = {pipe: string; token: string; epoch: number; protocol: number};
  let livePairing: LiveReadPairing | null = null;
  let liveReadAvailable = false;
  let livePairingDialog = false;
  let showLiveSecret = false;
  let livePairingTimer: ReturnType<typeof setTimeout> | null = null;
  // Best-effort frontend cleanup slightly ahead of Rust's immutable
  // 15-minute server deadline; background timer throttling cannot extend it.
  const LIVE_READ_UI_LIFETIME_MS = 14 * 60 * 1000;
  let recoveryEntries: RecoveryEntry[] = [];
  let recoverySelectedId = '';
  let recoveryDiscardApproved = false;
  let recoveryWarning = '';
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryStartedAt: number | null = null;
  let recoveryWriting = false;
  let savedRecovery: { epoch: number; revision: number } | null = null;
  let collapsed = new Set<string>();
  let nameInput: HTMLInputElement;
  let discardCancel: HTMLButtonElement;
  let viewport: {
    frameModel:()=>void;
    captureReviewPng:(view:ReviewViewId,expectedPaintSource?:{
      index:number;source:string})=>string;
  } | undefined;
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
  $: validSemanticPreview = matchingSemanticCandidate(snapshot,semanticPreview,
    selectedId,selectedFace,paintTextureIndex,semanticReferenceSha);
  $: validExternalPreview = matchingExternalTextureCandidate(snapshot,
    externalPreview,selectedId,selectedFace,paintTextureIndex);
  $: validSelectedTexturePreview=matchingSelectedTexturePreview(
    snapshot,selectedTexturePreview,paintTextureIndex);
  $: selectedTextureSource=snapshot?.texturePreviewSources[paintTextureIndex] ??
    (validSelectedTexturePreview?selectedTexturePreview?.textureSource:null) ?? null;
  $: baseTextureSources=selectedTexturePreviewSources(
    snapshot,selectedTexturePreview,paintTextureIndex);
  $: modelTextureSources = externalTextureViewportSources(
    snapshot,externalPreview,externalShowCandidate,validExternalPreview,
    semanticViewportSources(snapshot,semanticPreview,
      semanticShowCandidate,validSemanticPreview,baseTextureSources));
  $: externalReadyForApply = semanticReviewReady(
    validExternalPreview &&
      matchingRenderedMaterialPair(externalSourceCapture,externalCandidateCapture,
        externalCapturedView,reviewViewId),
    externalViewedSource,externalViewedCandidate,externalReviewed);
  $: semanticReadyForApply = semanticReviewReady(
    validSemanticPreview &&
      matchingRenderedMaterialPair(semanticSourceCapture,semanticCandidateCapture,
        semanticCapturedView,reviewViewId),
    semanticViewedSource,semanticViewedCandidate,semanticReviewed);
  $: paintAtlasSource = validExternalPreview && externalShowCandidate && externalPreview
    ? externalPreview.candidatePngSource
    : validSemanticPreview && semanticShowCandidate && semanticPreview
      ? semanticPreview.candidatePngSource
      : selectedTextureSource;
  $: guardedSurfaceMasks = snapshot && surfaceProtectionBinding?.epoch===snapshot.epoch &&
    surfaceProtectionBinding.textureUuid===snapshot.textureUuids[paintTextureIndex]
    ? surfaceProtectedRegions : [];
  $: pendingSurfaceMask = snapshot && surfaceMaskDrag ?
    protectedAtlasRectangle(surfaceMaskDrag.from,surfaceMaskDrag.to,
      snapshot.textureResolution) : null;
  $: validSurfaceSelection=!!surfaceSelection&&!!snapshot&&
    surfaceSelection.epoch===snapshot.epoch&&
    surfaceSelection.revision===snapshot.revision&&
    surfaceSelection.textureUuid===snapshot.textureUuids[paintTextureIndex];
  $: surfaceShadeColors=parseShadeRamp(surfaceShadeRamp);
  $: surfacePattern=planSurfacePattern(surfacePatternMode,surfacePatternPeriod,
    surfacePatternPhaseX,surfacePatternPhaseY);
  $: surfacePatternReady=surfacePatternMode==='none'||!!surfacePattern;
  $: surfacePaintEnabled = workspaceMode==='paint' && surfacePaint3d &&
    (surfaceInkMode==='color'||!!surfaceShadeColors||
      surfaceSampleMode||surfaceSelectMode) &&
    !!snapshot && !busy && !loading && !paintStroke && !surfaceMaskDrag &&
    !validSemanticPreview && !validExternalPreview &&
    !!snapshot.paintEditableTextures[paintTextureIndex] &&
    !!selectedTextureSource &&
    !!snapshot.textureUuids[paintTextureIndex] &&
    paintTool==='pencil' && paintAlpha===255 &&
    Number.isInteger(surfaceBrushRadius) &&
    surfaceBrushRadius>=1 && surfaceBrushRadius<=4 && surfacePatternReady;
  $: surfacePaintContextKey=JSON.stringify([
    snapshot?.epoch,snapshot?.revision,paintTextureIndex,
    snapshot?.textureUuids[paintTextureIndex],paintColor,
    paintAlpha,surfaceSourceBase,guardedSurfaceMasks,
    surfaceSampleMode,surfaceSelectMode,surfaceSeamEnabled,
    surfaceBrushRadius,surfaceBrushTip,surfaceInkMode,
    surfaceShadeRamp,surfaceShadeDirection,
    surfacePatternMode,surfacePatternPeriod,surfacePatternPhaseX,surfacePatternPhaseY,
    validSurfaceSelection?surfaceSelection?.steps:null,
  ]);

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
    if(surfaceMaskDrag)return;
    if (!canChangeWorkspace(Boolean(snapshot), busy, loading, Boolean(paintStroke))) return;
    if(mode!=='paint'){
      clearSemanticPreview();
      // Release the optional large PNG display cache outside Paint mode.
      selectedTexturePreview=null;
    }
    if (mode !== workspaceMode) pauseAnimationPlayback();
    workspaceMode = mode;
    closeMenus();
  }
  function closeMenus() { menu = null; }
  function outsideClick(event: MouseEvent) {
    if (menu && event.target instanceof Element && !event.target.closest('.rust-menu-bar')) closeMenus();
  }
  function selectCube(id: string | null) {
    if(id!==selectedId){
      clearSemanticPreview();
      clearSurfaceSelection();
    }
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
  function clearSurfaceSelection(){
    surfaceSelection=null;
    surfaceSelectMode=false;
    surfaceSampleStatus='';
  }
  function clearSurfaceProtection(){
    clearSurfaceSelection();
    surfaceProtectedRegions=[];
    surfaceProtectionBinding=null;
    surfaceMaskDrag=null;
  }
  function accept(incoming: EditorSnapshot): EditorSnapshot {
    // Detached native projections are immutable but can complete out of order.
    // Never replace a newer Rust epoch/revision with an older IPC response.
    if (isOlderEditorSnapshot(snapshot, incoming)) {
      throw new Error('RUST_EDITOR_SNAPSHOT_STALE');
    }
    // A missing image body is valid only with the exact prior epoch and key.
    const next = reconcileEditorSnapshot(snapshot, incoming);
    // A fresh canonical snapshot invalidates all temporary texture overlays.
    clearSemanticPreview();
    clearSurfaceSelection();
    // A selected view may survive another revision only as a *stale* cached
    // source string until Rust proves it is still the same PNG by SHA-256.
    // Any document receipt invalidates the frame-clock identity. Resume is
    // always explicit; never replay a stale animation after Undo/Open/Save.
    pauseAnimationPlayback();
    // The index identifies an atlas only within its owning Rust session.
    // A new model can have the same texture count but different texture data.
    paintTextureIndex = reconcilePaintTextureSelection(
      snapshot?.epoch ?? null, next.epoch, paintTextureIndex, next.textureNames.length,
    );
    if(selectedTexturePreview && (
       selectedTexturePreview.epoch!==next.epoch ||
       selectedTexturePreview.textureIndex!==paintTextureIndex ||
       selectedTexturePreview.textureUuid!==next.textureUuids[paintTextureIndex] ||
       !!next.texturePreviewSources[paintTextureIndex])){
      selectedTexturePreview=null;
    }
    if (snapshot && snapshot.epoch !== next.epoch) {
      clearSurfaceProtection();
      semanticReferenceSha=null;
      semanticReferenceStatus='';
      semanticReferenceImage=null;
      semanticRejected=null;semanticRejectionNote='';
      // Old read-only pairing is bound to the previous model epoch; revoke
      // before another model is exposed. Never carry a capability forward.
      if (livePairing) void stopLiveRead();
      selectedAnimationId = null;
      selectedKeyframeUuid = null;
      animationTime = 0;
      animationChannel = 'rotation';
      animationValue = [0, 0, 0];
    }
    snapshot = next;
    scheduleRecoveryCheckpoint(next);
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
  // UI schedules recovery; Rust owns the actual file and document state.
  function scheduleRecoveryCheckpoint(current: EditorSnapshot) {
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    if (!current.dirty || !isTauri()) {
      recoveryStartedAt = null;
      if (!current.dirty) recoveryWarning = '';
      return;
    }
    if (!recoveryCheckpointNeeded(current, savedRecovery)) return;
    const now = Date.now();
    if (recoveryStartedAt === null) recoveryStartedAt = now;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      void writeRecoveryCheckpoint();
    }, recoveryCheckpointDelay(now, recoveryStartedAt));
  }

  async function writeRecoveryCheckpoint() {
    const current = snapshot;
    if (!current?.dirty || !isTauri() || recoveryWriting ||
        !recoveryCheckpointNeeded(current, savedRecovery)) return;
    recoveryWriting = true;
    try {
      const receipt = await invoke<RecoveryReceipt>(
        'rust_editor_recovery_checkpoint', {
          expectedEpoch: current.epoch, expectedRevision: current.revision,
        });
      if (snapshot?.epoch === receipt.epoch &&
          snapshot?.revision === receipt.revision) {
        savedRecovery = { epoch: receipt.epoch, revision: receipt.revision };
        recoveryStartedAt = null;
      }
      recoveryWarning = receipt.retentionComplete ? '' :
        'Recovery checkpoint saved; some older private snapshots could not be cleaned up.';
    } catch {
      recoveryWarning = 'Automatic recovery is unavailable. Use Save Copy to protect your edits.';
      recoveryStartedAt = Date.now();
    } finally {
      recoveryWriting = false;
      if (snapshot?.dirty && recoveryCheckpointNeeded(snapshot, savedRecovery)) {
        scheduleRecoveryCheckpoint(snapshot);
      }
    }
  }

  async function openLiveReadDialog() {
    if (busy || loading || !snapshot || paintStroke || !liveReadAvailable) return;
    closeMenus(); error = '';
    if (livePairing) { livePairingDialog = true; return; }
    busy = true;
    try {
      const pairing = await invoke<LiveReadPairing>('rust_live_read_start', {
        expectedEpoch: snapshot.epoch,
      });
      if (pairing.epoch !== snapshot.epoch || pairing.protocol !== 1) {
        // The snapshot changed during async pairing; refuse to display an
        // uncertain/stale capability and close the native listener.
        await invoke('rust_live_read_stop');
        throw new Error('LIVE_READ_PAIRING_STALE');
      }
      livePairing = pairing;
      showLiveSecret = false;
      livePairingDialog = true;
      if (livePairingTimer !== null) clearTimeout(livePairingTimer);
      livePairingTimer = setTimeout(() => {
        livePairingTimer = null;
        void stopLiveRead();
      }, LIVE_READ_UI_LIFETIME_MS);
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  async function stopLiveRead() {
    // Erase the UI capability before waiting for Rust. The native bridge
    // denies stale epochs even if its close request cannot complete.
    livePairing = null;
    showLiveSecret = false;
    livePairingDialog = false;
    if (livePairingTimer !== null) {
      clearTimeout(livePairingTimer);
      livePairingTimer = null;
    }
    try {
      if (isTauri()) await invoke('rust_live_read_stop');
    } catch (cause) { showError(cause); }
  }

  async function openRecoveryDialog() {
    if (busy || loading || paintStroke) return;
    busy = true; closeMenus(); error = '';
    try {
      recoveryEntries = await invoke<RecoveryEntry[]>('rust_editor_recovery_list');
      recoverySelectedId = recoveryEntries[0]?.id ?? '';
      recoveryDiscardApproved = false;
      recoveryDialog = true;
      await tick();
      document.getElementById('recovery-select')?.focus();
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  async function restoreRecovery() {
    if (busy || !recoverySelectedId || (snapshot?.dirty && !recoveryDiscardApproved)) return;
    busy = true; error = '';
    try {
      const recovered = await invoke<EditorSnapshot>(
        'rust_editor_recovery_restore', {
          id: recoverySelectedId, expectedEpoch: snapshot?.epoch ?? 0,
          expectedRevision: snapshot?.revision ?? 0,
          discard: recoveryDiscardApproved,
        });
      selectedId = null; selectedBoneId = null;
      accept(recovered);
      recoveryDialog = false;
      recoveryDiscardApproved = false;
      notice = 'Recovered a private checkpoint as an unsaved model. Use Save Copy to keep it.';
      await tick(); viewport?.frameModel();
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  async function command(name: string, args: Record<string, unknown>): Promise<EditorSnapshot | null> {
    if (busy) return null;
    const hadSelectedPreview=validSelectedTexturePreview;
    let editAccepted=false;
    busy = true; closeMenus(); error = '';
    try {
      const reuse = canReusePreviewInCommand(name)
        ? {
          knownPreviewSourceKey: snapshot?.previewSourceKey ?? null,
          knownGeometrySourceKey: snapshot?.geometrySourceKey ?? null,
          knownAnimationSourceKey: snapshot?.animationSourceKey ?? null,
        } : {};
      const next = await invoke<EditorSnapshot>(name, { ...args, ...reuse });
      const accepted=accept(next);
      editAccepted=true;
      return accepted;
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
          error = 'An editor snapshot was stale or incomplete. The model view was refreshed from Rust; review it before editing again.';
        } catch (refreshError) {
          showError(refreshError);
        }
      } else {
        showError(cause);
      }
      return null;
    } finally {
      busy = false;
      // When Rust confirms the image source key is unchanged, restore the
      // existing bytes without another large PNG transport after Undo/edit.
      if(editAccepted&&hadSelectedPreview&&selectedTexturePreview&&
         snapshot&&!snapshot.texturePreviewSources[paintTextureIndex])
        void loadSelectedTexturePreview(true);
    }
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
  type ReviewCaptureReceipt = {
    sourceModelSha256: string;
    capturePngSha256: string;
    viewId: ReviewViewId;
    fileName: string;
    byteCount: number;
    previewScope: 'RUST_THREEJS_PREVIEW_NOT_BEDROCK_VERIFIED';
  };
  async function exportReviewCapture() {
    if (!snapshot || snapshot.dirty || !snapshot.sourceName ||
        busy || loading || paintStroke || validSemanticPreview || validExternalPreview ||
        workspaceMode === 'animate') return;
    const epoch = snapshot.epoch;
    const revision = snapshot.revision;
    busy = true; closeMenus(); error = '';
    try {
      const pngDataUrl = viewport?.captureReviewPng(reviewViewId);
      if (!pngDataUrl) throw new Error('3D viewport is not available for capture.');
      const saved = await invoke<ReviewCaptureReceipt | null>(
        'rust_editor_export_review_capture', {
          expectedEpoch: epoch, expectedRevision: revision,
          viewId: reviewViewId, pngDataUrl,
        },
      );
      if (saved) notice = 'Saved ' + saved.fileName +
        ' from model SHA ' + saved.sourceModelSha256.slice(0, 12) +
        '. Rust preview only; visual quality is not verified.';
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
        width < 1 || height < 1 || width > MAX_PAINT_ATLAS_SIDE || height > MAX_PAINT_ATLAS_SIDE) {
      error = 'Atlas width and height must each be integers from 1 to 4096.';
      return;
    }
    if (width === snapshot.textureResolution[0] &&
        height === snapshot.textureResolution[1]) return;
    apply([{ op: 'set_empty_atlas_resolution', width, height }]);
  }

  async function loadSelectedTexturePreview(silent=false):Promise<void>{
    if(!snapshot||busy||loading||workspaceMode!=='paint'||
       snapshot.scopedTexturePreview||
       snapshot.texturePreviewSources[paintTextureIndex]||
       matchingSelectedTexturePreview(snapshot,selectedTexturePreview,paintTextureIndex))return;
    const index=paintTextureIndex;
    const textureUuid=snapshot.textureUuids[index];
    if(!textureUuid)return;
    const {epoch,revision}=snapshot;
    const previous=selectedTexturePreview;
    const sourceKey=previous&&previous.epoch===epoch&&
      previous.textureIndex===index&&previous.textureUuid===textureUuid
        ?previous.sourceSha256:null;
    busy=true;error='';
    try{
      const receipt=await invoke<SelectedTexturePreviewReceipt>(
        'rust_editor_read_texture_preview',{
          expectedEpoch:epoch,expectedRevision:revision,
          textureIndex:index,textureUuid,
          knownSourceSha256:sourceKey,
        });
      const bound=bindSelectedTexturePreview(snapshot,receipt,previous,index);
      if(!snapshot||snapshot.epoch!==epoch||snapshot.revision!==revision||
         paintTextureIndex!==index||!bound)
        throw new Error('SELECTED_PREVIEW_SOURCE_STALE');
      selectedTexturePreview=bound;
      if(!silent)notice='Selected atlas loaded for this view only. Source PNG and Undo remain in Rust.';
    }catch(cause){selectedTexturePreview=null;showError(cause);}
    finally{busy=false;}
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
          : 'PNG imported. Select Load selected atlas preview if the eager view omitted it.';
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }

  function clearSemanticComparison(){
    semanticSourceCapture=null;
    semanticCandidateCapture=null;
    semanticCapturedView=null;
    semanticViewedSource=false;semanticViewedCandidate=false;
    semanticReviewed=false;
  }
  function clearExternalPreview(){
    externalPreview=null;externalShowCandidate=false;
    externalSourceCapture=null;externalCandidateCapture=null;
    externalCapturedView=null;
    externalViewedSource=false;externalViewedCandidate=false;
    externalReviewed=false;
  }
  function clearSemanticPreview(){
    semanticPreview=null;
    semanticShowCandidate=false;
    clearSemanticComparison();
    clearExternalPreview();
  }
  function externalIntent():ExternalFaceTextureIntent|null{
    if(!snapshot||!selectedId||
       !snapshot.paintEditableTextures[paintTextureIndex]||
       !snapshot.texturePreviewSources[paintTextureIndex])return null;
    const uuid=snapshot.textureUuids[paintTextureIndex];
    const color=sourceRgb(externalBase);
    if(!uuid||!color)return null;
    return {
      expected_revision:snapshot.revision,cube_uuid:selectedId,
      texture_uuid:uuid,face:selectedFace as ExternalFaceTextureIntent['face'],
      source_base_rgba:[...color,255],protected_regions:[],
      expected_before_pixels:[],
    };
  }
  async function chooseExternalTextureCandidate(){
    if(!snapshot||busy||loading||paintStroke||workspaceMode!=='paint')return;
    const intent=externalIntent();
    if(!intent){error='Select an editable atlas, Cube and face.';return;}
    const {epoch,revision}=snapshot;
    clearSemanticPreview();busy=true;error='';closeMenus();
    try{
      const receipt=await invoke<ExternalFaceTextureReceipt|null>(
        'rust_editor_preview_external_face_png',{
          expectedEpoch:epoch,expectedRevision:revision,intent,
        });
      if(!receipt)return;
      const draft={...receipt,intent};
      if(!matchingExternalTextureCandidate(snapshot,draft,
        selectedId,selectedFace,paintTextureIndex))
        throw new Error('EXTERNAL_TEXTURE_PREVIEW_STALE');
      externalPreview=draft;
      notice='Disposable edited PNG loaded. Capture Source and Candidate before Apply.';
    }catch(cause){clearExternalPreview();showError(cause);}
    finally{busy=false;}
  }
  async function showExternalTextureCandidate(value:boolean){
    if(!validExternalPreview||!externalPreview||busy||!snapshot||!viewport)return;
    const expected=externalPreview,view=reviewViewId,index=expected.textureIndex;
    const source=value?expected.candidatePngSource:
      snapshot.texturePreviewSources[index];
    if(!source)return;
    busy=true;error='';externalShowCandidate=value;externalReviewed=false;
    if(externalCapturedView!==null&&externalCapturedView!==view){
      externalSourceCapture=null;externalCandidateCapture=null;
      externalViewedSource=false;externalViewedCandidate=false;
      externalCapturedView=null;
    }
    try{
      // Existing RustViewport owns exact loaded texture + fixed-camera guard.
      await tick();
      if(document.hidden)throw new Error('EXTERNAL_TEXTURE_WINDOW_INACTIVE');
      const png=viewport.captureReviewPng(view,{index,source});
      if(externalPreview!==expected||!validExternalPreview||
         reviewViewId!==view)throw new Error('EXTERNAL_TEXTURE_COMPARISON_STALE');
      externalCapturedView=view;
      if(value){externalCandidateCapture=png;externalViewedCandidate=true;}
      else{externalSourceCapture=png;externalViewedSource=true;}
    }catch(cause){
      if(value){externalCandidateCapture=null;externalViewedCandidate=false;}
      else{externalSourceCapture=null;externalViewedSource=false;}
      showError(cause);
    }finally{busy=false;}
  }
  async function applyExternalTextureCandidate(){
    if(!externalPreview||!externalReadyForApply||busy)return;
    const draft=externalPreview;
    const next=await command('rust_editor_apply_external_face_png',{
      expectedEpoch:draft.epoch,expectedRevision:draft.revision,
      intent:draft.intent,candidatePngSource:draft.candidatePngSource,
      expectedSourceSha256:draft.sourceModelSha256,
      expectedCandidateSha256:draft.candidateSha256,
    });
    if(next)notice='Reviewed PNG applied to existing atlas in one Rust Undo step. Artistic quality remains unverified.';
    else clearExternalPreview();
  }

  async function chooseSemanticReference(){
    if(!snapshot||busy||loading||paintStroke)return;
    const {epoch,revision}=snapshot;
    busy=true;error='';closeMenus();
    try{
      const r=await invoke<SemanticMaterialReferenceReceipt|null>(
        'rust_editor_choose_semantic_reference',{
          expectedEpoch:epoch,expectedRevision:revision,
        });
      if(r){
        if(snapshot?.epoch!==epoch||snapshot.revision!==revision)
          throw new Error('SEMANTIC_REFERENCE_SOURCE_STALE');
        if(!r.referencePngSource.startsWith('data:image/png;base64,') ||
           r.referenceAuthority!=='USER_SELECTED_NOT_ARTISTICALLY_VERIFIED'){
          throw new Error('SEMANTIC_REFERENCE_PROVENANCE_INVALID');
        }
        semanticReferenceSha=r.pngSha256;
        semanticReferenceImage=r.referencePngSource;
        semanticRejected=null;semanticRejectionNote='';
        semanticReferenceStatus='Selected PNG '+r.pngSha256.slice(0,12)+
          ' (not verified as approved artwork).';
        clearSemanticPreview();
      }
    }catch(cause){showError(cause);}
    finally{busy=false;}
  }
  function sourceSemanticIntent():SemanticMaterialIntent|null{
    if(!snapshot||!selectedId||!semanticReferenceSha||
       !/^[a-f0-9]{64}$/i.test(semanticReferenceSha)||
       !snapshot.paintEditableTextures[paintTextureIndex]||
       !snapshot.texturePreviewSources[paintTextureIndex])return null;
    const textureUuid=snapshot.textureUuids[paintTextureIndex];
    const base=sourceRgb(semanticBase),shadow=sourceRgb(semanticShadow),
      highlight=sourceRgb(semanticHighlight);
    if(!textureUuid||!base||!shadow||!highlight)return null;
    return {expected_revision:snapshot.revision,
      reference_png_sha256:semanticReferenceSha,
      cube_uuid:selectedId,texture_uuid:textureUuid,
      face:selectedFace as SemanticMaterialIntent['face'],
      material:'painted_metal',light_corner:semanticCorner,
      contrast:semanticContrast,
      source_base_rgba:[base[0],base[1],base[2],255],
      shadow_rgb:shadow,highlight_rgb:highlight,
      protected_regions:[],expected_before_pixels:[],
    };
  }
  async function previewSemanticMaterial(){
    if(!snapshot||busy||loading||paintStroke||workspaceMode!=='paint')return;
    const intent=sourceSemanticIntent();
    if(!intent){error='Select an editable atlas, Cube, face and reference PNG.';return;}
    if(repeatedRejectedIntent(intent,semanticRejected)){
      error='This exact candidate was rejected. Change the reference-grounded treatment or select another material method before trying again.';
      return;
    }
    const {epoch,revision}=snapshot;
    clearSemanticPreview();busy=true;error='';
    try{
      const r=await invoke<SemanticMaterialPreviewReceipt>(
        'rust_editor_preview_semantic_material',{
          expectedEpoch:epoch,expectedRevision:revision,intent,
        });
      const candidate={...r,intent};
      if(!matchingSemanticCandidate(snapshot,candidate,selectedId,selectedFace,
          paintTextureIndex,semanticReferenceSha))
        throw new Error('SEMANTIC_PREVIEW_SOURCE_STALE');
      semanticPreview=candidate;
      semanticShowCandidate=false;
      clearSemanticComparison();
      notice='Disposable material prepared. Select Source and Candidate to compare both before applying.';
    }catch(cause){clearSemanticPreview();showError(cause);}
    finally{busy=false;}
  }
  async function showSemanticCandidate(value:boolean){
    if(!validSemanticPreview||!semanticPreview||busy||!snapshot||!viewport)return;
    const expected=semanticPreview,view=reviewViewId;
    const index=expected.textureIndex;
    const source=value ? expected.candidatePngSource :
      snapshot.texturePreviewSources[index];
    if(!source)return;
    busy=true;error='';
    semanticShowCandidate=value;
    semanticReviewed=false;
    if(semanticCapturedView!==null && semanticCapturedView!==view){
      clearSemanticComparison();
    }
    try{
      // Flush same-geometry texture bindings. The viewport renders the
      // fixed camera synchronously and independently refuses an unloaded,
      // stale or mismatched GPU atlas source. Do not await an animation frame:
      // it can be indefinitely suspended when the desktop is hidden.
      await tick();
      if(document.hidden)throw new Error('SEMANTIC_COMPARISON_WINDOW_INACTIVE');
      const png=viewport.captureReviewPng(view,{index,source});
      if(semanticPreview!==expected || !validSemanticPreview ||
         reviewViewId!==view)throw new Error('SEMANTIC_COMPARISON_STALE');
      semanticCapturedView=view;
      if(value){
        semanticCandidateCapture=png;
        semanticViewedCandidate=true;
      }else{
        semanticSourceCapture=png;
        semanticViewedSource=true;
      }
    }catch(cause){
      if(value){
        semanticCandidateCapture=null;semanticViewedCandidate=false;
      }else{
        semanticSourceCapture=null;semanticViewedSource=false;
      }
      showError(cause);
    }finally{busy=false;}
  }
  function rejectSemanticCandidate(){
    if(!validSemanticPreview||!semanticPreview||busy)return;
    semanticRejected={
      fingerprint:semanticIntentFingerprint(semanticPreview.intent),
      reason:semanticRejectReason,
    };
    const guidance={
      flat_volume:'Flat form: recheck reference and treatment, not merely the same edge mask.',
      identity_risk:'Identity risk: preserve the approved marking explicitly or stop. Base-color matching alone cannot identify an emblem.',
      style_mismatch:'Material mismatch: review the actual material master and selected colors before recomposing.',
      other:'Reject this proposal: change diagnosis or return to reviewer-authored brush treatment.',
    };
    semanticRejectionNote=guidance[semanticRejectReason];
    clearSemanticPreview();
    notice='Candidate rejected. Original model and PNG were not changed.';
  }
  async function applySemanticCandidate(){
    if(!semanticPreview||!semanticReadyForApply||busy)return;
    const candidate=semanticPreview;
    const next=await command('rust_editor_apply_preview_semantic_material',{
      expectedEpoch:candidate.epoch,expectedRevision:candidate.revision,
      intent:candidate.intent,
      expectedSourceSha256:candidate.sourceModelSha256,
      expectedCandidateSha256:candidate.candidateSha256,
    });
    if(next){
      semanticRejected=null;semanticRejectionNote='';
      notice='Candidate applied with one Rust Undo step. Independent artistic quality is still unverified.';
    }
    else clearSemanticPreview();
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
        !selectedId || !selectedTextureSource) return;
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
        !selectedTextureSource) return;
    const index = paintTextureIndex;
    const next = await command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operations: [{ op: 'enable_imported_paint_texture', texture_index: index }],
    });
    if (next) notice = 'Imported RGBA8 PNG validated for painting; the original bitmap is unchanged until the first stroke.';
  }

  type SurfaceSampleReceipt={
    revision:number;cube_uuid:string;texture_uuid:string;
    face:string;local:[number,number];atlas_at:[number,number];
    rgba:[number,number,number,number];
    source_authority:'RUST_SAVED_RGBA8';
    write_authority:'NOT_GRANTED';visual_verdict:'UNVERIFIED';
  };
  async function sampleFromViewport(hit:SurfaceSampleHit):Promise<void>{
    if(!surfacePaintEnabled||!surfaceSampleMode||!snapshot||busy||
       hit.contextKey!==surfacePaintContextKey||
       hit.epoch!==snapshot.epoch||hit.revision!==snapshot.revision||
       snapshot.textureUuids[hit.textureIndex]!==hit.textureUuid)return;
    busy=true;error='';surfaceSampleStatus='';
    try{
      const result=await invoke<SurfaceSampleReceipt>(
        'rust_editor_sample_surface_color',{
          expectedEpoch:hit.epoch,expectedRevision:hit.revision,
          request:{
            expected_revision:hit.revision,cube_uuid:hit.cubeUuid,
            texture_uuid:hit.textureUuid,face:hit.face,
            expected_face_uv:hit.sourceUv,
            expected_face_rotation:hit.sourceRotation,local:hit.texel,
          },
        });
      if(snapshot.epoch!==hit.epoch||snapshot.revision!==hit.revision||
         result.revision!==hit.revision||
         result.cube_uuid!==hit.cubeUuid||
         result.texture_uuid!==hit.textureUuid||
         result.source_authority!=='RUST_SAVED_RGBA8'||
         result.write_authority!=='NOT_GRANTED')throw new Error('SURFACE_SAMPLE_STALE');
      if(result.rgba[3]!==255){
        surfaceSampleStatus='Source pixel alpha is '+result.rgba[3]+
          '; this guarded 3D brush requires an opaque original pixel.';
      }else{
        surfaceSourceBase='#'+result.rgba.slice(0,3)
          .map(n=>n.toString(16).padStart(2,'0')).join('');
        surfaceSampleMode=false;
        surfaceSampleStatus='Original RGBA confirmed by Rust at atlas ('+
          result.atlas_at.join(', ')+').';
      }
    }catch(cause){showError(cause);}
    finally{busy=false;}
  }
  type SurfaceSelectionReceipt={
    revision:number;cube_uuid:string;texture_uuid:string;face:string;
    seed:[number,number];source_rgba:[number,number,number,number];
    pixel_count:number;atlas_rows:Array<{y:number;x0:number;x1:number}>;
    preview_complete:boolean;preview_raster:SelectionRaster|null;
    selection_steps:SelectionStep[];
    source_authority:'RUST_SAVED_RGBA8';
    write_authority:'NOT_GRANTED';visual_verdict:'UNVERIFIED';
  };
  async function selectFromViewport(hit:SurfaceSampleHit,overrideSteps?:SelectionStep[]):Promise<void>{
    if(!surfacePaintEnabled||(!surfaceSelectMode&&!overrideSteps)||!snapshot||busy||
       hit.contextKey!==surfacePaintContextKey||
       hit.epoch!==snapshot.epoch||hit.revision!==snapshot.revision||
       snapshot.textureUuids[hit.textureIndex]!==hit.textureUuid)return;
    const steps:SelectionStep[]|null=overrideSteps??(surfaceSelectOperation==='replace'
      ?[{mode:'replace',seed:[...hit.texel] as [number,number]}]
      :validSurfaceSelection&&surfaceSelection&&
        surfaceSelection.cubeUuid===hit.cubeUuid&&
        surfaceSelection.face===hit.face&&
        surfaceSelection.sourceUv.every((v,i)=>v===hit.sourceUv[i])?
          [...surfaceSelection.steps,{mode:surfaceSelectOperation,seed:[...hit.texel] as [number,number]}]
          :null);
    if(!steps){error='Choose Replace to start a selection on this Cube face.';return;}
    busy=true;error='';
    try{
      const receipt=await invoke<SurfaceSelectionReceipt>(
        'rust_editor_select_surface_color',{
          expectedEpoch:hit.epoch,expectedRevision:hit.revision,
          request:{
            source:{
              expected_revision:hit.revision,cube_uuid:hit.cubeUuid,
              texture_uuid:hit.textureUuid,face:hit.face,
              expected_face_uv:hit.sourceUv,
              expected_face_rotation:hit.sourceRotation,local:hit.texel,
            },
            protected_regions:guardedSurfaceMasks,
            selection_steps:steps,
          },
        });
      if(!snapshot||snapshot.epoch!==hit.epoch||
         snapshot.revision!==hit.revision)throw new Error('SURFACE_SELECTION_STALE');
      const selection=bindSourceSelection(hit,receipt,
        snapshot.textureResolution[0],snapshot.textureResolution[1],steps);
      if(!selection)throw new Error('SURFACE_SELECTION_RECEIPT_INVALID');
      surfaceSelection=selection;
      surfaceSelectMode=false;
      if(selection.steps.length===1&&selection.rgba[3]===255){
        surfaceSourceBase='#'+selection.rgba.slice(0,3)
          .map(n=>n.toString(16).padStart(2,'0')).join('');
      }
      surfaceSampleStatus=selection.pixelCount+
        ' source texels selected on '+selection.face+
        (selection.previewComplete?'':selection.previewRaster?
          ' (compact overview; native selection remains full-resolution)':
          ' (overlay unavailable; native selection is complete)')+
        '. Native Rust recomputes the complete selection at Apply.';
    }catch(cause){showError(cause);}
    finally{busy=false;}
  }
  async function invertSurfaceSelection():Promise<void>{
    const selection=validSurfaceSelection?surfaceSelection:null;
    if(!selection||!snapshot){error='Create a connected selection first.';return;}
    if(selection.textureIndex!==paintTextureIndex){
      error='Selection texture changed. Select again.';return;
    }
    const hit:SurfaceSampleHit={
      cubeUuid:selection.cubeUuid,face:selection.face as SurfaceSampleHit['face'],
      textureUuid:selection.textureUuid,textureIndex:selection.textureIndex,
      epoch:selection.epoch,revision:selection.revision,
      size:[...selection.size],sourceUv:[...selection.sourceUv],
      sourceRotation:selection.sourceRotation,texel:[...selection.seed],
      contextKey:surfacePaintContextKey,
    };
    await selectFromViewport(hit,[...selection.steps,{mode:'invert'}]);
  }
  function currentBrushSettings():BrushSettings{
    return {radius:surfaceBrushRadius,tip:surfaceBrushTip,inkMode:surfaceInkMode,
      shadeRamp:surfaceShadeRamp,shadeDirection:surfaceShadeDirection,
      patternMode:surfacePatternMode,patternPeriod:surfacePatternPeriod,
      patternPhaseX:surfacePatternPhaseX,patternPhaseY:surfacePatternPhaseY};
  }
  function persistBrushPresets(next:BrushPreset[]):boolean{
    try{
      window.localStorage.setItem(BRUSH_PRESET_STORAGE_KEY,serializeBrushPresets(next));
      brushPresets=next;brushPresetError='';return true;
    }catch{
      brushPresetError='Could not save presets to local app storage.';
      return false;
    }
  }
  function saveBrushPreset(){
    const settings=currentBrushSettings();
    if(!validBrushSettings(settings)){
      brushPresetError='Choose valid brush, ramp, and pattern settings first.';return;
    }
    const next=upsertBrushPreset(brushPresets,crypto.randomUUID(),brushPresetName,settings);
    if(!next){brushPresetError='Enter a preset name (up to 80 characters).';return;}
    if(persistBrushPresets(next)){
      selectedBrushPresetId=next.find(p=>p.name.toLocaleLowerCase()===
        brushPresetName.trim().toLocaleLowerCase())?.id??'';
    }
  }
  function applyBrushPreset(){
    const selected=brushPresets.find(p=>p.id===selectedBrushPresetId);
    if(!selected||!validBrushSettings(selected.settings)||busy||paintStroke)return;
    const p=selected.settings;
    surfaceBrushRadius=p.radius;surfaceBrushTip=p.tip;
    surfaceInkMode=p.inkMode;surfaceShadeRamp=p.shadeRamp;
    surfaceShadeDirection=p.shadeDirection;
    surfacePatternMode=p.patternMode;surfacePatternPeriod=p.patternPeriod;
    surfacePatternPhaseX=p.patternPhaseX;surfacePatternPhaseY=p.patternPhaseY;
    brushPresetName=selected.name;brushPresetError='';
  }
  function deleteBrushPreset(){
    if(!selectedBrushPresetId||busy||paintStroke)return;
    const next=brushPresets.filter(p=>p.id!==selectedBrushPresetId);
    if(persistBrushPresets(next)){selectedBrushPresetId='';brushPresetName='';}
  }
  async function paintFromViewport(gesture:SurfaceGesture):Promise<void>{
    if(!surfacePaintEnabled||surfaceSampleMode||!snapshot||busy||paintAlpha!==255 ||
       snapshot.epoch!==gesture.epoch||
       snapshot.revision!==gesture.revision||
       snapshot.textureUuids[gesture.textureIndex]!==gesture.textureUuid||
       paintTextureIndex!==gesture.textureIndex ||
       gesture.contextKey!==surfacePaintContextKey)return;
    const base=sourceRgb(surfaceSourceBase),color=sourceRgb(paintColor);
    if(!base||!color){error='Select valid original and target RGB colors.';return;}
    // An active selection never degrades to an unrestricted gesture.
    const selection=validSurfaceSelection?surfaceSelection:null;
    if(surfaceSelection&&!selection){error='Selection is stale. Clear it or select again.';return;}
    const selectionSteps=selection?selectionStepsForStroke(selection,gesture):null;
    if(selection&&!selectionSteps){
      error='Paint hit is outside the selected Cube, face or source UV.';return;
    }
    if(selection&&selection.pixelCount===0){
      error='The current selection is empty. Invert or replace it before painting.';return;
    }
    if(selection&&gesture.seam){
      error='Selection-locked strokes cannot bridge multiple Cubes.';return;
    }
    if(surfacePattern&&gesture.seam){
      error='Pattern Brush currently paints one Cube face at a time.';return;
    }
    selectCube(gesture.cubeUuid);
    selectedFace=gesture.face;
    const shared={
      expected_revision:gesture.revision,cube_uuid:gesture.cubeUuid,
      texture_uuid:gesture.textureUuid,face:gesture.face,
      expected_face_uv:gesture.sourceUv,
      expected_face_rotation:gesture.sourceRotation,
      points:gesture.points,selection_seed:null,
      selection_steps:selectionSteps??[],
      brush_radius:surfaceBrushRadius,brush_tip:surfaceBrushTip,
      protected_regions:guardedSurfaceMasks,
      pattern:surfacePattern,
    };
    if(surfaceInkMode==='shade_ink'){
      if(!surfaceShadeColors){
        error='Shade Ink needs two or more distinct authored #RRGGBB swatches.';return;
      }
      if(gesture.seam){
        error='Shade Ink is limited to one source-selected Cube face.';return;
      }
      const next=await command('rust_editor_shade_surface_stroke',{
        expectedEpoch:gesture.epoch,expectedRevision:gesture.revision,
        intent:{...shared,shade_ramp:surfaceShadeColors,
          direction:surfaceShadeDirection},
      });
      if(next)notice='Shade Ink stepped each eligible original pixel by one exact authored ramp swatch in one Undo.';
      return;
    }
    const next=await command('rust_editor_paint_surface_stroke',{
      expectedEpoch:gesture.epoch,expectedRevision:gesture.revision,
      intent:{
        ...shared,source_base_rgba:[...base,255],paint_rgba:[...color,255],
        ...(gesture.seam?{seam:{
          cube_uuid:gesture.seam.cubeUuid,
          face:gesture.seam.face,
          expected_face_uv:gesture.seam.sourceUv,
          expected_face_rotation:gesture.seam.sourceRotation,
          points:gesture.seam.points,
        }}:{}),
      },
    });
    if(next){
      notice=gesture.seam
        ? 'Two adjacent Cube faces painted in one Rust Undo step; identity and alpha guards remain.'
        : '3D brush committed in one Undo with exact original RGB and protected masks.';
    }
  }
  function startSurfaceProtection(event:PointerEvent,target:HTMLImageElement){
    if(!snapshot||busy||loading||paintStroke||event.button!==0||
       validSemanticPreview||validExternalPreview)return;
    const point=paintPoint(event,target),uuid=snapshot.textureUuids[paintTextureIndex];
    if(!point||!uuid||!snapshot.paintEditableTextures[paintTextureIndex])return;
    if(surfaceProtectionBinding?.epoch!==snapshot.epoch||
       surfaceProtectionBinding.textureUuid!==uuid){
      surfaceProtectedRegions=[];
      surfaceProtectionBinding={epoch:snapshot.epoch,textureUuid:uuid};
    }
    surfaceMaskDrag={pointerId:event.pointerId,from:point,to:point,
      epoch:snapshot.epoch,textureUuid:uuid};
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveSurfaceProtection(event:PointerEvent,target:HTMLImageElement){
    const drag=surfaceMaskDrag;
    if(!drag||drag.pointerId!==event.pointerId||!snapshot)return;
    const point=paintPoint(event,target);
    if(point)surfaceMaskDrag={...drag,to:point};
  }
  function finishSurfaceProtection(event:PointerEvent,target:HTMLImageElement,
    cancelled:boolean){
    const held=surfaceMaskDrag;
    if(!held||held.pointerId!==event.pointerId)return;
    if(!cancelled)moveSurfaceProtection(event,target);
    const completed=surfaceMaskDrag??held;
    surfaceMaskDrag=null;
    if(target.hasPointerCapture(event.pointerId))
      target.releasePointerCapture(event.pointerId);
    if(cancelled||!snapshot||
       completed.epoch!==snapshot.epoch||
       completed.textureUuid!==snapshot.textureUuids[paintTextureIndex])return;
    const rect=protectedAtlasRectangle(completed.from,completed.to,
      snapshot.textureResolution);
    if(!rect)return;
    if(!surfaceProtectedRegions.some(r=>
      JSON.stringify(r)===JSON.stringify(rect))){
      if(surfaceProtectedRegions.length>=16){
        error='Up to 16 protected rectangles per texture. Clear or consolidate masks.';
        return;
      }
      clearSurfaceSelection();
      surfaceProtectedRegions=[...surfaceProtectedRegions,rect];
    }
    event.preventDefault();
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
    if(surfaceProtectMode){
      if(event.currentTarget instanceof HTMLImageElement)
        startSurfaceProtection(event,event.currentTarget);
      return;
    }
    if (!snapshot || busy || validSemanticPreview || validExternalPreview || paintStroke || event.button !== 0 ||
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
    if(surfaceMaskDrag){
      if(event.currentTarget instanceof HTMLImageElement)
        moveSurfaceProtection(event,event.currentTarget);
      return;
    }
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
    if(surfaceMaskDrag){
      if(event.currentTarget instanceof HTMLImageElement)
        finishSurfaceProtection(event,event.currentTarget,cancelled);
      return;
    }
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
      else if (livePairingDialog) livePairingDialog = false;
      else if (recoveryDialog) recoveryDialog = false;
      else if (newDialog) newDialog = false;
      closeMenus(); return;
    }
    if (newDialog || confirmDiscard || recoveryDialog || livePairingDialog) {
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
    try{
      brushPresets=readBrushPresets(window.localStorage.getItem(
        BRUSH_PRESET_STORAGE_KEY));
    }catch{brushPresetError='Could not read presets from local app storage.';}
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
    if (isTauri()) {
      void invoke<boolean>('rust_live_read_available')
        .then((available) => { if (!disposed) liveReadAvailable = available; })
        .catch(() => { liveReadAvailable = false; });
    }
    void load();
    return () => {
      disposed = true;
      unlistenClose?.();
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
      if (livePairing) void stopLiveRead();
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
              disabled={!!paintStroke || !!surfaceMaskDrag} onclick={() => {
                if(paintTextureIndex!==index){
                  clearSemanticPreview();clearSurfaceProtection();
                  selectedTexturePreview=null;
                }
                paintTextureIndex=index;
              }}>
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
      <span>RGBA8 · {snapshot?.textureResolution[0]} × {snapshot?.textureResolution[1]} atlas · {snapshot?.scopedTexturePreview
        ? '3D preview follows Cube scopes' : '3D preview follows Paint texture selection'}</span>
    </div>
    {#if snapshot}
      {#if !snapshot.scopedTexturePreview &&
        !selectedTextureSource && snapshot.textureUuids[paintTextureIndex]}
        <div class="surface-paint-panel">
          <p class="hint">This atlas is not in the eager 3D preview. You can
            load just the selected PNG without loading every atlas into WebView.</p>
          <button type="button" onclick={() => void loadSelectedTexturePreview()}
            disabled={busy || loading || !!paintStroke}>Load selected atlas preview</button>
        </div>
      {/if}
      <section class="paint-starter semantic-material-panel" aria-label="External pixel editor PNG">
        <div class="dock-title"><span>EXTERNAL PIXEL EDITOR</span></div>
        <p class="hint">Export the current atlas PNG and edit it in Aseprite,
          Pixelorama, Photoshop or Krita. Reimport as a disposable candidate
          for one explicitly mapped, non-shared Cube face. Only the selected
          original base RGB may change; alpha and other original details cannot.</p>
        <div class="semantic-material-fields">
          <label>Face
            <select bind:value={selectedFace} disabled={busy || !!paintStroke}
              onchange={clearSemanticPreview}>
              {#each FACES as face}<option value={face}>{face}</option>{/each}
            </select>
          </label>
          <label>Original editable RGB
            <input type="color" bind:value={externalBase}
              disabled={busy || !!paintStroke} onchange={clearExternalPreview}/>
          </label>
        </div>
        <button type="button" disabled={busy || loading || !!paintStroke ||
            !selectedId || !snapshot.paintEditableTextures[paintTextureIndex] ||
            !snapshot.texturePreviewSources[paintTextureIndex]}
          onclick={() => void chooseExternalTextureCandidate()}>
          Choose edited PNG…
        </button>
        {#if validExternalPreview}
          <p class="hint">Selected PNG {externalPreview?.selectedPngSha256.slice(0,12)}
            · model unchanged. Capture both renders using the same fixed camera.</p>
          <div class="semantic-material-actions" role="group" aria-label="External PNG comparison">
            <button type="button" disabled={busy}
              onclick={() => void showExternalTextureCandidate(false)}>Capture Source</button>
            <button type="button" disabled={busy}
              onclick={() => void showExternalTextureCandidate(true)}>Capture Candidate</button>
            <button type="button" disabled={busy}
              onclick={clearExternalPreview}>Discard</button>
          </div>
          {#if externalSourceCapture || externalCandidateCapture}
            <div class="semantic-material-comparison" aria-label="External PNG source candidate renders">
              {#if externalSourceCapture}
                <figure><img src={externalSourceCapture} draggable="false"
                  alt={'Source at '+externalCapturedView}/>
                  <figcaption>Source · {externalCapturedView}</figcaption></figure>
              {/if}
              {#if externalCandidateCapture}
                <figure><img src={externalCandidateCapture} draggable="false"
                  alt={'External PNG candidate at '+externalCapturedView}/>
                  <figcaption>Candidate · {externalCapturedView}</figcaption></figure>
              {/if}
            </div>
          {/if}
          <label class="semantic-material-review">
            <input type="checkbox" bind:checked={externalReviewed}
              disabled={busy || !externalViewedSource || !externalViewedCandidate ||
                !matchingRenderedMaterialPair(externalSourceCapture,externalCandidateCapture,
                  externalCapturedView,reviewViewId)}/>
            I compared the matching renders and checked existing markings.
          </label>
          <button type="button" disabled={busy || !externalReadyForApply}
            onclick={() => void applyExternalTextureCandidate()}>Apply reviewed external PNG</button>
          <p class="hint">RGBA8 PNG must have the exact atlas dimensions. Marks
            with the same base RGB cannot be recognized automatically; preserve
            them before acknowledging the comparison.</p>
        {/if}
      </section>
      <section class="paint-starter semantic-material-panel" aria-label="Semantic painted-metal candidate">
        <div class="dock-title"><span>SEMANTIC PAINTED METAL</span></div>
        <p class="hint">Source-aware candidate only. Select a reference PNG and the actual
          Cube, face, base RGB and approved shade colors; the reference is not automatically verified.</p>
        <button type="button" disabled={busy || loading || !!paintStroke}
          onclick={() => void chooseSemanticReference()}>Choose reference PNG…</button>
        {#if semanticReferenceStatus}<p class="hint">{semanticReferenceStatus}</p>{/if}
        {#if semanticReferenceImage}
          <img class="semantic-material-reference"
            src={semanticReferenceImage} draggable="false"
            alt="User-selected material reference; artistic approval is not verified"/>
        {/if}
        <div class="semantic-material-fields">
          <label>Face
            <select bind:value={selectedFace} disabled={busy || !!paintStroke}
              onchange={clearSemanticPreview}>
              {#each FACES as face}<option value={face}>{face}</option>{/each}
            </select>
          </label>
          <label>Base RGB <input type="color" bind:value={semanticBase}
            disabled={busy || !!paintStroke} onchange={clearSemanticPreview}/></label>
          <label>Shadow RGB <input type="color" bind:value={semanticShadow}
            disabled={busy || !!paintStroke} onchange={clearSemanticPreview}/></label>
          <label>Highlight RGB <input type="color" bind:value={semanticHighlight}
            disabled={busy || !!paintStroke} onchange={clearSemanticPreview}/></label>
          <label>Light corner
            <select bind:value={semanticCorner} disabled={busy || !!paintStroke}
              onchange={clearSemanticPreview}>
              <option value="upper_left">Upper left</option>
              <option value="upper_right">Upper right</option>
            </select>
          </label>
          <label>Contrast
            <select bind:value={semanticContrast} disabled={busy || !!paintStroke}
              onchange={clearSemanticPreview}>
              <option value="subtle">Subtle</option>
              <option value="balanced">Balanced</option>
            </select>
          </label>
        </div>
        {#if semanticRejectionNote}<p class="hint">{semanticRejectionNote}</p>{/if}
        <button type="button" disabled={busy || loading || !!paintStroke ||
          !selectedId || !semanticReferenceSha ||
          !snapshot.paintEditableTextures[paintTextureIndex]}
          onclick={() => void previewSemanticMaterial()}>Preview material</button>
        {#if validSemanticPreview}
          <div class="semantic-material-actions" role="group" aria-label="Capture matched material comparison">
            <button type="button" aria-pressed={!semanticShowCandidate}
              disabled={busy} onclick={() => void showSemanticCandidate(false)}>Capture Source</button>
            <button type="button" aria-pressed={semanticShowCandidate}
              disabled={busy} onclick={() => void showSemanticCandidate(true)}>Capture Candidate</button>
            <button type="button" disabled={busy} onclick={clearSemanticPreview}>Discard</button>
          </div>
          <label>Reason if rejected
            <select bind:value={semanticRejectReason} disabled={busy}>
              <option value="flat_volume">Flat or poorly formed shading</option>
              <option value="identity_risk">Approved identity at risk</option>
              <option value="style_mismatch">Material/style mismatch</option>
              <option value="other">Other visual defect</option>
            </select>
          </label>
          <button type="button" disabled={busy}
            onclick={rejectSemanticCandidate}>Reject and revise</button>
          <p class="hint">Use the camera selector above, then capture Source and
            Candidate at that same fixed view. The capture refuses unloaded
            textures; if an image is still loading, retry its button.
            Rejected exact treatments cannot be repeated unchanged.</p>
          {#if semanticSourceCapture || semanticCandidateCapture}
            <div class="semantic-material-comparison" aria-label="Matched fixed-camera source and candidate">
              {#if semanticSourceCapture}
                <figure><img src={semanticSourceCapture} draggable="false"
                  alt={'Original Rust preview at ' + semanticCapturedView}/>
                  <figcaption>Source · {semanticCapturedView}</figcaption></figure>
              {/if}
              {#if semanticCandidateCapture}
                <figure><img src={semanticCandidateCapture} draggable="false"
                  alt={'Candidate Rust preview at ' + semanticCapturedView}/>
                  <figcaption>Candidate · {semanticCapturedView}</figcaption></figure>
              {/if}
            </div>
          {/if}
          {#if semanticSourceCapture && semanticCandidateCapture &&
            semanticSourceCapture===semanticCandidateCapture}
            <p class="hint">No rendered difference from this camera.
              Choose a view showing the selected face and capture both again.</p>
          {/if}
          <label class="semantic-material-review">
            <input type="checkbox" bind:checked={semanticReviewed}
              disabled={busy || !semanticViewedSource || !semanticViewedCandidate}/>
            I compared both fixed-camera captures with the selected reference and checked visible identity markings.
          </label>
          <button type="button" disabled={busy || !semanticReadyForApply}
            onclick={() => void applySemanticCandidate()}>Apply inspected candidate</button>
          <p class="hint">This is a user-selected treatment, not an independent artistic PASS.
            Full-face review remains required.</p>
        {/if}
      </section>
      <section class="paint-starter paint-workspace-tools" aria-label="Basic Rust-owned Paint">
          <div class="dock-title"><span>ATLAS &amp; BRUSH</span></div>
          {#if snapshot.atlasResolutionEditable}
            <div class="paint-atlas-resolution" role="group" aria-label="New empty model atlas size">
              <label>Atlas width
                <input type="number" min="1" max={MAX_PAINT_ATLAS_SIDE} step="1"
                  bind:value={requestedAtlasWidth} disabled={busy || loading}/>
              </label>
              <label>Atlas height
                <input type="number" min="1" max={MAX_PAINT_ATLAS_SIDE} step="1"
                  bind:value={requestedAtlasHeight} disabled={busy || loading}/>
              </label>
              <button type="button" onclick={setEmptyAtlasResolution}
                disabled={busy || loading || !Number.isInteger(requestedAtlasWidth) ||
                  !Number.isInteger(requestedAtlasHeight) ||
                  requestedAtlasWidth < 1 || requestedAtlasWidth > MAX_PAINT_ATLAS_SIDE ||
                  requestedAtlasHeight < 1 || requestedAtlasHeight > MAX_PAINT_ATLAS_SIDE}
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
          <p class="hint">Import accepts embedded RGBA8 PNG at {snapshot.textureResolution[0]} × {snapshot.textureResolution[1]} px (up to 80 MiB, subject to project size); the local file is not modified.</p>
          <div class="surface-paint-panel" aria-label="Source-bound 3D pixel painting">
            <label><input type="checkbox" bind:checked={surfacePaint3d}
              disabled={busy || loading || !!paintStroke || !!surfaceMaskDrag}/>
              Paint directly on 3D Cube</label>
            <label>Brush radius
              <input type="number" min="1" max="4" step="1"
                bind:value={surfaceBrushRadius}
                disabled={busy || !!paintStroke || !!surfaceMaskDrag}/>
            </label>
            <label>Brush tip
              <select bind:value={surfaceBrushTip}
                disabled={busy || !!paintStroke || !!surfaceMaskDrag}>
                <option value="square">Square</option>
                <option value="diamond">Diamond</option>
              </select>
            </label>
            <label>Pattern stencil
              <select bind:value={surfacePatternMode}
                disabled={busy || !!paintStroke || !!surfaceMaskDrag}>
                <option value="none">Solid (no pattern)</option>
                <option value="checker">Checker</option>
                <option value="dots">Dots</option>
                <option value="diagonal">Diagonal</option>
              </select>
            </label>
            {#if surfacePatternMode!=='none'}
              <label>Period (texels)
                <input type="number" min="1" step="1"
                  bind:value={surfacePatternPeriod}
                  disabled={busy || !!paintStroke || !!surfaceMaskDrag}/>
              </label>
              <label>Offset X
                <input type="number" min="0" step="1"
                  bind:value={surfacePatternPhaseX}
                  disabled={busy || !!paintStroke || !!surfaceMaskDrag}/>
              </label>
              <label>Offset Y
                <input type="number" min="0" step="1"
                  bind:value={surfacePatternPhaseY}
                  disabled={busy || !!paintStroke || !!surfaceMaskDrag}/>
              </label>
              {#if !surfacePatternReady}
                <p class="hint">Pattern requires whole-number period and offsets.</p>
              {/if}
            {/if}
            <details class="brush-presets">
              <summary>Brush presets</summary>
              <div class="brush-presets-fields">
                <label>Saved preset
                  <select bind:value={selectedBrushPresetId} disabled={busy}>
                    <option value="">Choose preset…</option>
                    {#each brushPresets as preset (preset.id)}
                      <option value={preset.id}>{preset.name}</option>
                    {/each}
                  </select>
                </label>
                <button type="button" disabled={busy || !selectedBrushPresetId}
                  onclick={applyBrushPreset}>Apply preset</button>
                <label>Preset name
                  <input type="text" maxlength="80" bind:value={brushPresetName}
                    placeholder="e.g. Soft highlight" disabled={busy}/>
                </label>
                <button type="button" disabled={busy || !!paintStroke}
                  onclick={saveBrushPreset}>Save / Update</button>
                <button type="button" disabled={busy || !selectedBrushPresetId}
                  onclick={deleteBrushPreset}>Delete preset</button>
              </div>
              <p class="hint">Saved locally: brush, Shade Ink and pattern settings only.
                No image, Cube identity, selection or Paint permission is stored.</p>
              {#if brushPresetError}<p class="hint" role="status">{brushPresetError}</p>{/if}
            </details>
            <label><input type="checkbox" bind:checked={surfaceGrayscalePreview}
              disabled={busy || !surfacePaint3d}/>
              Grayscale viewport (read-only)</label>
            <label><input type="checkbox" bind:checked={surfaceSampleMode}
              onchange={() => {if(surfaceSampleMode)surfaceSelectMode=false;}}
              disabled={busy || !surfacePaint3d || !!surfaceMaskDrag}/>
              Pick original RGB from 3D (Rust)</label>
            <label><input type="checkbox" bind:checked={surfaceSelectMode}
              onchange={() => {if(surfaceSelectMode)surfaceSampleMode=false;}}
              disabled={busy || !surfacePaint3d || !!surfaceMaskDrag}/>
              Magic Wand: select connected source color</label>
            <label>Selection operation
              <select bind:value={surfaceSelectOperation} disabled={busy || !surfacePaint3d}>
                <option value="replace">Replace</option>
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
                <option value="intersect">Intersect</option>
              </select>
            </label>
            <button type="button" onclick={() => void invertSurfaceSelection()}
              disabled={busy || !validSurfaceSelection}>Invert within Cube face</button>
            <p class="hint">Add, Subtract and Intersect use another original-color
              island on the same Cube face. Invert works only inside that face.
              Rust recomputes the selection from original pixels at Apply.</p>
            {#if validSurfaceSelection}
              <button type="button" onclick={clearSurfaceSelection}
                disabled={busy || !!surfaceMaskDrag}>
                Clear connected selection ({surfaceSelection?.pixelCount} px)
              </button>
            {/if}
            <label>3D ink mode
              <select bind:value={surfaceInkMode}
                disabled={busy || !!paintStroke || !!surfaceMaskDrag}>
                <option value="color">Opaque original-color Pencil</option>
                <option value="shade_ink">Shade Ink (exact palette steps)</option>
              </select>
            </label>
            {#if surfaceInkMode==='shade_ink'}
              <label>Shade direction
                <select bind:value={surfaceShadeDirection}
                  disabled={busy || !!surfaceMaskDrag}>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                </select>
              </label>
              <label class="surface-ramp-field">Artist shade ramp
                (darkest to lightest, comma-separated)
                <textarea rows="2" bind:value={surfaceShadeRamp}
                  placeholder="#202a3b, #445870, #8297b0, #c5d8ed"
                  disabled={busy || !!surfaceMaskDrag}></textarea>
              </label>
              <p class="hint">Ramp is artist-supplied, not quantized. Each
                eligible pixel moves exactly one swatch per gesture. Other
                colors remain unchanged. No fixed palette-count limit.</p>
              {#if !surfaceShadeColors}
                <p class="hint">Enter two or more unique #RRGGBB swatches
                  to enable Shade Ink painting.</p>
              {/if}
            {/if}
            <label><input type="checkbox" bind:checked={surfaceSeamEnabled}
              disabled={busy || !surfacePaint3d || !!surfaceMaskDrag ||
                surfaceInkMode==='shade_ink' || validSurfaceSelection || !!surfacePattern}/>
              Bridge adjacent Cube faces (one Undo)</label>
            <label>Original editable RGB
              <input type="color" bind:value={surfaceSourceBase}
                disabled={busy || !!paintStroke || !!surfaceMaskDrag}/>
            </label>
            <label><input type="checkbox" bind:checked={surfaceProtectMode}
              disabled={busy || !!paintStroke || !!surfaceMaskDrag ||
                validSemanticPreview || validExternalPreview}/>
              Mark protected rectangle on atlas</label>
            <button type="button" onclick={clearSurfaceProtection}
              disabled={busy || !!surfaceMaskDrag || !guardedSurfaceMasks.length}>
              Clear protected areas ({guardedSurfaceMasks.length})
            </button>
            <p class="hint">Brushes remain hard pixel clusters with radius 1–4.
              All color changes use the exact original opaque RGBA from Rust;
              other original colors, identity masks, alpha and shared UV are
              protected. Optional two-face bridging only applies to adjacent
              coplanar Cube faces in the same Bone and atlas; an unsupported
              seam aborts the gesture. No automatic material generation.</p>
            {#if surfaceSampleStatus}
              <p class="hint" role="status">{surfaceSampleStatus}</p>
            {/if}
            {#if surfacePaint3d && !surfacePaintEnabled}
              <p class="hint">3D Paint needs the Pencil tool, an editable
                texture, opaque Alpha (255), no preview candidate, and an idle
                Rust session. If the eager atlas preview was omitted, load
                the selected atlas above without loading every PNG.</p>
            {/if}
          </div>
          {#if snapshot.paintAdoptableTextures[paintTextureIndex] &&
            selectedTextureSource}
            <button type="button" onclick={() => void enableImportedPaintTexture()}
              disabled={busy || loading || !!paintStroke}
              title="Validate this embedded RGBA8 PNG before enabling direct edits">
              Enable Painting for Imported PNG
            </button>
            <p class="hint">Opt in to edit this compatible imported PNG. Original PNG bytes are unchanged until the first stroke; Undo restores the prior state.</p>
          {/if}
          {#if snapshot.textureNames.length}
            <label>Texture
              <select bind:value={paintTextureIndex} disabled={busy || !!paintStroke}
                onchange={() => {clearSemanticPreview();clearSurfaceProtection();
                  selectedTexturePreview=null;}}>
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
                !selectedTextureSource}
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
            selectedTextureSource}
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
            <div class="surface-atlas-frame">
              <img class="paint-atlas paint-workspace-atlas" draggable="false"
                src={paintAtlasSource ?? ''}
                alt={validSemanticPreview || validExternalPreview ?
                  'Read-only source/candidate material atlas for comparison' :
                  surfaceProtectMode ?
                    'Drag on the source atlas to protect a rectangle against 3D painting' :
                    'Editable texture atlas; drag to paint one Rust-owned stroke'}
                onpointerdown={startPaintStroke} onpointermove={movePaintStroke}
                onpointerup={finishPaintStroke}
                onpointercancel={(event) => finishPaintStroke(event, true)}
                onlostpointercapture={(event) => finishPaintStroke(event, true)}/>
              {#if validSurfaceSelection &&
                (surfaceSelection?.previewComplete || surfaceSelection?.previewRaster)}
                <canvas class="surface-selection-overlay"
                  width={surfaceSelection?.previewRaster?.width ??
                    Math.min(snapshot.textureResolution[0],512)}
                  height={surfaceSelection?.previewRaster?.height ??
                    Math.min(snapshot.textureResolution[1],512)}
                  use:drawSurfaceSelectionOverlay={{rows:surfaceSelection?.atlasRows ?? [],
                    width:snapshot.textureResolution[0],
                    height:snapshot.textureResolution[1],
                    raster:surfaceSelection?.previewRaster ?? null}}
                  aria-hidden="true"></canvas>
              {/if}
              {#each guardedSurfaceMasks as rect}
                <span class="surface-mask-mark"
                  style:left={(rect.from[0]/snapshot.textureResolution[0]*100)+'%'}
                  style:top={(rect.from[1]/snapshot.textureResolution[1]*100)+'%'}
                  style:width={((rect.to[0]-rect.from[0])/snapshot.textureResolution[0]*100)+'%'}
                  style:height={((rect.to[1]-rect.from[1])/snapshot.textureResolution[1]*100)+'%'}
                  aria-hidden="true"></span>
              {/each}
              {#if pendingSurfaceMask}
                <span class="surface-mask-mark preview"
                  style:left={(pendingSurfaceMask.from[0]/snapshot.textureResolution[0]*100)+'%'}
                  style:top={(pendingSurfaceMask.from[1]/snapshot.textureResolution[1]*100)+'%'}
                  style:width={((pendingSurfaceMask.to[0]-pendingSurfaceMask.from[0])/snapshot.textureResolution[0]*100)+'%'}
                  style:height={((pendingSurfaceMask.to[1]-pendingSurfaceMask.from[1])/snapshot.textureResolution[1]*100)+'%'}
                  aria-hidden="true"></span>
              {/if}
            </div>
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
                onchange={clearSemanticPreview}
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
                <button role="menuitem" onclick={() => void openRecoveryDialog()} disabled={busy || loading || !!paintStroke}>Recover Checkpoint…</button>
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
                {#if liveReadAvailable}
                  <div class="menu-rule"></div>
                  <button role="menuitem" onclick={() => void openLiveReadDialog()}
                    disabled={!snapshot || busy || loading || !!paintStroke}
                    title="Optional native read-only access for an independently trusted agent. LazyDesigner does not execute AI prompts or edits.">
                    {livePairing ? 'View read-only agent pairing…' : 'Pair external agent (read-only)…'}
                  </button>
                  {#if livePairing}
                    <button role="menuitem" onclick={() => void stopLiveRead()}
                      disabled={busy || loading}>Disconnect read-only agent</button>
                  {/if}
                {/if}
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
    <select bind:value={reviewViewId} aria-label="Review camera direction"
      onchange={clearSemanticComparison}
      disabled={!snapshot || busy || loading} title="Choose a fixed model camera for a source-bound PNG capture">
      <option value="front">Front</option><option value="back">Back</option>
      <option value="left">Left</option><option value="right">Right</option>
      <option value="top">Top</option><option value="bottom">Bottom</option>
    </select>
    <button onclick={() => void exportReviewCapture()}
      disabled={!snapshot || snapshot.dirty || !snapshot.sourceName ||
        busy || loading || !!paintStroke || validSemanticPreview || validExternalPreview || workspaceMode === 'animate'}
      title="Save a new source-bound Rust preview PNG. Save Copy first; this is not Bedrock rendering proof.">
      Capture PNG
    </button>
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
          texturePreviewSources={modelTextureSources}
          texturePreviewSides={snapshot.texturePreviewSides}
          texturePreviewResolutions={snapshot.texturePreviewResolutions}
          scopedTexturePreview={snapshot.scopedTexturePreview}
          textureResolution={snapshot.textureResolution}
          previewTextureIndex={paintTextureIndex}
          previewBoneTransforms={previewBoneTransforms}
          {selectedId} onSelect={selectCube}
          {surfacePaintEnabled}
          surfacePaintEpoch={snapshot.epoch}
          surfacePaintRevision={snapshot.revision}
          surfacePaintTextureUuid={snapshot.textureUuids[paintTextureIndex] ?? null}
          {surfacePaintContextKey}
          {surfaceSampleMode} {surfaceSelectMode}
          grayscalePreview={workspaceMode==='paint' && surfaceGrayscalePreview}
          surfaceSeamEnabled={surfaceSeamEnabled &&
            surfaceInkMode==='color' && !validSurfaceSelection && !surfacePattern}
          onSurfaceStroke={(gesture) => {void paintFromViewport(gesture);}}
          onSurfaceSample={(hit) => {void sampleFromViewport(hit);}}
          onSurfaceSelection={(hit) => {void selectFromViewport(hit);}}
          transformMode={workspaceMode === 'edit' ? transformTool : null}
          canTransform={workspaceMode === 'edit' && transformTool !== null && !busy && !loading && !newDialog && !confirmDiscard && !recoveryDialog && !livePairingDialog}
          onTranslate={moveFromViewport} onRotate={rotateFromViewport}
          onScale={scaleFromViewport}/>
      {:else}
        <div class="empty-editor">
          <h2>{loading ? 'Loading editor…' : 'No model open'}</h2>
          <p>Open a saved .bbmodel from Codex or your Agent App, or create a model here.</p>
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
    <span class="status-middle">{recoveryWarning || notice || (dockPersistenceError
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

{#if recoveryDialog}
  <RustRecoveryDialog entries={recoveryEntries} bind:selectedId={recoverySelectedId}
    bind:discardApproved={recoveryDiscardApproved} {busy}
    dirty={Boolean(snapshot?.dirty)} onCancel={() => recoveryDialog = false}
    onRestore={() => void restoreRecovery()}/>
{/if}

{#if livePairingDialog && livePairing}
  <RustLiveReadPairingDialog pairing={livePairing}
    bind:revealSecret={showLiveSecret}
    onKeepPaired={() => livePairingDialog = false}
    onDisconnect={() => void stopLiveRead()}/>
{/if}

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
