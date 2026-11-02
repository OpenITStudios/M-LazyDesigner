import { expect, test } from "bun:test";
import {
  analyzeAnimationContactEvidence,
  analyzeObservedAnimationLocatorTrajectories,
  analyzeObservedAnimationJointOriginFrames,
  reviewExplicitPlantedContactIkFromPreview,
  type ExplicitPlantedPreviewIkInput,
  type ObservedAnimationLocatorFrame,
  type ObservedAnimationJointOriginFrame,
  type ContactConstraintInput,
} from "@/lib/animationContactEvidence";

function requireAvailable<T extends { state: string }>(result: T): asserts result is T & { state: "available" } {
  if (result.state !== "available") throw new Error(`expected available contact evidence, got ${result.state}`);
}

test("stable grip contact passes without becoming a visual verdict", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "right_hand_to_rod_grip",
      mode: "pair",
      tolerance: 0.15,
      samples: [
        { time: 0, marker: [0, 1, 0], target: [0.05, 1, 0] },
        { time: 0.5, marker: [0.2, 1.1, 0], target: [0.25, 1.1, 0] },
        { time: 1, marker: [0.4, 1.2, 0], target: [0.45, 1.2, 0] },
      ],
    }],
  });
  expect(result.state).toBe("available");
  requireAvailable(result);
  expect(result.review_constraint_count).toBe(0);
  expect(result.constraints[0]?.status).toBe("pass");
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("missed impact/contact is surfaced with bounded examples", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "pickaxe_head_to_target",
      mode: "fixed",
      tolerance: 0.2,
      samples: [
        { time: 0.3, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.5, marker: [0.8, 0, 0], target: [0, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.review_constraint_count).toBe(1);
  expect(result.constraints[0]?.violation_count).toBe(1);
  expect(result.constraints[0]?.max_distance).toBe(0.8);
});

test("planted contact reports marker drift without inventing weight-transfer quality", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "left_foot_plant",
      mode: "planted",
      tolerance: 0.12,
      samples: [
        { time: 0, marker: [1, 0, 1], target: [1, 0, 1] },
        { time: 0.2, marker: [1.05, 0, 1], target: [1, 0, 1] },
        { time: 0.4, marker: [1.25, 0, 1], target: [1, 0, 1] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("review");
  expect(result.constraints[0]?.max_marker_drift_from_first).toBe(0.25);
  expect(result.note).toContain("does not prove believable weight");
});


test("planted marker moving with target still flags foot sliding", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "left_foot_planted",
      mode: "planted",
      tolerance: 0.1,
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.2, marker: [0.2, 0, 0], target: [0.2, 0, 0] },
        { time: 0.4, marker: [0.5, 0, 0], target: [0.5, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.violation_count).toBe(0);
  expect(result.constraints[0]?.planted_drift_violation).toBe(true);
  expect(result.constraints[0]?.max_marker_drift_from_first).toBe(0.5);
  expect(result.constraints[0]?.status).toBe("review");
  expect(result.pass_constraint_count).toBe(0);
  expect(result.review_constraint_count).toBe(1);
  expect(result.sample_provenance).toBe("caller_supplied_not_native_attested");
});

test("complete declared sampling window allows a numerical planted contact pass only", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "right_foot_stance",
      mode: "planted",
      tolerance: 0.1,
      sampling_window: { start: 0, end: 0.4, max_gap_seconds: 0.2 },
      samples: [
        { time: 0.4, marker: [1.01, 0, 0], target: [1, 0, 0] },
        { time: 0, marker: [1, 0, 0], target: [1, 0, 0] },
        { time: 0.2, marker: [1.03, 0, 0], target: [1, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.sampling_coverage).toBe("complete");
  expect(result.constraints[0]?.max_sample_gap_seconds).toBe(0.2);
  expect(result.constraints[0]?.planted_drift_violation).toBe(false);
  expect(result.constraints[0]?.status).toBe("pass");
  expect(result.pass_constraint_count).toBe(1);
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("uncovered timing gap remains unverified instead of passing", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "sparse_foot",
      mode: "planted",
      tolerance: 0.1,
      sampling_window: { start: 0, end: 1, max_gap_seconds: 0.2 },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 1, marker: [0, 0, 0], target: [0, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.sampling_coverage).toBe("incomplete");
  expect(result.constraints[0]?.status).toBe("unverified");
  expect(result.pass_constraint_count).toBe(0);
  expect(result.unverified_constraint_count).toBe(1);
});

test("missing window boundaries cannot silently certify contact", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "truncated_stance",
      mode: "planted",
      tolerance: 0.1,
      sampling_window: { start: 0, end: 1, max_gap_seconds: 0.5 },
      samples: [
        { time: 0.25, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.75, marker: [0, 0, 0], target: [0, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("unverified");
  expect(result.constraints[0]?.sampling_coverage).toBe("incomplete");
});

test("real observed drift remains review even when time sampling is incomplete", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "sparse_sliding",
      mode: "planted",
      tolerance: 0.1,
      sampling_window: { start: 0, end: 1, max_gap_seconds: 0.1 },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 1, marker: [0.3, 0, 0], target: [0.3, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.sampling_coverage).toBe("incomplete");
  expect(result.constraints[0]?.status).toBe("review");
});

test("declared contact support plane detects actual floor penetration", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "foot_floor",
      mode: "planted",
      tolerance: 0.2,
      support_plane: {
        axis: "Y", coordinate: 0, allowed_side: "POSITIVE",
        penetration_tolerance: 0.04,
      },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.1, marker: [0, -0.08, 0], target: [0, -0.08, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.violation_count).toBe(0);
  expect(result.constraints[0]?.planted_drift_violation).toBe(false);
  expect(result.constraints[0]?.support_plane_penetration_count).toBe(1);
  expect(result.constraints[0]?.max_support_plane_penetration).toBe(0.08);
  expect(result.constraints[0]?.status).toBe("review");
});

test("support plane respects the declared allowed side", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "ceiling_contact",
      mode: "planted",
      tolerance: 0.5,
      support_plane: {
        axis: "Y", coordinate: 10, allowed_side: "NEGATIVE",
        penetration_tolerance: 0.01,
      },
      samples: [
        { time: 0, marker: [0, 9.9, 0], target: [0, 9.9, 0] },
        { time: 0.1, marker: [0, 9.95, 0], target: [0, 9.95, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.support_plane_penetration_count).toBe(0);
  expect(result.constraints[0]?.status).toBe("pass");
});

test("invalid, duplicate or nonfinite samples are not filtered into a fake pass", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [
      {
        id: "nonfinite", mode: "planted", tolerance: 0.1,
        samples: [
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
          { time: 0.1, marker: [Number.NaN, 0, 0], target: [0, 0, 0] },
        ],
      },
      {
        id: "duplicate_time", mode: "pair", tolerance: 0.1,
        samples: [
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
          { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        ],
      },
      {
        id: "invalid_window", mode: "pair", tolerance: 0.1,
        sampling_window: { start: 1, end: 0, max_gap_seconds: 0.1 },
        samples: [{ time: 0, marker: [0, 0, 0], target: [0, 0, 0] }],
      },
    ],
  });
  requireAvailable(result);
  expect(result.constraint_count).toBe(0);
  expect(result.invalid_constraint_count).toBe(3);
  expect(result.pass_constraint_count).toBe(0);
  expect(result.invalid_examples.map((item) => item.reason)).toEqual([
    "INVALID_CONTACT_SAMPLES",
    "DUPLICATE_SAMPLE_TIMESTAMPS",
    "INVALID_CONTACT_CONSTRAINT",
  ]);
});

test("support-plane input is not guessed for moving pair contact", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "hand_to_rod",
      mode: "pair",
      tolerance: 0.1,
      support_plane: {
        axis: "Y", coordinate: 0, allowed_side: "POSITIVE",
        penetration_tolerance: 0.1,
      },
      samples: [{ time: 0, marker: [0, 0, 0], target: [0, 0, 0] }],
    }],
  });
  requireAvailable(result);
  expect(result.invalid_constraint_count).toBe(1);
  expect(result.invalid_examples[0]?.reason).toBe("SUPPORT_PLANE_REQUIRES_PLANTED");
});

test("original caller-supplied sample objects remain unchanged", () => {
  const samples = [
    { time: 0.3, marker: [1, 0, 0], target: [1, 0, 0] },
    { time: 0, marker: [1, 0, 0], target: [1, 0, 0] },
  ] as const;
  const before = JSON.stringify(samples);
  const result = analyzeAnimationContactEvidence({
    constraints: [{ id: "stable", mode: "pair", tolerance: 0.1, samples }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("pass");
  expect(result.constraints[0]?.sampling_coverage).toBe("not_evaluated");
  expect(JSON.stringify(samples)).toBe(before);
});


test("one sampled planted frame is unverified even without a declared time window", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "single_stance_frame", mode: "planted", tolerance: 0.1,
      samples: [{ time: 0, marker: [0, 0, 0], target: [0, 0, 0] }],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("unverified");
  expect(result.constraints[0]?.unverified_reasons).toEqual(["PLANTED_NEEDS_MULTIPLE_SAMPLES"]);
  expect(result.unverified_constraint_count).toBe(1);
  expect(result.pass_constraint_count).toBe(0);
  expect(result.coverage_scope).toBe("supplied_constraints_only");
});

test("single-frame pair contact remains a numeric observation, not motion proof", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "impact_at_t", mode: "pair", tolerance: 0.1,
      samples: [{ time: 0.1, marker: [0, 0, 0], target: [0, 0, 0] }],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("pass");
  expect(result.constraints[0]?.review_reasons).toEqual([]);
  expect(result.constraints[0]?.unverified_reasons).toEqual([]);
  expect(result.sample_provenance).toBe("caller_supplied_not_native_attested");
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("review causes are separate for distance, planted drift and penetration", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "multiple_contact_errors", mode: "planted", tolerance: 0.1,
      support_plane: {
        axis: "Y", coordinate: 0, allowed_side: "POSITIVE",
        penetration_tolerance: 0.01,
      },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.5, marker: [1, -0.2, 0], target: [0, 0, 0] },
      ],
      sampling_window: { start: 0, end: 1, max_gap_seconds: 0.25 },
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.status).toBe("review");
  expect(result.constraints[0]?.review_reasons).toEqual([
    "CONTACT_DISTANCE_EXCEEDED",
    "PLANTED_MARKER_DRIFT",
    "SUPPORT_PLANE_PENETRATION",
  ]);
  expect(result.constraints[0]?.unverified_reasons).toContain("SAMPLING_WINDOW_INCOMPLETE");
});

test("oversized contact batches fail closed before allocating work", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: Array.from({ length: 65 }, (_, i) => ({
      id: "contact_" + i, mode: "pair" as const, tolerance: 0.1,
      samples: [{ time: 0, marker: [0, 0, 0] as const, target: [0, 0, 0] as const }],
    })),
  });
  expect(result).toMatchObject({
    state: "unavailable", reason: "contact_constraint_budget_exceeded",
  });
});

test("oversized per-contact sample arrays cannot become a partial pass", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "huge_contact", mode: "planted", tolerance: 0.1,
      samples: Array.from({ length: 2049 }, (_, i) => ({
        time: i / 30, marker: [0, 0, 0] as const, target: [0, 0, 0] as const,
      })),
    }],
  });
  requireAvailable(result);
  expect(result.constraint_count).toBe(0);
  expect(result.invalid_constraint_count).toBe(1);
  expect(result.invalid_examples[0]?.reason).toBe("CONTACT_SAMPLE_BUDGET_EXCEEDED");
  expect(result.pass_constraint_count).toBe(0);
});

test("existing planted sliding and penetration cases report explicit review causes", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "floor_penetration", mode: "planted", tolerance: 0.25,
      support_plane: { axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0.01 },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.1, marker: [0, -0.05, 0], target: [0, -0.05, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.constraints[0]?.review_reasons).toEqual(["SUPPORT_PLANE_PENETRATION"]);
});


test("support plane separates planted sliding from vertical lift without assigning a visual verdict", () => {
  const base = {
    mode: "planted" as const, tolerance: 0.1,
    support_plane: {
      axis: "Y" as const, coordinate: 0,
      allowed_side: "POSITIVE" as const, penetration_tolerance: 0,
    },
  };
  const result = analyzeAnimationContactEvidence({ constraints: [
    { ...base, id: "slide", samples: [
      { time: 0, marker: [0, 0, 0] as const, target: [0, 0, 0] as const },
      { time: 0.2, marker: [0.25, 0.02, 0] as const, target: [0.25, 0.02, 0] as const },
    ] },
    { ...base, id: "lift", samples: [
      { time: 0, marker: [0, 0, 0] as const, target: [0, 0, 0] as const },
      { time: 0.2, marker: [0.02, 0.4, 0] as const, target: [0.02, 0.4, 0] as const },
    ] },
  ] });
  requireAvailable(result);
  expect(result.constraints[0]).toMatchObject({
    status: "review", support_tangential_drift_violation: true,
    max_support_tangential_drift: 0.25,
    max_support_normal_displacement: 0.02,
  });
  expect(result.constraints[1]).toMatchObject({
    status: "review", support_tangential_drift_violation: false,
    max_support_tangential_drift: 0.02,
    max_support_normal_displacement: 0.4,
  });
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("support-plane decomposition stays unavailable for an unanchored moving contact", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "hand", mode: "pair", tolerance: 0.1,
    samples: [
      { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
      { time: 0.2, marker: [0.3, 0, 0], target: [0.3, 0, 0] },
    ],
  }] });
  requireAvailable(result);
  expect(result.constraints[0]?.max_support_tangential_drift).toBeNull();
  expect(result.constraints[0]?.max_support_normal_displacement).toBeNull();
  expect(result.constraints[0]?.support_tangential_drift_violation).toBeNull();
  expect(result.constraints[0]?.status).toBe("pass");
});


test("complete planted sampling yields bounded tangential marker correction hints, never keyframe mutations", () => {
  const source = [
    { time: 0.4, marker: [0.3, 0.06, 0] as const, target: [0.3, 0.06, 0] as const },
    { time: 0, marker: [0, 0, 0] as const, target: [0, 0, 0] as const },
    { time: 0.2, marker: [0.15, 0.02, 0] as const, target: [0.15, 0.02, 0] as const },
  ];
  const saved = JSON.stringify(source);
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "stance", mode: "planted", tolerance: 0.1,
    sampling_window: { start: 0, end: 0.4, max_gap_seconds: 0.2 },
    support_plane: { axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0 },
    samples: source,
  }], exampleLimit: 1 });
  requireAvailable(result);
  const hints = result.constraints[0]?.slip_correction_hypothesis;
  expect(hints).toMatchObject({
    state: "candidate",
    blocker: null,
    space: "caller_declared_world_marker",
    samples_truncated: true,
    samples: [{
      time: 0.2,
      tangential_drift: 0.15,
      marker_translation_to_anchor: [-0.15, 0, 0],
    }],
  });
  expect(result.visual_verdict).toBe("not_evaluated");
  expect(JSON.stringify(source)).toBe(saved);
});

test("drift without complete time coverage cannot yield an applicable slip correction", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [
    { id: "missing_plane", mode: "planted", tolerance: 0.1,
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.5, marker: [0.5, 0, 0], target: [0.5, 0, 0] },
      ],
    },
    { id: "missing_window", mode: "planted", tolerance: 0.1,
      support_plane: { axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0 },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.5, marker: [0.5, 0, 0], target: [0.5, 0, 0] },
      ],
    },
    { id: "incomplete_window", mode: "planted", tolerance: 0.1,
      support_plane: { axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0 },
      sampling_window: { start: 0, end: 1, max_gap_seconds: 0.2 },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 1, marker: [0.5, 0, 0], target: [0.5, 0, 0] },
      ],
    },
  ]});
  requireAvailable(result);
  expect(result.constraints.map((entry) => entry.slip_correction_hypothesis)).toEqual([
    { state: "blocked", blocker: "SUPPORT_PLANE_REQUIRED",
      space: "caller_declared_world_marker", samples: [], samples_truncated: false },
    { state: "blocked", blocker: "COMPLETE_SAMPLING_WINDOW_REQUIRED",
      space: "caller_declared_world_marker", samples: [], samples_truncated: false },
    { state: "blocked", blocker: "COMPLETE_SAMPLING_WINDOW_REQUIRED",
      space: "caller_declared_world_marker", samples: [], samples_truncated: false },
  ]);
});

test("lift alone does not produce tangential correction hints", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "lift", mode: "planted", tolerance: 0.1,
    support_plane: { axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0 },
    sampling_window: { start: 0, end: 0.2, max_gap_seconds: 0.2 },
    samples: [
      { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
      { time: 0.2, marker: [0, 0.5, 0], target: [0, 0.5, 0] },
    ],
  }] });
  requireAvailable(result);
  expect(result.constraints[0]?.slip_correction_hypothesis)
    .toMatchObject({ state: "not_applicable", samples: [] });
  expect(result.constraints[0]?.max_support_normal_displacement).toBe(0.5);
});


test("lifted foot with sideways motion cannot masquerade as grounded foot sliding", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "swing_not_foot_plant",
    mode: "planted",
    tolerance: 0.1,
    sampling_window: { start: 0, end: 0.4, max_gap_seconds: 0.2 },
    support_plane: {
      axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0,
    },
    samples: [
      { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
      { time: 0.2, marker: [0.2, 0.6, 0], target: [0.2, 0.6, 0] },
      { time: 0.4, marker: [0.4, 0.05, 0], target: [0.4, 0.05, 0] },
    ],
  }] });
  requireAvailable(result);
  expect(result.constraints[0]?.sampling_coverage).toBe("complete");
  expect(result.constraints[0]?.support_tangential_drift_violation).toBe(true);
  expect(result.constraints[0]?.max_support_plane_clearance).toBe(0.6);
  expect(result.constraints[0]?.slip_correction_hypothesis).toEqual({
    state: "blocked",
    blocker: "CONTACT_PLANE_CLEARANCE_EXCEEDED",
    space: "caller_declared_world_marker",
    samples: [],
    samples_truncated: false,
  });
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("constant hovering contact also cannot generate a false grounded correction", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "hovering_marker",
    mode: "planted",
    tolerance: 0.1,
    sampling_window: { start: 0, end: 0.2, max_gap_seconds: 0.2 },
    support_plane: {
      axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0,
    },
    samples: [
      { time: 0, marker: [0, 0.5, 0], target: [0, 0.5, 0] },
      { time: 0.2, marker: [0.4, 0.5, 0], target: [0.4, 0.5, 0] },
    ],
  }] });
  requireAvailable(result);
  expect(result.constraints[0]?.max_support_normal_displacement).toBe(0);
  expect(result.constraints[0]?.max_support_plane_clearance).toBe(0.5);
  expect(result.constraints[0]?.slip_correction_hypothesis)
    .toMatchObject({ state: "blocked", blocker: "CONTACT_PLANE_CLEARANCE_EXCEEDED" });
});

test("legitimate on-plane stance preserves bounded slip correction candidate", () => {
  const result = analyzeAnimationContactEvidence({ constraints: [{
    id: "supported_marker",
    mode: "planted",
    tolerance: 0.1,
    sampling_window: { start: 0, end: 0.2, max_gap_seconds: 0.2 },
    support_plane: {
      axis: "Y", coordinate: 0, allowed_side: "POSITIVE", penetration_tolerance: 0,
    },
    samples: [
      { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
      { time: 0.2, marker: [0.3, 0.05, 0], target: [0.3, 0.05, 0] },
    ],
  }] });
  requireAvailable(result);
  expect(result.constraints[0]?.max_support_plane_clearance).toBe(0.05);
  expect(result.constraints[0]?.slip_correction_hypothesis)
    .toMatchObject({ state: "candidate", blocker: null });
});


test("duplicate contact identities fail closed for every colliding record", () => {
  const stable = (id: string) => ({
    id, mode: "planted" as const, tolerance: 0.1,
    support_plane: {
      axis: "Y" as const, coordinate: 0,
      allowed_side: "POSITIVE" as const, penetration_tolerance: 0,
    },
    sampling_window: { start: 0, end: 0.2, max_gap_seconds: 0.2 },
    samples: [
      { time: 0, marker: [0, 0, 0] as const, target: [0, 0, 0] as const },
      { time: 0.2, marker: [0.3, 0, 0] as const, target: [0.3, 0, 0] as const },
    ],
  });
  const result = analyzeAnimationContactEvidence({
    constraints: [stable("left_foot"), stable("left_foot"), stable("right_foot")],
  });
  requireAvailable(result);
  expect(result.invalid_constraint_count).toBe(2);
  expect(result.invalid_examples.map((item) => item.reason)).toEqual([
    "DUPLICATE_CONTACT_CONSTRAINT_ID",
    "DUPLICATE_CONTACT_CONSTRAINT_ID",
  ]);
  expect(result.constraints).toHaveLength(1);
  expect(result.constraints[0]?.id).toBe("right_foot");
  expect(result.constraints.some((item) => item.id === "left_foot")).toBe(false);
});

test("sub-microsecond contact timestamps cannot create false motion evidence", () => {
  const result = analyzeAnimationContactEvidence({
    constraints: [{
      id: "foot", mode: "planted", tolerance: 0.1,
      support_plane: {
        axis: "Y", coordinate: 0, allowed_side: "POSITIVE",
        penetration_tolerance: 0,
      },
      samples: [
        { time: 0, marker: [0, 0, 0], target: [0, 0, 0] },
        { time: 0.0000001, marker: [0.3, 0, 0], target: [0.3, 0, 0] },
        { time: 0.5, marker: [0.3, 0, 0], target: [0.3, 0, 0] },
      ],
    }],
  });
  requireAvailable(result);
  expect(result.invalid_constraint_count).toBe(1);
  expect(result.invalid_examples[0]?.reason).toBe("DUPLICATE_SAMPLE_TIMESTAMPS");
  expect(result.constraint_count).toBe(0);
  expect(result.pass_constraint_count).toBe(0);
});


test("sampled Locator trajectory is geometric evidence, not a foot-contact verdict", () => {
  const frames: ObservedAnimationLocatorFrame[] = [
    { project_uuid: "project-A", animation_uuid: "clip-A", time_seconds: 0, markers: [
      { locator_uuid: "marker-A", parent_group_uuid: "leg-A", world_position: [0, 1, 0] },
      { locator_uuid: "marker-B", parent_group_uuid: "arm-A", world_position: [3, 1, 0] },
    ] },
    { project_uuid: "project-A", animation_uuid: "clip-A", time_seconds: 0.5, markers: [
      { locator_uuid: "marker-B", parent_group_uuid: "arm-A", world_position: [3, 1, 0] },
      { locator_uuid: "marker-A", parent_group_uuid: "leg-A", world_position: [0.5, 1, 0] },
    ] },
    { project_uuid: "project-A", animation_uuid: "clip-A", time_seconds: 1, markers: [
      { locator_uuid: "marker-A", parent_group_uuid: "leg-A", world_position: [1, 1, 0] },
      { locator_uuid: "marker-B", parent_group_uuid: "arm-A", world_position: [3, 1, 0] },
    ] },
  ];
  const before = JSON.stringify(frames);
  const out = analyzeObservedAnimationLocatorTrajectories(frames);
  expect(out.state).toBe("available");
  if (out.state !== "available") throw new Error("Expected available trajectory.");
  expect(out.evaluated_locator_count).toBe(2);
  expect(out.trajectories).toMatchObject([
    { locator_uuid: "marker-A", parent_group_uuid: "leg-A",
      sample_count: 3, max_world_drift_from_start: 1,
      start_to_end_distance: 1, world_path_length: 1 },
    { locator_uuid: "marker-B", parent_group_uuid: "arm-A",
      sample_count: 3, max_world_drift_from_start: 0,
      start_to_end_distance: 0, world_path_length: 0 },
  ]);
  expect(out.contact_roles_assigned).toBe(false);
  expect(out.physical_contact_verified).toBe(false);
  expect(out.native_preview_restoration_attested).toBe(false);
  expect(out.ik_correction_authorized).toBe(false);
  expect(out.visual_verdict).toBe("not_evaluated");
  expect(JSON.stringify(frames)).toBe(before);
  expect(analyzeObservedAnimationLocatorTrajectories([...frames].reverse()))
    .toEqual(out);
});

test("world-space trajectory refuses inconsistent native marker coverage and project drift", () => {
  const good: ObservedAnimationLocatorFrame[] = [
    { project_uuid: "project", animation_uuid: "clip", time_seconds: 0,
      markers: [{ locator_uuid: "marker", parent_group_uuid: "leg",
        world_position: [0, 0, 0] }] },
    { project_uuid: "project", animation_uuid: "clip", time_seconds: 1,
      markers: [{ locator_uuid: "marker", parent_group_uuid: "leg",
        world_position: [1, 0, 0] }] },
  ];
  const cloned = () => JSON.parse(JSON.stringify(good)) as Array<{
    project_uuid: string; animation_uuid: string; time_seconds: number;
    markers: Array<{ locator_uuid: string; parent_group_uuid: string;
      world_position: [number, number, number] }>;
  }>;
  let frames = cloned();
  frames[1].markers = [];
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  frames = cloned();
  frames[1].project_uuid = "other";
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  frames = cloned();
  frames[1].markers[0].parent_group_uuid = "other";
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  frames = cloned();
  frames[1].markers[0].world_position = [Number.NaN, 0, 0];
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  frames = cloned();
  frames[1].time_seconds = 0;
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  frames = cloned();
  frames[1].markers.push({ ...frames[1].markers[0] });
  expect(analyzeObservedAnimationLocatorTrajectories(frames).state).toBe("unavailable");
  expect(analyzeObservedAnimationLocatorTrajectories(good.slice(0, 1)).state)
    .toBe("unavailable");
});


test("time-aligned Locator samples preserve mid-cycle movement and detach input objects", () => {
  const frames = [0, 0.5, 1].map((time_seconds, index) => ({
    project_uuid: "p", animation_uuid: "a", time_seconds,
    markers: [{ locator_uuid: "foot", parent_group_uuid: "leg",
      world_position: [index === 1 ? 2 : 0, 0, 0] as [number, number, number] }],
  }));
  const result = analyzeObservedAnimationLocatorTrajectories(frames);
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected available");
  expect(result.trajectories[0].start_to_end_distance).toBe(0);
  expect(result.trajectories[0].world_path_length).toBe(4);
  expect(result.trajectories[0].max_segment_speed).toBe(4);
  expect(result.trajectories[0].samples.map((item) => item.world_position[0]))
    .toEqual([0, 2, 0]);
  frames[1].markers[0].world_position[0] = 100;
  expect(result.trajectories[0].samples[1].world_position[0]).toBe(2);
  expect(result.physical_contact_verified).toBe(false);
});

test("nonfinite Locator displacement, invalid frames and tiny time gaps fail closed", () => {
  const frame = (time_seconds: number, x: number) => ({
    project_uuid: "p", animation_uuid: "a", time_seconds,
    markers: [{ locator_uuid: "foot", parent_group_uuid: "leg",
      world_position: [x, 0, 0] as [number, number, number] }],
  });
  expect(analyzeObservedAnimationLocatorTrajectories([frame(0,-1e308),frame(1,1e308)]))
    .toMatchObject({state:"unavailable",reason:"LOCATOR_TRAJECTORY_METRICS_NONFINITE"});
  expect(analyzeObservedAnimationLocatorTrajectories([frame(0,0),frame(1e-9,1)]))
    .toMatchObject({state:"unavailable",reason:"LOCATOR_TRAJECTORY_TIMES_NOT_DISTINCT"});
  expect(analyzeObservedAnimationLocatorTrajectories([frame(0,0),null as any]))
    .toMatchObject({state:"unavailable",reason:"LOCATOR_TRAJECTORY_FRAME_IDENTITY_OR_COVERAGE_CHANGED"});
});


function explicitContactIk(): ContactConstraintInput {
  const xs=[0,0.1,0.2];
  const v=(x:number,y:number,z:number)=>[x,y,z] as [number,number,number];
  return {
    id:"foot",mode:"planted",tolerance:0.05,
    sampling_window:{start:0,end:1,max_gap_seconds:0.5},
    support_plane:{axis:"Y",coordinate:0,allowed_side:"POSITIVE",penetration_tolerance:0},
    samples:xs.map((x,i)=>({time:i/2,marker:v(x,0,0),target:v(0,0,0)})),
    ik_chain:{
      project_uuid:"project",animation_uuid:"clip",locator_uuid:"foot-locator",
      joint_group_uuids:["hip","knee","ankle"],
      frames:xs.map((x,i)=>({time:i/2,joint_world_positions:[
        v(x,0.8,0),v(x,0.4,0.3),v(x,0,0),
      ]})),
    },
  };
}
function candidate(c:ContactConstraintInput) {
  const report=analyzeAnimationContactEvidence({constraints:[c]});
  requireAvailable(report);
  return report.constraints[0].ik_reachability_candidate;
}

test("declared planted contact yields reachable source-only FABRIK proposals",()=>{
  const c=explicitContactIk(),before=JSON.stringify(c);
  const result=candidate(c);
  expect(result?.state).toBe("SOURCE_ONLY_REACHABLE");
  if(!result||result.state!=="SOURCE_ONLY_REACHABLE")throw new Error("IK candidate missing");
  expect(result.frame_count).toBe(3);
  expect(result.max_residual_world).toBeLessThan(1e-3);
  expect(result.frames[2].correction_world).toEqual([-0.2,0,0]);
  expect(result.frames[2].solved_chain_world).toHaveLength(3);
  expect(result.native_ik_bake_authorized).toBe(false);
  expect(result.native_sampling_attested).toBe(false);
  expect(result.physical_contact_verified).toBe(false);
  expect(JSON.stringify(c)).toBe(before);
});

test("IK proposal refuses bone stretch, incomplete coverage, displaced Locator",()=>{
  const fresh=()=>JSON.parse(JSON.stringify(explicitContactIk())) as any;
  let input=fresh();
  input.ik_chain.frames[1].joint_world_positions[1]=[0.1,0.4,1.3];
  expect(candidate(input)).toMatchObject({state:"unavailable",reason:"CONTACT_IK_BONE_LENGTH_CHANGED"});
  input=fresh();input.ik_chain.frames.pop();
  expect(candidate(input)).toMatchObject({state:"unavailable",reason:"CONTACT_IK_SAMPLE_COVERAGE_INVALID"});
  input=fresh();input.ik_chain.frames[1].joint_world_positions[2]=[0.12,0,0];
  expect(candidate(input)).toMatchObject({state:"unavailable",reason:"CONTACT_IK_MARKER_JOINT_MISMATCH"});
});

test("IK proposal rejects a target beyond the unchanged chain reach",()=>{
  const input=JSON.parse(JSON.stringify(explicitContactIk())) as any;
  for(const f of input.ik_chain.frames) {
    f.joint_world_positions[0][1]=2;
    f.joint_world_positions[1][1]=1.5;
    f.joint_world_positions[1][2]=0;
  }
  expect(candidate(input)).toMatchObject({
    state:"unavailable",reason:"CONTACT_IK_UNREACHABLE",
    native_ik_bake_authorized:false,
  });
});

test("contact analysis without an IK chain remains unchanged; incomplete stance blocks IK",()=>{
  const c=explicitContactIk();
  delete c.ik_chain;
  expect(candidate(c)).toBeUndefined();
  const incomplete=explicitContactIk();
  incomplete.sampling_window={start:0,end:1,max_gap_seconds:0.1};
  expect(candidate(incomplete)).toMatchObject({
    state:"unavailable",reason:"CONTACT_IK_NO_ELIGIBLE_PLANTED_SLIP",
  });
});

function observedJointPreview(): ObservedAnimationJointOriginFrame[] {
  return [0, 0.5, 1].map((time_seconds, i) => ({
    project_uuid: "proj", animation_uuid: "clip", time_seconds,
    groups: [
      { group_uuid: "ankle", parent_group_uuid: "knee",
        world_position: [i * 0.1, 0, 0] },
      { group_uuid: "hip", parent_group_uuid: null,
        world_position: [0, 0.8, 0] },
      { group_uuid: "knee", parent_group_uuid: "hip",
        world_position: [i * 0.05, 0.4, 0.2] },
    ],
  }));
}

test("joint world origins retain exact source UUID ancestry and time-aligned world positions", () => {
  const source = observedJointPreview();
  const before = JSON.stringify(source);
  const review = analyzeObservedAnimationJointOriginFrames(source);
  expect(review.state).toBe("SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS");
  if (review.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    throw new Error("Expected bounded preview joint origins");
  }
  expect(review.observed_frame_count).toBe(3);
  expect(review.observed_group_count).toBe(3);
  expect(review.frames.map((frame) => frame.time_seconds)).toEqual([0, 0.5, 1]);
  expect(review.frames[2].groups.map((group) => group.group_uuid))
    .toEqual(["ankle", "hip", "knee"]);
  expect(review.frames[2].groups[0].world_position).toEqual([0.2, 0, 0]);
  expect(review.native_ik_bake_authorized).toBe(false);
  expect(review.native_preview_restoration_attested).toBe(false);
  expect(review.pose_time_synchronization_attested).toBe(false);
  expect(review.contact_roles_inferred).toBe(false);
  expect(JSON.stringify(source)).toBe(before);
  expect(analyzeObservedAnimationJointOriginFrames([...source].reverse()))
    .toEqual(review);
});

test("joint preview rejects parent changes, missing ancestors, duplicate UUIDs and invalid world origins", () => {
  const cloned = () => JSON.parse(JSON.stringify(observedJointPreview())) as any;
  let x = cloned();
  x[1].groups[1].parent_group_uuid = "other";
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_HIERARCHY_CHANGED",
  });
  x = cloned();
  x[0].groups[1].parent_group_uuid = "other";
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_ANCESTRY_INCOMPLETE",
  });
  x = cloned();
  x[1].groups.pop();
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_FRAME_IDENTITY_OR_COVERAGE_CHANGED",
  });
  x = cloned();
  x[1].groups[1].group_uuid = "ankle";
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_GROUP_INVALID_OR_DUPLICATE",
  });
  x = cloned();
  x[1].groups[0].world_position[1] = Number.NaN;
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_GROUP_INVALID_OR_DUPLICATE",
  });
  x = cloned();
  x[1].time_seconds = 1e-9;
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_TIME_GRID_INVALID",
  });
  x = cloned();
  x[1] = null;
  expect(analyzeObservedAnimationJointOriginFrames(x)).toMatchObject({
    state: "unavailable", reason: "ANIMATION_JOINT_FRAME_SELECTION_INVALID",
  });
});

test("joint preview copies source coordinates and never invents IK-keyframe authority", () => {
  const source = observedJointPreview();
  const review = analyzeObservedAnimationJointOriginFrames(source);
  expect(review.state).toBe("SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS");
  if (review.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    throw new Error("Expected joint origins");
  }
  // The fixture type exposes readonly world coordinates; this deliberately
  // mutates its backing array to verify returned snapshots are detached.
  (source[0].groups[0].world_position as [number, number, number])[0] = 99;
  expect(review.frames[0].groups[0].world_position[0]).toBe(0);
  expect(review.native_ik_bake_authorized).toBe(false);
  expect(review.visual_verdict).toBe("not_evaluated");
});


function explicitPreviewContactFixture(): ExplicitPlantedPreviewIkInput {
  const contact = explicitContactIk();
  const chain = contact.ik_chain!;
  const locatorFrames: ObservedAnimationLocatorFrame[] = contact.samples.map((sample) => ({
    project_uuid: chain.project_uuid,
    animation_uuid: chain.animation_uuid,
    time_seconds: sample.time,
    markers: [{
      locator_uuid: chain.locator_uuid,
      parent_group_uuid: "ankle",
      world_position: sample.marker,
    }],
  }));
  const jointFrames: ObservedAnimationJointOriginFrame[] = chain.frames.map((frame) => ({
    project_uuid: chain.project_uuid,
    animation_uuid: chain.animation_uuid,
    time_seconds: frame.time,
    groups: chain.joint_group_uuids.map((uuid, index) => ({
      group_uuid: uuid,
      parent_group_uuid: index === 0 ? null : chain.joint_group_uuids[index-1],
      world_position: frame.joint_world_positions[index],
    })),
  }));
  return {
    binding: {
      id: contact.id,
      role: "FOOT_PLANT",
      intent_authority: "DECLARED_USER_INTENT",
      evidence_ref: "declared:foot-stance",
      project_uuid: chain.project_uuid,
      animation_uuid: chain.animation_uuid,
      group_uuid: "ankle",
      locator_uuid: chain.locator_uuid,
    },
    locator_review: analyzeObservedAnimationLocatorTrajectories(locatorFrames),
    joint_review: analyzeObservedAnimationJointOriginFrames(jointFrames),
    joint_group_uuids: [...chain.joint_group_uuids],
    stance_window: contact.sampling_window!,
    support_plane: contact.support_plane!,
    tolerance: contact.tolerance,
    fixed_contact_world: [0, 0, 0],
  };
}

test("explicit preview observations feed the existing planted-contact FABRIK analyzer without native claims", () => {
  const input = explicitPreviewContactFixture(), before = JSON.stringify(input);
  const result = reviewExplicitPlantedContactIkFromPreview(input);
  expect(result.state).toBe("SOURCE_ONLY_PREVIEW_CONTACT_IK_REVIEW");
  if (result.state !== "SOURCE_ONLY_PREVIEW_CONTACT_IK_REVIEW") {
    throw new Error("Expected source-only stitched contact review");
  }
  expect(result.sampled_times).toEqual([0, 0.5, 1]);
  expect(result.stance_sample_count).toBe(3);
  expect(result.contact_evidence.planted_drift_violation).toBe(true);
  expect(result.contact_evidence.slip_correction_hypothesis.state).toBe("candidate");
  expect(result.contact_evidence.ik_reachability_candidate?.state)
    .toBe("SOURCE_ONLY_REACHABLE");
  expect(result.native_preview_restoration_attested).toBe(false);
  expect(result.native_pose_time_synchronization_attested).toBe(false);
  expect(result.native_ik_bake_authorized).toBe(false);
  expect(result.physical_contact_verified).toBe(false);
  expect(result.visual_verdict).toBe("not_evaluated");
  expect(JSON.stringify(input)).toBe(before);
});

test("explicit preview contact refuses invented foot roles and cross-project snapshots", () => {
  const fixture = explicitPreviewContactFixture();
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, binding: { ...fixture.binding, role: "HAND_GRIP" },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_EXPLICIT_FOOT_BINDING_REQUIRED",
  });
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, binding: { ...fixture.binding, animation_uuid: "other" },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_PROJECT_OR_SAMPLE_COHORT_MISMATCH",
  });
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, binding: { ...fixture.binding, locator_uuid: "unknown" },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_LOCATOR_PARENT_OR_SAMPLES_MISSING",
  });
});

test("explicit stance uses exact captured times and rejects gaps, shifted anchors and reversed chains", () => {
  const fixture = explicitPreviewContactFixture();
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, stance_window: { start: 0.1, end: 1, max_gap_seconds: 0.5 },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_STANCE_WINDOW_NOT_COVERED",
  });
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, stance_window: { start: 0, end: 1, max_gap_seconds: 0.25 },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_STANCE_WINDOW_NOT_COVERED",
  });
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, fixed_contact_world: [1, 0, 0],
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_FIXED_ANCHOR_DISAGREES",
  });
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, joint_group_uuids: ["ankle", "knee", "hip"],
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_JOINT_CHAIN_IDENTITY_INVALID",
  });
});

test("explicit stance can use a bounded subset without inventing intermediate preview frames", () => {
  const fixture = explicitPreviewContactFixture();
  const result = reviewExplicitPlantedContactIkFromPreview({
    ...fixture,
    stance_window: { start: 0.5, end: 1, max_gap_seconds: 0.5 },
    fixed_contact_world: [0.1, 0, 0],
  });
  expect(result.state).toBe("SOURCE_ONLY_PREVIEW_CONTACT_IK_REVIEW");
  if (result.state !== "SOURCE_ONLY_PREVIEW_CONTACT_IK_REVIEW") {
    throw new Error("Expected two-frame stance subset");
  }
  expect(result.sampled_times).toEqual([0.5, 1]);
  expect(result.contact_evidence.ik_reachability_candidate?.state)
    .toBe("SOURCE_ONLY_REACHABLE");
});

test("explicit preview review keeps incomplete and mismatched source cohorts unverified", () => {
  const fixture = explicitPreviewContactFixture();
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture,
    joint_review: analyzeObservedAnimationJointOriginFrames([]),
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_NATIVE_OBSERVATIONS_INCOMPLETE",
  });
  const joint = fixture.joint_review;
  if (joint.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    throw new Error("Expected source joint review fixture");
  }
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture,
    joint_review: { ...joint, frames: joint.frames.slice(1) },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_PROJECT_OR_SAMPLE_COHORT_MISMATCH",
  });
  const wrong = [...joint.frames];
  wrong[1] = { ...wrong[1], time_seconds: 0.6 };
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, joint_review: { ...joint, frames: wrong },
  })).toMatchObject({
    state: "UNVERIFIED", reason: "CONTACT_PREVIEW_JOINT_LOCATOR_CLOCK_MISMATCH",
  });
});

test("source preview does not label unreachable FABRIK as a valid IK proposal", () => {
  const fixture = explicitPreviewContactFixture();
  const source = fixture.joint_review;
  if (source.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    throw new Error("Expected valid joint fixture");
  }
  // All three frames remain anatomically length-consistent, but a root
  // displaced 2 units upward cannot reach the fixed contact target at x>0.
  const farJointFrames: ObservedAnimationJointOriginFrame[] = source.frames.map(
    (frame) => ({
      project_uuid: fixture.binding.project_uuid,
      animation_uuid: fixture.binding.animation_uuid,
      time_seconds: frame.time_seconds,
      groups: frame.groups.map((group) => ({
        group_uuid: group.group_uuid,
        parent_group_uuid: group.parent_group_uuid,
        world_position: group.group_uuid === "hip"
          ? [group.world_position[0], 2, 0]
          : group.group_uuid === "knee"
            ? [group.world_position[0], 1.5, 0]
            : [...group.world_position] as [number, number, number],
      })),
    })
  );
  const joint = analyzeObservedAnimationJointOriginFrames(farJointFrames);
  expect(joint.state).toBe("SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS");
  const result = reviewExplicitPlantedContactIkFromPreview({
    ...fixture,
    joint_review: joint,
  });
  expect(result).toMatchObject({
    state: "UNVERIFIED",
    reason: "CONTACT_PREVIEW_IK_PROPOSAL_UNAVAILABLE",
    ik_blocker: "CONTACT_IK_UNREACHABLE",
    native_ik_bake_authorized: false,
    physical_contact_verified: false,
  });
  if (result.state !== "UNVERIFIED") throw new Error("Unsafe source IK promotion");
  expect(result.contact_evidence.ik_reachability_candidate?.state)
    .toBe("unavailable");
});

test("source preview rejects a valid joint inventory whose ankle no longer meets Locator", () => {
  const fixture = explicitPreviewContactFixture();
  const joint = fixture.joint_review;
  if (joint.state !== "SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS") {
    throw new Error("Expected valid joint fixture");
  }
  const displaced: ObservedAnimationJointOriginFrame[] = joint.frames.map(
    (frame, index) => ({
      project_uuid: fixture.binding.project_uuid,
      animation_uuid: fixture.binding.animation_uuid,
      time_seconds: frame.time_seconds,
      groups: frame.groups.map((group) => ({
        group_uuid: group.group_uuid,
        parent_group_uuid: group.parent_group_uuid,
        world_position: group.group_uuid === "ankle" && index === 1
          ? [group.world_position[0] + 0.01, group.world_position[1],
            group.world_position[2]]
          : [...group.world_position] as [number, number, number],
      })),
    })
  );
  const sourceJoint = analyzeObservedAnimationJointOriginFrames(displaced);
  expect(sourceJoint.state).toBe("SOURCE_ONLY_CURRENT_PREVIEW_JOINT_ORIGINS");
  expect(reviewExplicitPlantedContactIkFromPreview({
    ...fixture, joint_review: sourceJoint,
  })).toMatchObject({
    state: "UNVERIFIED",
    reason: "CONTACT_PREVIEW_IK_PROPOSAL_UNAVAILABLE",
    ik_blocker: "CONTACT_IK_MARKER_JOINT_MISMATCH",
    native_ik_bake_authorized: false,
  });
});
