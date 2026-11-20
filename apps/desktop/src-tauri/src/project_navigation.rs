use crate::blockbench;
#[cfg(test)]
use rand::Rng;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

mod saved_project_preferences;
use saved_project_preferences::*;
mod project_manifest_identity;
use project_manifest_identity::*;

#[derive(Debug, Serialize)]
pub struct ProjectNavigationModel {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub open: bool,
    pub dirty: bool,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
pub struct ProjectNavigationFolder {
    pub id: String,
    pub label: &'static str,
    pub kind: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ProjectNavigationProject {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub pinned: bool,
    pub registered: bool,
    pub available: bool,
    pub model_count: usize,
    pub models: Vec<ProjectNavigationModel>,
    pub folders: Vec<ProjectNavigationFolder>,
}

#[derive(Debug, Serialize)]
pub struct ActiveProjectNavigation {
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub model_id: Option<String>,
    pub model_name: String,
    pub saved: bool,
    pub dirty: bool,
}

#[derive(Debug, Serialize)]
pub struct ProjectNavigation {
    pub revision: Option<String>,
    pub session_live: bool,
    pub continue_model_id: Option<String>,
    pub recent_model_ids: Vec<String>,
    pub preferences_issue: Option<&'static str>,
    pub active: Option<ActiveProjectNavigation>,
    pub projects: Vec<ProjectNavigationProject>,
}

#[derive(Debug, Serialize)]
pub struct ProjectNavigationActionResult {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ProjectPathResult {
    pub path: String,
}

#[derive(Debug, Deserialize)]
struct NavigationSnapshotActive {
    uuid: String,
    name: String,
    model_path: Option<String>,
    saved: bool,
    #[serde(default)]
    dirty: bool,
}

#[derive(Debug, Deserialize)]
struct NavigationSnapshotOpen {
    uuid: String,
    name: String,
    path: Option<String>,
    saved: bool,
    dirty: bool,
    active: bool,
}

#[derive(Debug, Deserialize)]
struct NavigationSnapshotRecent {
    name: String,
    path: String,
    #[allow(dead_code)]
    day: Option<f64>,
    #[allow(dead_code)]
    favorite: bool,
}

#[derive(Debug, Deserialize)]
struct NavigationSnapshot {
    schema: u8,
    #[allow(dead_code)]
    observed_at_unix_ms: u64,
    generation: String,
    profile_id: String,
    revision: u64,
    last_model_path: Option<String>,
    active: Option<NavigationSnapshotActive>,
    #[serde(default)]
    open_models: Vec<NavigationSnapshotOpen>,
    recent_models: Vec<NavigationSnapshotRecent>,
}

const PROJECT_MANIFEST_FILE: &str = ".lazydesigner-project.json";
const PROJECT_MANIFEST_SCHEMA: u8 = 1;
const PROJECT_MANIFEST_MAX_BYTES: u64 = 4 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProjectManifest {
    schema: u8,
    project_uuid: String,
    display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ProjectManifestState {
    Missing,
    LegacyMarker,
    Valid(ProjectManifest),
    Invalid,
}

#[derive(Debug, Clone)]
struct ProjectIdentity {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(deny_unknown_fields)]
struct ProjectNavigationPreferences {
    schema: u8,
    pinned_project_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    registered_project_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    recycled_project_paths: Vec<String>,
}
const MAX_REGISTERED_PROJECTS: usize = 16;
const MAX_RECYCLED_PROJECT_MARKERS: usize = 32;
const MAX_PROJECT_MODELS: usize = 64;
const MAX_DIRECTORY_ENTRIES: usize = 128;

fn valid_profile_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn observed_at_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn project_navigation_snapshot_path(profile_id: Option<&str>) -> Option<PathBuf> {
    let profile_id = profile_id?;
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("LazyDesigner").join("project-navigation").join(format!("{profile_id}.json")))
}


fn project_navigation_preferences_path() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("LazyDesigner").join("project-preferences.json"))
}


fn valid_navigation_generation(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    value.chars().enumerate().all(|(index, ch)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            ch == '-'
        } else {
            ch.is_ascii_hexdigit()
        }
    })
}

fn navigation_snapshot_is_valid(snapshot: &NavigationSnapshot, expected_profile_id: &str) -> bool {
    snapshot.schema == 4
        && valid_navigation_generation(&snapshot.generation)
        && valid_profile_id(&snapshot.profile_id)
        && snapshot.profile_id == expected_profile_id
        && snapshot.open_models.len() <= 64
        && snapshot.recent_models.len() <= 128
}

fn read_navigation_snapshot(profile_id: Option<&str>) -> Option<NavigationSnapshot> {
    let path = project_navigation_snapshot_path(profile_id)?;
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() == 0 || metadata.len() > 512 * 1024 {
        return None;
    }

    let expected_profile_id = profile_id?;
    let snapshot: NavigationSnapshot = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    navigation_snapshot_is_valid(&snapshot, expected_profile_id).then_some(snapshot)
}

fn hide_recycled_model_history(snapshot: &mut NavigationSnapshot, recycled_roots: &[String]) {
    let hidden = |raw: &str| recycled_roots.iter().any(|root| {
        let model = navigation_path_key(Path::new(raw));
        let key = navigation_path_key(Path::new(root));
        model.starts_with(&(key + "\\"))
    });
    snapshot.last_model_path = snapshot.last_model_path.take().filter(|path| !hidden(path));
    if snapshot.active.as_ref()
        .and_then(|active| active.model_path.as_deref()).is_some_and(|path| hidden(path)) {
        snapshot.active = None;
    }
    snapshot.open_models.retain(|model| model.path.as_deref().map_or(true, |path| !hidden(path)));
    snapshot.recent_models.retain(|model| !hidden(&model.path));
}

fn read_visible_navigation_snapshot(
    profile_id: Option<&str>, recycled_roots: &[String],
) -> Option<NavigationSnapshot> {
    let mut snapshot = read_navigation_snapshot(profile_id)?;
    hide_recycled_model_history(&mut snapshot, recycled_roots);
    Some(snapshot)
}

fn plain_project_folder(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err("Select an existing project folder.".to_string());
    }
    let meta = fs::symlink_metadata(path)
        .map_err(|_| "Selected project folder is unavailable.".to_string())?;
    if !meta.file_type().is_dir() {
        return Err("Choose a normal project folder, not a linked or special location.".to_string());
    }
    Ok(())
}
fn scan_registered_models(root: &Path) -> Vec<PathBuf> {
    if plain_project_folder(root).is_err() { return Vec::new(); }
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    // User-selected directory + conventional Models/Model; no recursive crawl.
    let mut dirs = vec![root.to_path_buf()];
    for name in ["Models", "Model"] {
        let child = root.join(name);
        if fs::symlink_metadata(&child).is_ok_and(|m| m.file_type().is_dir())
            && !dirs.iter().any(|dir| navigation_path_key(dir) == navigation_path_key(&child)) {
            dirs.push(child);
        }
    }
    for dir in dirs {
        if let Ok(iter) = fs::read_dir(dir) {
            for entry in iter.take(MAX_DIRECTORY_ENTRIES).flatten() {
                let path = entry.path();
                if !is_bbmodel_path(&path)
                    || !fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_file()) {
                    continue;
                }
                if seen.insert(navigation_path_key(&path)) { models.push(path); }
                if models.len() >= MAX_PROJECT_MODELS { break; }
            }
        }
        if models.len() >= MAX_PROJECT_MODELS { break; }
    }
    models.sort_by_key(|p| navigation_path_key(p));
    models
}
fn navigation_revision_token(snapshot: &NavigationSnapshot) -> String {
    format!("{}:{}:{}", snapshot.profile_id, snapshot.generation, snapshot.revision)
}

const PROJECT_SESSION_LEASE_TTL_MS: u64 = 30_000;

fn project_session_fresh(blockbench_running: bool, modified_unix_ms: u64, now_unix_ms: u64) -> bool {
    blockbench_running
        && now_unix_ms.saturating_sub(modified_unix_ms) <= PROJECT_SESSION_LEASE_TTL_MS
}

pub(crate) fn probe(blockbench_running: bool, profile_id: Option<&str>) -> (Option<String>, bool) {
    let Some(path) = project_navigation_snapshot_path(profile_id) else {
        return (None, false);
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return (None, false);
    };
    let Some(snapshot) = read_navigation_snapshot(profile_id) else {
        return (None, false);
    };
    let revision = Some(navigation_revision_token(&snapshot));
    if !blockbench_running {
        return (revision, false);
    }
    let Ok(modified) = metadata.modified() else {
        return (revision, false);
    };
    let Ok(duration) = modified.duration_since(UNIX_EPOCH) else {
        return (revision, false);
    };
    let modified_unix_ms = duration.as_millis().min(u64::MAX as u128) as u64;
    (
        revision,
        project_session_fresh(true, modified_unix_ms, observed_at_unix_ms()),
    )
}

fn live_open_models(snapshot: &NavigationSnapshot, session_live: bool) -> &[NavigationSnapshotOpen] {
    if session_live {
        snapshot.open_models.as_slice()
    } else {
        &[]
    }
}

fn is_bbmodel_path(path: &Path) -> bool {
    path.is_absolute()
        && path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("bbmodel"))
            .unwrap_or(false)
}

fn navigation_id(prefix: &str, path: &Path) -> String {
    use sha2::{Digest, Sha256};
    let normalized = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    format!("{prefix}-{}", &digest[..20])
}

fn navigation_path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

// Pin is a Desktop-only bookmark. It must never create or rewrite
// project-folder files or convert a legacy project marker.
fn set_project_pin(preferences: &mut ProjectNavigationPreferences, id: &str, legacy_id: &str, pin: bool) {
    preferences.pinned_project_ids.retain(|candidate| candidate != id && candidate != legacy_id);
    if pin { preferences.pinned_project_ids.push(id.to_string()); }
    preferences.pinned_project_ids.sort();
    preferences.pinned_project_ids.dedup();
}

fn register_project_folder_at(prefs_path: &Path, chosen: &Path) -> Result<&'static str, String> {
    plain_project_folder(chosen)?;
    let folder = fs::canonicalize(chosen).map_err(|_| "Selected project folder is unavailable.".to_string())?;
    plain_project_folder(&folder)?;
    let (mut prefs, old) = match read_navigation_preferences_with_raw_at(prefs_path)? {
        Some((value, bytes)) => (value, Some(bytes)),
        None => (empty_navigation_preferences(), None),
    };
    let path_key = navigation_path_key(&folder);
    if prefs.registered_project_paths.iter().any(|item| navigation_path_key(Path::new(item)) == path_key) {
        return Ok("ALREADY_ADDED");
    }
    if prefs.registered_project_paths.len() >= MAX_REGISTERED_PROJECTS {
        return Err("Project folder list is full. Remove an unused shortcut before adding another.".to_string());
    }
    prefs.recycled_project_paths.retain(|path| navigation_path_key(Path::new(path)) != path_key);
    prefs.registered_project_paths.push(folder.to_string_lossy().into_owned());
    let parent = prefs_path.parent().ok_or_else(|| "Preference directory is invalid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Cannot prepare project preferences: {error}"))?;
    write_navigation_preferences_expected_at(prefs_path, &prefs, old.as_deref())?;
    Ok("ADDED")
}

/// Resolve ONLY user-added folders by opaque project ID. History-inferred
/// parent directories have no permission to use the destructive operation.
pub(crate) fn registered_delete_target(
    id: &str, profile_id: Option<&str>,
) -> Result<(PathBuf, String, Vec<PathBuf>), String> {
    if !valid_pinned_project_id(id) {
        return Err("Invalid Project identity.".to_string());
    }
    let (preferences, _) = load_project_navigation_preferences_with_raw()?;
    let roots = registered_roots(&preferences);
    let snapshot = read_navigation_snapshot(profile_id);
    let identities = project_identity_map(snapshot.as_ref(), &roots);
    let matches: Vec<_> = roots.iter().filter_map(|root| {
        let identity = identities.get(&navigation_path_key(root))?;
        (identity.id == id).then(|| (root.clone(), identity.name.clone()))
    }).collect();
    if matches.len() != 1 {
        return Err("Delete Project is available only for one explicitly added folder.".to_string());
    }
    Ok((matches[0].0.clone(), matches[0].1.clone(), roots))
}

/// After successful recycle, remove only the matching shortcut and local Pin.
/// This MUST NOT touch the original directory or Blockbench recent history.
pub(crate) fn unregister_recycled_folder(path: &Path, old_id: &str) -> Result<(), String> {
    let (mut preferences, previous) = load_project_navigation_preferences_with_raw()?;
    let key = navigation_path_key(path);
    let before = preferences.registered_project_paths.len();
    preferences.registered_project_paths.retain(|saved|
        navigation_path_key(Path::new(saved)) != key
    );
    if preferences.registered_project_paths.len() == before {
        return Err("Project was recycled, but its shortcut has already changed.".to_string());
    }
    let path_id = navigation_id("project", path);
    set_project_pin(&mut preferences, old_id, &path_id, false);
    // Hide the deleted folder from Workspace without editing Blockbench recents.
    if !preferences.recycled_project_paths.iter().any(|item| navigation_path_key(Path::new(item)) == key) {
        preferences.recycled_project_paths.push(path.to_string_lossy().into_owned());
        if preferences.recycled_project_paths.len() > MAX_RECYCLED_PROJECT_MARKERS {
            preferences.recycled_project_paths.remove(0);
        }
    }
    write_project_navigation_preferences(&preferences, previous.as_deref())
}

pub(crate) fn add_project_folder() -> Result<ProjectNavigationActionResult, String> {
    let Some(folder) = FileDialog::new().pick_folder() else {
        return Ok(ProjectNavigationActionResult { status: "CANCELLED" });
    };
    let path = project_navigation_preferences_path()
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
    Ok(ProjectNavigationActionResult { status: register_project_folder_at(&path, &folder)? })
}

/// Fail closed on case-insensitive Windows name collisions, including an
/// existing file with the requested name. Never create models or subfolders.
fn create_empty_project_directory(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let name = validated_model_rename_stem(name)?;
    plain_project_folder(parent)?;
    let requested = name.to_lowercase();
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("Cannot inspect the selected parent folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot inspect an existing folder entry: {error}"))?;
        if entry.file_name().to_string_lossy().to_lowercase() == requested {
            return Err("A file or folder with that name already exists in this location.".to_string());
        }
    }
    let target = parent.join(name);
    fs::create_dir(&target).map_err(|error| {
        format!("Could not create project folder (nothing was registered): {error}")
    })?;
    Ok(target)
}

/// Creates only a project directory. Never creates a model or asset file.
pub(crate) fn create_project_folder(name: &str) -> Result<ProjectNavigationActionResult, String> {
    let name = validated_model_rename_stem(name)?;
    let Some(parent) = FileDialog::new().pick_folder() else {
        return Ok(ProjectNavigationActionResult { status: "CANCELLED" });
    };
    plain_project_folder(&parent)?;
    let parent = fs::canonicalize(&parent)
        .map_err(|_| "Selected parent folder is unavailable.".to_string())?;
    plain_project_folder(&parent)?;
    let target = create_empty_project_directory(&parent, name)?;
    let prefs_path = project_navigation_preferences_path()
        .ok_or_else(|| "Project folder created, but LOCALAPPDATA is unavailable; folder was not registered.".to_string())?;
    match register_project_folder_at(&prefs_path, &target) {
        Ok(status) => Ok(ProjectNavigationActionResult { status }),
        Err(error) => Err(format!("Project folder was created at {}, but could not be added to Projects: {error}", target.display())),
    }
}

fn project_name(root: &Path) -> String {
    root.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Project")
        .to_string()
}


fn working_folders(root: &Path) -> Vec<(PathBuf, &'static str, &'static str)> {
    let groups: [(&str, &str, &[&str]); 4] = [
        ("models", "Models", &["Models", "Model"]),
        ("references", "References", &["References", "Reference"]),
        ("textures", "Textures", &["Textures", "Texture"]),
        ("exports", "Exports", &["Exports", "Export"]),
    ];
    let mut result = Vec::new();
    for (kind, label, candidates) in groups {
        if let Some(path) = candidates.iter()
            .map(|name| root.join(name))
            .find(|path| path.is_dir())
        {
            result.push((path, label, kind));
        }
    }
    result
}

fn folder_projection(root: &Path) -> Vec<ProjectNavigationFolder> {
    working_folders(root)
        .into_iter()
        .map(|(path, label, kind)| ProjectNavigationFolder {
            id: navigation_id("folder", &path),
            label,
            kind,
        })
        .collect()
}

fn model_name(path: &Path, preferred: &str) -> String {
    if !preferred.trim().is_empty() {
        return preferred.trim().to_string();
    }
    path.file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Model")
        .to_string()
}

fn navigation_paths(profile_id: Option<&str>) -> (
    HashMap<String, PathBuf>,
    HashMap<String, PathBuf>,
    HashMap<String, PathBuf>,
) {
    let prefs = load_project_navigation_preferences()
        .unwrap_or_else(|_| empty_navigation_preferences());
    let snapshot = read_visible_navigation_snapshot(profile_id, &prefs.recycled_project_paths);
    let registered = registered_roots(&prefs);
    let identities = project_identity_map(snapshot.as_ref(), &registered);
    let mut projects = HashMap::new();
    let mut models = HashMap::new();
    let mut folders = HashMap::new();
    let mut add = |raw: &str| {
        let path = PathBuf::from(raw);
        let Some(root) = project_root_with_registered(&path, &registered) else { return; };
        let Some(identity) = identities.get(&navigation_path_key(&root)) else { return; };
        projects.entry(identity.id.clone()).or_insert(root.clone());
        models.entry(navigation_id("model", &path)).or_insert(path);
        for (folder, _, _) in working_folders(&root) {
            folders.entry(navigation_id("folder", &folder)).or_insert(folder);
        }
    };
    if let Some(snapshot) = snapshot.as_ref() {
        if let Some(last) = snapshot.last_model_path.as_deref() { add(last); }
        if let Some(active) = snapshot.active.as_ref().and_then(|value| value.model_path.as_deref()) { add(active); }
        for open in &snapshot.open_models { if let Some(path) = open.path.as_deref() { add(path); } }
        for recent in &snapshot.recent_models { add(&recent.path); }
    }
    drop(add);
    for root in &registered {
        if let Some(identity) = identities.get(&navigation_path_key(root)) {
            projects.entry(identity.id.clone()).or_insert(root.clone());
            for path in scan_registered_models(root) {
                models.insert(navigation_id("model", &path), path);
            }
            for (folder, _, _) in working_folders(root) {
                folders.entry(navigation_id("folder", &folder)).or_insert(folder);
            }
        }
    }
    (projects, models, folders)
}

fn continue_model_id_for_path(raw: Option<&str>) -> Option<String> {
    let path = PathBuf::from(raw?);
    if !is_bbmodel_path(&path) || !path.is_file() {
        return None;
    }
    Some(navigation_id("model", &path))
}

pub(crate) fn projection(session_live: bool, profile_id: Option<&str>) -> ProjectNavigation {
    let preferences_issue = preferences_integrity_issue();
    let preferences = load_project_navigation_preferences()
        .unwrap_or_else(|_| empty_navigation_preferences());
    let registered = registered_roots(&preferences);
    let snapshot = read_visible_navigation_snapshot(profile_id, &preferences.recycled_project_paths);
    let pinned: HashSet<String> = preferences.pinned_project_ids.into_iter().collect();
    let revision = snapshot.as_ref().map(navigation_revision_token);
    let continue_model_id = continue_model_id_for_path(
        snapshot.as_ref().and_then(|state| state.last_model_path.as_deref())
    );
    // Preserve Blockbench's native recent-file order instead of guessing
    // which model is newest from project/pin ordering.
    let recent_model_ids: Vec<String> = snapshot.iter().flat_map(|state| state.recent_models.iter())
        .filter_map(|recent| {
            let path = PathBuf::from(&recent.path);
            (is_bbmodel_path(&path) && path.is_file())
                .then(|| navigation_id("model", &path))
        })
        .take(5)
        .collect();
    let identities = project_identity_map(snapshot.as_ref(), &registered);

    let active_path = if session_live {
        snapshot.as_ref().and_then(|state| state.active.as_ref())
            .and_then(|value| value.model_path.as_ref())
            .map(PathBuf::from)
            .filter(|path| is_bbmodel_path(path))
    } else {
        None
    };
    let active_model_id = active_path.as_ref().map(|path| navigation_id("model", path));
    let active_project_root = active_path.as_ref().and_then(|path| project_root_with_registered(path, &registered));
    let active_project_identity = active_project_root.as_ref()
        .and_then(|root| identities.get(&navigation_path_key(root)));
    let active_project_id = active_project_identity.map(|identity| identity.id.clone());

    let active = if session_live {
        snapshot.as_ref().and_then(|state| state.active.as_ref()).map(|value| ActiveProjectNavigation {
            project_id: active_project_id.clone(),
            project_name: active_project_identity.map(|identity| identity.name.clone()),
            model_id: active_model_id.clone(),
            model_name: if let Some(path) = active_path.as_ref() {
                model_name(path, &value.name)
            } else if value.name.trim().is_empty() {
                "Untitled Project".to_string()
            } else {
                value.name.trim().to_string()
            },
            saved: value.saved && active_path.is_some(),
            dirty: value.dirty,
        })
    } else {
        None
    };

    let live_open_models = snapshot.as_ref()
        .map(|state| live_open_models(state, session_live))
        .unwrap_or(&[]);
    let open_by_path: HashMap<String, (bool, bool)> = live_open_models.iter()
        .filter_map(|model| {
            let path = model.path.as_ref()?;
            let path = PathBuf::from(path);
            if !is_bbmodel_path(&path) {
                return None;
            }
            let key = navigation_path_key(&path);
            Some((key, (model.active, model.dirty)))
        })
        .collect();

    let mut projects: Vec<ProjectNavigationProject> = Vec::new();
    let mut add_model = |path: PathBuf, preferred: &str, active_model: bool| {
        let Some(root) = project_root_with_registered(&path, &registered) else { return; };
        let Some(identity) = identities.get(&navigation_path_key(&root)) else { return; };
        let project_id = identity.id.clone();
        let legacy_project_id = navigation_id("project", &root);
        let model_id = navigation_id("model", &path);
        let project_active = active_project_id.as_deref() == Some(project_id.as_str());
        let path_key = navigation_path_key(&path);
        let (open, dirty) = open_by_path.get(&path_key).copied().unwrap_or((false, false));

        let index = projects.iter().position(|project| project.id == project_id)
            .unwrap_or_else(|| {
                projects.push(ProjectNavigationProject {
                    id: project_id.clone(),
                    name: identity.name.clone(),
                    active: project_active,
                    pinned: pinned.contains(&project_id) || pinned.contains(&legacy_project_id),
                    registered: registered.iter().any(|folder| navigation_path_key(folder) == navigation_path_key(&root)),
                    available: if registered.iter().any(|folder| navigation_path_key(folder) == navigation_path_key(&root)) {
                        plain_project_folder(&root).is_ok()
                    } else { root.is_dir() },
                    model_count: 0,
                    models: Vec::new(),
                    folders: folder_projection(&root),
                });
                projects.len() - 1
            });
        let project = &mut projects[index];
        project.active |= project_active;
        if project.models.iter().any(|model| model.id == model_id) {
            if let Some(model) = project.models.iter_mut().find(|model| model.id == model_id) {
                model.active |= active_model || open_by_path.get(&path_key).map(|state| state.0).unwrap_or(false);
                model.open |= open;
                model.dirty |= dirty;
            }
            return;
        }
        if project.registered && project.models.len() >= MAX_PROJECT_MODELS { return; }
        project.models.push(ProjectNavigationModel {
            id: model_id,
            name: model_name(&path, preferred),
            active: active_model || open_by_path.get(&path_key).map(|state| state.0).unwrap_or(false),
            open,
            dirty,
            exists: path.is_file(),
        });
        project.model_count = project.models.len();
    };

    if let Some(snapshot) = snapshot.as_ref() {
        if let Some(last) = snapshot.last_model_path.as_deref() {
            add_model(PathBuf::from(last), "", false);
        }
        if let (Some(path), Some(active_snapshot)) = (active_path.clone(), snapshot.active.as_ref()) {
            add_model(path, &active_snapshot.name, true);
        }
        for open in live_open_models {
            if let Some(raw_path) = open.path.as_ref() {
                let path = PathBuf::from(raw_path);
                if is_bbmodel_path(&path) { add_model(path, &open.name, open.active); }
            }
        }
        for recent in &snapshot.recent_models {
            let path = PathBuf::from(&recent.path);
            let model_id = navigation_id("model", &path);
            add_model(path, &recent.name, active_model_id.as_deref() == Some(model_id.as_str()));
        }
    }
    for root in &registered {
        for model in scan_registered_models(root) { add_model(model, "", false); }
    }
    drop(add_model);
    // Registered folders remain visible even if empty or moved, and without
    // a Blockbench plugin snapshot. No drive or recursive scan is performed.
    for root in &registered {
        let Some(identity) = identities.get(&navigation_path_key(root)) else { continue; };
        if projects.iter().any(|project| project.id == identity.id) { continue; }
        let legacy_id = navigation_id("project", root);
        projects.push(ProjectNavigationProject {
            id: identity.id.clone(), name: identity.name.clone(), active: false,
            pinned: pinned.contains(&identity.id) || pinned.contains(&legacy_id),
            registered: true, available: plain_project_folder(root).is_ok(), model_count: 0,
            models: Vec::new(), folders: folder_projection(root),
        });
    }
    projects.sort_by_key(|project| {
        if project.active { 0 } else if project.pinned { 1 } else if project.registered { 2 } else { 3 }
    });
    ProjectNavigation { revision, session_live, continue_model_id, recent_model_ids, preferences_issue, active, projects }
}

pub(crate) fn action(action: &str, id: &str, profile_id: Option<&str>) -> Result<ProjectNavigationActionResult, String> {
    let (projects, models, folders) = navigation_paths(profile_id);
    match action {
        "restore-project-preferences" => {
            if !id.is_empty() { return Err("Preference restore does not accept Project IDs.".to_string()); }
            let path = project_navigation_preferences_path()
                .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
            restore_project_preferences_at(&path)?;
            Ok(ProjectNavigationActionResult { status: "RESTORED" })
        }
        "open-project-folder" => {
            let path = projects.get(id).ok_or_else(|| "Project is no longer available.".to_string())?;
            if !path.is_dir() {
                return Err("Project folder is unavailable.".to_string());
            }
            Command::new("explorer.exe")
                .arg(path)
                .spawn()
                .map_err(|error| format!("Unable to open the project folder: {error}"))?;
            Ok(ProjectNavigationActionResult { status: "OPENED" })
        }
        "pin-project" | "unpin-project" => {
            let root = projects.get(id).ok_or_else(|| "Project is no longer available.".to_string())?;
            let legacy_id = navigation_id("project", root);
            let (mut preferences, original) = load_project_navigation_preferences_with_raw()?;
            let pin = action == "pin-project";
            set_project_pin(&mut preferences, id, &legacy_id, pin);
            write_project_navigation_preferences(&preferences, original.as_deref())?;
            Ok(ProjectNavigationActionResult { status: if pin { "PINNED" } else { "UNPINNED" } })
        }
        "remove-project-folder" => {
            let root = projects.get(id).ok_or_else(|| "Project is no longer available.".to_string())?;
            let (mut preferences, original) = load_project_navigation_preferences_with_raw()?;
            let root_key = navigation_path_key(root);
            let before = preferences.registered_project_paths.len();
            preferences.registered_project_paths.retain(|saved| navigation_path_key(Path::new(saved)) != root_key);
            if before == preferences.registered_project_paths.len() {
                return Err("This project is not in the added-folder list.".to_string());
            }
            // Removing a shortcut also removes its local Pin; the actual
            // folder, model files and Blockbench recent history are untouched.
            let legacy_id = navigation_id("project", root);
            set_project_pin(&mut preferences, id, &legacy_id, false);
            write_project_navigation_preferences(&preferences, original.as_deref())?;
            Ok(ProjectNavigationActionResult { status: "REMOVED_FROM_LIST" })
        }
        "open-folder" => {
            let path = folders.get(id).ok_or_else(|| "Folder is no longer available.".to_string())?;
            if !path.is_dir() {
                return Err("Folder is unavailable.".to_string());
            }
            Command::new("explorer.exe")
                .arg(path)
                .spawn()
                .map_err(|error| format!("Unable to open the project folder: {error}"))?;
            Ok(ProjectNavigationActionResult { status: "OPENED" })
        }
        "reveal-model" => {
            let path = models.get(id).ok_or_else(|| "Model is no longer available.".to_string())?;
            if !path.is_file() {
                return Err("Model file is unavailable.".to_string());
            }
            Command::new("explorer.exe")
                .arg("/select,")
                .arg(path)
                .spawn()
                .map_err(|error| format!("Unable to reveal the model file: {error}"))?;
            Ok(ProjectNavigationActionResult { status: "REVEALED" })
        }
        "open-model" => {
            let path = models.get(id).ok_or_else(|| "Model is no longer available.".to_string())?;
            // Models from a user-added project folder are explicitly
            // selected by that user and may be opened without AI or plugin
            // snapshot. History-only models retain exact snapshot affinity.
            let registered = load_project_navigation_preferences()
                .map(|prefs| registered_roots(&prefs))
                .unwrap_or_default();
            let from_folder = registered.iter().any(|root| {
                navigation_path_key(path).starts_with(&(navigation_path_key(root) + "\\"))
                    && scan_registered_models(root).iter().any(|model| navigation_path_key(model) == navigation_path_key(path))
            });
            let user_data = if from_folder {
                crate::system_status::editor_profile_for_model(None)?
            } else {
                let expected = profile_id.ok_or_else(||
                    "A verified Blockbench profile is required for this model.".to_string())?;
                crate::system_status::editor_profile_for_model(Some(expected))?
            };
            let status = blockbench::open_model(path, &user_data)?;
            Ok(ProjectNavigationActionResult { status })
        }
        _ => Err("Unsupported project navigation action.".to_string()),
    }
}

/// Validation is deliberately independent of UI checks. The eventual native
/// rename command must call this again immediately before touching the disk.
fn validated_model_rename_stem(raw: &str) -> Result<&str, String> {
    if raw.is_empty() || raw.chars().count() > 120 || raw.trim() != raw
        || raw.ends_with('.') || raw.ends_with(' ')
        || raw.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        || raw == "." || raw == ".." || raw.to_ascii_lowercase().ends_with(".bbmodel")
    {
        return Err("Invalid model name. Enter a filename without the .bbmodel extension.".to_string());
    }
    let base = raw.split('.').next().unwrap_or("");
    let reserved = matches!(base.to_ascii_uppercase().as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" |
        "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" |
        "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" |
        "LPT6" | "LPT7" | "LPT8" | "LPT9");
    if reserved {
        return Err("Reserved Windows filename.".to_string());
    }
    Ok(raw)
}

pub(crate) fn path(id: &str, profile_id: Option<&str>) -> Result<ProjectPathResult, String> {
    let (projects, models, folders) = navigation_paths(profile_id);
    let path = models.get(id).or_else(|| projects.get(id)).or_else(|| folders.get(id))
        .ok_or_else(|| "Project or model is no longer available.".to_string())?;
    Ok(ProjectPathResult { path: path.display().to_string() })
}

#[cfg(test)]
mod tests;
