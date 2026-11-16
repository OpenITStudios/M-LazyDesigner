//! Bounded advisory evidence from actually saved RGBA8 atlas pixels.
//! NEVER an artistic PASS or user approval.
use super::{paint, AuthoringDocument, MaterialPatchRegion, Result};
use serde_json::{json,Value};
use std::collections::{HashMap,HashSet};

fn pixel(bytes:&[u8],width:u32,x:u32,y:u32)->[u8;4]{
    let i=((y*width+x)*4) as usize;
    [bytes[i],bytes[i+1],bytes[i+2],bytes[i+3]]
}
fn analyze(bytes:&[u8],width:u32,region:&MaterialPatchRegion)->Value{
    let w=region.to[0]-region.from[0];
    let h=region.to[1]-region.from[1];
    let mut exact=HashSet::<[u8;3]>::new();
    let mut coarse=HashMap::<u16,u32>::new();
    let (mut visible,mut opaque)=(0u32,0u32);
    let (mut low,mut high)=(255u32,0u32);
    let (mut different,mut adjacency)=(0u32,0u32);
    let(mut rows,mut uniform_rows)=(Vec::<[u8;3]>::new(),true);
    for y in region.from[1]..region.to[1]{
        let(mut first,mut uniform)=(None,true);
        for x in region.from[0]..region.to[0]{
            let p=pixel(bytes,width,x,y);
            if p[3]==0{uniform=false;continue;}
            visible+=1;if p[3]==255{opaque+=1;}
            let rgb=[p[0],p[1],p[2]];
            exact.insert(rgb);
            let key=((u16::from(p[0])>>5)<<6) |
                ((u16::from(p[1])>>5)<<3)|(u16::from(p[2])>>5);
            *coarse.entry(key).or_insert(0)+=1;
            let luma=(54*u32::from(p[0])+183*u32::from(p[1])+
                19*u32::from(p[2]))/256;
            low=low.min(luma);high=high.max(luma);
            if first.is_some_and(|v|v!=rgb){uniform=false;}
            if first.is_none(){first=Some(rgb);}
            for (nx,ny) in [(x+1,y),(x,y+1)]{
                if nx>=region.to[0]||ny>=region.to[1]{continue;}
                let other=pixel(bytes,width,nx,ny);
                if other[3]>0{
                    adjacency+=1;
                    if other[..3]!=p[..3]{different+=1;}
                }
            }
        }
        if !uniform{uniform_rows=false;}
        if let Some(rgb)=first{rows.push(rgb);}
    }
    let mut hints=Vec::<&str>::new();
    if visible>=16{
        if exact.len()==1{
            hints.push("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE");
        }else if high-low<21 &&
            coarse.values().copied().max().unwrap_or(0)*100>=visible*92{
            hints.push("LOW_FORM_VALUE_VARIATION_CANDIDATE");
        }
        if w>=4&&h>=4&&opaque==w*h&&uniform_rows&&
            rows.iter().any(|v|*v!=rows[0]){
            hints.push("UNIFORM_HORIZONTAL_BANDS_REVIEW");
        }
        if adjacency>=8&&different*100>=adjacency*85{
            hints.push("FRAGMENTED_OR_NOISE_FIRST_REVIEW");
        }
    }
    let status=if hints.contains(&"UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE"){
        "BASE_ONLY_CANDIDATE"
    }else if hints.is_empty(){"NOT_EVALUATED"}else{"REVIEW_REQUIRED"};
    json!({
        "scope":"selected_saved_rgba8_atlas_region",
        "region":region,"region_pixels":w*h,
        "visible_pixels":visible,"unique_visible_rgb":exact.len(),
        "approx_luma_span":if visible==0{Value::Null}else{json!(high-low)},
        "review_hints":hints,"status":status,
        "visual_verdict":"UNVERIFIED","texture_completion_attested":false,
        "note":"Only an atlas candidate diagnostic. No proof of form-following shading, reference alignment or artistic acceptance."
    })
}
pub fn inspect_texture_styling_region(doc:&AuthoringDocument,
    texture_uuid:&str,region:&MaterialPatchRegion)->Result<Value>{
    doc.validate()?;
    if !super::valid_uuid(texture_uuid){
        return Err("TEXTURE_STYLING_UUID_INVALID".into());
    }
    let width=doc.resolution.width;let height=doc.resolution.height;
    if region.from[0]>=region.to[0]||region.from[1]>=region.to[1]||
        region.to[0]>width||region.to[1]>height{
        return Err("TEXTURE_STYLING_REGION_INVALID".into());
    }
    let w=region.to[0]-region.from[0];let h=region.to[1]-region.from[1];
    if w.checked_mul(h).is_none_or(|n|n>4096){
        return Err("TEXTURE_STYLING_REGION_TOO_LARGE".into());
    }
    let mut assets=doc.texture_assets.iter().filter(|t|
        t.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let texture=assets.next().ok_or_else(||
        "TEXTURE_STYLING_TEXTURE_NOT_FOUND".to_string())?;
    if assets.next().is_some(){
        return Err("TEXTURE_STYLING_TEXTURE_AMBIGUOUS".into());
    }
    let bytes=paint::decode_for_uv_inspection(texture,width,height)
        .map_err(|_|"TEXTURE_STYLING_BITMAP_UNSUPPORTED".to_string())?;
    let mut report=analyze(&bytes,width,region);
    report["texture_uuid"]=json!(texture_uuid);
    Ok(report)
}
#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{EditOperation,EditorSession};
    const TEX:&str="00000000-0000-4000-8000-000000007101";
    fn region()->MaterialPatchRegion{MaterialPatchRegion{
        from:[0,0],to:[8,8]
    }}
    #[test]
    fn one_color_saved_png_is_not_final_texture_shading(){
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Material","material").unwrap()
        ).unwrap();
        session.apply(0,&[EditOperation::CreatePaintTexture{
            uuid:TEX.into(),name:"material.png".into()
        }]).unwrap();
        session.apply(1,&[EditOperation::PaintTextureRectangle{
            texture_index:0,from:[0,0],to:[8,8],rgba:[70,70,70,255],
            erase:false
        }]).unwrap();
        let original=session.export().unwrap();
        let r=inspect_texture_styling_region(session.document(),TEX,&region()).unwrap();
        assert_eq!(r["status"],"BASE_ONLY_CANDIDATE");
        assert_eq!(r["texture_completion_attested"],false);
        assert_eq!(r["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.export().unwrap(),original);
    }
    #[test]
    fn straight_three_color_bands_and_checker_noise_need_review(){
        for noise in [false,true]{
            let mut rgba=vec![0u8;8*8*4];
            for y in 0..8usize{for x in 0..8usize{
                let v=if noise{if(x+y)%2==0{20}else{220}}
                    else if y<2{40}else if y<6{110}else{195};
                let i=(y*8+x)*4;rgba[i..i+4].copy_from_slice(&[v,v,v,255]);
            }}
            let report=analyze(&rgba,8,&region());
            let key=if noise{"FRAGMENTED_OR_NOISE_FIRST_REVIEW"}
                else{"UNIFORM_HORIZONTAL_BANDS_REVIEW"};
            assert!(report["review_hints"].as_array().unwrap().iter().any(|v|v==key));
            assert_eq!(report["status"],"REVIEW_REQUIRED");
        }
    }
    #[test]
    fn four_pixel_identity_is_not_wrongly_called_flat_material(){
        let report=analyze(&vec![120u8;2*2*4],2,&MaterialPatchRegion{
            from:[0,0],to:[2,2]});
        assert_eq!(report["status"],"NOT_EVALUATED");
    }
}
