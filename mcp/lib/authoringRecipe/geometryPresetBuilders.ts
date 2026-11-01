import type {
  RecipeCubePrototype,
  RecipePattern,
  RecipeVec3,
} from "./contracts";
import type { AdvancedGeometryFeature } from "./geometrySchema";

/**
 * Bounded, opt-in parametric shape templates for the existing Cuboid Recipe
 * compiler. These are geometry *methods*, not asset presets or visual approval.
 * Every emitted part is an ordinary native-Cuboid Recipe prototype/pattern.
 */
type PresetKind =
  | "staircase"
  | "pitched_roof"
  | "beveled_box"
  | "voxel_ellipsoid"
  | "voxel_cone"
  | "voxel_torus";
export type AdvancedGeometryPreset = Extract<AdvancedGeometryFeature, { kind: PresetKind }>;

type Pieces = { prototypes: RecipeCubePrototype[]; patterns: RecipePattern[] };
type BoxFactory = (
  id: string, name: string, featureId: string,
  from: RecipeVec3, to: RecipeVec3
) => Pieces;

const MAX_PRESET_NATIVE_CUBES = 64;
const MAX_VOXEL_CELLS = 32768;
const AXES = ["X", "Y", "Z"] as const;

function requirePresetBudget(pieces: Pieces): void {
  if (pieces.patterns.length > MAX_PRESET_NATIVE_CUBES) {
    throw new Error(
      "ADVANCED_GEOMETRY_PRESET_BUDGET_EXCEEDED: reduce shape resolution; " +
      "at most 64 native Cubes may be created in one preset."
    );
  }
}

function appendBox(
  result: Pieces,
  feature: AdvancedGeometryPreset,
  suffix: string,
  from: RecipeVec3,
  to: RecipeVec3,
  makeBox: BoxFactory
): void {
  const id = "shape:" + feature.kind + ":" + feature.id + ":" + suffix;
  const box = makeBox(id, feature.label + "_" + suffix, feature.id, from, to);
  result.prototypes.push(...box.prototypes);
  result.patterns.push(...box.patterns);
  requirePresetBudget(result);
}

function makeStaircase(
  feature: Extract<AdvancedGeometryPreset, { kind: "staircase" }>,
  makeBox: BoxFactory
): Pieces {
  const axis = feature.direction.endsWith("X") ? 0 : 2;
  const other = axis === 0 ? 2 : 0;
  const ascendingPositive = feature.direction.startsWith("POS_");
  const extent = feature.steps * feature.tread;
  if (extent > 64) throw new Error("ADVANCED_GEOMETRY_STAIRCASE_SPAN_BUDGET");
  const result: Pieces = { prototypes: [], patterns: [] };
  for (let index = 0; index < feature.steps; index++) {
    const along = ascendingPositive ? index : feature.steps - index - 1;
    const from = [...feature.base_center] as RecipeVec3;
    const to = [...feature.base_center] as RecipeVec3;
    from[axis] = feature.base_center[axis] - extent / 2 + along * feature.tread;
    to[axis] = from[axis] + feature.tread;
    from[other] = feature.base_center[other] - feature.width / 2;
    to[other] = from[other] + feature.width;
    from[1] = feature.base_center[1];
    to[1] = from[1] + (index + 1) * feature.rise;
    appendBox(result, feature, "step_" + index, from, to, makeBox);
  }
  return result;
}

function makePitchedRoof(
  feature: Extract<AdvancedGeometryPreset, { kind: "pitched_roof" }>,
  makeBox: BoxFactory
): Pieces {
  const along = feature.ridge_axis === "X" ? 0 : 2;
  const across = along === 0 ? 2 : 0;
  const halfSpan = feature.steps * feature.tread;
  if (halfSpan > 64) throw new Error("ADVANCED_GEOMETRY_ROOF_SPAN_BUDGET");
  const shell = feature.profile === "SHELL";
  if (shell && feature.thickness <= feature.rise) {
    throw new Error(
      "ADVANCED_GEOMETRY_ROOF_SHELL_CONTACT_REQUIRED: " +
      "thickness must exceed rise to give adjacent roof strips shared face contact."
    );
  }
  const result: Pieces = { prototypes: [], patterns: [] };
  for (const side of ["negative", "positive"] as const) {
    for (let index = 0; index < feature.steps; index++) {
      const from = [...feature.eave_center] as RecipeVec3;
      const to = [...feature.eave_center] as RecipeVec3;
      from[along] = feature.eave_center[along] - feature.length / 2;
      to[along] = from[along] + feature.length;
      from[across] = side === "negative"
        ? feature.eave_center[across] - halfSpan + index * feature.tread
        : feature.eave_center[across] + (feature.steps - 1 - index) * feature.tread;
      to[across] = from[across] + feature.tread;
      from[1] = feature.eave_center[1] + (shell ? index * feature.rise : 0);
      to[1] = feature.eave_center[1] +
        (shell ? index * feature.rise + feature.thickness : (index + 1) * feature.rise);
      appendBox(result, feature, side + "_slope_" + index, from, to, makeBox);
    }
  }
  return result;
}

type RasterDimensions = [number, number, number];
type RasterPredicate = (x: number, y: number, z: number) => boolean;

/**
 * Deterministic X→Z→Y voxel partition. Adjacent filled cells are merged into
 * disjoint native Cuboids; no one-Cube-per-voxel scene explosion or mesh export.
 * Both 6-neighbour volume connectivity and native-batch size are bounded.
 */
function rasterToRecipe(
  feature: AdvancedGeometryPreset,
  relativeLow: RecipeVec3,
  dimensions: RasterDimensions,
  predicate: RasterPredicate,
  center: RecipeVec3,
  makeBox: BoxFactory
): Pieces {
  const [nx, ny, nz] = dimensions;
  const total = nx * ny * nz;
  if (dimensions.some(dimension =>
    !Number.isSafeInteger(dimension) || dimension < 1
  ) || total > MAX_VOXEL_CELLS) {
    throw new Error("ADVANCED_GEOMETRY_PRESET_VOXEL_GRID_BUDGET");
  }
  const offset = (x: number, y: number, z: number) =>
    (y * nz + z) * nx + x;
  const occupied = new Uint8Array(total);
  let count = 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (predicate(x, y, z)) {
          occupied[offset(x, y, z)] = 1;
          count++;
        }
      }
    }
  }
  if (count < 1) throw new Error("ADVANCED_GEOMETRY_PRESET_EMPTY_VOLUME");

  // Corner/edge contact alone cannot substitute for actual face connectivity.
  const first = occupied.findIndex(value => value === 1);
  const visited = new Uint8Array(total);
  const queue = [first];
  visited[first] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const point = queue[cursor]!;
    const x = point % nx;
    const z = Math.floor(point / nx) % nz;
    const y = Math.floor(point / (nx * nz));
    const neighbours = [
      x > 0 ? point - 1 : -1,
      x + 1 < nx ? point + 1 : -1,
      z > 0 ? point - nx : -1,
      z + 1 < nz ? point + nx : -1,
      y > 0 ? point - nx * nz : -1,
      y + 1 < ny ? point + nx * nz : -1,
    ];
    for (const next of neighbours) {
      if (next < 0 || !occupied[next] || visited[next]) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  if (queue.length !== count) {
    throw new Error(
      "ADVANCED_GEOMETRY_PRESET_DISCONNECTED: " +
      "increase the material thickness or choose a different resolution."
    );
  }

  const consumed = new Uint8Array(total);
  const result: Pieces = { prototypes: [], patterns: [] };
  const available = (x: number, y: number, z: number) =>
    occupied[offset(x, y, z)] === 1 && consumed[offset(x, y, z)] === 0;
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        if (!available(x, y, z)) continue;
        let xEnd = x + 1;
        while (xEnd < nx && available(xEnd, y, z)) xEnd++;
        let zEnd = z + 1;
        while (zEnd < nz && Array.from(
          { length: xEnd - x }, (_, n) => x + n
        ).every(column => available(column, y, zEnd))) zEnd++;
        let yEnd = y + 1;
        while (yEnd < ny) {
          let complete = true;
          for (let zz = z; zz < zEnd && complete; zz++) {
            for (let xx = x; xx < xEnd; xx++) {
              if (!available(xx, yEnd, zz)) {
                complete = false;
                break;
              }
            }
          }
          if (!complete) break;
          yEnd++;
        }
        for (let yy = y; yy < yEnd; yy++) {
          for (let zz = z; zz < zEnd; zz++) {
            for (let xx = x; xx < xEnd; xx++) {
              consumed[offset(xx, yy, zz)] = 1;
            }
          }
        }
        const from = relativeLow.map((value, axis) =>
          center[axis]! + value + [x, y, z][axis]!
        ) as RecipeVec3;
        const to = relativeLow.map((value, axis) =>
          center[axis]! + value + [xEnd, yEnd, zEnd][axis]!
        ) as RecipeVec3;
        const relativeId = relativeLow.map((value, axis) =>
          value + [x, y, z][axis]!
        ).join("_");
        appendBox(result, feature, "voxel_" + relativeId, from, to, makeBox);
      }
    }
  }
  return result;
}

function makeBeveledBox(
  feature: Extract<AdvancedGeometryPreset, { kind: "beveled_box" }>,
  makeBox: BoxFactory
): Pieces {
  const [width, height, depth] = feature.size;
  const cut = feature.bevel;
  if (2 * cut >= Math.min(width, depth)) {
    throw new Error("ADVANCED_GEOMETRY_BEVEL_INTERIOR_REQUIRED");
  }
  return rasterToRecipe(
    feature,
    [-width / 2, -height / 2, -depth / 2],
    [width, height, depth],
    (x, _y, z) => {
      const dx = Math.min(x, width - x - 1);
      const dz = Math.min(z, depth - z - 1);
      return dx + dz >= cut;
    },
    feature.center,
    makeBox
  );
}

function makeVoxelEllipsoid(
  feature: Extract<AdvancedGeometryPreset, { kind: "voxel_ellipsoid" }>,
  makeBox: BoxFactory
): Pieces {
  const [rx, ry, rz] = feature.radii;
  const upper = feature.upper_half;
  return rasterToRecipe(
    feature,
    [-rx, upper ? 0 : -ry, -rz],
    [rx * 2, upper ? ry : ry * 2, rz * 2],
    (x, y, z) => {
      const u = (x - rx + 0.5) / rx;
      const v = (y + (upper ? 0 : -ry) + 0.5) / ry;
      const w = (z - rz + 0.5) / rz;
      return u * u + v * v + w * w <= 1;
    },
    feature.center,
    makeBox
  );
}

function makeVoxelCone(
  feature: Extract<AdvancedGeometryPreset, { kind: "voxel_cone" }>,
  makeBox: BoxFactory
): Pieces {
  const r = feature.base_radius;
  const axis = AXES.indexOf(feature.axis);
  if (axis < 0 || feature.tip_radius > r) {
    throw new Error("ADVANCED_GEOMETRY_CONE_RADII_INVALID");
  }
  const low: RecipeVec3 = [-r, -r, -r];
  const dimensions: RasterDimensions = [r * 2, r * 2, r * 2];
  low[axis] = -feature.height / 2;
  dimensions[axis] = feature.height;
  const radial = [0, 1, 2].filter(index => index !== axis);
  return rasterToRecipe(
    feature, low, dimensions,
    (x, y, z) => {
      const cell = [x, y, z];
      const u = cell[radial[0]!]! - r + 0.5;
      const v = cell[radial[1]!]! - r + 0.5;
      const t = (cell[axis]! + 0.5) / feature.height;
      const radius = r + (feature.tip_radius - r) * t;
      // The final voxel slice keeps a finite cap even at a mathematical tip.
      return u * u + v * v <= Math.max(0.75 * 0.75, radius * radius);
    },
    feature.center, makeBox
  );
}

function makeVoxelTorus(
  feature: Extract<AdvancedGeometryPreset, { kind: "voxel_torus" }>,
  makeBox: BoxFactory
): Pieces {
  const major = feature.major_radius;
  const tube = feature.tube_radius;
  if (major <= tube + 1) {
    throw new Error("ADVANCED_GEOMETRY_TORUS_CENTRAL_HOLE_REQUIRED");
  }
  const extent = major + tube;
  const axis = AXES.indexOf(feature.axis);
  const radial = [0, 1, 2].filter(index => index !== axis);
  return rasterToRecipe(
    feature,
    [-extent, -extent, -extent],
    [extent * 2, extent * 2, extent * 2],
    (x, y, z) => {
      const cell = [x, y, z].map(value => value - extent + 0.5);
      const around = Math.hypot(
        cell[radial[0]!]!, cell[radial[1]!]!
      );
      const through = cell[axis]!;
      return (around - major) ** 2 + through ** 2 <= tube ** 2;
    },
    feature.center, makeBox
  );
}

export function buildGeometryPresetPieces(
  feature: AdvancedGeometryPreset,
  makeBox: BoxFactory
): Pieces {
  switch (feature.kind) {
    case "staircase": return makeStaircase(feature, makeBox);
    case "pitched_roof": return makePitchedRoof(feature, makeBox);
    case "beveled_box": return makeBeveledBox(feature, makeBox);
    case "voxel_ellipsoid": return makeVoxelEllipsoid(feature, makeBox);
    case "voxel_cone": return makeVoxelCone(feature, makeBox);
    case "voxel_torus": return makeVoxelTorus(feature, makeBox);
  }
}
