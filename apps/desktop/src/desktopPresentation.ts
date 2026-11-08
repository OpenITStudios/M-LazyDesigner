import type { Compatibility, ProductMode, SystemStatus, EnsureReadyResult } from './desktopTypes';
import type { ProjectNavigation, ProjectNavigationModel, ProjectNavigationProject } from './projectNavigationTypes';

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
  if (mode === 'client-wait') return value.gateway?.state === 'gateway-detected'
    ? 'Blockbench Runtime and Gateway process detected; confirm the MCP handshake and available capabilities from your AI client.'
    : 'LazyDesigner is active in Blockbench and will connect when an MCP client starts a session.';
  if (mode === 'ready') return 'A recent MCP request verified the Gateway connection and matching Blockbench Runtime catalog. Continue in Blockbench.';
  return value.readiness.summary;
}

/**
 * Status freshness is the age of a FULL Desktop observation, not the time of
 * the last successful MCP request. This is a presentation-only conservative
 * reminder; Rust still owns session proof, readiness and action admission.
 */
export const FULL_STATUS_RECENT_MS = 30_000;

export function fullStatusObservationAgeMs(observedAtMs: number, nowMs: number): number | null {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs <= 0 ||
      !Number.isSafeInteger(nowMs) || nowMs < observedAtMs) return null;
  return nowMs - observedAtMs;
}

function observationAgeText(ageMs: number): string {
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)} seconds ago`;
  if (ageMs < 3_600_000) {
    const minutes = Math.floor(ageMs / 60_000);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const hours = Math.floor(ageMs / 3_600_000);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

/** Pure product-state wording over an explicit presentation clock. */
export function aiStatusPresentation(value: SystemStatus, probeFailures: number, nowMs: number = Date.now()) {
  if (probeFailures >= 2) return {
    label: 'Verification required',
    headline: 'AI status needs verification',
    detail: 'These are the last known connection details. Models and folders remain accessible; Refresh before changing project shortcuts or installed components.',
    recentlyVerified: false,
    needsRefresh: true,
  };
  const mode = productMode(value);
  const age = fullStatusObservationAgeMs(value.observed_at_unix_ms, nowMs);
  if (mode === 'ready' || mode === 'client-wait') {
    if (age === null) return {
      label: 'Check time unavailable',
      headline: 'Check AI status again',
      detail: 'The last full status check has no trustworthy timestamp. Refresh to check the AI session; model editing remains available.',
      recentlyVerified: false,
      needsRefresh: true,
    };
    if (age > FULL_STATUS_RECENT_MS) return {
      label: 'AI check out of date',
      headline: 'Check AI status again',
      detail: `The last full status check was ${observationAgeText(age)}. This does not mean AI is disconnected. Refresh for current information; model editing remains available.`,
      recentlyVerified: false,
      needsRefresh: true,
    };
  }
  if (mode === 'ready') return {
    label: 'Verified at last check',
    headline: 'AI verified at last check',
    detail: `An AI request was verified at the full status check ${observationAgeText(age!)}. This does not guarantee the session remains connected.`,
    recentlyVerified: true,
    needsRefresh: false,
  };
  if (mode === 'client-wait') {
    if (value.gateway.state === 'gateway-detected') return {
      label: 'AI handshake unverified',
      headline: 'Confirm AI connection',
      detail: 'The AI service was detected, but the session is not verified. Confirm it in your AI client; model editing remains available.',
      recentlyVerified: false,
      needsRefresh: false,
    };
    return {
      label: 'AI client not connected',
      headline: 'Blockbench ready',
      detail: 'You can edit models now. Connect an AI client only when you need AI-assisted work.',
      recentlyVerified: false,
      needsRefresh: false,
    };
  }
  const labels: Record<Exclude<ProductMode, 'ready' | 'client-wait'>, string> = {
    welcome: 'Setup needed',
    'security-setup': 'Secure setup needed',
    unsupported: 'Unsupported Blockbench',
    'ready-start': 'AI not connected',
    'plugin-setup': 'Plugin setup needed',
    attention: 'Action required',
  };
  return {
    label: labels[mode],
    headline: productHeadline(value),
    detail: productMessage(value),
    recentlyVerified: false,
    needsRefresh: false,
  };
}

export function productGuidance(value: SystemStatus, pluginApprovalNeeded: boolean) {
  const mode = productMode(value);
  if (mode === 'attention' && value.managed?.installed && value.managed.alignment?.state !== 'aligned') return 'Open Support to verify the managed package, plugin and AI client configuration before reconnecting.';
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

// Classify user-facing error recovery without owning any native operation.
// Only a full status Refresh or navigation to Support can be offered directly;
// destructive retry, migration and repair always remain explicit separate tasks.
export type DesktopRecoveryAction = 'refresh-status' | 'open-support' | null;
export type DesktopErrorRecovery = {
  nextStep: string;
  confirmationNeeded: string;
  action: DesktopRecoveryAction;
};

export type DesktopErrorNotice = {
  title: string;
  message: string;
  detail: string | null;
  recovery: DesktopErrorRecovery;
};

export function desktopErrorNotice(cause: unknown): DesktopErrorNotice {
  const record = cause && typeof cause === 'object'
    ? cause as { code?: unknown; message?: unknown }
    : null;
  const code = typeof record?.code === 'string' ? record.code : '';
  const detail = typeof record?.message === 'string'
    ? record.message
    : cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : null;
  const known = (
    title: string, message: string, nextStep: string, confirmationNeeded: string,
    action: DesktopRecoveryAction = 'open-support',
  ): DesktopErrorNotice => ({
    title, message, detail, recovery: { nextStep, confirmationNeeded, action },
  });

  // Prefer exact native error codes before interpreting incidental message
  // text. A typed DELETE result cannot become an "update required" error
  // merely because an error detail contains a similar marker.
  const updateRequired = () => known('Desktop update required',
    'The selected package needs a compatible Desktop installer. The active installation was preserved.',
    'Review the Desktop version before choosing a compatible verified installer.',
    'Whether this Desktop version supports the selected managed package.');
  const installationMismatch = () => known('Installed components need verification',
    'Open Support to check the managed package, plugin and AI client entry before reconnecting.',
    'Review the installed component alignment before reconnecting.',
    'Whether the Desktop, plugin and managed package match.');
  if (code === 'DESKTOP_UPDATE_REQUIRED') return updateRequired();
  if (code === 'INSTALLATION_MISMATCH') return installationMismatch();
  if (code === 'PROJECT_DELETE_REVIEW_FAILED' || code === 'PROJECT_RECYCLE_FAILED') {
    if (/close all Blockbench|close Blockbench/i.test(detail ?? '')) {
      return known('Close Blockbench first',
        'Save your models and close every Blockbench window, then review Delete Project again.',
        'Save work, close Blockbench yourself, and start a new deletion review only if you still intend to delete the project.',
        'The folder has not been confirmed recycled by this attempt.', null);
    }
    if (/protected|system|broad|overlaps|linked|special|network|fixed drive/i.test(detail ?? '')) {
      return known('Folder is not safe to delete here',
        'This folder cannot be recycled as a Project. Review its contents in File Explorer.',
        'Inspect the original folder in File Explorer; do not repeat Delete Project on this unsafe location.',
        'The selected folder is not verified eligible for safe recycling here.', null);
    }
    return known('Project deletion not confirmed',
      'Windows did not confirm that the entire folder was recycled. Check the folder in Explorer before retrying. No permanent-delete fallback was attempted.',
      'Inspect both the original folder and Windows Recycle Bin before considering another deletion review.',
      'Whether Windows recycled the selected project folder remains unknown.', null);
  }
  if (code === 'LEGACY_PLUGIN_MIGRATION_REQUIRED') {
    return known('Existing plugin needs review',
      'An older Blockbench plugin was found. No files were replaced. Open Support for safe migration steps.',
      'Inspect the existing plugin and the separate backed-up migration path.',
      'A safe plugin migration and new connection have not been confirmed.');
  }
  if (code === 'LEGACY_CLIENT_MIGRATION_REQUIRED') {
    return known('Existing AI connection needs review',
      'An older AI client entry was found. Your settings were preserved. Open Support for migration steps.',
      'Review the previous client entry and the explicit backed-up migration path.',
      'The replacement client configuration and new handshake have not been confirmed.');
  }
  if (code === 'UPDATE_CHECK_FAILED') {
    return known('Update check unavailable',
      'Could not verify updates right now. You can continue using the current installation.',
      'Continue working with the current installation; review update information later from Support.',
      'Whether a newer verified managed package is available.', null);
  }
  if (code === 'BLOCKBENCH_PROFILE_UNVERIFIED' ||
      /multiple Blockbench installations|different userData profile|Blockbench.*(?:profile|executable).*unavailable|(?:multiple|different).*blockbench.*profile|profile.*(?:ambiguous|unavailable|another)/i.test(detail ?? '')) {
    return known('Blockbench profile needs review',
      'LazyDesigner could not verify which Blockbench profile to use. Keep your models open and check Support.',
      'Check the installed Blockbench executable and profile before changing either.',
      'The identity of the intended Blockbench installation and profile.');
  }
  if (/Local file is not owned or was edited|Retired BlockIT plugin exists/i.test(detail ?? '')) {
    return known('Existing file needs review',
      'An existing plugin or managed file was preserved rather than overwritten. Open Support to review the conflict.',
      'Inspect the existing file; do not overwrite or adopt it automatically.',
      'Whether the existing file belongs to the intended installation.');
  }
  // Compatibility fallback for legacy plain-text diagnostics only; explicit
  // typed errors have already been given their own recovery paths.
  if (/DESKTOP_UPDATE_REQUIRED/.test(detail ?? '')) return updateRequired();
  if (/INSTALLATION_MISMATCH/.test(detail ?? '')) return installationMismatch();
  if (/timed out|timeout/i.test(detail ?? '')) {
    return known('Connection check timed out',
      'The system did not respond in time. File opening remains available; Refresh or open Support to check the AI connection.',
      'Use Refresh status for a new full observation. This does not repeat the original action.',
      'The current connection status and outcome of the original action.',
      'refresh-status');
  }
  return known('Action could not be completed',
    'The requested action was not confirmed. Open Support for the technical details before trying again.',
    'Review the recorded technical error before deciding whether to try again.',
    'Whether the requested operation completed.');
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

/**
 * An explicit ensure_ready receipt may report NEEDS_ATTENTION without throwing
 * a command error. Convert it through the same presentation-only recovery
 * contract; never classify a failed handshake as installation success.
 */
export function readinessFailureNotice(
  result: EnsureReadyResult, context: 'connect' | 'install',
): DesktopErrorNotice {
  const title = context === 'connect'
    ? 'Blockbench connection needs attention' : 'Setup needs attention';
  const message = context === 'connect'
    ? connectionReadinessError(result) : installationReadinessError(result);
  let nextStep = 'Review the current Blockbench and AI connection setup.';
  let action: DesktopRecoveryAction = 'open-support';
  switch (result.reason) {
    case 'BLOCKBENCH_PROFILE_MISMATCH':
      nextStep = 'Save your models, then review the installed Blockbench profile before switching editors.';
      break;
    case 'PLUGIN_INTEGRITY':
      nextStep = 'Review the existing plugin; do not replace an edited file automatically.';
      break;
    case 'RUNTIME_ENDPOINT_MISMATCH':
      nextStep = 'Compare the active local connection settings before reconnecting.';
      break;
    case 'RUNTIME_START_FAILED':
      nextStep = 'Review the Runtime startup details before reconnecting.';
      break;
    case 'BLOCKBENCH_EXITED':
      nextStep = 'Open Blockbench explicitly from Workspace, then reconnect if needed.';
      action = null;
      break;
    case 'CONNECTION_PROBE_UNKNOWN':
      nextStep = 'Refresh status to check the current connection. A status check does not repeat setup.';
      action = 'refresh-status';
      break;
  }
  return {
    title, message, detail: null,
    recovery: {
      nextStep,
      confirmationNeeded: context === 'connect'
        ? 'The intended Blockbench Runtime and AI connection have not been confirmed ready.'
        : 'Setup completion does not confirm an active Blockbench Runtime and AI session.',
      action,
    },
  };
}

export const progressLabel = (stage: string) => stage.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

/** Pure project-list projections; native ownership and file actions stay in App. */
export type ProjectModelTarget = { project: ProjectNavigationProject; model: ProjectNavigationModel };

export function visibleProjects(state: ProjectNavigation, search: string, showAll: boolean): ProjectNavigationProject[] {
  const query = search.trim().toLowerCase();
  const matches = state.projects.filter(project =>
    !query || project.name.toLowerCase().includes(query)
      || project.models.some(model => model.name.toLowerCase().includes(query))
  );
  return query || showAll ? matches : matches.slice(0, 6);
}

/**
 * Keyboard search may open only one available, non-active model whose NAME
 * matches the query. Project-name matches, duplicate names and missing files
 * must never be inferred as a safe Enter target. Native Rust still validates
 * the opaque model ID and actual path when a user explicitly requests Open.
 */
export function uniqueModelSearchTarget(state: ProjectNavigation, search: string): ProjectModelTarget | null {
  const query = search.trim().toLowerCase();
  if (!query) return null;
  let target: ProjectModelTarget | null = null;
  for (const project of state.projects) {
    if (!project.available) continue;
    for (const model of project.models) {
      if (!model.exists || model.active || !model.name.toLowerCase().includes(query)) continue;
      if (target !== null) return null;
      target = { project, model };
    }
  }
  return target;
}

export function visibleProjectModels(project: ProjectNavigationProject, search: string): ProjectNavigationModel[] {
  const query = search.trim().toLowerCase();
  if (!query || project.name.toLowerCase().includes(query)) return project.models;
  return project.models.filter(model => model.name.toLowerCase().includes(query));
}

/** Resolve recent IDs in their source order with a single pass over model inventory. */
export function recentModelTargets(state: ProjectNavigation): ProjectModelTarget[] {
  const recentIds = state.recent_model_ids ?? [];
  if (recentIds.length === 0) return [];
  const relevant = new Set(recentIds);
  const targets = new Map<string, ProjectModelTarget>();
  for (const project of state.projects) {
    for (const model of project.models) {
      if (relevant.has(model.id) && !targets.has(model.id) &&
          model.exists && !model.active && model.id !== state.continue_model_id) {
        targets.set(model.id, { project, model });
      }
    }
  }
  return recentIds.flatMap(id => {
    const target = targets.get(id);
    return target ? [target] : [];
  });
}

export function continueTarget(state: ProjectNavigation): ProjectModelTarget | null {
  if (state.active || !state.continue_model_id) return null;
  for (const project of state.projects) {
    const model = project.models.find(candidate => candidate.id === state.continue_model_id && candidate.exists);
    if (model) return { project, model };
  }
  return null;
}

