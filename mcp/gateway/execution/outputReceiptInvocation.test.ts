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
  test("direct invoke blocks only the exact evaluated Graph branch", async () => {
    const calls: Array<{ capability: string; args: Record<string, unknown> }> = [];
    const backend = {
      async invokeCapabilityWithMetadata(
        capability: string,
        args: Record<string, unknown>
      ): Promise<GatewayRuntimeInvocation> {
        calls.push({ capability, args });
        return {
          result: {
            isError: true,
            content: [{ type: "text", text: "Runtime validated the operation." }],
            structuredContent: { code: "RUNTIME_SCHEMA_REJECTED" },
          },
          readOnly: false,
          verifiedProjectUuid: null,
          phaseBefore: "animation",
        };
      },
    } as unknown as BlockitRuntimeBackend;
    const session = new GatewaySessionState();
    session.replaceFacts({
      project_bound: false,
      animation_available: false,
    });
    const gateway = new GatewayCapabilityExecutor(
      backend, new LocalCapabilityRegistry(), session
    );

    // A higher-priority, unsupported discriminator is selected by Graph,
    // while resource_kind happens to match another declared branch. The
    // branchless Animation fallback has false prerequisites, but they
    // cannot be borrowed by that unsupported operation identity.
    const ambiguous = await gateway.invoke("manage_animation_controller", {
      operation: "future_unsupported",
      resource_kind: "client_entity",
    }) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(calls).toHaveLength(1);
    expect(calls[0]?.capability).toBe("manage_animation_controller");
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.structuredContent?.code).toBe("RUNTIME_SCHEMA_REJECTED");

    // An exact but graphless resource branch also has no permission to
    // borrow the generic controller fallback as a local preflight BLOCK.
    const graphless = await gateway.invoke("manage_animation_controller", {
      resource_kind: "client_entity",
    });
    expect((graphless as { isError?: boolean }).isError).toBe(true);
    expect(calls).toHaveLength(2);

    // An exact declared timeline Graph with known-false prerequisites must
    // still block before any new native invocation.
    const blocked = await gateway.invoke("manage_animation_timeline", {
      operation: "keyframes",
      action: "create",
    }) as {
      isError?: boolean;
      structuredContent?: { code?: string; requires?: string[] };
    };
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent?.code).toBe("CAPABILITY_PRECONDITION_BLOCKED");
    expect(blocked.structuredContent?.requires).toContain("animation_available");
    expect(calls).toHaveLength(2);
  });

  test("native Backend read-only decision cannot be promoted by a QUERY branch hint", async () => {
    const invokeWithBackendReadOnly = async (readOnly: boolean) => {
      const backend = {
        async invokeCapabilityWithMetadata(
          capability: string,
          args: Record<string, unknown>
        ): Promise<GatewayRuntimeInvocation> {
          expect(capability).toBe("manage_material_instances");
          expect(args.operation).toBe("list");
          return {
            result: {
              content: [{ type: "text", text: "Material instances inspected." }],
              structuredContent: { operation: "list", items: [] },
            },
            // This is the already-classified Backend decision, not an
            // unscreened Runtime ToolAnnotations.readOnlyHint.
            readOnly,
            verifiedProjectUuid: UUID,
            phaseBefore: "geometry",
          };
        },
      } as unknown as BlockitRuntimeBackend;
      return new GatewayCapabilityExecutor(
        backend, new LocalCapabilityRegistry(), new GatewaySessionState()
      ).invoke("manage_material_instances", { operation: "list" });
    };

    // The static manifest calls 'list' a QUERY, but it cannot override a
    // conservative native Backend readOnly=false in the Control projection.
    const conservative = await invokeWithBackendReadOnly(false) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(conservative.isError).not.toBe(true);
    expect(conservative.structuredContent?.items).toEqual([]);
    // The compact Control projection intentionally omits capability ID:
    // it is already known from the invoke request.
    expect(conservative.structuredContent?.control_delta).toMatchObject({
      project_uuid: UUID,
    });

    // The verified read-only fast path remains compact when the Backend
    // itself positively classifies the operation as safe.
    const confirmed = await invokeWithBackendReadOnly(true) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    expect(confirmed.isError).not.toBe(true);
    expect(confirmed.structuredContent?.items).toEqual([]);
    expect(confirmed.structuredContent).not.toHaveProperty("control_delta");
  });

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
