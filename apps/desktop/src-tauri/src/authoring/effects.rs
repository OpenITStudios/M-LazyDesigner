//! Strict, source-backed Blockbench v5.2.1 Sound/Particle keyframe
//! markers for the single Rust Bedrock Entity .bbmodel Animation authority.
//! This is saved event *metadata*, not playback, audio import, Molang
//! execution, particle rendering, controller logic or add-on generation.
use super::{editable_transform_clip, fail, valid_uuid, AuthoringDocument, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_POINTS: usize = 8;
const MAX_LABEL_BYTES: usize = 96;
const MAX_INSPECT_PAGE: usize = 16;
const MAX_INSPECT_RESULT_BYTES: usize = 32 * 1024;

/// One saved KeyframeDataPoint. The supported authored subset has no
/// filesystem path, script, additional state, or playable resource binding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnimationEffectPoint {
    pub effect: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind_to_actor: Option<bool>,
}

fn valid_label(text: &str) -> bool {
    !text.is_empty() && text.len() <= MAX_LABEL_BYTES &&
    text.bytes().all(|b| b.is_ascii_alphanumeric() ||
        matches!(b, b'_' | b'.' | b':' | b'/' | b'-')) &&
    !text.contains("..") && !text.contains("//") &&
    !text.starts_with('/') && !text.ends_with('/')
}
fn supported_channel(channel: &str) -> bool {
    matches!(channel, "sound" | "particle")
}
fn valid_point(point: &AnimationEffectPoint, channel: &str) -> bool {
    valid_label(&point.effect) &&
    point.locator.as_deref().is_none_or(valid_label) &&
    (channel == "particle" || point.bind_to_actor.is_none())
}
fn parse_points(frame: &Value, channel: &str) -> Option<Vec<AnimationEffectPoint>> {
    let items = frame.get("data_points")?.as_array()?;
    if items.is_empty() || items.len() > MAX_POINTS { return None; }
    items.iter().map(|value| {
        let point: AnimationEffectPoint = serde_json::from_value(value.clone()).ok()?;
        valid_point(&point, channel).then_some(point)
    }).collect()
}
fn validate_frame(frame: &Value, length: f64) -> bool {
    let Some(fields) = frame.as_object() else { return false; };
    if !fields.keys().all(|key| matches!(key.as_str(),
        "uuid" | "channel" | "time" | "interpolation" | "data_points")) {
        return false;
    }
    let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
        return false;
    };
    supported_channel(channel) &&
    frame.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) &&
    frame.get("time").and_then(Value::as_f64)
        .is_some_and(|v| v.is_finite() && v >= 0.0 && v <= length) &&
    (frame.get("interpolation").is_none() ||
      frame.get("interpolation").and_then(Value::as_str) == Some("linear")) &&
    parse_points(frame, channel).is_some()
}

/// The effects animator has no Bone target. Blockbench stores it under
/// "animators.effects" with type "effect" and channels sound/particle/timeline.
/// Timeline scripts, raw local files and unknown effect shapes remain opaque.
pub(super) fn valid_effect_track(track: &Value, length: f64) -> bool {
    let Some(fields) = track.as_object() else { return false; };
    if !fields.keys().all(|key| matches!(key.as_str(),
        "name" | "type" | "keyframes")) ||
        fields.get("type").and_then(Value::as_str) != Some("effect") ||
        !fields.get("name").and_then(Value::as_str).is_some_and(|name|
            !name.trim().is_empty() && name.len() <= 128 &&
            !name.chars().any(char::is_control)) {
        return false;
    }
    let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
        return false;
    };
    if frames.len() > 2048 { return false; }
    let mut times: [Vec<f64>; 2] = [Vec::new(), Vec::new()];
    for frame in frames {
        if !validate_frame(frame, length) { return false; }
        let channel = if frame.get("channel").and_then(Value::as_str)
            == Some("sound") { 0 } else { 1 };
        times[channel].push(frame["time"].as_f64().unwrap_or(f64::NAN));
    }
    for channel in &mut times {
        channel.sort_by(f64::total_cmp);
        if channel.windows(2).any(|pair| pair[1]-pair[0] <= 1e-6) {
            return false;
        }
    }
    true
}

fn clip_index(doc: &AuthoringDocument, uuid: &str) -> Result<usize> {
    let matches: Vec<_> = doc.animation_assets.iter().enumerate()
        .filter(|(_,item)| item.get("uuid").and_then(Value::as_str) == Some(uuid))
        .map(|(i,_)|i).collect();
    match matches.as_slice() {
        [] => Err(fail("ANIMATION_NOT_FOUND")),
        [index] => Ok(*index),
        _ => Err(fail("ANIMATION_ID_AMBIGUOUS")),
    }
}
fn frame_index(frames: &[Value], key: &str, channel: &str) -> Result<usize> {
    let hits: Vec<_> = frames.iter().enumerate()
        .filter(|(_,f)| f.get("uuid").and_then(Value::as_str) == Some(key))
        .map(|(i,_)|i).collect();
    let index = match hits.as_slice() {
        [] => return Err(fail("ANIMATION_EFFECT_NOT_FOUND")),
        [i] => *i,
        _ => return Err(fail("ANIMATION_EFFECT_ID_AMBIGUOUS")),
    };
    if frames[index].get("channel").and_then(Value::as_str) != Some(channel) {
        return Err(fail("ANIMATION_EFFECT_CHANNEL_MISMATCH"));
    }
    Ok(index)
}
fn checked_points(channel: &str, points: &[AnimationEffectPoint]) -> Result<()> {
    if !supported_channel(channel) {
        return Err(fail("ANIMATION_EFFECT_CHANNEL_UNSUPPORTED"));
    }
    if points.is_empty() || points.len() > MAX_POINTS ||
       points.iter().any(|point| !valid_point(point, channel)) {
        return Err(fail("ANIMATION_EFFECT_POINTS_INVALID"));
    }
    Ok(())
}
fn checked_time(time: f64, length: f64) -> Result<()> {
    if !time.is_finite() || time < 0.0 || time > length {
        return Err(fail("ANIMATION_EFFECT_TIME_INVALID"));
    }
    Ok(())
}
fn checked_clip(doc: &AuthoringDocument, clip_uuid: &str) -> Result<(usize, f64)> {
    let index = clip_index(doc, clip_uuid)?;
    let clip = &doc.animation_assets[index];
    if !editable_transform_clip(clip, &doc.bones) {
        return Err(fail("ANIMATION_EFFECT_CLIP_UNSUPPORTED"));
    }
    let length = clip.get("length").and_then(Value::as_f64)
        .ok_or_else(|| fail("ANIMATION_EFFECT_LENGTH_INVALID"))?;
    Ok((index,length))
}
fn existing_frames_mut(doc: &mut AuthoringDocument, clip_index: usize) -> Result<&mut Vec<Value>> {
    doc.animation_assets[clip_index].get_mut("animators")
        .and_then(Value::as_object_mut)
        .and_then(|items| items.get_mut("effects"))
        .and_then(|track| track.get_mut("keyframes"))
        .and_then(Value::as_array_mut)
        .ok_or_else(|| fail("ANIMATION_EFFECT_TRACK_NOT_FOUND"))
}
fn check_result(doc: &AuthoringDocument, index: usize) -> Result<()> {
    if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
        return Err(fail("ANIMATION_EFFECT_AFTER_EDIT_UNSUPPORTED"));
    }
    Ok(())
}

pub(super) fn add_event(
    doc: &mut AuthoringDocument, clip_uuid: &str, key_uuid: &str,
    channel: &str, time: f64, points: &[AnimationEffectPoint],
) -> Result<String> {
    checked_points(channel, points)?;
    if !valid_uuid(key_uuid) {
        return Err(fail("ANIMATION_EFFECT_ID_INVALID"));
    }
    let (index,length) = checked_clip(doc, clip_uuid)?;
    checked_time(time,length)?;
    if doc.cubes.iter().any(|cube| cube.uuid == key_uuid) ||
       doc.bones.iter().any(|bone| bone.uuid == key_uuid) ||
       // The canonical recursive check also covers opaque project,
       // resolution, saved asset and hierarchy-extra references.
       super::has_external_uuid_references(doc,key_uuid) {
        return Err(fail("ANIMATION_EFFECT_ID_CONFLICT"));
    }
    let tracks = doc.animation_assets[index].get_mut("animators")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| fail("ANIMATION_EFFECT_CLIP_UNSUPPORTED"))?;
    let track = tracks.entry("effects").or_insert_with(||json!({
        "name":"Effects","type":"effect","keyframes":[]
    }));
    if !valid_effect_track(track,length) {
        return Err(fail("ANIMATION_EFFECT_TRACK_UNSUPPORTED"));
    }
    let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
        .ok_or_else(|| fail("ANIMATION_EFFECT_TRACK_UNSUPPORTED"))?;
    frames.push(json!({
        "uuid":key_uuid,"channel":channel,"time":time,
        "interpolation":"linear","data_points":points,
    }));
    check_result(doc,index)?;
    Ok(key_uuid.to_owned())
}

pub(super) fn update_event(
    doc: &mut AuthoringDocument, clip_uuid: &str, key_uuid: &str,
    channel: &str, time: f64, points: &[AnimationEffectPoint],
) -> Result<String> {
    checked_points(channel,points)?;
    let (index,length) = checked_clip(doc,clip_uuid)?;
    checked_time(time,length)?;
    let frames = existing_frames_mut(doc,index)?;
    let target = frame_index(frames,key_uuid,channel)?;
    frames[target]["time"]=json!(time);
    frames[target]["data_points"]=json!(points);
    check_result(doc,index)?;
    Ok(key_uuid.to_owned())
}

pub(super) fn remove_event(
    doc: &mut AuthoringDocument, clip_uuid: &str,
    key_uuid: &str, channel: &str,
) -> Result<String> {
    if !supported_channel(channel) {
        return Err(fail("ANIMATION_EFFECT_CHANNEL_UNSUPPORTED"));
    }
    let (index,_) = checked_clip(doc,clip_uuid)?;
    let frames = existing_frames_mut(doc,index)?;
    let target = frame_index(frames,key_uuid,channel)?;
    frames.remove(target);
    if super::has_external_uuid_references(doc,key_uuid) {
        return Err(fail("ANIMATION_EFFECT_REFERENCED"));
    }
    check_result(doc,index)?;
    Ok(key_uuid.to_owned())
}

/// Read-only, paginated source evidence. No asset load, audio playback,
/// script execution, locator mesh action or implicit success verdict.
pub fn inspect_animation_effect_events(
    doc: &AuthoringDocument, clip_uuid: &str,
    offset: usize, limit: usize,
) -> Result<Value> {
    if offset > super::MAX_ELEMENTS || limit == 0 || limit > MAX_INSPECT_PAGE {
        return Err(fail("ANIMATION_EFFECT_INSPECT_PAGE_INVALID"));
    }
    let index=clip_index(doc,clip_uuid)?;
    let clip=&doc.animation_assets[index];
    if !editable_transform_clip(clip,&doc.bones) {
        return Ok(json!({
            "scope":"unsupported_animation_effects","recognized":false,
            "reason":"OPAQUE_OR_UNSUPPORTED_EFFECTS",
            "visual_verdict":"UNVERIFIED","playback_verdict":"NOT_EXECUTED",
            "animation_uuid":clip_uuid,"events":[],"next_offset":null,
        }));
    }
    let frames = clip.get("animators").and_then(Value::as_object)
        .and_then(|map|map.get("effects"))
        .and_then(|track|track.get("keyframes"))
        .and_then(Value::as_array);
    let total=frames.map_or(0,Vec::len);
    let end=offset.saturating_add(limit).min(total);
    let events: Vec<_>=frames.into_iter().flatten().skip(offset).take(limit)
        .map(|frame|json!({
            "uuid":frame["uuid"],"channel":frame["channel"],
            "time":frame["time"],"data_points":frame["data_points"],
        })).collect();
    let result=json!({
        "scope":"saved_sound_particle_markers","recognized":true,
        "visual_verdict":"UNVERIFIED","playback_verdict":"NOT_EXECUTED",
        "animation_uuid":clip_uuid,"clip_length":clip["length"],
        "total_events":total,"offset":offset,
        "next_offset":if end < total {Some(end)} else {None},
        "events":events,
    });
    if serde_json::to_vec(&result).map_err(|_| fail("ANIMATION_EFFECT_INSPECT_SERIALIZE"))?.len()
        > MAX_INSPECT_RESULT_BYTES {
        return Err(fail("ANIMATION_EFFECT_INSPECT_TOO_LARGE"));
    }
    Ok(result)
}
