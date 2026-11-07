import { describe, expect, test } from "bun:test";
import { planAssetOutputRequirements } from "@/lib/product/assetOutputContracts";
import {
  captureOutputControlContext,
  reviewAssetOutputAgainstCurrentControl,
  type OutputControlSnapshot,
} from "./outputEvidence";

const SHA = "sha256:" + "a".repeat(64);
const OTHER = "sha256:" + "b".repeat(64);
const PATH = "/assets/golem.bbmodel";
const SIGNATURE = JSON.stringify({
  build_identity: "build-1",
  instance_id: "runtime-instance-1",
  startup_time: "2026-11-07T14:00:00Z",
  authoring_phase: "geometry",
  exposed_tool_count: 47,
});

function current(kind: "MODEL" | "PARTICLE" | null = "MODEL"): OutputControlSnapshot {
  return {
    mode: "ASSET_AUTHORING",
    task_context_id: "task:source-1",
    project: { affinity_uuid: "project-1", binding: "BOUND" },
    runtime: {
      online: true, mcp_client_ready: true,
      catalog_stale: false, runtime_signature: SIGNATURE,
    },
    reference: {
      available: true, fingerprint: "reference-hash-1", asset_kind: kind,
    },
    workspace: {
      available: true, fingerprint: "workspace-hash-1",
      finalization_native_revision: {
        state: "MATCHED", reason: "FINALIZATION_NATIVE_CHECKPOINT_MATCHED",
        accepted_sha256: SHA, observed_sha256: SHA,
      },
    },
  };
}

function exported(receiptHash = SHA) {
  return {
    project_format: "bedrock",
    codec: { id: "project" },
    project: { uuid: "project-1", saved: true, save_path: PATH },
    byte_length: 128,
    compiled_payload_sha256: receiptHash,
    compiled_payload_sha256_scope: "NATIVE_CODEC_OUTPUT_BYTES",
    file_integrity_state: "READBACK_MATCHED",
    written_file_sha256: receiptHash,
    save_behavior: "NATIVE_PROJECT_SAVE",
    wrote_to_path: PATH,
    truncated: false,
    content: null,
  };
}

function entityInputs(packet = current(), receipt = exported()) {
  return {
    plan: planAssetOutputRequirements({ asset_profile_id: "entity" }),
    current: packet,
    captured_at_receipt: captureOutputControlContext(current()),
    observations: [{
      deliverable_id: "editable_bbmodel",
      capability: "export_model",
      structured_content: receipt,
    }],
  };
}

describe("Control-bound Asset Output receipt continuity", () => {
  test("current accepted Entity .bbmodel bytes can match at Control status, never grant PASS", () => {
    const review = reviewAssetOutputAgainstCurrentControl(entityInputs());
    expect(review.context_match).toBe("MATCHED_SNAPSHOT_IDENTITIES");
    expect(review.changed_context_fields).toEqual([]);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0].state).toBe("FILE_READBACK_REPORTED");
    expect(review.rows[0].revision_relation).toBe("CONTROL_CHECKPOINT_MATCH_REPORTED");
    expect(review.rows[0].receipt_provenance)
      .toBe("CALLER_SUPPLIED_NOT_AUTHENTICATED");
    expect(review.rows[0].current_asset_revision_verified).toBe(false);
    expect(review.current_asset_revision_verified).toBe(false);
    expect(review.finalization_ready).toBe(false);
    expect(review.minecraft_verified).toBe(false);
  });

  test("switching project, Runtime generation or Reference authority withholds file match", () => {
    const identityChanges = [
      { project: { affinity_uuid: "project-2", binding: "BOUND" as const } },
      { runtime: { ...current().runtime,
          runtime_signature: SIGNATURE.replace("runtime-instance-1", "runtime-instance-2") } },
      { reference: { ...current().reference, fingerprint: "reference-hash-2" } },
    ];
    for (const change of identityChanges) {
      const packet = { ...current(), ...change } as OutputControlSnapshot;
      const review = reviewAssetOutputAgainstCurrentControl(entityInputs(packet));
      expect(review.context_match).toBe("CHANGED_SNAPSHOT_IDENTITIES");
      expect(review.changed_context_fields.length).toBeGreaterThan(0);
      expect(review.rows[0].revision_relation).toBe("UNVERIFIED");
      expect(review.finalization_ready).toBe(false);
    }
  });

  test("Workspace/task IDs may rotate while matching current file bytes at status", () => {
    for (const change of [
      { workspace: { ...current().workspace, fingerprint: "workspace-hash-2" } },
      { task_context_id: "task:source-2" },
    ]) {
      const review = reviewAssetOutputAgainstCurrentControl(
        entityInputs({ ...current(), ...change } as OutputControlSnapshot)
      );
      expect(review.context_match).toBe("CHANGED_SNAPSHOT_IDENTITIES");
      expect(review.rows[0].revision_relation).toBe("CONTROL_CHECKPOINT_MATCH_REPORTED");
      expect(review.current_asset_revision_verified).toBe(false);
      expect(review.finalization_ready).toBe(false);
    }
  });

  test("an unbound/offline/unknown current snapshot cannot prove continuity", () => {
    const invalid = [
      { project: { affinity_uuid: "project-1", binding: "UNKNOWN" as const } },
      { runtime: { ...current().runtime, online: false } },
      { runtime: { ...current().runtime, mcp_client_ready: false } },
      { runtime: { ...current().runtime, catalog_stale: true } },
      { runtime: { ...current().runtime, runtime_signature: "opaque-generation" } },
      { runtime: { ...current().runtime,
        runtime_signature: JSON.stringify({instance_id:null, startup_time:null}) } },
      { workspace: { ...current().workspace, fingerprint: null } },
      { reference: { ...current().reference, available: false } },
    ];
    for (const change of invalid) {
      const packet = { ...current(), ...change } as OutputControlSnapshot;
      expect(captureOutputControlContext(packet)).toBeNull();
      const review = reviewAssetOutputAgainstCurrentControl(entityInputs(packet));
      expect(review.context_match).toBe("CURRENT_CONTEXT_UNAVAILABLE");
      expect(review.rows[0].revision_relation).toBe("UNVERIFIED");
    }
    expect(reviewAssetOutputAgainstCurrentControl({
      ...entityInputs(), captured_at_receipt: null,
    }).context_match).toBe("NO_CAPTURED_CONTEXT");
  });

  test("a stale or differing current Entity checkpoint defeats receipt readback", () => {
    const stale = current();
    stale.workspace.finalization_native_revision = {
      state: "STALE", reason: "FINALIZATION_NATIVE_CHECKPOINT_MISMATCH",
      accepted_sha256: SHA, observed_sha256: OTHER,
    };
    stale.workspace.fingerprint = "workspace-after-stale-file";
    const staleReview = reviewAssetOutputAgainstCurrentControl(entityInputs(stale));
    expect(staleReview.context_match).toBe("CHANGED_SNAPSHOT_IDENTITIES");
    expect(staleReview.rows[0].revision_relation)
      .toBe("CONTROL_CHECKPOINT_STALE_REPORTED");

    const different = current();
    different.workspace.finalization_native_revision = {
      state: "MATCHED", reason: "FINALIZATION_NATIVE_CHECKPOINT_MATCHED",
      accepted_sha256: OTHER, observed_sha256: OTHER,
    };
    different.workspace.fingerprint = "workspace-after-accepted-file";
    const differentReview = reviewAssetOutputAgainstCurrentControl(
      entityInputs(different)
    );
    expect(differentReview.context_match).toBe("CHANGED_SNAPSHOT_IDENTITIES");
    expect(differentReview.rows[0].revision_relation)
      .toBe("CONTROL_CHECKPOINT_DIFFERS_FROM_RECEIPT");

    const noReadback = current();
    noReadback.workspace.finalization_native_revision = undefined;
    expect(reviewAssetOutputAgainstCurrentControl(
      entityInputs(noReadback)
    ).rows[0].revision_relation).toBe("UNVERIFIED");
  });

  test("matching context still cannot infer freshness for compile-only and other assets", () => {
    const packet = current("PARTICLE");
    const particle = planAssetOutputRequirements({ asset_profile_id: "particle" });
    const review = reviewAssetOutputAgainstCurrentControl({
      plan: particle, current: packet,
      captured_at_receipt: captureOutputControlContext(packet),
      observations: [{
        deliverable_id: "particle_definition_json",
        capability: "manage_particle",
        structured_content: {
          valid: true, artifact_ready: true,
          source_path: null, wrote_to_path: "/pack/particles/spark.json",
          preview_path: null, preview_error: null,
          byte_length: 80, operation_count: 1,
          summary: { identifier: "test:spark", component_count: 1, diagnostics: [] },
          writes: [{ kind: "particle", path: "/pack/particles/spark.json",
            byte_length: 80, replaced_existing: false }],
        },
      }],
    });
    expect(review.context_match).toBe("MATCHED_SNAPSHOT_IDENTITIES");
    expect(review.rows[0].state).toBe("PARTICLE_WRITE_REPORTED");
    expect(review.rows[0].revision_relation).toBe("UNVERIFIED");
    expect(review.unresolved_conditionals).toEqual(["particle_texture_png"]);
    expect(review.finalization_ready).toBe(false);
  });

  test("v1 Reference kind cannot silently select a foreign Asset Profile", () => {
    const packet = current("MODEL");
    const review = reviewAssetOutputAgainstCurrentControl({
      plan: planAssetOutputRequirements({ asset_profile_id: "item_icon" }),
      current: packet,
      captured_at_receipt: captureOutputControlContext(packet),
      observations: [],
    });
    expect(review.context_match).toBe("PROFILE_CONFLICT");
    expect(review.rows[0].revision_relation).toBe("UNVERIFIED");

    const oldModel = current(null);
    const oldReview = reviewAssetOutputAgainstCurrentControl({
      ...entityInputs(oldModel),
      captured_at_receipt: captureOutputControlContext(oldModel),
    });
    expect(oldReview.context_match).toBe("MATCHED_SNAPSHOT_IDENTITIES");
  });
});
