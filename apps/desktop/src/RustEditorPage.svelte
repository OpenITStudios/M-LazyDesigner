<script lang="ts">
  import './rust-editor.css';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount, tick } from 'svelte';
  import { recoveryCheckpointDelay, recoveryCheckpointNeeded } from './rustRecoverySchedule';
  import RustViewport from './RustViewport.svelte';
  import RustAnimationWorkspace from './RustAnimationWorkspace.svelte';
  import RustTexturesDock from './RustTexturesDock.svelte';
  import RustPaintExternalCandidate from './RustPaintExternalCandidate.svelte';
  import RustPaintSemanticCandidate from './RustPaintSemanticCandidate.svelte';
  import RustPaintAtlasCanvas from './RustPaintAtlasCanvas.svelte';
  import RustSurfacePaintControls from './RustSurfacePaintControls.svelte';
  import RustEditorMenuToolbar from './RustEditorMenuToolbar.svelte';
  import RustOutlinerPanel from './RustOutlinerPanel.svelte';
  import RustElementProperties from './RustElementProperties.svelte';
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
    defaultDockLayout, restoreDockLayout, measureDocks, measureFloatRect,
    RUST_DOCK_LAYOUT_KEY, LEGACY_DOCK_LAYOUT_V2_KEY, LEGACY_DOCK_LAYOUT_KEY,
    DOCK_SPLITTER, MIN_DOCK, MAX_DOCK,
    type DockLayout, type DockPanel, type DockSide,
  } from './rustDockLayout';
  import {createRustDockInteractions,
    type FloatingGesture, type DockResize, type InspectorResize
  } from './rustDockInteractions';

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
  let floatingGesture: FloatingGesture | null = null;
  let floatingOnTop: DockPanel | null = null;
  let pendingDockSide: DockSide | null = null;
  let dockPersistenceError = false;
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
  const faces: readonly string[] = FACES;

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

  function selectAnimationForWorkspace(uuid:string) {
    pauseAnimationPlayback();
    selectedAnimationId = uuid;
    selectedKeyframeUuid = null;
    animationTime = 0;
    animationChannel = 'rotation';
    animationValue = [0, 0, 0];
  }
  function selectPaintTexture(index:number) {
    if (paintTextureIndex !== index) {
      clearSemanticPreview();
      clearSurfaceProtection();
      selectedTexturePreview = null;
    }
    paintTextureIndex = index;
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

  const {
    floatPanel, attachPanel, returnPanel, startFloating, moveFloating, finishFloating, keyFloatingMove, keyFloatingSize, hideDock, swapDocks, resetDocks, attachTabs, separateTabs, activateAttachedTab, keyAttachedTab, startDockResize, moveDockResize, finishDockResize, keyDockResize, startInspectorResize, moveInspectorResize, finishInspectorResize, keyInspectorResize
  } = createRustDockInteractions({
    get dockLayout() { return dockLayout; },
    set dockLayout(value:DockLayout) { dockLayout = value; },
    get floatingGesture() { return floatingGesture; },
    set floatingGesture(value:FloatingGesture|null) { floatingGesture = value; },
    get floatingOnTop() { return floatingOnTop; },
    set floatingOnTop(value:DockPanel|null) { floatingOnTop = value; },
    get pendingDockSide() { return pendingDockSide; },
    set pendingDockSide(value:DockSide|null) { pendingDockSide = value; },
    get dockPersistenceError() { return dockPersistenceError; },
    set dockPersistenceError(value:boolean) { dockPersistenceError = value; },
    get dockResize() { return dockResize; },
    set dockResize(value:DockResize|null) { dockResize = value; },
    get inspectorResize() { return inspectorResize; },
    set inspectorResize(value:InspectorResize|null) { inspectorResize = value; },
    get editorWidth() { return editorWidth; },
    get editorHeight() { return editorHeight; },
    get editorBody() { return editorBody; },
    get measuredDocks() { return measuredDocks; },
    closeMenus,
  });

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
  <RustTexturesDock {side} {snapshot} {paintTextureIndex}
    hidden={dockLayout.hidden.textures} floating={!!dockLayout.floating.textures}
    selectionLocked={!!paintStroke || !!surfaceMaskDrag}
    onRestore={() => dockLayout.floating.textures
      ? returnPanel('textures') : hideDock('textures', false)}
    onMove={swapDocks} onFloat={() => floatPanel('textures')}
    onFold={() => hideDock('textures', true)}
    onSelectTexture={selectPaintTexture} />
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
      <RustPaintExternalCandidate {snapshot} {busy} {loading}
        strokeActive={!!paintStroke} {selectedId} {paintTextureIndex}
        {faces} bind:selectedFace bind:externalBase {validExternalPreview}
        {externalPreview} {externalSourceCapture} {externalCandidateCapture}
        {externalCapturedView} {externalViewedSource} {externalViewedCandidate}
        bind:externalReviewed {externalReadyForApply}
        matchedRenders={matchingRenderedMaterialPair(externalSourceCapture,
          externalCandidateCapture,externalCapturedView,reviewViewId)}
        {clearSemanticPreview} {clearExternalPreview} {chooseExternalTextureCandidate}
        {showExternalTextureCandidate} {applyExternalTextureCandidate} />
      <RustPaintSemanticCandidate {snapshot} {busy} {loading}
        strokeActive={!!paintStroke} {selectedId} {paintTextureIndex}
        {faces} bind:selectedFace {semanticReferenceStatus} {semanticReferenceImage}
        {semanticReferenceSha} bind:semanticBase bind:semanticShadow
        bind:semanticHighlight bind:semanticCorner bind:semanticContrast
        {semanticRejectionNote} {validSemanticPreview} {semanticShowCandidate}
        bind:semanticRejectReason {semanticSourceCapture} {semanticCandidateCapture}
        {semanticCapturedView} {semanticViewedSource} {semanticViewedCandidate}
        bind:semanticReviewed {semanticReadyForApply}
        {clearSemanticPreview} {chooseSemanticReference} {previewSemanticMaterial}
        {showSemanticCandidate} {rejectSemanticCandidate} {applySemanticCandidate} />
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
          <RustSurfacePaintControls {busy} {loading}
            strokeActive={!!paintStroke} selectionDragging={!!surfaceMaskDrag}
            candidatePending={validSemanticPreview || validExternalPreview}
            {surfacePatternReady} {surfacePaintEnabled} {validSurfaceSelection}
            shadeRampValid={!!surfaceShadeColors} stencilActive={!!surfacePattern}
            protectedRegionCount={guardedSurfaceMasks.length}
            selectionPixelCount={surfaceSelection?.pixelCount ?? 0}
            {surfaceSampleStatus} {brushPresets} {brushPresetError}
            {applyBrushPreset} {saveBrushPreset} {deleteBrushPreset}
            {invertSurfaceSelection} {clearSurfaceSelection} {clearSurfaceProtection}
            bind:surfacePaint3d bind:surfaceBrushRadius bind:surfaceBrushTip bind:surfacePatternMode bind:surfacePatternPeriod bind:surfacePatternPhaseX bind:surfacePatternPhaseY
            bind:selectedBrushPresetId bind:brushPresetName bind:surfaceGrayscalePreview bind:surfaceSampleMode bind:surfaceSelectMode bind:surfaceSelectOperation bind:surfaceInkMode
            bind:surfaceShadeDirection bind:surfaceShadeRamp bind:surfaceSeamEnabled bind:surfaceSourceBase bind:surfaceProtectMode />
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
             <RustPaintAtlasCanvas {snapshot}
               source={paintAtlasSource} comparing={!!validSemanticPreview || !!validExternalPreview}
               protectMode={surfaceProtectMode} {validSurfaceSelection}
               {surfaceSelection} {guardedSurfaceMasks} {pendingSurfaceMask}
               {startPaintStroke} {movePaintStroke} {finishPaintStroke} />
            <p class="dock-note">Pencil and Eraser use circular strokes. Filled Rectangle uses two corners. Each completed gesture is one Rust Undo step. Atlas selection changes only the Paint preview, not saved model face references.</p>
          {:else}
            <p class="dock-note">Only LazyDesigner-owned or explicitly enabled embedded RGBA8 PNGs can be painted. External paths, layers and unsupported formats stay read-only.</p>
          {/if}
        </section>
    {/if}
  </section>
{/snippet}


{#snippet animateWorkspace()}
  <RustAnimationWorkspace {snapshot} {busy} {loading}
    bind:newAnimationName {newAnimationLength} {selectedAnimation}
    {timelineRows} {selectedKeyframe} {selectedKeyframeUuid} {selectedBoneId}
    {playbackActive} bind:animationTime {animationChannel} {animationValue}
    {updateAnimationLength} {setSelectedAnimationLength} {createAnimation}
    onSelectAnimation={selectAnimationForWorkspace}
    {pauseAnimationPlayback} {toggleAnimationPlayback} {stopAnimationPlayback}
    {selectTransformKeyframe} {selectAnimationChannel} {updateAnimationTime}
    {updateAnimationAxis} {addTransformKeyframe} {updateTransformKeyframe}
    {removeTransformKeyframe} />
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

      <RustOutlinerPanel rows={rows} {collapsed} {selectedId} {selectedBoneId}
        {busy} {loading} strokeActive={!!paintStroke}
        inspectorSplit={dockLayout.inspectorSplit}
        {toggleBone} {selectRow} {toggleRowVisibility} />
      <div class="dock-splitter-horizontal" role="separator" aria-label="Resize Outliner and Properties"
        aria-orientation="horizontal" tabindex="0"
        aria-valuemin="20" aria-valuemax="80" aria-valuenow={dockLayout.inspectorSplit}
        onpointerdown={startInspectorResize} onpointermove={moveInspectorResize}
        onpointerup={finishInspectorResize}
        onpointercancel={(event) => finishInspectorResize(event, true)}
        onlostpointercapture={(event) => finishInspectorResize(event, true)}
        onkeydown={keyInspectorResize}></div>

      <RustElementProperties {snapshot} {selectedCube} {selectedBone}
        {busy} {loading} strokeActive={!!paintStroke} {workspaceMode}
        {faceUv} {faceRotation} {faces} axes={AXES} bind:selectedFace
        {renameSelected} {reparentSelected} {position} {size} {rotation}
        {boneRotation} {boxOffset} {uvEdit} {uvRotate}
        {clearSemanticPreview} />
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
  <RustEditorMenuToolbar {snapshot} {busy} {loading} {workspaceMode}
    {dockLayout} {selectedId} {selectedBoneId} strokeActive={!!paintStroke} {liveReadAvailable}
    liveReadPaired={!!livePairing} {validSemanticPreview} {validExternalPreview}
    bind:menu bind:transformTool bind:reviewViewId
    {requestNew} {requestOpen} {saveCopy} {openRecoveryDialog}
    {exportGeometry} {exportAnimations} {openLiveReadDialog} {stopLiveRead}
    {openLegacyWorkspace} {addCube} {addBone} {duplicateSelectedCube}
    {deleteSelected} {history} {hideDock} {swapDocks} {attachTabs}
    {separateTabs} {returnPanel} {floatPanel} {resetDocks}
    {selectWorkspace} {closeMenus} {clearSemanticComparison}
    {exportReviewCapture} frameModel={() => viewport?.frameModel()} />

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

<style>
  .paint-starter { display: grid; gap: 8px; padding: 10px; border-top: 1px solid #374151; }
  .paint-starter label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .paint-starter select { min-width: 0; max-width: 100%; flex: 1; }
</style>
