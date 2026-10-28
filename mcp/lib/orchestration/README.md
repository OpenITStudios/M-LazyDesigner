# Authoring Orchestration Domain

Owns execution sequencing and verification planning across authoring domains.

```text
impact
execution order
execution strategy
verification plan
evidence plan
freshness projection
correction continuation / loop
visual observation
```

This domain answers **when and in what order work should execute and be re-verified**.

Orchestration may consume pure authoring/recipe/reference contracts, but it must not import Gateway, Runtime executors, or Blockbench tool implementations. Runtime-specific adapters remain outside `lib/`.

A correction plan is **not** an executed edit. The canonical
`CorrectionLoopRegistry` now retains one ephemeral pending proposal without
changing the active base Recipe or consuming an executed attempt. An authoritative
`APPLY_RECEIPT` from the existing Recipe Service evidence registry must be
validated with `acknowledgeAppliedGeometryCorrection` before the next Recipe
becomes the base and affected model views are invalidated. The registry is
constructed using that same Recipe Service's `readEvidence` method and accepts
only its `authoringevidence:` handle from `applyCompact`. Raw receipt objects,
unknown/expired handles and unrelated semantic identity evidence are rejected.
The same source is not reconstructed or cached in Orchestration. Receipt identity,
actual changed instance IDs, native snapshot fingerprints, project identity
and Undo provenance fail closed. If an edit outcome is uncertain, inspect
native state independently; do not automatically replay or manufacture an
acknowledgement. A matching receipt is technical evidence, not visual PASS.

Existing convergence tests that historically assumed an edit completed use
explicit synthetic native receipts. These fixtures do not prove Blockbench
execution, source compatibility or image-based acceptance.

Evidence registries remain domain-specific: recipe evidence represents recipe identity/apply receipts, while orchestration evidence represents scoped verification evidence with runtime/project invalidation semantics. Do not merge them into a generic registry solely because both use bounded maps.
