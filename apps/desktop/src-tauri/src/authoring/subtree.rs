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
