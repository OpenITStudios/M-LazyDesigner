//! G2: one-shot, source-bound Cuboid face attachment proposal.
//! Local axis-aligned cuboids under the SAME Bone only; no scene solver,
//! persistent constraint, painter, filesystem mutation or visual approval.
//! SOURCE_ONLY: Cargo, Windows and Blockbench execution NOT_EXECUTED.

use super::{
    fail, outliner_parent_uuid, valid_bounds, valid_uuid, valid_vec3, Cube,
    EditOperation, EditPlan, EditorSession, Result, MAX_PLAN_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Tangent offsets are in ascending *other* axes:
/// ±X face: [Y, Z]; ±Y face: [X, Z]; ±Z face: [X, Y].
/// Clearance is a nonnegative separation along the anchor face normal.
/// This does not constrain future resizes or prove whole-model collisions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryFaceAttachmentRequest {
    pub expected_revision: u64,
    pub anchor_cube_uuid: String,
    pub moving_cube_uuid: String,
    pub anchor_face: String,
    pub moving_face: String,
    pub clearance: f64,
    pub tangent_offset: [f64; 2],
}

/// No commit or file publication; the returned existing EditPlan still needs
/// the caller's independent write approval before the canonical Apply.
#[derive(Debug, Clone, Serialize)]
pub struct GeometryFaceAttachmentProposal {
    pub plan: EditPlan,
    pub preflight: Value,
    pub diagnostic: Value,
}

fn face_axis_sign(name: &str) -> Result<(usize, f64)> {
    match name {
        "east"  => Ok((0,  1.0)),
        "west"  => Ok((0, -1.0)),
        "up"    => Ok((1,  1.0)),
        "down"  => Ok((1, -1.0)),
        "south" => Ok((2,  1.0)),
        "north" => Ok((2, -1.0)),
        _ => Err(fail("GEOMETRY_ATTACHMENT_FACE_INVALID")),
    }
}

pub(super) fn bounded_unrotated_box(cube: &Cube) -> Result<()> {
    // A zero-span plane or rotated/inflated/stretched Box does not have
    // these simple axis-aligned face planes. Never pretend its envelope
    // equals raw saved Cube bounds.
    if (0..3).any(|axis| cube.to[axis] <= cube.from[axis]) {
        return Err(fail("GEOMETRY_ATTACHMENT_FACE_DEGENERATE"));
    }
    let rotation: [f64; 3] = cube.extra.get("rotation")
        .map(|value| serde_json::from_value(value.clone())
            .map_err(|_| fail("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED")))
        .transpose()?.unwrap_or([0.0; 3]);
    let stretch: [f64; 3] = cube.extra.get("stretch")
        .map(|value| serde_json::from_value(value.clone())
            .map_err(|_| fail("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED")))
        .transpose()?.unwrap_or([1.0; 3]);
    let inflate = cube.extra.get("inflate").map(|value| value.as_f64()
        .ok_or_else(|| fail("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED")))
        .transpose()?.unwrap_or(0.0);
    if rotation != [0.0; 3] || stretch != [1.0; 3] || inflate != 0.0 {
        return Err(fail("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED"));
    }
    Ok(())
}

/// Narrow, advisory pre/post AABB review for explicitly changed Cubes.
/// Only direct Cube siblings in one Bone are comparable. Rotated, inflated or
/// stretched neighbors are counted as unexamined, never treated as clear.
/// Touching faces have zero intersection and are NOT volume collisions.
/// This is not a world-space solver or a write/visual approval gate.
const MAX_OVERLAP_SAMPLES: usize = 16;

fn direct_bone_children<'a>(
    nodes: &'a [super::OutlinerNode], uuid: &str,
) -> Option<&'a [super::OutlinerNode]> {
    for node in nodes {
        if let super::OutlinerNode::Bone(bone) = node {
            if bone.uuid == uuid { return Some(&bone.children); }
            if let Some(children) = direct_bone_children(&bone.children, uuid) {
                return Some(children);
            }
        }
    }
    None
}

fn aabb_intersection(
    a: ([f64; 3], [f64; 3]), b: ([f64; 3], [f64; 3]),
) -> Option<[f64; 3]> {
    let depth: [f64; 3] = std::array::from_fn(|i|
        a.1[i].min(b.1[i]) - a.0[i].max(b.0[i])
    );
    if depth.iter().all(|d| d.is_finite() && *d > 0.0) {
        Some(depth)
    } else { None }
}

/// The changed map contains only Cubes whose saved bounds the EditPlan changes.
/// The scan is O(changed * same-Bone members), not scene-wide pairwise work.
pub(super) fn axis_aligned_overlap_review(
    session: &EditorSession, bone_uuid: &str,
    changed: &HashMap<String, ([f64; 3], [f64; 3])>,
) -> Result<Value> {
    let doc = session.document();
    let children = direct_bone_children(&doc.hierarchy, bone_uuid)
        .ok_or_else(|| fail("GEOMETRY_OVERLAP_BONE_UNRESOLVED"))?;
    let by_uuid: HashMap<&str, &Cube> = doc.cubes.iter()
        .map(|cube| (cube.uuid.as_str(), cube)).collect();
    let mut siblings = Vec::new();
    let mut unsupported = 0usize;
    for node in children {
        if let super::OutlinerNode::Cube(uuid) = node {
            let cube = *by_uuid.get(uuid.as_str())
                .ok_or_else(|| fail("GEOMETRY_OVERLAP_SOURCE_INCONSISTENT"))?;
            if bounded_unrotated_box(cube).is_ok() {
                siblings.push(cube);
            } else {
                if changed.contains_key(uuid) {
                    return Err(fail("GEOMETRY_OVERLAP_CHANGED_CUBE_UNSUPPORTED"));
                }
                unsupported += 1;
            }
        }
    }
    let affected: Vec<&Cube> = siblings.iter().copied()
        .filter(|cube| changed.contains_key(&cube.uuid)).collect();
    if affected.len() != changed.len() {
        return Err(fail("GEOMETRY_OVERLAP_CHANGED_FRAME_MISMATCH"));
    }
    let mut checked = 0usize;
    let mut introduced = 0usize;
    let mut preexisting = 0usize;
    let mut resolved = 0usize;
    let mut samples = Vec::new();
    for cube in affected {
        for other in &siblings {
            if cube.uuid == other.uuid ||
               (changed.contains_key(&other.uuid) && cube.uuid > other.uuid) {
                continue;
            }
            checked += 1;
            let old = aabb_intersection(
                (cube.from, cube.to), (other.from, other.to)
            );
            let after_cube = changed.get(&cube.uuid).copied()
                .unwrap_or((cube.from, cube.to));
            let after_other = changed.get(&other.uuid).copied()
                .unwrap_or((other.from, other.to));
            let new = aabb_intersection(after_cube, after_other);
            match (old, new) {
                (None, Some(depth)) => {
                    introduced += 1;
                    if samples.len() < MAX_OVERLAP_SAMPLES {
                        let (first, second) = if cube.uuid < other.uuid {
                            (&cube.uuid, &other.uuid)
                        } else { (&other.uuid, &cube.uuid) };
                        samples.push(json!({
                            "cube_uuids":[first, second], "overlap":depth
                        }));
                    }
                }
                (Some(_), Some(_)) => preexisting += 1,
                (Some(_), None) => resolved += 1,
                (None, None) => {}
            }
        }
    }
    Ok(json!({
        "scope":"affected_vs_same_bone_axis_aligned_cube_aabb",
        "affected_cube_count":changed.len(),
        "checked_pair_count":checked,
        "introduced_overlap_count":introduced,
        "preexisting_overlap_count":preexisting,
        "resolved_overlap_count":resolved,
        "unsupported_neighbor_count":unsupported,
        "introduced_samples":samples,
        "samples_truncated":introduced > MAX_OVERLAP_SAMPLES,
        "whole_model_collision_verdict":"UNVERIFIED",
    }))
}

/// Canonical local face translation shared by G2 one-shot attachment and
/// G2.2 explicit resize propagation. Caller validates source Cube transforms,
/// positive spans, and a common Bone frame before this numeric calculation.
pub(super) fn delta_for_faces(
    anchor_from: [f64; 3], anchor_to: [f64; 3],
    moving_from: [f64; 3], moving_to: [f64; 3],
    anchor_face: &str, moving_face: &str,
    clearance: f64, tangent_offset: [f64; 2],
) -> Result<([f64; 3], [usize; 2])> {
    let (axis, normal) = face_axis_sign(anchor_face)?;
    let (moving_axis, opposite) = face_axis_sign(moving_face)?;
    if moving_axis != axis || opposite != -normal {
        return Err(fail("GEOMETRY_ATTACHMENT_FACE_PAIR_INVALID"));
    }
    if !clearance.is_finite() || clearance < 0.0 || clearance > super::LIMIT ||
       !tangent_offset.iter().all(|v|v.is_finite() && v.abs() <= super::LIMIT) {
        return Err(fail("GEOMETRY_ATTACHMENT_OFFSET_INVALID"));
    }
    let fixed_plane = if normal > 0.0 { anchor_to[axis] } else { anchor_from[axis] };
    let moving_plane = if normal > 0.0 { moving_from[axis] } else { moving_to[axis] };
    let mut delta = [0.0; 3];
    delta[axis] = (fixed_plane + normal * clearance) - moving_plane;
    let tangents = match axis {
        0 => [1, 2], 1 => [0, 2], 2 => [0, 1], _ => unreachable!(),
    };
    for (i, tangent) in tangents.into_iter().enumerate() {
        delta[tangent] = (anchor_from[tangent] + anchor_to[tangent]) / 2.0
            - (moving_from[tangent] + moving_to[tangent]) / 2.0
            + tangent_offset[i];
    }
    if !valid_vec3(delta) ||
       !valid_bounds(
           std::array::from_fn(|i|moving_from[i] + delta[i]),
           std::array::from_fn(|i|moving_to[i] + delta[i]),
       ) {
        return Err(fail("GEOMETRY_ATTACHMENT_RESULT_OUT_OF_BOUNDS"));
    }
    Ok((delta, tangents))
}

pub(super) fn compile(
    session: &EditorSession, req: &GeometryFaceAttachmentRequest,
) -> Result<GeometryFaceAttachmentProposal> {
    session.check_revision(req.expected_revision)?;
    if serde_json::to_vec(req)
        .map_err(|_| fail("GEOMETRY_ATTACHMENT_INPUT_INVALID"))?.len()
        > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_ATTACHMENT_INPUT_TOO_LARGE"));
    }
    if !valid_uuid(&req.anchor_cube_uuid) || !valid_uuid(&req.moving_cube_uuid) {
        return Err(fail("GEOMETRY_ATTACHMENT_UUID_INVALID"));
    }
    if req.anchor_cube_uuid == req.moving_cube_uuid {
        return Err(fail("GEOMETRY_ATTACHMENT_SELF_TARGET"));
    }
    let doc = session.document();
    let anchor = doc.cubes.iter().find(|cube| cube.uuid == req.anchor_cube_uuid)
        .ok_or_else(|| fail("GEOMETRY_ATTACHMENT_CUBE_NOT_FOUND"))?;
    let moving = doc.cubes.iter().find(|cube| cube.uuid == req.moving_cube_uuid)
        .ok_or_else(|| fail("GEOMETRY_ATTACHMENT_CUBE_NOT_FOUND"))?;
    bounded_unrotated_box(anchor)?;
    bounded_unrotated_box(moving)?;

    // Shared parent is a real source-local frame. A Bone reparent/rotation
    // requires a different, explicitly designed world-transform solver.
    let anchor_parent = outliner_parent_uuid(
        &doc.hierarchy, &req.anchor_cube_uuid, None
    ).flatten().ok_or_else(|| fail("GEOMETRY_ATTACHMENT_PARENT_INVALID"))?;
    let moving_parent = outliner_parent_uuid(
        &doc.hierarchy, &req.moving_cube_uuid, None
    ).flatten().ok_or_else(|| fail("GEOMETRY_ATTACHMENT_PARENT_INVALID"))?;
    if anchor_parent != moving_parent {
        return Err(fail("GEOMETRY_ATTACHMENT_FRAME_UNSUPPORTED"));
    }

    let (delta, tangent_axes) = delta_for_faces(
        anchor.from, anchor.to, moving.from, moving.to,
        &req.anchor_face, &req.moving_face, req.clearance, req.tangent_offset,
    )?;
    if delta.iter().all(|value| *value == 0.0) {
        return Err(fail("GEOMETRY_ATTACHMENT_ALREADY_SATISFIED"));
    }

    let plan = EditPlan {
        expected_revision: req.expected_revision,
        operations: vec![EditOperation::TranslateCube {
            uuid: req.moving_cube_uuid.clone(), delta,
        }],
        correction_scope: None,
    };
    // Canonical Rust TranslateCube handles UV modes, revision, and atomic
    // refusal. Preflight here has no model/Undo/permission side effects.
    let preflight = session.preflight(&plan)?;
    let after = HashMap::from([(
        moving.uuid.clone(),
        (
            std::array::from_fn(|i| moving.from[i] + delta[i]),
            std::array::from_fn(|i| moving.to[i] + delta[i]),
        )
    )]);
    let aabb_review = axis_aligned_overlap_review(session, &anchor_parent, &after)?;
    let diagnostic = json!({
        "scope":"same_bone_axis_aligned_face_attachment",
        "anchor_cube_uuid":req.anchor_cube_uuid,
        "moving_cube_uuid":req.moving_cube_uuid,
        "parent_bone_uuid":anchor_parent,
        "anchor_face":req.anchor_face,
        "moving_face":req.moving_face,
        "clearance":req.clearance,
        "tangent_axes":tangent_axes,
        "tangent_offset":req.tangent_offset,
        "delta":delta,
        "collision_verdict":"NOT_EVALUATED",
        "aabb_overlap_review":aabb_review,
        "visual_verdict":"UNVERIFIED"
    });
    Ok(GeometryFaceAttachmentProposal { plan, preflight, diagnostic })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{sha256, AuthoringDocument, Bone};
    use serde_json::json;

    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const BONE_A: &str = "00000000-0000-4000-8000-000000002101";
    const BONE_B: &str = "00000000-0000-4000-8000-000000002102";
    const FIXED: &str = "00000000-0000-4000-8000-000000002103";
    const MOVING: &str = "00000000-0000-4000-8000-000000002104";

    fn sample_cube(uuid: &str, from: [f64; 3]) -> Cube {
        let fixture: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut cube: Cube = serde_json::from_value(fixture["elements"][0].clone()).unwrap();
        cube.uuid = uuid.into();
        cube.name = Some(format!("part_{uuid}"));
        cube.from = from;
        cube.to = std::array::from_fn(|axis| from[axis] + 4.0);
        cube.origin = Some(from);
        cube
    }
    fn prepared() -> EditorSession {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("G2", "g2").unwrap()
        ).unwrap();
        let bone: Bone = serde_json::from_value(json!({
            "uuid":BONE_A,"name":"root","origin":[0,0,0],
        })).unwrap();
        session.apply(0, &[
            EditOperation::AddBone { bone, parent_uuid:None },
            EditOperation::AddCube {
                cube:sample_cube(FIXED,[0.0,0.0,0.0]),bone_uuid:BONE_A.into(),
            },
            EditOperation::AddCube {
                cube:sample_cube(MOVING,[10.0,0.0,0.0]),bone_uuid:BONE_A.into(),
            },
        ]).unwrap();
        session
    }
    fn request() -> GeometryFaceAttachmentRequest {
        GeometryFaceAttachmentRequest {
            expected_revision:1, anchor_cube_uuid:FIXED.into(),
            moving_cube_uuid:MOVING.into(),
            anchor_face:"east".into(), moving_face:"west".into(),
            clearance:2.0, tangent_offset:[1.0,-1.0],
        }
    }
    #[test]
    fn face_alignment_preflight_matches_one_undoable_uv_aware_rust_edit() {
        let mut session = prepared();
        let before = session.document().clone();
        let proposal = compile(&session,&request()).unwrap();
        assert_eq!(proposal.plan.operations.len(),1);
        assert!(matches!(&proposal.plan.operations[0],
            EditOperation::TranslateCube { uuid, delta }
            if uuid == MOVING && *delta == [-4.0,1.0,-1.0]));
        assert_eq!(proposal.diagnostic["parent_bone_uuid"],BONE_A);
        assert_eq!(proposal.diagnostic["tangent_axes"],json!([1,2]));
        assert_eq!(proposal.diagnostic["collision_verdict"],"NOT_EVALUATED");
        assert_eq!(proposal.diagnostic["aabb_overlap_review"]["introduced_overlap_count"],0);
        assert_eq!(proposal.diagnostic["aabb_overlap_review"]["whole_model_collision_verdict"],"UNVERIFIED");
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(session.document(),&before);
        let receipt = session.apply(1,&proposal.plan.operations).unwrap();
        assert_eq!(receipt.revision,2);
        let after = session.document().clone();
        assert_eq!(after.cubes[0],before.cubes[0]);
        assert_eq!(after.cubes[1].from,[6.0,1.0,-1.0]);
        assert_eq!(after.cubes[1].to,[10.0,5.0,3.0]);
        assert_eq!(after.texture_assets,before.texture_assets);
        assert_eq!(after.animation_assets,before.animation_assets);
        let saved = session.export().unwrap();
        assert_eq!(proposal.preflight["candidate_sha256"],sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
        session.undo(2).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(3).unwrap();
        assert_eq!(session.document(),&after);
    }
    #[test]
    fn all_six_opposite_faces_are_explicit_and_nonmutating() {
        let session=prepared();
        let before=session.document().clone();
        for (f,m,axis) in [
            ("east","west",0),("west","east",0),
            ("up","down",1),("down","up",1),
            ("south","north",2),("north","south",2),
        ] {
            let req=GeometryFaceAttachmentRequest {
                anchor_face:f.into(),moving_face:m.into(),
                clearance:1.0,tangent_offset:[0.0,0.0],..request()
            };
            let p=compile(&session,&req).unwrap();
            assert_eq!(p.diagnostic["tangent_axes"].as_array().unwrap().len(),2);
            assert_eq!(p.plan.operations.len(),1);
            assert!(p.diagnostic["delta"][axis].as_f64().unwrap().is_finite());
        }
        assert_eq!(session.document(),&before);
    }
    #[test]
    fn ambiguous_or_incompatible_frames_refuse_without_undo_mutation() {
        let session=prepared();
        let original=session.document().clone();
        let cases=[
            (GeometryFaceAttachmentRequest{
                moving_cube_uuid:FIXED.into(),..request()
            },"GEOMETRY_ATTACHMENT_SELF_TARGET"),
            (GeometryFaceAttachmentRequest{
                anchor_cube_uuid:"missing".into(),..request()
            },"GEOMETRY_ATTACHMENT_CUBE_NOT_FOUND"),
            (GeometryFaceAttachmentRequest{
                moving_face:"up".into(),..request()
            },"GEOMETRY_ATTACHMENT_FACE_PAIR_INVALID"),
            (GeometryFaceAttachmentRequest{
                anchor_face:"diagonal".into(),..request()
            },"GEOMETRY_ATTACHMENT_FACE_INVALID"),
            (GeometryFaceAttachmentRequest{
                clearance:-1.0,..request()
            },"GEOMETRY_ATTACHMENT_OFFSET_INVALID"),
            (GeometryFaceAttachmentRequest{
                expected_revision:0,..request()
            },"DOCUMENT_REVISION_STALE"),
        ];
        for (req,code) in cases {
            assert_eq!(compile(&session,&req).err().as_deref(),Some(code));
            assert_eq!(session.document(),&original);
            assert!(session.can_undo());
        }
        let mut wrong_frame=prepared();
        let next_bone: Bone=serde_json::from_value(json!({
            "uuid":BONE_B,"name":"independent","origin":[0,0,0]
        })).unwrap();
        wrong_frame.apply(1,&[
            EditOperation::AddBone {bone:next_bone,parent_uuid:None},
            EditOperation::ReparentNode {
                uuid:MOVING.into(),parent_uuid:Some(BONE_B.into()),
            }
        ]).unwrap();
        assert_eq!(compile(&wrong_frame,&GeometryFaceAttachmentRequest {
            expected_revision:2,..request()
        }).err().as_deref(),Some("GEOMETRY_ATTACHMENT_FRAME_UNSUPPORTED"));
        let mut rotated=original.clone();
        rotated.cubes[1].extra.insert("rotation".into(),json!([0,30,0]));
        let rotated=EditorSession::from_document(rotated).unwrap();
        assert_eq!(compile(&rotated,&GeometryFaceAttachmentRequest{
            expected_revision:0,..request()
        }).err().as_deref(),Some("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED"));
        let mut inflated=original.clone();
        inflated.cubes[1].extra.insert("inflate".into(),json!(0.5));
        let inflated=EditorSession::from_document(inflated).unwrap();
        assert_eq!(compile(&inflated,&GeometryFaceAttachmentRequest{
            expected_revision:0,..request()
        }).err().as_deref(),Some("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED"));
    }
    #[test]
    fn already_aligned_proposal_refuses_an_unnecessary_revision() {
        let session=prepared();
        let mut same=session.document().clone();
        same.cubes[1].from=[4.0,0.0,0.0];
        same.cubes[1].to=[8.0,4.0,4.0];
        let same=EditorSession::from_document(same).unwrap();
        assert_eq!(compile(&same,&GeometryFaceAttachmentRequest {
            expected_revision:0,clearance:0.0,tangent_offset:[0.0,0.0],
            ..request()
        }).err().as_deref(),Some("GEOMETRY_ATTACHMENT_ALREADY_SATISFIED"));
        assert!(!same.can_undo());
        assert!(serde_json::from_value::<GeometryFaceAttachmentRequest>(json!({
            "expected_revision":0, "anchor_cube_uuid":FIXED,
            "moving_cube_uuid":MOVING,"anchor_face":"east",
            "moving_face":"west","clearance":0.0,
            "tangent_offset":[0.0,0.0],"unknown":true
        })).is_err());
    }
    #[test]
    fn scoped_overlap_screen_reports_new_contacts_without_approving_or_writing() {
        const OBSTACLE: &str = "00000000-0000-4000-8000-000000002105";
        const UNSUPPORTED: &str = "00000000-0000-4000-8000-000000002106";
        let mut session=prepared();
        let mut rotated=sample_cube(UNSUPPORTED,[20.0,0.0,0.0]);
        rotated.extra.insert("rotation".into(),json!([0,15,0]));
        session.apply(1,&[
            EditOperation::AddCube {
                cube:sample_cube(OBSTACLE,[6.0,0.0,0.0]),
                bone_uuid:BONE_A.into(),
            },
            EditOperation::AddCube {cube:rotated,bone_uuid:BONE_A.into()},
        ]).unwrap();
        let before=session.document().clone();
        let proposal=compile(&session,&GeometryFaceAttachmentRequest {
            expected_revision:2,..request()
        }).unwrap();
        let review=&proposal.diagnostic["aabb_overlap_review"];
        assert_eq!(review["scope"],"affected_vs_same_bone_axis_aligned_cube_aabb");
        assert_eq!(review["affected_cube_count"],1);
        assert_eq!(review["checked_pair_count"],2);
        assert_eq!(review["introduced_overlap_count"],1);
        assert_eq!(review["preexisting_overlap_count"],0);
        assert_eq!(review["unsupported_neighbor_count"],1);
        assert_eq!(review["introduced_samples"][0]["cube_uuids"],json!([MOVING,OBSTACLE]));
        assert_eq!(review["introduced_samples"][0]["overlap"],json!([4.0,3.0,3.0]));
        assert_eq!(review["samples_truncated"],false);
        assert_eq!(review["whole_model_collision_verdict"],"UNVERIFIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(session.document(),&before);
        assert_eq!(session.summary().revision,2);

        let touching=compile(&prepared(),&GeometryFaceAttachmentRequest {
            clearance:0.0,tangent_offset:[0.0,0.0],..request()
        }).unwrap();
        assert_eq!(touching.diagnostic["aabb_overlap_review"]["introduced_overlap_count"],0);
    }


    #[test]
    fn overlap_report_caps_samples_without_hiding_total_pair_count() {
        let mut session=prepared();
        let additions: Vec<EditOperation> = (0..20).map(|i| {
            let uuid=format!("00000000-0000-4000-8000-000000004{:03}",i);
            EditOperation::AddCube {
                cube:sample_cube(&uuid,[6.0,0.0,0.0]),
                bone_uuid:BONE_A.into(),
            }
        }).collect();
        session.apply(1,&additions).unwrap();
        let proposal=compile(&session,&GeometryFaceAttachmentRequest {
            expected_revision:2,..request()
        }).unwrap();
        let review=&proposal.diagnostic["aabb_overlap_review"];
        assert_eq!(review["checked_pair_count"],21);
        assert_eq!(review["introduced_overlap_count"],20);
        assert_eq!(review["introduced_samples"].as_array().unwrap().len(),16);
        assert_eq!(review["samples_truncated"],true);
        assert_eq!(review["whole_model_collision_verdict"],"UNVERIFIED");
    }

}
