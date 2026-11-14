import {
  reviewBedrockAppearanceVariantContinuity,
  type AppearanceVariantContinuityInput,
} from "../../lib/texture/appearanceVariantContinuity";
import {
  parseAuthoringPlanFlags,
  readAuthoringPlanJson,
  authoringPlanError,
  type ReadOnlyAuthoringCliResponse,
} from "./cliInput";

/** The canonical appearance-variant owner validates the actual declaration. */
export const MAX_APPEARANCE_VARIANT_INPUT_BYTES = 262_144;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function prepareAppearanceVariantReport(
  input: unknown,
  inputSha256: string | null = null
) {
  if (!object(input) || !object(input.texture_create) ||
      !object(input.baseline) || !object(input.proposed) ||
      !object(input.render)) {
    throw new Error("APPEARANCE_VARIANT_INPUT_INVALID");
  }
  // No alternative algorithm: the canonical owner checks base atlas,
  // UV/rig, render bindings, geometry and material continuity.
  const review = reviewBedrockAppearanceVariantContinuity(
    input as unknown as AppearanceVariantContinuityInput
  );
  return {
    schema: "lazydesigner-appearance-variant-cli-v1" as const,
    input_sha256: inputSha256,
    proof_scope: "CALLER_DECLARATIONS_ONLY" as const,
    execution: "PLAN_NOT_APPLIED" as const,
    native_mutation: false as const,
    native_verified: false as const,
    visual_verdict: "UNVERIFIED" as const,
    user_approved: false as const,
    review,
    next_action: review.state === "BLOCKED_BY_DECLARED_CONTINUITY"
      ? "RESOLVE_DECLARED_VARIANT_CONTINUITY_ISSUES"
      : "VERIFY_NATIVE_SOURCE_RGBA_AND_MAPPED_MODEL_VIEWS_BEFORE_AUTHORING",
  };
}

const HELP =
  "Usage: bun run plan:appearance-variant -- --input <variant.json> [--json]\n" +
  "Read-only. Input is an AppearanceVariantContinuityInput JSON object.\n" +
  "No native changes, actual atlas-pixel equality or visual approval.\n";

export async function runAppearanceVariantCli(
  argv: readonly string[]
): Promise<ReadOnlyAuthoringCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(
      argv, "APPEARANCE_VARIANT"
    );
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "APPEARANCE_VARIANT", MAX_APPEARANCE_VARIANT_INPUT_BYTES
    );
    const report = prepareAppearanceVariantReport(value, sha256);
    if (json) return {
      exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "",
    };
    return {
      exitCode: 0,
      stdout: [
        "Appearance variant plan (read-only, not applied)",
        `Source declaration: ${report.review.state}`,
        `Continuity issues: ${report.review.issues.length}`,
        "Native/pixel/visual verdict: UNVERIFIED",
        `Next: ${report.next_action}`,
      ].join("\n") + "\n",
      stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: authoringPlanError(error, "APPEARANCE_VARIANT_PLAN_INVALID"),
    };
  }
}

if (import.meta.main) {
  const response = await runAppearanceVariantCli(process.argv.slice(2));
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exitCode = response.exitCode;
}
