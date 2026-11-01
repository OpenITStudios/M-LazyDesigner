import type { RecipeVec3 } from "./contracts";
import type { GeometryMathPart } from "./geometryMathLanguage";
import { partitionMathVoxelVolume, type MathCuboid } from "./geometryMathVoxel";

type Revolution = Extract<GeometryMathPart, { method: "REVOLVE" }>;
const AXES = ["X", "Y", "Z"] as const;

/**
 * Source-profile revolution. Cross-sections are interpolated linearly in
 * axial height; no arbitrary radial mesh, taper guesses or hidden caps.
 * Annular sections may create a through-channel, which must survive native
 * voxel realization and its face-connectivity guard.
 */
export function revolveMathProfile(part: Revolution): MathCuboid[] {
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
