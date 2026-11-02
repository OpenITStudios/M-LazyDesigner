import { nativeClusterAuthoringRequestSchema } from "../../lib/texture/clusterAuthoringRequest";
import type { NativeClusterAuthoringRequest } from "../../lib/texture/clusterAuthoringRequest";
import type { ControlSnapshot } from "./types";
import type { ControlWorkspaceProjection } from "./workspace";
import type { ControlReferenceProjection } from "./referencePackage";
import { lifecycleForDomain } from "./readiness";
import { verifyCurrentClusterReferenceClaims } from "./clusterReferenceEvidence";

type SourceBoundReadiness = Readonly<{
  snapshot: ControlSnapshot;
  workspace: ControlWorkspaceProjection;
  reference: ControlReferenceProjection;
}>;

/**
 * This internal Control guard is intentionally stricter than ordinary
 * texture reads: a source-guided paint must use an already verified,
 * currently bound project and approved Geometry/UV workflow.
 *
 * Inputs are existing trusted Control projections, NOT arbitrary
 * author-supplied flags. Runtime still has to perform its OWN serialized
 * project/Stage affinity and native Cube/UV/bitmap recheck at execution.
 */
export function requireClusterAuthoringControlReadiness(
  input: SourceBoundReadiness
) {
  const { snapshot, workspace, reference } = input;
  if (snapshot?.protocol !== "lazydesigner-control-v1" ||
      snapshot.mode !== "ASSET_AUTHORING" ||
      snapshot.system !== "READY" ||
      snapshot.blockers.length !== 0 ||
      !snapshot.runtime.online ||
      snapshot.runtime.mcp_client_ready !== true ||
      snapshot.runtime.catalog_stale ||
      !snapshot.runtime.runtime_signature ||
      snapshot.project.binding !== "BOUND" ||
      !snapshot.project.affinity_uuid ||
      snapshot.project.affinity_uuid !== snapshot.project.active_uuid ||
      snapshot.authoring.phase !== "texturing" ||
      snapshot.authoring.domain !== "TEXTURING") {
    throw new Error("CLUSTER_CONTROL_PROJECT_OR_STAGE_UNVERIFIED");
  }

  // Use the canonical lifecycle rule; do not copy or relax the Geometry
  // APPROVED / UV PASS requirements for Texturing in another owner.
  const lifecycle = lifecycleForDomain("TEXTURING", workspace);
  if (!lifecycle.ready || !workspace.available ||
      !workspace.source_path ||
      workspace.current_stage?.trim().toUpperCase() !== "TEXTURING") {
    throw new Error(
      "CLUSTER_CONTROL_GEOMETRY_UV_OR_WORKSPACE_NOT_READY: " +
      lifecycle.reasons.join(",")
    );
  }
  if (!reference.available || !reference.source_path ||
      !reference.fingerprint ||
      reference.readiness.texture === "BLOCKED" ||
      !reference.asset_name || !workspace.asset ||
      workspace.asset.trim() !== reference.asset_name.trim()) {
    throw new Error("CLUSTER_CONTROL_REFERENCE_WORKSPACE_UNBOUND");
  }
  return {
    project_uuid: snapshot.project.affinity_uuid,
    runtime_signature: snapshot.runtime.runtime_signature,
    reference_source_path: reference.source_path,
    reference_fingerprint: reference.fingerprint,
    workspace_fingerprint: workspace.fingerprint,
    stage: "TEXTURING" as const,
    lifecycle: "GEOMETRY_APPROVED_UV_PASS" as const,
    mutation_authorized: false as const,
    visual_verdict: "not_evaluated" as const,
  };
}

/**
 * INTERNAL Control preflight for an eventual generated existing-capability
 * cluster branch. Checks the compact request before any image I/O, then
 * checks current source bytes/region claims under the actual trusted source
 * path from Control's pinned Reference projection (not a caller path).
 *
 * Returning this is NOT an authority token or a native call. The true
 * Runtime affinity/UV/revision and current reference identity need their
 * own guards in the eventual serialized mutation protocol.
 */
export async function prepareClusterAuthoringControlPreflight(input: {
  author_request: unknown;
  snapshot: ControlSnapshot;
  workspace: ControlWorkspaceProjection;
  reference: ControlReferenceProjection;
}): Promise<{
  state: "source_verified_native_execution_not_authorized";
  request: NativeClusterAuthoringRequest;
  project_uuid: string;
  reference_fingerprint: string;
  source_image_count: number;
  declared_face_count: number;
  mutation_authorized: false;
  reference_cluster_shapes_attested: false;
  native_binding_attested: false;
  visual_verdict: "not_evaluated";
}> {
  // Strict client-facing intent validation is pure and runs BEFORE Control
  // spends any filesystem or image decoding I/O.
  const request = nativeClusterAuthoringRequestSchema.parse(input.author_request);
  const ready = requireClusterAuthoringControlReadiness(input);

  const evidence = await verifyCurrentClusterReferenceClaims({
    reference_package_path: ready.reference_source_path,
    expected_reference_fingerprint: ready.reference_fingerprint,
    faces: request.faces.map(face => ({
      cube_uuid: face.cube_uuid,
      face: face.face,
      source_claim: face.source_claim,
    })),
  });

  return {
    state: "source_verified_native_execution_not_authorized",
    request,
    project_uuid: ready.project_uuid,
    reference_fingerprint: evidence.reference_fingerprint,
    source_image_count: evidence.image_count,
    declared_face_count: evidence.face_claim_count,
    mutation_authorized: false,
    reference_cluster_shapes_attested: false,
    native_binding_attested: false,
    visual_verdict: "not_evaluated",
  };
}
