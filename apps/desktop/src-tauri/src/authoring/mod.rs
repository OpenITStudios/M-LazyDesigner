//! Standalone Bedrock Entity authoring engine shared by CLI and future Tauri UI.
//! SOURCE_ONLY: no Cargo, CLI, Blockbench, or native acceptance executed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

mod bbmodel;
mod geometry;
mod paint;
pub mod storage;
pub use geometry::export_bedrock_geometry;

/// The exact generated-texture gate shared by Rust edits and Tauri UI projection.
pub fn paint_texture_editable(texture: &Value) -> bool { paint::editable(texture) }

/// Metadata-only eligibility; the actual Paint adoption must fully decode PNG.
pub fn paint_texture_adoptable(texture: &Value, width: u32, height: u32) -> bool {
    paint::adoptable(texture, width, height)
}

pub const MAX_MODEL_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PLAN_BYTES: usize = 64 * 1024;
/// Maximum native/import-png PNG file size before embedded base64 encoding.
pub const MAX_IMPORT_PNG_BYTES: usize = 1024 * 1024;
/// Shared bound for native Paint creation/import and the supported 3D preview.
pub const MAX_PAINT_TEXTURES: usize = 16;
/// Maximum validated RGBA8 PNG source bytes emitted without re-encoding.
pub const MAX_EXPORT_PNG_BYTES: usize = 2 * 1024 * 1024;
const MAX_ELEMENTS: usize = 65_536;
const MAX_OPERATIONS: usize = 128;
const MAX_HISTORY: usize = 32;
const MAX_DEPTH: usize = 64;
const LIMIT: f64 = 100_000.0;
const FACE_NAMES: [&str; 6] = ["north", "east", "south", "west", "up", "down"];
type Result<T> = std::result::Result<T, String>;

fn fail(code: &str) -> String { code.to_owned() }
pub fn sha256(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub format_version: String,
    pub model_format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub box_uv: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextureResolution {
    pub width: u32,
    pub height: u32,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cube {
    pub uuid: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub from: [f64; 3],
    pub to: [f64; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uv_offset: Option<[f64; 2]>,
    pub faces: Map<String, Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bone {
    pub uuid: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<[f64; 3]>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OutlinerBone {
    pub uuid: String,
    pub children: Vec<OutlinerNode>,
    #[serde(rename = "isOpen", default, skip_serializing_if = "Option::is_none")]
    pub is_open: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OutlinerNode {
    Cube(String),
    Bone(OutlinerBone),
}

/// Authoritative typed Rust state. Opaque texture, animation and extension
/// payloads are retained without interpreting or editing those domains.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthoringDocument {
    pub meta: ProjectMeta,
    pub resolution: TextureResolution,
    pub cubes: Vec<Cube>,
    pub bones: Vec<Bone>,
    pub hierarchy: Vec<OutlinerNode>,
    pub texture_assets: Vec<Value>,
    pub animation_assets: Vec<Value>,
    pub extensions: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum EditOperation {
    AddBone { bone: Bone, parent_uuid: Option<String> },
    AddCube { cube: Cube, bone_uuid: String },
    DuplicateCube { source_uuid: String, new_uuid: String },
    ReparentNode { uuid: String, parent_uuid: Option<String> },
    RenameNode { uuid: String, name: String },
    RemoveCube { uuid: String },
    RemoveEmptyBone { uuid: String },
    CreateAnimation { uuid: String, name: String, length: f64 },
    SetAnimationLength { animation_uuid: String, length: f64 },
    AddBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        time: f64, rotation: [f64; 3],
    },
    UpdateBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        time: f64, rotation: [f64; 3],
    },
    RemoveBoneRotationKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
    },
    AddBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, time: f64, value: [f64; 3],
    },
    UpdateBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String, time: f64, value: [f64; 3],
    },
    RemoveBoneTransformKeyframe {
        animation_uuid: String, bone_uuid: String, keyframe_uuid: String,
        channel: String,
    },
    TranslateCube { uuid: String, delta: [f64; 3] },
    SetCubeBounds { uuid: String, from: [f64; 3], to: [f64; 3] },
    SetCubeRotation { uuid: String, rotation: [f64; 3] },
    ScaleCube { uuid: String, factors: [f64; 3] },
    SetBoneRotation { uuid: String, rotation: [f64; 3] },
    SetBoneOrigin { uuid: String, origin: [f64; 3] },
    SetCubeOrigin { uuid: String, origin: [f64; 3] },
    SetCubeInflate { uuid: String, inflate: f64 },
    SetNodeVisibility { uuid: String, visible: bool },
    SetFaceUv { uuid: String, face: String, uv: [f64; 4] },
    SetFaceUvRotation { uuid: String, face: String, rotation: u16 },
    SetBoxUvOffset { uuid: String, offset: [f64; 2] },
    CreatePaintTexture { uuid: String, name: String },
    EnableImportedPaintTexture { texture_index: usize },
    ImportPaintTexture { uuid: String, name: String, source: String },
    SetEmptyAtlasResolution { width: u32, height: u32 },
    AssignCubeTexture { cube_uuid: String, texture_uuid: String },
    PaintTexturePixel { texture_index: usize, x: u32, y: u32, rgba: [u8; 4] },
    PaintTextureStroke { texture_index: usize, points: Vec<[u32; 2]>, rgba: [u8; 4] },
    PaintTextureBrush { texture_index: usize, points: Vec<[u32; 2]>, radius: u8, rgba: [u8; 4], erase: bool },
    PaintTextureRectangle { texture_index: usize, from: [u32; 2], to: [u32; 2], rgba: [u8; 4], erase: bool },
    PaintTextureFill { texture_index: usize, at: [u32; 2], rgba: [u8; 4], erase: bool },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditPlan {
    pub expected_revision: u64,
    pub operations: Vec<EditOperation>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentSummary {
    pub revision: u64,
    pub format_version: String,
    pub model_format: String,
    pub cubes: usize,
    pub bones: usize,
    pub textures: usize,
    pub animations: usize,
    pub supported_slice: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct MutationReceipt {
    pub revision: u64,
    pub operation_count: usize,
    pub changed_uuids: Vec<String>,
}

fn valid_uuid(uuid: &str) -> bool {
    !uuid.is_empty() && uuid.len() <= 128 &&
        !uuid.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// User-authored element labels. Preserve imported names as stored; only new
/// rename requests must be bounded and must not contain control characters.
/// A separate Bedrock geometry exporter owns stricter bone export admission.
fn valid_node_name(name: &str) -> bool {
    !name.trim().is_empty() && name.chars().count() <= 128 &&
        !name.chars().any(char::is_control)
}
fn valid_vec3(v: [f64; 3]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}
fn valid_bounds(from: [f64; 3], to: [f64; 3]) -> bool {
    valid_vec3(from) && valid_vec3(to) &&
        (0..3).all(|axis| from[axis] <= to[axis])
}
fn valid_uv(v: &[f64]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= LIMIT)
}

// Blockbench's saved extra fields affect actual geometry and UV behavior.
// Refuse malformed values instead of preserving JSON that Blockbench would
// silently ignore on reopen.
fn optional_rotation(extra: &Map<String, Value>) -> Result<()> {
    if let Some(rotation) = extra.get("rotation") {
        let values = rotation.as_array().ok_or_else(|| fail("ROTATION_FORMAT_INVALID"))?;
        if values.len() != 3 || !values.iter().all(|value|
            value.as_f64().is_some_and(|n| n.is_finite() && n.abs() <= LIMIT)) {
            return Err(fail("ROTATION_FORMAT_INVALID"));
        }
    }
    Ok(())
}

fn cube_auto_uv(cube: &Cube) -> Result<u8> {
    match cube.extra.get("autouv") {
        None => Ok(0),
        Some(value) if value.as_f64() == Some(0.0) => Ok(0),
        Some(value) if value.as_f64() == Some(1.0) => Ok(1),
        Some(value) if value.as_f64() == Some(2.0) => Ok(2),
        _ => Err(fail("CUBE_AUTO_UV_MODE_UNSUPPORTED")),
    }
}

fn cube_box_uv(cube: &Cube, default: bool) -> bool {
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

fn face_uv(cube: &Cube, side: &str) -> Result<[f64; 4]> {
    cube.faces.get(side)
        .and_then(|face| face.get("uv"))
        .and_then(|uv| serde_json::from_value::<[f64; 4]>(uv.clone()).ok())
        .ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))
}

fn write_face_uv(cube: &mut Cube, side: &str, uv: [f64; 4]) -> Result<()> {
    cube.faces.get_mut(side).and_then(Value::as_object_mut)
        .ok_or_else(|| fail("CUBE_FACE_INVALID"))?
        .insert("uv".into(), json!(uv));
    Ok(())
}

fn clamp_uv_pair(mut a: f64, mut b: f64, limit: f64) -> (f64, f64) {
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
fn refresh_auto_uv(
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
fn refresh_box_uv(cube: &mut Cube) -> Result<()> {
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

fn apply_box_resize_offset(cube: &mut Cube, axis: usize, direction: i8, old_size: f64) {
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

fn validate_cube(cube: &Cube, textures: &[Value]) -> Result<()> {
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
                Value::Number(index) if index.as_u64().is_some_and(|v| v < textures.len() as u64) => {},
                Value::String(uuid) if textures.iter().any(|texture|
                    texture.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) => {},
                _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
            }
        }
    }
    Ok(())
}

fn validate_outliner(
    nodes: &[OutlinerNode],
    cube_ids: &HashSet<String>,
    bone_ids: &HashSet<String>,
    seen_cubes: &mut HashSet<String>,
    seen_bones: &mut HashSet<String>,
    depth: usize,
) -> Result<()> {
    if depth > MAX_DEPTH { return Err(fail("OUTLINER_TOO_DEEP")); }
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) => {
                if !cube_ids.contains(id) || !seen_cubes.insert(id.clone()) {
                    return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
                }
            }
            OutlinerNode::Bone(group) => {
                if !bone_ids.contains(&group.uuid) || !seen_bones.insert(group.uuid.clone()) {
                    return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
                }
                validate_outliner(&group.children, cube_ids, bone_ids, seen_cubes, seen_bones, depth + 1)?;
            }
        }
    }
    Ok(())
}

impl AuthoringDocument {
    pub fn new_bedrock(name: &str, identifier: &str) -> Result<Self> {
        if name.trim().is_empty() || name.chars().count() > 80 ||
           name.chars().any(char::is_control) ||
           identifier.is_empty() || identifier.len() > 128 ||
           !identifier.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
            return Err(fail("NEW_PROJECT_IDENTITY_INVALID"));
        }
        let mut extra = Map::new();
        extra.insert("name".into(), Value::String(name.into()));
        extra.insert("model_identifier".into(), Value::String(identifier.into()));
        let document = Self {
            meta: ProjectMeta {
                format_version: "5.0".into(), model_format: "bedrock".into(),
                box_uv: Some(true), extra: Map::new(),
            },
            resolution: TextureResolution { width: 128, height: 128, extra: Map::new() },
            cubes: Vec::new(), bones: Vec::new(), hierarchy: Vec::new(),
            texture_assets: Vec::new(), animation_assets: Vec::new(), extensions: extra,
        };
        document.validate()?;
        Ok(document)
    }

    pub fn import_bbmodel(bytes: &[u8]) -> Result<Self> {
        bbmodel::decode(bytes)
    }

    pub fn validate(&self) -> Result<()> {
        if self.meta.format_version != "5.0" || self.meta.model_format != "bedrock" {
            return Err(fail("BBMODEL_VERSION_OR_FORMAT_UNSUPPORTED"));
        }
        if !(1..=4096).contains(&self.resolution.width) || !(1..=4096).contains(&self.resolution.height) {
            return Err(fail("BBMODEL_RESOLUTION_INVALID"));
        }
        if self.cubes.len() > MAX_ELEMENTS || self.bones.len() > MAX_ELEMENTS ||
           self.texture_assets.len() > MAX_ELEMENTS || self.animation_assets.len() > MAX_ELEMENTS {
            return Err(fail("BBMODEL_SIZE_LIMIT"));
        }
        let mut all_ids = HashSet::new();
        let mut cube_ids = HashSet::new();
        let mut bone_ids = HashSet::new();
        for cube in &self.cubes {
            validate_cube(cube, &self.texture_assets)?;
            if !all_ids.insert(cube.uuid.clone()) { return Err(fail("DUPLICATE_UUID")); }
            cube_ids.insert(cube.uuid.clone());
        }
        for bone in &self.bones {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               bone.name.chars().count() > 128 || bone.origin.is_some_and(|v| !valid_vec3(v)) {
                return Err(fail("BONE_INVALID"));
            }
            optional_rotation(&bone.extra)?;
            if bone.extra.get("children").is_some_and(|v| v.as_array().is_none_or(|children| !children.is_empty())) {
                return Err(fail("BONE_CHILDREN_MUST_USE_OUTLINER"));
            }
            if !all_ids.insert(bone.uuid.clone()) { return Err(fail("DUPLICATE_UUID")); }
            bone_ids.insert(bone.uuid.clone());
        }
        if self.extensions.contains_key("history") || self.extensions.contains_key("history_index") {
            return Err(fail("BBMODEL_EMBEDDED_HISTORY_UNSUPPORTED"));
        }
        if self.texture_assets.iter().any(|v| !v.is_object()) ||
           self.animation_assets.iter().any(|v| !v.is_object()) {
            return Err(fail("BBMODEL_ASSET_ENTRY_INVALID"));
        }
        // Blockbench stores per-face texture references by UUID. Ambiguous
        // duplicate asset UUIDs must not choose the first matching texture.
        let mut texture_ids = HashSet::new();
        for texture in &self.texture_assets {
            if let Some(uuid) = texture.get("uuid") {
                let id = uuid.as_str().ok_or_else(|| fail("TEXTURE_UUID_INVALID"))?;
                if !valid_uuid(id) { return Err(fail("TEXTURE_UUID_INVALID")); }
                if !texture_ids.insert(id) { return Err(fail("TEXTURE_UUID_DUPLICATE")); }
            }
        }
        let mut seen_cubes = HashSet::new();
        let mut seen_bones = HashSet::new();
        validate_outliner(&self.hierarchy, &cube_ids, &bone_ids,
            &mut seen_cubes, &mut seen_bones, 0)?;
        if seen_cubes.len() != cube_ids.len() || seen_bones.len() != bone_ids.len() {
            return Err(fail("OUTLINER_INCOMPLETE"));
        }
        Ok(())
    }

    pub fn export_bbmodel(&self) -> Result<Vec<u8>> {
        bbmodel::encode(self)
    }

    pub fn summary(&self, revision: u64) -> DocumentSummary {
        DocumentSummary {
            revision, format_version: self.meta.format_version.clone(),
            model_format: self.meta.model_format.clone(), cubes: self.cubes.len(),
            bones: self.bones.len(), textures: self.texture_assets.len(),
            animations: self.animation_assets.len(), supported_slice: "bedrock_cube_geometry_v5_0",
        }
    }
}

fn append_child(nodes: &mut [OutlinerNode], parent_uuid: &str, child: &OutlinerNode) -> bool {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == parent_uuid {
                group.children.push(child.clone());
                return true;
            }
            if append_child(&mut group.children, parent_uuid, child) { return true; }
        }
    }
    false
}

// A duplicated Cube stays beside its source in the nested Outliner.
// The Rust document, rather than the Svelte Outliner, owns this ordering.
fn insert_cube_sibling_after(
    nodes: &mut Vec<OutlinerNode>, source_uuid: &str, new_uuid: &str,
) -> bool {
    for index in 0..nodes.len() {
        if matches!(nodes.get(index), Some(OutlinerNode::Cube(id)) if id == source_uuid) {
            nodes.insert(index + 1, OutlinerNode::Cube(new_uuid.to_owned()));
            return true;
        }
        if let Some(OutlinerNode::Bone(group)) = nodes.get_mut(index) {
            if insert_cube_sibling_after(&mut group.children, source_uuid, new_uuid) {
                return true;
            }
        }
    }
    false
}

// Return Some(None) for an Outliner root entry and Some(Some(id)) for
// a nested entry; None means that the requested node is not present.
fn outliner_parent_uuid(
    nodes: &[OutlinerNode], uuid: &str, parent: Option<&str>,
) -> Option<Option<String>> {
    for node in nodes {
        match node {
            OutlinerNode::Cube(id) if id == uuid => return Some(parent.map(str::to_owned)),
            OutlinerNode::Bone(group) => {
                if group.uuid == uuid { return Some(parent.map(str::to_owned)); }
                if let Some(found) = outliner_parent_uuid(
                    &group.children, uuid, Some(&group.uuid)
                ) {
                    return Some(found);
                }
            }
            _ => {}
        }
    }
    None
}

// A moved Bone retains every descendant and all Outliner-local metadata.
fn take_outliner_node(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> Option<OutlinerNode> {
    if let Some(index) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        return Some(nodes.remove(index));
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if let Some(found) = take_outliner_node(&mut group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

// In pinned Blockbench 5.2.1 an Outliner group visibility toggle writes
// the group and all descendants; the Group preview is not an inherited mask.
fn find_visibility_group<'a>(nodes: &'a [OutlinerNode], uuid: &str) -> Option<&'a OutlinerBone> {
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if group.uuid == uuid { return Some(group); }
            if let Some(found) = find_visibility_group(&group.children, uuid) {
                return Some(found);
            }
        }
    }
    None
}

fn collect_visibility_targets(
    group: &OutlinerBone, cube_ids: &mut HashSet<String>, bone_ids: &mut HashSet<String>,
) {
    bone_ids.insert(group.uuid.clone());
    for child in &group.children {
        match child {
            OutlinerNode::Cube(uuid) => { cube_ids.insert(uuid.clone()); },
            OutlinerNode::Bone(nested) => collect_visibility_targets(nested, cube_ids, bone_ids),
        }
    }
}

fn set_visibility(extra: &mut Map<String, Value>, visible: bool) {
    if visible {
        // Blockbench omits the default visible Cube field on save.
        extra.remove("visibility");
    } else {
        extra.insert("visibility".into(), Value::Bool(false));
    }
}

// Remove one Outliner entry without flattening siblings or nested Bone data.
fn remove_outliner_entry(nodes: &mut Vec<OutlinerNode>, uuid: &str) -> bool {
    if let Some(position) = nodes.iter().position(|node| match node {
        OutlinerNode::Cube(id) => id == uuid,
        OutlinerNode::Bone(group) => group.uuid == uuid,
    }) {
        nodes.remove(position);
        return true;
    }
    for node in nodes {
        if let OutlinerNode::Bone(group) = node {
            if remove_outliner_entry(&mut group.children, uuid) { return true; }
        }
    }
    false
}

// Opaque extensions can address elements by UUID. Do not leave broken
// references behind when a user explicitly removes an element.
fn value_references_uuid(value: &Value, uuid: &str) -> bool {
    match value {
        Value::String(text) => text == uuid,
        Value::Array(items) => items.iter().any(|item| value_references_uuid(item, uuid)),
        Value::Object(values) => map_references_uuid(values, uuid),
        _ => false,
    }
}

fn map_references_uuid(values: &Map<String, Value>, uuid: &str) -> bool {
    values.iter().any(|(key, value)| key == uuid || value_references_uuid(value, uuid))
}

fn outliner_extra_references_uuid(nodes: &[OutlinerNode], uuid: &str) -> bool {
    nodes.iter().any(|node| match node {
        OutlinerNode::Cube(_) => false,
        OutlinerNode::Bone(group) => {
            (group.uuid != uuid && map_references_uuid(&group.extra, uuid)) ||
                outliner_extra_references_uuid(&group.children, uuid)
        }
    })
}

fn has_external_uuid_references(doc: &AuthoringDocument, uuid: &str) -> bool {
    map_references_uuid(&doc.extensions, uuid) ||
    map_references_uuid(&doc.meta.extra, uuid) ||
    map_references_uuid(&doc.resolution.extra, uuid) ||
    doc.texture_assets.iter().chain(&doc.animation_assets)
        .any(|value| value_references_uuid(value, uuid)) ||
    doc.cubes.iter().filter(|cube| cube.uuid != uuid)
        .any(|cube| map_references_uuid(&cube.extra, uuid) ||
            cube.faces.values().any(|face| value_references_uuid(face, uuid))) ||
    doc.bones.iter().filter(|bone| bone.uuid != uuid)
        .any(|bone| map_references_uuid(&bone.extra, uuid)) ||
    outliner_extra_references_uuid(&doc.hierarchy, uuid)
}

// The editable subset intentionally excludes unknown interpolation and
// point extensions. Imported advanced frames remain unmodified.
/// Strict bounded linear transform subset from Blockbench v5.2.1
/// BoneAnimator: rotation offsets in degrees, position offsets in model
/// units, and multiplicative scales (identity [1,1,1]). This slice
/// deliberately refuses negative/excessive scales rather than pretending
/// to reproduce all mesh winding/material behavior in the 3D preview.
fn supported_transform_channel(channel: &str) -> bool {
    matches!(channel, "rotation" | "position" | "scale")
}
fn valid_animation_transform_value(channel: &str, value: [f64; 3]) -> bool {
    if !supported_transform_channel(channel) || !valid_vec3(value) {
        return false;
    }
    channel != "scale" ||
        value.iter().all(|axis| (0.0..=100.0).contains(axis))
}
fn transform_axis(value: Option<&Value>) -> Option<f64> {
    let numeric = match value? {
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Number(number) => number.as_f64(),
        _ => None,
    };
    numeric.filter(|axis| axis.is_finite())
}
fn editable_transform_frame(frame: &Value) -> bool {
    let Some(fields) = frame.as_object() else { return false; };
    if !fields.keys().all(|key| matches!(key.as_str(),
        "uuid" | "channel" | "time" | "interpolation" | "data_points")) ||
       frame.get("interpolation").and_then(Value::as_str) != Some("linear") ||
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
    valid_animation_transform_value(channel, [x, y, z])
}
fn editable_transform_clip(animation: &Value, bones: &[Bone]) -> bool {
    if !animation.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) ||
       !animation.as_object().is_some_and(|obj| obj.keys().all(|key|
        matches!(key.as_str(), "uuid" | "name" | "loop" | "length" | "animators"))) ||
       animation.get("loop").and_then(Value::as_str).unwrap_or("once") != "once" {
        return false;
    }
    let Some(length) = animation.get("length").and_then(Value::as_f64)
        .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v)) else {
        return false;
    };
    let Some(tracks) = animation.get("animators").and_then(Value::as_object) else {
        return false;
    };
    let mut all_ids = HashSet::new();
    let mut total = 0usize;
    for (bone_uuid, track) in tracks {
        let Some(bone) = bones.iter().find(|bone| bone.uuid == *bone_uuid) else {
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
    }
    true
}

fn editable_rotation_frame(frame: &Value) -> bool {
    frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
        editable_transform_frame(frame)
}

fn editable_rotation_track(track: &Value) -> bool {
    track.as_object().is_some_and(|values|
        values.keys().all(|key| matches!(key.as_str(), "name" | "type" | "keyframes"))) &&
    track.get("type").and_then(Value::as_str) == Some("bone") &&
    track.get("keyframes").and_then(Value::as_array).is_some()
}

/// Describe saved Cube geometry and six Face UV/texture links for Code Mode.
/// This is a bounded *source* diagnostic, not an evaluation of pixels, paint
/// coverage, current Blockbench material selection or visual correctness.
/// In particular Bedrock single-texture/multi-file rules can supersede stored
/// references; do not pretend a declared texture ID is the rendered material.
pub fn inspect_cube_surfaces(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    doc.validate()?;
    let cube = doc.cubes.iter().find(|cube| cube.uuid == cube_uuid)
        .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
    let per_texture_uv_rules = has_per_texture_uv_rules(doc);
    let mut faces = Vec::with_capacity(FACE_NAMES.len());
    for name in FACE_NAMES {
        let face = cube.faces.get(name).and_then(Value::as_object)
            .ok_or_else(|| fail("CUBE_FACE_INVALID"))?;
        let rect: [f64; 4] = serde_json::from_value(
            face.get("uv").cloned().ok_or_else(|| fail("CUBE_FACE_UV_INVALID"))?
        ).map_err(|_| fail("CUBE_FACE_UV_INVALID"))?;
        let (reference_kind, texture_index) = match face.get("texture") {
            None => ("unset", None),
            Some(Value::Null) => ("null", None),
            Some(Value::Bool(false)) => ("false", None),
            Some(Value::Number(number)) => {
                let index = number.as_u64()
                    .and_then(|value| usize::try_from(value).ok())
                    .ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                if index >= doc.texture_assets.len() {
                    return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED"));
                }
                ("index", Some(index))
            },
            Some(Value::String(id)) => {
                let index = doc.texture_assets.iter().position(|texture|
                    texture.get("uuid").and_then(Value::as_str) == Some(id.as_str())
                ).ok_or_else(|| fail("CUBE_FACE_TEXTURE_UNSUPPORTED"))?;
                ("uuid", Some(index))
            },
            _ => return Err(fail("CUBE_FACE_TEXTURE_UNSUPPORTED")),
        };
        let texture = texture_index.and_then(|index| doc.texture_assets.get(index));
        let source_kind = texture.map(|texture| {
            if texture.get("source").and_then(Value::as_str)
                .is_some_and(|source| source.starts_with("data:image/png;base64,")) {
                "embedded_png_declared"
            } else if texture.get("relative_path").and_then(Value::as_str).is_some() {
                "relative_path_declared"
            } else {
                "other_or_unknown"
            }
        });
        let rotation = match face.get("rotation") {
            None => Some(0_u16),
            Some(value) => value.as_f64()
                .filter(|value| [0.0, 90.0, 180.0, 270.0].contains(value))
                .map(|value| value as u16),
        };
        faces.push(json!({
            "side":name,
            "uv":rect,
            "uv_rotation":rotation,
            "uv_rotation_supported":rotation.is_some(),
            "uv_zero_span":rect[0] == rect[2] || rect[1] == rect[3],
            "reference_kind":reference_kind,
            "texture_index":texture_index,
            "texture_uuid":texture.and_then(|t| t.get("uuid")).and_then(Value::as_str),
            "source_kind":source_kind,
        }));
    }
    let size: [f64; 3] = std::array::from_fn(|axis| cube.to[axis] - cube.from[axis]);
    let result = json!({
        "scope":"saved_geometry_and_face_references",
        "cube_uuid":cube.uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "geometry":{
            "from":cube.from, "to":cube.to, "size":size,
            "origin":cube.origin,
            "rotation":cube.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok()),
            "inflate":cube.extra.get("inflate").and_then(Value::as_f64),
            "visibility_saved":cube.extra.get("visibility").and_then(Value::as_bool),
        },
        "uv":{
            "project_resolution":[doc.resolution.width, doc.resolution.height],
            "box_uv":cube_box_uv(cube, doc.meta.box_uv.unwrap_or(false)),
            "auto_uv":cube_auto_uv(cube)?,
            "per_texture_rules":per_texture_uv_rules
        },
        "faces":faces
    });
    if serde_json::to_vec(&result)
        .map_err(|_| fail("CUBE_INSPECT_SERIALIZE_FAILED"))?.len() > 16 * 1024 {
        return Err(fail("CUBE_INSPECT_TOO_LARGE"));
    }
    Ok(result)
}

/// Read-only Code Mode projection for one exact Bone rotation track.
/// Shares the existing Rust editable-frame admission instead of interpreting
/// imported Molang expressions, unknown channels or extended keyframe shapes.
/// "recognized" identifies only this bounded data representation: it is not
/// proof of native animation playback, visual fidelity or mutation permission.
pub fn inspect_rotation_track(
    doc: &AuthoringDocument,
    animation_uuid: &str,
    bone_uuid: &str,
    offset: usize,
    limit: usize,
) -> Result<Value> {
    if limit == 0 || limit > 64 || offset > MAX_ELEMENTS {
        return Err(fail("ANIMATION_INSPECT_PAGE_INVALID"));
    }
    if !doc.bones.iter().any(|bone| bone.uuid == bone_uuid) {
        return Err(fail("ANIMATION_BONE_NOT_FOUND"));
    }
    let animation = doc.animation_assets.iter()
        .find(|a| a.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
        .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
    let track = animation.get("animators").and_then(Value::as_object)
        .and_then(|items| items.get(bone_uuid))
        .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
    let Some(frames) = track.get("keyframes").and_then(Value::as_array) else {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":null, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    };
    let total = frames.len();
    let duration = animation.get("length").and_then(Value::as_f64)
        .filter(|n| n.is_finite() && (0.0..=3600.0).contains(n));
    let mut times = Vec::new();
    let mut ids = HashSet::new();
    let mut recognized = editable_rotation_track(track) &&
        duration.is_some() && total <= 4096;
    if recognized {
        for frame in frames {
            let time = frame.get("time").and_then(Value::as_f64);
            let id = frame.get("uuid").and_then(Value::as_str);
            if !editable_rotation_frame(frame) ||
               !time.is_some_and(|n| n <= duration.unwrap_or(0.0)) ||
               !id.is_some_and(|value| ids.insert(value.to_owned())) {
                recognized = false;
                break;
            }
            times.push(time.unwrap_or(0.0));
        }
        if recognized {
            times.sort_by(|a, b| a.total_cmp(b));
            recognized = !times.windows(2).any(|pair| (pair[1] - pair[0]).abs() <= 1e-6);
        }
    }
    if !recognized {
        return Ok(json!({
            "scope":"unsupported_animation_track",
            "recognized":false, "reason":"OPAQUE_OR_UNSUPPORTED_KEYFRAMES",
            "visual_verdict":"UNVERIFIED", "keyframes":[],
            "total_frames":total, "next_offset":null,
            "animation_uuid":animation_uuid, "bone_uuid":bone_uuid
        }));
    }
    let mut keyframes = Vec::new();
    let end = offset.saturating_add(limit).min(total);
    for frame in frames.iter().skip(offset).take(limit) {
        let point = &frame["data_points"][0];
        let axis = |name: &str| -> Result<f64> {
            match point.get(name) {
                Some(Value::String(value)) => value.parse::<f64>().map_err(|_| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                Some(Value::Number(value)) => value.as_f64().ok_or_else(|| fail("ANIMATION_INSPECT_AXIS_INVALID")),
                _ => Err(fail("ANIMATION_INSPECT_AXIS_INVALID")),
            }
        };
        keyframes.push(json!({
            "uuid":frame["uuid"],
            "time":frame["time"],
            "rotation":[axis("x")?, axis("y")?, axis("z")?]
        }));
    }
    Ok(json!({
        "scope":"linear_bone_rotation",
        "recognized":true, "visual_verdict":"UNVERIFIED",
        "animation_uuid":animation_uuid, "bone_uuid":bone_uuid,
        "total_frames":total, "offset":offset,
        "next_offset":if end < total { Some(end) } else { None },
        "keyframes":keyframes
    }))
}

/// Changing atlas dimensions with authored Cubes or texture/animation data
/// would require native UV remapping. Keep this setting confined to a simple
/// empty Bedrock model with no imported opaque authoring metadata.
/// Shared admission for new generated/imported Paint assets. Never infer
/// that a project with per-texture UV rules fits the one-atlas Paint editor.
fn check_paint_texture_addition(doc: &AuthoringDocument) -> Result<()> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    if doc.texture_assets.len() >= MAX_PAINT_TEXTURES {
        return Err(fail("PAINT_TEXTURE_COUNT_LIMIT"));
    }
    if !(1..=256).contains(&doc.resolution.width) ||
       !(1..=256).contains(&doc.resolution.height) {
        return Err(fail("PAINT_DIMENSIONS_UNSUPPORTED"));
    }
    Ok(())
}

/// Read-only eligibility used by the Tauri UI. Mutations recheck this gate.
pub fn can_add_paint_texture(doc: &AuthoringDocument) -> bool {
    check_paint_texture_addition(doc).is_ok()
}

/// Metadata-only eligibility; expensive image decode happens on export.
pub fn paint_texture_exportable(doc: &AuthoringDocument, index: usize) -> bool {
    if has_per_texture_uv_rules(doc) { return false; }
    doc.texture_assets.get(index).is_some_and(|texture| {
        texture.get("uuid").and_then(Value::as_str).is_some_and(valid_uuid) &&
        paint::exportable(texture, doc.resolution.width, doc.resolution.height)
    })
}

/// Read-only export of a UUID-addressed supported embedded PNG.
pub fn export_paint_png(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Vec<u8>> {
    if has_per_texture_uv_rules(doc) {
        return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
    }
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    if !paint_texture_exportable(doc, index) {
        return Err(fail("PAINT_EXPORT_TEXTURE_UNSUPPORTED"));
    }
    paint::export_png(&doc.texture_assets[index], doc.resolution.width, doc.resolution.height)
}

/// Bounded, read-only Code Mode Paint inspection for one explicit Texture UUID.
/// The same Rust PNG codec used for Paint/edit/export owns pixel decoding.
/// Unknown formats and multi-file rules remain UNVERIFIED, not silently
/// interpreted or rewritten. Alpha statistics cannot prove face coverage.
pub fn inspect_paint_alpha(doc: &AuthoringDocument, texture_uuid: &str) -> Result<Value> {
    doc.validate()?;
    let index = doc.texture_assets.iter().position(|texture|
        texture.get("uuid").and_then(Value::as_str) == Some(texture_uuid))
        .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
    let texture = &doc.texture_assets[index];
    let inspection = if has_per_texture_uv_rules(doc) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"PER_TEXTURE_UV_RULES_UNSUPPORTED",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else if !paint::exportable(texture, doc.resolution.width, doc.resolution.height) {
        json!({
            "scope":"unsupported_texture_alpha",
            "supported":false,
            "reason":"UNSUPPORTED_FORMAT_OR_METADATA",
            "visual_verdict":"UNVERIFIED",
            "face_coverage_verdict":"UNVERIFIED"
        })
    } else {
        // A purportedly supported image must survive the full decoder.
        // Malformed/corrupt RGBA8 is an explicit error, not zero coverage.
        paint::alpha_diagnostics(texture, doc.resolution.width, doc.resolution.height)?
    };
    Ok(json!({
        "kind":"texture_alpha",
        "texture_uuid":texture_uuid,
        "texture_index":index,
        "inspection":inspection
    }))
}

/// Inspect six saved *manual* Cube face UV regions against the Rust Paint
/// PNG decoder, once per unique referenced texture. This is source evidence:
/// a visible 3D face, effective Bedrock material and full texturing quality
/// still require native observation. Unknown mappings fail closed per face.
pub fn inspect_cube_uv_alpha(doc: &AuthoringDocument, cube_uuid: &str) -> Result<Value> {
    let surface = inspect_cube_surfaces(doc, cube_uuid)?;
    let uv = &surface["uv"];
    let global_reason = if uv["per_texture_rules"].as_bool() == Some(true) {
        Some("PER_TEXTURE_UV_RULES_UNSUPPORTED")
    } else if uv["box_uv"].as_bool() == Some(true) {
        Some("BOX_UV_UNSUPPORTED")
    } else if uv["auto_uv"].as_u64() != Some(0) {
        Some("AUTO_UV_UNSUPPORTED")
    } else {
        None
    };
    let faces = surface["faces"].as_array()
        .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
    let width = doc.resolution.width;
    let height = doc.resolution.height;
    // Scratch memory only, scoped to this one read, not a second scene/texture
    // cache. At most six explicitly referenced textures are decoded.
    let mut decoded: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut projected = Vec::with_capacity(FACE_NAMES.len());
    for face in faces {
        let side = face["side"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let kind = face["reference_kind"].as_str()
            .ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let index = face["texture_index"].as_u64()
            .and_then(|index| usize::try_from(index).ok());
        let mut reason = global_reason;
        if reason.is_none() && index.is_none() {
            reason = Some("NO_EXPLICIT_TEXTURE_REFERENCE");
        }
        let texture = index.and_then(|i| doc.texture_assets.get(i));
        if reason.is_none() && !texture.is_some_and(|t|
            paint::exportable(t, width, height)
        ) {
            reason = Some("UNSUPPORTED_TEXTURE_FORMAT_OR_METADATA");
        }
        let rect: [f64; 4] = serde_json::from_value(face["uv"].clone())
            .map_err(|_| fail("CUBE_INSPECT_FACES_INVALID"))?;
        let stats = if let Some(message) = reason {
            json!({"status":"unsupported","reason":message})
        } else {
            let texture_index = index.ok_or_else(|| fail("CUBE_INSPECT_FACES_INVALID"))?;
            if !decoded.iter().any(|(i, _)| *i == texture_index) {
                let png = paint::decode_for_uv_inspection(
                    &doc.texture_assets[texture_index], width, height
                )?;
                decoded.push((texture_index, png));
            }
            let png = decoded.iter().find(|(i, _)| *i == texture_index)
                .ok_or_else(|| fail("PAINT_UV_CACHE_INCONSISTENT"))?;
            match paint::uv_region_alpha_stats(&png.1, width, height, rect) {
                Ok(region) => json!({"status":"measured","region":region}),
                Err(code) if matches!(code.as_str(),
                    "PAINT_UV_RECT_NON_INTEGRAL" |
                    "PAINT_UV_RECT_OUT_OF_BOUNDS" |
                    "PAINT_UV_RECT_ZERO_AREA") => {
                    json!({"status":"unsupported","reason":code})
                }
                Err(code) => return Err(code),
            }
        };
        projected.push(json!({
            "side":side,
            "saved_reference_kind":kind,
            "texture_index":index,
            "texture_uuid":face["texture_uuid"],
            "uv":rect,
            "alpha":stats
        }));
    }
    let report = json!({
        "scope":"saved_manual_face_uv_alpha",
        "cube_uuid":cube_uuid,
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED",
        "face_coverage_verdict":"UNVERIFIED",
        "face_count":projected.len(),
        "faces":projected
    });
    if serde_json::to_vec(&report)
        .map_err(|_| fail("CUBE_UV_ALPHA_SERIALIZE_FAILED"))?.len() > 24 * 1024 {
        return Err(fail("CUBE_UV_ALPHA_RESULT_TOO_LARGE"));
    }
    Ok(report)
}

pub fn can_set_empty_atlas_resolution(doc: &AuthoringDocument) -> bool {
    doc.cubes.is_empty() && doc.bones.is_empty() &&
    doc.texture_assets.is_empty() && doc.animation_assets.is_empty() &&
    doc.meta.extra.is_empty() && doc.resolution.extra.is_empty() &&
    doc.extensions.keys().all(|key|
        matches!(key.as_str(), "name" | "model_identifier")) &&
    !has_per_texture_uv_rules(doc)
}

fn apply_operation(doc: &mut AuthoringDocument, op: &EditOperation) -> Result<String> {
    match op {
        EditOperation::AddBone { bone, parent_uuid } => {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               doc.cubes.iter().any(|c| c.uuid == bone.uuid) ||
               doc.bones.iter().any(|g| g.uuid == bone.uuid) {
                return Err(fail("BONE_CREATION_INVALID"));
            }
            let node = OutlinerNode::Bone(OutlinerBone {
                uuid: bone.uuid.clone(), children: Vec::new(), is_open: Some(true), extra: Map::new(),
            });
            if let Some(parent) = parent_uuid {
                if !append_child(&mut doc.hierarchy, parent, &node) {
                    return Err(fail("BONE_PARENT_NOT_FOUND"));
                }
            } else { doc.hierarchy.push(node); }
            doc.bones.push(bone.clone());
            Ok(bone.uuid.clone())
        }
        EditOperation::AddCube { cube, bone_uuid } => {
            if doc.cubes.iter().any(|c| c.uuid == cube.uuid) ||
               doc.bones.iter().any(|g| g.uuid == cube.uuid) {
                return Err(fail("CUBE_UUID_CONFLICT"));
            }
            let mut prepared = cube.clone();
            validate_cube(&prepared, &doc.texture_assets)?;
            // A newly added Box UV Cube needs derived rectangles immediately.
            if cube_box_uv(&prepared, doc.meta.box_uv.unwrap_or(false)) {
                refresh_box_uv(&mut prepared)?;
            }
            if !append_child(&mut doc.hierarchy, bone_uuid, &OutlinerNode::Cube(cube.uuid.clone())) {
                return Err(fail("CUBE_BONE_NOT_FOUND"));
            }
            doc.cubes.push(prepared);
            Ok(cube.uuid.clone())
        }

        EditOperation::DuplicateCube { source_uuid, new_uuid } => {
            if !valid_uuid(new_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *new_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *new_uuid) ||
               doc.texture_assets.iter().chain(&doc.animation_assets)
                   .any(|value| value.get("uuid").and_then(Value::as_str) == Some(new_uuid.as_str())) {
                return Err(fail("CUBE_DUPLICATE_ID_INVALID"));
            }
            if doc.cubes.len() >= MAX_ELEMENTS {
                return Err(fail("CUBE_COUNT_LIMIT"));
            }
            let source = doc.cubes.iter().find(|cube| cube.uuid == *source_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // An opaque source self-reference cannot be rewritten safely.
            // Refuse it rather than copy a stale reference to the source UUID.
            if map_references_uuid(&source.extra, source_uuid) ||
               source.faces.values().any(|face| value_references_uuid(face, source_uuid)) {
                return Err(fail("CUBE_DUPLICATE_SELF_REFERENCE_UNSUPPORTED"));
            }
            let mut duplicate = source.clone();
            duplicate.uuid = new_uuid.clone();
            validate_cube(&duplicate, &doc.texture_assets)?;
            if !insert_cube_sibling_after(&mut doc.hierarchy, source_uuid, new_uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.push(duplicate);
            Ok(new_uuid.clone())
        }
        EditOperation::ReparentNode { uuid, parent_uuid } => {
            let is_cube = doc.cubes.iter().any(|cube| cube.uuid == *uuid);
            let is_bone = doc.bones.iter().any(|bone| bone.uuid == *uuid);
            if !is_cube && !is_bone { return Err(fail("REPARENT_NODE_NOT_FOUND")); }
            if is_cube && parent_uuid.is_none() {
                // A Bedrock Cube may only be reparented to a Bone in this slice.
                return Err(fail("REPARENT_CUBE_REQUIRES_BONE"));
            }
            if let Some(target) = parent_uuid {
                if !doc.bones.iter().any(|bone| bone.uuid == *target) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
                // The destination must not lie within the source Bone subtree.
                if is_bone {
                    let source_group = find_visibility_group(&doc.hierarchy, uuid)
                        .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
                    if target == uuid ||
                        find_visibility_group(&source_group.children, target).is_some() {
                        return Err(fail("REPARENT_CYCLE"));
                    }
                }
            }
            let current_parent = outliner_parent_uuid(&doc.hierarchy, uuid, None)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if current_parent.as_deref() == parent_uuid.as_deref() { return Ok(uuid.clone()); }
            let moved = take_outliner_node(&mut doc.hierarchy, uuid)
                .ok_or_else(|| fail("REPARENT_NODE_NOT_FOUND"))?;
            if let Some(target) = parent_uuid {
                if !append_child(&mut doc.hierarchy, target, &moved) {
                    return Err(fail("REPARENT_PARENT_NOT_FOUND"));
                }
            } else {
                doc.hierarchy.push(moved);
            }
            // Blockbench's default Outliner move has adjust_position=false.
            // Keep saved local transforms/UUIDs untouched; the target Bone's
            // inherited rotation may change the resulting world-space pose.
            Ok(uuid.clone())
        }
        EditOperation::RenameNode { uuid, name } => {
            if !valid_node_name(name) { return Err(fail("NODE_NAME_INVALID")); }
            let desired = name.trim();
            if let Some(cube) = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid) {
                cube.name = Some(desired.to_owned());
                return Ok(uuid.clone());
            }
            let bone_index = doc.bones.iter().position(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("RENAME_NODE_NOT_FOUND"))?;
            let original = doc.bones[bone_index].name.clone();
            // Bedrock JSON needs unambiguous Bone names for exported rigs.
            // Existing imported names are preserved, but a newly authored
            // rename cannot introduce another case-insensitive collision.
            if doc.bones.iter().enumerate().any(|(index, bone)|
                index != bone_index && bone.name.eq_ignore_ascii_case(desired)) {
                return Err(fail("BONE_NAME_CONFLICT"));
            }
            // A Blockbench Bone animator is indexed by Bone UUID, while
            // its optional display name mirrors the Bone name. Synchronize
            // only that known field, never rewrite opaque keyframes/Molang.
            // Imported inconsistent track names refuse rather than silently
            // leave a misleading Bone->Animation relationship behind.
            for animation in &mut doc.animation_assets {
                if let Some(track) = animation.get_mut("animators")
                    .and_then(Value::as_object_mut)
                    .and_then(|animators| animators.get_mut(uuid))
                {
                    if let Some(label) = track.get("name") {
                        if label.as_str() != Some(original.as_str()) {
                            return Err(fail("BONE_ANIMATOR_NAME_UNSUPPORTED"));
                        }
                        track["name"] = json!(desired);
                    }
                }
            }
            doc.bones[bone_index].name = desired.to_owned();
            Ok(uuid.clone())
        }
        EditOperation::RemoveCube { uuid } => {
            if !doc.cubes.iter().any(|cube| cube.uuid == *uuid) {
                return Err(fail("CUBE_NOT_FOUND"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_CUBE_REFERENCE_INVALID"));
            }
            doc.cubes.retain(|cube| cube.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::RemoveEmptyBone { uuid } => {
            let group = find_visibility_group(&doc.hierarchy, uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if !group.children.is_empty() {
                return Err(fail("BONE_NOT_EMPTY"));
            }
            if has_external_uuid_references(doc, uuid) {
                return Err(fail("ELEMENT_OPAQUE_REFERENCES"));
            }
            if !remove_outliner_entry(&mut doc.hierarchy, uuid) {
                return Err(fail("OUTLINER_BONE_REFERENCE_INVALID"));
            }
            doc.bones.retain(|bone| bone.uuid != *uuid);
            Ok(uuid.clone())
        }
        EditOperation::SetNodeVisibility { uuid, visible } => {
            if let Some(cube) = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid) {
                set_visibility(&mut cube.extra, *visible);
            } else {
                let group = find_visibility_group(&doc.hierarchy, uuid)
                    .ok_or_else(|| fail("VISIBILITY_TARGET_NOT_FOUND"))?;
                let mut cube_ids = HashSet::new();
                let mut bone_ids = HashSet::new();
                collect_visibility_targets(group, &mut cube_ids, &mut bone_ids);
                for cube in &mut doc.cubes {
                    if cube_ids.contains(&cube.uuid) { set_visibility(&mut cube.extra, *visible); }
                }
                for bone in &mut doc.bones {
                    if bone_ids.contains(&bone.uuid) { set_visibility(&mut bone.extra, *visible); }
                }
            }
            Ok(uuid.clone())
        }
        EditOperation::TranslateCube { uuid, delta } => {
            if !valid_vec3(*delta) { return Err(fail("CUBE_DELTA_INVALID")); }
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if delta.iter().all(|axis| *axis == 0.0) { return Ok(uuid.clone()); }
            let auto_uv = cube_auto_uv(cube)?;
            let box_uv = cube_box_uv(cube, project_box_uv);
            if !box_uv && auto_uv != 0 && per_texture {
                return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
            }
            for axis in 0..3 {
                cube.from[axis] += delta[axis];
                cube.to[axis] += delta[axis];
            }
            let origin = cube.origin.get_or_insert([0.0, 0.0, 0.0]);
            for axis in 0..3 { origin[axis] += delta[axis]; }
            if !box_uv {
                refresh_auto_uv(cube, auto_uv, resolution, textures, None)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeBounds { uuid, from, to } => {
            if !valid_bounds(*from, *to) { return Err(fail("CUBE_BOUNDS_INVALID")); }
            let per_texture = has_per_texture_uv_rules(doc);
            let resolution = [doc.resolution.width as f64, doc.resolution.height as f64];
            let textures = &doc.texture_assets;
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            let auto_uv = cube_auto_uv(cube)?;
            let box_uv = cube_box_uv(cube, project_box_uv);
            let refusal = if box_uv { "CUBE_BOX_UV_RESIZE_UNSUPPORTED" }
                else { "CUBE_AUTO_UV_REMAP_REQUIRED" };
            // The current operation has no transform direction. For UV-sensitive
            // cubes, only a single moved edge has unambiguous native semantics.
            let mut changed: Option<(usize, i8)> = None;
            for axis in 0..3 {
                let from_changed = cube.from[axis] != from[axis];
                let to_changed = cube.to[axis] != to[axis];
                if from_changed || to_changed {
                    if (auto_uv != 0 || box_uv) &&
                        (changed.is_some() || (from_changed && to_changed)) {
                        return Err(fail(refusal));
                    }
                    changed = Some((axis, if from_changed { -1 } else { 1 }));
                }
            }
            if changed.is_none() { return Ok(uuid.clone()); }
            if auto_uv != 0 && !box_uv && per_texture {
                return Err(fail("CUBE_UV_TEXTURE_RULESET_UNSUPPORTED"));
            }
            let (axis, direction) = changed.expect("a bound changed");
            let prior_size = cube.to[axis] - cube.from[axis];
            cube.from = *from;
            cube.to = *to;
            if box_uv {
                apply_box_resize_offset(cube, axis, direction, prior_size);
                refresh_box_uv(cube)?;
            } else {
                refresh_auto_uv(cube, auto_uv, resolution, textures, Some((axis, direction)))?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("BONE_ROTATION_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            let current = bone.extra.get("rotation")
                .and_then(|value| serde_json::from_value::<[f64; 3]>(value.clone()).ok())
                .unwrap_or([0.0, 0.0, 0.0]);
            if current == *rotation { return Ok(uuid.clone()); }
            if rotation.iter().all(|value| *value == 0.0) {
                // A neutral Bone rotation is omitted by pinned Blockbench.
                bone.extra.remove("rotation");
            } else {
                bone.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::SetBoneOrigin { uuid, origin } => {
            // Rig pivot edit: never silently move child Cubes, UVs, or animation data.
            if !valid_vec3(*origin) { return Err(fail("BONE_ORIGIN_INVALID")); }
            let bone = doc.bones.iter_mut().find(|bone| bone.uuid == *uuid)
                .ok_or_else(|| fail("BONE_NOT_FOUND"))?;
            if bone.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            bone.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeOrigin { uuid, origin } => {
            // Keep the Cube's saved faces, bounds and parent Bone untouched.
            if !valid_vec3(*origin) { return Err(fail("CUBE_ORIGIN_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube.origin.unwrap_or([0.0, 0.0, 0.0]) == *origin {
                return Ok(uuid.clone());
            }
            cube.origin = Some(*origin);
            Ok(uuid.clone())
        }
        EditOperation::SetCubeInflate { uuid, inflate } => {
            if !inflate.is_finite() || inflate.abs() > LIMIT {
                return Err(fail("CUBE_INFLATE_INVALID"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            // Never commit a collapsed or inverted rendered surface.
            if (0..3).any(|axis| cube.to[axis] - cube.from[axis] + 2.0 * inflate <= 0.0) {
                return Err(fail("CUBE_INFLATE_DEGENERATE"));
            }
            if cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0) == *inflate {
                return Ok(uuid.clone());
            }
            if *inflate == 0.0 {
                cube.extra.remove("inflate");
            } else {
                cube.extra.insert("inflate".into(), json!(inflate));
            }
            Ok(uuid.clone())
        }
        EditOperation::ScaleCube { uuid, factors } => {
            // A bounded, positive per-axis extension of pinned Blockbench
            // ModelScaler.scaleElements about the selected Cube's own pivot.
            // Its original scalar may be axis-filtered; this supports the same
            // math independently on each selected axis.
            if !factors.iter().all(|f| f.is_finite() && *f > 0.0 && *f <= 4.0) {
                return Err(fail("CUBE_SCALE_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if factors.iter().all(|f| *f == 1.0) { return Ok(uuid.clone()); }
            let inflate = cube.extra.get("inflate").and_then(Value::as_f64).unwrap_or(0.0);
            let pivot = cube.origin.unwrap_or([0.0, 0.0, 0.0]);
            for axis in 0..3 {
                let from = cube.from[axis];
                let to = cube.to[axis];
                cube.from[axis] = (from - inflate - pivot[axis]) * factors[axis] +
                    inflate + pivot[axis];
                cube.to[axis] = (to + inflate - pivot[axis]) * factors[axis] -
                    inflate + pivot[axis];
            }
            // ModelScaler clears Auto UV on scale; leave manual face UV and
            // texture identity untouched, rather than falsely remapping it.
            if cube_auto_uv(cube)? != 0 {
                cube.extra.insert("autouv".into(), json!(0));
            }
            if cube_box_uv(cube, project_box_uv) {
                // Box UV extents derive from the new saved Cube dimensions.
                // Scaling does not change the atlas UV offset.
                refresh_box_uv(cube)?;
            }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeRotation { uuid, rotation } => {
            if !valid_vec3(*rotation) { return Err(fail("CUBE_ROTATION_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if rotation.iter().all(|value| *value == 0.0) {
                // Blockbench omits the neutral cube rotation when saving.
                cube.extra.remove("rotation");
            } else {
                cube.extra.insert("rotation".into(), json!(rotation));
            }
            Ok(uuid.clone())
        }
        EditOperation::CreateAnimation { uuid, name, length } => {
            if !valid_uuid(uuid) || name.trim().is_empty() || name.chars().count() > 128 ||
               name.chars().any(char::is_control) ||
               !length.is_finite() || !(0.0..=3600.0).contains(length) ||
               doc.animation_assets.len() >= MAX_ELEMENTS ||
               doc.animation_assets.iter().any(|a|
                   a.get("uuid").and_then(Value::as_str) == Some(uuid) ||
                   a.get("name").and_then(Value::as_str) == Some(name.trim())) ||
               doc.cubes.iter().any(|c| c.uuid == *uuid) ||
               doc.bones.iter().any(|b| b.uuid == *uuid) ||
               doc.texture_assets.iter().any(|t| t.get("uuid").and_then(Value::as_str) == Some(uuid)) {
                return Err(fail("ANIMATION_CREATION_INVALID"));
            }
            doc.animation_assets.push(json!({
                "uuid": uuid, "name": name.trim(),
                "loop": "once", "length": length, "animators": {}
            }));
            Ok(uuid.clone())
        }
        EditOperation::SetAnimationLength { animation_uuid, length } => {
            if !length.is_finite() || !(0.0..=3600.0).contains(length) {
                return Err(fail("ANIMATION_LENGTH_INVALID"));
            }
            let mut matching = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str)
                    == Some(animation_uuid));
            let (index, animation) = matching.next()
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            if matching.next().is_some() {
                // An imported model can contain duplicate Animation UUIDs.
                // Never choose the first target silently.
                return Err(fail("ANIMATION_ID_AMBIGUOUS"));
            }
            // All admitted numeric linear transform channels are kept
            // byte-for-byte. No keyframe may be discarded by shortening.
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"));
            }
            let animators = animation.get("animators").and_then(Value::as_object)
                .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
            for track in animators.values() {
                let frames = track.get("keyframes").and_then(Value::as_array)
                    .ok_or_else(|| fail("ANIMATION_LENGTH_EDIT_UNSUPPORTED"))?;
                if frames.iter().any(|frame| frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|time| time > *length)) {
                    return Err(fail("ANIMATION_LENGTH_BEFORE_KEYFRAME"));
                }
            }
            doc.animation_assets[index]["length"] = json!(length);
            Ok(animation_uuid.clone())
        }
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_uuid(keyframe_uuid) || !time.is_finite() || *time < 0.0 ||
               !valid_vec3(*rotation) ||
               doc.animation_assets.iter().any(|a| value_references_uuid(a, keyframe_uuid)) ||
               doc.cubes.iter().any(|c| c.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|b| b.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animators = animation.get_mut("animators").and_then(Value::as_object_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animators.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name": bone_name, "type": "bone", "keyframes": []
            }));
            if track.get("type").is_some_and(|kind| kind.as_str() != Some("bone")) {
                return Err(fail("ANIMATION_TRACK_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 4096 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64).is_some_and(|t| (t - time).abs() <= 1e-6)
            ) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            // Blockbench KeyframeDataPoint's x/y/z fields are Molang strings.
            frames.push(json!({
                "uuid": keyframe_uuid, "channel": "rotation", "time": time,
                "interpolation": "linear",
                "data_points": [{
                    "x": rotation[0].to_string(),
                    "y": rotation[1].to_string(),
                    "z": rotation[2].to_string()
                }]
            }));
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, time, rotation,
        } => {
            if !valid_vec3(*rotation) || !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_KEYFRAME_INVALID"));
            }
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let length = animation.get("length").and_then(Value::as_f64)
                .filter(|v| v.is_finite() && (0.0..=3600.0).contains(v))
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != index &&
                frame.get("channel").and_then(Value::as_str) == Some("rotation") &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[index]["time"] = json!(time);
            frames[index]["data_points"][0] = json!({
                "x": rotation[0].to_string(), "y": rotation[1].to_string(),
                "z": rotation[2].to_string()
            });
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneRotationKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid,
        } => {
            let animation = doc.animation_assets.iter_mut()
                .find(|item| item.get("uuid").and_then(Value::as_str) == Some(animation_uuid))
                .ok_or_else(|| fail("ANIMATION_NOT_FOUND"))?;
            let track = animation.get_mut("animators").and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            if !editable_rotation_track(track) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let index = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if !editable_rotation_frame(&frames[index]) {
                return Err(fail("ANIMATION_KEYFRAME_UNSUPPORTED"));
            }
            frames.remove(index);
            // The session owns a draft; a refusal here rolls back the removal.
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::AddBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_uuid(keyframe_uuid) || !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 ||
               doc.animation_assets.iter().any(|asset|
                   value_references_uuid(asset, keyframe_uuid)) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let bone_name = doc.bones.iter().find(|bone| bone.uuid == *bone_uuid)
                .map(|bone| bone.name.clone())
                .ok_or_else(|| fail("ANIMATION_BONE_NOT_FOUND"))?;
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            let animation = &doc.animation_assets[index];
            if !editable_transform_clip(animation, &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = animation.get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let animator = doc.animation_assets[index]["animators"].as_object_mut()
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            let track = animator.entry(bone_uuid.clone()).or_insert_with(|| json!({
                "name":bone_name,"type":"bone","keyframes":[]
            }));
            let frames = track.get_mut("keyframes").and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_UNSUPPORTED"))?;
            if frames.len() >= 2048 || frames.iter().any(|frame|
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames.push(json!({
                "uuid":keyframe_uuid, "channel":channel, "time":time,
                "interpolation":"linear",
                "data_points":[{
                    "x":value[0].to_string(), "y":value[1].to_string(),
                    "z":value[2].to_string()
                }]
            }));
            Ok(keyframe_uuid.clone())
        }
        EditOperation::UpdateBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel, time, value,
        } => {
            if !valid_animation_transform_value(channel, *value) ||
               !time.is_finite() || *time < 0.0 {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let length = doc.animation_assets[index].get("length").and_then(Value::as_f64)
                .ok_or_else(|| fail("ANIMATION_LENGTH_UNSUPPORTED"))?;
            if *time > length { return Err(fail("ANIMATION_KEYFRAME_TIME_INVALID")); }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            if frames.iter().enumerate().any(|(i, frame)| i != target &&
                frame.get("channel").and_then(Value::as_str) == Some(channel.as_str()) &&
                frame.get("time").and_then(Value::as_f64)
                    .is_some_and(|existing| (existing - time).abs() <= 1e-6)) {
                return Err(fail("ANIMATION_KEYFRAME_CONFLICT"));
            }
            frames[target]["time"] = json!(time);
            frames[target]["data_points"][0] = json!({
                "x":value[0].to_string(), "y":value[1].to_string(),
                "z":value[2].to_string()
            });
            Ok(keyframe_uuid.clone())
        }
        EditOperation::RemoveBoneTransformKeyframe {
            animation_uuid, bone_uuid, keyframe_uuid, channel,
        } => {
            if !supported_transform_channel(channel) {
                return Err(fail("ANIMATION_TRANSFORM_INVALID"));
            }
            let matching: Vec<_> = doc.animation_assets.iter().enumerate()
                .filter(|(_, asset)| asset.get("uuid").and_then(Value::as_str) ==
                    Some(animation_uuid.as_str())).map(|(i, _)| i).collect();
            if matching.len() != 1 {
                return Err(fail(if matching.is_empty() {
                    "ANIMATION_NOT_FOUND"
                } else { "ANIMATION_ID_AMBIGUOUS" }));
            }
            let index = matching[0];
            if !editable_transform_clip(&doc.animation_assets[index], &doc.bones) {
                return Err(fail("ANIMATION_TRANSFORM_UNSUPPORTED"));
            }
            let frames = doc.animation_assets[index].get_mut("animators")
                .and_then(Value::as_object_mut)
                .and_then(|tracks| tracks.get_mut(bone_uuid))
                .and_then(|track| track.get_mut("keyframes"))
                .and_then(Value::as_array_mut)
                .ok_or_else(|| fail("ANIMATION_TRACK_NOT_FOUND"))?;
            let target = frames.iter().position(|frame|
                frame.get("uuid").and_then(Value::as_str) == Some(keyframe_uuid))
                .ok_or_else(|| fail("ANIMATION_KEYFRAME_NOT_FOUND"))?;
            if frames[target].get("channel").and_then(Value::as_str) !=
               Some(channel.as_str()) {
                return Err(fail("ANIMATION_KEYFRAME_CHANNEL_MISMATCH"));
            }
            frames.remove(target);
            if has_external_uuid_references(doc, keyframe_uuid) ||
               doc.cubes.iter().any(|cube| cube.uuid == *keyframe_uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *keyframe_uuid) {
                return Err(fail("ANIMATION_KEYFRAME_REFERENCED"));
            }
            Ok(keyframe_uuid.clone())
        }
        EditOperation::EnableImportedPaintTexture { texture_index } => {
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            let (width, height) = (doc.resolution.width, doc.resolution.height);
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::adopt(texture, width, height)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetEmptyAtlasResolution { width, height } => {
            if !can_set_empty_atlas_resolution(doc) {
                return Err(fail("ATLAS_RESOLUTION_LOCKED"));
            }
            if *width == 0 || *height == 0 || *width > 256 || *height > 256 {
                return Err(fail("ATLAS_RESOLUTION_UNSUPPORTED"));
            }
            doc.resolution.width = *width;
            doc.resolution.height = *height;
            Ok("project-resolution".into())
        }
        EditOperation::ImportPaintTexture { uuid, name, source } => {
            // Existing imported project assets are never rewritten to admit
            // an unsupported Paint/UV configuration.
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            let texture = paint::import_png(
                uuid, name, source, doc.resolution.width, doc.resolution.height
            )?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::AssignCubeTexture { cube_uuid, texture_uuid } => {
            // Bedrock multi-file rulesets select textures by element scope.
            // Do not claim global face-ID assignment changes the material.
            if has_per_texture_uv_rules(doc) {
                return Err(fail("PAINT_TEXTURE_RULESET_UNSUPPORTED"));
            }
            if !doc.texture_assets.iter().any(|asset|
                asset.get("uuid").and_then(Value::as_str) == Some(texture_uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_NOT_FOUND"));
            }
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *cube_uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            for face in cube.faces.values_mut() {
                // A null face is intentionally absent in Blockbench. Never
                // enable its geometry by assigning another texture.
                if face.get("texture").is_some_and(Value::is_null) { continue; }
                let fields = face.as_object_mut()
                    .ok_or_else(|| fail("CUBE_FACE_DATA_INVALID"))?;
                fields.insert("texture".into(), Value::String(texture_uuid.clone()));
            }
            Ok(cube_uuid.clone())
        }
        EditOperation::CreatePaintTexture { uuid, name } => {
            check_paint_texture_addition(doc)?;
            if !valid_uuid(uuid) || doc.cubes.iter().any(|cube| cube.uuid == *uuid) ||
               doc.bones.iter().any(|bone| bone.uuid == *uuid) ||
               doc.texture_assets.iter().chain(doc.animation_assets.iter())
                 .any(|asset| asset.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())) {
                return Err(fail("PAINT_TEXTURE_ID_INVALID"));
            }
            // Bedrock project resolution is the atlas size for this initial
            // single-texture Paint subset. The codec owns all PNG bytes.
            let texture = paint::create(uuid, name, doc.resolution.width, doc.resolution.height)?;
            doc.texture_assets.push(texture);
            Ok(uuid.clone())
        }
        EditOperation::PaintTexturePixel { texture_index, x, y, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::pixel(texture, doc.resolution.width, doc.resolution.height, *x, *y, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureStroke { texture_index, points, rgba } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::stroke(texture, doc.resolution.width, doc.resolution.height, points, *rgba)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureBrush { texture_index, points, radius, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::brush(texture, doc.resolution.width, doc.resolution.height,
                points, *radius, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureRectangle { texture_index, from, to, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::rectangle(texture, doc.resolution.width, doc.resolution.height,
                *from, *to, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::PaintTextureFill { texture_index, at, rgba, erase } => {
            let texture = doc.texture_assets.get_mut(*texture_index)
                .ok_or_else(|| fail("PAINT_TEXTURE_NOT_FOUND"))?;
            paint::fill(texture, doc.resolution.width, doc.resolution.height,
                *at, *rgba, *erase)?;
            Ok(texture.get("uuid").and_then(Value::as_str)
                .unwrap_or("paint-texture").to_owned())
        }
        EditOperation::SetBoxUvOffset { uuid, offset } => {
            // Blockbench's Box UV editor stores integer atlas offsets.
            if !valid_uv(offset) || !offset.iter().all(|value| value.fract() == 0.0) {
                return Err(fail("BOX_UV_OFFSET_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if !cube_box_uv(cube, project_box_uv) {
                return Err(fail("BOX_UV_MODE_REQUIRED"));
            }
            if cube.uv_offset.unwrap_or([0.0, 0.0]) == *offset {
                return Ok(uuid.clone());
            }
            cube.uv_offset = if offset.iter().all(|value| *value == 0.0) {
                None
            } else {
                Some(*offset)
            };
            refresh_box_uv(cube)?;
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUvRotation { uuid, face, rotation } => {
            if !FACE_NAMES.contains(&face.as_str()) ||
               !matches!(*rotation, 0 | 90 | 180 | 270) {
                return Err(fail("FACE_UV_ROTATION_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|cube| cube.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            let auto_uv = cube_auto_uv(cube)?;
            let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
            // Blockbench CubeFace.rotation defaults to 0, and its save copy
            // omits default fields. Unsupported existing data is preserved
            // through refusal, not overwritten or silently normalized.
            let previous = match data.get("rotation") {
                None => 0,
                Some(value) => match value.as_f64() {
                    Some(n) if [0.0, 90.0, 180.0, 270.0].contains(&n) => n as u16,
                    _ => return Err(fail("FACE_UV_ROTATION_UNSUPPORTED")),
                },
            };
            if previous != *rotation {
                if *rotation == 0 {
                    data.remove("rotation");
                } else {
                    data.insert("rotation".into(), json!(rotation));
                }
                // Manual face rotation, like manual face coordinates, leaves
                // Auto UV mode without recalculating unrelated face mapping.
                if auto_uv != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUv { uuid, face, uv } => {
            if !FACE_NAMES.contains(&face.as_str()) || !valid_uv(uv) {
                return Err(fail("FACE_UV_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube_box_uv(cube, project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            // Blockbench's manual face-UV editing disables Auto UV for the
            // edited Cube. Keep this transition in the same Rust transaction.
            let previous = face_uv(cube, face)?;
            if previous != *uv {
                let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                    .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
                data.insert("uv".into(), json!(uv));
                if cube_auto_uv(cube)? != 0 {
                    cube.extra.insert("autouv".into(), json!(0));
                }
            }
            Ok(uuid.clone())
        }
    }
}

/// The only mutable authoring state. Each GUI/CLI caller must supply the
/// expected in-process revision; CLI also checks exact source SHA-256.
pub struct EditorSession {
    doc: AuthoringDocument,
    revision: u64,
    undo: Vec<AuthoringDocument>,
    redo: Vec<AuthoringDocument>,
}

impl EditorSession {
    pub fn open(bytes: &[u8]) -> Result<Self> {
        Self::from_document(AuthoringDocument::import_bbmodel(bytes)?)
    }
    pub fn from_document(doc: AuthoringDocument) -> Result<Self> {
        doc.validate()?;
        Ok(Self { doc, revision: 0, undo: Vec::new(), redo: Vec::new() })
    }
    pub fn document(&self) -> &AuthoringDocument { &self.doc }
    pub fn can_undo(&self) -> bool { !self.undo.is_empty() }
    pub fn can_redo(&self) -> bool { !self.redo.is_empty() }
    pub fn summary(&self) -> DocumentSummary { self.doc.summary(self.revision) }
    pub fn export(&self) -> Result<Vec<u8>> { self.doc.export_bbmodel() }

    pub fn apply(&mut self, expected_revision: u64, operations: &[EditOperation]) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        if operations.is_empty() || operations.len() > MAX_OPERATIONS {
            return Err(fail("EDIT_BATCH_SIZE_INVALID"));
        }
        let mut next = self.doc.clone();
        let mut changed = Vec::new();
        for operation in operations {
            let id = apply_operation(&mut next, operation)?;
            if !changed.contains(&id) { changed.push(id); }
        }
        next.validate()?;
        if next == self.doc { return Err(fail("EDIT_NO_OP")); }
        let prior = std::mem::replace(&mut self.doc, next);
        if self.undo.len() == MAX_HISTORY { self.undo.remove(0); }
        self.undo.push(prior);
        self.redo.clear();
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: operations.len(), changed_uuids: changed })
    }

    pub fn undo(&mut self, expected_revision: u64) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        let prior = self.undo.pop().ok_or_else(|| fail("UNDO_EMPTY"))?;
        let current = std::mem::replace(&mut self.doc, prior);
        self.redo.push(current);
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: 1, changed_uuids: Vec::new() })
    }
    pub fn redo(&mut self, expected_revision: u64) -> Result<MutationReceipt> {
        self.check_revision(expected_revision)?;
        let next = self.redo.pop().ok_or_else(|| fail("REDO_EMPTY"))?;
        let prior = std::mem::replace(&mut self.doc, next);
        if self.undo.len() == MAX_HISTORY { self.undo.remove(0); }
        self.undo.push(prior);
        self.revision += 1;
        Ok(MutationReceipt { revision: self.revision, operation_count: 1, changed_uuids: Vec::new() })
    }
    fn check_revision(&self, revision: u64) -> Result<()> {
        if revision != self.revision { Err(fail("DOCUMENT_REVISION_STALE")) } else { Ok(()) }
    }
}

#[cfg(test)]
mod tests;
