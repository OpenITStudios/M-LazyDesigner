//! Observed Blockbench Project Navigation snapshot admission.
//! Reads exact bounded per-profile snapshots, verifies generation and
//! freshness, and filters recycled history; never edits the Blockbench
//! process, files, user preferences or Project models.
//! Parent project_navigation.rs owns the one snapshot data schema and
//! public probe/navigation commands. SOURCE_ONLY; TEST_AUTHORED_NOT_RUN.
use super::*;

pub(super) fn valid_profile_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub(super) fn observed_at_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

pub(super) fn project_navigation_snapshot_path(profile_id: Option<&str>) -> Option<PathBuf> {
    let profile_id = profile_id?;
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("LazyDesigner").join("project-navigation").join(format!("{profile_id}.json")))
}

pub(super) fn valid_navigation_generation(value: &str) -> bool {
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

pub(super) fn navigation_snapshot_is_valid(snapshot: &NavigationSnapshot, expected_profile_id: &str) -> bool {
    snapshot.schema == 4
        && valid_navigation_generation(&snapshot.generation)
        && valid_profile_id(&snapshot.profile_id)
        && snapshot.profile_id == expected_profile_id
        && snapshot.open_models.len() <= 64
        && snapshot.recent_models.len() <= 128
}

pub(super) fn read_navigation_snapshot(profile_id: Option<&str>) -> Option<NavigationSnapshot> {
    let path = project_navigation_snapshot_path(profile_id)?;
    let metadata = fs::metadata(&path).ok()?;
    if metadata.len() == 0 || metadata.len() > 512 * 1024 {
        return None;
    }

    let expected_profile_id = profile_id?;
    let snapshot: NavigationSnapshot = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    navigation_snapshot_is_valid(&snapshot, expected_profile_id).then_some(snapshot)
}

pub(super) fn hide_recycled_model_history(snapshot: &mut NavigationSnapshot, recycled_roots: &[String]) {
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

pub(super) fn read_visible_navigation_snapshot(
    profile_id: Option<&str>, recycled_roots: &[String],
) -> Option<NavigationSnapshot> {
    let mut snapshot = read_navigation_snapshot(profile_id)?;
    hide_recycled_model_history(&mut snapshot, recycled_roots);
    Some(snapshot)
}

pub(super) fn navigation_revision_token(snapshot: &NavigationSnapshot) -> String {
    format!("{}:{}:{}", snapshot.profile_id, snapshot.generation, snapshot.revision)
}

const PROJECT_SESSION_LEASE_TTL_MS: u64 = 30_000;

pub(super) fn project_session_fresh(blockbench_running: bool, modified_unix_ms: u64, now_unix_ms: u64) -> bool {
    blockbench_running
        && now_unix_ms.saturating_sub(modified_unix_ms) <= PROJECT_SESSION_LEASE_TTL_MS
}

pub(super) fn live_open_models(snapshot: &NavigationSnapshot, session_live: bool) -> &[NavigationSnapshotOpen] {
    if session_live {
        snapshot.open_models.as_slice()
    } else {
        &[]
    }
}
