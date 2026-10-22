/// <reference types="blockbench-types" />

import { z } from "zod";
import {
  resolveCoreGroup,
  resolveCoreTexture,
  resolveUuidOrUniqueName,
} from "@/lib/core/identity";

export const finiteElementVector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export interface IElementMatch {
  uuid: string;
  name: string;
  type: "cube" | "group";
  parent: string | null;
}

export interface IFilterByMaterialMatch {
  uuid: string;
  name: string;
  type: "cube";
  faces?: string[];
}

export function getElementType(el: unknown): "cube" | "group" | null {
  if (el instanceof Cube) return "cube";
  if (el instanceof Group) return "group";
  return null;
}

export function getParentName(el: { parent?: unknown }): string | null {
  const parent = el.parent as { name?: string; uuid?: string } | undefined;
  if (!parent || typeof parent !== "object") return null;
  return parent.name ?? parent.uuid ?? null;
}

export function resolveParentGroup(reference: string): Group | "root" {
  if (reference === "root") return "root";
  return resolveCoreGroup(
    reference,
    'Use inspect_elements(mode=outline) to confirm the intended Group UUID. Use "root" only when root parenting is intentional.'
  );
}

export function resolveOptionalGroupScope(reference?: string): Group | null {
  if (reference === undefined) return null;
  return resolveCoreGroup(
    reference,
    "Use inspect_elements(mode=outline) to confirm the intended Group UUID, or omit parent_group when no scope is intended."
  );
}

export type ResolvedElement = OutlinerElement | Group;

export function continuationElementType(
  element: ResolvedElement
): "cube" | "group" | "locator" | "null_object" | "element" {
  if (element instanceof Cube) return "cube";
  if (element instanceof Group) return "group";
  if (element instanceof Locator) return "locator";
  if (element instanceof NullObject) return "null_object";
  return "element";
}

export function elementContinuationState(element: ResolvedElement) {
  const parent = (element as { parent?: unknown }).parent;
  return {
    uuid: element.uuid,
    name: element.name,
    type: continuationElementType(element),
    parent: parent instanceof Group ? parent.uuid : "root",
  };
}

export function resolveUniqueDestructiveElement(reference: string): ResolvedElement {
  // A Group may appear in both collections. Deduplicate only by object
  // identity; distinct objects sharing a UUID must fail closed.
  const candidates = [...new Set<ResolvedElement>([
    ...(Outliner.elements ?? []),
    ...(Group.all ?? []),
  ])];

  return resolveUuidOrUniqueName(candidates, reference, {
    kind: "Element",
    notFoundHint:
      "Use inspect_elements(mode=outline|search) to confirm the intended UUID before retrying the destructive operation.",
    describeCandidate: (element) =>
      `${getElementType(element) ?? "element"} ${element.name} (${element.uuid})`,
  });
}

export function resolveUniqueTextureForDiscovery(reference: string): Texture {
  return resolveCoreTexture(
    reference,
    "Use list_textures to confirm the intended UUID or texture ID before retrying material discovery."
  );
}

export function isDescendantOf(el: { parent?: unknown }, targetGroup: Group): boolean {
  let current: { parent?: unknown } | undefined = el;
  const visited = new Set<object>();
  while (current && current.parent && typeof current.parent === "object") {
    // A corrupted native parent chain must not hang the serialized Gateway.
    if (visited.has(current)) {
      throw new Error(
        "Outliner hierarchy contains a cyclic parent chain. Repair the hierarchy before reparenting or searching descendants."
      );
    }
    visited.add(current);
    if (current.parent === targetGroup) return true;
    current = current.parent as { parent?: unknown };
  }
  return false;
}

export function cubeSize(cube: Cube): [number, number, number] {
  return [
    cube.to[0] - cube.from[0],
    cube.to[1] - cube.from[1],
    cube.to[2] - cube.from[2],
  ];
}

export function exceedsBounds(
  size: [number, number, number],
  min?: number[],
  max?: number[]
): boolean {
  if (min && size.some((v, i) => v < (min[i] ?? -Infinity))) return true;
  if (max && size.some((v, i) => v > (max[i] ?? Infinity))) return true;
  return false;
}

const MAX_REGEX_PATTERN_LENGTH = 512;
const CATASTROPHIC_BACKTRACK_HEURISTIC = /\([^)]*[+*?][^)]*\)\s*[+*?{]/;

export function safeCompileRegex(pattern: string | undefined): RegExp | null {
  if (pattern === undefined) return null;
  if (pattern.length === 0) {
    throw new Error("name_pattern cannot be empty; omit it only when no regex filter is intended.");
  }
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new Error(
      `name_pattern rejected: maximum length is ${MAX_REGEX_PATTERN_LENGTH} characters (got ${pattern.length}). Omit name_pattern only when no regex filter is intended.`
    );
  }
  if (CATASTROPHIC_BACKTRACK_HEURISTIC.test(pattern)) {
    throw new Error(
      `name_pattern rejected because it contains nested quantifiers that may cause catastrophic backtracking. Simplify the regex instead of retrying without the filter.`
    );
  }
  try {
    return new RegExp(pattern);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid name_pattern regex: ${reason}. Fix the pattern, or omit name_pattern only when no regex filter is intended.`
    );
  }
}

export function requireFiniteTranslatedElementVector3(
  values: readonly number[],
  offset: readonly number[],
  context: string
): [number, number, number] {
  if (values.length !== 3 || offset.length !== 3) {
    throw new Error(`${context} must be a 3D vector before duplication.`);
  }
  const translated: [number, number, number] = [
    values[0] + offset[0],
    values[1] + offset[1],
    values[2] + offset[2],
  ];
  if (translated.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `${context} plus the requested duplicate offset would produce a non-finite authored coordinate.`
    );
  }
  return translated;
}

export function hasCaseInsensitiveGroupNameCollision(
  groups: readonly { uuid: string; name: string }[],
  requestedName: string,
  excludeUuid?: string
): boolean {
  const normalized = requestedName.toLowerCase();
  return groups.some(
    (group) =>
      group.uuid !== excludeUuid && group.name.toLowerCase() === normalized
  );
}

export function assertGroupNameAvailable(name: string, excludeUuid?: string): void {
  if (hasCaseInsensitiveGroupNameCollision(Group.all, name, excludeUuid)) {
    const conflicts = Group.all
      .filter(
        (group) =>
          group.uuid !== excludeUuid &&
          group.name.toLowerCase() === name.toLowerCase()
      )
      .map((group) => `${group.name} (${group.uuid})`)
      .join(", ");
    throw new Error(
      `Bedrock Group/bone name "${name}" collides case-insensitively with existing Group(s): ${conflicts}. Bone names must stay unique for deterministic Bedrock animation/export binding.`
    );
  }
}

export function assertBatchGroupNamesAvailable(
  batch: readonly { name: string }[]
): void {
  const occupied = new Map<string, string>();
  for (const group of Group.all) {
    occupied.set(group.name.toLowerCase(), `${group.name} (${group.uuid})`);
  }

  for (const entry of batch) {
    const key = entry.name.toLowerCase();
    const existing = occupied.get(key);
    if (existing) {
      throw new Error(
        `Bedrock Group/bone name "${entry.name}" collides case-insensitively with ${existing}. Group names must be unique before creating the batch.`
      );
    }
    occupied.set(key, `planned Group "${entry.name}"`);
  }
}

export type PlannedGroupParent = Group | "root" | number;

export function planGroupBatchParents(
  batch: readonly { name: string; parent?: string }[]
): PlannedGroupParent[] {
  const earlierByExactName = new Map<string, number>();
  return batch.map((entry, index) => {
    const reference = entry.parent ?? "root";
    let planned: PlannedGroupParent;
    if (reference === "root") {
      planned = "root";
    } else {
      const earlierIndex = earlierByExactName.get(reference);
      planned = earlierIndex !== undefined
        ? earlierIndex
        : resolveParentGroup(reference);
    }
    earlierByExactName.set(entry.name, index);
    return planned;
  });
}

export function locatorExportKey(element: Locator | NullObject, name = element.name): string {
  return element instanceof NullObject ? `_null_${name}` : name;
}

export function assertAnchorRenameAvailable(
  element: Locator | NullObject,
  requestedName: string
): void {
  const parent = element.parent;
  if (!(parent instanceof Group)) {
    throw new Error(
      `${continuationElementType(element)} ${element.name} (${element.uuid}) has no Group parent; Bedrock locator identity cannot be validated safely.`
    );
  }
  const requestedKey = locatorExportKey(element, requestedName);
  const conflict = parent.children.find(
    (child) =>
      child !== element &&
      (child instanceof Locator || child instanceof NullObject) &&
      locatorExportKey(child) === requestedKey
  );
  if (conflict && (conflict instanceof Locator || conflict instanceof NullObject)) {
    throw new Error(
      `Renaming ${continuationElementType(element)} "${element.name}" to "${requestedName}" would collide with exported locator key "${requestedKey}" already owned by ${continuationElementType(conflict)} "${conflict.name}" (${conflict.uuid}) under Group "${parent.name}".`
    );
  }
}

export function preflightDuplicateTranslation(
  element: unknown,
  offset: readonly number[]
): void {
  if (element instanceof Cube) {
    requireFiniteTranslatedElementVector3(element.from, offset, `Cube ${element.name} (${element.uuid}) from`);
    requireFiniteTranslatedElementVector3(element.to, offset, `Cube ${element.name} (${element.uuid}) to`);
    requireFiniteTranslatedElementVector3(element.origin, offset, `Cube ${element.name} (${element.uuid}) origin`);
    return;
  }
  if (element instanceof Group) {
    requireFiniteTranslatedElementVector3(element.origin, offset, `Group ${element.name} (${element.uuid}) origin`);
    for (const child of element.children) {
      preflightDuplicateTranslation(child, offset);
    }
    return;
  }
  if (element instanceof Locator || element instanceof NullObject) {
    requireFiniteTranslatedElementVector3(
      element.position,
      offset,
      `${continuationElementType(element)} ${element.name} (${element.uuid}) position`
    );
    return;
  }
  throw new Error(
    "The Bedrock Cuboid duplicate workflow supports only Cube/Group targets and Cube/Group/Locator/Null Object descendants."
  );
}

export function preflightDuplicateGroupNames(
  source: Cube | Group,
  newName?: string
): void {
  if (!(source instanceof Group)) return;

  const occupied = new Map<string, string>();
  for (const group of Group.all) {
    occupied.set(group.name.toLowerCase(), `${group.name} (${group.uuid})`);
  }

  const visit = (group: Group, isRoot: boolean) => {
    const plannedName = isRoot && newName ? newName : `${group.name}_copy`;
    const key = plannedName.toLowerCase();
    const conflict = occupied.get(key);
    if (conflict) {
      throw new Error(
        `Duplicating Group "${group.name}" would create Bedrock bone name "${plannedName}", which collides case-insensitively with ${conflict}. Choose a different root name or rename the conflicting Group first.`
      );
    }
    occupied.set(key, `planned Group "${plannedName}"`);
    for (const child of group.children) {
      if (child instanceof Group) visit(child, false);
    }
  };

  visit(source, true);
}

export function preflightFaithfulDuplicate(
  element: Cube | Group,
  offset: readonly number[],
  newName?: string
): void {
  preflightDuplicateTranslation(element, offset);
  preflightDuplicateGroupNames(element, newName);
}

export function translateDuplicatedSubtree(
  element: Cube | Group | Locator | NullObject,
  offset: readonly number[]
): void {
  if (element instanceof Cube) {
    element.from = requireFiniteTranslatedElementVector3(
      element.from,
      offset,
      `Duplicated Cube ${element.name} (${element.uuid}) from`
    );
    element.to = requireFiniteTranslatedElementVector3(
      element.to,
      offset,
      `Duplicated Cube ${element.name} (${element.uuid}) to`
    );
    element.origin = requireFiniteTranslatedElementVector3(
      element.origin,
      offset,
      `Duplicated Cube ${element.name} (${element.uuid}) origin`
    );
    return;
  }

  if (element instanceof Group) {
    element.origin = requireFiniteTranslatedElementVector3(
      element.origin,
      offset,
      `Duplicated Group ${element.name} (${element.uuid}) origin`
    );
    for (const child of element.children) {
      if (
        child instanceof Cube ||
        child instanceof Group ||
        child instanceof Locator ||
        child instanceof NullObject
      ) {
        translateDuplicatedSubtree(child, offset);
      } else {
        throw new Error(
          `Duplicated Group "${element.name}" contains unsupported descendant type ${String((child as { type?: unknown }).type ?? "unknown")}.`
        );
      }
    }
    return;
  }

  element.position = requireFiniteTranslatedElementVector3(
    element.position,
    offset,
    `Duplicated ${continuationElementType(element)} ${element.name} (${element.uuid}) position`
  );
}

export function applyDuplicateNames(
  source: Cube | Group | Locator | NullObject,
  copy: Cube | Group | Locator | NullObject,
  newName: string | undefined,
  isRoot: boolean
): void {
  copy.name = isRoot && newName ? newName : `${source.name}_copy`;

  if (source instanceof Group && copy instanceof Group) {
    if (source.children.length !== copy.children.length) {
      throw new Error(
        `Native duplicate of Group "${source.name}" changed descendant count (${source.children.length} -> ${copy.children.length}); refusing to claim faithful duplication.`
      );
    }
    source.children.forEach((sourceChild, index) => {
      const copyChild = copy.children[index];
      if (
        (sourceChild instanceof Cube ||
          sourceChild instanceof Group ||
          sourceChild instanceof Locator ||
          sourceChild instanceof NullObject) &&
        (copyChild instanceof Cube ||
          copyChild instanceof Group ||
          copyChild instanceof Locator ||
          copyChild instanceof NullObject)
      ) {
        applyDuplicateNames(sourceChild, copyChild, undefined, false);
        return;
      }
      throw new Error(
        `Native duplicate of Group "${source.name}" produced an unsupported or mismatched descendant at index ${index}.`
      );
    });
  }
}

export function duplicateFaithfully(
  element: Cube | Group,
  offset: readonly number[],
  newName?: string
): Cube | Group {
  const duplicated = element.duplicate();
  if (!(duplicated instanceof Cube) && !(duplicated instanceof Group)) {
    throw new Error(
      `Native Blockbench duplicate returned unsupported type for ${element.name} (${element.uuid}).`
    );
  }

  applyDuplicateNames(element, duplicated, newName, true);
  translateDuplicatedSubtree(duplicated, offset);
  return duplicated;
}

export function vector3Equals(
  first: ArrayLike<number>,
  second: ArrayLike<number>
): boolean {
  return (
    first.length === second.length &&
    first[0] === second[0] &&
    first[1] === second[1] &&
    first[2] === second[2]
  );
}