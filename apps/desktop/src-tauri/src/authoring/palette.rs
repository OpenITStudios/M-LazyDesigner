//! Bounded palette remapping of already-painted Cube faces.
//! The caller supplies literal before/after RGB swatches from observed source
//! pixels and the intended palette. This module never guesses a material,
//! generates random noise, changes alpha or invents visual approval.
use super::{
    paint, uv_sharing, AuthoringDocument, CubePaletteTarget, PaletteRgbSwap,
    Result, FACE_NAMES,
};
use serde_json::Value;
use std::collections::HashSet;

const MAX_TARGET_CUBES: usize = 16;
const MAX_PALETTE_SWAPS: usize = 32;

/// Recolor explicit, non-overlapping regions across one atlas with one PNG
/// decode+encode and one transaction. Preserve the original hand-painted
/// spatial pattern, invisible RGB and every pixel's original alpha.
pub(super) fn recolor_cube_faces_palette_guarded(
    doc: &mut AuthoringDocument,
    texture_uuid: &str,
    targets: &[CubePaletteTarget],
    palette: &[PaletteRgbSwap],
) -> Result<String> {
    if targets.is_empty() || targets.len() > MAX_TARGET_CUBES {
        return Err("PALETTE_TARGETS_SIZE_INVALID".into());
    }
    if palette.is_empty() || palette.len() > MAX_PALETTE_SWAPS {
        return Err("PALETTE_SWAPS_SIZE_INVALID".into());
    }

    let mut swatches = HashSet::new();
    for swap in palette {
        if !swatches.insert(swap.from) {
            return Err("PALETTE_SWAPS_DUPLICATE_SOURCE".into());
        }
    }
    let mut cubes = HashSet::new();
    for target in targets {
        if !cubes.insert(target.cube_uuid.as_str()) {
            return Err("PALETTE_TARGET_CUBE_DUPLICATE".into());
        }
        if target.faces.is_empty() || target.faces.len() > FACE_NAMES.len() {
            return Err("PALETTE_TARGET_FACES_SIZE_INVALID".into());
        }
        let mut sides = HashSet::new();
        for name in &target.faces {
            if !FACE_NAMES.contains(&name.as_str()) ||
               !sides.insert(name.as_str()) {
                return Err("PALETTE_TARGET_FACE_UNKNOWN_OR_DUPLICATE".into());
            }
        }
    }

    // A face can be linked to the atlas by UUID or numeric Texture index;
    // never infer missing face links or silently color the default texture.
    doc.validate()?;
    let texture_index = doc.texture_assets.iter().position(|asset|
        asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid)
    ).ok_or_else(|| "PALETTE_TEXTURE_NOT_FOUND".to_string())?;

    let mut rectangles = Vec::with_capacity(targets.len() * FACE_NAMES.len());
    for target in targets {
        let names: Vec<&str> = target.faces.iter().map(String::as_str).collect();
        // Enforce exclusive declared pixels, including unselected faces and
        // other Cubes. An unknown implicit reference is not a safe alias.
        let report = uv_sharing::inspect_cube_uv_sharing_for_faces(
            doc, &target.cube_uuid, texture_uuid, Some(&names))?;
        let count = |key| report[key].as_u64().unwrap_or(u64::MAX);
        if count("focused_mapped_faces") != names.len() as u64 ||
           count("unresolved_explicit_faces") > 0 ||
           count("implicit_reference_faces") > 0 {
            return Err("PALETTE_UV_GUARD_UNRESOLVED".into());
        }
        if count("declared_overlap_pairs") > 0 {
            return Err("PALETTE_UV_GUARD_SHARED".into());
        }
        let source_cube = doc.cubes.iter().find(|cube| cube.uuid == target.cube_uuid)
            .ok_or_else(|| "PALETTE_CUBE_NOT_FOUND".to_string())?;
        let projected = uv_sharing::project_supported_uv(doc, source_cube)?;
        for name in &names {
            let face = projected.faces.get(*name).and_then(Value::as_object)
                .ok_or_else(|| "PALETTE_FACE_INVALID".to_string())?;
            if face.get("enabled").is_some_and(|value| value != &Value::Bool(true)) {
                return Err("PALETTE_FACE_DISABLED".into());
            }
            let linked = match face.get("texture") {
                Some(Value::String(id)) => id == texture_uuid,
                Some(Value::Number(index)) =>
                    index.as_u64() == Some(texture_index as u64),
                _ => false,
            };
            if !linked { return Err("PALETTE_FACE_TEXTURE_MISMATCH".into()); }
            rectangles.push(uv_sharing::rectangle(doc, &projected, name)?);
        }
    }

    let texture = doc.texture_assets.get_mut(texture_index)
        .ok_or_else(|| "PALETTE_TEXTURE_NOT_FOUND".to_string())?;
    paint::recolor_regions(texture, doc.resolution.width, doc.resolution.height,
        &rectangles, palette)?;
    Ok(texture_uuid.to_owned())
}
