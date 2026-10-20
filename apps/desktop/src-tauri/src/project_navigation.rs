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

fn empty_navigation_preferences() -> ProjectNavigationPreferences {
    ProjectNavigationPreferences { schema: 1, pinned_project_ids: Vec::new(), registered_project_paths: Vec::new(), recycled_project_paths: Vec::new() }
}

fn valid_pinned_project_id(id: &str) -> bool {
    id.strip_prefix("project-")
        .map(|suffix| suffix.len() == 20 && suffix.chars().all(|ch| ch.is_ascii_hexdigit()))
        .unwrap_or(false)
}

fn valid_registered_project_path(value: &str) -> bool {
    value.len() <= 4096 && !value.is_empty()
        && Path::new(value).is_absolute()
        && Path::new(value).parent().is_some_and(|parent| parent != Path::new(value))
}
fn validate_registered_paths(paths: &[String]) -> bool {
    paths.len() <= MAX_REGISTERED_PROJECTS
        && paths.iter().all(|p| valid_registered_project_path(p))
        && paths.iter().map(|p| navigation_path_key(Path::new(p)))
            .collect::<HashSet<_>>().len() == paths.len()
}
fn registered_roots(preferences: &ProjectNavigationPreferences) -> Vec<PathBuf> {
    preferences.registered_project_paths.iter().map(PathBuf::from).collect()
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
fn read_navigation_preferences_with_raw_at(path: &Path)
    -> Result<Option<(ProjectNavigationPreferences, Vec<u8>)>, String>
{
    let raw = match crate::metadata_io::read_metadata_bounded(path)
        .map_err(|error| format!("Unable to inspect project preferences: {error}"))?
    {
        Some(raw) if !raw.is_empty() => raw,
        Some(_) => return Err("Preferences are empty; original file preserved.".to_string()),
        None => return Ok(None),
    };
    let mut value: ProjectNavigationPreferences = serde_json::from_slice(&raw)
        .map_err(|_| "Preferences malformed; original file preserved.".to_string())?;
    if value.schema != 1 || value.pinned_project_ids.iter().any(|id| !valid_pinned_project_id(id)) || !validate_registered_paths(&value.registered_project_paths) || value.recycled_project_paths.len() > MAX_RECYCLED_PROJECT_MARKERS || !value.recycled_project_paths.iter().all(|path| valid_registered_project_path(path)) {
        return Err("Preferences use unsupported schema or IDs; original preserved.".to_string());
    }
    value.pinned_project_ids.sort();
    value.pinned_project_ids.dedup();
    Ok(Some((value, raw)))
}

fn read_navigation_preferences_at(path: &Path) -> Result<Option<ProjectNavigationPreferences>, String> {
    Ok(read_navigation_preferences_with_raw_at(path)?.map(|(value, _)| value))
}

fn load_project_navigation_preferences_with_raw() -> Result<(ProjectNavigationPreferences, Option<Vec<u8>>), String> {
    let path = project_navigation_preferences_path()
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
    Ok(match read_navigation_preferences_with_raw_at(&path)? {
        Some((value, raw)) => (value, Some(raw)),
        None => (empty_navigation_preferences(), None),
    })
}

fn load_project_navigation_preferences() -> Result<ProjectNavigationPreferences, String> {
    load_project_navigation_preferences_with_raw().map(|(value, _)| value)
}

fn write_navigation_preferences_expected_at(
    path: &Path, value: &ProjectNavigationPreferences, expected: Option<&[u8]>,
) -> Result<(), String> {
    if value.schema != 1 || value.pinned_project_ids.iter().any(|id| !valid_pinned_project_id(id)) || !validate_registered_paths(&value.registered_project_paths) || value.recycled_project_paths.len() > MAX_RECYCLED_PROJECT_MARKERS || !value.recycled_project_paths.iter().all(|path| valid_registered_project_path(path)) {
        return Err("Preferences schema or project IDs are invalid.".to_string());
    }
    let data = serde_json::to_vec(value).map_err(|error| format!("Unable to encode preferences: {error}"))?;
    if data.len() > 64 * 1024 {
        return Err("Preferences exceed bounded size.".to_string());
    }
    crate::metadata_io::replace_metadata_if_unchanged(path, &data, expected, true)
        .map_err(|error| format!("Unable to replace preferences safely: {error}"))
}

fn write_navigation_preferences_at(path: &Path, value: &ProjectNavigationPreferences) -> Result<(), String> {
    let previous = read_navigation_preferences_with_raw_at(path)?.map(|(_, raw)| raw);
    write_navigation_preferences_expected_at(path, value, previous.as_deref())
}

fn write_project_navigation_preferences(
    value: &ProjectNavigationPreferences, expected: Option<&[u8]>
) -> Result<(), String> {
    let path = project_navigation_preferences_path()
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
    let parent = path.parent().ok_or_else(|| "Preference directory is invalid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Unable to prepare preferences: {error}"))?;
    write_navigation_preferences_expected_at(&path, value, expected)
}

fn preferences_integrity_issue() -> Option<&'static str> {
    let path = project_navigation_preferences_path()?;
    if read_navigation_preferences_at(&path).is_ok() { return None; }
    let backup = crate::metadata_io::recovery_path(&path).ok()?;
    let backup_valid = matches!(read_navigation_preferences_at(&backup), Ok(Some(_)));
    let original_readable = matches!(crate::metadata_io::read_metadata_bounded(&path), Ok(Some(_)));
    Some(if backup_valid && original_readable { "RECOVERABLE" } else { "UNRECOVERABLE" })
}

fn restore_project_preferences_at(path: &Path) -> Result<(), String> {
    if read_navigation_preferences_at(path).is_ok() {
        return Err("Current preferences are not corrupt; restore refused.".to_string());
    }
    let backup_path = crate::metadata_io::recovery_path(path)
        .map_err(|error| format!("Invalid recovery path: {error}"))?;
    let (_, backup) = read_navigation_preferences_with_raw_at(&backup_path)?
        .ok_or_else(|| "No validated project preferences backup exists.".to_string())?;
    let damaged = crate::metadata_io::read_metadata_bounded(path)
        .map_err(|error| format!("Cannot inspect damaged preferences: {error}"))?
        .ok_or_else(|| "Preferences are missing; restore refused.".to_string())?;
    crate::metadata_io::preserve_damaged_metadata(path, &damaged)
        .map_err(|error| format!("Cannot preserve damaged preferences: {error}"))?;
    // Do not rotate backup: it is the only known-good recovery source.
    crate::metadata_io::replace_metadata_if_unchanged(path, &backup, Some(&damaged), false)
        .map_err(|error| format!("Preferences changed during restore: {error}"))?;
    Ok(())
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

fn normalized_project_display_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 128 || trimmed.chars().any(|ch| ch.is_control()) {
        return None;
    }
    Some(trimmed.to_string())
}

fn read_project_manifest_state(root: &Path) -> ProjectManifestState {
    let path = root.join(PROJECT_MANIFEST_FILE);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ProjectManifestState::Missing,
        Err(_) => return ProjectManifestState::Invalid,
    };
    if !metadata.is_file() || metadata.len() > PROJECT_MANIFEST_MAX_BYTES {
        return ProjectManifestState::Invalid;
    }
    let Ok(bytes) = fs::read(&path) else { return ProjectManifestState::Invalid; };
    if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        return ProjectManifestState::LegacyMarker;
    }
    let Ok(mut manifest) = serde_json::from_slice::<ProjectManifest>(&bytes) else {
        return ProjectManifestState::Invalid;
    };
    let Some(display_name) = normalized_project_display_name(&manifest.display_name) else {
        return ProjectManifestState::Invalid;
    };
    if manifest.schema != PROJECT_MANIFEST_SCHEMA || !valid_navigation_generation(&manifest.project_uuid) {
        return ProjectManifestState::Invalid;
    }
    manifest.project_uuid = manifest.project_uuid.to_ascii_lowercase();
    manifest.display_name = display_name;
    ProjectManifestState::Valid(manifest)
}

fn stable_project_id(manifest: &ProjectManifest) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(manifest.project_uuid.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    format!("project-{}", &digest[..20])
}

fn project_identity_from_state(root: &Path, state: &ProjectManifestState, collisions: &HashSet<String>) -> ProjectIdentity {
    if let ProjectManifestState::Valid(manifest) = state {
        let id = stable_project_id(manifest);
        if !collisions.contains(&id) {
            return ProjectIdentity { id, name: manifest.display_name.clone() };
        }
    }
    ProjectIdentity { id: navigation_id("project", root), name: project_name(root) }
}

fn project_root_with_registered(path: &Path, registered: &[PathBuf]) -> Option<PathBuf> {
    if !is_bbmodel_path(path) { return None; }
    let key = navigation_path_key(path);
    registered.iter()
        .filter(|root| key.starts_with(&(navigation_path_key(root) + "\\")))
        .max_by_key(|root| navigation_path_key(root).len())
        .cloned()
        .or_else(|| project_root_for_model(path))
}

fn project_identity_map(snapshot: Option<&NavigationSnapshot>, registered: &[PathBuf]) -> HashMap<String, ProjectIdentity> {
    let mut roots: HashMap<String, PathBuf> = registered.iter()
        .map(|root| (navigation_path_key(root), root.clone())).collect();
    let mut add = |raw: &str| {
        let path = PathBuf::from(raw);
        if let Some(root) = project_root_with_registered(&path, registered) {
            roots.entry(navigation_path_key(&root)).or_insert(root);
        }
    };
    if let Some(snapshot) = snapshot {
        if let Some(last) = snapshot.last_model_path.as_deref() { add(last); }
        if let Some(active) = snapshot.active.as_ref().and_then(|value| value.model_path.as_deref()) { add(active); }
        for open in &snapshot.open_models { if let Some(path) = open.path.as_deref() { add(path); } }
        for recent in &snapshot.recent_models { add(&recent.path); }
    }

    let states: HashMap<String, ProjectManifestState> = roots.iter()
        .map(|(key, root)| (key.clone(), read_project_manifest_state(root)))
        .collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for state in states.values() {
        if let ProjectManifestState::Valid(manifest) = state {
            *counts.entry(stable_project_id(manifest)).or_insert(0) += 1;
        }
    }
    let collisions: HashSet<String> = counts.into_iter()
        .filter_map(|(id, count)| (count > 1).then_some(id))
        .collect();
    roots.into_iter().filter_map(|(key, root)| {
        states.get(&key).map(|state| (key, project_identity_from_state(&root, state, &collisions)))
    }).collect()
}

#[cfg(test)]
fn generate_project_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = format!("{:032x}", u128::from_be_bytes(bytes));
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

#[cfg(test)]
fn write_project_manifest(root: &Path, manifest: &ProjectManifest) -> Result<(), String> {
    if !root.is_dir() { return Err("Project folder is unavailable.".to_string()); }
    let mut bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("Unable to encode Project manifest: {error}"))?;
    bytes.push(b'\n');
    if bytes.len() > PROJECT_MANIFEST_MAX_BYTES as usize {
        return Err("Project manifest exceeds the bounded size.".to_string());
    }
    let path = root.join(PROJECT_MANIFEST_FILE);
    let current = crate::metadata_io::read_metadata_bounded(&path)
        .map_err(|error| format!("Unable to inspect Project manifest: {error}"))?;
    write_project_manifest_bytes_at(&path, &bytes, current.as_deref())
}

#[cfg(test)]
fn write_project_manifest_bytes_at(path: &Path, bytes: &[u8], expected: Option<&[u8]>) -> Result<(), String> {
    crate::metadata_io::replace_metadata_if_unchanged(path, bytes, expected, true)
        .map_err(|error| format!("Unable to replace Project manifest safely: {error}"))
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

fn project_root_for_model(path: &Path) -> Option<PathBuf> {
    if !is_bbmodel_path(path) {
        return None;
    }
    let parent = path.parent()?.to_path_buf();

    for candidate in parent.ancestors().take(4) {
        if candidate.join(PROJECT_MANIFEST_FILE).is_file() {
            return Some(candidate.to_path_buf());
        }
    }

    let conventional = parent
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("models") || value.eq_ignore_ascii_case("model"))
        .unwrap_or(false);
    if conventional {
        parent.parent().map(Path::to_path_buf).or(Some(parent))
    } else {
        Some(parent)
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

pub(crate) fn path(id: &str, profile_id: Option<&str>) -> Result<ProjectPathResult, String> {
    let (projects, models, folders) = navigation_paths(profile_id);
    let path = models.get(id).or_else(|| projects.get(id)).or_else(|| folders.get(id))
        .ok_or_else(|| "Project or model is no longer available.".to_string())?;
    Ok(ProjectPathResult { path: path.display().to_string() })
}


#[cfg(test)]
mod tests {
    use super::*;

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


}
