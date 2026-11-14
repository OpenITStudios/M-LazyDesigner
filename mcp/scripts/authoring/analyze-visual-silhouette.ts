import { dirname } from "node:path";
import { compareBoundPngAlphaEvidence } from "../../lib/reference/pngAlphaEvidence";
import { MODEL_VIEWS, type ModelView } from "../../lib/reference/visualEvidence";
import {
  authoringPlanError, parseAuthoringPlanFlags, readAuthoringPlanJson,
  readBoundedSiblingPng, type ReadOnlyAuthoringCliResponse,
} from "./cliInput";

export const MAX_VISUAL_SILHOUETTE_MANIFEST_BYTES = 16_384;
export const MAX_VISUAL_SILHOUETTE_PNG_BYTES = 8 * 1024 * 1024;

type ReferenceDeclaration = {
  png_file: string;
  id: string;
  sha256: string;
  integrity: "VERIFIED" | "MISSING" | "INVALID";
  status: string | null;
  view: ModelView | null;
  mime_type: string;
};
type CaptureDeclaration = {
  png_file: string;
  project_uuid: string;
  evidence_handle: string;
  view: ModelView;
  image_sha256: string;
  width: number;
  height: number;
};
export type VisualSilhouetteInput = {
  schema: "lazydesigner-visual-silhouette-input-v1";
  reference: ReferenceDeclaration;
  capture: CaptureDeclaration;
  pairing: "UNVERIFIED" | "REVIEWED_SAME_FRAME";
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}
const HEX_SHA = /^[a-f0-9]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.png$/;
const HANDLE = /^modelcapture:[a-f0-9]{64}$/;
function declaredId(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= max && value.trim() === value;
}
function imageFile(value: unknown) {
  return typeof value === "string" && NAME.test(value) &&
    !value.includes("..");
}
function view(value: unknown): value is ModelView {
  return typeof value === "string" &&
    MODEL_VIEWS.some(known => known === value);
}

/**
 * Strict local-file manifest for the existing approved-source/capture
 * comparison. Metadata is caller-asserted, not native provenance.
 */
export function parseVisualSilhouetteInput(value: unknown): VisualSilhouetteInput {
  if (!record(value) ||
      !exactKeys(value, ["schema", "reference", "capture", "pairing"]) ||
      value.schema !== "lazydesigner-visual-silhouette-input-v1" ||
      (value.pairing !== "UNVERIFIED" &&
       value.pairing !== "REVIEWED_SAME_FRAME")) {
    throw new Error("VISUAL_SILHOUETTE_MANIFEST_INVALID");
  }
  const reference = value.reference;
  if (!record(reference) ||
      !exactKeys(reference, [
        "png_file", "id", "sha256", "integrity",
        "status", "view", "mime_type",
      ]) ||
      !imageFile(reference.png_file) ||
      !declaredId(reference.id) ||
      typeof reference.sha256 !== "string" ||
      !HEX_SHA.test(reference.sha256) ||
      !["VERIFIED", "MISSING", "INVALID"].includes(
        reference.integrity as string
      ) ||
      (reference.status !== null &&
       (typeof reference.status !== "string" ||
        reference.status.length > 64)) ||
      (reference.view !== null && !view(reference.view)) ||
      typeof reference.mime_type !== "string" ||
      reference.mime_type.length < 1 ||
      reference.mime_type.length > 64) {
    throw new Error("VISUAL_SILHOUETTE_REFERENCE_INVALID");
  }
  const capture = value.capture;
  if (!record(capture) ||
      !exactKeys(capture, [
        "png_file", "project_uuid", "evidence_handle",
        "view", "image_sha256", "width", "height",
      ]) ||
      !imageFile(capture.png_file) ||
      !declaredId(capture.project_uuid) ||
      typeof capture.evidence_handle !== "string" ||
      !HANDLE.test(capture.evidence_handle) ||
      !view(capture.view) ||
      typeof capture.image_sha256 !== "string" ||
      !HEX_SHA.test(capture.image_sha256) ||
      typeof capture.width !== "number" ||
      typeof capture.height !== "number" ||
      !Number.isSafeInteger(capture.width) ||
      !Number.isSafeInteger(capture.height) ||
      capture.width < 1 || capture.height < 1 ||
      capture.width * capture.height > 1024 * 1024) {
    throw new Error("VISUAL_SILHOUETTE_CAPTURE_INVALID");
  }
  if (reference.png_file === capture.png_file) {
    throw new Error("VISUAL_SILHOUETTE_DISTINCT_IMAGES_REQUIRED");
  }
  return value as unknown as VisualSilhouetteInput;
}

/**
 * Uses the existing strict SHA-verified PNG+alpha comparator unchanged.
 * Even a diagnostic overlap is not camera calibration or artistic PASS.
 */
export function inspectVisualSilhouettePngs(
  input: VisualSilhouetteInput,
  referencePng: Uint8Array,
  capturePng: Uint8Array,
  inputSha256: string | null = null
) {
  const comparison = compareBoundPngAlphaEvidence({
    reference: {
      id: input.reference.id,
      sha256: input.reference.sha256,
      integrity: input.reference.integrity,
      status: input.reference.status,
      view: input.reference.view,
      mime_type: input.reference.mime_type,
    },
    capture: {
      project_uuid: input.capture.project_uuid,
      evidence_handle: input.capture.evidence_handle,
      view: input.capture.view,
      image_sha256: input.capture.image_sha256,
      width: input.capture.width,
      height: input.capture.height,
    },
    reference_png: referencePng,
    capture_png: capturePng,
    pairing: input.pairing,
  });
  return {
    schema: "lazydesigner-visual-silhouette-cli-v1" as const,
    input_sha256: inputSha256,
    proof_scope: "CALLER_SUPPLIED_APPROVED_REFERENCE_AND_MODEL_CAPTURE" as const,
    execution: "INSPECTION_NOT_MUTATION" as const,
    native_mutation: false as const,
    native_capture_origin_attested: false as const,
    reference_approval_attested: false as const,
    camera_alignment_attested: false as const,
    visual_verdict: "UNVERIFIED" as const,
    automatic_correction: false as const,
    comparison,
    next_action: comparison.state === "DIAGNOSTIC_ONLY"
      ? "REVIEW_DIAGNOSTIC_AND_FRESH_MATCHED_MODEL_VIEWS"
      : "OBTAIN_APPROVED_ALPHA_SOURCE_AND_VERIFIED_SAME_FRAME_CAPTURE",
  };
}

const HELP =
  "Usage: bun run analyze:visual-silhouette -- --input <visual.json> [--json]\n" +
  "Manifest: lazydesigner-visual-silhouette-input-v1.\n" +
  "Two sibling SHA-declared RGBA8 PNGs: approved reference and model capture.\n" +
  "Only explicit REVIEWED_SAME_FRAME pairing can yield diagnostic overlap.\n" +
  "The comparison does not attest camera alignment, native source or visual PASS.\n";

export async function runVisualSilhouetteCli(
  argv: readonly string[]
): Promise<ReadOnlyAuthoringCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(
      argv, "VISUAL_SILHOUETTE"
    );
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "VISUAL_SILHOUETTE",
      MAX_VISUAL_SILHOUETTE_MANIFEST_BYTES
    );
    const input = parseVisualSilhouetteInput(value);
    const folder = dirname(inputPath!);
    const [reference, capture] = await Promise.all([
      readBoundedSiblingPng(
        folder, input.reference.png_file, "VISUAL_SILHOUETTE",
        MAX_VISUAL_SILHOUETTE_PNG_BYTES
      ),
      readBoundedSiblingPng(
        folder, input.capture.png_file, "VISUAL_SILHOUETTE",
        MAX_VISUAL_SILHOUETTE_PNG_BYTES
      ),
    ]);
    const report = inspectVisualSilhouettePngs(
      input, reference, capture, sha256
    );
    if (json) return {
      exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "",
    };
    return {
      exitCode: 0, stderr: "",
      stdout: [
        "Visual silhouette diagnosis (read-only, not visual PASS)",
        "Comparison: " + report.comparison.state,
        "Reason: " + (report.comparison.reason ?? "none"),
        "Visual verdict: UNVERIFIED",
        "Next: " + report.next_action,
      ].join("\n") + "\n",
    };
  } catch (error) {
    return {
      exitCode: 2, stdout: "",
      stderr: authoringPlanError(
        error, "VISUAL_SILHOUETTE_CLI_INVALID"
      ),
    };
  }
}
if (import.meta.main) {
  const result = await runVisualSilhouetteCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
