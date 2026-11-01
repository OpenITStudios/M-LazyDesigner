import type { RecipeVec3 } from "./contracts";
import type { GeometryMathPart } from "./geometryMathLanguage";
import { partitionMathVoxelVolume, type MathCuboid } from "./geometryMathVoxel";

type Extrusion = Extract<GeometryMathPart, { method: "EXTRUDE" }>;
type Point = readonly [number, number];
type Polygon = readonly Point[];

const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) -
  (b[1] - a[1]) * (c[0] - a[0]);

function pointOnSegment(p: Point, a: Point, b: Point): boolean {
  return cross(a, b, p) === 0 &&
    p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function validateSimplePolygon(points: Polygon, label: string): void {
  let signedArea = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    if (a[0] === b[0] && a[1] === b[1]) {
      throw new Error("GEOMETRY_MATH_ZERO_LENGTH_PROFILE_EDGE: " + label);
    }
    // Adjacent collinear edges that reverse direction overlap; ordinary
    // nonadjacent self-intersection checks intentionally skip those pairs.
    const c = points[(i + 2) % n]!;
    if (cross(a, b, c) === 0 &&
      (c[0] - b[0]) * (b[0] - a[0]) +
      (c[1] - b[1]) * (b[1] - a[1]) < 0) {
      throw new Error("GEOMETRY_MATH_BACKTRACKING_PROFILE_EDGE: " + label);
    }
    signedArea += a[0] * b[1] - a[1] * b[0];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(a, b, points[j]!, points[(j + 1) % n]!)) {
        throw new Error("GEOMETRY_MATH_SELF_INTERSECTING_PROFILE: " + label);
      }
    }
  }
  if (Math.abs(signedArea) < 1) {
    throw new Error("GEOMETRY_MATH_ZERO_AREA_PROFILE: " + label);
  }
}

/** Boundary is either inside (outer) or excluded (holes). */
function inPolygon(p: Point, ring: Polygon, includeBoundary: boolean): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (pointOnSegment(p, a, b)) return includeBoundary;
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const intersection = a[0] +
        (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (p[0] < intersection) inside = !inside;
    }
  }
  return inside;
}

function intersectRings(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i++) {
    const fromA = a[i]!, toA = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(fromA, toA, b[j]!, b[(j + 1) % b.length]!)) {
        return true;
      }
    }
  }
  return false;
}

function validateProfile(outer: Polygon, holes: readonly Polygon[]): void {
  validateSimplePolygon(outer, "outline");
  holes.forEach((hole, index) => {
    validateSimplePolygon(hole, "hole_" + index);
    if (intersectRings(outer, hole) ||
      hole.some(point => !inPolygon(point, outer, false))) {
      throw new Error("GEOMETRY_MATH_PROFILE_HOLE_OUTSIDE_OR_TOUCHING");
    }
  });
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (intersectRings(holes[i]!, holes[j]!) ||
        inPolygon(holes[i]![0]!, holes[j]!, true) ||
        inPolygon(holes[j]![0]!, holes[i]!, true)) {
        throw new Error("GEOMETRY_MATH_OVERLAPPING_PROFILE_HOLES");
      }
    }
  }
}

/**
 * Verify every declared hole survives the one-unit rasterization as an
 * enclosed empty component; a visually missing or leaking hole is rejected.
 */
function requireRasterHolesEnclosed(
  outer: Polygon,
  holes: readonly Polygon[],
  uMin: number, vMin: number, width: number, height: number
): void {
  const outside = new Uint8Array(width * height);
  const blank = new Uint8Array(width * height);
  const index = (x: number, y: number) => y * width + x;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point: Point = [uMin + x + 0.5, vMin + y + 0.5];
      blank[index(x, y)] = Number(!inPolygon(point, outer, true) ||
        holes.some(hole => inPolygon(point, hole, true)));
    }
  }
  const queue: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      const idx = index(x, y);
      if (blank[idx] && !outside[idx]) {
        outside[idx] = 1;
        queue.push(idx);
      }
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor]!;
    const x = cell % width, y = Math.floor(cell / width);
    for (const next of [
      x > 0 ? cell - 1 : -1,
      x + 1 < width ? cell + 1 : -1,
      y > 0 ? cell - width : -1,
      y + 1 < height ? cell + width : -1,
    ]) {
      if (next < 0 || !blank[next] || outside[next]) continue;
      outside[next] = 1;
      queue.push(next);
    }
  }
  // Label enclosed 4-neighbour void components, not just their size.
  // Separate authored holes must remain separate after rasterization.
  const component = new Int16Array(width * height);
  let componentCount = 0;
  for (let cell = 0; cell < blank.length; cell++) {
    if (!blank[cell] || outside[cell] || component[cell]) continue;
    const label = ++componentCount;
    const enclosed = [cell];
    component[cell] = label;
    for (let cursor = 0; cursor < enclosed.length; cursor++) {
      const current = enclosed[cursor]!;
      const x = current % width, y = Math.floor(current / width);
      for (const next of [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ]) {
        if (next < 0 || outside[next] || !blank[next] || component[next]) continue;
        component[next] = label;
        enclosed.push(next);
      }
    }
  }
  const claimed = new Set<number>();
  for (const hole of holes) {
    let holeComponent = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!inPolygon([uMin + x + 0.5, vMin + y + 0.5], hole, true)) continue;
        const cell = index(x, y);
        if (outside[cell] || !component[cell]) {
          throw new Error("GEOMETRY_MATH_PROFILE_HOLE_RASTER_LEAK");
        }
        if (holeComponent && holeComponent !== component[cell]) {
          throw new Error("GEOMETRY_MATH_PROFILE_HOLE_RASTER_SPLIT");
        }
        holeComponent = component[cell]!;
      }
    }
    if (!holeComponent) {
      throw new Error("GEOMETRY_MATH_PROFILE_HOLE_NOT_REPRESENTED");
    }
    if (claimed.has(holeComponent)) {
      throw new Error("GEOMETRY_MATH_PROFILE_HOLES_MERGED");
    }
    claimed.add(holeComponent);
  }
  if (componentCount !== holes.length) {
    throw new Error("GEOMETRY_MATH_UNDECLARED_RASTER_CAVITY");
  }
}

export function extrudeMathProfile(part: Extrusion): MathCuboid[] {
  const holes = part.holes ?? [];
  validateProfile(part.outline, holes);
  const uMin = Math.min(...part.outline.map(p => p[0]));
  const uMax = Math.max(...part.outline.map(p => p[0]));
  const vMin = Math.min(...part.outline.map(p => p[1]));
  const vMax = Math.max(...part.outline.map(p => p[1]));
  const width = uMax - uMin, height = vMax - vMin;
  if (width < 1 || height < 1 || width > 64 || height > 64) {
    throw new Error("GEOMETRY_MATH_PROFILE_BOUNDS_INVALID");
  }
  requireRasterHolesEnclosed(part.outline, holes, uMin, vMin, width, height);
  const axes = part.plane === "XY" ? [0, 1, 2] :
    part.plane === "XZ" ? [0, 2, 1] : [1, 2, 0];
  const [u, v, n] = axes;
  const low: RecipeVec3 = [0, 0, 0];
  const size: [number, number, number] = [0, 0, 0];
  low[u!] = uMin; low[v!] = vMin; low[n!] = -part.depth / 2;
  size[u!] = width; size[v!] = height; size[n!] = part.depth;
  return partitionMathVoxelVolume(low, size, (x, y, z) => {
    const cells = [x, y, z];
    const point: Point = [
      uMin + cells[u!]! + 0.5,
      vMin + cells[v!]! + 0.5,
    ];
    return inPolygon(point, part.outline, true) &&
      !holes.some(hole => inPolygon(point, hole, true));
  });
}
