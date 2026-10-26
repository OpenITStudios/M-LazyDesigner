import { describe, expect, test } from "bun:test";
import { GatewayCapabilityExecutor } from "@/gateway/execution/capabilityExecutor";
import { GatewaySessionState } from "@/gateway/session/state";
import { seedCapabilityFacts } from "@/gateway/capabilities/graph";

describe("stable Gateway invoke prerequisite enforcement", () => {
  test("known-absent prerequisites block before any Runtime or local mutation", async () => {
    let invoked = 0;
    const session = new GatewaySessionState();
    session.replaceFacts(seedCapabilityFacts({ projectBound: false }));
    const records: Array<{ kind: string; success: boolean; capability: string }> = [];
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => {
          invoked++;
          throw new Error("Unexpected Runtime call");
        },
      } as any,
      { invoke: async () => { invoked++; return null; } } as any,
      session,
      {
        startedAt: () => Date.now(),
        record: (event: { kind: string; success: boolean; capability: string }) => {
          records.push(event);
        },
      } as any
    );
    const result = await executor.invoke("manage_cubes", { operation: "create" }) as any;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("CAPABILITY_PRECONDITION_BLOCKED");
    expect(result.structuredContent.requires).toContain("project_bound");
    expect(invoked).toBe(0);
    expect(records).toEqual([
      expect.objectContaining({
        kind: "recovery", success: false, capability: "manage_cubes",
      }),
    ]);
  });

  test("a Runtime generation change invalidates stale prerequisite facts", () => {
    const session = new GatewaySessionState();
    session.synchronizeProject("active-model-a");
    expect(session.facts.project_bound).toBe(true);
    session.onRuntimeGenerationChange(null);
    expect(session.projectUuid).toBeNull();
    expect(session.facts.project_bound).toBe("unknown");
  });

  test("unknown preconditions retain Runtime authority instead of false blocking", async () => {
    let called = false;
    const session = new GatewaySessionState();
    session.replaceFacts(seedCapabilityFacts({ projectBound: true }));
    const executor = new GatewayCapabilityExecutor(
      {
        invokeCapabilityWithMetadata: async () => {
          called = true;
          throw new Error("Runtime received request");
        },
      } as any,
      { invoke: async () => null } as any,
      session
    );
    await executor.invoke("manage_material", { operation: "configure" });
    expect(called).toBe(true);
  });
});
