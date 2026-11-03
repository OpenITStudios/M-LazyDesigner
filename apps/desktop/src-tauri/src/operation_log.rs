use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LOG_BYTES: u64 = 512 * 1024;
const MAX_LOG_READ_BYTES: u64 = MAX_LOG_BYTES + 512;

/// Read-only, recent Desktop metadata. This does not cover Gateway, AI or full history.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
pub struct DesktopActivitySummary {
    pub scope: &'static str,
    pub coverage: &'static str,
    pub observed_entries: u64,
    pub error_outcomes: u64,
    pub latest_timestamp_ms: Option<u128>,
}

impl DesktopActivitySummary {
    fn empty(coverage: &'static str) -> Self {
        Self {
            scope: "DESKTOP_OPERATIONS_ONLY",
            coverage,
            observed_entries: 0,
            error_outcomes: 0,
            latest_timestamp_ms: None,
        }
    }

    fn ingest(&mut self, contents: &str) {
        for line in contents.lines() {
            let mut fields = line.split_ascii_whitespace();
            let (Some(timestamp), Some(_event), Some(outcome), None) =
                (fields.next(), fields.next(), fields.next(), fields.next())
            else { continue; };
            let Ok(timestamp) = timestamp.parse::<u128>() else { continue; };
            // Do not export event names, private paths, identities or raw text.
            self.observed_entries += 1;
            if outcome.eq_ignore_ascii_case("error") ||
                outcome.eq_ignore_ascii_case("failed") ||
                outcome.eq_ignore_ascii_case("fail") {
                self.error_outcomes += 1;
            }
            self.latest_timestamp_ms = Some(
                self.latest_timestamp_ms.map_or(timestamp, |prev| prev.max(timestamp))
            );
        }
    }
}

/// Only executes when the user explicitly exports diagnostics.
pub fn recent_summary() -> DesktopActivitySummary {
    let Some(directory) = log_dir() else {
        return DesktopActivitySummary::empty("UNAVAILABLE");
    };
    let mut summary = DesktopActivitySummary::empty("NO_LOG");
    let mut saw_log = false;
    let mut partial = false;
    for name in ["desktop.log.1", "desktop.log"] {
        let path = directory.join(name);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                saw_log = true;
                if !metadata.file_type().is_file() ||
                   metadata.len() > MAX_LOG_READ_BYTES {
                    partial = true;
                    continue;
                }
                match fs::read_to_string(&path) {
                    Ok(contents) => summary.ingest(&contents),
                    Err(_) => partial = true,
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => partial = true,
        }
    }
    summary.coverage = if partial { "PARTIAL" }
        else if saw_log { "RECENT_ROTATING_LOG_WINDOW" }
        else { "NO_LOG" };
    summary
}

fn log_dir() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("LazyDesigner").join("logs"))
}

fn clean_token(value: &str) -> String {
    value
        .chars()
        .take(64)
        .map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':') { ch } else { '_' })
        .collect()
}

pub fn record(event: &str, outcome: &str) {
    let Some(dir) = log_dir() else { return; };
    if fs::create_dir_all(&dir).is_err() { return; }

    let path = dir.join("desktop.log");
    if fs::metadata(&path).map(|meta| meta.len() >= MAX_LOG_BYTES).unwrap_or(false) {
        let rotated = dir.join("desktop.log.1");
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(&path, &rotated);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{} {} {}",
            timestamp,
            clean_token(event),
            clean_token(outcome)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_tokens_are_bounded_and_plain() {
        let value = clean_token("managed:update\nsecret=value");
        assert_eq!(value, "managed:update_secret_value");
        assert!(value.len() <= 64);
    }

    #[test]
    fn exported_summary_counts_only_bounded_metadata() {
        let mut summary = DesktopActivitySummary::empty("RECENT_ROTATING_LOG_WINDOW");
        summary.ingest("1700000000000 managed:update OK\n1700000000100 ensure_ready ERROR\n1700000000200 project:recycle CANCELLED\ninvalid private/path BAD\n");
        assert_eq!(summary.observed_entries, 3);
        assert_eq!(summary.error_outcomes, 1);
        assert_eq!(summary.latest_timestamp_ms, Some(1700000000200));
        assert_eq!(summary.scope, "DESKTOP_OPERATIONS_ONLY");
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains("managed:update"));
        assert!(!serialized.contains("private/path"));
        assert!(!serialized.contains("ensure_ready"));
    }

    #[test]
    fn absent_log_does_not_establish_full_session() {
        let summary = DesktopActivitySummary::empty("NO_LOG");
        assert_eq!(summary.observed_entries, 0);
        assert_eq!(summary.coverage, "NO_LOG");
    }
}
