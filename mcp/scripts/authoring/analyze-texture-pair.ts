import { dirname } from "node:path";
import { decodeVerifiedPngRgba } from "../../lib/reference/pngAlphaEvidence";
import { diffTextureRegion } from "../../lib/texture/regionDiff";
import { computeTextureRevision } from "../../lib/texture/revision";
import {
  authoringPlanError, parseAuthoringPlanFlags, readAuthoringPlanJson,
  readBoundedSiblingPng, type ReadOnlyAuthoringCliResponse,
} from "./cliInput";

export const TEXTURE_PAIR_MAX_MANIFEST_BYTES = 16_384;
export const TEXTURE_PAIR_MAX_PNG_BYTES = 8 * 1024 * 1024;
export const TEXTURE_PAIR_MAX_REGIONS = 32;

type PngEntry = {
  png_file: string;
  png_sha256: string;
  project_uuid: string;
  texture_uuid: string;
  full_rgba_revision?: string;
};
type Region = { x: number; y: number; width: number; height: number };
export type TexturePairInput = {
  schema: "lazydesigner-texture-pair-input-v1";
  mode: "REVISION" | "VARIANT";
  source: PngEntry;
  candidate: PngEntry;
  allowed_change_regions?: Region[];
  require_alpha_identity?: boolean;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.png$/;
const REVISION = /^sha256:[1-9]\d*x[1-9]\d*:[0-9a-f]{64}$/;

function readEntry(value: unknown): PngEntry {
  if (!object(value) || !exactKeys(value,
      ["png_file","png_sha256","project_uuid","texture_uuid","full_rgba_revision"]) ||
      typeof value.png_file !== "string" || !FILE.test(value.png_file) ||
      value.png_file.includes("..") ||
      typeof value.png_sha256 !== "string" || !SHA.test(value.png_sha256) ||
      typeof value.project_uuid !== "string" || !ID.test(value.project_uuid) ||
      typeof value.texture_uuid !== "string" || !ID.test(value.texture_uuid) ||
      (value.full_rgba_revision !== undefined &&
        (typeof value.full_rgba_revision !== "string" ||
         !REVISION.test(value.full_rgba_revision)))) {
    throw new Error("TEXTURE_PAIR_IMAGE_DECLARATION_INVALID");
  }
  return value as unknown as PngEntry;
}

export function parseTexturePairInput(value: unknown): TexturePairInput {
  if (!object(value) || !exactKeys(value,
      ["schema","mode","source","candidate","allowed_change_regions","require_alpha_identity"]) ||
      value.schema !== "lazydesigner-texture-pair-input-v1" ||
      (value.mode !== "REVISION" && value.mode !== "VARIANT") ||
      (value.require_alpha_identity !== undefined &&
        typeof value.require_alpha_identity !== "boolean")) {
    throw new Error("TEXTURE_PAIR_MANIFEST_INVALID");
  }
  const source = readEntry(value.source), candidate = readEntry(value.candidate);
  if (source.project_uuid !== candidate.project_uuid ||
      (value.mode === "REVISION"
        ? source.texture_uuid !== candidate.texture_uuid
        : source.texture_uuid === candidate.texture_uuid)) {
    throw new Error("TEXTURE_PAIR_DECLARED_IDENTITY_CONFLICT");
  }
  const regions = value.allowed_change_regions;
  if (regions !== undefined &&
      (!Array.isArray(regions) || regions.length > TEXTURE_PAIR_MAX_REGIONS ||
       regions.some(region => !object(region) ||
         !exactKeys(region, ["x","y","width","height"]) ||
         !["x","y","width","height"].every(key => {
           const number = region[key];
           return typeof number === "number" &&
             Number.isSafeInteger(number) &&
             (key === "x" || key === "y" ? number >= 0 : number > 0);
         })))) {
    throw new Error("TEXTURE_PAIR_REGIONS_INVALID");
  }
  return {
    schema: "lazydesigner-texture-pair-input-v1",
    mode: value.mode,
    source, candidate,
    ...(regions === undefined ? {} : { allowed_change_regions: regions as unknown as Region[] }),
    ...(value.require_alpha_identity === undefined ? {} :
      { require_alpha_identity: value.require_alpha_identity as boolean }),
  };
}

/** Reuse the common sibling PNG read contract without changing behavior. */
async function readPng(directory: string, entry: PngEntry): Promise<Uint8Array> {
  return readBoundedSiblingPng(directory, entry.png_file, "TEXTURE_PAIR",
    TEXTURE_PAIR_MAX_PNG_BYTES);
}

/** Inspect PNG bytes only; a client-side file cannot attest native provenance. */
export async function compareTexturePairBytes(
  input: TexturePairInput,
  sourceBytes: Uint8Array,
  candidateBytes: Uint8Array,
  inputSha256: string | null = null
) {
  const decode = async (entry: PngEntry, bytes: Uint8Array) => {
    const png = decodeVerifiedPngRgba({
      png_bytes: bytes, expected_sha256: entry.png_sha256,
    });
    if (png.state !== "AVAILABLE") {
      throw new Error("TEXTURE_PAIR_PNG_UNVERIFIED: " + png.reason);
    }
    const revision = await computeTextureRevision(
      new Uint8ClampedArray(png.rgba), png.width, png.height
    );
    if (entry.full_rgba_revision !== undefined &&
        entry.full_rgba_revision !== revision) {
      throw new Error("TEXTURE_PAIR_RGBA_REVISION_MISMATCH");
    }
    return { ...png, revision };
  };
  const [source, candidate] = await Promise.all([
    decode(input.source, sourceBytes), decode(input.candidate, candidateBytes),
  ]);
  if (source.width !== candidate.width || source.height !== candidate.height) {
    throw new Error("TEXTURE_PAIR_BITMAP_DIMENSIONS_MISMATCH");
  }
  const width = source.width, height = source.height;
  const regions = input.allowed_change_regions;
  const allowed = regions === undefined ? null : new Uint8Array(width * height);
  for (const region of regions ?? []) {
    if (region.x + region.width > width || region.y + region.height > height) {
      throw new Error("TEXTURE_PAIR_REGION_OUT_OF_BOUNDS");
    }
    for (let y = region.y; y < region.y + region.height; y++) {
      allowed!.fill(1, y * width + region.x, y * width + region.x + region.width);
    }
  }
  const changed = diffTextureRegion(source.rgba, candidate.rgba, width, height);
  let outside = 0, alphaChanges = 0;
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4;
    const alphaChanged = source.rgba[offset + 3] !== candidate.rgba[offset + 3];
    if (alphaChanged) alphaChanges++;
    if (allowed && allowed[pixel] === 0 &&
        (source.rgba[offset] !== candidate.rgba[offset] ||
         source.rgba[offset + 1] !== candidate.rgba[offset + 1] ||
         source.rgba[offset + 2] !== candidate.rgba[offset + 2] ||
         alphaChanged)) outside++;
  }
  const scopeState = allowed === null ? "NOT_DECLARED" :
    outside > 0 ? "OUTSIDE_DECLARED_REGIONS" : "WITHIN_DECLARED_REGIONS";
  const alphaState = input.require_alpha_identity === true
    ? (alphaChanges ? "CHANGED_VIOLATION" : "UNCHANGED")
    : "NOT_REQUIRED";
  const reviewRequired = scopeState !== "WITHIN_DECLARED_REGIONS" ||
    alphaState === "CHANGED_VIOLATION";
  return {
    schema: "lazydesigner-texture-pair-report-v1" as const,
    input_sha256: inputSha256,
    mode: input.mode,
    proof_scope: "CALLER_SUPPLIED_PNG_AND_IDENTITY" as const,
    png_integrity: "SHA256_MATCHED" as const,
    source_rgba_revision: source.revision,
    candidate_rgba_revision: candidate.revision,
    revision_claims_matched: {
      source: input.source.full_rgba_revision !== undefined,
      candidate: input.candidate.full_rgba_revision !== undefined,
    },
    project_uuid_claim: input.source.project_uuid,
    texture_uuid_claims: {
      source: input.source.texture_uuid,
      candidate: input.candidate.texture_uuid,
    },
    bitmap: { width, height },
    changed_region: changed,
    change_scope: {
      state: scopeState,
      changed_outside_declared_regions: allowed === null ? null : outside,
      declared_region_count: regions?.length ?? null,
      declared_mask_authority: "CALLER_DECLARATION_UNVERIFIED" as const,
    },
    alpha: { changed_pixels: alphaChanges, state: alphaState },
    review_required: reviewRequired,
    native_origin_verified: false as const,
    current_project_binding_verified: false as const,
    visual_verdict: "UNVERIFIED" as const,
    automatic_correction: false as const,
    next_action: scopeState === "NOT_DECLARED"
      ? "DECLARE_CHANGE_SCOPE_OR_REVIEW_FRESH_NATIVE_MODEL_VIEWS"
      : reviewRequired
        ? "REVIEW_UNEXPECTED_PIXEL_CHANGES_AND_NATIVE_REVISIONS"
        : "COMPARE_WITH_FRESH_MATCHED_NATIVE_MODEL_VIEWS",
  };
}

const HELP =
  "Manifest schema: lazydesigner-texture-pair-input-v1.\n" +
  "Usage: bun run analyze:texture-pair -- --input <pair.json> [--json]\n" +
  "Place two SHA-256-declared, non-interlaced 8-bit RGBA PNG files beside pair.json.\n" +
  "REVISION compares one texture; VARIANT compares distinct texture UUIDs.\n" +
  "Optional allowed_change_regions and require_alpha_identity validate the change.\n" +
  "Digest and revision parity do not attest native origin or artistic PASS.\n";

export async function runTexturePairCli(
  argv: readonly string[]
): Promise<ReadOnlyAuthoringCliResponse> {
  try {
    const { inputPath, json, help } = parseAuthoringPlanFlags(argv, "TEXTURE_PAIR");
    if (help) return { exitCode: 0, stdout: HELP, stderr: "" };
    const { value, sha256 } = await readAuthoringPlanJson(
      inputPath!, "TEXTURE_PAIR", TEXTURE_PAIR_MAX_MANIFEST_BYTES
    );
    const manifest = parseTexturePairInput(value);
    const folder = dirname(inputPath!);
    const [sourceBytes, candidateBytes] = await Promise.all([
      readPng(folder, manifest.source), readPng(folder, manifest.candidate),
    ]);
    const report = await compareTexturePairBytes(
      manifest, sourceBytes, candidateBytes, sha256
    );
    if (json) return {
      exitCode: 0, stdout: JSON.stringify(report) + "\n", stderr: "",
    };
    return {
      exitCode: 0,
      stdout: [
        "Texture PNG pair (read-only, not native proof)",
        `Changed pixels: ${report.changed_region.changed_pixels}`,
        `Changed outside declared regions: ${report.change_scope.changed_outside_declared_regions ?? "UNVERIFIED"}`,
        `Alpha changes: ${report.alpha.changed_pixels}`,
        "Visual verdict: UNVERIFIED",
        `Next: ${report.next_action}`,
      ].join("\n") + "\n", stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 2, stdout: "",
      stderr: authoringPlanError(error, "TEXTURE_PAIR_ANALYSIS_INVALID"),
    };
  }
}

if (import.meta.main) {
  const result = await runTexturePairCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
