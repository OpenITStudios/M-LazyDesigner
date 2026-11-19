//! G2.3: read-only local-frame OBB contact evidence for rotated same-Bone Cubes.
//! Uses saved Cube pivot and the viewport's ZYX Euler convention. No mesh,
//! world-pose, alpha/material, cross-Bone, animation or visual acceptance.
use super::Cube;
use serde_json::{json, Value};
use std::collections::HashMap;

const EPS: f64 = 1.0e-8;
const CONTACT_EPS: f64 = 1.0e-5;
const SAMPLE_LIMIT: usize = 16;

type Vec3 = [f64; 3];
#[derive(Clone, Copy)]
struct Box3 {
    center: Vec3,
    axes: [Vec3; 3],
    half: Vec3,
    rotated: bool,
}
fn dot(a: Vec3, b: Vec3) -> f64 { (0..3).map(|i| a[i] * b[i]).sum() }
fn sub(a: Vec3, b: Vec3) -> Vec3 { std::array::from_fn(|i| a[i] - b[i]) }
fn add(a: Vec3, b: Vec3) -> Vec3 { std::array::from_fn(|i| a[i] + b[i]) }
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}
fn rotate_zyx(v: Vec3, degrees: Vec3) -> Vec3 {
    let (sx, cx) = degrees[0].to_radians().sin_cos();
    let (sy, cy) = degrees[1].to_radians().sin_cos();
    let (sz, cz) = degrees[2].to_radians().sin_cos();
    // Rz * Ry * Rx: matches RustViewport's THREE.Euler order 'ZYX'.
    let rx = [v[0], cx*v[1]-sx*v[2], sx*v[1]+cx*v[2]];
    let ry = [cy*rx[0]+sy*rx[2], rx[1], -sy*rx[0]+cy*rx[2]];
    [cz*ry[0]-sz*ry[1], sz*ry[0]+cz*ry[1], ry[2]]
}
fn box_from(cube: &Cube, bounds: (Vec3, Vec3)) -> Option<Box3> {
    let (from, to) = bounds;
    if (0..3).any(|i| !from[i].is_finite() || !to[i].is_finite() ||
        to[i]-from[i] <= EPS) {
        return None;
    }
    let rotation: Vec3 = cube.extra.get("rotation")
        .map(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or(Some([0.0; 3]))?;
    let stretch: Vec3 = cube.extra.get("stretch")
        .map(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or(Some([1.0; 3]))?;
    let inflate = cube.extra.get("inflate").map(Value::as_f64)
        .unwrap_or(Some(0.0))?;
    if rotation.iter().any(|v| !v.is_finite()) ||
       stretch != [1.0; 3] || inflate != 0.0 {
        return None;
    }
    let rotated = rotation != [0.0; 3];
    let pivot = if rotated { cube.origin? } else { [0.0; 3] };
    if pivot.iter().any(|v| !v.is_finite()) { return None; }
    let local_center = std::array::from_fn(|i| (from[i]+to[i])/2.0);
    let center = if rotated {
        add(pivot, rotate_zyx(sub(local_center,pivot),rotation))
    } else { local_center };
    let axes = std::array::from_fn(|i| {
        let basis = std::array::from_fn(|j| f64::from((i == j) as u8));
        if rotated { rotate_zyx(basis, rotation) } else { basis }
    });
    let half = std::array::from_fn(|i| (to[i]-from[i])/2.0);
    (center.iter().chain(axes.iter().flatten()).chain(half.iter())
        .all(|v| v.is_finite())).then_some(Box3{center,axes,half,rotated})
}
fn radius(b: &Box3, axis: Vec3) -> f64 {
    (0..3).map(|i| b.half[i] * dot(b.axes[i],axis).abs()).sum()
}
#[derive(Clone, Copy, PartialEq, Debug)]
enum Relation { Separate, Touching, Intersecting }
fn contact(a: &Box3, b: &Box3) -> (Relation, f64) {
    let offset = sub(b.center,a.center);
    let mut largest_gap = f64::NEG_INFINITY;
    let mut consider = |vector: Vec3| {
        let length = dot(vector,vector).sqrt();
        if length <= EPS { return; }
        let axis = vector.map(|v|v/length);
        let gap = dot(offset,axis).abs() - radius(a,axis) - radius(b,axis);
        largest_gap = largest_gap.max(gap);
    };
    for axis in a.axes { consider(axis); }
    for axis in b.axes { consider(axis); }
    for aa in a.axes { for bb in b.axes { consider(cross(aa,bb)); } }
    if largest_gap > CONTACT_EPS { (Relation::Separate,0.0) }
    else if largest_gap >= -CONTACT_EPS { (Relation::Touching,0.0) }
    else { (Relation::Intersecting,-largest_gap) }
}

/// Additional evidence beside the unchanged AABB report. Compare ONLY
/// affected unrotated Cubes with supported rotated direct siblings.
pub(super) fn rotated_neighbor_review(
    siblings: &[&Cube], changed: &HashMap<String,(Vec3,Vec3)>
) -> Value {
    let mut supported = Vec::with_capacity(siblings.len());
    let mut unsupported = 0usize;
    for cube in siblings {
        if let Some(b) = box_from(cube, (cube.from,cube.to)) {
            supported.push((cube,b));
        } else { unsupported += 1; }
    }
    let mut checked = 0usize;
    let mut introduced = 0usize;
    let mut preexisting = 0usize;
    let mut resolved = 0usize;
    let mut introduced_touching = 0usize;
    let mut samples = Vec::new();
    for (cube, before) in &supported {
        let Some(bounds) = changed.get(&cube.uuid) else { continue };
        // The existing G2 planner admits no rotated source edits.
        if before.rotated { continue; }
        let Some(after) = box_from(cube, *bounds) else { continue };
        for (neighbor, other) in &supported {
            if cube.uuid == neighbor.uuid || !other.rotated { continue; }
            checked += 1;
            let (old_relation, _) = contact(before,other);
            let (new_relation, depth) = contact(&after,other);
            if old_relation != Relation::Intersecting &&
               new_relation == Relation::Intersecting {
                introduced += 1;
                if samples.len() < SAMPLE_LIMIT {
                    let mut pair = [cube.uuid.as_str(),neighbor.uuid.as_str()];
                    pair.sort_unstable();
                    samples.push(json!({
                        "cube_uuids":pair,"penetration_depth":depth
                    }));
                }
            } else if old_relation == Relation::Intersecting &&
                      new_relation == Relation::Intersecting {
                preexisting += 1;
            } else if old_relation == Relation::Intersecting &&
                      new_relation != Relation::Intersecting {
                resolved += 1;
            }
            if old_relation == Relation::Separate &&
               new_relation == Relation::Touching {
                introduced_touching += 1;
            }
        }
    }
    json!({
        "scope":"affected_vs_rotated_direct_same_bone_cube_obb",
        "checked_pair_count":checked,
        "introduced_intersection_count":introduced,
        "preexisting_intersection_count":preexisting,
        "resolved_intersection_count":resolved,
        "introduced_touching_count":introduced_touching,
        "unsupported_neighbor_count":unsupported,
        "introduced_samples":samples,
        "samples_truncated":introduced > SAMPLE_LIMIT,
        "whole_model_collision_verdict":"UNVERIFIED",
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json,Map};

    fn cube(id:&str,from:Vec3,to:Vec3,rot:f64) -> Cube {
        let mut extra=Map::new();
        if rot != 0.0 { extra.insert("rotation".into(),json!([0,rot,0])); }
        Cube{uuid:id.into(),kind:"cube".into(),name:Some(id.into()),
            from,to,origin:Some([0.0,0.0,0.0]),uv_offset:None,
            faces:Map::new(),extra}
    }
    #[test]
    fn obb_sat_distinguishes_separation_touching_and_intersection() {
        let a=cube("a",[0.0;3],[2.0;3],0.0);
        let b=cube("b",[2.0,0.0,0.0],[4.0,2.0,2.0],0.0);
        let x=box_from(&a,(a.from,a.to)).unwrap();
        let touch=box_from(&b,(b.from,b.to)).unwrap();
        assert_eq!(contact(&x,&touch).0,Relation::Touching);
        let inside=box_from(&b,([1.0,0.0,0.0],[3.0,2.0,2.0])).unwrap();
        assert_eq!(contact(&x,&inside).0,Relation::Intersecting);
        let apart=box_from(&b,([5.0,0.0,0.0],[7.0,2.0,2.0])).unwrap();
        assert_eq!(contact(&x,&apart).0,Relation::Separate);
    }
    #[test]
    fn rotated_pivot_matters_and_noncommuting_xyz_uses_viewport_order() {
        let rotated=cube("turn",[3.0,-1.0,-1.0],[5.0,1.0,1.0],90.0);
        let b=box_from(&rotated,(rotated.from,rotated.to)).unwrap();
        assert!((b.center[2]+4.0).abs()<1e-8);
        assert!(b.center[0].abs()<1e-8);
        let x=rotate_zyx([1.0,0.0,0.0],[90.0,90.0,90.0]);
        assert!((x[0]).abs()<1e-8);
        assert!((x[1]).abs()<1e-8);
        assert!((x[2]+1.0).abs()<1e-8);
    }
    #[test]
    fn rotated_overlap_review_counts_affected_only_and_preserves_source() {
        let moved=cube("move",[12.0,0.0,0.0],[16.0,4.0,4.0],0.0);
        let mut turn=cube("turn",[0.0,0.0,0.0],[4.0,4.0,4.0],45.0);
        turn.origin=Some([2.0,2.0,2.0]);
        let prior=serde_json::to_value(&turn).unwrap();
        let siblings=[&moved,&turn];
        let changed=HashMap::from([("move".to_string(),
            ([3.0,0.0,0.0],[7.0,4.0,4.0]))]);
        let report=rotated_neighbor_review(&siblings,&changed);
        assert_eq!(report["checked_pair_count"],1);
        assert_eq!(report["introduced_intersection_count"],1);
        assert_eq!(report["introduced_samples"][0]["cube_uuids"],json!(["move","turn"]));
        assert_eq!(report["whole_model_collision_verdict"],"UNVERIFIED");
        assert_eq!(serde_json::to_value(&turn).unwrap(),prior);
        turn.extra.insert("inflate".into(),json!(0.5));
        let unsupported=rotated_neighbor_review(&[&moved,&turn],&changed);
        assert_eq!(unsupported["checked_pair_count"],0);
        assert_eq!(unsupported["unsupported_neighbor_count"],1);
    }
}
