//! Bounded, source-only inspection of explicit UV atlas aliases.
//! This does not decode the rendered mesh or prove visual face coverage.
use super::{
    AuthoringDocument, Cube, FACE_NAMES, Result, check_box_uv_repack_rules,
    cube_auto_uv, cube_box_uv, face_uv, has_per_texture_uv_rules,
    refresh_box_uv, paint,
};
use serde_json::{json, Value};

const MAX_OVERLAP_DETAILS: usize = 32;

fn linked_to(face: &Value, texture_uuid: &str, texture_index: usize) -> bool {
    match face.get("texture") {
        Some(Value::String(id)) => id == texture_uuid,
        Some(Value::Number(index)) => index.as_u64() == Some(texture_index as u64),
        _ => false,
    }
}

fn project_supported_uv(doc: &AuthoringDocument, cube: &Cube) -> Result<Cube> {
    let mut projected = cube.clone();
    if cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false)) {
        check_box_uv_repack_rules(doc, cube)?;
        // Reconstruct the net on a copy, never trust stale cached face UV.
        refresh_box_uv(&mut projected)?;
    } else if cube_auto_uv(cube)? != 0 {
        return Err("UV_SHARING_AUTO_UV_UNSUPPORTED".into());
    }
    Ok(projected)
}

fn rectangle(
    doc: &AuthoringDocument, cube: &Cube, face: &str,
) -> Result<([u32; 2], [u32; 2])> {
    let uv = face_uv(cube, face)?;
    paint::uv_pixel_rectangle(doc.resolution.width, doc.resolution.height, uv)
}

fn overlap(
    a0: [u32; 2], a1: [u32; 2], b0: [u32; 2], b1: [u32; 2],
) -> Option<([u32; 2], [u32; 2])> {
    let from = [a0[0].max(b0[0]), a0[1].max(b0[1])];
    let to = [a1[0].min(b1[0]), a1[1].min(b1[1])];
    (from[0] < to[0] && from[1] < to[1]).then_some((from, to))
}

/// Compare a selected Cube's *explicitly linked* texture-face UV rectangles
/// with all explicitly linked face regions using the exact same PNG atlas.
/// Includes the selected Cube's other faces; cross-Cube references are not
/// assumed independent. Every intersection requires strictly positive area.
/// Unbound/default Texture references or unsupported mappings are counted
/// as unresolved; zero reported overlaps is NOT a quality/exclusivity PASS.
pub fn inspect_cube_uv_sharing(
    doc: &AuthoringDocument, cube_uuid: &str, texture_uuid: &str,
) -> Result<Value> {
    doc.validate()?;
    if has_per_texture_uv_rules(doc) {
        return Err("UV_SHARING_TEXTURE_RULESET_UNSUPPORTED".into());
    }
    let texture_matches: Vec<usize> = doc.texture_assets.iter().enumerate()
        .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
            == Some(texture_uuid))
        .map(|(index, _)| index).collect();
    let texture_index = match texture_matches.as_slice() {
        [] => return Err("UV_SHARING_TEXTURE_NOT_FOUND".into()),
        [index] => *index,
        _ => return Err("UV_SHARING_TEXTURE_ID_AMBIGUOUS".into()),
    };
    let target = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| "UV_SHARING_CUBE_NOT_FOUND".to_string())?;

    // Extract the focused Cube's eligible face rectangles once.
    let mut focused = Vec::with_capacity(FACE_NAMES.len());
    let mut unresolved_explicit = 0usize;
    let mut implicit_faces = 0usize;
    let target_projection = project_supported_uv(doc, target);
    for side in FACE_NAMES {
        let face = target.faces.get(side)
            .ok_or_else(|| "UV_SHARING_FACE_INVALID".to_string())?;
        if face.get("texture").is_none() {
            implicit_faces += 1;
        }
        if !linked_to(face, texture_uuid, texture_index) { continue; }
        if face.get("enabled") == Some(&Value::Bool(false)) { continue; }
        if face.get("enabled").is_some_and(|v| !v.is_boolean()) {
            unresolved_explicit += 1;
            continue;
        }
        if let Ok(cube) = &target_projection {
            match rectangle(doc, cube, side) {
                Ok((from, to)) => focused.push((side, from, to)),
                Err(_) => unresolved_explicit += 1,
            }
        } else {
            unresolved_explicit += 1;
        }
    }

    let mut collisions = Vec::new();
    let mut pair_count = 0usize;
    // Scan every Cube exactly once, and bound materialized output. An unknown
    // reference never upgrades the result to a source-level exclusivity PASS.
    for other in &doc.cubes {
        let projection = project_supported_uv(doc, other);
        for side in FACE_NAMES {
            let face = other.faces.get(side)
                .ok_or_else(|| "UV_SHARING_FACE_INVALID".to_string())?;
            if other.uuid != cube_uuid && face.get("texture").is_none() {
                implicit_faces += 1;
            }
            if !linked_to(face, texture_uuid, texture_index) { continue; }
            if face.get("enabled") == Some(&Value::Bool(false)) { continue; }
            if other.uuid == cube_uuid {
                // Already counted unsupported focused face mappings above.
                if face.get("enabled").is_some_and(|v| !v.is_boolean()) { continue; }
            } else if face.get("enabled").is_some_and(|v| !v.is_boolean()) {
                unresolved_explicit += 1;
                continue;
            }
            let (other_from, other_to) = match &projection {
                Ok(cube) => match rectangle(doc, cube, side) {
                    Ok(region) => region,
                    Err(_) => {
                        if other.uuid != cube_uuid { unresolved_explicit += 1; }
                        continue;
                    }
                },
                Err(_) => {
                    if other.uuid != cube_uuid { unresolved_explicit += 1; }
                    continue;
                }
            };
            for &(focus_side, focus_from, focus_to) in &focused {
                if other.uuid == cube_uuid && side == focus_side { continue; }
                if let Some((from, to)) = overlap(focus_from, focus_to, other_from, other_to) {
                    pair_count += 1;
                    if collisions.len() < MAX_OVERLAP_DETAILS {
                        collisions.push(json!({
                            "focus_face":focus_side,
                            "other_cube_uuid":other.uuid,
                            "other_face":side,
                            "pixel_rect":[from[0], from[1], to[0], to[1]],
                            "overlap_pixels":(to[0] - from[0]) * (to[1] - from[1]),
                        }));
                    }
                }
            }
        }
    }
    let report = json!({
        "scope":"explicit_texture_uv_overlap",
        "cube_uuid":cube_uuid,
        "texture_uuid":texture_uuid,
        "visual_verdict":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "reference_scope":"explicit_texture_links_only",
        "focused_mapped_faces":focused.len(),
        "declared_overlap_pairs":pair_count,
        "unresolved_explicit_faces":unresolved_explicit,
        "implicit_reference_faces":implicit_faces,
        "report_truncated":pair_count > collisions.len(),
        "overlaps":collisions,
    });
    if serde_json::to_vec(&report)
        .map_err(|_| "UV_SHARING_SERIALIZE_FAILED".to_string())?.len() > 24 * 1024 {
        return Err("UV_SHARING_RESULT_TOO_LARGE".into());
    }
    Ok(report)
}
