import {
  parseAuthoringPlanFlags,
  readAuthoringPlanJson,
  authoringPlanError,
} from "./cliInput";
import {
  planTextureTreatment,
  type TextureTreatmentPlanInput,
} from "../../lib/texture/treatmentPlan";

/**
 * Read-only CLI facade over the existing canonical Texture treatment planner.
 * Neither output nor exit code can attest native edits or artistic quality.
 */
export const MAX_TREATMENT_PLAN_BYTES = 262_144;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function prepareTextureTreatmentReport(
  value: unknown,
  inputSha256: string | null = null
) {
  if (!record(value) || !Array.isArray(value.regions) ||
      value.regions.length === 0 || value.regions.length > 128) {
    throw new Error("TEXTURE_TREATMENT_INPUT_INVALID: require 1-128 regions.");
  }
  if (value.required_faces !== undefined &&
      (!Array.isArray(value.required_faces) ||
        value.required_faces.length > 4096)) {
    throw new Error("TEXTURE_TREATMENT_INPUT_INVALID: at most 4096 required faces.");
  }
  // The source owner validates exact face, material, reference and seam
  // semantics. Never mirror or weaken that contract in the CLI facade.
  const plan = planTextureTreatment(value as unknown as TextureTreatmentPlanInput);
  return {
    schema: "lazydesigner-texture-treatment-cli-v1" as const,
    input_sha256: inputSha256,
    proof_scope: "CALLER_DECLARATIONS_ONLY" as const,
    execution: "PLAN_NOT_APPLIED" as const,
    native_mutation: false as const,
    native_revision_verified: false as const,
    visual_verdict: "UNVERIFIED" as const,
    user_approved: false as const,
    planning_readiness: plan.readiness,
    next_action: plan.readiness.state === "ready"
      ? "REVIEW_APPROVED_REFERENCE_AND_CURRENT_NATIVE_MODEL_BEFORE_AUTHORING"
      : "RESOLVE_DECLARED_PLAN_BLOCKERS_BEFORE_AUTHORING",
    plan,
  };
}

export type TextureTreatmentCliResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const HELP =
  "Usage: bun run plan:texture-treatment -- --input <plan.json> [--json]\n" +
  "Read-only. Input is a TextureTreatmentPlanInput JSON object.\n" +
  "Planning READY is not native execution, visual PASS, or user approval.\n";

/** Produces output without printing or writing; useful for focused regressions. */
export async function runTextureTreatmentCli(
  argv: readonly string[]
): Promise<TextureTreatmentCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(
      argv, "TEXTURE_TREATMENT"
    );
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "TEXTURE_TREATMENT", MAX_TREATMENT_PLAN_BYTES
    );
    const report = prepareTextureTreatmentReport(value, sha256);
    if (json) {
      return { exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "" };
    }
    return {
      exitCode: 0,
      stdout: [
        "Texture treatment plan (read-only, not applied)",
        `Planning: ${report.planning_readiness.state} (${report.planning_readiness.scope})`,
        `Declared faces: ${report.plan.face_coverage.state}`,
        `Unresolved: ${report.planning_readiness.unresolved.length}`,
        "Artistic verdict: UNVERIFIED",
        `Next: ${report.next_action}`,
      ].join("\n") + "\n",
      stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 2, stdout: "",
      stderr: authoringPlanError(error, "TEXTURE_TREATMENT_PLAN_INVALID"),
    };
  }
}

if (import.meta.main) {
  const response = await runTextureTreatmentCli(process.argv.slice(2));
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exitCode = response.exitCode;
}
