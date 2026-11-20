// TEST_AUTHORED_NOT_RUN: original domain regressions moved intact under test hold.
use super::*;

#[test]
fn new_project_folder_is_empty_and_rejects_existing_names() {
    let parent = temp_project("folder-create");
    let created = create_empty_project_directory(&parent, "Furniture Pack").unwrap();
    assert!(created.is_dir());
    assert_eq!(fs::read_dir(&created).unwrap().count(), 0);
    assert!(create_empty_project_directory(&parent, "Furniture Pack").is_err());
    assert!(create_empty_project_directory(&parent, "furniture pack").is_err());
    assert!(create_empty_project_directory(&parent, "CON").is_err());
    fs::write(parent.join("AlreadyHere"), b"file").unwrap();
    assert!(create_empty_project_directory(&parent, "alreadyhere").is_err());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn model_rename_stem_rejects_windows_unsafe_names() {
    assert_eq!(validated_model_rename_stem("Modern Chair").unwrap(), "Modern Chair");
    assert_eq!(validated_model_rename_stem("Sofa_v2").unwrap(), "Sofa_v2");
    for invalid in ["", " ", " CON", "Sofa.", "Sofa ", ".", "..", "CON",
        "nul", "LPT1", "COM9.txt", "Sofa.bbmodel", "Sofa/Other",
        "a\\\\b", "a:b", "a?b", "a*b", "a|b", "a<b", "a>b", "a\\\"b",
        "a\\n"] {
        assert!(validated_model_rename_stem(invalid).is_err(), "{invalid:?}");
    }
    assert!(validated_model_rename_stem(&"x".repeat(121)).is_err());
}

#[test]
fn persisted_navigation_hashes_preserve_sha256_bytes() {
    assert_eq!(navigation_id("model", Path::new("C:/Models/Desk.bbmodel")),
        "model-953663ce07c8b925c48b");
    assert_eq!(stable_project_id(&fixed_manifest("Desk")),
        "project-cf4c4732fd3b8f8a55b6");
}


fn temp_project(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("lazydesigner-{label}-{}-{}", std::process::id(), generate_project_uuid()));
    fs::create_dir_all(&path).unwrap();
    path
}

fn fixed_manifest(name: &str) -> ProjectManifest {
    ProjectManifest {
        schema: PROJECT_MANIFEST_SCHEMA,
        project_uuid: "11111111-2222-4333-8444-555555555555".to_string(),
        display_name: name.to_string(),
    }
}


#[test]
fn adding_folder_is_a_shortcut_not_project_file_mutation() {
    let root = temp_project("register");
    let user_folder = root.join("Furniture");
    let model_dir = user_folder.join("Models");
    fs::create_dir_all(&model_dir).unwrap();
    fs::write(model_dir.join("Chair.bbmodel"), b"{}").unwrap();
    fs::write(user_folder.join("Sofa.bbmodel"), b"{}").unwrap();
    fs::write(user_folder.join("notes.txt"), b"keep").unwrap();
    let prefs = root.join("prefs.json");
    assert_eq!(register_project_folder_at(&prefs, &user_folder).unwrap(), "ADDED");
    assert_eq!(register_project_folder_at(&prefs, &user_folder).unwrap(), "ALREADY_ADDED");
    let files = scan_registered_models(&user_folder);
    assert_eq!(files.len(), 2);
    assert!(!user_folder.join(PROJECT_MANIFEST_FILE).exists());
    assert_eq!(fs::read(user_folder.join("notes.txt")).unwrap(), b"keep");
    let saved = read_navigation_preferences_at(&prefs).unwrap().unwrap();
    assert_eq!(saved.registered_project_paths.len(), 1);
    assert_eq!(saved.pinned_project_ids.len(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn registered_directory_scan_is_bounded_and_never_recursive() {
    let root = temp_project("bounded-scan");
    fs::create_dir(root.join("Nested")).unwrap();
    fs::write(root.join("Nested").join("Hidden.bbmodel"), b"{}").unwrap();
    for i in 0..160 {
        fs::write(root.join(format!("{i:03}.bbmodel")), b"{}").unwrap();
    }
    assert!(scan_registered_models(&root).len() <= MAX_PROJECT_MODELS);
    assert!(!scan_registered_models(&root).iter().any(|p| p.ends_with("Hidden.bbmodel")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn registered_paths_reject_missing_relative_and_unsupported_metadata() {
    let root = temp_project("register-negative");
    let prefs = root.join("prefs.json");
    let bad = root.join("missing");
    assert!(register_project_folder_at(&prefs, &bad).is_err());
    assert!(register_project_folder_at(&prefs, Path::new("relative")).is_err());
    assert!(!prefs.exists());
    let original = br#"{"schema":1,"pinned_project_ids":[],"future":"keep"}"#;
    fs::write(&prefs, original).unwrap();
    assert!(register_project_folder_at(&prefs, &root).is_err());
    assert_eq!(fs::read(&prefs).unwrap(), original);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn recycled_folder_is_hidden_in_desktop_without_touching_blockbench_recent_history() {
    let root = temp_project("recycled-marker");
    let other = temp_project("other-recent");
    let removed_model = root.join("Old.bbmodel");
    let remaining_model = other.join("StillHere.bbmodel");
    let profile = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string();
    let mut snapshot = NavigationSnapshot {
        schema: 4, observed_at_unix_ms: observed_at_unix_ms(),
        generation: "11111111-2222-4333-8444-555555555555".to_string(),
        profile_id: profile, revision: 1,
        last_model_path: Some(removed_model.to_string_lossy().into_owned()),
        active: None,
        open_models: Vec::new(),
        recent_models: vec![
            NavigationSnapshotRecent { name: "Old".to_string(), path: removed_model.to_string_lossy().into_owned(), day: None, favorite: false },
            NavigationSnapshotRecent { name: "Current".to_string(), path: remaining_model.to_string_lossy().into_owned(), day: None, favorite: false },
        ],
    };
    hide_recycled_model_history(&mut snapshot, &[root.to_string_lossy().into_owned()]);
    assert!(snapshot.last_model_path.is_none());
    assert_eq!(snapshot.recent_models.len(), 1);
    assert_eq!(snapshot.recent_models[0].name, "Current");
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(other).unwrap();
}

#[test]
fn existing_schema_one_preferences_read_with_optional_recycle_markers() {
    let root = temp_project("schema1-recycle");
    let path = root.join("prefs.json");
    fs::write(&path, br#"{"schema":1,"pinned_project_ids":[]}"#).unwrap();
    let prefs = read_navigation_preferences_at(&path).unwrap().unwrap();
    assert!(prefs.registered_project_paths.is_empty());
    assert!(prefs.recycled_project_paths.is_empty());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn stale_preferences_do_not_discard_a_newer_pin_change() {
    let root = temp_project("stale-preferences"); let path = root.join("prefs.json");
    let empty = empty_navigation_preferences();
    write_navigation_preferences_at(&path, &empty).unwrap();
    let first = fs::read(&path).unwrap();
    let newer = ProjectNavigationPreferences {
        schema: 1, pinned_project_ids: vec!["project-12345678901234567890".to_string()], registered_project_paths: Vec::new(), recycled_project_paths: Vec::new(),
    };
    write_navigation_preferences_at(&path, &newer).unwrap();
    assert!(write_navigation_preferences_expected_at(&path, &empty, Some(&first)).is_err());
    assert_eq!(read_navigation_preferences_at(&path).unwrap().unwrap().pinned_project_ids, newer.pinned_project_ids);
    assert_eq!(fs::read(crate::metadata_io::recovery_path(&path).unwrap()).unwrap(), first);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_restore_keeps_damaged_original_and_valid_checkpoint() {
    let root = temp_project("restore-preferences"); let path = root.join("prefs.json");
    let old = ProjectNavigationPreferences {
        schema: 1, pinned_project_ids: vec!["project-12345678901234567890".to_string()], registered_project_paths: Vec::new(), recycled_project_paths: Vec::new(),
    };
    write_navigation_preferences_at(&path, &old).unwrap();
    write_navigation_preferences_at(&path, &empty_navigation_preferences()).unwrap();
    fs::write(&path, b"{malformed").unwrap();
    restore_project_preferences_at(&path).unwrap();
    assert_eq!(read_navigation_preferences_at(&path).unwrap().unwrap().pinned_project_ids, old.pinned_project_ids);
    assert_eq!(fs::read(crate::metadata_io::recovery_path(&path).unwrap()).unwrap(), serde_json::to_vec(&old).unwrap());
    let preserved: Vec<_> = fs::read_dir(&root).unwrap()
        .filter_map(Result::ok)
        .filter(|item| item.file_name().to_string_lossy().contains(".corrupt-"))
        .collect();
    assert_eq!(preserved.len(), 1);
    assert_eq!(fs::read(preserved[0].path()).unwrap(), b"{malformed");
    assert!(restore_project_preferences_at(&path).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restore_without_valid_backup_fails_closed() {
    let root = temp_project("missing-backup"); let path = root.join("prefs.json");
    fs::write(&path, b"{broken").unwrap();
    assert!(restore_project_preferences_at(&path).is_err());
    let backup = crate::metadata_io::recovery_path(&path).unwrap();
    fs::write(&backup, b"{bad backup").unwrap();
    assert!(restore_project_preferences_at(&path).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{broken");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn corrupt_preferences_are_not_replaced_by_defaults() {
    let dir = temp_project("preferences-corruption");
    let path = dir.join("project-preferences.json");
    let invalid = br#"{"schema":2,"pinned_project_ids":[]}"#;
    fs::write(&path, invalid).unwrap();
    assert!(read_navigation_preferences_at(&path).is_err());
    assert!(write_navigation_preferences_at(&path, &empty_navigation_preferences()).is_err());
    assert_eq!(fs::read(path).unwrap(), invalid);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn unsupported_preference_fields_survive_failed_write() {
    let dir = temp_project("preferences-forward-compat");
    let path = dir.join("project-preferences.json");
    let original = br#"{"schema":1,"pinned_project_ids":[],"future":"preserve"}"#;
    fs::write(&path, original).unwrap();
    assert!(write_navigation_preferences_at(&path, &empty_navigation_preferences()).is_err());
    assert_eq!(fs::read(path).unwrap(), original);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn valid_preferences_replace_in_one_file() {
    let dir = temp_project("preferences-write");
    let path = dir.join("project-preferences.json");
    write_navigation_preferences_at(&path, &empty_navigation_preferences()).unwrap();
    let updated = ProjectNavigationPreferences {
        schema: 1, pinned_project_ids: vec!["project-12345678901234567890".to_string()], registered_project_paths: Vec::new(), recycled_project_paths: Vec::new(),
    };
    write_navigation_preferences_at(&path, &updated).unwrap();
    assert_eq!(read_navigation_preferences_at(&path).unwrap().unwrap().pinned_project_ids, updated.pinned_project_ids);
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 2); // primary + previous snapshot
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn continue_model_requires_the_exact_last_saved_model_to_exist() {
    let path = std::env::temp_dir().join(format!(
        "lazydesigner-continue-{}-{}.bbmodel",
        std::process::id(),
        observed_at_unix_ms()
    ));
    fs::write(&path, b"{}").unwrap();
    let raw = path.to_string_lossy().to_string();

    let resolved = continue_model_id_for_path(Some(&raw));
    assert!(resolved.as_deref().unwrap_or("").starts_with("model-"));

    fs::remove_file(&path).unwrap();
    assert!(continue_model_id_for_path(Some(&raw)).is_none());
    assert!(continue_model_id_for_path(Some("C:/Projects/not-a-model.txt")).is_none());
    assert!(continue_model_id_for_path(None).is_none());
}

#[test]
fn manifest_identity_survives_project_move() {
    let base = temp_project("move");
    let before = base.join("Before");
    let after = base.join("After");
    fs::create_dir_all(&before).unwrap();
    write_project_manifest(&before, &fixed_manifest("Furniture")).unwrap();
    let first = project_identity_from_state(&before, &read_project_manifest_state(&before), &HashSet::new());
    fs::rename(&before, &after).unwrap();
    let second = project_identity_from_state(&after, &read_project_manifest_state(&after), &HashSet::new());
    assert_eq!(first.id, second.id);
    assert_eq!(second.name, "Furniture");
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn malformed_or_unsupported_manifest_is_not_overwritten() {
    let root = temp_project("invalid");
    let path = root.join(PROJECT_MANIFEST_FILE);
    let raw = br#"{"schema":2,"project_uuid":"11111111-2222-4333-8444-555555555555","display_name":"Future"}"#;
    fs::write(&path, raw).unwrap();
    assert_eq!(read_project_manifest_state(&root), ProjectManifestState::Invalid);
    let mut bookmarks = empty_navigation_preferences();
    let id = navigation_id("project", &root);
    set_project_pin(&mut bookmarks, &id, &id, true);
    assert_eq!(bookmarks.pinned_project_ids, vec![id]);
    assert_eq!(fs::read(&path).unwrap(), raw);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn duplicate_manifest_ids_fall_back_to_distinct_path_ids() {
    let base = temp_project("collision");
    let one = base.join("One");
    let two = base.join("Two");
    fs::create_dir_all(&one).unwrap();
    fs::create_dir_all(&two).unwrap();
    let manifest = fixed_manifest("Furniture");
    write_project_manifest(&one, &manifest).unwrap();
    write_project_manifest(&two, &manifest).unwrap();
    let collision = HashSet::from([stable_project_id(&manifest)]);
    let a = project_identity_from_state(&one, &read_project_manifest_state(&one), &collision);
    let b = project_identity_from_state(&two, &read_project_manifest_state(&two), &collision);
    assert_ne!(a.id, b.id);
    // Duplicate manifest identity never forces writing to either folder.
    assert_eq!(fs::read(one.join(PROJECT_MANIFEST_FILE)).unwrap(),
        fs::read(two.join(PROJECT_MANIFEST_FILE)).unwrap());
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn pin_does_not_modify_project_folder_or_legacy_marker() {
    let root = temp_project("legacy");
    fs::write(root.join(PROJECT_MANIFEST_FILE), b" \n").unwrap();
    let mut bookmarks = empty_navigation_preferences();
    let id = navigation_id("project", &root);
    set_project_pin(&mut bookmarks, &id, &id, true);
    assert!(bookmarks.pinned_project_ids.contains(&id));
    assert_eq!(fs::read(root.join(PROJECT_MANIFEST_FILE)).unwrap(), b" \n");
    set_project_pin(&mut bookmarks, &id, &id, false);
    assert!(bookmarks.pinned_project_ids.is_empty());
    assert_eq!(fs::read(root.join(PROJECT_MANIFEST_FILE)).unwrap(), b" \n");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn project_grouping_prefers_manifest_then_models_folder_then_direct_parent() {
    let base = temp_project("grouping");
    let manifest_root = base.join("ManifestProject");
    let nested = manifest_root.join("Deep").join("Models");
    fs::create_dir_all(&nested).unwrap();
    write_project_manifest(&manifest_root, &fixed_manifest("Manifest Project")).unwrap();
    let manifest_model = nested.join("Chair.bbmodel");
    fs::write(&manifest_model, b"{}").unwrap();
    assert_eq!(project_root_for_model(&manifest_model), Some(manifest_root.clone()));

    let conventional_root = base.join("Furniture");
    let models = conventional_root.join("Models");
    fs::create_dir_all(&models).unwrap();
    let sofa = models.join("Sofa.bbmodel");
    fs::write(&sofa, b"{}").unwrap();
    assert_eq!(project_root_for_model(&sofa), Some(conventional_root.clone()));

    let direct_root = base.join("Loose");
    fs::create_dir_all(&direct_root).unwrap();
    let prop = direct_root.join("Prop.bbmodel");
    fs::write(&prop, b"{}").unwrap();
    assert_eq!(project_root_for_model(&prop), Some(direct_root.clone()));

    fs::remove_dir_all(base).unwrap();
}

#[test]
fn two_models_in_one_project_share_project_identity_but_keep_model_identity() {
    let base = temp_project("multi-model");
    let root = base.join("Furniture");
    let models = root.join("Models");
    fs::create_dir_all(&models).unwrap();
    write_project_manifest(&root, &fixed_manifest("Furniture")).unwrap();
    let chair = models.join("Chair.bbmodel");
    let sofa = models.join("Sofa.bbmodel");
    fs::write(&chair, b"{}").unwrap();
    fs::write(&sofa, b"{}").unwrap();

    let snapshot = NavigationSnapshot {
        schema: 4,
        observed_at_unix_ms: 1,
        generation: "11111111-1111-4111-8111-111111111111".to_string(),
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        revision: 1,
        last_model_path: Some(chair.to_string_lossy().to_string()),
        active: None,
        open_models: Vec::new(),
        recent_models: vec![
            NavigationSnapshotRecent {
                name: "Chair".to_string(),
                path: chair.to_string_lossy().to_string(),
                day: None,
                favorite: false,
            },
            NavigationSnapshotRecent {
                name: "Sofa".to_string(),
                path: sofa.to_string_lossy().to_string(),
                day: None,
                favorite: false,
            },
        ],
    };
    let identities = project_identity_map(Some(&snapshot), &[]);
    assert_eq!(identities.len(), 1);
    let identity = identities.values().next().unwrap();
    assert_eq!(identity.id, stable_project_id(&fixed_manifest("Furniture")));
    assert_ne!(navigation_id("model", &chair), navigation_id("model", &sofa));
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn save_as_changes_model_identity_without_changing_manifest_project_identity() {
    let base = temp_project("save-as");
    let root = base.join("Furniture");
    fs::create_dir_all(&root).unwrap();
    let manifest = fixed_manifest("Furniture");
    write_project_manifest(&root, &manifest).unwrap();
    let before = root.join("Chair.bbmodel");
    let after = root.join("Chair Copy.bbmodel");
    fs::write(&before, b"{}").unwrap();
    fs::write(&after, b"{}").unwrap();

    let state = read_project_manifest_state(&root);
    let project = project_identity_from_state(&root, &state, &HashSet::new());
    assert_eq!(project.id, stable_project_id(&manifest));
    assert_ne!(navigation_id("model", &before), navigation_id("model", &after));
    assert_eq!(project_root_for_model(&before), project_root_for_model(&after));
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn navigation_snapshot_bounds_accept_64_open_and_128_recent_only() {
    let make = |open_count: usize, recent_count: usize| NavigationSnapshot {
        schema: 4,
        observed_at_unix_ms: 1,
        generation: "11111111-1111-4111-8111-111111111111".to_string(),
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        revision: 1,
        last_model_path: None,
        active: None,
        open_models: (0..open_count).map(|index| NavigationSnapshotOpen {
            uuid: format!("open-{index}"),
            name: format!("Model {index}"),
            path: None,
            saved: true,
            dirty: false,
            active: false,
        }).collect(),
        recent_models: (0..recent_count).map(|index| NavigationSnapshotRecent {
            name: format!("Recent {index}"),
            path: format!("C:/Project/{index}.bbmodel"),
            day: None,
            favorite: false,
        }).collect(),
    };
    let profile = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert!(navigation_snapshot_is_valid(&make(64, 128), profile));
    assert!(!navigation_snapshot_is_valid(&make(65, 128), profile));
    assert!(!navigation_snapshot_is_valid(&make(64, 129), profile));
}

#[test]
fn navigation_generation_validation_is_bounded() {
    assert!(valid_navigation_generation("11111111-1111-4111-8111-111111111111"));
    assert!(!valid_navigation_generation("not-a-generation"));
    assert!(!valid_navigation_generation("111111111111411181111111111111111111"));
}

#[test]
fn project_session_lease_requires_live_blockbench_and_fresh_snapshot() {
    let now = 100_000;
    assert!(project_session_fresh(true, now - 5_000, now));
    assert!(!project_session_fresh(false, now - 5_000, now));
    assert!(!project_session_fresh(true, now - PROJECT_SESSION_LEASE_TTL_MS - 1, now));
}

#[test]
fn project_navigation_revision_is_generation_aware() {
    let make = |generation: &str| NavigationSnapshot {
        schema: 4,
        observed_at_unix_ms: 1,
        generation: generation.to_string(),
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        revision: 1,
        last_model_path: None,
        active: None,
        open_models: Vec::new(),
        recent_models: Vec::new(),
    };
    let first = make("11111111-1111-4111-8111-111111111111");
    let second = make("22222222-2222-4222-8222-222222222222");
    assert_ne!(navigation_revision_token(&first), navigation_revision_token(&second));
}

#[test]
fn project_navigation_revision_is_profile_aware() {
    let make = |profile_id: &str| NavigationSnapshot {
        schema: 4,
        observed_at_unix_ms: 1,
        generation: "11111111-1111-4111-8111-111111111111".to_string(),
        profile_id: profile_id.to_string(),
        revision: 1,
        last_model_path: None,
        active: None,
        open_models: Vec::new(),
        recent_models: Vec::new(),
    };
    let first = make("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    let second = make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert_ne!(navigation_revision_token(&first), navigation_revision_token(&second));
}

#[test]
fn live_project_session_state_is_discarded_when_session_is_not_live() {
    let snapshot = NavigationSnapshot {
        schema: 4,
        observed_at_unix_ms: 1,
        generation: "11111111-1111-4111-8111-111111111111".to_string(),
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        revision: 7,
        last_model_path: None,
        active: None,
        open_models: vec![NavigationSnapshotOpen {
            uuid: "open-model".to_string(),
            name: "Sofa".to_string(),
            path: Some("C:/Projects/Furniture/Sofa.bbmodel".to_string()),
            saved: true,
            dirty: true,
            active: true,
        }],
        recent_models: Vec::new(),
    };

    assert_eq!(live_open_models(&snapshot, true).len(), 1);
    assert!(live_open_models(&snapshot, false).is_empty());
}
