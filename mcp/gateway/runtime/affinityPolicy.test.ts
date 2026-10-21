import { describe, expect, test } from "bun:test";
import {
  resolveAuthoringPhaseAffinity,
  resolveProjectAffinity,
} from "./affinityPolicy";
import { GatewayBackendError, type HealthProbe } from "./backendContract";
import { BlockitRuntimeBackend } from "./backend";
import { GatewayConnectionManager } from "./connectionManager";

function health(input: {
  phase?: string;
  active?: string | null;
  requested?: string | null;
  available?: boolean | null;
  count?: number;
}) {
  return {
    product: {
      authoring_phase: input.phase ?? "geometry",
    },
    project_context: {
      active_project_uuid: input.active ?? "project-a",
      requested_project_uuid: input.requested ?? null,
      requested_project_available: input.available ?? null,
      open_project_count: input.count ?? 1,
    },
  };
}

describe("Gateway affinity policy", () => {
  test("adopts Runtime phase when Gateway phase is unset", () => {
    expect(
      resolveAuthoringPhaseAffinity(null, health({ phase: "texturing" }))
    ).toEqual({ value: "texturing", changed: true });
  });

  test("rejects Runtime phase drift from bound affinity", () => {
    expect(() =>
      resolveAuthoringPhaseAffinity(
        "geometry",
        health({ phase: "animation" })
      )
    ).toThrow(GatewayBackendError);
  });

  test("binds the only active project when explicitly requested", () => {
    expect(
      resolveProjectAffinity(
        null,
        health({
          active: "project-a",
          requested: null,
          available: null,
          count: 1,
        }),
        true
      )
    ).toEqual({ value: "project-a", changed: true });
  });

  test("fails closed when multiple projects are open", () => {
    expect(() =>
      resolveProjectAffinity(
        null,
        health({
          active: "project-a",
          requested: null,
          available: null,
          count: 2,
        }),
        true
      )
    ).toThrow(GatewayBackendError);
  });

  test("project creation refuses to discard affinity on different requested UUID", () => {
    for (const available of [false, true, null] as const) {
      expect(() =>
        resolveProjectAffinity(
          "project-a",
          health({
            active: "project-b",
            requested: "project-b",
            available,
            count: 2,
          }),
          false,
          true
        )
      ).toThrow(GatewayBackendError);
    }
  });

  test("ambiguous requested UUID cannot be cleared as missing during project creation", () => {
    expect(() => resolveProjectAffinity(
      "project-a",
      health({
        active: "project-b",
        requested: "project-a",
        available: null,
        count: 3,
      }),
      false,
      true,
    )).toThrow(GatewayBackendError);
  });

  test("project creation refuses to clear an unverified old project", () => {
    expect(() =>
      resolveProjectAffinity(
        "project-a",
        health({
          active: "project-b",
          requested: "project-a",
          available: null,
          count: 2,
        }),
        false,
        true
      )
    ).toThrow(GatewayBackendError);
  });

  test("failed first profile does not partially pin phase before project validation", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const internal = backend as unknown as {
      authoringPhase: "geometry" | "texturing" | "animation" | null;
      projectUuid: string | null;
      connection: GatewayConnectionManager;
      probeHealth: () => Promise<HealthProbe>;
      ensureCatalogUnsafe: (bindProject: boolean) => Promise<void>;
      connectFreshUnsafe: (signature: string) => Promise<void>;
    };
    let servedHealth: HealthProbe = {
      online: true,
      signature: "wrong-profile",
      health: { product: { authoring_phase: "geometry" } },
    };
    internal.probeHealth = async () => {
      internal.connection.markAvailable();
      return servedHealth;
    };
    let connects = 0;
    internal.connectFreshUnsafe = async () => {
      connects += 1;
      internal.connection.markReady();
    };

    await expect(internal.ensureCatalogUnsafe(true)).rejects.toMatchObject({
      code: "PROJECT_CONTEXT_LOST",
    });
    expect(internal.authoringPhase).toBeNull();
    expect(internal.projectUuid).toBeNull();
    expect(connects).toBe(0);

    servedHealth = {
      online: true,
      signature: "correct-profile",
      health: {
        product: { authoring_phase: "animation" },
        project_context: {
          active_project_uuid: "project-a",
          requested_project_uuid: null,
          requested_project_available: null,
          open_project_count: 1,
        },
      },
    };
    await internal.ensureCatalogUnsafe(true);
    expect(internal.authoringPhase).toBe("animation");
    expect(internal.projectUuid).toBe("project-a");
    expect(connects).toBe(1);
  });



  test("post-handshake verification accepts the same Runtime and bound project", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.authoringPhase = "animation";
    state.projectUuid = "project-a";
    const observed: string[] = [];
    state.probeHealth = async (_project?: string, passive?: boolean) => {
      observed.push(passive ? "passive" : "active");
      return {
        online: true,
        signature: "runtime-instance-A",
        health: health({
          phase: "animation",
          active: "project-b",
          requested: "project-a",
          available: true,
          count: 2,
        }),
      };
    };
    await state.verifyPostHandshakeRuntimeUnsafe("runtime-instance-A");
    expect(observed).toEqual(["passive"]);
    expect(state.projectUuid).toBe("project-a");
    expect(state.authoringPhase).toBe("animation");
  });

  test("post-handshake verification rejects a Runtime generation changed during tools/list", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.authoringPhase = "geometry";
    state.probeHealth = async () => ({
      online: true,
      signature: "runtime-reloaded-B",
      health: health({ phase: "geometry" }),
    });
    await expect(state.verifyPostHandshakeRuntimeUnsafe("runtime-old-A"))
      .rejects.toMatchObject({
        code: "BACKEND_UNAVAILABLE",
        safeToRetry: true,
      });
    expect(state.authoringPhase).toBe("geometry");
    expect(state.projectUuid).toBeNull();
  });

  test("post-handshake verification rejects lost or ambiguous bound project despite same Runtime signature", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.authoringPhase = "texturing";
    state.projectUuid = "project-a";
    for (const available of [false, null] as const) {
      state.probeHealth = async () => ({
        online: true,
        signature: "runtime-instance-A",
        health: health({
          phase: "texturing",
          requested: "project-a",
          available,
          count: 2,
        }),
      });
      await expect(state.verifyPostHandshakeRuntimeUnsafe("runtime-instance-A"))
        .rejects.toMatchObject({ code: "PROJECT_CONTEXT_LOST", safeToRetry: false });
      expect(state.projectUuid).toBe("project-a");
    }
  });

  test("post-handshake Stage drift fails closed without adopting a different Stage", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.authoringPhase = "geometry";
    state.probeHealth = async () => ({
      online: true,
      signature: "runtime-instance-A",
      health: health({ phase: "animation" }),
    });
    await expect(state.verifyPostHandshakeRuntimeUnsafe("runtime-instance-A"))
      .rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE", safeToRetry: false });
    expect(state.authoringPhase).toBe("geometry");
  });

  test("handshake failure retains the non-retryable affinity error contract", async () => {
    const code = await Bun.file("gateway/runtime/backend.ts").text();
    const start = code.indexOf("private async connectFreshUnsafe(");
    const end = code.indexOf("private async ensureCatalogUnsafe(", start);
    const handshake = code.slice(start, end);
    expect(handshake).toContain("await this.verifyPostHandshakeRuntimeUnsafe(signature);");
    expect(handshake).toContain("if (error instanceof GatewayBackendError && !error.safeToRetry)");
    expect(handshake).toContain("throw error;");
    expect(handshake.indexOf("await this.verifyPostHandshakeRuntimeUnsafe(signature);"))
      .toBeLessThan(handshake.indexOf("this.client = client;"));
  });

  test("post-handshake verification rejects an offline confirmation without catalog acceptance", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const state = backend as any;
    state.probeHealth = async () => ({ online: false, error: "listener retired" });
    await expect(state.verifyPostHandshakeRuntimeUnsafe("runtime-old-A"))
      .rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE", safeToRetry: true });
    expect(state.client).toBeNull();
    expect(state.catalog.size).toBe(0);
  });

  test("explicit rebind refuses duplicate tab UUID without changing its prior affinity", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const internal = backend as unknown as {
      projectUuid: string | null;
      authoringPhase: "geometry" | "texturing" | "animation" | null;
      probeHealth: (requested?: string) => Promise<HealthProbe>;
    };
    internal.projectUuid = "previous-uuid";
    const probes: Array<string | undefined> = [];
    internal.probeHealth = async requested => {
      probes.push(requested);
      return {
        online: true,
        signature: "same-runtime",
        health: health({
          active: "duplicate-id",
          requested: requested ?? "previous-uuid",
          available: requested ? null : true,
          count: 3,
        }),
      };
    };

    await expect(backend.adoptActiveProject()).rejects.toMatchObject({
      code: "PROJECT_CONTEXT_LOST",
      safeToRetry: false,
    });
    expect(probes).toEqual([undefined, "duplicate-id"]);
    expect(internal.projectUuid).toBe("previous-uuid");
    expect(internal.authoringPhase).toBeNull();
  });

  test("explicit rebind rejects Runtime replacement between passive and unique-project probes", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const internal = backend as unknown as {
      projectUuid: string | null;
      probeHealth: (requested?: string) => Promise<HealthProbe>;
    };
    internal.projectUuid = "previous-uuid";
    internal.probeHealth = async requested => ({
      online: true,
      signature: requested ? "new-runtime" : "previous-runtime",
      health: health({
        active: "project-new",
        requested: requested ?? "previous-uuid",
        available: true,
        count: 2,
      }),
    });
    await expect(backend.adoptActiveProject()).rejects.toMatchObject({
      code: "PROJECT_CONTEXT_LOST",
    });
    expect(internal.projectUuid).toBe("previous-uuid");
  });

  test("explicit rebind adopts a unique selected tab after two matching-generation probes", async () => {
    const backend = new BlockitRuntimeBackend("http://127.0.0.1:3000/bb-mcp");
    const internal = backend as unknown as {
      projectUuid: string | null;
      probeHealth: (requested?: string) => Promise<HealthProbe>;
    };
    internal.projectUuid = "previous-uuid";
    const probes: Array<string | undefined> = [];
    internal.probeHealth = async requested => {
      probes.push(requested);
      return {
        online: true,
        signature: "same-runtime",
        health: health({
          active: "project-new",
          requested: requested ?? "previous-uuid",
          available: true,
          count: 2,
        }),
      };
    };
    const status = await backend.adoptActiveProject();
    expect(status.affinity.project_uuid).toBe("project-new");
    expect(internal.projectUuid).toBe("project-new");
    expect(probes).toEqual([undefined, "project-new", undefined]);
  });

  test("can clear a missing bound project only for explicit transition flows", () => {
    expect(
      resolveProjectAffinity(
        "project-a",
        health({
          active: "project-b",
          requested: "project-a",
          available: false,
          count: 1,
        }),
        false,
        true
      )
    ).toEqual({ value: null, changed: true });
  });
});
