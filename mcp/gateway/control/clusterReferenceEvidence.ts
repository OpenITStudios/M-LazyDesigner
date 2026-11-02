import type { ClusterFaceAuthoring } from "../../lib/texture/clusterComposition";
import {
  readReferencePackageProjection,
  requireStableSeamReferenceImageRead,
} from "./referencePackage";
import { readReferenceImageEvidence } from "./referenceImageEvidence";

type ClusterSourceClaim = Pick<
  ClusterFaceAuthoring, "cube_uuid" | "face" | "source_claim"
>;

const HASH = /^[a-f0-9]{64}$/;
const FACE_KEYS = new Set(["north", "south", "east", "west", "up", "down"]);
const MAX_CLAIMS = 16;
const MAX_IMAGES = 4;

/**
 * Trusted Control-side source checker for the internal cluster authoring
 * bridge. Reuses the canonical Reference Package/image-byte readers.
 *
 * Verifies package-declared APPROVED/TEXTURE status, SHA-256, source region
 * annotations and stable bytes across the read window. It cannot verify
 * that an invented cluster shape actually resembles the image or that the
 * annotated source part corresponds to the nominated 3D Cube face.
 */
export async function verifyCurrentClusterReferenceClaims(input: {
  reference_package_path: string;
  expected_reference_fingerprint: string;
  faces: readonly ClusterSourceClaim[];
}) {
  if (typeof input.reference_package_path !== "string" ||
      !input.reference_package_path.trim() ||
      typeof input.expected_reference_fingerprint !== "string" ||
      !HASH.test(input.expected_reference_fingerprint)) {
    throw new Error("CLUSTER_REFERENCE_PACKAGE_IDENTITY_REQUIRED");
  }
  if (!Array.isArray(input.faces) || input.faces.length < 1 ||
      input.faces.length > MAX_CLAIMS) {
    throw new Error("CLUSTER_REFERENCE_FACE_BUDGET");
  }
  const proposed = structuredClone(input.faces);
  const seen = new Set<string>();
  for (const entry of proposed) {
    const claim = entry?.source_claim;
    if (!entry || typeof entry.cube_uuid !== "string" ||
        !entry.cube_uuid.trim() || entry.cube_uuid.length > 128 ||
        !FACE_KEYS.has(entry.face) ||
        !claim || typeof claim.image_id !== "string" ||
        !claim.image_id.trim() || claim.image_id.length > 96 ||
        typeof claim.image_sha256 !== "string" ||
        !HASH.test(claim.image_sha256) ||
        typeof claim.image_region_id !== "string" ||
        !claim.image_region_id.trim() || claim.image_region_id.length > 96 ||
        typeof claim.part_id !== "string" ||
        !claim.part_id.trim() || claim.part_id.length > 96 ||
        typeof claim.observation_id !== "string" ||
        !claim.observation_id.trim() || claim.observation_id.length > 128) {
      throw new Error("CLUSTER_REFERENCE_CLAIM_INVALID");
    }
    const key = JSON.stringify([entry.cube_uuid, entry.face]);
    if (seen.has(key)) throw new Error("CLUSTER_REFERENCE_DUPLICATE_FACE: " + key);
    seen.add(key);
  }

  const ids = [...new Set(proposed.map(face => face.source_claim.image_id))].sort();
  if (ids.length < 1 || ids.length > MAX_IMAGES) {
    throw new Error("CLUSTER_REFERENCE_IMAGE_BUDGET");
  }
  const initial = await readReferencePackageProjection(input.reference_package_path);
  if (!initial.available || !initial.fingerprint ||
      initial.fingerprint !== input.expected_reference_fingerprint ||
      initial.readiness.texture === "BLOCKED") {
    throw new Error("CLUSTER_REFERENCE_PACKAGE_CHANGED_OR_BLOCKED");
  }

  for (const entry of proposed) {
    const claim = entry.source_claim;
    const image = initial.images.find(row => row.id === claim.image_id);
    if (!image || image.integrity !== "VERIFIED" ||
        image.sha256 !== claim.image_sha256 ||
        image.status !== "APPROVED" ||
        !image.used_by.includes("TEXTURE") ||
        image.media_type !== "image/png") {
      throw new Error("CLUSTER_REFERENCE_IMAGE_IDENTITY_NOT_APPROVED: " +
        claim.image_id);
    }
    const matches = (image.regions ?? []).filter(region =>
      region.id === claim.image_region_id &&
      region.part_id === claim.part_id &&
      region.evidence_role === "SURFACE_DETAIL" &&
      region.visibility !== "OCCLUDED" &&
      region.box_uv !== null);
    if (matches.length !== 1) {
      throw new Error("CLUSTER_REFERENCE_VISIBLE_REGION_UNVERIFIED: " +
        claim.image_id + ":" + claim.image_region_id);
    }
  }

  const delivered = await readReferenceImageEvidence(initial, ids);
  const final = await readReferencePackageProjection(input.reference_package_path);
  requireStableSeamReferenceImageRead({
    initial, final, selected_ids: ids, delivered,
  });
  // A manifest with identical image IDs/bytes but altered region annotations
  // changes the full fingerprint and is rejected by the stable read guard.
  return {
    state: "source_bytes_and_region_annotations_matched" as const,
    reference_fingerprint: final.fingerprint!,
    image_count: ids.length,
    face_claim_count: proposed.length,
    source_images: delivered.map(image => ({
      image_id: image.id, sha256: image.sha256,
      status: image.status,
    })),
    image_bytes_attested: true as const,
    surface_region_annotations_attested: true as const,
    // These are still artist-authored semantic claims, not measured image
    // cluster geometry or 3D face correspondence.
    reference_cluster_shapes_attested: false as const,
    source_to_native_face_correspondence_attested: false as const,
    human_approval_attested: false as const,
    painting_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/** Trusted Control receives the current package/fingerprint; the MCP client
 * never receives a "pass approval=true" switch for the native painter.
 */
export function createCurrentClusterReferenceVerifier(input: {
  reference_package_path: string;
  expected_reference_fingerprint: string;
}) {
  // Pin caller-owned path/fingerprint values at factory creation: a later
  // mutation of a settings object must not switch source authority between
  // the native bridge's two asynchronous reference checks.
  const reference_package_path = input.reference_package_path;
  const expected_reference_fingerprint = input.expected_reference_fingerprint;
  return async (faces: readonly ClusterSourceClaim[]) => {
    await verifyCurrentClusterReferenceClaims({
      reference_package_path, expected_reference_fingerprint, faces,
    });
  };
}
