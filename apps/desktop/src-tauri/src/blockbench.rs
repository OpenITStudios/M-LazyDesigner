use crate::process::run_output;
use serde::{Deserialize, Serialize};
use rfd::FileDialog;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use sysinfo::System;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockbenchCompatibilityManifest {
    minimum_version: String,
    review_boundary_version: String,
    source_type_baseline: String,
    live_validated_builds: Vec<ValidatedBlockbenchBuild>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidatedBlockbenchBuild {
    version: String,
    build_identity: String,
}

fn matches_live_validated_build(
    version: &str,
    build_identity: Option<&str>,
    entries: &[ValidatedBlockbenchBuild],
) -> bool {
    let Some(build) = build_identity.filter(|value| {
        value.len() == 71 && value.starts_with("sha256:") &&
        value[7..].bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }) else {
        return false;
    };
    entries.iter().any(|entry|
        entry.version == version && entry.build_identity == build
    )
}

#[derive(Debug, Serialize)]
pub struct BlockbenchCompatibility {
    pub status: String,
    pub minimum_version: String,
    pub review_boundary_version: String,
    pub source_type_baseline: String,
    pub live_validated: bool,
}

#[derive(Debug, Serialize)]
pub struct BlockbenchState {
    pub running: bool,
    pub version: Option<String>,
    pub compatibility: Option<BlockbenchCompatibility>,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BlockbenchActionResult {
    pub status: &'static str,
}

#[derive(Debug, Deserialize, Serialize)]
struct SelectedBlockbenchExecutable {
    schema: u8,
    executable: PathBuf,
}

// The published versioned *_portable.exe is a self-extracting launcher, not
// the stable child Blockbench.exe. Its process path can change on each launch;
// accepting it as a pinned executable would create false profile/exe affinity.
fn is_versioned_portable_launcher(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|item| item.to_str()) else {
        return false;
    };
    let lower = name.to_ascii_lowercase();
    let Some(core) = lower.strip_prefix("blockbench_")
        .and_then(|item| item.strip_suffix("_portable.exe")) else {
        return false;
    };
    parse_version(core).is_some()
}

fn selected_executable_path() -> Result<PathBuf, String> {
    let local = env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "LOCALAPPDATA is unavailable for Blockbench selection.".to_string())?;
    Ok(PathBuf::from(local).join("LazyDesigner").join("blockbench-executable.json"))
}

fn parse_selected_executable(bytes: &[u8]) -> Result<PathBuf, String> {
    let selected: SelectedBlockbenchExecutable = serde_json::from_slice(bytes)
        .map_err(|_| "Saved Blockbench executable selection is invalid. Choose Blockbench again in Support.".to_string())?;
    if selected.schema != 1 || !selected.executable.is_absolute() || !is_executable_name(&selected.executable) {
        return Err("Saved Blockbench executable selection is invalid. Choose Blockbench again in Support.".to_string());
    }
    Ok(selected.executable)
}

fn selected_executable() -> Result<Option<PathBuf>, String> {
    let bytes = crate::metadata_io::read_metadata_bounded(&selected_executable_path()?)
        .map_err(|_| "Saved Blockbench selection could not be read safely. Choose Blockbench again in Support.".to_string())?;
    bytes.map(|raw| parse_selected_executable(&raw)).transpose()
}

/// User-controlled recovery for portable, moved, or multiple Blockbench installations.
/// Does not change a Blockbench profile, managed package or any model file.
pub(crate) fn choose_executable() -> Result<BlockbenchActionResult, String> {
    let system = crate::process::process_snapshot();
    if system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    }) {
        return Err("Save your models and close Blockbench before choosing another editor installation.".to_string());
    }
    let Some(executable) = FileDialog::new()
        .add_filter("Blockbench executable", &["exe"])
        .pick_file() else {
        return Ok(BlockbenchActionResult { status: "CANCELLED" });
    };
    if is_versioned_portable_launcher(&executable) {
        return Err("The Blockbench *_portable.exe launcher extracts a separate editor process. LazyDesigner cannot reliably bind that changing executable path to the managed plugin yet. Select the installed Blockbench.exe instead; no files were changed.".to_string());
    }
    if !executable.is_absolute() || !is_executable_name(&executable)
        || !fs::symlink_metadata(&executable).is_ok_and(|meta| meta.file_type().is_file())
    {
        return Err("Choose a regular Blockbench.exe file, not a link or another application.".to_string());
    }
    version(&executable)?; // Windows product metadata must identify Blockbench.
    let selection_path = selected_executable_path()?;
    let parent = selection_path.parent()
        .ok_or_else(|| "Blockbench selection directory is invalid.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create Blockbench selection directory: {error}"))?;
    let before = crate::metadata_io::read_metadata_bounded(&selection_path)
        .map_err(|error| format!("Cannot safely read previous Blockbench selection: {error}"))?;
    let bytes = serde_json::to_vec(&SelectedBlockbenchExecutable { schema: 1, executable })
        .map_err(|_| "Cannot encode Blockbench selection.".to_string())?;
    crate::metadata_io::replace_metadata_if_unchanged(
        &selection_path, &bytes, before.as_deref(), true,
    ).map_err(|error| format!("Cannot save Blockbench selection: {error}"))?;
    Ok(BlockbenchActionResult { status: "SELECTED" })
}

/// Outcome of an explicit user-requested editor-window focus attempt.
/// Never treat opening a process or issuing a Win32 request as verified foreground focus.
#[derive(Debug, Serialize)]
pub struct BlockbenchFocusResult {
    pub status: &'static str,
}

fn compatibility_manifest() -> Result<BlockbenchCompatibilityManifest, String> {
    serde_json::from_str(include_str!("../../../../mcp/compatibility/blockbench.json"))
        .map_err(|_| "LazyDesigner Blockbench compatibility manifest is invalid.".to_string())
}

pub(crate) fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let core = value.trim().trim_start_matches('v').split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn evaluate_compatibility_for_build(
    version: &str,
    runtime_build_identity: Option<&str>,
) -> Result<BlockbenchCompatibility, String> {
    let manifest = compatibility_manifest()?;
    let parsed = parse_version(version);
    let minimum = parse_version(&manifest.minimum_version)
        .ok_or_else(|| "Invalid minimum Blockbench compatibility version.".to_string())?;
    let review = parse_version(&manifest.review_boundary_version)
        .ok_or_else(|| "Invalid Blockbench review boundary version.".to_string())?;
    let live_validated = matches_live_validated_build(
        version, runtime_build_identity, &manifest.live_validated_builds,
    );

    let status = match parsed {
        None => "invalid",
        Some(current) if current < minimum => "unsupported",
        Some(_) if live_validated => "validated",
        Some(current) if current >= review => "review-required",
        Some(_) => "compatible-unverified",
    };

    Ok(BlockbenchCompatibility {
        status: status.to_string(),
        minimum_version: manifest.minimum_version,
        review_boundary_version: manifest.review_boundary_version,
        source_type_baseline: manifest.source_type_baseline,
        live_validated,
    })
}

// Version discovery is available even while Blockbench is closed. Without a
// verified native Runtime identity Desktop must report compatible-unverified.
pub(crate) fn evaluate_compatibility(version: &str) -> Result<BlockbenchCompatibility, String> {
    evaluate_compatibility_for_build(version, None)
}

// A running process is authoritative only when its executable is known.
// Multiple editor installations must be resolved by the user, never by process order.
fn select_running_executable(paths: &[PathBuf]) -> Result<Option<PathBuf>, String> {
    let mut unique: Vec<&PathBuf> = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
        if !unique.iter().any(|existing|
            existing.to_string_lossy().replace('/', "\\").to_ascii_lowercase() == key
        ) {
            unique.push(path);
        }
    }
    match unique.as_slice() {
        [] => Ok(None),
        [path] => Ok(Some((**path).clone())),
        _ => Err("Multiple Blockbench installations are running. Close the other installation before opening a model.".to_string()),
    }
}

fn discover_executable(system: &System) -> Result<Option<PathBuf>, String> {
    let running: Vec<_> = system.processes().values().filter(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    }).collect();
    if !running.is_empty() {
        let paths: Result<Vec<PathBuf>, String> = running.iter().map(|process| {
            let path = process.exe().ok_or_else(||
                "A running Blockbench executable path is unavailable; close it before selecting another installation.".to_string()
            )?;
            if !path.is_file() || !is_executable_name(path) {
                return Err("A running Blockbench executable could not be verified.".to_string());
            }
            Ok(path.to_path_buf())
        }).collect();
        let running_editor = select_running_executable(&paths?)?;
        if let (Some(active), Some(pinned)) = (running_editor.as_ref(), selected_executable()?) {
            if active.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
                != pinned.to_string_lossy().replace('/', "\\").to_ascii_lowercase()
            {
                return Err("Running Blockbench executable differs from the selected installation. Close it or reselect the correct Blockbench.exe in Support.".to_string());
            }
        }
        return Ok(running_editor);
    }

    if let Some(pinned) = selected_executable()? {
        if !pinned.is_file() {
            return Err("Selected Blockbench installation has moved or was removed. Choose the new Blockbench.exe in Support.".to_string());
        }
        return Ok(Some(pinned));
    }

    let script = r#"
$roots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$candidates = @()
foreach ($root in $roots) {
  foreach ($entry in @(Get-ItemProperty -Path $root -ErrorAction SilentlyContinue)) {
    if ($entry.DisplayName -ne 'Blockbench') { continue }
    if ($entry.InstallLocation) { $candidates += (Join-Path $entry.InstallLocation 'Blockbench.exe') }
    if ($entry.DisplayIcon) {
      $icon = [string]$entry.DisplayIcon
      if ($icon.StartsWith('"')) {
        $closing = $icon.IndexOf('"', 1)
        if ($closing -gt 1) { $icon = $icon.Substring(1, $closing - 1) }
      } else {
        $icon = ($icon -split ',')[0].Trim()
      }
      if ($icon) { $candidates += $icon }
    }
  }
}
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Blockbench\Blockbench.exe') }
if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Blockbench\Blockbench.exe') }
$verified = @()
foreach ($candidate in $candidates) {
  if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and
      ((Get-Item -LiteralPath $candidate).VersionInfo.ProductName -eq 'Blockbench')) {
    $verified += (Resolve-Path -LiteralPath $candidate).Path
  }
}
$unique = @($verified | Sort-Object -Unique)
if ($unique.Count -gt 1) { exit 6 }
if ($unique.Count -eq 1) { [Console]::Out.WriteLine($unique[0]) }
exit 0
"#;
    let output = run_output(
        Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]),
        Duration::from_secs(8),
        "Blockbench installation discovery",
    )?;

    if !output.status.success() {
        return Err(if output.status.code() == Some(6) {
            "Multiple Blockbench installations were found. Close all Blockbench windows and resolve the installation conflict before continuing.".to_string()
        } else {
            "Blockbench registry discovery failed.".to_string()
        });
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return Ok(None);
    }

    let executable = PathBuf::from(path);
    if !executable.is_file() || !is_executable_name(&executable) {
        return Err("Blockbench registry entry does not point to an executable file.".to_string());
    }
    Ok(Some(executable))
}

pub(crate) fn is_executable_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("Blockbench.exe"))
        .unwrap_or(false)
}

fn normalize_product_version(value: &str) -> String {
    // Windows PE metadata adds a revision; compatibility uses the editor release.
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|part| part.parse::<u64>().is_ok()) {
        parts[..3].join(".")
    } else {
        value.to_string()
    }
}

fn version(executable: &Path) -> Result<String, String> {
    if !is_executable_name(executable) {
        return Err("Discovered Blockbench path does not end in Blockbench.exe.".to_string());
    }

    let script = r#"
$info = (Get-Item -LiteralPath $env:LAZYDESIGNER_BLOCKBENCH_EXE).VersionInfo
if ($info.ProductName -ne 'Blockbench') { exit 2 }
[Console]::Out.WriteLine($info.ProductVersion)
"#;
    let output = run_output(
        Command::new("powershell.exe")
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script])
            .env("LAZYDESIGNER_BLOCKBENCH_EXE", executable),
        Duration::from_secs(8),
        "Blockbench version inspection",
    )?;

    if !output.status.success() {
        return Err("Blockbench version inspection failed.".to_string());
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let version = normalize_product_version(raw.split_whitespace().next().unwrap_or(""));
    if version.is_empty() {
        return Err("Blockbench version information is empty.".to_string());
    }
    Ok(version)
}

pub(crate) fn detect() -> BlockbenchState {
    let system = crate::process::process_snapshot();
    let running = system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    });

    let executable = match discover_executable(&system) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return BlockbenchState {
                running,
                version: None,
                compatibility: None,
                diagnostic: if running {
                    Some("Blockbench is running, but its executable path is unavailable.".to_string())
                } else {
                    Some("Blockbench desktop installation was not found.".to_string())
                },
            }
        }
        Err(message) => {
            return BlockbenchState {
                running,
                version: None,
                compatibility: None,
                diagnostic: Some(message),
            }
        }
    };

    let version = match version(&executable) {
        Ok(version) => version,
        Err(message) => {
            return BlockbenchState {
                running,
                version: None,
                compatibility: None,
                diagnostic: Some(message),
            }
        }
    };

    match evaluate_compatibility(&version) {
        Ok(compatibility) => BlockbenchState {
            running,
            version: Some(version),
            compatibility: Some(compatibility),
            diagnostic: None,
        },
        Err(message) => BlockbenchState {
            running,
            version: Some(version),
            compatibility: None,
            diagnostic: Some(message),
        },
    }
}

// GUI children do not inherit Desktop's console handles. All file/editor
// launches use a resolved exact Blockbench userData profile; they do not
// require an AI listener, plugin approval, Gateway or managed Runtime.
fn launch_command_for_profile(executable: &Path, user_data: &Path) -> Result<Command, String> {
    if !user_data.is_absolute() {
        return Err("Blockbench userData profile must be absolute.".to_string());
    }
    let mut command = Command::new(executable);
    command.arg("--userData").arg(user_data)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    Ok(command)
}

fn is_bbmodel_file(path: &Path) -> bool {
    path.is_absolute()
        && path.extension().and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("bbmodel"))
        && path.is_file()
}

pub(crate) fn open_model(path: &Path, user_data: &Path) -> Result<&'static str, String> {
    if !is_bbmodel_file(path) {
        return Err("Choose an existing .bbmodel file.".to_string());
    }
    let system = crate::process::process_snapshot();
    let executable = discover_executable(&system)?
        .ok_or_else(|| "Blockbench desktop installation was not found.".to_string())?;
    version(&executable)?;
    let started_at = crate::model_open_proof::timestamp_before_launch();
    launch_command_for_profile(&executable, user_data)?
        .arg(path)
        .spawn()
        .map_err(|error| format!("Unable to open the model in Blockbench: {error}"))?;
    Ok(crate::model_open_proof::launch_receipt(path, user_data, &executable, started_at))
}

#[derive(Debug, Serialize)]
pub(crate) struct ModelBrowseResult {
    pub status: &'static str,
}

pub(crate) fn browse_model() -> Result<ModelBrowseResult, String> {
    // The native picker is user intent, not a scan of managed workspaces.
    let Some(path) = FileDialog::new()
        .add_filter("Blockbench model", &["bbmodel"])
        .pick_file() else {
        return Ok(ModelBrowseResult { status: "CANCELLED" });
    };
    // Resolve the editor profile after selection; a different running
    // userData profile cannot silently inherit a stale manager profile.
    let user_data = crate::system_status::editor_profile_for_model(None)?;
    let status = open_model(&path, &user_data)?;
    Ok(ModelBrowseResult { status })
}

pub(crate) fn open_editor() -> Result<BlockbenchActionResult, String> {
    let user_data = crate::system_status::editor_profile_for_model(None)?;
    let system = crate::process::process_snapshot();
    let already_running = system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    });
    let executable = discover_executable(&system)?
        .ok_or_else(|| "Blockbench desktop installation was not found.".to_string())?;
    version(&executable)?;
    if already_running {
        return Ok(BlockbenchActionResult { status: "ALREADY_RUNNING" });
    }
    launch_command_for_profile(&executable, &user_data)?
        .spawn()
        .map_err(|error| format!("Unable to open Blockbench: {error}"))?;
    Ok(BlockbenchActionResult { status: "STARTED" })
}

pub(crate) fn open() -> Result<BlockbenchActionResult, String> {
    // AI readiness has an installed managed profile; it uses the same
    // profile-aware editor launch as the regular Open action.
    if crate::system_status::managed_blockbench_user_data_dir().is_none() {
        return Err("Managed Blockbench profile is unavailable.".to_string());
    }
    open_editor()
}


#[cfg(windows)]
mod window_focus {
    use std::{collections::HashSet, ffi::c_void};

    type Hwnd = *mut c_void;
    const GW_OWNER: u32 = 4;
    const SW_RESTORE: i32 = 9;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>, param: isize) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process_id: *mut u32) -> u32;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn GetWindow(window: Hwnd, command: u32) -> Hwnd;
        fn GetWindowTextLengthW(window: Hwnd) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn ShowWindowAsync(window: Hwnd, command: i32) -> i32;
        fn SetForegroundWindow(window: Hwnd) -> i32;
    }

    struct Candidates<'a> {
        allowed_pids: &'a HashSet<u32>,
        windows: Vec<Hwnd>,
    }

    unsafe extern "system" fn collect_window(window: Hwnd, parameter: isize) -> i32 {
        let candidates = &mut *(parameter as *mut Candidates<'_>);
        // Only visible, unowned top-level windows with a title can be candidates.
        // Do not search by window title: another application can use the same title.
        if IsWindowVisible(window) == 0
            || !GetWindow(window, GW_OWNER).is_null()
            || GetWindowTextLengthW(window) <= 0
        {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, &mut pid);
        if candidates.allowed_pids.contains(&pid) {
            candidates.windows.push(window);
        }
        1
    }

    // The same selection function is used by production and regression tests.
    fn unique_target<T: Copy>(windows: &[T]) -> Result<T, &'static str> {
        match windows {
            [] => Err("NO_WINDOW"),
            [window] => Ok(*window),
            _ => Err("AMBIGUOUS"),
        }
    }

    pub(super) fn focus(allowed_pids: &HashSet<u32>) -> &'static str {
        let mut candidates = Candidates { allowed_pids, windows: Vec::new() };
        let listed = unsafe { EnumWindows(Some(collect_window), &mut candidates as *mut _ as isize) };
        if listed == 0 {
            return "UNKNOWN";
        }
        // Multiple Blockbench windows/profiles must not be guessed from ordering.
        let target = match unique_target(&candidates.windows) {
            Ok(window) => window,
            Err(reason) => return reason,
        };
        unsafe {
            if GetForegroundWindow() == target {
                return "FOCUSED";
            }
            let _ = ShowWindowAsync(target, SW_RESTORE);
            let _ = SetForegroundWindow(target);
            if GetForegroundWindow() == target { "FOCUSED" } else { "DENIED" }
        }
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn window_choice_must_be_unambiguous() {
            assert_eq!(super::unique_target::<usize>(&[]), Err("NO_WINDOW"));
            assert_eq!(super::unique_target(&[11usize]), Ok(11));
            assert_eq!(super::unique_target(&[11usize, 12]), Err("AMBIGUOUS"));
        }
    }
}

/// Best-effort, explicit window focus; does not start a new Blockbench process.
/// The caller must handle non-FOCUSED outcomes without claiming a foreground switch.
pub(crate) fn focus_window() -> BlockbenchFocusResult {
    #[cfg(windows)]
    {
        use std::collections::HashSet;
        let system = crate::process::process_snapshot();
        let allowed: HashSet<u32> = system.processes().iter()
            .filter(|(_, process)| {
                let name = process.name().to_string_lossy().to_ascii_lowercase();
                (name == "blockbench.exe" || name == "blockbench")
                    && process.exe().is_some_and(|path| path.is_file() && is_executable_name(path))
            })
            .map(|(pid, _)| pid.as_u32())
            .collect();
        return BlockbenchFocusResult {
            status: if allowed.is_empty() { "NOT_RUNNING" } else { window_focus::focus(&allowed) },
        };
    }
    #[cfg(not(windows))]
    {
        BlockbenchFocusResult { status: "UNSUPPORTED" }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_refresh_retains_current_native_process_identity() {
        let system = crate::process::process_snapshot();
        let process = system.process(sysinfo::Pid::from_u32(std::process::id()))
            .expect("current process must be discoverable");
        let executable = std::env::current_exe().unwrap();
        assert_eq!(process.name(), executable.file_name().unwrap());
        assert_eq!(process.exe(), Some(executable.as_path()));
    }


    #[test]
    fn editor_file_open_accepts_only_existing_bbmodel_files() {
        let root = std::env::temp_dir().join(format!("lazydesigner-open-model-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&root);
        let model = root.join("model.bbmodel");
        let other = root.join("model.txt");
        std::fs::write(&model, b"model").unwrap();
        std::fs::write(&other, b"other").unwrap();
        assert!(is_bbmodel_file(&model));
        assert!(!is_bbmodel_file(&other));
        assert!(!is_bbmodel_file(&root.join("missing.bbmodel")));
        std::fs::remove_file(model).unwrap();
        std::fs::remove_file(other).unwrap();
        let _ = std::fs::remove_dir(root);
    }

    #[test]
    fn historical_editor_version_does_not_validate_current_bundle() {
        let result = evaluate_compatibility("5.2.0").unwrap();
        assert_eq!(result.status, "compatible-unverified");
        assert!(!result.live_validated);
        assert_eq!(evaluate_compatibility("5.2.2").unwrap().status, "compatible-unverified");
    }

    #[test]
    fn native_bundle_validation_needs_both_exact_version_and_build() {
        let build = format!("sha256:{}", "a".repeat(64));
        let entries = vec![ValidatedBlockbenchBuild {
            version: "5.2.2".to_string(), build_identity: build.clone(),
        }];
        assert!(matches_live_validated_build("5.2.2", Some(&build), &entries));
        assert!(!matches_live_validated_build("5.2.0", Some(&build), &entries));
        assert!(!matches_live_validated_build("5.2.2", None, &entries));
        assert!(!matches_live_validated_build("5.2.2", Some("source"), &entries));
    }

    #[test]
    fn canonical_manifest_requires_review_at_next_family_boundary() {
        let result = evaluate_compatibility("5.3.0").unwrap();
        assert_eq!(result.status, "review-required");
    }

    #[test]
    fn selection_metadata_rejects_invalid_editor_identity() {
        let executable = std::env::temp_dir().join("Blockbench.exe");
        let good = serde_json::to_vec(&SelectedBlockbenchExecutable {
            schema: 1, executable: executable.clone(),
        }).unwrap();
        assert_eq!(parse_selected_executable(&good).unwrap(), executable);
        let invalid = serde_json::json!({"schema":2,"executable":executable});
        assert!(parse_selected_executable(invalid.to_string().as_bytes()).is_err());
        assert!(parse_selected_executable(b"{not-json").is_err());
    }

    #[test]
    fn running_executable_choice_rejects_ambiguity_without_guessing() {
        assert!(select_running_executable(&[]).unwrap().is_none());
        let one = PathBuf::from("C:/Apps/Blockbench.exe");
        let same = PathBuf::from("c:\\apps\\blockbench.exe");
        assert_eq!(select_running_executable(&[one.clone(), same]).unwrap(), Some(one.clone()));
        assert!(select_running_executable(&[one, PathBuf::from("D:/Portable/Blockbench.exe")]).is_err());
    }

    #[test]
    fn self_extracting_portable_wrapper_is_not_mistaken_for_the_editor() {
        assert!(is_versioned_portable_launcher(Path::new("C:/Downloads/Blockbench_5.2.2_portable.exe")));
        assert!(!is_versioned_portable_launcher(Path::new("C:/Apps/Blockbench.exe")));
        assert!(!is_versioned_portable_launcher(Path::new("C:/Apps/Blockbench_5.2.2.exe")));
        assert!(!is_executable_name(Path::new("C:/Downloads/Blockbench_5.2.2_portable.exe")));
    }

    #[test]
    fn executable_identity_requires_blockbench_filename() {
        assert!(is_executable_name(Path::new("C:/Apps/Blockbench.exe")));
        assert!(!is_executable_name(Path::new("C:/Apps/not-blockbench.exe")));
    }

    #[test]
    fn windows_product_revision_does_not_make_supported_editor_invalid() {
        let version = normalize_product_version("5.2.0.0");
        assert_eq!(version, "5.2.0");
        assert_eq!(evaluate_compatibility(&version).unwrap().status, "compatible-unverified");
        assert_eq!(normalize_product_version("5.2.0-beta.2"), "5.2.0-beta.2");
        assert_eq!(parse_version(&normalize_product_version("5.2.bad.0")), None);
    }

    #[test]
    fn version_parser_accepts_blockbench_release_and_prerelease_core() {
        assert_eq!(parse_version("5.2.0"), Some((5, 2, 0)));
        assert_eq!(parse_version("5.2.0-beta.2"), Some((5, 2, 0)));
    }
}
