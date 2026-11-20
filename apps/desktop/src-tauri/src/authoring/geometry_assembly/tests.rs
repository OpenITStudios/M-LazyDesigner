// SOURCE_AUTHORED_NOT_RUN: original in-module regression tests moved without
// changing test assertions, fixture contents or Rust Core ownership.
use super::*;
use super::super::{sha256, AuthoringDocument};
use serde_json::json;
const SAMPLE: &[u8] = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
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
        frames: Vec::new(), hollow_boxes: Vec::new(),
        arches: Vec::new(), sweeps: Vec::new(),
        profile_sweeps: Vec::new(), lofts: Vec::new(), revolves: Vec::new(),
        rib_arrays: Vec::new(),
    }
}

#[test]
fn g6_ribs_share_g1_preflight_and_g5_void_without_model_mutation() {
    let session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Rib Array", "rib_array").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let mut body=part(ROOT,"body",None,CUBE_A);
    body.cubes.clear();
    body.rib_arrays.push(GeometryRibArray {
        name:"fin".into(),
        uuid_seed:"00000000-0000-4000-8000-000000007901".into(),
        from:[0,0,0],to:[20,4,6],axis:"X".into(),
        count:4,thickness:2,
    });
    let proposal=compile(&session,&GeometryAssemblyRequest {
        expected_revision:0,parts:vec![body],
    }).unwrap();
    assert_eq!(proposal.plan.operations.len(),5);
    assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
    let zone=super::super::GeometryVoidZone {
        bone_uuid:ROOT.into(),from:[3.0,1.0,1.0],to:[5.0,3.0,5.0],
    };
    let evidence=super::super::check_geometry_void_zones(
        &proposal.plan,&[zone]).unwrap();
    assert_eq!(evidence["local_bounds_verdict"],
        "CLEAR_OF_PROPOSED_AXIS_ALIGNED_CUBES");
    assert_eq!(session.document(),&before);
    assert_eq!(session.summary().revision,0);
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


const HOLLOW_IDS: [&str; 5] = [
    "00000000-0000-4000-8000-000000001121",
    "00000000-0000-4000-8000-000000001122",
    "00000000-0000-4000-8000-000000001123",
    "00000000-0000-4000-8000-000000001124",
    "00000000-0000-4000-8000-000000001125",
];

fn hollow_request() -> GeometryAssemblyRequest {
    let mut part = part(ROOT, "container_bone", None, CUBE_A);
    part.cubes.clear();
    part.hollow_boxes.push(GeometryHollowBox {
        name: "container".into(), center: [0.0; 3],
        size: [10, 8, 6], open_face: "POS_Z".into(), wall: 1,
        cube_uuids: HOLLOW_IDS.map(str::to_owned),
    });
    GeometryAssemblyRequest { expected_revision: 0, parts: vec![part] }
}

#[test]
fn hollow_box_generates_five_disjoint_panels_with_real_cavity_and_reversible_export() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
    ).unwrap();
    let before = session.document().clone();
    let plan = compile(&session, &hollow_request()).unwrap();
    assert_eq!(plan.plan.operations.len(), 6);
    assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
    assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
    assert_eq!(session.document(), &before);
    assert!(!session.can_undo());

    // For POS_Z, X and Y retain full wall depth; only the final
    // interior-sized panel closes the -Z face.
    let expected = [
        ([-5.0,-4.0,-3.0],[-4.0,4.0,3.0]),
        ([4.0,-4.0,-3.0],[5.0,4.0,3.0]),
        ([-4.0,-4.0,-3.0],[4.0,-3.0,3.0]),
        ([-4.0,3.0,-3.0],[4.0,4.0,3.0]),
        ([-4.0,-3.0,-3.0],[4.0,3.0,-2.0]),
    ];
    let mut volume = 0.0;
    for (index, (from, to)) in expected.iter().enumerate() {
        let EditOperation::AddCube { cube, bone_uuid } =
            &plan.plan.operations[index + 1]
        else { panic!("Expected one AddCube per panel"); };
        assert_eq!(cube.uuid, HOLLOW_IDS[index]);
        assert_eq!(bone_uuid, ROOT);
        assert_eq!((&cube.from, &cube.to), (from, to));
        assert_eq!(cube.name.as_deref(), Some(
            ["container_wall_a_low", "container_wall_a_high",
             "container_wall_b_low", "container_wall_b_high",
             "container_back"][index]));
        assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|face| face.get("texture").is_none()));
        assert_eq!(cube.origin, Some([0.0; 3]));
        volume += (0..3).map(|axis| to[axis] - from[axis]).product::<f64>();
        // Every panel misses a point in the open cavity.
        assert!(!(0..3).all(|axis|
            from[axis] <= [0.0, 0.0, 2.0][axis] &&
            [0.0, 0.0, 2.0][axis] < to[axis]));
    }
    assert_eq!(volume, 240.0); // 10*8*6 minus 8*6*5
    for i in 0..5 {
        for j in i+1..5 {
            assert!((0..3).any(|axis|
                expected[i].1[axis].min(expected[j].1[axis]) <=
                expected[i].0[axis].max(expected[j].0[axis])
            ));
        }
    }

    session.apply(0, &plan.plan.operations).unwrap();
    let after = session.document().clone();
    assert_eq!(after.cubes.len(), 5);
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
fn hollow_box_six_faces_keep_correct_back_and_open_cavity() {
    let session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
    ).unwrap();
    for (face, axis, positive) in [
        ("POS_X",0,true), ("NEG_X",0,false),
        ("POS_Y",1,true), ("NEG_Y",1,false),
        ("POS_Z",2,true), ("NEG_Z",2,false),
    ] {
        let mut req = hollow_request();
        req.parts[0].hollow_boxes[0].open_face = face.into();
        let proposal = compile(&session, &req).unwrap();
        assert_eq!(proposal.plan.operations.len(), 6);
        let panel = &proposal.plan.operations[5];
        let EditOperation::AddCube { cube: back, .. } = panel
        else { panic!("Expected back panel"); };
        let depth = f64::from(req.parts[0].hollow_boxes[0].size[axis]);
        assert_eq!(back.to[axis] - back.from[axis], 1.0);
        if positive {
            assert_eq!(back.from[axis], -depth / 2.0);
        } else {
            assert_eq!(back.to[axis], depth / 2.0);
        }
        let mut open_point = [0.0; 3];
        open_point[axis] = if positive {
            depth / 2.0 - 0.5
        } else {
            -depth / 2.0 + 0.5
        };
        for op in &proposal.plan.operations[1..] {
            let EditOperation::AddCube { cube, .. } = op
            else { panic!("Expected 5 Cubes"); };
            assert!(!(0..3).all(|i|
                cube.from[i] <= open_point[i] &&
                open_point[i] < cube.to[i]));
        }
        assert_eq!(proposal.preflight["write_authority"], "NOT_GRANTED");
    }
}

#[test]
fn hollow_box_rejects_unsafe_inputs_before_applying_any_cube() {
    let session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Hollow", "hollow").unwrap()
    ).unwrap();
    let before = session.document().clone();
    for (case, expected) in [
        (0,"GEOMETRY_HOLLOW_FACE_INVALID"),
        (1,"GEOMETRY_HOLLOW_SIZE_INVALID"),
        (2,"GEOMETRY_HOLLOW_WALL_INVALID"),
        (3,"GEOMETRY_HOLLOW_CAVITY_REQUIRED"),
        (4,"GEOMETRY_HOLLOW_BOUNDS_INVALID"),
        (5,"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
        (6,"GEOMETRY_HOLLOW_NAME_INVALID"),
    ] {
        let mut req = hollow_request();
        let hollow = &mut req.parts[0].hollow_boxes[0];
        match case {
            0 => hollow.open_face = "FRONT".into(),
            1 => hollow.size = [0,8,6],
            2 => hollow.wall = 0,
            3 => hollow.wall = 4,
            4 => hollow.center = [100_000.0,0.0,0.0],
            5 => hollow.cube_uuids[1] = hollow.cube_uuids[0].clone(),
            6 => hollow.name = "x".repeat(120),
            _ => unreachable!(),
        }
        assert_eq!(compile(&session, &req).err().as_deref(), Some(expected));
    }
    let mut cross = hollow_request();
    cross.parts[0].frames.push(GeometryRectangularFrame {
        name: "portal".into(), center: [0.0; 3], size: [10,8,2],
        normal_axis: "Z".into(), border: 1,
        cube_uuids: [HOLLOW_IDS[0], FRAME_IDS[1],
            FRAME_IDS[2], FRAME_IDS[3]].map(str::to_owned),
    });
    assert_eq!(compile(&session, &cross).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

    let mut oversized = hollow_request();
    let one = oversized.parts[0].hollow_boxes[0].clone();
    oversized.parts[0].hollow_boxes = vec![one; 26];
    assert_eq!(compile(&session, &oversized).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
    assert_eq!(session.document(), &before);
    assert!(!session.can_undo());

    let mut tiny = session.clone();
    tiny.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 4, height: 4,
    }]).unwrap();
    assert_eq!(compile(&tiny, &GeometryAssemblyRequest {
        expected_revision: 1, ..hollow_request()
    }).err().as_deref(), Some("GEOMETRY_HOLLOW_UV_ATLAS_TOO_SMALL"));

    let mut textured = session.clone();
    textured.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000001126".into(),
        name: "atlas".into(),
    }]).unwrap();
    assert_eq!(compile(&textured, &GeometryAssemblyRequest {
        expected_revision: 1, ..hollow_request()
    }).err().as_deref(), Some("GEOMETRY_HOLLOW_TEXTURED_PROJECT_UNSUPPORTED"));
    assert_eq!(compile(&session, &GeometryAssemblyRequest {
        expected_revision: 1, ..hollow_request()
    }).err().as_deref(), Some("DOCUMENT_REVISION_STALE"));
    let mut unknown = serde_json::to_value(
        &hollow_request().parts[0].hollow_boxes[0]).unwrap();
    unknown["unknown_field"] = json!(true);
    assert!(serde_json::from_value::<GeometryHollowBox>(unknown).is_err());
    let prior = part(ROOT, "legacy", None, CUBE_A);
    let json = serde_json::to_value(&prior).unwrap();
    assert!(json.get("frames").is_none());
    assert!(json.get("hollow_boxes").is_none());
}


const ARCH_IDS: [&str; 7] = [
    "00000000-0000-4000-8000-000000001131",
    "00000000-0000-4000-8000-000000001132",
    "00000000-0000-4000-8000-000000001133",
    "00000000-0000-4000-8000-000000001134",
    "00000000-0000-4000-8000-000000001135",
    "00000000-0000-4000-8000-000000001136",
    "00000000-0000-4000-8000-000000001137",
];

fn arch_request() -> GeometryAssemblyRequest {
    let mut component = part(ROOT, "arch_bone", None, CUBE_A);
    component.cubes.clear();
    component.arches.push(GeometryArch {
        name: "doorway".into(),
        center: [0.0; 3],
        size: [19, 12, 4],
        span_axis: "X".into(),
        wall: 2,
        rise: 6,
        cube_uuids: ARCH_IDS.iter().map(|id| (*id).into()).collect(),
    });
    GeometryAssemblyRequest {
        expected_revision: 0, parts: vec![component],
    }
}

#[test]
fn curved_arch_retains_grounded_piers_real_opening_and_one_reversible_edit_plan() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
    ).unwrap();
    let before = session.document().clone();
    let plan = compile(&session, &arch_request()).unwrap();
    assert_eq!(plan.plan.operations.len(), 8);
    assert_eq!(plan.preflight["status"], "VALIDATED_NOT_APPLIED");
    assert_eq!(plan.preflight["write_authority"], "NOT_GRANTED");
    assert_eq!(plan.preflight["visual_verdict"], "UNVERIFIED");
    assert_eq!(session.document(), &before);
    assert!(!session.can_undo());

    let mut bounds = Vec::new();
    for (index, operation) in plan.plan.operations[1..].iter().enumerate() {
        let EditOperation::AddCube { cube, bone_uuid } = operation
            else { panic!("Expected an ordinary native Cube"); };
        assert_eq!(cube.uuid, ARCH_IDS[index]);
        assert_eq!(bone_uuid, ROOT);
        assert_eq!(cube.origin, Some([0.0; 3]));
        assert_eq!(cube.extra.get("box_uv"), Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|face|
            face.get("texture").is_none()));
        assert_eq!((cube.from[2],cube.to[2]),(-2.0,2.0));
        bounds.push((cube.from, cube.to));
    }
    // Full-height side piers are intentionally separate from arch strips.
    assert_eq!((bounds[0].0,bounds[0].1),
        ([-9.5,-6.0,-2.0],[-7.5,6.0,2.0]));
    assert_eq!((bounds[1].0,bounds[1].1),
        ([7.5,-6.0,-2.0],[9.5,6.0,2.0]));
    assert_eq!(bounds[4].0[0],-1.5);
    assert_eq!(bounds[4].1[0],1.5);
    assert_eq!(bounds[4].0[1],4.0); // center crown = top - wall
    assert!(bounds[2].0[1] < bounds[4].0[1]);
    assert!((bounds[2].0[1]-bounds[6].0[1]).abs()<1e-9);

    // Exactly disjoint volume, contiguous footprints, and an entirely
    // empty path through the opening below the underside center.
    for i in 0..bounds.len() {
        for j in i+1..bounds.len() {
            assert!((0..3).any(|axis|
                bounds[i].1[axis].min(bounds[j].1[axis]) <=
                bounds[i].0[axis].max(bounds[j].0[axis])));
        }
        assert!(!(0..3).all(|axis|
            bounds[i].0[axis] <= [0.0,3.0,0.0][axis] &&
            [0.0,3.0,0.0][axis] < bounds[i].1[axis]));
    }
    let receipt = session.apply(0, &plan.plan.operations).unwrap();
    assert_eq!(receipt.operation_count,8);
    let after = session.document().clone();
    assert_eq!(after.cubes.len(),7);
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
fn curved_arch_supports_x_and_z_spans_without_changing_bone_pivot() {
    let session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
    ).unwrap();
    for axis in ["X", "Z"] {
        let mut req = arch_request();
        let arch = &mut req.parts[0].arches[0];
        arch.span_axis = axis.into();
        arch.size = [19,12,19];
        arch.center = [1.0,2.0,3.0];
        let proposal = compile(&session,&req).unwrap();
        assert_eq!(proposal.plan.operations.len(),8);
        let span = if axis=="X" {0} else {2};
        let depth = if span==0 {2} else {0};
        for op in &proposal.plan.operations[1..] {
            let EditOperation::AddCube { cube, .. } = op
                else { panic!("Expected Cube"); };
            assert_eq!(cube.from[depth],arch.center[depth]-9.0);
            assert_eq!(cube.to[depth],arch.center[depth]+9.0);
            assert_eq!(cube.origin,Some([0.0;3]));
        }
        assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
    }
}

#[test]
fn curved_arch_refuses_micro_columns_invalid_openings_and_unsafe_sources() {
    let session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Curved", "curved").unwrap()
    ).unwrap();
    let before = session.document().clone();
    for (case, code) in [
        (0,"GEOMETRY_ARCH_AXIS_INVALID"),
        (1,"GEOMETRY_ARCH_SIZE_INVALID"),
        (2,"GEOMETRY_ARCH_DIMENSIONS_INVALID"),
        (3,"GEOMETRY_ARCH_OPENING_INVALID"),
        (4,"GEOMETRY_ARCH_COLUMNS_INVALID"),
        (5,"GEOMETRY_ARCH_COLUMNS_TOO_NARROW"),
        (6,"GEOMETRY_ARCH_BOUNDS_INVALID"),
        (7,"GEOMETRY_ASSEMBLY_UUID_CONFLICT"),
        (8,"GEOMETRY_ARCH_NAME_INVALID"),
        (9,"GEOMETRY_ARCH_COLUMNS_GRID_UNSUPPORTED"),
        (10,"GEOMETRY_ARCH_CURVATURE_UNREPRESENTED"),
    ] {
        let mut req = arch_request();
        let arch=&mut req.parts[0].arches[0];
        match case {
            0 => arch.span_axis="Y".into(),
            1 => arch.size[0]=0,
            2 => arch.wall=0,
            3 => arch.rise=12,
            4 => { arch.cube_uuids.pop(); },
            5 => arch.size[0]=12,
            6 => arch.center=[100_000.0,0.0,0.0],
            7 => arch.cube_uuids[1]=arch.cube_uuids[0].clone(),
            8 => arch.name="x".repeat(120),
            9 => arch.size[0]=18,
            10 => arch.cube_uuids.truncate(5),
            _ => unreachable!(),
        }
        assert_eq!(compile(&session,&req).err().as_deref(),Some(code));
    }
    let mut cross = arch_request();
    cross.parts[0].hollow_boxes.push(GeometryHollowBox {
        name:"container".into(),center:[0.0;3],size:[10,8,6],
        open_face:"POS_Z".into(),wall:1,
        cube_uuids:[
            ARCH_IDS[0], HOLLOW_IDS[1], HOLLOW_IDS[2],
            HOLLOW_IDS[3], HOLLOW_IDS[4],
        ].map(str::to_owned),
    });
    assert_eq!(compile(&session,&cross).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

    let mut over_budget=arch_request();
    let one=over_budget.parts[0].arches[0].clone();
    over_budget.parts[0].arches=vec![one;19];
    assert_eq!(compile(&session,&over_budget).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_OPERATION_LIMIT"));
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());

    let mut tiny=session.clone();
    tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution {
        width:4,height:4
    }]).unwrap();
    assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
        expected_revision:1,..arch_request()
    }).err().as_deref(),Some("GEOMETRY_ARCH_UV_ATLAS_TOO_SMALL"));

    let mut textured=session.clone();
    textured.apply(0,&[EditOperation::CreatePaintTexture {
        uuid:"00000000-0000-4000-8000-000000001138".into(),
        name:"atlas".into(),
    }]).unwrap();
    assert_eq!(compile(&textured,&GeometryAssemblyRequest {
        expected_revision:1,..arch_request()
    }).err().as_deref(),Some("GEOMETRY_ARCH_TEXTURED_PROJECT_UNSUPPORTED"));
    assert_eq!(compile(&session,&GeometryAssemblyRequest {
        expected_revision:1,..arch_request()
    }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));

    let mut unknown=serde_json::to_value(
        &arch_request().parts[0].arches[0]).unwrap();
    unknown["unrecognized"]=json!(true);
    assert!(serde_json::from_value::<GeometryArch>(unknown).is_err());
    let existing=serde_json::to_value(part(ROOT,"legacy",None,CUBE_A)).unwrap();
    assert!(existing.get("frames").is_none());
    assert!(existing.get("hollow_boxes").is_none());
    assert!(existing.get("arches").is_none());
}


const SWEEP_SEED: &str = "00000000-0000-4000-8000-000000003501";
fn sweep_request() -> GeometryAssemblyRequest {
    let mut part=part(ROOT,"sweep_bone",None,CUBE_A);
    part.cubes.clear();
    part.sweeps.push(GeometrySphereSweep {
        name:"branch".into(),
        uuid_seed:SWEEP_SEED.into(),
        stations:vec![
            super::super::geometry_sweep::GeometrySweepStation {
                position:[-4,0,0],radius:2,
            },
            super::super::geometry_sweep::GeometrySweepStation {
                position:[0,2,0],radius:3,
            },
            super::super::geometry_sweep::GeometrySweepStation {
                position:[4,3,1],radius:2,
            },
        ],
        interpolation: None, max_chord_error: None,
    });
    GeometryAssemblyRequest{expected_revision:0,parts:vec![part]}
}

#[test]
fn g33_sweep_uses_one_readonly_g1_plan_with_deterministic_cubes_and_reversible_export(){
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Sweep","sweep").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let proposed=compile(&session,&sweep_request()).unwrap();
    assert_eq!(proposed.preflight["status"],"VALIDATED_NOT_APPLIED");
    assert_eq!(proposed.preflight["write_authority"],"NOT_GRANTED");
    assert_eq!(proposed.preflight["visual_verdict"],"UNVERIFIED");
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());
    let count=proposed.plan.operations.len();
    assert!((3..=65).contains(&count)); // one Bone, bounded Cuboid partition
    for (i,op) in proposed.plan.operations[1..].iter().enumerate(){
        let EditOperation::AddCube {cube,bone_uuid}=op
            else {panic!("Sweep must produce only AddCube operations");};
        assert_eq!(bone_uuid,ROOT);
        assert_eq!(cube.uuid,super::super::geometry_sweep::cube_uuid(SWEEP_SEED,i));
        assert_eq!(cube.name.as_deref(),Some(format!("branch_v_{i}").as_str()));
        assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|v|v.get("texture").is_none()));
        assert_eq!(cube.origin,Some([0.0;3]));
    }
    let committed=session.apply(0,&proposed.plan.operations).unwrap();
    assert_eq!(committed.operation_count,count);
    let after=session.document().clone();
    assert_eq!(after.cubes.len(),count-1);
    let bytes=session.export().unwrap();
    assert_eq!(proposed.preflight["candidate_sha256"],sha256(&bytes));
    assert_eq!(EditorSession::open(&bytes).unwrap().document(),&after);
    assert!(geometry::export_bedrock_geometry(&after).is_ok());
    session.undo(1).unwrap();
    assert_eq!(session.document(),&before);
    session.redo(2).unwrap();
    assert_eq!(session.document(),&after);
}

#[test]
fn g33_sweep_refuses_existing_id_collisions_texture_and_atlas_without_mutation(){
    let session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Sweep","sweep").unwrap()
    ).unwrap();
    let baseline=session.document().clone();
    let generated_id=super::super::geometry_sweep::cube_uuid(SWEEP_SEED,0);
    let mut same_part=sweep_request();
    let mut explicit=part(CHILD,"newpart",None,CUBE_B);
    explicit.cubes[0].uuid=generated_id.clone();
    same_part.parts[0].cubes.push(explicit.cubes[0].clone());
    assert_eq!(compile(&session,&same_part).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

    let mut later_part=sweep_request();
    let mut other=part(CHILD,"later",None,CUBE_B);
    other.cubes[0].uuid=generated_id.clone();
    later_part.parts.push(other);
    assert_eq!(compile(&session,&later_part).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

    let mut repeated=sweep_request();
    repeated.parts[0].sweeps[0].stations=vec![
        super::super::geometry_sweep::GeometrySweepStation {
            position:[-2,0,0],radius:2,
        },
        super::super::geometry_sweep::GeometrySweepStation {
            position:[2,0,0],radius:2,
        },
    ];
    repeated.parts[0].sweeps.push(repeated.parts[0].sweeps[0].clone());
    assert_eq!(compile(&session,&repeated).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
    assert_eq!(session.document(),&baseline);
    assert!(!session.can_undo());

    let mut textured=session.clone();
    textured.apply(0,&[EditOperation::CreatePaintTexture {
        uuid:"00000000-0000-4000-8000-000000003502".into(),
        name:"atlas".into(),
    }]).unwrap();
    assert_eq!(compile(&textured,&GeometryAssemblyRequest {
        expected_revision:1,..sweep_request()
    }).err().as_deref(),Some("GEOMETRY_SWEEP_TEXTURED_PROJECT_UNSUPPORTED"));

    let mut tiny=session.clone();
    tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution{
        width:4,height:4,
    }]).unwrap();
    assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
        expected_revision:1,..sweep_request()
    }).err().as_deref(),Some("GEOMETRY_SWEEP_UV_ATLAS_TOO_SMALL"));

    let mut too_many=sweep_request();
    let first=too_many.parts[0].sweeps[0].clone();
    too_many.parts[0].sweeps=vec![first;5];
    assert_eq!(compile(&session,&too_many).err().as_deref(),
        Some("GEOMETRY_SWEEP_COUNT_INVALID"));
    assert_eq!(compile(&session,&GeometryAssemblyRequest{
        expected_revision:1,..sweep_request()
    }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));
    assert!(serde_json::from_value::<GeometrySphereSweep>(json!({
        "name":"branch","uuid_seed":SWEEP_SEED,"stations":[],
        "foreign":true
    })).is_err());
    let legacy=serde_json::to_value(part(CHILD,"legacy",None,CUBE_B)).unwrap();
    assert!(legacy.get("sweeps").is_none());
}


#[test]
fn g34_adaptive_curved_sweep_keeps_g1_preflight_identity_export_and_undo(){
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Curved Sweep","curved_sweep").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let mut request=sweep_request();
    let sweep=&mut request.parts[0].sweeps[0];
    sweep.interpolation=Some("CENTRIPETAL_CATMULL_ROM".into());
    sweep.max_chord_error=Some(0.5);
    let planned=compile(&session,&request).unwrap();
    assert_eq!(planned.preflight["status"],"VALIDATED_NOT_APPLIED");
    assert_eq!(planned.preflight["write_authority"],"NOT_GRANTED");
    assert_eq!(planned.preflight["visual_verdict"],"UNVERIFIED");
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());
    let count=planned.plan.operations.len();
    assert!((3..=65).contains(&count));
    for (i,op) in planned.plan.operations[1..].iter().enumerate() {
        let EditOperation::AddCube{cube,bone_uuid}=op
            else{panic!("Curved Sweep must remain ordinary native Cubes");};
        assert_eq!(bone_uuid,ROOT);
        assert_eq!(cube.uuid,super::super::geometry_sweep::cube_uuid(SWEEP_SEED,i));
        assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|f|f.get("texture").is_none()));
        assert_eq!(cube.origin,Some([0.0;3]));
    }
    session.apply(0,&planned.plan.operations).unwrap();
    let after=session.document().clone();
    let bytes=session.export().unwrap();
    assert_eq!(planned.preflight["candidate_sha256"],sha256(&bytes));
    assert_eq!(EditorSession::open(&bytes).unwrap().document(),&after);
    assert!(geometry::export_bedrock_geometry(&after).is_ok());
    session.undo(1).unwrap();
    assert_eq!(session.document(),&before);
    session.redo(2).unwrap();
    assert_eq!(session.document(),&after);
}


const PROFILE_SEED: &str = "00000000-0000-4000-8000-000000004501";

fn profile_request() -> GeometryAssemblyRequest {
    let mut body=part(ROOT,"profile_bone",None,CUBE_A);
    body.cubes.clear();
    body.profile_sweeps.push(GeometryProfileSweep {
        name:"vent".into(), uuid_seed:PROFILE_SEED.into(),
        up_axis:"Y".into(), cross_section:"RECTANGLE".into(),
        stations:vec![
            super::super::geometry_profile_sweep::GeometryProfileStation {
                position:[-5,0,0],half_width:2,half_height:2,
                twist_degrees:0.0,
            },
            super::super::geometry_profile_sweep::GeometryProfileStation {
                position:[0,0,0],half_width:3,half_height:2,
                twist_degrees:0.0,
            },
            super::super::geometry_profile_sweep::GeometryProfileStation {
                position:[0,0,5],half_width:3,half_height:2,
                twist_degrees:0.0,
            },
        ],
    });
    GeometryAssemblyRequest{expected_revision:0,parts:vec![body]}
}

#[test]
fn g34b_profile_sweep_creates_reversible_native_cubes_via_one_g1_preflight() {
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Profile","profile").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let proposal=compile(&session,&profile_request()).unwrap();
    assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
    assert_eq!(proposal.preflight["write_authority"],"NOT_GRANTED");
    assert_eq!(proposal.preflight["visual_verdict"],"UNVERIFIED");
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());
    let count=proposal.plan.operations.len();
    assert!((3..=65).contains(&count)); // Bone + bounded Cube partition
    for (i,op) in proposal.plan.operations[1..].iter().enumerate(){
        let EditOperation::AddCube {cube,bone_uuid}=op
            else {panic!("Profile must produce canonical AddCube operations");};
        assert_eq!(bone_uuid,ROOT);
        assert_eq!(cube.uuid,
            super::super::geometry_profile_sweep::cube_uuid(PROFILE_SEED,i));
        assert_eq!(cube.name.as_deref(),Some(format!("vent_v_{i}").as_str()));
        assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|face|face.get("texture").is_none()));
        assert_eq!(cube.origin,Some([0.0;3]));
    }
    session.apply(0,&proposal.plan.operations).unwrap();
    let after=session.document().clone();
    assert_eq!(after.cubes.len(),count-1);
    let saved=session.export().unwrap();
    assert_eq!(proposal.preflight["candidate_sha256"],sha256(&saved));
    assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
    assert!(geometry::export_bedrock_geometry(&after).is_ok());
    session.undo(1).unwrap();
    assert_eq!(session.document(),&before);
    session.redo(2).unwrap();
    assert_eq!(session.document(),&after);
}

#[test]
fn g34b_profile_is_fail_closed_for_uuids_texture_uv_and_stale_revision() {
    let session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Profile","profile").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let generated=super::super::geometry_profile_sweep::cube_uuid(
        PROFILE_SEED,0);
    let mut explicit=profile_request();
    let mut existing=part(CHILD,"explicit",None,CUBE_B);
    existing.cubes[0].uuid=generated.clone();
    explicit.parts[0].cubes.push(existing.cubes[0].clone());
    assert_eq!(compile(&session,&explicit).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
    let mut later=profile_request();
    later.parts.push(existing);
    assert_eq!(compile(&session,&later).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));

    let mut repeated=profile_request();
    let shared=repeated.parts[0].profile_sweeps[0].clone();
    repeated.parts[0].profile_sweeps.push(shared);
    assert_eq!(compile(&session,&repeated).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());

    let mut textured=session.clone();
    textured.apply(0,&[EditOperation::CreatePaintTexture {
        uuid:"00000000-0000-4000-8000-000000004502".into(),
        name:"atlas".into(),
    }]).unwrap();
    assert_eq!(compile(&textured,&GeometryAssemblyRequest {
        expected_revision:1,..profile_request()
    }).err().as_deref(),
        Some("GEOMETRY_PROFILE_TEXTURED_PROJECT_UNSUPPORTED"));

    let mut tiny=session.clone();
    tiny.apply(0,&[EditOperation::SetEmptyAtlasResolution {
        width:4,height:4,
    }]).unwrap();
    assert_eq!(compile(&tiny,&GeometryAssemblyRequest {
        expected_revision:1,..profile_request()
    }).err().as_deref(),
        Some("GEOMETRY_PROFILE_UV_ATLAS_TOO_SMALL"));

    let mut excess=profile_request();
    let one=excess.parts[0].profile_sweeps[0].clone();
    excess.parts[0].profile_sweeps=vec![one;5];
    assert_eq!(compile(&session,&excess).err().as_deref(),
        Some("GEOMETRY_PROFILE_COUNT_INVALID"));
    assert_eq!(compile(&session,&GeometryAssemblyRequest {
        expected_revision:1,..profile_request()
    }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));

    let invalid=serde_json::json!({
        "name":"vent","uuid_seed":PROFILE_SEED,"up_axis":"Y",
        "cross_section":"ELLIPSE","stations":[], "twist":45
    });
    assert!(serde_json::from_value::<GeometryProfileSweep>(invalid).is_err());
    let legacy=serde_json::to_value(part(CHILD,"legacy",None,CUBE_B)).unwrap();
    assert!(legacy.get("profile_sweeps").is_none());
}

#[test]
fn axial_loft_and_revolve_share_one_undoable_source_bound_plan() {
    use super::super::geometry_axial::{
        GeometryAxialLoft, GeometryAxialRevolve,
        GeometryLoftSection, GeometryRevolveSection,
    };
    const SEED: &str = "00000000-0000-4000-8000-000000005501";
    let mut part = part(ROOT,"axial_bone",None,CUBE_A);
    part.cubes.clear();
    part.lofts.push(GeometryAxialLoft {
        name:"tower".into(),uuid_seed:SEED.into(),
        origin:[0,0,0],axis:"Y".into(),sections:vec![
            GeometryLoftSection{height:0,center:[0.0,0.0],size:[6,6]},
            GeometryLoftSection{height:8,center:[2.0,0.0],size:[4,4]},
        ],
    });
    part.revolves.push(GeometryAxialRevolve {
        name:"ring".into(),uuid_seed:SEED.into(),
        origin:[20,0,0],axis:"Y".into(),sections:vec![
            GeometryRevolveSection{height:0,outer_radius:6,inner_radius:2},
            GeometryRevolveSection{height:8,outer_radius:6,inner_radius:2},
        ],
    });
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Axial","axial").unwrap()
    ).unwrap();
    let before=session.document().clone();
    let request=GeometryAssemblyRequest{expected_revision:0,parts:vec![part]};
    let proposed=compile(&session,&request).unwrap();
    assert_eq!(proposed.preflight["status"],"VALIDATED_NOT_APPLIED");
    assert_eq!(proposed.preflight["write_authority"],"NOT_GRANTED");
    assert_eq!(proposed.preflight["visual_verdict"],"UNVERIFIED");
    assert_eq!(session.document(),&before);
    assert!(!session.can_undo());
    assert!(proposed.plan.operations.len()>2);
    let mut loft_count=0;
    let mut revolve_count=0;
    for op in proposed.plan.operations.iter().skip(1) {
        let EditOperation::AddCube{cube,bone_uuid}=op else {
            panic!("Axial blockouts must use native AddCube");
        };
        assert_eq!(bone_uuid,ROOT);
        assert_eq!(cube.extra.get("box_uv"),Some(&Value::Bool(true)));
        assert!(cube.faces.values().all(|v|v.get("texture").is_none()));
        if cube.name.as_deref().is_some_and(|v|v.starts_with("tower_v_")) {
            assert_eq!(cube.uuid,geometry_axial::cube_uuid("loft",SEED,loft_count));
            loft_count+=1;
        } else {
            assert_eq!(cube.uuid,geometry_axial::cube_uuid("revolve",SEED,revolve_count));
            revolve_count+=1;
        }
    }
    assert!(loft_count>0 && revolve_count>0);
    session.apply(0,&proposed.plan.operations).unwrap();
    let after=session.document().clone();
    let saved=session.export().unwrap();
    assert_eq!(proposed.preflight["candidate_sha256"],sha256(&saved));
    assert_eq!(EditorSession::open(&saved).unwrap().document(),&after);
    assert!(geometry::export_bedrock_geometry(&after).is_ok());
    session.undo(1).unwrap();
    assert_eq!(session.document(),&before);
    session.redo(2).unwrap();
    assert_eq!(session.document(),&after);
}
#[test]
fn axial_shapes_reject_uuid_collision_stale_and_unsafe_texture() {
    use super::super::geometry_axial::{GeometryAxialLoft,GeometryLoftSection};
    const SEED: &str = "00000000-0000-4000-8000-000000005501";
    let mut part=part(ROOT,"loft_bone",None,CUBE_A);
    part.cubes.clear();
    part.lofts.push(GeometryAxialLoft {
        name:"tower".into(),uuid_seed:SEED.into(),
        origin:[0,0,0],axis:"Y".into(),sections:vec![
            GeometryLoftSection{height:0,center:[0.0,0.0],size:[6,6]},
            GeometryLoftSection{height:8,center:[0.0,0.0],size:[4,4]},
        ],
    });
    let session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Axial","axial").unwrap()
    ).unwrap();
    let original=session.document().clone();
    let request=GeometryAssemblyRequest{expected_revision:0,parts:vec![part]};
    let mut duplicate=request.clone();
    duplicate.parts[0].lofts.push(duplicate.parts[0].lofts[0].clone());
    assert_eq!(compile(&session,&duplicate).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
    let mut explicit=request.clone();
    let mut cube=self::part(CHILD,"other",None,CUBE_B).cubes.remove(0);
    cube.uuid=geometry_axial::cube_uuid("loft",SEED,0);
    explicit.parts[0].cubes.push(cube);
    assert_eq!(compile(&session,&explicit).err().as_deref(),
        Some("GEOMETRY_ASSEMBLY_UUID_CONFLICT"));
    let mut textured=session.clone();
    textured.apply(0,&[EditOperation::CreatePaintTexture {
        uuid:"00000000-0000-4000-8000-000000005502".into(),
        name:"atlas".into(),
    }]).unwrap();
    assert_eq!(compile(&textured,&GeometryAssemblyRequest{
        expected_revision:1,..request.clone()
    }).err().as_deref(),Some("GEOMETRY_AXIAL_TEXTURED_PROJECT_UNSUPPORTED"));
    assert_eq!(compile(&session,&GeometryAssemblyRequest{
        expected_revision:1,..request
    }).err().as_deref(),Some("DOCUMENT_REVISION_STALE"));
    assert_eq!(session.document(),&original);
}


