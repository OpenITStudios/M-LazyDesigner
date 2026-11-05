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

## Recorder-owned Golden session identity

When opt-in Gateway benchmark trace recording is enabled, each recorder
instance writes `gateway_session_id`, the recorder's existing random
128-bit local nonce, on every trace event. This is independent of a client
`traceparent`; two client traces can share a Gateway recorder instance
while two recorder instances obtain different session IDs. The field is
not emitted on the normal disabled hot path, and older v1 rows omit it.
It is *recorded correlation metadata*, not a signed identity or proof
of actual native model quality. No prompts, raw project UUIDs, paths or
images are added to trace metadata.

## Canonical image evidence boundaries

The opt-in Golden capture digest and the MCP image-delivery counter use the
same strict Base64 byte validation (at most 128 MCP content items and 64 MiB
of encoded characters per image). The opt-in recorder measures *all* delivered
images once and shares that result with its Golden capture gate. A malformed
extra image (including a silhouette, four-side sheet or ingestion probe)
suppresses model-view capture evidence even if the primary labeled PNG is
valid. Valid extra images remain permitted. A malformed/oversized response
cannot produce a capture digest when delivery metrics are invalid. This is
content integrity, **not** a claim that an AI viewed the images or that the
pixels passed visual review. Trace rows store digests and metadata, not pixels.

## Error identity and diagnostic provenance

Gateway error adaptation may preserve bounded native/transport diagnostic
fields, but these details cannot override the canonical `code`, `message`,
or computed `recovery` fields. In particular, a nested error detail must
never turn `OUTCOME_UNKNOWN` into an apparently retryable read-only error,
or hide an unverified native phase receipt. This is an output-shaping guard,
not a new Runtime error category, retry mechanism or authenticated receipt.

