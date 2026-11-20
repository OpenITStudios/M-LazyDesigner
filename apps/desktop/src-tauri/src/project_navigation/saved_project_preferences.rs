//! Saved Desktop Project Navigation preferences only (local pinned/registered
//! folder shortcuts, validated metadata writes and safe backup restoration).
//! The primary project_navigation.rs still owns live Blockbench model discovery,
//! Project actions and display projections. No second navigation state.
use super::*;

pub(super) fn empty_navigation_preferences() -> ProjectNavigationPreferences {
    ProjectNavigationPreferences { schema: 1, pinned_project_ids: Vec::new(), registered_project_paths: Vec::new(), recycled_project_paths: Vec::new() }
}

pub(super) fn valid_pinned_project_id(id: &str) -> bool {
    id.strip_prefix("project-")
        .map(|suffix| suffix.len() == 20 && suffix.chars().all(|ch| ch.is_ascii_hexdigit()))
        .unwrap_or(false)
}

pub(super) fn valid_registered_project_path(value: &str) -> bool {
    value.len() <= 4096 && !value.is_empty()
        && Path::new(value).is_absolute()
        && Path::new(value).parent().is_some_and(|parent| parent != Path::new(value))
}
pub(super) fn validate_registered_paths(paths: &[String]) -> bool {
    paths.len() <= MAX_REGISTERED_PROJECTS
        && paths.iter().all(|p| valid_registered_project_path(p))
        && paths.iter().map(|p| navigation_path_key(Path::new(p)))
            .collect::<HashSet<_>>().len() == paths.len()
}
pub(super) fn registered_roots(preferences: &ProjectNavigationPreferences) -> Vec<PathBuf> {
    preferences.registered_project_paths.iter().map(PathBuf::from).collect()
}

pub(super) fn read_navigation_preferences_with_raw_at(path: &Path)
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

pub(super) fn read_navigation_preferences_at(path: &Path) -> Result<Option<ProjectNavigationPreferences>, String> {
    Ok(read_navigation_preferences_with_raw_at(path)?.map(|(value, _)| value))
}

pub(super) fn load_project_navigation_preferences_with_raw() -> Result<(ProjectNavigationPreferences, Option<Vec<u8>>), String> {
    let path = project_navigation_preferences_path()
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
    Ok(match read_navigation_preferences_with_raw_at(&path)? {
        Some((value, raw)) => (value, Some(raw)),
        None => (empty_navigation_preferences(), None),
    })
}

pub(super) fn load_project_navigation_preferences() -> Result<ProjectNavigationPreferences, String> {
    load_project_navigation_preferences_with_raw().map(|(value, _)| value)
}

pub(super) fn write_navigation_preferences_expected_at(
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

pub(super) fn write_navigation_preferences_at(path: &Path, value: &ProjectNavigationPreferences) -> Result<(), String> {
    let previous = read_navigation_preferences_with_raw_at(path)?.map(|(_, raw)| raw);
    write_navigation_preferences_expected_at(path, value, previous.as_deref())
}

pub(super) fn write_project_navigation_preferences(
    value: &ProjectNavigationPreferences, expected: Option<&[u8]>
) -> Result<(), String> {
    let path = project_navigation_preferences_path()
        .ok_or_else(|| "LOCALAPPDATA is unavailable.".to_string())?;
    let parent = path.parent().ok_or_else(|| "Preference directory is invalid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Unable to prepare preferences: {error}"))?;
    write_navigation_preferences_expected_at(&path, value, expected)
}

pub(super) fn preferences_integrity_issue() -> Option<&'static str> {
    let path = project_navigation_preferences_path()?;
    if read_navigation_preferences_at(&path).is_ok() { return None; }
    let backup = crate::metadata_io::recovery_path(&path).ok()?;
    let backup_valid = matches!(read_navigation_preferences_at(&backup), Ok(Some(_)));
    let original_readable = matches!(crate::metadata_io::read_metadata_bounded(&path), Ok(Some(_)));
    Some(if backup_valid && original_readable { "RECOVERABLE" } else { "UNRECOVERABLE" })
}

pub(super) fn restore_project_preferences_at(path: &Path) -> Result<(), String> {
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
