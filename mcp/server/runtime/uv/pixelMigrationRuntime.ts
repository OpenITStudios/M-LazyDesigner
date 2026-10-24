/// <reference types="blockbench-types" />

import type { UvFaceKey } from "@/lib/uv/contracts";
import {
  fingerprintUvNativeSource,
  type UvNativeMutationInstruction,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  type UvPixelMigrationAtomicAdapter,
  type UvPixelMigrationScopedState,
} from "@/lib/uv/pixelMigrationTransaction";
import {
  type UvMigrationCandidate,
  UV_MIGRATION_MAX_TEXTURES,
  UV_MIGRATION_MAX_BITMAP_PIXELS,
  UV_MIGRATION_MAX_TOTAL_RGBA_BYTES,
} from "@/lib/uv/pixelMigration";
import {
  fullTextureRgba,
  requireUnchangedTextureBitmap,
} from "@/lib/texture/bitmapRuntime";
import {
  applyBlockbenchUvInstructions,
  readBlockbenchUvNativeSource,
  restoreBlockbenchUvNativeSource,
} from "./layoutRuntime";

/**
 * Native-only owner for a future, explicitly activated combined transaction.
 * Neither this factory nor the pure migration coordinator is registered as
 * a Runtime/Gateway capability. No existing UV apply safety gate is bypassed.
 */
const FACE_KEYS: readonly UvFaceKey[] = [
  "north", "south", "east", "west", "up", "down",
];
const MAX_NATIVE_CUBES = 4096;

type NativeAtlas = {
  uuid: string;
  texture: Texture;
  width: number;
  height: number;
};

function requireCurrentProject(bound: ModelProject): void {
  if (typeof Project === "undefined" || Project !== bound ||
      typeof Project.uuid !== "string" || !Project.uuid.trim()) {
    throw new Error(
      "UV_PIXEL_MIGRATION_PROJECT_AFFINITY_LOST: active project tab changed."
    );
  }
  const open = typeof ModelProject !== "undefined" ? ModelProject.all : [];
  if (!Array.isArray(open) ||
      open.filter(project => project.uuid === bound.uuid).length !== 1 ||
      open.find(project => project.uuid === bound.uuid) !== bound) {
    throw new Error(
      "UV_PIXEL_MIGRATION_PROJECT_AMBIGUOUS: copied project UUID or missing active tab."
    );
  }
}

function completeCubeInventory(): Cube[] {
  if (typeof Cube === "undefined" || typeof Outliner === "undefined" ||
      !Array.isArray(Cube.all) || !Array.isArray(Outliner.elements) ||
      Cube.all.length > MAX_NATIVE_CUBES) {
    throw new Error(
      "UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED: cannot attest a bounded complete Cube-only scene."
    );
  }
  const cubes = [...Cube.all];
  const elements = [...Outliner.elements];
  const owners = new Set(cubes);
  if (owners.size !== cubes.length ||
      elements.length !== cubes.length ||
      new Set(elements).size !== elements.length ||
      elements.some(element => !owners.has(element as Cube))) {
    throw new Error(
      "UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED: Mesh, non-Cube, missing or duplicated Outliner UV owners require a separate migration policy."
    );
  }
  return cubes;
}

function completeTextureInventory(): NativeAtlas[] {
  if (typeof Texture === "undefined" ||
      !Array.isArray(Texture.all) ||
      !Array.isArray(Project?.textures)) {
    throw new Error(
      "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_UNAVAILABLE: project and native atlas inventories are required."
    );
  }
  const projectTextures = Project.textures;
  const textures = Texture.all;
  if (textures.length === 0 || textures.length > UV_MIGRATION_MAX_TEXTURES ||
      projectTextures.length !== textures.length ||
      new Set(projectTextures).size !== textures.length ||
      textures.some(texture => !projectTextures.includes(texture))) {
    throw new Error(
      "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: every project texture must match the native Texture collection."
    );
  }
  const uuids = new Set<string>();
  const atlases: NativeAtlas[] = [];
  let expectedWidth = 0, expectedHeight = 0;
  for (const texture of textures) {
    if (typeof texture.uuid !== "string" || !texture.uuid.trim() ||
        uuids.has(texture.uuid) || texture.layers_enabled === true ||
        (texture.frameCount ?? 1) !== 1 ||
        texture.height !== texture.display_height ||
        !Number.isSafeInteger(texture.width) ||
        !Number.isSafeInteger(texture.height) ||
        texture.width <= 0 || texture.height <= 0 ||
        texture.getUVWidth() !== Project.texture_width ||
        texture.getUVHeight() !== Project.texture_height) {
      throw new Error(
        "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: require unique, flattened, single-frame project-aligned atlases."
      );
    }
    uuids.add(texture.uuid);
    if (atlases.length === 0) {
      expectedWidth = texture.width;
      expectedHeight = texture.height;
    } else if (texture.width !== expectedWidth ||
               texture.height !== expectedHeight) {
      throw new Error(
        "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: base, variant and PBR atlas dimensions differ."
      );
    }
    atlases.push({
      uuid: texture.uuid, texture,
      width: texture.width, height: texture.height,
    });
  }
  const pixels = expectedWidth * expectedHeight;
  if (!Number.isSafeInteger(pixels) ||
      pixels > UV_MIGRATION_MAX_BITMAP_PIXELS ||
      pixels * 4 * atlases.length > UV_MIGRATION_MAX_TOTAL_RGBA_BYTES) {
    throw new Error(
      "UV_PIXEL_MIGRATION_BITMAP_BUDGET: complete native texture inventory exceeds the candidate limits."
    );
  }
  return atlases.sort((a, b) => a.uuid.localeCompare(b.uuid));
}

function exactFaceTextureBindings(
  cubes: readonly Cube[],
  atlases: readonly NativeAtlas[]
): UvPixelMigrationScopedState["scope"]["face_texture_bindings"] {
  const textureUuids = new Set(atlases.map(texture => texture.uuid));
  const bindings: UvPixelMigrationScopedState["scope"]["face_texture_bindings"] = [];
  for (const cube of cubes) {
    for (const key of FACE_KEYS) {
      const face = cube.faces[key];
      if (!face || typeof face.getTexture !== "function") {
        throw new Error(
          "UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED: native Cube face texture mapping unavailable."
        );
      }
      const texture = face.getTexture();
      const uuid = texture?.uuid ?? null;
      if (uuid !== null && !textureUuids.has(uuid)) {
        throw new Error(
          "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: face refers to an atlas outside the project."
        );
      }
      // Do not mistake a dangling authored UUID for an intentional untextured
      // face even if Blockbench resolves its texture to null.
      if (typeof face.texture === "string" && face.texture.trim() &&
          !textureUuids.has(face.texture)) {
        throw new Error(
          "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: face has a missing authored texture UUID."
        );
      }
      bindings.push({
        cube_uuid: cube.uuid, face: key, texture_uuid: uuid,
      });
    }
  }
  return bindings;
}

function writeNativeAtlas(
  native: NativeAtlas,
  pixels: Uint8ClampedArray
): void {
  if (pixels.length !== native.width * native.height * 4) {
    throw new Error(
      "UV_PIXEL_MIGRATION_NATIVE_BITMAP_INVALID: RGBA length differs from the pinned atlas."
    );
  }
  let callbacks = 0;
  native.texture.edit((
    canvas: HTMLCanvasElement,
    env: BlockbenchRuntimeTextureEditEnvironment
  ) => {
    callbacks += 1;
    if (callbacks !== 1 ||
        !canvas || canvas.width !== native.width ||
        canvas.height !== native.height ||
        !env || !env.ctx ||
        !Array.isArray(env.offset) ||
        env.offset[0] !== 0 || env.offset[1] !== 0 ||
        env.ctx.canvas.width !== native.width ||
        env.ctx.canvas.height !== native.height) {
      throw new Error(
        "UV_PIXEL_MIGRATION_NATIVE_FRAME_CHANGED: texture callback must own one exact full unlayered frame."
      );
    }
    const image = env.ctx.createImageData(native.width, native.height);
    image.data.set(pixels);
    env.ctx.putImageData(image, 0, 0);
  }, { no_undo: true });
  if (callbacks !== 1) {
    throw new Error(
      "UV_PIXEL_MIGRATION_NATIVE_WRITE_UNVERIFIED: Texture.edit skipped or repeated the full-image callback."
    );
  }
}

/**
 * Constructed only by a separately authorized native workflow. This source
 * factory is intentionally NOT registered in any public or internal tool.
 */
export function createBlockbenchUvPixelMigrationAdapter(): UvPixelMigrationAtomicAdapter {
  const bound = typeof Project !== "undefined" ? Project : null;
  if (!bound) throw new Error("UV_PIXEL_MIGRATION_PROJECT_REQUIRED: open a Blockbench model.");
  requireCurrentProject(bound);

  let ownedUndoSave: unknown = null;
  let lastPreflight: UvPixelMigrationScopedState | null = null;
  const requireBound = (): void => requireCurrentProject(bound);
  const requireOwnedUndo = (): void => {
    requireBound();
    if (!ownedUndoSave || Undo.current_save !== ownedUndoSave) {
      throw new Error(
        "UV_PIXEL_MIGRATION_UNDO_AFFINITY_LOST: active native edit differs from this transaction."
      );
    }
  };

  return {
    readState: () => {
      requireBound();
      const cubes = completeCubeInventory();
      const atlases = completeTextureInventory();
      const uv = readBlockbenchUvNativeSource();
      const bytes = atlases.map(atlas => {
        const bitmap = fullTextureRgba(atlas.texture);
        if (bitmap.width !== atlas.width || bitmap.height !== atlas.height ||
            bitmap.pixels.length !== atlas.width * atlas.height * 4) {
          throw new Error(
            "UV_PIXEL_MIGRATION_NATIVE_BITMAP_INVALID: decoded bitmap dimensions differ from declared atlas."
          );
        }
        return {
          texture_uuid: atlas.uuid,
          width: bitmap.width,
          height: bitmap.height,
          layers_enabled: false as const,
          frame_count: 1 as const,
          pixels: new Uint8ClampedArray(bitmap.pixels),
        };
      });
      const state: UvPixelMigrationScopedState = {
        uv,
        atlases: bytes,
        scope: {
          project_uuid: bound.uuid,
          all_cube_uuids: uv.cubes.map(cube => cube.uuid),
          all_texture_uuids: atlases.map(atlas => atlas.uuid),
          face_texture_bindings: exactFaceTextureBindings(cubes, atlases),
          uv_owner_scope: "complete_cube_only",
          unsupported_uv_owner_count: 0,
        },
      };
      if (!ownedUndoSave && !Undo.current_save) {
        // Core validation awaits digest operations. Cache an independent last
        // native read to reject a concurrent edit in the synchronous gap
        // between that read and Undo.initEdit.
        lastPreflight = {
          uv: structuredClone(state.uv),
          scope: structuredClone(state.scope),
          atlases: state.atlases.map(atlas => ({
            ...atlas, pixels: new Uint8ClampedArray(atlas.pixels),
          })),
        };
      }
      return state;
    },
    beginUndo: (instructions, textureUuids) => {
      requireBound();
      if (ownedUndoSave || Undo.current_save) {
        throw new Error(
          "UV_PIXEL_MIGRATION_UNDO_BUSY: finish the existing native edit before migration."
        );
      }
      const cubes = completeCubeInventory();
      const atlases = completeTextureInventory();
      const last = lastPreflight;
      if (!last ||
          fingerprintUvNativeSource(readBlockbenchUvNativeSource()) !==
            fingerprintUvNativeSource(last.uv)) {
        throw new Error(
          "UV_PIXEL_MIGRATION_STALE_NATIVE_PREFLIGHT: geometry/UV changed before native Undo."
        );
      }
      const bindingKeys = (bindings: UvPixelMigrationScopedState["scope"]["face_texture_bindings"]) =>
        bindings.map(binding => JSON.stringify([
          binding.cube_uuid, binding.face, binding.texture_uuid,
        ])).sort().join("\u0000");
      if (bindingKeys(exactFaceTextureBindings(cubes, atlases)) !==
          bindingKeys(last.scope.face_texture_bindings)) {
        throw new Error(
          "UV_PIXEL_MIGRATION_STALE_NATIVE_PREFLIGHT: face texture bindings changed before native Undo."
        );
      }
      for (const atlas of atlases) {
        const expected = last.atlases.find(item => item.texture_uuid === atlas.uuid);
        if (!expected) {
          throw new Error(
            "UV_PIXEL_MIGRATION_STALE_NATIVE_PREFLIGHT: a project atlas was added before native Undo."
          );
        }
        requireUnchangedTextureBitmap(expected, fullTextureRgba(atlas.texture),
          "UV_PIXEL_MIGRATION_STALE_NATIVE_PREFLIGHT: decoded pixels changed before native Undo.");
      }
      if (textureUuids.length !== atlases.length ||
          [...textureUuids].sort().join("\u0000") !==
            atlases.map(atlas => atlas.uuid).sort().join("\u0000")) {
        throw new Error(
          "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: native Undo must cover every project atlas."
        );
      }
      const cubesByUuid = new Set(cubes.map(cube => cube.uuid));
      if (instructions.some(instruction =>
          !cubesByUuid.has(instruction.cube_uuid))) {
        throw new Error(
          "UV_PIXEL_MIGRATION_SCENE_UNSUPPORTED: native UV target disappeared before Undo."
        );
      }
      try {
        Undo.initEdit({
          elements: cubes,
          textures: atlases.map(atlas => atlas.texture),
          bitmap: true,
          uv_only: true,
          uv_mode: true,
          selected_texture: true,
        });
        ownedUndoSave = Undo.current_save;
        if (!ownedUndoSave) {
          throw new Error(
            "UV_PIXEL_MIGRATION_UNDO_INIT_INCOMPLETE: native Undo did not record an owned edit."
          );
        }
      } catch (error) {
        // No prior edit existed before our synchronous initEdit call.
        // Only its newly opened partial Undo is eligible for cleanup.
        if (Undo.current_save) {
          try {
            Undo.cancelEdit(false);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "UV_PIXEL_MIGRATION_UNDO_INIT_INCOMPLETE: could not close owned partial edit."
            );
          }
        }
        ownedUndoSave = null;
        throw error;
      }
    },
    applyAtlases: candidates => {
      requireOwnedUndo();
      const atlases = completeTextureInventory();
      const candidatesById = new Map(candidates.map(candidate =>
        [candidate.texture_uuid, candidate]
      ));
      if (candidatesById.size !== atlases.length ||
          candidates.length !== atlases.length ||
          atlases.some(atlas => !candidatesById.has(atlas.uuid))) {
        throw new Error(
          "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: native bitmap apply requires every atlas candidate."
        );
      }
      // Validate all bitmap write dimensions before touching the first.
      for (const atlas of atlases) {
        const pixels = candidatesById.get(atlas.uuid)!.pixels;
        if (pixels.length !== atlas.width * atlas.height * 4) {
          throw new Error(
            "UV_PIXEL_MIGRATION_NATIVE_BITMAP_INVALID: one dependent atlas has invalid candidate bytes."
          );
        }
      }
      for (const atlas of atlases) {
        writeNativeAtlas(atlas, candidatesById.get(atlas.uuid)!.pixels);
      }
    },
    applyUv: instructions => {
      requireOwnedUndo();
      applyBlockbenchUvInstructions(instructions);
    },
    restoreAll: original => {
      requireOwnedUndo();
      const failures: unknown[] = [];
      try {
        const atlases = completeTextureInventory();
        const oldById = new Map(original.atlases.map(atlas =>
          [atlas.texture_uuid, atlas]
        ));
        if (oldById.size !== atlases.length ||
            atlases.some(atlas => !oldById.has(atlas.uuid))) {
          throw new Error(
            "UV_PIXEL_MIGRATION_TEXTURE_SCOPE_INCOMPLETE: cannot restore a different Texture inventory."
          );
        }
        for (const atlas of atlases) {
          try {
            writeNativeAtlas(atlas, oldById.get(atlas.uuid)!.pixels);
          } catch (error) {
            failures.push(error);
          }
        }
      } catch (error) {
        failures.push(error);
      }
      try {
        restoreBlockbenchUvNativeSource(original.uv);
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures, "UV_PIXEL_MIGRATION_NATIVE_RESTORE_INCOMPLETE: bitmap or UV restoration failed."
        );
      }
    },
    cancelUndo: () => {
      requireOwnedUndo();
      Undo.cancelEdit(false);
      ownedUndoSave = null;
      lastPreflight = null;
      Canvas.updateAll();
    },
    finishUndo: () => {
      requireOwnedUndo();
      Undo.finishEdit("LazyDesigner Texture + UV migration");
      if (Undo.current_save) {
        throw new Error(
          "UV_PIXEL_MIGRATION_UNDO_COMMIT_UNCERTAIN: native edit remained open."
        );
      }
      ownedUndoSave = null;
      lastPreflight = null;
      Canvas.updateAll();
    },
  };
}
