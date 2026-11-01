# Geometry Intelligence — Implementation Design

Status: **R0 CURATED; R1–R4 SOURCE IMPLEMENTED; R5 SOURCE BENCHMARK GATE
AUTHORED (NOT EXECUTED)** (2026-10-29). Existing Recipe planning and opt-in
inspection return conditional Geometry reviews. The existing Golden
comparison now has a strict, benchmark-only matched-source Knowledge
intervention guard; no live R5 runs, native proof, measured improvement,
auto-Cube/Bone creation, trained weights or accepted new asset.
Owner: existing Geometry/Recipe domain. This document is the conditional
engineering design for [curated external sources](research-sources.md),
not a second production workflow. Actual modelling policy remains in
[standard.md](standard.md), cases in [decision-cases.md](decision-cases.md),
and evidence/acceptance in `mcp/docs/QUALITY_BENCHMARK.md`.

## 1. The first wrong boundary

Current `authoringRecipe/service.ts:planPair` calls
`collectRecipeKnowledge` **before** `planIncrementalRecipeRebuild`.
R1 creates conditional knowledge proposals. R2 projects authored
`ANCHOR`/symmetry dependencies and part identities, but neither stage
automatically revises a Recipe, independently attests reference images,
or derives finished native Bone hierarchy/curves. Do not portray this
source-only preflight as an autonomous Geometry modeller.

**Objective:** when an actual feature decision is unresolved, select the
minimum useful grounded modelling principle, propose a **bounded**
representation/structure option **before** the caller constructs a
candidate Recipe, and only then use existing compiler, Runtime and
Validation. A proposal must not auto-mutate, persist approval, convert
Texture to Geometry, or trust invented coordinates.

**Product result:** fewer *supported visual/structural errors and correction
rounds* on the same approved reference, while preserving readability,
Bedrock compatibility, stable edits and the current developer workflow.
Source count, candidate count and raw Cube reduction are not success proxies.

## 2. One end-to-end decision path (no second engine)

```text
current task + approved Reference Package + selected profile
  → source-grounded semantic feature / unknowns
  → existing featureDecision.ts (GEOMETRY | TEXTURE | OMIT | REVIEW_REQUIRED)
  → on-demand known-source knowledge selection + applicability checks
  → 0–3 EXPLAINED candidate construction strategies
  → caller chooses a supported candidate; unresolved remains unresolved
  → existing Recipe prototypes, patterns, ANCHOR, symmetry/ownership
  → existing compile / incremental plan / native transaction
  → existing affected-only structural, UV and visual checks
  → source/asset revision-matched outcome + learning note if justified
```

A candidate is **not** an executable Recipe unless its dimensions,
ownership, constraints and current user/reference evidence are known.
Preserve the normal direct `manage_cubes` fast path when there is no
decision-changing knowledge. No obligatory Recipe ceremony per Cube.
No additional Gateway tools or persistent queues.

## 3. Scoped source/consumer ownership

| Concern | Exact existing owner | Minimal implementation direction |
| --- | --- | --- |
| Reference fact + cross-view uncertainty | `mcp/lib/reference/crossViewEvidence.ts`; `mcp/gateway/control/contextProjection.ts` | Consume explicit claims and view IDs, never derive unknown depth from pixels |
| Source index, version and excerpt | `mcp/lib/semantic/knowledge.ts`; `authoringRecipe/knowledge.ts`, `knowledgeSelection.ts` and `knowledgeExcerpt.ts` | Add explicit applicability and counterexample checks **inside Recipe**, retain existing index; avoid external network and always-on corpus |
| Feature representation and ownership | `mcp/lib/authoringRecipe/featureDecision.ts` | Keep current 8 Geometry reasons and evidence states; no new policy router |
| Precompile candidate guidance | `mcp/lib/authoringRecipe/knowledgePlanning.ts` | Add **one small pure feature-level proposal helper** under this domain *only when a real caller is wired in the same change*; do not expand `planning.ts` or `service.ts` with another general planner |
| Cube/replication/relations | `mcp/lib/authoringRecipe/patterns.ts`, `constraints.ts`, `symmetry.ts`, `components.ts` | Translate supported candidate to existing `LINEAR/GRID/RADIAL` and `ANCHOR` / symmetry when expressible; do not add Sweep/Boolean DSL immediately |
| Native authoring and rollback | `mcp/server/runtime/recipes/authoring/service.ts` + existing transaction/Undo owners | Remain the sole mutation path; explicit target/project epoch required |
| Structural/contact/UV assessment | `mcp/lib/geometry/modelQuality.ts`, `surfaceEvidence.ts`, existing UV owners | Reuse current validators and risk-specific views; no second numerical quality scorer |
| Outcome and comparison | `mcp/docs/QUALITY_BENCHMARK.md`, existing Golden Task reporting | Same input/source/artifact provenance; quality before measured efficiency |

**No godfile rule:** `planning.ts`, `service.ts` and `surfaceEvidence.ts`
are already large; only modify their necessary call seams. Keep any new
feature-specific pure helper focused and test it through **one owning
scenario matrix**, not one test file per research paper.

## 4. Proposed read-only decision contract (illustrative, NOT shipped)

```ts
type GeometryProposal = {
  feature_id: string;               // exact semantic feature owner
  feature_route: "GEOMETRY" | "TEXTURE" | "OMIT" | "REVIEW_REQUIRED";
  reference_claim_ids: string[];   // caller-supplied; never invented
  knowledge: Array<{
    section_id: string;
    section_sha256: string;
    source_sha256: string;
    usage: "ADVISORY_ONLY";
  }>;
  options: Array<{                // 0–3, deterministic and explainable
    strategy: string;              // descriptive, NOT a new compiler enum
    contribution: string[];        // existing Geometry reasons
    apply_when: string[];
    reject_when: string[];
    missing_evidence: string[];
    existing_recipe_operations: string[];
    visual_or_native_proof_needed: string[];
  }>;
  verdict: "PROPOSAL_ONLY" | "MORE_REFERENCE_EVIDENCE_REQUIRED";
  mutation_authorized: false;
  visual_verdict: "NOT_EVALUATED";
};
```

This object is **transient**; do not add it to persisted schema-1 Recipe,
Workspace, Control, public MCP schema or a parallel registry. Never emit
numeric coordinates, confidence probabilities, bone names or Cube counts
unless the appropriate source/current authored state establishes them.
A supported geometry route does not prove the selected strategy is correct.

For a missing source, incompatible version, stale binding or an ambiguous
candidate: return a bounded explanation of what evidence is missing,
without downgrading unrelated supported features. This is not permission
to turn every missing semantic label into a permanent failure.

## 5. Implementation slices and acceptance

### R0 — Source adoption and discriminating cases (this plan)

- Record selected source, exact source identity when available, license
  and what we can **transfer**; reject code copying or training rights
  by implication. Reuse G1 eight positive/negative decision probes.
- Produce one source-grounded `APPLY / REJECT / REQUIRED_EVIDENCE`
  card **only when** it adds a decision not already in the canonical
  Geometry Standard.
- Acceptance: no duplicated policy, clear license boundary, owner
  and counterexample. No runtime performance claim.

### R1 — Knowledge-informed *precompile* proposals (P0)

**Source state:** `mcp/lib/authoringRecipe/geometryProposal.ts` provides
bounded, provenance-bound conditional strategies. `knowledgePlanning.ts`
and the existing `service.ts:planPair` consume them before compiling a
candidate Recipe. This remains advice, not an approved/applicable shape
or automatic native operation. Executable Bun/typecheck/build/native
and visual proof: NOT EXECUTED.

- Keep `featureDecision.ts` as the only representation route owner.
  Build a small pure proposal selector using the current Recipe knowledge
  index, current semantic feature facts and source/revision compatibility.
- Rank only candidates whose **applicability conditions are observed**.
  An overlapping word like "wing" or "curve" does not prove anatomy,
  representation or pivot. Keep max 3 viable explanations; if there
  is no clear distinction, abstain and identify the missing view/claim.
- Connect its output to the existing authoring decision caller **before**
  a Recipe draft is compiled. Keep legacy `plan/planStored` behavior
  unchanged unless the caller explicitly opts into the preflight.
- Acceptance: same supported G-P01..08 cases plus negative/ambiguous/
  stale/unsupported-version probes; no stale context or unreferenced
  claim can become a source-derived geometry placement.
  Golden source tests must actually run before claiming executable PASS.

### R2 — Structure-first construction alternatives (P0)

**Current source:** `mcp/lib/authoringRecipe/geometryAssembly.ts`
reuses the existing pattern expander and declarative Recipe `ANCHOR` /
`SYMMETRY` relationships to map exact instance IDs to semantic feature
owners and surface bounded, source-only attachment/symmetry review before
compilation. `geometryProposal.ts` attaches this as
`geometry_proposals[].assembly` without another workflow or persistent
graph. The report never equates positional `ANCHOR` to native Bone
parenting, treats Group labels as unverified, flags identity exceptions,
and preserves distinct UV/texture/rig mirror policies.
**R2 source wired; Bun/typecheck/build/native/visual NOT EXECUTED.**
New topology/constraints are **not** inferred or auto-created.

- Apply ShapeAssembly/StructureNet **ideas**, not their implementations:
  semantic part graph, parent/contact relation, explicit symmetry,
  variation boundaries and smallest necessary joint topology.
- Generate proposed attachments/transform ownership first. Only translate
  an accepted, expressible relation to existing Recipe ANCHOR/symmetry/
  pattern operations. Unsupported cross-view geometry stays an explained
  alternative, not fabricated Cubes.
- Test rigid prop, articulated mechanical joint, humanoid limb and
  deliberately asymmetric fixture. Preserve known native UUID ownership,
  UV/rig constraints, and non-Recipe direct operations. No auto-delete.

### R3 — Curved/organic construction alternatives (P1)

**Source state:** `mcp/lib/authoringRecipe/geometryCurves.ts` accepts
explicit transient, reference-handle-linked control samples (centerline
and positive rectangular cross-section). It derives directional change,
cross-section differences, span lengths, explicit joint boundaries and
conditional single-rotated vs segmented-Cuboid alternatives. The existing
Recipe `plan/planStored` caller accepts optional `curve_observations`
and returns the result under `geometry_proposals[].curve_review`; no
default caller, public schema or regular modelling operation changes.
Positions are supplied by the caller and **not** independently inferred
or verified from images; no native Cuboids or hierarchy are produced.
Four or more intervals require complexity review, not a style quota.
R3 regression source authored; Bun/build/native/visual NOT EXECUTED.

- Borrow Sweep's **centerline + varying cross section** concept:
  identify confirmed orientation changes and significant volume changes,
  propose minimum necessary semantic segments and attachment relations.
- Prototype only **source-only** bounded Cuboid alternatives via existing
  Recipe patterns/primitive operations. A free-form Sweep mesh is **not**
  representable in current Recipe v1; no claim of automatic curved mesh
  output or silent new compiler pattern kinds.
- Compare rotated-single-Cube, supported segmented cohort and
  alpha/Texture option when valid. Use front/side/3/4 evidence and neutral/
  extreme pose where relevant. Reject micro-segmentation without distinct
  silhouette/volume/motion benefit.

### R3a — Opt-in planar Curve candidate compilation (2026-11-01; SOURCE ONLY)

The first executable-schema geometry slice connects caller-declared planar
Curve samples to existing Recipe v1 and its existing plan/apply lifecycle:

- authoringRecipe/geometryCurveConstruction.ts translates validated centerline
  samples and rectangular sections to a single Cuboid or a stepped, tapered
  cohort. Each segment uses one native Cube prototype, at most one rotation
  axis (up to 45 degrees), an explicit center pivot, stable sample-pair IDs,
  and the existing LINEAR(count=1) pattern form.
- createAuthoringRecipeService.planCurveConstruction and
  planCurveConstructionStored pass the produced next Recipe through the
  canonical incremental plan registry. A separate existing apply operation
  remains the ONLY native mutation/Undo path; no second engine or MCP route.
- Explicit replacement protects hand-authored feature patterns, unrelated
  geometry, declared Anchor/Symmetry relations, foreign ownership and
  duplicate identities. Unknown claims, nonplanar/3-axis rotations,
  backtracking and Box UV subunit candidates fail before any mutation.
- Articulation requirements remain a rig review, not invented Bones.
  Geometry/source IDs do not attest image content or visual fidelity.

R3a is compiled *source* construction, NOT a deployed AI-facing advanced
tool or a proven Blockbench operation. Bun/typecheck/build, native Undo,
save/reopen, Bedrock codec/export and reference-matched appearance remain
NOT EXECUTED. Next integration is an AI-facing capability on the existing
Runtime/Gateway surface after source and native preflight proof.
### R3b — AI-first multi-feature Geometry composition (2026-11-01; CODE ONLY)

`authoringRecipe/geometryComposition.ts` compiles multiple declared
feature shapes into the **existing** Recipe v1 without creating a competing
shape engine, plugin, UI, asset store or new public Gateway route. It reuses
R3a Curve construction and the original Recipe compiler/plan/Undo owner.

Available source-level shape intents:
- CUBOID: finite 3D bounds, explicit or center pivot, one-axis rotation.
- FRAME: four non-overlapping border members around a real rectangular
  opening, with a chosen normal axis.
- REPEAT: bounded LINEAR, GRID or RADIAL instances via the existing pattern
  expander; radial centers account for Cuboid half-extents.
- CURVE: source-linked planar centerline, stepped section changes and
  deterministic sample-pair IDs via existing R3a.

The builder rejects invalid references/IDs, unsupported rotations,
out-of-scope feature changes, hand-authored cohorts, linked
Anchor/Symmetry revisions, subunit Box UV spans and identical overlapping
placements. Explicit generated-feature replacement retains unrelated
prototypes and pattern ownership. Opt-in
`createAuthoringRecipeService.planAdvancedGeometry[Stored]` consumes the
candidate through existing `planPair` and its incremental Recipe lifecycle.
Source handles DO NOT attest image content. Rig and artistic fidelity
remain separate validation requirements.

**User decision for this development pass:** code-first; do not run,
author, or modify tests yet. No CI, generator, installed plugin, Native Undo,
save/reopen, visual/Bedrock validation or release was executed. The public
`construct_geometry` registration is deferred until canonical generated
outputs and Runtime contracts can be delivered coherently. This code is
not yet an AI-invokable Blockbench capability.
### R3c — Internal Blockbench native creation adapter (2026-11-01; CODE ONLY)

`server/runtime/recipes/authoring/advancedConstruction.ts` provides
internal `previewAdvancedGeometryNative` and `createAdvancedGeometryNative`
entrypoints. The existing Blockbench Authoring Recipe service exports
these functions without a new public tool, listener, engine or UI.

- Both demand the exact current Project UUID, Bedrock Entity format, and
  an existing parent Group UUID. Unknown/ambiguous parent and in-progress
  native Undo fail before mutation.
- The same pure composition produces a bounded Authoring Recipe (maximum
  64 Cube instances per create). Native creation now invokes the existing
  `applyAuthoringRecipeIncrementalAtomic` and its Blockbench adapter with
  an exact parent Group UUID, preserving stable Recipe instance identity,
  Cube/Box UV preflight and the one native Undo owner.
- Source names are feature-scoped, and existing names under the target
  Group block uncertain create replay. No direct-edit or cross-session
  Recipe persistence is fabricated by this create-only adapter.
- Receipts preserve source-instance correspondence but make no claim that
  the reference was inspected, or that Bedrock export/visual fidelity PASS.

**User instruction:** coding only; no tests, Bun, TS/build, CI, native
Blockbench or release verification. The public AI `construct_geometry`
route and generated schema/docs remain intentionally unregistered.
### R3d — Internal AI plan/apply contract (2026-11-01; CODE ONLY)

`authoringRecipe/geometrySchema.ts` defines strict, import-safe feature
intents and the `plan`/`apply` discriminated input contract. The plugin's
existing Recipe service composes one internal `constructGeometry`
dispatcher using `advancedConstruction.ts` without new public tools.

Native preview now returns an exact plan SHA-256 and scene revision based
on Project/format, target Group, relevant Project UV settings, the bounded
native Group/Cube/face-UV inventory and current Undo index. Apply
re-evaluates source, rejects stale/different plan content, enforces the
existing AUTHORING Stage and enabled `manage_cubes`, rejects duplicate
names and delegates exactly one batch to its canonical native executor.
Runtime output distinguishes reported application from an uncertain
native receipt; visual/Bedrock export remains explicitly unverified.

**Deliberate restriction:** this is create-only. Project Recipe custom
property persistence is NOT currently part of the native Undo snapshot
contract, so metadata must not be updated out of band. Parametric edit
and safe cross-session Recipe persistence are a separate code slice.

Per explicit user instruction no test files, generators, Bun/CI, build,
Blockbench execution, export or visual acceptance were performed.
Public `construct_geometry` registration/docs must remain atomic with
canonical generator-owned API output. Do not hand-edit derived docs.
### R3e — Same-native-Undo Recipe source persistence (2026-11-01; CODE ONLY)

The existing Recipe transaction now passes exact previous/next Recipe
source revisions to its canonical Blockbench apply adapter. Before
opening Undo, the native adapter compares the Project's stored Recipe
against the previous source and pre-serializes the next document using
the existing bounded Recipe store. No second Recipe registry is added.

At commit, both before/after Project Recipe metadata are attached to the
same native `Undo.current_save` that owns the Cube changes. Its history
entry is the sole undo authority. Existing plugin ownership setup
registers Blockbench undo/redo listeners to reconcile that metadata
only for exact Project identity and expected source bytes; unload
removes listeners. Cancel/revert also protect the current source.

Native geometry changing without an available metadata listener, a
missing/stale previous Recipe, or an unsupported metadata-only change
fails closed rather than silently desynchronizing authoring state.
Older pure adapters may continue without this optional native hook.

**Proof ceiling:** code authored only. No Bun, TS build, tests,
live Blockbench Undo/Redo, save/reopen or visual/export proof was run.
This is not permission to publish the new `construct_geometry`
capability without canonical generated API output.
### R3f — Recipe-owned first creation under exact Group (2026-11-01; CODE ONLY)

The internal create adapter no longer applies newly generated Cuboids
through an untracked direct Cube call. It derives one stable Recipe ID
from exact Project UUID, parent Group UUID and semantic feature IDs,
refuses a conflicting saved Recipe, and uses the existing Recipe compiler
and `applyAuthoringRecipeIncrementalAtomic` for source-owned creation.
New Cuboids receive the exact Recipe instance ownership metadata and
are inserted under the already-verified native parent Group UUID.
Recipe-store preflight/commit is handled by R3e's canonical
same-Undo native metadata bridge.

The bounded scene and plan fingerprints remain mandatory. Future
revisions use the existing stored-Recipe and affected-only planning;
reusing the create operation for an existing Recipe refuses instead of
silently overwriting any authored data. No separate project store or
history is introduced, and no tests/native/visual evidence is claimed.
### R3g — Stored-Recipe feature revision and `.bbmodel` persistence (2026-11-01; CODE ONLY)

Advanced Geometry internal plan/apply now accepts a `mode` of `create` or
`revise`. In revision mode, the AI must provide the **exact Recipe ID**
returned by the original creation. Only existing, generated feature
identities are editable. The source-aware composer replaces those
feature patterns while preserving unrelated Recipe structure, stable
sample-pair instance IDs and exact parent Group ownership.

Planning calculates the existing incremental rebuild delta and refuses
no-op or over-budget revisions. Native apply re-checks the full scene
revision and recipe store, protects the original parent Group and
prevents modification/removal of already texture-mapped Cube faces
without a dedicated UV remap plan. Existing UUIDs survive where their
Recipe instance IDs remain unchanged; newly required Cuboids use the
same canonical native transaction and exact Group owner. This is
**not** unrestricted autonomous post-texture geometry editing.

Upstream Blockbench v5.2.2 source inspection identified a persistence
defect: the `bbmodel` codec skips ModelProject properties registered
with `export:false`. The existing namespaced Project Recipe-store
property is now registered with `export:true` so it can be serialized
into editable `.bbmodel` sources. Native Bedrock geometry export uses
its own target format; this change is to Blockbench project data, not
an authorization to emit arbitrary Recipe metadata as Minecraft geo.
Existing Cube Recipe ownership properties remain unchanged because
Cube getSaveCopy() copies properties independently of that Project gate.

**Proof ceiling:** upstream source semantics and repository contracts
inspected; no build, tests, native save/reopen, Bedrock export or
reference visual acceptance were executed, as the user requested.
### R3h — Native-Cuboid negative space and voxel arch (2026-11-01; CODE ONLY)

Two additional shape intents are implemented in the strict Geometry
input schema and existing Authoring Recipe compiler:

- `hollow_box`: six possible opening directions, one absent outer face,
  five nonintersecting Cuboid wall panels and a bounded inner cavity.
  Validated wall and cavity spans retain meaningful 3D negative space.
- `arch`: XY/ZY opening with +Y vertical, explicit crown and curved
  rise, and one voxel-aligned Cuboid per bounded odd horizontal column.
  A conservative nearest-crown endpoint sampling rule prevents a Cube
  from intruding into its declared arched opening. Axis-aligned geometry
  avoids unsupported multi-axis Cube rotations and poly_mesh exports.

These pure computations now live in the focused
`authoringRecipe/geometryShapeBuilders.ts`; the existing
`geometryComposition.ts` retains identity, feature routing and
Recipe source ownership only. Both new shapes reuse the existing
`buildAdvancedGeometryRecipeCandidate` → Recipe compiler → plan/apply
native transaction. They are not a parallel modeling or persistence
engine, and do not add a new public API tool. No tests or live QA
were run per user instruction; image resemblance/export are unverified.
### R3i — Voxel Cylinder / Tube (2026-11-01; CODE ONLY)

The source-owned `voxel_cylinder` shape builds a bounded circular
voxel cross-section (model axes X/Y/Z; integer radius 2–16,
optional inner radius) and extrudes it along an explicit axial length.
Consecutive occupied cells in the same row form one Cuboid run; every
run stays disjoint in voxel volume and maintains stable pattern IDs.

Before construction, the pure helper checks 4-neighbour connectivity
and, for tubes, that the interior void is enclosed rather than linked
to the outer boundary. Invalid thin, disconnected annuli are rejected
instead of producing floating corners. No `poly_mesh`, mesh converter,
second Recipe engine, persistent queue or new Gateway tool is added.

This augments the existing AI source contract and owns no separate
mutation mechanism. Revision and native authoring stay in the canonical
Recipe compiler/transaction. Visual smoothness, target-reference
correspondence and Bedrock export remain UNVERIFIED. Per user decision,
no tests, typecheck, Bun/CI or native QA were executed.
### R3j — Durable parameter source & change impact (2026-11-01; CODE ONLY)

To make AI-driven future revisions reconstructable after `.bbmodel`
save/reopen, existing `AuthoringRecipe` v1 now has optional
`advanced_geometry_source` (bounded actual shape parameters). This is
part of the canonical Project Recipe store and native Undo history,
not another saved data stream, model manager, or new Runtime.

Creation stores the feature inputs without transient replacement
permission. Revision updates only requested features and preserves
unrelated parameters, Cube UUIDs and Recipe ownership. The store
validates exact schema, IDs, feature/pattern associations and count.
Read-only inspection recomposes the stored source with the existing
compiler and exposes feature parameters only if their geometry and
declared feature metadata match the saved Recipe. Unavailable legacy
or conflicting sources are reported explicitly, not guessed.

AI preview/apply now return bounded counts of created/changed/removed/
preserved Cube instances and the existing semantic UV/Texture/Animation
invalidation scopes. These summaries are source-plan diagnostics only;
they neither authorize textured replacements nor prove visual quality.

No new public `construct_geometry` route is registered: canonical
generated API docs require the original Bun generator and must not be
hand-authored. Per user instruction, no tests, builds, CI, native
Blockbench, save/reopen or Bedrock export verification were run.
### R4 — Quality-preserving correction and optimization (P1)

**Source state:** `mcp/lib/authoringRecipe/geometryFidelity.ts` reuses
existing `geometry/surfaceEvidence.ts` analyzers for selected
current Recipe-owned native Cubes after the canonical authored-state
read/identity check. Exact same-parent data is required; missing native
parent states, unsupported transforms or over-budget scopes are partial,
not an opportunity to guess. The existing opt-in
`inspectStoredGeometryCoincidence` includes `geometry_fidelity_review`
for the exact selected feature, with native UUIDs, source fingerprint,
bounded diagnostic candidates and required visual/UV/rig/export checks.
Cross-feature and declared ANCHOR/SYMMETRY dependencies are retained.
This does not estimate safe Cube savings, authorize deletion, generate
a corrected Recipe, or score whole-model quality. The canonical
`orchestration/correctionLoop.ts` already blocks same-cause repeats
without fresh evidence; do not duplicate it. Source/regression authored;
Bun/build/native/visual NOT EXECUTED.

- Reuse existing bounds, oriented contact, surface integrity and
  difference-first correction. Propose merge/remove only with
  explicit reference+material+UV+motion+visibility invariants.
- Track a **vector** of defects (silhouette, proportion, negative space,
  contact, hierarchy/pivot, surface integrity, export); do **not**
  compute a misleading single quality score or maximize saved Cubes.
- A previous attempted correction that failed twice for the same cause
  without new evidence should block that direction; do not invent new
  unrelated operations to pass a validator.

### R5 — Matched live benchmark before promotion (P1)

**R5 source-only preparation:** the existing
`scripts/reporting/compare-golden-sessions.ts` owns accepted Golden
comparisons. `scripts/reporting/compare-geometry-knowledge.ts` applies
a stricter benchmark-only paired filter with exact task/Reference/seed/
Control/source/build/model/telemetry/environment/protocol identity,
separate benchmark session IDs and captured baseline/candidate guidance
exposure. The authored Project UUID can remain the same when the seed
is identical; both sessions must independently revalidate starting bytes. The candidate G1 section must match checked-in source/section
SHA-256. This is NOT a new outcome score, model training pipeline,
Runtime mode or auto-approval path. Reports still declare
`NOT_CAUSALLY_ATTESTED`; actual capture bytes and human approval must
be independently reviewed in LIVE_BLOCKBENCH before any quality/cost
claim is attributed to Geometry Knowledge. Tests authored, not executed.

- Reuse existing Golden Task fixtures/runner/comparison, initially
  `golden-existing-model-correction` followed by one articulated/
  one organic case only when matching approved references exist.
- Both arms use same reference and immutable starting `.bbmodel`,
  equivalent available tools, art requirements and acceptance criteria,
  with distinct actual build/source identity recorded. Candidate differs
  only in curated guidance availability; no leaked warm-start state.
- Acceptance requires no critical visual/structural regression.
  Measure correction rounds, repeated-cause failures, capture/tool
  calls, time and actual usage **only after** matching accepted quality.
  Without `LIVE_BLOCKBENCH` and human/reference review, mark
  `UNVERIFIED`; do not claim the change improves modelling.

## 6. Anti-regression and security matrix

| Case | Required behavior |
| --- | --- |
| No feature_intents / old Recipe | Existing compiled placement and flow unchanged |
| Texture-only label, with no 3D reason | Never auto-create a Cube |
| Geometry feature lacking actual view/claim | Provisional options only; no numeric authoritative placement |
| Conflicting front/side or missing depth | Only independent safe work proceeds; no guessed depth |
| Stale source, license or incompatible Bedrock version | Withhold affected external candidate, mark why |
| Multiple plausible strategies or weak word match | Abstain or show differences, no automatic first-match |
| Symmetric appearance but asymmetric equipment | Preserve intentional asymmetry |
| Small Box UV vs valid plane-like Cube | Distinguish material technical cases, no blanket 3D-size rule |
| Native source/project/Recipe changes during plan | Existing snapshot/identity and transaction protection remains |
| User reference contradicts external paper or Vanilla style | User-approved reference wins; retain exception |
| High-cost AI/mesh generator or arbitrary external code | Not loaded; no arbitrary eval, fs import or network on authoring hot path |
| Rejected/failed alternative | Preserve reason as bounded case evidence only after review; do not auto-train |

Tests should assert observable behavior, conservation of explicit
source identities and **negative applicability**, not exact wording
or model count. Tests authored but not executed are NOT proof.

## 7. Maintenance and context-cost controls

- Preserve exactly **one** Recipe owner, one Markdown knowledge index,
  existing four Gateway tools, existing Control stages, existing
  Validation/approval owner, and existing store/Undo.
- Source papers/catalogs are **documentation-only**: never bundle the
  full research list into the Runtime Markdown or hot-path prompts.
  Only promoted, source-bound, small decision cards may enter the
  selected on-demand knowledge corpus.
- Feature-level planning, not a per-Cube form or audit. Reuse
  `knownContextIds`/current state when valid. Add a new helper only
  with its actual in-use caller and matching regressions; no speculative
  routers, ML abstraction layers, caches or embeddings databases.
- Each live study begins with a specific user-artifact problem and ends
  after the narrow owner, affected tests and acceptance are addressed.
  New observations become evidence references; prior failures/positives
  do not override a new user's reference.
- The extension from **Geometry → Texture → Animation** remains
  staged. No Texture/PBR or animation keyframe engine should be
  created as a consequence of this research.

**Current proof ceiling:** this file specifies future work only.
No R1–R5 behavior or test/native/visual proof is claimed. Continue
through ChatGPT and authenticated GitHub source work; never require
the user's own PC, local checkout, Blockbench installation or Codex
as a prerequisite for independently valid source changes.
