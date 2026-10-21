import type { ProjectNavigation } from './projectNavigationTypes';

export type DesktopInvoke = typeof import('@tauri-apps/api/core').invoke;

export type DesktopBusyAction = ManagedActionResult['action'] | 'install' | 'connect-blockbench' | 'show-plugin' | 'export-diagnostics' | 'project-action' | 'open-editor' | 'browse-model' | 'choose-editor';

export type DesktopOperationRecord = {
  action: string;
  outcome: 'success' | 'pending' | 'unchanged' | 'failed';
  status: string;
  at: string;
};

// Serialized Desktop IPC types shared by the UI; readiness is owned by Rust.
export type Compatibility = {
    status: 'validated' | 'compatible-unverified' | 'review-required' | 'unsupported' | 'invalid';
    minimum_version: string;
    review_boundary_version: string;
    source_type_baseline: string;
    live_validated: boolean;
  };

export type BlockbenchState = {
    running: boolean;
    version: string | null;
    compatibility: Compatibility | null;
    diagnostic: string | null;
  };

export type ManagedStatus = {
    schema: number;
    installed: { source_sha: string } | null;
    pending: boolean;
    gateway_active: boolean;
    runtime_online: boolean;
    runtime_url: string;
    tls_ready: boolean;
    tls_error: string | null;
    rollback?: { available: boolean; previous_source_sha: string | null; transaction: string | null };
  };

export type MaintenanceAvailability = {
    update: boolean;
    rollback: boolean;
    repair: boolean;
    recover: boolean;
    setup_tls: boolean;
    blocked_reason: string | null;
  };

export type GatewaySupervision = {
    ownership: 'client-owned';
    state: 'healthy' | 'gateway-detected' | 'waiting-runtime' | 'client-disconnected' | 'runtime-offline' | 'idle' | 'unknown';
    action: string | null;
  };

export type ReadinessProjection = {
    state: 'ready' | 'ready-to-start' | 'needs-connection' | 'needs-attention' | 'setup-required';
    summary: string;
    ready: boolean;
  };

export type ConnectionStatus = {
    schema: number;
    observed_at_unix_ms: number;
    blockbench_running: boolean;
    runtime_listener_live: boolean;
    gateway_active: boolean | null;
    gateway_mcp_ready: boolean;
    plugin_integrity: 'ready' | 'missing' | 'modified' | 'invalid' | 'unknown';
    project_revision: string | null;
    project_session_live: boolean;
  };

export type SystemStatus = {
    schema: number;
    product_state: ProductMode;
    plugin_integrity: 'ready' | 'missing' | 'modified' | 'invalid' | 'unknown';
    observed_at_unix_ms: number;
    readiness: ReadinessProjection;
    blockbench: BlockbenchState;
    gateway: GatewaySupervision;
    maintenance: MaintenanceAvailability;
    manager_available: boolean;
    bootstrap_available: boolean;
    runtime_listener_live: boolean;
    runtime_endpoint_match: boolean | null;
    /** null means no version evidence; false means an observed mismatch. */
    runtime_build_match?: boolean | null;
    runtime_ready: boolean;
    managed: ManagedStatus | null;
    project_navigation: ProjectNavigation;
    diagnostic: string | null;
  };

export type PluginFileActionResult = {
    status: 'SHOWN';
  };

export type BootstrapActionResult = {
    action: 'install';
    receipt: Record<string, unknown>;
  };

export type ManagedActionResult = {
    action: 'update' | 'rollback' | 'recover' | 'repair' | 'setup-tls';
    receipt: Record<string, unknown>;
  };

export type ManagedUpdateCheck = {
    status: 'NOT_INSTALLED' | 'UP_TO_DATE' | 'UPDATE_AVAILABLE' | 'UPDATE_STAGED' | 'UPDATE_STAGED_UNVERIFIED';
    installed_source_sha: string | null;
    available_source_sha: string | null;
    tag: string | null;
    published_at: string | null;
  };

export type ModelBrowseResult = {
    status: 'CONFIRMED_ACTIVE' | 'LAUNCHED_UNVERIFIED' | 'CANCELLED';
  };

export type BlockbenchSelectionResult = {
    status: 'SELECTED' | 'CANCELLED';
  };

export type BlockbenchEditorResult = {
    status: 'STARTED' | 'ALREADY_RUNNING';
  };

export type BlockbenchFocusResult = {
    status: 'FOCUSED' | 'NO_WINDOW' | 'AMBIGUOUS' | 'DENIED' | 'UNKNOWN' | 'NOT_RUNNING' | 'UNSUPPORTED';
  };

export type EnsureReadyResult = {
    status: 'READY' | 'RUNTIME_READY' | 'APPROVAL_REQUIRED' | 'NEEDS_ATTENTION';
    reason: string;
    runtime_online: boolean;
    gateway_active: boolean;
    blockbench_running: boolean;
    plugin_integrity: 'ready' | 'missing' | 'modified' | 'invalid' | 'unknown';
    manual_plugin_approval_recommended: boolean;
  };

export type DesktopCommandError = {
    code: string;
    message: string;
    recoverable: boolean;
  };

export type DiagnosticExportResult = {
    status: 'EXPORTED' | 'CANCELLED';
    path: string | null;
  };

export type ProjectNavigationActionResult = {
    status: 'OPENED' | 'CONFIRMED_ACTIVE' | 'LAUNCHED_UNVERIFIED' | 'REVEALED' | 'PINNED' | 'UNPINNED' | 'RESTORED' | 'REMOVED_FROM_LIST' | 'ADDED' | 'ALREADY_ADDED' | 'CANCELLED';
  };

export type ProjectPathResult = {
    path: string;
  };


export type ProductMode = 'welcome' | 'security-setup' | 'unsupported' | 'ready-start' | 'plugin-setup' | 'client-wait' | 'ready' | 'attention';
export type ManagedProgress = { schema: number; kind: 'progress'; action: string; stage: string };
