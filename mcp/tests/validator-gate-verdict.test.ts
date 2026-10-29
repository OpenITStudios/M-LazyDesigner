import { describe, expect, test } from "bun:test";
import { deriveValidatorGateVerdict } from "@/lib/validationVerdict";

describe("Validator gate verdict", () => {
  test("errors block technical readiness", () => {
    const verdict = deriveValidatorGateVerdict(2, 3);
    expect(verdict.state).toBe("BLOCKED");
    expect(verdict.can_continue_technical_validation).toBe(false);
    expect(verdict.approval_claim).toBe(false);
    expect(verdict.visual_pass_claim).toBe(false);
  });

  test("warnings require review without pretending approval", () => {
    const verdict = deriveValidatorGateVerdict(0, 2);
    expect(verdict.state).toBe("REVIEW_REQUIRED");
    expect(verdict.can_continue_technical_validation).toBe(true);
    expect(verdict.approval_claim).toBe(false);
    expect(verdict.visual_pass_claim).toBe(false);
  });

  test("malformed Validator counts fail closed rather than claiming a clean gate", () => {
    for (const [errors, warnings] of [
      [Number.NaN, 0], [0, Number.NaN],
      [-1, 0], [0, -1],
      [Number.POSITIVE_INFINITY, 0], [0, Number.NEGATIVE_INFINITY],
      [1.5, 0], [0, 0.5], [Number.MAX_SAFE_INTEGER + 1, 0],
    ]) {
      expect(() => deriveValidatorGateVerdict(errors, warnings))
        .toThrow("VALIDATOR_COUNTS_INVALID");
    }
  });

  test("clean validator is technical evidence only", () => {
    const verdict = deriveValidatorGateVerdict(0, 0);
    expect(verdict.state).toBe("VALIDATOR_CLEAR");
    expect(verdict.can_continue_technical_validation).toBe(true);
    expect(verdict.approval_claim).toBe(false);
    expect(verdict.visual_pass_claim).toBe(false);
    expect(verdict.meaning).toContain("does not imply");
  });
});
