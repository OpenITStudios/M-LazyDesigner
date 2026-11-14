//! Standalone Bedrock Entity authoring engine shared by CLI and future Tauri UI.
//! SOURCE_ONLY: no Cargo, CLI, Blockbench, or native acceptance executed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

mod bbmodel;
pub mod storage;

pub const MAX_MODEL_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PLAN_BYTES: usize = 64 * 1024;
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
    TranslateCube { uuid: String, delta: [f64; 3] },
    SetCubeBounds { uuid: String, from: [f64; 3], to: [f64; 3] },
    SetFaceUv { uuid: String, face: String, uv: [f64; 4] },
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

fn validate_cube(cube: &Cube, textures: usize) -> Result<()> {
    if cube.kind != "cube" { return Err(fail("ELEMENT_TYPE_UNSUPPORTED")); }
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
                Value::Number(index) if index.as_u64().is_some_and(|v| v < textures as u64) => {},
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
                box_uv: Some(false), extra: Map::new(),
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
            validate_cube(cube, self.texture_assets.len())?;
            if !all_ids.insert(cube.uuid.clone()) { return Err(fail("DUPLICATE_UUID")); }
            cube_ids.insert(cube.uuid.clone());
        }
        for bone in &self.bones {
            if !valid_uuid(&bone.uuid) || bone.name.trim().is_empty() ||
               bone.name.chars().count() > 128 || bone.origin.is_some_and(|v| !valid_vec3(v)) {
                return Err(fail("BONE_INVALID"));
            }
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
            validate_cube(cube, doc.texture_assets.len())?;
            if !append_child(&mut doc.hierarchy, bone_uuid, &OutlinerNode::Cube(cube.uuid.clone())) {
                return Err(fail("CUBE_BONE_NOT_FOUND"));
            }
            doc.cubes.push(cube.clone());
            Ok(cube.uuid.clone())
        }
        EditOperation::TranslateCube { uuid, delta } => {
            if !valid_vec3(*delta) { return Err(fail("CUBE_DELTA_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            for axis in 0..3 {
                cube.from[axis] += delta[axis];
                cube.to[axis] += delta[axis];
            }
            let origin = cube.origin.get_or_insert([0.0, 0.0, 0.0]);
            for axis in 0..3 { origin[axis] += delta[axis]; }
            Ok(uuid.clone())
        }
        EditOperation::SetCubeBounds { uuid, from, to } => {
            if !valid_bounds(*from, *to) { return Err(fail("CUBE_BOUNDS_INVALID")); }
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            cube.from = *from;
            cube.to = *to;
            Ok(uuid.clone())
        }
        EditOperation::SetFaceUv { uuid, face, uv } => {
            if !FACE_NAMES.contains(&face.as_str()) || !valid_uv(uv) {
                return Err(fail("FACE_UV_INVALID"));
            }
            let project_box_uv = doc.meta.box_uv.unwrap_or(false);
            let cube = doc.cubes.iter_mut().find(|c| c.uuid == *uuid)
                .ok_or_else(|| fail("CUBE_NOT_FOUND"))?;
            if cube.extra.get("box_uv").and_then(Value::as_bool).unwrap_or(project_box_uv) {
                return Err(fail("FACE_UV_BOX_MODE_UNSUPPORTED"));
            }
            let data = cube.faces.get_mut(face).and_then(Value::as_object_mut)
                .ok_or_else(|| fail("FACE_NOT_FOUND"))?;
            data.insert("uv".into(), json!(uv));
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
