# Gateway Runtime Boundary

This folder owns the long-lived Gateway -> Blockbench Runtime connection boundary.

- `connectionManager.ts` — connection lifecycle coordinator.
- `reconnectPolicy.ts` — deterministic retry/backoff policy.
- `runtimeSession.ts` — process-local connection observability.
- `../../lib/runtime/affinity.ts` — canonical project/authoring affinity headers and health parsing.
- `recovery.ts` — normalized recovery guidance for Gateway errors.
- `backendContract.ts` — pure backend error/status/result contracts and normalization helpers.
- `operationQueue.ts` — serialized authoring queue + operation metrics.
- `affinityPolicy.ts` — pure project/authoring affinity validation and binding policy.
- `identity.ts` — Runtime URL validation + stable Runtime signature.
- `interruptionPolicy.ts` — read-only vs mutation interruption retry classification.

The same-named files at `gateway/` are compatibility re-exports only. Keep the Gateway↔Runtime backend adapter in `gateway/runtime/backend.ts`; capability search, Control, and execution orchestration belong above this layer.


## Incomplete native affinity receipts

A successful Runtime mutation without a valid project-creation or Stage-handoff
receipt might already have changed native state. The Backend withdraws its
catalog and returns `BACKEND_UNAVAILABLE` with `receipt_issue`; recovery
must preserve `safe_to_retry=false` and `state_uncertain=true`.
Refresh status and inspect the actual project/Stage before any deliberate rebind
or new mutation. Ordinary offline health and pre-execution queue cancellation
retain their separate retry semantics.

## Runtime catalog handshake integrity

The canonical `tools/list` snapshot must contain at least one capability
and unique, nonblank names across all pages. A repeated pagination cursor or
more than 100 unfinished pages fails the same handshake instead of silently
replacing a capability or publishing an unusable catalog. The existing
`connectFreshUnsafe` catch withdraws the client and catalog and marks the
connection degraded. Only a complete matching-generation catalog may become
`ready`. No secondary catalog or retry loop is introduced.

## Runtime generation signal

Runtime detects replacement/reconnect boundaries and reports generation changes upward. Verification evidence, correction-loop recovery, project epochs, and continuation invalidation are owned by `../session/orchestrationRecoveryState.ts`, not by Runtime transport.


Cross-layer capability invocation orchestration is not Runtime-owned. It lives in `../execution/`. The former `capabilityExecutor.ts` Runtime path is compatibility-only.


## Compatibility-only migrated paths

```text
capabilityExecutor.ts          -> ../execution/capabilityExecutor.ts
benchmarkTrace.ts              -> ../execution/benchmarkTrace.ts
orchestrationRecoveryState.ts  -> ../session/orchestrationRecoveryState.ts
gatewayErrors.ts                -> ../execution/gatewayErrors.ts
projectAffinity.ts             -> ../../lib/runtime/affinity.ts
```

Do not add implementation to these files.
