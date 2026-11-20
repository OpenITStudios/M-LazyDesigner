//! Read-only Tauri texture, imported PNG and UV-grid projection policy.
//! The only model/bitmap edit authority remains the shared Rust Core.
//! SOURCE_ONLY: native visual/Blockbench parity NOT_EXECUTED.
use super::*;

// Only default texture materials can be approximated by this bounded renderer.
// Blockbench's additive, emissive and layered modes use different shaders.
pub(super) fn texture_preview_side(texture: &Value) -> Option<&'static str> {
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
pub(super) fn embedded_png_preview_candidate(texture: &Value) -> Option<(&str, u32, u32)> {
    const PREFIX: &str = "data:image/png;base64,";
    const MAX_BASE64: usize = 112 * 1024 * 1024;
    const MAX_DIMENSION: u32 = 4096;
    const MAX_PIXELS_PER_IMAGE: u64 = 16 * 1024 * 1024;
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

pub(super) fn embedded_png_preview_source(texture: &Value) -> Option<String> {
    embedded_png_preview_candidate(texture).map(|(source, _, _)| source.to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PreviewUvMode {
    ProjectAtlas,
    ScopedAttachable,
    Unsupported,
}

/// Pinned Blockbench 5.2.1 enables per-texture UV when an active multi-file
/// ruleset is selected. Only bedrock_attachable has a reviewed scope resolver.
/// Unknown rulesets and conflicting optional flags remain read-only fallback.
pub(super) fn preview_uv_mode(doc: &AuthoringDocument) -> PreviewUvMode {
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

/// Share identical ProjectAtlas UV/dimension admission for eager and
/// on-demand sources. Only the aggregate snapshot budget is optional.
pub(super) fn project_atlas_preview_grid(
    doc: &AuthoringDocument, texture: &Value, width: u32, height: u32,
) -> Option<[u32; 2]> {
    if width != doc.resolution.width || height != doc.resolution.height ||
       texture.get("uv_width").is_some_and(|value|
           value.as_u64() != Some(u64::from(doc.resolution.width))) ||
       texture.get("uv_height").is_some_and(|value|
           value.as_u64() != Some(u64::from(doc.resolution.height))) {
        return None;
    }
    Some([doc.resolution.width, doc.resolution.height])
}

/// Each admitted source carries its actual UV grid separately from PNG pixel
/// dimensions. The latter only controls decoding and GPU memory budgets.
#[cfg(test)]
pub(super) fn texture_preview_assets(doc: &AuthoringDocument) -> Vec<Option<(&str, [u32; 2])>> {
    texture_preview_assets_in_mode(doc, preview_uv_mode(doc))
}

pub(super) fn texture_preview_assets_in_mode(
    doc: &AuthoringDocument, mode: PreviewUvMode,
) -> Vec<Option<(&str, [u32; 2])>> {
    // A bounded snapshot view is not a global texture/paint capacity. WebView
    // resources are disposable and not the authoritative Rust bitmap.
    const MAX_PROJECTED_PIXELS: u64 = 16 * 1024 * 1024;
    let mut remaining_source_bytes = 112 * 1024 * 1024;
    let mut remaining_pixels = MAX_PROJECTED_PIXELS;
    let mut admitted = 0usize;
    doc.texture_assets.iter().map(|texture| {
        if mode == PreviewUvMode::Unsupported || admitted >= MAX_PAINT_TEXTURES {
            return None;
        }
        let (source, width, height) = embedded_png_preview_candidate(texture)?;
        let uv_grid = match mode {
            PreviewUvMode::ProjectAtlas =>
                project_atlas_preview_grid(doc,texture,width,height)?,
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
pub(super) fn texture_scope_indices(doc: &AuthoringDocument) -> HashMap<u64, Option<usize>> {
    let mut by_scope: HashMap<u64, Option<usize>> = HashMap::new();
    for (index, texture) in doc.texture_assets.iter().enumerate() {
        let Some(scope) = texture.get("scope").and_then(Value::as_u64)
            .filter(|scope| *scope > 0) else { continue };
        by_scope.entry(scope).and_modify(|entry| *entry = None)
            .or_insert(Some(index));
    }
    by_scope
}

pub(super) fn scoped_cube_texture_index(
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
pub(super) fn texture_preview_sources(doc: &AuthoringDocument) -> Vec<Option<String>> {
    texture_preview_assets(doc).into_iter()
        .map(|entry| entry.map(|(source, _)| source.to_owned())).collect()
}
