export type Vec3 = readonly [number, number, number];

export type ContactSample = {
  time: number;
  marker: Vec3;
  target: Vec3;
};

/** Expected native sample coverage; declaring it does not attest its origin. */
export type ContactSamplingWindow = {
  start: number;
  end: number;
  max_gap_seconds: number;
};

/** Marker is the physical contact point, not a bone origin. */
export type ContactSupportPlane = {
  axis: "X" | "Y" | "Z";
  coordinate: number;
  allowed_side: "POSITIVE" | "NEGATIVE";
  penetration_tolerance: number;
};

export type ContactConstraintInput = {
  id: string;
  mode: "pair" | "fixed" | "planted";
  tolerance: number;
  samples: readonly ContactSample[];
  sampling_window?: ContactSamplingWindow;
  support_plane?: ContactSupportPlane;
};

const TIME_EPSILON = 1e-6;
export const ANIMATION_CONTACT_CONSTRAINT_LIMIT = 64;
export const ANIMATION_CONTACT_SAMPLE_LIMIT = 2048;

function validVec3(value: Vec3): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function validWindow(window: ContactSamplingWindow | undefined): boolean {
  return !window || (
    Number.isFinite(window.start) && window.start >= 0 &&
    Number.isFinite(window.end) && window.end > window.start &&
    Number.isFinite(window.max_gap_seconds) && window.max_gap_seconds > 0
  );
}

function validPlane(plane: ContactSupportPlane | undefined): boolean {
  return !plane || (
    ["X", "Y", "Z"].includes(plane.axis) &&
    ["POSITIVE", "NEGATIVE"].includes(plane.allowed_side) &&
    Number.isFinite(plane.coordinate) &&
    Number.isFinite(plane.penetration_tolerance) &&
    plane.penetration_tolerance >= 0
  );
}

function planePenetration(marker: Vec3, plane: ContactSupportPlane): number {
  const axis = plane.axis === "X" ? 0 : plane.axis === "Y" ? 1 : 2;
  const sign = plane.allowed_side === "POSITIVE" ? 1 : -1;
  return Math.max(0, -sign * (marker[axis] - plane.coordinate));
}

/**
 * Read-only contact evidence for already sampled world-space markers.
 * Values are caller supplied; no sampled timing, native transform, IK,
 * floor contact, or human visual approval is attested here.
 */
export function analyzeAnimationContactEvidence(input: {
  constraints: readonly ContactConstraintInput[];
  exampleLimit?: number;
}) {
  const exampleLimit = input.exampleLimit ?? 8;
  if (!Number.isInteger(exampleLimit) || exampleLimit < 1 || exampleLimit > 100) {
    return { state: "unavailable" as const, reason: "example_limit_invalid" as const };
  }
  if (!Array.isArray(input.constraints) ||
      input.constraints.length > ANIMATION_CONTACT_CONSTRAINT_LIMIT) {
    return { state: "unavailable" as const, reason: "contact_constraint_budget_exceeded" as const };
  }

  const results: Array<{
    id: string;
    mode: ContactConstraintInput["mode"];
    tolerance: number;
    sample_count: number;
    violation_count: number;
    max_distance: number;
    mean_distance: number;
    max_marker_drift_from_first: number | null;
    max_support_tangential_drift: number | null;
    max_support_normal_displacement: number | null;
    max_support_plane_clearance: number | null;
    support_tangential_drift_violation: boolean | null;
    slip_correction_hypothesis: {
      state: "candidate" | "blocked" | "not_applicable";
      blocker: "SUPPORT_PLANE_REQUIRED" | "COMPLETE_SAMPLING_WINDOW_REQUIRED" |
        "CONTACT_PLANE_CLEARANCE_EXCEEDED" | null;
      space: "caller_declared_world_marker";
      samples: Array<{ time: number; tangential_drift: number; marker_translation_to_anchor: Vec3 }>;
      samples_truncated: boolean;
    };
    planted_drift_violation: boolean;
    max_marker_step_speed: number | null;
    sampling_coverage: "not_evaluated" | "complete" | "incomplete";
    max_sample_gap_seconds: number | null;
    support_plane_penetration_count: number;
    max_support_plane_penetration: number | null;
    status: "pass" | "review" | "unverified";
    review_reasons: Array<
      "CONTACT_DISTANCE_EXCEEDED" | "PLANTED_MARKER_DRIFT" | "SUPPORT_PLANE_PENETRATION"
    >;
    unverified_reasons: Array<
      "SAMPLING_WINDOW_INCOMPLETE" | "PLANTED_NEEDS_MULTIPLE_SAMPLES"
    >;
    violation_examples: Array<{ time: number; distance: number }>;
    violation_examples_truncated: boolean;
  }> = [];
  let invalidConstraintCount = 0;
  const invalidExamples: Array<{ id: string; reason: string }> = [];

  const constraints: readonly ContactConstraintInput[] = input.constraints;
  for (const constraint of constraints) {
    const invalid = (reason: string) => {
      invalidConstraintCount++;
      if (invalidExamples.length < exampleLimit) {
        invalidExamples.push({ id: constraint.id, reason });
      }
    };
    if (!constraint.id.trim() ||
        !Number.isFinite(constraint.tolerance) || constraint.tolerance < 0 ||
        !validWindow(constraint.sampling_window) || !validPlane(constraint.support_plane)) {
      invalid("INVALID_CONTACT_CONSTRAINT");
      continue;
    }
    // A support plane is meaningful only for an explicitly planted marker.
    if (constraint.support_plane && constraint.mode !== "planted") {
      invalid("SUPPORT_PLANE_REQUIRES_PLANTED");
      continue;
    }
    // Budget and validate the entire sequence: never silently accept a
    // truncated subset as a reliable contact or overload the evaluator.
    if (!Array.isArray(constraint.samples) ||
        constraint.samples.length > ANIMATION_CONTACT_SAMPLE_LIMIT) {
      invalid("CONTACT_SAMPLE_BUDGET_EXCEEDED");
      continue;
    }
    // Never filter malformed samples and then certify the remaining subset.
    const contactSamples: readonly ContactSample[] = constraint.samples;
    if (!contactSamples.length || contactSamples.some(
      (sample) => !Number.isFinite(sample.time) || sample.time < 0 ||
        !validVec3(sample.marker) || !validVec3(sample.target)
    )) {
      invalid("INVALID_CONTACT_SAMPLES");
      continue;
    }
    const samples = contactSamples.slice().sort((a, b) => a.time - b.time);
    if (samples.some((sample, index) => index > 0 && sample.time === samples[index - 1].time)) {
      invalid("DUPLICATE_SAMPLE_TIMESTAMPS");
      continue;
    }
    const distances = samples.map((sample) => ({
      time: sample.time,
      distance: distance(sample.marker, sample.target),
    }));
    const firstMarker = samples[0].marker;
    const rawDrift = constraint.mode === "planted"
      ? Math.max(...samples.map((sample) => distance(sample.marker, firstMarker)))
      : null;
    const supportAxis = constraint.support_plane
      ? constraint.support_plane.axis === "X"
        ? 0
        : constraint.support_plane.axis === "Y" ? 1 : 2
      : null;
    const tangentAxes = supportAxis === null
      ? null : [0, 1, 2].filter((axis) => axis !== supportAxis);
    // The declared support normal separates vertical lift from planar slip;
    // no axis is guessed for constraints without an explicit support plane.
    const supportTangentialDrift = tangentAxes
      ? Math.max(...samples.map((sample) => Math.hypot(
          sample.marker[tangentAxes[0]!] - firstMarker[tangentAxes[0]!],
          sample.marker[tangentAxes[1]!] - firstMarker[tangentAxes[1]!]
        )))
      : null;
    const supportNormalDisplacement = supportAxis === null
      ? null : Math.max(...samples.map((sample) =>
          Math.abs(sample.marker[supportAxis] - firstMarker[supportAxis])
        ));
    // An explicitly planted marker must remain near the declared contact
    // plane throughout the stance. Relative vertical drift is insufficient:
    // a marker that stays elevated would otherwise appear "stationary".
    const supportPlaneClearance = supportAxis === null || !constraint.support_plane
      ? null : Math.max(...samples.map((sample) =>
          Math.abs(sample.marker[supportAxis] - constraint.support_plane!.coordinate)
        ));
    let maxGap = 0, maxSpeed = 0;
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].time - samples[i - 1].time;
      maxGap = Math.max(maxGap, dt);
      if (constraint.mode === "planted") {
        maxSpeed = Math.max(maxSpeed, distance(samples[i].marker, samples[i - 1].marker) / dt);
      }
    }
    const penetrations = constraint.support_plane
      ? samples.map((sample) => planePenetration(sample.marker, constraint.support_plane!))
      : [];
    if (distances.some((item) => !Number.isFinite(item.distance)) ||
        !Number.isFinite(rawDrift ?? 0) ||
        !Number.isFinite(supportTangentialDrift ?? 0) ||
        !Number.isFinite(supportNormalDisplacement ?? 0) ||
        !Number.isFinite(supportPlaneClearance ?? 0) ||
        !Number.isFinite(maxGap) ||
        !Number.isFinite(maxSpeed) || penetrations.some((value) => !Number.isFinite(value))) {
      invalid("CONTACT_METRICS_NONFINITE");
      continue;
    }
    const distanceViolations = distances.filter((item) => item.distance > constraint.tolerance);
    const sliding = rawDrift !== null && rawDrift > constraint.tolerance;
    const planeViolations = penetrations.filter(
      (amount) => amount > (constraint.support_plane?.penetration_tolerance ?? Infinity)
    );
    const window = constraint.sampling_window;
    const coverage = !window ? "not_evaluated" as const :
      samples.length >= 2 &&
      Math.abs(samples[0].time - window.start) <= TIME_EPSILON &&
      Math.abs(samples[samples.length - 1].time - window.end) <= TIME_EPSILON &&
      maxGap <= window.max_gap_seconds + TIME_EPSILON
        ? "complete" as const : "incomplete" as const;
    const reviewReasons: Array<
      "CONTACT_DISTANCE_EXCEEDED" | "PLANTED_MARKER_DRIFT" | "SUPPORT_PLANE_PENETRATION"
    > = [];
    if (distanceViolations.length > 0) reviewReasons.push("CONTACT_DISTANCE_EXCEEDED");
    if (sliding) reviewReasons.push("PLANTED_MARKER_DRIFT");
    if (planeViolations.length > 0) reviewReasons.push("SUPPORT_PLANE_PENETRATION");

    const unverifiedReasons: Array<
      "SAMPLING_WINDOW_INCOMPLETE" | "PLANTED_NEEDS_MULTIPLE_SAMPLES"
    > = [];
    if (coverage === "incomplete") unverifiedReasons.push("SAMPLING_WINDOW_INCOMPLETE");
    // A single planted-frame position cannot establish that the marker was
    // stationary during a stance, even without an explicit sampling_window.
    if (constraint.mode === "planted" && samples.length < 2) {
      unverifiedReasons.push("PLANTED_NEEDS_MULTIPLE_SAMPLES");
    }
    const status = reviewReasons.length > 0 ? ("review" as const) :
      unverifiedReasons.length > 0 ? ("unverified" as const) : ("pass" as const);


    // Hypothetical correction is intentionally limited to caller-declared
    // planted-world contact with complete time coverage and an explicit plane.
    // This is NOT a bone-local keyframe update or verified native grounding.
    const tangentialSlip = supportTangentialDrift !== null &&
      supportTangentialDrift > constraint.tolerance;
    const canProposeSlip = sliding && tangentialSlip && tangentAxes !== null &&
      coverage === "complete" && supportPlaneClearance !== null &&
      supportPlaneClearance <= constraint.tolerance;
    const slipOffsets = canProposeSlip ? samples.flatMap((sample) => {
      const delta: [number, number, number] = [0, 0, 0];
      for (const axis of tangentAxes!) {
        delta[axis] = firstMarker[axis] - sample.marker[axis];
      }
      const slip = Math.hypot(...delta);
      return slip > constraint.tolerance
        ? [{
            time: round(sample.time),
            tangential_drift: round(slip),
            marker_translation_to_anchor: delta.map(round) as Vec3,
          }]
        : [];
    }) : [];
    const slipBlocker: "SUPPORT_PLANE_REQUIRED" | "COMPLETE_SAMPLING_WINDOW_REQUIRED" |
      "CONTACT_PLANE_CLEARANCE_EXCEEDED" | null =
      !sliding ? null : !tangentAxes ? "SUPPORT_PLANE_REQUIRED"
        : !tangentialSlip ? null
        : coverage !== "complete" ? "COMPLETE_SAMPLING_WINDOW_REQUIRED"
        : (supportPlaneClearance === null || supportPlaneClearance > constraint.tolerance)
          ? "CONTACT_PLANE_CLEARANCE_EXCEEDED" : null;
    const slipCorrectionState = canProposeSlip && slipOffsets.length > 0
      ? "candidate" as const
      : slipBlocker
        ? "blocked" as const : "not_applicable" as const;

    results.push({
      id: constraint.id,
      mode: constraint.mode,
      tolerance: constraint.tolerance,
      sample_count: samples.length,
      violation_count: distanceViolations.length,
      max_distance: round(Math.max(...distances.map((entry) => entry.distance))),
      mean_distance: round(distances.reduce((sum, entry) => sum + entry.distance, 0) / distances.length),
      max_marker_drift_from_first: rawDrift === null ? null : round(rawDrift),
      max_support_tangential_drift: supportTangentialDrift === null
        ? null : round(supportTangentialDrift),
      max_support_normal_displacement: supportNormalDisplacement === null
        ? null : round(supportNormalDisplacement),
      max_support_plane_clearance: supportPlaneClearance === null
        ? null : round(supportPlaneClearance),
      support_tangential_drift_violation: supportTangentialDrift === null
        ? null : supportTangentialDrift > constraint.tolerance,
      slip_correction_hypothesis: {
        state: slipCorrectionState,
        blocker: slipBlocker,
        space: "caller_declared_world_marker",
        samples: slipOffsets.slice(0, exampleLimit),
        samples_truncated: slipOffsets.length > exampleLimit,
      },
      planted_drift_violation: sliding,
      max_marker_step_speed: constraint.mode === "planted" && samples.length >= 2 ? round(maxSpeed) : null,
      sampling_coverage: coverage,
      max_sample_gap_seconds: samples.length >= 2 ? round(maxGap) : null,
      support_plane_penetration_count: planeViolations.length,
      max_support_plane_penetration: constraint.support_plane ? round(Math.max(...penetrations)) : null,
      status,
      review_reasons: reviewReasons,
      unverified_reasons: unverifiedReasons,
      violation_examples: distanceViolations.slice(0, exampleLimit).map((entry) => ({
        time: round(entry.time),
        distance: round(entry.distance),
      })),
      violation_examples_truncated: distanceViolations.length > exampleLimit,
    });
  }

  const reviewCount = results.filter((entry) => entry.status === "review").length;
  const unverifiedCount = results.filter((entry) => entry.status === "unverified").length;
  return {
    state: "available" as const,
    visual_verdict: "not_evaluated" as const,
    sample_provenance: "caller_supplied_not_native_attested" as const,
    coverage_scope: "supplied_constraints_only" as const,
    world_space_claim: "caller_declared" as const,
    constraint_count: results.length,
    invalid_constraint_count: invalidConstraintCount,
    invalid_examples: invalidExamples,
    invalid_examples_truncated: invalidConstraintCount > invalidExamples.length,
    review_constraint_count: reviewCount,
    unverified_constraint_count: unverifiedCount,
    pass_constraint_count: results.length - reviewCount - unverifiedCount,
    constraints: results,
    note: "Contact distances, planted foot drift (including support-plane sliding versus lift when declared), optional time-window coverage and support-plane penetration are numeric caller-supplied diagnostics only. Hypothetical stationary-anchor offsets require an explicit support plane, bounded marker clearance throughout stance and complete sampling coverage; they are caller-declared world-marker deltas, NOT native bone/local keyframes and must not be auto-applied. A passing distance tolerance does not prove believable weight, timing, deformation or visual quality; PASS never attests native sampling, IK or scene behavior, and reference-grounded native playback remains required.",
  };
}
