// TEST_AUTHORED_NOT_RUN: original domain regressions moved intact under test hold.
use super::*;
use serde_json::json;

const BASIC: &[u8] = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");


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
