# LazyDesigner Modelling Correction and Convergence Reference

This file is loaded only for its named modelling decision. Durable Geometry policy remains in `docs/03-authoring/modelling/standard.md`; the modelling Skill owns hot-path execution triggers.


Load only when a bounded geometry correction/convergence loop or post-mutation evidence recovery is active.

## Actual Codex → Gateway correction workflow

Production Codex has four Gateway tools: `status`, `search_capabilities`, `describe_capability`, and `invoke_capability`. Control returns `task_context_id`, `control_delta`, and a scoped next action. These are **not** the `correctionloop:` / `correctionctx:` handles of the internal `CorrectionLoopRegistry`. There is currently no normal Gateway invocation of `startFromObservations` / `planGeometryCorrection`, and Gateway's registry does not have a bound Authoring Recipe Apply evidence reader. Do not invent a visual-correction MCP capability or claim its guards were executed.

For a material visual correction (not an already specified numeric edit), do the following within the existing Modelling specialist:

1. **Pair actual images:** Use the approved source image delivered by `status(reference_package_path=..., include_reference_images=true)` and a fresh revision-matched `capture_model_views` view. Compare front direction, view, pose, scale and shading. An image ID, source path, or prior observation does not prove the corresponding pixels were reviewed. If source/model pairing is genuinely ambiguous, mark `UNVERIFIED` and request only decision-changing evidence.
2. **Diagnose the first cause:** Identify the highest-impact source-visible discrepancy, its exact part/UUID, owner and cause. Preserve required part count, silhouette, attachment/contact, negative space and motion pivots. A wrong proportion alone does not justify adding decorative Cubes; a Texture-owned marking is not a Geometry problem. Unknown cause is a reason to inspect, not to perform speculative mutation.
3. **Choose a supported native operation:** Use `invoke_capability` with an already described/current schema: `manage_cubes` for known bounded Cube operations, or the relevant existing Group/Bone tool for structure. Pick one coherent correction cohort and explicit affected IDs. Do not disguise reattachment or missing topology as a numerical resize. Never pass invented `visual_observations`, `knownContinuationIds`, or `correction_loop` arguments to normal Gateway tools.
4. **Trust receipts only for execution:** Use the returned native receipt and `control_delta` to track affected state and the next verification action. A Recipe plan, predicted improvement, or synthetic Apply receipt does **not** show that the live Blockbench model changed. On uncertain/failed outcome, inspect authoritative native state; never replay the mutation automatically.
5. **Verify only what changed:** Compare the affected current capture(s) with the same authoritative source images; check for cross-view and downstream UV/Texture regressions when relevant. Report `IMPROVED | UNCHANGED | REGRESSED` separately from visual `PASS | FAIL | UNVERIFIED`. The latter requires an actual source/model image review. Two unchanged same-cause corrections without new evidence lead to `BLOCKED`, not repeated variations.

This conditional client-side decision procedure connects artistic research to **available** production tools without adding a second validator, a new public MCP tool, automatic view capture per Cube, or another Golden task. For routine known exact edits, do not load this section.

## Local Correction / Convergence
The **internal registry's** correction continuation is process-local and incremental; this is not the normal Codex/Control continuation:

```text
CANDIDATE_CONTEXT → DECISION_SUMMARY → VERIFY_PENDING → PRUNED_READY → CLEAR/BLOCKED
FULL | DELTA | CACHED | DEFERRED
```

For internal source/tests only, reuse `continuation_id` via `knownContinuationIds`—this is not a Gateway input. For production, use `task_context_id`, `control_delta`, and its actual continuation instead. `decision_summary` is immediate-handoff only; later turns use the pruned continuation containing unresolved discrepancies, fresh per-view evidence handles, and pending verification. Known unchanged state → CACHED; known changed base → DELTA; unknown base → FULL. Same-mode/state micro updates may be DEFERRED inside a runtime-owned semantic group, but any mode/state change flushes immediately. Resolved branches, stale handles, old candidate IDs/metrics, full recipe state, and fingerprints do not persist model-facing. Full rejected candidate patches remain ephemeral. Evidence recovery is fail-closed: expired or cross-generation evidence requires complete fresh stale-view coverage before correction resumes, does not consume an attempt, aborts open grouping, and unknown continuation base uses FULL. `UNKNOWN_OUTCOME` never auto-retries. Gateway process restart invalidates process-local handles; resume from fresh status, Runtime/Workspace/Reference state, and fresh required evidence rather than replaying old correction/evidence/continuation IDs.

For correction ambiguity, do not enumerate a large option tree. Candidate budget follows verification risk: `LOW=1 | MEDIUM=2 | HIGH=3`. Each executable candidate must stay inside one supported family: `TRANSLATE→TRANSLATE`, `RESIZE→RESIZE_AXIS`, `ROTATE→ROTATE_AXIS`, `LAYER_OFFSET→TRANSLATE|RESIZE_AXIS|INFLATE`. `REATTACH | SPLIT | MERGE_REMOVE | ADD_MASS` require their owning structural path and must not be disguised as semantic-edit candidates. If the bounded candidate set is still insufficient, keep the decision ambiguous/blocked rather than emitting more speculative candidates.

For a visual mismatch, compress judgment into the existing `CompactAuthoringIntent`; do not replay a prose diagnosis before execution:

```text
target
difference = { criterion, severity, view, delta, claim_id? }
correction_family = TRANSLATE | RESIZE | ROTATE | REATTACH | LAYER_OFFSET | SPLIT | MERGE_REMOVE | ADD_MASS
geometry_operations = exact semantic operation(s)
preserve = only affected invariants
```

`delta` is one bounded observable mismatch, not an explanation. Reuse fresh exact authored state; otherwise inspect once. `LAYER_OFFSET` uses translate/resize or justified inflate/deflate, never a universal epsilon. `MERGE_REMOVE`/`REATTACH` preserve assembly boundaries/openings; mapped/textured `RESIZE` preflights UV/pixel impact.
When multiple discrepancies exist, bind the chosen correction to `target_discrepancy_codes`; re-verification should carry only those targeted stale discrepancies while keeping the complete evidence set local in the correction registry. When discrepancy view provenance is complete, recapture only targeted stale views and reuse unrelated prior views through the existing evidence handle. If provenance is incomplete, recapture conservatively; never infer view freshness. After mutation, recapture only affected evidence and judge `IMPROVED | UNCHANGED | REGRESSED`; progress requires improvement with no material regression. Same causal direction failing twice without new evidence → `BLOCKED`.
