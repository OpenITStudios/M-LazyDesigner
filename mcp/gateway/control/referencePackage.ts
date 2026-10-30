import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  emptyReference,
  parseReferencePackage,
} from "./referenceParser";
import type { ControlReferenceProjection } from "./referenceTypes";
import {
  inspectReferenceImages,
  readReferenceImageEvidence,
  type DeliveredReferenceImage,
} from "./referenceImageEvidence";
import {
  planTextureTreatment,
  requireTextureTreatmentSeamPlanReady,
  type TextureTreatmentPlanInput,
} from "../../lib/texture/treatmentPlan";
import { fileMetadataSignature } from "./fileSignature";

export type {
  ControlProfile,
  ControlReferenceAssetKind,
  ControlReferenceProjection,
  ControlReferenceSemanticFacts,
  ControlReferenceStage,
  ControlReferenceStructuredFact,
} from "./referenceTypes";

export const REFERENCE_FACT_PAGE_SECTIONS = [
  "parts", "articulation", "materials", "animation_guidance", "constraints",
  "unknowns.blocking", "unknowns.non_blocking",
] as const;
export type ReferenceFactPageSection = typeof REFERENCE_FACT_PAGE_SECTIONS[number];

export type ReferenceFactPage = {
  section: ReferenceFactPageSection;
  reference_fingerprint: string;
  offset: number;
  limit: number;
  total_count: number;
  returned_count: number;
  has_more: boolean;
  items: unknown[];
};

/**
 * Explicit, read-only recovery of canonical REFERENCE.json facts that were
 * omitted from a bounded Control projection. Never silently truncate a page.
 * Client must pin the current Reference fingerprint before requesting data.
 */
export async function readReferenceFactPage(
  inputPath: string,
  request: {
    section: ReferenceFactPageSection;
    offset: number;
    limit: number;
    expectedFingerprint: string;
  }
): Promise<ReferenceFactPage> {
  const sourcePath = referencePath(inputPath);
  if (!sourcePath) throw new Error("REFERENCE_FACT_CONTEXT_REQUIRED: reference path missing.");
  if (!Number.isInteger(request.offset) || request.offset < 0 ||
      !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 24 ||
      !REFERENCE_FACT_PAGE_SECTIONS.includes(request.section)) {
    throw new Error("REFERENCE_FACT_PAGE_INVALID: section, offset or limit is invalid.");
  }
  // Retain the existing package size boundary. Reject, do not clip, oversize input.
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size > MAX_REFERENCE_PACKAGE_BYTES) {
    throw new Error("REFERENCE_FACT_SOURCE_INVALID: source is not a valid bounded file.");
  }
  const raw = await readFile(sourcePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_REFERENCE_PACKAGE_BYTES) {
    throw new Error("REFERENCE_FACT_SOURCE_INVALID: source grew during reading.");
  }
  const projection = parseReferencePackage(raw, sourcePath, dirname(sourcePath));
  if (!projection?.fingerprint) {
    throw new Error("REFERENCE_FACT_SOURCE_INVALID: canonical REFERENCE.json is malformed.");
  }
  if (projection.fingerprint !== request.expectedFingerprint) {
    throw new Error("REFERENCE_FACT_REVISION_CHANGED: reorient through status before retrieving more facts.");
  }
  const document = JSON.parse(raw) as Record<string, unknown>;
  const unknowns = document.unknowns && typeof document.unknowns === "object" &&
    !Array.isArray(document.unknowns)
      ? document.unknowns as Record<string, unknown> : {};
  const values = request.section === "unknowns.blocking" ? unknowns.blocking
    : request.section === "unknowns.non_blocking" ? unknowns.non_blocking
    : document[request.section];
  if (values !== undefined && !Array.isArray(values)) {
    throw new Error("REFERENCE_FACT_SOURCE_INVALID: section is not an array.");
  }
  const all = (values ?? []) as unknown[];
  if (request.offset > all.length) {
    throw new Error("REFERENCE_FACT_OFFSET_OUT_OF_RANGE: start at a valid source index.");
  }
  const items = all.slice(request.offset, request.offset + request.limit);
  // Byte ceiling covers raw nested values, not only entry count. A large item
  // fails explicitly; the client can narrow the request or read the source file.
  if (Buffer.byteLength(JSON.stringify(items), "utf8") > 16 * 1024) {
    throw new Error("REFERENCE_FACT_PAGE_TOO_LARGE: reduce limit or read the canonical source section directly.");
  }
  return {
    section: request.section,
    reference_fingerprint: projection.fingerprint,
    offset: request.offset,
    limit: request.limit,
    total_count: all.length,
    returned_count: items.length,
    has_more: request.offset + items.length < all.length,
    items,
  };
}

type CachedReference = {
  signature: string;
  projection: ControlReferenceProjection;
};

const MAX_REFERENCE_PACKAGE_BYTES = 1024 * 1024;
const cache = new Map<string, CachedReference>();

function referencePath(input?: string | null): string | null {
  if (!input) return null;
  return basename(input).toLowerCase() === "reference.json"
    ? input
    : join(input, "REFERENCE.json");
}

export async function readReferencePackageProjection(
  inputPath?: string | null
): Promise<ControlReferenceProjection> {
  const sourcePath = referencePath(inputPath);
  if (!sourcePath) {
    return emptyReference("REFERENCE_PATH_UNAVAILABLE");
  }

  try {
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size > MAX_REFERENCE_PACKAGE_BYTES) {
      return {
        ...emptyReference("REFERENCE_INVALID"),
        source_path: sourcePath,
        package_root: dirname(sourcePath),
      };
    }

    const signature = fileMetadataSignature(info);
    const cached = cache.get(sourcePath);
    if (cached?.signature === signature) {
      return inspectReferenceImages(cached.projection);
    }

    const raw = await readFile(sourcePath, "utf8");
    const projection = parseReferencePackage(
      raw,
      sourcePath,
      dirname(sourcePath)
    );

    if (!projection) {
      return {
        ...emptyReference("REFERENCE_INVALID"),
        source_path: sourcePath,
        package_root: dirname(sourcePath),
      };
    }

    cache.set(sourcePath, { signature, projection });
    return inspectReferenceImages(projection);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return {
      ...emptyReference(
        code === "ENOENT"
          ? "REFERENCE_NOT_FOUND"
          : "REFERENCE_UNREADABLE"
      ),
      source_path: sourcePath,
      package_root: dirname(sourcePath),
    };
  }
}


/**
 * The source-image reader rechecks the actual image bytes, but an independent
 * REFERENCE.json revision can still change while those awaited reads run.
 * Validate the whole post-read package fingerprint and every selected
 * image's stage/status/byte identity before accepting a source observation.
 *
 * This is an integrity guard for one bounded read window, not a lease on
 * the source filesystem and not user/reviewer approval.
 */
export function requireStableSeamReferenceImageRead(input: {
  initial: ControlReferenceProjection;
  final: ControlReferenceProjection;
  selected_ids: readonly string[];
  delivered: readonly Pick<
    DeliveredReferenceImage,
    "id" | "sha256" | "status" | "mime_type" | "bytes"
  >[];
}): void {
  const { initial, final, selected_ids, delivered } = input;
  if (!initial.available || !final.available ||
      !initial.fingerprint || initial.fingerprint !== final.fingerprint ||
      selected_ids.length === 0 || selected_ids.length > 4 ||
      new Set(selected_ids).size !== selected_ids.length ||
      delivered.length !== selected_ids.length) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_SOURCE_CHANGED: source package identity changed during image evidence readback."
    );
  }
  const deliveredMap = new Map(delivered.map(item => [item.id, item]));
  if (deliveredMap.size !== selected_ids.length) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_SOURCE_CHANGED: selected image identity became ambiguous."
    );
  }
  for (const id of selected_ids) {
    const before = initial.images.find(image => image.id === id);
    const after = final.images.find(image => image.id === id);
    const read = deliveredMap.get(id);
    if (!before || !after || !read ||
        before.integrity !== "VERIFIED" ||
        after.integrity !== "VERIFIED" ||
        before.status !== "APPROVED" ||
        after.status !== "APPROVED" ||
        !before.used_by.includes("TEXTURE") ||
        !after.used_by.includes("TEXTURE") ||
        before.sha256 !== after.sha256 ||
        before.sha256 !== read.sha256 ||
        before.media_type !== after.media_type ||
        before.media_type !== read.mime_type ||
        before.bytes !== after.bytes ||
        before.bytes !== read.bytes ||
        before.file !== after.file ||
        read.status !== "APPROVED") {
      throw new Error(
        "TEXTURE_SEAM_REFERENCE_SOURCE_CHANGED: selected source image identity, stage, byte evidence or declared review status changed."
      );
    }
  }
}

/**
 * Read-only bridge to the canonical Reference Package image owner.
 *
 * This verifies actual on-disk source image SHA-256, current Reference Package
 * fingerprint, declared TEXTURE stage relevance and package-declared review
 * status for *exact* seam-reference observations. It does NOT authenticate a
 * user/reviewer, inspect what the image depicts, or approve a Cube seam.
 *
 * No binary source image enters the returned metadata or AI/Gateway context.
 * The handoff remains unregistered and cannot activate native seam sampling.
 */
export async function inspectTextureSeamReferenceImageIdentity(input: {
  reference_package_path: string;
  expected_reference_fingerprint: string;
  treatment_plan: Parameters<typeof requireTextureTreatmentSeamPlanReady>[0];
}) {
  const { treatment_plan: plan } = input;
  requireTextureTreatmentSeamPlanReady(plan);
  // The plan is already bounded to <=32 paired edges by the canonical
  // treatment owner; do not retrieve unrelated or unreferenced images.
  const observations = plan.seam_pairs.flatMap(pair =>
    pair.reference_observation ? [pair.reference_observation] : []
  );
  if (!observations.length) {
    return {
      source: "reference_package_image_readback" as const,
      state: "not_evaluated" as const,
      reference_fingerprint: null,
      observed_pair_count: 0,
      images: [],
      assertion_provenance: "CALLER_DECLARATION_UNVERIFIED" as const,
      source_image_bytes_matched: false as const,
      material_approval_attested: false as const,
      observation_visibility_attested: false as const,
      scene_coverage_attested: false as const,
      visual_verdict: "not_evaluated" as const,
    };
  }
  if (typeof input.expected_reference_fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expected_reference_fingerprint)) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_FINGERPRINT_REQUIRED: pin the current Control Reference Package fingerprint."
    );
  }
  const ids = [...new Set(observations.map(row => row.reference_id))].sort();
  if (ids.length > 4) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_IMAGE_BUDGET: no more than four declared current-stage reference images per evidence read."
    );
  }
  for (const observation of observations) {
    if (!/^sha256:[0-9a-f]{64}$/.test(observation.reference_revision)) {
      throw new Error(
        "TEXTURE_SEAM_REFERENCE_REVISION_INVALID: source readback requires a decoded package image SHA-256 token."
      );
    }
  }

  // Reuse Control's source security: package-relative path, symlink, size,
  // MIME-signature and full source-byte content hashing. This recalculates
  // actual image hashes even if REFERENCE.json itself was cacheable.
  const current = await readReferencePackageProjection(
    input.reference_package_path
  );
  if (!current.available || !current.fingerprint) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_SOURCE_UNAVAILABLE: current Reference Package cannot attest image identity."
    );
  }
  if (current.fingerprint !== input.expected_reference_fingerprint) {
    throw new Error(
      "TEXTURE_SEAM_REFERENCE_SOURCE_CHANGED: the Reference Package or image bytes changed since the caller observed it."
    );
  }
  for (const id of ids) {
    const declared = current.images.find(image => image.id === id);
    if (!declared || declared.integrity !== "VERIFIED" ||
        !declared.used_by.includes("TEXTURE")) {
      throw new Error(
        "TEXTURE_SEAM_REFERENCE_IMAGE_SCOPE: a declared source image is missing, invalid or not a TEXTURE reference."
      );
    }
    if (declared.status !== "APPROVED") {
      // APPROVED is a field in REFERENCE.json, not an independently
      // authenticated user's review action.
      throw new Error(
        "TEXTURE_SEAM_REFERENCE_PACKAGE_NOT_APPROVED: the selected image is not marked APPROVED in the current package."
      );
    }
  }

  // The existing Control reader checks the package-declared content SHA
  // against a fresh second read. A file replaced while this request runs
  // is therefore never silently accepted.
  const evidence = await readReferenceImageEvidence(current, ids);
  const byId = new Map(evidence.map(image => [image.id, image]));
  for (const observation of observations) {
    const image = byId.get(observation.reference_id);
    if (!image ||
        observation.reference_revision !== "sha256:" + image.sha256) {
      throw new Error(
        "TEXTURE_SEAM_REFERENCE_REVISION_CHANGED: the observed seam image revision differs from the actual Reference Package bytes."
      );
    }
  }

  // The image-bytes reader alone cannot detect a concurrent rewrite of
  // REFERENCE.json metadata after the first projection. Re-pin the complete
  // manifest + image fingerprint and every selected source image after all
  // asynchronous image reads have resolved.
  const final = await readReferencePackageProjection(input.reference_package_path);
  requireStableSeamReferenceImageRead({
    initial: current,
    final,
    selected_ids: ids,
    delivered: evidence,
  });

  return {
    source: "reference_package_image_readback" as const,
    state: "source_image_bytes_matched" as const,
    reference_fingerprint: current.fingerprint,
    observed_pair_count: observations.length,
    images: evidence.map(image => ({
      reference_id: image.id,
      source_image_sha256: image.sha256,
      media_type: image.mime_type,
      byte_length: image.bytes,
      // Status is package-declared only; it never proves user approval.
      package_declared_status: image.status,
    })),
    assertion_provenance: "REFERENCE_PACKAGE_DECLARED_UNAUTHENTICATED" as const,
    source_image_bytes_matched: true as const,
    material_approval_attested: false as const,
    observation_visibility_attested: false as const,
    scene_coverage_attested: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}


/**
 * Control-owned, on-demand reference source → Texture treatment caller.
 * An explicit author-proposed Cube/face mapping is checked against a fresh
 * canonical REFERENCE.json and actual image bytes. The source can attest
 * an image's identity, NOT whether its visible pixels depict that Cube face.
 *
 * Deliberately internal: no additional Gateway tool, model capture, image
 * payload, painting permission, UV change or user approval is produced.
 */
export async function inspectTextureTreatmentReferenceSurfaces(input: {
  reference_package_path: string;
  expected_reference_fingerprint: string;
  treatment_input: TextureTreatmentPlanInput;
}) {
  if (typeof input.expected_reference_fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expected_reference_fingerprint)) {
    throw new Error("TEXTURE_SURFACE_REFERENCE_FINGERPRINT_REQUIRED");
  }
  if (!input.treatment_input || input.treatment_input.reference_context !== undefined) {
    // The caller may declare FACE↔REGION correspondence, not supply its own
    // purportedly verified Control source. This function owns that read.
    throw new Error("TEXTURE_SURFACE_REFERENCE_CONTEXT_UNTRUSTED");
  }
  // Snapshot author-proposed data before the first await; caller mutations
  // during image reads cannot retrospectively change the inspected intent.
  const intent = structuredClone(input.treatment_input);
  if (!Array.isArray(intent.regions) || intent.regions.length < 1 ||
      intent.regions.length > 32 || !Array.isArray(intent.required_faces) ||
      intent.required_faces.length < 1) {
    throw new Error("TEXTURE_SURFACE_REFERENCE_FACE_INVENTORY_REQUIRED");
  }
  const declarations = intent.regions.flatMap(region =>
    region.reference_surfaces ?? []
  );
  if (!declarations.length || declarations.length > 64) {
    throw new Error("TEXTURE_SURFACE_REFERENCE_CLAIMS_REQUIRED: 1..64 explicit claims.");
  }
  const ids = [...new Set(declarations.map(claim => claim?.image_id))].sort();
  if (!ids.length || ids.length > 4 || ids.some(id =>
      typeof id !== "string" || !id.trim() || id.length > 96)) {
    throw new Error("TEXTURE_SURFACE_REFERENCE_IMAGE_BUDGET: require 1..4 named images.");
  }
  const current = await readReferencePackageProjection(input.reference_package_path);
  if (!current.available || !current.fingerprint ||
      current.fingerprint !== input.expected_reference_fingerprint) {
    throw new Error("TEXTURE_SURFACE_REFERENCE_SOURCE_CHANGED");
  }
  // Select only explicitly requested, verified, package-APPROVED Texture
  // images. This is a manifest declaration, not authenticated human consent.
  const selected = ids.map(id => {
    const image = current.images.find(row => row.id === id);
    if (!image || image.integrity !== "VERIFIED" ||
        !image.sha256 || !/^[a-f0-9]{64}$/.test(image.sha256) ||
        !image.used_by.includes("TEXTURE")) {
      throw new Error("TEXTURE_SURFACE_REFERENCE_IMAGE_SCOPE");
    }
    if (image.status !== "APPROVED") {
      throw new Error("TEXTURE_SURFACE_REFERENCE_PACKAGE_NOT_APPROVED");
    }
    return {
      id: image.id,
      view: image.view ?? null,
      sha256: image.sha256,
      integrity: image.integrity,
      used_by: [...image.used_by],
      regions: image.regions ?? [],
    };
  });
  // The same canonical planner and its normal unresolved-reason vocabulary
  // own every semantic/part/face mismatch. No alternate style inference.
  const plan = planTextureTreatment({
    ...intent,
    reference_context: {
      fingerprint: current.fingerprint,
      images: selected,
    },
  });
  // Re-read selected raw image bytes and the complete manifest/image identity
  // using the existing seam-source freshness guard. Never return PNG/base64.
  const delivered = await readReferenceImageEvidence(current, ids);
  const final = await readReferencePackageProjection(input.reference_package_path);
  requireStableSeamReferenceImageRead({
    initial: current, final, selected_ids: ids, delivered,
  });

  const consistent = plan.reference_surface_evidence.state === "claim_metadata_matched";
  return {
    source: "control_reference_package_texture_surfaces" as const,
    state: consistent && plan.readiness.state === "ready"
      ? ("source_identity_matched" as const)
      : ("review_required" as const),
    reference_fingerprint: current.fingerprint,
    selected_image_count: ids.length,
    source_image_bytes_matched: true as const,
    image_identity: delivered.map(image => ({
      image_id: image.id,
      image_sha256: image.sha256,
      package_declared_status: image.status,
    })),
    matched_claim_count: plan.reference_surface_evidence.matched_claim_count,
    declared_claim_count: plan.reference_surface_evidence.declared_claim_count,
    assertion_provenance: "SOURCE_BYTES_CHECKED_CALLER_FACE_MAPPING_UNVERIFIED" as const,
    native_face_correspondence_attested: false as const,
    human_approval_attested: false as const,
    mutation_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
    treatment_plan: plan,
  };
}
