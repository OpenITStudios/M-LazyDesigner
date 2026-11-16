//! Standalone headless adapter to the canonical Rust authoring library.
//! SOURCE ONLY: Windows CLI, filesystem and Blockbench behavior NOT_EXECUTED.

use lazydesigner::authoring::{
    sha256, export_paint_png, export_bedrock_geometry, inspect_rotation_track, inspect_transform_track, inspect_cube_surfaces, inspect_paint_alpha, inspect_cube_uv_alpha, inspect_cube_uv_sharing, inspect_model_texture_coverage_filtered, inspect_animation_effect_events,
    inspect_animation_timeline_markers, export_bedrock_animations, bedrock_animation_curve_fidelity,
    inspect_bedrock_asset_handoff_page, inspect_material_pair, MaterialPatchRegion, AuthoringDocument, OutlinerNode, EditOperation, EditPlan, EditorSession,
    MAX_MODEL_BYTES, MAX_PLAN_BYTES, MAX_IMPORT_PNG_BYTES, MAX_EXPORT_PNG_BYTES,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use lazydesigner::authoring::storage::{bbmodel, png, geometry_json, animation_json, publish_new, publish_new_png, publish_new_geometry, publish_new_animation, read_bounded, same_directory};
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

/// Read-only Code Mode query batch. A single model read and Rust parse answer
/// several focused questions. Unknown fields/shapes refuse, not auto-correct.
/// Each query reuses existing canonical source projections; no new authoring
/// state, mutation path, arbitrary JS execution or direct bitmap response.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct InspectBatchInput {
    requests: Vec<InspectBatchQuery>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum InspectBatchQuery {
    Cube { uuid: String },
    CubeSurfaces { uuid: String },
    CubeFaceAlpha { uuid: String },
    CubeUvSharing { uuid: String, texture_uuid: String },
    AssetHandoff { texture_uuid: String, offset: Option<usize>, limit: Option<usize> },
    ModelTextureCoverage { offset: Option<usize>, limit: Option<usize>, attention_only: Option<bool> },
    MaterialPair { reference_uuid: String, candidate_uuid: String,
        reference_region: MaterialPatchRegion, candidate_region: MaterialPatchRegion },
    Catalog { category: String, offset: Option<usize>, limit: Option<usize> },
    Texture { index: usize },
    TextureAlpha { uuid: String },
    Animation { uuid: String },
    AnimationTrack {
        animation_uuid: String, bone_uuid: String,
        offset: Option<usize>, limit: Option<usize>,
    },
    AnimationTransformTrack {
        animation_uuid: String, bone_uuid: String, channel: String,
        offset: Option<usize>, limit: Option<usize>,
    },
    AnimationEffectEvents {
        animation_uuid: String, offset: Option<usize>, limit: Option<usize>,
    },
    AnimationTimelineMarkers {
        animation_uuid: String, offset: Option<usize>, limit: Option<usize>,
    },
    Audit,
}

const MAX_INSPECT_BATCH_QUERIES: usize = 8;
const MAX_INSPECT_BATCH_RESULT_BYTES: usize = 96 * 1024;

fn batch_id(value: &str) -> Result<&str> {
    if value.is_empty() || value.len() > 128 ||
       value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(fail("INSPECT_BATCH_ID_INVALID"));
    }
    Ok(value)
}

fn inspect_batch(doc: &AuthoringDocument, requests: Vec<InspectBatchQuery>) -> Result<Vec<Value>> {
    if requests.is_empty() || requests.len() > MAX_INSPECT_BATCH_QUERIES {
        return Err(fail("INSPECT_BATCH_SIZE_INVALID"));
    }
    let mut results = Vec::with_capacity(requests.len());
    for query in requests {
        let entry = match query {
            InspectBatchQuery::Cube { uuid } => {
                let element = focused_element(doc, batch_id(&uuid)?)?;
                json!({"kind":"cube","element":element})
            },
            InspectBatchQuery::CubeSurfaces { uuid } => {
                let surfaces = inspect_cube_surfaces(doc, batch_id(&uuid)?)?;
                json!({"kind":"cube_surfaces","surfaces":surfaces})
            },
            InspectBatchQuery::CubeFaceAlpha { uuid } => {
                let face_alpha = inspect_cube_uv_alpha(doc, batch_id(&uuid)?)?;
                json!({"kind":"cube_face_alpha","face_alpha":face_alpha})
            },
            InspectBatchQuery::CubeUvSharing { uuid, texture_uuid } => {
                let uv_sharing = inspect_cube_uv_sharing(
                    doc, batch_id(&uuid)?, batch_id(&texture_uuid)?)?;
                json!({"kind":"cube_uv_sharing","uv_sharing":uv_sharing})
            },
            InspectBatchQuery::AssetHandoff { texture_uuid, offset, limit } => {
                let handoff = inspect_bedrock_asset_handoff_page(
                    doc, batch_id(&texture_uuid)?,
                    offset.unwrap_or(0), limit.unwrap_or(16))?;
                json!({"kind":"asset_handoff","handoff":handoff})
            },
            InspectBatchQuery::ModelTextureCoverage { offset, limit, attention_only } => {
                let coverage = inspect_model_texture_coverage_filtered(doc,
                    offset.unwrap_or(0), limit.unwrap_or(4),
                    attention_only.unwrap_or(false))?;
                json!({"kind":"model_texture_coverage","coverage":coverage})
            },
            InspectBatchQuery::MaterialPair {reference_uuid,candidate_uuid,
                reference_region,candidate_region} => {
                let comparison=inspect_material_pair(doc,
                    batch_id(&reference_uuid)?,batch_id(&candidate_uuid)?,
                    &reference_region,&candidate_region)?;
                json!({"kind":"material_pair","comparison":comparison})
            },
            InspectBatchQuery::Catalog { category, offset, limit } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let catalog = inspect_catalog(doc, &category, offset, limit)?;
                json!({"kind":"catalog","catalog":catalog})
            },
            InspectBatchQuery::Texture { index } => {
                if index > 65_536 { return Err(fail("INSPECT_BATCH_INDEX_INVALID")); }
                let asset = inspect_asset(doc, "texture", &index.to_string())?;
                json!({"kind":"texture","asset":asset})
            },
            InspectBatchQuery::TextureAlpha { uuid } => {
                let alpha = inspect_paint_alpha(doc, batch_id(&uuid)?)?;
                json!({"kind":"texture_alpha","alpha":alpha})
            },
            InspectBatchQuery::Animation { uuid } => {
                let asset = inspect_asset(doc, "animation", batch_id(&uuid)?)?;
                json!({"kind":"animation","asset":asset})
            },
            InspectBatchQuery::AnimationTrack {
                animation_uuid, bone_uuid, offset, limit,
            } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let track = inspect_rotation_track(
                    doc, batch_id(&animation_uuid)?, batch_id(&bone_uuid)?, offset, limit,
                )?;
                json!({"kind":"animation_track","track":track})
            },
            InspectBatchQuery::AnimationTransformTrack {
                animation_uuid, bone_uuid, channel, offset, limit,
            } => {
                let offset = offset.unwrap_or(0);
                let limit = limit.unwrap_or(32);
                if offset > 65_536 || limit == 0 || limit > 64 {
                    return Err(fail("INSPECT_BATCH_PAGE_INVALID"));
                }
                let track = inspect_transform_track(doc, batch_id(&animation_uuid)?,
                    batch_id(&bone_uuid)?, &channel, offset, limit)?;
                json!({"kind":"animation_transform_track","track":track})
            },
            InspectBatchQuery::AnimationEffectEvents {
                animation_uuid, offset, limit,
            } => {
                let effects=inspect_animation_effect_events(
                    doc,batch_id(&animation_uuid)?,offset.unwrap_or(0),limit.unwrap_or(16))?;
                json!({"kind":"animation_effect_events","effects":effects})
            },
            InspectBatchQuery::AnimationTimelineMarkers {
                animation_uuid, offset, limit,
            } => {
                let markers=inspect_animation_timeline_markers(
                    doc,batch_id(&animation_uuid)?,offset.unwrap_or(0),limit.unwrap_or(32))?;
                json!({"kind":"animation_timeline_markers","markers":markers})
            },
            InspectBatchQuery::Audit => {
                json!({"kind":"audit","audit":inspect_model_audit(doc)})
            },
        };
        results.push(entry);
    }
    if serde_json::to_vec(&results)
        .map_err(|_| fail("INSPECT_BATCH_SERIALIZE_FAILED"))?.len()
        > MAX_INSPECT_BATCH_RESULT_BYTES {
        return Err(fail("INSPECT_BATCH_RESULT_TOO_LARGE"));
    }
    Ok(results)
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
            option_set(&options, &["--input", "--uuid", "--list", "--offset", "--limit", "--texture-index", "--animation-uuid", "--bone-uuid", "--frame-offset", "--frame-limit", "--track-channel", "--surface-uuid", "--face-alpha-uuid", "--alpha-uuid", "--audit", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            bbmodel(&input)?;
            let bytes = read_bounded(&input, MAX_MODEL_BYTES)?;
            let session = EditorSession::open(&bytes)?;
            let digest = sha256(&bytes);
            if let Some(expected) = options.get("--expected-sha256") {
                ensure_source_sha(&digest, expected)?;
            }
            let query_count = ["--uuid", "--list", "--texture-index", "--animation-uuid", "--surface-uuid", "--face-alpha-uuid", "--alpha-uuid", "--audit"]
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
                     options.contains_key("--frame-limit") ||
                     options.contains_key("--track-channel"))) {
                return Err(fail("INSPECT_QUERY_CONFLICT"));
            }
            if let Some(uuid) = options.get("--uuid") {
                let element = focused_element(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"element":element}))
            } else if let Some(uuid) = options.get("--surface-uuid") {
                let surfaces = inspect_cube_surfaces(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"surfaces":surfaces}))
            } else if let Some(uuid) = options.get("--face-alpha-uuid") {
                let face_alpha = inspect_cube_uv_alpha(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"face_alpha":face_alpha}))
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
            } else if let Some(uuid) = options.get("--alpha-uuid") {
                let alpha = inspect_paint_alpha(session.document(), uuid)?;
                Ok(json!({"status":"OK","sha256":digest,
                    "summary":session.summary(),"alpha":alpha}))
            } else if let Some(uuid) = options.get("--animation-uuid") {
                if let Some(bone_uuid) = options.get("--bone-uuid") {
                    let offset = options.get("--frame-offset").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(0);
                    let limit = options.get("--frame-limit").map(|s|s.parse::<usize>())
                        .transpose().map_err(|_| fail("ANIMATION_INSPECT_PAGE_INVALID"))?.unwrap_or(32);
                    let track = if let Some(channel) = options.get("--track-channel") {
                        inspect_transform_track(session.document(), uuid, bone_uuid,
                            channel, offset, limit)?
                    } else {
                        inspect_rotation_track(session.document(), uuid, bone_uuid, offset, limit)?
                    };
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
        "inspect-batch" => {
            option_set(&options, &["--input", "--queries", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let (bytes, actual_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            // One model open across all bounded, read-only selectors.
            let session = EditorSession::open(&bytes)?;
            let query_bytes = read_bounded(
                Path::new(option(&options, "--queries")?), MAX_PLAN_BYTES
            )?;
            let queries: InspectBatchInput = serde_json::from_slice(&query_bytes)
                .map_err(|_| fail("INSPECT_BATCH_INVALID"))?;
            let results = inspect_batch(session.document(), queries.requests)?;
            let response = json!({
                "status":"OK","sha256":actual_sha,
                "summary":session.summary(),"results":results
            });
            if serde_json::to_vec(&response)
                .map_err(|_| fail("INSPECT_BATCH_SERIALIZE_FAILED"))?.len()
                > MAX_INSPECT_BATCH_RESULT_BYTES {
                return Err(fail("INSPECT_BATCH_RESULT_TOO_LARGE"));
            }
            Ok(response)
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
            let receipt = session.apply_with_correction_scope(
                plan.expected_revision, &plan.operations,
                plan.correction_scope.as_ref(),
            )?;
            let out = session.export()?;
            // Another writer may have changed the source while the batch ran.
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != actual_sha {
                return Err(fail("SOURCE_CHANGED_DURING_APPLY"));
            }
            publish_new(&output, &out, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK","source_sha256":actual_sha,"output_sha256":sha256(&out),
                "summary":session.summary(),"mutation":receipt,
                "correction_scope":plan.correction_scope.as_ref().map(|scope|json!({
                    "status":"enforced","texture_uuid":scope.texture_uuid,
                    "visual_verdict":"UNVERIFIED"
                }))
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
        "export-animation" => {
            option_set(&options, &["--input", "--output", "--expected-sha256"])?;
            let input = PathBuf::from(option(&options, "--input")?);
            let output = PathBuf::from(option(&options, "--output")?);
            animation_json(&output)?;
            same_directory(&input, &output)?;
            let (original, source_sha) = read_verified_source(
                &input, option(&options, "--expected-sha256")?
            )?;
            let session = EditorSession::open(&original)?;
            let bytes = export_bedrock_animations(session.document())?;
            if sha256(&read_bounded(&input, MAX_MODEL_BYTES)?) != source_sha {
                return Err(fail("SOURCE_CHANGED_DURING_EXPORT"));
            }
            publish_new_animation(&output, &bytes, MAX_MODEL_BYTES)?;
            Ok(json!({
                "status":"OK", "source_sha256":source_sha,
                "output_sha256":sha256(&bytes), "bytes":bytes.len(),
                "format":"minecraft:animation",
                "curve_fidelity":bedrock_animation_curve_fidelity(session.document()),
                "summary":session.summary()
            }))
        }
        _ => Err(fail("UNKNOWN_COMMAND_USE_NEW_INSPECT_APPLY_IMPORT_PNG_EXPORT_PNG_EXPORT_GEOMETRY_EXPORT_ANIMATION")),
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

    // SOURCE_AUTHORED_NOT_RUN: repair earlier Sound/Particle inspection's
    // missing CLI enum/dispatch and add saved Timeline Marker read selector.
    #[test]
    fn code_mode_inspect_batch_reads_effects_and_timeline_markers_together() {
        let mut session=EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007631";
        let sound="00000000-0000-4000-8000-000000007632";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"contact".into(),length:2.0,
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:0.5,
                name:"left_foot_contact".into(),color:6,
            },
            EditOperation::AddAnimationEffectEvent {
                animation_uuid:anim.into(),keyframe_uuid:sound.into(),
                channel:"sound".into(),time:0.5,
                points:vec![lazydesigner::authoring::AnimationEffectPoint {
                    effect:"robot.step".into(),locator:None,bind_to_actor:None,
                }],
            },
        ]).unwrap();
        let doc=session.document().clone();
        let previous=doc.clone();
        let req: InspectBatchInput=serde_json::from_str(&format!(
            r#"{{"requests":[
                {{"kind":"animation_effect_events","animation_uuid":"{anim}","limit":16}},
                {{"kind":"animation_timeline_markers","animation_uuid":"{anim}","limit":1}}
            ]}}"#
        )).unwrap();
        let selected=inspect_batch(&doc,req.requests).unwrap();
        assert_eq!(selected.len(),2);
        assert_eq!(selected[0]["kind"],json!("animation_effect_events"));
        assert_eq!(selected[0]["effects"]["recognized"],json!(true));
        assert_eq!(selected[0]["effects"]["events"][0]["uuid"],json!(sound));
        assert_eq!(selected[1]["kind"],json!("animation_timeline_markers"));
        assert_eq!(selected[1]["markers"]["recognized"],json!(true));
        assert_eq!(selected[1]["markers"]["total_markers"],json!(1));
        assert_eq!(selected[1]["markers"]["markers"][0]["name"],
            json!("left_foot_contact"));
        assert_eq!(selected[1]["markers"]["playback_verdict"],json!("NOT_EXECUTED"));
        assert_eq!(doc,previous);
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"animation_timeline_markers","animation_uuid":"x","shell":"bad"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc,vec![
            InspectBatchQuery::AnimationTimelineMarkers {
                animation_uuid:anim.into(),offset:Some(0),limit:Some(33),
            }
        ]).unwrap_err(),"ANIMATION_MARKER_INSPECT_PAGE_INVALID");
        assert_eq!(doc,previous);
    }

    // SOURCE_AUTHORED_NOT_RUN: Code Mode inspects saved Sound/Particle
    // events as metadata only, with no native event playback claim.
    #[test]
    fn code_mode_batch_inspects_guarded_animation_effect_events_without_mutation() {
        let mut session=EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let animation="00000000-0000-4000-8000-000000007541";
        let sound="00000000-0000-4000-8000-000000007542";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:animation.into(),name:"step_sound".into(),length:2.0,
            },
            EditOperation::AddAnimationEffectEvent {
                animation_uuid:animation.into(),keyframe_uuid:sound.into(),
                channel:"sound".into(),time:1.0,
                points:vec![lazydesigner::authoring::AnimationEffectPoint {
                    effect:"robot.step".into(),locator:None,bind_to_actor:None,
                }],
            },
        ]).unwrap();
        let doc=session.document().clone();
        let source=doc.clone();
        let requests: InspectBatchInput=serde_json::from_str(&format!(
            r#"{{"requests":[{{"kind":"animation_effect_events","animation_uuid":"{animation}","offset":0,"limit":1}}]}}"#
        )).unwrap();
        let entries=inspect_batch(&doc,requests.requests).unwrap();
        assert_eq!(entries.len(),1);
        assert_eq!(entries[0]["kind"],json!("animation_effect_events"));
        assert_eq!(entries[0]["effects"]["recognized"],json!(true));
        assert_eq!(entries[0]["effects"]["playback_verdict"],json!("NOT_EXECUTED"));
        assert_eq!(entries[0]["effects"]["events"][0]["uuid"],json!(sound));
        assert_eq!(entries[0]["effects"]["events"][0]["data_points"][0]["effect"],
            json!("robot.step"));
        assert_eq!(doc,source);
        assert!(!serde_json::to_string(&entries).unwrap().contains("data:image/png"));
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"animation_effect_events","animation_uuid":"clip","shell":"unsafe"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc,vec![InspectBatchQuery::AnimationEffectEvents {
            animation_uuid:animation.into(),offset:Some(0),limit:Some(17),
        }]).unwrap_err(),"ANIMATION_EFFECT_INSPECT_PAGE_INVALID");
        assert_eq!(doc,source);
    }

    // Regression source only; there is no filesystem publication or runtime PASS.
    #[test]
    fn code_mode_asset_handoff_reuses_three_exporters_without_raw_png_echo() {
        const TEX: &str = "00000000-0000-4000-8000-000000006801";
        let mut session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube = session.document().cubes[0].uuid.clone();
        session.apply(0,&[
            EditOperation::CreatePaintTexture {
                uuid:TEX.into(),name:"atlas.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:cube,texture_uuid:TEX.into(),
            },
        ]).unwrap();
        let doc = session.document().clone();
        let bytes = serde_json::to_vec(&json!({"requests":[
            {"kind":"asset_handoff","texture_uuid":TEX},
            {"kind":"audit"}
        ]})).unwrap();
        let plan: InspectBatchInput = serde_json::from_slice(&bytes).unwrap();
        let results = inspect_batch(&doc,plan.requests).unwrap();
        assert_eq!(results.len(),2);
        assert_eq!(results[0]["kind"],"asset_handoff");
        assert_eq!(results[0]["handoff"]["status"],"source_consistent");
        assert_eq!(results[0]["handoff"]["faces"]["selected_texture"],6);
        assert_eq!(results[0]["handoff"]["animation"]["status"],"not_required");
        assert_eq!(results[0]["handoff"]["geometry"]["visible_bounds_source"],"computed_static");
        assert_eq!(results[0]["handoff"]["geometry"]["visible_bounds"]["width"],json!(2.0));
        assert_eq!(results[0]["handoff"]["visual_verdict"],"UNVERIFIED");
        let mut user_visible_box = doc.clone();
        user_visible_box.extensions.insert("visible_box".into(),json!([12.0,4.0,0.0]));
        let visible = inspect_batch(&user_visible_box, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(),offset:None,limit:None,
        }]).unwrap();
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds_source"],
            "saved_visible_box_union");
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds"]["width"],json!(12.0));
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds"]["height"],json!(4.0));
        assert_eq!(doc.extensions.get("visible_box"),None);
        assert_eq!(results[1]["kind"],"audit");
        assert!(!serde_json::to_string(&results).unwrap().contains("data:image/png"));
        assert_eq!(session.document(),&doc);
        let mut damaged = doc.clone();
        damaged.cubes[0].faces.get_mut("north").unwrap()["texture"] = json!(false);
        damaged.cubes[0].faces.get_mut("east").unwrap()["texture"] = json!(false);
        let first = inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(), offset:Some(0), limit:Some(1),
        }]).unwrap();
        let second = inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(), offset:Some(1), limit:Some(1),
        }]).unwrap();
        assert_eq!(first[0]["handoff"]["total_issues"], 2);
        assert_eq!(first[0]["handoff"]["issues"][0]["cube_uuid"],
            damaged.cubes[0].uuid);
        assert_eq!(first[0]["handoff"]["issues"][0]["face"], "north");
        assert_eq!(first[0]["handoff"]["next_issue_offset"], 1);
        assert_eq!(second[0]["handoff"]["issues"][0]["face"], "east");
        assert_eq!(second[0]["handoff"]["next_issue_offset"], Value::Null);
        assert_eq!(first[0]["handoff"]["geometry"], second[0]["handoff"]["geometry"]);
        assert_eq!(first[0]["handoff"]["texture"], second[0]["handoff"]["texture"]);
        assert_eq!(damaged.cubes[0].faces["north"]["texture"], json!(false));
        // A correct atlas UUID can still point outside the physical PNG.
        // This is a saved UV issue, not a second output/publisher mutation.
        let mut bad_uv = doc.clone();
        bad_uv.cubes[0].faces.get_mut("north").unwrap()["uv"] =
            json!([-1.0,0.0,4.0,4.0]);
        let uv_report = inspect_batch(&bad_uv, vec![
            InspectBatchQuery::AssetHandoff {
                texture_uuid:TEX.into(), offset:Some(0), limit:Some(1),
            }
        ]).unwrap();
        assert_eq!(uv_report[0]["handoff"]["status"], "blocked");
        assert_eq!(uv_report[0]["handoff"]["faces"]["uv_out_of_bounds"], 1);
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["face"], "north");
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["problem"], "uv_out_of_bounds");
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["uv_source"], "saved_manual");
        assert!(uv_report[0]["handoff"]["blockers"].as_array().unwrap().contains(
            &json!("UV_OUT_OF_ATLAS")));
        assert_eq!(doc.cubes[0].faces["north"]["uv"], json!([0,0,4,4]));
        for (offset, limit) in [(0, 0), (0, 33), (393_217, 1)] {
            assert_eq!(inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
                texture_uuid:TEX.into(), offset:Some(offset), limit:Some(limit),
            }]).unwrap_err(), "ASSET_HANDOFF_PAGE_INVALID");
        }
        assert!(serde_json::from_value::<InspectBatchInput>(json!({"requests":[
            {"kind":"asset_handoff","texture_uuid":TEX,"path":"/not/allowed"}
        ]})).is_err());
        assert!(serde_json::from_value::<InspectBatchInput>(json!({"requests":[
            {"kind":"asset_handoff"}
        ]})).is_err());
    }

    // Source-authored CLI/Rust proof only; Cargo/native execution is held.
    #[test]
    fn code_mode_inspect_batch_projects_multiple_reads_from_one_immutable_document() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let before = doc.clone();
        let uuid = doc.cubes[0].uuid.clone();
        let json = format!(r#"{{"requests":[
            {{"kind":"catalog","category":"cubes","limit":1}},
            {{"kind":"cube","uuid":"{uuid}"}},
            {{"kind":"cube_surfaces","uuid":"{uuid}"}},
            {{"kind":"audit"}}
        ]}}"#);
        let plan: InspectBatchInput = serde_json::from_str(&json).unwrap();
        let entries = inspect_batch(&doc, plan.requests).unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0]["kind"], json!("catalog"));
        assert_eq!(entries[0]["catalog"]["total"], json!(1));
        assert_eq!(entries[1]["kind"], json!("cube"));
        assert_eq!(entries[1]["element"]["uuid"], json!(uuid));
        assert_eq!(entries[2]["surfaces"]["faces"].as_array().unwrap().len(), 6);
        assert_eq!(entries[3]["audit"]["visual_verdict"], json!("UNVERIFIED"));
        assert!(serde_json::to_string(&entries).unwrap().find("data:image/png").is_none());
        assert_eq!(doc, before);
    }

    #[test]
    fn code_mode_inspect_batch_rejects_unknown_and_oversized_shapes() {
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"unknown"}]}"#
        ).is_err());
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"audit","untrusted":"data"}]}"#
        ).is_err());
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"cube","uuid":"a","invalid":true}]}"#
        ).is_err());
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let empty = inspect_batch(&doc, Vec::new()).unwrap_err();
        assert_eq!(empty, "INSPECT_BATCH_SIZE_INVALID");
        let too_many = std::iter::repeat_with(|| InspectBatchQuery::Audit)
            .take(9).collect();
        assert_eq!(inspect_batch(&doc, too_many).unwrap_err(),
            "INSPECT_BATCH_SIZE_INVALID");
        let one = vec![InspectBatchQuery::Catalog {
            category: "cubes".into(), offset: None, limit: Some(65),
        }];
        assert_eq!(inspect_batch(&doc, one).unwrap_err(),
            "INSPECT_BATCH_PAGE_INVALID");
    }

    // Rust/CLI source regression only. Coverage pages are bounded and
    // returned through the existing one-document batch parser.
    #[test]
    fn code_mode_batch_model_texture_coverage_is_read_only_and_paged() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let original = doc.clone();
        let input: InspectBatchInput = serde_json::from_str(
            r#"{"requests":[{"kind":"model_texture_coverage","offset":0,"limit":1}]}"#
        ).unwrap();
        let inspected = inspect_batch(&doc, input.requests).unwrap();
        assert_eq!(inspected[0]["kind"], json!("model_texture_coverage"));
        assert_eq!(inspected[0]["coverage"]["scope"],
            json!("saved_face_texture_coverage_page"));
        assert_eq!(inspected[0]["coverage"]["reviewed_cubes"], json!(1));
        assert_eq!(inspected[0]["coverage"]["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(inspected[0]["coverage"]["attention_only"], json!(false));
        assert_eq!(doc, original);
        let mut mixed = doc.clone();
        mixed.cubes[0].faces["north"]["texture"] = Value::Null;
        let focused: InspectBatchInput = serde_json::from_str(
            r#"{"requests":[{"kind":"model_texture_coverage","offset":0,"limit":1,"attention_only":true}]}"#
        ).unwrap();
        let compact = inspect_batch(&mixed, focused.requests).unwrap();
        let item = &compact[0]["coverage"];
        assert_eq!(item["attention_only"], json!(true));
        assert_eq!(item["reviewed_cubes"], json!(1));
        assert_eq!(item["returned_cubes"], json!(1));
        assert_eq!(item["returned_faces"], json!(5));
        assert_eq!(item["review_candidates"], json!(5));
        assert_eq!(item["cubes"][0]["faces"].as_array().unwrap().len(), 5);
        assert_eq!(item["cubes"][0]["faces"][0]["side"], json!("east"));
        assert_eq!(item["next_offset"], Value::Null);
        assert_eq!(mixed.cubes[0].faces["north"]["texture"], Value::Null);
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"model_texture_coverage","attention_only":"yes"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc, vec![
            InspectBatchQuery::ModelTextureCoverage {
                offset: Some(0), limit: Some(9), attention_only: None
            }
        ]).unwrap_err(), "TEXTURE_COVERAGE_PAGE_INVALID");
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"model_texture_coverage","uuid":"untrusted"}]}"#
        ).is_err());
    }

    // Rust/CLI regression source only; no Cargo or native execution claimed.
    #[test]
    fn code_mode_face_uv_alpha_is_exact_on_manual_boundaries_and_refuses_ambiguous_uv() {
        let mut session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let uuid = "00000000-0000-4000-8000-000000000899";
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid:uuid.into(), name:"face.png".into()
        }]).unwrap();
        session.apply(1, &[
            EditOperation::PaintTexturePixel {
                texture_index:0, x:0, y:0, rgba:[20,20,20,255]
            },
            EditOperation::PaintTexturePixel {
                texture_index:0, x:1, y:0, rgba:[20,20,20,128]
            }
        ]).unwrap();
        let mut doc = session.document().clone();
        let cube_id = doc.cubes[0].uuid.clone();
        doc.cubes[0].faces["north"]["texture"] = json!(0);
        doc.cubes[0].faces["east"]["texture"] = json!(uuid);
        doc.cubes[0].faces["south"]["texture"] = json!(false);
        doc.cubes[0].faces["west"]["texture"] = Value::Null;
        let original = doc.clone();
        let report = inspect_cube_uv_alpha(&doc, &cube_id).unwrap();
        assert_eq!(report["scope"], json!("saved_manual_face_uv_alpha"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["face_count"], json!(6));
        assert_eq!(report["faces"][0]["alpha"]["status"], json!("measured"));
        assert_eq!(report["faces"][0]["alpha"]["region"]["sampled_pixels"], json!(16));
        assert_eq!(report["faces"][0]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["translucent_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(14));
        assert_eq!(report["faces"][1]["saved_reference_kind"], json!("uuid"));
        assert_eq!(report["faces"][1]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][2]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert_eq!(report["faces"][3]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert_eq!(report["faces"][4]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert!(report.to_string().find("data:image/png").is_none());
        assert_eq!(doc, original);

        doc.cubes[0].faces["north"]["uv"] = json!([4.0,4.0,0.0,0.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(14));
        doc.cubes[0].faces["north"]["uv"] = json!([0.0,0.0,0.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_ZERO_AREA"));
        doc.cubes[0].faces["north"]["uv"] = json!([0.5,0.0,4.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_NON_INTEGRAL"));
        doc.cubes[0].faces["north"]["uv"] = json!([0.0,0.0,400.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_OUT_OF_BOUNDS"));

        doc = original.clone();
        doc.meta.box_uv = Some(true);
        let box_report = inspect_cube_uv_alpha(&doc, &cube_id).unwrap();
        assert_eq!(box_report["scope"], json!("derived_box_face_uv_alpha"));
        assert_eq!(box_report["faces"][0]["uv_source"], json!("derived_box"));
        assert_eq!(box_report["faces"][0]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
        assert_eq!(box_report["faces"][0]["saved_uv"], json!([0.0, 0.0, 4.0, 4.0]));
        assert_eq!(box_report["faces"][0]["alpha"]["region"]["scope"],
            json!("derived_box_uv_alpha_pixels"));
        assert_eq!(box_report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(16));
        doc.meta.extra.insert("box_uv_float_size".into(), json!(true));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("BOX_UV_RULES_UNSUPPORTED"));
        doc.meta.extra.remove("box_uv_float_size");
        doc.cubes[0].extra.insert("mirror_uv".into(), json!("not-bool"));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("BOX_UV_RULES_UNSUPPORTED"));
        doc = original.clone();
        doc.cubes[0].extra.insert("autouv".into(), json!(1));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("AUTO_UV_UNSUPPORTED"));
        doc = original.clone();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"],
            json!("PER_TEXTURE_UV_RULES_UNSUPPORTED"));

        doc = original.clone();
        doc.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
        assert!(inspect_cube_uv_alpha(&doc, &cube_id).is_err());
        assert_eq!(inspect_cube_uv_alpha(&original, "nonexistent-cube").unwrap_err(),
            "CUBE_NOT_FOUND");
    }

    // Source-authored only. The normal new Bedrock model uses Box UV.
    // An alpha measurement here says nothing about 3D face visibility.
    #[test]
    fn box_uv_alpha_uses_derived_face_net_and_preserves_imported_source() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Box alpha", "box_alpha").unwrap()
        ).unwrap();
        let bone: lazydesigner::authoring::Bone = serde_json::from_value(json!({
            "uuid":"00000000-0000-4000-8000-000000000801",
            "name":"root", "origin":[0,0,0]
        })).unwrap();
        let mut cube: lazydesigner::authoring::Cube = serde_json::from_value(
            serde_json::from_slice::<Value>(include_bytes!("../../fixtures/bedrock-basic.bbmodel"))
            .unwrap()["elements"][0].clone()).unwrap();
        cube.uuid = "00000000-0000-4000-8000-000000000802".into();
        let id = "00000000-0000-4000-8000-000000000803";
        session.apply(0, &[
            EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
            EditOperation::AddBone { bone, parent_uuid: None },
            EditOperation::AddCube {
                cube, bone_uuid: "00000000-0000-4000-8000-000000000801".into()
            },
            EditOperation::CreatePaintTexture { uuid:id.into(), name:"box.png".into() },
            EditOperation::AssignCubeTexture {
                cube_uuid:"00000000-0000-4000-8000-000000000802".into(),
                texture_uuid:id.into(),
            },
            EditOperation::PaintTexturePixel {
                texture_index:0, x:4, y:4, rgba:[10,20,30,255]
            },
        ]).unwrap();
        let original = session.document().clone();
        let report = inspect_cube_uv_alpha(&original,
            "00000000-0000-4000-8000-000000000802").unwrap();
        assert_eq!(report["scope"], json!("derived_box_face_uv_alpha"));
        assert_eq!(report["faces"][0]["side"], json!("north"));
        assert_eq!(report["faces"][0]["uv"], json!([4.0,4.0,8.0,8.0]));
        assert_eq!(report["faces"][0]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(15));
        assert_eq!(report["faces"][1]["side"], json!("east"));
        assert_eq!(report["faces"][1]["alpha"]["region"]["opaque_pixels"], json!(0));
        assert_eq!(report["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(session.document(), &original);
        let reimported = EditorSession::open(&session.export().unwrap()).unwrap();
        assert_eq!(reimported.document(), &original);
        assert!(report.to_string().find("data:image/png").is_none());
    }

    // Authored-only verification: decode behavior/native runtime NOT_EXECUTED.
    #[test]
    fn code_mode_alpha_inspection_reuses_the_rust_png_codec_without_mutation() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Alpha test", "alpha_test").unwrap()
        ).unwrap();
        let id = "00000000-0000-4000-8000-000000000811";
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: id.into(), name: "alpha.png".into()
        }]).unwrap();
        let saved = session.document().clone();
        let total = u64::from(saved.resolution.width) * u64::from(saved.resolution.height);
        let initial = inspect_paint_alpha(session.document(), id).unwrap();
        assert_eq!(initial["kind"], json!("texture_alpha"));
        assert_eq!(initial["texture_uuid"], json!(id));
        assert_eq!(initial["inspection"]["supported"], json!(true));
        assert_eq!(initial["inspection"]["transparent_pixels"], json!(total));
        assert_eq!(initial["inspection"]["opaque_pixels"], json!(0));
        assert_eq!(initial["inspection"]["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(initial["inspection"]["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(initial["inspection"]["tile_samples"].as_array().unwrap().len(), 8);
        assert!(initial.to_string().find("data:image/png").is_none());
        assert_eq!(session.document(), &saved);

        session.apply(1, &[
            EditOperation::PaintTexturePixel { texture_index:0, x:0, y:0, rgba:[10,20,30,255] },
            EditOperation::PaintTexturePixel { texture_index:0, x:1, y:0, rgba:[10,20,30,128] },
        ]).unwrap();
        let changed = inspect_paint_alpha(session.document(), id).unwrap();
        assert_eq!(changed["inspection"]["opaque_pixels"], json!(1));
        assert_eq!(changed["inspection"]["translucent_pixels"], json!(1));
        assert_eq!(changed["inspection"]["transparent_pixels"], json!(total - 2));
        assert_eq!(changed["inspection"]["tile_nonzero_alpha"][0][0], json!(2));

        let mut corrupt = session.document().clone();
        corrupt.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
        assert!(inspect_paint_alpha(&corrupt, id).is_err());

        let mut multi_file = session.document().clone();
        multi_file.extensions.insert("multi_file_ruleset".into(),
            json!("bedrock_attachable"));
        let multi_file_report = inspect_paint_alpha(&multi_file, id).unwrap();
        assert_eq!(multi_file_report["inspection"]["supported"], json!(false));
        assert_eq!(multi_file_report["inspection"]["reason"],
            json!("PER_TEXTURE_UV_RULES_UNSUPPORTED"));

        let imported = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let preserved = imported.clone();
        let unsupported = inspect_paint_alpha(
            &imported, "00000000-0000-4000-8000-000000000101").unwrap();
        assert_eq!(unsupported["inspection"]["supported"], json!(false));
        assert_eq!(unsupported["inspection"]["reason"],
            json!("UNSUPPORTED_FORMAT_OR_METADATA"));
        assert_eq!(preserved, imported);
        assert_eq!(inspect_paint_alpha(&imported, "missing").unwrap_err(),
            "PAINT_TEXTURE_NOT_FOUND");
    }

    // Source-authored only: no Cargo, native app or model visual QA executed.
    #[test]
    fn code_mode_cube_surfaces_are_bounded_read_only_and_do_not_claim_visual_coverage() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let uuid = doc.cubes[0].uuid.clone();
        let before = doc.clone();
        let report = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(report["scope"], json!("saved_geometry_and_face_references"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["effective_material"], json!("UNVERIFIED"));
        assert_eq!(report["geometry"]["size"], json!([4.0, 4.0, 4.0]));
        assert_eq!(report["faces"].as_array().unwrap().len(), 6);
        assert_eq!(report["faces"][0]["side"], json!("north"));
        assert_eq!(report["faces"][0]["reference_kind"], json!("index"));
        assert_eq!(report["faces"][0]["texture_index"], json!(0));
        assert_eq!(report["faces"][0]["texture_uuid"],
            json!("00000000-0000-4000-8000-000000000101"));
        assert_eq!(report["faces"][0]["source_kind"], json!("embedded_png_declared"));
        assert_eq!(report["faces"][0]["uv_rotation"], json!(90));
        assert_eq!(report["faces"][2]["reference_kind"], json!("null"));
        assert!(report.to_string().find("data:image/png").is_none());
        assert!(report.to_string().find("vendor_extension").is_none());
        assert_eq!(doc, before);

        let texture_id = doc.texture_assets[0]["uuid"].as_str().unwrap().to_owned();
        doc.cubes[0].faces["east"]["texture"] = json!(texture_id);
        let linked = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(linked["faces"][1]["reference_kind"], json!("uuid"));
        assert_eq!(linked["faces"][1]["texture_index"], json!(0));
        doc.cubes[0].faces["east"]["texture"] = json!(false);
        let inherited = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(inherited["faces"][1]["reference_kind"], json!("false"));
        doc.cubes[0].faces.get_mut("east").unwrap()
            .as_object_mut().unwrap().remove("texture");
        let unset = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(unset["faces"][1]["reference_kind"], json!("unset"));
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        let scoped = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(scoped["uv"]["per_texture_rules"], json!(true));
        assert_eq!(scoped["effective_material"], json!("UNVERIFIED"));
        assert_eq!(inspect_cube_surfaces(&doc, "missing-cube").unwrap_err(),
            "CUBE_NOT_FOUND");
    }

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

    // Source regression only: Rust executable, CLI and native app not run.
    #[test]
    fn code_mode_transform_track_read_covers_position_rotation_scale_and_refuses_opaque() {
        let mut session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = session.document().bones[0].uuid.clone();
        let anim = "00000000-0000-4000-8000-000000000711";
        session.apply(0, &[
            EditOperation::CreateAnimation { uuid: anim.into(), name: "walk".into(), length: 2.0 },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000712".into(),
                channel: "position".into(), time: 0.5, value: [1.0, 2.0, 3.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000713".into(),
                channel: "scale".into(), time: 1.0, value: [1.0, 2.0, 1.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000714".into(),
                channel: "rotation".into(), time: 1.5, value: [0.0, 30.0, 0.0],
            },
        ]).unwrap();
        let before = session.document().clone();
        for (channel, time, values) in [
            ("position", 0.5, [1.0, 2.0, 3.0]),
            ("scale", 1.0, [1.0, 2.0, 1.0]),
            ("rotation", 1.5, [0.0, 30.0, 0.0]),
        ] {
            let track = inspect_transform_track(session.document(), anim, &bone,
                channel, 0, 16).unwrap();
            assert_eq!(track["recognized"], json!(true));
            assert_eq!(track["channel"], json!(channel));
            assert_eq!(track["total_frames"], json!(1));
            assert_eq!(track["keyframes"][0]["time"], json!(time));
            assert_eq!(track["keyframes"][0]["value"], json!(values));
            assert_eq!(track["visual_verdict"], json!("UNVERIFIED"));
        }
        assert_eq!(session.document(), &before);
        assert_eq!(inspect_transform_track(session.document(), anim, &bone,
            "bad", 0, 16).unwrap_err(), "ANIMATION_INSPECT_CHANNEL_INVALID");
        assert_eq!(inspect_transform_track(session.document(), anim, &bone,
            "position", 0, 65).unwrap_err(), "ANIMATION_INSPECT_PAGE_INVALID");
        let mut opaque = before.clone();
        opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"] =
            json!("query.anim_time");
        let refused = inspect_transform_track(&opaque, anim, &bone,
            "scale", 0, 16).unwrap();
        assert_eq!(refused["recognized"], json!(false));
        assert!(refused["keyframes"].as_array().unwrap().is_empty());
        assert_eq!(opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"],
            json!("query.anim_time"));
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
