const CUBE_AXIS_NAMES = ["x", "y", "z"] as const;

/** A positive fractional span cannot preserve native Bedrock Box UV texel scale.
 * A true zero span is an intentional plane-like carrier, not sub-unit detail.
 */
export function boxUvSubunitAxes(
  from: readonly number[],
  to: readonly number[]
): Array<(typeof CUBE_AXIS_NAMES)[number]> {
  requireFiniteCubeSpan(from, to, "Box UV");
  return CUBE_AXIS_NAMES.filter((_, axis) => {
    const span = to[axis] - from[axis];
    return span > 0 && span < 1;
  });
}

/** Guard new/reshaped inherited Box UV, without rewriting existing native assets. */
export function requireBoxUvRepresentableSpan(
  from: readonly number[],
  to: readonly number[],
  context: string,
  previous?: { from: readonly number[]; to: readonly number[] }
): void {
  // Legacy thin axes can be moved or enlarged; only newly introduced or
  // worsened under-one-unit dimensions are blocked for Box UV.
  const oldRisk = previous
    ? new Set(boxUvSubunitAxes(previous.from, previous.to))
    : new Set<string>();
  const axes = boxUvSubunitAxes(from, to).filter((axis) => {
    if (!previous || !oldRisk.has(axis)) return true;
    const index = CUBE_AXIS_NAMES.indexOf(axis);
    return to[index] - from[index] < previous.to[index] - previous.from[index];
  });
  if (axes.length > 0) {
    throw new Error(
      `${context} has sub-unit Box UV size on ${axes.join(", ")}. ` +
      "Native Bedrock Box UV rounds fractional-size detail to a logical unit. " +
      "Prefer Texture for surface-only detail, make meaningful 3D geometry at " +
      "least one model unit wide on positive axes, or explicitly author per-face " +
      "UV when small 3D geometry is truly required."
    );
  }
}

/**
 * Blockbench 5.2.x checks (0.001, 0.999) Cube sizes AFTER generating its
 * Box UV template. Positive axes below one model unit are the broader
 * logical-UV floor-to-zero risk, including sizes the popup fails to flag.
 * Share this check with direct create/reshape before native template Undo.
 */
export const BOX_UV_TEMPLATE_EXAMPLE_LIMIT = 8;

export type BoxUvTemplateCube = {
  uuid: string;
  name: string;
  from: readonly number[];
  to: readonly number[];
  box_uv: boolean;
  visible?: boolean;
};

export function analyzeBoxUvTemplateReadiness(
  cubes: readonly BoxUvTemplateCube[]
) {
  const candidates = cubes
    .filter((cube) => cube.box_uv === true && cube.visible !== false)
    .slice()
    .sort((a, b) => a.uuid.localeCompare(b.uuid));
  const examples: Array<{
    cube_uuid: string;
    cube_name: string;
    size: number[] | null;
    axes: Array<(typeof CUBE_AXIS_NAMES)[number]>;
    reason: "BOX_UV_SUBUNIT" | "INVALID_CUBE_SPAN";
    native_warning_trigger: boolean;
  }> = [];
  let subunitCount = 0;
  let invalidCount = 0;
  let nativeWarningCount = 0;
  for (const cube of candidates) {
    const finite = hasFiniteCubeSpan(cube.from, cube.to);
    const size = finite ? cube.from.map((value, axis) => cube.to[axis] - value) : null;
    const invalid = !size || size.some((span) => span < 0);
    const axes = invalid ? [] : boxUvSubunitAxes(cube.from, cube.to);
    if (!invalid && axes.length === 0) continue;
    if (invalid) invalidCount++;
    else subunitCount++;
    const nativeWarning = !invalid && axes.some((axis) => {
      const span = size![CUBE_AXIS_NAMES.indexOf(axis)];
      return span > 0.001 && span < 0.999;
    });
    if (nativeWarning) nativeWarningCount++;
    if (examples.length < BOX_UV_TEMPLATE_EXAMPLE_LIMIT) {
      examples.push({
        cube_uuid: cube.uuid,
        cube_name: cube.name,
        size, axes,
        reason: invalid ? "INVALID_CUBE_SPAN" : "BOX_UV_SUBUNIT",
        native_warning_trigger: nativeWarning,
      });
    }
  }
  const affected = subunitCount + invalidCount;
  return {
    state: affected ? ("blocked" as const) : ("ready" as const),
    checked_box_uv_cube_count: candidates.length,
    subunit_cube_count: subunitCount,
    invalid_span_cube_count: invalidCount,
    native_warning_cube_count: nativeWarningCount,
    examples,
    examples_truncated: affected > examples.length,
    note: "Positive sub-unit Cube spans cannot preserve Bedrock Box UV face width. True zero-axis planes and explicit per-face UV are distinct; size does not prove Geometry redundancy. No Cube is changed.",
  };
}

/** Refuse the actual native generator before its Undo/post-template warning. */
export function requireBoxUvTemplateReadiness(
  cubes: readonly BoxUvTemplateCube[]
): ReturnType<typeof analyzeBoxUvTemplateReadiness> {
  const review = analyzeBoxUvTemplateReadiness(cubes);
  if (review.state !== "ready") {
    const examples = review.examples.map((entry) =>
      entry.cube_uuid + " (" + entry.cube_name.slice(0, 80) + ")" +
      (entry.axes.length ? " axes=" + entry.axes.join(",") : "") +
      " size=" + JSON.stringify(entry.size)
    ).join("; ");
    throw new Error(
      "BOX_UV_TEMPLATE_PREFLIGHT_BLOCKED: " +
      review.subunit_cube_count + " visible Box UV Cube(s) with positive span under 1 model unit; " +
      review.invalid_span_cube_count + " invalid span(s). " +
      (examples ? "Affected: " + examples +
        (review.examples_truncated ? "; additional Cubes omitted" : "") + ". " : "") +
      "Native texture-template generation and Undo did not start. " +
      "Use Texture for surface-only detailing. For required thin 3D features, explicitly author valid Per-face UV; adjust geometry only when the reference requires it. " +
      "Raising pixel_density cannot repair a Box UV face already quantized to zero logical width."
    );
  }
  return review;
}

/**
 * A second identical untextured Cube in the same authoring batch cannot
 * contribute new form or transform ownership. Scope this to exact geometry
 * and the same resolved parent; don't guess at near-overlaps, separate
 * articulation or custom per-face material/UV layering.
 */
export type CubeBatchPlacement = {
  name: string;
  parent_id: string;
  from: readonly number[];
  to: readonly number[];
  origin?: readonly number[];
  rotation?: readonly number[];
  inflate?: number;
};
export function requireDistinctCubeBatchPlacements(
  placements: readonly CubeBatchPlacement[]
): void {
  const byShape = new Map<string, string>();
  for (const placement of placements) {
    requireFiniteCubeSpan(placement.from, placement.to, placement.name);
    const fingerprint = JSON.stringify([
      placement.parent_id, placement.from, placement.to,
      placement.origin ?? [0, 0, 0],
      placement.rotation ?? [0, 0, 0],
      placement.inflate ?? 0,
    ]);
    const previous = byShape.get(fingerprint);
    if (previous !== undefined) {
      throw new Error(
        `DUPLICATE_CUBE_PLACEMENT: ${placement.name} duplicates ${previous} ` +
        "in the same Group with exactly coincident geometry/pivot/inflate. " +
        "Reuse one Cube for this visible mass or author an explicit per-face " +
        "UV/material layer when a true separate layer is intentional."
      );
    }
    byShape.set(fingerprint, placement.name);
  }
}

export function hasFiniteCubeSpan(
  from: readonly number[],
  to: readonly number[]
): boolean {
  return (
    from.length === 3 &&
    to.length === 3 &&
    from.every(Number.isFinite) &&
    to.every(Number.isFinite) &&
    to.every((entry, axis) => Number.isFinite(entry - from[axis]))
  );
}

export function requireFiniteCubeSpan(
  from: readonly number[],
  to: readonly number[],
  context: string
): void {
  if (!hasFiniteCubeSpan(from, to)) {
    throw new Error(
      `${context} would produce a non-finite Cube size. Use finite from/to coordinates whose per-axis difference is also finite.`
    );
  }
}

export function validateCubeGeometrySpan(
  from: readonly number[],
  to: readonly number[],
  inflate = 0,
  context = "Cube"
) {
  requireFiniteCubeSpan(from, to, context);
  if (!Number.isFinite(inflate)) {
    throw new Error(`${context} inflate must be finite.`);
  }

  const authoredSize = to.map(
    (value, axis) => value - from[axis]
  ) as [number, number, number];
  const reversedAxes = CUBE_AXIS_NAMES.filter(
    (_, axis) => authoredSize[axis] < 0
  );
  if (reversedAxes.length > 0) {
    throw new Error(
      `${context} reverses authored Cube bounds on ${reversedAxes.join(", ")}. Keep to >= from on every axis.`
    );
  }

  const authoredCollapsedAxes = CUBE_AXIS_NAMES.filter(
    (_, axis) => authoredSize[axis] === 0
  );
  if (authoredCollapsedAxes.length >= 2) {
    throw new Error(
      `${context} collapses ${authoredCollapsedAxes.length} authored axes (${authoredCollapsedAxes.join(", ")}). A visible Cube needs positive 3D span or exactly one zero-span plane-like axis.`
    );
  }

  const renderedSize = authoredSize.map(
    (size) => size + inflate * 2
  ) as [number, number, number];
  if (renderedSize.some((size) => !Number.isFinite(size))) {
    throw new Error(
      `${context} inflate would produce a non-finite rendered span.`
    );
  }

  const negativeRenderedAxes = CUBE_AXIS_NAMES.filter(
    (_, axis) => renderedSize[axis] < 0
  );
  if (negativeRenderedAxes.length > 0) {
    throw new Error(
      `${context} inflate/deflate would produce a negative rendered span on ${negativeRenderedAxes.join(", ")}. Reduce deflate or increase the authored span.`
    );
  }

  const renderedCollapsedAxes = CUBE_AXIS_NAMES.filter(
    (_, axis) => renderedSize[axis] === 0
  );
  if (renderedCollapsedAxes.length >= 2) {
    throw new Error(
      `${context} inflate/deflate collapses ${renderedCollapsedAxes.length} rendered axes (${renderedCollapsedAxes.join(", ")}). Keep a solid volume or exactly one plane-like axis.`
    );
  }

  return {
    authored_size: authoredSize,
    rendered_size: renderedSize,
    representation:
      renderedCollapsedAxes.length === 1
        ? ("plane_like" as const)
        : ("solid" as const),
  };
}
