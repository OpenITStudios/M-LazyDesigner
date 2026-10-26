import { describe, expect, test } from "bun:test";
import { selectLowestCostCorrection } from "@/lib/reference/correctionSolver";
import { deriveReferenceCorrectionVectors } from "@/lib/reference/correction";

const candidates = [
  { id: "resize", predicted_error: 0.2, mutation_cost: 0.1, risk: 0.3, patch: "resize" },
  { id: "translate", predicted_error: 0.4, mutation_cost: 0.1, risk: 0.2, patch: "translate" },
];

describe("correction candidate ranking safety", () => {
  test("ranks supported candidate estimates deterministically without claiming visual improvement", () => {
    const decision = selectLowestCostCorrection(candidates);
    expect(decision.selected.id).toBe("resize");
    expect(decision.rejected_ids).toEqual(["translate"]);
    expect(Number.isFinite(decision.score)).toBe(true);
  });

  test("duplicate or malformed candidates cannot silently bias the selected correction", () => {
    expect(() => selectLowestCostCorrection([candidates[0]!, candidates[0]!])).toThrow("unique");
    expect(() => selectLowestCostCorrection([{ ...candidates[0]!, id: " resize " }])).toThrow("unique");
    expect(() => selectLowestCostCorrection([{ ...candidates[0]!, predicted_error: Number.NaN }])).toThrow("finite");
  });

  test("overflow and meaningless weights never produce an apparently valid correction score", () => {
    expect(() => selectLowestCostCorrection([{ ...candidates[0]!, predicted_error: Number.MAX_VALUE }], {
      error_weight: Number.MAX_VALUE,
    })).toThrow("overflowed");
    expect(() => selectLowestCostCorrection(candidates, {
      error_weight: 0, mutation_weight: 0, risk_weight: 0,
    })).toThrow("nonzero weight");
  });

  test("reference differences reject overflow before emitting correction vectors", () => {
    const huge = Number.MAX_VALUE;
    expect(() => deriveReferenceCorrectionVectors([{
      kind: "BOUNDS", instance_id: "panel", axis: "X",
      expected: huge, actual: -huge,
    }])).toThrow("REFERENCE_CORRECTION_DELTA_NONFINITE");
    expect(() => deriveReferenceCorrectionVectors([{
      kind: "ROTATION", instance_id: "hinge", axis: "Y",
      expected_degrees: huge, actual_degrees: -huge,
    }])).toThrow("REFERENCE_CORRECTION_DELTA_NONFINITE");
    expect(() => deriveReferenceCorrectionVectors([{
      kind: "CENTER_OFFSET", instance_id: "seat",
      expected_center: [huge, 0, 0], actual_center: [-huge, 0, 0],
    }])).toThrow("REFERENCE_CORRECTION_DELTA_NONFINITE");
    expect(() => deriveReferenceCorrectionVectors([{
      kind: "CENTER_OFFSET", instance_id: "seat",
      expected_center: [1.5e308, 1.5e308, 1.5e308], actual_center: [0, 0, 0],
    }])).toThrow("REFERENCE_CORRECTION_DISTANCE_NONFINITE");

    const valid = deriveReferenceCorrectionVectors([
      { kind: "BOUNDS", instance_id: "seat", axis: "X",
        expected: 12, actual: 8, tolerance: 1 },
      { kind: "CENTER_OFFSET", instance_id: "seat",
        expected_center: [2, 1, 0], actual_center: [0, 0, 0] },
    ]);
    expect(valid).toEqual([
      { instance_id: "seat", operation: "RESIZE_AXIS", axis: "X", delta: 4 },
      { instance_id: "seat", operation: "TRANSLATE", delta: [2, 1, 0] },
    ]);
  });

  test("risk ceiling still excludes otherwise lower-error destructive candidates", () => {
    expect(selectLowestCostCorrection(candidates, { maximum_risk: 0.2 }).selected.id).toBe("translate");
  });
});
