<script lang="ts">
  import type { ProjectAction, ProjectNavigation } from './projectNavigationTypes';
  import { visibleProjects, visibleProjectModels, recentModelTargets, continueTarget } from './desktopPresentation';

  export let navigation: ProjectNavigation;
  export let busy = false;
  export let canOpenModel = true;
  export let canFocusCurrentEditor = true;
  // Native .bbmodel browsing remains available when AI status is unverified.
  export let canBrowseModel = true;
  export let canEditProjectPrefs = true;
  export let statusUnverified = false;
  export let onOpenModel: (id?: string) => void | Promise<void>;
  export let onAddProjectFolder: () => void | Promise<void>;
  export let onDeleteProject: (id: string) => void | Promise<void>;
  export let onFocusEditor: () => void | Promise<void>;
  export let onProjectAction: (action: ProjectAction, id: string) => void | Promise<void>;
  export let onCopyPath: (id: string) => void | Promise<void>;

  // Ephemeral presentation only, retained across Support navigation.
  export let expandedProjectId: string | null = null;
  export let showAllProjects = false;
  export let projectSearch = '';

  $: matchingProjects = visibleProjects(navigation, projectSearch, showAllProjects);
  $: recentTargets = recentModelTargets(navigation);
  $: targetToContinue = continueTarget(navigation);

  // Null defaults to the active project; an empty ID records a user collapse
  // and persists across Workspace/Support navigation via the parent binding.
  function isProjectExpanded(id: string): boolean {
    return expandedProjectId === id || (expandedProjectId === null && navigation.active?.project_id === id);
  }

  function toggleProject(id: string) {
    expandedProjectId = isProjectExpanded(id) ? '' : id;
  }

  let searchInput: HTMLInputElement | undefined;
  function clearProjectSearch() {
    projectSearch = '';
    searchInput?.focus();
  }
</script>

{#if statusUnverified}
  <p id="ld-project-action-note" class="project-state-note" role="status"><strong>Refresh required for project changes.</strong> You can still open models and folders. Choose Refresh from Workspace's More actions before changing shortcuts, deleting projects or returning to the current editor.</p>
{/if}

{#if navigation.preferences_issue}
  <section class="preferences-recovery" role="alert">
    <div>
      <strong>Project shortcuts need attention</strong>
      <span>Saved shortcuts could not be read. Your model files are unchanged.</span>
    </div>
    {#if navigation.preferences_issue === 'RECOVERABLE'}
      <button class="secondary-button small-button" onclick={() => onProjectAction('restore-project-preferences', '')} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={busy || !canEditProjectPrefs}>Restore shortcuts</button>
    {:else}
      <span>Open Support to review the existing preferences. Nothing was overwritten.</span>
    {/if}
  </section>
{/if}

{#if navigation.active}
  {@const active = navigation.active}
  <section class="content-section">
    <div class="section-heading">
      <div><h2>Current Model</h2></div>
      <button class="secondary-button small-button" onclick={() => onOpenModel()} disabled={!canBrowseModel}>Open Model…</button>
    </div>
    <div class="project-list">
      <div class="project-row active-project-row">
        <div class="project-main">
          <div class="project-title">{active.model_name}</div>
          <div class="project-meta">{active.project_name || (active.saved ? 'Saved model' : 'Not saved yet')}{active.dirty ? ' · Modified' : ''}</div>
        </div>
        <div class="project-actions">
          <button class="primary-button small-button" aria-label={`Go to Blockbench for ${active.model_name}`} onclick={onFocusEditor} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={busy || !canFocusCurrentEditor}>Go to Blockbench</button>
        </div>
      </div>
    </div>
  </section>
{:else if targetToContinue}
  {@const target = targetToContinue}
  {#if target}
    <section class="content-section">
      <div class="section-heading"><div><h2>Continue working</h2></div></div>
      <div class="project-list">
        <div class="project-row">
          <div class="project-main">
            <div class="project-title">{target.model.name}</div>
            <div class="project-meta">{target.project.name}</div>
          </div>
          <div class="project-actions">
            <button class="primary-button small-button" aria-label={`Continue model ${target.model.name}`} onclick={() => onOpenModel(target.model.id)} disabled={busy || !canOpenModel}>Continue</button>
          </div>
        </div>
      </div>
    </section>
  {/if}
{/if}

<section class="content-section" aria-label="Projects and models">
  <div class="section-heading">
    <div><h2>Projects &amp; Models</h2></div>
    <button class="secondary-button small-button" onclick={onAddProjectFolder} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={busy || !canEditProjectPrefs}>Add Project Folder</button>
  </div>
  {#if navigation.projects.length > 0 || projectSearch.trim().length > 0}
  <div class="project-search-bar">
    <label for="ld-project-search">Find a project or model</label>
    <div class="project-search-controls">
      <input id="ld-project-search" bind:this={searchInput} class="compact-search project-search" type="search" placeholder="Search projects or models…" aria-describedby="ld-project-search-results" bind:value={projectSearch} />
      {#if projectSearch.trim()}
        <button type="button" class="quiet-button clear-search" onclick={clearProjectSearch}>Clear search</button>
      {/if}
    </div>
    <span id="ld-project-search-results" class="project-search-feedback" role="status" aria-live="polite">{projectSearch.trim() ? `${matchingProjects.length} ${matchingProjects.length === 1 ? 'project matches' : 'projects match'} your search.` : ''}</span>
  </div>
  {/if}
  <div class="project-list">
    {#each matchingProjects as project (project.id)}
      <div class="project-row">
        <div class="project-main">
          <div class="project-title" title={project.name}>{project.name}</div>
          <div class="project-meta">
            {project.pinned ? 'Pinned · ' : ''}{!project.available ? 'Folder unavailable' : project.model_count === 0 ? 'No models found' : project.registered ? `${project.model_count} models shown` : `${project.model_count} known models`}
          </div>
        </div>
        <div class="project-actions">
          <button class="secondary-button small-button" aria-label={`Open folder for project ${project.name}`} onclick={() => onProjectAction('open-project-folder', project.id)} disabled={!project.available || busy}>Open Folder</button>
          {#if !projectSearch.trim()}
            <button class="quiet-button" aria-label={`${isProjectExpanded(project.id) ? 'Hide' : 'Show'} models for project ${project.name}`} aria-expanded={isProjectExpanded(project.id)} onclick={() => toggleProject(project.id)}>{isProjectExpanded(project.id) ? 'Hide models' : 'Show models'}</button>
          {/if}
          <details class="more-menu">
            <summary aria-label={`Actions for project ${project.name}`}>•••</summary>
            <div class="menu-popover">
              <button onclick={() => onProjectAction(project.pinned ? 'unpin-project' : 'pin-project', project.id)} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={busy || !canEditProjectPrefs}>{project.pinned ? 'Unpin project' : 'Pin project'}</button>
              {#if project.registered}
                <button onclick={() => onProjectAction('remove-project-folder', project.id)} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={busy || !canEditProjectPrefs}>Remove from Workspace</button>
                <button class="menu-danger" onclick={() => onDeleteProject(project.id)} aria-describedby={statusUnverified ? 'ld-project-action-note' : undefined} disabled={!project.available || busy || !canEditProjectPrefs}>Delete Project…</button>
              {/if}
            </div>
          </details>
        </div>
      </div>
      {#if isProjectExpanded(project.id) || projectSearch.trim()}
        <div class="project-details">
          {#if !project.available}
            <div class="project-empty">The folder has moved or is unavailable. The shortcut was preserved.</div>
          {:else}
            {@const matchingModels = visibleProjectModels(project, projectSearch)}
            {#each matchingModels as model (model.id)}
              <div class="model-row">
                <div class="model-main">
                  <strong>{model.name}</strong>
                  {#if model.active}<span>Active</span>{:else if model.dirty}<span>Modified</span>{:else if !model.exists}<span>File unavailable</span>{/if}
                </div>
                <div class="model-actions">
                  {#if model.active}
                    <span class="current-model-tag">Current model</span>
                  {:else}
                    <button class="secondary-button small-button" aria-label={`Open model ${model.name}`} onclick={() => onOpenModel(model.id)} disabled={!model.exists || busy || !canOpenModel}>Open</button>
                  {/if}
                  <details class="more-menu">
                    <summary aria-label={`Actions for model ${model.name}`}>•••</summary>
                    <div class="menu-popover">
                      <button aria-label={`Show model ${model.name} in Explorer`} onclick={() => onProjectAction('reveal-model', model.id)} disabled={!model.exists || busy}>Show in Explorer</button>
                      <button aria-label={`Copy path for model ${model.name}`} onclick={() => onCopyPath(model.id)} disabled={busy}>Copy path</button>
                    </div>
                  </details>
                </div>
              </div>
            {/each}
            {#if matchingModels.length === 0}
              <div class="project-empty">{projectSearch.trim() ? 'No matching models in this folder.' : 'No .bbmodel files in the visible folder locations.'}</div>
            {/if}
            {#if project.folders.length > 0}
              <div class="project-details-heading folder-heading"><span>Project folders</span></div>
              <div class="folder-shortcuts">
                {#each project.folders as folder (folder.id)}
                  <button class="folder-shortcut" aria-label={`Open ${folder.label} folder for project ${project.name}`} onclick={() => onProjectAction('open-folder', folder.id)} disabled={busy}>{folder.label}</button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
    {#if matchingProjects.length === 0}
      <div class="project-empty project-empty-list">
        {#if projectSearch.trim()}No matching projects or models.{:else}Add an existing project folder to see its models here. Your files stay where they are.{/if}
      </div>
    {/if}
  </div>
  {#if navigation.projects.length > 6 && !projectSearch.trim()}
    <button class="show-more-button" onclick={() => { showAllProjects = !showAllProjects; if (!showAllProjects) expandedProjectId = null; }}>{showAllProjects ? 'Show fewer projects' : 'Show all projects'}</button>
  {/if}
</section>

{#if !projectSearch.trim() && recentTargets.length > 0}
  <section class="content-section">
    <div class="section-heading"><div><h2>Recent Models</h2></div></div>
    <div class="project-list">
      {#each recentTargets as target (target.model.id)}
        <div class="project-row">
          <div class="project-main">
            <div class="project-title">{target.model.name}</div>
            <div class="project-meta">{target.project.name}</div>
          </div>
          <div class="project-actions">
            <button class="secondary-button small-button" aria-label={`Open recent model ${target.model.name} from ${target.project.name}`} onclick={() => onOpenModel(target.model.id)} disabled={busy || !canOpenModel}>Open</button>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .current-model-tag{color:var(--muted-2);font-size:var(--font-xs);font-weight:650;white-space:nowrap}
  .preferences-recovery{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated);font-size:var(--font-sm)}
  .preferences-recovery>div{display:grid;gap:5px}.preferences-recovery span{font-size:var(--font-sm);color:var(--muted)}
  .content-section{margin-bottom:34px}
  .section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:10px}
  .section-heading h2{margin:0;font-size:var(--font-title);font-weight:700}
  .project-list{border:1px solid var(--border-soft);border-radius:8px;background:var(--bg-elevated)}
  .project-row{min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:10px 12px;border-bottom:1px solid var(--border-soft)}
  .project-row:last-child{border-bottom:0}
  .project-main{min-width:0;display:grid;gap:3px}
  .project-title{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .project-meta{color:var(--muted);font-size:var(--font-sm)}
  .project-actions,.model-actions{display:flex;align-items:center;gap:6px}
  .primary-button,.secondary-button{min-height:32px;padding:6px 11px;border-radius:6px;font-size:var(--font-sm);font-weight:700;cursor:pointer}
  .primary-button{border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink)}
  .secondary-button{border:1px solid var(--border);background:var(--surface-2);color:var(--text-soft)}
  .small-button{min-height:32px;padding:4px 9px;font-size:var(--font-sm)}
  .quiet-button,.show-more-button{border:0;background:transparent;color:var(--muted);font-size:var(--font-sm);font-weight:650;cursor:pointer}
  .quiet-button:hover,.show-more-button:hover{color:var(--text)}
  .project-details{padding:4px 12px 8px;border-bottom:1px solid var(--border-soft);background:var(--surface)}
  .project-details-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 5px;color:var(--muted-2);font-size:var(--font-xs);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  .model-row{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--border-soft)}
  .model-main{min-width:0;display:flex;align-items:center;gap:7px}
  .model-main strong{font-size:var(--font-sm);font-weight:650}.model-main span{color:var(--muted-2);font-size:var(--font-xs)}
  .show-more-button{margin-top:8px;padding:4px 0}
  .compact-search{width:150px;height:34px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-soft);font:inherit;font-size:var(--font-sm)}
  .compact-search:focus{border-color:var(--info)}.compact-search::placeholder{color:var(--muted-2)}
  .project-search-bar{display:grid;gap:5px;margin:0 0 10px}.project-search-bar label{color:var(--text-soft);font-size:var(--font-sm);font-weight:650}.project-search-controls{display:flex;align-items:center;gap:8px}.project-search{flex:1 1 auto;min-width:0;width:100%;max-width:460px}.project-search-feedback{color:var(--muted-2);font-size:var(--font-xs)}.project-search-feedback:empty{display:none}.clear-search{flex:0 0 auto;min-height:32px;padding:4px 8px}
  .project-empty{padding:10px 0;color:var(--muted-2);font-size:var(--font-sm)}.project-empty-list{padding:13px 12px}
  .folder-heading{margin-top:6px;padding-top:9px;border-top:1px solid var(--border-soft)}
  .folder-shortcuts{display:flex;flex-wrap:wrap;gap:6px;padding:3px 0 6px}
  .folder-shortcut{min-height:28px;padding:4px 9px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-soft);font-size:var(--font-sm);font-weight:650}
  .folder-shortcut:hover:not(:disabled){background:var(--surface-3);color:var(--text)}
  .more-menu{position:relative}
  .more-menu summary{width:30px;height:30px;display:grid;place-items:center;list-style:none;border-radius:6px;color:var(--muted);cursor:pointer}
  .more-menu summary:hover,.more-menu[open] summary{background:var(--surface-2);color:var(--text)}
  .more-menu summary::-webkit-details-marker{display:none}
  .menu-popover{position:absolute;z-index:20;right:0;top:34px;width:168px;display:grid;padding:5px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);box-shadow:var(--shadow-popover)}
  .menu-popover button{width:100%;padding:7px 8px;border-radius:5px;background:transparent;color:var(--text-soft);text-align:left;cursor:pointer;font-size:var(--font-sm)}
  .menu-popover button:hover:not(:disabled){background:var(--surface-3)}
  .menu-popover .menu-danger{color:#e28b8b;font-weight:700}
  .menu-popover .menu-danger:hover:not(:disabled){background:rgba(192,70,70,.12)}
  .project-state-note{margin:0 0 14px;padding:7px 10px;border-left:2px solid var(--warning);color:var(--text-soft);font-size:var(--font-sm);line-height:1.5}
  .project-state-note strong{font-weight:700}
  @media(max-width:680px){
    .section-heading{align-items:flex-start;flex-wrap:wrap;gap:9px}
    .preferences-recovery,.project-row,.model-row{align-items:flex-start;flex-wrap:wrap;gap:9px}
    .project-main,.model-main{flex:1 1 165px;min-width:0}
    .project-title{white-space:normal;overflow-wrap:anywhere}
    .model-main{flex-wrap:wrap}
    .model-main strong{overflow-wrap:anywhere}
    .project-actions,.model-actions{flex:1 1 100%;justify-content:flex-end;flex-wrap:wrap;min-width:0}
    .project-search-controls{flex-wrap:wrap}
    .menu-popover{max-width:calc(100vw - 36px)}
  }
</style>
