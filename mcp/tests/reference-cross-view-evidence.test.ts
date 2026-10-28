import { expect, test } from "bun:test";
import { analyzeReferenceCrossViewEvidence } from "@/lib/referenceCrossViewEvidence";

test("cross-view semantic dimensions remain clean when shared world constraints agree", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10, y: 18 }, attachment_parent: null, required: true },
      { view: "side", part_id: "body", dimensions: { y: 18, z: 8 }, attachment_parent: null, required: true },
      { view: "top", part_id: "body", dimensions: { x: 10, z: 8 }, attachment_parent: null, required: true },
    ],
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.conflict_count).toBe(0);
  expect(result.readiness).toBe("consistent_with_available_constraints");
  expect(result.visual_verdict).toBe("not_evaluated");
});

test("cross-view world-dimension disagreement is explicit instead of averaged", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { y: 18 } },
      { view: "side", part_id: "body", dimensions: { y: 14 } },
    ],
    relativeTolerance: 0.08,
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.readiness).toBe("conflicting");
  expect(result.conflict_examples[0]).toMatchObject({ kind: "dimension_conflict", part_id: "body", axis: "y" });
});

test("attachment contradictions are reported but occlusion is never treated as absence", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "handle", attachment_parent: "body", required: true },
      { view: "rear", part_id: "handle", attachment_parent: "frame", required: true },
    ],
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.conflict_examples[0]).toMatchObject({ kind: "attachment_conflict", part_id: "handle" });
  expect(result.note).toContain("never treats occlusion as absence");
});

test("repeated claims from a single view cannot manufacture cross-view confidence", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10, y: 18 }, attachment_parent: null, required: true },
      { view: " FRONT ", part_id: " body ", dimensions: { x: 10, y: 18 }, attachment_parent: null },
    ],
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.observation_count).toBe(2);
  expect(result.part_count).toBe(1);
  expect(result.required_parts).toEqual(["body"]);
  expect(result.comparable_dimension_count).toBe(0);
  expect(result.attachment_comparison_count).toBe(0);
  expect(result.conflict_count).toBe(0);
  expect(result.readiness).toBe("insufficient_comparable_constraints");
});

test("contradictory same-view claims remain conflicts without posing as independent corroboration", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "handle", dimensions: { y: 18 }, attachment_parent: "body" },
      { view: "Front ", part_id: "handle", dimensions: { y: 14 }, attachment_parent: "frame" },
    ],
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.comparable_dimension_count).toBe(0);
  expect(result.attachment_comparison_count).toBe(0);
  expect(result.readiness).toBe("conflicting");
  expect(result.conflict_examples.map((issue) => issue.kind)).toEqual(["dimension_conflict", "attachment_conflict"]);
});

test("independent viewpoints count once even when one viewpoint is repeated", () => {
  const result = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10, y: 18 }, attachment_parent: null },
      { view: "FRONT", part_id: "body", dimensions: { x: 10, y: 18 }, attachment_parent: null },
      { view: "side", part_id: "body", dimensions: { y: 18, z: 8 }, attachment_parent: null },
    ],
  });
  expect(result.state).toBe("available");
  if (result.state !== "available") throw new Error("expected cross-view evidence");
  expect(result.comparable_dimension_count).toBe(1);
  expect(result.attachment_comparison_count).toBe(1);
  expect(result.readiness).toBe("consistent_with_available_constraints");
});

test("an explicitly invalid world dimension prevents false cross-view consistency", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const result = analyzeReferenceCrossViewEvidence({
      observations: [
        { view: "front", part_id: "body", dimensions: { x: 10, y: 18 }, required: true },
        { view: "side", part_id: "body", dimensions: { x: 10, y: bad } },
      ],
    });
    expect(result).toEqual({
      state: "unavailable",
      reason: "dimension_constraint_invalid",
    });
  }
});

test("legitimate planar zero spans are compared and disagreeing depth is a real conflict", () => {
  const flat = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "cutout", dimensions: { x: 8, z: 0 } },
      { view: "side", part_id: "cutout", dimensions: { z: 0 } },
    ],
  });
  expect(flat).toMatchObject({
    state: "available",
    readiness: "consistent_with_available_constraints",
    conflict_count: 0,
    comparable_dimension_count: 1,
    visual_verdict: "not_evaluated",
  });

  const contradiction = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "cutout", dimensions: { x: 8, z: 0 } },
      { view: "side", part_id: "cutout", dimensions: { x: 8, z: 3 } },
    ],
  });
  expect(contradiction).toMatchObject({
    state: "available",
    readiness: "conflicting",
    conflict_count: 1,
    conflict_examples: [{
      kind: "dimension_conflict", part_id: "cutout",
      axis: "z", relative_spread: 1,
    }],
  });
});

test("omitted axis stays optional while an explicitly unknown world-axis key fails closed", () => {
  const missing = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10 } },
      { view: "side", part_id: "body", dimensions: { x: 10, y: undefined } },
    ],
  });
  expect(missing).toMatchObject({
    state: "available",
    readiness: "consistent_with_available_constraints",
    comparable_dimension_count: 1,
    visual_verdict: "not_evaluated",
  });

  const invalid = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10 } },
      { view: "side", part_id: "body", dimensions: { x: 10, width: 15 } as never },
    ],
  });
  expect(invalid).toEqual({
    state: "unavailable",
    reason: "dimension_constraint_invalid",
  });
});

test("malformed Reference observation identity or attachment cannot become usable evidence", () => {
  const invalidParent = analyzeReferenceCrossViewEvidence({
    observations: [
      { view: "front", part_id: "body", dimensions: { x: 10 }, attachment_parent: 42 as unknown as string },
      { view: "side", part_id: "body", dimensions: { x: 10 }, attachment_parent: null },
    ],
  });
  expect(invalidParent).toEqual({
    state: "unavailable",
    reason: "observation_identity_invalid",
  });

  const invalidIdentity = analyzeReferenceCrossViewEvidence({
    observations: [{ view: null as unknown as string, part_id: "body" }],
  });
  expect(invalidIdentity.state).toBe("unavailable");

  const invalidCollection = analyzeReferenceCrossViewEvidence({
    observations: null as unknown as [],
  });
  expect(invalidCollection).toEqual({
    state: "unavailable",
    reason: "observations_invalid",
  });
});
