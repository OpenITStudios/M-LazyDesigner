import type { UvLayoutPlan } from "@/lib/uv/contracts";
import {
  assertUvNativeInstructionsApplied,
  assertUvNativeMutationScoped,
  assertUvPlanSourceFresh,
  fingerprintUvNativeSource,
  translateUvPlanToNativeInstructions,
  type UvNativeMutationInstruction,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import { requireValidUvLayoutPlan } from "@/lib/uv/validatePlan";
import {
  prepareUvPixelMigration,
  type UvMigrationAtlas,
  type UvMigrationCandidate,
  UV_MIGRATION_MAX_BITMAP_PIXELS,
  UV_MIGRATION_MAX_TEXTURES,
  UV_MIGRATION_MAX_TOTAL_RGBA_BYTES,
} from "@/lib/uv/pixelMigration";
import {
  computeTextureRevision,
  requireTextureRevisionMatch,
} from "@/lib/texture/revision";
import { textureRevisionSchema } from "@/lib/texture/evidence";
import { requireUnchangedTextureBitmap } from "@/lib/texture/bitmapRuntime";

/**
 * A native adapter must enumerate every UV owner and every Texture in the
 * project, not only selected Cubes or base-color textures. The source layer
 * can verify the manifest's consistency; it CANNOT attest that a real
 * Blockbench adapter enumerated the entire installed scene.
 */
export type UvPixelMigrationSceneScope = {
  project_uuid: string;
  all_cube_uuids: string[];
  all_texture_uuids: string[];
  uv_owner_scope: "complete_cube_only";
  unsupported_uv_owner_count: 0;
};

export type UvPixelMigrationScopedState = {
  uv: UvNativeSourceSnapshot;
  atlases: UvMigrationAtlas[];
  scope: UvPixelMigrationSceneScope;
};

/**
 * Native adapter contract only. No production adapter or public Gateway route
 * is registered. A future adapter MUST serialize the Runtime mutation, read
 * complete decoded RGBA, and hold ONE native Undo unit with bitmap+UV aspects.
 */
export type UvPixelMigrationAtomicAdapter = {
  readState(): UvPixelMigrationScopedState | Promise<UvPixelMigrationScopedState>;
  /** Synchronous native ownership acquisition; never return a pending Promise. */
  beginUndo(
    instructions: readonly UvNativeMutationInstruction[],
    textureUuids: readonly string[]
  ): void;
  applyAtlases(candidates: readonly UvMigrationCandidate[]): void | Promise<void>;
  applyUv(instructions: readonly UvNativeMutationInstruction[]): void | Promise<void>;
  /** Restore BOTH original RGBA and every affected native UV state. */
  restoreAll(before: UvPixelMigrationScopedState): void | Promise<void>;
  cancelUndo(): void | Promise<void>;
  /** Synchronous irreversible commit boundary. */
  finishUndo(): void;
};

export class UvPixelMigrationOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true;
  constructor(
    readonly originalFailure: unknown,
    readonly recoveryFailures: readonly unknown[]
  ) {
    const detail = originalFailure instanceof Error
      ? originalFailure.message : String(originalFailure);
    super("UV_PIXEL_MIGRATION_OUTCOME_UNKNOWN: " + detail +
      ". Native bitmap/UV state or Undo history may be partially modified; " +
      "inspect the actual scene before any new mutation.", { cause: originalFailure });
    this.name = "UvPixelMigrationOutcomeUnknownError";
  }
}

function sortedUnique(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values) ||
      values.some(value => typeof value !== "string" || !value.trim()) ||
      new Set(values).size !== values.length) {
    throw new Error("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE: " + label +
      " requires unique non-empty UUIDs.");
  }
  return [...values].sort();
}

function exactIds(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify(sortedUnique(a, "scene owner IDs")) ===
    JSON.stringify(sortedUnique(b, "native owner IDs"));
}

function validateCompleteScene(state: UvPixelMigrationScopedState): void {
  const { scope, uv, atlases } = state;
  if (!scope || scope.uv_owner_scope !== "complete_cube_only" ||
      scope.unsupported_uv_owner_count !== 0 ||
      !scope.project_uuid?.trim() || scope.project_uuid !== uv.project_uuid) {
    throw new Error("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE: require one pinned " +
      "project with an explicitly complete Cube-only UV ownership inventory.");
  }
  if (!exactIds(scope.all_cube_uuids, uv.cubes.map(cube => cube.uuid)) ||
      !exactIds(scope.all_texture_uuids, atlases.map(atlas => atlas.texture_uuid)) ||
      atlases.length === 0) {
    throw new Error("UV_PIXEL_MIGRATION_SCOPE_INCOMPLETE: all native Cube " +
      "and project Texture UUIDs must exactly match the scene inventory.");
  }
}

function requireBoundedAtlasInventory(
  atlases: readonly UvMigrationAtlas[]
): void {
  if (atlases.length === 0 || atlases.length > UV_MIGRATION_MAX_TEXTURES) {
    throw new Error("UV_PIXEL_MIGRATION_ATLAS_SCOPE: a migration needs 1..16 dependent atlases.");
  }
  const width = atlases[0].width, height = atlases[0].height;
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(pixels) ||
      pixels > UV_MIGRATION_MAX_BITMAP_PIXELS ||
      pixels * 4 * atlases.length > UV_MIGRATION_MAX_TOTAL_RGBA_BYTES) {
    throw new Error("UV_PIXEL_MIGRATION_BITMAP_BUDGET: dependent atlases exceed the exact RGBA snapshot budget.");
  }
  for (const atlas of atlases) {
    if (atlas.width !== width || atlas.height !== height ||
        atlas.layers_enabled !== false || atlas.frame_count !== 1 ||
        !(atlas.pixels instanceof Uint8ClampedArray) ||
        atlas.pixels.byteLength !== pixels * 4) {
      throw new Error("UV_PIXEL_MIGRATION_ATLAS_SCOPE: project textures must have matching decoded, flattened single-frame RGBA.");
    }
  }
}

function snapshot(state: UvPixelMigrationScopedState): UvPixelMigrationScopedState {
  validateCompleteScene(state);
  requireBoundedAtlasInventory(state.atlases);
  return {
    uv: structuredClone(state.uv),
    scope: {
      ...state.scope,
      all_cube_uuids: [...state.scope.all_cube_uuids],
      all_texture_uuids: [...state.scope.all_texture_uuids],
    },
    atlases: state.atlases.map(atlas => ({
      ...atlas,
      pixels: new Uint8ClampedArray(atlas.pixels),
    })),
  };
}

function requireSameScene(
  expected: UvPixelMigrationScopedState,
  actual: UvPixelMigrationScopedState
): void {
  validateCompleteScene(actual);
  requireBoundedAtlasInventory(actual.atlases);
  if (expected.scope.project_uuid !== actual.scope.project_uuid ||
      !exactIds(expected.scope.all_cube_uuids, actual.scope.all_cube_uuids) ||
      !exactIds(expected.scope.all_texture_uuids, actual.scope.all_texture_uuids)) {
    throw new Error("UV_PIXEL_MIGRATION_SCENE_CHANGED: project or owner " +
      "inventory changed during the transaction.");
  }
}

function requireAtlasBytes(
  expected: readonly UvMigrationAtlas[],
  actual: readonly UvMigrationAtlas[],
  label: string
): void {
  const byId = new Map(actual.map(atlas => [atlas.texture_uuid, atlas]));
  for (const atlas of expected) {
    const now = byId.get(atlas.texture_uuid);
    if (!now || atlas.layers_enabled !== now.layers_enabled ||
        atlas.frame_count !== now.frame_count) {
      throw new Error("UV_PIXEL_MIGRATION_STALE_BITMAP: " + label +
        " texture identity or layer/frame state changed.");
    }
    requireUnchangedTextureBitmap(atlas, now,
      "UV_PIXEL_MIGRATION_STALE_BITMAP: " + label + " " + atlas.texture_uuid);
  }
}

async function revisions(
  atlases: readonly UvMigrationAtlas[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const atlas of atlases) {
    result[atlas.texture_uuid] = await computeTextureRevision(
      atlas.pixels, atlas.width, atlas.height
    );
  }
  return result;
}

function expectedRevisionKeys(
  expected: Readonly<Record<string, string>>,
  atlasIds: readonly string[]
): void {
  if (!expected || !exactIds(Object.keys(expected), atlasIds)) {
    throw new Error("UV_PIXEL_MIGRATION_REVISION_SCOPE: supply a revision " +
      "for each and only each project texture.");
  }
  for (const revision of Object.values(expected)) {
    textureRevisionSchema.parse(revision);
  }
}

/**
 * All-or-nothing *adapter contract*, NOT an activated native Blockbench
 * implementation. Any adapter success here means its interface returned,
 * not that installed Undo, persistence, or visual parity has been proven.
 */
export async function applyUvPixelMigrationAtomic(input: {
  plan: UvLayoutPlan;
  expected_source_fingerprint: string;
  expected_atlas_revisions: Readonly<Record<string, string>>;
  adapter: UvPixelMigrationAtomicAdapter;
}) {
  const { plan, adapter, expected_source_fingerprint } = input;
  if (plan.moved_island_ids.length === 0) {
    throw new Error("UV_PIXEL_MIGRATION_NO_OP: no moved UV islands.");
  }
  requireValidUvLayoutPlan(plan);

  const original = snapshot(await adapter.readState());
  assertUvPlanSourceFresh(expected_source_fingerprint, original.uv);
  expectedRevisionKeys(input.expected_atlas_revisions,
    original.scope.all_texture_uuids);

  const beforeRevisions = await revisions(original.atlases);
  for (const [uuid, revision] of Object.entries(input.expected_atlas_revisions)) {
    requireTextureRevisionMatch(revision, beforeRevisions[uuid],
      "UV migration atlas " + uuid);
  }

  const planned = prepareUvPixelMigration({
    plan,
    native_before: original.uv,
    expected_source_fingerprint,
    atlases: original.atlases,
  });
  const instructions = translateUvPlanToNativeInstructions(plan, original.uv);
  const candidateAtlases: UvMigrationAtlas[] = planned.candidates.map(candidate => {
    const before = original.atlases.find(atlas =>
      atlas.texture_uuid === candidate.texture_uuid)!;
    return { ...before, pixels: new Uint8ClampedArray(candidate.pixels) };
  });
  const afterRevisions = await revisions(candidateAtlases);

  // Hashing and preparation await; re-read every source byte and owner
  // immediately before the synchronous native beginUndo boundary.
  const beforeUndo = await adapter.readState();
  requireSameScene(original, beforeUndo);
  assertUvPlanSourceFresh(expected_source_fingerprint, beforeUndo.uv);
  requireAtlasBytes(original.atlases, beforeUndo.atlases, "before Undo");

  let opened = false;
  let commitStarted = false;
  try {
    // A native adapter must synchronously own both texture and UV Undo
    // aspects. If beginUndo throws after a partial open, ownership is
    // uncertain; unlike a known-open edit it is not safe to restore blindly.
    try {
      const beginResult: unknown = (
        adapter.beginUndo as (
          commands: readonly UvNativeMutationInstruction[],
          textureIds: readonly string[]
        ) => unknown
      )(instructions, original.scope.all_texture_uuids);
      if (beginResult && typeof beginResult === "object" &&
          "then" in beginResult) {
        throw new Error("UV_PIXEL_MIGRATION_ASYNC_UNDO: beginUndo must acquire the native edit synchronously.");
      }
      opened = true;
    } catch (error) {
      throw new UvPixelMigrationOutcomeUnknownError(error, []);
    }

    // Do not let an adapter mutate the expected candidate buffers to make
    // erroneous native readback appear successful.
    await adapter.applyAtlases(planned.candidates.map(candidate => ({
      ...candidate,
      pixels: new Uint8ClampedArray(candidate.pixels),
    })));
    await adapter.applyUv(instructions);

    const after = await adapter.readState();
    requireSameScene(original, after);
    assertUvNativeInstructionsApplied(instructions, after.uv);
    assertUvNativeMutationScoped(instructions, original.uv, after.uv);
    const afterFingerprint = fingerprintUvNativeSource(after.uv);
    if (afterFingerprint === expected_source_fingerprint) {
      throw new Error("UV_PIXEL_MIGRATION_POSTCONDITION: UV geometry did not change.");
    }
    requireAtlasBytes(candidateAtlases, after.atlases, "after native apply");
    const nativeRevisions = await revisions(after.atlases);
    for (const [uuid, revision] of Object.entries(afterRevisions)) {
      if (nativeRevisions[uuid] !== revision) {
        throw new Error("UV_PIXEL_MIGRATION_POSTCONDITION: native " +
          "decoded pixels disagree with the planned atlas " + uuid + ".");
      }
    }

    // A fresh read is mandatory after asynchronous digests. Do not publish
    // a receipt for an atlas or UV state that changed before finishUndo.
    const final = await adapter.readState();
    requireSameScene(original, final);
    if (fingerprintUvNativeSource(final.uv) !== afterFingerprint) {
      throw new Error("UV_PIXEL_MIGRATION_STALE_POSTCONDITION: UV changed " +
        "after native apply verification.");
    }
    requireAtlasBytes(candidateAtlases, final.atlases, "before Undo commit");

    const receipt = {
      execution: "committed_by_adapter" as const,
      source_fingerprint: expected_source_fingerprint,
      after_fingerprint: afterFingerprint,
      moved_island_ids: [...planned.moved_island_ids],
      texture_revisions: original.scope.all_texture_uuids.map(uuid => ({
        texture_uuid: uuid,
        before_revision: beforeRevisions[uuid],
        after_revision: afterRevisions[uuid],
      })),
      native_runtime_attested: false as const,
      saved_model_attested: false as const,
      visual_verdict: "not_evaluated" as const,
    };
    commitStarted = true;
    const commitResult: unknown = (
      adapter.finishUndo as () => unknown
    )();
    if (commitResult && typeof commitResult === "object" &&
        "then" in commitResult) {
      throw new Error("UV_PIXEL_MIGRATION_ASYNC_UNDO: finishUndo must finish the native edit synchronously.");
    }
    return receipt;
  } catch (error) {
    if (!opened || commitStarted ||
        error instanceof UvPixelMigrationOutcomeUnknownError) {
      if (error instanceof UvPixelMigrationOutcomeUnknownError) throw error;
      throw new UvPixelMigrationOutcomeUnknownError(error, []);
    }
    const recoveryFailures: unknown[] = [];
    try {
      await adapter.restoreAll(snapshot(original));
    } catch (restoreError) {
      recoveryFailures.push(restoreError);
    }
    try {
      await adapter.cancelUndo();
    } catch (cancelError) {
      recoveryFailures.push(cancelError);
    }
    try {
      const restored = await adapter.readState();
      requireSameScene(original, restored);
      assertUvPlanSourceFresh(expected_source_fingerprint, restored.uv);
      requireAtlasBytes(original.atlases, restored.atlases, "after rollback");
    } catch (verificationError) {
      recoveryFailures.push(verificationError);
    }
    if (recoveryFailures.length > 0) {
      throw new UvPixelMigrationOutcomeUnknownError(error, recoveryFailures);
    }
    throw error;
  }
}
