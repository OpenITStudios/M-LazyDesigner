import type { CompactSemanticIdentity, SemanticIdentityResolution } from "@/lib/authoringRecipe/semanticIdentity";
import {
  parseReferenceImageRegions,
  summarizeReferencePartRegions,
  type ReferenceImageRegion,
  type ReferencePartRole,
} from "@/lib/reference/imageRegionEvidence";
import { MODEL_VIEWS, type ModelView } from "@/lib/reference/visualEvidence";

type CorrespondenceState = "SUPPORTED" | "PROVISIONAL" | "CONFLICTING" | "UNAVAILABLE";
type RegionRole = ReferenceImageRegion["evidence_role"];

export type CorrespondenceSourceImage = {
  id: string;
  sha256: string | null;
  integrity: "VERIFIED" | "MISSING" | "INVALID";
  status: string | null;
  view: ModelView | null;
  regions: readonly ReferenceImageRegion[];
};

export type PartCorrespondenceProposal = {
  image_id: string;
  region_id: string;
  part_id: string;
  /** Explicit target identity, not guessed from model element names. */
  native_cube_uuids: readonly string[];
  review?: {
    outcome: "MATCHED" | "MISMATCHED";
    source_image_id: string;
    source_region_id: string;
    source_sha256: string;
    model_evidence_handle: string;
    model_view: ModelView;
    /** Exact shaded PNG bytes of the reviewed model view, never a file label. */
    model_image_sha256: string;
    /** Set only after actual source and current model images were examined. */
    source_pixels_inspected: boolean;
    model_pixels_inspected: boolean;
  };
};

export type PartCorrespondenceInput = {
  reference: {
    package_fingerprint: string;
    current_package_fingerprint: string;
    images: readonly CorrespondenceSourceImage[];
    parts: readonly ReferencePartRole[];
  };
  model: {
    project_uuid: string;
    recipe_id: string;
    native_snapshot_fingerprint: string;
    current_native_snapshot_fingerprint: string;
    /** Read-only visual dependencies, separate from recipe/Undo identity. */
    capture_dependency_fingerprint: string;
    current_capture_dependency_fingerprint: string;
    /** Result of existing resolveSemanticIdentity after recipe/native validation. */
    identities: SemanticIdentityResolution;
    capture: {
      project_uuid: string;
      native_snapshot_fingerprint: string;
      capture_dependency_fingerprint: string;
      evidence_handle: string;
      views: readonly ModelView[];
      /** Already-rendered shaded PNG digests from this exact capture, one per view. */
      image_digests: readonly { view: ModelView; sha256: string }[];
    };
  };
  proposals: readonly PartCorrespondenceProposal[];
};

export type PartCorrespondenceClaim = {
  part_id: string;
  image_id: string;
  image_sha256: string | null;
  region_id: string;
  view: ModelView | null;
  evidence_role: RegionRole | null;
  owner: "GEOMETRY" | "TEXTURE" | "RELATIONSHIP" | null;
  visibility: ReferenceImageRegion["visibility"] | null;
  native_cube_uuids: string[];
  native_instance_ids: string[];
  project_uuid: string;
  model_evidence_handle: string;
  native_snapshot_fingerprint: string;
  state: CorrespondenceState;
  reason:
    | "MATCH_REVIEWED"
    | "SOURCE_UNAVAILABLE"
    | "SOURCE_NOT_APPROVED"
    | "SOURCE_VIEW_IDENTITY_CONFLICT"
    | "SOURCE_OR_MODEL_REVISION_CHANGED"
    | "PART_OR_REGION_NOT_DECLARED"
    | "NO_EXPLICIT_TARGET"
    | "NATIVE_TARGET_NOT_PROVEN"
    | "CUBE_CLAIMED_BY_DIFFERENT_PARTS"
    | "OWNER_CONFLICT"
    | "OCCLUDED_NOT_ABSENT"
    | "RELATIONSHIP_NEEDS_SEPARATE_REVIEW"
    | "VIEW_NOT_CAPTURED"
    | "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED"
    | "IMAGE_REVIEW_NOT_COMPLETE"
    | "IMAGE_REVIEW_STALE"
    | "VISUAL_MISMATCH_REPORTED";
  /** Positive association never proves invisible shape or visual-quality PASS. */
  hidden_shape_status: "UNVERIFIED";
};

const MAX_IMAGES = 4;
const MAX_PROPOSALS = 16;
const MAX_IDENTITIES = 64;
const SHA256 = /^[a-f0-9]{64}$/;
const NATIVE_FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

function uniqueStrings(values: readonly string[], label: string): void {
  if (values.some((value) => typeof value !== "string" || !value.trim() ||
      value !== value.trim()) || new Set(values).size !== values.length) {
    throw new Error("PART_CORRESPONDENCE_IDENTITY_INVALID: " + label);
  }
}

function roleOwner(role: RegionRole): PartCorrespondenceClaim["owner"] {
  if (role === "PRIMARY_VOLUME") return "GEOMETRY";
  if (role === "SURFACE_DETAIL") return "TEXTURE";
  return "RELATIONSHIP";
}

/**
 * One unchanged image cannot provide independent orthographic views merely
 * because package entries assign it different view labels. Multiple IDs for
 * the same bytes and same view remain one observation, not a conflict.
 */
function conflictingSourceViewHashes(images: readonly CorrespondenceSourceImage[]): Set<string> {
  const viewsByHash = new Map<string, Set<ModelView>>();
  for (const image of images) {
    if (image.integrity !== "VERIFIED" || !image.sha256 ||
        !SHA256.test(image.sha256) || !image.view) continue;
    const views = viewsByHash.get(image.sha256) ?? new Set<ModelView>();
    views.add(image.view);
    viewsByHash.set(image.sha256, views);
  }
  return new Set([...viewsByHash.entries()]
    .filter(([, views]) => views.size > 1)
    .map(([hash]) => hash));
}

/** A view label is not an image identity. Bind every advertised capture view to
 * the corresponding current shaded PNG digest before accepting review claims.
 * Identical bytes in different views are allowed (symmetric models exist).
 * The native capture owner provides the hashes; this pure join cannot certify pixels.
 */
function captureImageDigests(
  capture: PartCorrespondenceInput["model"]["capture"]
): Map<ModelView, string> | null {
  if (!Array.isArray(capture.views) || capture.views.length < 1 ||
      capture.views.length > 5 ||
      new Set(capture.views).size !== capture.views.length ||
      capture.views.some((view) => !MODEL_VIEWS.includes(view)) ||
      !Array.isArray(capture.image_digests) ||
      capture.image_digests.length !== capture.views.length) return null;
  const digests = new Map<ModelView, string>();
  for (const image of capture.image_digests) {
    if (!image || !capture.views.includes(image.view) ||
        !SHA256.test(image.sha256) || digests.has(image.view)) return null;
    digests.set(image.view, image.sha256);
  }
  return digests;
}

function assertBoundedInput(input: PartCorrespondenceInput): Map<string, CompactSemanticIdentity> {
  if (!input.proposals.length || input.proposals.length > MAX_PROPOSALS ||
      !input.reference.images.length || input.reference.images.length > MAX_IMAGES ||
      input.reference.parts.length > 24 ||
      input.model.identities.identities.length > MAX_IDENTITIES) {
    throw new Error("PART_CORRESPONDENCE_SCOPE_INVALID: narrow image, part and target scope.");
  }
  uniqueStrings(input.reference.images.map((image) => image.id), "source image IDs");
  uniqueStrings(input.reference.parts.map((part) => part.id), "semantic part IDs");
  if (input.model.identities.recipe_id !== input.model.recipe_id ||
      !input.model.project_uuid || !input.model.recipe_id ||
      !input.model.capture.evidence_handle) {
    throw new Error("PART_CORRESPONDENCE_IDENTITY_INVALID: model/project/recipe identity.");
  }
  if (input.model.identities.count !== input.model.identities.identities.length) {
    throw new Error("PART_CORRESPONDENCE_IDENTITY_INVALID: resolved identity count.");
  }
  uniqueStrings(input.model.identities.identities.map((id) => id.native_uuid), "native Cube UUIDs");
  uniqueStrings(input.model.identities.identities.map((id) => id.instance_id), "recipe instance IDs");
  const identityMap = new Map<string, CompactSemanticIdentity>();
  for (const identity of input.model.identities.identities) identityMap.set(identity.native_uuid, identity);
  const claims = new Set<string>();
  for (const proposal of input.proposals) {
    const code = JSON.stringify([proposal.image_id, proposal.region_id, proposal.part_id]);
    if (claims.has(code) || !proposal.image_id || !proposal.region_id || !proposal.part_id ||
        proposal.native_cube_uuids.length > MAX_IDENTITIES) {
      throw new Error("PART_CORRESPONDENCE_PROPOSAL_INVALID: duplicate or unbounded claim.");
    }
    claims.add(code);
    uniqueStrings(proposal.native_cube_uuids, "proposed native UUIDs");
  }
  for (const image of input.reference.images) {
    if (parseReferenceImageRegions(image.regions) === null) {
      throw new Error("PART_CORRESPONDENCE_REGION_INVALID: reparse source annotations.");
    }
  }
  return identityMap;
}

/**
 * Read-only join of already-authored source region facts and already-resolved
 * native Recipe UUID facts. Callers must obtain current fingerprints and
 * actual image review independently; this function cannot attest to a
 * Blockbench session or inspect source pixels by itself.
 */
export function assessVisualPartCorrespondence(input: PartCorrespondenceInput): {
  state: "ASSESSED";
  visual_verdict: "NOT_EVALUATED";
  source_views: ModelView[];
  claims: PartCorrespondenceClaim[];
} {
  const nativeByUuid = assertBoundedInput(input);
  const images = new Map(input.reference.images.map((image) => [image.id, image]));
  const parts = new Map(input.reference.parts.map((part) => [part.id, part.role?.toUpperCase() ?? null]));
  const ownership = summarizeReferencePartRegions(input.reference.images, input.reference.parts);
  const ownerConflicts = new Set(ownership.ownership_issues.map((issue) => issue.image_region_id));
  const conflictingViewHashes = conflictingSourceViewHashes(input.reference.images);
  const model = input.model;
  const capturedImages = captureImageDigests(model.capture);
  const stale = !SHA256.test(input.reference.package_fingerprint) ||
    input.reference.package_fingerprint !== input.reference.current_package_fingerprint ||
    !NATIVE_FINGERPRINT.test(model.native_snapshot_fingerprint) ||
    model.native_snapshot_fingerprint !== model.current_native_snapshot_fingerprint ||
    model.capture.native_snapshot_fingerprint !== model.native_snapshot_fingerprint ||
    !NATIVE_FINGERPRINT.test(model.capture_dependency_fingerprint) ||
    model.capture_dependency_fingerprint !== model.current_capture_dependency_fingerprint ||
    model.capture.capture_dependency_fingerprint !== model.capture_dependency_fingerprint ||
    model.capture.project_uuid !== model.project_uuid;
  const claimedByUuid = new Map<string, Set<string>>();
  for (const proposal of input.proposals) {
    for (const uuid of proposal.native_cube_uuids) {
      const owners = claimedByUuid.get(uuid) ?? new Set<string>();
      owners.add(proposal.part_id);
      claimedByUuid.set(uuid, owners);
    }
  }

  const claims: PartCorrespondenceClaim[] = input.proposals.map((proposal) => {
    const image = images.get(proposal.image_id);
    const region = image?.regions.find((item) => item.id === proposal.region_id);
    const declared = !!region && region.part_id === proposal.part_id &&
      parts.has(proposal.part_id);
    const cubes = [...proposal.native_cube_uuids];
    const result = (state: CorrespondenceState, reason: PartCorrespondenceClaim["reason"]): PartCorrespondenceClaim => ({
      part_id: proposal.part_id,
      image_id: proposal.image_id,
      image_sha256: image?.sha256 ?? null,
      region_id: proposal.region_id,
      view: image?.view ?? null,
      evidence_role: region?.evidence_role ?? null,
      owner: region ? roleOwner(region.evidence_role) : null,
      visibility: region?.visibility ?? null,
      native_cube_uuids: cubes,
      native_instance_ids: cubes.flatMap((uuid) =>
        nativeByUuid.get(uuid) ? [nativeByUuid.get(uuid)!.instance_id] : []
      ),
      project_uuid: model.project_uuid,
      model_evidence_handle: model.capture.evidence_handle,
      native_snapshot_fingerprint: model.native_snapshot_fingerprint,
      state, reason,
      hidden_shape_status: "UNVERIFIED",
    });

    if (!image || image.integrity !== "VERIFIED" ||
        !image.sha256 || !SHA256.test(image.sha256) || !image.view) {
      return result("UNAVAILABLE", "SOURCE_UNAVAILABLE");
    }
    if (!declared || !region) return result("CONFLICTING", "PART_OR_REGION_NOT_DECLARED");
    if (stale) return result("UNAVAILABLE", "SOURCE_OR_MODEL_REVISION_CHANGED");
    if (conflictingViewHashes.has(image.sha256)) {
      return result("CONFLICTING", "SOURCE_VIEW_IDENTITY_CONFLICT");
    }
    if (ownerConflicts.has(image.id + ":" + region.id)) return result("CONFLICTING", "OWNER_CONFLICT");
    if (cubes.some((uuid) => (claimedByUuid.get(uuid)?.size ?? 0) > 1)) {
      return result("CONFLICTING", "CUBE_CLAIMED_BY_DIFFERENT_PARTS");
    }
    if (!cubes.length) return result("PROVISIONAL", "NO_EXPLICIT_TARGET");
    if (cubes.some((uuid) => !nativeByUuid.has(uuid))) {
      return result("UNAVAILABLE", "NATIVE_TARGET_NOT_PROVEN");
    }
    if (!Array.isArray(model.capture.views)) {
      return result("UNAVAILABLE", "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED");
    }
    if (!model.capture.views.includes(image.view)) return result("UNAVAILABLE", "VIEW_NOT_CAPTURED");
    if (!capturedImages || !capturedImages.has(image.view)) {
      return result("UNAVAILABLE", "MODEL_CAPTURE_IMAGE_IDENTITY_UNVERIFIED");
    }
    if (region.visibility === "OCCLUDED") return result("PROVISIONAL", "OCCLUDED_NOT_ABSENT");
    if (region.evidence_role === "CONTACT" || region.evidence_role === "NEGATIVE_SPACE") {
      return result("PROVISIONAL", "RELATIONSHIP_NEEDS_SEPARATE_REVIEW");
    }
    const role = parts.get(proposal.part_id);
    if (role === null || role === "UNRESOLVED") {
      return result("PROVISIONAL", "OWNER_CONFLICT");
    }
    if (image.status !== "APPROVED") return result("PROVISIONAL", "SOURCE_NOT_APPROVED");
    const review = proposal.review;
    if (!review || !review.source_pixels_inspected || !review.model_pixels_inspected) {
      return result("PROVISIONAL", "IMAGE_REVIEW_NOT_COMPLETE");
    }
    if (review.source_image_id !== image.id ||
        review.source_region_id !== region.id ||
        review.source_sha256 !== image.sha256 ||
        review.model_evidence_handle !== model.capture.evidence_handle ||
        review.model_view !== image.view ||
        review.model_image_sha256 !== capturedImages.get(image.view)) {
      return result("UNAVAILABLE", "IMAGE_REVIEW_STALE");
    }
    return review.outcome === "MATCHED"
      ? result("SUPPORTED", "MATCH_REVIEWED")
      : result("CONFLICTING", "VISUAL_MISMATCH_REPORTED");
  });

  return {
    state: "ASSESSED",
    visual_verdict: "NOT_EVALUATED",
    source_views: [...new Set(input.reference.images.flatMap((image) =>
      image.view && image.integrity === "VERIFIED" && image.sha256 &&
      SHA256.test(image.sha256) && !conflictingViewHashes.has(image.sha256)
        ? [image.view] : []
    ))],
    claims,
  };
}
