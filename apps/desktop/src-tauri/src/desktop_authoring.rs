//! Tauri adapter for the one authoritative Rust Bedrock document session.
//! This module never implements its own geometry, history or .bbmodel codec.

use crate::desktop_error::DesktopError;
use lazydesigner::authoring::{
    storage, sha256, AuthoringDocument, Bone, Cube, EditOperation, EditorSession,
    OutlinerNode, MAX_MODEL_BYTES,
};
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

// Never resolve project-relative paths or arbitrary URLs inside the WebView.
// Embedded PNG candidates remain subject to the browser's image decoder.
fn embedded_png_preview_source(texture: &Value) -> Option<String> {
    const PREFIX: &str = "data:image/png;base64,";
    const MAX_BASE64: usize = 2 * 1024 * 1024;
    if texture.get("wrap_mode").and_then(Value::as_str).is_some_and(|mode| mode != "limited") {
        return None;
    }
    let source = texture.get("source")?.as_str()?;
    let data = source.strip_prefix(PREFIX)?;
    if data.len() < 16 || data.len() > MAX_BASE64 ||
        !data.starts_with("iVBORw0KGgo") ||
        !data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')) {
        return None;
    }
    Some(source.to_owned())
}

fn texture_preview_sources(doc: &AuthoringDocument) -> Vec<Option<String>> {
    // Blockbench Bedrock's multi-file ruleset changes per-face UV resolution.
    // Do not display atlas UV against the wrong texture resolution.
    let ruleset = doc.extensions.get("multi_file_ruleset");
    let per_texture = ruleset.is_some_and(|value| match value {
        Value::String(name) => !name.is_empty(),
        _ => true,
    }) || doc.extensions.get("per_texture_uv_size") == Some(&Value::Bool(true)) ||
        doc.meta.extra.get("per_texture_uv_size") == Some(&Value::Bool(true));
    let mut remaining = 4 * 1024 * 1024;
    doc.texture_assets.iter().map(|texture| {
        if per_texture { return None; }
        let source = embedded_png_preview_source(texture)?;
        if source.len() > remaining { return None; }
        remaining -= source.len();
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
    let mut faces = Map::new();
    for name in ["north", "east", "south", "west", "up", "down"] {
        faces.insert(name.to_owned(), json!({"uv":[0.0,0.0,2.0,2.0]}));
    }
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

    #[test]
    fn texture_projection_excludes_external_malformed_and_multifile_sources() {
        assert!(embedded_png_preview_source(&json!({"source":"https://example.test/texture.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"relative_path":"textures/entity/atlas.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":"data:image/png;base64,AAAA"})).is_none());
        let candidate = "data:image/png;base64,iVBORw0KGgoAAAABAAAAAA==";
        assert_eq!(embedded_png_preview_source(&json!({"source":candidate})), Some(candidate.to_owned()));
        assert!(embedded_png_preview_source(&json!({"source":
            format!("data:image/png;base64,iVBORw0KGgo{}", "A".repeat(2 * 1024 * 1024))})).is_none());
        let mut doc = AuthoringDocument::new_bedrock("Synthetic", "synthetic").unwrap();
        doc.texture_assets.push(json!({"source": candidate}));
        assert_eq!(texture_preview_sources(&doc), vec![Some(candidate.to_owned())]);
        doc.extensions.insert("multi_file_ruleset".into(), json!("textures"));
        assert_eq!(texture_preview_sources(&doc), vec![None]);
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
