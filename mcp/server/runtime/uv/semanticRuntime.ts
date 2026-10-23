/// <reference types="blockbench-types" />
import { requireUvPhysicalPixelGrid } from "@/lib/uv/facePixelMapping";
import { textureProductionRole } from "@/server/tools/texture/atlas";

import type { CubeFaceKey } from "@/lib/uv/authoringRecipeUv";
import type { NativeUvApplyOperation, NativeUvTarget } from "@/lib/uv/nativeApplyPlan";
import { requireSemanticUvAutomationAllowed } from "@/lib/uv/boxUvPolicy";
import {
  nativeUvSnapshotFingerprint,
  type NativeUvCubeSnapshot,
} from "@/lib/uv/nativeState";
import {
  validateNativeUvTransactionPlan,
  type NativeUvTransactionPlan,
  type NativeUvTransactionReceipt,
} from "@/lib/uv/nativeTransaction";
import { readAuthoringRecipeCubeOwnership } from "../recipes/authoring/ownership";

const FACE_KEYS: readonly CubeFaceKey[] = ["north", "south", "east", "west", "up", "down"];

function requireProject(): void {
  if (!Project) throw new Error("Semantic UV runtime requires an open Blockbench project.");
}

function resolveCube(uuid: string): Cube {
  const cube = (Cube.all ?? []).find((candidate: Cube) => candidate.uuid === uuid);
  if (!cube) throw new Error("Semantic UV target Cube is missing: " + uuid + ".");
  return cube;
}

function faceUv(face: CubeFace, label: string): [number, number, number, number] {
  const uv = [...face.uv];
  if (uv.length !== 4 || uv.some((value) => !Number.isFinite(value))) {
    throw new Error(label + " has invalid native UV state.");
  }
  return [uv[0], uv[1], uv[2], uv[3]];
}

export function readBlockbenchSemanticUvSnapshot(cubeUuids?: readonly string[]): NativeUvCubeSnapshot[] {
  requireProject();
  const requested = cubeUuids ? new Set(cubeUuids) : null;
  if (requested && requested.size !== cubeUuids!.length) throw new Error("Semantic UV snapshot Cube UUIDs must be unique.");
  const cubes = requested
    ? [...requested].map(resolveCube)
    : [...(Cube.all ?? [])];

  return cubes.map((cube) => ({
    cube_uuid: cube.uuid,
    box_uv: cube.box_uv === true,
    autouv: cube.autouv,
    faces: {
      north: { uv: faceUv(cube.faces.north, cube.uuid + ":north"), rotation: cube.faces.north.rotation },
      south: { uv: faceUv(cube.faces.south, cube.uuid + ":south"), rotation: cube.faces.south.rotation },
      east: { uv: faceUv(cube.faces.east, cube.uuid + ":east"), rotation: cube.faces.east.rotation },
      west: { uv: faceUv(cube.faces.west, cube.uuid + ":west"), rotation: cube.faces.west.rotation },
      up: { uv: faceUv(cube.faces.up, cube.uuid + ":up"), rotation: cube.faces.up.rotation },
      down: { uv: faceUv(cube.faces.down, cube.uuid + ":down"), rotation: cube.faces.down.rotation },
    },
  })).sort((a, b) => a.cube_uuid.localeCompare(b.cube_uuid));
}

export function readBlockbenchAuthoringRecipeUvTargets(recipeId: string) {
  requireProject();
  if (!recipeId.trim()) throw new Error("Authoring Recipe UV target read requires recipe identity.");
  const targets: NativeUvTarget[] = [];
  const snapshots: NativeUvCubeSnapshot[] = [];
  const blocked_box_uv: string[] = [];
  const seenInstances = new Set<string>();

  for (const cube of Cube.all ?? []) {
    const ownership = readAuthoringRecipeCubeOwnership(cube);
    if (!ownership || ownership.recipe_id !== recipeId) continue;
    if (seenInstances.has(ownership.instance_id)) {
      throw new Error("Duplicate native Cube ownership for recipe instance " + ownership.instance_id + ".");
    }
    seenInstances.add(ownership.instance_id);
    const snapshot = readBlockbenchSemanticUvSnapshot([cube.uuid])[0];
    snapshots.push(snapshot);
    if (snapshot.box_uv) {
      blocked_box_uv.push(cube.uuid);
      continue;
    }
    for (const face of FACE_KEYS) {
      targets.push({
        island_id: ownership.instance_id + ":" + face,
        cube_uuid: cube.uuid,
        face,
        current_uv: snapshot.faces[face].uv,
        current_rotation: snapshot.faces[face].rotation,
        expected_recipe_id: ownership.recipe_id,
        expected_instance_id: ownership.instance_id,
      });
    }
  }

  snapshots.sort((a, b) => a.cube_uuid.localeCompare(b.cube_uuid));
  targets.sort((a, b) => a.island_id.localeCompare(b.island_id));
  blocked_box_uv.sort();
  return {
    snapshots,
    fingerprint: nativeUvSnapshotFingerprint(snapshots),
    targets,
    blocked_box_uv,
  };
}

function validateLogicalUvBounds(operation: NativeUvApplyOperation): void {
  const width = Project?.texture_width;
  const height = Project?.texture_height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Semantic UV apply requires finite positive project logical UV dimensions.");
  }
  // Fractional logical UV is valid when it lands on an exact pixel of the
  // established base-color texture frame. Without an atlas, retain 1:1.
  const bases = typeof Texture === "undefined" ? [] :
    (Project?.textures ?? Texture.all ?? []).filter((texture) =>
      textureProductionRole(texture) === "base_color_candidate");
  if (bases.length > 1) {
    throw new Error("UV_AUTO_BITMAP_AMBIGUOUS: semantic UV apply requires one base-color atlas.");
  }
  const base = bases[0];
  if (base && (base.getUVWidth() !== width || base.getUVHeight() !== height)) {
    throw new Error("UV_BITMAP_LOGICAL_MISMATCH: base atlas and project logical UV dimensions disagree.");
  }
  const pixelsPerUvUnit: [number, number] = base
    ? [base.width / base.getUVWidth(), base.display_height / base.getUVHeight()]
    : [1, 1];
  requireUvPhysicalPixelGrid(operation.uv, pixelsPerUvUnit,
    "semantic UV island " + operation.island_id);
  const minU = Math.min(operation.uv[0], operation.uv[2]);
  const minV = Math.min(operation.uv[1], operation.uv[3]);
  const maxU = Math.max(operation.uv[0], operation.uv[2]);
  const maxV = Math.max(operation.uv[1], operation.uv[3]);
  if (minU < 0 || minV < 0 || maxU > width || maxV > height) {
    throw new Error("Semantic UV apply exceeds the logical atlas bounds for " + operation.island_id + ".");
  }
}

function requireExpectedOwnership(cube: Cube, operation: NativeUvApplyOperation): void {
  if (
    operation.expected_recipe_id === undefined &&
    operation.expected_instance_id === undefined
  ) return;
  const ownership = readAuthoringRecipeCubeOwnership(cube);
  if (
    !ownership ||
    ownership.recipe_id !== operation.expected_recipe_id ||
    ownership.instance_id !== operation.expected_instance_id
  ) {
    throw new Error(
      "Semantic UV target ownership changed after planning for " +
        operation.island_id +
        ". Refresh recipe-owned UV targets before mutation."
    );
  }
}

function operationChangesNativeState(cube: Cube, operation: NativeUvApplyOperation): boolean {
  const face = cube.faces[operation.face];
  return (
    face.rotation !== operation.rotation ||
    operation.uv.some((value, index) => value !== face.uv[index])
  );
}

export function applyBlockbenchSemanticUvTransaction(
  plan: NativeUvTransactionPlan
): NativeUvTransactionReceipt {
  requireProject();
  validateNativeUvTransactionPlan(plan);

  const cubeUuids = [...new Set(plan.operations.map((operation) => operation.cube_uuid))].sort();
  const beforeSnapshots = readBlockbenchSemanticUvSnapshot(cubeUuids);
  const beforeFingerprint = nativeUvSnapshotFingerprint(beforeSnapshots);
  if (beforeFingerprint !== plan.expected_fingerprint) {
    throw new Error("Semantic UV source state changed after planning. Re-read affected UV state and recompile the plan before mutation.");
  }

  const cubeByUuid = new Map(cubeUuids.map((uuid) => [uuid, resolveCube(uuid)]));
  for (const operation of plan.operations) {
    const cube = cubeByUuid.get(operation.cube_uuid)!;
    requireSemanticUvAutomationAllowed(cube.box_uv === true, "Cube " + cube.name + " (" + cube.uuid + ")");
    requireExpectedOwnership(cube, operation);
    validateLogicalUvBounds(operation);
  }

  const changedOperations = plan.operations.filter((operation) => {
    const cube = cubeByUuid.get(operation.cube_uuid)!;
    return operationChangesNativeState(cube, operation);
  });

  if (changedOperations.length === 0) {
    return {
      execution: "unchanged",
      affected_cube_uuids: [],
      affected_island_ids: [],
      operation_count: 0,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: beforeFingerprint,
    };
  }

  if (Undo.current_save) {
    throw new Error("Finish the current Blockbench edit before applying a semantic UV transaction.");
  }

  const affectedCubeUuids = [...new Set(changedOperations.map((operation) => operation.cube_uuid))].sort();
  const affectedCubes = affectedCubeUuids.map((uuid) => cubeByUuid.get(uuid)!);
  Undo.initEdit({ elements: affectedCubes, outliner: false, collections: [] });
  let editOpen = true;
  try {
    for (const operation of changedOperations) {
      const cube = cubeByUuid.get(operation.cube_uuid)!;
      const face = cube.faces[operation.face];
      face.extend({
        uv: operation.uv,
        rotation: operation.rotation,
      });
      cube.extend({ box_uv: false, autouv: 0 });
    }
    Undo.finishEdit("LazyDesigner semantic UV layout");
    editOpen = false;
    Canvas.updateAll();
  } catch (error) {
    if (editOpen) Undo.cancelEdit(true);
    Canvas.updateAll();
    throw error;
  }

  const afterSnapshots = readBlockbenchSemanticUvSnapshot(cubeUuids);
  const afterFingerprint = nativeUvSnapshotFingerprint(afterSnapshots);
  return {
    execution: "applied",
    affected_cube_uuids: affectedCubeUuids,
    affected_island_ids: changedOperations.map((operation) => operation.island_id).sort(),
    operation_count: changedOperations.length,
    before_fingerprint: beforeFingerprint,
    after_fingerprint: afterFingerprint,
  };
}
