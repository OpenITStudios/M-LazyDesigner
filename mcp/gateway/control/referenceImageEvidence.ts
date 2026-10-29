import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { canonicalJson } from "../../lib/semantic/canonical";
import { extractVerifiedPngAlpha } from "../../lib/reference/pngAlphaEvidence";
import { analyzeReferenceCrossViewEvidence } from "../../lib/reference/crossViewEvidence";
import type { ControlReferenceProjection } from "./referenceTypes";

type ReferenceImage = ControlReferenceProjection["images"][number];

const MAX_REGISTERED_IMAGES = 32;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGE_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_DELIVERED_IMAGES = 4;
const MAX_DELIVERED_BYTES = 12 * 1024 * 1024;

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function mimeType(file: string, bytes: Buffer): ReferenceImage["media_type"] {
  const ext = extname(file).toLowerCase();
  if (ext === ".png" && bytes.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )) return "image/png";
  if ((ext === ".jpg" || ext === ".jpeg") &&
      bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (ext === ".webp" && bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("REFERENCE_IMAGE_FORMAT_INVALID");
}

/**
 * Only REFERENCE.json-declared package-relative files are readable.
 * Reject traversal, special files, symlinks and unexpected image formats.
 */
async function readImage(root: string, file: string): Promise<{
  bytes: Buffer;
  media_type: NonNullable<ReferenceImage["media_type"]>;
}> {
  if (!file || file.includes("\\") || file.includes("\0") ||
      isAbsolute(file) || /^[a-zA-Z]:/.test(file) ||
      file.includes("?") || file.includes("#")) {
    throw new Error("REFERENCE_IMAGE_PATH_UNSAFE");
  }
  const parts = file.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("REFERENCE_IMAGE_PATH_UNSAFE");
  }
  const rootReal = await realpath(root);
  let imagePath = rootReal;
  for (const part of parts) {
    imagePath = join(imagePath, part);
    const entry = await lstat(imagePath);
    if (entry.isSymbolicLink()) throw new Error("REFERENCE_IMAGE_SYMLINK");
  }
  const resolved = resolve(rootReal, ...parts);
  const delta = relative(rootReal, resolved);
  if (!delta || delta === ".." || delta.startsWith(".." + "/") ||
      delta.startsWith(".." + "\\")) {
    throw new Error("REFERENCE_IMAGE_PATH_UNSAFE");
  }
  const fileInfo = await lstat(resolved);
  if (!fileInfo.isFile() || fileInfo.size < 12 ||
      fileInfo.size > MAX_IMAGE_BYTES) {
    throw new Error("REFERENCE_IMAGE_SIZE_INVALID");
  }
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    if (!(await handle.stat()).isFile()) {
      throw new Error("REFERENCE_IMAGE_NOT_REGULAR");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("REFERENCE_IMAGE_SIZE_INVALID");
  }
  const type = mimeType(file, bytes);
  if (!type) throw new Error("REFERENCE_IMAGE_FORMAT_INVALID");
  return { bytes, media_type: type };
}

/**
 * Reuse canonical pure cross-view analysis on explicitly authored source facts.
 * Image SHA/status only bind source identity; they never prove visual agreement.
 */
function summarizeDeclaredCrossViewConstraints(
  images: readonly ReferenceImage[]
): ControlReferenceProjection["cross_view_evidence"] {
  const claimed = images.filter(image => (image.part_world_constraints?.length ?? 0) > 0);
  if (claimed.length === 0) return undefined;
  const unavailable = (reason: string): NonNullable<
    ControlReferenceProjection["cross_view_evidence"]
  > => ({
    state: "unavailable", readiness: null,
    comparable_dimension_count: null, attachment_comparison_count: null,
    conflict_count: null, conflict_examples: [],
    conflict_examples_truncated: false, reason,
    visual_verdict: "not_evaluated",
  });
  if (claimed.some(image => image.integrity !== "VERIFIED" ||
      image.status !== "APPROVED" || !image.sha256 || !image.view ||
      !image.used_by.includes("GEOMETRY"))) {
    return unavailable("SOURCE_VIEW_NOT_APPROVED_OR_VERIFIED");
  }
  const viewsByHash = new Map<string, string>();
  for (const image of claimed) {
    const previous = viewsByHash.get(image.sha256!);
    if (previous && previous !== image.view) {
      return unavailable("SOURCE_VIEW_IMAGE_IDENTITY_REUSED");
    }
    viewsByHash.set(image.sha256!, image.view!);
  }
  const result = analyzeReferenceCrossViewEvidence({
    observations: claimed.flatMap(image => image.part_world_constraints!.map(
      constraint => ({ ...constraint, view: image.view! })
    )),
    exampleLimit: 4,
  });
  if (result.state === "unavailable") {
    return unavailable("SEMANTIC_CONSTRAINT_" + result.reason);
  }
  return {
    state: "available", readiness: result.readiness,
    comparable_dimension_count: result.comparable_dimension_count,
    attachment_comparison_count: result.attachment_comparison_count,
    conflict_count: result.conflict_count,
    conflict_examples: result.conflict_examples,
    conflict_examples_truncated: result.conflict_examples_truncated,
    visual_verdict: "not_evaluated",
  };
}

/**
 * Bind the current image bytes to Control's existing reference projection.
 * Binary content never enters the normal status/context envelope or a cache.
 * Each package read recomputes the image hashes, including when REFERENCE.json
 * itself was served from the manifest-only cache.
 */
export async function inspectReferenceImages(
  projection: ControlReferenceProjection
): Promise<ControlReferenceProjection> {
  if (!projection.available || !projection.package_root || !projection.fingerprint) {
    return projection;
  }
  if (projection.images.length === 0) return projection;
  if (projection.images.length > MAX_REGISTERED_IMAGES ||
      new Set(projection.images.map((image) => image.id)).size !== projection.images.length) {
    return {
      ...projection,
      available: false,
      unavailable_reason: "REFERENCE_INVALID",
      readiness: { overall: "BLOCKED", geometry: "BLOCKED",
        texture: "BLOCKED", animation: "BLOCKED" },
      images: projection.images.map((image) => ({
        ...image, integrity: "INVALID" as const, sha256: null,
        bytes: null, media_type: null,
      })),
    };
  }
  let totalBytes = 0;
  const images: ReferenceImage[] = [];
  for (const image of projection.images) {
    try {
      const read = await readImage(projection.package_root, image.file);
      totalBytes += read.bytes.length;
      if (totalBytes > MAX_PACKAGE_IMAGE_BYTES) {
        throw new Error("REFERENCE_IMAGE_PACKAGE_BUDGET");
      }
      images.push({
        ...image,
        integrity: "VERIFIED",
        sha256: sha256(read.bytes),
        bytes: read.bytes.length,
        media_type: read.media_type,
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      images.push({
        ...image,
        integrity: code === "ENOENT" ? "MISSING" : "INVALID",
        sha256: null,
        bytes: null,
        media_type: null,
      });
    }
  }
  // Package integrity is a prerequisite to the declared stage readiness.
  // This is one Control-owned decision reused by stage projection and health.
  const broken = images.filter((image) => image.integrity !== "VERIFIED");
  const readiness = { ...projection.readiness };
  for (const image of broken) {
    if (image.used_by.includes("GEOMETRY")) readiness.geometry = "BLOCKED";
    if (image.used_by.includes("TEXTURE")) readiness.texture = "BLOCKED";
    if (image.used_by.includes("ANIMATION")) readiness.animation = "BLOCKED";
  }
  const crossView = summarizeDeclaredCrossViewConstraints(images);
  const crossViewBlocker = crossView?.state === "unavailable"
    ? "REFERENCE_CROSS_VIEW_UNAVAILABLE:" + crossView.reason
    : crossView?.readiness === "conflicting"
      ? "REFERENCE_CROSS_VIEW_CONFLICT"
      : null;
  if (crossViewBlocker) readiness.geometry = "BLOCKED";
  if ((broken.length || crossViewBlocker) && readiness.overall === "READY") {
    readiness.overall = "BLOCKED";
  }
  return {
    ...projection,
    images,
    readiness,
    ...(crossView ? { cross_view_evidence: crossView } : {}),
    blocking_unknowns: [
      ...new Set([
        ...projection.blocking_unknowns,
        ...broken.map((image) => "REFERENCE_IMAGE_" + image.integrity + ":" + image.id),
        ...(crossViewBlocker ? [crossViewBlocker] : []),
      ]),
    ],
    fingerprint: createHash("sha256").update(canonicalJson({
      manifest: projection.fingerprint,
      image_content: images.map((image) => ({
        id: image.id, integrity: image.integrity, sha256: image.sha256,
      })),
    })).digest("hex"),
  };
}

export type DeliveredReferenceImage = {
  id: string;
  view: ReferenceImage["view"];
  status: string | null;
  landmarks: NonNullable<ReferenceImage["landmarks"]>;
  regions: NonNullable<ReferenceImage["regions"]>;
  part_world_constraints?: NonNullable<ReferenceImage["part_world_constraints"]>;
  sha256: string;
  mime_type: NonNullable<ReferenceImage["media_type"]>;
  bytes: number;
  data: string;
};

/** On-demand image delivery for an explicit subset of active-stage image IDs. */
export async function readReferenceImageEvidence(
  projection: ControlReferenceProjection,
  ids: readonly string[]
): Promise<DeliveredReferenceImage[]> {
  if (!projection.available || !projection.package_root ||
      ids.length < 1 || ids.length > MAX_DELIVERED_IMAGES ||
      new Set(ids).size !== ids.length) {
    throw new Error("REFERENCE_IMAGE_SELECTION_INVALID");
  }
  const output: DeliveredReferenceImage[] = [];
  let totalBytes = 0;
  for (const id of ids) {
    const image = projection.images.find((row) => row.id === id);
    if (!image || image.integrity !== "VERIFIED" || !image.sha256) {
      throw new Error("REFERENCE_IMAGE_UNAVAILABLE: " + id);
    }
    const read = await readImage(projection.package_root, image.file);
    if (sha256(read.bytes) !== image.sha256 || read.media_type !== image.media_type) {
      throw new Error("REFERENCE_IMAGE_CHANGED: " + id);
    }
    totalBytes += read.bytes.length;
    if (totalBytes > MAX_DELIVERED_BYTES) {
      throw new Error("REFERENCE_IMAGE_DELIVERY_BUDGET");
    }
    output.push({
      id,
      view: image.view ?? null,
      status: image.status,
      landmarks: image.landmarks ?? [],
      regions: image.regions ?? [],
      ...(image.part_world_constraints
        ? { part_world_constraints: image.part_world_constraints }
        : {}),
      sha256: image.sha256,
      mime_type: read.media_type,
      bytes: read.bytes.length,
      data: read.bytes.toString("base64"),
    });
  }
  return output;
}

/**
 * On-demand, bounded alpha diagnostics for the existing Control image
 * delivery path. No opaque-background segmentation, no model comparison,
 * and no bulk mask payload in AI context.
 */
export function summarizeReferenceAlphaSilhouette(image: DeliveredReferenceImage) {
  const common = {
    source_image_sha256: image.sha256,
    visual_verdict: "NOT_EVALUATED" as const,
    model_comparison_performed: false as const,
    approval_authority: "REFERENCE_PACKAGE_DECLARED" as const,
  };
  const unavailable = (reason: string) => ({
    ...common, state: "UNVERIFIED" as const,
    reason, foreground_pixels: null, frame: null,
  });
  if (image.status !== "APPROVED" || image.mime_type !== "image/png" || !image.view) {
    return unavailable("APPROVED_SINGLE_VIEW_PNG_REQUIRED");
  }
  const proof = extractVerifiedPngAlpha({
    png_bytes: Buffer.from(image.data, "base64"),
    expected_sha256: image.sha256,
    view: image.view,
    provenance: "APPROVED_ALPHA",
  });
  if (proof.state !== "AVAILABLE") return unavailable(proof.reason);
  let foreground = 0;
  for (const bit of proof.mask.pixels) foreground += bit;
  return {
    ...common,
    state: "AVAILABLE" as const,
    reason: null,
    foreground_pixels: foreground,
    frame: { width: proof.mask.width, height: proof.mask.height },
  };
}
