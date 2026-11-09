<script lang="ts">
  import NativeEditorStage from './NativeEditorStage.svelte';
  import EditorChromeIcon from './EditorChromeIcon.svelte';
  import {
    canExpandEditorDock, defaultEditorPanels, editorDockWidth, editorLayoutBand,
    type EditorDock, type EditorLayoutState,
  } from './editorLayout';
  import { onMount, tick } from 'svelte';
  import {
    FULL_STATUS_RECENT_MS, aiStatusPresentation, continueTarget,
    fullStatusObservationAgeMs, recentModelTargets,
    uniqueModelSearchTarget, visibleProjectModels, visibleProjects,
  } from './desktopPresentation';
  import type { SystemStatus, DesktopBusyAction } from './desktopTypes';
  import type { ProjectAction, ProjectNavigationModel, ProjectNavigationProject } from './projectNavigationTypes';

  // One presentation view, not a second model, Runtime or project owner.
  export let status: SystemStatus | null;
  export let loading: boolean;
  export let busyAction: DesktopBusyAction | null;
  export let openingModelId: string | null;
  export let statusProbeFailures: number;
  export let statusPresentationNowMs: number;
  export let fixture = false;
  export let navigationPending = false;
  export let layout: EditorLayoutState;
  export let openModel: (id?: string) => Promise<void>;
  export let addProjectFolder: () => Promise<void>;
  export let runProjectAction: (action: ProjectAction, id: string) => Promise<void>;
  export let focusCurrentEditor: () => Promise<void>;
  export let openBlockbenchEditor: () => Promise<void>;
  export let refresh: () => Promise<void>;
  export let navigateSupport: () => void;
  export let navigateActivity: () => void;
  export let navigateWorkspace: () => void;

  type NativePlacementState = 'PRESENTED' | 'DETACHED' | 'DEFERRED' | 'UNAVAILABLE' | 'UNCERTAIN';
  let nativeStage: { detach: () => Promise<boolean>; present: () => Promise<void> } | undefined;
  let nativePlacement: 'DETACHED' | 'PRESENTED' | 'UNCERTAIN' = 'DETACHED';
  let nativePlacementDetail = '';
  let editorRoot: HTMLElement;
  let editorWidth = 0;
  let drag: { dock: EditorDock; pointerId: number; x: number; width: number } | null = null;
  let search = '';
  let sidebarTab: 'projects' | 'status' = 'projects';
  let showAll = false;
  // Independent project expansion mirrors Blockbench's multi-open Outliner.
  // The active project opens by default until explicitly collapsed.
  let expandedProjectIds = new Set<string>();
  let collapsedProjectIds = new Set<string>();
  let projectActionsId: string | null = null;
  let recentExpanded = false;
  let executing = false;
  let localNotice = '';
  let searchInput: HTMLInputElement | undefined;
  let explorerToggle: HTMLButtonElement | undefined;
  let diagnosticToggle: HTMLButtonElement | undefined;
  let explorerHeading: HTMLHeadingElement | undefined;

  $: navigation = status?.project_navigation ?? null;
  $: active = navigation?.active ?? null;
  $: projects = navigation ? visibleProjects(navigation, search, showAll) : [];
  $: uniqueTarget = navigation ? uniqueModelSearchTarget(navigation, search) : null;
  $: recentTargets = navigation ? recentModelTargets(navigation).slice(0, 3) : [];
  $: continuing = navigation ? continueTarget(navigation) : null;
  $: aiStatus = status ? aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs) : null;
  // Read-only projection of the existing Rust-owned status. Use the same
  // presentation recency boundary as AI status; an aged snapshot is not an
  // active readiness result and cannot become one through CSS badges.
  $: readinessObservationAge = status
    ? fullStatusObservationAgeMs(status.observed_at_unix_ms, statusPresentationNowMs)
    : null;
  $: readinessOutdated = Boolean(status
    && (readinessObservationAge === null || readinessObservationAge > FULL_STATUS_RECENT_MS));
  $: readinessLabel = statusProbeFailures >= 2 ? 'Verification required'
    : loading ? 'Checking readiness…'
    : !status ? 'Status unavailable'
    : readinessOutdated ? 'Check out of date'
    : status.readiness.ready ? 'Ready at last check'
    : status.readiness.state === 'ready-to-start' ? 'Ready to start'
    : status.readiness.state === 'setup-required' ? 'Setup required'
    : status.readiness.state === 'needs-connection' ? 'Connection needed'
    : 'Attention required';
  $: readinessDetail = statusProbeFailures >= 2
    ? 'The last status could not be verified. Refresh to check readiness.'
    : loading ? 'Checking the current system status.'
    : readinessOutdated
      ? 'Refresh to verify readiness. Last observed: ' + (status?.readiness.summary ?? 'Status unavailable.')
      : status?.readiness.summary ?? 'No verified readiness details available.';
  $: observedProjectCount = status?.project_navigation.projects.length ?? null;
  $: observedModelCount = status?.project_navigation.projects.reduce(
    (sum, project) => sum + project.model_count, 0,
  ) ?? null;
  $: actionBusy = Boolean(busyAction) || executing || navigationPending;
  // Both sides are always present in ordinary editor mode. Only Focus Editor
  // hides them. Narrow widths collapse content to reachable shortcut rails.
  $: showProjects = false; // Projects now lives inside the single right sidebar.
  $: showTools = !layout.focusMode;
  $: explorerRail = false;
  $: diagnosticRail = showTools && !layout.diagnosticExpanded;
  $: otherRailWidth = layout.band === 'compact' ? 44 : 48;
  $: canExpandProjects = canExpandEditorDock(editorWidth, 'projects', layout.projectsWidth, otherRailWidth);
  $: canExpandDiagnostic = canExpandEditorDock(editorWidth, 'tools', layout.toolsWidth, 0);

  function expanded(project: ProjectNavigationProject): boolean {
    return expandedProjectIds.has(project.id)
      || (navigation?.active?.project_id === project.id && !collapsedProjectIds.has(project.id));
  }
  function toggleProject(project: ProjectNavigationProject) {
    if (expanded(project)) {
      expandedProjectIds = new Set([...expandedProjectIds].filter(id => id !== project.id));
      collapsedProjectIds = new Set([...collapsedProjectIds, project.id]);
    } else {
      expandedProjectIds = new Set([...expandedProjectIds, project.id]);
      collapsedProjectIds = new Set([...collapsedProjectIds].filter(id => id !== project.id));
    }
  }
  function changeLayout(next: Partial<EditorLayoutState>) {
    layout = { ...layout, ...next };
  }
  // When a dock is replaced by its shortcut rail, restore focus to a stable
  // toolbar control rather than leaving keyboard users on a removed element.
  async function focusAfterLayout(target: () => HTMLElement | undefined) {
    await tick();
    const element = target();
    if (element instanceof HTMLButtonElement && element.disabled) {
      // A narrow-window rail cannot expand without squeezing Blockbench.
      // Send keyboard focus to the still-operable Workspace/Support route.
      const fallback = element === explorerToggle ? '.workspace-return' : '.support-button';
      editorRoot?.querySelector<HTMLButtonElement>(fallback)?.focus();
      return;
    }
    element?.focus();
  }
  function toggleProjectActions(id: string) {
    projectActionsId = projectActionsId === id ? null : id;
  }
  function closeProjectActions(event: KeyboardEvent, id: string) {
    if (event.key !== 'Escape' || projectActionsId !== id) return;
    event.preventDefault();
    projectActionsId = null;
    void tick().then(() => {
      const toggle = Array.from(editorRoot.querySelectorAll<HTMLButtonElement>('.project-actions-toggle'))
        .find(button => button.dataset.projectId === id);
      toggle?.focus();
    });
  }
  function onSidebarTabKeydown(event: KeyboardEvent, current: 'projects' | 'status') {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowLeft'
      ? (current === 'projects' ? 'status' : 'projects')
      : event.key === 'Home' ? 'projects' : event.key === 'End' ? 'status' : null;
    if (!next) return;
    event.preventDefault();
    sidebarTab = next;
    void tick().then(() => editorRoot.querySelector<HTMLButtonElement>(
      next === 'projects' ? '#ld-sidebar-projects-tab' : '#ld-sidebar-status-tab',
    )?.focus());
  }
  function toggleProjectsPanel() {
    const opening = layout.focusMode || !layout.projectsExpanded;
    if (opening && !canExpandProjects) return;
    changeLayout({
      focusMode: false,
      projectsExpanded: opening,
      ...(opening && (layout.band === 'rail' || layout.band === 'compact')
        ? { diagnosticExpanded: false } : {}),
    });
    void focusAfterLayout(() => opening
      ? searchInput ?? explorerHeading ?? explorerToggle
      : explorerToggle);
  }
  function expandExplorer() {
    if (!canExpandProjects) return;
    changeLayout({
      focusMode: false,
      projectsExpanded: true,
      ...(layout.band === 'rail' || layout.band === 'compact'
        ? { diagnosticExpanded: false } : {}),
    });
    void focusAfterLayout(() => searchInput ?? explorerHeading ?? explorerToggle);
  }
  function collapseExplorer() {
    changeLayout({ projectsExpanded: false });
    void focusAfterLayout(() => explorerToggle);
  }
  function toggleDiagnosticPanel() {
    const opening = layout.focusMode || !layout.diagnosticExpanded;
    if (opening && !canExpandDiagnostic) return;
    changeLayout({
      focusMode: false,
      diagnosticExpanded: opening,
      ...(opening && (layout.band === 'rail' || layout.band === 'compact')
        ? { projectsExpanded: false } : {}),
    });
    void focusAfterLayout(() => opening
      ? editorRoot?.querySelector<HTMLButtonElement>('.diagnostic-tabs [role="tab"][aria-selected="true"]')
        ?? diagnosticToggle
      : diagnosticToggle);
  }
  function expandDiagnostic() {
    if (!canExpandDiagnostic) return;
    changeLayout({
      focusMode: false,
      diagnosticExpanded: true,
      ...(layout.band === 'rail' || layout.band === 'compact'
        ? { projectsExpanded: false } : {}),
    });
    void focusAfterLayout(() =>
      editorRoot?.querySelector<HTMLButtonElement>('.diagnostic-tabs [role="tab"][aria-selected="true"]')
        ?? diagnosticToggle);
  }
  function collapseDiagnostic() {
    changeLayout({ diagnosticExpanded: false });
    void focusAfterLayout(() => diagnosticToggle);
  }
  function toggleFocusMode() {
    changeLayout({ focusMode: !layout.focusMode });
  }
  function syncWidthBand() {
    const width = Math.round(editorRoot.getBoundingClientRect().width);
    editorWidth = width;
    const band = editorLayoutBand(width);
    if (band !== layout.band) {
      // A single right dock owns both Projects and Status.
      const next = defaultEditorPanels(band);
      const focused = document.activeElement;
      const focusedExplorer = !next.projectsExpanded && focused instanceof Element
        && Boolean(focused.closest('#ld-unified-explorer'));
      const focusedAssistant = !next.diagnosticExpanded && focused instanceof Element
        && Boolean(focused.closest('#ld-unified-inspector'));
      changeLayout({ band, ...next });
      if (focusedExplorer) void focusAfterLayout(() => explorerToggle);
      else if (focusedAssistant) void focusAfterLayout(() => diagnosticToggle);
      return;
    }
    const rail = band === 'compact' ? 44 : 48;
    const collapseProjects = false;
    const collapseDiagnostic = layout.diagnosticExpanded
      && !canExpandEditorDock(width, 'tools', layout.toolsWidth, 0);
    if (!collapseProjects && !collapseDiagnostic) return;
    const focused = document.activeElement;
    const focusedExplorer = collapseProjects && focused instanceof Element
      && Boolean(focused.closest('#ld-unified-explorer'));
    const focusedAssistant = collapseDiagnostic && focused instanceof Element
      && Boolean(focused.closest('#ld-unified-inspector'));
    changeLayout({
      ...(collapseProjects ? { projectsExpanded: false } : {}),
      ...(collapseDiagnostic ? { diagnosticExpanded: false } : {}),
    });
    if (focusedExplorer) void focusAfterLayout(() => explorerToggle);
    else if (focusedAssistant) void focusAfterLayout(() => diagnosticToggle);
  }
  function startDockResize(event: PointerEvent, dock: EditorDock) {
    if (event.button !== 0 || layout.focusMode || !editorRoot) return;
    event.preventDefault();
    drag = {
      dock,
      pointerId: event.pointerId,
      x: event.clientX,
      width: dock === 'projects' ? layout.projectsWidth : layout.toolsWidth,
    };
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function moveDockResize(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    const width = editorDockWidth(drag.dock, drag.width + (drag.dock === 'projects' ? delta : -delta));
    changeLayout(drag.dock === 'projects' ? { projectsWidth: width } : { toolsWidth: width });
  }
  function stopDockResize(event: PointerEvent) {
    if (drag?.pointerId === event.pointerId) drag = null;
  }
  function resizeDockWithKeyboard(event: KeyboardEvent, dock: EditorDock) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = dock === 'projects' ? layout.projectsWidth : layout.toolsWidth;
    const min = dock === 'projects' ? 160 : 220;
    const max = dock === 'projects' ? 260 : 300;
    const step = event.shiftKey ? 24 : 8;
    const width = event.key === 'Home' ? min : event.key === 'End' ? max
      : editorDockWidth(dock, current + (event.key === 'ArrowRight' ? step : -step) * (dock === 'projects' ? 1 : -1));
    changeLayout(dock === 'projects' ? { projectsWidth: width } : { toolsWidth: width });
  }
  onMount(() => {
    const resizeObserver = new ResizeObserver(syncWidthBand);
    resizeObserver.observe(editorRoot);
    syncWidthBand();
    window.addEventListener('pointermove', moveDockResize);
    window.addEventListener('pointerup', stopDockResize);
    window.addEventListener('pointercancel', stopDockResize);
    return () => {
      resizeObserver.disconnect();
      drag = null;
      window.removeEventListener('pointermove', moveDockResize);
      window.removeEventListener('pointerup', stopDockResize);
      window.removeEventListener('pointercancel', stopDockResize);
    };
  });

  function onNativePlacementChange(state: NativePlacementState, detail: string) {
    nativePlacementDetail = detail;
    if (state === 'PRESENTED') nativePlacement = 'PRESENTED';
    else if (state === 'DETACHED') nativePlacement = 'DETACHED';
    else if (state === 'UNCERTAIN') nativePlacement = 'UNCERTAIN';
    // DEFERRED is a window-focus observation, not permission to place again.
    if (state === 'UNCERTAIN') {
      localNotice = 'Blockbench window restoration is unverified. Use Restore window to recover the original window. ' + detail;
    } else if (state === 'UNAVAILABLE') {
      localNotice = 'Native Blockbench placement is unavailable in this build. ' + detail;
    } else if (state === 'DETACHED' || state === 'PRESENTED') {
      if (localNotice.startsWith('Blockbench window restoration is unverified.')
        || localNotice.startsWith('Native Blockbench placement is unavailable.')) localNotice = '';
    }
  }
  function requestNativePlacement() {
    if (fixture || !nativeStage || actionBusy || nativePlacement !== 'DETACHED') return;
    localNotice = '';
    void nativeStage.present();
  }
  function restoreNativeWindow() {
    if (fixture || !nativeStage || actionBusy || nativePlacement === 'DETACHED') return;
    void nativeStage.detach();
  }
  export async function detach(): Promise<boolean> {
    if (fixture) return true;
    if (!nativeStage) {
      localNotice = 'Native Blockbench recovery control is unavailable. Navigation is blocked to protect the original window.';
      return false;
    }
    const restored = await nativeStage.detach();
    if (!restored) {
      localNotice = 'The original Blockbench window was not confirmed restored. The Editor remains open. Use Restore window if recovery is available.';
    }
    return restored;
  }

  // Native file pickers and Explorer must not appear behind a clipped window.
  // Preserve the P0 recovery gate before invoking existing Rust owner actions.
  async function afterDetach(action: () => Promise<void>): Promise<void> {
    if (fixture || actionBusy) return;
    localNotice = '';
    executing = true;
    try {
      const restored = await detach();
      if (!restored) {
        localNotice = 'Blockbench window restoration is unverified. Restore the original window before opening another model or folder.';
        return;
      }
      await action();
    } catch (error) {
      localNotice = String(error);
    } finally {
      executing = false;
    }
  }
  function openModelSafely(id?: string) { return afterDetach(() => openModel(id)); }
  function launchBlockbench() { return afterDetach(openBlockbenchEditor); }
  function openProjectFolder(id: string) {
    return afterDetach(() => runProjectAction('open-project-folder', id));
  }
  function showModelFile(id: string) {
    return afterDetach(() => runProjectAction('reveal-model', id));
  }
  function openProjectSubfolder(id: string) {
    return afterDetach(() => runProjectAction('open-folder', id));
  }
  function registerFolder() {
    if (statusProbeFailures >= 2 || !status) return Promise.resolve();
    return afterDetach(addProjectFolder);
  }
  function chooseModel(model: ProjectNavigationModel) {
    // Model IDs are revalidated by Rust. Never fake activation in the UI.
    if (model.active) {
      if (fixture || actionBusy || statusProbeFailures >= 2) return Promise.resolve();
      return focusCurrentEditor();
    }
    return openModelSafely(model.id);
  }
  function togglePinnedProject(project: ProjectNavigationProject) {
    if (fixture || actionBusy || statusProbeFailures >= 2) return Promise.resolve();
    // Pinning is a preference change, not a file picker or a model mutation.
    return runProjectAction(project.pinned ? 'unpin-project' : 'pin-project', project.id);
  }
  function clearSearch() {
    search = '';
    projectActionsId = null;
    searchInput?.focus();
  }
  function searchKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape' && search) {
      event.preventDefault();
      clearSearch();
    } else if (event.key === 'Enter' && uniqueTarget && !actionBusy && !fixture) {
      event.preventDefault();
      void openModelSafely(uniqueTarget.model.id);
    }
  }
</script>

<main class="unified-workspace" bind:this={editorRoot} aria-label="LazyDesigner unified editor workspace">
  <header class="editor-header" aria-label="LazyDesigner editor controls" aria-busy={navigationPending}>
    <div class="editor-leading">
      <span class="editor-brand-mark" aria-hidden="true"><EditorChromeIcon name="model"/></span>
      <span class="editor-brand">LazyDesigner</span>
      <span class="header-divider" aria-hidden="true"></span>
      <button class="workspace-return" type="button" aria-label="Return to Workspace"
        title={nativePlacement === 'DETACHED' ? 'Workspace' : 'Restore original Blockbench window before opening Workspace'}
        disabled={navigationPending} onclick={navigateWorkspace}>
        <EditorChromeIcon name="workspace"/><span class="workspace-label">Workspace</span>
      </button>
      <div class="editor-context">
        <h1 tabindex="-1" title={active?.model_name ?? continuing?.model.name ?? 'Blockbench workspace'}>
          {active?.model_name ?? continuing?.model.name ?? 'Blockbench workspace'}
          {#if active?.dirty}<span class="unsaved" title="Unsaved changes at last observation">●</span>{/if}
        </h1>
        <span class="subtitle" role={navigationPending ? 'status' : undefined}
          title={navigationPending ? 'Restoring original Blockbench window before opening another page' : undefined}>
          {#if navigationPending}
            Restoring original Blockbench window before leaving Editor…
          {:else}
            {active?.project_name ?? continuing?.project.name ?? 'No active model'}
            · {active ? 'Last observed' : 'Development preview'}
          {/if}
        </span>
        {#if openingModelId}<span class="model-opening" role="status">Opening requested model…</span>{/if}
      </div>
    </div>
    <div class="editor-controls" role="group" aria-label="Editor actions and panels">
      <button type="button" class="dock-toggle" class:chosen={layout.focusMode}
        aria-label={layout.focusMode ? 'Exit Focus Editor' : 'Focus Editor'}
        aria-pressed={layout.focusMode}
        title={layout.focusMode ? 'Restore side panels' : 'Maximize Blockbench working area'}
        onclick={toggleFocusMode}><EditorChromeIcon name="focus"/></button>
      {#if !status?.blockbench.running}
        <button type="button" class="launch-editor" disabled={actionBusy || fixture || statusProbeFailures >= 2}
          onclick={() => void launchBlockbench()}>Open Blockbench</button>
      {/if}
      {#if !fixture && nativePlacement === 'UNCERTAIN'}
        <button type="button" class="native-window-action"
          aria-label="Recover original Blockbench window"
          title="Window placement is unverified; restore the original Blockbench window"
          disabled={actionBusy}
          onclick={restoreNativeWindow}>Restore window</button>
      {/if}
      <span class="toolbar-separator" aria-hidden="true"></span>
      <button type="button" class="support-button"
        title={nativePlacement === 'DETACHED' ? 'Support and settings' : 'Restore original Blockbench window before opening Support'}
        aria-label="Open Support" disabled={navigationPending}
        onclick={navigateSupport}><EditorChromeIcon name="support"/></button>
    </div>
  </header>

  {#if localNotice}
    <div class="inline-error" role="alert"><span>{localNotice}</span><button type="button" onclick={() => localNotice = ''} aria-label="Dismiss workspace notice">×</button></div>
  {/if}

  <div class="unified-body" class:with-projects={showProjects} class:with-inspector={showTools}
    class:rail={explorerRail} class:tools-rail={diagnosticRail}
    style={`--explorer-width: ${layout.projectsWidth}px; --tools-width: ${layout.toolsWidth}px;`}>
    <!-- Empty native window reservation, never a recreated editor or a visual placeholder. -->
    <section class="native-stage" aria-label="Blockbench native editor area">
      <NativeEditorStage bind:this={nativeStage} {fixture} compact={true}
        onPlacementChange={onNativePlacementChange}/>
    </section>

    {#if showTools}
      {#if !diagnosticRail}
        <div class="dock-resizer" role="separator" tabindex="0"
          aria-label="Resize LazyDesigner sidebar" aria-orientation="vertical"
          aria-valuemin={220} aria-valuemax={300} aria-valuenow={layout.toolsWidth}
          title="Drag or use arrow keys to resize sidebar"
          onpointerdown={(event) => startDockResize(event, 'tools')}
          onkeydown={(event) => resizeDockWithKeyboard(event, 'tools')}></div>
      {/if}
      <aside id="ld-unified-inspector" class="inspector dock-panel unified-sidebar" class:rail={diagnosticRail}
        aria-label="LazyDesigner sidebar">
        {#if diagnosticRail}
          <div class="rail-actions" role="group" aria-label="Diagnostic shortcuts">
            {#if canExpandDiagnostic}
              <button type="button" title="Expand Diagnostic"
                aria-label="Expand Diagnostic panel"
                onclick={expandDiagnostic}><EditorChromeIcon name="diagnostic"/></button>
    
        {:else}
          <div class="sidebar-top">
            <div class="sidebar-brand"><EditorChromeIcon name="model"/><strong>LazyDesigner</strong>
              <button type="button" class="sidebar-collapse" aria-label="Collapse sidebar"
                title="Collapse sidebar" onclick={collapseDiagnostic}><EditorChromeIcon name="chevron-right"/></button>
            </div>
            <div class="sidebar-tabs" role="tablist" aria-label="LazyDesigner sections">
              <button type="button" role="tab" id="ld-sidebar-projects-tab"
                aria-selected={sidebarTab === 'projects'} aria-controls="ld-sidebar-projects"
                tabindex={sidebarTab === 'projects' ? 0 : -1}
                class:selected={sidebarTab === 'projects'}
                onclick={() => sidebarTab = 'projects'}
                onkeydown={(event) => onSidebarTabKeydown(event, 'projects')}>
                <EditorChromeIcon name="projects"/> Projects
              </button>
              <button type="button" role="tab" id="ld-sidebar-status-tab"
                aria-selected={sidebarTab === 'status'} aria-controls="ld-sidebar-status"
                tabindex={sidebarTab === 'status' ? 0 : -1}
                class:selected={sidebarTab === 'status'}
                onclick={() => sidebarTab = 'status'}
                onkeydown={(event) => onSidebarTabKeydown(event, 'status')}>
                <EditorChromeIcon name="activity"/> Status
              </button>
            </div>
          </div>
          <div class="sidebar-content">
            <section id="ld-sidebar-projects" role="tabpanel" aria-labelledby="ld-sidebar-projects-tab"
              hidden={sidebarTab !== 'projects'} class="sidebar-page explorer">
        <div class="project-primary-action">
          <button type="button" class="sidebar-open-model" disabled={actionBusy || fixture}
            onclick={() => void openModelSafely()}><EditorChromeIcon name="model"/> Open model…</button>
          <button type="button" class="sidebar-add-folder" title="Add an existing project folder"
            aria-label="Add existing project folder" disabled={actionBusy || fixture || !status || statusProbeFailures >= 2}
            onclick={() => void registerFolder()}><EditorChromeIcon name="add"/></button>
        </div>
        {#if statusProbeFailures >= 2}
          <div class="state-note" role="status">
            <strong>Refresh required</strong>
            <span>Folder navigation remains available. Refresh before changing project shortcuts.</span>
            <button type="button" disabled={actionBusy || fixture || loading} onclick={() => void refresh()}>Refresh status</button>
          </div>
        {/if}

        {#if navigation && navigation.projects.length > 0}
          <label class="search-label sr-only" for="ld-unified-model-search">Find a project or model</label>
          <div class="search-controls">
            <span class="search-icon" aria-hidden="true"><EditorChromeIcon name="search"/></span>
            <input id="ld-unified-model-search" bind:this={searchInput} type="search"
              placeholder="Search models…" bind:value={search} onkeydown={searchKeydown}
              aria-describedby="ld-unified-search-count ld-unified-search-help"/>
            {#if search.trim()}
              <button type="button" aria-label="Clear project search" title="Clear search" onclick={clearSearch}>×</button>
            {/if}
          </div>
          <div id="ld-unified-search-count" class="search-count" class:sr-only={!search.trim()}
            role="status" aria-live="polite">
            {search.trim()
              ? `${projects.length} ${projects.length === 1 ? 'matching project' : 'matching projects'}`
              : `${navigation.projects.length} ${navigation.projects.length === 1 ? 'project' : 'projects'}`}
          </div>
          {#if search.trim()}
            <p id="ld-unified-search-help" class="search-hint">
              {uniqueTarget && !actionBusy && !fixture
                ? `Press Enter to open ${uniqueTarget.model.name}. Escape clears search.`
                : 'Use a visible model action below. Escape clears search.'}
            </p>
          {:else}
            <p id="ld-unified-search-help" class="sr-only">Search all projects and model names.</p>
          {/if}
          <div class="project-tree" role="group" aria-label="Project models">
            {#each projects as project (project.id)}
              <div class="project-group">
                <div class="project-line" class:active-project={active?.project_id === project.id}>
                  <button type="button" class="project-expand"
                    aria-label={(search.trim()
                      ? 'Filtered models in project ' + project.name
                      : (expanded(project) ? 'Hide models for ' : 'Show models for ') + project.name)
                      + (active?.project_id === project.id ? ', contains current model' : '')}
                    aria-expanded={expanded(project) || Boolean(search.trim())}
                    disabled={Boolean(search.trim())}
                    onclick={() => toggleProject(project)}>
                    <span class="tree-caret" class:expanded={Boolean(expanded(project) || search.trim())}
                      aria-hidden="true"><EditorChromeIcon name="chevron-right"/></span>
                    <span class="project-icon" aria-hidden="true"><EditorChromeIcon name="folder"/></span>
                    <span class="project-name" title={project.name}>{project.name}</span>
                   </button>
                  <button type="button" class="project-actions-toggle"
                    data-project-id={project.id}
                    aria-label={'Show actions for project ' + project.name}
                    title={'Project actions for ' + project.name}
                    aria-expanded={projectActionsId === project.id}
                    aria-controls={projectActionsId === project.id ? 'ld-project-actions-' + project.id : undefined}
                    onclick={() => toggleProjectActions(project.id)}><EditorChromeIcon name="more-horizontal"/></button>
                </div>
                {#if projectActionsId === project.id}
                  <div id={'ld-project-actions-' + project.id} class="project-inline-actions" role="group"
                    aria-label={'Actions for project ' + project.name}
                    onkeydown={(event) => closeProjectActions(event, project.id)}>
                    <button type="button" class="pin-project"
                      aria-label={(project.pinned ? 'Unpin project ' : 'Pin project ') + project.name}
                      aria-pressed={project.pinned}
                      disabled={actionBusy || fixture || statusProbeFailures >= 2}
                      onclick={() => void togglePinnedProject(project)}>
                      {project.pinned ? '★ Unpin' : '☆ Pin'}
                    </button>
                    <button type="button" class="folder-action"
                      aria-label={'Open folder for project ' + project.name}
                      disabled={!project.available || actionBusy || fixture}
                      onclick={() => void openProjectFolder(project.id)}>Open folder</button>
                  </div>
                {/if}
                {#if !project.available}
                  <p class="row-hint">Folder unavailable; shortcut preserved.</p>
                {:else if expanded(project) || search.trim()}
                  {#each visibleProjectModels(project, search) as model (model.id)}
                    <div class:current={model.active} class:has-reveal={model.exists} class="model-line">
                      <button type="button" class="model-open" title={model.name}
                        aria-label={(model.active ? 'Focus current model ' : 'Open model ') + model.name}
                        aria-current={model.active ? 'true' : undefined}
                        aria-busy={openingModelId === model.id}
                        disabled={!model.exists || actionBusy || fixture || (model.active && statusProbeFailures >= 2)}
                        onclick={() => void chooseModel(model)}>
                        <span class="model-symbol" aria-hidden="true"><EditorChromeIcon name="model"/></span>
                        <span class="model-name">{model.name}</span>
                      </button>
                      {#if openingModelId === model.id}
                        <span class="model-state" role="status">Opening…</span>
                      {:else}
                        {#if model.active}
                          <span class="model-current-indicator" title="Current model at last observation">Active</span>
                        {/if}
                        {#if !model.exists}
                          <span class="model-state warning" title="File unavailable">Missing</span>
                        {:else if model.dirty}
                          <span class="model-state warning" title="Modified at last observation" aria-label="Modified at last observation">●</span>
                        {/if}
                      {/if}
                      {#if model.exists}
                        <button type="button" class="reveal-model" disabled={actionBusy || fixture}
                          title={'Show ' + model.name + ' in Explorer'}
                          aria-label={'Show model ' + model.name + ' in Explorer'}
                          onclick={() => void showModelFile(model.id)}><EditorChromeIcon name="folder-open"/></button>
                      {/if}
                    </div>
                  {/each}
                  {#if !search.trim() && project.folders.length > 0}
                    <details class="project-resources">
                      <summary>Project folders <span class="resource-count">{project.folders.length}</span></summary>
                      <div class="resource-links">
                        {#each project.folders as folder (folder.id)}
                          <button type="button" class="resource-link"
                            aria-label={'Open ' + folder.label + ' folder for project ' + project.name}
                            title={'Open ' + folder.label + ' in File Explorer'}
                            disabled={actionBusy || fixture}
                            onclick={() => void openProjectSubfolder(folder.id)}>
                            <span class="project-icon" aria-hidden="true"><EditorChromeIcon name="folder"/></span><span>{folder.label}</span>
                          </button>
                        {/each}
                      </div>
                    </details>
                  {/if}
                {/if}
              </div>
            {/each}
            {#if projects.length === 0}<p class="empty-state">No matching projects or models.</p>{/if}
          </div>
          {#if navigation.projects.length > 6 && !search.trim()}
            <button class="more-projects" type="button" onclick={() => showAll = !showAll}>{showAll ? 'Show fewer projects' : 'Show all projects'}</button>
          {/if}
        {:else}
          <div class="explorer-empty">
            <p class="empty-state">{loading ? 'Checking projects…' : status ? 'No project folders added yet. Register an existing folder to browse its models.' : 'Project list unavailable. You can still use Open Model in the toolbar.'}</p>
            {#if status && !loading}
              <button type="button" class="empty-add-folder" disabled={actionBusy || fixture || statusProbeFailures >= 2}
                onclick={() => void registerFolder()}>+ Add Project Folder</button>
            {/if}
          </div>
        {/if}

        {#if !search.trim() && recentTargets.length > 0}
          <div class="recent-group">
            <button type="button" class="recent-heading" aria-expanded={recentExpanded}
              onclick={() => recentExpanded = !recentExpanded}>
              <span class="tree-caret" class:expanded={recentExpanded}
                aria-hidden="true"><EditorChromeIcon name="chevron-right"/></span>
              Recent Models <span class="recent-count">{recentTargets.length}</span>
            </button>
            {#if recentExpanded}
              {#each recentTargets as target (target.model.id)}
                <button class="recent-model" type="button" disabled={actionBusy || fixture}
                  title={target.model.name}
                  aria-label={'Open recent model ' + target.model.name + ' from ' + target.project.name}
                  onclick={() => void openModelSafely(target.model.id)}>
                  <span>{target.model.name}</span><small>{target.project.name}</small>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
        {/if}

            </section>
            <section id="ld-sidebar-status" role="tabpanel" aria-labelledby="ld-sidebar-status-tab"
              hidden={sidebarTab !== 'status'} class="sidebar-page sidebar-status">
          <section class="inspector-section diagnostic-section">
            <div class="inspector-context" aria-label="Current model context">
              <div class="context-heading">Current model</div>
              <div class="context-model" title={active?.model_name ?? continuing?.model.name ?? 'No active model'}>
                <EditorChromeIcon name="model"/>
                <strong>{active?.model_name ?? continuing?.model.name ?? 'No active model'}</strong>
              </div>
              <div class="context-project">
                <EditorChromeIcon name="folder"/>
                <span>{active?.project_name ?? continuing?.project.name ?? 'No project selected'}</span>
              </div>
              {#if active?.dirty}<span class="context-dirty">Unsaved changes at last observation</span>{/if}
            </div>
            <div class="inspector-status-heading">Readiness</div>
            <div class="connection-status" role="status">
              <i class:verified={Boolean(status?.readiness.ready && statusProbeFailures < 2 && !loading && !readinessOutdated)}
                class:stale={statusProbeFailures >= 2 || readinessOutdated} aria-hidden="true"></i>
              <strong>{readinessLabel}</strong>
            </div>
            <p class="status-summary">{readinessDetail}</p>
            <details class="panel-disclosure">
              <summary>Component status</summary>
              <div class="diagnostic-facts" aria-label="Last observed Blockbench and plugin status">
                <div><span>Blockbench</span><strong>{status
                  ? status.blockbench.running ? 'Detected' : 'Not running'
                  : 'Unverified'}</strong></div>
                <div><span>Plugin</span><strong>{status
                  ? status.plugin_integrity === 'ready' ? 'Ready at last check'
                    : status.plugin_integrity === 'missing' ? 'Missing'
                    : status.plugin_integrity === 'modified' ? 'Modified'
                    : status.plugin_integrity === 'invalid' ? 'Invalid'
                    : 'Unverified'
                  : 'Unverified'}</strong></div>
              </div>
            </details>
            {#if status?.diagnostic || status?.blockbench.diagnostic}
              <details class="panel-disclosure">
                <summary>Diagnostic details</summary>
                {#if status?.diagnostic}<p class="subtle-note">{status.diagnostic}</p>{/if}
                {#if status?.blockbench.diagnostic}<p class="subtle-note">{status.blockbench.diagnostic}</p>{/if}
              </details>
            {/if}
            <button type="button" disabled={actionBusy || fixture || loading}
              onclick={() => void refresh()}>Refresh status</button>
            <button type="button" class="text-action" disabled={navigationPending} onclick={navigateSupport}>Troubleshooting</button>
          </section>
          <section class="inspector-section activity-section">
            <div class="inspector-status-heading">AI connection</div>
            <div class="connection-status" role="status">
              <i class:verified={Boolean(aiStatus?.recentlyVerified)}
                class:stale={Boolean(aiStatus?.needsRefresh)} aria-hidden="true"></i>
              <strong>{aiStatus?.label ?? 'Status unavailable'}</strong>
            </div>
            <p class="subtle-note">{aiStatus?.detail ?? 'Connection has not been verified.'}</p>
            <details class="panel-disclosure">
              <summary>Observed project data</summary>
              <div class="diagnostic-facts" aria-label="Project statistics at last observation">
                <div><span>Projects</span><strong>{observedProjectCount ?? '—'}</strong></div>
                <div><span>Models</span><strong>{observedModelCount ?? '—'}</strong></div>
              </div>
              <p class="subtle-note">Project totals come from the last Desktop observation. Gateway statistics are available separately.</p>
            </details>
            <button type="button" class="text-action" disabled={navigationPending} onclick={navigateActivity}>View Gateway statistics</button>
          </section>

              {#if !fixture && nativePlacementDetail}
                <div class="inspector-footnote" role="status">Blockbench window: {nativePlacementDetail}</div>
              {/if}
            </section>
          </div>
          <button type="button" class="sidebar-footer"
            aria-label="Open Status: {readinessLabel}"
            onclick={() => sidebarTab = 'status'}>
            <span class="connection-status"><i class:verified={Boolean(status?.readiness.ready && statusProbeFailures < 2 && !loading && !readinessOutdated)}
              class:stale={statusProbeFailures >= 2 || readinessOutdated} aria-hidden="true"></i></span>
            <span>{readinessLabel}</span>
            <EditorChromeIcon name="diagnostic"/>
          </button>
        {/if}
      </aside>
    {/if}
  </div>
</main>

<style>
  /* Default (Dark) source of truth: JannisX11/blockbench, v5.2.1,
     themes/dark.bbtheme. A custom installed Blockbench theme cannot be
     truthfully inferred across a separate Windows process. Never modify it. */
  .unified-workspace {
    --color-ui: #1e2127;
    --color-back: #181b1f;
    --color-dark: #101316;
    --color-border: #101316;
    --color-selected: #3b3e49;
    --color-elevated: #272a31;
    --color-button: #33383f;
    --color-accent: #3e90ff;
    --color-text: #cacad4;
    --color-subtle_text: #848891;
    --ed-bg: var(--color-back);
    --ed-header: var(--color-ui);
    --ed-panel: var(--color-ui);
    --ed-raised: var(--color-elevated);
    --ed-border: var(--color-border);
    --ed-border-soft: var(--color-dark);
    --ed-text: var(--color-text);
    --ed-muted: #a6a8b0;
    --ed-muted-soft: var(--color-subtle_text);
    --ed-select: var(--color-selected);
    --ed-accent: var(--color-accent);
    display:flex; flex-direction:column; flex:1; min-width:0; min-height:0;
    overflow:hidden; background:var(--ed-bg); color:var(--ed-text);
    font-family:"Segoe UI",Arial,system-ui,sans-serif;
  }
  .editor-header {
    flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px;
    min-height:34px; padding:2px 7px; border-bottom:1px solid var(--ed-border);
    background:var(--ed-header);
  }
  .editor-leading,.editor-controls {display:flex;align-items:center;gap:4px;min-width:0}
  .editor-leading {flex:1 1 auto;overflow:hidden}
  .editor-controls {flex:none;justify-content:flex-end}
  .toolbar-separator{display:block;flex:none;width:1px;height:19px;margin:0 3px;background:var(--ed-border)}
  .editor-brand-mark {
    display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:2px;
    background:var(--ed-select);color:var(--ed-accent);font-size:16px;font-weight:700;
  }
  .editor-brand {font-size:12px;font-weight:700;letter-spacing:-.015em;white-space:nowrap}
  .header-divider {width:1px;height:20px;background:var(--ed-border);margin:0 3px;flex:none}
  .editor-context {display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:65px;flex:1 1 auto;padding-left:5px}
  .editor-context h1 {
    min-width:0;margin:0;font-size:12px;font-weight:650;line-height:1.3;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;
  }
  .subtitle {font-size:10px;color:var(--ed-muted-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .unsaved {color:#e9bb6d;font-size:10px;margin-left:5px}
  .model-opening {font-size:10px;color:var(--ed-accent);font-weight:600}
  .workspace-return,.editor-controls button {
    display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;
    min-height:27px;padding:3px 6px;border:1px solid transparent;border-radius:2px;
    color:var(--ed-muted);background:transparent;font-size:12px;font-weight:650;
    cursor:pointer;white-space:nowrap;
  }
  .workspace-return:hover,.editor-controls button:hover:not(:disabled){
    color:var(--ed-text);background:var(--ed-raised);
  }
  .workspace-return {margin-right:2px}
  .workspace-return,.dock-toggle{line-height:1}
  .editor-controls .dock-toggle.chosen{
    background:var(--ed-select);color:var(--ed-text);border-bottom:1px solid var(--ed-accent);
  }
  .editor-controls .open-model {
    color:var(--ed-text);background:var(--color-button);border-color:var(--ed-border);
    font-weight:650;margin-left:5px;
  }
  .editor-controls .open-model:hover:not(:disabled){background:var(--ed-select);color:var(--ed-text)}
  .editor-controls .launch-editor {border-color:var(--ed-border);background:var(--color-button);color:var(--ed-text)}
  .editor-controls .native-window-action {
    border-color:var(--ed-border);background:var(--ed-raised);color:var(--ed-text);
  }
  .editor-controls .support-button {width:29px;padding:4px;font-size:16px}
  .editor-header button:focus-visible,.dock-panel button:focus-visible,.dock-panel input:focus-visible {
    outline:2px solid var(--ed-accent);outline-offset:1px;
  }
  .unified-body {
    display:grid;grid-template-columns:minmax(0,1fr);flex:1;min-width:0;min-height:0;overflow:hidden;
  }
  /* Both docks participate in the grid: no host overlay hides native controls. */
  .unified-body.with-projects {grid-template-columns:var(--explorer-width,220px) 6px minmax(0,1fr)}
  .unified-body.with-inspector {grid-template-columns:minmax(0,1fr) 6px var(--tools-width,260px)}
  .unified-body.with-projects.with-inspector {
    grid-template-columns:var(--explorer-width,220px) 6px minmax(0,1fr) 6px var(--tools-width,240px);
  }
  /* All combinations keep left and right as real in-flow dock surfaces. */
  .unified-body.rail.with-projects.with-inspector {
    grid-template-columns:48px minmax(0,1fr) 6px var(--tools-width,240px);
  }
  .unified-body.tools-rail.with-projects.with-inspector {
    grid-template-columns:var(--explorer-width,220px) 6px minmax(0,1fr) 48px;
  }
  .unified-body.rail.tools-rail.with-projects.with-inspector {
    grid-template-columns:48px minmax(0,1fr) 48px;
  }
  .dock-resizer {
    width:6px;min-width:6px;min-height:0;background:var(--ed-bg);
    border-left:1px solid var(--ed-border-soft);
    border-right:1px solid var(--ed-border-soft);
    cursor:col-resize;touch-action:none;user-select:none;
  }
  .dock-resizer:hover,.dock-resizer:focus-visible{
    background:var(--ed-select);outline:2px solid var(--ed-accent);outline-offset:-1px;
  }
  .dock-resizer:active{background:var(--ed-accent)}
  .dock-panel {min-width:0;min-height:0;overflow:auto;scrollbar-width:thin;background:var(--ed-panel)}
  .explorer {border-right:1px solid var(--ed-border);padding:0 7px 18px}
  .explorer.rail,.inspector.rail {padding:5px 3px;overflow:hidden}
  .rail-actions{display:grid;gap:7px;justify-items:center}
  .rail-actions button{
    display:grid;place-items:center;width:38px;min-height:36px;border:1px solid transparent;
    border-radius:5px;background:transparent;color:var(--ed-text);font-size:18px;cursor:pointer;
  }
  .rail-actions button:hover:not(:disabled),.rail-actions button:focus-visible{
    background:var(--ed-raised);border-color:var(--ed-border);outline-color:var(--ed-accent);
  }
  .inspector {border-left:1px solid var(--ed-border);padding:0 9px 18px}
  /* Blockbench panel tab bars are 40px in the v5.2.1 source. */
  .pane-heading {
    display:flex;align-items:center;justify-content:space-between;gap:4px;
    height:40px;margin:0 -7px 7px;padding:0 9px;
    background:var(--color-back);border-bottom:1px solid var(--ed-border);
  }
  .pane-actions{display:flex;align-items:center;gap:3px;min-width:0}
  .pane-heading h3 {
    margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    text-transform:uppercase;letter-spacing:.03em;font-size:12px;font-weight:650;color:var(--ed-text);
  }
  /* Blockbench v5.2.1: one 40px panel tab bar, not a heading plus another
     bar. The collapse control sits beside the tablist, never inside it. */
  .diagnostic-panel-bar {
    display:flex;align-items:stretch;height:40px;min-width:0;
    margin:0 -9px 9px;padding:0 3px;
    background:var(--color-back);box-shadow:inset 0 -1px var(--ed-border);
  }
  .diagnostic-tabs {
    display:flex;align-items:stretch;flex:1 1 auto;min-width:0;
    height:40px;padding:3px 0 0;gap:0;
    background:var(--color-back);
  }
  .diagnostic-collapse{
    align-self:center;flex:none;width:28px;height:28px;
    display:grid;place-items:center;
    margin:0 0 0 2px;padding:0;
    border:0;border-radius:3px;background:transparent;
    color:var(--ed-muted);cursor:pointer;
  }
  .diagnostic-collapse:hover{background:var(--ed-raised);color:var(--ed-text)}
  .diagnostic-collapse:focus-visible{outline:2px solid var(--ed-accent);outline-offset:-2px}
  .diagnostic-tabs button {
    flex:1 1 0;min-width:0;height:36px;margin:0;padding:0 4px;
    border:0;border-radius:3px 3px 0 0;
    background:transparent;color:var(--ed-muted-soft);
    font-size:12px;font-weight:650;letter-spacing:-.01em;
    text-transform:uppercase;white-space:nowrap;cursor:pointer;
  }
  .diagnostic-tabs button.selected {
    background:var(--color-ui);color:var(--ed-text);
    box-shadow:inset 0 -2px var(--ed-accent);
  }
  .diagnostic-facts{display:grid;margin:8px 0;border-top:1px solid var(--ed-border)}
  .diagnostic-facts>div{
    display:flex;justify-content:space-between;align-items:flex-start;gap:9px;
    padding:6px 0;border-bottom:1px solid var(--ed-border);font-size:11px;
  }
  .diagnostic-facts span{color:var(--ed-muted)}
  .diagnostic-facts strong{color:var(--ed-text);text-align:right;font-weight:600;overflow-wrap:anywhere}
  .diagnostic-tabs button:hover:not(.selected){color:var(--ed-text)}
  .diagnostic-tabs button:focus-visible {
    outline:2px solid var(--ed-accent);outline-offset:-2px;
  }
  .inspector-section[role="tabpanel"]:focus-visible {
    outline:2px solid var(--ed-accent);outline-offset:-2px;
  }
  .pane-heading button {
    display:grid;place-items:center;width:27px;height:27px;border:1px solid transparent;
    border-radius:2px;background:transparent;color:var(--ed-muted);font-size:17px;cursor:pointer;
  }
  .search-label{display:block;margin:0 4px 5px;font-size:11px;color:var(--ed-muted)}
  .search-controls{position:relative;display:flex;align-items:center;gap:4px;min-width:0;margin:3px 1px 0}
  .search-icon{
    position:absolute;left:8px;top:6px;display:grid;place-items:center;
    pointer-events:none;color:var(--ed-muted-soft);
  }
  .explorer input {
    flex:1 1 auto;width:100%;min-width:0;min-height:28px;border:1px solid var(--ed-border);
    border-radius:2px;background:var(--color-back);color:var(--ed-text);padding:4px 8px 4px 29px;font-size:12px;
  }
  /* The Editor provides an explicit clear control when filtered. */
  .explorer input::-webkit-search-cancel-button{display:none}
  .search-controls button{
    flex:none;width:27px;min-height:28px;border:0;border-radius:2px;
    background:transparent;color:var(--ed-muted);font-size:17px;cursor:pointer;
  }
  .search-controls button:hover{background:var(--ed-raised);color:var(--ed-text)}
  .search-hint{margin:0 4px 6px;color:var(--ed-muted-soft);font-size:10px;line-height:1.4}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .explorer input::placeholder{color:var(--ed-muted-soft)}
  .search-count{font-size:10px;color:var(--ed-muted-soft);padding:4px 5px 5px}
  .search-count.sr-only{padding:0}
  .project-tree {display:grid;gap:0;min-width:0;border-top:1px solid var(--ed-border-soft);padding-top:3px}
  .project-group {min-width:0} /* Blockbench Outliner uses contiguous rows; no divider between sibling folders. */
  .project-line {display:flex;align-items:center;gap:1px;min-height:30px}
  .project-line:focus-within{background:var(--ed-raised)}
  .project-line.active-project .project-name{color:var(--ed-text);font-weight:650}
  .project-line.active-project .project-icon{color:var(--ed-text)}
  .project-active-indicator{margin-left:auto;flex:none;color:var(--ed-accent);font-size:9px;line-height:1}
  .project-expand {
    display:flex;align-items:center;gap:6px;flex:1;min-width:0;
    height:30px;padding:2px 5px;line-height:1.2;
    border:0;background:transparent;color:var(--ed-text);text-align:left;
    font-size:12px;font-weight:600;border-radius:2px;cursor:pointer;
  }
  .project-expand:hover:not(:disabled),.model-open:hover:not(:disabled),.recent-model:hover:not(:disabled){
    background:var(--ed-raised);color:var(--ed-text);
  }
  /* Search results remain readable and keyboard-discoverable as static tree headers. */
  .project-expand:disabled{opacity:1;cursor:default}
  .project-expand:focus-visible,.project-actions-toggle:focus-visible{
    outline:2px solid var(--ed-accent);outline-offset:-2px;
  }
  .tree-caret{
    display:grid;place-items:center;flex:none;
    width:13px;height:16px;color:var(--ed-muted-soft);
    transition:transform 80ms linear;
  }
  .tree-caret.expanded{transform:rotate(90deg)}
  .project-icon{display:grid;place-items:center;flex:none;color:var(--ed-muted-soft)}
  .project-name,.model-name {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* One compact action affordance preserves project-name width; its commands
     are expanded as normal layout content, never over the native cutout. */
  .project-actions-toggle {
    display:grid;place-items:center;flex:none;width:25px;height:30px;
    border:0;border-radius:2px;background:transparent;color:var(--ed-muted);cursor:pointer;
    opacity:.65;
  }
  .project-line:hover .project-actions-toggle,
  .project-line:focus-within .project-actions-toggle,
  .project-actions-toggle[aria-expanded="true"] {opacity:1}
  .project-actions-toggle:hover,
  .project-actions-toggle[aria-expanded="true"]{background:var(--ed-raised);color:var(--ed-text)}
  .project-inline-actions{
    display:flex;align-items:center;flex-wrap:wrap;gap:5px;
    margin:0 2px 6px 19px;padding:4px 0 5px;border-bottom:1px solid var(--ed-border);
  }
  .project-inline-actions button{
    min-height:28px;padding:4px 7px;border:1px solid var(--ed-border);
    border-radius:2px;background:var(--ed-raised);color:var(--ed-text);
    font-size:11px;cursor:pointer;
  }
  .project-inline-actions button:hover:not(:disabled){background:var(--ed-select)}
  .project-inline-actions button:disabled{cursor:default}
  .project-inline-actions .pin-project[aria-pressed="true"]{color:#dfbc7c}
  .model-line {
    position:relative;display:flex;align-items:center;gap:2px;
    min-width:0;padding-left:20px;min-height:28px;
  }
  /* Match Blockbench's Outliner: selection fill, no additional left stripe.
     The current-model dot remains independently visible and labelled. */
  .model-line.current {background:var(--ed-select);border-radius:2px} .model-line:not(.current):hover{background:var(--ed-raised)}
  /* Reveal is a direct file action, never a fake ellipsis menu. It occupies
     the row edge only when needed, preserving model-name width at rest. */
  .model-line .reveal-model {
    display:grid;place-items:center;position:absolute;top:0;right:1px;
    width:26px;height:28px;padding:0;
    border:0;border-radius:3px;background:transparent;color:var(--ed-muted);
    opacity:0;pointer-events:none;cursor:pointer;
    transition:opacity 80ms linear;
  }
  .model-line.has-reveal:hover,
  .model-line.has-reveal:focus-within {padding-right:28px}
  .model-line.has-reveal:hover .reveal-model,
  .model-line.has-reveal:focus-within .reveal-model {
    opacity:1;pointer-events:auto;
  }
  .model-line.has-reveal:hover .reveal-model:disabled,
  .model-line.has-reveal:focus-within .reveal-model:disabled {
    opacity:.52;pointer-events:none;cursor:default;
  }
  .model-line .reveal-model:hover:not(:disabled),
  .model-line .reveal-model:focus-visible {
    background:var(--ed-raised);color:var(--ed-text);
  }
  /* No hover on touch: keep the same file action discoverable and in flow
     without relying on a pointer or an invisible keyboard focus target. */
  @media(hover:none) {
    .model-line.has-reveal {padding-right:28px}
    .model-line.has-reveal .reveal-model {opacity:1;pointer-events:auto}
    .model-line.has-reveal .reveal-model:disabled {
      opacity:.52;pointer-events:none;cursor:default;
    }
  }
  @media(prefers-reduced-motion:reduce) {
    .model-line .reveal-model {transition:none}
  }
  .model-open {
    display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0;border-radius:3px;
    height:28px;padding:2px 4px;line-height:1.2;
    background:transparent;text-align:left;color:var(--ed-muted);font-size:12px;cursor:pointer;
  }
  .model-line.current .model-open{color:var(--ed-text)}
  .model-symbol{color:var(--ed-muted-soft);font-size:14px;flex:none}
  .model-current-indicator{
    width:9px;flex:none;color:var(--ed-accent);font-size:9px;line-height:1;
    text-align:center;
  }
  .model-state{color:var(--ed-muted-soft);font-size:10px;white-space:nowrap}
  .model-state.warning{color:#e1b65f}
  .row-hint,.empty-state{color:var(--ed-muted);font-size:12px;line-height:1.5;margin:7px 5px}
  .explorer-empty{display:grid;gap:9px;padding:5px 3px}
  .empty-add-folder{
    justify-self:start;min-height:32px;padding:6px 10px;border:1px solid var(--ed-border);
    background:var(--ed-raised);color:var(--ed-text);border-radius:5px;font-size:11px;cursor:pointer;
  }
  .empty-add-folder:hover:not(:disabled){border-color:var(--ed-accent)}
  .project-resources{border-top:1px solid var(--ed-border-soft);margin:4px 2px 3px 14px}
  .project-resources summary{
    display:flex;align-items:center;gap:6px;min-height:31px;padding:6px 4px;
    border-radius:4px;color:var(--ed-muted);font-size:11px;font-weight:650;cursor:pointer;
    list-style:none;
  }
  .project-resources summary::-webkit-details-marker{display:none}
  .project-resources summary::before{content:'▸';font-size:12px}
  .project-resources[open] summary::before{content:'▾'}
  .project-resources summary:hover,.resource-link:hover{background:var(--ed-raised);color:var(--ed-text)}
  .project-resources summary:focus-visible{
    outline:2px solid var(--ed-accent);outline-offset:-2px;
  }
  .resource-count{margin-left:auto;color:var(--ed-muted-soft);font-size:10px}
  .resource-links{display:grid;gap:1px;padding-left:9px}
  .resource-link{
    display:flex;gap:7px;align-items:center;min-width:0;min-height:30px;padding:5px;
    border:0;border-radius:4px;background:transparent;color:var(--ed-muted);
    text-align:left;font-size:11px;cursor:pointer;
  }
  .resource-link span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  .more-projects {
    width:100%;border:0;border-top:1px solid var(--ed-border-soft);background:transparent;
    color:var(--ed-muted);font-size:12px;text-align:left;padding:9px 5px;cursor:pointer;
  }
  .recent-group{border-top:1px solid var(--ed-border-soft);margin-top:9px;padding-top:5px}
  .recent-heading{
    display:flex;align-items:center;gap:6px;width:100%;min-height:28px;padding:4px 5px;
    border:0;border-radius:2px;background:transparent;color:var(--ed-muted);
    font-size:11px;font-weight:600;text-align:left;cursor:pointer;
  }
  .recent-heading:hover{background:var(--ed-raised);color:var(--ed-text)}
  .recent-count{margin-left:auto;color:var(--ed-muted-soft);font-size:10px}
  .recent-model {
    display:grid;gap:2px;width:100%;min-width:0;border:0;border-radius:2px;
    background:transparent;text-align:left;color:var(--ed-text);padding:5px 6px;font-size:12px;cursor:pointer;
  }
  .recent-model span,.recent-model small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .recent-model small{font-size:10px;color:var(--ed-muted-soft)}
  .native-stage{
    display:flex;min-width:0;min-height:0;overflow:hidden;
    --ed-native-bg:var(--color-dark);
    background:var(--color-dark);
  }
  .native-stage :global(.native-editor-page){min-width:0;width:100%}
  .read-only-label {font-size:10px;color:var(--ed-muted-soft);letter-spacing:.04em}
  .inspector-section{padding:8px 3px 12px;margin-bottom:3px;border-bottom:1px solid var(--ed-border)}
  .inspector-context{padding:5px 0 14px;margin-bottom:12px;border-bottom:1px solid var(--ed-border)}
  .context-heading,.inspector-status-heading{font-size:10px;font-weight:650;color:var(--ed-muted-soft);letter-spacing:.035em;margin-bottom:9px}
  .context-model{display:flex;align-items:center;gap:8px;min-width:0;color:var(--ed-text);font-size:13px}
  .context-model strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
  .context-model :global(svg){flex:none;color:var(--ed-accent)}
  .context-project{display:flex;align-items:center;gap:7px;margin:8px 0 0 2px;color:var(--ed-muted);font-size:11px;min-width:0}
  .context-project span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .context-project :global(svg){flex:none}
  .context-dirty{display:block;margin:7px 0 0 2px;font-size:10px;color:#e1b65f}
  .status-summary{margin-bottom:10px}
  .inspector-section h4{
    font-size:12px;font-weight:650;color:var(--ed-text);margin:0 0 7px;
    text-transform:uppercase;letter-spacing:.03em;
  }
  .inspector-section p{margin:6px 0;font-size:11px;color:var(--ed-muted);line-height:1.45}
  .inspector-section .subtle-note{color:var(--ed-muted-soft);font-size:11px}
  .pane-actions .read-only-label{font-size:9px;white-space:nowrap}
  .inspector-section button.text-action{color:var(--ed-accent);padding-left:0}
  .model-detail{display:grid;gap:4px;margin:5px 0 10px}
  .model-detail strong{font-size:12px;font-weight:650;overflow-wrap:anywhere}
  .model-detail span{font-size:11px;color:var(--ed-muted)}
  .inspector.rail .rail-actions{padding-top:4px}
  .panel-disclosure{margin:5px 0 7px;border-bottom:1px solid var(--ed-border)}
  .panel-disclosure summary{
    padding:6px 2px;color:var(--ed-muted);font-size:11px;cursor:pointer;
  }
  .panel-disclosure[open] summary{color:var(--ed-text)}
  .panel-disclosure .diagnostic-facts{margin:3px 0 7px}
  .panel-disclosure summary:hover{color:var(--ed-text)}
  .panel-disclosure summary:focus-visible{outline:2px solid var(--ed-accent);outline-offset:1px}
  .panel-disclosure p{margin:5px 0 8px}

  .connection-status{
    display:flex;align-items:center;gap:7px;min-width:0;
    color:var(--ed-text);font-size:12px;
  }
  .connection-status strong{min-width:0;overflow-wrap:anywhere}
  .connection-status i{height:7px;width:7px;border-radius:100%;background:#8f9bad;flex:none}
  .connection-status i.verified{background:#6bc493}
  .connection-status i.stale{background:#e1b65f}
  .inspector-section button,.state-note button {
    min-height:28px;margin-top:6px;padding:4px 8px;border:1px solid var(--ed-border);
    border-radius:2px;background:var(--color-button);color:var(--ed-text);font-size:11px;font-weight:600;cursor:pointer;
  }
  .inspector-section button.text-action{background:transparent;border:0;color:var(--ed-accent);padding:5px 4px}
  .inspector-footnote {font-size:11px;color:var(--ed-muted-soft);line-height:1.5}
  .state-note {
    display:grid;gap:6px;margin:0 0 11px;padding:8px;border-left:2px solid #e1b65f;
    background:#302b25;font-size:11px;color:var(--ed-muted);
  }
  .state-note strong{color:var(--ed-text)}
  .state-note button{justify-self:start}
  .inline-error {
    display:flex;align-items:start;justify-content:space-between;gap:8px;
    flex:none;padding:8px 12px;border-bottom:1px solid #77514c;
    background:#35282b;color:#f2b0a8;font-size:12px;
  }
  .inline-error button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}
  button:disabled{opacity:.52;cursor:default}
  @media(max-width:1319px) {
    .dock-label{display:none}
  }
  /* Like Blockbench's compact tool rows, the host utility header remains a
     single line. Extra actions scroll in their own bounded group, never the
     native viewport or the document. Focused buttons remain keyboard-reachable. */
  @media(max-width:1030px){
    .editor-header{min-height:38px;padding:2px 6px;gap:5px;flex-wrap:nowrap}
    .editor-leading{flex:0 1 205px;min-width:120px;gap:5px}
    .editor-brand{font-size:12px}
    .workspace-label{display:none}
    .editor-context{min-width:0}
    .editor-controls{
      flex:1 1 0;min-width:0;width:auto;justify-content:flex-start;
      flex-wrap:nowrap;gap:4px;padding:1px 0;
      overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;
      scrollbar-width:thin;scrollbar-color:var(--color-button) transparent;
    }
    .editor-controls button{flex:none}
    .toolbar-separator{margin:0 2px}
    .editor-controls button:focus-visible{outline-offset:-2px}
  }
  @media(max-width:919px){
    /* The companions remain on BOTH sides; do not stack over native Blockbench. */
    .unified-body.rail.with-projects.with-inspector{
      grid-template-columns:44px minmax(0,1fr) 6px var(--tools-width,240px);
    }
    .unified-body.tools-rail.with-projects.with-inspector{
      grid-template-columns:var(--explorer-width,220px) 6px minmax(0,1fr) 44px;
    }
    .unified-body.rail.tools-rail.with-projects.with-inspector{
      grid-template-columns:44px minmax(0,1fr) 44px;
    }
    .rail-actions button{width:34px}
  }
  @media(max-width:600px){
    .editor-header{min-height:38px;padding:2px 5px;gap:4px;flex-wrap:nowrap}
    .editor-leading{width:auto;flex:0 1 112px;min-width:92px;gap:3px}
    .editor-brand,.header-divider{display:none}
    .editor-brand-mark{width:20px;height:20px}
    .editor-context{min-width:0;padding-left:0}
    .editor-context h1{font-size:12px}
    .editor-context .subtitle{display:none}
    .workspace-return{width:27px;min-height:27px;padding:3px}
    .editor-controls{width:auto;flex:1 1 0;justify-content:flex-start;flex-wrap:nowrap;gap:3px}
    .editor-controls button{min-height:27px;padding:3px 6px}
    .toolbar-separator{margin:0 1px;height:17px}
    .editor-controls .launch-editor,.editor-controls .open-model{font-size:11px}
  }

  /* Unified right-side companion. Native Blockbench retains the full left/center area. */
  .unified-body.with-projects.with-inspector,
  .unified-body.rail.with-projects.with-inspector,
  .unified-body.tools-rail.with-projects.with-inspector,
  .unified-body.rail.tools-rail.with-projects.with-inspector{
    grid-template-columns:minmax(0,1fr) 6px var(--tools-width,260px);
  }
  .unified-body.tools-rail.with-inspector{grid-template-columns:minmax(0,1fr) 44px}
  .unified-sidebar{display:flex;flex-direction:column;overflow:hidden;padding:0;border-left:1px solid var(--ed-border);background:var(--color-back)}
  .sidebar-top{flex:none;padding:0 12px}
  .sidebar-brand{display:flex;align-items:center;gap:9px;height:48px;border-bottom:1px solid var(--ed-border);color:var(--ed-text);font-size:13px}
  .sidebar-brand :global(svg){color:var(--ed-accent)}
  .sidebar-collapse{display:grid;place-items:center;margin-left:auto;width:28px;height:28px;border:0;border-radius:4px;background:transparent;color:var(--ed-muted);cursor:pointer}
  .sidebar-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0 8px}
  .sidebar-tabs button{display:flex;justify-content:center;align-items:center;gap:7px;height:36px;border:0;border-radius:5px;background:transparent;color:var(--ed-muted);font-size:12px;cursor:pointer}
  .sidebar-tabs button.selected{background:var(--ed-raised);color:var(--ed-text);font-weight:650}
  .sidebar-tabs button:hover:not(.selected){background:var(--ed-select);color:var(--ed-text)}
  .sidebar-content{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin}
  .sidebar-page{padding:0 12px 16px}
  .sidebar-page[hidden]{display:none}
  .sidebar-page.explorer{border:0;background:transparent}
  .sidebar-page .pane-heading{height:31px;margin:0 -4px 5px;padding:0 4px;background:transparent;border:0}
  .sidebar-page .pane-heading h3{font-size:11px;font-weight:600;text-transform:none;letter-spacing:0}
  .sidebar-page .project-tree{border-top:0}
  .sidebar-page .search-count:not(.sr-only){padding:5px 5px}
  .sidebar-page .project-expand{font-weight:550}
  .sidebar-page .model-line.current{background:var(--ed-select)}
  .sidebar-page .inspector-section{border:0;padding:10px 0}
  .sidebar-footer{flex:none;display:flex;align-items:center;gap:9px;min-height:44px;margin:0 12px;padding:8px 2px;border:0;border-top:1px solid var(--ed-border);background:transparent;color:var(--ed-muted);font-size:11px;text-align:left;cursor:pointer}
  .sidebar-footer>span:nth-child(2){flex:1}
  .sidebar-footer:hover{color:var(--ed-text)}
  .sidebar-footer .connection-status{gap:0}
  .sidebar-footer .connection-status i{display:block}
  .unified-sidebar.rail{padding:5px 3px}

  /* V2: quiet navigation, single right sidebar, contextual project commands. */
  .unified-sidebar{background:#15171b}
  .sidebar-brand{height:48px;font-size:13px}
  .sidebar-tabs{margin:14px 0 12px;gap:8px}
  .sidebar-tabs button{height:40px;border-radius:6px}
  .sidebar-tabs button.selected{background:#24262c}
  .sidebar-page .pane-heading{height:30px;margin:6px -2px 7px}
  .sidebar-page .pane-heading h3{font-size:11px;color:var(--ed-muted-soft);font-weight:600}
  .sidebar-page .search-controls{margin:0 0 6px}
  .sidebar-page .explorer input,.sidebar-page.explorer input{min-height:32px;background:#1b1e23;border-color:#282c33;border-radius:5px}
  .sidebar-page .project-group{position:relative}
  .sidebar-page .project-line{min-height:32px}
  .sidebar-page .project-expand{height:32px;font-weight:550}
  .sidebar-page .project-actions-toggle{opacity:.48}
  .sidebar-page .project-line:hover .project-actions-toggle,
  .sidebar-page .project-line:focus-within .project-actions-toggle,
  .sidebar-page .project-actions-toggle[aria-expanded="true"]{opacity:1}
  .sidebar-page .project-inline-actions{
    position:absolute;z-index:8;right:4px;top:32px;display:grid;gap:2px;
    min-width:128px;margin:0;padding:5px;border:1px solid #373b44;
    border-radius:6px;background:#252830;box-shadow:0 9px 22px rgba(0,0,0,.4);
  }
  .sidebar-page .project-inline-actions button{
    min-height:30px;padding:6px 9px;text-align:left;border:0;border-radius:3px;
    background:transparent;font-size:11px
  }
  .sidebar-page .project-inline-actions button:hover:not(:disabled){background:var(--ed-select)}
  .sidebar-page .model-line{min-height:30px}
  .sidebar-page .model-line.current{background:#2a2e39;border-radius:5px}
  .sidebar-page .model-current-indicator{
    width:auto;margin-right:5px;color:#b7c5dc;font-size:10px;white-space:nowrap
  }
  .sidebar-page .recent-group{margin-top:15px;padding-top:10px}
  .sidebar-footer{min-height:48px}
  @media(hover:none){.sidebar-page .project-actions-toggle{opacity:1}}

  /* V3: one obvious model-opening action, readable navigation at 260-300px. */
  .unified-sidebar{font-size:13px}
  .sidebar-brand{font-size:14px}
  .sidebar-tabs button{font-size:13px;font-weight:550}
  .project-primary-action{display:flex;align-items:center;gap:7px;margin:4px 0 12px}
  .project-primary-action button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;border-radius:6px;cursor:pointer}
  .project-primary-action .sidebar-open-model{flex:1;justify-content:flex-start;padding:7px 11px;background:var(--color-button);color:var(--ed-text);font-size:13px;font-weight:650}
  .project-primary-action .sidebar-add-folder{flex:none;width:36px;background:var(--ed-raised);color:var(--ed-text)}
  .project-primary-action button:hover:not(:disabled){background:var(--ed-select)}
  .project-primary-action button:focus-visible{outline:2px solid var(--ed-accent);outline-offset:1px}
  .sidebar-page .search-controls{margin-bottom:10px}
  .sidebar-page.explorer input{font-size:13px;min-height:36px}
  .sidebar-page .project-expand{font-size:13px;height:36px}
  .sidebar-page .project-line{min-height:36px}
  .sidebar-page .model-line{min-height:34px}
  .sidebar-page .model-open{font-size:13px;height:34px}
  .sidebar-page .recent-heading{font-size:13px;min-height:34px}
  .sidebar-page .recent-model{font-size:13px}
  .sidebar-page .project-resources summary{font-size:12px}
  .sidebar-page .search-count{font-size:11px}
  .sidebar-footer{font-size:12px}
  .sidebar-page .project-inline-actions{top:36px}
</style>
