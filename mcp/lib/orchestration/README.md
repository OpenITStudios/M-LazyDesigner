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

## Production invocation boundary

`gateway/control/orchestration.ts` is the active Control continuation reducer; it derives next actions from actual `control_delta` results. The normal four-tool Gateway does **not** expose `CorrectionLoopRegistry` entrypoints. `gateway/session/orchestrationRecoveryState.ts` constructs the internal registry with the default null `applyEvidenceSource`, so its stored loops cannot complete a native Apply acknowledgement through that Gateway instance. Source tests of the internal correction solver are not evidence that Codex's normal `invoke_capability` calls pass through it.

The effective **current** Codex workflow is defined by the active Modelling Skill and conditionally loaded `references/correction.md`, using real Gateway capabilities and their receipts. Do not confuse registry `knownContinuationIds` with public `task_context_id` or Control's `control_delta` continuation. Any future native binding must demonstrate exact Authoring Recipe receipt ownership, project/revision freshness and accepted Golden quality before claiming live automatic correction enforcement.

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

For the opt-in `startFromObservations` path, an existing structured
visual discrepancy remains reviewable when its cause is `UNKNOWN`, but no
Geometry mutation is planned until a fresh cause-classified observation is
provided. The current prioritized claim must belong to Geometry, and every
candidate must target the **current prioritized** Geometry discrepancy with
an explicitly matching edit family. Lower-priority cheap detail edits cannot
replace that focal correction. A Texture/Animation claim or merely cheap correction
cannot authorize Geometry edits; the owning specialist must handle it.
Legacy raw-Recipe correction plans remain compatible. This source-level
causal gate does **not** authenticate screenshot labels, replace actual visual
comparison, or claim better artistic results.

Existing convergence tests that historically assumed an edit completed use
explicit synthetic native receipts. These fixtures do not prove Blockbench
execution, source compatibility or image-based acceptance.

Evidence registries remain domain-specific: recipe evidence represents recipe identity/apply receipts, while orchestration evidence represents scoped verification evidence with runtime/project invalidation semantics. Do not merge them into a generic registry solely because both use bounded maps.
