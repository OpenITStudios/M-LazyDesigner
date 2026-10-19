import { describe, expect, test } from "bun:test";
import { GatewayConnectionManager } from "./connectionManager";

describe("GatewayConnectionManager", () => {
  test("a cold offline status records one failure and repeated polls do not inflate it", () => {
    const manager = new GatewayConnectionManager();
    expect(manager.snapshot().state).toBe("offline");
    expect(manager.snapshot().reconnect.failures).toBe(0);
    const firstDelay = manager.markOffline();
    const first = manager.snapshot();
    expect(firstDelay).toBeGreaterThan(0);
    expect(first.reconnect.failures).toBe(1);
    expect(manager.needsMcpRevalidation()).toBe(true);
    const repeatedDelay = manager.markOffline();
    expect(manager.snapshot().reconnect.failures).toBe(1);
    expect(repeatedDelay).toBeLessThanOrEqual(firstDelay);
  });

  test("does not inflate backoff while remaining offline", () => {
    const manager = new GatewayConnectionManager();

    manager.beginProbe();
    const firstDelay = manager.markOffline();
    const first = manager.snapshot();

    const repeatedDelay = manager.markOffline();
    const repeated = manager.snapshot();

    expect(firstDelay).toBeGreaterThan(0);
    expect(repeatedDelay).toBeLessThanOrEqual(firstDelay);
    expect(repeated.reconnect.failures).toBe(first.reconnect.failures);
    expect(repeated.state).toBe("offline");
  });

  test("runtime availability clears reconnect cooldown immediately", () => {
    const manager = new GatewayConnectionManager();

    manager.beginProbe();
    manager.markOffline();
    expect(manager.snapshot().reconnect.failures).toBe(1);

    manager.markAvailable();

    const snapshot = manager.snapshot();
    expect(snapshot.state).toBe("degraded");
    expect(snapshot.reconnect.failures).toBe(0);
    expect(manager.needsMcpRevalidation()).toBe(true);
    expect(snapshot.reconnect.retry_after_ms).toBe(0);
    expect(manager.canAttempt()).toBe(true);
  });

  test("healthy status probes preserve MCP handshake backoff until a real reconnect", () => {
    const manager = new GatewayConnectionManager();
    manager.beginConnect();
    manager.markDegraded();
    const failed = manager.snapshot();
    expect(failed.state).toBe("degraded");
    expect(failed.reconnect.failures).toBe(1);
    expect(failed.reconnect.retry_after_ms).toBeGreaterThan(0);

    manager.markAvailable();
    manager.markAvailable();
    const probed = manager.snapshot();
    expect(probed.state).toBe("degraded");
    expect(probed.reconnect.failures).toBe(1);
    expect(manager.needsMcpRevalidation()).toBe(true);

    manager.beginConnect();
    manager.markReady({ catalogRefreshed: true });
    const recovered = manager.snapshot();
    expect(recovered.reconnect.failures).toBe(0);
    expect(recovered.reconnect.retry_after_ms).toBe(0);
    expect(manager.needsMcpRevalidation()).toBe(false);
  });

  test("repeated recovered health probes never erase MCP failure evidence", () => {
    const manager = new GatewayConnectionManager();
    manager.beginProbe();
    manager.markDegraded();
    manager.markAvailable();
    manager.markAvailable();
    expect(manager.snapshot().state).toBe("degraded");
    expect(manager.needsMcpRevalidation()).toBe(true);

    manager.beginProbe();
    expect(manager.needsMcpRevalidation()).toBe(true);
    manager.beginConnect();
    manager.markReady({ catalogRefreshed: true });
    expect(manager.needsMcpRevalidation()).toBe(false);
    expect(manager.snapshot().state).toBe("ready");
  });

  test("successful connection resets reconnect cooldown", () => {
    const manager = new GatewayConnectionManager();

    manager.beginProbe();
    manager.markOffline();
    expect(manager.snapshot().reconnect.failures).toBe(1);

    manager.beginConnect();
    manager.markReady({ catalogRefreshed: true });

    const snapshot = manager.snapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.reconnect.failures).toBe(0);
    expect(snapshot.reconnect.retry_after_ms).toBe(0);
    expect(snapshot.catalog_refresh_count).toBe(1);
    expect(snapshot.reconnect_count).toBe(0);
  });

  test("later reconnect is counted once", () => {
    const manager = new GatewayConnectionManager();

    manager.beginConnect();
    manager.markReady({ catalogRefreshed: true });
    manager.markDegraded();
    manager.beginConnect();
    manager.markReady({ catalogRefreshed: true });

    const snapshot = manager.snapshot();
    expect(snapshot.state).toBe("ready");
    expect(snapshot.reconnect_count).toBe(1);
    expect(snapshot.catalog_refresh_count).toBe(2);
  });
});
