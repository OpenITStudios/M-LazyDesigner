export type ValidatorGateState =
  | "BLOCKED"
  | "REVIEW_REQUIRED"
  | "VALIDATOR_CLEAR";

export type ValidatorGateVerdict = {
  state: ValidatorGateState;
  blocking_errors: number;
  warnings: number;
  can_continue_technical_validation: boolean;
  approval_claim: false;
  visual_pass_claim: false;
  meaning: string;
};

/**
 * Conservative projection of Blockbench Validator counts.
 * Validator cleanliness is technical evidence only: it never implies user
 * approval, reference fidelity, visual acceptance, or phase-gate completion.
 */
export function deriveValidatorGateVerdict(
  errorCount: number,
  warningCount: number
): ValidatorGateVerdict {
  // Counts are expected from current native Validator arrays. Malformed
  // inputs cannot be interpreted as a clean technical gate: NaN and negative
  // counts would otherwise bypass both >0 branches and imply VALIDATOR_CLEAR.
  if (!Number.isSafeInteger(errorCount) || errorCount < 0 ||
      !Number.isSafeInteger(warningCount) || warningCount < 0) {
    throw new Error("VALIDATOR_COUNTS_INVALID: expected nonnegative safe integer counts.");
  }
  if (errorCount > 0) {
    return {
      state: "BLOCKED",
      blocking_errors: errorCount,
      warnings: warningCount,
      can_continue_technical_validation: false,
      approval_claim: false,
      visual_pass_claim: false,
      meaning: "Blockbench Validator has errors that must be resolved before claiming technical readiness.",
    };
  }

  if (warningCount > 0) {
    return {
      state: "REVIEW_REQUIRED",
      blocking_errors: 0,
      warnings: warningCount,
      can_continue_technical_validation: true,
      approval_claim: false,
      visual_pass_claim: false,
      meaning: "Validator has no errors but warnings still require review; this is not visual or user approval.",
    };
  }

  return {
    state: "VALIDATOR_CLEAR",
    blocking_errors: 0,
    warnings: 0,
    can_continue_technical_validation: true,
    approval_claim: false,
    visual_pass_claim: false,
    meaning: "Validator is clear. This is technical evidence only and does not imply reference fidelity, visual PASS, or user approval.",
  };
}
