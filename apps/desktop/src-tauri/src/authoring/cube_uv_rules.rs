//! Bedrock Cube and Auto/Box UV safety rules. The canonical AuthoringDocument/EditorSession and
//! transaction, history, saved file and public document contract stay in mod.rs.
//! SOURCE_ONLY; native/Cargo and regression tests remain NOT_EXECUTED.
use super::*;

// Blockbench's saved extra fields affect actual geometry and UV behavior.
// Refuse malformed values instead of preserving JSON that Blockbench would
// silently ignore on reopen.
pub(super) fn optional_rotation(extra: &Map<String, Value>) -> Result<()> {
    if let Some(rotation) = extra.get("rotation") {
        let values = rotation.as_array().ok_or_else(|| fail("ROTATION_FORMAT_INVALID"))?;
        if values.len() != 3 || !values.iter().all(|value|
            value.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT)) {
            return Err(fail("ROTATION_FORMAT_INVALID"));
        }
    }
    Ok(())
}

/// One Box UV recomputation admission used by every mutating consumer,
/// not only by the newer Reframe operation. An imported multi-file atlas or
/// float-sized net cannot safely use these integer project-atlas rectangles.
pub(super) fn check_box_uv_repack_rules(doc: &AuthoringDocument, cube: &Cube) -> Result<()> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("CUBE_BOX_UV_RULESET_UNSUPPORTED"));
    }
    let unsupported_float_uv = [
        doc.meta.extra.get("box_uv_float_size"),
        doc.extensions.get("box_uv_float_size"),
        cube.extra.get("box_uv_float_size"),
    ].into_iter().flatten().any(|flag| flag != &Value::Bool(false));
    if unsupported_float_uv {
        return Err(fail("CUBE_BOX_UV_FLOAT_UNSUPPORTED"));
    }
    Ok(())
}

/// Preserve the public refusal codes of already-authored Reframe and
/// Mirror operations, while sharing a single source-level safety predicate.
pub(super) fn box_uv_refusal_for(operation: &str, code: String) -> String {
    match (operation, code.as_str()) {
        ("reframe", "CUBE_BOX_UV_RULESET_UNSUPPORTED") =>
            fail("CUBE_REFRAME_UV_RULESET_UNSUPPORTED"),
        ("reframe", "CUBE_BOX_UV_FLOAT_UNSUPPORTED") =>
            fail("CUBE_REFRAME_BOX_UV_FLOAT_UNSUPPORTED"),
        ("mirror", "CUBE_BOX_UV_RULESET_UNSUPPORTED") =>
            fail("CUBE_MIRROR_UV_RULESET_UNSUPPORTED"),
        ("mirror", "CUBE_BOX_UV_FLOAT_UNSUPPORTED") =>
            fail("CUBE_MIRROR_UV_FLOAT_UNSUPPORTED"),
        _ => code,
    }
}

pub(super) fn cube_auto_uv(cube: &Cube) -> Result<u8> {
    match cube.extra.get("autouv") {
        None => Ok(0),
        Some(value) if value.as_f64() == Some(0.0) => Ok(0),
        Some(value) if value.as_f64() == Some(1.0) => Ok(1),
        Some(value) if value.as_f64() == Some(2.0) => Ok(2),
        _ => Err(fail("CUBE_AUTO_UV_MODE_UNSUPPORTED")),
    }
}

pub(super) fn cube_box_uv(cube: &Cube, default: bool) -> bool {
    cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(default)
}


/// Whether project-wide UV remapping/preview is unsafe for imported rules.
/// Blockbench 5.2.1 derives per-texture UV sizing from the multi-file ruleset.
/// Explicit flags are retained opaquely; malformed flags must fail closed,
/// not silently become "false" on either the CLI/Tauri edit or preview path.
pub fn has_per_texture_uv_rules(doc: &AuthoringDocument) -> bool {
    for flag in [
        doc.meta.extra.get("per_texture_uv_size"),
        doc.extensions.get("per_texture_uv_size"),
    ] {
        if flag.is_some_and(|value| value != &Value::Bool(false)) {
            return true;
        }
    }
    // A non-empty multi-file ruleset requires per-texture UV resolution.
    // Unknown types cannot be interpreted as the empty ruleset.
    doc.extensions.get("multi_file_ruleset").is_some_and(|value| match value {
        Value::String(name) => !name.is_empty(),
        _ => true,
    })
}

pub(super) fn face_uv(cube: &Cube, side: &str) -> Result<[f64; 4]> {
    cube.faces.get(side)
        .and_then(|face| face.get("uv"))
        .and_then(|uv| serde_json::from_value::<[f64; 4]>(uv.clone()).ok())
        .ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))
}

pub(super) fn write_face_uv(cube: &mut Cube, side: &str, uv: [f64; 4]) -> Result<()> {
    cube.faces.get_mut(side).and_then(Value::as_object_mut)
        .ok_or_else(|| fail("CUBE_FACE_INVALID"))?
        .insert("uv".into(), json!(uv));
    Ok(())
}

pub(super) fn clamp_uv_pair(mut a: f64, mut b: f64, limit: f64) -> (f64, f64) {
    if a.max(b) > limit {
        let overshoot = a.max(b) - limit;
        a -= overshoot;
        b -= overshoot;
    }
    if a.min(b) < 0.0 {
        let undershoot = a.min(b);
        a = (a - undershoot).clamp(0.0, limit);
        b = (b - undershoot).clamp(0.0, limit);
    }
    (a, b)
}

/** Derived from the observable Bedrock Cube Auto UV 1/2 contract in Blockbench 5.2.1. */
pub(super) fn refresh_auto_uv(
    cube: &mut Cube,
    mode: u8,
    resolution: [f64; 2],
    textures: &[Value],
    resized: Option<(usize, i8)>,
) -> Result<()> {
    if mode == 0 { return Ok(()); }
    let [width, height] = resolution;
    for side in FACE_NAMES {
        let old = face_uv(cube, side)?;
        let uv = if mode == 2 {
            // Bedrock's centered grid uses an 8-unit offset in world-relative UV.
            let f = cube.from;
            let t = cube.to;
            let coords = match side {
                "north" => [width - t[0] - 8.0, height - t[1], width - f[0] - 8.0, height - f[1]],
                "south" => [f[0] + 8.0, height - t[1], t[0] + 8.0, height - f[1]],
                "west" => [f[2] + 8.0, height - t[1], t[2] + 8.0, height - f[1]],
                "east" => [width - t[2] - 8.0, height - t[1], width - f[2] - 8.0, height - f[1]],
                "up" => [f[0] + 8.0, f[2] + 8.0, t[0] + 8.0, t[2] + 8.0],
                "down" => [f[0] + 8.0, height - t[2] - 8.0, t[0] + 8.0, height - f[2] - 8.0],
                _ => unreachable!(),
            };
            let (u0, u1) = clamp_uv_pair(coords[0], coords[2], width);
            let (v0, v1) = clamp_uv_pair(coords[1], coords[3], height);
            [u0, v0, u1, v1]
        } else {
            let (mut axes, mut directions): ([usize; 2], [i8; 2]) = match side {
                "north" | "south" => ([0, 1], [if side == "north" { 1 } else { -1 }, 1]),
                "east" | "west" => ([2, 1], [if side == "east" { 1 } else { -1 }, 1]),
                "up" => ([0, 2], [-1, -1]),
                "down" => ([0, 2], [-1, 1]),
                _ => unreachable!(),
            };
            let face = cube.faces.get(side).ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
            let rotation = match face.get("rotation") {
                None => 0.0,
                Some(value) => value.as_f64().ok_or_else(|| fail("CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED"))?,
            };
            if ![0.0, 90.0, 180.0, 270.0].contains(&rotation) {
                return Err(fail("CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED"));
            }
            let texture = match face.get("texture") {
                Some(Value::Number(index)) => index.as_u64()
                    .and_then(|index| textures.get(index as usize)),
                Some(Value::String(uuid)) => textures.iter().find(|texture|
                    texture.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())),
                _ => None,
            };
            let wrap = match texture.and_then(|item| item.get("wrap_mode")) {
                None => "limited",
                Some(value) => value.as_str().ok_or_else(|| fail("CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED"))?,
            };
            if !["limited", "repeat", "clamp"].contains(&wrap) {
                return Err(fail("CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED"));
            }
            let limited = wrap == "limited";
            let mut size = [
                ((cube.to[axes[0]] - cube.from[axes[0]]).abs() * 100.0).round() / 100.0,
                ((cube.to[axes[1]] - cube.from[axes[1]]).abs() * 100.0).round() / 100.0,
            ];
            if rotation == 90.0 || rotation == 270.0 {
                size.swap(0, 1);
                axes.swap(0, 1);
                directions.swap(0, 1);
            }
            if rotation == 180.0 || rotation == 270.0 {
                for direction in &mut directions { *direction = -*direction; }
            }
            if rotation == 270.0 { directions[1] = -directions[1]; }
            if limited {
                size[0] = size[0].clamp(0.0, width);
                size[1] = size[1].clamp(0.0, height);
            }
            let prior_size = [old[2] - old[0], old[3] - old[1]];
            for index in 0..2 {
                if prior_size[index] < 0.0 { size[index] = -size[index]; }
            }
            let mut start = [old[0], old[1]];
            if let Some((axis, direction)) = resized {
                for index in 0..2 {
                    if axis == axes[index] {
                        if direction == directions[index] {
                            start[index] += prior_size[index] - size[index];
                        } else if direction == 0 {
                            start[index] += (prior_size[index] - size[index]) / 2.0;
                        }
                    }
                }
            }
            if limited {
                start[0] = start[0].max(0.0);
                start[1] = start[1].max(0.0);
            }
            let mut end = [start[0] + size[0], start[1] + size[1]];
            if limited {
                if end[0] > width { start[0] = width - size[0]; end[0] = width; }
                if end[1] > height { start[1] = height - size[1]; end[1] = height; }
            }
            [start[0], start[1], end[0], end[1]]
        };
        write_face_uv(cube, side, uv)?;
    }
    Ok(())
}

/** Box UV offsets and derived face rectangles use the pinned Bedrock layout. */
pub(super) fn refresh_box_uv(cube: &mut Cube) -> Result<()> {
    let size = [0, 1, 2].map(|axis| (cube.to[axis] - cube.from[axis] + 0.0000001).floor());
    let [x, y, z] = size;
    let mut positions = [
        ([0.0, z], [z, y]),         // east
        ([z + x, z], [z, y]),       // west
        ([z + x, z], [-x, -z]),     // up
        ([z + 2.0 * x, 0.0], [-x, z]), // down
        ([2.0 * z + x, z], [x, y]), // south
        ([z, z], [x, y]),           // north
    ];
    if cube.extra.get("mirror_uv").and_then(Value::as_bool).unwrap_or(false) {
        for position in &mut positions {
            position.0[0] += position.1[0];
            position.1[0] = -position.1[0];
        }
        positions.swap(0, 1);
    }
    let offset = cube.uv_offset.unwrap_or([0.0, 0.0]);
    for (side, (start, extent)) in ["east", "west", "up", "down", "south", "north"].into_iter().zip(positions) {
        // Native Blockbench leaves deliberately untextured (null) face data alone.
        if cube.faces.get(side).and_then(|face| face.get("texture")).is_some_and(Value::is_null) {
            continue;
        }
        write_face_uv(cube, side, [
            start[0] + offset[0], start[1] + offset[1],
            start[0] + extent[0] + offset[0], start[1] + extent[1] + offset[1],
        ])?;
    }
    Ok(())
}

pub(super) fn apply_box_resize_offset(cube: &mut Cube, axis: usize, direction: i8, old_size: f64) {
    let new_size = cube.to[axis] - cube.from[axis];
    let adjustment = (old_size - new_size).ceil(); // Bedrock box_uv_float_size defaults to false.
    let mut offset = cube.uv_offset.unwrap_or([0.0, 0.0]);
    if axis == 2 {
        offset[0] += adjustment;
        offset[1] += adjustment;
    } else if axis == 0 && direction == 1 {
        offset[0] += adjustment;
    }
    if cube.uv_offset.is_some() || offset != [0.0, 0.0] {
        cube.uv_offset = Some(offset);
    }
}

pub(super) fn validate_cube(cube: &Cube, textures: &[Value]) -> Result<()> {
    // Focused Add/Duplicate operations still validate one Cube independently.
    let texture_uuids: HashSet<&str> = textures.iter()
        .filter_map(|texture| texture.get("uuid").and_then(Value::as_str)).collect();
    validate_cube_with_texture_refs(cube, textures.len(), &texture_uuids)
}

/// One shared membership index for the model-wide validation hot path.
/// Texture-shape, UUID-shape and duplicate-ID refusals remain in the
/// unchanged late validation gate so error precedence does not change.
pub(super) fn validate_cube_with_texture_refs(
    cube: &Cube, texture_count: usize, texture_uuids: &HashSet<&str>,
) -> Result<()> {
    if cube.kind != "cube" { return Err(fail("ELEMENT_TYPE_UNSUPPORTED")); }
    optional_rotation(&cube.extra)?;
    // These saved geometry fields alter the 3D surface and must not be
    // silently discarded or coerced by the derived preview projection.
    if let Some(inflate) = cube.extra.get("inflate") {
        if !inflate.as_f64().is_some_and(|v| v.is_finite() && v.abs() <= LIMIT) {
            return Err(fail("CUBE_INFLATE_INVALID"));
        }
    }
    if let Some(stretch) = cube.extra.get("stretch") {
        if !stretch.as_array().is_some_and(|items|
            items.len() == 3 && items.iter().all(|v|
                v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT))) {
            return Err(fail("CUBE_STRETCH_INVALID"));
        }
    }
    cube_auto_uv(cube)?;
    // Pinned Blockbench Cube.render_order is an enum with three supported
    // render priorities. Refuse malformed known semantics on import/edit.
    if let Some(order) = cube.extra.get("render_order") {
        if !matches!(order.as_str(), Some("default" | "behind" | "in_front")) {
            return Err(fail("CUBE_RENDER_ORDER_INVALID"));
        }
    }
    if cube.extra.get("box_uv").is_some_and(|v| !v.is_boolean()) {
        return Err(fail("CUBE_BOX_UV_FLAG_INVALID"));
    }
    // UV mirroring is source-backed metadata: a malformed imported value
    // must never silently become false in the Box UV net.
    if cube.extra.get("mirror_uv").is_some_and(|v| !v.is_boolean()) {
        return Err(fail("CUBE_MIRROR_UV_FLAG_INVALID"));
    }
    if !valid_uuid(&cube.uuid) || !valid_bounds(cube.from, cube.to) {
        return Err(fail("CUBE_ID_OR_BOUNDS_INVALID"));
    }
    if cube.origin.is_some_and(|v| !valid_vec3(v)) ||
       cube.uv_offset.is_some_and(|v| !valid_uv(&v)) {
        return Err(fail("CUBE_TRANSFORM_INVALID"));
    }
    if cube.faces.len() != 6 { return Err(fail("CUBE_FACES_INCOMPLETE")); }
    for face_name in FACE_NAMES {
        let face = cube.faces.get(face_name).and_then(Value::as_object)
            .ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
        let uv = face.get("uv").and_then(Value::as_array)
            .ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))?;
        if uv.len() != 4 || !uv.iter().all(|v| v.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT)) {
            return Err(fail("CUBE_FACE_UV_INVALID"));
        }
        if let Some(reference) = face.get("texture") {
            match reference {
                Value::Null | Value::Bool(false) => {},
                Value::Number(index) if index.as_u64().is_some_and(|v| v < texture_count as u64) => {},
                Value::String(uuid) if texture_uuids.contains(uuid.as_str()) => {},
                _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
            }
        }
    }
    Ok(())
}
