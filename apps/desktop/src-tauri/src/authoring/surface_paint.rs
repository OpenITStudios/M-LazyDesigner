//! User-directed 3D surface stroke -> existing authoritative Rust Paint.
//! Input coordinates are face-local texels, NEVER trusted atlas coordinates.
//! A single selected Cube face, exact source-RGBA, 3D UV ownership and optional
//! reviewer protected masks are rechecked before the one Undo transaction.
use super::{
    correction_scope::{CorrectionRectangle,TextureCorrectionScope},
    face_regions, face_uv, material_face, paint, uv_sharing, EditOperation,
    EditorSession, MaterialPatchRegion, MutationReceipt, Result, FACE_NAMES,
    AuthoringDocument, surface_seam,
    MAX_PLAN_BYTES,
};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize,Default)]
#[serde(rename_all="snake_case")]
pub enum SurfaceBrushTip{#[default] Square,Diamond}
fn one_pixel()->u8{1}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfacePaintSampleRequest{
    pub expected_revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    pub expected_face_uv:[f64;4],
    pub expected_face_rotation:u16,
    pub local:[u32;2],
}
#[derive(Debug,Clone,Serialize)]
pub struct SurfaceSourceSample{
    pub revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    pub local:[u32;2],
    pub atlas_at:[u32;2],
    pub rgba:[u8;4],
    pub source_authority:&'static str,
    pub write_authority:&'static str,
    pub visual_verdict:&'static str,
}

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
    /// The artist's hard pixel-tip only; clipping never spills across faces.
    #[serde(default="one_pixel")]
    pub brush_radius:u8,
    #[serde(default)]
    pub brush_tip:SurfaceBrushTip,
    /// Optional second source-verified, coplanar adjacent Cube face.
    #[serde(default)]
    pub seam:Option<surface_seam::SurfaceSeamPatch>,
    /// Reviewer-declared physical atlas masks, including same-RGBA identity.
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
}
struct FaceBinding{
    texture_index:usize,
    from:[u32;2],to:[u32;2],uv:[f64;4],rotation:u16,
    size:[u32;2],width:u32,height:u32,
}
fn admit_face(doc:&AuthoringDocument,cube_uuid:&str,texture_uuid:&str,
    face:&str,expected_uv:[f64;4],expected_rotation:u16)->Result<FaceBinding>{
    if !super::valid_uuid(cube_uuid)||!super::valid_uuid(texture_uuid)||
       !FACE_NAMES.contains(&face){
        return Err("SURFACE_PAINT_FACE_INVALID".into());
    }
    if super::has_per_texture_uv_rules(doc){
        return Err("SURFACE_PAINT_UV_RULESET_UNSUPPORTED".into());
    }
    let (width,height)=(doc.resolution.width,doc.resolution.height);
    let mut textures=doc.texture_assets.iter().enumerate().filter(|(_,item)|
        item.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let (index,texture)=textures.next()
        .ok_or_else(||"SURFACE_PAINT_TEXTURE_NOT_FOUND".to_string())?;
    if textures.next().is_some()||!paint::editable(texture){
        return Err("SURFACE_PAINT_TEXTURE_UNSUPPORTED".into());
    }
    let cube=doc.cubes.iter().find(|c|c.uuid==cube_uuid)
        .ok_or_else(||"SURFACE_PAINT_CUBE_NOT_FOUND".to_string())?;
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"SURFACE_PAINT_UV_UNSUPPORTED".to_string())?;
    let (from,to)=uv_sharing::rectangle(doc,&projected,face)
        .map_err(|_|"SURFACE_PAINT_UV_UNSUPPORTED".to_string())?;
    material_face::inspect_material_face_patch(doc,texture_uuid,cube_uuid,face,
        &MaterialPatchRegion{from,to})?;
    let surface=projected.faces.get(face).and_then(Value::as_object)
        .ok_or_else(||"SURFACE_PAINT_FACE_UNSUPPORTED".to_string())?;
    let rotation=face_regions::face_region_rotation(surface)?;
    let uv=face_uv(&projected,face)?;
    if uv!=expected_uv||rotation!=expected_rotation{
        return Err("SURFACE_PAINT_VIEW_UV_STALE".into());
    }
    let size=if matches!(rotation,90|270){
        [to[1]-from[1],to[0]-from[0]]
    }else{[to[0]-from[0],to[1]-from[1]]};
    Ok(FaceBinding{texture_index:index,from,to,uv,rotation,size,width,height})
}
fn atlas_for_local(face:&FaceBinding,at:[u32;2])->Result<[u32;2]>{
    let next=[at[0].checked_add(1)
            .ok_or_else(||"SURFACE_PAINT_TEXEL_INVALID".to_string())?,
        at[1].checked_add(1)
            .ok_or_else(||"SURFACE_PAINT_TEXEL_INVALID".to_string())?];
    let (a,b)=face_regions::face_local_pixel_rectangle(
        face.width,face.height,face.uv,face.rotation,at,next)?;
    if b[0]!=a[0]+1 || b[1]!=a[1]+1 {
        return Err("SURFACE_PAINT_TEXEL_INVALID".into());
    }
    Ok(a)
}
/// The result is an original saved pixel, including exact transparent RGB.
/// No palette quantization, renderer guess, material approval or file path.
pub(super) fn sample(
    session:&EditorSession,request:&SurfacePaintSampleRequest,
)->Result<SurfaceSourceSample>{
    session.check_revision(request.expected_revision)?;
    let doc=session.document();
    let bound=admit_face(doc,&request.cube_uuid,&request.texture_uuid,
        &request.face,request.expected_face_uv,request.expected_face_rotation)?;
    let atlas=atlas_for_local(&bound,request.local)?;
    let original=paint::decode_for_uv_inspection(
        &doc.texture_assets[bound.texture_index],bound.width,bound.height)?;
    let index=((atlas[1] as usize)*bound.width as usize+
        atlas[0] as usize)*4;
    let rgba=original.get(index..index+4)
        .ok_or_else(||"SURFACE_SAMPLE_PIXEL_MISSING".to_string())?
        .try_into().map_err(|_|"SURFACE_SAMPLE_PIXEL_INVALID".to_string())?;
    Ok(SurfaceSourceSample{
        revision:request.expected_revision,cube_uuid:request.cube_uuid.clone(),
        texture_uuid:request.texture_uuid.clone(),face:request.face.clone(),
        local:request.local,atlas_at:atlas,rgba,
        source_authority:"RUST_SAVED_RGBA8",
        write_authority:"NOT_GRANTED",visual_verdict:"UNVERIFIED",
    })
}
fn gather(
    source:&[u8],face:&FaceBinding,centers:&[[u32;2]],
    base:[u8;4],radius:u8,tip:SurfaceBrushTip,
    protected:&[CorrectionRectangle],
    seen:&mut HashSet<[u32;2]>,out:&mut Vec<[u32;2]>,
)->Result<()>{
    if centers.is_empty()||centers.len()>paint::MAX_STROKE_POINTS{
        return Err("SURFACE_PAINT_POINTS_INVALID".into());
    }
    let around=i64::from(radius-1);
    for &center in centers{
        if center[0]>=face.size[0]||center[1]>=face.size[1] {
            return Err("SURFACE_PAINT_TEXEL_INVALID".into());
        }
        for dy in -around..=around{
            for dx in -around..=around{
                if tip==SurfaceBrushTip::Diamond&&dx.abs()+dy.abs()>around{
                    continue;
                }
                let x=i64::from(center[0])+dx;
                let y=i64::from(center[1])+dy;
                if x<0||y<0||x>=i64::from(face.size[0])||
                   y>=i64::from(face.size[1]){continue;}
                let at=atlas_for_local(face,[x as u32,y as u32])?;
                if !seen.insert(at){continue;}
                let idx=((at[1] as usize)*face.width as usize+
                    at[0] as usize)*4;
                if source.get(idx..idx+4)!=Some(base.as_slice())||
                   protected.iter().any(|r|
                       at[0]>=r.from[0]&&at[0]<r.to[0]&&
                       at[1]>=r.from[1]&&at[1]<r.to[1]){continue;}
                // Identity details get one face-local texel of clearance.
                let mut close=false;
                for ny in at[1].saturating_sub(1).max(face.from[1])
                    ..=(at[1]+1).min(face.to[1]-1){
                    for nx in at[0].saturating_sub(1).max(face.from[0])
                        ..=(at[0]+1).min(face.to[0]-1){
                        let i=((ny as usize)*face.width as usize+
                            nx as usize)*4;
                        if source.get(i..i+4)!=Some(base.as_slice()){
                            close=true;break;
                        }
                    }
                    if close{break;}
                }
                if close{continue;}
                if out.len()>=paint::MAX_STROKE_POINTS{
                    return Err("SURFACE_PAINT_OUTPUT_BUDGET_EXCEEDED".into());
                }
                out.push(at);
            }
        }
    }
    Ok(())
}
pub(super) fn apply(
    session:&mut EditorSession,intent:&SurfacePaintIntent,
)->Result<MutationReceipt>{
    session.check_revision(intent.expected_revision)?;
    if intent.source_base_rgba[3]!=255||intent.paint_rgba[3]!=255||
       !super::valid_uuid(&intent.cube_uuid)||
       !super::valid_uuid(&intent.texture_uuid)||
       !FACE_NAMES.contains(&intent.face.as_str())||
       intent.brush_radius==0||intent.brush_radius>4||
       intent.protected_regions.len()>16||
       intent.points.is_empty()||intent.points.len()>paint::MAX_STROKE_POINTS||
       intent.points.len().saturating_add(
           intent.seam.as_ref().map_or(0,|s|s.points.len()))
           >paint::MAX_STROKE_POINTS||
       serde_json::to_vec(intent)
           .is_err_or(|data|data.len()>MAX_PLAN_BYTES){
        return Err("SURFACE_PAINT_INTENT_INVALID".into());
    }
    let doc=session.document();
    let first=admit_face(doc,&intent.cube_uuid,&intent.texture_uuid,
        &intent.face,intent.expected_face_uv,intent.expected_face_rotation)?;
    let second=intent.seam.as_ref().map(|bridge|{
        surface_seam::validate_pair(doc,&intent.cube_uuid,&intent.face,
            &bridge.cube_uuid,&bridge.face)?;
        let admitted=admit_face(doc,&bridge.cube_uuid,&intent.texture_uuid,
            &bridge.face,bridge.expected_face_uv,bridge.expected_face_rotation)?;
        if admitted.texture_index!=first.texture_index{
            return Err("SURFACE_SEAM_ATLAS_MISMATCH".into());
        }
        Ok(admitted)
    }).transpose()?;
    let rgba=paint::decode_for_uv_inspection(
        &doc.texture_assets[first.texture_index],first.width,first.height)?;
    let mut seen=HashSet::new();
    let mut points=Vec::new();
    gather(&rgba,&first,&intent.points,intent.source_base_rgba,
        intent.brush_radius,intent.brush_tip,&intent.protected_regions,
        &mut seen,&mut points)?;
    if let (Some(bridge),Some(face))=(&intent.seam,&second){
        gather(&rgba,face,&bridge.points,intent.source_base_rgba,
            intent.brush_radius,intent.brush_tip,&intent.protected_regions,
            &mut seen,&mut points)?;
    }
    if points.is_empty(){
        return Err("SURFACE_PAINT_NO_EDITABLE_PIXELS".into());
    }
    let mut allowed=vec![CorrectionRectangle{from:first.from,to:first.to}];
    if let Some(face)=second{
        allowed.push(CorrectionRectangle{from:face.from,to:face.to});
    }
    let scope=TextureCorrectionScope{
        texture_uuid:intent.texture_uuid.clone(),allowed_regions:allowed,
        preserve_alpha:true,protected_regions:intent.protected_regions.clone(),
        expected_before_pixels:Vec::new(),
        editable_before_rgba:vec![intent.source_base_rgba],
    };
    // Native existing Paint writes ONE RGBA8 PNG and ONE Undo version, even
    // for a source-verified two-face seam. Never batch as separate commits.
    session.apply_with_correction_scope(intent.expected_revision,&[
        EditOperation::PaintTextureStroke{
            texture_index:first.texture_index,points,rgba:intent.paint_rgba,
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
            brush_radius:1,brush_tip:SurfaceBrushTip::Square,seam:None,
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
        let mut bad_radius=intent();bad_radius.brush_radius=5;
        assert_eq!(s.apply_surface_paint_stroke(&bad_radius).unwrap_err(),
            "SURFACE_PAINT_INTENT_INVALID");
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
    #[test]
    fn saved_source_sample_is_exact_and_never_mutates_a_model(){
        let s=session();
        let before=s.export().unwrap();
        let request=SurfacePaintSampleRequest{
            expected_revision:2,cube_uuid:CUBE.into(),texture_uuid:TEX.into(),
            face:"north".into(),expected_face_uv:[0.0,0.0,4.0,4.0],
            expected_face_rotation:0,local:[3,3],
        };
        let read=s.sample_surface_source(&request).unwrap();
        assert_eq!(read.rgba,[220,25,30,255]);
        assert_eq!(read.atlas_at,[3,3]);
        assert_eq!(read.write_authority,"NOT_GRANTED");
        assert_eq!(s.export().unwrap(),before);
        let mut stale=request.clone();stale.expected_face_rotation=90;
        assert_eq!(s.sample_surface_source(&stale).unwrap_err(),
            "SURFACE_PAINT_VIEW_UV_STALE");
        let mut stale_revision=request.clone();stale_revision.expected_revision=1;
        assert!(s.sample_surface_source(&stale_revision).is_err());
        let mut transparent=request.clone();transparent.local=[0,2];
        assert_eq!(s.sample_surface_source(&transparent).unwrap().rgba,
            [80,100,120,255]);
        assert_eq!(s.export().unwrap(),before);
    }
    #[test]
    fn square_and_diamond_brush_keep_all_original_detail_pixels(){
        let mut s=session();
        let original=s.export().unwrap();
        let mut request=intent();
        request.brush_radius=2;
        request.brush_tip=SurfaceBrushTip::Diamond;
        request.points=vec![[1,1]];
        request.protected_regions.clear();
        s.apply_surface_paint_stroke(&request).unwrap();
        let data=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        let px=|x:usize,y:usize|{
            let i=(y*128+x)*4;[data[i],data[i+1],data[i+2],data[i+3]]
        };
        assert_eq!(px(1,1),[140,150,160,255]);
        assert_eq!(px(0,0),[80,100,120,255]); // diamond excludes diagonal
        assert_eq!(px(3,3),[220,25,30,255]);
        s.undo(3).unwrap();
        assert_eq!(s.export().unwrap(),original);
        request.brush_tip=SurfaceBrushTip::Square;
        s.apply_surface_paint_stroke(&request).unwrap();
        assert_eq!(s.document().texture_assets.len(),1);
    }
    #[test]
    fn seam_is_two_source_verified_faces_one_undo(){
        use super::super::Cube;
        let mut s=session();
        const SECOND:&str="00000000-0000-4000-8000-000000002202";
        let mut cube:Cube=s.document().cubes[0].clone();
        cube.uuid=SECOND.into();
        cube.from=[4.0,0.0,0.0];
        cube.to=[8.0,4.0,4.0];
        let mut ops=vec![
            EditOperation::AddCube{cube,
                bone_uuid:"00000000-0000-4000-8000-000000000001".into()},
            EditOperation::AssignCubeTexture{
                cube_uuid:SECOND.into(),texture_uuid:TEX.into()},
        ];
        for (face,x) in [("north",24),("east",28),("south",32),
            ("west",36),("up",40),("down",44)]{
            ops.push(EditOperation::SetFaceUv{uuid:SECOND.into(),
                face:face.into(),uv:[x as f64,0.0,(x+4) as f64,4.0]});
        }
        s.apply(2,&ops).unwrap();
        s.apply(3,&[EditOperation::PaintTextureRectangle{
            texture_index:0,from:[24,0],to:[27,3],
            rgba:[80,100,120,255],erase:false,
        }]).unwrap();
        let before=s.export().unwrap();
        let mut request=intent();
        request.expected_revision=4;request.points=vec![[0,0]];
        request.protected_regions.clear();
        request.seam=Some(surface_seam::SurfaceSeamPatch{
            cube_uuid:SECOND.into(),face:"north".into(),
            expected_face_uv:[24.0,0.0,28.0,4.0],
            expected_face_rotation:0,points:vec![[0,0]],
        });
        s.apply_surface_paint_stroke(&request).unwrap();
        assert_eq!(s.summary().revision,5);
        let pixels=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        assert_eq!(&pixels[0..4],&[140,150,160,255]);
        assert_eq!(&pixels[24*4..24*4+4],&[140,150,160,255]);
        s.undo(5).unwrap();
        assert_eq!(s.export().unwrap(),before);
        let mut wrong=request.clone();
        wrong.expected_revision=4;
        wrong.seam.as_mut().unwrap().face="east".into();
        assert!(s.apply_surface_paint_stroke(&wrong).is_err());
    }

}
