export type TextureSeamRgba = [number, number, number, number];

export type TextureSeamEdgeInput = {
  cube_uuid: string;
  cube_name: string;
  face: string;
  edge: "left" | "right" | "top" | "bottom";
  start: [number, number, number];
  end: [number, number, number];
  samples: TextureSeamRgba[];
};

export const TEXTURE_SEAM_EXAMPLE_LIMIT = 6;

/** Alpha may represent opacity/cutout or a non-opacity color/emissive mask. */
export type TextureSeamAlphaSemantics = "OPACITY" | "NON_OPACITY";

function requireAlphaSemantics(value: TextureSeamAlphaSemantics): void {
  if (value !== "OPACITY" && value !== "NON_OPACITY") {
    throw new Error("Texture seam alpha semantics must be OPACITY or NON_OPACITY.");
  }
}
const POSITION_QUANTIZATION = 100_000;

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function requireEdge(edge: TextureSeamEdgeInput): void {
  if (
    edge.samples.length === 0 ||
    edge.samples.some(
      (sample) =>
        sample.length !== 4 ||
        sample.some((value) => !Number.isFinite(value) || value < 0 || value > 255)
    )
  ) {
    throw new Error("Texture seam edge samples must contain finite RGBA bytes.");
  }
  if ([...edge.start, ...edge.end].some((value) => !Number.isFinite(value))) {
    throw new Error("Texture seam edge endpoints must be finite 3D coordinates.");
  }
}

function pointKey(point: readonly number[]): string {
  return point
    .map((value) => Math.round(value * POSITION_QUANTIZATION))
    .join(",");
}

function canonicalEdgeKey(edge: TextureSeamEdgeInput): string {
  const start = pointKey(edge.start);
  const end = pointKey(edge.end);
  return start < end
    ? `${edge.cube_uuid}|${start}|${end}`
    : `${edge.cube_uuid}|${end}|${start}`;
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  return (
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2
  );
}

function normalizedRgbDifference(
  left: TextureSeamRgba,
  right: TextureSeamRgba
): number {
  const distance = Math.sqrt(
    (left[0] - right[0]) ** 2 +
    (left[1] - right[1]) ** 2 +
    (left[2] - right[2]) ** 2
  );
  return distance / Math.sqrt(3 * 255 ** 2);
}

function alignedSamples(
  left: TextureSeamEdgeInput,
  right: TextureSeamEdgeInput
): { left: TextureSeamRgba[]; right: TextureSeamRgba[] } {
  const reverse =
    squaredDistance(left.start, right.end) +
      squaredDistance(left.end, right.start) <
    squaredDistance(left.start, right.start) +
      squaredDistance(left.end, right.end);

  const rightSamples = reverse ? [...right.samples].reverse() : right.samples;
  const count = Math.min(left.samples.length, rightSamples.length);
  if (count <= 0) return { left: [], right: [] };

  const sampleAt = (samples: readonly TextureSeamRgba[], index: number) => {
    if (count === 1) return samples[Math.floor(samples.length / 2)];
    const normalized = index / (count - 1);
    return samples[
      Math.min(
        samples.length - 1,
        Math.round(normalized * (samples.length - 1))
      )
    ];
  };

  return {
    left: Array.from({ length: count }, (_, index) => sampleAt(left.samples, index)),
    right: Array.from({ length: count }, (_, index) => sampleAt(rightSamples, index)),
  };
}

function seamSummary(
  left: TextureSeamEdgeInput,
  right: TextureSeamEdgeInput,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  const aligned = alignedSamples(left, right);
  let rgbSum = 0;
  let rgbMax = 0;
  let alphaSum = 0;
  let alphaMax = 0;
  let visiblePairs = 0;
  let rgbEvaluatedSamples = 0;

  for (let index = 0; index < aligned.left.length; index += 1) {
    const a = aligned.left[index];
    const b = aligned.right[index];
    // RGB underneath fully transparent pixels is not visible seam evidence.
    // One-sided coverage still contributes to the separate alpha diagnostic.
    if (alphaSemantics === "NON_OPACITY" || (a[3] > 0 && b[3] > 0)) {
      const rgb = normalizedRgbDifference(a, b);
      rgbSum += rgb;
      rgbMax = Math.max(rgbMax, rgb);
      rgbEvaluatedSamples += 1;
    }
    const alpha = Math.abs(a[3] - b[3]) / 255;
    alphaSum += alpha;
    alphaMax = Math.max(alphaMax, alpha);
    if (alphaSemantics === "NON_OPACITY" || a[3] > 0 || b[3] > 0) visiblePairs += 1;
  }

  const count = aligned.left.length;
  const meanRgb = rgbEvaluatedSamples === 0 ? null : rgbSum / rgbEvaluatedSamples;
  const meanAlpha = count === 0 ? 0 : alphaSum / count;

  return {
    cube_uuid: left.cube_uuid,
    cube_name: left.cube_name,
    faces: [
      { face: left.face, edge: left.edge },
      { face: right.face, edge: right.edge },
    ],
    sample_count: count,
    alpha_semantics: alphaSemantics,
    visible_pair_ratio: ratio(visiblePairs, count),
    rgb_evaluated_sample_count: rgbEvaluatedSamples,
    mean_rgb_difference: meanRgb === null ? null : Number(meanRgb.toFixed(4)),
    max_rgb_difference: rgbEvaluatedSamples === 0 ? null : Number(rgbMax.toFixed(4)),
    mean_alpha_difference: Number(meanAlpha.toFixed(4)),
    max_alpha_difference: Number(alphaMax.toFixed(4)),
    high_contrast: meanRgb !== null && meanRgb >= 0.4,
    alpha_discontinuity: alphaMax >= 0.5,
  };
}

export function analyzeTextureSeamContinuity(
  edges: readonly TextureSeamEdgeInput[],
  exampleLimit = TEXTURE_SEAM_EXAMPLE_LIMIT,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  requireAlphaSemantics(alphaSemantics);
  for (const edge of edges) requireEdge(edge);

  const groups = new Map<string, TextureSeamEdgeInput[]>();
  for (const edge of edges) {
    const key = canonicalEdgeKey(edge);
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const paired = [...groups.values()]
    .filter((group) => group.length === 2 && group[0].face !== group[1].face)
    .map((group) => seamSummary(group[0], group[1], alphaSemantics))
    .sort(
      (a, b) =>
        (b.mean_rgb_difference ?? -1) - (a.mean_rgb_difference ?? -1) ||
        b.mean_alpha_difference - a.mean_alpha_difference
    );
  const unpaired = [...groups.values()].filter((group) => group.length === 1);
  const ambiguous = [...groups.values()].filter((group) => group.length > 2);
  const review = paired.filter(
    (seam) => seam.high_contrast || seam.alpha_discontinuity
  );

  return {
    state: edges.length === 0 ? ("not_applicable" as const) : ("available" as const),
    scope: "intra_cube" as const,
    alpha_semantics: alphaSemantics,
    cross_cube_continuity: "not_evaluated" as const,
    sampled_edge_count: edges.length,
    paired_seam_count: paired.length,
    unpaired_edge_count: unpaired.length,
    ambiguous_edge_count: ambiguous.length,
    review: {
      candidate_count: review.length,
      high_contrast_count: review.filter((seam) => seam.high_contrast).length,
      alpha_discontinuity_count: review.filter((seam) => seam.alpha_discontinuity).length,
      examples: review.slice(0, exampleLimit),
      examples_truncated: review.length > exampleLimit,
    },
    ranked_examples: paired.slice(0, exampleLimit),
    ranked_examples_truncated: paired.length > exampleLimit,
    gate: {
      state: "advisory" as const,
      reasons: review.length > 0 ? ["SEAM_CONTINUITY_REVIEW"] : [],
    },
    note:
      "Only face edges within the same Cube are paired; cross-Cube continuity is not evaluated. OPACITY mode excludes RGB whenever either alpha is zero; NON_OPACITY mode retains RGB for color/emissive masks. The caller must confirm actual render-profile alpha meaning. Alpha differences remain reviewable; seam contrast is advisory evidence, not a style score or automatic visual failure.",
  };
}


/**
 * Cross-Cube evidence requires explicit semantic continuity intent.
 * Coincident endpoints alone do not prove a shared surface, material,
 * texture revision, or a visual defect. Native sampling is a later owner.
 */
export type CrossCubeSeamEdgeInput = TextureSeamEdgeInput & {
  continuity_intent: "REQUIRED" | "INTENTIONAL_BOUNDARY" | "UNSPECIFIED";
  surface_id: string | null;
  material_id: string | null;
  /** Caller-supplied world-facing normal; not native-attested by this pure helper. */
  world_normal: readonly [number, number, number];
};

type CrossCubeSkipReason =
  | "SAME_CUBE"
  | "INTENTIONAL_BOUNDARY"
  | "CONTINUITY_UNDECLARED"
  | "SURFACE_OR_MATERIAL_MISMATCH"
  | "WORLD_EDGE_MISMATCH"
  | "NORMAL_ALIGNMENT_UNVERIFIED"
  | "SAMPLE_ALIGNMENT_UNVERIFIED";

const CROSS_CUBE_INPUT_LIMIT = 2048;
const CROSS_CUBE_SAMPLE_LIMIT = 1024;
const CROSS_CUBE_ENDPOINT_EPSILON = 1e-6;
const CROSS_CUBE_NORMAL_DOT = 0.9999;

/**
 * Match physical edges by actual endpoint distance, not a rounded string key:
 * neighboring coordinates can fall on opposite sides of a quantization bin.
 * Index both endpoints into adjacent epsilon-sized spatial cells, then check
 * both complete segments before merging any connected matches. A nontransitive
 * chain remains an ambiguous group (>2), never a fabricated clean pair.
 */
function groupCrossCubeEdges(
  edges: readonly CrossCubeSeamEdgeInput[]
): CrossCubeSeamEdgeInput[][] {
  const parents = edges.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== root) {
      const previous = parents[index];
      parents[index] = root;
      index = previous;
    }
    return root;
  };
  const unite = (a: number, b: number): void => {
    const left = find(a), right = find(b);
    if (left !== right) parents[right] = left;
  };
  const cellKey = (x: number, y: number, z: number): string =>
    x + "," + y + "," + z;
  const index = new Map<string, number[]>();
  const eps = CROSS_CUBE_ENDPOINT_EPSILON;
  const epsSquared = eps * eps;
  const sameEdge = (a: CrossCubeSeamEdgeInput, b: CrossCubeSeamEdgeInput): boolean =>
    (squaredDistance(a.start, b.start) <= epsSquared &&
      squaredDistance(a.end, b.end) <= epsSquared) ||
    (squaredDistance(a.start, b.end) <= epsSquared &&
      squaredDistance(a.end, b.start) <= epsSquared);

  edges.forEach((edge, edgeIndex) => {
    const candidates = new Set<number>();
    for (const point of [edge.start, edge.end]) {
      const [x, y, z] = point.map(value => Math.floor(value / eps));
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const nearby = index.get(cellKey(x + dx, y + dy, z + dz));
            if (nearby) for (const match of nearby) candidates.add(match);
          }
    }
    for (const candidate of candidates) {
      if (sameEdge(edge, edges[candidate])) unite(edgeIndex, candidate);
    }
    for (const point of [edge.start, edge.end]) {
      const key = cellKey(
        Math.floor(point[0] / eps),
        Math.floor(point[1] / eps),
        Math.floor(point[2] / eps)
      );
      const stored = index.get(key) ?? [];
      stored.push(edgeIndex);
      index.set(key, stored);
    }
  });

  const groups = new Map<number, CrossCubeSeamEdgeInput[]>();
  edges.forEach((edge, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(edge);
    groups.set(root, group);
  });
  return [...groups.values()];
}

function normalizedWorldNormal(edge: CrossCubeSeamEdgeInput): [number, number, number] {
  const n = edge.world_normal;
  if (n.length !== 3 || n.some((v) => !Number.isFinite(v))) {
    throw new Error("Cross-Cube seam world normal must contain three finite values.");
  }
  const magnitude = Math.hypot(...n);
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) {
    throw new Error("Cross-Cube seam world normal must be non-zero and finite.");
  }
  return [n[0] / magnitude, n[1] / magnitude, n[2] / magnitude];
}

function requireCrossCubeEdge(edge: CrossCubeSeamEdgeInput): void {
  requireEdge(edge);
  if (!edge.cube_uuid.trim() || !edge.face.trim() ||
      edge.samples.length < 2 || edge.samples.length > CROSS_CUBE_SAMPLE_LIMIT) {
    throw new Error("Cross-Cube seam requires a Cube UUID, face, and 2..1024 pixel samples.");
  }
  if ([...edge.start, ...edge.end].some((v) => Math.abs(v) > 30_000_000) ||
      squaredDistance(edge.start, edge.end) <= CROSS_CUBE_ENDPOINT_EPSILON ** 2) {
    throw new Error("Cross-Cube seam physical edge is degenerate or out of bounds.");
  }
  normalizedWorldNormal(edge);
}

function crossCubeSkipReason(
  left: CrossCubeSeamEdgeInput,
  right: CrossCubeSeamEdgeInput
): CrossCubeSkipReason | null {
  if (left.cube_uuid === right.cube_uuid) return "SAME_CUBE";
  if (left.continuity_intent === "INTENTIONAL_BOUNDARY" ||
      right.continuity_intent === "INTENTIONAL_BOUNDARY") return "INTENTIONAL_BOUNDARY";
  if (left.continuity_intent !== "REQUIRED" ||
      right.continuity_intent !== "REQUIRED") return "CONTINUITY_UNDECLARED";
  if (!left.surface_id || !right.surface_id ||
      !left.material_id || !right.material_id ||
      left.surface_id !== right.surface_id ||
      left.material_id !== right.material_id) return "SURFACE_OR_MATERIAL_MISMATCH";

  const epsilonSquared = CROSS_CUBE_ENDPOINT_EPSILON ** 2;
  const same = squaredDistance(left.start, right.start) <= epsilonSquared &&
    squaredDistance(left.end, right.end) <= epsilonSquared;
  const reversed = squaredDistance(left.start, right.end) <= epsilonSquared &&
    squaredDistance(left.end, right.start) <= epsilonSquared;
  if (!same && !reversed) return "WORLD_EDGE_MISMATCH";

  const a = normalizedWorldNormal(left), b = normalizedWorldNormal(right);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot < CROSS_CUBE_NORMAL_DOT) return "NORMAL_ALIGNMENT_UNVERIFIED";
  if (left.samples.length !== right.samples.length) return "SAMPLE_ALIGNMENT_UNVERIFIED";
  return null;
}

/**
 * Conservative diagnostics for exactly paired, explicitly continuous,
 * same-facing Cube surface edges. It never declares a visual PASS/FAIL,
 * silently joins T-junctions, or calls a different-material boundary broken.
 */
export function analyzeCrossCubeSeamContinuity(
  edges: readonly CrossCubeSeamEdgeInput[],
  exampleLimit = TEXTURE_SEAM_EXAMPLE_LIMIT,
  alphaSemantics: TextureSeamAlphaSemantics = "OPACITY"
) {
  requireAlphaSemantics(alphaSemantics);
  if (edges.length > CROSS_CUBE_INPUT_LIMIT ||
      !Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 30) {
    throw new Error("Cross-Cube seam input/example budget exceeded.");
  }
  for (const edge of edges) requireCrossCubeEdge(edge);
  const groups = groupCrossCubeEdges(edges);

  const paired: Array<ReturnType<typeof seamSummary> & {
    cubes: [{ uuid: string; name: string }, { uuid: string; name: string }];
    surface_id: string;
    material_id: string;
  }> = [];
  const skips: Record<CrossCubeSkipReason, number> = {
    SAME_CUBE: 0,
    INTENTIONAL_BOUNDARY: 0,
    CONTINUITY_UNDECLARED: 0,
    SURFACE_OR_MATERIAL_MISMATCH: 0,
    WORLD_EDGE_MISMATCH: 0,
    NORMAL_ALIGNMENT_UNVERIFIED: 0,
    SAMPLE_ALIGNMENT_UNVERIFIED: 0,
  };
  let unpaired = 0, ambiguous = 0;

  for (const group of groups) {
    if (group.length === 1) { unpaired++; continue; }
    if (group.length !== 2) { ambiguous++; continue; }
    const [left, right] = group;
    const reason = crossCubeSkipReason(left, right);
    if (reason) { skips[reason]++; continue; }
    paired.push({
      ...seamSummary(left, right, alphaSemantics),
      cubes: [
        { uuid: left.cube_uuid, name: left.cube_name },
        { uuid: right.cube_uuid, name: right.cube_name },
      ],
      surface_id: left.surface_id!,
      material_id: left.material_id!,
    });
  }
  paired.sort((a, b) =>
    (b.mean_rgb_difference ?? -1) - (a.mean_rgb_difference ?? -1) ||
    b.mean_alpha_difference - a.mean_alpha_difference ||
    a.cubes[0].uuid.localeCompare(b.cubes[0].uuid)
  );
  const review = paired.filter((pair) => pair.high_contrast || pair.alpha_discontinuity);

  return {
    state: edges.length === 0 ? ("not_applicable" as const) : ("available" as const),
    scope: "cross_cube" as const,
    alpha_semantics: alphaSemantics,
    cross_cube_continuity: paired.length ? ("diagnostic_only" as const) : ("not_evaluated" as const),
    visual_verdict: "not_evaluated" as const,
    native_sampling_attested: false as const,
    scene_coverage_attested: false as const,
    input_edge_count: edges.length,
    compared_pair_count: paired.length,
    unpaired_edge_count: unpaired,
    ambiguous_group_count: ambiguous,
    excluded_pair_count: Object.values(skips).reduce((sum, count) => sum + count, 0),
    exclusions: skips,
    review: {
      candidate_count: review.length,
      high_contrast_count: review.filter((row) => row.high_contrast).length,
      alpha_discontinuity_count: review.filter((row) => row.alpha_discontinuity).length,
      examples: review.slice(0, exampleLimit),
      examples_truncated: review.length > exampleLimit,
    },
    ranked_examples: paired.slice(0, exampleLimit),
    ranked_examples_truncated: paired.length > exampleLimit,
    gate: {
      state: "advisory" as const,
      reasons: review.length ? ["CROSS_CUBE_SEAM_REVIEW"] : [],
    },
    note: "Only caller-declared, identical-material and surface-identity, same-facing world-edge pairs are compared. OPACITY mode assumes zero alpha hides RGB; NON_OPACITY mode retains RGB for color/emissive masks. Confirm render-profile alpha meaning; texture provenance, in-game rendering and unexamined edges remain unverified. This is not a visual verdict.",
  };
}
