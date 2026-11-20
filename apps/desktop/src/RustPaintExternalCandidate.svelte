<script lang="ts">
  // Source-bound external PNG review presentation; no native authority.
  import type {EditorSnapshot} from './rustEditorTypes';
  import type {ReviewViewId} from './rustReviewCapture';
  import type {ExternalFaceTextureDraft} from './rustExternalTexturePreview';
  export let snapshot:EditorSnapshot;
  export let busy:boolean;
  export let loading:boolean;
  export let strokeActive:boolean;
  export let selectedId:string|null;
  export let paintTextureIndex:number;
  export let faces:readonly string[];
  export let selectedFace:string;
  export let externalBase:string;
  export let validExternalPreview:boolean;
  export let externalPreview:ExternalFaceTextureDraft|null;
  export let externalSourceCapture:string|null;
  export let externalCandidateCapture:string|null;
  export let externalCapturedView:ReviewViewId|null;
  export let externalViewedSource:boolean;
  export let externalViewedCandidate:boolean;
  export let externalReviewed:boolean;
  export let externalReadyForApply:boolean;
  export let matchedRenders:boolean;
  export let clearSemanticPreview:()=>void;
  export let clearExternalPreview:()=>void;
  export let chooseExternalTextureCandidate:()=>Promise<void>;
  export let showExternalTextureCandidate:(value:boolean)=>Promise<void>;
  export let applyExternalTextureCandidate:()=>Promise<void>;
</script>

<section class="paint-starter semantic-material-panel" aria-label="External pixel editor PNG">
        <div class="dock-title"><span>EXTERNAL PIXEL EDITOR</span></div>
        <p class="hint">Export the current atlas PNG and edit it in Aseprite,
          Pixelorama, Photoshop or Krita. Reimport as a disposable candidate
          for one explicitly mapped, non-shared Cube face. Only the selected
          original base RGB may change; alpha and other original details cannot.</p>
        <div class="semantic-material-fields">
          <label>Face
            <select bind:value={selectedFace} disabled={busy || strokeActive}
              onchange={clearSemanticPreview}>
              {#each faces as face}<option value={face}>{face}</option>{/each}
            </select>
          </label>
          <label>Original editable RGB
            <input type="color" bind:value={externalBase}
              disabled={busy || strokeActive} onchange={clearExternalPreview}/>
          </label>
        </div>
        <button type="button" disabled={busy || loading || strokeActive ||
            !selectedId || !snapshot.paintEditableTextures[paintTextureIndex] ||
            !snapshot.texturePreviewSources[paintTextureIndex]}
          onclick={() => void chooseExternalTextureCandidate()}>
          Choose edited PNG…
        </button>
        {#if validExternalPreview}
          <p class="hint">Selected PNG {externalPreview?.selectedPngSha256.slice(0,12)}
            · model unchanged. Capture both renders using the same fixed camera.</p>
          <div class="semantic-material-actions" role="group" aria-label="External PNG comparison">
            <button type="button" disabled={busy}
              onclick={() => void showExternalTextureCandidate(false)}>Capture Source</button>
            <button type="button" disabled={busy}
              onclick={() => void showExternalTextureCandidate(true)}>Capture Candidate</button>
            <button type="button" disabled={busy}
              onclick={clearExternalPreview}>Discard</button>
          </div>
          {#if externalSourceCapture || externalCandidateCapture}
            <div class="semantic-material-comparison" aria-label="External PNG source candidate renders">
              {#if externalSourceCapture}
                <figure><img src={externalSourceCapture} draggable="false"
                  alt={'Source at '+externalCapturedView}/>
                  <figcaption>Source · {externalCapturedView}</figcaption></figure>
              {/if}
              {#if externalCandidateCapture}
                <figure><img src={externalCandidateCapture} draggable="false"
                  alt={'External PNG candidate at '+externalCapturedView}/>
                  <figcaption>Candidate · {externalCapturedView}</figcaption></figure>
              {/if}
            </div>
          {/if}
          <label class="semantic-material-review">
            <input type="checkbox" bind:checked={externalReviewed}
              disabled={busy || !externalViewedSource || !externalViewedCandidate ||
                !matchedRenders}/>
            I compared the matching renders and checked existing markings.
          </label>
          <button type="button" disabled={busy || !externalReadyForApply}
            onclick={() => void applyExternalTextureCandidate()}>Apply reviewed external PNG</button>
          <p class="hint">RGBA8 PNG must have the exact atlas dimensions. Marks
            with the same base RGB cannot be recognized automatically; preserve
            them before acknowledging the comparison.</p>
        {/if}
      </section>

<style>
  .paint-starter { display: grid; gap: 8px; padding: 10px; border-top: 1px solid #374151; }
  .paint-starter label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .paint-starter select { min-width: 0; max-width: 100%; flex: 1; }
</style>
