<script lang="ts">
  // One source snapshot, read-only Cube/Bone/UV form. Edit callbacks remain Rust-owned.
  import type {EditorSnapshot,CubeView,BoneView} from './rustEditorTypes';
  import type {WorkspaceMode} from './rustWorkspaceMode';
  import {outlinerParentId,boneContains} from './rustOutlinerView';
  export let snapshot:EditorSnapshot|null;
  export let selectedCube:CubeView|null;
  export let selectedBone:BoneView|null;
  export let busy:boolean;
  export let loading:boolean;
  export let strokeActive:boolean;
  export let workspaceMode:WorkspaceMode;
  export let faceUv:readonly number[];
  export let faceRotation:number|null;
  export let selectedFace:string;
  export let faces:readonly string[];
  export let axes:readonly string[];
  export let renameSelected:(uuid:string,previousName:string,input:HTMLInputElement)=>Promise<void>;
  export let reparentSelected:(parentUuid:string|null)=>Promise<void>;
  export let position:(axis:number,value:string)=>void;
  export let size:(axis:number,value:string)=>void;
  export let rotation:(axis:number,value:string)=>void;
  export let boneRotation:(axis:number,value:string)=>void;
  export let boxOffset:(axis:number,value:string)=>void;
  export let uvEdit:(index:number,value:string)=>void;
  export let uvRotate:(value:string)=>void;
  export let clearSemanticPreview:()=>void;
</script>

<section class="dock-panel properties">
        <div class="dock-title">ELEMENT</div>
        {#if selectedCube}
          <div class="property-scroll">
            <div class="property-group">
              <label for={'rust-cube-name-' + selectedCube.uuid}>Cube name</label>
              <input id={'rust-cube-name-' + selectedCube.uuid} class="node-name-input"
                aria-label="Rename selected Cube" type="text" maxlength="128"
                value={selectedCube.name} autocomplete="off"
                disabled={busy || loading || strokeActive || workspaceMode !== 'edit'}
                onchange={(event) => void renameSelected(
                  selectedCube.uuid, selectedCube.name, event.currentTarget)}/>
            </div>
            <div class="property-group">
              <label>Parent Bone</label>
              <select aria-label="Move Cube to another Bone"
                title="Reparent the selected Cube without changing its stored local coordinates"
                value={outlinerParentId(snapshot?.hierarchy ?? [], selectedCube.uuid)}
                disabled={busy || loading || workspaceMode !== 'edit' || !snapshot?.bones.length}
                onchange={(event) => void reparentSelected(event.currentTarget.value || null)}>
                <option value="" disabled>Select Bone</option>
                {#each snapshot?.bones ?? [] as bone (bone.uuid)}
                  <option value={bone.uuid}>{bone.name}</option>
                {/each}
              </select>
              <p class="hint">Keep local transforms. World-space pose can change if the new Bone is rotated.</p>
            </div>
            <div class="property-group">
              <label>Position</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{axes[axis]}</span>
                    <input aria-label={'Position ' + axes[axis]} type="number" step="any"
                      disabled={busy}
                      title="Change Cube position (Auto UV remaps in Rust)"
                      value={selectedCube.from[axis]}
                      onchange={(event) => position(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label>Size</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{axes[axis]}</span>
                    <input aria-label={'Size ' + axes[axis]} type="number" step="any" min="0.001"
                      disabled={busy}
                      title="Change Cube size (one edge at a time; UV remaps in Rust)"
                      value={selectedCube.to[axis] - selectedCube.from[axis]}
                      onchange={(event) => size(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <div class="property-group">
              <label>Rotation (degrees)</label>
              <div class="xyz-fields">
                {#each [0,1,2] as axis}
                  <label class="axis-input"><span>{axes[axis]}</span>
                    <input aria-label={'Rotation ' + axes[axis]} type="number" step="any"
                      disabled={busy} value={selectedCube.rotation[axis]}
                      onchange={(event) => rotation(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            {#if selectedCube.boxUv}
              <p class="hint">Box UV remaps Size and preserves the box offset. Per-face UV editing remains unavailable.</p>
            {:else if selectedCube.autoUv !== 0}
              <p class="hint">Auto UV mode {selectedCube.autoUv} remaps Move and single-edge Size in Rust. Manual face UV edits disable Auto UV for the selected Cube.</p>
            {/if}
            <div class="property-group">
              <label for="uv-face">UV Face</label>
              <select id="uv-face" bind:value={selectedFace}
                onchange={clearSemanticPreview}
                disabled={busy || selectedCube.boxUv}>
                {#each faces as face}
                  <option value={face}>{face}</option>
                {/each}
              </select>
              {#if selectedCube.boxUv}
                <p class="hint">Box UV face rectangles are derived from Cube bounds and atlas offset.</p>
                <div class="uv-fields">
                  {#each [0,1] as axis}
                    <label><span>{axis === 0 ? 'U' : 'V'}</span>
                      <input aria-label={'Box UV offset ' + (axis === 0 ? 'U' : 'V')}
                        type="number" step="1" disabled={busy}
                        value={selectedCube.uvOffset[axis]}
                        onchange={(event) => boxOffset(axis, event.currentTarget.value)}/>
                    </label>
                  {/each}
                </div>
              {:else}
                <div class="uv-fields">
                  {#each [0,1,2,3] as i}
                    <label><span>{['U1','V1','U2','V2'][i]}</span>
                      <input aria-label={'UV ' + (i + 1)} type="number" step="any"
                        disabled={busy}
                        title={selectedCube.autoUv !== 0 ? 'Manual UV edits disable Auto UV on this Cube' : 'Change face UV'}
                        value={faceUv[i] ?? 0}
                        onchange={(event) => uvEdit(i, event.currentTarget.value)}/>
                    </label>
                  {/each}
                </div>
                <div class="uv-fields">
                  <label><span>UV Rotation</span>
                    <select aria-label={'UV rotation for ' + selectedFace}
                      disabled={busy || loading || workspaceMode !== 'edit' || faceRotation === null}
                      title="Rotate the selected Cube face UV without changing atlas pixels; manual edits disable Auto UV"
                      value={faceRotation ?? ''}
                      onchange={(event) => uvRotate(event.currentTarget.value)}>
                      {#each [0,90,180,270] as degrees}
                        <option value={degrees}>{degrees}°</option>
                      {/each}
                    </select>
                  </label>
                </div>
                {#if faceRotation === null}
                  <p class="hint">Unsupported imported face rotation is preserved and cannot be edited.</p>
                {/if}
              {/if}
            </div>
          </div>
        {:else if selectedBone}
          <div class="property-scroll">
            <div class="property-group">
              <label for={'rust-bone-name-' + selectedBone.uuid}>Bone name</label>
              <input id={'rust-bone-name-' + selectedBone.uuid} class="node-name-input"
                aria-label="Rename selected Bone" type="text" maxlength="128"
                value={selectedBone.name} autocomplete="off"
                disabled={busy || loading || strokeActive || workspaceMode !== 'edit'}
                onchange={(event) => void renameSelected(
                  selectedBone.uuid, selectedBone.name, event.currentTarget)}/>
            </div>
            <div class="property-group">
              <label>Parent Bone</label>
              <select aria-label="Move Bone to another parent"
                title="Reparent the selected Bone without changing saved local transforms"
                value={outlinerParentId(snapshot?.hierarchy ?? [], selectedBone.uuid)}
                disabled={busy || loading || workspaceMode !== 'edit'}
                onchange={(event) => void reparentSelected(event.currentTarget.value || null)}>
                <option value="">Root</option>
                {#each snapshot?.bones ?? [] as bone (bone.uuid)}
                  {#if bone.uuid !== selectedBone.uuid &&
                    !boneContains(snapshot?.hierarchy ?? [], selectedBone.uuid, bone.uuid)}
                    <option value={bone.uuid}>{bone.name}</option>
                  {/if}
                {/each}
              </select>
              <p class="hint">Keep local transforms. Reparenting can change the world-space pose.</p>
            </div>
            <div class="property-group">
              <label>Bone origin (read-only)</label>
              <p class="hint">{selectedBone.origin.join(', ')}</p>
            </div>
            <div class="property-group">
              <label>Bone bind rotation (degrees)</label>
              <div class="xyz-fields">
                {#each [0, 1, 2] as axis}
                  <label class="axis-input"><span>{axes[axis]}</span>
                    <input aria-label={'Bone rotation ' + axes[axis]}
                      type="number" step="any"
                      disabled={busy || workspaceMode !== 'edit'}
                      title="Change the Bone bind rotation using one Rust Undo transaction"
                      value={selectedBone.rotation[axis]}
                      onchange={(event) => boneRotation(axis, event.currentTarget.value)}/>
                  </label>
                {/each}
              </div>
            </div>
            <p class="hint">{workspaceMode === 'edit'
              ? 'Bone bind rotation is stored in Rust and affects its child Cubes.'
              : 'Switch to Edit to change the bind pose. Animation keyframes remain in Animate.'}</p>
          </div>
        {:else}
          <p class="empty-label">Select a Cube to edit Position, Size or UV.</p>
        {/if}
      </section>
