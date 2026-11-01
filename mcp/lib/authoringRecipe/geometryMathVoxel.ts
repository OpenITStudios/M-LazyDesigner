import type { RecipeVec3 } from "./contracts";

export type MathCuboid = {
  /** Deterministic, source-local identity, not a Blockbench Cube UUID. */
  id: string;
  from: RecipeVec3;
  to: RecipeVec3;
};

export const MATH_PROGRAM_MAX_CUBOIDS = 64;
export const MATH_PROGRAM_MAX_VOXELS = 32_768;

type Grid = readonly [number, number, number];

/**
 * Exact 1-model-unit voxel occupancy → disjoint rectangular native Cuboids.
 * All shapes using this v1 partition retain its enumeration/merge order.
 * Existing R3k presets retain their own original partition (no migration).
 *
 * Traversal is Y, Z, X; greedy growth is X, Z, then Y. No mesh/UV/Blockbench
 * globals; no implicit version migration; no silent downsampling.
 */
export function partitionMathVoxelVolume(
  low: RecipeVec3,
  size: Grid,
  contains: (x: number, y: number, z: number) => boolean
): MathCuboid[] {
  const [nx, ny, nz] = size;
  const total = nx * ny * nz;
  if (size.some(n => !Number.isSafeInteger(n) || n < 1 || n > 64) ||
    total > MATH_PROGRAM_MAX_VOXELS ||
    low.length !== 3 || low.some(n => !Number.isFinite(n))) {
    throw new Error("GEOMETRY_MATH_VOXEL_GRID_BUDGET");
  }
  const offset = (x: number, y: number, z: number) =>
    (y * nz + z) * nx + x;
  const cells = new Uint8Array(total);
  let count = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!contains(x, y, z)) continue;
        cells[offset(x, y, z)] = 1;
        count++;
      }
    }
  }
  if (count === 0) {
    throw new Error("GEOMETRY_MATH_EMPTY_VOLUME");
  }

  // A single semantic solid must be face-connected. Separate detached
  // objects must be declared as separate program parts. Voxel connectivity
  // is structural evidence only, never visual/reference approval.
  const first = cells.indexOf(1);
  const visited = new Uint8Array(total);
  const queue = [first];
  visited[first] = 1;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]!;
    const x = cell % nx;
    const z = Math.floor(cell / nx) % nz;
    const y = Math.floor(cell / (nx * nz));
    const adjacent = [
      x > 0 ? cell - 1 : -1,
      x + 1 < nx ? cell + 1 : -1,
      z > 0 ? cell - nx : -1,
      z + 1 < nz ? cell + nx : -1,
      y > 0 ? cell - nx * nz : -1,
      y + 1 < ny ? cell + nx * nz : -1,
    ];
    for (const next of adjacent) {
      if (next < 0 || visited[next] || !cells[next]) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  if (queue.length !== count) {
    throw new Error(
      "GEOMETRY_MATH_DISCONNECTED: choose separate parts or widen the connection."
    );
  }

  const taken = new Uint8Array(total);
  const available = (x: number, y: number, z: number) => {
    const i = offset(x, y, z);
    return cells[i] === 1 && taken[i] === 0;
  };
  const boxes: MathCuboid[] = [];
  let assignedCells = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!available(x, y, z)) continue;
        let endX = x + 1;
        while (endX < nx && available(endX, y, z)) endX++;
        let endZ = z + 1;
        while (endZ < nz) {
          let complete = true;
          for (let xx = x; xx < endX; xx++) {
            if (!available(xx, y, endZ)) { complete = false; break; }
          }
          if (!complete) break;
          endZ++;
        }
        let endY = y + 1;
        while (endY < ny) {
          let complete = true;
          for (let zz = z; zz < endZ && complete; zz++) {
            for (let xx = x; xx < endX; xx++) {
              if (!available(xx, endY, zz)) { complete = false; break; }
            }
          }
          if (!complete) break;
          endY++;
        }
        for (let yy = y; yy < endY; yy++) {
          for (let zz = z; zz < endZ; zz++) {
            for (let xx = x; xx < endX; xx++) taken[offset(xx, yy, zz)] = 1;
          }
        }
        // Conservation is a structural invariant, not a visual quality
        // score. Every occupied cell belongs to exactly one disjoint box.
        assignedCells += (endX - x) * (endY - y) * (endZ - z);
        const from: RecipeVec3 = [
          low[0] + x, low[1] + y, low[2] + z,
        ];
        const to: RecipeVec3 = [
          low[0] + endX, low[1] + endY, low[2] + endZ,
        ];
        if (from.some((v, axis) => !Number.isFinite(v) ||
          !Number.isFinite(to[axis]) || to[axis]! <= v)) {
          throw new Error("GEOMETRY_MATH_CUBOID_COORDINATE_INVALID");
        }
        boxes.push({ id: "v_" + x + "_" + y + "_" + z, from, to });
        if (boxes.length > MATH_PROGRAM_MAX_CUBOIDS) {
          throw new Error(
            "GEOMETRY_MATH_NATIVE_BATCH_BUDGET: " +
            "more than 64 Cuboids; simplify the source before applying."
          );
        }
      }
    }
  }
  // Equal volume alone does not prove equal coverage: losing one cell
  // while filling a different one preserves counts. Compare the full
  // occupancy bitmap to the partition ownership bitmap exactly.
  if (assignedCells !== count ||
    cells.some((filled, index) => filled !== taken[index])) {
    throw new Error(
      "GEOMETRY_MATH_VOXEL_COVERAGE_NOT_CONSERVED: " +
      "native Cuboid partition does not exactly cover occupied source cells."
    );
  }
  return boxes;
}
