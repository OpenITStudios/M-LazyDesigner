/// <reference types="blockbench-types" />

export interface CoreIdentityRecord {
  uuid: string;
  name: string;
}

export interface CoreTextureIdentityRecord extends CoreIdentityRecord {
  id: string;
}

export interface CoreIdentityResolveOptions<T extends CoreIdentityRecord> {
  kind: string;
  notFoundHint: string;
  describeCandidate?: (item: T) => string;
}

function describeIdentity(item: CoreIdentityRecord): string {
  return `${item.name} (${item.uuid})`;
}

/**
 * Do not let a malformed model with duplicate UUIDs silently choose the first
 * authored object. Identical object references may appear in two registries
 * and are not distinct targets.
 */
function uniqueUuidMatch<T extends CoreIdentityRecord>(
  items: readonly T[],
  reference: string,
  options: CoreIdentityResolveOptions<T>
): T | null {
  let match: T | null = null;
  for (const item of items) {
    if (item.uuid !== reference) continue;
    if (match !== null && match !== item) {
      const describe = options.describeCandidate ?? describeIdentity;
      throw new Error(
        `${options.kind} UUID "${reference}" is ambiguous across distinct authored objects. ` +
        `Repair duplicate UUIDs before mutation. Candidates: ${describe(match)}, ${describe(item)}`
      );
    }
    match = item;
  }
  return match;
}

export function resolveUniqueUuid<T extends CoreIdentityRecord>(
  items: readonly T[],
  reference: string,
  options: CoreIdentityResolveOptions<T>
): T {
  const match = uniqueUuidMatch(items, reference, options);
  if (match !== null) return match;
  throw new Error(
    `${options.kind} UUID "${reference}" not found. ${options.notFoundHint}`
  );
}

/**
 * Shared deterministic identity contract for the retained Bedrock Entity core.
 * Explicit references resolve exact UUID first, then exact name only when unique.
 * No prefix matching, selection fallback, or silent default target is performed.
 */
export function resolveUuidOrUniqueName<T extends CoreIdentityRecord>(
  items: readonly T[],
  reference: string,
  options: CoreIdentityResolveOptions<T>
): T {
  const uuidMatch = uniqueUuidMatch(items, reference, options);
  if (uuidMatch !== null) return uuidMatch;

  // The same Group object can occur in Outliner and Group registries. The
  // repeated reference does not make a unique name ambiguous.
  const nameMatches = [...new Set(items.filter((item) => item.name === reference))];
  if (nameMatches.length === 1) {
    // A unique name is not safe when another object shares its UUID: native
    // Undo and animation references may still address that colliding ID.
    return resolveUniqueUuid(items, nameMatches[0].uuid, options);
  }

  const describe = options.describeCandidate ?? describeIdentity;
  if (nameMatches.length > 1) {
    throw new Error(
      `${options.kind} name "${reference}" is ambiguous. Use an exact UUID. Candidates: ${nameMatches
        .map(describe)
        .join(", ")}`
    );
  }

  throw new Error(
    `${options.kind} "${reference}" not found. ${options.notFoundHint}`
  );
}

/**
 * Texture identity adds one intentional intermediate key: exact texture ID.
 * Resolution order is UUID -> unique ID -> unique name.
 */
export function resolveTextureIdentity<T extends CoreTextureIdentityRecord>(
  items: readonly T[],
  reference: string,
  notFoundHint: string
): T {
  const uuidMatch = items.find((item) => item.uuid === reference);
  if (uuidMatch) return uuidMatch;

  const describe = (item: T) =>
    `${item.name} (id: ${item.id}, uuid: ${item.uuid})`;

  const idMatches = items.filter((item) => item.id === reference);
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) {
    throw new Error(
      `Texture ID "${reference}" is ambiguous. Use an exact UUID. Candidates: ${idMatches
        .map(describe)
        .join(", ")}`
    );
  }

  const nameMatches = items.filter((item) => item.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Texture name "${reference}" is ambiguous. Use an exact UUID or texture ID. Candidates: ${nameMatches
        .map(describe)
        .join(", ")}`
    );
  }

  throw new Error(`Texture "${reference}" not found. ${notFoundHint}`);
}

export function resolveCoreCube(
  reference: string,
  notFoundHint =
    "Use inspect_elements with mode=outline/search, then mode=detail to confirm the intended Cube UUID."
) {
  return resolveUuidOrUniqueName(Cube.all ?? [], reference, {
    kind: "Cube",
    notFoundHint,
  });
}

export function resolveCoreGroup(
  reference: string,
  notFoundHint = "Use inspect_elements with mode=outline to confirm the intended Group UUID."
) {
  return resolveUuidOrUniqueName(Group.all ?? [], reference, {
    kind: "Group",
    notFoundHint,
  });
}

export function resolveCoreCubeOrGroup(
  reference: string,
  notFoundHint =
    "Use inspect_elements with mode=outline/search to confirm the intended Cube/Group UUID."
) {
  return resolveUuidOrUniqueName(
    [...(Cube.all ?? []), ...(Group.all ?? [])] as Array<Cube | Group>,
    reference,
    {
      kind: "Element",
      notFoundHint,
      describeCandidate: (item) =>
        `${item instanceof Cube ? "cube" : "group"} ${item.name} (${item.uuid})`,
    }
  );
}

export function resolveCoreTexture(
  reference: string,
  notFoundHint = "Use list_textures to confirm the intended UUID or texture ID."
) {
  return resolveTextureIdentity(
    (Project?.textures ?? Texture.all ?? []) as Texture[],
    reference,
    notFoundHint
  );
}

function isCoreAnimationControllerItem(
  item: BBAnimation | AnimationController
): item is AnimationController {
  return (
    typeof AnimationController !== "undefined" &&
    item instanceof AnimationController
  );
}

function currentCoreAuthoredAnimations(): BBAnimation[] {
  return ((AnimationItem.all ?? []) as unknown as Array<BBAnimation | AnimationController>).filter(
    (item): item is BBAnimation => !isCoreAnimationControllerItem(item)
  );
}

export function resolveCoreAnimation(
  reference?: string,
  options: {
    allowSelected?: boolean;
    notFoundHint?: string;
  } = {}
) {
  const animations = currentCoreAuthoredAnimations();
  if (reference === undefined) {
    const selected = AnimationItem.selected as unknown as
      | BBAnimation
      | AnimationController
      | null;
    if (
      options.allowSelected &&
      selected &&
      !isCoreAnimationControllerItem(selected)
    ) {
      return selected;
    }
    if (options.allowSelected && selected) {
      throw new Error(
        "The selected AnimationItem is an AnimationController, not an authored Animation. Select an authored Animation or pass its exact UUID/name."
      );
    }
    throw new Error(
      "No animation target was provided. Pass an exact Animation UUID or exact unique Animation name."
    );
  }

  return resolveUuidOrUniqueName(animations, reference, {
    kind: "Animation",
    notFoundHint:
      options.notFoundHint ??
      "Pass an exact Animation UUID or exact unique Animation name.",
  });
}
