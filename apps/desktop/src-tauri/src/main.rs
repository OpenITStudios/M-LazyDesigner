#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(all(feature = "native-acceptance", not(debug_assertions)))]
compile_error!("native-acceptance is debug-only and must never ship in a release");

#[cfg(all(feature = "native-acceptance", debug_assertions))]
mod native_acceptance;

mod analytics;
mod blockbench;
mod blockbench_surface;
mod desktop_error;
mod desktop_instance;
mod desktop_authoring;
mod diagnostics;
mod operation_log;
mod metadata_io;
mod model_open_proof;
mod runtime_health;
mod process;
mod project_navigation;
mod project_deletion;
mod readiness;
mod system_status;

use desktop_error::DesktopError;
use tauri::Emitter;
use diagnostics::DiagnosticExportResult;
use blockbench::{BlockbenchActionResult, ModelBrowseResult};
use system_status::{BootstrapActionResult, ConnectionStatus, EnsureReadyResult, ManagedActionResult, ManagedUpdateCheck, PluginFileActionResult, ProjectNavigationActionResult, ProjectPathResult, SystemStatus};

#[tauri::command]
fn system_status(app: tauri::AppHandle) -> Result<SystemStatus, DesktopError> {
    #[cfg(all(feature = "native-acceptance", debug_assertions))]
    if native_acceptance::enabled("full-error") {
        return Err(DesktopError::recoverable("ACCEPTANCE_IPC_ERROR", "Injected native full-status rejection".to_string()));
    }
    let mut status = system_status::collect();
    status.bootstrap_available = system_status::bootstrap_available(&app);
    Ok(status)
}

#[tauri::command]
fn connection_status() -> Result<ConnectionStatus, DesktopError> {
    #[cfg(all(feature = "native-acceptance", debug_assertions))]
    if native_acceptance::enabled("probe-error") {
        return Err(DesktopError::recoverable("ACCEPTANCE_IPC_ERROR", "Injected native probe rejection".to_string()));
    }
    Ok(system_status::collect_connection_status())
}

#[tauri::command]
fn ensure_ready(app: tauri::AppHandle) -> Result<EnsureReadyResult, DesktopError> {
    let result = system_status::ensure_ready(&app);
    match &result {
        Ok(value) if value.status == "NEEDS_ATTENTION" => {
            operation_log::record("ensure_ready", value.reason);
        }
        Ok(value) => {
            operation_log::record("ensure_ready", value.status);
        }
        Err(_) => {
            operation_log::record("ensure_ready", "ERROR");
        }
    }
    result.map_err(|message| DesktopError::recoverable("ENSURE_READY_FAILED", message))
}

#[cfg(not(all(feature = "native-acceptance", debug_assertions)))]
#[tauri::command]
fn focus_blockbench_window() -> blockbench::BlockbenchFocusResult {
    // Only called from a direct user Open action; never from the status watcher.
    blockbench::focus_window()
}

#[cfg(all(feature = "native-acceptance", debug_assertions))]
#[tauri::command]
async fn focus_blockbench_window() -> blockbench::BlockbenchFocusResult {
    if native_acceptance::enabled("focus-delayed-real") {
        let result = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_secs(20));
            blockbench::focus_window()
        }).await.unwrap_or(blockbench::BlockbenchFocusResult { status: "UNKNOWN" });
        operation_log::record("acceptance:real-focus", result.status);
        return result;
    }
    for (fault, status) in [("focus-denied", "DENIED"), ("focus-no-window", "NO_WINDOW")] {
        if native_acceptance::enabled(fault) {
            return blockbench::BlockbenchFocusResult { status };
        }
    }
    blockbench::focus_window()
}

#[tauri::command]
fn native_editor_surface(
    action: String,
    viewport: Option<blockbench_surface::EditorViewport>,
) -> Result<blockbench_surface::EditorSurfaceReceipt, DesktopError> {
    // Direct-user/debug-only composition, never a status/probe side effect.
    blockbench_surface::command(&action, viewport)
        .map_err(|message| DesktopError::recoverable("NATIVE_EDITOR_SURFACE_UNVERIFIED", message))
}

#[tauri::command]
async fn open_blockbench_editor() -> Result<BlockbenchActionResult, DesktopError> {
    tauri::async_runtime::spawn_blocking(blockbench::open_editor)
        .await
        .map_err(|error| DesktopError::recoverable("EDITOR_LAUNCH_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("EDITOR_LAUNCH_FAILED", message))
}

#[tauri::command]
async fn choose_blockbench_executable() -> Result<BlockbenchActionResult, DesktopError> {
    tauri::async_runtime::spawn_blocking(blockbench::choose_executable)
        .await
        .map_err(|error| DesktopError::recoverable("BLOCKBENCH_EXECUTABLE_SELECTION_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("BLOCKBENCH_EXECUTABLE_SELECTION_FAILED", message))
}

#[tauri::command]
async fn browse_model() -> Result<ModelBrowseResult, DesktopError> {
    tauri::async_runtime::spawn_blocking(blockbench::browse_model)
        .await
        .map_err(|error| DesktopError::recoverable("MODEL_PICKER_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("MODEL_PICKER_FAILED", message))
}

#[tauri::command]
fn check_managed_update() -> Result<ManagedUpdateCheck, DesktopError> {
    system_status::check_managed_update()
        .map_err(|message| DesktopError::recoverable("UPDATE_CHECK_FAILED", message))
}

#[tauri::command]
fn managed_action(app: tauri::AppHandle, action: String, expected_source_sha: Option<String>) -> Result<ManagedActionResult, DesktopError> {
    let event = format!("managed:{}", action);
    let result = system_status::run_managed_action(&app, &action, expected_source_sha.as_deref());
    match &result {
        Ok(value) => {
            let outcome = value.receipt
                .get("status")
                .and_then(|status| status.as_str())
                .unwrap_or("COMPLETE");
            operation_log::record(&event, outcome);
        }
        Err(_) => operation_log::record(&event, "ERROR"),
    }
    result.map_err(|message| DesktopError::recoverable("MANAGED_ACTION_FAILED", message))
}

fn bootstrap_install_error(message: String) -> DesktopError {
    if message.contains("Retired BlockIT client configuration detected") {
        return DesktopError::recoverable(
            "LEGACY_CLIENT_MIGRATION_REQUIRED",
            "An older BlockIT AI client entry was found. The existing Codex configuration was preserved. Review and back it up before a separate LazyDesigner migration.".to_string(),
        );
    }
    DesktopError::recoverable("BOOTSTRAP_INSTALL_FAILED", message)
}

#[tauri::command]
fn bootstrap_install(app: tauri::AppHandle, migrate_legacy: Option<bool>) -> Result<BootstrapActionResult, DesktopError> {
    let migrate_legacy = migrate_legacy.unwrap_or(false) || system_status::pending_bootstrap() == Some(true);
    let older_plugin = system_status::retired_plugin_for_setup()
        .map_err(|message| DesktopError::recoverable("BLOCKBENCH_PROFILE_UNVERIFIED", message))?;
    if older_plugin && !migrate_legacy {
        operation_log::record("bootstrap_install", "LEGACY_MIGRATION_REQUIRED");
        return Err(DesktopError::recoverable(
            "LEGACY_PLUGIN_MIGRATION_REQUIRED",
            "An older BlockIT plugin is present. Review and back up the old plugin before installing the new LazyDesigner Runtime.".to_string(),
        ));
    }
    let result = system_status::bootstrap_install(&app, migrate_legacy);
    operation_log::record("bootstrap_install", if result.is_ok() { "ok" } else { "error" });
    result.map_err(bootstrap_install_error)
}

#[tauri::command]
fn show_retired_plugin_file() -> Result<PluginFileActionResult, DesktopError> {
    system_status::show_retired_plugin_file()
        .map_err(|message| DesktopError::recoverable("LEGACY_PLUGIN_REVIEW_FAILED", message))
}

#[tauri::command]
async fn add_project_folder() -> Result<ProjectNavigationActionResult, DesktopError> {
    let result = tauri::async_runtime::spawn_blocking(project_navigation::add_project_folder)
        .await
        .map_err(|error| DesktopError::recoverable("PROJECT_FOLDER_PICKER_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("PROJECT_FOLDER_PICKER_FAILED", message))?;
    operation_log::record("project:add-folder", result.status);
    Ok(result)
}

#[tauri::command]
async fn create_project_folder(name: String) -> Result<ProjectNavigationActionResult, DesktopError> {
    let result = tauri::async_runtime::spawn_blocking(move || project_navigation::create_project_folder(&name))
        .await
        .map_err(|error| DesktopError::recoverable("PROJECT_FOLDER_CREATE_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("PROJECT_FOLDER_CREATE_FAILED", message))?;
    operation_log::record("project:create-folder", result.status);
    Ok(result)
}

#[tauri::command]
async fn prepare_delete_project(id: String) -> Result<project_deletion::ProjectDeletePreview, DesktopError> {
    tauri::async_runtime::spawn_blocking(move || project_deletion::prepare(id))
        .await
        .map_err(|error| DesktopError::recoverable("PROJECT_DELETE_REVIEW_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("PROJECT_DELETE_REVIEW_FAILED", message))
}

#[tauri::command]
fn cancel_delete_project(token: String) {
    project_deletion::cancel(token);
}

#[tauri::command]
async fn confirm_delete_project(token: String) -> Result<project_deletion::ProjectDeleteResult, DesktopError> {
    let result = tauri::async_runtime::spawn_blocking(move || project_deletion::confirm(token))
        .await
        .map_err(|error| DesktopError::recoverable("PROJECT_RECYCLE_FAILED", error.to_string()))?
        .map_err(|message| DesktopError::recoverable("PROJECT_RECYCLE_FAILED", message))?;
    operation_log::record("project:recycle", result.status);
    Ok(result)
}

#[tauri::command]
async fn project_navigation_action(action: String, id: String) -> Result<ProjectNavigationActionResult, DesktopError> {
    // Open Model performs a bounded native acknowledgment check: keep the
    // synchronous file/proc inspection off Tauri's IPC request thread.
    let task_action = action.clone();
    let result = tauri::async_runtime::spawn_blocking(move ||
        system_status::project_navigation_action(&task_action, &id)
    ).await.map_err(|error|
        DesktopError::recoverable("PROJECT_NAVIGATION_FAILED", error.to_string())
    )?;
    operation_log::record(
        &format!("project:{}", action),
        if result.is_ok() { "OK" } else { "ERROR" },
    );
    result.map_err(|message| DesktopError::recoverable("PROJECT_NAVIGATION_FAILED", message))
}

#[tauri::command]
fn project_navigation_path(id: String) -> Result<ProjectPathResult, DesktopError> {
    system_status::project_navigation_path(&id)
        .map_err(|message| DesktopError::recoverable("PROJECT_PATH_FAILED", message))
}

#[tauri::command]
fn show_plugin_file() -> Result<PluginFileActionResult, DesktopError> {
    system_status::show_plugin_file()
        .map_err(|message| DesktopError::recoverable("PLUGIN_FILE_FAILED", message))
}

#[tauri::command]
fn export_diagnostics() -> Result<DiagnosticExportResult, DesktopError> {
    diagnostics::export()
}

#[tauri::command]
async fn analytics_overview() -> Result<analytics::AnalyticsOverview, DesktopError> {
    // Cached snapshot reads stay off Tauri's IPC event thread.
    tauri::async_runtime::spawn_blocking(analytics::overview)
        .await
        .map_err(|_| DesktopError::recoverable(
            "ANALYTICS_READ_FAILED", "Unable to read local Analytics.".to_owned()
        ))?
}

#[tauri::command]
async fn export_analytics() -> Result<analytics::AnalyticsExportResult, DesktopError> {
    tauri::async_runtime::spawn_blocking(analytics::export)
        .await
        .map_err(|_| DesktopError::recoverable(
            "ANALYTICS_EXPORT_FAILED", "Unable to export local Analytics.".to_owned()
        ))?
}

fn main() {
    // Internal Windows debug-only recovery child must run before the single
    // Desktop instance mutex and before Tauri/WebView startup. A source-only
    // helper is not Windows acceptance or a release feature.
    if blockbench_surface::maybe_run_recovery_helper() {
        return;
    }
    let _instance_guard = match desktop_instance::acquire()
        .expect("LazyDesigner Desktop instance ownership failed")
    {
        desktop_instance::InstanceAcquire::Primary(guard) => guard,
        desktop_instance::InstanceAcquire::Secondary => return,
    };

    let pid = std::process::id().to_string();
    operation_log::record("desktop:start", &pid);
    let previous_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        operation_log::record("desktop:panic", &std::process::id().to_string());
        previous_panic_hook(info);
    }));

    tauri::Builder::default()
        .manage(desktop_authoring::EditorState::default())
        .invoke_handler(tauri::generate_handler![
            system_status,
            connection_status,
            ensure_ready,
            focus_blockbench_window,
            native_editor_surface,
            open_blockbench_editor,
            choose_blockbench_executable,
            browse_model,
            check_managed_update,
            managed_action,
            bootstrap_install,
            project_navigation_action,
            add_project_folder,
            create_project_folder,
            prepare_delete_project,
            cancel_delete_project,
            confirm_delete_project,
            project_navigation_path,
            show_plugin_file,
            show_retired_plugin_file,
            export_diagnostics,
            analytics_overview,
            export_analytics,
            desktop_authoring::rust_editor_snapshot,
            desktop_authoring::rust_editor_new,
            desktop_authoring::rust_editor_open,
            desktop_authoring::rust_editor_apply,
            desktop_authoring::rust_editor_add_cube,
            desktop_authoring::rust_editor_undo,
            desktop_authoring::rust_editor_redo,
            desktop_authoring::rust_editor_save_copy
        ])
        .build(tauri::generate_context!())
        .expect("error while building LazyDesigner Desktop")
        .run(move |app, event| {
            let name = match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                        | tauri::WindowEvent::Focused(_),
                    ..
                } if label == "main" => {
                    // Minimize never leaves Blockbench visually floating in place.
                    blockbench_surface::release_if_manager_minimized();
                    let _ = app.emit("native-editor-layout", ());
                    return;
                }
                tauri::RunEvent::Ready => "desktop:ready",
                tauri::RunEvent::ExitRequested { .. } => {
                    blockbench_surface::restore_on_exit();
                    "desktop:exit-requested"
                },
                tauri::RunEvent::Exit => {
                    blockbench_surface::restore_on_exit();
                    "desktop:exit"
                },
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. }, .. }
                    if label == "main" => {
                        blockbench_surface::restore_on_exit();
                        "desktop:close-requested"
                    },
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. }
                    if label == "main" => "desktop:destroyed",
                _ => return,
            };
            operation_log::record(name, &pid);
        });
}

#[cfg(test)]
mod bootstrap_migration_tests {
    use super::*;

    #[test]
    fn retired_client_is_a_separate_actionable_error() {
        let legacy = bootstrap_install_error(
            "LazyDesigner: Retired BlockIT client configuration detected. No configuration changed.".to_string()
        );
        assert_eq!(legacy.code, "LEGACY_CLIENT_MIGRATION_REQUIRED");
        assert!(legacy.message.contains("configuration was preserved"));
        let other = bootstrap_install_error("Unknown installer failure".to_string());
        assert_eq!(other.code, "BOOTSTRAP_INSTALL_FAILED");
    }
}
