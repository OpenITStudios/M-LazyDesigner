//! Exact saved Cube face → physical atlas patch evidence, never art quality.
use super::{AuthoringDocument, FACE_NAMES, Result, uv_sharing};
use super::material_pair::MaterialPatchRegion;
use serde_json::{json, Value};

fn intersects(a0:[u32;2],a1:[u32;2],b0:[u32;2],b1:[u32;2])->bool{
    a0[0]<b1[0] && a1[0]>b0[0] && a0[1]<b1[1] && a1[1]>b0[1]
}

/// Reuses Rust Box/manual UV projection and explicit alias inspection.
/// Unsupported/implicit references are unresolved, never silently accepted.
pub fn inspect_material_face_patch(doc:&AuthoringDocument,
    texture_uuid:&str,cube_uuid:&str,side:&str,patch:&MaterialPatchRegion
)->Result<Value>{
    doc.validate()?;
    if !FACE_NAMES.contains(&side){return Err("MATERIAL_FACE_SIDE_UNKNOWN".into());}
    let width=doc.resolution.width;let height=doc.resolution.height;
    if patch.from[0]>=patch.to[0]||patch.from[1]>=patch.to[1]||
        patch.to[0]>width||patch.to[1]>height {
        return Err("MATERIAL_FACE_PATCH_INVALID".into());
    }
    let mut atlas=doc.texture_assets.iter().enumerate().filter(|(_,t)|
        t.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let index=atlas.next().ok_or_else(||"MATERIAL_FACE_TEXTURE_NOT_FOUND".to_string())?.0;
    if atlas.next().is_some(){return Err("MATERIAL_FACE_TEXTURE_AMBIGUOUS".into());}
    let cube=doc.cubes.iter().find(|c|c.uuid==cube_uuid)
        .ok_or_else(||"MATERIAL_FACE_CUBE_NOT_FOUND".to_string())?;
    let face=cube.faces.get(side).ok_or_else(||"MATERIAL_FACE_MISSING".to_string())?;
    if face.get("enabled").is_some_and(|v|v!=&Value::Bool(true)){
        return Err("MATERIAL_FACE_DISABLED".into());
    }
    let link=match face.get("texture"){
        Some(Value::String(id))=>id==texture_uuid,
        Some(Value::Number(id))=>id.as_u64()==Some(index as u64),
        _=>false,
    };
    if !link{return Err("MATERIAL_FACE_TEXTURE_NOT_EXPLICIT".into());}
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"MATERIAL_FACE_UV_UNSUPPORTED".to_string())?;
    let (uv_from,uv_to)=uv_sharing::rectangle(doc,&projected,side)
        .map_err(|_|"MATERIAL_FACE_UV_UNSUPPORTED".to_string())?;
    if patch.from[0]<uv_from[0]||patch.from[1]<uv_from[1]||
       patch.to[0]>uv_to[0]||patch.to[1]>uv_to[1]{
        return Err("MATERIAL_FACE_PATCH_OUTSIDE_UV".into());
    }
    let share=uv_sharing::inspect_cube_uv_sharing_for_faces(
        doc,cube_uuid,texture_uuid,Some(&[side])
    ).map_err(|_|"MATERIAL_FACE_UV_UNSUPPORTED".to_string())?;
    let count=|key:&str|share[key].as_u64().unwrap_or(u64::MAX);
    if count("focused_mapped_faces")!=1||
       count("unresolved_explicit_faces")!=0||
       count("implicit_reference_faces")!=0||
       share["report_truncated"]!=Value::Bool(false){
        return Err("MATERIAL_FACE_OWNERSHIP_UNRESOLVED".into());
    }
    let overlaps=share["overlaps"].as_array()
        .ok_or_else(||"MATERIAL_FACE_OWNERSHIP_UNRESOLVED".to_string())?;
    for item in overlaps{
        let rect:[u32;4]=serde_json::from_value(item["pixel_rect"].clone())
            .map_err(|_|"MATERIAL_FACE_OWNERSHIP_UNRESOLVED".to_string())?;
        if intersects(patch.from,patch.to,[rect[0],rect[1]],[rect[2],rect[3]]){
            return Err("MATERIAL_FACE_PATCH_UV_SHARED".into());
        }
    }
    Ok(json!({
        "scope":"source_explicit_cube_face_patch",
        "status":"bound_source_only",
        "texture_uuid":texture_uuid,"cube_uuid":cube_uuid,"face":side,
        "sample_region":patch,
        "face_uv_region":{"from":uv_from,"to":uv_to},
        "uv_projection":"native_supported_box_or_manual",
        "texture_reference":"explicit_saved_link",
        "pixel_alias":"no_detected_overlap_for_sample",
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "view_correspondence":"NOT_VERIFIED"
    }))
}
#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    const TEX:&str="00000000-0000-4000-8000-000000000101";
    const OTHER:&str="00000000-0000-4000-8000-000000000102";
    const CUBE:&str="00000000-0000-4000-8000-000000000002";
    fn doc()->AuthoringDocument{AuthoringDocument::import_bbmodel(
        include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")
    ).unwrap()}
    fn region(from:[u32;2],to:[u32;2])->MaterialPatchRegion{
        MaterialPatchRegion{from,to}
    }
    #[test]
    fn binds_exact_saved_face_without_artistic_pass_or_mutation(){
        let d=doc();let original=d.clone();
        let r=inspect_material_face_patch(&d,TEX,CUBE,"north",
            &region([2,3],[4,5])).unwrap();
        assert_eq!(r["status"],json!("bound_source_only"));
        assert_eq!(r["face_uv_region"]["from"],json!([1,2]));
        assert_eq!(r["face_uv_region"]["to"],json!([5,6]));
        assert_eq!(r["visual_verdict"],json!("UNVERIFIED"));
        assert_eq!(d,original);
    }
    #[test]
    fn refuses_bad_reference_outside_sample_and_direction(){
        let d=doc();
        assert_eq!(inspect_material_face_patch(&d,TEX,CUBE,"south",
            &region([1,1],[2,2])).unwrap_err(),"MATERIAL_FACE_TEXTURE_NOT_EXPLICIT");
        assert_eq!(inspect_material_face_patch(&d,OTHER,CUBE,"north",
            &region([2,3],[4,5])).unwrap_err(),"MATERIAL_FACE_TEXTURE_NOT_EXPLICIT");
        assert_eq!(inspect_material_face_patch(&d,TEX,CUBE,"north",
            &region([0,0],[4,4])).unwrap_err(),"MATERIAL_FACE_PATCH_OUTSIDE_UV");
        assert_eq!(inspect_material_face_patch(&d,TEX,CUBE,"north",
            &region([4,3],[4,5])).unwrap_err(),"MATERIAL_FACE_PATCH_INVALID");
        assert_eq!(inspect_material_face_patch(&d,TEX,CUBE,"front",
            &region([2,3],[4,5])).unwrap_err(),"MATERIAL_FACE_SIDE_UNKNOWN");
    }
    #[test]
    fn rejects_shared_or_implicit_face_ownership(){
        let mut overlap=doc();
        overlap.cubes[0].faces.get_mut("east").unwrap().as_object_mut().unwrap()
            .insert("uv".into(),json!([2,3,4,5]));
        assert_eq!(inspect_material_face_patch(&overlap,TEX,CUBE,"north",
            &region([2,3],[4,5])).unwrap_err(),"MATERIAL_FACE_PATCH_UV_SHARED");
        let mut implicit=doc();
        implicit.cubes[0].faces.get_mut("east").unwrap().as_object_mut().unwrap()
            .remove("texture");
        assert_eq!(inspect_material_face_patch(&implicit,TEX,CUBE,"north",
            &region([2,3],[4,5])).unwrap_err(),"MATERIAL_FACE_OWNERSHIP_UNRESOLVED");
    }
}
