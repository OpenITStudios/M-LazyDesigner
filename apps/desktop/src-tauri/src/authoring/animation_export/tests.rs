// TEST_AUTHORED_NOT_RUN: original domain regressions moved intact under test hold.
use super::*;
use super::super::{EditOperation, EditorSession, AnimationEffectPoint, BezierKeyframeHandles};

const SAMPLE: &str = include_str!("../../../fixtures/bedrock-basic.bbmodel");
const BONE: &str = "00000000-0000-4000-8000-000000000001";
const CLIP: &str = "00000000-0000-4000-8000-000000009971";
const FIRST: &str = "00000000-0000-4000-8000-000000009972";
const SECOND: &str = "00000000-0000-4000-8000-000000009973";

#[test]
fn exports_numeric_step_with_blockbench_axes_without_mutating_bbmodel() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.walk".into(), length: 2.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "position".into(), time: 0.0, value: [1.0, 2.0, 3.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "position".into(), time: 1.0, value: [4.0, 5.0, 6.0],
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "position".into(), interpolation: "step".into(),
        },
    ]).unwrap();
    let before = s.document().clone();
    let output = export_bedrock_animations(s.document()).unwrap();
    let data: Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(data["format_version"], "1.8.0");
    assert_eq!(data["animations"]["animation.walk"]["animation_length"], 2.0);
    assert_eq!(data["animations"]["animation.walk"]["bones"]["root_bone"]["position"]["0.0"],
        json!([-1.0,2.0,3.0]));
    assert_eq!(data["animations"]["animation.walk"]["bones"]["root_bone"]["position"]["1.0"],
        json!({"pre":[-1.0,2.0,3.0],"post":[-4.0,5.0,6.0]}));
    assert_eq!(s.document(), &before);
    assert_eq!(EditorSession::open(&s.export().unwrap()).unwrap().document(), &before);
}

#[test]
fn effects_export_as_runtime_metadata_and_keep_editor_only_markers() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.idle".into(), length: 1.0 },
        EditOperation::AddAnimationEffectEvent {
            animation_uuid: CLIP.into(), keyframe_uuid: FIRST.into(),
            channel: "particle".into(), time: 0.5,
            points: vec![AnimationEffectPoint {
                effect: "particles.spark".into(), locator: Some("hand".into()),
                bind_to_actor: Some(false),
            }],
        },
        EditOperation::AddAnimationTimelineMarker {
            animation_uuid: CLIP.into(), time: 0.25, name: "anticipation".into(), color: 2,
        },
        EditOperation::SetAnimationLoopMode { animation_uuid: CLIP.into(), mode: "hold".into() },
    ]).unwrap();
    let before = s.document().clone();
    let data: Value = serde_json::from_slice(&export_bedrock_animations(s.document()).unwrap()).unwrap();
    let clip = &data["animations"]["animation.idle"];
    assert_eq!(clip["loop"], "hold_on_last_frame");
    assert_eq!(clip["particle_effects"]["0.5"],
        json!({"effect":"particles.spark","locator":"hand","bind_to_actor":false}));
    assert!(clip.get("timeline").is_none());
    assert_eq!(s.document(), &before);
    assert_eq!(s.document().animation_assets[0]["markers"][0]["name"], "anticipation");
}

#[test]
fn catmullrom_uses_native_bedrock_lerp_mode_and_preserves_opaque_refusal() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.walk".into(), length: 2.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "rotation".into(), time: 0.0, value: [12.0, 34.0, 56.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "rotation".into(), time: 1.0, value: [24.0, 32.0, 42.0],
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "rotation".into(), interpolation: "catmullrom".into(),
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "rotation".into(), interpolation: "catmullrom".into(),
        },
    ]).unwrap();
    assert_eq!(bedrock_animation_curve_fidelity(s.document()), "native");
    let saved = s.export().unwrap();
    let out: Value = serde_json::from_slice(
        &export_bedrock_animations(s.document()).unwrap()).unwrap();
    let rotation = &out["animations"]["animation.walk"]["bones"]["root_bone"]["rotation"];
    assert_eq!(rotation["0.0"], json!({"post":[-12.0,-34.0,56.0],"lerp_mode":"catmullrom"}));
    assert_eq!(rotation["1.0"], json!({"post":[-24.0,-32.0,42.0],"lerp_mode":"catmullrom"}));
    assert_eq!(s.export().unwrap(), saved);
    let mut unknown = s.document().clone();
    unknown.animation_assets[0]["unrecognized_payload"] = json!({"script":"opaque"});
    assert_eq!(export_bedrock_animations(&unknown).unwrap_err(),
        "ANIMATION_EXPORT_CLIP_UNSUPPORTED");
}

#[test]
fn mixed_linear_to_catmullrom_emits_explicit_pre_without_baking() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    const THIRD: &str = "00000000-0000-4000-8000-000000009974";
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.mix".into(), length: 3.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "position".into(), time: 0.0, value: [1.0, 2.0, 3.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "position".into(), time: 1.0, value: [4.0, 5.0, 6.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: THIRD.into(),
            channel: "position".into(), time: 2.0, value: [7.0, 8.0, 9.0],
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "position".into(), interpolation: "catmullrom".into(),
        },
        EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: THIRD.into(),
            channel: "position".into(), interpolation: "catmullrom".into(),
        },
    ]).unwrap();
    let out: Value = serde_json::from_slice(
        &export_bedrock_animations(s.document()).unwrap()).unwrap();
    let track = &out["animations"]["animation.mix"]["bones"]["root_bone"]["position"];
    assert_eq!(track.as_object().unwrap().len(), 3);
    assert_eq!(track["1.0"],
        json!({"pre":[-4.0,5.0,6.0],"post":[-4.0,5.0,6.0],"lerp_mode":"catmullrom"}));
    assert_eq!(track["2.0"],
        json!({"post":[-7.0,8.0,9.0],"lerp_mode":"catmullrom"}));
}

#[test]
fn bezier_is_baked_with_bounded_adaptive_keys_without_changing_editor_clip() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let first = BezierKeyframeHandles {
        linked: false,
        left_time: [-0.1; 3], left_value: [0.0; 3],
        right_time: [0.1; 3], right_value: [8.0, 0.0, 0.0],
    };
    let second = BezierKeyframeHandles {
        linked: false,
        left_time: [-0.1; 3], left_value: [-8.0, 0.0, 0.0],
        right_time: [0.1; 3], right_value: [0.0; 3],
    };
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.ease".into(), length: 1.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "position".into(), time: 0.0, value: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "position".into(), time: 1.0, value: [10.0, 0.0, 0.0],
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "position".into(), handles: first,
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "position".into(), handles: second,
        },
    ]).unwrap();
    assert_eq!(bedrock_animation_curve_fidelity(s.document()),
        "adaptive_bezier_approximation");
    let saved = s.export().unwrap();
    let data: Value = serde_json::from_slice(
        &export_bedrock_animations(s.document()).unwrap()).unwrap();
    let track = data["animations"]["animation.ease"]["bones"]["root_bone"]["position"]
        .as_object().unwrap();
    assert!(track.len() > 2);
    assert!(track.len() < MAX_BAKED_CHANNEL_KEYS);
    assert_eq!(track["0.0"], json!([0.0, 0.0, 0.0]));
    assert_eq!(track["1.0"], json!([-10.0, 0.0, 0.0]));
    assert!(track.iter().any(|(time, value)|
        time.parse::<f64>().is_ok_and(|time| time > 0.0 && time < 1.0) &&
        value.as_array().is_some()));
    assert_eq!(s.export().unwrap(), saved);
    assert_eq!(EditorSession::open(&saved).unwrap().document(), s.document());
}

// Source-authored only: this fixture covers many Bone tracks without
// changing the document or depending on hash iteration order.
#[test]
fn indexed_many_bone_tracks_export_exact_channels_deterministically() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let mut operations = vec![EditOperation::CreateAnimation {
        uuid: CLIP.into(), name: "animation.many".into(), length: 2.0,
    }];
    for index in 0..16 {
        let bone_uuid = format!("00000000-0000-4000-8000-{:012}", 4000 + index);
        let frame_uuid = format!("00000000-0000-4000-8000-{:012}", 6000 + index);
        operations.push(EditOperation::AddBone {
            bone: super::super::Bone {
                uuid: bone_uuid.clone(), name: format!("limb_{index}"),
                origin: Some([0.0, 0.0, 0.0]), extra: Map::new(),
            },
            parent_uuid: Some(BONE.into()),
        });
        operations.push(EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid, keyframe_uuid: frame_uuid,
            channel: "position".into(), time: 1.0,
            value: [index as f64, index as f64 * 0.5, 2.0],
        });
    }
    s.apply(0, &operations).unwrap();
    let source = s.document().clone();
    let saved = s.export().unwrap();
    let first = export_bedrock_animations(s.document()).unwrap();
    assert_eq!(first, export_bedrock_animations(s.document()).unwrap());
    let json: Value = serde_json::from_slice(&first).unwrap();
    let bones = json["animations"]["animation.many"]["bones"].as_object().unwrap();
    assert_eq!(bones.len(), 16);
    for index in 0..16 {
        let key = format!("limb_{index}");
        let position = &bones[&key]["position"]["1.0"];
        assert_eq!(position, &json!([- (index as f64), index as f64 * 0.5, 2.0]));
    }
    assert_eq!(s.document(), &source);
    assert_eq!(s.export().unwrap(), saved);
    assert_eq!(EditorSession::open(&saved).unwrap().document(), &source);
}

#[test]
fn unsafe_scale_bezier_fails_without_altering_source_model() {
    let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    s.apply(0, &[
        EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.unsafe".into(), length: 1.0 },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "scale".into(), time: 0.0, value: [1.0, 1.0, 1.0],
        },
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "scale".into(), time: 1.0, value: [1.0, 1.0, 1.0],
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
            channel: "scale".into(), handles: BezierKeyframeHandles {
                linked: false,
                left_time: [-0.1; 3], left_value: [0.0; 3],
                right_time: [0.1; 3], right_value: [1000.0, 0.0, 0.0],
            },
        },
        EditOperation::SetBoneTransformKeyframeBezier {
            animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: SECOND.into(),
            channel: "scale".into(), handles: BezierKeyframeHandles {
                linked: false,
                left_time: [-0.1; 3], left_value: [1000.0, 0.0, 0.0],
                right_time: [0.1; 3], right_value: [0.0; 3],
            },
        },
    ]).unwrap();
    let original = s.export().unwrap();
    assert_eq!(export_bedrock_animations(s.document()).unwrap_err(),
        "ANIMATION_EXPORT_BAKE_VALUE_UNSUPPORTED");
    assert_eq!(s.export().unwrap(), original);
}
