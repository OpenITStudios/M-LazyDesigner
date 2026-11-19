//! Rust-owned read-only connected color island for one explicitly mapped
//! Cube face. This is a *temporary selection*, not a stored PNG, layer or
//! permission grant. Every later stroke recomputes it from its original RGBA.
use super::{AuthoringDocument,EditorSession,Result,MAX_PLAN_BYTES,
    correction_scope::CorrectionRectangle,paint,surface_paint::{
        SurfacePaintSampleRequest,FaceBinding,admit_face,atlas_for_local,
    }};
use serde::{Serialize,Deserialize};
use std::collections::HashSet;

const MAX_SELECTION_RUNS:usize=1024;
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceSelectionRequest{
    pub source:SurfacePaintSampleRequest,
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
}
#[derive(Debug,Clone,Serialize)]
pub struct SurfaceSelectionSpan{
    pub y:u32,pub x0:u32,pub x1:u32,
}
#[derive(Debug,Clone,Serialize)]
pub struct SurfaceSelectionReceipt{
    pub revision:u64,
    pub cube_uuid:String,
    pub texture_uuid:String,
    pub face:String,
    pub seed:[u32;2],
    pub source_rgba:[u8;4],
    pub pixel_count:usize,
    pub atlas_rows:Vec<SurfaceSelectionSpan>,
    pub source_authority:&'static str,
    pub write_authority:&'static str,
    pub visual_verdict:&'static str,
}
pub(super) struct ComputedSelection{
    pub source_rgba:[u8;4],
    pub physical:HashSet<[u32;2]>,
    pub rows:Vec<SurfaceSelectionSpan>,
}
fn protected(at:[u32;2],regions:&[CorrectionRectangle])->bool{
    regions.iter().any(|rect|at[0]>=rect.from[0]&&at[0]<rect.to[0]&&
        at[1]>=rect.from[1]&&at[1]<rect.to[1])
}
pub(super) fn compute(
    face:&FaceBinding,original:&[u8],seed:[u32;2],
    protected_regions:&[CorrectionRectangle],
)->Result<ComputedSelection>{
    if protected_regions.len()>16||original.len()!=
        face.width as usize*face.height as usize*4{
        return Err("SURFACE_SELECTION_SOURCE_INVALID".into());
    }
    let start=atlas_for_local(face,seed)?;
    if protected(start,protected_regions){
        return Err("SURFACE_SELECTION_SEED_PROTECTED".into());
    }
    let si=(start[1] as usize*face.width as usize+start[0] as usize)*4;
    let source_rgba:[u8;4]=original.get(si..si+4)
        .ok_or_else(||"SURFACE_SELECTION_SOURCE_INVALID".to_string())?
        .try_into().map_err(|_|"SURFACE_SELECTION_SOURCE_INVALID".to_string())?;
    // Read-only selection may sample ANY original color; Paint separately
    // checks the eligible alpha and the selected source under a revision.
    let (w,h)=(face.size[0],face.size[1]);
    let mut visited=vec![false;w as usize*h as usize];
    let mut queue=Vec::new();
    let mut physical=HashSet::new();
    let idx=|p:[u32;2]|p[1] as usize*w as usize+p[0] as usize;
    queue.push(seed);visited[idx(seed)]=true;
    physical.insert(start);
    let mut front=0;
    while front<queue.len(){
        let at=queue[front];front+=1;
        let neighbors=[
            (at[0]>0).then(||[at[0]-1,at[1]]),
            (at[0]+1<w).then(||[at[0]+1,at[1]]),
            (at[1]>0).then(||[at[0],at[1]-1]),
            (at[1]+1<h).then(||[at[0],at[1]+1]),
        ];
        for item in neighbors.into_iter().flatten(){
            let i=idx(item);
            if visited[i]{continue;}
            visited[i]=true;
            let mapped=atlas_for_local(face,item)?;
            if protected(mapped,protected_regions){continue;}
            let off=((mapped[1] as usize)*face.width as usize+
                mapped[0] as usize)*4;
            if original.get(off..off+4)!=Some(source_rgba.as_slice()){
                continue;
            }
            physical.insert(mapped);
            queue.push(item);
        }
    }
    // Physical atlas RLE for a lightweight read-only selection overlay.
    // Never truncate: an incomplete preview must not appear selected.
    let mut ordered=physical.iter().copied().collect::<Vec<_>>();
    ordered.sort_by_key(|p|(p[1],p[0]));
    let mut rows:Vec<SurfaceSelectionSpan>=Vec::new();
    for at in ordered{
        if let Some(last)=rows.last_mut(){
            if last.y==at[1]&&last.x1==at[0]{
                last.x1+=1;
                continue;
            }
        }
        rows.push(SurfaceSelectionSpan{
            y:at[1],x0:at[0],x1:at[0]+1,
        });
        if rows.len()>MAX_SELECTION_RUNS{
            return Err("SURFACE_SELECTION_TOO_COMPLEX".into());
        }
    }
    Ok(ComputedSelection{source_rgba,physical,rows})
}
pub(super) fn read(session:&EditorSession,
    request:&SurfaceSelectionRequest)->Result<SurfaceSelectionReceipt>{
    session.check_revision(request.source.expected_revision)?;
    if serde_json::to_vec(request)
        .is_err_or(|data|data.len()>MAX_PLAN_BYTES){
        return Err("SURFACE_SELECTION_REQUEST_TOO_LARGE".into());
    }
    let doc: &AuthoringDocument=session.document();
    let face=admit_face(doc,&request.source.cube_uuid,
        &request.source.texture_uuid,&request.source.face,
        request.source.expected_face_uv,
        request.source.expected_face_rotation)?;
    let original=paint::decode_for_uv_inspection(
        &doc.texture_assets[face.texture_index],face.width,face.height)?;
    let selected=compute(&face,&original,request.source.local,
        &request.protected_regions)?;
    let receipt=SurfaceSelectionReceipt{
        revision:request.source.expected_revision,
        cube_uuid:request.source.cube_uuid.clone(),
        texture_uuid:request.source.texture_uuid.clone(),
        face:request.source.face.clone(),
        seed:request.source.local,source_rgba:selected.source_rgba,
        pixel_count:selected.physical.len(),atlas_rows:selected.rows,
        source_authority:"RUST_SAVED_RGBA8",
        write_authority:"NOT_GRANTED",visual_verdict:"UNVERIFIED",
    };
    if serde_json::to_vec(&receipt)
        .is_err_or(|data|data.len()>MAX_PLAN_BYTES){
        return Err("SURFACE_SELECTION_RESULT_TOO_LARGE".into());
    }
    Ok(receipt)
}
#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{EditOperation,EditorSession,AuthoringDocument};
    #[test]
    fn connected_island_is_exact_and_does_not_cross_a_detail_or_mask(){
        let mut s=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Selection","selection").unwrap()).unwrap();
        const TEX:&str="00000000-0000-4000-8000-000000003105";
        const CUBE:&str="00000000-0000-4000-8000-000000003106";
        const BONE:&str="00000000-0000-4000-8000-000000003107";
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
            EditOperation::AddBone{bone,parent_uuid:None},
            EditOperation::AddCube{cube,bone_uuid:BONE.into()},
            EditOperation::CreatePaintTexture{uuid:TEX.into(),name:"a.png".into()},
        ]).unwrap();
        // Isolated two cyan pixels and one red interruption on same face.
        s.apply(1,&[
            EditOperation::PaintTexturePixel{texture_index:0,x:0,y:0,rgba:[50,80,90,255]},
            EditOperation::PaintTexturePixel{texture_index:0,x:1,y:0,rgba:[50,80,90,255]},
            EditOperation::PaintTexturePixel{texture_index:0,x:2,y:0,rgba:[220,20,20,255]},
            EditOperation::PaintTexturePixel{texture_index:0,x:3,y:0,rgba:[50,80,90,255]},
        ]).unwrap();
        let req=SurfaceSelectionRequest{
            source:SurfacePaintSampleRequest{
                expected_revision:2,cube_uuid:CUBE.into(),
                texture_uuid:TEX.into(),face:"north".into(),
                expected_face_uv:[0.0,0.0,4.0,4.0],
                expected_face_rotation:0,local:[0,0],
            },
            protected_regions:vec![],
        };
        let saved=s.export().unwrap();
        let region=read(&s,&req).unwrap();
        assert_eq!(region.pixel_count,2);
        assert_eq!(region.source_rgba,[50,80,90,255]);
        assert_eq!(region.atlas_rows[0].x0,0);
        assert_eq!(region.atlas_rows[0].x1,2);
        assert_eq!(s.export().unwrap(),saved);
        let mut protected=req.clone();
        protected.protected_regions=vec![CorrectionRectangle{
            from:[1,0],to:[2,1],
        }];
        assert_eq!(read(&s,&protected).unwrap().pixel_count,1);
        protected.protected_regions=vec![CorrectionRectangle{
            from:[0,0],to:[1,1],
        }];
        assert_eq!(read(&s,&protected).unwrap_err(),
            "SURFACE_SELECTION_SEED_PROTECTED");
    }
}
