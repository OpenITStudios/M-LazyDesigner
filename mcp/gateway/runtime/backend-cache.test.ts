import { describe, expect, test } from "bun:test";
import { BlockitRuntimeBackend } from "./backend";
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
