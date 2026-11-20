//! Saved Project manifest identity and safe source-derived project roots.
//! Legacy markers, duplicate manifest IDs and registered folder identities
//! retain their existing refusal/fallback rules. This module does not handle
//! Project Navigation commands, user file pickers, the preference store, model
//! edits, or native window ownership. SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn normalized_project_display_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 128 || trimmed.chars().any(|ch| ch.is_control()) {
        return None;
    }
    Some(trimmed.to_string())
}

pub(super) fn read_project_manifest_state(root: &Path) -> ProjectManifestState {
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

pub(super) fn stable_project_id(manifest: &ProjectManifest) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(manifest.project_uuid.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    format!("project-{}", &digest[..20])
}

pub(super) fn project_identity_from_state(root: &Path, state: &ProjectManifestState, collisions: &HashSet<String>) -> ProjectIdentity {
    if let ProjectManifestState::Valid(manifest) = state {
        let id = stable_project_id(manifest);
        if !collisions.contains(&id) {
            return ProjectIdentity { id, name: manifest.display_name.clone() };
        }
    }
    ProjectIdentity { id: navigation_id("project", root), name: project_name(root) }
}

pub(super) fn project_root_with_registered(path: &Path, registered: &[PathBuf]) -> Option<PathBuf> {
    if !is_bbmodel_path(path) { return None; }
    let key = navigation_path_key(path);
    registered.iter()
        .filter(|root| key.starts_with(&(navigation_path_key(root) + "\\")))
        .max_by_key(|root| navigation_path_key(root).len())
        .cloned()
        .or_else(|| project_root_for_model(path))
}

pub(super) fn project_identity_map(snapshot: Option<&NavigationSnapshot>, registered: &[PathBuf]) -> HashMap<String, ProjectIdentity> {
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
pub(super) fn generate_project_uuid() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = format!("{:032x}", u128::from_be_bytes(bytes));
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

#[cfg(test)]
pub(super) fn write_project_manifest(root: &Path, manifest: &ProjectManifest) -> Result<(), String> {
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
pub(super) fn write_project_manifest_bytes_at(path: &Path, bytes: &[u8], expected: Option<&[u8]>) -> Result<(), String> {
    crate::metadata_io::replace_metadata_if_unchanged(path, bytes, expected, true)
        .map_err(|error| format!("Unable to replace Project manifest safely: {error}"))
}

pub(super) fn project_root_for_model(path: &Path) -> Option<PathBuf> {
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
