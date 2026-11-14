//! Pinned Blockbench v5.2.1 editable .bbmodel format adapter (format 5.0).
//! The serde wire shape is NOT the authoritative Rust document schema.

use super::{
    AuthoringDocument, Bone, Cube, OutlinerNode, ProjectMeta, TextureResolution, MAX_MODEL_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
type Result<T> = std::result::Result<T, String>;

#[derive(Serialize, Deserialize)]
struct BlockbenchV5 {
    meta: ProjectMeta,
    resolution: TextureResolution,
    elements: Vec<Cube>,
    groups: Vec<Bone>,
    outliner: Vec<OutlinerNode>,
    textures: Vec<Value>,
    #[serde(default)]
    animations: Vec<Value>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

impl From<BlockbenchV5> for AuthoringDocument {
    fn from(wire: BlockbenchV5) -> Self {
        Self {
            meta: wire.meta, resolution: wire.resolution,
            cubes: wire.elements, bones: wire.groups, hierarchy: wire.outliner,
            texture_assets: wire.textures, animation_assets: wire.animations,
            extensions: wire.extra,
        }
    }
}

impl From<&AuthoringDocument> for BlockbenchV5 {
    fn from(doc: &AuthoringDocument) -> Self {
        Self {
            meta: doc.meta.clone(), resolution: doc.resolution.clone(),
            elements: doc.cubes.clone(), groups: doc.bones.clone(),
            outliner: doc.hierarchy.clone(), textures: doc.texture_assets.clone(),
            animations: doc.animation_assets.clone(), extra: doc.extensions.clone(),
        }
    }
}

pub(super) fn decode(bytes: &[u8]) -> Result<AuthoringDocument> {
    if bytes.is_empty() || bytes.len() > MAX_MODEL_BYTES || bytes.starts_with(b"<lz>") {
        return Err("BBMODEL_INPUT_UNSUPPORTED".into());
    }
    let wire: BlockbenchV5 = serde_json::from_slice(bytes)
        .map_err(|_| "BBMODEL_PARSE_INVALID".to_string())?;
    let doc = AuthoringDocument::from(wire);
    doc.validate()?;
    Ok(doc)
}

pub(super) fn encode(doc: &AuthoringDocument) -> Result<Vec<u8>> {
    doc.validate()?;
    let wire = BlockbenchV5::from(doc);
    let mut out = serde_json::to_vec_pretty(&wire)
        .map_err(|_| "BBMODEL_SERIALIZE_FAILED".to_string())?;
    out.push(b'\n');
    if out.len() > MAX_MODEL_BYTES { return Err("BBMODEL_OUTPUT_TOO_LARGE".into()); }
    Ok(out)
}
