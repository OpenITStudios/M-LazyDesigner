//! Tauri Paint Texture input/output and selected source-atlas transport.
//! The existing Rust EditorState, epoch/revision checks and edit transaction
//! remain authoritative. Import uses the original detached_edit pathway;
//! export retains the original source-SHA check and fresh-only PNG publisher.
//! A selected atlas preview is read-only, not a bitmap cache or write receipt.
//! Public commands stay in desktop_authoring.rs; no new Tauri registrations.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

/// Read only the selected valid source atlas if the aggregate eager snapshot
/// omitted it. All PNG/UV source rules still apply. Code Mode guest permissions
/// and native Paint/Undo are entirely unaffected by this presentation request.
pub(super) fn read_selected_atlas_preview(
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

/// Read a user-selected PNG entirely inside the native Rust host and
/// submit it through the exact same validated EditOperation as the CLI.
/// Canceled dialogs have no effect. Local paths and unvalidated bytes stay
/// native; admitted embedded image previews follow the existing bounded projection.
pub(super) async fn import_selected_paint_png(
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

/// A read-only PNG export, selected by stable UUID and Rust revision.
/// Only native Rust knows the local path and publishes the file.
pub(super) async fn export_selected_paint_png(
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
