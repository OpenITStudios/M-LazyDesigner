//! Bounded Rust-owned RGBA8 Paint transactions.
//! Imported textures are immutable unless the user explicitly enables Paint,
//! and only a narrowly validated embedded RGBA8 PNG can be adopted.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use std::io::Cursor;
use super::{MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES, MAX_PAINT_ATLAS_SIDE, PaintRectangleStep};

type Result<T> = std::result::Result<T, String>;
const PREFIX: &str = "data:image/png;base64,";
const MAX_PNG_BYTES: usize = MAX_EXPORT_PNG_BYTES;
const MAX_SIDE: u32 = MAX_PAINT_ATLAS_SIDE;
pub(super) const OWNER: &str = "lazydesigner-rgba8-v1";

// Conversion and editing have one identical field whitelist. Keep supported
// imported UV-grid metadata byte-for-byte when it matches the project.
const ALLOWED_FIELDS: [&str; 10] = [
    "uuid", "name", "source", "internal", "wrap_mode",
    "render_mode", "render_sides", "paint_owner", "uv_width", "uv_height",
];

// One metadata owner for the three Paint eligibility bits. Never interpret
// external files, layers or unknown fields as a supported embedded PNG.
fn supported_paint_metadata(fields: &Map<String, Value>) -> bool {
    fields.keys().all(|key| ALLOWED_FIELDS.contains(&key.as_str())) &&
        fields.get("internal") == Some(&Value::Bool(true)) &&
        fields.get("wrap_mode").and_then(Value::as_str) == Some("limited") &&
        fields.get("render_mode").and_then(Value::as_str) == Some("default") &&
        fields.get("render_sides").and_then(Value::as_str) == Some("double")
}

pub(super) fn editable(texture: &Value) -> bool {
    texture.as_object().is_some_and(|fields|
        supported_paint_metadata(fields) &&
        fields.get("paint_owner").and_then(Value::as_str) == Some(OWNER))
}

// Compute the existing independent editable/adoptable/exportable predicates
// together when projecting a UI snapshot. This is metadata-only: real Paint
// adoption and export still run the full native PNG decoder and safety gates.
pub(super) fn snapshot_eligibility(
    texture: &Value, width: u32, height: u32,
) -> (bool, bool, bool) {
    let Some(fields) = texture.as_object() else { return (false, false, false) };
    let supported = supported_paint_metadata(fields);
    let owned = supported &&
        fields.get("paint_owner").and_then(Value::as_str) == Some(OWNER);
    let eligible_import = supported && !fields.contains_key("paint_owner");
    // Only candidates admitted by the owner/field policy need their image
    // metadata inspected. A wrong/unknown paint_owner fails closed.
    let image_matches = (owned || eligible_import) &&
        size(width, height).is_ok() &&
        fields.get("source").and_then(Value::as_str)
            .is_some_and(|source| source.starts_with(PREFIX)) &&
        fields.get("uv_width").is_none_or(|v| v.as_u64() == Some(u64::from(width))) &&
        fields.get("uv_height").is_none_or(|v| v.as_u64() == Some(u64::from(height)));
    let adoptable = eligible_import && image_matches;
    let exportable = (owned || adoptable) && image_matches;
    (owned, adoptable, exportable)
}

// Metadata-only eligibility for an explicit Enable Painting UI action.
// The Rust operation still decodes and validates complete PNG bytes before
// admitting imported Paint. Opaque fields cannot be silently normalized.
pub(super) fn adoptable(texture: &Value, width: u32, height: u32) -> bool {
    snapshot_eligibility(texture, width, height).1
}

/// Metadata-only eligibility; the actual export decodes the PNG.
pub(super) fn exportable(texture: &Value, width: u32, height: u32) -> bool {
    snapshot_eligibility(texture, width, height).2
}

/// Preserve the original compressed PNG bytes and existing metadata.
pub(super) fn export_png(texture: &Value, width: u32, height: u32) -> Result<Vec<u8>> {
    if !exportable(texture, width, height) {
        return Err("PAINT_EXPORT_TEXTURE_UNSUPPORTED".into());
    }
    let (original_bytes, _) = decode_rgba8_source_with_bytes(texture, width, height)?;
    Ok(original_bytes)
}

/// Read-only alpha evidence for one narrowly admitted RGBA8 texture.
/// This reuses the exact full PNG decoder used by Paint/export, with no
/// re-encoding, source mutation or full bitmap echo to the agent.
/// Transparent atlas pixels alone do NOT prove a model-face texturing defect.
pub(super) fn alpha_diagnostics(texture: &Value, width: u32, height: u32) -> Result<Value> {
    if !exportable(texture, width, height) {
        return Err("PAINT_ALPHA_INSPECTION_UNSUPPORTED".into());
    }
    let pixels = decode_rgba8_source(texture, width, height)?;
    let mut transparent = 0_u32;
    let mut translucent = 0_u32;
    let mut opaque = 0_u32;
    // Fixed 8x8 bins are small enough for a focused model-context read.
    // The sample count prevents an agent from treating empty bins on tiny
    // atlases as a missing-texture verdict.
    let mut tile_samples = [[0_u32; 8]; 8];
    let mut tile_nonzero_alpha = [[0_u32; 8]; 8];
    for (index, pixel) in pixels.chunks_exact(4).enumerate() {
        let alpha = pixel[3];
        match alpha {
            0 => transparent += 1,
            255 => opaque += 1,
            _ => translucent += 1,
        }
        let x = (index as u32) % width;
        let y = (index as u32) / width;
        let tile_x = ((x * 8) / width) as usize;
        let tile_y = ((y * 8) / height) as usize;
        tile_samples[tile_y][tile_x] += 1;
        if alpha > 0 { tile_nonzero_alpha[tile_y][tile_x] += 1; }
    }
    Ok(json!({
        "scope":"decoded_embedded_rgba8_alpha",
        "supported":true,
        "visual_verdict":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "width":width, "height":height,
        "total_pixels":width * height,
        "transparent_pixels":transparent,
        "translucent_pixels":translucent,
        "opaque_pixels":opaque,
        "grid_size":[8,8],
        "tile_samples":tile_samples,
        "tile_nonzero_alpha":tile_nonzero_alpha
    }))
}

/// Decode one admitted Paint RGBA8 texture for a transient, read-only
/// source-UV inspection. The pixels are never serialized to agent context.
pub(super) fn decode_for_uv_inspection(
    texture: &Value, width: u32, height: u32,
) -> Result<Vec<u8>> {
    if !exportable(texture, width, height) {
        return Err("PAINT_UV_TEXTURE_UNSUPPORTED".into());
    }
    decode_rgba8_source(texture, width, height)
}

/// Perform a complete strict source/after RGBA8 comparison one decoded row
/// at a time, instead of allocating TWO full uncompressed 2K/4K atlases for
/// correction verification. These PNGs are read-only and never used as
/// a second bitmap store or to approve artistic quality.
fn admitted_row_reader(texture:&Value,width:u32,height:u32)
    ->Result<png::Reader<Cursor<Vec<u8>>>>{
    if !exportable(texture,width,height) {
        return Err("PAINT_ROW_TEXTURE_UNSUPPORTED".into());
    }
    let encoded=texture.get("source").and_then(Value::as_str)
        .and_then(|value|value.strip_prefix(PREFIX))
        .ok_or("PAINT_PNG_SOURCE_INVALID")?;
    if encoded.len()>MAX_PNG_BYTES.saturating_mul(4)/3+8{
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    let bytes=STANDARD.decode(encoded).map_err(|_|"PAINT_PNG_SOURCE_INVALID")?;
    if bytes.len()>MAX_PNG_BYTES{return Err("PAINT_PNG_TOO_LARGE".into());}
    let reader=png::Decoder::new(Cursor::new(bytes)).read_info()
        .map_err(|_|"PAINT_PNG_DECODE_FAILED")?;
    let info=reader.info();
    if info.width!=width||info.height!=height||
       info.color_type!=png::ColorType::Rgba||
       info.bit_depth!=png::BitDepth::Eight||
       info.animation_control.is_some()||info.interlaced||
       reader.output_buffer_size()!=size(width,height)?{
        return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
    }
    Ok(reader)
}
pub(super) fn compare_rgba8_rows<F>(
    original:&Value,candidate:&Value,width:u32,height:u32,mut visitor:F
)->Result<()>
where F:FnMut(u32,&[u8],&[u8])->Result<()>{
    let mut before=admitted_row_reader(original,width,height)?;
    let mut after=admitted_row_reader(candidate,width,height)?;
    let row_len=(width as usize)*4;
    for y in 0..height{
        let a=before.next_row().map_err(|_|"PAINT_PNG_DECODE_FAILED")?
            .ok_or("PAINT_PNG_FORMAT_UNSUPPORTED")?;
        let b=after.next_row().map_err(|_|"PAINT_PNG_DECODE_FAILED")?
            .ok_or("PAINT_PNG_FORMAT_UNSUPPORTED")?;
        if a.data().len()!=row_len||b.data().len()!=row_len{
            return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
        }
        visitor(y,a.data(),b.data())?;
    }
    if before.next_row().map_err(|_|"PAINT_PNG_DECODE_FAILED")?.is_some()||
       after.next_row().map_err(|_|"PAINT_PNG_DECODE_FAILED")?.is_some(){
        return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
    }
    // Finish also validates trailing PNG chunks rather than silently treating
    // an incomplete or corrupt file as a valid edited candidate.
    before.finish().map_err(|_|"PAINT_PNG_DECODE_FAILED")?;
    after.finish().map_err(|_|"PAINT_PNG_DECODE_FAILED")?;
    Ok(())
}

/// Convert a face's integral atlas UV into a nonempty half-open pixel box.
/// The same admission governs both source-only alpha inspection and
/// semantic face painting, including mirrored/reversed UV coordinates.
pub(super) fn uv_pixel_rectangle(
    width: u32, height: u32, uv: [f64; 4],
) -> Result<([u32; 2], [u32; 2])> {
    let _ = size(width, height)?;
    if !uv.iter().all(|n| n.is_finite() && *n == n.round()) {
        return Err("PAINT_UV_RECT_NON_INTEGRAL".into());
    }
    let x0 = uv[0].min(uv[2]);
    let x1 = uv[0].max(uv[2]);
    let y0 = uv[1].min(uv[3]);
    let y1 = uv[1].max(uv[3]);
    if x0 < 0.0 || y0 < 0.0 || x1 > f64::from(width) ||
       y1 > f64::from(height) {
        return Err("PAINT_UV_RECT_OUT_OF_BOUNDS".into());
    }
    if x0 == x1 || y0 == y1 {
        return Err("PAINT_UV_RECT_ZERO_AREA".into());
    }
    Ok(([x0 as u32, y0 as u32], [x1 as u32, y1 as u32]))
}

/// Counts alpha categories inside a *saved manual UV pixel rectangle*.
/// Exact integer pixel boundaries only; no UV tiling, interpolation, effective
/// material or visible-face paint coverage is inferred. Reversed UV is allowed
/// since reversing a rectangle does not change its alpha histogram.
pub(super) fn uv_region_alpha_stats(
    rgba: &[u8], width: u32, height: u32, uv: [f64; 4],
) -> Result<Value> {
    if size(width, height)? != rgba.len() {
        return Err("PAINT_UV_BITMAP_INVALID".into());
    }
    let ([x0, y0], [x1, y1]) = uv_pixel_rectangle(width, height, uv)?;
    let mut transparent = 0_u32;
    let mut translucent = 0_u32;
    let mut opaque = 0_u32;
    for y in y0..y1 {
        for x in x0..x1 {
            let index = ((y * width + x) * 4 + 3) as usize;
            match rgba[index] {
                0 => transparent += 1,
                255 => opaque += 1,
                _ => translucent += 1,
            }
        }
    }
    let total = transparent + translucent + opaque;
    Ok(json!({
        "scope":"saved_manual_uv_alpha_pixels",
        "sampled_pixels":total,
        "transparent_pixels":transparent,
        "translucent_pixels":translucent,
        "opaque_pixels":opaque,
        "pixel_rect":[x0, y0, x1, y1]
    }))
}

pub(super) fn adopt(texture: &mut Value, width: u32, height: u32) -> Result<()> {
    if !adoptable(texture, width, height) {
        return Err("PAINT_IMPORTED_TEXTURE_UNSUPPORTED".into());
    }
    // Decode + CRC/color-type/frame/dimension checks are the acceptance gate.
    // Keep the original encoded source untouched until the first real stroke.
    let _ = decode_rgba8_source(texture, width, height)?;
    texture.as_object_mut().ok_or("PAINT_IMPORTED_TEXTURE_UNSUPPORTED")?
        .insert("paint_owner".into(), Value::String(OWNER.into()));
    Ok(())
}

fn encode(width: u32, height: u32, pixels: &[u8]) -> Result<String> {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        // Both DEFLATE and adaptive scanline filters are lossless. No color
        // quantization, indexed PNG conversion, downscale or dithering.
        // Large 2K stroke edits prioritize responsiveness; both modes are lossless.
        encoder.set_compression(if u64::from(width)*u64::from(height)>1024*1024 {
            png::Compression::Fast
        } else { png::Compression::Best });
        encoder.set_adaptive_filter(png::AdaptiveFilterType::Adaptive);
        let mut writer = encoder.write_header().map_err(|_| "PAINT_PNG_ENCODE_FAILED")?;
        writer.write_image_data(pixels).map_err(|_| "PAINT_PNG_ENCODE_FAILED")?;
    }
    if png_bytes.len() > MAX_PNG_BYTES { return Err("PAINT_PNG_TOO_LARGE".into()); }
    Ok(format!("{PREFIX}{}", STANDARD.encode(png_bytes)))
}

fn size(width: u32, height: u32) -> Result<usize> {
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err("PAINT_DIMENSIONS_UNSUPPORTED".into());
    }
    Ok(width as usize * height as usize * 4)
}

fn valid_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > 80 ||
        name.chars().any(char::is_control) {
        return Err("PAINT_NAME_INVALID".into());
    }
    Ok(())
}

fn authored_asset(uuid: &str, name: &str, source: &str) -> Value {
    json!({
        "uuid": uuid, "name": name, "source": source,
        "internal": true, "wrap_mode": "limited",
        "render_mode": "default", "render_sides": "double",
        "paint_owner": OWNER,
    })
}

pub(super) fn create(uuid: &str, name: &str, width: u32, height: u32) -> Result<Value> {
    valid_name(name)?;
    let pixels = vec![0; size(width, height)?];
    let source = encode(width, height, &pixels)?;
    Ok(authored_asset(uuid, name, &source))
}

/// One original, embedded RGBA8 PNG per import, never an external path.
/// No conversion of RGB/palette, APNG, frames or vendor metadata occurs.
pub(super) fn import_png(
    uuid: &str, name: &str, source: &str, width: u32, height: u32,
) -> Result<Value> {
    valid_name(name)?;
    let encoded = source.strip_prefix(PREFIX)
        .ok_or("PAINT_PNG_SOURCE_INVALID")?;
    if encoded.len() > MAX_IMPORT_PNG_BYTES * 4 / 3 + 8 {
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    let asset = authored_asset(uuid, name, source);
    // One authenticated owned-PNG decode supplies BOTH full RGBA8 format
    // verification and the original compressed byte count. Do not Base64-
    // decode a second time just to enforce the stricter import limit.
    let (png_bytes, _) = decode_owned_with_bytes(&asset, width, height)?;
    if png_bytes.len() > MAX_IMPORT_PNG_BYTES {
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    Ok(asset)
}

fn decode(texture: &Value, width: u32, height: u32) -> Result<Vec<u8>> {
    let (_, rgba) = decode_owned_with_bytes(texture, width, height)?;
    Ok(rgba)
}

// Keep the same ownership, grid and strict full-PNG decoder gates for both
// editing and importing. Only the result shape differs from the PNG export.
fn decode_owned_with_bytes(
    texture: &Value, width: u32, height: u32,
) -> Result<(Vec<u8>, Vec<u8>)> {
    if !editable(texture) { return Err("PAINT_TEXTURE_NOT_OWNED".into()); }
    if texture.get("uv_width").is_some_and(|v| v.as_u64() != Some(u64::from(width))) ||
       texture.get("uv_height").is_some_and(|v| v.as_u64() != Some(u64::from(height))) {
        return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
    }
    decode_rgba8_source_with_bytes(texture, width, height)
}

fn decode_rgba8_source(texture: &Value, width: u32, height: u32) -> Result<Vec<u8>> {
    let (_, pixels) = decode_rgba8_source_with_bytes(texture, width, height)?;
    Ok(pixels)
}

// One full-decode gate for editing, adoption and verbatim PNG export.
fn decode_rgba8_source_with_bytes(
    texture: &Value, width: u32, height: u32,
) -> Result<(Vec<u8>, Vec<u8>)> {
    let source = texture.get("source").and_then(Value::as_str)
        .and_then(|text| text.strip_prefix(PREFIX))
        .ok_or("PAINT_PNG_SOURCE_INVALID")?;
    if source.len() > MAX_PNG_BYTES * 4 / 3 + 8 {
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    let bytes = STANDARD.decode(source).map_err(|_| "PAINT_PNG_SOURCE_INVALID")?;
    if bytes.len() > MAX_PNG_BYTES { return Err("PAINT_PNG_TOO_LARGE".into()); }
    let pixels = {
        let decoder = png::Decoder::new(Cursor::new(bytes.as_slice()));
        let mut reader = decoder.read_info().map_err(|_| "PAINT_PNG_DECODE_FAILED")?;
        let info = reader.info();
        let expected = size(width, height)?;
        if info.width != width || info.height != height ||
            info.color_type != png::ColorType::Rgba ||
            info.bit_depth != png::BitDepth::Eight ||
            info.animation_control.is_some() ||
            info.interlaced ||
            reader.output_buffer_size() != expected {
            return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
        }
        let mut pixels = vec![0; expected];
        let frame = reader.next_frame(&mut pixels).map_err(|_| "PAINT_PNG_DECODE_FAILED")?;
        if frame.buffer_size() != expected { return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into()); }
        pixels
    };
    Ok((bytes, pixels))
}

/// Replace exact pixels from a selected external editor PNG, never a texture
/// object or UV layout. The caller's face rectangle and source swatch have
/// already been checked against immutable Rust Cube/UV ownership.
pub(super) fn replace_face_from_png_guarded(
    texture: &mut Value, width: u32, height: u32,
    candidate_source: &str, base: [u8; 4],
    from: [u32; 2], to: [u32; 2],
) -> Result<()> {
    if base[3] != 255 || from[0]>=to[0] || from[1]>=to[1] ||
       to[0]>width || to[1]>height {
        return Err("EXTERNAL_TEXTURE_FACE_OR_BASE_INVALID".into());
    }
    if !editable(texture) {
        return Err("EXTERNAL_TEXTURE_NOT_OWNED".into());
    }
    let candidate_asset = authored_asset("external-preview", "external.png", candidate_source);
    let (raw, candidate) = decode_owned_with_bytes(&candidate_asset,width,height)?;
    if raw.len() > MAX_IMPORT_PNG_BYTES {
        return Err("EXTERNAL_TEXTURE_PNG_TOO_LARGE".into());
    }
    let original = decode(texture,width,height)?;
    let mut changes = 0usize;
    for (i,(before,after)) in original.chunks_exact(4)
        .zip(candidate.chunks_exact(4)).enumerate() {
        if before == after { continue; }
        let x = (i as u32)%width;
        let y = (i as u32)/width;
        if x<from[0] || x>=to[0] || y<from[1] || y>=to[1] {
            return Err("EXTERNAL_TEXTURE_OUTSIDE_FACE".into());
        }
        if before != base.as_slice() || before[3] != after[3] {
            return Err("EXTERNAL_TEXTURE_ORIGINAL_DETAIL_OR_ALPHA".into());
        }
        // A one-texel margin is retained around observed non-base marks.
        // Same-RGBA identity remains a user/reviewer protected-mask concern.
        for yy in y.saturating_sub(1).max(from[1])..=(y+1).min(to[1]-1) {
            for xx in x.saturating_sub(1).max(from[0])..=(x+1).min(to[0]-1) {
                let at = ((yy as usize)*width as usize+xx as usize)*4;
                if original.get(at..at+4) != Some(base.as_slice()) {
                    return Err("EXTERNAL_TEXTURE_NEAR_ORIGINAL_DETAIL".into());
                }
            }
        }
        changes+=1;
    }
    if changes == 0 {
        return Err("EDIT_NO_OP".into());
    }
    // Normalize to the canonical Rust-owned PNG writer; external ancillary
    // chunks, layer metadata and hidden editor state do not enter .bbmodel.
    let encoded=encode(width,height,&candidate)?;
    texture.as_object_mut().ok_or("EXTERNAL_TEXTURE_NOT_OWNED")?
        .insert("source".into(),Value::String(encoded));
    Ok(())
}

pub(super) const MAX_STROKE_POINTS: usize = 4096;

/// Apply one bounded stroke to one Rust-owned bitmap, decoding and encoding
/// exactly once; EditorSession commits the complete result as one Undo step.
pub(super) fn stroke(
    texture: &mut Value, width: u32, height: u32,
    points: &[[u32; 2]], rgba: [u8; 4],
) -> Result<()> {
    if points.is_empty() || points.len() > MAX_STROKE_POINTS {
        return Err("PAINT_STROKE_SIZE_INVALID".into());
    }
    if points.iter().any(|[x, y]| *x >= width || *y >= height) {
        return Err("PAINT_COORDINATE_INVALID".into());
    }
    let mut pixels = decode(texture, width, height)?;
    let mut changed = false;
    for &[x, y] in points {
        let offset = (y as usize * width as usize + x as usize) * 4;
        if pixels[offset..offset + 4] != rgba {
            pixels[offset..offset + 4].copy_from_slice(&rgba);
            changed = true;
        }
    }
    if !changed { return Ok(()); }
    let source = encode(width, height, &pixels)?;
    texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
        .insert("source".into(), Value::String(source));
    Ok(())
}

/// Commit one exact multi-shade pixel cohort using the SAME RGBA8 encoder.
pub(super) fn exact_pixels(
    texture:&mut Value,width:u32,height:u32,
    patches:&[super::ExactPixelPatch],
)->Result<()>{
    if patches.is_empty()||patches.len()>MAX_STROKE_POINTS{
        return Err("PAINT_EXACT_PIXELS_SIZE_INVALID".into());
    }
    let mut original=decode(texture,width,height)?;
    let mut seen=std::collections::HashSet::new();
    let mut changed=false;
    // Check every input before modifying even the temporary bitmap.
    for patch in patches{
        if patch.at[0]>=width||patch.at[1]>=height||
           !seen.insert(patch.at)||
           patch.before[3]!=patch.after[3]{
            return Err("PAINT_EXACT_PIXELS_INVALID".into());
        }
        let i=((patch.at[1] as usize)*width as usize+
            patch.at[0] as usize)*4;
        if original.get(i..i+4)!=Some(patch.before.as_slice()){
            return Err("PAINT_EXACT_PIXELS_SOURCE_STALE".into());
        }
        changed|=patch.before!=patch.after;
    }
    if !changed {return Ok(());}
    for patch in patches{
        if patch.before==patch.after{continue;}
        let i=((patch.at[1] as usize)*width as usize+
            patch.at[0] as usize)*4;
        original[i..i+4].copy_from_slice(&patch.after);
    }
    let source=encode(width,height,&original)?;
    texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
        .insert("source".into(),Value::String(source));
    Ok(())
}

/// One circular pencil/eraser stroke. Radius 1 covers one pixel; radius 8
/// covers at most a 15x15 neighborhood per path point. Clip at atlas edges.
pub(super) fn brush(
    texture: &mut Value, width: u32, height: u32,
    points: &[[u32; 2]], radius: u8, rgba: [u8; 4], erase: bool,
) -> Result<()> {
    if radius == 0 || radius > 8 { return Err("PAINT_BRUSH_RADIUS_INVALID".into()); }
    if points.is_empty() || points.len() > MAX_STROKE_POINTS {
        return Err("PAINT_STROKE_SIZE_INVALID".into());
    }
    if points.iter().any(|[x, y]| *x >= width || *y >= height) {
        return Err("PAINT_COORDINATE_INVALID".into());
    }
    let mut pixels = decode(texture, width, height)?;
    let desired = if erase { [0, 0, 0, 0] } else { rgba };
    let distance = i32::from(radius) - 1;
    let mut changed = false;
    for &[x, y] in points {
        for offset_y in -distance..=distance {
            for offset_x in -distance..=distance {
                if offset_x * offset_x + offset_y * offset_y > distance * distance {
                    continue;
                }
                let nx = i64::from(x) + i64::from(offset_x);
                let ny = i64::from(y) + i64::from(offset_y);
                if nx < 0 || ny < 0 || nx >= i64::from(width) || ny >= i64::from(height) {
                    continue;
                }
                let start = (ny as usize * width as usize + nx as usize) * 4;
                if pixels[start..start + 4] != desired {
                    pixels[start..start + 4].copy_from_slice(&desired);
                    changed = true;
                }
            }
        }
    }
    if !changed { return Ok(()); }
    let source = encode(width, height, &pixels)?;
    texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
        .insert("source".into(), Value::String(source));
    Ok(())
}

/// Bounded, pixel-exact destination for one Box UV face rectangle.
pub(super) struct UvCopyRegion {
    pub from: [u32; 2],
    pub to: [u32; 2],
    pub size: [u32; 2],
}

/// Copy existing face pixels to unused cells of the *same* owned atlas.
/// Read source pixels from the original bitmap, never from earlier writes.
pub(super) fn copy_uv_regions(
    texture: &mut Value, width: u32, height: u32, regions: &[UvCopyRegion],
) -> Result<()> {
    if regions.is_empty() || regions.len() > 6 {
        return Err("PAINT_UV_COPY_REGIONS_INVALID".into());
    }
    let original = decode(texture, width, height)?;
    let mut copied = original.clone();
    for region in regions {
        for bound in [region.from, region.to] {
            if region.size.contains(&0) ||
               !bound[0].checked_add(region.size[0]).is_some_and(|v| v <= width) ||
               !bound[1].checked_add(region.size[1]).is_some_and(|v| v <= height) {
                return Err("PAINT_UV_COPY_REGION_INVALID".into());
            }
        }
        for y in 0..region.size[1] {
            for x in 0..region.size[0] {
                let from = (((region.from[1] + y) * width +
                    region.from[0] + x) * 4) as usize;
                let to = (((region.to[1] + y) * width +
                    region.to[0] + x) * 4) as usize;
                if original[to..to + 4] != [0,0,0,0] {
                    return Err("PAINT_UV_COPY_DESTINATION_NOT_BLANK".into());
                }
                copied[to..to + 4].copy_from_slice(&original[from..from + 4]);
            }
        }
    }
    if copied != original {
        let source = encode(width, height, &copied)?;
        texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
            .insert("source".into(), Value::String(source));
    }
    Ok(())
}

/// Recolor explicitly owned half-open UV rectangles by exact source RGB.
/// One PNG decode/encode, no sampling from material names and no generated
/// noise. Alpha and pixels outside the selected faces stay byte-equivalent
/// in decoded RGBA. Swaps are *simultaneous*: A->B and B->C do not cascade.
pub(super) fn recolor_regions(
    texture: &mut Value, width: u32, height: u32,
    regions: &[([u32; 2], [u32; 2])],
    swaps: &[super::PaletteRgbSwap],
) -> Result<()> {
    use std::collections::HashMap;
    if regions.is_empty() || regions.len() > 16 * 6 {
        return Err("PALETTE_REGIONS_SIZE_INVALID".into());
    }
    // Color diversity belongs to the pixel data; only source atlas pixels
    // and bounded native plan bytes limit one recolor operation.
    if swaps.is_empty() ||
       swaps.len() > (width as usize).saturating_mul(height as usize) ||
       serde_json::to_vec(swaps)
           .is_err_or(|payload| payload.len()>super::MAX_PLAN_BYTES) {
        return Err("PALETTE_SWAPS_SIZE_INVALID".into());
    }
    let mut colors = HashMap::with_capacity(swaps.len());
    for swap in swaps {
        if colors.insert(swap.from, swap.to).is_some() {
            return Err("PALETTE_SWAPS_DUPLICATE_SOURCE".into());
        }
    }
    for &(from, to) in regions {
        if from[0] >= to[0] || from[1] >= to[1] ||
           to[0] > width || to[1] > height {
            return Err("PALETTE_REGION_BOUNDS_INVALID".into());
        }
    }
    let mut pixels = decode(texture, width, height)?;
    let mut covered = vec![false; (width as usize) * (height as usize)];
    let mut changed = false;
    for &(from, to) in regions {
        for y in from[1]..to[1] {
            for x in from[0]..to[0] {
                let index = (y as usize) * width as usize + x as usize;
                if covered[index] {
                    return Err("PALETTE_REGIONS_OVERLAP".into());
                }
                covered[index] = true;
                let p = index * 4;
                // Invisible RGB is part of the authored source image. Do not
                // repaint it merely because it matches a visible swatch.
                if pixels[p + 3] == 0 { continue; }
                let source = [pixels[p], pixels[p + 1], pixels[p + 2]];
                if let Some(&target) = colors.get(&source) {
                    if source != target {
                        pixels[p..p + 3].copy_from_slice(&target);
                        changed = true;
                    }
                }
            }
        }
    }
    if changed {
        let source = encode(width, height, &pixels)?;
        texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
            .insert("source".into(), Value::String(source));
    }
    Ok(())
}

/// One or many ordered, filled, inclusive atlas rectangles. The caller can
/// paint a coherent palette/face-zone cohort as one PNG decode and encode,
/// rather than decomposing it into repeated per-rectangle PNG mutations.
pub(super) fn rectangles(
    texture: &mut Value, width: u32, height: u32,
    steps: &[PaintRectangleStep],
) -> Result<()> {
    const MAX_RECTANGLES: usize = 64;
    if steps.is_empty() || steps.len() > MAX_RECTANGLES {
        return Err("PAINT_RECTANGLES_SIZE_INVALID".into());
    }
    // Validate the entire plan before touching the PNG. The parent Rust
    // EditorSession also snapshots the complete transaction and refuses
    // all partial writes if any subsequent operation fails.
    if steps.iter().any(|step|
        step.from[0] >= width || step.from[1] >= height ||
        step.to[0] >= width || step.to[1] >= height) {
        return Err("PAINT_COORDINATE_INVALID".into());
    }
    let mut pixels = decode(texture, width, height)?;
    let w = width as usize;
    // A short face-local correction should not allocate a visited bitmap
    // for every pixel of a much larger atlas. Inclusive corner min/max
    // follows the original reversed-rectangle contract.
    let min_x = steps.iter().map(|s| s.from[0].min(s.to[0]) as usize).min().unwrap();
    let max_x = steps.iter().map(|s| s.from[0].max(s.to[0]) as usize).max().unwrap();
    let min_y = steps.iter().map(|s| s.from[1].min(s.to[1]) as usize).min().unwrap();
    let max_y = steps.iter().map(|s| s.from[1].max(s.to[1]) as usize).max().unwrap();
    let mask_width = max_x - min_x + 1;
    // The final rectangle touching each pixel wins. Traverse in reverse so
    // original RGBA is still available for exact no-op detection without
    // cloning the 4-byte-per-pixel atlas. One byte per bounding-box pixel.
    let mut decided = vec![false; mask_width * (max_y - min_y + 1)];
    let mut changed = false;
    for step in steps.iter().rev() {
        let desired = if step.erase { [0, 0, 0, 0] } else { step.rgba };
        let x0 = step.from[0].min(step.to[0]) as usize;
        let x1 = step.from[0].max(step.to[0]) as usize;
        let y0 = step.from[1].min(step.to[1]) as usize;
        let y1 = step.from[1].max(step.to[1]) as usize;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let mask_index = (y - min_y) * mask_width + (x - min_x);
                if decided[mask_index] { continue; }
                decided[mask_index] = true;
                let offset = (y * w + x) * 4;
                if pixels[offset..offset + 4] != desired {
                    pixels[offset..offset + 4].copy_from_slice(&desired);
                    changed = true;
                }
            }
        }
    }
    // Reverted overlap/no-change batches do not re-encode, advance revision,
    // or create Undo history. The model authority remains EditorSession.
    if !changed { return Ok(()); }
    let source = encode(width, height, &pixels)?;
    texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
        .insert("source".into(), Value::String(source));
    Ok(())
}

/// Legacy single rectangle uses the exact same strict Rust bitmap owner.
pub(super) fn rectangle(
    texture: &mut Value, width: u32, height: u32,
    from: [u32; 2], to: [u32; 2], rgba: [u8; 4], erase: bool,
) -> Result<()> {
    rectangles(texture, width, height, &[PaintRectangleStep { from, to, rgba, erase }])
}

/// Four-connected bounded region fill on exact RGBA8 matches. This is a
/// deterministic atlas edit, not a screen-space/UV-face interpretation.
pub(super) fn fill(
    texture: &mut Value, width: u32, height: u32,
    at: [u32; 2], rgba: [u8; 4], erase: bool,
) -> Result<()> {
    if at[0] >= width || at[1] >= height {
        return Err("PAINT_COORDINATE_INVALID".into());
    }
    let mut pixels = decode(texture, width, height)?;
    let w = width as usize;
    let h = height as usize;
    let seed = at[1] as usize * w + at[0] as usize;
    let start = seed * 4;
    let target = [
        pixels[start], pixels[start + 1],
        pixels[start + 2], pixels[start + 3],
    ];
    let desired = if erase { [0, 0, 0, 0] } else { rgba };
    if target == desired { return Ok(()); }

    // Since target != desired, recoloring a pixel is itself the visit marker:
    // it can no longer match target on any later worklist entry. Do not also
    // allocate a width*height visited map for the same bounded RGBA8 bitmap.
    // Each accepted pixel queues at most four neighbors, so the iterative
    // worklist remains bounded by 4 * the existing bounded atlas pixel limit.
    let mut stack = vec![seed];
    while let Some(index) = stack.pop() {
        let offset = index * 4;
        if pixels[offset..offset + 4] != target { continue; }
        pixels[offset..offset + 4].copy_from_slice(&desired);
        let x = index % w;
        let y = index / w;
        if x > 0 { stack.push(index - 1); }
        if x + 1 < w { stack.push(index + 1); }
        if y > 0 { stack.push(index - w); }
        if y + 1 < h { stack.push(index + w); }
    }
    let source = encode(width, height, &pixels)?;
    texture.as_object_mut().ok_or("PAINT_TEXTURE_NOT_OWNED")?
        .insert("source".into(), Value::String(source));
    Ok(())
}

pub(super) fn pixel(
    texture: &mut Value, width: u32, height: u32, x: u32, y: u32, rgba: [u8; 4],
) -> Result<()> {
    stroke(texture, width, height, &[[x, y]], rgba)
}


#[cfg(test)]
mod lossless_png_palette_tests {
    use super::*;
    // SOURCE_AUTHORED_NOT_RUN: exact 4096-color RGBA (including hidden RGB).
    #[test]
    fn multicolor_recolor_preserves_more_than_32_swatches_and_alpha() {
        let (w,h)=(64u32,64u32);
        let mut pixels=vec![0u8;(w*h*4) as usize];
        for x in 0..40u32 {
            let at=((2*w+x)*4) as usize;
            pixels[at..at+4].copy_from_slice(&[x as u8,2,3,255]);
        }
        // A transparent texel with meaningful hidden RGB must stay exact.
        pixels[((5*w+7)*4) as usize..((5*w+7)*4+4) as usize]
            .copy_from_slice(&[23,45,67,0]);
        let mut texture=authored_asset("rgba","swatches.png",&encode(w,h,&pixels).unwrap());
        let swaps=(0..40u32).map(|x|super::super::PaletteRgbSwap{
            from:[x as u8,2,3],to:[x as u8,4,5],
        }).collect::<Vec<_>>();
        recolor_regions(&mut texture,w,h,&[([0,0],[64,4])],&swaps).unwrap();
        let changed=decode(&texture,w,h).unwrap();
        for x in 0..40u32 {
            let at=((2*w+x)*4) as usize;
            assert_eq!(&changed[at..at+4],&[x as u8,4,5,255]);
        }
        let hidden=((5*w+7)*4) as usize;
        assert_eq!(&changed[hidden..hidden+4],&[23,45,67,0]);
    }

    #[test]
    fn strict_row_pair_preserves_hidden_rgb_and_detects_only_changed_pixels(){
        let (w,h)=(8u32,8u32);
        let mut bytes=vec![0u8;(w*h*4) as usize];
        bytes[0..4].copy_from_slice(&[8,9,10,0]);
        let before=authored_asset("before","source.png",&encode(w,h,&bytes).unwrap());
        bytes[4..8].copy_from_slice(&[20,30,40,255]);
        let after=authored_asset("after","next.png",&encode(w,h,&bytes).unwrap());
        let mut changed=0usize;
        compare_rgba8_rows(&before,&after,w,h,|y,a,b|{
            assert_eq!(a.len(),(w*4) as usize);
            assert_eq!(a[0..4],[8,9,10,0]); // hidden RGB remains
            for (x,(old,new)) in a.chunks_exact(4).zip(b.chunks_exact(4)).enumerate(){
                if old!=new {assert_eq!((x,y),(1,0));changed+=1;}
            }
            Ok(())
        }).unwrap();
        assert_eq!(changed,1);
    }
    #[test]
    fn compressed_png_round_trip_preserves_unique_rgba_and_alpha() {
        let (w,h)=(64u32,64u32);
        let mut pixels=vec![0u8;(w*h*4) as usize];
        for y in 0..h {
            for x in 0..w {
                let at=((y*w+x)*4) as usize;
                pixels[at..at+4].copy_from_slice(&[
                    x as u8, y as u8, ((x*13+y*7)%256) as u8,
                    if (x+y)%5==0 {0} else {((x*3+y*5)%256) as u8},
                ]);
            }
        }
        let source=encode(w,h,&pixels).unwrap();
        let asset=authored_asset("source","rich-rgba.png",&source);
        assert_eq!(decode(&asset,w,h).unwrap(),pixels);
        let png=export_png(&asset,w,h).unwrap();
        let reader=png::Decoder::new(Cursor::new(png.as_slice()))
            .read_info().unwrap();
        assert_eq!(reader.info().color_type,png::ColorType::Rgba);
        assert_eq!(reader.info().bit_depth,png::BitDepth::Eight);
        assert_eq!(png.len(),STANDARD.decode(source.strip_prefix(PREFIX).unwrap())
            .unwrap().len()); // unchanged PNG is never reencoded for export
        assert_eq!(pixels.chunks_exact(4).map(|p|[p[0],p[1],p[2],p[3]])
            .collect::<std::collections::HashSet<_>>().len(),4096);
    }
}
