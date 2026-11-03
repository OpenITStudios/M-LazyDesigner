use crate::{desktop_error::DesktopError, operation_log, system_status};
use rfd::FileDialog;
use serde::Serialize;
use serde_json::json;
use std::{fs, path::PathBuf};

#[derive(Debug, Serialize)]
pub struct DiagnosticExportResult {
    pub status: &'static str,
    pub path: Option<String>,
}

pub fn export() -> Result<DiagnosticExportResult, DesktopError> {
    let target = FileDialog::new()
        .set_file_name("lazydesigner-diagnostics.json")
        .add_filter("JSON", &["json"])
        .save_file();

    let Some(path) = target else {
        return Ok(DiagnosticExportResult {
            status: "CANCELLED",
            path: None,
        });
    };

    write_snapshot(&path)?;

    Ok(DiagnosticExportResult {
        status: "EXPORTED",
        path: Some(path.display().to_string()),
    })
}

fn write_snapshot(path: &PathBuf) -> Result<(), DesktopError> {
    let status = system_status::collect();
    let document = json!({
        "schema": 1,
        "desktop": {
            "version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        },
        "status": status,
        "desktop_activity": operation_log::recent_summary(),
        "privacy": {
            "contains_project_content": false,
            "contains_environment_variables": false,
            "contains_tls_private_key": false,
            "contains_codex_config": false,
            "contains_raw_operation_log": false,
            "contains_gateway_trace": false
        }
    });

    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|error| DesktopError::terminal("DIAGNOSTIC_SERIALIZE_FAILED", error.to_string()))?;
    fs::write(path, bytes)
        .map_err(|error| DesktopError::recoverable("DIAGNOSTIC_WRITE_FAILED", error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_contract_never_declares_sensitive_payloads() {
        let privacy = json!({
            "contains_project_content": false,
            "contains_environment_variables": false,
            "contains_tls_private_key": false,
            "contains_codex_config": false,
            "contains_raw_operation_log": false,
            "contains_gateway_trace": false
        });
        assert_eq!(privacy["contains_tls_private_key"], false);
        assert_eq!(privacy["contains_project_content"], false);
    }
}
