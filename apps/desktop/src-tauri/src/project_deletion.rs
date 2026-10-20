//! Explicit, single-use, review-before-recycle Project deletion.
//! Never mutate arbitrary paths received from the frontend. Only an exact,
//! already-registered project ID may enter this flow.
use crate::{process::run_output, project_navigation, system_status};
use rand::{rngs::SysRng, TryRng};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, UNIX_EPOCH},
};
use sysinfo::System;

const REVIEW_TTL: Duration = Duration::from_secs(90);
const MAX_TREE_ENTRIES: usize = 10_000;
const MAX_TREE_DEPTH: usize = 32;

#[derive(Debug, Serialize)]
pub(crate) struct ProjectDeletePreview {
    pub token: String,
    pub project_name: String,
    pub folder_path: String,
    pub expires_in_seconds: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ProjectDeleteResult {
    pub status: &'static str,
    pub message: String,
}

#[derive(Clone)]
struct PendingDelete {
    token: String,
    id: String,
    folder: PathBuf,
    fingerprint: String,
    expires: Instant,
}

static PENDING: OnceLock<Mutex<Option<PendingDelete>>> = OnceLock::new();

fn pending() -> &'static Mutex<Option<PendingDelete>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

fn key(path: &Path) -> String {
    path.to_string_lossy().trim_start_matches(r"\\?\")
        .replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

fn same_or_descendant(path: &Path, ancestor: &Path) -> bool {
    let child = key(path);
    let root = key(ancestor);
    child == root || child.starts_with(&(root + "\\"))
}

fn protected_environment(root: &Path) -> Result<(), String> {
    if cfg!(windows) && ["USERPROFILE", "WINDIR", "LOCALAPPDATA"]
        .iter().any(|name| env::var_os(name).is_none()) {
        return Err("Windows profile and system locations could not be verified.".to_string());
    }
    // Never delete a containing folder of the user profile, even if it
    // is explicitly added as a shortcut.
    if let Some(home) = env::var_os("USERPROFILE") {
        let home = PathBuf::from(home);
        if same_or_descendant(&home, root) {
            return Err("This folder contains a Windows user profile or a protected location.".to_string());
        }
    }
    // For system/application data also reject children of protected roots.
    for variable in ["WINDIR", "SYSTEMROOT", "PROGRAMFILES", "PROGRAMFILES(X86)",
                     "PROGRAMDATA", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PUBLIC",
                     "ONEDRIVE", "ONEDRIVECONSUMER", "ONEDRIVECOMMERCIAL"] {
        if let Some(value) = env::var_os(variable) {
            let protected = PathBuf::from(value);
            if same_or_descendant(&protected, root) || same_or_descendant(root, &protected) {
                return Err("System, application or temporary folders cannot be recycled as Projects.".to_string());
            }
        }
    }
    for base in [env::var_os("USERPROFILE"), env::var_os("PUBLIC")].into_iter().flatten() {
        for name in ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"] {
            let protected = PathBuf::from(&base).join(name);
            if same_or_descendant(&protected, root) || key(root) == key(&protected) {
                return Err("Choose a specific project folder, not a common Windows folder.".to_string());
            }
        }
    }
    if let Ok(executable) = env::current_exe() {
        if same_or_descendant(&executable, root) {
            return Err("The folder contains the running application.".to_string());
        }
    }
    if let Ok(cwd) = env::current_dir() {
        if same_or_descendant(&cwd, root) {
            return Err("The current working directory cannot be recycled.".to_string());
        }
    }
    Ok(())
}

// A normal fixed-drive path is required. No UNC, mapped/network/removable,
// device or volume-root operations may be attempted.
#[cfg(windows)]
fn require_fixed_local_volume(root: &Path) -> Result<(), String> {
    use std::{iter, os::windows::ffi::OsStrExt};
    #[link(name = "kernel32")]
    extern "system" { fn GetDriveTypeW(root: *const u16) -> u32; }
    let raw = root.to_string_lossy().replace('/', "\\");
    let normal = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    let b = normal.as_bytes();
    if b.len() < 5 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\'
        || normal.starts_with(r"\\") {
        return Err("Delete Project requires a normal local Windows drive folder.".to_string());
    }
    // C:\Project\Subfolder is acceptable; drive roots and C:\Users aren't.
    let segments: Vec<_> = normal[3..].split('\\').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err("The selected folder is too broad to delete as a Project.".to_string());
    }
    let protected_names = [
        "windows", "program files", "program files (x86)",
        "programdata", "appdata", "$recycle.bin", "system volume information",
        "recovery", "windows.old", "onedrive", "dropbox", "google drive",
    ];
    if segments.iter().any(|segment| protected_names.contains(&segment.to_ascii_lowercase().as_str())) {
        return Err("System directories cannot be recycled as Projects.".to_string());
    }
    let common = ["desktop", "documents", "downloads", "pictures", "music",
                  "videos", "onedrive", "dropbox", "google drive", "public"];
    if segments.last().is_some_and(|name| common.contains(&name.to_ascii_lowercase().as_str())) {
        return Err("Choose a specific project folder, not a common user folder.".to_string());
    }
    let drive_root = format!("{}:\\", normal.chars().next().unwrap());
    let wide: Vec<u16> = std::ffi::OsStr::new(&drive_root).encode_wide()
        .chain(iter::once(0)).collect();
    // DRIVE_FIXED is 3. Non-fixed volumes may not support Recycle Bin.
    if unsafe { GetDriveTypeW(wide.as_ptr()) } != 3 {
        return Err("Only local fixed drives with Windows Recycle Bin support are allowed.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn require_fixed_local_volume(_root: &Path) -> Result<(), String> {
    Err("Delete Project to Recycle Bin is supported only on Windows.".to_string())
}

fn reparse_or_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() { return true; }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    { false }
}

fn fingerprint_tree(root: &Path) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let initial = fs::symlink_metadata(root)
        .map_err(|_| "Project folder is unavailable.".to_string())?;
    if !initial.file_type().is_dir() || reparse_or_link(&initial) {
        return Err("Linked project folders cannot be recycled.".to_string());
    }
    // Also bind the review to the directory itself, not just its children.
    hasher.update(key(root).as_bytes());
    hasher.update(format!("{:?}", initial.created().ok()).as_bytes());
    hasher.update(format!("{:?}", initial.modified().ok()).as_bytes());
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut count = 0usize;
    while let Some((directory, depth)) = stack.pop() {
        if depth > MAX_TREE_DEPTH {
            return Err("This folder is too deeply nested for safe Project deletion.".to_string());
        }
        let metadata = fs::symlink_metadata(&directory)
            .map_err(|_| "The project folder changed or is unavailable.".to_string())?;
        if reparse_or_link(&metadata) || !metadata.is_dir() {
            return Err("Project folders containing links or special directory entries cannot be recycled.".to_string());
        }
        let mut children = Vec::new();
        let mut entries = fs::read_dir(&directory)
            .map_err(|_| "The project folder cannot be fully inspected.".to_string())?;
        // Never allocate an unbounded list merely to decide that deletion is unsafe.
        for _ in 0..=MAX_TREE_ENTRIES.saturating_sub(count) {
            let Some(entry) = entries.next() else { break };
            children.push(entry.map_err(|_| "The project folder cannot be fully inspected.".to_string())?);
        }
        if entries.next().is_some() || children.len() + count > MAX_TREE_ENTRIES {
            return Err("This project is too large for safe in-app deletion; review it in File Explorer.".to_string());
        }
        children.sort_by_key(|entry| key(&entry.path()));
        for entry in children {
            count += 1;
            if count > MAX_TREE_ENTRIES {
                return Err("This project is too large for safe in-app deletion; review it in File Explorer.".to_string());
            }
            let path = entry.path();
            let meta = fs::symlink_metadata(&path)
                .map_err(|_| "The project changed during review.".to_string())?;
            if reparse_or_link(&meta) || (!meta.is_dir() && !meta.is_file()) {
                return Err("The project contains a link or special file; review it in File Explorer.".to_string());
            }
            let timestamp = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|time| (time.as_secs(), time.subsec_nanos()));
            hasher.update(key(&path).as_bytes());
            hasher.update([0]);
            hasher.update([u8::from(meta.is_dir())]);
            hasher.update(meta.len().to_le_bytes());
            hasher.update(format!("{timestamp:?}").as_bytes());
            if meta.is_dir() { stack.push((path, depth + 1)); }
        }
    }
    hasher.update(count.to_le_bytes());
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>())
}

fn blockbench_closed() -> Result<(), String> {
    let mut system = System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    if system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "blockbench.exe" || name == "blockbench"
    }) {
        return Err("Save your models and close all Blockbench windows before deleting a project.".to_string());
    }
    Ok(())
}

fn verify_candidate(id: &str) -> Result<(PathBuf, String, String), String> {
    blockbench_closed()?;
    let profile = system_status::project_navigation_profile_id();
    let (folder, project_name, registered) =
        project_navigation::registered_delete_target(id, profile.as_deref())?;
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("The registered project folder is unavailable.".to_string());
    }
    require_fixed_local_volume(&folder)?;
    protected_environment(&folder)?;
    let parent = folder.parent().ok_or_else(|| "A drive root cannot be deleted.".to_string())?;
    if parent == folder {
        return Err("A drive root cannot be deleted.".to_string());
    }
    for other in registered.iter().filter(|other| key(other) != key(&folder)) {
        if same_or_descendant(other, &folder) || same_or_descendant(&folder, other) {
            return Err("This folder overlaps another registered project. Remove the overlapping shortcut first.".to_string());
        }
    }
    // No target replacement, junction, or link to another path after review.
    let meta = fs::symlink_metadata(&folder)
        .map_err(|_| "The project folder is unavailable.".to_string())?;
    if !meta.file_type().is_dir() || reparse_or_link(&meta) {
        return Err("Linked or redirected project folders cannot be recycled.".to_string());
    }
    let canonical = fs::canonicalize(&folder)
        .map_err(|_| "The project folder cannot be verified.".to_string())?;
    if key(&canonical) != key(&folder) {
        return Err("The folder target has changed; deletion was cancelled.".to_string());
    }
    Ok((folder.clone(), project_name, fingerprint_tree(&folder)?))
}

pub(crate) fn prepare(id: String) -> Result<ProjectDeletePreview, String> {
    let (folder, name, fingerprint) = verify_candidate(&id)?;
    let mut random = [0u8; 24];
    SysRng.try_fill_bytes(&mut random)
        .map_err(|_| "Secure deletion review entropy is unavailable.".to_string())?;
    let token = random.iter().map(|v| format!("{v:02x}")).collect::<String>();
    let mut guard = pending().lock().map_err(|_| "Deletion review is unavailable.".to_string())?;
    *guard = Some(PendingDelete {
        id, folder: folder.clone(), fingerprint, token: token.clone(),
        expires: Instant::now() + REVIEW_TTL,
    });
    let displayed = folder.to_string_lossy().replace(r"\\?\", "");
    Ok(ProjectDeletePreview {
        token, project_name: name, folder_path: displayed,
        expires_in_seconds: REVIEW_TTL.as_secs(),
    })
}

pub(crate) fn cancel(token: String) {
    if let Ok(mut guard) = pending().lock() {
        if guard.as_ref().is_some_and(|item| item.token == token) { *guard = None; }
    }
}

#[cfg(windows)]
fn recycle_folder(folder: &Path) -> Result<(), String> {
    // Explicit RecycleOption.SendToRecycleBin overload ONLY. The default
    // DeleteDirectory overload PERMANENTLY deletes and must never be used.
    // Pass the path via environment, never interpolate it into script source.
    const SCRIPT: &str = r#"
$ErrorActionPreference='Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$target=$env:LAZYDESIGNER_RECYCLE_TARGET
if([string]::IsNullOrWhiteSpace($target)) { throw 'No project path' }
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
    $target,
    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
    [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
)
if([IO.Directory]::Exists($target)) { throw 'Recycle operation was not completed' }
[Console]::Out.Write('RECYCLED')
"#;
    let original = folder.to_string_lossy().replace(r"\\?\", "");
    let windows = env::var_os("SystemRoot")
        .ok_or_else(|| "Windows SystemRoot is unavailable; no recycle operation was attempted.".to_string())?;
    let powershell = PathBuf::from(windows)
        .join("System32").join("WindowsPowerShell").join("v1.0").join("powershell.exe");
    let executable_meta = fs::symlink_metadata(&powershell)
        .map_err(|_| "Trusted Windows PowerShell could not be verified.".to_string())?;
    if !executable_meta.file_type().is_file() || reparse_or_link(&executable_meta) {
        return Err("Trusted Windows PowerShell could not be verified.".to_string());
    }
    let output = run_output(
        Command::new(&powershell)
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-Command", SCRIPT])
            .env("LAZYDESIGNER_RECYCLE_TARGET", original),
        Duration::from_secs(120), "Windows Recycle Bin",
    )?;
    if !output.status.success() || output.stdout.as_slice() != b"RECYCLED" {
        return Err("Windows could not confirm the Recycle Bin operation. The shortcut was preserved; review the folder in Explorer.".to_string());
    }
    if folder.exists() {
        return Err("Windows did not confirm that the folder was recycled. The shortcut was preserved.".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle_folder(_folder: &Path) -> Result<(), String> {
    Err("Windows Recycle Bin is unavailable on this platform.".to_string())
}

pub(crate) fn confirm(token: String) -> Result<ProjectDeleteResult, String> {
    // Consume before any filesystem operation. A token is valid only once.
    let prior = pending().lock().map_err(|_| "Deletion review is unavailable.".to_string())?
        .take().ok_or_else(|| "Delete Project review expired. Review the project again.".to_string())?;
    if prior.token != token || Instant::now() >= prior.expires {
        return Err("Delete Project confirmation expired or does not match. Review again.".to_string());
    }
    let (folder, _, fingerprint) = verify_candidate(&prior.id)?;
    if key(&folder) != key(&prior.folder) || fingerprint != prior.fingerprint {
        return Err("The project changed after review. Nothing was recycled; review it again.".to_string());
    }
    recycle_folder(&folder)?;
    match project_navigation::unregister_recycled_folder(&folder, &prior.id) {
        Ok(()) => Ok(ProjectDeleteResult {
            status: "RECYCLED",
            message: "Project moved to Windows Recycle Bin. Its Workspace shortcut was removed.".to_string(),
        }),
        Err(_) => Ok(ProjectDeleteResult {
            status: "RECYCLED_SHORTCUT_RETAINED",
            message: "Project moved to Recycle Bin, but its shortcut could not be removed. Remove the old shortcut from Workspace.".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let mut b = [0u8; 8]; SysRng.try_fill_bytes(&mut b).expect("test entropy");
        let p = env::temp_dir().join(format!("lazydesigner-pm06-{name}-{}-{:x}", std::process::id(), u64::from_ne_bytes(b)));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn review_detects_content_changes_without_mutating_original() {
        let folder = temp_root("fingerprint");
        fs::write(folder.join("model.bbmodel"), b"one").unwrap();
        let old = fingerprint_tree(&folder).unwrap();
        fs::write(folder.join("model.bbmodel"), b"different-content").unwrap();
        assert_ne!(fingerprint_tree(&folder).unwrap(), old);
        assert_eq!(fs::read(folder.join("model.bbmodel")).unwrap(), b"different-content");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn deletion_review_rejects_links_and_does_not_touch_targets() {
        let folder = temp_root("symlink");
        let elsewhere = temp_root("elsewhere");
        fs::write(elsewhere.join("untouched.bbmodel"), b"keep").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&elsewhere, folder.join("linked")).unwrap();
            assert!(fingerprint_tree(&folder).is_err());
        }
        #[cfg(windows)]
        {
            // A symlink may require privilege; a special entry is still
            // guaranteed to be refused by metadata type checks.
            if std::os::windows::fs::symlink_dir(&elsewhere, folder.join("linked")).is_ok() {
                assert!(fingerprint_tree(&folder).is_err());
            }
        }
        assert_eq!(fs::read(elsewhere.join("untouched.bbmodel")).unwrap(), b"keep");
        fs::remove_dir_all(folder).unwrap();
        fs::remove_dir_all(elsewhere).unwrap();
    }

    #[test]
    fn review_token_cancellation_never_calls_recycle() {
        let pending_item = PendingDelete {
            token: "single-use".to_string(), id: "project-test".to_string(),
            folder: PathBuf::from("invalid"), fingerprint: "no".to_string(),
            expires: Instant::now() + REVIEW_TTL,
        };
        *pending().lock().unwrap() = Some(pending_item);
        cancel("single-use".to_string());
        assert!(pending().lock().unwrap().is_none());
        assert!(confirm("single-use".to_string()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn unsafe_windows_locations_are_rejected_without_invoking_recycle_bin() {
        for folder in [r"C:\", r"C:\Users", r"C:\Windows\System32",
                       r"\\server\share\project", r"C:\Users\Someone\AppData\Projects"] {
            assert!(require_fixed_local_volume(Path::new(folder)).is_err(), "{folder}");
        }
    }

    #[test]
    fn review_without_a_matching_single_use_token_cannot_recycle() {
        let token = "valid-one-time-review".to_string();
        let state = PendingDelete {
            token: token.clone(), id: "project-test".to_string(),
            folder: PathBuf::from("invalid"), fingerprint: "none".to_string(),
            expires: Instant::now() + REVIEW_TTL,
        };
        *pending().lock().unwrap() = Some(state);
        assert!(confirm("wrong-token".to_string()).is_err());
        assert!(pending().lock().unwrap().is_none());
        assert!(confirm(token).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn normal_user_project_path_is_not_confused_with_users_root() {
        let Some(profile) = env::var_os("USERPROFILE") else { return; };
        let sample = PathBuf::from(profile).join("Projects").join("Furniture");
        // Only lexical path + drive type; no file operations or user files are touched.
        assert!(require_fixed_local_volume(&sample).is_ok());
        assert!(protected_environment(&sample).is_ok());
    }

    #[test]
    fn ancestor_identity_is_component_bounded() {
        assert!(same_or_descendant(Path::new("C:/Projects/Child"), Path::new("C:/Projects")));
        assert!(!same_or_descendant(Path::new("C:/ProjectsOther"), Path::new("C:/Projects")));
    }
}
