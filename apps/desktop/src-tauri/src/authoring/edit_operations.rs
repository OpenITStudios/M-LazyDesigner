//! Canonical EditOperation dispatcher for a provisional Rust authoring document.
//! EditorSession in mod.rs remains the sole transaction/revision/history owner.
//! Moved from mod.rs without changing mutation semantics. SOURCE_ONLY.
use super::*;

/// The single UV-aware Cube translation primitive for standalone moves and
/// subtree cohorts. Keeping it on a mutable Cube supports a linear scan of
/// large hierarchies instead of repeated UUID lookups for every descendant.
fn translate_cube_in_place(
    cube: &mut Cube, delta: [f64; 3],
    per_texture_uv_rules: bool, resolution: [f64; 2],
    textures: &[Value], project_box_uv: bool,
) -> Result<()> {
    if !valid_vec3(delta) { return Err(fail("CUBE_DELTA_INVALID")); }
    if delta.iter().all(|axis| *axis == 0.0) { return Ok(()); }
    let auto_uv = cube_auto_uv(cube)?;
    let box_uv = cube_box_uv(cube, project_box_uv);
    if !box_uv && auto_uv != 0 && per_texture_uv_rules {
        return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
    }
    for axis in 0..3 {
        cube.from[axis] += delta[axis];
        cube.to[axis] += delta[axis];
    }
    let origin = cube.origin.get_or_insert([0.0, 0.0, 0.0]);
    for axis in 0..3 { origin[axis] += delta[axis]; }
    if !box_uv {
        refresh_auto_uv(cube, auto_uv, resolution, textures, None)?;
    }
    Ok(())
}

pub(super) fn apply_operation(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
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
        EditOperation::TranslateCube { uuid, delta } => {
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            translate_cube_in_place(&mut doc.cubes[cube_index], *delta, per_texture,
                resolution, textures, project_box_uv)?;
            Ok(uuid.clone())
        }
        EditOperation::ReflectBoneSubtree { uuid, axis, center, uv_policy } => {
            subtree::reflect_bone_subtree(doc, uuid, axis, *center, uv_policy)?;
            Ok(uuid.clone())
        }
        EditOperation::TranslateBoneSubtree { uuid, delta } => {
            // Move an articulated Cube/Bone cohort as a unit, rather than
            // asking an agent to emit one operation per nested element.
            // Reuse exactly the existing per-Cube UV-aware move semantics.
            // Bone keyframes stay local to their targets; opaque assets
            // and saved texture pixels are never rewritten by this command.
            if !valid_vec3(*delta) {
                return Err(fail("BONE_SUBTREE_DELTA_INVALID"));
            }
            let group = find_visibility_group(&doc.hierarchy, uuid)
                .ok_or_else(|| fail("BONE_SUBTREE_NOT_FOUND"))?;
            if delta.iter().all(|v| *v == 0.0) {
                return Ok(uuid.clone());
            }
            let mut cube_ids = HashSet::new();
            let mut bone_ids = HashSet::new();
            collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);
            // One pass across each source collection, with O(1) expected
            // subtree membership. All Cube UV behavior stays in the same
            // translate_cube_in_place owner as a standalone TranslateCube.
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            if !cube_ids.is_empty() {
                for cube in &mut doc.cubes {
                    if cube_ids.contains(&cube.uuid) {
                        translate_cube_in_place(cube, *delta, per_texture,
                            resolution, &doc.texture_assets, project_box_uv)?;
                    }
                }
            }
            for bone in &mut doc.bones {
                if bone_ids.contains(&bone.uuid) {
                    let origin = bone.origin.unwrap_or([0.0, 0.0, 0.0]);
                    let moved: [f64; 3] = std::array::from_fn(|axis|
                        origin[axis] + delta[axis]);
                    if !valid_vec3(moved) {
                        return Err(fail("BONE_ORIGIN_INVALID"));
                    }
                    bone.origin = Some(moved);
                }
            }
            // The parent EditorSession only commits after validate(),
            // so one bad UV rule or overflow cancels the whole subtree move.
            Ok(uuid.clone())
        }
        EditOperation::SetCubeBounds { uuid, from, to } => {
            if !valid_bounds(*from, *to) { return Err(fail("CUBE_BOUNDS_INVALID")); }
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            let auto_uv = cube_auto_uv(cube)?;
            let box_uv = cube_box_uv(cube, project_box_uv);
            let refusal = if box_uv { "CUBE_BOX_UV_RESIZE_UNSUPPORTED" }
                else { "CUBE_AUTO_UV_REMAP_REQUIRED" };
            // The current operation has no transform direction. For UV-sensitive
            // cubes, only a single moved edge has unambiguous native semantics.
            let mut changed: Option<(usize, i8)> = None;
            for axis in 0..3 {
                let from_changed = cube.from[axis] != from[axis];
                let to_changed = cube.to[axis] != to[axis];
                if from_changed || to_changed {
                    if (auto_uv != 0 || box_uv) &&
                        (changed.is_some() || (from_changed && to_changed)) {
                        return Err(fail(refusal));
                    }
                    changed = Some((axis, if from_changed { -1 } else { 1 }));
                }
            }
            if changed.is_none() { return Ok(uuid.clone()); }
            if auto_uv != 0 && !box_uv && per_texture {
                return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if box_uv {
                check_box_uv_repack_rules(doc, cube)?;
            }
            let (axis, direction) = changed.expect("a bound changed");
            let cube = &mut doc.cubes[cube_index];
            let prior_size = cube.to[axis] - cube.from[axis];
            cube.from = *from;
            cube.to = *to;
            if box_uv {
                apply_box_resize_offset(cube, axis, direction, prior_size);
                refresh_box_uv(cube)?;
            } else {
                refresh_auto_uv(cube, auto_uv, resolution, textures, Some((axis, direction)))?;
            }
            Ok(uuid.clone())
        }
        EditOperation::ReframeCube { uuid, from, to, uv_policy } => {
            // Explicit, deterministic full-shape authoring rather than a
            // sequence of mouse-edge resizes. The caller picks UV intent:
            // regenerate the complete Box UV net, or retain manual Face UV.
            // Preserve pivot/orientation/texture references without guessing.
            if !valid_bounds(*from, *to) {
                return Err(fail("CUBE_REFRAME_BOUNDS_INVALID"));
            }
            let box_uv_default = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let box_uv = cube_box_uv(&doc.cubes[cube_index], box_uv_default);
            if (box_uv && uv_policy != "box_repack") ||
               (!box_uv && uv_policy != "manual_preserve") {
                return Err(fail("CUBE_REFRAME_UV_POLICY_MISMATCH"));
            }
            if box_uv {
                check_box_uv_repack_rules(doc, &doc.cubes[cube_index])
                    .map_err(|code| box_uv_refusal_for("reframe", code))?;
            } else if cube_auto_uv(&doc.cubes[cube_index])? != 0 {
                return Err(fail("CUBE_REFRAME_AUTO_UV_UNSUPPORTED"));
            }
            let cube = &mut doc.cubes[cube_index];
            cube.from = *from;
            cube.to = *to;
            if box_uv {
                // An explicit repack also repairs stale cached face UV
                // when dimensions happen to stay unchanged.
                refresh_box_uv(cube)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("BONE_ROTATION_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            let current = bone.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                .unwrap_or([0.0, 0.0, 0.0]);
            if current == *rotation { return Ok(uuid.clone()); }
            if rotation.iter().all(|value| *value == 0.0) {
                // A neutral Bone rotation is omitted by pinned Blockbench.
                bone.extra.remove("rotation");
            } else {
                bone.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneOrigin { uuid, origin } => {
            // Rig pivot edit: never silently move child Cubes, UVs, or animation data.
            if !valid_vec3(*origin) { return Err(fail("BONE_ORIGIN_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if bone.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            bone.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeOrigin { uuid, origin } => {
            // Keep the Cube's saved faces, bounds and parent Bone untouched.
            if !valid_vec3(*origin) { return Err(fail("CUBE_ORIGIN_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            cube.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeInflate { uuid, inflate } => {
            if !inflate.is_finite() || inflate.abs() > LIMIT {
                return Err(fail("CUBE_INFLATE_INVALID"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // Never commit a collapsed or inverted rendered surface.
            if (0..3).any(|axis| cube.to[axis] - cube.from[axis] + 2.0 * inflate <= 0.0) {
                return Err(fail("CUBE_INFLATE_DEGENERATE"));
            }
            if cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0) == *inflate {
                return Ok(uuid.clone());
            }
            if *inflate == 0.0 {
                cube.extra.remove("inflate");
            } else {
                cube.extra.insert("inflate".into(), json!(inflate));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeStretch { uuid, stretch } => {
            // Preserve Cube bounds, pivot, UV and source image. Author only
            // positive, bounded stretches that the Three.js preview can show.
            // Imported unusual stretch fields remain preserved separately;
            // they are not silently coerced by this edit.
            if !stretch.iter().all(|value|
                value.is_finite() && *value > 0.0 && *value <= 100.0) {
                return Err(fail("CUBE_STRETCH_INVALID"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let inflation = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
            if (0..3).any(|axis|
                (cube.to[axis] - cube.from[axis] + 2.0 * inflation) * stretch[axis] <= 0.0) {
                return Err(fail("CUBE_STRETCH_DEGENERATE"));
            }
            let current = cube.extra.get("stretch")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                .unwrap_or([1.0; 3]);
            if current == *stretch { return Ok(uuid.clone()); }
            if *stretch == [1.0; 3] {
                cube.extra.remove("stretch");
            } else {
                cube.extra.insert("stretch".into(), json!(stretch));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeMirrorUv { uuid, mirrored } => {
            // One semantic operation replaces six manual Box UV edits.
            // Never approximate advanced per-texture or float-sized nets.
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            if !cube_box_uv(cube, project_box_uv) {
                return Err(fail("CUBE_MIRROR_BOX_UV_REQUIRED"));
            }
            if cube.extra.get("mirror_uv").and_then(Value::as_bool).unwrap_or(false)
                == *mirrored {
                return Ok(uuid.clone());
            }
            check_box_uv_repack_rules(doc, cube)
                .map_err(|code| box_uv_refusal_for("mirror", code))?;
            let cube = &mut doc.cubes[cube_index];
            if *mirrored {
                cube.extra.insert("mirror_uv".into(), Value::Bool(true));
            } else {
                cube.extra.remove("mirror_uv");
            }
            refresh_box_uv(cube)?;
            Ok(uuid.clone())
        }
        EditOperation::ScaleCube { uuid, factors } => {
            // A bounded, positive per-axis extension of pinned Blockbench
            // ModelScaler.scaleElements about the selected Cube's own pivot.
            // Its original scalar may be axis-filtered; this supports the same
            // math independently on each selected axis.
            if !factors.iter().all(|f| f.is_finite() && *f > 0.0 && *f <= 4.0) {
                return Err(fail("CUBE_SCALE_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if factors.iter().all(|f| *f == 1.0) { return Ok(uuid.clone()); }
            if cube_box_uv(&doc.cubes[cube_index], project_box_uv) {
                check_box_uv_repack_rules(doc, &doc.cubes[cube_index])?;
            }
            let cube = &mut doc.cubes[cube_index];
            let inflate = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
            let pivot = cube.origin.unwrap_or([0.0, 0.0, 0.0]);
            for axis in 0..3 {
                let from = cube.from[axis];
                let to = cube.to[axis];
                cube.from[axis] = (from - inflate - pivot[axis]) * factors[axis] +
                    inflate + pivot[axis];
                cube.to[axis] = (to + inflate - pivot[axis]) * factors[axis] -
                    inflate + pivot[axis];
            }
            // ModelScaler clears Auto UV on scale; leave manual face UV and
            // texture identity untouched, rather than falsely remapping it.
            if cube_auto_uv(cube)? != 0 {
                cube.extra.insert("autouv".into(), json!(0));
            }
            if cube_box_uv(cube, project_box_uv) {
                // Box UV extents derive from the new saved Cube dimensions.
                // Scaling does not change the atlas UV offset.
                refresh_box_uv(cube)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("CUBE_ROTATION_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if rotation.iter().all(|value| *value == 0.0) {
                // Blockbench omits the neutral cube rotation when saving.
                cube.extra.remove("rotation");
            } else {
                cube.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::DuplicateAnimationClip { source_uuid, new_uuid, new_name } => {
            animation_clip::duplicate_animation_clip(doc, source_uuid, new_uuid, new_name)?;
            Ok(new_uuid.clone())
        }
        EditOperation::AddAnimationTimelineMarker { animation_uuid, time, name, color } => {
            timeline_markers::add_marker(doc,animation_uuid,*time,name,*color)
        }
        EditOperation::UpdateAnimationTimelineMarker {
            animation_uuid, target_time, time, name, color,
        } => timeline_markers::update_marker(
            doc,animation_uuid,*target_time,*time,name,*color),
        EditOperation::RemoveAnimationTimelineMarker { animation_uuid, time } => {
            timeline_markers::remove_marker(doc,animation_uuid,*time)
        }
        EditOperation::AddAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::add_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::UpdateAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel, time, points,
        } => effects::update_event(doc,animation_uuid,keyframe_uuid,channel,*time,points),
        EditOperation::RemoveAnimationEffectEvent {
            animation_uuid, keyframe_uuid, channel,
        } => effects::remove_event(doc,animation_uuid,keyframe_uuid,channel),
        EditOperation::CreateAnimation { uuid, name, length } => {
            if !valid_uuid(uuid) || name.trim().is_empty() || name.chars().count() > 128 ||
               name.chars().any(char::is_control) ||
               !length.is_finite() || !(0.0..=3600.0).contains(length) ||
               doc.animation_assets.len() >= MAX_ELEMENTS ||
               doc.animation_assets.iter().any(|a|
                   a.get("uuid").and_then(Value::as_str) == Some(uuid) ||
                   a.get("name").and_then(Value::as_str) == Some(name.trim())) ||
               doc.cubes.iter().any(|c| c.uuid == *uuid) ||
               doc.bones.iter().any(|b| b.uuid == *uuid) ||
               doc.texture_assets.iter().any(|t| t.get("uuid").and_then(Value::as_str) == Some(uuid)) {
                return Err(fail("ANIMATION_CREATION_INVALID"));
            }
            doc.animation_assets.push(json!({
                "uuid": uuid, "name": name.trim(),
                "loop": "once", "length": length, "animators": {}
            }));
            Ok(uuid.clone())
        }
        EditOperation::SetAnimationLoopMode { animation_uuid, mode } => {
            // Only admitted numeric linear/step/Catmull-Rom Bone clips without opaque fields can
            // change their playback policy. Source-backed Blockbench v5.2.1
            // stores exactly once, loop, hold in the .bbmodel clip.
            if !matches!(mode.as_str(), "once" | "loop" | "hold") {
                return Err(fail("ANIMATION_LOOP_MODE_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            let clip = &doc.animation_assets[index];
            if !editable_transform_clip(clip, &doc.bones) {
                return Err(fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"));
            }
            let duration = clip.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LOOP_EDIT_UNSUPPORTED"))?;
            if duration == 0.0 && mode != "once" {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            if saved_animation_loop(clip) == Some(mode.as_str()) {
                return Ok(animation_uuid.clone());
            }
            doc.animation_assets[index]["loop"] = json!(mode);
            Ok(animation_uuid.clone())
        }
        EditOperation::SetAnimationLength { animation_uuid, length } => {
            if !length.is_finite() || !(0.0..=3600.0).contains(length) {
                return Err(fail("ANIMATION_LENGTH_INVALID"));
            }
            let mut matching = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid));
            let (index, animation) = matching.next()
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            if matching.next().is_some() {
                // An imported model can contain duplicate Animation UUIDs.
                // Never choose the first target silently.
                return Err(fail("ANIMATION_ID_AMBIGUOUS"));
            }
            // All admitted numeric linear/step/Catmull-Rom transform channels are kept
            // byte-for-byte. No keyframe may be discarded by shortening.
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"));
            }
            if *length == 0.0 && saved_animation_loop(animation) != Some("once") {
                return Err(fail("ANIMATION_LOOP_LENGTH_INVALID"));
            }
            let animators = animation.get("animators").and_then(Value::as_object)
                .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
            for track in animators.values() {
                let frames = track.get("keyframes").and_then(Value::as_array)
                    .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
                if frames.iter().any(|frame| frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|time| time > *length)) {
                    return Err(fail("ANIMATION_LENGTH_BEFORE_KEYFRAME"));
                }
            }
            if !timeline_markers::valid_saved_markers(animation,*length) {
                return Err(fail("ANIMATION_LENGTH_BEFORE_MARKER"));
            }
            doc.animation_assets[index]["length"] = json!(length);
            Ok(animation_uuid.clone())
        }
        EditOperation::ScaleAnimationTimeline { animation_uuid, factor } => {
            // Admitted numeric linear/step/Catmull-Rom/Bezier clips are retimed in a
            // single transaction. No keyframe payload, UUID, Bone identity,
            // channel or interpolation is rewritten or guessed.
            if !factor.is_finite() || !(0.1..=10.0).contains(factor) {
                return Err(fail("ANIMATION_TIMELINE_FACTOR_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str())).map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TIMELINE_UNSUPPORTED"));
            }
            let original_length = doc.animation_assets[index]["length"].as_f64()
                .ok_or_else(|| fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"))?;
            let new_length = original_length * factor;
            if original_length <= 0.0 ||
               !new_length.is_finite() || !(0.0..=3600.0).contains(&new_length) {
                return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
            }
            if *factor == 1.0 { return Ok(animation_uuid.clone()); }
            let tracks = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
            for track in tracks.values_mut() {
                let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                    .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                for frame in frames {
                    let time = frame.get("time").and_then(Value::as_f64)
                        .ok_or_else(|| fail("ANIMATION_TIMELINE_UNSUPPORTED"))?;
                    let scaled = time * factor;
                    if !scaled.is_finite() || scaled > new_length {
                        return Err(fail("ANIMATION_TIMELINE_LENGTH_UNSUPPORTED"));
                    }
                    if frame.get("interpolation").and_then(Value::as_str) == Some("bezier") &&
                       !bezier::retime_handles(frame, *factor) {
                        return Err(fail("ANIMATION_BEZIER_RETIME_UNSUPPORTED"));
                    }
                    frame["time"] = json!(scaled);
                }
            }
            timeline_markers::scale_markers(
                &mut doc.animation_assets[index],*factor,new_length)?;
            doc.animation_assets[index]["length"] = json!(new_length);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                // E.g. scale would collapse distinct same-channel keyframe
                // times below the strict admission threshold. The parent
                // EditorSession discards this entire draft on refusal.
                return Err(fail("ANIMATION_TIMELINE_AFTER_SCALE_UNSUPPORTED"));
            }
            Ok(animation_uuid.clone())
        }
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_uuid(keyframe_uuid) || !time.is_finite() || *time < 0.0 ||
               !valid_vec3(*rotation) ||
               doc.animation_assets.iter().any(|a| value_references_uuid(a, keyframe_uuid)) ||
               doc.cubes.iter().any(|c| c.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|b| b.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animators = animation.get_mut("animators").and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animators.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name": bone_name, "type": "bone", "keyframes": []
            }));
            if track.get("type").is_some_and(|kind| kind.as_str() != Some("bone")) {
                return Err(fail("ANIMATION_TRACK_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 4096 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64).is_some_and(|t| (t - time).abs() <= 1e-6)
            ) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            // Blockbench KeyframeDataPoint's x/y/z fields are Molang strings.
            frames.push(json!({
                "uuid": keyframe_uuid, "channel": "rotation", "time": time,
                "interpolation": "linear",
                "data_points": [{
                    "x": rotation[0].to_string(),
                    "y": rotation[1].to_string(),
                    "z": rotation[2].to_string()
                }]
            }));
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_vec3(*rotation) || !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != index &&
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[index]["time"] = json!(time);
            frames[index]["data_points"][0] = json!({
                "x": rotation[0].to_string(), "y": rotation[1].to_string(),
                "z": rotation[2].to_string()
            });
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid,
        } => {
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            frames.remove(index);
            // The session owns a draft; a refusal here rolls back the removal.
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_uuid(keyframe_uuid) || !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 ||
               doc.animation_assets.iter().any(|asset|
                   value_references_uuid(asset, keyframe_uuid)) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            let animation = &doc.animation_assets[index];
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = animation.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animator = doc.animation_assets[index]["animators"].as_object_mut()
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animator.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name":bone_name,"type":"bone","keyframes":[]
            }));
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 2048 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames.push(json!({
                "uuid":keyframe_uuid, "channel":channel, "time":time,
                "interpolation":"linear",
                "data_points":[{
                    "x":value[0].to_string(), "y":value[1].to_string(),
                    "z":value[2].to_string()
                }]
            }));
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = doc.animation_assets[index].get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != target &&
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[target]["time"] = json!(time);
            frames[target]["data_points"][0] = json!({
                "x":value[0].to_string(), "y":value[1].to_string(),
                "z":value[2].to_string()
            });
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid, bone_uuid, keyframe_uuid, channel, interpolation,
        } => {
            // Blockbench 5.2.1 stores each key's outgoing interpolation.
            // Bezier requires separate explicit handle authoring; a
            // change is therefore targeted at one exact key UUID/channel.
            if !supported_transform_channel(channel) ||
               !matches!(interpolation.as_str(), "linear" | "step" | "catmullrom") {
                return Err(fail("ANIMATION_INTERPOLATION_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, animation)| animation.get("uuid")
                    .and_then(Value::as_str) == Some(animation_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matches: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid")
                    .and_then(Value::as_str) == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames[target].get("interpolation").and_then(Value::as_str)
                == Some(interpolation.as_str()) {
                return Ok(keyframe_uuid.clone());
            }
            frames[target]["interpolation"] = json!(interpolation);
            // Blockbench's saved representation omits Bezier-specific
            // fields when a key is switched to another interpolation.
            bezier::clear_handles(&mut frames[target]);
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_INTERPOLATION_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid, bone_uuid, keyframe_uuid, channel, handles,
        } => {
            if !supported_transform_channel(channel) || !handles.valid() {
                return Err(fail("ANIMATION_BEZIER_HANDLES_INVALID"));
            }
            let matches: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, item)| item.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid.as_str()))
                .map(|(index, _)| index).collect();
            let index = match matches.as_slice() {
                [] => return Err(fail("ANIMATION_NOT_FOUND")),
                [index] => *index,
                _ => return Err(fail("ANIMATION_ID_AMBIGUOUS")),
            };
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_CLIP_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index]
                .get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let matching: Vec<_> = frames.iter().enumerate()
                .filter(|(_, frame)| frame.get("uuid").and_then(Value::as_str)
                    == Some(keyframe_uuid.as_str()))
                .map(|(i, _)| i).collect();
            let target = match matching.as_slice() {
                [] => return Err(fail("ANIMATION_KEYFRAME_NOT_FOUND")),
                [i] => *i,
                _ => return Err(fail("ANIMATION_KEYFRAME_ID_AMBIGUOUS")),
            };
            if frames[target].get("channel").and_then(Value::as_str)
                != Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            bezier::write_handles(&mut frames[target], handles);
            // Existing EditorSession draft is never committed if any
            // operation fails. Recheck recognized saved keys now.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_BEZIER_AFTER_EDIT_UNSUPPORTED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel,
        } => {
            if !supported_transform_channel(channel) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            frames.remove(target);
            // Joining two adjacent segments may alter their Bezier time
            // handles. Fail atomically if the remaining track is ambiguous.
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_AFTER_EDIT_UNSUPPORTED"));
            }
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::EnableImportedPaintTexture { texture_index } => {
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            let (width, height) = (doc.resolution.width, doc.resolution.height);
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::adopt(texture, width, height)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetVisibleBox { bounds } => {
            if !geometry::valid_visible_box(*bounds) {
                return Err(fail("VISIBLE_BOX_INVALID"));
            }
            // Keep the authored animation envelope in the canonical
            // .bbmodel Project property. The Geometry exporter combines it
            // with computed static bounds; no Cube, PNG or Animation edits.
            doc.extensions.insert("visible_box".into(), json!(bounds));
            Ok("project-visible-box".into())
        }
        EditOperation::SetEmptyAtlasResolution { width, height } => {
            if !can_set_empty_atlas_resolution(doc) {
                return Err(fail("ATLAS_RESOLUTION_LOCKED"));
            }
            if *width == 0 || *height == 0 || *width > MAX_PAINT_ATLAS_SIDE ||
               *height > MAX_PAINT_ATLAS_SIDE {
                return Err(fail("ATLAS_RESOLUTION_UNSUPPORTED"));
            }
            doc.resolution.width = *width;
            doc.resolution.height = *height;
            Ok("project-resolution".into())
        }
        EditOperation::ReplaceExistingFaceTextureGuarded {
            intent, candidate_png_source,
        } => external_texture::apply_operation(doc,intent,candidate_png_source),
        EditOperation::ImportPaintTexture { uuid, name, source } => {
            // Existing imported project assets are never rewritten to admit
            // an unsupported Paint/UV configuration.
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            let texture = paint::import_png(
                uuid, name, source, doc.resolution.width, doc.resolution.height
            )?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::AssignCubeTexture { cube_uuid, texture_uuid } => {
            // Bedrock multi-file rulesets select textures by element scope.
            // Do not claim global face-ID assignment changes the material.
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if !doc.texture_assets.iter().any(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            for face in cube.faces.values_mut() {
                // A null face is intentionally absent in Blockbench. Never
                // enable its geometry by assigning another texture.
                if face.get("texture").is_some_and(Value::is_null) { continue; }
                let fields = face.as_object_mut()
                    .ok_or_else(|| fail("CUBE_FACE_DATA_INVALID"))?;
                fields.insert("texture".into(), Value::String(texture_uuid.clone()));
            }
            Ok(cube_uuid.clone())
        }
        EditOperation::AssignCubeFaceTexture { cube_uuid, face, texture_uuid } => {
            // A single diagnosed face must never repaint/rebind other faces.
            // The caller chooses the intended atlas; the inspector supplies
            // evidence, not automatic mutation authority.
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if !FACE_NAMES.contains(&face.as_str()) {
                return Err(fail("CUBE_FACE_INVALID"));
            }
            if !doc.texture_assets.iter().any(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let target = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("CUBE_FACE_DATA_INVALID"))?;
            // Blockbench null means the side is intentionally missing.
            // Refuse to turn it into geometry while correcting a texture.
            if target.get("texture").is_some_and(Value::is_null) {
                return Err(fail("CUBE_FACE_INTENTIONALLY_ABSENT"));
            }
            target.insert("texture".into(), Value::String(texture_uuid.clone()));
            Ok(cube_uuid.clone())
        }
        EditOperation::CreatePaintTexture { uuid, name } => {
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            // Bedrock project resolution is the atlas size for this initial
            // single-texture Paint subset. The codec owns all PNG bytes.
            let texture = paint::create(uuid, name, doc.resolution.width, doc.resolution.height)?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::PaintTexturePixel { texture_index, x, y, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::pixel(texture, doc.resolution.width, doc.resolution.height, *x, *y, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureStroke { texture_index, points, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::stroke(texture, doc.resolution.width, doc.resolution.height, points, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureBrush { texture_index, points, radius, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::brush(texture, doc.resolution.width, doc.resolution.height,
                points, *radius, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureExactPixels {texture_index,pixels}=>{
            let texture=doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(||fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::exact_pixels(texture,doc.resolution.width,
                doc.resolution.height,pixels)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureRectangle { texture_index, from, to, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangle(texture, doc.resolution.width, doc.resolution.height,
                *from, *to, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureRectangles { texture_index, rectangles } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangles(texture, doc.resolution.width, doc.resolution.height,
                rectangles)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::IsolateCubeBoxUv { cube_uuid, texture_uuid } => {
            let plan = uv_sharing::plan_box_uv_isolation(doc,cube_uuid,texture_uuid)?;
            let (width,height) = (doc.resolution.width,doc.resolution.height);
            let texture = doc.texture_assets.get_mut(plan.texture_index)
                .ok_or_else(|| fail("UV_ATLAS_TEXTURE_NOT_FOUND"))?;
            paint::copy_uv_regions(texture,width,height,&plan.copies)?;
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("UV_ATLAS_CUBE_NOT_FOUND"))?;
            cube.uv_offset = Some(plan.next_offset);
            refresh_box_uv(cube)?;
            Ok(cube_uuid.clone())
        }
        EditOperation::RecolorCubeFacesPaletteGuarded { texture_uuid, targets, palette } => {
            palette::recolor_cube_faces_palette_guarded(doc, texture_uuid, targets, palette)
        }
        EditOperation::PaintCubeFaceRegionsGuarded { cube_uuid, texture_uuid, regions } => {
            face_regions::paint_cube_face_regions_guarded(doc, cube_uuid, texture_uuid, regions)
        }
        EditOperation::PaintCubeUvFacesGuarded { cube_uuid, texture_uuid, faces } => {
            // Opt-in shared-atlas protection: only requested faces are paint
            // targets, while all other faces remain possible UV consumers.
            if faces.is_empty() || faces.len() > FACE_NAMES.len() {
                return Err(fail("PAINT_CUBE_FACES_SIZE_INVALID"));
            }
            let mut seen = HashSet::new();
            for patch in faces {
                if !FACE_NAMES.contains(&patch.face.as_str()) ||
                   !seen.insert(patch.face.as_str()) {
                    return Err(fail("PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"));
                }
            }
            let names: Vec<&str> = faces.iter().map(|patch| patch.face.as_str()).collect();
            let report = uv_sharing::inspect_cube_uv_sharing_for_faces(
                doc, cube_uuid, texture_uuid, Some(&names))?;
            let count = |key| report[key].as_u64().unwrap_or(u64::MAX);
            if count("focused_mapped_faces") != faces.len() as u64 ||
               count("unresolved_explicit_faces") > 0 ||
               count("implicit_reference_faces") > 0 {
                return Err(fail("PAINT_CUBE_UV_GUARD_UNRESOLVED"));
            }
            if count("declared_overlap_pairs") > 0 {
                return Err(fail("PAINT_CUBE_UV_GUARD_SHARED"));
            }
            // Reuse exactly one existing PNG mutation/Undo source. This
            // guard is not proof of native material or face-coverage parity.
            apply_operation(doc, &EditOperation::PaintCubeUvFaces {
                cube_uuid: cube_uuid.clone(), texture_uuid: texture_uuid.clone(),
                faces: faces.clone(),
            })
        }
        EditOperation::PaintCubeUvFaces { cube_uuid, texture_uuid, faces } => {
            // Paint up to six explicit semantic Cube faces on one validated
            // atlas, in caller order and through one existing PNG transaction.
            // This does not claim exclusive face ownership of shared UV pixels.
            if faces.is_empty() || faces.len() > FACE_NAMES.len() {
                return Err(fail("PAINT_CUBE_FACES_SIZE_INVALID"));
            }
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_CUBE_UV_RULESET_UNSUPPORTED"));
            }
            let texture_index = doc.texture_assets.iter().position(|texture|
                texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            let original_cube = doc.cubes.iter().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let mut projected = original_cube.clone();
            if cube_box_uv(original_cube, doc.meta.box_uv.unwrap_or(false)) {
                if check_box_uv_repack_rules(doc, original_cube).is_err() {
                    return Err(fail("PAINT_CUBE_UV_RULESET_UNSUPPORTED"));
                }
                // Never trust stale cached rectangles from an imported Cube.
                // The derived Box net is local; this is not a geometry edit.
                refresh_box_uv(&mut projected)?;
            } else if cube_auto_uv(original_cube)? != 0 {
                return Err(fail("PAINT_CUBE_AUTO_UV_UNSUPPORTED"));
            }
            let mut seen = HashSet::new();
            let mut steps = Vec::with_capacity(faces.len());
            for patch in faces {
                if !FACE_NAMES.contains(&patch.face.as_str()) ||
                   !seen.insert(patch.face.as_str()) {
                    return Err(fail("PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"));
                }
                let surface = projected.faces.get(&patch.face)
                    .and_then(Value::as_object)
                    .ok_or_else(|| fail("PAINT_CUBE_FACE_INVALID"))?;
                if surface.get("enabled").is_some_and(|v| v != &Value::Bool(true)) {
                    return Err(fail("PAINT_CUBE_FACE_DISABLED"));
                }
                // Face-level null/false/unset means no explicit atlas target,
                // even if Bedrock's runtime chooses a default texture.
                let linked = match surface.get("texture") {
                    Some(Value::String(uuid)) => uuid == texture_uuid,
                    Some(Value::Number(number)) =>
                        number.as_u64() == Some(texture_index as u64),
                    _ => false,
                };
                if !linked { return Err(fail("PAINT_CUBE_FACE_TEXTURE_MISMATCH")); }
                let uv = face_uv(&projected, &patch.face)?;
                let (from, end) = paint::uv_pixel_rectangle(
                    doc.resolution.width, doc.resolution.height, uv)?;
                steps.push(PaintRectangleStep {
                    from, to: [end[0] - 1, end[1] - 1],
                    rgba: patch.rgba, erase: patch.erase,
                });
            }
            let bitmap = doc.texture_assets.get_mut(texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangles(bitmap, doc.resolution.width,
                doc.resolution.height, &steps)?;
            Ok(texture_uuid.clone())
        }
        EditOperation::PaintTextureFill { texture_index, at, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::fill(texture, doc.resolution.width, doc.resolution.height,
                *at, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetBoxUvOffset { uuid, offset } => {
            // Blockbench's Box UV editor stores integer atlas offsets.
            if !valid_uv(offset) || !offset.iter().all(|value| value.fract() == 0.0) {
                return Err(fail("BOX_UV_OFFSET_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube_index = doc.cubes.iter().position(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let cube = &doc.cubes[cube_index];
            if !cube_box_uv(cube, project_box_uv) {
                return Err(fail("BOX_UV_MODE_REQUIRED"));
            }
            if cube.uv_offset.unwrap_or([0.0, 0.0]) == *offset {
                return Ok(uuid.clone());
            }
            check_box_uv_repack_rules(doc, cube)?;
            let cube = &mut doc.cubes[cube_index];
            cube.uv_offset = if offset.iter().all(|value| *value == 0.0) {
                None
            } else {
                Some(*offset)
            };
            refresh_box_uv(cube)?;
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUvRotation { uuid, face, rotation } => {
            if !FACE_NAMES.contains(&face.as_str()) ||
               !matches!(*rotation, 0 | 90 | 180 | 270) {
                return Err(fail("FACE_UV_ROTATION_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            let auto_uv = cube_auto_uv(cube)?;
            let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
            // Blockbench CubeFace.rotation defaults to 0, and its save copy
            // omits default fields. Unsupported existing data is preserved
            // through refusal, not overwritten or silently normalized.
            let previous = match data.get("rotation") {
                None => 0,
                Some(value) => match value.as_f64() {
                    Some(n) if [0.0, 90.0, 180.0, 270.0].contains(&n) => n as u16,
                    _ => return Err(fail("FACE_UV_ROTATION_UNSUPPORTED")),
                },
            };
            if previous != *rotation {
                if *rotation == 0 {
                    data.remove("rotation");
                } else {
                    data.insert("rotation".into(), json!(rotation));
                }
                // Manual face rotation, like manual face coordinates, leaves
                // Auto UV mode without recalculating unrelated face mapping.
                if auto_uv != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUv { uuid, face, uv } => {
            if !FACE_NAMES.contains(&face.as_str()) || !valid_uv(uv) {
                return Err(fail("FACE_UV_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            // Blockbench's manual face-UV editing disables Auto UV for the
            // edited Cube. Keep this transition in the same Rust transaction.
            let previous = face_uv(cube, face)?;
            if previous != *uv {
                let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                    .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
                data.insert("uv".into(), json!(uv));
                if cube_auto_uv(cube)? != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
    }
}
