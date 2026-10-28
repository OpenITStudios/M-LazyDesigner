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

The existing `featureDecision.ts` now also assesses **read-only representation
change candidates** using the existing compiler's pattern/instance ownership.
`planning.ts` exposes `assessRecipeFeatureOptimization` for explicit proposal
features, including mirrored Cube instances traced to the original feature.
It reports a review requirement before changing an authored Geometry feature
to Texture/Omit, never issues native removals, invents texture pixels, or
claims that a Recipe instance count is a verified live Cube saving. A legacy
Recipe without explicit feature ownership cannot be auto-optimized.

The read-only report also traces canonical `ANCHOR` constraint endpoints through
the compiled instance-to-feature identity map, including Recipe-owned symmetry
instances. A proposed Geometry→Texture/Omit change that leaves a constraint
connected to another retained/unresolved feature is marked
`CONSTRAINT_DEPENDENCY_REVIEW_REQUIRED`. The summary distinguishes constraints
with retained peer features from constraints wholly internal to the proposed
change. Neither case authorizes native deletion, ignores dependent rigs/UVs,
or proves an atlas can replace the geometry. Coordinates or display names do
not establish dependency ownership.

Reference-driven correction planning reuses the canonical Cube geometry
contract: `reference/correction.ts` rejects overflowed numeric differences;
`semanticEdit.ts` validates all proposed Cube endpoints/pivots/rotations and
rendered spans before a correction plan is returned; and
`semanticRewrite.ts` recompiles recipes with constraints/symmetry to catch
invalid dependent Cubes, without recomputing independent-only changes. A correction cannot silently emit invalid
Geometry after arithmetic rounding or deflation. These checks are pure and
non-destructive, **not** a visual scorer or geometry auto-simplifier.
Fractional 3D remains eligible for explicit Per-face UV.

Reference BOUNDS intents use CENTER resize. The existing semantic rewrite now
shifts directly owned LINEAR/GRID/RADIAL patterns for MIN/CENTER/MAX anchors,
and preserves the original authored pivot rather than silently recentering it.
On resize, the final compiled selected Cubes must match proposed bounds,
pivot and rotation even without relations. For translations, rotations and
inflate operations with constraints/symmetry, that same selected-Cube parity
prevents a successfully compiled Recipe from silently ignoring a correction:
an ANCHOR can overwrite a child pattern's proposed translation. Contradictory
edits fail before native Undo; orthogonal free-axis edits and movements of the
constraint-owning target remain valid. Independent non-resize rewrites do not
pay for redundant recompilation. Dependent but unselected geometry still
follows its explicit constraints. This does not invent offsets or override
constraint ownership to force an impossible per-instance change.

The compiler also reuses canonical Cube span checks for prototypes and realized pattern/constraint/symmetry instances. Nonfinite endpoints, invalid pivots, negative rendered spans and positive dimensions lost through numeric rounding fail before plan/apply. UV-mode-specific Box UV restrictions remain with the native adapter, where actual mode is known.

## Bounded pattern expansion

The single `patterns.ts` limit is **4,096 realized instances** per Authoring
Recipe v1, including symmetry. It is a resource-safety ceiling, **not** a
model-quality score or stylistic Cube target. Direct GRID expansion checks
the product of both counts before allocation; `compiler.ts` counts every
pattern and planned mirror before building temporary Cubes or evaluating
constraints/Undo. Oversized requests fail explicitly, never truncate,
sample, split or silently remove Geometry.

The pure pattern, anchor constraint, and symmetry helpers now reject
nonfinite derived coordinates at their calculation owners. Their output
cannot silently carry NaN or Infinity into a caller. The existing compiler
still owns final Cube-span validation and the bounded instance budget.

**Exact-Cube duplicate enforcement is deliberately not added to the
recipe compiler.** The compiler lacks native parent-group identity for
already owned/reparented Cubes, so a hard-coded "root" comparison could
mistake separately transformed Bones for coincident masses. Existing
direct `manage_cubes` duplicate guards remain active.

The existing `planning.ts` now also exposes the opt-in, read-only
`assessRecipeNativeCoincidence`. It accepts the current Recipe plus a
matching complete native owned-Cube snapshot, rejects missing/ambiguous Group
ancestry or inconsistent ancestor state, and groups **exact authored geometry
under the same native parent**. The current Recipe Service exposes
`inspectStoredGeometryCoincidence` using its original stored-Recipe/native
reader; no new MCP tool or state owner is created. Reported groups include
related anchor and symmetry references, not deletion commands. Matching parent,
bounds, pivot, rotation and inflate do **not** prove that UVs, textures,
per-Cube visibility, animation, unrelated scene contents or rendered appearance
are interchangeable. No Cube-count saving, native operation or visual PASS is
inferred. Legacy source-only snapshots without parent identity fail closed.

For an opt-in native inspection, `inspectStoredGeometryCoincidence` now also
accepts the Runtime owner's bounded read-only UV/material snapshot, distinct
from `AuthoringRecipeNativeSnapshot` and its Undo fingerprint. The planner
requires exact Recipe-owned UUID/instance alignment, current native source
fingerprint, all six face UV/rotation/enabled fields, Box UV settings, texture
references and revision digests. It reports **matched authored UV fields**,
**different UV fields**, **different material assignments/visibility**, or
**unverified material refs** independently for each coincident group. Atlas
image SHA is a revision of encoded image bytes, not pixel fidelity evidence.
The opt-in snapshot additionally includes per-face Bedrock material-instance
names, referenced TextureGroup identity/material configuration revisions,
and the full set of PBR companion channels (color, normal/height, MER), even
when their textures do not appear on Cube faces directly. Missing or
conflicting PBR memberships fail closed.

The same read-only inspection can report authored BoneAnimator tracks attached
to a Cube's ancestor Group UUIDs. Every reported keyed Bone track now carries
a bounded SHA-256 of the native keyframe Undo copies (including authored
values, Molang data, interpolation and handles) and a separate SHA-256 of
relevant clip timing/loop/source settings. An exact UUID/count match with
different keyframe content changes the per-group
`animated_motion_source_fingerprint` and overall surface revision; it cannot
silently reuse the prior motion review. Missing native keyframe identity/copy
data and oversized source payloads **fail closed**. Native capture is read-only
and does not run `Animator.preview()`, move the Timeline or edit keyframes.
This is a **structural motion dependency**, not a sampled animated pose or
evidence that unobserved controller/Molang effects are absent. If the native
animation inventory is unavailable, motion status stays `UNVERIFIED`;
`NO_PARENT_BONE_TRACKS_OBSERVED` does not mean a Cube is safe to delete.
No new rig or animation engine is introduced.
Even matched UV/material fields and absent observed parent tracks are not
proof of identical PBR/shaders, alpha/rendered appearance, animation,
Bedrock export or permission to delete, merge, or reduce any Cube. The
optional read runs only for targeted inspection and rechecks native geometry,
UV and material/animation inventories for in-flight source changes.

This is not a fifth Gateway tool, a 3D inference model, or a new manager.

`planning.ts` owns pure planning APIs. `service.ts` owns bounded stateful plan/apply/identity/evidence lifecycle and may compose recipe modules, but recipe source must not depend on Gateway or Runtime executors.

Recipe code must not depend on `orchestration/`. Orchestration may consume recipe outputs.

## Native Group ancestry and stale-plan safety

The native Recipe Cube snapshot includes both a root-to-parent Group UUID
`parent_path` and ordered `parent_authored_state`: origin/pivot, rotation,
Bone name/Bedrock binding, visibility, export, mirror UV and reset flags.
The original source fingerprint and stale-plan/Undo gate therefore detect
reparenting **and changes within the same ancestor Bone**, even when the
Cube's local coordinates remain unchanged. The pure, bounded/cycle-checked
hierarchy reader lives in existing `nativeState.ts`; the native adapter
supplies only the actual Blockbench Group identity predicate. There is no
new state owner, engine, tool or automatic reparent operation.

Both snapshot fields are optional for legacy pure callers and always
supplied by the native adapter. Existing pending plans may become stale:
re-plan rather than forcing a previous fingerprint. Authored Group
properties are distinct from evaluated animation pose or world-matrix
measurements, so native visual/motion fidelity still requires live proof.

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
