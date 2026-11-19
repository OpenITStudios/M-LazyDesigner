//! P0: source-guarded semantic material candidate for one selected Cube face.
//! This proposes a bounded existing Rust Paint plan; it does not infer an
//! approved reference, real light, curvature, AO or artistic quality.
//! No second bitmap owner: Rust EditorSession performs disposable preflight.
use super::{
    correction_scope::{CorrectionRectangle, ExpectedBeforePixel},
    face_regions, face_uv, material_face, paint, uv_sharing, EditOperation,
    EditPlan, EditorSession, CubeFaceRegionPaintPatch, TextureCorrectionScope,
    MAX_PLAN_BYTES, Result, FACE_NAMES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_FACE_SIDE: u32 = 32;
const MAX_FACE_AREA: u32 = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticMaterialKind { PaintedMetal }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticLightCorner { UpperLeft, UpperRight }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticContrast { Subtle, Balanced }

/// No pixel paths/rectangles from the AI. Exact colors and protected areas
/// must originate in the current user/reviewer-approved source, not a name.
/// A reference SHA is an untrusted declaration until the host independently
/// binds the actual source image; planning grants NO Apply permission.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticMaterialIntent {
    pub expected_revision: u64,
    pub reference_png_sha256: String,
    pub cube_uuid: String,
    pub texture_uuid: String,
    pub face: String,
    pub material: SemanticMaterialKind,
    pub light_corner: SemanticLightCorner,
    pub contrast: SemanticContrast,
    pub source_base_rgba: [u8;4],
    pub shadow_rgb: [u8;3],
    pub highlight_rgb: [u8;3],
    #[serde(default)]
    pub protected_regions: Vec<CorrectionRectangle>,
    #[serde(default)]
    pub expected_before_pixels: Vec<ExpectedBeforePixel>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemanticMaterialProposal {
    pub plan: EditPlan,
    pub preflight: Value,
    pub material_evidence: Value,
}

fn valid_sha(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn luminance(rgb: [u8;3]) -> f64 {
    let linear = rgb.map(|v| {
        let c = f64::from(v)/255.0;
        if c <= 0.04045 { c/12.92 } else { ((c+0.055)/1.055).powf(2.4) }
    });
    linear[0]*0.2126 + linear[1]*0.7152 + linear[2]*0.0722
}
fn is_source_base(bytes: &[u8], atlas_width: u32, at: [u32;2], rgba: [u8;4]) -> bool {
    let i=((at[1] as usize)*(atlas_width as usize)+(at[0] as usize))*4;
    bytes.get(i..i+4).is_some_and(|pixels| pixels == rgba.as_slice())
}
/// Read-only compiler, using exact supported face-local UV transformation
/// and a sampled original RGBA. The wedges are only conservative candidate
/// form masses. They must not be interpreted as artist-approved shading.
pub(super) fn compile(
    session: &EditorSession, request: &SemanticMaterialIntent,
) -> Result<SemanticMaterialProposal> {
    session.check_revision(request.expected_revision)?;
    if serde_json::to_vec(request)
        .map_err(|_| "SEMANTIC_MATERIAL_INPUT_INVALID".to_owned())?.len() > MAX_PLAN_BYTES {
        return Err("SEMANTIC_MATERIAL_INPUT_TOO_LARGE".into());
    }
    if !valid_sha(&request.reference_png_sha256) ||
       request.cube_uuid.is_empty() || request.cube_uuid.len()>128 ||
       request.texture_uuid.is_empty() || request.texture_uuid.len()>128 ||
       !FACE_NAMES.contains(&request.face.as_str()) ||
       request.cube_uuid.chars().any(|c|c.is_whitespace()||c.is_control()) ||
       request.texture_uuid.chars().any(|c|c.is_whitespace()||c.is_control()) {
        return Err("SEMANTIC_MATERIAL_IDENTITY_INVALID".into());
    }
    if request.source_base_rgba[3] != 255 {
        return Err("SEMANTIC_MATERIAL_OPAQUE_BASE_REQUIRED".into());
    }
    let base=[
        request.source_base_rgba[0],
        request.source_base_rgba[1],
        request.source_base_rgba[2],
    ];
    if !(luminance(request.shadow_rgb)<luminance(base) &&
         luminance(base)<luminance(request.highlight_rgb)) {
        return Err("SEMANTIC_MATERIAL_SHADE_RAMP_INVALID".into());
    }
    let doc=session.document();
    let cube=doc.cubes.iter().find(|c|c.uuid==request.cube_uuid)
        .ok_or_else(||"SEMANTIC_MATERIAL_CUBE_NOT_FOUND".to_string())?;
    let texture_index=doc.texture_assets.iter().position(|t|
        t.get("uuid").and_then(Value::as_str)==Some(request.texture_uuid.as_str()))
        .ok_or_else(||"SEMANTIC_MATERIAL_TEXTURE_NOT_FOUND".to_string())?;
    let texture=&doc.texture_assets[texture_index];
    if !paint::editable(texture) {
        return Err("SEMANTIC_MATERIAL_TEXTURE_NOT_EDITABLE".into());
    }
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"SEMANTIC_MATERIAL_UV_UNSUPPORTED".to_string())?;
    let surface=projected.faces.get(&request.face).and_then(Value::as_object)
        .ok_or_else(||"SEMANTIC_MATERIAL_FACE_NOT_FOUND".to_string())?;
    let rotation=face_regions::face_region_rotation(surface)
        .map_err(|_|"SEMANTIC_MATERIAL_UV_UNSUPPORTED".to_string())?;
    let uv=face_uv(&projected,&request.face)
        .map_err(|_|"SEMANTIC_MATERIAL_UV_UNSUPPORTED".to_string())?;
    let (from,to)=paint::uv_pixel_rectangle(
        doc.resolution.width,doc.resolution.height,uv)
        .map_err(|_|"SEMANTIC_MATERIAL_UV_UNSUPPORTED".to_string())?;
    // For P0 restrict to one actually supportable face, fail closed for
    // high-resolution/broad painting rather than discretizing it blindly.
    let mut size=[to[0]-from[0],to[1]-from[1]];
    if rotation==90 || rotation==270 { size.swap(0,1); }
    let [width,height]=size;
    if width<4 || height<4 || width>MAX_FACE_SIDE ||
       height>MAX_FACE_SIDE || width*height>MAX_FACE_AREA {
        return Err("SEMANTIC_MATERIAL_FACE_SIZE_UNSUPPORTED".into());
    }
    let binding=material_face::inspect_material_face_patch(
        doc,&request.texture_uuid,&request.cube_uuid,&request.face,
        &super::MaterialPatchRegion{from,to}
    )?;
    if binding["surface_form"]["uv_orientation_status"]!="SOURCE_UV_FACE_LOCAL" {
        return Err("SEMANTIC_MATERIAL_FORM_UNRESOLVED".into());
    }
    let rgba=paint::decode_for_uv_inspection(
        texture,doc.resolution.width,doc.resolution.height)
        .map_err(|_|"SEMANTIC_MATERIAL_SOURCE_BITMAP_UNSUPPORTED".to_string())?;
    // Edges are chosen according to an explicit *face-local* direction
    // provided by the approved reference workflow, not a guessed world sun.
    let rows=(match request.contrast {
        SemanticContrast::Subtle => (height+5)/6,
        SemanticContrast::Balanced => (height+3)/4,
    }).clamp(1,5).min((height-1)/2);
    let span=(match request.contrast {
        SemanticContrast::Subtle => (width+3)/4,
        SemanticContrast::Balanced => (width+2)/3,
    }).clamp(1,6).min(width-1);
    let mut cells:Vec<(u32,u32,[u8;4])>=Vec::new();
    let mut light_pixels=0usize;
    let mut shadow_pixels=0usize;
    for step in 0..rows {
        // Non-rectangular, tapering corner masses preserve a large quiet
        // central face. Never fill full-width material bands/noise.
        let light_width=((span*(rows-step)+rows-1)/rows).max(1);
        let shadow_width=((span*(step+1)+rows-1)/rows).max(1);
        for (y,amount,is_light) in [
            (step,light_width,true),
            (height-rows+step,shadow_width,false)
        ] {
            for k in 0..amount {
                let x=match (&request.light_corner,is_light) {
                    (SemanticLightCorner::UpperLeft,true) |
                    (SemanticLightCorner::UpperRight,false) => k,
                    _ => width-1-k,
                };
                let (a,b)=face_regions::face_local_pixel_rectangle(
                    doc.resolution.width,doc.resolution.height,
                    uv,rotation,[x,y],[x+1,y+1]
                ).map_err(|_|"SEMANTIC_MATERIAL_UV_UNSUPPORTED".to_string())?;
                if b!=[a[0]+1,a[1]+1] {
                    return Err("SEMANTIC_MATERIAL_UV_UNSUPPORTED".into());
                }
                if !is_source_base(&rgba,doc.resolution.width,a,request.source_base_rgba){
                    continue; // Non-base detail and transparent pixels unchanged
                }
                let rgb=if is_light{request.highlight_rgb}else{request.shadow_rgb};
                if is_light{light_pixels+=1;}else{shadow_pixels+=1;}
                cells.push((y,x,[rgb[0],rgb[1],rgb[2],255]));
            }
        }
    }
    if light_pixels==0 || shadow_pixels==0 {
        return Err("SEMANTIC_MATERIAL_SOURCE_BASE_UNAVAILABLE".into());
    }
    cells.sort_by_key(|(y,x,_)|(*y,*x));
    let mut regions:Vec<CubeFaceRegionPaintPatch>=Vec::new();
    for (y,x,color) in cells {
        let tail=regions.last_mut();
        if let Some(last)=tail {
            if last.from[1]==y && last.to[0]==x && last.rgba==color {
                last.to[0]=x+1;
                continue;
            }
        }
        regions.push(CubeFaceRegionPaintPatch{
            face:request.face.clone(),from:[x,y],to:[x+1,y],
            rgba:color,erase:false,
        });
        if regions.len()>face_regions::MAX_FACE_REGIONS {
            return Err("SEMANTIC_MATERIAL_REGION_BUDGET_EXCEEDED".into());
        }
    }
    let scope=TextureCorrectionScope{
        texture_uuid:request.texture_uuid.clone(),
        allowed_regions:vec![CorrectionRectangle{from,to}],
        preserve_alpha:true,
        protected_regions:request.protected_regions.clone(),
        expected_before_pixels:request.expected_before_pixels.clone(),
        editable_before_rgba:vec![request.source_base_rgba],
    };
    let plan=EditPlan{
        expected_revision:request.expected_revision,
        operations:vec![EditOperation::PaintCubeFaceRegionsGuarded{
            cube_uuid:request.cube_uuid.clone(),
            texture_uuid:request.texture_uuid.clone(), regions,
        }],
        correction_scope:Some(scope),
    };
    // Native Rust is the sole owner of actual write/UV/source preconditions.
    // A successful preflight gives a candidate SHA, NEVER image review.
    let preflight=session.preflight(&plan)?;
    let material_evidence=json!({
        "scope":"source_selected_face_semantic_metal_candidate",
        "material":"painted_metal",
        "cube_uuid":request.cube_uuid,"texture_uuid":request.texture_uuid,
        "face":request.face,"face_local_size":size,
        "selected_source_base_rgba":request.source_base_rgba,
        "candidate_pixels":light_pixels+shadow_pixels,
        "light_pixels":light_pixels,"shadow_pixels":shadow_pixels,
        "mask_strategy":"face_local_tapered_opposed_edge_masses",
        "untouched_non_base_pixels":"preserved_by_exact_original_rgba",
        "source_form":binding["surface_form"],
        "reference_png_sha256":request.reference_png_sha256,
        "reference_authority":"NOT_VERIFIED_BY_RUST",
        "style_quality":"NOT_EVALUATED",
        "rendered_model_review":"REQUIRED",
        "visual_verdict":"UNVERIFIED",
        "write_authority":"NOT_GRANTED",
    });
    Ok(SemanticMaterialProposal{plan,preflight,material_evidence})
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{AuthoringDocument, EditorSession};
    const TEX:&str="00000000-0000-4000-8000-000000000101";
    const CUBE:&str="00000000-0000-4000-8000-000000000002";
    fn doc()->AuthoringDocument{
        let mut d=AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        d.texture_assets[0]=paint::create(TEX,"metal.png",64,32).unwrap();
        paint::rectangle(&mut d.texture_assets[0],64,32,
            [1,2],[4,5],[90,110,130,255],false).unwrap();
        d.validate().unwrap();
        d
    }
    fn intent()->SemanticMaterialIntent {
        SemanticMaterialIntent{
            expected_revision:0,reference_png_sha256:"b".repeat(64),
            cube_uuid:CUBE.into(),texture_uuid:TEX.into(),face:"north".into(),
            material:SemanticMaterialKind::PaintedMetal,
            light_corner:SemanticLightCorner::UpperLeft,
            contrast:SemanticContrast::Balanced,
            source_base_rgba:[90,110,130,255],
            shadow_rgb:[52,62,80],highlight_rgb:[160,175,195],
            protected_regions:vec![],expected_before_pixels:vec![],
        }
    }
    #[test]
    fn semantic_painted_metal_compiles_without_user_pixel_paths_or_source_mutation(){
        let mut s=EditorSession::from_document(doc()).unwrap();
        let before=s.export().unwrap();
        let proposed=compile(&s,&intent()).unwrap();
        assert_eq!(s.export().unwrap(),before);
        assert_eq!(proposed.plan.operations.len(),1);
        assert_eq!(proposed.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposed.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposed.material_evidence["reference_authority"],"NOT_VERIFIED_BY_RUST");
        assert_eq!(proposed.material_evidence["visual_verdict"],"UNVERIFIED");
        assert_eq!(proposed.plan.correction_scope.as_ref().unwrap().editable_before_rgba,
            vec![[90,110,130,255]]);
        let receipt=s.apply_with_correction_scope(
            0,&proposed.plan.operations,proposed.plan.correction_scope.as_ref()).unwrap();
        assert_eq!(receipt.revision,1);
        assert_ne!(s.export().unwrap(),before);
        s.undo(1).unwrap();
        assert_eq!(s.export().unwrap(),before);
    }
    #[test]
    fn original_non_base_identity_pixels_are_not_painted(){
        let mut d=doc();
        paint::pixel(&mut d.texture_assets[0],64,32,1,5,[220,25,20,255]).unwrap();
        let source=paint::decode_for_uv_inspection(&d.texture_assets[0],64,32).unwrap();
        let s=EditorSession::from_document(d).unwrap();
        let plan=compile(&s,&intent()).unwrap();
        let mut painted=EditorSession::from_document(s.document().clone()).unwrap();
        painted.apply_with_correction_scope(
            0,&plan.plan.operations,plan.plan.correction_scope.as_ref()).unwrap();
        let output=paint::decode_for_uv_inspection(&painted.document().texture_assets[0],64,32).unwrap();
        let offset=(5usize*64+1)*4;
        assert_eq!(&output[offset..offset+4],&source[offset..offset+4]);
        assert_eq!(&output[offset..offset+4],&[220,25,20,255]);
    }
    #[test]
    fn refuses_shared_uv_missing_source_and_unapproved_shade_ramps(){
        let s=EditorSession::from_document(doc()).unwrap();
        let mut wrong=intent();
        wrong.source_base_rgba=[3,4,5,255];
        assert_eq!(compile(&s,&wrong).unwrap_err(),"SEMANTIC_MATERIAL_SOURCE_BASE_UNAVAILABLE");
        wrong=intent();wrong.shadow_rgb=[250,250,250];
        assert_eq!(compile(&s,&wrong).unwrap_err(),"SEMANTIC_MATERIAL_SHADE_RAMP_INVALID");
        wrong=intent();wrong.expected_revision=1;
        assert_eq!(compile(&s,&wrong).unwrap_err(),"DOCUMENT_REVISION_STALE");
        wrong=intent();wrong.face="south".into();
        assert_eq!(compile(&s,&wrong).unwrap_err(),"MATERIAL_FACE_TEXTURE_NOT_EXPLICIT");
        let mut shared=doc();
        shared.cubes[0].faces.get_mut("east").unwrap().as_object_mut().unwrap()
            .insert("uv".into(),json!([1,2,5,6]));
        let shared=EditorSession::from_document(shared).unwrap();
        assert_eq!(compile(&shared,&intent()).unwrap_err(),"MATERIAL_FACE_PATCH_UV_SHARED");
    }
    #[test]
    fn protected_original_region_cannot_be_changed_by_preflight(){
        let doc=doc();
        let selected=doc.cubes.iter().find(|c|c.uuid==CUBE).unwrap();
        let projection=uv_sharing::project_supported_uv(&doc,selected).unwrap();
        let uv=face_uv(&projection,"north").unwrap();
        let rotation=face_regions::face_region_rotation(
            projection.faces["north"].as_object().unwrap()).unwrap();
        let (from,to)=face_regions::face_local_pixel_rectangle(
            64,32,uv,rotation,[0,0],[1,1]).unwrap();
        let mut i=intent();
        i.protected_regions.push(CorrectionRectangle{from,to});
        let s=EditorSession::from_document(doc).unwrap();
        assert!(compile(&s,&i).is_err());
    }
}
