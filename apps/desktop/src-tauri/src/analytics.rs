//! Read-only Desktop projection over the existing Gateway L0 JSON snapshots.
//! No Bun, manager invocation, Runtime polling, database or analytics ledger.
use crate::desktop_error::DesktopError;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs, io::Read, path::{Path, PathBuf},
};

const MAX_FILE_BYTES: u64 = 128 * 1024;
const MAX_FILES: usize = 16;
// 16 snapshots cannot overflow either Rust u64 totals or JS safe integers.
const MAX_COUNT: u64 = 1_000_000_000_000;

#[derive(Debug, Deserialize)]
struct ToolCounts {
    status: u64,
    search_capabilities: u64,
    describe_capability: u64,
    invoke_capability: u64,
}
impl ToolCounts {
    fn sum(&self) -> Option<u64> {
        self.status.checked_add(self.search_capabilities)?
            .checked_add(self.describe_capability)?
            .checked_add(self.invoke_capability)
    }
}
#[derive(Debug, Deserialize)]
struct Counts {
    calls: u64,
    failures: u64,
    duration_sum_ms: u64,
    by_tool: ToolCounts,
    capabilities: BTreeMap<String, u64>,
    error_codes: BTreeMap<String, u64>,
    verification_required: u64,
    acceptance_gate_invalidations: u64,
    downstream_recheck_requests: u64,
    user_delta_status_observations: u64,
}
#[derive(Debug, Deserialize)]
struct DomainCounts {
    calls: u64,
    failures: u64,
    duration_sum_ms: u64,
    verification_required: u64,
}
#[derive(Debug, Deserialize)]
struct BuildCounts {
    calls: u64,
    failures: u64,
    duration_sum_ms: u64,
}
#[derive(Debug, Deserialize)]
struct Project {
    project_key: String,
    identity_scope: String,
    counters: Counts,
    by_domain: BTreeMap<String, DomainCounts>,
    #[serde(default)]
    observed_runtime_build_calls: Option<BTreeMap<String, BuildCounts>>,
    #[serde(default)]
    runtime_build_unattributed_calls: Option<u64>,
    #[serde(default)]
    runtime_build_call_counts_capped: Option<bool>,
}
#[derive(Debug, Deserialize)]
struct Retention {
    max_session_files: usize,
    max_snapshot_bytes: u64,
    max_projects_per_session: usize,
    checkpoint_every_calls: u64,
}
#[derive(Debug, Deserialize)]
struct Snapshot {
    schema: String,
    session_id: String,
    state: String,
    capture_scope: String,
    observed_calls: u64,
    unbound: Counts,
    projects: Vec<Project>,
    dropped_project_observations: u64,
    capture_failures: u64,
    persist_failures: u64,
    retention: Retention,
}

#[derive(Debug, Clone, Serialize)]
pub struct Metric {
    pub calls: u64,
    pub failures: u64,
    pub duration_sum_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub calls: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectOverview {
    pub project_key: String,
    pub observed_sessions: u64,
    pub observed_calls: u64,
    pub failures: u64,
    pub duration_sum_ms: u64,
    pub domains: BTreeMap<String, Metric>,
    pub capabilities: Vec<NamedCount>,
    pub error_codes: Vec<NamedCount>,
    pub by_tool: BTreeMap<String, u64>,
    pub build_calls: BTreeMap<String, Metric>,
    pub build_unattributed_calls: Option<u64>,
    pub build_measured_sessions: u64,
    pub build_overflow: bool,
}

impl ProjectOverview {
    fn new(key: String) -> Self {
        Self {
            project_key: key,
            observed_sessions: 0,
            observed_calls: 0,
            failures: 0,
            duration_sum_ms: 0,
            domains: BTreeMap::new(),
            capabilities: Vec::new(),
            error_codes: Vec::new(),
            by_tool: BTreeMap::new(),
            build_calls: BTreeMap::new(),
            build_unattributed_calls: None,
            build_measured_sessions: 0,
            build_overflow: false,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AnalyticsOverview {
    pub schema: u8,
    pub report: &'static str,
    pub source: &'static str,
    pub state: &'static str,
    pub observed_sessions: usize,
    pub observed_calls: u64,
    pub failures: u64,
    pub unbound_calls: u64,
    pub open_or_unclean_sessions: usize,
    pub invalid_snapshots: usize,
    pub older_snapshots_omitted: usize,
    pub capture_failures: u64,
    pub persist_failures: u64,
    pub overflow_project_observations: u64,
    pub projects: Vec<ProjectOverview>,
    pub limits: AnalyticsLimits,
}
#[derive(Debug, Serialize)]
pub struct AnalyticsLimits {
    pub retrospective_scope: &'static str,
    pub project_identity: &'static str,
    pub duration: &'static str,
    pub source_sha: Option<String>,
    pub provider_tokens: Option<u64>,
    pub accepted_quality: &'static str,
    pub build_coverage: &'static str,
}

impl AnalyticsOverview {
    fn empty() -> Self {
        Self {
            schema: 1,
            report: "desktop-analytics-overview",
            source: "GATEWAY_L0_BOUNDED_SNAPSHOTS",
            state: "NO_DATA",
            observed_sessions: 0,
            observed_calls: 0,
            failures: 0,
            unbound_calls: 0,
            open_or_unclean_sessions: 0,
            invalid_snapshots: 0,
            older_snapshots_omitted: 0,
            capture_failures: 0,
            persist_failures: 0,
            overflow_project_observations: 0,
            projects: Vec::new(),
            limits: AnalyticsLimits {
                retrospective_scope: "RECENT_LOCAL_SESSIONS_ONLY",
                project_identity: "VERIFIED_NATIVE_UUID_HASH_NOT_WORKSPACE_ID",
                duration: "SUM_OF_CALL_DURATIONS_NOT_PROJECT_WALL_TIME",
                source_sha: None,
                provider_tokens: None,
                accepted_quality: "UNVERIFIED",
                build_coverage: "RECORDED_VERIFIED_CALLS_ONLY_UNKNOWN_AND_LEGACY_SEPARATE",
            },
        }
    }
}

fn is_hex_lower(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn owned_session_file(name: &str) -> bool {
    if !name.starts_with("session-") || !name.ends_with(".json") {
        return false;
    }
    let middle = &name[8..name.len() - 5];
    match middle.split_once('-') {
        Some((time, uuid)) => time.len() == 13
            && time.bytes().all(|c| c.is_ascii_digit())
            && is_hex_lower(uuid, 16),
        None => false,
    }
}

fn valid_counts(counts: &Counts) -> bool {
    let category = |name: &str, upper_only: bool| {
        !name.is_empty() && name.len() <= 96 &&
        name.bytes().all(|b| {
            b.is_ascii_alphanumeric() || (!upper_only && b"_.:-".contains(&b)) ||
            (upper_only && b == b'_')
        }) && (!upper_only || name.bytes().all(|b| !b.is_ascii_lowercase()))
    };
    counts.calls <= MAX_COUNT &&
    counts.failures <= counts.calls &&
    counts.verification_required <= counts.calls &&
    counts.acceptance_gate_invalidations <= counts.calls &&
    counts.user_delta_status_observations <= counts.calls &&
    counts.duration_sum_ms <= MAX_COUNT &&
    counts.by_tool.sum() == Some(counts.calls) &&
    counts.capabilities.len() <= 25 &&
    counts.error_codes.len() <= 13 &&
    counts.capabilities.iter().all(|(key, val)| category(key, false) && *val <= counts.calls) &&
    counts.error_codes.iter().all(|(key, val)| category(key, true) && *val <= counts.calls) &&
    counts.capabilities.values().copied().sum::<u64>() <= counts.by_tool.invoke_capability &&
    counts.error_codes.values().copied().sum::<u64>() <= counts.failures
}

fn parse_snapshot(bytes: &[u8]) -> Option<Snapshot> {
    let item = serde_json::from_slice::<Snapshot>(bytes).ok()?;
    if item.schema != "lazydesigner-project-observation-v1" ||
        item.capture_scope != "RECENT_BOUNDED_GATEWAY_L0" ||
        !is_hex_lower(&item.session_id, 16) ||
        (item.state != "OPEN" && item.state != "CLOSED") ||
        item.projects.len() > 12 ||
        item.retention.max_session_files != 16 ||
        item.retention.max_snapshot_bytes != MAX_FILE_BYTES ||
        item.retention.max_projects_per_session != 12 ||
        item.retention.checkpoint_every_calls != 64 ||
        !valid_counts(&item.unbound) {
        return None;
    }
    let mut attributed = item.unbound.calls;
    let mut identities = HashSet::new();
    for project in &item.projects {
        if !is_hex_lower(&project.project_key, 64) ||
            project.identity_scope != "VERIFIED_NATIVE_UUID_ONLY" ||
            !identities.insert(&project.project_key) ||
            !valid_counts(&project.counters) {
            return None;
        }
        attributed = attributed.checked_add(project.counters.calls)?;
        let mut domain_total = 0u64;
        let mut domain_duration = 0u64;
        for (stage, counts) in &project.by_domain {
            if !["CORE", "GEOMETRY", "TEXTURING", "ANIMATION"].contains(&stage.as_str()) ||
                counts.failures > counts.calls ||
                counts.verification_required > counts.calls ||
                counts.duration_sum_ms > project.counters.duration_sum_ms {
                return None;
            }
            domain_total = domain_total.checked_add(counts.calls)?;
            domain_duration = domain_duration.checked_add(counts.duration_sum_ms)?;
        }
        if domain_total > project.counters.calls ||
            domain_duration > project.counters.duration_sum_ms {
            return None;
        }
        if let Some(ref by_build) = project.observed_runtime_build_calls {
            if by_build.len() > 9 || project.runtime_build_call_counts_capped.is_none() {
                return None;
            }
            let unknown = project.runtime_build_unattributed_calls?;
            let mut recorded = unknown;
            let mut duration = 0u64;
            for (key, value) in by_build {
                if (key != "OTHER" && !is_hex_lower(key, 64)) ||
                    value.failures > value.calls ||
                    value.duration_sum_ms > project.counters.duration_sum_ms {
                    return None;
                }
                recorded = recorded.checked_add(value.calls)?;
                duration = duration.checked_add(value.duration_sum_ms)?;
            }
            if recorded != project.counters.calls ||
                duration > project.counters.duration_sum_ms {
                return None;
            }
        }
    }
    if attributed != item.observed_calls || item.observed_calls > MAX_COUNT ||
        item.capture_failures > MAX_COUNT || item.persist_failures > MAX_COUNT ||
        item.dropped_project_observations > MAX_COUNT {
        return None;
    }
    Some(item)
}

fn count_named(values: &mut Vec<NamedCount>, label: &str, count: u64) {
    if let Some(entry) = values.iter_mut().find(|row| row.name == label) {
        entry.calls += count;
    } else {
        values.push(NamedCount { name: label.to_owned(), calls: count });
    }
}

fn merge_snapshot(
    report: &mut AnalyticsOverview,
    projects: &mut BTreeMap<String, ProjectOverview>,
    snapshot: Snapshot,
) {
    report.observed_sessions += 1;
    report.observed_calls += snapshot.observed_calls;
    report.unbound_calls += snapshot.unbound.calls;
    report.failures += snapshot.unbound.failures;
    report.capture_failures += snapshot.capture_failures;
    report.persist_failures += snapshot.persist_failures;
    report.overflow_project_observations += snapshot.dropped_project_observations;
    if snapshot.state == "OPEN" {
        report.open_or_unclean_sessions += 1;
    }
    for item in snapshot.projects {
        let target = projects.entry(item.project_key.clone())
            .or_insert_with(|| ProjectOverview::new(item.project_key));
        target.observed_sessions += 1;
        target.observed_calls += item.counters.calls;
        target.failures += item.counters.failures;
        target.duration_sum_ms += item.counters.duration_sum_ms;
        report.failures += item.counters.failures;
        for (key, counts) in item.by_domain {
            let row = target.domains.entry(key).or_insert(Metric {
                calls: 0, failures: 0, duration_sum_ms: 0,
            });
            row.calls += counts.calls;
            row.failures += counts.failures;
            row.duration_sum_ms += counts.duration_sum_ms;
        }
        for (name, calls) in item.counters.capabilities {
            count_named(&mut target.capabilities, &name, calls);
        }
        for (name, calls) in item.counters.error_codes {
            count_named(&mut target.error_codes, &name, calls);
        }
        for (name, calls) in [
            ("status", item.counters.by_tool.status),
            ("search_capabilities", item.counters.by_tool.search_capabilities),
            ("describe_capability", item.counters.by_tool.describe_capability),
            ("invoke_capability", item.counters.by_tool.invoke_capability),
        ] {
            *target.by_tool.entry(name.to_string()).or_default() += calls;
        }
        if let Some(by_build) = item.observed_runtime_build_calls {
            target.build_measured_sessions += 1;
            target.build_unattributed_calls = Some(
                target.build_unattributed_calls.unwrap_or(0) +
                item.runtime_build_unattributed_calls.unwrap_or(0)
            );
            target.build_overflow |= item.runtime_build_call_counts_capped.unwrap_or(false);
            for (key, counts) in by_build {
                let row = target.build_calls.entry(key).or_insert(Metric {
                    calls: 0, failures: 0, duration_sum_ms: 0,
                });
                row.calls += counts.calls;
                row.failures += counts.failures;
                row.duration_sum_ms += counts.duration_sum_ms;
            }
        }
    }
}

fn read_from_directory(directory: &Path) -> Result<AnalyticsOverview, String> {
    let mut summary = AnalyticsOverview::empty();
    if let Ok(metadata) = fs::symlink_metadata(directory) {
        if !metadata.file_type().is_dir() {
            return Err("Analytics cache must be a regular local directory.".to_string());
        }
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(summary),
        Err(_) => return Err("Unable to read the local Analytics cache.".to_string()),
    };
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|_| "Unable to enumerate Analytics files.")?;
        if let Some(name) = entry.file_name().to_str() {
            if owned_session_file(name) {
                names.push(name.to_owned());
            }
        }
    }
    names.sort();
    summary.older_snapshots_omitted = names.len().saturating_sub(MAX_FILES);
    let mut groups = BTreeMap::new();
    let mut session_ids = HashSet::new();
    for name in names.into_iter().rev().take(MAX_FILES) {
        let path = directory.join(&name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => { summary.invalid_snapshots += 1; continue; }
        };
        if !metadata.file_type().is_file() || metadata.len() == 0 ||
            metadata.len() > MAX_FILE_BYTES {
            summary.invalid_snapshots += 1;
            continue;
        }
        // Reading is bounded even if another process changes the file
        // after the initial metadata check.
        let bytes = match fs::File::open(&path).and_then(|file| {
            let mut bytes = Vec::with_capacity(metadata.len() as usize);
            file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
            Ok(bytes)
        }) {
            Ok(bytes) if !bytes.is_empty() && bytes.len() as u64 <= MAX_FILE_BYTES => bytes,
            _ => { summary.invalid_snapshots += 1; continue; }
        };
        if let Some(snapshot) = parse_snapshot(&bytes) {
            let expected_name = format!("session-{}-{}.json", &name[8..21], snapshot.session_id);
            if name != expected_name || !session_ids.insert(snapshot.session_id.clone()) {
                summary.invalid_snapshots += 1;
                continue;
            }
            merge_snapshot(&mut summary, &mut groups, snapshot);
        } else {
            summary.invalid_snapshots += 1;
        }
    }
    summary.projects = groups.into_values().collect();
    for project in &mut summary.projects {
        project.capabilities.sort_by(|a, b| b.calls.cmp(&a.calls).then(a.name.cmp(&b.name)));
        project.error_codes.sort_by(|a, b| b.calls.cmp(&a.calls).then(a.name.cmp(&b.name)));
    }
    summary.projects.sort_by(|a, b|
        b.observed_calls.cmp(&a.observed_calls).then(a.project_key.cmp(&b.project_key)));
    summary.state = if summary.observed_sessions == 0 && summary.invalid_snapshots == 0 {
        "NO_DATA"
    } else if summary.invalid_snapshots != 0 ||
        summary.older_snapshots_omitted != 0 ||
        summary.open_or_unclean_sessions != 0 ||
        summary.capture_failures != 0 ||
        summary.persist_failures != 0 ||
        summary.overflow_project_observations != 0 {
        "PARTIAL"
    } else {
        "RECORDED"
    };
    Ok(summary)
}

fn default_cache_directory() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .filter(|root| root.is_absolute())
            .map(|root| root.join("LazyDesigner").join("analytics"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let root = std::env::var_os("XDG_STATE_HOME").map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home|
                PathBuf::from(home).join(".local").join("state")));
        root.map(|path| path.join("LazyDesigner").join("analytics"))
    }
}

pub fn overview() -> Result<AnalyticsOverview, DesktopError> {
    let directory = default_cache_directory().ok_or_else(|| DesktopError::recoverable(
        "ANALYTICS_PATH_UNAVAILABLE", "Local Analytics storage is unavailable.".to_owned()
    ))?;
    read_from_directory(&directory).map_err(|message|
        DesktopError::recoverable("ANALYTICS_READ_FAILED", message)
    )
}

#[derive(Debug, Serialize)]
pub struct AnalyticsExportResult {
    pub status: &'static str,
}

pub fn export() -> Result<AnalyticsExportResult, DesktopError> {
    let report = overview()?;
    let destination = FileDialog::new()
        .set_file_name("lazydesigner-analytics.json")
        .add_filter("JSON", &["json"])
        .save_file();
    let Some(path) = destination else {
        return Ok(AnalyticsExportResult { status: "CANCELLED" });
    };
    let bytes = serde_json::to_vec_pretty(&report).map_err(|_|
        DesktopError::terminal("ANALYTICS_SERIALIZE_FAILED", "Cannot serialize Analytics.")
    )?;
    fs::write(&path, bytes).map_err(|_|
        DesktopError::recoverable("ANALYTICS_EXPORT_FAILED",
            "Unable to save the selected Analytics file.".to_owned())
    )?;
    Ok(AnalyticsExportResult { status: "EXPORTED" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(uuid: &str, calls: u64) -> serde_json::Value {
        json!({
            "schema": "lazydesigner-project-observation-v1",
            "session_id": "abcdef1234567890",
            "state": "CLOSED",
            "capture_scope": "RECENT_BOUNDED_GATEWAY_L0",
            "observed_calls": calls + 1,
            "unbound": {
                "calls": 1, "failures": 0, "duration_sum_ms": 3,
                "max_duration_ms": 3,
                "by_tool": {"status": 1, "search_capabilities": 0,
                    "describe_capability": 0, "invoke_capability": 0},
                "capabilities": {}, "error_codes": {},
                "verification_required": 0, "acceptance_gate_invalidations": 0,
                "downstream_recheck_requests": 0, "user_delta_status_observations": 0
            },
            "projects": [{
                "project_key": uuid,
                "identity_scope": "VERIFIED_NATIVE_UUID_ONLY",
                "counters": {
                    "calls": calls, "failures": 0,
                    "duration_sum_ms": calls * 8, "max_duration_ms": 8,
                    "by_tool": {"status": 0, "search_capabilities": 0,
                        "describe_capability": 0, "invoke_capability": calls},
                    "capabilities": {"manage_cubes": calls}, "error_codes": {},
                    "verification_required": 1, "acceptance_gate_invalidations": 0,
                    "downstream_recheck_requests": 0, "user_delta_status_observations": 0
                },
                "by_domain": {"GEOMETRY": {
                    "calls": calls, "failures": 0, "duration_sum_ms": calls * 8,
                    "verification_required": 1
                }}
            }],
            "dropped_project_observations": 0, "capture_failures": 0,
            "persist_failures": 0,
            "retention": {"max_session_files": 16, "max_snapshot_bytes": 131072,
                "max_projects_per_session": 12, "checkpoint_every_calls": 64}
        })
    }

    #[test]
    fn validates_canonical_l0_and_refuses_inconsistent_totals() {
        let p = "a".repeat(64);
        let mut record = sample(&p, 2);
        assert!(parse_snapshot(record.to_string().as_bytes()).is_some());
        record["observed_calls"] = json!(100);
        assert!(parse_snapshot(record.to_string().as_bytes()).is_none());
        record["observed_calls"] = json!(3);
        record["projects"][0]["identity_scope"] = json!("UNVERIFIED");
        assert!(parse_snapshot(record.to_string().as_bytes()).is_none());
    }

    #[test]
    fn aggregates_only_separate_native_identities_and_source_metrics() {
        let mut summary = AnalyticsOverview::empty();
        let mut groups = BTreeMap::new();
        merge_snapshot(&mut summary, &mut groups,
            parse_snapshot(sample(&"a".repeat(64), 2).to_string().as_bytes()).unwrap());
        merge_snapshot(&mut summary, &mut groups,
            parse_snapshot(sample(&"b".repeat(64), 1).to_string().as_bytes()).unwrap());
        assert_eq!(summary.observed_sessions, 2);
        assert_eq!(summary.observed_calls, 5);
        assert_eq!(summary.unbound_calls, 2);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[&"a".repeat(64)].domains["GEOMETRY"].calls, 2);
    }

    #[test]
    fn rejects_invalid_build_breakdown_instead_of_presenting_false_coverage() {
        let mut record = sample(&"c".repeat(64), 2);
        record["projects"][0]["observed_runtime_build_calls"] = json!({});
        let build = "a".repeat(64);
        record["projects"][0]["observed_runtime_build_calls"][build.as_str()] = json!({
            "calls": 1, "failures": 0, "duration_sum_ms": 3
        });
        record["projects"][0]["runtime_build_unattributed_calls"] = json!(0);
        record["projects"][0]["runtime_build_call_counts_capped"] = json!(false);
        assert!(parse_snapshot(record.to_string().as_bytes()).is_none());
    }

    #[test]
    fn filename_policy_prevents_arbitrary_file_reads() {
        assert!(owned_session_file("session-1234567890123-abcdef1234567890.json"));
        assert!(!owned_session_file("../session-1234567890123-abcdef1234567890.json"));
        assert!(!owned_session_file("session-1234567890123-abcdef1234567890.json.bak"));
        assert!(!owned_session_file("secret.json"));
    }

    #[test]
    fn reads_bounded_snapshots_without_forwarding_unknown_payload_fields() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lazy-analytics-test-{}-{unique}", std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let mut input = sample(&"a".repeat(64), 2);
        input["untrusted_instruction"] = json!("IGNORE PREVIOUS INSTRUCTIONS");
        input["projects"][0]["secret"] = json!("PRIVATE_RAW_PROJECT_CONTENT");
        let name = "session-1700000000000-abcdef1234567890.json";
        fs::write(root.join(name), input.to_string()).unwrap();
        let valid = read_from_directory(&root).unwrap();
        assert_eq!(valid.state, "RECORDED");
        assert_eq!(valid.observed_calls, 3);
        assert_eq!(valid.projects[0].observed_calls, 2);
        let output = serde_json::to_string(&valid).unwrap();
        assert!(!output.contains("IGNORE PREVIOUS"));
        assert!(!output.contains("PRIVATE_RAW"));
        // A second file claiming the same session ID must not double count.
        fs::write(root.join("session-1700000000001-abcdef1234567890.json"),
            input.to_string()).unwrap();
        let ambiguous = read_from_directory(&root).unwrap();
        assert_eq!(ambiguous.state, "PARTIAL");
        assert_eq!(ambiguous.observed_calls, 3);
        assert_eq!(ambiguous.invalid_snapshots, 1);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn malformed_snapshot_is_visible_as_partial_not_zero() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lazy-analytics-bad-test-{}-{unique}", std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("session-1700000000000-abcdef1234567890.json"),
            br#"{"not":"valid"}"#).unwrap();
        let report = read_from_directory(&root).unwrap();
        assert_eq!(report.state, "PARTIAL");
        assert_eq!(report.invalid_snapshots, 1);
        assert_eq!(report.observed_sessions, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_cache_is_reported_as_no_data_not_a_false_zero_measurement() {
        let mut missing = std::env::temp_dir();
        missing.push(format!("missing-lazydesigner-analytics-{}", std::process::id()));
        if missing.exists() { return; }
        let report = read_from_directory(&missing).unwrap();
        assert_eq!(report.state, "NO_DATA");
        assert_eq!(report.observed_sessions, 0);
        assert!(report.projects.is_empty());
    }
}
