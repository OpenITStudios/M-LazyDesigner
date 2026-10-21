use crate::{
    blockbench::BlockbenchState,
    system_status::ManagedStatus,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct MaintenanceAvailability {
    pub update: bool,
    pub rollback: bool,
    pub repair: bool,
    pub recover: bool,
    pub setup_tls: bool,
    pub blocked_reason: Option<&'static str>,
}

#[derive(Debug, Serialize)]
pub struct GatewaySupervision {
    pub ownership: &'static str,
    pub state: &'static str,
    pub action: Option<&'static str>,
}

#[derive(Debug, Serialize)]
pub struct ReadinessProjection {
    pub state: &'static str,
    pub summary: &'static str,
    pub ready: bool,
}

pub(crate) fn unknown_gateway() -> GatewaySupervision {
    GatewaySupervision {
        ownership: "client-owned",
        state: "unknown",
        action: Some("Managed status is unavailable; refresh or diagnose the managed installation before lifecycle decisions."),
    }
}

pub(crate) fn gateway(
    managed: Option<&ManagedStatus>,
    blockbench_running: bool,
    runtime_ready: bool,
    verified_mcp_catalog: bool,
) -> GatewaySupervision {
    let active = managed.map(|value| value.gateway_active).unwrap_or(false);

    match (active, runtime_ready, blockbench_running, verified_mcp_catalog) {
        (true, true, _, true) => GatewaySupervision {
            ownership: "client-owned",
            state: "healthy",
            action: None,
        },
        (true, true, _, false) => GatewaySupervision {
            ownership: "client-owned",
            state: "gateway-detected",
            action: Some("Gateway and Runtime detected; MCP handshake/catalog proof is absent or expired. Confirm the session in the AI client."),
        },
        (true, false, _, _) => GatewaySupervision {
            ownership: "client-owned",
            state: "waiting-runtime",
            action: Some("Keep the current client Gateway session and restore/reload the Blockbench Runtime. Do not start a second Gateway."),
        },
        (false, true, _, _) => GatewaySupervision {
            ownership: "client-owned",
            state: "client-disconnected",
            action: Some("Reconnect LazyDesigner MCP in Codex or the active MCP client; that client owns Gateway startup."),
        },
        (false, false, true, _) => GatewaySupervision {
            ownership: "client-owned",
            state: "runtime-offline",
            action: Some("Restore or reload the LazyDesigner Runtime in Blockbench, then reconnect LazyDesigner MCP in the client if needed."),
        },
        (false, false, false, _) => GatewaySupervision {
            ownership: "client-owned",
            state: "idle",
            action: Some("Start Blockbench, then reconnect LazyDesigner MCP in Codex or the active MCP client."),
        },
    }
}

pub(crate) fn product_state(
    manager_available: bool,
    managed: Option<&ManagedStatus>,
    blockbench: &BlockbenchState,
    runtime_ready: bool,
    gateway: &GatewaySupervision,
    plugin_integrity: &str,
) -> &'static str {
    if !manager_available {
        return "welcome";
    }
    let Some(managed) = managed else {
        return "attention";
    };
    if !managed.tls_ready {
        return "security-setup";
    }
    if matches!(
        blockbench.compatibility.as_ref().map(|value| value.status.as_str()),
        Some("unsupported" | "invalid")
    ) {
        return "unsupported";
    }
    if matches!(plugin_integrity, "modified" | "invalid") {
        return "attention";
    }
    if plugin_integrity == "missing" && blockbench.running {
        return "plugin-setup";
    }
    if !blockbench.running {
        return "ready-start";
    }
    if !runtime_ready {
        return "plugin-setup";
    }
    if gateway.state == "healthy" { return "ready"; }
    if gateway.state == "gateway-detected" || gateway.state == "client-disconnected" {
        return "client-wait";
    }
    "attention"
}

pub(crate) fn readiness(
    manager_available: bool,
    managed: Option<&ManagedStatus>,
    blockbench_running: bool,
    runtime_ready: bool,
    gateway: &GatewaySupervision,
    plugin_integrity: &str,
) -> ReadinessProjection {
    if !manager_available {
        return ReadinessProjection {
            state: "setup-required",
            summary: "Install managed LazyDesigner components first.",
            ready: false,
        };
    }
    let Some(managed) = managed else {
        return ReadinessProjection {
            state: "needs-attention",
            summary: "Managed status is unavailable. Export diagnostics if refresh does not recover.",
            ready: false,
        };
    };
    if !managed.tls_ready {
        return ReadinessProjection {
            state: "needs-attention",
            summary: "Runtime security setup is incomplete.",
            ready: false,
        };
    }
    if matches!(plugin_integrity, "modified" | "invalid") {
        return ReadinessProjection {
            state: "needs-attention",
            summary: "Managed Blockbench plugin integrity requires attention.",
            ready: false,
        };
    }
    if !blockbench_running {
        return ReadinessProjection {
            state: "ready-to-start",
            summary: "Managed components are healthy; open Blockbench to begin.",
            ready: false,
        };
    }
    // Process presence alone cannot prove a client MCP session.
    if gateway.state == "healthy" && runtime_ready {
        return ReadinessProjection {
            state: "ready",
            summary: "Recent MCP request and matching Blockbench Runtime catalog verified.",
            ready: true,
        };
    }
    ReadinessProjection {
        state: "needs-connection",
        summary: gateway.action.unwrap_or("Restore Runtime/Gateway connectivity."),
        ready: false,
    }
}

pub(crate) fn maintenance(
    manager_available: bool,
    managed: Option<&ManagedStatus>,
    runtime_listener_live: bool,
) -> MaintenanceAvailability {
    if !manager_available {
        return MaintenanceAvailability {
            update: false,
            rollback: false,
            repair: false,
            recover: false,
            setup_tls: false,
            blocked_reason: Some("Managed LazyDesigner installation is unavailable."),
        };
    }

    let Some(managed) = managed else {
        return MaintenanceAvailability {
            update: false,
            rollback: false,
            repair: false,
            recover: false,
            setup_tls: false,
            blocked_reason: Some("Managed status is unavailable; refresh before maintenance."),
        };
    };

    let busy = managed.gateway_active || managed.runtime_online || runtime_listener_live;
    MaintenanceAvailability {
        update: true,
        rollback: !busy && managed.rollback.as_ref().map(|value| value.available).unwrap_or(false),
        repair: !busy,
        recover: !busy,
        setup_tls: !busy && !managed.tls_ready,
        blocked_reason: if busy {
            Some("Close active Codex MCP sessions and Blockbench Runtime before repair, recovery, or Runtime security setup.")
        } else {
            None
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        blockbench,
        system_status::{ManagedRollback, ManagedStatus},
    };

    fn managed(gateway_active: bool, runtime_online: bool, tls_ready: bool) -> ManagedStatus {
        ManagedStatus {
            schema: 1,
            installed: None,
            pending: false,
            gateway_active,
            runtime_online,
            runtime_url: "https://127.0.0.1:3000/bb-mcp".to_string(),
            tls_ready,
            tls_error: None,
            rollback: None,
        }
    }

    #[test]
    fn product_state_rejects_modified_plugin_before_launch() {
        let managed = managed(false, false, true);
        let blockbench = BlockbenchState {
            running: false,
            version: Some("5.2.0".to_string()),
            compatibility: Some(blockbench::evaluate_compatibility("5.2.0").unwrap()),
            diagnostic: None,
        };
        let gateway = gateway(Some(&managed), false, false, false);
        assert_eq!(
            product_state(true, Some(&managed), &blockbench, false, &gateway, "modified"),
            "attention"
        );
    }

    #[test]
    fn gateway_supervision_preserves_client_ownership() {
        let managed = managed(false, true, true);
        let result = gateway(Some(&managed), true, true, false);
        assert_eq!(result.ownership, "client-owned");
        assert_eq!(result.state, "client-disconnected");
        assert!(result.action.unwrap().contains("Reconnect LazyDesigner MCP"));
    }

    #[test]
    fn readiness_projection_covers_workstation_states() {
        let healthy = managed(true, true, true);
        let observed_gateway = gateway(Some(&healthy), true, true, false);
        let proven_gateway = gateway(Some(&healthy), true, true, true);
        assert_eq!(proven_gateway.state, "healthy");
        let proven = readiness(true, Some(&healthy), true, true, &proven_gateway, "ready");
        assert_eq!(proven.state, "ready");
        assert!(proven.ready);
        assert_eq!(observed_gateway.state, "gateway-detected");
        assert_eq!(observed_gateway.ownership, "client-owned");
        assert!(observed_gateway.action.unwrap().contains("MCP handshake"));
        let unverified = readiness(true, Some(&healthy), true, true, &observed_gateway, "ready");
        assert_eq!(unverified.state, "needs-connection");
        assert!(!unverified.ready);
        let running_editor = BlockbenchState {
            running: true, version: None, compatibility: None, diagnostic: None,
        };
        assert_eq!(
            product_state(true, Some(&healthy), &running_editor, true, &observed_gateway, "ready"),
            "client-wait"
        );

        let closed_gateway = gateway(Some(&healthy), false, false, false);
        let start = readiness(true, Some(&healthy), false, false, &closed_gateway, "ready");
        assert_eq!(start.state, "ready-to-start");
        assert!(!start.ready);

        let disconnected = managed(false, true, true);
        let disconnected_gateway = gateway(Some(&disconnected), true, true, false);
        let connection = readiness(
            true,
            Some(&disconnected),
            true,
            true,
            &disconnected_gateway,
            "ready",
        );
        assert_eq!(connection.state, "needs-connection");

        assert_eq!(
            readiness(false, None, false, false, &unknown_gateway(), "unknown").state,
            "setup-required"
        );
        assert_eq!(
            readiness(true, None, false, false, &unknown_gateway(), "unknown").state,
            "needs-attention"
        );
    }

    #[test]
    fn maintenance_projection_matches_managed_runtime_safety_gate() {
        let idle = managed(false, false, true);
        let ready = maintenance(true, Some(&idle), false);
        assert!(ready.update && ready.repair && ready.recover);
        assert!(!ready.rollback);
        assert!(!ready.setup_tls);

        let busy = managed(true, false, false);
        let blocked = maintenance(true, Some(&busy), true);
        assert!(blocked.update);
        assert!(!blocked.repair && !blocked.recover && !blocked.setup_tls);
        assert!(blocked.blocked_reason.is_some());
    }

    #[test]
    fn maintenance_offers_tls_setup_only_when_idle_and_not_ready() {
        let missing = managed(false, false, false);
        assert!(maintenance(true, Some(&missing), false).setup_tls);
    }

    #[test]
    fn rollback_requires_idle_verified_previous_state() {
        let mut state = managed(false, false, true);
        state.rollback = Some(ManagedRollback {
            available: true,
            previous_source_sha: Some("a".repeat(40)),
            transaction: Some("update".to_string()),
        });
        assert!(maintenance(true, Some(&state), false).rollback);
        assert!(!maintenance(true, Some(&state), true).rollback);
    }
}
