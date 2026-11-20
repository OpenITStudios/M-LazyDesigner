//! Bounded renderer PNG and exact saved .bbmodel source admission.
//! Read/validate only; the user-originated Tauri export command still owns
//! selection, write lease, fresh sibling publication, and review source ID.
//! A valid image never implies native Blockbench/Bedrock visual quality.
//! SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
use super::*;

/// Verify a bounded encoded WebGL PNG. The browser canvas is a *preview*,
/// never a proof of native Minecraft fidelity or a writable model asset.
pub(super) fn decode_review_capture_png(data_url: &str) -> Result<Vec<u8>, DesktopError> {
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
pub(super) fn review_capture_source(source: &FrozenPublication) -> Result<(PathBuf, String), DesktopError> {
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
