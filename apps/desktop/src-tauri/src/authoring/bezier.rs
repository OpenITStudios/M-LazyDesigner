//! Strict, source-backed Blockbench 5.2.1 Bezier keyframe handles.
//! Persist the four per-axis arrays in native .bbmodel keys. No Molang,
//! implicit keyframe coercion, or duplicate animation authority.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BezierKeyframeHandles {
    pub linked: bool,
    pub left_time: [f64; 3],
    pub left_value: [f64; 3],
    pub right_time: [f64; 3],
    pub right_value: [f64; 3],
}

impl BezierKeyframeHandles {
    pub fn valid(&self) -> bool {
        const MAX_TIME: f64 = 3600.0;
        const MAX_VALUE: f64 = 100_000.0;
        let valid = |value: &[f64; 3], low: f64, high: f64|
            value.iter().all(|x| x.is_finite() && *x >= low && *x <= high);
        if !valid(&self.left_time, -MAX_TIME, 0.0) ||
           !valid(&self.right_time, 0.0, MAX_TIME) ||
           !valid(&self.left_value, -MAX_VALUE, MAX_VALUE) ||
           !valid(&self.right_value, -MAX_VALUE, MAX_VALUE) {
            return false;
        }
        // In Blockbench linked handles stay opposite; do not accept a
        // contradictory state and then silently change it during an edit.
        !self.linked || (0..3).all(|axis|
            (self.left_time[axis] + self.right_time[axis]).abs() <= 1e-9 &&
            (self.left_value[axis] + self.right_value[axis]).abs() <= 1e-9)
    }
}

pub(super) fn has_metadata(frame: &Value) -> bool {
    ["bezier_linked", "bezier_left_time", "bezier_left_value",
     "bezier_right_time", "bezier_right_value"]
        .iter().any(|key| frame.get(*key).is_some())
}

/// Accept only complete, finite and internally coherent saved handle arrays.
/// Missing/default handles on imported Bezier clips stay opaque; new keys
/// are emitted explicitly by the dedicated authoring operation.
pub fn parse_saved_bezier_handles(frame: &Value) -> Option<BezierKeyframeHandles> {
    if frame.get("interpolation")?.as_str()? != "bezier" { return None; }
    let handles = BezierKeyframeHandles {
        linked: frame.get("bezier_linked")?.as_bool()?,
        left_time: serde_json::from_value(frame.get("bezier_left_time")?.clone()).ok()?,
        left_value: serde_json::from_value(frame.get("bezier_left_value")?.clone()).ok()?,
        right_time: serde_json::from_value(frame.get("bezier_right_time")?.clone()).ok()?,
        right_value: serde_json::from_value(frame.get("bezier_right_value")?.clone()).ok()?,
    };
    handles.valid().then_some(handles)
}


/// Reject ambiguous inverse-time curves in the same subset used by the
/// Tauri preview. Blockbench clamps handles to each segment duration.
/// This strict subset excludes crossed control times (no unique inverse).
pub fn valid_track_segments(frames: &[Value]) -> bool {
    for channel in ["rotation", "position", "scale"] {
        let mut keys: Vec<&Value> = frames.iter().filter(|frame|
            frame.get("channel").and_then(Value::as_str) == Some(channel)).collect();
        keys.sort_by(|a,b| a.get("time").and_then(Value::as_f64)
            .unwrap_or(f64::NAN).total_cmp(
                &b.get("time").and_then(Value::as_f64).unwrap_or(f64::NAN)));
        for pair in keys.windows(2) {
            let a = pair[0];
            let b = pair[1];
            let a_mode = a.get("interpolation").and_then(Value::as_str);
            let b_mode = b.get("interpolation").and_then(Value::as_str);
            if a_mode == Some("step") ||
               a_mode == Some("catmullrom") ||
               b_mode == Some("catmullrom") ||
               (a_mode != Some("bezier") && b_mode != Some("bezier")) {
                continue;
            }
            let (Some(start), Some(end)) = (
                a.get("time").and_then(Value::as_f64),
                b.get("time").and_then(Value::as_f64)
            ) else { return false; };
            let gap = end - start;
            if !gap.is_finite() || gap <= 1e-6 { return false; }
            let before = parse_saved_bezier_handles(a);
            let after = parse_saved_bezier_handles(b);
            if a_mode == Some("bezier") && before.is_none() ||
               b_mode == Some("bezier") && after.is_none() {
                return false;
            }
            for axis in 0..3 {
                let right = before.as_ref()
                    .map(|h| h.right_time[axis]).unwrap_or(0.1).clamp(0.0,gap);
                let left = after.as_ref()
                    .map(|h| h.left_time[axis]).unwrap_or(-0.1).clamp(-gap,0.0);
                if right > gap + left + 1e-9 { return false; }
            }
        }
    }
    true
}

pub(super) fn write_handles(frame: &mut Value, handles: &BezierKeyframeHandles) {
    frame["interpolation"] = json!("bezier");
    frame["bezier_linked"] = json!(handles.linked);
    frame["bezier_left_time"] = json!(handles.left_time);
    frame["bezier_left_value"] = json!(handles.left_value);
    frame["bezier_right_time"] = json!(handles.right_time);
    frame["bezier_right_value"] = json!(handles.right_value);
}

pub(super) fn clear_handles(frame: &mut Value) {
    if let Some(fields) = frame.as_object_mut() {
        for key in ["bezier_linked", "bezier_left_time", "bezier_left_value",
                    "bezier_right_time", "bezier_right_value"] {
            fields.remove(key);
        }
    }
}

/// A retime changes the horizontal handle offsets as Blockbench does;
/// vertical value offsets remain identical. Uses full-transaction rollback.
pub(super) fn retime_handles(frame: &mut Value, factor: f64) -> bool {
    let Some(mut handles) = parse_saved_bezier_handles(frame) else { return false; };
    for axis in 0..3 {
        handles.left_time[axis] *= factor;
        handles.right_time[axis] *= factor;
    }
    if !handles.valid() { return false; }
    write_handles(frame, &handles);
    true
}
