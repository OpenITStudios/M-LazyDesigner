//! Rust source regression intent; TEST_AUTHORED_NOT_RUN.

use super::*;
use serde_json::{json, Value};

const SAMPLE: &str = include_str!("../../fixtures/bedrock-basic.bbmodel");
const TEXTURED: &str = include_str!("../../fixtures/bedrock-texture-interchange.bbmodel");
const BONE: &str = "00000000-0000-4000-8000-000000000001";
const CUBE: &str = "00000000-0000-4000-8000-000000000002";

fn sample_cube(uuid: &str) -> Cube {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["elements"][0]["uuid"] = json!(uuid);
    serde_json::from_value(value["elements"][0].clone()).unwrap()
}

// SOURCE-AUTHORED: existing Rust tests remain NOT_EXECUTED.
#[test]
fn animation_length_edit_is_atomic_reversible_and_keeps_keyframe_payload() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009101";
    const KEY: &str = "00000000-0000-4000-8000-000000009102";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: ANIM.into(), name: "idle".into(), length: 1.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: KEY.into(), time: 0.75, rotation: [0.0, 45.0, 0.0],
        },
    ]).unwrap();
    let before = session.document().clone();
    let frames = before.animation_assets[0]["animators"][BONE]["keyframes"].clone();
    let receipt = session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 2.5 },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.changed_uuids, vec![ANIM.to_owned()]);
    let changed = session.document().clone();
    assert_eq!(changed.animation_assets[0]["length"], json!(2.5));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["keyframes"], frames);
    assert_eq!(changed.cubes, before.cubes);
    assert_eq!(changed.bones, before.bones);
    assert_eq!(changed.hierarchy, before.hierarchy);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        changed);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &changed);
    assert_eq!(session.apply(4, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 2.5 },
    ]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn animation_length_edit_refuses_truncation_and_unrecognized_tracks_without_partial_write() {
    const ANIM: &str = "00000000-0000-4000-8000-000000009103";
    const KEY: &str = "00000000-0000-4000-8000-000000009104";
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: ANIM.into(), name: "walk".into(), length: 2.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: ANIM.into(), bone_uuid: BONE.into(),
            keyframe_uuid: KEY.into(), time: 1.5, rotation: [0.0, 15.0, 0.0],
        },
    ]).unwrap();
    let original = session.document().clone();
    for length in [-1.0, 3601.0, f64::NAN, f64::INFINITY] {
        assert_eq!(session.apply(1, &[
            EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length },
        ]).unwrap_err(), "ANIMATION_LENGTH_INVALID");
    }
    assert_eq!(session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 1.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_BEFORE_KEYFRAME");
    assert_eq!(session.apply(1, &[
        EditOperation::SetAnimationLength { animation_uuid: "missing".into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);

    let mut imported = original.clone();
    imported.animation_assets[0]["animators"][BONE]["keyframes"][0]
        ["data_points"][0]["x"] = json!("query.head_yaw");
    let mut imported = EditorSession::from_document(imported.clone()).unwrap();
    assert_eq!(imported.apply(0, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_EDIT_UNSUPPORTED");
    let source = imported.document().clone();
    assert_eq!(imported.apply(0, &[
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_LENGTH_EDIT_UNSUPPORTED");
    assert_eq!(imported.document(), &source);
    assert_eq!(imported.summary().revision, 0);
    assert!(!imported.can_undo());

    let mut duplicate = original.clone();
    duplicate.animation_assets.push(original.animation_assets[0].clone());
    let mut duplicated = EditorSession::from_document(duplicate.clone()).unwrap();
    assert_eq!(duplicated.apply(0, &[
        EditOperation::SetAnimationLength { animation_uuid: ANIM.into(), length: 3.0 },
    ]).unwrap_err(), "ANIMATION_ID_AMBIGUOUS");
    assert_eq!(duplicated.document(), &duplicate);
    assert_eq!(duplicated.summary().revision, 0);
}

// SOURCE-AUTHORED ONLY: Rust/Blockbench tests remain NOT_EXECUTED.
#[test]
fn node_rename_is_atomic_undoable_and_synchronizes_known_bone_animator_name() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let animation_uuid = "00000000-0000-4000-8000-000000009801";
    let keyframe_uuid = "00000000-0000-4000-8000-000000009802";
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: animation_uuid.into(), name: "idle".into(), length: 1.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: animation_uuid.into(), bone_uuid: BONE.into(),
            keyframe_uuid: keyframe_uuid.into(), time: 0.5,
            rotation: [0.0, 30.0, 0.0],
        },
    ]).unwrap();
    let before_rename = session.document().clone();
    assert_eq!(before_rename.animation_assets[0]["animators"][BONE]["name"],
        json!("root_bone"));
    let receipt = session.apply(1, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name: "helmet_plate".into() },
        EditOperation::RenameNode { uuid: BONE.into(), name: "head".into() },
    ]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(receipt.changed_uuids, vec![CUBE.to_owned(), BONE.to_owned()]);
    let changed = session.document().clone();
    assert_eq!(changed.cubes[0].name.as_deref(), Some("helmet_plate"));
    assert_eq!(changed.bones[0].name, "head");
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["name"], json!("head"));
    assert_eq!(changed.animation_assets[0]["animators"][BONE]["keyframes"],
        before_rename.animation_assets[0]["animators"][BONE]["keyframes"]);
    assert_eq!(changed.cubes[0].uuid, original.cubes[0].uuid);
    assert_eq!(changed.hierarchy, before_rename.hierarchy);
    assert_eq!(changed.extensions, original.extensions);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, changed);
    session.undo(2).unwrap();
    assert_eq!(session.document(), &before_rename);
    session.redo(3).unwrap();
    assert_eq!(session.document(), &changed);
}

#[test]
fn rename_refuses_invalid_conflicting_and_opaque_track_names_without_partial_edits() {
    let original = AuthoringDocument::import_bbmodel(SAMPLE.as_bytes()).unwrap();
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    let too_long = "X".repeat(129);
    for name in ["", "   ", "invalid\nname", too_long.as_str()] {
        assert_eq!(session.apply(0, &[
            EditOperation::RenameNode { uuid: BONE.into(), name: name.into() },
        ]).unwrap_err(), "NODE_NAME_INVALID");
    }
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: "unknown".into(), name: "new".into() },
    ]).unwrap_err(), "RENAME_NODE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);

    let mut second = original.clone();
    second.bones.push(Bone {
        uuid: "00000000-0000-4000-8000-000000009803".into(),
        name: "other".into(), origin: Some([0.0, 0.0, 0.0]),
        extra: Map::new(),
    });
    second.hierarchy.push(OutlinerNode::Bone(OutlinerBone {
        uuid: "00000000-0000-4000-8000-000000009803".into(),
        children: Vec::new(), is_open: Some(true), extra: Map::new(),
    }));
    let mut session = EditorSession::from_document(second.clone()).unwrap();
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: BONE.into(), name: "OTHER".into() },
    ]).unwrap_err(), "BONE_NAME_CONFLICT");
    assert_eq!(session.document(), &second);

    let mut tracked = original.clone();
    let mut animators = Map::new();
    animators.insert(BONE.into(), json!({
        "name": "unexpected_alias", "type": "bone", "keyframes": [],
    }));
    tracked.animation_assets.push(json!({
        "uuid": "00000000-0000-4000-8000-000000009804",
        "name": "imported", "animators": animators,
    }));
    let mut session = EditorSession::from_document(tracked.clone()).unwrap();
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name: "temporary".into() },
        EditOperation::RenameNode { uuid: BONE.into(), name: "head".into() },
    ]).unwrap_err(), "BONE_ANIMATOR_NAME_UNSUPPORTED");
    assert_eq!(session.document(), &tracked);
    assert_eq!(session.summary().revision, 0);
    assert!(!session.can_undo());
    assert_eq!(session.apply(0, &[
        EditOperation::RenameNode { uuid: CUBE.into(), name:
            original.cubes[0].name.clone().unwrap_or_else(|| "cube".into()) },
    ]).unwrap_err(), "EDIT_NO_OP");
}

// Authored regression only. Tests remain held and are NOT_EXECUTED.
#[test]
fn generated_paint_texture_limit_matches_import_preview_and_history() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Paint limit", "paint_limit").unwrap()
    ).unwrap();
    assert!(can_add_paint_texture(session.document()));
    let operations: Vec<EditOperation> = (0..MAX_PAINT_TEXTURES).map(|index|
        EditOperation::CreatePaintTexture {
            uuid: format!("00000000-0000-4000-8000-{:012x}", 500 + index),
            name: format!("paint-{index}.png"),
        }
    ).collect();
    let receipt = session.apply(0, &operations).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().texture_assets.len(), MAX_PAINT_TEXTURES);
    assert!(!can_add_paint_texture(session.document()));
    let created = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000600".into(),
        name: "overflow.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_COUNT_LIMIT");
    assert_eq!(session.document(), &created);
    assert_eq!(session.summary().revision, 1);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        created);
    session.undo(1).unwrap();
    assert_eq!(session.document().texture_assets.len(), 0);
    assert!(can_add_paint_texture(session.document()));
    session.redo(2).unwrap();
    assert_eq!(session.document(), &created);
    assert!(!can_add_paint_texture(session.document()));
}

#[test]
fn generated_and_imported_paint_refuse_unsupported_uv_rules_and_id_conflicts() {
    let mut with_rules = AuthoringDocument::new_bedrock("Rules", "rules").unwrap();
    with_rules.extensions.insert("per_texture_uv_size".into(), json!(true));
    let mut session = EditorSession::from_document(with_rules.clone()).unwrap();
    let id = "00000000-0000-4000-8000-000000000700";
    assert!(!can_add_paint_texture(session.document()));
    assert_eq!(session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "generated.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
        uuid: id.into(), name: "imported.png".into(), source: "not-an-image".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &with_rules);
    assert_eq!(session.summary().revision, 0);

    let mut with_cube = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = with_cube.document().clone();
    assert_eq!(with_cube.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: CUBE.into(), name: "duplicate-identity.png".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_ID_INVALID");
    assert_eq!(with_cube.document(), &before);
}

// Source-authored regression only: local/native execution remains held.
#[test]
fn rust_png_export_is_byte_exact_read_only_and_follows_undo_redo() {
    let id = "00000000-0000-4000-8000-000000000810";
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Export", "export").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "atlas.png".into(),
    }]).unwrap();
    let source = session.document().texture_assets[0]["source"].as_str().unwrap();
    let original = base64::Engine::decode(&base64::engine::general_purpose::STANDARD,
        source.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
    let before = session.document().clone();
    assert!(paint_texture_exportable(session.document(), 0));
    assert_eq!(export_paint_png(session.document(), id).unwrap(), original);
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 2, y: 3, rgba: [8, 17, 31, 255],
    }]).unwrap();
    let painted = export_paint_png(session.document(), id).unwrap();
    assert_ne!(painted, original);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(export_paint_png(&reopened, id).unwrap(), painted);
    session.undo(2).unwrap();
    assert_eq!(export_paint_png(session.document(), id).unwrap(), original);
    session.redo(3).unwrap();
    assert_eq!(export_paint_png(session.document(), id).unwrap(), painted);
}

#[test]
fn rust_png_export_rejects_opaque_invalid_and_per_texture_uv_assets() {
    let id = "00000000-0000-4000-8000-000000000811";
    let mut generator = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Export", "export").unwrap()
    ).unwrap();
    generator.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: id.into(), name: "atlas.png".into(),
    }]).unwrap();
    let original = export_paint_png(generator.document(), id).unwrap();
    let mut imported = generator.document().clone();
    imported.texture_assets[0].as_object_mut().unwrap().remove("paint_owner");
    assert!(paint_texture_exportable(&imported, 0));
    assert_eq!(export_paint_png(&imported, id).unwrap(), original);
    imported.texture_assets[0]["layers"] = json!([{"name":"preserved"}]);
    let opaque = EditorSession::from_document(imported).unwrap();
    assert!(!paint_texture_exportable(opaque.document(), 0));
    assert_eq!(export_paint_png(opaque.document(), id).unwrap_err(),
        "PAINT_EXPORT_TEXTURE_UNSUPPORTED");
    assert_eq!(export_paint_png(opaque.document(), "missing").unwrap_err(),
        "PAINT_TEXTURE_NOT_FOUND");
    let mut bad = generator.document().clone();
    bad.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
    let bad = EditorSession::from_document(bad).unwrap();
    assert!(paint_texture_exportable(bad.document(), 0));
    assert!(export_paint_png(bad.document(), id).is_err());
    let mut rules = generator.document().clone();
    rules.extensions.insert("per_texture_uv_size".into(), json!(true));
    assert!(!paint_texture_exportable(&rules, 0));
    assert_eq!(export_paint_png(&rules, id).unwrap_err(),
        "PAINT_TEXTURE_RULESET_UNSUPPORTED");
}

#[test]
fn paint_rectangle_fills_inclusive_reversed_corners_with_one_undo_step() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Rectangle", "rectangle").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000139".into(),
        name: "rectangle.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    let receipt = session.apply(1, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [3, 4], to: [1, 2],
        rgba: [19, 42, 73, 200], erase: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let filled = session.document().texture_assets[0].clone();
    let png_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD,
        filled["source"].as_str().unwrap()
            .strip_prefix("data:image/png;base64,").unwrap()).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(png_bytes))
        .read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).unwrap();
    let width = session.document().resolution.width as usize;
    for y in 0..=5 {
        for x in 0..=5 {
            let start = (y * width + x) * 4;
            let expected: &[u8] = if (1..=3).contains(&x) && (2..=4).contains(&y) {
                &[19, 42, 73, 200]
            } else {
                &[0, 0, 0, 0]
            };
            assert_eq!(&pixels[start..start + 4], expected);
        }
    }
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], filled);
    assert_eq!(session.apply(4, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [1, 2], to: [3, 4],
        rgba: [19, 42, 73, 200], erase: false,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_rectangle_refuses_invalid_coordinates_imported_assets_and_partial_batch() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Rectangle", "rectangle").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000139".into(),
        name: "rectangle.png".into(),
    }]).unwrap();
    let unchanged = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [0, 0], to: [u32::MAX, 3],
        rgba: [10, 10, 10, 255], erase: false,
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureRectangle { texture_index: 0,
            from: [0, 0], to: [2, 2], rgba: [10, 10, 10, 255], erase: false },
        EditOperation::PaintTextureRectangle { texture_index: 0,
            from: [0, 0], to: [0, u32::MAX], rgba: [0, 0, 0, 0], erase: true },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &unchanged);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureRectangle {
        texture_index: 0, from: [0, 0], to: [2, 2],
        rgba: [10, 10, 10, 255], erase: false,
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &original);
}

#[test]
fn paint_brush_circle_and_eraser_preserve_one_undo_per_gesture() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Brush", "brush").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000129";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "brush.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    session.apply(1, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[2, 2]], radius: 2,
        rgba: [100, 50, 25, 255], erase: false,
    }]).unwrap();
    let painted = session.document().texture_assets[0].clone();
    assert_ne!(blank, painted);
    // Generated textures are the only supported ownership surface. Inspect
    // source-only RGBA pixels through the same bounded Rust decoder helper.
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        painted["source"].as_str().unwrap()
            .strip_prefix("data:image/png;base64,").unwrap(),
    ).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut pixels).unwrap();
    let w = session.document().resolution.width as usize;
    let rgba_at = |x: usize, y: usize| -> &[u8] {
        let start = (y * w + x) * 4;
        &pixels[start..start + 4]
    };
    assert_eq!(rgba_at(2, 2), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(1, 2), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(2, 1), &[100, 50, 25, 255]);
    assert_eq!(rgba_at(1, 1), &[0, 0, 0, 0]);
    assert_eq!(rgba_at(4, 2), &[0, 0, 0, 0]);
    session.apply(2, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[2, 2]], radius: 1,
        rgba: [255, 255, 255, 255], erase: true,
    }]).unwrap();
    let erased = session.document().texture_assets[0].clone();
    assert_ne!(painted, erased);
    session.undo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    session.undo(4).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(5).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    session.redo(6).unwrap();
    assert_eq!(session.document().texture_assets[0], erased);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
}

#[test]
fn paint_brush_invalid_radius_and_coordinates_refuse_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Brush", "brush").unwrap()
    ).unwrap();
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: "00000000-0000-4000-8000-000000000129".into(),
        name: "brush.png".into(),
    }]).unwrap();
    let original = session.document().clone();
    for radius in [0, 9, 255] {
        assert_eq!(session.apply(1, &[EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[2, 2]], radius,
            rgba: [3, 4, 5, 255], erase: false,
        }]).unwrap_err(), "PAINT_BRUSH_RADIUS_INVALID");
    }
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[0, 0], [128, 0]], radius: 8,
        rgba: [3, 4, 5, 255], erase: false,
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[1, 1]], radius: 8,
            rgba: [3, 4, 5, 255], erase: false,
        },
        EditOperation::PaintTextureBrush {
            texture_index: 0, points: vec![[128, 0]], radius: 1,
            rgba: [3, 4, 5, 255], erase: true,
        }
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureBrush {
        texture_index: 0, points: vec![[0, 0]], radius: 2,
        rgba: [0, 0, 0, 0], erase: true,
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
}

#[test]
fn paint_stroke_is_one_revision_one_undo_and_roundtrips() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Stroke", "stroke").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000119";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "stroke.png".into(),
    }]).unwrap();
    let blank = session.document().texture_assets[0].clone();
    let points = vec![[2, 3], [3, 3], [4, 3], [4, 3], [5, 3]];
    let receipt = session.apply(1, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: points.clone(), rgba: [9, 18, 27, 128],
    }]).unwrap();
    assert_eq!(receipt.revision, 2);
    assert_eq!(receipt.operation_count, 1);
    let painted = session.document().texture_assets[0].clone();
    assert_ne!(blank, painted);
    let bytes = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&bytes).unwrap(), *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], blank);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], painted);
    assert_eq!(session.apply(4, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points, rgba: [9, 18, 27, 128],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_stroke_refuses_invalid_size_coordinates_or_imported_assets_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Stroke", "stroke").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000119";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "stroke.png".into(),
    }]).unwrap();
    let prior = session.document().clone();
    for points in [vec![], vec![[0, 0]; 4097]] {
        assert_eq!(session.apply(1, &[EditOperation::PaintTextureStroke {
            texture_index: 0, points, rgba: [1, 2, 3, 4],
        }]).unwrap_err(), "PAINT_STROKE_SIZE_INVALID");
    }
    assert_eq!(session.apply(1, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: vec![[0, 0], [128, 0]],
        rgba: [1, 2, 3, 4],
    }]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.apply(1, &[
        EditOperation::PaintTextureStroke { texture_index: 0,
            points: vec![[0, 0]], rgba: [1, 2, 3, 4] },
        EditOperation::PaintTextureStroke { texture_index: 0,
            points: vec![[0, 0], [128, 0]], rgba: [1, 2, 3, 4] },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(session.document(), &prior);
    assert_eq!(session.summary().revision, 1);
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTextureStroke {
        texture_index: 0, points: vec![[0, 0]], rgba: [1, 2, 3, 4],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &original);
}

#[test]
fn authored_rgba8_paint_texture_mutates_one_pixel_with_history() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Paint", "paint").unwrap()
    ).unwrap();
    let uuid = "00000000-0000-4000-8000-000000000109";
    session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "atlas.png".into(),
    }]).unwrap();
    let before = session.document().texture_assets[0].clone();
    assert_eq!(before["uuid"], json!(uuid));
    assert_eq!(before["paint_owner"], json!("lazydesigner-rgba8-v1"));
    assert_eq!(before["wrap_mode"], json!("limited"));
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 3, y: 5, rgba: [120, 30, 200, 128],
    }]).unwrap();
    let after = session.document().texture_assets[0].clone();
    assert_ne!(before["source"], after["source"]);
    assert_eq!(before["uuid"], after["uuid"]);
    assert_eq!(before["name"], after["name"]);
    let saved = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&saved).unwrap(), *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().texture_assets[0], before);
    session.redo(3).unwrap();
    assert_eq!(session.document().texture_assets[0], after);
    assert_eq!(session.apply(4, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 3, y: 5, rgba: [120, 30, 200, 128],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn paint_refuses_imported_textures_oversized_canvas_and_partial_batches() {
    let mut imported = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let prior = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 0, y: 0, rgba: [0, 0, 0, 0],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(imported.document(), &prior);
    let uuid = "00000000-0000-4000-8000-000000000109";
    assert_eq!(imported.apply(0, &[
        EditOperation::CreatePaintTexture { uuid: uuid.into(), name: "new.png".into() },
        EditOperation::PaintTexturePixel {
            texture_index: 2, x: 128, y: 0, rgba: [255, 0, 0, 255],
        },
    ]).unwrap_err(), "PAINT_COORDINATE_INVALID");
    assert_eq!(imported.document(), &prior);
    assert_eq!(imported.summary().revision, 0);
    let mut oversized = AuthoringDocument::new_bedrock("Large", "large").unwrap();
    oversized.resolution.width = 512;
    let mut session = EditorSession::from_document(oversized).unwrap();
    assert_eq!(session.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "new.png".into(),
    }]).unwrap_err(), "PAINT_DIMENSIONS_UNSUPPORTED");
    assert!(session.document().texture_assets.is_empty());
}

#[test]
fn v5_0_preserves_extensions_texture_references_and_animation_bytes_semantically() {
    let mut input: Value = serde_json::from_str(SAMPLE).unwrap();
    input["vendor"] = json!({"preserve": [1, 2]});
    input["groups"][0]["bone_extension"] = json!("untouched");
    input["elements"][0]["element_extension"] = json!({"opaque": true});
    input["elements"][0]["rotation"] = json!([22.5, 0.0, -45.0]);
    input["elements"][0]["autouv"] = json!(0);
    input["elements"][0]["stretch"] = json!([1.25, 1.0, 0.75]);
    input["groups"][0]["rotation"] = json!([0, 10, 0]);
    input["elements"][0]["faces"]["north"]["face_extension"] = json!("unchanged");
    input["textures"] = json!([{
        "uuid":"texture-1","name":"texture.png","source":"data:image/png;base64,AAAA",
        "extension":{"persistent":true}
    }]);
    input["elements"][0]["faces"]["north"]["texture"] = json!(0);
    input["animations"] = json!([{"uuid":"clip-1","animators":{"bone": {"keyframes":[]}}}]);
    input["animation_controllers"] = json!([{"uuid":"controller-1","states":{}}]);
    let bytes = serde_json::to_vec(&input).unwrap();
    let mut session = EditorSession::open(&bytes).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let exported: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(exported["vendor"], input["vendor"]);
    assert_eq!(exported["groups"][0]["bone_extension"], input["groups"][0]["bone_extension"]);
    assert_eq!(exported["elements"][0]["element_extension"], input["elements"][0]["element_extension"]);
    assert_eq!(exported["elements"][0]["faces"], input["elements"][0]["faces"]);
    for key in ["from", "to", "origin"] {
        for i in 0..3 {
            let original = input["elements"][0][key][i].as_f64().unwrap();
            let translated = exported["elements"][0][key][i].as_f64().unwrap();
            assert_eq!(translated, original + if i == 0 { 1.0 } else { 0.0 });
        }
    }
    assert_eq!(exported["textures"], input["textures"]);
    assert_eq!(exported["animations"], input["animations"]);
    assert_eq!(exported["animation_controllers"], input["animation_controllers"]);
    assert_eq!(exported["outliner"], input["outliner"]);
}

#[test]
fn textured_fixture_preserves_references_paths_animation_and_hierarchy() {
    // Synthetic metadata fixture; its placeholder embedded image is not a
    // decodable PNG or a native Blockbench compatibility receipt.
    let input: Value = serde_json::from_str(TEXTURED).unwrap();
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let initial = session.document().clone();
    assert_eq!(initial.texture_assets.len(), 2);
    assert_eq!(initial.animation_assets.len(), 1);
    session.apply(0, &[
        EditOperation::SetCubeRotation {
            uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0],
        },
        EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: [2.0, 3.0, 6.0, 7.0],
        },
    ]).unwrap();
    let bytes = session.export().unwrap();
    let saved: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(saved["textures"], input["textures"]);
    assert_eq!(saved["texture_groups"], input["texture_groups"]);
    assert_eq!(saved["animations"], input["animations"]);
    assert_eq!(saved["animation_controllers"], input["animation_controllers"]);
    assert_eq!(saved["vendor_extension"], input["vendor_extension"]);
    assert_eq!(saved["outliner"], input["outliner"]);
    assert_eq!(saved["groups"], input["groups"]);
    assert_eq!(saved["elements"][0]["faces"]["south"], input["elements"][0]["faces"]["south"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(0));
    assert_eq!(saved["elements"][0]["faces"]["north"]["rotation"], json!(90));
    assert_eq!(saved["elements"][0]["faces"]["north"]["custom"],
        input["elements"][0]["faces"]["north"]["custom"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["uv"], json!([2.0, 3.0, 6.0, 7.0]));
    assert_eq!(saved["elements"][0]["rotation"], json!([0.0, 22.5, 0.0]));
    assert_eq!(saved["textures"][1]["relative_path"],
        json!("textures/entity/external.png"));
    let reopened = AuthoringDocument::import_bbmodel(&bytes).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &initial);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn textured_fixture_box_uv_mutation_preserves_null_face_and_asset_metadata() {
    let mut input: Value = serde_json::from_str(TEXTURED).unwrap();
    input["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&input).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [3.0, 5.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["textures"], input["textures"]);
    assert_eq!(saved["animations"], input["animations"]);
    assert_eq!(saved["texture_groups"], input["texture_groups"]);
    assert_eq!(saved["elements"][0]["faces"]["south"], input["elements"][0]["faces"]["south"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(0));
    assert_eq!(saved["elements"][0]["faces"]["north"]["uv"], json!([7.0, 9.0, 11.0, 13.0]));
    assert_eq!(saved["elements"][0]["uv_offset"], json!([3.0, 5.0]));
}
 
#[test]
fn new_bone_cube_uv_batch_roundtrip_and_history() {
    let mut initial = AuthoringDocument::new_bedrock("Example", "example").unwrap();
    // The manual face UV test deliberately opts out of the Box UV default.
    initial.meta.box_uv = Some(false);
    let mut session = EditorSession::from_document(initial.clone()).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "body", "origin": [0,0,0], "children": []
    })).unwrap();
    let operations = vec![
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [2.0, 1.0, -1.0] },
        EditOperation::SetFaceUv { uuid: CUBE.into(), face: "north".into(),
            uv: [1.0, 2.0, 5.0, 6.0] },
    ];
    let receipt = session.apply(0, &operations).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 4);
    assert_eq!(session.document().cubes[0].from, [2.0, 1.0, -1.0]);
    assert_eq!(session.document().cubes[0].origin, Some([2.0, 1.0, -1.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([1.0,2.0,5.0,6.0]));
    let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(&reimported, session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &initial);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reimported);
}


#[test]
fn new_bedrock_box_uv_default_and_initial_cube_face_rectangles() {
    let doc = AuthoringDocument::new_bedrock("Example", "example").unwrap();
    assert_eq!(doc.meta.box_uv, Some(true));
    let wire: Value = serde_json::from_slice(&doc.export_bbmodel().unwrap()).unwrap();
    assert_eq!(wire["meta"]["box_uv"], json!(true));
    let mut session = EditorSession::from_document(doc.clone()).unwrap();
    let bone: Bone = serde_json::from_value(json!({"uuid": BONE, "name": "body"})).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
    ]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["north"]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
    assert_eq!(cube.faces["east"]["uv"], json!([0.0, 4.0, 4.0, 8.0]));
    assert_eq!(cube.faces["up"]["uv"], json!([8.0, 4.0, 4.0, 0.0]));
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &doc);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn explicit_face_uv_new_project_remains_editable() {
    let mut doc = AuthoringDocument::new_bedrock("Face UV", "face_uv").unwrap();
    doc.meta.box_uv = Some(false);
    let mut session = EditorSession::from_document(doc).unwrap();
    let bone: Bone = serde_json::from_value(json!({"uuid": BONE, "name": "body"})).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
        EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: [3.0, 4.0, 7.0, 8.0],
        },
    ]).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([3.0, 4.0, 7.0, 8.0]));
}

#[test]
fn malformed_multifile_ruleset_refuses_auto_uv_remap_atomically() {
    for invalid in [json!(false), json!(null), json!(0), json!({})] {
        let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
        wire["multi_file_ruleset"] = invalid;
        wire["elements"][0]["autouv"] = json!(2);
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
}

#[test]
fn stale_and_partial_failures_leave_state_unchanged() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    let move_cube = EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] };
    assert_eq!(session.apply(1, &[move_cube.clone()]).unwrap_err(), "DOCUMENT_REVISION_STALE");
    assert_eq!(session.apply(0, &[
        move_cube,
        EditOperation::SetCubeBounds { uuid: "missing".into(),
            from: [0.0, 0.0, 0.0], to: [1.0, 1.0, 1.0] }
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn invalid_version_element_or_outliner_fails_closed() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["meta"]["format_version"] = json!("5.1");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "BBMODEL_VERSION_OR_FORMAT_UNSUPPORTED");
    value["meta"]["format_version"] = json!("5.0");
    value["elements"][0]["type"] = json!("mesh");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "ELEMENT_TYPE_UNSUPPORTED");
    value["elements"][0]["type"] = json!("cube");
    value["outliner"][0]["children"] = json!(["unknown"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "OUTLINER_CUBE_REFERENCE_INVALID");
    value["outliner"][0]["children"] = json!([CUBE]);
    value["groups"][0]["uuid"] = json!(CUBE);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "DUPLICATE_UUID");
}

#[test]
fn blockbench_uuid_face_texture_refs_roundtrip_through_rust_edit_and_history() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let texture_uuid = wire["textures"][0]["uuid"].as_str().unwrap().to_owned();
    wire["elements"][0]["faces"]["north"]["texture"] = json!(texture_uuid);
    wire["elements"][0]["faces"]["east"]["texture"] = json!(texture_uuid);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [2.0, 2.0, 6.0, 6.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(texture_uuid));
    assert_eq!(saved["elements"][0]["faces"]["east"]["texture"], json!(texture_uuid));
    assert_eq!(saved["elements"][0]["faces"]["south"]["texture"], Value::Null);
    assert_eq!(saved["textures"], wire["textures"]);
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["texture"], json!(texture_uuid));
}

#[test]
fn duplicate_texture_uuids_reject_ambiguous_face_references() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    let original_uuid = model["textures"][0]["uuid"].clone();
    model["textures"][1]["uuid"] = original_uuid.clone();
    model["elements"][0]["faces"]["north"]["texture"] = original_uuid;
    let bytes = serde_json::to_vec(&model).unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&bytes).unwrap_err(),
        "TEXTURE_UUID_DUPLICATE");
}

#[test]
fn malformed_texture_uuid_refuses_import_without_normalization() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    model["textures"][0]["uuid"] = json!(42);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "TEXTURE_UUID_INVALID");
    model["textures"][0]["uuid"] = json!("");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "TEXTURE_UUID_INVALID");
}

#[test]
fn optional_texture_uuids_preserve_legacy_indexed_assets() {
    let mut model: Value = serde_json::from_str(TEXTURED).unwrap();
    model["textures"][0].as_object_mut().unwrap().remove("uuid");
    let saved = AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap();
    assert_eq!(saved.texture_assets[0].get("uuid"), None);
    let again = AuthoringDocument::import_bbmodel(&saved.export_bbmodel().unwrap()).unwrap();
    assert_eq!(again, saved);
}

#[test]
fn unresolved_uuid_face_texture_is_refused_without_rewriting_assets() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["elements"][0]["faces"]["north"]["texture"] =
        json!("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&wire).unwrap()).unwrap_err(),
        "CUBE_FACE_TEXTURE_UNSUPPORTED");
}

#[test]
fn auto_uv_resolves_uuid_texture_wrap_metadata_before_mutating() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let texture_uuid = wire["textures"][0]["uuid"].as_str().unwrap().to_owned();
    wire["elements"][0]["faces"]["north"]["texture"] = json!(texture_uuid);
    wire["elements"][0]["autouv"] = json!(1);
    wire["textures"][0]["wrap_mode"] = json!("unsupported-unknown-wrap");
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap_err(), "CUBE_AUTO_UV_WRAP_MODE_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn cube_inflate_and_stretch_validate_and_preserve_opaque_format_fields() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["inflate"] = json!(1.25);
    wire["elements"][0]["stretch"] = json!([2.0, 0.5, 1.5]);
    let original = AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap();
    let mut session = EditorSession::from_document(original.clone()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["inflate"], json!(1.25));
    assert_eq!(saved["elements"][0]["stretch"], json!([2.0, 0.5, 1.5]));
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra["stretch"], json!([2.0, 0.5, 1.5]));
}

#[test]
fn invalid_cube_inflate_and_stretch_refuse_import() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["inflate"] = json!("not a number");
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_INFLATE_INVALID");
    wire["elements"][0]["inflate"] = json!(1.0);
    wire["elements"][0]["stretch"] = json!([1.0, 2.0]);
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_STRETCH_INVALID");
    wire["elements"][0]["stretch"] = json!([1.0, "invalid", 1.0]);
    assert_eq!(AuthoringDocument::import_bbmodel(
        &serde_json::to_vec(&wire).unwrap()).unwrap_err(), "CUBE_STRETCH_INVALID");
}

#[test]
fn texture_index_must_be_valid_for_blockbench() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["elements"][0]["faces"]["north"]["texture"] = json!(9);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&value).unwrap()).unwrap_err(),
        "CUBE_FACE_TEXTURE_UNSUPPORTED");
}

#[test]
fn box_uv_projects_refuse_inert_per_face_uv_edits() {
    let mut value: Value = serde_json::from_str(SAMPLE).unwrap();
    value["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [2.0, 2.0, 6.0, 6.0]
    }]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(session.summary().revision, 0);
}


#[test]
fn authored_cube_rotation_round_trip_preserves_opaque_asset_fields_and_undo() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["textures"] = json!([{
        "uuid":"embedded-texture",
        "name":"body.png",
        "source":"data:image/png;base64,AAAA",
        "extension": {"keep": [1, 2, 3]}
    }]);
    model["elements"][0]["faces"]["north"]["texture"] = json!(0);
    model["animations"] = json!([{
        "uuid":"idle-clip", "name":"idle",
        "animators": {BONE: {"keyframes": []}}
    }]);
    model["animation_controllers"] = json!([{"uuid":"controller","states": {"idle":{}}}]);
    let bytes = serde_json::to_vec(&model).unwrap();
    let mut session = EditorSession::open(&bytes).unwrap();
    let receipt = session.apply(0, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [22.5, -15.0, 0.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["elements"][0]["rotation"], json!([22.5, -15.0, 0.0]));
    assert_eq!(saved["textures"], model["textures"]);
    assert_eq!(saved["animations"], model["animations"]);
    assert_eq!(saved["animation_controllers"], model["animation_controllers"]);
    assert_eq!(saved["groups"], model["groups"]);
    assert_eq!(saved["outliner"], model["outliner"]);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert!(session.document().cubes[0].extra.get("rotation").is_none());
    session.redo(2).unwrap();
    assert_eq!(*session.document(), reopened);
    session.apply(3, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap();
    assert!(session.document().cubes[0].extra.get("rotation").is_none());
}


#[test]
fn auto_uv_relative_move_remaps_all_six_faces_and_preserves_roundtrip() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    model["elements"][0]["faces"]["north"]["texture"] = json!(false);
    model["vendor"] = json!({"keep": [1, 2]});
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["north"]["uv"], json!([115.0, 124.0, 119.0, 128.0]));
    assert_eq!(cube.faces["south"]["uv"], json!([9.0, 124.0, 13.0, 128.0]));
    assert_eq!(cube.faces["east"]["uv"], json!([116.0, 124.0, 120.0, 128.0]));
    assert_eq!(cube.faces["west"]["uv"], json!([8.0, 124.0, 12.0, 128.0]));
    assert_eq!(cube.faces["up"]["uv"], json!([9.0, 8.0, 13.0, 12.0]));
    assert_eq!(cube.faces["down"]["uv"], json!([9.0, 116.0, 13.0, 120.0]));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["vendor"], model["vendor"]);
    assert_eq!(saved["elements"][0]["faces"]["north"]["texture"], json!(false));
    let again = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(again, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document().cubes[0].from, [0.0, 0.0, 0.0]);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &again);
}

#[test]
fn auto_uv_size_mode_remaps_resized_face_and_rotated_face() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(1);
    model["elements"][0]["faces"]["north"]["rotation"] = json!(90);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [6.0, 4.0, 4.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([0.0, 0.0, 4.0, 6.0]));
    assert_eq!(session.document().cubes[0].faces["south"]["uv"], json!([0.0, 0.0, 6.0, 4.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["rotation"], json!(90));
}


#[test]
fn box_uv_offset_edits_are_atomic_and_preserve_opaque_assets() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["meta"]["box_uv"] = json!(true);
    wire["vendor"] = json!({"keep": [1, 2]});
    wire["elements"][0]["faces"]["north"]["annotation"] = json!("preserve");
    wire["elements"][0]["faces"]["south"]["texture"] = Value::Null;
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let previous = session.document().clone();
    session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [2.0, 3.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.uv_offset, Some([2.0, 3.0]));
    assert_eq!(cube.faces["north"]["uv"], json!([6.0, 7.0, 10.0, 11.0]));
    assert_eq!(cube.faces["south"]["uv"], previous.cubes[0].faces["south"]["uv"]);
    assert_eq!(cube.faces["north"]["annotation"], json!("preserve"));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["vendor"], wire["vendor"]);
    let again = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(again, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &previous);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &again);
    session.apply(3, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [0.0, 0.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, None);
}

#[test]
fn box_uv_offset_rejects_invalid_mode_input_and_noop_without_revision() {
    let mut face_session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    assert_eq!(face_session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [1.0, 2.0],
    }]).unwrap_err(), "BOX_UV_MODE_REQUIRED");
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    for offset in [[f64::NAN, 0.0], [0.5, 2.0], [100_001.0, 0.0]] {
        assert_eq!(session.apply(0, &[EditOperation::SetBoxUvOffset {
            uuid: CUBE.into(), offset,
        }]).unwrap_err(), "BOX_UV_OFFSET_INVALID");
    }
    assert_eq!(session.apply(0, &[EditOperation::SetBoxUvOffset {
        uuid: CUBE.into(), offset: [0.0, 0.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert_eq!(session.apply(0, &[
        EditOperation::SetBoxUvOffset { uuid: CUBE.into(), offset: [1.0, 1.0] },
        EditOperation::SetFaceUv { uuid: CUBE.into(), face: "north".into(),
            uv: [0.0, 0.0, 4.0, 4.0] },
    ]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(session.document(), &original);
}

#[test]
fn box_uv_single_edge_resize_updates_offset_and_derived_faces() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [4.0, 4.0, 6.0],
    }]).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, Some([-2.0, -2.0]));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
    assert_eq!(session.document().cubes[0].faces["east"]["uv"], json!([-2.0, 4.0, 4.0, 8.0]));
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document().cubes[0].uv_offset, None);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    session.apply(3, &[
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [2.0, 0.0, 0.0] },
        EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0] },
    ]).unwrap();
    assert_eq!(session.document().cubes[0].from, [2.0, 0.0, 0.0]);
    assert_eq!(session.document().cubes[0].extra["rotation"], json!([0.0, 22.5, 0.0]));
}

#[test]
fn auto_uv_mode_two_clamps_to_project_uv_resolution() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    session.apply(0, &[EditOperation::TranslateCube {
        uuid: CUBE.into(), delta: [200.0, 0.0, 0.0],
    }]).unwrap();
    let cube = &session.document().cubes[0];
    assert_eq!(cube.faces["south"]["uv"], json!([124.0, 124.0, 128.0, 128.0]));
    assert_eq!(cube.faces["north"]["uv"], json!([0.0, 124.0, 4.0, 128.0]));
}

#[test]
fn uv_sensitive_ambiguous_resize_and_multifile_rules_fail_atomically() {
    for mode in [1, 2] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(mode);
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [6.0, 5.0, 4.0],
        }]).unwrap_err(), "CUBE_AUTO_UV_REMAP_REQUIRED");
        assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "invalid".into(), uv: [1.0, 1.0, 5.0, 5.0],
        }]).unwrap_err(), "FACE_UV_INVALID");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
        model["multi_file_ruleset"] = json!("texture_set");
        let mut multifile = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        assert_eq!(multifile.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(multifile.summary().revision, 0);
    }
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["meta"]["box_uv"] = json!(true);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
        uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 5.0, 4.0],
    }]).unwrap_err(), "CUBE_BOX_UV_RESIZE_UNSUPPORTED");
    assert_eq!(session.document(), &original);
}

#[test]
fn uv_sensitive_invalid_face_rotation_fails_without_partial_batch() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(1);
    model["elements"][0]["faces"]["north"]["rotation"] = json!(45);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::SetCubeRotation { uuid: CUBE.into(), rotation: [0.0, 22.5, 0.0] },
        EditOperation::TranslateCube { uuid: CUBE.into(), delta: [1.0, 0.0, 0.0] },
    ]).unwrap_err(), "CUBE_AUTO_UV_FACE_ROTATION_UNSUPPORTED");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}


// Source-authored regression for the shared CLI/Tauri EditOperation only.
#[test]
fn manual_uv_face_rotation_matches_saved_default_and_preserves_assets_and_history() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["autouv"] = json!(2);
    wire["elements"][0]["faces"]["north"]["custom"] = json!({"retain":true});
    wire["vendor"] = json!({"untouched":"yes"});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let original_uv = original.cubes[0].faces["north"]["uv"].clone();
    let receipt = session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().cubes[0].faces["north"]["rotation"], json!(90));
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], original_uv);
    assert_eq!(session.document().cubes[0].faces["north"]["custom"], json!({"retain":true}));
    assert_eq!(session.document().cubes[0].faces["east"], original.cubes[0].faces["east"]);
    assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let saved = session.export().unwrap();
    let parsed: Value = serde_json::from_slice(&saved).unwrap();
    assert_eq!(parsed["vendor"], wire["vendor"]);
    assert_eq!(parsed["elements"][0]["faces"]["north"]["rotation"], json!(90));
    let reopened = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    for (revision, rotation) in [(3, 180), (4, 270), (5, 0)] {
        session.apply(revision, &[EditOperation::SetFaceUvRotation {
            uuid: CUBE.into(), face: "north".into(), rotation,
        }]).unwrap();
    }
    assert!(session.document().cubes[0].faces["north"].get("rotation").is_none());
    assert_eq!(session.document().cubes[0].faces["north"]["uv"], original_uv);
    assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
    assert_eq!(session.apply(6, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 0,
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 6);
}

#[test]
fn manual_uv_face_rotation_refuses_invalid_box_and_opaque_values_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    for rotation in [1, 45, 360, u16::MAX] {
        assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
            uuid: CUBE.into(), face: "north".into(), rotation,
        }]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    }
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "upside".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: "missing".into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.apply(0, &[
        EditOperation::SetFaceUvRotation { uuid: CUBE.into(), face: "north".into(), rotation: 90 },
        EditOperation::SetFaceUvRotation { uuid: CUBE.into(), face: "north".into(), rotation: 45 },
    ]).unwrap_err(), "FACE_UV_ROTATION_INVALID");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);

    let mut box_wire: Value = serde_json::from_str(SAMPLE).unwrap();
    box_wire["meta"]["box_uv"] = json!(true);
    let mut box_session = EditorSession::open(&serde_json::to_vec(&box_wire).unwrap()).unwrap();
    let box_original = box_session.document().clone();
    assert_eq!(box_session.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_BOX_MODE_UNSUPPORTED");
    assert_eq!(box_session.document(), &box_original);

    let mut opaque_wire: Value = serde_json::from_str(SAMPLE).unwrap();
    opaque_wire["elements"][0]["faces"]["north"]["rotation"] = json!(45);
    let mut opaque = EditorSession::open(&serde_json::to_vec(&opaque_wire).unwrap()).unwrap();
    let opaque_original = opaque.document().clone();
    assert_eq!(opaque.apply(0, &[EditOperation::SetFaceUvRotation {
        uuid: CUBE.into(), face: "north".into(), rotation: 90,
    }]).unwrap_err(), "FACE_UV_ROTATION_UNSUPPORTED");
    assert_eq!(opaque.document(), &opaque_original);
    assert_eq!(opaque.summary().revision, 0);
}

// Source-authored refusal: scoped texture assignment is not a global
// Cube-face UUID rewrite in Blockbench's multi-file attachable mode.
#[test]
fn scoped_project_refuses_global_cube_texture_assignment_without_changes() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["multi_file_ruleset"] = json!("bedrock_attachable");
    wire["elements"][0]["scope"] = json!(2);
    let texture_id = "00000000-0000-4000-8000-000000000901";
    wire["textures"] = json!([{
        "uuid":texture_id, "scope":2, "name":"scope.png"
    }]);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    assert!(has_per_texture_uv_rules(session.document()));
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: CUBE.into(), texture_uuid: texture_id.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_RULESET_UNSUPPORTED");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        original);
}

#[test]
fn manual_face_uv_edit_disables_auto_uv_and_preserves_opaque_fields() {
    for mode in [1, 2] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(mode);
        model["elements"][0]["faces"]["north"]["custom"] = json!({"keep": true});
        model["vendor"] = json!({"preserve": "yes"});
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        let edited_uv = [2.0, 3.0, 7.0, 9.0];
        let receipt = session.apply(0, &[EditOperation::SetFaceUv {
            uuid: CUBE.into(), face: "north".into(), uv: edited_uv,
        }]).unwrap();
        assert_eq!(receipt.revision, 1);
        assert_eq!(session.document().cubes[0].extra["autouv"], json!(0));
        assert_eq!(session.document().cubes[0].faces["north"]["uv"], json!(edited_uv));
        assert_eq!(session.document().cubes[0].faces["north"]["custom"], json!({"keep": true}));
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        assert_eq!(saved["vendor"], model["vendor"]);
        assert_eq!(saved["elements"][0]["autouv"], json!(0));
        let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
        assert_eq!(reimported, *session.document());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &original);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &reimported);
    }
}

#[test]
fn manual_face_uv_noop_keeps_auto_uv_and_revision_unchanged() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetFaceUv {
        uuid: CUBE.into(), face: "north".into(), uv: [0.0, 0.0, 4.0, 4.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}


#[test]
fn explicitly_declared_per_texture_uv_rules_refuse_auto_remap_atomically() {
    for location in ["meta", "project"] {
        let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
        model["elements"][0]["autouv"] = json!(2);
        if location == "meta" {
            model["meta"]["per_texture_uv_size"] = json!(true);
        } else {
            model["per_texture_uv_size"] = json!(true);
        }
        let mut session = EditorSession::open(&serde_json::to_vec(&model).unwrap()).unwrap();
        let original = session.document().clone();
        assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
            uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
        }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        if location == "meta" {
            assert_eq!(saved["meta"]["per_texture_uv_size"], json!(true));
        } else {
            assert_eq!(saved["per_texture_uv_size"], json!(true));
        }
    }
}

#[test]
fn malformed_rotation_and_auto_uv_fields_reject_import_without_silent_coercion() {
    let mut model: Value = serde_json::from_str(SAMPLE).unwrap();
    model["elements"][0]["rotation"] = json!("90");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "ROTATION_FORMAT_INVALID");
    model["elements"][0]["rotation"] = json!([0, 0, 0]);
    model["groups"][0]["rotation"] = json!([0, 0]);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "ROTATION_FORMAT_INVALID");
    model["groups"][0]["rotation"] = json!([0, 0, 0]);
    model["elements"][0]["autouv"] = json!(3);
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "CUBE_AUTO_UV_MODE_UNSUPPORTED");
    model["elements"][0]["autouv"] = json!(0);
    model["elements"][0]["box_uv"] = json!("yes");
    assert_eq!(AuthoringDocument::import_bbmodel(&serde_json::to_vec(&model).unwrap()).unwrap_err(),
        "CUBE_BOX_UV_FLAG_INVALID");
}

#[test]
fn invalid_rotation_edits_reject_and_keep_revision_stable() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetCubeRotation {
        uuid: CUBE.into(), rotation: [0.0, f64::NAN, 0.0],
    }]).unwrap_err(), "CUBE_ROTATION_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn cube_visibility_changes_only_the_target_and_roundtrips() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::SetNodeVisibility {
        uuid: CUBE.into(), visible: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    let source: Value = serde_json::from_str(TEXTURED).unwrap();
    assert_eq!(saved["elements"][0]["visibility"], json!(false));
    assert_eq!(saved["textures"], source["textures"]);
    assert_eq!(saved["animations"], source["animations"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    assert_eq!(session.apply(1, &[EditOperation::SetNodeVisibility {
        uuid: CUBE.into(), visible: false,
    }]).unwrap_err(), "EDIT_NO_OP");
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
}

#[test]
fn nested_group_visibility_updates_descendants_not_siblings_and_refuses_atomic_failures() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    let sibling = "00000000-0000-4000-8000-000000000004";
    let nested = "00000000-0000-4000-8000-000000000003";
    let mut sibling_cube = wire["elements"][0].clone();
    sibling_cube["uuid"] = json!(sibling);
    wire["elements"].as_array_mut().unwrap().push(sibling_cube);
    wire["outliner"][0]["children"].as_array_mut().unwrap().push(json!(sibling));
    wire["groups"][1]["vendor_visibility_extension"] = json!({"retain": true});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::SetNodeVisibility {
        uuid: nested.into(), visible: false,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().bones[1].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().bones[0].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    assert_eq!(session.document().cubes[1].extra.get("visibility"), None);
    assert_eq!(session.document().bones[1].extra.get("vendor_visibility_extension"),
        Some(&json!({"retain":true})));
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["textures"], wire["textures"]);
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(saved["outliner"], wire["outliner"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().cubes[0].extra.get("visibility"), Some(&json!(false)));
    session.apply(3, &[EditOperation::SetNodeVisibility {
        uuid: nested.into(), visible: true,
    }]).unwrap();
    assert_eq!(session.document().bones[1].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[0].extra.get("visibility"), None);
    assert_eq!(session.document().cubes[1].extra.get("visibility"), None);
    let before = session.document().clone();
    assert_eq!(session.apply(4, &[
        EditOperation::SetNodeVisibility { uuid: nested.into(), visible: false },
        EditOperation::SetNodeVisibility { uuid: "unknown".into(), visible: false },
    ]).unwrap_err(), "VISIBILITY_TARGET_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 4);
}

#[test]
fn cube_render_order_preserves_pinned_values_through_edit_export_and_history() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    for order in ["default", "behind", "in_front"] {
        wire["elements"][0]["render_order"] = json!(order);
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        let original = session.document().clone();
        session.apply(0, &[EditOperation::SetNodeVisibility {
            uuid: CUBE.into(), visible: false,
        }]).unwrap();
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        assert_eq!(saved["elements"][0]["render_order"], json!(order));
        assert_eq!(saved["textures"], wire["textures"]);
        assert_eq!(saved["animations"], wire["animations"]);
        assert_eq!(saved["outliner"], wire["outliner"]);
        let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
        assert_eq!(reopened, *session.document());
        session.undo(1).unwrap();
        assert_eq!(session.document(), &original);
        session.redo(2).unwrap();
        assert_eq!(session.document(), &reopened);
    }
}

#[test]
fn invalid_cube_render_order_is_refused_without_coercing_imported_data() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    for invalid in [json!("overlay"), json!(2), Value::Null, json!(false)] {
        wire["elements"][0]["render_order"] = invalid;
        assert_eq!(
            AuthoringDocument::import_bbmodel(&serde_json::to_vec(&wire).unwrap()).unwrap_err(),
            "CUBE_RENDER_ORDER_INVALID"
        );
    }
}

#[test]
fn ambiguous_per_texture_uv_flags_refuse_remap_and_preserve_source() {
    for location in ["meta", "project"] {
        for flag in [json!("true"), json!(1), Value::Null, json!({"unknown":true})] {
            let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
            wire["elements"][0]["autouv"] = json!(2);
            if location == "meta" {
                wire["meta"]["per_texture_uv_size"] = flag.clone();
            } else {
                wire["per_texture_uv_size"] = flag.clone();
            }
            let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
            let initial = session.document().clone();
            assert!(has_per_texture_uv_rules(session.document()));
            assert_eq!(session.apply(0, &[EditOperation::TranslateCube {
                uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
            }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
            assert_eq!(session.apply(0, &[EditOperation::SetCubeBounds {
                uuid: CUBE.into(), from: [0.0, 0.0, 0.0], to: [5.0, 4.0, 4.0],
            }]).unwrap_err(), "CUBE_UV_TEXTURE_RULESET_UNSUPPORTED");
            assert_eq!(session.document(), &initial);
            assert_eq!(session.summary().revision, 0);
            let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
            let actual = if location == "meta" {
                &saved["meta"]["per_texture_uv_size"]
            } else {
                &saved["per_texture_uv_size"]
            };
            assert_eq!(actual, &flag);
            assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
                initial);
        }
    }
}

#[test]
fn explicit_false_per_texture_uv_flags_leave_project_resolution_enabled() {
    for location in ["meta", "project"] {
        let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
        wire["elements"][0]["autouv"] = json!(2);
        if location == "meta" {
            wire["meta"]["per_texture_uv_size"] = json!(false);
        } else {
            wire["per_texture_uv_size"] = json!(false);
        }
        let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
        assert!(!has_per_texture_uv_rules(session.document()));
        let receipt = session.apply(0, &[EditOperation::TranslateCube {
            uuid: CUBE.into(), delta: [1.0, 0.0, 0.0],
        }]).unwrap();
        assert_eq!(receipt.revision, 1);
        let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
        let retained = if location == "meta" {
            &saved["meta"]["per_texture_uv_size"]
        } else {
            &saved["per_texture_uv_size"]
        };
        assert_eq!(retained, &json!(false));
        assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
            *session.document());
    }
}

#[test]
fn outliner_structure_creation_removal_and_history_are_one_rust_authority() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Hierarchy", "hierarchy").unwrap()
    ).unwrap();
    let root: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0,0,0]
    })).unwrap();
    let child_id = "00000000-0000-4000-8000-000000000003";
    let child: Bone = serde_json::from_value(json!({
        "uuid": child_id, "name": "nested", "origin": [0,2,0]
    })).unwrap();
    let receipt = session.apply(0, &[
        EditOperation::AddBone { bone: root, parent_uuid: None },
        EditOperation::AddBone { bone: child, parent_uuid: Some(BONE.into()) },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: child_id.into() },
    ]).unwrap();
    assert_eq!(receipt.operation_count, 3);
    assert_eq!(session.document().cubes.len(), 1);
    assert_eq!(session.document().bones.len(), 2);
    let before_removal = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::RemoveEmptyBone {
        uuid: child_id.into(),
    }]).unwrap_err(), "BONE_NOT_EMPTY");
    assert_eq!(session.document(), &before_removal);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::RemoveCube { uuid: CUBE.into() }]).unwrap();
    assert!(session.document().cubes.is_empty());
    assert!(matches!(&session.document().hierarchy[0], OutlinerNode::Bone(group)
        if matches!(&group.children[0], OutlinerNode::Bone(child) if child.children.is_empty())));
    let after_cube_removal = session.document().clone();
    session.apply(2, &[EditOperation::RemoveEmptyBone { uuid: child_id.into() }]).unwrap();
    assert_eq!(session.document().bones.len(), 1);
    let reimported = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reimported, *session.document());
    session.undo(3).unwrap();
    assert_eq!(session.document(), &after_cube_removal);
    session.undo(4).unwrap();
    assert_eq!(session.document(), &before_removal);
    session.redo(5).unwrap();
    session.redo(6).unwrap();
    assert_eq!(session.document(), &reimported);
    assert_eq!(session.apply(7, &[EditOperation::RemoveCube {
        uuid: "absent".into(),
    }]).unwrap_err(), "CUBE_NOT_FOUND");
}

#[test]
fn deleting_referenced_elements_refuses_without_mutating_opaque_assets() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["vendor_extension"]["linked_cube"] = json!(CUBE);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::RemoveCube {
        uuid: CUBE.into(),
    }]).unwrap_err(), "ELEMENT_OPAQUE_REFERENCES");
    assert_eq!(session.document(), &original);
    // The nested bone is referenced by the imported animation payload.
    assert_eq!(session.apply(0, &[
        EditOperation::RemoveCube { uuid: "unknown".into() },
        EditOperation::RemoveEmptyBone { uuid: "00000000-0000-4000-8000-000000000003".into() },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
    let saved: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    assert_eq!(saved["animations"], wire["animations"]);
    assert_eq!(saved["vendor_extension"], wire["vendor_extension"]);
}

#[test]
fn deleting_one_cube_in_a_batch_rolls_back_if_later_operation_fails() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::RemoveCube { uuid: CUBE.into() },
        EditOperation::RemoveCube { uuid: CUBE.into() },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn new_animation_and_bone_rotation_keyframe_edit_preserve_document_roundtrip() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let id = "00000000-0000-4000-8000-000000000320";
    let key = "00000000-0000-4000-8000-000000000321";
    let bone = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: id.into(), name: "animation.new".into(), length: 1.5,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: id.into(), bone_uuid: bone.into(), keyframe_uuid: key.into(),
            time: 0.5, rotation: [0.0, 45.0, -15.0],
        }
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(session.document().animation_assets.len(), original.animation_assets.len() + 1);
    assert_eq!(session.document().animation_assets[0], original.animation_assets[0]);
    let new = session.document().animation_assets.last().unwrap();
    assert_eq!(new["uuid"], json!(id));
    assert_eq!(new["animators"][bone]["keyframes"][0]["channel"], json!("rotation"));
    assert_eq!(new["animators"][bone]["keyframes"][0]["data_points"][0]["y"], json!("45"));
    let exported = session.export().unwrap();
    let saved: Value = serde_json::from_slice(&exported).unwrap();
    let source: Value = serde_json::from_str(TEXTURED).unwrap();
    assert_eq!(saved["textures"], source["textures"]);
    assert_eq!(saved["animation_controllers"], source["animation_controllers"]);
    assert_eq!(saved["outliner"], source["outliner"]);
    let reopened = AuthoringDocument::import_bbmodel(&exported).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn animation_edits_refuse_invalid_targets_and_duplicate_rotation_frames_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let key = "00000000-0000-4000-8000-000000000321";
    session.apply(0, &[EditOperation::CreateAnimation {
        uuid: anim.into(), name: "animation.new".into(), length: 1.0,
    }]).unwrap();
    let initial = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::CreateAnimation {
        uuid: "00000000-0000-4000-8000-000000000399".into(),
        name: "animation.new".into(), length: 1.0,
    }]).unwrap_err(), "ANIMATION_CREATION_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: "missing".into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap_err(), "ANIMATION_BONE_NOT_FOUND");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 2.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_TIME_INVALID");
    assert_eq!(session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [f64::NAN, 0.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_INVALID");
    assert_eq!(session.document(), &initial);
    assert_eq!(session.summary().revision, 1);
    session.apply(1, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.0, rotation: [0.0, 5.0, 0.0],
    }]).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(2, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: "00000000-0000-4000-8000-000000000322".into(),
        time: 0.0, rotation: [0.0, 90.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CONFLICT");
    assert_eq!(session.apply(2, &[EditOperation::AddBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: key.into(), time: 0.5, rotation: [0.0, 90.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 2);
}

#[test]
fn bone_rotation_edit_preserves_nested_outliner_opaque_assets_and_history() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let bone_uuid = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: bone_uuid.into(), rotation: [0.0, 22.5, -10.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().bones[1].extra["rotation"], json!([0.0, 22.5, -10.0]));
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let saved = session.export().unwrap();
    let reopened = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
    session.apply(3, &[EditOperation::SetBoneRotation {
        uuid: bone_uuid.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap();
    assert_eq!(session.document().bones[1].extra.get("rotation"), None);
    assert_eq!(session.document().animation_assets, original.animation_assets);
}

#[test]
fn invalid_or_noop_bone_rotation_does_not_consume_a_revision() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: BONE.into(), rotation: [f64::NAN, 0.0, 0.0],
    }]).unwrap_err(), "BONE_ROTATION_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: "missing".into(), rotation: [0.0, 45.0, 0.0],
    }]).unwrap_err(), "BONE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::SetBoneRotation {
        uuid: BONE.into(), rotation: [0.0, 0.0, 0.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn editing_and_removing_known_rotation_frames_is_atomic_and_undoable() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let a = "00000000-0000-4000-8000-000000000321";
    let b = "00000000-0000-4000-8000-000000000322";
    session.apply(0, &[
        EditOperation::CreateAnimation {
            uuid: anim.into(), name: "animation.new".into(), length: 2.0,
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: a.into(), time: 0.0, rotation: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: b.into(), time: 1.0, rotation: [0.0, 90.0, 0.0],
        },
    ]).unwrap();
    let before = session.document().clone();
    session.apply(1, &[EditOperation::UpdateBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: b.into(), time: 1.5, rotation: [0.0, 45.0, -15.0],
    }]).unwrap();
    let frames = &session.document().animation_assets[0]["animators"][BONE]["keyframes"];
    assert_eq!(frames[1]["time"], json!(1.5));
    assert_eq!(frames[1]["data_points"][0]["y"], json!("45"));
    let updated = session.document().clone();
    session.apply(2, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: a.into(),
    }]).unwrap();
    assert_eq!(session.document().animation_assets[0]["animators"][BONE]["keyframes"].as_array().unwrap().len(), 1);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(3).unwrap();
    assert_eq!(session.document(), &updated);
    session.undo(4).unwrap();
    assert_eq!(session.document(), &before);
    session.redo(5).unwrap();
    session.redo(6).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn updating_unsupported_or_conflicting_frames_refuses_without_partial_changes() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let anim = "00000000-0000-4000-8000-000000000320";
    let a = "00000000-0000-4000-8000-000000000321";
    let b = "00000000-0000-4000-8000-000000000322";
    session.apply(0, &[
        EditOperation::CreateAnimation { uuid: anim.into(), name: "animation.new".into(), length: 2.0 },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: a.into(), time: 0.0, rotation: [0.0, 0.0, 0.0],
        },
        EditOperation::AddBoneRotationKeyframe {
            animation_uuid: anim.into(), bone_uuid: BONE.into(),
            keyframe_uuid: b.into(), time: 1.0, rotation: [0.0, 90.0, 0.0],
        },
    ]).unwrap();
    let original = session.document().clone();
    assert_eq!(session.apply(1, &[EditOperation::UpdateBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(),
        keyframe_uuid: a.into(), time: 1.0, rotation: [0.0, 15.0, 0.0],
    }]).unwrap_err(), "ANIMATION_KEYFRAME_CONFLICT");
    assert_eq!(session.apply(1, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: "unknown".into(),
    }]).unwrap_err(), "ANIMATION_KEYFRAME_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 1);
    let wire: Value = serde_json::from_slice(&session.export().unwrap()).unwrap();
    let mut edited_wire = wire.clone();
    edited_wire["animations"][0]["animators"][BONE]["keyframes"][0]["interpolation"] = json!("bezier");
    let mut imported = EditorSession::open(&serde_json::to_vec(&edited_wire).unwrap()).unwrap();
    let original_advanced = imported.document().clone();
    assert_eq!(imported.apply(0, &[EditOperation::RemoveBoneRotationKeyframe {
        animation_uuid: anim.into(), bone_uuid: BONE.into(), keyframe_uuid: a.into(),
    }]).unwrap_err(), "ANIMATION_KEYFRAME_UNSUPPORTED");
    assert_eq!(imported.document(), &original_advanced);
}

#[test]
fn duplicate_cube_preserves_imported_geometry_faces_and_outliner_order_with_history() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let clone = "00000000-0000-4000-8000-000000000005";
    let receipt = session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: clone.into(),
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.changed_uuids, vec![clone.to_string()]);
    assert_eq!(session.document().cubes.len(), 2);
    let copied = &session.document().cubes[1];
    assert_eq!(copied.uuid, clone);
    let mut original_copy = original.cubes[0].clone();
    original_copy.uuid = clone.into();
    assert_eq!(*copied, original_copy);
    assert_eq!(session.document().cubes[0], original.cubes[0]);
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    let nested = match &session.document().hierarchy[0] {
        OutlinerNode::Bone(root) => match &root.children[0] {
            OutlinerNode::Bone(child) => child,
            _ => panic!("missing nested bone"),
        },
        _ => panic!("missing root bone"),
    };
    assert!(matches!(&nested.children[..], [OutlinerNode::Cube(source), OutlinerNode::Cube(duplicate)]
        if source.as_str() == CUBE && duplicate.as_str() == clone));
    let exported = session.export().unwrap();
    let imported = AuthoringDocument::import_bbmodel(&exported).unwrap();
    assert_eq!(imported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &imported);
}

#[test]
fn duplicate_cube_rejects_missing_or_colliding_ids_and_atomic_bad_batches() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    let new_uuid = "00000000-0000-4000-8000-000000000005";
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: "missing".into(), new_uuid: new_uuid.into(),
    }]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: CUBE.into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(), new_uuid: BONE.into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.apply(0, &[
        EditOperation::DuplicateCube {
            source_uuid: CUBE.into(), new_uuid: new_uuid.into(),
        },
        EditOperation::DuplicateCube {
            source_uuid: CUBE.into(), new_uuid: new_uuid.into(),
        },
    ]).unwrap_err(), "CUBE_DUPLICATE_ID_INVALID");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn duplicate_cube_refuses_opaque_self_reference_without_erasing_source_data() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["linked_uuid"] = json!(CUBE);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[EditOperation::DuplicateCube {
        source_uuid: CUBE.into(),
        new_uuid: "00000000-0000-4000-8000-000000000005".into(),
    }]).unwrap_err(), "CUBE_DUPLICATE_SELF_REFERENCE_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn reparent_cube_preserves_saved_data_and_moves_only_the_outliner_reference() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let root = BONE;
    let child = "00000000-0000-4000-8000-000000000003";
    let receipt = session.apply(0, &[EditOperation::ReparentNode {
        uuid: CUBE.into(), parent_uuid: Some(root.into()),
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.changed_uuids, vec![CUBE.to_string()]);
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().bones, original.bones);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    assert_eq!(session.document().extensions, original.extensions);
    assert_eq!(
        outliner_parent_uuid(&session.document().hierarchy, CUBE, None),
        Some(Some(root.to_string()))
    );
    let nested = find_visibility_group(&session.document().hierarchy, child).unwrap();
    assert!(nested.children.is_empty());
    let saved = session.export().unwrap();
    let reimported = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(reimported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reimported);
    assert_eq!(session.apply(3, &[EditOperation::ReparentNode {
        uuid: CUBE.into(), parent_uuid: Some(root.into()),
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.summary().revision, 3);
}

#[test]
fn reparent_bone_to_root_and_nested_parent_keeps_descendants_and_animations() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let child = "00000000-0000-4000-8000-000000000003";
    session.apply(0, &[EditOperation::ReparentNode {
        uuid: child.into(), parent_uuid: None,
    }]).unwrap();
    assert_eq!(outliner_parent_uuid(&session.document().hierarchy, child, None), Some(None));
    assert_eq!(
        outliner_parent_uuid(&session.document().hierarchy, CUBE, None),
        Some(Some(child.to_string()))
    );
    let moved = find_visibility_group(&session.document().hierarchy, child).unwrap();
    assert_eq!(moved.is_open, Some(true));
    assert_eq!(session.document().cubes, original.cubes);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    session.apply(1, &[EditOperation::ReparentNode {
        uuid: child.into(), parent_uuid: Some(BONE.into()),
    }]).unwrap();
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 2);
    session.undo(2).unwrap();
    assert_eq!(outliner_parent_uuid(&session.document().hierarchy, child, None), Some(None));
    session.redo(3).unwrap();
    assert_eq!(session.document(), &original);
}

#[test]
fn reparent_rejects_cycles_root_cube_unknown_targets_and_atomic_bad_batches() {
    let mut session = EditorSession::open(TEXTURED.as_bytes()).unwrap();
    let original = session.document().clone();
    let child = "00000000-0000-4000-8000-000000000003";
    let wrong = "00000000-0000-4000-8000-000000000099";
    let cases = [
        (BONE, Some(child), "REPARENT_CYCLE"),
        (child, Some(child), "REPARENT_CYCLE"),
        (CUBE, None, "REPARENT_CUBE_REQUIRES_BONE"),
        (CUBE, Some(wrong), "REPARENT_PARENT_NOT_FOUND"),
        (wrong, Some(BONE), "REPARENT_NODE_NOT_FOUND"),
    ];
    for (uuid, parent, expected) in cases {
        assert_eq!(session.apply(0, &[EditOperation::ReparentNode {
            uuid: uuid.into(), parent_uuid: parent.map(str::to_owned),
        }]).unwrap_err(), expected);
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
    assert_eq!(session.apply(0, &[
        EditOperation::ReparentNode { uuid: CUBE.into(), parent_uuid: Some(BONE.into()) },
        EditOperation::ReparentNode { uuid: BONE.into(), parent_uuid: Some(child.into()) },
    ]).unwrap_err(), "REPARENT_CYCLE");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn cube_scale_matches_pinned_inflate_and_pivot_math_with_manual_uv_preservation() {
    let mut wire: Value = serde_json::from_str(TEXTURED).unwrap();
    wire["elements"][0]["inflate"] = json!(1.0);
    wire["elements"][0]["autouv"] = json!(2);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [2.0, 0.5, 1.0],
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    let cube = &session.document().cubes[0];
    assert_eq!(cube.from, [-1.0, 0.5, 0.0]);
    assert_eq!(cube.to, [9.0, 1.5, 4.0]);
    assert_eq!(cube.origin, original.cubes[0].origin);
    assert_eq!(cube.extra["autouv"], json!(0));
    assert_eq!(cube.faces, original.cubes[0].faces);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    assert_eq!(session.document().animation_assets, original.animation_assets);
    assert_eq!(session.document().hierarchy, original.hierarchy);
    let reopened = AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn cube_scale_refreshes_box_uv_without_changing_saved_atlas_offset() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Scale", "scale").unwrap()
    ).unwrap();
    let bone: Bone = serde_json::from_value(json!({
        "uuid": BONE, "name": "root", "origin": [0,0,0]
    })).unwrap();
    session.apply(0, &[
        EditOperation::AddBone { bone, parent_uuid: None },
        EditOperation::AddCube { cube: sample_cube(CUBE), bone_uuid: BONE.into() },
    ]).unwrap();
    let prior = session.document().cubes[0].clone();
    session.apply(1, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [1.5, 1.0, 1.0],
    }]).unwrap();
    let scaled = &session.document().cubes[0];
    assert_eq!(scaled.from, prior.from);
    assert_eq!(scaled.to[0], prior.from[0] + (prior.to[0] - prior.from[0]) * 1.5);
    assert_eq!(scaled.uv_offset, prior.uv_offset);
    assert_ne!(scaled.faces["north"]["uv"], prior.faces["north"]["uv"]);
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document().cubes[0], prior);
}

#[test]
fn invalid_noop_or_partial_cube_scale_refuses_atomically() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    for factors in [[0.0, 1.0, 1.0], [-1.0, 1.0, 1.0],
                    [4.1, 1.0, 1.0], [f64::NAN, 1.0, 1.0]] {
        assert_eq!(session.apply(0, &[EditOperation::ScaleCube {
            uuid: CUBE.into(), factors,
        }]).unwrap_err(), "CUBE_SCALE_INVALID");
        assert_eq!(session.document(), &original);
    }
    assert_eq!(session.apply(0, &[EditOperation::ScaleCube {
        uuid: CUBE.into(), factors: [1.0, 1.0, 1.0],
    }]).unwrap_err(), "EDIT_NO_OP");
    assert_eq!(session.apply(0, &[
        EditOperation::ScaleCube { uuid: CUBE.into(), factors: [1.5, 1.0, 1.0] },
        EditOperation::ScaleCube { uuid: "missing".into(), factors: [1.2, 1.0, 1.0] },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &original);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn compatible_imported_rgba_png_requires_explicit_paint_adoption_and_preserves_bytes() {
    let uuid = "00000000-0000-4000-8000-000000000152";
    let mut authored = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Imported", "imported").unwrap()
    ).unwrap();
    authored.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "sample.png".into(),
    }]).unwrap();
    // Simulate a valid existing embedded PNG that is not LazyDesigner-owned.
    let mut wire: Value = serde_json::from_slice(&authored.export().unwrap()).unwrap();
    wire["textures"][0].as_object_mut().unwrap().remove("paint_owner");
    wire["textures"][0]["uv_width"] = json!(128);
    wire["textures"][0]["uv_height"] = json!(128);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let imported = session.document().clone();
    let original_source = imported.texture_assets[0]["source"].clone();
    assert!(!paint_texture_editable(&imported.texture_assets[0]));
    assert!(paint_texture_adoptable(&imported.texture_assets[0], 128, 128));
    assert_eq!(session.apply(0, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 1, y: 1, rgba: [10, 20, 30, 255],
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_OWNED");
    assert_eq!(session.summary().revision, 0);
    let receipt = session.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert!(paint_texture_editable(&session.document().texture_assets[0]));
    assert_eq!(session.document().texture_assets[0]["source"], original_source);
    assert_eq!(session.document().texture_assets[0]["uv_width"], json!(128));
    assert_eq!(session.document().texture_assets[0]["uv_height"], json!(128));
    let adopted = session.document().clone();
    session.apply(1, &[EditOperation::PaintTexturePixel {
        texture_index: 0, x: 1, y: 1, rgba: [10, 20, 30, 255],
    }]).unwrap();
    assert_ne!(session.document().texture_assets[0]["source"], original_source);
    let output = session.export().unwrap();
    let reopened = AuthoringDocument::import_bbmodel(&output).unwrap();
    assert_eq!(reopened, *session.document());
    session.undo(2).unwrap();
    assert_eq!(session.document(), &adopted);
    session.undo(3).unwrap();
    assert_eq!(session.document(), &imported);
    session.redo(4).unwrap();
    session.redo(5).unwrap();
    assert_eq!(session.document(), &reopened);
}

#[test]
fn imported_paint_adoption_rejects_opaque_or_external_png_and_bad_batches() {
    let uuid = "00000000-0000-4000-8000-000000000152";
    let mut authored = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Imported", "imported").unwrap()
    ).unwrap();
    authored.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "sample.png".into(),
    }]).unwrap();
    let mut wire: Value = serde_json::from_slice(&authored.export().unwrap()).unwrap();
    wire["textures"][0].as_object_mut().unwrap().remove("paint_owner");
    for (field, value) in [
        ("vendor_extension", json!({"keep":"opaque"})),
        ("relative_path", json!("textures/entity/external.png")),
        ("render_mode", json!("emissive")),
        ("uv_width", json!(64)),
        ("internal", json!(false)),
    ] {
        let mut candidate = wire.clone();
        candidate["textures"][0][field] = value;
        let mut session = EditorSession::open(&serde_json::to_vec(&candidate).unwrap()).unwrap();
        let before = session.document().clone();
        assert!(!paint_texture_adoptable(&before.texture_assets[0], 128, 128));
        assert_eq!(session.apply(0, &[EditOperation::EnableImportedPaintTexture {
            texture_index: 0,
        }]).unwrap_err(), "PAINT_IMPORTED_TEXTURE_UNSUPPORTED");
        assert_eq!(session.document(), &before);
        assert_eq!(session.summary().revision, 0);
    }
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::EnableImportedPaintTexture { texture_index: 0 },
        EditOperation::EnableImportedPaintTexture { texture_index: usize::MAX },
    ]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
    wire["textures"][0]["source"] = json!("data:image/png;base64,AAAA");
    let mut invalid = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let initial = invalid.document().clone();
    assert!(invalid.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).is_err());
    assert_eq!(invalid.document(), &initial);
    assert_eq!(invalid.summary().revision, 0);
}

#[test]
fn imported_rgb_png_is_not_silently_converted_to_rgba_paint_data() {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 128, 128);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&vec![99; 128 * 128 * 3]).unwrap();
    }
    let rgb_source = format!(
        "data:image/png;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes)
    );
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["textures"] = json!([{
        "uuid": "00000000-0000-4000-8000-000000000152",
        "name": "imported-rgb.png", "source": rgb_source,
        "internal": true, "wrap_mode": "limited",
        "render_mode": "default", "render_sides": "double"
    }]);
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let before = session.document().clone();
    assert!(paint_texture_adoptable(&before.texture_assets[0], 128, 128));
    assert_eq!(session.apply(0, &[EditOperation::EnableImportedPaintTexture {
        texture_index: 0,
    }]).unwrap_err(), "PAINT_PNG_FORMAT_UNSUPPORTED");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn import_png_and_assign_to_cube_use_one_rust_document_and_preserve_original_bytes() {
    let texture_id = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: texture_id.into(), name: "source.png".into(),
    }]).unwrap();
    let original_source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();

    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let prior = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: texture_id.into(), name: "source.png".into(),
            source: original_source.clone(),
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: CUBE.into(), texture_uuid: texture_id.into(),
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(receipt.operation_count, 2);
    assert_eq!(session.document().texture_assets.len(), 1);
    assert_eq!(session.document().texture_assets[0]["source"], json!(original_source));
    assert!(paint_texture_editable(&session.document().texture_assets[0]));
    for (face_name, face) in &session.document().cubes[0].faces {
        assert_eq!(face["texture"], json!(texture_id), "{face_name}");
        assert_eq!(face["uv"], prior.cubes[0].faces[face_name]["uv"]);
    }
    assert_eq!(session.document().bones, prior.bones);
    assert_eq!(session.document().hierarchy, prior.hierarchy);
    assert_eq!(session.document().animation_assets, prior.animation_assets);
    let saved = session.export().unwrap();
    let imported = AuthoringDocument::import_bbmodel(&saved).unwrap();
    assert_eq!(imported, *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &prior);
    session.redo(2).unwrap();
    assert_eq!(session.document(), &imported);
}

#[test]
fn assigning_texture_preserves_absent_faces_and_opaque_face_extensions() {
    let mut wire: Value = serde_json::from_str(SAMPLE).unwrap();
    wire["elements"][0]["faces"]["north"]["texture"] = Value::Null;
    wire["elements"][0]["faces"]["south"]["vendor"] = json!({"retained": true});
    let mut session = EditorSession::open(&serde_json::to_vec(&wire).unwrap()).unwrap();
    let original = session.document().clone();
    let asset_uuid = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: asset_uuid.into(), name: "source.png".into(),
    }]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();
    session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: asset_uuid.into(), name: "source.png".into(), source,
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: CUBE.into(), texture_uuid: asset_uuid.into(),
        },
    ]).unwrap();
    assert!(session.document().cubes[0].faces["north"]["texture"].is_null());
    assert_eq!(session.document().cubes[0].faces["south"]["vendor"], json!({"retained":true}));
    assert_eq!(session.document().cubes[0].faces["south"]["texture"], json!(asset_uuid));
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
}

#[test]
fn invalid_or_unrepresentable_png_import_refuses_without_creating_assets() {
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let uuid = "00000000-0000-4000-8000-000000000170";
    for (source, error) in [
        ("not-an-embedded-png".to_string(), "PAINT_PNG_SOURCE_INVALID"),
        ("data:image/png;base64,AAAA".to_string(), "PAINT_PNG_DECODE_FAILED"),
        (
            format!("data:image/png;base64,{}", "A".repeat(MAX_IMPORT_PNG_BYTES * 4 / 3 + 10)),
            "PAINT_PNG_TOO_LARGE",
        ),
    ] {
        assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "source.png".into(), source,
        }]).unwrap_err(), error);
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
    assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
        uuid: CUBE.into(), name: "source.png".into(), source: "invalid".into(),
    }]).unwrap_err(), "PAINT_TEXTURE_ID_INVALID");
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: CUBE.into(), texture_uuid: uuid.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.apply(0, &[EditOperation::AssignCubeTexture {
        cube_uuid: "missing".into(), texture_uuid: uuid.into(),
    }]).unwrap_err(), "PAINT_TEXTURE_NOT_FOUND");
    assert_eq!(session.document(), &original);
}

#[test]
fn invalid_texture_assignment_rolls_back_prior_import_in_same_batch() {
    let uuid = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("PNG", "png").unwrap()
    ).unwrap();
    produced.apply(0, &[EditOperation::CreatePaintTexture {
        uuid: uuid.into(), name: "source.png".into(),
    }]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let before = session.document().clone();
    assert_eq!(session.apply(0, &[
        EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "source.png".into(), source,
        },
        EditOperation::AssignCubeTexture {
            cube_uuid: "missing".into(), texture_uuid: uuid.into(),
        },
    ]).unwrap_err(), "CUBE_NOT_FOUND");
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
}

#[test]
fn imported_png_dimensions_and_color_depth_are_validated_by_the_shared_decoder() {
    fn png_source(width: u32, height: u32, color: png::ColorType) -> String {
        let mut bytes = Vec::new();
        let channels = if color == png::ColorType::Rgb { 3 } else { 4 };
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(
                &vec![0; width as usize * height as usize * channels]
            ).unwrap();
        }
        format!("data:image/png;base64,{}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD, &bytes,
        ))
    }
    let mut session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    let original = session.document().clone();
    let uuid = "00000000-0000-4000-8000-000000000170";
    for source in [
        png_source(16, 16, png::ColorType::Rgba),
        png_source(128, 128, png::ColorType::Rgb),
    ] {
        assert_eq!(session.apply(0, &[EditOperation::ImportPaintTexture {
            uuid: uuid.into(), name: "imported.png".into(), source,
        }]).unwrap_err(), "PAINT_PNG_FORMAT_UNSUPPORTED");
        assert_eq!(session.document(), &original);
        assert_eq!(session.summary().revision, 0);
    }
}

#[test]
fn empty_project_atlas_resolution_is_an_explicit_reversible_rust_edit() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap()
    ).unwrap();
    let original = session.document().clone();
    assert!(can_set_empty_atlas_resolution(session.document()));
    let receipt = session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 64, height: 32,
    }]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!([session.document().resolution.width, session.document().resolution.height],
        [64, 32]);
    assert_eq!(session.document().resolution.extra, original.resolution.extra);
    assert_eq!(session.document().extensions, original.extensions);
    assert_eq!(session.document().texture_assets, original.texture_assets);
    let encoded = session.export().unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&encoded).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    assert_eq!(session.apply(3, &[EditOperation::SetEmptyAtlasResolution {
        width: 64, height: 32,
    }]).unwrap_err(), "EDIT_NO_OP");
}

#[test]
fn atlas_resolution_refuses_invalid_size_or_existing_authored_data_atomically() {
    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap()
    ).unwrap();
    let before = session.document().clone();
    for [width, height] in [[0, 64], [64, 0], [257, 64], [64, 257]] {
        assert_eq!(session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
            width, height,
        }]).unwrap_err(), "ATLAS_RESOLUTION_UNSUPPORTED");
    }
    assert_eq!(session.document(), &before);
    assert_eq!(session.summary().revision, 0);
    let cube_session = EditorSession::open(SAMPLE.as_bytes()).unwrap();
    assert!(!can_set_empty_atlas_resolution(cube_session.document()));
    let original_cube = cube_session.document().clone();
    let mut cube_session = cube_session;
    assert_eq!(cube_session.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 32, height: 32,
    }]).unwrap_err(), "ATLAS_RESOLUTION_LOCKED");
    assert_eq!(cube_session.document(), &original_cube);
    let mut imported = before.clone();
    imported.extensions.insert("vendor_extension".into(), json!({"retain":true}));
    let mut imported = EditorSession::from_document(imported).unwrap();
    assert!(!can_set_empty_atlas_resolution(imported.document()));
    assert_eq!(imported.apply(0, &[EditOperation::SetEmptyAtlasResolution {
        width: 16, height: 16,
    }]).unwrap_err(), "ATLAS_RESOLUTION_LOCKED");
}

#[test]
fn empty_atlas_resize_and_matching_png_import_can_commit_atomically() {
    let id = "00000000-0000-4000-8000-000000000170";
    let mut produced = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Source", "source").unwrap()
    ).unwrap();
    produced.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 64, height: 64 },
        EditOperation::CreatePaintTexture { uuid: id.into(), name: "64.png".into() },
    ]).unwrap();
    let source = produced.document().texture_assets[0]["source"].as_str().unwrap().to_string();

    let mut session = EditorSession::from_document(
        AuthoringDocument::new_bedrock("Target", "target").unwrap()
    ).unwrap();
    let original = session.document().clone();
    let receipt = session.apply(0, &[
        EditOperation::SetEmptyAtlasResolution { width: 64, height: 64 },
        EditOperation::ImportPaintTexture {
            uuid: id.into(), name: "64.png".into(), source: source.clone(),
        },
    ]).unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(session.document().resolution.width, 64);
    assert_eq!(session.document().resolution.height, 64);
    assert_eq!(session.document().texture_assets[0]["source"], json!(source));
    assert!(!can_set_empty_atlas_resolution(session.document()));
    assert_eq!(AuthoringDocument::import_bbmodel(&session.export().unwrap()).unwrap(),
        *session.document());
    session.undo(1).unwrap();
    assert_eq!(session.document(), &original);
    session.redo(2).unwrap();
    assert_eq!(session.document().texture_assets.len(), 1);
}
