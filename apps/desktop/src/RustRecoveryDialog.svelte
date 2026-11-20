<script lang="ts">
  // Presentation only; recovery authority/epoch stay in the parent Tauri flow.
  export let entries:Array<{id:string;revision:number;modifiedUnixMs:number;sizeBytes:number}>;
  export let selectedId:string;
  export let discardApproved:boolean;
  export let busy:boolean;
  export let dirty:boolean;
  export let onCancel:()=>void;
  export let onRestore:()=>void;
</script>
{#if recoveryDialog}
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="dialog" aria-modal="true"
      aria-labelledby="recovery-title">
      <h2 id="recovery-title">Recover unsaved Rust model</h2>
      <p>Private checkpoints are recovery candidates, not verified saves.
        Recovery opens a separate unsaved model. Save Copy afterward.</p>
      {#if entries.length}
        <label for="recovery-select">Available checkpoint</label>
        <select id="recovery-select" bind:value={selectedId}
          disabled={busy}>
          {#each entries as entry (entry.id)}
            <option value={entry.id}>
              {new Date(entry.modifiedUnixMs).toLocaleString()} · revision {entry.revision} · {Math.ceil(entry.sizeBytes / 1024)} KiB
            </option>
          {/each}
        </select>
        {#if dirty}
          <label class="recovery-discard">
            <input type="checkbox" bind:checked={discardApproved}/>
            Discard current unsaved edits to open the selected checkpoint
          </label>
        {/if}
      {:else}
        <p>No private recovery checkpoints were found.</p>
      {/if}
      <div class="dialog-buttons">
        <button type="button" onclick={() => onCancel()}>Cancel</button>
        <button type="button" class="primary"
          disabled={busy || !selectedId || (dirty && !discardApproved)}
          onclick={() => onRestore()}>Recover as unsaved</button>
      </div>
    </section>
  </div>

<style>
  .recovery-discard {display:flex;gap:8px;align-items:flex-start;margin-top:12px;}
  .recovery-discard input {flex:none;}
  #recovery-select {width:100%;min-width:0;}
</style>
