<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onMount } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';

  type SurfaceReceipt = {
    status: 'PRESENTED' | 'DETACHED' | 'DEFERRED' | 'UNAVAILABLE';
    note: string;
  };
  export let fixture = false;
  export let compact = false;

  let aperture: HTMLDivElement;
  let presented = false;
  let busy = false;
  let uncertain = false;
  let note = 'Blockbench stays an independent Windows application. No model files are changed.';
  let problem = '';
  let queued = false;
  let mounted = false;
  let layoutDirty = false;
  let unlistenLayout: UnlistenFn | undefined;

  function bounds() {
    const rect = aperture.getBoundingClientRect();
    return {
      x: rect.left, y: rect.top, width: rect.width, height: rect.height,
      pixel_ratio: window.devicePixelRatio,
    };
  }

  async function present() {
    if (fixture || busy || uncertain) return;
    busy = true;
    problem = '';
    try {
      const receipt = await invoke<SurfaceReceipt>('native_editor_surface', {
        action: 'present', viewport: bounds(),
      });
      if (receipt.status === 'PRESENTED') {
        presented = true;
        note = receipt.note;
      } else {
        note = receipt.note;
      }
    } catch (error) {
      // A partial native placement can require explicit recovery even when
      // the initial action had no success receipt.
      uncertain = true;
      problem = String(error);
    } finally {
      busy = false;
    }
  }

  async function update() {
    if (!mounted || !presented || busy || uncertain || fixture) return;
    busy = true;
    try {
      const receipt = await invoke<SurfaceReceipt>('native_editor_surface', {
        action: 'update', viewport: bounds(),
      });
      if (receipt.status === 'DETACHED') {
        presented = false;
        uncertain = false;
        problem = '';
        note = receipt.note;
      } else if (receipt.status === 'DEFERRED') {
        note = receipt.note;
      } else if (receipt.status !== 'PRESENTED') {
        uncertain = true;
        problem = receipt.note;
      }
    } catch (error) {
      uncertain = true;
      problem = String(error);
    } finally {
      busy = false;
      if (layoutDirty && presented && !uncertain) scheduleUpdate();
    }
  }

  function scheduleUpdate() {
    if (!mounted || !presented || uncertain || fixture) return;
    layoutDirty = true;
    if (busy || queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!mounted || !presented || uncertain || busy) return;
      layoutDirty = false;
      void update();
    });
  }

  // Parent navigation awaits restoration before hiding the Editor page.
  export async function detach(): Promise<boolean> {
    if (fixture || (!presented && !uncertain)) return true;
    if (busy) {
      problem = 'A native operation is still finishing. Use Detach again when it completes.';
      return false;
    }
    busy = true;
    try {
      const receipt = await invoke<SurfaceReceipt>('native_editor_surface', {
        action: 'detach', viewport: null,
      });
      if (receipt.status !== 'DETACHED') {
        problem = receipt.note;
        return false;
      }
      note = receipt.note;
      problem = '';
      uncertain = false;
      presented = false;
      return true;
    } catch (error) {
      problem = String(error);
      uncertain = true;
      return false;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    mounted = true;
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(aperture);
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('focus', scheduleUpdate);
    document.addEventListener('visibilitychange', scheduleUpdate);
    if (!fixture) {
      void listen('native-editor-layout', scheduleUpdate).then(unlisten => {
        if (mounted) unlistenLayout = unlisten;
        else unlisten();
      }).catch(() => { /* Native events are advisory, never a new admission route. */ });
    }
    return () => {
      mounted = false;
      observer.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('focus', scheduleUpdate);
      document.removeEventListener('visibilitychange', scheduleUpdate);
      unlistenLayout?.();
      unlistenLayout = undefined;
      // Normal app exit also restores synchronously in Rust. Unmount cleanup
      // must not issue a second placement or silently terminate Blockbench.
      if (!fixture && (presented || uncertain)) {
        void invoke('native_editor_surface', { action: 'detach', viewport: null }).catch(() => { /* Native exit path retains restoration ownership. */ });
      }
    };
  });
</script>

<section class="native-editor-page" class:compact aria-label="Native Blockbench window composition">
  <header class="native-editor-heading">
    <div>
      {#if compact}
        <div class="compact-title"><span class="native-surface-dot" aria-hidden="true"></span>Native window <span class="experimental">Development</span></div>
      {:else}
        <h2>Native Blockbench workspace <span class="experimental">Development preview</span></h2>
        <p>Original Blockbench · native Windows cutout · editing behavior not yet verified</p>
      {/if}
    </div>
    <div class="native-editor-actions">
      {#if presented || uncertain}
        <button class="secondary-button" disabled={busy || fixture} onclick={() => void detach()}>Detach &amp; restore window</button>
      {:else}
        <button class="primary-button" disabled={busy || fixture} onclick={present}>{busy ? 'Positioning…' : 'Show Blockbench here'}</button>
      {/if}
    </div>
  </header>
  {#if problem}
    <div class="native-editor-error" role="alert">
      <strong>Native presentation needs attention</strong>
      <span>{problem}</span>
      <span>Do not repeat placement if restoration is unverified. Use Detach to recover the original window.</span>
    </div>
  {/if}
  <div class="native-editor-aperture" bind:this={aperture} aria-label="Native Blockbench window placement area">
    <div class="native-placeholder">
      <span class="placeholder-icon">◇</span>
      <strong>{presented ? 'Window placement requested' : 'Blockbench editor area'}</strong>
      <p>{presented ? 'The original Blockbench window is independently controlled by Windows. Input is not yet verified.' : 'Open Blockbench, then place its native window in this workspace.'}</p>
    </div>
  </div>
  <footer class="native-editor-note" aria-live="polite">
    <span>{note}</span>
    <span>Native behavior unverified</span>
  </footer>
</section>

<style>
  .native-editor-page{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;padding:14px 18px 12px;gap:10px}
  .native-editor-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
  .native-editor-heading h2{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:0;font-size:var(--font-title)}
  .native-editor-heading p{margin:3px 0 0;color:var(--muted);font-size:var(--font-sm)}
  .experimental{display:inline-block;font-size:11px;color:var(--warning);font-weight:650;border:1px solid var(--border);border-radius:4px;padding:2px 5px}
  .native-editor-actions{display:flex;gap:6px}
  .native-editor-aperture{position:relative;flex:1;min-height:220px;border:1px solid var(--border-strong);border-radius:8px;background:#101216;display:grid;place-items:center}
  .native-placeholder{text-align:center;max-width:320px;padding:16px;color:var(--muted);pointer-events:none}
  .native-placeholder strong{display:block;color:var(--text-soft);font-weight:650}
  .native-placeholder p{margin-top:5px;font-size:var(--font-sm)}
  .placeholder-icon{display:block;font-size:28px;margin-bottom:6px;color:var(--surface-4)}
  .native-editor-note{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;color:var(--muted-2);font-size:var(--font-xs)}
  .native-editor-page.compact{
    padding:5px;gap:5px;background:var(--ed-bg,var(--bg));color:var(--ed-text,var(--text));
  }
  .native-editor-page.compact .native-editor-heading{
    min-height:30px;gap:8px;flex-wrap:wrap;padding:0 5px;
  }
  .native-editor-page.compact .native-editor-aperture{
    border:1px solid var(--ed-border,var(--border));border-radius:4px;
    background:#151922;min-height:220px;
  }
  .native-editor-page.compact .native-placeholder{max-width:290px}
  .native-editor-page.compact .native-placeholder strong{color:var(--ed-text,var(--text))}
  .native-editor-page.compact .native-placeholder p{color:var(--ed-muted,var(--muted))}
  .native-editor-page.compact .native-editor-actions button{
    min-height:28px;padding:4px 9px;border-radius:5px;
    background:var(--ed-raised,var(--surface-2));color:var(--ed-text,var(--text-soft));
    border:1px solid var(--ed-border,var(--border));font-size:11px;font-weight:650;
  }
  .native-editor-page.compact .native-editor-actions button:focus-visible{
    outline:2px solid var(--ed-accent,var(--info));outline-offset:1px;
  }
  .native-editor-page.compact .native-editor-note{
    gap:8px;min-height:21px;white-space:normal;color:var(--ed-muted-soft,var(--muted-2));
    font-size:10px;line-height:1.35;
  }
  .native-editor-page.compact .native-editor-note span:first-child{
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;
  }
  .native-editor-page.compact .experimental{font-size:10px;padding:1px 5px;color:#e1b65f;border-color:var(--ed-border,var(--border))}
  .compact-title{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:700}
  .native-surface-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ed-muted-soft,var(--muted-2));flex:none}
  .native-editor-error{display:flex;flex-wrap:wrap;gap:7px;padding:8px 10px;border:1px solid var(--warning);border-radius:7px;background:var(--warning-bg);font-size:var(--font-sm)}
  .native-editor-error strong{color:var(--warning)}
  @media(max-width:760px){.native-editor-page{padding:10px 12px}.native-editor-aperture{min-height:220px}}
</style>
