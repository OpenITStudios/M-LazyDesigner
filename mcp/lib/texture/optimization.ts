export type TextureFacePatchInput = {
  cube_uuid: string;
  cube_name: string;
  face: string;
  texture_uuid: string;
  texture_name: string;
  uv: readonly number[];
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

export type TextureScanOmission = {
  kind: "blank" | "unresolved_texture" | "invalid_uv" | "fractional_uv" | "non_integral_pixel_mapping" | "degenerate_uv" | "budget";
  cube_uuid: string;
  cube_name: string;
  face: string;
};

export const TEXTURE_OPTIMIZATION_EXAMPLE_LIMIT = 6;

function requirePatch(input: TextureFacePatchInput): void {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0) {
    throw new Error("Texture face patch dimensions must be positive integers.");
  }
  if (input.pixels.length !== input.width * input.height * 4) {
    throw new Error("Texture face patch RGBA length does not match width × height × 4.");
  }
}

function transformDimensions(width: number, height: number, transform: number): [number, number] {
  return transform >= 4 ? [height, width] : [width, height];
}

function sourceCoordinate(
  x: number,
  y: number,
  width: number,
  height: number,
  transform: number
): [number, number] {
  switch (transform) {
    case 0: return [x, y];
    case 1: return [width - 1 - x, y];
    case 2: return [x, height - 1 - y];
    case 3: return [width - 1 - x, height - 1 - y];
    case 4: return [y, height - 1 - x];
    case 5: return [y, x];
    case 6: return [width - 1 - y, height - 1 - x];
    default: return [width - 1 - y, x];
  }
}

function hashTransformed(input: TextureFacePatchInput, transform: number): string {
  const [outWidth, outHeight] = transformDimensions(input.width, input.height, transform);
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const [sx, sy] = sourceCoordinate(x, y, input.width, input.height, transform);
      const offset = (sy * input.width + sx) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const byte = input.pixels[offset + channel];
        hashA ^= byte;
        hashA = Math.imul(hashA, 0x01000193) >>> 0;
        hashB = (Math.imul(hashB ^ byte, 0x85ebca6b) + 0xc2b2ae35) >>> 0;
      }
    }
  }
  return `${outWidth}x${outHeight}:${hashA.toString(16).padStart(8, "0")}:${hashB.toString(16).padStart(8, "0")}`;
}

function canonicalSignature(input: TextureFacePatchInput): string {
  let best: string | null = null;
  for (let transform = 0; transform < 8; transform += 1) {
    const signature = hashTransformed(input, transform);
    if (best === null || signature < best) best = signature;
  }
  return best!;
}

function normalizedUvKey(uv: readonly number[]): string | null {
  if (uv.length !== 4 || uv.some((value) => !Number.isFinite(value))) return null;
  return [
    Math.min(uv[0], uv[2]),
    Math.min(uv[1], uv[3]),
    Math.max(uv[0], uv[2]),
    Math.max(uv[1], uv[3]),
  ].join(",");
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function rgbaKey(r: number, g: number, b: number, a: number): string {
  return `${r},${g},${b},${a}`;
}

type TextureFacePixelAnalysis = {
  fully_transparent: boolean;
  solid_rgba: [number, number, number, number] | null;
  state: "transparent" | "solid_color" | "low_variation" | "varied";
  detail_capacity: "micro" | "limited" | "detail_capable";
  visible_ratio: number;
  translucent_ratio: number;
  distinct_visible_rgba: number;
  dominant_visible_ratio: number;
  luma_span: number;
  border_only_variation: boolean;
};

function analyzeFacePixels(input: TextureFacePatchInput): TextureFacePixelAnalysis {
  const totalPixels = input.width * input.height;
  let translucentPixels = 0;
  let visiblePixels = 0;
  let sameColor = true;
  let lumaMin = Number.POSITIVE_INFINITY;
  let lumaMax = Number.NEGATIVE_INFINITY;
  const visibleColors = new Map<string, number>();
  const first = [
    input.pixels[0],
    input.pixels[1],
    input.pixels[2],
    input.pixels[3],
  ] as [number, number, number, number];

  for (let offset = 0; offset < input.pixels.length; offset += 4) {
    const r = input.pixels[offset];
    const g = input.pixels[offset + 1];
    const b = input.pixels[offset + 2];
    const a = input.pixels[offset + 3];
    if (r !== first[0] || g !== first[1] || b !== first[2] || a !== first[3]) {
      sameColor = false;
    }
    if (a === 0) continue;
    visiblePixels += 1;
    if (a < 255) translucentPixels += 1;
    const key = rgbaKey(r, g, b, a);
    visibleColors.set(key, (visibleColors.get(key) ?? 0) + 1);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lumaMin = Math.min(lumaMin, luma);
    lumaMax = Math.max(lumaMax, luma);
  }

  let dominantKey = "";
  let dominantCount = 0;
  for (const [key, count] of visibleColors) {
    if (count > dominantCount) {
      dominantKey = key;
      dominantCount = count;
    }
  }

  let borderOnlyVariation = visibleColors.size > 1;
  if (borderOnlyVariation) {
    for (let y = 0; y < input.height && borderOnlyVariation; y += 1) {
      for (let x = 0; x < input.width; x += 1) {
        const offset = (y * input.width + x) * 4;
        const a = input.pixels[offset + 3];
        if (a === 0) continue;
        const key = rgbaKey(
          input.pixels[offset],
          input.pixels[offset + 1],
          input.pixels[offset + 2],
          a
        );
        if (key === dominantKey) continue;
        if (x !== 0 && y !== 0 && x !== input.width - 1 && y !== input.height - 1) {
          borderOnlyVariation = false;
          break;
        }
      }
    }
  }

  const pixelArea = totalPixels;
  const detailCapacity =
    pixelArea <= 4 || input.width === 1 || input.height === 1
      ? ("micro" as const)
      : pixelArea < 16
        ? ("limited" as const)
        : ("detail_capable" as const);
  const fullyTransparent = visiblePixels === 0;
  const lumaSpan = visiblePixels === 0 ? 0 : Number((lumaMax - lumaMin).toFixed(4));
  const dominantVisibleRatio = ratio(dominantCount, visiblePixels);
  const lowVariation =
    detailCapacity === "detail_capable" &&
    visiblePixels > 0 &&
    !sameColor &&
    (
      (visibleColors.size <= 2 && borderOnlyVariation) ||
      (visibleColors.size <= 3 && dominantVisibleRatio >= 0.985 && lumaSpan <= 0.08)
    );

  return {
    fully_transparent: fullyTransparent,
    solid_rgba: sameColor ? first : null,
    state: fullyTransparent
      ? "transparent"
      : sameColor
        ? "solid_color"
        : lowVariation
          ? "low_variation"
          : "varied",
    detail_capacity: detailCapacity,
    visible_ratio: ratio(visiblePixels, totalPixels),
    translucent_ratio: ratio(translucentPixels, totalPixels),
    distinct_visible_rgba: visibleColors.size,
    dominant_visible_ratio: dominantVisibleRatio,
    luma_span: lumaSpan,
    border_only_variation: lowVariation && borderOnlyVariation,
  };
}

function faceSummary(input: TextureFacePatchInput) {
  return {
    cube_uuid: input.cube_uuid,
    cube_name: input.cube_name,
    face: input.face,
    texture_uuid: input.texture_uuid,
    texture_name: input.texture_name,
    uv: [...input.uv],
    pixel_size: [input.width, input.height],
  };
}

function faceCoverageSummary(
  patch: TextureFacePatchInput,
  analysis: TextureFacePixelAnalysis
) {
  return {
    ...faceSummary(patch),
    state: analysis.state,
    detail_capacity: analysis.detail_capacity,
    visible_ratio: analysis.visible_ratio,
    translucent_ratio: analysis.translucent_ratio,
    distinct_visible_rgba: analysis.distinct_visible_rgba,
    dominant_visible_ratio: analysis.dominant_visible_ratio,
    luma_span: analysis.luma_span,
    border_only_variation: analysis.border_only_variation,
  };
}

function omissionCounts(omissions: readonly TextureScanOmission[]) {
  const counts: Record<TextureScanOmission["kind"], number> = {
    blank: 0,
    unresolved_texture: 0,
    invalid_uv: 0,
    fractional_uv: 0,
    non_integral_pixel_mapping: 0,
    degenerate_uv: 0,
    budget: 0,
  };
  omissions.forEach((omission) => { counts[omission.kind] += 1; });
  return counts;
}

function buildTextureCoverage(
  analyzed: readonly { patch: TextureFacePatchInput; analysis: TextureFacePixelAnalysis }[],
  omissions: readonly TextureScanOmission[],
  exampleLimit: number
) {
  const transparent = analyzed.filter(({ analysis }) => analysis.state === "transparent");
  const solid = analyzed.filter(({ analysis }) => analysis.state === "solid_color");
  const lowVariation = analyzed.filter(({ analysis }) => analysis.state === "low_variation");
  const varied = analyzed.filter(({ analysis }) => analysis.state === "varied");
  const detailCapableFlat = [...solid, ...lowVariation].filter(
    ({ analysis }) => analysis.detail_capacity === "detail_capable"
  );
  const intermediateAlpha = analyzed.filter(
    ({ analysis }) => analysis.translucent_ratio > 0
  );
  const blockingOmissions = omissions.filter(({ kind }) => kind !== "budget");
  const budgetOmissions = omissions.filter(({ kind }) => kind === "budget");
  const counts = omissionCounts(omissions);

  // Cube-local face directions remain visible even if their smaller patches
  // lose the area-ranked example selection (e.g. an underside or sole).
  const directional = new Map<string, {
    local_face: string;
    scanned: number;
    omitted: number;
    detail_capable_flat: number;
    transparent: number;
    varied: number;
    review_example: { cube_uuid: string; cube_name: string; face: string; reason: string } | null;
  }>();
  const faceRow = (face: string) => {
    let row = directional.get(face);
    if (!row) {
      row = { local_face: face, scanned: 0, omitted: 0,
        detail_capable_flat: 0, transparent: 0, varied: 0, review_example: null };
      directional.set(face, row);
    }
    return row;
  };
  for (const { patch, analysis } of analyzed) {
    const row = faceRow(patch.face);
    row.scanned += 1;
    if (analysis.state === "varied") row.varied += 1;
    if (analysis.state === "transparent") row.transparent += 1;
    const flat = analysis.detail_capacity === "detail_capable" &&
      (analysis.state === "solid_color" || analysis.state === "low_variation");
    if (flat) row.detail_capable_flat += 1;
    if ((flat || analysis.state === "transparent") && !row.review_example) {
      row.review_example = { cube_uuid: patch.cube_uuid, cube_name: patch.cube_name,
        face: patch.face, reason: flat ? "FLAT_FACE_REVIEW" : "TRANSPARENT_FACE_REVIEW" };
    }
  }
  for (const omission of omissions) {
    const row = faceRow(omission.face);
    row.omitted += 1;
    row.review_example = { cube_uuid: omission.cube_uuid, cube_name: omission.cube_name,
      face: omission.face, reason: "SCAN_OMISSION:" + omission.kind };
  }
  const faceOrder = ["down", "up", "north", "south", "west", "east"];
  const directionalCoverage = [...directional.values()].sort((a, b) => {
    const ai = faceOrder.indexOf(a.local_face);
    const bi = faceOrder.indexOf(b.local_face);
    return (ai < 0 ? faceOrder.length : ai) - (bi < 0 ? faceOrder.length : bi) ||
      a.local_face.localeCompare(b.local_face);
  });

  const reviewKeys = new Set<string>();
  for (const { patch } of [...transparent, ...detailCapableFlat, ...intermediateAlpha]) {
    reviewKeys.add(`${patch.cube_uuid}:${patch.face}`);
  }

  const reasons: string[] = [];
  const empty = analyzed.length + omissions.length === 0;
  if (empty) reasons.push("NO_MAPPED_FACES");
  if (blockingOmissions.length > 0) reasons.push("FACE_ACCOUNTING_INCOMPLETE");
  if (budgetOmissions.length > 0) reasons.push("SCAN_BUDGET_EXHAUSTED");
  if (transparent.length > 0) reasons.push("TRANSPARENT_FACE_REVIEW");
  if (detailCapableFlat.length > 0) reasons.push("FLAT_FACE_REVIEW");
  if (intermediateAlpha.length > 0) reasons.push("INTERMEDIATE_ALPHA_REVIEW");

  const gateState =
    empty || blockingOmissions.length > 0
      ? ("incomplete" as const)
      : budgetOmissions.length > 0
        ? ("partial" as const)
        : reviewKeys.size > 0
          ? ("review_required" as const)
          : ("ready" as const);

  const byLargestPatch = (
    entries: readonly { patch: TextureFacePatchInput; analysis: TextureFacePixelAnalysis }[]
  ) => [...entries]
    .sort((a, b) => b.patch.width * b.patch.height - a.patch.width * a.patch.height)
    .slice(0, exampleLimit)
    .map(({ patch, analysis }) => faceCoverageSummary(patch, analysis));

  return {
    visual_verdict: "not_evaluated" as const,
    required_faces: analyzed.length + omissions.length,
    scanned_faces: analyzed.length,
    accounted_ratio: ratio(analyzed.length, analyzed.length + omissions.length),
    states: {
      varied: varied.length,
      transparent: transparent.length,
      solid_color: solid.length,
      low_variation: lowVariation.length,
    },
    review: {
      candidate_face_count: reviewKeys.size,
      transparent_face_count: transparent.length,
      detail_capable_solid_face_count: solid.filter(
        ({ analysis }) => analysis.detail_capacity === "detail_capable"
      ).length,
      solid_color_faces: {
        count: solid.length,
        examples: byLargestPatch(solid),
        examples_truncated: solid.length > exampleLimit,
      },
      low_variation_faces: {
        count: lowVariation.length,
        examples: byLargestPatch(lowVariation),
        examples_truncated: lowVariation.length > exampleLimit,
      },
      intermediate_alpha_faces: {
        count: intermediateAlpha.length,
        examples: byLargestPatch(intermediateAlpha),
        examples_truncated: intermediateAlpha.length > exampleLimit,
      },
    },
    cube_local_face_coverage: {
      directions: directionalCoverage,
      note: "Counts are per Cube-local face orientation, not world-space visibility. Small underside patches are retained even when omitted from area-ranked examples. Varied pixels do not prove styling, and omitted faces do not prove completion.",
    },
    omissions: {
      count: omissions.length,
      blocking_count: blockingOmissions.length,
      budget_count: budgetOmissions.length,
      counts,
      examples: omissions.slice(0, exampleLimit),
      examples_truncated: omissions.length > exampleLimit,
    },
    gate: {
      state: gateState,
      reasons,
    },
    note: "Coverage measures pixels only: varied means non-flat pixels, not authored styling, shading or reference fidelity. Ready is scan readiness, never visual acceptance. Transparent/flat/alpha candidates may be intentional; incomplete/partial scans cannot prove completion.",
  };
}

export function analyzeTextureCoverage(
  patches: readonly TextureFacePatchInput[],
  omissions: readonly TextureScanOmission[] = [],
  exampleLimit = TEXTURE_OPTIMIZATION_EXAMPLE_LIMIT
) {
  for (const patch of patches) requirePatch(patch);
  const analyzed = patches.map((patch) => ({
    patch,
    analysis: analyzeFacePixels(patch),
  }));
  return buildTextureCoverage(analyzed, omissions, exampleLimit);
}

export function analyzeTextureOptimizationOpportunities(
  patches: readonly TextureFacePatchInput[],
  omissions: readonly TextureScanOmission[] = [],
  exampleLimit = TEXTURE_OPTIMIZATION_EXAMPLE_LIMIT
) {
  for (const patch of patches) requirePatch(patch);
  const analyzed = patches.map((patch) => ({
    patch,
    analysis: analyzeFacePixels(patch),
  }));
  const transparent = analyzed.filter(({ analysis }) => analysis.fully_transparent);
  const solid = analyzed.filter(
    ({ analysis }) => analysis.solid_rgba !== null && !analysis.fully_transparent
  );

  const signatureGroups = new Map<string, TextureFacePatchInput[]>();
  for (const patch of patches) {
    const key = `${patch.texture_uuid}|${canonicalSignature(patch)}`;
    const group = signatureGroups.get(key) ?? [];
    group.push(patch);
    signatureGroups.set(key, group);
  }

  const stackGroups = [...signatureGroups.values()]
    .map((group) => {
      const distinctUv = new Set(group.map((patch) => normalizedUvKey(patch.uv)).filter(Boolean));
      if (group.length < 2 || distinctUv.size < 2) return null;
      return {
        texture_uuid: group[0].texture_uuid,
        texture_name: group[0].texture_name,
        face_count: group.length,
        distinct_uv_region_count: distinctUv.size,
        duplicate_patch_area: group.slice(1).reduce((sum, patch) => sum + patch.width * patch.height, 0),
        faces: group.slice(0, exampleLimit).map(faceSummary),
        faces_truncated: group.length > exampleLimit,
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
    .sort((a, b) => b.duplicate_patch_area - a.duplicate_patch_area || b.face_count - a.face_count);

  const counts = omissionCounts(omissions);
  const scannedPixels = patches.reduce((sum, patch) => sum + patch.width * patch.height, 0);
  const stackFaceCount = new Set(stackGroups.flatMap((group) => group.faces.map((face) => `${face.cube_uuid}:${face.face}`))).size;

  return {
    state: omissions.some((omission) => omission.kind === "budget") ? ("partial" as const) : ("available" as const),
    scan: {
      complete_face_patches: patches.length,
      scanned_pixels: scannedPixels,
      omitted_faces: omissions.length,
      omission_counts: counts,
    },
    coverage: buildTextureCoverage(analyzed, omissions, exampleLimit),
    uv_stack_opportunities: {
      group_count: stackGroups.length,
      represented_face_count: stackFaceCount,
      duplicate_patch_area: stackGroups.reduce((sum, group) => sum + group.duplicate_patch_area, 0),
      examples: stackGroups.slice(0, exampleLimit),
      examples_truncated: stackGroups.length > exampleLimit,
      note: "Pixel-identical regions are review candidates only; stacking is not applied automatically because UV ownership and semantic reuse may be intentional.",
    },
    transparent_faces: {
      count: transparent.length,
      examples: transparent.slice(0, exampleLimit).map(({ patch }) => faceSummary(patch)),
      examples_truncated: transparent.length > exampleLimit,
    },
    solid_color_faces: {
      count: solid.length,
      examples: solid.slice(0, exampleLimit).map(({ patch, analysis }) => ({
        ...faceSummary(patch),
        rgba: analysis.solid_rgba,
      })),
      examples_truncated: solid.length > exampleLimit,
    },
    efficiency: {
      bounded: true,
      pixel_scan_reused_for_coverage: true,
    },
  };
}
