//! Bounded, source-only inspection of explicit UV atlas aliases.
//! This does not decode the rendered mesh or prove visual face coverage.
use super::{
    AuthoringDocument, Cube, FACE_NAMES, Result, check_box_uv_repack_rules,
    cube_auto_uv, cube_box_uv, face_uv, has_per_texture_uv_rules,
    refresh_box_uv, paint,
};
use serde_json::{json, Value};

const MAX_OVERLAP_DETAILS: usize = 32;

/// Transient placement plan; source-of-truth UV/Texture edits stay in Rust.
pub(super) struct BoxUvIsolationPlan {
    pub texture_index: usize,
    pub next_offset: [f64; 2],
    pub copies: Vec<paint::UvCopyRegion>,
}

/// Rehome one Cube's Box UV into unused atlas pixels, retaining all source
/// pixels and copying only its explicit face regions. No atlas resizing.
pub(super) fn plan_box_uv_isolation(
    doc: &AuthoringDocument, cube_uuid: &str, texture_uuid: &str,
) -> Result<BoxUvIsolationPlan> {
    doc.validate()?;
    if has_per_texture_uv_rules(doc) {
        return Err("UV_ATLAS_RULESET_UNSUPPORTED".into());
    }
    let (w,h) = (doc.resolution.width, doc.resolution.height);
    if w == 0 || h == 0 || w > 256 || h > 256 {
        return Err("UV_ATLAS_DIMENSIONS_UNSUPPORTED".into());
    }
    let ids: Vec<_> = doc.texture_assets.iter().enumerate()
        .filter(|(_,asset)| asset.get("uuid").and_then(Value::as_str)
            == Some(texture_uuid)).map(|(i,_)| i).collect();
    let texture_index = match ids.as_slice() {
        [] => return Err("UV_ATLAS_TEXTURE_NOT_FOUND".into()),
        [i] => *i,
        _ => return Err("UV_ATLAS_TEXTURE_ID_AMBIGUOUS".into()),
    };
    let texture = &doc.texture_assets[texture_index];
    if !paint::editable(texture) {
        return Err("UV_ATLAS_TEXTURE_NOT_OWNED".into());
    }
    let bitmap = paint::decode_for_uv_inspection(texture,w,h)?;
    let cube = doc.cubes.iter().find(|c| c.uuid == cube_uuid)
        .ok_or_else(|| "UV_ATLAS_CUBE_NOT_FOUND".to_string())?;
    if !cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false)) {
        return Err("UV_ATLAS_BOX_UV_REQUIRED".into());
    }
    let original_offset = cube.uv_offset.unwrap_or([0.0,0.0]);
    if !original_offset.iter().all(|v| v.is_finite() && v.fract() == 0.0) {
        return Err("UV_ATLAS_BOX_OFFSET_UNSUPPORTED".into());
    }
    let projected = project_supported_uv(doc,cube)
        .map_err(|_| "UV_ATLAS_BOX_RULES_UNSUPPORTED".to_string())?;
    let mut source = Vec::new();
    for side in FACE_NAMES {
        let face = cube.faces.get(side)
            .ok_or_else(|| "UV_ATLAS_FACE_INVALID".to_string())?;
        match face.get("texture") {
            Some(Value::Null) | Some(Value::Bool(false)) => continue,
            Some(_) if linked_to(face,texture_uuid,texture_index) => {},
            _ => return Err("UV_ATLAS_TARGET_TEXTURE_UNSUPPORTED".into()),
        }
        if face.get("enabled").is_some_and(|v| v != &Value::Bool(true)) {
            return Err("UV_ATLAS_FACE_RULES_UNSUPPORTED".into());
        }
        source.push(rectangle(doc,&projected,side)
            .map_err(|_| "UV_ATLAS_SOURCE_UV_UNSUPPORTED".to_string())?);
    }
    if source.is_empty() { return Err("UV_ATLAS_NO_MAPPED_FACES".into()); }
    for i in 0..source.len() {
        for j in i+1..source.len() {
            if overlap(source[i].0,source[i].1,source[j].0,source[j].1).is_some() {
                return Err("UV_ATLAS_SOURCE_FACES_OVERLAP".into());
            }
        }
    }
    let min_x = source.iter().map(|s|s.0[0]).min().unwrap_or(0);
    let min_y = source.iter().map(|s|s.0[1]).min().unwrap_or(0);
    let max_x = source.iter().map(|s|s.1[0]).max().unwrap_or(0);
    let max_y = source.iter().map(|s|s.1[1]).max().unwrap_or(0);
    let (net_w,net_h) = (max_x-min_x,max_y-min_y);
    let mut occupied = vec![false;(w*h) as usize];
    for (i,pixel) in bitmap.chunks_exact(4).enumerate() {
        occupied[i] = pixel != [0,0,0,0];
    }
    // Every explicit face referring to this atlas reserves its exact pixels.
    // Missing/default links may still resolve to this atlas in Blockbench.
    for other in &doc.cubes {
        let mut projected_other: Option<Cube> = None;
        for side in FACE_NAMES {
            let face = other.faces.get(side)
                .ok_or_else(|| "UV_ATLAS_FACE_INVALID".to_string())?;
            let used = match face.get("texture") {
                Some(Value::Null) | Some(Value::Bool(false)) => false,
                Some(Value::String(id)) => id == texture_uuid,
                Some(Value::Number(i)) => i.as_u64() == Some(texture_index as u64),
                None => return Err("UV_ATLAS_IMPLICIT_TEXTURE_UNSUPPORTED".into()),
                _ => return Err("UV_ATLAS_FACE_TEXTURE_UNSUPPORTED".into()),
            };
            if !used { continue; }
            if face.get("enabled").is_some_and(|v| v != &Value::Bool(true)) {
                return Err("UV_ATLAS_FACE_RULES_UNSUPPORTED".into());
            }
            if projected_other.is_none() {
                projected_other = Some(project_supported_uv(doc,other)
                    .map_err(|_| "UV_ATLAS_OTHER_UV_UNSUPPORTED".to_string())?);
            }
            let (from,to) = rectangle(doc,projected_other.as_ref().unwrap(),side)
                .map_err(|_| "UV_ATLAS_OTHER_UV_UNSUPPORTED".to_string())?;
            for y in from[1]..to[1] {
                for x in from[0]..to[0] {
                    occupied[(y*w+x) as usize] = true;
                }
            }
        }
    }
    // Summed area makes each candidate-face overlap check constant time,
    // with a bounded 256x256 scan instead of a pixel-by-pixel search.
    let stride = w as usize + 1;
    let mut sum = vec![0u32;stride * (h as usize + 1)];
    for y in 0..h as usize {
        for x in 0..w as usize {
            sum[(y+1)*stride+x+1] = u32::from(occupied[y*w as usize+x]) +
                sum[y*stride+x+1] + sum[(y+1)*stride+x] - sum[y*stride+x];
        }
    }
    let blocked = |x0:usize,y0:usize,x1:usize,y1:usize| {
        sum[y1*stride+x1]+sum[y0*stride+x0] -
        sum[y0*stride+x1]-sum[y1*stride+x0] > 0
    };
    for y in 0..=h-net_h {
        for x in 0..=w-net_w {
            let mut copies = Vec::with_capacity(source.len());
            for &(from,to) in &source {
                let dst = [x+from[0]-min_x,y+from[1]-min_y];
                if blocked(dst[0] as usize,dst[1] as usize,
                    (x+to[0]-min_x) as usize,(y+to[1]-min_y) as usize) {
                    copies.clear();
                    break;
                }
                copies.push(paint::UvCopyRegion { from,to:dst,
                    size:[to[0]-from[0],to[1]-from[1]] });
            }
            if copies.is_empty() { continue; }
            let next_offset = [
                original_offset[0]+f64::from(x)-f64::from(min_x),
                original_offset[1]+f64::from(y)-f64::from(min_y)
            ];
            if !next_offset.iter().all(|v|v.is_finite() && v.abs()<=100_000.0) {
                return Err("UV_ATLAS_OFFSET_INVALID".into());
            }
            return Ok(BoxUvIsolationPlan { texture_index,next_offset,copies });
        }
    }
    Err("UV_ATLAS_NO_FREE_SPACE".into())
}


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
    inspect_cube_uv_sharing_for_faces(doc, cube_uuid, texture_uuid, None)
}

/// Internal selected-focus mode for the guarded Paint operation. Other
/// faces, including those on this Cube, remain possible atlas consumers.
pub(super) fn inspect_cube_uv_sharing_for_faces(
    doc: &AuthoringDocument, cube_uuid: &str, texture_uuid: &str,
    selected_faces: Option<&[&str]>,
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
        if selected_faces.is_some_and(|names| !names.contains(&side)) { continue; }
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
            // A selected target's unsupported mapping was already counted.
            // An unselected face on that Cube must still count as unresolved
            // if its atlas coordinates cannot be projected safely.
            let counted_as_focus = other.uuid == cube_uuid &&
                selected_faces.is_none_or(|names| names.contains(&side));
            if face.get("enabled").is_some_and(|v| !v.is_boolean()) {
                if !counted_as_focus { unresolved_explicit += 1; }
                continue;
            }
            let (other_from, other_to) = match &projection {
                Ok(cube) => match rectangle(doc, cube, side) {
                    Ok(region) => region,
                    Err(_) => {
                        if !counted_as_focus { unresolved_explicit += 1; }
                        continue;
                    }
                },
                Err(_) => {
                    if !counted_as_focus { unresolved_explicit += 1; }
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
