//! G1: bounded, structure-first Rust Geometry assembly.
//! Converts explicitly named parts and exact Bone/Cube identities into the
//! existing EditPlan, without inferring dimensions, writing files or storing
//! a parallel model. SOURCE_ONLY; native/Blockbench tests NOT_EXECUTED.

use super::{
    fail, geometry, valid_bounds, valid_node_name, valid_uuid, Bone, Cube,
    EditOperation, EditPlan, EditorSession, Result, FACE_NAMES, MAX_OPERATIONS, MAX_PLAN_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

/// The parent is an existing or simultaneously declared Bone UUID.
/// Bone pivots and Cube geometry are caller-authored source facts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryAssemblyPart {
    pub bone: Bone,
    pub parent_uuid: Option<String>,
    pub cubes: Vec<Cube>,
    /// Optional untextured blockout construction. Four disjoint panels per
    /// frame, compiled into the same AddCube operations as explicit parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frames: Vec<GeometryRectangularFrame>,
}

/// Source-authored through-opening. Axis is the normal to its opening;
/// left/right/bottom/top describe the two remaining axes in ascending order.
/// UUIDs are explicit: no hidden identity or persisted construction engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeometryRectangularFrame {
    pub name: String,
    pub center: [f64; 3],
    pub size: [u32; 3],
    pub normal_axis: String,
    pub border: u32,
    /// Stable panel UUIDs, in left/right/bottom/top order.
    pub cube_uuids: [String; 4],
}

/// This geometry method is *untextured* blockout: Box UV metadata exists
/// for later explicit atlas layout, but no PNG, texture link or visual
/// evidence is created. A pre-existing textured project refuses the method.
fn compile_rectangular_frame(
    frame: &GeometryRectangularFrame, bone_origin: [f64; 3],
) -> Result<[Cube; 4]> {
    let normal = match frame.normal_axis.as_str() {
        "X" => 0, "Y" => 1, "Z" => 2,
        _ => return Err(fail("GEOMETRY_FRAME_AXIS_INVALID")),
    };
    let [a, b] = match normal {
        0 => [1, 2], 1 => [0, 2], 2 => [0, 1], _ => unreachable!(),
    };
    if !valid_node_name(&frame.name) || frame.name.chars().count() > 120 {
        return Err(fail("GEOMETRY_FRAME_NAME_INVALID"));
    }
    let size = frame.size.map(f64::from);
    let border = f64::from(frame.border);
    if frame.size.iter().any(|n| !(1..=32).contains(n)) ||
       !(1..=16).contains(&frame.border) ||
       size[a] <= 2.0 * border || size[b] <= 2.0 * border {
        return Err(fail("GEOMETRY_FRAME_OPENING_INVALID"));
    }
    let low = std::array::from_fn(|i| frame.center[i] - size[i] / 2.0);
    let high = std::array::from_fn(|i| frame.center[i] + size[i] / 2.0);
    if !valid_bounds(low, high) {
        return Err(fail("GEOMETRY_FRAME_BOUNDS_INVALID"));
    }
    let make_panel = |index: usize, name: &str,
                          along_a: [f64; 2], along_b: [f64; 2]| {
        let mut from = low;
        let mut to = high;
        from[a] = along_a[0]; to[a] = along_a[1];
        from[b] = along_b[0]; to[b] = along_b[1];
        let mut faces = Map::new();
        for side in FACE_NAMES {
            // No texture reference. Canonical AddCube derives its Box UV
            // rectangles, and a later Texture stage owns atlas allocation.
            faces.insert(side.into(), json!({"uv":[0,0,1,1]}));
        }
        let mut extra = Map::new();
        extra.insert("box_uv".into(), Value::Bool(true));
        Cube {
            uuid: frame.cube_uuids[index].clone(),
            kind: "cube".into(),
            name: Some(format!("{}_{}", frame.name, name)),
            from, to, origin: Some(bone_origin), uv_offset: None, faces, extra,
        }
    };
    let result = [
        make_panel(0, "left", [low[a], low[a] + border], [low[b], high[b]]),
        make_panel(1, "right", [high[a] - border, high[a]], [low[b], high[b]]),
        make_panel(2, "bottom", [low[a] + border, high[a] - border], [low[b], low[b] + border]),
        make_panel(3, "top", [low[a] + border, high[a] - border], [high[b] - border, high[b]]),
    ];
    if result.iter().any(|cube| !valid_bounds(cube.from, cube.to) ||
       (0..3).any(|i| cube.from[i] >= cube.to[i])) {
        return Err(fail("GEOMETRY_FRAME_PANEL_INVALID"));
    }
    Ok(result)
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
    let mut generated: Vec<Vec<Cube>> = Vec::with_capacity(request.parts.len());
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
        // Admit the entire bounded operation count *before* constructing
        // any panels. Never allocate a large transient shape on bad input.
        let additions = part.frames.len().checked_mul(4)
            .and_then(|panels| 1usize.checked_add(part.cubes.len())?
                .checked_add(panels))
            .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
        count = count.checked_add(additions)
            .ok_or_else(|| fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"))?;
        if count > MAX_OPERATIONS {
            return Err(fail("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
        }
        if !part.frames.is_empty() && !doc.texture_assets.is_empty() {
            return Err(fail("GEOMETRY_FRAME_TEXTURED_PROJECT_UNSUPPORTED"));
        }
        let mut panels = Vec::with_capacity(part.frames.len() * 4);
        for frame in &part.frames {
            // The Bone pivot is caller supplied and validated above.
            panels.extend(compile_rectangular_frame(
                frame, part.bone.origin.ok_or_else(||
                    fail("GEOMETRY_ASSEMBLY_PIVOT_REQUIRED"))?,
            )?);
        }
        // Bind UUID membership to the source request, not to transient
        // generated Cubes. The panels are later moved into the operation
        // buffer; borrowing their strings across iterations is invalid.
        for uuid in part.cubes.iter().map(|cube| cube.uuid.as_str())
            .chain(part.frames.iter().flat_map(|frame|
                frame.cube_uuids.iter().map(String::as_str))) {
            if !valid_uuid(uuid) || !used_ids.insert(uuid) {
                return Err(fail("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
            }
        }
        if part.cubes.iter().chain(panels.iter())
            .any(|cube| !cube.name.as_deref().is_some_and(valid_node_name)) {
            return Err(fail("GEOMETRY_ASSEMBLY_CUBE_NAME_REQUIRED"));
        }
        for cube in &panels {
            // Box UV panels start at [0,0]; refuse an atlas that cannot
            // contain even one actual panel net. Later Texture owns packing.
            let dims: [f64; 3] = std::array::from_fn(|i|
                cube.to[i] - cube.from[i]);
            if 2.0 * (dims[0] + dims[2]) > f64::from(doc.resolution.width) ||
               dims[1] + dims[2] > f64::from(doc.resolution.height) {
                return Err(fail("GEOMETRY_FRAME_UV_ATLAS_TOO_SMALL"));
            }
        }
        generated.push(panels);
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
            for cube in part.cubes.iter().chain(generated[index].iter()) {
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
            frames: Vec::new(),
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

    const FRAME_IDS: [&str; 4] = [
        "00000000-0000-4000-8000-000000001111",
        "00000000-0000-4000-8000-000000001112",
        "00000000-0000-4000-8000-000000001113",
        "00000000-0000-4000-8000-000000001114",
    ];

    fn frame_request() -> GeometryAssemblyRequest {
        let mut body = part(ROOT, "portal_bone", None, CUBE_A);
        body.cubes.clear();
        body.frames.push(GeometryRectangularFrame {
            name: "portal".into(),
            center: [0.0, 0.0, 0.0],
            size: [10, 8, 2],
            normal_axis: "Z".into(),
            border: 1,
            cube_uuids: FRAME_IDS.map(str::to_owned),
        });
        GeometryAssemblyRequest { expected_revision: 0, parts: vec![body] }
    }

    #[test]
    fn untextured_frame_builds_four_disjoint_panels_and_real_through_opening() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        let before = session.document().clone();
        let request = frame_request();
        let plan = compile(&session, &request).unwrap();
        assert_eq!(plan.plan.operations.len(), 5);
        assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
        assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        let expected = [
            ([-5.0, -4.0, -1.0], [-4.0, 4.0, 1.0]),
            ([4.0, -4.0, -1.0], [5.0, 4.0, 1.0]),
            ([-4.0, -4.0, -1.0], [4.0, -3.0, 1.0]),
            ([-4.0, 3.0, -1.0], [4.0, 4.0, 1.0]),
        ];
        let mut volume = 0.0;
        for (index, &(from, to)) in expected.iter().enumerate() {
            match &plan.plan.operations[index + 1] {
                EditOperation::AddCube { cube, bone_uuid } => {
                    assert_eq!(bone_uuid, ROOT);
                    assert_eq!(cube.uuid, FRAME_IDS[index]);
                    assert_eq!((cube.from, cube.to), (from, to));
                    assert_eq!(cube.name.as_deref(), Some(
                        ["portal_left","portal_right","portal_bottom","portal_top"][index]
                    ));
                    assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
                    assert!(cube.faces.values().all(|f| f.get("texture").is_none()));
                    volume += (to[0] - from[0]) * (to[1] - from[1]) *
                        (to[2] - from[2]);
                }
                _ => panic!("Expected generated AddCube"),
            }
        }
        assert_eq!(volume, 64.0); // outer volume 160 minus hole volume 96
        for i in 0..4 {
            for j in (i + 1)..4 {
                assert!((0..3).any(|axis|
                    expected[i].1[axis].min(expected[j].1[axis]) <=
                    expected[i].0[axis].max(expected[j].0[axis])
                ));
            }
        }
        // The entire axis-normal tunnel is genuinely empty, not painted.
        assert!(expected.iter().all(|(from, to)| !(0..3).all(|axis|
            from[axis] < 0.0 && 0.0 < to[axis]
        )));
        session.apply(0, &plan.plan.operations).unwrap();
        let after = session.document().clone();
        assert_eq!(after.cubes.len(), 4);
        let saved = session.export().unwrap();
        assert_eq!(plan.preflight["candidate_sha256"], sha256(&saved));
        assert_eq!(EditorSession::open(&saved).unwrap().document(), &after);
        assert!(geometry::export_bedrock_geometry(&after).is_ok());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &before);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &after);
    }

    #[test]
    fn frame_through_opening_is_axis_agnostic_with_bone_pivot_retained() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        for axis in ["X", "Y", "Z"] {
            let mut request = frame_request();
            let frame = &mut request.parts[0].frames[0];
            frame.normal_axis = axis.into();
            frame.size = [8, 8, 8];
            frame.center = [2.0, 3.0, 4.0];
            let normal = match axis { "X" => 0, "Y" => 1, _ => 2 };
            let plan = compile(&session, &request).unwrap();
            assert_eq!(plan.plan.operations.len(), 5);
            for operation in &plan.plan.operations[1..] {
                let EditOperation::AddCube { cube, .. } = operation
                    else { panic!("Expected one panel per Cube"); };
                assert_eq!(cube.origin, Some([0.0, 0.0, 0.0]));
                assert_eq!(cube.from[normal], frame.center[normal] - 4.0);
                assert_eq!(cube.to[normal], frame.center[normal] + 4.0);
                // At the tunnel center, every panel has at least one
                // tangential axis outside the point (the hole is open).
                assert!((0..3).any(|i|
                    i != normal && (frame.center[i] <= cube.from[i] ||
                        frame.center[i] >= cube.to[i])
                ));
            }
            assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
        }
    }

    #[test]
    fn frame_refuses_bad_axis_opening_bounds_duplicate_and_unsafe_atlas() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Frame", "frame").unwrap()
        ).unwrap();
        let before = session.document().clone();
        for (change, code) in [
            (0, "GEOMETRY_FRAME_AXIS_INVALID"),
            (1, "GEOMETRY_FRAME_OPENING_INVALID"),
            (2, "GEOMETRY_FRAME_BOUNDS_INVALID"),
            (3, "GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
        ] {
            let mut request = frame_request();
            let frame = &mut request.parts[0].frames[0];
            match change {
                0 => frame.normal_axis = "Q".into(),
                1 => frame.border = 4,
                2 => frame.center = [100_000.0, 0.0, 0.0],
                3 => frame.cube_uuids[1] = frame.cube_uuids[0].clone(),
                _ => unreachable!(),
            }
            assert_eq!(compile(&session, &request).err().as_deref(), Some(code));
        }
        assert_eq!(session.document(), &before);
        assert!(!session.can_undo());

        // An otherwise valid but oversized declaration must be refused
        // before allocating or compiling its 4 * 32 panel Cubes.
        let mut oversized = frame_request();
        let one_frame = oversized.parts[0].frames[0].clone();
        oversized.parts[0].frames = vec![one_frame; 32];
        assert_eq!(compile(&session, &oversized).err().as_deref(),
            Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));

        let mut small_atlas = session.clone();
        small_atlas.apply(0, &[EditOperation::SetEmptyAtlasResolution {
            width: 4, height: 4,
        }]).unwrap();
        assert_eq!(compile(&small_atlas, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("GEOMETRY_FRAME_UV_ATLAS_TOO_SMALL"));

        let mut textured = session.clone();
        textured.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000001115".into(),
            name: "atlas".into(),
        }]).unwrap();
        assert_eq!(compile(&textured, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("GEOMETRY_FRAME_TEXTURED_PROJECT_UNSUPPORTED"));
        assert_eq!(compile(&session, &GeometryAssemblyRequest {
            expected_revision: 1, ..frame_request()
        }).err().as_deref(), Some("DOCUMENT_REVISION_STALE"));
        assert!(serde_json::from_value::<GeometryRectangularFrame>(json!({
            "name": "frame", "center": [0,0,0], "size": [10,8,2],
            "normal_axis": "Z", "border": 1,
            "cube_uuids": FRAME_IDS, "unknown": true
        })).is_err());
        let empty = part(ROOT,"body",None,CUBE_A);
        assert!(serde_json::to_value(empty).unwrap().get("frames").is_none());
    }

}
