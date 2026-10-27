import { expect, test } from "bun:test";
import { analyzeAnimationContactEvidence } from "@/lib/animationContactEvidence";

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
