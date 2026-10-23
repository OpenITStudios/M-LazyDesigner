# Authoring Recipe Domain

Owns declarative, deterministic recipe semantics for parametric authoring.

```text
recipe contracts
compile / rewrite
semantic edit / identity
incremental rebuild
native-state comparison
plan/apply transaction
recipe persistence
pure planning
stateful recipe service
```

This domain answers **what should be authored and how a recipe changes**.

## Opt-in semantic feature representation

`featureDecision.ts` supplies a compact, deterministic feature-level choice:
`GEOMETRY | TEXTURE | OMIT | REVIEW_REQUIRED`. It uses **explicit**
`feature_intents` (supported reference evidence, visual role and the
Geometry Standard's material 3D contributions), never Cube names,
dimensions, or automatic visual assumptions. A supported decision also needs
non-empty `evidence_refs` source-view/claim handles; an unreferenced
"SUPPORTED" is review-required, not a claim of proof. `planning.ts` exposes that
pure decision API; `compiler.ts` enforces `pattern.feature_id` ownership
before expanding native Cubes when the feature contract is present.

- A supported surface marking with no 3D purpose routes to a **Texture
  handoff**, not a Cube; an unreferenced or conflicting feature needs review.
- A supported horn/joint/part with silhouette, contact, transform or motion
  value remains Geometry. This does not choose its final Cube count or pivot.
- Pattern ownership pointing at Texture/Omit is **rejected**, never silently
  discarded. An unresolved feature with no Cube pattern stays deferred rather
  than blocking unrelated supported structural Geometry; a Cube depending on
  that unresolved feature fails preflight. No painting, removal, or visual
  approval is implied.
- Component composition namespaces planned feature IDs and rejects mixed
  planned/unplanned components rather than dropping enforcement.
- Existing recipe schema 1 without `feature_intents` compiles unchanged.
  Incremental reclassification of an existing 3D part to Texture/Omit refuses
  implicit native deletion; the replacement must be reviewed in the existing
  Texture/Geometry lifecycle.

The compiler also reuses canonical Cube span checks for prototypes and realized pattern/constraint/symmetry instances. Nonfinite endpoints, invalid pivots, negative rendered spans and positive dimensions lost through numeric rounding fail before plan/apply. UV-mode-specific Box UV restrictions remain with the native adapter, where actual mode is known.

## Bounded pattern expansion

The single `patterns.ts` limit is **4,096 realized instances** per Authoring
Recipe v1, including symmetry. It is a resource-safety ceiling, **not** a
model-quality score or stylistic Cube target. Direct GRID expansion checks
the product of both counts before allocation; `compiler.ts` counts every
pattern and planned mirror before building temporary Cubes or evaluating
constraints/Undo. Oversized requests fail explicitly, never truncate,
sample, split or silently remove Geometry.

This is not a fifth Gateway tool, a 3D inference model, or a new manager.

`planning.ts` owns pure planning APIs. `service.ts` owns bounded stateful plan/apply/identity/evidence lifecycle and may compose recipe modules, but recipe source must not depend on Gateway or Runtime executors.

Recipe code must not depend on `orchestration/`. Orchestration may consume recipe outputs.

## Native Undo and pre-commit boundary

`transaction.ts` owns the parametric recipe's atomic apply contract.
The single Blockbench owner is
`mcp/server/runtime/recipes/authoring/runtime.ts`:

1. read exact owned native snapshot/fingerprint and compile affected instances;
2. open native `Undo.initEdit` for affected existing Cubes + outliner;
3. mutate only owned instances and validate the compiled post-state;
   save the pre-edit *existing* Cubes and the post-edit *surviving updated +
   created* Cubes, omitting deleted Cubes from post-save. Capture outliner in
   both directions: Blockbench 5.2.1 `UndoSystem.save.load` removes elements
   missing from the opposite snapshot, so asymmetrical tracking can damage
   Undo/Redo of modified/deleted geometry;
4. invoke the existing adapter's **read-only** `verifyBeforeCommit` while its
   exact Undo save is still active, then re-read/fingerprint the native state;
5. construct a receipt before `Undo.finishEdit`, which is the last stateful
   action; no verification work may follow a successful commit.

If an in-flight check fails, the native owner cancels **its own**
`Undo.current_save` with `Undo.cancelEdit(true)`. The transaction then
reads back the exact pre-apply snapshot fingerprint. A mismatch or lost Undo
ownership returns `RECIPE_APPLY_ROLLBACK_UNVERIFIED`, never a success receipt.
Do not use an unscoped `Undo.undo()`: a subsequent edit could belong to
someone else.

## Exact-last-edit recovery after commit

The existing `applyCompact` evidence receipt may carry short-lived
`native_undo_provenance` from the genuine Blockbench Undo transaction.
The native owner stamps a private Symbol on **Undo.current_save before**
`Undo.finishEdit`; Blockbench 5.2.1 stores this exact save object in
`Undo.history[index].before`. This does not create another history or
an auxiliary registry. A fake/source-only adapter returns no such proof
and therefore cannot authorize post-commit rollback.

The existing `AuthoringRecipeService.revertApplied` accepts only an
`APPLY_RECEIPT` handle from its existing bounded evidence registry and
an exact post-apply native fingerprint. The native adapter then checks,
synchronously before `Undo.undo()`, that (1) the correct project is active,
(2) no edit is open, (3) the current history entry is **the final entry**,
(4) its private token and recipe/project/before/after provenance match,
and (5) the currently owned Cube snapshot still matches the receipt.
After native Undo, the original fingerprint is rechecked. Any uncertainty
is a refusal or `RECIPE_POSTCOMMIT_UNDO_UNVERIFIED`, never an automatic
retry or an unscoped history traversal. The eligibility is ephemeral and
is lost when native history changes or the service's evidence handle expires.

This is an **explicit owner-mediated recovery path**, not automatic
rollback triggered by landmark measurements, a public fifth Gateway tool,
or a guarantee that live Blockbench Undo has passed acceptance. The
existing `CorrectionLoopRegistry` continues to veto incompatible or
regressed measurements without invoking native mutation.
