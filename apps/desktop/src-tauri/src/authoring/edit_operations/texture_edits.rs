//! Typed texture EditOperation handling.
//! Rust EditorSession in authoring/mod.rs remains the only transaction/Undo owner.
//! Branch bodies are preserved from the original complete dispatcher.
//! SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn apply(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
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
        _ => Err(fail("EDIT_OPERATION_DOMAIN_MISMATCH")),
    }
}
