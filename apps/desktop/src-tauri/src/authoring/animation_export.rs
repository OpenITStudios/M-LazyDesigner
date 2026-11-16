//! Strict Bedrock Entity animation JSON output from the canonical Rust document.
//! Independent of .bbmodel persistence; no controller or Molang execution.
//! Reference: JannisX11/blockbench v5.2.1 bedrock_animation.js and keyframe.js.
//! SOURCE ONLY: no Rust, Blockbench or native export has been executed.

use super::{bezier, editable_transform_clip, saved_animation_loop, transform_axis,
    valid_animation_transform_value, AuthoringDocument, MAX_MODEL_BYTES};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

/// Stable Bedrock second keys. Refuse times that require non-negligible
/// rounding instead of silently merging frames in a JSON object.
fn time_key(time: f64) -> Result<String> {
    if !time.is_finite() || !(0.0..=3600.0).contains(&time) {
        return Err(fail("ANIMATION_EXPORT_TIME_INVALID"));
    }
    let mut out = format!("{time:.9}");
    let roundtrip = out.parse::<f64>()
        .map_err(|_| fail("ANIMATION_EXPORT_TIME_INVALID"))?;
    if (roundtrip - time).abs() > 1e-10 {
        return Err(fail("ANIMATION_EXPORT_TIME_PRECISION_UNSUPPORTED"));
    }
    while out.ends_with('0') { out.pop(); }
    if out.ends_with('.') { out.push('0'); }
    Ok(out)
}

// Both the editable .bbmodel and the Bedrock resource use the same numeric
// single-data-point source. The signs are a codec concern, never a model edit.
fn raw_axes(frame: &Value) -> Result<[f64; 3]> {
    let points = frame.get("data_points").and_then(Value::as_array)
        .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
    if points.len() != 1 { return Err(fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED")); }
    let point = &points[0];
    let mut values = [0.0_f64; 3];
    for (axis, key) in ["x", "y", "z"].iter().enumerate() {
        values[axis] = transform_axis(point.get(*key))
            .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
    }
    Ok(values)
}

fn bedrock_axes(mut values: [f64; 3], channel: &str) -> Value {
    // Pinned Blockbench 5.2.1 Bedrock animation coordinate convention.
    if matches!(channel, "position" | "rotation") { values[0] = -values[0]; }
    if channel == "rotation" { values[1] = -values[1]; }
    json!(values)
}

fn channel_value(frame: &Value, channel: &str) -> Result<Value> {
    Ok(bedrock_axes(raw_axes(frame)?, channel))
}

const MAX_BAKED_CHANNEL_KEYS: usize = 4096;
const MAX_BAKED_INTERIOR_PER_SEGMENT: usize = 255;
const MAX_BAKE_DEPTH: usize = 8;
const DEFAULT_RIGHT_TIME: f64 = 0.1;
const DEFAULT_LEFT_TIME: f64 = -0.1;

// Numerical conversion from the cubic time/value representation used by
// admitted monotone handles. This is the same mathematical interpolation as
// the Rust editor's read-only pose projection, not a copy of Blockbench code.
struct BezierSegment {
    start: f64,
    end: f64,
    x: [[f64; 4]; 3],
    y: [[f64; 4]; 3],
}

fn cubic(points: [f64; 4], t: f64) -> f64 {
    let remain = 1.0 - t;
    remain * remain * remain * points[0]
        + 3.0 * remain * remain * t * points[1]
        + 3.0 * remain * t * t * points[2]
        + t * t * t * points[3]
}

impl BezierSegment {
    fn from_frames(before: &Value, after: &Value) -> Result<Self> {
        let start = before["time"].as_f64().ok_or_else(|| fail("ANIMATION_EXPORT_TIME_INVALID"))?;
        let end = after["time"].as_f64().ok_or_else(|| fail("ANIMATION_EXPORT_TIME_INVALID"))?;
        let gap = end - start;
        if !gap.is_finite() || gap <= 1e-6 {
            return Err(fail("ANIMATION_EXPORT_BAKE_TIME_INVALID"));
        }
        let start_values = raw_axes(before)?;
        let end_values = raw_axes(after)?;
        let a = bezier::parse_saved_bezier_handles(before);
        let b = bezier::parse_saved_bezier_handles(after);
        let mut x = [[0.0_f64; 4]; 3];
        let mut y = [[0.0_f64; 4]; 3];
        for axis in 0..3 {
            let right_time = a.as_ref().map(|h| h.right_time[axis])
                .unwrap_or(DEFAULT_RIGHT_TIME).clamp(0.0, gap);
            let left_time = b.as_ref().map(|h| h.left_time[axis])
                .unwrap_or(DEFAULT_LEFT_TIME).clamp(-gap, 0.0);
            if right_time > gap + left_time + 1e-9 {
                return Err(fail("ANIMATION_EXPORT_BAKE_TIME_NONMONOTONE"));
            }
            x[axis] = [start, start + right_time, end + left_time, end];
            y[axis] = [
                start_values[axis],
                start_values[axis] + a.as_ref().map(|h| h.right_value[axis]).unwrap_or(0.0),
                end_values[axis] + b.as_ref().map(|h| h.left_value[axis]).unwrap_or(0.0),
                end_values[axis],
            ];
        }
        Ok(Self { start, end, x, y })
    }

    fn sample(&self, time: f64, channel: &str) -> Result<[f64; 3]> {
        if !time.is_finite() || time < self.start || time > self.end {
            return Err(fail("ANIMATION_EXPORT_BAKE_TIME_INVALID"));
        }
        let mut values = [0.0_f64; 3];
        for axis in 0..3 {
            // Each time curve is monotone after source admission. Binary
            // search is bounded, avoiding untrusted curve-based iterations.
            let mut low = 0.0;
            let mut high = 1.0;
            for _ in 0..30 {
                let mid = (low + high) * 0.5;
                if cubic(self.x[axis], mid) < time { low = mid; }
                else { high = mid; }
            }
            values[axis] = cubic(self.y[axis], (low + high) * 0.5);
        }
        if !valid_animation_transform_value(channel, values) {
            return Err(fail("ANIMATION_EXPORT_BAKE_VALUE_UNSUPPORTED"));
        }
        Ok(values)
    }
}

/// Adaptive subdivision checks midpoint and quarter-point errors against
/// linear Bedrock interpolation. This is a bounded numerical approximation,
/// not a proof of identical native playback at every real-valued instant.
fn bake_between(
    segment: &BezierSegment, channel: &str,
    start_time: f64, start: [f64; 3], end_time: f64, end: [f64; 3],
    depth: usize, interior: &mut Vec<(f64, [f64; 3])>,
) -> Result<()> {
    let tolerance = match channel {
        "rotation" => 0.05,
        "position" => 0.005,
        "scale" => 0.0025,
        _ => return Err(fail("ANIMATION_EXPORT_BAKE_CHANNEL_UNSUPPORTED")),
    };
    let mut needs_split = false;
    for fraction in [0.25, 0.5, 0.75] {
        let time = start_time + (end_time - start_time) * fraction;
        let expected = segment.sample(time, channel)?;
        for axis in 0..3 {
            let linear = start[axis] + (end[axis] - start[axis]) * fraction;
            if (expected[axis] - linear).abs() > tolerance { needs_split = true; }
        }
    }
    if !needs_split { return Ok(()); }
    if depth >= MAX_BAKE_DEPTH || interior.len() >= MAX_BAKED_INTERIOR_PER_SEGMENT {
        return Err(fail("ANIMATION_EXPORT_BAKE_BUDGET_EXCEEDED"));
    }
    let middle_time = start_time + (end_time - start_time) * 0.5;
    if middle_time <= start_time || middle_time >= end_time {
        return Err(fail("ANIMATION_EXPORT_BAKE_TIME_PRECISION_UNSUPPORTED"));
    }
    let middle = segment.sample(middle_time, channel)?;
    bake_between(segment, channel, start_time, start, middle_time, middle, depth + 1, interior)?;
    if interior.len() >= MAX_BAKED_INTERIOR_PER_SEGMENT {
        return Err(fail("ANIMATION_EXPORT_BAKE_BUDGET_EXCEEDED"));
    }
    interior.push((middle_time, middle));
    bake_between(segment, channel, middle_time, middle, end_time, end, depth + 1, interior)
}

fn insert_key(values: &mut Map<String, Value>, time: f64, value: Value) -> Result<()> {
    if values.len() >= MAX_BAKED_CHANNEL_KEYS {
        return Err(fail("ANIMATION_EXPORT_BAKE_CHANNEL_LIMIT"));
    }
    if values.insert(time_key(time)?, value).is_some() {
        return Err(fail("ANIMATION_EXPORT_TIMECODE_COLLISION"));
    }
    Ok(())
}

fn compile_bone_channel(frames: &mut Vec<&Value>, channel: &str) -> Result<Value> {
    frames.sort_by(|a, b| a["time"].as_f64().unwrap_or(0.0)
        .total_cmp(&b["time"].as_f64().unwrap_or(0.0)));
    let mut values = Map::new();
    let mut previous: Option<&Value> = None;
    for &frame in frames.iter() {
        let mode = frame.get("interpolation").and_then(Value::as_str)
            .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
        let now_time = frame["time"].as_f64()
            .ok_or_else(|| fail("ANIMATION_EXPORT_TIME_INVALID"))?;
        if let Some(before) = previous {
            let before_mode = before.get("interpolation").and_then(Value::as_str)
                .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
            // The read-only editor's precedence is Step > Catmull-Rom >
            // Bezier > Linear. Bake only the intervals that actually use
            // Bezier; a Step or Catmull segment must not be overwritten.
            let bezier_interval = before_mode != "step" &&
                before_mode != "catmullrom" && mode != "catmullrom" &&
                (before_mode == "bezier" || mode == "bezier");
            if bezier_interval {
                let segment = BezierSegment::from_frames(before, frame)?;
                let mut interior = Vec::new();
                bake_between(&segment, channel, segment.start, raw_axes(before)?,
                    segment.end, raw_axes(frame)?, 0, &mut interior)?;
                for (time, value) in interior {
                    insert_key(&mut values, time, bedrock_axes(value, channel))?;
                }
            }
        }
        let now = channel_value(frame, channel)?;
        let value = if mode == "catmullrom" {
            // Pinned Blockbench Keyframe.compileBedrockKeyframe uses one-point
            // pre/post values (getArray(1) clamps to the only point).
            let include_pre = previous.is_none() && now_time > 0.0 ||
                previous.is_some_and(|old| old.get("interpolation")
                    .and_then(Value::as_str) != Some("catmullrom"));
            if include_pre {
                json!({"pre":now.clone(),"post":now,"lerp_mode":"catmullrom"})
            } else {
                json!({"post":now,"lerp_mode":"catmullrom"})
            }
        } else if previous.is_some_and(|old| old.get("interpolation")
            .and_then(Value::as_str) == Some("step")) {
            json!({"pre":channel_value(previous.unwrap(), channel)?,"post":now})
        } else {
            now
        };
        insert_key(&mut values, now_time, value)?;
        previous = Some(frame);
    }
    Ok(Value::Object(values))
}

fn compile_effects(track: &Value, compiled: &mut Map<String, Value>) -> Result<()> {
    for (channel, output_key) in [("sound", "sound_effects"), ("particle", "particle_effects")] {
        let mut entries: Vec<&Value> = track["keyframes"].as_array()
            .ok_or_else(|| fail("ANIMATION_EXPORT_EFFECT_UNSUPPORTED"))?
            .iter().filter(|frame| frame["channel"] == channel).collect();
        entries.sort_by(|a,b| a["time"].as_f64().unwrap_or(0.0)
            .total_cmp(&b["time"].as_f64().unwrap_or(0.0)));
        let mut events = Map::new();
        for frame in entries {
            let key = time_key(frame["time"].as_f64()
                .ok_or_else(|| fail("ANIMATION_EXPORT_TIME_INVALID"))?)?;
            let points = frame["data_points"].as_array()
                .ok_or_else(|| fail("ANIMATION_EXPORT_EFFECT_UNSUPPORTED"))?;
            let mut payload = Vec::with_capacity(points.len());
            for item in points {
                let mut event = Map::new();
                event.insert("effect".into(), item["effect"].clone());
                if let Some(locator) = item.get("locator") {
                    if !locator.is_null() { event.insert("locator".into(), locator.clone()); }
                }
                // Match Blockbench's saved Bedrock convention: only an
                // explicit false is serialized for bind_to_actor.
                if channel == "particle" && item.get("bind_to_actor") == Some(&Value::Bool(false)) {
                    event.insert("bind_to_actor".into(), Value::Bool(false));
                }
                payload.push(Value::Object(event));
            }
            let value = if payload.len() == 1 { payload.remove(0) } else { Value::Array(payload) };
            if events.insert(key,value).is_some() {
                return Err(fail("ANIMATION_EXPORT_TIMECODE_COLLISION"));
            }
        }
        if !events.is_empty() { compiled.insert(output_key.into(), Value::Object(events)); }
    }
    Ok(())
}

/// A read-only, conservative quality receipt. Only Bezier is resampled;
/// Catmull-Rom retains a native lerp_mode. An opaque clip is refused by the
/// exporter before the receipt is used by any publisher.
pub fn bedrock_animation_curve_fidelity(doc: &AuthoringDocument) -> &'static str {
    for clip in &doc.animation_assets {
        if let Some(tracks) = clip.get("animators").and_then(Value::as_object) {
            for track in tracks.values() {
                if track.get("keyframes").and_then(Value::as_array)
                    .is_some_and(|frames| frames.iter().any(|frame|
                        frame.get("interpolation").and_then(Value::as_str) == Some("bezier"))) {
                    return "adaptive_bezier_approximation";
                }
            }
        }
    }
    "native"
}

/// Export the whole admitted set in one deterministic Bedrock animation file.
/// Unknown imported clips are never silently omitted. Timeline markers are
/// Blockbench editor metadata and are retained in .bbmodel, not this runtime
/// resource. Animation controllers belong to a DIFFERENT resource/codec.
pub fn export_bedrock_animations(doc: &AuthoringDocument) -> Result<Vec<u8>> {
    doc.validate()?;
    let mut animations = Map::new();
    let mut names = HashSet::new();
    for clip in &doc.animation_assets {
        if !editable_transform_clip(clip, &doc.bones) {
            return Err(fail("ANIMATION_EXPORT_CLIP_UNSUPPORTED"));
        }
        let name = clip.get("name").and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty() &&
                name.len() <= 128 && !name.chars().any(char::is_control))
            .ok_or_else(|| fail("ANIMATION_EXPORT_NAME_INVALID"))?;
        if !names.insert(name.to_owned()) {
            return Err(fail("ANIMATION_EXPORT_NAME_CONFLICT"));
        }
        let mut output = Map::new();
        match saved_animation_loop(clip).ok_or_else(|| fail("ANIMATION_EXPORT_LOOP_UNSUPPORTED"))? {
            "loop" => { output.insert("loop".into(), Value::Bool(true)); },
            "hold" => { output.insert("loop".into(), json!("hold_on_last_frame")); },
            "once" => {},
            _ => return Err(fail("ANIMATION_EXPORT_LOOP_UNSUPPORTED")),
        }
        let duration = clip["length"].as_f64()
            .ok_or_else(|| fail("ANIMATION_EXPORT_LENGTH_INVALID"))?;
        if duration > 0.0 {
            output.insert("animation_length".into(), json!(duration));
        }
        let mut bone_outputs = Map::new();
        let mut used_bones = HashSet::new();
        for (id, track) in clip["animators"].as_object()
            .ok_or_else(|| fail("ANIMATION_EXPORT_CLIP_UNSUPPORTED"))? {
            if id == "effects" {
                compile_effects(track, &mut output)?;
                continue;
            }
            let bone = doc.bones.iter().find(|bone| bone.uuid == *id)
                .ok_or_else(|| fail("ANIMATION_EXPORT_BONE_NOT_FOUND"))?;
            if !super::geometry::valid_bone_name(&bone.name) ||
                !used_bones.insert(bone.name.to_ascii_lowercase()) {
                return Err(fail("ANIMATION_EXPORT_BONE_NAME_UNSUPPORTED"));
            }
            let frames = track["keyframes"].as_array()
                .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
            let mut channels = Map::new();
            for channel in ["rotation", "position", "scale"] {
                let mut chosen: Vec<&Value> = frames.iter()
                    .filter(|frame| frame["channel"] == channel).collect();
                if !chosen.is_empty() {
                    channels.insert(channel.into(), compile_bone_channel(&mut chosen, channel)?);
                }
            }
            if !channels.is_empty() {
                bone_outputs.insert(bone.name.clone(), Value::Object(channels));
            }
        }
        if !bone_outputs.is_empty() { output.insert("bones".into(), Value::Object(bone_outputs)); }
        animations.insert(name.into(), Value::Object(output));
    }
    let bytes = serde_json::to_vec_pretty(&json!({
        "format_version": "1.8.0", "animations": animations
    })).map_err(|_| fail("ANIMATION_EXPORT_SERIALIZE_FAILED"))?;
    if bytes.len() > MAX_MODEL_BYTES { return Err(fail("ANIMATION_EXPORT_TOO_LARGE")); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{EditOperation, EditorSession, AnimationEffectPoint, BezierKeyframeHandles};

    const SAMPLE: &str = include_str!("../../fixtures/bedrock-basic.bbmodel");
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
}
