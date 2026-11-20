//! Read-only user-selected material reference and provisional preview flows.
//! Each preview reads the existing epoch/revision-pinned Rust document,
//! validates actual PNG/source identities and refuses stale candidates.
//! This module does not register Tauri commands, approve art, persist previews,
//! mutate the live EditorStore, or publish source/candidate files.
//! Public Tauri command names and protected Apply still belong to
//! desktop_authoring.rs. SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
use super::*;

/// A source/reference picker does not transfer the bytes or filesystem path
/// to the AI guest. The local Tauri UI receives a bounded validated PNG
/// solely to display the chosen reference beside the candidate; only its
/// hash enters the semantic Rust material intent. The user must still
/// confirm artistic relevance and approval independently.
pub(super) async fn choose_semantic_reference(
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

/// Generate a candidate from an immutable in-memory Rust source. The
/// published EditorStore, Undo and original .bbmodel are never touched.
pub(super) fn preview_semantic_material(
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
pub(super) async fn preview_external_face_png(
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
