import { describe, expect, test } from "bun:test";
import { connectionChanged, type ConnectionBaseline, type ConnectionObservation } from "../../../apps/desktop/src/connectionWatch";
import type { ProjectNavigation } from "../../../apps/desktop/src/projectNavigationTypes";

const workspaceSource = Bun.file("../apps/desktop/src/WorkspacePage.svelte").text();
const deleteDialogSource = Bun.file("../apps/desktop/src/ProjectDeleteDialog.svelte").text();

async function source(path: string): Promise<string> {
  return Bun.file(path).text();
}

describe("Desktop page and deletion-dialog ownership", () => {
  test("views consume callbacks while App keeps deletion token authority", async () => {
    const [app, workspace, dialog] = await Promise.all([
      source("../apps/desktop/src/App.svelte"), workspaceSource, deleteDialogSource,
    ]);
    expect(app).toContain("<WorkspacePage");
    expect(app).toContain("<ProjectDeleteDialog");
    expect(app).toContain("if (event.defaultPrevented || deleteReview) return;");
    expect(app).toContain("'prepare_delete_project', { id }");
    expect(app).toContain("'confirm_delete_project', { token: review.token }");
    expect(app).toContain("'cancel_delete_project', { token: review.token }");
    expect(workspace).not.toContain("invoke<");
    expect(dialog).not.toContain("invoke<");
    expect(dialog).toContain("<svelte:window onkeydown={handleKeyDown} />");
    expect(dialog).toContain("event.key === 'Escape' && !busy");
    expect(dialog).toContain("event.key === 'Tab' && dialog");
    expect(dialog).toContain("button:not([disabled])");
    expect(dialog).toContain("onclick={onConfirm} disabled={busy}");
  });
});

describe("Desktop control-plane ownership", () => {
  test("Desktop depends on canonical compatibility and managed distribution owners", async () => {
    const [rust, blockbench, app, cli, managedStatus, runtimeHost, runtimeLease, workflow] = await Promise.all([
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/blockbench.rs"),
      source("../apps/desktop/src/App.svelte"),
      source("../distribution/cli.ts"),
      source("../distribution/status.ts"),
      source("plugin/runtimeHost.ts"),
      source("plugin/runtimeSessionLease.ts"),
      source("../.github/disabled-workflows/desktop-verify.yml"),
    ]);

    expect(blockbench).toContain('../../../../mcp/compatibility/blockbench.json');
    expect(rust).toContain('"update" | "rollback" | "recover" | "repair" | "setup-tls"');
    expect(rust).toContain('.arg("install")');
    expect(rust).toContain('"resources/managed/lazydesigner.exe"');
    expect(rust).toContain('"--plugin-path"');
    expect(rust).toContain('join("plugins").join("lazydesigner_mcp.js")');
    const setup = await source("../apps/desktop/src/setupOperations.ts");
    expect(setup).toContain("ensure_ready");
    expect(app).toContain("setupOperations.connect(");
    expect(app).toContain("show_plugin_file");
    expect(app).toContain("setup-tls");
    expect(await workspaceSource).toContain("runManagedAction('update')");
    expect(await source("../apps/desktop/src/SupportPage.svelte")).toContain("status.managed?.tls_ready === false");
    expect(app).toContain("'update' | 'rollback' | 'recover' | 'repair'");
    for (const command of ["update", "rollback", "recover", "repair", "status", "mcp"]) {
      expect(cli).toContain(command);
    }

    expect(cli).toContain("runtimeStatus");
    expect(cli).toContain("DEFAULT_RUNTIME_URL");
    expect(managedStatus).toContain("runtime_url");
    expect(runtimeHost).toContain("startRuntimeSessionLease");
    expect(runtimeHost).toContain("stopRuntimeSessionLease");
    expect(runtimeLease).toContain("producer_pid");
    expect(runtimeLease).toContain("runtime_url");
    expect(runtimeLease).toContain("runtime-session");
    expect(runtimeLease).toContain("build_identity");
    expect(runtimeLease).toContain("schema: 2");
    expect(runtimeHost).toContain("buildIdentity");
    expect(rust).toContain("installed_build_identity");
    expect(rust).toContain("runtime_build_match");
    expect(rust).toContain("runtime_listener_live: runtime_session.live && runtime_build_match == Some(true)");
    expect(rust).toContain("runtime_listener_live: trusted_listener");
    expect(rust).toContain("runtime_health::matching_build_identity");
    expect(rust).toContain('run_managed_action(app, "repair", None)?;');

    // Routine Local push runs focused Windows source tests. Manual Desktop verification
    // remains the separate integrated NSIS smoke/release evidence gate.
    expect(workflow).toMatch(/^on:\n  push:\n    branches:\n      - Local\n    paths:\n(?:      - .+\n)+  workflow_dispatch:/m);
    expect(workflow).not.toMatch(/^  pull_request:|^  schedule:/m);
    expect(workflow).toContain("apps/desktop");
  });

  test("Desktop audit remains a mandatory failure gate without blocking independent smoke diagnostics", async () => {
    const workflow = await source("../.github/disabled-workflows/desktop-verify.yml");
    expect(workflow).toContain("id: desktop_security_audit");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("run: npm audit --audit-level=high");
    expect(workflow).toContain("steps.desktop_security_audit.outcome == 'success'");
    expect(workflow).toContain("always() && steps.desktop_security_audit.outcome == 'failure'");
    expect(workflow).toContain("throw 'Desktop dependency security audit failed.");
    expect(workflow).toContain("Build Windows installer smoke");
    expect(workflow.indexOf("Enforce Desktop dependency security")).toBeGreaterThan(
      workflow.indexOf("Silent-install Desktop and smoke bundled bootstrap")
    );
    expect(workflow).not.toContain("npm audit --omit=dev");
  });

  test("Desktop versions and Rust toolchain stay synchronized", async () => {
    const [pkgText, cargoText, tauriText, toolchain] = await Promise.all([
      source("../apps/desktop/package.json"),
      source("../apps/desktop/src-tauri/Cargo.toml"),
      source("../apps/desktop/src-tauri/tauri.conf.json"),
      source("../apps/desktop/rust-toolchain.toml"),
    ]);
    const pkg = JSON.parse(pkgText) as { version: string };
    const cargo = Bun.TOML.parse(cargoText) as { package: { version: string } };
    const tauri = JSON.parse(tauriText) as { version: string };

    expect(cargo.package.version).toBe(pkg.version);
    expect(tauri.version).toBe(pkg.version);
    expect(pkgText).toContain('"license": "GPL-3.0-only"');
    expect(cargoText).toContain('license = "GPL-3.0-only"');
    expect(tauriText).toContain('"licenseFile": "../../../LICENSE"');
    expect(toolchain).toContain('channel = "1.99.1"');
  });

  test("Desktop generated Rust and icon outputs stay untracked", async () => {
    const ignore = await source("../.gitignore");
    expect(ignore).toContain("apps/desktop/src-tauri/target/");
    expect(ignore).toContain("apps/desktop/src-tauri/icons/");
  });

  test("Desktop bootstrap resource is generated by the canonical managed package pipeline", async () => {
    const [pkgText, bundleConfig, prep, ignore] = await Promise.all([
      source("../apps/desktop/package.json"),
      source("../apps/desktop/src-tauri/tauri.bundle.conf.json"),
      source("../apps/desktop/scripts/prepare-managed-resource.ps1"),
      source("../.gitignore"),
    ]);

    expect(pkgText).toContain("prepare:managed-resource");
    expect(pkgText).toContain("--config src-tauri/tauri.bundle.conf.json");
    expect(bundleConfig).toContain('"resources/managed/"');
    expect(prep).toContain("bun run ../distribution/package.ts");
    expect(prep).toContain("dist\\managed\\package");
    expect(prep).toContain("Managed bootstrap source SHA");
    expect(prep).toContain("Desktop source SHA");
    expect(ignore).toContain("apps/desktop/src-tauri/resources/managed/");
  });

  test("Desktop verification includes source proof and a Windows installer smoke build", async () => {
    const workflow = await source("../.github/disabled-workflows/desktop-verify.yml");
    expect(workflow).toContain("Parse Desktop PowerShell scripts");
    expect(workflow).toContain("System.Management.Automation.Language.Parser");
    expect(workflow).toContain("npm run verify:source");
    expect(workflow).toContain("npm run build:app");
    expect(workflow).toContain("Setup baseline Bun");
    expect(workflow).toContain("bun-windows-x64-baseline.zip");
    expect(workflow).toContain("lazydesigner-desktop-windows-x64");
    expect(workflow).toContain("bundle/nsis/*.exe");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("Silent-install Desktop and smoke bundled bootstrap");
    expect(workflow).toContain("Runtime TLS");
    expect(workflow).toContain("setup-tls --root");
    expect(workflow).toContain("Runtime TLS setup ignored an active Gateway lease");
    expect(workflow).toContain("Explicit Runtime TLS renewal did not return TLS_READY");
    expect(workflow).toContain("desktop-build-provenance.json");
  });

  test("Desktop preserves client-owned Gateway semantics", async () => {
    const [rust, readiness, readme] = await Promise.all([
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/readiness.rs"),
      source("../apps/desktop/README.md"),
    ]);

    expect(readiness).toContain('ownership: "client-owned"');
    expect(readiness).toContain('state: "unknown"');
    expect(readiness).toContain("Managed status is unavailable; refresh before maintenance.");
    expect(readme).toContain("Desktop therefore does not launch, restart, terminate, or watchdog Gateway processes.");
    expect(rust).toContain("pub fn ensure_ready");
    expect(rust).toContain("manual_plugin_approval_recommended");
    expect(rust).toContain("PLUGIN_INTEGRITY");
    expect(readme).not.toContain("Start Gateway command");
  });
  test("Desktop observability keeps bounded readiness outcomes", async () => {
    const [main, log, runbook] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/operation_log.rs"),
      source("../docs/05-operations/local-acceptance-runbook.md"),
    ]);

    expect(main).toContain('operation_log::record("ensure_ready", value.status)');
    expect(main).toContain('operation_log::record("ensure_ready", value.reason)');
    expect(main).toContain('.get("status")');
    expect(log).toContain("MAX_LOG_BYTES");
    expect(runbook).toContain("Desktop Control Plane Acceptance");
    expect(runbook).toContain("managed plugin modified");
    expect(runbook).toContain("transient Gateway fast-probe failure");
  });

  test("Desktop enforces one workstation owner before Tauri startup", async () => {
    const [main, instance] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/desktop_instance.rs"),
    ]);

    expect(main).toContain("desktop_instance::acquire()");
    expect(main).toContain("InstanceAcquire::Secondary => return");
    expect(main.indexOf("desktop_instance::acquire()")).toBeLessThan(main.indexOf("tauri::Builder::default()"));
    expect(instance).toContain("CreateMutexW");
    expect(instance).toContain("ERROR_ALREADY_EXISTS");
    expect(instance).toContain("Local\\\\com.halokaryamedia.lazydesigner.desktop");
    expect(instance).toContain("FindWindowW");
    expect(instance).toContain("SetForegroundWindow");
    expect(instance).toContain("ShowWindowAsync");
    expect(instance).toContain("ReleaseMutex");
    expect(instance).toContain("CloseHandle");
    expect(instance).toContain("impl Drop for InstanceGuard");
    expect(instance).not.toContain("tauri_plugin_single_instance");
  });

  test("Desktop Projects and Models stays path-hidden and Blockbench-owned", async () => {
    const [app, navigator, rust, projectNavigation, integration, snapshot, readme, connectionWatch] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
      source("plugin/blockbenchIntegration.ts"),
      source("plugin/projectNavigationSnapshot.ts"),
      source("../apps/desktop/README.md"),
      source("../apps/desktop/src/connectionWatch.ts"),
    ]);

    expect(integration).toContain("setupProjectNavigationSnapshot");
    expect(integration).toContain("teardownProjectNavigationSnapshot");
    expect(snapshot).toContain("recent_projects");
    expect(snapshot).toContain("ModelProject.all");
    expect(snapshot).toContain("open_models");
    expect(snapshot).toContain("project.saved === false");
    expect(snapshot).toContain('Blockbench.on("saved_state_changed"');
    expect(snapshot).toContain('Blockbench.on("select_project"');
    expect(snapshot).toContain(".bbmodel");
    expect(snapshot).toContain("producerGeneration");
    expect(snapshot).toContain("crypto.randomUUID");
    expect(snapshot).toContain("schema: 4");
    expect(snapshot).toContain("profile_id");
    expect(snapshot).toContain("SystemInfo.user_data_directory");
    expect(snapshot).toContain('requireNativeModule("crypto")');
    expect(snapshot).toContain("project-navigation");
    expect(snapshot).toContain("+ profileId");
    expect(snapshot).toContain('+ ".json"');
    expect(snapshot).toContain("heartbeatSnapshot");
    expect(snapshot).toContain("utimesSync");
    expect(projectNavigation).toContain("pub(crate) fn projection");
    expect(projectNavigation).toContain("pub(crate) fn probe");
    expect(projectNavigation).toContain("PROJECT_SESSION_LEASE_TTL_MS");
    expect(projectNavigation).toContain("project_session_lease_requires_live_blockbench_and_fresh_snapshot");
    expect(projectNavigation).toContain("project_navigation_revision_is_generation_aware");
    expect(projectNavigation).toContain("open_models");
    expect(projectNavigation).toContain("pub open: bool");
    expect(projectNavigation).toContain("pub dirty: bool");
    expect(projectNavigation).toContain("navigation_revision_token(&snapshot)");
    expect(projectNavigation).toContain("valid_navigation_generation");
    expect(rust).toContain("valid_navigation_profile_id");
    expect(rust).toContain("managed_blockbench_user_data_dir");
    expect(rust).toContain("managed_navigation_profile_id");
    expect(projectNavigation).toContain("navigation_snapshot_is_valid");
    expect(projectNavigation).toContain("snapshot.schema == 4");
    expect(projectNavigation).toContain("snapshot.profile_id == expected_profile_id");
    expect(projectNavigation).toContain("snapshot.open_models.len() <= 64");
    expect(projectNavigation).toContain("snapshot.recent_models.len() <= 128");
    expect(projectNavigation).toContain("project_navigation_revision_is_profile_aware");
    expect(projectNavigation).toContain("live_open_models(state, session_live)");
    expect(projectNavigation).toContain("live_project_session_state_is_discarded_when_session_is_not_live");
    expect(projectNavigation).toContain('"open-project-folder"');
    expect(projectNavigation).toContain('"open-model"');
    expect(projectNavigation).toContain('"reveal-model"');
    expect(projectNavigation).toContain('"open-folder"');
    expect(projectNavigation).toContain('"pin-project" | "unpin-project"');
    expect(projectNavigation).toContain("project-preferences.json");
    expect(projectNavigation).toContain("pinned_project_ids");
    expect(projectNavigation).toContain('navigation_id("project"');
    expect(projectNavigation).toContain('("models", "Models"');
    expect(projectNavigation).toContain('("references", "References"');
    expect(projectNavigation).toContain('("textures", "Textures"');
    expect(projectNavigation).toContain('("exports", "Exports"');
    expect(projectNavigation).toContain(".lazydesigner-project.json");
    expect(projectNavigation).toContain("struct ProjectManifest");
    expect(projectNavigation).toContain("project_uuid");
    expect(projectNavigation).toContain("fn set_project_pin(");
    expect(projectNavigation).not.toContain("fn ensure_project_manifest_for_pin(");
    expect(projectNavigation).toContain("manifest_identity_survives_project_move");
    expect(projectNavigation).toContain("malformed_or_unsupported_manifest_is_not_overwritten");
    expect(projectNavigation).toContain("duplicate_manifest_ids_fall_back_to_distinct_path_ids");
    expect(navigator).toContain("<h2>Current Model</h2>");
    expect(navigator).toContain("Projects &amp; Models");
    expect(navigator).toContain("Show models");
    expect(await workspaceSource).toContain("navigation={current.project_navigation}");
    expect(connectionWatch).toContain("candidate.project_session_live");
    expect(connectionWatch).toContain("current.project_navigation.session_live");
    expect(await workspaceSource).toContain("navigation={current.project_navigation}");
    expect(navigator).toContain("visibleProjects(navigation, projectSearch, showAllProjects)");
    expect(navigator).toContain("project.model_count");
    expect(navigator).toContain("Search projects or models");
    expect(navigator).not.toContain("Search models");
    expect(navigator).toContain("onAddProjectFolder");
    expect(navigator).toContain('disabled={!model.exists || busy || !canOpenModel}>Open</button>');
    expect(navigator).not.toContain("model.open ? 'Switch' : 'Open'");
    expect(navigator).toContain("Modified");
    expect(navigator).toContain("active.dirty");
    expect(navigator).toContain("folder-shortcuts");
    expect(navigator).toContain("project.pinned");
    expect(navigator).toContain("Remove from Workspace");
    expect(navigator).toContain("project.pinned");
    expect(navigator).toContain("project.folders.length > 0");
    expect(navigator).toContain("project.folders.length > 0");
    expect(navigator).toContain("continueTarget");
    expect(snapshot).toContain("last_model_path");
    expect(snapshot).toContain("restoreLastModelPath");
    expect(projectNavigation).toContain("continue_model_id_for_path");
    expect(projectNavigation).toContain("continue_model_id");
    expect(projectNavigation).toContain("continue_model_requires_the_exact_last_saved_model_to_exist");
    const presentation = await source("../apps/desktop/src/desktopPresentation.ts");
    expect(presentation).toContain("state.continue_model_id");
    expect(presentation).toContain("candidate.id === state.continue_model_id && candidate.exists");
    expect(navigator).toContain("$: targetToContinue = continueTarget(navigation)");
    expect(navigator).toContain("{:else if targetToContinue}");
    expect(app).not.toContain("project.root_path");
    expect(readme).toContain("Paths stay hidden in the normal UI");
  });

  test("legacy plugin review uses structured Desktop error and cannot auto-replace files", async () => {
    const [main, rust, app] = await Promise.all([
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src/App.svelte"),
    ]);
    expect(main).toContain("LEGACY_PLUGIN_MIGRATION_REQUIRED");
    expect(main).toContain("show_retired_plugin_file,");
    expect(rust).toContain("fn retired_plugin_in_profile(");
    expect(rust).toContain("fs::symlink_metadata(&retired)");
    expect(rust).toContain("pub fn show_retired_plugin_file()");
    expect(app).toContain("migrationConflict = true");
    expect(await workspaceSource).toContain("Existing Blockbench plugin requires review");
    expect(app).toContain("showRetiredPluginFile");
    expect(main).toContain("LEGACY_CLIENT_MIGRATION_REQUIRED");
    expect(await workspaceSource).toContain("migrationConflictKind === 'plugin'");
    expect(await workspaceSource).toContain("Existing AI client configuration requires review");
  });

  test("manager failure retains verified read-only model selection rather than blanking Workspace", async () => {
    const [nav, rust] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
    ]);
    expect(rust).toContain("fn project_navigation_profile_id()");
    expect(rust).toContain('PathBuf::from(env::var_os("APPDATA")?).join("Blockbench")');
    expect(rust).toContain("project_navigation::probe(false, Some(&profile)).0");
    expect(rust).toContain("blockbench.running && manager_available");
    expect(await workspaceSource).toContain("Models and folders stay accessible.");
    expect(await workspaceSource).toContain("canOpenModel={true}");
    expect(await workspaceSource).toContain("canEditProjectPrefs={true}");
    expect(nav).toContain("!canOpenModel");
    expect(nav).toContain("!canEditProjectPrefs");
  });

  test("Desktop Project Navigation owner is isolated from workstation orchestration", async () => {
    const [projectNavigation, rust] = await Promise.all([
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
    ]);

    expect(projectNavigation).toContain("pub(crate) fn probe");
    expect(projectNavigation).toContain("pub(crate) fn projection");
    expect(projectNavigation).toContain("pub(crate) fn action");
    expect(projectNavigation).toContain("pub(crate) fn path");
    expect(projectNavigation).toContain("struct ProjectManifest");
    expect(projectNavigation).toContain("fn set_project_pin(");
    expect(projectNavigation).not.toContain("fn ensure_project_manifest_for_pin(");
    expect(projectNavigation).not.toContain("installed.json");
    expect(rust).toContain("project_navigation::probe");
    expect(rust).toContain("project_navigation::projection");
    expect(rust).not.toContain("struct ProjectManifest");
  });

  test("file browsing and recent-model opening do not depend on the AI Runtime", async () => {
    const [app, main, backend, editor, navigator, dto] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
      source("../apps/desktop/src-tauri/src/blockbench.rs"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/projectNavigationTypes.ts"),
    ]);
    const operations = await source("../apps/desktop/src/editorOperations.ts");
    const model = app.slice(app.indexOf("async function openModel("), app.indexOf("async function focusCurrentEditor()"));
    expect(operations).toContain("invoke<ModelBrowseResult>('browse_model')");
    expect(operations).not.toContain("ensure_ready");
    expect(model).toContain("editorOperations.openModel(id)");
    expect(model).not.toContain("ensure_ready");
    expect(editor).toContain('add_filter("Blockbench model", &["bbmodel"])');
    expect(editor).toContain("if !is_bbmodel_file(path)");
    expect(editor).toContain('return Err("Choose an existing .bbmodel file."');
    expect(editor).toContain("pub(crate) fn open_model(path: &Path, user_data: &Path)");
    expect(backend).toContain("editor_profile_for_model(Some(expected))");
    expect(backend).toContain("recent_model_ids: Vec<String>");
    expect(backend).toContain("state.recent_models.iter()");
    expect(dto).toContain("recent_model_ids: string[]");
    expect(navigator).toContain("<h2>Recent Models</h2>");
    expect(navigator).toContain("$: recentTargets = recentModelTargets(navigation)");
    expect(await source("../apps/desktop/src/desktopPresentation.ts")).toContain("state.recent_model_ids");
    expect(main).toContain("async fn browse_model()");
    expect(main).toContain("async fn open_blockbench_editor()");
    expect(main).toContain("tauri::async_runtime::spawn_blocking(blockbench::browse_model)");
    expect(await workspaceSource).toContain("onFocusEditor={focusCurrentEditor}");
    expect(await workspaceSource).toContain("canOpenModel={true}");
  });

  test("added folder shortcuts stay local, bounded and independent of AI", async () => {
    const [app, rust, backend, navigator, types] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src/projectNavigationTypes.ts"),
    ]);
    expect(backend).toContain("pub(crate) fn add_project_folder()");
    expect(backend).toContain("FileDialog::new().pick_folder()");
    expect(backend).toContain("registered_project_paths");
    expect(backend).toContain("MAX_REGISTERED_PROJECTS: usize = 16");
    expect(backend).toContain("MAX_PROJECT_MODELS: usize = 64");
    expect(backend).toContain("fn scan_registered_models(");
    expect(backend).toContain("fn pin_does_not_modify_project_folder_or_legacy_marker()");
    expect(backend).toContain("fn adding_folder_is_a_shortcut_not_project_file_mutation()");
    expect(backend).toContain('"remove-project-folder"');
    expect(backend).not.toContain("fn ensure_project_manifest_for_pin(");
    expect(rust).toContain("async fn add_project_folder()");
    expect(rust).toContain("spawn_blocking(project_navigation::add_project_folder)");
    expect(app).toContain("invoke<ProjectNavigationActionResult>('add_project_folder')");
    expect(await workspaceSource).toContain("onAddProjectFolder={addProjectFolder}");
    expect(navigator).toContain('aria-label="Search projects or models"');
    expect(navigator).toContain("<h2>Projects &amp; Models</h2>");
    expect(navigator).toContain("Remove from Workspace");
    expect(navigator).not.toContain("Search models");
    expect(types).toContain("registered: boolean;");
    expect(types).toContain("available: boolean;");
  });

  test("Delete Project has a two-phase registered-folder-only Recycle Bin boundary", async () => {
    const [app, navigator, rust, deletion, main, presentation, types] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src/ProjectNavigator.svelte"),
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
      source("../apps/desktop/src-tauri/src/project_deletion.rs"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src/desktopPresentation.ts"),
      source("../apps/desktop/src/projectNavigationTypes.ts"),
    ]);
    expect(navigator).toContain("{#if project.registered}");
    expect(navigator).toContain("Remove from Workspace");
    expect(navigator).toContain("Delete Project…");
    expect(navigator).toContain("onDeleteProject(project.id)");
    expect(rust).toContain("pub(crate) fn registered_delete_target(");
    expect(rust).toContain("pub(crate) fn unregister_recycled_folder(");
    expect(rust).toContain("recycled_project_paths");
    expect(rust).toContain("read_visible_navigation_snapshot");
    expect(deletion).toContain("project_navigation::registered_delete_target(id, profile.as_deref())");
    expect(deletion).toContain("blockbench_closed()?");
    expect(deletion).toContain("require_fixed_local_volume(&folder)?");
    expect(deletion).toContain("protected_environment(&folder)?");
    expect(deletion).toContain("fingerprint_tree(&folder)?");
    expect(deletion).toContain("prior.token != token || Instant::now() >= prior.expires");
    expect(deletion).toContain("fingerprint != prior.fingerprint");
    expect(deletion).toContain("fn recycle_folder(folder: &Path)");
    expect(deletion).toContain("[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin");
    expect(deletion).toContain("[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException");
    expect(deletion).not.toContain("RecycleOption]::DeletePermanently");
    expect(deletion).not.toContain("fs::remove_dir_all(&folder)");
    expect(deletion).toContain("MAX_TREE_ENTRIES: usize = 10_000");
    expect(deletion).toContain("MAX_TREE_DEPTH: usize = 32");
    expect(main).toContain("async fn prepare_delete_project(id: String)");
    expect(main).toContain("async fn confirm_delete_project(token: String)");
    expect(main).toContain("fn cancel_delete_project(token: String)");
    expect(app).toContain("invoke<ProjectDeletePreview>('prepare_delete_project', { id })");
    expect(app).toContain("invoke<ProjectDeleteResult>('confirm_delete_project', { token: review.token })");
    expect(app).toContain("invoke('cancel_delete_project', { token: review.token })");
    expect(await deleteDialogSource).toContain('role="alertdialog" aria-modal="true"');
    expect(await deleteDialogSource).toContain("Move to Recycle Bin");
    expect(await workspaceSource).toContain("onDeleteProject={beginDeleteProject}");
    expect(types).toContain("expires_in_seconds: number");
    expect(types).toContain("RECYCLED_SHORTCUT_RETAINED");
    expect(presentation).toContain("PROJECT_RECYCLE_FAILED");
  });

  test("destructive-operation errors explain unknown results without claiming files were preserved", async () => {
    const { desktopErrorNotice } = await import("../../../apps/desktop/src/desktopPresentation");
    const waiting = desktopErrorNotice({ code: "PROJECT_DELETE_REVIEW_FAILED", message: "Save and close all Blockbench windows" });
    expect(waiting.title).toBe("Close Blockbench first");
    const uncertain = desktopErrorNotice({ code: "PROJECT_RECYCLE_FAILED", message: "Native recycle status uncertain" });
    expect(uncertain.title).toBe("Project deletion not confirmed");
    expect(uncertain.message).toContain("No permanent-delete fallback was attempted");
    const protectedPath = desktopErrorNotice({ code: "PROJECT_DELETE_REVIEW_FAILED", message: "System folder protected" });
    expect(protectedPath.title).toBe("Folder is not safe to delete here");
  });

  test("Desktop Project Navigator UI is isolated from command orchestration", async () => {
    const [navigator] = await Promise.all([
      source("../apps/desktop/src/ProjectNavigator.svelte"),
    ]);

    expect(await workspaceSource).toContain("<ProjectNavigator");
    expect(await workspaceSource).toContain("onOpenModel={openModel}");
    expect(await workspaceSource).toContain("onFocusEditor={focusCurrentEditor}");
    expect(await workspaceSource).toContain("onProjectAction={runProjectAction}");
    expect(navigator).toContain("<h2>Current Model</h2>");
    expect(navigator).toContain("Projects &amp; Models");
    expect(navigator).toContain("Recent Models");
    expect(navigator).toContain("Continue");
    expect(navigator).not.toContain("invoke<");
  });

  test("Desktop Blockbench owner is isolated from workstation orchestration", async () => {
    const [blockbench, rust, projectNavigation] = await Promise.all([
      source("../apps/desktop/src-tauri/src/blockbench.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/project_navigation.rs"),
    ]);

    expect(blockbench).toContain("pub(crate) fn detect()");
    expect(blockbench).toContain("pub(crate) fn open_model");
    expect(blockbench).toContain("pub(crate) fn open()");
    expect(blockbench).toContain("BlockbenchCompatibilityManifest");
    expect(blockbench).toContain("Blockbench installation discovery");
    expect(rust).toContain("blockbench::detect()");
    expect(projectNavigation).toContain("blockbench::open_model(path, &user_data)");
    expect(rust).not.toContain("fn discover_blockbench_executable");
    expect(rust).not.toContain("fn evaluate_blockbench_compatibility");
  });

  test("Desktop readiness policy is isolated from machine observation", async () => {
    const [readiness, rust] = await Promise.all([
      source("../apps/desktop/src-tauri/src/readiness.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
    ]);

    expect(readiness).toContain("pub(crate) fn gateway");
    expect(readiness).toContain("pub(crate) fn product_state");
    expect(readiness).toContain("pub(crate) fn readiness");
    expect(readiness).toContain("pub(crate) fn maintenance");
    expect(readiness).not.toContain("Command::new");
    expect(readiness).not.toContain("fs::");
    expect(rust).toContain("readiness::gateway");
    expect(rust).toContain("readiness::product_state");
    expect(rust).not.toContain("fn project_product_state");
    expect(rust).not.toContain("fn project_maintenance");
  });

  test("Desktop UI uses one canonical workstation readiness path", async () => {
    const [app, main, rust, runtimeHealth, presentation, connectionWatch] = await Promise.all([
      source("../apps/desktop/src/App.svelte"),
      source("../apps/desktop/src-tauri/src/main.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/runtime_health.rs"),
      source("../apps/desktop/src/desktopPresentation.ts"),
      source("../apps/desktop/src/connectionWatch.ts"),
    ]);

    const setup = await source("../apps/desktop/src/setupOperations.ts");
    expect(setup).toContain("invoke<EnsureReadyResult>('ensure_ready')");
    expect(app).toContain("setupOperations.connect(");
    expect(app).not.toContain("invoke<BlockbenchActionResult>('open_blockbench')");
    expect(main).not.toContain("fn open_blockbench()");
    expect(rust).toContain("blockbench::open()?");
    expect(presentation).toContain("value.plugin_integrity === 'modified'");
    const fixtures = await source("../apps/desktop/src/desktopFixtures.ts");
    expect(fixtures).toContain("next.managed = fixture === 'fresh-install' ? null :");
    expect(app).toContain("invoke<ConnectionStatus>('connection_status')");
    expect(connectionWatch).toContain("candidate.runtime_listener_live");
    expect(app).not.toContain("candidate.runtime_online");
    expect(presentation).toContain("RUNTIME_ENDPOINT_MISMATCH");
    expect(presentation).toContain("RUNTIME_START_FAILED");
    expect(presentation).toContain("value.product_state");
    expect(app).toContain("from './desktopPresentation'");
    expect(rust).toContain("readiness::product_state(");
    expect(rust).toContain("readiness::readiness(");
    expect(rust).toContain("readiness::maintenance(");
    expect(rust).toContain("runtime_health::probe");
    expect(rust).toContain("runtime_health::endpoint_match");
    expect(rust).toContain("runtime_health::ready");
    expect(runtimeHealth).toContain("RUNTIME_SESSION_LEASE_TTL_MS");
    expect(runtimeHealth).toContain("RuntimeSessionLease");
    expect(runtimeHealth).toContain("endpoint_identity");
    expect(rust).toContain("gateway_active_fast");
    expect(rust).not.toContain("TcpStream::connect_timeout");
    expect(rust).not.toContain("runtime_online_fast");
    expect(rust).not.toContain('"Managed connection status"');

    expect(app).toContain("async function connectBlockbench() {\n    if (devFixture) return;");
    expect(app).toContain("async function installLazyDesigner() {\n    if (devFixture) return;");
    expect(app).toContain("async function runManagedAction(action:");

  });
});


describe("Desktop release/version contract", () => {
  test("draft release stays explicit, exact-versioned, and separate from managed-component updates", async () => {
    const [workflow, releaseConfig, signScript, importScript, manifestScript, releaseChannel] = await Promise.all([
      source("../.github/workflows/desktop-draft-release.yml"),
      source("../apps/desktop/src-tauri/tauri.release.conf.json"),
      source("../apps/desktop/scripts/sign-windows.ps1"),
      source("../apps/desktop/scripts/import-windows-signing-certificate.ps1"),
      source("../apps/desktop/scripts/write-update-manifest.ps1"),
      source("../apps/desktop/release-channel.json"),
    ]);

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("desktop-v${{ inputs.version }}");
    expect(workflow).toContain("desktop-dev-v${{ inputs.version }}-$shortSha");
    expect(workflow).toContain("--prerelease");
    expect(workflow).toContain("Requested Desktop version");
    expect(workflow).toContain("does not match source version");
    expect(workflow).toContain("npm run verify:source");
    expect(workflow).toContain("npm run build:app");
    expect(workflow).toContain("npm run build:app:trusted");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(workflow).toContain("DEVELOPMENT DRAFT");
    expect(workflow).toContain("TRUSTED DRAFT");
    expect(releaseConfig).toContain('"createUpdaterArtifacts": true');
    expect(releaseConfig).toContain("sign-windows.ps1");
    expect(signScript).toContain("LAZYDESIGNER_WINDOWS_CERT_THUMBPRINT");
    expect(signScript).toContain("signtool.exe");
    expect(importScript).toContain("Import-PfxCertificate");
    expect(manifestScript).toContain("windows-x86_64");
    expect(manifestScript).toContain("signature = $signature");
    expect(releaseChannel).toContain('"manifestAsset": "latest.json"');
    expect(releaseChannel).toContain('"selfUpdateRuntimeEnabled": false');
    expect(workflow).toContain("write-update-manifest.ps1");
    expect(workflow).toContain("latest.json");
    expect(workflow).toContain("Bundled managed source SHA");
    expect(workflow).toContain("desktop-build-provenance.json");
    expect(workflow).toContain("SHA256SUMS.txt");
    expect(workflow).toContain("--draft");
    expect(workflow).toContain("nothing was auto-published");
    expect(workflow).not.toContain("tauri-plugin-updater");
    expect(releaseConfig).not.toContain('"plugins"');
  });
});

describe("Desktop Workspace First navigation contract", () => {
  test("retains session-only project view state on Support navigation", async () => {
    const [app, navigator, readme] = await Promise.all([
      Bun.file("../apps/desktop/src/App.svelte").text(),
      Bun.file("../apps/desktop/src/ProjectNavigator.svelte").text(),
      Bun.file("../apps/desktop/README.md").text(),
    ]);
    expect(app).toContain("<span>Workspace</span>");
    expect(app).toContain("bind:workspaceMain");
    expect(await workspaceSource).toContain("bind:this={workspaceMain}");
    expect(app).toContain("workspaceMain.scrollTop = workspaceScrollTop");
    for (const field of ["expandedProjectId", "showAllProjects", "projectSearch"]) {
      expect(app).toContain(`bind:${field}`);
      expect(navigator).toContain(`export let ${field}`);
    }
    expect(navigator).not.toContain("'Switch' : 'Open'");
    expect(readme).toContain("within the same");
  });
});

describe("Desktop stale connection action admission", () => {
  test("AI preparation remains managed while editor launch is independent", async () => {
    const workspace = await workspaceSource;
    const launchButtons = workspace.split("\n").filter(line => line.includes("<button") && line.includes("onclick={connectBlockbench}"));
    expect(launchButtons.length).toBeGreaterThan(0);
    for (const button of launchButtons) expect(button).toContain("disabled={!status.manager_available ||");
  });

  test("keeps stale status visible but guards project, launch and managed mutation", async () => {
    const app = await Bun.file("../apps/desktop/src/App.svelte").text();
    const monitor = await source("../apps/desktop/src/connectionMonitor.ts");
    expect(monitor).toContain("setFailures(Math.min(failures + 1, 2))");
    expect(app).toContain("AI status needs verification · Files remain accessible");
    expect(await workspaceSource).toContain("busy={busyAction !== null}");
    expect(await workspaceSource).toContain("canEditProjectPrefs={true}");
    for (const action of ["connectBlockbench", "installLazyDesigner", "runManagedAction"]) {
      const start = app.indexOf(`async function ${action}`);
      expect(start).toBeGreaterThan(0);
      expect(app.slice(start, start + 300)).toContain("statusProbeFailures >= 2");
    }
    const model = app.slice(app.indexOf("async function openModel("), app.indexOf("async function focusCurrentEditor()"));
    expect(model).not.toContain("statusProbeFailures >= 2");
    expect(model).not.toContain("ensure_ready");
    expect(model).not.toContain("manager_available");
    expect(model).toContain("editorOperations.openModel(id)");
    const readOnly = app.slice(app.indexOf("async function runProjectAction("), app.indexOf("async function openModel("));
    expect(readOnly).toContain("'project_navigation_action'");
    expect(readOnly).not.toContain("statusProbeFailures >= 2");
    expect(app).toContain("onclick={() => openModel()}");
    expect(app).toContain("disabled={loading || busyAction !== null} onclick={refresh}");
    expect(app).toContain("connectionMonitor.fullStatusSucceeded()");
  });
});

describe("Desktop current-model presentation", () => {
  test("prioritizes model identity and only offers saved-model launch", async () => {
    const ui = await Bun.file("../apps/desktop/src/ProjectNavigator.svelte").text();
    expect(ui).toContain("<h2>Current Model</h2>");
    expect(ui).toContain("<h2>Continue working</h2>");
    expect(ui).toContain('<div class="project-title">{active.model_name}</div>');
    expect(ui).toContain('<div class="project-title">{target.model.name}</div>');
    expect(ui).toContain("onAddProjectFolder");
    expect(ui).toContain("onclick={onFocusEditor}");
    expect(ui).toContain("Go to Blockbench");
    expect(ui).toContain("<h2>Recent Models</h2>");
    expect(ui).toContain("aria-expanded={expandedProjectId === project.id}");
  });
});

describe("Desktop calm connection summary", () => {
  test("short actionable errors keep raw details in Support, never in Workspace notices", async () => {
    const { desktopErrorNotice } = await import("../../../apps/desktop/src/desktopPresentation");
    const legacy = desktopErrorNotice({
      code: "BOOTSTRAP_INSTALL_FAILED",
      message: "Local file is not owned or was edited: C:/User/Data/Blockbench/plugins/file.js. Use --adopt",
    });
    expect(legacy.title).toBe("Existing file needs review");
    expect(legacy.message).toContain("preserved rather than overwritten");
    expect(legacy.message).not.toContain("C:/User/Data");
    expect(legacy.message).not.toContain("--adopt");
    expect(legacy.detail).toContain("--adopt");

    const invalidProfile = desktopErrorNotice({
      code: "BLOCKBENCH_PROFILE_UNVERIFIED", message: "Different profiles detected",
    });
    expect(invalidProfile.title).toBe("Blockbench profile needs review");

    const wait = desktopErrorNotice(new Error("Status request timed out. Refresh to retry."));
    expect(wait.message).toContain("File opening remains available");
    const unknown = desktopErrorNotice({ code: "UNEXPECTED", message: "opaque-machine-path" });
    expect(unknown.message).not.toContain("opaque-machine-path");
    expect(unknown.detail).toBe("opaque-machine-path");

    const app = await Bun.file("../apps/desktop/src/App.svelte").text();
    expect(app).toContain("desktopErrorNotice(cause)");
    expect(app).toContain("error ? errorTitle");
    const support = await source("../apps/desktop/src/SupportPage.svelte");
    expect(app).toContain("<SupportPage");
    expect(support).toContain("<h2>Last unsuccessful action</h2>");
    expect(support).toContain("<code>{errorDetail}</code>");
    expect(await workspaceSource).toContain("<h2>AI connection and updates</h2>");
    expect(support).toContain("<strong>Installed Blockbench plugin</strong>");
  });

  test("passive connection polling pauses when hidden and uses a slower idle cadence", async () => {
    const { connectionCheckDelayMs } = await import("../../../apps/desktop/src/connectionWatch");
    expect(connectionCheckDelayMs(true)).toBe(8000);
    expect(connectionCheckDelayMs(false)).toBe(20000);
    const [ui, native] = await Promise.all([
      Bun.file("../apps/desktop/src/App.svelte").text(),
      Bun.file("../apps/desktop/src-tauri/src/system_status.rs").text(),
    ]);
    const monitor = await source("../apps/desktop/src/connectionMonitor.ts");
    expect(monitor).toContain("clearTimeout(timer)");
    expect(monitor).toContain("connectionCheckDelayMs(status.blockbench.running)");
    expect(ui).toContain("if (document.hidden) connectionMonitor.stop()");
    expect(ui).toContain("connectionMonitor.request()");
    expect(ui).toContain("connectionMonitor.dispose()");
    expect(ui).not.toContain("window.setInterval(() => { void watchSystemStatus(); }, 3000)");
    const fast = native.slice(native.indexOf("pub fn collect_connection_status()"), native.indexOf("pub fn collect() -> SystemStatus"));
    expect(fast).toContain("crate::process::process_snapshot()");
    expect(fast).not.toContain("System::new_all()");
    expect(monitor).toContain("if (disposed || failures >= 2) return;");
    const support = await source("../apps/desktop/src/SupportPage.svelte");
    expect(support).toContain("disabled={!status.maintenance.repair");
  });

  test("preserves setup and error guidance and makes healthy project view primary", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    const workspace = await workspaceSource;
    expect(ui).toContain("<WorkspacePage");
    expect(workspace).toContain('class="workspace-connection"');
    expect(workspace).toContain("statusProbeFailures >= 2 ? 'AI status unverified'");
    expect(workspace).toContain("status.project_navigation.projects.length > 0");
    expect(workspace).toContain("productMode(status) === 'ready' || productMode(status) === 'client-wait'");
    expect(workspace.indexOf("<ProjectNavigator")).toBeLessThan(workspace.indexOf("<h2>AI connection and updates</h2>"));
    expect(workspace).toContain("runManagedAction('setup-tls')");
    expect(workspace).toContain("Update components");
  });
});

describe("Desktop explicit Blockbench window focus", () => {
  test("verifies a unique Blockbench-owned foreground window without changing Gateway ownership", async () => {
    const [blockbench, main, app] = await Promise.all([
      Bun.file("../apps/desktop/src-tauri/src/blockbench.rs").text(),
      Bun.file("../apps/desktop/src-tauri/src/main.rs").text(),
      Bun.file("../apps/desktop/src/App.svelte").text(),
    ]);
    expect(blockbench).toContain("fn EnumWindows(");
    expect(blockbench).toContain("fn GetWindowThreadProcessId(");
    expect(blockbench).toContain("fn GetForegroundWindow()");
    expect(blockbench).toContain("GetWindowTextLengthW(window) <= 0");
    expect(blockbench).toContain("is_executable_name(path)");
    expect(blockbench).toContain('"AMBIGUOUS"');
    expect(blockbench).toContain("fn unique_target<T: Copy>(windows: &[T])");
    expect(blockbench).toContain("unique_target(&candidates.windows)");
    expect(blockbench).toContain("unique_target::<usize>(&[])");
    expect(blockbench).toContain("if GetForegroundWindow() == target");
    expect(main).toContain("fn focus_blockbench_window()");
    expect(main).toContain("focus_blockbench_window,");
    const operations = await source("../apps/desktop/src/editorOperations.ts");
    expect(operations).toContain("async function focusBlockbenchAfterOpen()");
    expect(operations).toContain("result.status === 'FOCUSED'");
    expect(app).toContain("editorOperations.focus()");
    expect(app).toContain("Select your Blockbench window from the taskbar.");
    expect(app).toContain("Blockbench is ready. Select it from the taskbar if needed.");
    const watcher = await source("../apps/desktop/src/connectionMonitor.ts");
    expect(watcher).not.toContain("focusBlockbenchAfterOpen");
  });
});

describe("Desktop disclosure keyboard and focus contract", () => {
  test("uses native details disclosure semantics instead of incomplete ARIA menus", async () => {
    const [app, navigator] = await Promise.all([
      Bun.file("../apps/desktop/src/App.svelte").text(),
      Bun.file("../apps/desktop/src/ProjectNavigator.svelte").text(),
    ]);
    for (const ui of [app, navigator]) {
      expect(ui).not.toContain('role="menu"');
      expect(ui).not.toContain('role="menuitem"');
      expect(ui).not.toContain('aria-haspopup="menu"');
      expect(ui).toContain('class="more-menu"');
    }
    expect(app).toContain("const focusedDisclosure = openDisclosures.find(menu => menu.contains(active))");
    expect(app).toContain("focusedDisclosure?.querySelector<HTMLElement>('summary')?.focus()");
    expect(app).toContain("event.key === 'Escape' && document.querySelector('details.more-menu[open]')");
    expect(app).toContain("if (!menu.contains(target)) menu.open = false");
  });
});

describe("Desktop native acceptance runbook alignment", () => {
  test("requires actual foreground proof, avoids outdated Switch labels and covers keyboard", async () => {
    const runbook = await Bun.file("../docs/05-operations/local-acceptance-runbook.md").text();
    expect(runbook).toContain("### Explicit Open / native foreground focus");
    expect(runbook).toContain("GetForegroundWindow");
    expect(runbook).toContain("AMBIGUOUS");
    expect(runbook).toContain("DENIED, not FOCUSED");
    expect(runbook).toContain("opening a saved .bbmodel that is already open");
    expect(runbook).toContain("### Workspace interaction / accessibility");
    expect(runbook).toContain("Escape closes the disclosure and restores focus");
    expect(runbook).toContain("click Open for an already-open model");
    expect(runbook).not.toContain("click Switch for an already-open model");
  });
});

describe("Desktop full-status freshness and nullable project revision", () => {
  test("accepts the actual nullable initial project projection and detects a new revision", () => {
    // This is the same ProjectNavigation type consumed by App.svelte.
    const navigation: ProjectNavigation = {
      revision: null, session_live: false, continue_model_id: null,
      recent_model_ids: [],
      preferences_issue: null, active: null, projects: [],
    };
    const baseline: ConnectionBaseline = {
      blockbench: { running: false },
      runtime_listener_live: false,
      plugin_integrity: "ready",
      managed: null,
      project_navigation: navigation,
    };
    const candidate: ConnectionObservation = {
      blockbench_running: false, runtime_listener_live: false,
      gateway_active: null, plugin_integrity: "ready",
      project_revision: null, project_session_live: false,
    };
    expect(connectionChanged(candidate, baseline)).toBe(false);
    expect(connectionChanged({ ...candidate, project_revision: "generation:1" }, baseline)).toBe(true);
  });

  test("does not reenable actions from a lightweight probe after full-status failure", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    const refresh = ui.slice(ui.indexOf("async function refresh()"), ui.indexOf("async function runProjectAction"));
    const watcher = await source("../apps/desktop/src/connectionMonitor.ts");
    expect(refresh).toContain("connectionMonitor.fullStatusFailed()");
    expect(refresh).toContain("connectionMonitor.fullStatusSucceeded()");
    expect(watcher).toContain("if (disposed || failures >= 2) return;");
    expect(watcher.indexOf("if (disposed || failures >= 2) return;"))
      .toBeLessThan(watcher.indexOf("else setFailures(0);"));
    expect(await workspaceSource).toContain("busy={busyAction !== null}");
    expect(await workspaceSource).toContain("canEditProjectPrefs={true}");
  });
});

describe("Desktop small-text contrast", () => {
  test("muted metadata remains distinct and legible on dark elevated surfaces", async () => {
    const css = await Bun.file("../apps/desktop/src/tokens.css").text();
    const token = (name: string): string => {
      const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
      if (!match) throw new Error(`Missing six-digit color token ${name}`);
      return match[1];
    };
    const luminance = (hex: string): number => {
      const linear = [1, 3, 5].map(index => {
        const value = parseInt(hex.slice(index, index + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (first: string, second: string): number => {
      const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (high + 0.05) / (low + 0.05);
    };
    for (const surface of ["bg", "surface", "surface-2", "surface-3"]) {
      expect(contrast(token("muted-2"), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("muted"), token("surface-3")))
      .toBeGreaterThan(contrast(token("muted-2"), token("surface-3")));
  });
});

describe("Desktop pure status presentation", () => {
  test("managed MCP proof requires a real client tool and matching current Runtime generation", async () => {
    const [writer, index, cli, backend, handlers, native, health, watcher, ready] = await Promise.all([
      source("gateway/session/leaseEvidence.ts"),
      source("gateway/index.ts"),
      source("../distribution/cli.ts"),
      source("gateway/runtime/backend.ts"),
      source("gateway/handlers/registerCoreTools.ts"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src-tauri/src/runtime_health.rs"),
      source("../apps/desktop/src/connectionWatch.ts"),
      source("../apps/desktop/src-tauri/src/readiness.rs"),
    ]);
    expect(cli).toContain("LAZYDESIGNER_GATEWAY_LEASE_PATH");
    expect(index).toContain("publishManagedGatewayLeaseEvidence(backend.observedManagedCatalogEvidence())");
    expect(handlers).toContain("onGatewayToolRequest");
    expect(backend).toContain("this.lastVerifiedHealthSignature = probe.signature");
    expect(writer).toContain("observed_at_unix_ms");
    expect(writer).toContain("catalog_ready: ready");
    expect(native).toContain("GATEWAY_MCP_PROOF_TTL_MS");
    expect(native).toContain("seen >= runtime_start");
    expect(health).toContain("started_at_unix_ms: Some(lease.started_at_unix_ms)");
    expect(watcher).toContain("candidate.gateway_mcp_ready");
    expect(ready).toContain('state: "gateway-detected"');
    expect(ready).toContain('state: "healthy"');
  });

  test("passive observation refreshes only when verified MCP evidence changes", () => {
    const baseline = {
      blockbench: { running: true }, runtime_listener_live: true,
      managed: { gateway_active: true }, gateway: { state: "gateway-detected" },
      plugin_integrity: "ready",
      project_navigation: { revision: null, session_live: false },
    };
    const observation = {
      blockbench_running: true, runtime_listener_live: true, gateway_active: true,
      gateway_mcp_ready: false, plugin_integrity: "ready",
      project_revision: null, project_session_live: false,
    };
    expect(connectionChanged(observation, baseline)).toBe(false);
    expect(connectionChanged({ ...observation, gateway_mcp_ready: true }, baseline)).toBe(true);
    expect(connectionChanged(observation, { ...baseline, gateway: { state: "healthy" } })).toBe(true);
    expect(connectionChanged({ ...observation, gateway_mcp_ready: true }, { ...baseline, gateway: { state: "healthy" } })).toBe(false);
  });



  test("Desktop does not equate a Gateway PID and Runtime lease with an MCP handshake", async () => {
    const [readiness, system, app, workspace, types] = await Promise.all([
      source("../apps/desktop/src-tauri/src/readiness.rs"),
      source("../apps/desktop/src-tauri/src/system_status.rs"),
      source("../apps/desktop/src/App.svelte"),
      workspaceSource,
      source("../apps/desktop/src/desktopTypes.ts"),
    ]);
    expect(readiness).toContain('state: "gateway-detected"');
    expect(readiness).toContain('state: "healthy"');
    expect(readiness).toContain('ready: false');
    expect(readiness).toContain('gateway.state == "gateway-detected"');
    expect(system).toContain('status: if verified.readiness.ready { "READY" } else { "RUNTIME_READY" }');
    expect(system).toContain('"MCP_SESSION_UNVERIFIED"');
    expect(app).toContain("result.reason === 'MCP_SESSION_UNVERIFIED'");
    expect(workspace).toContain('MCP handshake unverified');
    expect(types).toContain("'gateway-detected'");
    expect(readiness).toContain("fn readiness_projection_covers_workstation_states()");
  });


  test("preserves all canonical product headlines and compatibility labels", async () => {
    const { productHeadline, productMessage, compatibilityLabel } = await import("../../../apps/desktop/src/desktopPresentation");
    for (const [mode, headline] of [
      ["welcome", "Welcome to LazyDesigner"], ["security-setup", "Finish setup"],
      ["unsupported", "Blockbench version not supported"], ["ready-start", "Ready to start"],
      ["plugin-setup", "Connect LazyDesigner to Blockbench"],
      ["client-wait", "Blockbench ready"], ["ready", "Ready to use"],
      ["attention", "Action required"],
    ] as const) {
      expect(productHeadline({ product_state: mode } as never)).toBe(headline);
    }
    expect(productMessage({ product_state: "attention", readiness: { summary: "Rust summary" } } as never)).toBe("Rust summary");
    expect(compatibilityLabel("compatible-unverified")).toBe("Compatible · unverified");
    expect(compatibilityLabel(undefined)).toBe("Unavailable");
  });

  test("bootstrap STAGED never triggers readiness or mislabels setup complete", async () => {
    const { bootstrapInstallPresentation } = await import("../../../apps/desktop/src/desktopPresentation");
    const staged = bootstrapInstallPresentation({ status: "STAGED", reason: "active Runtime" });
    expect(staged.status).toBe("STAGED");
    expect(staged.kind).toBe("pending");
    expect(staged.verifyRuntime).toBe(false);
    const installed = bootstrapInstallPresentation({
      status: "INSTALLED", source_sha: "a".repeat(40),
    });
    expect(installed.kind).toBe("success");
    expect(installed.verifyRuntime).toBe(true);
    for (const bad of [{}, { status: "UNKNOWN" }, { status: "INSTALLED" }, { status: "INSTALLED", source_sha: "wrong" }]) {
      expect(() => bootstrapInstallPresentation(bad)).toThrow(/unverified installation result/);
    }
    const [app, rust] = await Promise.all([
      Bun.file("../apps/desktop/src/App.svelte").text(),
      Bun.file("../apps/desktop/src-tauri/src/system_status.rs").text(),
    ]);
    const bootstrap = app.slice(app.indexOf("async function installLazyDesigner()"), app.indexOf("async function showPluginFile()"));
    const setup = await source("../apps/desktop/src/setupOperations.ts");
    expect(bootstrap).toContain("setupOperations.install(");
    expect(bootstrap).toContain("setupStaged = !feedback.verifyRuntime");
    expect(setup).toContain("bootstrapInstallPresentation(result.receipt)");
    expect(setup.indexOf("if (!feedback.verifyRuntime)")).toBeLessThan(setup.indexOf("readiness: await ensureReady(hooks)"));
    expect(await workspaceSource).toContain("Setup waiting for Blockbench");
    expect(await workspaceSource).toContain("setupStaged ? 'Finish setup'");
    expect(rust).toContain("bootstrap returned an unverified installation receipt.");
  });

  test("keeps plugin approval, mismatch, and security guidance precedence", async () => {
    const { productGuidance } = await import("../../../apps/desktop/src/desktopPresentation");
    const status = (mode: string, patch: Record<string, unknown> = {}) => ({
      product_state: mode, bootstrap_available: true,
      maintenance: { setup_tls: true, blocked_reason: null },
      runtime_endpoint_match: null, plugin_integrity: "ready",
      gateway: { action: null }, blockbench: { diagnostic: null }, diagnostic: null,
      ...patch,
    });
    expect(productGuidance(status("plugin-setup", { runtime_endpoint_match: false }) as never, true)).toContain("different local connection settings");
    expect(productGuidance(status("plugin-setup") as never, true)).toContain("one-time approval");
    expect(productGuidance(status("welcome", { bootstrap_available: false }) as never, false)).toContain("does not contain");
    expect(productGuidance(status("security-setup", { maintenance: { setup_tls: false, blocked_reason: "Busy runtime" } }) as never, false)).toBe("Busy runtime");
    expect(productGuidance(status("attention", { plugin_integrity: "modified" }) as never, false)).toContain("modified");
    expect(productGuidance(status("attention", { gateway: { action: "Reconnect" } }) as never, false)).toBe("Reconnect");
    expect(productGuidance(status("ready") as never, false)).toBeNull();
  });

  test("delegates IPC types and display-only mapping out of App.svelte", async () => {
    const [svelte, dto, presentation] = await Promise.all([
      Bun.file("../apps/desktop/src/App.svelte").text(),
      Bun.file("../apps/desktop/src/desktopTypes.ts").text(),
      Bun.file("../apps/desktop/src/desktopPresentation.ts").text(),
    ]);
    expect(svelte).toContain("from './desktopTypes'");
    expect(svelte).toContain("from './desktopPresentation'");
    expect(svelte).not.toContain("type SystemStatus =");
    expect(svelte).not.toContain("function productHeadline(");
    expect(await workspaceSource).toContain("productGuidance(status, pluginApprovalNeeded)");
    expect(dto).toContain("project_navigation: ProjectNavigation");
    expect(presentation).not.toContain("invoke(");
    expect(presentation).not.toContain("ensure_ready");
    expect(presentation).toContain("import type { Compatibility, ProductMode, SystemStatus, EnsureReadyResult }");
    expect(presentation).not.toContain("type ProductMode =");
  });
});

describe("Desktop Workspace and Support feedback integrity", () => {
  test("keeps stale Support observations clearly unverified and recoverable", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    const support = await source("../apps/desktop/src/SupportPage.svelte");
    expect(ui).toContain("<SupportPage");
    expect(support).toContain('<main class="page-content settings-content">');
    expect(support).toContain("{#if statusProbeFailures >= 2}");
    expect(support).toContain("These are the last known connection details.");
    expect(support).toContain('onclick={refresh}');
    expect(support).toContain("{:else if productMode(status) !== 'ready'}");
    const copy = ui.slice(ui.indexOf("async function copyNavigationPath("), ui.indexOf("async function connectBlockbench()"));
    expect(copy).not.toContain("statusProbeFailures >= 2");
    expect(copy).toContain("project_navigation_path");
  });

  test("never claims plugin approval is required from opening a file", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    const show = ui.slice(ui.indexOf("async function showPluginFile()"), ui.indexOf("async function exportDiagnostics()"));
    expect(show).toContain("pluginApprovalNeeded && productMode(status) === 'plugin-setup'");
    expect(show).toContain("Approve it in Blockbench if prompted.");
    expect(show).toContain("Plugin file highlighted in File Explorer.");
    expect(show).not.toContain("Approve it once in Blockbench to complete setup.");
  });

  test("describes managed updates consistently without promising a Desktop binary update", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    expect(await workspaceSource).toContain("Updating managed components");
    const presentation = await source("../apps/desktop/src/desktopPresentation.ts");
    expect(presentation).toContain("Update managed components");
    expect(ui).toContain("managedActionLabel(action)");
    expect(ui).not.toContain("Update LazyDesigner' : action === 'rollback'");
  });
});

test("managed CLI bundles its canonical Gateway entrypoint", async () => {
  const result = await Bun.build({
    entrypoints: ["../distribution/cli.ts"],
    target: "bun",
  });
  expect(result.success, result.logs.map(String).join("\n")).toBe(true);
});

describe("Desktop observation wiring", () => {
  test("only read-only status commands use the observation deadline", async () => {
    const ui = await Bun.file("../apps/desktop/src/App.svelte").text();
    expect(ui).toContain("observeStatus(invoke<SystemStatus>('system_status'), 30_000)");
    expect(ui).toContain("observeStatus(invoke<ConnectionStatus>('connection_status'), 10_000)");
    expect(ui.match(/observeStatus\(invoke</g)).toHaveLength(2);
  });
});
