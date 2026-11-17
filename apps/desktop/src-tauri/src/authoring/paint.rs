//! Bounded Rust-owned RGBA8 Paint transactions.
//! Imported textures are immutable unless the user explicitly enables Paint,
//! and only a narrowly validated embedded RGBA8 PNG can be adopted.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::io::Cursor;
use super::{MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES, PaintRectangleStep};

type Result<T> = std::result::Result<T, String>;
const PREFIX: &str = "data:image/png;base64,";
const MAX_PNG_BYTES: usize = MAX_EXPORT_PNG_BYTES;
const MAX_SIDE: u32 = 256;
pub(super) const OWNER: &str = "lazydesigner-rgba8-v1";

// Conversion and editing have one identical field whitelist. Keep supported
// imported UV-grid metadata byte-for-byte when it matches the project.
const ALLOWED_FIELDS: [&str; 10] = [
    "uuid", "name", "source", "internal", "wrap_mode",
    "render_mode", "render_sides", "paint_owner", "uv_width", "uv_height",
];

pub(super) fn editable(texture: &Value) -> bool {
    let Some(fields) = texture.as_object() else { return false; };
    fields.keys().all(|key| ALLOWED_FIELDS.contains(&key.as_str())) &&
        fields.get("paint_owner").and_then(Value::as_str) == Some(OWNER) &&
        fields.get("internal") == Some(&Value::Bool(true)) &&
        fields.get("wrap_mode").and_then(Value::as_str) == Some("limited") &&
        fields.get("render_mode").and_then(Value::as_str) == Some("default") &&
        fields.get("render_sides").and_then(Value::as_str) == Some("double")
}

// Metadata-only eligibility for an explicit Enable Painting UI action.
// The Rust operation always decodes and validates the complete PNG before
// admitting it. Never touch external paths, layers, frames or unknown fields.
pub(super) fn adoptable(texture: &Value, width: u32, height: u32) -> bool {
    if size(width, height).is_err() { return false; }
    let Some(fields) = texture.as_object() else { return false; };
    fields.keys().all(|key| ALLOWED_FIELDS.contains(&key.as_str())) &&
        !fields.contains_key("paint_owner") &&
        fields.get("internal") == Some(&Value::Bool(true)) &&
        fields.get("wrap_mode").and_then(Value::as_str) == Some("limited") &&
        fields.get("render_mode").and_then(Value::as_str) == Some("default") &&
        fields.get("render_sides").and_then(Value::as_str) == Some("double") &&
        fields.get("source").and_then(Value::as_str)
            .is_some_and(|source| source.starts_with(PREFIX)) &&
        fields.get("uv_width").is_none_or(|v| v.as_u64() == Some(u64::from(width))) &&
        fields.get("uv_height").is_none_or(|v| v.as_u64() == Some(u64::from(height)))
}

/// Metadata-only eligibility; the actual export decodes the PNG.
pub(super) fn exportable(texture: &Value, width: u32, height: u32) -> bool {
    size(width, height).is_ok() &&
        (editable(texture) || adoptable(texture, width, height)) &&
        texture.get("source").and_then(Value::as_str)
            .is_some_and(|source| source.starts_with(PREFIX)) &&
        texture.get("uv_width").is_none_or(|v| v.as_u64() == Some(u64::from(width))) &&
        texture.get("uv_height").is_none_or(|v| v.as_u64() == Some(u64::from(height)))
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
    // Decode the complete image before staging it in the Rust document.
    // Store original bytes verbatim; do not re-encode on import.
    let _ = decode(&asset, width, height)?;
    if STANDARD.decode(encoded).map_err(|_| "PAINT_PNG_SOURCE_INVALID")?.len()
        > MAX_IMPORT_PNG_BYTES {
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    Ok(asset)
}

fn decode(texture: &Value, width: u32, height: u32) -> Result<Vec<u8>> {
    if !editable(texture) { return Err("PAINT_TEXTURE_NOT_OWNED".into()); }
    if texture.get("uv_width").is_some_and(|v| v.as_u64() != Some(u64::from(width))) ||
       texture.get("uv_height").is_some_and(|v| v.as_u64() != Some(u64::from(height))) {
        return Err("PAINT_PNG_FORMAT_UNSUPPORTED".into());
    }
    decode_rgba8_source(texture, width, height)
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
    if swaps.is_empty() || swaps.len() > 32 {
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

    // Pixel count is bounded by the existing 256² RGBA8 codec; never
    // recurse or grow data structures in proportion to untrusted PNG bytes.
    let mut visited = vec![false; w * h];
    let mut stack = vec![seed];
    while let Some(index) = stack.pop() {
        if visited[index] { continue; }
        visited[index] = true;
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
