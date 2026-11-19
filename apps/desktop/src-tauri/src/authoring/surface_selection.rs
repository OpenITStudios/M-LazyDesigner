//! Rust-owned original-RGBA selection. The native mask is ephemeral: only
//! the existing Paint/Undo and source-revision guards can authorize a write.
use super::{AuthoringDocument,EditorSession,Result,MAX_PLAN_BYTES,
    correction_scope::CorrectionRectangle,paint,surface_paint::{
        SurfacePaintSampleRequest,FaceBinding,admit_face,atlas_for_local,
    }};
use base64::{engine::general_purpose::STANDARD,Engine as _};
use serde::{Serialize,Deserialize};

const MAX_PREVIEW_RUNS:usize=4096;
#[derive(Debug,Clone,Copy,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum SelectionMode{Replace,Add,Subtract,Intersect,Invert}
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
pub struct SelectionStep{
    pub mode:SelectionMode,
    #[serde(default)]
    pub seed:Option<[u32;2]>,
}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceSelectionRequest{
    pub source:SurfacePaintSampleRequest,
    #[serde(default)]
    pub protected_regions:Vec<CorrectionRectangle>,
    #[serde(default)]
    pub selection_steps:Vec<SelectionStep>,
}
#[derive(Debug,Clone,Serialize)]
pub struct SurfaceSelectionSpan{pub y:u32,pub x0:u32,pub x1:u32}
/// Downsampled view-only occupancy. OR coverage is useful for inspecting
/// highly fragmented masks but never supplies coordinates to native Apply.
#[derive(Debug,Clone,Serialize)]
pub struct SurfaceSelectionRaster{
    pub width:u32,
    pub height:u32,
    pub packed_mask_base64:String,
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
    pub preview_complete:bool,
    pub preview_raster:Option<SurfaceSelectionRaster>,
    pub selection_steps:Vec<SelectionStep>,
    pub source_authority:&'static str,
    pub write_authority:&'static str,
    pub visual_verdict:&'static str,
}
/// Packed ownership: one bit per texel, independent of atlas color count.
/// No global selection-area cap or byte-per-pixel bitmap duplication.
struct PackedMask{
    bits:Vec<u64>,
    len:usize,
}
impl PackedMask{
    fn new(len:usize)->Self{
        Self{bits:vec![0;len.saturating_add(63)/64],len}
    }
    fn get(&self,index:usize)->bool{
        index<self.len && self.bits.get(index/64)
            .is_some_and(|word|((word>>(index%64))&1)!=0)
    }
    fn set(&mut self,index:usize,value:bool){
        if index>=self.len{return;}
        let bit=1u64<<(index%64);
        if value{self.bits[index/64]|=bit;}
        else{self.bits[index/64]&=!bit;}
    }
}
pub(super) struct ComputedSelection{
    pub source_rgba:[u8;4],
    pub pixel_count:usize,
    atlas_mask:PackedMask,
    pub rows:Vec<SurfaceSelectionSpan>,
    pub preview_complete:bool,
}
impl ComputedSelection{
    pub fn contains(&self,at:&[u32;2],width:u32)->bool{
        self.atlas_mask.get(at[1] as usize*width as usize+at[0] as usize)
    }
}
fn protected(at:[u32;2],regions:&[CorrectionRectangle])->bool{
    regions.iter().any(|rect|at[0]>=rect.from[0]&&at[0]<rect.to[0]&&
        at[1]>=rect.from[1]&&at[1]<rect.to[1])
}
/// On supported original UV, the local-to-atlas mapping is affine. Admit
/// three points through the existing Rust UV owner; avoid recalculating a
/// rectangle for each of millions of selected texels.
struct PixelProjector<'a>{
    face:&'a FaceBinding,
    origin:[i64;2],dx:[i64;2],dy:[i64;2],
}
impl<'a> PixelProjector<'a>{
    fn new(face:&'a FaceBinding)->Result<Self>{
        let origin=atlas_for_local(face,[0,0])?;
        let px=if face.size[0]>1{atlas_for_local(face,[1,0])?}else{origin};
        let py=if face.size[1]>1{atlas_for_local(face,[0,1])?}else{origin};
        let diff=|p:[u32;2]|[i64::from(p[0])-i64::from(origin[0]),
            i64::from(p[1])-i64::from(origin[1])];
        Ok(Self{face,origin:origin.map(i64::from),dx:diff(px),dy:diff(py)})
    }
    fn at(&self,x:u32,y:u32)->Result<[u32;2]>{
        if x>=self.face.size[0]||y>=self.face.size[1]{
            return Err("SURFACE_SELECTION_TEXEL_INVALID".into());
        }
        let nx=self.origin[0]+self.dx[0]*i64::from(x)+self.dy[0]*i64::from(y);
        let ny=self.origin[1]+self.dx[1]*i64::from(x)+self.dy[1]*i64::from(y);
        if nx<i64::from(self.face.from[0])||nx>=i64::from(self.face.to[0])||
           ny<i64::from(self.face.from[1])||ny>=i64::from(self.face.to[1]){
            return Err("SURFACE_SELECTION_UV_INVALID".into());
        }
        Ok([nx as u32,ny as u32])
    }
}
fn sampled_rgba(original:&[u8],width:u32,at:[u32;2])->Result<[u8;4]>{
    let offset=(at[1] as usize*width as usize+at[0] as usize)*4;
    original.get(offset..offset+4).ok_or_else(||
        "SURFACE_SELECTION_SOURCE_INVALID".to_owned())?
        .try_into().map_err(|_|"SURFACE_SELECTION_SOURCE_INVALID".into())
}
/// Span flood: large solid areas require a queue of runs rather than one
/// queued u32 for each texel. Fragmented regions are represented by actual
/// accepted texels in packed bitsets, with no artificial pixel-count cap.
fn connected(
    projector:&PixelProjector<'_>,original:&[u8],seed:[u32;2],
    protected_regions:&[CorrectionRectangle],
)->Result<(PackedMask,[u8;4])>{
    let face=projector.face;
    let (w,h)=(face.size[0],face.size[1]);
    let seed_at=projector.at(seed[0],seed[1])?;
    if protected(seed_at,protected_regions){
        return Err("SURFACE_SELECTION_SEED_PROTECTED".into());
    }
    let color=sampled_rgba(original,face.width,seed_at)?;
    let area=w as usize*h as usize;
    let mut scanned=PackedMask::new(area);
    let mut accepted=PackedMask::new(area);
    let eligible=|x:u32,y:u32,scanned:&PackedMask|->Result<bool>{
        if scanned.get(y as usize*w as usize+x as usize){return Ok(false);}
        let mapped=projector.at(x,y)?;
        Ok(!protected(mapped,protected_regions)&&
            sampled_rgba(original,face.width,mapped)?==color)
    };
    let mut pending=vec![seed[1]*w+seed[0]];
    while let Some(linear)=pending.pop(){
        let x=linear%w;let y=linear/w;
        if !eligible(x,y,&scanned)?{continue;}
        let mut left=x;
        while left>0&&eligible(left-1,y,&scanned)?{left-=1;}
        let mut right=x;
        while right+1<w&&eligible(right+1,y,&scanned)?{right+=1;}
        for xx in left..=right{
            let index=y as usize*w as usize+xx as usize;
            scanned.set(index,true);accepted.set(index,true);
        }
        for adjacent in [y.checked_sub(1),y.checked_add(1).filter(|row|*row<h)]{
            let Some(next_y)=adjacent else{continue};
            let mut active=false;
            for xx in left..=right{
                let matches=eligible(xx,next_y,&scanned)?;
                if matches&&!active{pending.push(next_y*w+xx);}
                active=matches;
            }
        }
    }
    Ok((accepted,color))
}
pub(super) fn compute_plan(
    face:&FaceBinding,original:&[u8],
    steps:&[SelectionStep],protected_regions:&[CorrectionRectangle],
)->Result<ComputedSelection>{
    let atlas_area=(face.width as usize).checked_mul(face.height as usize)
        .ok_or_else(||"SURFACE_SELECTION_SOURCE_INVALID".to_owned())?;
    if steps.is_empty()||protected_regions.len()>16||
       original.len()!=atlas_area.saturating_mul(4){
        return Err("SURFACE_SELECTION_SOURCE_INVALID".into());
    }
    let w=face.size[0] as usize;
    let area=w.checked_mul(face.size[1] as usize)
        .ok_or_else(||"SURFACE_SELECTION_SOURCE_INVALID".to_owned())?;
    let projector=PixelProjector::new(face)?;
    let mut selected=PackedMask::new(area);
    let mut source_rgba=[0u8;4];
    for (i,step) in steps.iter().enumerate(){
        if i==0&&!matches!(step.mode,SelectionMode::Replace|SelectionMode::Invert){
            return Err("SURFACE_SELECTION_INITIAL_MODE_INVALID".into());
        }
        if step.mode==SelectionMode::Invert{
            if step.seed.is_some(){return Err("SURFACE_SELECTION_INVERT_SEED_INVALID".into());}
            for linear in 0..area{
                let at=projector.at((linear%w) as u32,(linear/w) as u32)?;
                let value=!selected.get(linear);
                selected.set(linear,!protected(at,protected_regions)&&value);
            }
            continue;
        }
        let seed=step.seed.ok_or_else(||"SURFACE_SELECTION_SEED_MISSING".to_owned())?;
        let (component,color)=connected(&projector,original,seed,protected_regions)?;
        if i==0{source_rgba=color;}
        for (entry,part) in selected.bits.iter_mut().zip(&component.bits){
            *entry=match step.mode{
                SelectionMode::Replace=>*part,
                SelectionMode::Add=>*entry|*part,
                SelectionMode::Subtract=>*entry&!*part,
                SelectionMode::Intersect=>*entry&*part,
                SelectionMode::Invert=>unreachable!(),
            };
        }
    }
    let mut atlas_mask=PackedMask::new(atlas_area);
    let mut pixel_count=0usize;
    for (word_idx,&word) in selected.bits.iter().enumerate(){
        let mut remaining=word;
        while remaining!=0{
            let local=word_idx*64+remaining.trailing_zeros() as usize;
            remaining&=remaining-1;
            if local>=area{continue;}
            let at=projector.at((local%w) as u32,(local/w) as u32)?;
            let physical=at[1] as usize*face.width as usize+at[0] as usize;
            if !atlas_mask.get(physical){
                atlas_mask.set(physical,true);pixel_count+=1;
            }
        }
    }
    let mut rows=Vec::<SurfaceSelectionSpan>::new();
    let mut preview_complete=true;
    'rows: for y in face.from[1]..face.to[1]{
        let mut x=face.from[0];
        while x<face.to[0]{
            if !atlas_mask.get(y as usize*face.width as usize+x as usize){
                x+=1;continue;
            }
            let x0=x;
            while x<face.to[0]&&
                atlas_mask.get(y as usize*face.width as usize+x as usize){x+=1;}
            if rows.len()>=MAX_PREVIEW_RUNS{
                preview_complete=false;rows.clear();break 'rows;
            }
            rows.push(SurfaceSelectionSpan{y,x0,x1:x});
        }
    }
    Ok(ComputedSelection{source_rgba,pixel_count,atlas_mask,rows,preview_complete})
}
fn occupancy_preview(mask:&PackedMask,width:u32,height:u32,side:u32)
    ->SurfaceSelectionRaster{
    let (w,h)=(width.min(side).max(1),height.min(side).max(1));
    let mut bits=vec![0u8;((w as usize*h as usize)+7)/8];
    for (word_idx,&word) in mask.bits.iter().enumerate(){
        let mut remaining=word;
        while remaining!=0{
            let index=word_idx*64+remaining.trailing_zeros() as usize;
            remaining&=remaining-1;
            if index>=mask.len{continue;}
            let x=index%width as usize;let y=index/width as usize;
            let xx=(x as u64*u64::from(w)/u64::from(width)) as usize;
            let yy=(y as u64*u64::from(h)/u64::from(height)) as usize;
            let target=yy*w as usize+xx;
            bits[target/8]|=1u8<<(target%8);
        }
    }
    SurfaceSelectionRaster{width:w,height:h,packed_mask_base64:STANDARD.encode(bits)}
}
pub(super) fn compute(
    face:&FaceBinding,original:&[u8],seed:[u32;2],
    protected_regions:&[CorrectionRectangle],
)->Result<ComputedSelection>{
    compute_plan(face,original,&[SelectionStep{
        mode:SelectionMode::Replace,seed:Some(seed),
    }],protected_regions)
}
pub(super) fn read(session:&EditorSession,
    request:&SurfaceSelectionRequest)->Result<SurfaceSelectionReceipt>{
    session.check_revision(request.source.expected_revision)?;
    if serde_json::to_vec(request)
        .is_err_or(|data|data.len()>MAX_PLAN_BYTES){
        return Err("SURFACE_SELECTION_REQUEST_TOO_LARGE".into());
    }
    let doc:&AuthoringDocument=session.document();
    let face=admit_face(doc,&request.source.cube_uuid,
        &request.source.texture_uuid,&request.source.face,
        request.source.expected_face_uv,request.source.expected_face_rotation)?;
    let original=paint::decode_for_uv_inspection(
        &doc.texture_assets[face.texture_index],face.width,face.height)?;
    let steps=if request.selection_steps.is_empty(){
        vec![SelectionStep{mode:SelectionMode::Replace,seed:Some(request.source.local)}]
    }else{request.selection_steps.clone()};
    let selected=compute_plan(&face,&original,&steps,&request.protected_regions)?;
    let mut receipt=SurfaceSelectionReceipt{
        revision:request.source.expected_revision,
        cube_uuid:request.source.cube_uuid.clone(),
        texture_uuid:request.source.texture_uuid.clone(),
        face:request.source.face.clone(),
        seed:request.source.local,
        source_rgba:selected.source_rgba,
        pixel_count:selected.pixel_count,atlas_rows:selected.rows,
        preview_complete:selected.preview_complete,preview_raster:None,
        selection_steps:steps,
        source_authority:"RUST_SAVED_RGBA8",
        write_authority:"NOT_GRANTED",visual_verdict:"UNVERIFIED",
    };
    let oversized=serde_json::to_vec(&receipt)
        .is_err_or(|data|data.len()>MAX_PLAN_BYTES);
    if !receipt.preview_complete||oversized{
        receipt.atlas_rows.clear();
        receipt.preview_complete=false;
        for side in [512,256,128,64]{
            receipt.preview_raster=Some(occupancy_preview(
                &selected.atlas_mask,face.width,face.height,side));
            if serde_json::to_vec(&receipt)
                .is_ok_and(|data|data.len()<=MAX_PLAN_BYTES){
                break;
            }
            receipt.preview_raster=None;
        }
    }
    Ok(receipt)
}
#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{EditOperation,EditorSession,AuthoringDocument};
    #[test]
    fn packed_full_face_mask_and_disposable_preview_do_not_limit_selection(){
        let mut mask=PackedMask::new(2048*2048);
        assert_eq!(mask.bits.len()*8,512*1024);
        mask.set(0,true);
        mask.set(2048*2048-1,true);
        let preview=occupancy_preview(&mask,2048,2048,512);
        assert_eq!((preview.width,preview.height),(512,512));
        assert!(mask.get(0)&&mask.get(2048*2048-1));
        assert_eq!(STANDARD.decode(preview.packed_mask_base64)
            .unwrap().len(),512*512/8);
    }
    #[test]
    fn connected_island_is_exact_and_does_not_cross_a_detail_or_mask(){
        let mut doc=AuthoringDocument::new_bedrock(
            "Selection","selection").unwrap();
        doc.meta.box_uv=Some(false);
        let mut s=EditorSession::from_document(doc).unwrap();
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
            EditOperation::CreatePaintTexture{uuid:TEX.into(),name:"a.png".into()},
            EditOperation::AddBone{bone,parent_uuid:None},
            EditOperation::AddCube{cube,bone_uuid:BONE.into()},
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
            protected_regions:vec![],selection_steps:vec![],
        };
        let saved=s.export().unwrap();
        let region=read(&s,&req).unwrap();
        assert_eq!(region.pixel_count,2);
        assert_eq!(region.source_rgba,[50,80,90,255]);
        assert_eq!(region.atlas_rows[0].x0,0);
        assert_eq!(region.atlas_rows[0].x1,2);
        assert_eq!(s.export().unwrap(),saved);
        // Two different islands may be composed without a palette cap.
        let mut compound=req.clone();
        compound.selection_steps=vec![
            SelectionStep{mode:SelectionMode::Replace,seed:Some([0,0])},
            SelectionStep{mode:SelectionMode::Add,seed:Some([3,0])},
        ];
        let combined=read(&s,&compound).unwrap();
        assert_eq!(combined.pixel_count,3);
        assert!(combined.preview_complete);
        compound.selection_steps.push(SelectionStep{
            mode:SelectionMode::Subtract,seed:Some([1,0]),
        });
        assert_eq!(read(&s,&compound).unwrap().pixel_count,1);
        compound.selection_steps.push(SelectionStep{
            mode:SelectionMode::Invert,seed:None,
        });
        assert_eq!(read(&s,&compound).unwrap().pixel_count,15);
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
