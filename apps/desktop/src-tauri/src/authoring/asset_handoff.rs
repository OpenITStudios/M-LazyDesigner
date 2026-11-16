//! Read-only, model-wide source handoff for Bedrock Entity asset exports.
//! Checks one explicitly chosen atlas against ALL six Cube face references and
//! reuses the real Geometry/PNG/Animation exporters to avoid a second
//! compatibility engine. Never publishes files or claims visual/native PASS.
//! SOURCE ONLY: tests and runtime/native acceptance remain NOT_EXECUTED.

use super::{
    bedrock_animation_curve_fidelity, export_bedrock_animations,
    export_bedrock_geometry, export_paint_png, sha256, valid_uuid,
    AuthoringDocument, OutlinerNode, FACE_NAMES,
};
use serde_json::{json, Value};
use std::collections::HashMap;

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

fn export_evidence(
    result: std::result::Result<&[u8], &String>,
) -> (Value, bool) {
    match result {
        Ok(bytes) => (json!({
            "status":"source_exportable",
            "sha256":sha256(bytes), "bytes":bytes.len()
        }), true),
        Err(code) => (json!({
            "status":"blocked", "reason":code,
            "sha256":null, "bytes":null
        }), false),
    }
}

/// An intentionally narrow, conservative upper budget for a SINGLE numeric
/// animation clip's Bone translations, in Blockbench model units (16/block).
/// A parent-child chain can translate by at most the sum of each Bone's
/// maximum keyframed displacement length. A linear/step vector lies within
/// the convex hull of its endpoint values; no interpolation samples or
/// guesses are needed. No guarantee for animated rotation, scale, Bezier,
/// Catmull-Rom, unsupported clips, concurrent blends or native rendering.
/// This is evidence for an optional authored visible_box, NEVER auto-paint or
/// an implicit change to the canonical Geometry compiler.
fn translation_clearance(
    doc: &AuthoringDocument, static_bounds: &Value, saved_bounds: &Value,
) -> Value {
    const PIXELS_PER_BLOCK: f64 = 16.0;
    const EPS: f64 = 1e-8;
    fn unassessed(reason: &str) -> Value {
        json!({
            "scope":"single_clip_numeric_translation_clearance",
            "status":"unassessed", "reason":reason,
            "native_verdict":"NOT_EXECUTED", "visual_verdict":"UNVERIFIED",
            "controller_blends":"NOT_ASSESSED",
        })
    }
    fn maximum_chain(
        nodes: &[OutlinerNode], local: &HashMap<&str, f64>,
        inherited: f64, maximum: &mut f64,
    ) -> bool {
        for node in nodes {
            if let OutlinerNode::Bone(bone) = node {
                let reach = inherited + local.get(bone.uuid.as_str()).copied().unwrap_or(0.0);
                if !reach.is_finite() { return false; }
                *maximum = (*maximum).max(reach);
                if !maximum_chain(&bone.children, local, reach, maximum) { return false; }
            }
        }
        true
    }
    let mut maximum_reach: f64 = 0.0;
    let mut position_tracks = 0usize;
    let mut numeric_clips = 0usize;
    for clip in &doc.animation_assets {
        if !super::editable_transform_clip(clip, &doc.bones) {
            return unassessed("OPAQUE_OR_UNSUPPORTED_CLIP");
        }
        numeric_clips += 1;
        let Some(tracks) = clip.get("animators").and_then(Value::as_object) else {
            return unassessed("OPAQUE_OR_UNSUPPORTED_CLIP");
        };
        let mut local: HashMap<&str, f64> = HashMap::new();
        for (bone_uuid, track) in tracks {
            if bone_uuid == "effects" { continue; }
            let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                return unassessed("OPAQUE_OR_UNSUPPORTED_TRACK");
            };
            let mut has_position = false;
            for frame in frames {
                let Some(mode) = frame.get("interpolation").and_then(Value::as_str) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                if mode != "linear" && mode != "step" {
                    return unassessed("NONLINEAR_OR_UNBOUNDED_CURVE");
                }
                let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                let Some(point) = frame.get("data_points").and_then(Value::as_array)
                    .and_then(|values| values.first()) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                let mut axes = [0.0_f64; 3];
                for (axis, name) in ["x", "y", "z"].iter().enumerate() {
                    let Some(value) = super::transform_axis(point.get(*name)) else {
                        return unassessed("NONNUMERIC_TRANSFORM");
                    };
                    axes[axis] = value;
                }
                match channel {
                    "position" => {
                        has_position = true;
                        let magnitude = axes[0].hypot(axes[1]).hypot(axes[2]);
                        if !magnitude.is_finite() {
                            return unassessed("TRANSLATION_MAGNITUDE_OVERFLOW");
                        }
                        let entry = local.entry(bone_uuid.as_str()).or_insert(0.0);
                        *entry = (*entry).max(magnitude);
                    },
                    "rotation" if axes.iter().any(|axis| axis.abs() > EPS) =>
                        return unassessed("ANIMATED_ROTATION_UNASSESSED"),
                    "scale" if axes.iter().any(|axis| (*axis - 1.0).abs() > EPS) =>
                        return unassessed("ANIMATED_SCALE_UNASSESSED"),
                    "rotation" | "scale" => {},
                    _ => return unassessed("UNSUPPORTED_CHANNEL"),
                }
            }
            if has_position { position_tracks += 1; }
        }
        let mut clip_reach = 0.0_f64;
        if !maximum_chain(&doc.hierarchy, &local, 0.0, &mut clip_reach) {
            return unassessed("TRANSLATION_CHAIN_OVERFLOW");
        }
        maximum_reach = maximum_reach.max(clip_reach);
    }
    if maximum_reach <= EPS {
        return json!({
            "scope":"single_clip_numeric_translation_clearance",
            "status":"no_numeric_translation", "numeric_clips":numeric_clips,
            "position_tracks":position_tracks, "max_reach_model_units":0.0,
            "native_verdict":"NOT_EXECUTED", "visual_verdict":"UNVERIFIED",
            "controller_blends":"NOT_ASSESSED",
        });
    }
    let (Some(width), Some(height), Some(center_y),
         Some(actual_width), Some(actual_height), Some(actual_center_y)) = (
        static_bounds["visible_bounds_width"].as_f64(),
        static_bounds["visible_bounds_height"].as_f64(),
        static_bounds["visible_bounds_offset"][1].as_f64(),
        saved_bounds["width"].as_f64(),
        saved_bounds["height"].as_f64(),
        saved_bounds["offset"][1].as_f64(),
    ) else { return unassessed("GEOMETRY_BOUNDS_UNAVAILABLE"); };
    let shift = maximum_reach / PIXELS_PER_BLOCK;
    let required_width = width + shift * 2.0;
    let required_height = height + shift * 2.0;
    let required_low = center_y - height / 2.0 - shift;
    let required_high = center_y + height / 2.0 + shift;
    let actual_low = actual_center_y - actual_height / 2.0;
    let actual_high = actual_center_y + actual_height / 2.0;
    if ![required_width, required_height, required_low, required_high,
        actual_low, actual_high].iter().all(|value| value.is_finite()) {
        return unassessed("GEOMETRY_REACH_OVERFLOW");
    }
    // Width is a horizontal X/Z diameter; height is a vertical interval.
    // This asks whether the published box encloses the conservative sum,
    // NOT whether the actual rendered pose is clipped in Minecraft.
    let width_shortfall = (required_width - actual_width).max(0.0);
    let below_shortfall = (actual_low - required_low).max(0.0);
    let above_shortfall = (required_high - actual_high).max(0.0);
    let review = width_shortfall > EPS || below_shortfall > EPS || above_shortfall > EPS;
    json!({
        "scope":"single_clip_numeric_translation_clearance",
        "status":if review { "conservative_margin_shortfall" } else { "source_budget_covered" },
        "numeric_clips":numeric_clips,
        "position_tracks":position_tracks,
        "max_reach_model_units":maximum_reach,
        "max_reach_blocks":shift,
        "required_conservative_bounds":{
            "width":required_width, "height":required_height,
            "offset":[0.0, center_y, 0.0]
        },
        "shortfall_blocks":{
            "horizontal_width":width_shortfall,
            "below":below_shortfall,
            "above":above_shortfall
        },
        "native_verdict":"NOT_EXECUTED",
        "visual_verdict":"UNVERIFIED",
        "controller_blends":"NOT_ASSESSED",
    })
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
///
/// Keep the compact two-argument caller stable; use the paged form to locate
/// individual Cube/face corrections without exposing private PNG bytes.
pub fn inspect_bedrock_asset_handoff(
    doc: &AuthoringDocument, texture_uuid: &str,
) -> Result<Value> {
    inspect_bedrock_asset_handoff_page(doc, texture_uuid, 0, 16)
}

/// Issues are ordered by canonical Cube order then six-face order, not by
/// severity or renderer visibility. Page indices refer only to faulty faces.
/// Every page still reports whole-model totals and exporter output hashes.
pub fn inspect_bedrock_asset_handoff_page(
    doc: &AuthoringDocument, texture_uuid: &str,
    offset: usize, limit: usize,
) -> Result<Value> {
    if offset > super::MAX_ELEMENTS * FACE_NAMES.len() ||
       limit == 0 || limit > 32 {
        return Err(fail("ASSET_HANDOFF_PAGE_INVALID"));
    }
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
    let mut uv_out_of_bounds = 0usize;
    let mut uv_zero_area = 0usize;
    let mut uv_projection_unsupported = 0usize;
    let mut total_issues = 0usize;
    let mut issues = Vec::with_capacity(limit);

    for cube in &doc.cubes {
        let box_uv = super::cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false));
        // Recompute the same Box UV net owned by Rust, once per Cube, only
        // for read-only metadata inspection; no saved UVs or PNGs are edited.
        let projected_box = if box_uv && super::check_box_uv_repack_rules(doc, cube).is_ok() {
            let mut derived = cube.clone();
            super::refresh_box_uv(&mut derived).ok().map(|()| derived)
        } else { None };
        for name in FACE_NAMES {
            all_faces += 1;
            let face = cube.faces.get(name).and_then(Value::as_object)
                .ok_or_else(|| fail("ASSET_HANDOFF_FACE_UNSUPPORTED"))?;
            let (reference_kind, referenced): (&str, Option<usize>) = match face.get("texture") {
                Some(Value::Null) => {
                    explicit_absent += 1;
                    continue;
                },
                Some(Value::Bool(false)) => {
                    no_texture += 1;
                    ("false", None)
                },
                None => {
                    implicit += 1;
                    ("unset", None)
                },
                Some(Value::Number(index)) => ("index", index.as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .filter(|index| *index < doc.texture_assets.len())),
                Some(Value::String(id)) => ("uuid", texture_indices.get(id.as_str()).copied()),
                _ => ("unsupported", None),
            };
            let mut uv_rect: Option<[f64; 4]> = None;
            let mut uv_source: Option<&str> = None;
            let problem = match (reference_kind, referenced) {
                ("false", _) => Some("false_reference"),
                ("unset", _) => Some("unset_reference"),
                (_, Some(index)) if Some(index) == selected_index => {
                    referenced_selected += 1;
                    // The Geometry resource stores one global atlas size.
                    // A correct texture UUID is insufficient when the UV net
                    // points outside it. Reversed UVs and fractional UVs are
                    // valid; inspect min/max, not integer pixel rounding.
                    let projected = if box_uv { projected_box.as_ref() } else { Some(cube) };
                    if let Some(projected) = projected {
                        let rect = super::face_uv(projected, name)?;
                        uv_source = Some(if box_uv { "derived_box" } else { "saved_manual" });
                        uv_rect = Some(rect);
                        if rect[0].min(rect[2]) < 0.0 ||
                           rect[1].min(rect[3]) < 0.0 ||
                           rect[0].max(rect[2]) > f64::from(doc.resolution.width) ||
                           rect[1].max(rect[3]) > f64::from(doc.resolution.height) {
                            uv_out_of_bounds += 1;
                            Some("uv_out_of_bounds")
                        } else if rect[0] == rect[2] || rect[1] == rect[3] {
                            uv_zero_area += 1;
                            Some("uv_zero_area")
                        } else { None }
                    } else {
                        uv_projection_unsupported += 1;
                        Some("uv_projection_unsupported")
                    }
                },
                (_, Some(_)) => {
                    referenced_other += 1;
                    Some("other_texture")
                },
                _ => {
                    unresolved += 1;
                    Some("unresolved_reference")
                },
            };
            if let Some(problem) = problem {
                if total_issues >= offset && issues.len() < limit {
                    let referenced_texture_uuid = referenced
                        .and_then(|index| doc.texture_assets.get(index))
                        .and_then(|texture| texture.get("uuid"))
                        .and_then(Value::as_str);
                    // Location + specific UV evidence, never a destructive
                    // repair recommendation or claimed visual coverage.
                    issues.push(json!({
                        "cube_uuid":cube.uuid,
                        "face":name,
                        "problem":problem,
                        "reference_kind":reference_kind,
                        "referenced_texture_uuid":referenced_texture_uuid,
                        "uv_rect":uv_rect,
                        "uv_source":uv_source,
                    }));
                }
                total_issues += 1;
            }
        }
    }

    // Reuse canonical exporters. These execute in memory only; their hashes
    // can be compared with individually published artifacts at the same SHA.
    let geometry_output = super::geometry::export_bedrock_geometry_with_static_bounds(doc);
    let (mut geometry, geo_ok) = export_evidence(
        geometry_output.as_ref().map(|(bytes, _)| bytes.as_slice()));
    if let Ok((bytes, static_bounds)) = &geometry_output {
        let parsed: Value = serde_json::from_slice(bytes)
            .map_err(|_| fail("ASSET_HANDOFF_GEOMETRY_READ_INVALID"))?;
        let description = &parsed["minecraft:geometry"][0]["description"];
        geometry["visible_bounds"] = json!({
            "width":description["visible_bounds_width"],
            "height":description["visible_bounds_height"],
            "offset":description["visible_bounds_offset"],
        });
        geometry["visible_bounds_source"] = json!(
            if doc.extensions.contains_key("visible_box") {
                "saved_visible_box_union"
            } else { "computed_static" });
        if !doc.animation_assets.is_empty() {
            // Reuse this SAME Geometry compiler's actual static envelope.
            // No cloned model, second export, or replacement model authority.
            let current = geometry["visible_bounds"].clone();
            geometry["translation_clearance"] =
                translation_clearance(doc, static_bounds, &current);
        }
    }
    let png_output = export_paint_png(doc, texture_uuid);
    let (texture, png_ok) = export_evidence(png_output.as_ref().map(Vec::as_slice));
    let animation_required = !doc.animation_assets.is_empty();
    let compiled_animation = if animation_required {
        Some(export_bedrock_animations(doc))
    } else { None };
    let (mut animation, anim_ok) = if let Some(result) = &compiled_animation {
        export_evidence(result.as_ref().map(Vec::as_slice))
    } else {
        (json!({"status":"not_required","sha256":null,"bytes":null}), true)
    };
    if animation_required {
        animation["curve_fidelity"] = json!(bedrock_animation_curve_fidelity(doc));
        // Advisory cross-domain quality evidence: neither an exporter blocker
        // nor a claim of smooth visual playback. The same validated document
        // and original saved keyframes are read without additional PNG work.
        animation["loop_seams"] =
            super::animation_export::inspect_animation_loop_seams_validated(doc)?;
    }

    let mut blockers = Vec::new();
    if !geo_ok { blockers.push("GEOMETRY_EXPORT_BLOCKED"); }
    if !png_ok { blockers.push("TEXTURE_EXPORT_BLOCKED"); }
    if !anim_ok { blockers.push("ANIMATION_EXPORT_BLOCKED"); }
    if selected_index.is_none() { blockers.push("SELECTED_TEXTURE_NOT_FOUND"); }
    if referenced_selected == 0 { blockers.push("SELECTED_TEXTURE_NOT_BOUND"); }
    if referenced_other != 0 { blockers.push("MULTIPLE_REFERENCED_TEXTURES"); }
    if unresolved != 0 { blockers.push("UNRESOLVED_FACE_TEXTURE_REFERENCES"); }
    if implicit != 0 || no_texture != 0 {
        blockers.push("IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES");
    }
    if uv_out_of_bounds != 0 { blockers.push("UV_OUT_OF_ATLAS"); }
    if uv_zero_area != 0 { blockers.push("UV_ZERO_AREA"); }
    if uv_projection_unsupported != 0 { blockers.push("UV_PROJECTION_UNSUPPORTED"); }

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
            "explicitly_absent":explicit_absent,
            "uv_out_of_bounds":uv_out_of_bounds,
            "uv_zero_area":uv_zero_area,
            "uv_projection_unsupported":uv_projection_unsupported
        },
        "total_issues":total_issues,
        "issue_offset":offset,
        "next_issue_offset":if offset + issues.len() < total_issues {
            Some(offset + issues.len())
        } else { None },
        "issues":issues,
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
    fn paged_issue_locations_cover_all_faces_without_dropping_later_blindspots() {
        let mut doc = prepared().document().clone();
        for face in ["north", "east", "south", "west", "up"] {
            doc.cubes[0].faces.get_mut(face).unwrap()["texture"] = Value::Bool(false);
        }
        let original = doc.clone();
        let first = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 2).unwrap();
        let second = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 2, 2).unwrap();
        let third = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 4, 2).unwrap();
        assert_eq!(first["status"], "blocked");
        assert_eq!(first["total_issues"], 5);
        assert_eq!(first["faces"]["false_reference"], 5);
        assert_eq!(first["issues"].as_array().unwrap().len(), 2);
        assert_eq!(first["issues"][0]["cube_uuid"], CUBE);
        assert_eq!(first["issues"][0]["face"], "north");
        assert_eq!(first["issues"][0]["problem"], "false_reference");
        assert_eq!(first["issues"][0]["reference_kind"], "false");
        assert_eq!(first["issues"][0]["referenced_texture_uuid"], Value::Null);
        assert_eq!(first["issues"][1]["face"], "east");
        assert_eq!(first["next_issue_offset"], 2);
        assert_eq!(second["issues"][0]["face"], "south");
        assert_eq!(second["issues"][1]["face"], "west");
        assert_eq!(second["next_issue_offset"], 4);
        assert_eq!(third["issues"][0]["face"], "up");
        assert_eq!(third["next_issue_offset"], Value::Null);
        assert_eq!(first["geometry"], second["geometry"]);
        assert_eq!(first["texture"], second["texture"]);
        assert_eq!(first["animation"], second["animation"]);
        assert_eq!(doc, original);
    }

    #[test]
    fn other_texture_issue_identifies_exact_face_and_uuid_without_raw_png() {
        let mut session = prepared();
        session.apply(1, &[EditOperation::CreatePaintTexture {
            uuid:SECOND.into(), name:"second.png".into(),
        }]).unwrap();
        let mut doc = session.document().clone();
        doc.cubes[0].faces.get_mut("south").unwrap()["texture"] = json!(SECOND);
        let report = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 1).unwrap();
        assert_eq!(report["total_issues"], 1);
        assert_eq!(report["issues"][0]["cube_uuid"], CUBE);
        assert_eq!(report["issues"][0]["face"], "south");
        assert_eq!(report["issues"][0]["problem"], "other_texture");
        assert_eq!(report["issues"][0]["reference_kind"], "uuid");
        assert_eq!(report["issues"][0]["referenced_texture_uuid"], SECOND);
        assert_eq!(report["next_issue_offset"], Value::Null);
        assert!(!report.to_string().contains("data:image/png"));
    }

    #[test]
    fn paging_rejects_unsafe_bounds_without_model_mutation() {
        let doc = prepared().document().clone();
        for (offset, limit) in [
            (0, 0), (0, 33), (super::super::MAX_ELEMENTS * 6 + 1, 1)
        ] {
            assert_eq!(inspect_bedrock_asset_handoff_page(
                &doc, TEXTURE, offset, limit).unwrap_err(),
                "ASSET_HANDOFF_PAGE_INVALID");
        }
        let beyond = inspect_bedrock_asset_handoff_page(
            &doc, TEXTURE, 12, 2).unwrap();
        assert_eq!(beyond["total_issues"], 0);
        assert_eq!(beyond["issues"], json!([]));
        assert_eq!(beyond["next_issue_offset"], Value::Null);
    }

    #[test]
    fn precise_face_rebind_fixes_handoff_without_changing_other_faces_or_assets() {
        let mut session = prepared();
        let original = session.document().clone();
        session.apply(1, &[
            EditOperation::CreatePaintTexture {
                uuid:SECOND.into(), name:"other.png".into(),
            },
            EditOperation::AssignCubeFaceTexture {
                cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:SECOND.into(),
            },
        ]).unwrap();
        let faulty = session.document().clone();
        assert_eq!(faulty.cubes[0].faces["north"]["texture"], SECOND);
        assert_eq!(faulty.cubes[0].faces["south"]["texture"], TEXTURE);
        let report = inspect_bedrock_asset_handoff_page(&faulty, TEXTURE, 0, 1).unwrap();
        assert_eq!(report["total_issues"], 1);
        assert_eq!(report["issues"][0]["face"], "north");
        assert_eq!(report["issues"][0]["problem"], "other_texture");
        assert_eq!(report["status"], "blocked");
        session.apply(2, &[EditOperation::AssignCubeFaceTexture {
            cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:TEXTURE.into(),
        }]).unwrap();
        let restored = session.document().clone();
        let report = inspect_bedrock_asset_handoff(&restored, TEXTURE).unwrap();
        assert_eq!(report["status"], "source_consistent");
        assert_eq!(restored.cubes[0].faces["north"]["texture"], TEXTURE);
        for side in ["east", "south", "west", "up", "down"] {
            assert_eq!(restored.cubes[0].faces[side], original.cubes[0].faces[side]);
        }
        assert_eq!(restored.texture_assets[0], original.texture_assets[0]);
        assert_eq!(restored.animation_assets, original.animation_assets);
        let reopened = EditorSession::open(&session.export().unwrap()).unwrap();
        assert_eq!(reopened.document(), &restored);
        session.undo(3).unwrap();
        assert_eq!(session.document(), &faulty);
        session.redo(4).unwrap();
        assert_eq!(session.document(), &restored);
    }

    #[test]
    fn precise_face_rebind_refuses_null_invalid_and_foreign_uv_rules_atomically() {
        let original = prepared().document().clone();
        let correct = || EditOperation::AssignCubeFaceTexture {
            cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:TEXTURE.into(),
        };
        let mut absent = original.clone();
        absent.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Null;
        let mut session = EditorSession::from_document(absent.clone()).unwrap();
        assert_eq!(session.apply(0, &[correct()]).unwrap_err(),
            "CUBE_FACE_INTENTIONALLY_ABSENT");
        assert_eq!(session.document(), &absent);
        assert!(!session.can_undo());
        let mut session = EditorSession::from_document(original.clone()).unwrap();
        let invalid = [
            EditOperation::AssignCubeFaceTexture {
                cube_uuid:CUBE.into(), face:"diagonal".into(), texture_uuid:TEXTURE.into(),
            },
            EditOperation::AssignCubeFaceTexture {
                cube_uuid:CUBE.into(), face:"north".into(),
                texture_uuid:"00000000-0000-4000-8000-000000009999".into(),
            },
        ];
        assert_eq!(session.apply(0, &[invalid[0].clone()]).unwrap_err(), "CUBE_FACE_INVALID");
        assert_eq!(session.apply(0, &[invalid[1].clone()]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
        assert_eq!(session.document(), &original);
        assert!(!session.can_undo());
        let mut scoped = original.clone();
        scoped.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        let mut session = EditorSession::from_document(scoped.clone()).unwrap();
        assert_eq!(session.apply(0, &[correct()]).unwrap_err(),
            "PAINT_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &scoped);
        assert!(!session.can_undo());
    }

    #[test]
    fn handoff_locates_out_of_atlas_and_zero_area_on_selected_cube_faces() {
        let mut doc = prepared().document().clone();
        let original = doc.clone();
        doc.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([-1.0,0.0,4.0,4.0]);
        doc.cubes[0].faces.get_mut("east").unwrap()["uv"] = json!([2.0,2.0,2.0,4.0]);
        let altered = doc.clone();
        let first = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 1).unwrap();
        let second = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 1, 1).unwrap();
        assert_eq!(first["status"], "blocked");
        assert_eq!(first["total_issues"], 2);
        assert_eq!(first["faces"]["selected_texture"], 6);
        assert_eq!(first["faces"]["uv_out_of_bounds"], 1);
        assert_eq!(first["faces"]["uv_zero_area"], 1);
        assert_eq!(first["issues"][0]["cube_uuid"], CUBE);
        assert_eq!(first["issues"][0]["face"], "north");
        assert_eq!(first["issues"][0]["problem"], "uv_out_of_bounds");
        assert_eq!(first["issues"][0]["uv_source"], "saved_manual");
        assert_eq!(first["issues"][0]["uv_rect"], json!([-1.0,0.0,4.0,4.0]));
        assert_eq!(first["next_issue_offset"], 1);
        assert_eq!(second["issues"][0]["face"], "east");
        assert_eq!(second["issues"][0]["problem"], "uv_zero_area");
        assert_eq!(second["next_issue_offset"], Value::Null);
        assert!(first["blockers"].as_array().unwrap().contains(&json!("UV_OUT_OF_ATLAS")));
        assert!(first["blockers"].as_array().unwrap().contains(&json!("UV_ZERO_AREA")));
        assert_eq!(first["geometry"]["status"], "source_exportable");
        assert_eq!(first["texture"]["status"], "source_exportable");
        assert_eq!(first["geometry"], second["geometry"]);
        assert_eq!(doc, altered);
        assert_eq!(original.cubes[0].faces["north"]["uv"], json!([0,0,4,4]));
    }

    #[test]
    fn reversed_and_fractional_manual_uv_are_not_false_atlas_failures() {
        let mut doc = prepared().document().clone();
        doc.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([4.5,4.0,0.5,0.0]);
        let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
        assert_eq!(report["status"], "source_consistent");
        assert_eq!(report["total_issues"], 0);
        assert_eq!(report["faces"]["uv_out_of_bounds"], 0);
        assert_eq!(report["faces"]["uv_zero_area"], 0);
    }

    #[test]
    fn box_uv_uses_derived_net_bounds_without_rewriting_saved_face_uvs() {
        let mut doc = prepared().document().clone();
        doc.meta.box_uv = Some(true);
        let original = doc.clone();
        let valid = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
        assert_eq!(valid["status"], "source_consistent");
        doc.cubes[0].uv_offset = Some([127.0,127.0]);
        let altered = doc.clone();
        let blocked = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 16).unwrap();
        assert_eq!(blocked["status"], "blocked");
        assert!(blocked["faces"]["uv_out_of_bounds"].as_u64().unwrap() > 0);
        assert_eq!(blocked["issues"][0]["uv_source"], "derived_box");
        assert!(blocked["blockers"].as_array().unwrap().contains(&json!("UV_OUT_OF_ATLAS")));
        assert_eq!(blocked["geometry"]["status"], "source_exportable");
        assert_eq!(doc, altered);
        assert_eq!(original.cubes[0].faces, altered.cubes[0].faces);
    }

    #[test]
    fn authored_visible_bounds_are_read_from_real_geometry_export_without_mutation() {
        let mut session = prepared();
        let baseline = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(baseline["geometry"]["status"],"source_exportable");
        assert_eq!(baseline["geometry"]["visible_bounds_source"],"computed_static");
        assert_eq!(baseline["geometry"]["visible_bounds"]["width"],2.0);
        assert_eq!(baseline["geometry"]["visible_bounds"]["height"],2.0);
        assert_eq!(baseline["geometry"]["visible_bounds"]["offset"],json!([0.0,0.0,0.0]));
        let original = session.document().clone();
        session.apply(1, &[EditOperation::SetVisibleBox {
            bounds:[12.0,4.0,0.0],
        }]).unwrap();
        let saved = session.document().clone();
        let expanded = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(expanded["geometry"]["visible_bounds_source"],"saved_visible_box_union");
        assert_eq!(expanded["geometry"]["visible_bounds"]["width"],12.0);
        assert_eq!(expanded["geometry"]["visible_bounds"]["height"],4.0);
        assert_eq!(expanded["geometry"]["visible_bounds"]["offset"],json!([0.0,0.0,0.0]));
        assert_ne!(baseline["geometry"]["sha256"],expanded["geometry"]["sha256"]);
        assert_eq!(baseline["texture"]["sha256"],expanded["texture"]["sha256"]);
        assert_eq!(baseline["animation"]["sha256"],expanded["animation"]["sha256"]);
        assert_eq!(original.cubes,saved.cubes);
        assert_eq!(original.animation_assets,saved.animation_assets);
        assert_eq!(session.document(),&saved);
        assert_eq!(expanded["native_verdict"],"NOT_EXECUTED");
    }

    #[test]
    fn looping_numeric_handoff_locates_endpoint_axis_review_candidate_without_rewriting_assets() {
        const BONE: &str = "00000000-0000-4000-8000-000000000001";
        const START: &str = "00000000-0000-4000-8000-000000007101";
        const END: &str = "00000000-0000-4000-8000-000000007102";
        let mut session = prepared();
        session.apply(1, &[
            EditOperation::SetAnimationLoopMode {
                animation_uuid: ANIMATION.into(), mode: "loop".into(),
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: START.into(), channel: "position".into(),
                time: 0.0, value: [0.0, 0.0, 0.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: END.into(), channel: "position".into(),
                time: 1.0, value: [0.0, 0.0, 0.0],
            }
        ]).unwrap();
        let saved = session.export().unwrap();
        let clear = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(clear["animation"]["loop_seams"]["looping_clips"], 1);
        assert_eq!(clear["animation"]["loop_seams"]["reviewed_channels"], 1);
        assert_eq!(clear["animation"]["loop_seams"]["review_candidates"], 0);
        assert_eq!(clear["animation"]["loop_seams"]["visual_verdict"], "UNVERIFIED");
        assert_eq!(session.export().unwrap(), saved);

        session.apply(2, &[EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: END.into(), channel: "position".into(),
            time: 1.0, value: [3.0, 0.0, 0.0],
        }]).unwrap();
        let changed = session.export().unwrap();
        let found = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(found["status"], "source_consistent");
        assert_eq!(found["animation"]["loop_seams"]["status"], "needs_review");
        assert_eq!(found["animation"]["loop_seams"]["review_candidates"], 1);
        assert_eq!(found["animation"]["loop_seams"]["issues"][0]["problem"],
            "endpoint_axis_difference");
        assert_eq!(found["animation"]["loop_seams"]["issues"][0]["bone_uuid"], BONE);
        // Numerical Euler-axis differences are review candidates, not proof
        // of a different 3D orientation or rendered loop artifact.
        assert_eq!(found["animation"]["loop_seams"]["issues"][0]["axis_delta"],
            json!([3.0, 0.0, 0.0]));
        assert_eq!(found["geometry"]["sha256"], clear["geometry"]["sha256"]);
        assert_eq!(found["texture"]["sha256"], clear["texture"]["sha256"]);
        assert_ne!(found["animation"]["sha256"], clear["animation"]["sha256"]);
        assert_eq!(session.export().unwrap(), changed);
        assert_eq!(EditorSession::open(&changed).unwrap().document(),
            session.document());

        // Missing endpoints are evidence gaps, not inferred discontinuities.
        session.apply(3, &[EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: START.into(), channel: "position".into(),
            time: 0.25, value: [0.0, 0.0, 0.0],
        }]).unwrap();
        let missing = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(missing["animation"]["loop_seams"]["issues"][0]["problem"],
            "boundary_not_explicit");
        assert_eq!(missing["animation"]["loop_seams"]["issues"][0]["missing_boundaries"],
            json!(["start"]));
        assert!(missing["animation"]["loop_seams"]["issues"][0].get("axis_delta").is_none());
    }

    #[test]
    fn loop_seam_read_does_not_infer_errors_from_full_turn_or_opaque_clips() {
        const BONE: &str = "00000000-0000-4000-8000-000000000001";
        let mut session = prepared();
        session.apply(1, &[
            EditOperation::SetAnimationLoopMode {
                animation_uuid: ANIMATION.into(), mode: "loop".into(),
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: "00000000-0000-4000-8000-000000007201".into(),
                channel: "rotation".into(), time: 0.0, value: [0.0, 0.0, 0.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: "00000000-0000-4000-8000-000000007202".into(),
                channel: "rotation".into(), time: 1.0, value: [360.0, 0.0, 0.0],
            }
        ]).unwrap();
        let snapshot = session.document().clone();
        let normal = inspect_bedrock_asset_handoff(&snapshot, TEXTURE).unwrap();
        assert_eq!(normal["animation"]["loop_seams"]["review_candidates"], 0);
        assert_eq!(normal["animation"]["loop_seams"]["status"], "no_endpoint_candidates");
        let mut opaque = snapshot.clone();
        opaque.animation_assets[0]["unsupported_metadata"] = json!({"keep":true});
        let uncertain = inspect_bedrock_asset_handoff(&opaque, TEXTURE).unwrap();
        assert_eq!(uncertain["animation"]["status"], "blocked");
        assert_eq!(uncertain["animation"]["loop_seams"]["unsupported_looping_clips"], 1);
        assert_eq!(uncertain["animation"]["loop_seams"]["status"], "unsupported");
        assert_eq!(opaque.animation_assets[0]["unsupported_metadata"]["keep"], true);
        assert_eq!(session.document(), &snapshot);
    }


    #[test]
    fn source_translation_clearance_detects_uncovered_motion_without_publishing_changes() {
        const BONE: &str = "00000000-0000-4000-8000-000000000001";
        const START: &str = "00000000-0000-4000-8000-000000008101";
        const END: &str = "00000000-0000-4000-8000-000000008102";
        let mut session = prepared();
        let original = session.export().unwrap();
        let before = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(before["geometry"]["translation_clearance"]["status"],
            "no_numeric_translation");
        session.apply(1, &[
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: START.into(), channel: "position".into(),
                time: 0.0, value: [0.0, 0.0, 0.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: END.into(), channel: "position".into(),
                time: 1.0, value: [64.0, 0.0, 0.0],
            },
        ]).unwrap();
        let authored = session.export().unwrap();
        let short = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(short["status"], "source_consistent");
        assert_eq!(short["geometry"]["translation_clearance"]["status"],
            "conservative_margin_shortfall");
        assert_eq!(short["geometry"]["translation_clearance"]["max_reach_model_units"],64.0);
        assert_eq!(short["geometry"]["translation_clearance"]["required_conservative_bounds"]["width"],10.0);
        assert_eq!(short["geometry"]["translation_clearance"]["shortfall_blocks"]["horizontal_width"],8.0);
        assert_eq!(short["geometry"]["translation_clearance"]["controller_blends"],"NOT_ASSESSED");
        assert_eq!(short["texture"]["sha256"],before["texture"]["sha256"]);
        assert_eq!(short["geometry"]["sha256"],before["geometry"]["sha256"]);
        assert_ne!(short["animation"]["sha256"],before["animation"]["sha256"]);
        assert_eq!(session.export().unwrap(), authored);

        session.apply(2, &[EditOperation::SetVisibleBox { bounds:[12.0, 12.0, 0.0] }]).unwrap();
        let expanded = session.export().unwrap();
        let covered = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
        assert_eq!(covered["status"], "source_consistent");
        assert_eq!(covered["geometry"]["translation_clearance"]["status"],"source_budget_covered");
        assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["horizontal_width"],0.0);
        assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["below"],0.0);
        assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["above"],0.0);
        assert_ne!(covered["geometry"]["sha256"],short["geometry"]["sha256"]);
        assert_eq!(covered["texture"]["sha256"],short["texture"]["sha256"]);
        assert_eq!(covered["animation"]["sha256"],short["animation"]["sha256"]);
        assert_eq!(session.export().unwrap(),expanded);
        assert_eq!(EditorSession::open(&expanded).unwrap().document(),session.document());
        assert_ne!(original, authored);
    }

    #[test]
    fn source_translation_clearance_refuses_unbounded_rotation_and_curves() {
        const BONE: &str = "00000000-0000-4000-8000-000000000001";
        const FIRST: &str = "00000000-0000-4000-8000-000000008201";
        const SECOND: &str = "00000000-0000-4000-8000-000000008202";
        let mut session = prepared();
        session.apply(1, &[
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: FIRST.into(), channel: "position".into(),
                time: 0.0, value: [0.0,0.0,0.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: SECOND.into(), channel: "position".into(),
                time: 1.0, value: [16.0,0.0,0.0],
            },
            EditOperation::SetBoneTransformKeyframeInterpolation {
                animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
                keyframe_uuid: SECOND.into(), channel: "position".into(),
                interpolation: "catmullrom".into(),
            },
        ]).unwrap();
        let curved = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
        assert_eq!(curved["geometry"]["translation_clearance"]["status"],"unassessed");
        assert_eq!(curved["geometry"]["translation_clearance"]["reason"],
            "NONLINEAR_OR_UNBOUNDED_CURVE");
        assert_eq!(curved["geometry"]["status"],"source_exportable");

        session.apply(2, &[EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: SECOND.into(), channel: "position".into(),
            interpolation: "linear".into(),
        }]).unwrap();
        session.apply(3, &[EditOperation::AddBoneRotationKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008203".into(),
            time:0.5, rotation:[0.0, 90.0, 0.0],
        }]).unwrap();
        let rotated = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
        assert_eq!(rotated["geometry"]["translation_clearance"]["status"],"unassessed");
        assert_eq!(rotated["geometry"]["translation_clearance"]["reason"],
            "ANIMATED_ROTATION_UNASSESSED");
        let mut opaque = session.document().clone();
        opaque.animation_assets[0]["unknown_imported"] = json!({"safe":true});
        let unknown = inspect_bedrock_asset_handoff(&opaque,TEXTURE).unwrap();
        assert_eq!(unknown["geometry"]["translation_clearance"]["status"],"unassessed");
        assert_eq!(unknown["geometry"]["translation_clearance"]["reason"],
            "OPAQUE_OR_UNSUPPORTED_CLIP");
        assert_eq!(unknown["animation"]["status"],"blocked");
        assert_eq!(opaque.animation_assets[0]["unknown_imported"]["safe"],true);
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
