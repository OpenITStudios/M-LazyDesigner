//! Typed hierarchy EditOperation handling.
//! Rust EditorSession in authoring/mod.rs remains the only transaction/Undo owner.
//! Branch bodies are preserved from the original complete dispatcher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn apply(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
        EditOperation::AddBone { bone, parent_uuid } => {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               doc.cubes.iter().any(|c| c.uuid == bone.uuid) ||
               doc.bones.iter().any(|g| g.uuid == bone.uuid) {
                return Err(fail("BONE_CREATION_INVALID"));
            }
            let node = OutlinerNode::Bone(OutlinerBone {
                uuid: bone.uuid.clone(), children: Vec::new(), is_open: Some(true), extra: Map::new(),
            });
            if let Some(parent) = parent_uuid {
                if !append_child(&mut doc.hierarchy, parent, &node) {
                    return Err(fail("BONE_PARENT_NOT_FOUND"));
                }
            } else { doc.hierarchy.push(node); }
            doc.bones.push(bone.clone());
            Ok(bone.uuid.clone())
        }
        EditOperation::AddCube { cube, bone_uuid } => {
            if doc.cubes.iter().any(|c| c.uuid == cube.uuid) ||
               doc.bones.iter().any(|g| g.uuid == cube.uuid) {
                return Err(fail("CUBE_UUID_CONFLICT"));
            }
            let mut prepared = cube.clone();
            validate_cube(&prepared, &doc.texture_assets)?;
            // A newly added Box UV Cube must obey the same atlas safety gate
            // as subsequent Reframe, Scale, Resize, Mirror and UV Offset edits.
            if cube_box_uv(&prepared, doc.meta.box_uv.unwrap_or(false)) {
                check_box_uv_repack_rules(doc, &prepared)?;
                refresh_box_uv(&mut prepared)?;
            }
            if !append_child(&mut doc.hierarchy, bone_uuid, &OutlinerNode::Cube(cube.uuid.clone())) {
                return Err(fail("CUBE_BONE_NOT_FOUND"));
            }
            doc.cubes.push(prepared);
            Ok(cube.uuid.clone())
        }

        EditOperation::DuplicateCube { source_uuid, new_uuid } => {
            if !valid_uuid(new_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *new_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *new_uuid) ||
               doc.texture_assets.iter().chain(&doc.animation_assets)
                   .any(|value| value.get("uuid").and_then(Value::as_str) == Some(new_uuid.as_str())) {
                return Err(fail("CUBE_DUPLICATE_ID_INVALID"));
            }
            if doc.cubes.len() >= MAX_ELEMENTS {
                return Err(fail("CUBE_COUNT_LIMIT"));
            }
            let source = doc.cubes.iter().find(|cube| cube.uuid == *source_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // An opaque source self-reference cannot be rewritten safely.
            // Refuse it rather than copy a stale reference to the source UUID.
            if map_references_uuid(&source.extra, source_uuid) ||
               source.faces.values().any(|face| value_references_uuid(face, source_uuid)) {
                return Err(fail("CUBE_DUPLICATE_SELF_REFERENCE_UNSUPPORTED"));
            }
            let mut duplicate = source.clone();
            duplicate.uuid = new_uuid.clone();
            validate_cube(&duplicate, &doc.texture_assets)?;
            if !insert_cube_sibling_after(&mut doc.hierarchy, source_uuid, new_uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.push(duplicate);
            Ok(new_uuid.clone())
        }
        EditOperation::DuplicateBoneSubtree { source_uuid, new_uuid, name_suffix } => {
            subtree::duplicate_bone_subtree(doc, source_uuid, new_uuid, name_suffix)?;
            Ok(new_uuid.clone())
        }
        EditOperation::ReparentNode { uuid, parent_uuid } => {
            let is_cube = doc.cubes.iter().any(|cube| cube.uuid == *uuid);
            let is_bone = doc.bones.iter().any(|bone| bone.uuid == *uuid);
            if !is_cube && !is_bone { return Err(fail("REPARENT_NODE_NOT_FOUND")); }
            if is_cube && parent_uuid.is_none() {
                // A Bedrock Cube may only be reparented to a Bone in this slice.
                return Err(fail("REPARENT_CUBE_REQUIRES_BONE"));
            }
            if let Some(target) = parent_uuid {
                if !doc.bones.iter().any(|bone| bone.uuid == *target) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
                // The destination must not lie within the source Bone subtree.
                if is_bone {
                    let source_group = find_visibility_group(&doc.hierarchy, uuid)
                        .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
                    if target == uuid ||
                        find_visibility_group(&source_group.children, target).is_some() {
                        return Err(fail("REPARENT_CYCLE"));
                    }
                }
            }
            let current_parent = outliner_parent_uuid(&doc.hierarchy, uuid, None)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if current_parent.as_deref() == parent_uuid.as_deref() { return Ok(uuid.clone()); }
            let moved = take_outliner_node(&mut doc.hierarchy, uuid)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if let Some(target) = parent_uuid {
                if !append_child(&mut doc.hierarchy, target, &moved) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
            } else {
                doc.hierarchy.push(moved);
            }
            // Blockbench's default Outliner move has adjust_position=false.
            // Keep saved local transforms/UUIDs untouched; the target Bone's
            // inherited rotation may change the resulting world-space pose.
            Ok(uuid.clone())
        }
        EditOperation::RenameNode { uuid, name } => {
            if !valid_node_name(name) { return Err(fail("NODE_NAME_INVALID")); }
            let desired = name.trim();
            // Find read-only first: iter_mut() would clone the entire Cube COW
            // allocation even when the UUID actually refers to a Bone.
            if let Some(index) = doc.cubes.iter().position(|cube| cube.uuid == *uuid) {
                doc.cubes[index].name = Some(desired.to_owned());
                return Ok(uuid.clone());
            }
            let bone_index = doc.bones.iter().position(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("RENAME_NODE_NOT_FOUND"))?;
            let original = doc.bones[bone_index].name.clone();
            // Bedrock JSON needs unambiguous Bone names for exported rigs.
            // Existing imported names are preserved, but a newly authored
            // rename cannot introduce another case-insensitive collision.
            if doc.bones.iter().enumerate().any(|(index, bone)|
                index != bone_index && bone.name.eq_ignore_ascii_case(desired)) {
                return Err(fail("BONE_NAME_CONFLICT"));
            }
            // A Blockbench Bone animator is indexed by Bone UUID, while
            // its optional display name mirrors the Bone name. Synchronize
            // only that known field, never rewrite opaque keyframes/Molang.
            // Imported inconsistent track names refuse rather than silently
            // leave a misleading Bone->Animation relationship behind.
            // Validate all named tracks before making the Animation COW
            // collection mutable. A Bone without any named animator never
            // needs to duplicate imported keyframes or opaque JSON payloads.
            let mut named_tracks = Vec::new();
            for (index, animation) in doc.animation_assets.iter().enumerate() {
                if let Some(track) = animation.get("animators")
                    .and_then(Value::as_object)
                    .and_then(|animators| animators.get(uuid))
                {
                    if let Some(label) = track.get("name") {
                        if label.as_str() != Some(original.as_str()) {
                            return Err(fail("BONE_ANIMATOR_NAME_UNSUPPORTED"));
                        }
                        if desired != original.as_str() { named_tracks.push(index); }
                    }
                }
            }
            for index in named_tracks {
                let track = doc.animation_assets[index].get_mut("animators")
                    .and_then(Value::as_object_mut)
                    .and_then(|animators| animators.get_mut(uuid))
                    .ok_or_else(|| fail("BONE_ANIMATOR_NAME_UNSUPPORTED"))?;
                track["name"] = json!(desired);
            }
            doc.bones[bone_index].name = desired.to_owned();
            Ok(uuid.clone())
        }
        EditOperation::RemoveCube { uuid } => {
            if !doc.cubes.iter().any(|cube| cube.uuid == *uuid) {
                return Err(fail("CUBE_NOT_FOUND"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.retain(|cube| cube.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::RemoveEmptyBone { uuid } => {
            let group = find_visibility_group(&doc.hierarchy, uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if !group.children.is_empty() {
                return Err(fail("BONE_NOT_EMPTY"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
            }
            doc.bones.retain(|bone| bone.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::SetNodeVisibility { uuid, visible } => {
            if let Some(index) = doc.cubes.iter().position(|cube| cube.uuid == *uuid) {
                set_visibility(&mut doc.cubes[index].extra, *visible);
            } else {
                let group = find_visibility_group(&doc.hierarchy, uuid)
                    .ok_or_else(|| fail("VISIBILITY_TARGET_NOT_FOUND"))?;
                let mut cube_ids = HashSet::new();
                let mut bone_ids = HashSet::new();
                collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);
                // An empty Bone subtree can change only its Bone metadata;
                // do not detach and copy unrelated Cube allocations.
                if !cube_ids.is_empty() {
                    for cube in &mut doc.cubes {
                        if cube_ids.contains(&cube.uuid) { set_visibility(&mut cube.extra, *visible); }
                    }
                }
                for bone in &mut doc.bones {
                    if bone_ids.contains(&bone.uuid) { set_visibility(&mut bone.extra, *visible); }
                }
            }
            Ok(uuid.clone())
        }
        _ => Err(fail("EDIT_OPERATION_DOMAIN_MISMATCH")),
    }
}
