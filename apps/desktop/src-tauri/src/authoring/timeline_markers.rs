//! Saved Blockbench v5.2.1 Animation Timeline Markers.
//! In Blockbench TimelineMarker.getUndoCopy() stores ONLY {color,time,name},
//! not a marker UUID. Match by explicit old time, do not invent IDs or
//! script events. Markers are editorial timing annotations, not gameplay.
use super::{editable_transform_clip, fail, AuthoringDocument, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_MARKERS: usize = 128;
const MAX_PAGE: usize = 32;
const COLOR_COUNT: u8 = 10;
const COLLISION_EPSILON: f64 = 0.001; // Blockbench Animation.extend
const LOOKUP_EPSILON: f64 = 1e-9;
const MAX_RESULT_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedTimelineMarker {
    pub name: String,
    pub time: f64,
    pub color: u8,
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 &&
        !name.chars().any(char::is_control)
}
fn valid_item(marker: &SavedTimelineMarker, length: f64) -> bool {
    valid_name(&marker.name) &&
        marker.color < COLOR_COUNT &&
        marker.time.is_finite() && marker.time >= 0.0 &&
        marker.time <= length
}
pub fn saved_timeline_markers(clip: &Value) -> Option<Vec<SavedTimelineMarker>> {
    let Some(raw) = clip.get("markers") else { return Some(Vec::new()); };
    let raw = raw.as_array()?;
    if raw.len() > MAX_MARKERS { return None; }
    raw.iter().map(|value|
        serde_json::from_value::<SavedTimelineMarker>(value.clone()).ok()
    ).collect()
}
pub fn valid_saved_markers(clip: &Value, length: f64) -> bool {
    if !length.is_finite() || !(0.0..=3600.0).contains(&length) { return false; }
    let Some(mut markers) = saved_timeline_markers(clip) else { return false; };
    if markers.iter().any(|m| !valid_item(m, length)) { return false; }
    markers.sort_by(|a,b| a.time.total_cmp(&b.time));
    markers.windows(2).all(|pair|
        pair[1].time - pair[0].time > COLLISION_EPSILON)
}
fn clip_index(doc: &AuthoringDocument, animation_uuid: &str) -> Result<usize> {
    let mut found = None;
    for (index, clip) in doc.animation_assets.iter().enumerate() {
        if clip.get("uuid").and_then(Value::as_str) != Some(animation_uuid) {
            continue;
        }
        if found.replace(index).is_some() {
            return Err(fail("ANIMATION_ID_AMBIGUOUS"));
        }
    }
    found.ok_or_else(||fail("ANIMATION_NOT_FOUND"))
}
fn editable_clip(doc: &AuthoringDocument, id: &str) -> Result<(usize, f64)> {
    let index = clip_index(doc,id)?;
    let clip = &doc.animation_assets[index];
    if !editable_transform_clip(clip,&doc.bones) {
        return Err(fail("ANIMATION_MARKER_CLIP_UNSUPPORTED"));
    }
    let length = clip.get("length").and_then(Value::as_f64)
        .ok_or_else(||fail("ANIMATION_MARKER_LENGTH_INVALID"))?;
    Ok((index,length))
}
fn existing_marker(markers: &[SavedTimelineMarker], target_time: f64) -> Result<usize> {
    if !target_time.is_finite() || target_time < 0.0 {
        return Err(fail("ANIMATION_MARKER_TARGET_TIME_INVALID"));
    }
    let matches: Vec<_> = markers.iter().enumerate()
        .filter(|(_,m)| (m.time-target_time).abs() <= LOOKUP_EPSILON)
        .map(|(i,_)|i).collect();
    match matches.as_slice() {
        [] => Err(fail("ANIMATION_MARKER_NOT_FOUND")),
        [i] => Ok(*i),
        _ => Err(fail("ANIMATION_MARKER_TIME_AMBIGUOUS")),
    }
}
fn update_saved(doc: &mut AuthoringDocument, index: usize, markers: Vec<SavedTimelineMarker>) -> Result<()> {
    if markers.len() > MAX_MARKERS {
        return Err(fail("ANIMATION_MARKER_SIZE_LIMIT"));
    }
    let clip = &mut doc.animation_assets[index];
    if markers.is_empty() {
        let fields = clip.as_object_mut()
            .ok_or_else(||fail("ANIMATION_MARKER_CLIP_UNSUPPORTED"))?;
        fields.remove("markers");
    } else {
        clip["markers"] = json!(markers);
    }
    if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
        return Err(fail("ANIMATION_MARKER_AFTER_EDIT_INVALID"));
    }
    Ok(())
}
pub(super) fn add_marker(
    doc: &mut AuthoringDocument, animation_uuid: &str,
    time: f64, name: &str, color: u8,
) -> Result<String> {
    let (index,length) = editable_clip(doc,animation_uuid)?;
    let marker = SavedTimelineMarker {name:name.trim().into(),time,color};
    if !valid_item(&marker,length) {
        return Err(fail("ANIMATION_MARKER_INVALID"));
    }
    let mut markers = saved_timeline_markers(&doc.animation_assets[index])
        .ok_or_else(||fail("ANIMATION_MARKER_SOURCE_UNSUPPORTED"))?;
    if markers.len() >= MAX_MARKERS {
        return Err(fail("ANIMATION_MARKER_SIZE_LIMIT"));
    }
    if markers.iter().any(|m| (m.time-time).abs() <= COLLISION_EPSILON) {
        return Err(fail("ANIMATION_MARKER_TIME_CONFLICT"));
    }
    markers.push(marker);
    update_saved(doc,index,markers)?;
    Ok(animation_uuid.to_owned())
}
pub(super) fn update_marker(
    doc: &mut AuthoringDocument, animation_uuid: &str,
    target_time: f64, time: f64, name: &str, color: u8,
) -> Result<String> {
    let (index,length) = editable_clip(doc,animation_uuid)?;
    let proposed = SavedTimelineMarker {name:name.trim().into(),time,color};
    if !valid_item(&proposed,length) {
        return Err(fail("ANIMATION_MARKER_INVALID"));
    }
    let mut markers = saved_timeline_markers(&doc.animation_assets[index])
        .ok_or_else(||fail("ANIMATION_MARKER_SOURCE_UNSUPPORTED"))?;
    let selected = existing_marker(&markers,target_time)?;
    if markers.iter().enumerate().any(|(i,m)|
        i!=selected && (m.time-time).abs() <= COLLISION_EPSILON) {
        return Err(fail("ANIMATION_MARKER_TIME_CONFLICT"));
    }
    markers[selected] = proposed;
    update_saved(doc,index,markers)?;
    Ok(animation_uuid.to_owned())
}
pub(super) fn remove_marker(
    doc: &mut AuthoringDocument, animation_uuid: &str, time: f64,
) -> Result<String> {
    let (index,_) = editable_clip(doc,animation_uuid)?;
    let mut markers = saved_timeline_markers(&doc.animation_assets[index])
        .ok_or_else(||fail("ANIMATION_MARKER_SOURCE_UNSUPPORTED"))?;
    let selected = existing_marker(&markers,time)?;
    markers.remove(selected);
    update_saved(doc,index,markers)?;
    Ok(animation_uuid.to_owned())
}
pub(super) fn scale_markers(
    clip: &mut Value, factor: f64, new_length: f64,
) -> Result<()> {
    if clip.get("markers").is_none() { return Ok(()); }
    if !factor.is_finite() || factor <= 0.0 ||
       !new_length.is_finite() || !(0.0..=3600.0).contains(&new_length) {
        return Err(fail("ANIMATION_MARKER_RETIME_INVALID"));
    }
    let Some(mut markers) = saved_timeline_markers(clip) else {
        return Err(fail("ANIMATION_MARKER_RETIME_UNSUPPORTED"));
    };
    for marker in &mut markers {
        marker.time *= factor;
    }
    // Validate against a temporary lightweight representation to apply the
    // same collision test without rewriting original Marker metadata first.
    let candidate=json!({"markers":markers});
    if !valid_saved_markers(&candidate,new_length) {
        return Err(fail("ANIMATION_MARKER_RETIME_INVALID"));
    }
    clip["markers"]=candidate["markers"].clone();
    Ok(())
}

/// Read-only pagination through the canonical model; no controller, script,
/// gameplay trigger, audio file, emitter, or native marker rendering implied.
pub fn inspect_animation_timeline_markers(
    doc: &AuthoringDocument, animation_uuid: &str,
    offset: usize, limit: usize,
) -> Result<Value> {
    if offset > super::MAX_ELEMENTS || limit==0 || limit > MAX_PAGE {
        return Err(fail("ANIMATION_MARKER_INSPECT_PAGE_INVALID"));
    }
    let index = clip_index(doc,animation_uuid)?;
    let clip = &doc.animation_assets[index];
    if !editable_transform_clip(clip,&doc.bones) {
        return Ok(json!({
            "scope":"unsupported_timeline_markers","recognized":false,
            "reason":"OPAQUE_OR_UNSUPPORTED_ANIMATION",
            "visual_verdict":"UNVERIFIED","playback_verdict":"NOT_EXECUTED",
            "animation_uuid":animation_uuid,
            "total_markers":null,"next_offset":null,"markers":[],
        }));
    }
    let markers = saved_timeline_markers(clip)
        .ok_or_else(||fail("ANIMATION_MARKER_SOURCE_UNSUPPORTED"))?;
    let total=markers.len();
    let end=offset.saturating_add(limit).min(total);
    let result=json!({
        "scope":"saved_timeline_markers",
        "recognized":true,"visual_verdict":"UNVERIFIED",
        "playback_verdict":"NOT_EXECUTED",
        "animation_uuid":animation_uuid,"clip_length":clip["length"],
        "total_markers":total,"offset":offset,
        "next_offset":if end < total {Some(end)} else {None},
        "markers":markers.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
    });
    if serde_json::to_vec(&result)
        .map_err(|_|fail("ANIMATION_MARKER_INSPECT_SERIALIZE"))?.len() > MAX_RESULT_BYTES {
        return Err(fail("ANIMATION_MARKER_INSPECT_TOO_LARGE"));
    }
    Ok(result)
}
