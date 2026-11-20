<script lang="ts">
  // UI-only control surface: no saved model, independent bitmap, Tauri
  // authority, preview verdict or persistent brush settings are held here.
  import RustBrushPresetControls from './RustBrushPresetControls.svelte';
  import type {BrushPreset,PatternMode} from './rustBrushPresets';
  import type {SelectionMode,ShadeDirection} from './rustSurfaceTools';
  export let busy:boolean;
  export let loading:boolean;
  export let strokeActive:boolean;
  export let selectionDragging:boolean;
  export let candidatePending:boolean;
  export let surfacePatternReady:boolean;
  export let surfacePaintEnabled:boolean;
  export let validSurfaceSelection:boolean;
  export let shadeRampValid:boolean;
  export let stencilActive:boolean;
  export let protectedRegionCount:number;
  export let selectionPixelCount:number;
  export let surfaceSampleStatus:string;
  export let brushPresets:BrushPreset[];
  export let brushPresetError:string;
  export let applyBrushPreset:()=>void;
  export let saveBrushPreset:()=>void;
  export let deleteBrushPreset:()=>void;
  export let invertSurfaceSelection:()=>Promise<void>;
  export let clearSurfaceSelection:()=>void;
  export let clearSurfaceProtection:()=>void;
  export let surfacePaint3d:boolean;
  export let surfaceBrushRadius:number;
  export let surfaceBrushTip:'square'|'diamond';
  export let surfacePatternMode:PatternMode;
  export let surfacePatternPeriod:number;
  export let surfacePatternPhaseX:number;
  export let surfacePatternPhaseY:number;
  export let selectedBrushPresetId:string;
  export let brushPresetName:string;
  export let surfaceGrayscalePreview:boolean;
  export let surfaceSampleMode:boolean;
  export let surfaceSelectMode:boolean;
  export let surfaceSelectOperation:Exclude<SelectionMode,'invert'>;
  export let surfaceInkMode:'color'|'shade_ink';
  export let surfaceShadeDirection:ShadeDirection;
  export let surfaceShadeRamp:string;
  export let surfaceSeamEnabled:boolean;
  export let surfaceSourceBase:string;
  export let surfaceProtectMode:boolean;
</script>

<div class="surface-paint-panel" aria-label="Source-bound 3D pixel painting">
            <label><input type="checkbox" bind:checked={surfacePaint3d}
              disabled={busy || loading || strokeActive || selectionDragging}/>
              Paint directly on 3D Cube</label>
            <label>Brush radius
              <input type="number" min="1" max="4" step="1"
                bind:value={surfaceBrushRadius}
                disabled={busy || strokeActive || selectionDragging}/>
            </label>
            <label>Brush tip
              <select bind:value={surfaceBrushTip}
                disabled={busy || strokeActive || selectionDragging}>
                <option value="square">Square</option>
                <option value="diamond">Diamond</option>
              </select>
            </label>
            <label>Pattern stencil
              <select bind:value={surfacePatternMode}
                disabled={busy || strokeActive || selectionDragging}>
                <option value="none">Solid (no pattern)</option>
                <option value="checker">Checker</option>
                <option value="dots">Dots</option>
                <option value="diagonal">Diagonal</option>
              </select>
            </label>
            {#if surfacePatternMode!=='none'}
              <label>Period (texels)
                <input type="number" min="1" step="1"
                  bind:value={surfacePatternPeriod}
                  disabled={busy || strokeActive || selectionDragging}/>
              </label>
              <label>Offset X
                <input type="number" min="0" step="1"
                  bind:value={surfacePatternPhaseX}
                  disabled={busy || strokeActive || selectionDragging}/>
              </label>
              <label>Offset Y
                <input type="number" min="0" step="1"
                  bind:value={surfacePatternPhaseY}
                  disabled={busy || strokeActive || selectionDragging}/>
              </label>
              {#if !surfacePatternReady}
                <p class="hint">Pattern requires whole-number period and offsets.</p>
              {/if}
            {/if}
            <RustBrushPresetControls {busy} {strokeActive} {brushPresets}
              bind:selectedBrushPresetId bind:brushPresetName {brushPresetError}
              {applyBrushPreset} {saveBrushPreset} {deleteBrushPreset} />
            <label><input type="checkbox" bind:checked={surfaceGrayscalePreview}
              disabled={busy || !surfacePaint3d}/>
              Grayscale viewport (read-only)</label>
            <label><input type="checkbox" bind:checked={surfaceSampleMode}
              onchange={() => {if(surfaceSampleMode)surfaceSelectMode=false;}}
              disabled={busy || !surfacePaint3d || selectionDragging}/>
              Pick original RGB from 3D (Rust)</label>
            <label><input type="checkbox" bind:checked={surfaceSelectMode}
              onchange={() => {if(surfaceSelectMode)surfaceSampleMode=false;}}
              disabled={busy || !surfacePaint3d || selectionDragging}/>
              Magic Wand: select connected source color</label>
            <label>Selection operation
              <select bind:value={surfaceSelectOperation} disabled={busy || !surfacePaint3d}>
                <option value="replace">Replace</option>
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
                <option value="intersect">Intersect</option>
              </select>
            </label>
            <button type="button" onclick={() => void invertSurfaceSelection()}
              disabled={busy || !validSurfaceSelection}>Invert within Cube face</button>
            <p class="hint">Add, Subtract and Intersect use another original-color
              island on the same Cube face. Invert works only inside that face.
              Rust recomputes the selection from original pixels at Apply.</p>
            {#if validSurfaceSelection}
              <button type="button" onclick={clearSurfaceSelection}
                disabled={busy || selectionDragging}>
                Clear connected selection ({selectionPixelCount} px)
              </button>
            {/if}
            <label>3D ink mode
              <select bind:value={surfaceInkMode}
                disabled={busy || strokeActive || selectionDragging}>
                <option value="color">Opaque original-color Pencil</option>
                <option value="shade_ink">Shade Ink (exact palette steps)</option>
              </select>
            </label>
            {#if surfaceInkMode==='shade_ink'}
              <label>Shade direction
                <select bind:value={surfaceShadeDirection}
                  disabled={busy || selectionDragging}>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                </select>
              </label>
              <label class="surface-ramp-field">Artist shade ramp
                (darkest to lightest, comma-separated)
                <textarea rows="2" bind:value={surfaceShadeRamp}
                  placeholder="#202a3b, #445870, #8297b0, #c5d8ed"
                  disabled={busy || selectionDragging}></textarea>
              </label>
              <p class="hint">Ramp is artist-supplied, not quantized. Each
                eligible pixel moves exactly one swatch per gesture. Other
                colors remain unchanged. No fixed palette-count limit.</p>
              {#if !shadeRampValid}
                <p class="hint">Enter two or more unique #RRGGBB swatches
                  to enable Shade Ink painting.</p>
              {/if}
            {/if}
            <label><input type="checkbox" bind:checked={surfaceSeamEnabled}
              disabled={busy || !surfacePaint3d || selectionDragging ||
                surfaceInkMode==='shade_ink' || validSurfaceSelection || stencilActive}/>
              Bridge adjacent Cube faces (one Undo)</label>
            <label>Original editable RGB
              <input type="color" bind:value={surfaceSourceBase}
                disabled={busy || strokeActive || selectionDragging}/>
            </label>
            <label><input type="checkbox" bind:checked={surfaceProtectMode}
              disabled={busy || strokeActive || selectionDragging ||
                candidatePending}/>
              Mark protected rectangle on atlas</label>
            <button type="button" onclick={clearSurfaceProtection}
              disabled={busy || selectionDragging || !protectedRegionCount}>
              Clear protected areas ({protectedRegionCount})
            </button>
            <p class="hint">Brushes remain hard pixel clusters with radius 1–4.
              All color changes use the exact original opaque RGBA from Rust;
              other original colors, identity masks, alpha and shared UV are
              protected. Optional two-face bridging only applies to adjacent
              coplanar Cube faces in the same Bone and atlas; an unsupported
              seam aborts the gesture. No automatic material generation.</p>
            {#if surfaceSampleStatus}
              <p class="hint" role="status">{surfaceSampleStatus}</p>
            {/if}
            {#if surfacePaint3d && !surfacePaintEnabled}
              <p class="hint">3D Paint needs the Pencil tool, an editable
                texture, opaque Alpha (255), no preview candidate, and an idle
                Rust session. If the eager atlas preview was omitted, load
                the selected atlas above without loading every PNG.</p>
            {/if}
          </div>

<style>
  /* Preserve the original parent-scoped Paint label presentation. */
  .surface-paint-panel label {display:flex;align-items:center;gap:8px;font-size:12px}
</style>
