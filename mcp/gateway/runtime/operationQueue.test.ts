import { describe, expect, test } from "bun:test";
import { GatewayOperationQueue } from "./operationQueue";
import { GatewayBackendError } from "./backendContract";

describe("Gateway operation queue", () => {
  test("emits per-operation timing only for admitted work; observer cannot alter the result", async () => {
    const queue = new GatewayOperationQueue(0);
    const timings: Array<{ queue_wait_ms: number; operation_duration_ms: number }> = [];
    const result = await queue.run(async () => "kept", {
      onTiming: (timing) => {
        timings.push(timing);
        throw new Error("diagnostics observer must not break authoring");
      },
    });
    expect(result).toBe("kept");
    expect(timings).toHaveLength(1);
    expect(timings[0]!.queue_wait_ms).toBeGreaterThanOrEqual(0);
    expect(timings[0]!.operation_duration_ms).toBeGreaterThanOrEqual(0);
    const failure = new Error("runtime failed");
    let failedTiming = 0;
    await expect(queue.run(async () => { throw failure; }, {
      onTiming: () => { failedTiming += 1; },
    })).rejects.toBe(failure);
    expect(failedTiming).toBe(1);
    const aborted = new AbortController();
    aborted.abort();
    await expect(queue.run(async () => "not-executed", {
      signal: aborted.signal,
      onTiming: () => { throw new Error("must not notify for non-admission"); },
    })).rejects.toMatchObject({ code: "GATEWAY_QUEUE_CANCELLED" });
    expect(queue.snapshot()).toMatchObject({ completed: 1, failed: 1 });
  });
  test("keeps the configured deadline separate from observed wait metrics", async () => {
    const queue = new GatewayOperationQueue(1, 1_000);
    expect(queue.snapshot().max_queue_wait_ms).toBe(0);
    await queue.run(async () => "done");
    expect(queue.maxQueueWaitMs).toBe(1_000);
    expect(queue.snapshot().max_queue_wait_ms).toBeLessThan(1_000);
  });

  test("serializes operations and records metrics", async () => {
    const queue = new GatewayOperationQueue(2);
    const order: string[] = [];

    const first = queue.run(async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("first:end");
      return 1;
    });

    const second = queue.run(async () => {
      order.push("second:start");
      order.push("second:end");
      return 2;
    });

    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);

    expect(queue.snapshot()).toMatchObject({
      active: 0,
      queued: 0,
      completed: 2,
      failed: 0,
      rejected_busy: 0,
    });
  });

  test("expires work at dispatch even when the timer callback has not run", async () => {
    const queue = new GatewayOperationQueue(1, 1_000);
    const originalNow = Date.now;
    let now = 10_000;
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executed: string[] = [];

    Date.now = () => now;
    try {
      const first = queue.run(async () => {
        executed.push("first");
        markStarted();
        await gate;
      });
      await started;

      const expired = queue.run(async () => {
        executed.push("expired");
      });
      const settled = Promise.allSettled([expired]);

      // Advance the wall clock without running timers: the first completion
      // schedules the second job as a microtask before its timer fires.
      now += 1_001;
      release();
      await first;
      const [outcome] = await settled;
      expect(outcome).toMatchObject({
        status: "rejected",
        reason: {
          code: "GATEWAY_QUEUE_EXPIRED",
          safeToRetry: true,
          details: { executed: false, queue_wait_timeout_ms: 1_000 },
        },
      });

      expect(executed).toEqual(["first"]);
      expect(queue.snapshot()).toMatchObject({
        completed: 1,
        expired_before_start: 1,
        cancelled_before_start: 0,
        queued: 0,
        active: 0,
      });
    } finally {
      release();
      Date.now = originalNow;
    }
  });

  test("releases capacity and final metrics before resolving an operation", async () => {
    const queue = new GatewayOperationQueue(0);
    await expect(queue.run(async () => "first")).resolves.toBe("first");
    expect(queue.snapshot()).toMatchObject({
      active: 0, queued: 0, completed: 1, duration_sample_count: 1,
    });
    await expect(queue.run(async () => "second")).resolves.toBe("second");
    expect(queue.snapshot()).toMatchObject({
      active: 0, queued: 0, completed: 2, duration_sample_count: 2,
    });
  });

  test("rejects work beyond configured queue depth", async () => {
    const queue = new GatewayOperationQueue(0);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.run(async () => {
      await blocker;
    });

    await expect(queue.run(async () => undefined)).rejects.toBeInstanceOf(
      GatewayBackendError
    );
    release();
    await first;
    expect(queue.snapshot().rejected_busy).toBe(1);
  });

  test("expires queued work before execution without reporting unknown mutation state", async () => {
    const queue = new GatewayOperationQueue(2, 20);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executed: string[] = [];

    const first = queue.run(async () => {
      executed.push("first");
      markStarted();
      await gate;
      return "first";
    });
    await started;
    const expired = queue.run(async () => {
      executed.push("expired");
      return "should-not-run";
    });
    try {
      await expect(expired).rejects.toMatchObject({
        code: "GATEWAY_QUEUE_EXPIRED",
        safeToRetry: true,
        details: { executed: false, queue_wait_timeout_ms: 20 },
      });
      expect(executed).toEqual(["first"]);
      expect(queue.snapshot()).toMatchObject({
        active: 1,
        queued: 0,
        expired_before_start: 1,
        cancelled_before_start: 0,
        failed: 0,
      });
    } finally {
      release();
      await first;
    }
    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
    expect(executed).toEqual(["first"]);
  });

  test("aborted queued request immediately frees capacity and never executes", async () => {
    const queue = new GatewayOperationQueue(1, 1000);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executed: string[] = [];
    const first = queue.run(async () => {
      executed.push("first");
      markStarted();
      await gate;
    });
    await started;
    const controller = new AbortController();
    const cancelled = queue.run(async () => {
      executed.push("cancelled");
    }, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({
      code: "GATEWAY_QUEUE_CANCELLED",
      safeToRetry: true,
      details: { executed: false },
    });
    const replacement = queue.run(async () => {
      executed.push("replacement");
    });
    release();
    await first;
    await replacement;
    expect(executed).toEqual(["first", "replacement"]);
    expect(queue.snapshot()).toMatchObject({
      completed: 2,
      cancelled_before_start: 1,
      queued: 0,
      active: 0,
    });
  });

  test("aborting an already-started mutation does not claim that it was cancelled", async () => {
    const queue = new GatewayOperationQueue(0, 1000);
    const controller = new AbortController();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const operation = queue.run(async () => {
      markStarted();
      await gate;
      return "applied";
    }, { signal: controller.signal });
    await started;
    controller.abort();
    release();
    await expect(operation).resolves.toBe("applied");
    expect(queue.snapshot()).toMatchObject({
      completed: 1,
      cancelled_before_start: 0,
      expired_before_start: 0,
    });
  });

  test("already aborted request is rejected before queue admission", async () => {
    const queue = new GatewayOperationQueue(0, 20);
    const controller = new AbortController();
    controller.abort();
    let executed = false;
    await expect(queue.run(async () => {
      executed = true;
    }, { signal: controller.signal })).rejects.toMatchObject({
      code: "GATEWAY_QUEUE_CANCELLED",
      details: { executed: false },
    });
    expect(executed).toBe(false);
    expect(queue.snapshot()).toMatchObject({
      queued: 0, active: 0, cancelled_before_start: 1,
    });
  });


  test("does not retain cancelled callback entries under sustained abort pressure", async () => {
    const queue = new GatewayOperationQueue(1, 1000);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => {
      markStarted();
      await gate;
    });
    await started;
    let abandonedExecutions = 0;
    try {
      for (let index = 0; index < 150; index += 1) {
        const controller = new AbortController();
        const abandoned = queue.run(async () => {
          abandonedExecutions += 1;
        }, { signal: controller.signal });
        controller.abort();
        await expect(abandoned).rejects.toMatchObject({
          code: "GATEWAY_QUEUE_CANCELLED",
          details: { executed: false },
        });
      }
      const internal = queue as unknown as { waiting: unknown[] };
      expect(internal.waiting).toHaveLength(0);
      expect(queue.snapshot()).toMatchObject({
        active: 1,
        queued: 0,
        cancelled_before_start: 150,
        completed: 0,
      });
      expect(abandonedExecutions).toBe(0);
    } finally {
      release();
      await first;
    }
    await expect(queue.run(async () => "next")).resolves.toBe("next");
    expect(queue.snapshot().completed).toBe(2);
  });

  test("bounded quantile windows never retain more than 64 completed operation samples", async () => {
    const queue = new GatewayOperationQueue(0);
    expect(queue.snapshot()).toMatchObject({
      queue_wait_sample_count: 0,
      duration_sample_count: 0,
      queue_wait_p50_ms: null,
      duration_p95_ms: null,
      metric_sample_limit: 64,
    });
    for (let index = 0; index < 100; index += 1) {
      await queue.run(async () => index);
    }
    const metrics = queue.snapshot();
    expect(metrics).toMatchObject({
      completed: 100,
      queue_wait_sample_count: 64,
      duration_sample_count: 64,
      metric_sample_limit: 64,
    });
    expect(metrics.queue_wait_p50_ms).toBeGreaterThanOrEqual(0);
    expect(metrics.queue_wait_p95_ms).toBeGreaterThanOrEqual(metrics.queue_wait_p50_ms ?? 0);
    expect(metrics.duration_p50_ms).toBeGreaterThanOrEqual(0);
    expect(metrics.duration_p95_ms).toBeGreaterThanOrEqual(metrics.duration_p50_ms ?? 0);
    const internal = queue as unknown as { waiting: unknown[] };
    expect(internal.waiting).toHaveLength(0);
  });

  test("counts uncertain native mutations separately from retryable interrupted reads", async () => {
    const queue = new GatewayOperationQueue(0);
    for (const code of ["OUTCOME_UNKNOWN", "BACKEND_CALL_INTERRUPTED"] as const) {
      await expect(queue.run(async () => {
        throw new GatewayBackendError(code, "simulated transport loss", code !== "OUTCOME_UNKNOWN");
      })).rejects.toMatchObject({ code });
    }
    expect(queue.snapshot()).toMatchObject({
      completed: 0,
      failed: 2,
      outcome_unknown: 1,
      read_interrupted: 1,
      duration_sample_count: 2,
    });
  });

  test("queued request expiry physically releases a waiting slot before the first operation completes", async () => {
    const queue = new GatewayOperationQueue(1, 15);
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => {
      markStarted();
      await gate;
    });
    await started;
    let expiredExecuted = false;
    try {
      const expired = queue.run(async () => { expiredExecuted = true; });
      await expect(expired).rejects.toMatchObject({
        code: "GATEWAY_QUEUE_EXPIRED",
        details: { executed: false },
      });
      expect(expiredExecuted).toBe(false);
      expect(queue.snapshot()).toMatchObject({
        active: 1,
        queued: 0,
        expired_before_start: 1,
      });
      const replacement = queue.run(async () => "replacement");
      release();
      await first;
      await expect(replacement).resolves.toBe("replacement");
    } finally {
      release();
      await first;
    }
  });

  test("counts timeout-classified backend failures", async () => {
    const queue = new GatewayOperationQueue(1);
    await expect(
      queue.run(async () => {
        throw new GatewayBackendError(
          "BACKEND_UNAVAILABLE",
          "timeout",
          true,
          { timeout_ms: 1000 }
        );
      })
    ).rejects.toBeInstanceOf(GatewayBackendError);

    expect(queue.snapshot()).toMatchObject({
      failed: 1,
      timed_out: 1,
    });
  });
});
