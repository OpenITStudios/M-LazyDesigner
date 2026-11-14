<script lang="ts">
  import './rust-editor.css';
  import { invoke } from '@tauri-apps/api/core';
  import { onMount, tick } from 'svelte';
  import RustViewport from './RustViewport.svelte';
  import type { CubeView, EditorSnapshot, EditOperation, HierarchyNode, Vec3, Vec4 } from './rustEditorTypes';

  export let onLegacy: () => void = () => {};
  type Menu = 'file' | 'edit' | 'view' | null;
  type Row = { uuid: string; name: string; depth: number; kind: 'cube' | 'bone' };

  let snapshot: EditorSnapshot | null = null;
  let selectedId: string | null = null;
  let selectedBoneId: string | null = null;
  let selectedFace = 'north';
  let menu: Menu = null;
  let loading = true;
  let busy = false;
  let error = '';
  let notice = '';
  let newDialog = false;
  let newName = 'New Model';
  let allowDiscard = false;
  let confirmDiscard: 'new' | 'open' | null = null;
  let collapsed = new Set<string>();
  let nameInput: HTMLInputElement;
  let discardCancel: HTMLButtonElement;
  let viewport: { frameModel: () => void } | undefined;

  const AXES = ['X', 'Y', 'Z'] as const;
  const FACES = ['north', 'east', 'south', 'west', 'up', 'down'] as const;

  function makeRows(nodes: HierarchyNode[], cubes: CubeView[], folded: Set<string>): Row[] {
    const cubeNames = new Map(cubes.map((cube) => [cube.uuid, cube.name] as const));
    const boneNames = new Map((snapshot?.bones ?? []).map((bone) => [bone.uuid, bone.name] as const));
    const rows: Row[] = [];
    function walk(items: HierarchyNode[], depth: number) {
      for (const item of items) {
        if (typeof item === 'string') {
          rows.push({ uuid: item, name: cubeNames.get(item) ?? 'Cube', depth, kind: 'cube' });
        } else {
          rows.push({ uuid: item.uuid, name: boneNames.get(item.uuid) ?? 'Bone', depth, kind: 'bone' });
          if (!folded.has(item.uuid)) walk(item.children, depth + 1);
        }
      }
    }
    walk(nodes, 0);
    return rows;
  }

  $: selectedCube = snapshot?.cubes.find((cube) => cube.uuid === selectedId) ?? null;
  $: rows = makeRows(snapshot?.hierarchy ?? [], snapshot?.cubes ?? [], collapsed);
  $: faceUv = selectedCube?.faces[selectedFace]?.uv ?? [0, 0, 0, 0];

  function closeMenus() { menu = null; }
  function outsideClick(event: MouseEvent) {
    if (menu && event.target instanceof Element && !event.target.closest('.rust-menu-bar')) closeMenus();
  }
  function selectCube(id: string | null) {
    selectedId = id;
    selectedBoneId = null;
  }
  function toggleBone(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }
  function selectRow(row: Row) {
    if (row.kind === 'cube') selectCube(row.uuid);
    else { selectedId = null; selectedBoneId = row.uuid; }
  }
  function showError(cause: unknown) {
    if (cause && typeof cause === 'object' && 'message' in cause &&
        typeof cause.message === 'string') error = cause.message;
    else if (typeof cause === 'string') error = cause;
    else error = 'The native authoring operation could not be completed.';
  }
  function accept(next: EditorSnapshot) {
    snapshot = next;
    if (selectedId && !next.cubes.some((cube) => cube.uuid === selectedId)) selectedId = null;
    if (selectedBoneId && !next.bones.some((bone) => bone.uuid === selectedBoneId)) selectedBoneId = null;
    notice = '';
  }
  async function command(name: string, args: Record<string, unknown>): Promise<EditorSnapshot | null> {
    if (busy) return null;
    busy = true; closeMenus(); error = '';
    try {
      const next = await invoke<EditorSnapshot>(name, args);
      accept(next);
      return next;
    } catch (cause) { showError(cause); return null; }
    finally { busy = false; }
  }
  async function load() {
    loading = true;
    try {
      const model = await invoke<EditorSnapshot | null>('rust_editor_snapshot');
      if (model) accept(model);
      else snapshot = null;
    } catch (cause) { showError(cause); }
    finally { loading = false; }
  }
  async function beginNew(discard = false) {
    allowDiscard = discard;
    newDialog = true;
    newName = 'New Model';
    closeMenus();
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }
  async function commitNew() {
    if (!newName.trim()) { error = 'Enter a model name.'; return; }
    const next = await command('rust_editor_new', {
      name: newName, expectedEpoch: snapshot?.epoch ?? 0, discard: allowDiscard,
    });
    if (next) {
      selectedId = null; selectedBoneId = null;
      newDialog = false; allowDiscard = false;
      await tick(); viewport?.frameModel();
    }
  }
  async function openModel(discard = false) {
    if (busy) return;
    busy = true; closeMenus(); error = '';
    try {
      const model = await invoke<EditorSnapshot | null>('rust_editor_open', {
        expectedEpoch: snapshot?.epoch ?? 0, discard,
      });
      if (model) {
        selectedId = null; selectedBoneId = null;
        accept(model); await tick(); viewport?.frameModel();
      }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  function requestNew() {
    if (loading || busy) return;
    if (snapshot?.dirty) {
      confirmDiscard = 'new';
      void tick().then(() => discardCancel?.focus());
    } else void beginNew();
    closeMenus();
  }
  function requestOpen() {
    if (loading || busy) return;
    if (snapshot?.dirty) {
      confirmDiscard = 'open';
      void tick().then(() => discardCancel?.focus());
    } else void openModel();
    closeMenus();
  }
  function discardAndContinue() {
    const action = confirmDiscard; confirmDiscard = null;
    if (action === 'new') void beginNew(true);
    if (action === 'open') void openModel(true);
  }
  async function saveCopy() {
    if (!snapshot || busy) return;
    busy = true; closeMenus(); error = '';
    try {
      const next = await invoke<EditorSnapshot | null>('rust_editor_save_copy', {
        expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
      });
      if (next) { accept(next); notice = 'Saved a new .bbmodel copy without overwriting the original.'; }
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  function apply(operations: EditOperation[]) {
    if (!snapshot) return;
    void command('rust_editor_apply', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision, operations,
    });
  }
  async function addCube() {
    if (!snapshot) return;
    const previous = new Set(snapshot.cubes.map((cube) => cube.uuid));
    const next = await command('rust_editor_add_cube', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision, parentUuid: selectedBoneId,
    });
    if (next) {
      selectedId = next.cubes.find((cube) => !previous.has(cube.uuid))?.uuid ?? null;
      selectedBoneId = null;
      await tick(); viewport?.frameModel();
    }
  }
  function history(direction: 'undo' | 'redo') {
    if (!snapshot) return;
    void command(direction === 'undo' ? 'rust_editor_undo' : 'rust_editor_redo', {
      expectedEpoch: snapshot.epoch, expectedRevision: snapshot.revision,
    });
  }
  function position(axis: number, text: string) {
    if (!selectedCube) return;
    const value = Number(text);
    if (!Number.isFinite(value)) { error = 'Enter a finite coordinate.'; return; }
    const delta: Vec3 = [0, 0, 0];
    delta[axis] = value - selectedCube.from[axis];
    if (delta[axis] !== 0) apply([{ op: 'translate_cube', uuid: selectedCube.uuid, delta }]);
  }
  function size(axis: number, text: string) {
    if (!selectedCube) return;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) { error = 'Size must be greater than zero.'; return; }
    const to = [...selectedCube.to] as Vec3;
    to[axis] = selectedCube.from[axis] + value;
    apply([{ op: 'set_cube_bounds', uuid: selectedCube.uuid, from: selectedCube.from, to }]);
  }
  function uvEdit(index: number, text: string) {
    if (!selectedCube || selectedCube.boxUv) return;
    const value = Number(text);
    if (!Number.isFinite(value)) { error = 'Enter a finite UV coordinate.'; return; }
    const uv = [...faceUv] as Vec4; uv[index] = value;
    apply([{ op: 'set_face_uv', uuid: selectedCube.uuid, face: selectedFace, uv }]);
  }
  function hotkeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (confirmDiscard) confirmDiscard = null;
      else if (newDialog) newDialog = false;
      closeMenus(); return;
    }
    if (newDialog || confirmDiscard) {
      if (event.key === 'Tab') {
        const container = document.querySelector<HTMLElement>('.rust-modal-backdrop');
        const focusables = Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault(); first.focus();
        }
      }
      return;
    }
    if (busy || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); requestNew(); }
    if (key === 'o') { event.preventDefault(); requestOpen(); }
    if (key === 's' && event.shiftKey) { event.preventDefault(); void saveCopy(); }
    if (key === 'z') {
      event.preventDefault();
      history(event.shiftKey ? 'redo' : 'undo');
    }
    if (key === 'y') { event.preventDefault(); history('redo'); }
  }
  onMount(() => { void load(); });
</script>

<svelte:window onkeydown={hotkeys} onclick={outsideClick}/>

<div class="rust-editor" aria-label="LazyDesigner Rust native editor">
  <header class="rust-titlebar">
    <nav class="rust-menu-bar" aria-label="Editor menu">
      {#each ['file', 'edit', 'view'] as item}
        <div class="menu-holder">
          <button class="menubar-button" aria-expanded={menu === item}
            onclick={() => menu = menu === item ? null : item as Menu}>
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
          {#if menu === item}
            <div class="menu-popup" role="menu">
              {#if item === 'file'}
                <button role="menuitem" onclick={requestNew} disabled={busy || loading}>New Model <kbd>Ctrl+N</kbd></button>
                <button role="menuitem" onclick={requestOpen} disabled={busy || loading}>Open Model… <kbd>Ctrl+O</kbd></button>
                <button role="menuitem" onclick={() => void saveCopy()} disabled={!snapshot || busy}>Save Copy… <kbd>Ctrl+Shift+S</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => { closeMenus(); onLegacy(); }}>Legacy Workspace</button>
              {:else if item === 'edit'}
                <button role="menuitem" onclick={() => history('undo')} disabled={!snapshot?.canUndo || busy}>Undo <kbd>Ctrl+Z</kbd></button>
                <button role="menuitem" onclick={() => history('redo')} disabled={!snapshot?.canRedo || busy}>Redo <kbd>Ctrl+Y</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => void addCube()} disabled={!snapshot || busy}>Add Cube</button>
              {:else}
                <button role="menuitem" disabled={!snapshot || busy} onclick={() => { viewport?.frameModel(); closeMenus(); }}>Frame Model</button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </nav>
    <div class="document-name" title={snapshot?.sourceName ?? snapshot?.name ?? 'No active model'}>
      {snapshot?.name ?? 'LazyDesigner'}{#if snapshot?.dirty}<span aria-label="Unsaved changes"> •</span>{/if}
    </div>
    <div class="mode-tabs" role="group" aria-label="Editor mode">
      <span class="mode active" aria-current="page">Edit</span>
      <button class="mode" disabled title="Paint mode is not implemented yet">Paint</button>
      <button class="mode" disabled title="Animate mode is not implemented yet">Animate</button>
    </div>
  </header>

  <div class="editor-toolbar">
    <div class="tool-group" role="group" aria-label="Model actions">
      <button disabled={busy} onclick={requestNew}>New</button>
      <button disabled={busy} onclick={requestOpen}>Open</button>
      <button disabled={!snapshot || busy} onclick={() => void saveCopy()}>Save Copy</button>
    </div>
    <div class="tool-separator"></div>
    <div class="tool-group" role="group" aria-label="Edit operations">
      <button disabled={!snapshot || busy} onclick={() => void addCube()}>Add Cube</button>
      <button disabled={!snapshot?.canUndo || busy} onclick={() => history('undo')}>Undo</button>
      <button disabled={!snapshot?.canRedo || busy} onclick={() => history('redo')}>Redo</button>
    </div>
    <div class="tool-spacer"></div>
    <button onclick={() => viewport?.frameModel()} disabled={!snapshot || busy}>Frame</button>
  </div>

  <div class="editor-body">
    <aside class="left-dock" aria-label="Textures dock">
      <div class="dock-title">TEXTURES</div>
      {#if snapshot?.textureNames.length}
        <div class="texture-list">
          {#each snapshot.textureNames as name, index}
            <div class="texture-item" title={name}><span class="texture-square"></span><span>{name}</span><small>{index + 1}</small></div>
          {/each}
        </div>
      {:else}
        <p class="empty-label">No textures</p>
      {/if}
      <p class="dock-note">Texture painting is not available in this Edit slice.</p>
    </aside>

    <main class="editor-viewport" aria-label="Model edit viewport">
      {#if snapshot}
        <RustViewport bind:this={viewport} cubes={snapshot.cubes} bones={snapshot.bones}
          hierarchy={snapshot.hierarchy} {selectedId} onSelect={selectCube}/>
      {:else}
        <div class="empty-editor">
          <h2>{loading ? 'Loading editor…' : 'No model open'}</h2>
          <p>Create a Bedrock Entity project or open a compatible Blockbench .bbmodel.</p>
          <div class="empty-actions">
            <button onclick={requestNew} disabled={busy || loading}>New Model</button>
            <button onclick={requestOpen} disabled={busy || loading}>Open Model…</button>
          </div>
        </div>
      {/if}
    </main>

    <aside class="right-dock" aria-label="Outliner and properties">
      <section class="dock-panel outliner">
        <div class="dock-title">OUTLINER</div>
        {#if rows.length}
          <div class="outliner-list" role="tree" aria-label="Model hierarchy">
            {#each rows as row (row.uuid)}
              <div class="outliner-row" class:selected={selectedId === row.uuid || selectedBoneId === row.uuid}
                style:padding-left={(6 + row.depth * 14) + 'px'} role="presentation">
                {#if row.kind === 'bone'}
                  <button class="collapse" aria-label="Toggle group" aria-expanded={!collapsed.has(row.uuid)}
                    onclick={() => toggleBone(row.uuid)}>{collapsed.has(row.uuid) ? '▸' : '▾'}</button>
                {:else}
                  <span class="collapse-spacer"></span>
                {/if}
                <button class="outliner-label" role="treeitem" aria-selected={selectedId === row.uuid || selectedBoneId === row.uuid}
                  onclick={() => selectRow(row)}>
                  <span class="item-kind" aria-hidden="true">{row.kind === 'bone' ? '◇' : '□'}</span>
                  <span class="truncate" title={row.name}>{row.name}</span>
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-label">No model elements</p>
        {/if}
      </section>

      <section class="dock-panel properties">
        <div class="dock-title">ELEMENT</div>
        {#if selectedCube}
          <div class="property-scroll">
            <p class="selected-name" title={selectedCube.name}>{selectedCube.name}</p>
            <div class="property-group">
              <label>Position</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Position ' + AXES[axis]} type="number" step="any"
                      disabled={busy} value={selectedCube.from[axis]}
                      onchange={(event) => position(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label>Size</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{AXES[axis]}</span>
                    <input aria-label={'Size ' + AXES[axis]} type="number" step="any" min="0.001"
                      disabled={busy} value={selectedCube.to[axis] - selectedCube.from[axis]}
                      onchange={(event) => size(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label for="uv-face">UV Face</label>
              <select id="uv-face" bind:value={selectedFace} disabled={busy || selectedCube.boxUv}>
                {#each FACES as face}
                  <option value={face}>{face}</option>
                {/each}
              </select>
              {#if selectedCube.boxUv}
                <p class="hint">Box UV mode is read-only in this slice.</p>
              {:else}
                <div class="uv-fields">
                  {#each [0,1,2,3] as i}
                    <label><span>{['U1','V1','U2','V2'][i]}</span>
                      <input aria-label={'UV ' + (i + 1)} type="number" step="any" disabled={busy}
                        value={faceUv[i] ?? 0}
                        onchange={(event) => uvEdit(i, event.currentTarget.value)}/>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {:else if selectedBoneId}
          <p class="empty-label">Bone selected. Add Cube to this bone.</p>
        {:else}
          <p class="empty-label">Select a Cube to edit Position, Size or UV.</p>
        {/if}
      </section>
    </aside>
  </div>

  <footer class="editor-statusbar" aria-live="polite">
    <span>{snapshot ? snapshot.cubes.length + ' Cubes · ' + snapshot.bones.length + ' Bones' : 'No model'}</span>
    <span class="status-middle">{notice || (snapshot ? 'Untextured geometry preview · Visual parity unverified' : 'Native Rust authoring core')}</span>
    <span>{snapshot ? 'Revision ' + snapshot.revision + (snapshot.dirty ? ' · Unsaved' : '') : 'Edit mode'}</span>
  </footer>

  {#if error}
    <div class="error-bar" role="alert">
      <span>{error}</span>
      <button onclick={() => error = ''} aria-label="Dismiss error">×</button>
    </div>
  {/if}
</div>

{#if newDialog}
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="new-model-title">
      <h2 id="new-model-title">New Bedrock Model</h2>
      <p>Creates an editable model using the Rust engine.</p>
      <form onsubmit={(event) => { event.preventDefault(); void commitNew(); }}>
        <label for="model-name">Model name</label>
        <input id="model-name" bind:this={nameInput} bind:value={newName} maxlength="80" required/>
        <div class="dialog-buttons">
          <button type="button" onclick={() => { newDialog = false; allowDiscard = false; }}>Cancel</button>
          <button type="submit" class="primary" disabled={busy || !newName.trim()}>Create</button>
        </div>
      </form>
    </section>
  </div>
{/if}

{#if confirmDiscard}
  <div class="rust-modal-backdrop" role="presentation">
    <section class="rust-editor-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
      <h2 id="unsaved-title">Unsaved changes</h2>
      <p>The current model has unsaved edits. Export a copy before replacing the active session.</p>
      <div class="dialog-buttons">
        <button bind:this={discardCancel} onclick={() => confirmDiscard = null}>Cancel</button>
        <button class="danger" onclick={discardAndContinue}>Discard and continue</button>
      </div>
    </section>
  </div>
{/if}
