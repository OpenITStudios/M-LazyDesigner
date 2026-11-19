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

// Read the same admitted numeric JSON vector directly; avoid allocating a
// temporary Value and deserializing every Cube/Bone on every GUI snapshot.
fn borrowed_vec3(value: &Value) -> Option<[f64; 3]> {
    let elements = value.as_array()?;
    if elements.len() != 3 { return None; }
    let vec = [
        elements[0].as_f64()?, elements[1].as_f64()?, elements[2].as_f64()?,
    ];
    vec.iter().all(|axis| axis.is_finite()).then_some(vec)
}

fn property_vec3(properties: &Map<String, Value>, key: &str) -> [f64; 3] {
    properties.get(key).and_then(borrowed_vec3).unwrap_or([0.0; 3])
}

// Only default texture materials can be approximated by this bounded renderer.
// Blockbench's additive, emissive and layered modes use different shaders.
fn texture_preview_side(texture: &Value) -> Option<&'static str> {
    if let Some(mode) = texture.get("render_mode") {
        if mode.as_str() != Some("default") { return None; }
    }
    match texture.get("render_sides") {
        None => Some("double"),
        Some(Value::String(side)) if side == "auto" || side == "double" => Some("double"),
        Some(Value::String(side)) if side == "front" => Some("front"),
        _ => None,
    }
}

// Never resolve project-relative paths or arbitrary URLs inside the WebView.
// Embedded PNG candidates remain subject to the browser's image decoder.
// A bounded WebView preview candidate. This never changes Rust-owned assets.
fn embedded_png_preview_candidate(texture: &Value) -> Option<(&str, u32, u32)> {
    const PREFIX: &str = "data:image/png;base64,";
    const MAX_BASE64: usize = 2 * 1024 * 1024;
    const MAX_DIMENSION: u32 = 2048;
    const MAX_PIXELS_PER_IMAGE: u64 = 4 * 1024 * 1024;
    texture_preview_side(texture)?;
    if texture.get("wrap_mode").and_then(Value::as_str).is_some_and(|mode| mode != "limited") {
        return None;
    }
    let source = texture.get("source")?.as_str()?;
    let encoded = source.strip_prefix(PREFIX)?;
    if encoded.len() < 44 || encoded.len() > MAX_BASE64 { return None; }
    // Only the 33-byte PNG header is inspected by this read-only preview
    // gate. However, the old full STANDARD.decode rejected malformed Base64
    // anywhere in the source, including after IHDR. Keep that strict gate by
    // consuming the ENTIRE stream through the pinned crate's DecoderReader,
    // without allocating a second decoded PNG Vec on every editor snapshot.
    let mut decoder = DecoderReader::new(encoded.as_bytes(), &STANDARD);
    let mut header = [0_u8; 33];
    decoder.read_exact(&mut header).ok()?;
    if header.get(0..8)? != b"\x89PNG\r\n\x1a\n" ||
        header.get(8..12)? != [0, 0, 0, 13] ||
        header.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(header.get(20..24)?.try_into().ok()?);
    // Bounded encoded length already limits decoded work. This small
    // scratch array validates all remaining Base64, including padding and
    // trailing bits; WebView retains responsibility for PNG CRC/decode.
    let mut scratch = [0_u8; 4096];
    loop {
        match decoder.read(&mut scratch) {
            Ok(0) => break,
            Ok(_) => {},
            Err(_) => return None,
        }
    }
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION ||
        pixels > MAX_PIXELS_PER_IMAGE {
        return None;
    }
    // The browser still checks full PNG integrity and rejects invalid decode.
    Some((source, width, height))
}

fn embedded_png_preview_source(texture: &Value) -> Option<String> {
    embedded_png_preview_candidate(texture).map(|(source, _, _)| source.to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreviewUvMode {
    ProjectAtlas,
    ScopedAttachable,
    Unsupported,
}

/// Pinned Blockbench 5.2.1 enables per-texture UV when an active multi-file
/// ruleset is selected. Only bedrock_attachable has a reviewed scope resolver.
/// Unknown rulesets and conflicting optional flags remain read-only fallback.
fn preview_uv_mode(doc: &AuthoringDocument) -> PreviewUvMode {
    let attachable = doc.extensions.get("multi_file_ruleset")
        .and_then(Value::as_str) == Some("bedrock_attachable");
    if attachable {
        let flags_are_consistent = [
            doc.meta.extra.get("per_texture_uv_size"),
            doc.extensions.get("per_texture_uv_size"),
        ].into_iter().all(|flag| flag.is_none_or(|value| value == &Value::Bool(true)));
        if flags_are_consistent {
            return PreviewUvMode::ScopedAttachable;
        }
    }
    if has_per_texture_uv_rules(doc) { PreviewUvMode::Unsupported }
    else { PreviewUvMode::ProjectAtlas }
}

fn preview_uv_axis(texture: &Value, name: &str, project_default: u32) -> Option<u32> {
    let value = match texture.get(name) {
        None => project_default,
        Some(value) => u32::try_from(value.as_u64()?).ok()?,
    };
    (1..=4096).contains(&value).then_some(value)
}

/// Each admitted source carries its actual UV grid separately from PNG pixel
/// dimensions. The latter only controls decoding and GPU memory budgets.
#[cfg(test)]
fn texture_preview_assets(doc: &AuthoringDocument) -> Vec<Option<(&str, [u32; 2])>> {
    texture_preview_assets_in_mode(doc, preview_uv_mode(doc))
}

fn texture_preview_assets_in_mode(
    doc: &AuthoringDocument, mode: PreviewUvMode,
) -> Vec<Option<(&str, [u32; 2])>> {
    const MAX_PROJECTED_PIXELS: u64 = 4 * 1024 * 1024;
    let mut remaining_source_bytes = 4 * 1024 * 1024;
    let mut remaining_pixels = MAX_PROJECTED_PIXELS;
    let mut admitted = 0usize;
    doc.texture_assets.iter().map(|texture| {
        if mode == PreviewUvMode::Unsupported || admitted >= MAX_PAINT_TEXTURES {
            return None;
        }
        let (source, width, height) = embedded_png_preview_candidate(texture)?;
        let uv_grid = match mode {
            PreviewUvMode::ProjectAtlas => {
                // Preserve the previous one-atlas preview admission rule.
                if width != doc.resolution.width || height != doc.resolution.height ||
                   texture.get("uv_width").is_some_and(|value|
                       value.as_u64() != Some(u64::from(doc.resolution.width))) ||
                   texture.get("uv_height").is_some_and(|value|
                       value.as_u64() != Some(u64::from(doc.resolution.height))) {
                    return None;
                }
                [doc.resolution.width, doc.resolution.height]
            },
            PreviewUvMode::ScopedAttachable => {
                // No external precedence, implicit layers or animation may
                // be interpreted as a single embedded scoped PNG.
                if texture.get("path").is_some() ||
                   texture.get("relative_path").is_some() ||
                   texture.get("layers_enabled").is_some_and(|v| v != &Value::Bool(false)) ||
                   texture.get("layers").is_some_and(|v|
                       v.as_array().is_none_or(|layers| !layers.is_empty())) {
                    return None;
                }
                [
                    preview_uv_axis(texture, "uv_width", doc.resolution.width)?,
                    preview_uv_axis(texture, "uv_height", doc.resolution.height)?,
                ]
            },
            PreviewUvMode::Unsupported => return None,
        };
        // Pinned Texture.frameCount derives flipbooks from the image/UV
        // aspect-ratio mismatch. This renderer has no frame extraction.
        // Equivalent scaled atlases remain safe (e.g. 16x8 pixels, 64x32 UV).
        if mode == PreviewUvMode::ScopedAttachable &&
           u64::from(width) * u64::from(uv_grid[1]) !=
               u64::from(height) * u64::from(uv_grid[0]) {
            return None;
        }
        let pixels = u64::from(width) * u64::from(height);
        if source.len() > remaining_source_bytes || pixels > remaining_pixels { return None; }
        remaining_source_bytes -= source.len();
        remaining_pixels -= pixels;
        admitted += 1;
        Some((source, uv_grid))
    }).collect()
}

// Every Cube in a Bedrock attachable can reference one texture scope. Build
// the source-only index once per immutable editor snapshot instead of scanning
// the entire texture array again for every Cube. Duplicate scope -> None.
fn texture_scope_indices(doc: &AuthoringDocument) -> HashMap<u64, Option<usize>> {
    let mut by_scope: HashMap<u64, Option<usize>> = HashMap::new();
    for (index, texture) in doc.texture_assets.iter().enumerate() {
        let Some(scope) = texture.get("scope").and_then(Value::as_u64)
            .filter(|scope| *scope > 0) else { continue };
        by_scope.entry(scope).and_modify(|entry| *entry = None)
            .or_insert(Some(index));
    }
    by_scope
}

fn scoped_cube_texture_index(
    by_scope: Option<&HashMap<u64, Option<usize>>>, cube: &Cube,
    assets: &[Option<(&str, [u32; 2])>], mode: PreviewUvMode,
) -> Option<usize> {
    if mode != PreviewUvMode::ScopedAttachable { return None; }
    // Only a unique, positive saved Cube/Texture scope admits its PNG.
    // Missing, duplicate or unsupported preview candidates remain unbound.
    let scope = cube.extra.get("scope")?.as_u64().filter(|scope| *scope > 0)?;
    let index = by_scope?.get(&scope).copied().flatten()?;
    assets.get(index)?.as_ref()?;
    Some(index)
}

#[cfg(test)]
fn texture_preview_sources(doc: &AuthoringDocument) -> Vec<Option<String>> {
    texture_preview_assets(doc).into_iter()
        .map(|entry| entry.map(|(source, _)| source.to_owned())).collect()
}

// Parse only numeric or simple finite Molang constants. Imported expression
// tracks remain in the Rust document untouched and are not faked in the UI.
fn static_animation_axis(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::String(text) => text.parse::<f64>().ok()?,
        Value::Number(value) => value.as_f64()?,
        _ => return None,
    };
    number.is_finite().then_some(number)
}

// The pinned Tauri numeric preview refuses keyframes at the same Bone/
// channel whose timestamps are within 1e-6 seconds. Group finite times
// into adjacent microsecond buckets, then compare original floating values
// exactly as before. A temporary per-clip index avoids scanning all prior
// frame projections for each new source keyframe.
fn register_preview_time<'a>(
    seen: &mut HashMap<(&'a str, &'a str, u64), Vec<f64>>,
    bone_uuid: &'a str, channel: &'a str, time: f64,
) -> bool {
    let bucket = (time * 1_000_000.0).floor() as u64;
    // Include one adjacent quantization bucket on either side and a spare
    // for floating-point boundary rounding; exact comparison remains the
    // authoritative rejection rule, not the bucket index.
    for nearby in bucket.saturating_sub(2)..=bucket.saturating_add(2) {
        if seen.get(&(bone_uuid, channel, nearby)).is_some_and(|times|
            times.iter().any(|previous| (*previous - time).abs() <= 1e-6)) {
            return false;
        }
    }
    seen.entry((bone_uuid, channel, bucket)).or_default().push(time);
    true
}

// Source-only UUID/name lookup shared across this immutable Tauri projection.
// Preserve the previous first-match behavior if an unvalidated caller supplies
// duplicate Bone UUIDs; normal Rust authoring validation rejects duplicates.
fn indexed_bone_names(doc: &AuthoringDocument) -> HashMap<&str, &str> {
    let mut names = HashMap::new();
    for bone in &doc.bones {
        names.entry(bone.uuid.as_str()).or_insert(bone.name.as_str());
    }
    names
}

fn animation_views(doc: &AuthoringDocument) -> Vec<AnimationView> {
    let bone_names = indexed_bone_names(doc);
    // Imported clips can share UUIDs. A model-visible clip must be identified
    // unambiguously; never pick the first identical UUID to edit or preview.
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for animation in &doc.animation_assets {
        if let Some(id) = animation.get("uuid").and_then(Value::as_str) {
            *counts.entry(id).or_insert(0) += 1;
        }
    }
    doc.animation_assets.iter().take(256).filter_map(|animation| {
        let uuid = animation.get("uuid")?.as_str()?.to_owned();
        let name = animation.get("name").and_then(Value::as_str)
            .unwrap_or("Unnamed Animation").to_owned();
        let length = animation.get("length")?.as_f64()
            .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))?;
        // Only the three pinned Blockbench v5.2.1 playback policies are
        // projected. Malformed imported fields have an unsupported marker,
        // never a silently assumed once mode.
        let loop_mode = match animation.get("loop") {
            None => Some("once"),
            Some(Value::String(mode)) if
                matches!(mode.as_str(), "once" | "loop" | "hold") =>
                    Some(mode.as_str()),
            _ => None,
        };
        let saved_markers = saved_timeline_markers(animation);
        let mut preview_supported = counts.get(uuid.as_str()) == Some(&1) &&
            saved_markers.is_some() && valid_saved_markers(animation,length) &&
            !uuid.is_empty() && uuid.len() <= 128 &&
            !uuid.chars().any(|ch| ch.is_control() || ch.is_whitespace()) &&
            animation.as_object().is_some_and(|map|
                map.keys().all(|key| matches!(key.as_str(),
                    "uuid" | "name" | "loop" | "length" | "animators"))) &&
            loop_mode.is_some_and(|mode| mode == "once" || length > 0.0);
        let mut rotation_keyframes = Vec::new();
        let mut transform_keyframes: Vec<TransformKeyframeView> = Vec::new();
        let mut keyframe_ids = HashSet::new();
        let mut seen_times: HashMap<(&str, &str, u64), Vec<f64>> = HashMap::new();
        if let Some(animators) = animation.get("animators").and_then(Value::as_object) {
            for (bone_uuid, track) in animators {
                let bone_name = bone_names.get(bone_uuid.as_str()).copied();
                if bone_name.is_none() ||
                   !track.as_object().is_some_and(|map| map.keys().all(|key|
                        matches!(key.as_str(), "name" | "type" | "keyframes"))) ||
                   track.get("type").and_then(Value::as_str) != Some("bone") ||
                   track.get("name").is_some_and(|label| label.as_str() != bone_name) {
                    preview_supported = false;
                    continue;
                }
                let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                    preview_supported = false;
                    continue;
                };
                if frames.len() > 2048 { preview_supported = false; }
                for frame in frames.iter().take(2048) {
                    let Some(channel) = frame.get("channel").and_then(Value::as_str)
                        .filter(|c| matches!(*c, "rotation" | "position" | "scale")) else {
                        preview_supported = false; continue;
                    };
                    let Some(interpolation) = frame.get("interpolation")
                        .and_then(Value::as_str)
                        .filter(|mode| matches!(*mode, "linear" | "step" | "catmullrom" | "bezier")) else {
                        preview_supported = false; continue;
                    };
                    if !frame.as_object().is_some_and(|map| map.keys().all(|key|
                        matches!(key.as_str(),
                            "uuid" | "channel" | "time" | "interpolation" | "data_points" |
                            "bezier_linked" | "bezier_left_time" |
                            "bezier_left_value" | "bezier_right_time" |
                            "bezier_right_value"))) {
                        preview_supported = false; continue;
                    }
                    let bezier = if interpolation == "bezier" {
                        let Some(saved) = parse_saved_bezier_handles(frame) else {
                            preview_supported = false; continue;
                        };
                        Some(saved)
                    } else {
                        if ["bezier_linked", "bezier_left_time", "bezier_left_value",
                            "bezier_right_time", "bezier_right_value"]
                            .iter().any(|key| frame.get(*key).is_some()) {
                            preview_supported = false; continue;
                        }
                        None
                    };
                    let Some(id) = frame.get("uuid").and_then(Value::as_str)
                        .filter(|value| !value.is_empty() && value.len() <= 128 &&
                            !value.chars().any(|character|
                                character.is_control() || character.is_whitespace())) else {
                        preview_supported = false; continue;
                    };
                    if !keyframe_ids.insert(id.to_owned()) {
                        preview_supported = false; continue;
                    }
                    let Some(time) = frame.get("time").and_then(Value::as_f64)
                        .filter(|t| t.is_finite() && *t >= 0.0 && *t <= length) else {
                        preview_supported = false; continue;
                    };
                    let Some(points) = frame.get("data_points").and_then(Value::as_array) else {
                        preview_supported = false; continue;
                    };
                    if points.len() != 1 ||
                       !points[0].as_object().is_some_and(|map|
                           map.keys().all(|key| matches!(key.as_str(), "x" | "y" | "z"))) {
                        preview_supported = false; continue;
                    }
                    let [Some(x), Some(y), Some(z)] = [
                        static_animation_axis(points[0].get("x")),
                        static_animation_axis(points[0].get("y")),
                        static_animation_axis(points[0].get("z")),
                    ] else {
                        preview_supported = false; continue;
                    };
                    let value = [x, y, z];
                    if value.iter().any(|axis| axis.abs() > 100_000.0) ||
                       (channel == "scale" && value.iter().any(|axis|
                           *axis < 0.0 || *axis > 100.0)) {
                        preview_supported = false; continue;
                    }
                    if transform_keyframes.len() >= 2048 ||
                       !register_preview_time(&mut seen_times,
                           bone_uuid.as_str(), channel, time) {
                        preview_supported = false; continue;
                    }
                    transform_keyframes.push(TransformKeyframeView {
                        uuid: id.to_owned(), bone_uuid: bone_uuid.clone(),
                        channel: channel.to_owned(), time, value,
                        interpolation: interpolation.to_owned(), bezier,
                    });
                    if channel == "rotation" {
                        rotation_keyframes.push(RotationKeyframeView {
                            uuid: id.to_owned(), bone_uuid: bone_uuid.clone(),
                            time, rotation: value,
                        });
                    }
                }
                if !valid_track_segments(frames) { preview_supported = false; }
            }
        } else { preview_supported = false; }
        // An unsupported imported clip must not provide a *partial* set of
        // selectable/editable keyframes.
        if !preview_supported {
            rotation_keyframes.clear();
            transform_keyframes.clear();
        }
        Some(AnimationView {
            uuid, name, length,
            loop_mode:loop_mode.unwrap_or("unsupported").to_owned(),
            rotation_keyframes, transform_keyframes,
            markers:if preview_supported {saved_markers.unwrap_or_default()}
                else {Vec::new()},
            preview_supported,
        })
    }).collect()
}

fn preview_source_key(epoch: u64, assets: &[Option<(&str, [u32; 2])>]) -> String {
    let mut digest = Sha256::new();
    digest.update(epoch.to_le_bytes());
    digest.update((assets.len() as u64).to_le_bytes());
    for asset in assets {
        match asset {
            None => digest.update([0u8]),
            Some((source, resolution)) => {
                digest.update([1u8]);
                digest.update((source.len() as u64).to_le_bytes());
                digest.update(source.as_bytes());
                digest.update(resolution[0].to_le_bytes());
                digest.update(resolution[1].to_le_bytes());
            }
        }
    }
    format!("{:x}", digest.finalize())
}

#[derive(Default, Clone, Copy)]
struct ProjectionReuse<'a> {
    preview: Option<&'a str>,
    geometry: Option<&'a str>,
    animation: Option<&'a str>,
}

// Serialize the exact read-only GUI projection into SHA-256 without another
// large JSON byte buffer. An unhashable projection is always sent in full.
struct ProjectionHashWriter<'a>(&'a mut Sha256);
impl Write for ProjectionHashWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}
fn projection_source_key<T: Serialize>(epoch: u64, family: &[u8], item: &T) -> String {
    let mut hash = Sha256::new();
    hash.update(epoch.to_le_bytes());
    hash.update(family);
    if serde_json::to_writer(ProjectionHashWriter(&mut hash), item).is_err() {
        return String::new();
    }
    format!("{:x}", hash.finalize())
}

fn freeze_projection(store: &EditorStore) -> Option<FrozenEditorProjection> {
    store.active.as_ref().map(|model| FrozenEditorProjection {
        document: model.session.snapshot_document(),
        epoch: store.epoch,
        revision: model.session.summary().revision,
        source_name: model.source_path.as_ref()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().into_owned()),
        dirty: model.dirty,
        can_undo: model.session.can_undo(),
        can_redo: model.session.can_redo(),
    })
}

fn project_frozen(
    model: &FrozenEditorProjection, reuse: ProjectionReuse<'_>,
) -> EditorSnapshot {
        let doc = model.document.as_ref();
        let default_box_uv = doc.meta.box_uv.unwrap_or(false);
        let uv_mode = preview_uv_mode(doc);
        let preview_assets = texture_preview_assets_in_mode(doc, uv_mode);
        let preview_source_key = preview_source_key(model.epoch, &preview_assets);
        let preview_sources_reused = reuse.preview == Some(preview_source_key.as_str());
        let (paint_editable_textures, paint_adoptable_textures,
             paint_exportable_textures) = paint_texture_snapshot_flags(doc);
        let scope_indices = (uv_mode == PreviewUvMode::ScopedAttachable)
            .then(|| texture_scope_indices(doc));
        let mut snapshot = EditorSnapshot {
            epoch: model.epoch,
            revision: model.revision,
            name: doc.extensions.get("name").and_then(Value::as_str)
                .unwrap_or("Untitled Model").to_owned(),
            source_name: model.source_name.clone(),
            dirty: model.dirty,
            can_undo: model.can_undo,
            can_redo: model.can_redo,
            cubes: doc.cubes.iter().map(|cube| CubeView {
                uuid: cube.uuid.clone(),
                name: cube.name.clone().unwrap_or_else(|| "cube".into()),
                from: cube.from,
                to: cube.to,
                origin: cube.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&cube.extra, "rotation"),
                inflate: cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0),
                stretch: cube.extra.get("stretch")
                    .and_then(borrowed_vec3).unwrap_or([1.0; 3]),
                visible: cube.extra.get("visibility").and_then(Value::as_bool).unwrap_or(true),
                // Blockbench's Cube preview controller maps behind/default/front to -1/0/1.
                render_order: match cube.extra.get("render_order").and_then(Value::as_str) {
                    Some("behind") => -1,
                    Some("in_front") => 1,
                    _ => 0,
                },
                box_uv: cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(default_box_uv),
                uv_offset: cube.uv_offset.unwrap_or([0.0, 0.0]),
                // Validated as 0/1/2 by the single Rust authoring engine.
                auto_uv: cube.extra.get("autouv").and_then(Value::as_f64).unwrap_or(0.0) as u8,
                color: cube.extra.get("color").and_then(Value::as_u64).unwrap_or(0) as usize,
                faces: cube.faces.clone(),
                preview_texture_index: scoped_cube_texture_index(
                    scope_indices.as_ref(), cube, &preview_assets, uv_mode),
            }).collect(),
            bones: doc.bones.iter().map(|bone| BoneView {
                uuid: bone.uuid.clone(),
                name: bone.name.clone(),
                origin: bone.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&bone.extra, "rotation"),
                visible: bone.extra.get("visibility").and_then(Value::as_bool).unwrap_or(true),
            }).collect(),
            // Do not allocate the Outliner until the geometry reuse key is known.
            hierarchy: Vec::new(),
            geometry_source_key: String::new(),
            geometry_reused: false,
            texture_names: doc.texture_assets.iter().map(|texture| {
                texture.get("name").and_then(Value::as_str).unwrap_or("Unnamed texture").to_owned()
            }).collect(),
            texture_uuids: doc.texture_assets.iter().map(|texture|
                texture.get("uuid").and_then(Value::as_str).map(str::to_owned)
            ).collect(),
            texture_preview_sources: if preview_sources_reused { Vec::new() } else {
                preview_assets.iter().map(|asset|
                    asset.as_ref().map(|(source, _)| (*source).to_owned())).collect()
            },
            preview_source_key,
            preview_sources_reused,
            texture_preview_sides: doc.texture_assets.iter().map(texture_preview_side).collect(),
            texture_preview_resolutions: preview_assets.iter().map(|asset|
                asset.as_ref().map(|(_, resolution)| *resolution)).collect(),
            scoped_texture_preview: uv_mode == PreviewUvMode::ScopedAttachable,
            paint_editable_textures,
            paint_adoptable_textures,
            paint_exportable_textures,
            texture_resolution: [doc.resolution.width, doc.resolution.height],
            atlas_resolution_editable: can_set_empty_atlas_resolution(doc),
            paint_texture_addable: can_add_paint_texture(doc),
            animation_count: doc.animation_assets.len(),
            animations: animation_views(doc),
            animation_source_key: String::new(),
            animations_reused: false,
            preview_scope: "UNVERIFIED_EMBEDDED_PNG_SUBSET",
        };
        // These keys include all derived geometry/UV/scope and animation
        // data actually delivered to the WebView, not change hints.
        let geometry = projection_source_key(model.epoch, b"geometry",
            &(&snapshot.cubes, &snapshot.bones, doc.hierarchy.as_ref()));
        let animation = projection_source_key(model.epoch, b"animation",
            &(snapshot.animation_count, &snapshot.animations));
        snapshot.geometry_reused = !geometry.is_empty() &&
            reuse.geometry == Some(geometry.as_str());
        snapshot.animations_reused = !animation.is_empty() &&
            reuse.animation == Some(animation.as_str());
        snapshot.geometry_source_key = geometry;
        snapshot.animation_source_key = animation;
        if snapshot.geometry_reused {
            snapshot.cubes.clear();
            snapshot.bones.clear();
        } else {
            // Exact same serialized key as the previous wire projection, but
            // avoid cloning a potentially deep Outliner for omitted IPC data.
            snapshot.hierarchy = doc.hierarchy.as_ref().clone();
        }
        if snapshot.animations_reused { snapshot.animations.clear(); }
        snapshot
}

fn project_with_preview_reuse(
    store: &EditorStore, known_preview_source_key: Option<&str>,
) -> Option<EditorSnapshot> {
    let frozen = freeze_projection(store)?;
    Some(project_frozen(&frozen, ProjectionReuse {
        preview: known_preview_source_key, ..ProjectionReuse::default()
    }))
}

#[cfg(test)]
fn project(store: &EditorStore) -> Option<EditorSnapshot> {
    project_with_preview_reuse(store, None)
}

// Reads remain revision-consistent without retaining EditorStore's mutex
// while decoding/scanning embedded PNGs or projecting all geometry/animation.
fn project_detached(
    guard: MutexGuard<'_, EditorStore>, reuse: ProjectionReuse<'_>,
) -> Option<EditorSnapshot> {
    let frozen = freeze_projection(&guard);
    drop(guard);
    frozen.as_ref().map(|source| project_frozen(source, reuse))
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
    let _session = frozen_read_session(&state.store, expected_epoch, expected_revision)?;
    let selected = tauri::async_runtime::spawn_blocking(|| {
        FileDialog::new().add_filter("Material reference PNG", &["png"]).pick_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED",
        "Reference image picker did not complete."))?;
    let Some(path)=selected else{return Ok(None)};
    storage::png(&path).map_err(model_failure)?;
    let bytes=storage::read_bounded(&path,MAX_IMPORT_PNG_BYTES).map_err(model_failure)?;
    // Validate real PNG pixels, not an extension or caller-supplied digest.
    let mut decoder=png::Decoder::new(std::io::Cursor::new(bytes.as_slice()));
    decoder.set_transformations(png::Transformations::IDENTITY);
    let mut reader=decoder.read_info().map_err(|_| failure(
        "SEMANTIC_REFERENCE_PNG_INVALID","Could not read selected PNG."))?;
    let info=reader.info();
    if info.width==0 || info.height==0 || info.width>2048 || info.height>2048 ||
       u64::from(info.width)*u64::from(info.height)>2_097_152 ||
       reader.output_buffer_size()>8*1024*1024 {
        return Err(failure("SEMANTIC_REFERENCE_PNG_UNSUPPORTED",
            "Reference PNG exceeds the permitted dimensions."));
    }
    let mut image=vec![0u8;reader.output_buffer_size()];
    reader.next_frame(&mut image).map_err(|_| failure(
        "SEMANTIC_REFERENCE_PNG_INVALID","Selected PNG pixels are invalid."))?;
    // A source model change during the picker invalidates this reference binding.
    let _ = frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    Ok(Some(SemanticMaterialReferenceReceipt{
        png_sha256:sha256(&bytes),byte_count:bytes.len(),
        reference_png_source:format!("data:image/png;base64,{}",STANDARD.encode(&bytes)),
        reference_authority:"USER_SELECTED_NOT_ARTISTICALLY_VERIFIED",
    }))
}

fn preview_semantic_candidate(
    source:&EditorSession, intent:&SemanticMaterialIntent,
) -> Result<(SemanticMaterialProposal,EditorSession),DesktopError> {
    let proposal=source.plan_semantic_material(intent).map_err(model_failure)?;
    let mut candidate=source.clone();
    candidate.apply_with_correction_scope(
        intent.expected_revision,&proposal.plan.operations,
        proposal.plan.correction_scope.as_ref(),
    ).map_err(model_failure)?;
    let candidate_sha=candidate.canonical_sha256().map_err(model_failure)?;
    if proposal.preflight["candidate_sha256"].as_str()!=Some(candidate_sha.as_str()) ||
       proposal.preflight["visual_verdict"]!="UNVERIFIED" ||
       proposal.preflight["write_authority"]!="NOT_GRANTED" {
        return Err(failure("SEMANTIC_PREVIEW_NATIVE_MISMATCH",
            "The provisional candidate did not match the Rust dry-run."));
    }
    Ok((proposal,candidate))
}

/// Generate a candidate from an immutable in-memory Rust source. The
/// published EditorStore, Undo and original .bbmodel are never touched.
#[tauri::command(async)]
pub fn rust_editor_preview_semantic_material(
    state: State<'_, EditorState>, expected_epoch:u64,
    expected_revision:u64, intent:SemanticMaterialIntent,
) -> Result<SemanticMaterialPreviewReceipt,DesktopError> {
    if intent.expected_revision!=expected_revision {
        return Err(failure("SEMANTIC_PREVIEW_REVISION_MISMATCH",
            "Material intent targets another document revision."));
    }
    let source=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    let source_sha=source.canonical_sha256().map_err(model_failure)?;
    let (proposal,candidate)=preview_semantic_candidate(&source,&intent)?;
    let candidate_sha=candidate.canonical_sha256().map_err(model_failure)?;
    let mut matches=candidate.document().texture_assets.iter().enumerate()
        .filter(|(_,item)|item.get("uuid").and_then(Value::as_str)==
            Some(intent.texture_uuid.as_str()));
    let (texture_index,texture)=matches.next().ok_or_else(|| failure(
        "SEMANTIC_PREVIEW_TEXTURE_UNKNOWN","Candidate texture is unavailable."))?;
    if matches.next().is_some() {
        return Err(failure("SEMANTIC_PREVIEW_TEXTURE_AMBIGUOUS",
            "Candidate texture cannot be identified uniquely."));
    }
    let candidate_png_source=embedded_png_preview_source(texture)
        .ok_or_else(|| failure("SEMANTIC_PREVIEW_PNG_UNSUPPORTED",
            "The temporary material image cannot be previewed."))?;
    // The source can change while the COW candidate is prepared; refuse any
    // stale response rather than showing it as the current model.
    let fresh=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    if fresh.canonical_sha256().map_err(model_failure)?!=source_sha {
        return Err(failure("SEMANTIC_PREVIEW_SOURCE_STALE",
            "The model changed while generating the candidate."));
    }
    Ok(SemanticMaterialPreviewReceipt{
        epoch:expected_epoch,revision:expected_revision,
        source_model_sha256:source_sha,candidate_sha256:candidate_sha,
        reference_png_sha256:intent.reference_png_sha256,
        cube_uuid:intent.cube_uuid,texture_uuid:intent.texture_uuid,
        texture_index,candidate_png_source,
        material_evidence:proposal.material_evidence,
        preview_scope:"RUST_THREEJS_EPHEMERAL_CANDIDATE",
        visual_verdict:"UNVERIFIED",write_authority:"NOT_GRANTED",
    })
}

/// User-selected PNG is validated on the current Rust-owned texture/face.
#[tauri::command]
pub async fn rust_editor_preview_external_face_png(
    state: State<'_,EditorState>,expected_epoch:u64,expected_revision:u64,
    intent:ExternalFaceTextureIntent,
)->Result<Option<ExternalFaceTexturePreviewReceipt>,DesktopError>{
    if intent.expected_revision!=expected_revision {
        return Err(failure("EXTERNAL_TEXTURE_REVISION_STALE",
            "The external texture target is stale."));
    }
    let source=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    let source_sha=source.canonical_sha256().map_err(model_failure)?;
    let selected=tauri::async_runtime::spawn_blocking(||{
        FileDialog::new().add_filter("Edited RGBA PNG",&["png"]).pick_file()
    }).await.map_err(|_|failure("RUST_EDITOR_PICKER_FAILED",
        "External PNG picker did not complete."))?;
    let Some(path)=selected else {return Ok(None)};
    storage::png(&path).map_err(model_failure)?;
    let bytes=storage::read_bounded(&path,MAX_IMPORT_PNG_BYTES).map_err(model_failure)?;
    let candidate_input=format!("data:image/png;base64,{}",STANDARD.encode(&bytes));
    let mut candidate=source.clone();
    candidate.apply_external_face_texture(&intent,&candidate_input)
        .map_err(model_failure)?;
    let candidate_sha=candidate.canonical_sha256().map_err(model_failure)?;
    let matches:Vec<_>=candidate.document().texture_assets.iter().enumerate()
        .filter(|(_,t)|t.get("uuid").and_then(Value::as_str)==
            Some(intent.texture_uuid.as_str())).collect();
    let [(texture_index,texture)]=matches.as_slice() else {
        return Err(failure("EXTERNAL_TEXTURE_IDENTITY_INVALID",
            "The edited texture has ambiguous identity."));
    };
    let normalized=embedded_png_preview_source(texture)
        .ok_or_else(||failure("EXTERNAL_TEXTURE_PNG_UNSUPPORTED",
            "The validated PNG cannot be previewed."))?;
    let fresh=frozen_read_session(&state.store,expected_epoch,expected_revision)?;
    if fresh.canonical_sha256().map_err(model_failure)?!=source_sha{
        return Err(failure("EXTERNAL_TEXTURE_SOURCE_STALE",
            "The model changed while the PNG was selected."));
    }
    Ok(Some(ExternalFaceTexturePreviewReceipt{
        epoch:expected_epoch,revision:expected_revision,
        source_model_sha256:source_sha,candidate_sha256:candidate_sha,
        cube_uuid:intent.cube_uuid,texture_uuid:intent.texture_uuid,
        face:intent.face,texture_index:*texture_index,
        candidate_png_source:normalized,
        selected_png_sha256:sha256(&bytes),
        preview_scope:"RUST_THREEJS_EPHEMERAL_CANDIDATE",
        visual_verdict:"UNVERIFIED",write_authority:"NOT_GRANTED",
    }))
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

/// The same exact source/model/candidate contract applies to direct-user
/// commits as to the last ephemeral visual preview. Never partially mutate
/// even an intermediate EditorSession if the final candidate SHA diverges.
fn apply_checked_semantic_candidate(
    session:&mut EditorSession,
    intent:&SemanticMaterialIntent,
    expected_source_sha:&str,
    expected_candidate_sha:&str,
) -> Result<(),DesktopError> {
    if session.canonical_sha256().map_err(model_failure)?!=expected_source_sha {
        return Err(failure("SEMANTIC_PREVIEW_SOURCE_STALE",
            "The original model changed since the candidate preview."));
    }
    let proposal=session.plan_semantic_material(intent).map_err(model_failure)?;
    if proposal.preflight["candidate_sha256"].as_str()!=Some(expected_candidate_sha) {
        return Err(failure("SEMANTIC_PREVIEW_CANDIDATE_STALE",
            "Regenerate and inspect the current material preview."));
    }
    let mut candidate=session.clone();
    candidate.apply_with_correction_scope(
        intent.expected_revision,&proposal.plan.operations,
        proposal.plan.correction_scope.as_ref(),
    ).map_err(model_failure)?;
    if candidate.canonical_sha256().map_err(model_failure)?!=expected_candidate_sha {
        return Err(failure("SEMANTIC_PREVIEW_APPLY_MISMATCH",
            "The candidate changed during the protected Paint transaction."));
    }
    *session=candidate; // Publish only after all checksum/source guards pass.
    Ok(())
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

/// Verify a bounded encoded WebGL PNG. The browser canvas is a *preview*,
/// never a proof of native Minecraft fidelity or a writable model asset.
fn decode_review_capture_png(data_url: &str) -> Result<Vec<u8>, DesktopError> {
    let encoded = data_url.strip_prefix("data:image/png;base64,")
        .ok_or_else(|| failure("REVIEW_CAPTURE_FORMAT_INVALID", "Expected a PNG canvas capture."))?;
    if encoded.is_empty() || encoded.len() > 3 * 1024 * 1024 {
        return Err(failure("REVIEW_CAPTURE_SIZE_INVALID", "Captured PNG exceeds the review budget."));
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| failure(
        "REVIEW_CAPTURE_FORMAT_INVALID", "Captured PNG Base64 is not valid."))?;
    if bytes.is_empty() || bytes.len() > MAX_EXPORT_PNG_BYTES {
        return Err(failure("REVIEW_CAPTURE_SIZE_INVALID", "Captured PNG is too large."));
    }
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes.as_slice()));
    let mut reader = decoder.read_info().map_err(|_| failure(
        "REVIEW_CAPTURE_PNG_INVALID", "Captured PNG could not be decoded."))?;
    let info = reader.info();
    if !(32..=2048).contains(&info.width) || !(32..=2048).contains(&info.height) ||
       info.width.saturating_mul(info.height) > 2_097_152 ||
       info.bit_depth != png::BitDepth::Eight ||
       !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba) {
        return Err(failure("REVIEW_CAPTURE_PNG_UNSUPPORTED", "Capture PNG dimensions or color are unsupported."));
    }
    let mut image = vec![0u8; reader.output_buffer_size()];
    reader.next_frame(&mut image).map_err(|_| failure(
        "REVIEW_CAPTURE_PNG_INVALID", "Captured PNG pixel data is invalid."))?;
    Ok(bytes)
}

/// A review capture must match the exact saved on-disk model used by Code
/// Mode; an unsaved scene or imported noncanonical source cannot masquerade
/// as its saved .bbmodel. Save Copy creates that canonical source boundary.
fn review_capture_source(source: &FrozenPublication) -> Result<(PathBuf, String), DesktopError> {
    if source.dirty {
        return Err(failure("REVIEW_CAPTURE_MODEL_UNSAVED", "Save Copy before capturing review images."));
    }
    let path = source.source_path.as_ref().ok_or_else(|| failure(
        "REVIEW_CAPTURE_MODEL_UNSAVED", "This model has no saved .bbmodel source."))?;
    let disk_sha = source.source_sha.as_ref().ok_or_else(|| failure(
        "REVIEW_CAPTURE_SOURCE_UNKNOWN", "Saved .bbmodel identity is unavailable."))?;
    let canonical = source.session.canonical_sha256().map_err(model_failure)?;
    if canonical != *disk_sha || source.saved_canonical_sha.as_ref() != Some(&canonical) {
        return Err(failure("REVIEW_CAPTURE_CANONICAL_COPY_REQUIRED",
            "Save Copy to bind this preview to exact canonical .bbmodel bytes."));
    }
    let current = storage::read_bounded(path, MAX_MODEL_BYTES).map_err(model_failure)?;
    if sha256(&current) != canonical {
        return Err(failure("RUST_EDITOR_SOURCE_CHANGED",
            "Saved model changed on disk; review capture was refused."));
    }
    Ok((path.clone(), canonical))
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
    let (source_path, filename) = {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before exporting geometry."));
        }
        let raw_name = active.session.document().extensions.get("model_identifier")
            .and_then(Value::as_str).unwrap_or("model");
        let safe_name: String = raw_name.chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
            .take(64).collect();
        let safe_name = safe_name.trim_matches('.');
        let filename = format!("{}.geo.json", if safe_name.is_empty() { "model" } else { safe_name });
        (active.source_path.clone(), filename)
    };
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = FileDialog::new()
            .add_filter("Minecraft Bedrock Geometry JSON", &["json"])
            .set_file_name(&filename);
        if let Some(ref source) = source_path {
            if let Some(folder) = source.parent() {
                picker = picker.set_directory(folder);
            }
        }
        picker.save_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "Geometry export dialog did not complete."))?;
    let Some(path) = chosen else { return Ok(None); };
    storage::geometry_json(&path).map_err(model_failure)?;

    let _lease = write_lease(&state.pending_edit)?;
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "The model changed during geometry export selection.",
    )?;
    verify_publication_source(
        &frozen, &path, "The original model changed on disk; no geometry was exported.",
    )?;
    let bytes = export_bedrock_geometry(frozen.session.document()).map_err(model_failure)?;
    storage::publish_new_geometry(&path, &bytes, MAX_MODEL_BYTES).map_err(model_failure)?;
    Ok(Some(GeometryExportReceipt {
        sha256: sha256(&bytes), byte_count: bytes.len(),
    }))
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
    let (source_path, filename) = {
        let guard = lock(&state)?;
        check_epoch(&guard, expected_epoch)?;
        let active = guard.active.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
        if active.session.summary().revision != expected_revision {
            return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before exporting animations."));
        }
        let raw_name = active.session.document().extensions.get("model_identifier")
            .and_then(Value::as_str).unwrap_or("model");
        let safe_name: String = raw_name.chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
            .take(64).collect();
        let safe_name = safe_name.trim_matches('.');
        let filename = format!("{}.animation.json", if safe_name.is_empty() { "model" } else { safe_name });
        (active.source_path.clone(), filename)
    };
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut picker = FileDialog::new()
            .add_filter("Minecraft Bedrock Animation JSON", &["json"])
            .set_file_name(&filename);
        if let Some(ref source) = source_path {
            if let Some(folder) = source.parent() {
                picker = picker.set_directory(folder);
            }
        }
        picker.save_file()
    }).await.map_err(|_| failure("RUST_EDITOR_PICKER_FAILED", "Animation export dialog did not complete."))?;
    let Some(path) = chosen else { return Ok(None); };
    storage::animation_json(&path).map_err(model_failure)?;

    let _lease = write_lease(&state.pending_edit)?;
    let frozen = freeze_publication(
        &state.store, expected_epoch, expected_revision,
        "The model changed during animation export selection.",
    )?;
    verify_publication_source(
        &frozen, &path, "The original model changed on disk; no animations were exported.",
    )?;
    let bytes = export_bedrock_animations(frozen.session.document()).map_err(model_failure)?;
    storage::publish_new_animation(&path, &bytes, MAX_MODEL_BYTES).map_err(model_failure)?;
    Ok(Some(AnimationExportReceipt {
        sha256: sha256(&bytes), byte_count: bytes.len(),
        curve_fidelity: bedrock_animation_curve_fidelity(frozen.session.document()),
    }))
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
mod tests {
    use super::*;

    // SOURCE_AUTHORED_NOT_RUN: the native Rust semantic preview uses one
    // disposable candidate and cannot change original revision/Undo.
    fn semantic_preview_fixture() -> (EditorSession,SemanticMaterialIntent) {
        const TEXTURE: &str = "00000000-0000-4000-8000-000000000101";
        const CUBE: &str = "00000000-0000-4000-8000-000000000002";
        let mut doc=AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let mut pixels=vec![0u8;64*32*4];
        for y in 2usize..6 { for x in 1usize..5 {
            let index=(y*64+x)*4;
            pixels[index..index+4].copy_from_slice(&[90,110,130,255]);
        }}
        let mut png_bytes=Vec::new();
        {
            let mut encoder=png::Encoder::new(&mut png_bytes,64,32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer=encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }
        doc.texture_assets[0]=json!({
            "uuid":TEXTURE,"name":"preview-metal.png",
            "source":format!("data:image/png;base64,{}",
                STANDARD.encode(&png_bytes)),
            "internal":true,"wrap_mode":"limited",
            "render_mode":"default","render_sides":"double",
            "paint_owner":"lazydesigner-rgba8-v1",
            "uv_width":64,"uv_height":32,
        });
        let session=EditorSession::from_document(doc).unwrap();
        let intent=serde_json::from_value(json!({
            "expected_revision":0,"reference_png_sha256":"b".repeat(64),
            "cube_uuid":CUBE,"texture_uuid":TEXTURE,
            "face":"north","material":"painted_metal",
            "light_corner":"upper_left","contrast":"balanced",
            "source_base_rgba":[90,110,130,255],
            "shadow_rgb":[52,62,80],
            "highlight_rgb":[160,175,195],
            "protected_regions":[],"expected_before_pixels":[]
        })).unwrap();
        (session,intent)
    }

    #[test]
    fn semantic_material_ephemeral_candidate_does_not_edit_source_or_history() {
        let (source,intent)=semantic_preview_fixture();
        let before=source.export().unwrap();
        let before_hash=source.canonical_sha256().unwrap();
        let (proposal,candidate)=preview_semantic_candidate(&source,&intent).unwrap();
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["candidate_sha256"],
            json!(candidate.canonical_sha256().unwrap()));
        assert_ne!(candidate.export().unwrap(),before);
        assert_eq!(source.export().unwrap(),before);
        assert_eq!(source.canonical_sha256().unwrap(),before_hash);
        assert_eq!(source.summary().revision,0);
        assert!(!source.can_undo());
        assert!(!source.can_redo());
        assert_eq!(candidate.summary().revision,1);
    }

    #[test]
    fn semantic_material_sha_binding_refuses_replacement_without_partial_commit() {
        let (mut source,intent)=semantic_preview_fixture();
        let original=source.export().unwrap();
        let original_sha=source.canonical_sha256().unwrap();
        let (_proposal,candidate)=preview_semantic_candidate(&source,&intent).unwrap();
        let candidate_sha=candidate.canonical_sha256().unwrap();
        let wrong="c".repeat(64);
        let err=apply_checked_semantic_candidate(
            &mut source,&intent,&wrong,&candidate_sha).err().unwrap();
        assert_eq!(err.code,"SEMANTIC_PREVIEW_SOURCE_STALE");
        assert_eq!(source.export().unwrap(),original);
        let err=apply_checked_semantic_candidate(
            &mut source,&intent,&original_sha,&wrong).err().unwrap();
        assert_eq!(err.code,"SEMANTIC_PREVIEW_CANDIDATE_STALE");
        assert_eq!(source.export().unwrap(),original);
        assert_eq!(source.summary().revision,0);
        assert!(!source.can_undo());
        apply_checked_semantic_candidate(
            &mut source,&intent,&original_sha,&candidate_sha).unwrap();
        assert_eq!(source.canonical_sha256().unwrap(),candidate_sha);
        assert_eq!(source.summary().revision,1);
        assert!(source.can_undo());
        source.undo(1).unwrap();
        assert_eq!(source.export().unwrap(),original);
        assert_eq!(source.summary().revision,2);
    }


    // SOURCE ONLY: frozen read consumes the same authoritative session as
    // the GUI; an older candidate is not a live edit or a stale success.
    #[test]
    fn frozen_semantic_read_and_preflight_refuse_stale_gui_revision() {
        let session = EditorSession::open(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube = session.document().cubes[0].uuid.clone();
        let store = Mutex::new(EditorStore {
            epoch: 41,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let pinned = frozen_read_session(&store, 41, 0).unwrap();
        let map = pinned.semantic_map("cubes", 0, 4).unwrap();
        assert_eq!(map["revision"], 0);
        let plan = EditPlan {
            expected_revision: 0,
            operations: vec![EditOperation::TranslateCube {
                uuid: cube.clone(), delta: [1.0, 0.0, 0.0],
            }],
            correction_scope: None,
        };
        let preview = pinned.preflight(&plan).unwrap();
        assert_eq!(preview["status"], "VALIDATED_NOT_APPLIED");
        {
            let mut guard = store.lock().unwrap();
            let active = guard.active.as_mut().unwrap();
            active.session.apply(0, &plan.operations).unwrap();
            assert_eq!(active.session.summary().revision, 1);
        }
        assert_eq!(pinned.summary().revision, 0);
        assert_eq!(frozen_read_session(&store, 41, 0).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        assert_eq!(frozen_read_session(&store, 40, 1).err().unwrap().code,
            "RUST_EDITOR_SESSION_STALE");
        assert_eq!(frozen_read_session(&store, 41, 1).unwrap().summary().revision, 1);
    }

    // Source-authored only: the single publication lease excludes edits/model
    // replacement, while read-only snapshots can still acquire the store.
    // No user-PC, filesystem or Tauri runtime test has been executed.
    #[test]
    fn frozen_publication_releases_store_lock_and_refuses_stale_model() {
        let raw = include_bytes!("../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(raw).unwrap();
        let expected = session.canonical_sha256().unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 22, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: Some(expected.clone()), dirty: false,
            }),
        });
        let gate = Mutex::new(());
        let lease = write_lease(&gate).unwrap();
        let frozen = freeze_publication(&store, 22, 0, "stale").unwrap();
        assert_eq!(frozen.session.canonical_sha256().unwrap(), expected);
        assert!(store.try_lock().is_ok());
        assert_eq!(write_lease(&gate).err().unwrap().code, "RUST_EDITOR_EDIT_BUSY");
        let blocked = detached_edit(&store, &gate, 22, 0,
            ProjectionReuse::default(), None, |_| {
                panic!("A pending edit must not start during publication.");
            }).unwrap_err();
        assert_eq!(blocked.code, "RUST_EDITOR_EDIT_BUSY");
        drop(lease);
        let output = frozen.session.export().unwrap();
        assert_eq!(sha256(&output), expected);

        let new_lease = write_lease(&gate).unwrap();
        {
            // Simulates an uncoordinated or stale writer for revision refusal.
            let mut guard = store.lock().unwrap();
            guard.active.as_mut().unwrap().session.apply(0, &[
                EditOperation::CreateAnimation {
                    uuid:"00000000-0000-4000-8000-000000000986".into(),
                    name:"changed".into(), length:1.0,
                }
            ]).unwrap();
        }
        assert_eq!(freeze_publication(&store, 22, 0, "stale")
            .err().unwrap().code, "RUST_EDITOR_REVISION_STALE");
        store.lock().unwrap().epoch += 1;
        assert_eq!(freeze_publication(&store, 22, 1, "stale")
            .err().unwrap().code, "RUST_EDITOR_SESSION_STALE");
        drop(new_lease);
    }

    // A read-only publisher continues to reject a changed on-disk original.
    // The independent user-owned no-overwrite publisher remains untouched.
    #[test]
    fn frozen_publication_rechecks_raw_source_before_writing_new_sibling() {
        let dir = std::env::temp_dir().join(format!(
            "ld-publish-{:016x}", rand::rng().next_u64()));
        std::fs::create_dir(&dir).unwrap();
        let input = dir.join("source.bbmodel");
        let output = dir.join("new-copy.bbmodel");
        let raw = include_bytes!("../fixtures/bedrock-basic.bbmodel");
        std::fs::write(&input, raw).unwrap();
        let session = EditorSession::open(raw).unwrap();
        let source = FrozenPublication {
            session, source_path: Some(input.clone()),
            source_sha: Some(sha256(raw)),
            saved_canonical_sha: None, dirty: true,
        };
        verify_publication_source(&source, &output, "changed").unwrap();
        assert!(!output.exists());
        std::fs::write(&input, b"other source data").unwrap();
        assert_eq!(verify_publication_source(&source, &output, "changed")
            .unwrap_err().code, "RUST_EDITOR_SOURCE_CHANGED");
        assert!(!output.exists());
        std::fs::remove_file(input).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    // Preserve numeric accepted JSON vector projection without cloning the
    // source Value/allocating a serde owned-deserialization temporary.
    #[test]
    fn borrowed_vec3_projection_matches_previous_owned_decoder() {
        for value in [
            json!([1, 2.5, -3]), json!([0, 0, 0]), json!([3, 4]),
            json!([1, 2, 3, 4]), json!(["1", 2, 3]),
            json!([1, true, 3]), json!([1, null, 3]),
            json!({"x":1,"y":2,"z":3}), json!(null),
        ] {
            let expected = serde_json::from_value::<[f64; 3]>(value.clone())
                .ok().filter(|vec| vec.iter().all(|axis| axis.is_finite()));
            assert_eq!(borrowed_vec3(&value), expected);
        }
        let mut properties = Map::new();
        properties.insert("rotation".into(), json!([90.0, 0, -20.5]));
        assert_eq!(property_vec3(&properties, "rotation"), [90.0, 0.0, -20.5]);
        properties.insert("rotation".into(), json!([false, 0, 0]));
        assert_eq!(property_vec3(&properties, "rotation"), [0.0; 3]);
    }

    // SOURCE-AUTHORED_NOT_RUN: prepared transactions never hold the store
    // lock across cloning, validation or canonical hashing, and a competing
    // authoring revision cannot be overwritten by a late provisional edit.
    #[test]
    fn detached_transactions_are_revision_guarded_and_retain_history() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 7, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let gate = Mutex::new(());
        let accepted = detached_edit(&store, &gate, 7, 0, ProjectionReuse::default(), None, |pending| {
            assert!(store.try_lock().is_ok());
            pending.apply(0, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000915".into(),
                name:"first".into(), length:1.0,
            }]).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(accepted.revision, 1);
        assert_eq!(accepted.animation_count, 1);
        assert!(accepted.can_undo);
        // Competing edit admission must fail before staging another model.
        let lease = gate.lock().unwrap();
        let busy = detached_edit(&store, &gate, 7, 1, ProjectionReuse::default(), None, |_| {
            panic!("busy lease must refuse before edit closure");
        }).unwrap_err();
        assert_eq!(busy.code, "RUST_EDITOR_EDIT_BUSY");
        drop(lease);

        let stale = detached_edit(&store, &gate, 7, 1, ProjectionReuse::default(), None, |pending| {
            pending.apply(1, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000916".into(),
                name:"uncommitted".into(), length:1.0,
            }]).map_err(model_failure)?;
            let mut guard = store.lock().unwrap();
            guard.active.as_mut().unwrap().session.apply(1, &[
                EditOperation::CreateAnimation {
                    uuid:"00000000-0000-4000-8000-000000000917".into(),
                    name:"other".into(), length:1.0,
                },
            ]).map_err(model_failure)?;
            Ok(())
        }).unwrap_err();
        assert_eq!(stale.code, "RUST_MODEL_REJECTED");
        assert_eq!(stale.message, "DOCUMENT_REVISION_STALE");
        {
            let guard = store.lock().unwrap();
            let active = guard.active.as_ref().unwrap();
            assert_eq!(active.session.summary().revision, 2);
            assert_eq!(active.session.document().animation_assets.len(), 2);
            assert!(!active.session.document().animation_assets.iter().any(|asset|
                asset["name"] == "uncommitted"));
        }
        let after = detached_edit(&store, &gate, 7, 2, ProjectionReuse::default(), None, |pending| {
            assert!(store.try_lock().is_ok());
            pending.undo(2).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(after.revision, 3);
        assert_eq!(after.animation_count, 1);
        assert!(after.can_redo);
        let restored = detached_edit(&store, &gate, 7, 3, ProjectionReuse::default(), None, |pending| {
            pending.redo(3).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(restored.revision, 4);
        assert_eq!(restored.animation_count, 2);
    }

    #[test]
    fn detached_transaction_refuses_replaced_model_epoch() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 3, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let gate = Mutex::new(());
        let error = detached_edit(&store, &gate, 3, 0, ProjectionReuse::default(), None, |pending| {
            pending.apply(0, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000918".into(),
                name:"abandoned".into(), length:1.0,
            }]).map_err(model_failure)?;
            store.lock().unwrap().epoch = 4;
            Ok(())
        }).unwrap_err();
        assert_eq!(error.code, "RUST_EDITOR_SESSION_STALE");
        let guard = store.lock().unwrap();
        assert!(guard.active.as_ref().unwrap().session.document()
            .animation_assets.is_empty());
        assert_eq!(guard.active.as_ref().unwrap().session.summary().revision, 0);
    }

    // SOURCE-AUTHORED_NOT_RUN: expensive projection must hold an immutable
    // document revision even after another writer commits; the store lock
    // becomes available before the projection itself runs.
    #[test]
    fn frozen_projection_releases_mutex_without_mixing_revisions() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 9, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let frozen = {
            let guard = store.lock().unwrap();
            freeze_projection(&guard).unwrap()
        };
        let before = project_frozen(&frozen, ProjectionReuse::default());
        {
            let mut guard = store.try_lock().unwrap();
            let active = guard.active.as_mut().unwrap();
            active.session.apply(0, &[EditOperation::CreateAnimation {
                uuid: "00000000-0000-4000-8000-000000000982".into(),
                name: "idle".into(), length: 1.0,
            }]).unwrap();
            refresh_dirty(active);
        }
        let first = project_frozen(&frozen, ProjectionReuse {
            preview: Some(&before.preview_source_key), ..ProjectionReuse::default()
        });
        let after = project_detached(store.lock().unwrap(), ProjectionReuse {
            preview: Some(&before.preview_source_key), ..ProjectionReuse::default()
        })
            .unwrap();
        assert_eq!((before.epoch, before.revision), (9, 0));
        assert_eq!((first.epoch, first.revision, first.animation_count), (9, 0, 0));
        assert_eq!((after.epoch, after.revision, after.animation_count), (9, 1, 1));
        assert_eq!(first.texture_preview_sources.len(), 0);
        assert!(after.preview_sources_reused);
        assert!(store.try_lock().is_ok());
    }

    // SOURCE-AUTHORED_NOT_RUN: projections are exactly content- and
    // epoch-bound. Editing one family must not invalidate unchanged others.
    #[test]
    fn geometry_animation_reuse_is_content_and_epoch_bound() {
        let mut store = EditorStore {
            epoch: 21, active: Some(ActiveModel {
                session: EditorSession::from_document(
                    AuthoringDocument::new_bedrock("Slices", "slices").unwrap()
                ).unwrap(), source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        };
        let full = project(&store).unwrap();
        assert_eq!(full.geometry_source_key, projection_source_key(full.epoch,
            b"geometry", &(&full.cubes, &full.bones, &full.hierarchy)));
        let hints = ProjectionReuse {
            geometry: Some(&full.geometry_source_key),
            animation: Some(&full.animation_source_key),
            ..ProjectionReuse::default()
        };
        let same = project_frozen(&freeze_projection(&store).unwrap(), hints);
        assert!(same.geometry_reused && same.animations_reused);
        assert!(same.cubes.is_empty() && same.bones.is_empty());
        assert!(same.hierarchy.is_empty() && same.animations.is_empty());
        store.active.as_mut().unwrap().session.apply(0, &[
            EditOperation::CreateAnimation {
                uuid: "00000000-0000-4000-8000-000000001981".into(),
                name: "idle".into(), length: 1.0,
            },
        ]).unwrap();
        let changed_anim = project_frozen(&freeze_projection(&store).unwrap(), hints);
        assert!(changed_anim.geometry_reused && !changed_anim.animations_reused);
        assert_eq!(changed_anim.animations.len(), 1);
        let new_hints = ProjectionReuse {
            geometry: Some(&changed_anim.geometry_source_key),
            animation: Some(&changed_anim.animation_source_key),
            ..ProjectionReuse::default()
        };
        store.active.as_mut().unwrap().session.apply(1, &[
            EditOperation::AddBone {
                bone: Bone { uuid: "00000000-0000-4000-8000-000000001982".into(),
                    name: "root".into(), origin: Some([0.0, 0.0, 0.0]),
                    extra: Map::new() },
                parent_uuid: None,
            },
        ]).unwrap();
        let changed_geo = project_frozen(&freeze_projection(&store).unwrap(), new_hints);
        assert!(!changed_geo.geometry_reused && changed_geo.animations_reused);
        assert_eq!(changed_geo.bones.len(), 1);
        assert_eq!(changed_geo.hierarchy.len(), 1);
        assert_eq!(changed_geo.geometry_source_key, projection_source_key(changed_geo.epoch,
            b"geometry", &(&changed_geo.cubes, &changed_geo.bones, &changed_geo.hierarchy)));
        assert!(changed_geo.animations.is_empty());
        store.epoch += 1;
        let different_epoch = project_frozen(&freeze_projection(&store).unwrap(), new_hints);
        assert!(!different_epoch.geometry_reused && !different_epoch.animations_reused);
    }

    // Source-authored Rust/Tauri projection regression; native tests held.
    #[test]
    fn editor_png_transport_reuse_requires_exact_epoch_and_source_content() {
        const TEX: &str = "00000000-0000-4000-8000-000000009989";
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Preview", "preview").unwrap()).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid:TEX.into(), name:"test.png".into(),
        }]).unwrap();
        let mut store=EditorStore { epoch:7, active:Some(ActiveModel {
            session, source_path:None, source_sha:None,
            saved_canonical_sha:None, dirty:true,
        }) };
        let full=project(&store).unwrap();
        assert!(!full.preview_sources_reused);
        assert_eq!(full.texture_preview_sources.len(),1);
        assert!(full.texture_preview_sources[0].is_some());
        let reused=project_with_preview_reuse(&store,Some(&full.preview_source_key)).unwrap();
        assert!(reused.preview_sources_reused);
        assert!(reused.texture_preview_sources.is_empty());
        assert_eq!(reused.revision,full.revision);
        let unknown=project_with_preview_reuse(&store,Some("bad-digest")).unwrap();
        assert!(!unknown.preview_sources_reused);
        assert_eq!(unknown.texture_preview_sources,full.texture_preview_sources);
        store.active.as_mut().unwrap().session.apply(1,&[EditOperation::PaintTexturePixel {
            texture_index:0, x:0, y:0, rgba:[20,30,40,255],
        }]).unwrap();
        let painted=project_with_preview_reuse(&store,Some(&full.preview_source_key)).unwrap();
        assert!(!painted.preview_sources_reused);
        assert_ne!(painted.preview_source_key,full.preview_source_key);
        assert_ne!(painted.texture_preview_sources,full.texture_preview_sources);
        store.epoch+=1;
        let reopened=project_with_preview_reuse(&store,Some(&painted.preview_source_key)).unwrap();
        assert!(!reopened.preview_sources_reused);
        assert_ne!(reopened.preview_source_key,painted.preview_source_key);
        // An animation-only transaction must retain the same Paint source key
        // and omit immutable embedded PNG bytes when the editor knows it.
        let before_animation_revision=store.active.as_ref().unwrap()
            .session.summary().revision;
        store.active.as_mut().unwrap().session.apply(
            before_animation_revision, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000009988".into(),
                name:"idle".into(), length:1.0,
            }],
        ).unwrap();
        let after_animation=project_with_preview_reuse(
            &store,Some(&reopened.preview_source_key)).unwrap();
        assert_eq!(after_animation.revision,before_animation_revision+1);
        assert!(after_animation.preview_sources_reused);
        assert!(after_animation.texture_preview_sources.is_empty());
        assert_eq!(after_animation.preview_source_key,reopened.preview_source_key);
    }


    // SOURCE ONLY: Tauri app/file-dialog and localtest are held.
    #[test]
    fn animation_export_consumer_reuses_rust_document_without_modification() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()).unwrap();
        const CLIP: &str = "00000000-0000-4000-8000-000000009999";
        session.apply(0, &[EditOperation::CreateAnimation {
            uuid: CLIP.into(), name: "animation.idle".into(), length: 1.0,
        }]).unwrap();
        let before = session.document().clone();
        let bytes = export_bedrock_animations(session.document()).unwrap();
        let output: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(output["format_version"], "1.8.0");
        assert_eq!(bedrock_animation_curve_fidelity(session.document()), "native");
        assert!(output["animations"].get("animation.idle").is_some());
        assert_eq!(session.document(), &before);
        let mut opaque = before;
        opaque.animation_assets[0]["opaque"] = json!(true);
        assert_eq!(export_bedrock_animations(&opaque).unwrap_err(),
            "ANIMATION_EXPORT_CLIP_UNSUPPORTED");
    }

    // SOURCE ONLY: tests remain on hold. Imported JSON formatting must not
    // conflate the raw disk-source identity with canonical editor content.
    #[test]
    fn open_checkpoint_streams_canonical_sha_and_keeps_original_disk_identity() {
        const RAW: &[u8] = include_bytes!("../fixtures/bedrock-basic.bbmodel");
        let compact = serde_json::to_vec(
            &serde_json::from_slice::<Value>(RAW).unwrap()
        ).unwrap();
        assert_ne!(compact.as_slice(), RAW);
        let session = EditorSession::open(&compact).unwrap();
        let raw_sha = sha256(&compact);
        let canonical_sha = session.canonical_sha256().unwrap();
        assert_ne!(raw_sha, canonical_sha);
        // Independent export is the byte-level parity oracle, not the
        // production Open path used solely to obtain the fingerprint.
        assert_eq!(canonical_sha, sha256(&session.export().unwrap()));
        let mut active = ActiveModel {
            session, source_path: Some(PathBuf::from("model.bbmodel")),
            source_sha: Some(raw_sha.clone()),
            saved_canonical_sha: Some(canonical_sha.clone()),
            dirty: false,
        };
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        assert_eq!(active.source_sha.as_deref(), Some(raw_sha.as_str()));
        assert_eq!(active.saved_canonical_sha.as_deref(),
            Some(canonical_sha.as_str()));
    }

    // A stale restore decision cannot silently replace a newer native edit.
    #[test]
    fn restore_revision_gate_rejects_stale_active_document() {
        let mut store = EditorStore::default();
        assert!(check_restore_revision(&store, 0).is_ok());
        assert_eq!(check_restore_revision(&store, 1).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Recover", "recover").unwrap()
        ).unwrap();
        store.active = Some(ActiveModel {
            session, source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        });
        assert!(check_restore_revision(&store, 0).is_ok());
        assert_eq!(check_restore_revision(&store, 2).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        assert!(check_discard(&store, false).is_err());
    }

    // SOURCE AUTHORED; NOT_EXECUTED under the Rust branch's localtest hold.
    #[test]
    fn canonical_save_checkpoint_reconciles_dirty_on_apply_undo_redo() {
        const BASIC: &[u8] =
            include_bytes!("../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(BASIC).unwrap();
        let saved = sha256(&session.export().unwrap());
        assert_eq!(session.canonical_sha256().unwrap(), saved);
        let raw_sha = sha256(BASIC);
        let cube_uuid = session.document().cubes[0].uuid.clone();
        let mut active = ActiveModel {
            session,
            source_path: Some(PathBuf::from("source.bbmodel")),
            source_sha: Some(raw_sha.clone()),
            saved_canonical_sha: Some(saved),
            dirty: false,
        };
        assert!(!active.dirty);
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.apply(0, &[EditOperation::TranslateCube {
            uuid: cube_uuid, delta: [1.0, 0.0, 0.0],
        }]).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.undo(1).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.redo(2).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(active.dirty);
        // Save Copy establishes a new checkpoint without removing history.
        active.saved_canonical_sha = Some(sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.undo(3).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.redo(4).unwrap();
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        // Disk identity remains independent of model-content identity.
        assert_eq!(active.source_sha, Some(raw_sha));
    }

    #[test]
    fn new_unsaved_project_stays_dirty_after_history_returns_to_initial_state() {
        let document = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube_uuid = document.cubes[0].uuid.clone();
        let mut active = ActiveModel {
            session: EditorSession::from_document(document).unwrap(),
            source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        };
        active.session.apply(0, &[EditOperation::TranslateCube {
            uuid: cube_uuid, delta: [2.0, 0.0, 0.0],
        }]).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.undo(1).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
    }

    // Source authored only; test execution remains held.
    #[test]
    fn empty_project_has_no_claimed_model() {
        let store = EditorStore::default();
        assert!(project(&store).is_none());
        assert_eq!(store.epoch, 0);
    }

    // SOURCE ONLY: no live canvas capture or native test execution.
    #[test]
    fn review_capture_requires_real_decoded_png_and_an_exact_saved_model() {
        let valid = png_candidate(32, 32);
        assert!(decode_review_capture_png(&valid).is_ok());
        for bad in [
            "data:image/png;base64,",
            "data:image/png;base64,AAAA",
            "data:image/jpeg;base64,AAAA",
        ] {
            assert!(decode_review_capture_png(bad).is_err());
        }
        assert!(decode_review_capture_png(&png_candidate(16, 16)).is_err());
        let raw = include_bytes!("../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(raw).unwrap();
        let mut active = ActiveModel {
            session, source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        };
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err());
        let tmp = std::env::temp_dir().join(format!(
            "ld-review-{:016x}.bbmodel", rand::rng().next_u64()));
        let canonical = active.session.export().unwrap();
        std::fs::write(&tmp, &canonical).unwrap();
        let exact = sha256(&canonical);
        active.source_path = Some(tmp.clone());
        active.source_sha = Some(exact.clone());
        active.saved_canonical_sha = Some(exact.clone());
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err()); // still dirty
        active.dirty = false;
        assert_eq!(review_capture_source(&FrozenPublication::from(&active)).unwrap().1, exact);
        std::fs::write(&tmp, b"external model changed").unwrap();
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err());
        let _ = std::fs::remove_file(tmp);
    }

    fn png_candidate(width: u32, height: u32) -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&vec![0; width as usize * height as usize * 4]).unwrap();
        }
        format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
    }

    // SOURCE-AUTHORED_NOT_RUN: bounded streaming Base64 preview must retain
    // strict whole-source syntax validation without caching decoded PNG data.
    #[test]
    fn streaming_png_preview_rejects_invalid_suffix_and_preserves_header_only_admission() {
        const PREFIX: &str = "data:image/png;base64,";
        let candidate = png_candidate(32, 32);
        let texture = json!({"source":candidate});
        let before = texture.clone();
        assert_eq!(embedded_png_preview_candidate(&texture)
            .map(|(_, width, height)| [width, height]), Some([32, 32]));
        assert_eq!(texture, before);

        // A valid IHDR followed by malformed Base64 is not an admitted
        // preview. Checking only the first 33 decoded bytes would miss it.
        let bad_tail = format!("{candidate}!");
        assert!(embedded_png_preview_source(&json!({"source":bad_tail})).is_none());
        let mut bad_middle = candidate.clone();
        let encoded_offset = PREFIX.len() + 60;
        bad_middle.replace_range(encoded_offset..encoded_offset + 1, "@");
        assert!(embedded_png_preview_source(&json!({"source":bad_middle})).is_none());

        // Legacy admission checked only that a complete 33-byte PNG header
        // existed, not full PNG CRC; the browser still performs final decode.
        let bytes = STANDARD.decode(candidate.strip_prefix(PREFIX).unwrap()).unwrap();
        let header_only = format!("{PREFIX}{}", STANDARD.encode(&bytes[..33]));
        assert_eq!(embedded_png_preview_candidate(&json!({"source":header_only}))
            .map(|(_, width, height)| [width, height]), Some([32, 32]));
    }

    #[test]
    fn texture_projection_checks_png_header_and_rejects_unsupported_sources() {
        let candidate = png_candidate(2, 2);
        assert_eq!(embedded_png_preview_source(&json!({"source":candidate})), Some(candidate.clone()));
        assert!(embedded_png_preview_source(&json!({"source":"https://example.test/atlas.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"relative_path":"textures/entity/atlas.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":"data:image/png;base64,iVBORw0KGgoAAAABAAAAAA=="})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":"data:image/png;base64,AAAA"})).is_none());
        let oversized_source = format!("data:image/png;base64,iVBORw0KGgo{}", "A".repeat(2 * 1024 * 1024));
        assert!(embedded_png_preview_source(&json!({"source":oversized_source})).is_none());
        let mut bytes = STANDARD.decode(candidate.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
        bytes[16..20].copy_from_slice(&4096u32.to_be_bytes());
        assert!(embedded_png_preview_source(&json!({
            "source": format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
        })).is_none());
        bytes[16..20].copy_from_slice(&2u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&0u32.to_be_bytes());
        assert!(embedded_png_preview_source(&json!({
            "source": format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
        })).is_none());
        let mut doc = AuthoringDocument::new_bedrock("Synthetic", "synthetic").unwrap();
        doc.resolution.width = 2;
        doc.resolution.height = 2;
        doc.texture_assets.push(json!({"source":candidate}));
        assert_eq!(texture_preview_sources(&doc), vec![Some(candidate.clone())]);
        doc.extensions.insert("multi_file_ruleset".into(), json!("textures"));
        assert_eq!(texture_preview_sources(&doc), vec![None]);
    }

    #[test]
    fn texture_projection_refuses_mismatched_png_and_uv_grid_without_mutating_model() {
        let mut doc = AuthoringDocument::new_bedrock("UV", "uv").unwrap();
        doc.resolution.width = 16;
        doc.resolution.height = 16;
        let mismatched = png_candidate(8, 16);
        doc.texture_assets.push(json!({"source":mismatched}));
        let before = doc.texture_assets.clone();
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        assert_eq!(doc.texture_assets, before);

        let matching = png_candidate(16, 16);
        doc.texture_assets[0] = json!({"source":matching, "uv_width":8, "uv_height":16});
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        doc.texture_assets[0]["uv_width"] = json!(16);
        doc.texture_assets[0]["uv_height"] = json!(32);
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        doc.texture_assets[0]["uv_height"] = json!(16);
        assert_eq!(texture_preview_sources(&doc), vec![Some(matching)]);
    }

    // SOURCE-AUTHORED_NOT_RUN: indexed texture scope resolution must retain
    // the old ambiguity and admitted-PNG refusal semantics across many Cubes.
    #[test]
    fn indexed_attachable_texture_scopes_reject_duplicates_and_unavailable_png() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        let png = png_candidate(16, 16);
        doc.texture_assets = (1..=12).map(|scope| json!({
            "uuid":format!("00000000-0000-4000-8000-{scope:012}"),
            "scope":scope, "name":format!("scope_{scope}.png"),
            "source":png, "uv_width":128, "uv_height":128
        })).collect();
        let immutable = doc.clone();
        let assets = texture_preview_assets(&doc);
        let indexed = texture_scope_indices(&doc);
        assert_eq!(indexed.len(),12);
        let mut cube = doc.cubes[0].clone();
        for scope in 1..=12u64 {
            cube.extra.insert("scope".into(), json!(scope));
            assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
                PreviewUvMode::ScopedAttachable), Some((scope - 1) as usize));
        }
        assert_eq!(doc,immutable);
        cube.extra.insert("scope".into(), json!(0));
        assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
            PreviewUvMode::ScopedAttachable),None);
        cube.extra.insert("scope".into(), json!(2));
        assert_eq!(scoped_cube_texture_index(None, &cube, &assets,
            PreviewUvMode::ScopedAttachable),None);
        assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
            PreviewUvMode::Unsupported),None);

        // Duplicate scopes refuse even when both sources look otherwise valid.
        doc.texture_assets[0]["scope"] = json!(2);
        let duplicate = texture_scope_indices(&doc);
        assert_eq!(duplicate.get(&2),Some(&None));
        assert_eq!(scoped_cube_texture_index(Some(&duplicate), &cube,
            &texture_preview_assets(&doc), PreviewUvMode::ScopedAttachable),None);

        // Unique scope is still refused when its source exceeds the bounded
        // preview admission rule; other scopes remain unchanged.
        doc.texture_assets[0]["scope"] = json!(1);
        doc.texture_assets[1]["source"] = json!("data:image/png;base64,AAAA");
        let restricted = texture_preview_assets(&doc);
        let refreshed = texture_scope_indices(&doc);
        assert_eq!(scoped_cube_texture_index(Some(&refreshed), &cube,
            &restricted, PreviewUvMode::ScopedAttachable),None);
        cube.extra.insert("scope".into(),json!(3));
        assert_eq!(scoped_cube_texture_index(Some(&refreshed), &cube,
            &restricted, PreviewUvMode::ScopedAttachable),Some(2));
    }

    // Source-authored regression only; native WebView2/Blockbench is held.
    #[test]
    fn scoped_attachable_preview_maps_each_cube_to_its_texture_uv_grid() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        doc.cubes[0].extra.insert("scope".into(), json!(2));
        let first = png_candidate(8, 16);
        let second = png_candidate(16, 8);
        doc.texture_assets = vec![
            json!({
                "uuid":"00000000-0000-4000-8000-000000000901",
                "name":"body.png", "scope":1, "source":first,
                "uv_width":32, "uv_height":64
            }),
            json!({
                "uuid":"00000000-0000-4000-8000-000000000902",
                "name":"armor.png", "scope":2, "source":second,
                "uv_width":64, "uv_height":32
            })
        ].into();
        let original = doc.clone();
        let store = EditorStore {
            epoch: 17,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let preview = project(&store).unwrap();
        assert!(preview.scoped_texture_preview);
        assert_eq!(preview.texture_preview_sources, vec![Some(first), Some(second)]);
        assert_eq!(preview.texture_preview_resolutions,
            vec![Some([32, 64]), Some([64, 32])]);
        assert_eq!(preview.cubes[0].preview_texture_index, Some(1));
        assert_eq!(preview.texture_resolution, [128, 128]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        // Only the renderer gains a limited, read-only scoped preview.
        assert!(!can_add_paint_texture(&original));
        assert!(!paint_texture_exportable(&original, 1));
    }

    #[test]
    fn scoped_preview_refuses_duplicate_scopes_opaque_grids_and_other_rulesets() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        doc.cubes[0].extra.insert("scope".into(), json!(2));
        let source = png_candidate(16, 8);
        doc.texture_assets = vec![
            json!({"uuid":"00000000-0000-4000-8000-000000000903",
                "scope":1, "source":source, "uv_width":64, "uv_height":32}),
            json!({"uuid":"00000000-0000-4000-8000-000000000904",
                "scope":2, "source":source, "uv_width":64, "uv_height":32})
        ].into();
        let safe = texture_preview_assets(&doc);
        assert_eq!(safe[1].as_ref().map(|(_, uv)| *uv), Some([64, 32]));
        assert_eq!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &safe,
            preview_uv_mode(&doc)), Some(1));
        // Duplicate texture scopes are ambiguous even when their PNGs match.
        doc.texture_assets[0]["scope"] = json!(2);
        let candidates = texture_preview_assets(&doc);
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &candidates,
            preview_uv_mode(&doc)).is_none());

        doc.texture_assets[0]["scope"] = json!(1);
        doc.texture_assets[1]["uv_width"] = json!("64");
        let invalid = texture_preview_assets(&doc);
        assert!(invalid[1].is_none());
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &invalid,
            preview_uv_mode(&doc)).is_none());

        doc.texture_assets[1]["uv_width"] = json!(64);
        doc.texture_assets[1]["uv_height"] = json!(64);
        // Different PNG and UV-grid aspect ratios imply an unsupported
        // flipbook projection, even if both dimensions are valid integers.
        assert!(texture_preview_assets(&doc)[1].is_none());

        doc.texture_assets[1].as_object_mut().unwrap().remove("uv_width");
        doc.texture_assets[1].as_object_mut().unwrap().remove("uv_height");
        doc.texture_assets[1]["source"] = json!(png_candidate(16, 16));
        let project_fallback = texture_preview_assets(&doc);
        assert_eq!(project_fallback[1].as_ref().map(|(_, uv)| *uv), Some([128, 128]));

        doc.texture_assets[1]["relative_path"] = json!("textures/armor.png");
        assert!(texture_preview_assets(&doc)[1].is_none());
        doc.texture_assets[1].as_object_mut().unwrap().remove("relative_path");
        doc.texture_assets[1]["layers"] = json!([{"name":"unflattened"}]);
        assert!(texture_preview_assets(&doc)[1].is_none());
        doc.texture_assets[1].as_object_mut().unwrap().remove("layers");
        doc.cubes[0].extra.remove("scope");
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0],
            &texture_preview_assets(&doc), preview_uv_mode(&doc)).is_none());
        doc.cubes[0].extra.insert("scope".into(), json!(2));

        doc.meta.extra.insert("per_texture_uv_size".into(), json!(false));
        assert_eq!(preview_uv_mode(&doc), PreviewUvMode::Unsupported);
        assert!(texture_preview_assets(&doc).iter().all(Option::is_none));
        doc.meta.extra.remove("per_texture_uv_size");

        doc.extensions.insert("multi_file_ruleset".into(), json!("unreviewed_ruleset"));
        assert_eq!(preview_uv_mode(&doc), PreviewUvMode::Unsupported);
        assert!(texture_preview_assets(&doc).iter().all(Option::is_none));
    }

    #[test]
    fn texture_projection_bounds_total_decoded_pixels_and_texture_count() {
        let candidate = png_candidate(2048, 2048);
        let mut doc = AuthoringDocument::new_bedrock("Bounded", "bounded").unwrap();
        doc.resolution.width = 2048;
        doc.resolution.height = 2048;
        doc.texture_assets.push(json!({"source":candidate}));
        doc.texture_assets.push(json!({"source":candidate}));
        let projected = texture_preview_sources(&doc);
        assert!(projected[0].is_some());
        assert!(projected[1].is_none());
        let small = png_candidate(1, 1);
        doc.resolution.width = 1;
        doc.resolution.height = 1;
        doc.texture_assets = (0..18).map(|_| json!({"source":small})).collect();
        let projected = texture_preview_sources(&doc);
        assert_eq!(projected.iter().filter(|source| source.is_some()).count(), 16);
        assert!(projected[16].is_none() && projected[17].is_none());
    }

    #[test]
    fn texture_preview_limits_modes_and_preserves_render_sides() {
        let candidate = png_candidate(2, 2);
        let standard = json!({"source":candidate});
        assert_eq!(texture_preview_side(&standard), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"auto"})), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"front"})), Some("front"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"double"})), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"back"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"emissive"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"additive"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"layered"})), None);
        assert!(embedded_png_preview_source(&standard).is_some());
        assert!(embedded_png_preview_source(&json!({"source":candidate,
            "render_mode":"emissive"})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":candidate,
            "render_sides":"back"})).is_none());
    }

    #[test]
    fn paint_editability_projection_matches_rust_generated_texture_gate() {
        let candidate = json!({
            "uuid":"test", "name":"paint.png",
            "source":"data:image/png;base64,iVBORw0KGgoAAAABAAAAAA==",
            "internal":true, "wrap_mode":"limited",
            "render_mode":"default", "render_sides":"double",
            "paint_owner":"lazydesigner-rgba8-v1"
        });
        assert!(paint_texture_editable(&candidate));
        let mut injected = candidate;
        injected["vendor_extension"] = json!({"preserve":true});
        assert!(!paint_texture_editable(&injected));
        assert!(!paint_texture_editable(&json!({"paint_owner":"lazydesigner-rgba8-v1"})));
    }

    #[test]
    fn new_cube_faces_bind_the_first_bedrock_texture_uuid() {
        let textures = vec![
            json!({"uuid":"00000000-0000-4000-8000-000000000101","name":"first.png"}),
            json!({"uuid":"00000000-0000-4000-8000-000000000102","name":"second.png"}),
        ];
        let unchanged = textures.clone();
        let faces = new_cube_faces(&textures);
        assert_eq!(faces.len(), 6);
        for face in faces.values() {
            assert_eq!(face["texture"], textures[0]["uuid"]);
            assert_eq!(face["uv"], json!([0.0, 0.0, 2.0, 2.0]));
        }
        assert_eq!(textures, unchanged);
    }

    #[test]
    fn new_cube_faces_do_not_invent_missing_texture_uuids() {
        let no_textures = new_cube_faces(&[]);
        let legacy = new_cube_faces(&[json!({"name":"legacy.png"})]);
        for face in no_textures.values().chain(legacy.values()) {
            assert_eq!(face["texture"], json!(false));
        }
        let legacy_with_second_uuid = new_cube_faces(&[
            json!({"name":"legacy.png"}),
            json!({"uuid":"00000000-0000-4000-8000-000000000102"}),
        ]);
        assert_eq!(legacy_with_second_uuid["north"]["texture"], json!(false));
    }

    #[test]
    fn source_projection_is_derived_from_the_single_rust_document() {
        let doc = AuthoringDocument::new_bedrock("Synthetic", "synthetic").unwrap();
        let session = EditorSession::from_document(doc).unwrap();
        let store = EditorStore {
            epoch: 4,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.epoch, 4);
        assert_eq!(snapshot.name, "Synthetic");
        assert_eq!(snapshot.cubes.len(), 0);
        assert_eq!(snapshot.preview_scope, "UNVERIFIED_EMBEDDED_PNG_SUBSET");
    }

    #[test]
    fn bone_visibility_snapshot_is_derived_from_authoritative_rust_data() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.bones[0].extra.insert("visibility".into(), json!(false));
        doc.cubes[0].extra.insert("visibility".into(), json!(false));
        let store = EditorStore {
            epoch: 2,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert!(!snapshot.bones[0].visible);
        assert!(!snapshot.cubes[0].visible);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &doc);
    }


    #[test]
    fn cube_render_order_snapshot_follows_pinned_blockbench_priorities() {
        for (order, expected) in [
            (None, 0i8), (Some("default"), 0),
            (Some("behind"), -1), (Some("in_front"), 1),
        ] {
            let mut doc = AuthoringDocument::import_bbmodel(
                include_bytes!("../fixtures/bedrock-basic.bbmodel")
            ).unwrap();
            if let Some(value) = order {
                doc.cubes[0].extra.insert("render_order".into(), json!(value));
            }
            let store = EditorStore {
                epoch: 12,
                active: Some(ActiveModel {
                    session: EditorSession::from_document(doc.clone()).unwrap(),
                    source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
                }),
            };
            assert_eq!(project(&store).unwrap().cubes[0].render_order, expected);
            assert_eq!(store.active.as_ref().unwrap().session.document(), &doc);
        }
    }


    #[test]
    fn per_texture_preview_refusal_matches_rust_edit_gate() {
        let mut doc = AuthoringDocument::new_bedrock("UV metadata", "uv_metadata").unwrap();
        doc.resolution.width = 2;
        doc.resolution.height = 2;
        let valid_png = png_candidate(2, 2);
        doc.texture_assets.push(json!({"source":valid_png}));
        assert_eq!(texture_preview_sources(&doc), vec![Some(valid_png.clone())]);
        for location in ["meta", "project"] {
            for flag in [json!(true), json!("true"), json!(17), Value::Null] {
                if location == "meta" {
                    doc.meta.extra.insert("per_texture_uv_size".into(), flag.clone());
                } else {
                    doc.extensions.insert("per_texture_uv_size".into(), flag.clone());
                }
                assert!(has_per_texture_uv_rules(&doc));
                let before = doc.clone();
                assert_eq!(texture_preview_sources(&doc), vec![None]);
                assert_eq!(doc, before);
                doc.meta.extra.remove("per_texture_uv_size");
                doc.extensions.remove("per_texture_uv_size");
            }
            if location == "meta" {
                doc.meta.extra.insert("per_texture_uv_size".into(), json!(false));
            } else {
                doc.extensions.insert("per_texture_uv_size".into(), json!(false));
            }
            assert!(!has_per_texture_uv_rules(&doc));
            assert_eq!(texture_preview_sources(&doc), vec![Some(valid_png.clone())]);
            doc.meta.extra.remove("per_texture_uv_size");
            doc.extensions.remove("per_texture_uv_size");
        }
        doc.extensions.insert("multi_file_ruleset".into(), json!("textures"));
        assert!(has_per_texture_uv_rules(&doc));
        assert_eq!(texture_preview_sources(&doc), vec![None]);
    }


    #[test]
    fn new_bone_parent_origin_and_atomic_core_document_are_consistent() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        // This test reviews the typed operation the Add Bone Tauri command invokes.
        let parent = doc.bones[0].uuid.clone();
        let parent_origin = doc.bones[0].origin.unwrap_or([0.0, 0.0, 0.0]);
        let id = "00000000-0000-4000-8000-000000000099";
        let mut session = EditorSession::from_document(doc.clone()).unwrap();
        session.apply(0, &[EditOperation::AddBone {
            bone: Bone {
                uuid: id.into(), name: "bone".into(),
                origin: Some(parent_origin), extra: Map::new(),
            },
            parent_uuid: Some(parent),
        }]).unwrap();
        assert_eq!(session.document().bones.last().unwrap().origin, Some(parent_origin));
        assert_eq!(session.document().bones.last().unwrap().name, "bone");
        session.undo(1).unwrap();
        assert_eq!(session.document(), &doc);
    }


    #[test]
    fn created_animation_rotation_keyframe_projects_without_mutating_model() {
        let mut session = EditorSession::open(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let anim = "00000000-0000-4000-8000-000000000320";
        let key = "00000000-0000-4000-8000-000000000321";
        let bone = "00000000-0000-4000-8000-000000000001";
        session.apply(0, &[
            EditOperation::CreateAnimation {
                uuid: anim.into(), name: "animation.new".into(), length: 2.0,
            },
            EditOperation::AddBoneRotationKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.into(),
                keyframe_uuid: key.into(), time: 0.5, rotation: [0.0, 90.0, 0.0],
            },
        ]).unwrap();
        let original = session.document().clone();
        let store = EditorStore {
            epoch: 3,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.animation_count, 1);
        assert_eq!(snapshot.animations.len(), 1);
        assert_eq!(snapshot.animations[0].uuid, anim);
        assert_eq!(snapshot.animations[0].rotation_keyframes[0].uuid, key);
        assert_eq!(snapshot.animations[0].rotation_keyframes[0].rotation, [0.0, 90.0, 0.0]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
    }


    // SOURCE_AUTHORED_NOT_RUN: timeline markers are positional annotations,
    // not audio/particle execution or generated persistent marker UUIDs.
    #[test]
    fn animation_timeline_markers_project_from_rust_without_fake_playback() {
        let mut session=EditorSession::open(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007621";
        let key="00000000-0000-4000-8000-000000007622";
        let bone="00000000-0000-4000-8000-000000000001";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"walk".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:key.into(),channel:"rotation".into(),
                time:0.5,value:[0.0,30.0,0.0],
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:0.5,
                name:"left_foot_contact".into(),color:6,
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:1.5,
                name:"right_foot_contact".into(),color:3,
            },
        ]).unwrap();
        let source=session.document().clone();
        let views=animation_views(&source);
        assert_eq!(views.len(),1);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),1);
        assert_eq!(views[0].markers.len(),2);
        assert_eq!(views[0].markers[0].name,"left_foot_contact");
        assert_eq!(views[0].markers[0].time,0.5);
        assert_eq!(views[0].markers[1].color,3);
        let store=EditorStore {
            epoch:2,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animations[0].markers.len(),2);
        assert_eq!(snapshot.animations[0].rotation_keyframes.len(),1);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&source);
        let mut imported=source.clone();
        imported.animation_assets[0]["markers"][0]["color"]=json!(10);
        let unsupported=animation_views(&imported);
        assert!(!unsupported[0].preview_supported);
        assert!(unsupported[0].markers.is_empty());
        assert!(unsupported[0].transform_keyframes.is_empty());
        assert_eq!(source.animation_assets[0]["markers"][0]["color"],json!(6));
    }

    // SOURCE_AUTHORED_NOT_RUN: an admitted sound/particle event is saved
    // metadata, not a playable sound or a particle rendered by the preview.
    // Tauri must refuse partial visual-only "supported" playback.
    #[test]
    fn animation_effect_markers_do_not_fake_supported_tauri_playback() {
        let mut session=EditorSession::open(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007551";
        let rot="00000000-0000-4000-8000-000000007552";
        let sound="00000000-0000-4000-8000-000000007553";
        let bone="00000000-0000-4000-8000-000000000001";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"attack".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:rot.into(),channel:"rotation".into(),
                time:0.5,value:[0.0,45.0,0.0],
            },
        ]).unwrap();
        assert!(animation_views(session.document())[0].preview_supported);
        session.apply(1,&[EditOperation::AddAnimationEffectEvent {
            animation_uuid:anim.into(),keyframe_uuid:sound.into(),
            channel:"sound".into(),time:0.5,
            points:vec![lazydesigner::authoring::AnimationEffectPoint {
                effect:"robot.attack".into(),locator:None,bind_to_actor:None,
            }],
        }]).unwrap();
        let saved=session.document().clone();
        let views=animation_views(&saved);
        assert_eq!(views.len(),1);
        assert!(!views[0].preview_supported);
        assert!(views[0].rotation_keyframes.is_empty());
        assert!(views[0].transform_keyframes.is_empty());
        assert_eq!(saved.animation_assets[0]["animators"]["effects"]["keyframes"][0]
            ["data_points"][0]["effect"],json!("robot.attack"));
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animations.len(),1);
        assert!(!snapshot.animations[0].preview_supported);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&saved);
    }

    // SOURCE_AUTHORED_NOT_RUN: a single Rust Clone Clip operation is
    // discoverable by the existing Tauri Animation snapshot without
    // rebuilding per-Bone keyframe controls or altering the preview owner.
    #[test]
    fn duplicated_animation_clip_projects_as_distinct_tauri_animation() {
        let mut session=EditorSession::open(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007401";
        let copy="00000000-0000-4000-8000-000000007402";
        let bone="00000000-0000-4000-8000-000000000001";
        let key="00000000-0000-4000-8000-000000007403";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"idle".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:key.into(),channel:"rotation".into(),
                time:1.0,value:[0.0,90.0,0.0],
            },
        ]).unwrap();
        let previous=session.document().clone();
        session.apply(1,&[EditOperation::DuplicateAnimationClip {
            source_uuid:anim.into(),new_uuid:copy.into(),new_name:"attack".into(),
        }]).unwrap();
        let saved=session.document().clone();
        let views=animation_views(&saved);
        assert_eq!(views.len(),2);
        assert!(views.iter().all(|view|view.preview_supported));
        assert_eq!(views[0].name,"idle");
        assert_eq!(views[1].name,"attack");
        assert_eq!(views[0].uuid,anim);
        assert_eq!(views[1].uuid,copy);
        assert_eq!(views[0].transform_keyframes.len(),1);
        assert_eq!(views[1].transform_keyframes.len(),1);
        assert_eq!(views[0].transform_keyframes[0].uuid,key);
        assert_ne!(views[1].transform_keyframes[0].uuid,key);
        assert_eq!(views[0].transform_keyframes[0].value,
            views[1].transform_keyframes[0].value);
        assert_eq!(views[0].transform_keyframes[0].interpolation,
            views[1].transform_keyframes[0].interpolation);
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animation_count,2);
        assert_eq!(snapshot.animations.len(),2);
        assert_eq!(snapshot.animations[1].name,"attack");
        assert_eq!(snapshot.animations[1].length,2.0);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&saved);
        assert_eq!(saved.animation_assets[0],previous.animation_assets[0]);
    }

    // SOURCE_AUTHORED_NOT_RUN: Tauri projects only validated numeric Bezier
    // handles from the one Rust document, never sampled or inferred curves.
    #[test]
    fn animation_projection_bezier_handles_and_unsafe_imports() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone="00000000-0000-4000-8000-000000000001";
        let clip="00000000-0000-4000-8000-000000009921";
        let key="00000000-0000-4000-8000-000000009922";
        doc.animation_assets.push(json!({
            "uuid":clip,"name":"bezier","loop":"once","length":2.0,
            "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone]=json!({
            "name":"root_bone","type":"bone","keyframes":[
                {
                    "uuid":key,"channel":"position","time":0.0,
                    "interpolation":"bezier",
                    "data_points":[{"x":"0","y":"0","z":"0"}],
                    "bezier_linked":false,
                    "bezier_left_time":[-0.25,-0.25,-0.25],
                    "bezier_left_value":[0,0,0],
                    "bezier_right_time":[0.5,0.5,0.5],
                    "bezier_right_value":[8,0,0]
                },
                {
                    "uuid":"00000000-0000-4000-8000-000000009923",
                    "channel":"position","time":2.0,
                    "interpolation":"linear",
                    "data_points":[{"x":"10","y":"0","z":"0"}]
                }
            ]
        });
        let before=doc.clone();
        let views=animation_views(&doc);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),2);
        assert_eq!(views[0].transform_keyframes[0].interpolation,"bezier");
        let handle=views[0].transform_keyframes[0].bezier.as_ref().unwrap();
        assert!(!handle.linked);
        assert_eq!(handle.right_time,[0.5;3]);
        assert_eq!(handle.right_value,[8.0,0.0,0.0]);
        assert!(views[0].transform_keyframes[1].bezier.is_none());
        let json=serde_json::to_value(&views[0].transform_keyframes[0]).unwrap();
        assert_eq!(json["bezier"]["rightTime"],json!([0.5,0.5,0.5]));
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session:EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None,source_sha:None,saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert!(snapshot.animations[0].preview_supported);
        assert!(snapshot.animations[0].transform_keyframes[0].bezier.is_some());
        assert_eq!(store.active.as_ref().unwrap().session.document(),&before);

        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"]=json!([-0.5,0.5,0.5]);
        let refused=animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_value"]=Value::Null;
        assert!(!animation_views(&doc)[0].preview_supported);

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][1]
            ["bezier_linked"]=json!(false);
        assert!(!animation_views(&doc)[0].preview_supported);

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"]=json!([1.9,1.9,1.9]);
        doc.animation_assets[0]["animators"][bone]["keyframes"][1]
            ["interpolation"]=json!("bezier");
        for (field,value) in [
            ("bezier_linked",json!(false)),
            ("bezier_left_time",json!([-1.9,-1.9,-1.9])),
            ("bezier_left_value",json!([0,0,0])),
            ("bezier_right_time",json!([0.1,0.1,0.1])),
            ("bezier_right_value",json!([0,0,0])),
        ] {
            doc.animation_assets[0]["animators"][bone]["keyframes"][1][field]=value;
        }
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(before.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"],json!([0.5,0.5,0.5]));
    }

    // SOURCE_AUTHORED_NOT_RUN: step is carried as explicit saved metadata
    // from Rust to Tauri. No unverified keyframe is presented as a pose.
    #[test]
    fn animation_projection_keeps_step_interpolation_and_refuses_unsupported_modes() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = "00000000-0000-4000-8000-000000000001";
        let anim = "00000000-0000-4000-8000-000000009991";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"step_pose", "loop":"once", "length":2.0,
            "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "type":"bone", "name":"root_bone", "keyframes":[
                {"uuid":"p0","channel":"position","time":0.0,
                 "interpolation":"step",
                 "data_points":[{"x":"0","y":"0","z":"0"}]},
                {"uuid":"p2","channel":"position","time":2.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"4","y":"0","z":"0"}]},
                {"uuid":"r0","channel":"rotation","time":0.0,
                 "interpolation":"step",
                 "data_points":[{"x":"0","y":"45","z":"0"}]}
            ]
        });
        let original = doc.clone();
        let projected = animation_views(&doc);
        assert!(projected[0].preview_supported);
        assert_eq!(projected[0].transform_keyframes.len(),3);
        assert_eq!(projected[0].transform_keyframes[0].interpolation,"step");
        assert_eq!(projected[0].transform_keyframes[1].interpolation,"linear");
        assert_eq!(projected[0].transform_keyframes[2].interpolation,"step");
        let store = EditorStore {
            epoch:1,active:Some(ActiveModel {
                session:EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None,source_sha:None,saved_canonical_sha:None,dirty:true,
            }),
        };
        let view = project(&store).unwrap();
        assert_eq!(view.animations[0].transform_keyframes[0].interpolation,"step");
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"] = json!("catmullrom");
        let curved = animation_views(&doc);
        assert!(curved[0].preview_supported);
        assert_eq!(curved[0].transform_keyframes[0].interpolation,"catmullrom");
        // Bezier without complete saved numeric handles remains opaque.
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"] = json!("bezier");
        let refused = animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());
        assert_eq!(original.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"],json!("step"));
    }

    // Authored-only Rust/Tauri regression; native playback remains held.
    #[test]
    fn transform_preview_projects_position_scale_and_rotation_without_mutation() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = "00000000-0000-4000-8000-000000000001";
        let anim = "00000000-0000-4000-8000-000000009701";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"walking", "length":2.0,
            "loop":"once", "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "type":"bone", "name":"root_bone", "keyframes":[
                {"uuid":"k-rotation", "channel":"rotation", "time":0.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"0","y":"45","z":"0"}]},
                {"uuid":"k-position", "channel":"position", "time":1.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"2","y":"0","z":"1"}]},
                {"uuid":"k-scale", "channel":"scale", "time":2.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"1","y":"1.5","z":"1"}]}
            ]
        });
        let original = doc.clone();
        let views = animation_views(&doc);
        assert_eq!(views.len(),1);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),3);
        assert_eq!(views[0].rotation_keyframes.len(),1);
        assert_eq!(views[0].transform_keyframes[1].channel,"position");
        assert_eq!(views[0].transform_keyframes[2].value,[1.0,1.5,1.0]);
        assert_eq!(doc,original);
        let store = EditorStore {
            epoch:1, active:Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None, source_sha:None,
                saved_canonical_sha:None, dirty:true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.animations[0].transform_keyframes.len(),3);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&doc);

        doc.animation_assets[0]["animators"][bone]["keyframes"][2]
            ["data_points"][0]["y"] = json!("-1");
        let refused = animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());
        assert!(refused[0].rotation_keyframes.is_empty());
    }

    // Authored regression only. Windows/Tauri preview NOT_EXECUTED.
    #[test]
    fn animation_projection_recognizes_loop_hold_and_fails_closed_on_unknown_modes() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim = "00000000-0000-4000-8000-000000009741";
        let bone = "00000000-0000-4000-8000-000000000001";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"looping", "loop":"once",
            "length":2.0, "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name":"root_bone", "type":"bone", "keyframes":[{
                "uuid":"00000000-0000-4000-8000-000000009742",
                "channel":"rotation", "time":1.0, "interpolation":"linear",
                "data_points":[{"x":"0","y":"45","z":"0"}]
            }]
        });
        let original = doc.clone();
        for mode in ["once", "loop", "hold"] {
            doc.animation_assets[0]["loop"] = json!(mode);
            let views = animation_views(&doc);
            assert_eq!(views.len(), 1);
            assert_eq!(views[0].loop_mode, mode);
            assert!(views[0].preview_supported);
            assert_eq!(views[0].transform_keyframes.len(), 1);
        }
        doc.animation_assets[0]["length"] = json!(0.0);
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0]["length"] = json!(2.0);
        doc.animation_assets[0]["loop"] = json!("bounce");
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(animation_views(&doc)[0].loop_mode, "unsupported");
        doc.animation_assets[0]["loop"] = json!(42);
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(animation_views(&doc)[0].loop_mode, "unsupported");
        doc = original;
        doc.animation_assets[0]["loop"] = json!("loop");
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["data_points"][0]["x"] = json!("query.head_yaw");
        assert!(!animation_views(&doc)[0].preview_supported);
        assert!(animation_views(&doc)[0].transform_keyframes.is_empty());
    }

    #[test]
    fn pose_preview_requires_entire_animation_to_be_linear_and_static() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let id = "00000000-0000-4000-8000-000000000320";
        let bone = "00000000-0000-4000-8000-000000000001";
        doc.animation_assets.push(json!({
            "uuid": id, "name": "rotation", "loop": "once", "length": 1.0,
            "animators": {}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name": "root_bone", "type": "bone", "keyframes": [
                {"uuid": "00000000-0000-4000-8000-000000000321",
                 "channel": "rotation", "time": 0.0, "interpolation": "linear",
                 "data_points": [{"x": "0", "y": "0", "z": "0"}]}
            ]
        });
        let view = animation_views(&doc);
        assert!(view[0].preview_supported);
        let before = doc.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["interpolation"] = json!("bezier");
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["interpolation"] = json!("linear");
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["data_points"][0]["y"] = json!("query.anything");
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0] = before.animation_assets[0].clone();
        doc.animation_assets[0]["animators"]["effects"] = json!({"keyframes":[]});
        assert!(!animation_views(&doc)[0].preview_supported);
    }


    // Authored source regression; local/native playback remains NOT_EXECUTED.
    #[test]
    fn animation_projection_refuses_invalid_axes_or_ambiguous_keyframe_ids() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim = "00000000-0000-4000-8000-000000009201";
        let bone = "00000000-0000-4000-8000-000000000001";
        let key = "00000000-0000-4000-8000-000000009202";
        doc.animation_assets.push(json!({
            "uuid": anim, "name": "idle", "loop": "once", "length": 2.0,
            "animators": {}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name": "root_bone", "type": "bone", "keyframes": [
                {"uuid": key, "channel": "rotation", "time": 0.0,
                 "interpolation": "linear",
                 "data_points": [{"x": "0", "y": "0", "z": "0"}]}
            ]
        });
        let before = doc.clone();
        let admitted = animation_views(&doc);
        assert!(admitted[0].preview_supported);
        assert_eq!(admitted[0].rotation_keyframes.len(), 1);
        assert_eq!(doc, before);

        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["data_points"][0]["x"] = json!("100001");
        let oversized = animation_views(&doc);
        assert!(!oversized[0].preview_supported);
        assert!(oversized[0].rotation_keyframes.is_empty());

        doc = before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"]
            .as_array_mut().unwrap().push(json!({
                "uuid": key, "channel": "rotation", "time": 1.0,
                "interpolation": "linear",
                "data_points": [{"x": "0", "y": "20", "z": "0"}]
            }));
        let duplicate = animation_views(&doc);
        assert!(!duplicate[0].preview_supported);
        assert!(duplicate[0].rotation_keyframes.is_empty());

        doc = before.clone();
        doc.animation_assets[0]["animators"][bone]["name"] = json!("renamed_elsewhere");
        let mismatched = animation_views(&doc);
        assert!(!mismatched[0].preview_supported);
        assert!(mismatched[0].rotation_keyframes.is_empty());
        // Imported unsupported animation data remains in the Rust document.
        assert_eq!(doc.animation_assets[0]["animators"][bone]["name"],
            json!("renamed_elsewhere"));

        doc = before.clone();
        let conflicting_clip = doc.animation_assets[0].clone();
        doc.animation_assets.push(conflicting_clip);
        let ambiguous = animation_views(&doc);
        assert_eq!(ambiguous.len(), 2);
        assert!(ambiguous.iter().all(|view|
            !view.preview_supported && view.rotation_keyframes.is_empty()));
    }

    // SOURCE-AUTHORED_NOT_RUN: indexed Bone labels preserve unknown-track
    // rejection and exact first-match behavior for imported malformed data.
    #[test]
    fn indexed_bone_name_projection_preserves_first_identity_and_unknowns() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../fixtures/bedrock-basic.bbmodel")).unwrap();
        let first = doc.bones.first().unwrap().clone();
        let names = indexed_bone_names(&doc);
        assert_eq!(names.get(first.uuid.as_str()).copied(),
            Some(first.name.as_str()));
        assert_eq!(names.get("unmatched-bone").copied(), None);
        assert_eq!(names.len(), doc.bones.len());
        let before = doc.clone();
        let mut duplicate = first.clone();
        duplicate.name = "conflicting-imported-label".into();
        doc.bones.push(duplicate);
        let ambiguous = indexed_bone_names(&doc);
        assert_eq!(ambiguous.get(first.uuid.as_str()).copied(),
            Some(first.name.as_str()));
        doc.bones.pop();
        assert_eq!(doc, before);
    }

    // SOURCE-AUTHORED_NOT_RUN: microsecond-bucket indexes are only candidate
    // filters; the exact 1e-6 threshold and Bone/channel identity still win.
    #[test]
    fn indexed_animation_preview_time_refuses_near_duplicates_only_per_track() {
        let mut seen: HashMap<(&str, &str, u64), Vec<f64>> = HashMap::new();
        assert!(register_preview_time(&mut seen, "root", "rotation", 1.0));
        assert!(!register_preview_time(&mut seen, "root", "rotation",
            1.0 + 0.5e-6));
        assert!(!register_preview_time(&mut seen, "root", "rotation",
            1.0 - 0.5e-6));
        assert!(register_preview_time(&mut seen, "root", "rotation",
            1.0 + 2.1e-6));
        assert!(register_preview_time(&mut seen, "root", "position", 1.0));
        assert!(register_preview_time(&mut seen, "other", "rotation", 1.0));
        assert!(register_preview_time(&mut seen, "root", "rotation", 0.0));
        assert!(register_preview_time(&mut seen, "root", "rotation", 3600.0));
        assert!(!register_preview_time(&mut seen, "root", "rotation", 3600.0));
    }

    #[test]
    fn imported_png_paint_adoption_projection_does_not_mutate_assets() {
        let mut doc = AuthoringDocument::new_bedrock("UV import", "uv_import").unwrap();
        let texture = crate::authoring::paint_texture_adoptable;
        let mut session = EditorSession::from_document(doc.clone()).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000000152".into(),
            name: "paint.png".into(),
        }]).unwrap();
        doc = session.document().clone();
        doc.texture_assets[0].as_object_mut().unwrap().remove("paint_owner");
        let original = doc.clone();
        assert!(texture(&doc.texture_assets[0], 128, 128));
        let store = EditorStore {
            epoch: 7,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let preview = project(&store).unwrap();
        assert_eq!(preview.paint_editable_textures, vec![false]);
        assert_eq!(preview.paint_adoptable_textures, vec![true]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        let mut unsupported = original;
        unsupported.texture_assets[0]["vendor"] = json!({"preserve":true});
        assert!(!texture(&unsupported.texture_assets[0], 128, 128));
    }


    #[test]
    fn texture_uuid_projection_tracks_exact_import_identity_and_keeps_opaque_entries() {
        let mut doc = AuthoringDocument::new_bedrock("Textures", "textures").unwrap();
        let id = "00000000-0000-4000-8000-000000000170";
        doc.texture_assets = vec![
            json!({"uuid":id,"name":"import.png"}),
            json!({"name":"legacy-uuidless.png"}),
        ].into();
        let original = doc.clone();
        let store = EditorStore {
            epoch: 1,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.texture_uuids, vec![Some(id.into()), None]);
        assert_eq!(snapshot.texture_names, vec!["import.png", "legacy-uuidless.png"]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
    }


    #[test]
    fn png_export_projection_follows_rust_core_and_preserves_model() {
        let uuid = "00000000-0000-4000-8000-000000000801";
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Paint", "paint").unwrap()
        ).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: uuid.into(), name: "atlas.png".into(),
        }]).unwrap();
        let original = session.document().clone();
        let store = EditorStore {
            epoch: 10,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        assert_eq!(project(&store).unwrap().paint_exportable_textures, vec![true]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        let mut opaque = original;
        opaque.texture_assets[0]["layers"] = json!([{"name":"opaque"}]);
        let store = EditorStore {
            epoch: 11,
            active: Some(ActiveModel {
                session: EditorSession::from_document(opaque).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert_eq!(project(&store).unwrap().paint_exportable_textures, vec![false]);
    }

    // SOURCE-AUTHORED_NOT_RUN: combining eligibility evaluation must preserve
    // scalar Core gates and all three independent GUI flags for mixed saved
    // Texture metadata, including missing UUIDs and unsupported UV rules.
    #[test]
    fn paint_eligibility_batch_matches_scalar_gates_and_fail_closed_rules() {
        let mut doc = AuthoringDocument::new_bedrock("Eligibility", "eligibility").unwrap();
        doc.resolution.width = 16;
        doc.resolution.height = 16;
        let png = png_candidate(16, 16);
        let owned = json!({
            "uuid":"00000000-0000-4000-8000-000000000851",
            "name":"owned.png", "source":png, "internal":true,
            "wrap_mode":"limited", "render_mode":"default",
            "render_sides":"double", "paint_owner":"lazydesigner-rgba8-v1",
        });
        let mut imported = owned.clone();
        imported["uuid"] = json!("00000000-0000-4000-8000-000000000852");
        imported.as_object_mut().unwrap().remove("paint_owner");
        let mut uuidless = imported.clone();
        uuidless.as_object_mut().unwrap().remove("uuid");
        let mut opaque = imported.clone();
        opaque["uuid"] = json!("00000000-0000-4000-8000-000000000853");
        opaque["layers"] = json!([{"name":"retain"}]);
        let mut invalid_png = owned.clone();
        invalid_png["uuid"] = json!("00000000-0000-4000-8000-000000000854");
        invalid_png["source"] = json!("not-an-embedded-png");
        doc.texture_assets = vec![owned, imported, uuidless, opaque, invalid_png].into();
        let original = doc.clone();
        let make_snapshot = |doc: &AuthoringDocument| {
            let store = EditorStore {
                epoch: 37, active: Some(ActiveModel {
                    session: EditorSession::from_document(doc.clone()).unwrap(),
                    source_path: None, source_sha: None,
                    saved_canonical_sha: None, dirty: false,
                }),
            };
            project(&store).unwrap()
        };
        let view = make_snapshot(&doc);
        assert_eq!(view.paint_editable_textures, vec![true, false, false, false, true]);
        assert_eq!(view.paint_adoptable_textures, vec![false, true, true, false, false]);
        assert_eq!(view.paint_exportable_textures, vec![true, true, false, false, false]);
        for (index, texture) in doc.texture_assets.iter().enumerate() {
            assert_eq!(view.paint_editable_textures[index],
                paint_texture_editable(texture));
            assert_eq!(view.paint_adoptable_textures[index],
                paint_texture_adoptable(texture, 16, 16));
            assert_eq!(view.paint_exportable_textures[index],
                paint_texture_exportable(&doc, index));
        }
        assert_eq!(doc, original);

        doc.extensions.insert("multi_file_ruleset".into(),
            json!("unreviewed_ruleset"));
        let unsupported = make_snapshot(&doc);
        assert_eq!(unsupported.paint_editable_textures, view.paint_editable_textures);
        assert!(unsupported.paint_adoptable_textures.iter().all(|v| !v));
        assert!(unsupported.paint_exportable_textures.iter().all(|v| !v));
        assert!(unsupported.texture_preview_sources.iter().all(Option::is_none));
        for index in 0..doc.texture_assets.len() {
            assert!(!paint_texture_exportable(&doc, index));
        }
    }

    #[test]
    fn paint_addition_projection_follows_shared_rust_admission_gate() {
        let empty = AuthoringDocument::new_bedrock("Paint", "paint").unwrap();
        let store = EditorStore {
            epoch: 4,
            active: Some(ActiveModel {
                session: EditorSession::from_document(empty.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(project(&store).unwrap().paint_texture_addable);

        let mut per_texture = empty;
        per_texture.extensions.insert("per_texture_uv_size".into(), json!(true));
        let store = EditorStore {
            epoch: 5,
            active: Some(ActiveModel {
                session: EditorSession::from_document(per_texture).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(!project(&store).unwrap().paint_texture_addable);
    }

    #[test]
    fn empty_atlas_editability_projection_changes_when_model_has_cubes() {
        let document = AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap();
        assert!(can_set_empty_atlas_resolution(&document));
        let store = EditorStore {
            epoch: 9,
            active: Some(ActiveModel {
                session: EditorSession::from_document(document.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(project(&store).unwrap().atlas_resolution_editable);
        let mut with_cube = document;
        with_cube.texture_assets.push(json!({"name": "existing"}));
        assert!(!can_set_empty_atlas_resolution(&with_cube));
    }

}
