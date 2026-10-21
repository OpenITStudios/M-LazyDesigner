<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { onMount, tick } from 'svelte';
  import WorkspacePage from './WorkspacePage.svelte';
  import ProjectDeleteDialog from './ProjectDeleteDialog.svelte';
  import SupportPage from './SupportPage.svelte';
  import { createSetupOperations } from './setupOperations';
  import { createConnectionMonitor } from './connectionMonitor';
  import { createEditorOperations } from './editorOperations';
  import { createMaintenanceOperations, planManagedAction } from './maintenanceOperations';
  import { subscribeManagedProgress } from './managedProgress';
  import { applyDevFixture, devFixtureFromLocation, type DevFixture } from './desktopFixtures';
  import { observeStatus } from './statusObservation';
  import type { ProjectAction, ProjectDeletePreview, ProjectDeleteResult } from './projectNavigationTypes';
  import type {
    SystemStatus, ConnectionStatus, PluginFileActionResult, DesktopBusyAction, DesktopOperationRecord,
    ManagedUpdateCheck, EnsureReadyResult,
    DesktopCommandError, DiagnosticExportResult, ProjectNavigationActionResult,
    ProjectPathResult, ManagedProgress, BlockbenchSelectionResult,
  } from './desktopTypes';
  import { productMode, progressLabel, managedActionLabel, connectionReadinessError, installationReadinessError, desktopErrorNotice } from './desktopPresentation';

  let status: SystemStatus | null = null;
  let loading = true;
  let error = '';
  let errorTitle = 'Action could not be completed';
  let errorDetail: string | null = null;
  let busyAction: DesktopBusyAction | null = null;
  let pluginApprovalNeeded = false;
  let migrationConflict = false;
  let migrationConflictKind: 'plugin' | 'client' = 'plugin';
  let setupStaged = false;
  let readinessReason = '';
  let actionMessage = '';
  let actionMessageKind: 'success' | 'pending' | 'unchanged' = 'success';
  let progressStage = '';
  let successToastTimer: number | null = null;
  let utilityMenuOpen = false;
  let statusProbeFailures = 0;
  let devFixture: DevFixture | null = null;
  const connectionMonitor = createConnectionMonitor({
    current: () => ({ status, busy: busyAction !== null, fixture: devFixture !== null }),
    observe: () => observeStatus(invoke<ConnectionStatus>('connection_status'), 10_000),
    refresh: () => refresh(),
    onFailures: failures => { statusProbeFailures = failures; },
  });
  let updateCheck: ManagedUpdateCheck | null = null;
  const editorOperations = createEditorOperations(invoke);
  const setupOperations = createSetupOperations(invoke);
  const maintenanceOperations = createMaintenanceOperations(invoke);
  type Page = 'Overview' | 'Support';
  let page: Page = 'Overview';
  // Ephemeral view preferences survive Workspace/Support navigation only.
  let expandedProjectId: string | null = null;
  let showAllProjects = false;
  let projectSearch = '';
  let workspaceScrollTop = 0;
  let workspaceMain: HTMLElement | undefined;
  let deleteReview: ProjectDeletePreview | null = null;


  let operations: DesktopOperationRecord[] = [];

  function recordOperation(action: string, outcome: 'success' | 'pending' | 'unchanged' | 'failed', status: string) {
    operations = [
      { action, outcome, status, at: new Date().toLocaleTimeString() },
      ...operations,
    ].slice(0, 8);
  }

  function navigate(next: Page) {
    utilityMenuOpen = false;
    if (next === page) return;
    if (page === 'Overview' && workspaceMain) workspaceScrollTop = workspaceMain.scrollTop;
    page = next;
    if (next === 'Overview') {
      void tick().then(() => {
        if (page === 'Overview' && workspaceMain) workspaceMain.scrollTop = workspaceScrollTop;
      });
    }
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

  function clearSuccessToast() {
    if (successToastTimer !== null) window.clearTimeout(successToastTimer);
    successToastTimer = null;
    actionMessage = '';
    actionMessageKind = 'success';
  }

  function showSuccessToast(
    message: string,
    kind: 'success' | 'pending' | 'unchanged' = 'success'
  ) {
    if (successToastTimer !== null) window.clearTimeout(successToastTimer);
    actionMessageKind = kind;
    actionMessage = message;
    successToastTimer = window.setTimeout(() => {
      actionMessage = '';
      successToastTimer = null;
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
    const notice = desktopErrorNotice(cause);
    error = notice.message;
    errorTitle = notice.title;
    errorDetail = notice.detail;
  }

  async function refresh() {
    closeUtilityMenu();
    loading = true;
    error = '';
    errorDetail = null;
    try {
      status = await observeStatus(invoke<SystemStatus>('system_status'), 30_000);
      if (status && devFixture) status = applyDevFixture(status, devFixture);
      if (status?.manager_available) setupStaged = false;
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

  async function runProjectAction(action: ProjectAction, id: string) {
    if (devFixture || busyAction) return;
    // Local project bookmarks, selected-folder shortcuts and file actions
    // are revalidated by Rust. They never require the AI manager or Gateway.
    if (action === 'restore-project-preferences' &&
        !window.confirm('Restore the last saved project pins? The damaged settings file will be retained.')) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      await invoke<ProjectNavigationActionResult>('project_navigation_action', { action, id });
      if (action === 'pin-project' || action === 'unpin-project' ||
          action === 'remove-project-folder' || action === 'restore-project-preferences') await refresh();
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function addProjectFolder() {
    if (devFixture || busyAction) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const result = await invoke<ProjectNavigationActionResult>('add_project_folder');
      if (result.status === 'ADDED' || result.status === 'ALREADY_ADDED') {
        await refresh();
        showSuccessToast(result.status === 'ADDED'
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
    if (devFixture || busyAction || deleteReview) return;
    closeActionDisclosures(true);
    busyAction = 'project-action';
    error = '';
    errorDetail = null;
    clearSuccessToast();
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
    if (devFixture || busyAction || !deleteReview) return;
    const review = deleteReview;
    busyAction = 'project-action';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const result = await invoke<ProjectDeleteResult>('confirm_delete_project', { token: review.token });
      deleteReview = null;
      expandedProjectId = null;
      await refresh();
      recordOperation('Move Project to Recycle Bin', 'success', result.status);
      showSuccessToast(result.message, result.status === 'RECYCLED' ? 'success' : 'pending');
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
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const message = await editorOperations.openModel(id);
      if (message !== null) {
        await refresh();
        showSuccessToast(message);
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function focusCurrentEditor() {
    if (devFixture || busyAction) return;
    const focused = await editorOperations.focus();
    if (!focused) showSuccessToast('Select your Blockbench window from the taskbar.');
  }

  async function chooseBlockbenchExecutable() {
    if (devFixture || busyAction) return;
    busyAction = 'choose-editor';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const result = await invoke<BlockbenchSelectionResult>('choose_blockbench_executable');
      if (result.status === 'SELECTED') {
        await refresh();
        showSuccessToast('Blockbench installation selected. No model files or managed plugins were changed.');
      }
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function openBlockbenchEditor() {
    if (devFixture || busyAction) return;
    busyAction = 'open-editor';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const message = await editorOperations.openEditor();
      await refresh();
      showSuccessToast(message);
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
      showSuccessToast('Path copied.');
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
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const result = await setupOperations.connect({ refresh, onReadiness: applyReadiness });
      if (result.status === 'READY' || result.status === 'RUNTIME_READY') {
        const focused = await editorOperations.focus();
        const connection = result.status === 'READY' ? 'AI connection is ready.' : 'AI client can connect when needed.';
        showSuccessToast(focused
          ? `Blockbench window focus confirmed. ${connection}`
          : `Blockbench is ready. Select it from the taskbar if needed. ${connection}`);
      } else if (result.status === 'NEEDS_ATTENTION' && result.reason !== 'PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING') {
        error = connectionReadinessError(result);
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
      showSuccessToast('Existing plugin file selected in File Explorer. No files were changed.');
    } catch (cause) {
      reportError(cause);
    }
  }

  async function installLazyDesigner() {
    if (devFixture) return;
    if (!status?.bootstrap_available || status.manager_available || busyAction || statusProbeFailures >= 2) return;
    busyAction = 'install';
    migrationConflict = false;
    setupStaged = false;
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const outcome = await setupOperations.install({
        refresh,
        onReadiness: applyReadiness,
        onBootstrap: feedback => {
          recordOperation('Install LazyDesigner', feedback.kind, feedback.status);
          setupStaged = !feedback.verifyRuntime;
        },
      });
      const ready = outcome.readiness;
      if (!ready) {
        showSuccessToast(outcome.feedback.message, outcome.feedback.kind);
        return;
      }
      if (ready.status === 'READY') showSuccessToast('Setup complete. LazyDesigner is ready.');
      else if (ready.status === 'RUNTIME_READY') showSuccessToast('Setup complete. Blockbench is ready.');
      else if (ready.status === 'NEEDS_ATTENTION') {
        error = installationReadinessError(ready);
      }
    } catch (cause) {
      recordOperation('Install LazyDesigner', 'failed', errorCode(cause));
      if (errorCode(cause) === 'LEGACY_PLUGIN_MIGRATION_REQUIRED' ||
          errorCode(cause) === 'LEGACY_CLIENT_MIGRATION_REQUIRED') {
        migrationConflictKind = errorCode(cause) === 'LEGACY_CLIENT_MIGRATION_REQUIRED' ? 'client' : 'plugin';
        migrationConflict = true;
        error = '';
        errorDetail = null;
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
    try {
      await invoke<PluginFileActionResult>('show_plugin_file');
      showSuccessToast(pluginApprovalNeeded && productMode(status) === 'plugin-setup'
        ? 'Plugin file highlighted. Approve it in Blockbench if prompted.'
        : 'Plugin file highlighted in File Explorer.');
    } catch (cause) {
      reportError(cause);
    } finally {
      busyAction = null;
    }
  }

  async function exportDiagnostics() {
    if (busyAction) return;
    closeUtilityMenu();
    busyAction = 'export-diagnostics';
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const result = await invoke<DiagnosticExportResult>('export_diagnostics');
      if (result.status === 'EXPORTED') showSuccessToast('Diagnostics exported successfully.');
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
    error = '';
    errorDetail = null;
    clearSuccessToast();
    try {
      const feedback = await maintenanceOperations.execute(request);
      showSuccessToast(feedback.message, feedback.kind);
      recordOperation(actionLabel, feedback.kind, feedback.status);
      await refresh();
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
      else connectionMonitor.request();
    };
    const onFocus = () => { connectionMonitor.request(); };
    devFixture = devFixtureFromLocation(import.meta.env.DEV, window.location.search);
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
    void refresh().then(() => {
      void checkManagedUpdateOnce();
      connectionMonitor.request();
    });
    const stopProgressListener = subscribeManagedProgress(
      receive => listen<ManagedProgress>('managed-progress', event => receive(event.payload)),
      progress => {
        if (busyAction && progress.action === busyAction) progressStage = progress.stage;
      },
    );
    return () => {
      if (deleteReview) cancelDeleteProject();
      connectionMonitor.dispose();
      stopProgressListener();
      if (successToastTimer !== null) window.clearTimeout(successToastTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

</script>

{#snippet navIcon(item: Page)}
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

  <div class="desktop-shell">
    <aside class="navigation" aria-label="LazyDesigner navigation">
      <div class="navigation-brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <strong>LazyDesigner</strong>
      </div>

      <nav class="global-nav">
        <button class:active={page === 'Overview'} aria-current={page === 'Overview' ? 'page' : undefined} onclick={() => navigate('Overview')}>
          <span class="nav-icon">{@render navIcon('Overview')}</span><span>Workspace</span>
        </button>
        <button class:active={page === 'Support'} aria-current={page === 'Support' ? 'page' : undefined} onclick={() => navigate('Support')}>
          <span class="nav-icon">{@render navIcon('Support')}</span><span>Support</span>
        </button>
      </nav>
    </aside>

    <section id="main-content" class="main-view" tabindex="-1">
      <header class="page-toolbar">
        <h1>{page === 'Overview' ? 'Workspace' : 'Support'}</h1>
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

      {#if !status}
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
          {status} {loading} {busyAction} {progressStage} {statusProbeFailures}
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
          {status} {loading} {busyAction} {statusProbeFailures}
          {migrationConflict} {migrationConflictKind} {error} {errorDetail} {operations}
          {refresh} {showRetiredPluginFile} {chooseBlockbenchExecutable}
          {showPluginFile} {exportDiagnostics} {runManagedAction}
        />
      {/if}
    </section>
  </div>
{/if}

{#if deleteReview}
  <ProjectDeleteDialog review={deleteReview} busy={busyAction !== null} onCancel={cancelDeleteProject} onConfirm={confirmDeleteProject} />
{/if}

{#if error || actionMessage || (busyAction && progressStage && busyAction !== 'repair')}
  <aside class:error={Boolean(error)} class:success={Boolean(actionMessage) && !error && actionMessageKind === 'success'} class:notice={Boolean(actionMessage) && !error && actionMessageKind !== 'success'} class="operation-attention" aria-live={error ? 'assertive' : 'polite'}>
    <div class="attention-icon">{error ? '!' : actionMessage ? (actionMessageKind === 'success' ? '✓' : 'i') : '•'}</div>
    <div class="attention-copy"><strong>{error ? errorTitle : actionMessage ? (actionMessageKind === 'pending' ? 'Next step' : actionMessageKind === 'unchanged' ? 'No change' : 'Done') : 'Working'}</strong><span>{error || actionMessage || progressLabel(progressStage)}</span></div>
    <div class="attention-actions">
      {#if error}<button onclick={() => navigate('Support')}>Support</button>{/if}
      {#if error || actionMessage}<button class="dismiss" aria-label="Dismiss notification" onclick={() => { error=''; clearSuccessToast(); }}>×</button>{/if}
    </div>
  </aside>
{/if}

<style>
  .loading-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;gap:10px;background:var(--bg);color:var(--muted);font-size:var(--font-ui)}.loading-spinner{width:12px;height:12px;border:2px solid var(--surface-4);border-top-color:var(--accent);border-radius:50%;animation:desktop-spin .8s linear infinite}
  .skip-link{position:fixed;z-index:1000;top:8px;left:8px;transform:translateY(-150%);padding:8px 10px;border:1px solid var(--accent);border-radius:7px;background:var(--surface);color:var(--text);font-weight:700;text-decoration:none}.skip-link:focus{transform:translateY(0)}
  .desktop-shell{display:grid;grid-template-columns:168px minmax(0,1fr);width:100%;height:100vh;background:var(--bg)}
  .navigation{display:flex;flex-direction:column;padding:12px 9px;border-right:1px solid var(--border-soft);background:#0f1113}.navigation-brand{display:flex;align-items:center;gap:9px;padding:7px 8px 18px}.navigation-brand strong{font-size:var(--font-title);font-weight:700;letter-spacing:-.01em}.brand-mark{width:10px;height:10px;border-radius:3px;background:var(--accent)}.global-nav{display:grid;gap:2px}.global-nav button{min-height:36px;display:flex;align-items:center;gap:9px;padding:0 9px;border-radius:7px;background:transparent;color:var(--muted);font-size:var(--font-ui);font-weight:600;text-align:left;cursor:pointer}.global-nav button:hover{background:var(--surface);color:var(--text-soft)}.global-nav button.active{background:var(--surface);color:var(--text)}.nav-icon{width:17px;height:17px;display:grid;place-items:center}.nav-icon :global(svg){width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
  .main-view{min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}.page-toolbar{min-height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid var(--border-soft);background:var(--bg)}.page-toolbar h1{margin:0;font-size:16px;font-weight:680;letter-spacing:-.015em}.toolbar-actions{display:flex;align-items:center;gap:6px}.fixture-badge{padding:3px 6px;border:1px solid var(--border);border-radius:5px;color:var(--muted-2);font-size:var(--font-xs)}
  .status-probe-warning{font-size:var(--font-sm);color:var(--warning)}
  .more-menu{position:relative}.more-menu summary{width:30px;height:30px;display:grid;place-items:center;list-style:none;border-radius:6px;color:var(--muted);cursor:pointer}.more-menu summary:hover,.more-menu[open] summary{background:var(--surface-2);color:var(--text)}.more-menu summary::-webkit-details-marker{display:none}.menu-popover{position:absolute;z-index:20;right:0;top:34px;width:168px;display:grid;padding:5px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);box-shadow:var(--shadow-popover)}.menu-popover button{width:100%;padding:7px 8px;border-radius:5px;background:transparent;color:var(--text-soft);text-align:left;cursor:pointer;font-size:var(--font-sm)}.menu-popover button:hover:not(:disabled){background:var(--surface-3)}
  .message-state{max-width:760px;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:start;gap:12px;padding-top:12px}.message-icon{width:26px;height:26px;display:grid;place-items:center;border-radius:6px;background:var(--surface-2);font-size:var(--font-ui);font-weight:800}.message-icon.danger{background:var(--danger-bg);color:var(--danger)}.message-copy h2{margin:0;font-size:16px}.message-copy p{margin:5px 0 0;color:var(--muted);font-size:var(--font-sm)}
  .operation-attention{position:fixed;z-index:220;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:start;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);box-shadow:var(--shadow-popover)}.operation-attention.success{border-color:var(--accent-border)}.operation-attention.notice{border-color:var(--border-strong)}.operation-attention.error{border-color:#705c26}.attention-icon{width:23px;height:23px;display:grid;place-items:center;border-radius:6px;background:var(--surface-3);font-size:var(--font-sm);font-weight:800}.success .attention-icon{background:var(--accent-soft);color:#9ee8b9}.error .attention-icon{background:var(--warning-bg);color:#fde68a}.attention-copy{display:grid;gap:2px}.attention-copy strong{font-size:var(--font-sm)}.attention-copy span{color:var(--muted);font-size:var(--font-xs);line-height:1.4}.attention-actions{display:flex;gap:4px}.attention-actions button{min-height:24px;padding:4px 6px;border:1px solid var(--border);border-radius:5px;background:var(--surface-3);font-size:var(--font-xs);font-weight:700}.attention-actions .dismiss{width:24px;padding:0;border:0;background:transparent;color:var(--muted);font-size:15px}
  @media(max-width:760px){.desktop-shell{grid-template-columns:62px minmax(0,1fr)}.navigation{padding-inline:7px}.navigation-brand strong,.global-nav button>span:not(.nav-icon){display:none}.navigation-brand{justify-content:center;padding-inline:0}.global-nav button{justify-content:center;padding:0}.page-toolbar{padding:0 16px}.operation-attention{right:10px;bottom:10px;width:calc(100vw - 20px);grid-template-columns:auto minmax(0,1fr)}.attention-actions{grid-column:2}}
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
</style>
