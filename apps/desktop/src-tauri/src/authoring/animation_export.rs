//! Strict Bedrock Entity animation JSON output from the canonical Rust document.
//! Independent of .bbmodel persistence; no controller, Molang or Bezier baking.
//! Reference: JannisX11/blockbench v5.2.1 bedrock_animation.js and keyframe.js.
//! SOURCE ONLY: no Rust, Blockbench or native export has been executed.

use super::{editable_transform_clip, saved_animation_loop, transform_axis, AuthoringDocument, MAX_MODEL_BYTES};
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

fn channel_value(frame: &Value, channel: &str) -> Result<Value> {
    let point = frame.get("data_points").and_then(Value::as_array)
        .and_then(|points| points.first())
        .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
    let mut v = [0.0_f64; 3];
    for (axis, key) in ["x", "y", "z"].iter().enumerate() {
        v[axis] = transform_axis(point.get(*key))
            .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
    }
    // Blockbench Bedrock keyframe exporter inverts local X for position
    // and X/Y for rotation, not scale.
    if matches!(channel, "position" | "rotation") { v[0] = -v[0]; }
    if channel == "rotation" { v[1] = -v[1]; }
    Ok(json!(v))
}

fn compile_bone_channel(frames: &mut Vec<&Value>, channel: &str) -> Result<Value> {
    frames.sort_by(|a,b| a["time"].as_f64().unwrap_or(0.0)
        .total_cmp(&b["time"].as_f64().unwrap_or(0.0)));
    let mut values = Map::new();
    let mut previous: Option<&Value> = None;
    for &frame in frames.iter() {
        let mode = frame.get("interpolation").and_then(Value::as_str)
            .ok_or_else(|| fail("ANIMATION_EXPORT_FRAME_UNSUPPORTED"))?;
        // Bedrock's Bezier path needs explicit sampling/baking; the
        // admitted one-point Catmull-Rom editor shape also needs a
        // verified pre/post transfer. Refuse rather than flatten a curve.
        if !matches!(mode, "linear" | "step") {
            return Err(fail("ANIMATION_EXPORT_INTERPOLATION_REQUIRES_BAKE"));
        }
        let key = time_key(frame["time"].as_f64()
            .ok_or_else(|| fail("ANIMATION_EXPORT_TIME_INVALID"))?)?;
        let now = channel_value(frame, channel)?;
        let value = if previous.is_some_and(|old|
            old.get("interpolation").and_then(Value::as_str) == Some("step")) {
            json!({"pre":channel_value(previous.unwrap(),channel)?,"post":now})
        } else {
            now
        };
        if values.insert(key, value).is_some() {
            return Err(fail("ANIMATION_EXPORT_TIMECODE_COLLISION"));
        }
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
    use super::super::{EditOperation, EditorSession, AnimationEffectPoint};

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
    fn rejects_opaque_and_unbaked_curves_without_partial_output() {
        let mut s = EditorSession::open(SAMPLE.as_bytes()).unwrap();
        s.apply(0, &[
            EditOperation::CreateAnimation { uuid: CLIP.into(), name: "animation.walk".into(), length: 1.0 },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
                channel: "rotation".into(), time: 0.0, value: [12.0, 34.0, 56.0],
            },
            EditOperation::SetBoneTransformKeyframeInterpolation {
                animation_uuid: CLIP.into(), bone_uuid: BONE.into(), keyframe_uuid: FIRST.into(),
                channel: "rotation".into(), interpolation: "catmullrom".into(),
            },
        ]).unwrap();
        let saved = s.export().unwrap();
        assert_eq!(export_bedrock_animations(s.document()).unwrap_err(),
            "ANIMATION_EXPORT_INTERPOLATION_REQUIRES_BAKE");
        assert_eq!(s.export().unwrap(), saved);
        let mut unknown = s.document().clone();
        unknown.animation_assets[0]["unrecognized_payload"] = json!({"script":"opaque"});
        assert_eq!(export_bedrock_animations(&unknown).unwrap_err(),
            "ANIMATION_EXPORT_CLIP_UNSUPPORTED");
    }
}
