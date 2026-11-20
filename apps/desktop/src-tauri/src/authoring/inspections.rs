//! Source-bound, read-only Geometry, Animation and Paint inspection facade.
//! Canonical AuthoringDocument, EditorSession and EditPlan remain in mod.rs.
//! The ephemeral ValidatedInspection lifetime is still tied to one session.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

/// Describe saved Cube geometry and six Face UV/texture links for Code Mode.
/// This is a bounded *source* diagnostic, not an evaluation of pixels, paint
/// coverage, current Blockbench material selection or visual correctness.
/// In particular Bedrock single-texture/multi-file rules can supersede stored
/// references; do not pretend a declared texture ID is the rendered material.
pub fn inspect_cube_surfaces(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    doc.validate()?;
    inspect_cube_surfaces_validated_uuid(doc, cube_uuid)
}

/// Internal fast path for an already-validated EditorSession. Standalone
/// callers must go through inspect_cube_surfaces() and its full validation.
fn inspect_cube_surfaces_validated_uuid(
    doc: &AuthoringDocument, cube_uuid: &str,
) -> Result<Value> {
    let cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
    let texture_indices = indexed_texture_uuids(doc);
    inspect_cube_surfaces_validated(doc, cube, &texture_indices)
}

/// A single document-scoped UUID lookup table for standalone or paged reads.
/// Duplicate UUIDs are already rejected by doc.validate() at the call boundary.
pub(super) fn indexed_texture_uuids(doc: &AuthoringDocument) -> HashMap<&str, usize> {
    doc.texture_assets.iter().enumerate().filter_map(|(index, texture)|
        texture.get("uuid").and_then(Value::as_str).map(|uuid| (uuid, index)))
        .collect()
}

/// Internal, prevalidated projection for six-face batch consumers. The
/// public entry above remains a full standalone validation boundary.
/// Only pass a Cube borrowed from this already validated document.
fn inspect_cube_surfaces_validated(
    doc: &AuthoringDocument, cube: &Cube,
    texture_indices: &HashMap<&str, usize>,
) -> Result<Value> {
    let per_texture_uv_rules = has_per_texture_uv_rules(doc);
    let mut faces = Vec::with_capacity(FACE_NAMES.len());
    for name in FACE_NAMES {
        let face = cube.faces.get(name).and_then(Value::as_object)
            .ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
        let rect: [f64; 4] = serde_json::from_value(
            face.get("uv").cloned().ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))?
        ).map_err(|_| fail("CUBE_FACE_UV_INVALID"))?;
        let (reference_kind, texture_index) = match face.get("texture") {
            None => ("unset", None),
            Some(Value::Null) => ("null", None),
            Some(Value::Bool(false)) => ("false", None),
            Some(Value::Number(number)) => {
                let index = number.as_u64()
                    .and_then(|value| usize::try_from(value).ok())
                    .ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                if index >= doc.texture_assets.len() {
                    return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED"));
                }
                ("index", Some(index))
            },
            Some(Value::String(id)) => {
                let index = texture_indices.get(id.as_str()).copied()
                    .ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                ("uuid", Some(index))
            },
            _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
        };
        let texture = texture_index.and_then(|index| doc.texture_assets.get(index));
        let source_kind = texture.map(|texture| {
            if texture.get("source").and_then(Value::as_str)
                .is_some_and(|source| source.starts_with("data:image/png;base64,")) {
                "embedded_png_declared"
            } else if texture.get("relative_path").and_then(Value::as_str).is_some() {
                "relative_path_declared"
            } else {
                "other_or_unknown"
            }
        });
        let rotation = match face.get("rotation") {
            None => Some(0_u16),
            Some(value) => value.as_f64()
                .filter(|value| [0.0, 90.0, 180.0, 270.0].contains(value))
                .map(|value| value as u16),
        };
        faces.push(json!({
            "side":name,
            "uv":rect,
            "uv_rotation":rotation,
            "uv_rotation_supported":rotation.is_some(),
            "uv_zero_span":rect[0] == rect[2] || rect[1] == rect[3],
            "reference_kind":reference_kind,
            "texture_index":texture_index,
            "texture_uuid":texture.and_then(|t| t.get("uuid")).and_then(Value::as_str),
            "source_kind":source_kind,
        }));
    }
    let size: [f64; 3] = std::array::from_fn(|axis| cube.to[axis] - cube.from[axis]);
    let result = json!({
        "scope":"saved_geometry_and_face_references",
        "cube_uuid":cube.uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "geometry":{
            "from":cube.from, "to":cube.to, "size":size,
            "origin":cube.origin,
            "rotation":cube.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok()),
            "inflate":cube.extra.get("inflate").and_then(Value::as_f64),
            "stretch":cube.extra.get("stretch"),
            "projected_local_size":{
                // Only a local, unrotated Cube surface envelope. A null
                // result is an unsupported projection, not a quality PASS.
                let inflate = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
                let stretch = cube.extra.get("stretch").and_then(|value|
                    serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                    .unwrap_or([1.0; 3]);
                let projected: [f64; 3] = std::array::from_fn(|axis|
                    (size[axis] + 2.0 * inflate) * stretch[axis]);
                if projected.iter().all(|value| value.is_finite() && *value > 0.0) {
                    Some(projected)
                } else { None }
            },
            "visibility_saved":cube.extra.get("visibility").and_then(Value::as_bool),
        },
        "uv":{
            "project_resolution":[doc.resolution.width, doc.resolution.height],
            "box_uv":cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false)),
            "auto_uv":cube_auto_uv(cube)?,
            "per_texture_rules":per_texture_uv_rules
        },
        "faces":faces
    });
    if serde_json::to_vec(&result)
        .map_err(|_| fail("CUBE_INSPECT_SERIALIZE_FAILED"))?.len() > 16 * 1024 {
        return Err(fail("CUBE_INSPECT_TOO_LARGE"));
    }
    Ok(result)
}

/// Read-only Code Mode projection for one exact Bone rotation track.
/// Shares the existing Rust editable-frame admission instead of interpreting
/// imported Molang expressions, unknown channels or extended keyframe shapes.
/// "recognized" identifies only this bounded data representation: it is not
/// proof of native animation playback, visual fidelity or mutation permission.
pub fn inspect_rotation_track(
    doc: &AuthoringDocument,
    animation_uuid: &str,
    bone_uuid: &str,
    offset: usize,
    limit: usize,
) -> Result<Value> {
    if limit == 0 || limit > 64 || offset > MAX_ELEMENTS {
        return Err(fail("ANIMATION_INSPECT_PAGE_INVALID"));
    }
    if !doc.bones.iter().any(|bone| bone.uuid == bone_uuid) {
        return Err(fail("ANIMATION_BONE_NOT_FOUND"));
    }
    let animation = doc.animation_assets.iter()
        .find(|a| a.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
        .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
    let track = animation.get("animators").and_then(Value::as_object)
        .and_then(|items| items.get(bone_uuid))
        .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
    let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":null, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    };
    let total = frames.len();
    let duration = animation.get("length").and_then(Value::as_f64)
        .filter(|n| n.is_finite() && (0.0..=3600.0).contains(n));
    let mut times = Vec::new();
    let mut ids = HashSet::new();
    let mut recognized = editable_rotation_track(track) &&
        duration.is_some() && total <= 4096;
    if recognized {
        for frame in frames {
            let time = frame.get("time").and_then(Value::as_f64);
            let id = frame.get("uuid").and_then(Value::as_str);
            if !editable_rotation_frame(frame) ||
               !time.is_some_and(|n| n <= duration.unwrap_or(0.0)) ||
               !id.is_some_and(|value| ids.insert(value.to_owned())) {
                recognized = false;
                break;
            }
            times.push(time.unwrap_or(0.0));
        }
        if recognized {
            times.sort_by(|a, b| a.total_cmp(b));
            recognized = !times.windows(2).any(|pair| (pair[1] - pair[0]).abs() <= 1e-6);
        }
    }
    if !recognized {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":total, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    }
    let mut keyframes = Vec::new();
    let end = offset.saturating_add(limit).min(total);
    for frame in frames.iter().skip(offset).take(limit) {
        let point = &frame["data_points"][0];
        let axis = |name: &str| -> Result<f64> {
            match point.get(name) {
                Some(Value::String(value)) => value.parse::<f64>().map_err(|_| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                Some(Value::Number(value)) => value.as_f64().ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                _ => Err(fail("ANIMATION_INSPECT_AXIS_INVALID")),
            }
        };
        let mut detail = json!({
            "uuid":frame["uuid"],
            "time":frame["time"], "interpolation":frame["interpolation"],
            "rotation":[axis("x")?, axis("y")?, axis("z")?]
        });
        if let Some(handles) = bezier::parse_saved_bezier_handles(frame) {
            detail["bezier"] = json!(handles);
        }
        keyframes.push(detail);
    }
    Ok(json!({
        // Keep the legacy scope label for existing read clients; this
        // explicit field declares the now-admitted outgoing segment modes.
        "scope":"linear_bone_rotation", "interpolation_modes":["linear","step","catmullrom","bezier"],
        "recognized":true, "visual_verdict":"UNVERIFIED",
        "animation_uuid":animation_uuid, "bone_uuid":bone_uuid,
        "total_frames":total, "offset":offset,
        "next_offset":if end < total { Some(end) } else { None },
        "keyframes":keyframes
    }))
}

/// Bounded Code Mode read of an admitted numeric linear/step/Catmull-Rom Bone channel authored
/// by Rust. Unknown imported clips or expressions are never interpreted or
/// normalized, and no raw keyframe extensions are returned to the agent.
pub fn inspect_transform_track(
    doc: &AuthoringDocument, animation_uuid: &str, bone_uuid: &str,
    channel: &str, offset: usize, limit: usize,
) -> Result<Value> {
    if !supported_transform_channel(channel) {
        return Err(fail("ANIMATION_INSPECT_CHANNEL_INVALID"));
    }
    if limit == 0 || limit > 64 || offset > MAX_ELEMENTS {
        return Err(fail("ANIMATION_INSPECT_PAGE_INVALID"));
    }
    if !doc.bones.iter().any(|bone| bone.uuid == bone_uuid) {
        return Err(fail("ANIMATION_BONE_NOT_FOUND"));
    }
    let matches: Vec<_> = doc.animation_assets.iter().filter(|item|
        item.get("uuid").and_then(Value::as_str) == Some(animation_uuid)).collect();
    let animation = match matches.as_slice() {
        [] => return Err(fail("ANIMATION_NOT_FOUND")),
        [animation] => *animation,
        _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
    };
    let track = animation.get("animators").and_then(Value::as_object)
        .and_then(|tracks| tracks.get(bone_uuid))
        .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
    let Some(all_frames) = track.get("keyframes").and_then(Value::as_array) else {
        return Ok(json!({
            "scope":"unsupported_animation_track", "channel":channel,
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
            "bone_uuid":bone_uuid, "total_frames":null,
            "next_offset":null, "keyframes":[]
        }));
    };
    if !editable_transform_clip(animation, &doc.bones) {
        return Ok(json!({
            "scope":"unsupported_animation_track", "channel":channel,
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
            "bone_uuid":bone_uuid, "total_frames":null,
            "next_offset":null, "keyframes":[]
        }));
    }
    let frames: Vec<_> = all_frames.iter().filter(|frame|
        frame.get("channel").and_then(Value::as_str) == Some(channel)).collect();
    let total = frames.len();
    let end = offset.saturating_add(limit).min(total);
    let mut selected = Vec::with_capacity(end.saturating_sub(offset));
    for frame in frames.into_iter().skip(offset).take(limit) {
        let points = &frame["data_points"][0];
        let value = [
            transform_axis(points.get("x")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
            transform_axis(points.get("y")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
            transform_axis(points.get("z")).ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID"))?,
        ];
        let mut detail = json!({
            "uuid":frame["uuid"], "time":frame["time"], "value":value,
            "interpolation":frame["interpolation"],
        });
        if let Some(handles) = bezier::parse_saved_bezier_handles(frame) {
            detail["bezier"] = json!(handles);
        }
        selected.push(detail);
    }
    Ok(json!({
        // The legacy scope identifier is stable across read consumers.
        "scope":"linear_bone_transform", "recognized":true,
        "interpolation_modes":["linear","step","catmullrom","bezier"],
        "visual_verdict":"UNVERIFIED", "animation_uuid":animation_uuid,
        "bone_uuid":bone_uuid, "channel":channel,
        "loop_mode":saved_animation_loop(animation).unwrap_or("once"),
        "clip_length":animation["length"],
        "total_frames":total, "offset":offset,
        "next_offset":if end < total {Some(end)} else {None},
        "keyframes":selected
    }))
}

/// Changing atlas dimensions with authored Cubes or texture/animation data
/// would require native UV remapping. Keep this setting confined to a simple
/// empty Bedrock model with no imported opaque authoring metadata.
/// Shared admission for new generated/imported Paint assets. Never infer
/// that a project with per-texture UV rules fits the one-atlas Paint editor.
fn check_paint_texture_addition(doc: &AuthoringDocument) -> Result<()> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    if doc.texture_assets.len() >= MAX_PAINT_TEXTURES {
        return Err(fail("PAINT_TEXTURE_COUNT_LIMIT"));
    }
    if !(1..=MAX_PAINT_ATLAS_SIDE).contains(&doc.resolution.width) ||
       !(1..=MAX_PAINT_ATLAS_SIDE).contains(&doc.resolution.height) {
        return Err(fail("PAINT_DIMENSIONS_UNSUPPORTED"));
    }
    Ok(())
}

/// Read-only eligibility used by the Tauri UI. Mutations recheck this gate.
pub fn can_add_paint_texture(doc: &AuthoringDocument) -> bool {
    check_paint_texture_addition(doc).is_ok()
}

/// Metadata-only eligibility; expensive image decode happens on export.
pub fn paint_texture_exportable(doc: &AuthoringDocument, index: usize) -> bool {
    if has_per_texture_uv_rules(doc) { return false; }
    doc.texture_assets.get(index).is_some_and(|texture| {
        texture.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) &&
        paint::exportable(texture, doc.resolution.width, doc.resolution.height)
    })
}

/// Batch the three metadata-only Paint flags for one immutable Tauri
/// projection. The same Rust Paint predicates still guard actual edits and
/// exports; project-wide UV rules are checked once, never per texture.
pub fn paint_texture_snapshot_flags(
    doc: &AuthoringDocument,
) -> (Vec<bool>, Vec<bool>, Vec<bool>) {
    let mut editable = Vec::with_capacity(doc.texture_assets.len());
    let mut adoptable = Vec::with_capacity(doc.texture_assets.len());
    let mut exportable = Vec::with_capacity(doc.texture_assets.len());
    let per_texture_uv_rules = has_per_texture_uv_rules(doc);
    for texture in &doc.texture_assets {
        if per_texture_uv_rules {
            editable.push(paint::editable(texture));
            adoptable.push(false);
            exportable.push(false);
            continue;
        }
        let (owned, candidate, can_export) =
            paint::snapshot_eligibility(texture, doc.resolution.width, doc.resolution.height);
        editable.push(owned);
        adoptable.push(candidate);
        exportable.push(can_export &&
            texture.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid));
    }
    (editable, adoptable, exportable)
}

/// Read-only export of a UUID-addressed supported embedded PNG.
pub fn export_paint_png(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Vec<u8>> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    if !paint_texture_exportable(doc, index) {
        return Err(fail("PAINT_EXPORT_TEXTURE_UNSUPPORTED"));
    }
    paint::export_png(&doc.texture_assets[index], doc.resolution.width, doc.resolution.height)
}

/// Bounded, read-only Code Mode Paint inspection for one explicit Texture UUID.
/// The same Rust PNG codec used for Paint/edit/export owns pixel decoding.
/// Unknown formats and multi-file rules remain UNVERIFIED, not silently
/// interpreted or rewritten. Alpha statistics cannot prove face coverage.
pub fn inspect_paint_alpha(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Value> {
    doc.validate()?;
    inspect_paint_alpha_validated(doc, texture_uuid)
}

/// Internal immutable read from a document admitted by EditorSession. The
/// PNG decoder and unsupported-format decisions are intentionally unchanged.
fn inspect_paint_alpha_validated(
    doc: &AuthoringDocument, texture_uuid: &str,
) -> Result<Value> {
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    let texture = &doc.texture_assets[index];
    let inspection = if has_per_texture_uv_rules(doc) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"PER_TEXTURE_UV_RULES_UNSUPPORTED",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else if !paint::exportable(texture, doc.resolution.width, doc.resolution.height) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"UNSUPPORTED_FORMAT_OR_METADATA",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else {
        // A purportedly supported image must survive the full decoder.
        // Malformed/corrupt RGBA8 is an explicit error, not zero coverage.
        paint::alpha_diagnostics(texture, doc.resolution.width, doc.resolution.height)?
    };
    Ok(json!({
        "kind":"texture_alpha",
        "texture_uuid":texture_uuid,
        "texture_index":index,
        "inspection":inspection
    }))
}

/// Inspect six Cube face UV regions against the Rust Paint PNG decoder,
/// once per unique referenced texture. For Box UV, recompute the face
/// rectangles from the authoritative bounds/net offset on a *copy* rather
/// than trusting possibly stale imported face rectangles. This is alpha
/// evidence for UV pixels, never a native visual or paint-quality verdict.
/// Unsafe UV rules refuse rather than fabricating observed coverage.
pub fn inspect_cube_uv_alpha(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    let mut decoded = Vec::new();
    inspect_cube_uv_alpha_with_cache(doc, cube_uuid, &mut decoded)
}

/// Reuse decoded read-only PNGs for multiple Cubes in a single bounded page.
/// The caller discards this scratch cache after the read; edits never see stale pixels.
pub(super) fn inspect_cube_uv_alpha_with_cache(
    doc: &AuthoringDocument, cube_uuid: &str,
    decoded: &mut Vec<(usize, Vec<u8>)>,
) -> Result<Value> {
    doc.validate()?;
    let cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
    let texture_indices = indexed_texture_uuids(doc);
    inspect_cube_uv_alpha_validated(doc, cube, decoded, &texture_indices)
}

/// Share a decoded atlas only inside one validated immutable inspection
/// batch. Reuse the existing bounded PNG scratch, never authored bitmap state.
fn cached_inspection_atlas<'a>(
    doc: &AuthoringDocument, texture_index: usize,
    decoded: &'a mut Vec<(usize, Vec<u8>)>,
) -> Result<&'a [u8]> {
    if !decoded.iter().any(|(i, _)| *i == texture_index) {
        let width = doc.resolution.width;
        let height = doc.resolution.height;
        let next_rgba_bytes = (width as usize).saturating_mul(height as usize).saturating_mul(4);
        let cached_bytes: usize = decoded.iter().map(|(_, rgba)| rgba.len()).sum();
        if decoded.len() >= MAX_INSPECTION_PNG_CACHE ||
           cached_bytes.saturating_add(next_rgba_bytes) > MAX_INSPECTION_RGBA_CACHE_BYTES {
            decoded.clear();
        }
        let texture = doc.texture_assets.get(texture_index)
            .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))?;
        let png = paint::decode_for_uv_inspection(texture, width, height)?;
        decoded.push((texture_index, png));
    }
    decoded.iter().find(|(i, _)| *i == texture_index)
        .map(|(_, rgba)| rgba.as_slice())
        .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))
}

/// An immutable page validates once before iterating its own Cubes. This
/// function must receive a Cube reference from that validated document and
/// never suppress an independently requested public validation.
pub(super) fn inspect_cube_uv_alpha_validated(
    doc: &AuthoringDocument, cube: &Cube,
    decoded: &mut Vec<(usize, Vec<u8>)>,
    texture_indices: &HashMap<&str, usize>,
) -> Result<Value> {
    let surface = inspect_cube_surfaces_validated(doc, cube, texture_indices)?;
    let uv = &surface["uv"];
    let box_uv = uv["box_uv"].as_bool() == Some(true);
    // The current Box UV net uses integer dimension semantics. Imported
    // float-grid or malformed mirroring flags are not silently approximated.
    let unsafe_box_rules = [
        cube.extra.get("box_uv_float_size"),
        doc.meta.extra.get("box_uv_float_size"),
        doc.extensions.get("box_uv_float_size"),
    ].into_iter().flatten().any(|flag| flag != &Value::Bool(false)) ||
        cube.extra.get("mirror_uv").is_some_and(|v| !v.is_boolean());
    let derived_box = if box_uv && !unsafe_box_rules &&
        uv["per_texture_rules"].as_bool() != Some(true) {
        let mut copy = cube.clone();
        refresh_box_uv(&mut copy)?;
        Some(copy)
    } else {
        None
    };
    let global_reason = if uv["per_texture_rules"].as_bool() == Some(true) {
        Some("PER_TEXTURE_UV_RULES_UNSUPPORTED")
    } else if box_uv && derived_box.is_none() {
        Some("BOX_UV_RULES_UNSUPPORTED")
    } else if !box_uv && uv["auto_uv"].as_u64() != Some(0) {
        Some("AUTO_UV_UNSUPPORTED")
    } else {
        None
    };
    let faces = surface["faces"].as_array()
        .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
    let width = doc.resolution.width;
    let height = doc.resolution.height;
    // A one-Cube read uses a fresh scratch cache. The paged consumer reuses
    // it for up to eight Cubes without storing model/bitmap state.
    let mut projected = Vec::with_capacity(FACE_NAMES.len());
    for face in faces {
        let side = face["side"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let kind = face["reference_kind"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let index = face["texture_index"].as_u64()
            .and_then(|index| usize::try_from(index).ok());
        let mut reason = global_reason;
        if reason.is_none() && index.is_none() {
            reason = Some("NO_EXPLICIT_TEXTURE_REFERENCE");
        }
        let texture = index.and_then(|i| doc.texture_assets.get(i));
        if reason.is_none() && !texture.is_some_and(|t|
            paint::exportable(t, width, height)
        ) {
            reason = Some("UNSUPPORTED_TEXTURE_FORMAT_OR_METADATA");
        }
        let saved_rect: [f64; 4] = serde_json::from_value(face["uv"].clone())
            .map_err(|_| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let rect = if let Some(box_cube) = &derived_box {
            face_uv(box_cube, side)?
        } else {
            saved_rect
        };
        let stats = if let Some(message) = reason {
            json!({"status":"unsupported","reason":message})
        } else {
            let texture_index = index.ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
            let png = cached_inspection_atlas(doc, texture_index, decoded)?;
            match paint::uv_region_alpha_stats(png, width, height, rect) {
                Ok(mut region) => {
                    if derived_box.is_some() {
                        region["scope"] = json!("derived_box_uv_alpha_pixels");
                    }
                    json!({"status":"measured","region":region})
                },
                Err(code) if matches!(code.as_str(),
                    "PAINT_UV_RECT_NON_INTEGRAL" |
                    "PAINT_UV_RECT_OUT_OF_BOUNDS" |
                    "PAINT_UV_RECT_ZERO_AREA") => {
                    json!({"status":"unsupported","reason":code})
                }
                Err(code) => return Err(code),
            }
        };
        projected.push(json!({
            "side":side,
            "saved_reference_kind":kind,
            "texture_index":index,
            "texture_uuid":face["texture_uuid"],
            "uv":rect,
            "saved_uv":saved_rect,
            "uv_source":if derived_box.is_some() { "derived_box" } else { "saved_manual" },
            "alpha":stats
        }));
    }
    let report = json!({
        "scope":if derived_box.is_some() {
            "derived_box_face_uv_alpha"
        } else { "saved_manual_face_uv_alpha" },
        "cube_uuid":cube.uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "face_count":projected.len(),
        "faces":projected
    });
    if serde_json::to_vec(&report)
        .map_err(|_| fail("CUBE_UV_ALPHA_SERIALIZE_FAILED"))?.len() > 24 * 1024 {
        return Err(fail("CUBE_UV_ALPHA_RESULT_TOO_LARGE"));
    }
    Ok(report)
}

pub fn can_set_empty_atlas_resolution(doc: &AuthoringDocument) -> bool {
    doc.cubes.is_empty() && doc.bones.is_empty() &&
    doc.texture_assets.is_empty() && doc.animation_assets.is_empty() &&
    doc.meta.extra.is_empty() && doc.resolution.extra.is_empty() &&
    doc.extensions.keys().all(|key|
        matches!(key.as_str(), "name" | "model_identifier" | "visible_box")) &&
    !has_per_texture_uv_rules(doc)
}

/// Read capability tied to one validated EditorSession lifetime. Private
/// fields prevent callers from constructing this for unvalidated documents.
pub struct ValidatedInspection<'a> {
    pub(super) doc: &'a AuthoringDocument,
    // One lazily constructed UUID index and bounded decoder scratch for all
    // selectors in the existing SHA-pinned Rust CLI inspection batch. No
    // caches survive this borrowed validated EditorSession read.
    pub(super) texture_indices: OnceCell<HashMap<&'a str, usize>>,
    pub(super) decoded_pngs: RefCell<Vec<(usize, Vec<u8>)>>,
    pub(super) geometry_impact_index: OnceCell<geometry_impact::GeometryImpactIndex>,
}

impl<'a> ValidatedInspection<'a> {
    fn texture_indices(&self) -> &HashMap<&'a str, usize> {
        self.texture_indices.get_or_init(|| indexed_texture_uuids(self.doc))
    }

    /// Only the repeated Geometry Impact path needs an atlas-user index;
    /// it is borrowed from this validated document and discarded afterwards.
    pub fn geometry_impact(&self, uuid: &str, change: &str) -> Result<Value> {
        let index = self.geometry_impact_index.get_or_init(||
            geometry_impact::GeometryImpactIndex::new(self.doc));
        geometry_impact::inspect_geometry_impact_indexed(self.doc, uuid, change, index)
    }

    pub fn cube_surfaces(&self, uuid: &str) -> Result<Value> {
        let cube = self.doc.cubes.iter().find(|cube| cube.uuid == uuid)
            .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
        inspect_cube_surfaces_validated(self.doc, cube, self.texture_indices())
    }

    pub fn cube_face_alpha(&self, uuid: &str) -> Result<Value> {
        let cube = self.doc.cubes.iter().find(|cube| cube.uuid == uuid)
            .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
        let mut decoded = self.decoded_pngs.borrow_mut();
        inspect_cube_uv_alpha_validated(
            self.doc, cube, &mut decoded, self.texture_indices(),
        )
    }

    pub fn texture_alpha(&self, uuid: &str) -> Result<Value> {
        inspect_paint_alpha_validated(self.doc, uuid)
    }

    /// Existing scratch for repeated same-atlas face-style reads; no
    /// persistent pixels or permission/visual authority.
    pub fn texture_styling_face(
        &self, texture_uuid: &str, cube_uuid: &str, side: &str,
    ) -> Result<Value> {
        let mut decoded = self.decoded_pngs.borrow_mut();
        material_styling::inspect_texture_styling_face_validated(
            self.doc, texture_uuid, cube_uuid, side, &mut decoded,
        )
    }

    pub fn model_texture_coverage(
        &self, offset: usize, limit: usize, attention_only: bool,
    ) -> Result<Value> {
        let mut decoded = self.decoded_pngs.borrow_mut();
        texture_coverage::inspect_model_texture_coverage_filtered_with_cache(
            self.doc, offset, limit, attention_only,
            self.texture_indices(), &mut decoded,
        )
    }
}
