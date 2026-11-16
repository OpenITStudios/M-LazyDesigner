//! One Rust-owned Bone hierarchy duplicate for Bedrock Entity models.
//! New Cubes intentionally share existing UV/Texture assets; original
//! Animation targets are left unchanged rather than silently remapped.
use super::{
    collect_visibility_targets, fail, find_visibility_group, valid_uuid,
    AuthoringDocument, Bone, Cube, OutlinerBone, OutlinerNode, Result, MAX_ELEMENTS,
};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

fn clone_uuid(root: &str, original: &str) -> String {
    // A caller-supplied root seed gives stable descendant identities without
    // requiring one new UUID argument and tool call for every child element.
    let digest = super::sha256(
        format!("lazydesigner:bone-subtree-clone\0{root}\0{original}").as_bytes(),
    );
    format!(
        "{}-{}-4{}-8{}-{}",
        &digest[..8], &digest[8..12], &digest[13..16],
        &digest[17..20], &digest[20..32],
    )
}

fn collect_saved_uuids(value: &Value, ids: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            if let Some(uuid) = map.get("uuid").and_then(Value::as_str) {
                ids.insert(uuid.to_owned());
            }
            for child in map.values() { collect_saved_uuids(child, ids); }
        }
        Value::Array(values) => {
            for child in values { collect_saved_uuids(child, ids); }
        }
        _ => {}
    }
}

fn contains_cohort_uuid(value: &Value, originals: &HashSet<String>) -> bool {
    match value {
        Value::String(text) => originals.contains(text),
        Value::Array(items) => items.iter().any(|v| contains_cohort_uuid(v, originals)),
        Value::Object(map) => map_contains_cohort_uuid(map, originals),
        _ => false,
    }
}

fn map_contains_cohort_uuid(
    map: &Map<String, Value>, originals: &HashSet<String>,
) -> bool {
    map.iter().any(|(key, value)|
        originals.contains(key) || contains_cohort_uuid(value, originals))
}

fn clone_group(
    source: &OutlinerBone,
    originals: &HashSet<String>,
    remap: &HashMap<String, String>,
    suffix: &str,
    bone_sources: &HashMap<&str, &Bone>,
    cube_sources: &HashMap<&str, &Cube>,
    names: &mut HashSet<String>,
    bones_out: &mut Vec<Bone>,
    cubes_out: &mut Vec<Cube>,
) -> Result<OutlinerBone> {
    if map_contains_cohort_uuid(&source.extra, originals) {
        return Err(fail("BONE_DUPLICATE_OPAQUE_REFERENCE_UNSUPPORTED"));
    }
    let existing = bone_sources.get(source.uuid.as_str())
        .ok_or_else(|| fail("BONE_DUPLICATE_SOURCE_INVALID"))?;
    if map_contains_cohort_uuid(&existing.extra, originals) {
        return Err(fail("BONE_DUPLICATE_OPAQUE_REFERENCE_UNSUPPORTED"));
    }
    let name = format!("{}{}", existing.name, suffix);
    // Reuse the geometry-exporter's exact Bedrock Bone-name rule.
    if !super::geometry::valid_bone_name(&name) {
        return Err(fail("BONE_DUPLICATE_NAME_INVALID"));
    }
    if !names.insert(name.to_ascii_lowercase()) {
        return Err(fail("BONE_DUPLICATE_NAME_CONFLICT"));
    }
    let new_id = remap.get(&source.uuid)
        .ok_or_else(|| fail("BONE_DUPLICATE_REMAP_INVALID"))?;
    let mut cloned_bone = (**existing).clone();
    cloned_bone.uuid = new_id.clone();
    cloned_bone.name = name;
    bones_out.push(cloned_bone);

    let mut node = source.clone();
    node.uuid = new_id.clone();
    node.children.clear();
    for child in &source.children {
        match child {
            OutlinerNode::Bone(group) => {
                let duplicate = clone_group(group, originals, remap, suffix,
                    bone_sources, cube_sources, names, bones_out, cubes_out)?;
                node.children.push(OutlinerNode::Bone(duplicate));
            }
            OutlinerNode::Cube(uuid) => {
                let original = cube_sources.get(uuid.as_str())
                    .ok_or_else(|| fail("BONE_DUPLICATE_CUBE_MISSING"))?;
                if map_contains_cohort_uuid(&original.extra, originals) ||
                   original.faces.values().any(|face|
                       contains_cohort_uuid(face, originals)) {
                    return Err(fail("BONE_DUPLICATE_OPAQUE_REFERENCE_UNSUPPORTED"));
                }
                let new_cube_id = remap.get(uuid)
                    .ok_or_else(|| fail("BONE_DUPLICATE_REMAP_INVALID"))?;
                let mut cloned_cube = (**original).clone();
                cloned_cube.uuid = new_cube_id.clone();
                cubes_out.push(cloned_cube);
                node.children.push(OutlinerNode::Cube(new_cube_id.clone()));
            }
        }
    }
    Ok(node)
}

fn insert_bone_sibling_after(
    nodes: &mut Vec<OutlinerNode>, source_uuid: &str, duplicate: &OutlinerBone,
) -> bool {
    for index in 0..nodes.len() {
        if matches!(&nodes[index], OutlinerNode::Bone(group) if group.uuid == source_uuid) {
            nodes.insert(index + 1, OutlinerNode::Bone(duplicate.clone()));
            return true;
        }
        if let OutlinerNode::Bone(group) = &mut nodes[index] {
            if insert_bone_sibling_after(&mut group.children, source_uuid, duplicate) {
                return true;
            }
        }
    }
    false
}

/// Clone a nested rig as one validated edit. A later TranslateBoneSubtree
/// or Cube UV-isolation step can be in the same atomic EditPlan.
pub(super) fn duplicate_bone_subtree(
    doc: &mut AuthoringDocument, source_uuid: &str,
    new_uuid: &str, name_suffix: &str,
) -> Result<()> {
    if !valid_uuid(new_uuid) {
        return Err(fail("BONE_DUPLICATE_ID_INVALID"));
    }
    if name_suffix.is_empty() || name_suffix.len() > 32 ||
       !name_suffix.bytes().all(|b|
           b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
        return Err(fail("BONE_DUPLICATE_SUFFIX_INVALID"));
    }
    let original = find_visibility_group(&doc.hierarchy, source_uuid)
        .cloned().ok_or_else(|| fail("BONE_NOT_FOUND"))?;

    let mut source_cubes = HashSet::new();
    let mut source_bones = HashSet::new();
    collect_visibility_targets(&original, &mut source_cubes, &mut source_bones);
    if doc.bones.len() + source_bones.len() > MAX_ELEMENTS {
        return Err(fail("BONE_COUNT_LIMIT"));
    }
    if doc.cubes.len() + source_cubes.len() > MAX_ELEMENTS {
        return Err(fail("CUBE_COUNT_LIMIT"));
    }
    let originals: HashSet<String> =
        source_bones.union(&source_cubes).cloned().collect();
    let mut used: HashSet<String> =
        doc.bones.iter().map(|item| item.uuid.clone())
            .chain(doc.cubes.iter().map(|item| item.uuid.clone())).collect();
    for asset in doc.texture_assets.iter().chain(doc.animation_assets.iter()) {
        collect_saved_uuids(asset, &mut used);
    }
    if let Some(id) = doc.extensions.get("uuid").and_then(Value::as_str) {
        used.insert(id.to_owned());
    }
    for value in doc.extensions.values() {
        collect_saved_uuids(value, &mut used);
    }
    let mut remap = HashMap::with_capacity(originals.len());
    for original_id in &originals {
        let next_id = if original_id == source_uuid {
            new_uuid.to_owned()
        } else {
            clone_uuid(new_uuid, original_id)
        };
        if !valid_uuid(&next_id) || !used.insert(next_id.clone()) {
            return Err(fail("BONE_DUPLICATE_ID_CONFLICT"));
        }
        remap.insert(original_id.clone(), next_id);
    }
    let bones_by_id: HashMap<&str, &Bone> = doc.bones.iter()
        .map(|bone| (bone.uuid.as_str(), bone)).collect();
    let cubes_by_id: HashMap<&str, &Cube> = doc.cubes.iter()
        .map(|cube| (cube.uuid.as_str(), cube)).collect();
    let mut names: HashSet<String> = doc.bones.iter()
        .map(|bone| bone.name.to_ascii_lowercase()).collect();
    let mut new_bones = Vec::with_capacity(source_bones.len());
    let mut new_cubes = Vec::with_capacity(source_cubes.len());
    let copied = clone_group(&original, &originals, &remap, name_suffix,
        &bones_by_id, &cubes_by_id, &mut names, &mut new_bones, &mut new_cubes)?;
    if !insert_bone_sibling_after(&mut doc.hierarchy, source_uuid, &copied) {
        return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
    }
    doc.bones.extend(new_bones);
    doc.cubes.extend(new_cubes);
    // Refuse a source edit that cannot later be saved in the bounded bbmodel.
    // A failed EditorSession draft never replaces the existing document.
    let _ = doc.export_bbmodel()?;
    Ok(())
}


/// Reflect one scalar about an explicit plane, refusing unrepresentable
/// persisted coordinates rather than relying on JSON floating point coercion.
fn reflected(value: f64, center: f64) -> Result<f64> {
    let next = 2.0 * center - value;
    if !next.is_finite() || next.abs() > super::LIMIT {
        return Err(fail("BONE_REFLECT_COORDINATE_INVALID"));
    }
    Ok(if next == 0.0 { 0.0 } else { next })
}

/// A plane reflection conjugates a ZYX Euler rotation: its own-axis angle
/// stays unchanged; angles around the other two axes reverse sign.
fn reflect_saved_rotation(extra: &mut Map<String, Value>, axis: usize) -> Result<()> {
    let Some(saved) = extra.get("rotation") else { return Ok(()); };
    let mut values: [f64; 3] = serde_json::from_value(saved.clone())
        .map_err(|_| fail("BONE_REFLECT_ROTATION_UNSUPPORTED"))?;
    if !super::valid_vec3(values) {
        return Err(fail("BONE_REFLECT_ROTATION_UNSUPPORTED"));
    }
    for (i, angle) in values.iter_mut().enumerate() {
        if i != axis { *angle = -*angle; }
    }
    extra.insert("rotation".into(), serde_json::json!(values));
    Ok(())
}

/// Pinned Blockbench 5.2.1 Cube.flip face-pair and rotated-UV semantics.
/// Change only saved face coordinates and side ownership, not atlas PNGs.
fn reflect_manual_uv(cube: &mut Cube, axis: usize) -> Result<()> {
    let (a, b) = match axis {
        0 => ("west", "east"),
        1 => ("up", "down"),
        2 => ("south", "north"),
        _ => return Err(fail("BONE_REFLECT_AXIS_INVALID")),
    };
    let first = cube.faces.get(a).cloned()
        .ok_or_else(|| fail("BONE_REFLECT_FACE_INVALID"))?;
    let second = cube.faces.get(b).cloned()
        .ok_or_else(|| fail("BONE_REFLECT_FACE_INVALID"))?;
    cube.faces.insert(a.to_owned(), second);
    cube.faces.insert(b.to_owned(), first);
    for side in super::FACE_NAMES {
        let face = cube.faces.get_mut(side).and_then(Value::as_object_mut)
            .ok_or_else(|| fail("BONE_REFLECT_FACE_INVALID"))?;
        // Imported side-relative cull rules cannot be safely reused after
        // swapping face ownership; no silent carryover to the opposite side.
        if face.get("cullface").is_some_and(|value|
            value.as_str().is_none_or(|name| !name.is_empty())) {
            return Err(fail("BONE_REFLECT_FACE_RULE_UNSUPPORTED"));
        }
        let mut uv: [f64; 4] = serde_json::from_value(
            face.get("uv").cloned()
                .ok_or_else(|| fail("BONE_REFLECT_FACE_INVALID"))?
        ).map_err(|_| fail("BONE_REFLECT_FACE_INVALID"))?;
        let rotation = match face.get("rotation") {
            None => 0.0,
            Some(value) => value.as_f64()
                .ok_or_else(|| fail("BONE_REFLECT_FACE_ROTATION_UNSUPPORTED"))?,
        };
        if ![0.0, 90.0, 180.0, 270.0].contains(&rotation) {
            return Err(fail("BONE_REFLECT_FACE_ROTATION_UNSUPPORTED"));
        }
        // Vertical sides flip V on Y and U on X/Z; the up/down faces flip U
        // on X and V on Y/Z. Quarter turns exchange the active UV axis.
        let mut flip_u = if matches!(side, "up" | "down") {
            axis == 0
        } else {
            axis != 1
        };
        if rotation == 90.0 || rotation == 270.0 { flip_u = !flip_u; }
        if flip_u { uv.swap(0, 2); } else { uv.swap(1, 3); }
        face.insert("uv".into(), serde_json::json!(uv));
    }
    Ok(())
}

/// Author X/Y/Z geometry symmetry in one Rust EditOperation, optionally
/// mirroring admitted UV faces. This is not an animation-keyframe mirror.
/// Use DuplicateBoneSubtree followed by this operation in one EditPlan to
/// create a mirrored counterpart without touching the source rig.
pub(super) fn reflect_bone_subtree(
    doc: &mut AuthoringDocument, uuid: &str, axis: &str,
    center: f64, uv_policy: &str,
) -> Result<()> {
    let axis = match axis {
        "x" => 0,
        "y" => 1,
        "z" => 2,
        _ => return Err(fail("BONE_REFLECT_AXIS_INVALID")),
    };
    if !center.is_finite() || center.abs() > super::LIMIT {
        return Err(fail("BONE_REFLECT_CENTER_INVALID"));
    }
    if !matches!(uv_policy, "preserve" | "mirror") {
        return Err(fail("BONE_REFLECT_UV_POLICY_INVALID"));
    }
    let group = super::find_visibility_group(&doc.hierarchy, uuid)
        .ok_or_else(|| fail("BONE_REFLECT_NOT_FOUND"))?;
    let mut cube_ids = HashSet::new();
    let mut bone_ids = HashSet::new();
    collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);

    // Reflection in saved model coordinates is exact only when unmirrored
    // ancestors do not impose their own rotations (the root has none).
    let mut parent = super::outliner_parent_uuid(&doc.hierarchy, uuid, None)
        .ok_or_else(|| fail("BONE_REFLECT_NOT_FOUND"))?;
    while let Some(parent_id) = parent {
        let bone = doc.bones.iter().find(|bone| bone.uuid == parent_id)
            .ok_or_else(|| fail("BONE_REFLECT_PARENT_INVALID"))?;
        let rotation: [f64; 3] = match bone.extra.get("rotation") {
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|_| fail("BONE_REFLECT_PARENT_UNSUPPORTED"))?,
            None => [0.0; 3],
        };
        if rotation.iter().any(|angle| *angle != 0.0) ||
           bone.extra.contains_key("scale") {
            return Err(fail("BONE_REFLECT_PARENT_UNSUPPORTED"));
        }
        parent = super::outliner_parent_uuid(&doc.hierarchy, &parent_id, None)
            .ok_or_else(|| fail("BONE_REFLECT_PARENT_INVALID"))?;
    }

    // Existing opaque or editable keyframes must not play back on newly
    // reflected bind poses without explicit animation correction.
    // Scan each animation tree once with a membership set, instead of once
    // per Bone/Cube in a large rig.
    let cohort: HashSet<String> = bone_ids.union(&cube_ids).cloned().collect();
    if doc.animation_assets.iter().any(|asset|
        contains_cohort_uuid(asset, &cohort)) {
        return Err(fail("BONE_REFLECT_ANIMATION_BOUND"));
    }
    let box_default = doc.meta.box_uv.unwrap_or(false);
    // Validate every Cube before changing any, so the Rust draft remains
    // one coherent geometry+UV transformation or a precise refusal.
    for cube in doc.cubes.iter().filter(|cube| cube_ids.contains(&cube.uuid)) {
        if super::cube_auto_uv(cube)? != 0 {
            return Err(fail("BONE_REFLECT_AUTO_UV_UNSUPPORTED"));
        }
        if uv_policy == "mirror" {
            if super::has_per_texture_uv_rules(doc) {
                return Err(fail("BONE_REFLECT_UV_RULESET_UNSUPPORTED"));
            }
            if super::cube_box_uv(cube, box_default) {
                // The pinned Box UV flag mirrors X only; Y/Z cannot be
                // expressed as a lossless single Box-net mirror flag.
                if axis != 0 {
                    return Err(fail("BONE_REFLECT_BOX_UV_AXIS_UNSUPPORTED"));
                }
                super::check_box_uv_repack_rules(doc, cube)
                    .map_err(|_| fail("BONE_REFLECT_BOX_UV_UNSUPPORTED"))?;
            }
        }
    }

    for cube in &mut doc.cubes {
        if !cube_ids.contains(&cube.uuid) { continue; }
        let old_from = cube.from[axis];
        let old_to = cube.to[axis];
        cube.from[axis] = reflected(old_to, center)?;
        cube.to[axis] = reflected(old_from, center)?;
        if cube.origin.is_some() || center != 0.0 {
            let mut origin = cube.origin.unwrap_or([0.0; 3]);
            origin[axis] = reflected(origin[axis], center)?;
            cube.origin = Some(origin);
        }
        reflect_saved_rotation(&mut cube.extra, axis)?;
        if uv_policy == "mirror" {
            if super::cube_box_uv(cube, box_default) {
                let mirrored = cube.extra.get("mirror_uv")
                    .and_then(Value::as_bool).unwrap_or(false);
                if mirrored { cube.extra.remove("mirror_uv"); }
                else { cube.extra.insert("mirror_uv".into(), Value::Bool(true)); }
                super::refresh_box_uv(cube)?;
            } else {
                reflect_manual_uv(cube, axis)?;
            }
        }
    }
    for bone in &mut doc.bones {
        if !bone_ids.contains(&bone.uuid) { continue; }
        if bone.origin.is_some() || center != 0.0 {
            let mut origin = bone.origin.unwrap_or([0.0; 3]);
            origin[axis] = reflected(origin[axis], center)?;
            bone.origin = Some(origin);
        }
        reflect_saved_rotation(&mut bone.extra, axis)?;
    }
    Ok(())
}
