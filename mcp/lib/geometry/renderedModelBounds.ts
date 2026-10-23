/// <reference types="three" />
/// <reference types="blockbench-types" />
import { orientedBoxFromCube } from "@/lib/geometry/blockbenchCubeObb";
import {
  analyzeOrientedBoxContact,
  type OrientedBox,
} from "@/lib/geometry/orientedBoxContact";

export type Vec3 = [number, number, number];

export interface RenderedModelBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size_xyz: Vec3;
  dimensions: {
    width: number;
    height: number;
    length: number;
  };
  footprint: {
    min_xz: [number, number];
    max_xz: [number, number];
    size: {
      width: number;
      length: number;
    };
  };
}

export interface RenderedModelBoundsObservation {
  total_cube_count: number;
  rendered_cube_count: number;
  hidden_cube_count: number;
  bounds: RenderedModelBounds | null;
  warnings: string[];
}

export const SURFACE_MICRO_GAP_REVIEW_DISTANCE = 0.05;
export const SURFACE_COPLANAR_EDGE_GAP_REVIEW_DISTANCE = 4;
export const SURFACE_SHALLOW_PENETRATION_REVIEW_DEPTH = 0.05;
const SURFACE_PARALLEL_EPSILON = 1e-6;
const SURFACE_PLANE_EPSILON = 1e-4;
const SURFACE_WARNING_LIMIT = 8;
const SURFACE_PAIR_ANALYSIS_LIMIT = 20_000;
const SURFACE_PAIR_CANDIDATE_LIMIT = 65_536;

type BoxFace = {
  center: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  half_u: number;
  half_v: number;
};

export type SurfaceQualityRisk =
  | {
      kind: "coplanar_overlap";
      plane_distance: number;
    }
  | {
      kind: "micro_gap";
      distance: number;
    }
  | {
      kind: "coplanar_edge_gap";
      distance: number;
      shared_span: number;
    }
  | {
      kind: "shallow_penetration";
      depth: number;
    };

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function dot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function add(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2],
  ];
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function scale(vector: Vec3, amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function boxFaces(box: OrientedBox): BoxFace[] {
  const faces: BoxFace[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const tangentAxes = [0, 1, 2].filter((index) => index !== axis);
    const uIndex = tangentAxes[0];
    const vIndex = tangentAxes[1];
    for (const sign of [-1, 1] as const) {
      faces.push({
        center: add(
          box.center,
          scale(box.axes[axis], sign * box.halfSizes[axis])
        ),
        normal: scale(box.axes[axis], sign),
        u: box.axes[uIndex],
        v: box.axes[vIndex],
        half_u: box.halfSizes[uIndex],
        half_v: box.halfSizes[vIndex],
      });
    }
  }
  return faces;
}

function projectedFaceRadius(face: BoxFace, axis: Vec3): number {
  return (
    face.half_u * Math.abs(dot(face.u, axis)) +
    face.half_v * Math.abs(dot(face.v, axis))
  );
}

function facesOverlapInPlane(first: BoxFace, second: BoxFace): boolean {
  const offset = subtract(second.center, first.center);
  for (const axis of [first.u, first.v, second.u, second.v]) {
    const overlap =
      projectedFaceRadius(first, axis) +
      projectedFaceRadius(second, axis) -
      Math.abs(dot(offset, axis));
    if (overlap <= SURFACE_PLANE_EPSILON) return false;
  }
  return true;
}

function facesHaveAlignedTangentAxes(first: BoxFace, second: BoxFace): boolean {
  const threshold = 1 - SURFACE_PARALLEL_EPSILON;
  const firstUAlignment = Math.max(
    Math.abs(dot(first.u, second.u)),
    Math.abs(dot(first.u, second.v))
  );
  const firstVAlignment = Math.max(
    Math.abs(dot(first.v, second.u)),
    Math.abs(dot(first.v, second.v))
  );
  return firstUAlignment >= threshold && firstVAlignment >= threshold;
}

type FaceRect = { u0: number; u1: number; v0: number; v1: number };

function faceRectInBasis(basis: BoxFace, face: BoxFace): FaceRect {
  const offset = subtract(face.center, basis.center);
  const u = dot(offset, basis.u);
  const v = dot(offset, basis.v);
  const halfU = projectedFaceRadius(face, basis.u);
  const halfV = projectedFaceRadius(face, basis.v);
  return { u0: u - halfU, u1: u + halfU, v0: v - halfV, v1: v + halfV };
}

/**
 * Suppress a pairwise edge-gap only when other coplanar, co-oriented Cube faces
 * cover its ENTIRE strip. This is geometric coverage, not visibility/alpha or
 * semantic acceptance. Partial coverage must retain the review hint.
 */
function isCoplanarStripCovered(
  basis: BoxFace,
  strip: FaceRect,
  coverageBoxes: readonly OrientedBox[]
): boolean {
  let uncovered: FaceRect[] = [strip];
  for (const box of coverageBoxes) {
    for (const face of boxFaces(box)) {
      if (dot(basis.normal, face.normal) < 1 - SURFACE_PARALLEL_EPSILON) continue;
      if (
        Math.abs(dot(subtract(face.center, basis.center), basis.normal)) >
        SURFACE_PLANE_EPSILON
      ) continue;
      // Do not let a rotated face's projected bounding rectangle certify cover.
      const aligned = [basis.u, basis.v].every((axis) =>
        Math.max(Math.abs(dot(axis, face.u)), Math.abs(dot(axis, face.v))) >=
        1 - 1e-12
      );
      if (!aligned) continue;

      const cover = faceRectInBasis(basis, face);
      if (![cover.u0, cover.u1, cover.v0, cover.v1].every(Number.isFinite)) continue;
      const next: FaceRect[] = [];
      const retain = (rect: FaceRect): void => {
        if (
          rect.u1 - rect.u0 > SURFACE_PLANE_EPSILON &&
          rect.v1 - rect.v0 > SURFACE_PLANE_EPSILON
        ) next.push(rect);
      };
      for (const rect of uncovered) {
        const u0 = Math.max(rect.u0, cover.u0);
        const u1 = Math.min(rect.u1, cover.u1);
        const v0 = Math.max(rect.v0, cover.v0);
        const v1 = Math.min(rect.v1, cover.v1);
        if (u1 - u0 <= SURFACE_PLANE_EPSILON || v1 - v0 <= SURFACE_PLANE_EPSILON) {
          next.push(rect);
          continue;
        }
        retain({ ...rect, u1: u0 });
        retain({ ...rect, u0: u1 });
        retain({ u0, u1, v0: rect.v0, v1: v0 });
        retain({ u0, u1, v0: v1, v1: rect.v1 });
      }
      if (next.length === 0) return true;
      // Bound fragmentation conservatively: uncertainty keeps the warning.
      if (next.length > 64) return false;
      uncovered = next;
    }
  }
  return false;
}

function findCoplanarEdgeGap(
  first: OrientedBox,
  second: OrientedBox,
  maxDistance: number,
  coverageBoxes: readonly OrientedBox[]
): { distance: number; shared_span: number } | null {
  let best: { distance: number; shared_span: number } | null = null;

  for (const firstFace of boxFaces(first)) {
    for (const secondFace of boxFaces(second)) {
      if (
        dot(firstFace.normal, secondFace.normal) <
        1 - SURFACE_PARALLEL_EPSILON
      ) {
        continue;
      }

      const offset = subtract(secondFace.center, firstFace.center);
      const planeDistance = Math.abs(dot(offset, firstFace.normal));
      if (planeDistance > SURFACE_PLANE_EPSILON) continue;
      if (!facesHaveAlignedTangentAxes(firstFace, secondFace)) continue;

      const a = faceRectInBasis(firstFace, firstFace);
      const b = faceRectInBasis(firstFace, secondFace);
      const sharedU0 = Math.max(a.u0, b.u0);
      const sharedU1 = Math.min(a.u1, b.u1);
      const sharedV0 = Math.max(a.v0, b.v0);
      const sharedV1 = Math.min(a.v1, b.v1);
      const uOverlap = sharedU1 - sharedU0;
      const vOverlap = sharedV1 - sharedV0;
      const candidates: Array<{
        distance: number;
        shared_span: number;
        strip: FaceRect;
      }> = [];
      if (uOverlap < -SURFACE_PLANE_EPSILON && vOverlap > SURFACE_PLANE_EPSILON) {
        candidates.push({
          distance: -uOverlap,
          shared_span: vOverlap,
          strip: { u0: sharedU1, u1: sharedU0, v0: sharedV0, v1: sharedV1 },
        });
      }
      if (vOverlap < -SURFACE_PLANE_EPSILON && uOverlap > SURFACE_PLANE_EPSILON) {
        candidates.push({
          distance: -vOverlap,
          shared_span: uOverlap,
          strip: { u0: sharedU0, u1: sharedU1, v0: sharedV1, v1: sharedV0 },
        });
      }

      for (const candidate of candidates) {
        if (candidate.distance > maxDistance) continue;
        if (isCoplanarStripCovered(firstFace, candidate.strip, coverageBoxes)) continue;
        if (
          best === null ||
          candidate.distance < best.distance - SURFACE_PLANE_EPSILON ||
          (Math.abs(candidate.distance - best.distance) <=
            SURFACE_PLANE_EPSILON &&
            candidate.shared_span > best.shared_span)
        ) {
          best = { distance: candidate.distance, shared_span: candidate.shared_span };
        }
      }
    }
  }

  return best;
}

function findParallelFacePlaneDistance(
  first: OrientedBox,
  second: OrientedBox,
  relation: "same" | "opposite",
  maxDistance: number
): number | null {
  let best: number | null = null;
  for (const firstFace of boxFaces(first)) {
    for (const secondFace of boxFaces(second)) {
      const alignment = dot(firstFace.normal, secondFace.normal);
      if (
        relation === "same"
          ? alignment < 1 - SURFACE_PARALLEL_EPSILON
          : alignment > -1 + SURFACE_PARALLEL_EPSILON
      ) {
        continue;
      }

      const planeDistance = Math.abs(
        dot(subtract(secondFace.center, firstFace.center), firstFace.normal)
      );
      if (planeDistance > maxDistance) continue;
      if (!facesOverlapInPlane(firstFace, secondFace)) continue;
      if (best === null || planeDistance < best) best = planeDistance;
    }
  }
  return best;
}

/**
 * Objective review hints for Cube-vs-Cube surface construction.
 *
 * These are intentionally non-verdict diagnostics: they detect narrow geometric
 * patterns that often produce visible z-fighting, hairline gaps, or accidental
 * near-overlap, but they do not decide semantic intent or visual acceptance.
 */
export function analyzeOrientedBoxSurfaceQuality(
  first: OrientedBox,
  second: OrientedBox,
  coverageBoxes: readonly OrientedBox[] = []
): SurfaceQualityRisk[] {
  const risks: SurfaceQualityRisk[] = [];

  const coplanarPlaneDistance = findParallelFacePlaneDistance(
    first,
    second,
    "same",
    SURFACE_PLANE_EPSILON
  );
  if (coplanarPlaneDistance !== null) {
    risks.push({
      kind: "coplanar_overlap",
      plane_distance: coplanarPlaneDistance,
    });
  }

  const contact = analyzeOrientedBoxContact(
    first,
    second,
    SURFACE_PLANE_EPSILON
  );

  if (
    contact.classification === "separate" &&
    contact.separation <= SURFACE_MICRO_GAP_REVIEW_DISTANCE
  ) {
    const opposingPlaneDistance = findParallelFacePlaneDistance(
      first,
      second,
      "opposite",
      SURFACE_MICRO_GAP_REVIEW_DISTANCE
    );
    if (opposingPlaneDistance !== null) {
      risks.push({ kind: "micro_gap", distance: contact.separation });
    }
  }

  if (
    contact.classification === "separate" &&
    contact.separation > SURFACE_MICRO_GAP_REVIEW_DISTANCE
  ) {
    const edgeGap = findCoplanarEdgeGap(
      first,
      second,
      SURFACE_COPLANAR_EDGE_GAP_REVIEW_DISTANCE,
      coverageBoxes
    );
    if (edgeGap !== null) {
      risks.push({
        kind: "coplanar_edge_gap",
        distance: edgeGap.distance,
        shared_span: edgeGap.shared_span,
      });
    }
  }

  if (
    contact.classification === "intersecting" &&
    contact.penetrationDepth <= SURFACE_SHALLOW_PENETRATION_REVIEW_DEPTH
  ) {
    const opposingPlaneDistance = findParallelFacePlaneDistance(
      first,
      second,
      "opposite",
      SURFACE_SHALLOW_PENETRATION_REVIEW_DEPTH
    );
    if (opposingPlaneDistance !== null) {
      risks.push({
        kind: "shallow_penetration",
        depth: contact.penetrationDepth,
      });
    }
  }

  return risks;
}

function boxesMayHaveSurfaceRisk(first: OrientedBox, second: OrientedBox): boolean {
  const offset = subtract(second.center, first.center);
  const firstRadius = Math.hypot(...first.halfSizes);
  const secondRadius = Math.hypot(...second.halfSizes);
  const maxDistance =
    firstRadius +
    secondRadius +
    Math.max(
      SURFACE_MICRO_GAP_REVIEW_DISTANCE,
      SURFACE_COPLANAR_EDGE_GAP_REVIEW_DISTANCE
    );
  return dot(offset, offset) <= maxDistance * maxDistance;
}

function formatSurfaceMetric(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : String(value);
}

/**
 * Conservative world-X OBB sweep interval. Expanded by the widest surface
 * review tolerance; overflow widens, never silently prunes, evidence.
 */
export function surfaceSweepIntervalForOrientedBox(box: OrientedBox): { minX: number; maxX: number } {
  const reach = Math.hypot(...box.halfSizes) + SURFACE_COPLANAR_EDGE_GAP_REVIEW_DISTANCE;
  const minX = box.center[0] - reach;
  const maxX = box.center[0] + reach;
  return {
    minX: Number.isNaN(minX) ? Number.NEGATIVE_INFINITY : minX,
    maxX: Number.isNaN(maxX) ? Number.POSITIVE_INFINITY : maxX,
  };
}

function readSurfaceQualityWarnings(cubes: readonly Cube[]): string[] {
  const measured: Array<{ cube: Cube; box: OrientedBox }> = [];
  const warnings: string[] = [];
  let omittedWarningCount = 0;

  const pushWarning = (warning: string): void => {
    if (warnings.length < SURFACE_WARNING_LIMIT) warnings.push(warning);
    else omittedWarningCount += 1;
  };

  for (const cube of cubes) {
    try {
      measured.push({ cube, box: orientedBoxFromCube(cube) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushWarning(
        `Surface-quality diagnostics unavailable for Cube "${cube.name}" (${cube.uuid}): ${message}`
      );
    }
  }

  const coverageBoxes = measured.map(({ box }) => box);
  const sweep = measured.map((item) => ({
    ...item,
    interval: surfaceSweepIntervalForOrientedBox(item.box),
  })).sort((a, b) => a.interval.minX < b.interval.minX ? -1 :
    a.interval.minX > b.interval.minX ? 1 : a.cube.uuid.localeCompare(b.cube.uuid));
  let candidatePairCount = 0, analyzedPairCount = 0;
  let candidateBudgetReached = false, pairBudgetReached = false;

  pairScan: for (let i = 0; i < sweep.length; i++) {
    const first = sweep[i];
    for (let j = i + 1; j < sweep.length; j++) {
      const second = sweep[j];
      if (second.interval.minX > first.interval.maxX) break;
      if (candidatePairCount >= SURFACE_PAIR_CANDIDATE_LIMIT) {
        candidateBudgetReached = true;
        break pairScan;
      }
      candidatePairCount++;
      if (!boxesMayHaveSurfaceRisk(first.box, second.box)) continue;
      if (analyzedPairCount >= SURFACE_PAIR_ANALYSIS_LIMIT) {
        pairBudgetReached = true;
        break pairScan;
      }
      analyzedPairCount++;
      let risks: SurfaceQualityRisk[];
      try {
        risks = analyzeOrientedBoxSurfaceQuality(first.box, second.box, coverageBoxes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushWarning(
          `Surface-quality pair diagnostics unavailable for Cube "${first.cube.name}" (${first.cube.uuid}) and "${second.cube.name}" (${second.cube.uuid}): ${message}`
        );
        continue;
      }

      for (const risk of risks) {
        const pair = `Cube "${first.cube.name}" (${first.cube.uuid}) and "${second.cube.name}" (${second.cube.uuid})`;
        if (risk.kind === "coplanar_overlap") {
          pushWarning(
            `Possible z-fighting: ${pair} expose overlapping same-facing coplanar surfaces (plane delta ${formatSurfaceMetric(risk.plane_distance)} Blockbench units). Review the visible surface/layer relationship.`
          );
        } else if (risk.kind === "micro_gap") {
          pushWarning(
            `Possible micro-gap: ${pair} have overlapping opposing faces separated by ${formatSurfaceMetric(risk.distance)} Blockbench units. Review the intended contact seam.`
          );
        } else if (risk.kind === "coplanar_edge_gap") {
          pushWarning(
            `Possible coplanar edge-gap: ${pair} expose same-facing coplanar surface edges separated by ${formatSurfaceMetric(risk.distance)} Blockbench units across ${formatSurfaceMetric(risk.shared_span)} units of shared edge span. Review whether this is an intentional opening or missing surface coverage.`
          );
        } else {
          pushWarning(
            `Possible shallow penetration: ${pair} overlap by ${formatSurfaceMetric(risk.depth)} Blockbench units across opposing face regions. Review whether the overlap is intentional construction.`
          );
        }
      }
    }
  }

  if (candidateBudgetReached) {
    warnings.push(
      "Surface-quality diagnostics stopped after " + SURFACE_PAIR_CANDIDATE_LIMIT +
      " broad-phase candidate Cube pair(s); absence of further warnings is not a clean-surface claim."
    );
  }
  if (pairBudgetReached) {
    // Scan completeness must never be hidden by the defect-warning cap.
    warnings.push(
      `Surface-quality diagnostics stopped after ${SURFACE_PAIR_ANALYSIS_LIMIT} nearby Cube pair(s); absence of further warnings is not a clean-surface claim.`
    );
  }
  if (omittedWarningCount > 0) {
    warnings.push(
      `${omittedWarningCount} additional surface-quality warning(s) were omitted from this bounded diagnostic. Use semantic assembly context and fresh model views before any visual verdict.`
    );
  }

  return warnings;
}

export function summarizeFiniteBounds(
  min: Vec3,
  max: Vec3
): { center: Vec3; size: Vec3 } {
  const size: Vec3 = [
    normalizeNumber(max[0] - min[0]),
    normalizeNumber(max[1] - min[1]),
    normalizeNumber(max[2] - min[2]),
  ];
  if (size.some((value) => !Number.isFinite(value))) {
    throw new Error("Rendered model bounds span is non-finite and cannot be trusted.");
  }

  const center: Vec3 = [
    normalizeNumber(min[0] + size[0] / 2),
    normalizeNumber(min[1] + size[1] / 2),
    normalizeNumber(min[2] + size[2] / 2),
  ];
  if (center.some((value) => !Number.isFinite(value))) {
    throw new Error("Rendered model bounds center is non-finite and cannot be trusted.");
  }

  return { center, size };
}

function asFiniteVec3(value: unknown, cubeName: string): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(
      `Cube "${cubeName}" returned invalid global vertex data. Rendered bounds cannot be trusted.`
    );
  }

  return [
    normalizeNumber(value[0]),
    normalizeNumber(value[1]),
    normalizeNumber(value[2]),
  ];
}

export function isEffectivelyVisible(object: THREE.Object3D | undefined): boolean {
  if (!object) return false;

  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }

  return true;
}

function ensureCurrentWorldMatrix(cube: Cube): void {
  if (!cube.mesh) {
    throw new Error(
      `Cube "${cube.name}" has no preview mesh. Rendered bounds cannot be observed reliably.`
    );
  }

  // Update the Cube and all parent transforms before asking Blockbench for its
  // global vertices. This is state-neutral: it refreshes Three.js transform
  // matrices but does not author or mutate model geometry.
  cube.mesh.updateWorldMatrix(true, false);
}

/**
 * Read the active project's currently rendered Cube envelope.
 *
 * Blockbench's Cube.getGlobalVertexPositions() is the authority here because it
 * transforms inflated/stretched Cube corners through the preview mesh's
 * matrixWorld. That keeps Cube rotation and active parent/group transforms in
 * the same coordinate basis the viewport renders.
 *
 * This helper intentionally does not accept target dimensions and never judges
 * whether the model is correct. It returns observation facts only. Surface-risk
 * warnings are bounded review hints, never visual PASS/FAIL.
 */
function readRenderedBoundsFromCubes(
  renderedCubes: readonly Cube[],
  totalCubeCount: number,
  hiddenCubeCount: number,
  warnings: string[]
): RenderedModelBoundsObservation {
  if (renderedCubes.length === 0) {
    return {
      total_cube_count: totalCubeCount,
      rendered_cube_count: 0,
      hidden_cube_count: hiddenCubeCount,
      bounds: null,
      warnings,
    };
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (const cube of renderedCubes) {
    ensureCurrentWorldMatrix(cube);

    const rawVertices = cube.getGlobalVertexPositions();
    if (!Array.isArray(rawVertices) || rawVertices.length !== 8) {
      throw new Error(
        `Cube "${cube.name}" did not return the expected 8 global vertices. Rendered bounds cannot be trusted.`
      );
    }

    for (const rawVertex of rawVertices) {
      const vertex = asFiniteVec3(rawVertex, cube.name);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }

  if (
    min.some((value) => !Number.isFinite(value)) ||
    max.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Rendered model bounds are non-finite and cannot be trusted.");
  }

  const { center, size } = summarizeFiniteBounds(min, max);
  warnings.push(...readSurfaceQualityWarnings(renderedCubes));

  return {
    total_cube_count: totalCubeCount,
    rendered_cube_count: renderedCubes.length,
    hidden_cube_count: hiddenCubeCount,
    bounds: {
      min: [...min],
      max: [...max],
      center,
      size_xyz: size,
      dimensions: {
        width: size[0],
        height: size[1],
        length: size[2],
      },
      footprint: {
        min_xz: [min[0], min[2]],
        max_xz: [max[0], max[2]],
        size: {
          width: size[0],
          length: size[2],
        },
      },
    },
    warnings,
  };
}

function requireCubeBoundsProject(): void {
  if (!Project) {
    throw new Error(
      "No project is open. Open or create the intended Bedrock project before inspecting model bounds."
    );
  }
  if (Mesh.all.length > 0) {
    throw new Error(
      `inspect_model_bounds v1 supports Cube-based Bedrock geometry only. Found ${Mesh.all.length} Mesh element(s); refusing to report incomplete whole-model bounds.`
    );
  }
}

export function readRenderedCubeBounds(
  cubeIds: readonly string[]
): RenderedModelBoundsObservation {
  requireCubeBoundsProject();
  if (cubeIds.length === 0 || cubeIds.length > 32 || new Set(cubeIds).size !== cubeIds.length) {
    throw new Error("Targeted rendered bounds require 1-32 unique Cube UUIDs.");
  }

  const cubes = cubeIds.map((uuid) => {
    const cube = Cube.all.find((candidate) => candidate.uuid === uuid);
    if (!cube) throw new Error(`Target Cube UUID "${uuid}" was not found.`);
    if (cube.visibility === false || !isEffectivelyVisible(cube.mesh)) {
      throw new Error(
        `Target Cube "${cube.name}" (${cube.uuid}) is not currently rendered; targeted capture refuses partial evidence.`
      );
    }
    return cube;
  });

  return readRenderedBoundsFromCubes(cubes, cubes.length, 0, []);
}

export function readRenderedModelBounds(): RenderedModelBoundsObservation {
  requireCubeBoundsProject();

  const totalCubeCount = Cube.all.length;
  const renderedCubes = Cube.all.filter(
    (cube) => cube.visibility !== false && isEffectivelyVisible(cube.mesh)
  );
  const hiddenCubeCount = totalCubeCount - renderedCubes.length;
  const warnings: string[] = [];

  if (hiddenCubeCount > 0) {
    warnings.push(
      `${hiddenCubeCount} hidden/non-rendered Cube(s) were excluded from rendered bounds.`
    );
  }

  return readRenderedBoundsFromCubes(
    renderedCubes,
    totalCubeCount,
    hiddenCubeCount,
    warnings
  );
}
