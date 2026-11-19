//! Read-only source Cube-face form evidence for material reasoning.
//! Not lighting, visibility, contact shadows, camera alignment or artistic PASS.
//! A Cube's geometry is the source; this never adds a second shading engine.
use super::{AuthoringDocument, Cube, OutlinerNode};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

const EPS: f64 = 1.0e-8;
const MAX_CONTACT_SAMPLES: usize = 8;

fn side_basis(side: &str) -> (usize, i8, [usize; 2], [i8; 3]) {
    match side {
        "north" => (2, -1, [0, 1], [0, 0, -1]),
        "south" => (2,  1, [0, 1], [0, 0,  1]),
        "east"  => (0,  1, [2, 1], [1, 0,  0]),
        "west"  => (0, -1, [2, 1], [-1, 0, 0]),
        "up"    => (1,  1, [0, 2], [0, 1,  0]),
        "down"  => (1, -1, [0, 2], [0,-1,  0]),
        _ => unreachable!("caller already admits the six saved Cube sides"),
    }
}

fn unrotated(extra: &Map<String, Value>) -> bool {
    extra.get("rotation").is_none_or(|value|
        serde_json::from_value::<[f64;3]>(value.clone()).ok() == Some([0.0;3]))
}
fn axis_cube(cube: &Cube) -> bool {
    unrotated(&cube.extra) &&
    cube.extra.get("inflate").is_none_or(|v| v.as_f64() == Some(0.0)) &&
    cube.extra.get("stretch").is_none_or(|v|
        serde_json::from_value::<[f64;3]>(v.clone()).ok() == Some([1.0;3])) &&
    cube.extra.get("rescale") != Some(&Value::Bool(true)) &&
    cube.extra.get("visibility") != Some(&Value::Bool(false)) &&
    (0..3).all(|i| cube.to[i]-cube.from[i] > EPS)
}

/// Locate direct siblings in the actual saved Outliner, not by name or
/// arbitrary overlapping bounding boxes from unrelated Bones.
fn direct_cube_siblings<'a>(
    nodes: &'a [OutlinerNode], target: &str, ancestors: &mut Vec<&'a str>,
) -> Option<(Vec<&'a str>, Vec<&'a str>)> {
    if nodes.iter().any(|node| matches!(node, OutlinerNode::Cube(id) if id == target)) {
        return Some((ancestors.clone(),nodes.iter().filter_map(|node|match node {
            OutlinerNode::Cube(id) if id != target => Some(id.as_str()),
            _ => None,
        }).collect()));
    }
    for node in nodes {
        if let OutlinerNode::Bone(bone) = node {
            ancestors.push(&bone.uuid);
            let found = direct_cube_siblings(&bone.children,target,ancestors);
            ancestors.pop();
            if found.is_some() { return found; }
        }
    }
    None
}
fn face_contact_fraction(target: &Cube, other: &Cube,
    axis: usize, sign: i8, plane_axes: [usize; 2]) -> Option<f64> {
    let plane = if sign < 0 { target.from[axis] } else { target.to[axis] };
    let other_plane = if sign < 0 { other.to[axis] } else { other.from[axis] };
    if (plane-other_plane).abs() > EPS { return None; }
    let mut intersection = 1.0;
    let mut face_area = 1.0;
    for tangent in plane_axes {
        let extent = target.to[tangent]-target.from[tangent];
        let common = target.to[tangent].min(other.to[tangent])
            - target.from[tangent].max(other.from[tangent]);
        if extent <= EPS || common <= EPS { return None; }
        face_area *= extent;
        intersection *= common;
    }
    (face_area > EPS).then_some((intersection/face_area).clamp(0.0,1.0))
}

/// Called only after native document validation and an explicit Cube-face
/// texture/UV binding. A local contact is a candidate for PAINT review,
/// never a generated shadow, occlusion proof, light direction or paint grant.
pub(super) fn inspect_source_form(
    doc: &AuthoringDocument, cube: &Cube, side: &str,
    face_texels: Option<[u32;2]>,
) -> Value {
    let (normal_axis, normal_sign, tangents, local_normal) = side_basis(side);
    let extent: [f64;2] = tangents.map(|axis|cube.to[axis]-cube.from[axis]);
    let density: [Option<f64>;2] = face_texels.map(|pixels|
        std::array::from_fn(|i| (extent[i] > EPS)
            .then_some(pixels[i] as f64 / extent[i]))
    ).unwrap_or([None,None]);
    let hierarchy = direct_cube_siblings(
        &doc.hierarchy, &cube.uuid, &mut Vec::new());
    // Nonzero Bone rotation invalidates model-axis normals, even though
    // shared parent-local Cube contacts can remain valid for a static pose.
    let model_axis_normal = if axis_cube(cube) && hierarchy.as_ref().is_some_and(
        |(parents,_)| parents.iter().all(|uuid|
            doc.bones.iter().find(|bone|bone.uuid == *uuid)
                .is_some_and(|bone|unrotated(&bone.extra)))) {
        Some(local_normal)
    } else { None };
    let mut contacts=Vec::new();
    let mut contact_count=0usize;
    let mut unsupported_neighbors=0usize;
    let contact_status = if !axis_cube(cube) || hierarchy.is_none() {
        "UNVERIFIED_CUBE_TRANSFORM_OR_HIERARCHY"
    } else {
        let (_,siblings)=hierarchy.as_ref().expect("checked above");
        let ids: HashSet<&str> = siblings.iter().copied().collect();
        for other in &doc.cubes {
            if !ids.contains(other.uuid.as_str()) { continue; }
            if !axis_cube(other) { unsupported_neighbors+=1; continue; }
            if let Some(fraction) = face_contact_fraction(
                cube,other,normal_axis,normal_sign,tangents) {
                contact_count+=1;
                if contacts.len()<MAX_CONTACT_SAMPLES {
                    contacts.push(json!({"cube_uuid":other.uuid,
                        "face_overlap_fraction":fraction,
                        "relationship":"coplanar_outward_face_contact"}));
                }
            }
        }
        "PARENT_LOCAL_STATIC_AXIS_ALIGNED_ONLY"
    };
    json!({
        "scope":"saved_cube_face_form_context",
        "cube_uuid":cube.uuid,"face":side,
        "normal_cube_local":local_normal,
        "normal_saved_model_axis":model_axis_normal,
        "plane_axes":tangents.map(|axis|["x","y","z"][axis]),
        "extent_model_units":extent,
        "face_local_texels":face_texels,
        "texels_per_model_unit":density,
        "uv_orientation_status":if face_texels.is_some() {
            "SOURCE_UV_FACE_LOCAL" } else { "UNVERIFIED_UV_ROTATION" },
        "contact_analysis":{
            "status":contact_status,
            "checked_scope":"static_direct_parent_cube_siblings_only",
            "contact_count":contact_count,
            "unsupported_neighbor_count":unsupported_neighbors,
            "contacts":contacts,
            "samples_truncated":contact_count>MAX_CONTACT_SAMPLES
        },
        "lighting_verdict":"UNVERIFIED",
        "world_visibility_verdict":"UNVERIFIED",
        "animated_pose_verdict":"UNVERIFIED",
        "visual_verdict":"UNVERIFIED",
        "form_shading_verdict":"UNVERIFIED"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const CUBE: &str = "00000000-0000-4000-8000-000000000002";
    fn doc() -> AuthoringDocument {
        AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel"))
            .unwrap()
    }
    #[test]
    fn rotated_parent_preserves_local_normal_but_never_invents_model_axis_normal() {
        let d=doc();let before=d.clone();
        let r=inspect_source_form(&d,&d.cubes[0],"north",Some([4,4]));
        assert_eq!(r["normal_cube_local"],json!([0,0,-1]));
        assert_eq!(r["normal_saved_model_axis"],Value::Null);
        assert_eq!(r["plane_axes"],json!(["x","y"]));
        assert_eq!(r["texels_per_model_unit"],json!([1.0,1.0]));
        assert_eq!(r["contact_analysis"]["status"],"PARENT_LOCAL_STATIC_AXIS_ALIGNED_ONLY");
        assert_eq!(r["world_visibility_verdict"],"UNVERIFIED");
        assert_eq!(r["form_shading_verdict"],"UNVERIFIED");
        assert_eq!(d,before);
    }
    #[test]
    fn reports_exact_same_parent_face_contact_but_not_global_occlusion() {
        let mut d=doc();
        let mut sibling=d.cubes[0].clone();
        sibling.uuid="00000000-0000-4000-8000-000000009999".into();
        sibling.from=[4.0,0.0,0.0];
        sibling.to=[8.0,4.0,4.0];
        d.cubes.push(sibling);
        let OutlinerNode::Bone(root)=&mut d.hierarchy[0] else {panic!("root bone");};
        let OutlinerNode::Bone(child)=&mut root.children[0] else {panic!("child bone");};
        child.children.push(OutlinerNode::Cube(
            "00000000-0000-4000-8000-000000009999".into()));
        d.validate().unwrap();
        let r=inspect_source_form(&d,&d.cubes[0],"east",Some([4,4]));
        assert_eq!(r["contact_analysis"]["contact_count"],json!(1));
        assert_eq!(r["contact_analysis"]["contacts"][0]["face_overlap_fraction"],json!(1.0));
        assert_eq!(r["contact_analysis"]["contacts"][0]["cube_uuid"],
            json!("00000000-0000-4000-8000-000000009999"));
        assert_eq!(r["world_visibility_verdict"],"UNVERIFIED");
        // Rotate the sibling: an AABB is no longer a truthful contact test.
        d.cubes[1].extra.insert("rotation".into(),json!([0,45,0]));
        let unsafe_neighbor=inspect_source_form(&d,&d.cubes[0],"east",Some([4,4]));
        assert_eq!(unsafe_neighbor["contact_analysis"]["contact_count"],json!(0));
        assert_eq!(unsafe_neighbor["contact_analysis"]["unsupported_neighbor_count"],json!(1));
        assert_eq!(d.cubes[0].uuid,CUBE);
    }
    #[test]
    fn rotated_or_nonrigid_cube_remains_local_only_even_with_known_uv() {
        let mut d=doc();
        d.cubes[0].extra.insert("rotation".into(),json!([0,30,0]));
        let r=inspect_source_form(&d,&d.cubes[0],"east",Some([4,4]));
        assert_eq!(r["normal_cube_local"],json!([1,0,0]));
        assert_eq!(r["normal_saved_model_axis"],Value::Null);
        assert_eq!(r["contact_analysis"]["status"],
            "UNVERIFIED_CUBE_TRANSFORM_OR_HIERARCHY");
        let uv_unknown=inspect_source_form(&d,&d.cubes[0],"east",None);
        assert_eq!(uv_unknown["face_local_texels"],Value::Null);
        assert_eq!(uv_unknown["uv_orientation_status"],"UNVERIFIED_UV_ROTATION");
    }
}
