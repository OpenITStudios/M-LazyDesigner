import { describe, expect, test } from "bun:test";
import { GatewayCapabilityExecutor } from "./capabilityExecutor";
import { GatewaySessionState } from "../session/state";
import { LocalCapabilityRegistry } from "../providers/registry";
import type { BlockitRuntimeBackend } from "../runtime/backend";
import type { GatewayRuntimeInvocation } from "../runtime/backendContract";

const SHA = "sha256:" + "a".repeat(64);
const UUID = "native-fixture-1";

function nativeProjectReceipt() {
  return {
    project_format: "bedrock",
    codec: { id: "project", name: "Editable project", extension: "bbmodel" },
    project: { uuid: UUID, saved: true, save_path: "/rp/fixture.bbmodel" },
    byte_length: 128,
    compiled_payload_sha256: SHA,
    compiled_payload_sha256_scope: "NATIVE_CODEC_OUTPUT_BYTES",
    file_integrity_state: "READBACK_MATCHED",
    written_file_sha256: SHA,
    wrote_to_path: "/rp/fixture.bbmodel",
    save_behavior: "NATIVE_PROJECT_SAVE",
    truncated: false,
    content: null,
    project_lifecycle_changes: [],
  };
}

function executor(verified: string | null, receipt = nativeProjectReceipt()) {
  const backend = {
    async invokeCapabilityWithMetadata(
      capability: string,
      args: Record<string, unknown>
    ): Promise<GatewayRuntimeInvocation> {
      expect(capability).toBe("export_model");
      expect(args.codec_id).toBe("project");
      return {
        result: {
          content: [{
            type: "text",
            text: "Saved editable project /rp/fixture.bbmodel",
          }],
          structuredContent: receipt,
        },
        readOnly: false,
        verifiedProjectUuid: verified,
        phaseBefore: "geometry",
        observedRuntimeBuildIdentity: "fake-build",
      };
    },
  } as unknown as BlockitRuntimeBackend;
  return new GatewayCapabilityExecutor(
    backend, new LocalCapabilityRegistry(), new GatewaySessionState()
  );
}

function deltaFromGateway(value: unknown): Record<string, unknown> {
  const result = value as {
    isError?: boolean;
    structuredContent?: { control_delta?: Record<string, unknown> };
  };
  expect(result.isError).not.toBe(true);
  const delta = result.structuredContent?.control_delta;
  expect(delta).toBeDefined();
  return delta!;
}

describe("real Gateway executor invocation -> Control output receipt continuation", () => {
  test("Backend-confirmed native project receipt uses existing receipt-only Delta", async () => {
    const response = await executor(UUID).invoke("export_model", {
      codec_id: "project",
    });
    const delta = deltaFromGateway(response);
    expect(delta.project_uuid).toBe(UUID);
    expect(delta.verification_class).toBe("receipt_only");
    expect(delta.next_intent).toBe("VERIFY_REQUESTED_OUTPUT_SET_AND_APPROVALS");
    const continuation = delta.continuation as {
      next_action?: { kind?: string; reason?: string };
    } | undefined;
    expect(continuation?.next_action?.kind).toBe("CONTINUE");
    expect(continuation?.next_action?.reason).toContain("requested deliverables");
    expect(delta).not.toHaveProperty("output_evidence");
    expect(delta).not.toHaveProperty("finalization_ready");
    const data = (response as {
      structuredContent: Record<string, unknown>;
    }).structuredContent;
    // The native receipt remains available; no new public protocol field.
    expect(data.written_file_sha256).toBe(SHA);
  });

  test("unverified Backend project identity cannot promote client receipt", async () => {
    const response = await executor(null).invoke("export_model", {
      codec_id: "project",
    });
    const delta = deltaFromGateway(response);
    expect(delta.verification_class).not.toBe("receipt_only");
    expect(delta.next_intent).not.toBe("VERIFY_REQUESTED_OUTPUT_SET_AND_APPROVALS");
  });

  test("a native-reported hash disagreement preserves verification debt", async () => {
    const mismatch = nativeProjectReceipt();
    mismatch.written_file_sha256 = "sha256:" + "b".repeat(64);
    const delta = deltaFromGateway(
      await executor(UUID, mismatch).invoke("export_model", { codec_id: "project" })
    );
    expect(delta.verification_class).toBe("focused_read");
    expect(delta.next_intent).toBe("INSPECT_OUTPUT_WRITE_OUTCOME_BEFORE_RETRY");
    const continuation = delta.continuation as {
      next_action?: { kind?: string; reason?: string };
    } | undefined;
    expect(continuation?.next_action?.kind).toBe("VERIFY_FOCUSED");
    expect(continuation?.next_action?.reason).toContain("do not automatically retry");
  });
});
