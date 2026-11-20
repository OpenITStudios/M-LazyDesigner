/** Read-only hierarchy projection and Outliner navigation for the Rust editor.
 * Does not mutate Rust authored models; revealOutlinerPath only edits the
 * caller's transient expanded-row Set, preserving the old controller behavior.
 */
import type {CubeView,EditorSnapshot,HierarchyNode} from './rustEditorTypes';

export type Row = { uuid: string; name: string; depth: number;
  kind: 'cube' | 'bone'; visible: boolean };

  export function makeRows(nodes: HierarchyNode[], cubes: CubeView[], bones: EditorSnapshot['bones'], folded: Set<string>): Row[] {
    const cubesById = new Map(cubes.map((cube) => [cube.uuid, cube] as const));
    const bonesById = new Map(bones.map((bone) => [bone.uuid, bone] as const));
    const rows: Row[] = [];
    function walk(items: HierarchyNode[], depth: number) {
      for (const item of items) {
        if (typeof item === 'string') {
          const cube = cubesById.get(item);
          rows.push({ uuid: item, name: cube?.name ?? 'Cube', depth, kind: 'cube', visible: cube?.visible ?? true });
        } else {
          const bone = bonesById.get(item.uuid);
          rows.push({ uuid: item.uuid, name: bone?.name ?? 'Bone', depth, kind: 'bone', visible: bone?.visible ?? true });
          if (!folded.has(item.uuid)) walk(item.children, depth + 1);
        }
      }
    }
    walk(nodes, 0);
    return rows;
  }

  export function revealOutlinerPath(nodes: HierarchyNode[], uuid: string, open: Set<string>): boolean {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node === uuid) return true;
      } else {
        if (node.uuid === uuid || revealOutlinerPath(node.children, uuid, open)) {
          open.delete(node.uuid);
          return true;
        }
      }
    }
    return false;
  }

  // Hierarchy navigation is read from the current Rust snapshot only.
  export function outlinerParentId(nodes: HierarchyNode[], uuid: string, parent = ''): string {
    for (const node of nodes) {
      if (typeof node === 'string') {
        if (node === uuid) return parent;
      } else {
        if (node.uuid === uuid) return parent;
        const found = outlinerParentId(node.children, uuid, node.uuid);
        if (found) return found;
      }
    }
    return '';
  }
  export function boneContains(nodes: HierarchyNode[], ancestor: string, target: string): boolean {
    const descendantsContain = (children: HierarchyNode[]): boolean =>
      children.some((child) => typeof child !== 'string' &&
        (child.uuid === target || descendantsContain(child.children)));
    return nodes.some((node) => typeof node !== 'string' &&
      (node.uuid === ancestor
        ? descendantsContain(node.children)
        : boneContains(node.children, ancestor, target)));
  }
