import type { Compatibility, ProductMode, SystemStatus, EnsureReadyResult } from './desktopTypes';

// Presentation only: no process lifecycle, IPC, or readiness inference.
export const compatibilityLabel = (value: Compatibility['status'] | undefined) => {
  if (value === 'validated') return 'Validated';
  if (value === 'compatible-unverified') return 'Compatible · unverified';
  if (value === 'review-required') return 'Review required';
  if (value === 'unsupported') return 'Unsupported';
  if (value === 'invalid') return 'Unknown version';
  return 'Unavailable';
};

export const productMode = (value: SystemStatus): ProductMode => value.product_state;

export function productHeadline(value: SystemStatus) {
  const mode = productMode(value);
  if (mode === 'welcome') return 'Welcome to LazyDesigner';
  if (mode === 'security-setup') return 'Finish setup';
  if (mode === 'unsupported') return 'Blockbench version not supported';
  if (mode === 'ready-start') return 'Ready to start';
  if (mode === 'plugin-setup') return 'Connect LazyDesigner to Blockbench';
  if (mode === 'client-wait') return 'Blockbench ready';
  if (mode === 'ready') return 'Ready to use';
  return 'Action required';
}

export function productMessage(value: SystemStatus) {
  const mode = productMode(value);
  if (mode === 'welcome') return 'Set up LazyDesigner once, then continue your work in Blockbench.';
  if (mode === 'security-setup') return 'Complete the secure local setup required for LazyDesigner to connect safely.';
  if (mode === 'unsupported') return 'This Blockbench version cannot be used safely with the current LazyDesigner build.';
  if (mode === 'ready-start') return 'Everything is installed. Open Blockbench when you are ready to work.';
  if (mode === 'plugin-setup') return 'LazyDesigner will try to connect to Blockbench automatically.';
  if (mode === 'client-wait') return 'LazyDesigner is active in Blockbench and will connect when an MCP client starts a session.';
  if (mode === 'ready') return 'Everything is working. Continue in Blockbench.';
  return value.readiness.summary;
}

export function productGuidance(value: SystemStatus, pluginApprovalNeeded: boolean) {
  const mode = productMode(value);
  if (mode === 'welcome' && !value.bootstrap_available) return 'This Desktop build does not contain the setup package. Open Support and export diagnostics.';
  if (mode === 'security-setup' && !value.maintenance.setup_tls) return value.maintenance.blocked_reason ?? 'Secure setup is temporarily unavailable. Close active authoring tasks and try again.';
  if (mode === 'unsupported') return 'Update Blockbench to a supported version, then refresh this page.';
  if (mode === 'plugin-setup' && value.runtime_build_match === false) return 'Blockbench is running a different LazyDesigner build from the installed package. Keep the model open; reconnect after the matching verified update. Open Support for details.';
  if (mode === 'plugin-setup' && value.runtime_endpoint_match === false) return 'Blockbench and the MCP client use different local connection settings. Open Support before trying again.';
  if (mode === 'plugin-setup' && pluginApprovalNeeded) return 'Blockbench needs one-time approval for the LazyDesigner plugin.';
  if (mode === 'attention' && value.plugin_integrity === 'modified') return 'The managed Blockbench plugin was modified. Review or repair it before starting Blockbench.';
  if (mode === 'attention' && value.plugin_integrity === 'invalid') return 'The managed Blockbench plugin state is invalid. Open Support for recovery.';
  if (mode === 'attention') return value.gateway.action ?? value.blockbench.diagnostic ?? value.diagnostic ?? 'Open Support for troubleshooting tools.';
  return null;
}

export type BootstrapInstallFeedback = {
  status: 'INSTALLED' | 'STAGED';
  kind: 'success' | 'pending';
  message: string;
  verifyRuntime: boolean;
};

/** A staged bootstrap is not an installed or usable product. */
export function bootstrapInstallPresentation(receipt: Record<string, unknown>): BootstrapInstallFeedback {
  if (receipt.status === 'STAGED') return {
    status: 'STAGED',
    kind: 'pending',
    message: 'Setup is waiting for Blockbench and active AI sessions to close. Save your models first, then choose Finish setup. Nothing was replaced.',
    verifyRuntime: false,
  };
  if (receipt.status === 'INSTALLED' &&
      typeof receipt.source_sha === 'string' &&
      /^[a-f0-9]{40}$/.test(receipt.source_sha)) return {
    status: 'INSTALLED',
    kind: 'success',
    message: 'Managed files installed. Verifying Blockbench and Runtime before declaring Ready.',
    verifyRuntime: true,
  };
  throw new Error('Setup returned an unverified installation result. No Ready status can be assumed.');
}

export type ManagedAction = 'update' | 'rollback' | 'recover' | 'repair' | 'setup-tls';
export function managedActionLabel(action: ManagedAction): string {
  return {
    update: 'Update managed components',
    rollback: 'Restore previous version',
    recover: 'Finish incomplete setup',
    repair: 'Repair LazyDesigner',
    'setup-tls': 'Finish secure setup',
  }[action];
}
export type ManagedActionFeedback = {
  status: string;
  kind: 'success' | 'pending' | 'unchanged';
  message: string;
};

/** Present only authoritative manager receipts; process exit 0 is not
 * evidence that a staged update has been activated. */
export function managedActionPresentation(
  action: ManagedAction,
  receipt: Record<string, unknown>
): ManagedActionFeedback {
  const status = receipt.status;
  if (typeof status !== 'string') {
    throw new Error('Managed action returned no verified status. Refresh and open Support.');
  }
  if (action === 'update') {
    if (status === 'STAGED') return {
      status, kind: 'pending',
      message: 'Update staged, not installed. Close Blockbench and active AI sessions, then choose Update components again.',
    };
    if (status === 'NO_PENDING_UPDATE') return {
      status, kind: 'unchanged',
      message: 'No staged update was found. Refresh to check the installed components.',
    };
    if (status === 'INSTALLED') return {
      status, kind: 'success',
      message: 'Managed files installed. Runtime and Blockbench are not verified yet; reconnect to confirm the new version is usable.',
    };
  }
  const expected: Record<Exclude<ManagedAction, 'update'>, string> = {
    rollback: 'ROLLBACK_COMPLETE',
    recover: 'RECOVER_COMPLETE',
    repair: 'REPAIRED',
    'setup-tls': 'TLS_READY',
  };
  if (action !== 'update' && status === expected[action]) {
    return {
      status, kind: 'success',
      message: {
        rollback: 'Previous managed version restored.',
        recover: 'Interrupted installation recovered.',
        repair: 'Managed files repaired.',
        'setup-tls': 'Secure local connection configured.',
      }[action],
    };
  }
  throw new Error(`Unexpected managed ${action} result (${status}). Refresh and open Support.`);
}

// Surface short actionable copy in Workspace. The original command output is
// available only through Support, so incidental filesystem paths and flags
// do not become the primary instruction for a normal user.
export type DesktopErrorNotice = {
  title: string;
  message: string;
  detail: string | null;
};

export function desktopErrorNotice(cause: unknown): DesktopErrorNotice {
  const record = cause && typeof cause === 'object'
    ? cause as { code?: unknown; message?: unknown }
    : null;
  const code = typeof record?.code === 'string' ? record.code : '';
  const detail = typeof record?.message === 'string'
    ? record.message
    : cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : null;
  const known = (title: string, message: string): DesktopErrorNotice => ({
    title, message, detail,
  });
  if (code === 'PROJECT_DELETE_REVIEW_FAILED' || code === 'PROJECT_RECYCLE_FAILED') {
    if (/close all Blockbench|close Blockbench/i.test(detail ?? '')) {
      return known('Close Blockbench first',
        'Save your models and close every Blockbench window, then review Delete Project again.');
    }
    if (/protected|system|broad|overlaps|linked|special|network|fixed drive/i.test(detail ?? '')) {
      return known('Folder is not safe to delete here',
        'This folder cannot be recycled as a Project. Review its contents in File Explorer.');
    }
    return known('Project deletion not confirmed',
      'Windows did not confirm that the entire folder was recycled. Check the folder in Explorer before retrying. No permanent-delete fallback was attempted.');
  }
  if (code === 'LEGACY_PLUGIN_MIGRATION_REQUIRED') {
    return known('Existing plugin needs review',
      'An older Blockbench plugin was found. No files were replaced. Open Support for safe migration steps.');
  }
  if (code === 'LEGACY_CLIENT_MIGRATION_REQUIRED') {
    return known('Existing AI connection needs review',
      'An older AI client entry was found. Your settings were preserved. Open Support for migration steps.');
  }
  if (code === 'BLOCKBENCH_PROFILE_UNVERIFIED' ||
      /multiple Blockbench installations|different userData profile|Blockbench.*(?:profile|executable).*unavailable|(?:multiple|different).*blockbench.*profile|profile.*(?:ambiguous|unavailable|another)/i.test(detail ?? '')) {
    return known('Blockbench profile needs review',
      'LazyDesigner could not verify which Blockbench profile to use. Keep your models open and check Support.');
  }
  if (/Local file is not owned or was edited|Retired BlockIT plugin exists/i.test(detail ?? '')) {
    return known('Existing file needs review',
      'An existing plugin or managed file was preserved rather than overwritten. Open Support to review the conflict.');
  }
  if (/timed out|timeout/i.test(detail ?? '')) {
    return known('Connection check timed out',
      'The system did not respond in time. File opening remains available; Refresh or open Support to check the AI connection.');
  }
  if (code === 'UPDATE_CHECK_FAILED') {
    return known('Update check unavailable',
      'Could not verify updates right now. You can continue using the current installation.');
  }
  return known('Action could not be completed',
    'The requested action was not confirmed. Open Support for the technical details before trying again.');
}

export function connectionReadinessError(result: EnsureReadyResult): string {
  switch (result.reason) {
    case 'BLOCKBENCH_PROFILE_MISMATCH':
      return 'Blockbench is running with a different profile or its profile cannot be verified. Save your models, close that editor, and open Blockbench from LazyDesigner.';
    case 'PLUGIN_INTEGRITY':
      return 'The managed Blockbench plugin was modified and needs review.';
    case 'BLOCKBENCH_EXITED':
      return 'Blockbench closed before LazyDesigner could become ready.';
    case 'RUNTIME_ENDPOINT_MISMATCH':
      return 'Blockbench and the MCP client are using different local connection settings. Restore matching connection settings or open Support.';
    case 'RUNTIME_START_FAILED':
      return 'LazyDesigner loaded in Blockbench, but its local Runtime could not start. Open Support.';
    case 'CONNECTION_PROBE_UNKNOWN':
      return 'LazyDesigner could not verify the local Runtime connection. Try again or open Support.';
    default:
      return 'LazyDesigner could not prepare Blockbench automatically.';
  }
}

export function installationReadinessError(ready: EnsureReadyResult): string {
  switch (ready.reason) {
    case 'PLUGIN_INTEGRITY':
      return 'Setup completed, but the managed Blockbench plugin needs review.';
    case 'RUNTIME_ENDPOINT_MISMATCH':
      return 'Setup completed, but Blockbench and the MCP client use different local connection settings.';
    case 'RUNTIME_START_FAILED':
      return 'Setup completed, but the local Runtime could not start in Blockbench.';
    default:
      return 'Setup completed, but Blockbench could not become ready automatically.';
  }
}

export const progressLabel = (stage: string) => stage.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
