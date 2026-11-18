//! G1: bounded, structure-first Rust Geometry assembly.
//! Converts explicitly named parts and exact Bone/Cube identities into the
//! existing EditPlan, without inferring dimensions, writing files or storing
//! a parallel model. SOURCE_ONLY; native/Blockbench tests NOT_EXECUTED.

use super::{
    fail, geometry, valid_node_name, valid_uuid, Bone, Cube, EditOperation,
    EditPlan, EditorSession, Result, MAX_OPERATIONS, MAX_PLAN_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

/// The parent is an existing or simultaneously declared Bone UUID.
/// Bone pivots and Cube geometry are caller-authored source facts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAssemblyPart {
    pub bone: Bone,
    pub parent_uuid: Option<String>,
    pub cubes: Vec<Cube>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAssemblyRequest {
    pub expected_revision: u64,
    pub parts: Vec<GeometryAssemblyPart>,
}

/// A disposable Rust preflight, not permission, export or visual acceptance.
#[derive(Debug, Clone, Serialize)]
pub struct GeometryAssemblyProposal {
    pub plan: EditPlan,
    pub preflight: Value,
}

pub(super) fn compile(
    session: &EditorSession, request: &GeometryAssemblyRequest,
) -> Result<GeometryAssemblyProposal> {
    session.check_revision(request.expected_revision)?;
    if serde_json::to_vec(request)
        .map_err(|_| fail("GEOMETRY_ASSEMBLY_INPUT_INVALID"))?.len() > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_ASSEMBLY_INPUT_TOO_LARGE"));
    }
    if request.parts.is_empty() || request.parts.len() > MAX_OPERATIONS {
        return Err(fail("GEOMETRY_ASSEMBLY_PART_COUNT_INVALID"));
    }

    let doc = session.document();
    let mut used_ids: HashSet<&str> = doc.cubes.iter()
        .map(|cube| cube.uuid.as_str())
        .chain(doc.bones.iter().map(|bone| bone.uuid.as_str()))
        .chain(doc.texture_assets.iter().chain(doc.animation_assets.iter())
            .filter_map(|asset| asset.get("uuid").and_then(Value::as_str)))
        .collect();
    let existing_bones: HashSet<&str> = doc.bones.iter()
        .map(|bone| bone.uuid.as_str()).collect();
    let mut new_bones: HashSet<&str> = HashSet::new();
    let mut used_names: HashSet<String> = doc.bones.iter()
        .map(|bone| bone.name.to_ascii_lowercase()).collect();
    let mut count = 0usize;
    for part in &request.parts {
        if !valid_uuid(&part.bone.uuid) || !used_ids.insert(part.bone.uuid.as_str()) {
            return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
        }
        if !geometry::valid_bone_name(&part.bone.name) ||
           !used_names.insert(part.bone.name.to_ascii_lowercase()) {
            return Err(fail("GEOMETRY_ASSEMBLY_BONE_NAME_INVALID"));
        }
        if part.bone.origin.is_none() {
            return Err(fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"));
        }
        new_bones.insert(part.bone.uuid.as_str());
        count = count.saturating_add(1 + part.cubes.len());
        if count > MAX_OPERATIONS {
            return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
        }
        for cube in &part.cubes {
            if !valid_uuid(&cube.uuid) || !used_ids.insert(cube.uuid.as_str()) {
                return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
            }
            if !cube.name.as_deref().is_some_and(valid_node_name) {
                return Err(fail("GEOMETRY_ASSEMBLY_CUBE_NAME_REQUIRED"));
            }
        }
    }
    for part in &request.parts {
        if let Some(parent) = &part.parent_uuid {
            if !valid_uuid(parent) ||
               (!existing_bones.contains(parent.as_str()) &&
                !new_bones.contains(parent.as_str())) {
                return Err(fail("GEOMETRY_ASSEMBLY_PARENT_UNKNOWN"));
            }
        }
    }

    // Dependency order is stable: the earliest currently eligible part
    // retains its input order. Never resolve an ambiguous label as a parent.
    let mut completed = existing_bones;
    let mut scheduled = vec![false; request.parts.len()];
    let mut operations = Vec::with_capacity(count);
    let mut remaining = request.parts.len();
    while remaining > 0 {
        let mut progress = false;
        for (index, part) in request.parts.iter().enumerate() {
            if scheduled[index] ||
               !part.parent_uuid.as_ref().is_none_or(|parent|
                   completed.contains(parent.as_str())) {
                continue;
            }
            operations.push(EditOperation::AddBone {
                bone: part.bone.clone(), parent_uuid: part.parent_uuid.clone(),
            });
            for cube in &part.cubes {
                operations.push(EditOperation::AddCube {
                    cube: cube.clone(), bone_uuid: part.bone.uuid.clone(),
                });
            }
            completed.insert(part.bone.uuid.as_str());
            scheduled[index] = true;
            remaining -= 1;
            progress = true;
        }
        if !progress { return Err(fail("GEOMETRY_ASSEMBLY_PARENT_CYCLE")); }
    }
    let plan = EditPlan {
        expected_revision: request.expected_revision,
        operations,
        correction_scope: None,
    };
    if serde_json::to_vec(&plan)
        .map_err(|_| fail("GEOMETRY_ASSEMBLY_PLAN_INVALID"))?.len() > MAX_PLAN_BYTES {
        return Err(fail("GEOMETRY_ASSEMBLY_PLAN_TOO_LARGE"));
    }
    let preflight = session.preflight(&plan)?;
    Ok(GeometryAssemblyProposal { plan, preflight })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{sha256, AuthoringDocument};
    use serde_json::json;
    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const ROOT: &str = "00000000-0000-4000-8000-000000001101";
    const CHILD: &str = "00000000-0000-4000-8000-000000001102";
    const CUBE_A: &str = "00000000-0000-4000-8000-000000001103";
    const CUBE_B: &str = "00000000-0000-4000-8000-000000001104";

    fn part(bone_id: &str, name: &str, parent: Option<&str>, cube_id: &str) -> GeometryAssemblyPart {
        let bone: Bone = serde_json::from_value(json!({
            "uuid":bone_id,"name":name,"origin":[0.0,0.0,0.0]
        })).unwrap();
        let fixture: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut cube: Cube = serde_json::from_value(fixture["elements"][0].clone()).unwrap();
        cube.uuid = cube_id.into();
        cube.name = Some(format!("{name}_shape"));
        if bone_id == CHILD {
            cube.from = [4.0,0.0,0.0];
            cube.to = [8.0,4.0,4.0];
            cube.origin = Some([4.0,0.0,0.0]);
        }
        GeometryAssemblyPart {
            bone, parent_uuid: parent.map(str::to_owned), cubes: vec![cube],
        }
    }

    #[test]
    fn child_first_parts_become_one_parent_first_undoable_edit_plan() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("G1", "g1").unwrap()).unwrap();
        let before = session.document().clone();
        let input = GeometryAssemblyRequest {
            expected_revision:0,
            parts:vec![
                part(CHILD,"arm",Some(ROOT),CUBE_B),
                part(ROOT,"body",None,CUBE_A),
            ],
        };
        let proposal = compile(&session,&input).unwrap();
        let plan = proposal.plan;
        assert_eq!(plan.operations.len(),4);
        assert!(matches!(&plan.operations[0],EditOperation::AddBone{bone,..}
            if bone.uuid==ROOT));
        assert!(matches!(&plan.operations[1],EditOperation::AddCube{cube,bone_uuid}
            if cube.uuid==CUBE_A && bone_uuid==ROOT));
        assert!(matches!(&plan.operations[2],EditOperation::AddBone{bone,parent_uuid}
            if bone.uuid==CHILD && parent_uuid.as_deref()==Some(ROOT)));
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
        assert_eq!(proposal.preflight["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
        let receipt=session.apply(plan.expected_revision,&plan.operations).unwrap();
        assert_eq!(receipt.operation_count,4);
        assert_eq!(receipt.changed_uuids.len(),4);
        let after=session.document().clone();
        assert_eq!(after.bones.len(),2);
        assert_eq!(after.cubes.len(),2);
        let bbmodel=session.export().unwrap();
        assert_eq!(proposal.preflight["candidate_sha256"],sha256(&bbmodel));
        assert_eq!(EditorSession::open(&bbmodel).unwrap().document(),&after);
        assert!(super::super::geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&after);
    }

    #[test]
    fn existing_bone_parent_is_preserved_and_compilation_has_no_side_effect() {
        let session=EditorSession::open(SAMPLE).unwrap();
        let before=session.document().clone();
        let parent=before.bones[0].uuid.clone();
        let request=GeometryAssemblyRequest {
            expected_revision:0,
            parts:vec![part(CHILD,"attachment",Some(&parent),CUBE_B)],
        };
        let proposal=compile(&session,&request).unwrap();
        assert!(matches!(&proposal.plan.operations[0],
            EditOperation::AddBone{parent_uuid,..}
            if parent_uuid.as_deref()==Some(parent.as_str())));
        assert_eq!(session.document(),&before);
        assert!(!session.can_undo());
    }

    #[test]
    fn incorrect_parent_cycle_duplicate_and_stale_refuse_without_mutation() {
        let session=EditorSession::open(SAMPLE).unwrap();
        let before=session.document().clone();
        let invalid=[
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",Some("missing-parent"),CUBE_A),
            ]},"GEOMETRY_ASSEMBLY_PARENT_UNKNOWN"),
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",Some(CHILD),CUBE_A),
                part(CHILD,"two",Some(ROOT),CUBE_B),
            ]},"GEOMETRY_ASSEMBLY_PARENT_CYCLE"),
            (GeometryAssemblyRequest {expected_revision:0,parts:vec![
                part(ROOT,"one",None,CUBE_A),
                part(CHILD,"two",None,CUBE_A),
            ]},"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
            (GeometryAssemblyRequest {expected_revision:1,parts:vec![
                part(ROOT,"one",None,CUBE_A),
            ]},"DOCUMENT_REVISION_STALE"),
        ];
        for (req,error) in invalid {
            assert_eq!(compile(&session,&req).err().as_deref(),Some(error));
            assert_eq!(session.document(),&before);
            assert!(!session.can_undo());
        }
        let mut pivotless=part(ROOT,"one",None,CUBE_A);
        pivotless.bone.origin=None;
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![pivotless]
        }).err().as_deref(),Some("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"));
        let mut nameless=part(ROOT,"one",None,CUBE_A);
        nameless.cubes[0].name=None;
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![nameless]
        }).err().as_deref(),Some("GEOMETRY_ASSEMBLY_CUBE_NAME_REQUIRED"));
        let mut invalid_uv=part(ROOT,"one",None,CUBE_A);
        invalid_uv.cubes[0].faces.get_mut("north").unwrap()["uv"] =
            json!([-200_000.0,0,1,1]);
        assert_eq!(compile(&session,&GeometryAssemblyRequest {
            expected_revision:0,parts:vec![invalid_uv]
        }).err().as_deref(),Some("CUBE_FACE_UV_INVALID"));
        assert_eq!(session.document(),&before);
        assert!(serde_json::from_value::<GeometryAssemblyRequest>(json!({
            "expected_revision":0,"parts":[],"unknown_field":true
        })).is_err());
    }
}
