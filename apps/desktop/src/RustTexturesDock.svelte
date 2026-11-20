<script lang="ts">
  // Presentation only. The parent owns selection and native work.
  import type {EditorSnapshot} from './rustEditorTypes';
  import type {DockSide} from './rustDockLayout';
  export let side:DockSide|'float'|'tabs';
  export let snapshot:EditorSnapshot|null;
  export let paintTextureIndex:number;
  export let hidden:boolean;
  export let floating:boolean;
  export let selectionLocked:boolean;
  export let onRestore:()=>void;
  export let onMove:()=>void;
  export let onFloat:()=>void;
  export let onFold:()=>void;
  export let onSelectTexture:(index:number)=>void;
</script>

<aside class="dock-column textures-dock"
    id={side === 'float' ? 'float-textures' : side === 'tabs' ? 'tab-content-textures' : 'dock-' + side}
    data-side={side} aria-label="Textures panel">
    {#if side !== 'float' && side !== 'tabs' &&
      (hidden || floating)}
      <button type="button" class="dock-rail" title="Restore Textures to this side"
        onclick={onRestore}>
        {floating ? 'Dock Textures' : 'Show Textures'}
      </button>
    {:else}
      {#if side !== 'tabs'}
      <div class="dock-title">
        <span>TEXTURES</span>
        {#if side !== 'float'}
          <div class="dock-controls">
            <button type="button" title="Move Textures to the opposite side"
              onclick={onMove}>Move</button>
            <button type="button" title="Float Textures in the editor"
              onclick={onFloat}>Float</button>
            <button type="button" title="Fold Textures panel"
              onclick={onFold}>Fold</button>
          </div>
        {/if}
      </div>
      {/if}

      {#if snapshot?.textureNames.length}
        <div class="texture-list">
          {#each snapshot.textureNames as name, index}
            <button type="button" class="texture-item" class:active={paintTextureIndex === index}
              aria-pressed={paintTextureIndex === index} title={name}
              disabled={selectionLocked} onclick={() => onSelectTexture(index)}>
              <span class="texture-square"></span><span>{name}</span><small>{index + 1}</small>
            </button>
          {/each}
        </div>
      {:else}
        <p class="empty-label">No textures</p>
      {/if}
      <p class="dock-note">Generated textures can be painted directly. Compatible imported RGBA8 PNGs may be enabled explicitly in Paint.</p>
   {/if}
  </aside>
