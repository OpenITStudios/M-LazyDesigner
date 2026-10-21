<script lang="ts">
  import type { ProjectAction, ProjectNavigation } from './projectNavigationTypes';
  import { visibleProjects, visibleProjectModels, recentModelTargets, continueTarget } from './desktopPresentation';

  export let navigation: ProjectNavigation;
  export let busy = false;
  export let canOpenModel = true;
  export let canEditProjectPrefs = true;
  export let onOpenModel: (id: string) => void | Promise<void>;
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

  function toggleProject(id: string) {
    expandedProjectId = expandedProjectId === id ? null : id;
  }
</script>

{#if navigation.preferences_issue}
  <section class="preferences-recovery" role="alert">
    <div>
      <strong>Project shortcuts need attention</strong>
      <span>Saved shortcuts could not be read. Your model files are unchanged.</span>
    </div>
    {#if navigation.preferences_issue === 'RECOVERABLE'}
      <button class="secondary-button small-button" onclick={() => onProjectAction('restore-project-preferences', '')} disabled={busy || !canEditProjectPrefs}>Restore shortcuts</button>
    {:else}
      <span>Open Support to review the existing preferences. Nothing was overwritten.</span>
    {/if}
  </section>
{/if}

{#if navigation.active}
  {@const active = navigation.active}
  <section class="content-section">
    <div class="section-heading"><div><h2>Current Model</h2></div></div>
    <div class="project-list">
      <div class="project-row active-project-row">
        <div class="project-main">
          <div class="project-title">{active.model_name}</div>
          <div class="project-meta">{active.project_name || (active.saved ? 'Saved model' : 'Not saved yet')}{active.dirty ? ' · Modified' : ''}</div>
        </div>
        <div class="project-actions">
          <button class="primary-button small-button" onclick={onFocusEditor} disabled={busy}>Go to Blockbench</button>
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
            <button class="primary-button small-button" onclick={() => onOpenModel(target.model.id)} disabled={busy || !canOpenModel}>Continue</button>
          </div>
        </div>
      </div>
    </section>
  {/if}
{/if}

<section class="content-section" aria-label="Projects and models">
  <div class="section-heading">
    <div><h2>Projects &amp; Models</h2></div>
    <button class="secondary-button small-button" onclick={onAddProjectFolder} disabled={busy || !canEditProjectPrefs}>Add Project Folder</button>
  </div>
  <div class="project-search-bar">
    <input class="compact-search project-search" type="search" placeholder="Search projects or models…" aria-label="Search projects or models" bind:value={projectSearch} />
  </div>
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
          <button class="secondary-button small-button" onclick={() => onProjectAction('open-project-folder', project.id)} disabled={!project.available || busy}>Open Folder</button>
          {#if !projectSearch.trim()}
            <button class="quiet-button" aria-expanded={expandedProjectId === project.id} onclick={() => toggleProject(project.id)}>{expandedProjectId === project.id ? 'Hide models' : 'Show models'}</button>
          {/if}
          <details class="more-menu">
            <summary aria-label="Project actions">•••</summary>
            <div class="menu-popover">
              <button onclick={() => onProjectAction(project.pinned ? 'unpin-project' : 'pin-project', project.id)} disabled={busy || !canEditProjectPrefs}>{project.pinned ? 'Unpin project' : 'Pin project'}</button>
              {#if project.registered}
                <button onclick={() => onProjectAction('remove-project-folder', project.id)} disabled={busy || !canEditProjectPrefs}>Remove from Workspace</button>
                <button class="menu-danger" onclick={() => onDeleteProject(project.id)} disabled={!project.available || busy}>Delete Project…</button>
              {/if}
            </div>
          </details>
        </div>
      </div>
      {#if expandedProjectId === project.id || projectSearch.trim()}
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
                    <button class="secondary-button small-button" onclick={onFocusEditor} disabled={busy}>Go to Blockbench</button>
                  {:else}
                    <button class="secondary-button small-button" onclick={() => onOpenModel(model.id)} disabled={!model.exists || busy || !canOpenModel}>Open</button>
                  {/if}
                  <details class="more-menu">
                    <summary aria-label="Model actions">•••</summary>
                    <div class="menu-popover">
                      <button onclick={() => onProjectAction('reveal-model', model.id)} disabled={!model.exists || busy}>Show in Explorer</button>
                      <button onclick={() => onCopyPath(model.id)} disabled={busy}>Copy path</button>
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
                  <button class="folder-shortcut" onclick={() => onProjectAction('open-folder', folder.id)} disabled={busy}>{folder.label}</button>
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
            <button class="secondary-button small-button" onclick={() => onOpenModel(target.model.id)} disabled={busy || !canOpenModel}>Open</button>
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
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
  .project-search-bar{margin:0 0 10px} .project-search{width:100%;max-width:460px}
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
</style>
