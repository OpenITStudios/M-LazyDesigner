<script lang="ts">
  import type { AnalyticsOverview, AnalyticsProject } from './desktopTypes';

  export let data: AnalyticsOverview | null;
  export let loading: boolean;
  export let error: string;
  export let exporting: boolean;
  export let refresh: () => Promise<void>;
  export let copyJson: () => Promise<void>;
  export let exportJson: () => Promise<void>;

  let selectedKey = '';
  let selected: AnalyticsProject | null = null;
  $: selected = data?.projects.find(p => p.project_key === selectedKey)
    ?? data?.projects[0] ?? null;

  const fmt = (n: number | null | undefined) =>
    typeof n === 'number' ? n.toLocaleString('en-US') : '—';
  const short = (key: string) =>
    key === 'OTHER' ? 'Other builds' : key.slice(0, 14) + '…';
</script>

<main class="page-content analytics-content">
  <div class="analytics-heading">
    <div>
      <h2>Gateway analytics</h2>
      <p>Recent local MCP activity. Read-only; no Runtime calls or background monitoring.</p>
    </div>
    <div class="analytics-actions">
      <button class="secondary-button" onclick={refresh} disabled={loading || exporting}>{loading ? 'Reading…' : 'Refresh'}</button>
      <button class="secondary-button" onclick={copyJson} disabled={!data || loading}>Copy JSON</button>
      <button class="secondary-button" onclick={exportJson} disabled={!data || loading || exporting}>{exporting ? 'Exporting…' : 'Export JSON'}</button>
    </div>
  </div>

  {#if error}
    <div role="alert" class="analytics-notice"><strong>Unable to read analytics</strong><span>{error}</span></div>
  {/if}

  {#if loading && !data}
    <div class="analytics-panel" role="status">Reading recorded Gateway sessions…</div>
  {:else if !data}
    <div class="analytics-panel">No data loaded. Select Refresh to read the local analytics cache.</div>
  {:else if data.state === 'NO_DATA'}
    <section class="analytics-panel" role="status">
      <h3>No recorded Gateway sessions</h3>
      <p>Only existing L0 snapshots are shown. Opening this page does not create additional MCP requests.</p>
    </section>
  {:else}
    <section class="analytics-metrics" aria-label="Observed activity">
      <div><span>Observed calls</span><strong>{fmt(data.observed_calls)}</strong></div>
      <div><span>Failed calls</span><strong>{fmt(data.failures)}</strong></div>
      <div><span>Project identities</span><strong>{fmt(data.projects.length)}</strong></div>
      <div><span>Retained sessions</span><strong>{fmt(data.observed_sessions)}</strong></div>
    </section>

    {#if data.state === 'PARTIAL'}
      <div class="analytics-notice" role="status">
        <strong>Partial observation</strong>
        <span>One or more recordings were unclean, incomplete, omitted or invalid. Totals do not represent the entire project lifetime.</span>
      </div>
    {/if}

    <section class="analytics-panel">
      <h3>Coverage</h3>
      <div class="analytics-coverage">
        <span>Unbound calls <strong>{fmt(data.unbound_calls)}</strong></span>
        <span>Open sessions <strong>{fmt(data.open_or_unclean_sessions)}</strong></span>
        <span>Invalid snapshots <strong>{fmt(data.invalid_snapshots)}</strong></span>
        <span>Omitted files <strong>{fmt(data.older_snapshots_omitted)}</strong></span>
        <span>Collector errors <strong>{fmt(data.capture_failures)}</strong></span>
        <span>Storage errors <strong>{fmt(data.persist_failures)}</strong></span>
        <span>Overflow project observations <strong>{fmt(data.overflow_project_observations)}</strong></span>
      </div>
    </section>

    {#if data.projects.length > 0}
      <section class="analytics-panel">
        <div class="analytics-project-heading">
          <h3>Project operations</h3>
          <label>
            <span>Native identity</span>
            <select value={selected?.project_key ?? ''} onchange={event => { selectedKey = event.currentTarget.value; }}>
              {#each data.projects as p (p.project_key)}
                <option value={p.project_key}>{short(p.project_key)} · {fmt(p.observed_calls)} calls</option>
              {/each}
            </select>
          </label>
        </div>

        {#if selected}
          <p class="analytics-subtle">Project key: <code>{selected.project_key}</code>. Hash of native UUID, not a stable Workspace identity.</p>
          <div class="analytics-coverage analytics-project-totals">
            <span>Calls <strong>{fmt(selected.observed_calls)}</strong></span>
            <span>Failures <strong>{fmt(selected.failures)}</strong></span>
            <span>Summed call duration <strong>{fmt(selected.duration_sum_ms)} ms</strong></span>
            <span>Observed sessions <strong>{fmt(selected.observed_sessions)}</strong></span>
          </div>

          <div class="analytics-columns">
            <div>
              <h4>Authoring domains</h4>
              {#if Object.keys(selected.domains).length}
                <div class="analytics-scroll">
                  <table><thead><tr><th>Domain</th><th>Calls</th><th>Failed</th><th>Duration</th></tr></thead>
                    <tbody>{#each Object.entries(selected.domains) as [name, item] (name)}
                      <tr><td>{name}</td><td>{fmt(item.calls)}</td><td>{fmt(item.failures)}</td><td>{fmt(item.duration_sum_ms)} ms</td></tr>
                    {/each}</tbody>
                  </table>
                </div>
              {:else}<p class="analytics-subtle">No domain-specific observations.</p>{/if}
            </div>
            <div>
              <h4>Most-used capabilities</h4>
              {#if selected.capabilities.length}
                <div class="analytics-scroll">
                  <table><thead><tr><th>Capability</th><th>Calls</th></tr></thead>
                    <tbody>{#each selected.capabilities.slice(0, 8) as item (item.name)}
                      <tr><td><code>{item.name}</code></td><td>{fmt(item.calls)}</td></tr>
                    {/each}</tbody>
                  </table>
                </div>
                {#if selected.capabilities.length > 8}<p class="analytics-subtle">Top 8 of {fmt(selected.capabilities.length)}; export JSON for all.</p>{/if}
              {:else}<p class="analytics-subtle">No capability details recorded.</p>{/if}
            </div>
          </div>

          {#if selected.error_codes.length}
            <h4>Recorded error codes</h4>
            <div class="analytics-coverage">
              {#each selected.error_codes as item (item.name)}
                <span><code>{item.name}</code> <strong>{fmt(item.calls)}</strong></span>
              {/each}
            </div>
          {/if}

          <details class="analytics-details">
            <summary>Build attribution</summary>
            <p class="analytics-subtle">Measured in {fmt(selected.build_measured_sessions)} of {fmt(selected.observed_sessions)} retained sessions. Unknown-build calls: {fmt(selected.build_unattributed_calls)}. {selected.build_overflow ? 'Some builds are grouped under Other.' : ''}</p>
            {#if Object.keys(selected.build_calls).length}
              <div class="analytics-scroll">
                <table><thead><tr><th>Observed build hash</th><th>Calls</th><th>Failed</th></tr></thead>
                  <tbody>{#each Object.entries(selected.build_calls).slice(0, 12) as [key, item] (key)}
                    <tr><td><code title={key}>{short(key)}</code></td><td>{fmt(item.calls)}</td><td>{fmt(item.failures)}</td></tr>
                  {/each}</tbody>
                </table>
              </div>
            {/if}
          </details>
        {/if}
      </section>
    {/if}
  {/if}

  <details class="analytics-panel analytics-details">
    <summary>Data and interpretation</summary>
    <p>Gateway L0 contains recent local session snapshots, not a complete history. Summed call duration is not project wall time. Build hashes are not verified Git commits.</p>
    <p>Accepted quality and provider AI tokens are not measured by this view. Copy JSON uses the displayed snapshot; Export JSON reads the latest local snapshot, which may differ while Gateway is active. Nothing is uploaded automatically.</p>
  </details>
</main>

<style>
  .analytics-content{max-width:1180px;min-width:0}
  .analytics-heading{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:18px}
  .analytics-heading h2{font-size:19px;margin:0}
  .analytics-heading p,.analytics-subtle,.analytics-details p{font-size:var(--font-sm);color:var(--muted);margin:5px 0 12px}
  .analytics-actions{display:flex;gap:7px;flex-wrap:wrap}
  .analytics-panel,.analytics-metrics>div{border:1px solid var(--border-soft);border-radius:8px;background:var(--surface);padding:15px}
  .analytics-panel{margin-bottom:14px}
  .analytics-panel h3{font-size:var(--font-title);margin:0 0 12px}
  .analytics-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
  .analytics-metrics>div{display:grid;gap:7px}
  .analytics-metrics span,.analytics-coverage span{font-size:var(--font-sm);color:var(--muted)}
  .analytics-metrics strong{font-size:23px;font-variant-numeric:tabular-nums}
  .analytics-coverage{display:flex;flex-wrap:wrap;gap:9px 23px}
  .analytics-coverage strong{margin-left:5px;color:var(--text);font-variant-numeric:tabular-nums}
  .analytics-notice{display:grid;gap:3px;padding:12px;border-radius:7px;background:var(--surface-2);border:1px solid var(--border-strong);margin:12px 0;font-size:var(--font-sm)}
  .analytics-notice span{color:var(--muted)}
  .analytics-project-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
  .analytics-project-heading label{display:flex;align-items:center;gap:9px;font-size:var(--font-sm);color:var(--muted)}
  .analytics-project-heading select{max-width:340px;min-width:170px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text)}
  .analytics-subtle code{overflow-wrap:anywhere;font-size:var(--font-xs)}
  .analytics-project-totals{padding:6px 0 12px;border-bottom:1px solid var(--border-soft)}
  .analytics-columns{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:12px 0}
  .analytics-columns h4,h4{font-size:var(--font-sm);margin:12px 0 8px}
  .analytics-scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:var(--font-sm)}
  th,td{text-align:left;padding:7px;border-bottom:1px solid var(--border-soft);font-variant-numeric:tabular-nums}
  th{color:var(--muted);font-weight:600}td code{font-size:var(--font-xs);overflow-wrap:anywhere}
  .analytics-details{margin:14px 0}.analytics-details summary{cursor:pointer;font-size:var(--font-sm);font-weight:650}
  @media(max-width:960px){.analytics-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.analytics-columns{grid-template-columns:1fr}}
  @media(max-width:720px){.analytics-heading,.analytics-project-heading{align-items:start;flex-direction:column}}
</style>
