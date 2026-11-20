//! Typed geometry EditOperation handling.
//! Rust EditorSession in authoring/mod.rs remains the only transaction/Undo owner.
//! Branch bodies are preserved from the original complete dispatcher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn apply(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
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
        _ => Err(fail("EDIT_OPERATION_DOMAIN_MISMATCH")),
    }
}
