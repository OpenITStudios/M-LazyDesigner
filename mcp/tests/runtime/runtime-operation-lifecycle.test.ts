import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_RUNTIME_WAITING_OPERATIONS,
  RuntimeGenerationRetiredError,
  RuntimeOperationQueueFullError,
  RuntimeQueuedOperationAbandonedError,
  claimRuntimeGeneration,
  runRuntimeOperationExclusive,
  waitForRuntimeOperationDrain,
} from "@/lib/runtime/lifecycle";

const lifecycleKey = "__BLOCKIT_RUNTIME_LIFECYCLE_V1__";
const shared = globalThis as unknown as Record<string, unknown>;

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

beforeEach(() => {
  delete shared[lifecycleKey];
});

afterEach(async () => {
  await waitForRuntimeOperationDrain();
  delete shared[lifecycleKey];
});

describe("native Runtime operation queue", () => {
  test("a retired generation is refused at admission without using a native queue slot", async () => {
    const old = claimRuntimeGeneration("old");
    const replacement = claimRuntimeGeneration("replacement");
    let executed = false;
    const before = waitForRuntimeOperationDrain();
    await expect(runRuntimeOperationExclusive(old.generation, async () => {
      executed = true;
    })).rejects.toBeInstanceOf(RuntimeGenerationRetiredError);
    expect(executed).toBe(false);
    expect(waitForRuntimeOperationDrain()).toBe(before);
    expect(await runRuntimeOperationExclusive(replacement.generation, async () => "new")).toBe("new");
  });


  test("serializes native work in FIFO order and drains after the last operation", async () => {
    const { generation } = claimRuntimeGeneration("fixture");
    const order: string[] = [];
    const gate = deferred();
    const first = runRuntimeOperationExclusive(generation, async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
      return 1;
    });
    const second = runRuntimeOperationExclusive(generation, async () => {
      order.push("second");
      return 2;
    });
    let drained = false;
    const drain = waitForRuntimeOperationDrain().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    gate.release();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    await drain;
    expect(drained).toBe(true);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  test("abandoned waiting request is physically removed and frees capacity", async () => {
    const { generation } = claimRuntimeGeneration("fixture");
    const gate = deferred();
    const started = deferred();
    const first = runRuntimeOperationExclusive(generation, async () => {
      started.release();
      await gate.promise;
    });
    await started.promise;
    const controllers = Array.from({ length: MAX_RUNTIME_WAITING_OPERATIONS },
      () => new AbortController());
    const waiting = controllers.map((controller) =>
      runRuntimeOperationExclusive(generation, async () => "should-not-run", {
        signal: controller.signal,
      })
    );
    try {
      await expect(runRuntimeOperationExclusive(generation, async () => "overflow"))
        .rejects.toBeInstanceOf(RuntimeOperationQueueFullError);
      controllers[0].abort();
      await expect(waiting[0]).rejects.toBeInstanceOf(
        RuntimeQueuedOperationAbandonedError
      );
      const replacement = runRuntimeOperationExclusive(generation, async () => "replacement");
      gate.release();
      await first;
      const results = await Promise.all([...waiting.slice(1), replacement]);
      expect(results.at(-1)).toBe("replacement");
    } finally {
      gate.release();
    }
  });

  test("aborting an already-started native operation does not abort or replay it", async () => {
    const { generation } = claimRuntimeGeneration("fixture");
    const gate = deferred();
    const started = deferred();
    const controller = new AbortController();
    let executions = 0;
    const operation = runRuntimeOperationExclusive(generation, async () => {
      executions += 1;
      started.release();
      await gate.promise;
      return "applied";
    }, { signal: controller.signal });
    await started.promise;
    controller.abort();
    gate.release();
    expect(await operation).toBe("applied");
    expect(executions).toBe(1);
  });

  test("rejects queued work from a retired generation without native mutation", async () => {
    const firstGeneration = claimRuntimeGeneration("old").generation;
    const gate = deferred();
    const started = deferred();
    let oldWaitingCalls = 0;
    const first = runRuntimeOperationExclusive(firstGeneration, async () => {
      started.release();
      await gate.promise;
      return "old";
    });
    await started.promise;
    const oldQueued = runRuntimeOperationExclusive(firstGeneration, async () => {
      oldWaitingCalls += 1;
    });
    const replacementGeneration = claimRuntimeGeneration("new").generation;
    const fresh = runRuntimeOperationExclusive(replacementGeneration, async () => "new");
    const retired = Promise.allSettled([first, oldQueued]);
    gate.release();
    expect(await retired).toEqual([
      { status: "rejected", reason: expect.any(RuntimeGenerationRetiredError) },
      { status: "rejected", reason: expect.any(RuntimeGenerationRetiredError) },
    ]);
    expect(await fresh).toBe("new");
    expect(oldWaitingCalls).toBe(0);
  });

  test("aborted-before-admission request does not execute or retain a slot", async () => {
    const { generation } = claimRuntimeGeneration("fixture");
    const controller = new AbortController();
    controller.abort();
    let executed = false;
    await expect(runRuntimeOperationExclusive(generation, async () => {
      executed = true;
    }, { signal: controller.signal })).rejects.toBeInstanceOf(
      RuntimeQueuedOperationAbandonedError
    );
    expect(executed).toBe(false);
    expect(await runRuntimeOperationExclusive(generation, async () => "next")).toBe("next");
  });
});
