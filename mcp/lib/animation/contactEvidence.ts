import { solveFabrikChain, planTwoBonePoleSwing, planWorldSwingToParentLocal, type RigQuaternionXYZW } from "@/lib/rig/fabrik";
import type { ExplicitContactMarkerBinding } from "./contactMarkerBinding";

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


/** Explicit caller-supplied joint positions; does not attest native origins. */
export type DeclaredContactIkChain = {
  project_uuid: string;
  animation_uuid: string;
  locator_uuid: string;
  joint_group_uuids: readonly string[];
  frames: readonly { time: number; joint_world_positions: readonly Vec3[] }[];
  /** Optional declared world POINT selecting the knee bend direction. */
  bend_pole_world?: Vec3;
  /** Optional bound for source-only segment swings, default 120 degrees. */
  max_swing_degrees?: number;
};

export type ContactConstraintInput = {
  id: string;
  mode: "pair" | "fixed" | "planted";
  tolerance: number;
  samples: readonly ContactSample[];
  sampling_window?: ContactSamplingWindow;
  support_plane?: ContactSupportPlane;
  /** Optional source-only planted-contact IK feasibility. */
  ik_chain?: DeclaredContactIkChain;
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


export const CONTACT_IK_MAX_SAMPLES = 8;
export const CONTACT_IK_MAX_JOINTS = 8;

/** Read-only world-space kinematic proposal; never a native IK mutation. */
function planDeclaredContactIkReachability(
  constraint: ContactConstraintInput,
  samples: readonly ContactSample[],
  slipEligible: boolean
) {
  type Candidate = { time: number; target_world: Vec3; correction_world: Vec3;
    solved_chain_world: Vec3[]; residual_world: number;
    orientation_hint?: ReturnType<typeof planTwoBonePoleSwing>; };
  const unavailable = (reason: string) => ({
    state: "unavailable" as const, reason,
    frames: [] as Candidate[], frame_count: 0,
    native_sampling_attested: false as const,
    native_ik_bake_authorized: false as const,
    physical_contact_verified: false as const,
    visual_verdict: "not_evaluated" as const,
  });
  const chain = constraint.ik_chain;
  if (!chain) return unavailable("CONTACT_IK_CHAIN_UNAVAILABLE");
  if (!slipEligible || constraint.mode !== "planted" ||
      !constraint.sampling_window || !constraint.support_plane) {
    return unavailable("CONTACT_IK_NO_ELIGIBLE_PLANTED_SLIP");
  }
  const validId = (id: unknown) => typeof id === "string" &&
    id.trim() === id && id.length > 0 && id.length <= 160;
  const ids = chain.joint_group_uuids;
  if (!validId(chain.project_uuid) || !validId(chain.animation_uuid) ||
      !validId(chain.locator_uuid) || !Array.isArray(ids) ||
      ids.length < 2 || ids.length > CONTACT_IK_MAX_JOINTS ||
      ids.some((id) => !validId(id)) || new Set(ids).size !== ids.length) {
    return unavailable("CONTACT_IK_CHAIN_IDENTITY_INVALID");
  }
  // Angle bounds without an explicit pole cannot choose a bend plane.
  if (chain.max_swing_degrees !== undefined &&
      chain.bend_pole_world === undefined) {
    return unavailable("CONTACT_IK_BEND_POLE_REQUIRED");
  }
  const frames = chain.frames;
  if (!Array.isArray(frames) || frames.length !== samples.length ||
      frames.length < 2 || frames.length > CONTACT_IK_MAX_SAMPLES) {
    return unavailable("CONTACT_IK_SAMPLE_COVERAGE_INVALID");
  }
  if (frames.some((frame) => !frame || !Number.isFinite(frame.time) ||
      !Array.isArray(frame.joint_world_positions) ||
      frame.joint_world_positions.length !== ids.length ||
      frame.joint_world_positions.some((joint) => !validVec3(joint)))) {
    return unavailable("CONTACT_IK_JOINT_GEOMETRY_INVALID");
  }
  const ordered = [...frames].sort((a,b) => a.time - b.time);
  if (ordered.some((frame,i) => frame.time !== samples[i].time)) {
    return unavailable("CONTACT_IK_TIME_MISMATCH");
  }
  const dist = (a: Vec3,b: Vec3) =>
    Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  const lengths = ordered[0].joint_world_positions.slice(1).map(
    (joint,i) => dist(ordered[0].joint_world_positions[i],joint)
  );
  if (lengths.some((length) => !Number.isFinite(length) || length <= 1e-6)) {
    return unavailable("CONTACT_IK_CHAIN_SEGMENT_INVALID");
  }
  for (let i=0;i<ordered.length;i++) {
    const joints=ordered[i].joint_world_positions;
    if (dist(joints[joints.length-1],samples[i].marker)>1e-3) {
      return unavailable("CONTACT_IK_MARKER_JOINT_MISMATCH");
    }
    for (let j=1;j<joints.length;j++) {
      const current=dist(joints[j-1],joints[j]), baseline=lengths[j-1];
      if (!Number.isFinite(current) ||
          Math.abs(current-baseline)>Math.max(1e-4,baseline*1e-4)) {
        return unavailable("CONTACT_IK_BONE_LENGTH_CHANGED");
      }
    }
  }
  const plane=constraint.support_plane;
  const axis=plane.axis==="X"?0:plane.axis==="Y"?1:2;
  const anchor=[...samples[0].marker] as [number,number,number];
  anchor[axis]=plane.coordinate;
  if (!validVec3(anchor) || samples.some((sample) =>
    !Number.isFinite(dist(sample.target,anchor)) ||
    dist(sample.target,anchor)>constraint.tolerance
  )) return unavailable("CONTACT_IK_TARGET_NOT_FIXED");
  const tolerance=Math.min(1e-3,Math.max(1e-5,constraint.tolerance/4));
  const proposals: Candidate[]=[];
  for (let i=0;i<ordered.length;i++) {
    const correction=anchor.map((v,j)=>v-samples[i].marker[j])
      as [number,number,number];
    if (!validVec3(correction)) return unavailable("CONTACT_IK_TARGET_INVALID");
    let solved: ReturnType<typeof solveFabrikChain>;
    try {
      solved=solveFabrikChain(ordered[i].joint_world_positions,anchor,{
        tolerance,max_iterations:64,
      });
    } catch {
      return unavailable("CONTACT_IK_SOLVER_FAILED");
    }
    if (!solved.reached || !Number.isFinite(solved.residual) ||
        solved.residual>tolerance ||
        solved.points.some((point)=>!validVec3(point))) {
      return unavailable("CONTACT_IK_UNREACHABLE");
    }
    // Optional explicit knee pole selects a non-flipped analytic bend and
    // computes two normalized WORLD-space shortest-arc quaternions.
    // Native local bone Euler conversion/keyframe mutation is not inferred.
    const orientation = chain.bend_pole_world !== undefined
      ? planTwoBonePoleSwing(
          ordered[i].joint_world_positions, solved.points,
          chain.bend_pole_world,
          { max_swing_degrees: chain.max_swing_degrees }
        ) : null;
    if (orientation && orientation.state !== "SOURCE_ONLY_POLE_SWING_HINT") {
      return {
        ...unavailable("CONTACT_IK_POLE_ORIENTATION_UNSAFE"),
        orientation_blocker: orientation.reason,
      };
    }
    const correctedPoints = orientation ? orientation.corrected_points : solved.points;
    proposals.push({
      time:samples[i].time,target_world:[...anchor],
      correction_world:correction,
      solved_chain_world:correctedPoints.map((point)=>
        [...point] as [number,number,number]),
      residual_world:solved.residual,
      ...(orientation ? { orientation_hint: orientation } : {}),
    });
  }
  return {
    state:"SOURCE_ONLY_REACHABLE" as const,reason:null,
    project_uuid:chain.project_uuid,animation_uuid:chain.animation_uuid,
    locator_uuid:chain.locator_uuid,joint_group_uuids:[...ids],
    frame_count:proposals.length,frames:proposals,
    max_residual_world:Math.max(...proposals.map((f)=>f.residual_world)),
    input_provenance:"CALLER_DECLARED_NOT_NATIVE_ATTESTED" as const,
    native_sampling_attested:false as const,
    native_ik_bake_authorized:false as const,
    physical_contact_verified:false as const,
    visual_verdict:"not_evaluated" as const,
  };
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
    ik_reachability_candidate?: ReturnType<typeof planDeclaredContactIkReachability>;
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
  const identityCounts = new Map<string, number>();
  for (const constraint of constraints) {
    if (typeof constraint.id !== "string") continue;
    identityCounts.set(constraint.id, (identityCounts.get(constraint.id) ?? 0) + 1);
  }
  for (const constraint of constraints) {
    const invalid = (reason: string) => {
      invalidConstraintCount++;
      if (invalidExamples.length < exampleLimit) {
        invalidExamples.push({ id: constraint.id, reason });
      }
    };
    // Do not produce a clean contact or actionable slip hypothesis for
    // any member of a duplicated identity, regardless of input order.
    if (typeof constraint.id === "string" &&
        (identityCounts.get(constraint.id) ?? 0) > 1) {
      invalid("DUPLICATE_CONTACT_CONSTRAINT_ID");
      continue;
    }
    if (typeof constraint.id !== "string" || !constraint.id.trim() ||
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
    // Times closer than the declared numeric sampling resolution cannot
    // safely support velocities, stance coverage or correction hypotheses.
    if (samples.some((sample, index) =>
      index > 0 && sample.time - samples[index - 1].time <= TIME_EPSILON
    )) {
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

    const ikCandidate = constraint.ik_chain !== undefined
      ? planDeclaredContactIkReachability(
          constraint, samples, slipCorrectionState === "candidate"
        )
      : null;
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
      ...(ikCandidate ? { ik_reachability_candidate: ikCandidate } : {}),
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


/**
 * Diagnostic only: native preview callback may provide finite world-space
 * Locator coordinates, but no Locator is a foot/grip/contact until the caller
 * explicitly binds its role and supplies a complete contact window.
 *
 * This pure reducer does not sample Blockbench, infer contact, invoke IK,
 * mutate bones or certify restored preview state.
 */
export type ObservedAnimationLocatorFrame = {
  project_uuid: string;
  animation_uuid: string;
  time_seconds: number;
  markers: readonly {
    locator_uuid: string;
    parent_group_uuid: string;
    world_position: Vec3;
  }[];
};

export const ANIMATION_LOCATOR_TRAJECTORY_MAX_FRAMES = 5;
export const ANIMATION_LOCATOR_TRAJECTORY_MAX_MARKERS = 16;

export function analyzeObservedAnimationLocatorTrajectories(
  frames: readonly ObservedAnimationLocatorFrame[]
) {
  const unavailable = (reason: string) => ({
    state: "unavailable" as const,
    reason,
    frame_count: Array.isArray(frames) ? frames.length : 0,
    evaluated_locator_count: 0,
    contact_roles_assigned: false as const,
    physical_contact_verified: false as const,
    native_preview_restoration_attested: false as const,
    ik_correction_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
    trajectories: [] as Array<{
      locator_uuid: string;
      parent_group_uuid: string;
      sample_count: number;
      max_world_drift_from_start: number;
      start_to_end_distance: number;
      world_path_length: number;
      max_segment_speed: number;
      samples: Array<{ time_seconds: number; world_position: Vec3 }>;
    }>,
  });
  if (!Array.isArray(frames) || frames.length < 2 ||
      frames.length > ANIMATION_LOCATOR_TRAJECTORY_MAX_FRAMES) {
    return unavailable("LOCATOR_TRAJECTORY_FRAME_WINDOW_INVALID");
  }
  if (frames.some((frame) =>
    !frame || typeof frame !== "object" || !Number.isFinite(frame.time_seconds)
  )) return unavailable("LOCATOR_TRAJECTORY_FRAME_IDENTITY_OR_COVERAGE_CHANGED");
  const ordered = [...frames].sort((a, b) => a.time_seconds - b.time_seconds);
  const first = ordered[0];
  if (!first || typeof first.project_uuid !== "string" || !first.project_uuid.trim() ||
      typeof first.animation_uuid !== "string" || !first.animation_uuid.trim() ||
      !Array.isArray(first.markers) || first.markers.length === 0) {
    return unavailable("LOCATOR_TRAJECTORY_IDENTITY_OR_MARKERS_MISSING");
  }
  if (first.markers.length > ANIMATION_LOCATOR_TRAJECTORY_MAX_MARKERS) {
    return unavailable("LOCATOR_TRAJECTORY_MARKER_BUDGET_EXCEEDED");
  }
  const expected = new Map<string, {
    parent_group_uuid: string;
    world_position: Vec3;
  }>();
  for (const frame of ordered) {
    if (!frame || frame.project_uuid !== first.project_uuid ||
        frame.animation_uuid !== first.animation_uuid ||
        !Number.isFinite(frame.time_seconds) || frame.time_seconds < 0 ||
        !Array.isArray(frame.markers) ||
        frame.markers.length !== first.markers.length) {
      return unavailable("LOCATOR_TRAJECTORY_FRAME_IDENTITY_OR_COVERAGE_CHANGED");
    }
    const seen = new Set<string>();
    for (const marker of frame.markers) {
      if (!marker || typeof marker.locator_uuid !== "string" ||
          !marker.locator_uuid.trim() ||
          typeof marker.parent_group_uuid !== "string" ||
          !marker.parent_group_uuid.trim() ||
          !Array.isArray(marker.world_position) ||
          marker.world_position.length !== 3 ||
          !marker.world_position.every((value) =>
            typeof value === "number" && Number.isFinite(value)
          ) || seen.has(marker.locator_uuid)) {
        return unavailable("LOCATOR_TRAJECTORY_AMBIGUOUS_OR_NONFINITE_MARKER");
      }
      seen.add(marker.locator_uuid);
      if (frame === first) {
        expected.set(marker.locator_uuid, {
          parent_group_uuid: marker.parent_group_uuid,
          world_position: marker.world_position,
        });
      } else if (
        expected.get(marker.locator_uuid)?.parent_group_uuid !== marker.parent_group_uuid
      ) {
        return unavailable("LOCATOR_TRAJECTORY_MARKER_OR_PARENT_CHANGED");
      }
    }
    if (frame !== first && [...expected.keys()].some((id) => !seen.has(id))) {
      return unavailable("LOCATOR_TRAJECTORY_MARKER_OR_PARENT_CHANGED");
    }
  }
  if (ordered.some((frame, index) =>
    index > 0 && frame.time_seconds - ordered[index - 1].time_seconds <= TIME_EPSILON
  )) return unavailable("LOCATOR_TRAJECTORY_TIMES_NOT_DISTINCT");

  const distance = (a: Vec3, b: Vec3) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const trajectories = [...expected.entries()].map(([locator_uuid, metadata]) => {
    // Read-only, bounded value snapshots; do not retain native THREE objects.
    const samples = ordered.map((frame) => ({
      time_seconds: frame.time_seconds,
      world_position: [...frame.markers.find((marker) =>
        marker.locator_uuid === locator_uuid
      )!.world_position] as [number, number, number],
    }));
    let path = 0, maxSegmentSpeed = 0;
    for (let i = 1; i < samples.length; i++) {
      const segment = distance(samples[i - 1].world_position, samples[i].world_position);
      path += segment;
      maxSegmentSpeed = Math.max(
        maxSegmentSpeed, segment / (samples[i].time_seconds - samples[i - 1].time_seconds)
      );
    }
    return {
      locator_uuid,
      parent_group_uuid: metadata.parent_group_uuid,
      sample_count: samples.length,
      max_world_drift_from_start: Math.max(...samples.map((sample) =>
        distance(sample.world_position, samples[0].world_position)
      )),
      start_to_end_distance: distance(
        samples[0].world_position, samples[samples.length - 1].world_position
      ),
      world_path_length: path,
      max_segment_speed: maxSegmentSpeed,
      samples,
    };
  }).sort((a, b) => a.locator_uuid.localeCompare(b.locator_uuid));
  // Valid finite coordinates can still overflow derived distances/speeds.
  if (trajectories.some((item) =>
    ![item.max_world_drift_from_start, item.start_to_end_distance,
      item.world_path_length, item.max_segment_speed].every(Number.isFinite)
  )) return unavailable("LOCATOR_TRAJECTORY_METRICS_NONFINITE");
  return {
    state: "available" as const,
    reason: null,
    project_uuid: first.project_uuid,
    animation_uuid: first.animation_uuid,
    frame_count: ordered.length,
    evaluated_locator_count: trajectories.length,
    contact_roles_assigned: false as const,
    physical_contact_verified: false as const,
    native_preview_restoration_attested: false as const,
    ik_correction_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
    trajectories,
    note: "Read-only world-space Locator displacement at sampled preview callbacks. " +
      "No contact role, support plane, stance window, independent native restoration, " +
      "IK correction, or visual fidelity was verified. Nonzero drift is not a foot-slip " +
      "verdict; a stationary Locator is not proof of valid physical contact.",
  };
}

/**
 * Source-only, bounded inventory of real editor-preview Group world origins.
 * Geometry is captured by the existing native reader inside an authorized
 * screenshot callback, but complete Blockbench editor restoration is NOT
 * independently attested; it cannot authorize an IK bake or infer contact.
 */
export type ObservedAnimationJointOriginFrame = {
  project_uuid: string;
  animation_uuid: string;
  time_seconds: number;
  groups: readonly {
    group_uuid: string;
    parent_group_uuid: string | null;
    world_position: Vec3;
    /** Optional Group.mesh world orientation, not authored BoneAnimator Euler. */
    world_quaternion_xyzw?: RigQuaternionXYZW;
    /** Optional immediate THREE mesh parent's world orientation. */
    parent_world_quaternion_xyzw?: RigQuaternionXYZW;
    orientation_unavailable_reason?: string;
  }[];
};

export const ANIMATION_JOINT_ORIGIN_MAX_GROUPS = 16;

export function analyzeObservedAnimationJointOriginFrames(
  frames: readonly ObservedAnimationJointOriginFrame[]
) {
  type Sample = {
    time_seconds: number;
    groups: Array<{
      group_uuid: string;
      parent_group_uuid: string | null;
      world_position: [number, number, number];
      world_quaternion_xyzw?: RigQuaternionXYZW;
      parent_world_quaternion_xyzw?: RigQuaternionXYZW;
      orientation_unavailable_reason?: string;
    }>;
  };
  const unavailable = (reason: string) => ({
    state: "unavailable" as const,
    reason,
    observed_frame_count: Array.isArray(frames) ? frames.length : 0,
    observed_group_count: 0,
    frames: [] as Sample[],
    pose_time_synchronization_attested: false as const,
    native_preview_restoration_attested: false as const,
    native_ik_bake_authorized: false as const,
    contact_roles_inferred: false as const,
    visual_verdict: "not_evaluated" as const,
  });
  if (!Array.isArray(frames) || frames.length < 2 ||
      frames.length > ANIMATION_LOCATOR_TRAJECTORY_MAX_FRAMES ||
      frames.some((frame) =>
        !frame || !Number.isFinite(frame.time_seconds) ||
        frame.time_seconds < 0 || !Array.isArray(frame.groups)
      )) return unavailable("ANIMATION_JOINT_FRAME_SELECTION_INVALID");

  const sorted = [...frames].sort((a,b) => a.time_seconds-b.time_seconds);
  const first = sorted[0];
  const validId = (id: unknown) => typeof id === "string" &&
    id.length > 0 && id.length <= 160 && id === id.trim();
  if (!validId(first.project_uuid) || !validId(first.animation_uuid) ||
      first.groups.length < 2 ||
      first.groups.length > ANIMATION_JOINT_ORIGIN_MAX_GROUPS) {
    return unavailable("ANIMATION_JOINT_IDENTITY_OR_BUDGET_INVALID");
  }
  const expected = new Map<string, string | null>();
  const validQuaternion=(value:unknown):value is RigQuaternionXYZW =>
    Array.isArray(value) && value.length===4 &&
    value.every((n)=>typeof n==="number"&&Number.isFinite(n)) &&
    Math.abs(Math.hypot(...value)-1)<=1e-3;
  for (const frame of sorted) {
    if (frame.project_uuid !== first.project_uuid ||
        frame.animation_uuid !== first.animation_uuid ||
        frame.groups.length !== first.groups.length) {
      return unavailable("ANIMATION_JOINT_FRAME_IDENTITY_OR_COVERAGE_CHANGED");
    }
    const seen = new Set<string>();
    for (const group of frame.groups) {
      if (!group || !validId(group.group_uuid) ||
          (group.parent_group_uuid !== null && !validId(group.parent_group_uuid)) ||
          group.group_uuid === group.parent_group_uuid ||
          !Array.isArray(group.world_position) ||
          group.world_position.length !== 3 ||
          !group.world_position.every((value) =>
            typeof value === "number" && Number.isFinite(value)
          ) || seen.has(group.group_uuid)) {
        return unavailable("ANIMATION_JOINT_GROUP_INVALID_OR_DUPLICATE");
      }
      const world=group.world_quaternion_xyzw;
      const parentWorld=group.parent_world_quaternion_xyzw;
      if ((world!==undefined || parentWorld!==undefined) &&
          (!validQuaternion(world)||!validQuaternion(parentWorld))) {
        return unavailable("ANIMATION_JOINT_WORLD_ORIENTATION_INVALID");
      }
      if (group.orientation_unavailable_reason !== undefined &&
          (typeof group.orientation_unavailable_reason !== "string" ||
           !group.orientation_unavailable_reason ||
           world!==undefined || parentWorld!==undefined)) {
        return unavailable("ANIMATION_JOINT_ORIENTATION_PROVENANCE_INVALID");
      }
      seen.add(group.group_uuid);
      if (frame === first) {
        expected.set(group.group_uuid, group.parent_group_uuid);
      } else if (!expected.has(group.group_uuid) ||
          expected.get(group.group_uuid) !== group.parent_group_uuid) {
        return unavailable("ANIMATION_JOINT_HIERARCHY_CHANGED");
      }
    }
    if (frame.groups.some((group) =>
      group.parent_group_uuid !== null && !seen.has(group.parent_group_uuid)
    )) return unavailable("ANIMATION_JOINT_ANCESTRY_INCOMPLETE");
  }
  if (sorted.some((frame, index) =>
    index > 0 &&
    frame.time_seconds - sorted[index-1].time_seconds <= TIME_EPSILON
  )) return unavailable("ANIMATION_JOINT_TIME_GRID_INVALID");

  const copied: Sample[] = sorted.map((frame) => ({
    time_seconds: frame.time_seconds,
    groups: frame.groups.map((group) => ({
      group_uuid: group.group_uuid,
      parent_group_uuid: group.parent_group_uuid,
      world_position: [...group.world_position] as [number, number, number],
      ...(group.world_quaternion_xyzw && group.parent_world_quaternion_xyzw
        ? {
            world_quaternion_xyzw:
              [...group.world_quaternion_xyzw] as [number,number,number,number],
            parent_world_quaternion_xyzw:
              [...group.parent_world_quaternion_xyzw] as [number,number,number,number],
          } : {}),
      ...(group.orientation_unavailable_reason
        ? { orientation_unavailable_reason: group.orientation_unavailable_reason }
        : {}),
    })).sort((a,b) => a.group_uuid.localeCompare(b.group_uuid)),
  }));
  const rotationCovered=copied.every((frame)=>
    frame.groups.every((group)=>
      group.world_quaternion_xyzw!==undefined &&
      group.parent_world_quaternion_xyzw!==undefined
    )
  );
  return {
    state: "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS" as const,
    reason: null,
    project_uuid: first.project_uuid,
    animation_uuid: first.animation_uuid,
    observed_frame_count: copied.length,
    observed_group_count: expected.size,
    frames: copied,
    mesh_world_orientation_state: rotationCovered
      ? "SOURCE_ONLY_MESH_WORLD_QUATERNIONS" as const
      : "UNAVAILABLE" as const,
    frames_with_complete_orientations: copied.filter((frame)=>
      frame.groups.every((group)=>group.world_quaternion_xyzw!==undefined)
    ).length,
    observation_scope: "CURRENT_NATIVE_PREVIEW_CALLBACK_READ_ONLY" as const,
    pose_time_synchronization_attested: false as const,
    native_preview_restoration_attested: false as const,
    native_ik_bake_authorized: false as const,
    contact_roles_inferred: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/**
 * Connect existing role-free Locator and Group preview diagnostics to one
 * explicitly declared FOOT_PLANT stance and its existing FABRIK preflight.
 *
 * Neither review independently attests actual native pose evaluation or full
 * Blockbench restoration. This is only a source-only diagnostic/IK proposal;
 * it never calls native Runtime, starts Undo, or writes rotation keyframes.
 */
export type ExplicitPlantedPreviewIkInput = {
  binding: ExplicitContactMarkerBinding;
  locator_review: ReturnType<typeof analyzeObservedAnimationLocatorTrajectories>;
  joint_review: ReturnType<typeof analyzeObservedAnimationJointOriginFrames>;
  joint_group_uuids: readonly string[];
  stance_window: ContactSamplingWindow;
  support_plane: ContactSupportPlane;
  tolerance: number;
  fixed_contact_world: Vec3;
  /** Optional declared world POINT for source-only two-bone knee bending. */
  bend_pole_world?: Vec3;
  max_swing_degrees?: number;
};


/**
 * Bounded, pure projection of already sampled THREE Group.mesh world
 * quaternion evidence and pole-guided world swings into parent-local hints.
 * This assumes the parent above the explicit chain remains unchanged during
 * this *hypothetical* correction; an actual native edit is never authorized.
 */
function planPreviewParentLocalIkHints(
  jointFrames: readonly ObservedAnimationJointOriginFrame[],
  jointIds: readonly string[],
  sampledTimes: readonly number[],
  candidateFrames: readonly {
    time:number;
    orientation_hint?: ReturnType<typeof planTwoBonePoleSwing>;
  }[]
) {
  const unavailable=(reason:string)=>({
    state:"unavailable" as const,reason,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    visual_verdict:"not_evaluated" as const,
  });
  if (jointIds.length!==3 || sampledTimes.length!==candidateFrames.length) {
    return unavailable("IK_LOCAL_CHAIN_OR_FRAME_COUNT_INVALID");
  }
  const frames: Array<{
    time:number;
    hip:ReturnType<typeof planWorldSwingToParentLocal>;
    knee:ReturnType<typeof planWorldSwingToParentLocal>;
  }>=[];
  for (let i=0;i<sampledTimes.length;i++) {
    const sample=jointFrames.find((frame)=>frame.time_seconds===sampledTimes[i]);
    const worldHint=candidateFrames[i].orientation_hint;
    if (!sample || worldHint?.state!=="SOURCE_ONLY_POLE_SWING_HINT" ||
        worldHint.segment_swings.length!==2) {
      return unavailable("IK_LOCAL_WORLD_SWING_OR_FRAME_UNAVAILABLE");
    }
    const hip=sample.groups.find((g)=>g.group_uuid===jointIds[0]);
    const knee=sample.groups.find((g)=>g.group_uuid===jointIds[1]);
    if (!hip?.world_quaternion_xyzw || !hip.parent_world_quaternion_xyzw ||
        !knee?.world_quaternion_xyzw || !knee.parent_world_quaternion_xyzw ||
        knee.parent_group_uuid!==hip.group_uuid) {
      return unavailable("IK_LOCAL_NATIVE_MESH_ORIENTATION_UNAVAILABLE");
    }
    const dot=hip.world_quaternion_xyzw.reduce((sum,x,index)=>
      sum+x*knee.parent_world_quaternion_xyzw![index],0);
    if (!Number.isFinite(dot)||Math.abs(dot)<1-1e-5) {
      return unavailable("IK_LOCAL_PARENT_HIERARCHY_ORIENTATION_MISMATCH");
    }
    // Upper segment is corrected relative to its unchanged external parent.
    const upper=planWorldSwingToParentLocal({
      source_world_quaternion_xyzw:hip.world_quaternion_xyzw,
      source_parent_world_quaternion_xyzw:hip.parent_world_quaternion_xyzw,
      corrected_parent_world_quaternion_xyzw:hip.parent_world_quaternion_xyzw,
      world_delta_quaternion_xyzw:
        worldHint.segment_swings[0].world_delta_quaternion_xyzw,
    });
    if (upper.state!=="SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT") {
      return unavailable("IK_LOCAL_HIP_REPROJECTION_UNAVAILABLE");
    }
    // The knee parent IS the corrected thigh; using its old world quaternion
    // would cause an apparent successful but physically incorrect local turn.
    const lower=planWorldSwingToParentLocal({
      source_world_quaternion_xyzw:knee.world_quaternion_xyzw,
      source_parent_world_quaternion_xyzw:knee.parent_world_quaternion_xyzw,
      corrected_parent_world_quaternion_xyzw:
        upper.corrected_world_quaternion_xyzw,
      world_delta_quaternion_xyzw:
        worldHint.segment_swings[1].world_delta_quaternion_xyzw,
    });
    if (lower.state!=="SOURCE_ONLY_PARENT_LOCAL_QUATERNION_HINT") {
      return unavailable("IK_LOCAL_KNEE_REPROJECTION_UNAVAILABLE");
    }
    frames.push({time:sampledTimes[i],hip:upper,knee:lower});
  }
  return {
    state:"SOURCE_ONLY_PARENT_LOCAL_QUATERNION_CANDIDATES" as const,
    reason:null,
    frames,
    external_chain_parent_unchanged_assumed:true as const,
    native_euler_authorized:false as const,
    native_keyframe_authorized:false as const,
    native_preview_restoration_attested:false as const,
    visual_verdict:"not_evaluated" as const,
  };
}

export function reviewExplicitPlantedContactIkFromPreview(
  input: ExplicitPlantedPreviewIkInput
) {
  const unavailable = (reason: string) => ({
    state: "UNVERIFIED" as const,
    reason,
    stance_sample_count: 0,
    native_preview_restoration_attested: false as const,
    native_pose_time_synchronization_attested: false as const,
    native_ik_bake_authorized: false as const,
    physical_contact_verified: false as const,
    visual_verdict: "not_evaluated" as const,
  });
  if (!input || typeof input !== "object") return unavailable("CONTACT_PREVIEW_INPUT_INVALID");
  const validId = (id: unknown): id is string =>
    typeof id === "string" && id.trim() === id &&
    id.length > 0 && id.length <= 160;
  const binding = input.binding;
  if (!binding || !validId(binding.id) || !validId(binding.evidence_ref) ||
      !validId(binding.project_uuid) || !validId(binding.animation_uuid) ||
      !validId(binding.group_uuid) || !validId(binding.locator_uuid) ||
      binding.role !== "FOOT_PLANT" ||
      !["DECLARED_USER_INTENT", "DECLARED_REFERENCE_INTENT"]
        .includes(binding.intent_authority)) {
    return unavailable("CONTACT_PREVIEW_EXPLICIT_FOOT_BINDING_REQUIRED");
  }

  const locator = input.locator_review, joint = input.joint_review;
  if (!locator || locator.state !== "available" ||
      !joint || joint.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    return unavailable("CONTACT_PREVIEW_NATIVE_OBSERVATIONS_INCOMPLETE");
  }
  if (locator.native_preview_restoration_attested !== false ||
      joint.native_preview_restoration_attested !== false ||
      joint.pose_time_synchronization_attested !== false ||
      joint.native_ik_bake_authorized !== false ||
      locator.project_uuid !== joint.project_uuid ||
      locator.animation_uuid !== joint.animation_uuid ||
      locator.project_uuid !== binding.project_uuid ||
      locator.animation_uuid !== binding.animation_uuid ||
      locator.frame_count !== joint.observed_frame_count ||
      locator.frame_count < 2 ||
      locator.frame_count > ANIMATION_LOCATOR_TRAJECTORY_MAX_FRAMES ||
      locator.trajectories.length !== locator.evaluated_locator_count ||
      joint.frames.length !== joint.observed_frame_count) {
    return unavailable("CONTACT_PREVIEW_PROJECT_OR_SAMPLE_COHORT_MISMATCH");
  }
  const matches = locator.trajectories.filter(
    (candidate) => candidate.locator_uuid === binding.locator_uuid
  );
  if (matches.length !== 1 || matches[0].parent_group_uuid !== binding.group_uuid ||
      matches[0].samples.length !== joint.frames.length) {
    return unavailable("CONTACT_PREVIEW_LOCATOR_PARENT_OR_SAMPLES_MISSING");
  }
  const ids = input.joint_group_uuids;
  if (!Array.isArray(ids) || ids.length < 2 ||
      ids.length > CONTACT_IK_MAX_JOINTS ||
      ids.some((id) => !validId(id)) ||
      new Set(ids).size !== ids.length ||
      ids[ids.length - 1] !== binding.group_uuid) {
    return unavailable("CONTACT_PREVIEW_JOINT_CHAIN_IDENTITY_INVALID");
  }
  const window = input.stance_window;
  const plane = input.support_plane;
  if (!window || !validWindow(window) ||
      !Number.isFinite(window.max_gap_seconds) ||
      window.max_gap_seconds <= TIME_EPSILON ||
      !plane || !validPlane(plane) ||
      !Number.isFinite(input.tolerance) || input.tolerance <= 0 ||
      !validVec3(input.fixed_contact_world) ||
      (input.bend_pole_world !== undefined &&
        !validVec3(input.bend_pole_world)) ||
      (input.max_swing_degrees !== undefined &&
        (!Number.isFinite(input.max_swing_degrees) ||
         input.max_swing_degrees <= 0 ||
         input.max_swing_degrees > 170))) {
    return unavailable("CONTACT_PREVIEW_STANCE_OR_PLANE_INVALID");
  }

  if (input.max_swing_degrees !== undefined &&
      input.bend_pole_world === undefined) {
    return unavailable("CONTACT_PREVIEW_BEND_POLE_REQUIRED");
  }
  const sampled: Array<{
    time: number;
    marker: Vec3;
    joints: Vec3[];
  }> = [];
  const trajectory = matches[0];
  for (let i = 0; i < joint.frames.length; i++) {
    const marker = trajectory.samples[i];
    const frame = joint.frames[i];
    if (frame.time_seconds !== marker.time_seconds ||
        !Number.isFinite(frame.time_seconds) ||
        !validVec3(marker.world_position) ||
        !Array.isArray(frame.groups)) {
      return unavailable("CONTACT_PREVIEW_JOINT_LOCATOR_CLOCK_MISMATCH");
    }
    const groups = new Map(frame.groups.map(
      (group) => [group.group_uuid, group] as const
    ));
    const joints: Vec3[] = [];
    for (let j = 0; j < ids.length; j++) {
      const current = groups.get(ids[j]);
      if (!current || (j > 0 && current.parent_group_uuid !== ids[j-1]) ||
          !validVec3(current.world_position)) {
        return unavailable("CONTACT_PREVIEW_JOINT_ANCESTRY_UNVERIFIED");
      }
      joints.push([...current.world_position] as [number,number,number]);
    }
    if (frame.time_seconds >= window.start && frame.time_seconds <= window.end) {
      sampled.push({
        time: frame.time_seconds,
        marker: [...marker.world_position] as [number,number,number],
        joints,
      });
    }
  }
  if (sampled.length < 2 || sampled.length > CONTACT_IK_MAX_SAMPLES ||
      Math.abs(sampled[0].time - window.start) > TIME_EPSILON ||
      Math.abs(sampled[sampled.length-1].time - window.end) > TIME_EPSILON ||
      sampled.some((item,i) => i > 0 &&
        (item.time - sampled[i-1].time <= TIME_EPSILON ||
         item.time - sampled[i-1].time > window.max_gap_seconds + TIME_EPSILON)
      )) {
    return unavailable("CONTACT_PREVIEW_STANCE_WINDOW_NOT_COVERED");
  }

  // The current FABRIK contact owner anchors at the first marker projected
  // onto the declared plane. Reject other target definitions rather than
  // silently substituting a different user-declared fixed contact.
  const axis = plane.axis === "X" ? 0 : plane.axis === "Y" ? 1 : 2;
  const firstAnchor = [...sampled[0].marker] as [number,number,number];
  firstAnchor[axis] = plane.coordinate;
  if (Math.hypot(...firstAnchor.map((value,i) =>
        value - input.fixed_contact_world[i]
      )) > TIME_EPSILON) {
    return unavailable("CONTACT_PREVIEW_FIXED_ANCHOR_DISAGREES");
  }

  const contact: ContactConstraintInput = {
    id: binding.id,
    mode: "planted",
    tolerance: input.tolerance,
    sampling_window: { ...window },
    support_plane: { ...plane },
    samples: sampled.map((item) => ({
      time: item.time,
      marker: item.marker,
      target: [...input.fixed_contact_world] as [number,number,number],
    })),
    ik_chain: {
      project_uuid: binding.project_uuid,
      animation_uuid: binding.animation_uuid,
      locator_uuid: binding.locator_uuid,
      joint_group_uuids: [...ids],
      frames: sampled.map((item) => ({
        time: item.time,
        joint_world_positions: item.joints,
      })),
      ...(input.bend_pole_world !== undefined ? {
        bend_pole_world: [...input.bend_pole_world] as [number,number,number],
      } : {}),
      ...(input.max_swing_degrees !== undefined ? {
        max_swing_degrees: input.max_swing_degrees,
      } : {}),
    },
  };
  const contactReview = analyzeAnimationContactEvidence({ constraints: [contact] });
  if (contactReview.state !== "available" ||
      contactReview.invalid_constraint_count !== 0 ||
      contactReview.constraints.length !== 1) {
    return unavailable("CONTACT_PREVIEW_NUMERIC_CONTACT_REVIEW_INVALID");
  }
  const numeric = contactReview.constraints[0];
  const ik = numeric.ik_reachability_candidate;
  // A successful contact/stance read does not mean the IK target can be
  // reached. In particular, the existing contact analyzer intentionally
  // returns an unavailable IK proposal for unplanted, unreachable, stretched
  // or offset end-effectors. Never promote that to a ready-to-review IK pose.
  if (!ik || ik.state !== "SOURCE_ONLY_REACHABLE") {
    return {
      ...unavailable("CONTACT_PREVIEW_IK_PROPOSAL_UNAVAILABLE"),
      ik_blocker: ik?.reason ?? "NO_REACHABLE_IK_CANDIDATE",
      contact_evidence: numeric,
    };
  }
  // Keep even source-only acceptance conditional on an exact-time complete
  // stance with a bounded, numeric-only FABRIK result. Native proof is NEVER
  // inherited from numeric contact estimates or caller-provided identities.
  if (numeric.slip_correction_hypothesis.state !== "candidate" ||
      numeric.sampling_coverage !== "complete" ||
      ik.frame_count !== sampled.length ||
      ik.frames.length !== sampled.length ||
      !Number.isFinite(ik.max_residual_world) ||
      ik.frames.some((frame, index) =>
        frame.time !== sampled[index].time ||
        !Number.isFinite(frame.residual_world) ||
        frame.residual_world < 0
      ) ||
      ik.native_sampling_attested !== false ||
      ik.native_ik_bake_authorized !== false ||
      ik.physical_contact_verified !== false ||
      ik.visual_verdict !== "not_evaluated") {
    return {
      ...unavailable("CONTACT_PREVIEW_IK_PROPOSAL_INCONSISTENT"),
      ik_blocker: "SOURCE_PLAN_OR_PROVENANCE_MISMATCH",
      contact_evidence: numeric,
    };
  }
  const localQuaternionReview=input.bend_pole_world!==undefined
    ? planPreviewParentLocalIkHints(
        joint.frames,
        ids,
        sampled.map((item)=>item.time),
        ik.frames
      )
    : null;
  return {
    state: "SOURCE_ONLY_PREVIEW_CONTACT_IK_REVIEW" as const,
    reason: null,
    project_uuid: binding.project_uuid,
    animation_uuid: binding.animation_uuid,
    locator_uuid: binding.locator_uuid,
    explicit_role: binding.role,
    declared_intent_authority: binding.intent_authority,
    declared_evidence_ref: binding.evidence_ref,
    joint_group_uuids: [...ids],
    sampled_times: sampled.map((item) => item.time),
    stance_sample_count: sampled.length,
    stance_window: { ...window },
    contact_evidence: contactReview.constraints[0],
    ...(localQuaternionReview
      ? { parent_local_orientation_review: localQuaternionReview }
      : {}),
    native_preview_restoration_attested: false as const,
    native_pose_time_synchronization_attested: false as const,
    native_ik_bake_authorized: false as const,
    physical_contact_verified: false as const,
    visual_verdict: "not_evaluated" as const,
    note: "Explicit FOOT_PLANT intent links two caller-supplied, source-only " +
      "preview diagnostics and the existing numeric contact/FABRIK preflight. " +
      "No native restoration, contact physics, visual acceptance or keyframe " +
      "mutation is demonstrated.",
  };
}
