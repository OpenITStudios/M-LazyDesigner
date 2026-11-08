<script lang="ts">
  import NativeEditorStage from './NativeEditorStage.svelte';
  import { onMount } from 'svelte';
  import {
    aiStatusPresentation, continueTarget, recentModelTargets,
    uniqueModelSearchTarget, visibleProjectModels, visibleProjects,
  } from './desktopPresentation';
  import type { SystemStatus, DesktopBusyAction } from './desktopTypes';
  import type { ProjectAction, ProjectNavigationProject } from './projectNavigationTypes';

  // One presentation view, not a second model, Runtime or project owner.
  export let status: SystemStatus | null;
  export let loading: boolean;
  export let busyAction: DesktopBusyAction | null;
  export let openingModelId: string | null;
  export let statusProbeFailures: number;
  export let statusPresentationNowMs: number;
  export let fixture = false;
  export let openModel: (id?: string) => Promise<void>;
  export let addProjectFolder: () => Promise<void>;
  export let runProjectAction: (action: ProjectAction, id: string) => Promise<void>;
  export let focusCurrentEditor: () => Promise<void>;
  export let openBlockbenchEditor: () => Promise<void>;
  export let refresh: () => Promise<void>;
  export let navigateSupport: () => void;

  let nativeStage: { detach: () => Promise<boolean> } | undefined;
  let projectsVisible = true;
  let inspectorVisible = true;
  let search = '';
  let showAll = false;
  let expandedProjectId: string | null = null;
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

  function expanded(project: ProjectNavigationProject): boolean {
    return expandedProjectId === project.id
      || (expandedProjectId === null && navigation?.active?.project_id === project.id);
  }
  function toggleProject(project: ProjectNavigationProject) {
    expandedProjectId = expanded(project) ? '' : project.id;
  }
  function toggleProjectsPanel() {
    projectsVisible = !projectsVisible;
    if (projectsVisible && window.innerWidth <= 650) inspectorVisible = false;
  }
  function toggleInspectorPanel() {
    inspectorVisible = !inspectorVisible;
    if (inspectorVisible && window.innerWidth <= 650) projectsVisible = false;
  }
  onMount(() => {
    // A narrow workspace never positions two docks around a shrinking editor.
    const keepOneNarrowDock = () => {
      if (window.innerWidth <= 650 && projectsVisible && inspectorVisible) inspectorVisible = false;
    };
    keepOneNarrowDock();
    window.addEventListener('resize', keepOneNarrowDock);
    return () => window.removeEventListener('resize', keepOneNarrowDock);
  });

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
  function registerFolder() {
    if (statusProbeFailures >= 2 || !status) return Promise.resolve();
    return afterDetach(addProjectFolder);
  }
  function searchKeydown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape' && search) {
      event.preventDefault();
      search = '';
      searchInput?.focus();
    } else if (event.key === 'Enter' && uniqueTarget && !actionBusy && !fixture) {
      event.preventDefault();
      void openModelSafely(uniqueTarget.model.id);
    }
  }
</script>

<main class="unified-workspace" aria-label="LazyDesigner unified editor workspace">
  <header class="editor-header">
    <div class="editor-context">
      <span class="eyebrow">LAZYDESIGNER / NATIVE EDITOR</span>
      <h2>{active?.model_name ?? continuing?.model.name ?? 'Blockbench workspace'}{#if active?.dirty}<span class="unsaved" title="Model has unsaved changes">●</span>{/if}</h2>
      <span class="subtitle">{active?.project_name ?? continuing?.project.name ?? 'Choose a model to begin'} · Development preview</span>
      {#if openingModelId}<span class="model-opening" role="status">Opening requested model…</span>{/if}
    </div>
    <div class="editor-controls" role="group" aria-label="Workspace panels and model actions">
      <button type="button" class:chosen={projectsVisible} aria-expanded={projectsVisible} aria-controls={projectsVisible ? 'ld-unified-explorer' : undefined} onclick={toggleProjectsPanel}>Projects</button>
      <button type="button" class:chosen={inspectorVisible} aria-expanded={inspectorVisible} aria-controls={inspectorVisible ? 'ld-unified-inspector' : undefined} onclick={toggleInspectorPanel}>AI &amp; QA</button>
      {#if !status?.blockbench.running}
        <button type="button" disabled={actionBusy || fixture || statusProbeFailures >= 2}
          onclick={() => void launchBlockbench()}>Open Blockbench</button>
      {/if}
      <button type="button" class="open-model" disabled={actionBusy || fixture} onclick={() => void openModelSafely()}>Open Model…</button>
    </div>
  </header>

  {#if localNotice}
    <div class="inline-error" role="alert"><span>{localNotice}</span><button type="button" onclick={() => localNotice = ''} aria-label="Dismiss workspace notice">×</button></div>
  {/if}

  <div class="unified-body" class:with-projects={projectsVisible} class:with-inspector={inspectorVisible}>
    {#if projectsVisible}
      <aside id="ld-unified-explorer" class="explorer dock-panel" aria-label="Project Explorer">
        <div class="pane-heading">
          <h3>Projects</h3>
          <button type="button" title="Add existing project folder" aria-label="Add Project Folder"
            disabled={actionBusy || fixture || !status || statusProbeFailures >= 2}
            onclick={() => void registerFolder()}>+</button>
        </div>
        {#if statusProbeFailures >= 2}
          <div class="state-note" role="status">
            <strong>Refresh required</strong>
            <span>Folder navigation remains available. Refresh before changing project shortcuts.</span>
            <button type="button" disabled={actionBusy || fixture || loading} onclick={() => void refresh()}>Refresh status</button>
          </div>
        {/if}

        {#if navigation && navigation.projects.length > 0}
          <label class="search-label" for="ld-unified-model-search">Search projects and models</label>
          <input id="ld-unified-model-search" bind:this={searchInput} type="search"
            placeholder="Find a model…" bind:value={search} onkeydown={searchKeydown}
            aria-describedby="ld-unified-search-count"/>
          <div id="ld-unified-search-count" class="search-count" role="status" aria-live="polite">
            {#if search.trim()}{projects.length} matching {projects.length === 1 ? 'project' : 'projects'}{:else}{navigation.projects.length} {navigation.projects.length === 1 ? 'project' : 'projects'}{/if}
          </div>
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
                        aria-label={(model.active ? 'Current model ' : 'Open model ') + model.name}
                        disabled={model.active || !model.exists || actionBusy || fixture}
                        onclick={() => void openModelSafely(model.id)}>
                        <span class="model-symbol" aria-hidden="true">◇</span>
                        <span class="model-name">{model.name}</span>
                      </button>
                      {#if model.active}<span class="model-state" title="Current native model">Active</span>
                      {:else if model.dirty}<span class="model-state warning">Modified</span>
                      {:else if !model.exists}<span class="model-state warning">Missing</span>{/if}
                      {#if model.exists}
                        <button type="button" class="reveal-model" disabled={actionBusy || fixture}
                          title={'Show ' + model.name + ' in Explorer'}
                          aria-label={'Show model ' + model.name + ' in Explorer'}
                          onclick={() => void showModelFile(model.id)}>···</button>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            {/each}
            {#if projects.length === 0}<p class="empty-state">No matching projects or models.</p>{/if}
          </div>
          {#if navigation.projects.length > 6 && !search.trim()}
            <button class="more-projects" type="button" onclick={() => showAll = !showAll}>{showAll ? 'Show fewer projects' : 'Show all projects'}</button>
          {/if}
        {:else}
          <p class="empty-state">{loading ? 'Checking projects…' : status ? 'No registered projects. Add a project folder or open a .bbmodel directly.' : 'Project list unavailable. Open a model directly or refresh status.'}</p>
        {/if}

        {#if !search.trim() && recentTargets.length > 0}
          <div class="recent-group">
            <h4>Recent models</h4>
            {#each recentTargets as target (target.model.id)}
              <button class="recent-model" type="button" disabled={actionBusy || fixture}
                aria-label={'Open recent model ' + target.model.name + ' from ' + target.project.name}
                onclick={() => void openModelSafely(target.model.id)}>
                <span>{target.model.name}</span><small>{target.project.name}</small>
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    {/if}

    <section class="native-stage" aria-label="Blockbench native editor area">
      <NativeEditorStage bind:this={nativeStage} {fixture} compact={true}/>
    </section>

    {#if inspectorVisible}
      <aside id="ld-unified-inspector" class="inspector dock-panel" aria-label="AI and QA">
        <div class="pane-heading"><h3>AI &amp; QA</h3><span class="read-only-label">STATUS</span></div>
        <section class="inspector-section" aria-labelledby="ld-inspector-connection">
          <h4 id="ld-inspector-connection">AI connection</h4>
          <div class="connection-status">
            <i class:verified={Boolean(aiStatus?.recentlyVerified)} class:stale={Boolean(aiStatus?.needsRefresh)} aria-hidden="true"></i>
            <strong>{aiStatus?.label ?? 'Status unavailable'}</strong>
          </div>
          <p>{aiStatus?.detail ?? 'Desktop has not verified the AI connection. You can still open and edit models.'}</p>
          <button type="button" disabled={actionBusy || fixture || loading}
            onclick={() => void refresh()}>{aiStatus?.needsRefresh ? 'Refresh status' : 'Check status'}</button>
          <button type="button" class="text-action" onclick={navigateSupport}>Connection details</button>
        </section>
        <section class="inspector-section" aria-labelledby="ld-inspector-model">
          <h4 id="ld-inspector-model">Current model</h4>
          {#if active}
            <div class="model-detail"><strong>{active.model_name}</strong>
              <span>{active.project_name ?? (active.saved ? 'Saved model' : 'Unsaved model')}</span>
              <span>{active.dirty ? 'Modified · save in Blockbench' : active.saved ? 'Saved at last observation' : 'Not saved'}</span>
            </div>
          {:else}
            <p>{continuing ? 'Previously opened: ' + continuing.model.name + '. Reopen it from Projects.' : 'No verified active model.'}</p>
          {/if}
        </section>
        <section class="inspector-section" aria-labelledby="ld-inspector-qa">
          <h4 id="ld-inspector-qa">Authoring &amp; QA</h4>
          <div class="tool-row"><strong>Geometry checks</strong><span>Blockbench plugin</span></div>
          <div class="tool-row"><strong>Texturing</strong><span>Blockbench native</span></div>
          <div class="tool-row"><strong>Animation</strong><span>Blockbench native</span></div>
          <div class="tool-row"><strong>Particle Studio</strong><span>Blockbench plugin</span></div>
          <p>Use the editor's existing tools. No separate QA result or AI prompt is generated by this panel.</p>
          {#if status?.blockbench.running}
            <button type="button" disabled={actionBusy || fixture || statusProbeFailures >= 2} onclick={() => void focusCurrentEditor()}>Focus Blockbench</button>
          {/if}
        </section>
        <div class="inspector-footnote">Window composition is experimental. Blockbench owns all editing, Undo and Save.</div>
      </aside>
    {/if}
  </div>
</main>

<style>
  .unified-workspace{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;background:var(--bg)}
  .editor-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;min-height:70px;padding:11px 16px;border-bottom:1px solid var(--border-soft);background:var(--bg-elevated)}
  .editor-context{display:grid;gap:2px;min-width:0}.eyebrow{color:var(--muted-2);font-size:10px;font-weight:800;letter-spacing:.08em}
  .editor-context h2{font-size:16px;line-height:1.3;font-weight:720;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .subtitle{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .unsaved{color:var(--warning);font-size:10px;margin-left:7px}
  .model-opening{font-size:11px;color:var(--info);font-weight:650}
  .editor-controls{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px}
  .editor-controls button,.inspector-section button,.state-note button{min-height:32px;padding:5px 9px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-soft);font-size:var(--font-sm);font-weight:650;cursor:pointer}
  .editor-controls button.chosen{border-color:var(--border-strong);background:var(--surface-3);color:var(--text)}
  .editor-controls .open-model{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
  .unified-body{display:grid;grid-template-columns:minmax(320px,1fr);flex:1;min-width:0;min-height:0;overflow:hidden}
  .unified-body.with-projects{grid-template-columns:210px minmax(320px,1fr)}
  .unified-body.with-inspector{grid-template-columns:minmax(320px,1fr) 238px}
  .unified-body.with-projects.with-inspector{grid-template-columns:210px minmax(320px,1fr) 238px}
  .dock-panel{min-width:0;min-height:0;overflow:auto;scrollbar-width:thin;background:var(--bg-elevated)}
  .explorer{border-right:1px solid var(--border-soft);padding:12px 10px 18px}
  .inspector{border-left:1px solid var(--border-soft);padding:12px 13px 22px}
  .pane-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
  .pane-heading h3{margin:0;font-size:13px;font-weight:750}
  .pane-heading button{width:29px;height:29px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);font-size:18px;cursor:pointer}
  .search-label{display:block;font-size:11px;color:var(--muted-2);margin-bottom:5px}
  .explorer input{width:100%;min-width:0;min-height:33px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text);padding:6px 8px;font-size:12px}
  .explorer input::placeholder{color:var(--muted-2)}
  .search-count{font-size:11px;color:var(--muted-2);padding:7px 2px 9px}
  .project-tree{display:grid;gap:3px}.project-group{min-width:0}
  .project-line{display:flex;align-items:center;gap:2px;min-height:33px}
  .project-expand{display:flex;align-items:center;gap:7px;min-width:0;flex:1;padding:6px 5px;border:0;background:transparent;color:var(--text-soft);text-align:left;font-size:12px;font-weight:700;border-radius:5px;cursor:pointer}
  .project-expand:hover,.model-open:hover:not(:disabled),.recent-model:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
  .project-name,.model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .folder-action,.reveal-model{flex:none;width:27px;height:28px;border:0;border-radius:5px;background:transparent;color:var(--muted);cursor:pointer}
  .folder-action:hover,.reveal-model:hover{background:var(--surface-2);color:var(--text)}
  .model-line{display:flex;align-items:center;gap:2px;min-width:0;padding-left:12px;min-height:31px}
  .model-line.current .model-open{color:var(--accent)}
  .model-open{display:flex;align-items:center;gap:6px;flex:1;min-width:0;background:transparent;border:0;padding:5px 4px;text-align:left;color:var(--text-soft);border-radius:5px;font-size:12px;cursor:pointer}
  .model-symbol{color:var(--muted);flex:none;font-size:15px}
  .model-state{color:var(--muted-2);font-size:10px;white-space:nowrap}.model-state.warning{color:var(--warning)}
  .row-hint,.empty-state{color:var(--muted);font-size:12px;line-height:1.5;margin:7px 4px}
  .more-projects{width:100%;border:0;border-top:1px solid var(--border-soft);background:transparent;color:var(--muted);font-size:12px;text-align:left;padding:9px 5px;cursor:pointer}
  .recent-group{border-top:1px solid var(--border-soft);margin-top:16px;padding-top:13px}
  .recent-group h4{margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-2)}
  .recent-model{display:grid;gap:2px;width:100%;min-width:0;border:0;border-radius:5px;background:transparent;text-align:left;color:var(--text-soft);padding:6px;font-size:12px;cursor:pointer}
  .recent-model span,.recent-model small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .recent-model small{color:var(--muted-2);font-size:11px}
  .native-stage{min-width:0;min-height:0;display:flex;overflow:hidden;background:var(--bg)}
  .native-stage :global(.native-editor-page){width:100%;min-width:0}
  .read-only-label{color:var(--muted-2);font-size:10px;letter-spacing:.08em;font-weight:750}
  .inspector-section{padding:4px 0 17px;margin-bottom:14px;border-bottom:1px solid var(--border-soft)}
  .inspector-section h4{font-size:12px;font-weight:750;margin:0 0 10px}
  .inspector-section p{font-size:12px;color:var(--muted);line-height:1.5;margin:8px 0}
  .connection-status{display:flex;align-items:center;gap:8px;font-size:12px}
  .connection-status i{width:8px;height:8px;border-radius:100%;background:var(--info);flex:none}
  .connection-status i.verified{background:var(--accent)}.connection-status i.stale{background:var(--warning)}
  .inspector-section button{margin-top:7px;font-size:12px}
  .inspector-section button.text-action{background:transparent;border:0;padding:5px 3px;color:var(--text-soft)}
  .model-detail{display:grid;gap:3px}.model-detail strong{font-size:12px;font-weight:700;overflow-wrap:anywhere}
  .model-detail span{font-size:11px;color:var(--muted)}
  .tool-row{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:8px 0;border-bottom:1px solid var(--border-soft);font-size:11px}
  .tool-row strong{font-weight:650}.tool-row span{color:var(--muted-2);font-size:10px;text-align:right}
  .inspector-footnote{color:var(--muted-2);font-size:11px;line-height:1.5}
  .state-note{display:grid;gap:6px;border-left:2px solid var(--warning);padding:9px;margin:0 0 11px;background:var(--warning-bg);font-size:11px}
  .state-note span{color:var(--muted)}.state-note button{justify-self:start}
  .inline-error{flex:none;display:flex;align-items:start;justify-content:space-between;gap:8px;padding:9px 14px;color:var(--warning);background:var(--warning-bg);border-bottom:1px solid var(--border-strong);font-size:12px}
  .inline-error button{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  @media(max-width:840px){
    .unified-body.with-projects.with-inspector{grid-template-columns:178px minmax(320px,1fr) 220px}
    .unified-body.with-projects{grid-template-columns:178px minmax(320px,1fr)}
    .unified-body.with-inspector{grid-template-columns:minmax(320px,1fr) 220px}
    .editor-header{padding:9px 12px}
  }
  @media(max-width:650px){
    .editor-header{align-items:flex-start;flex-wrap:wrap}
    .editor-controls{justify-content:flex-start}
    .unified-body,.unified-body.with-projects,.unified-body.with-inspector,.unified-body.with-projects.with-inspector{
      grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(220px,1fr);overflow:hidden;
    }
    .unified-body.with-projects{grid-template-rows:88px minmax(220px,1fr)}
    .unified-body.with-inspector{grid-template-rows:minmax(220px,1fr) 88px}
    .unified-body.with-projects.with-inspector{grid-template-rows:88px minmax(220px,1fr) 88px}
    .explorer{grid-column:1;grid-row:1;overflow:auto;border-right:0;border-bottom:1px solid var(--border-soft)}
    .native-stage{grid-column:1;grid-row:1;min-height:220px}
    .with-projects .native-stage{grid-row:2}
    .inspector{grid-column:1;grid-row:2;overflow:auto;border-left:0;border-top:1px solid var(--border-soft)}
    .with-projects.with-inspector .inspector{grid-row:3}
  }
</style>
