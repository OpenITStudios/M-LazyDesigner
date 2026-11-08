<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount, tick } from 'svelte';
  import WorkspacePage from './WorkspacePage.svelte';
  import UnifiedWorkspacePage from './UnifiedWorkspacePage.svelte';
  import { INITIAL_EDITOR_LAYOUT, type EditorLayoutState } from './editorLayout';
  import ProjectDeleteDialog from './ProjectDeleteDialog.svelte';
  import SupportPage from './SupportPage.svelte';
  import AnalyticsPage from './AnalyticsPage.svelte';
  import { createSetupOperations } from './setupOperations';
  import { createConnectionMonitor } from './connectionMonitor';
  import { createEditorOperations } from './editorOperations';
  import { createMaintenanceOperations, planManagedAction } from './maintenanceOperations';
  import { subscribeManagedProgress } from './managedProgress';
  import { createDevFixtureStatus, createDevAnalyticsFixture, devFixtureFromLocation, FIXTURE_NOW_MS, type DevFixture } from './desktopFixtures';
  import { observeStatus } from './statusObservation';
  import { isSafeFileNavigationAction, type ProjectAction, type ProjectDeletePreview, type ProjectDeleteResult } from './projectNavigationTypes';
  import type {
    SystemStatus, ConnectionStatus, PluginFileActionResult, DesktopBusyAction, DesktopOperationRecord,
    ManagedUpdateCheck, EnsureReadyResult,
    DesktopCommandError, DiagnosticExportResult, ProjectNavigationActionResult,
    ProjectPathResult, ManagedProgress, BlockbenchSelectionResult,
    AnalyticsOverview, AnalyticsExportResult,
  } from './desktopTypes';
  import { productMode, progressLabel, managedActionLabel, desktopErrorNotice, readinessFailureNotice, type DesktopErrorRecovery } from './desktopPresentation';

  let status: SystemStatus | null = null;
  let loading = true;
  // A successful native receipt and a successful FULL status observation are
  // separate facts. Never promote the former into a fresh-UI claim.
  let lastFullStatusRefreshSucceeded = false;
  let error = '';
  let errorTitle = 'Action could not be completed';
  let errorDetail: string | null = null;
  let errorRecovery: DesktopErrorRecovery | null = null;
  let busyAction: DesktopBusyAction | null = null;
  let openingModelId: string | null = null;
  // UI-only clock. Updated by the existing watcher and foreground events;
  // it never authorizes native actions or starts a second status monitor.
  let statusPresentationNowMs = Date.now();
  let pluginApprovalNeeded = false;
  let migrationConflict = false;
  let migrationConflictKind: 'plugin' | 'client' = 'plugin';
  let setupStaged = false;
  let readinessReason = '';
  let actionMessage = '';
  let actionMessageKind: 'success' | 'pending' | 'unchanged' = 'success';
  let progressStage = '';
  let actionToastTimer: number | null = null;
  let utilityMenuOpen = false;
  let statusProbeFailures = 0;
  let devFixture: DevFixture | null = null;
  const connectionMonitor = createConnectionMonitor({
    current: () => ({ status, busy: busyAction !== null, fixture: devFixture !== null }),
    observe: () => observeStatus(invoke<ConnectionStatus>('connection_status'), 10_000),
    refresh: () => refresh(),
    onFailures: failures => {
      statusProbeFailures = failures;
      if (!devFixture) statusPresentationNowMs = Date.now();
    },
  });
  let updateCheck: ManagedUpdateCheck | null = null;
  const editorOperations = createEditorOperations(invoke);
  const setupOperations = createSetupOperations(invoke);
  const maintenanceOperations = createMaintenanceOperations(invoke);
  type Page = 'Overview' | 'Editor' | 'Analytics' | 'Support';
  let page: Page = 'Overview';
  let nativeEditorStage: { detach: () => Promise<boolean> } | undefined;
  // Retain UI-only panel preferences across Workspace/Support navigation.
  // This is not a model setting, native status, or persisted file.
  let editorLayout: EditorLayoutState = { ...INITIAL_EDITOR_LAYOUT };
  let analytics: AnalyticsOverview | null = null;
  let analyticsLoading = false;
  let analyticsError = '';
  let analyticsExporting = false;
  // Ephemeral view preferences survive Workspace/Support navigation only.
  let expandedProjectId: string | null = null;
  let showAllProjects = false;
  let projectSearch = '';
  let workspaceScrollTop = 0;
  let workspaceMain: HTMLElement | undefined;
  let deleteReview: ProjectDeletePreview | null = null;
  // Support already presents the full classified error in its own section.
  // Keep one non-blocking announcement elsewhere; do not cover model controls.
  $: attentionError = page === 'Support' && status ? '' : error;


  let operations: DesktopOperationRecord[] = [];

  function recordOperation(action: string, outcome: 'success' | 'pending' | 'unchanged' | 'failed', status: string) {
    operations = [
      { action, outcome, status, at: new Date().toLocaleTimeString() },
      ...operations,
    ].slice(0, 8);
  }

  // A composed native editor must be restored BEFORE showing another
  // application page, not merely after Svelte has removed its aperture.
  function navigate(next: Page) {
    if (page === 'Editor' && next !== 'Editor' && nativeEditorStage) {
      void nativeEditorStage.detach().then(restored => {
        if (restored) finishNavigate(next);
      }).catch(reportError);
      return;
    }
    finishNavigate(next);
  }

  function finishNavigate(next: Page) {
    utilityMenuOpen = false;
    if (next === page) return;
    if (page === 'Overview' && workspaceMain) workspaceScrollTop = workspaceMain.scrollTop;
    page = next;
    if (next === 'Analytics') void refreshAnalytics();
    void tick().then(() => {
      if (page !== next) return;
      if (next === 'Overview' && workspaceMain) workspaceMain.scrollTop = workspaceScrollTop;
      // Announce the new view even when the standard toolbar is intentionally absent.
      if (next === 'Editor') document.querySelector<HTMLElement>('.editor-header h1')?.focus();
      else document.querySelector<HTMLElement>('.page-toolbar h1')?.focus();
    });
  }

  function closeUtilityMenu() {
    utilityMenuOpen = false;
  }

  function closeActionDisclosures(restoreFocus = false) {
    const openDisclosures = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.more-menu[open]'));
    const active = document.activeElement;
    const focusedDisclosure = openDisclosures.find(menu => menu.contains(active));
    for (const menu of openDisclosures) menu.open = false;
    utilityMenuOpen = false;
    if (restoreFocus) focusedDisclosure?.querySelector<HTMLElement>('summary')?.focus();
  }

  function clearActionToast() {
    if (actionToastTimer !== null) window.clearTimeout(actionToastTimer);
    actionToastTimer = null;
    actionMessage = '';
    actionMessageKind = 'success';
  }

  function clearActionFeedback() {
    error = '';
    errorDetail = null;
    errorRecovery = null;
    clearActionToast();
  }

  function showActionToast(
    message: string,
    kind: 'success' | 'pending' | 'unchanged' = 'success'
  ) {
    if (actionToastTimer !== null) window.clearTimeout(actionToastTimer);
    actionToastTimer = null;
    error = '';
    errorDetail = null;
    errorRecovery = null;
    actionMessageKind = kind;
    actionMessage = message;
    // A next step must stay available until dismissed or superseded.
    if (kind === 'pending') return;
    actionToastTimer = window.setTimeout(() => {
      actionMessage = '';
      actionToastTimer = null;
    }, 6500);
  }


  function errorCode(cause: unknown): string {
    if (typeof cause === 'object' && cause !== null && 'code' in cause) {
      const value = (cause as Partial<DesktopCommandError>).code;
      if (typeof value === 'string' && value) return value;
    }
    return 'FAILED';
  }

  function reportError(cause: unknown) {
    // A failed action supersedes any earlier success or pending guidance.
    clearActionToast();
    const notice = desktopErrorNotice(cause);
    error = notice.message;
    errorTitle = notice.title;
    errorDetail = notice.detail;
    errorRecovery = notice.recovery;
  }

  function reportReadinessFailure(result: EnsureReadyResult, context: 'connect' | 'install') {
    clearActionToast();
    const notice = readinessFailureNotice(result, context);
    error = notice.message;
    errorTitle = notice.title;
    errorDetail = notice.detail;
    errorRecovery = notice.recovery;
  }

  async function refresh() {
    closeUtilityMenu();
    loading = true;
    lastFullStatusRefreshSucceeded = false;
    error = '';
    errorDetail = null;
    errorRecovery = null;
    // Development-only visual fixtures render without Tauri, Runtime, or filesystem access.
    if (devFixture) {
      status = createDevFixtureStatus(devFixture);
      statusPresentationNowMs = FIXTURE_NOW_MS;
      lastFullStatusRefreshSucceeded = true;
      loading = false;
      return;
    }
    try {
      status = await observeStatus(invoke<SystemStatus>('system_status'), 30_000);
      statusPresentationNowMs = Date.now();
      setupStaged = !status?.manager_available && status?.bootstrap_pending === true;
      lastFullStatusRefreshSucceeded = true;
      connectionMonitor.fullStatusSucceeded();
    } catch (cause) {
      // A failed full observation must never leave actions enabled using
      // the last successful snapshot. Only full status can clear this gate.
      connectionMonitor.fullStatusFailed();
      reportError(cause);
    } finally {
      loading = false;
    }
  }

  /**
   * A native operation may be acknowledged while the subsequent full
   * system_status observation fails. Keep its receipt distinct from machine
   * readiness; do not show a completed/ready toast or repeat the operation.
   * refresh() retains the original status error as Support technical detail.
   */
  function reportStatusAfterAcknowledgment(action: string): void {
    // Preserve the full-status failure detail in Support, but distinguish
    // it from a failed native operation/receipt.
    errorTitle = 'Action acknowledged; current status not verified';
    error = `${action} returned a native result, but Desktop could not refresh its current state. Do not repeat the action just because verification failed.`;
    errorRecovery = {
      nextStep: 'Refresh status to check current state. Do not repeat the original action solely because the status check failed.',
      confirmationNeeded: 'Current Desktop/Blockbench state after the native acknowledgement.',
      action: 'refresh-status',
    };
  }

  async function refreshAfterAcknowledgment(action: string): Promise<boolean> {
    await refresh();
    if (lastFullStatusRefreshSucceeded) return true;
    reportStatusAfterAcknowledgment(action);
    return false;
  }

  async function runProjectAction(action: ProjectAction, id: string) {
    if (devFixture || busyAction || (statusProbeFailures >= 2 && !isSafeFileNavigationAction(action))) return;
    // Explorer-only actions re-resolve opaque IDs in Rust and remain available
    // while AI status is unverified; preference mutations still require Refresh.
    if (action === 'restore-project-preferences' &&
        !window.confirm('Restore the last saved project pins? The damaged settings file will be retained.')) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    clearActionFeedback();
    try {
      const result = await invoke<ProjectNavigationActionResult>('project_navigation_action', { action, id });
      if (action === 'pin-project' || action === 'unpin-project' ||
          action === 'remove-project-folder' || action === 'restore-project-preferences') {
        if (!(await refreshAfterAcknowledgment('Project shortcut change'))) return;
      }
      if (result.status === 'REMOVED_FROM_LIST') showActionToast('Removed from Workspace. Your files were not deleted.');
      else if (result.status === 'PINNED') showActionToast('Project pinned.');
      else if (result.status === 'UNPINNED') showActionToast('Project unpinned.');
      else if (result.status === 'RESTORED') showActionToast('Project shortcuts restored. Your model files were not changed.');
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function addProjectFolder() {
    if (devFixture || busyAction || statusProbeFailures >= 2) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    clearActionFeedback();
    try {
      const result = await invoke<ProjectNavigationActionResult>('add_project_folder');
      if (result.status === 'ADDED' || result.status === 'ALREADY_ADDED') {
        if (!(await refreshAfterAcknowledgment('Project folder selection'))) return;
        showActionToast(result.status === 'ADDED'
          ? 'Project folder added. Your files were not changed.'
          : 'This folder is already in your projects.');
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function beginDeleteProject(id: string) {
    if (devFixture || busyAction || deleteReview || statusProbeFailures >= 2) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    clearActionFeedback();
    try {
      deleteReview = await invoke<ProjectDeletePreview>('prepare_delete_project', { id });
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  function cancelDeleteProject() {
    const review = deleteReview;
    deleteReview = null;
    if (review) void invoke('cancel_delete_project', { token: review.token }).catch(() => {});
  }

  async function confirmDeleteProject() {
    if (devFixture || busyAction || !deleteReview || statusProbeFailures >= 2) return;
    const review = deleteReview;
    busyAction = 'project-action';
    clearActionFeedback();
    try {
      const result = await invoke<ProjectDeleteResult>('confirm_delete_project', { token: review.token });
      deleteReview = null;
      expandedProjectId = null;
      // The Windows receipt may be RECYCLED or RECYCLED_SHORTCUT_RETAINED;
      // neither proves this Desktop's next full status is available.
      recordOperation('Move Project to Recycle Bin', result.status === 'RECYCLED' ? 'success' : 'pending', result.status);
      const verifiedStatus = await refreshAfterAcknowledgment('Recycle Bin operation');
      // The recycled project's action trigger may no longer exist after refresh.
      await tick();
      document.querySelector<HTMLElement>('.page-toolbar h1')?.focus();
      if (!verifiedStatus) return;
      showActionToast(result.message, result.status === 'RECYCLED' ? 'success' : 'pending');
    } catch (cause) {
      deleteReview = null;
      recordOperation('Move Project to Recycle Bin', 'failed', errorCode(cause));
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function openModel(id?: string) {
    if (devFixture || busyAction) return;
    busyAction = id === undefined ? 'browse-model' : 'project-action';
    openingModelId = id ?? null;
    clearActionFeedback();
    try {
      const feedback = await editorOperations.openModel(id);
      if (feedback !== null) {
        if (!(await refreshAfterAcknowledgment('Model launch'))) return;
        showActionToast(
          feedback.message,
          feedback.verification === 'confirmed-active' ? 'success' : 'pending',
        );
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      openingModelId = null;
      busyAction = null;
    }
  }

  async function focusCurrentEditor() {
    if (devFixture || busyAction || statusProbeFailures >= 2) return;
    busyAction = 'open-editor';
    clearActionFeedback();
    try {
      const focused = await editorOperations.focus();
      showActionToast(focused
        ? 'Blockbench window focus confirmed.'
        : 'Windows could not confirm Blockbench focus. Select Blockbench from the taskbar.',
        focused ? 'success' : 'pending');
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function chooseBlockbenchExecutable() {
    if (devFixture || busyAction || statusProbeFailures >= 2) return;
    busyAction = 'choose-editor';
    clearActionFeedback();
    try {
      const result = await invoke<BlockbenchSelectionResult>('choose_blockbench_executable');
      if (result.status === 'SELECTED') {
        if (!(await refreshAfterAcknowledgment('Blockbench executable selection'))) return;
        showActionToast('Blockbench installation selected. No model files or managed plugins were changed.');
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function openBlockbenchEditor() {
    if (devFixture || busyAction || statusProbeFailures >= 2) return;
    busyAction = 'open-editor';
    clearActionFeedback();
    try {
      const feedback = await editorOperations.openEditor();
      if (!(await refreshAfterAcknowledgment('Blockbench editor launch'))) return;
      showActionToast(feedback.message, feedback.verification === 'focused' ? 'success' : 'pending');
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function copyNavigationPath(id: string) {
    if (devFixture || busyAction) return;
    try {
      closeActionDisclosures(true);
      const result = await invoke<ProjectPathResult>('project_navigation_path', { id });
      await navigator.clipboard.writeText(result.path);
      showActionToast('Path copied.');
    } catch (cause) {
      reportError(cause);
    }
  }

  function applyReadiness(result: EnsureReadyResult) {
    pluginApprovalNeeded = result.manual_plugin_approval_recommended;
    readinessReason = result.reason;
  }

  async function connectBlockbench() {
    if (devFixture) return;
    if (!status?.manager_available || busyAction || statusProbeFailures >= 2) return;
    closeUtilityMenu();
    busyAction = 'connect-blockbench';
    clearActionFeedback();
    try {
      const result = await setupOperations.connect({ refresh, onReadiness: applyReadiness });
      if (!lastFullStatusRefreshSucceeded) {
        // ensure_ready returned, but its full machine snapshot did not.
        reportStatusAfterAcknowledgment('Blockbench connection');
        return;
      }
      if (result.status === 'READY' && (status?.product_state !== 'ready' || status.readiness.ready !== true)) {
        showActionToast('Connection returned a ready result, but the latest Desktop status did not confirm a current AI session. Verify the AI client or Refresh status.', 'pending');
        return;
      }
      if (result.status === 'RUNTIME_READY' && status?.runtime_ready !== true) {
        showActionToast('Connection returned a Runtime-ready result, but the latest Desktop check did not confirm the Runtime. Refresh status before reconnecting.', 'pending');
        return;
      }
      if (result.status === 'READY' || result.status === 'RUNTIME_READY') {
        const focused = await editorOperations.focus();
        const connection = result.reason === 'MCP_SESSION_UNVERIFIED'
          ? 'Gateway process detected; verify the MCP session in your AI client.'
          : result.status === 'READY' ? 'AI connection is ready.' : 'AI client can connect when needed.';
        showActionToast(focused
          ? `Blockbench window focus confirmed. ${connection}`
          : `Blockbench is ready. Select it from the taskbar if needed. ${connection}`,
          result.status === 'READY' && result.reason !== 'MCP_SESSION_UNVERIFIED' ? 'success' : 'pending');
      } else if (result.status === 'NEEDS_ATTENTION' && result.reason !== 'PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING') {
        reportReadinessFailure(result, 'connect');
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function showRetiredPluginFile() {
    if (busyAction) return;
    try {
      await invoke<PluginFileActionResult>('show_retired_plugin_file');
      showActionToast('Existing plugin file selected in File Explorer. No files were changed.');
    } catch (cause) {
      reportError(cause);
    }
  }

  async function installLazyDesigner() {
    if (devFixture) return;
    return performInstall(false);
  }

  async function performInstall(migrateLegacy: boolean) {
    if (devFixture) return;
    if (!status?.bootstrap_available || status.manager_available || busyAction || statusProbeFailures >= 2) return;
    busyAction = 'install';
    migrationConflict = false;
    setupStaged = false;
    clearActionFeedback();
    try {
      const outcome = await setupOperations.install({
        refresh,
        onReadiness: applyReadiness,
        onBootstrap: feedback => {
          recordOperation('Install LazyDesigner', feedback.kind, feedback.status);
          setupStaged = !feedback.verifyRuntime;
        },
      }, migrateLegacy);
      if (!lastFullStatusRefreshSucceeded) {
        // A verified bootstrap receipt is not a verified post-install snapshot.
        reportStatusAfterAcknowledgment('LazyDesigner setup');
        return;
      }
      const ready = outcome.readiness;
      if (!ready) {
        showActionToast(outcome.feedback.message, outcome.feedback.kind);
        return;
      }
      if (ready.status === 'READY' && (status?.product_state !== 'ready' || status.readiness.ready !== true)) {
        showActionToast('Setup returned a ready result, but Desktop has not confirmed the current AI session. Check the AI client before treating setup as fully ready.', 'pending');
      } else if (ready.status === 'RUNTIME_READY' && status?.runtime_ready !== true) {
        showActionToast('Setup returned a Runtime-ready result, but Desktop has not confirmed the current Blockbench Runtime. Refresh status before relying on the connection.', 'pending');
      } else if (ready.status === 'READY') showActionToast('Setup complete. LazyDesigner is ready.');
      else if (ready.status === 'RUNTIME_READY') showActionToast('Setup complete. Blockbench is ready.');
      else if (ready.status === 'NEEDS_ATTENTION') {
        reportReadinessFailure(ready, 'install');
      }
    } catch (cause) {
      recordOperation('Install LazyDesigner', 'failed', errorCode(cause));
      if (errorCode(cause) === 'LEGACY_PLUGIN_MIGRATION_REQUIRED' ||
          errorCode(cause) === 'LEGACY_CLIENT_MIGRATION_REQUIRED') {
        migrationConflictKind = errorCode(cause) === 'LEGACY_CLIENT_MIGRATION_REQUIRED' ? 'client' : 'plugin';
        migrationConflict = true;
        error = '';
        errorDetail = null;
        errorRecovery = null;
      } else {
        reportError(cause);
      }
    } finally {
      busyAction = null;
    }
  }

  async function showPluginFile() {
    if (devFixture) return;
    if (!status?.manager_available || busyAction) return;
    closeUtilityMenu();
    busyAction = 'show-plugin';
    error = '';
    errorDetail = null;
    errorRecovery = null;
    try {
      await invoke<PluginFileActionResult>('show_plugin_file');
      const approvalPending = pluginApprovalNeeded && productMode(status) === 'plugin-setup';
      showActionToast(approvalPending
        ? 'Plugin file highlighted. Approve it in Blockbench if prompted.'
        : 'Plugin file highlighted in File Explorer.', approvalPending ? 'pending' : 'success');
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function refreshAnalytics(): Promise<void> {
    if (analyticsLoading) return;
    analyticsLoading = true;
    analyticsError = '';
    analytics = null; // Never show a stale snapshot as if it were current.
    try {
      analytics = devFixture ? createDevAnalyticsFixture() : await invoke<AnalyticsOverview>('analytics_overview');
    } catch {
      analyticsError = 'The local Gateway analytics cache could not be read. Select Refresh to retry.';
    } finally {
      analyticsLoading = false;
    }
  }

  async function copyAnalyticsJson(): Promise<void> {
    if (!analytics || analyticsLoading) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(analytics, null, 2));
      showActionToast('Analytics JSON copied. No data was uploaded.');
    } catch {
      analyticsError = 'Could not copy Analytics. You can use Export JSON instead.';
    }
  }

  async function exportAnalyticsJson(): Promise<void> {
    if (!analytics || analyticsLoading || analyticsExporting) return;
    if (devFixture) {
      analyticsError = 'Visual preview only. Export is unavailable in fixtures.';
      return;
    }
    analyticsExporting = true;
    analyticsError = '';
    try {
      const result = await invoke<AnalyticsExportResult>('export_analytics');
      if (result.status === 'EXPORTED') {
        showActionToast('Analytics JSON exported. No data was uploaded.');
      }
    } catch {
      analyticsError = 'Could not export Analytics to the selected file.';
    } finally {
      analyticsExporting = false;
    }
  }

  async function exportDiagnostics() {
    if (busyAction) return;
    closeUtilityMenu();
    busyAction = 'export-diagnostics';
    clearActionFeedback();
    try {
      const result = await invoke<DiagnosticExportResult>('export_diagnostics');
      if (result.status === 'EXPORTED') showActionToast('Diagnostics exported successfully.');
      else actionMessage = '';
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function checkManagedUpdateOnce() {
    const result = await maintenanceOperations.checkUpdate(!devFixture && !!status?.manager_available);
    if (result !== undefined) updateCheck = result;
  }

  async function verifyPendingUpdate() {
    if (devFixture || busyAction || !status?.manager_available || !status.managed?.pending) return;
    maintenanceOperations.resetUpdateCheck();
    await checkManagedUpdateOnce();
  }

  async function runManagedAction(action: 'update' | 'rollback' | 'recover' | 'repair' | 'setup-tls') {
    if (devFixture) return;
    if (!status?.manager_available || busyAction || statusProbeFailures >= 2) return;
    const request = planManagedAction(action, status, updateCheck);
    if (!request) return;
    const actionLabel = managedActionLabel(action);
    closeUtilityMenu();
    busyAction = action;
    progressStage = 'preflight';
    clearActionFeedback();
    try {
      const feedback = await maintenanceOperations.execute(request);
      recordOperation(actionLabel, feedback.kind, feedback.status);
      if (action === 'update') updateCheck = null;
      if (!(await refreshAfterAcknowledgment(actionLabel))) return;
      showActionToast(feedback.message, feedback.kind);
      if (action === 'update') {
        // Staging is not installation. Re-validate the local staged package
        // after this explicit update action so the user can finish without
        // restarting Desktop or relying on an old startup-only result.
        updateCheck = null;
        if (feedback.status === 'STAGED') {
          maintenanceOperations.resetUpdateCheck();
          await checkManagedUpdateOnce();
        }
      }
    } catch (cause) {
      recordOperation(actionLabel, 'failed', errorCode(cause));
      reportError(cause);
    } finally {
      busyAction = null;
      progressStage = '';
    }
  }

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || deleteReview) return;
      if (event.key === 'Escape' && document.querySelector('details.more-menu[open]')) {
        event.preventDefault();
        closeActionDisclosures(true);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.more-menu[open]')) {
        if (!menu.contains(target)) menu.open = false;
      }
      if (!target.closest('details.more-menu')) utilityMenuOpen = false;
    };
    const onVisibilityChange = () => {
      if (document.hidden) connectionMonitor.stop();
      else {
        if (!devFixture) statusPresentationNowMs = Date.now();
        connectionMonitor.request();
      }
    };
    const onFocus = () => {
      if (!devFixture) statusPresentationNowMs = Date.now();
      connectionMonitor.request();
    };
    devFixture = devFixtureFromLocation(import.meta.env.DEV, window.location.search);
    if (devFixture) statusPresentationNowMs = FIXTURE_NOW_MS;
    if (devFixture) {
      // A direct, development-only view selector for deterministic screenshots.
      const view = new URLSearchParams(window.location.search).get('view');
      if (view === 'support') page = 'Support';
      else if (view === 'editor') page = 'Editor';
      else if (view === 'analytics') {
        page = 'Analytics';
        void refreshAnalytics();
      }
    }
    if (devFixture === 'approval-required') {
      pluginApprovalNeeded = true;
      readinessReason = 'RUNTIME_TIMEOUT_WITH_HEALTHY_PLUGIN';
    } else if (devFixture === 'plugin-missing') {
      readinessReason = 'PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING';
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (devFixture) {
      void refresh().then(() => {
        if (devFixture === 'status-unverified') statusProbeFailures = 2;
        // Browser-only opening-row specimen: never invokes Tauri or a file.
        if (devFixture === 'ready' && new URLSearchParams(window.location.search).get('activity') === 'opening-model') {
          busyAction = 'project-action';
          openingModelId = 'model-fixture-2';
        }
        // Fixed development-only feedback specimens for layout/copy review.
        // Do not invoke native commands or accept arbitrary query text.
        const preview = new URLSearchParams(window.location.search).get('feedback');
        if (preview === 'pending') {
          actionMessageKind = 'pending';
          actionMessage = 'Model launch sent, but the active tab is not verified. Select Blockbench and check the model.';
        } else if (preview === 'success') {
          actionMessageKind = 'success';
          actionMessage = 'Model confirmed active in the matching Blockbench session.';
        } else if (preview === 'error') {
          errorTitle = 'Model could not be opened';
          error = 'The model launch was not confirmed. Open Support for technical details before trying again.';
          errorRecovery = desktopErrorNotice({ code: 'UNVERIFIED_MODEL_LAUNCH', message: 'Model launch was not confirmed.' }).recovery;
        } else if (preview === 'timeout') {
          reportError(new Error('Status request timed out. Refresh to retry.'));
        } else if (preview === 'delete-uncertain') {
          reportError({ code: 'PROJECT_RECYCLE_FAILED', message: 'Native recycle status uncertain.' });
        }
      });
    } else {
      void refresh().then(() => {
        void checkManagedUpdateOnce();
        connectionMonitor.request();
      });
    }
    const stopProgressListener = devFixture ? () => {} : subscribeManagedProgress(
      receive => listen<ManagedProgress>('managed-progress', event => receive(event.payload)),
      progress => {
        if (busyAction && progress.action === busyAction) progressStage = progress.stage;
      },
    );
    return () => {
      if (deleteReview) cancelDeleteProject();
      connectionMonitor.dispose();
      stopProgressListener();
      if (actionToastTimer !== null) window.clearTimeout(actionToastTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

</script>

{#snippet navIcon(item: 'Overview' | 'Support')}
  {#if item === 'Overview'}
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5"/><path d="M8 9h8M8 13h5"/></svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14M7.5 11h9M9.5 15.5h5"/><circle cx="12" cy="19" r="1"/></svg>
  {/if}
{/snippet}

{#if loading && !status}
  <main class="loading-screen" aria-live="polite">
    <span class="loading-spinner"></span>
    <span>Loading LazyDesigner…</span>
  </main>
{:else}
  <a class="skip-link" href="#main-content">Skip to content</a>

  <div class="desktop-shell" class:editor-shell={page === 'Editor' && import.meta.env.DEV} data-qa-fixture={devFixture ?? undefined}>
    {#if page !== 'Editor' || !import.meta.env.DEV}
    <aside class="navigation" aria-label="LazyDesigner navigation">
      <div class="navigation-brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <strong>LazyDesigner</strong>
      </div>

      <nav class="global-nav">
        {#if import.meta.env.DEV && (!devFixture || page === 'Editor')}
          <button class:active={page === 'Editor'} aria-current={page === 'Editor' ? 'page' : undefined} onclick={() => navigate('Editor')}>
            <span class="nav-icon">{@render navIcon('Overview')}</span><span>Unified Editor</span>
          </button>
        {/if}
        <button class:active={page === 'Overview'} aria-current={page === 'Overview' ? 'page' : undefined} onclick={() => navigate('Overview')}>
          <span class="nav-icon">{@render navIcon('Overview')}</span><span>Workspace</span>
        </button>
        <button class:active={page === 'Support' || page === 'Analytics'} aria-current={page === 'Support' || page === 'Analytics' ? 'page' : undefined} onclick={() => navigate('Support')}>
          <span class="nav-icon">{@render navIcon('Support')}</span><span>Support</span>
        </button>
      </nav>
    </aside>
    {/if}

    <section id="main-content" class="main-view" tabindex="-1">
      {#if page !== 'Editor' || !import.meta.env.DEV}
      <header class="page-toolbar">
        <h1 tabindex="-1">{page === 'Overview' ? 'Workspace' : page}</h1>
        <div class="toolbar-actions">
          {#if devFixture}<span class="fixture-badge">Fixture · {devFixture}</span>{/if}
          {#if statusProbeFailures >= 2}<span class="status-probe-warning" role="status">AI status needs verification · Files remain accessible</span>{/if}
          {#if page === 'Overview'}
            <details class="more-menu" bind:open={utilityMenuOpen}>
              <summary aria-label="More actions">•••</summary>
              <div class="menu-popover">
                <button disabled={loading || busyAction !== null} onclick={refresh}>Refresh</button>
                <button disabled={busyAction !== null} onclick={() => navigate('Support')}>Connection & support</button>
              </div>
            </details>
          {/if}
        </div>
      </header>
      {/if}

      {#if attentionError || actionMessage || (busyAction && progressStage && page !== 'Overview')}
        <aside class:error={Boolean(attentionError)} class:success={Boolean(actionMessage) && !attentionError && actionMessageKind === 'success'} class:notice={Boolean(actionMessage) && !attentionError && actionMessageKind !== 'success'} class="operation-attention" role={attentionError ? 'alert' : 'status'} aria-live={attentionError ? 'assertive' : 'polite'}>
          <div class="attention-icon" aria-hidden="true">{attentionError ? '!' : actionMessage ? (actionMessageKind === 'success' ? '✓' : 'i') : '•'}</div>
          <div class="attention-copy">
            <strong>{attentionError ? errorTitle : actionMessage ? (actionMessageKind === 'pending' ? 'Next step' : actionMessageKind === 'unchanged' ? 'No change' : 'Done') : 'Working'}</strong>
            <span>{attentionError || actionMessage || progressLabel(progressStage)}</span>
            {#if attentionError && errorRecovery}<span class="attention-next-step">Next: {errorRecovery.nextStep}</span>{/if}
          </div>
          <div class="attention-actions">
            {#if attentionError && status && errorRecovery?.action === 'refresh-status'}
              <button type="button" onclick={refresh} disabled={loading || busyAction !== null}>Refresh status</button>
            {:else if attentionError && status && errorRecovery?.action === 'open-support'}
              <button type="button" onclick={() => navigate('Support')}>Open Support</button>
            {/if}
            {#if attentionError || actionMessage}<button type="button" class="dismiss" aria-label="Dismiss notification" onclick={clearActionFeedback}>×</button>{/if}
          </div>
        </aside>
      {/if}

      {#if page === 'Analytics'}
        <AnalyticsPage data={analytics} loading={analyticsLoading}
          error={analyticsError} exporting={analyticsExporting}
          refresh={refreshAnalytics} copyJson={copyAnalyticsJson} exportJson={exportAnalyticsJson}
          backToSupport={() => navigate('Support')}/>
      {:else if page === 'Editor' && import.meta.env.DEV}
        <UnifiedWorkspacePage bind:this={nativeEditorStage} bind:layout={editorLayout}
          {status} {loading} {busyAction} {openingModelId} {statusProbeFailures} {statusPresentationNowMs}
          fixture={devFixture !== null}
          {openModel} {addProjectFolder} {runProjectAction} {focusCurrentEditor} {openBlockbenchEditor} {refresh}
          navigateWorkspace={() => navigate('Overview')}
          navigateSupport={() => navigate('Support')}
          navigateActivity={() => navigate('Analytics')}
        />

      {:else if !status}
        <main class="page-content">
          <section class="message-state">
            <div class="message-icon danger">!</div>
            <div class="message-copy">
              <h2>LazyDesigner is unavailable</h2>
              <p>Desktop could not read the local LazyDesigner state.</p>
            </div>
            <button class="primary-button" onclick={refresh} disabled={loading}>Try again</button>
            <button class="secondary-button" onclick={() => openModel()} disabled={busyAction !== null}>Open Model…</button>
          </section>
        </main>

      {:else if page === 'Overview'}
        <WorkspacePage
          {status} {loading} {busyAction} {openingModelId} {statusPresentationNowMs} {progressStage} {statusProbeFailures}
          {pluginApprovalNeeded} {migrationConflict} {migrationConflictKind} {setupStaged}
          {readinessReason} {updateCheck}
          bind:expandedProjectId bind:showAllProjects bind:projectSearch bind:workspaceMain
          {openModel} {addProjectFolder} {beginDeleteProject} {focusCurrentEditor}
          {runProjectAction} {copyNavigationPath} {showRetiredPluginFile}
          {installLazyDesigner} {chooseBlockbenchExecutable} {openBlockbenchEditor}
          {connectBlockbench} {showPluginFile} {verifyPendingUpdate} {runManagedAction}
          {refresh} {navigate}
        />

      {:else}
        <SupportPage
          {status} {loading} {busyAction} {statusPresentationNowMs} {statusProbeFailures}
          {migrationConflict} {migrationConflictKind} {error} {errorTitle} {errorDetail} {errorRecovery} {operations}
          {refresh} {showRetiredPluginFile} {chooseBlockbenchExecutable}
          {showPluginFile} {exportDiagnostics} {runManagedAction}
          openAnalytics={() => navigate('Analytics')}
          migrateLegacySetup={() => performInstall(true)}
        />
      {/if}
    </section>
  </div>
{/if}

{#if deleteReview}
  <ProjectDeleteDialog review={deleteReview} busy={busyAction !== null} confirmBlocked={statusProbeFailures >= 2} onCancel={cancelDeleteProject} onConfirm={confirmDeleteProject} />
{/if}

<style>
  .loading-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--bg);color:var(--muted);font-size:var(--font-ui)}.loading-spinner{width:12px;height:12px;border:2px solid var(--surface-4);border-top-color:var(--accent);border-radius:50%;animation:desktop-spin .8s linear infinite}
  .skip-link{position:fixed;z-index:1000;top:8px;left:8px;transform:translateY(-150%);padding:8px 10px;border:1px solid var(--accent);border-radius:7px;background:var(--surface);color:var(--text);font-weight:700;text-decoration:none}.skip-link:focus{transform:translateY(0)}
  .desktop-shell{display:grid;grid-template-columns:168px minmax(0,1fr);width:100%;height:100vh;background:var(--bg)}
  .navigation{display:flex;flex-direction:column;padding:12px 9px;border-right:1px solid var(--border-soft);background:#0f1113}.navigation-brand{display:flex;align-items:center;gap:9px;padding:7px 8px 18px}.navigation-brand strong{font-size:var(--font-title);font-weight:700;letter-spacing:-.01em}.brand-mark{width:10px;height:10px;border-radius:3px;background:var(--accent)}.global-nav{display:grid;gap:2px}.global-nav button{min-height:36px;display:flex;align-items:center;gap:9px;padding:0 9px;border-radius:7px;background:transparent;color:var(--muted);font-size:var(--font-ui);font-weight:600;text-align:left;cursor:pointer}.global-nav button:hover{background:var(--surface);color:var(--text-soft)}.global-nav button.active{background:var(--surface);color:var(--text)}.nav-icon{width:17px;height:17px;display:grid;place-items:center}.nav-icon :global(svg){width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .main-view{min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}.page-toolbar{min-height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--border-soft);background:var(--bg)}.page-toolbar h1{margin:0;font-size:16px;font-weight:680;letter-spacing:-.015em}.toolbar-actions{display:flex;align-items:center;gap:6px}.fixture-badge{padding:3px 6px;border:1px solid var(--border);border-radius:5px;color:var(--muted-2);font-size:var(--font-xs)}
  .status-probe-warning{font-size:var(--font-sm);color:var(--warning)}
  .more-menu{position:relative}.more-menu summary{width:34px;height:34px;display:grid;place-items:center;list-style:none;border-radius:var(--radius-xs);color:var(--muted);cursor:pointer}.more-menu summary:hover,.more-menu[open] summary{background:var(--surface-2);color:var(--text)}.more-menu summary::-webkit-details-marker{display:none}.menu-popover{position:absolute;z-index:20;right:0;top:34px;width:168px;display:grid;padding:5px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);box-shadow:var(--shadow-popover)}.menu-popover button{width:100%;padding:7px 8px;border-radius:5px;background:transparent;color:var(--text-soft);text-align:left;cursor:pointer;font-size:var(--font-sm)}.menu-popover button:hover:not(:disabled){background:var(--surface-3)}
  .message-state{max-width:760px;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:start;gap:12px;padding-top:12px}.message-icon{width:26px;height:26px;display:grid;place-items:center;border-radius:6px;background:var(--surface-2);font-size:var(--font-ui);font-weight:800}.message-icon.danger{background:var(--danger-bg);color:var(--danger)}.message-copy h2{margin:0;font-size:16px}.message-copy p{margin:5px 0 0;color:var(--muted);font-size:var(--font-sm)}
  /* In-flow, contextual feedback: never obscures the model/project action area. */
  .operation-attention{flex:none;min-width:0;display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 24px;border-bottom:1px solid var(--border-soft);background:var(--bg-elevated)}
  .operation-attention.success{border-color:var(--accent-border)}
  .operation-attention.notice{border-color:var(--border-strong)}
  .operation-attention.error{background:var(--warning-bg);border-color:var(--warning)}
  .attention-icon{width:24px;height:24px;display:grid;place-items:center;border-radius:var(--radius-xs);background:var(--surface-3);font-size:var(--font-sm);font-weight:800}
  .success .attention-icon{background:var(--accent-soft);color:var(--accent)}
  .error .attention-icon{background:var(--surface-2);color:var(--warning)}
  .attention-copy{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;min-width:0}
  .attention-copy strong{font-size:var(--font-sm);font-weight:700}
  .attention-copy span{min-width:0;color:var(--text-soft);font-size:var(--font-sm);line-height:1.45;overflow-wrap:anywhere}
  .attention-copy .attention-next-step{width:100%;color:var(--muted);font-size:var(--font-sm);font-weight:600}
  .attention-actions{display:flex;align-items:center;gap:6px}
  .attention-actions button{min-height:32px;padding:5px 9px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface-2);color:var(--text-soft);font-size:var(--font-sm);font-weight:650;cursor:pointer}
  .attention-actions button:hover{background:var(--surface-3);color:var(--text)}
  .attention-actions .dismiss{width:32px;padding:0;border:0;background:transparent;font-size:19px}
  @media(max-width:760px){.operation-attention{padding:10px 16px;align-items:start}.attention-copy{display:grid;gap:3px}}

  /* The experimental editor owns exactly one host topbar. Native Blockbench
     owns its menu, modes, Outliner, UV panels and status independently. */
  .desktop-shell.editor-shell{background:#181b1f}
  .desktop-shell.editor-shell .main-view{background:#181b1f}
  .desktop-shell.editor-shell .operation-attention{padding:7px 14px;min-height:40px;background:#242a35;border-color:#394451}
  .desktop-shell.editor-shell .operation-attention.error{background:#312729}

  /* Workspace First: preserve content width with two top-level destinations. */
  .desktop-shell{display:flex;flex-direction:column}
  .navigation{min-height:56px;flex-direction:row;align-items:center;gap:20px;padding:0 24px;border-right:0;border-bottom:1px solid var(--border-soft)}
  .navigation-brand{padding:0;flex:none}
  .global-nav{display:flex;align-items:center;gap:4px}
  .global-nav button{padding:0 12px;white-space:nowrap}
  .main-view{height:auto;flex:1;min-height:0}
  .page-toolbar{min-height:48px}
  @media(max-width:760px){
    .navigation{min-height:54px;padding:0 12px;gap:10px}
    .navigation-brand{padding:0;justify-content:flex-start}
    .navigation-brand strong,.global-nav button>span:not(.nav-icon){display:inline}
    .global-nav button{padding:0 8px;gap:5px}
    .page-toolbar{padding:0 16px}
  }
  @media(max-width:520px){
    .operation-attention{grid-template-columns:24px minmax(0,1fr);gap:8px;padding:10px 12px}
    .attention-actions{grid-column:2;justify-content:flex-end}
    .navigation{gap:8px;padding:0 10px}
    .navigation-brand strong{display:none}
    .global-nav button{padding:0 6px}
    .page-toolbar{min-height:48px;flex-wrap:wrap;gap:6px;padding:8px 12px}
    .toolbar-actions{min-width:0;max-width:100%;flex-wrap:wrap;justify-content:flex-end}
    .status-probe-warning{max-width:100%;line-height:1.45;overflow-wrap:anywhere}
    .message-state{display:flex;align-items:flex-start;flex-wrap:wrap;gap:10px}
    .message-copy{flex:1 1 200px;min-width:0}
    .message-state button{max-width:100%;white-space:normal}
  }
</style>
