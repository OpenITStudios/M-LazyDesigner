<script lang="ts">
  // UI only. Rust source, revisions, edits and playback stay in RustEditorPage.
  import type {AnimationView,EditorSnapshot,TransformChannel,TransformKeyframeView,Vec3}
    from './rustEditorTypes';
  import type {TransformTimelineRow} from './rustAnimationPose';
  export let snapshot:EditorSnapshot|null;
  export let busy:boolean;
  export let loading:boolean;
  export let newAnimationName:string;
  export let newAnimationLength:number;
  export let selectedAnimation:AnimationView|null;
  export let timelineRows:TransformTimelineRow[];
  export let selectedKeyframe:TransformKeyframeView|null;
  export let selectedKeyframeUuid:string|null;
  export let selectedBoneId:string|null;
  export let playbackActive:boolean;
  export let animationTime:number;
  export let animationChannel:TransformChannel;
  export let animationValue:Vec3;
  export let updateAnimationLength:(value:string)=>void;
  export let setSelectedAnimationLength:(input:HTMLInputElement)=>Promise<void>;
  export let createAnimation:()=>Promise<void>;
  export let onSelectAnimation:(uuid:string)=>void;
  export let pauseAnimationPlayback:()=>void;
  export let toggleAnimationPlayback:()=>void;
  export let stopAnimationPlayback:()=>void;
  export let selectTransformKeyframe:(frame:TransformKeyframeView)=>void;
  export let selectAnimationChannel:(channel:TransformChannel)=>void;
  export let updateAnimationTime:(value:string)=>void;
  export let updateAnimationAxis:(axis:number,value:string)=>void;
  export let addTransformKeyframe:()=>Promise<void>;
  export let updateTransformKeyframe:()=>Promise<void>;
  export let removeTransformKeyframe:()=>Promise<void>;
  const AXES=['X','Y','Z'] as const;
</script>

<section class="animate-workspace" aria-label="Rust animation keyframe editor">
    <div class="animate-heading">
      <strong>Animate · Bone transforms</strong>
      <span>Rust-owned .bbmodel · Once-only linear Rotation / Position / Scale · No effects or Molang</span>
    </div>
    {#if snapshot}
      <div class="animate-create">
        <label>Animation name
          <input type="text" bind:value={newAnimationName} maxlength="128" disabled={busy}/>
        </label>
        <label>Length (seconds)
          <input type="number" min="0.001" max="3600" step="any"
            value={newAnimationLength} disabled={busy}
            onchange={(event) => updateAnimationLength(event.currentTarget.value)}/>
        </label>
        <button type="button" disabled={busy || loading || !newAnimationName.trim()}
          onclick={() => void createAnimation()}>New Animation</button>
      </div>
      {#if snapshot.animations.length}
        <div class="animate-list" aria-label="Animation selection">
          {#each snapshot.animations as animation}
            <button type="button" class:active={selectedAnimation?.uuid === animation.uuid}
              aria-pressed={selectedAnimation?.uuid === animation.uuid}
              onclick={() => onSelectAnimation(animation.uuid)}>
              {animation.name} ({animation.length}s)
            </button>
          {/each}
        </div>
      {:else}
        <p class="hint">Create an Animation to begin. Existing imported animation data remains preserved.</p>
      {/if}
      {#if selectedAnimation}
        <section class="animate-track" aria-label="Selected animation timeline">
          <div class="animate-track-title">
            <strong>{selectedAnimation.name}</strong>
            <span>Length {selectedAnimation.length}s · {selectedAnimation.transformKeyframes.length} supported transform keyframes</span>
          </div>
          <label class="animate-clip-length">Selected clip length (seconds)
            <input type="number" min="0" max="3600" step="any"
              aria-label="Edit selected animation length"
              value={selectedAnimation.length}
              disabled={busy || loading || !selectedAnimation.previewSupported}
              onchange={(event) => void setSelectedAnimationLength(event.currentTarget)}/>
          </label>
          <p class="hint">Length edits are Rust Undo steps. Shortening cannot delete or move existing keyframes; a conflicting length is refused. Unsupported imported tracks stay read-only.</p>
          <p class="hint">Select a Bone, choose a Rotation/Position/Scale channel and enter numeric values. Scale is limited to 0–100; negative scales remain unsupported.</p>
          {#if selectedAnimation.previewSupported}
            <div class="animate-playback-controls" role="group" aria-label="Bone transform pose playback controls">
              <button type="button" aria-pressed={playbackActive}
                disabled={busy || loading || selectedAnimation.length <= 0 ||
                  selectedAnimation.transformKeyframes.length === 0}
                onclick={toggleAnimationPlayback}>
                {playbackActive ? 'Pause' : 'Play'}
              </button>
              <button type="button" disabled={busy || (!playbackActive && animationTime === 0)}
                onclick={stopAnimationPlayback}>Stop</button>
              <span>Once · 1× · {animationTime.toFixed(2)}s / {selectedAnimation.length}s</span>
            </div>
            <label class="animate-scrub">Scrub Bone pose: {animationTime.toFixed(2)}s
              <input type="range" min="0" max={selectedAnimation.length}
                step="0.01" bind:value={animationTime}
                oninput={pauseAnimationPlayback}
                disabled={busy || selectedAnimation.length <= 0}
                aria-label="Scrub static Bone transform pose"/>
            </label>
            <p class="hint">Play/Pause previews only supported numeric linear Bone Rotation, Position and Scale. No sound, effects, Molang, loop or controller evaluation.</p>
            {#if timelineRows.length > 0}
              <div class="animate-timeline" aria-label="Bone transform keyframe timeline">
                {#each timelineRows as row (row.boneUuid + ':' + row.channel)}
                  <div class="animate-timeline-row">
                    <span class="animate-timeline-bone" title={row.boneName + ' · ' + row.channel}>{row.boneName} · {row.channel}</span>
                    <div class="animate-timeline-lane" role="group"
                      aria-label={row.channel + ' keyframes for ' + row.boneName}>
                      {#each row.frames as frame (frame.uuid)}
                        <button type="button" class="animate-timeline-marker"
                          class:active={selectedKeyframeUuid === frame.uuid}
                          aria-pressed={selectedKeyframeUuid === frame.uuid}
                          aria-label={row.boneName + ' ' + row.channel + ' keyframe at ' + frame.time + ' seconds'}
                          title={row.boneName + ' · ' + row.channel + ' · ' + frame.time + 's'}
                          style:left={(selectedAnimation.length > 0
                            ? (frame.time / selectedAnimation.length) * 100 : 0) + '%'}
                          disabled={busy || loading}
                          onclick={() => selectTransformKeyframe(frame)}></button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <p class="hint">Pose preview unavailable: this Animation contains unsupported tracks, expressions or interpolation. Original data is preserved.</p>
          {/if}
          <div class="animate-keyframe-editor">
            <label>Transform channel
              <select value={animationChannel}
                disabled={busy || loading || !selectedAnimation.previewSupported}
                aria-label="Select Bone transform channel"
                onchange={(event) => selectAnimationChannel(
                  event.currentTarget.value as TransformChannel)}>
                <option value="rotation">Rotation (degrees)</option>
                <option value="position">Position (offset)</option>
                <option value="scale">Scale (multiplier)</option>
              </select>
            </label>
            <label>Time (seconds)
              <input type="number" min="0" max={selectedAnimation.length} step="any"
                value={animationTime} disabled={busy}
                onchange={(event) => updateAnimationTime(event.currentTarget.value)}/>
            </label>
            {#each [0, 1, 2] as axis}
              <label>{animationChannel} {AXES[axis]}
                <input type="number" step="any" value={animationValue[axis]} disabled={busy}
                  onchange={(event) => updateAnimationAxis(axis, event.currentTarget.value)}/>
              </label>
            {/each}
            <button type="button" disabled={busy || !selectedBoneId || !selectedAnimation.previewSupported}
              onclick={() => void addTransformKeyframe()}>Add {animationChannel} Keyframe</button>
            <button type="button" disabled={busy || !selectedKeyframe || !selectedAnimation.previewSupported}
              onclick={() => void updateTransformKeyframe()}>Update Selected Keyframe</button>
            <button type="button" disabled={busy || !selectedKeyframe || !selectedAnimation.previewSupported}
              title="Remove only the selected supported keyframe; Undo restores it"
              onclick={() => void removeTransformKeyframe()}>Delete Selected Keyframe</button>
          </div>
          <p class="hint">Target Bone: {snapshot.bones.find((bone) => bone.uuid === selectedBoneId)?.name ?? 'Select a Bone in Outliner'}</p>
          <div class="animate-keyframe-list" aria-label="Existing supported transform keyframes">
            {#each selectedAnimation.transformKeyframes as frame}
              <button type="button" class:active={selectedKeyframe?.uuid === frame.uuid}
                aria-pressed={selectedKeyframe?.uuid === frame.uuid}
                title={'Select ' + frame.channel + ' keyframe at ' + frame.time + ' seconds'}
                onclick={() => selectTransformKeyframe(frame)}>
                {frame.time}s · {snapshot.bones.find((bone) => bone.uuid === frame.boneUuid)?.name ?? frame.boneUuid}
                · {frame.channel} [{frame.value.join(', ')}]
              </button>
            {/each}
          </div>
        </section>
      {/if}
      {#if snapshot.animationCount > snapshot.animations.length}
        <p class="hint">Only the first 256 supported Animation records are projected; all source data is preserved.</p>
      {/if}
    {/if}
  </section>
