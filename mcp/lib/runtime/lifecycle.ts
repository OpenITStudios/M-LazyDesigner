export type RuntimeLifecycleState =
  | "stopped"
  | "starting"
  | "running"
  | "quiescing"
  | "failed";

type RuntimeLifecycleCoordinator = {
  version: 1;
  generationCounter: number;
  ownerGeneration: number | null;
  ownerBuildIdentity: string | null;
  ownerTeardown?: () => void;
  state: RuntimeLifecycleState;
  operationTail: Promise<void>;
  teardownTail: Promise<void>;
  /** Process-wide admission counter, retained across plugin reload generations. */
  pendingOperations?: number;
  /** Native FIFO shared across bundle reloads; initialized after legacy work. */
  nativeQueue?: RuntimeNativeQueue;
};

type RuntimeWaitingOperation = {
  start: () => void;
  cancel: () => void;
  cleanup: () => void;
};

type RuntimeNativeQueue = {
  active: boolean;
  waiting: RuntimeWaitingOperation[];
  resolveDrain: (() => void) | null;
};

/** Native Blockbench state is process-global: one active operation plus bounded waiters. */
export const MAX_RUNTIME_WAITING_OPERATIONS = 16;

const GLOBAL_LIFECYCLE_KEY = "__BLOCKIT_RUNTIME_LIFECYCLE_V1__";

type RuntimeLifecycleGlobal = typeof globalThis & {
  [GLOBAL_LIFECYCLE_KEY]?: RuntimeLifecycleCoordinator;
};

function getCoordinator(): RuntimeLifecycleCoordinator {
  const root = globalThis as RuntimeLifecycleGlobal;
  const existing = root[GLOBAL_LIFECYCLE_KEY];
  if (existing?.version === 1) {
    // Upgrade a coordinator created by an older hot-reloaded plugin in place.
    if (existing.pendingOperations === undefined) existing.pendingOperations = 0;
    return existing;
  }

  const created: RuntimeLifecycleCoordinator = {
    version: 1,
    generationCounter: 0,
    ownerGeneration: null,
    ownerBuildIdentity: null,
    state: "stopped",
    operationTail: Promise.resolve(),
    teardownTail: Promise.resolve(),
    pendingOperations: 0,
  };
  root[GLOBAL_LIFECYCLE_KEY] = created;
  return created;
}

export class RuntimeGenerationRetiredError extends Error {
  constructor(readonly generation: number) {
    super(`BlockIT Runtime generation ${generation} is no longer active.`);
    this.name = "RuntimeGenerationRetiredError";
  }
}

export class RuntimeOperationQueueFullError extends Error {
  constructor() {
    super(`LazyDesigner Runtime is busy: ${MAX_RUNTIME_WAITING_OPERATIONS} native operations are already waiting. No new mutation was executed.`);
    this.name = "RuntimeOperationQueueFullError";
  }
}

export type RuntimeGenerationClaim = {
  generation: number;
  priorTeardown: Promise<void>;
};

/**
 * Claim the one active BlockIT plugin generation for this Blockbench window.
 * The returned priorTeardown is captured before ownership changes so a freshly
 * loaded bundle can wait for the previous listener cleanup without polling.
 */
export function claimRuntimeGeneration(
  buildIdentity: string | null,
  teardown?: () => void
): RuntimeGenerationClaim {
  const coordinator = getCoordinator();
  // A file import can replace the bundle without Blockbench calling onunload.
  coordinator.ownerTeardown?.();
  const generation = coordinator.generationCounter + 1;
  const priorTeardown = coordinator.teardownTail;

  coordinator.generationCounter = generation;
  coordinator.ownerGeneration = generation;
  coordinator.ownerBuildIdentity = buildIdentity;
  coordinator.ownerTeardown = teardown;
  coordinator.state = "starting";

  return { generation, priorTeardown };
}

export function isRuntimeGenerationCurrent(generation: number): boolean {
  return getCoordinator().ownerGeneration === generation;
}

export function markRuntimeGenerationState(
  generation: number,
  state: RuntimeLifecycleState
): void {
  const coordinator = getCoordinator();
  if (coordinator.ownerGeneration === generation) {
    coordinator.state = state;
  }
}

/**
 * Retire ownership synchronously, then serialize asynchronous teardown work.
 * Blockbench does not await plugin onunload(), so the next generation explicitly
 * awaits this coordinator-owned barrier instead.
 */
export function beginRuntimeGenerationTeardown(
  generation: number,
  cleanup: () => Promise<void>
): Promise<void> {
  const coordinator = getCoordinator();
  if (coordinator.ownerGeneration === generation) {
    coordinator.ownerTeardown = undefined;
    coordinator.ownerGeneration = null;
    coordinator.ownerBuildIdentity = null;
    coordinator.state = "quiescing";
  }

  const previous = coordinator.teardownTail;
  const run = previous.catch(() => undefined).then(cleanup);
  coordinator.teardownTail = run.then(
    () => {
      if (coordinator.ownerGeneration === null) coordinator.state = "stopped";
    },
    () => {
      if (coordinator.ownerGeneration === null) coordinator.state = "failed";
    }
  );
  return run;
}

export class RuntimeQueuedOperationAbandonedError extends Error {
  constructor() {
    super("Queued Runtime operation was abandoned before native execution.");
    this.name = "RuntimeQueuedOperationAbandonedError";
  }
}

/**
 * Retain one shared FIFO even across hot reload. A new bundle may encounter
 * pending work from the older Promise-tail implementation: treat that tail as
 * the running slot until it drains, rather than running native work in parallel.
 */
function getNativeQueue(coordinator: RuntimeLifecycleCoordinator): RuntimeNativeQueue {
  if (coordinator.nativeQueue) return coordinator.nativeQueue;
  const legacyPending = (coordinator.pendingOperations ?? 0) > 0;
  const previousTail = coordinator.operationTail;
  const queue: RuntimeNativeQueue = {
    active: legacyPending,
    waiting: [],
    resolveDrain: null,
  };
  coordinator.nativeQueue = queue;
  if (legacyPending) {
    void previousTail.then(
      () => {
        queue.active = false;
        startNextRuntimeOperation(queue);
      },
      () => {
        queue.active = false;
        startNextRuntimeOperation(queue);
      }
    );
  }
  return queue;
}

function settleNativeDrainIfIdle(
  queue: RuntimeNativeQueue
): void {
  if (queue.active || queue.waiting.length > 0) return;
  const resolve = queue.resolveDrain;
  queue.resolveDrain = null;
  resolve?.();
}

function startNextRuntimeOperation(
  queue: RuntimeNativeQueue
): void {
  if (queue.active) return;
  const next = queue.waiting.shift();
  if (!next) {
    settleNativeDrainIfIdle(queue);
    return;
  }
  // From this point client cancellation cannot claim "not executed".
  queue.active = true;
  next.cleanup();
  next.start();
}

/**
 * Serialize native Blockbench work globally while physically releasing
 * abandoned waiting slots. Aborting a started operation does NOT interrupt or
 * replay a native mutation; its outcome must still be reconciled by the caller.
 */
export function runRuntimeOperationExclusive<T>(
  generation: number | null,
  operation: () => Promise<T>,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const coordinator = getCoordinator();
  const signal = options.signal;
  // A retired listener must not occupy a native queue slot while the next
  // plugin generation is waiting for the previous drain. This is preflight:
  // nothing has been executed and an already-started operation is unaffected.
  if (generation !== null && coordinator.ownerGeneration !== generation) {
    return Promise.reject(new RuntimeGenerationRetiredError(generation));
  }
  if (signal?.aborted) {
    return Promise.reject(new RuntimeQueuedOperationAbandonedError());
  }

  const queue = getNativeQueue(coordinator);
  // Pending includes one running operation (or a legacy drain barrier).
  if ((coordinator.pendingOperations ?? 0) >= MAX_RUNTIME_WAITING_OPERATIONS + 1) {
    return Promise.reject(new RuntimeOperationQueueFullError());
  }

  return new Promise<T>((resolve, reject) => {
    if (!queue.resolveDrain) {
      coordinator.operationTail = new Promise<void>((done) => {
        queue.resolveDrain = done;
      });
    }

    coordinator.pendingOperations = (coordinator.pendingOperations ?? 0) + 1;
    const item: RuntimeWaitingOperation = {
      cleanup: () => {
        signal?.removeEventListener("abort", item.cancel);
      },
      cancel: () => {
        const index = queue.waiting.indexOf(item);
        if (index < 0) return;
        queue.waiting.splice(index, 1);
        item.cleanup();
        coordinator.pendingOperations = Math.max(
          0, (coordinator.pendingOperations ?? 1) - 1
        );
        reject(new RuntimeQueuedOperationAbandonedError());
        startNextRuntimeOperation(queue);
      },
      start: () => {
        void (async () => {
          try {
            if (
              generation !== null &&
              coordinator.ownerGeneration !== generation
            ) {
              throw new RuntimeGenerationRetiredError(generation);
            }
            const result = await operation();
            if (
              generation !== null &&
              coordinator.ownerGeneration !== generation
            ) {
              throw new RuntimeGenerationRetiredError(generation);
            }
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            coordinator.pendingOperations = Math.max(
              0, (coordinator.pendingOperations ?? 1) - 1
            );
            queue.active = false;
            startNextRuntimeOperation(queue);
          }
        })();
      },
    };

    queue.waiting.push(item);
    if (signal) {
      signal.addEventListener("abort", item.cancel, { once: true });
      if (signal.aborted) item.cancel();
    }
    startNextRuntimeOperation(queue);
  });
}

export function waitForRuntimeOperationDrain(): Promise<void> {
  return getCoordinator().operationTail;
}

export function getRuntimeLifecycleSnapshot(): {
  generation: number;
  owner_generation: number | null;
  build_identity: string | null;
  state: RuntimeLifecycleState;
} {
  const coordinator = getCoordinator();
  return {
    generation: coordinator.generationCounter,
    owner_generation: coordinator.ownerGeneration,
    build_identity: coordinator.ownerBuildIdentity,
    state: coordinator.state,
  };
}
