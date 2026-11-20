//! Typed uv EditOperation handling.
//! Rust EditorSession in authoring/mod.rs remains the only transaction/Undo owner.
//! Branch bodies are preserved from the original complete dispatcher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn apply(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
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
        _ => Err(fail("EDIT_OPERATION_DOMAIN_MISMATCH")),
    }
}
