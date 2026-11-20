//! Source-bound, read-only marker trajectory hints for NEW numeric Bone clips.
//! This is deliberately a limited Rust-preview-space ZYX kinematic projection,
//! not a native Blockbench/Minecraft renderer, IK solver or contact verdict.
//! Actual interpolation, entity travel, collisions, support surfaces and
//! continuous motion remain unverified without a live local application.
use super::{AuthoringDocument, Bone, OutlinerNode, Result};
use super::animation_semantic::{exact_time, SemanticAnimationProbe, SemanticContactWindow, SemanticAnimationPose};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

type Vec3 = [f64; 3];
type Tracks = BTreeMap<(String, String), Vec<(f64, Vec3)>>;
const MAX_SAMPLES: usize = 8;
const MAX_DEPTH: usize = 64;
const MAX_POSITION: f64 = 100_000.0;

fn valid_vec(v: Vec3) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= 100_000.0)
}
fn sum(a: Vec3, b: Vec3) -> Vec3 { std::array::from_fn(|i| a[i]+b[i]) }
fn sub(a: Vec3, b: Vec3) -> Vec3 { std::array::from_fn(|i| a[i]-b[i]) }
fn mul(a: Vec3, b: Vec3) -> Vec3 { std::array::from_fn(|i| a[i]*b[i]) }
fn length(v: Vec3) -> f64 { v.iter().map(|n| n*n).sum::<f64>().sqrt() }
fn distance(a: Vec3, b: Vec3) -> f64 { length(sub(a,b)) }

/// Match RustViewport's explicit Three.js Euler('ZYX') order:
/// the applied vector sequence is Rx then Ry then Rz.
fn rotate_zyx(p: Vec3, degrees: Vec3) -> Vec3 {
    let (sx,cx)=degrees[0].to_radians().sin_cos();
    let (sy,cy)=degrees[1].to_radians().sin_cos();
    let (sz,cz)=degrees[2].to_radians().sin_cos();
    let x=[p[0],cx*p[1]-sx*p[2],sx*p[1]+cx*p[2]];
    let y=[cy*x[0]+sy*x[2],x[1],-sy*x[0]+cy*x[2]];
    [cz*y[0]-sz*y[1],sz*y[0]+cz*y[1],y[2]]
}
fn source_origin(bone: &Bone) -> Result<Vec3> {
    bone.origin.filter(|v| valid_vec(*v))
        .ok_or_else(||"TRAJECTORY_BONE_ORIGIN_UNSUPPORTED".into())
}
fn bind_rotation(bone: &Bone) -> Result<Vec3> {
    // The current RustViewport does not project arbitrary custom source
    // quaternion/matrix/euler-order/scale metadata. Refuse those instead
    // of pretending they are known 3D transformations.
    if ["quaternion","matrix","scale","rotation_order","euler_order"]
        .iter().any(|key|bone.extra.contains_key(*key)) {
        return Err("TRAJECTORY_BIND_TRANSFORM_UNSUPPORTED".into());
    }
    match bone.extra.get("rotation") {
        None => Ok([0.0;3]),
        Some(value) => {
            let rotation:Vec3=serde_json::from_value(value.clone())
                .map_err(|_|"TRAJECTORY_BIND_TRANSFORM_UNSUPPORTED".to_owned())?;
            if !valid_vec(rotation) {
                return Err("TRAJECTORY_BIND_TRANSFORM_UNSUPPORTED".into());
            }
            Ok(rotation)
        }
    }
}
fn locate(nodes:&[OutlinerNode], target:&str, path:&mut Vec<String>) -> bool {
    for node in nodes {
        if let OutlinerNode::Bone(group)=node {
            if path.len() >= MAX_DEPTH { continue; }
            path.push(group.uuid.clone());
            if group.uuid==target || locate(&group.children,target,path) { return true; }
            path.pop();
        }
    }
    false
}
fn sample_track(tracks:&Tracks, bone:&str, channel:&str, time:f64, fallback:Vec3) -> Vec3 {
    let Some(keys)=tracks.get(&(bone.to_owned(),channel.to_owned())) else {return fallback};
    if time<=keys[0].0 {return keys[0].1}
    if time>=keys[keys.len()-1].0 {return keys[keys.len()-1].1}
    let next=keys.partition_point(|(t,_)| *t<time);
    let (a,b)=(&keys[next-1],&keys[next]);
    let fraction=(time-a.0)/(b.0-a.0);
    std::array::from_fn(|axis|a.1[axis]+(b.1[axis]-a.1[axis])*fraction)
}
fn point_at(
    bones:&[&Bone], tracks:&Tracks, point:Vec3, time:f64,
)->Result<Vec3>{
    let mut projected=point;
    for index in (0..bones.len()).rev() {
        let bone=bones[index];
        let origin=source_origin(bone)?;
        let parent_origin=if index>0 {source_origin(bones[index-1])?}
            else {[0.0;3]};
        let pos=sample_track(tracks,&bone.uuid,"position",time,[0.0;3]);
        let rot=sample_track(tracks,&bone.uuid,"rotation",time,[0.0;3]);
        let scale=sample_track(tracks,&bone.uuid,"scale",time,[1.0;3]);
        if !valid_vec(pos)||!valid_vec(rot)||!valid_vec(scale)||
           scale.iter().any(|s|*s<=0.0||*s>100.0){
            // Three.js substitutes an epsilon for zero scale in viewport;
            // do not call a mathematical zero projection native parity.
            return Err("TRAJECTORY_SCALE_OR_TRANSFORM_UNSUPPORTED".into());
        }
        let angles=sum(bind_rotation(bone)?,rot);
        projected=sum(
            sum(sub(origin,parent_origin),pos),
            rotate_zyx(mul(projected,scale),angles),
        );
        if !projected.iter().all(|axis|axis.is_finite()&&axis.abs()<=MAX_POSITION){
            return Err("TRAJECTORY_COORDINATE_LIMIT".into());
        }
    }
    Ok(projected)
}
fn sample_times(poses:&[SemanticAnimationPose],start:f64,end:f64)->Vec<f64>{
    // Keep the same nine-decimal time precision as the canonical Rust clip
    // and the Code Mode receipt. Do not invent an unrepresentable half-tick.
    let middle=format!("{:.9}",(start+end)*0.5).parse::<f64>().unwrap_or(start);
    let mut times=vec![start,end];
    if middle>start+1e-9 && middle<end-1e-9 { times.push(middle); }
    for pose in poses {
        if times.len()>=MAX_SAMPLES { break; }
        if pose.time>start&&pose.time<end &&
           !times.iter().any(|v|(*v-pose.time).abs()<=1e-9){
            times.push(pose.time);
        }
    }
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a,b|(*a-*b).abs()<=1e-9);
    times
}

/// Every number is derived from the current source hierarchy and declared
/// numeric keys at bounded times. A planted label only selects review scope;
/// it never certifies floor contact or continuous motion between samples.
pub(super) fn review(
    doc:&AuthoringDocument,
    poses:&[SemanticAnimationPose],
    contacts:&[SemanticContactWindow],
    probes:&[SemanticAnimationProbe],
    tracks:&Tracks,
    nonlinear_owners:&HashSet<(String,String)>,
    clip_length:f64,
)->Result<Vec<Value>>{
    if probes.len()>4{return Err("TRAJECTORY_PROBE_LIMIT".into())}
    let mut out=Vec::with_capacity(probes.len());
    for probe in probes {
        if !matches!(probe.kind.as_str(),"path"|"planted")||
           !valid_vec(probe.local_point)||probe.bone_uuid.is_empty()||
           !exact_time(probe.start)||!exact_time(probe.end)||
           probe.end>clip_length||
           probe.start>=probe.end||
           (probe.kind=="planted"&&!contacts.iter().any(|c|
                c.kind=="planted"&&c.bone_uuid==probe.bone_uuid&&
                c.start==probe.start&&c.end==probe.end)){
            return Err("TRAJECTORY_PROBE_INVALID".into());
        }
        let mut ancestry=Vec::new();
        if !locate(doc.hierarchy.as_slice(),&probe.bone_uuid,&mut ancestry)||
           ancestry.len()>MAX_DEPTH{
            return Err("TRAJECTORY_BONE_PATH_UNSUPPORTED".into());
        }
        let mut chain=Vec::with_capacity(ancestry.len());
        for id in &ancestry {
            let bone=doc.bones.iter().find(|item|item.uuid==*id)
                .ok_or_else(||"TRAJECTORY_BONE_PATH_UNSUPPORTED".to_string())?;
            source_origin(bone)?;
            bind_rotation(bone)?;
            if ["rotation","position","scale"].iter().any(|channel|
                nonlinear_owners.contains(&(id.clone(),(*channel).to_owned()))) {
                return Err("TRAJECTORY_NONLINEAR_SOURCE_UNSUPPORTED".into());
            }
            // Explicit winding is not inferred; source-linear Euler segments
            // >=180° on any participating ancestor are unsuitable here.
            if let Some(keys)=tracks.get(&(id.clone(),"rotation".into())) {
                if keys.windows(2).any(|pair|(0..3).any(|axis|
                    (pair[1].1[axis]-pair[0].1[axis]).abs()>=180.0)){
                    return Err("TRAJECTORY_EULER_WINDING_UNRESOLVED".into());
                }
            }
            chain.push(bone);
        }
        let times=sample_times(poses,probe.start,probe.end);
        if times.len()<2||times.len()>MAX_SAMPLES {
            return Err("TRAJECTORY_PROBE_SAMPLES_UNSUPPORTED".into());
        }
        let mut positions=Vec::with_capacity(times.len());
        for &time in &times {positions.push(point_at(&chain,tracks,probe.local_point,time)?)}
        let origin=positions[0];
        let path_length=positions.windows(2)
            .map(|pair|distance(pair[0],pair[1])).sum::<f64>();
        let max_displacement=positions.iter().map(|p|distance(*p,origin))
            .fold(0.0_f64,f64::max);
        let max_sampled_speed=positions.windows(2).zip(times.windows(2))
            .map(|(p,t)|distance(p[0],p[1])/(t[1]-t[0]))
            .fold(0.0_f64,f64::max);
        if ![path_length,max_displacement,max_sampled_speed].iter()
            .all(|value|value.is_finite()&&*value<=MAX_POSITION*MAX_SAMPLES as f64){
            return Err("TRAJECTORY_METRICS_LIMIT".into());
        }
        out.push(json!({
            "bone_uuid":probe.bone_uuid,"kind":probe.kind,
            "start":probe.start,"end":probe.end,
            "local_point":probe.local_point,
            "source_space":"RUST_EDITOR_MODEL_ZYX_PROXY",
            "source_interpolation":"LINEAR_KEYS_ONLY",
            "sample_count":times.len(),
            "samples":times.iter().zip(&positions)
                .map(|(time,position)|json!({"time":time,"position":position}))
                .collect::<Vec<_>>(),
            "sampled_path_length":path_length,
            "max_sampled_displacement_from_start":max_displacement,
            "max_sampled_speed":max_sampled_speed,
            "contact_verdict":"UNVERIFIED",
            "continuous_trajectory_verdict":"UNVERIFIED",
            "native_parity":"NOT_EXECUTED",
        }));
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;
    fn bone(id:&str,origin:Vec3,angle:Vec3)->Bone {
        let mut extra=Map::new();
        extra.insert("rotation".into(),json!(angle));
        Bone{uuid:id.into(),name:id.into(),origin:Some(origin),extra}
    }
    #[test]
    fn preview_euler_zyx_and_parent_transforms_have_expected_source_points() {
        let root=bone("root",[0.0;3],[0.0,0.0,90.0]);
        let child=bone("child",[2.0,0.0,0.0],[0.0;3]);
        let empty=Tracks::new();
        let p=point_at(&[&root],&empty,[1.0,0.0,0.0],0.0).unwrap();
        assert!(p[0].abs()<1e-10&&(p[1]-1.0).abs()<1e-10);
        let p=point_at(&[&root,&child],&empty,[0.0;3],0.0).unwrap();
        assert!(p[0].abs()<1e-10&&(p[1]-2.0).abs()<1e-10);
    }
    #[test]
    fn animated_source_rotation_moves_marker_but_cannot_prove_contact() {
        let root=bone("root",[0.0;3],[0.0;3]);
        let mut tracks=Tracks::new();
        tracks.insert(("root".into(),"rotation".into()),vec![
            (0.0,[0.0;3]),(0.5,[0.0,0.0,90.0]),(1.0,[0.0;3]),
        ]);
        let p=point_at(&[&root],&tracks,[1.0,0.0,0.0],0.5).unwrap();
        assert!(p[0].abs()<1e-10&&(p[1]-1.0).abs()<1e-10);
        let p=point_at(&[&root],&tracks,[1.0,0.0,0.0],0.25).unwrap();
        assert!((p[0]-2.0_f64.sqrt()/2.0).abs()<1e-10);
        assert!((p[1]-2.0_f64.sqrt()/2.0).abs()<1e-10);
    }
}
