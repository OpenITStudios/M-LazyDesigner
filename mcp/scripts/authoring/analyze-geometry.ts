import {
  analyzeProjectedEnvelopeFidelity,
  analyzeRigGraph,
  summarizeSurfaceQualityWarnings,
  type RigGroupInput,
} from "../../lib/geometry/modelQuality";
import {
  parseAuthoringPlanFlags,
  readAuthoringPlanJson,
  authoringPlanError,
  type ReadOnlyAuthoringCliResponse,
} from "./cliInput";

export const MAX_GEOMETRY_TRIAGE_INPUT_BYTES = 262_144;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A bounded numeric inspection, not a silhouette/visual or native PASS. */
export function prepareGeometryTriageReport(
  input: unknown,
  inputSha256: string | null = null
) {
  if (!object(input)) throw new Error("GEOMETRY_TRIAGE_INPUT_INVALID");
  const boundsProvided = "model_bounds" in input ||
    "reference_bounds" in input;
  const groupsProvided = "rig_groups" in input;
  const warningsProvided = "surface_warnings" in input;
  if (!boundsProvided && !groupsProvided && !warningsProvided) {
    throw new Error("GEOMETRY_TRIAGE_INPUT_EMPTY");
  }
  if (groupsProvided && (!Array.isArray(input.rig_groups) ||
      input.rig_groups.length > 512 ||
      input.rig_groups.some(group => !object(group) ||
        typeof group.uuid !== "string" ||
        typeof group.name !== "string" ||
        !Array.isArray(group.origin)))) {
    throw new Error("GEOMETRY_TRIAGE_RIG_INPUT_INVALID");
  }
  if (warningsProvided && (!Array.isArray(input.surface_warnings) ||
      input.surface_warnings.length > 2048 ||
      input.surface_warnings.some(item =>
        typeof item !== "string" || item.length > 512))) {
    throw new Error("GEOMETRY_TRIAGE_SURFACE_INPUT_INVALID");
  }
  const validBounds = (value: unknown): value is {
    min: readonly number[]; max: readonly number[];
  } | null => value === null ||
    object(value) && Array.isArray(value.min) &&
    Array.isArray(value.max);
  if (boundsProvided && (!validBounds(input.model_bounds ?? null) ||
      !validBounds(input.reference_bounds ?? null))) {
    throw new Error("GEOMETRY_TRIAGE_BOUNDS_INPUT_INVALID");
  }
  // Only the canonical geometry owner interprets supplied numeric facts.
  const envelope = boundsProvided
    ? analyzeProjectedEnvelopeFidelity({
        model_bounds: (input.model_bounds ?? null) as {
          min: readonly number[]; max: readonly number[];
        } | null,
        reference_bounds: (input.reference_bounds ?? null) as {
          min: readonly number[]; max: readonly number[];
        } | null,
      })
    : null;
  const rig = groupsProvided
    ? analyzeRigGraph(input.rig_groups as RigGroupInput[])
    : null;
  const surface = warningsProvided
    ? summarizeSurfaceQualityWarnings(input.surface_warnings as string[])
    : null;
  const next_action = rig?.state === "invalid_graph"
    ? "RESOLVE_DECLARED_RIG_GRAPH_CONFLICTS"
    : surface?.state === "review_required"
      ? "REVIEW_NATIVE_SURFACE_FINDINGS_BEFORE_FORM_EXPANSION"
      : envelope?.state === "available"
        ? "COMPARE_APPROVED_SOURCE_WITH_CURRENT_NATIVE_MODEL_VIEWS"
        : "OBTAIN_MISSING_NATIVE_AND_REFERENCE_EVIDENCE";
  return {
    schema: "lazydesigner-geometry-triage-cli-v1" as const,
    input_sha256: inputSha256,
    proof_scope: "CALLER_DECLARATIONS_ONLY" as const,
    execution: "INSPECTION_NOT_MUTATION" as const,
    native_mutation: false as const,
    native_verified: false as const,
    visual_verdict: "UNVERIFIED" as const,
    user_approved: false as const,
    envelope,
    rig,
    surface,
    next_action,
  };
}

const HELP =
  "Usage: bun run analyze:geometry -- --input <geometry.json> [--json]\n" +
  "Optional keys: model_bounds, reference_bounds, rig_groups, surface_warnings.\n" +
  "Numeric/rig evidence only; no native or artistic PASS.\n";

export async function runGeometryTriageCli(
  argv: readonly string[]
): Promise<ReadOnlyAuthoringCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(
      argv, "GEOMETRY_TRIAGE"
    );
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "GEOMETRY_TRIAGE", MAX_GEOMETRY_TRIAGE_INPUT_BYTES
    );
    const report = prepareGeometryTriageReport(value, sha256);
    if (json) {
      return {
        exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout: [
        "Geometry triage (read-only, not native verification)",
        `Envelope: ${report.envelope?.state ?? "not_evaluated"}`,
        `Rig: ${report.rig?.state ?? "not_evaluated"}`,
        `Surface: ${report.surface?.state ?? "not_evaluated"}`,
        "Visual verdict: UNVERIFIED",
        `Next: ${report.next_action}`,
      ].join("\n") + "\n", stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 2, stdout: "",
      stderr: authoringPlanError(error, "GEOMETRY_TRIAGE_INVALID"),
    };
  }
}

if (import.meta.main) {
  const result = await runGeometryTriageCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
