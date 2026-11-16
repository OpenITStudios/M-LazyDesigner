//! Rust source regression intent; TEST_AUTHORED_NOT_RUN.

use super::*;
use serde_json::{json, Value};

const SAMPLE: &str = include_str!("../../fixtures/bedrock-basic.bbmodel");
const TEXTURED: &str = include_str!("../../fixtures/bedrock-texture-interchange.bbmodel");
const BONE: &str = "00000000-0000-4000-8000-000000000001";
const CUBE: &str = "00000000-0000-4000-8000-000000000002";

fn sample_cube(uuid: &str) -> Cube {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["elements"][0]["uuid"] = json!(uuid);
    serde_json::from_value(value["elements"][0].clone()).unwrap()
}

// SOURCE-AUTHORED_NOT_RUN: document-wide texture membership has one index,
// while malformed/duplicate texture metadata keeps its original refusal gate.
#[test]
fn indexed_model_validation_preserves_numeric_uuid_and_opaque_asset_error_contracts() {
    let mut doc = AuthoringDocument::import_bbmodel(SAMPLE.as_bytes()).unwrap();
    for index in 0..96 {
        doc.texture_assets.push(json!({
            "uuid":format!("00000000-0000-4000-8000-{:012}", 10000 + index),
            "name":format!("texture_{index}.png"),
        }));
    }
    let original_cube = doc.cubes[0].clone();
    let mut child_ids = Vec::new();
    for index in 0..64 {
        let mut cube = original_cube.clone();
        cube.uuid = format!("00000000-0000-4000-8000-{:012}", 11000 + index);
        cube.name = Some(format!("cube_{index}"));
        cube.faces.get_mut("north").unwrap()["texture"] = json!(
            format!("00000000-0000-4000-8000-{:012}", 10000 + index % 32)
        );
        cube.faces.get_mut("east").unwrap()["texture"] = json!(index % 32);
        cube.faces.get_mut("south").unwrap()["texture"] = Value::Null;
        cube.faces.get_mut("west").unwrap()["texture"] = Value::Bool(false);
        cube.faces.get_mut("up").unwrap().as_object_mut().unwrap().remove("texture");
        child_ids.push(OutlinerNode::Cube(cube.uuid.clone()));
        doc.cubes.push(cube);
    }
    match &mut doc.hierarchy[0] {
        OutlinerNode::Bone(root) => root.children.extend(child_ids),
        OutlinerNode::Cube(_) => panic!("synthetic fixture root must be a Bone"),
    }
    doc.validate().unwrap();
    let source = doc.clone();
    assert_eq!(AuthoringDocument::import_bbmodel(&doc.export_bbmodel().unwrap()).unwrap(), doc);

    let mut missing = doc.clone();
    missing.cubes[1].faces.get_mut("north").unwrap()["texture"] =
        json!("00000000-0000-4000-8000-000000099999");
    assert_eq!(missing.validate().unwrap_err(), "CUBE_FACE_TEXTURE_UNSUPPORTED");
    let mut invalid_index = doc.clone();
    invalid_index.cubes[1].faces.get_mut("east").unwrap()["texture"] = json!(96);
    assert_eq!(invalid_index.validate().unwrap_err(), "CUBE_FACE_TEXTURE_UNSUPPORTED");
    let mut duplicated = doc.clone();
    let duplicate_texture_uuid = duplicated.texture_assets[94]["uuid"].clone();
    duplicated.texture_assets[95]["uuid"] = duplicate_texture_uuid;
    assert_eq!(duplicated.validate().unwrap_err(), "TEXTURE_UUID_DUPLICATE");
    let mut malformed = doc.clone();
    malformed.texture_assets[95] = Value::Null;
    assert_eq!(malformed.validate().unwrap_err(), "BBMODEL_ASSET_ENTRY_INVALID");
    assert_eq!(doc, source);
}

// SOURCE-AUTHORED only: Cargo and Blockbench tests remain on hold.
#[test]
fn numeric_linear_bone_position_scale_and_rotation_share_one_undoable_transaction() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009601";
    const POS: &str = "00000000-0000-4000-8000-000000009602";
    const SCALE: &str = "00000000-0000-4000-8000-000000009603";
    const ROT: &str = "00000000-0000-4000-8000-000000009604";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[EditOperation::CreateAnimation {
        uuid: ANIM.into(), name: "walk".into(), length: 2.0,
    }]).unwrap();
    let original = session.document().clone();
    session.apply(1, &[
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: POS.into(), channel: "position".into(),
            time: 1.0, value: [1.5, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: SCALE.into(), channel: "scale".into(),
            time: 1.0, value: [1.0, 1.4, 1.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: ROT.into(), time: 1.0,
            rotation: [0.0, 45.0, 0.0],
        },
    ]).unwrap();
    let saved = session.document().clone();
    let frames = &saved.animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(frames.as_array().unwrap().len(), 3);
    assert_eq!(frames[0]["channel"], json!("position"));
    assert_eq!(frames[1]["channel"], json!("scale"));
    assert_eq!(frames[2]["channel"], json!("rotation"));
    assert_eq!(frames[0]["data_points"][0]["x"], json!("1.5"));
    assert_eq!(frames[1]["data_points"][0]["y"], json!("1.4"));
    assert_eq!(saved.cubes, original.cubes);
    assert_eq!(saved.hierarchy, original.hierarchy);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    session.apply(4, &[
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: SCALE.into(), channel: "scale".into(),
            time: 1.5, value: [1.0, 2.0, 1.0],
        },
        EditOperation::SetAnimationLength {
            animation_uuid: ANIM.into(), length: 3.0,
        },
    ]).unwrap();
    assert_eq!(session.document().animation_assets[0]["length"], json!(3.0));
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]
        ["keyframes"][1]["time"], json!(1.5));
    let before_remove = session.document().clone();
    session.apply(5, &[EditOperation::RemoveBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: POS.into(), channel: "position".into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]
        ["keyframes"].as_array().unwrap().len(), 2);
    session.undo(6).unwrap();
    assert_eq!(session.document(), &before_remove);
}

#[test]
fn transform_keyframes_reject_unknown_molang_negative_scale_and_cross_channel_edits() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009611";
    const POS: &str = "00000000-0000-4000-8000-000000009612";
    const SCALE: &str = "00000000-0000-4000-8000-000000009613";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[EditOperation::CreateAnimation {
        uuid: ANIM.into(), name: "walk".into(), length: 2.0,
    }]).unwrap();
    let original = session.document().clone();
    for (channel, value) in [
        ("mystery", [1.0, 0.0, 0.0]),
        ("scale", [-1.0, 1.0, 1.0]),
        ("scale", [101.0, 1.0, 1.0]),
    ] {
        assert_eq!(session.apply(1, &[EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: POS.into(), channel: channel.into(),
            time: 1.0, value,
        }]).unwrap_err(), "ANIMATION_TRANSFORM_INVALID");
    }
    assert_eq!(session.document(), &original);
    session.apply(1, &[EditOperation::AddBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: POS.into(), channel: "position".into(),
        time: 1.0, value: [1.0, 0.0, 0.0],
    }]).unwrap();
    let saved = session.document().clone();
    assert_eq!(session.apply(2, &[EditOperation::AddBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: SCALE.into(), channel: "position".into(),
        time: 1.0, value: [2.0, 0.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CONFLICT");
    assert_eq!(session.apply(2, &[EditOperation::UpdateBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: POS.into(), channel: "scale".into(),
        time: 1.0, value: [1.0, 1.0, 1.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CHANNEL_MISMATCH");
    assert_eq!(session.apply(2, &[EditOperation::RemoveBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: POS.into(), channel: "rotation".into(),
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CHANNEL_MISMATCH");
    assert_eq!(session.document(), &saved);
    let mut opaque = saved.clone();
    opaque.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["x"] = json!("query.head_rotation");
    let mut opaque = EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(opaque.apply(0, &[EditOperation::AddBoneTransformKeyframe {
        animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
        keyframe_uuid: SCALE.into(), channel: "scale".into(),
        time: 0.5, value: [1.0, 1.0, 1.0],
    }]).unwrap_err(), "ANIMATION_TRANSFORM_UNSUPPORTED");
    assert_eq!(opaque.summary().revision, 0);
    assert!(!opaque.can_undo());
}




// SOURCE_AUTHORED_NOT_RUN: authored Blockbench 5.2.1 cubic Bezier handles
// are saved as per-axis time and value offsets, not baked key samples.
#[test]
fn numeric_bezier_handles_roundtrip_retime_preserve_assets_and_undo() {
    const A:&str="00000000-0000-4000-8000-000000009901";
    const P0:&str="00000000-0000-4000-8000-000000009902";
    const P2:&str="00000000-0000-4000-8000-000000009903";
    const R0:&str="00000000-0000-4000-8000-000000009904";
    const R2:&str="00000000-0000-4000-8000-000000009905";
    const S0:&str="00000000-0000-4000-8000-000000009906";
    const S2:&str="00000000-0000-4000-8000-000000009907";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original=session.document().clone();
    let add=|id:&str,channel:&str,time:f64,value:[f64;3]|
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:A.into(),bone_uuid:BONE.into(),
            keyframe_uuid:id.into(),channel:channel.into(),time,value,
        };
    let set=|id:&str,channel:&str,handles:BezierKeyframeHandles|
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:A.into(),bone_uuid:BONE.into(),
            keyframe_uuid:id.into(),channel:channel.into(),handles,
        };
    let linked=BezierKeyframeHandles {
        linked:true,
        left_time:[-0.25;3],left_value:[-2.0,0.0,0.0],
        right_time:[0.25;3],right_value:[2.0,0.0,0.0],
    };
    let next=BezierKeyframeHandles {
        linked:false,
        left_time:[-0.5,-0.25,-0.2],left_value:[-1.0,0.0,0.0],
        right_time:[0.2,0.25,0.3],right_value:[0.0;3],
    };
    let rotation=BezierKeyframeHandles {
        linked:false,
        left_time:[-0.2;3],left_value:[0.0;3],
        right_time:[0.2;3],right_value:[0.0,15.0,0.0],
    };
    let scale=BezierKeyframeHandles {
        linked:false,
        left_time:[-0.3;3],left_value:[0.0;3],
        right_time:[0.3;3],right_value:[0.15,0.0,0.0],
    };
    let receipt=session.apply(0,&[
        EditOperation::CreateAnimation {uuid:A.into(),name:"bezier".into(),length:2.0},
        add(P0,"position",0.0,[0.0,0.0,0.0]),
        add(P2,"position",2.0,[10.0,0.0,0.0]),
        add(R0,"rotation",0.0,[0.0,0.0,0.0]),
        add(R2,"rotation",2.0,[0.0,90.0,0.0]),
        add(S0,"scale",0.0,[1.0,1.0,1.0]),
        add(S2,"scale",2.0,[2.0,2.0,2.0]),
        set(P0,"position",linked.clone()),
        set(P2,"position",next.clone()),
        set(R0,"rotation",rotation.clone()),
        set(S0,"scale",scale.clone()),
    ]).unwrap();
    assert_eq!(receipt.revision,1);
    assert_eq!(receipt.operation_count,11);
    let saved=session.document().clone();
    let frames=&saved.animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(frames[0]["interpolation"],json!("bezier"));
    assert_eq!(frames[0]["bezier_linked"],json!(true));
    assert_eq!(frames[0]["bezier_right_time"],json!([0.25,0.25,0.25]));
    assert_eq!(frames[0]["bezier_right_value"],json!([2.0,0.0,0.0]));
    assert_eq!(frames[1]["bezier_left_time"],json!([-0.5,-0.25,-0.2]));
    assert_eq!(frames[2]["bezier_right_value"],json!([0.0,15.0,0.0]));
    assert_eq!(frames[4]["bezier_right_value"],json!([0.15,0.0,0.0]));
    let inspected=inspect_transform_track(&saved,A,BONE,"position",0,8).unwrap();
    assert_eq!(inspected["recognized"],json!(true));
    assert_eq!(inspected["interpolation_modes"],
        json!(["linear","step","catmullrom","bezier"]));
    assert_eq!(inspected["keyframes"][0]["bezier"]["linked"],json!(true));
    assert_eq!(inspected["keyframes"][1]["bezier"]["leftTime"],
        json!([-0.5,-0.25,-0.2]));
    assert_eq!(saved.texture_assets,original.texture_assets);
    assert_eq!(saved.cubes,original.cubes);
    assert_eq!(saved.bones,original.bones);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    assert_eq!(session.apply(1,&[set(P0,"position",linked.clone())]).unwrap_err(),
        "EDIT_NO_OP");

    session.apply(1,&[
        EditOperation::SetAnimationLoopMode {
            animation_uuid:A.into(),mode:"hold".into(),
        },
        EditOperation::ScaleAnimationTimeline {
            animation_uuid:A.into(),factor:2.0,
        },
    ]).unwrap();
    let scaled=session.document().clone();
    let frames=&scaled.animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(scaled.animation_assets[0]["loop"],json!("hold"));
    assert_eq!(scaled.animation_assets[0]["length"],json!(4.0));
    assert_eq!(frames[0]["bezier_right_time"],json!([0.5,0.5,0.5]));
    assert_eq!(frames[0]["bezier_right_value"],json!([2.0,0.0,0.0]));
    assert_eq!(frames[1]["bezier_left_time"],json!([-1.0,-0.5,-0.4]));
    assert_eq!(frames[1]["time"],json!(4.0));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        scaled);
    session.undo(2).unwrap();
    assert_eq!(session.document(),&saved);
    session.undo(3).unwrap();
    assert_eq!(session.document(),&original);
    session.redo(4).unwrap();
    assert_eq!(session.document(),&saved);
    session.redo(5).unwrap();
    assert_eq!(session.document(),&scaled);

    session.apply(6,&[EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid:A.into(),bone_uuid:BONE.into(),
        keyframe_uuid:P0.into(),channel:"position".into(),
        interpolation:"linear".into(),
    }]).unwrap();
    let cleared=&session.document().animation_assets[0]["animators"][BONE]["keyframes"][0];
    assert_eq!(cleared["interpolation"],json!("linear"));
    for field in ["bezier_linked","bezier_left_time","bezier_left_value",
                  "bezier_right_time","bezier_right_value"] {
        assert!(cleared.get(field).is_none());
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn numeric_bezier_rejects_invalid_linked_import_and_crossed_time_handles_atomically() {
    const A:&str="00000000-0000-4000-8000-000000009911";
    const P0:&str="00000000-0000-4000-8000-000000009912";
    const P2:&str="00000000-0000-4000-8000-000000009913";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {uuid:A.into(),name:"curve".into(),length:2.0},
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:A.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P0.into(),channel:"position".into(),
            time:0.0,value:[0.0;3],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:A.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P2.into(),channel:"position".into(),
            time:2.0,value:[10.0,0.0,0.0],
        },
    ]).unwrap();
    let original=session.document().clone();
    let valid=BezierKeyframeHandles {
        linked:false,
        left_time:[-0.1;3],left_value:[0.0;3],
        right_time:[0.1;3],right_value:[0.0;3],
    };
    let set=|bone:&str,key:&str,handles:BezierKeyframeHandles|
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:A.into(),bone_uuid:bone.into(),keyframe_uuid:key.into(),
            channel:"position".into(),handles,
        };
    let mut bad=valid.clone();
    bad.right_time[0]=f64::INFINITY;
    assert_eq!(session.apply(1,&[set(BONE,P0,bad)]).unwrap_err(),
        "ANIMATION_BEZIER_HANDLES_INVALID");
    let mut bad=valid.clone();
    bad.left_time[0]=0.1;
    assert_eq!(session.apply(1,&[set(BONE,P0,bad)]).unwrap_err(),
        "ANIMATION_BEZIER_HANDLES_INVALID");
    let mut bad=valid.clone();
    bad.linked=true;
    bad.left_value[0]=4.0;
    assert_eq!(session.apply(1,&[set(BONE,P0,bad)]).unwrap_err(),
        "ANIMATION_BEZIER_HANDLES_INVALID");
    assert_eq!(session.apply(1,&[set("missing",P0,valid.clone())]).unwrap_err(),
        "ANIMATION_TRACK_NOT_FOUND");
    assert_eq!(session.apply(1,&[set(BONE,"missing",valid.clone())]).unwrap_err(),
        "ANIMATION_KEYFRAME_NOT_FOUND");
    assert_eq!(session.document(),&original);
    let mut first=valid.clone();
    first.right_time=[1.8;3];
    session.apply(1,&[set(BONE,P0,first)]).unwrap();
    let safe=session.document().clone();
    let mut last=valid.clone();
    last.left_time=[-1.8;3];
    assert_eq!(session.apply(2,&[
        EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
        set(BONE,P2,last),
    ]).unwrap_err(),"ANIMATION_BEZIER_AFTER_EDIT_UNSUPPORTED");
    assert_eq!(session.document(),&safe);
    assert_eq!(session.summary().revision,2);

    let mut imported=original.clone();
    imported.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["interpolation"]=json!("bezier");
    // Incomplete handles must remain untouched, not get "repaired" through
    // guesses about Blockbench's implicit keyframe defaults.
    let mut opaque=EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(opaque.apply(0,&[set(BONE,P0,valid)]).unwrap_err(),
        "ANIMATION_BEZIER_CLIP_UNSUPPORTED");
    assert_eq!(opaque.document(),&imported);
    assert!(!opaque.can_undo());
}

// SOURCE_AUTHORED_NOT_RUN: pinned Blockbench Catmull-Rom uses the same
// saved Keyframe.interpolation field for numeric Bone Position/Rotation/Scale.
// No Bezier handle, Molang or opaque effects are rewritten.
#[test]
fn numeric_catmullrom_authoring_preserves_three_channels_and_saved_wire() {
    const ANIM:&str="00000000-0000-4000-8000-000000009891";
    const P0:&str="00000000-0000-4000-8000-000000009892";
    const P1:&str="00000000-0000-4000-8000-000000009893";
    const P2:&str="00000000-0000-4000-8000-000000009894";
    const P3:&str="00000000-0000-4000-8000-000000009895";
    const R0:&str="00000000-0000-4000-8000-000000009896";
    const R3:&str="00000000-0000-4000-8000-000000009897";
    const S0:&str="00000000-0000-4000-8000-000000009898";
    const S3:&str="00000000-0000-4000-8000-000000009899";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let initial=session.document().clone();
    let add=|key:&str,channel:&str,time:f64,value:[f64;3]|
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:key.into(),channel:channel.into(),time,value,
        };
    let interpolation=|key:&str,channel:&str,mode:&str|
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:key.into(),channel:channel.into(),
            interpolation:mode.into(),
        };
    let receipt=session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"catmull_idle".into(),length:3.0,
        },
        add(P0,"position",0.0,[0.0,0.0,0.0]),
        add(P1,"position",1.0,[0.0,0.0,0.0]),
        add(P2,"position",2.0,[10.0,0.0,0.0]),
        add(P3,"position",3.0,[10.0,0.0,0.0]),
        add(R0,"rotation",0.0,[0.0,0.0,0.0]),
        add(R3,"rotation",3.0,[0.0,90.0,0.0]),
        add(S0,"scale",0.0,[1.0,1.0,1.0]),
        add(S3,"scale",3.0,[2.0,2.0,2.0]),
        interpolation(P1,"position","catmullrom"),
        interpolation(R0,"rotation","catmullrom"),
        interpolation(S0,"scale","catmullrom"),
    ]).unwrap();
    assert_eq!(receipt.revision,1);
    assert_eq!(receipt.operation_count,12);
    let saved=session.document().clone();
    assert_eq!(saved.cubes,initial.cubes);
    assert_eq!(saved.bones,initial.bones);
    assert_eq!(saved.texture_assets,initial.texture_assets);
    assert_eq!(saved.animation_assets[0]["animators"][BONE]
        ["keyframes"][1]["interpolation"],json!("catmullrom"));
    let pos=inspect_transform_track(&saved,ANIM,BONE,"position",0,8).unwrap();
    assert_eq!(pos["recognized"],json!(true));
    assert_eq!(pos["interpolation_modes"],json!(["linear","step","catmullrom"]));
    assert_eq!(pos["keyframes"][1]["interpolation"],json!("catmullrom"));
    assert_eq!(pos["keyframes"][0]["interpolation"],json!("linear"));
    let rot=inspect_transform_track(&saved,ANIM,BONE,"rotation",0,8).unwrap();
    assert_eq!(rot["keyframes"][0]["interpolation"],json!("catmullrom"));
    let scale=inspect_transform_track(&saved,ANIM,BONE,"scale",0,8).unwrap();
    assert_eq!(scale["keyframes"][0]["interpolation"],json!("catmullrom"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    assert_eq!(session.apply(1,&[interpolation(P1,"position","catmullrom")])
        .unwrap_err(),"EDIT_NO_OP");
    session.apply(1,&[
        EditOperation::SetAnimationLoopMode {
            animation_uuid:ANIM.into(),mode:"loop".into(),
        },
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P1.into(),channel:"position".into(),
            time:1.25,value:[1.0,0.0,0.0],
        },
        EditOperation::ScaleAnimationTimeline {
            animation_uuid:ANIM.into(),factor:2.0,
        },
    ]).unwrap();
    let changed=session.document().clone();
    assert_eq!(changed.animation_assets[0]["loop"],json!("loop"));
    assert_eq!(changed.animation_assets[0]["length"],json!(6.0));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]
        ["keyframes"][1]["time"],json!(2.5));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]
        ["keyframes"][1]["interpolation"],json!("catmullrom"));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]
        ["keyframes"][5]["interpolation"],json!("linear"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        changed);
    session.undo(2).unwrap();
    assert_eq!(session.document(),&saved);
    session.undo(3).unwrap();
    assert_eq!(session.document(),&initial);
    session.redo(4).unwrap();
    assert_eq!(session.document(),&saved);
    session.redo(5).unwrap();
    assert_eq!(session.document(),&changed);
    session.apply(6,&[interpolation(P1,"position","linear")]).unwrap();
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]
        ["keyframes"][1]["interpolation"],json!("linear"));
}

#[test]
fn numeric_catmullrom_refuses_unknown_handles_and_ambiguous_imports() {
    const ANIM:&str="00000000-0000-4000-8000-000000009881";
    const KEY:&str="00000000-0000-4000-8000-000000009882";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"curve".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:KEY.into(),channel:"rotation".into(),
            time:0.0,value:[0.0,90.0,0.0],
        },
    ]).unwrap();
    let original=session.document().clone();
    let curve=EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
        keyframe_uuid:KEY.into(),channel:"rotation".into(),
        interpolation:"catmullrom".into(),
    };
    let mut opaque=original.clone();
    opaque.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["bezier_right_time"]=json!([0.1,0.1,0.1]);
    let mut imported=EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(imported.apply(0,&[curve.clone()]).unwrap_err(),
        "ANIMATION_INTERPOLATION_UNSUPPORTED");
    assert_eq!(imported.document(),&opaque);
    let mut molang=original.clone();
    molang.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["y"]=json!("query.anything");
    let mut unknown=EditorSession::from_document(molang.clone()).unwrap();
    assert_eq!(unknown.apply(0,&[curve.clone()]).unwrap_err(),
        "ANIMATION_INTERPOLATION_UNSUPPORTED");
    assert_eq!(unknown.document(),&molang);
    let mut duplicated=original.clone();
    duplicated.animation_assets.push(original.animation_assets[0].clone());
    let mut ambiguous=EditorSession::from_document(duplicated.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[curve]).unwrap_err(),
        "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(ambiguous.document(),&duplicated);
    assert_eq!(session.document(),&original);
}




// SOURCE_AUTHORED_NOT_RUN: official Blockbench TimelineMarker.getUndoCopy()
// stores only {name,time,color}, with no persistent marker UUID.
#[test]
fn animation_timeline_markers_author_and_retime_with_owned_clip_without_overwriting_rig() {
    const CLIP:&str="00000000-0000-4000-8000-000000007601";
    const CLONE:&str="00000000-0000-4000-8000-000000007602";
    const KEY:&str="00000000-0000-4000-8000-000000007603";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let empty=session.document().clone();
    let receipt=session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:CLIP.into(),name:"walk".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:CLIP.into(),bone_uuid:BONE.into(),
            keyframe_uuid:KEY.into(),channel:"rotation".into(),
            time:0.25,value:[0.0,15.0,0.0],
        },
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time:0.1,
            name:"anticipation".into(),color:0,
        },
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time:0.25,
            name:"foot_contact".into(),color:3,
        },
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time:1.5,
            name:"recovery".into(),color:9,
        },
    ]).unwrap();
    assert_eq!(receipt.revision,1);
    assert_eq!(receipt.operation_count,5);
    let saved=session.document().clone();
    assert_eq!(saved.bones,empty.bones);
    assert_eq!(saved.cubes,empty.cubes);
    assert_eq!(saved.hierarchy,empty.hierarchy);
    assert_eq!(saved.texture_assets,empty.texture_assets);
    let markers=saved_timeline_markers(&saved.animation_assets[0]).unwrap();
    assert_eq!(markers.len(),3);
    assert_eq!(markers[0].name,"anticipation");
    assert_eq!(markers[0].time,0.1);
    assert_eq!(markers[1].name,"foot_contact");
    assert_eq!(markers[1].color,3);
    assert_eq!(markers[2].color,9);
    let json=&saved.animation_assets[0]["markers"];
    for item in json.as_array().unwrap() {
        assert_eq!(item.as_object().unwrap().len(),3);
        assert!(item.get("uuid").is_none());
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    let first=inspect_animation_timeline_markers(&saved,CLIP,0,2).unwrap();
    assert_eq!(first["recognized"],json!(true));
    assert_eq!(first["playback_verdict"],json!("NOT_EXECUTED"));
    assert_eq!(first["total_markers"],json!(3));
    assert_eq!(first["next_offset"],json!(2));
    assert_eq!(first["markers"][1]["name"],json!("foot_contact"));
    let second=inspect_animation_timeline_markers(&saved,CLIP,2,2).unwrap();
    assert_eq!(second["markers"][0]["color"],json!(9));
    assert_eq!(second["next_offset"],Value::Null);

    session.apply(1,&[EditOperation::UpdateAnimationTimelineMarker {
        animation_uuid:CLIP.into(),target_time:0.25,time:0.5,
        name:"planted_foot".into(),color:6,
    }]).unwrap();
    let updated=session.document().clone();
    assert_eq!(updated.animation_assets[0]["markers"][1]["time"],json!(0.5));
    assert_eq!(updated.animation_assets[0]["markers"][1]["color"],json!(6));
    assert_eq!(updated.animation_assets[0]["animators"][BONE]["keyframes"][0]["time"],
        json!(0.25));
    assert_eq!(session.apply(2,&[EditOperation::UpdateAnimationTimelineMarker {
        animation_uuid:CLIP.into(),target_time:0.5,time:0.5,
        name:"planted_foot".into(),color:6,
    }]).unwrap_err(),"EDIT_NO_OP");
    session.apply(2,&[
        EditOperation::ScaleAnimationTimeline {
            animation_uuid:CLIP.into(),factor:2.0,
        },
        EditOperation::SetAnimationLoopMode {
            animation_uuid:CLIP.into(),mode:"loop".into(),
        },
    ]).unwrap();
    let retimed=session.document().clone();
    assert_eq!(retimed.animation_assets[0]["length"],json!(4.0));
    assert_eq!(retimed.animation_assets[0]["loop"],json!("loop"));
    assert_eq!(retimed.animation_assets[0]["markers"][0]["time"],json!(0.2));
    assert_eq!(retimed.animation_assets[0]["markers"][1]["time"],json!(1.0));
    assert_eq!(retimed.animation_assets[0]["markers"][2]["time"],json!(3.0));
    assert_eq!(retimed.animation_assets[0]["animators"][BONE]["keyframes"][0]["time"],
        json!(0.5));
    assert_eq!(session.apply(3,&[EditOperation::SetAnimationLength {
        animation_uuid:CLIP.into(),length:2.0,
    }]).unwrap_err(),"ANIMATION_LENGTH_BEFORE_MARKER");
    assert_eq!(session.document(),&retimed);

    session.apply(3,&[EditOperation::DuplicateAnimationClip {
        source_uuid:CLIP.into(),new_uuid:CLONE.into(),
        new_name:"walk_variant".into(),
    }]).unwrap();
    let cloned=session.document().clone();
    assert_eq!(cloned.animation_assets[0],retimed.animation_assets[0]);
    assert_eq!(cloned.animation_assets[1]["markers"],
        retimed.animation_assets[0]["markers"]);
    assert_eq!(cloned.animation_assets[1]["loop"],json!("loop"));
    assert_ne!(cloned.animation_assets[1]["animators"][BONE]["keyframes"][0]["uuid"],
        cloned.animation_assets[0]["animators"][BONE]["keyframes"][0]["uuid"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        cloned);

    session.apply(4,&[EditOperation::RemoveAnimationTimelineMarker {
        animation_uuid:CLONE.into(),time:3.0,
    }]).unwrap();
    let isolated=session.document().clone();
    assert_eq!(isolated.animation_assets[0],retimed.animation_assets[0]);
    assert_eq!(isolated.animation_assets[1]["markers"].as_array().unwrap().len(),2);
    session.undo(5).unwrap();
    assert_eq!(session.document(),&cloned);
    session.undo(6).unwrap();
    assert_eq!(session.document(),&retimed);
    session.undo(7).unwrap();
    assert_eq!(session.document(),&updated);
    session.undo(8).unwrap();
    assert_eq!(session.document(),&saved);
    session.undo(9).unwrap();
    assert_eq!(session.document(),&empty);
    session.redo(10).unwrap();
    assert_eq!(session.document(),&saved);
    session.redo(11).unwrap();
    assert_eq!(session.document(),&updated);
    session.redo(12).unwrap();
    assert_eq!(session.document(),&retimed);
    session.redo(13).unwrap();
    assert_eq!(session.document(),&cloned);
    session.redo(14).unwrap();
    assert_eq!(session.document(),&isolated);
}

#[test]
fn animation_timeline_markers_refuse_unknown_sources_and_collisions_atomically() {
    const CLIP:&str="00000000-0000-4000-8000-000000007611";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:CLIP.into(),name:"idle".into(),length:2.0,
        },
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time:0.75,
            name:"contact".into(),color:4,
        },
    ]).unwrap();
    let saved=session.document().clone();
    let add=|time:f64,name:&str,color:u8|
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time,name:name.into(),color,
        };
    for (time,name,color,error) in [
        (0.75,"duplicate",1,"ANIMATION_MARKER_TIME_CONFLICT"),
        (0.7505,"too_close",1,"ANIMATION_MARKER_TIME_CONFLICT"),
        (1.0,"",1,"ANIMATION_MARKER_INVALID"),
        (1.0,"bad\nname",1,"ANIMATION_MARKER_INVALID"),
        (1.0,"bad_color",10,"ANIMATION_MARKER_INVALID"),
        (2.5,"too_late",1,"ANIMATION_MARKER_INVALID"),
        (f64::NAN,"not_finite",1,"ANIMATION_MARKER_INVALID"),
    ] {
        assert_eq!(session.apply(1,&[
            EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
            add(time,name,color),
        ]).unwrap_err(),error);
        assert_eq!(session.document(),&saved);
        assert_eq!(session.summary().revision,1);
    }
    assert_eq!(session.apply(1,&[
        EditOperation::UpdateAnimationTimelineMarker {
            animation_uuid:CLIP.into(),target_time:0.75,
            time:1.5,name:"updated".into(),color:10,
        },
    ]).unwrap_err(),"ANIMATION_MARKER_INVALID");
    assert_eq!(session.apply(1,&[
        EditOperation::UpdateAnimationTimelineMarker {
            animation_uuid:CLIP.into(),target_time:0.7,
            time:1.5,name:"updated".into(),color:1,
        },
    ]).unwrap_err(),"ANIMATION_MARKER_NOT_FOUND");
    assert_eq!(session.apply(1,&[
        EditOperation::RemoveAnimationTimelineMarker {
            animation_uuid:CLIP.into(),time:0.7,
        },
    ]).unwrap_err(),"ANIMATION_MARKER_NOT_FOUND");
    assert_eq!(session.document(),&saved);
    assert_eq!(inspect_animation_timeline_markers(&saved,CLIP,0,33).unwrap_err(),
        "ANIMATION_MARKER_INSPECT_PAGE_INVALID");

    let mut unknown=saved.clone();
    unknown.animation_assets[0]["markers"][0]["uuid"]=json!("unknown_marker");
    let mut imported=EditorSession::from_document(unknown.clone()).unwrap();
    assert_eq!(imported.apply(0,&[add(1.5,"new",2)]).unwrap_err(),
        "ANIMATION_MARKER_CLIP_UNSUPPORTED");
    assert_eq!(imported.document(),&unknown);
    assert_eq!(inspect_animation_timeline_markers(&unknown,CLIP,0,10).unwrap()
        ["recognized"],json!(false));

    let mut overlapping=saved.clone();
    overlapping.animation_assets[0]["markers"].as_array_mut().unwrap().push(
        json!({"name":"unknown","time":0.7503,"color":3})
    );
    let mut ambiguous=EditorSession::from_document(overlapping.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[EditOperation::RemoveAnimationTimelineMarker {
        animation_uuid:CLIP.into(),time:0.75,
    }]).unwrap_err(),"ANIMATION_MARKER_CLIP_UNSUPPORTED");
    assert_eq!(ambiguous.document(),&overlapping);
    assert!(!ambiguous.can_undo());
}

// SOURCE_AUTHORED_NOT_RUN: Blockbench 5.2.1 EffectAnimator persists Sound
// and Particle under animators.effects. No audio/particle file is loaded.
#[test]
fn sound_particle_effect_events_roundtrip_and_copy_with_bone_animation() {
    const ANIM:&str="00000000-0000-4000-8000-000000007511";
    const COPY:&str="00000000-0000-4000-8000-000000007512";
    const SOUND:&str="00000000-0000-4000-8000-000000007513";
    const PARTICLE:&str="00000000-0000-4000-8000-000000007514";
    const ROTATION:&str="00000000-0000-4000-8000-000000007515";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let initial=session.document().clone();
    let sound=AnimationEffectPoint {
        effect:"robot.attack".into(),
        locator:Some("weapon_tip".into()),bind_to_actor:None,
    };
    let particle=AnimationEffectPoint {
        effect:"studio:robot_sparks".into(),
        locator:Some("weapon_tip".into()),bind_to_actor:Some(false),
    };
    let receipt=session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"attack".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:ROTATION.into(),channel:"rotation".into(),
            time:0.5,value:[0.0,45.0,0.0],
        },
        EditOperation::AddAnimationEffectEvent {
            animation_uuid:ANIM.into(),keyframe_uuid:SOUND.into(),
            channel:"sound".into(),time:0.5,points:vec![sound.clone()],
        },
        EditOperation::AddAnimationEffectEvent {
            animation_uuid:ANIM.into(),keyframe_uuid:PARTICLE.into(),
            channel:"particle".into(),time:0.5,points:vec![particle.clone()],
        },
    ]).unwrap();
    assert_eq!(receipt.revision,1);
    assert_eq!(receipt.operation_count,4);
    let saved=session.document().clone();
    let track=&saved.animation_assets[0]["animators"]["effects"];
    assert_eq!(track["type"],json!("effect"));
    assert_eq!(track["name"],json!("Effects"));
    assert_eq!(track["keyframes"].as_array().unwrap().len(),2);
    assert_eq!(track["keyframes"][0]["channel"],json!("sound"));
    assert_eq!(track["keyframes"][0]["data_points"][0]["effect"],
        json!("robot.attack"));
    assert!(track["keyframes"][0]["data_points"][0]
        .get("bind_to_actor").is_none());
    assert_eq!(track["keyframes"][1]["channel"],json!("particle"));
    assert_eq!(track["keyframes"][1]["data_points"][0]["bind_to_actor"],
        json!(false));
    assert!(track["keyframes"][1]["data_points"][0].get("file").is_none());
    assert!(track["keyframes"][1]["data_points"][0].get("script").is_none());
    assert_eq!(saved.cubes,initial.cubes);
    assert_eq!(saved.bones,initial.bones);
    assert_eq!(saved.hierarchy,initial.hierarchy);
    assert_eq!(saved.texture_assets,initial.texture_assets);
    assert_eq!(saved.extensions,initial.extensions);
    let evidence=inspect_animation_effect_events(&saved,ANIM,0,16).unwrap();
    assert_eq!(evidence["recognized"],json!(true));
    assert_eq!(evidence["scope"],json!("saved_sound_particle_markers"));
    assert_eq!(evidence["playback_verdict"],json!("NOT_EXECUTED"));
    assert_eq!(evidence["total_events"],json!(2));
    assert_eq!(evidence["events"][0]["uuid"],json!(SOUND));
    assert_eq!(evidence["events"][1]["data_points"][0]["locator"],
        json!("weapon_tip"));
    let second=inspect_animation_effect_events(&saved,ANIM,1,1).unwrap();
    assert_eq!(second["events"][0]["uuid"],json!(PARTICLE));
    assert_eq!(second["next_offset"],Value::Null);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);

    session.apply(1,&[EditOperation::DuplicateAnimationClip {
        source_uuid:ANIM.into(),new_uuid:COPY.into(),new_name:"attack_fast".into(),
    }]).unwrap();
    let copied=session.document().clone();
    assert_eq!(copied.animation_assets.len(),2);
    assert_eq!(copied.animation_assets[0],saved.animation_assets[0]);
    assert_eq!(copied.animation_assets[1]["uuid"],json!(COPY));
    let new_sound=copied.animation_assets[1]["animators"]["effects"]["keyframes"][0]
        ["uuid"].as_str().unwrap().to_owned();
    let new_particle=copied.animation_assets[1]["animators"]["effects"]["keyframes"][1]
        ["uuid"].as_str().unwrap().to_owned();
    assert_ne!(new_sound,SOUND);
    assert_ne!(new_particle,PARTICLE);
    assert_ne!(new_sound,new_particle);
    assert_eq!(copied.animation_assets[1]["animators"]["effects"]["keyframes"][0]
        ["data_points"][0]["effect"],json!("robot.attack"));

    session.apply(2,&[EditOperation::UpdateAnimationEffectEvent {
        animation_uuid:COPY.into(),keyframe_uuid:new_sound.clone(),
        channel:"sound".into(),time:1.0,points:vec![AnimationEffectPoint {
            effect:"robot.heavy_attack".into(),locator:None,bind_to_actor:None,
        }],
    }]).unwrap();
    let changed=session.document().clone();
    assert_eq!(changed.animation_assets[0],saved.animation_assets[0]);
    assert_eq!(changed.animation_assets[1]["animators"]["effects"]["keyframes"][0]
        ["time"],json!(1.0));
    assert_eq!(changed.animation_assets[1]["animators"]["effects"]["keyframes"][0]
        ["data_points"][0]["effect"],json!("robot.heavy_attack"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        changed);

    session.undo(3).unwrap();
    assert_eq!(session.document(),&copied);
    session.undo(4).unwrap();
    assert_eq!(session.document(),&saved);
    session.undo(5).unwrap();
    assert_eq!(session.document(),&initial);
    session.redo(6).unwrap();
    assert_eq!(session.document(),&saved);
    session.redo(7).unwrap();
    assert_eq!(session.document(),&copied);
    session.redo(8).unwrap();
    assert_eq!(session.document(),&changed);

    let receipt=session.apply(9,&[
        EditOperation::RemoveAnimationEffectEvent {
            animation_uuid:COPY.into(),keyframe_uuid:new_particle,
            channel:"particle".into(),
        },
    ]).unwrap();
    assert_eq!(receipt.changed_uuids.len(),1);
    assert_eq!(session.document().animation_assets[1]["animators"]["effects"]
        ["keyframes"].as_array().unwrap().len(),1);
    assert_eq!(session.document().animation_assets[0],saved.animation_assets[0]);
    session.undo(10).unwrap();
    assert_eq!(session.document(),&changed);
}

#[test]
fn effect_events_refuse_opaque_script_files_duplicates_and_invalid_metadata_atomically() {
    const ANIM:&str="00000000-0000-4000-8000-000000007521";
    const KEY:&str="00000000-0000-4000-8000-000000007522";
    const OTHER:&str="00000000-0000-4000-8000-000000007523";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[EditOperation::CreateAnimation {
        uuid:ANIM.into(),name:"idle".into(),length:2.0,
    }]).unwrap();
    let original=session.document().clone();
    let point=AnimationEffectPoint {
        effect:"robot.idle".into(),locator:Some("head".into()),
        bind_to_actor:None,
    };
    let add=|id:&str,channel:&str,time:f64,points:Vec<AnimationEffectPoint>|
        EditOperation::AddAnimationEffectEvent {
            animation_uuid:ANIM.into(),keyframe_uuid:id.into(),
            channel:channel.into(),time,points,
        };
    for (id,channel,time,points,error) in [
        (KEY,"timeline",0.5,vec![point.clone()],
            "ANIMATION_EFFECT_CHANNEL_UNSUPPORTED"),
        (KEY,"sound",0.5,vec![],"ANIMATION_EFFECT_POINTS_INVALID"),
        (KEY,"sound",0.5,vec![point.clone();9],
            "ANIMATION_EFFECT_POINTS_INVALID"),
        (KEY,"sound",0.5,vec![AnimationEffectPoint {
            effect:"".into(),..point.clone()}],
            "ANIMATION_EFFECT_POINTS_INVALID"),
        (KEY,"sound",0.5,vec![AnimationEffectPoint {
            effect:"../../file".into(),..point.clone()}],
            "ANIMATION_EFFECT_POINTS_INVALID"),
        (KEY,"sound",0.5,vec![AnimationEffectPoint {
            bind_to_actor:Some(false),..point.clone()}],
            "ANIMATION_EFFECT_POINTS_INVALID"),
        ("bad uuid","sound",0.5,vec![point.clone()],
            "ANIMATION_EFFECT_ID_INVALID"),
        (KEY,"sound",3.0,vec![point.clone()],
            "ANIMATION_EFFECT_TIME_INVALID"),
        (KEY,"sound",f64::NAN,vec![point.clone()],
            "ANIMATION_EFFECT_TIME_INVALID"),
        (BONE,"sound",0.5,vec![point.clone()],
            "ANIMATION_EFFECT_ID_CONFLICT"),
    ] {
        assert_eq!(session.apply(1,&[
            EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
            add(id,channel,time,points),
        ]).unwrap_err(),error);
        assert_eq!(session.document(),&original);
        assert_eq!(session.summary().revision,1);
    }
    // Existing references from opaque resolution metadata are also
    // reserved; generated event IDs cannot silently adopt them.
    let mut referenced=original.clone();
    referenced.resolution.extra.insert("external_effect_key".into(),json!(OTHER));
    let mut reserved=EditorSession::from_document(referenced.clone()).unwrap();
    assert_eq!(reserved.apply(0,&[
        add(OTHER,"sound",1.0,vec![point.clone()]),
    ]).unwrap_err(),"ANIMATION_EFFECT_ID_CONFLICT");
    assert_eq!(reserved.document(),&referenced);

    session.apply(1,&[add(KEY,"sound",0.5,vec![point.clone()])]).unwrap();
    let known=session.document().clone();
    assert_eq!(session.apply(2,&[
        add(OTHER,"sound",0.5,vec![point.clone()]),
    ]).unwrap_err(),"ANIMATION_EFFECT_AFTER_EDIT_UNSUPPORTED");
    assert_eq!(session.document(),&known);
    assert_eq!(session.apply(2,&[add(KEY,"particle",0.9,vec![point.clone()])])
        .unwrap_err(),"ANIMATION_EFFECT_ID_CONFLICT");
    assert_eq!(session.document(),&known);
    assert_eq!(session.apply(2,&[EditOperation::RemoveAnimationEffectEvent {
        animation_uuid:ANIM.into(),keyframe_uuid:KEY.into(),
        channel:"particle".into(),
    }]).unwrap_err(),"ANIMATION_EFFECT_CHANNEL_MISMATCH");
    assert_eq!(session.document(),&known);

    let mut imported=known.clone();
    imported.animation_assets[0]["animators"]["effects"]["keyframes"][0]
        ["data_points"][0]["file"]=json!("/mnt/private.wav");
    let mut foreign=EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(foreign.apply(0,&[add(OTHER,"sound",1.0,vec![point.clone()])])
        .unwrap_err(),"ANIMATION_EFFECT_CLIP_UNSUPPORTED");
    assert_eq!(foreign.document(),&imported);
    assert_eq!(inspect_animation_effect_events(&imported,ANIM,0,16).unwrap()
        ["recognized"],json!(false));

    let mut scripted=known.clone();
    scripted.animation_assets[0]["animators"]["effects"]["keyframes"][0]
        ["data_points"][0]["script"]=json!("variable.exploit=1");
    let mut unsafe_clip=EditorSession::from_document(scripted.clone()).unwrap();
    assert_eq!(unsafe_clip.apply(0,&[add(OTHER,"sound",1.0,vec![point])])
        .unwrap_err(),"ANIMATION_EFFECT_CLIP_UNSUPPORTED");
    assert_eq!(unsafe_clip.document(),&scripted);
    assert!(!unsafe_clip.can_undo());
}

// SOURCE_AUTHORED_NOT_RUN: clip timing mutations move Sound/Particle
// metadata keyframes together with Bone tracks, never resample/execute them.
#[test]
fn sound_particle_events_follow_clip_retime_and_refuse_truncation() {
    const ANIM:&str="00000000-0000-4000-8000-000000007531";
    const KEY:&str="00000000-0000-4000-8000-000000007532";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"retime_sound".into(),length:2.0,
        },
        EditOperation::AddAnimationEffectEvent {
            animation_uuid:ANIM.into(),keyframe_uuid:KEY.into(),
            channel:"sound".into(),time:1.25,
            points:vec![AnimationEffectPoint {
                effect:"robot.step".into(),locator:None,bind_to_actor:None,
            }],
        },
    ]).unwrap();
    let original=session.document().clone();
    session.apply(1,&[
        EditOperation::SetAnimationLoopMode {
            animation_uuid:ANIM.into(),mode:"loop".into(),
        },
        EditOperation::ScaleAnimationTimeline {
            animation_uuid:ANIM.into(),factor:2.0,
        },
    ]).unwrap();
    let retimed=session.document().clone();
    assert_eq!(retimed.animation_assets[0]["loop"],json!("loop"));
    assert_eq!(retimed.animation_assets[0]["length"],json!(4.0));
    assert_eq!(retimed.animation_assets[0]["animators"]["effects"]
        ["keyframes"][0]["time"],json!(2.5));
    assert_eq!(retimed.animation_assets[0]["animators"]["effects"]
        ["keyframes"][0]["data_points"][0]["effect"],json!("robot.step"));
    assert_eq!(inspect_animation_effect_events(&retimed,ANIM,0,1).unwrap()
        ["events"][0]["time"],json!(2.5));
    assert_eq!(session.apply(2,&[
        EditOperation::SetAnimationLength {
            animation_uuid:ANIM.into(),length:2.0,
        },
    ]).unwrap_err(),"ANIMATION_LENGTH_BEFORE_KEYFRAME");
    assert_eq!(session.document(),&retimed);
    assert_eq!(session.summary().revision,2);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        retimed);
    session.undo(2).unwrap();
    assert_eq!(session.document(),&original);
    session.redo(3).unwrap();
    assert_eq!(session.document(),&retimed);
}

// SOURCE_AUTHORED_NOT_RUN: one editable Clip copy replaces per-keyframe
// AI round-trips and preserves the original numeric Animation.
#[test]
fn duplicate_animation_clip_preserves_curves_and_enables_independent_variant_editing() {
    const ANIM:&str="00000000-0000-4000-8000-000000007301";
    const CLONE:&str="00000000-0000-4000-8000-000000007302";
    const P0:&str="00000000-0000-4000-8000-000000007303";
    const P2:&str="00000000-0000-4000-8000-000000007304";
    const R0:&str="00000000-0000-4000-8000-000000007305";
    const S0:&str="00000000-0000-4000-8000-000000007306";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"walk".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P0.into(),channel:"position".into(),
            time:0.0,value:[0.0;3],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P2.into(),channel:"position".into(),
            time:2.0,value:[8.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:R0.into(),channel:"rotation".into(),
            time:0.0,value:[0.0,45.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:S0.into(),channel:"scale".into(),
            time:0.0,value:[1.0;3],
        },
    ]).unwrap();
    let bezier=BezierKeyframeHandles {
        linked:false,
        left_time:[-0.2;3],left_value:[0.0;3],
        right_time:[0.25;3],right_value:[1.0,0.0,0.0],
    };
    session.apply(1,&[
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P0.into(),channel:"position".into(),
            handles:bezier,
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:R0.into(),channel:"rotation".into(),
            interpolation:"step".into(),
        },
        EditOperation::SetAnimationLoopMode {
            animation_uuid:ANIM.into(),mode:"loop".into(),
        },
    ]).unwrap();
    let original=session.document().clone();
    let duplicate=EditOperation::DuplicateAnimationClip {
        source_uuid:ANIM.into(),new_uuid:CLONE.into(),new_name:"attack".into(),
    };
    let receipt=session.apply(2,&[duplicate.clone()]).unwrap();
    assert_eq!(receipt.revision,3);
    assert_eq!(receipt.operation_count,1);
    assert_eq!(receipt.changed_uuids,vec![CLONE.to_owned()]);
    let saved=session.document().clone();
    assert_eq!(saved.animation_assets.len(),2);
    assert_eq!(saved.animation_assets[0],original.animation_assets[0]);
    assert_eq!(saved.animation_assets[1]["uuid"],json!(CLONE));
    assert_eq!(saved.animation_assets[1]["name"],json!("attack"));
    assert_eq!(saved.animation_assets[1]["loop"],json!("loop"));
    assert_eq!(saved.animation_assets[1]["length"],json!(2.0));
    assert_eq!(saved.cubes,original.cubes);
    assert_eq!(saved.bones,original.bones);
    assert_eq!(saved.hierarchy,original.hierarchy);
    assert_eq!(saved.texture_assets,original.texture_assets);
    assert_eq!(saved.extensions,original.extensions);
    let source=&saved.animation_assets[0]["animators"][BONE]["keyframes"];
    let copied=&saved.animation_assets[1]["animators"][BONE]["keyframes"];
    let original_keys=source.as_array().unwrap();
    let clone_keys=copied.as_array().unwrap();
    assert_eq!(clone_keys.len(),4);
    let mut all=std::collections::HashSet::new();
    for (old,new) in original_keys.iter().zip(clone_keys) {
        let old_id=old["uuid"].as_str().unwrap();
        let new_id=new["uuid"].as_str().unwrap();
        assert_ne!(new_id,old_id);
        assert!(all.insert(new_id.to_owned()));
        let mut expected=old.clone();
        expected["uuid"]=json!(new_id);
        assert_eq!(new,&expected);
    }
    assert_eq!(copied[0]["interpolation"],json!("bezier"));
    assert_eq!(copied[0]["bezier_right_time"],json!([0.25,0.25,0.25]));
    assert_eq!(copied[2]["interpolation"],json!("step"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);

    let mut repeated=EditorSession::from_document(original.clone()).unwrap();
    repeated.apply(0,&[duplicate.clone()]).unwrap();
    assert_eq!(repeated.export().unwrap(),session.export().unwrap());

    session.undo(3).unwrap();
    assert_eq!(session.document(),&original);
    session.redo(4).unwrap();
    assert_eq!(session.document(),&saved);
    let copied_position=clone_keys[0]["uuid"].as_str().unwrap();
    session.apply(5,&[EditOperation::UpdateBoneTransformKeyframe {
        animation_uuid:CLONE.into(),bone_uuid:BONE.into(),
        keyframe_uuid:copied_position.into(),channel:"position".into(),
        time:0.5,value:[2.0,0.0,0.0],
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0],
        original.animation_assets[0]);
    assert_eq!(session.document().animation_assets[1]["animators"][BONE]
        ["keyframes"][0]["time"],json!(0.5));
    assert_eq!(session.document().animation_assets[1]["animators"][BONE]
        ["keyframes"][0]["interpolation"],json!("bezier"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn duplicate_animation_clip_refuses_unsafe_names_ids_and_opaque_input_atomically() {
    const ANIM:&str="00000000-0000-4000-8000-000000007321";
    const CLONE:&str="00000000-0000-4000-8000-000000007322";
    const P0:&str="00000000-0000-4000-8000-000000007323";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {uuid:ANIM.into(),name:"walk".into(),length:2.0},
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),
            keyframe_uuid:P0.into(),channel:"position".into(),
            time:0.0,value:[0.0;3],
        },
    ]).unwrap();
    let original=session.document().clone();
    let make=|source:&str,id:&str,name:&str| EditOperation::DuplicateAnimationClip {
        source_uuid:source.into(),new_uuid:id.into(),new_name:name.into(),
    };
    for (source,id,name,error) in [
        (ANIM,CLONE,"", "ANIMATION_DUPLICATE_ID_OR_NAME_INVALID"),
        (ANIM,CLONE,"  ","ANIMATION_DUPLICATE_ID_OR_NAME_INVALID"),
        (ANIM,"invalid uuid","attack","ANIMATION_DUPLICATE_ID_OR_NAME_INVALID"),
        (ANIM,CLONE,"bad\nname","ANIMATION_DUPLICATE_ID_OR_NAME_INVALID"),
        ("unknown",CLONE,"attack","ANIMATION_NOT_FOUND"),
        (ANIM,ANIM,"attack","ANIMATION_DUPLICATE_ID_CONFLICT"),
        (ANIM,CUBE,"attack","ANIMATION_DUPLICATE_ID_CONFLICT"),
        (ANIM,P0,"attack","ANIMATION_DUPLICATE_ID_CONFLICT"),
        (ANIM,CLONE,"walk","ANIMATION_DUPLICATE_NAME_CONFLICT"),
    ] {
        assert_eq!(session.apply(1,&[
            EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
            make(source,id,name),
        ]).unwrap_err(),error);
        assert_eq!(session.document(),&original);
        assert_eq!(session.summary().revision,1);
    }
    let mut opaque=original.clone();
    opaque.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["x"]=json!("query.opaque");
    let mut refused=EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(refused.apply(0,&[make(ANIM,CLONE,"attack")]).unwrap_err(),
        "ANIMATION_DUPLICATE_SOURCE_UNSUPPORTED");
    assert_eq!(refused.document(),&opaque);
    assert!(!refused.can_undo());

    // Pre-existing saved identity equal to a derived child UUID must stop
    // the copy before the Rust draft can replace the original document.
    let digest=sha256(format!(
        "lazydesigner:animation-clip-copy\0{CLONE}\0{P0}"
    ).as_bytes());
    let reserved=format!("{}-{}-4{}-8{}-{}",
        &digest[..8],&digest[8..12],&digest[13..16],
        &digest[17..20],&digest[20..32]);
    let mut occupied=original.clone();
    occupied.animation_assets.push(json!({
        "uuid":reserved,"name":"reserved","loop":"once",
        "length":0.0,"animators":{}
    }));
    let mut key_collision=EditorSession::from_document(occupied.clone()).unwrap();
    assert_eq!(key_collision.apply(0,&[make(ANIM,CLONE,"attack")]).unwrap_err(),
        "ANIMATION_DUPLICATE_KEY_ID_CONFLICT");
    assert_eq!(key_collision.document(),&occupied);

    let mut duplicated=original.clone();
    duplicated.animation_assets.push(original.animation_assets[0].clone());
    let mut ambiguous=EditorSession::from_document(duplicated.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[make(ANIM,CLONE,"attack")]).unwrap_err(),
        "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(ambiguous.document(),&duplicated);

    session.apply(1,&[make(ANIM,CLONE,"attack")]).unwrap();
    let once=session.document().clone();
    assert_eq!(session.apply(2,&[make(ANIM,CLONE,"attack")]).unwrap_err(),
        "ANIMATION_DUPLICATE_NAME_CONFLICT");
    assert_eq!(session.document(),&once);
}

// SOURCE_AUTHORED_NOT_RUN: pinned Blockbench 5.2.1 Step holds the prior
// numeric Bone value until the next frame. The Rust codec owns saved modes,
// while the Tauri renderer alone derives display poses.
#[test]
fn numeric_step_interpolation_roundtrips_updates_retimes_and_undoes() {
    const ANIM:&str="00000000-0000-4000-8000-000000009871";
    const P0:&str="00000000-0000-4000-8000-000000009872";
    const P2:&str="00000000-0000-4000-8000-000000009873";
    const R0:&str="00000000-0000-4000-8000-000000009874";
    const S1:&str="00000000-0000-4000-8000-000000009875";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let initial=session.document().clone();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"step_walk".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P0.into(),
            channel:"position".into(),time:0.0,value:[0.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P2.into(),
            channel:"position".into(),time:2.0,value:[4.0,0.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:R0.into(),
            channel:"rotation".into(),time:0.0,value:[0.0,45.0,0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:S1.into(),
            channel:"scale".into(),time:1.0,value:[1.0,1.25,1.0],
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P0.into(),
            channel:"position".into(),interpolation:"step".into(),
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:R0.into(),
            channel:"rotation".into(),interpolation:"step".into(),
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:S1.into(),
            channel:"scale".into(),interpolation:"step".into(),
        },
    ]).unwrap();
    let saved=session.document().clone();
    let frames=saved.animation_assets[0]["animators"][BONE]["keyframes"]
        .as_array().unwrap();
    assert_eq!(frames.len(),4);
    assert_eq!(frames[0]["interpolation"],json!("step"));
    assert_eq!(frames[1]["interpolation"],json!("linear"));
    assert_eq!(frames[2]["interpolation"],json!("step"));
    assert_eq!(frames[3]["interpolation"],json!("step"));
    let position=inspect_transform_track(&saved,ANIM,BONE,"position",0,8).unwrap();
    assert_eq!(position["recognized"],json!(true));
    assert_eq!(position["keyframes"][0]["interpolation"],json!("step"));
    assert_eq!(position["keyframes"][1]["interpolation"],json!("linear"));
    let rotation=inspect_transform_track(&saved,ANIM,BONE,"rotation",0,8).unwrap();
    assert_eq!(rotation["keyframes"][0]["interpolation"],json!("step"));
    let scale=inspect_transform_track(&saved,ANIM,BONE,"scale",0,8).unwrap();
    assert_eq!(scale["keyframes"][0]["interpolation"],json!("step"));
    assert_eq!(saved.cubes,initial.cubes);
    assert_eq!(saved.bones,initial.bones);
    assert_eq!(saved.texture_assets,initial.texture_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),saved);
    assert_eq!(session.apply(1,&[EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P0.into(),
        channel:"position".into(),interpolation:"step".into(),
    }]).unwrap_err(),"EDIT_NO_OP");
    session.apply(1,&[
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P0.into(),
            channel:"position".into(),time:0.5,value:[1.0,0.0,0.0],
        },
        EditOperation::ScaleAnimationTimeline {animation_uuid:ANIM.into(),factor:2.0},
    ]).unwrap();
    let retimed=session.document().clone();
    assert_eq!(retimed.animation_assets[0]["length"],json!(4.0));
    assert_eq!(retimed.animation_assets[0]["animators"][BONE]["keyframes"][0]["time"],json!(1.0));
    assert_eq!(retimed.animation_assets[0]["animators"][BONE]["keyframes"][0]["interpolation"],json!("step"));
    assert_eq!(retimed.animation_assets[0]["animators"][BONE]["keyframes"][1]["time"],json!(4.0));
    assert_eq!(retimed.animation_assets[0]["animators"][BONE]["keyframes"][1]["interpolation"],json!("linear"));
    session.undo(2).unwrap();
    assert_eq!(session.document(),&saved);
    session.undo(3).unwrap();
    assert_eq!(session.document(),&initial);
    session.redo(4).unwrap();
    assert_eq!(session.document(),&saved);
    session.redo(5).unwrap();
    assert_eq!(session.document(),&retimed);
    session.apply(6,&[EditOperation::SetBoneTransformKeyframeInterpolation {
        animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:P0.into(),
        channel:"position".into(),interpolation:"linear".into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]
        ["keyframes"][0]["interpolation"],json!("linear"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn numeric_step_interpolation_refuses_unknown_opaque_and_wrong_targets_atomically() {
    const ANIM:&str="00000000-0000-4000-8000-000000009881";
    const K:&str="00000000-0000-4000-8000-000000009882";
    let mut session=EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0,&[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(),name:"step".into(),length:2.0,
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(),bone_uuid:BONE.into(),keyframe_uuid:K.into(),
            channel:"rotation".into(),time:0.0,value:[0.0,90.0,0.0],
        },
    ]).unwrap();
    let saved=session.document().clone();
    let op=|anim:&str,bone:&str,key:&str,channel:&str,interpolation:&str|
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:anim.into(),bone_uuid:bone.into(),keyframe_uuid:key.into(),
            channel:channel.into(),interpolation:interpolation.into(),
        };
    for (anim,bone,key,channel,interpolation,error) in [
        (ANIM,BONE,K,"rotation","bezier","ANIMATION_INTERPOLATION_INVALID"),
        (ANIM,BONE,K,"rotation","hermite","ANIMATION_INTERPOLATION_INVALID"),
        (ANIM,BONE,K,"rotation","ease","ANIMATION_INTERPOLATION_INVALID"),
        (ANIM,BONE,K,"bad","step","ANIMATION_INTERPOLATION_INVALID"),
        ("notfound",BONE,K,"rotation","step","ANIMATION_NOT_FOUND"),
        (ANIM,"notfound",K,"rotation","step","ANIMATION_TRACK_NOT_FOUND"),
        (ANIM,BONE,"notfound","rotation","step","ANIMATION_KEYFRAME_NOT_FOUND"),
        (ANIM,BONE,K,"position","step","ANIMATION_KEYFRAME_CHANNEL_MISMATCH"),
    ] {
        assert_eq!(session.apply(1,&[
            EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
            op(anim,bone,key,channel,interpolation),
        ]).unwrap_err(),error);
        assert_eq!(session.document(),&saved);
        assert_eq!(session.summary().revision,1);
    }
    let mut duplicate=saved.clone();
    duplicate.animation_assets.push(saved.animation_assets[0].clone());
    let mut ambiguous=EditorSession::from_document(duplicate.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[op(ANIM,BONE,K,"rotation","step")]).unwrap_err(),
        "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(ambiguous.document(),&duplicate);

    let mut opaque=saved.clone();
    opaque.animation_assets[0]["animators"][BONE]["keyframes"][0]["interpolation"]=json!("bezier");
    let mut imported=EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(imported.apply(0,&[op(ANIM,BONE,K,"rotation","step")]).unwrap_err(),
        "ANIMATION_INTERPOLATION_UNSUPPORTED");
    assert_eq!(imported.document(),&opaque);
    assert_eq!(inspect_transform_track(&opaque,ANIM,BONE,"rotation",0,8).unwrap()
        ["recognized"],json!(false));
    assert_eq!(session.document(),&saved);
    assert!(!session.can_redo());
}

// Source-authored only. Blockbench loop/hold playback remains NOT_EXECUTED.
#[test]
fn animation_loop_modes_roundtrip_three_channel_authoring_and_retime() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009841";
    const POS: &str = "00000000-0000-4000-8000-000000009842";
    const ROT: &str = "00000000-0000-4000-8000-000000009843";
    const SCALE: &str = "00000000-0000-4000-8000-000000009844";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid:ANIM.into(), name:"walk".into(), length:2.0
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(), bone_uuid:BONE.into(),
            keyframe_uuid:POS.into(), channel:"position".into(),
            time:0.5, value:[1.0, 2.0, 3.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(), bone_uuid:BONE.into(),
            keyframe_uuid:ROT.into(), channel:"rotation".into(),
            time:1.0, value:[0.0, 60.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid:ANIM.into(), bone_uuid:BONE.into(),
            keyframe_uuid:SCALE.into(), channel:"scale".into(),
            time:1.5, value:[1.0, 1.25, 1.0],
        },
    ]).unwrap();
    let original = session.document().clone();
    session.apply(1, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"loop".into(),
    }]).unwrap();
    let looped = session.document().clone();
    assert_eq!(looped.animation_assets[0]["loop"], json!("loop"));
    let before_frames = looped.animation_assets[0]["animators"][BONE]["keyframes"].clone();
    session.apply(2, &[
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid:ANIM.into(), bone_uuid:BONE.into(),
            keyframe_uuid:SCALE.into(), channel:"scale".into(),
            time:1.75, value:[1.0, 1.5, 1.0],
        },
        EditOperation::ScaleAnimationTimeline {
            animation_uuid:ANIM.into(), factor:0.5,
        },
    ]).unwrap();
    let changed = session.document().clone();
    assert_eq!(changed.animation_assets[0]["loop"], json!("loop"));
    assert_eq!(changed.animation_assets[0]["length"], json!(1.0));
    let after_frames = &changed.animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(after_frames[0]["data_points"], before_frames[0]["data_points"]);
    assert_eq!(after_frames[0]["time"], json!(0.25));
    assert_eq!(after_frames[1]["time"], json!(0.5));
    assert_eq!(after_frames[2]["time"], json!(0.875));
    let track = inspect_transform_track(&changed, ANIM, BONE, "scale", 0, 16).unwrap();
    assert_eq!(track["recognized"], json!(true));
    assert_eq!(track["loop_mode"], json!("loop"));
    assert_eq!(track["clip_length"], json!(1.0));
    assert_eq!(track["visual_verdict"], json!("UNVERIFIED"));
    session.apply(3, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"hold".into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["loop"], json!("hold"));
    let held: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(held["animations"][0]["loop"], json!("hold"));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(4).unwrap();
    assert_eq!(session.document(), &changed);
    session.undo(5).unwrap();
    assert_eq!(session.document(), &looped);
    session.undo(6).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(7).unwrap();
    assert_eq!(session.document(), &looped);
    session.apply(8, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"once".into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["loop"], json!("once"));
}

#[test]
fn animation_loop_modes_refuse_zero_length_opaque_imports_and_bad_metadata() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009845";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[EditOperation::CreateAnimation {
        uuid:ANIM.into(), name:"idle".into(), length:0.0,
    }]).unwrap();
    let empty = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"loop".into(),
    }]).unwrap_err(), "ANIMATION_LOOP_LENGTH_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"bounce".into(),
    }]).unwrap_err(), "ANIMATION_LOOP_MODE_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:"unknown".into(), mode:"hold".into(),
    }]).unwrap_err(), "ANIMATION_NOT_FOUND");
    assert_eq!(session.document(), &empty);
    session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid:ANIM.into(), length:1.0 },
        EditOperation::SetAnimationLoopMode { animation_uuid:ANIM.into(), mode:"loop".into() },
    ]).unwrap();
    let looping = session.document().clone();
    assert_eq!(session.apply(2, &[EditOperation::SetAnimationLength {
        animation_uuid:ANIM.into(), length:0.0,
    }]).unwrap_err(), "ANIMATION_LOOP_LENGTH_INVALID");
    assert_eq!(session.apply(2, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"loop".into(),
    }]).unwrap_err(), "EDIT_NO_OP");
    let mut invalid = looping.clone();
    invalid.animation_assets[0]["loop"] = json!(42);
    let mut malformed = EditorSession::from_document(invalid.clone()).unwrap();
    assert_eq!(malformed.apply(0, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"once".into(),
    }]).unwrap_err(), "ANIMATION_LOOP_EDIT_UNSUPPORTED");
    assert_eq!(malformed.document(), &invalid);
    let mut opaque = looping.clone();
    opaque.animation_assets[0]["markers"] = json!([{"time": 0.5}]);
    let mut unknown = EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(unknown.apply(0, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"hold".into(),
    }]).unwrap_err(), "ANIMATION_LOOP_EDIT_UNSUPPORTED");
    assert_eq!(unknown.document(), &opaque);
    let mut duplicates = looping.clone();
    duplicates.animation_assets.push(looping.animation_assets[0].clone());
    let mut ambiguous = EditorSession::from_document(duplicates.clone()).unwrap();
    assert_eq!(ambiguous.apply(0, &[EditOperation::SetAnimationLoopMode {
        animation_uuid:ANIM.into(), mode:"hold".into(),
    }]).unwrap_err(), "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(ambiguous.document(), &duplicates);
    assert_eq!(session.document(), &looping);
    assert_eq!(session.summary().revision, 2);
}

// SOURCE-AUTHORED_ONLY: source is committed; Cargo/Blockbench not executed.
#[test]
fn animation_timeline_scale_retimes_three_numeric_bone_channels_atomically() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009851";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation { uuid: ANIM.into(), name: "walk".into(), length: 2.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009852".into(),
            channel: "position".into(), time: 0.5, value: [1.0, 2.0, 3.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009853".into(),
            channel: "rotation".into(), time: 1.0, value: [0.0, 90.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009854".into(),
            channel: "scale".into(), time: 1.5, value: [1.0, 1.5, 1.0],
        },
    ]).unwrap();
    let before = session.document().clone();
    let source_keyframes = before.animation_assets[0]["animators"][BONE]["keyframes"]
        .as_array().unwrap().clone();
    let receipt = session.apply(1, &[EditOperation::ScaleAnimationTimeline {
        animation_uuid: ANIM.into(), factor: 0.5,
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let saved = session.document().clone();
    assert_eq!(saved.animation_assets[0]["length"], json!(1.0));
    let frames = saved.animation_assets[0]["animators"][BONE]["keyframes"]
        .as_array().unwrap();
    assert_eq!(frames.len(), 3);
    for (i, expected_time) in [0.25, 0.5, 0.75].iter().enumerate() {
        assert_eq!(frames[i]["time"], json!(expected_time));
        assert_eq!(frames[i]["uuid"], source_keyframes[i]["uuid"]);
        assert_eq!(frames[i]["channel"], source_keyframes[i]["channel"]);
        assert_eq!(frames[i]["data_points"], source_keyframes[i]["data_points"]);
        assert_eq!(frames[i]["interpolation"], source_keyframes[i]["interpolation"]);
    }
    for (channel, time) in [("position", 0.25), ("rotation", 0.5), ("scale", 0.75)] {
        let inspected = inspect_transform_track(&saved, ANIM, BONE, channel, 0, 16).unwrap();
        assert_eq!(inspected["recognized"], json!(true));
        assert_eq!(inspected["keyframes"][0]["time"], json!(time));
    }
    assert_eq!(saved.cubes, before.cubes);
    assert_eq!(saved.bones, before.bones);
    assert_eq!(saved.texture_assets, before.texture_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(4, &[EditOperation::ScaleAnimationTimeline {
        animation_uuid: ANIM.into(), factor: 1.0,
    }]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn animation_timeline_scale_refuses_opaque_input_overflow_and_close_keyframes() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009861";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation { uuid: ANIM.into(), name: "walk".into(), length: 1000.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009862".into(),
            channel: "rotation".into(), time: 0.0, value: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009863".into(),
            channel: "rotation".into(), time: 0.000002, value: [0.0, 30.0, 0.0],
        },
    ]).unwrap();
    let saved = session.document().clone();
    for factor in [0.0, -1.0, f64::NAN, f64::INFINITY, 0.01, 11.0] {
        assert_eq!(session.apply(1, &[
            EditOperation::ScaleAnimationTimeline { animation_uuid: ANIM.into(), factor },
        ]).unwrap_err(), "ANIMATION_TIMELINE_FACTOR_INVALID");
    }
    assert_eq!(session.apply(1, &[
        EditOperation::ScaleAnimationTimeline { animation_uuid: ANIM.into(), factor: 4.0 },
    ]).unwrap_err(), "ANIMATION_TIMELINE_LENGTH_UNSUPPORTED");
    assert_eq!(session.apply(1, &[
        EditOperation::ScaleAnimationTimeline { animation_uuid: ANIM.into(), factor: 0.1 },
    ]).unwrap_err(), "ANIMATION_TIMELINE_AFTER_SCALE_UNSUPPORTED");
    assert_eq!(session.apply(1, &[
        EditOperation::ScaleAnimationTimeline { animation_uuid: "missing".into(), factor: 2.0 },
    ]).unwrap_err(), "ANIMATION_NOT_FOUND");
    assert_eq!(session.document(), &saved);
    assert_eq!(session.summary().revision, 1);
    let mut opaque = saved.clone();
    opaque.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["x"] = json!("query.head_yaw");
    let mut unsupported = EditorSession::from_document(opaque.clone()).unwrap();
    assert_eq!(unsupported.apply(0, &[
        EditOperation::ScaleAnimationTimeline { animation_uuid: ANIM.into(), factor: 0.5 },
    ]).unwrap_err(), "ANIMATION_TIMELINE_UNSUPPORTED");
    assert_eq!(unsupported.document(), &opaque);
    assert_eq!(unsupported.summary().revision, 0);

    let mut duplicate = saved.clone();
    duplicate.animation_assets.push(saved.animation_assets[0].clone());
    let mut duplicate_session = EditorSession::from_document(duplicate.clone()).unwrap();
    assert_eq!(duplicate_session.apply(0, &[
        EditOperation::ScaleAnimationTimeline { animation_uuid: ANIM.into(), factor: 0.5 },
    ]).unwrap_err(), "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(duplicate_session.document(), &duplicate);
}

// SOURCE-AUTHORED: existing Rust tests remain NOT_EXECUTED.
#[test]
fn animation_length_edit_is_atomic_reversible_and_keeps_keyframe_payload() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009101";
    const KEY: &str = "00000000-0000-4000-8000-000000009102";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: ANIM.into(), name: "idle".into(), length: 1.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: KEY.into(), time: 0.75, rotation: [0.0, 45.0, 0.0],
        },
    ]).unwrap();
    let before = session.document().clone();
    let frames = before.animation_assets[0]["animators"][BONE]["keyframes"].clone();
    let receipt = session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 2.5 },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.changed_uuids, vec![ANIM.to_owned()]);
    let changed = session.document().clone();
    assert_eq!(changed.animation_assets[0]["length"], json!(2.5));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["keyframes"], frames);
    assert_eq!(changed.cubes, before.cubes);
    assert_eq!(changed.bones, before.bones);
    assert_eq!(changed.hierarchy, before.hierarchy);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        changed);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &changed);
    assert_eq!(session.apply(4, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 2.5 },
    ]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn animation_length_edit_refuses_truncation_and_unrecognized_tracks_without_partial_write() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009103";
    const KEY: &str = "00000000-0000-4000-8000-000000009104";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: ANIM.into(), name: "walk".into(), length: 2.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: KEY.into(), time: 1.5, rotation: [0.0, 15.0, 0.0],
        },
    ]).unwrap();
    let original = session.document().clone();
    for length in [-1.0, 3601.0, f64::NAN, f64::INFINITY] {
        assert_eq!(session.apply(1, &[
            EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length },
        ]).unwrap_err(), "ANIMATION_LENGTH_INVALID");
    }
    assert_eq!(session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 1.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_BEFORE_KEYFRAME");
    assert_eq!(session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: "missing".into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);

    let mut imported = original.clone();
    imported.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["x"] = json!("query.head_yaw");
    let mut imported = EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(imported.apply(0, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_EDIT_UNSUPPORTED");
    let source = imported.document().clone();
    assert_eq!(imported.apply(0, &[
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_EDIT_UNSUPPORTED");
    assert_eq!(imported.document(), &source);
    assert_eq!(imported.summary().revision, 0);
    assert!(!imported.can_undo());

    let mut duplicate = original.clone();
    duplicate.animation_assets.push(original.animation_assets[0].clone());
    let mut duplicated = EditorSession::from_document(duplicate.clone()).unwrap();
    assert_eq!(duplicated.apply(0, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(duplicated.document(), &duplicate);
    assert_eq!(duplicated.summary().revision, 0);
}

// SOURCE-AUTHORED ONLY: Rust/Blockbench tests remain NOT_EXECUTED.
#[test]
fn node_rename_is_atomic_undoable_and_synchronizes_known_bone_animator_name() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let animation_uuid = "00000000-0000-4000-8000-000000009801";
    let keyframe_uuid = "00000000-0000-4000-8000-000000009802";
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: animation_uuid.into(), name: "idle".into(), length: 1.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: animation_uuid.into(), bone_uuid: BONE.into(),
            keyframe_uuid: keyframe_uuid.into(), time: 0.5,
            rotation: [0.0, 30.0, 0.0],
        },
    ]).unwrap();
    let before_rename = session.document().clone();
    assert_eq!(before_rename.animation_assets[0]["animators"][BONE]["name"],
        json!("root_bone"));
    let receipt = session.apply(1, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name: "helmet_plate".into() },
        EditOperation::RenameNode { uuid: BONE.into(), name: "head".into() },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(receipt.changed_uuids, vec![CUBE.to_owned(), BONE.to_owned()]);
    let changed = session.document().clone();
    assert_eq!(changed.cubes[0].name.as_deref(), Some("helmet_plate"));
    assert_eq!(changed.bones[0].name, "head");
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["name"], json!("head"));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["keyframes"],
        before_rename.animation_assets[0]["animators"][BONE]["keyframes"]);
    assert_eq!(changed.cubes[0].uuid, original.cubes[0].uuid);
    assert_eq!(changed.hierarchy, before_rename.hierarchy);
    assert_eq!(changed.extensions, original.extensions);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, changed);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before_rename);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &changed);
}

#[test]
fn rename_refuses_invalid_conflicting_and_opaque_track_names_without_partial_edits() {
    let original = AuthoringDocument::import_bbmodel(SAMPLE.as_bytes()).unwrap();
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    let too_long = "X".repeat(129);
    for name in ["", "   ", "invalid\nname", too_long.as_str()] {
        assert_eq!(session.apply(0, &[
            EditOperation::RenameNode { uuid: BONE.into(), name: name.into() },
        ]).unwrap_err(), "NODE_NAME_INVALID");
    }
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: "unknown".into(), name: "new".into() },
    ]).unwrap_err(), "RENAME_NODE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);

    let mut second = original.clone();
    second.bones.push(Bone {
        uuid: "00000000-0000-4000-8000-000000009803".into(),
        name: "other".into(), origin: Some([0.0, 0.0, 0.0]),
        extra: Map::new(),
    });
    second.hierarchy.push(OutlinerNode::Bone(OutlinerBone {
        uuid: "00000000-0000-4000-8000-000000009803".into(),
        children: Vec::new(), is_open: Some(true), extra: Map::new(),
    }));
    let mut session = EditorSession::from_document(second.clone()).unwrap();
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: BONE.into(), name: "OTHER".into() },
    ]).unwrap_err(), "BONE_NAME_CONFLICT");
    assert_eq!(session.document(), &second);

    let mut tracked = original.clone();
    let mut animators = Map::new();
    animators.insert(BONE.into(), json!({
        "name": "unexpected_alias", "type": "bone", "keyframes": [],
    }));
    tracked.animation_assets.push(json!({
        "uuid": "00000000-0000-4000-8000-000000009804",
        "name": "imported", "animators": animators,
    }));
    let mut session = EditorSession::from_document(tracked.clone()).unwrap();
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name: "temporary".into() },
        EditOperation::RenameNode { uuid: BONE.into(), name: "head".into() },
    ]).unwrap_err(), "BONE_ANIMATOR_NAME_UNSUPPORTED");
    assert_eq!(session.document(), &tracked);
    assert_eq!(session.summary().revision, 0);
    assert!(!session.can_undo());
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name:
            original.cubes[0].name.clone().unwrap_or_else(|| "cube".into()) },
    ]).unwrap_err(), "EDIT_NO_OP");
}

// Full New -> Geometry -> Paint -> Animate -> .bbmodel -> Open source
// acceptance fixture. These assertions are AUTHORED_NOT_RUN.
#[test]
fn full_asset_authoring_assembly_roundtrip_preserves_geometry_texture_and_animation() {
    let original = AuthoringDocument::new_bedrock("Asset P0", "asset_p0").unwrap();
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "body", "origin": [0, 0, 0]
    })).unwrap();
    let texture_id = "00000000-0000-4000-8000-000000009901";
    let anim_id = "00000000-0000-4000-8000-000000009902";
    let result = session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 16, height: 16 },
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::SetBoneOrigin { uuid: BONE.into(), origin: [0.0, 3.0, 0.0] },
        EditOperation::SetCubeOrigin { uuid: CUBE.into(), origin: [1.0, 2.0, 1.0] },
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: 0.125 },
        EditOperation::CreatePaintTexture { uuid: texture_id.into(), name: "body.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: texture_id.into() },
        EditOperation::PaintTextureFill {
            texture_index: 0, at: [0, 0], rgba: [24, 48, 96, 255], erase: false,
        },
        EditOperation::CreateAnimation { uuid: anim_id.into(), name: "walk".into(), length: 2.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: anim_id.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009903".into(),
            channel: "position".into(), time: 0.5, value: [0.0, 1.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: anim_id.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009904".into(),
            channel: "rotation".into(), time: 1.0, value: [0.0, 45.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: anim_id.into(), bone_uuid: BONE.into(),
            keyframe_uuid: "00000000-0000-4000-8000-000000009905".into(),
            channel: "scale".into(), time: 1.5, value: [1.0, 1.5, 1.0],
        },
    ]).unwrap();
    assert_eq!(result.revision, 1);
    assert_eq!(result.operation_count, 13);
    let wire: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(wire["elements"][0]["inflate"], json!(0.125));
    assert_eq!(wire["groups"][0]["origin"], json!([0.0, 3.0, 0.0]));
    assert_eq!(wire["elements"][0]["faces"]["north"]["texture"], json!(texture_id));
    assert!(wire["textures"][0]["source"].as_str().unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(wire["animations"][0]["animators"][BONE]["keyframes"]
        .as_array().unwrap().len(), 3);
    let saved = session.document().clone();
    for channel in ["position", "rotation", "scale"] {
        let track = inspect_transform_track(&saved, anim_id, BONE, channel, 0, 16).unwrap();
        assert_eq!(track["recognized"], json!(true));
        assert_eq!(track["total_frames"], json!(1));
    }
    let reopened = EditorSession::open(&session.export().unwrap()).unwrap();
    assert_eq!(reopened.document(), &saved);
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureFill {
            texture_index: 0, at: [0, 0], rgba: [0, 0, 0, 0], erase: true,
        },
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: -4.0 },
    ]).unwrap_err(), "CUBE_INFLATE_DEGENERATE");
    assert_eq!(session.document(), &saved);
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &saved);
}

// Tests authored in source; Cargo/Windows/Blockbench execution remains held.
#[test]
fn reframe_cube_rebuilds_full_box_uv_once_and_preserves_rig_texture_data() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Reframe", "reframe").unwrap()).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0, 0, 0]
    })).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::SetCubeOrigin { uuid: CUBE.into(), origin: [2.0, 2.0, 2.0] },
    ]).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(1, &[
        EditOperation::ReframeCube {
            uuid: CUBE.into(), from: [1.0, 2.0, 3.0],
            to: [7.0, 8.0, 9.0], uv_policy: "box_repack".into(),
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.changed_uuids, vec![CUBE.to_owned()]);
    let exported: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(exported["elements"][0]["from"], json!([1.0,2.0,3.0]));
    assert_eq!(exported["elements"][0]["to"], json!([7.0,8.0,9.0]));
    assert_eq!(exported["elements"][0]["origin"], json!([2.0,2.0,2.0]));
    assert_eq!(exported["elements"][0]["faces"]["north"]["uv"], json!([6.0,6.0,12.0,12.0]));
    assert_eq!(exported["elements"][0]["faces"]["east"]["uv"], json!([0.0,6.0,6.0,12.0]));
    let surfaces = inspect_cube_surfaces(session.document(), CUBE).unwrap();
    assert_eq!(surfaces["geometry"]["projected_local_size"], json!([6.0,6.0,6.0]));
    assert_eq!(surfaces["uv"]["box_uv"], json!(true));
    assert_eq!(surfaces["faces"][0]["uv"], json!([6.0,6.0,12.0,12.0]));
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    let saved = session.document().clone();
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    // The explicit repack can refresh a stale Box UV cache even if the
    // caller keeps the same geometry.
    let mut stale = saved.clone();
    stale.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([0,0,1,1]);
    let mut repaired = EditorSession::from_document(stale).unwrap();
    repaired.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [1.0,2.0,3.0], to: [7.0,8.0,9.0],
        uv_policy: "box_repack".into(),
    }]).unwrap();
    assert_eq!(repaired.document(), &saved);
}

#[test]
fn reframe_preserves_manual_face_uv_but_refuses_unsafe_auto_and_box_rules() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    session.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [-1.0,-2.0,0.0], to: [8.0,4.0,4.0],
        uv_policy: "manual_preserve".into(),
    }]).unwrap();
    assert_eq!(session.document().cubes[0].faces, original.cubes[0].faces);
    assert_eq!(session.document().cubes[0].origin, original.cubes[0].origin);
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);

    for (bad, code) in [
        ([4.0,0.0,0.0], "CUBE_REFRAME_BOUNDS_INVALID"),
        ([f64::NAN,0.0,0.0], "CUBE_REFRAME_BOUNDS_INVALID"),
    ] {
        assert_eq!(session.apply(2, &[
            EditOperation::RenameNode { uuid: CUBE.into(), name: "partial".into() },
            EditOperation::ReframeCube { uuid: CUBE.into(), from: bad,
                to: [2.0,2.0,2.0], uv_policy: "manual_preserve".into() },
        ]).unwrap_err(), code);
        assert_eq!(session.document(), &original);
    }
    let mut imported = original.clone();
    imported.cubes[0].extra.insert("autouv".into(), json!(1));
    let mut auto = EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(auto.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0,0.0,0.0], to: [5.0,5.0,5.0],
        uv_policy: "manual_preserve".into(),
    }]).unwrap_err(), "CUBE_REFRAME_AUTO_UV_UNSUPPORTED");
    assert_eq!(auto.document(), &imported);
    let mut box_doc = original.clone();
    box_doc.meta.box_uv = Some(true);
    let mut wrong_policy = EditorSession::from_document(box_doc.clone()).unwrap();
    assert_eq!(wrong_policy.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0,0.0,0.0], to: [5.0,5.0,5.0],
        uv_policy: "manual_preserve".into(),
    }]).unwrap_err(), "CUBE_REFRAME_UV_POLICY_MISMATCH");
    box_doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
    let mut unsupported = EditorSession::from_document(box_doc.clone()).unwrap();
    assert_eq!(unsupported.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0,0.0,0.0], to: [5.0,5.0,5.0],
        uv_policy: "box_repack".into(),
    }]).unwrap_err(), "CUBE_REFRAME_UV_RULESET_UNSUPPORTED");
    assert_eq!(unsupported.document(), &box_doc);
    box_doc.extensions.remove("multi_file_ruleset");
    box_doc.meta.extra.insert("box_uv_float_size".into(), json!(true));
    let mut float_uv = EditorSession::from_document(box_doc.clone()).unwrap();
    assert_eq!(float_uv.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0,0.0,0.0], to: [5.0,5.0,5.0],
        uv_policy: "box_repack".into(),
    }]).unwrap_err(), "CUBE_REFRAME_BOX_UV_FLOAT_UNSUPPORTED");
    assert_eq!(float_uv.document(), &box_doc);
}

// SOURCE-AUTHORED: intended Rust geometry/UV .bbmodel acceptance, not run.
#[test]
fn stretch_and_box_uv_mirror_are_one_lossless_geometry_transaction() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Symmetry", "symmetry").unwrap()).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0, 0, 0]
    })).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
    ]).unwrap();
    let original = session.document().clone();
    let original_faces = original.cubes[0].faces.clone();
    assert_eq!(original_faces["north"]["uv"], json!([4.0, 4.0, 8.0, 8.0]));

    let changed = session.apply(1, &[
        EditOperation::SetCubeStretch { uuid: CUBE.into(), stretch: [1.5, 1.0, 0.75] },
        EditOperation::SetCubeMirrorUv { uuid: CUBE.into(), mirrored: true },
    ]).unwrap();
    assert_eq!(changed.operation_count, 2);
    assert_eq!(changed.revision, 2);
    assert_eq!(changed.changed_uuids, vec![CUBE.to_owned()]);
    let wire: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(wire["elements"][0]["stretch"], json!([1.5, 1.0, 0.75]));
    assert_eq!(wire["elements"][0]["mirror_uv"], json!(true));
    assert_eq!(wire["elements"][0]["faces"]["north"]["uv"], json!([8.0, 4.0, 4.0, 8.0]));
    assert_eq!(wire["elements"][0]["faces"]["east"]["uv"], json!([12.0, 4.0, 8.0, 8.0]));
    assert_eq!(wire["elements"][0]["from"], json!([0.0, 0.0, 0.0]));
    assert_eq!(wire["elements"][0]["to"], json!([4.0, 4.0, 4.0]));
    let saved = session.document().clone();
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    session.apply(4, &[
        EditOperation::SetCubeStretch { uuid: CUBE.into(), stretch: [1.0; 3] },
        EditOperation::SetCubeMirrorUv { uuid: CUBE.into(), mirrored: false },
    ]).unwrap();
    let reset: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert!(reset["elements"][0].get("stretch").is_none());
    assert!(reset["elements"][0].get("mirror_uv").is_none());
    assert_eq!(session.document().cubes[0].faces, original_faces);
}

#[test]
fn unsafe_stretch_and_box_uv_modes_refuse_without_partial_writes() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let initial = session.document().clone();
    for bad in [[1.0, 0.0, 1.0], [-1.0, 1.0, 1.0], [101.0, 1.0, 1.0],
                [f64::INFINITY, 1.0, 1.0], [f64::NAN, 1.0, 1.0]] {
        assert_eq!(session.apply(0, &[
            EditOperation::RenameNode { uuid: CUBE.into(), name: "temporary".into() },
            EditOperation::SetCubeStretch { uuid: CUBE.into(), stretch: bad },
        ]).unwrap_err(), "CUBE_STRETCH_INVALID");
    }
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeStretch { uuid: CUBE.into(), stretch: [1.0; 3] },
    ]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeMirrorUv { uuid: CUBE.into(), mirrored: true },
    ]).unwrap_err(), "CUBE_MIRROR_BOX_UV_REQUIRED");
    let mut invalid = initial.clone();
    invalid.meta.box_uv = Some(true);
    invalid.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
    let mut unsupported = EditorSession::from_document(invalid.clone()).unwrap();
    assert_eq!(unsupported.apply(0, &[
        EditOperation::SetCubeMirrorUv { uuid: CUBE.into(), mirrored: true },
    ]).unwrap_err(), "CUBE_MIRROR_UV_RULESET_UNSUPPORTED");
    assert_eq!(unsupported.document(), &invalid);
    assert_eq!(session.document(), &initial);
    assert_eq!(session.summary().revision, 0);
    let mut malformed: Value = serde_json::from_str(SAMPLE).unwrap();
    malformed["elements"][0]["mirror_uv"] = json!("true");
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&malformed).unwrap()).unwrap_err(), "CUBE_MIRROR_UV_FLAG_INVALID");
}

// Authored-only Rust/Paint regressions (not executed).
#[test]
fn region_fill_is_four_connected_and_one_undoable_rgba8_transaction() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Region", "region").unwrap()).unwrap();
    let texture_id = "00000000-0000-4000-8000-000000009801";
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 4, height: 4 },
        EditOperation::CreatePaintTexture { uuid: texture_id.into(), name: "atlas".into() },
    ]).unwrap();
    session.apply(1, &[
        EditOperation::PaintTextureRectangle { texture_index: 0,
            from: [1, 0], to: [1, 3], rgba: [255, 0, 0, 255], erase: false },
    ]).unwrap();
    let before = session.document().clone();
    let receipt = session.apply(2, &[
        EditOperation::PaintTextureFill { texture_index: 0, at: [0, 0],
            rgba: [0, 0, 255, 255], erase: false },
    ]).unwrap();
    assert_eq!(receipt.operation_count, 1);
    assert_eq!(receipt.revision, 3);
    let saved = session.document().clone();
    let pixels = paint::decode_for_uv_inspection(&saved.texture_assets[0], 4, 4).unwrap();
    for y in 0..4_usize {
        for x in 0..4_usize {
            let i = (y * 4 + x) * 4;
            let expected = match x {
                0 => [0, 0, 255, 255],
                1 => [255, 0, 0, 255],
                _ => [0, 0, 0, 0],
            };
            assert_eq!(&pixels[i..i + 4], &expected);
        }
    }
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, saved);
    session.undo(3).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(4).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(5, &[
        EditOperation::PaintTextureFill { texture_index: 0, at: [0, 0],
            rgba: [0, 0, 255, 255], erase: false },
    ]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &saved);
}

#[test]
fn region_fill_out_of_bounds_and_unsupported_source_refuse_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Region", "region").unwrap()).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000009802".into(), name: "atlas".into(),
    }]).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTexturePixel { texture_index: 0, x: 0, y: 0, rgba: [1, 2, 3, 255] },
        EditOperation::PaintTextureFill { texture_index: 0, at: [128, 0],
            rgba: [0, 0, 0, 255], erase: false },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original_import = imported.document().clone();
    assert_eq!(imported.apply(0, &[
        EditOperation::PaintTextureFill { texture_index: 0, at: [0, 0],
            rgba: [1, 2, 3, 255], erase: false },
    ]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &original_import);
}

// Authored-only Rust regressions (Cargo/Windows/Blockbench held).
#[test]
fn authoring_rig_pivots_and_cube_inflate_roundtrip_and_undo() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::SetBoneOrigin { uuid: BONE.into(), origin: [2.0, 4.0, -1.0] },
        EditOperation::SetCubeOrigin { uuid: CUBE.into(), origin: [1.0, 2.0, 3.0] },
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: 0.125 },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.changed_uuids, vec![BONE.to_owned(), CUBE.to_owned()]);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["groups"][0]["origin"], json!([2.0, 4.0, -1.0]));
    assert_eq!(saved["elements"][0]["origin"], json!([1.0, 2.0, 3.0]));
    assert_eq!(saved["elements"][0]["inflate"], json!(0.125));
    assert_eq!(saved["elements"][0]["from"], json!([0.0, 0.0, 0.0]));
    assert_eq!(saved["elements"][0]["to"], json!([4.0, 4.0, 4.0]));
    assert_eq!(saved["elements"][0]["faces"], serde_json::to_value(&original.cubes[0].faces).unwrap());
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn pivot_and_inflate_invalid_batches_refuse_without_mutating() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::SetBoneOrigin { uuid: BONE.into(), origin: [1.0, 2.0, 3.0] },
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: -2.0 },
    ]).unwrap_err(), "CUBE_INFLATE_DEGENERATE");
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeOrigin { uuid: CUBE.into(), origin: [f64::NAN, 0.0, 0.0] },
    ]).unwrap_err(), "CUBE_ORIGIN_INVALID");
    assert_eq!(session.apply(0, &[
        EditOperation::SetBoneOrigin { uuid: BONE.into(), origin: [f64::INFINITY, 0.0, 0.0] },
    ]).unwrap_err(), "BONE_ORIGIN_INVALID");
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: f64::NAN },
    ]).unwrap_err(), "CUBE_INFLATE_INVALID");
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeInflate { uuid: "unknown".into(), inflate: 1.0 },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.apply(0, &[
        EditOperation::SetBoneOrigin { uuid: BONE.into(), origin: [0.0, 0.0, 0.0] },
    ]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert!(!session.can_undo());
}

// Authored regression only. Tests remain held and are NOT_EXECUTED.
#[test]
fn generated_paint_texture_limit_matches_import_preview_and_history() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Paint limit", "paint_limit").unwrap()
    ).unwrap();
    assert!(can_add_paint_texture(session.document()));
    let operations: Vec<EditOperation> = (0..MAX_PAINT_TEXTURES).map(|index|
        EditOperation::CreatePaintTexture {
            uuid: format!("00000000-0000-4000-8000-{:012x}", 500 + index),
            name: format!("paint-{index}.png"),
        }
    ).collect();
    let receipt = session.apply(0, &operations).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().texture_assets.len(), MAX_PAINT_TEXTURES);
    assert!(!can_add_paint_texture(session.document()));
    let created = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000600".into(),
        name: "overflow.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_COUNT_LIMIT");
    assert_eq!(session.document(), &created);
    assert_eq!(session.summary().revision, 1);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        created);
    session.undo(1).unwrap();
    assert_eq!(session.document().texture_assets.len(), 0);
    assert!(can_add_paint_texture(session.document()));
    session.redo(2).unwrap();
    assert_eq!(session.document(), &created);
    assert!(!can_add_paint_texture(session.document()));
}

#[test]
fn generated_and_imported_paint_refuse_unsupported_uv_rules_and_id_conflicts() {
    let mut with_rules = AuthoringDocument::new_bedrock("Rules", "rules").unwrap();
    with_rules.extensions.insert("per_texture_uv_size".into(), json!(true));
    let mut session = EditorSession::from_document(with_rules.clone()).unwrap();
    let id = "00000000-0000-4000-8000-000000000700";
    assert!(!can_add_paint_texture(session.document()));
    assert_eq!(session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "generated.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
        uuid: id.into(), name: "imported.png".into(), source: "not-an-image".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &with_rules);
    assert_eq!(session.summary().revision, 0);

    let mut with_cube = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = with_cube.document().clone();
    assert_eq!(with_cube.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: CUBE.into(), name: "duplicate-identity.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_ID_INVALID");
    assert_eq!(with_cube.document(), &before);
}

// Source-authored regression only: local/native execution remains held.
#[test]
fn rust_png_export_is_byte_exact_read_only_and_follows_undo_redo() {
    let id = "00000000-0000-4000-8000-000000000810";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Export", "export").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "atlas.png".into(),
    }]).unwrap();
    let source = session.document().texture_assets[0]["source"].as_str().unwrap();
    let original = base64::Engine::decode(&base64::engine::general_purpose::STANDARD,
        source.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
    let before = session.document().clone();
    assert!(paint_texture_exportable(session.document(), 0));
    assert_eq!(export_paint_png(session.document(), id).unwrap(), original);
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 2, y: 3, rgba: [8, 17, 31, 255],
    }]).unwrap();
    let painted = export_paint_png(session.document(), id).unwrap();
    assert_ne!(painted, original);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(export_paint_png(&reopened, id).unwrap(), painted);
    session.undo(2).unwrap();
    assert_eq!(export_paint_png(session.document(), id).unwrap(), original);
    session.redo(3).unwrap();
    assert_eq!(export_paint_png(session.document(), id).unwrap(), painted);
}

#[test]
fn rust_png_export_rejects_opaque_invalid_and_per_texture_uv_assets() {
    let id = "00000000-0000-4000-8000-000000000811";
    let mut generator = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Export", "export").unwrap()
    ).unwrap();
    generator.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "atlas.png".into(),
    }]).unwrap();
    let original = export_paint_png(generator.document(), id).unwrap();
    let mut imported = generator.document().clone();
    imported.texture_assets[0].as_object_mut().unwrap().remove("paint_owner");
    assert!(paint_texture_exportable(&imported, 0));
    assert_eq!(export_paint_png(&imported, id).unwrap(), original);
    imported.texture_assets[0]["layers"] = json!([{"name":"preserved"}]);
    let opaque = EditorSession::from_document(imported).unwrap();
    assert!(!paint_texture_exportable(opaque.document(), 0));
    assert_eq!(export_paint_png(opaque.document(), id).unwrap_err(),
        "PAINT_EXPORT_TEXTURE_UNSUPPORTED");
    assert_eq!(export_paint_png(opaque.document(), "missing").unwrap_err(),
        "PAINT_TEXTURE_NOT_FOUND");
    let mut bad = generator.document().clone();
    bad.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
    let bad = EditorSession::from_document(bad).unwrap();
    assert!(paint_texture_exportable(bad.document(), 0));
    assert!(export_paint_png(bad.document(), id).is_err());
    let mut rules = generator.document().clone();
    rules.extensions.insert("per_texture_uv_size".into(), json!(true));
    assert!(!paint_texture_exportable(&rules, 0));
    assert_eq!(export_paint_png(&rules, id).unwrap_err(),
        "PAINT_TEXTURE_RULESET_UNSUPPORTED");
}

// SOURCE_AUTHORED_NOT_RUN: a single Bone operation owns descendant Cube
// Geometry, pivots and source UV/Texture/Animation preservation.
#[test]
fn bone_subtree_move_translates_only_nested_rig_and_retains_opaque_assets() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    const OTHER_BONE: &str = "00000000-0000-4000-8000-000000009891";
    const OTHER_CUBE: &str = "00000000-0000-4000-8000-000000009892";
    session.apply(0, &[
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({
                "uuid": OTHER_BONE, "name": "unrelated", "origin": [10, 0, 0]
            })).unwrap(),
            parent_uuid: None,
        },
        EditOperation::AddCube {
            cube: sample_cube(OTHER_CUBE), bone_uuid: OTHER_BONE.into(),
        },
    ]).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(1, &[EditOperation::TranslateBoneSubtree {
        uuid: BONE.into(), delta: [2.0, 3.0, -1.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    assert_eq!(receipt.changed_uuids, vec![BONE.to_owned()]);
    let saved = session.document().clone();
    let root = saved.bones.iter().find(|bone| bone.uuid == BONE).unwrap();
    let child = saved.bones.iter().find(|bone|
        bone.uuid == "00000000-0000-4000-8000-000000000003").unwrap();
    assert_eq!(root.origin, Some([2.0, 3.0, -1.0]));
    assert_eq!(child.origin, Some([2.0, 5.0, -1.0]));
    assert_eq!(saved.cubes[0].from, [2.0, 3.0, -1.0]);
    assert_eq!(saved.cubes[0].to, [6.0, 7.0, 3.0]);
    assert_eq!(saved.cubes[0].origin, Some([2.0, 3.0, -1.0]));
    assert_eq!(saved.cubes[0].faces, original.cubes[0].faces);
    assert_eq!(saved.cubes[0].extra, original.cubes[0].extra);
    assert_eq!(saved.cubes[1], original.cubes[1]);
    assert_eq!(saved.bones[2], original.bones[2]);
    assert_eq!(saved.hierarchy, original.hierarchy);
    assert_eq!(saved.texture_assets, original.texture_assets);
    assert_eq!(saved.animation_assets, original.animation_assets);
    assert_eq!(saved.extensions, original.extensions);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(4, &[EditOperation::TranslateBoneSubtree {
        uuid: BONE.into(), delta: [0.0, 0.0, 0.0],
    }]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn bone_subtree_move_refuses_unsafe_child_uv_and_rolls_back_all_changes() {
    let mut source: Value = serde_json::from_str(TEXTURED).unwrap();
    source["elements"][0]["autouv"] = json!(1);
    source["meta"]["per_texture_uv_size"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&source).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::TranslateBoneSubtree {
        uuid: BONE.into(), delta: [3.0, 0.0, 0.0],
    }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.apply(0, &[
        // This first edit would be valid on its own; the rejected subtree
        // move must still revert its Inflate change in the same transaction.
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: 0.25 },
        EditOperation::TranslateBoneSubtree {
            uuid: BONE.into(), delta: [1.0, 0.0, 0.0],
        },
    ]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.apply(0, &[EditOperation::TranslateBoneSubtree {
        uuid: BONE.into(), delta: [f64::NAN, 0.0, 0.0],
    }]).unwrap_err(), "BONE_SUBTREE_DELTA_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::TranslateBoneSubtree {
        uuid: "unknown".into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap_err(), "BONE_SUBTREE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert!(!session.can_undo());
}

// SOURCE_AUTHORED_NOT_RUN: guard selected face Paint against other users of
// the same PNG pixel rectangle, while retaining explicit legacy shared Paint.
#[test]
fn guarded_cube_face_paint_refuses_cross_cube_alias_and_preserves_undo() {
    const TEX: &str = "00000000-0000-4000-8000-000000009994";
    const DUP: &str = "00000000-0000-4000-8000-000000009995";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Guarded", "guarded").unwrap()).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({
                "uuid":BONE, "name":"root", "origin":[0,0,0]
            })).unwrap(), parent_uuid: None,
        },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::CreatePaintTexture { uuid: TEX.into(), name: "atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEX.into() },
    ]).unwrap();
    let blank = session.document().clone();
    let patch = CubeFacePaintPatch { face: "north".into(),
        rgba: [40, 60, 200, 255], erase: false };
    session.apply(1, &[EditOperation::PaintCubeUvFacesGuarded {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(),
        faces: vec![patch.clone()],
    }]).unwrap();
    let painted = session.document().clone();
    let pixels = paint::decode_for_uv_inspection(&painted.texture_assets[0], 32, 32).unwrap();
    let offset = ((5 * 32 + 5) * 4) as usize;
    assert_eq!(&pixels[offset..offset + 4], &[40, 60, 200, 255]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        painted);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &blank);
    session.apply(3, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: DUP.into(),
    }]).unwrap();
    let cloned = session.document().clone();
    assert_eq!(session.apply(4, &[
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: 0.25 },
        EditOperation::PaintCubeUvFacesGuarded {
            cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces: vec![patch.clone()],
        },
    ]).unwrap_err(), "PAINT_CUBE_UV_GUARD_SHARED");
    assert_eq!(session.document(), &cloned);
    assert_eq!(session.summary().revision, 4);
    session.apply(4, &[EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces: vec![patch],
    }]).unwrap();
    assert_eq!(session.document().cubes, cloned.cubes);
}

#[test]
fn guarded_cube_face_paint_rejects_implicit_and_unknown_uv_mappings() {
    const TEX: &str = "00000000-0000-4000-8000-000000009996";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture { uuid: TEX.into(), name: "atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEX.into() },
    ]).unwrap();
    let mut doc = session.document().clone();
    doc.cubes[0].faces.get_mut("east").unwrap().as_object_mut()
        .unwrap().remove("texture");
    let patch = CubeFacePaintPatch { face: "north".into(),
        rgba: [10, 20, 30, 255], erase: false };
    let paint = |patch: CubeFacePaintPatch| EditOperation::PaintCubeUvFacesGuarded {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces: vec![patch],
    };
    let mut ambiguous = EditorSession::from_document(doc.clone()).unwrap();
    assert_eq!(ambiguous.apply(0, &[paint(patch.clone())]).unwrap_err(),
        "PAINT_CUBE_UV_GUARD_UNRESOLVED");
    assert_eq!(ambiguous.document(), &doc);
    doc.cubes[0].faces.get_mut("east").unwrap()["texture"] = json!(TEX);
    doc.cubes[0].faces.get_mut("east").unwrap()["uv"] = json!([0.25,0.0,4.0,4.0]);
    let mut invalid = EditorSession::from_document(doc.clone()).unwrap();
    assert_eq!(invalid.apply(0, &[paint(patch.clone())]).unwrap_err(),
        "PAINT_CUBE_UV_GUARD_UNRESOLVED");
    assert_eq!(invalid.document(), &doc);
    doc.meta.box_uv = Some(true);
    doc.meta.extra.insert("box_uv_float_size".into(), json!(true));
    let mut float_uv = EditorSession::from_document(doc.clone()).unwrap();
    assert_eq!(float_uv.apply(0, &[paint(patch)]).unwrap_err(),
        "PAINT_CUBE_UV_GUARD_UNRESOLVED");
    assert_eq!(float_uv.document(), &doc);
    assert_eq!(session.document().texture_assets, doc.texture_assets);
}


// SOURCE_AUTHORED_NOT_RUN: clone a nested textured/animated Bedrock rig
// and translate it in one Rust Undo transaction.
#[test]
fn duplicate_bone_subtree_preserves_nested_outliner_texture_and_source_animation() {
    const CLONE: &str = "00000000-0000-4000-8000-000000008901";
    const CHILD: &str = "00000000-0000-4000-8000-000000000003";
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::DuplicateBoneSubtree {
            source_uuid: BONE.into(), new_uuid: CLONE.into(),
            name_suffix: "_copy".into(),
        },
        EditOperation::TranslateBoneSubtree {
            uuid: CLONE.into(), delta: [8.0, 0.0, 0.0],
        },
    ]).unwrap();
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(receipt.changed_uuids, vec![CLONE.to_owned()]);
    let saved = session.document().clone();
    assert_eq!(saved.cubes.len(), original.cubes.len() + 1);
    assert_eq!(saved.bones.len(), original.bones.len() + 2);
    assert_eq!(saved.hierarchy.len(), 2);
    assert_eq!(saved.hierarchy[0], original.hierarchy[0]);
    assert_eq!(saved.cubes[0], original.cubes[0]);
    assert_eq!(saved.bones[0], original.bones[0]);
    assert_eq!(saved.bones[1], original.bones[1]);
    assert_eq!(saved.texture_assets, original.texture_assets);
    assert_eq!(saved.animation_assets, original.animation_assets);
    assert_eq!(saved.extensions, original.extensions);

    let OutlinerNode::Bone(copied_root) = &saved.hierarchy[1] else {
        panic!("duplicated root must remain a Bone");
    };
    assert_eq!(copied_root.uuid, CLONE);
    assert_eq!(copied_root.is_open, Some(true));
    let OutlinerNode::Bone(copied_child) = &copied_root.children[0] else {
        panic!("nested Bone must be preserved");
    };
    assert_ne!(copied_child.uuid, CHILD);
    assert_eq!(copied_child.uuid.len(), 36);
    let OutlinerNode::Cube(copied_cube_id) = &copied_child.children[0] else {
        panic!("nested Cube must be preserved");
    };
    assert_ne!(copied_cube_id, CUBE);
    let bone = saved.bones.iter().find(|b| b.uuid == copied_root.uuid).unwrap();
    let nested = saved.bones.iter().find(|b| b.uuid == copied_child.uuid).unwrap();
    assert_eq!(bone.name, "root_bone_copy");
    assert_eq!(nested.name, "child_bone_copy");
    assert_eq!(bone.origin, Some([8.0, 0.0, 0.0]));
    assert_eq!(nested.origin, Some([8.0, 2.0, 0.0]));
    let copied_cube = saved.cubes.iter().find(|c| &c.uuid == copied_cube_id).unwrap();
    assert_eq!(copied_cube.from, [8.0, 0.0, 0.0]);
    assert_eq!(copied_cube.faces, original.cubes[0].faces);
    assert_eq!(copied_cube.extra, original.cubes[0].extra);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &saved);

    // The same root UUID seed gives byte-identical descendant IDs.
    let mut repeated = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    repeated.apply(0, &[
        EditOperation::DuplicateBoneSubtree {
            source_uuid: BONE.into(), new_uuid: CLONE.into(),
            name_suffix: "_copy".into(),
        },
        EditOperation::TranslateBoneSubtree {
            uuid: CLONE.into(), delta: [8.0, 0.0, 0.0],
        },
    ]).unwrap();
    assert_eq!(repeated.export().unwrap(), session.export().unwrap());
}

#[test]
fn duplicate_bone_subtree_refuses_name_id_bad_suffix_and_source_links_atomically() {
    const CLONE: &str = "00000000-0000-4000-8000-000000008911";
    const SECOND: &str = "00000000-0000-4000-8000-000000008912";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let make = |source: &str, id: &str, suffix: &str| {
        EditOperation::DuplicateBoneSubtree {
            source_uuid: source.into(), new_uuid: id.into(),
            name_suffix: suffix.into(),
        }
    };
    for (source, id, suffix, error) in [
        (BONE, BONE, "_copy", "BONE_DUPLICATE_ID_CONFLICT"),
        (BONE, CUBE, "_copy", "BONE_DUPLICATE_ID_CONFLICT"),
        ("missing", CLONE, "_copy", "BONE_NOT_FOUND"),
        (BONE, CLONE, "", "BONE_DUPLICATE_SUFFIX_INVALID"),
        (BONE, CLONE, " copy", "BONE_DUPLICATE_SUFFIX_INVALID"),
        (BONE, CLONE, "_bad?", "BONE_DUPLICATE_SUFFIX_INVALID"),
    ] {
        assert_eq!(session.apply(0, &[make(source,id,suffix)]).unwrap_err(), error);
        assert_eq!(session.document(), &original);
    }
    session.apply(0, &[make(BONE,CLONE,"_copy")]).unwrap();
    let copied = session.document().clone();
    assert_eq!(session.apply(1, &[make(BONE,SECOND,"_copy")]).unwrap_err(),
        "BONE_DUPLICATE_NAME_CONFLICT");
    assert_eq!(session.document(), &copied);

    let mut linked = original.clone();
    linked.bones[0].extra.insert("vendor_ref".into(), json!({"target":BONE}));
    let mut unsafe_session = EditorSession::from_document(linked.clone()).unwrap();
    assert_eq!(unsafe_session.apply(0, &[
        EditOperation::SetCubeInflate { uuid:CUBE.into(), inflate:0.25 },
        make(BONE,CLONE,"_copy"),
    ]).unwrap_err(), "BONE_DUPLICATE_OPAQUE_REFERENCE_UNSUPPORTED");
    assert_eq!(unsafe_session.document(), &linked);
    assert_eq!(unsafe_session.summary().revision, 0);
    assert!(!unsafe_session.can_undo());

    let mut face_link = original.clone();
    face_link.cubes[0].faces["north"]["vendor_link"] = json!(BONE);
    let mut unsafe_face = EditorSession::from_document(face_link.clone()).unwrap();
    assert_eq!(unsafe_face.apply(0, &[make(BONE,CLONE,"_copy")]).unwrap_err(),
        "BONE_DUPLICATE_OPAQUE_REFERENCE_UNSUPPORTED");
    assert_eq!(unsafe_face.document(), &face_link);
}

#[test]
fn duplicate_bone_subtree_remains_editable_in_bedrock_geometry_export() {
    const CLONE: &str = "00000000-0000-4000-8000-000000008921";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[EditOperation::DuplicateBoneSubtree {
        source_uuid:BONE.into(), new_uuid:CLONE.into(),
        name_suffix:"_right".into(),
    }]).unwrap();
    let geometry: Value = serde_json::from_slice(
        &export_bedrock_geometry(session.document()).unwrap()).unwrap();
    let bones = geometry["minecraft:geometry"][0]["bones"].as_array().unwrap();
    assert_eq!(bones.len(), 2);
    assert_eq!(bones[0]["name"], json!("root_bone"));
    assert_eq!(bones[1]["name"], json!("root_bone_right"));
    assert_eq!(bones[0]["cubes"], bones[1]["cubes"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}


// SOURCE_AUTHORED_NOT_RUN: one approved Rust batch authors a mirrored rig
// from a nested, textured and already animated original without changing it.
#[test]
fn reflect_bone_subtree_preserves_original_rig_and_opaque_animation() {
    const CLONE: &str = "00000000-0000-4000-8000-000000008931";
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::DuplicateBoneSubtree {
            source_uuid:BONE.into(), new_uuid:CLONE.into(), name_suffix:"_right".into(),
        },
        EditOperation::ReflectBoneSubtree {
            uuid:CLONE.into(), axis:"x".into(), center:8.0, uv_policy:"preserve".into(),
        },
    ]).unwrap();
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(receipt.changed_uuids, vec![CLONE.to_owned()]);
    let saved = session.document().clone();
    assert_eq!(saved.hierarchy.len(), 2);
    assert_eq!(saved.hierarchy[0], original.hierarchy[0]);
    assert_eq!(saved.cubes[0], original.cubes[0]);
    assert_eq!(&saved.bones[..2], original.bones.as_slice());
    assert_eq!(saved.texture_assets, original.texture_assets);
    assert_eq!(saved.animation_assets, original.animation_assets);
    assert_eq!(saved.extensions, original.extensions);

    let OutlinerNode::Bone(root) = &saved.hierarchy[1] else { panic!("missing cloned root") };
    assert_eq!(root.uuid, CLONE);
    let OutlinerNode::Bone(child) = &root.children[0] else { panic!("missing child") };
    let OutlinerNode::Cube(cube_id) = &child.children[0] else { panic!("missing Cube") };
    let clone_cube = saved.cubes.iter().find(|cube| &cube.uuid == cube_id).unwrap();
    assert_eq!(clone_cube.from, [12.0, 0.0, 0.0]);
    assert_eq!(clone_cube.to, [16.0, 4.0, 4.0]);
    assert_eq!(clone_cube.origin, Some([16.0, 0.0, 0.0]));
    assert_eq!(clone_cube.faces, original.cubes[0].faces);
    assert_eq!(clone_cube.extra, original.cubes[0].extra);
    let root_bone = saved.bones.iter().find(|bone| bone.uuid == root.uuid).unwrap();
    let child_bone = saved.bones.iter().find(|bone| bone.uuid == child.uuid).unwrap();
    assert_eq!(root_bone.origin, Some([16.0, 0.0, 0.0]));
    assert_eq!(child_bone.origin, Some([16.0, 2.0, 0.0]));
    assert_eq!(child_bone.extra["rotation"], json!([0.0, -15.0, 0.0]));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &saved);
}

#[test]
fn reflect_bone_subtree_mirrors_manual_rotated_face_uv_without_touching_png() {
    const CLONE: &str = "00000000-0000-4000-8000-000000008932";
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let before = session.document().clone();
    session.apply(0, &[
        EditOperation::DuplicateBoneSubtree {
            source_uuid:BONE.into(), new_uuid:CLONE.into(), name_suffix:"_uvmirror".into(),
        },
        EditOperation::ReflectBoneSubtree {
            uuid:CLONE.into(), axis:"x".into(), center:8.0, uv_policy:"mirror".into(),
        },
    ]).unwrap();
    let cloned = session.document().cubes.last().unwrap();
    // The original north face is quarter-turned: mirroring X flips V.
    assert_eq!(cloned.faces["north"]["uv"], json!([1.0, 6.0, 5.0, 2.0]));
    assert_eq!(cloned.faces["north"]["custom"], before.cubes[0].faces["north"]["custom"]);
    // East/west face ownership swaps, then U coordinates reverse.
    assert_eq!(cloned.faces["east"]["uv"], json!([13.0, 2.0, 9.0, 6.0]));
    assert_eq!(cloned.faces["west"]["uv"], json!([9.0, 2.0, 5.0, 6.0]));
    assert_eq!(session.document().texture_assets, before.texture_assets);
    assert_eq!(session.document().cubes[0], before.cubes[0]);
    assert_eq!(session.document().animation_assets, before.animation_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn reflect_bone_subtree_box_uv_x_switches_mirror_flag_and_preserves_export() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Box Mirror", "box_mirror").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({
                "uuid":BONE, "name":"body", "origin":[0,0,0]
            })).unwrap(), parent_uuid:None,
        },
        EditOperation::AddCube { cube:sample_cube(CUBE), bone_uuid:BONE.into() },
    ]).unwrap();
    let before = session.document().clone();
    session.apply(1, &[EditOperation::ReflectBoneSubtree {
        uuid:BONE.into(), axis:"x".into(), center:8.0, uv_policy:"mirror".into(),
    }]).unwrap();
    let reflected = session.document().clone();
    assert_eq!(reflected.cubes[0].from, [12.0, 0.0, 0.0]);
    assert_eq!(reflected.cubes[0].to, [16.0, 4.0, 4.0]);
    assert_eq!(reflected.cubes[0].extra["mirror_uv"], json!(true));
    assert_eq!(reflected.texture_assets, before.texture_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        reflected);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &reflected);
    // Reversing the same supported mirror restores the original shape/UV.
    session.apply(4, &[EditOperation::ReflectBoneSubtree {
        uuid:BONE.into(), axis:"x".into(), center:8.0, uv_policy:"mirror".into(),
    }]).unwrap();
    assert_eq!(session.document(), &before);
}

#[test]
fn reflect_bone_subtree_refuses_unsafe_modes_ancestors_and_bound_animation() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let op = |uuid:&str, axis:&str, center:f64, uv:&str| EditOperation::ReflectBoneSubtree {
        uuid:uuid.into(), axis:axis.into(), center, uv_policy:uv.into(),
    };
    for (uuid, axis, center, uv, code) in [
        (BONE, "unknown", 0.0, "preserve", "BONE_REFLECT_AXIS_INVALID"),
        (BONE, "x", f64::NAN, "preserve", "BONE_REFLECT_CENTER_INVALID"),
        (BONE, "x", 0.0, "rotate", "BONE_REFLECT_UV_POLICY_INVALID"),
        ("missing", "x", 0.0, "preserve", "BONE_REFLECT_NOT_FOUND"),
        (BONE, "x", 100_000.0, "preserve", "BONE_REFLECT_COORDINATE_INVALID"),
    ] {
        assert_eq!(session.apply(0, &[op(uuid,axis,center,uv)]).unwrap_err(), code);
        assert_eq!(session.document(), &original);
    }
    // Source-owned Box UV cannot express vertical mirror with one saved flag.
    let mut boxed = AuthoringDocument::new_bedrock("Restricted", "restricted").unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid":BONE, "name":"root", "origin":[0,0,0]
    })).unwrap();
    let mut b = EditorSession::from_document(boxed.clone()).unwrap();
    b.apply(0, &[
        EditOperation::AddBone {bone, parent_uuid:None},
        EditOperation::AddCube {cube:sample_cube(CUBE), bone_uuid:BONE.into()},
    ]).unwrap();
    boxed = b.document().clone();
    assert_eq!(b.apply(1, &[
        EditOperation::SetCubeInflate {uuid:CUBE.into(), inflate:0.25},
        op(BONE, "y", 1.0, "mirror"),
    ]).unwrap_err(), "BONE_REFLECT_BOX_UV_AXIS_UNSUPPORTED");
    assert_eq!(b.document(), &boxed);
    assert_eq!(b.summary().revision, 1);

    let mut animated = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let imported = animated.document().clone();
    assert_eq!(animated.apply(0, &[op(BONE,"x",8.0,"preserve")]).unwrap_err(),
        "BONE_REFLECT_ANIMATION_BOUND");
    assert_eq!(animated.document(), &imported);

    let mut auto = original.clone();
    auto.cubes[0].extra.insert("autouv".into(), json!(2));
    let mut auto_session = EditorSession::from_document(auto.clone()).unwrap();
    assert_eq!(auto_session.apply(0, &[op(BONE,"x",8.0,"preserve")]).unwrap_err(),
        "BONE_REFLECT_AUTO_UV_UNSUPPORTED");
    assert_eq!(auto_session.document(), &auto);

    let mut parent = imported.clone();
    parent.animation_assets.clear();
    parent.bones[0].extra.insert("rotation".into(), json!([0,30,0]));
    let mut parent_session = EditorSession::from_document(parent.clone()).unwrap();
    assert_eq!(parent_session.apply(0, &[op(
        "00000000-0000-4000-8000-000000000003", "x", 8.0, "preserve"
    )]).unwrap_err(), "BONE_REFLECT_PARENT_UNSUPPORTED");
    assert_eq!(parent_session.document(), &parent);

    let mut cull = original.clone();
    cull.cubes[0].faces["north"]["cullface"] = json!("north");
    let mut cull_session = EditorSession::from_document(cull.clone()).unwrap();
    assert_eq!(cull_session.apply(0, &[
        EditOperation::SetCubeInflate {uuid:CUBE.into(), inflate:0.25},
        op(BONE,"x",8.0,"mirror"),
    ]).unwrap_err(), "BONE_REFLECT_FACE_RULE_UNSUPPORTED");
    assert_eq!(cull_session.document(), &cull);
    assert_eq!(cull_session.summary().revision, 0);
    assert!(!cull_session.can_undo());
}



// SOURCE_AUTHORED_NOT_RUN: exact RGB swatches preserve painted material
// structure and per-pixel alpha. No flat face overwrite or inferred color.
#[test]
fn recolor_cube_palette_preserves_shading_alpha_unselected_faces_and_undo() {
    const TEX: &str = "00000000-0000-4000-8000-000000009951";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Armor Palette", "armor_palette").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width:32, height:32 },
        EditOperation::AddBone { bone:serde_json::from_value(json!({
            "uuid":BONE, "name":"armor", "origin":[0,0,0]
        })).unwrap(), parent_uuid:None },
        EditOperation::AddCube { cube:sample_cube(CUBE), bone_uuid:BONE.into() },
        EditOperation::CreatePaintTexture { uuid:TEX.into(), name:"armor.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid:CUBE.into(), texture_uuid:TEX.into() },
    ]).unwrap();
    session.apply(1, &[EditOperation::PaintCubeUvFaces {
        cube_uuid:CUBE.into(), texture_uuid:TEX.into(),
        faces:["north","east","south"].iter().map(|face| CubeFacePaintPatch {
            face:(*face).into(), rgba:[80,60,40,255], erase:false,
        }).collect(),
    }]).unwrap();
    session.apply(2, &[EditOperation::PaintCubeFaceRegionsGuarded {
        cube_uuid:CUBE.into(), texture_uuid:TEX.into(),
        regions:vec![CubeFaceRegionPaintPatch {
            face:"north".into(), from:[0,0],to:[4,1],
            rgba:[130,100,70,255],erase:false,
        }],
    }]).unwrap();
    session.apply(3, &[
        // Semi-transparent painted base; new palette must retain alpha 120.
        EditOperation::PaintTexturePixel {
            texture_index:0,x:5,y:5,rgba:[80,60,40,120],
        },
        // Hidden RGB on a blank atlas pixel is deliberately preserved.
        EditOperation::PaintTexturePixel {
            texture_index:0,x:0,y:0,rgba:[80,60,40,0],
        },
    ]).unwrap();
    let original = session.document().clone();
    let operation = EditOperation::RecolorCubeFacesPaletteGuarded {
        texture_uuid:TEX.into(),
        targets:vec![CubePaletteTarget {
            cube_uuid:CUBE.into(),faces:vec!["north".into(),"east".into()],
        }],
        palette:vec![
            PaletteRgbSwap { from:[80,60,40], to:[25,95,175] },
            PaletteRgbSwap { from:[130,100,70], to:[50,165,220] },
        ],
    };
    let receipt = session.apply(4, &[operation.clone()]).unwrap();
    assert_eq!(receipt.revision, 5);
    assert_eq!(receipt.operation_count, 1);
    assert_eq!(receipt.changed_uuids, vec![TEX.to_owned()]);
    let saved = session.document().clone();
    let pixels = paint::decode_for_uv_inspection(&saved.texture_assets[0],32,32).unwrap();
    let color = |x:usize,y:usize| -> &[u8] {
        let i=(y*32+x)*4; &pixels[i..i+4]
    };
    // Box UV north begins [4,4], east [0,4], south [12,4].
    assert_eq!(color(5,4), &[50,165,220,255]); // highlight retained
    assert_eq!(color(5,5), &[25,95,175,120]);  // alpha retained
    assert_eq!(color(5,6), &[25,95,175,255]);  // authored base retained
    assert_eq!(color(1,5), &[25,95,175,255]);  // second selected face
    assert_eq!(color(13,5), &[80,60,40,255]);  // unselected face
    assert_eq!(color(0,0), &[80,60,40,0]);     // hidden RGB
    assert_eq!(color(22,22), &[0,0,0,0]);      // unrelated atlas pixel
    assert_eq!(saved.cubes, original.cubes);
    assert_eq!(saved.bones, original.bones);
    assert_eq!(saved.hierarchy, original.hierarchy);
    assert_eq!(saved.animation_assets, original.animation_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    session.undo(5).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(6).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(7, &[operation]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &saved);
}

#[test]
fn recolor_cube_palette_is_simultaneous_not_chained_and_can_span_cubes() {
    const TEX: &str = "00000000-0000-4000-8000-000000009961";
    const SECOND: &str = "00000000-0000-4000-8000-000000009962";
    let mut cube = sample_cube(SECOND);
    cube.uv_offset = Some([20.0,0.0]);
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Cohort","cohort").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution {width:64,height:32},
        EditOperation::AddBone {bone:serde_json::from_value(json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]
        })).unwrap(),parent_uuid:None},
        EditOperation::AddCube {cube:sample_cube(CUBE),bone_uuid:BONE.into()},
        EditOperation::AddCube {cube,bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"cohort.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
        EditOperation::AssignCubeTexture {cube_uuid:SECOND.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    session.apply(1, &[
        EditOperation::PaintCubeUvFaces {
            cube_uuid:CUBE.into(),texture_uuid:TEX.into(),
            faces:vec![
                CubeFacePaintPatch {face:"north".into(),rgba:[160,30,30,255],erase:false},
                CubeFacePaintPatch {face:"east".into(),rgba:[35,80,170,255],erase:false},
            ],
        },
        EditOperation::PaintCubeUvFaces {
            cube_uuid:SECOND.into(),texture_uuid:TEX.into(),
            faces:vec![CubeFacePaintPatch {
                face:"north".into(),rgba:[160,30,30,255],erase:false,
            }],
        },
    ]).unwrap();
    let old=session.document().clone();
    session.apply(2, &[EditOperation::RecolorCubeFacesPaletteGuarded {
        texture_uuid:TEX.into(),
        targets:vec![
            CubePaletteTarget {
                cube_uuid:CUBE.into(),faces:vec!["north".into(),"east".into()],
            },
            CubePaletteTarget {
                cube_uuid:SECOND.into(),faces:vec!["north".into()],
            },
        ],
        palette:vec![
            PaletteRgbSwap {from:[160,30,30],to:[35,80,170]},
            PaletteRgbSwap {from:[35,80,170],to:[40,180,75]},
        ],
    }]).unwrap();
    let saved=session.document().clone();
    let rgba=paint::decode_for_uv_inspection(&saved.texture_assets[0],64,32).unwrap();
    let at=|x:usize,y:usize| -> &[u8] {
        let i=(y*64+x)*4; &rgba[i..i+4]
    };
    assert_eq!(at(5,5), &[35,80,170,255]);  // A->B, not A->B->C
    assert_eq!(at(1,5), &[40,180,75,255]);  // B->C
    assert_eq!(at(25,5), &[35,80,170,255]); // second Cube, one PNG
    assert_eq!(at(10,5), &[0,0,0,0]);      // unselected west
    assert_eq!(saved.cubes,old.cubes);
    assert_eq!(saved.animation_assets,old.animation_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    session.undo(3).unwrap();
    assert_eq!(session.document(),&old);
    session.redo(4).unwrap();
    assert_eq!(session.document(),&saved);
}

#[test]
fn recolor_cube_palette_refuses_unsafe_targets_opaque_sources_and_aliases() {
    const TEX: &str = "00000000-0000-4000-8000-000000009971";
    const SECOND: &str = "00000000-0000-4000-8000-000000009972";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Palette Safety","palette_safety").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution {width:32,height:32},
        EditOperation::AddBone {bone:serde_json::from_value(json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]
        })).unwrap(),parent_uuid:None},
        EditOperation::AddCube {cube:sample_cube(CUBE),bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"atlas.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    let original=session.document().clone();
    let target=CubePaletteTarget {
        cube_uuid:CUBE.into(),faces:vec!["north".into()],
    };
    let swatch=PaletteRgbSwap {from:[80,60,40],to:[25,95,175]};
    let op=|targets:Vec<CubePaletteTarget>,palette:Vec<PaletteRgbSwap>| {
        EditOperation::RecolorCubeFacesPaletteGuarded {
            texture_uuid:TEX.into(),targets,palette,
        }
    };
    for (targets,palette,code) in [
        (vec![],vec![swatch.clone()],"PALETTE_TARGETS_SIZE_INVALID"),
        (vec![target.clone();17],vec![swatch.clone()],"PALETTE_TARGETS_SIZE_INVALID"),
        (vec![target.clone()],vec![],"PALETTE_SWAPS_SIZE_INVALID"),
        (vec![target.clone()],vec![swatch.clone();33],"PALETTE_SWAPS_SIZE_INVALID"),
        (vec![target.clone(),target.clone()],vec![swatch.clone()],
            "PALETTE_TARGET_CUBE_DUPLICATE"),
        (vec![CubePaletteTarget {cube_uuid:CUBE.into(),faces:vec![]}],
            vec![swatch.clone()],"PALETTE_TARGET_FACES_SIZE_INVALID"),
        (vec![CubePaletteTarget {cube_uuid:CUBE.into(),
            faces:vec!["north".into(),"north".into()]}],
            vec![swatch.clone()],"PALETTE_TARGET_FACE_UNKNOWN_OR_DUPLICATE"),
        (vec![CubePaletteTarget {cube_uuid:CUBE.into(),faces:vec!["diagonal".into()]}],
            vec![swatch.clone()],"PALETTE_TARGET_FACE_UNKNOWN_OR_DUPLICATE"),
        (vec![target.clone()],vec![swatch.clone(),swatch.clone()],
            "PALETTE_SWAPS_DUPLICATE_SOURCE"),
    ] {
        assert_eq!(session.apply(1,&[op(targets,palette)]).unwrap_err(), code);
        assert_eq!(session.document(),&original);
    }
    // An absent palette source changes nothing and must not re-encode PNG.
    assert_eq!(session.apply(1,&[op(vec![target.clone()],vec![swatch.clone()])])
        .unwrap_err(),"EDIT_NO_OP");
    assert_eq!(session.document(),&original);

    session.apply(1,&[EditOperation::DuplicateCube {
        source_uuid:CUBE.into(),new_uuid:SECOND.into(),
    }]).unwrap();
    let alias=session.document().clone();
    assert_eq!(session.apply(2,&[
        EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
        op(vec![target.clone()],vec![swatch.clone()]),
    ]).unwrap_err(),"PALETTE_UV_GUARD_SHARED");
    assert_eq!(session.document(),&alias);
    assert_eq!(session.summary().revision,2);

    let mut implicit=original.clone();
    implicit.cubes[0].faces["east"].as_object_mut().unwrap().remove("texture");
    let mut ambiguous=EditorSession::from_document(implicit.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[op(vec![target.clone()],vec![swatch.clone()])])
        .unwrap_err(),"PALETTE_UV_GUARD_UNRESOLVED");
    assert_eq!(ambiguous.document(),&implicit);

    let mut imported=original.clone();
    imported.texture_assets[0]["paint_owner"]=json!("foreign");
    let mut foreign=EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(foreign.apply(0,&[op(vec![target.clone()],vec![swatch.clone()])])
        .unwrap_err(),"PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(foreign.document(),&imported);

    let mut invalid=original.clone();
    invalid.texture_assets[0]["source"]=json!("data:image/png;base64,AAAA");
    let mut invalid_image=EditorSession::from_document(invalid.clone()).unwrap();
    assert!(invalid_image.apply(0,&[op(vec![target.clone()],vec![swatch.clone()])]).is_err());
    assert_eq!(invalid_image.document(),&invalid);

    let mut rules=original.clone();
    rules.meta.extra.insert("per_texture_uv_size".into(),json!(true));
    let mut multi=EditorSession::from_document(rules.clone()).unwrap();
    assert_eq!(multi.apply(0,&[op(vec![target.clone()],vec![swatch.clone()])])
        .unwrap_err(),"UV_SHARING_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(multi.document(),&rules);
}

// SOURCE-AUTHORED_NOT_RUN: local face pixel axes follow Blockbench's saved
// UV direction and quarter-turn permutation, not the atlas corner minimum.
#[test]
fn face_local_region_maps_rotated_and_reversed_uv_pixel_rectangles() {
    let uv = [1.0, 2.0, 5.0, 6.0];
    for (rotation, from, to) in [
        (0, [1, 2], [2, 4]),
        (90, [1, 5], [3, 6]),
        (180, [4, 4], [5, 6]),
        (270, [3, 2], [5, 3]),
    ] {
        assert_eq!(
            face_regions::face_local_pixel_rectangle(16, 16, uv, rotation,
                [0, 0], [1, 2]).unwrap(),
            (from, to)
        );
    }
    assert_eq!(
        face_regions::face_local_pixel_rectangle(
            16, 16, [8.0, 8.0, 4.0, 4.0], 0, [0, 0], [1, 1]).unwrap(),
        ([7, 7], [8, 8])
    );
    for (from, to) in [
        ([0, 0], [0, 1]),
        ([2, 2], [1, 3]),
        ([4, 0], [5, 1]),
        ([0, 0], [5, 1]),
    ] {
        assert_eq!(
            face_regions::face_local_pixel_rectangle(16,16,uv,0,from,to)
                .unwrap_err(),
            "PAINT_FACE_REGION_BOUNDS_INVALID",
        );
    }
    assert_eq!(face_regions::face_local_pixel_rectangle(
        16, 16, uv, 45, [0,0], [1,1]).unwrap_err(),
        "PAINT_FACE_REGION_ROTATION_UNSUPPORTED");
    assert_eq!(face_regions::face_local_pixel_rectangle(
        16, 16, [0.5,2.0,5.0,6.0], 0, [0,0], [1,1]).unwrap_err(),
        "PAINT_UV_RECT_NON_INTEGRAL");
}

#[test]
fn face_local_region_paints_ordered_shading_zones_across_box_uv_faces_in_one_undo() {
    const TEX: &str = "00000000-0000-4000-8000-000000009941";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Region Paint", "region_paint").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution {width:32,height:32},
        EditOperation::AddBone {
            bone:serde_json::from_value(json!({
                "uuid":BONE, "name":"body", "origin":[0,0,0]
            })).unwrap(), parent_uuid:None,
        },
        EditOperation::AddCube {cube:sample_cube(CUBE), bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"atlas.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    let initial = session.document().clone();
    let patch = |face:&str, from:[u32;2], to:[u32;2], rgba:[u8;4]| {
        CubeFaceRegionPaintPatch {
            face:face.into(),from,to,rgba,erase:false,
        }
    };
    let regions = vec![
        patch("north",[0,0],[4,4],[100,70,50,255]),
        patch("north",[0,0],[4,1],[175,130,95,255]),
        patch("north",[0,3],[4,4],[45,30,20,255]),
        patch("east",[1,1],[3,3],[20,145,210,255]),
    ];
    let op = EditOperation::PaintCubeFaceRegionsGuarded {
        cube_uuid:CUBE.into(),texture_uuid:TEX.into(),regions:regions.clone(),
    };
    let receipt = session.apply(1, &[op.clone()]).unwrap();
    assert_eq!(receipt.revision,2);
    assert_eq!(receipt.operation_count,1);
    assert_eq!(receipt.changed_uuids,vec![TEX.to_owned()]);
    let saved = session.document().clone();
    let rgba = paint::decode_for_uv_inspection(&saved.texture_assets[0],32,32).unwrap();
    let pixel = |x:usize,y:usize| -> &[u8] {
        let index=(y*32+x)*4;
        &rgba[index..index+4]
    };
    // New 4x4 Box UV north: [4,4,8,8]; east: [0,4,4,8].
    assert_eq!(pixel(5,4), &[175,130,95,255]);
    assert_eq!(pixel(5,5), &[100,70,50,255]);
    assert_eq!(pixel(5,7), &[45,30,20,255]);
    assert_eq!(pixel(2,5), &[20,145,210,255]);
    assert_eq!(pixel(0,4), &[0,0,0,0]);
    assert_eq!(pixel(5,1), &[0,0,0,0]);
    assert_eq!(saved.cubes,initial.cubes);
    assert_eq!(saved.bones,initial.bones);
    assert_eq!(saved.animation_assets,initial.animation_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(),&initial);
    session.redo(3).unwrap();
    assert_eq!(session.document(),&saved);
    assert_eq!(session.apply(4,&[op]).unwrap_err(),"EDIT_NO_OP");
    assert_eq!(session.document(),&saved);
}

#[test]
fn face_local_region_respects_manual_quarter_turn_in_actual_bitmap() {
    const TEX: &str = "00000000-0000-4000-8000-000000009942";
    let mut doc = AuthoringDocument::import_bbmodel(SAMPLE.as_bytes()).unwrap();
    for side in FACE_NAMES {
        if side != "north" { doc.cubes[0].faces.get_mut(side).unwrap()
            ["texture"] = Value::Null; }
    }
    doc.cubes[0].faces["north"]["uv"] = json!([1,2,5,6]);
    doc.cubes[0].faces["north"]["rotation"] = json!(90);
    let mut session = EditorSession::from_document(doc).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"manual.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    let initial = session.document().clone();
    session.apply(1, &[EditOperation::PaintCubeFaceRegionsGuarded {
        cube_uuid:CUBE.into(),texture_uuid:TEX.into(),
        regions:vec![CubeFaceRegionPaintPatch {
            face:"north".into(),from:[0,0],to:[1,2],
            rgba:[220,15,25,255],erase:false,
        }],
    }]).unwrap();
    let saved = session.document().clone();
    let pixels=paint::decode_for_uv_inspection(&saved.texture_assets[0],128,128).unwrap();
    let pixel = |x:usize,y:usize| -> &[u8] {
        let i=(y*128+x)*4; &pixels[i..i+4]
    };
    assert_eq!(pixel(1,5), &[220,15,25,255]);
    assert_eq!(pixel(2,5), &[220,15,25,255]);
    assert_eq!(pixel(1,4), &[0,0,0,0]);
    assert_eq!(saved.cubes,initial.cubes);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(),&initial);
}

#[test]
fn face_local_region_refuses_aliases_invalid_regions_and_opaque_rules_atomically() {
    const TEX: &str = "00000000-0000-4000-8000-000000009943";
    const DUP: &str = "00000000-0000-4000-8000-000000009944";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Guarded Regions","guarded_regions").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution {width:32,height:32},
        EditOperation::AddBone {
            bone:serde_json::from_value(json!({
                "uuid":BONE,"name":"root","origin":[0,0,0]
            })).unwrap(),parent_uuid:None,
        },
        EditOperation::AddCube {cube:sample_cube(CUBE),bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"atlas.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    let initial = session.document().clone();
    let valid = CubeFaceRegionPaintPatch {
        face:"north".into(),from:[0,0],to:[1,1],
        rgba:[90,50,30,255],erase:false,
    };
    let op = |regions:Vec<CubeFaceRegionPaintPatch>| {
        EditOperation::PaintCubeFaceRegionsGuarded {
            cube_uuid:CUBE.into(),texture_uuid:TEX.into(),regions,
        }
    };
    for (regions, code) in [
        (vec![], "PAINT_FACE_REGIONS_SIZE_INVALID"),
        (vec![valid.clone();65], "PAINT_FACE_REGIONS_SIZE_INVALID"),
        (vec![CubeFaceRegionPaintPatch {face:"invalid".into(),..valid.clone()}],
            "PAINT_FACE_REGION_UNKNOWN_FACE"),
        (vec![CubeFaceRegionPaintPatch {to:[0,1],..valid.clone()}],
            "PAINT_FACE_REGION_BOUNDS_INVALID"),
        (vec![CubeFaceRegionPaintPatch {to:[5,1],..valid.clone()}],
            "PAINT_FACE_REGION_BOUNDS_INVALID"),
    ] {
        assert_eq!(session.apply(1,&[op(regions)]).unwrap_err(),code);
        assert_eq!(session.document(),&initial);
    }
    session.apply(1, &[EditOperation::DuplicateCube {
        source_uuid:CUBE.into(),new_uuid:DUP.into(),
    }]).unwrap();
    let shared=session.document().clone();
    assert_eq!(session.apply(2,&[
        EditOperation::SetCubeInflate {uuid:CUBE.into(),inflate:0.25},
        op(vec![valid.clone()]),
    ]).unwrap_err(),"PAINT_CUBE_UV_GUARD_SHARED");
    assert_eq!(session.document(),&shared);
    assert_eq!(session.summary().revision,2);

    let mut unknown = initial.clone();
    unknown.cubes[0].faces.get_mut("east").unwrap()
        .as_object_mut().unwrap().remove("texture");
    let mut ambiguous=EditorSession::from_document(unknown.clone()).unwrap();
    assert_eq!(ambiguous.apply(0,&[op(vec![valid.clone()])]).unwrap_err(),
        "PAINT_CUBE_UV_GUARD_UNRESOLVED");
    assert_eq!(ambiguous.document(),&unknown);

    let mut rules = initial.clone();
    rules.extensions.insert("per_texture_uv_size".into(),json!(true));
    let mut unsafe_rules=EditorSession::from_document(rules.clone()).unwrap();
    assert_eq!(unsafe_rules.apply(0,&[op(vec![valid.clone()])]).unwrap_err(),
        "UV_SHARING_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(unsafe_rules.document(),&rules);

    let mut corrupted = initial.clone();
    corrupted.texture_assets[0]["source"]=json!("data:image/png;base64,AAAA");
    let mut corrupt=EditorSession::from_document(corrupted.clone()).unwrap();
    assert!(corrupt.apply(0,&[op(vec![valid])]).is_err());
    assert_eq!(corrupt.document(),&corrupted);
    assert!(!corrupt.can_undo());
}

// SOURCE-AUTHORED: one Cube's painted Box UV can be relocated without
// erasing the shared source, then painted independently from its duplicate.
#[test]
fn isolate_duplicate_box_uv_copies_existing_face_pixels_and_supports_guarded_paint() {
    const TEX:&str="00000000-0000-4000-8000-000000009971";
    const DUP:&str="00000000-0000-4000-8000-000000009972";
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Isolated","isolated").unwrap()).unwrap();
    session.apply(0,&[
        EditOperation::SetEmptyAtlasResolution { width:32,height:32 },
        EditOperation::AddBone { bone:serde_json::from_value(json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]
        })).unwrap(),parent_uuid:None },
        EditOperation::AddCube { cube:sample_cube(CUBE),bone_uuid:BONE.into() },
        EditOperation::CreatePaintTexture { uuid:TEX.into(),name:"skin.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid:CUBE.into(),texture_uuid:TEX.into() },
        EditOperation::PaintCubeUvFaces {
            cube_uuid:CUBE.into(),texture_uuid:TEX.into(),faces:vec![
                CubeFacePaintPatch { face:"north".into(),
                    rgba:[160,40,20,255],erase:false },
                CubeFacePaintPatch { face:"up".into(),
                    rgba:[20,100,180,255],erase:false },
            ],
        },
    ]).unwrap();
    session.apply(1,&[EditOperation::DuplicateCube {
        source_uuid:CUBE.into(),new_uuid:DUP.into()
    }]).unwrap();
    let original=session.document().clone();
    assert_eq!(inspect_cube_uv_sharing(&original,DUP,TEX).unwrap()
        ["declared_overlap_pairs"],json!(6));
    let receipt=session.apply(2,&[EditOperation::IsolateCubeBoxUv {
        cube_uuid:DUP.into(),texture_uuid:TEX.into()
    }]).unwrap();
    assert_eq!(receipt.revision,3);
    let isolated=session.document().clone();
    assert_eq!(isolated.cubes[0],original.cubes[0]);
    assert_eq!(isolated.cubes[1].uv_offset,Some([16.0,0.0]));
    assert_eq!(isolated.cubes[1].faces["north"]["uv"],json!([20.0,4.0,24.0,8.0]));
    assert_eq!(isolated.bones,original.bones);
    assert_eq!(isolated.animation_assets,original.animation_assets);
    assert_eq!(inspect_cube_uv_sharing(&isolated,DUP,TEX).unwrap()
        ["declared_overlap_pairs"],json!(0));
    let rgba=paint::decode_for_uv_inspection(
        &isolated.texture_assets[0],32,32).unwrap();
    for (x,y,expected) in [
        (5usize,5usize,[160,40,20,255]),
        (21,5,[160,40,20,255]),
        (5,1,[20,100,180,255]),
        (21,1,[20,100,180,255])
    ] {
        assert_eq!(&rgba[(y*32+x)*4..(y*32+x)*4+4],&expected);
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        isolated);
    session.apply(3,&[EditOperation::PaintCubeUvFacesGuarded {
        cube_uuid:DUP.into(),texture_uuid:TEX.into(),faces:vec![
            CubeFacePaintPatch {face:"north".into(),
                rgba:[90,170,40,255],erase:false}
        ]
    }]).unwrap();
    let edited=paint::decode_for_uv_inspection(
        &session.document().texture_assets[0],32,32).unwrap();
    assert_eq!(&edited[(5*32+5)*4..(5*32+5)*4+4],&[160,40,20,255]);
    assert_eq!(&edited[(5*32+21)*4..(5*32+21)*4+4],&[90,170,40,255]);
    session.undo(4).unwrap();
    assert_eq!(session.document(),&isolated);
    session.undo(5).unwrap();
    assert_eq!(session.document(),&original);
    session.redo(6).unwrap();
    assert_eq!(session.document(),&isolated);
}

// SOURCE-AUTHORED: repeated Cube aliases occupy one face pixel rectangle
// regardless of how many Cubes refer to it; occupancy is bounded by atlas.
#[test]
fn isolate_cube_uv_handles_many_duplicate_references_without_repainting_source() {
    const TEX:&str="00000000-0000-4000-8000-000000009975";
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Copies","copies").unwrap()).unwrap();
    session.apply(0,&[
        EditOperation::SetEmptyAtlasResolution {width:32,height:32},
        EditOperation::AddBone {bone:serde_json::from_value(json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]
        })).unwrap(),parent_uuid:None},
        EditOperation::AddCube {cube:sample_cube(CUBE),bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"skin.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
    ]).unwrap();
    let mut duplicates=Vec::new();
    for index in 10..40 {
        duplicates.push(EditOperation::DuplicateCube {
            source_uuid:CUBE.into(),
            new_uuid:format!("00000000-0000-4000-8000-00000000{:04}",index),
        });
    }
    session.apply(1,&duplicates).unwrap();
    let before=session.document().clone();
    let selected="00000000-0000-4000-8000-000000000010";
    session.apply(2,&[EditOperation::IsolateCubeBoxUv {
        cube_uuid:selected.into(),texture_uuid:TEX.into()
    }]).unwrap();
    let after=session.document();
    assert_eq!(after.cubes.len(),31);
    assert_eq!(after.cubes.iter().find(|c|c.uuid==selected).unwrap()
        .uv_offset,Some([16.0,0.0]));
    assert_eq!(before.texture_assets,after.texture_assets);
    assert_eq!(inspect_cube_uv_sharing(after,selected,TEX).unwrap()
        ["declared_overlap_pairs"],json!(0));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *after);
}

#[test]
fn isolate_box_uv_refuses_full_or_unknown_atlas_without_partial_mutation() {
    const TEX:&str="00000000-0000-4000-8000-000000009973";
    const DUP:&str="00000000-0000-4000-8000-000000009974";
    let mut session=EditorSession::from_document(
        AuthoringDocument::new_bedrock("Full","full").unwrap()).unwrap();
    session.apply(0,&[
        EditOperation::SetEmptyAtlasResolution {width:16,height:8},
        EditOperation::AddBone {bone:serde_json::from_value(json!({
            "uuid":BONE,"name":"root","origin":[0,0,0]
        })).unwrap(),parent_uuid:None},
        EditOperation::AddCube {cube:sample_cube(CUBE),bone_uuid:BONE.into()},
        EditOperation::CreatePaintTexture {uuid:TEX.into(),name:"skin.png".into()},
        EditOperation::AssignCubeTexture {cube_uuid:CUBE.into(),texture_uuid:TEX.into()},
        EditOperation::DuplicateCube {source_uuid:CUBE.into(),new_uuid:DUP.into()}
    ]).unwrap();
    let original=session.document().clone();
    let operation=|| EditOperation::IsolateCubeBoxUv {
        cube_uuid:DUP.into(),texture_uuid:TEX.into()
    };
    assert_eq!(session.apply(1,&[
        EditOperation::SetCubeOrigin {uuid:CUBE.into(),origin:[2.0,1.0,0.0]},
        operation()
    ]).unwrap_err(),"UV_ATLAS_NO_FREE_SPACE");
    assert_eq!(session.document(),&original);
    assert_eq!(session.summary().revision,1);
    let mut unknown=original.clone();
    unknown.cubes[0].faces.get_mut("north").unwrap()
        .as_object_mut().unwrap().remove("texture");
    let mut undecidable=EditorSession::from_document(unknown.clone()).unwrap();
    assert_eq!(undecidable.apply(0,&[operation()]).unwrap_err(),
        "UV_ATLAS_IMPLICIT_TEXTURE_UNSUPPORTED");
    assert_eq!(undecidable.document(),&unknown);
    let mut foreign=original.clone();
    foreign.texture_assets[0].as_object_mut().unwrap().remove("paint_owner");
    let mut other=EditorSession::from_document(foreign.clone()).unwrap();
    assert_eq!(other.apply(0,&[operation()]).unwrap_err(),
        "UV_ATLAS_TEXTURE_NOT_OWNED");
    assert_eq!(other.document(),&foreign);
}

// SOURCE_ONLY / NOT_EXECUTED: attention-only reporting reduces agent output,
// not the number of Cubes or six faces scanned. A transparent UV region may be
// intentional and must never be presented as an automatic repaint instruction.
#[test]
fn texture_coverage_attention_only_filters_healthy_cubes_without_skipping_pages() {
    const TEX: &str = "00000000-0000-4000-8000-000000009975";
    const HEALTHY: &str = "00000000-0000-4000-8000-000000009976";
    const LATER: &str = "00000000-0000-4000-8000-000000009977";
    let mut initial = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    initial.apply(0, &[
        EditOperation::CreatePaintTexture { uuid:TEX.into(), name:"atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid:CUBE.into(), texture_uuid:TEX.into() },
        EditOperation::DuplicateCube { source_uuid:CUBE.into(), new_uuid:HEALTHY.into() },
        EditOperation::DuplicateCube { source_uuid:CUBE.into(), new_uuid:LATER.into() },
    ]).unwrap();
    let mut doc = initial.document().clone();
    // A separate 4x4 atlas region makes the middle Cube fully painted.
    for face in doc.cubes[1].faces.values_mut() {
        face["uv"] = json!([8.0,0.0,12.0,4.0]);
    }
    // Deliberately absent is not a review candidate; unassigned is.
    doc.cubes[2].faces["north"]["texture"] = Value::Null;
    doc.cubes[2].faces["east"]["texture"] = json!(false);
    // Distinct material coverage states on first Cube.
    doc.cubes[0].faces["up"]["uv"] = json!([12.0,0.0,16.0,4.0]);
    doc.cubes[0].faces["down"]["uv"] = json!([16.0,0.0,20.0,4.0]);
    let mut painted = EditorSession::from_document(doc).unwrap();
    painted.apply(0, &[
        EditOperation::PaintTextureRectangle {
            texture_index:0,from:[8,0],to:[11,3],
            rgba:[30,40,50,255],erase:false,
        },
        EditOperation::PaintTexturePixel {
            texture_index:0,x:0,y:0,rgba:[255,0,0,255],
        },
        EditOperation::PaintTextureRectangle {
            texture_index:0,from:[12,0],to:[15,3],
            rgba:[90,110,120,128],erase:false,
        },
    ]).unwrap();
    let saved = painted.document().clone();
    let all = inspect_model_texture_coverage(&saved,0,3).unwrap();
    assert_eq!(all["attention_only"], json!(false));
    assert_eq!(all["reviewed_cubes"], json!(3));
    assert_eq!(all["returned_cubes"], json!(3));
    assert_eq!(all["returned_faces"], json!(18));
    assert_eq!(all["cubes"][1]["faces"][0]["status"],
        json!("measured_nontransparent_pixels"));

    let compact = inspect_model_texture_coverage_filtered(&saved,0,3,true).unwrap();
    assert_eq!(compact["attention_only"], json!(true));
    assert_eq!(compact["visual_verdict"], json!("UNVERIFIED"));
    assert_eq!(compact["reviewed_cubes"], json!(3));
    assert_eq!(compact["returned_cubes"], json!(2));
    assert_eq!(compact["returned_faces"], json!(11));
    assert_eq!(compact["review_candidates"], json!(11));
    assert_eq!(compact["fully_transparent_faces"], json!(1));
    assert_eq!(compact["partially_transparent_faces"], json!(8));
    assert_eq!(compact["translucent_faces"], json!(1));
    assert_eq!(compact["unresolved_reference_or_mapping_faces"], json!(1));
    assert_eq!(compact["cubes"][0]["cube_uuid"], json!(CUBE));
    assert_eq!(compact["cubes"][1]["cube_uuid"], json!(LATER));
    assert_eq!(compact["cubes"][0]["faces"][4]["status"], json!("translucent_pixels"));
    assert_eq!(compact["cubes"][0]["faces"][5]["status"], json!("fully_transparent_pixels"));
    assert_eq!(compact["cubes"][1]["faces"][0]["side"], json!("east"));
    assert_eq!(compact["cubes"][1]["faces"][0]["status"], json!("no_explicit_texture"));
    assert!(!compact.to_string().contains("data:image/png"));

    let first = inspect_model_texture_coverage_filtered(&saved,0,1,true).unwrap();
    let healthy = inspect_model_texture_coverage_filtered(&saved,1,1,true).unwrap();
    let later = inspect_model_texture_coverage_filtered(&saved,2,1,true).unwrap();
    assert_eq!(first["next_offset"], json!(1));
    assert_eq!(healthy["reviewed_cubes"], json!(1));
    assert_eq!(healthy["returned_cubes"], json!(0));
    assert_eq!(healthy["returned_faces"], json!(0));
    assert_eq!(healthy["review_candidates"], json!(0));
    assert_eq!(healthy["cubes"], json!([]));
    assert_eq!(healthy["next_offset"], json!(2));
    assert_eq!(later["returned_cubes"], json!(1));
    assert_eq!(later["cubes"][0]["cube_uuid"], json!(LATER));
    assert_eq!(later["next_offset"], Value::Null);
    assert_eq!(saved, *painted.document());
    assert_eq!(AuthoringDocument::import_bbmodel(&painted.export().unwrap()).unwrap(),saved);
    let beyond = inspect_model_texture_coverage_filtered(&saved,3,1,true).unwrap();
    assert_eq!(beyond["reviewed_cubes"], json!(0));
    assert_eq!(beyond["returned_cubes"], json!(0));
    assert_eq!(beyond["next_offset"], Value::Null);
}

// TEST_AUTHORED_NOT_RUN: bounded page validation occurs once before scanning,
// but every public per-Cube read still validates the entire input. The fixture
// uses eight real Cube references to exercise the maximum page budget.
#[test]
fn texture_coverage_full_page_preserves_public_projection_and_global_refusal() {
    const TEX: &str = "00000000-0000-4000-8000-000000009931";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture {
            uuid: TEX.into(), name: "bounded.png".into(),
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: CUBE.into(), texture_uuid: TEX.into(),
        },
    ]).unwrap();
    let duplicates: Vec<EditOperation> = (0..7).map(|i|
        EditOperation::DuplicateCube {
            source_uuid: CUBE.into(),
            new_uuid: format!("00000000-0000-4000-8000-0000000099{i:02}"),
        }
    ).collect();
    session.apply(1, &duplicates).unwrap();
    let saved = session.document().clone();
    assert_eq!(saved.cubes.len(), 8);
    let full = inspect_model_texture_coverage_filtered(&saved, 0, 8, false).unwrap();
    assert_eq!(full["reviewed_cubes"], json!(8));
    assert_eq!(full["returned_cubes"], json!(8));
    assert_eq!(full["returned_faces"], json!(48));
    assert_eq!(full["fully_transparent_faces"], json!(48));
    assert_eq!(full["review_candidates"], json!(48));
    assert_eq!(full["next_offset"], Value::Null);
    let focused = inspect_model_texture_coverage_filtered(&saved, 0, 8, true).unwrap();
    assert_eq!(focused["cubes"], full["cubes"]);
    assert_eq!(focused["fully_transparent_faces"], full["fully_transparent_faces"]);
    assert_eq!(focused["reviewed_cubes"], full["reviewed_cubes"]);
    for (index, cube) in saved.cubes.iter().enumerate() {
        let standalone = inspect_cube_uv_alpha(&saved, &cube.uuid).unwrap();
        assert_eq!(full["cubes"][index]["cube_uuid"], json!(cube.uuid));
        assert_eq!(standalone["faces"].as_array().unwrap().len(), 6);
        assert_eq!(standalone["faces"][0]["alpha"]["region"]["transparent_pixels"],
            json!(16));
        assert_eq!(full["cubes"][index]["faces"][0]["alpha_pixels"]["transparent"],
            standalone["faces"][0]["alpha"]["region"]["transparent_pixels"]);
    }
    // The page entry must still reject corruption in an out-of-page Cube.
    let mut malformed = saved.clone();
    malformed.cubes[7].faces.remove("north");
    for offset in [0, 8, 100] {
        assert_eq!(inspect_model_texture_coverage_filtered(
            &malformed, offset, 1, true).unwrap_err(), "CUBE_FACES_INCOMPLETE");
    }
    assert_eq!(inspect_cube_surfaces(&malformed, CUBE).unwrap_err(),
        "CUBE_FACES_INCOMPLETE");
    assert_eq!(inspect_cube_uv_alpha(&malformed, CUBE).unwrap_err(),
        "CUBE_FACES_INCOMPLETE");
    assert_eq!(session.document(), &saved);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        saved);
}

// AUTHORED_NOT_RUN: an agent can ask about several Cube faces in one
// bounded Rust read without claiming that nontransparent pixels are visible.
#[test]
fn model_texture_coverage_pages_alpha_references_and_undo_without_source_mutation() {
    const TEX: &str = "00000000-0000-4000-8000-000000009981";
    const OTHER: &str = "00000000-0000-4000-8000-000000009982";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Coverage", "coverage").unwrap()
    ).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({
                "uuid":BONE, "name":"body", "origin":[0,0,0]
            })).unwrap(),
            parent_uuid: None,
        },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid:BONE.into() },
        EditOperation::CreatePaintTexture { uuid:TEX.into(), name:"atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid:CUBE.into(), texture_uuid:TEX.into() },
    ]).unwrap();
    let blank = session.document().clone();
    let initial = inspect_model_texture_coverage(&blank, 0, 4).unwrap();
    assert_eq!(initial["reviewed_cubes"], json!(1));
    assert_eq!(initial["fully_transparent_faces"], json!(6));
    assert_eq!(initial["next_offset"], Value::Null);
    assert_eq!(initial["visual_verdict"], json!("UNVERIFIED"));
    assert_eq!(initial["cubes"][0]["faces"][0]["status"],
        json!("fully_transparent_pixels"));
    assert_eq!(session.document(), &blank);

    session.apply(1, &[EditOperation::PaintCubeUvFaces {
        cube_uuid:CUBE.into(), texture_uuid:TEX.into(),
        faces:vec![CubeFacePaintPatch {
            face:"north".into(), rgba:[70, 90, 120, 255], erase:false,
        }],
    }]).unwrap();
    let saved = session.document().clone();
    let reviewed = inspect_model_texture_coverage(&saved, 0, 1).unwrap();
    assert_eq!(reviewed["fully_transparent_faces"], json!(5));
    assert_eq!(reviewed["cubes"][0]["faces"][0]["status"],
        json!("measured_nontransparent_pixels"));
    assert_eq!(reviewed["cubes"][0]["faces"][0]["alpha_pixels"]["opaque"],
        json!(16));
    assert_eq!(reviewed["cubes"][0]["faces"][1]["status"],
        json!("fully_transparent_pixels"));
    session.apply(2, &[EditOperation::DuplicateCube {
        source_uuid:CUBE.into(), new_uuid:OTHER.into(),
    }]).unwrap();
    let after_copy = session.document().clone();
    // Both Cubes use one atlas. Its decoded pixels must be reused within a
    // page without altering the public six-face report for either Cube.
    let mut decoded = Vec::new();
    for uuid in [CUBE, OTHER] {
        let cached = inspect_cube_uv_alpha_with_cache(&after_copy, uuid, &mut decoded).unwrap();
        assert_eq!(cached, inspect_cube_uv_alpha(&after_copy, uuid).unwrap());
        assert_eq!(decoded.len(), 1);
    }
    let page = inspect_model_texture_coverage(&after_copy, 0, 1).unwrap();
    assert_eq!(page["total_cubes"], json!(2));
    assert_eq!(page["next_offset"], json!(1));
    let second_page = inspect_model_texture_coverage(&after_copy, 1, 1).unwrap();
    assert_eq!(second_page["cubes"][0]["cube_uuid"], json!(OTHER));
    assert_eq!(second_page["next_offset"], Value::Null);
    let shared_page = inspect_model_texture_coverage(&after_copy, 0, 2).unwrap();
    assert_eq!(shared_page["reviewed_cubes"], json!(2));
    assert_eq!(shared_page["cubes"][0]["faces"], page["cubes"][0]["faces"]);
    assert_eq!(shared_page["cubes"][1]["faces"], second_page["cubes"][0]["faces"]);
    let mut corrupt = after_copy.clone();
    corrupt.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
    assert!(inspect_model_texture_coverage(&corrupt, 0, 2).is_err());
    assert_eq!(session.document(), &after_copy);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        after_copy);
    session.undo(3).unwrap();
    assert_eq!(session.document(), &saved);
    session.undo(4).unwrap();
    assert_eq!(session.document(), &blank);
}

#[test]
fn model_texture_coverage_preserves_absent_faces_and_refuses_unsupported_pixels() {
    const TEX: &str = "00000000-0000-4000-8000-000000009983";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture { uuid:TEX.into(), name:"atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid:CUBE.into(), texture_uuid:TEX.into() },
    ]).unwrap();
    let mut doc = session.document().clone();
    doc.cubes[0].faces["north"]["texture"] = Value::Null;
    doc.cubes[0].faces["south"]["texture"] = json!(false);
    doc.cubes[0].faces.get_mut("west").unwrap().as_object_mut()
        .unwrap().remove("texture");
    doc.cubes[0].faces["east"]["uv"] = json!([0.5,0.0,4.0,4.0]);
    let review = inspect_model_texture_coverage(&doc, 0, 4).unwrap();
    let faces = &review["cubes"][0]["faces"];
    assert_eq!(faces[0]["status"], json!("absent_declared"));
    assert_eq!(faces[1]["status"], json!("mapping_unsupported"));
    assert_eq!(faces[1]["reason"], json!("PAINT_UV_RECT_NON_INTEGRAL"));
    assert_eq!(faces[2]["status"], json!("no_explicit_texture"));
    assert_eq!(faces[3]["status"], json!("implicit_texture_unresolved"));
    assert_eq!(review["unresolved_reference_or_mapping_faces"], json!(3));
    assert_eq!(review["face_coverage_verdict"], json!("UNVERIFIED"));
    assert_eq!(session.document().texture_assets, doc.texture_assets);
    for (offset, limit) in [(0, 0), (0, 9), (65_537, 1)] {
        assert_eq!(inspect_model_texture_coverage(&doc, offset, limit).unwrap_err(),
            "TEXTURE_COVERAGE_PAGE_INVALID");
    }
    assert_eq!(inspect_model_texture_coverage(&doc, 100, 1).unwrap()
        ["reviewed_cubes"], json!(0));
}

// SOURCE_AUTHORED_NOT_RUN: the inspector never mutates model or bitmap.
#[test]
fn uv_sharing_detects_cross_cube_aliases_and_respects_half_open_boundaries() {
    const TEXTURE: &str = "00000000-0000-4000-8000-000000009991";
    const SECOND_CUBE: &str = "00000000-0000-4000-8000-000000009992";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Aliases", "aliases").unwrap()).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({"uuid":BONE,"name":"root","origin":[0,0,0]})).unwrap(),
            parent_uuid: None,
        },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::CreatePaintTexture { uuid: TEXTURE.into(), name: "atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEXTURE.into() },
    ]).unwrap();
    let only = session.document().clone();
    let report = inspect_cube_uv_sharing(&only, CUBE, TEXTURE).unwrap();
    assert_eq!(report["focused_mapped_faces"], json!(6));
    assert_eq!(report["declared_overlap_pairs"], json!(0));
    assert_eq!(report["implicit_reference_faces"], json!(0));
    assert_eq!(report["unresolved_explicit_faces"], json!(0));
    assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
    session.apply(1, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: SECOND_CUBE.into(),
    }]).unwrap();
    let saved = session.document().clone();
    let overlaps = inspect_cube_uv_sharing(&saved, CUBE, TEXTURE).unwrap();
    assert_eq!(overlaps["declared_overlap_pairs"], json!(6));
    assert_eq!(overlaps["overlaps"][0]["focus_face"], json!("north"));
    assert_eq!(overlaps["overlaps"][0]["other_cube_uuid"], json!(SECOND_CUBE));
    assert_eq!(overlaps["overlaps"][0]["other_face"], json!("north"));
    assert_eq!(overlaps["overlaps"][0]["pixel_rect"], json!([4,4,8,8]));
    assert_eq!(overlaps["overlaps"][0]["overlap_pixels"], json!(16));
    assert_eq!(overlaps["report_truncated"], json!(false));
    assert_eq!(saved.texture_assets, only.texture_assets);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    assert_eq!(session.document(), &saved);
}

#[test]
fn uv_sharing_reports_unknown_references_and_unsupported_uv_without_false_clearance() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    const TEX: &str = "00000000-0000-4000-8000-000000009993";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture { uuid: TEX.into(), name: "atlas.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEX.into() },
    ]).unwrap();
    let mut doc = session.document().clone();
    doc.cubes[0].faces.get_mut("south").unwrap()["uv"] = json!([0.25,0.0,4.0,4.0]);
    let unknown = inspect_cube_uv_sharing(&doc, CUBE, TEX).unwrap();
    assert_eq!(unknown["unresolved_explicit_faces"], json!(1));
    assert_eq!(unknown["visual_verdict"], json!("UNVERIFIED"));
    doc.cubes[0].faces.get_mut("south").unwrap().as_object_mut()
        .unwrap().remove("texture");
    let unknown = inspect_cube_uv_sharing(&doc, CUBE, TEX).unwrap();
    assert_eq!(unknown["implicit_reference_faces"], json!(1));
    assert_eq!(unknown["unresolved_explicit_faces"], json!(0));
    model["meta"]["per_texture_uv_size"] = json!(true);
    let mut unsafe_doc = AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&model).unwrap()).unwrap();
    unsafe_doc.texture_assets = session.document().texture_assets.clone();
    assert_eq!(inspect_cube_uv_sharing(&unsafe_doc, CUBE, TEX).unwrap_err(),
        "UV_SHARING_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(inspect_cube_uv_sharing(session.document(), "missing", TEX).unwrap_err(),
        "UV_SHARING_CUBE_NOT_FOUND");
    assert_eq!(inspect_cube_uv_sharing(session.document(), CUBE, "missing").unwrap_err(),
        "UV_SHARING_TEXTURE_NOT_FOUND");
    assert_eq!(session.document().texture_assets, doc.texture_assets);
}

// SOURCE_AUTHORED_NOT_RUN: semantic Cube face painting with one Rust PNG
// transaction, not visual face-coverage evidence from native Blockbench.
#[test]
fn paint_cube_uv_faces_colors_six_derived_box_net_regions_with_one_undo() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Face Colors", "face_colors").unwrap()).unwrap();
    const TEX: &str = "00000000-0000-4000-8000-000000009871";
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
        EditOperation::AddBone {
            bone: serde_json::from_value(json!({
                "uuid": BONE, "name": "body", "origin": [0,0,0]
            })).unwrap(), parent_uuid: None,
        },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::CreatePaintTexture { uuid: TEX.into(), name: "body.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEX.into() },
    ]).unwrap();
    let before = session.document().clone();
    let colors: [(&str, [u8; 4], [u32; 2]); 6] = [
        ("north", [200, 30, 30, 255], [5, 5]),
        ("south", [30, 200, 30, 255], [13, 5]),
        ("east", [30, 30, 200, 255], [1, 5]),
        ("west", [200, 200, 30, 255], [9, 5]),
        ("up", [30, 200, 200, 255], [5, 1]),
        ("down", [200, 30, 200, 255], [9, 1]),
    ];
    let patches: Vec<_> = colors.iter().map(|(face, rgba, _)|
        CubeFacePaintPatch { face: (*face).into(), rgba: *rgba, erase: false }
    ).collect();
    let result = session.apply(1, &[EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces: patches.clone(),
    }]).unwrap();
    assert_eq!(result.revision, 2);
    assert_eq!(result.operation_count, 1);
    assert_eq!(result.changed_uuids, vec![TEX.to_owned()]);
    let saved = session.document().clone();
    let pixels = paint::decode_for_uv_inspection(&saved.texture_assets[0], 32, 32).unwrap();
    for (_, rgba, [x, y]) in colors {
        let offset = ((y * 32 + x) * 4) as usize;
        assert_eq!(&pixels[offset..offset + 4], &rgba);
    }
    let alpha = inspect_cube_uv_alpha(&saved, CUBE).unwrap();
    assert_eq!(alpha["scope"], json!("derived_box_face_uv_alpha"));
    for surface in alpha["faces"].as_array().unwrap() {
        assert_eq!(surface["alpha"]["status"], json!("measured"));
        assert_eq!(surface["alpha"]["region"]["opaque_pixels"], json!(16));
        assert_eq!(surface["alpha"]["region"]["transparent_pixels"], json!(0));
    }
    assert_eq!(saved.cubes, before.cubes);
    assert_eq!(saved.bones, before.bones);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(4, &[EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces: patches,
    }]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn paint_cube_uv_faces_rejects_unsafe_uv_missing_links_and_bad_patches_atomically() {
    const TEX: &str = "00000000-0000-4000-8000-000000009881";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreatePaintTexture { uuid: TEX.into(), name: "skin.png".into() },
        EditOperation::AssignCubeTexture { cube_uuid: CUBE.into(), texture_uuid: TEX.into() },
    ]).unwrap();
    let initial = session.document().clone();
    let valid = CubeFacePaintPatch { face: "north".into(),
        rgba: [10, 20, 30, 255], erase: false };
    let paint = |faces: Vec<CubeFacePaintPatch>| EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(), texture_uuid: TEX.into(), faces,
    };
    for (patches, error) in [
        (Vec::new(), "PAINT_CUBE_FACES_SIZE_INVALID"),
        (vec![valid.clone(); 7], "PAINT_CUBE_FACES_SIZE_INVALID"),
        (vec![valid.clone(), valid.clone()], "PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"),
        (vec![CubeFacePaintPatch { face: "unknown".into(), ..valid.clone() }],
            "PAINT_CUBE_FACE_DUPLICATE_OR_UNKNOWN"),
    ] {
        assert_eq!(session.apply(1, &[paint(patches)]).unwrap_err(), error);
    }
    assert_eq!(session.apply(1, &[EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(), texture_uuid: "missing".into(), faces: vec![valid.clone()],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.apply(1, &[
        EditOperation::SetCubeInflate { uuid: CUBE.into(), inflate: 0.25 },
        paint(vec![
            valid.clone(), CubeFacePaintPatch { face: "south".into(), ..valid.clone() },
        ]),
    ]).unwrap().revision, 2);
    // Existing valid manual face UV remains paintable. Undo back to isolate
    // subsequent fail-closed checks and prove there is no hidden state.
    session.undo(2).unwrap();
    assert_eq!(session.document(), &initial);
    let mut null_face = initial.clone();
    null_face.cubes[0].faces.get_mut("north").unwrap()["texture"] = Value::Null;
    let mut absent = EditorSession::from_document(null_face.clone()).unwrap();
    assert_eq!(absent.apply(0, &[paint(vec![valid.clone()])]).unwrap_err(),
        "PAINT_CUBE_FACE_TEXTURE_MISMATCH");
    assert_eq!(absent.document(), &null_face);
    let mut auto = initial.clone();
    auto.cubes[0].extra.insert("autouv".into(), json!(1));
    let mut auto = EditorSession::from_document(auto.clone()).unwrap();
    assert_eq!(auto.apply(0, &[paint(vec![valid.clone()])]).unwrap_err(),
        "PAINT_CUBE_AUTO_UV_UNSUPPORTED");
    let mut rules = initial.clone();
    rules.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
    let mut rules = EditorSession::from_document(rules.clone()).unwrap();
    assert_eq!(rules.apply(0, &[paint(vec![valid.clone()])]).unwrap_err(),
        "PAINT_CUBE_UV_RULESET_UNSUPPORTED");
    let mut fractional = initial.clone();
    fractional.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([0.5,0.0,4.0,4.0]);
    let mut fractional = EditorSession::from_document(fractional.clone()).unwrap();
    assert_eq!(fractional.apply(0, &[paint(vec![valid.clone()])]).unwrap_err(),
        "PAINT_UV_RECT_NON_INTEGRAL");
    let mut overrun = initial.clone();
    overrun.cubes[0].faces.get_mut("north").unwrap()["uv"] = json!([0.0,0.0,129.0,4.0]);
    let mut overrun = EditorSession::from_document(overrun.clone()).unwrap();
    assert_eq!(overrun.apply(0, &[paint(vec![valid.clone()])]).unwrap_err(),
        "PAINT_UV_RECT_OUT_OF_BOUNDS");
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let old = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintCubeUvFaces {
        cube_uuid: CUBE.into(),
        texture_uuid: "00000000-0000-4000-8000-000000000101".into(),
        faces: vec![valid],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &old);
    assert_eq!(session.document(), &initial);
    assert_eq!(session.summary().revision, 3);
}

// Source-only: the same PNG decoder is used once for a coherent group
// of atlas rectangles, retaining deterministic order and one Undo step.
#[test]
fn paint_rectangle_batch_preserves_order_noop_and_bbmodel_roundtrip() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Batch Paint", "batch_paint").unwrap()).unwrap();
    session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 8, height: 8 },
        EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000009811".into(),
            name: "atlas.png".into(),
        },
    ]).unwrap();
    let original = session.document().clone();
    let red = [190, 40, 30, 255];
    let blue = [20, 80, 200, 255];
    let paint = vec![
        PaintRectangleStep { from: [3, 3], to: [0, 0], rgba: red, erase: false },
        PaintRectangleStep { from: [2, 2], to: [5, 5], rgba: blue, erase: false },
        PaintRectangleStep { from: [7, 7], to: [7, 7], rgba: red, erase: true },
    ];
    let receipt = session.apply(1, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: paint.clone(),
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let saved = session.document().clone();
    let px = paint::decode_for_uv_inspection(&saved.texture_assets[0], 8, 8).unwrap();
    for (x, y, expected) in [
        (0_usize, 0_usize, red), (1, 1, red), (2, 2, blue),
        (3, 3, blue), (4, 4, blue), (5, 5, blue),
        (6, 6, [0,0,0,0]), (7, 7, [0,0,0,0]),
    ] {
        let offset = (y * 8 + x) * 4;
        assert_eq!(&px[offset..offset + 4], &expected);
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &saved);
    assert_eq!(session.apply(4, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: paint,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &saved);

    // Painting an area and fully erasing it in the same batch is a no-op.
    let mut new_session = EditorSession::from_document(original.clone()).unwrap();
    let transient = vec![
        PaintRectangleStep { from: [0,0], to: [1,1], rgba: red, erase: false },
        PaintRectangleStep { from: [0,0], to: [1,1], rgba: blue, erase: true },
    ];
    assert_eq!(new_session.apply(0, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: transient,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(new_session.document(), &original);
}

#[test]
fn paint_rectangle_batch_refuses_malformed_plans_and_imported_opaque_assets() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Batch Paint", "batch_paint").unwrap()).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000009812".into(),
        name: "atlas.png".into(),
    }]).unwrap();
    let original = session.document().clone();
    let good = PaintRectangleStep {
        from: [0, 0], to: [2, 2], rgba: [1, 2, 3, 255], erase: false,
    };
    let bad = PaintRectangleStep {
        from: [128, 0], to: [128, 2], rgba: [1, 2, 3, 255], erase: false,
    };
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: Vec::new(),
    }]).unwrap_err(), "PAINT_RECTANGLES_SIZE_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: vec![good.clone(); 65],
    }]).unwrap_err(), "PAINT_RECTANGLES_SIZE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::RenameNode { uuid: "does-not-exist".into(), name: "unused".into() },
    ]).unwrap_err(), "RENAME_NODE_NOT_FOUND");
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: vec![good.clone(), bad],
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let prior = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureRectangles {
        texture_index: 0, rectangles: vec![good],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &prior);
}

#[test]
fn paint_rectangle_fills_inclusive_reversed_corners_with_one_undo_step() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Rectangle", "rectangle").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000139".into(),
        name: "rectangle.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    let receipt = session.apply(1, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [3, 4], to: [1, 2],
        rgba: [19, 42, 73, 200], erase: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let filled = session.document().texture_assets[0].clone();
    let png_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD,
        filled["source"].as_str().unwrap()
            .strip_prefix("data:image/png;base64,").unwrap()).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(png_bytes))
        .read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).unwrap();
    let width = session.document().resolution.width as usize;
    for y in 0..=5 {
        for x in 0..=5 {
            let start = (y * width + x) * 4;
            let expected: &[u8] = if (1..=3).contains(&x) && (2..=4).contains(&y) {
                &[19, 42, 73, 200]
            } else {
                &[0, 0, 0, 0]
            };
            assert_eq!(&pixels[start..start + 4], expected);
        }
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], filled);
    assert_eq!(session.apply(4, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [1, 2], to: [3, 4],
        rgba: [19, 42, 73, 200], erase: false,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_rectangle_refuses_invalid_coordinates_imported_assets_and_partial_batch() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Rectangle", "rectangle").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000139".into(),
        name: "rectangle.png".into(),
    }]).unwrap();
    let unchanged = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [0, 0], to: [u32::MAX, 3],
        rgba: [10, 10, 10, 255], erase: false,
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureRectangle { texture_index: 0,
            from: [0, 0], to: [2, 2], rgba: [10, 10, 10, 255], erase: false },
        EditOperation::PaintTextureRectangle { texture_index: 0,
            from: [0, 0], to: [0, u32::MAX], rgba: [0, 0, 0, 0], erase: true },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &unchanged);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [0, 0], to: [2, 2],
        rgba: [10, 10, 10, 255], erase: false,
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &original);
}

#[test]
fn paint_brush_circle_and_eraser_preserve_one_undo_per_gesture() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Brush", "brush").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000129";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "brush.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    session.apply(1, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[2, 2]], radius: 2,
        rgba: [100, 50, 25, 255], erase: false,
    }]).unwrap();
    let painted = session.document().texture_assets[0].clone();
    assert_ne!(blank, painted);
    // Generated textures are the only supported ownership surface. Inspect
    // source-only RGBA pixels through the same bounded Rust decoder helper.
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        painted["source"].as_str().unwrap()
            .strip_prefix("data:image/png;base64,").unwrap(),
    ).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).unwrap();
    let w = session.document().resolution.width as usize;
    let rgba_at = |x: usize, y: usize| -> &[u8] {
        let start = (y * w + x) * 4;
        &pixels[start..start + 4]
    };
    assert_eq!(rgba_at(2, 2), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(1, 2), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(2, 1), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(1, 1), &[0, 0, 0, 0]);
    assert_eq!(rgba_at(4, 2), &[0, 0, 0, 0]);
    session.apply(2, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[2, 2]], radius: 1,
        rgba: [255, 255, 255, 255], erase: true,
    }]).unwrap();
    let erased = session.document().texture_assets[0].clone();
    assert_ne!(painted, erased);
    session.undo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    session.undo(4).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(5).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    session.redo(6).unwrap();
    assert_eq!(session.document().texture_assets[0], erased);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn paint_brush_invalid_radius_and_coordinates_refuse_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Brush", "brush").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000129".into(),
        name: "brush.png".into(),
    }]).unwrap();
    let original = session.document().clone();
    for radius in [0, 9, 255] {
        assert_eq!(session.apply(1, &[EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[2, 2]], radius,
            rgba: [3, 4, 5, 255], erase: false,
        }]).unwrap_err(), "PAINT_BRUSH_RADIUS_INVALID");
    }
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[0, 0], [128, 0]], radius: 8,
        rgba: [3, 4, 5, 255], erase: false,
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[1, 1]], radius: 8,
            rgba: [3, 4, 5, 255], erase: false,
        },
        EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[128, 0]], radius: 1,
            rgba: [3, 4, 5, 255], erase: true,
        }
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[0, 0]], radius: 2,
        rgba: [0, 0, 0, 0], erase: true,
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
}

#[test]
fn paint_stroke_is_one_revision_one_undo_and_roundtrips() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Stroke", "stroke").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000119";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "stroke.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    let points = vec![[2, 3], [3, 3], [4, 3], [4, 3], [5, 3]];
    let receipt = session.apply(1, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: points.clone(), rgba: [9, 18, 27, 128],
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let painted = session.document().texture_assets[0].clone();
    assert_ne!(blank, painted);
    let bytes = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&bytes).unwrap(), *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    assert_eq!(session.apply(4, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points, rgba: [9, 18, 27, 128],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_stroke_refuses_invalid_size_coordinates_or_imported_assets_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Stroke", "stroke").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000119";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "stroke.png".into(),
    }]).unwrap();
    let prior = session.document().clone();
    for points in [vec![], vec![[0, 0]; 4097]] {
        assert_eq!(session.apply(1, &[EditOperation::PaintTextureStroke {
            texture_index: 0, points, rgba: [1, 2, 3, 4],
        }]).unwrap_err(), "PAINT_STROKE_SIZE_INVALID");
    }
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: vec![[0, 0], [128, 0]],
        rgba: [1, 2, 3, 4],
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureStroke { texture_index: 0,
            points: vec![[0, 0]], rgba: [1, 2, 3, 4] },
        EditOperation::PaintTextureStroke { texture_index: 0,
            points: vec![[0, 0], [128, 0]], rgba: [1, 2, 3, 4] },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &prior);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: vec![[0, 0]], rgba: [1, 2, 3, 4],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &original);
}

#[test]
fn authored_rgba8_paint_texture_mutates_one_pixel_with_history() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Paint", "paint").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000109";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "atlas.png".into(),
    }]).unwrap();
    let before = session.document().texture_assets[0].clone();
    assert_eq!(before["uuid"], json!(uuid));
    assert_eq!(before["paint_owner"], json!("lazydesigner-rgba8-v1"));
    assert_eq!(before["wrap_mode"], json!("limited"));
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 3, y: 5, rgba: [120, 30, 200, 128],
    }]).unwrap();
    let after = session.document().texture_assets[0].clone();
    assert_ne!(before["source"], after["source"]);
    assert_eq!(before["uuid"], after["uuid"]);
    assert_eq!(before["name"], after["name"]);
    let saved = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&saved).unwrap(), *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], before);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], after);
    assert_eq!(session.apply(4, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 3, y: 5, rgba: [120, 30, 200, 128],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_refuses_imported_textures_oversized_canvas_and_partial_batches() {
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let prior = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 0, y: 0, rgba: [0, 0, 0, 0],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &prior);
    let uuid = "00000000-0000-4000-8000-000000000109";
    assert_eq!(imported.apply(0, &[
        EditOperation::CreatePaintTexture { uuid: uuid.into(), name: "new.png".into() },
        EditOperation::PaintTexturePixel {
            texture_index: 2, x: 128, y: 0, rgba: [255, 0, 0, 255],
        },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(imported.document(), &prior);
    assert_eq!(imported.summary().revision, 0);
    let mut oversized = AuthoringDocument::new_bedrock("Large", "large").unwrap();
    oversized.resolution.width = 512;
    let mut session = EditorSession::from_document(oversized).unwrap();
    assert_eq!(session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "new.png".into(),
    }]).unwrap_err(), "PAINT_DIMENSIONS_UNSUPPORTED");
    assert!(session.document().texture_assets.is_empty());
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
fn textured_fixture_preserves_references_paths_animation_and_hierarchy() {
    // Synthetic metadata fixture; its placeholder embedded image is not a
    // decodable PNG or a native Blockbench compatibility receipt.
    let input: Value = serde_json::from_str(TEXTURED).unwrap();
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let initial = session.document().clone();
    assert_eq!(initial.texture_assets.len(), 2);
    assert_eq!(initial.animation_assets.len(), 1);
    session.apply(0, &[
        EditOperation::SetCubeRotation {
            uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0],
        },
        EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: [2.0, 3.0, 6.0, 7.0],
        },
    ]).unwrap();
    let bytes = session.export().unwrap();
    let saved: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(saved["textures"], input["textures"]);
    assert_eq!(saved["texture_groups"], input["texture_groups"]);
    assert_eq!(saved["animations"], input["animations"]);
    assert_eq!(saved["animation_controllers"], input["animation_controllers"]);
    assert_eq!(saved["vendor_extension"], input["vendor_extension"]);
    assert_eq!(saved["outliner"], input["outliner"]);
    assert_eq!(saved["groups"], input["groups"]);
    assert_eq!(saved["elements"][0]["faces"]["south"], input["elements"][0]["faces"]["south"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(0));
    assert_eq!(saved["elements"][0]["faces"]["north"]["rotation"], json!(90));
    assert_eq!(saved["elements"][0]["faces"]["north"]["custom"],
        input["elements"][0]["faces"]["north"]["custom"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["uv"], json!([2.0, 3.0, 6.0, 7.0]));
    assert_eq!(saved["elements"][0]["rotation"], json!([0.0, 22.5, 0.0]));
    assert_eq!(saved["textures"][1]["relative_path"],
        json!("textures/entity/external.png"));
    let reopened = AuthoringDocument::import_bbmodel(&bytes).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &initial);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn textured_fixture_box_uv_mutation_preserves_null_face_and_asset_metadata() {
    let mut input: Value = serde_json::from_str(TEXTURED).unwrap();
    input["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&input).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [3.0, 5.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["textures"], input["textures"]);
    assert_eq!(saved["animations"], input["animations"]);
    assert_eq!(saved["texture_groups"], input["texture_groups"]);
    assert_eq!(saved["elements"][0]["faces"]["south"], input["elements"][0]["faces"]["south"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(0));
    assert_eq!(saved["elements"][0]["faces"]["north"]["uv"], json!([7.0, 9.0, 11.0, 13.0]));
    assert_eq!(saved["elements"][0]["uv_offset"], json!([3.0, 5.0]));
}
 
#[test]
fn new_bone_cube_uv_batch_roundtrip_and_history() {
    let mut initial = AuthoringDocument::new_bedrock("Example", "example").unwrap();
    // The manual face UV test deliberately opts out of the Box UV default.
    initial.meta.box_uv = Some(false);
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
fn new_bedrock_box_uv_default_and_initial_cube_face_rectangles() {
    let doc = AuthoringDocument::new_bedrock("Example", "example").unwrap();
    assert_eq!(doc.meta.box_uv, Some(true));
    let wire: Value = serde_json::from_slice(&doc.export_bbmodel().unwrap()).unwrap();
    assert_eq!(wire["meta"]["box_uv"], json!(true));
    let mut session = EditorSession::from_document(doc.clone()).unwrap();
    let bone: Bone = serde_json::from_value(json!({"uuid": BONE, "name": "body"})).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
    ]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["north"]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
    assert_eq!(cube.faces["east"]["uv"], json!([0.0, 4.0, 4.0, 8.0]));
    assert_eq!(cube.faces["up"]["uv"], json!([8.0, 4.0, 4.0, 0.0]));
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &doc);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn explicit_face_uv_new_project_remains_editable() {
    let mut doc = AuthoringDocument::new_bedrock("Face UV", "face_uv").unwrap();
    doc.meta.box_uv = Some(false);
    let mut session = EditorSession::from_document(doc).unwrap();
    let bone: Bone = serde_json::from_value(json!({"uuid": BONE, "name": "body"})).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: [3.0, 4.0, 7.0, 8.0],
        },
    ]).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([3.0, 4.0, 7.0, 8.0]));
}

#[test]
fn malformed_multifile_ruleset_refuses_auto_uv_remap_atomically() {
    for invalid in [json!(false), json!(null), json!(0), json!({})] {
        let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
        wire["multi_file_ruleset"] = invalid;
        wire["elements"][0]["autouv"] = json!(2);
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
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
fn blockbench_uuid_face_texture_refs_roundtrip_through_rust_edit_and_history() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let texture_uuid = wire["textures"][0]["uuid"].as_str().unwrap().to_owned();
    wire["elements"][0]["faces"]["north"]["texture"] = json!(texture_uuid);
    wire["elements"][0]["faces"]["east"]["texture"] = json!(texture_uuid);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [2.0, 2.0, 6.0, 6.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(texture_uuid));
    assert_eq!(saved["elements"][0]["faces"]["east"]["texture"], json!(texture_uuid));
    assert_eq!(saved["elements"][0]["faces"]["south"]["texture"], Value::Null);
    assert_eq!(saved["textures"], wire["textures"]);
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["texture"], json!(texture_uuid));
}

#[test]
fn duplicate_texture_uuids_reject_ambiguous_face_references() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    let original_uuid = model["textures"][0]["uuid"].clone();
    model["textures"][1]["uuid"] = original_uuid.clone();
    model["elements"][0]["faces"]["north"]["texture"] = original_uuid;
    let bytes = serde_json::to_vec(&model).unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&bytes).unwrap_err(),
        "TEXTURE_UUID_DUPLICATE");
}

#[test]
fn malformed_texture_uuid_refuses_import_without_normalization() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    model["textures"][0]["uuid"] = json!(42);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "TEXTURE_UUID_INVALID");
    model["textures"][0]["uuid"] = json!("");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "TEXTURE_UUID_INVALID");
}

#[test]
fn optional_texture_uuids_preserve_legacy_indexed_assets() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    model["textures"][0].as_object_mut().unwrap().remove("uuid");
    let saved = AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap();
    assert_eq!(saved.texture_assets[0].get("uuid"), None);
    let again = AuthoringDocument::import_bbmodel(&saved.export_bbmodel().unwrap()).unwrap();
    assert_eq!(again, saved);
}

#[test]
fn unresolved_uuid_face_texture_is_refused_without_rewriting_assets() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["elements"][0]["faces"]["north"]["texture"] =
        json!("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&wire).unwrap()).unwrap_err(),
        "CUBE_FACE_TEXTURE_UNSUPPORTED");
}

#[test]
fn auto_uv_resolves_uuid_texture_wrap_metadata_before_mutating() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let texture_uuid = wire["textures"][0]["uuid"].as_str().unwrap().to_owned();
    wire["elements"][0]["faces"]["north"]["texture"] = json!(texture_uuid);
    wire["elements"][0]["autouv"] = json!(1);
    wire["textures"][0]["wrap_mode"] = json!("unsupported-unknown-wrap");
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap_err(), "CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn cube_inflate_and_stretch_validate_and_preserve_opaque_format_fields() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["inflate"] = json!(1.25);
    wire["elements"][0]["stretch"] = json!([2.0, 0.5, 1.5]);
    let original = AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap();
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["inflate"], json!(1.25));
    assert_eq!(saved["elements"][0]["stretch"], json!([2.0, 0.5, 1.5]));
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra["stretch"], json!([2.0, 0.5, 1.5]));
}

#[test]
fn invalid_cube_inflate_and_stretch_refuse_import() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["inflate"] = json!("not a number");
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_INFLATE_INVALID");
    wire["elements"][0]["inflate"] = json!(1.0);
    wire["elements"][0]["stretch"] = json!([1.0, 2.0]);
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_STRETCH_INVALID");
    wire["elements"][0]["stretch"] = json!([1.0, "invalid", 1.0]);
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_STRETCH_INVALID");
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
fn auto_uv_relative_move_remaps_all_six_faces_and_preserves_roundtrip() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    model["elements"][0]["faces"]["north"]["texture"] = json!(false);
    model["vendor"] = json!({"keep": [1, 2]});
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["north"]["uv"], json!([115.0, 124.0, 119.0, 128.0]));
    assert_eq!(cube.faces["south"]["uv"], json!([9.0, 124.0, 13.0, 128.0]));
    assert_eq!(cube.faces["east"]["uv"], json!([116.0, 124.0, 120.0, 128.0]));
    assert_eq!(cube.faces["west"]["uv"], json!([8.0, 124.0, 12.0, 128.0]));
    assert_eq!(cube.faces["up"]["uv"], json!([9.0, 8.0, 13.0, 12.0]));
    assert_eq!(cube.faces["down"]["uv"], json!([9.0, 116.0, 13.0, 120.0]));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["vendor"], model["vendor"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(false));
    let again = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(again, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document().cubes[0].from, [0.0, 0.0, 0.0]);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &again);
}

#[test]
fn auto_uv_size_mode_remaps_resized_face_and_rotated_face() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(1);
    model["elements"][0]["faces"]["north"]["rotation"] = json!(90);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [6.0, 4.0, 4.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([0.0, 0.0, 4.0, 6.0]));
    assert_eq!(session.document().cubes[0].faces["south"]["uv"], json!([0.0, 0.0, 6.0, 4.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["rotation"], json!(90));
}


#[test]
fn box_uv_offset_edits_are_atomic_and_preserve_opaque_assets() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["meta"]["box_uv"] = json!(true);
    wire["vendor"] = json!({"keep": [1, 2]});
    wire["elements"][0]["faces"]["north"]["annotation"] = json!("preserve");
    wire["elements"][0]["faces"]["south"]["texture"] = Value::Null;
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let previous = session.document().clone();
    session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [2.0, 3.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.uv_offset, Some([2.0, 3.0]));
    assert_eq!(cube.faces["north"]["uv"], json!([6.0, 7.0, 10.0, 11.0]));
    assert_eq!(cube.faces["south"]["uv"], previous.cubes[0].faces["south"]["uv"]);
    assert_eq!(cube.faces["north"]["annotation"], json!("preserve"));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["vendor"], wire["vendor"]);
    let again = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(again, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &previous);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &again);
    session.apply(3, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [0.0, 0.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, None);
}

#[test]
fn box_uv_offset_rejects_invalid_mode_input_and_noop_without_revision() {
    let mut face_session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    assert_eq!(face_session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [1.0, 2.0],
    }]).unwrap_err(), "BOX_UV_MODE_REQUIRED");
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    for offset in [[f64::NAN, 0.0], [0.5, 2.0], [100_001.0, 0.0]] {
        assert_eq!(session.apply(0, &[EditOperation::SetBoxUvOffset {
            uuid: CUBE.into(), offset,
        }]).unwrap_err(), "BOX_UV_OFFSET_INVALID");
    }
    assert_eq!(session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [0.0, 0.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert_eq!(session.apply(0, &[
        EditOperation::SetBoxUvOffset { uuid: CUBE.into(), offset: [1.0, 1.0] },
        EditOperation::SetFaceUv { uuid: CUBE.into(), face: "north".into(),
            uv: [0.0, 0.0, 4.0, 4.0] },
    ]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(session.document(), &original);
}

// AUTHORED_NOT_RUN: every Rust path that regenerates Box UV must use
// the same source admission. Imported unknown atlas rules cannot be
// silently normalized by Add/Resize/Scale/Offset.
#[test]
fn box_uv_regeneration_refuses_per_texture_rules_without_partial_edits() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    model["meta"]["per_texture_uv_size"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    let new_cube = "00000000-0000-4000-8000-000000009961";
    let forbidden = [
        EditOperation::SetBoxUvOffset { uuid: CUBE.into(), offset: [2.0, 3.0] },
        EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
        },
        EditOperation::ScaleCube { uuid: CUBE.into(), factors: [1.25, 1.0, 1.0] },
        EditOperation::AddCube { cube: sample_cube(new_cube), bone_uuid: BONE.into() },
    ];
    for op in forbidden {
        assert_eq!(session.apply(0, &[
            EditOperation::SetCubeOrigin { uuid: CUBE.into(), origin: [1.0, 2.0, 3.0] },
            op,
        ]).unwrap_err(), "CUBE_BOX_UV_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
        assert!(!session.can_undo());
    }
    // Historical Reframe/Mirror error contracts are still stable.
    assert_eq!(session.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
        uv_policy: "box_repack".into(),
    }]).unwrap_err(), "CUBE_REFRAME_UV_RULESET_UNSUPPORTED");
    assert_eq!(session.apply(0, &[EditOperation::SetCubeMirrorUv {
        uuid: CUBE.into(), mirrored: true,
    }]).unwrap_err(), "CUBE_MIRROR_UV_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &original);
}

#[test]
fn box_uv_regeneration_refuses_float_size_metadata_in_all_entrypoints() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    model["meta"]["box_uv_float_size"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    let forbidden = [
        EditOperation::SetBoxUvOffset { uuid: CUBE.into(), offset: [1.0, 0.0] },
        EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [4.0, 4.0, 5.0],
        },
        EditOperation::ScaleCube { uuid: CUBE.into(), factors: [1.5, 1.0, 1.0] },
        EditOperation::AddCube {
            cube: sample_cube("00000000-0000-4000-8000-000000009962"),
            bone_uuid: BONE.into(),
        },
    ];
    for op in forbidden {
        assert_eq!(session.apply(0, &[op]).unwrap_err(),
            "CUBE_BOX_UV_FLOAT_UNSUPPORTED");
        assert_eq!(session.document(), &original);
    }
    assert_eq!(session.apply(0, &[EditOperation::ReframeCube {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
        uv_policy: "box_repack".into(),
    }]).unwrap_err(), "CUBE_REFRAME_BOX_UV_FLOAT_UNSUPPORTED");
    assert_eq!(session.apply(0, &[EditOperation::SetCubeMirrorUv {
        uuid: CUBE.into(), mirrored: true,
    }]).unwrap_err(), "CUBE_MIRROR_UV_FLOAT_UNSUPPORTED");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);

    // Nonstandard imported per-Cube float rules are equally unsupported.
    model["meta"].as_object_mut().unwrap().remove("box_uv_float_size");
    model["elements"][0]["box_uv_float_size"] = json!(true);
    let mut per_cube = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let before = per_cube.document().clone();
    assert_eq!(per_cube.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [2.0, 3.0],
    }]).unwrap_err(), "CUBE_BOX_UV_FLOAT_UNSUPPORTED");
    assert_eq!(per_cube.document(), &before);
}

#[test]
fn explicit_false_box_uv_flags_allow_original_resize_scale_and_offset() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    model["meta"]["per_texture_uv_size"] = json!(false);
    model["meta"]["box_uv_float_size"] = json!(false);
    model["per_texture_uv_size"] = json!(false);
    model["box_uv_float_size"] = json!(false);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::SetBoxUvOffset { uuid: CUBE.into(), offset: [2.0, 3.0] },
        EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [4.0, 4.0, 5.0],
        },
        EditOperation::ScaleCube { uuid: CUBE.into(), factors: [1.0, 1.5, 1.0] },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 3);
    assert_ne!(session.document().cubes[0].faces, original.cubes[0].faces);
    assert_eq!(session.document().extensions, original.extensions);
    let saved = session.document().clone();
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(), saved);
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &saved);
}

#[test]
fn box_uv_single_edge_resize_updates_offset_and_derived_faces() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [4.0, 4.0, 6.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, Some([-2.0, -2.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
    assert_eq!(session.document().cubes[0].faces["east"]["uv"], json!([-2.0, 4.0, 4.0, 8.0]));
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, None);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    session.apply(3, &[
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [2.0, 0.0, 0.0] },
        EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0] },
    ]).unwrap();
    assert_eq!(session.document().cubes[0].from, [2.0, 0.0, 0.0]);
    assert_eq!(session.document().cubes[0].extra["rotation"], json!([0.0, 22.5, 0.0]));
}

#[test]
fn auto_uv_mode_two_clamps_to_project_uv_resolution() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [200.0, 0.0, 0.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["south"]["uv"], json!([124.0, 124.0, 128.0, 128.0]));
    assert_eq!(cube.faces["north"]["uv"], json!([0.0, 124.0, 4.0, 128.0]));
}

#[test]
fn uv_sensitive_ambiguous_resize_and_multifile_rules_fail_atomically() {
    for mode in [1, 2] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(mode);
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [6.0, 5.0, 4.0],
        }]).unwrap_err(), "CUBE_AUTO_UV_REMAP_REQUIRED");
        assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "invalid".into(), uv: [1.0, 1.0, 5.0, 5.0],
        }]).unwrap_err(), "FACE_UV_INVALID");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
        model["multi_file_ruleset"] = json!("texture_set");
        let mut multifile = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        assert_eq!(multifile.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(multifile.summary().revision, 0);
    }
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 5.0, 4.0],
    }]).unwrap_err(), "CUBE_BOX_UV_RESIZE_UNSUPPORTED");
    assert_eq!(session.document(), &original);
}

#[test]
fn uv_sensitive_invalid_face_rotation_fails_without_partial_batch() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(1);
    model["elements"][0]["faces"]["north"]["rotation"] = json!(45);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0] },
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
    ]).unwrap_err(), "CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}


// Source-authored regression for the shared CLI/Tauri EditOperation only.
#[test]
fn manual_uv_face_rotation_matches_saved_default_and_preserves_assets_and_history() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["autouv"] = json!(2);
    wire["elements"][0]["faces"]["north"]["custom"] = json!({"retain":true});
    wire["vendor"] = json!({"untouched":"yes"});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let original_uv = original.cubes[0].faces["north"]["uv"].clone();
    let receipt = session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().cubes[0].faces["north"]["rotation"], json!(90));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], original_uv);
    assert_eq!(session.document().cubes[0].faces["north"]["custom"], json!({"retain":true}));
    assert_eq!(session.document().cubes[0].faces["east"], original.cubes[0].faces["east"]);
    assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let saved = session.export().unwrap();
    let parsed: Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(parsed["vendor"], wire["vendor"]);
    assert_eq!(parsed["elements"][0]["faces"]["north"]["rotation"], json!(90));
    let reopened = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    for (revision, rotation) in [(3, 180), (4, 270), (5, 0)] {
        session.apply(revision, &[EditOperation::SetFaceUvRotation {
            uuid: CUBE.into(), face: "north".into(), rotation,
        }]).unwrap();
    }
    assert!(session.document().cubes[0].faces["north"].get("rotation").is_none());
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], original_uv);
    assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
    assert_eq!(session.apply(6, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 0,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 6);
}

#[test]
fn manual_uv_face_rotation_refuses_invalid_box_and_opaque_values_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    for rotation in [1, 45, 360, u16::MAX] {
        assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
            uuid: CUBE.into(), face: "north".into(), rotation,
        }]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    }
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "upside".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: "missing".into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.apply(0, &[
        EditOperation::SetFaceUvRotation { uuid: CUBE.into(), face: "north".into(), rotation: 90 },
        EditOperation::SetFaceUvRotation { uuid: CUBE.into(), face: "north".into(), rotation: 45 },
    ]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);

    let mut box_wire: Value = serde_json::from_str(SAMPLE).unwrap();
    box_wire["meta"]["box_uv"] = json!(true);
    let mut box_session = EditorSession::open(&serde_json::to_vec(&box_wire).unwrap()).unwrap();
    let box_original = box_session.document().clone();
    assert_eq!(box_session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(box_session.document(), &box_original);

    let mut opaque_wire: Value = serde_json::from_str(SAMPLE).unwrap();
    opaque_wire["elements"][0]["faces"]["north"]["rotation"] = json!(45);
    let mut opaque = EditorSession::open(&serde_json::to_vec(&opaque_wire).unwrap()).unwrap();
    let opaque_original = opaque.document().clone();
    assert_eq!(opaque.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_ROTATION_UNSUPPORTED");
    assert_eq!(opaque.document(), &opaque_original);
    assert_eq!(opaque.summary().revision, 0);
}

// Source-authored refusal: scoped texture assignment is not a global
// Cube-face UUID rewrite in Blockbench's multi-file attachable mode.
#[test]
fn scoped_project_refuses_global_cube_texture_assignment_without_changes() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["multi_file_ruleset"] = json!("bedrock_attachable");
    wire["elements"][0]["scope"] = json!(2);
    let texture_id = "00000000-0000-4000-8000-000000000901";
    wire["textures"] = json!([{
        "uuid":texture_id, "scope":2, "name":"scope.png"
    }]);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    assert!(has_per_texture_uv_rules(session.document()));
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: CUBE.into(), texture_uuid: texture_id.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        original);
}

#[test]
fn manual_face_uv_edit_disables_auto_uv_and_preserves_opaque_fields() {
    for mode in [1, 2] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(mode);
        model["elements"][0]["faces"]["north"]["custom"] = json!({"keep": true});
        model["vendor"] = json!({"preserve": "yes"});
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        let edited_uv = [2.0, 3.0, 7.0, 9.0];
        let receipt = session.apply(0, &[EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: edited_uv,
        }]).unwrap();
        assert_eq!(receipt.revision, 1);
        assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
        assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!(edited_uv));
        assert_eq!(session.document().cubes[0].faces["north"]["custom"], json!({"keep": true}));
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        assert_eq!(saved["vendor"], model["vendor"]);
        assert_eq!(saved["elements"][0]["autouv"], json!(0));
        let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
        assert_eq!(reimported, *session.document());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &original);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &reimported);
    }
}

#[test]
fn manual_face_uv_noop_keeps_auto_uv_and_revision_unchanged() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [0.0, 0.0, 4.0, 4.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}


#[test]
fn explicitly_declared_per_texture_uv_rules_refuse_auto_remap_atomically() {
    for location in ["meta", "project"] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(2);
        if location == "meta" {
            model["meta"]["per_texture_uv_size"] = json!(true);
        } else {
            model["per_texture_uv_size"] = json!(true);
        }
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        if location == "meta" {
            assert_eq!(saved["meta"]["per_texture_uv_size"], json!(true));
        } else {
            assert_eq!(saved["per_texture_uv_size"], json!(true));
        }
    }
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

#[test]
fn cube_visibility_changes_only_the_target_and_roundtrips() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::SetNodeVisibility {
        uuid: CUBE.into(), visible: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    let source: Value = serde_json::from_str(TEXTURED).unwrap();
    assert_eq!(saved["elements"][0]["visibility"], json!(false));
    assert_eq!(saved["textures"], source["textures"]);
    assert_eq!(saved["animations"], source["animations"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    assert_eq!(session.apply(1, &[EditOperation::SetNodeVisibility {
        uuid: CUBE.into(), visible: false,
    }]).unwrap_err(), "EDIT_NO_OP");
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
}

#[test]
fn nested_group_visibility_updates_descendants_not_siblings_and_refuses_atomic_failures() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let sibling = "00000000-0000-4000-8000-000000000004";
    let nested = "00000000-0000-4000-8000-000000000003";
    let mut sibling_cube = wire["elements"][0].clone();
    sibling_cube["uuid"] = json!(sibling);
    wire["elements"].as_array_mut().unwrap().push(sibling_cube);
    wire["outliner"][0]["children"].as_array_mut().unwrap().push(json!(sibling));
    wire["groups"][1]["vendor_visibility_extension"] = json!({"retain": true});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::SetNodeVisibility {
        uuid: nested.into(), visible: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().bones[1].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().bones[0].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().cubes[1].extra.get("visibility"), None);
    assert_eq!(session.document().bones[1].extra.get("vendor_visibility_extension"),
        Some(&json!({"retain":true})));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["textures"], wire["textures"]);
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(saved["outliner"], wire["outliner"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    session.apply(3, &[EditOperation::SetNodeVisibility {
        uuid: nested.into(), visible: true,
    }]).unwrap();
    assert_eq!(session.document().bones[1].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[1].extra.get("visibility"), None);
    let before = session.document().clone();
    assert_eq!(session.apply(4, &[
        EditOperation::SetNodeVisibility { uuid: nested.into(), visible: false },
        EditOperation::SetNodeVisibility { uuid: "unknown".into(), visible: false },
    ]).unwrap_err(), "VISIBILITY_TARGET_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn cube_render_order_preserves_pinned_values_through_edit_export_and_history() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    for order in ["default", "behind", "in_front"] {
        wire["elements"][0]["render_order"] = json!(order);
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        let original = session.document().clone();
        session.apply(0, &[EditOperation::SetNodeVisibility {
            uuid: CUBE.into(), visible: false,
        }]).unwrap();
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        assert_eq!(saved["elements"][0]["render_order"], json!(order));
        assert_eq!(saved["textures"], wire["textures"]);
        assert_eq!(saved["animations"], wire["animations"]);
        assert_eq!(saved["outliner"], wire["outliner"]);
        let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
        assert_eq!(reopened, *session.document());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &original);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &reopened);
    }
}

#[test]
fn invalid_cube_render_order_is_refused_without_coercing_imported_data() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    for invalid in [json!("overlay"), json!(2), Value::Null, json!(false)] {
        wire["elements"][0]["render_order"] = invalid;
        assert_eq!(
            AuthoringDocument::import_bbmodel(&serde_json::to_vec(&wire).unwrap()).unwrap_err(),
            "CUBE_RENDER_ORDER_INVALID"
        );
    }
}

#[test]
fn ambiguous_per_texture_uv_flags_refuse_remap_and_preserve_source() {
    for location in ["meta", "project"] {
        for flag in [json!("true"), json!(1), Value::Null, json!({"unknown":true})] {
            let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
            wire["elements"][0]["autouv"] = json!(2);
            if location == "meta" {
                wire["meta"]["per_texture_uv_size"] = flag.clone();
            } else {
                wire["per_texture_uv_size"] = flag.clone();
            }
            let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
            let initial = session.document().clone();
            assert!(has_per_texture_uv_rules(session.document()));
            assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
                uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
            }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
            assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
                uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
            }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
            assert_eq!(session.document(), &initial);
            assert_eq!(session.summary().revision, 0);
            let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
            let actual = if location == "meta" {
                &saved["meta"]["per_texture_uv_size"]
            } else {
                &saved["per_texture_uv_size"]
            };
            assert_eq!(actual, &flag);
            assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
                initial);
        }
    }
}

#[test]
fn explicit_false_per_texture_uv_flags_leave_project_resolution_enabled() {
    for location in ["meta", "project"] {
        let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
        wire["elements"][0]["autouv"] = json!(2);
        if location == "meta" {
            wire["meta"]["per_texture_uv_size"] = json!(false);
        } else {
            wire["per_texture_uv_size"] = json!(false);
        }
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        assert!(!has_per_texture_uv_rules(session.document()));
        let receipt = session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap();
        assert_eq!(receipt.revision, 1);
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        let retained = if location == "meta" {
            &saved["meta"]["per_texture_uv_size"]
        } else {
            &saved["per_texture_uv_size"]
        };
        assert_eq!(retained, &json!(false));
        assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
            *session.document());
    }
}

#[test]
fn outliner_structure_creation_removal_and_history_are_one_rust_authority() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Hierarchy", "hierarchy").unwrap()
    ).unwrap();
    let root: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0,0,0]
    })).unwrap();
    let child_id = "00000000-0000-4000-8000-000000000003";
    let child: Bone = serde_json::from_value(json!({
        "uuid": child_id, "name": "nested", "origin": [0,2,0]
    })).unwrap();
    let receipt = session.apply(0, &[
        EditOperation::AddBone { bone: root, parent_uuid: None },
        EditOperation::AddBone { bone: child, parent_uuid: Some(BONE.into()) },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: child_id.into() },
    ]).unwrap();
    assert_eq!(receipt.operation_count, 3);
    assert_eq!(session.document().cubes.len(), 1);
    assert_eq!(session.document().bones.len(), 2);
    let before_removal = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::RemoveEmptyBone {
        uuid: child_id.into(),
    }]).unwrap_err(), "BONE_NOT_EMPTY");
    assert_eq!(session.document(), &before_removal);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::RemoveCube { uuid: CUBE.into() }]).unwrap();
    assert!(session.document().cubes.is_empty());
    assert!(matches!(&session.document().hierarchy[0], OutlinerNode::Bone(group)
        if matches!(&group.children[0], OutlinerNode::Bone(child) if child.children.is_empty())));
    let after_cube_removal = session.document().clone();
    session.apply(2, &[EditOperation::RemoveEmptyBone { uuid: child_id.into() }]).unwrap();
    assert_eq!(session.document().bones.len(), 1);
    let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reimported, *session.document());
    session.undo(3).unwrap();
    assert_eq!(session.document(), &after_cube_removal);
    session.undo(4).unwrap();
    assert_eq!(session.document(), &before_removal);
    session.redo(5).unwrap();
    session.redo(6).unwrap();
    assert_eq!(session.document(), &reimported);
    assert_eq!(session.apply(7, &[EditOperation::RemoveCube {
        uuid: "absent".into(),
    }]).unwrap_err(), "CUBE_NOT_FOUND");
}

#[test]
fn deleting_referenced_elements_refuses_without_mutating_opaque_assets() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["vendor_extension"]["linked_cube"] = json!(CUBE);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::RemoveCube {
        uuid: CUBE.into(),
    }]).unwrap_err(), "ELEMENT_OPAQUE_REFERENCES");
    assert_eq!(session.document(), &original);
    // The nested bone is referenced by the imported animation payload.
    assert_eq!(session.apply(0, &[
        EditOperation::RemoveCube { uuid: "unknown".into() },
        EditOperation::RemoveEmptyBone { uuid: "00000000-0000-4000-8000-000000000003".into() },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(saved["vendor_extension"], wire["vendor_extension"]);
}

#[test]
fn deleting_one_cube_in_a_batch_rolls_back_if_later_operation_fails() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::RemoveCube { uuid: CUBE.into() },
        EditOperation::RemoveCube { uuid: CUBE.into() },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn new_animation_and_bone_rotation_keyframe_edit_preserve_document_roundtrip() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let id = "00000000-0000-4000-8000-000000000320";
    let key = "00000000-0000-4000-8000-000000000321";
    let bone = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: id.into(), name: "animation.new".into(), length: 1.5,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: id.into(), bone_uuid: bone.into(), keyframe_uuid: key.into(),
            time: 0.5, rotation: [0.0, 45.0, -15.0],
        }
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(session.document().animation_assets.len(), original.animation_assets.len() + 1);
    assert_eq!(session.document().animation_assets[0], original.animation_assets[0]);
    let new = session.document().animation_assets.last().unwrap();
    assert_eq!(new["uuid"], json!(id));
    assert_eq!(new["animators"][bone]["keyframes"][0]["channel"], json!("rotation"));
    assert_eq!(new["animators"][bone]["keyframes"][0]["data_points"][0]["y"], json!("45"));
    let exported = session.export().unwrap();
    let saved: Value = serde_json::from_slice(&exported).unwrap();
    let source: Value = serde_json::from_str(TEXTURED).unwrap();
    assert_eq!(saved["textures"], source["textures"]);
    assert_eq!(saved["animation_controllers"], source["animation_controllers"]);
    assert_eq!(saved["outliner"], source["outliner"]);
    let reopened = AuthoringDocument::import_bbmodel(&exported).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn animation_edits_refuse_invalid_targets_and_duplicate_rotation_frames_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let key = "00000000-0000-4000-8000-000000000321";
    session.apply(0, &[EditOperation::CreateAnimation {
        uuid: anim.into(), name: "animation.new".into(), length: 1.0,
    }]).unwrap();
    let initial = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::CreateAnimation {
        uuid: "00000000-0000-4000-8000-000000000399".into(),
        name: "animation.new".into(), length: 1.0,
    }]).unwrap_err(), "ANIMATION_CREATION_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: "missing".into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap_err(), "ANIMATION_BONE_NOT_FOUND");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 2.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_TIME_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [f64::NAN, 0.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_INVALID");
    assert_eq!(session.document(), &initial);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(2, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: "00000000-0000-4000-8000-000000000322".into(),
        time: 0.0, rotation: [0.0, 90.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CONFLICT");
    assert_eq!(session.apply(2, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.5, rotation: [0.0, 90.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 2);
}

#[test]
fn bone_rotation_edit_preserves_nested_outliner_opaque_assets_and_history() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let bone_uuid = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: bone_uuid.into(), rotation: [0.0, 22.5, -10.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().bones[1].extra["rotation"], json!([0.0, 22.5, -10.0]));
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let saved = session.export().unwrap();
    let reopened = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    session.apply(3, &[EditOperation::SetBoneRotation {
        uuid: bone_uuid.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap();
    assert_eq!(session.document().bones[1].extra.get("rotation"), None);
    assert_eq!(session.document().animation_assets, original.animation_assets);
}

#[test]
fn invalid_or_noop_bone_rotation_does_not_consume_a_revision() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: BONE.into(), rotation: [f64::NAN, 0.0, 0.0],
    }]).unwrap_err(), "BONE_ROTATION_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: "missing".into(), rotation: [0.0, 45.0, 0.0],
    }]).unwrap_err(), "BONE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: BONE.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn editing_and_removing_known_rotation_frames_is_atomic_and_undoable() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let a = "00000000-0000-4000-8000-000000000321";
    let b = "00000000-0000-4000-8000-000000000322";
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: anim.into(), name: "animation.new".into(), length: 2.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: a.into(), time: 0.0, rotation: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: b.into(), time: 1.0, rotation: [0.0, 90.0, 0.0],
        },
    ]).unwrap();
    let before = session.document().clone();
    session.apply(1, &[EditOperation::UpdateBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: b.into(), time: 1.5, rotation: [0.0, 45.0, -15.0],
    }]).unwrap();
    let frames = &session.document().animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(frames[1]["time"], json!(1.5));
    assert_eq!(frames[1]["data_points"][0]["y"], json!("45"));
    let updated = session.document().clone();
    session.apply(2, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: a.into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]["keyframes"].as_array().unwrap().len(), 1);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(3).unwrap();
    assert_eq!(session.document(), &updated);
    session.undo(4).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(5).unwrap();
    session.redo(6).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn updating_unsupported_or_conflicting_frames_refuses_without_partial_changes() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let a = "00000000-0000-4000-8000-000000000321";
    let b = "00000000-0000-4000-8000-000000000322";
    session.apply(0, &[
        EditOperation::CreateAnimation { uuid: anim.into(), name: "animation.new".into(), length: 2.0 },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: a.into(), time: 0.0, rotation: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: b.into(), time: 1.0, rotation: [0.0, 90.0, 0.0],
        },
    ]).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::UpdateBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: a.into(), time: 1.0, rotation: [0.0, 15.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CONFLICT");
    assert_eq!(session.apply(1, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: "unknown".into(),
    }]).unwrap_err(), "ANIMATION_KEYFRAME_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);
    let wire: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    let mut edited_wire = wire.clone();
    edited_wire["animations"][0]["animators"][BONE]["keyframes"][0]["interpolation"] = json!("bezier");
    let mut imported = EditorSession::open(&serde_json::to_vec(&edited_wire).unwrap()).unwrap();
    let original_advanced = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: a.into(),
    }]).unwrap_err(), "ANIMATION_KEYFRAME_UNSUPPORTED");
    assert_eq!(imported.document(), &original_advanced);
}

#[test]
fn duplicate_cube_preserves_imported_geometry_faces_and_outliner_order_with_history() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let clone = "00000000-0000-4000-8000-000000000005";
    let receipt = session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: clone.into(),
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.changed_uuids, vec![clone.to_string()]);
    assert_eq!(session.document().cubes.len(), 2);
    let copied = &session.document().cubes[1];
    assert_eq!(copied.uuid, clone);
    let mut original_copy = original.cubes[0].clone();
    original_copy.uuid = clone.into();
    assert_eq!(*copied, original_copy);
    assert_eq!(session.document().cubes[0], original.cubes[0]);
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let nested = match &session.document().hierarchy[0] {
        OutlinerNode::Bone(root) => match &root.children[0] {
            OutlinerNode::Bone(child) => child,
            _ => panic!("missing nested bone"),
        },
        _ => panic!("missing root bone"),
    };
    assert!(matches!(&nested.children[..], [OutlinerNode::Cube(source), OutlinerNode::Cube(duplicate)]
        if source.as_str() == CUBE && duplicate.as_str() == clone));
    let exported = session.export().unwrap();
    let imported = AuthoringDocument::import_bbmodel(&exported).unwrap();
    assert_eq!(imported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &imported);
}

#[test]
fn duplicate_cube_rejects_missing_or_colliding_ids_and_atomic_bad_batches() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    let new_uuid = "00000000-0000-4000-8000-000000000005";
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: "missing".into(), new_uuid: new_uuid.into(),
    }]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: CUBE.into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: BONE.into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.apply(0, &[
        EditOperation::DuplicateCube {
            source_uuid: CUBE.into(), new_uuid: new_uuid.into(),
        },
        EditOperation::DuplicateCube {
            source_uuid: CUBE.into(), new_uuid: new_uuid.into(),
        },
    ]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn duplicate_cube_refuses_opaque_self_reference_without_erasing_source_data() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["linked_uuid"] = json!(CUBE);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(),
        new_uuid: "00000000-0000-4000-8000-000000000005".into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_SELF_REFERENCE_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn reparent_cube_preserves_saved_data_and_moves_only_the_outliner_reference() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let root = BONE;
    let child = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[EditOperation::ReparentNode {
        uuid: CUBE.into(), parent_uuid: Some(root.into()),
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.changed_uuids, vec![CUBE.to_string()]);
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    assert_eq!(session.document().extensions, original.extensions);
    assert_eq!(
        outliner_parent_uuid(&session.document().hierarchy, CUBE, None),
        Some(Some(root.to_string()))
    );
    let nested = find_visibility_group(&session.document().hierarchy, child).unwrap();
    assert!(nested.children.is_empty());
    let saved = session.export().unwrap();
    let reimported = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reimported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reimported);
    assert_eq!(session.apply(3, &[EditOperation::ReparentNode {
        uuid: CUBE.into(), parent_uuid: Some(root.into()),
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 3);
}

#[test]
fn reparent_bone_to_root_and_nested_parent_keeps_descendants_and_animations() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let child = "00000000-0000-4000-8000-000000000003";
    session.apply(0, &[EditOperation::ReparentNode {
        uuid: child.into(), parent_uuid: None,
    }]).unwrap();
    assert_eq!(outliner_parent_uuid(&session.document().hierarchy, child, None), Some(None));
    assert_eq!(
        outliner_parent_uuid(&session.document().hierarchy, CUBE, None),
        Some(Some(child.to_string()))
    );
    let moved = find_visibility_group(&session.document().hierarchy, child).unwrap();
    assert_eq!(moved.is_open, Some(true));
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    session.apply(1, &[EditOperation::ReparentNode {
        uuid: child.into(), parent_uuid: Some(BONE.into()),
    }]).unwrap();
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 2);
    session.undo(2).unwrap();
    assert_eq!(outliner_parent_uuid(&session.document().hierarchy, child, None), Some(None));
    session.redo(3).unwrap();
    assert_eq!(session.document(), &original);
}

#[test]
fn reparent_rejects_cycles_root_cube_unknown_targets_and_atomic_bad_batches() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let child = "00000000-0000-4000-8000-000000000003";
    let wrong = "00000000-0000-4000-8000-000000000099";
    let cases = [
        (BONE, Some(child), "REPARENT_CYCLE"),
        (child, Some(child), "REPARENT_CYCLE"),
        (CUBE, None, "REPARENT_CUBE_REQUIRES_BONE"),
        (CUBE, Some(wrong), "REPARENT_PARENT_NOT_FOUND"),
        (wrong, Some(BONE), "REPARENT_NODE_NOT_FOUND"),
    ];
    for (uuid, parent, expected) in cases {
        assert_eq!(session.apply(0, &[EditOperation::ReparentNode {
            uuid: uuid.into(), parent_uuid: parent.map(str::to_owned),
        }]).unwrap_err(), expected);
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
    assert_eq!(session.apply(0, &[
        EditOperation::ReparentNode { uuid: CUBE.into(), parent_uuid: Some(BONE.into()) },
        EditOperation::ReparentNode { uuid: BONE.into(), parent_uuid: Some(child.into()) },
    ]).unwrap_err(), "REPARENT_CYCLE");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn cube_scale_matches_pinned_inflate_and_pivot_math_with_manual_uv_preservation() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["elements"][0]["inflate"] = json!(1.0);
    wire["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [2.0, 0.5, 1.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    let cube = &session.document().cubes[0];
    assert_eq!(cube.from, [-1.0, 0.5, 0.0]);
    assert_eq!(cube.to, [9.0, 1.5, 4.0]);
    assert_eq!(cube.origin, original.cubes[0].origin);
    assert_eq!(cube.extra["autouv"], json!(0));
    assert_eq!(cube.faces, original.cubes[0].faces);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn cube_scale_refreshes_box_uv_without_changing_saved_atlas_offset() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Scale", "scale").unwrap()
    ).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0,0,0]
    })).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
    ]).unwrap();
    let prior = session.document().cubes[0].clone();
    session.apply(1, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [1.5, 1.0, 1.0],
    }]).unwrap();
    let scaled = &session.document().cubes[0];
    assert_eq!(scaled.from, prior.from);
    assert_eq!(scaled.to[0], prior.from[0] + (prior.to[0] - prior.from[0]) * 1.5);
    assert_eq!(scaled.uv_offset, prior.uv_offset);
    assert_ne!(scaled.faces["north"]["uv"], prior.faces["north"]["uv"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().cubes[0], prior);
}

#[test]
fn invalid_noop_or_partial_cube_scale_refuses_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    for factors in [[0.0, 1.0, 1.0], [-1.0, 1.0, 1.0],
                    [4.1, 1.0, 1.0], [f64::NAN, 1.0, 1.0]] {
        assert_eq!(session.apply(0, &[EditOperation::ScaleCube {
            uuid: CUBE.into(), factors,
        }]).unwrap_err(), "CUBE_SCALE_INVALID");
        assert_eq!(session.document(), &original);
    }
    assert_eq!(session.apply(0, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [1.0, 1.0, 1.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.apply(0, &[
        EditOperation::ScaleCube { uuid: CUBE.into(), factors: [1.5, 1.0, 1.0] },
        EditOperation::ScaleCube { uuid: "missing".into(), factors: [1.2, 1.0, 1.0] },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn compatible_imported_rgba_png_requires_explicit_paint_adoption_and_preserves_bytes() {
    let uuid = "00000000-0000-4000-8000-000000000152";
    let mut authored = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Imported", "imported").unwrap()
    ).unwrap();
    authored.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "sample.png".into(),
    }]).unwrap();
    // Simulate a valid existing embedded PNG that is not LazyDesigner-owned.
    let mut wire: Value = serde_json::from_slice(&authored.export().unwrap()).unwrap();
    wire["textures"][0].as_object_mut().unwrap().remove("paint_owner");
    wire["textures"][0]["uv_width"] = json!(128);
    wire["textures"][0]["uv_height"] = json!(128);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let imported = session.document().clone();
    let original_source = imported.texture_assets[0]["source"].clone();
    assert!(!paint_texture_editable(&imported.texture_assets[0]));
    assert!(paint_texture_adoptable(&imported.texture_assets[0], 128, 128));
    assert_eq!(session.apply(0, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 1, y: 1, rgba: [10, 20, 30, 255],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(session.summary().revision, 0);
    let receipt = session.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert!(paint_texture_editable(&session.document().texture_assets[0]));
    assert_eq!(session.document().texture_assets[0]["source"], original_source);
    assert_eq!(session.document().texture_assets[0]["uv_width"], json!(128));
    assert_eq!(session.document().texture_assets[0]["uv_height"], json!(128));
    let adopted = session.document().clone();
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 1, y: 1, rgba: [10, 20, 30, 255],
    }]).unwrap();
    assert_ne!(session.document().texture_assets[0]["source"], original_source);
    let output = session.export().unwrap();
    let reopened = AuthoringDocument::import_bbmodel(&output).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document(), &adopted);
    session.undo(3).unwrap();
    assert_eq!(session.document(), &imported);
    session.redo(4).unwrap();
    session.redo(5).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn imported_paint_adoption_rejects_opaque_or_external_png_and_bad_batches() {
    let uuid = "00000000-0000-4000-8000-000000000152";
    let mut authored = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Imported", "imported").unwrap()
    ).unwrap();
    authored.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "sample.png".into(),
    }]).unwrap();
    let mut wire: Value = serde_json::from_slice(&authored.export().unwrap()).unwrap();
    wire["textures"][0].as_object_mut().unwrap().remove("paint_owner");
    for (field, value) in [
        ("vendor_extension", json!({"keep":"opaque"})),
        ("relative_path", json!("textures/entity/external.png")),
        ("render_mode", json!("emissive")),
        ("uv_width", json!(64)),
        ("internal", json!(false)),
    ] {
        let mut candidate = wire.clone();
        candidate["textures"][0][field] = value;
        let mut session = EditorSession::open(&serde_json::to_vec(&candidate).unwrap()).unwrap();
        let before = session.document().clone();
        assert!(!paint_texture_adoptable(&before.texture_assets[0], 128, 128));
        assert_eq!(session.apply(0, &[EditOperation::EnableImportedPaintTexture {
            texture_index: 0,
        }]).unwrap_err(), "PAINT_IMPORTED_TEXTURE_UNSUPPORTED");
        assert_eq!(session.document(), &before);
        assert_eq!(session.summary().revision, 0);
    }
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::EnableImportedPaintTexture { texture_index: 0 },
        EditOperation::EnableImportedPaintTexture { texture_index: usize::MAX },
    ]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
    wire["textures"][0]["source"] = json!("data:image/png;base64,AAAA");
    let mut invalid = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let initial = invalid.document().clone();
    assert!(invalid.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).is_err());
    assert_eq!(invalid.document(), &initial);
    assert_eq!(invalid.summary().revision, 0);
}

#[test]
fn imported_rgb_png_is_not_silently_converted_to_rgba_paint_data() {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 128, 128);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&vec![99; 128 * 128 * 3]).unwrap();
    }
    let rgb_source = format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes)
    );
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["textures"] = json!([{
        "uuid": "00000000-0000-4000-8000-000000000152",
        "name": "imported-rgb.png", "source": rgb_source,
        "internal": true, "wrap_mode": "limited",
        "render_mode": "default", "render_sides": "double"
    }]);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert!(paint_texture_adoptable(&before.texture_assets[0], 128, 128));
    assert_eq!(session.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).unwrap_err(), "PAINT_PNG_FORMAT_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn import_png_and_assign_to_cube_use_one_rust_document_and_preserve_original_bytes() {
    let texture_id = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: texture_id.into(), name: "source.png".into(),
    }]).unwrap();
    let original_source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();

    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let prior = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: texture_id.into(), name: "source.png".into(),
            source: original_source.clone(),
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: CUBE.into(), texture_uuid: texture_id.into(),
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(session.document().texture_assets.len(), 1);
    assert_eq!(session.document().texture_assets[0]["source"], json!(original_source));
    assert!(paint_texture_editable(&session.document().texture_assets[0]));
    for (face_name, face) in &session.document().cubes[0].faces {
        assert_eq!(face["texture"], json!(texture_id), "{face_name}");
        assert_eq!(face["uv"], prior.cubes[0].faces[face_name]["uv"]);
    }
    assert_eq!(session.document().bones, prior.bones);
    assert_eq!(session.document().hierarchy, prior.hierarchy);
    assert_eq!(session.document().animation_assets, prior.animation_assets);
    let saved = session.export().unwrap();
    let imported = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(imported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &prior);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &imported);
}

#[test]
fn assigning_texture_preserves_absent_faces_and_opaque_face_extensions() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["faces"]["north"]["texture"] = Value::Null;
    wire["elements"][0]["faces"]["south"]["vendor"] = json!({"retained": true});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let asset_uuid = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: asset_uuid.into(), name: "source.png".into(),
    }]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();
    session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: asset_uuid.into(), name: "source.png".into(), source,
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: CUBE.into(), texture_uuid: asset_uuid.into(),
        },
    ]).unwrap();
    assert!(session.document().cubes[0].faces["north"]["texture"].is_null());
    assert_eq!(session.document().cubes[0].faces["south"]["vendor"], json!({"retained":true}));
    assert_eq!(session.document().cubes[0].faces["south"]["texture"], json!(asset_uuid));
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
}

#[test]
fn invalid_or_unrepresentable_png_import_refuses_without_creating_assets() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let uuid = "00000000-0000-4000-8000-000000000170";
    for (source, error) in [
        ("not-an-embedded-png".to_string(), "PAINT_PNG_SOURCE_INVALID"),
        ("data:image/png;base64,AAAA".to_string(), "PAINT_PNG_DECODE_FAILED"),
        (
            format!("data:image/png;base64,{}", "A".repeat(MAX_IMPORT_PNG_BYTES * 4 / 3 + 10)),
            "PAINT_PNG_TOO_LARGE",
        ),
    ] {
        assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "source.png".into(), source,
        }]).unwrap_err(), error);
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
    assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
        uuid: CUBE.into(), name: "source.png".into(), source: "invalid".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_ID_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: CUBE.into(), texture_uuid: uuid.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: "missing".into(), texture_uuid: uuid.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.document(), &original);
}

#[test]
fn invalid_texture_assignment_rolls_back_prior_import_in_same_batch() {
    let uuid = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "source.png".into(),
    }]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "source.png".into(), source,
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: "missing".into(), texture_uuid: uuid.into(),
        },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn imported_png_dimensions_and_color_depth_are_validated_by_the_shared_decoder() {
    fn png_source(width: u32, height: u32, color: png::ColorType) -> String {
        let mut bytes = Vec::new();
        let channels = if color == png::ColorType::Rgb { 3 } else { 4 };
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(
                &vec![0; width as usize * height as usize * channels]
            ).unwrap();
        }
        format!("data:image/png;base64,{}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD, &bytes,
        ))
    }
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let uuid = "00000000-0000-4000-8000-000000000170";
    for source in [
        png_source(16, 16, png::ColorType::Rgba),
        png_source(128, 128, png::ColorType::Rgb),
    ] {
        assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "imported.png".into(), source,
        }]).unwrap_err(), "PAINT_PNG_FORMAT_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
}

#[test]
fn empty_project_atlas_resolution_is_an_explicit_reversible_rust_edit() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap()
    ).unwrap();
    let original = session.document().clone();
    assert!(can_set_empty_atlas_resolution(session.document()));
    let receipt = session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 64, height: 32,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!([session.document().resolution.width, session.document().resolution.height],
        [64, 32]);
    assert_eq!(session.document().resolution.extra, original.resolution.extra);
    assert_eq!(session.document().extensions, original.extensions);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    let encoded = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&encoded).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    assert_eq!(session.apply(3, &[EditOperation::SetEmptyAtlasResolution {
        width: 64, height: 32,
    }]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn atlas_resolution_refuses_invalid_size_or_existing_authored_data_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap()
    ).unwrap();
    let before = session.document().clone();
    for [width, height] in [[0, 64], [64, 0], [257, 64], [64, 257]] {
        assert_eq!(session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
            width, height,
        }]).unwrap_err(), "ATLAS_RESOLUTION_UNSUPPORTED");
    }
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
    let cube_session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    assert!(!can_set_empty_atlas_resolution(cube_session.document()));
    let original_cube = cube_session.document().clone();
    let mut cube_session = cube_session;
    assert_eq!(cube_session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 32, height: 32,
    }]).unwrap_err(), "ATLAS_RESOLUTION_LOCKED");
    assert_eq!(cube_session.document(), &original_cube);
    let mut imported = before.clone();
    imported.extensions.insert("vendor_extension".into(), json!({"retain":true}));
    let mut imported = EditorSession::from_document(imported).unwrap();
    assert!(!can_set_empty_atlas_resolution(imported.document()));
    assert_eq!(imported.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 16, height: 16,
    }]).unwrap_err(), "ATLAS_RESOLUTION_LOCKED");
}

#[test]
fn empty_atlas_resize_and_matching_png_import_can_commit_atomically() {
    let id = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Source", "source").unwrap()
    ).unwrap();
    produced.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 64, height: 64 },
        EditOperation::CreatePaintTexture { uuid: id.into(), name: "64.png".into() },
    ]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();

    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Target", "target").unwrap()
    ).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 64, height: 64 },
        EditOperation::ImportPaintTexture {
            uuid: id.into(), name: "64.png".into(), source: source.clone(),
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().resolution.width, 64);
    assert_eq!(session.document().resolution.height, 64);
    assert_eq!(session.document().texture_assets[0]["source"], json!(source));
    assert!(!can_set_empty_atlas_resolution(session.document()));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().texture_assets.len(), 1);
}
