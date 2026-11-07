import { describe, expect, test } from "bun:test";
import { buildControlDelta } from "../gateway/control/delta/engine";
import { projectControlDeltaForGateway } from "../gateway/control/delta/projection";
import { assessNativeOutputInvocation } from "../gateway/control/delta/outputReceipt";
import { reduceControlExecutionState } from "../gateway/control/orchestration";

function exportDelta(result: unknown, succeeded = true) {
  return buildControlDelta({
    capability: "export_model",
    phaseBefore: "geometry",
    phaseAfter: "geometry",
    projectUuid: "project-fixture",
    succeeded,
    result,
  });
}

describe("export_model native metadata delta", () => {
  test("Save As changes are visible without invalidating visual freshness", () => {
    const delta = exportDelta({
      save_behavior: "NATIVE_PROJECT_SAVE_AS",
      project_lifecycle_changes: ["name", "save_path", "saved"],
    });
    expect(delta.changed).toEqual(["project.name", "project.save_path", "project.saved"]);
    expect(delta.freshness.basis).toBe("NO_CHANGE");
    expect(delta.requires_status_refresh).toBe(true);
    const client = projectControlDeltaForGateway(delta);
    expect(client.changed).toEqual(delta.changed);
    expect(client.freshness).toEqual({ basis: "NO_CHANGE" });
  });

  test("unmodified compile-only receipt does not claim a project change", () => {
    const delta = exportDelta({
      save_behavior: "COMPILE_ONLY", project_lifecycle_changes: [],
    });
    expect(delta.changed).toEqual([]);
    expect(delta.requires_status_refresh).toBe(false);
  });

  test("untrusted fields and failed saves never fabricate project changes", () => {
    const receipt = { project_lifecycle_changes: ["save_path", "token", "", 123] };
    expect(exportDelta(receipt).changed).toEqual(["project.save_path"]);
    expect(exportDelta(receipt, false).changed).toEqual([]);
  });

  test("legacy Runtime receipt without metadata remains compatible", () => {
    expect(exportDelta({ wrote_to_path: "/tmp/file.bbmodel" }).changed).toEqual([]);
  });
});

const SHA = "sha256:" + "a".repeat(64);
const UUID = "project-fixture";
function nativeExport(codec: "project" | "bedrock" | "bedrock_animation",
  overrides: Record<string, unknown> = {}) {
  const path = codec === "project" ? "/rp/test.bbmodel" : "/rp/test.geo.json";
  return {
    project_format: "bedrock",
    codec: { id: codec },
    project: {
      uuid: UUID, saved: true,
      save_path: codec === "project" ? path : "/rp/test.bbmodel",
      export_path: codec === "bedrock" ? path : null,
      export_codec: codec === "bedrock" ? "bedrock" : null,
    },
    byte_length: 128,
    compiled_payload_sha256: SHA,
    compiled_payload_sha256_scope: "NATIVE_CODEC_OUTPUT_BYTES",
    file_integrity_state: "READBACK_MATCHED",
    written_file_sha256: SHA,
    wrote_to_path: codec === "bedrock_animation" ? null : path,
    save_behavior: codec === "project" ? "NATIVE_PROJECT_SAVE"
      : codec === "bedrock" ? "NATIVE_BEDROCK_EXPORT" : "COMPILE_ONLY",
    truncated: false,
    content: codec === "bedrock_animation" ? '{"animations":{}}' : null,
    ...(codec === "bedrock" ? {
      geometry_export_identity: {
        state: "COMPILED_GEOMETRY_IDENTITIES_VALIDATED",
        geometry_count: 1,
      },
    } : {}),
    ...(codec === "bedrock_animation" ? {
      file_integrity_state: "NOT_WRITTEN", written_file_sha256: null,
      animation_export_identity: {
        state: "SOURCE_CLIP_IDENTITIES_MATCHED",
        source_clip_count: 1, compiled_clip_count: 1,
      },
    } : {}),
    ...overrides,
  };
}
function deltaForNative(codec: "project" | "bedrock" | "bedrock_animation",
  result: unknown, origin = true) {
  return buildControlDelta({
    capability: "export_model", phaseBefore: "geometry",
    phaseAfter: "geometry", projectUuid: UUID, succeeded: true,
    capabilityArguments: { codec_id: codec },
    nativeInvocationVerified: origin, result,
  });
}

describe("invocation-bound Asset Output receipt verification", () => {
  test("native readback changes existing delta verification class without Finalization PASS", () => {
    for (const codec of ["project", "bedrock"] as const) {
      const report = deltaForNative(codec, nativeExport(codec));
      expect(report.verification_class).toBe("receipt_only");
      expect(report.next_intent).toBe("VERIFY_REQUESTED_OUTPUT_SET_AND_APPROVALS");
      expect(report.requires_status_refresh).toBe(false);
      expect(report.revision_evidence).toEqual({});
      const projected = projectControlDeltaForGateway(report);
      expect(projected.verification_class).toBe("receipt_only");
      expect(projected.next_intent).toBe(report.next_intent);
      expect(projected).not.toHaveProperty("output_receipt");
      expect(projected).not.toHaveProperty("finalization_ready");
      const completed = reduceControlExecutionState(null, report);
      expect(completed.continuation.next_action.kind).toBe("CONTINUE");
      expect(completed.continuation.next_action.reason)
        .toContain("requested deliverables");
      expect(completed.continuation.next_action.reason)
        .toContain("this write only");
    }
  });

  test("size-only and compile-only preserve follow-up verification debt", () => {
    const size = deltaForNative("bedrock", nativeExport("bedrock", {
      file_integrity_state: "SIZE_ONLY", written_file_sha256: null,
    }));
    expect(size.verification_class).toBe("focused_read");
    expect(size.next_intent).toBe("VERIFY_EXPORTED_FILE_READBACK");
    expect(reduceControlExecutionState(null, size).continuation.next_action)
      .toMatchObject({
        kind: "VERIFY_FOCUSED",
        recommended_capability: null,
      });
    expect(reduceControlExecutionState(null, size).continuation.next_action.reason)
      .toContain("file-byte readback");
    const animation = deltaForNative("bedrock_animation", nativeExport("bedrock_animation"));
    expect(animation.verification_class).toBe("focused_read");
    expect(animation.next_intent).toBe("REVIEW_COMPILED_ANIMATION_OR_PERSIST_IF_REQUESTED");
    expect(reduceControlExecutionState(null, animation).continuation.next_action.reason)
      .toContain("content only");
    const preview = deltaForNative("bedrock", nativeExport("bedrock", {
      save_behavior: "COMPILE_ONLY", wrote_to_path: null,
      file_integrity_state: "NOT_WRITTEN", written_file_sha256: null,
      content: '{"minecraft:geometry":[]}',
    }));
    expect(preview.verification_class).toBe("focused_read");
    expect(preview.next_intent).toBe("REVIEW_COMPILED_OUTPUT_OR_PERSIST_IF_REQUESTED");
  });

  test("mismatched project, codec or hash never inherits receipt-only", () => {
    for (const invalid of [
      nativeExport("project", { written_file_sha256: "sha256:" + "b".repeat(64) }),
      nativeExport("project", { project: { uuid: "other" } }),
      nativeExport("bedrock"),
      nativeExport("project", { file_integrity_state: "READBACK_MATCHED",
        save_behavior: "COMPILE_ONLY" }),
    ]) {
      const d = deltaForNative("project", invalid);
      expect(d.verification_class).toBe("focused_read");
      expect(d.next_intent).toBe("INSPECT_OUTPUT_WRITE_OUTCOME_BEFORE_RETRY");
      expect(reduceControlExecutionState(null, d).continuation.next_action)
        .toMatchObject({ kind: "VERIFY_FOCUSED", recommended_capability: null });
      expect(reduceControlExecutionState(null, d).continuation.next_action.reason)
        .toContain("do not automatically retry");
    }
  });

  test("no Backend-native provenance leaves legacy classifications untouched", () => {
    const projectReceipt = nativeExport("project");
    const legacy = exportDelta(projectReceipt);
    const local = deltaForNative("project", projectReceipt, false);
    expect(local.verification_class).toBe(legacy.verification_class);
    expect(local.next_intent).toBe(legacy.next_intent);
    expect(assessNativeOutputInvocation({
      capability: "export_model",
      arguments: { codec_id: "project" },
      succeeded: true, native_invocation_verified: true,
      verified_project_uuid: null, structured_content: projectReceipt,
    })).toBeNull();
    expect(assessNativeOutputInvocation({
      capability: "export_model",
      arguments: { codec_id: "unsupported" },
      succeeded: true, native_invocation_verified: true,
      verified_project_uuid: UUID, structured_content: projectReceipt,
    })).toBeNull();
  });

  test("Particle uses its canonical receipt without promoting texture or visual PASS", () => {
    const particle = {
      valid: true, artifact_ready: true,
      source_path: null, wrote_to_path: "/rp/particles/spark.json",
      preview_path: null, preview_error: null,
      byte_length: 64, operation_count: 1,
      summary: { identifier: "test:spark", component_count: 1, diagnostics: [] },
      writes: [{ kind: "particle", path: "/rp/particles/spark.json",
        byte_length: 64, replaced_existing: false }],
    };
    const packet = buildControlDelta({
      capability: "manage_particle", phaseBefore: "animation",
      phaseAfter: "animation", projectUuid: UUID,
      succeeded: true, nativeInvocationVerified: true, result: particle,
    });
    expect(packet.verification_class).toBe("receipt_only");
    expect(packet.next_intent).toBe("REVIEW_PARTICLE_RESOURCE_DEPENDENCIES");
    expect(reduceControlExecutionState(null, packet).continuation.next_action)
      .toMatchObject({
        kind: "VERIFY_FOCUSED",
        target_domain: "ANIMATION",
        recommended_capability: null,
      });
    expect(reduceControlExecutionState(null, packet).continuation.next_action.reason)
      .toContain("resource references");
    const missing = buildControlDelta({
      capability: "manage_particle", phaseBefore: "animation",
      phaseAfter: "animation", projectUuid: UUID,
      succeeded: true, nativeInvocationVerified: true,
      result: { ...particle, wrote_to_path: null, writes: [] },
    });
    expect(missing.verification_class).toBe("focused_read");
    expect(missing.next_intent).toBe("INSPECT_OUTPUT_WRITE_OUTCOME_BEFORE_RETRY");

    const first = reduceControlExecutionState(null, packet, {
      taskContextId: "particle-and-model", cohortBoundary: "CONTINUE",
    });
    expect(first.continuation.next_action.kind).toBe("CONTINUE");
    expect(first.state.pending_verification?.verification_class).toBe("focused_read");
    const completed = reduceControlExecutionState(
      first.state,
      deltaForNative("project", nativeExport("project")),
      { taskContextId: "particle-and-model", cohortBoundary: "COMPLETE" }
    );
    expect(completed.continuation.next_action.kind).toBe("VERIFY_FOCUSED");
    expect(completed.continuation.cohort?.pending_verification_class)
      .toBe("focused_read");
    expect(completed.continuation.next_action.recommended_capability).toBeNull();
    expect(completed.continuation.next_action.target_domain).toBe("ANIMATION");
    expect(completed.continuation.next_action.reason)
      .toContain("prior Particle JSON write");
    expect(completed.continuation.next_action.reason)
      .toContain("requested deliverables");
    expect(completed.continuation.next_action.reason)
      .toContain("conditional-texture");
  });
});
