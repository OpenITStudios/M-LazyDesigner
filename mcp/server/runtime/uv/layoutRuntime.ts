/// <reference types="blockbench-types" />

import type { UvFaceKey } from "@/lib/uv/contracts";
import type { UvCubeSnapshot } from "@/lib/uv/islands";
import {
  buildUvNativeSourceSnapshot,
  type UvNativeMutationInstruction,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import {
  UvTransactionOutcomeUnknownError,
  type UvApplyAdapter,
} from "@/lib/uv/transaction";

const UV_FACE_KEYS: readonly UvFaceKey[] = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
];

/**
 * Native project identity is stronger than UUID alone: copied Blockbench tabs
 * can retain duplicate UUIDs. The active project must be the one unique match.
 */
function requireUniqueCurrentUvProject(): ModelProject {
  const current = typeof Project !== "undefined" ? Project : null;
  if (!current || typeof current.uuid !== "string" || !current.uuid.trim()) {
    throw new Error("UV_PROJECT_ID_REQUIRED: active Blockbench project has no stable UUID.");
  }
  const projects = typeof ModelProject !== "undefined" && Array.isArray(ModelProject.all)
    ? ModelProject.all : [];
  const matching = projects.filter(candidate => candidate.uuid === current.uuid);
  if (matching.length !== 1 || matching[0] !== current) {
    throw new Error("UV_PROJECT_AFFINITY_AMBIGUOUS: expected one unique active project tab.");
  }
  return current;
}

function requireProjectUvDimensions(): [number, number] {
  if (!Project) {
    throw new Error(
      "UV native adapter requires an open Blockbench project."
    );
  }
  const width = Project.texture_width;
  const height = Project.texture_height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      "UV native adapter requires positive finite logical project texture dimensions."
    );
  }
  return [width, height];
}

function currentUvCubesByUuid(): Map<string, Cube> {
  const byUuid = new Map<string, Cube>();
  for (const cube of Cube.all ?? []) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim()) {
      throw new Error("UV_CUBE_ID_REQUIRED: every Cube must have a stable non-empty UUID.");
    }
    if (byUuid.has(cube.uuid)) {
      throw new Error(
        `UV_CUBE_ID_AMBIGUOUS: Cube UUID "${cube.uuid}" belongs to multiple elements.`
      );
    }
    byUuid.set(cube.uuid, cube);
  }
  return byUuid;
}

function resolveCubeUuid(uuid: string, cubes: ReadonlyMap<string, Cube>): Cube {
  const cube = cubes.get(uuid);
  if (!cube) {
    throw new Error(
      `UV native adapter could not find Cube UUID "${uuid}".`
    );
  }
  return cube;
}

function blockbenchCubeSnapshot(cube: Cube): UvCubeSnapshot {
  return {
    uuid: cube.uuid,
    name: cube.name,
    from: [...cube.from],
    to: [...cube.to],
    box_uv: cube.box_uv === true,
    uv_offset: [...cube.uv_offset],
    autouv: cube.autouv,
    mirror_uv: cube.mirror_uv === true,
    faces: UV_FACE_KEYS.map((faceKey) => {
      const face = cube.faces[faceKey];
      return {
        face: faceKey,
        uv: [...face.uv],
        rotation: face.rotation,
        enabled: face.enabled !== false,
      };
    }),
  };
}

export function readBlockbenchUvNativeSource(): UvNativeSourceSnapshot {
  const [logicalWidth, logicalHeight] =
    requireProjectUvDimensions();
  const projectUuid = requireUniqueCurrentUvProject().uuid;
  return buildUvNativeSourceSnapshot(
    [...currentUvCubesByUuid().values()].map((cube) =>
      blockbenchCubeSnapshot(cube)
    ),
    logicalWidth,
    logicalHeight,
    projectUuid
  );
}

export function applyBlockbenchUvInstructions(
  instructions: readonly UvNativeMutationInstruction[]
): void {
  requireUniqueCurrentUvProject();
  const cubes = currentUvCubesByUuid();
  // Validate the entire batch before the first native extend(). A missing or
  // incompatible later target must never leave an earlier Cube half-edited.
  const prepared = instructions.map((instruction) => {
    const cube = resolveCubeUuid(instruction.cube_uuid, cubes);
    if (instruction.kind === "BOX_UV_OFFSET") {
      if (cube.box_uv !== true) {
        throw new Error(
          `UV native adapter expected Box UV for Cube ${cube.uuid}.`
        );
      }
    } else {
      if (cube.box_uv === true) {
        throw new Error(
          `UV native adapter expected per-face UV for Cube ${cube.uuid}.`
        );
      }
      if (!cube.faces[instruction.face]) {
        throw new Error(
          `UV native adapter could not find face ${instruction.face} on Cube ${cube.uuid}.`
        );
      }
    }
    return { instruction, cube };
  });
  for (const { instruction, cube } of prepared) {
    if (instruction.kind === "BOX_UV_OFFSET") {
      cube.extend({
        uv_offset: [...instruction.uv_offset] as [number, number],
      });
      continue;
    }
    cube.faces[instruction.face].extend({
      uv: [...instruction.uv] as [number, number, number, number],
      rotation: instruction.rotation,
    });
  }
  Canvas.updateAll();
}

export function restoreBlockbenchUvNativeSource(
  snapshot: UvNativeSourceSnapshot
): void {
  if (!snapshot.project_uuid ||
      requireUniqueCurrentUvProject().uuid !== snapshot.project_uuid) {
    throw new Error(
      "UV_PROJECT_AFFINITY_LOST: cannot restore UV state into another Blockbench project."
    );
  }
  const [width, height] = requireProjectUvDimensions();
  if (
    width !== snapshot.logical_width ||
    height !== snapshot.logical_height
  ) {
    throw new Error(
      "UV rollback refused because logical project UV dimensions changed."
    );
  }

  const cubes = currentUvCubesByUuid();
  if (cubes.size !== snapshot.cubes.length) {
    throw new Error("UV_ROLLBACK_TARGET_CHANGED: Cube count changed before UV restoration.");
  }
  // Validate every Cube/face before restoring any of them. A missing later
  // target must not partially rewrite an earlier Cube during rollback.
  const prepared = snapshot.cubes.map((saved) => {
    const cube = resolveCubeUuid(saved.uuid, cubes);
    for (const face of saved.faces) {
      if (!cube.faces[face.face]) {
        throw new Error(
          `UV rollback could not find face ${face.face} on Cube ${saved.uuid}.`
        );
      }
    }
    return { saved, cube };
  });
  for (const { saved, cube } of prepared) {
    cube.extend({
      box_uv: saved.box_uv,
      autouv: saved.autouv as 0 | 1 | 2,
      mirror_uv: saved.mirror_uv,
      ...(saved.uv_offset !== null
        ? { uv_offset: [...saved.uv_offset] as [number, number] }
        : {}),
    });
    for (const savedFace of saved.faces) {
      const face = cube.faces[savedFace.face];
      if (!face) {
        throw new Error(
          `UV rollback could not find face ${savedFace.face} on Cube ${saved.uuid}.`
        );
      }
      face.extend({
        uv: [...savedFace.uv] as [number, number, number, number],
        rotation: savedFace.rotation,
        enabled: savedFace.enabled,
      });
    }
  }
  Canvas.updateAll();
}

function cubesForInstructions(
  instructions: readonly UvNativeMutationInstruction[]
): Cube[] {
  const ids = [...new Set(
    instructions.map((instruction) => instruction.cube_uuid)
  )];
  const cubes = currentUvCubesByUuid();
  return ids.map((id) => resolveCubeUuid(id, cubes));
}

export function createBlockbenchUvApplyAdapter(): UvApplyAdapter {
  const boundProject = requireUniqueCurrentUvProject();
  const boundProjectUuid = boundProject.uuid;
  const requireBoundProject = () => {
    if (requireUniqueCurrentUvProject() !== boundProject ||
        Project?.uuid !== boundProjectUuid) {
      throw new Error("UV_PROJECT_AFFINITY_LOST: active project changed during UV transaction.");
    }
  };
  return {
    readSource: () => {
      requireBoundProject();
      return readBlockbenchUvNativeSource();
    },
    apply: (instructions) => {
      requireBoundProject();
      applyBlockbenchUvInstructions(instructions);
    },
    restore: (snapshot) => {
      requireBoundProject();
      restoreBlockbenchUvNativeSource(snapshot);
    },
    beginUndo: (instructions) => {
      requireBoundProject();
      if (Undo.current_save) {
        throw new Error(
          "Finish the current Blockbench edit before applying a UV layout plan."
        );
      }
      const cubes = cubesForInstructions(instructions);
      try {
        Undo.initEdit({
          elements: cubes,
          uv_only: true,
        });
      } catch (failure) {
        // There was no edit before initEdit. If native initEdit partially
        // opened one, only this adapter owns its best-effort cancellation.
        if (Undo.current_save) {
          try {
            requireBoundProject();
            Undo.cancelEdit(false);
            if (Undo.current_save) {
              throw new Error("UV_UNDO_INIT_INCOMPLETE: native Undo edit remains open.");
            }
          } catch (recoveryFailure) {
            throw new UvTransactionOutcomeUnknownError(failure, [recoveryFailure]);
          }
        }
        throw failure;
      }
    },
    commitUndo: () => {
      requireBoundProject();
      Undo.finishEdit("LazyDesigner UV layout");
      Canvas.updateAll();
    },
    cancelUndo: () => {
      requireBoundProject();
      if (Undo.current_save) {
        Undo.cancelEdit(false);
      }
      Canvas.updateAll();
    },
  };
}
