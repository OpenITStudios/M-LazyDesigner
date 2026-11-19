//! User-directed 3D surface stroke -> existing authoritative Rust Paint.
//! Input coordinates are face-local texels, NEVER trusted atlas coordinates.
//! A single selected Cube face, exact source-RGBA, 3D UV ownership and optional
//! reviewer protected masks are rechecked before the one Undo transaction.
use super::{
    correction_scope::{CorrectionRectangle,TextureCorrectionScope},
    face_regions, face_uv, material_face, paint, uv_sharing, EditOperation,
    EditorSession, MaterialPatchRegion, MutationReceipt, Result, FACE_NAMES,
    MAX_PLAN_BYTES,
};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfacePaintIntent {
    pub expected_revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    /// Previewed source Cube UV binding. A stale or normalized Box UV view
    /// MUST NOT silently paint a different physical atlas cell.
    pub expected_face_uv:[f64;4],
    pub expected_face_rotation:u16,
    /// Explicit original opaque swatch, never inferred from a material name.
    pub source_base_rgba:[u8;4],
    /// One opaque pixel color per native face-local texel.
    pub paint_rgba:[u8;4],
    /// Up to 4096 source face-local points in one 3D pointer gesture.
    pub points:Vec<[u32;2]>,
    /// Reviewer-declared physical atlas masks, including same-RGBA identity.
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
}
pub(super) fn apply(
    session:&mut EditorSession,intent:&SurfacePaintIntent,
)->Result<MutationReceipt>{
    session.check_revision(intent.expected_revision)?;
    if intent.source_base_rgba[3]!=255 || intent.paint_rgba[3]!=255 ||
       !super::valid_uuid(&intent.cube_uuid) ||
       !super::valid_uuid(&intent.texture_uuid) ||
       !FACE_NAMES.contains(&intent.face.as_str()) ||
       intent.points.is_empty() || intent.points.len()>paint::MAX_STROKE_POINTS ||
       intent.protected_regions.len()>16 ||
       serde_json::to_vec(intent)
           .is_err_or(|data|data.len()>MAX_PLAN_BYTES) {
        return Err("SURFACE_PAINT_INTENT_INVALID".into());
    }
    let doc=session.document();
    if super::has_per_texture_uv_rules(doc) {
        return Err("SURFACE_PAINT_UV_RULESET_UNSUPPORTED".into());
    }
    let (width,height)=(doc.resolution.width,doc.resolution.height);
    let mut textures=doc.texture_assets.iter().enumerate().filter(|(_,item)|
        item.get("uuid").and_then(Value::as_str)==Some(intent.texture_uuid.as_str()));
    let (index,texture)=textures.next()
        .ok_or_else(||"SURFACE_PAINT_TEXTURE_NOT_FOUND".to_string())?;
    if textures.next().is_some() || !paint::editable(texture) {
        return Err("SURFACE_PAINT_TEXTURE_UNSUPPORTED".into());
    }
    let cube=doc.cubes.iter().find(|c|c.uuid==intent.cube_uuid)
        .ok_or_else(||"SURFACE_PAINT_CUBE_NOT_FOUND".to_string())?;
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"SURFACE_PAINT_UV_UNSUPPORTED".to_string())?;
    let (from,to)=uv_sharing::rectangle(doc,&projected,&intent.face)
        .map_err(|_|"SURFACE_PAINT_UV_UNSUPPORTED".to_string())?;
    // One strict read-only face admission; refuse any alias or implicit
    // texture binding on the whole selected face, not only sampled points.
    material_face::inspect_material_face_patch(doc,
        &intent.texture_uuid,&intent.cube_uuid,&intent.face,
        &MaterialPatchRegion{from,to})?;
    let surface=projected.faces.get(&intent.face)
        .and_then(Value::as_object)
        .ok_or_else(||"SURFACE_PAINT_FACE_UNSUPPORTED".to_string())?;
    let rotation=face_regions::face_region_rotation(surface)?;
    let uv=face_uv(&projected,&intent.face)?;
    if uv!=intent.expected_face_uv || rotation!=intent.expected_face_rotation {
        return Err("SURFACE_PAINT_VIEW_UV_STALE".into());
    }
    let original=paint::decode_for_uv_inspection(texture,width,height)?;
    let mut seen=HashSet::new();
    let mut points=Vec::with_capacity(intent.points.len());
    for &local in &intent.points {
        let next=[local[0].checked_add(1)
            .ok_or_else(||"SURFACE_PAINT_TEXEL_INVALID".to_string())?,
            local[1].checked_add(1)
                .ok_or_else(||"SURFACE_PAINT_TEXEL_INVALID".to_string())?];
        let (a,b)=face_regions::face_local_pixel_rectangle(
            width,height,uv,rotation,local,next)?;
        if b[0]!=a[0]+1 || b[1]!=a[1]+1 {
            return Err("SURFACE_PAINT_TEXEL_INVALID".into());
        }
        if !seen.insert(a) {continue;}
        let inside=|x:u32,y:u32|intent.protected_regions.iter().any(|region|
            x>=region.from[0] && x<region.to[0] &&
            y>=region.from[1] && y<region.to[1]);
        let start=((a[1] as usize)*width as usize+a[0] as usize)*4;
        if original.get(start..start+4)!=Some(intent.source_base_rgba.as_slice()) ||
           inside(a[0],a[1]) {
            continue;
        }
        // Adjacent non-base markings are immutable: do not even paint the
        // one-texel immediate margin. Same-color marks require user masks.
        let mut close_to_detail=false;
        for y in a[1].saturating_sub(1).max(from[1])..=(a[1]+1).min(to[1]-1) {
            for x in a[0].saturating_sub(1).max(from[0])..=(a[0]+1).min(to[0]-1) {
                let at=((y as usize)*width as usize+x as usize)*4;
                if original.get(at..at+4)!=Some(intent.source_base_rgba.as_slice()) {
                    close_to_detail=true;
                    break;
                }
            }
            if close_to_detail {break;}
        }
        if !close_to_detail {points.push(a);}
    }
    if points.is_empty() {
        return Err("SURFACE_PAINT_NO_EDITABLE_PIXELS".into());
    }
    let scope=TextureCorrectionScope{
        texture_uuid:intent.texture_uuid.clone(),
        allowed_regions:vec![CorrectionRectangle{from,to}],
        preserve_alpha:true,
        protected_regions:intent.protected_regions.clone(),
        expected_before_pixels:Vec::new(),
        editable_before_rgba:vec![intent.source_base_rgba],
    };
    // Existing PaintTextureStroke decodes/encodes once, validates the source,
    // and publishes exactly one native Undo step after correction-scope check.
    session.apply_with_correction_scope(intent.expected_revision,&[
        EditOperation::PaintTextureStroke{
            texture_index:index,points,rgba:intent.paint_rgba,
        },
    ],Some(&scope))
}

#[cfg(test)]
mod tests{
    use super::*;
    const TEX:&str="00000000-0000-4000-8000-000000002201";
    const CUBE:&str="00000000-0000-4000-8000-000000000002";
    fn session()->EditorSession {
        let mut s=EditorSession::open(
            include_str!("../../fixtures/bedrock-basic.bbmodel").as_bytes(),
        ).unwrap();
        let mut ops=vec![
            EditOperation::CreatePaintTexture{uuid:TEX.into(),name:"atlas.png".into()},
            EditOperation::AssignCubeTexture{cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
        ];
        for (face,x) in [("north",0),("east",4),("south",8),
                        ("west",12),("up",16),("down",20)]{
            ops.push(EditOperation::SetFaceUv{uuid:CUBE.into(),
                face:face.into(),uv:[x as f64,0.0,(x+4) as f64,4.0]});
        }
        s.apply(0,&ops).unwrap();
        s.apply(1,&[
            EditOperation::PaintTextureRectangle{
                texture_index:0,from:[0,0],to:[3,3],
                rgba:[80,100,120,255],erase:false,
            },
            EditOperation::PaintTexturePixel{
                texture_index:0,x:3,y:3,rgba:[220,25,30,255],
            },
        ]).unwrap();
        s
    }
    fn intent()->SurfacePaintIntent{
        SurfacePaintIntent{
            expected_revision:2,cube_uuid:CUBE.into(),texture_uuid:TEX.into(),
            face:"north".into(),
            expected_face_uv:[0.0,0.0,4.0,4.0],
            expected_face_rotation:0,
            source_base_rgba:[80,100,120,255],
            paint_rgba:[140,150,160,255],
            points:vec![[0,0],[1,1],[2,2],[3,3]],
            protected_regions:vec![CorrectionRectangle{
                from:[1,1],to:[2,2],
            }],
        }
    }
    #[test]
    fn guarded_surface_stroke_skips_markings_and_preserves_undo(){
        let mut s=session();
        let original=s.export().unwrap();
        let receipt=s.apply_surface_paint_stroke(&intent()).unwrap();
        assert_eq!(receipt.revision,3);
        let data=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        let pixel=|x:usize,y:usize| -> [u8;4] {
            data[(y*128+x)*4..(y*128+x)*4+4].try_into().unwrap()
        };
        assert_eq!(pixel(0,0),[140,150,160,255]);
        assert_eq!(pixel(1,1),[80,100,120,255]); // same-color identity mask
        assert_eq!(pixel(2,2),[80,100,120,255]); // near red source landmark
        assert_eq!(pixel(3,3),[220,25,30,255]);  // distinct approved detail
        assert_eq!(s.document().texture_assets.len(),1);
        s.undo(3).unwrap();
        assert_eq!(s.export().unwrap(),original);
    }
    #[test]
    fn rotated_face_projects_one_pixel_into_the_correct_existing_atlas(){
        let mut s=session();
        s.apply(2,&[EditOperation::SetFaceUvRotation{
            uuid:CUBE.into(),face:"north".into(),rotation:90,
        }]).unwrap();
        let mut request=intent();
        request.expected_revision=3;
        request.expected_face_rotation=90;
        request.points=vec![[0,0]];
        request.protected_regions=vec![];
        let before=s.export().unwrap();
        s.apply_surface_paint_stroke(&request).unwrap();
        let bytes=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        // North UV [0..4,0..4], rotated 90 => local [0,0]
        // is physical atlas [0,3]. No adjacent red detail lies here.
        assert_eq!(&bytes[(3*128)*4..(3*128)*4+4],
            &[140,150,160,255]);
        s.undo(4).unwrap();
        assert_eq!(s.export().unwrap(),before);
    }
    #[test]
    fn protected_same_rgba_and_unshared_alias_guards_fail_closed(){
        let mut s=session();
        let original=s.export().unwrap();
        let mut only_protected=intent();
        only_protected.points=vec![[1,1]];
        assert_eq!(s.apply_surface_paint_stroke(&only_protected).unwrap_err(),
            "SURFACE_PAINT_NO_EDITABLE_PIXELS");
        assert_eq!(s.export().unwrap(),original);
        let mut wrong_face=intent();
        wrong_face.face="invalid".into();
        assert_eq!(s.apply_surface_paint_stroke(&wrong_face).unwrap_err(),
            "SURFACE_PAINT_INTENT_INVALID");
        assert_eq!(s.export().unwrap(),original);
    }

    #[test]
    fn source_and_uv_refusals_leave_original_unchanged(){
        let mut s=session();
        let original=s.export().unwrap();
        let mut stale=intent();
        stale.expected_revision=1;
        assert!(s.apply_surface_paint_stroke(&stale).is_err());
        let mut stale_uv=intent();
        stale_uv.expected_face_uv=[4.0,4.0,0.0,0.0];
        assert_eq!(s.apply_surface_paint_stroke(&stale_uv).unwrap_err(),
            "SURFACE_PAINT_VIEW_UV_STALE");
        let mut alpha=intent();
        alpha.paint_rgba[3]=0;
        assert_eq!(s.apply_surface_paint_stroke(&alpha).unwrap_err(),
            "SURFACE_PAINT_INTENT_INVALID");
        let mut bounds=intent();
        bounds.points=vec![[55,55]];
        assert!(s.apply_surface_paint_stroke(&bounds).is_err());
        let mut no_source=intent();
        no_source.source_base_rgba=[255,255,255,255];
        assert_eq!(s.apply_surface_paint_stroke(&no_source).unwrap_err(),
            "SURFACE_PAINT_NO_EDITABLE_PIXELS");
        assert_eq!(s.export().unwrap(),original);
        s.apply(2,&[EditOperation::SetFaceUv{uuid:CUBE.into(),
            face:"east".into(),uv:[0.0,0.0,4.0,4.0]}]).unwrap();
        let mut overlapping=intent();overlapping.expected_revision=3;
        assert!(s.apply_surface_paint_stroke(&overlapping).is_err());
    }
}
