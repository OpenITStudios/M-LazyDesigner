/// <reference types="blockbench-types" />

import type { UvFaceKey } from "@/lib/uv/contracts";
import type { UvCubeSnapshot } from "@/lib/uv/islands";
import {
  buildUvNativeSourceSnapshot,
  type UvNativeMutationInstruction,
  type UvNativeSourceSnapshot,
} from "@/lib/uv/adapters/blockbenchCubeUv";
import type { UvApplyAdapter } from "@/lib/uv/transaction";

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

function resolveCubeUuid(uuid: string): Cube {
  const cube = (Cube.all ?? []).find(
    (candidate: Cube) => candidate.uuid === uuid
  );
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
    (Cube.all ?? []).map((cube: Cube) =>
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
  for (const instruction of instructions) {
    const cube = resolveCubeUuid(instruction.cube_uuid);
    if (instruction.kind === "BOX_UV_OFFSET") {
      if (cube.box_uv !== true) {
        throw new Error(
          `UV native adapter expected Box UV for Cube ${cube.uuid}.`
        );
      }
      cube.extend({
        uv_offset: [...instruction.uv_offset] as [number, number],
      });
      continue;
    }

    if (cube.box_uv === true) {
      throw new Error(
        `UV native adapter expected per-face UV for Cube ${cube.uuid}.`
      );
    }
    const face = cube.faces[instruction.face];
    if (!face) {
      throw new Error(
        `UV native adapter could not find face ${instruction.face} on Cube ${cube.uuid}.`
      );
    }
    face.extend({
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

  for (const saved of snapshot.cubes) {
    const cube = resolveCubeUuid(saved.uuid);
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
  return ids.map(resolveCubeUuid);
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
      Undo.initEdit({
        elements: cubes,
        uv_only: true,
      });
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
