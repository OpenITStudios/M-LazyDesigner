<script lang="ts">
  // Preset *form* only: browser-local parameter storage and native Paint
  // authority remain in RustEditorPage, not this component.
  import type {BrushPreset} from './rustBrushPresets';
  export let busy:boolean;
  export let strokeActive:boolean;
  export let brushPresets:BrushPreset[];
  export let selectedBrushPresetId:string;
  export let brushPresetName:string;
  export let brushPresetError:string;
  export let applyBrushPreset:()=>void;
  export let saveBrushPreset:()=>void;
  export let deleteBrushPreset:()=>void;
</script>

<details class="brush-presets">
              <summary>Brush presets</summary>
              <div class="brush-presets-fields">
                <label>Saved preset
                  <select bind:value={selectedBrushPresetId} disabled={busy}>
                    <option value="">Choose preset…</option>
                    {#each brushPresets as preset (preset.id)}
                      <option value={preset.id}>{preset.name}</option>
                    {/each}
                  </select>
                </label>
                <button type="button" disabled={busy || !selectedBrushPresetId}
                  onclick={applyBrushPreset}>Apply preset</button>
                <label>Preset name
                  <input type="text" maxlength="80" bind:value={brushPresetName}
                    placeholder="e.g. Soft highlight" disabled={busy}/>
                </label>
                <button type="button" disabled={busy || strokeActive}
                  onclick={saveBrushPreset}>Save / Update</button>
                <button type="button" disabled={busy || !selectedBrushPresetId}
                  onclick={deleteBrushPreset}>Delete preset</button>
              </div>
              <p class="hint">Saved locally: brush, Shade Ink and pattern settings only.
                No image, Cube identity, selection or Paint permission is stored.</p>
              {#if brushPresetError}<p class="hint" role="status">{brushPresetError}</p>{/if}
            </details>

<style>
  .brush-presets label {display:flex;align-items:center;gap:8px;font-size:12px}
</style>
