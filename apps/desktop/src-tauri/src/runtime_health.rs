use serde::Deserialize;
use std::{
    fs,
    path::Path,
    time::SystemTime,
};
use sysinfo::{Pid, System};

pub(crate) const RUNTIME_SESSION_LEASE_TTL_MS: u64 = 15_000;

#[derive(Debug, Deserialize)]
struct RuntimeSessionLease {
    schema: u8,
    product_id: String,
    build_identity: String,
    profile_id: String,
    producer_pid: u32,
    instance_id: String,
    runtime_url: String,
    started_at_unix_ms: u64,
}

#[derive(Debug)]
pub(crate) struct RuntimeSessionProbe {
    pub(crate) live: bool,
    pub(crate) runtime_url: Option<String>,
    pub(crate) build_identity: Option<String>,
    pub(crate) started_at_unix_ms: Option<u64>,
}

impl RuntimeSessionProbe {
    fn absent() -> Self {
        Self { live: false, runtime_url: None, build_identity: None, started_at_unix_ms: None }
    }
}

fn valid_profile_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn valid_generation(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, ch)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                ch == '-'
            } else {
                ch.is_ascii_hexdigit()
            }
        })
}

pub(crate) fn endpoint_identity(value: &str) -> Option<(u16, String)> {
    if value.len() > 512 || value.chars().any(|ch| matches!(ch, '\r' | '\n' | '\t')) {
        return None;
    }
    let suffix = value
        .strip_prefix("https://127.0.0.1")
        .or_else(|| value.strip_prefix("https://localhost"))
        .or_else(|| value.strip_prefix("https://[::1]"))?;

    let (port, path) = if let Some(rest) = suffix.strip_prefix(':') {
        let (raw_port, path) = match rest.split_once('/') {
            Some((raw_port, path)) => (raw_port, format!("/{path}")),
            None => (rest, "/".to_string()),
        };
        let port = raw_port.parse::<u16>().ok()?;
        if port == 0 {
            return None;
        }
        (port, path)
    } else if suffix.is_empty() {
        (443, "/".to_string())
    } else if suffix.starts_with('/') {
        (443, suffix.to_string())
    } else {
        return None;
    };

    let normalized_path = if path.len() > 1 {
        path.trim_end_matches('/').to_string()
    } else {
        path
    };
    if normalized_path.is_empty() || normalized_path.chars().any(|ch| matches!(ch, '?' | '#')) {
        return None;
    }
    Some((port, normalized_path))
}

pub(crate) fn valid_build_identity(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..].iter().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_runtime_url(value: &str) -> bool {
    endpoint_identity(value).is_some()
}

pub(crate) fn probe(
    blockbench_running: bool,
    system: &System,
    lease_path: Option<&Path>,
    expected_profile_id: Option<&str>,
) -> RuntimeSessionProbe {
    if !blockbench_running {
        return RuntimeSessionProbe::absent();
    }
    let (Some(path), Some(expected_profile_id)) = (lease_path, expected_profile_id) else {
        return RuntimeSessionProbe::absent();
    };
    let Ok(metadata) = fs::metadata(path) else {
        return RuntimeSessionProbe::absent();
    };
    if metadata.len() == 0 || metadata.len() > 16 * 1024 {
        return RuntimeSessionProbe::absent();
    }
    let Ok(bytes) = fs::read(path) else {
        return RuntimeSessionProbe::absent();
    };
    let Ok(lease) = serde_json::from_slice::<RuntimeSessionLease>(&bytes) else {
        return RuntimeSessionProbe::absent();
    };
    if lease.schema != 2
        || lease.product_id != "lazydesigner-bedrock-entity-mcp"
        || !valid_build_identity(&lease.build_identity)
        || lease.profile_id != expected_profile_id
        || !valid_profile_id(&lease.profile_id)
        || !valid_generation(&lease.instance_id)
        || !valid_runtime_url(&lease.runtime_url)
    {
        return RuntimeSessionProbe::absent();
    }
    let Some(process) = system.process(Pid::from_u32(lease.producer_pid)) else {
        return RuntimeSessionProbe { live: false, runtime_url: Some(lease.runtime_url), build_identity: None, started_at_unix_ms: None };
    };
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    if name != "blockbench.exe" && name != "blockbench" {
        return RuntimeSessionProbe { live: false, runtime_url: Some(lease.runtime_url), build_identity: None, started_at_unix_ms: None };
    }
    let Ok(modified) = metadata.modified() else {
        return RuntimeSessionProbe { live: false, runtime_url: Some(lease.runtime_url), build_identity: None, started_at_unix_ms: None };
    };
    let Ok(age) = SystemTime::now().duration_since(modified) else {
        return RuntimeSessionProbe { live: false, runtime_url: Some(lease.runtime_url), build_identity: None, started_at_unix_ms: None };
    };
    RuntimeSessionProbe {
        live: age.as_millis() <= RUNTIME_SESSION_LEASE_TTL_MS as u128,
        runtime_url: Some(lease.runtime_url),
        build_identity: Some(lease.build_identity),
        started_at_unix_ms: Some(lease.started_at_unix_ms),
    }
}

pub(crate) fn matching_build_identity(
    expected: Option<&str>,
    probe: &RuntimeSessionProbe,
) -> Option<bool> {
    let expected = expected?;
    let actual = probe.build_identity.as_deref()?;
    Some(valid_build_identity(expected) && valid_build_identity(actual) && expected == actual)
}

pub(crate) fn endpoint_match(
    managed_runtime_url: Option<&str>,
    probe: &RuntimeSessionProbe,
) -> Option<bool> {
    let managed = endpoint_identity(managed_runtime_url?)?;
    let listener = endpoint_identity(probe.runtime_url.as_deref()?)?;
    Some(managed == listener)
}

pub(crate) fn ready(
    managed_runtime_online: bool,
    managed_runtime_url: Option<&str>,
    expected_build_identity: Option<&str>,
    probe: &RuntimeSessionProbe,
) -> bool {
    probe.live
        && managed_runtime_online
        && endpoint_match(managed_runtime_url, probe) == Some(true)
        && matching_build_identity(expected_build_identity, probe) == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_identity_accepts_canonical_loopback_aliases() {
        assert_eq!(endpoint_identity("https://localhost:443/"), Some((443, "/".to_string())));
        assert_eq!(endpoint_identity("https://localhost"), Some((443, "/".to_string())));
        assert_eq!(
            endpoint_identity("https://127.0.0.1:3000/bb-mcp/"),
            Some((3000, "/bb-mcp".to_string()))
        );
        assert!(endpoint_identity("http://127.0.0.1:3000/bb-mcp").is_none());
    }

    #[test]
    fn endpoint_match_requires_same_listener_and_gateway_url() {
        let build = format!("sha256:{}", "a".repeat(64));
        let matching = RuntimeSessionProbe {
            live: true,
            runtime_url: Some("https://127.0.0.1:3000/bb-mcp".to_string()),
            build_identity: Some(build.clone()),
            started_at_unix_ms: Some(100),
        };
        let mismatched = RuntimeSessionProbe {
            live: true,
            runtime_url: Some("https://127.0.0.1:3100/bb-mcp".to_string()),
            build_identity: Some(build.clone()),
            started_at_unix_ms: Some(100),
        };
        assert_eq!(
            endpoint_match(Some("https://localhost:3000/bb-mcp"), &matching),
            Some(true)
        );
        assert!(ready(true, Some("https://127.0.0.1:3000/bb-mcp"), Some(&build), &matching));
        assert_eq!(
            endpoint_match(Some("https://127.0.0.1:3000/bb-mcp"), &mismatched),
            Some(false)
        );
        assert!(!ready(true, Some("https://127.0.0.1:3000/bb-mcp"), Some(&build), &mismatched));
        assert!(!ready(false, Some("https://127.0.0.1:3000/bb-mcp"), Some(&build), &matching));
    }

    #[test]
    fn runtime_ready_requires_matching_build_proof() {
        let build = format!("sha256:{}", "a".repeat(64));
        let other = format!("sha256:{}", "b".repeat(64));
        let probe = RuntimeSessionProbe {
            live: true,
            runtime_url: Some("https://127.0.0.1:3000/bb-mcp".to_string()),
            build_identity: Some(build.clone()),
            started_at_unix_ms: Some(100),
        };
        let url = Some("https://127.0.0.1:3000/bb-mcp");
        assert_eq!(matching_build_identity(Some(&build), &probe), Some(true));
        assert_eq!(matching_build_identity(Some(&other), &probe), Some(false));
        assert!(!ready(true, url, Some(&other), &probe));
        assert!(!ready(true, url, None, &probe));
        assert!(!ready(true, url, Some(&build), &RuntimeSessionProbe::absent()));
    }

    #[test]
    fn lease_identity_validation_is_bounded() {
        assert!(valid_profile_id("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        assert!(!valid_profile_id("not-a-profile"));
        assert!(valid_generation("11111111-1111-4111-8111-111111111111"));
        assert!(!valid_generation("not-a-generation"));
        assert!(valid_build_identity(&format!("sha256:{}", "a".repeat(64))));
        assert!(!valid_build_identity(&format!("sha256:{}", "g".repeat(64))));
    }
}
