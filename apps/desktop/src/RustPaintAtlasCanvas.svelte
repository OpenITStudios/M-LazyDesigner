<script lang="ts">
  // Drawn overlay and pointer forwarding only. Rust still owns Paint/Undo.
  import type {EditorSnapshot} from './rustEditorTypes';
  import type {SourceSelection} from './rustSurfaceTools';
  import type {ProtectionRect} from './rustSurfacePaint';
  import {drawSurfaceSelectionOverlay} from './rustSelectionOverlay';
  export let snapshot:EditorSnapshot;
  export let source:string|null;
  export let comparing:boolean;
  export let protectMode:boolean;
  export let validSurfaceSelection:boolean;
  export let surfaceSelection:SourceSelection|null;
  export let guardedSurfaceMasks:ProtectionRect[];
  export let pendingSurfaceMask:ProtectionRect|null;
  export let startPaintStroke:(event:PointerEvent)=>void;
  export let movePaintStroke:(event:PointerEvent)=>void;
  export let finishPaintStroke:(event:PointerEvent,cancelled?:boolean)=>void;
</script>

<div class="surface-atlas-frame">
              <img class="paint-atlas paint-workspace-atlas" draggable="false"
                src={source ?? ''}
                alt={comparing ?
                  'Read-only source/candidate material atlas for comparison' :
                  protectMode ?
                    'Drag on the source atlas to protect a rectangle against 3D painting' :
                    'Editable texture atlas; drag to paint one Rust-owned stroke'}
                onpointerdown={startPaintStroke} onpointermove={movePaintStroke}
                onpointerup={finishPaintStroke}
                onpointercancel={(event) => finishPaintStroke(event, true)}
                onlostpointercapture={(event) => finishPaintStroke(event, true)}/>
              {#if validSurfaceSelection &&
                (surfaceSelection?.previewComplete || surfaceSelection?.previewRaster)}
                <canvas class="surface-selection-overlay"
                  width={surfaceSelection?.previewRaster?.width ??
                    Math.min(snapshot.textureResolution[0],512)}
                  height={surfaceSelection?.previewRaster?.height ??
                    Math.min(snapshot.textureResolution[1],512)}
                  use:drawSurfaceSelectionOverlay={{rows:surfaceSelection?.atlasRows ?? [],
                    width:snapshot.textureResolution[0],
                    height:snapshot.textureResolution[1],
                    raster:surfaceSelection?.previewRaster ?? null}}
                  aria-hidden="true"></canvas>
              {/if}
              {#each guardedSurfaceMasks as rect}
                <span class="surface-mask-mark"
                  style:left={(rect.from[0]/snapshot.textureResolution[0]*100)+'%'}
                  style:top={(rect.from[1]/snapshot.textureResolution[1]*100)+'%'}
                  style:width={((rect.to[0]-rect.from[0])/snapshot.textureResolution[0]*100)+'%'}
                  style:height={((rect.to[1]-rect.from[1])/snapshot.textureResolution[1]*100)+'%'}
                  aria-hidden="true"></span>
              {/each}
              {#if pendingSurfaceMask}
                <span class="surface-mask-mark preview"
                  style:left={(pendingSurfaceMask.from[0]/snapshot.textureResolution[0]*100)+'%'}
                  style:top={(pendingSurfaceMask.from[1]/snapshot.textureResolution[1]*100)+'%'}
                  style:width={((pendingSurfaceMask.to[0]-pendingSurfaceMask.from[0])/snapshot.textureResolution[0]*100)+'%'}
                  style:height={((pendingSurfaceMask.to[1]-pendingSurfaceMask.from[1])/snapshot.textureResolution[1]*100)+'%'}
                  aria-hidden="true"></span>
              {/if}
            </div>

<style>
  .surface-atlas-frame .paint-atlas { display: block; width: 100%; max-width: 256px; height: auto; aspect-ratio: auto; image-rendering: pixelated; touch-action: none; cursor: crosshair; border: 1px solid #475569; background-color: #4b5563; background-image: linear-gradient(45deg,#374151 25%,transparent 25%),linear-gradient(-45deg,#374151 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#374151 75%),linear-gradient(-45deg,transparent 75%,#374151 75%); background-size: 12px 12px; }
</style>
