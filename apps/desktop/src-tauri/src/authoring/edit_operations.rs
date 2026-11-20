//! Canonical EditOperation dispatcher for a provisional Rust authoring document.
//! EditorSession in mod.rs remains the sole transaction/revision/history owner.
//! Moved from mod.rs without changing mutation semantics. SOURCE_ONLY.
use super::*;
mod hierarchy_edits;
mod geometry_edits;
mod animation_edits;
mod texture_edits;
mod uv_edits;

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
        EditOperation::AddBone { .. }
        | EditOperation::AddCube { .. }
        | EditOperation::DuplicateCube { .. }
        | EditOperation::DuplicateBoneSubtree { .. }
        | EditOperation::ReparentNode { .. }
        | EditOperation::RenameNode { .. }
        | EditOperation::RemoveCube { .. }
        | EditOperation::RemoveEmptyBone { .. }
        | EditOperation::SetNodeVisibility { .. }
            => hierarchy_edits::apply(doc, op),
        EditOperation::TranslateCube { .. }
        | EditOperation::ReflectBoneSubtree { .. }
        | EditOperation::TranslateBoneSubtree { .. }
        | EditOperation::SetCubeBounds { .. }
        | EditOperation::ReframeCube { .. }
        | EditOperation::SetBoneRotation { .. }
        | EditOperation::SetBoneOrigin { .. }
        | EditOperation::SetCubeOrigin { .. }
        | EditOperation::SetCubeInflate { .. }
        | EditOperation::SetCubeStretch { .. }
        | EditOperation::SetCubeMirrorUv { .. }
        | EditOperation::ScaleCube { .. }
        | EditOperation::SetCubeRotation { .. }
        | EditOperation::SetVisibleBox { .. }
            => geometry_edits::apply(doc, op),
        EditOperation::DuplicateAnimationClip { .. }
        | EditOperation::AddAnimationTimelineMarker { .. }
        | EditOperation::UpdateAnimationTimelineMarker { .. }
        | EditOperation::RemoveAnimationTimelineMarker { .. }
        | EditOperation::AddAnimationEffectEvent { .. }
        | EditOperation::UpdateAnimationEffectEvent { .. }
        | EditOperation::RemoveAnimationEffectEvent { .. }
        | EditOperation::CreateAnimation { .. }
        | EditOperation::SetAnimationLoopMode { .. }
        | EditOperation::SetAnimationLength { .. }
        | EditOperation::ScaleAnimationTimeline { .. }
        | EditOperation::AddBoneRotationKeyframe { .. }
        | EditOperation::UpdateBoneRotationKeyframe { .. }
        | EditOperation::RemoveBoneRotationKeyframe { .. }
        | EditOperation::AddBoneTransformKeyframe { .. }
        | EditOperation::UpdateBoneTransformKeyframe { .. }
        | EditOperation::SetBoneTransformKeyframeInterpolation { .. }
        | EditOperation::SetBoneTransformKeyframeBezier { .. }
        | EditOperation::RemoveBoneTransformKeyframe { .. }
            => animation_edits::apply(doc, op),
        EditOperation::EnableImportedPaintTexture { .. }
        | EditOperation::ReplaceExistingFaceTextureGuarded { .. }
        | EditOperation::ImportPaintTexture { .. }
        | EditOperation::AssignCubeTexture { .. }
        | EditOperation::AssignCubeFaceTexture { .. }
        | EditOperation::CreatePaintTexture { .. }
        | EditOperation::PaintTexturePixel { .. }
        | EditOperation::PaintTextureStroke { .. }
        | EditOperation::PaintTextureBrush { .. }
        | EditOperation::PaintTextureExactPixels { .. }
        | EditOperation::PaintTextureRectangle { .. }
        | EditOperation::PaintTextureRectangles { .. }
        | EditOperation::RecolorCubeFacesPaletteGuarded { .. }
        | EditOperation::PaintCubeFaceRegionsGuarded { .. }
        | EditOperation::PaintCubeUvFacesGuarded { .. }
        | EditOperation::PaintCubeUvFaces { .. }
        | EditOperation::PaintTextureFill { .. }
            => texture_edits::apply(doc, op),
        EditOperation::SetEmptyAtlasResolution { .. }
        | EditOperation::IsolateCubeBoxUv { .. }
        | EditOperation::SetBoxUvOffset { .. }
        | EditOperation::SetFaceUvRotation { .. }
        | EditOperation::SetFaceUv { .. }
            => uv_edits::apply(doc, op),
    }
}
