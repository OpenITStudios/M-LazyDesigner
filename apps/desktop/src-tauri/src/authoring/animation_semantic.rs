//! Read-only semantic pose compiler for NEW numeric Bedrock Bone clips.
//! No procedural solver, inferred gait, native sampling, auto-Apply, or
//! separate Animation/Undo authority. Contacts are review windows, not locks.
use super::{sha256, valid_uuid, valid_node_name, valid_animation_transform_value,
    EditOperation, EditPlan, EditorSession, Result, MAX_OPERATIONS, MAX_PLAN_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAnimationTransform {
    pub bone_uuid: String,
    pub channel: String,
    pub value: [f64; 3],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAnimationPose {
    pub time: f64,
    pub phase: String,
    pub transforms: Vec<SemanticAnimationTransform>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticContactWindow {
    pub bone_uuid: String,
    pub kind: String,
    pub start: f64,
    pub end: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAnimationIntent {
    pub expected_revision: u64,
    pub animation_uuid: String,
    pub name: String,
    pub length_seconds: f64,
    pub loop_mode: String,
    pub poses: Vec<SemanticAnimationPose>,
    pub contacts: Vec<SemanticContactWindow>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SemanticAnimationProposal {
    pub plan: EditPlan,
    pub preflight: Value,
    pub motion_evidence: Value,
}
fn exact_time(value: f64) -> bool {
    value.is_finite() && (0.0..=3600.0).contains(&value) &&
        format!("{value:.9}").parse::<f64>().is_ok_and(|rounded|
            (rounded - value).abs() <= 1e-10)
}
fn key_uuid(clip: &str, bone: &str, channel: &str, pose_index: usize) -> String {
    let digest = sha256(format!(
        "lazydesigner:animation-semantic-poses-v1\0{clip}\0{bone}\0{channel}\0{pose_index}"
    ).as_bytes());
    format!("{}-{}-4{}-8{}-{}", &digest[..8], &digest[8..12],
        &digest[13..16], &digest[17..20], &digest[20..32])
}
fn velocity(a: [f64; 3], b: [f64; 3], dt: f64) -> f64 {
    ((0..3).map(|axis| ((b[axis] - a[axis]) / dt).powi(2))
        .sum::<f64>()).sqrt()
}
fn add_review_time(times: &mut Vec<f64>, time: f64) {
    if times.len() < 8 && !times.iter().any(|old| (old - time).abs() <= 1e-9) {
        times.push(time);
    }
}
pub(super) fn compile(
    session: &EditorSession, request: &SemanticAnimationIntent,
) -> Result<SemanticAnimationProposal> {
    session.check_revision(request.expected_revision)?;
    if serde_json::to_vec(request).map_err(|_|"SEMANTIC_ANIMATION_INPUT_INVALID".to_string())?
        .len() > MAX_PLAN_BYTES {
        return Err("SEMANTIC_ANIMATION_INPUT_TOO_LARGE".into());
    }
    if !valid_uuid(&request.animation_uuid) ||
       !valid_node_name(&request.name) || request.name != request.name.trim() ||
       !exact_time(request.length_seconds) || request.length_seconds <= 0.0 ||
       !matches!(request.loop_mode.as_str(), "once" | "loop" | "hold") ||
       !(2..=32).contains(&request.poses.len()) ||
       request.contacts.len() > 16 {
        return Err("SEMANTIC_ANIMATION_INPUT_INVALID".into());
    }
    let bones: HashSet<&str> = session.document().bones.iter()
        .map(|bone| bone.uuid.as_str()).collect();
    let mut operations = vec![EditOperation::CreateAnimation {
        uuid: request.animation_uuid.clone(),
        name: request.name.clone(), length: request.length_seconds,
    }];
    let mut tracks: BTreeMap<(String, String), Vec<(f64, [f64; 3])>> =
        BTreeMap::new();
    let mut previous_time = -1.0;
    for (pose_index, pose) in request.poses.iter().enumerate() {
        if !exact_time(pose.time) || pose.time > request.length_seconds ||
           pose.time - previous_time <= 1e-6 ||
           !matches!(pose.phase.as_str(),
            "neutral" | "anticipation" | "action" | "impact" | "recovery" |
            "stance" | "pass" | "lift" | "settle" | "contact") ||
           pose.transforms.is_empty() || pose.transforms.len() > 64 {
            return Err("SEMANTIC_ANIMATION_POSE_INVALID".into());
        }
        previous_time = pose.time;
        let mut touched = HashSet::new();
        for transform in &pose.transforms {
            if !valid_uuid(&transform.bone_uuid) ||
               !bones.contains(transform.bone_uuid.as_str()) ||
               !valid_animation_transform_value(&transform.channel, transform.value) ||
               !touched.insert((&transform.bone_uuid, &transform.channel)) {
                return Err("SEMANTIC_ANIMATION_TRANSFORM_INVALID".into());
            }
            if operations.len() >= MAX_OPERATIONS - 1 {
                return Err("SEMANTIC_ANIMATION_OPERATION_BUDGET".into());
            }
            operations.push(EditOperation::AddBoneTransformKeyframe {
                animation_uuid: request.animation_uuid.clone(),
                bone_uuid: transform.bone_uuid.clone(),
                keyframe_uuid: key_uuid(&request.animation_uuid,
                    &transform.bone_uuid, &transform.channel, pose_index),
                channel: transform.channel.clone(),
                time: pose.time, value: transform.value,
            });
            tracks.entry((transform.bone_uuid.clone(), transform.channel.clone()))
                .or_default().push((pose.time, transform.value));
        }
    }
    let mut contact_reports = Vec::new();
    for window in &request.contacts {
        if !valid_uuid(&window.bone_uuid) ||
           !bones.contains(window.bone_uuid.as_str()) ||
           !matches!(window.kind.as_str(), "planted" | "grip") ||
           !exact_time(window.start) || !exact_time(window.end) ||
           window.start >= window.end || window.end > request.length_seconds ||
           !tracks.keys().any(|(bone, _)| bone == &window.bone_uuid) {
            return Err("SEMANTIC_ANIMATION_CONTACT_INVALID".into());
        }
        // A named contact phase does not establish a world-fixed point:
        // a moving hand+weapon is different from a planted foot.
        contact_reports.push(json!({
            "bone_uuid": window.bone_uuid, "kind": window.kind,
            "start": window.start, "end": window.end,
            "observed_world_samples": 0,
            "contact_verdict": "REQUIRES_NATIVE_WORLD_SPACE_OBSERVATION"
        }));
    }
    if operations.len() >= MAX_OPERATIONS {
        return Err("SEMANTIC_ANIMATION_OPERATION_BUDGET".into());
    }
    operations.push(EditOperation::SetAnimationLoopMode {
        animation_uuid: request.animation_uuid.clone(),
        mode: request.loop_mode.clone(),
    });
    // Native preflight remains the only mutation validator. It checks
    // exact Bone/clip identities, unsupported source, collision and Undo.
    let plan = EditPlan {
        expected_revision: request.expected_revision,
        operations, correction_scope: None,
    };
    let preflight = session.preflight(&plan)?;
    let mut track_reports = Vec::new();
    for ((bone, channel), keys) in &tracks {
        let maximum_speed = keys.windows(2)
            .map(|pair| velocity(pair[0].1, pair[1].1, pair[1].0 - pair[0].0))
            .fold(0.0_f64, f64::max);
        // Euler values are NOT assumed to follow the shortest arc.
        let large_euler_step = channel == "rotation" && keys.windows(2).any(|pair|
            (0..3).any(|a| (pair[1].1[a] - pair[0].1[a]).abs() > 180.0));
        let seam = if request.loop_mode == "loop" &&
            keys.first().is_some_and(|key| key.0 == 0.0) &&
            keys.last().is_some_and(|key| key.0 == request.length_seconds) {
            Some((0..3).all(|axis|
                (keys[0].1[axis] - keys[keys.len()-1].1[axis]).abs() <= 1e-6))
        } else { None };
        let seam_velocity_delta = if seam.is_some() && keys.len() >= 3 {
            let a = &keys[0]; let b = &keys[1];
            let y = &keys[keys.len()-2]; let z = &keys[keys.len()-1];
            let left: [f64;3] = std::array::from_fn(|i|
                (b.1[i]-a.1[i])/(b.0-a.0));
            let right: [f64;3] = std::array::from_fn(|i|
                (z.1[i]-y.1[i])/(z.0-y.0));
            Some(((0..3).map(|i| (left[i]-right[i]).powi(2)).sum::<f64>()).sqrt())
        } else { None };
        track_reports.push(json!({
            "bone_uuid": bone, "channel": channel, "key_count": keys.len(),
            "maximum_authored_segment_speed": maximum_speed,
            "has_large_euler_step": large_euler_step,
            "loop_endpoint_equal": seam,
            "loop_endpoint_velocity_delta": seam_velocity_delta,
        }));
    }
    // Prioritize contact phase boundaries and action landmarks before
    // optional pose samples; these are review HINTS, never frame captures.
    let mut review_times = Vec::new();
    add_review_time(&mut review_times, 0.0);
    add_review_time(&mut review_times, request.length_seconds);
    for window in &request.contacts {
        for time in [window.start, (window.start + window.end)*0.5, window.end] {
            add_review_time(&mut review_times, time);
        }
    }
    for pose in &request.poses {
        if matches!(pose.phase.as_str(), "impact" | "contact" | "lift") {
            add_review_time(&mut review_times, pose.time);
        }
    }
    for pose in &request.poses { add_review_time(&mut review_times, pose.time); }
    review_times.sort_by(f64::total_cmp);
    let evidence = json!({
        "scope": "source_bound_semantic_pose_candidate",
        "animation_uuid": request.animation_uuid,
        "loop_mode": request.loop_mode,
        "pose_count": request.poses.len(),
        "keyframe_count": plan.operations.len()-2,
        "track_count": tracks.len(),
        "contact_windows": contact_reports,
        "tracks": track_reports,
        "temporal_review_times": review_times,
        "numeric_motion_verdict": "AUTHORED_LINEAR_SEGMENTS_ONLY",
        "world_contact_verdict": "UNVERIFIED",
        "native_playback_verdict": "NOT_EXECUTED",
        "visual_verdict": "UNVERIFIED",
        "write_authority": "NOT_GRANTED",
    });
    Ok(SemanticAnimationProposal { plan, preflight, motion_evidence: evidence })
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const BONE: &str = "00000000-0000-4000-8000-000000000001";
    const CLIP: &str = "00000000-0000-4000-8000-000000008811";
    fn request() -> SemanticAnimationIntent {
        SemanticAnimationIntent {
            expected_revision: 0, animation_uuid: CLIP.into(), name: "slam".into(),
            length_seconds: 1.0, loop_mode: "once".into(),
            poses: vec![
                SemanticAnimationPose { time: 0.0, phase: "neutral".into(),
                    transforms: vec![SemanticAnimationTransform {
                        bone_uuid: BONE.into(), channel: "rotation".into(), value: [0.0;3],
                    }] },
                SemanticAnimationPose { time: 0.5, phase: "impact".into(),
                    transforms: vec![SemanticAnimationTransform {
                        bone_uuid: BONE.into(), channel: "rotation".into(), value: [30.0,0.0,0.0],
                    }] },
                SemanticAnimationPose { time: 1.0, phase: "recovery".into(),
                    transforms: vec![SemanticAnimationTransform {
                        bone_uuid: BONE.into(), channel: "rotation".into(), value: [0.0;3],
                    }] }
            ],
            contacts: vec![SemanticContactWindow {
                bone_uuid: BONE.into(), kind: "grip".into(),
                start: 0.25, end: 0.75,
            }],
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
}
