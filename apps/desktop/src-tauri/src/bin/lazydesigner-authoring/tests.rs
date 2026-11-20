// SOURCE_AUTHORED_NOT_RUN: original inline tests, unchanged aside from
// include_bytes paths relative to the extracted test module.
    use super::*;

    // SOURCE_AUTHORED_NOT_RUN: repair earlier Sound/Particle inspection's
    // missing CLI enum/dispatch and add saved Timeline Marker read selector.
    #[test]
    fn code_mode_inspect_batch_reads_effects_and_timeline_markers_together() {
        let mut session=EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007631";
        let sound="00000000-0000-4000-8000-000000007632";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"contact".into(),length:2.0,
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:0.5,
                name:"left_foot_contact".into(),color:6,
            },
            EditOperation::AddAnimationEffectEvent {
                animation_uuid:anim.into(),keyframe_uuid:sound.into(),
                channel:"sound".into(),time:0.5,
                points:vec![lazydesigner::authoring::AnimationEffectPoint {
                    effect:"robot.step".into(),locator:None,bind_to_actor:None,
                }],
            },
        ]).unwrap();
        let doc=session.document().clone();
        let previous=doc.clone();
        let req: InspectBatchInput=serde_json::from_str(&format!(
            r#"{{"requests":[
                {{"kind":"animation_effect_events","animation_uuid":"{anim}","limit":16}},
                {{"kind":"animation_timeline_markers","animation_uuid":"{anim}","limit":1}}
            ]}}"#
        )).unwrap();
        let selected=inspect_batch(&doc,req.requests).unwrap();
        assert_eq!(selected.len(),2);
        assert_eq!(selected[0]["kind"],json!("animation_effect_events"));
        assert_eq!(selected[0]["effects"]["recognized"],json!(true));
        assert_eq!(selected[0]["effects"]["events"][0]["uuid"],json!(sound));
        assert_eq!(selected[1]["kind"],json!("animation_timeline_markers"));
        assert_eq!(selected[1]["markers"]["recognized"],json!(true));
        assert_eq!(selected[1]["markers"]["total_markers"],json!(1));
        assert_eq!(selected[1]["markers"]["markers"][0]["name"],
            json!("left_foot_contact"));
        assert_eq!(selected[1]["markers"]["playback_verdict"],json!("NOT_EXECUTED"));
        assert_eq!(doc,previous);
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"animation_timeline_markers","animation_uuid":"x","shell":"bad"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc,vec![
            InspectBatchQuery::AnimationTimelineMarkers {
                animation_uuid:anim.into(),offset:Some(0),limit:Some(33),
            }
        ]).unwrap_err(),"ANIMATION_MARKER_INSPECT_PAGE_INVALID");
        assert_eq!(doc,previous);
    }

    // SOURCE_AUTHORED_NOT_RUN: Code Mode inspects saved Sound/Particle
    // events as metadata only, with no native event playback claim.
    #[test]
    fn code_mode_batch_inspects_guarded_animation_effect_events_without_mutation() {
        let mut session=EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let animation="00000000-0000-4000-8000-000000007541";
        let sound="00000000-0000-4000-8000-000000007542";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:animation.into(),name:"step_sound".into(),length:2.0,
            },
            EditOperation::AddAnimationEffectEvent {
                animation_uuid:animation.into(),keyframe_uuid:sound.into(),
                channel:"sound".into(),time:1.0,
                points:vec![lazydesigner::authoring::AnimationEffectPoint {
                    effect:"robot.step".into(),locator:None,bind_to_actor:None,
                }],
            },
        ]).unwrap();
        let doc=session.document().clone();
        let source=doc.clone();
        let requests: InspectBatchInput=serde_json::from_str(&format!(
            r#"{{"requests":[{{"kind":"animation_effect_events","animation_uuid":"{animation}","offset":0,"limit":1}}]}}"#
        )).unwrap();
        let entries=inspect_batch(&doc,requests.requests).unwrap();
        assert_eq!(entries.len(),1);
        assert_eq!(entries[0]["kind"],json!("animation_effect_events"));
        assert_eq!(entries[0]["effects"]["recognized"],json!(true));
        assert_eq!(entries[0]["effects"]["playback_verdict"],json!("NOT_EXECUTED"));
        assert_eq!(entries[0]["effects"]["events"][0]["uuid"],json!(sound));
        assert_eq!(entries[0]["effects"]["events"][0]["data_points"][0]["effect"],
            json!("robot.step"));
        assert_eq!(doc,source);
        assert!(!serde_json::to_string(&entries).unwrap().contains("data:image/png"));
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"animation_effect_events","animation_uuid":"clip","shell":"unsafe"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc,vec![InspectBatchQuery::AnimationEffectEvents {
            animation_uuid:animation.into(),offset:Some(0),limit:Some(17),
        }]).unwrap_err(),"ANIMATION_EFFECT_INSPECT_PAGE_INVALID");
        assert_eq!(doc,source);
    }

    // Regression source only; there is no filesystem publication or runtime PASS.
    #[test]
    fn code_mode_asset_handoff_reuses_three_exporters_without_raw_png_echo() {
        const TEX: &str = "00000000-0000-4000-8000-000000006801";
        let mut session = EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube = session.document().cubes[0].uuid.clone();
        session.apply(0,&[
            EditOperation::CreatePaintTexture {
                uuid:TEX.into(),name:"atlas.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:cube,texture_uuid:TEX.into(),
            },
        ]).unwrap();
        let doc = session.document().clone();
        let bytes = serde_json::to_vec(&json!({"requests":[
            {"kind":"asset_handoff","texture_uuid":TEX},
            {"kind":"audit"}
        ]})).unwrap();
        let plan: InspectBatchInput = serde_json::from_slice(&bytes).unwrap();
        let results = inspect_batch(&doc,plan.requests).unwrap();
        assert_eq!(results.len(),2);
        assert_eq!(results[0]["kind"],"asset_handoff");
        assert_eq!(results[0]["handoff"]["status"],"source_consistent");
        // InspectBatch binds the canonical editable project export to the
        // same immutable Rust document as all three resource exporters.
        assert_eq!(results[0]["handoff"]["bbmodel"]["status"],"source_exportable");
        assert_eq!(results[0]["handoff"]["bbmodel"]["sha256"],
            json!(sha256(&session.export().unwrap())));
        assert_eq!(results[0]["handoff"]["bbmodel"]["bytes"],
            json!(session.export().unwrap().len()));
        assert_eq!(results[0]["handoff"]["faces"]["selected_texture"],6);
        assert_eq!(results[0]["handoff"]["animation"]["status"],"no_saved_clips");
        assert_eq!(results[0]["handoff"]["animation_requirement"],
            "UNKNOWN_FROM_MODEL_SOURCE");
        assert_eq!(results[0]["handoff"]["geometry"]["visible_bounds_source"],"computed_static");
        assert_eq!(results[0]["handoff"]["geometry"]["visible_bounds"]["width"],json!(2.0));
        assert_eq!(results[0]["handoff"]["visual_verdict"],"UNVERIFIED");
        let mut user_visible_box = doc.clone();
        user_visible_box.extensions.insert("visible_box".into(),json!([12.0,4.0,0.0]));
        let visible = inspect_batch(&user_visible_box, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(),offset:None,limit:None,
        }]).unwrap();
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds_source"],
            "saved_visible_box_union");
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds"]["width"],json!(12.0));
        assert_eq!(visible[0]["handoff"]["geometry"]["visible_bounds"]["height"],json!(4.0));
        assert_eq!(doc.extensions.get("visible_box"),None);
        assert_eq!(results[1]["kind"],"audit");
        assert!(!serde_json::to_string(&results).unwrap().contains("data:image/png"));
        assert_eq!(session.document(),&doc);
        let mut damaged = doc.clone();
        damaged.cubes[0].faces.get_mut("north").unwrap()["texture"] = json!(false);
        damaged.cubes[0].faces.get_mut("east").unwrap()["texture"] = json!(false);
        let first = inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(), offset:Some(0), limit:Some(1),
        }]).unwrap();
        let second = inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
            texture_uuid:TEX.into(), offset:Some(1), limit:Some(1),
        }]).unwrap();
        assert_eq!(first[0]["handoff"]["total_issues"], 2);
        assert_eq!(first[0]["handoff"]["issues"][0]["cube_uuid"],
            damaged.cubes[0].uuid);
        assert_eq!(first[0]["handoff"]["issues"][0]["face"], "north");
        assert_eq!(first[0]["handoff"]["next_issue_offset"], 1);
        assert_eq!(second[0]["handoff"]["issues"][0]["face"], "east");
        assert_eq!(second[0]["handoff"]["next_issue_offset"], Value::Null);
        assert_eq!(first[0]["handoff"]["geometry"], second[0]["handoff"]["geometry"]);
        assert_eq!(first[0]["handoff"]["texture"], second[0]["handoff"]["texture"]);
        assert_eq!(damaged.cubes[0].faces["north"]["texture"], json!(false));
        // A correct atlas UUID can still point outside the physical PNG.
        // This is a saved UV issue, not a second output/publisher mutation.
        let mut bad_uv = doc.clone();
        bad_uv.cubes[0].faces.get_mut("north").unwrap()["uv"] =
            json!([-1.0,0.0,4.0,4.0]);
        let uv_report = inspect_batch(&bad_uv, vec![
            InspectBatchQuery::AssetHandoff {
                texture_uuid:TEX.into(), offset:Some(0), limit:Some(1),
            }
        ]).unwrap();
        assert_eq!(uv_report[0]["handoff"]["status"], "blocked");
        assert_eq!(uv_report[0]["handoff"]["faces"]["uv_out_of_bounds"], 1);
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["face"], "north");
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["problem"], "uv_out_of_bounds");
        assert_eq!(uv_report[0]["handoff"]["issues"][0]["uv_source"], "saved_manual");
        assert!(uv_report[0]["handoff"]["blockers"].as_array().unwrap().contains(
            &json!("UV_OUT_OF_ATLAS")));
        assert_eq!(doc.cubes[0].faces["north"]["uv"], json!([0,0,4,4]));
        for (offset, limit) in [(0, 0), (0, 33), (393_217, 1)] {
            assert_eq!(inspect_batch(&damaged, vec![InspectBatchQuery::AssetHandoff {
                texture_uuid:TEX.into(), offset:Some(offset), limit:Some(limit),
            }]).unwrap_err(), "ASSET_HANDOFF_PAGE_INVALID");
        }
        assert!(serde_json::from_value::<InspectBatchInput>(json!({"requests":[
            {"kind":"asset_handoff","texture_uuid":TEX,"path":"/not/allowed"}
        ]})).is_err());
        assert!(serde_json::from_value::<InspectBatchInput>(json!({"requests":[
            {"kind":"asset_handoff"}
        ]})).is_err());
    }

    // Source-authored CLI/Rust proof only; Cargo/native execution is held.

    // SOURCE-AUTHORED_NOT_RUN: one immutable native source read resolves a
    // named target, its relevant inspection and the correct operation family.
    #[test]
    fn named_target_orientation_refuses_guesses_and_preserves_model() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.cubes[0].name = Some("Helmet".into());
        let prior = doc.clone();
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let out = inspect_batch(&doc, q.requests).unwrap();
        let evidence = &out[0]["target"];
        assert_eq!(evidence["status"], "EXACT_MATCH");
        assert_eq!(evidence["selected"]["identity"]["uuid"], doc.cubes[0].uuid);
        assert_eq!(evidence["selected"]["source"]["surfaces"]["faces"]
            .as_array().unwrap().len(), 6);
        assert_eq!(evidence["candidate_operations"], json!([]));
        assert_eq!(evidence["source_blockers"][0],
            "EXPLICIT_SAVED_FACE_TEXTURE_REQUIRED");
        assert_eq!(evidence["write_authority"], "NOT_GRANTED");
        assert_eq!(evidence["visual_verdict"], "UNVERIFIED");

        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"cubes","name":"Hel"}
        ]})).unwrap();
        let hint = &inspect_batch(&doc, q.requests).unwrap()[0]["target"];
        assert_eq!(hint["status"], "NO_EXACT_MATCH");
        assert_eq!(hint["candidate_count"], 1);
        assert!(hint["selected"].is_null());
        assert_eq!(hint["candidate_operations"], json!([]));

        // Once a real explicit face/atlas link exists, Texturing guidance
        // may name guarded face Paint candidates, still without approval.
        let mut textured = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        textured.cubes[0].name = Some("Helmet".into());
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let not_editable = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(not_editable["candidate_operations"], json!([]));
        assert_eq!(not_editable["source_blockers"][0],
            "LINKED_TEXTURE_NOT_RUST_PAINT_EDITABLE");
        // Admit a narrowly supported test-owned RGBA8 bitmap; imported
        // source metadata is never upgraded automatically in production.
        let imported = textured.texture_assets[0].as_object_mut().unwrap();
        imported.remove("texture_set");
        imported.insert("paint_owner".into(), json!("lazydesigner-rgba8-v1"));
        imported.insert("render_mode".into(), json!("default"));
        imported.insert("render_sides".into(), json!("double"));
        assert!(paint_texture_editable(&textured.texture_assets[0]));
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let ready = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(ready["status"], "EXACT_MATCH");
        assert_eq!(ready["candidate_operations"][0],
            "paint_cube_face_regions_guarded");
        assert_eq!(ready["source_blockers"], json!([]));
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"uv",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let manual = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(manual["candidate_operations"], json!(["set_face_uv"]));
        textured.cubes[0].extra.insert("box_uv".into(), json!(true));
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"uv",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let boxed = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(boxed["candidate_operations"][0], "set_box_uv_offset");
        assert_eq!(boxed["candidate_operations"][1], "isolate_cube_box_uv");

        // A manual-face edit on Auto UV must not be recommended.
        textured.cubes[0].extra.insert("box_uv".into(), json!(false));
        textured.cubes[0].extra.insert("autouv".into(), json!(1));
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"uv",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let automated = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(automated["candidate_operations"], json!([]));
        assert_eq!(automated["source_blockers"][0],
            "MANUAL_UV_EDIT_UNSUPPORTED_FOR_AUTO_MODE");

        // Imported but unadopted atlases are not editable Rust Paint assets.
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"textures","name":"external.png"}
        ]})).unwrap();
        let imported = &inspect_batch(&textured, q.requests).unwrap()[0]["target"];
        assert_eq!(imported["status"], "EXACT_MATCH");
        assert_eq!(imported["candidate_operations"], json!([]));
        assert_eq!(imported["source_blockers"][0],
            "TEXTURE_NOT_ENABLED_FOR_RUST_PAINT");

        let mut second = doc.cubes[0].clone();
        second.uuid = "00000000-0000-4000-8000-000000000599".into();
        doc.cubes.push(second.clone());
        if let OutlinerNode::Bone(root) = &mut doc.hierarchy[0] {
            root.children.push(OutlinerNode::Cube(second.uuid.clone()));
        } else { panic!("fixture needs a root bone"); }
        doc.validate().unwrap();
        let q: InspectBatchInput = serde_json::from_value(json!({"requests":[
            {"kind":"authoring_target","domain":"geometry",
             "category":"cubes","name":"Helmet"}
        ]})).unwrap();
        let ambiguous = &inspect_batch(&doc, q.requests).unwrap()[0]["target"];
        assert_eq!(ambiguous["status"], "AMBIGUOUS_NAME");
        assert_eq!(ambiguous["candidate_count"], 2);
        assert!(ambiguous["selected"].is_null());
        assert_eq!(ambiguous["candidate_operations"], json!([]));

        assert_eq!(inspect_authoring_target(
            &prior, "geometry", "textures", "Helmet").unwrap_err(),
            "AUTHORING_TARGET_DOMAIN_MISMATCH");
        assert_eq!(inspect_authoring_target(
            &prior, "uv", "cubes", " Helmet").unwrap_err(),
            "AUTHORING_TARGET_NAME_INVALID");
        assert_eq!(prior.cubes[0].name.as_deref(), Some("Helmet"));
        assert_eq!(prior, AuthoringDocument::import_bbmodel(
            &prior.export_bbmodel().unwrap()).unwrap());
    }

    // SOURCE-AUTHORED_NOT_RUN: exact JSON parity of the validated one-source
    // batch and standalone public inspectors, with no model mutation.
    #[test]
    fn code_mode_validated_session_batch_matches_standalone_reads() {
        let session = EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let cube = session.document().cubes[0].uuid.clone();
        let texture = session.document().texture_assets[0]["uuid"]
            .as_str().unwrap().to_owned();
        let payload = json!({"requests":[
            {"kind":"authoring_target","domain":"texturing",
             "category":"cubes","name":"textured_cube"},
            {"kind":"cube_surfaces","uuid":cube},
            {"kind":"cube_face_alpha","uuid":cube},
            {"kind":"model_texture_coverage","offset":0,"limit":1,
             "attention_only":true},
            {"kind":"texture_alpha","uuid":texture}
        ]});
        let direct: InspectBatchInput =
            serde_json::from_value(payload.clone()).unwrap();
        let trusted: InspectBatchInput =
            serde_json::from_value(payload).unwrap();
        let before = session.document().clone();
        assert_eq!(
            inspect_batch_session(&session, trusted.requests).unwrap(),
            inspect_batch(session.document(), direct.requests).unwrap()
        );
        assert_eq!(session.document(), &before);
    }

    // SOURCE_AUTHORED_NOT_RUN: cross-selector atlas reuse must preserve
    // exactly the independent, source-validated batch JSON and refusals.
    #[test]
    fn code_mode_face_styling_batch_matches_standalone() {
        let mut session=EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let texture_id="00000000-0000-4000-8000-000000009976";
        let cube_id="00000000-0000-4000-8000-000000000002";
        session.apply(0,&[
            EditOperation::CreatePaintTexture {
                uuid:texture_id.into(),name:"shared.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:cube_id.into(),texture_uuid:texture_id.into(),
            },
        ]).unwrap();
        let before=session.document().clone();
        let batch=json!({"requests":[
            {"kind":"cube_face_alpha","uuid":cube_id},
            {"kind":"texture_styling_face","texture_uuid":texture_id,
             "cube_uuid":cube_id,"face":"north"},
            {"kind":"texture_styling_face","texture_uuid":texture_id,
             "cube_uuid":cube_id,"face":"east"},
            {"kind":"model_texture_coverage","offset":0,"limit":1,
             "attention_only":false}
        ]});
        let a:InspectBatchInput=serde_json::from_value(batch.clone()).unwrap();
        let b:InspectBatchInput=serde_json::from_value(batch).unwrap();
        assert_eq!(inspect_batch_session(&session,a.requests).unwrap(),
            inspect_batch(session.document(),b.requests).unwrap());
        let invalid=json!({"requests":[
            {"kind":"texture_styling_face","texture_uuid":texture_id,
             "cube_uuid":cube_id,"face":"invalid"}
        ]});
        let a:InspectBatchInput=serde_json::from_value(invalid.clone()).unwrap();
        let b:InspectBatchInput=serde_json::from_value(invalid).unwrap();
        assert_eq!(inspect_batch_session(&session,a.requests).unwrap_err(),
            inspect_batch(session.document(),b.requests).unwrap_err());
        assert_eq!(session.document(),&before);
    }

    // SOURCE_AUTHORED_NOT_RUN: repeated Geometry Impact queries use the
    // same transient atlas membership index; one-query calls keep their
    // direct inspector. Both must produce identical saved-source reports.
    #[test]
    fn code_mode_repeated_geometry_impact_batch_preserves_public_reports() {
        let mut session=EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let cube="00000000-0000-4000-8000-000000000002";
        let copied="00000000-0000-4000-8000-000000009981";
        let texture="00000000-0000-4000-8000-000000009982";
        session.apply(0,&[
            EditOperation::CreatePaintTexture {
                uuid:texture.into(),name:"shared.png".into(),
            },
            EditOperation::AssignCubeTexture {
                cube_uuid:cube.into(),texture_uuid:texture.into(),
            },
            EditOperation::DuplicateCube {
                source_uuid:cube.into(),new_uuid:copied.into(),
            },
        ]).unwrap();
        let before=session.document().clone();
        let mixed=json!({"requests":[
            {"kind":"geometry_impact","cube_uuid":cube,"change":"reshape"},
            {"kind":"geometry_impact","cube_uuid":copied,"change":"texture"},
            {"kind":"geometry_impact","cube_uuid":cube,"change":"pose"},
            {"kind":"cube","uuid":copied}
        ]});
        let direct:InspectBatchInput=serde_json::from_value(mixed.clone()).unwrap();
        let indexed:InspectBatchInput=serde_json::from_value(mixed).unwrap();
        assert_eq!(inspect_batch_session(&session,indexed.requests).unwrap(),
            inspect_batch(session.document(),direct.requests).unwrap());
        let one=json!({"requests":[
            {"kind":"geometry_impact","cube_uuid":cube,"change":"reshape"}
        ]});
        let direct:InspectBatchInput=serde_json::from_value(one.clone()).unwrap();
        let indexed:InspectBatchInput=serde_json::from_value(one).unwrap();
        assert_eq!(inspect_batch_session(&session,indexed.requests).unwrap(),
            inspect_batch(session.document(),direct.requests).unwrap());
        let bad=json!({"requests":[
            {"kind":"geometry_impact","cube_uuid":"unknown","change":"reshape"},
            {"kind":"geometry_impact","cube_uuid":copied,"change":"texture"}
        ]});
        let direct:InspectBatchInput=serde_json::from_value(bad.clone()).unwrap();
        let indexed:InspectBatchInput=serde_json::from_value(bad).unwrap();
        assert_eq!(inspect_batch_session(&session,indexed.requests).unwrap_err(),
            inspect_batch(session.document(),direct.requests).unwrap_err());
        assert_eq!(session.document(),&before);
    }

    #[test]
    fn code_mode_inspect_batch_projects_multiple_reads_from_one_immutable_document() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let before = doc.clone();
        let uuid = doc.cubes[0].uuid.clone();
        let json = format!(r#"{{"requests":[
            {{"kind":"catalog","category":"cubes","limit":1}},
            {{"kind":"cube","uuid":"{uuid}"}},
            {{"kind":"cube_surfaces","uuid":"{uuid}"}},
            {{"kind":"audit"}}
        ]}}"#);
        let plan: InspectBatchInput = serde_json::from_str(&json).unwrap();
        let entries = inspect_batch(&doc, plan.requests).unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0]["kind"], json!("catalog"));
        assert_eq!(entries[0]["catalog"]["total"], json!(1));
        assert_eq!(entries[1]["kind"], json!("cube"));
        assert_eq!(entries[1]["element"]["uuid"], json!(uuid));
        assert_eq!(entries[2]["surfaces"]["faces"].as_array().unwrap().len(), 6);
        assert_eq!(entries[3]["audit"]["visual_verdict"], json!("UNVERIFIED"));
        assert!(serde_json::to_string(&entries).unwrap().find("data:image/png").is_none());
        assert_eq!(doc, before);
    }

    #[test]
    fn code_mode_inspect_batch_rejects_unknown_and_oversized_shapes() {
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"unknown"}]}"#
        ).is_err());
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"audit","untrusted":"data"}]}"#
        ).is_err());
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"cube","uuid":"a","invalid":true}]}"#
        ).is_err());
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let empty = inspect_batch(&doc, Vec::new()).unwrap_err();
        assert_eq!(empty, "INSPECT_BATCH_SIZE_INVALID");
        let too_many = std::iter::repeat_with(|| InspectBatchQuery::Audit)
            .take(9).collect();
        assert_eq!(inspect_batch(&doc, too_many).unwrap_err(),
            "INSPECT_BATCH_SIZE_INVALID");
        let one = vec![InspectBatchQuery::Catalog {
            category: "cubes".into(), offset: None, limit: Some(65),
        }];
        assert_eq!(inspect_batch(&doc, one).unwrap_err(),
            "INSPECT_BATCH_PAGE_INVALID");
    }

    // Rust/CLI source regression only. Coverage pages are bounded and
    // returned through the existing one-document batch parser.
    #[test]
    fn code_mode_batch_model_texture_coverage_is_read_only_and_paged() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let original = doc.clone();
        let input: InspectBatchInput = serde_json::from_str(
            r#"{"requests":[{"kind":"model_texture_coverage","offset":0,"limit":1}]}"#
        ).unwrap();
        let inspected = inspect_batch(&doc, input.requests).unwrap();
        assert_eq!(inspected[0]["kind"], json!("model_texture_coverage"));
        assert_eq!(inspected[0]["coverage"]["scope"],
            json!("saved_face_texture_coverage_page"));
        assert_eq!(inspected[0]["coverage"]["reviewed_cubes"], json!(1));
        assert_eq!(inspected[0]["coverage"]["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(inspected[0]["coverage"]["attention_only"], json!(false));
        assert_eq!(doc, original);
        let mut mixed = doc.clone();
        mixed.cubes[0].faces["north"]["texture"] = Value::Null;
        let focused: InspectBatchInput = serde_json::from_str(
            r#"{"requests":[{"kind":"model_texture_coverage","offset":0,"limit":1,"attention_only":true}]}"#
        ).unwrap();
        let compact = inspect_batch(&mixed, focused.requests).unwrap();
        let item = &compact[0]["coverage"];
        assert_eq!(item["attention_only"], json!(true));
        assert_eq!(item["reviewed_cubes"], json!(1));
        assert_eq!(item["returned_cubes"], json!(1));
        assert_eq!(item["returned_faces"], json!(5));
        assert_eq!(item["review_candidates"], json!(5));
        assert_eq!(item["cubes"][0]["faces"].as_array().unwrap().len(), 5);
        assert_eq!(item["cubes"][0]["faces"][0]["side"], json!("east"));
        assert_eq!(item["next_offset"], Value::Null);
        assert_eq!(mixed.cubes[0].faces["north"]["texture"], Value::Null);
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"model_texture_coverage","attention_only":"yes"}]}"#
        ).is_err());
        assert_eq!(inspect_batch(&doc, vec![
            InspectBatchQuery::ModelTextureCoverage {
                offset: Some(0), limit: Some(9), attention_only: None
            }
        ]).unwrap_err(), "TEXTURE_COVERAGE_PAGE_INVALID");
        assert!(serde_json::from_str::<InspectBatchInput>(
            r#"{"requests":[{"kind":"model_texture_coverage","uuid":"untrusted"}]}"#
        ).is_err());
    }

    // Rust/CLI regression source only; no Cargo or native execution claimed.
    #[test]
    fn code_mode_face_uv_alpha_is_exact_on_manual_boundaries_and_refuses_ambiguous_uv() {
        let mut session = EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let uuid = "00000000-0000-4000-8000-000000000899";
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid:uuid.into(), name:"face.png".into()
        }]).unwrap();
        session.apply(1, &[
            EditOperation::PaintTexturePixel {
                texture_index:0, x:0, y:0, rgba:[20,20,20,255]
            },
            EditOperation::PaintTexturePixel {
                texture_index:0, x:1, y:0, rgba:[20,20,20,128]
            }
        ]).unwrap();
        let mut doc = session.document().clone();
        let cube_id = doc.cubes[0].uuid.clone();
        doc.cubes[0].faces["north"]["texture"] = json!(0);
        doc.cubes[0].faces["east"]["texture"] = json!(uuid);
        doc.cubes[0].faces["south"]["texture"] = json!(false);
        doc.cubes[0].faces["west"]["texture"] = Value::Null;
        let original = doc.clone();
        let report = inspect_cube_uv_alpha(&doc, &cube_id).unwrap();
        assert_eq!(report["scope"], json!("saved_manual_face_uv_alpha"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["face_count"], json!(6));
        assert_eq!(report["faces"][0]["alpha"]["status"], json!("measured"));
        assert_eq!(report["faces"][0]["alpha"]["region"]["sampled_pixels"], json!(16));
        assert_eq!(report["faces"][0]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["translucent_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(14));
        assert_eq!(report["faces"][1]["saved_reference_kind"], json!("uuid"));
        assert_eq!(report["faces"][1]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][2]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert_eq!(report["faces"][3]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert_eq!(report["faces"][4]["alpha"]["reason"],
            json!("NO_EXPLICIT_TEXTURE_REFERENCE"));
        assert!(report.to_string().find("data:image/png").is_none());
        assert_eq!(doc, original);

        doc.cubes[0].faces["north"]["uv"] = json!([4.0,4.0,0.0,0.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(14));
        doc.cubes[0].faces["north"]["uv"] = json!([0.0,0.0,0.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_ZERO_AREA"));
        doc.cubes[0].faces["north"]["uv"] = json!([0.5,0.0,4.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_NON_INTEGRAL"));
        doc.cubes[0].faces["north"]["uv"] = json!([0.0,0.0,400.0,4.0]);
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("PAINT_UV_RECT_OUT_OF_BOUNDS"));

        doc = original.clone();
        doc.meta.box_uv = Some(true);
        let box_report = inspect_cube_uv_alpha(&doc, &cube_id).unwrap();
        assert_eq!(box_report["scope"], json!("derived_box_face_uv_alpha"));
        assert_eq!(box_report["faces"][0]["uv_source"], json!("derived_box"));
        assert_eq!(box_report["faces"][0]["uv"], json!([4.0, 4.0, 8.0, 8.0]));
        assert_eq!(box_report["faces"][0]["saved_uv"], json!([0.0, 0.0, 4.0, 4.0]));
        assert_eq!(box_report["faces"][0]["alpha"]["region"]["scope"],
            json!("derived_box_uv_alpha_pixels"));
        assert_eq!(box_report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(16));
        doc.meta.extra.insert("box_uv_float_size".into(), json!(true));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("BOX_UV_RULES_UNSUPPORTED"));
        doc.meta.extra.remove("box_uv_float_size");
        doc.cubes[0].extra.insert("mirror_uv".into(), json!("not-bool"));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("BOX_UV_RULES_UNSUPPORTED"));
        doc = original.clone();
        doc.cubes[0].extra.insert("autouv".into(), json!(1));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"], json!("AUTO_UV_UNSUPPORTED"));
        doc = original.clone();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        assert_eq!(inspect_cube_uv_alpha(&doc, &cube_id).unwrap()
            ["faces"][0]["alpha"]["reason"],
            json!("PER_TEXTURE_UV_RULES_UNSUPPORTED"));

        doc = original.clone();
        doc.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
        assert!(inspect_cube_uv_alpha(&doc, &cube_id).is_err());
        assert_eq!(inspect_cube_uv_alpha(&original, "nonexistent-cube").unwrap_err(),
            "CUBE_NOT_FOUND");
    }

    // Source-authored only. The normal new Bedrock model uses Box UV.
    // An alpha measurement here says nothing about 3D face visibility.
    #[test]
    fn box_uv_alpha_uses_derived_face_net_and_preserves_imported_source() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Box alpha", "box_alpha").unwrap()
        ).unwrap();
        let bone: lazydesigner::authoring::Bone = serde_json::from_value(json!({
            "uuid":"00000000-0000-4000-8000-000000000801",
            "name":"root", "origin":[0,0,0]
        })).unwrap();
        let mut cube: lazydesigner::authoring::Cube = serde_json::from_value(
            serde_json::from_slice::<Value>(include_bytes!("../../../fixtures/bedrock-basic.bbmodel"))
            .unwrap()["elements"][0].clone()).unwrap();
        cube.uuid = "00000000-0000-4000-8000-000000000802".into();
        let id = "00000000-0000-4000-8000-000000000803";
        session.apply(0, &[
            EditOperation::SetEmptyAtlasResolution { width: 32, height: 32 },
            EditOperation::AddBone { bone, parent_uuid: None },
            EditOperation::AddCube {
                cube, bone_uuid: "00000000-0000-4000-8000-000000000801".into()
            },
            EditOperation::CreatePaintTexture { uuid:id.into(), name:"box.png".into() },
            EditOperation::AssignCubeTexture {
                cube_uuid:"00000000-0000-4000-8000-000000000802".into(),
                texture_uuid:id.into(),
            },
            EditOperation::PaintTexturePixel {
                texture_index:0, x:4, y:4, rgba:[10,20,30,255]
            },
        ]).unwrap();
        let original = session.document().clone();
        let report = inspect_cube_uv_alpha(&original,
            "00000000-0000-4000-8000-000000000802").unwrap();
        assert_eq!(report["scope"], json!("derived_box_face_uv_alpha"));
        assert_eq!(report["faces"][0]["side"], json!("north"));
        assert_eq!(report["faces"][0]["uv"], json!([4.0,4.0,8.0,8.0]));
        assert_eq!(report["faces"][0]["alpha"]["region"]["opaque_pixels"], json!(1));
        assert_eq!(report["faces"][0]["alpha"]["region"]["transparent_pixels"], json!(15));
        assert_eq!(report["faces"][1]["side"], json!("east"));
        assert_eq!(report["faces"][1]["alpha"]["region"]["opaque_pixels"], json!(0));
        assert_eq!(report["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(session.document(), &original);
        let reimported = EditorSession::open(&session.export().unwrap()).unwrap();
        assert_eq!(reimported.document(), &original);
        assert!(report.to_string().find("data:image/png").is_none());
    }

    // Authored-only verification: decode behavior/native runtime NOT_EXECUTED.
    #[test]
    fn code_mode_alpha_inspection_reuses_the_rust_png_codec_without_mutation() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Alpha test", "alpha_test").unwrap()
        ).unwrap();
        let id = "00000000-0000-4000-8000-000000000811";
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: id.into(), name: "alpha.png".into()
        }]).unwrap();
        let saved = session.document().clone();
        let total = u64::from(saved.resolution.width) * u64::from(saved.resolution.height);
        let initial = inspect_paint_alpha(session.document(), id).unwrap();
        assert_eq!(initial["kind"], json!("texture_alpha"));
        assert_eq!(initial["texture_uuid"], json!(id));
        assert_eq!(initial["inspection"]["supported"], json!(true));
        assert_eq!(initial["inspection"]["transparent_pixels"], json!(total));
        assert_eq!(initial["inspection"]["opaque_pixels"], json!(0));
        assert_eq!(initial["inspection"]["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(initial["inspection"]["face_coverage_verdict"], json!("UNVERIFIED"));
        assert_eq!(initial["inspection"]["tile_samples"].as_array().unwrap().len(), 8);
        assert!(initial.to_string().find("data:image/png").is_none());
        assert_eq!(session.document(), &saved);

        session.apply(1, &[
            EditOperation::PaintTexturePixel { texture_index:0, x:0, y:0, rgba:[10,20,30,255] },
            EditOperation::PaintTexturePixel { texture_index:0, x:1, y:0, rgba:[10,20,30,128] },
        ]).unwrap();
        let changed = inspect_paint_alpha(session.document(), id).unwrap();
        assert_eq!(changed["inspection"]["opaque_pixels"], json!(1));
        assert_eq!(changed["inspection"]["translucent_pixels"], json!(1));
        assert_eq!(changed["inspection"]["transparent_pixels"], json!(total - 2));
        assert_eq!(changed["inspection"]["tile_nonzero_alpha"][0][0], json!(2));

        let mut corrupt = session.document().clone();
        corrupt.texture_assets[0]["source"] = json!("data:image/png;base64,AAAA");
        assert!(inspect_paint_alpha(&corrupt, id).is_err());

        let mut multi_file = session.document().clone();
        multi_file.extensions.insert("multi_file_ruleset".into(),
            json!("bedrock_attachable"));
        let multi_file_report = inspect_paint_alpha(&multi_file, id).unwrap();
        assert_eq!(multi_file_report["inspection"]["supported"], json!(false));
        assert_eq!(multi_file_report["inspection"]["reason"],
            json!("PER_TEXTURE_UV_RULES_UNSUPPORTED"));

        let imported = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let preserved = imported.clone();
        let unsupported = inspect_paint_alpha(
            &imported, "00000000-0000-4000-8000-000000000101").unwrap();
        assert_eq!(unsupported["inspection"]["supported"], json!(false));
        assert_eq!(unsupported["inspection"]["reason"],
            json!("UNSUPPORTED_FORMAT_OR_METADATA"));
        assert_eq!(preserved, imported);
        assert_eq!(inspect_paint_alpha(&imported, "missing").unwrap_err(),
            "PAINT_TEXTURE_NOT_FOUND");
    }

    // Source-authored only: no Cargo, native app or model visual QA executed.
    #[test]
    fn code_mode_cube_surfaces_are_bounded_read_only_and_do_not_claim_visual_coverage() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let uuid = doc.cubes[0].uuid.clone();
        let before = doc.clone();
        let report = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(report["scope"], json!("saved_geometry_and_face_references"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["effective_material"], json!("UNVERIFIED"));
        assert_eq!(report["geometry"]["size"], json!([4.0, 4.0, 4.0]));
        assert_eq!(report["faces"].as_array().unwrap().len(), 6);
        assert_eq!(report["faces"][0]["side"], json!("north"));
        assert_eq!(report["faces"][0]["reference_kind"], json!("index"));
        assert_eq!(report["faces"][0]["texture_index"], json!(0));
        assert_eq!(report["faces"][0]["texture_uuid"],
            json!("00000000-0000-4000-8000-000000000101"));
        assert_eq!(report["faces"][0]["source_kind"], json!("embedded_png_declared"));
        assert_eq!(report["faces"][0]["uv_rotation"], json!(90));
        assert_eq!(report["faces"][2]["reference_kind"], json!("null"));
        assert!(report.to_string().find("data:image/png").is_none());
        assert!(report.to_string().find("vendor_extension").is_none());
        assert_eq!(doc, before);

        let texture_id = doc.texture_assets[0]["uuid"].as_str().unwrap().to_owned();
        doc.cubes[0].faces["east"]["texture"] = json!(texture_id);
        let linked = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(linked["faces"][1]["reference_kind"], json!("uuid"));
        assert_eq!(linked["faces"][1]["texture_index"], json!(0));
        doc.cubes[0].faces["east"]["texture"] = json!(false);
        let inherited = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(inherited["faces"][1]["reference_kind"], json!("false"));
        doc.cubes[0].faces.get_mut("east").unwrap()
            .as_object_mut().unwrap().remove("texture");
        let unset = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(unset["faces"][1]["reference_kind"], json!("unset"));
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        let scoped = inspect_cube_surfaces(&doc, &uuid).unwrap();
        assert_eq!(scoped["uv"]["per_texture_rules"], json!(true));
        assert_eq!(scoped["effective_material"], json!("UNVERIFIED"));
        assert_eq!(inspect_cube_surfaces(&doc, "missing-cube").unwrap_err(),
            "CUBE_NOT_FOUND");
    }

    // Source-authored only; Cargo/local execution remains on hold.
    #[test]
    fn code_mode_recognized_rotation_track_has_uuid_time_and_numeric_axes() {
        let mut session = EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = session.document().bones[0].uuid.clone();
        let anim = "00000000-0000-4000-8000-000000000701";
        let key = "00000000-0000-4000-8000-000000000702";
        session.apply(0, &[
            EditOperation::CreateAnimation { uuid: anim.into(), name: "inspection".into(), length: 2.0 },
            EditOperation::AddBoneRotationKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: key.into(), time: 1.0, rotation: [0.0, 35.0, 0.0],
            }
        ]).unwrap();
        let original = session.document().clone();
        let track = inspect_rotation_track(session.document(), anim, &bone, 0, 16).unwrap();
        assert_eq!(track["recognized"], json!(true));
        assert_eq!(track["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(track["total_frames"], json!(1));
        assert_eq!(track["keyframes"][0]["uuid"], json!(key));
        assert_eq!(track["keyframes"][0]["time"], json!(1.0));
        assert_eq!(track["keyframes"][0]["rotation"], json!([0.0, 35.0, 0.0]));
        assert!(track["next_offset"].is_null());
        assert_eq!(session.document(), &original);
        assert_eq!(inspect_rotation_track(session.document(), anim, &bone, 0, 65).unwrap_err(),
            "ANIMATION_INSPECT_PAGE_INVALID");
        let mut opaque = original.clone();
        opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"] =
            json!("query.head_yaw");
        let restricted = inspect_rotation_track(&opaque, anim, &bone, 0, 8).unwrap();
        assert_eq!(restricted["recognized"], json!(false));
        assert!(restricted["keyframes"].as_array().unwrap().is_empty());
        assert_eq!(opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"],
            json!("query.head_yaw"));
    }

    // Source regression only: Rust executable, CLI and native app not run.
    #[test]
    fn code_mode_transform_track_read_covers_position_rotation_scale_and_refuses_opaque() {
        let mut session = EditorSession::open(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = session.document().bones[0].uuid.clone();
        let anim = "00000000-0000-4000-8000-000000000711";
        session.apply(0, &[
            EditOperation::CreateAnimation { uuid: anim.into(), name: "walk".into(), length: 2.0 },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000712".into(),
                channel: "position".into(), time: 0.5, value: [1.0, 2.0, 3.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000713".into(),
                channel: "scale".into(), time: 1.0, value: [1.0, 2.0, 1.0],
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.clone(),
                keyframe_uuid: "00000000-0000-4000-8000-000000000714".into(),
                channel: "rotation".into(), time: 1.5, value: [0.0, 30.0, 0.0],
            },
        ]).unwrap();
        let before = session.document().clone();
        for (channel, time, values) in [
            ("position", 0.5, [1.0, 2.0, 3.0]),
            ("scale", 1.0, [1.0, 2.0, 1.0]),
            ("rotation", 1.5, [0.0, 30.0, 0.0]),
        ] {
            let track = inspect_transform_track(session.document(), anim, &bone,
                channel, 0, 16).unwrap();
            assert_eq!(track["recognized"], json!(true));
            assert_eq!(track["channel"], json!(channel));
            assert_eq!(track["total_frames"], json!(1));
            assert_eq!(track["keyframes"][0]["time"], json!(time));
            assert_eq!(track["keyframes"][0]["value"], json!(values));
            assert_eq!(track["visual_verdict"], json!("UNVERIFIED"));
        }
        assert_eq!(session.document(), &before);
        assert_eq!(inspect_transform_track(session.document(), anim, &bone,
            "bad", 0, 16).unwrap_err(), "ANIMATION_INSPECT_CHANNEL_INVALID");
        assert_eq!(inspect_transform_track(session.document(), anim, &bone,
            "position", 0, 65).unwrap_err(), "ANIMATION_INSPECT_PAGE_INVALID");
        let mut opaque = before.clone();
        opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"] =
            json!("query.anim_time");
        let refused = inspect_transform_track(&opaque, anim, &bone,
            "scale", 0, 16).unwrap();
        assert_eq!(refused["recognized"], json!(false));
        assert!(refused["keyframes"].as_array().unwrap().is_empty());
        assert_eq!(opaque.animation_assets[0]["animators"][bone.as_str()]["keyframes"][0]["data_points"][0]["x"],
            json!("query.anim_time"));
    }

    #[test]
    fn code_mode_read_sha_gate_rejects_stale_and_malformed_expected_hash() {
        let actual = "a".repeat(64);
        assert!(ensure_source_sha(&actual, &actual).is_ok());
        assert!(ensure_source_sha(&actual, &actual.to_uppercase()).is_ok());
        assert_eq!(ensure_source_sha(&actual, &"b".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        assert_eq!(ensure_source_sha(&actual, "bad").unwrap_err(),
            "SOURCE_SHA256_STALE");
    }

    #[test]
    fn code_mode_static_audit_counts_reference_shapes_without_visual_claims() {
        let doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-texture-interchange.bbmodel")).unwrap();
        let original = doc.clone();
        let report = inspect_model_audit(&doc);
        assert_eq!(report["scope"], json!("static_metadata_only"));
        assert_eq!(report["visual_verdict"], json!("UNVERIFIED"));
        assert_eq!(report["faces"]["total"], json!(6));
        assert_eq!(report["faces"]["null_or_absent"], json!(1));
        assert_eq!(report["faces"]["numeric_reference"], json!(5));
        assert_eq!(report["textures"]["embedded_png_declared"], json!(1));
        assert_eq!(report["textures"]["external_relative_declared"], json!(1));
        assert_eq!(report["animation"]["declared_animator_tracks"], json!(1));
        assert_eq!(doc, original);
    }

    // Source-authored regression; local execution remains on hold.
    #[test]
    fn code_mode_catalog_pages_identities_and_retains_model_state() {
        let source = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
        let doc = AuthoringDocument::import_bbmodel(source).unwrap();
        let before = doc.clone();
        let list = inspect_catalog(&doc, "cubes", 0, 1).unwrap();
        assert_eq!(list["total"], json!(doc.cubes.len()));
        assert_eq!(list["entries"][0]["uuid"], json!(doc.cubes[0].uuid));
        assert_eq!(list["entries"][0]["kind"], json!("cube"));
        assert_eq!(doc, before);
        assert_eq!(inspect_catalog(&doc, "unsupported", 0, 32).unwrap_err(),
            "INSPECT_LIST_KIND_UNKNOWN");
    }

    #[test]
    fn code_mode_asset_metadata_is_read_only() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../../fixtures/bedrock-basic.bbmodel")).unwrap();
        doc.texture_assets.push(json!({
            "uuid":"00000000-0000-4000-8000-000000000777",
            "name":"texture.png","source":"data:image/png;base64,SECRET",
        }));
        let texture = inspect_asset(&doc,"texture","0").unwrap();
        assert_eq!(texture["source_kind"], json!("embedded_png"));
        assert!(texture.get("source").is_none());
        assert_eq!(inspect_asset(&doc,"texture","99").unwrap_err(),
            "INSPECT_TEXTURE_NOT_FOUND");
    }

    #[test]
    fn code_mode_focused_inspect_is_bounded_and_read_only() {
        let source = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
        let doc = AuthoringDocument::import_bbmodel(source).unwrap();
        let before = doc.clone();
        let id = doc.cubes[0].uuid.clone();
        let detail = focused_element(&doc, &id).unwrap();
        assert_eq!(detail["uuid"], json!(id));
        assert_eq!(detail["kind"], json!("cube"));
        assert!(detail["faces"]["north"]["uv"].is_array());
        assert_eq!(doc, before);
        assert_eq!(focused_element(&doc, "not-an-element").unwrap_err(),
            "ELEMENT_NOT_IN_OUTLINER");
    }

    // Source-authored regression only; native filesystem execution is held.
    #[test]
    fn refuses_to_overwrite_an_existing_project() {
        let folder = std::env::temp_dir().join(
            format!("lazydesigner-regression-{:016x}", rand::rng().next_u64())
        );
        fs::create_dir(&folder).unwrap();
        let target = folder.join("existing.bbmodel");
        fs::write(&target, b"original").unwrap();
        assert_eq!(publish_new(&target, b"replacement", MAX_MODEL_BYTES).unwrap_err(), "OUTPUT_ALREADY_EXISTS");
        assert_eq!(fs::read(&target).unwrap(), b"original");
        fs::remove_file(target).unwrap();
        fs::remove_dir(folder).unwrap();
    }
    #[test]
    fn bedrock_geometry_export_follows_verified_source_and_no_overwrite() {
        let dir = std::env::temp_dir().join(
            format!("lazydesigner-cli-geometry-{:016x}", rand::rng().next_u64()));
        fs::create_dir(&dir).unwrap();
        let input = dir.join("model.bbmodel");
        let output = dir.join("model.geo.json");
        let original = include_bytes!("../../../fixtures/bedrock-basic.bbmodel");
        fs::write(&input, original).unwrap();
        assert_eq!(read_verified_source(&input, &"f".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        let (source, expected_sha) = read_verified_source(&input, &sha256(original)).unwrap();
        let session = EditorSession::open(&source).unwrap();
        let bytes = export_bedrock_geometry(session.document()).unwrap();
        same_directory(&input, &output).unwrap();
        publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES).unwrap();
        assert_eq!(fs::read(&output).unwrap(), bytes);
        assert_eq!(publish_new_geometry(&output, &bytes, MAX_MODEL_BYTES).unwrap_err(),
            "OUTPUT_ALREADY_EXISTS");
        assert_eq!(expected_sha, sha256(original));
        assert_eq!(fs::read(&input).unwrap(), original);
        fs::remove_file(output).unwrap();
        fs::remove_file(input).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn png_export_reuses_sha_guard_and_never_overwrites() {
        let dir = std::env::temp_dir().join(
            format!("lazydesigner-export-{:016x}", rand::rng().next_u64()));
        fs::create_dir(&dir).unwrap();
        let input = dir.join("model.bbmodel");
        let output = dir.join("texture.png");
        let id = "00000000-0000-4000-8000-000000000801";
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Export", "export").unwrap()
        ).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: id.into(), name: "texture.png".into(),
        }]).unwrap();
        let original = session.export().unwrap();
        fs::write(&input, &original).unwrap();
        assert_eq!(read_verified_source(&input, &"f".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        let (verified, expected) = read_verified_source(&input, &sha256(&original)).unwrap();
        let reopened = EditorSession::open(&verified).unwrap();
        let png_bytes = export_paint_png(reopened.document(), id).unwrap();
        assert!(png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        same_directory(&input, &output).unwrap();
        publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES).unwrap();
        assert_eq!(fs::read(&output).unwrap(), png_bytes);
        assert_eq!(publish_new_png(&output, &png_bytes, MAX_EXPORT_PNG_BYTES).unwrap_err(),
            "OUTPUT_ALREADY_EXISTS");
        assert_eq!(sha256(&original), expected);
        assert_eq!(fs::read(&input).unwrap(), original);
        fs::remove_file(input).unwrap();
        fs::remove_file(output).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    // Source-only CLI regression: no executable test was run.
    #[test]
    fn import_png_and_apply_share_a_sha_guarded_source_reader() {
        let folder = std::env::temp_dir().join(
            format!("lazydesigner-import-{:016x}", rand::rng().next_u64())
        );
        fs::create_dir(&folder).unwrap();
        let file = folder.join("source.bbmodel");
        let bytes = AuthoringDocument::new_bedrock("Source", "source")
            .unwrap().export_bbmodel().unwrap();
        fs::write(&file, &bytes).unwrap();
        let expected = sha256(&bytes);
        let (verified, got) = read_verified_source(&file, &expected).unwrap();
        assert_eq!(verified, bytes);
        assert_eq!(got, expected);
        assert_eq!(read_verified_source(&file, &"0".repeat(64)).unwrap_err(),
            "SOURCE_SHA256_STALE");
        assert_eq!(read_verified_source(&file, "short").unwrap_err(),
            "SOURCE_SHA256_STALE");
        fs::remove_file(file).unwrap();
        fs::remove_dir(folder).unwrap();
    }
