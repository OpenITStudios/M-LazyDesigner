// TEST_AUTHORED_NOT_RUN: original domain regressions moved intact under test hold.
use super::*;
const SOURCE: &[u8] = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
const BONE: &str = "00000000-0000-4000-8000-000000000001";
const CLIP: &str = "00000000-0000-4000-8000-000000008811";
fn request() -> SemanticAnimationIntent {
    SemanticAnimationIntent {
        expected_revision: 0, animation_uuid: CLIP.into(), name: "slam".into(),
        length_seconds: 1.0, loop_mode: "once".into(),
        poses: vec![
            SemanticAnimationPose { time: 0.0, phase: "neutral".into(),
                transforms: vec![SemanticAnimationTransform {
                    bone_uuid: BONE.into(), channel: "rotation".into(), value: [0.0;3], interpolation:None,
                }] },
            SemanticAnimationPose { time: 0.5, phase: "impact".into(),
                transforms: vec![SemanticAnimationTransform {
                    bone_uuid: BONE.into(), channel: "rotation".into(), value: [30.0,0.0,0.0], interpolation:None,
                }] },
            SemanticAnimationPose { time: 1.0, phase: "recovery".into(),
                transforms: vec![SemanticAnimationTransform {
                    bone_uuid: BONE.into(), channel: "rotation".into(), value: [0.0;3], interpolation:None,
                }] }
        ],
        contacts: vec![SemanticContactWindow {
            bone_uuid: BONE.into(), kind: "grip".into(),
            start: 0.25, end: 0.75,
        }],
        followers: vec![],
        probes: vec![],
    }
}
#[test]
fn pose_plan_is_read_only_deterministic_and_undoable() {
    let s = EditorSession::open(SOURCE).unwrap();
    let before = s.export().unwrap();
    let p = compile(&s, &request()).unwrap();
    let p2 = compile(&s, &request()).unwrap();
    assert_eq!(serde_json::to_value(&p.plan).unwrap(),
        serde_json::to_value(&p2.plan).unwrap());
    assert_eq!(p.preflight["status"], "VALIDATED_NOT_APPLIED");
    assert_eq!(p.plan.operations.len(), 5);
    assert_eq!(p.motion_evidence["keyframe_count"], 3);
    assert_eq!(p.motion_evidence["contact_windows"][0]["contact_verdict"],
        "REQUIRES_NATIVE_WORLD_SPACE_OBSERVATION");
    assert_eq!(p.motion_evidence["tracks"][0]["loop_endpoint_equal"], Value::Null);
    assert_eq!(s.export().unwrap(), before);
    let mut editor = s.clone();
    editor.apply(0, &p.plan.operations).unwrap();
    assert_eq!(editor.document().animation_assets.last().unwrap()["name"], "slam");
    assert_eq!(editor.document().bones, s.document().bones);
    assert_eq!(editor.undo(1).unwrap().revision,2);
    assert_eq!(editor.export().unwrap(),before);
}
#[test]
fn rejects_invalid_rig_pose_clock_and_contact_without_edit() {
    let s = EditorSession::open(SOURCE).unwrap();
    let mut r = request(); r.expected_revision=1;
    assert_eq!(compile(&s,&r).unwrap_err(), "DOCUMENT_REVISION_STALE");
    r=request(); r.poses[1].time = r.poses[0].time;
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_POSE_INVALID");
    r=request(); r.poses[1].transforms[0].bone_uuid="missing".into();
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_TRANSFORM_INVALID");
    r=request(); r.poses[1].transforms[0].value[0]=f64::NAN;
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_TRANSFORM_INVALID");
    r=request(); r.contacts[0].end=1.1;
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_CONTACT_INVALID");
    r=request(); r.loop_mode="unexpected".into();
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_INPUT_INVALID");
    r=request(); let duplicate=r.poses[0].transforms[0].clone();
    r.poses[0].transforms.push(duplicate);
    assert_eq!(compile(&s,&r).unwrap_err(), "SEMANTIC_ANIMATION_TRANSFORM_INVALID");
}
const FOLLOWER: &str = "00000000-0000-4000-8000-000000008812";
fn source_with_follower() -> EditorSession {
    let mut session=EditorSession::open(SOURCE).unwrap();
    session.apply(0,&[EditOperation::AddBone {
        bone:super::super::Bone {
            uuid:FOLLOWER.into(),name:"cape".into(),
            origin:Some([0.0,0.0,0.0]),extra:serde_json::Map::new(),
        },parent_uuid:Some(BONE.into()),
    }]).unwrap();
    session
}
#[test]
fn secondary_lagged_bone_keys_are_deterministic_and_undoable() {
    let session=source_with_follower();
    let before=session.export().unwrap();
    let mut r=request();
    r.expected_revision=1;
    r.contacts.clear();
    r.poses[1].time=0.4;
    r.poses[2].time=0.8;
    r.followers=vec![SemanticAnimationFollower {
        driver_bone_uuid:BONE.into(),follower_bone_uuid:FOLLOWER.into(),
        channel:"rotation".into(),lag_seconds:0.1,gain:0.5,
        rest_value:[0.0;3],
    }];
    let proposal=compile(&session,&r).unwrap();
    let again=compile(&session,&r).unwrap();
    assert_eq!(serde_json::to_value(&proposal.plan).unwrap(),
        serde_json::to_value(&again.plan).unwrap());
    assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
    assert_eq!(proposal.motion_evidence["track_count"],2);
    assert_eq!(proposal.motion_evidence["keyframe_count"],8);
    assert_eq!(proposal.motion_evidence["secondary_followers"][0]["derived_key_count"],5);
    assert_eq!(proposal.motion_evidence["secondary_verdict"],"SOURCE_LINEAR_LAG_ONLY");
    assert_eq!(proposal.motion_evidence["temporal_review_times"],
        json!([0.0,0.1,0.4,0.5,0.8,0.9,1.0]));
    assert_eq!(session.export().unwrap(),before);
    let follower_keys:Vec<_>=proposal.plan.operations.iter()
        .filter_map(|op|if let EditOperation::AddBoneTransformKeyframe {
            bone_uuid,time,value,..}=op {
            (bone_uuid.as_str()==FOLLOWER).then_some((*time,*value))
        }else{None}).collect();
    assert_eq!(follower_keys.len(),5);
    assert_eq!(follower_keys[0],(0.0,[0.0;3]));
    assert_eq!(follower_keys[2],(0.5,[15.0,0.0,0.0]));
    assert_eq!(follower_keys[4],(1.0,[0.0;3]));
    let mut edited=session.clone();
    edited.apply(1,&proposal.plan.operations).unwrap();
    assert_eq!(edited.document().animation_assets.last().unwrap()["name"],"slam");
    assert_eq!(edited.undo(2).unwrap().revision,3);
    assert_eq!(edited.export().unwrap(),before);
}
#[test]
fn periodic_follower_preserves_equal_end_values_without_native_claim() {
    let session=source_with_follower();
    let mut r=request(); r.expected_revision=1;
    r.contacts.clear();r.loop_mode="loop".into();r.poses[1].time=0.4;
    r.followers=vec![SemanticAnimationFollower {
        driver_bone_uuid:BONE.into(),follower_bone_uuid:FOLLOWER.into(),
        channel:"rotation".into(),lag_seconds:0.1,gain:0.5,
        rest_value:[0.0;3],
    }];
    let p=compile(&session,&r).unwrap();
    assert_eq!(p.motion_evidence["secondary_followers"][0]
        ["loop_or_settle_endpoint_values_equal"],true);
    assert_eq!(p.motion_evidence["native_playback_verdict"],"NOT_EXECUTED");
    let keys:Vec<_>=p.plan.operations.iter().filter_map(|op|
        if let EditOperation::AddBoneTransformKeyframe{bone_uuid,time,value,..}=op {
            (bone_uuid.as_str()==FOLLOWER).then_some((*time,*value))
        }else{None}).collect();
    assert_eq!(keys[0].0,0.0);
    assert_eq!(keys.last().unwrap().0,1.0);
    assert_eq!(keys[0].1,keys.last().unwrap().1);
}
#[test]
fn follower_refuses_wrong_owner_wrap_tail_and_contact_risks() {
    let session=source_with_follower();
    let mut r=request();r.expected_revision=1;r.contacts.clear();
    r.poses[1].time=0.4;r.poses[2].time=0.8;
    r.followers=vec![SemanticAnimationFollower {
        driver_bone_uuid:BONE.into(),follower_bone_uuid:FOLLOWER.into(),
        channel:"rotation".into(),lag_seconds:0.1,gain:0.5,
        rest_value:[0.0;3],
    }];
    let original=session.export().unwrap();
    let mut bad=r.clone();
    bad.followers[0].driver_bone_uuid=FOLLOWER.into();
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_DRIVER_UNAUTHORED");
    bad=r.clone();bad.followers[0].follower_bone_uuid=BONE.into();
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_INTENT_INVALID");
    bad=r.clone();bad.contacts.push(SemanticContactWindow {
        bone_uuid:FOLLOWER.into(),kind:"grip".into(),
        start:0.1,end:0.4,
    });
    // Contact requires a primary authored channel and cannot be invented
    // for a derived follower; known source-only contact owners refuse.
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_ANIMATION_CONTACT_INVALID");
    bad=r.clone();bad.followers[0].lag_seconds=0.3;
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_DRIVER_UNSAFE");
    bad=r.clone();bad.poses[1].transforms[0].value=[200.0,0.0,0.0];
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_DRIVER_UNSAFE");
    bad=r.clone();bad.loop_mode="loop".into();
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_DRIVER_UNSAFE");
    bad=r.clone();bad.followers.push(bad.followers[0].clone());
    assert_eq!(compile(&session,&bad).unwrap_err(),
        "SEMANTIC_FOLLOWER_INTENT_INVALID");
    assert_eq!(session.export().unwrap(),original);
}
#[test]
fn explicit_native_key_interpolation_reuses_existing_edit_plan() {
    let session=EditorSession::open(SOURCE).unwrap();
    let original=session.export().unwrap();
    let mut r=request();r.contacts.clear();
    r.poses[0].transforms[0].interpolation=Some("step".into());
    r.poses[1].transforms[0].interpolation=Some("catmullrom".into());
    let proposal=compile(&session,&r).unwrap();
    assert_eq!(proposal.plan.operations.len(),7);
    assert_eq!(proposal.motion_evidence["keyframe_count"],3);
    assert_eq!(proposal.motion_evidence["numeric_motion_verdict"],
        "AUTHORED_KEY_SEGMENTS_NOT_INTERPOLATED");
    assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
    let mut changed=session.clone();
    changed.apply(0,&proposal.plan.operations).unwrap();
    let frames=&changed.document().animation_assets.last().unwrap()
        ["animators"][BONE]["keyframes"];
    assert_eq!(frames[0]["interpolation"],"step");
    assert_eq!(frames[1]["interpolation"],"catmullrom");
    assert_eq!(frames[2]["interpolation"],"linear");
    assert_eq!(changed.undo(1).unwrap().revision,2);
    assert_eq!(changed.export().unwrap(),original);
}
#[test]
fn ambiguous_or_contact_unsafe_interpolation_refuses() {
    let session=EditorSession::open(SOURCE).unwrap();
    let mut r=request();
    r.poses[0].transforms[0].interpolation=Some("bezier".into());
    assert_eq!(compile(&session,&r).unwrap_err(),
        "SEMANTIC_ANIMATION_TRANSFORM_INVALID");
    r=request();r.poses[0].transforms[0].interpolation=Some("catmullrom".into());
    assert_eq!(compile(&session,&r).unwrap_err(),
        "SEMANTIC_ANIMATION_INTERPOLATION_CONTACT_UNSAFE");
    r=request();r.contacts.clear();
    r.poses[0].transforms[0].interpolation=Some("catmullrom".into());
    r.poses[1].transforms[0].value=[180.0,0.0,0.0];
    assert_eq!(compile(&session,&r).unwrap_err(),
        "SEMANTIC_ANIMATION_INTERPOLATION_EULER_AMBIGUOUS");
    let session=source_with_follower();
    r=request();r.expected_revision=1;r.contacts.clear();
    r.poses[1].time=0.4;r.poses[2].time=0.8;
    r.poses[0].transforms[0].interpolation=Some("step".into());
    r.followers=vec![SemanticAnimationFollower {
        driver_bone_uuid:BONE.into(),follower_bone_uuid:FOLLOWER.into(),
        channel:"rotation".into(),lag_seconds:0.1,gain:0.5,rest_value:[0.0;3],
    }];
    assert_eq!(compile(&session,&r).unwrap_err(),
        "SEMANTIC_FOLLOWER_DRIVER_INTERPOLATION_UNSUPPORTED");
}
#[test]
fn 3d_marker_preview_uses_source_bone_and_does_not_certify_contact() {
    let s=EditorSession::open(SOURCE).unwrap();
    let before=s.export().unwrap();
    let mut r=request();
    r.probes=vec![SemanticAnimationProbe {
        bone_uuid:BONE.into(),kind:"path".into(),
        local_point:[0.0,1.0,0.0],start:0.0,end:1.0,
    }];
    let proposal=compile(&s,&r).unwrap();
    assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
    let report=&proposal.motion_evidence["marker_trajectories"][0];
    assert_eq!(proposal.motion_evidence["spatial_diagnostic"],
        "SOURCE_MODEL_ZYX_LINEAR_PROXY_ONLY");
    assert_eq!(report["source_space"],"RUST_EDITOR_MODEL_ZYX_PROXY");
    assert_eq!(report["sample_count"],3);
    assert!(report["max_sampled_displacement_from_start"]
        .as_f64().unwrap()>0.1);
    assert_eq!(report["contact_verdict"],"UNVERIFIED");
    assert_eq!(report["native_parity"],"NOT_EXECUTED");
    assert_eq!(s.export().unwrap(),before);
}
#[test]
fn planted_probe_needs_exact_contact_and_linear_participating_chain() {
    let s=EditorSession::open(SOURCE).unwrap();
    let mut r=request();
    r.probes=vec![SemanticAnimationProbe {
        bone_uuid:BONE.into(),kind:"planted".into(),
        local_point:[0.0,1.0,0.0],start:0.25,end:0.75,
    }];
    assert_eq!(compile(&s,&r).unwrap_err(),"TRAJECTORY_PROBE_INVALID");
    r.contacts[0].kind="planted".into();
    let p=compile(&s,&r).unwrap();
    assert_eq!(p.motion_evidence["marker_trajectories"][0]["contact_verdict"],
        "UNVERIFIED");
    r.poses[0].transforms[0].interpolation=Some("step".into());
    assert_eq!(compile(&s,&r).unwrap_err(),
        "TRAJECTORY_NONLINEAR_SOURCE_UNSUPPORTED");
    r.poses[0].transforms[0].interpolation=None;
    r.probes[0].bone_uuid="unknown".into();
    assert_eq!(compile(&s,&r).unwrap_err(),
        "TRAJECTORY_PROBE_INVALID");
}
#[test]
fn legacy_semantic_pose_json_defaults_to_no_followers() {
    let old=serde_json::to_value(request()).unwrap();
    assert!(old.get("followers").is_none());
    let parsed:SemanticAnimationIntent=serde_json::from_value(old).unwrap();
    assert!(parsed.followers.is_empty());
}
#[test]
fn loop_same_values_do_not_certify_tangent_continuity() {
    let s=EditorSession::open(SOURCE).unwrap();
    let mut r=request();
    r.loop_mode="loop".into(); r.contacts.clear();
    let p=compile(&s,&r).unwrap();
    assert_eq!(p.motion_evidence["tracks"][0]["loop_endpoint_equal"],true);
    assert!(p.motion_evidence["tracks"][0]["loop_endpoint_velocity_delta"]
        .as_f64().unwrap()>0.0);
    assert_eq!(p.motion_evidence["native_playback_verdict"],"NOT_EXECUTED");
}
