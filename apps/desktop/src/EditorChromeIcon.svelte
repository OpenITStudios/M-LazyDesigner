<script lang="ts">
  // Lightweight Svelte-native UI glyphs. No external icon font, screenshot,
  // generated image, canvas or duplicated Blockbench editing surface.
  export let name:
    | 'projects' | 'assistant' | 'focus' | 'workspace' | 'support'
    | 'model' | 'add' | 'chevron-left' | 'chevron-right'
    | 'folder' | 'activity';
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
  width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85"
  stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">
  {#if name === 'projects'}
    <path d="M3 5h7l2 2h9v12H3z"/><path d="M3 9h18"/>
  {:else if name === 'assistant'}
    <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/>
  {:else if name === 'focus'}
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/>
  {:else if name === 'workspace'}
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M9 10h12"/>
  {:else if name === 'support'}
    <circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2l-1.5 1.5v1.5"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/>
  {:else if name === 'model'}
    <path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10"/>
  {:else if name === 'add'}
    <path d="M12 5v14M5 12h14"/>
  {:else if name === 'chevron-left'}
    <path d="m15 18-6-6 6-6"/>
  {:else if name === 'chevron-right'}
    <path d="m9 18 6-6-6-6"/>
  {:else if name === 'folder'}
    <path d="M3 7V5h7l2 2h9v12H3z"/>
  {:else if name === 'activity'}
    <path d="M3 12h4l3-7 4 14 3-7h4"/>
  {/if}
</svg>
