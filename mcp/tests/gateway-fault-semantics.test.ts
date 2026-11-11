import { describe, expect, test } from "bun:test";
import {
  BlockitRuntimeBackend,
  GatewayBackendError,
} from "@/gateway/backend";
import { verifyRuntimeBuildIdentity } from "@/gateway/runtime/identity";
import { PRODUCT_ID } from "@/lib/product/productIdentity";
import {
  classifyInterruptedCall,
  createRuntimeSignature,
  type BackendTool,
} from "@/gateway/contract";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Gateway deterministic fault semantics", () => {
  test("installed Gateway rejects healthy foreign or mismatched Runtime builds", () => {
    const expected = "sha256:" + "a".repeat(64);
    const matching = { product: { id: PRODUCT_ID }, build_identity: expected };
    expect(verifyRuntimeBuildIdentity(matching, expected)).toBeNull();
    expect(verifyRuntimeBuildIdentity(matching, "sha256:" + "b".repeat(64))).toMatch(/build identity/);
    expect(verifyRuntimeBuildIdentity({ ...matching, product: { id: "blockit" } }, expected)).toMatch(/product identity/);
    expect(verifyRuntimeBuildIdentity({ product: { id: PRODUCT_ID } }, expected)).toMatch(/build identity/);
    expect(verifyRuntimeBuildIdentity(matching, null)).toBeNull();
  });

  test("queue saturation fails fast without entering a third serialized operation", async () => {
    const backend = new BlockitRuntimeBackend(undefined, undefined, {
      maxQueueDepth: 1,
    });
    const internal = backend as unknown as {
      runExclusive<T>(operation: () => Promise<T>): Promise<T>;
      operationStatus(): {
        active: number;
        queued: number;
        rejected_busy: number;
      };
    };

    const firstStarted = deferred();
    const releaseFirst = deferred();
    const secondStarted = deferred();
    const releaseSecond = deferred();
    let thirdExecuted = false;

    const first = internal.runExclusive(async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return "first";
    });
    await firstStarted.promise;

    const second = internal.runExclusive(async () => {
      secondStarted.resolve();
      await releaseSecond.promise;
      return "second";
    });

    const third = internal.runExclusive(async () => {
      thirdExecuted = true;
      return "third";
    });

    await expect(third).rejects.toMatchObject({
      code: "GATEWAY_BUSY",
      safeToRetry: true,
    } satisfies Partial<GatewayBackendError>);
    expect(thirdExecuted).toBe(false);
    expect(internal.operationStatus()).toMatchObject({
      active: 1,
      queued: 1,
      rejected_busy: 1,
    });

    releaseFirst.resolve();
    await first;
    await secondStarted.promise;
    releaseSecond.resolve();
    await second;
  });

  test("read-only interruption is retryable but mutation interruption is outcome-unknown", () => {
    const readOnly: BackendTool = {
      name: "inspect_elements",
      annotations: { readOnlyHint: true },
    };
    const mutation: BackendTool = {
      name: "manage_cubes",
      annotations: { readOnlyHint: false },
    };
    const phaseHandoff: BackendTool = {
      name: "switch_authoring_phase",
    };

    expect(classifyInterruptedCall(readOnly)).toEqual({
      code: "BACKEND_CALL_INTERRUPTED",
      safe_to_retry: true,
    });
    expect(classifyInterruptedCall(mutation)).toEqual({
      code: "OUTCOME_UNKNOWN",
      safe_to_retry: false,
    });
    expect(classifyInterruptedCall(phaseHandoff)).toEqual({
      code: "OUTCOME_UNKNOWN",
      safe_to_retry: false,
    });
  });

  test("a Runtime readOnlyHint cannot override the canonical capability and branch contract", () => {
    const optimistic = { readOnlyHint: true };
    const unsafe = { code: "OUTCOME_UNKNOWN", safe_to_retry: false };
    const retryable = { code: "BACKEND_CALL_INTERRUPTED", safe_to_retry: true };

    // A mutating native tool or an unknown tool can claim to be read-only.
    // Neither annotation grants safe transport replay.
    expect(classifyInterruptedCall({ name: "manage_cubes", annotations: optimistic },
      { operation: "create" })).toEqual(unsafe);
    expect(classifyInterruptedCall({ name: "unregistered_native_tool", annotations: optimistic }))
      .toEqual(unsafe);
    expect(classifyInterruptedCall({ name: "inspect_elements",
      annotations: { readOnlyHint: false } }, { mode: "detail" })).toEqual(unsafe);

    // A known query-only capability retains its default and exact query modes.
    expect(classifyInterruptedCall({ name: "inspect_elements", annotations: optimistic }))
      .toEqual(retryable);
    expect(classifyInterruptedCall({ name: "inspect_elements", annotations: optimistic },
      { mode: "detail" })).toEqual(retryable);
    expect(classifyInterruptedCall({ name: "inspect_elements", annotations: optimistic },
      { mode: "future_unknown_mode" })).toEqual(unsafe);

    // Query and mutation branches of the same capability must not borrow
    // each other's safety classification.
    const material = { name: "manage_material_instances", annotations: optimistic };
    expect(classifyInterruptedCall(material, { operation: "list" }))
      .toEqual(retryable);
    expect(classifyInterruptedCall(material, { operation: "set" }))
      .toEqual(unsafe);
    expect(classifyInterruptedCall(material)).toEqual(unsafe);
    expect(classifyInterruptedCall(material, { operation: "new_unknown_op" }))
      .toEqual(unsafe);
  });

  test("runtime signature ignores noisy health fields but invalidates on runtime identity or phase changes", () => {
    const base = {
      build_identity: "sha256:" + "a".repeat(64),
      instance_id: "runtime-1",
      startup_time: "2026-09-19T00:00:00.000Z",
      exposed_tool_count: 47,
      product: {
        id: "lazydesigner",
        version: "0.2.0",
        profile: "AUTHORING",
        authoring_phase: "geometry",
      },
      noisy_internal_field: { queue: 9 },
    };

    const sameIdentity = {
      ...base,
      noisy_internal_field: { queue: 999, transient: true },
    };
    const newInstance = {
      ...base,
      instance_id: "runtime-2",
    };
    const newPhase = {
      ...base,
      product: {
        ...base.product,
        authoring_phase: "animation",
      },
    };

    expect(createRuntimeSignature(sameIdentity)).toBe(
      createRuntimeSignature(base)
    );
    expect(createRuntimeSignature(newInstance)).not.toBe(
      createRuntimeSignature(base)
    );
    expect(createRuntimeSignature(newPhase)).not.toBe(
      createRuntimeSignature(base)
    );
  });
});
