//! G2.2: explicit one-shot resize + attachment dependency propagation.
//! One Rust EditPlan, no persistent constraints, extra authoring state,
//! implied reference dimensions, file writes or native/visual PASS.
//! SOURCE_ONLY: Rust, Node, Windows and Blockbench tests NOT_EXECUTED.

use super::{
    fail, geometry_attachment::{axis_aligned_overlap_review, bounded_unrotated_box, delta_for_faces},
    outliner_parent_uuid, valid_bounds, valid_uuid, Cube, EditOperation,
    EditPlan, EditorSession, Result, MAX_OPERATIONS, MAX_PLAN_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const MAX_LINKS: usize = 32;

/// Declares a single parent -> dependent Cube relationship for THIS batch.
/// One dependent Cube can have only one incoming link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryPropagationLink {
    pub anchor_cube_uuid: String,
    pub moving_cube_uuid: String,
    pub anchor_face: String,
    pub moving_face: String,
    pub clearance: f64,
    pub tangent_offset: [f64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryResizePropagationRequest {
    pub expected_revision: u64,
    pub resize_cube_uuid: String,
    pub from: [f64; 3],
    pub to: [f64; 3],
    /// Existing ReframeCube options: manual_preserve or box_repack.
    pub uv_policy: String,
    pub links: Vec<GeometryPropagationLink>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeometryResizePropagationProposal {
    pub plan: EditPlan,
    pub preflight: Value,
    pub diagnostic: Value,
}

#[derive(Clone, Copy)]
struct Bounds {
    from: [f64; 3],
    to: [f64; 3],
}

fn source_cube<'a>(session: &'a EditorSession, uuid: &str) -> Result<&'a Cube> {
    session.document().cubes.iter().find(|cube| cube.uuid == uuid)
        .ok_or_else(|| fail("GEOMETRY_PROPAGATION_CUBE_NOT_FOUND"))
}

fn same_bone_parent(session: &EditorSession, uuid: &str) -> Result<String> {
    outliner_parent_uuid(&session.document().hierarchy, uuid, None)
        .flatten().ok_or_else(|| fail("GEOMETRY_PROPAGATION_PARENT_UNRESOLVED"))
}

pub(super) fn compile(
    session: &EditorSession, request: &GeometryResizePropagationRequest,
) -> Result<GeometryResizePropagationProposal> {
    session.check_revision(request.expected_revision)?;
    if serde_json::to_vec(request)
        .map_err(|_| fail("GEOMETRY_PROPAGATION_INPUT_INVALID"))?.len()
        > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_PROPAGATION_INPUT_TOO_LARGE"));
    }
    if request.links.is_empty() || request.links.len() > MAX_LINKS ||
       request.links.len() + 1 > MAX_OPERATIONS {
        return Err(fail("GEOMETRY_PROPAGATION_LINK_COUNT_INVALID"));
    }
    if !valid_uuid(&request.resize_cube_uuid) ||
       !valid_bounds(request.from, request.to) ||
       (0..3).any(|axis| request.from[axis] == request.to[axis]) {
        return Err(fail("GEOMETRY_PROPAGATION_RESIZE_INVALID"));
    }
    if request.uv_policy != "manual_preserve" &&
       request.uv_policy != "box_repack" {
        return Err(fail("GEOMETRY_PROPAGATION_UV_POLICY_INVALID"));
    }
    let root = source_cube(session, &request.resize_cube_uuid)?;
    bounded_unrotated_box(root)?;
    if root.from == request.from && root.to == request.to {
        return Err(fail("GEOMETRY_PROPAGATION_RESIZE_UNCHANGED"));
    }
    let frame = same_bone_parent(session, &root.uuid)?;
    let mut targets = HashSet::new();
    for link in &request.links {
        if !valid_uuid(&link.anchor_cube_uuid) ||
           !valid_uuid(&link.moving_cube_uuid) {
            return Err(fail("GEOMETRY_PROPAGATION_UUID_INVALID"));
        }
        if link.moving_cube_uuid == request.resize_cube_uuid {
            return Err(fail("GEOMETRY_PROPAGATION_ROOT_IS_DEPENDENT"));
        }
        if link.anchor_cube_uuid == link.moving_cube_uuid {
            return Err(fail("GEOMETRY_PROPAGATION_SELF_DEPENDENCY"));
        }
        if !targets.insert(link.moving_cube_uuid.as_str()) {
            return Err(fail("GEOMETRY_PROPAGATION_MULTIPLE_PARENTS"));
        }
        let anchor = source_cube(session, &link.anchor_cube_uuid)?;
        let moving = source_cube(session, &link.moving_cube_uuid)?;
        bounded_unrotated_box(anchor)?;
        bounded_unrotated_box(moving)?;
        if same_bone_parent(session, &link.anchor_cube_uuid)? != frame ||
           same_bone_parent(session, &link.moving_cube_uuid)? != frame {
            return Err(fail("GEOMETRY_PROPAGATION_FRAME_UNSUPPORTED"));
        }
    }
    // An unrelated model Cube cannot become an implicit dependency root.
    for link in &request.links {
        if link.anchor_cube_uuid != request.resize_cube_uuid &&
           !targets.contains(link.anchor_cube_uuid.as_str()) {
            return Err(fail("GEOMETRY_PROPAGATION_ANCHOR_UNDECLARED"));
        }
    }

    let mut operations = vec![EditOperation::ReframeCube {
        uuid: request.resize_cube_uuid.clone(),
        from: request.from,
        to: request.to,
        uv_policy: request.uv_policy.clone(),
    }];
    // Transient candidate bounds are not saved or treated as a second model.
    // Only the selected root and explicitly dependent Cubes enter this map.
    let mut prospective = HashMap::from([(
        request.resize_cube_uuid.as_str(),
        Bounds { from: request.from, to: request.to },
    )]);
    let mut changed_bounds = HashMap::from([(
        request.resize_cube_uuid.clone(), (request.from, request.to),
    )]);
    let mut scheduled = vec![false; request.links.len()];
    let mut results = Vec::with_capacity(request.links.len());
    let mut remaining = request.links.len();
    let mut translations = 0usize;
    while remaining > 0 {
        let mut progressed = false;
        for (index, link) in request.links.iter().enumerate() {
            if scheduled[index] { continue; }
            let Some(anchor) = prospective.get(link.anchor_cube_uuid.as_str()).copied()
            else { continue; };
            let moving = source_cube(session, &link.moving_cube_uuid)?;
            let (delta, tangent_axes) = delta_for_faces(
                anchor.from, anchor.to, moving.from, moving.to,
                &link.anchor_face, &link.moving_face,
                link.clearance, link.tangent_offset,
            )?;
            let next = Bounds {
                from: std::array::from_fn(|i|moving.from[i] + delta[i]),
                to: std::array::from_fn(|i|moving.to[i] + delta[i]),
            };
            let changed = delta.iter().any(|v| *v != 0.0);
            if changed {
                operations.push(EditOperation::TranslateCube {
                    uuid: link.moving_cube_uuid.clone(), delta,
                });
                translations += 1;
                changed_bounds.insert(link.moving_cube_uuid.clone(), (next.from, next.to));
            }
            prospective.insert(link.moving_cube_uuid.as_str(), next);
            results.push(json!({
                "anchor_cube_uuid":link.anchor_cube_uuid,
                "moving_cube_uuid":link.moving_cube_uuid,
                "delta":delta,
                "tangent_axes":tangent_axes,
                "status":if changed {"translation_planned"} else {"already_aligned"},
            }));
            remaining -= 1;
            scheduled[index] = true;
            progressed = true;
        }
        if !progressed {
            return Err(fail("GEOMETRY_PROPAGATION_CYCLE_OR_DISCONNECTED"));
        }
    }
    let plan = EditPlan {
        expected_revision: request.expected_revision,
        operations,
        correction_scope: None,
    };
    if serde_json::to_vec(&plan)
        .map_err(|_| fail("GEOMETRY_PROPAGATION_PLAN_INVALID"))?.len()
        > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_PROPAGATION_PLAN_TOO_LARGE"));
    }
    // Checks root UV policy, every dependent UV-aware translation,
    // rollback/revision, and editable .bbmodel on a disposable Rust draft.
    let preflight = session.preflight(&plan)?;
    let aabb_review = axis_aligned_overlap_review(session, &frame, &changed_bounds)?;
    let diagnostic = json!({
        "scope":"one_shot_same_bone_resize_propagation",
        "resize_cube_uuid":request.resize_cube_uuid,
        "parent_bone_uuid":frame,
        "dependency_count":request.links.len(),
        "translated_count":translations,
        "unchanged_count":request.links.len() - translations,
        "ordered_links":results,
        "persistent_constraints":false,
        "collision_verdict":"NOT_EVALUATED",
        "aabb_overlap_review":aabb_review,
        "visual_verdict":"UNVERIFIED",
    });
    Ok(GeometryResizePropagationProposal { plan, preflight, diagnostic })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{sha256, AuthoringDocument, Bone};
    use serde_json::json;

    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const ROOT_BONE: &str = "00000000-0000-4000-8000-000000003001";
    const OTHER_BONE: &str = "00000000-0000-4000-8000-000000003002";
    const BASE: &str = "00000000-0000-4000-8000-000000003003";
    const ARM: &str = "00000000-0000-4000-8000-000000003004";
    const TIP: &str = "00000000-0000-4000-8000-000000003005";
    const BACK: &str = "00000000-0000-4000-8000-000000003006";

    fn cube(uuid: &str, from: [f64; 3]) -> Cube {
        let wire: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut cube: Cube = serde_json::from_value(wire["elements"][0].clone()).unwrap();
        cube.uuid = uuid.into();
        cube.name = Some(uuid.into());
        cube.from = from;
        cube.to = std::array::from_fn(|i|from[i] + 4.0);
        cube.origin = Some(from);
        cube
    }
    fn prepared() -> EditorSession {
        let mut doc = AuthoringDocument::new_bedrock("G2.2", "g22").unwrap();
        doc.meta.box_uv = Some(false);
        let mut session = EditorSession::from_document(doc).unwrap();
        let bone: Bone = serde_json::from_value(json!({
            "uuid":ROOT_BONE,"name":"root","origin":[0,0,0],
        })).unwrap();
        session.apply(0,&[
            EditOperation::AddBone {bone,parent_uuid:None},
            EditOperation::AddCube {cube:cube(BASE,[0.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()},
            EditOperation::AddCube {cube:cube(ARM,[10.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()},
            EditOperation::AddCube {cube:cube(TIP,[20.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()},
            EditOperation::AddCube {cube:cube(BACK,[30.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()},
        ]).unwrap();
        session
    }
    fn link(anchor: &str, moving: &str) -> GeometryPropagationLink {
        GeometryPropagationLink {
            anchor_cube_uuid:anchor.into(),moving_cube_uuid:moving.into(),
            anchor_face:"east".into(),moving_face:"west".into(),
            clearance:1.0,tangent_offset:[0.0,0.0],
        }
    }
    fn request() -> GeometryResizePropagationRequest {
        let mut other_side = link(BASE,BACK);
        other_side.anchor_face = "west".into();
        other_side.moving_face = "east".into();
        GeometryResizePropagationRequest {
            expected_revision:1,resize_cube_uuid:BASE.into(),
            from:[0.0,0.0,0.0],to:[6.0,4.0,4.0],
            uv_policy:"manual_preserve".into(),
            // Out of order: chain ARM->TIP precedes its BASE->ARM parent.
            links:vec![link(ARM,TIP),other_side,link(BASE,ARM)],
        }
    }

    #[test]
    fn branching_and_chained_attachment_recompile_to_one_edit_and_undo() {
        let mut session=prepared();
        let before=session.document().clone();
        let old_faces: Vec<_>=before.cubes.iter().map(|c|c.faces.clone()).collect();
        let proposal=compile(&session,&request()).unwrap();
        assert_eq!(proposal.plan.operations.len(),4);
        assert!(matches!(&proposal.plan.operations[0],EditOperation::ReframeCube{
            uuid,uv_policy,..} if uuid==BASE&&uv_policy=="manual_preserve"));
        assert!(matches!(&proposal.plan.operations[1],EditOperation::TranslateCube{
            uuid,delta} if uuid==BACK&&*delta==[-35.0,0.0,0.0]));
        assert!(matches!(&proposal.plan.operations[2],EditOperation::TranslateCube{
            uuid,delta} if uuid==ARM&&*delta==[-3.0,0.0,0.0]));
        assert!(matches!(&proposal.plan.operations[3],EditOperation::TranslateCube{
            uuid,delta} if uuid==TIP&&*delta==[-8.0,0.0,0.0]));
        assert_eq!(proposal.diagnostic["dependency_count"],3);
        assert_eq!(proposal.diagnostic["translated_count"],3);
        assert_eq!(proposal.diagnostic["persistent_constraints"],false);
        assert_eq!(proposal.diagnostic["aabb_overlap_review"]["introduced_overlap_count"],0);
        assert_eq!(proposal.diagnostic["aabb_overlap_review"]["whole_model_collision_verdict"],"UNVERIFIED");
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(session.document(),&before);
        assert!(session.can_undo());
        let receipt=session.apply(1,&proposal.plan.operations).unwrap();
        assert_eq!(receipt.revision,2);
        assert_eq!(receipt.operation_count,4);
        let after=session.document().clone();
        assert_eq!(after.cubes[0].to,[6.0,4.0,4.0]);
        assert_eq!(after.cubes[1].from,[7.0,0.0,0.0]);
        assert_eq!(after.cubes[2].from,[12.0,0.0,0.0]);
        assert_eq!(after.cubes[3].from,[-5.0,0.0,0.0]);
        assert_eq!(after.cubes.iter().map(|c|c.faces.clone()).collect::<Vec<_>>(),old_faces);
        assert_eq!(after.bones,before.bones);
        assert_eq!(after.texture_assets,before.texture_assets);
        assert_eq!(after.animation_assets,before.animation_assets);
        let saved=session.export().unwrap();
        assert_eq!(proposal.preflight["candidate_sha256"],sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
        session.undo(2).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(3).unwrap();
        assert_eq!(session.document(),&after);
    }

    #[test]
    fn cycles_unknown_anchors_duplicate_targets_and_stale_requests_refuse() {
        let session=prepared();
        let original=session.document().clone();
        let invalid=[
            (GeometryResizePropagationRequest {
                links:vec![link("missing",ARM)],..request()
            },"GEOMETRY_PROPAGATION_CUBE_NOT_FOUND"),
            (GeometryResizePropagationRequest {
                links:vec![link(BASE,ARM),link(TIP,ARM)],..request()
            },"GEOMETRY_PROPAGATION_MULTIPLE_PARENTS"),
            (GeometryResizePropagationRequest {
                links:vec![link(ARM,TIP),link(TIP,ARM)],..request()
            },"GEOMETRY_PROPAGATION_CYCLE_OR_DISCONNECTED"),
            (GeometryResizePropagationRequest {
                links:vec![link(BACK,TIP)],..request()
            },"GEOMETRY_PROPAGATION_ANCHOR_UNDECLARED"),
            (GeometryResizePropagationRequest {
                links:vec![link(ARM,BASE)],..request()
            },"GEOMETRY_PROPAGATION_ROOT_IS_DEPENDENT"),
            (GeometryResizePropagationRequest {
                to:[4.0,4.0,4.0],..request()
            },"GEOMETRY_PROPAGATION_RESIZE_UNCHANGED"),
            (GeometryResizePropagationRequest {
                expected_revision:0,..request()
            },"DOCUMENT_REVISION_STALE"),
        ];
        for (req,code) in invalid {
            assert_eq!(compile(&session,&req).err().as_deref(),Some(code));
            assert_eq!(session.document(),&original);
            assert_eq!(session.summary().revision,1);
        }
        assert!(serde_json::from_value::<GeometryResizePropagationRequest>(json!({
            "expected_revision":1,"resize_cube_uuid":BASE,"from":[0,0,0],
            "to":[6,4,4],"uv_policy":"manual_preserve",
            "links":[],"unrecognized":"injected"
        })).is_err());
    }

    #[test]
    fn unsupported_bone_frames_rotation_and_auto_uv_block_whole_plan() {
        let mut wrong_frame=prepared();
        let bone: Bone=serde_json::from_value(json!({
            "uuid":OTHER_BONE,"name":"other","origin":[0,0,0]
        })).unwrap();
        wrong_frame.apply(1,&[
            EditOperation::AddBone {bone,parent_uuid:None},
            EditOperation::ReparentNode {
                uuid:TIP.into(),parent_uuid:Some(OTHER_BONE.into())
            }
        ]).unwrap();
        assert_eq!(compile(&wrong_frame,&GeometryResizePropagationRequest {
            expected_revision:2,..request()
        }).err().as_deref(),Some("GEOMETRY_PROPAGATION_FRAME_UNSUPPORTED"));

        let mut rotated=prepared().document().clone();
        rotated.cubes[1].extra.insert("rotation".into(),json!([0.0,15.0,0.0]));
        let rotated=EditorSession::from_document(rotated).unwrap();
        assert_eq!(compile(&rotated,&GeometryResizePropagationRequest {
            expected_revision:0,..request()
        }).err().as_deref(),Some("GEOMETRY_ATTACHMENT_TRANSFORM_UNSUPPORTED"));

        let mut unsafe_uv=prepared().document().clone();
        unsafe_uv.cubes[0].extra.insert("autouv".into(),json!(1));
        let original=unsafe_uv.clone();
        let unsafe_uv=EditorSession::from_document(unsafe_uv).unwrap();
        assert_eq!(compile(&unsafe_uv,&GeometryResizePropagationRequest {
            expected_revision:0,..request()
        }).err().as_deref(),Some("CUBE_REFRAME_AUTO_UV_UNSUPPORTED"));
        assert_eq!(unsafe_uv.document(),&original);
        assert!(!unsafe_uv.can_undo());
    }
    #[test]
    fn resize_overlap_review_distinguishes_preexisting_from_new_pairs() {
        const OBSTACLE: &str="00000000-0000-4000-8000-000000003007";
        const EXISTING: &str="00000000-0000-4000-8000-000000003008";
        let mut session=prepared();
        session.apply(1,&[
            EditOperation::AddCube {
                cube:cube(OBSTACLE,[5.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()
            },
            EditOperation::AddCube {
                cube:cube(EXISTING,[3.0,0.0,0.0]),bone_uuid:ROOT_BONE.into()
            },
        ]).unwrap();
        let before=session.document().clone();
        let proposal=compile(&session,&GeometryResizePropagationRequest {
            expected_revision:2,..request()
        }).unwrap();
        let review=&proposal.diagnostic["aabb_overlap_review"];
        assert_eq!(review["scope"],"affected_vs_same_bone_axis_aligned_cube_aabb");
        assert_eq!(review["affected_cube_count"],4);
        assert_eq!(review["introduced_overlap_count"],2);
        assert_eq!(review["preexisting_overlap_count"],1);
        assert_eq!(review["unsupported_neighbor_count"],0);
        assert_eq!(review["introduced_samples"].as_array().unwrap().len(),2);
        assert_eq!(review["whole_model_collision_verdict"],"UNVERIFIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(session.document(),&before);
    }

}
