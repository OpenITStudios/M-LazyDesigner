<script lang="ts">
  // Read-only hierarchy projection: original Rust mutations remain in parent.
  import type {Row} from './rustOutlinerView';
  export let rows:Row[];
  export let collapsed:Set<string>;
  export let selectedId:string|null;
  export let selectedBoneId:string|null;
  export let busy:boolean;
  export let loading:boolean;
  export let strokeActive:boolean;
  export let inspectorSplit:number;
  export let toggleBone:(id:string)=>void;
  export let selectRow:(row:Row)=>void;
  export let toggleRowVisibility:(row:Row)=>void;
</script>

<section class="dock-panel outliner" style:flex-basis={inspectorSplit + '%'}>
        <div class="dock-title">
          <span>OUTLINER</span>
          {#if side !== 'float' && side !== 'tabs'}
            <div class="dock-controls">
              <button type="button" title="Move Outliner and Properties to the opposite side"
                onclick={swapDocks}>Move</button>
              <button type="button" title="Float Outliner and Properties in the editor"
                onclick={() => floatPanel('inspector')}>Float</button>
              <button type="button" title="Fold Outliner and Properties"
                onclick={() => hideDock('inspector', true)}>Fold</button>
            </div>
          {/if}
        </div>
        {#if rows.length}
          <div class="outliner-list" role="tree" aria-label="Model hierarchy">
            {#each rows as row (row.uuid)}
              <div class="outliner-row" class:selected={selectedId === row.uuid || selectedBoneId === row.uuid}
                class:muted={!row.visible}
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
                <button type="button" class="outliner-visibility" class:is-hidden={!row.visible}
                  disabled={busy || loading || strokeActive}
                  aria-label={(row.visible ? 'Hide ' : 'Show ') + row.kind + ' ' + row.name}
                  title={(row.visible ? 'Hide ' : 'Show ') + row.kind + (row.kind === 'bone' ? ' and descendants' : '')}
                  onclick={() => toggleRowVisibility(row)}>{row.visible ? 'Hide' : 'Show'}</button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty-label">No model elements</p>
        {/if}
      </section>
