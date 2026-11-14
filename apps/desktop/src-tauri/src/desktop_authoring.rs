//! Tauri adapter for the one authoritative Rust Bedrock document session.
//! This module never implements its own geometry, history or .bbmodel codec.

use crate::desktop_error::DesktopError;
use lazydesigner::authoring::{
    storage, sha256, paint_texture_editable, AuthoringDocument, Bone, Cube, EditOperation, EditorSession,
    OutlinerNode, MAX_MODEL_BYTES,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use rfd::FileDialog;
use serde::Serialize;
use serde_json::{json, Map, Value};
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
    source_sha: Option<String>,
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
    box_uv: bool,
    uv_offset: [f64; 2],
    auto_uv: u8,
    color: usize,
    faces: Map<String, Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoneView {
    uuid: String,
    name: String,
    origin: [f64; 3],
    rotation: [f64; 3],
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
    texture_preview_sources: Vec<Option<String>>,
    texture_preview_sides: Vec<Option<&'static str>>,
    paint_editable_textures: Vec<bool>,
    texture_resolution: [u32; 2],
    animation_count: usize,
    preview_scope: &'static str,
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
fn embedded_png_preview_candidate(texture: &Value) -> Option<(String, u32, u32)> {
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
    Some((source.to_owned(), width, height))
}

fn embedded_png_preview_source(texture: &Value) -> Option<String> {
    embedded_png_preview_candidate(texture).map(|(source, _, _)| source)
}

fn texture_preview_sources(doc: &AuthoringDocument) -> Vec<Option<String>> {
    // Bound *decoded* aggregate exposure as well as the encoded data URI.
    // Compression alone cannot authorize dozens of large GPU textures.
    const MAX_PROJECTED_PIXELS: u64 = 4 * 1024 * 1024;
    const MAX_TEXTURES: usize = 16;
    let ruleset = doc.extensions.get("multi_file_ruleset");
    let per_texture = ruleset.is_some_and(|value| match value {
        Value::String(name) => !name.is_empty(),
        _ => true,
    }) || doc.extensions.get("per_texture_uv_size") == Some(&Value::Bool(true)) ||
        doc.meta.extra.get("per_texture_uv_size") == Some(&Value::Bool(true));
    let mut remaining_source_bytes = 4 * 1024 * 1024;
    let mut remaining_pixels = MAX_PROJECTED_PIXELS;
    let expected_width = doc.resolution.width;
    let expected_height = doc.resolution.height;
    let mut admitted = 0usize;
    doc.texture_assets.iter().map(|texture| {
        if per_texture || admitted >= MAX_TEXTURES { return None; }
        let (source, width, height) = embedded_png_preview_candidate(texture)?;
        // This renderer uses project-level UV coordinates. If the PNG has
        // another size or declares another UV grid, showing it would imply
        // false UV correspondence. Preserve the asset; omit only its preview.
        if width != expected_width || height != expected_height ||
            texture.get("uv_width").is_some_and(|value| value.as_u64() != Some(u64::from(expected_width))) ||
            texture.get("uv_height").is_some_and(|value| value.as_u64() != Some(u64::from(expected_height))) {
            return None;
        }
        let pixels = u64::from(width) * u64::from(height);
        if source.len() > remaining_source_bytes || pixels > remaining_pixels { return None; }
        remaining_source_bytes -= source.len();
        remaining_pixels -= pixels;
        admitted += 1;
        Some(source)
    }).collect()
}

fn project(store: &EditorStore) -> Option<EditorSnapshot> {
    store.active.as_ref().map(|model| {
        let doc = model.session.document();
        let default_box_uv = doc.meta.box_uv.unwrap_or(false);
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
                box_uv: cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(default_box_uv),
                uv_offset: cube.uv_offset.unwrap_or([0.0, 0.0]),
                // Validated as 0/1/2 by the single Rust authoring engine.
                auto_uv: cube.extra.get("autouv").and_then(Value::as_f64).unwrap_or(0.0) as u8,
                color: cube.extra.get("color").and_then(Value::as_u64).unwrap_or(0) as usize,
                faces: cube.faces.clone(),
            }).collect(),
            bones: doc.bones.iter().map(|bone| BoneView {
                uuid: bone.uuid.clone(),
                name: bone.name.clone(),
                origin: bone.origin.unwrap_or([0.0, 0.0, 0.0]),
                rotation: property_vec3(&bone.extra, "rotation"),
            }).collect(),
            hierarchy: doc.hierarchy.clone(),
            texture_names: doc.texture_assets.iter().map(|texture| {
                texture.get("name").and_then(Value::as_str).unwrap_or("Unnamed texture").to_owned()
            }).collect(),
            texture_preview_sources: texture_preview_sources(doc),
            texture_preview_sides: doc.texture_assets.iter().map(texture_preview_side).collect(),
            paint_editable_textures: doc.texture_assets.iter()
                .map(paint_texture_editable).collect(),
            texture_resolution: [doc.resolution.width, doc.resolution.height],
            animation_count: doc.animation_assets.len(),
            preview_scope: "UNVERIFIED_EMBEDDED_PNG_SUBSET",
        }
    })
}

fn current(store: &EditorStore) -> Result<EditorSnapshot, DesktopError> {
    project(store).ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))
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
    store.active = Some(ActiveModel { session, source_path: None, source_sha: None, dirty: true });
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
    let sha = sha256(&bytes);
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    check_discard(&guard, discard)?;
    guard.epoch += 1;
    guard.active = Some(ActiveModel {
        session,
        source_path: Some(path),
        source_sha: Some(sha),
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
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.apply(expected_revision, &operations).map_err(model_failure)?;
    active.dirty = true;
    current(&guard)
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
    active.dirty = true;
    current(&guard)
}

#[tauri::command]
pub fn rust_editor_undo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.undo(expected_revision).map_err(model_failure)?;
    active.dirty = true;
    current(&guard)
}

#[tauri::command]
pub fn rust_editor_redo(
    state: State<'_, EditorState>, expected_epoch: u64, expected_revision: u64,
) -> Result<EditorSnapshot, DesktopError> {
    let mut guard = lock(&state)?;
    check_epoch(&guard, expected_epoch)?;
    let active = guard.active.as_mut()
        .ok_or_else(|| failure("RUST_EDITOR_NO_MODEL", "Open or create a model first."))?;
    active.session.redo(expected_revision).map_err(model_failure)?;
    active.dirty = true;
    current(&guard)
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
    active.source_sha = Some(sha256(&bytes));
    active.source_path = Some(path);
    active.dirty = false;
    current(&guard).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

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
                session, source_path: None, source_sha: None, dirty: true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.epoch, 4);
        assert_eq!(snapshot.name, "Synthetic");
        assert_eq!(snapshot.cubes.len(), 0);
        assert_eq!(snapshot.preview_scope, "UNVERIFIED_EMBEDDED_PNG_SUBSET");
    }
}
