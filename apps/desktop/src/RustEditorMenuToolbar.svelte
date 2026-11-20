<script lang="ts">
  // Chrome presentation only: the parent owns the Rust model, Tauri commands,
  // source/revision checks, window hotkeys, menus and viewport action callbacks.
  // No second authoring/preview/session state or new style source.
  import type {EditorSnapshot} from './rustEditorTypes';
  import type {WorkspaceMode} from './rustWorkspaceMode';
  import type {ReviewViewId} from './rustReviewCapture';
  import type {DockLayout,DockPanel,DockSide} from './rustDockLayout';
  type Menu='file'|'edit'|'view'|null;
  type TransformTool='translate'|'rotate'|'scale'|null;
  export let snapshot:EditorSnapshot|null;
  export let busy:boolean;
  export let loading:boolean;
  export let workspaceMode:WorkspaceMode;
  export let dockLayout:DockLayout;
  export let selectedId:string|null;
  export let selectedBoneId:string|null;
  export let strokeActive:boolean;
  export let liveReadAvailable:boolean;
  export let liveReadPaired:boolean;
  export let validSemanticPreview:boolean;
  export let validExternalPreview:boolean;
  export let menu:Menu;
  export let transformTool:TransformTool;
  export let reviewViewId:ReviewViewId;
  export let requestNew:()=>void;
  export let requestOpen:()=>void;
  export let saveCopy:()=>void;
  export let openRecoveryDialog:()=>void;
  export let exportGeometry:()=>void;
  export let exportAnimations:()=>void;
  export let openLiveReadDialog:()=>void;
  export let stopLiveRead:()=>void;
  export let openLegacyWorkspace:()=>void;
  export let addCube:()=>void;
  export let addBone:()=>void;
  export let duplicateSelectedCube:()=>void;
  export let deleteSelected:()=>void;
  export let swapDocks:()=>void;
  export let separateTabs:()=>void;
  export let resetDocks:()=>void;
  export let closeMenus:()=>void;
  export let clearSemanticComparison:()=>void;
  export let exportReviewCapture:()=>void;
  export let history:(direction:'undo'|'redo')=>void;
  export let hideDock:(panel:DockPanel,hidden:boolean)=>void;
  export let attachTabs:(side:DockSide)=>void;
  export let returnPanel:(panel:DockPanel)=>void;
  export let floatPanel:(panel:DockPanel)=>void;
  export let selectWorkspace:(mode:WorkspaceMode)=>void;
  export let frameModel:()=>void;
</script>

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
                <button role="menuitem" onclick={() => void openRecoveryDialog()} disabled={busy || loading || strokeActive}>Recover Checkpoint…</button>
                <button role="menuitem" onclick={() => void exportGeometry()}
                  disabled={!snapshot || busy || loading || strokeActive}
                  title="Export a separate Minecraft Bedrock geometry JSON. This does not replace your editable .bbmodel.">
                  Export Bedrock Geometry…
                </button>
                <button role="menuitem" onclick={() => void exportAnimations()}
                  disabled={!snapshot || busy || loading || strokeActive}
                  title="Export a separate Minecraft Bedrock animation JSON. Unsupported curves are refused without affecting the editable .bbmodel.">
                  Export Bedrock Animations…
                </button>
                {#if liveReadAvailable}
                  <div class="menu-rule"></div>
                  <button role="menuitem" onclick={() => void openLiveReadDialog()}
                    disabled={!snapshot || busy || loading || strokeActive}
                    title="Optional native read-only access for an independently trusted agent. LazyDesigner does not execute AI prompts or edits.">
                    {liveReadPaired ? 'View read-only agent pairing…' : 'Pair external agent (read-only)…'}
                  </button>
                  {#if liveReadPaired}
                    <button role="menuitem" onclick={() => void stopLiveRead()}
                      disabled={busy || loading}>Disconnect read-only agent</button>
                  {/if}
                {/if}
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={openLegacyWorkspace}>Legacy Workspace</button>
              {:else if item === 'edit'}
                <button role="menuitem" onclick={() => history('undo')} disabled={!snapshot?.canUndo || busy}>Undo <kbd>Ctrl+Z</kbd></button>
                <button role="menuitem" onclick={() => history('redo')} disabled={!snapshot?.canRedo || busy}>Redo <kbd>Ctrl+Y</kbd></button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => void addCube()} disabled={!snapshot || busy}>Add Cube</button>
                <button role="menuitem" onclick={() => void addBone()} disabled={!snapshot || busy}>Add Bone</button>
                <button role="menuitem" onclick={() => void duplicateSelectedCube()}
                  disabled={!snapshot || busy || loading || workspaceMode !== 'edit' || !selectedId}>
                  Duplicate Selected Cube
                </button>
                <button role="menuitem" onclick={() => void deleteSelected()}
                  disabled={!snapshot || busy || (!selectedId && !selectedBoneId)}>
                  Delete Selected Cube / Empty Bone
                </button>
              {:else}
                <button role="menuitem" disabled={!snapshot || busy} onclick={() => { frameModel(); closeMenus(); }}>Frame Model</button>
                <div class="menu-rule"></div>
                <button role="menuitem" onclick={() => hideDock('textures', !dockLayout.hidden.textures)}>
                  {dockLayout.hidden.textures ? 'Show Textures' : 'Fold Textures'}
                </button>
                <button role="menuitem" onclick={() => hideDock('inspector', !dockLayout.hidden.inspector)}>
                  {dockLayout.hidden.inspector ? 'Show Outliner / Properties' : 'Fold Outliner / Properties'}
                </button>
                <button role="menuitem" onclick={swapDocks}>Swap Left / Right Docks</button>
                <button role="menuitem" onclick={() => attachTabs('left')}>Attach Panels as Tabs — Left</button>
                <button role="menuitem" onclick={() => attachTabs('right')}>Attach Panels as Tabs — Right</button>
                <button role="menuitem" disabled={dockLayout.attachedSide === null}
                  onclick={separateTabs}>Separate Attached Panels</button>
                <button role="menuitem" onclick={() => dockLayout.floating.textures
                  ? returnPanel('textures') : floatPanel('textures')}>
                  {dockLayout.floating.textures ? 'Dock Textures' : 'Float Textures'}
                </button>
                <button role="menuitem" onclick={() => dockLayout.floating.inspector
                  ? returnPanel('inspector') : floatPanel('inspector')}>
                  {dockLayout.floating.inspector ? 'Dock Outliner / Properties' : 'Float Outliner / Properties'}
                </button>
                <button role="menuitem" onclick={resetDocks}>Reset Dock Layout</button>
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
      <button class="mode" class:active={workspaceMode === 'edit'}
        aria-pressed={workspaceMode === 'edit'} disabled={!snapshot || busy || strokeActive}
        onclick={() => selectWorkspace('edit')}>Edit</button>
      <button class="mode" class:active={workspaceMode === 'paint'}
        aria-pressed={workspaceMode === 'paint'} disabled={!snapshot || busy || strokeActive}
        onclick={() => selectWorkspace('paint')}>Paint</button>
      <button class="mode" class:active={workspaceMode === 'animate'}
        aria-pressed={workspaceMode === 'animate'} disabled={!snapshot || busy || strokeActive}
        title="Author bounded Bone rotation keyframes in Rust; supported numeric linear rotation playback is a read-only preview"
        onclick={() => selectWorkspace('animate')}>Animate</button>
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
      {#if workspaceMode === 'edit'}
        <button disabled={!snapshot || busy} onclick={() => void addCube()}>Add Cube</button>
        <button disabled={!snapshot || busy} onclick={() => void addBone()}>Add Bone</button>
        <button disabled={!snapshot || busy || loading || !selectedId}
          title="Copy selected Cube with its faces and UV next to the source, using one Rust Undo step"
          onclick={() => void duplicateSelectedCube()}>Duplicate</button>
        <button disabled={!snapshot || busy || (!selectedId && !selectedBoneId)}
          title="Delete the selected Cube or an empty Bone; Undo restores it"
          onclick={() => void deleteSelected()}>Delete</button>
      {/if}
      <button disabled={!snapshot?.canUndo || busy} onclick={() => history('undo')}>Undo</button>
      <button disabled={!snapshot?.canRedo || busy} onclick={() => history('redo')}>Redo</button>
    </div>
    <div class="tool-separator"></div>
    {#if workspaceMode === 'edit'}
      <div class="tool-group" role="group" aria-label="Viewport transform tools">
        <button class:active={transformTool === 'translate'} aria-pressed={transformTool === 'translate'}
          title="Move the selected Cube with the 3D gizmo"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'translate' ? null : 'translate'}>Move</button>
        <button class:active={transformTool === 'rotate'} aria-pressed={transformTool === 'rotate'}
          title="Rotate the selected Cube with the 3D gizmo"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'rotate' ? null : 'rotate'}>Rotate</button>
        <button class:active={transformTool === 'scale'} aria-pressed={transformTool === 'scale'}
          title="Scale selected Cube about its pivot using the 3D gizmo (0–4×; Auto UV becomes manual)"
          disabled={!snapshot || busy || loading}
          onclick={() => transformTool = transformTool === 'scale' ? null : 'scale'}>Scale</button>
      </div>
    {/if}
    <div class="tool-spacer"></div>
    <button onclick={() => frameModel()} disabled={!snapshot || busy}>Frame</button>
    <select bind:value={reviewViewId} aria-label="Review camera direction"
      onchange={clearSemanticComparison}
      disabled={!snapshot || busy || loading} title="Choose a fixed model camera for a source-bound PNG capture">
      <option value="front">Front</option><option value="back">Back</option>
      <option value="left">Left</option><option value="right">Right</option>
      <option value="top">Top</option><option value="bottom">Bottom</option>
    </select>
    <button onclick={() => void exportReviewCapture()}
      disabled={!snapshot || snapshot.dirty || !snapshot.sourceName ||
        busy || loading || strokeActive || validSemanticPreview || validExternalPreview || workspaceMode === 'animate'}
      title="Save a new source-bound Rust preview PNG. Save Copy first; this is not Bedrock rendering proof.">
      Capture PNG
    </button>
  </div>
