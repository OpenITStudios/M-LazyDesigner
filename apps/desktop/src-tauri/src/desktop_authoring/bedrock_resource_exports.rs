//! Native Bedrock resource exports for the existing Tauri Rust editor.
//! File selection, same active EditorSession epoch/revision checks, provisional
//! writer lease, current saved-source SHA validation and fresh sibling output
//! publication stay on this one native path. These exports do NOT create a
//! second model writer, replace the editable .bbmodel or certify Bedrock visuals.
//! The public Tauri command names remain at desktop_authoring.rs.
//! SOURCE_REVIEWED; tests authored but NOT_EXECUTED under repository hold.
use super::*;

/// Implements the existing user-invoked Geometry resource export.
pub(super) async fn export_geometry_resource(
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

/// Implements the existing user-invoked Animation resource export.
pub(super) async fn export_animation_resource(
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
