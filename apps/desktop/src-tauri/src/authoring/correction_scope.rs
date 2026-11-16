//! Exact-pixel safety for a correction of an existing approved texture.
//! No external reference comparison or artistic approval is inferred.
use serde::{Deserialize, Serialize};
use super::{paint, AuthoringDocument, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CorrectionRectangle {
    /// Inclusive origin in physical PNG pixels.
    pub from: [u32; 2],
    /// Exclusive end in physical PNG pixels.
    pub to: [u32; 2],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextureCorrectionScope {
    pub texture_uuid: String,
    /// Every model field and all other atlas pixels are protected.
    pub allowed_regions: Vec<CorrectionRectangle>,
    /// True when the requested correction may change RGB but not alpha.
    #[serde(default)]
    pub preserve_alpha: bool,
}

pub(super) fn validate_scope(
    doc: &AuthoringDocument, scope: &TextureCorrectionScope,
) -> Result<usize> {
    if !super::valid_uuid(&scope.texture_uuid) ||
        scope.allowed_regions.is_empty() || scope.allowed_regions.len() > 16 {
        return Err("CORRECTION_SCOPE_INVALID".into());
    }
    let width = doc.resolution.width;
    let height = doc.resolution.height;
    if scope.allowed_regions.iter().any(|rect|
        rect.from[0] >= rect.to[0] || rect.from[1] >= rect.to[1] ||
        rect.to[0] > width || rect.to[1] > height
    ) {
        return Err("CORRECTION_SCOPE_INVALID".into());
    }
    let mut matching = doc.texture_assets.iter().enumerate().filter(|(_, tex)|
        tex.get("uuid").and_then(serde_json::Value::as_str) ==
            Some(scope.texture_uuid.as_str())
    );
    let index = matching.next()
        .ok_or_else(|| "CORRECTION_TEXTURE_NOT_FOUND".to_string())?.0;
    if matching.next().is_some() { return Err("CORRECTION_TEXTURE_AMBIGUOUS".into()); }
    Ok(index)
}

pub(super) fn verify_after(
    before: &AuthoringDocument, after: &AuthoringDocument,
    scope: &TextureCorrectionScope, selected: usize,
) -> Result<()> {
    // Check the entire original semantic state, including opaque import data.
    // No out-of-scope structural or other-texture mutation can be published.
    if before.meta != after.meta ||
        before.resolution != after.resolution ||
        before.cubes != after.cubes ||
        before.bones != after.bones ||
        before.hierarchy != after.hierarchy ||
        before.animation_assets != after.animation_assets ||
        before.extensions != after.extensions ||
        before.texture_assets.len() != after.texture_assets.len() {
        return Err("CORRECTION_NON_TEXTURE_CHANGE".into());
    }
    for (index, (original, candidate)) in before.texture_assets.iter()
        .zip(&after.texture_assets).enumerate() {
        if index != selected {
            if original != candidate {
                return Err("CORRECTION_NON_TEXTURE_CHANGE".into());
            }
            continue;
        }
        let mut source_only = original.clone();
        let new_source = candidate.get("source")
            .ok_or_else(|| "CORRECTION_NON_TEXTURE_CHANGE".to_string())?;
        source_only.as_object_mut()
            .ok_or_else(|| "CORRECTION_NON_TEXTURE_CHANGE".to_string())?
            .insert("source".into(), new_source.clone());
        if &source_only != candidate {
            return Err("CORRECTION_NON_TEXTURE_CHANGE".into());
        }
    }
    let width = before.resolution.width;
    let height = before.resolution.height;
    let original = paint::decode_for_uv_inspection(
        &before.texture_assets[selected], width, height,
    ).map_err(|_| "CORRECTION_TEXTURE_UNSUPPORTED".to_string())?;
    let candidate = paint::decode_for_uv_inspection(
        &after.texture_assets[selected], width, height,
    ).map_err(|_| "CORRECTION_TEXTURE_UNSUPPORTED".to_string())?;
    if original.len() != candidate.len() {
        return Err("CORRECTION_TEXTURE_UNSUPPORTED".into());
    }
    let mut changed = 0usize;
    for (index, (old, new)) in original.chunks_exact(4)
        .zip(candidate.chunks_exact(4)).enumerate() {
        if old == new { continue; }
        let x = (index as u32) % width;
        let y = (index as u32) / width;
        if !scope.allowed_regions.iter().any(|rect|
            x >= rect.from[0] && x < rect.to[0] &&
            y >= rect.from[1] && y < rect.to[1]
        ) {
            return Err("CORRECTION_PIXEL_OUTSIDE_ALLOWED".into());
        }
        if scope.preserve_alpha && old[3] != new[3] {
            return Err("CORRECTION_ALPHA_CHANGED".into());
        }
        changed += 1;
    }
    if changed == 0 { return Err("CORRECTION_NO_PIXEL_CHANGE".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::authoring::{EditOperation, EditorSession};
    const TEX: &str = "00000000-0000-4000-8000-000000001601";
    const OTHER: &str = "00000000-0000-4000-8000-000000001602";

    fn session() -> EditorSession {
        let doc = AuthoringDocument::new_bedrock("Corrections", "corrections").unwrap();
        let mut session = EditorSession::from_document(doc).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: TEX.into(), name: "approved.png".into(),
        }]).unwrap();
        session
    }
    fn scope(preserve_alpha: bool) -> TextureCorrectionScope {
        TextureCorrectionScope {
            texture_uuid: TEX.into(),
            allowed_regions: vec![CorrectionRectangle {
                from: [1, 1], to: [3, 3],
            }],
            preserve_alpha,
        }
    }
    fn pixel(x: u32, y: u32, rgba: [u8; 4]) -> EditOperation {
        EditOperation::PaintTexturePixel { texture_index: 0, x, y, rgba }
    }

    #[test]
    fn protected_area_rejects_outside_rgba_and_preserves_history() {
        let mut s = session();
        let prior = s.export().unwrap();
        assert_eq!(s.apply_with_correction_scope(
            1, &[pixel(9, 9, [80, 90, 100, 255])], Some(&scope(false)),
        ).unwrap_err(), "CORRECTION_PIXEL_OUTSIDE_ALLOWED");
        assert_eq!(s.summary().revision, 1);
        assert_eq!(s.export().unwrap(), prior);
        let r = s.apply_with_correction_scope(
            1, &[pixel(1, 2, [80, 90, 100, 255])], Some(&scope(false)),
        ).unwrap();
        assert_eq!(r.revision, 2);
        assert_ne!(s.export().unwrap(), prior);
        s.undo(2).unwrap();
        assert_eq!(s.export().unwrap(), prior);
    }

    #[test]
    fn grading_preserves_alpha_inside_allowed_regions() {
        let mut s = session();
        s.apply(1, &[pixel(1, 1, [50, 60, 70, 255])]).unwrap();
        let prior = s.export().unwrap();
        assert_eq!(s.apply_with_correction_scope(
            2, &[pixel(1, 1, [60, 70, 80, 0])], Some(&scope(true)),
        ).unwrap_err(), "CORRECTION_ALPHA_CHANGED");
        assert_eq!(s.summary().revision, 2);
        assert_eq!(s.export().unwrap(), prior);
        s.apply_with_correction_scope(
            2, &[pixel(1, 1, [60, 70, 80, 255])], Some(&scope(true)),
        ).unwrap();
        assert_eq!(s.summary().revision, 3);
    }

    #[test]
    fn unrelated_assets_and_mixed_region_edits_fail_atomically() {
        let mut s = session();
        let prior = s.export().unwrap();
        assert_eq!(s.apply_with_correction_scope(1, &[
            EditOperation::CreatePaintTexture {uuid:OTHER.into(),name:"other.png".into()},
        ], Some(&scope(false))).unwrap_err(), "CORRECTION_NON_TEXTURE_CHANGE");
        assert_eq!(s.apply_with_correction_scope(1, &[
            pixel(1, 1, [30, 40, 50, 255]),
            pixel(9, 9, [30, 40, 50, 255]),
        ], Some(&scope(false))).unwrap_err(), "CORRECTION_PIXEL_OUTSIDE_ALLOWED");
        assert_eq!(s.summary().revision, 1);
        assert_eq!(s.export().unwrap(), prior);
        let invalid = TextureCorrectionScope {
            allowed_regions: vec![CorrectionRectangle{from:[3,3],to:[3,4]}],
            ..scope(false)
        };
        assert_eq!(s.apply_with_correction_scope(1, &[
            pixel(1,1,[30,40,50,255]),
        ], Some(&invalid)).unwrap_err(), "CORRECTION_SCOPE_INVALID");
        let missing = TextureCorrectionScope {
            texture_uuid:"not-found".into(), ..scope(false)
        };
        assert_eq!(s.apply_with_correction_scope(1, &[
            pixel(1,1,[30,40,50,255]),
        ], Some(&missing)).unwrap_err(), "CORRECTION_TEXTURE_NOT_FOUND");
    }

    #[test]
    fn strict_plan_parses_scope_without_changing_legacy_edits() {
        let guarded = serde_json::json!({
            "expected_revision":0,
            "operations":[{"op":"paint_texture_pixel","texture_index":0,
                "x":1,"y":1,"rgba":[2,3,4,255]}],
            "correction_scope":{"texture_uuid":TEX,
                "allowed_regions":[{"from":[1,1],"to":[2,2]}],
                "preserve_alpha":true}
        });
        let p: crate::authoring::EditPlan = serde_json::from_value(guarded.clone()).unwrap();
        assert!(p.correction_scope.unwrap().preserve_alpha);
        let mut bad = guarded;
        bad["correction_scope"]["unrecognized"] = serde_json::json!(true);
        assert!(serde_json::from_value::<crate::authoring::EditPlan>(bad).is_err());
        let legacy = serde_json::json!({"expected_revision":0,"operations":[
            {"op":"paint_texture_pixel","texture_index":0,"x":1,"y":1,"rgba":[2,3,4,255]}]});
        assert!(serde_json::from_value::<crate::authoring::EditPlan>(legacy)
            .unwrap().correction_scope.is_none());
    }
}
