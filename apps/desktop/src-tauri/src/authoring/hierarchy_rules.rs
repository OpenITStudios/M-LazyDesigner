//! Hierarchy/visibility and UUID reference traversal helpers. The canonical AuthoringDocument/EditorSession and
//! transaction, history, saved file and public document contract stay in mod.rs.
//! SOURCE_ONLY; native/Cargo and regression tests remain NOT_EXECUTED.
use super::*;

pub(super) fn append_child(nodes: &mut [OutlinerNode], parent_uuid: &str, child: &OutlinerNode) -> bool {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == parent_uuid {
                group.children.push(child.clone());
                return true;
            }
            if append_child(&mut group.children, parent_uuid, child) { return true; }
        }
    }
    false
}

// A duplicated Cube stays beside its source in the nested Outliner.
// The Rust document, rather than the Svelte Outliner, owns this ordering.
pub(super) fn insert_cube_sibling_after(
    nodes: &mut Vec<OutlinerNode>, source_uuid: &str, new_uuid: &str,
) -> bool {
    for index in 0..nodes.len() {
        if matches!(nodes.get(index), Some(OutlinerNode::Cube(id)) if id == source_uuid) {
            nodes.insert(index + 1, OutlinerNode::Cube(new_uuid.to_owned()));
            return true;
        }
        if let Some(OutlinerNode::Bone(group)) = nodes.get_mut(index) {
            if insert_cube_sibling_after(&mut group.children, source_uuid, new_uuid) {
                return true;
            }
        }
    }
    false
}

// Return Some(None) for an Outliner root entry and Some(Some(id)) for
// a nested entry; None means that the requested node is not present.
pub(super) fn outliner_parent_uuid(
    nodes: &[OutlinerNode], uuid: &str, parent: Option<&str>,
) -> Option<Option<String>> {
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) if id == uuid => return Some(parent.map(str::to_owned)),
            OutlinerNode::Bone(group) => {
                if group.uuid == uuid { return Some(parent.map(str::to_owned)); }
                if let Some(found) = outliner_parent_uuid(
                    &group.children, uuid, Some(&group.uuid)
                ) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

// A moved Bone retains every descendant and all Outliner-local metadata.
pub(super) fn take_outliner_node(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> Option<OutlinerNode> {
    if let Some(index) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        return Some(nodes.remove(index));
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if let Some(found) = take_outliner_node(&mut group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

// In pinned Blockbench 5.2.1 an Outliner group visibility toggle writes
// the group and all descendants; the Group preview is not an inherited mask.
pub(super) fn find_visibility_group<'a>(nodes: &'a [OutlinerNode], uuid: &str) -> Option<&'a OutlinerBone> {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == uuid { return Some(group); }
            if let Some(found) = find_visibility_group(&group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

pub(super) fn collect_visibility_targets(
    group: &OutlinerBone, cube_ids: &mut HashSet<String>, bone_ids: &mut HashSet<String>,
) {
    bone_ids.insert(group.uuid.clone());
    for child in &group.children {
        match child {
            OutlinerNode::Cube(uuid) => { cube_ids.insert(uuid.clone()); },
            OutlinerNode::Bone(nested) => collect_visibility_targets(nested, cube_ids, bone_ids),
        }
    }
}

pub(super) fn set_visibility(extra: &mut Map<String, Value>, visible: bool) {
    if visible {
        // Blockbench omits the default visible Cube field on save.
        extra.remove("visibility");
    } else {
        extra.insert("visibility".into(), Value::Bool(false));
    }
}

// Remove one Outliner entry without flattening siblings or nested Bone data.
pub(super) fn remove_outliner_entry(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> bool {
    if let Some(position) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        nodes.remove(position);
        return true;
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if remove_outliner_entry(&mut group.children, uuid) { return true; }
        }
    }
    false
}

// Opaque extensions can address elements by UUID. Do not leave broken
// references behind when a user explicitly removes an element.
pub(super) fn value_references_uuid(value: &Value, uuid: &str) -> bool {
    match value {
        Value::String(text) => text == uuid,
        Value::Array(items) => items.iter().any(|item| value_references_uuid(item, uuid)),
        Value::Object(values) => map_references_uuid(values, uuid),
        _ => false,
    }
}

pub(super) fn map_references_uuid(values: &Map<String, Value>, uuid: &str) -> bool {
    values.iter().any(|(key, value)| key == uuid || value_references_uuid(value, uuid))
}

pub(super) fn outliner_extra_references_uuid(nodes: &[OutlinerNode], uuid: &str) -> bool {
    nodes.iter().any(|node| match node {
        OutlinerNode::Cube(_) => false,
        OutlinerNode::Bone(group) => {
            (group.uuid != uuid && map_references_uuid(&group.extra, uuid)) ||
                outliner_extra_references_uuid(&group.children, uuid)
        }
    })
}

pub(super) fn has_external_uuid_references(doc: &AuthoringDocument, uuid: &str) -> bool {
    map_references_uuid(&doc.extensions, uuid) ||
    map_references_uuid(&doc.meta.extra, uuid) ||
    map_references_uuid(&doc.resolution.extra, uuid) ||
    doc.texture_assets.iter().chain(&doc.animation_assets)
        .any(|value| value_references_uuid(value, uuid)) ||
    doc.cubes.iter().filter(|cube| cube.uuid != uuid)
        .any(|cube| map_references_uuid(&cube.extra, uuid) ||
            cube.faces.values().any(|face| value_references_uuid(face, uuid))) ||
    doc.bones.iter().filter(|bone| bone.uuid != uuid)
        .any(|bone| map_references_uuid(&bone.extra, uuid)) ||
    outliner_extra_references_uuid(&doc.hierarchy, uuid)
}
