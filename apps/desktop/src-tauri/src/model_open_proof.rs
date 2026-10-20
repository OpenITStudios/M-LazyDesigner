//! Read-only, bounded acknowledgment of a model being active in native Blockbench.
//! OS process launch and window focus are NOT evidence of a loaded model.
//! The producer is the existing Blockbench plugin navigation snapshot, now
//! carrying the writer PID. This file never writes to an asset or a user profile.

use serde::Deserialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, System};

const OBSERVE_LIMIT: Duration = Duration::from_secs(4);
const OBSERVE_INTERVAL: Duration = Duration::from_millis(200);
const MAX_SNAPSHOT_BYTES: u64 = 512 * 1024;
const SNAPSHOT_FRESH_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
struct ActiveModel {
    uuid: String,
    model_path: Option<String>,
    saved: bool,
}

#[derive(Debug, Deserialize)]
struct OpenModel {
    uuid: String,
    path: Option<String>,
    active: bool,
}

#[derive(Debug, Deserialize)]
struct ModelSnapshot {
    schema: u8,
    profile_id: String,
    generation: String,
    observed_at_unix_ms: u64,
    producer_pid: Option<u32>,
    active: Option<ActiveModel>,
    open_models: Vec<OpenModel>,
}

fn current_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\")
        .trim_end_matches('\\').to_ascii_lowercase()
}

fn valid_generation(value: &str) -> bool {
    value.len() == 36 && value.chars().enumerate().all(|(index, ch)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            ch == '-'
        } else {
            ch.is_ascii_hexdigit()
        }
    })
}

fn snapshot_confirms_active(
    snapshot: &ModelSnapshot,
    profile_id: &str,
    requested_model: &Path,
    request_at_ms: u64,
    now_ms: u64,
    producer_pid_valid: bool,
) -> bool {
    if snapshot.schema != 4
        || !valid_generation(&snapshot.generation)
        || snapshot.profile_id != profile_id
        || snapshot.producer_pid.is_none()
        || !producer_pid_valid
        || snapshot.observed_at_unix_ms < request_at_ms
        || snapshot.observed_at_unix_ms > now_ms.saturating_add(5_000)
        || now_ms.saturating_sub(snapshot.observed_at_unix_ms) > SNAPSHOT_FRESH_MS
        || snapshot.open_models.len() > 64
    {
        return false;
    }
    let Some(active) = snapshot.active.as_ref() else { return false };
    let Some(active_path) = active.model_path.as_deref() else { return false };
    if !active.saved || active.uuid.is_empty()
        || path_key(Path::new(active_path)) != path_key(requested_model)
    {
        return false;
    }
    snapshot.open_models.iter().any(|opened| {
        opened.active
            && opened.uuid == active.uuid
            && opened.path.as_deref().is_some_and(|path|
                path_key(Path::new(path)) == path_key(requested_model)
            )
    })
}

fn same_editor_executable(actual: &Path, selected: &Path) -> bool {
    path_key(actual) == path_key(selected)
}

fn verified_native_producer(system: &System, pid: u32, selected_executable: &Path) -> bool {
    let Some(process) = system.process(Pid::from_u32(pid)) else {
        return false;
    };
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    (name == "blockbench.exe" || name == "blockbench")
        && process.exe().is_some_and(|path|
            path.is_file()
                && crate::blockbench::is_executable_name(path)
                && same_editor_executable(path, selected_executable)
        )
}

fn read_snapshot(path: &Path) -> Option<(ModelSnapshot, u64)> {
    // Never trust an arbitrary symlink or unlimited JSON as a model receipt.
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0
        || metadata.len() > MAX_SNAPSHOT_BYTES
    {
        return None;
    }
    let modified = metadata.modified().ok()?;
    let modified_ms = modified.duration_since(UNIX_EPOCH).ok()?
        .as_millis().min(u64::MAX as u128) as u64;
    let data = fs::read(path).ok()?;
    if data.len() as u64 > MAX_SNAPSHOT_BYTES { return None; }
    let snapshot = serde_json::from_slice::<ModelSnapshot>(&data).ok()?;
    Some((snapshot, modified_ms))
}

/// Called only after an explicit user Open request has successfully launched.
/// Returns false on missing plugin, offline editor, ambiguous/stale evidence,
/// unsaved model or timeout. No extra process, daemon, or write is introduced.
pub(crate) fn observe_active_model(
    model: &Path,
    user_data: &Path,
    selected_executable: &Path,
    request_at_ms: u64,
) -> bool {
    let Some(base) = env::var_os("LOCALAPPDATA") else { return false };
    let profile_id = crate::system_status::navigation_profile_id(user_data);
    let snapshot_path = PathBuf::from(base).join("LazyDesigner")
        .join("project-navigation").join(format!("{profile_id}.json"));
    let start = Instant::now();
    loop {
        let now = current_ms();
        if let Some((snapshot, modified_at)) = read_snapshot(&snapshot_path) {
            if now.saturating_sub(modified_at) <= SNAPSHOT_FRESH_MS
                && modified_at <= now.saturating_add(5_000)
                && snapshot.producer_pid.is_some()
            {
                // Do not infer a running editor from a stale file alone.
                let system = crate::process::process_snapshot();
                if snapshot_confirms_active(
                    &snapshot, &profile_id, model, request_at_ms, now,
                    verified_native_producer(&system, snapshot.producer_pid.unwrap_or(0), selected_executable),
                ) {
                    return true;
                }
            }
        }
        if start.elapsed() >= OBSERVE_LIMIT { return false; }
        thread::sleep(OBSERVE_INTERVAL);
    }
}

pub(crate) fn launch_receipt(
    model: &Path, user_data: &Path, selected_executable: &Path, request_at_ms: u64,
) -> &'static str {
    if observe_active_model(model, user_data, selected_executable, request_at_ms) {
        "CONFIRMED_ACTIVE"
    } else {
        "LAUNCHED_UNVERIFIED"
    }
}

pub(crate) fn timestamp_before_launch() -> u64 {
    current_ms()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> ModelSnapshot {
        ModelSnapshot {
            schema: 4,
            profile_id: "a".repeat(32),
            generation: "11111111-1111-4111-8111-111111111111".to_string(),
            observed_at_unix_ms: 100_500,
            producer_pid: Some(1234),
            active: Some(ActiveModel {
                uuid: "model-uuid".to_string(),
                model_path: Some("C:/Projects/Models/Chair.bbmodel".to_string()),
                saved: true,
            }),
            open_models: vec![OpenModel {
                uuid: "model-uuid".to_string(),
                path: Some("c:\\projects\\models\\chair.bbmodel".to_string()),
                active: true,
            }],
        }
    }

    fn check(snapshot: &ModelSnapshot) -> bool {
        snapshot_confirms_active(snapshot, &"a".repeat(32),
            Path::new("C:/Projects/Models/Chair.bbmodel"), 100_000, 100_900, true)
    }

    #[test]
    fn confirms_only_consistent_active_native_model_evidence() {
        assert!(check(&fixture()));
        let mut value = fixture();
        value.active.as_mut().unwrap().model_path = Some("C:/Other/Chair.bbmodel".into());
        assert!(!check(&value));
        let mut value = fixture();
        value.open_models[0].uuid = "different".into();
        assert!(!check(&value));
        let mut value = fixture();
        value.open_models[0].active = false;
        assert!(!check(&value));
        let mut value = fixture();
        value.active.as_mut().unwrap().saved = false;
        assert!(!check(&value));
    }

    #[test]
    fn refuses_stale_foreign_or_untrusted_receipts() {
        let mut value = fixture();
        value.observed_at_unix_ms = 99_000;
        assert!(!check(&value));
        let mut value = fixture();
        value.profile_id = "b".repeat(32);
        assert!(!check(&value));
        let mut value = fixture();
        value.producer_pid = None; // legacy navigation snapshot cannot prove native PID
        assert!(!check(&value));
        let mut value = fixture();
        value.generation = "bad".into();
        assert!(!check(&value));
        let mut value = fixture();
        value.schema = 5;
        assert!(!check(&value));
        assert!(!snapshot_confirms_active(&fixture(), &"a".repeat(32),
            Path::new("C:/Projects/Models/Chair.bbmodel"), 100_000, 100_900, false));
    }

    #[test]
    fn native_producer_must_match_the_selected_installation_path() {
        assert!(same_editor_executable(
            Path::new("C:/Program Files/Blockbench/Blockbench.exe"),
            Path::new("c:\\program files\\blockbench\\blockbench.exe")
        ));
        assert!(!same_editor_executable(
            Path::new("C:/Program Files/Blockbench/Blockbench.exe"),
            Path::new("D:/Other/Blockbench.exe")
        ));
    }

    #[test]
    fn rejects_false_positive_from_paths_with_same_filename() {
        assert_ne!(path_key(Path::new("C:/One/Model.bbmodel")),
            path_key(Path::new("D:/Two/Model.bbmodel")));
        assert_eq!(path_key(Path::new("C:/One/Model.bbmodel")),
            path_key(Path::new("c:\\one\\model.bbmodel")));
    }
}
