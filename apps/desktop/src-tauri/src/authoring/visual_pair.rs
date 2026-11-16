//! Read-only reference/capture PNG evidence for the Rust authoring host.
//! A paired image digest/alpha overlap is NOT model visual acceptance.
//! Actual camera matching, reference approval, craft and viewport interpretation
//! remain outside this deterministic image byte inspector.
use super::{sha256, Result};
use serde_json::{json, Value};
use std::io::Cursor;

pub const MAX_VISUAL_PNG_BYTES: usize = 8 * 1024 * 1024;
const MAX_VISUAL_SIDE: u32 = 2048;
const MAX_VISUAL_PIXELS: u64 = 2_097_152;

struct Raster {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    has_alpha: bool,
}

fn decode(bytes: &[u8]) -> Result<Raster> {
    if bytes.len() < 8 || bytes.len() > MAX_VISUAL_PNG_BYTES ||
        !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("VISUAL_PAIR_PNG_INVALID".into());
    }
    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info()
        .map_err(|_| "VISUAL_PAIR_PNG_DECODE_FAILED".to_string())?;
    let info = reader.info();
    let width = info.width;
    let height = info.height;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > MAX_VISUAL_SIDE ||
        height > MAX_VISUAL_SIDE || pixels > MAX_VISUAL_PIXELS {
        return Err("VISUAL_PAIR_PNG_DIMENSIONS_UNSUPPORTED".into());
    }
    if info.bit_depth != png::BitDepth::Eight ||
        info.interlaced || info.animation_control.is_some() {
        return Err("VISUAL_PAIR_PNG_FORMAT_UNSUPPORTED".into());
    }
    // No implicit conversion, interpolation or palette/alpha assumptions.
    let channels = match info.color_type {
        png::ColorType::Rgb => 3usize,
        png::ColorType::Rgba => 4usize,
        _ => return Err("VISUAL_PAIR_PNG_FORMAT_UNSUPPORTED".into()),
    };
    let expected = pixels as usize * channels;
    if reader.output_buffer_size() != expected {
        return Err("VISUAL_PAIR_PNG_FORMAT_UNSUPPORTED".into());
    }
    let mut raw = vec![0u8; expected];
    let frame = reader.next_frame(&mut raw)
        .map_err(|_| "VISUAL_PAIR_PNG_DECODE_FAILED".to_string())?;
    if frame.buffer_size() != expected {
        return Err("VISUAL_PAIR_PNG_FORMAT_UNSUPPORTED".into());
    }
    let rgba = if channels == 4 {
        raw
    } else {
        let mut pixels_rgba = Vec::with_capacity(pixels as usize * 4);
        for pixel in raw.chunks_exact(3) {
            pixels_rgba.extend_from_slice(pixel);
            pixels_rgba.push(255);
        }
        pixels_rgba
    };
    Ok(Raster { width, height, rgba, has_alpha: channels == 4 })
}

/// Compare two unmodified operator-selected image files. The caller must bind
/// each file's exact SHA to the source .bbmodel revision and to one compatible
/// view/framing. Numeric comparison does not load images into the AI vision
/// context and cannot infer intended material, shading, timing or user approval.
pub fn inspect_visual_png_pair(reference: &[u8], capture: &[u8]) -> Result<Value> {
    let source = decode(reference)?;
    let candidate = decode(capture)?;
    if source.width != candidate.width || source.height != candidate.height {
        return Err("VISUAL_PAIR_DIMENSION_MISMATCH".into());
    }
    let mut reference_visible = 0u64;
    let mut capture_visible = 0u64;
    let mut intersection = 0u64;
    let mut union = 0u64;
    let mut differing_rgba = 0u64;
    let mut differing_rgb = 0u64;
    for (a, b) in source.rgba.chunks_exact(4).zip(candidate.rgba.chunks_exact(4)) {
        let sa = a[3] != 0;
        let sb = b[3] != 0;
        reference_visible += u64::from(sa);
        capture_visible += u64::from(sb);
        intersection += u64::from(sa && sb);
        union += u64::from(sa || sb);
        differing_rgba += u64::from(a != b);
        differing_rgb += u64::from(a[..3] != b[..3]);
    }
    let total = u64::from(source.width) * u64::from(source.height);
    let silhouette_state =
        if !source.has_alpha || !candidate.has_alpha {
            "unassessed_no_alpha_channel"
        } else if union == 0 {
            "unassessed_empty_foreground"
        } else if reference_visible == total && capture_visible == total {
            "unassessed_opaque_background"
        } else {
            "alpha_overlap_measured"
        };
    let alpha_iou = if silhouette_state == "alpha_overlap_measured" {
        Some(intersection as f64 / union as f64)
    } else {
        None
    };
    Ok(json!({
        "scope":"operator_selected_saved_png_pair",
        "reference_png_sha256":sha256(reference),
        "capture_png_sha256":sha256(capture),
        "width":source.width,"height":source.height,
        "reference_has_alpha":source.has_alpha,
        "capture_has_alpha":candidate.has_alpha,
        "different_rgba_pixels":differing_rgba,
        "different_rgb_pixels":differing_rgb,
        "silhouette":{
            "status":silhouette_state,
            "reference_foreground_pixels":reference_visible,
            "capture_foreground_pixels":capture_visible,
            "intersection_pixels":intersection,
            "union_pixels":union,
            "alpha_iou":alpha_iou
        },
        "reference_approval":"NOT_VERIFIED_BY_INSPECTOR",
        "capture_provenance":"CALLER_ASSERTED_NOT_NATIVE_VERIFIED",
        "framing_correspondence":"NOT_VERIFIED_BY_INSPECTOR",
        "visual_verdict":"UNVERIFIED",
        "artistic_verdict":"NOT_EVALUATED"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(width:u32,height:u32,rgba:bool,pixels:&[u8])->Vec<u8>{
        let mut bytes=Vec::new();
        {
            let mut encoder=png::Encoder::new(&mut bytes,width,height);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_color(if rgba {png::ColorType::Rgba} else {png::ColorType::Rgb});
            let mut writer=encoder.write_header().unwrap();
            writer.write_image_data(pixels).unwrap();
        }
        bytes
    }

    #[test]
    fn alpha_mask_disagreement_produces_evidence_not_artistic_pass() {
        let ref_png=encoded(2,2,true,&[
            50,60,70,255, 60,70,80,255,
            0,0,0,0, 0,0,0,0,
        ]);
        let capture=encoded(2,2,true,&[
            50,60,70,255, 0,0,0,0,
            60,70,80,255, 0,0,0,0,
        ]);
        let report=inspect_visual_png_pair(&ref_png,&capture).unwrap();
        assert_eq!(report["scope"],"operator_selected_saved_png_pair");
        assert_eq!(report["silhouette"]["status"],"alpha_overlap_measured");
        assert_eq!(report["silhouette"]["intersection_pixels"],1);
        assert_eq!(report["silhouette"]["union_pixels"],3);
        assert!(report["silhouette"]["alpha_iou"].as_f64().unwrap() < 0.34);
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
        assert_eq!(report["artistic_verdict"],"NOT_EVALUATED");
        assert_eq!(report["capture_png_sha256"],sha256(&capture));
    }
    #[test]
    fn fully_opaque_images_or_missing_alpha_cannot_fake_silhouette_pass() {
        let rgb=encoded(2,1,false,&[1,2,3,4,5,6]);
        let opaque=encoded(2,1,true,&[1,2,3,255,4,5,6,255]);
        let report=inspect_visual_png_pair(&rgb,&opaque).unwrap();
        assert_eq!(report["silhouette"]["status"],"unassessed_no_alpha_channel");
        assert!(report["silhouette"]["alpha_iou"].is_null());
        let same=inspect_visual_png_pair(&opaque,&opaque).unwrap();
        assert_eq!(same["silhouette"]["status"],"unassessed_opaque_background");
        assert_eq!(same["different_rgba_pixels"],0);
        assert_eq!(same["visual_verdict"],"UNVERIFIED");
    }
    #[test]
    fn rejects_dimension_mismatch_and_unsupported_images() {
        let small=encoded(1,1,true,&[1,2,3,255]);
        let large=encoded(2,1,true,&[1,2,3,255,4,5,6,255]);
        assert_eq!(inspect_visual_png_pair(&small,&large).unwrap_err(),
            "VISUAL_PAIR_DIMENSION_MISMATCH");
        assert_eq!(inspect_visual_png_pair(&small,b"invalid").unwrap_err(),
            "VISUAL_PAIR_PNG_INVALID");
        let rgb=encoded(1,1,false,&[1,2,3]);
        let report=inspect_visual_png_pair(&rgb,&small).unwrap();
        assert_eq!(report["silhouette"]["status"],"unassessed_no_alpha_channel");
    }
}
