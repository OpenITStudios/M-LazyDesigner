//! Tauri adapter for the one authoritative Rust Bedrock document session.
//! This module never implements its own geometry, history or .bbmodel codec.

use crate::desktop_error::DesktopError;
use lazydesigner::authoring::{
    storage, sha256, paint_texture_editable, paint_texture_adoptable, paint_texture_exportable,
    export_paint_png, export_bedrock_geometry, export_bedrock_animations,
    bedrock_animation_curve_fidelity,
    has_per_texture_uv_rules, can_set_empty_atlas_resolution,
    can_add_paint_texture, parse_saved_bezier_handles, valid_track_segments,
    saved_timeline_markers, valid_saved_markers, SavedTimelineMarker,
    BezierKeyframeHandles,
    AuthoringDocument, Bone, Cube, EditOperation, EditorSession,
    OutlinerNode, MAX_MODEL_BYTES, MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES, MAX_PAINT_TEXTURES,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use rfd::FileDialog;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

#[derive(Default)]
pub struct EditorState {
    store: Mutex<EditorStore>,
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
    preview_scope: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaintPngExportReceipt {
    sha256: String,
    byte_count: usize,
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
fn lock(state: &State<'_, EditorState>) -> Result<MutexGuard<'_, EditorStore>, DesktopError> {
    state.store.lock().map_err(|_| failure("RUST_EDITOR_UNAVAILABLE", "Authoring session lock is unavailable."))
}
fn check_epoch(store: &EditorStore, expected: u64) -> Result<(), DesktopError> {
    if store.epoch != expected {
        Err(failure("RUST_EDITOR_SESSION_STALE", "The active model changed. Refresh the editor state before editing."))
    } else {
        Ok(())
    }
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

fn property_vec3(properties: &Map<String, Value>, key: &str) -> [f64; 3] {
    properties.get(key)
        .and_then(|v| serde_json::from_value::<[f64; 3]>(v.clone()).ok())
        .filter(|v| v.iter().all(|n| n.is_finite()))
        .unwrap_or([0.0, 0.0, 0.0])
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
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.len() < 33 ||
        bytes.get(0..8)? != b"\x89PNG\r\n\x1a\n" ||
        bytes.get(8..12)? != [0, 0, 0, 13] ||
        bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
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
fn texture_preview_assets(doc: &AuthoringDocument) -> Vec<Option<(&str, [u32; 2])>> {
    const MAX_PROJECTED_PIXELS: u64 = 4 * 1024 * 1024;
    let mode = preview_uv_mode(doc);
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

fn project_with_preview_reuse(
    store: &EditorStore, known_preview_source_key: Option<&str>,
) -> Option<EditorSnapshot> {
    store.active.as_ref().map(|model| {
        let doc = model.session.document();
        let default_box_uv = doc.meta.box_uv.unwrap_or(false);
        let preview_assets = texture_preview_assets(doc);
        let preview_source_key = preview_source_key(store.epoch, &preview_assets);
        let preview_sources_reused = known_preview_source_key == Some(preview_source_key.as_str());
        let uv_mode = preview_uv_mode(doc);
        let scope_indices = (uv_mode == PreviewUvMode::ScopedAttachable)
            .then(|| texture_scope_indices(doc));
        EditorSnapshot {
            epoch: store.epoch,
            revision: model.session.summary().revision,
            name: doc.extensions.get("name").and_then(Value::as_str)
                .unwrap_or("Untitled Model").to_owned(),
            source_name: model.source_path.as_ref()
                .and_then(|path| path.file_name()).map(|name| name.to_string_lossy().into_owned()),
            dirty: model.dirty,
            can_undo: model.session.can_undo(),
            can_redo: model.session.can_redo(),
            cubes: doc.cubes.iter().map(|cube| CubeView {
                uuid: cube.uuid.clone(),
                name: cube.name.clone().unwrap_or_else(|| "cube".into()),
                from: cube.from,
                to: cube.to,
                origin: cube.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&cube.extra, "rotation"),
                inflate: cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0),
                stretch: cube.extra.get("stretch")
                    .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                    .unwrap_or([1.0, 1.0, 1.0]),
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
            hierarchy: doc.hierarchy.clone(),
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
            paint_editable_textures: doc.texture_assets.iter()
                .map(paint_texture_editable).collect(),
            paint_adoptable_textures: doc.texture_assets.iter().map(|texture|
                !has_per_texture_uv_rules(doc) &&
                paint_texture_adoptable(texture, doc.resolution.width, doc.resolution.height)
            ).collect(),
            paint_exportable_textures: doc.texture_assets.iter().enumerate()
                .map(|(index, _)| paint_texture_exportable(doc, index)).collect(),
            texture_resolution: [doc.resolution.width, doc.resolution.height],
            atlas_resolution_editable: can_set_empty_atlas_resolution(doc),
            paint_texture_addable: can_add_paint_texture(doc),
            animation_count: doc.animation_assets.len(),
            animations: animation_views(doc),
            preview_scope: "UNVERIFIED_EMBEDDED_PNG_SUBSET",
        }
    })
}

fn project(store: &EditorStore) -> Option<EditorSnapshot> {
    project_with_preview_reuse(store, None)
}

fn current_with_preview_reuse(
    store: &EditorStore, known_preview_source_key: Option<&str>,
) -> Result<EditorSnapshot, DesktopError> {
    project_with_preview_reuse(store, known_preview_source_key)
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))
}

fn current(store: &EditorStore) -> Result<EditorSnapshot, DesktopError> {
    current_with_preview_reuse(store, None)
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

#[tauri::command]
pub fn rust_editor_snapshot(state: State<'_, EditorState>) -> Result<Option<EditorSnapshot>, DesktopError> {
    Ok(project(&lock(&state)?))
}

#[tauri::command]
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
    let mut store = lock(&state)?;
    check_epoch(&store, expected_epoch)?;
    check_discard(&store, discard)?;
    store.epoch += 1;
    store.active = Some(ActiveModel {
        session, source_path: None, source_sha: None,
        saved_canonical_sha: None, dirty: true,
    });
    current(&store)
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
    let canonical_sha = sha256(&session.export().map_err(model_failure)?);
    let sha = sha256(&bytes);
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
    current(&guard).map(Some)
}

#[tauri::command]
pub fn rust_editor_apply(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    operations: Vec<EditOperation>,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.apply(expected_revision, &operations).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
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
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.apply(expected_revision, &[EditOperation::ImportPaintTexture {
        uuid: create_uuid(), name: filename, source,
    }]).map_err(model_failure)?;
    refresh_dirty(active);
    current(&guard).map(Some)
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

    let guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_ref()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "The model changed during PNG export selection."));
    }
    if let Some(ref source) = active.source_path {
        storage::same_directory(source, &path).map_err(model_failure)?;
        let expected = active.source_sha.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_SOURCE_UNKNOWN", "The original source identity is missing."))?;
        let current = storage::read_bounded(source, MAX_MODEL_BYTES).map_err(model_failure)?;
        if sha256(&current) != *expected {
            return Err(failure("RUST_EDITOR_SOURCE_CHANGED", "The original model changed on disk; no PNG was exported."));
        }
    }
    let bytes = export_paint_png(active.session.document(), &texture_uuid).map_err(model_failure)?;
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

#[tauri::command]
pub fn rust_editor_add_cube(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    parent_uuid: Option<String>,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before adding a Cube."));
    }
    let mut operations = Vec::new();
    let parent = match parent_uuid {
        Some(id) => id,
        None => match active.session.document().bones.first() {
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
            }
        }
    };
    let faces = new_cube_faces(&active.session.document().texture_assets);
    operations.push(EditOperation::AddCube {
        cube: Cube {
            uuid: create_uuid(), kind: "cube".into(), name: Some("cube".into()),
            from: [-1.0, 0.0, -1.0], to: [1.0, 2.0, 1.0],
            origin: Some([0.0, 0.0, 0.0]), uv_offset: None,
            faces, extra: Map::new(),
        },
        bone_uuid: parent,
    });
    active.session.apply(expected_revision, &operations).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
}



#[tauri::command]
pub fn rust_editor_duplicate_cube(
    state: State<'_, EditorState>,
    expected_epoch: u64, expected_revision: u64, source_uuid: String,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut store = lock(&state)?;
    check_epoch(&store, expected_epoch)?;
    let active = store.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    // This is the same atomic, revision-checked Rust operation exposed to CLI.
    active.session.apply(expected_revision, &[EditOperation::DuplicateCube {
        source_uuid, new_uuid: create_uuid(),
    }]).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&store, known_preview_source_key.as_deref())
}

#[tauri::command]
pub fn rust_editor_add_bone(
    state: State<'_, EditorState>,
    expected_epoch: u64,
    expected_revision: u64,
    parent_uuid: Option<String>,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "Refresh the model before adding a Bone."));
    }
    let origin = if let Some(ref id) = parent_uuid {
        active.session.document().bones.iter().find(|bone| bone.uuid == *id)
            .ok_or_else(|| failure("BONE_PARENT_NOT_FOUND", "Select an existing parent Bone."))?
            .origin.unwrap_or([0.0, 0.0, 0.0])
    } else { [0.0, 0.0, 0.0] };
    active.session.apply(expected_revision, &[EditOperation::AddBone {
        bone: Bone {
            uuid: create_uuid(), name: "bone".into(),
            origin: Some(origin), extra: Map::new(),
        },
        parent_uuid,
    }]).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
}


#[tauri::command]
pub fn rust_editor_create_animation(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    name: String, length: f64,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.apply(expected_revision, &[EditOperation::CreateAnimation {
        uuid: create_uuid(), name, length,
    }]).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
}

#[tauri::command]
pub fn rust_editor_add_rotation_keyframe(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    animation_uuid: String, bone_uuid: String, time: f64, rotation: [f64; 3],
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.apply(expected_revision, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid, bone_uuid, keyframe_uuid: create_uuid(), time, rotation,
    }]).map_err(model_failure)?;
    refresh_dirty(active);
    current(&guard)
}

#[tauri::command]
pub fn rust_editor_undo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.undo(expected_revision).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
}

#[tauri::command]
pub fn rust_editor_redo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
    known_preview_source_key: Option<String>,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.redo(expected_revision).map_err(model_failure)?;
    refresh_dirty(active);
    current_with_preview_reuse(&guard, known_preview_source_key.as_deref())
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

    let guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_ref()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "The model changed during geometry export selection."));
    }
    if let Some(ref source) = active.source_path {
        storage::same_directory(source, &path).map_err(model_failure)?;
        let expected = active.source_sha.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_SOURCE_UNKNOWN", "The original source identity is missing."))?;
        let source_bytes = storage::read_bounded(source, MAX_MODEL_BYTES).map_err(model_failure)?;
        if sha256(&source_bytes) != *expected {
            return Err(failure("RUST_EDITOR_SOURCE_CHANGED", "The original model changed on disk; no geometry was exported."));
        }
    }
    let bytes = export_bedrock_geometry(active.session.document()).map_err(model_failure)?;
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

    let guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_ref()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "The model changed during animation export selection."));
    }
    if let Some(ref source) = active.source_path {
        storage::same_directory(source, &path).map_err(model_failure)?;
        let expected = active.source_sha.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_SOURCE_UNKNOWN", "The original source identity is missing."))?;
        let source_bytes = storage::read_bounded(source, MAX_MODEL_BYTES).map_err(model_failure)?;
        if sha256(&source_bytes) != *expected {
            return Err(failure("RUST_EDITOR_SOURCE_CHANGED", "The original model changed on disk; no animations were exported."));
        }
    }
    let bytes = export_bedrock_animations(active.session.document()).map_err(model_failure)?;
    storage::publish_new_animation(&path, &bytes, MAX_MODEL_BYTES).map_err(model_failure)?;
    Ok(Some(AnimationExportReceipt {
        sha256: sha256(&bytes), byte_count: bytes.len(),
        curve_fidelity: bedrock_animation_curve_fidelity(active.session.document()),
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

    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    if active.session.summary().revision != expected_revision {
        return Err(failure("RUST_EDITOR_REVISION_STALE", "Model changed while the Save Copy dialog was open."));
    }
    if let Some(ref source) = active.source_path {
        storage::same_directory(source, &path).map_err(model_failure)?;
        let expected = active.source_sha.as_ref()
            .ok_or_else(|| failure("RUST_EDITOR_SOURCE_UNKNOWN", "The original source identity is missing."))?;
        let actual = storage::read_bounded(source, MAX_MODEL_BYTES).map_err(model_failure)?;
        if sha256(&actual) != *expected {
            return Err(failure("RUST_EDITOR_SOURCE_CHANGED", "The original model changed on disk; no copy was written."));
        }
    }
    let bytes = active.session.export().map_err(model_failure)?;
    storage::publish_new(&path, &bytes, MAX_MODEL_BYTES).map_err(model_failure)?;
    let saved_hash = sha256(&bytes);
    active.source_sha = Some(saved_hash.clone());
    active.saved_canonical_sha = Some(saved_hash);
    active.source_path = Some(path);
    active.dirty = false;
    current(&guard).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        ];
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
        ];
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
        ];
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
