export type TextureSeamRgba = [number, number, number, number];

export type TextureSeamContinuityIntent =
  | "REQUIRED" | "INTENTIONAL_BOUNDARY" | "UNSPECIFIED";

export type TextureSeamEdgeInput = {
  cube_uuid: string;
  cube_name: string;
  face: string;
  edge: "left" | "right" | "top" | "bottom";
  start: [number, number, number];
  end: [number, number, number];
  samples: TextureSeamRgba[];
  /** Optional for intra-Cube edges; an explicit intent comes from approved material design. */
  continuity_intent?: TextureSeamContinuityIntent;
};

export const TEXTURE_SEAM_EXAMPLE_LIMIT = 6;

export type TextureSeamSkippedFace = {
  cube_uuid: string;
  face: string;
  reason: "animated_texture" | "mapping_unavailable" | "sampling_budget";
};

export type TextureSeamScanEvidenceInput = {
  face_budget: number;
  samples_per_edge_max: number;
  scanned_faces: number;
  skipped_animated_faces: number;
  skipped_mapping_faces: number;
  budget_skipped_faces: number;
  skipped_examples?: readonly TextureSeamSkippedFace[];
};

/**
 * Bounded native sampling is not complete scene coverage, even when no
 * faces are skipped: four edge samples do not inspect the face interior,
 * image-to-geometry fidelity, or cross-Cube continuity. Never infer PASS.
 */
export function summarizeTextureSeamScanEvidence(
  input: TextureSeamScanEvidenceInput
) {
  const counters = [
    input.face_budget, input.samples_per_edge_max, input.scanned_faces,
    input.skipped_animated_faces, input.skipped_mapping_faces,
    input.budget_skipped_faces,
  ];
  if (counters.some(value => !Number.isSafeInteger(value) || value < 0) ||
      input.face_budget < 1 || input.samples_per_edge_max < 1 ||
      input.scanned_faces > input.face_budget) {
    throw new Error("Texture seam sampling evidence requires valid bounded face and sample counts.");
  }
  const omitted = input.skipped_animated_faces +
    input.skipped_mapping_faces + input.budget_skipped_faces;
  const examples = input.skipped_examples ?? [];
  if (examples.length > 12 || examples.length > omitted ||
      examples.some(item =>
        !item.cube_uuid || !item.face ||
        !["animated_texture", "mapping_unavailable", "sampling_budget"].includes(item.reason)
      )) {
    throw new Error("Texture seam sampling omission evidence is invalid or exceeds its 12-face budget.");
  }
  return {
    face_budget: input.face_budget,
    scanned_faces: input.scanned_faces,
    skipped_animated_faces: input.skipped_animated_faces,
    skipped_mapping_faces: input.skipped_mapping_faces,
    budget_skipped_faces: input.budget_skipped_faces,
    samples_per_edge_max: input.samples_per_edge_max,
    eligible_textured_face_count: input.scanned_faces + omitted,
    unexamined_face_count: omitted,
    coverage_state: input.scanned_faces === 0
      ? ("not_evaluated" as const)
      : omitted > 0
        ? ("partial" as const)
        : ("edge_samples_only" as const),
    sampling_scope: "intra_cube_face_edges" as const,
    scene_coverage_attested: false as const,
    cross_cube_sampling_attested: false as const,
    visual_verdict: "not_evaluated" as const,
    omission_examples: examples.map(item => ({ ...item })),
    omission_examples_truncated: examples.length < omitted,
    limitations: [
      "EDGE_SAMPLES_NOT_FULL_FACE_COVERAGE",
      "CROSS_CUBE_NATIVE_SEAMS_NOT_EVALUATED",
      ...(input.skipped_animated_faces > 0 ? ["ANIMATED_FACES_UNEVALUATED"] : []),
      ...(input.skipped_mapping_faces > 0 ? ["FACE_UV_MAPPING_UNEVALUATED"] : []),
      ...(input.budget_skipped_faces > 0 ? ["SAMPLING_BUDGET_EXHAUSTED"] : []),
    ],
  };
}



export type TextureModelFaceInventoryOmission = {
  cube_uuid: string;
  face: string;
  reason:
    | "face_slot_missing"
    | "face_disabled"
    | "texture_not_resolved"
    | "texture_resolver_failed"
    | "texture_outside_project";
};

export type TextureModelFaceInventoryInput = {
  cube_count: number;
  duplicate_cube_uuid_count: number;
  missing_face_slot_count: number;
  disabled_face_count: number;
  untextured_enabled_face_count: number;
  foreign_texture_enabled_face_count: number;
  resolver_error_enabled_face_count: number;
  eligible_textured_face_count: number;
  texture_inventory_state: "verified" | "partial" | "unavailable";
  outliner_element_count: number | null;
  outliner_cube_entry_count: number | null;
  outliner_non_cube_count: number | null;
  outliner_missing_cube_count: number | null;
  outliner_duplicate_entry_count: number | null;
  sampled_faces: number;
  skipped_animated_faces: number;
  skipped_mapping_faces: number;
  budget_skipped_faces: number;
  omission_examples?: readonly TextureModelFaceInventoryOmission[];
};

/**
 * Face *inventory* is not sampled-image coverage or visual verification.
 * Every native Cube contributes six face slots, including disabled and
 * untextured ones. A Mesh/non-Cube Outliner entry is never silently counted
 * as a sampled Cube face. The caller reports exact native identity counts;
 * this pure owner validates that no face disappeared from the ledger.
 */
export function summarizeTextureModelFaceInventory(
  input: TextureModelFaceInventoryInput
) {
  const numeric = [
    input.cube_count, input.duplicate_cube_uuid_count,
    input.missing_face_slot_count, input.disabled_face_count,
    input.untextured_enabled_face_count,
    input.foreign_texture_enabled_face_count,
    input.resolver_error_enabled_face_count,
    input.eligible_textured_face_count, input.sampled_faces,
    input.skipped_animated_faces, input.skipped_mapping_faces,
    input.budget_skipped_faces,
  ];
  if (numeric.some(value => !Number.isSafeInteger(value) || value < 0) ||
      !["verified", "partial", "unavailable"].includes(
        input.texture_inventory_state
      )) {
    throw new Error(
      "MODEL_FACE_INVENTORY_INVALID: face counts must be finite nonnegative safe integers."
    );
  }
  const faceSlots = input.cube_count * 6;
  if (!Number.isSafeInteger(faceSlots) ||
      input.duplicate_cube_uuid_count > input.cube_count ||
      input.missing_face_slot_count + input.disabled_face_count +
      input.untextured_enabled_face_count +
      input.foreign_texture_enabled_face_count +
      input.resolver_error_enabled_face_count +
      input.eligible_textured_face_count !== faceSlots ||
      input.sampled_faces + input.skipped_animated_faces +
      input.skipped_mapping_faces + input.budget_skipped_faces !==
        input.eligible_textured_face_count) {
    throw new Error(
      "MODEL_FACE_INVENTORY_INVALID: six slots per Cube and all sampling dispositions must reconcile exactly."
    );
  }

  const outlinerCounts = [
    input.outliner_element_count,
    input.outliner_cube_entry_count,
    input.outliner_non_cube_count,
    input.outliner_missing_cube_count,
    input.outliner_duplicate_entry_count,
  ];
  const outlinerKnown = outlinerCounts[0] !== null;
  if ((outlinerKnown && outlinerCounts.some(value =>
        value === null || !Number.isSafeInteger(value) || value < 0
      )) ||
      (!outlinerKnown && outlinerCounts.some(value => value !== null)) ||
      (outlinerKnown && (
        input.outliner_cube_entry_count! + input.outliner_non_cube_count! !==
          input.outliner_element_count ||
        input.outliner_missing_cube_count! > input.cube_count ||
        input.outliner_duplicate_entry_count! > input.outliner_element_count!
      ))) {
    throw new Error(
      "MODEL_FACE_INVENTORY_INVALID: Outliner provenance counts are inconsistent."
    );
  }

  // A missing slot has no enabled face to sample. Keep it separate from
  // enabled-but-unexamined faces; the latter must never exceed the number
  // of enabled faces in the native Cube inventory.
  const unownedEnabled =
    input.untextured_enabled_face_count +
    input.foreign_texture_enabled_face_count +
    input.resolver_error_enabled_face_count;
  const missingNativeFaces = input.missing_face_slot_count + unownedEnabled;
  const skippedSamples =
    input.skipped_animated_faces + input.skipped_mapping_faces +
    input.budget_skipped_faces;
  const unexaminedEnabled = unownedEnabled + skippedSamples;
  const unexaminedSlots = faceSlots - input.sampled_faces;
  const examples = input.omission_examples ?? [];
  const omissionCount = missingNativeFaces + input.disabled_face_count;
  if (examples.length > 12 || examples.length > omissionCount ||
      examples.some(example =>
        !example.cube_uuid || !example.face ||
        ![
          "face_slot_missing", "face_disabled", "texture_not_resolved",
          "texture_resolver_failed", "texture_outside_project",
        ].includes(example.reason)
      )) {
    throw new Error(
      "MODEL_FACE_INVENTORY_INVALID: face omission examples are not bounded or have invalid identity."
    );
  }
  const inventoryState = !outlinerKnown
    ? ("outliner_unknown" as const)
    : input.outliner_missing_cube_count! > 0 ||
      input.outliner_non_cube_count! > 0 ||
      input.outliner_duplicate_entry_count! > 0 ||
      input.duplicate_cube_uuid_count > 0 ||
      input.texture_inventory_state !== "verified"
      ? ("scene_scope_partial" as const)
      : ("cube_face_slots_enumerated" as const);
  const coverageState = input.sampled_faces === 0
    ? ("not_evaluated" as const)
    : unexaminedSlots > 0 || inventoryState !== "cube_face_slots_enumerated"
      ? ("partial" as const)
      : ("edge_samples_only" as const);
  return {
    source: "native_cube_face_inventory" as const,
    cube_count: input.cube_count,
    face_slot_count: faceSlots,
    enabled_face_count: faceSlots -
      input.missing_face_slot_count - input.disabled_face_count,
    missing_face_slot_count: input.missing_face_slot_count,
    disabled_face_count: input.disabled_face_count,
    untextured_enabled_face_count: input.untextured_enabled_face_count,
    foreign_texture_enabled_face_count: input.foreign_texture_enabled_face_count,
    resolver_error_enabled_face_count: input.resolver_error_enabled_face_count,
    eligible_textured_face_count: input.eligible_textured_face_count,
    sampled_face_count: input.sampled_faces,
    sample_skipped_face_count: skippedSamples,
    unexamined_enabled_face_count: unexaminedEnabled,
    // Includes disabled and absent slots. Unlike the enabled count this
    // answers how many of the Cube's six native slots were not sampled.
    unexamined_face_slot_count: unexaminedSlots,
    duplicate_cube_uuid_count: input.duplicate_cube_uuid_count,
    texture_inventory_state: input.texture_inventory_state,
    outliner: {
      state: outlinerKnown ? ("enumerated" as const) : ("unavailable" as const),
      element_count: input.outliner_element_count,
      cube_entry_count: input.outliner_cube_entry_count,
      non_cube_count: input.outliner_non_cube_count,
      missing_cube_count: input.outliner_missing_cube_count,
      duplicate_entry_count: input.outliner_duplicate_entry_count,
    },
    inventory_state: inventoryState,
    coverage_state: coverageState,
    omission_examples: examples.map(example => ({ ...example })),
    omission_examples_truncated: examples.length < omissionCount,
    // Enumerating every Cube face cannot prove that its image pixels,
    // hidden surfaces, material cohort or the final model look correct.
    face_interior_sampled: false as const,
    non_cube_texture_coverage_attested: false as const,
    whole_scene_visual_coverage_attested: false as const,
    visual_verdict: "not_evaluated" as const,
    limitations: [
      "FACE_INVENTORY_NOT_VISUAL_COVERAGE",
      "FACE_INTERIOR_PIXELS_NOT_SAMPLED",
      "CROSS_CUBE_NATIVE_SEAMS_NOT_EVALUATED",
      ...(missingNativeFaces > 0 ? ["MODEL_FACE_TEXTURE_OWNERSHIP_UNRESOLVED"] : []),
      ...(skippedSamples > 0 ? ["MODEL_FACE_EDGE_SAMPLING_PARTIAL"] : []),
      ...(!outlinerKnown ? ["OUTLINER_SCENE_SCOPE_UNKNOWN"] : []),
      ...(input.outliner_non_cube_count !== null &&
        input.outliner_non_cube_count > 0 ?
        ["NON_CUBE_ELEMENT_COVERAGE_UNEVALUATED"] : []),
      ...(input.duplicate_cube_uuid_count > 0 ||
        (input.outliner_missing_cube_count !== null &&
          input.outliner_missing_cube_count > 0) ||
        (input.outliner_duplicate_entry_count !== null &&
          input.outliner_duplicate_entry_count > 0) ?
        ["MODEL_ELEMENT_IDENTITY_INCONSISTENT"] : []),
      ...(input.texture_inventory_state !== "verified" ?
        ["TEXTURE_INVENTORY_NOT_FULLY_ATTESTED"] : []),
    ],
  };
}

/** Alpha may represent opacity/cutout or a non-opacity color/emissive mask. */
export type TextureSeamAlphaSemantics = "OPACITY" | "NON_OPACITY";

function requireAlphaSemantics(value: TextureSeamAlphaSemantics): void {
  if (value !== "OPACITY" && value !== "NON_OPACITY") {
    throw new Error("Texture seam alpha semantics must be OPACITY or NON_OPACITY.");
  }
}
function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function requireEdge(edge: TextureSeamEdgeInput): void {
  if (edge.continuity_intent !== undefined &&
      edge.continuity_intent !== "REQUIRED" &&
      edge.continuity_intent !== "INTENTIONAL_BOUNDARY" &&
      edge.continuity_intent !== "UNSPECIFIED") {
    throw new Error("Texture seam continuity intent is invalid.");
  }
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
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 30) {
    throw new Error("Intra-Cube seam example limit must be 1..30.");
  }
  for (const edge of edges) requireEdge(edge);

  // Rounding can merge physically separated edges or miss coincident edges
  // across a quantization boundary. Reuse the epsilon-based world matcher,
  // scoped to the same Cube for intra-Cube seam diagnostics.
  const grouped = groupWorldEdges(edges, true);
  // A pair from the same face is duplicate/conflicting evidence, not a
  // meaningful face-to-face seam. Never let such a group disappear from counts.
  const ambiguous = grouped.filter((group) =>
    group.length > 2 ||
    (group.length === 2 && group[0].face === group[1].face)
  );
  const validPairs = grouped.filter((group) =>
    group.length === 2 && group[0].face !== group[1].face
  );
  // Deliberate face/material transitions are not continuous surfaces.
  // Never infer this from color contrast: only caller-declared design intent
  // can exclude a pair. Retain ambiguous groups for separate diagnosis.
  const intentionalBoundaries = validPairs.filter((group) =>
    group.some((edge) => edge.continuity_intent === "INTENTIONAL_BOUNDARY")
  );
  const candidatePairs = validPairs.filter((group) =>
    group.every((edge) => edge.continuity_intent !== "INTENTIONAL_BOUNDARY")
  );
  // Comparing different sample counts used to silently downsample to the
  // minimum length, losing endpoint detail and potentially hiding a seam.
  // Require comparable sampled evidence instead of producing a false clean.
  const sampleAlignmentUnverified = candidatePairs.filter((group) =>
    group[0].samples.length !== group[1].samples.length
  );
  const paired = candidatePairs
    .filter((group) => group[0].samples.length === group[1].samples.length)
    .map((group) => seamSummary(group[0], group[1], alphaSemantics))
    .sort(
      (a, b) =>
        (b.mean_rgb_difference ?? -1) - (a.mean_rgb_difference ?? -1) ||
        b.mean_alpha_difference - a.mean_alpha_difference
    );
  const unpaired = grouped.filter((group) => group.length === 1);
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
    excluded_intentional_boundary_pair_count: intentionalBoundaries.length,
    sample_alignment_unverified_pair_count: sampleAlignmentUnverified.length,
    unpaired_edge_count: unpaired.length,
    ambiguous_edge_count: ambiguous.length,
    evidence_gaps: {
      sample_alignment_examples: sampleAlignmentUnverified.slice(0, exampleLimit).map(
        ([left, right]) => ({
          cube_uuid: left.cube_uuid,
          faces: [left.face, right.face],
          sample_counts: [left.samples.length, right.samples.length],
        })
      ),
      sample_alignment_examples_truncated: sampleAlignmentUnverified.length > exampleLimit,
      ambiguous_examples: ambiguous.slice(0, exampleLimit).map((group) => ({
        cube_uuid: group[0].cube_uuid,
        faces: group.map((edge) => edge.face),
        edge_count: group.length,
      })),
      ambiguous_examples_truncated: ambiguous.length > exampleLimit,
    },
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
      reasons: [
        ...(review.length > 0 ? ["SEAM_CONTINUITY_REVIEW"] : []),
        ...(sampleAlignmentUnverified.length > 0 ? ["SEAM_SAMPLE_ALIGNMENT_UNVERIFIED"] : []),
        ...(ambiguous.length > 0 ? ["SEAM_EVIDENCE_AMBIGUOUS"] : []),
      ],
    },
    note:
      "Only distinct face edges within the same Cube with comparable sample counts are evaluated; cross-Cube continuity is not evaluated. Duplicate/same-face groups and unequal sample evidence are reported as unresolved, never silently considered clean. Explicit INTENTIONAL_BOUNDARY pairs are excluded, never auto-inferred from contrast. OPACITY mode excludes RGB whenever either alpha is zero; NON_OPACITY mode retains RGB for color/emissive masks. Confirm render-profile alpha meaning. All seam results remain advisory and never establish visual PASS.",
  };
}


/**
 * Cross-Cube evidence requires explicit semantic continuity intent.
 * Coincident endpoints alone do not prove a shared surface, material,
 * texture revision, or a visual defect. Native sampling is a later owner.
 */
export type CrossCubeSeamEdgeInput = TextureSeamEdgeInput & {
  continuity_intent: TextureSeamContinuityIntent;
  surface_id: string | null;
  material_id: string | null;
  /** Caller-supplied world-facing normal; not native-attested by this pure helper. */
  world_normal: readonly [number, number, number];
};

export type NativeCubeSeamFace =
  | "north" | "south" | "east" | "west" | "up" | "down";

const NATIVE_CUBE_NORMALS: Record<NativeCubeSeamFace, readonly [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1],
  east: [1, 0, 0], west: [-1, 0, 0],
  up: [0, 1, 0], down: [0, -1, 0],
};

/**
 * THREE.Matrix4.elements uses column-major 4x4 storage. CubeFace.UVToLocal
 * produces mesh-local positions, not world points. Only an affine,
 * orthogonal, non-reflected world transform can be safely used to derive
 * comparable face normals from native cardinal directions.
 *
 * Shear, reflection, missing/unsettled matrix and degenerate edges are
 * unresolved evidence, never "continuous" by default.
 */
export function projectNativeCubeSeamEdgeToWorld(input: {
  face: NativeCubeSeamFace;
  local_start: readonly [number, number, number];
  local_end: readonly [number, number, number];
  matrix_world: ArrayLike<number>;
}): {
  start: [number, number, number];
  end: [number, number, number];
  world_normal: [number, number, number];
} {
  // THREE.Matrix4.elements may be Float32Array/Float64Array, not Array.
  // Normalize exactly 16 entries so all numeric checks share one path.
  const matrix = input.matrix_world;
  const m = matrix && typeof matrix.length === "number" && matrix.length === 16
    ? Array.from(matrix)
    : [];
  if (!(input.face in NATIVE_CUBE_NORMALS) ||
      m.length !== 16 || m.some(value => !Number.isFinite(value)) ||
      Math.abs(m[3]) > 1e-9 || Math.abs(m[7]) > 1e-9 ||
      Math.abs(m[11]) > 1e-9 || Math.abs(m[15] - 1) > 1e-9) {
    throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: require a valid affine Cube world matrix.");
  }
  const axes = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [m[8], m[9], m[10]],
  ];
  const dot = (a: readonly number[], b: readonly number[]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const lengths = axes.map(axis => Math.hypot(...axis));
  if (lengths.some(length => !Number.isFinite(length) || length < 1e-9) ||
      Math.abs(dot(axes[0], axes[1]) / (lengths[0] * lengths[1])) > 1e-6 ||
      Math.abs(dot(axes[0], axes[2]) / (lengths[0] * lengths[2])) > 1e-6 ||
      Math.abs(dot(axes[1], axes[2]) / (lengths[1] * lengths[2])) > 1e-6) {
    throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: shear or degenerate Cube axes cannot attest a physical seam.");
  }
  const cross01 = [
    axes[0][1] * axes[1][2] - axes[0][2] * axes[1][1],
    axes[0][2] * axes[1][0] - axes[0][0] * axes[1][2],
    axes[0][0] * axes[1][1] - axes[0][1] * axes[1][0],
  ];
  if (dot(cross01, axes[2]) <= 1e-12) {
    throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: reflected or inverted Cube matrices require separate normal validation.");
  }
  const point = (p: readonly number[]): [number, number, number] => {
    if (p.length !== 3 || p.some(value => !Number.isFinite(value))) {
      throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: local Cube edge must contain finite XYZ coordinates.");
    }
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ];
  };
  const start = point(input.local_start), end = point(input.local_end);
  if ([...start, ...end].some(value => !Number.isFinite(value) || Math.abs(value) > 30_000_000) ||
      Math.hypot(start[0] - end[0], start[1] - end[1], start[2] - end[2]) <= 1e-6) {
    throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: world edge is degenerate or outside supported coordinates.");
  }
  const normal = NATIVE_CUBE_NORMALS[input.face];
  // Orthogonal affine axes preserve the normal direction of cardinal
  // Cube faces; a shear/reflection was rejected before this projection.
  const projected = [
    axes[0][0] * normal[0] + axes[1][0] * normal[1] + axes[2][0] * normal[2],
    axes[0][1] * normal[0] + axes[1][1] * normal[1] + axes[2][1] * normal[2],
    axes[0][2] * normal[0] + axes[1][2] * normal[1] + axes[2][2] * normal[2],
  ];
  const magnitude = Math.hypot(...projected);
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) {
    throw new Error("CROSS_CUBE_WORLD_TRANSFORM_UNVERIFIED: world face normal is undefined.");
  }
  return {
    start,
    end,
    world_normal: [
      projected[0] / magnitude,
      projected[1] / magnitude,
      projected[2] / magnitude,
    ],
  };
}

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
 * both complete segments before merging any connected matches. An intra-Cube
 * caller can require equal Cube identity without a second matching algorithm.
 * A nontransitive chain remains an ambiguous group (>2), never a clean pair.
 */
function groupWorldEdges<T extends TextureSeamEdgeInput>(
  edges: readonly T[],
  sameCubeOnly = false
): T[][] {
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
  const sameEdge = (a: TextureSeamEdgeInput, b: TextureSeamEdgeInput): boolean =>
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
      if ((!sameCubeOnly || edge.cube_uuid === edges[candidate].cube_uuid) &&
          sameEdge(edge, edges[candidate])) {
        unite(edgeIndex, candidate);
      }
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

  const groups = new Map<number, T[]>();
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
  const groups = groupWorldEdges(edges);

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
