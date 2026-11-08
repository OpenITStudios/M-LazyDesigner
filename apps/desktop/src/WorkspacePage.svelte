<script lang="ts">
  import ProjectNavigator from './ProjectNavigator.svelte';
  import { productMode, productHeadline, productGuidance, aiStatusPresentation, progressLabel, type ManagedAction } from './desktopPresentation';
  import type { SystemStatus, DesktopBusyAction, ManagedUpdateCheck } from './desktopTypes';
  import type { ProjectAction } from './projectNavigationTypes';

  export let status: SystemStatus;
  export let loading: boolean;
  export let busyAction: DesktopBusyAction | null;
  export let progressStage: string;
  export let statusProbeFailures: number;
  export let pluginApprovalNeeded: boolean;
  export let migrationConflict: boolean;
  export let migrationConflictKind: 'plugin' | 'client';
  export let setupStaged: boolean;
  export let readinessReason: string;
  export let updateCheck: ManagedUpdateCheck | null;
  export let expandedProjectId: string | null = null;
  export let showAllProjects = false;
  export let projectSearch = '';
  export let workspaceMain: HTMLElement | undefined = undefined;
  export let openModel: (id?: string) => Promise<void>;
  export let addProjectFolder: () => Promise<void>;
  export let beginDeleteProject: (id: string) => Promise<void>;
  export let focusCurrentEditor: () => Promise<void>;
  export let runProjectAction: (action: ProjectAction, id: string) => Promise<void>;
  export let copyNavigationPath: (id: string) => Promise<void>;
  export let showRetiredPluginFile: () => Promise<void>;
  export let installLazyDesigner: () => Promise<void>;
  export let chooseBlockbenchExecutable: () => Promise<void>;
  export let openBlockbenchEditor: () => Promise<void>;
  export let connectBlockbench: () => Promise<void>;
  export let showPluginFile: () => Promise<void>;
  export let verifyPendingUpdate: () => Promise<void>;
  export let runManagedAction: (action: ManagedAction) => Promise<void>;
  export let refresh: () => Promise<void>;
  export let navigate: (page: 'Support') => void;

  $: aiStatus = aiStatusPresentation(status, statusProbeFailures);
</script>

{#snippet projectNavigator(current: SystemStatus)}
  <ProjectNavigator
    navigation={current.project_navigation}
    bind:expandedProjectId
    bind:showAllProjects
    bind:projectSearch
    busy={busyAction !== null}
    canBrowseModel={busyAction === null}
    canOpenModel={true}
    canFocusCurrentEditor={statusProbeFailures < 2}
    canEditProjectPrefs={statusProbeFailures < 2}
    statusUnverified={statusProbeFailures >= 2}
    onOpenModel={openModel}
    onAddProjectFolder={addProjectFolder}
    onDeleteProject={beginDeleteProject}
    onFocusEditor={focusCurrentEditor}
    onProjectAction={runProjectAction}
    onCopyPath={copyNavigationPath}
  />
{/snippet}

{#snippet blockbenchIcon()}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7.5 4.3v9.4L12 21l-7.5-4.3V7.3L12 3Z"/><path d="m4.5 7.3 7.5 4.4 7.5-4.4M12 11.7V21"/></svg>
{/snippet}

<main class="page-content workspace-overview" bind:this={workspaceMain}>
  {#if busyAction && progressStage}
    <section class="task-strip" aria-live="polite">
      <span class="task-spinner"></span>
      <span>{busyAction === 'update' ? 'Updating managed components' : busyAction === 'rollback' ? 'Restoring previous version' : busyAction === 'repair' ? 'Repairing LazyDesigner' : busyAction === 'recover' ? 'Finishing setup' : busyAction === 'setup-tls' ? 'Finishing setup' : busyAction === 'connect-blockbench' ? 'Connecting to Blockbench' : 'Working'}</span>
      <small>{progressLabel(progressStage)}</small>
    </section>
  {/if}

  {#if !status.project_navigation.active}
  <section class="content-section">
    <div class="section-heading">
      <div><h2>Open a model</h2><p>Open an existing .bbmodel file in Blockbench. You can edit models even when AI is not connected.</p></div>
      <button class="primary-button" onclick={() => openModel()} disabled={busyAction !== null}>
        {busyAction === 'browse-model' ? 'Opening…' : 'Open Model…'}
      </button>
    </div>
  </section>
  {/if}

  {#if productMode(status) === 'welcome'}
    {#if status.project_navigation.projects.length > 0 || status.project_navigation.active}
      {#if status.project_navigation.projects.length > 0}
      <div class="inline-note">
        <strong>Models and folders stay accessible.</strong>
        <span>Work on your files while AI setup is resolved. Browsing does not change model content.</span>
      </div>
      {/if}
      {@render projectNavigator(status)}
    {/if}
    {#if setupStaged}
      <section class="inline-guidance" role="status">
        <strong>Setup waiting for Blockbench</strong>
        <span>Setup is staged but not installed. Save your models, close Blockbench and active AI sessions, then choose Finish setup. The package is verified again before activation. No model file has been changed.</span>
      </section>
    {/if}
    {#if migrationConflict}
      <section class="inline-guidance" role="status">
        <strong>{migrationConflictKind === 'plugin' ? 'Existing Blockbench plugin requires review' : 'Existing AI client configuration requires review'}</strong>
        <span>{migrationConflictKind === 'plugin'
          ? 'LazyDesigner found an older plugin in the selected Blockbench profile. The file was not changed. Save your models and close Blockbench before a separate migration.'
          : 'An older BlockIT AI client entry is present. LazyDesigner has not modified Codex settings or activated another server. Review and back up the existing configuration before migration.'}</span>
        <div class="resource-actions">
          {#if migrationConflictKind === 'plugin'}
            <button class="secondary-button" onclick={showRetiredPluginFile}>Show existing plugin</button>
          {/if}
          <button class="secondary-button" onclick={() => navigate('Support')}>Migration steps</button>
        </div>
      </section>
    {/if}
    <section class="setup-panel" aria-label="Optional AI setup">
      <div class="setup-copy">
        <h2>Set up AI tools</h2>
        <p>Opening and editing models in Blockbench does not require an AI connection. Set up LazyDesigner when you want AI-assisted authoring.</p>
      </div>
      <div class="setup-footer">
        {#if productGuidance(status, pluginApprovalNeeded)}<span class="setup-warning">{productGuidance(status, pluginApprovalNeeded)}</span>{/if}
        <button class="secondary-button" onclick={installLazyDesigner} disabled={!status.bootstrap_available || busyAction !== null || statusProbeFailures >= 2}>{busyAction === 'install' ? 'Setting up…' : setupStaged ? 'Finish setup' : migrationConflict ? 'Check again' : 'Set up AI tools'}</button>
      </div>
      <details class="setup-steps">
        <summary>What happens during setup?</summary>
        <ol>
          <li>Install the managed LazyDesigner tools and prepare Blockbench.</li>
          <li>Approve the LazyDesigner plugin in Blockbench if prompted.</li>
          <li>When you need AI, verify the connection in your AI client.</li>
        </ol>
      </details>
    </section>
    {#if !status.project_navigation.active && status.project_navigation.projects.length === 0}
      {@render projectNavigator(status)}
    {/if}

  {:else}
    {#if (productMode(status) === 'ready' || productMode(status) === 'client-wait') && (status.project_navigation.active || status.project_navigation.projects.length > 0)}
      <section class="workspace-connection" aria-label="Connection status">
        <span class="connection-dot" class:waiting={productMode(status) === 'client-wait'} class:unknown={statusProbeFailures >= 2} aria-hidden="true"></span>
        <div class="connection-copy">
          <strong>{aiStatus.headline}</strong>
          <span>{aiStatus.detail}</span>
        </div>
        {#if statusProbeFailures >= 2}
          <button class="secondary-button small-button" onclick={refresh} disabled={loading || busyAction !== null}>Refresh</button>
        {:else}
          <div class="connection-actions">
            {#if !status.project_navigation.active}
              <button class="secondary-button small-button" onclick={openBlockbenchEditor} disabled={busyAction !== null || statusProbeFailures >= 2}>Open Blockbench</button>
            {/if}
            <button class="quiet-link" onclick={() => navigate('Support')}>Connection details</button>
          </div>
        {/if}
      </section>
    {:else}
    <section class="content-section">
      <div class="section-heading">
        <div><h2>Blockbench</h2><p>Editor connection and launch status</p></div>
      </div>

      <div class="resource-list">
        <div class="resource-row">
          <div class="app-icon">{@render blockbenchIcon()}</div>

          <div class="resource-main">
            <div class="resource-title">Blockbench</div>
            <div class="resource-meta">
              <span>{status.blockbench.version ?? 'Version unavailable'}</span>
              <span class="meta-separator">·</span>
              <span class:status-good={statusProbeFailures < 2 && status.blockbench.running} class:status-warning={statusProbeFailures >= 2 || productMode(status) === 'unsupported'}>
                {statusProbeFailures >= 2 ? 'Status unverified' : status.blockbench.running ? 'Running' : 'Not running'}
              </span>
            </div>
          </div>

          <div class="resource-actions">
            <button class="secondary-button" onclick={chooseBlockbenchExecutable} disabled={busyAction !== null || statusProbeFailures >= 2} title="Choose an installed Blockbench.exe (self-extracting portable wrappers are not supported yet)">Select installation</button>
            {#if productMode(status) === 'ready'}
              <button class="secondary-button" onclick={openBlockbenchEditor} disabled={busyAction !== null || statusProbeFailures >= 2}>Open Blockbench</button>
            {:else if productMode(status) === 'ready-start'}
              <button class="primary-button" onclick={openBlockbenchEditor} disabled={busyAction !== null || statusProbeFailures >= 2}>{busyAction === 'open-editor' ? 'Opening…' : 'Open Blockbench'}</button>
            {:else if productMode(status) === 'plugin-setup'}
              <button class="secondary-button" onclick={openBlockbenchEditor} disabled={busyAction !== null || statusProbeFailures >= 2}>Open Blockbench</button>
            {:else if productMode(status) === 'unsupported'}
              <button class="secondary-button" onclick={refresh} disabled={loading || busyAction !== null}>Check again</button>
            {:else}
              <button class="secondary-button" onclick={openBlockbenchEditor} disabled={busyAction !== null || statusProbeFailures >= 2}>Open Blockbench</button>
            {/if}
          </div>
        </div>
      </div>

      {#if productMode(status) === 'plugin-setup'}
        <div class="inline-guidance">
          {#if status.runtime_build_match === false}
            <div>
              <strong>LazyDesigner versions do not match</strong>
              <span>The Blockbench plugin and installed managed package have different build identities. Keep your model open; no automatic replacement will run.</span>
            </div>
            <button class="secondary-button" onclick={() => navigate('Support')}>Open Support</button>
          {:else if status.runtime_endpoint_match === false}
            <div>
              <strong>Local connection settings do not match</strong>
              <span>Blockbench and the MCP client must use the same LazyDesigner connection settings.</span>
            </div>
            <button class="secondary-button" onclick={() => navigate('Support')}>Open Support</button>
          {:else if !pluginApprovalNeeded}
            <div>
              <strong>LazyDesigner is not active yet</strong>
              <span>Desktop can open Blockbench and verify the Runtime automatically.</span>
            </div>
            <button class="primary-button" onclick={connectBlockbench} disabled={!status.manager_available || busyAction !== null || statusProbeFailures >= 2}>{busyAction === 'connect-blockbench' ? 'Preparing…' : 'Prepare Blockbench'}</button>
          {:else if readinessReason === 'PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING'}
            <div>
              <strong>Restart Blockbench to repair LazyDesigner</strong>
              <span>Close Blockbench normally so LazyDesigner can restore the missing plugin safely. Your unsaved work is never closed automatically.</span>
            </div>
          {:else}
            <div>
              <strong>One-time approval required</strong>
              <span>Blockbench requires your approval before a local plugin can run. This is only needed once.</span>
            </div>
            {#if readinessReason !== 'PLUGIN_MISSING_WHILE_BLOCKBENCH_RUNNING'}
              <ol>
                <li>Choose Plugins → Load Plugin from File in Blockbench.</li>
                <li>Select the highlighted LazyDesigner plugin.</li>
                <li>Approve the Blockbench trust prompt.</li>
              </ol>
              <button class="primary-button" onclick={showPluginFile} disabled={busyAction !== null}>{busyAction === 'show-plugin' ? 'Opening…' : 'Show approval file'}</button>
            {/if}
          {/if}
        </div>
      {:else if productMode(status) === 'unsupported'}
        <div class="inline-alert danger-alert"><strong>Unsupported Blockbench version</strong><span>Update Blockbench to a supported version before continuing.</span></div>
      {/if}
    </section>
    {/if}

    {@render projectNavigator(status)}

    {#if (productMode(status) !== 'ready' && productMode(status) !== 'client-wait') || status.gateway.state === 'gateway-detected' || status.managed?.pending || updateCheck?.status === 'UPDATE_AVAILABLE' || updateCheck?.status === 'UPDATE_STAGED' || updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED' || updateCheck?.status === 'DESKTOP_UPDATE_REQUIRED'}
    <section class="content-section">
      <div class="section-heading">
        <div><h2>AI connection and updates</h2><p>Editing remains available independently of AI connectivity.</p></div>
      </div>

      <div class="definition-rows">
        <div class="definition-row">
          <span>AI status</span>
          <strong class:status-good={aiStatus.recentlyVerified} class:status-warning={statusProbeFailures >= 2}>
            {aiStatus.label}
          </strong>
        </div>
        {#if status.managed?.pending || updateCheck?.status === 'UPDATE_AVAILABLE' || updateCheck?.status === 'UPDATE_STAGED' || updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED' || updateCheck?.status === 'DESKTOP_UPDATE_REQUIRED'}
          <div class="definition-row update-definition">
            <span>Update</span>
            <div class="inline-action">
              <strong>{updateCheck?.status === 'DESKTOP_UPDATE_REQUIRED' ? 'Compatible Desktop installer required' : status.managed?.pending
                ? updateCheck?.status === 'UPDATE_STAGED'
                  ? 'Package staged · not active'
                  : updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED'
                    ? 'Staged package unverified'
                    : 'Checking staged package'
                : updateCheck?.status === 'UPDATE_AVAILABLE'
                  ? 'Update available · not downloaded'
                  : 'Update not activated'}</strong>
              {#if updateCheck?.status === 'UPDATE_STAGED_UNVERIFIED' || updateCheck?.status === 'DESKTOP_UPDATE_REQUIRED'}
                <button class="secondary-button small-button" onclick={() => navigate('Support')}>Support</button>
              {:else if status.managed?.pending && updateCheck?.status !== 'UPDATE_STAGED'}
                <button class="secondary-button small-button" onclick={verifyPendingUpdate} disabled={busyAction !== null || statusProbeFailures >= 2}>Verify package</button>
              {:else}
                <button class="secondary-button small-button" onclick={() => runManagedAction('update')} disabled={!status.maintenance.update || busyAction !== null || statusProbeFailures >= 2 || !updateCheck?.available_source_sha}>{busyAction === 'update' ? 'Updating…' : status.managed?.pending ? 'Finish update' : 'Update components'}</button>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      {#if productMode(status) === 'security-setup'}
        <div class="inline-alert"><div><strong>Finish setup</strong><span>Complete the secure local connection before using LazyDesigner.</span></div><button class="primary-button small-button" onclick={() => runManagedAction('setup-tls')} disabled={!status.maintenance.setup_tls || busyAction !== null || statusProbeFailures >= 2}>Finish setup</button></div>
      {:else if productMode(status) === 'client-wait'}
        <div class="inline-note"><strong>Blockbench is ready.</strong><span>{status.gateway.state === 'gateway-detected' ? 'Gateway process detected, but Desktop cannot verify the MCP handshake. Confirm the connection from your AI client.' : 'Connect AI when you need it. You can continue editing without a connection.'}</span></div>
      {:else if productMode(status) === 'attention'}
        <div class="inline-alert"><div><strong>Action required</strong><span>{productGuidance(status, pluginApprovalNeeded) ?? status.readiness.summary}</span></div><button class="secondary-button small-button" onclick={() => navigate('Support')}>Open Support</button></div>
      {/if}
    </section>
    {/if}
  {/if}
</main>

<style>

  .content-section{margin-bottom:34px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:10px}.section-heading h2{margin:0;font-size:var(--font-title);font-weight:700}.section-heading p{margin:2px 0 0;color:var(--muted-2);font-size:var(--font-sm)}.resource-list{border:1px solid var(--border-soft);border-radius:8px;overflow:hidden;background:var(--bg-elevated)}.resource-row{min-height:74px;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 12px 12px 14px}.app-icon{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-soft)}.app-icon :global(svg){width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}.resource-main{min-width:0}.resource-title{font-size:var(--font-ui);font-weight:700}.resource-meta{display:flex;align-items:center;gap:5px;margin-top:3px;color:var(--muted);font-size:var(--font-sm)}.meta-separator{color:var(--muted-2)}.status-good{color:#9ee8b9!important}.resource-actions{display:flex;align-items:center;gap:5px}.inline-action{display:flex;align-items:center;gap:10px}
  .inline-guidance{margin-top:10px;padding:14px 14px 13px;border:1px solid #5b4a22;border-radius:8px;background:var(--warning-bg)}.inline-guidance>div{display:grid;gap:2px}.inline-guidance strong{font-size:var(--font-sm)}.inline-guidance span{color:var(--muted);font-size:var(--font-sm)}.inline-guidance ol{margin:11px 0 12px;padding-left:18px;color:var(--text-soft);font-size:var(--font-sm);line-height:1.75}.inline-note{display:flex;gap:8px;margin-top:10px;padding:9px 0;color:var(--muted);font-size:var(--font-sm)}.inline-note strong{color:var(--text-soft);font-size:var(--font-sm)}.inline-alert{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:10px;padding:10px 12px;border:1px solid #5b4a22;border-radius:7px;background:var(--warning-bg)}.inline-alert>div{display:grid;gap:2px}.inline-alert strong{font-size:var(--font-sm)}.inline-alert span{color:var(--muted);font-size:var(--font-sm)}.danger-alert{display:grid;gap:2px;border-color:#693437;background:var(--danger-bg)}
  .setup-panel{max-width:760px;margin:8px 0 18px;padding-top:18px;border-top:1px solid var(--border-soft)}.setup-copy h2{margin:0;font-size:var(--font-title);font-weight:700;letter-spacing:-.015em}.setup-copy p{margin:6px 0 0;color:var(--muted);font-size:var(--font-sm)}.setup-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:14px}.setup-warning{max-width:520px;color:var(--warning);font-size:var(--font-sm)}.setup-steps{margin-top:14px;border-top:1px solid var(--border-soft);padding-top:10px}.setup-steps summary{width:max-content;max-width:100%;cursor:pointer;color:var(--text-soft);font-size:var(--font-sm);font-weight:650}.setup-steps ol{margin:10px 0 0;padding-left:21px;color:var(--muted);font-size:var(--font-sm);line-height:1.65}.setup-steps li+li{margin-top:5px}
  .task-strip{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;padding:10px 12px;border:1px solid var(--border-soft);border-radius:var(--radius-sm);background:var(--bg-elevated);font-size:var(--font-sm)}.task-spinner{width:9px;height:9px;border:2px solid var(--surface-4);border-top-color:var(--info);border-radius:50%;animation:desktop-spin .8s linear infinite}.task-strip small{margin-left:auto;color:var(--muted-2);font-size:var(--font-xs);overflow-wrap:anywhere}
  @media(max-width:760px){.resource-row{grid-template-columns:36px minmax(0,1fr)}.resource-actions{grid-column:1/-1;justify-content:flex-end;padding-top:2px}.setup-footer{align-items:flex-start;flex-direction:column}}
  .workspace-overview .content-section{margin-bottom:24px}
  .workspace-connection{display:flex;align-items:center;gap:11px;min-height:54px;margin-bottom:22px;padding-bottom:13px;border-bottom:1px solid var(--border-soft)}
  .connection-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--accent)}
  .connection-dot.waiting{background:var(--info)}
  .connection-dot.unknown{background:var(--warning)}
  .connection-copy{display:grid;flex:1;min-width:0;gap:2px}
  .connection-copy strong{font-size:var(--font-ui);font-weight:700}
  .connection-copy span{font-size:var(--font-sm);color:var(--muted)}
  .connection-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
  .quiet-link{min-height:34px;flex:none;padding:4px 6px;border-radius:6px;background:transparent;color:var(--text-soft);font-size:var(--font-sm);font-weight:650;cursor:pointer}
  .quiet-link:hover{background:var(--surface-2);color:var(--text)}
  @media(max-width:760px){.workspace-connection{flex-wrap:wrap}.connection-actions{justify-content:flex-start}}
  @media(max-width:680px){
    .section-heading{align-items:flex-start;flex-wrap:wrap;gap:10px}
    .resource-actions{flex-wrap:wrap;justify-content:flex-start;min-width:0}
    .resource-actions button,.setup-footer button{white-space:normal;max-width:100%}
    .inline-action,.inline-alert{flex-wrap:wrap;gap:9px}
    .definition-row{flex-wrap:wrap;align-items:flex-start;gap:7px}
    .definition-row .inline-action{width:100%}
    .setup-footer{align-items:flex-start;gap:10px}
  }
</style>
