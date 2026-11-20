// SOURCE_AUTHORED_NOT_RUN: original in-module regression tests moved without
// changing test assertions, fixture contents or Rust Core ownership.
use super::*;
use super::super::{Bone, EditOperation, EditorSession};
use serde_json::json;

const SAMPLE: &[u8] = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
const TEXTURE: &str = "00000000-0000-4000-8000-000000006201";
const SECOND: &str = "00000000-0000-4000-8000-000000006202";
const CUBE: &str = "00000000-0000-4000-8000-000000000002";
const ANIMATION: &str = "00000000-0000-4000-8000-000000006203";
const CHILD_BONE: &str = "00000000-0000-4000-8000-000000006204";
const CHILD_CUBE: &str = "00000000-0000-4000-8000-000000006205";
const CHILD_FRAME: &str = "00000000-0000-4000-8000-000000006206";

fn prepared() -> EditorSession {
    let mut session = EditorSession::open(SAMPLE).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture {
            uuid: TEXTURE.into(), name: "atlas.png".into(),
        },
        EditOperation::AssignCubeTexture {
            cube_uuid:CUBE.into(), texture_uuid:TEXTURE.into(),
        },
        EditOperation::CreateAnimation {
            uuid:ANIMATION.into(), name:"animation.idle".into(), length:1.0,
        },
    ]).unwrap();
    session
}

#[test]
fn single_atlas_handoff_binds_all_six_faces_and_three_source_exports() {
    let session = prepared();
    let before = session.document().clone();
    let report = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(report["scope"], "bedrock_single_atlas_export_handoff");
    assert_eq!(report["status"], "source_consistent");
    assert_eq!(report["faces"]["selected_texture"], 6);
    assert_eq!(report["faces"]["other_texture"], 0);
    assert_eq!(report["faces"]["explicitly_absent"], 0);
    assert_eq!(report["bbmodel"]["status"], "source_exportable");
    assert_eq!(report["bbmodel"]["sha256"],
        json!(sha256(&session.export().unwrap())));
    assert_eq!(report["bbmodel"]["bytes"],
        json!(session.export().unwrap().len()));
    assert_eq!(report["geometry"]["status"], "source_exportable");
    assert_eq!(report["texture"]["status"], "source_exportable");
    assert_eq!(report["animation"]["status"], "source_exportable");
    assert_eq!(report["animation"]["curve_fidelity"], "native");
    assert_eq!(report["visual_verdict"], "UNVERIFIED");
    assert_eq!(report["native_verdict"], "NOT_EXECUTED");
    assert_eq!(report["blockers"], json!([]));
    assert_eq!(report["geometry"]["sha256"],
        json!(sha256(&export_bedrock_geometry(&before).unwrap())));
    assert_eq!(report["texture"]["sha256"],
        json!(sha256(&export_paint_png(&before,TEXTURE).unwrap())));
    assert_eq!(report["animation"]["sha256"],
        json!(sha256(&export_bedrock_animations(&before).unwrap())));
    assert_eq!(session.document(), &before);
    let compact = serde_json::to_string(&report).unwrap();
    assert!(!compact.contains("data:image/png"));
}


// P0 source regression: one immutable Rust revision must prove identity
// across editable .bbmodel, Geometry, RGBA8 PNG and Animation, including
// nested rig and all six faces of TWO Cubes. No PC/native test ran.
#[test]
fn nested_bone_two_cube_four_artifact_handoff_stays_revision_bound() {
    let mut session = prepared();
    let prior = session.document().clone();
    let root_uuid = prior.bones[0].uuid.clone();
    let mut second_cube = EditorSession::open(SAMPLE).unwrap().document().cubes[0].clone();
    second_cube.uuid = CHILD_CUBE.into();
    second_cube.name = Some("arm_segment".into());
    second_cube.from = [4.0, 0.0, 0.0];
    second_cube.to = [8.0, 4.0, 4.0];
    second_cube.origin = Some([4.0, 0.0, 0.0]);
    let child: Bone = serde_json::from_value(json!({
        "uuid":CHILD_BONE, "name":"arm_bone", "origin":[4,0,0],
    })).unwrap();
    let receipt = session.apply(1, &[
        EditOperation::AddBone {
            bone:child, parent_uuid:Some(root_uuid),
        },
        EditOperation::AddCube {
            cube:second_cube, bone_uuid:CHILD_BONE.into(),
        },
        EditOperation::AssignCubeTexture {
            cube_uuid:CHILD_CUBE.into(), texture_uuid:TEXTURE.into(),
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:CHILD_BONE.into(),
            keyframe_uuid:CHILD_FRAME.into(), channel:"rotation".into(),
            time:0.5, value:[0.0,30.0,0.0],
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 4);
    let saved = session.document().clone();
    assert_eq!(saved.cubes.len(), 2);
    assert_eq!(saved.bones.len(), 2);
    let editable = session.export().unwrap();
    let reopen = EditorSession::open(&editable).unwrap();
    assert_eq!(reopen.document(), &saved);

    let handoff = inspect_bedrock_asset_handoff(reopen.document(), TEXTURE).unwrap();
    assert_eq!(handoff["status"], "source_consistent");
    assert_eq!(handoff["faces"]["selected_texture"], 12);
    assert_eq!(handoff["faces"]["total"], 12);
    assert_eq!(handoff["total_issues"], 0);
    assert_eq!(handoff["blockers"], json!([]));
    assert_eq!(handoff["bbmodel"]["sha256"], json!(sha256(&editable)));
    assert_eq!(handoff["bbmodel"]["bytes"], json!(editable.len()));
    assert_eq!(handoff["geometry"]["sha256"], json!(sha256(
        &super::super::export_bedrock_geometry(&saved).unwrap())));
    assert_eq!(handoff["texture"]["sha256"], json!(sha256(
        &export_paint_png(&saved, TEXTURE).unwrap())));
    assert_eq!(handoff["animation"]["sha256"], json!(sha256(
        &export_bedrock_animations(&saved).unwrap())));
    assert_eq!(handoff["visual_verdict"], "UNVERIFIED");
    assert_eq!(handoff["native_verdict"], "NOT_EXECUTED");
    assert!(!handoff.to_string().contains("data:image/png"));

    // A source-consistent export does not automatically accept an
    // uncovered face, even when all exporters remain individually valid.
    let mut flawed = saved.clone();
    flawed.cubes[1].faces.get_mut("north").unwrap()["texture"] = json!(false);
    let blocked = inspect_bedrock_asset_handoff(&flawed, TEXTURE).unwrap();
    assert_eq!(blocked["status"], "blocked");
    assert_eq!(blocked["issues"][0]["cube_uuid"], CHILD_CUBE);
    assert_eq!(blocked["issues"][0]["face"], "north");
    assert_eq!(blocked["blockers"][0], "IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES");
    assert_eq!(blocked["bbmodel"]["status"], "source_exportable");
    assert_ne!(blocked["bbmodel"]["sha256"], handoff["bbmodel"]["sha256"]);
    assert_eq!(saved.cubes[1].faces["north"]["texture"], TEXTURE);

    // An invalid later step must roll back an earlier valid rename in
    // the SAME batch. It must not advance revision or change Undo.
    assert_eq!(session.apply(2, &[
        EditOperation::RenameNode {
            uuid:CHILD_CUBE.into(), name:"must_not_commit".into(),
        },
        EditOperation::AssignCubeFaceTexture {
            cube_uuid:CHILD_CUBE.into(), face:"diagonal".into(),
            texture_uuid:TEXTURE.into(),
        },
    ]).unwrap_err(), "CUBE_FACE_INVALID");
    assert_eq!(session.document(), &saved);
    assert_eq!(session.summary().revision, 2);

    // One Undo restores the previous coherent model; Redo restores all
    // 4 domain changes without retaining any inspector-side mutation.
    session.undo(2).unwrap();
    assert_eq!(session.document(), &prior);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.canonical_sha256().unwrap(),
        handoff["bbmodel"]["sha256"].as_str().unwrap());
}

#[test]
fn foreign_face_atlas_blocks_handoff_but_preserves_both_pngs() {
    let mut session = prepared();
    session.apply(1, &[EditOperation::CreatePaintTexture {
        uuid:SECOND.into(), name:"second.png".into(),
    }]).unwrap();
    let mut doc = session.document().clone();
    doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = json!(SECOND);
    let prior = doc.clone();
    let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
    assert_eq!(report["status"], "blocked");
    assert_eq!(report["faces"]["selected_texture"], 5);
    assert_eq!(report["faces"]["other_texture"], 1);
    assert!(report["blockers"].as_array().unwrap().contains(
        &json!("MULTIPLE_REFERENCED_TEXTURES")));
    assert_eq!(report["texture"]["status"], "source_exportable");
    assert_eq!(doc, prior);
}

#[test]
fn explicit_absent_face_is_not_an_implicit_binding_but_unassigned_is() {
    let mut doc = prepared().document().clone();
    doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Null;
    let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
    assert_eq!(report["status"], "source_consistent");
    assert_eq!(report["faces"]["explicitly_absent"], 1);
    doc.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Bool(false);
    let blocked = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
    assert_eq!(blocked["status"], "blocked");
    assert_eq!(blocked["faces"]["false_reference"], 1);
    assert!(blocked["blockers"].as_array().unwrap().contains(
        &json!("IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES")));
}

#[test]
fn paged_issue_locations_cover_all_faces_without_dropping_later_blindspots() {
    let mut doc = prepared().document().clone();
    for face in ["north", "east", "south", "west", "up"] {
        doc.cubes[0].faces.get_mut(face).unwrap()["texture"] = Value::Bool(false);
    }
    let original = doc.clone();
    let first = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 2).unwrap();
    let second = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 2, 2).unwrap();
    let third = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 4, 2).unwrap();
    assert_eq!(first["status"], "blocked");
    assert_eq!(first["total_issues"], 5);
    assert_eq!(first["faces"]["false_reference"], 5);
    assert_eq!(first["issues"].as_array().unwrap().len(), 2);
    assert_eq!(first["issues"][0]["cube_uuid"], CUBE);
    assert_eq!(first["issues"][0]["face"], "north");
    assert_eq!(first["issues"][0]["problem"], "false_reference");
    assert_eq!(first["issues"][0]["reference_kind"], "false");
    assert_eq!(first["issues"][0]["referenced_texture_uuid"], Value::Null);
    assert_eq!(first["issues"][1]["face"], "east");
    assert_eq!(first["next_issue_offset"], 2);
    assert_eq!(second["issues"][0]["face"], "south");
    assert_eq!(second["issues"][1]["face"], "west");
    assert_eq!(second["next_issue_offset"], 4);
    assert_eq!(third["issues"][0]["face"], "up");
    assert_eq!(third["next_issue_offset"], Value::Null);
    assert_eq!(first["geometry"], second["geometry"]);
    assert_eq!(first["texture"], second["texture"]);
    assert_eq!(first["animation"], second["animation"]);
    assert_eq!(doc, original);
}

#[test]
fn other_texture_issue_identifies_exact_face_and_uuid_without_raw_png() {
    let mut session = prepared();
    session.apply(1, &[EditOperation::CreatePaintTexture {
        uuid:SECOND.into(), name:"second.png".into(),
    }]).unwrap();
    let mut doc = session.document().clone();
    doc.cubes[0].faces.get_mut("south").unwrap()["texture"] = json!(SECOND);
    let report = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 1).unwrap();
    assert_eq!(report["total_issues"], 1);
    assert_eq!(report["issues"][0]["cube_uuid"], CUBE);
    assert_eq!(report["issues"][0]["face"], "south");
    assert_eq!(report["issues"][0]["problem"], "other_texture");
    assert_eq!(report["issues"][0]["reference_kind"], "uuid");
    assert_eq!(report["issues"][0]["referenced_texture_uuid"], SECOND);
    assert_eq!(report["next_issue_offset"], Value::Null);
    assert!(!report.to_string().contains("data:image/png"));
}

#[test]
fn paging_rejects_unsafe_bounds_without_model_mutation() {
    let doc = prepared().document().clone();
    for (offset, limit) in [
        (0, 0), (0, 33), (super::super::MAX_ELEMENTS * 6 + 1, 1)
    ] {
        assert_eq!(inspect_bedrock_asset_handoff_page(
            &doc, TEXTURE, offset, limit).unwrap_err(),
            "ASSET_HANDOFF_PAGE_INVALID");
    }
    let beyond = inspect_bedrock_asset_handoff_page(
        &doc, TEXTURE, 12, 2).unwrap();
    assert_eq!(beyond["total_issues"], 0);
    assert_eq!(beyond["issues"], json!([]));
    assert_eq!(beyond["next_issue_offset"], Value::Null);
}

#[test]
fn precise_face_rebind_fixes_handoff_without_changing_other_faces_or_assets() {
    let mut session = prepared();
    let original = session.document().clone();
    session.apply(1, &[
        EditOperation::CreatePaintTexture {
            uuid:SECOND.into(), name:"other.png".into(),
        },
        EditOperation::AssignCubeFaceTexture {
            cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:SECOND.into(),
        },
    ]).unwrap();
    let faulty = session.document().clone();
    assert_eq!(faulty.cubes[0].faces["north"]["texture"], SECOND);
    assert_eq!(faulty.cubes[0].faces["south"]["texture"], TEXTURE);
    let report = inspect_bedrock_asset_handoff_page(&faulty, TEXTURE, 0, 1).unwrap();
    assert_eq!(report["total_issues"], 1);
    assert_eq!(report["issues"][0]["face"], "north");
    assert_eq!(report["issues"][0]["problem"], "other_texture");
    assert_eq!(report["status"], "blocked");
    session.apply(2, &[EditOperation::AssignCubeFaceTexture {
        cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:TEXTURE.into(),
    }]).unwrap();
    let restored = session.document().clone();
    let report = inspect_bedrock_asset_handoff(&restored, TEXTURE).unwrap();
    assert_eq!(report["status"], "source_consistent");
    assert_eq!(restored.cubes[0].faces["north"]["texture"], TEXTURE);
    for side in ["east", "south", "west", "up", "down"] {
        assert_eq!(restored.cubes[0].faces[side], original.cubes[0].faces[side]);
    }
    assert_eq!(restored.texture_assets[0], original.texture_assets[0]);
    assert_eq!(restored.animation_assets, original.animation_assets);
    let reopened = EditorSession::open(&session.export().unwrap()).unwrap();
    assert_eq!(reopened.document(), &restored);
    session.undo(3).unwrap();
    assert_eq!(session.document(), &faulty);
    session.redo(4).unwrap();
    assert_eq!(session.document(), &restored);
}

#[test]
fn precise_face_rebind_refuses_null_invalid_and_foreign_uv_rules_atomically() {
    let original = prepared().document().clone();
    let correct = || EditOperation::AssignCubeFaceTexture {
        cube_uuid:CUBE.into(), face:"north".into(), texture_uuid:TEXTURE.into(),
    };
    let mut absent = original.clone();
    absent.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Null;
    let mut session = EditorSession::from_document(absent.clone()).unwrap();
    assert_eq!(session.apply(0, &[correct()]).unwrap_err(),
        "CUBE_FACE_INTENTIONALLY_ABSENT");
    assert_eq!(session.document(), &absent);
    assert!(!session.can_undo());
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    let invalid = [
        EditOperation::AssignCubeFaceTexture {
            cube_uuid:CUBE.into(), face:"diagonal".into(), texture_uuid:TEXTURE.into(),
        },
        EditOperation::AssignCubeFaceTexture {
            cube_uuid:CUBE.into(), face:"north".into(),
            texture_uuid:"00000000-0000-4000-8000-000000009999".into(),
        },
    ];
    assert_eq!(session.apply(0, &[invalid[0].clone()]).unwrap_err(), "CUBE_FACE_INVALID");
    assert_eq!(session.apply(0, &[invalid[1].clone()]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert!(!session.can_undo());
    let mut scoped = original.clone();
    scoped.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
    let mut session = EditorSession::from_document(scoped.clone()).unwrap();
    assert_eq!(session.apply(0, &[correct()]).unwrap_err(),
        "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &scoped);
    assert!(!session.can_undo());
}

#[test]
fn handoff_locates_out_of_atlas_and_zero_area_on_selected_cube_faces() {
    let mut doc = prepared().document().clone();
    let original = doc.clone();
    doc.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([-1.0,0.0,4.0,4.0]);
    doc.cubes[0].faces.get_mut("east").unwrap()["uv"] = json!([2.0,2.0,2.0,4.0]);
    let altered = doc.clone();
    let first = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 1).unwrap();
    let second = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 1, 1).unwrap();
    assert_eq!(first["status"], "blocked");
    assert_eq!(first["total_issues"], 2);
    assert_eq!(first["faces"]["selected_texture"], 6);
    assert_eq!(first["faces"]["uv_out_of_bounds"], 1);
    assert_eq!(first["faces"]["uv_zero_area"], 1);
    assert_eq!(first["issues"][0]["cube_uuid"], CUBE);
    assert_eq!(first["issues"][0]["face"], "north");
    assert_eq!(first["issues"][0]["problem"], "uv_out_of_bounds");
    assert_eq!(first["issues"][0]["uv_source"], "saved_manual");
    assert_eq!(first["issues"][0]["uv_rect"], json!([-1.0,0.0,4.0,4.0]));
    assert_eq!(first["next_issue_offset"], 1);
    assert_eq!(second["issues"][0]["face"], "east");
    assert_eq!(second["issues"][0]["problem"], "uv_zero_area");
    assert_eq!(second["next_issue_offset"], Value::Null);
    assert!(first["blockers"].as_array().unwrap().contains(&json!("UV_OUT_OF_ATLAS")));
    assert!(first["blockers"].as_array().unwrap().contains(&json!("UV_ZERO_AREA")));
    assert_eq!(first["geometry"]["status"], "source_exportable");
    assert_eq!(first["texture"]["status"], "source_exportable");
    assert_eq!(first["geometry"], second["geometry"]);
    assert_eq!(doc, altered);
    assert_eq!(original.cubes[0].faces["north"]["uv"], json!([0,0,4,4]));
}

#[test]
fn reversed_and_fractional_manual_uv_are_not_false_atlas_failures() {
    let mut doc = prepared().document().clone();
    doc.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([4.5,4.0,0.5,0.0]);
    let report = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
    assert_eq!(report["status"], "source_consistent");
    assert_eq!(report["total_issues"], 0);
    assert_eq!(report["faces"]["uv_out_of_bounds"], 0);
    assert_eq!(report["faces"]["uv_zero_area"], 0);
}

#[test]
fn box_uv_uses_derived_net_bounds_without_rewriting_saved_face_uvs() {
    let mut doc = prepared().document().clone();
    doc.meta.box_uv = Some(true);
    let original = doc.clone();
    let valid = inspect_bedrock_asset_handoff(&doc, TEXTURE).unwrap();
    assert_eq!(valid["status"], "source_consistent");
    doc.cubes[0].uv_offset = Some([127.0,127.0]);
    let altered = doc.clone();
    let blocked = inspect_bedrock_asset_handoff_page(&doc, TEXTURE, 0, 16).unwrap();
    assert_eq!(blocked["status"], "blocked");
    assert!(blocked["faces"]["uv_out_of_bounds"].as_u64().unwrap() > 0);
    assert_eq!(blocked["issues"][0]["uv_source"], "derived_box");
    assert!(blocked["blockers"].as_array().unwrap().contains(&json!("UV_OUT_OF_ATLAS")));
    assert_eq!(blocked["geometry"]["status"], "source_exportable");
    assert_eq!(doc, altered);
    assert_eq!(original.cubes[0].faces, altered.cubes[0].faces);
}

#[test]
fn authored_visible_bounds_are_read_from_real_geometry_export_without_mutation() {
    let mut session = prepared();
    let baseline = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(baseline["geometry"]["status"],"source_exportable");
    assert_eq!(baseline["geometry"]["visible_bounds_source"],"computed_static");
    assert_eq!(baseline["geometry"]["visible_bounds"]["width"],2.0);
    assert_eq!(baseline["geometry"]["visible_bounds"]["height"],2.0);
    assert_eq!(baseline["geometry"]["visible_bounds"]["offset"],json!([0.0,0.0,0.0]));
    let original = session.document().clone();
    session.apply(1, &[EditOperation::SetVisibleBox {
        bounds:[12.0,4.0,0.0],
    }]).unwrap();
    let saved = session.document().clone();
    let expanded = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(expanded["geometry"]["visible_bounds_source"],"saved_visible_box_union");
    assert_eq!(expanded["geometry"]["visible_bounds"]["width"],12.0);
    assert_eq!(expanded["geometry"]["visible_bounds"]["height"],4.0);
    assert_eq!(expanded["geometry"]["visible_bounds"]["offset"],json!([0.0,0.0,0.0]));
    assert_ne!(baseline["geometry"]["sha256"],expanded["geometry"]["sha256"]);
    assert_eq!(baseline["texture"]["sha256"],expanded["texture"]["sha256"]);
    assert_eq!(baseline["animation"]["sha256"],expanded["animation"]["sha256"]);
    assert_eq!(original.cubes,saved.cubes);
    assert_eq!(original.animation_assets,saved.animation_assets);
    assert_eq!(session.document(),&saved);
    assert_eq!(expanded["native_verdict"],"NOT_EXECUTED");
}

#[test]
fn looping_numeric_handoff_locates_endpoint_axis_review_candidate_without_rewriting_assets() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    const START: &str = "00000000-0000-4000-8000-000000007101";
    const END: &str = "00000000-0000-4000-8000-000000007102";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::SetAnimationLoopMode {
            animation_uuid: ANIMATION.into(), mode: "loop".into(),
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: START.into(), channel: "position".into(),
            time: 0.0, value: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: END.into(), channel: "position".into(),
            time: 1.0, value: [0.0, 0.0, 0.0],
        }
    ]).unwrap();
    let saved = session.export().unwrap();
    let clear = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(clear["animation"]["loop_seams"]["looping_clips"], 1);
    assert_eq!(clear["animation"]["loop_seams"]["reviewed_channels"], 1);
    assert_eq!(clear["animation"]["loop_seams"]["review_candidates"], 0);
    assert_eq!(clear["animation"]["loop_seams"]["visual_verdict"], "UNVERIFIED");
    assert_eq!(session.export().unwrap(), saved);

    session.apply(2, &[EditOperation::UpdateBoneTransformKeyframe {
        animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
        keyframe_uuid: END.into(), channel: "position".into(),
        time: 1.0, value: [3.0, 0.0, 0.0],
    }]).unwrap();
    let changed = session.export().unwrap();
    let found = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(found["status"], "source_consistent");
    assert_eq!(found["animation"]["loop_seams"]["status"], "needs_review");
    assert_eq!(found["animation"]["loop_seams"]["review_candidates"], 1);
    assert_eq!(found["animation"]["loop_seams"]["issues"][0]["problem"],
        "endpoint_axis_difference");
    assert_eq!(found["animation"]["loop_seams"]["issues"][0]["bone_uuid"], BONE);
    // Numerical Euler-axis differences are review candidates, not proof
    // of a different 3D orientation or rendered loop artifact.
    assert_eq!(found["animation"]["loop_seams"]["issues"][0]["axis_delta"],
        json!([3.0, 0.0, 0.0]));
    assert_eq!(found["geometry"]["sha256"], clear["geometry"]["sha256"]);
    assert_eq!(found["texture"]["sha256"], clear["texture"]["sha256"]);
    assert_ne!(found["animation"]["sha256"], clear["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(), changed);
    assert_eq!(EditorSession::open(&changed).unwrap().document(),
        session.document());

    // Missing endpoints are evidence gaps, not inferred discontinuities.
    session.apply(3, &[EditOperation::UpdateBoneTransformKeyframe {
        animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
        keyframe_uuid: START.into(), channel: "position".into(),
        time: 0.25, value: [0.0, 0.0, 0.0],
    }]).unwrap();
    let missing = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(missing["animation"]["loop_seams"]["issues"][0]["problem"],
        "boundary_not_explicit");
    assert_eq!(missing["animation"]["loop_seams"]["issues"][0]["missing_boundaries"],
        json!(["start"]));
    assert!(missing["animation"]["loop_seams"]["issues"][0].get("axis_delta").is_none());
}

#[test]
fn loop_seam_read_does_not_infer_errors_from_full_turn_or_opaque_clips() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::SetAnimationLoopMode {
            animation_uuid: ANIMATION.into(), mode: "loop".into(),
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000007201".into(),
            channel: "rotation".into(), time: 0.0, value: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000007202".into(),
            channel: "rotation".into(), time: 1.0, value: [360.0, 0.0, 0.0],
        }
    ]).unwrap();
    let snapshot = session.document().clone();
    let normal = inspect_bedrock_asset_handoff(&snapshot, TEXTURE).unwrap();
    assert_eq!(normal["animation"]["loop_seams"]["review_candidates"], 0);
    assert_eq!(normal["animation"]["loop_seams"]["status"], "no_endpoint_candidates");
    let mut opaque = snapshot.clone();
    opaque.animation_assets[0]["unsupported_metadata"] = json!({"keep":true});
    let uncertain = inspect_bedrock_asset_handoff(&opaque, TEXTURE).unwrap();
    assert_eq!(uncertain["animation"]["status"], "blocked");
    assert_eq!(uncertain["animation"]["loop_seams"]["unsupported_looping_clips"], 1);
    assert_eq!(uncertain["animation"]["loop_seams"]["status"], "unsupported");
    assert_eq!(opaque.animation_assets[0]["unsupported_metadata"]["keep"], true);
    assert_eq!(session.document(), &snapshot);
}


#[test]
fn source_translation_clearance_detects_uncovered_motion_without_publishing_changes() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    const START: &str = "00000000-0000-4000-8000-000000008101";
    const END: &str = "00000000-0000-4000-8000-000000008102";
    let mut session = prepared();
    let original = session.export().unwrap();
    let before = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(before["geometry"]["translation_clearance"]["status"],
        "no_numeric_translation");
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: START.into(), channel: "position".into(),
            time: 0.0, value: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: END.into(), channel: "position".into(),
            time: 1.0, value: [64.0, 0.0, 0.0],
        },
    ]).unwrap();
    let authored = session.export().unwrap();
    let short = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(short["status"], "source_consistent");
    assert_eq!(short["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(short["geometry"]["translation_clearance"]["max_reach_model_units"],64.0);
    assert_eq!(short["geometry"]["translation_clearance"]["required_conservative_bounds"]["width"],10.0);
    assert_eq!(short["geometry"]["translation_clearance"]["shortfall_blocks"]["horizontal_width"],8.0);
    assert_eq!(short["geometry"]["translation_clearance"]["controller_blends"],"NOT_ASSESSED");
    assert_eq!(short["texture"]["sha256"],before["texture"]["sha256"]);
    assert_eq!(short["geometry"]["sha256"],before["geometry"]["sha256"]);
    assert_ne!(short["animation"]["sha256"],before["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(), authored);

    session.apply(2, &[EditOperation::SetVisibleBox { bounds:[12.0, 12.0, 0.0] }]).unwrap();
    let expanded = session.export().unwrap();
    let covered = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(covered["status"], "source_consistent");
    assert_eq!(covered["geometry"]["translation_clearance"]["status"],"source_budget_covered");
    assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["horizontal_width"],0.0);
    assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["below"],0.0);
    assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["above"],0.0);
    assert_ne!(covered["geometry"]["sha256"],short["geometry"]["sha256"]);
    assert_eq!(covered["texture"]["sha256"],short["texture"]["sha256"]);
    assert_eq!(covered["animation"]["sha256"],short["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(),expanded);
    assert_eq!(EditorSession::open(&expanded).unwrap().document(),session.document());
    assert_ne!(original, authored);
}



#[test]
fn linear_scale_only_reach_preserves_native_export_hashes_and_source() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    let baseline = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    session.apply(1, &[EditOperation::AddBoneTransformKeyframe {
        animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
        keyframe_uuid:"00000000-0000-4000-8000-000000008401".into(),
        channel:"scale".into(), time:0.0, value:[2.0,1.0,1.0],
    }]).unwrap();
    let saved = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(report["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(report["geometry"]["translation_clearance"]["coverage_mode"],
        "scaled_pivot_envelope");
    assert_eq!(report["geometry"]["translation_clearance"]["scale_tracks"],1);
    assert_eq!(report["geometry"]["translation_clearance"]["max_scale_chain_amplification"],2.0);
    assert_eq!(report["geometry"]["translation_clearance"]["max_reach_model_units"],0.0);
    assert_eq!(report["geometry"]["translation_clearance"]["controller_blends"],"NOT_ASSESSED");
    assert_eq!(report["geometry"]["sha256"],baseline["geometry"]["sha256"]);
    assert_eq!(report["texture"]["sha256"],baseline["texture"]["sha256"]);
    assert_ne!(report["animation"]["sha256"],baseline["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(),saved);

    session.apply(2, &[EditOperation::SetVisibleBox {
        bounds:[16.0,16.0,0.0],
    }]).unwrap();
    let accepted = session.export().unwrap();
    let adjusted = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(adjusted["geometry"]["translation_clearance"]["status"],
        "source_budget_covered");
    assert_eq!(adjusted["texture"]["sha256"],report["texture"]["sha256"]);
    assert_eq!(adjusted["animation"]["sha256"],report["animation"]["sha256"]);
    assert_ne!(adjusted["geometry"]["sha256"],report["geometry"]["sha256"]);
    assert_eq!(session.export().unwrap(),accepted);
    assert_eq!(EditorSession::open(&accepted).unwrap().document(),session.document());
}

#[test]
fn nested_linear_scale_uses_ancestor_product_instead_of_max_individual_key() {
    const ROOT: &str = "00000000-0000-4000-8000-000000000001";
    const CUBE: &str = "00000000-0000-4000-8000-000000000002";
    const CHILD: &str = "00000000-0000-4000-8000-000000008499";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::AddBone {
            bone:super::super::Bone {
                uuid:CHILD.into(), name:"nested_scale".into(),
                origin:Some([0.0,0.0,0.0]), extra:serde_json::Map::new(),
            },
            parent_uuid:Some(ROOT.into()),
        },
        EditOperation::ReparentNode {
            uuid:CUBE.into(),parent_uuid:Some(CHILD.into()),
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:ROOT.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008402".into(),
            channel:"scale".into(),time:0.0,value:[2.0,2.0,2.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:CHILD.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008403".into(),
            channel:"scale".into(),time:0.0,value:[3.0,1.0,1.0],
        },
    ]).unwrap();
    let bytes = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(report["geometry"]["translation_clearance"]["coverage_mode"],
        "scaled_pivot_envelope");
    assert_eq!(report["geometry"]["translation_clearance"]["scale_tracks"],2);
    assert_eq!(report["geometry"]["translation_clearance"]["max_scale_chain_amplification"],6.0);
    assert_eq!(report["geometry"]["translation_clearance"]["position_tracks"],0);
    assert_eq!(session.export().unwrap(),bytes);
    assert_eq!(EditorSession::open(&bytes).unwrap().document(),session.document());
}

#[test]
fn shrink_only_scale_still_uses_safe_unity_growth_and_never_claims_native_pass() {
    const ROOT: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[EditOperation::AddBoneTransformKeyframe {
        animation_uuid:ANIMATION.into(),bone_uuid:ROOT.into(),
        keyframe_uuid:"00000000-0000-4000-8000-000000008404".into(),
        channel:"scale".into(),time:0.0,value:[0.25,0.5,0.75],
    }]).unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["geometry"]["translation_clearance"]["coverage_mode"],
        "scaled_pivot_envelope");
    assert_eq!(report["geometry"]["translation_clearance"]["max_scale_chain_amplification"],1.0);
    assert_eq!(report["geometry"]["translation_clearance"]["status"],
        "source_budget_covered");
    assert_eq!(report["geometry"]["translation_clearance"]["native_verdict"],"NOT_EXECUTED");
    assert_eq!(report["visual_verdict"],"UNVERIFIED");
}

#[test]
fn rotation_only_pivot_reach_reviews_visible_box_and_preserves_other_assets() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::SetBoneOrigin {
            uuid:BONE.into(), origin:[48.0,0.0,0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008301".into(),
            time:0.5, rotation:[0.0,90.0,0.0],
        },
    ]).unwrap();
    let saved = session.export().unwrap();
    let first = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(first["status"],"source_consistent");
    assert_eq!(first["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(first["geometry"]["translation_clearance"]["coverage_mode"],
        "pivot_rotation_envelope");
    assert_eq!(first["geometry"]["translation_clearance"]["rotation_tracks"],1);
    assert_eq!(first["geometry"]["translation_clearance"]["max_reach_model_units"],0.0);
    assert!(first["geometry"]["translation_clearance"]["rotation_radius_model_units"]
        .as_f64().unwrap() > 48.0);
    assert_eq!(first["geometry"]["translation_clearance"]["visual_verdict"],"UNVERIFIED");
    assert_eq!(first["geometry"]["sha256"],
        json!(sha256(&super::super::export_bedrock_geometry(session.document()).unwrap())));
    assert_eq!(session.export().unwrap(),saved);

    session.apply(2, &[EditOperation::SetVisibleBox {
        bounds:[64.0,64.0,0.0],
    }]).unwrap();
    let published = session.export().unwrap();
    let covered = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    assert_eq!(covered["geometry"]["translation_clearance"]["status"],
        "source_budget_covered");
    assert_eq!(covered["geometry"]["translation_clearance"]["shortfall_blocks"]["horizontal_width"],0.0);
    assert_eq!(covered["texture"]["sha256"],first["texture"]["sha256"]);
    assert_eq!(covered["animation"]["sha256"],first["animation"]["sha256"]);
    assert_ne!(covered["geometry"]["sha256"],first["geometry"]["sha256"]);
    assert_eq!(session.export().unwrap(),published);
    assert_eq!(EditorSession::open(&published).unwrap().document(),session.document());
}

#[test]
fn source_translation_clearance_bounds_rotation_but_refuses_nonlinear_curves() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    const FIRST: &str = "00000000-0000-4000-8000-000000008201";
    const SECOND: &str = "00000000-0000-4000-8000-000000008202";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: FIRST.into(), channel: "position".into(),
            time: 0.0, value: [0.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: SECOND.into(), channel: "position".into(),
            time: 1.0, value: [16.0,0.0,0.0],
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
            keyframe_uuid: SECOND.into(), channel: "position".into(),
            interpolation: "catmullrom".into(),
        },
    ]).unwrap();
    let curved = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(curved["geometry"]["translation_clearance"]["status"],"unassessed");
    assert_eq!(curved["geometry"]["translation_clearance"]["reason"],
        "NONLINEAR_OR_UNBOUNDED_CURVE");
    assert_eq!(curved["geometry"]["status"],"source_exportable");

    session.apply(2, &[EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid: ANIMATION.into(), bone_uuid: BONE.into(),
        keyframe_uuid: SECOND.into(), channel: "position".into(),
        interpolation: "linear".into(),
    }]).unwrap();
    session.apply(3, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
        keyframe_uuid:"00000000-0000-4000-8000-000000008203".into(),
        time:0.5, rotation:[0.0, 90.0, 0.0],
    }]).unwrap();
    let rotated = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(rotated["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(rotated["geometry"]["translation_clearance"]["coverage_mode"],
        "pivot_rotation_envelope");
    assert_eq!(rotated["geometry"]["translation_clearance"]["rotation_tracks"],1);
    // Even a tiny nonzero rotation needs the same conservative pivot
    // envelope; actual Euler pose/culling is not inferred.
    session.apply(4, &[EditOperation::UpdateBoneRotationKeyframe {
        animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
        keyframe_uuid:"00000000-0000-4000-8000-000000008203".into(),
        time:0.5, rotation:[0.0, 1e-10, 0.0],
    }]).unwrap();
    let tiny = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(tiny["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(tiny["geometry"]["translation_clearance"]["coverage_mode"],
        "pivot_rotation_envelope");
    let mut opaque = session.document().clone();
    opaque.animation_assets[0]["unknown_imported"] = json!({"safe":true});
    let unknown = inspect_bedrock_asset_handoff(&opaque,TEXTURE).unwrap();
    assert_eq!(unknown["geometry"]["translation_clearance"]["status"],"unassessed");
    assert_eq!(unknown["geometry"]["translation_clearance"]["reason"],
        "OPAQUE_OR_UNSUPPORTED_CLIP");
    assert_eq!(unknown["animation"]["status"],"blocked");
    assert_eq!(opaque.animation_assets[0]["unknown_imported"]["safe"],true);
}


#[test]
fn bezier_control_hull_reports_position_reach_without_changing_three_exports() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    let baseline = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008501".into(),
            channel:"position".into(), time:0.0, value:[0.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008502".into(),
            channel:"position".into(), time:1.0, value:[0.0,0.0,0.0],
        },
    ]).unwrap();
    let handles = super::super::BezierKeyframeHandles {
        linked:false, left_time:[-0.1;3], right_time:[0.1;3],
        left_value:[12.0,0.0,0.0], right_value:[12.0,0.0,0.0],
    };
    session.apply(2, &[
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008501".into(),
            channel:"position".into(), handles:handles.clone(),
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008502".into(),
            channel:"position".into(), handles,
        },
    ]).unwrap();
    let saved = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(report["geometry"]["translation_clearance"]["status"],
        "conservative_margin_shortfall");
    assert_eq!(report["geometry"]["translation_clearance"]["bezier_bone_tracks"],1);
    assert_eq!(report["geometry"]["translation_clearance"]["max_reach_model_units"],12.0);
    assert_eq!(report["geometry"]["sha256"],baseline["geometry"]["sha256"]);
    assert_eq!(report["texture"]["sha256"],baseline["texture"]["sha256"]);
    assert_ne!(report["animation"]["sha256"],baseline["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(),saved);
    assert_eq!(EditorSession::open(&saved).unwrap().document(),session.document());
}


#[test]
fn independent_bezier_axes_need_componentwise_bounds_not_one_control_norm() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008507".into(),
            channel:"position".into(),time:0.0,value:[0.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008508".into(),
            channel:"position".into(),time:1.0,value:[0.0,0.0,0.0],
        },
    ]).unwrap();
    session.apply(2, &[
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008507".into(),
            channel:"position".into(),handles:super::super::BezierKeyframeHandles {
                linked:false,left_time:[-0.1;3],right_time:[0.1;3],
                left_value:[0.0;3],right_value:[9.0,0.0,0.0],
            },
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008508".into(),
            channel:"position".into(),handles:super::super::BezierKeyframeHandles {
                linked:false,left_time:[-0.1;3],right_time:[0.1;3],
                left_value:[0.0,12.0,0.0],right_value:[0.0;3],
            },
        },
    ]).unwrap();
    let original = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    // 9 on X and 12 on Y need sqrt(9^2 + 12^2) = 15,
    // even though no single saved Bezier handle vector has length 15.
    assert_eq!(report["geometry"]["translation_clearance"]["max_reach_model_units"],15.0);
    assert_eq!(report["geometry"]["translation_clearance"]["bezier_bone_tracks"],1);
    assert_eq!(session.export().unwrap(),original);
}

#[test]
fn bezier_scale_handles_are_bounded_above_numeric_keys() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008503".into(),
            channel:"scale".into(), time:0.0, value:[1.0,1.0,1.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008504".into(),
            channel:"scale".into(), time:1.0, value:[1.0,1.0,1.0],
        },
    ]).unwrap();
    let handles = super::super::BezierKeyframeHandles {
        linked:false,left_time:[-0.1;3],right_time:[0.1;3],
        left_value:[3.0,0.0,0.0],right_value:[3.0,0.0,0.0],
    };
    session.apply(2, &[
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008503".into(),
            channel:"scale".into(), handles:handles.clone(),
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIMATION.into(), bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008504".into(),
            channel:"scale".into(), handles,
        },
    ]).unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(report["geometry"]["translation_clearance"]["coverage_mode"],
        "scaled_pivot_envelope");
    assert_eq!(report["geometry"]["translation_clearance"]["scale_tracks"],1);
    assert_eq!(report["geometry"]["translation_clearance"]["bezier_bone_tracks"],1);
    assert_eq!(report["geometry"]["translation_clearance"]["max_scale_chain_amplification"],4.0);
    assert_eq!(report["geometry"]["translation_clearance"]["visual_verdict"],"UNVERIFIED");
    assert_eq!(report["native_verdict"],"NOT_EXECUTED");
}

#[test]
fn catmullrom_rotation_is_pivot_bounded_but_position_remains_unassessed() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    session.apply(1, &[
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008505".into(),
            time:0.0,rotation:[0.0,30.0,0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:"00000000-0000-4000-8000-000000008506".into(),
            time:1.0,rotation:[0.0,0.0,0.0],
        },
    ]).unwrap();
    session.apply(2,&[EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
        keyframe_uuid:"00000000-0000-4000-8000-000000008505".into(),
        channel:"rotation".into(),interpolation:"catmullrom".into(),
    }]).unwrap();
    let original = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(report["geometry"]["translation_clearance"]["coverage_mode"],
        "pivot_rotation_envelope");
    assert_eq!(report["geometry"]["translation_clearance"]["catmullrom_rotation_tracks"],1);
    assert_eq!(session.export().unwrap(),original);

    let mut opaque = session.document().clone();
    let animators = opaque.animation_assets[0]["animators"].as_object_mut().unwrap();
    let track = animators.get_mut(BONE).unwrap();
    let frames = track["keyframes"].as_array_mut().unwrap();
    frames[0]["channel"] = json!("position");
    let rejected = inspect_bedrock_asset_handoff(&opaque,TEXTURE).unwrap();
    assert_eq!(rejected["geometry"]["translation_clearance"]["status"],"unassessed");
    assert_eq!(rejected["geometry"]["translation_clearance"]["reason"],
        "NONLINEAR_OR_UNBOUNDED_CURVE");
}


#[test]
fn catmullrom_bernstein_controls_enclose_overshoot_and_respect_step() {
    let frames = vec![
        json!({"time":0.0,"interpolation":"linear",
            "data_points":[{"x":0.0,"y":0.0,"z":0.0}]}),
        json!({"time":0.25,"interpolation":"catmullrom",
            "data_points":[{"x":10.0,"y":0.0,"z":0.0}]}),
        json!({"time":0.75,"interpolation":"catmullrom",
            "data_points":[{"x":10.0,"y":0.0,"z":0.0}]}),
        json!({"time":1.0,"interpolation":"linear",
            "data_points":[{"x":0.0,"y":0.0,"z":0.0}]}),
    ];
    let views: Vec<&Value> = frames.iter().collect();
    // The middle Catmull segment has cubic controls 10+10/6.
    // Max key value 10 is insufficient to bound its possible overshoot.
    let reach = catmullrom_control_bounds(&views, false).unwrap().unwrap();
    assert!(reach[0] > 11.6 && reach[0] < 11.7);
    assert_eq!(reach[1],0.0);
    assert_eq!(reach[2],0.0);
    assert!(catmullrom_control_bounds(&views, true).unwrap().unwrap()[0] >= reach[0]);
    let mut step = frames.clone();
    step[1]["interpolation"] = json!("step");
    step[2]["interpolation"] = json!("linear");
    let only_first_segment: Vec<&Value> = step.iter().collect();
    // Previous Step takes priority over following Catmull; no middle
    // spline remains in this adapted fixture.
    assert_eq!(catmullrom_control_bounds(&only_first_segment, false).unwrap(),None);

    let mut invalid = frames.clone();
    invalid[1]["data_points"][0]["x"] = json!("not-a-number");
    let corrupted: Vec<&Value> = invalid.iter().collect();
    assert_eq!(catmullrom_control_bounds(&corrupted, false).unwrap_err(),
        "CATMULL_BOUND_AXIS_UNSUPPORTED");
}

#[test]
fn catmullrom_position_and_scale_handoff_uses_neighbor_controls_without_editing_assets() {
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    let mut session = prepared();
    let baseline = inspect_bedrock_asset_handoff(session.document(), TEXTURE).unwrap();
    const TIMES: [f64;4] = [0.0,0.25,0.75,1.0];
    let mut operations = Vec::new();
    for (index,time) in TIMES.iter().enumerate() {
        let displacement = if index == 1 || index == 2 { 16.0 } else { 0.0 };
        let scale = if index == 1 || index == 2 { 2.0 } else { 1.0 };
        operations.push(EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:format!("00000000-0000-4000-8000-{:012}", 8801 + index),
            channel:"position".into(),time:*time,value:[displacement,0.0,0.0],
        });
        operations.push(EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:format!("00000000-0000-4000-8000-{:012}", 8901 + index),
            channel:"scale".into(),time:*time,value:[scale,1.0,1.0],
        });
    }
    session.apply(1,&operations).unwrap();
    let mut curves = Vec::new();
    for id in [8802,8803] {
        curves.push(EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:format!("00000000-0000-4000-8000-{id:012}"),
            channel:"position".into(),interpolation:"catmullrom".into(),
        });
    }
    for id in [8902,8903] {
        curves.push(EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIMATION.into(),bone_uuid:BONE.into(),
            keyframe_uuid:format!("00000000-0000-4000-8000-{id:012}"),
            channel:"scale".into(),interpolation:"catmullrom".into(),
        });
    }
    session.apply(2,&curves).unwrap();
    let source_before = session.export().unwrap();
    let report = inspect_bedrock_asset_handoff(session.document(),TEXTURE).unwrap();
    let clearance = &report["geometry"]["translation_clearance"];
    assert_eq!(report["status"],"source_consistent");
    assert_eq!(clearance["catmullrom_numeric_tracks"],1);
    assert_eq!(clearance["coverage_mode"],"scaled_pivot_envelope");
    let movement = clearance["max_reach_model_units"].as_f64().unwrap();
    let scale = clearance["max_scale_chain_amplification"].as_f64().unwrap();
    assert!(movement > 18.6 && movement < 18.7);
    assert!(scale > 2.16 && scale < 2.17);
    assert_eq!(clearance["native_verdict"],"NOT_EXECUTED");
    assert_eq!(report["geometry"]["sha256"],baseline["geometry"]["sha256"]);
    assert_eq!(report["texture"]["sha256"],baseline["texture"]["sha256"]);
    assert_ne!(report["animation"]["sha256"],baseline["animation"]["sha256"]);
    assert_eq!(session.export().unwrap(),source_before);
    assert_eq!(EditorSession::open(&source_before).unwrap().document(),
        session.document());
}

#[test]
fn invalid_png_or_opaque_animation_reports_exact_exporter_not_visual_pass() {
    let mut doc = prepared().document().clone();
    doc.texture_assets[0]["source"] = json!("data:image/png;base64,AAAB");
    let report = inspect_bedrock_asset_handoff(&doc,TEXTURE).unwrap();
    assert_eq!(report["texture"]["status"], "blocked");
    assert!(report["blockers"].as_array().unwrap().contains(
        &json!("TEXTURE_EXPORT_BLOCKED")));
    let mut opaque = prepared().document().clone();
    opaque.animation_assets[0]["unrecognized"] = json!("unknown");
    let report = inspect_bedrock_asset_handoff(&opaque,TEXTURE).unwrap();
    assert_eq!(report["animation"]["status"], "blocked");
    assert!(report["blockers"].as_array().unwrap().contains(
        &json!("ANIMATION_EXPORT_BLOCKED")));
    assert_eq!(inspect_bedrock_asset_handoff(&opaque,"wrong").unwrap_err(),
        "ASSET_HANDOFF_TEXTURE_UUID_INVALID");
}

