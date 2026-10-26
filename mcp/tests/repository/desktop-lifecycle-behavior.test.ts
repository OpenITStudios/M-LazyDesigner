import { describe, expect, test } from "bun:test";
import { connectionChanged, type ConnectionBaseline, type ConnectionObservation } from "../../../apps/desktop/src/connectionWatch";
import { createConnectionMonitor } from "../../../apps/desktop/src/connectionMonitor";
import { createEditorOperations } from "../../../apps/desktop/src/editorOperations";
import type { DesktopInvoke } from "../../../apps/desktop/src/desktopTypes";
import { createSetupOperations } from "../../../apps/desktop/src/setupOperations";
import { subscribeManagedProgress } from "../../../apps/desktop/src/managedProgress";
import type { ManagedProgress } from "../../../apps/desktop/src/desktopTypes";
import { observeStatus } from "../../../apps/desktop/src/statusObservation";

describe("Desktop setup ordering", () => {
  test("legacy migration is requested only by the explicit setup action", async () => {
    const calls: unknown[] = [];
    const invoke: DesktopInvoke = async (_command, args) => { calls.push(args); return { receipt: { status: "STAGED" } } as never; };
    const hooks = { refresh: async () => {}, onReadiness: () => {}, onBootstrap: () => {} };
    await createSetupOperations(invoke).install(hooks);
    await createSetupOperations(invoke).install(hooks, true);
    expect(calls).toEqual([undefined, { migrateLegacy: true }]);
  });
  test.each(["STAGED", "INSTALLED"])("bootstrap %s preserves intermediate state and readiness order", async (status) => {
    const events: string[] = [];
    const invoke: DesktopInvoke = async command => {
      events.push(`native:${command}`);
      return command === "bootstrap_install"
        ? { receipt: { status, source_sha: "a".repeat(40) } } as never
        : { status: "APPROVAL_REQUIRED", reason: "TRUST_REQUIRED", manual_plugin_approval_recommended: true } as never;
    };
    const outcome = await createSetupOperations(invoke).install({
      onBootstrap: feedback => { events.push(`bootstrap:${feedback.status}`); },
      onReadiness: result => { events.push(`readiness:${result.status}`); },
      refresh: async () => { events.push("refresh"); },
    });
    const expected = ["native:bootstrap_install", `bootstrap:${status}`, "refresh"];
    if (status === "INSTALLED") expected.push("native:ensure_ready", "readiness:APPROVAL_REQUIRED", "refresh");
    expect(events).toEqual(expected);
    expect(outcome.readiness?.status ?? null).toBe(status === "STAGED" ? null : "APPROVAL_REQUIRED");
  });

  test("unverified bootstrap cannot start readiness or publish installation feedback", async () => {
    const calls: string[] = [];
    const invoke: DesktopInvoke = async command => { calls.push(command); return { receipt: { status: "INSTALLED" } } as never; };
    const hooks = {
      onBootstrap: () => { throw new Error("Feedback must not be published"); },
      onReadiness: () => { throw new Error("Readiness must not be published"); },
      refresh: async () => { throw new Error("Refresh must not start"); },
    };
    await expect(createSetupOperations(invoke).install(hooks)).rejects.toThrow("unverified installation result");
    expect(calls).toEqual(["bootstrap_install"]);
  });
});

describe("Desktop native editor operations", () => {
  test.each([undefined, "recent-model"])("model launch %s shares focus and truthful acknowledgement", async (id) => {
    const calls: string[] = [];
    const invoke: DesktopInvoke = async (command) => {
      calls.push(command);
      return { status: command === "focus_blockbench_window" ? "DENIED" : "LAUNCHED_UNVERIFIED" } as never;
    };
    const message = await createEditorOperations(invoke).openModel(id);
    expect(calls).toEqual([id === undefined ? "browse_model" : "project_navigation_action", "focus_blockbench_window"]);
    expect(message).toContain("active tab not verified");
  });

  test("cancelled browsing never focuses the editor; invalid recent launch is rejected", async () => {
    const calls: string[] = [];
    const invoke: DesktopInvoke = async command => {
      calls.push(command);
      return { status: "CANCELLED" } as never;
    };
    const operations = createEditorOperations(invoke);
    expect(await operations.openModel()).toBeNull();
    await expect(operations.openModel("recent-model")).rejects.toThrow("did not acknowledge");
    expect(calls).toEqual(["browse_model", "project_navigation_action"]);
  });
});

describe("Desktop passive connection lifecycle", () => {
  test.each(["full-status-failure", "dispose"])("late probe cannot recover authority after %s", async (boundary) => {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
    let complete!: (value: ConnectionObservation) => void;
    let probes = 0;
    let refreshes = 0;
    const failures: number[] = [];
    const baseline: ConnectionBaseline = {
      blockbench: { running: true }, runtime_listener_live: true, plugin_integrity: "ready",
      managed: { gateway_active: true }, project_navigation: { revision: "1", session_live: true },
    };
    const monitor = createConnectionMonitor({
      current: () => ({ status: baseline, busy: false, fixture: false }),
      observe: () => { probes += 1; return new Promise(resolve => { complete = resolve; }); },
      refresh: async () => { refreshes += 1; },
      onFailures: count => { failures.push(count); },
    });
    try {
      monitor.request();
      monitor.request();
      expect(probes).toBe(1);
      if (boundary === "dispose") monitor.dispose();
      else monitor.fullStatusFailed();
      complete({
        blockbench_running: false, runtime_listener_live: false, gateway_active: false,
        plugin_integrity: "missing", project_revision: "2", project_session_live: false,
      });
      await Promise.resolve();
      await Promise.resolve();
      monitor.request();
      expect(probes).toBe(1);
      expect(refreshes).toBe(0);
      expect(failures).toEqual(boundary === "dispose" ? [] : [2]);
      if (boundary === "full-status-failure") {
        monitor.fullStatusSucceeded();
        monitor.request();
        expect(probes).toBe(2);
        expect(failures).toEqual([2, 0]);
        monitor.dispose();
        complete({
          blockbench_running: true, runtime_listener_live: true, gateway_active: true,
          plugin_integrity: "ready", project_revision: "1", project_session_live: true,
        });
        await Promise.resolve();
      }
    } finally {
      monitor.dispose();
      if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
      else Reflect.deleteProperty(globalThis, "document");
    }
  });
});

const progress: ManagedProgress = { schema: 1, kind: "progress", action: "repair", stage: "preflight" };

describe("Desktop managed-progress listener lifecycle", () => {
  test("disposal releases a late registration and suppresses late progress", async () => {
    let register!: (unsubscribe: () => void) => void;
    let receive!: (value: ManagedProgress) => void;
    let released = 0;
    let delivered = 0;
    const dispose = subscribeManagedProgress(callback => {
      receive = callback;
      return new Promise(resolve => { register = resolve; });
    }, () => { delivered += 1; });
    dispose();
    receive(progress);
    register(() => { released += 1; });
    await Promise.resolve();
    dispose();
    expect(released).toBe(1);
    expect(delivered).toBe(0);
  });

  test("active listeners deliver progress and dispose exactly once", async () => {
    let receive!: (value: ManagedProgress) => void;
    let released = 0;
    const delivered: ManagedProgress[] = [];
    const dispose = subscribeManagedProgress(async callback => {
      receive = callback;
      return () => { released += 1; };
    }, value => { delivered.push(value); });
    await Promise.resolve();
    receive(progress);
    dispose();
    dispose();
    receive(progress);
    expect(delivered).toEqual([progress]);
    expect(released).toBe(1);
  });

  test("optional subscription failure can be disposed safely", async () => {
    const dispose = subscribeManagedProgress(async () => {
      throw new Error("Listener unavailable");
    }, () => { throw new Error("No event expected"); });
    await Promise.resolve();
    await Promise.resolve();
    expect(() => dispose()).not.toThrow();
  });
});

describe("Desktop status observation lifecycle", () => {
  test("a stalled status read times out and a fresh read can recover", async () => {
    let finishOldRead!: (value: string) => void;
    const stalled = new Promise<string>(resolve => { finishOldRead = resolve; });
    await expect(observeStatus(stalled, 10)).rejects.toThrow("Status request timed out");
    expect(await observeStatus(Promise.resolve("current"), 100)).toBe("current");
    finishOldRead("obsolete");
  });

  test("status reads preserve successful results and native rejection", async () => {
    const value = { running: true };
    expect(await observeStatus(Promise.resolve(value), 100)).toBe(value);
    const failure = new Error("native IPC rejected");
    await expect(observeStatus(Promise.reject(failure), 100)).rejects.toBe(failure);
  });
});

describe("Desktop connection observations", () => {
  test("unknown Gateway state is neutral while known changes request refresh", () => {
    const baseline: ConnectionBaseline = {
      blockbench: { running: true }, runtime_listener_live: true, plugin_integrity: "ready",
      managed: { gateway_active: true }, project_navigation: { revision: "1", session_live: true },
    };
    const observation: ConnectionObservation = {
      blockbench_running: true, runtime_listener_live: true, gateway_active: null,
      plugin_integrity: "ready", project_revision: "1", project_session_live: true,
    };
    expect(connectionChanged(observation, baseline)).toBe(false);
    expect(connectionChanged({ ...observation, gateway_active: false }, { ...baseline, managed: null })).toBe(false);
    const changes: Partial<ConnectionObservation>[] = [
      { gateway_active: false }, { blockbench_running: false }, { runtime_listener_live: false },
      { plugin_integrity: "missing" }, { project_revision: "2" }, { project_session_live: false },
      { configuration_revision: "changed-client-configuration" },
    ];
    for (const change of changes) {
      expect(connectionChanged({ ...observation, ...change }, baseline), JSON.stringify(change)).toBe(true);
    }
  });
});
