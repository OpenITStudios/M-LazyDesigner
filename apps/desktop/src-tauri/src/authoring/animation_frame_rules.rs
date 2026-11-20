//! Strict saved numeric Bone Animation frame admission. The canonical AuthoringDocument/EditorSession and
//! transaction, history, saved file and public document contract stay in mod.rs.
//! SOURCE_ONLY; native/Cargo and regression tests remain NOT_EXECUTED.
use super::*;

// Admit bounded numeric single-point Bezier handles only when their
// saved metadata is complete; imported unknown frames stay opaque.
/// Strict bounded numeric linear/step/Catmull-Rom/Bezier Bone subset from Blockbench v5.2.1
/// BoneAnimator: rotation offsets in degrees, position offsets in model
/// units, and multiplicative scales (identity [1,1,1]). This slice
/// deliberately refuses negative/excessive scales rather than pretending
/// to reproduce all mesh winding/material behavior in the 3D preview.
pub(super) fn supported_transform_channel(channel: &str) -> bool {
    matches!(channel, "rotation" | "position" | "scale")
}
pub(super) fn valid_animation_transform_value(channel: &str, value: [f64; 3]) -> bool {
    if !supported_transform_channel(channel) || !valid_vec3(value) {
        return false;
    }
    channel != "scale" ||
        value.iter().all(|axis| (0.0..=100.0).contains(axis))
}
pub(super) fn transform_axis(value: Option<&Value>) -> Option<f64> {
    let numeric = match value? {
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Number(number) => number.as_f64(),
        _ => None,
    };
    numeric.filter(|axis| axis.is_finite())
}
pub(super) fn editable_transform_frame(frame: &Value) -> bool {
    let Some(fields) = frame.as_object() else { return false; };
    if !fields.keys().all(|key| matches!(key.as_str(),
        "uuid" | "channel" | "time" | "interpolation" | "data_points" |
        "bezier_linked" | "bezier_left_time" | "bezier_left_value" |
        "bezier_right_time" | "bezier_right_value")) ||
       !matches!(frame.get("interpolation").and_then(Value::as_str),
           Some("linear" | "step" | "catmullrom" | "bezier")) ||
       !frame.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) ||
       !frame.get("time").and_then(Value::as_f64)
           .is_some_and(|v| v.is_finite() && v >= 0.0) {
        return false;
    }
    let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
        return false;
    };
    let Some(points) = frame.get("data_points").and_then(Value::as_array) else {
        return false;
    };
    if points.len() != 1 { return false; }
    let Some(values) = points[0].as_object() else { return false; };
    if !values.keys().all(|key| matches!(key.as_str(), "x" | "y" | "z")) {
        return false;
    }
    let [Some(x), Some(y), Some(z)] = [
        transform_axis(values.get("x")), transform_axis(values.get("y")),
        transform_axis(values.get("z")),
    ] else { return false; };
    if !valid_animation_transform_value(channel, [x, y, z]) { return false; }
    if frame.get("interpolation").and_then(Value::as_str) == Some("bezier") {
        bezier::parse_saved_bezier_handles(frame).is_some()
    } else {
        !bezier::has_metadata(frame)
    }
}
/// The exact saved Blockbench v5.2.1 animation loop variants.
pub(super) fn saved_animation_loop(animation: &Value) -> Option<&str> {
    match animation.get("loop") {
        None => Some("once"),
        Some(Value::String(mode)) if matches!(mode.as_str(), "once" | "loop" | "hold") =>
            Some(mode.as_str()),
        _ => None,
    }
}

pub(super) fn editable_transform_clip(animation: &Value, bones: &[Bone]) -> bool {
    if !animation.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) ||
       !animation.as_object().is_some_and(|obj| obj.keys().all(|key|
        matches!(key.as_str(), "uuid" | "name" | "loop" | "length" | "animators" | "markers"))) {
        return false;
    }
    let Some(loop_mode) = saved_animation_loop(animation) else {
        return false;
    };
    let Some(length) = animation.get("length").and_then(Value::as_f64)
        .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v)) else {
        return false;
    };
    if !timeline_markers::valid_saved_markers(animation,length) { return false; }
    // A looping or held clip with zero duration has no stable time mapping.
    if length == 0.0 && loop_mode != "once" {
        return false;
    }
    let Some(tracks) = animation.get("animators").and_then(Value::as_object) else {
        return false;
    };
    // Check each declared animator Bone through one clip-local lookup instead
    // of rescanning the whole rig for every saved track.
    let bone_by_uuid: HashMap<&str, &Bone> = bones.iter()
        .map(|bone| (bone.uuid.as_str(), bone)).collect();
    let mut all_ids = HashSet::new();
    let mut total = 0usize;
    for (bone_uuid, track) in tracks {
        // Blockbench effect animator is saved under the fixed "effects"
        // track key, not a Bone UUID. Admit only Sound/Particle markers.
        // No scripts, local files, raw controller payloads or playback.
        if bone_uuid == "effects" {
            let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                return false;
            };
            total = total.saturating_add(frames.len());
            if total > 2048 || !effects::valid_effect_track(track,length) {
                return false;
            }
            for frame in frames {
                let Some(id) = frame.get("uuid").and_then(Value::as_str) else {
                    return false;
                };
                if !all_ids.insert(id) { return false; }
            }
            continue;
        }
        let Some(bone) = bone_by_uuid.get(bone_uuid.as_str()).copied() else {
            return false;
        };
        if !editable_rotation_track(track) || track.get("name")
            .is_some_and(|name| name.as_str() != Some(bone.name.as_str())) {
            return false;
        }
        let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
            return false;
        };
        total = total.saturating_add(frames.len());
        if total > 2048 { return false; }
        let mut times: HashMap<&str, Vec<f64>> = HashMap::new();
        for frame in frames {
            if !editable_transform_frame(frame) { return false; }
            let Some(time) = frame.get("time").and_then(Value::as_f64) else {
                return false;
            };
            if time > length { return false; }
            let Some(uuid) = frame.get("uuid").and_then(Value::as_str) else {
                return false;
            };
            if !all_ids.insert(uuid) { return false; }
            let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
                return false;
            };
            times.entry(channel).or_default().push(time);
        }
        for values in times.values_mut() {
            values.sort_by(f64::total_cmp);
            if values.windows(2).any(|pair| pair[1] - pair[0] <= 1e-6) {
                return false;
            }
        }
        if !bezier::valid_track_segments(frames) { return false; }
    }
    true
}

pub(super) fn editable_rotation_frame(frame: &Value) -> bool {
    frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
        editable_transform_frame(frame)
}

pub(super) fn editable_rotation_track(track: &Value) -> bool {
    track.as_object().is_some_and(|values|
        values.keys().all(|key| matches!(key.as_str(), "name" | "type" | "keyframes"))) &&
    track.get("type").and_then(Value::as_str) == Some("bone") &&
    track.get("keyframes").and_then(Value::as_array).is_some()
}
