// SOURCE_AUTHORED_NOT_RUN: original inline tests, unchanged aside from
// include_bytes paths relative to the extracted test module.
    use super::*;

    // SOURCE_AUTHORED_NOT_RUN: the native Rust semantic preview uses one
    // disposable candidate and cannot change original revision/Undo.
    fn semantic_preview_fixture() -> (EditorSession,SemanticMaterialIntent) {
        const TEXTURE: &str = "00000000-0000-4000-8000-000000000101";
        const CUBE: &str = "00000000-0000-4000-8000-000000000002";
        let mut doc=AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let mut pixels=vec![0u8;64*32*4];
        for y in 2usize..6 { for x in 1usize..5 {
            let index=(y*64+x)*4;
            pixels[index..index+4].copy_from_slice(&[90,110,130,255]);
        }}
        let mut png_bytes=Vec::new();
        {
            let mut encoder=png::Encoder::new(&mut png_bytes,64,32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer=encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }
        doc.texture_assets[0]=json!({
            "uuid":TEXTURE,"name":"preview-metal.png",
            "source":format!("data:image/png;base64,{}",
                STANDARD.encode(&png_bytes)),
            "internal":true,"wrap_mode":"limited",
            "render_mode":"default","render_sides":"double",
            "paint_owner":"lazydesigner-rgba8-v1",
            "uv_width":64,"uv_height":32,
        });
        let session=EditorSession::from_document(doc).unwrap();
        let intent=serde_json::from_value(json!({
            "expected_revision":0,"reference_png_sha256":"b".repeat(64),
            "cube_uuid":CUBE,"texture_uuid":TEXTURE,
            "face":"north","material":"painted_metal",
            "light_corner":"upper_left","contrast":"balanced",
            "source_base_rgba":[90,110,130,255],
            "shadow_rgb":[52,62,80],
            "highlight_rgb":[160,175,195],
            "protected_regions":[],"expected_before_pixels":[]
        })).unwrap();
        (session,intent)
    }

    #[test]
    fn semantic_material_ephemeral_candidate_does_not_edit_source_or_history() {
        let (source,intent)=semantic_preview_fixture();
        let before=source.export().unwrap();
        let before_hash=source.canonical_sha256().unwrap();
        let (proposal,candidate)=preview_semantic_candidate(&source,&intent).unwrap();
        assert_eq!(proposal.preflight["status"],"VALIDATED_NOT_APPLIED");
        assert_eq!(proposal.preflight["candidate_sha256"],
            json!(candidate.canonical_sha256().unwrap()));
        assert_ne!(candidate.export().unwrap(),before);
        assert_eq!(source.export().unwrap(),before);
        assert_eq!(source.canonical_sha256().unwrap(),before_hash);
        assert_eq!(source.summary().revision,0);
        assert!(!source.can_undo());
        assert!(!source.can_redo());
        assert_eq!(candidate.summary().revision,1);
    }

    #[test]
    fn semantic_material_sha_binding_refuses_replacement_without_partial_commit() {
        let (mut source,intent)=semantic_preview_fixture();
        let original=source.export().unwrap();
        let original_sha=source.canonical_sha256().unwrap();
        let (_proposal,candidate)=preview_semantic_candidate(&source,&intent).unwrap();
        let candidate_sha=candidate.canonical_sha256().unwrap();
        let wrong="c".repeat(64);
        let err=apply_checked_semantic_candidate(
            &mut source,&intent,&wrong,&candidate_sha).err().unwrap();
        assert_eq!(err.code,"SEMANTIC_PREVIEW_SOURCE_STALE");
        assert_eq!(source.export().unwrap(),original);
        let err=apply_checked_semantic_candidate(
            &mut source,&intent,&original_sha,&wrong).err().unwrap();
        assert_eq!(err.code,"SEMANTIC_PREVIEW_CANDIDATE_STALE");
        assert_eq!(source.export().unwrap(),original);
        assert_eq!(source.summary().revision,0);
        assert!(!source.can_undo());
        apply_checked_semantic_candidate(
            &mut source,&intent,&original_sha,&candidate_sha).unwrap();
        assert_eq!(source.canonical_sha256().unwrap(),candidate_sha);
        assert_eq!(source.summary().revision,1);
        assert!(source.can_undo());
        source.undo(1).unwrap();
        assert_eq!(source.export().unwrap(),original);
        assert_eq!(source.summary().revision,2);
    }


    // SOURCE ONLY: frozen read consumes the same authoritative session as
    // the GUI; an older candidate is not a live edit or a stale success.
    #[test]
    fn frozen_semantic_read_and_preflight_refuse_stale_gui_revision() {
        let session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube = session.document().cubes[0].uuid.clone();
        let store = Mutex::new(EditorStore {
            epoch: 41,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let pinned = frozen_read_session(&store, 41, 0).unwrap();
        let map = pinned.semantic_map("cubes", 0, 4).unwrap();
        assert_eq!(map["revision"], 0);
        let plan = EditPlan {
            expected_revision: 0,
            operations: vec![EditOperation::TranslateCube {
                uuid: cube.clone(), delta: [1.0, 0.0, 0.0],
            }],
            correction_scope: None,
        };
        let preview = pinned.preflight(&plan).unwrap();
        assert_eq!(preview["status"], "VALIDATED_NOT_APPLIED");
        {
            let mut guard = store.lock().unwrap();
            let active = guard.active.as_mut().unwrap();
            active.session.apply(0, &plan.operations).unwrap();
            assert_eq!(active.session.summary().revision, 1);
        }
        assert_eq!(pinned.summary().revision, 0);
        assert_eq!(frozen_read_session(&store, 41, 0).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        assert_eq!(frozen_read_session(&store, 40, 1).err().unwrap().code,
            "RUST_EDITOR_SESSION_STALE");
        assert_eq!(frozen_read_session(&store, 41, 1).unwrap().summary().revision, 1);
    }

    // Source-authored only: the single publication lease excludes edits/model
    // replacement, while read-only snapshots can still acquire the store.
    // No user-PC, filesystem or Tauri runtime test has been executed.
    #[test]
    fn frozen_publication_releases_store_lock_and_refuses_stale_model() {
        let raw = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(raw).unwrap();
        let expected = session.canonical_sha256().unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 22, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: Some(expected.clone()), dirty: false,
            }),
        });
        let gate = Mutex::new(());
        let lease = write_lease(&gate).unwrap();
        let frozen = freeze_publication(&store, 22, 0, "stale").unwrap();
        assert_eq!(frozen.session.canonical_sha256().unwrap(), expected);
        assert!(store.try_lock().is_ok());
        assert_eq!(write_lease(&gate).err().unwrap().code, "RUST_EDITOR_EDIT_BUSY");
        let blocked = detached_edit(&store, &gate, 22, 0,
            ProjectionReuse::default(), None, |_| {
                panic!("A pending edit must not start during publication.");
            }).unwrap_err();
        assert_eq!(blocked.code, "RUST_EDITOR_EDIT_BUSY");
        drop(lease);
        let output = frozen.session.export().unwrap();
        assert_eq!(sha256(&output), expected);

        let new_lease = write_lease(&gate).unwrap();
        {
            // Simulates an uncoordinated or stale writer for revision refusal.
            let mut guard = store.lock().unwrap();
            guard.active.as_mut().unwrap().session.apply(0, &[
                EditOperation::CreateAnimation {
                    uuid:"00000000-0000-4000-8000-000000000986".into(),
                    name:"changed".into(), length:1.0,
                }
            ]).unwrap();
        }
        assert_eq!(freeze_publication(&store, 22, 0, "stale")
            .err().unwrap().code, "RUST_EDITOR_REVISION_STALE");
        store.lock().unwrap().epoch += 1;
        assert_eq!(freeze_publication(&store, 22, 1, "stale")
            .err().unwrap().code, "RUST_EDITOR_SESSION_STALE");
        drop(new_lease);
    }

    // A read-only publisher continues to reject a changed on-disk original.
    // The independent user-owned no-overwrite publisher remains untouched.
    #[test]
    fn frozen_publication_rechecks_raw_source_before_writing_new_sibling() {
        let dir = std::env::temp_dir().join(format!(
            "ld-publish-{:016x}", rand::rng().next_u64()));
        std::fs::create_dir(&dir).unwrap();
        let input = dir.join("source.bbmodel");
        let output = dir.join("new-copy.bbmodel");
        let raw = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        std::fs::write(&input, raw).unwrap();
        let session = EditorSession::open(raw).unwrap();
        let source = FrozenPublication {
            session, source_path: Some(input.clone()),
            source_sha: Some(sha256(raw)),
            saved_canonical_sha: None, dirty: true,
        };
        verify_publication_source(&source, &output, "changed").unwrap();
        assert!(!output.exists());
        std::fs::write(&input, b"other source data").unwrap();
        assert_eq!(verify_publication_source(&source, &output, "changed")
            .unwrap_err().code, "RUST_EDITOR_SOURCE_CHANGED");
        assert!(!output.exists());
        std::fs::remove_file(input).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    // Preserve numeric accepted JSON vector projection without cloning the
    // source Value/allocating a serde owned-deserialization temporary.
    #[test]
    fn borrowed_vec3_projection_matches_previous_owned_decoder() {
        for value in [
            json!([1, 2.5, -3]), json!([0, 0, 0]), json!([3, 4]),
            json!([1, 2, 3, 4]), json!(["1", 2, 3]),
            json!([1, true, 3]), json!([1, null, 3]),
            json!({"x":1,"y":2,"z":3}), json!(null),
        ] {
            let expected = serde_json::from_value::<[f64; 3]>(value.clone())
                .ok().filter(|vec| vec.iter().all(|axis| axis.is_finite()));
            assert_eq!(borrowed_vec3(&value), expected);
        }
        let mut properties = Map::new();
        properties.insert("rotation".into(), json!([90.0, 0, -20.5]));
        assert_eq!(property_vec3(&properties, "rotation"), [90.0, 0.0, -20.5]);
        properties.insert("rotation".into(), json!([false, 0, 0]));
        assert_eq!(property_vec3(&properties, "rotation"), [0.0; 3]);
    }

    // SOURCE-AUTHORED_NOT_RUN: prepared transactions never hold the store
    // lock across cloning, validation or canonical hashing, and a competing
    // authoring revision cannot be overwritten by a late provisional edit.
    #[test]
    fn detached_transactions_are_revision_guarded_and_retain_history() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 7, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let gate = Mutex::new(());
        let accepted = detached_edit(&store, &gate, 7, 0, ProjectionReuse::default(), None, |pending| {
            assert!(store.try_lock().is_ok());
            pending.apply(0, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000915".into(),
                name:"first".into(), length:1.0,
            }]).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(accepted.revision, 1);
        assert_eq!(accepted.animation_count, 1);
        assert!(accepted.can_undo);
        // Competing edit admission must fail before staging another model.
        let lease = gate.lock().unwrap();
        let busy = detached_edit(&store, &gate, 7, 1, ProjectionReuse::default(), None, |_| {
            panic!("busy lease must refuse before edit closure");
        }).unwrap_err();
        assert_eq!(busy.code, "RUST_EDITOR_EDIT_BUSY");
        drop(lease);

        let stale = detached_edit(&store, &gate, 7, 1, ProjectionReuse::default(), None, |pending| {
            pending.apply(1, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000916".into(),
                name:"uncommitted".into(), length:1.0,
            }]).map_err(model_failure)?;
            let mut guard = store.lock().unwrap();
            guard.active.as_mut().unwrap().session.apply(1, &[
                EditOperation::CreateAnimation {
                    uuid:"00000000-0000-4000-8000-000000000917".into(),
                    name:"other".into(), length:1.0,
                },
            ]).map_err(model_failure)?;
            Ok(())
        }).unwrap_err();
        assert_eq!(stale.code, "RUST_MODEL_REJECTED");
        assert_eq!(stale.message, "DOCUMENT_REVISION_STALE");
        {
            let guard = store.lock().unwrap();
            let active = guard.active.as_ref().unwrap();
            assert_eq!(active.session.summary().revision, 2);
            assert_eq!(active.session.document().animation_assets.len(), 2);
            assert!(!active.session.document().animation_assets.iter().any(|asset|
                asset["name"] == "uncommitted"));
        }
        let after = detached_edit(&store, &gate, 7, 2, ProjectionReuse::default(), None, |pending| {
            assert!(store.try_lock().is_ok());
            pending.undo(2).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(after.revision, 3);
        assert_eq!(after.animation_count, 1);
        assert!(after.can_redo);
        let restored = detached_edit(&store, &gate, 7, 3, ProjectionReuse::default(), None, |pending| {
            pending.redo(3).map_err(model_failure)?;
            Ok(())
        }).unwrap();
        assert_eq!(restored.revision, 4);
        assert_eq!(restored.animation_count, 2);
    }

    #[test]
    fn detached_transaction_refuses_replaced_model_epoch() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 3, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let gate = Mutex::new(());
        let error = detached_edit(&store, &gate, 3, 0, ProjectionReuse::default(), None, |pending| {
            pending.apply(0, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000000918".into(),
                name:"abandoned".into(), length:1.0,
            }]).map_err(model_failure)?;
            store.lock().unwrap().epoch = 4;
            Ok(())
        }).unwrap_err();
        assert_eq!(error.code, "RUST_EDITOR_SESSION_STALE");
        let guard = store.lock().unwrap();
        assert!(guard.active.as_ref().unwrap().session.document()
            .animation_assets.is_empty());
        assert_eq!(guard.active.as_ref().unwrap().session.summary().revision, 0);
    }

    // SOURCE-AUTHORED_NOT_RUN: expensive projection must hold an immutable
    // document revision even after another writer commits; the store lock
    // becomes available before the projection itself runs.
    #[test]
    fn frozen_projection_releases_mutex_without_mixing_revisions() {
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()
        ).unwrap();
        let store = Mutex::new(EditorStore {
            epoch: 9, active: Some(ActiveModel {
                session, source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        });
        let frozen = {
            let guard = store.lock().unwrap();
            freeze_projection(&guard).unwrap()
        };
        let before = project_frozen(&frozen, ProjectionReuse::default());
        {
            let mut guard = store.try_lock().unwrap();
            let active = guard.active.as_mut().unwrap();
            active.session.apply(0, &[EditOperation::CreateAnimation {
                uuid: "00000000-0000-4000-8000-000000000982".into(),
                name: "idle".into(), length: 1.0,
            }]).unwrap();
            refresh_dirty(active);
        }
        let first = project_frozen(&frozen, ProjectionReuse {
            preview: Some(&before.preview_source_key), ..ProjectionReuse::default()
        });
        let after = project_detached(store.lock().unwrap(), ProjectionReuse {
            preview: Some(&before.preview_source_key), ..ProjectionReuse::default()
        })
            .unwrap();
        assert_eq!((before.epoch, before.revision), (9, 0));
        assert_eq!((first.epoch, first.revision, first.animation_count), (9, 0, 0));
        assert_eq!((after.epoch, after.revision, after.animation_count), (9, 1, 1));
        assert_eq!(first.texture_preview_sources.len(), 0);
        assert!(after.preview_sources_reused);
        assert!(store.try_lock().is_ok());
    }

    // SOURCE-AUTHORED_NOT_RUN: projections are exactly content- and
    // epoch-bound. Editing one family must not invalidate unchanged others.
    #[test]
    fn geometry_animation_reuse_is_content_and_epoch_bound() {
        let mut store = EditorStore {
            epoch: 21, active: Some(ActiveModel {
                session: EditorSession::from_document(
                    AuthoringDocument::new_bedrock("Slices", "slices").unwrap()
                ).unwrap(), source_path: None, source_sha: None,
                saved_canonical_sha: None, dirty: true,
            }),
        };
        let full = project(&store).unwrap();
        assert_eq!(full.geometry_source_key, projection_source_key(full.epoch,
            b"geometry", &(&full.cubes, &full.bones, &full.hierarchy)));
        let hints = ProjectionReuse {
            geometry: Some(&full.geometry_source_key),
            animation: Some(&full.animation_source_key),
            ..ProjectionReuse::default()
        };
        let same = project_frozen(&freeze_projection(&store).unwrap(), hints);
        assert!(same.geometry_reused && same.animations_reused);
        assert!(same.cubes.is_empty() && same.bones.is_empty());
        assert!(same.hierarchy.is_empty() && same.animations.is_empty());
        store.active.as_mut().unwrap().session.apply(0, &[
            EditOperation::CreateAnimation {
                uuid: "00000000-0000-4000-8000-000000001981".into(),
                name: "idle".into(), length: 1.0,
            },
        ]).unwrap();
        let changed_anim = project_frozen(&freeze_projection(&store).unwrap(), hints);
        assert!(changed_anim.geometry_reused && !changed_anim.animations_reused);
        assert_eq!(changed_anim.animations.len(), 1);
        let new_hints = ProjectionReuse {
            geometry: Some(&changed_anim.geometry_source_key),
            animation: Some(&changed_anim.animation_source_key),
            ..ProjectionReuse::default()
        };
        store.active.as_mut().unwrap().session.apply(1, &[
            EditOperation::AddBone {
                bone: Bone { uuid: "00000000-0000-4000-8000-000000001982".into(),
                    name: "root".into(), origin: Some([0.0, 0.0, 0.0]),
                    extra: Map::new() },
                parent_uuid: None,
            },
        ]).unwrap();
        let changed_geo = project_frozen(&freeze_projection(&store).unwrap(), new_hints);
        assert!(!changed_geo.geometry_reused && changed_geo.animations_reused);
        assert_eq!(changed_geo.bones.len(), 1);
        assert_eq!(changed_geo.hierarchy.len(), 1);
        assert_eq!(changed_geo.geometry_source_key, projection_source_key(changed_geo.epoch,
            b"geometry", &(&changed_geo.cubes, &changed_geo.bones, &changed_geo.hierarchy)));
        assert!(changed_geo.animations.is_empty());
        store.epoch += 1;
        let different_epoch = project_frozen(&freeze_projection(&store).unwrap(), new_hints);
        assert!(!different_epoch.geometry_reused && !different_epoch.animations_reused);
    }

    // Source-authored Rust/Tauri projection regression; native tests held.
    #[test]
    fn editor_png_transport_reuse_requires_exact_epoch_and_source_content() {
        const TEX: &str = "00000000-0000-4000-8000-000000009989";
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Preview", "preview").unwrap()).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid:TEX.into(), name:"test.png".into(),
        }]).unwrap();
        let mut store=EditorStore { epoch:7, active:Some(ActiveModel {
            session, source_path:None, source_sha:None,
            saved_canonical_sha:None, dirty:true,
        }) };
        let full=project(&store).unwrap();
        assert!(!full.preview_sources_reused);
        assert_eq!(full.texture_preview_sources.len(),1);
        assert!(full.texture_preview_sources[0].is_some());
        let reused=project_with_preview_reuse(&store,Some(&full.preview_source_key)).unwrap();
        assert!(reused.preview_sources_reused);
        assert!(reused.texture_preview_sources.is_empty());
        assert_eq!(reused.revision,full.revision);
        let unknown=project_with_preview_reuse(&store,Some("bad-digest")).unwrap();
        assert!(!unknown.preview_sources_reused);
        assert_eq!(unknown.texture_preview_sources,full.texture_preview_sources);
        store.active.as_mut().unwrap().session.apply(1,&[EditOperation::PaintTexturePixel {
            texture_index:0, x:0, y:0, rgba:[20,30,40,255],
        }]).unwrap();
        let painted=project_with_preview_reuse(&store,Some(&full.preview_source_key)).unwrap();
        assert!(!painted.preview_sources_reused);
        assert_ne!(painted.preview_source_key,full.preview_source_key);
        assert_ne!(painted.texture_preview_sources,full.texture_preview_sources);
        store.epoch+=1;
        let reopened=project_with_preview_reuse(&store,Some(&painted.preview_source_key)).unwrap();
        assert!(!reopened.preview_sources_reused);
        assert_ne!(reopened.preview_source_key,painted.preview_source_key);
        // An animation-only transaction must retain the same Paint source key
        // and omit immutable embedded PNG bytes when the editor knows it.
        let before_animation_revision=store.active.as_ref().unwrap()
            .session.summary().revision;
        store.active.as_mut().unwrap().session.apply(
            before_animation_revision, &[EditOperation::CreateAnimation {
                uuid:"00000000-0000-4000-8000-000000009988".into(),
                name:"idle".into(), length:1.0,
            }],
        ).unwrap();
        let after_animation=project_with_preview_reuse(
            &store,Some(&reopened.preview_source_key)).unwrap();
        assert_eq!(after_animation.revision,before_animation_revision+1);
        assert!(after_animation.preview_sources_reused);
        assert!(after_animation.texture_preview_sources.is_empty());
        assert_eq!(after_animation.preview_source_key,reopened.preview_source_key);
    }


    // SOURCE ONLY: Tauri app/file-dialog and localtest are held.
    #[test]
    fn animation_export_consumer_reuses_rust_document_without_modification() {
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Native", "native").unwrap()).unwrap();
        const CLIP: &str = "00000000-0000-4000-8000-000000009999";
        session.apply(0, &[EditOperation::CreateAnimation {
            uuid: CLIP.into(), name: "animation.idle".into(), length: 1.0,
        }]).unwrap();
        let before = session.document().clone();
        let bytes = export_bedrock_animations(session.document()).unwrap();
        let output: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(output["format_version"], "1.8.0");
        assert_eq!(bedrock_animation_curve_fidelity(session.document()), "native");
        assert!(output["animations"].get("animation.idle").is_some());
        assert_eq!(session.document(), &before);
        let mut opaque = before;
        opaque.animation_assets[0]["opaque"] = json!(true);
        assert_eq!(export_bedrock_animations(&opaque).unwrap_err(),
            "ANIMATION_EXPORT_CLIP_UNSUPPORTED");
    }

    // SOURCE ONLY: tests remain on hold. Imported JSON formatting must not
    // conflate the raw disk-source identity with canonical editor content.
    #[test]
    fn open_checkpoint_streams_canonical_sha_and_keeps_original_disk_identity() {
        const RAW: &[u8] = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let compact = serde_json::to_vec(
            &serde_json::from_slice::<Value>(RAW).unwrap()
        ).unwrap();
        assert_ne!(compact.as_slice(), RAW);
        let session = EditorSession::open(&compact).unwrap();
        let raw_sha = sha256(&compact);
        let canonical_sha = session.canonical_sha256().unwrap();
        assert_ne!(raw_sha, canonical_sha);
        // Independent export is the byte-level parity oracle, not the
        // production Open path used solely to obtain the fingerprint.
        assert_eq!(canonical_sha, sha256(&session.export().unwrap()));
        let mut active = ActiveModel {
            session, source_path: Some(PathBuf::from("model.bbmodel")),
            source_sha: Some(raw_sha.clone()),
            saved_canonical_sha: Some(canonical_sha.clone()),
            dirty: false,
        };
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        assert_eq!(active.source_sha.as_deref(), Some(raw_sha.as_str()));
        assert_eq!(active.saved_canonical_sha.as_deref(),
            Some(canonical_sha.as_str()));
    }

    // A stale restore decision cannot silently replace a newer native edit.
    #[test]
    fn restore_revision_gate_rejects_stale_active_document() {
        let mut store = EditorStore::default();
        assert!(check_restore_revision(&store, 0).is_ok());
        assert_eq!(check_restore_revision(&store, 1).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        let session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Recover", "recover").unwrap()
        ).unwrap();
        store.active = Some(ActiveModel {
            session, source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        });
        assert!(check_restore_revision(&store, 0).is_ok());
        assert_eq!(check_restore_revision(&store, 2).err().unwrap().code,
            "RUST_EDITOR_REVISION_STALE");
        assert!(check_discard(&store, false).is_err());
    }

    // SOURCE AUTHORED; NOT_EXECUTED under the Rust branch's localtest hold.
    #[test]
    fn canonical_save_checkpoint_reconciles_dirty_on_apply_undo_redo() {
        const BASIC: &[u8] =
            include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(BASIC).unwrap();
        let saved = sha256(&session.export().unwrap());
        assert_eq!(session.canonical_sha256().unwrap(), saved);
        let raw_sha = sha256(BASIC);
        let cube_uuid = session.document().cubes[0].uuid.clone();
        let mut active = ActiveModel {
            session,
            source_path: Some(PathBuf::from("source.bbmodel")),
            source_sha: Some(raw_sha.clone()),
            saved_canonical_sha: Some(saved),
            dirty: false,
        };
        assert!(!active.dirty);
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.apply(0, &[EditOperation::TranslateCube {
            uuid: cube_uuid, delta: [1.0, 0.0, 0.0],
        }]).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.undo(1).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.redo(2).unwrap();
        assert_eq!(active.session.canonical_sha256().unwrap(),
            sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(active.dirty);
        // Save Copy establishes a new checkpoint without removing history.
        active.saved_canonical_sha = Some(sha256(&active.session.export().unwrap()));
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        active.session.undo(3).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.redo(4).unwrap();
        refresh_dirty(&mut active);
        assert!(!active.dirty);
        // Disk identity remains independent of model-content identity.
        assert_eq!(active.source_sha, Some(raw_sha));
    }

    #[test]
    fn new_unsaved_project_stays_dirty_after_history_returns_to_initial_state() {
        let document = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let cube_uuid = document.cubes[0].uuid.clone();
        let mut active = ActiveModel {
            session: EditorSession::from_document(document).unwrap(),
            source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        };
        active.session.apply(0, &[EditOperation::TranslateCube {
            uuid: cube_uuid, delta: [2.0, 0.0, 0.0],
        }]).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
        active.session.undo(1).unwrap();
        refresh_dirty(&mut active);
        assert!(active.dirty);
    }

    // Source authored only; test execution remains held.
    #[test]
    fn empty_project_has_no_claimed_model() {
        let store = EditorStore::default();
        assert!(project(&store).is_none());
        assert_eq!(store.epoch, 0);
    }

    // SOURCE ONLY: no live canvas capture or native test execution.
    #[test]
    fn review_capture_requires_real_decoded_png_and_an_exact_saved_model() {
        let valid = png_candidate(32, 32);
        assert!(decode_review_capture_png(&valid).is_ok());
        for bad in [
            "data:image/png;base64,",
            "data:image/png;base64,AAAA",
            "data:image/jpeg;base64,AAAA",
        ] {
            assert!(decode_review_capture_png(bad).is_err());
        }
        assert!(decode_review_capture_png(&png_candidate(16, 16)).is_err());
        let raw = include_bytes!("../../fixtures/bedrock-basic.bbmodel");
        let session = EditorSession::open(raw).unwrap();
        let mut active = ActiveModel {
            session, source_path: None, source_sha: None,
            saved_canonical_sha: None, dirty: true,
        };
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err());
        let tmp = std::env::temp_dir().join(format!(
            "ld-review-{:016x}.bbmodel", rand::rng().next_u64()));
        let canonical = active.session.export().unwrap();
        std::fs::write(&tmp, &canonical).unwrap();
        let exact = sha256(&canonical);
        active.source_path = Some(tmp.clone());
        active.source_sha = Some(exact.clone());
        active.saved_canonical_sha = Some(exact.clone());
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err()); // still dirty
        active.dirty = false;
        assert_eq!(review_capture_source(&FrozenPublication::from(&active)).unwrap().1, exact);
        std::fs::write(&tmp, b"external model changed").unwrap();
        assert!(review_capture_source(&FrozenPublication::from(&active)).is_err());
        let _ = std::fs::remove_file(tmp);
    }

    fn png_candidate(width: u32, height: u32) -> String {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&vec![0; width as usize * height as usize * 4]).unwrap();
        }
        format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
    }

    // SOURCE-AUTHORED_NOT_RUN: bounded streaming Base64 preview must retain
    // strict whole-source syntax validation without caching decoded PNG data.
    #[test]
    fn streaming_png_preview_rejects_invalid_suffix_and_preserves_header_only_admission() {
        const PREFIX: &str = "data:image/png;base64,";
        let candidate = png_candidate(32, 32);
        let texture = json!({"source":candidate});
        let before = texture.clone();
        assert_eq!(embedded_png_preview_candidate(&texture)
            .map(|(_, width, height)| [width, height]), Some([32, 32]));
        assert_eq!(texture, before);

        // A valid IHDR followed by malformed Base64 is not an admitted
        // preview. Checking only the first 33 decoded bytes would miss it.
        let bad_tail = format!("{candidate}!");
        assert!(embedded_png_preview_source(&json!({"source":bad_tail})).is_none());
        let mut bad_middle = candidate.clone();
        let encoded_offset = PREFIX.len() + 60;
        bad_middle.replace_range(encoded_offset..encoded_offset + 1, "@");
        assert!(embedded_png_preview_source(&json!({"source":bad_middle})).is_none());

        // Legacy admission checked only that a complete 33-byte PNG header
        // existed, not full PNG CRC; the browser still performs final decode.
        let bytes = STANDARD.decode(candidate.strip_prefix(PREFIX).unwrap()).unwrap();
        let header_only = format!("{PREFIX}{}", STANDARD.encode(&bytes[..33]));
        assert_eq!(embedded_png_preview_candidate(&json!({"source":header_only}))
            .map(|(_, width, height)| [width, height]), Some([32, 32]));
    }

    #[test]
    fn texture_projection_checks_png_header_and_rejects_unsupported_sources() {
        let candidate = png_candidate(2, 2);
        assert_eq!(embedded_png_preview_source(&json!({"source":candidate})), Some(candidate.clone()));
        assert!(embedded_png_preview_source(&json!({"source":"https://example.test/atlas.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"relative_path":"textures/entity/atlas.png"})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":"data:image/png;base64,iVBORw0KGgoAAAABAAAAAA=="})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":"data:image/png;base64,AAAA"})).is_none());
        let oversized_source = format!("data:image/png;base64,iVBORw0KGgo{}", "A".repeat(2 * 1024 * 1024));
        assert!(embedded_png_preview_source(&json!({"source":oversized_source})).is_none());
        let mut bytes = STANDARD.decode(candidate.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
        bytes[16..20].copy_from_slice(&4097u32.to_be_bytes());
        assert!(embedded_png_preview_source(&json!({
            "source": format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
        })).is_none());
        bytes[16..20].copy_from_slice(&2u32.to_be_bytes());
        bytes[20..24].copy_from_slice(&0u32.to_be_bytes());
        assert!(embedded_png_preview_source(&json!({
            "source": format!("data:image/png;base64,{}", STANDARD.encode(&bytes))
        })).is_none());
        let mut doc = AuthoringDocument::new_bedrock("Synthetic", "synthetic").unwrap();
        doc.resolution.width = 2;
        doc.resolution.height = 2;
        doc.texture_assets.push(json!({"source":candidate}));
        assert_eq!(texture_preview_sources(&doc), vec![Some(candidate.clone())]);
        doc.extensions.insert("multi_file_ruleset".into(), json!("textures"));
        assert_eq!(texture_preview_sources(&doc), vec![None]);
    }

    #[test]
    fn texture_projection_refuses_mismatched_png_and_uv_grid_without_mutating_model() {
        let mut doc = AuthoringDocument::new_bedrock("UV", "uv").unwrap();
        doc.resolution.width = 16;
        doc.resolution.height = 16;
        let mismatched = png_candidate(8, 16);
        doc.texture_assets.push(json!({"source":mismatched}));
        let before = doc.texture_assets.clone();
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        assert_eq!(doc.texture_assets, before);

        let matching = png_candidate(16, 16);
        doc.texture_assets[0] = json!({"source":matching, "uv_width":8, "uv_height":16});
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        doc.texture_assets[0]["uv_width"] = json!(16);
        doc.texture_assets[0]["uv_height"] = json!(32);
        assert_eq!(texture_preview_sources(&doc), vec![None]);
        doc.texture_assets[0]["uv_height"] = json!(16);
        assert_eq!(texture_preview_sources(&doc), vec![Some(matching)]);
        // A manually selected atlas uses exactly this source-bound UV rule.
        assert_eq!(project_atlas_preview_grid(&doc,&doc.texture_assets[0],16,16),
            Some([16,16]));
        assert_eq!(project_atlas_preview_grid(&doc,&doc.texture_assets[0],16,8),
            None);
    }

    // SOURCE-AUTHORED_NOT_RUN: indexed texture scope resolution must retain
    // the old ambiguity and admitted-PNG refusal semantics across many Cubes.
    #[test]
    fn indexed_attachable_texture_scopes_reject_duplicates_and_unavailable_png() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        let png = png_candidate(16, 16);
        doc.texture_assets = (1..=12).map(|scope| json!({
            "uuid":format!("00000000-0000-4000-8000-{scope:012}"),
            "scope":scope, "name":format!("scope_{scope}.png"),
            "source":png, "uv_width":128, "uv_height":128
        })).collect();
        let immutable = doc.clone();
        let assets = texture_preview_assets(&doc);
        let indexed = texture_scope_indices(&doc);
        assert_eq!(indexed.len(),12);
        let mut cube = doc.cubes[0].clone();
        for scope in 1..=12u64 {
            cube.extra.insert("scope".into(), json!(scope));
            assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
                PreviewUvMode::ScopedAttachable), Some((scope - 1) as usize));
        }
        assert_eq!(doc,immutable);
        cube.extra.insert("scope".into(), json!(0));
        assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
            PreviewUvMode::ScopedAttachable),None);
        cube.extra.insert("scope".into(), json!(2));
        assert_eq!(scoped_cube_texture_index(None, &cube, &assets,
            PreviewUvMode::ScopedAttachable),None);
        assert_eq!(scoped_cube_texture_index(Some(&indexed), &cube, &assets,
            PreviewUvMode::Unsupported),None);

        // Duplicate scopes refuse even when both sources look otherwise valid.
        doc.texture_assets[0]["scope"] = json!(2);
        let duplicate = texture_scope_indices(&doc);
        assert_eq!(duplicate.get(&2),Some(&None));
        assert_eq!(scoped_cube_texture_index(Some(&duplicate), &cube,
            &texture_preview_assets(&doc), PreviewUvMode::ScopedAttachable),None);

        // Unique scope is still refused when its source exceeds the bounded
        // preview admission rule; other scopes remain unchanged.
        doc.texture_assets[0]["scope"] = json!(1);
        doc.texture_assets[1]["source"] = json!("data:image/png;base64,AAAA");
        let restricted = texture_preview_assets(&doc);
        let refreshed = texture_scope_indices(&doc);
        assert_eq!(scoped_cube_texture_index(Some(&refreshed), &cube,
            &restricted, PreviewUvMode::ScopedAttachable),None);
        cube.extra.insert("scope".into(),json!(3));
        assert_eq!(scoped_cube_texture_index(Some(&refreshed), &cube,
            &restricted, PreviewUvMode::ScopedAttachable),Some(2));
    }

    // Source-authored regression only; native WebView2/Blockbench is held.
    #[test]
    fn scoped_attachable_preview_maps_each_cube_to_its_texture_uv_grid() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        doc.cubes[0].extra.insert("scope".into(), json!(2));
        let first = png_candidate(8, 16);
        let second = png_candidate(16, 8);
        doc.texture_assets = vec![
            json!({
                "uuid":"00000000-0000-4000-8000-000000000901",
                "name":"body.png", "scope":1, "source":first,
                "uv_width":32, "uv_height":64
            }),
            json!({
                "uuid":"00000000-0000-4000-8000-000000000902",
                "name":"armor.png", "scope":2, "source":second,
                "uv_width":64, "uv_height":32
            })
        ].into();
        let original = doc.clone();
        let store = EditorStore {
            epoch: 17,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let preview = project(&store).unwrap();
        assert!(preview.scoped_texture_preview);
        assert_eq!(preview.texture_preview_sources, vec![Some(first), Some(second)]);
        assert_eq!(preview.texture_preview_resolutions,
            vec![Some([32, 64]), Some([64, 32])]);
        assert_eq!(preview.cubes[0].preview_texture_index, Some(1));
        assert_eq!(preview.texture_resolution, [128, 128]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        // Only the renderer gains a limited, read-only scoped preview.
        assert!(!can_add_paint_texture(&original));
        assert!(!paint_texture_exportable(&original, 1));
    }

    #[test]
    fn scoped_preview_refuses_duplicate_scopes_opaque_grids_and_other_rulesets() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.extensions.insert("multi_file_ruleset".into(), json!("bedrock_attachable"));
        doc.cubes[0].extra.insert("scope".into(), json!(2));
        let source = png_candidate(16, 8);
        doc.texture_assets = vec![
            json!({"uuid":"00000000-0000-4000-8000-000000000903",
                "scope":1, "source":source, "uv_width":64, "uv_height":32}),
            json!({"uuid":"00000000-0000-4000-8000-000000000904",
                "scope":2, "source":source, "uv_width":64, "uv_height":32})
        ].into();
        let safe = texture_preview_assets(&doc);
        assert_eq!(safe[1].as_ref().map(|(_, uv)| *uv), Some([64, 32]));
        assert_eq!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &safe,
            preview_uv_mode(&doc)), Some(1));
        // Duplicate texture scopes are ambiguous even when their PNGs match.
        doc.texture_assets[0]["scope"] = json!(2);
        let candidates = texture_preview_assets(&doc);
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &candidates,
            preview_uv_mode(&doc)).is_none());

        doc.texture_assets[0]["scope"] = json!(1);
        doc.texture_assets[1]["uv_width"] = json!("64");
        let invalid = texture_preview_assets(&doc);
        assert!(invalid[1].is_none());
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0], &invalid,
            preview_uv_mode(&doc)).is_none());

        doc.texture_assets[1]["uv_width"] = json!(64);
        doc.texture_assets[1]["uv_height"] = json!(64);
        // Different PNG and UV-grid aspect ratios imply an unsupported
        // flipbook projection, even if both dimensions are valid integers.
        assert!(texture_preview_assets(&doc)[1].is_none());

        doc.texture_assets[1].as_object_mut().unwrap().remove("uv_width");
        doc.texture_assets[1].as_object_mut().unwrap().remove("uv_height");
        doc.texture_assets[1]["source"] = json!(png_candidate(16, 16));
        let project_fallback = texture_preview_assets(&doc);
        assert_eq!(project_fallback[1].as_ref().map(|(_, uv)| *uv), Some([128, 128]));

        doc.texture_assets[1]["relative_path"] = json!("textures/armor.png");
        assert!(texture_preview_assets(&doc)[1].is_none());
        doc.texture_assets[1].as_object_mut().unwrap().remove("relative_path");
        doc.texture_assets[1]["layers"] = json!([{"name":"unflattened"}]);
        assert!(texture_preview_assets(&doc)[1].is_none());
        doc.texture_assets[1].as_object_mut().unwrap().remove("layers");
        doc.cubes[0].extra.remove("scope");
        assert!(scoped_cube_texture_index(Some(&texture_scope_indices(&doc)), &doc.cubes[0],
            &texture_preview_assets(&doc), preview_uv_mode(&doc)).is_none());
        doc.cubes[0].extra.insert("scope".into(), json!(2));

        doc.meta.extra.insert("per_texture_uv_size".into(), json!(false));
        assert_eq!(preview_uv_mode(&doc), PreviewUvMode::Unsupported);
        assert!(texture_preview_assets(&doc).iter().all(Option::is_none));
        doc.meta.extra.remove("per_texture_uv_size");

        doc.extensions.insert("multi_file_ruleset".into(), json!("unreviewed_ruleset"));
        assert_eq!(preview_uv_mode(&doc), PreviewUvMode::Unsupported);
        assert!(texture_preview_assets(&doc).iter().all(Option::is_none));
    }

    #[test]
    fn texture_projection_bounds_total_decoded_pixels_and_texture_count() {
        let candidate = png_candidate(2048, 2048);
        let mut doc = AuthoringDocument::new_bedrock("Bounded", "bounded").unwrap();
        doc.resolution.width = 2048;
        doc.resolution.height = 2048;
        doc.texture_assets.push(json!({"source":candidate}));
        doc.texture_assets.push(json!({"source":candidate}));
        let projected = texture_preview_sources(&doc);
        assert!(projected[0].is_some());
        assert!(projected[1].is_none());
        let small = png_candidate(1, 1);
        doc.resolution.width = 1;
        doc.resolution.height = 1;
        doc.texture_assets = (0..18).map(|_| json!({"source":small})).collect();
        let projected = texture_preview_sources(&doc);
        assert_eq!(projected.iter().filter(|source| source.is_some()).count(), 16);
        assert!(projected[16].is_none() && projected[17].is_none());
    }

    #[test]
    fn texture_preview_limits_modes_and_preserves_render_sides() {
        let candidate = png_candidate(2, 2);
        let standard = json!({"source":candidate});
        assert_eq!(texture_preview_side(&standard), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"auto"})), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"front"})), Some("front"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"double"})), Some("double"));
        assert_eq!(texture_preview_side(&json!({"render_sides":"back"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"emissive"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"additive"})), None);
        assert_eq!(texture_preview_side(&json!({"render_mode":"layered"})), None);
        assert!(embedded_png_preview_source(&standard).is_some());
        assert!(embedded_png_preview_source(&json!({"source":candidate,
            "render_mode":"emissive"})).is_none());
        assert!(embedded_png_preview_source(&json!({"source":candidate,
            "render_sides":"back"})).is_none());
    }

    #[test]
    fn paint_editability_projection_matches_rust_generated_texture_gate() {
        let candidate = json!({
            "uuid":"test", "name":"paint.png",
            "source":"data:image/png;base64,iVBORw0KGgoAAAABAAAAAA==",
            "internal":true, "wrap_mode":"limited",
            "render_mode":"default", "render_sides":"double",
            "paint_owner":"lazydesigner-rgba8-v1"
        });
        assert!(paint_texture_editable(&candidate));
        let mut injected = candidate;
        injected["vendor_extension"] = json!({"preserve":true});
        assert!(!paint_texture_editable(&injected));
        assert!(!paint_texture_editable(&json!({"paint_owner":"lazydesigner-rgba8-v1"})));
    }

    #[test]
    fn new_cube_faces_bind_the_first_bedrock_texture_uuid() {
        let textures = vec![
            json!({"uuid":"00000000-0000-4000-8000-000000000101","name":"first.png"}),
            json!({"uuid":"00000000-0000-4000-8000-000000000102","name":"second.png"}),
        ];
        let unchanged = textures.clone();
        let faces = new_cube_faces(&textures);
        assert_eq!(faces.len(), 6);
        for face in faces.values() {
            assert_eq!(face["texture"], textures[0]["uuid"]);
            assert_eq!(face["uv"], json!([0.0, 0.0, 2.0, 2.0]));
        }
        assert_eq!(textures, unchanged);
    }

    #[test]
    fn new_cube_faces_do_not_invent_missing_texture_uuids() {
        let no_textures = new_cube_faces(&[]);
        let legacy = new_cube_faces(&[json!({"name":"legacy.png"})]);
        for face in no_textures.values().chain(legacy.values()) {
            assert_eq!(face["texture"], json!(false));
        }
        let legacy_with_second_uuid = new_cube_faces(&[
            json!({"name":"legacy.png"}),
            json!({"uuid":"00000000-0000-4000-8000-000000000102"}),
        ]);
        assert_eq!(legacy_with_second_uuid["north"]["texture"], json!(false));
    }

    #[test]
    fn source_projection_is_derived_from_the_single_rust_document() {
        let doc = AuthoringDocument::new_bedrock("Synthetic", "synthetic").unwrap();
        let session = EditorSession::from_document(doc).unwrap();
        let store = EditorStore {
            epoch: 4,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.epoch, 4);
        assert_eq!(snapshot.name, "Synthetic");
        assert_eq!(snapshot.cubes.len(), 0);
        assert_eq!(snapshot.preview_scope, "UNVERIFIED_EMBEDDED_PNG_SUBSET");
    }

    #[test]
    fn bone_visibility_snapshot_is_derived_from_authoritative_rust_data() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        doc.bones[0].extra.insert("visibility".into(), json!(false));
        doc.cubes[0].extra.insert("visibility".into(), json!(false));
        let store = EditorStore {
            epoch: 2,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert!(!snapshot.bones[0].visible);
        assert!(!snapshot.cubes[0].visible);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &doc);
    }


    #[test]
    fn cube_render_order_snapshot_follows_pinned_blockbench_priorities() {
        for (order, expected) in [
            (None, 0i8), (Some("default"), 0),
            (Some("behind"), -1), (Some("in_front"), 1),
        ] {
            let mut doc = AuthoringDocument::import_bbmodel(
                include_bytes!("../../fixtures/bedrock-basic.bbmodel")
            ).unwrap();
            if let Some(value) = order {
                doc.cubes[0].extra.insert("render_order".into(), json!(value));
            }
            let store = EditorStore {
                epoch: 12,
                active: Some(ActiveModel {
                    session: EditorSession::from_document(doc.clone()).unwrap(),
                    source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
                }),
            };
            assert_eq!(project(&store).unwrap().cubes[0].render_order, expected);
            assert_eq!(store.active.as_ref().unwrap().session.document(), &doc);
        }
    }


    #[test]
    fn per_texture_preview_refusal_matches_rust_edit_gate() {
        let mut doc = AuthoringDocument::new_bedrock("UV metadata", "uv_metadata").unwrap();
        doc.resolution.width = 2;
        doc.resolution.height = 2;
        let valid_png = png_candidate(2, 2);
        doc.texture_assets.push(json!({"source":valid_png}));
        assert_eq!(texture_preview_sources(&doc), vec![Some(valid_png.clone())]);
        for location in ["meta", "project"] {
            for flag in [json!(true), json!("true"), json!(17), Value::Null] {
                if location == "meta" {
                    doc.meta.extra.insert("per_texture_uv_size".into(), flag.clone());
                } else {
                    doc.extensions.insert("per_texture_uv_size".into(), flag.clone());
                }
                assert!(has_per_texture_uv_rules(&doc));
                let before = doc.clone();
                assert_eq!(texture_preview_sources(&doc), vec![None]);
                assert_eq!(doc, before);
                doc.meta.extra.remove("per_texture_uv_size");
                doc.extensions.remove("per_texture_uv_size");
            }
            if location == "meta" {
                doc.meta.extra.insert("per_texture_uv_size".into(), json!(false));
            } else {
                doc.extensions.insert("per_texture_uv_size".into(), json!(false));
            }
            assert!(!has_per_texture_uv_rules(&doc));
            assert_eq!(texture_preview_sources(&doc), vec![Some(valid_png.clone())]);
            doc.meta.extra.remove("per_texture_uv_size");
            doc.extensions.remove("per_texture_uv_size");
        }
        doc.extensions.insert("multi_file_ruleset".into(), json!("textures"));
        assert!(has_per_texture_uv_rules(&doc));
        assert_eq!(texture_preview_sources(&doc), vec![None]);
    }


    #[test]
    fn new_bone_parent_origin_and_atomic_core_document_are_consistent() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        // This test reviews the typed operation the Add Bone Tauri command invokes.
        let parent = doc.bones[0].uuid.clone();
        let parent_origin = doc.bones[0].origin.unwrap_or([0.0, 0.0, 0.0]);
        let id = "00000000-0000-4000-8000-000000000099";
        let mut session = EditorSession::from_document(doc.clone()).unwrap();
        session.apply(0, &[EditOperation::AddBone {
            bone: Bone {
                uuid: id.into(), name: "bone".into(),
                origin: Some(parent_origin), extra: Map::new(),
            },
            parent_uuid: Some(parent),
        }]).unwrap();
        assert_eq!(session.document().bones.last().unwrap().origin, Some(parent_origin));
        assert_eq!(session.document().bones.last().unwrap().name, "bone");
        session.undo(1).unwrap();
        assert_eq!(session.document(), &doc);
    }


    #[test]
    fn created_animation_rotation_keyframe_projects_without_mutating_model() {
        let mut session = EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let anim = "00000000-0000-4000-8000-000000000320";
        let key = "00000000-0000-4000-8000-000000000321";
        let bone = "00000000-0000-4000-8000-000000000001";
        session.apply(0, &[
            EditOperation::CreateAnimation {
                uuid: anim.into(), name: "animation.new".into(), length: 2.0,
            },
            EditOperation::AddBoneRotationKeyframe {
                animation_uuid: anim.into(), bone_uuid: bone.into(),
                keyframe_uuid: key.into(), time: 0.5, rotation: [0.0, 90.0, 0.0],
            },
        ]).unwrap();
        let original = session.document().clone();
        let store = EditorStore {
            epoch: 3,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.animation_count, 1);
        assert_eq!(snapshot.animations.len(), 1);
        assert_eq!(snapshot.animations[0].uuid, anim);
        assert_eq!(snapshot.animations[0].rotation_keyframes[0].uuid, key);
        assert_eq!(snapshot.animations[0].rotation_keyframes[0].rotation, [0.0, 90.0, 0.0]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
    }


    // SOURCE_AUTHORED_NOT_RUN: timeline markers are positional annotations,
    // not audio/particle execution or generated persistent marker UUIDs.
    #[test]
    fn animation_timeline_markers_project_from_rust_without_fake_playback() {
        let mut session=EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007621";
        let key="00000000-0000-4000-8000-000000007622";
        let bone="00000000-0000-4000-8000-000000000001";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"walk".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:key.into(),channel:"rotation".into(),
                time:0.5,value:[0.0,30.0,0.0],
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:0.5,
                name:"left_foot_contact".into(),color:6,
            },
            EditOperation::AddAnimationTimelineMarker {
                animation_uuid:anim.into(),time:1.5,
                name:"right_foot_contact".into(),color:3,
            },
        ]).unwrap();
        let source=session.document().clone();
        let views=animation_views(&source);
        assert_eq!(views.len(),1);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),1);
        assert_eq!(views[0].markers.len(),2);
        assert_eq!(views[0].markers[0].name,"left_foot_contact");
        assert_eq!(views[0].markers[0].time,0.5);
        assert_eq!(views[0].markers[1].color,3);
        let store=EditorStore {
            epoch:2,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animations[0].markers.len(),2);
        assert_eq!(snapshot.animations[0].rotation_keyframes.len(),1);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&source);
        let mut imported=source.clone();
        imported.animation_assets[0]["markers"][0]["color"]=json!(10);
        let unsupported=animation_views(&imported);
        assert!(!unsupported[0].preview_supported);
        assert!(unsupported[0].markers.is_empty());
        assert!(unsupported[0].transform_keyframes.is_empty());
        assert_eq!(source.animation_assets[0]["markers"][0]["color"],json!(6));
    }

    // SOURCE_AUTHORED_NOT_RUN: an admitted sound/particle event is saved
    // metadata, not a playable sound or a particle rendered by the preview.
    // Tauri must refuse partial visual-only "supported" playback.
    #[test]
    fn animation_effect_markers_do_not_fake_supported_tauri_playback() {
        let mut session=EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007551";
        let rot="00000000-0000-4000-8000-000000007552";
        let sound="00000000-0000-4000-8000-000000007553";
        let bone="00000000-0000-4000-8000-000000000001";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"attack".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:rot.into(),channel:"rotation".into(),
                time:0.5,value:[0.0,45.0,0.0],
            },
        ]).unwrap();
        assert!(animation_views(session.document())[0].preview_supported);
        session.apply(1,&[EditOperation::AddAnimationEffectEvent {
            animation_uuid:anim.into(),keyframe_uuid:sound.into(),
            channel:"sound".into(),time:0.5,
            points:vec![lazydesigner::authoring::AnimationEffectPoint {
                effect:"robot.attack".into(),locator:None,bind_to_actor:None,
            }],
        }]).unwrap();
        let saved=session.document().clone();
        let views=animation_views(&saved);
        assert_eq!(views.len(),1);
        assert!(!views[0].preview_supported);
        assert!(views[0].rotation_keyframes.is_empty());
        assert!(views[0].transform_keyframes.is_empty());
        assert_eq!(saved.animation_assets[0]["animators"]["effects"]["keyframes"][0]
            ["data_points"][0]["effect"],json!("robot.attack"));
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animations.len(),1);
        assert!(!snapshot.animations[0].preview_supported);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&saved);
    }

    // SOURCE_AUTHORED_NOT_RUN: a single Rust Clone Clip operation is
    // discoverable by the existing Tauri Animation snapshot without
    // rebuilding per-Bone keyframe controls or altering the preview owner.
    #[test]
    fn duplicated_animation_clip_projects_as_distinct_tauri_animation() {
        let mut session=EditorSession::open(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim="00000000-0000-4000-8000-000000007401";
        let copy="00000000-0000-4000-8000-000000007402";
        let bone="00000000-0000-4000-8000-000000000001";
        let key="00000000-0000-4000-8000-000000007403";
        session.apply(0,&[
            EditOperation::CreateAnimation {
                uuid:anim.into(),name:"idle".into(),length:2.0,
            },
            EditOperation::AddBoneTransformKeyframe {
                animation_uuid:anim.into(),bone_uuid:bone.into(),
                keyframe_uuid:key.into(),channel:"rotation".into(),
                time:1.0,value:[0.0,90.0,0.0],
            },
        ]).unwrap();
        let previous=session.document().clone();
        session.apply(1,&[EditOperation::DuplicateAnimationClip {
            source_uuid:anim.into(),new_uuid:copy.into(),new_name:"attack".into(),
        }]).unwrap();
        let saved=session.document().clone();
        let views=animation_views(&saved);
        assert_eq!(views.len(),2);
        assert!(views.iter().all(|view|view.preview_supported));
        assert_eq!(views[0].name,"idle");
        assert_eq!(views[1].name,"attack");
        assert_eq!(views[0].uuid,anim);
        assert_eq!(views[1].uuid,copy);
        assert_eq!(views[0].transform_keyframes.len(),1);
        assert_eq!(views[1].transform_keyframes.len(),1);
        assert_eq!(views[0].transform_keyframes[0].uuid,key);
        assert_ne!(views[1].transform_keyframes[0].uuid,key);
        assert_eq!(views[0].transform_keyframes[0].value,
            views[1].transform_keyframes[0].value);
        assert_eq!(views[0].transform_keyframes[0].interpolation,
            views[1].transform_keyframes[0].interpolation);
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session,source_path:None,source_sha:None,
                saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert_eq!(snapshot.animation_count,2);
        assert_eq!(snapshot.animations.len(),2);
        assert_eq!(snapshot.animations[1].name,"attack");
        assert_eq!(snapshot.animations[1].length,2.0);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&saved);
        assert_eq!(saved.animation_assets[0],previous.animation_assets[0]);
    }

    // SOURCE_AUTHORED_NOT_RUN: Tauri projects only validated numeric Bezier
    // handles from the one Rust document, never sampled or inferred curves.
    #[test]
    fn animation_projection_bezier_handles_and_unsafe_imports() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone="00000000-0000-4000-8000-000000000001";
        let clip="00000000-0000-4000-8000-000000009921";
        let key="00000000-0000-4000-8000-000000009922";
        doc.animation_assets.push(json!({
            "uuid":clip,"name":"bezier","loop":"once","length":2.0,
            "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone]=json!({
            "name":"root_bone","type":"bone","keyframes":[
                {
                    "uuid":key,"channel":"position","time":0.0,
                    "interpolation":"bezier",
                    "data_points":[{"x":"0","y":"0","z":"0"}],
                    "bezier_linked":false,
                    "bezier_left_time":[-0.25,-0.25,-0.25],
                    "bezier_left_value":[0,0,0],
                    "bezier_right_time":[0.5,0.5,0.5],
                    "bezier_right_value":[8,0,0]
                },
                {
                    "uuid":"00000000-0000-4000-8000-000000009923",
                    "channel":"position","time":2.0,
                    "interpolation":"linear",
                    "data_points":[{"x":"10","y":"0","z":"0"}]
                }
            ]
        });
        let before=doc.clone();
        let views=animation_views(&doc);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),2);
        assert_eq!(views[0].transform_keyframes[0].interpolation,"bezier");
        let handle=views[0].transform_keyframes[0].bezier.as_ref().unwrap();
        assert!(!handle.linked);
        assert_eq!(handle.right_time,[0.5;3]);
        assert_eq!(handle.right_value,[8.0,0.0,0.0]);
        assert!(views[0].transform_keyframes[1].bezier.is_none());
        let json=serde_json::to_value(&views[0].transform_keyframes[0]).unwrap();
        assert_eq!(json["bezier"]["rightTime"],json!([0.5,0.5,0.5]));
        let store=EditorStore {
            epoch:1,active:Some(ActiveModel {
                session:EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None,source_sha:None,saved_canonical_sha:None,dirty:true,
            }),
        };
        let snapshot=project(&store).unwrap();
        assert!(snapshot.animations[0].preview_supported);
        assert!(snapshot.animations[0].transform_keyframes[0].bezier.is_some());
        assert_eq!(store.active.as_ref().unwrap().session.document(),&before);

        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"]=json!([-0.5,0.5,0.5]);
        let refused=animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_value"]=Value::Null;
        assert!(!animation_views(&doc)[0].preview_supported);

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][1]
            ["bezier_linked"]=json!(false);
        assert!(!animation_views(&doc)[0].preview_supported);

        doc=before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"]=json!([1.9,1.9,1.9]);
        doc.animation_assets[0]["animators"][bone]["keyframes"][1]
            ["interpolation"]=json!("bezier");
        for (field,value) in [
            ("bezier_linked",json!(false)),
            ("bezier_left_time",json!([-1.9,-1.9,-1.9])),
            ("bezier_left_value",json!([0,0,0])),
            ("bezier_right_time",json!([0.1,0.1,0.1])),
            ("bezier_right_value",json!([0,0,0])),
        ] {
            doc.animation_assets[0]["animators"][bone]["keyframes"][1][field]=value;
        }
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(before.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["bezier_right_time"],json!([0.5,0.5,0.5]));
    }

    // SOURCE_AUTHORED_NOT_RUN: step is carried as explicit saved metadata
    // from Rust to Tauri. No unverified keyframe is presented as a pose.
    #[test]
    fn animation_projection_keeps_step_interpolation_and_refuses_unsupported_modes() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = "00000000-0000-4000-8000-000000000001";
        let anim = "00000000-0000-4000-8000-000000009991";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"step_pose", "loop":"once", "length":2.0,
            "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "type":"bone", "name":"root_bone", "keyframes":[
                {"uuid":"p0","channel":"position","time":0.0,
                 "interpolation":"step",
                 "data_points":[{"x":"0","y":"0","z":"0"}]},
                {"uuid":"p2","channel":"position","time":2.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"4","y":"0","z":"0"}]},
                {"uuid":"r0","channel":"rotation","time":0.0,
                 "interpolation":"step",
                 "data_points":[{"x":"0","y":"45","z":"0"}]}
            ]
        });
        let original = doc.clone();
        let projected = animation_views(&doc);
        assert!(projected[0].preview_supported);
        assert_eq!(projected[0].transform_keyframes.len(),3);
        assert_eq!(projected[0].transform_keyframes[0].interpolation,"step");
        assert_eq!(projected[0].transform_keyframes[1].interpolation,"linear");
        assert_eq!(projected[0].transform_keyframes[2].interpolation,"step");
        let store = EditorStore {
            epoch:1,active:Some(ActiveModel {
                session:EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None,source_sha:None,saved_canonical_sha:None,dirty:true,
            }),
        };
        let view = project(&store).unwrap();
        assert_eq!(view.animations[0].transform_keyframes[0].interpolation,"step");
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"] = json!("catmullrom");
        let curved = animation_views(&doc);
        assert!(curved[0].preview_supported);
        assert_eq!(curved[0].transform_keyframes[0].interpolation,"catmullrom");
        // Bezier without complete saved numeric handles remains opaque.
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"] = json!("bezier");
        let refused = animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());
        assert_eq!(original.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["interpolation"],json!("step"));
    }

    // Authored-only Rust/Tauri regression; native playback remains held.
    #[test]
    fn transform_preview_projects_position_scale_and_rotation_without_mutation() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let bone = "00000000-0000-4000-8000-000000000001";
        let anim = "00000000-0000-4000-8000-000000009701";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"walking", "length":2.0,
            "loop":"once", "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "type":"bone", "name":"root_bone", "keyframes":[
                {"uuid":"k-rotation", "channel":"rotation", "time":0.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"0","y":"45","z":"0"}]},
                {"uuid":"k-position", "channel":"position", "time":1.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"2","y":"0","z":"1"}]},
                {"uuid":"k-scale", "channel":"scale", "time":2.0,
                 "interpolation":"linear",
                 "data_points":[{"x":"1","y":"1.5","z":"1"}]}
            ]
        });
        let original = doc.clone();
        let views = animation_views(&doc);
        assert_eq!(views.len(),1);
        assert!(views[0].preview_supported);
        assert_eq!(views[0].transform_keyframes.len(),3);
        assert_eq!(views[0].rotation_keyframes.len(),1);
        assert_eq!(views[0].transform_keyframes[1].channel,"position");
        assert_eq!(views[0].transform_keyframes[2].value,[1.0,1.5,1.0]);
        assert_eq!(doc,original);
        let store = EditorStore {
            epoch:1, active:Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path:None, source_sha:None,
                saved_canonical_sha:None, dirty:true,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.animations[0].transform_keyframes.len(),3);
        assert_eq!(store.active.as_ref().unwrap().session.document(),&doc);

        doc.animation_assets[0]["animators"][bone]["keyframes"][2]
            ["data_points"][0]["y"] = json!("-1");
        let refused = animation_views(&doc);
        assert!(!refused[0].preview_supported);
        assert!(refused[0].transform_keyframes.is_empty());
        assert!(refused[0].rotation_keyframes.is_empty());
    }

    // Authored regression only. Windows/Tauri preview NOT_EXECUTED.
    #[test]
    fn animation_projection_recognizes_loop_hold_and_fails_closed_on_unknown_modes() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim = "00000000-0000-4000-8000-000000009741";
        let bone = "00000000-0000-4000-8000-000000000001";
        doc.animation_assets.push(json!({
            "uuid":anim, "name":"looping", "loop":"once",
            "length":2.0, "animators":{}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name":"root_bone", "type":"bone", "keyframes":[{
                "uuid":"00000000-0000-4000-8000-000000009742",
                "channel":"rotation", "time":1.0, "interpolation":"linear",
                "data_points":[{"x":"0","y":"45","z":"0"}]
            }]
        });
        let original = doc.clone();
        for mode in ["once", "loop", "hold"] {
            doc.animation_assets[0]["loop"] = json!(mode);
            let views = animation_views(&doc);
            assert_eq!(views.len(), 1);
            assert_eq!(views[0].loop_mode, mode);
            assert!(views[0].preview_supported);
            assert_eq!(views[0].transform_keyframes.len(), 1);
        }
        doc.animation_assets[0]["length"] = json!(0.0);
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0]["length"] = json!(2.0);
        doc.animation_assets[0]["loop"] = json!("bounce");
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(animation_views(&doc)[0].loop_mode, "unsupported");
        doc.animation_assets[0]["loop"] = json!(42);
        assert!(!animation_views(&doc)[0].preview_supported);
        assert_eq!(animation_views(&doc)[0].loop_mode, "unsupported");
        doc = original;
        doc.animation_assets[0]["loop"] = json!("loop");
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["data_points"][0]["x"] = json!("query.head_yaw");
        assert!(!animation_views(&doc)[0].preview_supported);
        assert!(animation_views(&doc)[0].transform_keyframes.is_empty());
    }

    #[test]
    fn pose_preview_requires_entire_animation_to_be_linear_and_static() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")
        ).unwrap();
        let id = "00000000-0000-4000-8000-000000000320";
        let bone = "00000000-0000-4000-8000-000000000001";
        doc.animation_assets.push(json!({
            "uuid": id, "name": "rotation", "loop": "once", "length": 1.0,
            "animators": {}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name": "root_bone", "type": "bone", "keyframes": [
                {"uuid": "00000000-0000-4000-8000-000000000321",
                 "channel": "rotation", "time": 0.0, "interpolation": "linear",
                 "data_points": [{"x": "0", "y": "0", "z": "0"}]}
            ]
        });
        let view = animation_views(&doc);
        assert!(view[0].preview_supported);
        let before = doc.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["interpolation"] = json!("bezier");
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["interpolation"] = json!("linear");
        doc.animation_assets[0]["animators"][bone]["keyframes"][0]["data_points"][0]["y"] = json!("query.anything");
        assert!(!animation_views(&doc)[0].preview_supported);
        doc.animation_assets[0] = before.animation_assets[0].clone();
        doc.animation_assets[0]["animators"]["effects"] = json!({"keyframes":[]});
        assert!(!animation_views(&doc)[0].preview_supported);
    }


    // Authored source regression; local/native playback remains NOT_EXECUTED.
    #[test]
    fn animation_projection_refuses_invalid_axes_or_ambiguous_keyframe_ids() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let anim = "00000000-0000-4000-8000-000000009201";
        let bone = "00000000-0000-4000-8000-000000000001";
        let key = "00000000-0000-4000-8000-000000009202";
        doc.animation_assets.push(json!({
            "uuid": anim, "name": "idle", "loop": "once", "length": 2.0,
            "animators": {}
        }));
        doc.animation_assets[0]["animators"][bone] = json!({
            "name": "root_bone", "type": "bone", "keyframes": [
                {"uuid": key, "channel": "rotation", "time": 0.0,
                 "interpolation": "linear",
                 "data_points": [{"x": "0", "y": "0", "z": "0"}]}
            ]
        });
        let before = doc.clone();
        let admitted = animation_views(&doc);
        assert!(admitted[0].preview_supported);
        assert_eq!(admitted[0].rotation_keyframes.len(), 1);
        assert_eq!(doc, before);

        doc.animation_assets[0]["animators"][bone]["keyframes"][0]
            ["data_points"][0]["x"] = json!("100001");
        let oversized = animation_views(&doc);
        assert!(!oversized[0].preview_supported);
        assert!(oversized[0].rotation_keyframes.is_empty());

        doc = before.clone();
        doc.animation_assets[0]["animators"][bone]["keyframes"]
            .as_array_mut().unwrap().push(json!({
                "uuid": key, "channel": "rotation", "time": 1.0,
                "interpolation": "linear",
                "data_points": [{"x": "0", "y": "20", "z": "0"}]
            }));
        let duplicate = animation_views(&doc);
        assert!(!duplicate[0].preview_supported);
        assert!(duplicate[0].rotation_keyframes.is_empty());

        doc = before.clone();
        doc.animation_assets[0]["animators"][bone]["name"] = json!("renamed_elsewhere");
        let mismatched = animation_views(&doc);
        assert!(!mismatched[0].preview_supported);
        assert!(mismatched[0].rotation_keyframes.is_empty());
        // Imported unsupported animation data remains in the Rust document.
        assert_eq!(doc.animation_assets[0]["animators"][bone]["name"],
            json!("renamed_elsewhere"));

        doc = before.clone();
        let conflicting_clip = doc.animation_assets[0].clone();
        doc.animation_assets.push(conflicting_clip);
        let ambiguous = animation_views(&doc);
        assert_eq!(ambiguous.len(), 2);
        assert!(ambiguous.iter().all(|view|
            !view.preview_supported && view.rotation_keyframes.is_empty()));
    }

    // SOURCE-AUTHORED_NOT_RUN: indexed Bone labels preserve unknown-track
    // rejection and exact first-match behavior for imported malformed data.
    #[test]
    fn indexed_bone_name_projection_preserves_first_identity_and_unknowns() {
        let mut doc = AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-basic.bbmodel")).unwrap();
        let first = doc.bones.first().unwrap().clone();
        let names = indexed_bone_names(&doc);
        assert_eq!(names.get(first.uuid.as_str()).copied(),
            Some(first.name.as_str()));
        assert_eq!(names.get("unmatched-bone").copied(), None);
        assert_eq!(names.len(), doc.bones.len());
        let before = doc.clone();
        let mut duplicate = first.clone();
        duplicate.name = "conflicting-imported-label".into();
        doc.bones.push(duplicate);
        let ambiguous = indexed_bone_names(&doc);
        assert_eq!(ambiguous.get(first.uuid.as_str()).copied(),
            Some(first.name.as_str()));
        doc.bones.pop();
        assert_eq!(doc, before);
    }

    // SOURCE-AUTHORED_NOT_RUN: microsecond-bucket indexes are only candidate
    // filters; the exact 1e-6 threshold and Bone/channel identity still win.
    #[test]
    fn indexed_animation_preview_time_refuses_near_duplicates_only_per_track() {
        let mut seen: HashMap<(&str, &str, u64), Vec<f64>> = HashMap::new();
        assert!(register_preview_time(&mut seen, "root", "rotation", 1.0));
        assert!(!register_preview_time(&mut seen, "root", "rotation",
            1.0 + 0.5e-6));
        assert!(!register_preview_time(&mut seen, "root", "rotation",
            1.0 - 0.5e-6));
        assert!(register_preview_time(&mut seen, "root", "rotation",
            1.0 + 2.1e-6));
        assert!(register_preview_time(&mut seen, "root", "position", 1.0));
        assert!(register_preview_time(&mut seen, "other", "rotation", 1.0));
        assert!(register_preview_time(&mut seen, "root", "rotation", 0.0));
        assert!(register_preview_time(&mut seen, "root", "rotation", 3600.0));
        assert!(!register_preview_time(&mut seen, "root", "rotation", 3600.0));
    }

    #[test]
    fn imported_png_paint_adoption_projection_does_not_mutate_assets() {
        let mut doc = AuthoringDocument::new_bedrock("UV import", "uv_import").unwrap();
        let texture = crate::authoring::paint_texture_adoptable;
        let mut session = EditorSession::from_document(doc.clone()).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: "00000000-0000-4000-8000-000000000152".into(),
            name: "paint.png".into(),
        }]).unwrap();
        doc = session.document().clone();
        doc.texture_assets[0].as_object_mut().unwrap().remove("paint_owner");
        let original = doc.clone();
        assert!(texture(&doc.texture_assets[0], 128, 128));
        let store = EditorStore {
            epoch: 7,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let preview = project(&store).unwrap();
        assert_eq!(preview.paint_editable_textures, vec![false]);
        assert_eq!(preview.paint_adoptable_textures, vec![true]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        let mut unsupported = original;
        unsupported.texture_assets[0]["vendor"] = json!({"preserve":true});
        assert!(!texture(&unsupported.texture_assets[0], 128, 128));
    }


    #[test]
    fn texture_uuid_projection_tracks_exact_import_identity_and_keeps_opaque_entries() {
        let mut doc = AuthoringDocument::new_bedrock("Textures", "textures").unwrap();
        let id = "00000000-0000-4000-8000-000000000170";
        doc.texture_assets = vec![
            json!({"uuid":id,"name":"import.png"}),
            json!({"name":"legacy-uuidless.png"}),
        ].into();
        let original = doc.clone();
        let store = EditorStore {
            epoch: 1,
            active: Some(ActiveModel {
                session: EditorSession::from_document(doc).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        let snapshot = project(&store).unwrap();
        assert_eq!(snapshot.texture_uuids, vec![Some(id.into()), None]);
        assert_eq!(snapshot.texture_names, vec!["import.png", "legacy-uuidless.png"]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
    }


    #[test]
    fn png_export_projection_follows_rust_core_and_preserves_model() {
        let uuid = "00000000-0000-4000-8000-000000000801";
        let mut session = EditorSession::from_document(
            AuthoringDocument::new_bedrock("Paint", "paint").unwrap()
        ).unwrap();
        session.apply(0, &[EditOperation::CreatePaintTexture {
            uuid: uuid.into(), name: "atlas.png".into(),
        }]).unwrap();
        let original = session.document().clone();
        let store = EditorStore {
            epoch: 10,
            active: Some(ActiveModel {
                session, source_path: None, source_sha: None, saved_canonical_sha: None, dirty: true,
            }),
        };
        assert_eq!(project(&store).unwrap().paint_exportable_textures, vec![true]);
        assert_eq!(store.active.as_ref().unwrap().session.document(), &original);
        let mut opaque = original;
        opaque.texture_assets[0]["layers"] = json!([{"name":"opaque"}]);
        let store = EditorStore {
            epoch: 11,
            active: Some(ActiveModel {
                session: EditorSession::from_document(opaque).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert_eq!(project(&store).unwrap().paint_exportable_textures, vec![false]);
    }

    // SOURCE-AUTHORED_NOT_RUN: combining eligibility evaluation must preserve
    // scalar Core gates and all three independent GUI flags for mixed saved
    // Texture metadata, including missing UUIDs and unsupported UV rules.
    #[test]
    fn paint_eligibility_batch_matches_scalar_gates_and_fail_closed_rules() {
        let mut doc = AuthoringDocument::new_bedrock("Eligibility", "eligibility").unwrap();
        doc.resolution.width = 16;
        doc.resolution.height = 16;
        let png = png_candidate(16, 16);
        let owned = json!({
            "uuid":"00000000-0000-4000-8000-000000000851",
            "name":"owned.png", "source":png, "internal":true,
            "wrap_mode":"limited", "render_mode":"default",
            "render_sides":"double", "paint_owner":"lazydesigner-rgba8-v1",
        });
        let mut imported = owned.clone();
        imported["uuid"] = json!("00000000-0000-4000-8000-000000000852");
        imported.as_object_mut().unwrap().remove("paint_owner");
        let mut uuidless = imported.clone();
        uuidless.as_object_mut().unwrap().remove("uuid");
        let mut opaque = imported.clone();
        opaque["uuid"] = json!("00000000-0000-4000-8000-000000000853");
        opaque["layers"] = json!([{"name":"retain"}]);
        let mut invalid_png = owned.clone();
        invalid_png["uuid"] = json!("00000000-0000-4000-8000-000000000854");
        invalid_png["source"] = json!("not-an-embedded-png");
        doc.texture_assets = vec![owned, imported, uuidless, opaque, invalid_png].into();
        let original = doc.clone();
        let make_snapshot = |doc: &AuthoringDocument| {
            let store = EditorStore {
                epoch: 37, active: Some(ActiveModel {
                    session: EditorSession::from_document(doc.clone()).unwrap(),
                    source_path: None, source_sha: None,
                    saved_canonical_sha: None, dirty: false,
                }),
            };
            project(&store).unwrap()
        };
        let view = make_snapshot(&doc);
        assert_eq!(view.paint_editable_textures, vec![true, false, false, false, true]);
        assert_eq!(view.paint_adoptable_textures, vec![false, true, true, false, false]);
        assert_eq!(view.paint_exportable_textures, vec![true, true, false, false, false]);
        for (index, texture) in doc.texture_assets.iter().enumerate() {
            assert_eq!(view.paint_editable_textures[index],
                paint_texture_editable(texture));
            assert_eq!(view.paint_adoptable_textures[index],
                paint_texture_adoptable(texture, 16, 16));
            assert_eq!(view.paint_exportable_textures[index],
                paint_texture_exportable(&doc, index));
        }
        assert_eq!(doc, original);

        doc.extensions.insert("multi_file_ruleset".into(),
            json!("unreviewed_ruleset"));
        let unsupported = make_snapshot(&doc);
        assert_eq!(unsupported.paint_editable_textures, view.paint_editable_textures);
        assert!(unsupported.paint_adoptable_textures.iter().all(|v| !v));
        assert!(unsupported.paint_exportable_textures.iter().all(|v| !v));
        assert!(unsupported.texture_preview_sources.iter().all(Option::is_none));
        for index in 0..doc.texture_assets.len() {
            assert!(!paint_texture_exportable(&doc, index));
        }
    }

    #[test]
    fn paint_addition_projection_follows_shared_rust_admission_gate() {
        let empty = AuthoringDocument::new_bedrock("Paint", "paint").unwrap();
        let store = EditorStore {
            epoch: 4,
            active: Some(ActiveModel {
                session: EditorSession::from_document(empty.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(project(&store).unwrap().paint_texture_addable);

        let mut per_texture = empty;
        per_texture.extensions.insert("per_texture_uv_size".into(), json!(true));
        let store = EditorStore {
            epoch: 5,
            active: Some(ActiveModel {
                session: EditorSession::from_document(per_texture).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(!project(&store).unwrap().paint_texture_addable);
    }

    #[test]
    fn empty_atlas_editability_projection_changes_when_model_has_cubes() {
        let document = AuthoringDocument::new_bedrock("Atlas", "atlas").unwrap();
        assert!(can_set_empty_atlas_resolution(&document));
        let store = EditorStore {
            epoch: 9,
            active: Some(ActiveModel {
                session: EditorSession::from_document(document.clone()).unwrap(),
                source_path: None, source_sha: None, saved_canonical_sha: None, dirty: false,
            }),
        };
        assert!(project(&store).unwrap().atlas_resolution_editable);
        let mut with_cube = document;
        with_cube.texture_assets.push(json!({"name": "existing"}));
        assert!(!can_set_empty_atlas_resolution(&with_cube));
    }
