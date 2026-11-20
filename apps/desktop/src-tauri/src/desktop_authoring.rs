//! Tauri adapter for the one authoritative Rust Bedrock document session.
//! This module never implements its own geometry, history or .bbmodel codec.
//!
//! Synchronous snapshot/transaction commands use Tauri's `command(async)`
//! dispatch rather than running validation, history cloning, Paint, Dirty SHA
//! and snapshot projection on the main UI thread. The existing EditorStore
//! mutex and expected epoch/revision still serialize source edits. This
//! does not prove runtime responsiveness or remove the clone/Undo cost.
//! Hot editor edits stage a temporary Rust session without the store lock and
//! publish only if epoch + revision remain current. A stale attempt is denied,
//! never automatically retried or written to an original model.

use crate::desktop_error::DesktopError;
use crate::editor_recovery;
use lazydesigner::authoring::{
    storage, sha256, paint_texture_editable, paint_texture_adoptable, paint_texture_exportable,
    paint_texture_snapshot_flags,
    export_paint_png, export_bedrock_geometry, export_bedrock_animations,
    bedrock_animation_curve_fidelity,
    has_per_texture_uv_rules, can_set_empty_atlas_resolution,
    can_add_paint_texture, parse_saved_bezier_handles, valid_track_segments,
    saved_timeline_markers, valid_saved_markers, SavedTimelineMarker,
    BezierKeyframeHandles,
    AuthoringDocument, Bone, Cube, EditOperation, EditPlan, EditorSession,
    SemanticMaterialIntent, SemanticMaterialProposal, ExternalFaceTextureIntent, SurfacePaintIntent,
    SurfacePaintSampleRequest, SurfaceSourceSample,
    SurfaceSelectionRequest, SurfaceSelectionReceipt,
    SurfaceShadeInkIntent,
    OutlinerNode, MAX_MODEL_BYTES, MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES, MAX_PAINT_TEXTURES,
};
use base64::{engine::general_purpose::STANDARD, read::DecoderReader, Engine as _};
use rand::RngCore;
use rfd::FileDialog;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use tauri::{Manager, State};

mod preview_animation;
mod preview_texture;
mod snapshot_projection;
use snapshot_projection::*;
mod material_candidate_verification;
use material_candidate_verification::{
    preview_semantic_candidate, apply_checked_semantic_candidate,
};
mod material_candidate_previews;
mod review_capture_validation;
use review_capture_validation::{decode_review_capture_png, review_capture_source};
mod bedrock_resource_exports;
use preview_animation::animation_views;
use preview_texture::{
    texture_preview_side,embedded_png_preview_candidate,
    embedded_png_preview_source,PreviewUvMode,preview_uv_mode,
    project_atlas_preview_grid,texture_preview_assets_in_mode,
    texture_scope_indices,scoped_cube_texture_index,
};
#[cfg(test)]
use preview_texture::{texture_preview_assets,texture_preview_sources};
#[cfg(test)]
use preview_animation::{indexed_bone_names,register_preview_time};

pub struct EditorState {
    store: Mutex<EditorStore>,
    // Independent edit gate: one provisional document transaction per editor.
    pending_edit: Mutex<()>,
    // Not a capability or authentication credential. It only separates
    // private recovery checkpoints written by separate desktop processes.
    recovery_run_id: String,
}

impl Default for EditorState {
    fn default() -> Self {
        Self {
            store: Mutex::new(EditorStore::default()),
            pending_edit: Mutex::new(()),
            recovery_run_id: create_uuid().replace('-', ""),
        }
    }
}

#[derive(Default)]
struct EditorStore {
    epoch: u64,
    active: Option<ActiveModel>,
}

struct ActiveModel {
    session: EditorSession,
    source_path: Option<PathBuf>,
    // Raw disk byte identity: external-file change detection.
    source_sha: Option<String>,
    // Last Open/Save Copy canonical Rust model bytes: Undo/Redo dirty status.
    saved_canonical_sha: Option<String>,
    dirty: bool,
}

/// An immutable, admitted session for file conversion and source integrity
/// checks outside EditorStore's short-lived mutex. This is not another model.
struct FrozenPublication {
    session: EditorSession,
    source_path: Option<PathBuf>,
    source_sha: Option<String>,
    saved_canonical_sha: Option<String>,
    dirty: bool,
}
impl From<&ActiveModel> for FrozenPublication {
    fn from(active: &ActiveModel) -> Self {
        Self {
            session: active.session.clone(),
            source_path: active.source_path.clone(),
            source_sha: active.source_sha.clone(),
            saved_canonical_sha: active.saved_canonical_sha.clone(),
            dirty: active.dirty,
        }
    }
}

/// A revision-bound read-only projection of the same canonical Rust document.
/// Capture under the store lock; render the large Svelte snapshot after unlock.
struct FrozenEditorProjection {
    document: Arc<AuthoringDocument>,
    epoch: u64,
    revision: u64,
    source_name: Option<String>,
    dirty: bool,
    can_undo: bool,
    can_redo: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CubeView {
    uuid: String,
    name: String,
    from: [f64; 3],
    to: [f64; 3],
    origin: [f64; 3],
    rotation: [f64; 3],
    inflate: f64,
    stretch: [f64; 3],
    visible: bool,
    render_order: i8,
    box_uv: bool,
    uv_offset: [f64; 2],
    auto_uv: u8,
    color: usize,
    faces: Map<String, Value>,
    // Read-only resolved texture scope for the supported attachable ruleset.
    preview_texture_index: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoneView {
    uuid: String,
    name: String,
    origin: [f64; 3],
    rotation: [f64; 3],
    visible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotationKeyframeView {
    uuid: String,
    bone_uuid: String,
    time: f64,
    rotation: [f64; 3],
}

/// Read-only typed source projection. Unknown clip metadata is never
/// manufactured as a transform pose or silently discarded from Rust.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformKeyframeView {
    uuid: String,
    bone_uuid: String,
    channel: String,
    time: f64,
    value: [f64; 3],
    interpolation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bezier: Option<BezierKeyframeHandles>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationView {
    uuid: String,
    name: String,
    length: f64,
    loop_mode: String,
    rotation_keyframes: Vec<RotationKeyframeView>,
    transform_keyframes: Vec<TransformKeyframeView>,
    markers: Vec<SavedTimelineMarker>,
    preview_supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSnapshot {
    epoch: u64,
    revision: u64,
    name: String,
    source_name: Option<String>,
    dirty: bool,
    can_undo: bool,
    can_redo: bool,
    cubes: Vec<CubeView>,
    bones: Vec<BoneView>,
    hierarchy: Vec<OutlinerNode>,
    geometry_source_key: String,
    geometry_reused: bool,
    texture_names: Vec<String>,
    texture_uuids: Vec<Option<String>>,
    texture_preview_sources: Vec<Option<String>>,
    // Optional PNG transport shortcut only; never model or permission authority.
    preview_source_key: String,
    preview_sources_reused: bool,
    texture_preview_sides: Vec<Option<&'static str>>,
    texture_preview_resolutions: Vec<Option<[u32; 2]>>,
    scoped_texture_preview: bool,
    paint_editable_textures: Vec<bool>,
    paint_adoptable_textures: Vec<bool>,
    paint_exportable_textures: Vec<bool>,
    texture_resolution: [u32; 2],
    atlas_resolution_editable: bool,
    paint_texture_addable: bool,
    animation_count: usize,
    animations: Vec<AnimationView>,
    animation_source_key: String,
    animations_reused: bool,
    preview_scope: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintPngExportReceipt {
    sha256: String,
    byte_count: usize,
}

/// A source-revision-bound Paint atlas requested explicitly by the user.
/// The PNG source is disposable preview data, never native write authority.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedTexturePreviewReceipt {
    epoch: u64,
    revision: u64,
    texture_index: usize,
    texture_uuid: String,
    texture_source: Option<String>,
    source_sha256: String,
    source_reused: bool,
    texture_resolution: [u32; 2],
    source_authority: &'static str,
    write_authority: &'static str,
    preview_scope: &'static str,
}

/// User-initiated PNG of the current Three.js Rust preview only. This receipt
/// reports exact saved .bbmodel and PNG bytes, NOT camera/image fidelity.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCaptureReceipt {
    source_model_sha256: String,
    capture_png_sha256: String,
    view_id: String,
    file_name: String,
    byte_count: usize,
    preview_scope: &'static str,
}

/// Operator-selected local reference image digest. Choosing a file does
/// not prove that the image was accepted as the material style master.
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SemanticMaterialReferenceReceipt {
    png_sha256: String,
    byte_count: usize,
    // Kept in the local Tauri UI for real human comparison. Never sent to
    // the permission-denied Code Mode guest or persisted as a model asset.
    reference_png_source: String,
    reference_authority: &'static str,
}

/// Ephemeral candidate bitmap *for the existing Three.js viewport only*.
/// It carries NO usable file path, live-model mutation or review verdict.
/// The caller swaps one texture source and must restore the original on exit.
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SemanticMaterialPreviewReceipt {
    epoch: u64,
    revision: u64,
    source_model_sha256: String,
    candidate_sha256: String,
    reference_png_sha256: String,
    cube_uuid: String,
    texture_uuid: String,
    texture_index: usize,
    candidate_png_source: String,
    material_evidence: Value,
    preview_scope: &'static str,
    visual_verdict: &'static str,
    write_authority: &'static str,
}

/// Local-only preview of a selected existing-face PNG edit. The imported
/// editor PNG is normalized to Rust-owned bytes; no path reaches the UI/guest.
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ExternalFaceTexturePreviewReceipt {
    epoch:u64,
    revision:u64,
    source_model_sha256:String,
    candidate_sha256:String,
    cube_uuid:String,
    texture_uuid:String,
    face:String,
    texture_index:usize,
    candidate_png_source:String,
    selected_png_sha256:String,
    preview_scope:&'static str,
    visual_verdict:&'static str,
    write_authority:&'static str,
}

/// Read-only geometry output receipt; native file paths never enter Svelte.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryExportReceipt {
    sha256: String,
    byte_count: usize,
}

/// Bedrock animation export has independent output identity, never a saved model.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationExportReceipt {
    sha256: String,
    byte_count: usize,
    curve_fidelity: &'static str,
}

fn failure(code: &'static str, detail: impl Into<String>) -> DesktopError {
    DesktopError::recoverable(code, detail.into())
}
fn model_failure(message: String) -> DesktopError {
    failure("RUST_MODEL_REJECTED", message)
}
fn lock_store(store: &Mutex<EditorStore>) -> Result<MutexGuard<'_, EditorStore>, DesktopError> {
    store.lock().map_err(|_| failure("RUST_EDITOR_UNAVAILABLE", "Authoring session lock is unavailable."))
}
fn lock(state: &State<'_, EditorState>) -> Result<MutexGuard<'_, EditorStore>, DesktopError> {
    lock_store(&state.store)
}
fn check_epoch(store: &EditorStore, expected: u64) -> Result<(), DesktopError> {
    if store.epoch != expected {
        Err(failure("RUST_EDITOR_SESSION_STALE", "The active model changed. Refresh the editor state before editing."))
    } else {
        Ok(())
    }
}
// One serialization gate for all model writes AND file publication. Read-only
// snapshot calls never acquire it, and conversion/disk I/O never hold store.
fn write_lease(gate: &Mutex<()>) -> Result<MutexGuard<'_, ()>, DesktopError> {
    match gate.try_lock() {
        Ok(guard) => Ok(guard),
        Err(TryLockError::WouldBlock) => Err(failure(
            "RUST_EDITOR_EDIT_BUSY", "An editor edit is already in progress.")),
        Err(TryLockError::Poisoned(_)) => Err(failure(
            "RUST_EDITOR_UNAVAILABLE", "The editor edit gate is unavailable.")),
    }
}

fn freeze_publication(
    store: &Mutex<EditorStore>, expected_epoch: u64,
    expected_revision: u64, stale_message: &'static str,
) -> Result<FrozenPublication, DesktopError> {
    let guard = lock_store(store)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_ref().ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", stale_message));
    }
    Ok(FrozenPublication::from(active))
}

// Preserve the same-directory, raw source SHA and no-overwrite admission,
// but do its bounded filesystem read without holding the editor store mutex.
fn verify_publication_source(
    source: &FrozenPublication, output: &std::path::Path,
    changed_message: &'static str,
) -> Result<(), DesktopError> {
    if let Some(ref path) = source.source_path {
        storage::same_directory(path, output).map_err(model_failure)?;
        let expected = source.source_sha.as_ref().ok_or_else(|| failure(
            "RUST_EDITOR_SOURCE_UNKNOWN", "The original source identity is missing."))?;
        let data = storage::read_bounded(path, MAX_MODEL_BYTES).map_err(model_failure)?;
        if sha256(&data) != *expected {
            return Err(failure("RUST_EDITOR_SOURCE_CHANGED", changed_message));
        }
    }
    Ok(())
}

/// Revision advances are not equivalent to unsaved content. Reconcile the
/// edited Rust document with the last Open/Save Copy canonical snapshot,
/// without creating an alternate scene or changing the raw source SHA guard.
fn refresh_dirty(active: &mut ActiveModel) {
    active.dirty = match active.saved_canonical_sha.as_ref() {
        Some(saved) => active.session.canonical_sha256()
            .map_or(true, |current| current != *saved),
        // New projects, or models that cannot safely serialize, must
        // remain unsaved. Never report a failed export as 'clean' after
        // an already-committed Rust Edit/Undo/Redo transaction.
        None => true,
    };
}

fn check_discard(store: &EditorStore, allowed: bool) -> Result<(), DesktopError> {
    if store.active.as_ref().is_some_and(|m| m.dirty) && !allowed {
        Err(failure("RUST_EDITOR_UNSAVED", "The current model has unsaved edits. Export a copy or confirm discarding changes."))
    } else {
        Ok(())
    }
}

fn current_detached(
    guard: MutexGuard<'_, EditorStore>, reuse: ProjectionReuse<'_>,
) -> Result<EditorSnapshot, DesktopError> {
    project_detached(guard, reuse)
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))
}

/// Stage a Rust-native transaction without holding the editor's global lock.
/// The provisional session shares immutable Arc snapshots/history; its apply()
/// still clones, validates and atomically replaces a complete document. Only
/// the guarded commit below may install it as authoritative editor state.
fn detached_edit<F>(
    store: &Mutex<EditorStore>, gate: &Mutex<()>,
    expected_epoch: u64, expected_revision: u64,
    reuse: ProjectionReuse<'_>,
    stale_message: Option<&'static str>, edit: F,
) -> Result<EditorSnapshot, DesktopError>
where F: FnOnce(&mut EditorSession) -> Result<(), DesktopError> {
    // Prevent overlap with another staged edit or a native file publisher.
    // Read-only snapshots remain independent from this lease.
    let write_lease = write_lease(gate)?;
    let stale = || match stale_message {
        Some(message) => failure("RUST_EDITOR_REVISION_STALE", message),
        None => model_failure("DOCUMENT_REVISION_STALE".to_owned()),
    };
    let (mut pending, had_saved_source) = {
        let guard = lock_store(store)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref().ok_or_else(||
            failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(stale());
        }
        // Arc-based EditorSession clone is cheap; real document cloning
        // happens later on the temporary session outside the mutex.
        (active.session.clone(), active.saved_canonical_sha.is_some())
    };
    edit(&mut pending)?;
    // Dirty SHA used to serialize the entire canonical model while locked.
    // Compute before reacquiring the lock if a saved baseline exists.
    let canonical = had_saved_source.then(|| pending.canonical_sha256().ok());
    let mut guard = lock_store(store)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut().ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(stale());
    }
    // Saving a copy is allowed to update source identity without a revision
    // increment. Compare with the baseline currently owned by the store.
    let dirty = match active.saved_canonical_sha.as_ref() {
        Some(saved) => match canonical {
            Some(Some(ref digest)) => digest != saved,
            Some(None) => true,
            // Rare concurrent Save Copy from a previously unsaved model.
            // Do not report an incorrect clean/dirty state to save CPU.
            None => pending.canonical_sha256().map_or(true, |digest| digest != *saved),
        },
        None => true,
    };
    active.session = pending;
    active.dirty = dirty;
    // Bind the exact committed revision while the store is locked. The
    // write lease can end before the large immutable projection begins.
    let frozen = freeze_projection(&guard).ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    drop(guard);
    drop(write_lease);
    Ok(project_frozen(&frozen, reuse))
}

fn create_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5],
        bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

// One read admission for both semantic orientation and dry-run validation.
// Freeze a COW EditorSession under the short store mutex; expensive reads
// happen outside it. A completion check never authorizes subsequent writes.
fn frozen_read_session(
    store: &Mutex<EditorStore>, expected_epoch: u64, expected_revision: u64,
) -> Result<EditorSession, DesktopError> {
    let guard = lock_store(store)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_ref().ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE",
            "The model changed. Refresh before inspecting or planning."));
    }
    Ok(active.session.clone())
}

/// Trusted local adapter read only. Never includes the source path,
/// unbounded model/PNG bytes, external secrets or an edit capability.
pub(crate) fn live_read_identity(state: &EditorState) -> Result<Value, DesktopError> {
    let store = lock_store(&state.store)?;
    let active = store.active.as_ref().ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    Ok(json!({
        "status":"OK",
        "epoch":store.epoch,
        "revision":active.session.summary().revision,
        "summary":active.session.summary(),
        "dirty":active.dirty,
        "write_authority":"NOT_GRANTED",
        "visual_verdict":"UNVERIFIED",
    }))
}

/// Same frozen admission used by rust_editor_semantic_map, with a final
/// stale-result check. Readers never hold EditorStore during projection.
pub(crate) fn live_read_semantic_map(
    state: &EditorState, epoch: u64, revision: u64,
    category: &str, offset: usize, limit: usize,
) -> Result<Value, DesktopError> {
    let session = frozen_read_session(&state.store, epoch, revision)?;
    let map = session.semantic_map(category, offset, limit).map_err(model_failure)?;
    let _ = frozen_read_session(&state.store, epoch, revision)?;
    Ok(json!({
        "status":"OK", "epoch":epoch, "revision":revision,
        "summary":session.summary(), "map":map,
    }))
}

/// Native read-only semantic inventory of the currently open Rust model.
/// No external IPC listener or Code Mode live-write access is installed.
#[tauri::command(async)]
pub fn rust_editor_semantic_map(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    category: String, offset: usize, limit: usize,
) -> Result<Value, DesktopError> {
    live_read_semantic_map(
        &state, expected_epoch, expected_revision, &category, offset, limit,
    )
}

/// Dry-run on a disposable validated session. This command cannot commit an
/// operation, change Undo/Redo or write disk. Any later Apply must still pass
/// the normal revision and user/host authorization checks.
#[tauri::command(async)]
pub fn rust_editor_preflight(
    state: State<'_, EditorState>, expected_epoch: u64, plan: EditPlan,
) -> Result<Value, DesktopError> {
    let session = frozen_read_session(
        &state.store, expected_epoch, plan.expected_revision)?;
    let preflight = session.preflight(&plan).map_err(model_failure)?;
    let _ = frozen_read_session(
        &state.store, expected_epoch, plan.expected_revision)?;
    Ok(json!({"status":"OK","epoch":expected_epoch,
        "revision":plan.expected_revision,"preflight":preflight}))
}

/// A source/reference picker does not transfer the bytes or filesystem path
/// to the AI guest. The local Tauri UI receives a bounded validated PNG
/// solely to display the chosen reference beside the candidate; only its
/// hash enters the semantic Rust material intent. The user must still
/// confirm artistic relevance and approval independently.
#[tauri::command]
pub async fn rust_editor_choose_semantic_reference(
    state: State<'_, EditorState>,
    expected_epoch: u64, expected_revision: u64,
) -> Result<Option<SemanticMaterialReferenceReceipt>, DesktopError> {
    material_candidate_previews::choose_semantic_reference(state,expected_epoch,expected_revision).await
}

/// Generate a candidate from an immutable in-memory Rust source. The
/// published EditorStore, Undo and original .bbmodel are never touched.
#[tauri::command(async)]
pub fn rust_editor_preview_semantic_material(
    state: State<'_, EditorState>, expected_epoch:u64,
    expected_revision:u64, intent:SemanticMaterialIntent,
) -> Result<SemanticMaterialPreviewReceipt,DesktopError> {
    material_candidate_previews::preview_semantic_material(state,expected_epoch,expected_revision,intent)
}

/// User-selected PNG is validated on the current Rust-owned texture/face.
#[tauri::command]
pub async fn rust_editor_preview_external_face_png(
    state: State<'_,EditorState>,expected_epoch:u64,expected_revision:u64,
    intent:ExternalFaceTextureIntent,
)->Result<Option<ExternalFaceTexturePreviewReceipt>,DesktopError>{
    material_candidate_previews::preview_external_face_png(state,expected_epoch,expected_revision,intent).await
}

/// Direct editor-user Apply. Preview data is untrusted: replay the exact
/// guarded Rust candidate and compare both source and candidate model SHA.
#[tauri::command(async)]
pub fn rust_editor_apply_external_face_png(
    state:State<'_,EditorState>,expected_epoch:u64,expected_revision:u64,
    intent:ExternalFaceTextureIntent,candidate_png_source:String,
    expected_source_sha256:String,expected_candidate_sha256:String,
)->Result<EditorSnapshot,DesktopError>{
    if intent.expected_revision!=expected_revision ||
       ![&expected_source_sha256,&expected_candidate_sha256].iter().all(|sha|
           sha.len()==64 && sha.bytes().all(|c|c.is_ascii_hexdigit())) {
        return Err(failure("EXTERNAL_TEXTURE_BINDING_INVALID",
            "The reviewed PNG has invalid model identity."));
    }
    detached_edit(&state.store,&state.pending_edit,
        expected_epoch,expected_revision,ProjectionReuse::default(),
        Some("The model changed after external PNG review."),
        move |session|{
            if session.canonical_sha256().map_err(model_failure)?!=expected_source_sha256{
                return Err(failure("EXTERNAL_TEXTURE_SOURCE_STALE",
                    "The original model no longer matches the preview."));
            }
            let mut candidate=session.clone();
            candidate.apply_external_face_texture(&intent,&candidate_png_source)
                .map_err(model_failure)?;
            if candidate.canonical_sha256().map_err(model_failure)?!=expected_candidate_sha256{
                return Err(failure("EXTERNAL_TEXTURE_CANDIDATE_STALE",
                    "The edited PNG does not match the reviewed candidate."));
            }
            *session=candidate;
            Ok(())
        })
}

/// Direct, explicit editor-user Apply of precisely the last previewed source
/// and candidate. Recomputes the protected Rust plan before committing.
/// This is NOT a guest Code Mode Apply and NOT independent artistic review.
#[tauri::command(async)]
pub fn rust_editor_apply_preview_semantic_material(
    state: State<'_,EditorState>, expected_epoch:u64,
    expected_revision:u64,intent:SemanticMaterialIntent,
    expected_source_sha256:String,expected_candidate_sha256:String,
) -> Result<EditorSnapshot,DesktopError> {
    if intent.expected_revision!=expected_revision ||
       expected_source_sha256.len()!=64 ||
       expected_candidate_sha256.len()!=64 ||
       !expected_source_sha256.bytes().all(|c|c.is_ascii_hexdigit()) ||
       !expected_candidate_sha256.bytes().all(|c|c.is_ascii_hexdigit()) {
        return Err(failure("SEMANTIC_PREVIEW_BINDING_INVALID",
            "Material preview has invalid revision or SHA binding."));
    }
    detached_edit(&state.store,&state.pending_edit,
        expected_epoch,expected_revision,ProjectionReuse::default(),
        Some("The model changed since the material preview."),
        move |session|apply_checked_semantic_candidate(
            session,&intent,&expected_source_sha256,&expected_candidate_sha256,
        ))
}

#[tauri::command(async)]
pub fn rust_editor_snapshot(state: State<'_, EditorState>) -> Result<Option<EditorSnapshot>, DesktopError> {
    Ok(project_detached(lock(&state)?, ProjectionReuse::default()))
}
/// Read only the selected valid source atlas if the aggregate eager snapshot
/// omitted it. All PNG/UV source rules still apply. Code Mode guest permissions
/// and native Paint/Undo are entirely unaffected by this presentation request.
#[tauri::command(async)]
pub fn rust_editor_read_texture_preview(
    state: State<'_, EditorState>, expected_epoch: u64,
    expected_revision: u64, texture_index: usize, texture_uuid: String,
    known_source_sha256: Option<String>,
) -> Result<SelectedTexturePreviewReceipt, DesktopError> {
    if known_source_sha256.as_deref().is_some_and(|key|
        key.len()!=64 || !key.bytes().all(|ch|ch.is_ascii_hexdigit())) {
        return Err(failure("SELECTED_PREVIEW_KEY_INVALID",
            "Selected preview source fingerprint is invalid."));
    }
    let frozen=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    let doc=frozen.document();
    if preview_uv_mode(doc)!=PreviewUvMode::ProjectAtlas {
        return Err(failure("SELECTED_PREVIEW_UV_MODE_UNSUPPORTED",
            "Selected atlas preview requires supported project UV."));
    }
    let texture=doc.texture_assets.get(texture_index).ok_or_else(||
        failure("SELECTED_PREVIEW_TEXTURE_NOT_FOUND","Selected texture is absent."))?;
    if texture.get("uuid").and_then(Value::as_str)!=Some(texture_uuid.as_str()) ||
       texture_uuid.is_empty(){
        return Err(failure("SELECTED_PREVIEW_IDENTITY_STALE",
            "Selected texture no longer matches the Rust source."));
    }
    let (source,width,height)=embedded_png_preview_candidate(texture).ok_or_else(||
        failure("SELECTED_PREVIEW_PNG_UNSUPPORTED",
            "Selected PNG is not an admitted embedded preview source."))?;
    let grid=project_atlas_preview_grid(doc,texture,width,height).ok_or_else(||
        failure("SELECTED_PREVIEW_UV_MISMATCH",
            "Selected atlas UV and PNG dimensions differ."))?;
    let source_digest=sha256(source.as_bytes());
    let reused=known_source_sha256.as_deref()==Some(source_digest.as_str());
    let receipt=SelectedTexturePreviewReceipt{
        epoch:expected_epoch,revision:expected_revision,
        texture_index,texture_uuid,
        texture_source:(!reused).then(||source.to_owned()),
        source_sha256:source_digest,source_reused:reused,
        texture_resolution:grid,source_authority:"RUST_VALIDATED_EMBEDDED_PNG",
        write_authority:"NOT_GRANTED",
        preview_scope:"SELECTED_PROJECT_ATLAS_ONLY",
    };
    let _fresh=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    Ok(receipt)
}


#[tauri::command(async)]
pub fn rust_editor_new(
    state: State<'_, EditorState>,
    name: String,
    expected_epoch: u64,
    discard: bool,
) -> Result<EditorSnapshot, DesktopError> {
    let identifier: String = name.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            ch.to_ascii_lowercase()
        } else { '_' })
        .collect();
    let identifier = identifier.trim_matches('_');
    let document = AuthoringDocument::new_bedrock(name.trim(), identifier)
        .map_err(model_failure)?;
    let session = EditorSession::from_document(document).map_err(model_failure)?;
    // New/Open must observe the same gate as Save/Export so the active model
    // cannot be replaced while an immutable revision is being published.
    let _lease = write_lease(&state.pending_edit)?;
    let mut store = lock(&state)?;
    check_epoch(&store, expected_epoch)?;
    check_discard(&store, discard)?;
    store.epoch += 1;
    store.active = Some(ActiveModel {
        session, source_path: None, source_sha: None,
        saved_canonical_sha: None, dirty: true,
    });
    current_detached(store, ProjectionReuse::default())
}

#[tauri::command]
pub async fn rust_editor_open(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    discard: bool,
) -> Result<Option<EditorSnapshot>, DesktopError> {
    {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        check_discard(&guard, discard)?;
    }
    let chosen = tauri::async_runtime::spawn_blocking(|| {
        FileDialog::new().add_filter("Blockbench model", &["bbmodel"]).pick_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "Model picker did not complete."))?;
    let Some(path) = chosen else { return Ok(None); };
    storage::bbmodel(&path).map_err(model_failure)?;
    let bytes = storage::read_bounded(&path, MAX_MODEL_BYTES).map_err(model_failure)?;
    let session = EditorSession::open(&bytes).map_err(model_failure)?;
    // Keep raw disk identity independent of canonical Rust model content.
    // The admitted session already owns a validated Rust document. Stream
    // canonical bytes into SHA-256 without allocating a second full .bbmodel
    // solely to establish the initial clean/dirty checkpoint.
    let canonical_sha = session.canonical_sha256().map_err(model_failure)?;
    let sha = sha256(&bytes);
    let _lease = write_lease(&state.pending_edit)?;
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    check_discard(&guard, discard)?;
    guard.epoch += 1;
    guard.active = Some(ActiveModel {
        session,
        source_path: Some(path),
        source_sha: Some(sha),
        saved_canonical_sha: Some(canonical_sha),
        dirty: false,
    });
    current_detached(guard, ProjectionReuse::default()).map(Some)
}

/// Read exactly one current, source-bound face-local RGBA8 texel in Rust.
#[tauri::command(async)]
pub fn rust_editor_sample_surface_color(
    state:State<'_,EditorState>,expected_epoch:u64,
    expected_revision:u64,request:SurfacePaintSampleRequest,
)->Result<SurfaceSourceSample,DesktopError>{
    if request.expected_revision!=expected_revision{
        return Err(failure("SURFACE_SAMPLE_REVISION_STALE",
            "The sampled face has changed since selection."));
    }
    let source=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    let sample=source.sample_surface_source(&request).map_err(model_failure)?;
    let _fresh=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    Ok(sample)
}

/// A source-revision-bound Magic Wand selection; only a read-only atlas
/// row-span preview is returned. The seed is recomputed on every later Apply.
#[tauri::command(async)]
pub fn rust_editor_select_surface_color(
    state:State<'_,EditorState>,expected_epoch:u64,
    expected_revision:u64,request:SurfaceSelectionRequest,
)->Result<SurfaceSelectionReceipt,DesktopError>{
    if request.source.expected_revision!=expected_revision{
        return Err(failure("SURFACE_SELECTION_REVISION_STALE",
            "The source selection belongs to another model revision."));
    }
    let source=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    let selection=source.select_surface_source(&request).map_err(model_failure)?;
    let _fresh=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    Ok(selection)
}

/// Artist-specified swatch ramp. A native exact-before pixel cohort changes
/// at most one shade step per pixel in one existing Rust Undo transaction.
#[tauri::command(async)]
pub fn rust_editor_shade_surface_stroke(
    state:State<'_,EditorState>,expected_epoch:u64,
    expected_revision:u64,intent:SurfaceShadeInkIntent,
)->Result<EditorSnapshot,DesktopError>{
    if intent.expected_revision!=expected_revision {
        return Err(failure("SHADE_INK_REVISION_STALE",
            "The shading gesture targets another source revision."));
    }
    detached_edit(&state.store,&state.pending_edit,
        expected_epoch,expected_revision,ProjectionReuse::default(),
        Some("The model changed during the shading gesture."),
        move |session|{
            session.shade_surface_stroke(&intent).map_err(model_failure)?;
            Ok(())
        })
}

/// One user gesture on one source-bound 3D Cube face. Selection, atlas UV,
/// original RGBA and identity masks are admitted again in the Rust engine;
/// the WebGL raycaster never receives authority to write atlas coordinates.
#[tauri::command(async)]
pub fn rust_editor_paint_surface_stroke(
    state:State<'_,EditorState>,expected_epoch:u64,
    expected_revision:u64,intent:SurfacePaintIntent,
)->Result<EditorSnapshot,DesktopError>{
    if intent.expected_revision!=expected_revision {
        return Err(failure("SURFACE_PAINT_REVISION_STALE",
            "The 3D paint gesture targets another revision."));
    }
    detached_edit(&state.store,&state.pending_edit,
        expected_epoch,expected_revision,ProjectionReuse::default(),
        Some("The model changed during the 3D paint gesture."),
        move |session|{
            session.apply_surface_paint_stroke(&intent).map_err(model_failure)?;
            Ok(())
        })
}

#[tauri::command(async)]
pub fn rust_editor_apply(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    operations: Vec<EditOperation>,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.apply(expected_revision, &operations).map_err(model_failure)?;
            Ok(())
        },
    )
}

/// Read a user-selected PNG entirely inside the native Rust host and
/// submit it through the exact same validated EditOperation as the CLI.
/// Canceled dialogs have no effect. Local paths and unvalidated bytes stay
/// native; admitted embedded image previews follow the existing bounded projection.
#[tauri::command]
pub async fn rust_editor_import_paint_png(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
) -> Result<Option<EditorSnapshot>, DesktopError> {
    {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before importing a PNG."));
        }
    }
    let selected = tauri::async_runtime::spawn_blocking(|| {
        FileDialog::new().add_filter("PNG texture", &["png"]).pick_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "PNG picker did not complete."))?;
    let Some(path) = selected else { return Ok(None); };
    storage::png(&path).map_err(model_failure)?;
    let filename = path.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| failure("PAINT_NAME_INVALID", "The PNG filename is not supported."))?
        .to_owned();
    // Bounded read protects both the Rust PNG decoder and the WebView preview.
    // The source path is not persisted to the Blockbench model.
    let bytes = storage::read_bounded(&path, MAX_IMPORT_PNG_BYTES).map_err(model_failure)?;
    let source = format!("data:image/png;base64,{}", STANDARD.encode(bytes));
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse::default(), None,
        move |session| {
            session.apply(expected_revision, &[EditOperation::ImportPaintTexture {
                uuid: create_uuid(), name: filename, source,
            }]).map_err(model_failure)?;
            Ok(())
        },
    ).map(Some)
}

/// Capture is explicitly initiated by the user, not by Code Mode guest
/// JavaScript. The renderer supplies PNG pixels; Rust owns current revision,
/// exact saved model SHA, output path selection and no-overwrite publishing.
#[tauri::command]
pub async fn rust_editor_export_review_capture(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    view_id: String, png_data_url: String,
) -> Result<Option<ReviewCaptureReceipt>, DesktopError> {
    if !["front","back","left","right","top","bottom"].contains(&view_id.as_str()) {
        return Err(failure("REVIEW_CAPTURE_VIEW_INVALID", "Select one of the six fixed camera views."));
    }
    let bytes = decode_review_capture_png(&png_data_url)?;
    let source = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "Model changed before review capture.",
    )?;
    let (source_path, source_sha) = review_capture_source(&source)?;
    let stem = source_path.file_stem().and_then(|s| s.to_str()).unwrap_or("model");
    let label: String = stem.chars().filter(|c|
        c.is_ascii_alphanumeric() || *c=='_' || *c=='-').take(48).collect();
    let filename = format!("{}-{view_id}.review.png",
        if label.is_empty() {"model"} else {&label});
    let pick_from = source_path.clone();
    let destination = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = FileDialog::new()
            .add_filter("Rust preview PNG", &["png"])
            .set_file_name(&filename);
        if let Some(folder) = pick_from.parent() {
            dialog = dialog.set_directory(folder);
        }
        dialog.save_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED",
        "Review PNG save dialog did not complete."))?;
    let Some(path) = destination else { return Ok(None); };
    storage::png(&path).map_err(model_failure)?;
    let _lease = write_lease(&state.pending_edit)?;
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "Model changed during review capture selection.",
    )?;
    let (still_source, still_sha) = review_capture_source(&frozen)?;
    if still_source != source_path || still_sha != source_sha {
        return Err(failure("REVIEW_CAPTURE_MODEL_STALE", "The selected saved model changed during capture."));
    }
    storage::same_directory(&source_path, &path).map_err(model_failure)?;
    storage::publish_new_png(&path, &bytes, MAX_EXPORT_PNG_BYTES).map_err(model_failure)?;
    Ok(Some(ReviewCaptureReceipt {
        source_model_sha256: source_sha,
        capture_png_sha256: sha256(&bytes),
        view_id, file_name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        byte_count: bytes.len(),
        preview_scope: "RUST_THREEJS_PREVIEW_NOT_BEDROCK_VERIFIED",
    }))
}

/// A read-only PNG export, selected by stable UUID and Rust revision.
/// Only native Rust knows the local path and publishes the file.
#[tauri::command]
pub async fn rust_editor_export_paint_png(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    texture_uuid: String,
) -> Result<Option<PaintPngExportReceipt>, DesktopError> {
    let (filename, source) = {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before exporting PNG."));
        }
        let doc = active.session.document();
        let index = doc.texture_assets.iter().position(|texture|
            texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str()))
            .ok_or_else(|| failure("PAINT_TEXTURE_NOT_FOUND", "Selected PNG texture is unavailable."))?;
        if !paint_texture_exportable(doc, index) {
            return Err(failure("PAINT_EXPORT_TEXTURE_UNSUPPORTED", "The selected texture cannot be exported as a single RGBA8 PNG."));
        }
        // Never use an untrusted imported asset filename as a native path.
        (format!("texture-{texture_uuid}.png"), active.source_path.clone())
    };
    let destination = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = FileDialog::new()
            .add_filter("PNG texture", &["png"])
            .set_file_name(&filename);
        if let Some(source) = source {
            if let Some(directory) = source.parent() {
                picker = picker.set_directory(directory);
            }
        }
        picker.save_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "PNG export dialog did not complete."))?;
    let Some(path) = destination else { return Ok(None); };
    storage::png(&path).map_err(model_failure)?;

    let _lease = write_lease(&state.pending_edit)?;
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "The model changed during PNG export selection.",
    )?;
    verify_publication_source(
        &frozen, &path, "The original model changed on disk; no PNG was exported.",
    )?;
    let bytes = export_paint_png(frozen.session.document(), &texture_uuid).map_err(model_failure)?;
    storage::publish_new_png(&path, &bytes, MAX_EXPORT_PNG_BYTES).map_err(model_failure)?;
    Ok(Some(PaintPngExportReceipt { sha256: sha256(&bytes), byte_count: bytes.len() }))
}

// Pinned Blockbench 5.2.1 Cube.init assigns the default texture UUID to
// newly created faces in a single-texture format. Preserve UUID-less legacy
// assets without synthesizing IDs or mutating imported texture data.
fn new_cube_faces(textures: &[Value]) -> Map<String, Value> {
    let texture = textures.first()
        .and_then(|asset| asset.get("uuid"))
        .and_then(Value::as_str)
        .map(|uuid| Value::String(uuid.to_owned()))
        .unwrap_or(Value::Bool(false));
    ["north", "east", "south", "west", "up", "down"].into_iter()
        .map(|name| (name.to_owned(), json!({
            "uv": [0.0, 0.0, 2.0, 2.0], "texture": texture
        })))
        .collect()
}

#[tauri::command(async)]
pub fn rust_editor_add_cube(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    parent_uuid: Option<String>,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        },
        Some("Refresh the model before adding a Cube."),
        move |session| {
            let mut operations = Vec::new();
            let parent = match parent_uuid {
                Some(id) => id,
                None => match session.document().bones.first() {
                    Some(bone) => bone.uuid.clone(),
                    None => {
                        let id = create_uuid();
                        operations.push(EditOperation::AddBone {
                            bone: Bone {
                                uuid: id.clone(), name: "root".into(),
                                origin: Some([0.0, 0.0, 0.0]), extra: Map::new(),
                            },
                            parent_uuid: None,
                        });
                        id
                    },
                },
            };
            let faces = new_cube_faces(&session.document().texture_assets);
            operations.push(EditOperation::AddCube {
                cube: Cube {
                    uuid: create_uuid(), kind: "cube".into(),
                    name: Some("cube".into()),
                    from: [-1.0, 0.0, -1.0], to: [1.0, 2.0, 1.0],
                    origin: Some([0.0, 0.0, 0.0]), uv_offset: None,
                    faces, extra: Map::new(),
                },
                bone_uuid: parent,
            });
            session.apply(expected_revision, &operations).map_err(model_failure)?;
            Ok(())
        },
    )
}



#[tauri::command(async)]
pub fn rust_editor_duplicate_cube(
    state: State<'_, EditorState>,
    expected_epoch: u64, expected_revision: u64, source_uuid: String,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.apply(expected_revision, &[EditOperation::DuplicateCube {
                source_uuid, new_uuid: create_uuid(),
            }]).map_err(model_failure)?;
            Ok(())
        },
    )
}

#[tauri::command(async)]
pub fn rust_editor_add_bone(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    parent_uuid: Option<String>,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        },
        Some("Refresh the model before adding a Bone."),
        move |session| {
            let origin = if let Some(ref id) = parent_uuid {
                session.document().bones.iter().find(|bone| bone.uuid == *id)
                    .ok_or_else(|| failure(
                        "BONE_PARENT_NOT_FOUND", "Select an existing parent Bone."))?
                    .origin.unwrap_or([0.0, 0.0, 0.0])
            } else { [0.0, 0.0, 0.0] };
            session.apply(expected_revision, &[EditOperation::AddBone {
                bone: Bone {
                    uuid: create_uuid(), name: "bone".into(),
                    origin: Some(origin), extra: Map::new(),
                },
                parent_uuid,
            }]).map_err(model_failure)?;
            Ok(())
        },
    )
}


#[tauri::command(async)]
pub fn rust_editor_create_animation(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    name: String, length: f64,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.apply(expected_revision, &[EditOperation::CreateAnimation {
                uuid: create_uuid(), name, length,
            }]).map_err(model_failure)?;
            Ok(())
        },
    )
}

#[tauri::command(async)]
pub fn rust_editor_add_rotation_keyframe(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    animation_uuid: String, bone_uuid: String, time: f64, rotation: [f64; 3],
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.apply(expected_revision, &[EditOperation::AddBoneRotationKeyframe {
                animation_uuid, bone_uuid, keyframe_uuid: create_uuid(), time, rotation,
            }]).map_err(model_failure)?;
            Ok(())
        },
    )
}

#[tauri::command(async)]
pub fn rust_editor_undo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.undo(expected_revision).map_err(model_failure)?;
            Ok(())
        },
    )
}

#[tauri::command(async)]
pub fn rust_editor_redo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    known_preview_source_key: Option<String>,
    known_geometry_source_key: Option<String>,
    known_animation_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    detached_edit(
        &state.store, &state.pending_edit, expected_epoch, expected_revision,
        ProjectionReuse {
            preview: known_preview_source_key.as_deref(),
            geometry: known_geometry_source_key.as_deref(),
            animation: known_animation_source_key.as_deref(),
        }, None,
        move |session| {
            session.redo(expected_revision).map_err(model_failure)?;
            Ok(())
        },
    )
}

/// Export a separate Minecraft Bedrock Geometry JSON without modifying the
/// editable .bbmodel session, revision, Undo history or source file.
#[tauri::command]
pub async fn rust_editor_export_bedrock_geometry(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
) -> Result<Option<GeometryExportReceipt>, DesktopError> {
    bedrock_resource_exports::export_geometry_resource(state,expected_epoch,expected_revision).await
}


/// Export a separate Bedrock animations resource through the same Rust
/// document authority as the .bbmodel, CLI and trusted Code Mode.
/// This never rewrites imported curves, source assets or Undo history.
#[tauri::command]
pub async fn rust_editor_export_bedrock_animations(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
) -> Result<Option<AnimationExportReceipt>, DesktopError> {
    bedrock_resource_exports::export_animation_resource(state,expected_epoch,expected_revision).await
}

#[tauri::command]
pub async fn rust_editor_save_copy(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
) -> Result<Option<EditorSnapshot>, DesktopError> {
    let (source, filename) = {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before saving."));
        }
        let name = active.session.document().extensions.get("name")
            .and_then(Value::as_str).unwrap_or("Model");
        let name: String = name.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .take(70).collect();
        (active.source_path.clone(), format!("{}.bbmodel", name.trim_matches('_')))
    };
    let destination = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = FileDialog::new()
            .add_filter("Blockbench model", &["bbmodel"])
            .set_file_name(&filename);
        if let Some(ref path) = source {
            if let Some(directory) = path.parent() {
                picker = picker.set_directory(directory);
            }
        }
        picker.save_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "Save dialog did not complete."))?;
    let Some(path) = destination else { return Ok(None); };

    // Keep the file-publishing lease through the short final checkpoint.
    // Snapshot readers can still acquire EditorStore while the disk is read,
    // the .bbmodel is encoded and the exclusive new file is published.
    let _lease = write_lease(&state.pending_edit)?;
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "Model changed while the Save Copy dialog was open.",
    )?;
    verify_publication_source(
        &frozen, &path, "The original model changed on disk; no copy was written.",
    )?;
    let bytes = frozen.session.export().map_err(model_failure)?;
    storage::publish_new(&path, &bytes, MAX_MODEL_BYTES).map_err(model_failure)?;
    let saved_hash = sha256(&bytes);
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut().ok_or_else(||
        failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "Model changed during Save Copy."));
    }
    active.source_sha = Some(saved_hash.clone());
    active.saved_canonical_sha = Some(saved_hash);
    active.source_path = Some(path);
    active.dirty = false;
    current_detached(guard, ProjectionReuse::default()).map(Some)
}

// A recovery picker can be open while a newer GUI edit is committed.
// Epoch protects model replacement; revision additionally protects changes
// made to the same model before the user chooses to discard them.
fn check_restore_revision(store: &EditorStore, expected_revision: u64)
    -> Result<(), DesktopError> {
    let actual = store.active.as_ref()
        .map(|model| model.session.summary().revision)
        .unwrap_or(0);
    if actual != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE",
            "The active model was edited while recovery was selected."));
    }
    Ok(())
}

// Trusted Tauri app-local data path; never take a recovery directory from
// model content, UI input, guest JavaScript, or the headless CLI.
fn recovery_directory(app: &tauri::AppHandle) -> Result<PathBuf, DesktopError> {
    app.path().app_local_data_dir()
        .map(|root| root.join("rust-recovery"))
        .map_err(|_| failure("RUST_RECOVERY_DIRECTORY_UNAVAILABLE",
            "The private recovery directory is unavailable."))
}

/// Immutable checkpoint of the exact requested Rust revision. It is NOT a
/// user Save and never sets dirty=false, changes source_path or rewrites an
/// original .bbmodel. App-side idle scheduling may call this read-only owner.
#[tauri::command]
pub async fn rust_editor_recovery_checkpoint(
    app: tauri::AppHandle,
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
) -> Result<editor_recovery::RecoveryCheckpointReceipt, DesktopError> {
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "Refresh before creating a recovery checkpoint.",
    )?;
    if !frozen.dirty {
        return Err(failure("RUST_RECOVERY_MODEL_CLEAN",
            "Recovery checkpoints are for unsaved edits only."));
    }
    let directory = recovery_directory(&app)?;
    let run_id = state.recovery_run_id.clone();
    tauri::async_runtime::spawn_blocking(move ||
        editor_recovery::checkpoint(
            &directory, &run_id, expected_epoch, &frozen.session,
        )
    ).await.map_err(|_| failure("RUST_RECOVERY_TASK_FAILED",
        "The recovery checkpoint operation did not complete."))?
     .map_err(|code| failure("RUST_RECOVERY_CHECKPOINT_FAILED", code))
}

/// Read-only discovery; filenames are potential candidates, not proof of
/// readable contents. Each chosen candidate is rehashed/revalidated by Rust.
#[tauri::command]
pub async fn rust_editor_recovery_list(
    app: tauri::AppHandle,
) -> Result<Vec<editor_recovery::RecoveryEntry>, DesktopError> {
    let directory = recovery_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move ||
        editor_recovery::list(&directory)
    ).await.map_err(|_| failure("RUST_RECOVERY_TASK_FAILED",
        "Recovery listing did not complete."))?
     .map_err(|code| failure("RUST_RECOVERY_LIST_FAILED", code))
}

/// Explicit user-initiated recovery opens the private snapshot as a *new
/// unsaved* editor session. It never restores its old source path, replaces
/// the user's original, or silently assumes the older Undo history.
#[tauri::command]
pub async fn rust_editor_recovery_restore(
    app: tauri::AppHandle,
    state: State<'_, EditorState>,
    id: String,
    expected_epoch: u64,
    expected_revision: u64,
    discard: bool,
) -> Result<EditorSnapshot, DesktopError> {
    {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        check_restore_revision(&guard, expected_revision)?;
        check_discard(&guard, discard)?;
    }
    let directory = recovery_directory(&app)?;
    let session = tauri::async_runtime::spawn_blocking(move ||
        editor_recovery::open(&directory, &id)
    ).await.map_err(|_| failure("RUST_RECOVERY_TASK_FAILED",
        "Recovery read did not complete."))?
     .map_err(|code| failure("RUST_RECOVERY_MODEL_REJECTED", code))?;
    let _lease = write_lease(&state.pending_edit)?;
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    check_restore_revision(&guard, expected_revision)?;
    check_discard(&guard, discard)?;
    guard.epoch += 1;
    guard.active = Some(ActiveModel {
        session, source_path: None, source_sha: None,
        saved_canonical_sha: None, dirty: true,
    });
    current_detached(guard, ProjectionReuse::default())
}

#[cfg(test)]
mod tests;
