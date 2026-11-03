import {
  GatewayBackendError,
  type GatewayRuntimeStatus,
} from "./backendContract";

const METRIC_SAMPLE_LIMIT = 64;

/** Includes Gateway connection/catalog/preflight work, not pure native execution. */
export type GatewayOperationTiming = Readonly<{
  queue_wait_ms: number;
  operation_duration_ms: number;
}>;

type QueuedOperation = {
  enqueuedAt: number;
  queueWaitMs: number | null;
  execute: () => Promise<void>;
  rejectWaiting: (reason: GatewayBackendError) => void;
  cleanup: () => void;
};

/** Nearest-rank percentile of a fixed-size, process-local sample window. */
function percentile(samples: readonly number[], rank: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)] ?? null;
}

function appendSample(samples: number[], value: number): void {
  if (samples.length === METRIC_SAMPLE_LIMIT) samples.shift();
  samples.push(value);
}

/**
 * One native operation at a time; bounded FIFO waiting capacity.
 * Waiting entries are physically removed when cancelled or expired, so
 * repeated aborts cannot accumulate orphaned Promise-chain callbacks.
 */
export class GatewayOperationQueue {
  private readonly waiting: QueuedOperation[] = [];
  private dispatchScheduled = false;
  private activeOperations = 0;
  private completedOperations = 0;
  private failedOperations = 0;
  private timedOutOperations = 0;
  private rejectedBusyOperations = 0;
  private expiredBeforeStart = 0;
  private cancelledBeforeStart = 0;
  private outcomeUnknownOperations = 0;
  private interruptedReadOperations = 0;
  private readonly queueWaitSamples: number[] = [];
  private readonly durationSamples: number[] = [];
  private lastQueueWaitMs: number | null = null;
  private maxObservedQueueWaitMs = 0;
  private lastOperationDurationMs: number | null = null;
  private maxOperationDurationMs = 0;

  constructor(
    readonly maxQueueDepth: number,
    readonly maxQueueWaitMs: number = 30_000
  ) {}

  snapshot(): GatewayRuntimeStatus["operations"] {
    return {
      active: this.activeOperations,
      queued: this.waiting.length,
      max_queue_depth: this.maxQueueDepth,
      completed: this.completedOperations,
      failed: this.failedOperations,
      timed_out: this.timedOutOperations,
      rejected_busy: this.rejectedBusyOperations,
      expired_before_start: this.expiredBeforeStart,
      cancelled_before_start: this.cancelledBeforeStart,
      outcome_unknown: this.outcomeUnknownOperations,
      read_interrupted: this.interruptedReadOperations,
      metric_sample_limit: METRIC_SAMPLE_LIMIT,
      queue_wait_sample_count: this.queueWaitSamples.length,
      duration_sample_count: this.durationSamples.length,
      queue_wait_p50_ms: percentile(this.queueWaitSamples, 0.5),
      queue_wait_p95_ms: percentile(this.queueWaitSamples, 0.95),
      duration_p50_ms: percentile(this.durationSamples, 0.5),
      duration_p95_ms: percentile(this.durationSamples, 0.95),
      last_queue_wait_ms: this.lastQueueWaitMs,
      max_queue_wait_ms: this.maxObservedQueueWaitMs,
      last_duration_ms: this.lastOperationDurationMs,
      max_duration_ms: this.maxOperationDurationMs,
    };
  }

  private scheduleNext(): void {
    if (this.activeOperations > 0 || this.dispatchScheduled || this.waiting.length === 0) return;
    this.dispatchScheduled = true;
    queueMicrotask(() => {
      this.dispatchScheduled = false;
      if (this.activeOperations > 0) return;
      const next = this.waiting[0];
      if (!next) return;
      // Timers can run later than queued microtasks after a busy event loop.
      // Enforce the deadline at admission, not only from the expiry timer.
      if (
        this.maxQueueWaitMs > 0 &&
        Date.now() - next.enqueuedAt >= this.maxQueueWaitMs
      ) {
        this.discardWaiting(next, "GATEWAY_QUEUE_EXPIRED");
        return;
      }
      this.waiting.shift();
      // After this point no caller cancellation can claim executed=false.
      next.cleanup();
      this.activeOperations = 1;
      const waited = Math.max(0, Date.now() - next.enqueuedAt);
      next.queueWaitMs = waited;
      this.lastQueueWaitMs = waited;
      this.maxObservedQueueWaitMs = Math.max(this.maxObservedQueueWaitMs, waited);
      appendSample(this.queueWaitSamples, waited);
      // execute() settles only after releasing the active slot.
      // This ensures a follow-up call made immediately after await can enter.
      void next.execute();
    });
  }

  private discardWaiting(
    entry: QueuedOperation,
    code: "GATEWAY_QUEUE_EXPIRED" | "GATEWAY_QUEUE_CANCELLED"
  ): void {
    const index = this.waiting.indexOf(entry);
    if (index < 0) return; // Already started or previously discarded.
    this.waiting.splice(index, 1);
    entry.cleanup();
    if (code === "GATEWAY_QUEUE_EXPIRED") this.expiredBeforeStart += 1;
    else this.cancelledBeforeStart += 1;
    const elapsedMs = Math.max(0, Date.now() - entry.enqueuedAt);
    entry.rejectWaiting(new GatewayBackendError(
      code,
      code === "GATEWAY_QUEUE_EXPIRED"
        ? "Gateway queue wait expired before native execution began."
        : "Gateway request was cancelled before native execution began.",
      true,
      {
        executed: false,
        queue_wait_ms: elapsedMs,
        ...(code === "GATEWAY_QUEUE_EXPIRED"
          ? { queue_wait_timeout_ms: this.maxQueueWaitMs }
          : {}),
      }
    ));
    this.scheduleNext();
  }

  run<T>(
    operation: () => Promise<T>,
    options: { signal?: AbortSignal; onTiming?: (timing: GatewayOperationTiming) => void } = {}
  ): Promise<T> {
    if (options.signal?.aborted) {
      this.cancelledBeforeStart += 1;
      return Promise.reject(new GatewayBackendError(
        "GATEWAY_QUEUE_CANCELLED",
        "Gateway request was cancelled before native execution began.",
        true,
        { executed: false }
      ));
    }
    if (this.waiting.length + this.activeOperations >= this.maxQueueDepth + 1) {
      this.rejectedBusyOperations += 1;
      return Promise.reject(new GatewayBackendError(
        "GATEWAY_BUSY",
        "LazyDesigner Gateway queue is full (" + this.maxQueueDepth +
          " waiting operations maximum). Retry after the current authoring operation completes.",
        true,
        { max_queue_depth: this.maxQueueDepth }
      ));
    }

    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let onAbort: (() => void) | null = null;
      const enqueuedAt = Date.now();
      const entry: QueuedOperation = {
        enqueuedAt,
        queueWaitMs: null,
        rejectWaiting: reject,
        cleanup: () => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          if (onAbort) options.signal?.removeEventListener("abort", onAbort);
        },
        execute: async () => {
          const startedAt = Date.now();
          let result: T | undefined;
          let failed = false;
          let failure: unknown;
          try {
            result = await operation();
            this.completedOperations += 1;
          } catch (error) {
            failed = true;
            failure = error;
            this.failedOperations += 1;
            if (error instanceof GatewayBackendError) {
              if (typeof error.details.timeout_ms === "number") {
                this.timedOutOperations += 1;
              }
              if (error.code === "OUTCOME_UNKNOWN") {
                this.outcomeUnknownOperations += 1;
              }
              if (error.code === "BACKEND_CALL_INTERRUPTED") {
                this.interruptedReadOperations += 1;
              }
            }
          } finally {
            const elapsedMs = Math.max(0, Date.now() - startedAt);
            this.lastOperationDurationMs = elapsedMs;
            this.maxOperationDurationMs = Math.max(this.maxOperationDurationMs, elapsedMs);
            appendSample(this.durationSamples, elapsedMs);
            this.activeOperations = 0;
            this.scheduleNext();
            // Observability is advisory, never a new source of authoring failures.
            if (options.onTiming && entry.queueWaitMs !== null) {
              try {
                options.onTiming({
                  queue_wait_ms: entry.queueWaitMs,
                  operation_duration_ms: elapsedMs,
                });
              } catch { /* diagnostic observers cannot alter operation outcomes */ }
            }
          }
          // Do not make the completion observable before the queue has
          // released its active slot and recorded final duration metrics.
          if (failed) reject(failure);
          else resolve(result as T);
        },
      };

      this.waiting.push(entry);
      if (options.signal) {
        onAbort = () => this.discardWaiting(entry, "GATEWAY_QUEUE_CANCELLED");
        options.signal.addEventListener("abort", onAbort, { once: true });
        if (options.signal.aborted) onAbort();
      }
      if (this.waiting.includes(entry) && this.maxQueueWaitMs > 0) {
        timer = setTimeout(() => this.discardWaiting(entry, "GATEWAY_QUEUE_EXPIRED"), this.maxQueueWaitMs);
      }
      this.scheduleNext();
    });
  }
}
