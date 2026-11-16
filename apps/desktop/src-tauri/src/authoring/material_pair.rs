//! Paired physical-PNG material evidence for one current .bbmodel snapshot.
//! This DOES NOT infer approved-reference identity or visual/artistic quality.
use super::{paint, sha256, AuthoringDocument, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialPatchRegion {
    pub from: [u32; 2],
    pub to: [u32; 2],
}

fn checked_region(region: &MaterialPatchRegion, width: u32, height: u32)
    -> Result<(u32, u32)>
{
    if region.from[0] >= region.to[0] || region.from[1] >= region.to[1] ||
       region.to[0] > width || region.to[1] > height {
        return Err("MATERIAL_PAIR_REGION_INVALID".into());
    }
    let w = region.to[0] - region.from[0];
    let h = region.to[1] - region.from[1];
    if w.checked_mul(h).is_none_or(|pixels| pixels > 4096) {
        return Err("MATERIAL_PAIR_REGION_TOO_LARGE".into());
    }
    Ok((w, h))
}

fn texture_index(doc: &AuthoringDocument, id: &str) -> Result<usize> {
    if !super::valid_uuid(id) {
        return Err("MATERIAL_PAIR_UUID_INVALID".into());
    }
    let mut found = doc.texture_assets.iter().enumerate().filter(|(_, texture)|
        texture.get("uuid").and_then(Value::as_str) == Some(id)
    );
    let index = found.next()
        .ok_or_else(|| "MATERIAL_PAIR_TEXTURE_NOT_FOUND".to_string())?.0;
    if found.next().is_some() {
        return Err("MATERIAL_PAIR_TEXTURE_AMBIGUOUS".into());
    }
    Ok(index)
}

fn pixel(image: &[u8], width: u32, x: u32, y: u32) -> &[u8] {
    let start = ((y * width + x) * 4) as usize;
    &image[start..start + 4]
}

fn evidence(image: &[u8], width: u32, region: &MaterialPatchRegion) -> Value {
    let mut unique = HashSet::new();
    let (mut transparent, mut translucent, mut opaque) = (0u32, 0u32, 0u32);
    let (mut horizontal, mut vertical) = (0u32, 0u32);
    let (mut min_luma, mut max_luma) = (255u32, 0u32);
    for y in region.from[1]..region.to[1] {
        for x in region.from[0]..region.to[0] {
            let p = pixel(image, width, x, y);
            match p[3] {
                0 => transparent += 1,
                255 => opaque += 1,
                _ => translucent += 1,
            };
            if p[3] == 0 { continue; }
            unique.insert([p[0], p[1], p[2]]);
            // Integer approximation for review only; not perceived material quality.
            let luma = (54 * u32::from(p[0]) +
                183 * u32::from(p[1]) + 19 * u32::from(p[2])) / 256;
            min_luma = min_luma.min(luma);
            max_luma = max_luma.max(luma);
            if x + 1 < region.to[0] {
                let right = pixel(image, width, x + 1, y);
                if right[3] > 0 && p[..3] != right[..3] {
                    horizontal += 1;
                }
            }
            if y + 1 < region.to[1] {
                let below = pixel(image, width, x, y + 1);
                if below[3] > 0 && p[..3] != below[..3] {
                    vertical += 1;
                }
            }
        }
    }
    let visible = opaque + translucent;
    json!({
        "sampled_pixels":visible + transparent,
        "visible_pixels":visible,
        "transparent_pixels":transparent,
        "translucent_pixels":translucent,
        "opaque_pixels":opaque,
        "unique_visible_rgb":unique.len(),
        "approx_luma_min":if visible == 0 {Value::Null} else {json!(min_luma)},
        "approx_luma_max":if visible == 0 {Value::Null} else {json!(max_luma)},
        "horizontal_rgb_transitions":horizontal,
        "vertical_rgb_transitions":vertical,
    })
}

/// Exact data comparison of two caller-designated atlas crops from ONE saved
/// project. Reference authority is established by the trusted agent host,
/// not by this inspector. Both crops must have exactly matching pixel dimensions.
pub fn inspect_material_pair(
    doc: &AuthoringDocument,
    reference_uuid: &str, candidate_uuid: &str,
    reference_region: &MaterialPatchRegion, candidate_region: &MaterialPatchRegion,
) -> Result<Value> {
    doc.validate()?;
    let width = doc.resolution.width;
    let height = doc.resolution.height;
    let first = checked_region(reference_region, width, height)?;
    let second = checked_region(candidate_region, width, height)?;
    if first != second {
        return Err("MATERIAL_PAIR_DIMENSION_MISMATCH".into());
    }
    let reference = texture_index(doc, reference_uuid)?;
    let candidate = texture_index(doc, candidate_uuid)?;
    let source = paint::decode_for_uv_inspection(
        &doc.texture_assets[reference], width, height
    ).map_err(|_| "MATERIAL_PAIR_REFERENCE_BITMAP_UNSUPPORTED".to_string())?;
    let target = if candidate == reference {
        source.clone()
    } else {
        paint::decode_for_uv_inspection(
            &doc.texture_assets[candidate], width, height
        ).map_err(|_| "MATERIAL_PAIR_CANDIDATE_BITMAP_UNSUPPORTED".to_string())?
    };
    let (mut differing_rgba, mut differing_alpha) = (0u32, 0u32);
    for y in 0..first.1 {
        for x in 0..first.0 {
            let old = pixel(&source, width, reference_region.from[0]+x,
                reference_region.from[1]+y);
            let new = pixel(&target, width, candidate_region.from[0]+x,
                candidate_region.from[1]+y);
            if old != new { differing_rgba += 1; }
            if old[3] != new[3] { differing_alpha += 1; }
        }
    }
    let reference_metrics = evidence(&source, width, reference_region);
    let candidate_metrics = evidence(&target, width, candidate_region);
    let mut attention = Vec::new();
    if candidate_metrics["unique_visible_rgb"].as_u64().unwrap_or(0) <
       reference_metrics["unique_visible_rgb"].as_u64().unwrap_or(0) {
        attention.push("LOWER_COLOR_VARIATION_THAN_REFERENCE");
    }
    if candidate_metrics["horizontal_rgb_transitions"].as_u64() == Some(0) &&
       reference_metrics["horizontal_rgb_transitions"].as_u64().unwrap_or(0) > 0 {
        attention.push("NO_HORIZONTAL_COLOR_TRANSITIONS");
    }
    if candidate_metrics["vertical_rgb_transitions"].as_u64() == Some(0) &&
       reference_metrics["vertical_rgb_transitions"].as_u64().unwrap_or(0) > 0 {
        attention.push("NO_VERTICAL_COLOR_TRANSITIONS");
    }
    if differing_alpha > 0 {
        attention.push("ALPHA_DIFFERENCE_REVIEW");
    }
    Ok(json!({
        "scope":"saved_rgba8_material_patch_pair",
        "reference_authority":"CALLER_DECLARED",
        "source_state":"measured",
        "visual_verdict":"UNVERIFIED",
        "material_verdict":"NOT_EVALUATED",
        "reference_texture_uuid":reference_uuid,
        "candidate_texture_uuid":candidate_uuid,
        "reference_region":reference_region,
        "candidate_region":candidate_region,
        "region_pixels":first.0 * first.1,
        "reference_pixels_sha256":sha256(&source),
        "candidate_pixels_sha256":sha256(&target),
        "reference":reference_metrics,
        "candidate":candidate_metrics,
        "different_rgba_pixels":differing_rgba,
        "different_alpha_pixels":differing_alpha,
        "attention_candidates":attention
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authoring::{EditOperation, EditorSession};
    const MASTER: &str = "00000000-0000-4000-8000-000000001711";
    const VARIANT: &str = "00000000-0000-4000-8000-000000001712";
    fn setup() -> EditorSession {
        let mut editor = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Pair", "pair").unwrap()
        ).unwrap();
        editor.apply(0, &[
            EditOperation::CreatePaintTexture {
                uuid:MASTER.into(), name:"tier_1.png".into(),
            },
            EditOperation::CreatePaintTexture {
                uuid:VARIANT.into(), name:"tier_2.png".into(),
            },
        ]).unwrap();
        editor.apply(1, &[
            EditOperation::PaintTexturePixel {
                texture_index:0, x:0, y:0, rgba:[50,50,50,255],
            },
            EditOperation::PaintTexturePixel {
                texture_index:0, x:1, y:0, rgba:[200,200,200,255],
            },
            EditOperation::PaintTexturePixel {
                texture_index:1, x:0, y:0, rgba:[50,50,50,255],
            },
            EditOperation::PaintTexturePixel {
                texture_index:1, x:1, y:0, rgba:[50,50,50,255],
            },
        ]).unwrap();
        editor
    }
    fn region(x: u32, y: u32, w: u32, h: u32) -> MaterialPatchRegion {
        MaterialPatchRegion {from:[x,y],to:[x+w,y+h]}
    }
    #[test]
    fn observes_flat_candidate_without_claiming_visual_quality() {
        let editor=setup();
        let original=editor.export().unwrap();
        let comparison=inspect_material_pair(editor.document(),
            MASTER, VARIANT, &region(0,0,2,1), &region(0,0,2,1)
        ).unwrap();
        assert_eq!(comparison["scope"],"saved_rgba8_material_patch_pair");
        assert_eq!(comparison["reference"]["unique_visible_rgb"],2);
        assert_eq!(comparison["candidate"]["unique_visible_rgb"],1);
        assert_eq!(comparison["different_rgba_pixels"],1);
        assert_eq!(comparison["different_alpha_pixels"],0);
        assert_eq!(comparison["reference"]["horizontal_rgb_transitions"],1);
        assert_eq!(comparison["candidate"]["horizontal_rgb_transitions"],0);
        assert_eq!(comparison["visual_verdict"],"UNVERIFIED");
        assert_eq!(comparison["material_verdict"],"NOT_EVALUATED");
        assert_eq!(editor.export().unwrap(),original);
    }
    #[test]
    fn refuses_mismatched_crops_missing_textures_and_invalid_regions() {
        let editor=setup();
        assert_eq!(inspect_material_pair(editor.document(),MASTER,VARIANT,
            &region(0,0,2,1),&region(0,0,1,1)).unwrap_err(),
            "MATERIAL_PAIR_DIMENSION_MISMATCH");
        assert_eq!(inspect_material_pair(editor.document(),MASTER,VARIANT,
            &region(0,0,0,1),&region(0,0,0,1)).unwrap_err(),
            "MATERIAL_PAIR_REGION_INVALID");
        assert_eq!(inspect_material_pair(editor.document(),"missing",VARIANT,
            &region(0,0,2,1),&region(0,0,2,1)).unwrap_err(),
            "MATERIAL_PAIR_TEXTURE_NOT_FOUND");
        assert_eq!(inspect_material_pair(editor.document(),MASTER,VARIANT,
            &region(0,0,128,65),&region(0,0,128,65)).unwrap_err(),
            "MATERIAL_PAIR_REGION_TOO_LARGE");
    }
    #[test]
    fn one_selected_atlas_does_not_prove_comparative_quality() {
        let editor=setup();
        let before=editor.export().unwrap();
        let report=inspect_material_pair(editor.document(),MASTER,MASTER,
            &region(0,0,2,1),&region(0,0,2,1)).unwrap();
        assert_eq!(report["different_rgba_pixels"],0);
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
        assert_eq!(editor.export().unwrap(),before);
    }
}
