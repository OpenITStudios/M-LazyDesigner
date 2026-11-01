import type { RecipeVec3 } from "./contracts";
import type { GeometryMathPart, GeometryMathVersion } from "./geometryMathLanguage";
import { partitionMathVoxelVolume, type MathCuboid } from "./geometryMathVoxel";

type Revolution = Extract<GeometryMathPart, { method: "REVOLVE" }>;
const AXES = ["X", "Y", "Z"] as const;

/**
 * Version 3 annular-section topology preflight. The one-unit rasterizer may
 * leave a continuous mathematical annulus as four disconnected strips or
 * open its hollow centre to the exterior through a diagonal voxel gap.
 * A general 3D solid connectivity check cannot detect either per-section
 * failure if another axial layer reconnects the fragments.
 *
 * For four-connected material cells, use eight-connected background so
 * diagonal openings count as leakage (conservative digital topology).
 * V1/V2 output is unchanged: this preflight is exclusive to v3.
 */
function validateV3AnnularSections(
  majorRadius: number,
  totalHeight: number,
  sectionAt: (height: number) => { outer: number; inner: number }
): void {
  const diameter = majorRadius * 2;
  const cellCount = diameter * diameter;
  const encode = (x: number, z: number) => z * diameter + x;
  const connected = (
    start: number,
    mask: Uint8Array,
    diagonal: boolean
  ): Uint8Array => {
    const seen = new Uint8Array(cellCount);
    if (!mask[start]) return seen;
    const queue = [start];
    seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor]!;
      const x = cell % diameter, z = Math.floor(cell / diameter);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          if (!diagonal && Math.abs(dx) + Math.abs(dz) !== 1) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= diameter || nz >= diameter) continue;
          const next = encode(nx, nz);
          if (mask[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    return seen;
  };

  for (let axialLayer = 0; axialLayer < totalHeight; axialLayer++) {
    const { outer, inner } = sectionAt(axialLayer + 0.5);
    if (![outer, inner].every(Number.isFinite) ||
      outer - inner < 1 - 1e-9) {
      throw new Error("GEOMETRY_MATH_REVOLVE_SECTION_INVALID");
    }
    if (inner <= 0) continue;
    const solid = new Uint8Array(cellCount);
    const blank = new Uint8Array(cellCount);
    const intendedHole = new Uint8Array(cellCount);
    let solidCount = 0;
    for (let z = 0; z < diameter; z++) {
      for (let x = 0; x < diameter; x++) {
        const rho = Math.hypot(
          x - majorRadius + 0.5, z - majorRadius + 0.5
        );
        const index = encode(x, z);
        solid[index] = Number(rho <= outer && rho >= inner);
        blank[index] = Number(!solid[index]);
        intendedHole[index] = Number(rho < inner);
        solidCount += solid[index]!;
      }
    }
    if (solidCount === 0) {
      throw new Error("GEOMETRY_MATH_REVOLVE_EMPTY_ANNULUS");
    }

    // Local section must form one face-connected ring; axial neighbours
    // cannot be relied on to repair missing radial contact.
    const firstSolid = solid.indexOf(1);
    const materialSeen = connected(firstSolid, solid, false);
    if (materialSeen.reduce((sum, n) => sum + n, 0) !== solidCount) {
      throw new Error("GEOMETRY_MATH_REVOLVE_DISCONNECTED_RING");
    }

    const firstHole = intendedHole.indexOf(1);
    // A taper from a solid cap into a hollow may legitimately start with
    // subpixel radii that cannot yet contain even one voxel-centre sample.
    if (firstHole < 0) continue;

    // All exterior background can be reached through eight-neighbour
    // paths from the boundary. Reuse the same neighbourhood for the
    // interior-component test to reject diagonal leakage/merging.
    const exterior = new Uint8Array(cellCount);
    const queue: number[] = [];
    for (let z = 0; z < diameter; z++) {
      for (let x = 0; x < diameter; x++) {
        if (x !== 0 && z !== 0 && x !== diameter - 1 &&
          z !== diameter - 1) continue;
        const cell = encode(x, z);
        if (blank[cell] && !exterior[cell]) {
          queue.push(cell);
          exterior[cell] = 1;
        }
      }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor]!;
      const x = cell % diameter, z = Math.floor(cell / diameter);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= diameter || nz >= diameter) continue;
          const next = encode(nx, nz);
          if (blank[next] && !exterior[next]) {
            exterior[next] = 1;
            queue.push(next);
          }
        }
      }
    }
    const cavity = connected(firstHole, blank, true);
    for (let cell = 0; cell < cellCount; cell++) {
      if (intendedHole[cell] && (exterior[cell] || !cavity[cell])) {
        throw new Error("GEOMETRY_MATH_REVOLVE_RADIAL_HOLE_LEAK");
      }
      if (blank[cell] && !exterior[cell] && !cavity[cell]) {
        throw new Error("GEOMETRY_MATH_REVOLVE_EXTRA_CAVITY");
      }
    }
  }
}

/**
 * Source-profile revolution. Cross-sections are interpolated linearly in
 * axial height; no arbitrary radial mesh, taper guesses or hidden caps.
 * Annular sections may create a through-channel, which must survive native
 * voxel realization and its face-connectivity guard.
 */
export function revolveMathProfile(
  part: Revolution, version: GeometryMathVersion
): MathCuboid[] {
  const sections = part.sections;
  if (sections[0]?.height !== 0) {
    throw new Error("GEOMETRY_MATH_REVOLVE_START_AT_ZERO");
  }
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i]!;
    if (current.outer_radius - current.inner_radius < 1) {
      throw new Error("GEOMETRY_MATH_REVOLVE_WALL_TOO_THIN");
    }
    if (i > 0 && current.height <= sections[i - 1]!.height) {
      throw new Error("GEOMETRY_MATH_REVOLVE_STATIONS_NOT_ASCENDING");
    }
  }
  const top = sections[sections.length - 1]!.height;
  if (top < 1) {
    throw new Error("GEOMETRY_MATH_REVOLVE_ZERO_HEIGHT");
  }
  const majorRadius = Math.max(...sections.map(s => s.outer_radius));
  const axis = AXES.indexOf(part.axis);
  if (axis < 0) {
    throw new Error("GEOMETRY_MATH_REVOLVE_AXIS_INVALID");
  }
  const radial = [0, 1, 2].filter(i => i !== axis);
  const low: RecipeVec3 = [-majorRadius, -majorRadius, -majorRadius];
  low[axis] = 0;
  const size: [number, number, number] = [
    majorRadius * 2, majorRadius * 2, majorRadius * 2,
  ];
  size[axis] = top;
  const sectionAt = (height: number): { outer: number; inner: number } => {
    let index = 0;
    while (index + 2 < sections.length &&
      sections[index + 1]!.height < height) index++;
    const a = sections[index]!, b = sections[index + 1]!;
    const t = (height - a.height) / (b.height - a.height);
    return {
      outer: a.outer_radius + (b.outer_radius - a.outer_radius) * t,
      inner: a.inner_radius + (b.inner_radius - a.inner_radius) * t,
    };
  };
  // Topology-preserving annular preflight is v3-only. V1/V2 must reproduce
  // their previously authored Cube placements exactly.
  if (version === 3) validateV3AnnularSections(
    majorRadius, top, sectionAt
  );
  return partitionMathVoxelVolume(low, size, (x, y, z) => {
    const cell = [x, y, z];
    const axial = cell[axis]! + 0.5;
    const u = cell[radial[0]!]! - majorRadius + 0.5;
    const v = cell[radial[1]!]! - majorRadius + 0.5;
    const rho = Math.hypot(u, v);
    const { outer, inner } = sectionAt(axial);
    return rho <= outer && (inner === 0 || rho >= inner);
  });
}
