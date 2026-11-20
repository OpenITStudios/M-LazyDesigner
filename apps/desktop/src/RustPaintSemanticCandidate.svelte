<script lang="ts">
  // Source-bound material candidate presentation; parent owns approval and model.
  import type {EditorSnapshot} from './rustEditorTypes';
  import type {ReviewViewId} from './rustReviewCapture';
  import type {SemanticMaterialIntent,SemanticRejectReason} from './rustSemanticMaterialPreview';
  export let snapshot:EditorSnapshot;
  export let busy:boolean;
  export let loading:boolean;
  export let strokeActive:boolean;
  export let selectedId:string|null;
  export let paintTextureIndex:number;
  export let faces:readonly string[];
  export let selectedFace:string;
  export let semanticReferenceStatus:string;
  export let semanticReferenceImage:string|null;
  export let semanticReferenceSha:string|null;
  export let semanticBase:string;
  export let semanticShadow:string;
  export let semanticHighlight:string;
  export let semanticCorner:SemanticMaterialIntent['light_corner'];
  export let semanticContrast:SemanticMaterialIntent['contrast'];
  export let semanticRejectionNote:string;
  export let validSemanticPreview:boolean;
  export let semanticShowCandidate:boolean;
  export let semanticRejectReason:SemanticRejectReason;
  export let semanticSourceCapture:string|null;
  export let semanticCandidateCapture:string|null;
  export let semanticCapturedView:ReviewViewId|null;
  export let semanticViewedSource:boolean;
  export let semanticViewedCandidate:boolean;
  export let semanticReviewed:boolean;
  export let semanticReadyForApply:boolean;
  export let clearSemanticPreview:()=>void;
  export let chooseSemanticReference:()=>Promise<void>;
  export let previewSemanticMaterial:()=>Promise<void>;
  export let showSemanticCandidate:(value:boolean)=>Promise<void>;
  export let rejectSemanticCandidate:()=>void;
  export let applySemanticCandidate:()=>Promise<void>;
</script>

<section class="paint-starter semantic-material-panel" aria-label="Semantic painted-metal candidate">
        <div class="dock-title"><span>SEMANTIC PAINTED METAL</span></div>
        <p class="hint">Source-aware candidate only. Select a reference PNG and the actual
          Cube, face, base RGB and approved shade colors; the reference is not automatically verified.</p>
        <button type="button" disabled={busy || loading || strokeActive}
          onclick={() => void chooseSemanticReference()}>Choose reference PNG…</button>
        {#if semanticReferenceStatus}<p class="hint">{semanticReferenceStatus}</p>{/if}
        {#if semanticReferenceImage}
          <img class="semantic-material-reference"
            src={semanticReferenceImage} draggable="false"
            alt="User-selected material reference; artistic approval is not verified"/>
        {/if}
        <div class="semantic-material-fields">
          <label>Face
            <select bind:value={selectedFace} disabled={busy || strokeActive}
              onchange={clearSemanticPreview}>
              {#each faces as face}<option value={face}>{face}</option>{/each}
            </select>
          </label>
          <label>Base RGB <input type="color" bind:value={semanticBase}
            disabled={busy || strokeActive} onchange={clearSemanticPreview}/></label>
          <label>Shadow RGB <input type="color" bind:value={semanticShadow}
            disabled={busy || strokeActive} onchange={clearSemanticPreview}/></label>
          <label>Highlight RGB <input type="color" bind:value={semanticHighlight}
            disabled={busy || strokeActive} onchange={clearSemanticPreview}/></label>
          <label>Light corner
            <select bind:value={semanticCorner} disabled={busy || strokeActive}
              onchange={clearSemanticPreview}>
              <option value="upper_left">Upper left</option>
              <option value="upper_right">Upper right</option>
            </select>
          </label>
          <label>Contrast
            <select bind:value={semanticContrast} disabled={busy || strokeActive}
              onchange={clearSemanticPreview}>
              <option value="subtle">Subtle</option>
              <option value="balanced">Balanced</option>
            </select>
          </label>
        </div>
        {#if semanticRejectionNote}<p class="hint">{semanticRejectionNote}</p>{/if}
        <button type="button" disabled={busy || loading || strokeActive ||
          !selectedId || !semanticReferenceSha ||
          !snapshot.paintEditableTextures[paintTextureIndex]}
          onclick={() => void previewSemanticMaterial()}>Preview material</button>
        {#if validSemanticPreview}
          <div class="semantic-material-actions" role="group" aria-label="Capture matched material comparison">
            <button type="button" aria-pressed={!semanticShowCandidate}
              disabled={busy} onclick={() => void showSemanticCandidate(false)}>Capture Source</button>
            <button type="button" aria-pressed={semanticShowCandidate}
              disabled={busy} onclick={() => void showSemanticCandidate(true)}>Capture Candidate</button>
            <button type="button" disabled={busy} onclick={clearSemanticPreview}>Discard</button>
          </div>
          <label>Reason if rejected
            <select bind:value={semanticRejectReason} disabled={busy}>
              <option value="flat_volume">Flat or poorly formed shading</option>
              <option value="identity_risk">Approved identity at risk</option>
              <option value="style_mismatch">Material/style mismatch</option>
              <option value="other">Other visual defect</option>
            </select>
          </label>
          <button type="button" disabled={busy}
            onclick={rejectSemanticCandidate}>Reject and revise</button>
          <p class="hint">Use the camera selector above, then capture Source and
            Candidate at that same fixed view. The capture refuses unloaded
            textures; if an image is still loading, retry its button.
            Rejected exact treatments cannot be repeated unchanged.</p>
          {#if semanticSourceCapture || semanticCandidateCapture}
            <div class="semantic-material-comparison" aria-label="Matched fixed-camera source and candidate">
              {#if semanticSourceCapture}
                <figure><img src={semanticSourceCapture} draggable="false"
                  alt={'Original Rust preview at ' + semanticCapturedView}/>
                  <figcaption>Source · {semanticCapturedView}</figcaption></figure>
              {/if}
              {#if semanticCandidateCapture}
                <figure><img src={semanticCandidateCapture} draggable="false"
                  alt={'Candidate Rust preview at ' + semanticCapturedView}/>
                  <figcaption>Candidate · {semanticCapturedView}</figcaption></figure>
              {/if}
            </div>
          {/if}
          {#if semanticSourceCapture && semanticCandidateCapture &&
            semanticSourceCapture===semanticCandidateCapture}
            <p class="hint">No rendered difference from this camera.
              Choose a view showing the selected face and capture both again.</p>
          {/if}
          <label class="semantic-material-review">
            <input type="checkbox" bind:checked={semanticReviewed}
              disabled={busy || !semanticViewedSource || !semanticViewedCandidate}/>
            I compared both fixed-camera captures with the selected reference and checked visible identity markings.
          </label>
          <button type="button" disabled={busy || !semanticReadyForApply}
            onclick={() => void applySemanticCandidate()}>Apply inspected candidate</button>
          <p class="hint">This is a user-selected treatment, not an independent artistic PASS.
            Full-face review remains required.</p>
        {/if}
      </section>

<style>
  .paint-starter { display: grid; gap: 8px; padding: 10px; border-top: 1px solid #374151; }
  .paint-starter label { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .paint-starter select { min-width: 0; max-width: 100%; flex: 1; }
</style>
