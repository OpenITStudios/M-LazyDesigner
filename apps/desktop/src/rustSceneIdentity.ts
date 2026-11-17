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

/**
 * Recognize the ONLY in-place Cube update supported by this viewport:
 * one source Cube's saved rotation changed, while geometry, UV, materials,
 * Bone transforms, hierarchy, texture content and all other Cubes did not.
 * Inputs are derived by sceneRenderStructure(), never arbitrary model JSON.
 * A mismatch means full rebuild, not an attempt to guess update reach.
 */
export function singleCubeRotationUpdate(
  previous: SceneInputs | null, next: SceneInputs,
): {uuid:string;rotation:[number,number,number]} | null {
  if (!previous || previous.structure === next.structure ||
      previous.sources.length !== next.sources.length ||
      previous.sources.some((source, i) => source !== next.sources[i])) return null;
  let oldTree: unknown;
  let newTree: unknown;
  try {
    oldTree = JSON.parse(previous.structure);
    newTree = JSON.parse(next.structure);
  } catch { return null; }
  if (!Array.isArray(oldTree) || !Array.isArray(newTree) ||
      oldTree.length !== 8 || newTree.length !== 8 ||
      !Array.isArray(oldTree[0]) || !Array.isArray(newTree[0]) ||
      oldTree[0].length !== newTree[0].length) return null;
  // All non-Cube render inputs must be byte-for-byte semantically equal.
  for (let i = 1; i < 8; i++) {
    if (JSON.stringify(oldTree[i]) !== JSON.stringify(newTree[i])) return null;
  }
  let changed: {uuid:string;rotation:[number,number,number]} | null = null;
  for (let i = 0; i < oldTree[0].length; i++) {
    const before = oldTree[0][i];
    const after = newTree[0][i];
    if (!Array.isArray(before) || !Array.isArray(after) ||
        before.length !== 15 || after.length !== 15 ||
        before[0] !== after[0] || typeof after[0] !== 'string') return null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (changed ||
        JSON.stringify(before.slice(0, 4)) !== JSON.stringify(after.slice(0, 4)) ||
        JSON.stringify(before.slice(5)) !== JSON.stringify(after.slice(5))) return null;
    const rotation = after[4];
    if (!Array.isArray(rotation) || rotation.length !== 3 ||
        !rotation.every((axis: unknown) =>
          typeof axis === 'number' && Number.isFinite(axis))) return null;
    changed = {uuid: after[0], rotation: rotation as [number,number,number]};
  }
  return changed;
}

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
