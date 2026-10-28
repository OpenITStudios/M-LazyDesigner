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

### Risk-first coincidence review (source-only)

The existing `assessRecipeNativeCoincidence` now classifies each exact
same-parent geometry group using only its established evidence: authored
Geometry/parent identity, Anchor constraints, Symmetry relations, native
UV/PBR/material differences and content-addressed parent Bone tracks.

`optimization_risk.category` has four **review priorities**, applied in
fixed precedence:

1. `STRUCTURAL_DEPENDENCY`: an Anchor or Symmetry relation protects an
   authored relationship regardless of visual-field matches.
2. `OBSERVED_DIFFERENCE_OR_MOTION`: mismatched UV/material assignments or
   observed keyed ancestor motion need separate native inspection.
3. `EVIDENCE_INCOMPLETE`: missing UV/material or animation coverage is an
   unknown, never a positive inference of redundancy.
4. `MANUAL_VISUAL_REVIEW`: reviewed source fields match, but rendered
   similarity, animation/controller behavior and export equivalence remain
   unproven.

All matching reasons remain in deterministic `reason_codes`, including
unavailable evidence when a higher-priority issue also exists. An observed
material assignment/visibility difference is reported even if a missing
texture prevents full material verification: these are **two independent
facts**, never a reason to suppress the mismatch. The result contains one
bounded next-review recommendation, not an execution command.
The `optimization_risk_summary` counts **all** candidate groups even when
`candidate_examples` is truncated to eight. These categories are
explanatory priority labels, **not** probabilities, quality scores, measured
Cube savings, native readiness gates, or permission to mutate. Every candidate
retains `safe_to_delete: false` and `optimization_risk.native_removal_authorized:
false`; the report remains `native_mutation_executed: false` with visual
verdict `NOT_EVALUATED`.
No new registry, GPU model, evaluator, public Gateway surface or Undo path.

### Risk-guided review batches — before any proposed Geometry mutation

The same opt-in `assessRecipeNativeCoincidence` report contains
`optimization_review_plan`. This is a **source-only review plan** for
candidate coincidence, NOT a post-apply `VerificationTask`: the canonical
`orchestration/verificationPlan.ts` still owns verification AFTER a
real authoring impact. Here, six review checks are routed to the existing
Recipe, UV, material, animation and visual/export evidence owners,
ordered and deduplicated per domain:

- `RECIPE_ANCHOR_RELATION`: exact saved Recipe constraint source/target IDs
- `RECIPE_SYMMETRY_RELATION`: exact mirror relations and UV/texture/rig policies
- `NATIVE_UV_MAPPING`: affected native Cube UUID UV/face orientation and mapping
- `NATIVE_MATERIAL_BINDING`: affected face materials, atlas revisions and PBR channels
- `NATIVE_BONE_ANIMATION`: scoped parent Bone tracks, keyframe content and clips
- `NATIVE_VISUAL_AND_EXPORT`: reference, relevant pose, scene and native export proof

One check per domain can carry **multiple risk reason codes**, including a
simultaneously observed material difference and missing material evidence.
The plan aggregates all candidate groups into at most six owner batches;
it carries exact total group/instance/UUID/relation/clip counts but only
bounded sorted scope examples. A 9-group review cannot silently become an
8-group review just because candidate examples are truncated. UV-only
problems target their affected candidate groups, rather than triggering
a full model-wide recheck. The risk reasons, candidate review IDs, and
report-wide batches are deterministically derived from the same already
validated source; they never invent external image evidence or tools.
When an example scope is truncated, its ID examples are **not** sufficient
to execute complete review: retrieve the full fresh owner inventory first,
rather than treating preview examples as the exhaustive list.

Every check has `execution_state: NOT_EXECUTED`, and the plan has
`state: PREPARED_SOURCE_ONLY`, `native_review_executed: false`,
`native_mutation_authorized: false`, and `visual_verdict: NOT_EVALUATED`.
The evidence owners are **requirements**, not verified availability of
specific Gateway tools or background actions. Completing these checks
needs separately grounded results; even success does not automatically
authorize Cube deletion, Texture handoff or release.

### Risk review source readiness and freshness (no execution)

The same read-only coincidence report now includes
`review_source_identity` containing the complete saved **Recipe source**
revision (including constraint/symmetry/feature metadata), owned native Cube
and Group fingerprint, optional UV/material/animation surface fingerprint,
native project UUID, review-batch fingerprint and an overall binding digest.
These `sha256:` values are **drift detectors**, not signed/authenticated
receipts. In particular, a Recipe metadata change can invalidate an old
review even when compiled Cube coordinates and the native Undo fingerprint
are unchanged.

Each existing risk-guided review batch retains `execution_state: NOT_EXECUTED`
and adds one narrowly defined `source_readiness`:
`SOURCE_FIELDS_PRESENT` (read-only fields observed),
`SOURCE_FIELDS_INCOMPLETE` (required owner source unavailable), or
`NATIVE_PROOF_REQUIRED` (rendered visual/pose/export evidence still missing).
The summary never calls a source read a verified review or a visual PASS.
Examples truncated to 12 IDs are *not* an exhaustive executable work scope.

The existing `AuthoringRecipeService` offers
`checkStoredGeometryOptimizationReviewFreshness`. Given the **full prior
report source identity** and the exact saved Recipe ID, it executes a fresh
read using the same read-only inspection owner and compares independently
the Recipe, native geometry/parent state, UV/material/animation, native
project UUID, and current review plan. It returns:

- `SOURCE_STALE`: one or more source dimensions differ; discard the old
  review plan and use the returned current plan as a new review baseline.
- `SOURCE_INCOMPLETE`: source dimensions match but current required data
  are absent; no completeness/quality acceptance is possible.
- `SOURCE_CURRENT`: all *observed source dimensions* match and required
  source fields are present. The actual owner/native/visual review is still
  `NOT_EXECUTED`, regardless of this result.

Malformed or inconsistent caller-supplied identities fail closed before
re-reading the source. The saved Recipe is cloned for inspection and read
again before returning, because metadata can change independently of native
Cube geometry. Native surface capture also rechecks face texture/material
bindings, bitmap revisions, TextureGroup membership, UV, authored Bone track
content and owned geometry against the active project; mixed-source snapshots
are refused. These are **point-in-time consistency checks**, not transaction
locks or proof that externally supplied baseline IDs are authentic. No new
state manager, material mutation, auto-merge, public tool, native verification,
or Cube deletion is implied.

### Full owner-scope binding and review reference reconciliation

For every pre-optimization review batch, `full_scope_fingerprint` now hashes
the **complete** canonical check identity, evidence-owner label, reason codes,
candidate-group count and complete sorted Recipe instance/native Cube UUID,
Anchor, Symmetry and animation-clip ID sets **before** output examples are
truncated. The public summary still limits display IDs to twelve. This avoids
treating the first twelve examples as the full scope when reviewing large
assets. A claimant's scope manifest is independently validated for bounded
nonempty unique IDs, valid owner/check association and exact fingerprint
equality. The fingerprint is not a signed receipt or a capability to mutate.

The same existing `AuthoringRecipeService` now offers internal
`reconcileStoredGeometryOptimizationReviewEvidence`. It reuses the B9
freshness check and the current six-owner review plan before considering
up to six caller-supplied opaque evidence references. Each submitted reference
must identify the exact owner/check, previously bound source identity and
**complete** declared native/Recipe/relationship scope. Mixed sources,
wrong owner associations, omitted Cubes and duplicate/unplanned checks are
rejected or explicitly reported without using a fallback to names or
preview examples.

Reconciliation has strictly **non-authoritative diagnostic states**:

- `SOURCE_STALE`: the saved Recipe/native/surface/project/review plan changed;
  previously submitted check references cannot be reused.
- `REFERENCES_MISMATCHED`: a source binding or full intended scope differs.
- `REFERENCES_MISSING`: a required review owner has no submitted reference.
- `SOURCE_INCOMPLETE`: current native input lacks required source fields,
  even if a claimant supplies a reference.
- `REFERENCES_BOUND_UNATTESTED`: only reference identity and complete declared
  scope match the latest read. **No native owner proof has been authenticated.**
- `NO_REVIEW_CANDIDATES`: there are no coincident groups to review.

The output never repeats arbitrary reference content and always reports
`owner_provenance_verified: false`, `verified_evidence_count: 0`,
`native_review_executed: false`, `review_approved: false`,
`safe_to_delete: false` and `native_mutation_authorized: false`. The
current Recipe evidence registry holds Recipe Apply receipts and semantic
identities, not independent UV/material/animation/visual PASS receipts;
it **must not be repurposed** into a fake all-owner authority. Resolving those
owner-specific native receipts requires a separate authenticated producer
contract and installed evidence, not a self-declared handle. Even a correctly
bound reference is not visual, rig, export or deletion acceptance.

### Canonical saved-Recipe source observation ownership

The existing `AuthoringRecipeService` now exposes
`captureStoredRecipeOptimizationSourceObservations` for **only**
`RECIPE_ANCHOR_RELATION` and `RECIPE_SYMMETRY_RELATION`, the two owner checks
that can genuinely be sourced from the currently saved Recipe. It first
re-inspects source freshness and refuses stale baselines. A successful source
read issues a short-lived `RECIPE_REVIEW_SOURCE_OBSERVATION` handle in the
**existing bounded `AuthoringEvidenceRegistry`**, not a new receipt store.
The handle is meaningful only when resolved by the same live Recipe Service
registry; it expires upon eviction or a Runtime generation change. Source
observations have **lower retention priority** than saved semantic-identity
and Apply receipts: the existing bounded registry refuses an entire new
source-observation batch if it cannot fit without displacing protected Recipe
evidence. A later important Recipe receipt may still evict an earlier review
source observation. This protects pending transactional recovery from routine
read-only review scans. No second registry is introduced. The handle is not
a cryptographic signature, native test receipt, or external issuer credential.

`reconcileStoredGeometryOptimizationReviewEvidence` optionally accepts
`owner_source_observation_handle` on a claimant's exact full-scope reference.
It accepts an observation as genuinely service-issued only after checking
the same registry's record kind, saved Recipe ID, exact planned Anchor/Symmetry
owner/check, source binding, full-scope hash and observation purpose.
Unregistered, expired, malformed, wrong-kind, cross-service or wrong-owner
handles cannot establish source ownership. A properly resolved record is
reported as `RECIPE_SOURCE_OBSERVED_NOT_REVIEWED`; an invalid one is
`OWNER_SOURCE_OBSERVATION_REJECTED`. Legacy caller-supplied reference IDs
without an issuer handle remain `REFERENCE_BOUND_UNATTESTED`.

This limited source observation **does not authenticate independent**
native UV, PBR/material, animation, reference visual or Bedrock export
check outcomes. In particular, a valid Recipe source handle cannot be
replayed as proof from a different evidence owner; it does not resolve an
Anchor/Symmetry semantic risk, complete visual acceptance or enable deletion.
The reconciliation always retains `verified_evidence_count: 0`,
`owner_provenance_verified: false`, `review_approved: false`,
`safe_to_delete: false` and `native_mutation_authorized: false`.
Real cross-owner review acceptance needs actual owner-owned evidence
issuance and independent native proof; **source snapshots and hash handles
must never be promoted into an artificial PASS**.

This is not a fifth Gateway tool, a 3D inference model, or a new manager.

`planning.ts` owns pure planning APIs. `service.ts` owns bounded stateful plan/apply/identity/evidence lifecycle and may compose recipe modules, but recipe source must not depend on Gateway or Runtime executors.

Recipe code must not depend on `orchestration/`. Orchestration may consume recipe outputs.

## B12 — Existing Runtime inspection integration (source-only)

The canonical Recipe read-only pipeline is now **reachable from the existing
`inspect_elements` capability**, without installing a new checker or public
tool. Use its retained `mode=detail` branch with an **exact native Cube UUID**
and the optional `recipe_optimization_review: true` flag. The same
`inspect_element` executor owns the behavior; the consolidated route reuses
its canonical input schema and execution function.

Only a Cube with both valid `lazydesigner_recipe_id` and
`lazydesigner_recipe_instance_id` can request the opt-in review. The executor
uses `readAuthoringRecipeCubeOwnership` to discover saved ownership, invokes
the existing `createBlockbenchAuthoringRecipeService()`, then reads
`inspectStoredGeometryCoincidence({ recipe_id })`. The response appends
`recipe_optimization_review` to ordinary Cube inspection, including the
selected Cube/instance/Recipe identity, native source fingerprints, exact
same-parent coincidence candidate examples, risk categories, deduplicated
owner review requirements and freshness source identity. It validates that
the exact selected Cube and project remain current before returning. It
does **not** build a second optimizer, run per-Cube checkers, create a new
Gateway capability, initiate Undo, call Apply, inspect animation poses, or
remove Geometry.

The flag is optional and defaults to absent: ordinary
`inspect_elements(mode=detail)` and `inspect_element` retain their legacy
shape and do **not** incur expensive Recipe/UV/bitmap/animation reads. All
other detail modes and existing outline/search branches are unchanged.
A request to review an unowned Cube, Group or other element fails explicitly,
as does a name instead of an exact Cube UUID; no silent source ownership is
inferred from visual similarity.

This is **source-level Runtime wiring**, not proof that a packaged plugin
executed successfully in live Blockbench. A fresh opt-in inspection can
report candidates, uncertainty and exact review work but must continue to
return `state: REVIEW_ONLY`, `native_mutation_executed: false`,
`visual_verdict: NOT_EVALUATED`, and no inferred removable Cube count.
A one-shot inspection instantiates a temporary Recipe Service; it does **not**
issue persistent cross-call evidence handles or claim an authenticated
UV/material/animation/visual review. Full native/visual and Bedrock-export
equivalence still require independent installed evidence before a
later explicit representation-change transaction is even considered.

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
