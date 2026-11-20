<script lang="ts">
  // Read-only presentation: no capability creator or mutation permission.
  export let pairing:{pipe:string;token:string;epoch:number;protocol:number};
  export let revealSecret:boolean;
  export let onKeepPaired:()=>void;
  export let onDisconnect:()=>void;
</script>
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="dialog" aria-modal="true"
      aria-labelledby="live-read-title">
      <h2 id="live-read-title">Read-only Code Mode pairing</h2>
      <p>This pairing reads only the active Rust model's identity and small
        semantic pages. It cannot edit the model or grant authoring permission.
        Pass these values only to your trusted local agent host.</p>
      <label for="live-read-pipe">Local Windows pipe</label>
      <input id="live-read-pipe" type="text" readonly value={pairing.pipe}
        autocomplete="off" spellcheck="false"/>
      <label for="live-read-token">Private pairing capability</label>
      <input id="live-read-token" type={revealSecret ? 'text' : 'password'}
        readonly value={pairing.token} autocomplete="off" spellcheck="false"/>
      <label class="live-read-reveal"><input type="checkbox" bind:checked={revealSecret}/>
        Show pairing capability</label>
      <p class="hint">Bound to editor epoch {pairing.epoch}. Read access
        expires after at most 15 minutes; the UI attempts to disconnect
        earlier. New/Open/Restore invalidates the old binding. The standard
        build does not provide this experimental bridge.</p>
      <div class="dialog-buttons">
        <button type="button" onclick={() => onKeepPaired()}>Keep paired</button>
        <button type="button" class="danger" onclick={() => onDisconnect()}>
          Disconnect
        </button>
      </div>
    </section>
  </div>

<style>
  .live-read-reveal {display:flex;align-items:center;gap:8px;}
  #live-read-pipe, #live-read-token {width:100%;font-family:monospace;}
</style>
