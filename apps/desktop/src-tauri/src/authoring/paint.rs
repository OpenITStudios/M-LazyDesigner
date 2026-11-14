//! Bounded Rust-owned RGBA8 Paint transactions for new LazyDesigner textures.
//! Imported PNGs remain opaque and are never rewritten through this path.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::io::Cursor;

type Result<T> = std::result::Result<T, String>;
const PREFIX: &str = "data:image/png;base64,";
const MAX_PNG_BYTES: usize = 2 * 1024 * 1024;
const MAX_SIDE: u32 = 256;
pub(super) const OWNER: &str = "lazydesigner-rgba8-v1";

pub(super) fn editable(texture: &Value) -> bool {
    let Some(fields) = texture.as_object() else { return false; };
    // Re-encoding must not silently strip imported/extended texture metadata.
    const ALLOWED: [&str; 8] = [
        "uuid", "name", "source", "internal", "wrap_mode",
        "render_mode", "render_sides", "paint_owner",
    ];
    fields.keys().all(|key| ALLOWED.contains(&key.as_str())) &&
        fields.get("paint_owner").and_then(Value::as_str) == Some(OWNER) &&
        fields.get("internal") == Some(&Value::Bool(true)) &&
        fields.get("wrap_mode").and_then(Value::as_str) == Some("limited") &&
        fields.get("render_mode").and_then(Value::as_str) == Some("default") &&
        fields.get("render_sides").and_then(Value::as_str) == Some("double")
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

pub(super) fn create(uuid: &str, name: &str, width: u32, height: u32) -> Result<Value> {
    if name.trim().is_empty() || name.chars().count() > 80 ||
        name.chars().any(char::is_control) {
        return Err("PAINT_NAME_INVALID".into());
    }
    let pixels = vec![0; size(width, height)?];
    let source = encode(width, height, &pixels)?;
    Ok(json!({
        "uuid": uuid,
        "name": name,
        "source": source,
        "internal": true,
        "wrap_mode": "limited",
        "render_mode": "default",
        "render_sides": "double",
        "paint_owner": OWNER,
    }))
}

fn decode(texture: &Value, width: u32, height: u32) -> Result<Vec<u8>> {
    if !editable(texture) { return Err("PAINT_TEXTURE_NOT_OWNED".into()); }
    let source = texture.get("source").and_then(Value::as_str)
        .and_then(|text| text.strip_prefix(PREFIX))
        .ok_or("PAINT_PNG_SOURCE_INVALID")?;
    if source.len() > MAX_PNG_BYTES * 4 / 3 + 8 {
        return Err("PAINT_PNG_TOO_LARGE".into());
    }
    let bytes = STANDARD.decode(source).map_err(|_| "PAINT_PNG_SOURCE_INVALID")?;
    if bytes.len() > MAX_PNG_BYTES { return Err("PAINT_PNG_TOO_LARGE".into()); }
    let decoder = png::Decoder::new(Cursor::new(bytes));
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
    Ok(pixels)
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

/// A filled, inclusive rectangle in the bounded generated RGBA8 atlas.
/// The two corners may arrive in either order; a single edit is one Undo step.
pub(super) fn rectangle(
    texture: &mut Value, width: u32, height: u32,
    from: [u32; 2], to: [u32; 2], rgba: [u8; 4], erase: bool,
) -> Result<()> {
    if from[0] >= width || from[1] >= height ||
        to[0] >= width || to[1] >= height {
        return Err("PAINT_COORDINATE_INVALID".into());
    }
    let mut pixels = decode(texture, width, height)?;
    let desired = if erase { [0, 0, 0, 0] } else { rgba };
    let x0 = from[0].min(to[0]) as usize;
    let x1 = from[0].max(to[0]) as usize;
    let y0 = from[1].min(to[1]) as usize;
    let y1 = from[1].max(to[1]) as usize;
    let mut changed = false;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let at = (y * width as usize + x) * 4;
            if pixels[at..at + 4] != desired {
                pixels[at..at + 4].copy_from_slice(&desired);
                changed = true;
            }
        }
    }
    if !changed { return Ok(()); }
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
