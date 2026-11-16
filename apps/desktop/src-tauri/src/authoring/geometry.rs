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

/// Export a separate Bedrock geometry file without touching the editable
/// .bbmodel document, texture assets, animation tracks, revision or Undo stack.
pub fn export_bedrock_geometry(doc: &AuthoringDocument) -> Result<Vec<u8>> {
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
    let json = json!({
        "format_version": version,
        "minecraft:geometry": [{
            "description": {
                "identifier": format!("geometry.{identifier}"),
                "texture_width": doc.resolution.width,
                "texture_height": doc.resolution.height
            },
            "bones": bones
        }]
    });
    let mut bytes = serde_json::to_vec_pretty(&json)
        .map_err(|_| fail("GEOMETRY_EXPORT_SERIALIZE_FAILED"))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_MODEL_BYTES { return Err(fail("GEOMETRY_EXPORT_TOO_LARGE")); }
    Ok(bytes)
}

// Test sources are authored for later authorized PC-local validation.
// They are not executed in CHATGPT_GITHUB.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const BASIC: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");

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
        })];
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
            })];
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
        })];
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
