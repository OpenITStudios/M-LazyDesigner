//! Narrow, source-local seam bridge for TWO adjacent coplanar Cube faces.
//! Not a world-space mesh solver and not an assertion of seamless art.
use super::{AuthoringDocument,Result, outliner_parent_uuid,
    geometry_attachment::bounded_unrotated_box};
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SurfaceSeamPatch{
    pub cube_uuid:String,
    pub face:String,
    pub expected_face_uv:[f64;4],
    pub expected_face_rotation:u16,
    pub points:Vec<[u32;2]>,
}

fn face_plane(face:&str)->Result<(usize,bool)>{
    match face{
        "east"=>Ok((0,true)), "west"=>Ok((0,false)),
        "up"=>Ok((1,true)), "down"=>Ok((1,false)),
        "south"=>Ok((2,true)), "north"=>Ok((2,false)),
        _=>Err("SURFACE_SEAM_FACE_UNSUPPORTED".into()),
    }
}
/// Only same-direction coplanar faces, on strictly adjacent axis-aligned
/// Cube siblings in one Bone frame, are allowed. Rotated/inflated/stretched
/// Cube envelopes cannot be treated as original source geometry.
pub(super) fn validate_pair(doc:&AuthoringDocument,first_uuid:&str,
    first_face:&str,second_uuid:&str,second_face:&str)->Result<()>{
    if first_uuid==second_uuid||first_face!=second_face{
        return Err("SURFACE_SEAM_PAIR_UNSUPPORTED".into());
    }
    let (normal,positive)=face_plane(first_face)?;
    let first=doc.cubes.iter().find(|cube|cube.uuid==first_uuid)
        .ok_or_else(||"SURFACE_SEAM_CUBE_UNKNOWN".to_string())?;
    let second=doc.cubes.iter().find(|cube|cube.uuid==second_uuid)
        .ok_or_else(||"SURFACE_SEAM_CUBE_UNKNOWN".to_string())?;
    bounded_unrotated_box(first)
        .map_err(|_|"SURFACE_SEAM_TRANSFORM_UNSUPPORTED".to_string())?;
    bounded_unrotated_box(second)
        .map_err(|_|"SURFACE_SEAM_TRANSFORM_UNSUPPORTED".to_string())?;
    let first_parent=outliner_parent_uuid(&doc.hierarchy,first_uuid,None)
        .flatten().ok_or_else(||"SURFACE_SEAM_PARENT_UNRESOLVED".to_string())?;
    let second_parent=outliner_parent_uuid(&doc.hierarchy,second_uuid,None)
        .flatten().ok_or_else(||"SURFACE_SEAM_PARENT_UNRESOLVED".to_string())?;
    if first_parent!=second_parent {
        return Err("SURFACE_SEAM_FRAME_MISMATCH".into());
    }
    let plane=|cube:&super::Cube|{
        if positive{cube.to[normal]}else{cube.from[normal]}
    };
    if plane(first)!=plane(second){
        return Err("SURFACE_SEAM_NOT_COPLANAR".into());
    }
    let tangent=(0..3).filter(|axis|*axis!=normal).collect::<Vec<_>>();
    let touching=|along:usize,other:usize|{
        let adjacent=first.to[along]==second.from[along] ||
            second.to[along]==first.from[along];
        let overlap=first.to[other].min(second.to[other])-
            first.from[other].max(second.from[other]);
        adjacent && overlap>0.0
    };
    if !touching(tangent[0],tangent[1]) &&
       !touching(tangent[1],tangent[0]) {
        return Err("SURFACE_SEAM_EDGE_NOT_SHARED".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{EditOperation,EditorSession};
    #[test]
    fn two_source_local_adjacent_faces_only(){
        let mut s=EditorSession::open(
            include_str!("../../fixtures/bedrock-basic.bbmodel").as_bytes()).unwrap();
        let mut cube=s.document().cubes[0].clone();
        cube.uuid="00000000-0000-4000-8000-000000002202".into();
        cube.from=[4.0,0.0,0.0];cube.to=[8.0,4.0,4.0];
        s.apply(0,&[EditOperation::AddCube{
            cube,bone_uuid:"00000000-0000-4000-8000-000000000001".into(),
        }]).unwrap();
        let first="00000000-0000-4000-8000-000000000002";
        let second="00000000-0000-4000-8000-000000002202";
        assert!(validate_pair(s.document(),first,"north",second,"north").is_ok());
        assert_eq!(validate_pair(s.document(),first,"north",second,"east")
            .unwrap_err(),"SURFACE_SEAM_PAIR_UNSUPPORTED");
        assert_eq!(validate_pair(s.document(),first,"south",second,"south")
            .is_ok(),true);
        let mut separated=s.document().clone();
        separated.cubes.iter_mut().find(|c|c.uuid==second).unwrap()
            .from[0]=5.0;
        assert_eq!(validate_pair(&separated,first,"north",second,"north")
            .unwrap_err(),"SURFACE_SEAM_EDGE_NOT_SHARED");
    }
}
