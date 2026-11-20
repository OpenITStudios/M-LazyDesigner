//! Read-only, model-wide source handoff for Bedrock Entity asset exports.
//! Checks one explicitly chosen atlas against ALL six Cube face references and
//! reuses the real Geometry/PNG/Animation exporters to avoid a second
//! compatibility engine. Never publishes files or claims visual/native PASS.
//! SOURCE ONLY: tests and runtime/native acceptance remain NOT_EXECUTED.

use super::{
    bedrock_animation_curve_fidelity, export_bedrock_animations,
    export_paint_png, sha256, valid_uuid,
    AuthoringDocument, OutlinerNode, FACE_NAMES,
};
use serde_json::{json, Value};
use std::collections::HashMap;

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

fn export_evidence(
    result: std::result::Result<&[u8], &String>,
) -> (Value, bool) {
    match result {
        Ok(bytes) => (json!({
            "status":"source_exportable",
            "sha256":sha256(bytes), "bytes":bytes.len()
        }), true),
        Err(code) => (json!({
            "status":"blocked", "reason":code,
            "sha256":null, "bytes":null
        }), false),
    }
}

/// A conservative numeric bound for uniform Catmull-Rom intervals, derived
/// from the same four neighboring values used by pinned Blockbench SplineCurve
/// and Rust's read-only pose projection. It is NOT a native Bedrock sample.
/// For [p0,p1,p2,p3], the cubic Bezier-equivalent scalar controls are:
/// p1, p1+(p2-p0)/6, p2-(p3-p1)/6, p2. Convex hull bounds every u in [0,1].
/// Preserve saved Step > Catmull precedence and index-neighbor loop wrapping.
/// Each axis is bounded independently; no assumed synchronized 3D extremum.
/// Input frames belong to one validated, numeric Bone channel.
fn catmullrom_control_bounds(frames: &[&Value], looping: bool) -> Result<Option<[f64; 3]>> {
    if frames.len() < 2 { return Ok(None); }
    let mut maximum = [0.0_f64; 3];
    let mut found = false;
    let values = |frame: &Value| -> Result<[f64; 3]> {
        let point = frame.get("data_points").and_then(Value::as_array)
            .and_then(|points| points.first())
            .ok_or_else(|| fail("CATMULL_BOUND_FRAME_UNSUPPORTED"))?;
        let axis = |name: &str| super::transform_axis(point.get(name))
            .ok_or_else(|| fail("CATMULL_BOUND_AXIS_UNSUPPORTED"));
        Ok([axis("x")?, axis("y")?, axis("z")?])
    };
    for i in 0..frames.len() - 1 {
        let before = frames[i];
        let after = frames[i + 1];
        let old_mode = before.get("interpolation").and_then(Value::as_str);
        let new_mode = after.get("interpolation").and_then(Value::as_str);
        if old_mode == Some("step") ||
            (old_mode != Some("catmullrom") && new_mode != Some("catmullrom")) {
            continue;
        }
        let prior = if i > 0 { frames[i - 1] }
            else if looping && frames.len() >= 3 { frames[frames.len() - 2] }
            else { before };
        let following = if i + 2 < frames.len() { frames[i + 2] }
            else if looping && frames.len() >= 3 { frames[1] }
            else { after };
        let p0 = values(prior)?;
        let p1 = values(before)?;
        let p2 = values(after)?;
        let p3 = values(following)?;
        for axis in 0..3 {
            let control1 = p1[axis] + (p2[axis] - p0[axis]) / 6.0;
            let control2 = p2[axis] - (p3[axis] - p1[axis]) / 6.0;
            let extreme = [p1[axis], control1, control2, p2[axis]].into_iter()
                .map(f64::abs).fold(0.0_f64, f64::max);
            if !extreme.is_finite() { return Err(fail("CATMULL_BOUND_OVERFLOW")); }
            maximum[axis] = maximum[axis].max(extreme);
        }
        found = true;
    }
    Ok(found.then_some(maximum))
}

/// Conservative source-only upper budget for ONE authored numeric clip.
/// Linear/step Bone Position uses the maximum nested sum of vector lengths;
/// Bone Rotation (any numeric angle) uses the canonical compiled Geometry's
/// pivot-chain radius. Linear/step Scale is bounded by multiplying the largest
/// per-Bone axis magnitude (minimum factor 1) along each authored hierarchy
/// path. Each clip is considered separately and the maximum reach and growth
/// are conservatively combined across clips. This can substantially overstate
/// actual clearance, never understate it under this numeric single-clip subset.
/// This does NOT measure visual poses, native culling, simultaneous controller
/// blends or opaque/Molang data. Bezier Position/Scale uses per-axis cubic
/// control-value bounds (time handles differ per axis), without sampling.
/// Catmull-Rom Position/Scale uses uniform spline control bounds including
/// neighbor/wrap values; it is not treated as endpoint-linear. Numeric
/// Catmull/Bezier Rotation needs only the compiled pivot radius.
/// Preserve the original scope/status fields for typed Code Mode compatibility.
fn translation_clearance(
    doc: &AuthoringDocument, static_bounds: &Value, saved_bounds: &Value,
    compiled_bones: &[Value],
) -> Value {
    const PIXELS_PER_BLOCK: f64 = 16.0;
    fn unassessed(reason: &str) -> Value {
        json!({
            "scope":"single_clip_numeric_translation_clearance",
            "status":"unassessed", "reason":reason,
            "native_verdict":"NOT_EXECUTED", "visual_verdict":"UNVERIFIED",
            "controller_blends":"NOT_ASSESSED",
        })
    }
    fn maximum_chain(
        nodes: &[OutlinerNode],
        local_position: &HashMap<&str, f64>,
        local_scale: &HashMap<&str, f64>,
        inherited_reach: f64, inherited_growth: f64,
        maximum_reach: &mut f64, maximum_growth: &mut f64,
    ) -> bool {
        for node in nodes {
            if let OutlinerNode::Bone(bone) = node {
                let id = bone.uuid.as_str();
                let reach = inherited_reach +
                    local_position.get(id).copied().unwrap_or(0.0);
                let growth = inherited_growth *
                    local_scale.get(id).copied().unwrap_or(1.0);
                if !reach.is_finite() || !growth.is_finite() { return false; }
                *maximum_reach = (*maximum_reach).max(reach);
                *maximum_growth = (*maximum_growth).max(growth);
                if !maximum_chain(&bone.children, local_position, local_scale,
                    reach, growth, maximum_reach, maximum_growth) {
                    return false;
                }
            }
        }
        true
    }
    let mut maximum_reach: f64 = 0.0;
    let mut position_tracks = 0usize;
    let mut rotation_tracks = 0usize;
    let mut scale_tracks = 0usize;
    let mut bezier_bone_tracks = 0usize;
    let mut catmullrom_rotation_tracks = 0usize;
    let mut catmullrom_numeric_tracks = 0usize;
    let mut has_animated_rotation = false;
    let mut has_animated_scale = false;
    let mut maximum_scale_growth = 1.0_f64;
    let mut numeric_clips = 0usize;
    for clip in &doc.animation_assets {
        if !super::editable_transform_clip(clip, &doc.bones) {
            return unassessed("OPAQUE_OR_UNSUPPORTED_CLIP");
        }
        numeric_clips += 1;
        let Some(tracks) = clip.get("animators").and_then(Value::as_object) else {
            return unassessed("OPAQUE_OR_UNSUPPORTED_CLIP");
        };
        let mut local: HashMap<&str, f64> = HashMap::new();
        let mut local_scale: HashMap<&str, f64> = HashMap::new();
        for (bone_uuid, track) in tracks {
            if bone_uuid == "effects" { continue; }
            let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
                return unassessed("OPAQUE_OR_UNSUPPORTED_TRACK");
            };
            let mut has_position = false;
            let mut has_rotation = false;
            let mut has_scale = false;
            let mut has_bezier = false;
            let mut has_rotation_catmullrom = false;
            let mut has_catmullrom_numeric = false;
            let mut catmullrom_position = false;
            let mut bezier_position = false;
            // Bezier per-axis time inversion may use DIFFERENT parameters.
            // Bound each axis independently, then take the Euclidean norm.
            let mut position_component_bounds = [0.0_f64; 3];
            for frame in frames {
                let Some(mode) = frame.get("interpolation").and_then(Value::as_str) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                let Some(channel) = frame.get("channel").and_then(Value::as_str) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                if mode == "catmullrom" {
                    if channel == "rotation" {
                        has_rotation_catmullrom = true;
                    } else if channel == "position" || channel == "scale" {
                        has_catmullrom_numeric = true;
                    } else {
                        return unassessed("NONLINEAR_OR_UNBOUNDED_CURVE");
                    }
                } else if mode != "linear" && mode != "step" && mode != "bezier" {
                    return unassessed("NONLINEAR_OR_UNBOUNDED_CURVE");
                }
                let handles = if mode == "bezier" {
                    has_bezier = true;
                    match super::bezier::parse_saved_bezier_handles(frame) {
                        Some(value) => Some(value),
                        None => return unassessed("BEZIER_HANDLES_UNSUPPORTED"),
                    }
                } else { None };
                let Some(point) = frame.get("data_points").and_then(Value::as_array)
                    .and_then(|values| values.first()) else {
                    return unassessed("OPAQUE_OR_UNSUPPORTED_FRAME");
                };
                let mut axes = [0.0_f64; 3];
                for (axis, name) in ["x", "y", "z"].iter().enumerate() {
                    let Some(value) = super::transform_axis(point.get(*name)) else {
                        return unassessed("NONNUMERIC_TRANSFORM");
                    };
                    axes[axis] = value;
                }
                match channel {
                    "position" => {
                        has_position = true;
                        let magnitude = axes[0].hypot(axes[1]).hypot(axes[2]);
                        if !magnitude.is_finite() {
                            return unassessed("TRANSLATION_MAGNITUDE_OVERFLOW");
                        }
                        let entry = local.entry(bone_uuid.as_str()).or_insert(0.0);
                        *entry = (*entry).max(magnitude);
                        for axis in 0..3 {
                            position_component_bounds[axis] =
                                position_component_bounds[axis].max(axes[axis].abs());
                            if let Some(handles) = &handles {
                                // Every value on a cubic Bezier axis lies
                                // between its four scalar control values.
                                // Include unused handles: a safe overbound.
                                bezier_position = true;
                                position_component_bounds[axis] =
                                    position_component_bounds[axis]
                                        .max((axes[axis] + handles.left_value[axis]).abs())
                                        .max((axes[axis] + handles.right_value[axis]).abs());
                            }
                        }
                    },
                    "rotation" if axes.iter().any(|axis| *axis != 0.0) ||
                        handles.as_ref().is_some_and(|h|
                            h.left_value.iter().chain(h.right_value.iter())
                                .any(|value| *value != 0.0)) => {
                        // Rotation magnitude is irrelevant to the pivot
                        // sphere; treat even very small nonzero keys as
                        // requiring the full conservative envelope.
                        has_animated_rotation = true;
                        if !has_rotation {
                            has_rotation = true;
                            rotation_tracks += 1;
                        }
                    },
                    "scale" => {
                        // The admitted numeric Scale is nonnegative. Between
                        // linear endpoints, every axis stays in their convex
                        // range; Step holds a saved axis exactly. Use >=1
                        // to upper-bound shrink-only and absent channels.
                        let mut growth = axes.into_iter().fold(1.0_f64, f64::max);
                        if let Some(handles) = &handles {
                            for axis in 0..3 {
                                growth = growth
                                    .max((axes[axis] + handles.left_value[axis]).abs())
                                    .max((axes[axis] + handles.right_value[axis]).abs());
                            }
                        }
                        if !growth.is_finite() {
                            return unassessed("SCALE_MAGNITUDE_OVERFLOW");
                        }
                        let entry = local_scale.entry(bone_uuid.as_str()).or_insert(1.0);
                        *entry = (*entry).max(growth);
                        if axes.iter().any(|axis| *axis != 1.0) ||
                            handles.as_ref().is_some_and(|h|
                                h.left_value.iter().chain(h.right_value.iter())
                                    .any(|value| *value != 0.0)) {
                            has_animated_scale = true;
                            if !has_scale { has_scale = true; scale_tracks += 1; }
                        }
                    },
                    "rotation" => {},
                    _ => return unassessed("UNSUPPORTED_CHANNEL"),
                }
            }
            if has_catmullrom_numeric {
                let looping = clip.get("loop").and_then(Value::as_str) == Some("loop");
                for channel in ["position", "scale"] {
                    let mut chosen: Vec<&Value> = frames.iter()
                        .filter(|frame| frame.get("channel").and_then(Value::as_str) == Some(channel))
                        .collect();
                    chosen.sort_by(|a, b| a["time"].as_f64().unwrap_or(0.0)
                        .total_cmp(&b["time"].as_f64().unwrap_or(0.0)));
                    let bounds = match catmullrom_control_bounds(&chosen, looping) {
                        Ok(bounds) => bounds,
                        Err(_) => return unassessed("CATMULL_BOUND_UNAVAILABLE"),
                    };
                    if let Some(bounds) = bounds {
                        match channel {
                            "position" => {
                                catmullrom_position = true;
                                for axis in 0..3 {
                                    position_component_bounds[axis] =
                                        position_component_bounds[axis].max(bounds[axis]);
                                }
                            },
                            "scale" => {
                                let factor = bounds.into_iter().fold(1.0_f64, f64::max);
                                if !factor.is_finite() { return unassessed("CATMULL_SCALE_OVERFLOW"); }
                                let entry = local_scale.entry(bone_uuid.as_str()).or_insert(1.0);
                                *entry = (*entry).max(factor);
                                if factor != 1.0 {
                                    has_animated_scale = true;
                                    if !has_scale { has_scale = true; scale_tracks += 1; }
                                }
                            },
                            _ => unreachable!(),
                        }
                    }
                }
                catmullrom_numeric_tracks += 1;
            }
            if has_position { position_tracks += 1; }
            if bezier_position || catmullrom_position {
                let magnitude = position_component_bounds[0]
                    .hypot(position_component_bounds[1])
                    .hypot(position_component_bounds[2]);
                if !magnitude.is_finite() {
                    return unassessed("BEZIER_POSITION_BOUND_OVERFLOW");
                }
                let entry = local.entry(bone_uuid.as_str()).or_insert(0.0);
                *entry = (*entry).max(magnitude);
            }
            if has_bezier { bezier_bone_tracks += 1; }
            if has_rotation_catmullrom { catmullrom_rotation_tracks += 1; }
        }
        let mut clip_reach = 0.0_f64;
        let mut clip_growth = 1.0_f64;
        if !maximum_chain(&doc.hierarchy, &local, &local_scale,
            0.0, 1.0, &mut clip_reach, &mut clip_growth) {
            return unassessed("TRANSFORM_CHAIN_OVERFLOW");
        }
        maximum_reach = maximum_reach.max(clip_reach);
        maximum_scale_growth = maximum_scale_growth.max(clip_growth);
    }
    if maximum_reach == 0.0 && !has_animated_rotation && !has_animated_scale {
        return json!({
            "scope":"single_clip_numeric_translation_clearance",
            "status":"no_numeric_translation", "numeric_clips":numeric_clips,
            "coverage_mode":"translation_only", "rotation_tracks":0,
            "scale_tracks":0, "max_scale_chain_amplification":1.0,
            "bezier_bone_tracks":bezier_bone_tracks,
            "catmullrom_rotation_tracks":catmullrom_rotation_tracks,
            "catmullrom_numeric_tracks":catmullrom_numeric_tracks,
            "position_tracks":position_tracks, "max_reach_model_units":0.0,
            "native_verdict":"NOT_EXECUTED", "visual_verdict":"UNVERIFIED",
            "controller_blends":"NOT_ASSESSED",
        });
    }
    let (Some(width), Some(height), Some(center_y),
         Some(actual_width), Some(actual_height), Some(actual_center_y)) = (
        static_bounds["visible_bounds_width"].as_f64(),
        static_bounds["visible_bounds_height"].as_f64(),
        static_bounds["visible_bounds_offset"][1].as_f64(),
        saved_bounds["width"].as_f64(),
        saved_bounds["height"].as_f64(),
        saved_bounds["offset"][1].as_f64(),
    ) else { return unassessed("GEOMETRY_BOUNDS_UNAVAILABLE"); };
    let shift = maximum_reach / PIXELS_PER_BLOCK;
    let (required_width, required_height, required_low, required_high,
         required_center_y, coverage_mode, rotation_radius) =
        if has_animated_rotation || has_animated_scale {
        // The SAME compiled Geometry's pivot sphere bounds arbitrary rigid
        // rotations. Every scale along an ancestor chain is bounded by
        // its max admitted axis (>=1); multiplying the global pivot/position
        // budget by the largest complete chain growth is deliberately loose,
        // but also conservatively covers scaling of each ancestor translation.
        // Never infer native culling or active-controller combinations.
        let radius = match super::geometry::compiled_rotation_envelope_radius(compiled_bones) {
            Ok(value) => value,
            Err(_) => return unassessed("GEOMETRY_ROTATION_ENVELOPE_UNAVAILABLE"),
        };
        let model_reach = (radius + maximum_reach) * maximum_scale_growth;
        let total = model_reach / PIXELS_PER_BLOCK;
        (total * 2.0, total * 2.0, -total, total, 0.0,
         if has_animated_scale { "scaled_pivot_envelope" }
         else { "pivot_rotation_envelope" }, Some(radius))
    } else {
        (width + shift * 2.0, height + shift * 2.0,
         center_y - height / 2.0 - shift, center_y + height / 2.0 + shift,
         center_y, "translation_only", None)
    };
    let actual_low = actual_center_y - actual_height / 2.0;
    let actual_high = actual_center_y + actual_height / 2.0;
    if ![required_width, required_height, required_low, required_high,
        actual_low, actual_high].iter().all(|value| value.is_finite()) {
        return unassessed("GEOMETRY_REACH_OVERFLOW");
    }
    // Width is a horizontal X/Z diameter; height is a vertical interval.
    // This asks whether the published box encloses the conservative sum,
    // NOT whether the actual rendered pose is clipped in Minecraft.
    let width_shortfall = (required_width - actual_width).max(0.0);
    let below_shortfall = (actual_low - required_low).max(0.0);
    let above_shortfall = (required_high - actual_high).max(0.0);
    let review = width_shortfall > 0.0 || below_shortfall > 0.0 || above_shortfall > 0.0;
    json!({
        "scope":"single_clip_numeric_translation_clearance",
        "status":if review { "conservative_margin_shortfall" } else { "source_budget_covered" },
        "numeric_clips":numeric_clips,
        "position_tracks":position_tracks,
        "rotation_tracks":rotation_tracks,
        "scale_tracks":scale_tracks,
        "bezier_bone_tracks":bezier_bone_tracks,
        "catmullrom_rotation_tracks":catmullrom_rotation_tracks,
        "catmullrom_numeric_tracks":catmullrom_numeric_tracks,
        "max_scale_chain_amplification":maximum_scale_growth,
        "coverage_mode":coverage_mode,
        "rotation_radius_model_units":rotation_radius,
        "max_reach_model_units":maximum_reach,
        "max_reach_blocks":shift,
        "required_conservative_bounds":{
            "width":required_width, "height":required_height,
            "offset":[0.0, required_center_y, 0.0]
        },
        "shortfall_blocks":{
            "horizontal_width":width_shortfall,
            "below":below_shortfall,
            "above":above_shortfall
        },
        "native_verdict":"NOT_EXECUTED",
        "visual_verdict":"UNVERIFIED",
        "controller_blends":"NOT_ASSESSED",
    })
}

/// Source-only consistency evidence, NOT a runtime bundle or validation of
/// the rendered/saved texture on actual Minecraft geometry.
///
/// texture_uuid is an intentional asset selection by the caller; never
/// select the first texture implicitly. Only a single atlas can accompany
/// this simple Bedrock Entity Geometry output. An unused second texture does
/// not invalidate that pairing; a referenced different atlas does.
///
/// The caller's inspect-batch SHA guards that all returned exporter hashes
/// describe the SAME immutable .bbmodel input.
///
/// Keep the compact two-argument caller stable; use the paged form to locate
/// individual Cube/face corrections without exposing private PNG bytes.
pub fn inspect_bedrock_asset_handoff(
    doc: &AuthoringDocument, texture_uuid: &str,
) -> Result<Value> {
    inspect_bedrock_asset_handoff_page(doc, texture_uuid, 0, 16)
}

/// Issues are ordered by canonical Cube order then six-face order, not by
/// severity or renderer visibility. Page indices refer only to faulty faces.
/// Every page still reports whole-model totals and exporter output hashes.
pub fn inspect_bedrock_asset_handoff_page(
    doc: &AuthoringDocument, texture_uuid: &str,
    offset: usize, limit: usize,
) -> Result<Value> {
    if offset > super::MAX_ELEMENTS * FACE_NAMES.len() ||
       limit == 0 || limit > 32 {
        return Err(fail("ASSET_HANDOFF_PAGE_INVALID"));
    }
    doc.validate()?;
    if !valid_uuid(texture_uuid) {
        return Err(fail("ASSET_HANDOFF_TEXTURE_UUID_INVALID"));
    }
    let texture_indices: HashMap<&str, usize> = doc.texture_assets
        .iter().enumerate()
        .filter_map(|(index, texture)| {
            texture.get("uuid").and_then(Value::as_str).map(|id| (id, index))
        }).collect();
    let selected_index = texture_indices.get(texture_uuid).copied();

    let mut referenced_selected = 0usize;
    let mut referenced_other = 0usize;
    let mut unresolved = 0usize;
    let mut no_texture = 0usize;
    let mut implicit = 0usize;
    let mut explicit_absent = 0usize;
    let mut all_faces = 0usize;
    let mut uv_out_of_bounds = 0usize;
    let mut uv_zero_area = 0usize;
    let mut uv_projection_unsupported = 0usize;
    let mut total_issues = 0usize;
    let mut issues = Vec::with_capacity(limit);

    for cube in &doc.cubes {
        let box_uv = super::cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false));
        // Recompute the same Box UV net owned by Rust, once per Cube, only
        // for read-only metadata inspection; no saved UVs or PNGs are edited.
        let projected_box = if box_uv && super::check_box_uv_repack_rules(doc, cube).is_ok() {
            let mut derived = cube.clone();
            super::refresh_box_uv(&mut derived).ok().map(|()| derived)
        } else { None };
        for name in FACE_NAMES {
            all_faces += 1;
            let face = cube.faces.get(name).and_then(Value::as_object)
                .ok_or_else(|| fail("ASSET_HANDOFF_FACE_UNSUPPORTED"))?;
            let (reference_kind, referenced): (&str, Option<usize>) = match face.get("texture") {
                Some(Value::Null) => {
                    explicit_absent += 1;
                    continue;
                },
                Some(Value::Bool(false)) => {
                    no_texture += 1;
                    ("false", None)
                },
                None => {
                    implicit += 1;
                    ("unset", None)
                },
                Some(Value::Number(index)) => ("index", index.as_u64()
                    .and_then(|index| usize::try_from(index).ok())
                    .filter(|index| *index < doc.texture_assets.len())),
                Some(Value::String(id)) => ("uuid", texture_indices.get(id.as_str()).copied()),
                _ => ("unsupported", None),
            };
            let mut uv_rect: Option<[f64; 4]> = None;
            let mut uv_source: Option<&str> = None;
            let problem = match (reference_kind, referenced) {
                ("false", _) => Some("false_reference"),
                ("unset", _) => Some("unset_reference"),
                (_, Some(index)) if Some(index) == selected_index => {
                    referenced_selected += 1;
                    // The Geometry resource stores one global atlas size.
                    // A correct texture UUID is insufficient when the UV net
                    // points outside it. Reversed UVs and fractional UVs are
                    // valid; inspect min/max, not integer pixel rounding.
                    let projected = if box_uv { projected_box.as_ref() } else { Some(cube) };
                    if let Some(projected) = projected {
                        let rect = super::face_uv(projected, name)?;
                        uv_source = Some(if box_uv { "derived_box" } else { "saved_manual" });
                        uv_rect = Some(rect);
                        if rect[0].min(rect[2]) < 0.0 ||
                           rect[1].min(rect[3]) < 0.0 ||
                           rect[0].max(rect[2]) > f64::from(doc.resolution.width) ||
                           rect[1].max(rect[3]) > f64::from(doc.resolution.height) {
                            uv_out_of_bounds += 1;
                            Some("uv_out_of_bounds")
                        } else if rect[0] == rect[2] || rect[1] == rect[3] {
                            uv_zero_area += 1;
                            Some("uv_zero_area")
                        } else { None }
                    } else {
                        uv_projection_unsupported += 1;
                        Some("uv_projection_unsupported")
                    }
                },
                (_, Some(_)) => {
                    referenced_other += 1;
                    Some("other_texture")
                },
                _ => {
                    unresolved += 1;
                    Some("unresolved_reference")
                },
            };
            if let Some(problem) = problem {
                if total_issues >= offset && issues.len() < limit {
                    let referenced_texture_uuid = referenced
                        .and_then(|index| doc.texture_assets.get(index))
                        .and_then(|texture| texture.get("uuid"))
                        .and_then(Value::as_str);
                    // Location + specific UV evidence, never a destructive
                    // repair recommendation or claimed visual coverage.
                    issues.push(json!({
                        "cube_uuid":cube.uuid,
                        "face":name,
                        "problem":problem,
                        "reference_kind":reference_kind,
                        "referenced_texture_uuid":referenced_texture_uuid,
                        "uv_rect":uv_rect,
                        "uv_source":uv_source,
                    }));
                }
                total_issues += 1;
            }
        }
    }

    // Reuse canonical exporters. These execute in memory only; their hashes
    // can be compared with individually published artifacts at the same SHA.
    let geometry_output = super::geometry::export_bedrock_geometry_with_static_bounds(doc);
    let (mut geometry, geo_ok) = export_evidence(
        geometry_output.as_ref().map(|(bytes, _)| bytes.as_slice()));
    if let Ok((bytes, static_bounds)) = &geometry_output {
        let parsed: Value = serde_json::from_slice(bytes)
            .map_err(|_| fail("ASSET_HANDOFF_GEOMETRY_READ_INVALID"))?;
        let description = &parsed["minecraft:geometry"][0]["description"];
        geometry["visible_bounds"] = json!({
            "width":description["visible_bounds_width"],
            "height":description["visible_bounds_height"],
            "offset":description["visible_bounds_offset"],
        });
        geometry["visible_bounds_source"] = json!(
            if doc.extensions.contains_key("visible_box") {
                "saved_visible_box_union"
            } else { "computed_static" });
        if !doc.animation_assets.is_empty() {
            // Reuse this SAME Geometry compiler's actual static envelope.
            // No cloned model, second export, or replacement model authority.
            let current = geometry["visible_bounds"].clone();
            let compiled_bones = parsed["minecraft:geometry"][0]["bones"]
                .as_array().ok_or_else(|| fail("ASSET_HANDOFF_GEOMETRY_BONES_INVALID"))?;
            geometry["translation_clearance"] =
                translation_clearance(doc, static_bounds, &current, compiled_bones);
        }
    }
    // Bind the editable .bbmodel to the same in-memory document as the
    // Geometry, Texture and Animation exporters. The existing streaming
    // digest has the exact saved bytes and size without an extra JSON Vec.
    // An over-budget canonical output is a blocker, not a false success.
    let (bbmodel, bbmodel_ok) = match super::bbmodel::canonical_fingerprint_validated(doc) {
        Ok((digest, bytes)) => (json!({
            "status":"source_exportable", "sha256":digest, "bytes":bytes,
        }), true),
        Err(code) => (json!({
            "status":"blocked", "reason":code, "sha256":null, "bytes":null,
        }), false),
    };
    let png_output = export_paint_png(doc, texture_uuid);
    let (texture, png_ok) = export_evidence(png_output.as_ref().map(Vec::as_slice));
    // Existing clips do not establish whether Animation was requested.
    let animation_present = !doc.animation_assets.is_empty();
    let compiled_animation = if animation_present {
        Some(export_bedrock_animations(doc))
    } else { None };
    let (mut animation, anim_ok) = if let Some(result) = &compiled_animation {
        export_evidence(result.as_ref().map(Vec::as_slice))
    } else {
        (json!({"status":"no_saved_clips","sha256":null,"bytes":null}), true)
    };
    if animation_present {
        animation["curve_fidelity"] = json!(bedrock_animation_curve_fidelity(doc));
        // Advisory cross-domain quality evidence: neither an exporter blocker
        // nor a claim of smooth visual playback. The same validated document
        // and original saved keyframes are read without additional PNG work.
        animation["loop_seams"] =
            super::animation_export::inspect_animation_loop_seams_validated(doc)?;
    }

    let mut blockers = Vec::new();
    if !bbmodel_ok { blockers.push("BBMODEL_EXPORT_BLOCKED"); }
    if !geo_ok { blockers.push("GEOMETRY_EXPORT_BLOCKED"); }
    if !png_ok { blockers.push("TEXTURE_EXPORT_BLOCKED"); }
    if !anim_ok { blockers.push("ANIMATION_EXPORT_BLOCKED"); }
    if selected_index.is_none() { blockers.push("SELECTED_TEXTURE_NOT_FOUND"); }
    if referenced_selected == 0 { blockers.push("SELECTED_TEXTURE_NOT_BOUND"); }
    if referenced_other != 0 { blockers.push("MULTIPLE_REFERENCED_TEXTURES"); }
    if unresolved != 0 { blockers.push("UNRESOLVED_FACE_TEXTURE_REFERENCES"); }
    if implicit != 0 || no_texture != 0 {
        blockers.push("IMPLICIT_OR_UNASSIGNED_FACE_TEXTURES");
    }
    if uv_out_of_bounds != 0 { blockers.push("UV_OUT_OF_ATLAS"); }
    if uv_zero_area != 0 { blockers.push("UV_ZERO_AREA"); }
    if uv_projection_unsupported != 0 { blockers.push("UV_PROJECTION_UNSUPPORTED"); }

    let coherent = blockers.is_empty();
    Ok(json!({
        "scope":"bedrock_single_atlas_export_handoff",
        "animation_requirement":"UNKNOWN_FROM_MODEL_SOURCE",
        "status":if coherent {"source_consistent"} else {"blocked"},
        "visual_verdict":"UNVERIFIED",
        "native_verdict":"NOT_EXECUTED",
        "selected_texture_uuid":texture_uuid,
        "faces":{
            "total":all_faces,
            "selected_texture":referenced_selected,
            "other_texture":referenced_other,
            "unresolved":unresolved,
            "unset":implicit,
            "false_reference":no_texture,
            "explicitly_absent":explicit_absent,
            "uv_out_of_bounds":uv_out_of_bounds,
            "uv_zero_area":uv_zero_area,
            "uv_projection_unsupported":uv_projection_unsupported
        },
        "total_issues":total_issues,
        "issue_offset":offset,
        "next_issue_offset":if offset + issues.len() < total_issues {
            Some(offset + issues.len())
        } else { None },
        "issues":issues,
        "bbmodel":bbmodel,
        "geometry":geometry,
        "texture":texture,
        "animation":animation,
        "blockers":blockers
    }))
}

#[cfg(test)]
mod tests;
