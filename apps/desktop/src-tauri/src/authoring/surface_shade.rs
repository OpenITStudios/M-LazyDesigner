//! Hard-pixel Shade Ink for a reviewer-authored RGB ramp. The original
//! bitmap is decoded/encoded by paint.rs and committed by EditorSession.
use super::{EditorSession,Result,MAX_PLAN_BYTES,
    correction_scope::{CorrectionRectangle,TextureCorrectionScope},
    surface_paint::{SurfaceBrushTip,admit_face,hard_footprint},
    surface_selection::{self,SelectionStep},surface_pattern::SurfacePattern,
    paint,EditOperation,ExactPixelPatch};
use serde::{Deserialize,Serialize};
use std::collections::{HashMap,HashSet};

#[derive(Debug,Clone,Copy,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum ShadeInkDirection{Lighten,Darken}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceShadeInkIntent{
    pub expected_revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    pub expected_face_uv:[f64;4],
    pub expected_face_rotation:u16,
    pub points:Vec<[u32;2]>,
    pub brush_radius:u8,
    pub brush_tip:SurfaceBrushTip,
    #[serde(default)]
    pub pattern:Option<SurfacePattern>,
    #[serde(default)]
    pub selection_seed:Option<[u32;2]>,
    #[serde(default)]
    pub selection_steps:Vec<SelectionStep>,
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
    /// Ordered from darkest to lightest. Each RGBA is exact and user-chosen.
    /// No fixed creative palette size: bounded by the 64KiB operation plan.
    pub shade_ramp:Vec<[u8;4]>,
    pub direction:ShadeInkDirection,
}
pub(super) fn apply(
    session:&mut EditorSession,intent:&SurfaceShadeInkIntent,
)->Result<super::MutationReceipt>{
    session.check_revision(intent.expected_revision)?;
    if intent.shade_ramp.len()<2||
       intent.points.is_empty()||
       intent.points.len()>paint::MAX_STROKE_POINTS||
       intent.brush_radius==0||intent.brush_radius>4||
       intent.protected_regions.len()>16||
       serde_json::to_vec(intent)
           .is_err_or(|data|data.len()>MAX_PLAN_BYTES){
        return Err("SHADE_INK_INTENT_INVALID".into());
    }
    let mut ramp=HashMap::<[u8;4],usize>::new();
    for (i,rgba) in intent.shade_ramp.iter().enumerate(){
        if rgba[3]!=255||ramp.insert(*rgba,i).is_some(){
            return Err("SHADE_INK_RAMP_INVALID".into());
        }
    }
    let doc=session.document();
    let face=admit_face(doc,&intent.cube_uuid,&intent.texture_uuid,
        &intent.face,intent.expected_face_uv,intent.expected_face_rotation)?;
    let original=paint::decode_for_uv_inspection(
        &doc.texture_assets[face.texture_index],face.width,face.height)?;
    if intent.selection_seed.is_some()&&!intent.selection_steps.is_empty(){
        return Err("SURFACE_SELECTION_PLAN_AMBIGUOUS".into());
    }
    let selection=if !intent.selection_steps.is_empty(){
        Some(surface_selection::compute_plan(&face,&original,
            &intent.selection_steps,&intent.protected_regions)?)
    }else{
        intent.selection_seed.map(|seed|surface_selection::compute(
            &face,&original,seed,&intent.protected_regions)).transpose()?
    };
    let candidates=hard_footprint(&face,&intent.points,
        intent.brush_radius,intent.brush_tip,intent.pattern.as_ref())?;
    let mut patches=Vec::new();
    let mut seen=HashSet::new();
    for at in candidates{
        if !seen.insert(at)||selection.as_ref().is_some_and(|s|!s.contains(&at,face.width))||
           intent.protected_regions.iter().any(|r|
               at[0]>=r.from[0]&&at[0]<r.to[0]&&
               at[1]>=r.from[1]&&at[1]<r.to[1]){continue;}
        let i=((at[1] as usize)*face.width as usize+
            at[0] as usize)*4;
        let before:[u8;4]=original[i..i+4].try_into()
            .map_err(|_|"SHADE_INK_SOURCE_INVALID".to_string())?;
        let Some(&index)=ramp.get(&before)else{continue};
        let target=match intent.direction{
            ShadeInkDirection::Lighten=>index.checked_add(1),
            ShadeInkDirection::Darken=>index.checked_sub(1),
        };
        let Some(target)=target.and_then(|i|intent.shade_ramp.get(i))
            else{continue};
        // Protect one source texel around ANY original non-ramp identity.
        let mut near_detail=false;
        for y in at[1].saturating_sub(1).max(face.from[1])
            ..=(at[1]+1).min(face.to[1]-1){
            for x in at[0].saturating_sub(1).max(face.from[0])
                ..=(at[0]+1).min(face.to[0]-1){
                let j=((y as usize)*face.width as usize+
                    x as usize)*4;
                let neighbor:[u8;4]=original[j..j+4].try_into()
                    .map_err(|_|"SHADE_INK_SOURCE_INVALID".to_string())?;
                if !ramp.contains_key(&neighbor){
                    near_detail=true;break;
                }
            }
            if near_detail{break;}
        }
        if near_detail{continue;}
        patches.push(ExactPixelPatch{at,before,after:*target});
    }
    if patches.is_empty(){
        return Err("SHADE_INK_NO_EDITABLE_PIXELS".into());
    }
    let scope=TextureCorrectionScope{
        texture_uuid:intent.texture_uuid.clone(),
        allowed_regions:vec![CorrectionRectangle{
            from:face.from,to:face.to}],
        preserve_alpha:true,
        protected_regions:intent.protected_regions.clone(),
        expected_before_pixels:vec![],
        editable_before_rgba:intent.shade_ramp.clone(),
    };
    session.apply_with_correction_scope(intent.expected_revision,&[
        EditOperation::PaintTextureExactPixels{
            texture_index:face.texture_index,pixels:patches,
        },
    ],Some(&scope))
}
#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{AuthoringDocument,EditOperation,EditorSession};
    const TEX:&str="00000000-0000-4000-8000-000000003205";
    const CUBE:&str="00000000-0000-4000-8000-000000003206";
    const BONE:&str="00000000-0000-4000-8000-000000003207";
    fn session()->EditorSession{
        let mut doc=AuthoringDocument::new_bedrock(
            "Shading","shading").unwrap();
        doc.meta.box_uv=Some(false);
        let mut s=EditorSession::from_document(doc).unwrap();
        let cube=serde_json::from_value(serde_json::json!({
            "uuid":CUBE,"type":"cube","from":[0,0,0],"to":[4,4,4],
            "faces":{
                "north":{"uv":[0,0,4,4],"texture":TEX},
                "east":{"uv":[4,0,8,4],"texture":TEX},
                "south":{"uv":[8,0,12,4],"texture":TEX},
                "west":{"uv":[12,0,16,4],"texture":TEX},
                "up":{"uv":[16,0,20,4],"texture":TEX},
                "down":{"uv":[20,0,24,4],"texture":TEX}
            }
        })).unwrap();
        let bone=serde_json::from_value(serde_json::json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]})).unwrap();
        s.apply(0,&[
            EditOperation::CreatePaintTexture{uuid:TEX.into(),name:"shade.png".into()},
            EditOperation::AddBone{bone,parent_uuid:None},
            EditOperation::AddCube{cube,bone_uuid:BONE.into()},
        ]).unwrap();
        s.apply(1,&[
            EditOperation::PaintTextureRectangle{
                texture_index:0,from:[0,0],to:[3,3],
                rgba:[90,100,110,255],erase:false,
            },
            EditOperation::PaintTexturePixel{
                texture_index:0,x:3,y:3,rgba:[220,20,20,255],
            },
        ]).unwrap();
        s
    }
    fn intent()->SurfaceShadeInkIntent{
        SurfaceShadeInkIntent{
            expected_revision:2,cube_uuid:CUBE.into(),
            texture_uuid:TEX.into(),face:"north".into(),
            expected_face_uv:[0.0,0.0,4.0,4.0],
            expected_face_rotation:0,points:vec![[0,0],[0,0],[2,2]],
            brush_radius:1,brush_tip:SurfaceBrushTip::Square,
            selection_seed:None,selection_steps:vec![],pattern:None,protected_regions:vec![],
            shade_ramp:vec![[40,50,60,255],[90,100,110,255],
                [150,160,170,255]],
            direction:ShadeInkDirection::Lighten,
        }
    }
    #[test]
    fn one_gesture_one_shade_step_per_pixel_with_identity_and_undo(){
        let mut s=session();
        let original=s.export().unwrap();
        s.shade_surface_stroke(&intent()).unwrap();
        let bitmap=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        assert_eq!(&bitmap[0..4],&[150,160,170,255]);
        assert_eq!(&bitmap[(3*128+3)*4..(3*128+3)*4+4],
            &[220,20,20,255]);
        assert_eq!(&bitmap[(2*128+2)*4..(2*128+2)*4+4],
            &[90,100,110,255]); // near red identity
        assert_eq!(s.summary().revision,3);
        s.undo(3).unwrap();
        assert_eq!(s.export().unwrap(),original);
    }
    #[test]
    fn no_unreviewed_quantization_and_ramp_inputs_fail_closed(){
        let mut s=session();
        let original=s.export().unwrap();
        let mut duplicate=intent();
        duplicate.shade_ramp.push([90,100,110,255]);
        assert_eq!(s.shade_surface_stroke(&duplicate).unwrap_err(),
            "SHADE_INK_RAMP_INVALID");
        let mut broad=intent();
        broad.points=vec![[0,0]];
        for i in 0..40u8{
            broad.shade_ramp.push([i,30,45,255]);
        }
        // The texture still contains just its exact existing RGBA8 colors.
        // Number of proposed artist shades is not capped at 8/16/32.
        assert_eq!(broad.shade_ramp.len(),43);
        assert!(s.shade_surface_stroke(&broad).is_ok());
        s.undo(3).unwrap();
        assert_eq!(s.export().unwrap(),original);
        let mut unsupported=intent();
        unsupported.shade_ramp[0][3]=0;
        assert_eq!(s.shade_surface_stroke(&unsupported).unwrap_err(),
            "SHADE_INK_RAMP_INVALID");
        let mut bottom=intent();
        bottom.direction=ShadeInkDirection::Darken;
        bottom.points=vec![[0,0]];
        s.shade_surface_stroke(&bottom).unwrap();
        let bitmap=paint::decode_for_uv_inspection(
            &s.document().texture_assets[0],128,128).unwrap();
        assert_eq!(&bitmap[0..4],&[40,50,60,255]);
        s.undo(3).unwrap();
        assert_eq!(s.export().unwrap(),original);
    }
}
