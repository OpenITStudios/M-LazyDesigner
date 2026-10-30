import { describe, expect, test } from "bun:test";
import { BlockitRuntimeBackend } from "./backend";
import {
  createRuntimeSignature,
  sameRuntimeGenerationAfterPlannedHandoff,
} from "./identity";
import type { BackendTool } from "../contracts/protocol";

function primeCatalog(backend: BlockitRuntimeBackend, tools: BackendTool[]): void {
  const state = backend as unknown as {
    client: object | null;
    connectedSignature: string | null;
    catalog: Map<string, BackendTool>;
    catalogValidatedAt: number;
  };
  state.client = {};
  state.connectedSignature = "runtime-test";
  state.catalog = new Map(tools.map((tool) => [tool.name, tool]));
  state.catalogValidatedAt = Date.now();
}

describe("BlockitRuntimeBackend catalog fast path", () => {
  const runtimeSignature = (
    phase: "geometry" | "texturing" | "animation",
    overrides: Record<string, unknown> = {}
  ) => createRuntimeSignature({
    build_identity: "sha256:" + "a".repeat(64),
    instance_id: "runtime-process-a",
    startup_time: "2026-10-30T12:00:00.000Z",
    product: {
      id: "lazydesigner",
      version: "0.1",
      profile: "bedrock_entity",
      authoring_phase: phase,
    },
    exposed_tool_count: phase === "animation" ? 18 : 47,
    ...overrides,
  });

  test("planned Stage reconnect requires the same verifiable Runtime generation", () => {
    const geometry = runtimeSignature("geometry");
    const texturing = runtimeSignature("texturing");
    const animation = runtimeSignature("animation");
    for (const next of [geometry, texturing, animation]) {
      expect(sameRuntimeGenerationAfterPlannedHandoff(geometry, next)).toBe(true);
    }
    for (const changed of [
      runtimeSignature("texturing", { instance_id: "runtime-process-b" }),
      runtimeSignature("texturing", { startup_time: "2026-10-30T12:01:00.000Z" }),
      runtimeSignature("texturing", { build_identity: "sha256:" + "b".repeat(64) }),
      runtimeSignature("texturing", { product: {
        id: "lazydesigner", version: "0.1", profile: "extended",
        authoring_phase: "texturing",
      } }),
      runtimeSignature("texturing", { exposed_tool_count: null }),
      runtimeSignature("texturing", { instance_id: null, startup_time: null }),
    ]) {
      expect(sameRuntimeGenerationAfterPlannedHandoff(geometry, changed)).toBe(false);
    }
    const noProcessIdentity = runtimeSignature("geometry", {
      instance_id: null, startup_time: null,
    });
    expect(sameRuntimeGenerationAfterPlannedHandoff(noProcessIdentity, texturing)).toBe(false);
    expect(sameRuntimeGenerationAfterPlannedHandoff(null, texturing)).toBe(false);
    expect(sameRuntimeGenerationAfterPlannedHandoff("invalid JSON", texturing)).toBe(false);
  });

  test("planned Stage handoff is single-use, bound to the project, and cleared by loss", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as unknown as {
      projectUuid: string | null;
      pendingStageHandoff: { signature: string; projectUuid: string | null } | null;
      consumeVerifiedPlannedHandoff: (signature: string) => boolean;
      closeConnectionUnsafe: () => Promise<void>;
    };
    const geometry = runtimeSignature("geometry");
    const texturing = runtimeSignature("texturing");
    state.projectUuid = "project-a";
    state.pendingStageHandoff = { signature: geometry, projectUuid: "project-a" };
    expect(state.consumeVerifiedPlannedHandoff(texturing)).toBe(true);
    expect(state.pendingStageHandoff).toBeNull();
    expect(state.consumeVerifiedPlannedHandoff(texturing)).toBe(false);

    state.pendingStageHandoff = { signature: geometry, projectUuid: "project-a" };
    state.projectUuid = "project-b";
    expect(state.consumeVerifiedPlannedHandoff(texturing)).toBe(false);
    state.pendingStageHandoff = { signature: geometry, projectUuid: "project-b" };
    await state.closeConnectionUnsafe();
    expect(state.pendingStageHandoff).toBeNull();
  });

  test("same-Stage receipts reuse the catalog; mismatched handoffs fail closed", async () => {
    const fixture = (
      phase: "geometry" | "texturing",
      surfaceChanged: boolean,
      runtimeSurface: "AUTHORING" | "ANIMATION" = "AUTHORING"
    ) => {
      const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
      const state = backend as any;
      const sourceSignature = runtimeSignature("geometry");
      let closes = 0;
      const client = {
        close: async () => { closes++; },
        callTool: async () => ({
          content: [{ type: "text", text: "Stage transition receipt" }],
          structuredContent: {
            phase,
            runtime_surface: runtimeSurface,
            reason: "continue authoring",
            resume_from: "same project",
            readiness_summary: null,
            surface_changed: surfaceChanged,
            reload_required: false,
            action: "continue",
          },
        }),
      };
      state.projectUuid = "project-a";
      state.authoringPhase = "geometry";
      state.client = client;
      state.connectedSignature = sourceSignature;
      state.catalog = new Map([[
        "switch_authoring_phase",
        { name: "switch_authoring_phase", annotations: { readOnlyHint: false } },
      ]]);
      state.catalogValidatedAt = Date.now();
      // Existing transport/affinity tests own the real preflight. This
      // isolates the backend's decision after one validated tool receipt.
      state.ensureCatalogUnsafe = async () => {};
      return { backend, state, client, sourceSignature, closes: () => closes };
    };

    const unchanged = fixture("geometry", false);
    const same = await unchanged.backend.invokeCapabilityWithMetadata(
      "switch_authoring_phase", { target_phase: "geometry" }
    );
    expect(unchanged.state.client).toBe(unchanged.client);
    expect(unchanged.state.catalog.size).toBe(1);
    expect(unchanged.state.pendingStageHandoff).toBeNull();
    expect(unchanged.closes()).toBe(0);
    expect(same.result.structuredContent).toMatchObject({
      phase: "geometry", surface_changed: false,
    });
    expect(same.phaseBefore).toBe("geometry");
    expect(same.result.structuredContent).not.toHaveProperty(
      "gateway_catalog_invalidated"
    );

    const changed = fixture("texturing", false);
    const transition = await changed.backend.invokeCapabilityWithMetadata(
      "switch_authoring_phase", { target_phase: "texturing" }
    );
    expect(changed.closes()).toBe(1);
    expect(changed.state.client).toBeNull();
    expect(changed.state.catalog.size).toBe(0);
    expect(changed.state.pendingStageHandoff).toEqual({
      signature: changed.sourceSignature,
      projectUuid: "project-a",
    });
    expect(transition.result.structuredContent).toMatchObject({
      phase: "texturing", gateway_catalog_invalidated: true,
      client_reconnect_required: false,
    });
    expect(transition.phaseBefore).toBe("geometry");

    // A same-Stage receipt claiming a different Runtime surface cannot
    // silently keep the previous catalog or suppress subsequent recovery.
    const contradictory = fixture("geometry", true);
    await expect(contradictory.backend.invokeCapabilityWithMetadata(
      "switch_authoring_phase", { target_phase: "geometry" }
    )).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      details: { receipt_issue: "SURFACE_CHANGE_MISMATCH" },
    });
    expect(contradictory.closes()).toBe(1);
    expect(contradictory.state.pendingStageHandoff).toBeNull();

    const wrongSurface = fixture("geometry", false, "ANIMATION");
    await expect(wrongSurface.backend.invokeCapabilityWithMetadata(
      "switch_authoring_phase", { target_phase: "geometry" }
    )).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      details: { receipt_issue: "RUNTIME_SURFACE_MISMATCH" },
    });
    expect(wrongSurface.closes()).toBe(1);
    expect(wrongSurface.state.pendingStageHandoff).toBeNull();

    const wrongTarget = fixture("texturing", false);
    await expect(wrongTarget.backend.invokeCapabilityWithMetadata(
      "switch_authoring_phase", { target_phase: "animation" }
    )).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      details: { receipt_issue: "AUTHORING_TARGET_MISMATCH" },
    });
    expect(wrongTarget.state.authoringPhase).toBe("geometry");
    expect(wrongTarget.closes()).toBe(1);
  });

  test("successful native call carries its existing verified project identity", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.projectUuid = "project-verified";
    state.authoringPhase = "geometry";
    state.client = {
      callTool: async () => ({
        content: [],
        structuredContent: { execution: "applied" },
      }),
    };
    state.catalog = new Map([[
      "manage_cubes",
      { name: "manage_cubes", annotations: { readOnlyHint: false } },
    ]]);
    // The independent affinity test owns real health/preflight. Here the
    // already-verified identity must survive the normal call path.
    state.ensureCatalogUnsafe = async () => {};
    const result = await backend.invokeCapabilityWithMetadata(
      "manage_cubes", { operation: "update" }
    );
    expect(result.verifiedProjectUuid).toBe("project-verified");
    expect(result.phaseBefore).toBe("geometry");
    expect(result.result.isError).not.toBe(true);
  });

  test("search uses a fresh local catalog without probing Runtime", async () => {
    const backend = new BlockitRuntimeBackend(undefined, undefined, {
      catalogLeaseMs: 5_000,
    });
    primeCatalog(backend, [
      {
        name: "manage_cubes",
        description: "Create and edit cubes",
        annotations: { readOnlyHint: false },
      },
    ]);

    const result = await backend.searchCapabilities("cube", 4);
    expect(result.map((item) => item.capability_id)).toContain("manage_cubes");
  });

  test("search waits for an in-flight Stage/catalog update instead of returning the old tool surface", async () => {
    const backend = new BlockitRuntimeBackend(undefined, undefined, { catalogLeaseMs: 5_000 });
    const before: BackendTool = {
      name: "manage_cubes", description: "Legacy Geometry surface",
      annotations: { readOnlyHint: false },
    };
    const after: BackendTool = {
      name: "create_animation", description: "Updated Animation surface",
      annotations: { readOnlyHint: false },
    };
    primeCatalog(backend, [before]);
    let started!: () => void;
    let release!: () => void;
    const entering = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const queue = (backend as any).operationQueue as {
      run<T>(task: () => Promise<T>): Promise<T>;
    };
    const mutation = queue.run(async () => {
      started();
      await blocked;
      primeCatalog(backend, [after]);
      (backend as any).authoringPhase = "animation";
    });
    await entering;
    const pending = backend.searchCapabilities("create_animation", 4);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    try {
      release();
      await mutation;
      const capabilities = await pending;
      expect(capabilities.map(item => item.capability_id)).toContain("create_animation");
      expect(capabilities.map(item => item.capability_id)).not.toContain("manage_cubes");
    } finally {
      release();
    }
  });

  test("describe cannot return a definition retired by an in-flight Runtime reconnect", async () => {
    const backend = new BlockitRuntimeBackend(undefined, undefined, { catalogLeaseMs: 5_000 });
    const before: BackendTool = {
      name: "inspect_elements", description: "Old version",
      annotations: { readOnlyHint: true },
    };
    const after: BackendTool = {
      name: "manage_cubes", description: "Current version",
      annotations: { readOnlyHint: false },
    };
    primeCatalog(backend, [before]);
    let started!: () => void;
    let release!: () => void;
    const entering = new Promise<void>(resolve => { started = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const queue = (backend as any).operationQueue as {
      run<T>(task: () => Promise<T>): Promise<T>;
    };
    const reconnect = queue.run(async () => {
      started();
      await blocked;
      primeCatalog(backend, [after]);
    });
    await entering;
    const pending = backend.describeCapability("inspect_elements");
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    try {
      release();
      await reconnect;
      await expect(pending).rejects.toMatchObject({
        code: "CAPABILITY_NOT_FOUND",
      });
      await expect(backend.describeCapability("manage_cubes")).resolves.toMatchObject({
        name: "manage_cubes",
      });
    } finally {
      release();
    }
  });




  test("status observations during an active Runtime transition do not claim readiness", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    const responses: Array<(value: unknown) => void> = [];
    state.probeHealth = () => new Promise(resolve => { responses.push(resolve); });
    state.connection.markReady();
    let begin!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { begin = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const transition = state.runExclusive(async () => {
      begin();
      await blocked;
    });
    await entered;
    try {
      const status = backend.getStatus();
      responses[0]!({
        online: true,
        signature: "old-runtime",
        health: { product: { authoring_phase: "geometry" } },
      });
      await Promise.resolve();
      expect(responses).toHaveLength(2);
      responses[1]!({
        online: true,
        signature: "old-runtime",
        health: { product: { authoring_phase: "geometry" } },
      });
      await expect(status).rejects.toMatchObject({
        details: { reason: "SUPERSEDED_STATUS_PROBE", executed: false },
      });
      expect(state.connection.snapshot().state).toBe("ready");
      expect(state.lastVerifiedHealthSignature).toBeNull();
    } finally {
      release();
      await transition;
    }
  });

  test("late offline status cannot revoke a newer Gateway reconnect", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    const responses: Array<(value: unknown) => void> = [];
    state.probeHealth = () => new Promise(resolve => { responses.push(resolve); });
    state.connection.markReady({ catalogRefreshed: true });

    const pending = backend.getStatus();
    expect(responses).toHaveLength(1);
    // Native reconnect or phase/catalog swap completes while passive health
    // is pending; the older /health result must not mark the session offline.
    await state.runExclusive(async () => undefined);
    responses[0]!({ online: false, error: "old transport failed" });
    await Promise.resolve();
    expect(responses).toHaveLength(2); // One bounded retry.
    const connected = state.connection.snapshot();
    responses[1]!({
      online: true,
      signature: "fresh-runtime",
      health: { product: { authoring_phase: "geometry" } },
    });
    const result = await pending;
    expect(result.runtime.online).toBe(true);
    expect(result.runtime.runtime_signature).toBe("fresh-runtime");
    expect(state.connection.needsMcpRevalidation()).toBe(false);
    expect(connected.state).toBe("ready");
  });

  test("older passive status reply cannot overwrite newer health proof", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    const responses: Array<(value: unknown) => void> = [];
    state.probeHealth = () => new Promise(resolve => { responses.push(resolve); });
    const first = backend.getStatus();
    const second = backend.getStatus();
    expect(responses).toHaveLength(2);
    responses[1]!({
      online: true,
      signature: "runtime-new",
      health: { product: { authoring_phase: "geometry" } },
    });
    const latest = await second;
    expect(latest.runtime.runtime_signature).toBe("runtime-new");
    responses[0]!({ online: false, error: "outdated failure" });
    await Promise.resolve();
    expect(responses).toHaveLength(3);
    responses[2]!({
      online: true,
      signature: "runtime-new",
      health: { product: { authoring_phase: "geometry" } },
    });
    const recovered = await first;
    expect(recovered.runtime.online).toBe(true);
    expect(state.connection.needsMcpRevalidation()).toBe(false);
    expect(state.lastVerifiedHealthSignature).toBe("runtime-new");
  });

  test("repeated superseded observations fail without changing connection authority", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    const responses: Array<(value: unknown) => void> = [];
    state.probeHealth = () => new Promise(resolve => { responses.push(resolve); });
    state.connection.markReady();
    const pending = backend.getStatus();
    await state.runExclusive(async () => undefined);
    responses[0]!({ online: false, error: "old failure" });
    await Promise.resolve();
    await state.runExclusive(async () => undefined);
    responses[1]!({ online: false, error: "also old" });
    await expect(pending).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      safeToRetry: true,
      details: { reason: "SUPERSEDED_STATUS_PROBE", executed: false },
    });
    expect(state.connection.snapshot().state).toBe("ready");
    expect(state.connection.needsMcpRevalidation()).toBe(false);
  });


  test("passive offline health fails closed and invokes the existing session invalidation callback", () => {
    let invalidations = 0;
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp", undefined, {
      onRuntimeUnavailable: () => { invalidations += 1; },
    });
    primeCatalog(backend, [{
      name: "manage_cubes", description: "Native geometry", annotations: { readOnlyHint: false },
    }]);
    const internal = backend as any;
    internal.projectUuid = "project-bound";
    internal.connection.markReady({ catalogRefreshed: true });

    const result = internal.buildStatus({ online: false, error: "Runtime listener stopped" });
    expect(result.runtime.online).toBe(false);
    expect(result.runtime.mcp_client_ready).toBe(false);
    expect(result.runtime.catalog_stale).toBe(true);
    expect(result.connection.state).toBe("offline");
    expect(internal.projectUuid).toBe("project-bound");
    expect(invalidations).toBe(1);
  });

  test("closed or ambiguous bound tab cannot project a ready MCP connection", () => {
    for (const available of [false, null] as const) {
      let invalidations = 0;
      const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp", undefined, {
        onRuntimeUnavailable: () => { invalidations += 1; },
        catalogLeaseMs: 5_000,
      });
      primeCatalog(backend, [{
        name: "inspect_elements", description: "Read native model", annotations: { readOnlyHint: true },
      }]);
      const state = backend as any;
      state.connection.markReady();
      state.projectUuid = "project-a";
      const result = state.buildStatus({
        online: true,
        signature: "runtime-test",
        health: {
          product: { authoring_phase: "geometry" },
          project_context: {
            active_project_uuid: "project-b",
            requested_project_uuid: "project-a",
            requested_project_available: available,
            open_project_count: 2,
          },
        },
      });
      expect(result.runtime.online).toBe(true);
      expect(result.runtime.mcp_client_ready).toBe(false);
      expect(result.runtime.catalog_stale).toBe(true);
      expect(result.connection.state).toBe("degraded");
      expect(state.hasFreshCatalog()).toBe(false);
      expect(state.projectUuid).toBe("project-a");
      expect(invalidations).toBe(1);
    }
  });

  test("passive health detects a Runtime generation signature change before reconnect", () => {
    let invalidations = 0;
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp", undefined, {
      onRuntimeUnavailable: () => { invalidations += 1; },
    });
    primeCatalog(backend, [{
      name: "inspect_elements", description: "Read model", annotations: { readOnlyHint: true },
    }]);
    (backend as any).connection.markReady();
    const result = (backend as any).buildStatus({
      online: true,
      signature: "replacement-instance",
      health: { product: { authoring_phase: "geometry" } },
    });
    expect(result.runtime.mcp_client_ready).toBe(false);
    expect(result.runtime.catalog_stale).toBe(true);
    expect(result.connection.state).toBe("degraded");
    expect((backend as any).hasFreshCatalog()).toBe(false);
    expect(invalidations).toBe(1);
  });

  test("failed Runtime health during recovery invalidates session facts", async () => {
    let invalidations = 0;
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp", undefined, {
      onRuntimeUnavailable: () => { invalidations += 1; },
    });
    const state = backend as any;
    state.probeHealth = async () => ({ online: false, error: "listener retired" });
    await expect(state.ensureCatalogUnsafe()).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
    });
    expect(invalidations).toBe(1);
  });

  test("gateway status handler does not reassert stale project affinity on offline health", async () => {
    const source = await Bun.file("gateway/handlers/registerCoreTools.ts").text();
    const start = source.indexOf("const status = adopt_active_project");
    const end = source.indexOf("const control = await buildControlPacket", start);
    const projection = source.slice(start, end);
    expect(projection).toContain("if (status.runtime.mcp_client_ready)");
    expect(projection).toContain("session.onVerifiedRuntimeStatus(status.affinity.project_uuid)");
    expect(projection).toContain("session.onRuntimeUnavailable()");
    expect(projection).not.toContain("session.synchronizeProject(status.affinity.project_uuid)");
  });

  test("passive status never renews a stale capability catalog lease", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp", undefined, {
      catalogLeaseMs: 5_000,
    });
    primeCatalog(backend, [{
      name: "manage_cubes",
      description: "Authoring capability",
      annotations: { readOnlyHint: false },
    }]);
    const internal = backend as any;
    internal.connection.markReady({ catalogRefreshed: true });
    const oldValidation = Date.now() - 10_000;
    internal.catalogValidatedAt = oldValidation;
    const probe = {
      online: true as const,
      signature: "runtime-test",
      health: { product: { authoring_phase: "geometry" } },
    };
    const first = internal.buildStatus(probe);
    const second = internal.buildStatus(probe);
    expect(first.runtime.mcp_client_ready).toBe(true);
    expect(first.runtime.catalog_stale).toBe(true);
    expect(second.runtime.catalog_stale).toBe(true);
    expect(internal.catalogValidatedAt).toBe(oldValidation);
    expect(internal.hasFreshCatalog()).toBe(false);
  });

  test("status does not claim a ready MCP catalog when the transport lists no tools", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    primeCatalog(backend, []);
    const internal = backend as any;
    internal.connection.markReady();
    const status = internal.buildStatus({
      online: true,
      signature: "runtime-test",
      health: { product: { authoring_phase: "geometry" } },
    });
    expect(status.runtime.mcp_client_ready).toBe(false);
    expect(status.runtime.catalog_count).toBe(0);
    expect(status.runtime.catalog_stale).toBe(false);
  });

  test("accepts a distinct paginated Runtime tool catalog", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const first: BackendTool = {
      name: "inspect_elements", description: "Inspect model",
      annotations: { readOnlyHint: true },
    };
    const second: BackendTool = {
      name: "manage_cubes", description: "Edit geometry",
      annotations: { readOnlyHint: false },
    };
    let calls = 0;
    const listed = await (backend as any).listAllTools({
      listTools: async (input?: { cursor?: string }) => {
        calls += 1;
        if (input?.cursor === "second-page") return { tools: [second] };
        expect(input).toBeUndefined();
        return { tools: [first], nextCursor: "second-page" };
      },
    });
    expect(listed).toEqual([first, second]);
    expect(calls).toBe(2);
  });

  test("rejects duplicate, blank and empty Runtime tool catalogs before readiness", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const tool: BackendTool = {
      name: "inspect_elements", description: "Inspect model",
    };
    await expect((backend as any).listAllTools({
      listTools: async () => ({ tools: [] }),
    })).rejects.toThrow("empty capability catalog");

    for (const name of ["", "  "]) {
      await expect((backend as any).listAllTools({
        listTools: async () => ({ tools: [{ ...tool, name }] }),
      })).rejects.toThrow("invalid or duplicate capability name");
    }

    await expect((backend as any).listAllTools({
      listTools: async (input?: { cursor?: string }) =>
        input?.cursor === "next"
          ? { tools: [{ ...tool, description: "Conflicting duplicate" }] }
          : { tools: [tool], nextCursor: "next" },
    })).rejects.toThrow("invalid or duplicate capability name");
  });

  test("stops repeating Runtime tool-list cursors without a hundred remote requests", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    let calls = 0;
    await expect((backend as any).listAllTools({
      listTools: async () => ({
        tools: [{ name: `tool-${++calls}`, description: "Fixture" }],
        nextCursor: "same-page",
      }),
    })).rejects.toThrow("repeated a pagination cursor");
    expect(calls).toBe(2);
  });

  test("describe uses a fresh local catalog without probing Runtime", async () => {
    const backend = new BlockitRuntimeBackend(undefined, undefined, {
      catalogLeaseMs: 5_000,
    });
    primeCatalog(backend, [
      {
        name: "inspect_elements",
        description: "Inspect model elements",
        annotations: { readOnlyHint: true },
      },
    ]);

    const tool = await backend.describeCapability("inspect_elements");
    expect(tool.name).toBe("inspect_elements");
  });
});
