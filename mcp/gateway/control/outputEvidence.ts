import type { ControlPacket } from "./packet";
import type { GatewayRuntimeStatus } from "../runtime/backend";
import { readRuntimeProjectHealth } from "../../lib/runtime/affinity";
import { isAbsoluteFilesystemPath } from "../../lib/core/path";
import {
  resolveAssetProfileSelection,
} from "../../lib/product/assetProfiles";
import type { AssetOutputPlan } from "../../lib/product/assetOutputContracts";
import {
  reviewAssetOutputReceipts,
  type AssetOutputReceiptObservation,
  type AssetOutputReceiptRow,
  type AssetOutputReceiptReview,
} from "../../lib/receipts/assetOutput";

/**
 * A bounded projection of the already-owned Control Packet. It is not a
 * native file revision, proof of a successful tool call, or another state
 * manager. Existing ControlPacket is assignable without a new Gateway field.
 */
export type OutputControlSnapshot = Pick<
  ControlPacket, "mode" | "task_context_id"
> & {
  project: Pick<ControlPacket["project"], "affinity_uuid" | "binding">;
  runtime: Pick<ControlPacket["runtime"],
    "online" | "mcp_client_ready" | "catalog_stale" | "runtime_signature">;
  reference: Pick<ControlPacket["reference"],
    "available" | "fingerprint" | "asset_kind">;
  workspace: Pick<ControlPacket["workspace"],
    "available" | "fingerprint" | "finalization_native_revision">;
};

export type OutputControlContext = Readonly<{
  project_uuid: string;
  runtime_signature: string;
  task_context_id: string;
  reference_fingerprint: string;
  workspace_fingerprint: string;
  asset_kind: ControlPacket["reference"]["asset_kind"];
}>;

export type OutputContextMatch =
  | "MATCHED_SNAPSHOT_IDENTITIES"
  | "CHANGED_SNAPSHOT_IDENTITIES"
  | "NO_CAPTURED_CONTEXT"
  | "CURRENT_CONTEXT_UNAVAILABLE"
  | "PROFILE_CONFLICT";

export type OutputRevisionRelation =
  | "UNVERIFIED"
  | "CONTROL_CHECKPOINT_STALE_REPORTED"
  | "CONTROL_NATIVE_FILE_PATH_MISMATCH"
  | "CONTROL_CHECKPOINT_DIFFERS_FROM_RECEIPT"
  | "CONTROL_CHECKPOINT_MATCH_REPORTED";

export type OutputControlEvidenceRow = AssetOutputReceiptRow & Readonly<{
  revision_relation: OutputRevisionRelation;
  revision_reason: string;
}>;

export type OutputControlEvidenceReview = Omit<
  AssetOutputReceiptReview, "rows"
> & Readonly<{
  context_match: OutputContextMatch;
  changed_context_fields: readonly string[];
  rows: readonly OutputControlEvidenceRow[];
  /** Snapshot comparison never proves later native or manual-editor edits. */
  current_asset_revision_verified: false;
  finalization_ready: false;
}>;

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRuntimeGeneration(signature: string): boolean {
  // The canonical Runtime signature includes an actual instance/startup
  // identity. An opaque string or config-only signature cannot safely bind
  // a receipt across Runtime restarts, even when its characters match.
  try {
    const decoded = record(JSON.parse(signature) as unknown);
    return decoded !== null &&
      (nonempty(decoded.instance_id) || nonempty(decoded.startup_time));
  } catch {
    return false;
  }
}

/**
 * Capture the smallest possible current Control identity. Null means a
 * bound project/reference/workspace and live Runtime generation could not
 * be established. This may be recorded alongside a later native receipt;
 * it cannot authenticate an arbitrary caller-supplied receipt.
 */
export function captureOutputControlContext(
  packet: OutputControlSnapshot
): OutputControlContext | null {
  if (packet.mode !== "ASSET_AUTHORING" ||
      packet.project.binding !== "BOUND" ||
      !nonempty(packet.project.affinity_uuid) ||
      !packet.runtime.online ||
      packet.runtime.mcp_client_ready !== true ||
      packet.runtime.catalog_stale ||
      !nonempty(packet.runtime.runtime_signature) ||
      !hasRuntimeGeneration(packet.runtime.runtime_signature) ||
      !packet.reference.available ||
      !nonempty(packet.reference.fingerprint) ||
      !packet.workspace.available ||
      !nonempty(packet.workspace.fingerprint) ||
      !nonempty(packet.task_context_id)) return null;

  return {
    project_uuid: packet.project.affinity_uuid,
    runtime_signature: packet.runtime.runtime_signature,
    task_context_id: packet.task_context_id,
    reference_fingerprint: packet.reference.fingerprint,
    workspace_fingerprint: packet.workspace.fingerprint,
    asset_kind: packet.reference.asset_kind,
  };
}

const SHA256 = /^sha256:[0-9a-f]{64}$/;
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function contextDifferences(
  captured: OutputControlContext,
  current: OutputControlContext
): string[] {
  const fields = [
    "project_uuid",
    "runtime_signature",
    "task_context_id",
    "reference_fingerprint",
    "workspace_fingerprint",
    "asset_kind",
  ] as const;
  return fields.filter((field) => captured[field] !== current[field]);
}

/**
 * Reuse the already-verified Runtime health project owner. A file hash cannot
 * identify *which* .bbmodel was saved. Require the bound current native
 * save_path and the export receipt's exact wrote_to_path to agree.
 *
 * The caller must supply the same Runtime status that produced the current
 * Control Packet. This source-only comparison does not authenticate calls,
 * read files, or upgrade the independent Finalization checkpoint proof.
 */
function currentBoundEntitySavePath(
  current: OutputControlSnapshot,
  status: GatewayRuntimeStatus | null | undefined
): string | null {
  if (!status || current.project.binding !== "BOUND" ||
      !nonempty(current.project.affinity_uuid) ||
      !status.runtime.online || !status.runtime.mcp_client_ready ||
      status.runtime.catalog_stale ||
      status.runtime.runtime_signature !== current.runtime.runtime_signature ||
      status.affinity.project_uuid !== current.project.affinity_uuid) return null;

  const project = readRuntimeProjectHealth(status.runtime.health);
  const native = project?.requested_project;
  const nativePath = native?.save_path;
  if (project?.requested_project_available !== true ||
      project.requested_project_uuid !== current.project.affinity_uuid ||
      native?.uuid !== current.project.affinity_uuid ||
      native?.saved !== true ||
      typeof nativePath !== "string" ||
      !isAbsoluteFilesystemPath(nativePath) ||
      !/\.bbmodel$/i.test(nativePath)) return null;
  return nativePath;
}

function revisionForEntityProject(input: {
  current: OutputControlSnapshot;
  current_native_status?: GatewayRuntimeStatus | null;
  rows: AssetOutputReceiptReview["rows"];
  observations: readonly AssetOutputReceiptObservation[];
  context_match: OutputContextMatch;
  captured_context: OutputControlContext | null;
  current_context: OutputControlContext | null;
}): Map<string, {
  relation: OutputRevisionRelation;
  reason: string;
}> {
  const findings = new Map<string, {
    relation: OutputRevisionRelation; reason: string;
  }>();
  // Workspace hashes and task IDs may legitimately rotate after saving
  // the exact file. For a file-byte comparison require the same bound
  // project, Runtime generation, and Reference authority; the current
  // Finalization hash independently resolves the saved bytes. This does
  // not restore unrelated Stage approvals or assert a current editor pose.
  const captured = input.captured_context;
  const current = input.current_context;
  if (input.context_match === "PROFILE_CONFLICT" ||
      !captured || !current ||
      captured.project_uuid !== current.project_uuid ||
      captured.runtime_signature !== current.runtime_signature ||
      captured.reference_fingerprint !== current.reference_fingerprint ||
      captured.asset_kind !== current.asset_kind) return findings;

  const entity = input.rows.find((row) =>
    row.deliverable_id === "editable_bbmodel" &&
    row.state === "FILE_READBACK_REPORTED"
  );
  if (!entity) return findings;
  const checkpoint = input.current.workspace.finalization_native_revision;
  if (!checkpoint) return findings;
  if (checkpoint.state === "STALE") {
    findings.set("editable_bbmodel", {
      relation: "CONTROL_CHECKPOINT_STALE_REPORTED",
      reason: "CONTROL_REPORTS_ENTITY_NATIVE_CHECKPOINT_STALE",
    });
    return findings;
  }
  if (checkpoint.state !== "MATCHED") return findings;

  // A matching SHA across two files is not same-deliverable proof. The
  // status/project binding must identify the exact file in the receipt.
  const currentNativePath = currentBoundEntitySavePath(
    input.current, input.current_native_status
  );
  if (!currentNativePath) return findings;
  const receipt = record(input.observations.find(
    (entry) => entry.deliverable_id === "editable_bbmodel"
  )?.structured_content);
  const writtenPath = receipt?.wrote_to_path;
  if (typeof writtenPath !== "string" || writtenPath.length === 0) return findings;
  if (writtenPath !== currentNativePath) {
    findings.set("editable_bbmodel", {
      relation: "CONTROL_NATIVE_FILE_PATH_MISMATCH",
      reason: "CURRENT_BOUND_NATIVE_PATH_DIFFERS_FROM_EXPORT_RECEIPT",
    });
    return findings;
  }
  const writtenSha = receipt?.written_file_sha256;
  if (!nonempty(writtenSha) || !SHA256.test(writtenSha) ||
      !nonempty(checkpoint.accepted_sha256) ||
      !SHA256.test(checkpoint.accepted_sha256) ||
      !nonempty(checkpoint.observed_sha256) ||
      !SHA256.test(checkpoint.observed_sha256)) return findings;

  if (checkpoint.accepted_sha256 !== checkpoint.observed_sha256 ||
      writtenSha !== checkpoint.observed_sha256) {
    findings.set("editable_bbmodel", {
      relation: "CONTROL_CHECKPOINT_DIFFERS_FROM_RECEIPT",
      reason: "CONTROL_NATIVE_CHECKPOINT_AND_RECEIPT_HASH_DIFFER",
    });
  } else {
    findings.set("editable_bbmodel", {
      relation: "CONTROL_CHECKPOINT_MATCH_REPORTED",
      reason: "MATCHED_SAVED_ENTITY_FILE_BYTES_AT_CONTROL_STATUS_ONLY",
    });
  }
  return findings;
}

/**
 * Compare a prior receipt's captured context with a *new* Control Packet.
 * It uses the current Control source owners rather than storing a second
 * revision ledger or recomputing filesystem hashes.
 *
 * Identical Context IDs do not prove native model freshness: manual edits
 * may not rotate them. The existing Finalization Entity SHA alone cannot
 * identify a saved file; require the same-bound Runtime status's native
 * save_path to match the export receipt before reporting a point-in-time
 * same-file match. Never imply user/visual/Minecraft approval.
 */
export function reviewAssetOutputAgainstCurrentControl(input: {
  plan: AssetOutputPlan;
  current: OutputControlSnapshot;
  /** Same-status Runtime health as the current Control Packet; no new read. */
  current_native_status?: GatewayRuntimeStatus | null;
  captured_at_receipt: OutputControlContext | null;
  observations: readonly AssetOutputReceiptObservation[];
}): OutputControlEvidenceReview {
  const current = captureOutputControlContext(input.current);
  // A v1 MODEL/PARTICLE Reference is authoritative for these *two* legacy
  // output kinds. Explicit seven-profile selection remains generator-coupled.
  const sourceProfile = resolveAssetProfileSelection({
    referenceAssetKind: input.current.reference.asset_kind,
  });
  const profileConflict = input.current.reference.available &&
    ((sourceProfile.state === "RESOLVED" &&
      sourceProfile.asset_profile_id !== input.plan.asset_profile_id) ||
      (sourceProfile.state !== "RESOLVED" &&
        input.plan.asset_profile_id !== "entity"));

  let contextMatch: OutputContextMatch;
  let changedFields: string[] = [];
  if (profileConflict) contextMatch = "PROFILE_CONFLICT";
  else if (!current) contextMatch = "CURRENT_CONTEXT_UNAVAILABLE";
  else if (!input.captured_at_receipt) contextMatch = "NO_CAPTURED_CONTEXT";
  else {
    // Untrusted caller data can at most match a Control snapshot identity.
    // It cannot grant actual content provenance or native freshness.
    changedFields = contextDifferences(input.captured_at_receipt, current);
    contextMatch = changedFields.length > 0
      ? "CHANGED_SNAPSHOT_IDENTITIES"
      : "MATCHED_SNAPSHOT_IDENTITIES";
  }

  const reviewed = reviewAssetOutputReceipts({
    plan: input.plan,
    observations: input.observations,
    expected_project_uuid: current?.project_uuid,
  });
  const fileRevisions = input.plan.asset_profile_id === "entity"
    ? revisionForEntityProject({
        current: input.current,
        current_native_status: input.current_native_status,
        rows: reviewed.rows,
        observations: input.observations,
        context_match: contextMatch,
        captured_context: input.captured_at_receipt,
        current_context: current,
      })
    : new Map<string, { relation: OutputRevisionRelation; reason: string }>();

  return {
    ...reviewed,
    context_match: contextMatch,
    changed_context_fields: changedFields,
    rows: reviewed.rows.map((row): OutputControlEvidenceRow => {
      const known = fileRevisions.get(row.deliverable_id);
      return {
        ...row,
        revision_relation: known?.relation ?? "UNVERIFIED",
        revision_reason: known?.reason ??
          (contextMatch === "MATCHED_SNAPSHOT_IDENTITIES"
            ? "NO_PROFILE_NATIVE_REVISION_READBACK"
            : "CONTROL_CONTEXT_REQUIRES_ORIENTATION"),
      };
    }),
    current_asset_revision_verified: false,
    finalization_ready: false,
  };
}
