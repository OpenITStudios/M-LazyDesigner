<script lang="ts">
  import LegacyApp from './App.svelte';
  import RustEditorPage from './RustEditorPage.svelte';

  // Rust is the default workspace on this branch, independent of Blockbench.
  // The existing companion stays available through a deliberate legacy route.
  let legacyWorkspace = false;
</script>

{#if legacyWorkspace}
  <div class="legacy-route">
    <button class="return" onclick={() => legacyWorkspace = false}>Return to Rust Editor</button>
    <LegacyApp />
  </div>
{:else}
  <RustEditorPage onLegacy={() => legacyWorkspace = true} />
{/if}

<style>
  .legacy-route { position: relative; width: 100%; height: 100vh; }
  .return { position: fixed; top: 8px; right: 10px; z-index: 1100; padding: 6px 10px;
    color: #d9e3f3; background: #243143; border: 1px solid #506681; border-radius: 4px; cursor: pointer; }
  .return:focus-visible { outline: 2px solid #3e90ff; }
</style>
