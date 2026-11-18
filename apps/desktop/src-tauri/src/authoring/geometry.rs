//! Bounded, read-only Bedrock Entity geometry export from the Rust document.
//! Source-authored only; native Minecraft/Blockbench behavior NOT_EXECUTED.
//! Derived from pinned Blockbench 5.2.1 bedrock.js compileCube/compileGroup.

use super::{has_per_texture_uv_rules, AuthoringDocument, Bone, Cube, OutlinerNode, MAX_MODEL_BYTES};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

type Result<T> = std::result::Result<T, String>;
fn fail(code: &str) -> String { code.to_owned() }

fn finite_xyz(properties: &Map<String, Value>, field: &str) -> Result<[f64; 3]> {
    let Some(value) = properties.get(field) else { return Ok([0.0; 3]); };
    let vector: [f64; 3] = serde_json::from_value(value.clone())
        .map_err(|_| fail("GEOMETRY_EXPORT_ROTATION_UNSUPPORTED"))?;
    if vector.iter().any(|n| !n.is_finite() || n.abs() > 100_000.0) {
        return Err(fail("GEOMETRY_EXPORT_ROTATION_UNSUPPORTED"));
    }
    Ok(vector)
}

fn optional_bool(properties: &Map<String, Value>, field: &str, default: bool) -> Result<bool> {
    match properties.get(field) {
        None => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        _ => Err(fail("GEOMETRY_EXPORT_METADATA_UNSUPPORTED")),
    }
}

fn supported_keys(properties: &Map<String, Value>, allowed: &[&str]) -> Result<()> {
    if properties.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(fail("GEOMETRY_EXPORT_METADATA_UNSUPPORTED"));
    }
    Ok(())
}

pub(super) fn valid_bone_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 &&
        name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

fn face_uv(face: &Value) -> Result<([f64; 4], u16)> {
    let rect: [f64; 4] = serde_json::from_value(
        face.get("uv").cloned().ok_or_else(|| fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"))?
    ).map_err(|_| fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"))?;
    let rotation = match face.get("rotation") {
        None => 0,
        Some(value) => match value.as_f64() {
            Some(degrees) if [0.0, 90.0, 180.0, 270.0].contains(&degrees) =>
                degrees as u16,
            _ => return Err(fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED")),
        },
    };
    Ok((rect, rotation))
}

fn compile_cube(cube: &Cube, project_box_uv: bool, bone_mirror: bool) -> Result<(Value, bool)> {
    supported_keys(&cube.extra, &[
        "rotation", "inflate", "stretch", "autouv", "box_uv",
        "mirror_uv", "visibility", "export", "color", "shade", "render_order",
    ])?;
    if !optional_bool(&cube.extra, "export", true)? ||
        !optional_bool(&cube.extra, "shade", true)? {
        return Err(fail("GEOMETRY_EXPORT_CUBE_UNSUPPORTED"));
    }
    if cube.extra.get("render_order").is_some_and(|v| v.as_str() != Some("default")) {
        return Err(fail("GEOMETRY_EXPORT_CUBE_UNSUPPORTED"));
    }
    if let Some(stretch) = cube.extra.get("stretch") {
        if serde_json::from_value::<[f64; 3]>(stretch.clone()).ok() != Some([1.0; 3]) {
            return Err(fail("GEOMETRY_EXPORT_CUBE_UNSUPPORTED"));
        }
    }
    let rotation = finite_xyz(&cube.extra, "rotation")?;
    let mirror = optional_bool(&cube.extra, "mirror_uv", false)?;
    let box_uv = optional_bool(&cube.extra, "box_uv", project_box_uv)?;
    let size: [f64; 3] = std::array::from_fn(|axis| cube.to[axis] - cube.from[axis]);
    let mut out = Map::new();
    out.insert("origin".into(), json!([-cube.to[0], cube.from[1], cube.from[2]]));
    out.insert("size".into(), json!(size));
    if let Some(inflate) = cube.extra.get("inflate").and_then(Value::as_f64) {
        if inflate != 0.0 { out.insert("inflate".into(), json!(inflate)); }
    }
    if rotation != [0.0; 3] {
        let origin = cube.origin.unwrap_or([0.0; 3]);
        out.insert("pivot".into(), json!([-origin[0], origin[1], origin[2]]));
        out.insert("rotation".into(), json!([-rotation[0], -rotation[1], rotation[2]]));
    }
    let mut used_uv_rotation = false;
    if box_uv {
        out.insert("uv".into(), json!(cube.uv_offset.unwrap_or([0.0, 0.0])));
        if mirror != bone_mirror { out.insert("mirror".into(), json!(mirror)); }
    } else {
        let mut faces = Map::new();
        for face_name in ["north", "south", "east", "west", "up", "down"] {
            let face = cube.faces.get(face_name).ok_or_else(|| fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"))?;
            let data = face.as_object().ok_or_else(|| fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"))?;
            supported_keys(data, &["uv", "texture", "rotation", "material_name", "enabled", "cullface", "tint"])?;
            if data.get("enabled").is_some_and(|v| v != &Value::Bool(true)) ||
               data.get("cullface").is_some_and(|v| v.as_str() != Some("")) ||
               data.get("tint").is_some_and(|v| v.as_i64() != Some(-1)) {
                return Err(fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"));
            }
            if face.get("texture").is_some_and(Value::is_null) { continue; }
            let (uv, degrees) = face_uv(face)?;
            let mut pos = [uv[0], uv[1]];
            let mut extent = [uv[2] - uv[0], uv[3] - uv[1]];
            // Blockbench's Bedrock compiler reverses top and bottom UVs.
            if face_name == "up" || face_name == "down" {
                pos = [uv[2], uv[3]];
                extent = [-extent[0], -extent[1]];
            }
            let mut item = Map::new();
            item.insert("uv".into(), json!(pos));
            item.insert("uv_size".into(), json!(extent));
            if degrees != 0 {
                item.insert("uv_rotation".into(), json!(degrees));
                used_uv_rotation = true;
            }
            if let Some(material) = data.get("material_name") {
                let name = material.as_str().filter(|name| !name.is_empty())
                    .ok_or_else(|| fail("GEOMETRY_EXPORT_FACE_UNSUPPORTED"))?;
                item.insert("material_instance".into(), json!(name));
            }
            faces.insert(face_name.into(), Value::Object(item));
        }
        out.insert("uv".into(), Value::Object(faces));
    }
    Ok((Value::Object(out), used_uv_rotation))
}

fn compile_bone(
    node: &super::OutlinerBone, parent: Option<&str>, doc: &AuthoringDocument,
    bone_by_uuid: &HashMap<&str, &Bone>, cube_by_uuid: &HashMap<&str, &Cube>,
    out: &mut Vec<Value>, any_rotation: &mut bool, any_binding: &mut bool,
    bone_names: &mut HashSet<String>,
) -> Result<()> {
    if !node.extra.is_empty() {
        return Err(fail("GEOMETRY_EXPORT_OUTLINER_UNSUPPORTED"));
    }
    let bone = bone_by_uuid.get(node.uuid.as_str()).copied()
        .ok_or_else(|| fail("GEOMETRY_EXPORT_BONE_NOT_FOUND"))?;
    supported_keys(&bone.extra, &[
        "rotation", "mirror_uv", "bedrock_binding", "reset", "material",
        "visibility", "export", "color", "children",
    ])?;
    if !optional_bool(&bone.extra, "export", true)? {
        return Err(fail("GEOMETRY_EXPORT_BONE_UNSUPPORTED"));
    }
    if let Some(children) = bone.extra.get("children") {
        if children.as_array().is_none_or(|v| !v.is_empty()) {
            return Err(fail("GEOMETRY_EXPORT_BONE_UNSUPPORTED"));
        }
    }
    if !valid_bone_name(&bone.name) || !bone_names.insert(bone.name.to_ascii_lowercase()) {
        return Err(fail("GEOMETRY_EXPORT_BONE_NAME_UNSUPPORTED"));
    }
    let rotation = finite_xyz(&bone.extra, "rotation")?;
    let mirror = optional_bool(&bone.extra, "mirror_uv", false)?;
    let mut item = Map::new();
    item.insert("name".into(), json!(bone.name));
    if let Some(parent) = parent { item.insert("parent".into(), json!(parent)); }
    let origin = bone.origin.unwrap_or([0.0; 3]);
    item.insert("pivot".into(), json!([-origin[0], origin[1], origin[2]]));
    if rotation != [0.0; 3] {
        item.insert("rotation".into(), json!([-rotation[0], -rotation[1], rotation[2]]));
    }
    if mirror && doc.meta.box_uv.unwrap_or(false) {
        item.insert("mirror".into(), json!(true));
    }
    if optional_bool(&bone.extra, "reset", false)? {
        item.insert("reset".into(), json!(true));
    }
    for (field, output) in [("bedrock_binding", "binding"), ("material", "material")] {
        if let Some(value) = bone.extra.get(field) {
            let text = value.as_str().filter(|v| !v.trim().is_empty())
                .ok_or_else(|| fail("GEOMETRY_EXPORT_BONE_UNSUPPORTED"))?;
            item.insert(output.into(), json!(text));
            if field == "bedrock_binding" { *any_binding = true; }
        }
    }
    let mut cubes = Vec::new();
    for child in &node.children {
        if let OutlinerNode::Cube(id) = child {
            let cube = cube_by_uuid.get(id.as_str()).copied()
                .ok_or_else(|| fail("GEOMETRY_EXPORT_CUBE_NOT_FOUND"))?;
            let (compiled, has_rotation) = compile_cube(cube, doc.meta.box_uv.unwrap_or(false), mirror)?;
            cubes.push(compiled);
            *any_rotation |= has_rotation;
        }
    }
    if !cubes.is_empty() { item.insert("cubes".into(), Value::Array(cubes)); }
    out.push(Value::Object(item));
    for child in &node.children {
        if let OutlinerNode::Bone(nested) = child {
            compile_bone(nested, Some(&bone.name), doc, bone_by_uuid, cube_by_uuid,
                out, any_rotation, any_binding, bone_names)?;
        }
    }
    Ok(())
}

// Bedrock Entity geometry visibility is described in blocks while Cube and
// Bone coordinates are saved in model pixels (16 per block). The upstream
// viewport-based calculateVisibleBox is unavailable in a headless Rust
// exporter; infer a *conservative static* envelope from the exact compiled
// Bone/Cube resource instead of silently omitting all visible_bounds fields.
// This must not be claimed as animation-pose or native viewport QA evidence.
const VISIBLE_PAD_PIXELS: f64 = 8.0;
const PIXELS_PER_BLOCK: f64 = 16.0;

fn vec3_resource(value: &Value) -> Result<[f64; 3]> {
    let vector: [f64; 3] = serde_json::from_value(value.clone())
        .map_err(|_| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?;
    if !vector.iter().all(|v| v.is_finite()) {
        return Err(fail("GEOMETRY_EXPORT_BOUNDS_INVALID"));
    }
    Ok(vector)
}

fn length3(vector: [f64; 3]) -> f64 {
    vector.iter().map(|value| value * value).sum::<f64>().sqrt()
}

fn distance3(a: [f64; 3], b: [f64; 3]) -> f64 {
    length3(std::array::from_fn(|i| a[i] - b[i]))
}


/** Conservative radius for arbitrary rigid Bone rotations about the same
 * compiled Bone/Cube pivots actually used in Bedrock Geometry export.
 * For each Cube corner, apply triangle inequality along its root-to-leaf
 * pivot chain. Bone traversal is parent-first in the canonical exporter.
 *
 * Work: O(Bones + Cubes * 8); transient memory: O(Bones). This does not
 * evaluate native poses, motion timing or scales; the resulting upper bound
 * deliberately exceeds many actual animations and includes static padding.
 */
pub(super) fn compiled_rotation_envelope_radius(bones: &[Value]) -> Result<f64> {
    #[derive(Clone, Copy)]
    struct PivotSpan {
        outer: [f64; 3],
        inner: [f64; 3],
        path_length: f64,
    }
    let mut by_name: HashMap<&str, PivotSpan> = HashMap::new();
    let mut max_radius = 0.0_f64;
    for bone in bones {
        let name = bone["name"].as_str()
            .ok_or_else(|| fail("GEOMETRY_ROTATION_ENVELOPE_INVALID"))?;
        let pivot = vec3_resource(&bone["pivot"])?;
        let path = if let Some(parent) = bone.get("parent").and_then(Value::as_str) {
            let ancestor = by_name.get(parent).copied()
                .ok_or_else(|| fail("GEOMETRY_ROTATION_ENVELOPE_PARENT_MISSING"))?;
            PivotSpan {
                outer: ancestor.outer,
                inner: pivot,
                path_length: ancestor.path_length + distance3(ancestor.inner, pivot),
            }
        } else {
            PivotSpan { outer: pivot, inner: pivot, path_length: 0.0 }
        };
        if let Some(cubes) = bone.get("cubes") {
            let cubes = cubes.as_array()
                .ok_or_else(|| fail("GEOMETRY_ROTATION_ENVELOPE_INVALID"))?;
            for cube in cubes {
                let origin = vec3_resource(&cube["origin"])?;
                let size = vec3_resource(&cube["size"])?;
                let inflate = cube.get("inflate").and_then(Value::as_f64)
                    .unwrap_or(0.0).abs();
                let cube_path = if let Some(pivot) = cube.get("pivot") {
                    let cube_pivot = vec3_resource(pivot)?;
                    PivotSpan {
                        outer: path.outer,
                        inner: cube_pivot,
                        path_length: path.path_length + distance3(path.inner, cube_pivot),
                    }
                } else { path };
                let base = length3(cube_path.outer) + cube_path.path_length;
                for mask in 0_u8..8 {
                    let point: [f64; 3] = std::array::from_fn(|axis| {
                        origin[axis] + if (mask & (1_u8 << axis)) == 0 {
                            -inflate
                        } else {
                            size[axis] + inflate
                        }
                    });
                    let radius = base + distance3(cube_path.inner, point);
                    if !radius.is_finite() {
                        return Err(fail("GEOMETRY_ROTATION_ENVELOPE_OVERFLOW"));
                    }
                    max_radius = max_radius.max(radius);
                }
            }
        }
        by_name.insert(name, path);
    }
    let padded = max_radius + VISIBLE_PAD_PIXELS;
    if !padded.is_finite() {
        return Err(fail("GEOMETRY_ROTATION_ENVELOPE_OVERFLOW"));
    }
    Ok(padded)
}

/// Use the same generated Cube origin/size/inflate and Bone pivots that
/// actually appear in *.geo.json. An unrotated rig uses a padded static AABB.
/// For any rotated pivot chain, fall back to a conservative radial enclosure:
/// radius <= |outer pivot| + sum(adjacent pivot distance)
///                    + max(|corner - innermost pivot|).
/// This covers arbitrary Euler rotation magnitudes at each saved pivot,
/// including nested Bone rotations, without duplicating native mesh math.
/// It can be larger than Blockbench's exact world-space mesh box.
fn compiled_visible_bounds(bones: &[Value]) -> Result<Value> {
    let mut rotation_chain_by_bone: HashMap<&str, Vec<[f64; 3]>> = HashMap::new();
    let mut minimum = [f64::INFINITY; 3];
    let mut maximum = [f64::NEG_INFINITY; 3];
    let mut maximum_radius: f64 = 0.0;
    let mut any_rotation = false;
    let mut has_cube = false;
    for bone in bones {
        let name = bone["name"].as_str()
            .ok_or_else(|| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?;
        let mut chain = match bone.get("parent").and_then(Value::as_str) {
            Some(parent) => rotation_chain_by_bone.get(parent)
                .ok_or_else(|| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?.clone(),
            None => Vec::new(),
        };
        if bone.get("rotation").is_some() {
            chain.push(vec3_resource(&bone["pivot"])?);
        }
        for cube in bone.get("cubes").and_then(Value::as_array)
            .into_iter().flatten() {
            has_cube = true;
            let origin = vec3_resource(&cube["origin"])?;
            let size = vec3_resource(&cube["size"])?;
            let inflate = cube.get("inflate").and_then(Value::as_f64)
                .unwrap_or(0.0).abs();
            let mut cube_chain = chain.clone();
            if cube.get("rotation").is_some() {
                cube_chain.push(vec3_resource(&cube["pivot"])?);
            }
            if !cube_chain.is_empty() { any_rotation = true; }
            let mut prefix_distance = 0.0;
            if let Some(outer) = cube_chain.first() {
                prefix_distance = length3(*outer);
                for pivots in cube_chain.windows(2) {
                    prefix_distance += distance3(pivots[0], pivots[1]);
                }
            }
            let mut corner_radius: f64 = 0.0;
            for mask in 0_u8..8 {
                let point: [f64; 3] = std::array::from_fn(|axis| {
                    origin[axis] + if (mask & (1_u8 << axis)) == 0 {
                        -inflate
                    } else {
                        size[axis] + inflate
                    }
                });
                for axis in 0..3 {
                    minimum[axis] = minimum[axis].min(point[axis]);
                    maximum[axis] = maximum[axis].max(point[axis]);
                }
                let radial = length3(point);
                maximum_radius = maximum_radius.max(radial);
                if let Some(inner) = cube_chain.last() {
                    corner_radius = corner_radius.max(distance3(*inner, point));
                }
            }
            if !cube_chain.is_empty() {
                maximum_radius = maximum_radius.max(prefix_distance + corner_radius);
            }
        }
        rotation_chain_by_bone.insert(name, chain);
    }
    if !has_cube {
        // An empty Bone rig is a valid resource in this authored subset.
        return Ok(json!({
            "visible_bounds_width":2.0,
            "visible_bounds_height":2.0,
            "visible_bounds_offset":[0.0,0.0,0.0]
        }));
    }
    let (width, height, offset_y) = if any_rotation {
        // A radial bound is conservative for rotations about arbitrary saved
        // pivots. It intentionally does not promise animation-pose coverage.
        let diameter = ((maximum_radius + VISIBLE_PAD_PIXELS) * 2.0
            / PIXELS_PER_BLOCK).ceil().max(2.0);
        (diameter, diameter, 0.0)
    } else {
        let horizontal_radius = [minimum[0].abs(), maximum[0].abs(),
            minimum[2].abs(), maximum[2].abs()]
            .into_iter().fold(0.0_f64, f64::max);
        let width = ((horizontal_radius + VISIBLE_PAD_PIXELS) * 2.0
            / PIXELS_PER_BLOCK).ceil().max(2.0);
        let low = ((minimum[1] - VISIBLE_PAD_PIXELS)
            / PIXELS_PER_BLOCK).floor();
        let high = ((maximum[1] + VISIBLE_PAD_PIXELS)
            / PIXELS_PER_BLOCK).ceil();
        let height = (high - low).max(2.0);
        (width, height, (high + low) * 0.5)
    };
    if !width.is_finite() || !height.is_finite() || !offset_y.is_finite() {
        return Err(fail("GEOMETRY_EXPORT_BOUNDS_INVALID"));
    }
    Ok(json!({
        "visible_bounds_width":width,
        "visible_bounds_height":height,
        "visible_bounds_offset":[0.0,offset_y,0.0]
    }))
}

/// Blockbench saves Project.visible_box as [width, height, offsetY] in a
/// .bbmodel. A human/agent can deliberately enlarge it for animation poses.
/// Keep the authored value separate from the automatic static mesh envelope.
/// This editor admits a finite positive range, without silent clamping.
pub(super) fn valid_visible_box(value: [f64; 3]) -> bool {
    value[0].is_finite() && value[0] > 0.0 && value[0] <= 10_000.0 &&
    value[1].is_finite() && value[1] > 0.0 && value[1] <= 10_000.0 &&
    value[2].is_finite() && value[2].abs() <= 10_000.0
}

fn saved_visible_box(doc: &AuthoringDocument) -> Result<Option<[f64; 3]>> {
    let Some(value) = doc.extensions.get("visible_box") else { return Ok(None); };
    let vector: [f64; 3] = serde_json::from_value(value.clone())
        .map_err(|_| fail("GEOMETRY_EXPORT_VISIBLE_BOX_INVALID"))?;
    if !valid_visible_box(vector) {
        return Err(fail("GEOMETRY_EXPORT_VISIBLE_BOX_INVALID"));
    }
    Ok(Some(vector))
}

/// Native Blockbench calculates visible bounds as the union of its saved
/// visible_box floor and current Geometry. Preserve that union semantics:
/// never shrink static bounds, and do not erase a deliberate offset envelope.
fn merge_visible_box(static_bounds: Value, saved: Option<[f64; 3]>) -> Result<Value> {
    let Some([requested_width, requested_height, requested_y]) = saved else {
        return Ok(static_bounds);
    };
    let width = static_bounds["visible_bounds_width"].as_f64()
        .ok_or_else(|| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?;
    let height = static_bounds["visible_bounds_height"].as_f64()
        .ok_or_else(|| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?;
    let center_y = static_bounds["visible_bounds_offset"][1].as_f64()
        .ok_or_else(|| fail("GEOMETRY_EXPORT_BOUNDS_INVALID"))?;
    let low = (center_y - height * 0.5)
        .min(requested_y - requested_height * 0.5);
    let high = (center_y + height * 0.5)
        .max(requested_y + requested_height * 0.5);
    let combined_height = high - low;
    let combined_y = (high + low) * 0.5;
    if !combined_height.is_finite() || !combined_y.is_finite() {
        return Err(fail("GEOMETRY_EXPORT_BOUNDS_INVALID"));
    }
    Ok(json!({
        "visible_bounds_width":width.max(requested_width),
        "visible_bounds_height":combined_height,
        "visible_bounds_offset":[0.0, combined_y, 0.0],
    }))
}

/// Export a separate Bedrock geometry file without touching the editable
/// .bbmodel document, texture assets, animation tracks, revision or Undo stack.
// Share the exact compiled static envelope with read-only source diagnostics.
/// The ordinary exported Geometry file remains byte-identical; this helper
/// adds no persistent state or second renderer.
pub(super) fn export_bedrock_geometry_with_static_bounds(
    doc: &AuthoringDocument,
) -> Result<(Vec<u8>, Value)> {
    doc.validate()?;
    if has_per_texture_uv_rules(doc) {
        return Err(fail("GEOMETRY_EXPORT_UV_RULESET_UNSUPPORTED"));
    }
    let identifier = doc.extensions.get("model_identifier").and_then(Value::as_str)
        .filter(|id| valid_bone_name(id))
        .ok_or_else(|| fail("GEOMETRY_EXPORT_IDENTIFIER_INVALID"))?;
    // The validated Outliner already identifies each Bone/Cube uniquely.
    // Index only for this export; iterating Outliner children still defines the
    // exact previous output order, never HashMap iteration order.
    let bone_by_uuid: HashMap<&str, &Bone> = doc.bones.iter()
        .map(|bone| (bone.uuid.as_str(), bone)).collect();
    let cube_by_uuid: HashMap<&str, &Cube> = doc.cubes.iter()
        .map(|cube| (cube.uuid.as_str(), cube)).collect();
    let mut bones = Vec::new();
    let mut any_rotation = false;
    let mut any_binding = false;
    let mut names = HashSet::new();
    for node in &doc.hierarchy {
        match node {
            OutlinerNode::Bone(group) => {
                compile_bone(group, None, doc, &bone_by_uuid, &cube_by_uuid,
                    &mut bones, &mut any_rotation, &mut any_binding, &mut names)?;
            },
            OutlinerNode::Cube(_) => return Err(fail("GEOMETRY_EXPORT_CUBE_REQUIRES_BONE")),
        }
    }
    if bones.is_empty() { return Err(fail("GEOMETRY_EXPORT_EMPTY")); }
    let version = if any_rotation { "1.21.0" }
        else if any_binding { "1.16.0" } else { "1.12.0" };
    let requested_bounds = saved_visible_box(doc)?;
    let static_bounds = compiled_visible_bounds(&bones)?;
    let bounds = merge_visible_box(static_bounds.clone(), requested_bounds)?;
    let json = json!({
        "format_version": version,
        "minecraft:geometry": [{
            "description": {
                "identifier": format!("geometry.{identifier}"),
                "texture_width": doc.resolution.width,
                "texture_height": doc.resolution.height,
                "visible_bounds_width": bounds["visible_bounds_width"],
                "visible_bounds_height": bounds["visible_bounds_height"],
                "visible_bounds_offset": bounds["visible_bounds_offset"]
            },
            "bones": bones
        }]
    });
    let mut bytes = serde_json::to_vec_pretty(&json)
        .map_err(|_| fail("GEOMETRY_EXPORT_SERIALIZE_FAILED"))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_MODEL_BYTES { return Err(fail("GEOMETRY_EXPORT_TOO_LARGE")); }
    Ok((bytes, static_bounds))
}

/// Stable standalone Geometry export consumer. The extra read-only bounds
/// returned by the internal compiler never change published resource bytes.
pub fn export_bedrock_geometry(doc: &AuthoringDocument) -> Result<Vec<u8>> {
    Ok(export_bedrock_geometry_with_static_bounds(doc)?.0)
}

// Test sources are authored for later authorized PC-local validation.
// They are not executed in CHATGPT_GITHUB.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BASIC: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");


    #[test]
    fn compiled_rotation_envelope_includes_nested_pivots_and_cube_offset() {
        let compiled = vec![
            json!({"name":"root","pivot":[0.0,0.0,0.0]}),
            json!({"name":"child","parent":"root","pivot":[16.0,0.0,0.0],
                "cubes":[{"origin":[32.0,0.0,0.0],"size":[1.0,1.0,1.0]}]}),
        ];
        let radius = compiled_rotation_envelope_radius(&compiled).unwrap();
        // Root-to-child pivot (16) + Cube-corner offset (~17) + 8 pad.
        assert!(radius > 40.0 && radius < 42.0);
        let mut invalid = compiled.clone();
        invalid[1]["parent"] = json!("missing");
        assert_eq!(compiled_rotation_envelope_radius(&invalid).unwrap_err(),
            "GEOMETRY_ROTATION_ENVELOPE_PARENT_MISSING");
        invalid[1]["parent"] = json!("root");
        invalid[1]["cubes"][0]["origin"] = json!([null,0.0,0.0]);
        assert_eq!(compiled_rotation_envelope_radius(&invalid).unwrap_err(),
            "GEOMETRY_EXPORT_BOUNDS_INVALID");
    }

    #[test]
    fn bedrock_geometry_exports_bone_hierarchy_coordinates_and_face_uv() {
        let doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let unchanged = doc.clone();
        let bytes = export_bedrock_geometry(&doc).unwrap();
        let geometry: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(geometry["format_version"], json!("1.12.0"));
        assert_eq!(geometry["minecraft:geometry"][0]["description"]["identifier"],
            json!("geometry.rust_synthetic"));
        let bones = geometry["minecraft:geometry"][0]["bones"].as_array().unwrap();
        assert_eq!(bones.len(), 1);
        assert_eq!(bones[0]["name"], json!("root_bone"));
        assert_eq!(bones[0]["pivot"], json!([0.0, 0.0, 0.0]));
        assert_eq!(bones[0]["cubes"][0]["origin"], json!([-4.0, 0.0, 0.0]));
        assert_eq!(bones[0]["cubes"][0]["size"], json!([4.0, 4.0, 4.0]));
        assert_eq!(bones[0]["cubes"][0]["uv"]["north"],
            json!({"uv":[0.0, 0.0], "uv_size":[4.0, 4.0]}));
        assert_eq!(bones[0]["cubes"][0]["uv"]["up"],
            json!({"uv":[4.0, 4.0], "uv_size":[-4.0, -4.0]}));
        assert_eq!(doc, unchanged);
        assert_eq!(AuthoringDocument::import_bbmodel(&doc.export_bbmodel().unwrap()).unwrap(), doc);
    }

    #[test]
    fn box_uv_and_rotation_export_follow_pinned_blockbench_conversions() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        doc.meta.box_uv = Some(true);
        doc.cubes[0].uv_offset = Some([2.0, 3.0]);
        doc.cubes[0].origin = Some([1.0, 2.0, 3.0]);
        doc.cubes[0].extra.insert("rotation".into(), json!([15.0, -30.0, 45.0]));
        doc.bones[0].extra.insert("rotation".into(), json!([10.0, 20.0, 30.0]));
        let original = doc.clone();
        let geo: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let bone = &geo["minecraft:geometry"][0]["bones"][0];
        assert_eq!(bone["rotation"], json!([-10.0, -20.0, 30.0]));
        let cube = &bone["cubes"][0];
        assert_eq!(cube["uv"], json!([2.0, 3.0]));
        assert_eq!(cube["pivot"], json!([-1.0, 2.0, 3.0]));
        assert_eq!(cube["rotation"], json!([-15.0, 30.0, 45.0]));
        assert_eq!(doc, original);
    }

    #[test]
    fn face_uv_rotation_selects_v121_and_bone_binding_selects_v116() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        doc.bones[0].extra.insert("bedrock_binding".into(), json!("q.bound"));
        let binding: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        assert_eq!(binding["format_version"], json!("1.16.0"));
        assert_eq!(binding["minecraft:geometry"][0]["bones"][0]["binding"], json!("q.bound"));
        doc.cubes[0].faces.get_mut("north").unwrap()["rotation"] = json!(90);
        let rotated: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        assert_eq!(rotated["format_version"], json!("1.21.0"));
        assert_eq!(rotated["minecraft:geometry"][0]["bones"][0]["cubes"][0]["uv"]["north"]["uv_rotation"], json!(90));
        assert_eq!(rotated["minecraft:geometry"][0]["bones"][0]["cubes"][0]["uv"]["north"]["uv"], json!([0.0, 0.0]));
    }

    #[test]
    fn nested_bones_keep_parent_names_and_null_faces_stay_omitted() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let child_id = "00000000-0000-4000-8000-000000000987";
        doc.bones.push(Bone {
            uuid: child_id.into(), name: "child_bone".into(),
            origin: Some([1.0, 2.0, 3.0]), extra: Map::new(),
        });
        let root_id = doc.bones[0].uuid.clone();
        let cube_id = doc.cubes[0].uuid.clone();
        doc.hierarchy = vec![OutlinerNode::Bone(super::super::OutlinerBone {
            uuid: root_id, is_open: Some(true), extra: Map::new(),
            children: vec![OutlinerNode::Bone(super::super::OutlinerBone {
                uuid: child_id.into(), is_open: Some(true), extra: Map::new(),
                children: vec![OutlinerNode::Cube(cube_id)],
            })],
        })].into();
        doc.cubes[0].faces.get_mut("south").unwrap()["texture"] = Value::Null;
        let original = doc.clone();
        let geo: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let bones = geo["minecraft:geometry"][0]["bones"].as_array().unwrap();
        assert_eq!(bones.len(), 2);
        assert_eq!(bones[1]["name"], json!("child_bone"));
        assert_eq!(bones[1]["parent"], json!("root_bone"));
        assert_eq!(bones[1]["pivot"], json!([-1.0, 2.0, 3.0]));
        assert_eq!(bones[1]["cubes"][0]["uv"].get("south"), None);
        assert_eq!(doc, original);
        doc.bones[1].name = "ROOT_BONE".into();
        assert_eq!(export_bedrock_geometry(&doc).unwrap_err(),
            "GEOMETRY_EXPORT_BONE_NAME_UNSUPPORTED");
    }

    #[test]
    fn geometry_export_refuses_unrepresentable_edits_without_mutating_bbmodel() {
        let source = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let mut unsupported = source.clone();
        unsupported.cubes[0].extra.insert("stretch".into(), json!([2.0, 1.0, 1.0]));
        assert_eq!(export_bedrock_geometry(&unsupported).unwrap_err(),
            "GEOMETRY_EXPORT_CUBE_UNSUPPORTED");
        unsupported = source.clone();
        unsupported.cubes[0].extra.insert("vendor_mesh".into(), json!({"retain":true}));
        assert_eq!(export_bedrock_geometry(&unsupported).unwrap_err(),
            "GEOMETRY_EXPORT_METADATA_UNSUPPORTED");
        unsupported = source.clone();
        unsupported.cubes[0].faces.get_mut("east").unwrap()["rotation"] = json!(45);
        assert_eq!(export_bedrock_geometry(&unsupported).unwrap_err(),
            "GEOMETRY_EXPORT_FACE_UNSUPPORTED");
        unsupported = source.clone();
        unsupported.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        assert_eq!(export_bedrock_geometry(&unsupported).unwrap_err(),
            "GEOMETRY_EXPORT_UV_RULESET_UNSUPPORTED");
        unsupported = source.clone();
        unsupported.hierarchy = vec![OutlinerNode::Cube(source.cubes[0].uuid.clone()),
            OutlinerNode::Bone(super::super::OutlinerBone {
                uuid: source.bones[0].uuid.clone(),
                is_open: Some(true), children: Vec::new(), extra: Map::new(),
            })].into();
        assert_eq!(export_bedrock_geometry(&unsupported).unwrap_err(),
            "GEOMETRY_EXPORT_CUBE_REQUIRES_BONE");
        assert_eq!(source, AuthoringDocument::import_bbmodel(BASIC).unwrap());
    }

    // Authored source regression only: scale the hierarchy without relying
    // on HashMap iteration order for parent/cube output order.
    #[test]
    fn indexed_many_cube_bone_export_keeps_hierarchy_order_and_serialized_bytes() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let original_cube = doc.cubes[0].clone();
        let root_uuid = doc.bones[0].uuid.clone();
        let mut children = vec![OutlinerNode::Cube(original_cube.uuid.clone())];
        for group_index in 0..8 {
            let bone_uuid = format!("00000000-0000-4000-8000-{:012}", 1000 + group_index);
            let mut direct_cubes = Vec::new();
            for cube_index in 0..16 {
                let id = format!("00000000-0000-4000-8000-{:012}",
                    2000 + group_index * 16 + cube_index);
                let mut cube = original_cube.clone();
                cube.uuid = id.clone();
                let from = [group_index as f64 * 5.0, 0.0, cube_index as f64 * 4.0];
                cube.from = from;
                cube.to = [from[0] + 4.0, 4.0, from[2] + 4.0];
                doc.cubes.push(cube);
                direct_cubes.push(OutlinerNode::Cube(id));
            }
            doc.bones.push(Bone {
                uuid: bone_uuid.clone(), name: format!("limb_{group_index}"),
                origin: Some([0.0, group_index as f64, 0.0]), extra: Map::new(),
            });
            children.push(OutlinerNode::Bone(super::super::OutlinerBone {
                uuid: bone_uuid, is_open: Some(true), extra: Map::new(),
                children: direct_cubes,
            }));
        }
        doc.hierarchy = vec![OutlinerNode::Bone(super::super::OutlinerBone {
            uuid: root_uuid, is_open: Some(true), extra: Map::new(), children,
        })].into();
        let unchanged = doc.clone();
        let bytes = export_bedrock_geometry(&doc).unwrap();
        assert_eq!(bytes, export_bedrock_geometry(&doc).unwrap());
        let resource: Value = serde_json::from_slice(&bytes).unwrap();
        let bones = resource["minecraft:geometry"][0]["bones"].as_array().unwrap();
        assert_eq!(bones.len(), 9);
        assert_eq!(bones[0]["name"], "root_bone");
        assert_eq!(bones[0]["cubes"].as_array().unwrap().len(), 1);
        for group_index in 0..8 {
            let bone = &bones[group_index + 1];
            assert_eq!(bone["name"], json!(format!("limb_{group_index}")));
            assert_eq!(bone["parent"], "root_bone");
            assert_eq!(bone["cubes"].as_array().unwrap().len(), 16);
        }
        assert_eq!(bones[8]["cubes"][15]["origin"], json!([-39.0, 0.0, 60.0]));
        assert_eq!(doc, unchanged);
        assert_eq!(AuthoringDocument::import_bbmodel(
            &doc.export_bbmodel().unwrap()).unwrap(), doc);
        let mut duplicate_name = doc.clone();
        duplicate_name.bones[8].name = "ROOT_BONE".into();
        assert_eq!(export_bedrock_geometry(&duplicate_name).unwrap_err(),
            "GEOMETRY_EXPORT_BONE_NAME_UNSUPPORTED");
        assert_eq!(doc, unchanged);
    }

    // SOURCE_AUTHORED_NOT_RUN. The visibility volume is headless and
    // conservative; these checks do not claim live Three.js mesh parity.
    #[test]
    fn static_visible_bounds_are_exported_in_model_blocks_without_source_edits() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let original = doc.clone();
        let output: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let description = &output["minecraft:geometry"][0]["description"];
        assert_eq!(description["visible_bounds_width"], json!(2.0));
        assert_eq!(description["visible_bounds_height"], json!(2.0));
        assert_eq!(description["visible_bounds_offset"], json!([0.0,0.0,0.0]));
        assert_eq!(doc, original);
        doc.cubes[0].from = [16.0,32.0,0.0];
        doc.cubes[0].to = [20.0,36.0,4.0];
        let moved = doc.clone();
        let derived: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let bounds = &derived["minecraft:geometry"][0]["description"];
        assert_eq!(bounds["visible_bounds_width"], json!(4.0));
        assert_eq!(bounds["visible_bounds_height"], json!(2.0));
        assert_eq!(bounds["visible_bounds_offset"], json!([0.0,2.0,0.0]));
        assert_eq!(doc, moved);
        assert_eq!(AuthoringDocument::import_bbmodel(&doc.export_bbmodel().unwrap()).unwrap(),doc);
    }

    #[test]
    fn rotated_cube_and_parent_bone_use_conservative_pivot_enclosure() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        doc.bones[0].origin = Some([32.0,0.0,0.0]);
        doc.bones[0].extra.insert("rotation".into(),json!([0.0,90.0,0.0]));
        doc.cubes[0].origin = Some([64.0,0.0,0.0]);
        doc.cubes[0].extra.insert("rotation".into(),json!([0.0,90.0,0.0]));
        let original = doc.clone();
        let output: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let info = &output["minecraft:geometry"][0]["description"];
        let width = info["visible_bounds_width"].as_f64().unwrap();
        let height = info["visible_bounds_height"].as_f64().unwrap();
        // A nested pivot chain may swing geometry far from its unrotated
        // Cube AABB; the derived bounds must not shrink to that AABB.
        assert!(width >= 16.0);
        assert_eq!(height,width);
        assert_eq!(info["visible_bounds_offset"],json!([0.0,0.0,0.0]));
        assert_eq!(doc,original);
    }

    #[test]
    fn empty_bone_rig_still_emits_finite_visibility_description() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        doc.cubes.clear();
        match &mut doc.hierarchy[0] {
            OutlinerNode::Bone(root) => root.children.clear(),
            _ => panic!("synthetic fixture root must be a Bone"),
        };
        let source = doc.clone();
        let output: Value = serde_json::from_slice(&export_bedrock_geometry(&doc).unwrap()).unwrap();
        let description = &output["minecraft:geometry"][0]["description"];
        assert_eq!(description["visible_bounds_width"],json!(2.0));
        assert_eq!(description["visible_bounds_height"],json!(2.0));
        assert_eq!(description["visible_bounds_offset"],json!([0.0,0.0,0.0]));
        assert_eq!(doc,source);
    }

    #[test]
    fn paired_geometry_and_animation_keep_exact_rig_bone_name_and_axes() {
        const CLIP: &str = "00000000-0000-4000-8000-000000009351";
        const FRAME: &str = "00000000-0000-4000-8000-000000009352";
        let mut session = super::super::EditorSession::open(BASIC).unwrap();
        let bone_uuid=session.document().bones[0].uuid.clone();
        session.apply(0,&[
            super::super::EditOperation::CreateAnimation {
                uuid:CLIP.into(),name:"animation.visibility".into(),length:1.0,
            },
            super::super::EditOperation::AddBoneTransformKeyframe {
                animation_uuid:CLIP.into(),
                bone_uuid,
                keyframe_uuid:FRAME.into(),
                channel:"position".into(),time:0.5,value:[2.0,1.0,0.0],
            },
        ]).unwrap();
        let saved=session.export().unwrap();
        let geometry:Value=serde_json::from_slice(
            &export_bedrock_geometry(session.document()).unwrap()).unwrap();
        let animation:Value=serde_json::from_slice(
            &super::super::export_bedrock_animations(session.document()).unwrap()).unwrap();
        let bone=geometry["minecraft:geometry"][0]["bones"][0]["name"].as_str().unwrap();
        assert_eq!(animation["animations"]["animation.visibility"]["bones"][bone]["position"]["0.5"],
            json!([-2.0,1.0,0.0]));
        assert_eq!(session.export().unwrap(),saved);
        assert_eq!(super::super::EditorSession::open(&saved).unwrap().document(),session.document());
    }

    // SOURCE_AUTHORED_NOT_RUN: Blockbench Project.visible_box is an explicit
    // floor for the dynamic animation envelope, not a replacement for
    // generated static Geometry dimensions.
    #[test]
    fn saved_visible_box_unions_exact_width_height_and_offset() {
        let mut doc = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        let first: Value = serde_json::from_slice(
            &export_bedrock_geometry(&doc).unwrap()).unwrap();
        let baseline = &first["minecraft:geometry"][0]["description"];
        assert_eq!(baseline["visible_bounds_width"],json!(2.0));
        assert_eq!(baseline["visible_bounds_height"],json!(2.0));
        assert_eq!(baseline["visible_bounds_offset"],json!([0.0,0.0,0.0]));

        doc.extensions.insert("visible_box".into(),json!([4.0,6.0,2.0]));
        let before = doc.clone();
        let derived: Value = serde_json::from_slice(
            &export_bedrock_geometry(&doc).unwrap()).unwrap();
        let bounds = &derived["minecraft:geometry"][0]["description"];
        assert_eq!(bounds["visible_bounds_width"],json!(4.0));
        assert_eq!(bounds["visible_bounds_height"],json!(6.0));
        assert_eq!(bounds["visible_bounds_offset"],json!([0.0,2.0,0.0]));
        assert_eq!(doc, before);
        assert_eq!(AuthoringDocument::import_bbmodel(
            &doc.export_bbmodel().unwrap()).unwrap(),doc);

        doc.extensions.insert("visible_box".into(),json!([0.25,0.5,0.0]));
        let smaller: Value = serde_json::from_slice(
            &export_bedrock_geometry(&doc).unwrap()).unwrap();
        assert_eq!(&smaller["minecraft:geometry"][0]["description"],baseline);

        doc.extensions.insert("visible_box".into(),json!([2.0,2.0,8.0]));
        let offset: Value = serde_json::from_slice(
            &export_bedrock_geometry(&doc).unwrap()).unwrap();
        let bounds = &offset["minecraft:geometry"][0]["description"];
        assert_eq!(bounds["visible_bounds_width"],json!(2.0));
        assert_eq!(bounds["visible_bounds_height"],json!(10.0));
        assert_eq!(bounds["visible_bounds_offset"],json!([0.0,4.0,0.0]));
    }

    // The default static envelope cannot cover arbitrary animation offsets.
    // A saved visible_box supplies an explicit user-chosen dynamic minimum,
    // without requiring our headless source exporter to guess animation pose
    // reachability or alter the underlying animation keyframes.
    #[test]
    fn animation_translation_can_keep_a_separately_authored_visible_envelope() {
        const CLIP: &str = "00000000-0000-4000-8000-000000009361";
        const FRAME: &str = "00000000-0000-4000-8000-000000009362";
        let mut session = super::super::EditorSession::open(BASIC).unwrap();
        let bone_uuid = session.document().bones[0].uuid.clone();
        session.apply(0, &[
            super::super::EditOperation::CreateAnimation {
                uuid:CLIP.into(), name:"animation.large_swing".into(), length:1.0,
            },
            super::super::EditOperation::AddBoneTransformKeyframe {
                animation_uuid:CLIP.into(), bone_uuid,
                keyframe_uuid:FRAME.into(), channel:"position".into(),
                time:0.5, value:[64.0,0.0,0.0],
            },
        ]).unwrap();
        let original = session.document().clone();
        let original_geo: Value = serde_json::from_slice(
            &export_bedrock_geometry(session.document()).unwrap()).unwrap();
        assert_eq!(original_geo["minecraft:geometry"][0]["description"]
            ["visible_bounds_width"],json!(2.0));
        session.apply(1, &[super::super::EditOperation::SetVisibleBox {
            bounds:[12.0,4.0,0.0],
        }]).unwrap();
        let expanded: Value = serde_json::from_slice(
            &export_bedrock_geometry(session.document()).unwrap()).unwrap();
        let bounds = &expanded["minecraft:geometry"][0]["description"];
        assert_eq!(bounds["visible_bounds_width"],json!(12.0));
        assert_eq!(bounds["visible_bounds_height"],json!(4.0));
        assert_eq!(bounds["visible_bounds_offset"],json!([0.0,0.0,0.0]));
        assert_eq!(session.document().animation_assets,original.animation_assets);
        assert_eq!(session.document().cubes,original.cubes);
        let saved = session.export().unwrap();
        assert_eq!(super::super::EditorSession::open(&saved).unwrap()
            .document(),session.document());
    }

    #[test]
    fn malformed_saved_visible_box_is_preserved_in_bbmodel_but_refused_by_geometry_export() {
        let baseline = AuthoringDocument::import_bbmodel(BASIC).unwrap();
        for value in [
            json!([0.0,2.0,0.0]),json!([2.0,-1.0,0.0]),
            json!([1.0,2.0]),json!("untrusted"),
            json!([1.0,2.0,10001.0]),
        ] {
            let mut doc = baseline.clone();
            doc.extensions.insert("visible_box".into(),value.clone());
            // A pre-existing malformed project property must not be silently
            // normalized or destroyed by the editable .bbmodel codec.
            let encoded = doc.export_bbmodel().unwrap();
            let reopened = AuthoringDocument::import_bbmodel(&encoded).unwrap();
            assert_eq!(reopened.extensions["visible_box"],value);
            assert_eq!(export_bedrock_geometry(&reopened).unwrap_err(),
                "GEOMETRY_EXPORT_VISIBLE_BOX_INVALID");
        }
        assert_eq!(export_bedrock_geometry(&baseline).is_ok(),true);
    }

    #[test]
    fn authoring_visible_box_is_revision_guarded_and_undoable_without_asset_edits() {
        let mut session = super::super::EditorSession::open(BASIC).unwrap();
        let before = session.document().clone();
        session.apply(0,&[super::super::EditOperation::SetVisibleBox {
            bounds:[6.0,6.0,1.0],
        }]).unwrap();
        let saved = session.document().clone();
        assert_eq!(saved.extensions["visible_box"],json!([6.0,6.0,1.0]));
        assert_eq!(saved.cubes,before.cubes);
        assert_eq!(saved.bones,before.bones);
        assert_eq!(saved.texture_assets,before.texture_assets);
        assert_eq!(saved.animation_assets,before.animation_assets);
        let output:Value = serde_json::from_slice(
            &export_bedrock_geometry(session.document()).unwrap()).unwrap();
        let bounds=&output["minecraft:geometry"][0]["description"];
        assert_eq!(bounds["visible_bounds_width"],json!(6.0));
        assert_eq!(bounds["visible_bounds_height"],json!(6.0));
        assert_eq!(bounds["visible_bounds_offset"],json!([0.0,1.0,0.0]));
        let exported = session.export().unwrap();
        let reopened = super::super::EditorSession::open(&exported).unwrap();
        assert_eq!(reopened.document(),session.document());
        assert_eq!(session.apply(1,&[super::super::EditOperation::SetVisibleBox {
            bounds:[0.0,4.0,0.0]
        }]).unwrap_err(),"VISIBLE_BOX_INVALID");
        assert_eq!(session.document(),&saved);
        session.undo(1).unwrap();
        assert_eq!(session.document(),&before);
        session.redo(2).unwrap();
        assert_eq!(session.document(),&saved);
    }

    #[test]
    fn saved_visibility_setting_does_not_lock_empty_atlas_resolution() {
        let mut session = super::super::EditorSession::from_document(
            AuthoringDocument::new_bedrock("Empty", "empty").unwrap()).unwrap();
        session.apply(0, &[super::super::EditOperation::SetVisibleBox {
            bounds:[4.0,6.0,0.0],
        }]).unwrap();
        session.apply(1, &[super::super::EditOperation::SetEmptyAtlasResolution {
            width:64,height:64,
        }]).unwrap();
        assert_eq!(session.document().extensions["visible_box"],
            json!([4.0,6.0,0.0]));
        assert_eq!(session.document().resolution.width,64);
        assert_eq!(session.document().resolution.height,64);
        assert_eq!(super::super::EditorSession::open(
            &session.export().unwrap()).unwrap().document(),session.document());
    }

    #[test]
    fn separate_geometry_export_keeps_rust_session_revision_and_history() {
        let mut session = super::super::EditorSession::open(BASIC).unwrap();
        let old = session.document().clone();
        session.apply(0, &[super::super::EditOperation::TranslateCube {
            uuid: old.cubes[0].uuid.clone(), delta: [1.0, 0.0, 0.0],
        }]).unwrap();
        let revision = session.summary().revision;
        let saved = session.export().unwrap();
        let before_export = session.document().clone();
        let exported = export_bedrock_geometry(session.document()).unwrap();
        assert!(exported.starts_with(b"{"));
        assert_eq!(session.summary().revision, revision);
        assert_eq!(session.document(), &before_export);
        assert_eq!(session.export().unwrap(), saved);
        session.undo(revision).unwrap();
        assert_eq!(session.document(), &old);
    }
}
