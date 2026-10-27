# Gateway Capabilities

This folder owns AI-facing capability discovery and routing.

- `types.ts` — shared branch/routing/readiness fact contract types.
- `manifest.ts` — canonical branch identity, semantic hints, deferred schema fields and dependency graph metadata.
- `intelligence.ts` — deterministic BM25 + semantic ranking engine.
- `catalog.ts` — capability summarization + state-aware ranked catalog search.
- `graph.ts` — READY / UNKNOWN / BLOCKED precondition evaluation and ephemeral fact transitions.
- `schemaProjection.ts` — deferred branch-schema projection from the canonical manifest.
- `effects.ts` — Gateway affinity/catalog effect receipt resolution.
- `semanticRegistry.ts` — read-only compiled semantic catalog/fingerprints derived from the canonical manifest.
- `semanticDependencyMatrix.ts` — product semantic-surface dependency and refresh mapping.
- `semanticFreshness.ts` — deterministic consumer freshness against semantic catalog revisions.

### Capability dependency graph semantics

```text
manifest branch → requires → READY | UNKNOWN | BLOCKED
                → successful Runtime receipt → produces / invalidates
                → Control delta → bounded verify / continue / handoff
```

`UNKNOWN` deliberately defers to the native Runtime; a known-false prerequisite
blocks direct invoke. In compound search, earlier *possible* produce/invalidate
effects only make touched later prerequisites uncertain; no request or search
promotes a fact to true. Preserve confirmed false blockers and require fresh
receipts/reorientation between steps. Missing `graph` fields do not imply missing functionality
or permission to invent prerequisites. `lib/capabilities/manifest.ts` owns
Runtime capability and Stage metadata; `gateway/development/sourceOwners.ts`
owns engineering ownership; neither is duplicated here.

Same-purpose files retained at the `gateway/` root are compatibility re-exports only. Do not add new capability data there.

Runtime tool schemas remain authoritative for validation. Core lifecycle/tier/Stage metadata lives in `lib/capabilities/manifest.ts`. Engineering verification/check selection remains under `gateway/development/`; product status and capability surfaces must not depend on development-only planners.
