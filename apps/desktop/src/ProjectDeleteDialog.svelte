<script lang="ts">
  import { onMount } from 'svelte';
  import type { ProjectDeletePreview } from './projectNavigationTypes';

  export let review: ProjectDeletePreview;
  export let busy: boolean;
  export let onCancel: () => void;
  export let onConfirm: () => Promise<void>;
  let dialog: HTMLElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;

  onMount(() => { cancelButton?.focus(); });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab' && dialog) {
      const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
      if (controls.length > 0) {
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="project-delete-overlay">
  <div class="project-delete-dialog" role="alertdialog" aria-modal="true"
    aria-labelledby="project-delete-title" aria-describedby="project-delete-explanation"
    tabindex="-1" bind:this={dialog}>
    <h2 id="project-delete-title">Move project to Recycle Bin?</h2>
    <p id="project-delete-explanation">
      This will move the entire <strong>{review.project_name}</strong> folder to Windows Recycle Bin,
      including models, textures, references, exports and any other files inside.
    </p>
    <div class="project-delete-location">
      <strong>Folder to be moved</strong>
      <code>{review.folder_path}</code>
    </div>
    <p>Save your work and close every Blockbench window first. This operation does not permanently delete files,
      but recovery depends on Windows Recycle Bin settings.</p>
    <div class="project-delete-actions">
      <button class="secondary-button" bind:this={cancelButton} onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="project-delete-confirm" onclick={onConfirm} disabled={busy}>
        {busy ? 'Moving…' : 'Move to Recycle Bin'}
      </button>
    </div>
  </div>
</div>

<style>

  .project-delete-overlay{position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.72)}
  .project-delete-dialog{width:min(520px,100%);max-height:90vh;overflow:auto;display:grid;gap:14px;padding:22px;border:1px solid #765154;border-radius:12px;background:var(--bg-elevated);box-shadow:var(--shadow-popover)}
  .project-delete-dialog h2{margin:0;font-size:19px}
  .project-delete-dialog p{margin:0;color:var(--text-soft);font-size:var(--font-sm);line-height:1.55}
  .project-delete-location{display:grid;gap:6px;padding:12px;background:var(--surface-2);border-radius:7px;min-width:0}
  .project-delete-location strong{font-size:var(--font-sm)}
  .project-delete-location code{color:var(--text-soft);font-size:var(--font-sm);overflow-wrap:anywhere}
  .project-delete-actions{display:flex;justify-content:flex-end;gap:10px}
  .project-delete-confirm{min-height:34px;padding:6px 14px;border:1px solid #a34950;border-radius:6px;background:#8e373e;color:white;font-weight:700;cursor:pointer}
  .project-delete-confirm:hover:not(:disabled){background:#a2444c}
  .project-delete-confirm:disabled{opacity:.55;cursor:default}
</style>
