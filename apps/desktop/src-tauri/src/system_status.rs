use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    collections::HashMap,
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use crate::{
    blockbench::{self, BlockbenchState},
    process::{run_output, run_output_with_stderr_lines},
    project_navigation,
    readiness::{self, GatewaySupervision, MaintenanceAvailability, ReadinessProjection},
    runtime_health,
};
pub use crate::project_navigation::{
    ProjectNavigation,
    ProjectNavigationActionResult,
    ProjectPathResult,
};
use sysinfo::{Pid, System};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

#[derive(Debug, Deserialize, Serialize)]
pub struct ManagedInstalled {
    pub source_sha: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ManagedRollback { pub available: bool, pub previous_source_sha: Option<String>, pub transaction: Option<String> }

#[derive(Debug, Deserialize, Serialize)]
pub struct ManagedStatus {
    pub schema: u8,
    pub installed: Option<ManagedInstalled>,
    pub pending: bool,
    pub gateway_active: bool,
    pub runtime_online: bool,
    #[serde(default = "default_runtime_url")]
    pub runtime_url: String,
    pub tls_ready: bool,
    pub tls_error: Option<String>,
    #[serde(default)]
    pub rollback: Option<ManagedRollback>,
}

fn default_runtime_url() -> String {
    "https://127.0.0.1:3000/bb-mcp".to_string()
}

#[derive(Debug, Serialize)]
pub struct PluginFileActionResult {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct BootstrapActionResult {
    pub action: &'static str,
    pub receipt: Value,
}

#[derive(Debug, Serialize)]
pub struct ManagedActionResult {
    pub action: String,
    pub receipt: Value,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ManagedUpdateCheck {
    pub status: String,
    pub installed_source_sha: Option<String>,
    pub available_source_sha: Option<String>,
    pub tag: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EnsureReadyResult {
    pub status: &'static str,
    pub reason: &'static str,
    pub runtime_online: bool,
    pub gateway_active: bool,
    pub blockbench_running: bool,
    pub plugin_integrity: &'static str,
    pub manual_plugin_approval_recommended: bool,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ManagedProgressEvent { pub schema: u8, pub kind: String, pub action: String, pub stage: String }

#[derive(Debug, Serialize)]
pub struct ConnectionStatus {
    pub schema: u8,
    pub observed_at_unix_ms: u64,
    pub blockbench_running: bool,
    pub runtime_listener_live: bool,
    pub gateway_active: Option<bool>,
    pub plugin_integrity: &'static str,
    pub project_revision: Option<String>,
    pub project_session_live: bool,
}

#[derive(Debug, Serialize)]
pub struct SystemStatus {
    pub schema: u8,
    pub product_state: &'static str,
    pub plugin_integrity: &'static str,
    pub observed_at_unix_ms: u64,
    pub readiness: ReadinessProjection,
    pub blockbench: BlockbenchState,
    pub gateway: GatewaySupervision,
    pub maintenance: MaintenanceAvailability,
    pub manager_available: bool,
    pub bootstrap_available: bool,
    pub runtime_listener_live: bool,
    pub runtime_endpoint_match: Option<bool>,
    pub runtime_build_match: Option<bool>,
    pub runtime_ready: bool,
    pub managed: Option<ManagedStatus>,
    pub project_navigation: ProjectNavigation,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InstalledOptions {
    plugin: PathBuf,
}

#[derive(Debug, Deserialize)]
struct InstalledState {
    source_sha: String,
    options: InstalledOptions,
    owned: HashMap<String, String>,
}

fn managed_root() -> Option<PathBuf> {
    env::var_os("LAZYDESIGNER_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("LazyDesigner").join("managed")))
}


fn normalize_navigation_profile_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

pub(crate) fn navigation_profile_id(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let digest = format!("{:x}", Sha256::digest(normalize_navigation_profile_path(path).as_bytes()));
    digest[..32].to_string()
}

fn valid_navigation_profile_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub(crate) fn managed_blockbench_user_data_dir() -> Option<PathBuf> {
    let root = managed_root()?;
    let bytes = fs::read(root.join("installed.json")).ok()?;
    let installed: InstalledState = serde_json::from_slice(&bytes).ok()?;
    let plugin = installed.options.plugin;
    if plugin.file_name().and_then(|name| name.to_str()) != Some("lazydesigner_mcp.js") {
        return None;
    }
    let plugins_dir = plugin.parent()?;
    if !plugins_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("plugins"))
        .unwrap_or(false)
    {
        return None;
    }
    let user_data = plugins_dir.parent()?.to_path_buf();
    if !user_data.is_absolute() {
        return None;
    }
    Some(user_data)
}

fn managed_navigation_profile_id() -> Option<String> {
    managed_blockbench_user_data_dir().map(|path| navigation_profile_id(&path))
}

// Read-only recovery does not select or launch a legacy manager/Runtime.
// Trust only the standard Blockbench profile when a valid existing
// LazyDesigner profile-specific navigation snapshot proves its identity.
pub(crate) fn project_navigation_profile_id() -> Option<String> {
    if let Some(profile) = managed_navigation_profile_id() {
        return Some(profile);
    }
    let default_user_data = PathBuf::from(env::var_os("APPDATA")?).join("Blockbench");
    if !default_user_data.is_absolute() {
        return None;
    }
    let profile = navigation_profile_id(&default_user_data);
    project_navigation::probe(false, Some(&profile)).0.map(|_| profile)
}

fn runtime_session_lease_path() -> Option<PathBuf> {
    let profile_id = managed_navigation_profile_id()?;
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("LazyDesigner").join("runtime-session").join(format!("{profile_id}.json")))
}

pub fn project_navigation_action(action: &str, id: &str) -> Result<ProjectNavigationActionResult, String> {
    let profile_id = project_navigation_profile_id();
    project_navigation::action(action, id, profile_id.as_deref())
}

pub fn project_navigation_path(id: &str) -> Result<ProjectPathResult, String> {
    let profile_id = project_navigation_profile_id();
    project_navigation::path(id, profile_id.as_deref())
}


// Editor file opening is independent of AI readiness. Only the discovered
// current Blockbench profile or a pinned managed profile may be used.
fn verify_model_profile_binding(expected_profile: Option<&str>, resolved: &Path) -> Result<(), String> {
    if let Some(expected) = expected_profile {
        if !valid_navigation_profile_id(expected) || navigation_profile_id(resolved) != expected {
            return Err("The selected model belongs to another Blockbench profile. Open the matching profile before continuing.".to_string());
        }
    }
    Ok(())
}

// The managed installation pins the editor profile even while Blockbench is running.
// A foreign running profile is never silently substituted for that binding.
fn select_bound_editor_profile(
    managed: Option<&Path>, discovered: &Path, editor_running: bool,
) -> Result<PathBuf, String> {
    if let Some(pinned) = managed {
        if editor_running && navigation_profile_id(pinned) != navigation_profile_id(discovered) {
            return Err("Blockbench is running with a different userData profile than the installed LazyDesigner plugin. Close that Blockbench instance or use the matching managed profile before continuing.".to_string());
        }
        Ok(pinned.to_path_buf())
    } else {
        Ok(discovered.to_path_buf())
    }
}

pub(crate) fn editor_profile_for_model(expected_snapshot_profile: Option<&str>) -> Result<PathBuf, String> {
    let discovered = blockbench_user_data_dir()?;
    let mut system = System::new_all();
    system.refresh_processes();
    let editor_running = system.processes().values().any(|process| {
        let name = process.name().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    });
    let managed = managed_blockbench_user_data_dir();
    let profile = select_bound_editor_profile(managed.as_deref(), &discovered, editor_running)?;
    verify_model_profile_binding(expected_snapshot_profile, &profile)?;
    Ok(profile)
}

fn blockbench_user_data_dir() -> Result<PathBuf, String> {
    let script = r#"
if (!$env:APPDATA) { exit 2 }
$defaultPath = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Blockbench'))
$processes = @(
  Get-CimInstance Win32_Process -Filter "Name='Blockbench.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      (Test-Path -LiteralPath $_.ExecutablePath -PathType Leaf) -and
      ((Get-Item -LiteralPath $_.ExecutablePath).VersionInfo.ProductName -eq 'Blockbench')
    }
)
$paths = @()
foreach ($process in $processes) {
  if (!$process.CommandLine) { exit 3 }
  $match = [regex]::Match([string]$process.CommandLine, '(?i)(?:^|\s)--userData\s+(?:"([^"]+)"|(\S+))')
  if ($match.Success) {
    $value = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    if (![IO.Path]::IsPathRooted($value)) { exit 4 }
    $paths += [IO.Path]::GetFullPath($value)
  } else {
    $paths += $defaultPath
  }
}
$distinct = @($paths | Sort-Object -Unique)
if ($distinct.Count -gt 1) { exit 5 }
if ($distinct.Count -eq 1) {
  [Console]::Out.WriteLine($distinct[0])
  exit 0
}
[Console]::Out.WriteLine($defaultPath)
"#;

    let output = run_output(
        Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]),
        Duration::from_secs(8),
        "Blockbench userData discovery",
    )?;

    if !output.status.success() {
        return Err(match output.status.code() {
            Some(3) => "Blockbench is running but its command line is unavailable; close Blockbench or run Desktop with sufficient access before first installation.".to_string(),
            Some(4) => "Blockbench --userData must be an absolute path for managed plugin installation.".to_string(),
            Some(5) => "Multiple running Blockbench processes use different userData profiles; close the extra Blockbench window before setup.".to_string(),
            _ => "Blockbench userData could not be resolved.".to_string(),
        });
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Err("Blockbench userData path is empty.".to_string());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("Blockbench userData path is not absolute.".to_string());
    }
    Ok(path)
}

fn blockbench_managed_plugin_path() -> Result<PathBuf, String> {
    Ok(blockbench_user_data_dir()?.join("plugins").join("lazydesigner_mcp.js"))
}

// Exact, read-only legacy plugin inspection. Never follow a symlink or infer
// that an existing file is safe to adopt, rename, delete or execute.
fn retired_plugin_in_profile(new_plugin: &Path) -> Result<Option<PathBuf>, String> {
    let retired = new_plugin.with_file_name("blockit_mcp.js");
    match fs::symlink_metadata(&retired) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect the older Blockbench plugin safely: {error}")),
        Ok(meta) if meta.file_type().is_file() => Ok(Some(retired)),
        Ok(_) => Err("The older Blockbench plugin path is not a regular file. No migration was attempted.".to_string()),
    }
}

pub fn retired_plugin_for_setup() -> Result<bool, String> {
    let new_plugin = blockbench_managed_plugin_path()?;
    Ok(retired_plugin_in_profile(&new_plugin)?.is_some())
}

pub fn show_retired_plugin_file() -> Result<PluginFileActionResult, String> {
    let new_plugin = blockbench_managed_plugin_path()?;
    let retired = retired_plugin_in_profile(&new_plugin)?
        .ok_or_else(|| "No older plugin file was found for the selected Blockbench profile.".to_string())?;
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&retired)
        .spawn()
        .map_err(|error| format!("Unable to show the older Blockbench plugin: {error}"))?;
    Ok(PluginFileActionResult { status: "SHOWN" })
}

fn installed_plugin_path(root: &Path) -> Result<PathBuf, String> {
    let bytes = fs::read(root.join("installed.json"))
        .map_err(|_| "LazyDesigner managed installation state is unavailable.".to_string())?;
    let installed: InstalledState = serde_json::from_slice(&bytes)
        .map_err(|_| "LazyDesigner installed.json is invalid.".to_string())?;
    let plugin = installed.options.plugin;
    if plugin.file_name().and_then(|name| name.to_str()) != Some("lazydesigner_mcp.js") {
        return Err("Managed plugin path has an unexpected filename.".to_string());
    }
    if !plugin.is_file() {
        return Err("Managed Blockbench plugin file is missing; use Repair installation.".to_string());
    }
    Ok(plugin)
}

fn managed_plugin_integrity(root: &Path) -> &'static str {
    let bytes = match fs::read(root.join("installed.json")) {
        Ok(bytes) => bytes,
        Err(_) => return "unknown",
    };
    let installed: InstalledState = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(_) => return "unknown",
    };
    let plugin = installed.options.plugin;
    if plugin.file_name().and_then(|name| name.to_str()) != Some("lazydesigner_mcp.js") {
        return "invalid";
    }
    if !plugin.is_file() {
        return "missing";
    }
    let expected = installed.owned.get(&plugin.to_string_lossy().to_string());
    let Some(expected) = expected else { return "unknown"; };
    let bytes = match fs::read(&plugin) {
        Ok(bytes) => bytes,
        Err(_) => return "unknown",
    };
    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(bytes));
    if &actual == expected { "ready" } else { "modified" }
}

pub fn show_plugin_file() -> Result<PluginFileActionResult, String> {
    let root = managed_root()
        .ok_or_else(|| "LOCALAPPDATA/LAZYDESIGNER_HOME is unavailable.".to_string())?;
    let plugin = installed_plugin_path(&root)?;
    Command::new("explorer.exe")
        .arg("/select,")
        .arg(&plugin)
        .spawn()
        .map_err(|error| format!("Unable to show the managed Blockbench plugin file: {error}"))?;
    Ok(PluginFileActionResult { status: "SHOWN" })
}

// The installed package manifest is the source of the expected Runtime
// build. A port or plugin filename alone is never sufficient. Check the
// package SHA and the installed plugin's owned digest before trusting it.
fn installed_build_identity(root: &Path) -> Option<String> {
    let installed: InstalledState = serde_json::from_slice(
        &fs::read(root.join("installed.json")).ok()?
    ).ok()?;
    if installed.source_sha.len() != 40 ||
        !installed.source_sha.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
        return None;
    }
    let manifest_path = root.join("versions").join(&installed.source_sha).join("lazydesigner-package.json");
    let metadata = fs::symlink_metadata(&manifest_path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 1_000_000 {
        return None;
    }
    let manifest: Value = serde_json::from_slice(&fs::read(manifest_path).ok()?).ok()?;
    if manifest.get("schema")?.as_u64()? != 1 ||
        manifest.get("repository")?.as_str()? != "MIVUBI-STD/M-LazyDesigner" ||
        manifest.get("source_sha")?.as_str()? != installed.source_sha {
        return None;
    }
    let build = manifest.get("build_identity")?.as_str()?;
    if !runtime_health::valid_build_identity(build) {
        return None;
    }
    let plugin_hash = manifest.get("files")?.as_array()?.iter()
        .find(|entry| entry.get("path").and_then(Value::as_str) == Some("lazydesigner_mcp.js"))?
        .get("sha256")?.as_str()?;
    let owned_hash = installed.owned.get(&installed.options.plugin.to_string_lossy().to_string())?;
    if plugin_hash != owned_hash || plugin_hash.len() != 64 ||
        !plugin_hash.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
        return None;
    }
    Some(build.to_owned())
}

fn manager_executable(root: &Path) -> Result<PathBuf, String> {
    let installed_path = root.join("installed.json");
    let bytes = fs::read(&installed_path)
        .map_err(|_| "LazyDesigner managed installation is not present yet.".to_string())?;
    let installed: InstalledState = serde_json::from_slice(&bytes)
        .map_err(|_| "LazyDesigner installed.json is invalid.".to_string())?;
    if installed.source_sha.len() != 40
        || !installed.source_sha.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err("LazyDesigner installed source identity is invalid.".to_string());
    }

    let executable = root
        .join("versions")
        .join(installed.source_sha)
        .join("lazydesigner.exe");
    if !executable.is_file() {
        return Err("LazyDesigner managed executable is missing.".to_string());
    }
    Ok(executable)
}

pub fn ensure_ready(app: &AppHandle) -> Result<EnsureReadyResult, String> {
    let initial = collect();
    if !initial.manager_available {
        return Err("LazyDesigner is not installed yet.".to_string());
    }

    let mut current = collect_connection_status();

    if current.plugin_integrity == "modified" || current.plugin_integrity == "invalid" {
        return Ok(EnsureReadyResult {
            status: "NEEDS_ATTENTION",
            reason: "PLUGIN_INTEGRITY",
            runtime_online: false,
            gateway_active: current.gateway_active.unwrap_or(false),
            blockbench_running: current.blockbench_running,
            plugin_integrity: current.plugin_integrity,
            manual_plugin_approval_recommended: false,
        });
    }

    if current.plugin_integrity == "missing" {
        if current.blockbench_running {
            return Ok(EnsureReadyResult {
                status: "NEEDS_ATTENTION",
                reason: "PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING",
                runtime_online: false,
                gateway_active: current.gateway_active.unwrap_or(false),
                blockbench_running: current.blockbench_running,
                plugin_integrity: current.plugin_integrity,
                manual_plugin_approval_recommended: false,
            });
        }

        let maintenance = readiness::maintenance(true, initial.managed.as_ref(), current.runtime_listener_live);
        if !maintenance.repair {
            return Ok(EnsureReadyResult {
                status: "NEEDS_ATTENTION",
                reason: "REPAIR_BLOCKED",
                runtime_online: false,
                gateway_active: current.gateway_active.unwrap_or(false),
                blockbench_running: current.blockbench_running,
                plugin_integrity: current.plugin_integrity,
                manual_plugin_approval_recommended: false,
            });
        }

        run_managed_action(app, "repair", None)?;
        current = collect_connection_status();
        if current.plugin_integrity != "ready" {
            return Ok(EnsureReadyResult {
                status: "NEEDS_ATTENTION",
                reason: "REPAIR_DID_NOT_RESTORE_PLUGIN",
                runtime_online: false,
                gateway_active: current.gateway_active.unwrap_or(false),
                blockbench_running: current.blockbench_running,
                plugin_integrity: current.plugin_integrity,
                manual_plugin_approval_recommended: false,
            });
        }
    }

    if current.blockbench_running {
        if editor_profile_for_model(None).is_err() {
            return Ok(EnsureReadyResult {
                status: "NEEDS_ATTENTION",
                reason: "BLOCKBENCH_PROFILE_MISMATCH",
                runtime_online: false,
                gateway_active: current.gateway_active.unwrap_or(false),
                blockbench_running: true,
                plugin_integrity: current.plugin_integrity,
                manual_plugin_approval_recommended: false,
            });
        }
    } else {
        blockbench::open()?;
    }

    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        current = collect_connection_status();

        if current.runtime_listener_live {
            let verified = collect();
            if verified.runtime_ready {
                let gateway_active = verified.managed.as_ref().map(|value| value.gateway_active).unwrap_or(false);
                return Ok(EnsureReadyResult {
                    status: if gateway_active { "READY" } else { "RUNTIME_READY" },
                    reason: if gateway_active { "CONNECTED" } else { "WAITING_FOR_MCP_CLIENT" },
                    runtime_online: true,
                    gateway_active,
                    blockbench_running: current.blockbench_running,
                    plugin_integrity: current.plugin_integrity,
                    manual_plugin_approval_recommended: false,
                });
            }
            if verified.runtime_endpoint_match == Some(false) {
                return Ok(EnsureReadyResult {
                    status: "NEEDS_ATTENTION",
                    reason: "RUNTIME_ENDPOINT_MISMATCH",
                    runtime_online: false,
                    gateway_active: current.gateway_active.unwrap_or(false),
                    blockbench_running: current.blockbench_running,
                    plugin_integrity: current.plugin_integrity,
                    manual_plugin_approval_recommended: false,
                });
            }
        }

        if !current.blockbench_running && started.elapsed() > Duration::from_secs(3) {
            return Ok(EnsureReadyResult {
                status: "NEEDS_ATTENTION",
                reason: "BLOCKBENCH_EXITED",
                runtime_online: false,
                gateway_active: current.gateway_active.unwrap_or(false),
                blockbench_running: false,
                plugin_integrity: current.plugin_integrity,
                manual_plugin_approval_recommended: false,
            });
        }

        std::thread::sleep(Duration::from_millis(750));
    }

    current = collect_connection_status();
    let probe_known = current.gateway_active.is_some();
    let likely_first_approval = probe_known
        && current.blockbench_running
        && current.plugin_integrity == "ready"
        && !current.runtime_listener_live
        && !current.project_session_live;

    Ok(EnsureReadyResult {
        status: if likely_first_approval { "APPROVAL_REQUIRED" } else { "NEEDS_ATTENTION" },
        reason: if !probe_known { "CONNECTION_PROBE_UNKNOWN" } else if likely_first_approval { "RUNTIME_TIMEOUT_WITH_HEALTHY_PLUGIN" } else if current.project_session_live { "RUNTIME_START_FAILED" } else { "RUNTIME_TIMEOUT" },
        runtime_online: false,
        gateway_active: current.gateway_active.unwrap_or(false),
        blockbench_running: current.blockbench_running,
        plugin_integrity: current.plugin_integrity,
        manual_plugin_approval_recommended: likely_first_approval,
    })
}

fn observed_at_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn installation_present(root: Option<&Path>, manager_available: bool) -> bool {
    // Unreadable existing metadata is a damaged installation, never first run.
    manager_available || root.is_some_and(|root| root.join("installed.json").try_exists().unwrap_or(true))
}

fn compose_status(
    blockbench: BlockbenchState,
    manager_available: bool,
    managed: Option<ManagedStatus>,
    diagnostic: Option<String>,
) -> SystemStatus {
    let installation_present = installation_present(managed_root().as_deref(), manager_available);
    let plugin_integrity = managed_root()
        .as_deref()
        .map(managed_plugin_integrity)
        .unwrap_or("unknown");
    let mut process_system = System::new();
    process_system.refresh_processes();
    let runtime_lease_path = runtime_session_lease_path();
    let runtime_profile_id = managed_navigation_profile_id();
    let runtime_session = runtime_health::probe(
        blockbench.running,
        &process_system,
        runtime_lease_path.as_deref(),
        runtime_profile_id.as_deref(),
    );
    let managed_runtime_url = managed.as_ref().map(|value| value.runtime_url.as_str());
    let expected_build = if manager_available {
        managed_root().as_deref().and_then(installed_build_identity)
    } else {
        None
    };
    let runtime_endpoint_match = runtime_health::endpoint_match(managed_runtime_url, &runtime_session);
    let runtime_build_match = runtime_health::matching_build_identity(
        expected_build.as_deref(), &runtime_session
    );
    let runtime_ready = runtime_health::ready(
        managed.as_ref().map(|value| value.runtime_online).unwrap_or(false),
        managed_runtime_url,
        expected_build.as_deref(),
        &runtime_session,
    );
    let gateway = if installation_present && managed.is_none() {
        readiness::unknown_gateway()
    } else {
        readiness::gateway(managed.as_ref(), blockbench.running, runtime_ready)
    };
    let readiness = readiness::readiness(
        installation_present,
        managed.as_ref(),
        blockbench.running,
        runtime_ready,
        &gateway,
        plugin_integrity,
    );
    let maintenance = readiness::maintenance(manager_available, managed.as_ref(), runtime_session.live);
    let navigation_profile_id = project_navigation_profile_id();
    let (_, project_session_live) = project_navigation::probe(
        blockbench.running && manager_available,
        navigation_profile_id.as_deref(),
    );
    let project_navigation = project_navigation::projection(
        project_session_live,
        navigation_profile_id.as_deref(),
    );
    let product_state = readiness::product_state(
        installation_present,
        managed.as_ref(),
        &blockbench,
        runtime_ready,
        &gateway,
        plugin_integrity,
    );

    SystemStatus {
        schema: 1,
        product_state,
        plugin_integrity,
        observed_at_unix_ms: observed_at_unix_ms(),
        readiness,
        blockbench,
        gateway,
        maintenance,
        manager_available,
        bootstrap_available: false,
        // Keep full and lightweight status semantics identical so a build
        // mismatch does not trigger an expensive full refresh every heartbeat.
        runtime_listener_live: runtime_session.live && runtime_build_match == Some(true),
        runtime_endpoint_match,
        runtime_build_match,
        runtime_ready,
        managed,
        project_navigation,
        diagnostic,
    }
}

fn gateway_active_fast(root: &Path, system: &System) -> Option<bool> {
    let leases = root.join("leases");
    let entries = match fs::read_dir(&leases) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(false),
        Err(_) => return None,
    };

    for entry in entries {
        let entry = entry.ok()?;
        if !entry.file_type().ok()?.is_file() {
            return None;
        }
        let name = entry.file_name();
        let name = name.to_str()?;
        let pid = name.strip_suffix(".json")?.parse::<u32>().ok()?;
        if system.process(Pid::from_u32(pid)).is_some() {
            return Some(true);
        }
    }
    Some(false)
}

pub fn collect_connection_status() -> ConnectionStatus {
    // Only process identity is needed by the passive status watcher;
    // avoid populating every system table on each observation.
    let mut system = System::new();
    system.refresh_processes();
    let blockbench_running = system.processes().values().any(|process| {
        let name = process.name().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    });

    let navigation_profile_id = project_navigation_profile_id();
    let manager_known = managed_root()
        .as_deref()
        .is_some_and(|root| manager_executable(root).is_ok());
    let (project_revision, project_session_live) = project_navigation::probe(
        blockbench_running && manager_known,
        navigation_profile_id.as_deref(),
    );
    let runtime_lease_path = runtime_session_lease_path();
    let runtime_profile_id = managed_navigation_profile_id();
    let runtime_session = runtime_health::probe(
        blockbench_running,
        &system,
        runtime_lease_path.as_deref(),
        runtime_profile_id.as_deref(),
    );
    // Fast watcher notices a build swap without invoking the manager CLI.
    // A stale/foreign Runtime lease must not make the connection appear ready.
    let expected_build = managed_root().as_deref().and_then(installed_build_identity);
    let trusted_listener = runtime_session.live &&
        runtime_health::matching_build_identity(
            expected_build.as_deref(), &runtime_session
        ) == Some(true);

    let Some(root) = managed_root() else {
        return ConnectionStatus {
            schema: 1,
            observed_at_unix_ms: observed_at_unix_ms(),
            blockbench_running,
            runtime_listener_live: trusted_listener,
            gateway_active: None,
            plugin_integrity: "unknown",
            project_revision: project_revision.clone(),
            project_session_live,
        };
    };

    let plugin_integrity = managed_plugin_integrity(&root);
    if manager_executable(&root).is_err() {
        return ConnectionStatus {
            schema: 1,
            observed_at_unix_ms: observed_at_unix_ms(),
            blockbench_running,
            runtime_listener_live: trusted_listener,
            gateway_active: None,
            plugin_integrity,
            project_revision: project_revision.clone(),
            project_session_live,
        };
    }

    ConnectionStatus {
        schema: 1,
        observed_at_unix_ms: observed_at_unix_ms(),
        blockbench_running,
        runtime_listener_live: trusted_listener,
        gateway_active: gateway_active_fast(&root, &system),
        plugin_integrity,
        project_revision: project_revision.clone(),
        project_session_live,
    }
}

pub fn collect() -> SystemStatus {
    let blockbench = blockbench::detect();
    let Some(root) = managed_root() else {
        return compose_status(
            blockbench,
            false,
            None,
            Some("LOCALAPPDATA/LAZYDESIGNER_HOME is unavailable.".to_string()),
        );
    };

    let executable = match manager_executable(&root) {
        Ok(path) => path,
        Err(message) => return compose_status(blockbench, false, None, Some(message)),
    };

    let output = match run_output(
        Command::new(&executable)
            .arg("status")
            .arg("--root")
            .arg(&root),
        Duration::from_secs(5),
        "Managed status",
    ) {
        Ok(output) => output,
        Err(error) => {
            return compose_status(
                blockbench,
                true,
                None,
                Some(format!("Unable to read managed status: {error}")),
            )
        }
    };

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).lines().filter(|line| serde_json::from_str::<ManagedProgressEvent>(line).is_err()).collect::<Vec<_>>().join("\n").trim().to_string();
        return compose_status(
            blockbench,
            true,
            None,
            Some(if error.is_empty() {
                "Managed status command failed.".to_string()
            } else {
                error
            }),
        );
    }

    match serde_json::from_slice::<ManagedStatus>(&output.stdout) {
        Ok(managed) if managed.schema == 1 => compose_status(blockbench, true, Some(managed), None),
        Ok(_) | Err(_) => compose_status(
            blockbench,
            true,
            None,
            Some("Managed status returned invalid JSON or an unsupported schema.".to_string()),
        ),
    }
}


pub fn bootstrap_resource(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manager = app
        .path()
        .resolve("resources/managed/lazydesigner.exe", BaseDirectory::Resource)
        .map_err(|error| format!("Unable to resolve LazyDesigner bootstrap resource: {error}"))?;
    if !manager.is_file() {
        return Err("LazyDesigner installer does not contain a managed bootstrap package.".to_string());
    }
    let package = manager
        .parent()
        .ok_or_else(|| "LazyDesigner bootstrap package path is invalid.".to_string())?;
    if !package.join("lazydesigner-package.json").is_file() {
        return Err("LazyDesigner bootstrap package manifest is missing.".to_string());
    }
    Ok(manager)
}

pub fn bootstrap_available(app: &tauri::AppHandle) -> bool {
    bootstrap_resource(app).is_ok()
}

pub fn bootstrap_install(app: &tauri::AppHandle) -> Result<BootstrapActionResult, String> {
    if managed_root()
        .and_then(|root| manager_executable(&root).ok())
        .is_some()
    {
        return Err("LazyDesigner is already installed; use Update or Repair instead.".to_string());
    }

    let manager = bootstrap_resource(app)?;
    let package = manager
        .parent()
        .ok_or_else(|| "LazyDesigner bootstrap package path is invalid.".to_string())?;
    let root = managed_root()
        .ok_or_else(|| "LOCALAPPDATA/LAZYDESIGNER_HOME is unavailable.".to_string())?;
    let plugin = blockbench_managed_plugin_path()?;

    let output = run_output(
        Command::new(&manager)
            .arg("install")
            .arg("--root")
            .arg(&root)
            .arg("--package")
            .arg(package)
            .arg("--plugin-path")
            .arg(&plugin),
        Duration::from_secs(300),
        "LazyDesigner bootstrap installation",
    )?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).lines().filter(|line| serde_json::from_str::<ManagedProgressEvent>(line).is_err()).collect::<Vec<_>>().join("\n").trim().to_string();
        return Err(if error.is_empty() {
            "LazyDesigner bootstrap installation failed.".to_string()
        } else {
            error
        });
    }

    let receipt = serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|_| "LazyDesigner bootstrap returned invalid JSON.".to_string())?;
    match receipt.get("status").and_then(Value::as_str) {
        Some("STAGED") => {}
        Some("INSTALLED") if receipt.get("source_sha").and_then(Value::as_str)
            .is_some_and(|sha| sha.len() == 40 &&
                sha.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())) => {}
        _ => return Err("LazyDesigner bootstrap returned an unverified installation receipt.".to_string()),
    }
    Ok(BootstrapActionResult {
        action: "install",
        receipt,
    })
}

pub fn check_managed_update() -> Result<ManagedUpdateCheck, String> {
    let root = managed_root()
        .ok_or_else(|| "LOCALAPPDATA/LAZYDESIGNER_HOME is unavailable.".to_string())?;
    let executable = manager_executable(&root)?;
    let output = run_output(
        Command::new(&executable)
            .arg("check-update")
            .arg("--root")
            .arg(&root),
        Duration::from_secs(12),
        "Managed update check",
    )?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "Managed update check failed.".to_string()
        } else {
            error
        });
    }

    let result = serde_json::from_slice::<ManagedUpdateCheck>(&output.stdout)
        .map_err(|_| "Managed update check returned invalid JSON.".to_string())?;
    if !matches!(
        result.status.as_str(),
        "NOT_INSTALLED" | "UP_TO_DATE" | "UPDATE_AVAILABLE" | "UPDATE_STAGED" | "UPDATE_STAGED_UNVERIFIED"
    ) {
        return Err("Managed update check returned an unsupported status.".to_string());
    }
    for sha in [
        result.installed_source_sha.as_deref(),
        result.available_source_sha.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if sha.len() != 40 || !sha.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Err("Managed update check returned an invalid source identity.".to_string());
        }
    }
    if let Some(tag) = result.tag.as_deref() {
        let valid = tag
            .strip_prefix("lazydesigner-v")
            .map(|version| {
                !version.is_empty()
                    && version
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' ))
            })
            .unwrap_or(false);
        if !valid {
            return Err("Managed update check returned an invalid release tag.".to_string());
        }
    }
    Ok(result)
}

pub fn run_managed_action(app: &AppHandle, action: &str, expected_source_sha: Option<&str>) -> Result<ManagedActionResult, String> {
    if !matches!(action, "update" | "rollback" | "recover" | "repair" | "setup-tls") {
        return Err("Unsupported LazyDesigner desktop action.".to_string());
    }

    let root = managed_root()
        .ok_or_else(|| "LOCALAPPDATA/LAZYDESIGNER_HOME is unavailable.".to_string())?;
    let executable = manager_executable(&root)?;

    let timeout = match action {
        "setup-tls" => Duration::from_secs(60),
        "update" | "rollback" | "recover" | "repair" => Duration::from_secs(300),
        _ => Duration::from_secs(60),
    };
    // Desktop updates must name the exact source the user chose; a published
    // release change between discovery and download must never switch targets.
    if action == "update" && !expected_source_sha.is_some_and(|sha| {
        sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    }) {
        return Err("A verified selected update source is required.".to_string());
    }
    if action != "update" && expected_source_sha.is_some() {
        return Err("Update source identity is only valid for updates.".to_string());
    }
    let mut command = Command::new(&executable);
    command.arg(action).arg("--root").arg(&root).arg("--progress-json");
    if let Some(sha) = expected_source_sha {
        command.arg("--expected-source-sha").arg(sha);
    }
    let output = run_output_with_stderr_lines(
        &mut command,
        timeout,
        &format!("Managed {action}"),
        |line| {
            if let Ok(event) = serde_json::from_str::<ManagedProgressEvent>(line) {
                if event.schema == 1 && event.kind == "progress" && event.action == action { let _ = app.emit("managed-progress", event); }
            }
        },
    )?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).lines().filter(|line| serde_json::from_str::<ManagedProgressEvent>(line).is_err()).collect::<Vec<_>>().join("\n").trim().to_string();
        return Err(if error.is_empty() {
            format!("Managed {action} failed.")
        } else {
            error
        });
    }

    let receipt = serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|_| format!("Managed {action} returned invalid JSON."))?;

    Ok(ManagedActionResult {
        action: action.to_string(),
        receipt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

}
