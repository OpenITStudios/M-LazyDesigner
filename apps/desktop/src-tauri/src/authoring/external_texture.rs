//! Guarded external PNG edit of an EXISTING, unshared Cube face.
//! No external process control, new texture, new bitmap owner or art verdict.
use super::{
    correction_scope::{CorrectionRectangle, ExpectedBeforePixel, TextureCorrectionScope},
    material_face, uv_sharing, paint, AuthoringDocument, EditOperation,
    EditorSession, MutationReceipt, Result, FACE_NAMES,
};
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExternalFaceTextureIntent {
    pub expected_revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    pub source_base_rgba:[u8;4],
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
    #[serde(default)]
    pub expected_before_pixels:Vec<ExpectedBeforePixel>,
}

fn checked_face(
    doc:&AuthoringDocument,intent:&ExternalFaceTextureIntent,
)->Result<CorrectionRectangle>{
    if intent.source_base_rgba[3]!=255 ||
       !super::valid_uuid(&intent.texture_uuid) ||
       !super::valid_uuid(&intent.cube_uuid) ||
       !FACE_NAMES.contains(&intent.face.as_str()) {
        return Err("EXTERNAL_TEXTURE_INTENT_INVALID".into());
    }
    let cube=doc.cubes.iter().find(|c|c.uuid==intent.cube_uuid)
        .ok_or_else(||"EXTERNAL_TEXTURE_CUBE_UNKNOWN".to_owned())?;
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"EXTERNAL_TEXTURE_UV_UNSUPPORTED".to_owned())?;
    let (from,to)=uv_sharing::rectangle(doc,&projected,&intent.face)
        .map_err(|_|"EXTERNAL_TEXTURE_UV_UNSUPPORTED".to_owned())?;
    let region=CorrectionRectangle{from,to};
    material_face::inspect_material_face_patch(
        doc,&intent.texture_uuid,&intent.cube_uuid,&intent.face,
        &super::MaterialPatchRegion{from,to},
    )?;
    let found=doc.texture_assets.iter().find(|t|
        t.get("uuid").and_then(serde_json::Value::as_str)==
            Some(intent.texture_uuid.as_str())
    ).ok_or_else(||"EXTERNAL_TEXTURE_UNKNOWN".to_owned())?;
    if !paint::editable(found) {
        return Err("EXTERNAL_TEXTURE_NOT_OWNED".into());
    }
    Ok(region)
}

/// Common source/geometry admission for UI preview, direct user Apply,
/// and (if available) another explicitly authorized local host.
pub(super) fn apply(
    session:&mut EditorSession,intent:&ExternalFaceTextureIntent,
    candidate_png_source:&str,
)->Result<MutationReceipt>{
    session.check_revision(intent.expected_revision)?;
    let face=checked_face(session.document(),intent)?;
    let scope=TextureCorrectionScope{
        texture_uuid:intent.texture_uuid.clone(),
        allowed_regions:vec![face],
        preserve_alpha:true,
        protected_regions:intent.protected_regions.clone(),
        expected_before_pixels:intent.expected_before_pixels.clone(),
        editable_before_rgba:vec![intent.source_base_rgba],
    };
    session.apply_with_correction_scope(intent.expected_revision,&[
        EditOperation::ReplaceExistingFaceTextureGuarded{
            intent:intent.clone(),candidate_png_source:candidate_png_source.to_owned(),
        }
    ],Some(&scope))
}

/// Also protects direct raw EditOperation callers, even when they omit
/// a correction scope. Never trust client coordinates or PNG type metadata.
pub(super) fn apply_operation(
    doc:&mut AuthoringDocument,intent:&ExternalFaceTextureIntent,
    source:&str,
)->Result<String>{
    let rect=checked_face(doc,intent)?;
    let (width,height)=(doc.resolution.width,doc.resolution.height);
    let index=doc.texture_assets.iter().position(|t|
        t.get("uuid").and_then(serde_json::Value::as_str)==
            Some(intent.texture_uuid.as_str())
    ).ok_or_else(||"EXTERNAL_TEXTURE_UNKNOWN".to_owned())?;
    paint::replace_face_from_png_guarded(
        &mut doc.texture_assets[index],width,height,source,
        intent.source_base_rgba,rect.from,rect.to,
    )?;
    Ok(intent.texture_uuid.clone())
}
