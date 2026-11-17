//! Semantic Cube face-local Paint regions.
//! Authoring uses the single Rust PNG bitmap, transaction and Undo owner.
//! Blockbench Cube.updateUV corner rotations are interpreted as physical
//! atlas-pixel rectangles. This is not visual/material quality evidence.

use super::{
    check_box_uv_repack_rules, cube_auto_uv, cube_box_uv, face_uv,
    has_per_texture_uv_rules, paint, refresh_box_uv, uv_sharing,
    AuthoringDocument, CubeFaceRegionPaintPatch, PaintRectangleStep, Result, FACE_NAMES,
};
use serde_json::Value;
use std::collections::HashSet;

const MAX_FACE_REGIONS: usize = 64;

/// Map a half-open rectangle in *displayed Cube face pixel coordinates* to
/// the half-open rectangle in its PNG. Signed UV and 90-degree rotations are
/// derived from Blockbench v5.2.1 Cube.updateUV's four-vertex permutation.
/// Face-local (0,0) is the first displayed UV corner; this does not interpret
/// shader filtering, texture animation or native painter state.
pub(super) fn face_local_pixel_rectangle(
    texture_width: u32, texture_height: u32, uv: [f64; 4],
    rotation: u16, from: [u32; 2], to: [u32; 2],
) -> Result<([u32; 2], [u32; 2])> {
    // The canonical helper admits integral nonempty rectangles within atlas.
    let (atlas_min, atlas_max) =
        paint::uv_pixel_rectangle(texture_width, texture_height, uv)?;
    if !matches!(rotation, 0 | 90 | 180 | 270) {
        return Err("PAINT_FACE_REGION_ROTATION_UNSUPPORTED".into());
    }
    // Every original corner is an integral, bounded atlas coordinate now.
    let u0 = uv[0] as i64;
    let v0 = uv[1] as i64;
    let u1 = uv[2] as i64;
    let v1 = uv[3] as i64;
    let mut corners = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]];
    for _ in 0..rotation / 90 {
        // Blockbench Cube.updateUV:
        // c0 <- c2, c2 <- c3, c3 <- c1, c1 <- c0
        corners = [corners[2], corners[0], corners[3], corners[1]];
    }
    let du = [corners[1][0] - corners[0][0],
              corners[1][1] - corners[0][1]];
    let dv = [corners[2][0] - corners[0][0],
              corners[2][1] - corners[0][1]];
    let face_size = [
        (du[0].abs() + du[1].abs()) as u32,
        (dv[0].abs() + dv[1].abs()) as u32,
    ];
    if from[0] >= to[0] || from[1] >= to[1] ||
       to[0] > face_size[0] || to[1] > face_size[1] {
        return Err("PAINT_FACE_REGION_BOUNDS_INVALID".into());
    }
    let project = |pixel: [u32; 2]| -> [i64; 2] {
        [
            corners[0][0] + du[0].signum() * i64::from(pixel[0])
                + dv[0].signum() * i64::from(pixel[1]),
            corners[0][1] + du[1].signum() * i64::from(pixel[0])
                + dv[1].signum() * i64::from(pixel[1]),
        ]
    };
    let a = project(from);
    let b = project(to);
    let from_atlas = [
        u32::try_from(a[0].min(b[0]))
            .map_err(|_| "PAINT_FACE_REGION_BOUNDS_INVALID")?,
        u32::try_from(a[1].min(b[1]))
            .map_err(|_| "PAINT_FACE_REGION_BOUNDS_INVALID")?,
    ];
    let to_atlas = [
        u32::try_from(a[0].max(b[0]))
            .map_err(|_| "PAINT_FACE_REGION_BOUNDS_INVALID")?,
        u32::try_from(a[1].max(b[1]))
            .map_err(|_| "PAINT_FACE_REGION_BOUNDS_INVALID")?,
    ];
    if from_atlas[0] < atlas_min[0] || from_atlas[1] < atlas_min[1] ||
       to_atlas[0] > atlas_max[0] || to_atlas[1] > atlas_max[1] ||
       from_atlas[0] >= to_atlas[0] || from_atlas[1] >= to_atlas[1] {
        return Err("PAINT_FACE_REGION_BOUNDS_INVALID".into());
    }
    Ok((from_atlas, to_atlas))
}

/// One model-aware transaction paints up to 64 ordered local regions on
/// selected Cube faces without requiring the agent to calculate atlas UVs.
/// Reuse the same exact physical-patch alias guard as the read-only material
/// preflight. Other face aliases may exist OUTSIDE touched rectangles, but
/// incomplete/unsupported UV ownership remains blocked.
pub(super) fn paint_cube_face_regions_guarded(
    doc: &mut AuthoringDocument, cube_uuid: &str,
    texture_uuid: &str, regions: &[CubeFaceRegionPaintPatch],
) -> Result<String> {
    if regions.is_empty() || regions.len() > MAX_FACE_REGIONS {
        return Err("PAINT_FACE_REGIONS_SIZE_INVALID".into());
    }
    let mut seen = HashSet::new();
    let mut faces = Vec::with_capacity(FACE_NAMES.len());
    for region in regions {
        if !FACE_NAMES.contains(&region.face.as_str()) {
            return Err("PAINT_FACE_REGION_UNKNOWN_FACE".into());
        }
        if seen.insert(region.face.as_str()) {
            faces.push(region.face.as_str());
        }
    }
    let report = uv_sharing::inspect_cube_uv_sharing_for_faces(
        doc, cube_uuid, texture_uuid, Some(&faces))?;
    let count = |key| report[key].as_u64().unwrap_or(u64::MAX);
    if count("focused_mapped_faces") != faces.len() as u64 ||
       count("unresolved_explicit_faces") > 0 ||
       count("implicit_reference_faces") > 0 {
        return Err("PAINT_CUBE_UV_GUARD_UNRESOLVED".into());
    }
    if report["report_truncated"] != Value::Bool(false) {
        return Err("PAINT_CUBE_UV_GUARD_UNRESOLVED".into());
    }
    if has_per_texture_uv_rules(doc) {
        return Err("PAINT_CUBE_UV_RULESET_UNSUPPORTED".into());
    }
    let texture_index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| "PAINT_TEXTURE_NOT_FOUND".to_string())?;
    let source_cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| "CUBE_NOT_FOUND".to_string())?;
    let mut projected = source_cube.clone();
    if cube_box_uv(source_cube, doc.meta.box_uv.unwrap_or(false)) {
        check_box_uv_repack_rules(doc, source_cube)
            .map_err(|_| "PAINT_CUBE_UV_RULESET_UNSUPPORTED".to_string())?;
        refresh_box_uv(&mut projected)?;
    } else if cube_auto_uv(source_cube)? != 0 {
        return Err("PAINT_CUBE_AUTO_UV_UNSUPPORTED".into());
    }

    let mut steps = Vec::with_capacity(regions.len());
    for region in regions {
        let surface = projected.faces.get(&region.face)
            .and_then(Value::as_object)
            .ok_or_else(|| "PAINT_CUBE_FACE_INVALID".to_string())?;
        if surface.get("enabled").is_some_and(|flag| flag != &Value::Bool(true)) {
            return Err("PAINT_CUBE_FACE_DISABLED".into());
        }
        let linked = match surface.get("texture") {
            Some(Value::String(uuid)) => uuid == texture_uuid,
            Some(Value::Number(index)) =>
                index.as_u64() == Some(texture_index as u64),
            _ => false,
        };
        if !linked {
            return Err("PAINT_CUBE_FACE_TEXTURE_MISMATCH".into());
        }
        let rotation = match surface.get("rotation") {
            None => 0,
            Some(value) => match value.as_f64() {
                Some(angle) if angle == 0.0 => 0,
                Some(angle) if angle == 90.0 => 90,
                Some(angle) if angle == 180.0 => 180,
                Some(angle) if angle == 270.0 => 270,
                _ => return Err("PAINT_FACE_REGION_ROTATION_UNSUPPORTED".into()),
            },
        };
        let uv = face_uv(&projected, &region.face)?;
        let (from, end) = face_local_pixel_rectangle(
            doc.resolution.width, doc.resolution.height,
            uv, rotation, region.from, region.to,
        )?;
        // Check the ACTUAL projected face-local cluster pixels rather than
        // rejecting a disjoint patch because this face shares other texels.
        // The same helper validates inspector and painter outcomes.
        if uv_sharing::face_patch_has_alias(&report, &region.face, from, end)
            .map_err(|_| "PAINT_CUBE_UV_GUARD_UNRESOLVED".to_string())?
        {
            return Err("PAINT_CUBE_UV_GUARD_SHARED".into());
        }
        steps.push(PaintRectangleStep {
            from, to: [end[0] - 1, end[1] - 1],
            rgba: region.rgba, erase: region.erase,
        });
    }

    let texture = doc.texture_assets.get_mut(texture_index)
        .ok_or_else(|| "PAINT_TEXTURE_NOT_FOUND".to_string())?;
    paint::rectangles(texture, doc.resolution.width, doc.resolution.height, &steps)?;
    Ok(texture_uuid.to_owned())
}
