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
    /// Optional native outgoing interpolation on this exact authored key.
    /// Bezier is intentionally left to the existing explicit-handle editor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interpolation: Option<String>,
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
/// One explicitly placed point in a Bone's pivot-local coordinates.
/// Path is diagnostic; planted requires a matching declared contact window.
/// No entity-root travel, collision or native gameplay contact is inferred.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAnimationProbe {
    pub bone_uuid: String,
    pub kind: String,
    pub local_point: [f64; 3],
    pub start: f64,
    pub end: f64,
}
/// A single-level, artist-selected lag response on an otherwise unauthored
/// Bone channel. This is source-linear keyframe shifting, not simulated cloth,
/// spring integration, IK, geometric attachment or world-space contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticAnimationFollower {
    pub driver_bone_uuid: String,
    pub follower_bone_uuid: String,
    pub channel: String,
    pub lag_seconds: f64,
    pub gain: f64,
    pub rest_value: [f64; 3],
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
    /// Optional, no secondary authority; existing explicit-pose packets stay valid.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub followers: Vec<SemanticAnimationFollower>,
    /// Optional: at most four bounded source-model-space marker trajectories.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub probes: Vec<SemanticAnimationProbe>,
}
#[derive(Debug, Clone, Serialize)]
pub struct SemanticAnimationProposal {
    pub plan: EditPlan,
    pub preflight: Value,
    pub motion_evidence: Value,
}
pub(super) fn exact_time(value: f64) -> bool {
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
// Interpolation is deliberately linear and limited to the exact authored
// driver keys. Follow-through here is a deterministic delay, not an animation
// solver or an inference of a Bone's true world-space motion.
fn driver_at(keys: &[(f64, [f64; 3])], time: f64) -> [f64; 3] {
    if time <= keys[0].0 { return keys[0].1; }
    if time >= keys[keys.len()-1].0 { return keys[keys.len()-1].1; }
    let next = keys.partition_point(|(t,_)| *t < time);
    let (a, b) = (&keys[next-1], &keys[next]);
    let weight = (time-a.0)/(b.0-a.0);
    std::array::from_fn(|axis| a.1[axis] + (b.1[axis]-a.1[axis])*weight)
}
fn follower_time(time: f64, lag: f64, length: f64, looping: bool) -> Result<f64> {
    let shifted = if looping { (time+lag).rem_euclid(length) } else { time+lag };
    let rounded = format!("{shifted:.9}").parse::<f64>()
        .map_err(|_|"SEMANTIC_FOLLOWER_TIME_INVALID".to_owned())?;
    if !exact_time(rounded) || rounded > length {
        return Err("SEMANTIC_FOLLOWER_TIME_INVALID".into());
    }
    if looping && (length-rounded).abs() <= 1e-9 {
        Ok(0.0)
    } else { Ok(rounded) }
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
       request.contacts.len() > 16 || request.followers.len() > 8 ||
       request.probes.len() > 4 {
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
    let mut requested_interpolations = Vec::new();
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
               transform.interpolation.as_deref().is_some_and(|mode|
                   !matches!(mode, "linear" | "step" | "catmullrom")) ||
               (transform.interpolation.as_deref()==Some("catmullrom") &&
                   transform.channel=="scale") ||
               !touched.insert((&transform.bone_uuid, &transform.channel)) {
                return Err("SEMANTIC_ANIMATION_TRANSFORM_INVALID".into());
            }
            if operations.len() >= MAX_OPERATIONS - 1 {
                return Err("SEMANTIC_ANIMATION_OPERATION_BUDGET".into());
            }
            let keyframe_uuid=key_uuid(&request.animation_uuid,
                &transform.bone_uuid, &transform.channel, pose_index);
            operations.push(EditOperation::AddBoneTransformKeyframe {
                animation_uuid: request.animation_uuid.clone(),
                bone_uuid: transform.bone_uuid.clone(),
                keyframe_uuid:keyframe_uuid.clone(),
                channel: transform.channel.clone(),
                time: pose.time, value: transform.value,
            });
            if let Some(mode)=&transform.interpolation {
                if mode!="linear" {
                    requested_interpolations.push((
                        transform.bone_uuid.clone(),transform.channel.clone(),
                        keyframe_uuid,mode.clone(),
                    ));
                }
            }
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
    // Keep the user-selected interpolation on exactly its original key.
    // Catmull-Rom may overshoot contacts/scale and Euler winding; do not
    // invent a native sample or hide the danger with more keyframes.
    let nonlinear_owners: HashSet<(String,String)> = requested_interpolations
        .iter().map(|(bone,channel,_,_)|(bone.clone(),channel.clone())).collect();
    for (bone,channel,keyframe_uuid,mode) in &requested_interpolations {
        if mode=="catmullrom" {
            if request.contacts.iter().any(|c|c.bone_uuid.as_str()==bone.as_str()) {
                return Err("SEMANTIC_ANIMATION_INTERPOLATION_CONTACT_UNSAFE".into());
            }
            if channel=="rotation" && tracks.get(&(bone.clone(),channel.clone()))
                .is_some_and(|keys|keys.windows(2).any(|pair|
                    (0..3).any(|axis|(pair[0].1[axis]-pair[1].1[axis]).abs()>=180.0))) {
                return Err("SEMANTIC_ANIMATION_INTERPOLATION_EULER_AMBIGUOUS".into());
            }
        }
        if operations.len() >= MAX_OPERATIONS-1 {
            return Err("SEMANTIC_ANIMATION_OPERATION_BUDGET".into());
        }
        operations.push(EditOperation::SetBoneTransformKeyframeInterpolation {
            animation_uuid:request.animation_uuid.clone(),
            bone_uuid:bone.clone(),keyframe_uuid:keyframe_uuid.clone(),
            channel:channel.clone(),interpolation:mode.clone(),
        });
    }
    // Secondary is strictly derived from EXPLICIT primary keys. Refuse
    // generated chains, channel overwrites, unclear Euler wraps, truncated
    // recovery and uncertain clip seams. Never mutate the source rig.
    let primary_track_ids: HashSet<(String,String)> =
        tracks.keys().cloned().collect();
    let mut follower_reports = Vec::new();
    let mut owned_followers = HashSet::new();
    for follower in &request.followers {
        let owner = (follower.follower_bone_uuid.clone(),follower.channel.clone());
        if !valid_uuid(&follower.driver_bone_uuid) ||
           !valid_uuid(&follower.follower_bone_uuid) ||
           follower.driver_bone_uuid == follower.follower_bone_uuid ||
           !bones.contains(follower.driver_bone_uuid.as_str()) ||
           !bones.contains(follower.follower_bone_uuid.as_str()) ||
           !matches!(follower.channel.as_str(), "rotation" | "position") ||
           !exact_time(follower.lag_seconds) || follower.lag_seconds <= 1e-6 ||
           follower.lag_seconds > request.length_seconds * 0.5 ||
           !follower.gain.is_finite() || !(1e-9..=2.0).contains(&follower.gain.abs()) ||
           !valid_animation_transform_value(&follower.channel, follower.rest_value) ||
           !owned_followers.insert(owner.clone()) ||
           tracks.contains_key(&owner) ||
           request.contacts.iter().any(|c|c.bone_uuid==follower.follower_bone_uuid) {
            return Err("SEMANTIC_FOLLOWER_INTENT_INVALID".into());
        }
        let driver_key = (follower.driver_bone_uuid.clone(),follower.channel.clone());
        if nonlinear_owners.contains(&driver_key) {
            return Err("SEMANTIC_FOLLOWER_DRIVER_INTERPOLATION_UNSUPPORTED".into());
        }
        if !primary_track_ids.contains(&driver_key) {
            return Err("SEMANTIC_FOLLOWER_DRIVER_UNAUTHORED".into());
        }
        let source = tracks.get(&driver_key)
            .ok_or_else(||"SEMANTIC_FOLLOWER_DRIVER_UNAUTHORED".to_owned())?.clone();
        // No inferred rest, closing gait, or rotation winding. To preserve a
        // non-looping return, primary must settle before the lagged tail ends.
        let looping = request.loop_mode == "loop";
        let first = &source[0];
        let last = &source[source.len()-1];
        if source.len()<2 || first.0 != 0.0 ||
           (looping && last.0 != request.length_seconds) ||
           (!looping && last.0 > request.length_seconds-follower.lag_seconds+1e-9) ||
           (0..3).any(|axis| (first.1[axis]-last.1[axis]).abs()>1e-6) ||
           !source.windows(2).any(|pair|
               (0..3).any(|axis| (pair[0].1[axis]-pair[1].1[axis]).abs()>1e-6)) ||
           (follower.channel=="rotation" && source.windows(2).any(|pair|
               (0..3).any(|axis| (pair[0].1[axis]-pair[1].1[axis]).abs()>=180.0))) {
            return Err("SEMANTIC_FOLLOWER_DRIVER_UNSAFE".into());
        }
        let mut times=vec![0.0,request.length_seconds];
        for (source_time,_) in &source {
            let raw = source_time+follower.lag_seconds;
            if !looping && raw>request.length_seconds { continue; }
            times.push(follower_time(*source_time,follower.lag_seconds,
                request.length_seconds,looping)?);
        }
        times.sort_by(f64::total_cmp);
        times.dedup_by(|a,b|(*a-*b).abs()<=1e-9);
        if times.len()<3 || times.windows(2).any(|pair|pair[1]-pair[0]<=1e-6) {
            return Err("SEMANTIC_FOLLOWER_TIME_COLLISION".into());
        }
        if operations.len().saturating_add(times.len()+1)>MAX_OPERATIONS {
            return Err("SEMANTIC_ANIMATION_OPERATION_BUDGET".into());
        }
        let mut derived: Vec<(f64,[f64;3])>=Vec::with_capacity(times.len());
        for (index,&time) in times.iter().enumerate() {
            let sample_time=if looping {
                (time-follower.lag_seconds).rem_euclid(request.length_seconds)
            }else { (time-follower.lag_seconds).max(0.0) };
            let sample=driver_at(&source,sample_time);
            let mut value: [f64;3]=std::array::from_fn(|axis|
                follower.rest_value[axis] +
                follower.gain*(sample[axis]-first.1[axis]));
            if looping && index==times.len()-1 { value=derived[0].1; }
            if !valid_animation_transform_value(&follower.channel,value) {
                return Err("SEMANTIC_FOLLOWER_VALUE_INVALID".into());
            }
            operations.push(EditOperation::AddBoneTransformKeyframe {
                animation_uuid:request.animation_uuid.clone(),
                bone_uuid:follower.follower_bone_uuid.clone(),
                keyframe_uuid:key_uuid(&request.animation_uuid,
                    &follower.follower_bone_uuid,&follower.channel,index),
                channel:follower.channel.clone(),time,value,
            });
            derived.push((time,value));
        }
        follower_reports.push(json!({
            "driver_bone_uuid":follower.driver_bone_uuid,
            "follower_bone_uuid":follower.follower_bone_uuid,
            "channel":follower.channel,"gain":follower.gain,
            "lag_seconds":follower.lag_seconds,
            "rest_value":follower.rest_value,
            "driver_key_count":source.len(),
            "derived_key_count":derived.len(),
            "sampling_model":"SOURCE_LINEAR_DELAYED_DELTA",
            "contact_verdict":"UNVERIFIED",
            "loop_or_settle_endpoint_values_equal":
                (0..3).all(|a|(derived[0].1[a]-derived[derived.len()-1].1[a]).abs()<=1e-6)
        }));
        tracks.insert(owner,derived);
    }
    // Derive model-space marker evidence only from known ZYX saved Bone
    // hierarchy and numeric linear tracks. An unsupported/opaque chain
    // refuses this optional diagnosis without changing authored assets.
    let trajectory_reports = super::animation_trajectory::review(
        session.document(), &request.poses, &request.contacts,
        &request.probes, &tracks, &nonlinear_owners, request.length_seconds,
    )?;
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
    // Secondary delay can peak between primary landmarks. Include its
    // authored event times only when review headroom remains, not by
    // polling every equal timeline interval.
    for follower in &request.followers {
        if let Some(keys)=tracks.get(&(follower.follower_bone_uuid.clone(),
            follower.channel.clone())) {
            for &(time,_) in keys { add_review_time(&mut review_times,time); }
        }
    }
    for pose in &request.poses { add_review_time(&mut review_times, pose.time); }
    review_times.sort_by(f64::total_cmp);
    let authored_keyframe_count: usize=tracks.values().map(Vec::len).sum();
    let mut evidence = json!({
        "scope": "source_bound_semantic_pose_candidate",
        "animation_uuid": request.animation_uuid,
        "loop_mode": request.loop_mode,
        "pose_count": request.poses.len(),
        "keyframe_count": authored_keyframe_count,
        "track_count": tracks.len(),
        "contact_windows": contact_reports,
        "tracks": track_reports,
        "temporal_review_times": review_times,
        "numeric_motion_verdict": if requested_interpolations.is_empty() {
            "AUTHORED_LINEAR_SEGMENTS_ONLY"
        } else {
            "AUTHORED_KEY_SEGMENTS_NOT_INTERPOLATED"
        },
        "world_contact_verdict": "UNVERIFIED",
        "native_playback_verdict": "NOT_EXECUTED",
        "visual_verdict": "UNVERIFIED",
        "write_authority": "NOT_GRANTED",
    });
    if !follower_reports.is_empty() {
        evidence["secondary_followers"]=json!(follower_reports);
        evidence["secondary_verdict"]=json!("SOURCE_LINEAR_LAG_ONLY");
    }
    if !trajectory_reports.is_empty() {
        evidence["marker_trajectories"]=json!(trajectory_reports);
        evidence["spatial_diagnostic"]=json!("SOURCE_MODEL_ZYX_LINEAR_PROXY_ONLY");
    }
    Ok(SemanticAnimationProposal { plan, preflight, motion_evidence: evidence })
}

#[cfg(test)]
mod tests;
