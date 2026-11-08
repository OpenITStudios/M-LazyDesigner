<script lang="ts">
  import { PREVIEW_SCENARIOS, PREVIEW_VIEWPORTS, type PreviewScenario, type PreviewViewport } from './fixtures';

  // Controls only; the iframe navigates to the ACTUAL production app HTML entry.
  let scenario = $state<PreviewScenario>('editor-ready');
  let viewport = $state<PreviewViewport>('desktop');
  const selected = $derived(PREVIEW_SCENARIOS.find(item => item.id === scenario) ?? PREVIEW_SCENARIOS[0]);
  const size = $derived(PREVIEW_VIEWPORTS[viewport]);
  const frameUrl = $derived('/?fixture=' + encodeURIComponent(selected.fixture) + '&view=' + encodeURIComponent(selected.view));
</script>

<svelte:head>
  <title>LazyDesigner UI Preview · actual Svelte app · synthetic fixture</title>
</svelte:head>

<div class="preview-shell">
  <header class="preview-toolbar" aria-label="Preview controls">
    <div class="preview-title">
      <h1>LazyDesigner · UI Preview</h1>
      <p>Production App.svelte in a real browser viewport · synthetic, read-only</p>
    </div>
    <label>Scenario
      <select bind:value={scenario} aria-label="Preview scenario">
        {#each PREVIEW_SCENARIOS as item (item.id)}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>
    </label>
    <label>Viewport
      <select bind:value={viewport} aria-label="Preview viewport">
        {#each Object.entries(PREVIEW_VIEWPORTS) as [id, dimensions] (id)}
          <option value={id}>{dimensions.width} × {dimensions.height}</option>
        {/each}
      </select>
    </label>
    <strong class="synthetic-warning">SYNTHETIC · NOT NATIVE</strong>
  </header>

  <div class="preview-scroll" aria-label="Preview scroll area">
    <!-- The iframe, not just its surrounding div, has the selected layout viewport. -->
    <div data-preview-canvas data-preview-synthetic="true" data-preview-scenario={scenario}
      data-preview-viewport={viewport}
      style={'width: ' + size.width + 'px; height: ' + size.height + 'px;'}>
      <iframe data-preview-frame inert
        title="Actual LazyDesigner application with synthetic source fixture"
        src={frameUrl} sandbox="allow-scripts allow-same-origin"
      ></iframe>
    </div>
  </div>
  <p class="preview-disclaimer">
    Browser render of the actual application. The native Blockbench window is NOT inside this screenshot;
    its application placeholder is shown. No native operation or real AI readiness has been verified.
  </p>
</div>

<style>
  :global(html), :global(body), :global(#ui-preview) { width: 100%; height: 100%; margin: 0; }
  :global(body) { background: #101319; color: #e9edf5; font: 14px/1.45 Inter, "Segoe UI", system-ui, sans-serif; }
  :global(*) { box-sizing: border-box; }
  .preview-shell { display: flex; flex-direction: column; height: 100vh; min-height: 0; }
  .preview-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 12px 20px; border-bottom: 1px solid #303745; background: #1d232d; }
  .preview-title { min-width: 250px; flex: 1; }
  .preview-title h1 { margin: 0; font-size: 15px; }
  .preview-title p { margin: 4px 0 0; color: #aeb9c9; font-size: 12px; }
  .preview-toolbar label { display: flex; align-items: center; gap: 8px; color: #b9c7d8; font-size: 12px; }
  .preview-toolbar select { padding: 7px 10px; min-height: 36px; border: 1px solid #4c5769; border-radius: 6px; background: #252d39; color: #f4f6f9; }
  .preview-toolbar select:focus-visible { outline: 2px solid #84b4e9; outline-offset: 2px; }
  .synthetic-warning { color: #ffda87; border: 1px solid #8d774d; border-radius: 5px; padding: 8px; font-size: 11px; }
  .preview-scroll { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
  [data-preview-canvas] { flex: none; overflow: hidden; background: #111315; box-shadow: 0 16px 50px rgba(0, 0, 0, .4); }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  .preview-disclaimer { margin: 0; padding: 10px 20px; border-top: 1px solid #303745; background: #1d232d; color: #b9c7d8; font-size: 12px; }
</style>
