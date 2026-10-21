import { createHash } from "node:crypto";
import type {
  UvFaceKey,
  UvLayoutPlan,
  UvLayoutSnapshot,
  UvRect,
} from "@/lib/uv/contracts";
import type {
  UvCubeSnapshot,
} from "@/lib/uv/islands";

export type UvNativeSourceSnapshot = {
  schema: 1;
  /** Native Blockbench project identity, when available; scopes stale-plan guards. */
  project_uuid?: string;
  logical_width: number;
  logical_height: number;
  cubes: Array<{
    uuid: string;
    name: string;
    from: [number, number, number];
    to: [number, number, number];
    box_uv: boolean;
    uv_offset: [number, number] | null;
    autouv: number;
    mirror_uv: boolean;
    faces: Array<{
      face: UvFaceKey;
      uv: [number, number, number, number];
      rotation: number;
      enabled: boolean;
    }>;
  }>;
};

export type UvNativeMutationInstruction =
  | {
      kind: "BOX_UV_OFFSET";
      island_id: string;
      cube_uuid: string;
      uv_offset: [number, number];
    }
  | {
      kind: "FACE_UV";
      island_id: string;
      cube_uuid: string;
      face: UvFaceKey;
      uv: [number, number, number, number];
      rotation: number;
    };

function requireVec2(
  value: readonly number[] | undefined
): [number, number] | null {
  if (value === undefined) return null;
  if (
    value.length !== 2 ||
    value.some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error("UV native snapshot requires finite uv_offset.");
  }
  return [value[0], value[1]];
}

function requireFaceUv(
  value: readonly number[]
): [number, number, number, number] {
  if (
    value.length !== 4 ||
    value.some((entry) => !Number.isFinite(entry))
  ) {
    throw new Error("UV native snapshot requires four finite face UV coordinates.");
  }
  return [value[0], value[1], value[2], value[3]];
}

export function buildUvNativeSourceSnapshot(
  cubes: readonly UvCubeSnapshot[],
  logicalWidth: number,
  logicalHeight: number,
  projectUuid?: string
): UvNativeSourceSnapshot {
  if (projectUuid !== undefined && !projectUuid.trim()) {
    throw new Error("UV native snapshot requires a non-empty project UUID.");
  }
  if (
    !Number.isFinite(logicalWidth) ||
    !Number.isFinite(logicalHeight) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0
  ) {
    throw new Error("UV native snapshot requires positive logical dimensions.");
  }

  // Core callers can supply snapshots without passing through the native
  // adapter. Fail closed on ambiguous Cube/face identity here as well.
  const cubeUuids = new Set<string>();
  for (const cube of cubes) {
    if (typeof cube.uuid !== "string" || !cube.uuid.trim()) {
      throw new Error("UV_NATIVE_CUBE_ID_REQUIRED: Cube UUID must be non-empty.");
    }
    if (cubeUuids.has(cube.uuid)) {
      throw new Error(
        `UV_NATIVE_DUPLICATE_CUBE_UUID: Cube UUID "${cube.uuid}" occurs more than once.`
      );
    }
    cubeUuids.add(cube.uuid);
    const faces = new Set<string>();
    for (const face of cube.faces) {
      if (faces.has(face.face)) {
        throw new Error(
          `UV_NATIVE_DUPLICATE_FACE: Cube "${cube.uuid}" repeats face "${face.face}".`
        );
      }
      faces.add(face.face);
    }
  }

  return {
    schema: 1,
    ...(projectUuid !== undefined ? { project_uuid: projectUuid } : {}),
    logical_width: logicalWidth,
    logical_height: logicalHeight,
    cubes: [...cubes]
      .map((cube) => ({
        uuid: cube.uuid,
        name: cube.name,
        from: [
          cube.from[0],
          cube.from[1],
          cube.from[2],
        ] as [number, number, number],
        to: [
          cube.to[0],
          cube.to[1],
          cube.to[2],
        ] as [number, number, number],
        box_uv: cube.box_uv,
        uv_offset: requireVec2(cube.uv_offset),
        autouv: cube.autouv,
        mirror_uv: cube.mirror_uv,
        faces: [...cube.faces]
          .map((face) => ({
            face: face.face,
            uv: requireFaceUv(face.uv),
            rotation: face.rotation ?? 0,
            enabled: face.enabled !== false,
          }))
          .sort((a, b) => a.face.localeCompare(b.face)),
      }))
      .sort((a, b) => a.uuid.localeCompare(b.uuid)),
  };
}

export function fingerprintUvNativeSource(
  snapshot: UvNativeSourceSnapshot
): string {
  return "sha256:" + createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
}

function rectToUv(rect: UvRect): [number, number, number, number] {
  return [
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height,
  ];
}

function rotationDelta90(current: number): number {
  const normalized = ((current % 360) + 360) % 360;
  return (normalized + 90) % 360;
}

export function translateUvPlanToNativeInstructions(
  plan: UvLayoutPlan
): UvNativeMutationInstruction[] {
  const beforeById = new Map(
    plan.before.islands.map((island) => [island.id, island])
  );
  const proposedById = new Map(
    plan.proposed.islands.map((island) => [island.id, island])
  );
  const transformById = new Map(
    plan.placement_transforms.map((transform) => [
      transform.island_id,
      transform,
    ])
  );

  const instructions: UvNativeMutationInstruction[] = [];
  for (const islandId of plan.moved_island_ids) {
    const before = beforeById.get(islandId);
    const proposed = proposedById.get(islandId);
    if (!before || !proposed) {
      throw new Error(
        `UV plan references missing island ${islandId}.`
      );
    }
    const rotated90 =
      transformById.get(islandId)?.rotated_90 === true;

    if (before.source.box_uv) {
      if (rotated90) {
        throw new Error(
          `Box-UV island ${islandId} cannot be represented as a 90-degree rotated native layout.`
        );
      }
      instructions.push({
        kind: "BOX_UV_OFFSET",
        island_id: islandId,
        cube_uuid: before.source.cube_uuid,
        uv_offset: [proposed.rect.x, proposed.rect.y],
      });
      continue;
    }

    if (before.source.faces.length !== 1) {
      throw new Error(
        `Per-face UV island ${islandId} must own exactly one face.`
      );
    }
    const face = before.source.faces[0];
    instructions.push({
      kind: "FACE_UV",
      island_id: islandId,
      cube_uuid: before.source.cube_uuid,
      face,
      uv: rectToUv(proposed.rect),
      rotation: rotated90
        ? rotationDelta90(before.source.face_rotation ?? 0)
        : before.source.face_rotation ?? 0,
    });
  }

  return instructions.sort((a, b) =>
    a.island_id.localeCompare(b.island_id)
  );
}

export function assertUvPlanSourceFresh(
  expectedFingerprint: string,
  currentSnapshot: UvNativeSourceSnapshot
): void {
  const actual = fingerprintUvNativeSource(currentSnapshot);
  if (actual !== expectedFingerprint) {
    throw new Error(
      `STALE_UV_PLAN: expected source ${expectedFingerprint}, current source is ${actual}.`
    );
  }
}

export function assertUvPlanSnapshotCompatible(
  plan: UvLayoutPlan,
  current: UvLayoutSnapshot
): void {
  if (
    plan.before.logical_width !== current.logical_width ||
    plan.before.logical_height !== current.logical_height
  ) {
    throw new Error("STALE_UV_PLAN: logical UV canvas changed.");
  }
  const currentById = new Map(
    current.islands.map((island) => [island.id, island])
  );
  for (const before of plan.before.islands) {
    const now = currentById.get(before.id);
    if (!now) {
      throw new Error(
        `STALE_UV_PLAN: island ${before.id} no longer exists.`
      );
    }
    if (
      now.source.cube_uuid !== before.source.cube_uuid ||
      now.source.box_uv !== before.source.box_uv ||
      now.source.autouv !== before.source.autouv ||
      now.source.mirror_uv !== before.source.mirror_uv ||
      JSON.stringify(now.source.faces) !==
        JSON.stringify(before.source.faces) ||
      JSON.stringify(now.rect) !== JSON.stringify(before.rect) ||
      (now.source.face_rotation ?? 0) !==
        (before.source.face_rotation ?? 0)
    ) {
      throw new Error(
        `STALE_UV_PLAN: island ${before.id} changed after planning.`
      );
    }
  }
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function assertUvNativeInstructionsApplied(
  instructions: readonly UvNativeMutationInstruction[],
  snapshot: UvNativeSourceSnapshot
): void {
  const cubeById = new Map(
    snapshot.cubes.map((cube) => [cube.uuid, cube])
  );

  for (const instruction of instructions) {
    const cube = cubeById.get(instruction.cube_uuid);
    if (!cube) {
      throw new Error(
        `UV_APPLY_POSTCONDITION_FAILED: Cube ${instruction.cube_uuid} is missing after apply.`
      );
    }

    if (instruction.kind === "BOX_UV_OFFSET") {
      if (
        cube.box_uv !== true ||
        cube.uv_offset === null ||
        !sameNumbers(cube.uv_offset, instruction.uv_offset)
      ) {
        throw new Error(
          `UV_APPLY_POSTCONDITION_FAILED: Box UV instruction for ${instruction.island_id} was not applied exactly.`
        );
      }
      continue;
    }

    const face = cube.faces.find(
      (candidate) => candidate.face === instruction.face
    );
    if (
      !face ||
      !sameNumbers(face.uv, instruction.uv) ||
      face.rotation !== instruction.rotation
    ) {
      throw new Error(
        `UV_APPLY_POSTCONDITION_FAILED: Face UV instruction for ${instruction.island_id} was not applied exactly.`
      );
    }
  }
}
