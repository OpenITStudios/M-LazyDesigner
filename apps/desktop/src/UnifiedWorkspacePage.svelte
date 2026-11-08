<script lang="ts">
  import NativeEditorStage from './NativeEditorStage.svelte';
  import {
    defaultEditorPanels, editorDockWidth, editorLayoutBand,
    type EditorDock, type EditorLayoutState,
  } from './editorLayout';
  import { onMount } from 'svelte';
  import {
    aiStatusPresentation, continueTarget, recentModelTargets,
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
  export let layout: EditorLayoutState;
  export let openModel: (id?: string) => Promise<void>;
  export let addProjectFolder: () => Promise<void>;
  export let runProjectAction: (action: ProjectAction, id: string) => Promise<void>;
  export let focusCurrentEditor: () => Promise<void>;
  export let openBlockbenchEditor: () => Promise<void>;
  export let refresh: () => Promise<void>;
  export let navigateSupport: () => void;
  export let navigateWorkspace: () => void;

  type NativePlacementState = 'PRESENTED' | 'DETACHED' | 'DEFERRED' | 'UNAVAILABLE' | 'UNCERTAIN';
  let nativeStage: { detach: () => Promise<boolean>; present: () => Promise<void> } | undefined;
  let nativePlacement: 'DETACHED' | 'PRESENTED' | 'UNCERTAIN' = 'DETACHED';
  let nativePlacementDetail = '';
  let editorRoot: HTMLElement;
  let drag: { dock: EditorDock; pointerId: number; x: number; width: number } | null = null;
  let search = '';
  let showAll = false;
  let expandedProjectId: string | null = null;
  let recentExpanded = false;
  let executing = false;
  let localNotice = '';
  let searchInput: HTMLInputElement | undefined;

  $: navigation = status?.project_navigation ?? null;
  $: active = navigation?.active ?? null;
  $: projects = navigation ? visibleProjects(navigation, search, showAll) : [];
  $: uniqueTarget = navigation ? uniqueModelSearchTarget(navigation, search) : null;
  $: recentTargets = navigation ? recentModelTargets(navigation).slice(0, 3) : [];
  $: continuing = navigation ? continueTarget(navigation) : null;
  $: aiStatus = status ? aiStatusPresentation(status, statusProbeFailures, statusPresentationNowMs) : null;
  $: actionBusy = Boolean(busyAction) || executing;
  $: showProjects = layout.projectsVisible && !layout.focusMode;
  $: showTools = layout.toolsVisible && !layout.focusMode;
  $: explorerRail = showProjects && layout.band === 'rail' && !layout.railExpanded;

  function expanded(project: ProjectNavigationProject): boolean {
    return expandedProjectId === project.id
      || (expandedProjectId === null && navigation?.active?.project_id === project.id);
  }
  function toggleProject(project: ProjectNavigationProject) {
    expandedProjectId = expanded(project) ? '' : project.id;
  }
  function changeLayout(next: Partial<EditorLayoutState>) {
    layout = { ...layout, ...next };
  }
  function toggleProjectsPanel() {
    const opening = layout.focusMode || !layout.projectsVisible;
    changeLayout({
      focusMode: false,
      projectsVisible: opening,
      railExpanded: opening ? false : layout.railExpanded,
      ...(opening && layout.band !== 'wide'
        ? { toolsVisible: false, restoreProjectsAfterTools: false, restoreRailAfterTools: false }
        : {}),
    });
  }
  function expandExplorer() {
    // Rail mode is intentionally compact until the user asks for full browsing.
    changeLayout({
      projectsVisible: true, railExpanded: true, toolsVisible: false,
      restoreProjectsAfterTools: false, restoreRailAfterTools: false,
    });
  }
  function toggleToolsPanel() {
    const opening = layout.focusMode || !layout.toolsVisible;
    if (layout.band !== 'wide' && opening) {
      changeLayout({
        focusMode: false, toolsVisible: true,
        restoreProjectsAfterTools: layout.projectsVisible,
        restoreRailAfterTools: layout.railExpanded,
        projectsVisible: false, railExpanded: false,
      });
    } else if (layout.band !== 'wide' && !opening) {
      changeLayout({
        focusMode: false, toolsVisible: false,
        projectsVisible: layout.restoreProjectsAfterTools,
        railExpanded: layout.restoreRailAfterTools,
        restoreProjectsAfterTools: false, restoreRailAfterTools: false,
      });
    } else {
      changeLayout({ focusMode: false, toolsVisible: opening });
    }
  }
  function toggleFocusMode() {
    changeLayout({ focusMode: !layout.focusMode });
  }
  function syncWidthBand() {
    const band = editorLayoutBand(editorRoot.getBoundingClientRect().width);
    if (band === layout.band) return;
    // Preserve the user's explicit state within each width band and across
    // Workspace/Support navigation; only crossing a band resets the defaults.
    changeLayout({ band, ...defaultEditorPanels(band) });
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
      localNotice = 'Blockbench window restoration is unverified. Use Detach Blockbench before other actions. ' + detail;
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
    return nativeStage ? nativeStage.detach() : true;
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
        localNotice = 'Blockbench window restoration is unverified. Use Detach & restore window before opening another model or folder.';
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
  <header class="editor-header" aria-label="LazyDesigner editor controls">
    <div class="editor-leading">
      <span class="editor-brand-mark" aria-hidden="true">◇</span>
      <span class="editor-brand">LazyDesigner</span>
      <span class="header-divider" aria-hidden="true"></span>
      <button class="workspace-return" type="button" aria-label="Return to Workspace"
        title="Workspace" onclick={navigateWorkspace}>
        <span aria-hidden="true">▦</span><span class="workspace-label">Workspace</span>
      </button>
      <div class="editor-context">
        <h1 tabindex="-1" title={active?.model_name ?? continuing?.model.name ?? 'Blockbench workspace'}>
          {active?.model_name ?? continuing?.model.name ?? 'Blockbench workspace'}
          {#if active?.dirty}<span class="unsaved" title="Unsaved changes at last observation">●</span>{/if}
        </h1>
        <span class="subtitle">
          {active?.project_name ?? continuing?.project.name ?? 'No active model'}
          · {active ? 'Last observed' : 'Development preview'}
        </span>
        {#if openingModelId}<span class="model-opening" role="status">Opening requested model…</span>{/if}
      </div>
    </div>
    <div class="editor-controls" role="group" aria-label="Editor actions and panels">
      <span class="ai-indicator" role="status"
        title={aiStatus?.detail ?? 'AI connection has not been verified'}>
        <i class:verified={Boolean(aiStatus?.recentlyVerified)}
          class:stale={Boolean(aiStatus?.needsRefresh)} aria-hidden="true"></i>
        <span class="ai-label">{aiStatus?.label ?? 'AI unverified'}</span>
      </span>
      <button type="button" class="dock-toggle" class:chosen={showProjects}
        aria-label="Toggle Project Explorer" title="Project Explorer"
        aria-expanded={showProjects}
        aria-controls={showProjects ? 'ld-unified-explorer' : undefined}
        onclick={toggleProjectsPanel}><span aria-hidden="true">▤</span><span class="dock-label">Projects</span></button>
      <button type="button" class="dock-toggle" class:chosen={showTools}
        aria-label="Toggle Model Tools" title="Model Tools"
        aria-expanded={showTools}
        aria-controls={showTools ? 'ld-unified-inspector' : undefined}
        onclick={toggleToolsPanel}><span aria-hidden="true">⚒</span><span class="dock-label">Model Tools</span></button>
      <button type="button" class="dock-toggle" class:chosen={layout.focusMode}
        aria-label={layout.focusMode ? 'Exit Focus Editor' : 'Focus Editor'}
        aria-pressed={layout.focusMode}
        title={layout.focusMode ? 'Restore side panels' : 'Maximize Blockbench working area'}
        onclick={toggleFocusMode}><span aria-hidden="true">⛶</span><span class="dock-label">Focus</span></button>
      {#if !status?.blockbench.running}
        <button type="button" class="launch-editor" disabled={actionBusy || fixture || statusProbeFailures >= 2}
          onclick={() => void launchBlockbench()}>Open Blockbench</button>
      {/if}
      <button type="button" class="open-model" disabled={actionBusy || fixture}
        onclick={() => void openModelSafely()}>Open Model…</button>
      {#if !fixture}
        {#if nativePlacement === 'DETACHED'}
          <button type="button" class="native-window-action"
            aria-label="Place original Blockbench window in workspace"
            title="Position the existing Blockbench window in the reserved center area"
            disabled={actionBusy || !status?.blockbench.running}
            onclick={requestNativePlacement}>Place Blockbench</button>
        {:else}
          <button type="button" class="native-window-action"
            aria-label="Detach and restore original Blockbench window"
            title={nativePlacement === 'UNCERTAIN'
              ? 'Native placement is unverified; restore the original Blockbench window'
              : 'Detach Blockbench and restore its original window bounds'}
            disabled={actionBusy}
            onclick={restoreNativeWindow}>Detach Blockbench</button>
        {/if}
      {/if}
      <button type="button" class="support-button" title="Support and settings"
        aria-label="Open Support" onclick={navigateSupport}><span aria-hidden="true">⚙</span></button>
    </div>
  </header>

  {#if localNotice}
    <div class="inline-error" role="alert"><span>{localNotice}</span><button type="button" onclick={() => localNotice = ''} aria-label="Dismiss workspace notice">×</button></div>
  {/if}

  <div class="unified-body" class:with-projects={showProjects} class:with-inspector={showTools}
    class:rail={explorerRail}
    style={`--explorer-width: ${layout.projectsWidth}px; --tools-width: ${layout.toolsWidth}px;`}>
    {#if showProjects}
      <aside id="ld-unified-explorer" class="explorer dock-panel" class:rail={explorerRail} aria-label="Project Explorer">
        {#if explorerRail}
          <div class="rail-actions" role="group" aria-label="Project Explorer shortcuts">
            <button type="button" aria-label="Expand Project Explorer" title="Expand Project Explorer"
              onclick={expandExplorer}>▤</button>
            <button type="button" aria-label="Open Model from Project Explorer" title="Open Model…"
              disabled={actionBusy || fixture} onclick={() => void openModelSafely()}>◇</button>
            <button type="button" aria-label="Add Project Folder from Project Explorer" title="Add Project Folder"
              disabled={actionBusy || fixture || !status || statusProbeFailures >= 2}
              onclick={() => void registerFolder()}>+</button>
          </div>
        {:else}
        <div class="pane-heading">
          <h3>Project Explorer</h3>
          <div class="pane-actions">
            {#if layout.band === 'rail'}
              <button type="button" aria-label="Collapse Project Explorer to icons"
                title="Collapse Project Explorer to icons"
                onclick={() => changeLayout({ railExpanded: false })}>◀</button>
            {/if}
            <button type="button" title="Add existing project folder" aria-label="Add Project Folder"
              disabled={actionBusy || fixture || !status || statusProbeFailures >= 2}
              onclick={() => void registerFolder()}>+</button>
          </div>
        </div>
        {#if statusProbeFailures >= 2}
          <div class="state-note" role="status">
            <strong>Refresh required</strong>
            <span>Folder navigation remains available. Refresh before changing project shortcuts.</span>
            <button type="button" disabled={actionBusy || fixture || loading} onclick={() => void refresh()}>Refresh status</button>
          </div>
        {/if}

        {#if navigation && navigation.projects.length > 0}
          <label class="search-label" for="ld-unified-model-search">Find a project or model</label>
          <div class="search-controls">
            <input id="ld-unified-model-search" bind:this={searchInput} type="search"
              placeholder="Search project or model…" bind:value={search} onkeydown={searchKeydown}
              aria-describedby="ld-unified-search-count ld-unified-search-help"/>
            {#if search.trim()}
              <button type="button" aria-label="Clear project search" title="Clear search" onclick={clearSearch}>×</button>
            {/if}
          </div>
          <div id="ld-unified-search-count" class="search-count" role="status" aria-live="polite">
            {search.trim()
              ? `${projects.length} ${projects.length === 1 ? 'project matches' : 'projects match'} your search`
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
                <div class="project-line">
                  <button type="button" class="project-expand"
                    aria-label={(expanded(project) ? 'Hide models for ' : 'Show models for ') + project.name}
                    aria-expanded={expanded(project) || Boolean(search.trim())}
                    onclick={() => toggleProject(project)}>
                    <span aria-hidden="true">{expanded(project) || search.trim() ? '▾' : '▸'}</span>
                    <span class="project-name" title={project.name}>{project.name}</span>
                  </button>
                  <button type="button" class="pin-project" class:pinned={project.pinned}
                    aria-label={(project.pinned ? 'Unpin project ' : 'Pin project ') + project.name}
                    aria-pressed={project.pinned}
                    title={project.pinned ? 'Unpin project' : 'Pin project'}
                    disabled={actionBusy || fixture || statusProbeFailures >= 2}
                    onclick={() => void togglePinnedProject(project)}>{project.pinned ? '★' : '☆'}</button>
                  <button type="button" class="folder-action"
                    aria-label={'Open folder for project ' + project.name}
                    title={'Open ' + project.name + ' folder'}
                    disabled={!project.available || actionBusy || fixture}
                    onclick={() => void openProjectFolder(project.id)}>↗</button>
                </div>
                {#if !project.available}
                  <p class="row-hint">Folder unavailable; shortcut preserved.</p>
                {:else if expanded(project) || search.trim()}
                  {#each visibleProjectModels(project, search) as model (model.id)}
                    <div class:current={model.active} class="model-line">
                      <button type="button" class="model-open" title={model.name}
                        aria-label={(model.active ? 'Focus current model ' : 'Open model ') + model.name}
                        aria-current={model.active ? 'true' : undefined}
                        aria-busy={openingModelId === model.id}
                        disabled={!model.exists || actionBusy || fixture || (model.active && statusProbeFailures >= 2)}
                        onclick={() => void chooseModel(model)}>
                        <span class="model-symbol" aria-hidden="true">◇</span>
                        <span class="model-name">{model.name}</span>
                      </button>
                      {#if openingModelId === model.id}
                        <span class="model-state" role="status">Opening…</span>
                      {:else}
                        {#if model.active}
                          <span class="model-state" title="Current at last observation">Current</span>
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
                          onclick={() => void showModelFile(model.id)}>···</button>
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
                            <span aria-hidden="true">▤</span><span>{folder.label}</span>
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
              <span aria-hidden="true">{recentExpanded ? '▾' : '▸'}</span>
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
      </aside>
      {#if layout.band !== 'compact' && !explorerRail}
        <div class="dock-resizer" role="separator" tabindex="0"
          aria-label="Resize Project Explorer" aria-orientation="vertical"
          aria-valuemin={160} aria-valuemax={260} aria-valuenow={layout.projectsWidth}
          title="Drag or use arrow keys to resize Project Explorer"
          onpointerdown={(event) => startDockResize(event, 'projects')}
          onkeydown={(event) => resizeDockWithKeyboard(event, 'projects')}></div>
      {/if}
    {/if}

    <!-- Empty native window reservation, never a recreated editor or a visual placeholder. -->
    <section class="native-stage" aria-label="Blockbench native editor area">
      <NativeEditorStage bind:this={nativeStage} {fixture} compact={true}
        onPlacementChange={onNativePlacementChange}/>
    </section>

    {#if showTools}
      {#if layout.band !== 'compact'}
        <div class="dock-resizer" role="separator" tabindex="0"
          aria-label="Resize Model Tools" aria-orientation="vertical"
          aria-valuemin={220} aria-valuemax={300} aria-valuenow={layout.toolsWidth}
          title="Drag or use arrow keys to resize Model Tools"
          onpointerdown={(event) => startDockResize(event, 'tools')}
          onkeydown={(event) => resizeDockWithKeyboard(event, 'tools')}></div>
      {/if}
      <aside id="ld-unified-inspector" class="inspector dock-panel" aria-label="Model Tools">
        <div class="pane-heading"><h3>Model Tools</h3><span class="read-only-label">BLOCKBENCH</span></div>
        {#if !fixture && nativePlacementDetail}
          <section class="inspector-section" aria-label="Native Blockbench window status">
            <h4>Blockbench Window</h4>
            <p>{nativePlacementDetail}</p>
          </section>
        {/if}
        <section class="inspector-section" aria-labelledby="ld-inspector-model">
          <h4 id="ld-inspector-model">Model Overview</h4>
          {#if active}
            <div class="model-detail"><strong>{active.model_name}</strong>
              <span>{active.project_name ?? (active.saved ? 'Saved model' : 'Unsaved model')}</span>
              <span>{active.dirty ? 'Modified · save in Blockbench' : active.saved ? 'Saved at last observation' : 'Not saved'}</span>
            </div>
          {:else}
            <p>{continuing ? 'Previously opened: ' + continuing.model.name + '. Reopen it from Project Explorer.' : 'No verified active model.'}</p>
          {/if}
        </section>
        <section class="inspector-section" aria-labelledby="ld-inspector-checks">
          <h4 id="ld-inspector-checks">Checks in Blockbench</h4>
          <div class="tool-row"><strong>Geometry checks</strong><span>Blockbench plugin</span></div>
          <div class="tool-row"><strong>Texturing</strong><span>Blockbench native</span></div>
          <div class="tool-row"><strong>Animation</strong><span>Blockbench native</span></div>
          <div class="tool-row"><strong>Particle Studio</strong><span>Blockbench plugin</span></div>
          <p>Use the existing Blockbench tools. No separate QA result or AI prompt is generated by this panel.</p>
          {#if status?.blockbench.running}
            <button type="button" disabled={actionBusy || fixture || statusProbeFailures >= 2}
              onclick={() => void focusCurrentEditor()}>Focus Blockbench</button>
          {/if}
        </section>
        <section class="inspector-section" aria-labelledby="ld-inspector-connection">
          <h4 id="ld-inspector-connection">AI Connection</h4>
          <div class="connection-status">
            <i class:verified={Boolean(aiStatus?.recentlyVerified)} class:stale={Boolean(aiStatus?.needsRefresh)} aria-hidden="true"></i>
            <strong>{aiStatus?.label ?? 'Status unavailable'}</strong>
          </div>
          <p>{aiStatus?.detail ?? 'Desktop has not verified the AI connection. You can still open and edit models.'}</p>
          <button type="button" disabled={actionBusy || fixture || loading}
            onclick={() => void refresh()}>{aiStatus?.needsRefresh ? 'Refresh status' : 'Check status'}</button>
          <button type="button" class="text-action" onclick={navigateSupport}>Connection details</button>
        </section>
        <div class="inspector-footnote">Window composition is experimental. Blockbench owns all editing, Undo and Save.</div>
      </aside>
    {/if}
  </div>
</main>

<style>
  /* Scoped, Blockbench-compatible dark palette. Never mutate its native theme. */
  .unified-workspace {
    --ed-bg: #1b1f27;
    --ed-header: #252b35;
    --ed-panel: #232833;
    --ed-raised: #2b3240;
    --ed-border: #374250;
    --ed-border-soft: #303a47;
    --ed-text: #e7ebf2;
    --ed-muted: #adb7c5;
    --ed-muted-soft: #8f9dad;
    --ed-select: #344c68;
    --ed-accent: #85a9df;
    display:flex; flex-direction:column; flex:1; min-width:0; min-height:0;
    overflow:hidden; background:var(--ed-bg); color:var(--ed-text);
    font-family:Inter,"Segoe UI",system-ui,sans-serif;
  }
  .editor-header {
    flex:none; display:flex; align-items:center; justify-content:space-between; gap:12px;
    min-height:44px; padding:4px 10px; border-bottom:1px solid var(--ed-border);
    background:var(--ed-header);
  }
  .editor-leading,.editor-controls {display:flex;align-items:center;gap:7px;min-width:0}
  .editor-leading {flex:1 1 auto;overflow:hidden}
  .editor-controls {flex:none;justify-content:flex-end}
  .editor-brand-mark {
    display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:5px;
    background:#3d5572;color:#d9eaff;font-size:17px;font-weight:750;
  }
  .editor-brand {font-size:13px;font-weight:750;letter-spacing:-.025em;white-space:nowrap}
  .header-divider {width:1px;height:21px;background:var(--ed-border);margin:0 4px;flex:none}
  .editor-context {display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:65px;flex:1 1 auto;padding-left:3px}
  .editor-context h1 {
    min-width:0;margin:0;font-size:13px;font-weight:700;line-height:1.3;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;
  }
  .subtitle {font-size:10px;color:var(--ed-muted-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .unsaved {color:#e9bb6d;font-size:10px;margin-left:5px}
  .model-opening {font-size:10px;color:var(--ed-accent);font-weight:600}
  .workspace-return,.editor-controls button {
    display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;
    min-height:32px;padding:5px 9px;border:1px solid transparent;border-radius:5px;
    color:var(--ed-muted);background:transparent;font-size:12px;font-weight:650;
    cursor:pointer;white-space:nowrap;
  }
  .workspace-return:hover,.editor-controls button:hover:not(:disabled){
    color:var(--ed-text);background:var(--ed-raised);
  }
  .workspace-return {margin-right:3px}
  .workspace-return>span:first-child,.dock-toggle>span:first-child{font-size:15px;line-height:1}
  .editor-controls .dock-toggle.chosen{background:var(--ed-raised);color:var(--ed-text);border-color:var(--ed-border)}
  .editor-controls .open-model {
    color:#0e1826;background:var(--ed-accent);border-color:var(--ed-accent);
    font-weight:750;margin-left:3px;
  }
  .editor-controls .open-model:hover:not(:disabled){background:#a2bde8;color:#0e1826}
  .editor-controls .launch-editor {border-color:var(--ed-border);background:#303947;color:var(--ed-text)}
  .editor-controls .native-window-action {
    border-color:var(--ed-border);background:var(--ed-raised);color:var(--ed-text);
  }
  .editor-controls .support-button {width:33px;padding:5px;font-size:17px}
  .ai-indicator {
    display:flex;align-items:center;gap:6px;min-width:0;max-width:165px;
    margin-right:3px;padding:5px 6px;color:var(--ed-muted);font-size:11px;
  }
  .ai-indicator i{height:7px;width:7px;border-radius:100%;background:#8c99aa;flex:none}
  .ai-indicator i.verified{background:#6bc493}
  .ai-indicator i.stale{background:#e1b65f}
  .ai-label {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .editor-header button:focus-visible,.dock-panel button:focus-visible,.dock-panel input:focus-visible {
    outline:2px solid var(--ed-accent);outline-offset:1px;
  }
  .unified-body {
    display:grid;grid-template-columns:minmax(0,1fr);flex:1;min-width:0;min-height:0;overflow:hidden;
  }
  /* Both docks participate in the grid: no host overlay hides native controls. */
  .unified-body.with-projects {grid-template-columns:var(--explorer-width,200px) 6px minmax(0,1fr)}
  .unified-body.with-inspector {grid-template-columns:minmax(0,1fr) 6px var(--tools-width,240px)}
  .unified-body.with-projects.with-inspector {
    grid-template-columns:var(--explorer-width,200px) 6px minmax(0,1fr) 6px var(--tools-width,240px);
  }
  .unified-body.rail.with-projects {grid-template-columns:48px minmax(0,1fr)}
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
  .explorer {border-right:1px solid var(--ed-border);padding:9px 7px 18px}
  .explorer.rail {padding:7px 3px;overflow:hidden}
  .rail-actions{display:grid;gap:7px;justify-items:center}
  .rail-actions button{
    display:grid;place-items:center;width:38px;min-height:36px;border:1px solid transparent;
    border-radius:5px;background:transparent;color:var(--ed-text);font-size:18px;cursor:pointer;
  }
  .rail-actions button:hover:not(:disabled),.rail-actions button:focus-visible{
    background:var(--ed-raised);border-color:var(--ed-border);outline-color:var(--ed-accent);
  }
  .inspector {border-left:1px solid var(--ed-border);padding:9px 11px 18px}
  .pane-heading {display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 3px 9px}
  .pane-actions{display:flex;align-items:center;gap:4px}
  .pane-heading h3 {margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:750;color:var(--ed-text)}
  .pane-heading button {
    display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--ed-border);
    border-radius:5px;background:var(--ed-raised);color:var(--ed-text);font-size:17px;cursor:pointer;
  }
  .search-label{display:block;margin:0 4px 5px;font-size:11px;color:var(--ed-muted)}
  .search-controls{display:flex;align-items:center;gap:4px;min-width:0}
  .explorer input {
    flex:1 1 auto;width:100%;min-width:0;min-height:34px;border:1px solid var(--ed-border);
    border-radius:5px;background:#1c222c;color:var(--ed-text);padding:6px 8px;font-size:12px;
  }
  .search-controls button{
    flex:none;width:27px;min-height:32px;border:0;border-radius:4px;
    background:transparent;color:var(--ed-muted);font-size:17px;cursor:pointer;
  }
  .search-controls button:hover{background:var(--ed-raised);color:var(--ed-text)}
  .search-hint{margin:0 4px 6px;color:var(--ed-muted-soft);font-size:10px;line-height:1.4}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  .explorer input::placeholder{color:var(--ed-muted-soft)}
  .search-count{font-size:10px;color:var(--ed-muted-soft);padding:7px 4px 8px}
  .project-tree {display:grid;gap:2px}
  .project-group {min-width:0}
  .project-line {display:flex;align-items:center;gap:2px;min-height:32px}
  .project-expand {
    display:flex;align-items:center;gap:7px;flex:1;min-width:0;padding:6px 5px;
    border:0;background:transparent;color:var(--ed-text);text-align:left;
    font-size:12px;font-weight:650;border-radius:4px;cursor:pointer;
  }
  .project-expand:hover,.model-open:hover:not(:disabled),.recent-model:hover:not(:disabled){
    background:var(--ed-raised);color:var(--ed-text);
  }
  .project-name,.model-name {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .folder-action,.reveal-model,.pin-project {
    flex:none;width:26px;height:28px;border:0;border-radius:4px;
    background:transparent;color:var(--ed-muted-soft);cursor:pointer;
  }
  .folder-action:hover,.reveal-model:hover,.pin-project:hover{
    background:var(--ed-raised);color:var(--ed-text);
  }
  .pin-project.pinned{color:#dfbc7c}
  .pin-project:focus-visible{outline:2px solid var(--ed-accent);outline-offset:1px}
  .model-line {display:flex;align-items:center;gap:2px;min-width:0;padding-left:13px;min-height:31px}
  .model-line.current {
    background:var(--ed-select);border-left:2px solid var(--ed-accent);
    border-radius:4px;padding-left:11px;
  }
  .model-open {
    display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0;border-radius:4px;
    background:transparent;padding:5px 4px;text-align:left;color:var(--ed-muted);font-size:12px;cursor:pointer;
  }
  .model-line.current .model-open{color:var(--ed-text)}
  .model-symbol{color:var(--ed-muted-soft);font-size:14px;flex:none}
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
  .recent-group{border-top:1px solid var(--ed-border-soft);margin-top:14px;padding-top:12px}
  .recent-heading{
    display:flex;align-items:center;gap:7px;width:100%;min-height:30px;padding:5px;
    border:0;border-radius:4px;background:transparent;color:var(--ed-muted);
    font-size:11px;font-weight:700;text-align:left;cursor:pointer;
  }
  .recent-heading:hover{background:var(--ed-raised);color:var(--ed-text)}
  .recent-count{margin-left:auto;color:var(--ed-muted-soft);font-size:10px}
  .recent-model {
    display:grid;gap:2px;width:100%;min-width:0;border:0;border-radius:4px;
    background:transparent;text-align:left;color:var(--ed-text);padding:6px;font-size:12px;cursor:pointer;
  }
  .recent-model span,.recent-model small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .recent-model small{font-size:10px;color:var(--ed-muted-soft)}
  .native-stage{display:flex;min-width:0;min-height:0;overflow:hidden;background:var(--ed-bg)}
  .native-stage :global(.native-editor-page){min-width:0;width:100%}
  .read-only-label {font-size:10px;color:var(--ed-muted-soft);letter-spacing:.04em}
  .inspector-section{padding:5px 1px 14px;margin-bottom:12px;border-bottom:1px solid var(--ed-border-soft)}
  .inspector-section h4{font-size:12px;font-weight:700;color:var(--ed-text);margin:0 0 9px}
  .inspector-section p {margin:7px 0;font-size:11px;color:var(--ed-muted);line-height:1.5}
  .connection-status{display:flex;align-items:center;gap:7px;color:var(--ed-text);font-size:12px}
  .connection-status i{height:7px;width:7px;border-radius:100%;background:#8f9bad;flex:none}
  .connection-status i.verified{background:#6bc493}
  .connection-status i.stale{background:#e1b65f}
  .inspector-section button,.state-note button {
    min-height:30px;margin-top:7px;padding:5px 9px;border:1px solid var(--ed-border);
    border-radius:5px;background:var(--ed-raised);color:var(--ed-text);font-size:11px;font-weight:650;cursor:pointer;
  }
  .inspector-section button.text-action{background:transparent;border:0;color:var(--ed-accent);padding:5px 4px}
  .model-detail{display:grid;gap:3px}
  .model-detail strong{font-size:12px;font-weight:700;overflow-wrap:anywhere}
  .model-detail span{font-size:11px;color:var(--ed-muted)}
  .tool-row{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:8px 0;border-bottom:1px solid var(--ed-border-soft);font-size:11px}
  .tool-row strong{font-weight:650;color:var(--ed-text)}
  .tool-row span{font-size:10px;color:var(--ed-muted-soft);text-align:right}
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
    .ai-label{max-width:100px}
    .dock-label{display:none}
  }
  @media(max-width:1030px){
    .editor-header{padding:6px 9px;gap:6px}
    .editor-brand{font-size:12px}
    .workspace-label{display:none}
    .editor-context{min-width:48px}
    .ai-indicator{max-width:105px}
  }
  @media(max-width:919px){
    /* Compact shelves occupy normal layout; they never overlay the native
       Window Region or steal its physical rectangle. */
    .unified-body,.unified-body.with-projects,.unified-body.with-inspector,
    .unified-body.with-projects.with-inspector{
      grid-template-columns:minmax(0,1fr);
      grid-template-rows:minmax(220px,1fr);
    }
    .unified-body.with-projects{grid-template-rows:140px minmax(220px,1fr)}
    .unified-body.with-inspector{grid-template-rows:minmax(220px,1fr) 140px}
    .unified-body.with-projects.with-inspector{grid-template-rows:140px minmax(220px,1fr) 140px}
    .dock-resizer{display:none}
    .explorer{grid-column:1;grid-row:1;overflow:auto;border-right:0;border-bottom:1px solid var(--ed-border)}
    .native-stage{grid-column:1;grid-row:1}
    .with-projects .native-stage{grid-row:2}
    .inspector{grid-column:1;grid-row:2;overflow:auto;border-left:0;border-top:1px solid var(--ed-border)}
    .with-projects.with-inspector .inspector{grid-row:3}
    .ai-label {display:none}
    .ai-indicator{margin:0;padding:5px}
  }
  @media(max-width:600px){
    .editor-header{min-height:55px;flex-wrap:wrap;padding:6px 9px;gap:3px}
    .editor-leading{width:100%;flex:1 1 100%}
    .editor-controls{width:100%;justify-content:flex-end;flex-wrap:wrap;gap:3px}
    .header-divider{margin:0 1px}
    .editor-brand{display:none}
    .editor-context{min-width:0}
    .editor-context h1{font-size:12px}
    .editor-context .subtitle{display:none}
    .editor-controls button{min-height:29px;padding:4px 7px}
    .editor-controls .launch-editor{font-size:11px}
    .workspace-return{min-height:30px;padding:4px 6px}
    .editor-controls .open-model{font-size:11px}
  }
</style>
