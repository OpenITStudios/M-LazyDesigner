//! Standalone headless adapter to the canonical Rust authoring library.
//! SOURCE ONLY: Windows CLI, filesystem and Blockbench behavior NOT_EXECUTED.

use lazydesigner::authoring::{
    sha256, export_paint_png, export_bedrock_geometry, inspect_rotation_track, AuthoringDocument, OutlinerNode, EditOperation, EditPlan, EditorSession,
    MAX_MODEL_BYTES, MAX_PLAN_BYTES, MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lazydesigner::authoring::storage::{bbmodel, png, geometry_json, publish_new, publish_new_png, publish_new_geometry, read_bounded, same_directory};
use rand::RngCore;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
#[cfg(test)]
use std::fs;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.into() }

fn arguments() -> Result<(String, BTreeMap<String, String>)> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or_else(|| fail("COMMAND_REQUIRED"))?;
    let mut options = BTreeMap::new();
    while let Some(key) = args.next() {
        if !key.starts_with("--") || key.len() < 3 { return Err(fail("OPTION_INVALID")); }
        let value = args.next().ok_or_else(|| fail("OPTION_VALUE_REQUIRED"))?;
        if value.starts_with("--") || options.insert(key, value).is_some() {
            return Err(fail("OPTION_DUPLICATE_OR_INVALID"));
        }
    }
    Ok((command, options))
}
fn option<'a>(options: &'a BTreeMap<String, String>, key: &str) -> Result<&'a str> {
    options.get(key).map(String::as_str).ok_or_else(|| fail("OPTION_REQUIRED"))
}
fn option_set(options: &BTreeMap<String, String>, allowed: &[&str]) -> Result<()> {
    let allowed: HashSet<&str> = allowed.iter().copied().collect();
    if options.keys().any(|k| !allowed.contains(k.as_str())) {
        Err(fail("OPTION_UNKNOWN"))
    } else { Ok(()) }
}

// Apply and import-png share one source-integrity gate. Both publish only
// a new sibling; neither overwrites or rewrites the selected source model.
fn ensure_source_sha(actual_sha: &str, expected_sha: &str) -> Result<()> {
    if expected_sha.len() != 64 ||
       !expected_sha.bytes().all(|byte| byte.is_ascii_hexdigit()) ||
       !actual_sha.eq_ignore_ascii_case(expected_sha) {
        return Err(fail("SOURCE_SHA256_STALE"));
    }
    Ok(())
}

fn read_verified_source(path: &Path, expected_sha: &str) -> Result<(Vec<u8>, String)> {
    bbmodel(path)?;
    let bytes = read_bounded(path, MAX_MODEL_BYTES)?;
    let actual_sha = sha256(&bytes);
    ensure_source_sha(&actual_sha, expected_sha)?;
    Ok((bytes, actual_sha))
}

/// Bounded, read-only Code Mode projection. Opaque model data is never echoed.
fn parent_for(nodes: &[OutlinerNode], target: &str, parent: Option<&str>) -> Option<Option<String>> {
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) if id == target => return Some(parent.map(str::to_owned)),
            OutlinerNode::Bone(bone) => {
                if bone.uuid == target { return Some(parent.map(str::to_owned)); }
                if let Some(found) = parent_for(&bone.children, target, Some(&bone.uuid)) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

fn focused_element(doc: &AuthoringDocument, uuid: &str) -> Result<Value> {
    let parent = parent_for(&doc.hierarchy, uuid, None)
        .ok_or_else(|| fail("ELEMENT_NOT_IN_OUTLINER"))?.flatten();
    let detail = if let Some(cube) = doc.cubes.iter().find(|item| item.uuid == uuid) {
        let mut faces = serde_json::Map::new();
        for (direction, face) in &cube.faces {
            faces.insert(direction.clone(), json!({
                "uv": face.get("uv"),
                "rotation": face.get("rotation"),
                "texture": face.get("texture"),
            }));
        }
        json!({
            "uuid": uuid, "kind": "cube", "name": cube.name.as_deref(),
            "parent_uuid": parent, "from": cube.from, "to": cube.to,
            "origin": cube.origin, "uv_offset": cube.uv_offset,
            "rotation": cube.extra.get("rotation"), "inflate": cube.extra.get("inflate"),
            "stretch": cube.extra.get("stretch"), "box_uv": cube.extra.get("box_uv"),
            "autouv": cube.extra.get("autouv"), "faces": faces,
        })
    } else if let Some(bone) = doc.bones.iter().find(|item| item.uuid == uuid) {
        json!({
            "uuid": uuid, "kind": "bone", "name": bone.name,
            "parent_uuid": parent, "origin": bone.origin,
            "rotation": bone.extra.get("rotation"),
            "visibility": bone.extra.get("visibility"),
        })
    } else {
        return Err(fail("ELEMENT_NOT_FOUND"));
    };
    if serde_json::to_vec(&detail).map_err(|_| fail("ELEMENT_SERIALIZE_FAILED"))?.len() > 16 * 1024 {
        return Err(fail("ELEMENT_PROJECTION_TOO_LARGE"));
    }
    Ok(detail)
}

/// Only identities and short names are projected. No opaque blob or PNG is sent.
fn short_name(value: Option<&str>) -> Option<String> {
    value.map(|name| name.chars().take(160).collect())
}

fn inspect_catalog(doc: &AuthoringDocument, kind: &str, offset: usize, limit: usize) -> Result<Value> {
    let mut entries = Vec::new();
    let total = match kind {
        "cubes" => doc.cubes.len(),
        "bones" => doc.bones.len(),
        "textures" => doc.texture_assets.len(),
        "animations" => doc.animation_assets.len(),
        _ => return Err(fail("INSPECT_LIST_KIND_UNKNOWN")),
    };
    let end = offset.saturating_add(limit).min(total);
    if offset < total {
        for index in offset..end {
            let entry = match kind {
                "cubes" => {
                    let item = &doc.cubes[index];
                    json!({"uuid":item.uuid,"name":short_name(item.name.as_deref()),"kind":"cube","index":index})
                }
                "bones" => {
                    let item = &doc.bones[index];
                    json!({"uuid":item.uuid,"name":short_name(Some(&item.name)),"kind":"bone","index":index})
                }
                "textures" => {
                    let item = &doc.texture_assets[index];
                    json!({"uuid":item.get("uuid"),"name":short_name(item.get("name").and_then(Value::as_str)),"kind":"texture","index":index})
                }
                "animations" => {
                    let item = &doc.animation_assets[index];
                    json!({"uuid":item.get("uuid"),"name":short_name(item.get("name").and_then(Value::as_str)),"kind":"animation","index":index})
                }
                _ => unreachable!(),
            };
            entries.push(entry);
        }
    }
    let result = json!({"kind":kind,"entries":entries,"offset":offset,
        "total":total,"next_offset":if end < total {Some(end)} else {None}});
    if serde_json::to_vec(&result).map_err(|_| fail("INSPECT_SERIALIZE_FAILED"))?.len() > 32 * 1024 {
        return Err(fail("INSPECT_RESULT_TOO_LARGE"));
    }
    Ok(result)
}

fn inspect_asset(doc: &AuthoringDocument, kind: &str, key: &str) -> Result<Value> {
    let (index, asset) = if kind == "texture" {
        let index = key.parse::<usize>().map_err(|_| fail("INSPECT_TEXTURE_INDEX_INVALID"))?;
        (index, doc.texture_assets.get(index).ok_or_else(|| fail("INSPECT_TEXTURE_NOT_FOUND"))?)
    } else {
        doc.animation_assets.iter().enumerate()
            .find(|(_, asset)| asset.get("uuid").and_then(Value::as_str) == Some(key))
            .ok_or_else(|| fail("INSPECT_ANIMATION_NOT_FOUND"))?
    };
    let detail = if kind == "texture" {
        let source_kind = match asset.get("source").and_then(Value::as_str) {
            Some(value) if value.starts_with("data:image/png;base64,") => "embedded_png",
            Some(_) => "external_or_other",
            None => "unavailable",
        };
        json!({"kind":"texture","index":index,"uuid":asset.get("uuid"),
            "name":short_name(asset.get("name").and_then(Value::as_str)),
            "source_kind":source_kind,"uv_width":asset.get("uv_width"),
            "uv_height":asset.get("uv_height"),"scope":asset.get("scope"),
            "render_mode":asset.get("render_mode"),"paint_owner":asset.get("paint_owner")})
    } else {
        json!({"kind":"animation","index":index,"uuid":asset.get("uuid"),
            "name":short_name(asset.get("name").and_then(Value::as_str)),
            "length":asset.get("length"),
            "animator_count":asset.get("animators").and_then(Value::as_object).map(|v|v.len())})
    };
    if serde_json::to_vec(&detail).map_err(|_| fail("INSPECT_SERIALIZE_FAILED"))?.len() > 16 * 1024 {
        return Err(fail("INSPECT_RESULT_TOO_LARGE"));
    }
    Ok(detail)
}

/// Structural counts only. No texture pixels, hidden faces, animation
/// playback, visual fidelity or user review are inferred from this audit.
fn inspect_model_audit(doc: &AuthoringDocument) -> Value {
    let mut null_faces = 0usize;
    let mut false_refs = 0usize;
    let mut index_refs = 0usize;
    let mut uuid_refs = 0usize;
    let mut other_refs = 0usize;
    for cube in &doc.cubes {
        for face in cube.faces.values() {
            match face.get("texture") {
                Some(Value::Null) => null_faces += 1,
                Some(Value::Bool(false)) => false_refs += 1,
                Some(Value::Number(_)) => index_refs += 1,
                Some(Value::String(_)) => uuid_refs += 1,
                _ => other_refs += 1,
            }
        }
    }
    let mut embedded_png = 0usize;
    let mut external_relative = 0usize;
    let mut unknown_source = 0usize;
    for texture in &doc.texture_assets {
        if texture.get("source").and_then(Value::as_str)
            .is_some_and(|s| s.starts_with("data:image/png;base64,")) {
            embedded_png += 1;
        } else if texture.get("relative_path").and_then(Value::as_str).is_some() {
            external_relative += 1;
        } else {
            unknown_source += 1;
        }
    }
    let root_bones = doc.hierarchy.iter()
        .filter(|node| matches!(node, OutlinerNode::Bone(_))).count();
    let declared_tracks = doc.animation_assets.iter()
        .filter_map(|animation| animation.get("animators").and_then(Value::as_object))
        .fold(0usize, |sum, animators| sum.saturating_add(animators.len()));
    json!({
        "scope":"static_metadata_only",
        "visual_verdict":"UNVERIFIED",
        "faces": {
            "total":doc.cubes.len().saturating_mul(6),
            "null_or_absent":null_faces,
            "false_reference":false_refs,
            "numeric_reference":index_refs,
            "uuid_reference":uuid_refs,
            "other_or_unset_reference":other_refs
        },
        "textures": {
            "total":doc.texture_assets.len(),
            "embedded_png_declared":embedded_png,
            "external_relative_declared":external_relative,
            "unknown_or_other_source":unknown_source
        },
        "rig": {
            "cubes":doc.cubes.len(),
            "bones":doc.bones.len(),
            "root_bones":root_bones
        },
        "animation": {
            "clips":doc.animation_assets.len(),
            "declared_animator_tracks":declared_tracks
        }
    })
}

fn execute() -> Result<Value> {
    let (command, options) = arguments()?;
    match command.as_str() {
        "new" => {
            option_set(&options, &["--output", "--name", "--model-identifier"])?;
            let path = PathBuf::from(option(&options, "--output")?);
            let doc = AuthoringDocument::new_bedrock(
                option(&options, "--name")?, option(&options, "--model-identifier")?
            )?;
            let data = doc.export_bbmodel()?;
            publish_new(&path, &data, MAX_MODEL_BYTES)?;
            Ok(json!({"status":"OK","sha256":sha256(&data),"summary":doc.summary(0)}))
        }
        "inspect" => {
            option_set(&options, &["--input", "--uuid", "--list", "--offset", "--limit", "--texture-index", "--animation-uuid", "--bone-uuid", "--frame-offset", "--frame-limit", "--audit", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            bbmodel(&input)?;
            let bytes = read_bounded(&input, MAX_MODEL_BYTES)?;
            let session = EditorSession::open(&bytes)?;
            let digest = sha256(&bytes);
            if let Some(expected) = options.get("--expected-sha256") {
                ensure_source_sha(&digest, expected)?;
            }
            let query_count = ["--uuid", "--list", "--texture-index", "--animation-uuid", "--audit"]
                .iter().filter(|key| options.contains_key(*key)).count();
            if query_count > 1 ||
                (!options.contains_key("--list") &&
                    (options.contains_key("--offset") || options.contains_key("--limit"))) ||
                (!options.contains_key("--animation-uuid") &&
                    (options.contains_key("--bone-uuid") ||
                     options.contains_key("--frame-offset") ||
                     options.contains_key("--frame-limit"))) ||
                (!options.contains_key("--bone-uuid") &&
                    (options.contains_key("--frame-offset") ||
                     options.contains_key("--frame-limit"))) {
                return Err(fail("INSPECT_QUERY_CONFLICT"));
            }
            if let Some(uuid) = options.get("--uuid") {
                let element = focused_element(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"element":element}))
            } else if let Some(kind) = options.get("--list") {
                let offset = options.get("--offset").map(|s|s.parse::<usize>())
                    .transpose().map_err(|_| fail("INSPECT_OFFSET_INVALID"))?.unwrap_or(0);
                let limit = options.get("--limit").map(|s|s.parse::<usize>())
                    .transpose().map_err(|_| fail("INSPECT_LIMIT_INVALID"))?.unwrap_or(32);
                if limit == 0 || limit > 64 { return Err(fail("INSPECT_LIMIT_INVALID")); }
                let catalog = inspect_catalog(session.document(), kind, offset, limit)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"catalog":catalog}))
            } else if let Some(index) = options.get("--texture-index") {
                let asset = inspect_asset(session.document(), "texture", index)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"asset":asset}))
            } else if let Some(uuid) = options.get("--animation-uuid") {
                if let Some(bone_uuid) = options.get("--bone-uuid") {
                    let offset = options.get("--frame-offset").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(0);
                    let limit = options.get("--frame-limit").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(32);
                    let track = inspect_rotation_track(session.document(), uuid, bone_uuid, offset, limit)?;
                    Ok(json!({"status":"OK","sha256":digest,
                        "summary":session.summary(),"track":track}))
                } else {
                    let asset = inspect_asset(session.document(), "animation", uuid)?;
                    Ok(json!({"status":"OK","sha256":digest,
                        "summary":session.summary(),"asset":asset}))
                }
            } else if let Some(scope) = options.get("--audit") {
                if scope != "model" { return Err(fail("INSPECT_AUDIT_UNSUPPORTED")); }
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"audit":inspect_model_audit(session.document())}))
            } else {
                Ok(json!({"status":"OK","sha256":digest,"summary":session.summary()}))
            }
        }
        "apply" => {
            option_set(&options, &["--input", "--output", "--plan", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            bbmodel(&output)?;
            same_directory(&input, &output)?;
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let plan_bytes = read_bounded(
                Path::new(option(&options, "--plan")?), MAX_PLAN_BYTES
            )?;
            let plan: EditPlan = serde_json::from_slice(&plan_bytes)
                .map_err(|_| fail("EDIT_PLAN_INVALID"))?;
            let mut session = EditorSession::open(&bytes)?;
            let receipt = session.apply(plan.expected_revision, &plan.operations)?;
            let out = session.export()?;
            // Another writer may have changed the source while the batch ran.
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != actual_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &out, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK","source_sha256":actual_sha,"output_sha256":sha256(&out),
                "summary":session.summary(),"mutation":receipt
            }))
        }
        "import-png" => {
            option_set(&options, &[
                "--input", "--output", "--png", "--uuid", "--name", "--expected-sha256",
            ])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            let image = PathBuf::from(option(&options, "--png")?);
            bbmodel(&output)?;
            same_directory(&input, &output)?;
            png(&image)?;
            let (bytes, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let png_bytes = read_bounded(&image, MAX_IMPORT_PNG_BYTES)?;
            // Only the original embedded image enters Rust model state.
            // The input file path is never written into the .bbmodel.
            let source = format!("data:image/png;base64,{}", STANDARD.encode(png_bytes));
            let mut session = EditorSession::open(&bytes)?;
            let receipt = session.apply(0, &[EditOperation::ImportPaintTexture {
                uuid: option(&options, "--uuid")?.to_owned(),
                name: option(&options, "--name")?.to_owned(),
                source,
            }])?;
            let output_bytes = session.export()?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &output_bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&output_bytes), "summary":session.summary(),
                "mutation":receipt
            }))
        }
        "export-png" => {
            option_set(&options, &[
                "--input", "--output", "--texture-uuid", "--expected-sha256",
            ])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            png(&output)?;
            same_directory(&input, &output)?;
            let (bytes, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&bytes)?;
            let uuid = option(&options, "--texture-uuid")?;
            let png_bytes = export_paint_png(session.document(), uuid)?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&png_bytes),
                "texture_uuid":uuid, "bytes":png_bytes.len(),
                "summary":session.summary()
            }))
        }
        "export-geometry" => {
            option_set(&options, &["--input", "--output", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            geometry_json(&output)?;
            same_directory(&input, &output)?;
            let (original, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&original)?;
            let bytes = export_bedrock_geometry(session.document())?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&bytes), "bytes":bytes.len(),
                "format":"minecraft:geometry", "summary":session.summary()
            }))
        }
        _ => Err(fail("UNKNOWN_COMMAND_USE_NEW_INSPECT_APPLY_IMPORT_PNG_EXPORT_PNG_EXPORT_GEOMETRY")),
    }
}

fn main() {
    match execute() {
        Ok(report) => println!("{}", report),
        Err(code) => {
            println!("{}", json!({"status":"ERROR","code":code}));
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Source-authored only; Cargo/local execution remains on hold.
    #[test]
    fn code_mode_recognized_rotation_track_has_uuid_time_and_numeric_axes() {
        let mut session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = session.document().bones[0].uuid.clone();
        let anim = "00000000-0000-4000-8000-000000000701";
        let key = "00000000-0000-4000-8000-000000000702";
        session.apply(0, &[
            EditOperation::CreateAnimation { uuid: anim.into(), name: "inspection".into(), length: 2.0 },
            EditOperation::AddBoneRotationKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: key.into(), time: 1.0, rotation: [0.0, 35.0, 0.0],
            }
        ]).unwrap();
        let original = session.document().clone();
        let track = inspect_rotation_track(session.document(), anim, &bone, 0, 16).unwrap();
        assert_eq!(track["recognized"], json!(true));
        assert_eq!(track["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(track["total_frames"], json!(1));
        assert_eq!(track["keyframes"][0]["uuid"], json!(key));
        assert_eq!(track["keyframes"][0]["time"], json!(1.0));
        assert_eq!(track["keyframes"][0]["rotation"], json!([0.0, 35.0, 0.0]));
        assert!(track["next_offset"].is_null());
        assert_eq!(session.document(), &original);
        assert_eq!(inspect_rotation_track(session.document(), anim, &bone, 0, 65).unwrap_err(),
            "ANIMATION_INSPECT_PAGE_INVALID");
        let mut opaque = original.clone();
        opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"] =
            json!("query.head_yaw");
        let restricted = inspect_rotation_track(&opaque, anim, &bone, 0, 8).unwrap();
        assert_eq!(restricted["recognized"], json!(false));
        assert!(restricted["keyframes"].as_array().unwrap().is_empty());
        assert_eq!(opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"],
            json!("query.head_yaw"));
    }

    #[test]
    fn code_mode_read_sha_gate_rejects_stale_and_malformed_expected_hash() {
        let actual = "a".repeat(64);
        assert!(ensure_source_sha(&actual, &actual).is_ok());
        assert!(ensure_source_sha(&actual, &actual.to_uppercase()).is_ok());
        assert_eq!(ensure_source_sha(&actual, &"b".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        assert_eq!(ensure_source_sha(&actual, "bad").unwrap_err(),
            "SOURCE_SHA256_STALE");
    }

    #[test]
    fn code_mode_static_audit_counts_reference_shapes_without_visual_claims() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let original = doc.clone();
        let report = inspect_model_audit(&doc);
        assert_eq!(report["scope"], json!("static_metadata_only"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["faces"]["total"], json!(6));
        assert_eq!(report["faces"]["null_or_absent"], json!(1));
        assert_eq!(report["faces"]["numeric_reference"], json!(5));
        assert_eq!(report["textures"]["embedded_png_declared"], json!(1));
        assert_eq!(report["textures"]["external_relative_declared"], json!(1));
        assert_eq!(report["animation"]["declared_animator_tracks"], json!(1));
        assert_eq!(doc, original);
    }

    // Source-authored regression; local execution remains on hold.
    #[test]
    fn code_mode_catalog_pages_identities_and_retains_model_state() {
        let source = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let doc = AuthoringDocument::import_bbmodel(source).unwrap();
        let before = doc.clone();
        let list = inspect_catalog(&doc, "cubes", 0, 1).unwrap();
        assert_eq!(list["total"], json!(doc.cubes.len()));
        assert_eq!(list["entries"][0]["uuid"], json!(doc.cubes[0].uuid));
        assert_eq!(list["entries"][0]["kind"], json!("cube"));
        assert_eq!(doc, before);
        assert_eq!(inspect_catalog(&doc, "unsupported", 0, 32).unwrap_err(),
            "INSPECT_LIST_KIND_UNKNOWN");
    }

    #[test]
    fn code_mode_asset_metadata_is_read_only() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        doc.texture_assets.push(json!({
            "uuid":"00000000-0000-4000-8000-000000000777",
            "name":"texture.png","source":"data:image/png;base64,SECRET",
        }));
        let texture = inspect_asset(&doc,"texture","0").unwrap();
        assert_eq!(texture["source_kind"], json!("embedded_png"));
        assert!(texture.get("source").is_none());
        assert_eq!(inspect_asset(&doc,"texture","99").unwrap_err(),
            "INSPECT_TEXTURE_NOT_FOUND");
    }

    #[test]
    fn code_mode_focused_inspect_is_bounded_and_read_only() {
        let source = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let doc = AuthoringDocument::import_bbmodel(source).unwrap();
        let before = doc.clone();
        let id = doc.cubes[0].uuid.clone();
        let detail = focused_element(&doc, &id).unwrap();
        assert_eq!(detail["uuid"], json!(id));
        assert_eq!(detail["kind"], json!("cube"));
        assert!(detail["faces"]["north"]["uv"].is_array());
        assert_eq!(doc, before);
        assert_eq!(focused_element(&doc, "not-an-element").unwrap_err(),
            "ELEMENT_NOT_IN_OUTLINER");
    }

    // Source-authored regression only; native filesystem execution is held.
    #[test]
    fn refuses_to_overwrite_an_existing_project() {
        let folder = std::env::temp_dir().join(
            format!("lazydesigner-regression-{:016x}", rand::rng().next_u64())
        );
        fs::create_dir(&folder).unwrap();
        let target = folder.join("existing.bbmodel");
        fs::write(&target, b"original").unwrap();
        assert_eq!(publish_new(&target, b"replacement", MAX_MODEL_BYTES).unwrap_err(), "OUTPUT_ALREADY_EXISTS");
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(target).unwrap();
        fs::remove_dir(folder).unwrap();
    }
    #[test]
    fn bedrock_geometry_export_follows_verified_source_and_no_overwrite() {
        let dir = std::env::temp_dir().join(
            format!("lazydesigner-cli-geometry-{:016x}", rand::rng().next_u64()));
        fs::create_dir(&dir).unwrap();
        let input = dir.join("model.bbmodel");
        let output = dir.join("model.geo.json");
        let original = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        fs::write(&input, original).unwrap();
        assert_eq!(read_verified_source(&input, &"f".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        let (source, expected_sha) = read_verified_source(&input, &sha256(original)).unwrap();
        let session = EditorSession::open(&source).unwrap();
        let bytes = export_bedrock_geometry(session.document()).unwrap();
        same_directory(&input, &output).unwrap();
        publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES).unwrap();
        assert_eq!(fs::read(&output).unwrap(), bytes);
        assert_eq!(publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES).unwrap_err(),
            "OUTPUT_ALREADY_EXISTS");
        assert_eq!(expected_sha, sha256(original));
        assert_eq!(fs::read(&input).unwrap(), original);
        fs::remove_file(output).unwrap();
        fs::remove_file(input).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn png_export_reuses_sha_guard_and_never_overwrites() {
        let dir = std::env::temp_dir().join(
            format!("lazydesigner-export-{:016x}", rand::rng().next_u64()));
        fs::create_dir(&dir).unwrap();
        let input = dir.join("model.bbmodel");
        let output = dir.join("texture.png");
        let id = "00000000-0000-4000-8000-000000000801";
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Export", "export").unwrap()
        ).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: id.into(), name: "texture.png".into(),
        }]).unwrap();
        let original = session.export().unwrap();
        fs::write(&input, &original).unwrap();
        assert_eq!(read_verified_source(&input, &"f".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        let (verified, expected) = read_verified_source(&input, &sha256(&original)).unwrap();
        let reopened = EditorSession::open(&verified).unwrap();
        let png_bytes = export_paint_png(reopened.document(), id).unwrap();
        assert!(png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        same_directory(&input, &output).unwrap();
        publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES).unwrap();
        assert_eq!(fs::read(&output).unwrap(), png_bytes);
        assert_eq!(publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES).unwrap_err(),
            "OUTPUT_ALREADY_EXISTS");
        assert_eq!(sha256(&original), expected);
        assert_eq!(fs::read(&input).unwrap(), original);
        fs::remove_file(input).unwrap();
        fs::remove_file(output).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    // Source-only CLI regression: no executable test was run.
    #[test]
    fn import_png_and_apply_share_a_sha_guarded_source_reader() {
        let folder = std::env::temp_dir().join(
            format!("lazydesigner-import-{:016x}", rand::rng().next_u64())
        );
        fs::create_dir(&folder).unwrap();
        let file = folder.join("source.bbmodel");
        let bytes = AuthoringDocument::new_bedrock("Source", "source")
            .unwrap().export_bbmodel().unwrap();
        fs::write(&file, &bytes).unwrap();
        let expected = sha256(&bytes);
        let (verified, got) = read_verified_source(&file, &expected).unwrap();
        assert_eq!(verified, bytes);
        assert_eq!(got, expected);
        assert_eq!(read_verified_source(&file, &"0".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        assert_eq!(read_verified_source(&file, "short").unwrap_err(),
            "SOURCE_SHA256_STALE");
        fs::remove_file(file).unwrap();
        fs::remove_dir(folder).unwrap();
    }

}
