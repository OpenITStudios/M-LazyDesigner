/** Compare a lightweight native probe against the last full Desktop projection. */
export type ConnectionObservation = {
  blockbench_running: boolean;
  runtime_listener_live: boolean;
  gateway_active: boolean | null;
  gateway_mcp_ready?: boolean;
  plugin_integrity: string;
  project_revision: string | null;
  project_session_live: boolean;
  configuration_revision?: string | null;
};

export type ConnectionBaseline = {
  blockbench: { running: boolean };
  runtime_listener_live: boolean;
  plugin_integrity: string;
  managed: { gateway_active: boolean } | null;
  gateway?: { state: string };
  project_navigation: { revision: string | null; session_live: boolean };
  configuration_revision?: string | null;
};

export function connectionChanged(candidate: ConnectionObservation, current: ConnectionBaseline): boolean {
  return candidate.blockbench_running !== current.blockbench.running
    || candidate.plugin_integrity !== current.plugin_integrity
    || candidate.runtime_listener_live !== current.runtime_listener_live
    || (candidate.gateway_active !== null && current.managed !== null
      && candidate.gateway_active !== current.managed.gateway_active)
    || (typeof candidate.gateway_mcp_ready === "boolean" && current.gateway !== undefined
      && candidate.gateway_mcp_ready !== (current.gateway.state === "healthy"))
    || candidate.project_revision !== current.project_navigation.revision
    || candidate.configuration_revision !== current.configuration_revision
    || candidate.project_session_live !== current.project_navigation.session_live;
}

// Fewer native process and plugin-integrity scans while the user is idle.
// Foreground/focus events still request an immediate observation.
export function connectionCheckDelayMs(blockbenchRunning: boolean): number {
  return blockbenchRunning ? 8_000 : 20_000;
}
