// Derived Three.js read-only projection identity. Only renderer input fields
// belong in structure; images are compared by exact source string identity.
// This does not cache/validate authored Rust document or image permissions.
export interface SceneInputs {
  structure: string;
  sources: readonly (string | null)[];
}

export function sameSceneInputs(previous: SceneInputs | null, next: SceneInputs): boolean {
  return previous !== null && previous.structure === next.structure &&
    previous.sources.length === next.sources.length &&
    previous.sources.every((source, index) => source === next.sources[index]);
}

/**
 * Fast path is safe only for an unchanged Cube/Bone/UV/material structure.
 * Changed sources must stay non-null (painted PNG replacement, not a new
 * asset/unsupported source). Other transitions keep the full scene rebuild.
 */
export function canRefreshPaintSources(previous: SceneInputs | null, next: SceneInputs): boolean {
  if (!previous || previous.structure !== next.structure ||
      previous.sources.length !== next.sources.length) return false;
  let replaced = false;
  for (let i = 0; i < next.sources.length; i++) {
    if (previous.sources[i] === next.sources[i]) continue;
    if (!previous.sources[i] || !next.sources[i]) return false;
    replaced = true;
  }
  return replaced;
}

// Only fields actually read by the current Three.js scene builder belong in
// this derived fingerprint. Cube/Bone names and Outliner expansion are UI-only;
// neither may force a full GPU mesh/material rebuild after a Rust rename.
// Keep full face values to conservatively cover saved UV and face extensions.
import type { CubeView, BoneView, HierarchyNode } from './rustEditorTypes';

function renderedHierarchy(nodes: readonly HierarchyNode[]): unknown[] {
  return nodes.map(node => typeof node === 'string'
    ? node : [node.uuid, renderedHierarchy(node.children)]);
}

export function sceneRenderStructure(
  cubes: readonly CubeView[], bones: readonly BoneView[],
  hierarchy: readonly HierarchyNode[],
  sides: readonly ('front' | 'double' | null)[],
  resolutions: readonly ([number, number] | null)[],
  scoped: boolean, resolution: readonly [number, number],
  previewIndex: number | null,
): string {
  // Preserve source Cube order and every property used by rebuild(). The
  // no-name view is NOT an alternate model or editable serialization.
  return JSON.stringify([
    cubes.map(cube => [
      cube.uuid, cube.from, cube.to, cube.origin, cube.rotation, cube.inflate,
      cube.stretch, cube.visible, cube.renderOrder, cube.boxUv,
      cube.uvOffset, cube.autoUv, cube.color, cube.faces,
      cube.previewTextureIndex,
    ]),
    bones.map(bone => [
      bone.uuid, bone.origin, bone.rotation, bone.visible,
    ]),
    renderedHierarchy(hierarchy),
    sides, resolutions, scoped, resolution, previewIndex,
  ]);
}
