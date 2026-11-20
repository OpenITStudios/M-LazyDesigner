//! G4 read-only saved Geometry impact. No inferred attachment graph, edit
//! plan, UV overlap, animated pose, visual approval or source mutation.
use super::{AuthoringDocument, Cube, OutlinerNode, Result};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
const MAX_RELATED: usize = 12;
const MAX_ANCESTORS: usize = 24;
const MAX_BYTES: usize = 16 * 1024;

fn path_for(nodes: &[OutlinerNode], cube: &str, path: &mut Vec<String>) -> bool {
    for node in nodes {
        match node {
            OutlinerNode::Cube(uuid) if uuid == cube => return true,
            OutlinerNode::Bone(bone) => {
                path.push(bone.uuid.clone());
                if path_for(&bone.children, cube, path) { return true; }
                path.pop();
            }
            _ => {}
        }
    }
    false
}
fn children_of<'a>(nodes: &'a [OutlinerNode], parent: &str)
    -> Option<&'a [OutlinerNode]>
{
    for node in nodes {
        if let OutlinerNode::Bone(bone) = node {
            if bone.uuid == parent { return Some(&bone.children); }
            if let Some(found) = children_of(&bone.children, parent) {
                return Some(found);
            }
        }
    }
    None
}
fn declared_atlases(doc: &AuthoringDocument, cube: &Cube) -> (Vec<String>, bool) {
    let mut refs = Vec::new();
    let mut unknown = false;
    for face in cube.faces.values() {
        let texture = match face.get("texture") {
            Some(t) => t,
            None => { unknown = true; continue; }
        };
        let matched = match texture {
            Value::String(uuid) => doc.texture_assets.iter().find(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())),
            Value::Number(n) => n.as_u64()
                .and_then(|i| usize::try_from(i).ok())
                .and_then(|i| doc.texture_assets.get(i)),
            Value::Null => continue,
            _ => None,
        };
        if let Some(uuid) = matched.and_then(|a| a.get("uuid").and_then(Value::as_str)) {
            refs.push(uuid.to_string());
        } else { unknown = true; }
    }
    refs.sort(); refs.dedup();
    (refs, unknown)
}

/// Ephemeral atlas relation index for multiple geometry-impact selectors
/// from ONE already validated immutable Rust batch. A single-Cube read keeps
/// the direct source path and allocates no atlas index.
pub(super) struct GeometryImpactIndex {
    cube_positions: HashMap<String, usize>,
    cube_atlases: Vec<(Vec<String>, bool)>,
    atlas_users: HashMap<String, Vec<usize>>,
    any_unknown_texture_link: bool,
}

impl GeometryImpactIndex {
    pub(super) fn new(doc: &AuthoringDocument) -> Self {
        let mut cube_positions = HashMap::with_capacity(doc.cubes.len());
        let mut cube_atlases = Vec::with_capacity(doc.cubes.len());
        let mut atlas_users: HashMap<String, Vec<usize>> = HashMap::new();
        let mut any_unknown_texture_link = false;
        for (position, cube) in doc.cubes.iter().enumerate() {
            let (atlases, unknown) = declared_atlases(doc, cube);
            any_unknown_texture_link |= unknown;
            for atlas in &atlases {
                atlas_users.entry(atlas.clone()).or_default().push(position);
            }
            cube_positions.insert(cube.uuid.clone(), position);
            cube_atlases.push((atlases, unknown));
        }
        Self { cube_positions, cube_atlases, atlas_users,
            any_unknown_texture_link }
    }
}

/// A validated batch with several related Cube-impact queries may share
/// this index; it never survives the immutable CLI inspection call.
pub(super) fn inspect_geometry_impact_indexed(
    doc: &AuthoringDocument, cube_uuid: &str, change: &str,
    index: &GeometryImpactIndex,
) -> Result<Value> {
    inspect_geometry_impact_with_index(doc, cube_uuid, change, Some(index))
}

/// Interpret one explicitly selected Cube only. Parent/texture/animator
/// relations are exact saved facts; peers are advisory and may be unrelated.
/// The caller MUST use the canonical source validation and SHA admission.
pub fn inspect_geometry_impact(doc: &AuthoringDocument, cube_uuid: &str, change: &str)
    -> Result<Value>
{
    inspect_geometry_impact_with_index(doc, cube_uuid, change, None)
}

fn inspect_geometry_impact_with_index(
    doc: &AuthoringDocument, cube_uuid: &str, change: &str,
    index: Option<&GeometryImpactIndex>,
) -> Result<Value> {
    if !matches!(change, "reshape" | "translate" | "texture" | "pose") {
        return Err("GEOMETRY_IMPACT_CHANGE_INVALID".into());
    }
    let cube_position = index
        .map(|index| index.cube_positions.get(cube_uuid).copied())
        .unwrap_or_else(|| doc.cubes.iter().position(|c| c.uuid == cube_uuid))
        .ok_or_else(|| "GEOMETRY_IMPACT_CUBE_NOT_FOUND".to_string())?;
    let cube = &doc.cubes[cube_position];
    let mut ancestors = Vec::new();
    if !path_for(&doc.hierarchy, cube_uuid, &mut ancestors) {
        return Err("GEOMETRY_IMPACT_HIERARCHY_UNKNOWN".into());
    }
    let parent = ancestors.last().cloned();
    let siblings = match parent.as_deref() {
        Some(parent) => children_of(&doc.hierarchy, parent)
            .ok_or_else(|| "GEOMETRY_IMPACT_HIERARCHY_UNKNOWN".to_string())?,
        None => doc.hierarchy.as_slice(),
    };
    let mut sibling_ids = Vec::new();
    let mut sibling_count = 0;
    for node in siblings {
        if let OutlinerNode::Cube(id) = node {
            if id != cube_uuid {
                sibling_count += 1;
                if sibling_ids.len() < MAX_RELATED { sibling_ids.push(id.clone()); }
            }
        }
    }
    let (atlas_ids, mut unknown_texture_links) = match index {
        Some(index) => index.cube_atlases[cube_position].clone(),
        None => declared_atlases(doc, cube),
    };
    let mut peer_ids = Vec::new();
    let mut peer_count = 0;
    if !atlas_ids.is_empty() {
        if let Some(index) = index {
            // The direct scanner ORs unknown bindings from ALL other Cubes
            // whenever the target has an atlas; preserve that exact contract.
            unknown_texture_links |= index.any_unknown_texture_link;
            let mut peers = BTreeSet::new();
            for atlas in &atlas_ids {
                if let Some(users) = index.atlas_users.get(atlas) {
                    for &position in users {
                        if position != cube_position { peers.insert(position); }
                    }
                }
            }
            peer_count = peers.len();
            // BTreeSet positions follow the same saved Cube order as the
            // original scan, including the first twelve reported peers.
            peer_ids = peers.into_iter().take(MAX_RELATED)
                .map(|position| doc.cubes[position].uuid.clone()).collect();
        } else {
            for other in doc.cubes.iter().filter(|c| c.uuid != cube_uuid) {
                let (refs, unknown) = declared_atlases(doc, other);
                unknown_texture_links |= unknown;
                if refs.iter().any(|id| atlas_ids.contains(id)) {
                    peer_count += 1;
                    if peer_ids.len() < MAX_RELATED { peer_ids.push(other.uuid.clone()); }
                }
            }
        }
    }
    let mut animation_ids = Vec::new();
    let mut animation_count = 0;
    for asset in doc.animation_assets.iter() {
        if asset.get("animators").and_then(Value::as_object)
            .is_some_and(|tracks| ancestors.iter().any(|bone| tracks.contains_key(bone))) {
            animation_count += 1;
            if animation_ids.len() < MAX_RELATED {
                if let Some(uuid) = asset.get("uuid").and_then(Value::as_str) {
                    animation_ids.push(uuid.to_string());
                }
            }
        }
    }
    let ancestor_count = ancestors.len();
    let ancestor_bone_uuids: Vec<&str> = ancestors.iter().rev().take(MAX_ANCESTORS)
        .rev().map(String::as_str).collect();
    let dimensions: [f64; 3] = std::array::from_fn(|i| cube.to[i]-cube.from[i]);
    let mut reasons = Vec::new();
    if sibling_count > 0 && change != "texture" {
        reasons.push("SAME_PARENT_NEIGHBORS_NOT_CONTACT_PROOF");
    }
    if !atlas_ids.is_empty() && change != "pose" {
        reasons.push("SAVED_UV_AND_ATLAS_REQUIRE_REVIEW");
    }
    if peer_count > 0 && change != "pose" {
        reasons.push("OTHER_ATLAS_USERS_NOT_UV_ALIAS_PROOF");
    }
    if unknown_texture_links && change != "pose" {
        reasons.push("IMPLICIT_TEXTURE_BINDINGS_UNRESOLVED");
    }
    if animation_count > 0 && change != "texture" {
        reasons.push("ANIMATED_BONE_POSES_REQUIRE_REVIEW");
    }
    reasons.push("REFERENCE_VISUAL_FIDELITY_UNVERIFIED");
    let result = json!({
        "scope":"saved_geometry_impact_advisory",
        "cube_uuid":cube_uuid,"change":change,"parent_bone_uuid":parent,
        "ancestor_count":ancestor_count,"ancestor_bone_uuids":ancestor_bone_uuids,
        "ancestors_truncated":ancestor_count>MAX_ANCESTORS,
        "dimensions":dimensions,
        "same_parent_cube_uuids":sibling_ids,"same_parent_cube_count":sibling_count,
        "same_parent_truncated":sibling_count>MAX_RELATED,
        "declared_texture_uuids":atlas_ids,
        "same_atlas_cube_uuids":peer_ids,"same_atlas_cube_count":peer_count,
        "same_atlas_truncated":peer_count>MAX_RELATED,
        "texture_relations_complete":!unknown_texture_links,
        "matching_animation_uuids":animation_ids,
        "matching_animation_count":animation_count,
        "matching_animation_truncated":animation_count>MAX_RELATED,
        "animation_relation_verdict":"EXACT_KEYS_ONLY",
        "review_reasons":reasons,
        "collision_verdict":"UNVERIFIED","visual_verdict":"UNVERIFIED",
        "write_authority":"NOT_GRANTED","source_change_verdict":"NOT_APPLIED"
    });
    if serde_json::to_vec(&result)
        .map_err(|_| "GEOMETRY_IMPACT_SERIALIZE_FAILED".to_string())?.len() > MAX_BYTES {
        return Err("GEOMETRY_IMPACT_RESULT_TOO_LARGE".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{AuthoringDocument, Bone, Cube, EditOperation, EditorSession};
    use serde_json::json;
    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const BONE: &str = "00000000-0000-4000-8000-000000007401";
    const A: &str = "00000000-0000-4000-8000-000000007402";
    const B: &str = "00000000-0000-4000-8000-000000007403";
    const T: &str = "00000000-0000-4000-8000-000000007404";
    const CLIP: &str = "00000000-0000-4000-8000-000000007405";
    const KEY: &str = "00000000-0000-4000-8000-000000007406";
    #[test]
    fn source_impact_is_bounded_exact_and_nonmutating() {
        let mut s = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Impact", "impact").unwrap()
        ).unwrap();
        let source: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut a: Cube = serde_json::from_value(source["elements"][0].clone()).unwrap();
        a.uuid = A.into(); a.name = Some("front".into());
        let mut b = a.clone(); b.uuid = B.into(); b.name = Some("back".into());
        let bone: Bone = serde_json::from_value(json!({
            "uuid":BONE,"name":"body","origin":[0,0,0]
        })).unwrap();
        s.apply(0,&[
            EditOperation::AddBone{bone,parent_uuid:None},
            EditOperation::AddCube{cube:a,bone_uuid:BONE.into()},
            EditOperation::AddCube{cube:b,bone_uuid:BONE.into()},
            EditOperation::CreatePaintTexture{uuid:T.into(),name:"body.png".into()},
            EditOperation::AssignCubeTexture{cube_uuid:A.into(),texture_uuid:T.into()},
            EditOperation::AssignCubeTexture{cube_uuid:B.into(),texture_uuid:T.into()},
            EditOperation::CreateAnimation{uuid:CLIP.into(),name:"idle".into(),length:2.0},
            EditOperation::AddBoneTransformKeyframe{
                animation_uuid:CLIP.into(),bone_uuid:BONE.into(),
                keyframe_uuid:KEY.into(),channel:"rotation".into(),
                time:0.5,value:[0.0,10.0,0.0],
            },
        ]).unwrap();
        let before = s.export().unwrap();
        let value = inspect_geometry_impact(s.document(),A,"reshape").unwrap();
        assert_eq!(value["parent_bone_uuid"],BONE);
        assert_eq!(value["same_parent_cube_uuids"],json!([B]));
        assert_eq!(value["declared_texture_uuids"],json!([T]));
        assert_eq!(value["same_atlas_cube_uuids"],json!([B]));
        assert_eq!(value["matching_animation_uuids"],json!([CLIP]));
        assert_eq!(value["write_authority"],"NOT_GRANTED");
        assert_eq!(s.export().unwrap(),before);
        assert_eq!(s.summary().revision,1);
    }
    // SOURCE_AUTHORED_NOT_RUN: index never creates a second semantic owner.
    // Multiple same-atlas targets, >12 deterministic peers and unresolved
    // links must match the original single-read report byte-for-byte.
    #[test]
    fn transient_index_matches_direct_impacts_and_preserves_peer_order() {
        let mut session=EditorSession::open(SAMPLE).unwrap();
        let cube="00000000-0000-4000-8000-000000000002";
        let texture="00000000-0000-4000-8000-000000007499";
        let mut operations=vec![
            EditOperation::CreatePaintTexture {
                uuid:texture.into(),name:"shared.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:cube.into(),texture_uuid:texture.into(),
            },
        ];
        for number in 0..17 {
            operations.push(EditOperation::DuplicateCube {
                source_uuid:cube.into(),
                new_uuid:format!("00000000-0000-4000-8000-{:012x}",0x7600+number),
            });
        }
        session.apply(0,&operations).unwrap();
        let original=session.document().clone();
        let index=GeometryImpactIndex::new(&original);
        for target in original.cubes.iter().map(|item|item.uuid.as_str()) {
            for change in ["reshape","translate","texture","pose"] {
                assert_eq!(
                    inspect_geometry_impact_indexed(&original,target,change,&index).unwrap(),
                    inspect_geometry_impact(&original,target,change).unwrap()
                );
            }
        }
        let report=inspect_geometry_impact_indexed(&original,cube,"reshape",&index).unwrap();
        assert_eq!(report["same_atlas_cube_count"],17);
        assert_eq!(report["same_atlas_truncated"],true);
        assert_eq!(report["same_atlas_cube_uuids"],json!(
            original.cubes.iter().filter(|item|item.uuid!=cube)
                .take(MAX_RELATED).map(|item|item.uuid.clone()).collect::<Vec<_>>()
        ));
        // The source scanner must not turn an unknown face link on ANY
        // other atlas user into a false "all texture relations complete".
        let mut ambiguous=original.clone();
        ambiguous.cubes.last_mut().unwrap().faces
            .get_mut("north").unwrap().as_object_mut().unwrap()
            .remove("texture");
        let index=GeometryImpactIndex::new(&ambiguous);
        let cached=inspect_geometry_impact_indexed(
            &ambiguous,cube,"texture",&index).unwrap();
        let direct=inspect_geometry_impact(&ambiguous,cube,"texture").unwrap();
        assert_eq!(cached,direct);
        assert_eq!(cached["texture_relations_complete"],false);
        assert_eq!(inspect_geometry_impact_indexed(
            &original,"not-a-cube","reshape",&GeometryImpactIndex::new(&original)
        ).unwrap_err(),"GEOMETRY_IMPACT_CUBE_NOT_FOUND");
        assert_eq!(inspect_geometry_impact_indexed(
            &original,cube,"unknown",&GeometryImpactIndex::new(&original)
        ).unwrap_err(),"GEOMETRY_IMPACT_CHANGE_INVALID");
        assert_eq!(session.document(),&original);
    }

    #[test]
    fn refuses_unknown_cube_or_unrecognised_intent() {
        let s = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Impact","impact").unwrap()
        ).unwrap();
        assert_eq!(inspect_geometry_impact(s.document(),"missing","reshape")
            .unwrap_err(),"GEOMETRY_IMPACT_CUBE_NOT_FOUND");
        assert_eq!(inspect_geometry_impact(s.document(),"missing","auto_apply")
            .unwrap_err(),"GEOMETRY_IMPACT_CHANGE_INVALID");
    }
}
