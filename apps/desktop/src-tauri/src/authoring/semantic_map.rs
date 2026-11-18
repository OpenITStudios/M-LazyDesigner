//! Bounded semantic identity map for an already validated Rust EditorSession.
//! This is a read projection, not a new document store, selection authority,
//! rendered-image evaluation, or permission to execute edits.
//! SOURCE_ONLY: Rust/Windows tests remain on hold.

use super::{AuthoringDocument, OutlinerNode, Result};
use serde_json::{json, Value};
use std::collections::HashMap;

const MAX_PAGE: usize = 24;
const MAX_RESULT_BYTES: usize = 16 * 1024;

fn short_name(name: Option<&str>) -> Option<String> {
    name.map(|value| value.chars().take(96).collect())
}

fn parent_links<'a>(
    nodes: &'a [OutlinerNode], parent: Option<&'a str>,
    links: &mut HashMap<&'a str, Option<&'a str>>,
) {
    for node in nodes {
        match node {
            OutlinerNode::Cube(uuid) => {
                links.insert(uuid, parent);
            }
            OutlinerNode::Bone(bone) => {
                links.insert(&bone.uuid, parent);
                parent_links(&bone.children, Some(&bone.uuid), links);
            }
        }
    }
}

/// Both the GUI's frozen in-memory session and the headless CLI use this
/// exact projection. The caller owns the source/revision guard. IDs and
/// parent links are source facts; labels are not unique or write targets.
pub(super) fn from_validated(
    doc: &AuthoringDocument, revision: u64, category: &str,
    offset: usize, limit: usize,
) -> Result<Value> {
    if limit == 0 || limit > MAX_PAGE || offset > 65_536 {
        return Err("SEMANTIC_MAP_PAGE_INVALID".into());
    }
    let (kind, total) = match category {
        "cubes" => ("cube", doc.cubes.len()),
        "bones" => ("bone", doc.bones.len()),
        "textures" => ("texture", doc.texture_assets.len()),
        "animations" => ("animation", doc.animation_assets.len()),
        _ => return Err("SEMANTIC_MAP_CATEGORY_INVALID".into()),
    };
    let end = offset.saturating_add(limit).min(total);
    let mut parents = HashMap::new();
    if category == "cubes" || category == "bones" {
        parent_links(&doc.hierarchy, None, &mut parents);
    }
    let mut entries = Vec::with_capacity(end.saturating_sub(offset));
    for index in offset..end {
        let entry = match category {
            "cubes" => {
                let cube = &doc.cubes[index];
                json!({
                    "kind":kind, "index":index, "uuid":cube.uuid,
                    "name":short_name(cube.name.as_deref()),
                    "parent_uuid":parents.get(cube.uuid.as_str()).copied().flatten(),
                    "declared_textured_faces":cube.faces.values()
                        .filter(|face| face.get("texture").is_some_and(|v|
                            v.is_string() || v.is_number())).count()
                })
            }
            "bones" => {
                let bone = &doc.bones[index];
                json!({
                    "kind":kind, "index":index, "uuid":bone.uuid,
                    "name":short_name(Some(&bone.name)),
                    "parent_uuid":parents.get(bone.uuid.as_str()).copied().flatten()
                })
            }
            "textures" => {
                let asset = &doc.texture_assets[index];
                let source_kind = if asset.get("source").and_then(Value::as_str)
                    .is_some_and(|source| source.starts_with("data:image/png;base64,")) {
                    "embedded_png_declared"
                } else if asset.get("relative_path").and_then(Value::as_str).is_some() {
                    "relative_path_declared"
                } else { "unavailable_or_other" };
                json!({
                    "kind":kind, "index":index,
                    "uuid":asset.get("uuid"), "name":short_name(
                        asset.get("name").and_then(Value::as_str)),
                    "source_kind":source_kind
                })
            }
            "animations" => {
                let asset = &doc.animation_assets[index];
                json!({
                    "kind":kind, "index":index,
                    "uuid":asset.get("uuid"), "name":short_name(
                        asset.get("name").and_then(Value::as_str)),
                    "declared_animator_tracks":asset.get("animators")
                        .and_then(Value::as_object).map(|tracks| tracks.len())
                })
            }
            _ => unreachable!(),
        };
        entries.push(entry);
    }
    let result = json!({
        "scope":"validated_rust_semantic_identity_map",
        "revision":revision,
        "category":category,
        "total":total,
        "offset":offset,
        "next_offset":if end < total {Some(end)} else {None},
        "counts":{
            "cubes":doc.cubes.len(), "bones":doc.bones.len(),
            "textures":doc.texture_assets.len(), "animations":doc.animation_assets.len()
        },
        "entries":entries,
        "write_authority":"NOT_GRANTED",
        "visual_verdict":"UNVERIFIED",
        "effective_material":"UNVERIFIED"
    });
    if serde_json::to_vec(&result)
        .map_err(|_| "SEMANTIC_MAP_SERIALIZE_FAILED".to_owned())?.len()
        > MAX_RESULT_BYTES {
        return Err("SEMANTIC_MAP_RESULT_TOO_LARGE".into());
    }
    Ok(result)
}
