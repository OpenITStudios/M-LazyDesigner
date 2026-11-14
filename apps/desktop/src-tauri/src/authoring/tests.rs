//! Rust source regression intent; TEST_AUTHORED_NOT_RUN.

use super::*;
use serde_json::{json, Value};

const SAMPLE: &str = include_str!("../../fixtures/bedrock-basic.bbmodel");
const BONE: &str = "00000000-0000-4000-8000-000000000001";
const CUBE: &str = "00000000-0000-4000-8000-000000000002";

fn sample_cube(uuid: &str) -> Cube {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["elements"][0]["uuid"] = json!(uuid);
    serde_json::from_value(value["elements"][0].clone()).unwrap()
}

#[test]
fn v5_0_preserves_extensions_texture_references_and_animation_bytes_semantically() {
    let mut input: Value = serde_json::from_str(SAMPLE).unwrap();
    input["vendor"] = json!({"preserve": [1, 2]});
    input["groups"][0]["bone_extension"] = json!("untouched");
    input["elements"][0]["element_extension"] = json!({"opaque": true});
    input["elements"][0]["rotation"] = json!([22.5, 0.0, -45.0]);
    input["elements"][0]["autouv"] = json!(0);
    input["elements"][0]["stretch"] = json!([1.25, 1.0, 0.75]);
    input["groups"][0]["rotation"] = json!([0, 10, 0]);
    input["elements"][0]["faces"]["north"]["face_extension"] = json!("unchanged");
    input["textures"] = json!([{
        "uuid":"texture-1","name":"texture.png","source":"data:image/png;base64,AAAA",
        "extension":{"persistent":true}
    }]);
    input["elements"][0]["faces"]["north"]["texture"] = json!(0);
    input["animations"] = json!([{"uuid":"clip-1","animators":{"bone": {"keyframes":[]}}}]);
    input["animation_controllers"] = json!([{"uuid":"controller-1","states":{}}]);
    let bytes = serde_json::to_vec(&input).unwrap();
    let mut session = EditorSession::open(&bytes).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let exported: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(exported["vendor"], input["vendor"]);
    assert_eq!(exported["groups"][0]["bone_extension"], input["groups"][0]["bone_extension"]);
    assert_eq!(exported["elements"][0]["element_extension"], input["elements"][0]["element_extension"]);
    assert_eq!(exported["elements"][0]["faces"], input["elements"][0]["faces"]);
    for key in ["from", "to", "origin"] {
        for i in 0..3 {
            let original = input["elements"][0][key][i].as_f64().unwrap();
            let translated = exported["elements"][0][key][i].as_f64().unwrap();
            assert_eq!(translated, original + if i == 0 { 1.0 } else { 0.0 });
        }
    }
    assert_eq!(exported["textures"], input["textures"]);
    assert_eq!(exported["animations"], input["animations"]);
    assert_eq!(exported["animation_controllers"], input["animation_controllers"]);
    assert_eq!(exported["outliner"], input["outliner"]);
}

#[test]
fn new_bone_cube_uv_batch_roundtrip_and_history() {
    let initial = AuthoringDocument::new_bedrock("Example", "example").unwrap();
    let mut session = EditorSession::from_document(initial.clone()).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "body", "origin": [0,0,0], "children": []
    })).unwrap();
    let operations = vec![
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [2.0, 1.0, -1.0] },
        EditOperation::SetFaceUv { uuid: CUBE.into(), face: "north".into(),
            uv: [1.0, 2.0, 5.0, 6.0] },
    ];
    let receipt = session.apply(0, &operations).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 4);
    assert_eq!(session.document().cubes[0].from, [2.0, 1.0, -1.0]);
    assert_eq!(session.document().cubes[0].origin, Some([2.0, 1.0, -1.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([1.0,2.0,5.0,6.0]));
    let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(&reimported, session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &initial);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reimported);
}

#[test]
fn stale_and_partial_failures_leave_state_unchanged() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    let move_cube = EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] };
    assert_eq!(session.apply(1, &[move_cube.clone()]).unwrap_err(), "DOCUMENT_REVISION_STALE");
    assert_eq!(session.apply(0, &[
        move_cube,
        EditOperation::SetCubeBounds { uuid: "missing".into(),
            from: [0.0, 0.0, 0.0], to: [1.0, 1.0, 1.0] }
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn invalid_version_element_or_outliner_fails_closed() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["meta"]["format_version"] = json!("5.1");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "BBMODEL_VERSION_OR_FORMAT_UNSUPPORTED");
    value["meta"]["format_version"] = json!("5.0");
    value["elements"][0]["type"] = json!("mesh");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "ELEMENT_TYPE_UNSUPPORTED");
    value["elements"][0]["type"] = json!("cube");
    value["outliner"][0]["children"] = json!(["unknown"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "OUTLINER_CUBE_REFERENCE_INVALID");
    value["outliner"][0]["children"] = json!([CUBE]);
    value["groups"][0]["uuid"] = json!(CUBE);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "DUPLICATE_UUID");
}

#[test]
fn texture_index_must_be_valid_for_blockbench() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["elements"][0]["faces"]["north"]["texture"] = json!(9);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "CUBE_FACE_TEXTURE_UNSUPPORTED");
}

#[test]
fn box_uv_projects_refuse_inert_per_face_uv_edits() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [2.0, 2.0, 6.0, 6.0]
    }]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(session.summary().revision, 0);
}


#[test]
fn authored_cube_rotation_round_trip_preserves_opaque_asset_fields_and_undo() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["textures"] = json!([{
        "uuid":"embedded-texture",
        "name":"body.png",
        "source":"data:image/png;base64,AAAA",
        "extension": {"keep": [1, 2, 3]}
    }]);
    model["elements"][0]["faces"]["north"]["texture"] = json!(0);
    model["animations"] = json!([{
        "uuid":"idle-clip", "name":"idle",
        "animators": {BONE: {"keyframes": []}}
    }]);
    model["animation_controllers"] = json!([{"uuid":"controller","states": {"idle":{}}}]);
    let bytes = serde_json::to_vec(&model).unwrap();
    let mut session = EditorSession::open(&bytes).unwrap();
    let receipt = session.apply(0, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [22.5, -15.0, 0.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["rotation"], json!([22.5, -15.0, 0.0]));
    assert_eq!(saved["textures"], model["textures"]);
    assert_eq!(saved["animations"], model["animations"]);
    assert_eq!(saved["animation_controllers"], model["animation_controllers"]);
    assert_eq!(saved["groups"], model["groups"]);
    assert_eq!(saved["outliner"], model["outliner"]);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert!(session.document().cubes[0].extra.get("rotation").is_none());
    session.redo(2).unwrap();
    assert_eq!(*session.document(), reopened);
    session.apply(3, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap();
    assert!(session.document().cubes[0].extra.get("rotation").is_none());
}

#[test]
fn unsupported_auto_uv_mapping_fails_closed_without_partial_mutation() {
    for mode in [1, 2] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(mode);
        let bytes = serde_json::to_vec(&model).unwrap();
        let mut session = EditorSession::open(&bytes).unwrap();
        let original = session.document().clone();
        let commands = [
            EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
            EditOperation::SetCubeBounds {
                uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
            },
            EditOperation::SetFaceUv {
                uuid: CUBE.into(), face: "north".into(), uv: [1.0, 0.0, 5.0, 4.0],
            },
        ];
        for operation in commands {
            assert_eq!(session.apply(0, &[operation]).unwrap_err(), "CUBE_AUTO_UV_REMAP_REQUIRED");
            assert_eq!(session.document(), &original);
            assert_eq!(session.summary().revision, 0);
        }
        assert_eq!(session.apply(0, &[
            EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 12.0, 0.0] },
            EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
        ]).unwrap_err(), "CUBE_AUTO_UV_REMAP_REQUIRED");
        assert_eq!(session.document(), &original);
    }
}

#[test]
fn box_uv_resize_refused_while_rotation_and_translation_remain_atomic() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [6.0, 4.0, 4.0],
    }]).unwrap_err(), "CUBE_BOX_UV_RESIZE_UNSUPPORTED");
    assert_eq!(session.summary().revision, 0);
    session.apply(0, &[
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [2.0, 0.0, 0.0] },
        EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0] },
    ]).unwrap();
    assert_eq!(session.summary().revision, 1);
}

#[test]
fn malformed_rotation_and_auto_uv_fields_reject_import_without_silent_coercion() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["rotation"] = json!("90");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "ROTATION_FORMAT_INVALID");
    model["elements"][0]["rotation"] = json!([0, 0, 0]);
    model["groups"][0]["rotation"] = json!([0, 0]);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "ROTATION_FORMAT_INVALID");
    model["groups"][0]["rotation"] = json!([0, 0, 0]);
    model["elements"][0]["autouv"] = json!(3);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "CUBE_AUTO_UV_MODE_UNSUPPORTED");
    model["elements"][0]["autouv"] = json!(0);
    model["elements"][0]["box_uv"] = json!("yes");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "CUBE_BOX_UV_FLAG_INVALID");
}

#[test]
fn invalid_rotation_edits_reject_and_keep_revision_stable() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [0.0, f64::NAN, 0.0],
    }]).unwrap_err(), "CUBE_ROTATION_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}
