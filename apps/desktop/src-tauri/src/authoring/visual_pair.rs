//! Read-only reference/capture PNG evidence for the Rust authoring host.
//! A paired image digest/alpha overlap is NOT model visual acceptance.
//! Actual camera matching, reference approval, craft and viewport interpretation
//! remain outside this deterministic image byte inspector.
use super::{sha256, Result};
use serde_json::{json, Value};
use std::io::Cursor;

pub const MAX_VISUAL_PNG_BYTES: usize = 8 * 1024 * 1024;
const FOCUS_GRID: usize = 4;
const MAX_FOCUS_REGIONS: usize = 4;
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

// Exclusive end coordinates. These are source-pixel positions, not Cube IDs
// or authorized 3D corrections; every update reuses the existing PNG scan.
fn include_pixel(bounds: &mut Option<[u32; 4]>, x: u32, y: u32) {
    if let Some(rect) = bounds {
        rect[0] = rect[0].min(x);
        rect[1] = rect[1].min(y);
        rect[2] = rect[2].max(x + 1);
        rect[3] = rect[3].max(y + 1);
    } else {
        *bounds = Some([x, y, x + 1, y + 1]);
    }
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
    let mut reference_bounds = None;
    let mut capture_bounds = None;
    let mut missing_bounds = None;
    let mut excess_bounds = None;
    let mut missing = 0u64;
    let mut excess = 0u64;
    let mut missing_tiles = [0u64; FOCUS_GRID * FOCUS_GRID];
    let mut excess_tiles = [0u64; FOCUS_GRID * FOCUS_GRID];
    for (index, (a, b)) in source.rgba.chunks_exact(4)
        .zip(candidate.rgba.chunks_exact(4)).enumerate() {
        let sa = a[3] != 0;
        let sb = b[3] != 0;
        if source.has_alpha && candidate.has_alpha {
            let x = (index as u32) % source.width;
            let y = (index as u32) / source.width;
            if sa { include_pixel(&mut reference_bounds, x, y); }
            if sb { include_pixel(&mut capture_bounds, x, y); }
            if sa != sb {
                let tx = (x as usize * FOCUS_GRID) / source.width as usize;
                let ty = (y as usize * FOCUS_GRID) / source.height as usize;
                let tile = ty * FOCUS_GRID + tx;
                if sa {
                    missing += 1;
                    missing_tiles[tile] += 1;
                    include_pixel(&mut missing_bounds, x, y);
                } else {
                    excess += 1;
                    excess_tiles[tile] += 1;
                    include_pixel(&mut excess_bounds, x, y);
                }
            }
        }
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
    let measured = silhouette_state == "alpha_overlap_measured";
    let alpha_iou = measured.then(|| intersection as f64 / union as f64);
    // Compact, stable top-four 4x4 regions. The grid is only a coarse
    // pointer to pixel mismatch; it cannot identify an offending Cube.
    let mut regions = Vec::new();
    if measured {
        let mut ranked = Vec::new();
        for tile in 0..missing_tiles.len() {
            if missing_tiles[tile] > 0 {
                ranked.push((missing_tiles[tile], tile, "missing"));
            }
            if excess_tiles[tile] > 0 {
                ranked.push((excess_tiles[tile], tile, "excess"));
            }
        }
        ranked.sort_by(|a, b| b.0.cmp(&a.0)
            .then(a.1.cmp(&b.1)).then(a.2.cmp(b.2)));
        for (pixel_count, tile, kind) in ranked.into_iter().take(MAX_FOCUS_REGIONS) {
            let tx = (tile % FOCUS_GRID) as u32;
            let ty = (tile / FOCUS_GRID) as u32;
            let n = FOCUS_GRID as u32;
            let bounds = [
                (tx * source.width).div_ceil(n),
                (ty * source.height).div_ceil(n),
                ((tx + 1) * source.width).div_ceil(n),
                ((ty + 1) * source.height).div_ceil(n),
            ];
            regions.push(json!({
                "kind":kind,"pixel_count":pixel_count,"bounds":bounds
            }));
        }
    }
    let localization = json!({
        "status":if measured { "pixel_mask_mismatch_measured" } else { "unassessed" },
        "missing_from_capture_pixels":measured.then_some(missing),
        "excess_in_capture_pixels":measured.then_some(excess),
        "reference_foreground_bounds":if measured { reference_bounds } else { None },
        "capture_foreground_bounds":if measured { capture_bounds } else { None },
        "missing_bounds":if measured { missing_bounds } else { None },
        "excess_bounds":if measured { excess_bounds } else { None },
        "priority_regions":regions
    });
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
            "alpha_iou":alpha_iou,
            "localization":localization
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
    fn localizes_missing_and_excess_alpha_without_assigning_a_cube() {
        // One foreground pair matches; missing at (0,1), extra at (3,0).
        // Different regions have the same count: scan-tile order is stable.
        let mut ref_mask = vec![0u8; 4 * 4 * 4];
        let mut current_mask = ref_mask.clone();
        for (buffer, points) in [
            (&mut ref_mask, [(0usize,0usize),(0,1),(3,3)]),
            (&mut current_mask, [(0usize,0usize),(3,0),(3,3)]),
        ] {
            for (x,y) in points {
                buffer[(y * 4 + x) * 4 + 3] = 255;
            }
        }
        let reference = encoded(4,4,true,&ref_mask);
        let capture = encoded(4,4,true,&current_mask);
        let report = inspect_visual_png_pair(&reference,&capture).unwrap();
        let local = &report["silhouette"]["localization"];
        assert_eq!(local["status"],"pixel_mask_mismatch_measured");
        assert_eq!(local["missing_from_capture_pixels"],1);
        assert_eq!(local["excess_in_capture_pixels"],1);
        assert_eq!(local["reference_foreground_bounds"],json!([0,0,4,4]));
        assert_eq!(local["capture_foreground_bounds"],json!([0,0,4,4]));
        assert_eq!(local["missing_bounds"],json!([0,1,1,2]));
        assert_eq!(local["excess_bounds"],json!([3,0,4,1]));
        assert_eq!(local["priority_regions"][0]["kind"],"excess");
        assert_eq!(local["priority_regions"][0]["bounds"],json!([3,0,4,1]));
        assert_eq!(local["priority_regions"][1]["kind"],"missing");
        assert_eq!(local["priority_regions"][1]["bounds"],json!([0,1,1,2]));
        assert_eq!(report["silhouette"]["alpha_iou"],0.5);
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
    }
    #[test]
    fn unassessed_images_never_expose_actionable_mask_hotspots() {
        let rgb = encoded(1,1,false,&[1,2,3]);
        let transparent = encoded(1,1,true,&[1,2,3,0]);
        let report = inspect_visual_png_pair(&rgb,&transparent).unwrap();
        let local = &report["silhouette"]["localization"];
        assert_eq!(local["status"],"unassessed");
        assert!(local["missing_from_capture_pixels"].is_null());
        assert!(local["reference_foreground_bounds"].is_null());
        assert_eq!(local["priority_regions"],json!([]));
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
    }
    #[test]
    fn same_mask_reports_no_mismatch_and_tiny_images_have_bounded_tiles() {
        let rgba = encoded(1,2,true,&[
            0,0,0,255, 0,0,0,0
        ]);
        let report = inspect_visual_png_pair(&rgba,&rgba).unwrap();
        let local = &report["silhouette"]["localization"];
        assert_eq!(local["status"],"pixel_mask_mismatch_measured");
        assert_eq!(local["missing_from_capture_pixels"],0);
        assert_eq!(local["excess_in_capture_pixels"],0);
        assert!(local["missing_bounds"].is_null());
        assert_eq!(local["priority_regions"],json!([]));
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
