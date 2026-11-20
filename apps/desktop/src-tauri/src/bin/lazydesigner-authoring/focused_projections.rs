//! Read-only focused saved-model projections. No mutations or publisher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

/// Bounded, read-only Code Mode projection. Opaque model data is never echoed.
pub(super) fn parent_for(nodes: &[OutlinerNode], target: &str, parent: Option<&str>) -> Option<Option<String>> {
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

pub(super) fn focused_element(doc: &AuthoringDocument, uuid: &str) -> Result<Value> {
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
pub(super) fn short_name(value: Option<&str>) -> Option<String> {
    value.map(|name| name.chars().take(160).collect())
}

pub(super) fn inspect_catalog(doc: &AuthoringDocument, kind: &str, offset: usize, limit: usize) -> Result<Value> {
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

pub(super) fn inspect_asset(doc: &AuthoringDocument, kind: &str, key: &str) -> Result<Value> {
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
pub(super) fn inspect_model_audit(doc: &AuthoringDocument) -> Value {
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

/// One task-oriented read from the already SHA-pinned model. Resolve a
/// named part and its relevant source evidence before selecting an operation.
/// Substring suggestions are NEVER selected as targets or write authority.
pub(super) fn inspect_authoring_target(
    doc: &AuthoringDocument, domain: &str, category: &str, name: &str,
) -> Result<Value> {
    inspect_authoring_target_with_view(doc, None, domain, category, name)
}

pub(super) fn inspect_authoring_target_with_view(
    doc: &AuthoringDocument, validated: Option<&ValidatedInspection<'_>>,
    domain: &str, category: &str, name: &str,
) -> Result<Value> {
    if name.is_empty() || name.trim() != name || name.chars().count() > 128 ||
       name.chars().any(char::is_control) {
        return Err(fail("AUTHORING_TARGET_NAME_INVALID"));
    }
    let possible_ops: &[&str] = match (domain, category) {
        ("geometry", "cubes") =>
            &["translate_cube", "reframe_cube", "set_cube_rotation", "set_cube_origin"],
        ("geometry", "bones") =>
            &["translate_bone_subtree", "set_bone_origin", "set_bone_rotation"],
        ("uv", "cubes") =>
            &["set_face_uv", "set_box_uv_offset", "isolate_cube_box_uv"],
        ("texturing", "cubes") =>
            &["paint_cube_face_regions_guarded", "paint_cube_uv_faces_guarded",
              "recolor_cube_faces_palette_guarded"],
        ("texturing", "textures") =>
            &["paint_texture_rectangles", "paint_texture_fill"],
        ("animation", "bones") =>
            &["add_bone_transform_keyframe", "update_bone_transform_keyframe"],
        ("animation", "animations") =>
            &["set_animation_length", "set_animation_loop_mode",
              "scale_animation_timeline", "duplicate_animation_clip"],
        _ => return Err(fail("AUTHORING_TARGET_DOMAIN_MISMATCH")),
    };

    let mut exact = Vec::<Value>::new();
    let mut suggestions = Vec::<Value>::new();
    let mut exact_count = 0usize;
    let mut suggestion_count = 0usize;
    let needle = name.to_lowercase();
    let mut inspect = |index: usize, uuid: Option<&str>, title: Option<&str>| {
        let Some(title) = title else { return; };
        if title == name {
            exact_count += 1;
            if exact.len() < 8 {
                exact.push(json!({"index":index, "uuid":uuid, "name":title}));
            }
        } else if title.to_lowercase().contains(&needle) {
            suggestion_count += 1;
            if suggestions.len() < 8 {
                suggestions.push(json!({"index":index, "uuid":uuid, "name":title}));
            }
        }
    };
    match category {
        "cubes" => for (i, cube) in doc.cubes.iter().enumerate() {
            inspect(i, Some(&cube.uuid), cube.name.as_deref());
        },
        "bones" => for (i, bone) in doc.bones.iter().enumerate() {
            inspect(i, Some(&bone.uuid), Some(&bone.name));
        },
        "textures" => for (i, texture) in doc.texture_assets.iter().enumerate() {
            inspect(i, texture.get("uuid").and_then(Value::as_str),
                    texture.get("name").and_then(Value::as_str));
        },
        "animations" => for (i, clip) in doc.animation_assets.iter().enumerate() {
            inspect(i, clip.get("uuid").and_then(Value::as_str),
                    clip.get("name").and_then(Value::as_str));
        },
        _ => unreachable!(), // Restricted by the domain/category match.
    }
    let selected = if exact_count == 1 {
        let candidate = &exact[0];
        let uuid = candidate.get("uuid").and_then(Value::as_str);
        if let Some(uuid) = uuid {
            let source = match category {
                "cubes" => {
                    let element = focused_element(doc, uuid)?;
                    let surfaces = if domain == "uv" || domain == "texturing" {
                        Some(match validated {
                            Some(view) => view.cube_surfaces(uuid)?,
                            None => inspect_cube_surfaces(doc, uuid)?,
                        })
                    } else { None };
                    json!({"element":element, "surfaces":surfaces})
                },
                "bones" => json!({"element":focused_element(doc, uuid)?}),
                "textures" => json!({"asset":inspect_asset(doc, "texture",
                    &candidate["index"].as_u64().unwrap().to_string())?}),
                "animations" => json!({"asset":inspect_asset(doc, "animation", uuid)?}),
                _ => unreachable!(),
            };
            Some(json!({"identity":candidate, "source":source}))
        } else { None }
    } else { None };
    let status = if selected.is_some() { "EXACT_MATCH" }
        else if exact_count > 1 { "AMBIGUOUS_NAME" }
        else if exact_count == 1 { "IDENTITY_MISSING" }
        else { "NO_EXACT_MATCH" };
    // Candidate operations must reflect real source constraints, not just
    // a name/category match. The canonical Rust mutation still rechecks all
    // affected permissions, UV, texture and transaction invariants.
    let mut suggested_operations: Vec<&str> =
        if status == "EXACT_MATCH" { possible_ops.to_vec() } else { Vec::new() };
    let mut source_blockers: Vec<&str> = Vec::new();
    if let Some(target) = selected.as_ref() {
        if category == "cubes" && (domain == "uv" || domain == "texturing") {
            let surfaces = &target["source"]["surfaces"];
            let uv = &surfaces["uv"];
            if uv["per_texture_rules"] != Value::Bool(false) {
                suggested_operations.clear();
                source_blockers.push("PER_TEXTURE_UV_RULES_UNSUPPORTED");
            } else if domain == "uv" {
                if uv["box_uv"] == Value::Bool(true) {
                    suggested_operations = vec!["set_box_uv_offset"];
                    let linked = surfaces["faces"].as_array().is_some_and(|faces|
                        faces.iter().any(|face| face["reference_kind"] == "uuid" ||
                            face["reference_kind"] == "index"));
                    if linked { suggested_operations.push("isolate_cube_box_uv"); }
                } else if uv["auto_uv"].as_u64() == Some(0) {
                    suggested_operations = vec!["set_face_uv"];
                } else {
                    suggested_operations.clear();
                    source_blockers.push("MANUAL_UV_EDIT_UNSUPPORTED_FOR_AUTO_MODE");
                }
            } else {
                let linked = surfaces["faces"].as_array().is_some_and(|faces|
                    faces.iter().any(|face| face["reference_kind"] == "uuid" ||
                        face["reference_kind"] == "index"));
                if !linked {
                    suggested_operations.clear();
                    source_blockers.push("EXPLICIT_SAVED_FACE_TEXTURE_REQUIRED");
                } else {
                    // A declared Cube texture link does not mean the target
                    // PNG is admitted by Rust Paint. Inspect the actual linked
                    // texture owners, not only the Face reference kind.
                    let editable_link = surfaces["faces"].as_array().is_some_and(|faces|
                        faces.iter().any(|face| {
                            let explicit = face["reference_kind"] == "uuid" ||
                                face["reference_kind"] == "index";
                            explicit && face["texture_index"].as_u64()
                                .and_then(|value| usize::try_from(value).ok())
                                .and_then(|index| doc.texture_assets.get(index))
                                .is_some_and(paint_texture_editable)
                        }));
                    if !editable_link {
                        suggested_operations.clear();
                        source_blockers.push("LINKED_TEXTURE_NOT_RUST_PAINT_EDITABLE");
                    }
                }
            }
        } else if category == "textures" && domain == "texturing" {
            let index = target["identity"]["index"].as_u64()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or_else(|| fail("AUTHORING_TARGET_IDENTITY_INVALID"))?;
            let texture = doc.texture_assets.get(index)
                .ok_or_else(|| fail("AUTHORING_TARGET_IDENTITY_INVALID"))?;
            if !paint_texture_editable(texture) {
                suggested_operations.clear();
                source_blockers.push("TEXTURE_NOT_ENABLED_FOR_RUST_PAINT");
            }
        }
    }
    let matched_count = if exact_count > 0 { exact_count } else { suggestion_count };
    let candidates = if exact_count > 0 { exact } else { suggestions };
    Ok(json!({
        "scope":"saved_model_named_target_orientation",
        "domain":domain, "category":category, "requested_name":name,
        "status":status, "candidate_count":matched_count,
        "candidates_truncated":matched_count > candidates.len(),
        "candidates":candidates, "selected":selected,
        "candidate_operations":suggested_operations,
        "source_blockers":source_blockers,
        "write_authority":"NOT_GRANTED", "visual_verdict":"UNVERIFIED",
        "next":if status == "EXACT_MATCH" {
            "Use the selected source identity and the relevant operation contract; apply one bounded Rust transaction only after authorization."
        } else {
            "Select an exact, unambiguous saved part identity; never mutate a substring suggestion."
        },
    }))
}
