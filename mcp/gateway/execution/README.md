# Gateway Execution

Owns capability invocation orchestration across Runtime, Control, capability policy, local providers, session state, and benchmark tracing.

```text
capabilityExecutor.ts
  Runtime invocation
  precondition evaluation
  Control receipt/delta projection
  session fact updates
  result compaction
  trace recording
```

This domain is intentionally above `runtime/` and `control/`.

Dependency direction:

```text
execution -> runtime
execution -> control
execution -> capabilities
execution -> providers
execution -> session

runtime -X-> control
runtime -X-> execution
```

Do not move transport/reconnect state, authored state, or capability metadata ownership into this folder.


`gatewayErrors.ts` owns AI-facing error/result adaptation and trace metadata extraction for Gateway tool execution. Runtime owns backend error contracts and recovery policy inputs, not MCP result shaping.

## Error identity and diagnostic provenance

Gateway error adaptation may preserve bounded native/transport diagnostic
fields, but these details cannot override the canonical `code`, `message`,
or computed `recovery` fields. In particular, a nested error detail must
never turn `OUTCOME_UNKNOWN` into an apparently retryable read-only error,
or hide an unverified native phase receipt. This is an output-shaping guard,
not a new Runtime error category, retry mechanism or authenticated receipt.

