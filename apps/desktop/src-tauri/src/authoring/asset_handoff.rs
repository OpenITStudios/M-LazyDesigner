//! Read-only, model-wide source handoff for Bedrock Entity asset exports.
//! Checks one explicitly chosen atlas against ALL six Cube face references and
//! reuses the real Geometry/PNG/Animation exporters to avoid a second
//! compatibility engine. Never publishes files or claims visual/native PASS.
//! SOURCE ONLY: tests and runtime/native acceptance remain NOT_EXECUTED.

use super::{
    bedrock_animation_curve_fidelity, export_bedrock_animations,
    export_bedrock_geometry, export_paint_png, sha256, valid_uuid,
    AuthoringDocument, FACE_NAMES,
};
use serde_json::{json, Value};
use std::collections::HashMap;

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

fn export_evidence(result: Result<Vec<u8>>) -> (Value, bool) {
    match result {
        Ok(bytes) => (json!({
            "status":"source_exportable",
            "sha256":sha256(&bytes), "bytes":bytes.len()
        }), true),
        Err(code) => (json!({
            "status":"blocked", "reason":code,
            "sha256":null, "bytes":null
        }), false),
    }
}

/// Source-only consistency evidence, NOT a runtime bundle or validation of
/// the rendered/saved texture on actual Minecraft geometry.
///
/// texture_uuid is an intentional asset selection by the caller; never
/// select the first texture implicitly. Only a single atlas can accompany
/// this simple Bedrock Entity Geometry output. An unused second texture does
/// not invalidate that pairing; a referenced different atlas does.
///
/// The caller's inspect-batch SHA guards that all returned exporter hashes
/// describe the SAME immutable .bbmodel input.
pub fn inspect_bedrock_asset_handoff(
    doc: &AuthoringDocument, texture_uuid: &str,
) -> Result<Value> {
    doc.validate()?;
    if !valid_uuid(texture_uuid) {
        return Err(fail("ASSET_HANDOFF_TEXTURE_UUID_INVALID"));
    }
    let texture_indices: HashMap<&str, usize> = doc.texture_assets
        .iter().enumerate()
        .filter_map(|(index, texture)| {
            texture.get("uuid").and_then(Value::as_str).map(|id| (id, index))
        }).collect();
    let selected_index = texture_indices.get(texture_uuid).copied();

    let mut referenced_selected = 0usize;
    let mut referenced_other = 0usize;
    let mut unresolved = 0usize;
    let mut no_texture = 0usize;
    let mut implicit = 0usize;
    let mut explicit_absent = 0usize;
    let mut all_faces = 0usize;

    for cube in &doc.cubes {
        for name in FACE_NAMES {
            all_faces += 1;
            let face = cube.faces.get(name).and_then(Value::as_object)
                .ok_or_else(|| fail("ASSET_HANDOFF_FACE_UNSUPPORTED"))?;
            let referenced = match face.get("texture") {
                Some(Value::Null) => {
                    explicit_absent += 1;
                    continue;
                },
                Some(Value::Bool(false)) => {
                    no_texture += 1;
                    continue;
                },
                None => {
                    implicit += 1;
                    continue;
                },
                Some(Value::Number(index)) => index.as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .filter(|index| *index < doc.texture_assets.len()),
                Some(Value::String(id)) => texture_indices.get(id.as_str()).copied(),
                _ => None,
            };
            match referenced {
                Some(index) if Some(index) == selected_index => referenced_selected += 1,
                Some(_) => referenced_other += 1,
                None => unresolved += 1,
            }
        }
    }

    // Reuse canonical exporters. These execute in memory only; their hashes
    // can be compared with individually published artifacts at the same SHA.
    let (geometry, geo_ok) = export_evidence(export_bedrock_geometry(doc));
    let (texture, png_ok) = export_evidence(export_paint_png(doc, texture_uuid));
    let animation_required = !doc.animation_assets.is_empty();
    let (mut animation, anim_ok) = if animation_required {
        export_evidence(export_bedrock_animations(doc))
    } else {
        (json!({"status":"not_required","sha256":null,"bytes":null}), true)
    };
    if animation_required {
        animation["curve_fidelity"] = json!(bedrock_animation_curve_fidelity(doc));
    }

    let mut blockers = Vec::new();
    if !geo_ok { blockers.push("GEOMETRY_EXPORT_BLOCKED"); }
    if !png_ok { blockers.push("TEXTURE_EXPORT_BLOCKED"); }
    if !anim_ok { blockers.push("ANIMATION_EXPORT_BLOCKED"); }
    if referenced_selected == 0 { blockers.push("SELECTED_TEXTURE_NOT_BOUND"); }
    if referenced_other != 0 { blockers.push("MULTIPLE_REFERENCED_TEXTURES"); }
    if unresolved != 0 { blockers.push("UNRESOLVED_FACE_TEXTURE_REFERENCES"); }
    if implicit != 0 || no_texture != 0 {
        blockers.push("IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES");
    }

    let coherent = blockers.is_empty();
    Ok(json!({
        "scope":"bedrock_single_atlas_export_handoff",
        "status":if coherent {"source_consistent"} else {"blocked"},
        "visual_verdict":"UNVERIFIED",
        "native_verdict":"NOT_EXECUTED",
        "selected_texture_uuid":texture_uuid,
        "faces":{
            "total":all_faces,
            "selected_texture":referenced_selected,
            "other_texture":referenced_other,
            "unresolved":unresolved,
            "unset":implicit,
            "false_reference":no_texture,
            "explicitly_absent":explicit_absent
        },
        "geometry":geometry,
        "texture":texture,
        "animation":animation,
        "blockers":blockers
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{EditOperation, EditorSession};
    use serde_json::json;

    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const TEXTURE: &str = "00000000-0000-4000-8000-000000006201";
    const SECOND: &str = "00000000-0000-4000-8000-000000006202";
    const CUBE: &str = "00000000-0000-4000-8000-000000000002";
    const ANIMATION: &str = "00000000-0000-4000-8000-000000006203";

    fn prepared() -> EditorSession {
        let mut session = EditorSession::open(SAMPLE).unwrap();
        session.apply(0, &[
            EditOperation::CreatePaintTexture {
                uuid: TEXTURE.into(), name: "atlas.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:CUBE.into(), texture_uuid:TEXTURE.into(),
            },
            EditOperation::CreateAnimation {
                uuid:ANIMATION.into(), name:"animation.idle".into(), length:1.0,
            },
        ]).unwrap();
        session
    }

    #[test]
    fn single_atlas_handoff_binds_all_six_faces_and_three_source_exports() {
        let session = prepared();
        let before = session.document().clone();
        let report = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(report["scope"], "bedrock_single_atlas_export_handoff");
        assert_eq!(report["status"], "source_consistent");
        assert_eq!(report["faces"]["selected_texture"], 6);
        assert_eq!(report["faces"]["other_texture"], 0);
        assert_eq!(report["faces"]["explicitly_absent"], 0);
        assert_eq!(report["geometry"]["status"], "source_exportable");
        assert_eq!(report["texture"]["status"], "source_exportable");
        assert_eq!(report["animation"]["status"], "source_exportable");
        assert_eq!(report["animation"]["curve_fidelity"], "native");
        assert_eq!(report["visual_verdict"], "UNVERIFIED");
        assert_eq!(report["native_verdict"], "NOT_EXECUTED");
        assert_eq!(report["blockers"], json!([]));
        assert_eq!(report["geometry"]["sha256"],
            json!(sha256(&export_bedrock_geometry(&before).unwrap())));
        assert_eq!(report["texture"]["sha256"],
            json!(sha256(&export_paint_png(&before,TEXTURE).unwrap())));
        assert_eq!(report["animation"]["sha256"],
            json!(sha256(&export_bedrock_animations(&before).unwrap())));
        assert_eq!(session.document(), &before);
        let compact = serde_json::to_string(&report).unwrap();
        assert!(!compact.contains("data:image/png"));
    }

    #[test]
    fn foreign_face_atlas_blocks_handoff_but_preserves_both_pngs() {
        let mut session = prepared();
        session.apply(1, &[EditOperation::CreatePaintTexture {
            uuid:SECOND.into(), name:"second.png".into(),
        }]).unwrap();
        let mut doc = session.document().clone();
        doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = json!(SECOND);
        let prior = doc.clone();
        let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
        assert_eq!(report["status"], "blocked");
        assert_eq!(report["faces"]["selected_texture"], 5);
        assert_eq!(report["faces"]["other_texture"], 1);
        assert!(report["blockers"].as_array().unwrap().contains(
            &json!("MULTIPLE_REFERENCED_TEXTURES")));
        assert_eq!(report["texture"]["status"], "source_exportable");
        assert_eq!(doc, prior);
    }

    #[test]
    fn explicit_absent_face_is_not_an_implicit_binding_but_unassigned_is() {
        let mut doc = prepared().document().clone();
        doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Null;
        let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
        assert_eq!(report["status"], "source_consistent");
        assert_eq!(report["faces"]["explicitly_absent"], 1);
        doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Bool(false);
        let blocked = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
        assert_eq!(blocked["status"], "blocked");
        assert_eq!(blocked["faces"]["false_reference"], 1);
        assert!(blocked["blockers"].as_array().unwrap().contains(
            &json!("IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES")));
    }

    #[test]
    fn invalid_png_or_opaque_animation_reports_exact_exporter_not_visual_pass() {
        let mut doc = prepared().document().clone();
        doc.texture_assets[0]["source"] = json!("data:image/png;base64,AAAB");
        let report = inspect_bedrock_asset_handoff(&doc,TEXTURE).unwrap();
        assert_eq!(report["texture"]["status"], "blocked");
        assert!(report["blockers"].as_array().unwrap().contains(
            &json!("TEXTURE_EXPORT_BLOCKED")));
        let mut opaque = prepared().document().clone();
        opaque.animation_assets[0]["unrecognized"] = json!("unknown");
        let report = inspect_bedrock_asset_handoff(&opaque,TEXTURE).unwrap();
        assert_eq!(report["animation"]["status"], "blocked");
        assert!(report["blockers"].as_array().unwrap().contains(
            &json!("ANIMATION_EXPORT_BLOCKED")));
        assert_eq!(inspect_bedrock_asset_handoff(&opaque,"wrong").unwrap_err(),
            "ASSET_HANDOFF_TEXTURE_UUID_INVALID");
    }
}
