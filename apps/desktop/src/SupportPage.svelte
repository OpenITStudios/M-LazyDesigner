<script lang="ts">
  import { version as desktopVersion } from '../package.json';
  import { compatibilityLabel, productMode, productHeadline, productMessage, type ManagedAction } from './desktopPresentation';
  import type { SystemStatus, DesktopBusyAction, DesktopOperationRecord } from './desktopTypes';

  export let status: SystemStatus;
  export let loading: boolean;
  export let busyAction: DesktopBusyAction | null;
  export let statusProbeFailures: number;
  export let migrationConflict: boolean;
  export let migrationConflictKind: 'plugin' | 'client';
  export let error: string;
  export let errorDetail: string | null;
  export let operations: DesktopOperationRecord[];
  export let refresh: () => Promise<void>;
  export let showRetiredPluginFile: () => Promise<void>;
  export let chooseBlockbenchExecutable: () => Promise<void>;
  export let showPluginFile: () => Promise<void>;
  export let exportDiagnostics: () => Promise<void>;
  export let runManagedAction: (action: ManagedAction) => Promise<void>;
</script>

<main class="page-content settings-content">
  {#if statusProbeFailures >= 2}
    <section class="support-banner" role="status">
      <span class="support-banner-dot" aria-hidden="true"></span>
      <div><strong>AI status needs verification</strong><span>These are the last known connection details. You can still open model files; Refresh before changing AI or installed components.</span></div>
      <button class="secondary-button small-button" onclick={refresh} disabled={loading || busyAction !== null}>Refresh</button>
    </section>
  {:else if productMode(status) !== 'ready'}
    <div class="support-banner">
      <span class="support-banner-dot"></span>
      <div><strong>{productHeadline(status)}</strong><span>{productMessage(status)}</span></div>
    </div>
  {/if}

  {#if migrationConflict}
    <section class="settings-section">
      <h2>Review previous {migrationConflictKind === 'plugin' ? 'plugin' : 'AI client'}</h2>
      {#if migrationConflictKind === 'plugin'}
        <p>Save your models and close Blockbench. Review the existing plugin and keep a backup before using Blockbench's own plugin controls. LazyDesigner will not delete or adopt that file automatically. After the conflict is safely resolved, return to Workspace and choose Check again.</p>
        <button class="secondary-button" onclick={showRetiredPluginFile}>Show existing plugin</button>
      {:else}
        <p>Back up your Codex configuration and review the older BlockIT MCP entry. LazyDesigner will not modify that entry or start another server automatically. Once a verified migration has resolved the conflict, return to Workspace and choose Check again.</p>
      {/if}
    </section>
  {/if}
  {#if error && errorDetail}
    <section class="settings-section">
      <h2>Last unsuccessful action</h2>
      <p>{error}</p>
      <details class="advanced-recovery">
        <summary><span><strong>Technical details</strong><small>For troubleshooting only. No information is uploaded.</small></span><span>Show</span></summary>
        <div class="recovery-list"><code>{errorDetail}</code></div>
      </details>
    </section>
  {/if}
  <section class="settings-section">
    <h2>About</h2>
    <div class="definition-rows">
      <div class="definition-row"><span>LazyDesigner Desktop version</span><strong>{desktopVersion}</strong></div>
      <div class="definition-row"><span>Blockbench version</span><strong>{status.blockbench.version ?? 'Unavailable'}</strong></div>
      {#if status.managed?.installed?.source_sha}<div class="definition-row"><span>Managed build</span><code>{status.managed.installed.source_sha.slice(0,12)}</code></div>{/if}
      {#if status.plugin_integrity !== 'ready'}<div class="definition-row"><span>Blockbench plugin</span><strong class="status-warning">{status.plugin_integrity === 'missing' ? 'Repairing / missing' : status.plugin_integrity === 'modified' ? 'Modified' : 'Needs attention'}</strong></div>{/if}
    </div>
  </section>

  <section class="settings-section">
    <h2>Troubleshooting</h2>
    <div class="settings-row">
      <div><strong>Blockbench installation</strong><span>Choose the real installed Blockbench.exe if it moved or multiple installations were detected. Self-extracting *_portable.exe launchers are not supported yet. Close Blockbench before changing this. Your project files and managed plugin stay untouched.</span></div>
      <button class="secondary-button" onclick={chooseBlockbenchExecutable} disabled={busyAction !== null}>{busyAction === 'choose-editor' ? 'Selecting…' : 'Choose…'}</button>
    </div>
    {#if status.manager_available}
      <div class="settings-row">
        <div><strong>Installed Blockbench plugin</strong><span>Show the managed plugin file only when reviewing setup or trust.</span></div>
        <button class="secondary-button" onclick={showPluginFile} disabled={busyAction !== null || statusProbeFailures >= 2}>Show file</button>
      </div>
    {/if}
    <div class="settings-row">
      <div><strong>Export diagnostics</strong><span>Create a local troubleshooting snapshot. Nothing is uploaded automatically.</span></div>
      <button class="secondary-button" onclick={exportDiagnostics} disabled={busyAction !== null}>{busyAction === 'export-diagnostics' ? 'Exporting…' : 'Export'}</button>
    </div>

    {#if status.blockbench.compatibility?.status === 'unsupported' || status.blockbench.compatibility?.status === 'invalid'}
      <div class="settings-row compact"><div><strong>Blockbench support</strong><span>{compatibilityLabel(status.blockbench.compatibility?.status)}</span></div></div>
    {/if}
    {#if status.manager_available && status.managed?.tls_ready === false}
      <div class="settings-row compact"><div><strong>Local security</strong><span>Needs setup</span></div></div>
    {/if}

    {#if status.manager_available}
      <details class="advanced-recovery">
        <summary><span><strong>Advanced recovery</strong><small>Use only if normal setup or updates cannot finish.</small></span><span>Show</span></summary>
        <div class="recovery-list">
          <div><span><strong>Restore previous version</strong><small>{status.maintenance.rollback ? 'Return to the last verified version.' : 'No previous version is available.'}</small></span><button class="secondary-button small-button" onclick={() => runManagedAction('rollback')} disabled={!status.maintenance.rollback || busyAction !== null || statusProbeFailures >= 2}>Restore</button></div>
          <div><span><strong>Repair LazyDesigner</strong><small>{status.maintenance.repair ? 'Restore missing files from the current installation.' : 'Repair is not available right now.'}</small></span><button class="secondary-button small-button" onclick={() => runManagedAction('repair')} disabled={!status.maintenance.repair || busyAction !== null || statusProbeFailures >= 2}>Repair</button></div>
          <div><span><strong>Finish incomplete setup</strong><small>{status.maintenance.recover ? 'Recover an interrupted installation.' : 'No interrupted setup was found.'}</small></span><button class="secondary-button small-button" onclick={() => runManagedAction('recover')} disabled={!status.maintenance.recover || busyAction !== null || statusProbeFailures >= 2}>Recover</button></div>
        </div>
      </details>
    {/if}
  </section>

  {#if operations.length > 0}
    <section class="settings-section">
      <details class="recent-activity">
        <summary><span><strong>Recent activity</strong><small>Current Desktop session</small></span><span>Show</span></summary>
        <div class="recent-list">
          {#each operations as operation}
            <div><span>{operation.action}</span><strong class:failed={operation.outcome === 'failed'} class:pending={operation.outcome === 'pending'} class:unchanged={operation.outcome === 'unchanged'}>{operation.outcome === 'success' ? 'Completed' : operation.outcome === 'pending' ? 'Next step' : operation.outcome === 'unchanged' ? 'No change' : 'Failed'}</strong></div>
          {/each}
        </div>
      </details>
    </section>
  {/if}
</main>

<style>
.settings-content{max-width:980px}
  .support-banner{display:flex;align-items:flex-start;gap:9px;margin-bottom:24px;padding:10px 0 18px;border-bottom:1px solid var(--border-soft)}.support-banner-dot{width:7px;height:7px;margin-top:4px;border-radius:50%;background:var(--warning)}.support-banner>div{display:grid;gap:2px}.support-banner strong{font-size:var(--font-sm)}.support-banner span{color:var(--muted);font-size:var(--font-sm)}.settings-section{max-width:780px;margin-bottom:30px}.settings-section h2{margin:0 0 9px;font-size:var(--font-title)}.settings-row{min-height:54px;display:flex;align-items:center;justify-content:space-between;gap:24px;border-top:1px solid var(--border-soft)}.settings-row.compact{min-height:42px}.settings-row>div{display:grid;gap:2px}.settings-row strong{font-size:var(--font-sm)}.settings-row span{color:var(--muted);font-size:var(--font-sm);line-height:1.4}
  .advanced-recovery,.recent-activity{margin-top:8px;border-top:1px solid var(--border-soft)}.advanced-recovery summary,.recent-activity summary{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 0;list-style:none;cursor:pointer}.advanced-recovery summary::-webkit-details-marker,.recent-activity summary::-webkit-details-marker{display:none}.advanced-recovery summary>span:first-child,.recent-activity summary>span:first-child{display:grid;gap:2px}.advanced-recovery summary strong,.recent-activity summary strong{font-size:var(--font-sm)}.advanced-recovery summary small,.recent-activity summary small{color:var(--muted);font-size:var(--font-xs)}.advanced-recovery summary>span:last-child,.recent-activity summary>span:last-child{color:var(--muted);font-size:var(--font-sm)}.recovery-list,.recent-list{border-top:1px solid var(--border-soft)}.recovery-list>div,.recent-list>div{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--border-soft)}.recovery-list>div>span{display:grid;gap:2px}.recovery-list strong{font-size:var(--font-sm)}.recovery-list small{color:var(--muted);font-size:var(--font-xs)}.recent-list span{font-size:var(--font-sm)}.recent-list strong{font-size:var(--font-xs);color:#9ee8b9}.recent-list strong.failed{color:#ff9aa2}.recent-list strong.pending{color:var(--warning)}.recent-list strong.unchanged{color:var(--muted)}
  @media(max-width:760px){.settings-row,.recovery-list>div{align-items:flex-start;flex-direction:column}}
</style>
