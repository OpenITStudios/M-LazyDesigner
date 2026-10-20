import { describe, expect, test } from "bun:test";
import { subscribeManagedProgress } from "../../../apps/desktop/src/managedProgress";
import type { ManagedProgress } from "../../../apps/desktop/src/desktopTypes";

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
