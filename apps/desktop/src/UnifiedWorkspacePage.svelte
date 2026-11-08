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
  export let navigateWorkspace: () => void;

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
    if (projectsVisible && window.innerWidth < 1320) inspectorVisible = false;
  }
  function toggleInspectorPanel() {
    inspectorVisible = !inspectorVisible;
    if (inspectorVisible && window.innerWidth < 1320) projectsVisible = false;
  }
  onMount(() => {
    // Density bands change defaults only when crossing a breakpoint; manual
    // toggles remain owned by this view, with no persisted editor setting.
    let band = -1;
    const fitNativeViewport = () => {
      const next = window.innerWidth < 920 ? 0 : window.innerWidth < 1320 ? 1 : 2;
      if (next === band) return;
      band = next;
      projectsVisible = next >= 1;
      inspectorVisible = next === 2;
    };
    fitNativeViewport();
    window.addEventListener('resize', fitNativeViewport);
    return () => window.removeEventListener('resize', fitNativeViewport);
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
      <button type="button" class="dock-toggle" class:chosen={projectsVisible}
        aria-label="Toggle Project Explorer" title="Project Explorer"
        aria-expanded={projectsVisible}
        aria-controls={projectsVisible ? 'ld-unified-explorer' : undefined}
        onclick={toggleProjectsPanel}><span aria-hidden="true">▤</span><span class="dock-label">Projects</span></button>
      <button type="button" class="dock-toggle" class:chosen={inspectorVisible}
        aria-label="Toggle AI and QA" title="AI and QA"
        aria-expanded={inspectorVisible}
        aria-controls={inspectorVisible ? 'ld-unified-inspector' : undefined}
        onclick={toggleInspectorPanel}><span aria-hidden="true">✧</span><span class="dock-label">AI &amp; QA</span></button>
      {#if !status?.blockbench.running}
        <button type="button" class="launch-editor" disabled={actionBusy || fixture || statusProbeFailures >= 2}
          onclick={() => void launchBlockbench()}>Open Blockbench</button>
      {/if}
      <button type="button" class="open-model" disabled={actionBusy || fixture}
        onclick={() => void openModelSafely()}>Open Model…</button>
      <button type="button" class="support-button" title="Support and settings"
        aria-label="Open Support" onclick={navigateSupport}><span aria-hidden="true">⚙</span></button>
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
    min-height:52px; padding:6px 12px; border-bottom:1px solid var(--ed-border);
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
  .unified-body.with-projects {grid-template-columns:216px minmax(0,1fr)}
  .unified-body.with-inspector {grid-template-columns:minmax(0,1fr) 264px}
  .unified-body.with-projects.with-inspector {grid-template-columns:216px minmax(0,1fr) 264px}
  .dock-panel {min-width:0;min-height:0;overflow:auto;scrollbar-width:thin;background:var(--ed-panel)}
  .explorer {border-right:1px solid var(--ed-border);padding:11px 8px 20px}
  .inspector {border-left:1px solid var(--ed-border);padding:11px 12px 20px}
  .pane-heading {display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 3px 10px}
  .pane-heading h3 {margin:0;font-size:12px;font-weight:750;color:var(--ed-text)}
  .pane-heading button {
    display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--ed-border);
    border-radius:5px;background:var(--ed-raised);color:var(--ed-text);font-size:17px;cursor:pointer;
  }
  .search-label{display:block;margin:0 4px 5px;font-size:11px;color:var(--ed-muted)}
  .explorer input {
    width:100%;min-width:0;min-height:33px;border:1px solid var(--ed-border);
    border-radius:5px;background:#1c222c;color:var(--ed-text);padding:6px 9px;font-size:12px;
  }
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
  .folder-action,.reveal-model {
    flex:none;width:27px;height:28px;border:0;border-radius:4px;
    background:transparent;color:var(--ed-muted-soft);cursor:pointer;
  }
  .folder-action:hover,.reveal-model:hover{background:var(--ed-raised);color:var(--ed-text)}
  .model-line {display:flex;align-items:center;gap:2px;min-width:0;padding-left:13px;min-height:31px}
  .model-line.current {background:var(--ed-select);border-radius:4px}
  .model-open {
    display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0;border-radius:4px;
    background:transparent;padding:5px 4px;text-align:left;color:var(--ed-muted);font-size:12px;cursor:pointer;
  }
  .model-line.current .model-open{color:var(--ed-text)}
  .model-symbol{color:var(--ed-muted-soft);font-size:14px;flex:none}
  .model-state{color:var(--ed-muted-soft);font-size:10px;white-space:nowrap}
  .model-state.warning{color:#e1b65f}
  .row-hint,.empty-state{color:var(--ed-muted);font-size:12px;line-height:1.5;margin:7px 5px}
  .more-projects {
    width:100%;border:0;border-top:1px solid var(--ed-border-soft);background:transparent;
    color:var(--ed-muted);font-size:12px;text-align:left;padding:9px 5px;cursor:pointer;
  }
  .recent-group{border-top:1px solid var(--ed-border-soft);margin-top:14px;padding-top:12px}
  .recent-group h4{
    margin:0 5px 7px;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--ed-muted-soft);
  }
  .recent-model {
    display:grid;gap:2px;width:100%;min-width:0;border:0;border-radius:4px;
    background:transparent;text-align:left;color:var(--ed-text);padding:6px;font-size:12px;cursor:pointer;
  }
  .recent-model span,.recent-model small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .recent-model small{font-size:10px;color:var(--ed-muted-soft)}
  .native-stage{display:flex;min-width:0;min-height:0;overflow:hidden;background:#171b24}
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
  @media(max-width:1320px) {
    .ai-label {max-width:100px}
    .dock-label{display:none}
    .unified-body.with-projects.with-inspector{grid-template-columns:206px minmax(0,1fr) 246px}
    .unified-body.with-projects{grid-template-columns:206px minmax(0,1fr)}
    .unified-body.with-inspector{grid-template-columns:minmax(0,1fr) 246px}
  }
  @media(max-width:1030px){
    .editor-header{padding:6px 9px;gap:6px}
    .editor-brand{font-size:12px}
    .workspace-label{display:none}
    .editor-context{min-width:48px}
    .ai-indicator{max-width:105px}
  }
  @media(max-width:920px){
    /* Compact shelves occupy normal layout; they never overlay the native
       Window Region or steal its physical rectangle. */
    .unified-body,.unified-body.with-projects,.unified-body.with-inspector,
    .unified-body.with-projects.with-inspector{
      grid-template-columns:minmax(0,1fr);
      grid-template-rows:minmax(220px,1fr);
    }
    .unified-body.with-projects{grid-template-rows:126px minmax(220px,1fr)}
    .unified-body.with-inspector{grid-template-rows:minmax(220px,1fr) 126px}
    .unified-body.with-projects.with-inspector{grid-template-rows:126px minmax(220px,1fr) 126px}
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
    .editor-controls{width:100%;justify-content:flex-end}
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
