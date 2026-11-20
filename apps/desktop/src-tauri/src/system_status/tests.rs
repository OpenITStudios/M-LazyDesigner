// TEST_AUTHORED_NOT_RUN: original domain regressions moved intact under test hold.
use super::*;

#[test]
fn gateway_proof_rejects_stale_wrong_pid_and_runtime_generation() {
    let source = "a".repeat(40);
    let build = format!("sha256:{}", "b".repeat(64));
    let data = serde_json::json!({
        "source_sha": source, "producer_pid": 42,
        "runtime_build_identity": build, "observed_at_unix_ms": 1000,
        "catalog_ready": true
    });
    assert!(verified_gateway_observation(&data, 42, &source, &build, 900, 1005));
    assert!(!verified_gateway_observation(&data, 43, &source, &build, 900, 1005));
    assert!(!verified_gateway_observation(&data, 42, &source, &build, 1001, 1005));
    assert!(!verified_gateway_observation(&data, 42, &source, &build, 900, 31001));
    assert!(!verified_gateway_observation(&data, 42, &source, &build, 900, 999));
}

#[test]
fn damaged_installation_is_attention_instead_of_first_run() {
    let root = env::temp_dir().join(format!("lazydesigner-status-{}-{}", std::process::id(), observed_at_unix_ms()));
    fs::create_dir_all(&root).unwrap();
    let blockbench = BlockbenchState { running: true, version: None, compatibility: None, diagnostic: None };
    let gateway = readiness::unknown_gateway();
    assert!(!installation_present(Some(&root), false));
    assert_eq!(readiness::product_state(false, None, &blockbench, false, &gateway, "unknown"), "welcome");

    fs::write(root.join("installed.json"), b"{\"fault_injection\":").unwrap();
    assert!(manager_executable(&root).is_err());
    let present = installation_present(Some(&root), false);
    let state = readiness::product_state(present, None, &blockbench, false, &gateway, "unknown");
    let readiness = readiness::readiness(present, None, true, false, &gateway, "unknown");
    fs::remove_dir_all(root).unwrap();
    assert_eq!(state, "attention");
    assert_eq!(readiness.state, "needs-attention");
    assert!(!readiness.ready);
}

#[test]
fn missing_installation_is_diagnostic_not_panic() {
    let result = manager_executable(Path::new("Z:/definitely-missing-lazydesigner-root"));
    assert!(result.is_err());
}

#[test]
fn runtime_build_proof_refuses_changed_plugin_ownership() {
    let root = env::temp_dir().join(format!("lazydesigner-build-check-{}-{}", std::process::id(), observed_at_unix_ms()));
    let sha = "a".repeat(40);
    let build = format!("sha256:{}", "b".repeat(64));
    let digest = "c".repeat(64);
    let version = root.join("versions").join(&sha);
    fs::create_dir_all(&version).unwrap();
    let plugin = root.join("plugins").join("lazydesigner_mcp.js");
    let key = plugin.to_string_lossy().to_string();
    let owned = HashMap::from([(key.clone(), digest.clone())]);
    fs::write(root.join("installed.json"), serde_json::json!({
        "source_sha":sha, "options":{"plugin":key}, "owned":owned
    }).to_string()).unwrap();
    fs::write(version.join("lazydesigner-package.json"), serde_json::json!({
        "schema":1, "repository":"MIVUBI-STD/M-LazyDesigner",
        "source_sha":sha, "build_identity":build,
        "files":[{"path":"lazydesigner_mcp.js","sha256":digest}]
    }).to_string()).unwrap();
    assert_eq!(installed_build_identity(&root), Some(build));
    let invalid_owned = HashMap::from([(key.clone(), "d".repeat(64))]);
    fs::write(root.join("installed.json"), serde_json::json!({
        "source_sha":sha, "options":{"plugin":key}, "owned":invalid_owned
    }).to_string()).unwrap();
    assert_eq!(installed_build_identity(&root), None);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn model_navigation_profile_requires_exact_session_affinity() {
    let profile = Path::new("C:/Users/Test/AppData/Roaming/Blockbench");
    let token = navigation_profile_id(profile);
    assert!(verify_model_profile_binding(Some(&token), profile).is_ok());
    assert!(verify_model_profile_binding(Some(&token), Path::new("c:\\users\\test\\appdata\\roaming\\blockbench")).is_ok());
    assert!(verify_model_profile_binding(Some(&token), Path::new("C:/Users/Test/Other-Profile")).is_err());
    assert!(verify_model_profile_binding(Some("invalid"), profile).is_err());
    assert!(verify_model_profile_binding(None, profile).is_ok());
}

#[test]
fn managed_editor_profile_does_not_follow_a_foreign_running_instance() {
    let pinned = Path::new("C:/Users/Test/LazyDesigner/Blockbench");
    let default = Path::new("C:/Users/Test/AppData/Roaming/Blockbench");
    assert_eq!(
        select_bound_editor_profile(Some(pinned), default, false).unwrap(),
        pinned
    );
    assert!(select_bound_editor_profile(Some(pinned), default, true).is_err());
    assert_eq!(
        select_bound_editor_profile(Some(pinned), Path::new("c:\\users\\test\\lazydesigner\\blockbench"), true).unwrap(),
        pinned
    );
    assert_eq!(select_bound_editor_profile(None, default, true).unwrap(), default);
}

#[test]
fn navigation_profile_identity_normalizes_windows_path_shape() {
    let first = navigation_profile_id(Path::new("C:/Users/Test/AppData/Roaming/Blockbench/"));
    let second = navigation_profile_id(Path::new("c:\\users\\test\\appdata\\roaming\\blockbench"));
    assert_eq!(first, second);
    assert_eq!(first, "5ecb3feef302a6c3ea316f341c2c9d0c");
    assert!(valid_navigation_profile_id(&first));
}

#[test]
fn managed_plugin_filename_is_stable() {
    let path = Path::new("C:/Users/test/AppData/Roaming/Blockbench/plugins/lazydesigner_mcp.js");
    assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("lazydesigner_mcp.js"));
}

#[test]
fn retired_plugin_inspection_is_read_only_and_rejects_symlinked_files() {
    let root = env::temp_dir().join(format!("lazydesigner-migration-{}-{}", std::process::id(), observed_at_unix_ms()));
    fs::create_dir_all(&root).unwrap();
    let plugin = root.join("lazydesigner_mcp.js");
    let legacy = root.join("blockit_mcp.js");
    assert!(retired_plugin_in_profile(&plugin).unwrap().is_none());
    fs::write(&legacy, b"retired user bytes").unwrap();
    assert_eq!(retired_plugin_in_profile(&plugin).unwrap(), Some(legacy.clone()));
    assert_eq!(fs::read(&legacy).unwrap(), b"retired user bytes");
    fs::remove_file(&legacy).unwrap();
    fs::create_dir(&legacy).unwrap();
    assert!(retired_plugin_in_profile(&plugin).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn managed_plugin_integrity_is_fail_closed_for_missing_installation() {
    assert_eq!(managed_plugin_integrity(Path::new("Z:/definitely-missing-lazydesigner-root")), "unknown");
}
