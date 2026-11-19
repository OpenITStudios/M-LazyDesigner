//! Source-only G5: verify an explicitly declared empty volume in a
//! just-proposed G1 Bone. This is NOT a general 3D contact/visibility solver.
//! Coordinates are saved Cube bounds in that Bone's unrotated local frame.
//! Does not change the plan, a document, Undo, UV or any model publisher.
use super::{valid_bounds, Bone, Cube, EditOperation, EditPlan, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const MAX_ZONES: usize = 16;
const MAX_EVIDENCE_BYTES: usize = 16 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryVoidZone {
    pub bone_uuid: String,
    pub from: [f64; 3],
    pub to: [f64; 3],
}
fn vec_eq(v: &Value, expected: f64) -> bool {
    v.as_f64().is_some_and(|n| n.is_finite() && n == expected)
}
fn vector_equals(extra: &Map<String,Value>, key: &str, expected: f64) -> bool {
    extra.get(key).is_none_or(|value|
        value.as_array().is_some_and(|a| a.len() == 3 &&
            a.iter().all(|v| vec_eq(v, expected))))
}
fn zero_rotation(extra: &Map<String, Value>) -> bool {
    vector_equals(extra, "rotation", 0.0)
}
fn axis_aligned(cube: &Cube) -> bool {
    zero_rotation(&cube.extra) &&
        vector_equals(&cube.extra, "stretch", 1.0) &&
        cube.extra.get("inflate").is_none_or(|v| vec_eq(v,0.0))
}
fn bone_supported(bone: &Bone) -> bool {
    zero_rotation(&bone.extra)
}
fn positive_overlap(cube: &Cube, zone: &GeometryVoidZone) -> bool {
    (0..3).all(|a| cube.from[a] < zone.to[a] && cube.to[a] > zone.from[a])
}
/// A source-bound negative-space guard, not a proof of through-hole topology.
/// The existing Rust G1 planner/preflight remains the only geometry compiler.
pub fn check_geometry_void_zones(plan:&EditPlan,zones:&[GeometryVoidZone])->Result<Value>{
    if zones.is_empty()||zones.len()>MAX_ZONES {
        return Err("GEOMETRY_VOID_ZONE_COUNT_INVALID".into());
    }
    let mut signatures=HashSet::new();
    let mut tested=0usize;
    for zone in zones {
        if !valid_bounds(zone.from,zone.to) ||
           !signatures.insert(serde_json::to_string(zone)
                .map_err(|_|"GEOMETRY_VOID_ZONE_INVALID".to_string())?) {
            return Err("GEOMETRY_VOID_ZONE_INVALID".into());
        }
        let bone=plan.operations.iter().find_map(|op| match op {
            EditOperation::AddBone{bone,..} if bone.uuid==zone.bone_uuid => Some(bone),
            _=>None,
        }).ok_or_else(||"GEOMETRY_VOID_BONE_NOT_IN_ASSEMBLY".to_string())?;
        if !bone_supported(bone){return Err("GEOMETRY_VOID_ROTATED_BONE_UNSUPPORTED".into());}
        let mut min=[f64::INFINITY;3];
        let mut max=[f64::NEG_INFINITY;3];
        let mut count=0usize;
        for op in &plan.operations {
            if let EditOperation::AddCube{cube,bone_uuid} = op {
                if bone_uuid!=&zone.bone_uuid {continue;}
                if !axis_aligned(cube) {
                    return Err("GEOMETRY_VOID_TRANSFORM_UNSUPPORTED".into());
                }
                count+=1;
                for i in 0..3 {
                    min[i]=min[i].min(cube.from[i]);
                    max[i]=max[i].max(cube.to[i]);
                }
                if positive_overlap(cube,zone){
                    return Err("GEOMETRY_VOID_OCCUPIED".into());
                }
            }
        }
        if count==0 || (0..3).any(|i|
            zone.from[i]<min[i]||zone.to[i]>max[i]) {
            return Err("GEOMETRY_VOID_OUTSIDE_LOCAL_ENVELOPE".into());
        }
        tested+=count;
    }
    let result=json!({
        "scope":"new_bone_saved_cube_bounds_empty_zone",
        "zones":zones,
        "zones_checked":zones.len(),
        "tested_cube_checks":tested,
        "local_bounds_verdict":"CLEAR_OF_PROPOSED_AXIS_ALIGNED_CUBES",
        "whole_model_contact_verdict":"UNVERIFIED",
        "through_hole_verdict":"UNVERIFIED",
        "visual_verdict":"UNVERIFIED",
        "write_authority":"NOT_GRANTED"
    });
    if serde_json::to_vec(&result).map_err(|_|"GEOMETRY_VOID_SERIALIZE_FAILED".to_string())?
        .len()>MAX_EVIDENCE_BYTES {
        return Err("GEOMETRY_VOID_EVIDENCE_TOO_LARGE".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    const BONE:&str="00000000-0000-4000-8000-000000007601";
    fn plan()->EditPlan{
        let bone:Bone=serde_json::from_value(json!({
            "uuid":BONE,"name":"body","origin":[0,0,0]
        })).unwrap();
        let cube=|id:&str,from:[f64;3],to:[f64;3]|->Cube{
            serde_json::from_value(json!({
                "uuid":id,"type":"cube","name":"part","from":from,"to":to,
                "faces":{"north":{"texture":null}}
            })).unwrap()
        };
        EditPlan{expected_revision:0,correction_scope:None,operations:vec![
            EditOperation::AddBone{bone,parent_uuid:None},
            EditOperation::AddCube{cube:cube("left",[0.,0.,0.],[2.,10.,10.]),
                bone_uuid:BONE.into()},
            EditOperation::AddCube{cube:cube("right",[8.,0.,0.],[10.,10.,10.]),
                bone_uuid:BONE.into()},
        ]}
    }
    #[test]
    fn declared_local_void_is_unoccupied_but_never_called_whole_model_clear(){
        let source=plan();
        let before=serde_json::to_value(&source).unwrap();
        let zone=GeometryVoidZone{bone_uuid:BONE.into(),
            from:[3.,1.,1.],to:[7.,9.,9.]};
        let evidence=check_geometry_void_zones(&source,&[zone]).unwrap();
        assert_eq!(evidence["tested_cube_checks"],2);
        assert_eq!(evidence["through_hole_verdict"],"UNVERIFIED");
        assert_eq!(evidence["write_authority"],"NOT_GRANTED");
        assert_eq!(serde_json::to_value(&source).unwrap(),before);
    }
    #[test]
    fn rejects_filled_void_outside_envelope_and_unsupported_transform(){
        let source=plan();
        let occupied=GeometryVoidZone{bone_uuid:BONE.into(),
            from:[1.,2.,2.],to:[3.,5.,5.]};
        assert_eq!(check_geometry_void_zones(&source,&[occupied]).unwrap_err(),
            "GEOMETRY_VOID_OCCUPIED");
        let outside=GeometryVoidZone{bone_uuid:BONE.into(),
            from:[11.,2.,2.],to:[12.,5.,5.]};
        assert_eq!(check_geometry_void_zones(&source,&[outside]).unwrap_err(),
            "GEOMETRY_VOID_OUTSIDE_LOCAL_ENVELOPE");
        let mut transformed=source.clone();
        if let EditOperation::AddCube{cube,..}=&mut transformed.operations[1]{
            cube.extra.insert("rotation".into(),json!([0,20,0]));
        }
        let zone=GeometryVoidZone{bone_uuid:BONE.into(),
            from:[3.,1.,1.],to:[7.,9.,9.]};
        assert_eq!(check_geometry_void_zones(&transformed,&[zone]).unwrap_err(),
            "GEOMETRY_VOID_TRANSFORM_UNSUPPORTED");
    }
}
