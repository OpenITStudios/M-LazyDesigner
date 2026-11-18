//! Bounded semantic identity map for an already validated Rust EditorSession.
//! This is a read projection, not a new document store, selection authority,
//! rendered-image evaluation, or permission to execute edits.
//! SOURCE_ONLY: Rust/Windows tests remain on hold.

use super::{AuthoringDocument, OutlinerNode, Result};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const MAX_PAGE: usize = 24;
const MAX_RESULT_BYTES: usize = 16 * 1024;

fn short_name(name: Option<&str>) -> Option<String> {
    name.map(|value| value.chars().take(96).collect())
}

fn parent_links<'a>(
    nodes: &'a [OutlinerNode], parent: Option<&'a str>,
    wanted: &HashSet<&str>,
    links: &mut HashMap<&'a str, Option<&'a str>>,
) {
    for node in nodes {
        // Read-only pages contain at most 24 UUIDs. Stop traversing when
        // all requested parents have been found; never index the whole scene.
        if links.len() == wanted.len() { break; }
        match node {
            OutlinerNode::Cube(uuid) => {
                if wanted.contains(uuid.as_str()) {
                    links.insert(uuid, parent);
                }
            }
            OutlinerNode::Bone(bone) => {
                if wanted.contains(bone.uuid.as_str()) {
                    links.insert(&bone.uuid, parent);
                }
                parent_links(&bone.children, Some(&bone.uuid), wanted, links);
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
    if end > offset && (category == "cubes" || category == "bones") {
        let wanted: HashSet<&str> = if category == "cubes" {
            doc.cubes[offset..end].iter().map(|cube| cube.uuid.as_str()).collect()
        } else {
            doc.bones[offset..end].iter().map(|bone| bone.uuid.as_str()).collect()
        };
        parent_links(&doc.hierarchy, None, &wanted, &mut parents);
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


#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Bone, Cube, EditOperation, EditorSession};
    use serde_json::json;

    const SAMPLE: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
    const ROOT: &str = "00000000-0000-4000-8000-000000009101";
    const CHILD: &str = "00000000-0000-4000-8000-000000009102";
    const ROOT_CUBE: &str = "00000000-0000-4000-8000-000000009103";
    const CHILD_CUBE: &str = "00000000-0000-4000-8000-000000009104";

    #[test]
    fn page_local_parent_projection_preserves_nested_identity_and_empty_pages() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Paged Geometry", "paged").unwrap()
        ).unwrap();
        let root: Bone = serde_json::from_value(json!({
            "uuid": ROOT, "name": "root", "origin": [0, 0, 0],
        })).unwrap();
        let child: Bone = serde_json::from_value(json!({
            "uuid": CHILD, "name": "child", "origin": [0, 0, 0],
        })).unwrap();
        let sample: Value = serde_json::from_slice(SAMPLE).unwrap();
        let mut root_cube: Cube =
            serde_json::from_value(sample["elements"][0].clone()).unwrap();
        root_cube.uuid = ROOT_CUBE.into();
        root_cube.name = Some("root_cube".into());
        let mut child_cube = root_cube.clone();
        child_cube.uuid = CHILD_CUBE.into();
        child_cube.name = Some("child_cube".into());
        session.apply(0, &[
            EditOperation::AddBone { bone: root, parent_uuid: None },
            EditOperation::AddBone { bone: child, parent_uuid: Some(ROOT.into()) },
            EditOperation::AddCube { cube: root_cube, bone_uuid: ROOT.into() },
            EditOperation::AddCube { cube: child_cube, bone_uuid: CHILD.into() },
        ]).unwrap();
        let before = session.document().clone();

        let first = session.semantic_map("cubes", 0, 1).unwrap();
        let second = session.semantic_map("cubes", 1, 1).unwrap();
        assert_eq!(first["entries"][0]["uuid"], ROOT_CUBE);
        assert_eq!(first["entries"][0]["parent_uuid"], ROOT);
        assert_eq!(second["entries"][0]["uuid"], CHILD_CUBE);
        assert_eq!(second["entries"][0]["parent_uuid"], CHILD);
        assert_eq!(second["next_offset"], Value::Null);

        let bones = session.semantic_map("bones", 1, 1).unwrap();
        assert_eq!(bones["entries"][0]["uuid"], CHILD);
        assert_eq!(bones["entries"][0]["parent_uuid"], ROOT);
        let empty = session.semantic_map("cubes", 10, 1).unwrap();
        assert!(empty["entries"].as_array().unwrap().is_empty());
        assert_eq!(empty["next_offset"], Value::Null);
        assert_eq!(session.document(), &before);
        assert_eq!(session.summary().revision, 1);
    }
}
