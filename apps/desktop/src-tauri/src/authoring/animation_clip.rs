//! One transaction to duplicate a supported Bone Animation Clip into a
//! separately editable variant. The native Rust document and .bbmodel codec
//! remain the only owners; no per-keyframe AI loop or extra animation engine.
//! Source reference: Blockbench 5.2.1 Animation duplicate action
//! (animation.js SharedActions 'duplicate'; after selected source).
use super::{editable_transform_clip, fail, valid_uuid, AuthoringDocument, Result, MAX_ELEMENTS};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Collect only saved identifiers, not PNG base64, model names or content.
/// A keyframe ID must be unique against all saved assets and node identities.
fn collect_asset_uuids(value: &Value, occupied: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            if let Some(uuid) = map.get("uuid").and_then(Value::as_str) {
                occupied.insert(uuid.to_owned());
            }
            for child in map.values() { collect_asset_uuids(child, occupied); }
        }
        Value::Array(items) => {
            for item in items { collect_asset_uuids(item, occupied); }
        }
        _ => {}
    }
}

fn derived_key_uuid(clip_uuid: &str, old_key_uuid: &str) -> String {
    // Re-running the same plan over the same source/new clip ID yields the
    // same keyframe identities; no nondeterministic per-child host calls.
    let digest = super::sha256(format!(
        "lazydesigner:animation-clip-copy\0{clip_uuid}\0{old_key_uuid}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}",
        &digest[..8], &digest[8..12], &digest[13..16],
        &digest[17..20], &digest[20..32])
}

/// A complete, bounded copy of one already recognized numeric Bone clip.
/// Keep original Bone UUID track keys, playback mode, length, keyframe values,
/// interpolation mode and Bezier handles. Replace only the clip name/UUID
/// and its internally owned keyframe UUIDs; other clips are untouched.
pub(super) fn duplicate_animation_clip(
    doc: &mut AuthoringDocument, source_uuid: &str,
    new_uuid: &str, new_name: &str,
) -> Result<()> {
    if !valid_uuid(new_uuid) ||
       new_name.trim().is_empty() || new_name.chars().count() > 128 ||
       new_name.chars().any(char::is_control) {
        return Err(fail("ANIMATION_DUPLICATE_ID_OR_NAME_INVALID"));
    }
    if doc.animation_assets.len() >= MAX_ELEMENTS {
        return Err(fail("ANIMATION_DUPLICATE_SIZE_LIMIT"));
    }
    let sources: Vec<usize> = doc.animation_assets.iter().enumerate()
        .filter(|(_,clip)| clip.get("uuid").and_then(Value::as_str) == Some(source_uuid))
        .map(|(i,_)|i).collect();
    let source_index = match sources.as_slice() {
        [] => return Err(fail("ANIMATION_NOT_FOUND")),
        [i] => *i,
        _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
    };
    let original = &doc.animation_assets[source_index];
    if !editable_transform_clip(original, &doc.bones) {
        return Err(fail("ANIMATION_DUPLICATE_SOURCE_UNSUPPORTED"));
    }
    if doc.animation_assets.iter().any(|clip|
        clip.get("name").and_then(Value::as_str) == Some(new_name.trim())) {
        return Err(fail("ANIMATION_DUPLICATE_NAME_CONFLICT"));
    }

    let mut occupied = HashSet::new();
    for cube in &doc.cubes { occupied.insert(cube.uuid.clone()); }
    for bone in &doc.bones { occupied.insert(bone.uuid.clone()); }
    for asset in doc.texture_assets.iter().chain(doc.animation_assets.iter()) {
        collect_asset_uuids(asset, &mut occupied);
    }
    // Also refuse a user-supplied Clip UUID that appears only in opaque
    // project metadata as an external reference (no unsafe silent adoption).
    if occupied.contains(new_uuid) ||
       super::map_references_uuid(&doc.meta.extra,new_uuid) ||
       super::map_references_uuid(&doc.resolution.extra,new_uuid) ||
       super::map_references_uuid(&doc.extensions,new_uuid) ||
       doc.texture_assets.iter().chain(&doc.animation_assets)
           .any(|asset| super::value_references_uuid(asset,new_uuid)) {
        return Err(fail("ANIMATION_DUPLICATE_ID_CONFLICT"));
    }
    occupied.insert(new_uuid.to_owned());
    let mut duplicated = original.clone();
    duplicated["uuid"] = json!(new_uuid);
    duplicated["name"] = json!(new_name.trim());
    let tracks = duplicated.get_mut("animators").and_then(Value::as_object_mut)
        .ok_or_else(|| fail("ANIMATION_DUPLICATE_SOURCE_UNSUPPORTED"))?;
    for track in tracks.values_mut() {
        let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
            .ok_or_else(|| fail("ANIMATION_DUPLICATE_SOURCE_UNSUPPORTED"))?;
        for frame in frames.iter_mut() {
            let old = frame.get("uuid").and_then(Value::as_str)
                .ok_or_else(|| fail("ANIMATION_DUPLICATE_SOURCE_UNSUPPORTED"))?;
            let id = derived_key_uuid(new_uuid,old);
            if !valid_uuid(&id) || !occupied.insert(id.clone()) {
                return Err(fail("ANIMATION_DUPLICATE_KEY_ID_CONFLICT"));
            }
            frame["uuid"] = json!(id);
        }
    }
    // Verify the generated clip is supported and saved keyframe data remains
    // coherent after remapping; no unknown extensions are synthesized.
    if !editable_transform_clip(&duplicated, &doc.bones) {
        return Err(fail("ANIMATION_DUPLICATE_RESULT_UNSUPPORTED"));
    }
    doc.animation_assets.insert(source_index+1,duplicated);
    // The session commits this draft only if it fits the bounded .bbmodel.
    let _ = doc.export_bbmodel()?;
    Ok(())
}
