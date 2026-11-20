//! Read-only source animation projection for Tauri EditorSnapshot.
//! No EditorStore mutation, animation writer, saved model cache or independent preview authority.
//! SOURCE_ONLY: native GUI/Blockbench playback NOT_EXECUTED.
use super::*;

// Parse only numeric or simple finite Molang constants. Imported expression
// tracks remain in the Rust document untouched and are not faked in the UI.
fn static_animation_axis(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::String(text) => text.parse::<f64>().ok()?,
        Value::Number(value) => value.as_f64()?,
        _ => return None,
    };
    number.is_finite().then_some(number)
}

// The pinned Tauri numeric preview refuses keyframes at the same Bone/
// channel whose timestamps are within 1e-6 seconds. Group finite times
// into adjacent microsecond buckets, then compare original floating values
// exactly as before. A temporary per-clip index avoids scanning all prior
// frame projections for each new source keyframe.
pub(super) fn register_preview_time<'a>(
    seen: &mut HashMap<(&'a str, &'a str, u64), Vec<f64>>,
    bone_uuid: &'a str, channel: &'a str, time: f64,
) -> bool {
    let bucket = (time * 1_000_000.0).floor() as u64;
    // Include one adjacent quantization bucket on either side and a spare
    // for floating-point boundary rounding; exact comparison remains the
    // authoritative rejection rule, not the bucket index.
    for nearby in bucket.saturating_sub(2)..=bucket.saturating_add(2) {
        if seen.get(&(bone_uuid, channel, nearby)).is_some_and(|times|
            times.iter().any(|previous| (*previous - time).abs() <= 1e-6)) {
            return false;
        }
    }
    seen.entry((bone_uuid, channel, bucket)).or_default().push(time);
    true
}

// Source-only UUID/name lookup shared across this immutable Tauri projection.
// Preserve the previous first-match behavior if an unvalidated caller supplies
// duplicate Bone UUIDs; normal Rust authoring validation rejects duplicates.
pub(super) fn indexed_bone_names(doc: &AuthoringDocument) -> HashMap<&str, &str> {
    let mut names = HashMap::new();
    for bone in &doc.bones {
        names.entry(bone.uuid.as_str()).or_insert(bone.name.as_str());
    }
    names
}

pub(super) fn animation_views(doc: &AuthoringDocument) -> Vec<AnimationView> {
    let bone_names = indexed_bone_names(doc);
    // Imported clips can share UUIDs. A model-visible clip must be identified
    // unambiguously; never pick the first identical UUID to edit or preview.
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for animation in &doc.animation_assets {
        if let Some(id) = animation.get("uuid").and_then(Value::as_str) {
            *counts.entry(id).or_insert(0) += 1;
        }
    }
    doc.animation_assets.iter().take(256).filter_map(|animation| {
        let uuid = animation.get("uuid")?.as_str()?.to_owned();
        let name = animation.get("name").and_then(Value::as_str)
            .unwrap_or("Unnamed Animation").to_owned();
        let length = animation.get("length")?.as_f64()
            .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))?;
        // Only the three pinned Blockbench v5.2.1 playback policies are
        // projected. Malformed imported fields have an unsupported marker,
        // never a silently assumed once mode.
        let loop_mode = match animation.get("loop") {
            None => Some("once"),
            Some(Value::String(mode)) if
                matches!(mode.as_str(), "once" | "loop" | "hold") =>
                    Some(mode.as_str()),
            _ => None,
        };
        let saved_markers = saved_timeline_markers(animation);
        let mut preview_supported = counts.get(uuid.as_str()) == Some(&1) &&
            saved_markers.is_some() && valid_saved_markers(animation,length) &&
            !uuid.is_empty() && uuid.len() <= 128 &&
            !uuid.chars().any(|ch| ch.is_control() || ch.is_whitespace()) &&
            animation.as_object().is_some_and(|map|
                map.keys().all(|key| matches!(key.as_str(),
                    "uuid" | "name" | "loop" | "length" | "animators"))) &&
            loop_mode.is_some_and(|mode| mode == "once" || length > 0.0);
        let mut rotation_keyframes = Vec::new();
        let mut transform_keyframes: Vec<TransformKeyframeView> = Vec::new();
        let mut keyframe_ids = HashSet::new();
        let mut seen_times: HashMap<(&str, &str, u64), Vec<f64>> = HashMap::new();
        if let Some(animators) = animation.get("animators").and_then(Value::as_object) {
            for (bone_uuid, track) in animators {
                let bone_name = bone_names.get(bone_uuid.as_str()).copied();
                if bone_name.is_none() ||
                   !track.as_object().is_some_and(|map| map.keys().all(|key|
                        matches!(key.as_str(), "name" | "type" | "keyframes"))) ||
                   track.get("type").and_then(Value::as_str) != Some("bone") ||
                   track.get("name").is_some_and(|label| label.as_str() != bone_name) {
                    preview_supported = false;
                    continue;
                }
                let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                    preview_supported = false;
                    continue;
                };
                if frames.len() > 2048 { preview_supported = false; }
                for frame in frames.iter().take(2048) {
                    let Some(channel) = frame.get("channel").and_then(Value::as_str)
                        .filter(|c| matches!(*c, "rotation" | "position" | "scale")) else {
                        preview_supported = false; continue;
                    };
                    let Some(interpolation) = frame.get("interpolation")
                        .and_then(Value::as_str)
                        .filter(|mode| matches!(*mode, "linear" | "step" | "catmullrom" | "bezier")) else {
                        preview_supported = false; continue;
                    };
                    if !frame.as_object().is_some_and(|map| map.keys().all(|key|
                        matches!(key.as_str(),
                            "uuid" | "channel" | "time" | "interpolation" | "data_points" |
                            "bezier_linked" | "bezier_left_time" |
                            "bezier_left_value" | "bezier_right_time" |
                            "bezier_right_value"))) {
                        preview_supported = false; continue;
                    }
                    let bezier = if interpolation == "bezier" {
                        let Some(saved) = parse_saved_bezier_handles(frame) else {
                            preview_supported = false; continue;
                        };
                        Some(saved)
                    } else {
                        if ["bezier_linked", "bezier_left_time", "bezier_left_value",
                            "bezier_right_time", "bezier_right_value"]
                            .iter().any(|key| frame.get(*key).is_some()) {
                            preview_supported = false; continue;
                        }
                        None
                    };
                    let Some(id) = frame.get("uuid").and_then(Value::as_str)
                        .filter(|value| !value.is_empty() && value.len() <= 128 &&
                            !value.chars().any(|character|
                                character.is_control() || character.is_whitespace())) else {
                        preview_supported = false; continue;
                    };
                    if !keyframe_ids.insert(id.to_owned()) {
                        preview_supported = false; continue;
                    }
                    let Some(time) = frame.get("time").and_then(Value::as_f64)
                        .filter(|t| t.is_finite() && *t >= 0.0 && *t <= length) else {
                        preview_supported = false; continue;
                    };
                    let Some(points) = frame.get("data_points").and_then(Value::as_array) else {
                        preview_supported = false; continue;
                    };
                    if points.len() != 1 ||
                       !points[0].as_object().is_some_and(|map|
                           map.keys().all(|key| matches!(key.as_str(), "x" | "y" | "z"))) {
                        preview_supported = false; continue;
                    }
                    let [Some(x), Some(y), Some(z)] = [
                        static_animation_axis(points[0].get("x")),
                        static_animation_axis(points[0].get("y")),
                        static_animation_axis(points[0].get("z")),
                    ] else {
                        preview_supported = false; continue;
                    };
                    let value = [x, y, z];
                    if value.iter().any(|axis| axis.abs() > 100_000.0) ||
                       (channel == "scale" && value.iter().any(|axis|
                           *axis < 0.0 || *axis > 100.0)) {
                        preview_supported = false; continue;
                    }
                    if transform_keyframes.len() >= 2048 ||
                       !register_preview_time(&mut seen_times,
                           bone_uuid.as_str(), channel, time) {
                        preview_supported = false; continue;
                    }
                    transform_keyframes.push(TransformKeyframeView {
                        uuid: id.to_owned(), bone_uuid: bone_uuid.clone(),
                        channel: channel.to_owned(), time, value,
                        interpolation: interpolation.to_owned(), bezier,
                    });
                    if channel == "rotation" {
                        rotation_keyframes.push(RotationKeyframeView {
                            uuid: id.to_owned(), bone_uuid: bone_uuid.clone(),
                            time, rotation: value,
                        });
                    }
                }
                if !valid_track_segments(frames) { preview_supported = false; }
            }
        } else { preview_supported = false; }
        // An unsupported imported clip must not provide a *partial* set of
        // selectable/editable keyframes.
        if !preview_supported {
            rotation_keyframes.clear();
            transform_keyframes.clear();
        }
        Some(AnimationView {
            uuid, name, length,
            loop_mode:loop_mode.unwrap_or("unsupported").to_owned(),
            rotation_keyframes, transform_keyframes,
            markers:if preview_supported {saved_markers.unwrap_or_default()}
                else {Vec::new()},
            preview_supported,
        })
    }).collect()
}
