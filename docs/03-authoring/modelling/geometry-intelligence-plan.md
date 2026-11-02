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
### R3k — Parametric construction templates (2026-11-01, CODE ONLY)

Six source-owned templates reuse the Advanced Geometry schema, Recipe v1
compiler, incremental plan/apply, Group ownership and native Undo:

- staircase: solid stepped ±X/±Z ascents
- pitched_roof: symmetric SOLID or connected SHELL gable roofs
- beveled_box: actual XZ corner cuts extruded along Y
- voxel_ellipsoid: oval/sphere or upper-Y dome/hemisphere
- voxel_cone: solid cone or frustum along X/Y/Z
- voxel_torus: doughnut/wheel with central negative space

geometryPresetBuilders.ts owns pure mathematics. Bounded greedy voxel
partition merges cells into disjoint Cuboids, checks face connectivity,
and rejects templates exceeding the 64-Cube native-batch ceiling.
Existing Recipe ownership and stored high-level parameters remain
the only source for feature-scoped revision. No separate plugin, engine,
database or generated API output is introduced. This is construction,
not reference-matched visual quality or animation/UV proof.

Public construct_geometry registration stays unregistered pending canonical
Bun generator output. No tests, build, CI, installed Blockbench QA,
save/reopen, or Bedrock export were executed by user decision.

### R3l — Geometry Construction Language v1 + reusable math solvers (2026-11-01; SOURCE ONLY)

Mathematically grounded construction is now available as one opt-in
`advancedGeometryFeatureSchema.kind="program"` feature, with an exact
`program.version=1` semantic contract. Four strict, bounded part methods
are supported: BOX, EXTRUDE (simple 2D profile, optional verified raster
holes), SWEEP (linear or centripetal Catmull–Rom path, adaptive chord
sampling, changing circular radius), and REVOLVE (axial radial-profile
stations with optional through-hole). All source parameters are stored
in the existing `advanced_geometry_source` Recipe field. They are
declared geometry, NOT independently authenticated image measurements.

`geometryMathLanguage.ts` owns the Zod contract. Math-only modules
`geometryMathProfile.ts`, `geometryMathSweep.ts`,
`geometryMathRevolve.ts` and `geometryMathVoxel.ts` compute bounded
native-Cuboid candidates with deterministic one-unit voxelization,
face-connected occupancy, greedy 3D rectangular partition and <=64 Cuboids
per *whole construction program*. Polygon self-intersection, touching/
leaking/nonrepresented profile holes, path degeneracy, sampling budgets,
invalid radial stations and disconnected masses fail before native Undo.
No arbitrary code execution, mesh, auto-approving reference matcher,
unspecified rounding or algorithmic fallbacks are allowed.

`geometryMathProgram.ts` composes the exact part candidates and reuses
the EXISTING `solveRecipeConstraints` ANCHOR solver as a temporary semantic
part-level bounding-box dependency graph. It preserves explicit IDs,
rejects cycles, missing targets and conflicting per-axis claims, and
compiles to the original Recipe v1 prototypes/patterns. Local attachment
is positional only; it does NOT fabricate Blockbench Bones or rig pivots.
No second state owner, registration surface, native mutation engine or
additional MCP tool was created.

V1 math/partition semantics are intentionally frozen. Existing R3a–R3k
shape algorithms and saved Recipe output are untouched; any future math
behavior change needs an explicit versioned migration and equivalence
review rather than silent changes to source-owned Cube identity. Source
inspect/revise and stale scene/plan guards remain in original owners.
The public `construct_geometry` capability remains unregistered until
the canonical Bun-generated API contract can be updated atomically.
Tests/CI/build, native save/reopen/Undo and reference/Bedrock visual
verification were NOT executed.

### R3m — Mathematics hardening before executable QA (2026-11-02; SOURCE ONLY)

Audit found a real variable-radius SWEEP error: comparing the distance
to the nearest point on a centerline against the radius *at that nearest
point* is not the union of variable-radius spheres. E.g. the point
`(0,2,0)` relative to a segment with centerline `(0,0,0)`→`(2,0,0)`
and radii `1→3` lies inside the second sphere but is discarded by the
old nearest-point method. The new v2 method minimizes the quadratic
distance-minus-radius-squared over the complete segment.

A cubic spline's midpoint/quarter-sample deviations are not rigorous
worst-case bounds. V2 recovers four cubic Bézier controls from the
centripetal Catmull–Rom segment and bounds the entire curve's distance
to its chord with control-point-to-segment distances. Bound exhaustion
fails closed; the result remains a bounded piecewise-Cube approximation.

Profile hollows previously used four-neighbour void connectivity, which
can overlook diagonal corner leakage. V2 pairs four-connected occupied
profile cells with eight-connected background and requires holes to stay
distinct, enclosed and represented. Native 3D voxel partition now checks
exact occupied-cell conservation as a structural invariant, not a
reference or visual-quality score.

**Recipe compatibility:** `geometryMathProgramSchema` now has an exact,
mandatory `version: 1 | 2`. V1 compiler semantics are preserved for
existing persisted `advanced_geometry_source` values; new, corrected
mathematics are opt-in as v2. No in-place migration, default-version
substitution, second Recipe compiler, GPU/mesh source, additional Gateway
route, or new native mutation path is introduced.

**Future executable proof matrix** (NOT EXECUTED here): v1 byte/placement
equivalence; v2 radius-endpoint counterexample; symmetric linear path;
high-curvature/S-cubic error tolerance; diagonal leak and multi-hole
preservation; deterministic voxel conservation; source/Recipe round-trip;
ANCHOR conflict/cycle; native UV/Undo/save/reopen and Bedrock export.
Do not claim that these pending checks or a source-only audit imply
runtime/native or visual acceptance.

### R3n — Radial topology, exact coverage and reproducibility (2026-11-02; CODE ONLY)

Further audit located three related blind spots in R3m:

1. REVOLVE only checked entire 3D material connectivity. A rasterized
   annulus can have disconnected 2D wall sections despite being linked
   to a neighbouring 3D layer, or leak through diagonally connected
   background. For an explicit `program.version=3`, each non-solid
   axial section now checks four-connected material and an eight-connected
   background, rejecting disconnected rings, side leaks and extra
   interior cavities. Intentionally solid axial caps remain allowed.
2. A volume-count equality test cannot by itself prove the correct cells
   were covered. The existing bounded greedy voxel partition now
   verifies exact equivalence of input occupancy and consumed-cell
   bitmaps, without changing Cuboid geometry for valid shapes.
3. Runtime locale may reorder semantic part/ANCHOR names in a persisted
   Recipe. V3 uses source-ID codepoint order; v1/v2 keep their old
   `localeCompare` ordering for exact source reconstruction.

Keep v1/v2 numerical and source identities intact: do not retrofit
the REVOLVE preflight or new sort order into historical program versions.
The compiler still creates ordinary Recipe v1 Cuboids with the same
stale-plan, native Group ownership and Undo semantics; no new Gateway
tool, state store, shape-preset registry or runtime scripting.

**Pending proof, NOT EXECUTED:** v1/v2 placement equivalence, v3 solid
body and valid annular ring, disconnected thin ring, diagonal radial
leak, capped-vs-through cavities, voxel coverage equivalence, locale
ordering, conflicted ANCHOR, typed schema, Bun build, and real native
save/reopen/Undo/Bedrock export/visual checks. A rejected source candidate
is not proof of a successful native model. Public `construct_geometry`
registration remains generator-coupled and deferred.

### R3o — V3 source-intent fidelity and AI-targeted failure context (2026-11-02; CODE ONLY)

The version-3 REVOLVE mathematical source can request a nonzero inner
radius yet its entire opening disappears at one-unit raster resolution.
For example, a height-1 transition from `inner_radius=0` to `1`
samples a mid-layer radius of 0.5, which contains no voxel-center
samples even though the authored endpoint declares a cavity. The
existing v3 annular-section proof previously skipped these slices.
It now rejects the source with
`GEOMETRY_MATH_REVOLVE_HOLE_NOT_REPRESENTED` when no axial layer
realizes the requested hollow. This is not an automatic thickening,
adaptive downsampling or new through-hole default: source and native
topology must remain distinguishable.

The existing `geometryMathProgram.ts` now attaches bounded
`part`/`method` and individual Cuboid source identity to v3
construction errors while keeping canonical error codes as their prefix
and retaining the original error as the `cause`. This lets an AI
repair the selected semantic part rather than rewriting a Recipe from
an opaque multi-part error. For reproducibility, v1/v2 output and
original error strings are left unchanged; v3 placement algorithms
are also unchanged for previously valid source.

No new parser, engine, version, database, MCP Gateway tool or native
mutation path. Code is SOURCE ONLY: no Bun, typecheck, build, tests, CI,
installed Blockbench, save/reopen/export or visual proof executed.
Pending executable proof: v1/v2 reconstruction equivalence, v3
disappearing cavity rejection, unaffected valid closed/annular profiles,
error context, and native Undo/export/visual acceptance.

### R3p — Versioned semantic instancing and canonical repetition (2026-11-02; SOURCE ONLY)

AI-first composition should reuse a verified semantic construction
without copying its polygon points, curve knots or per-Cuboid coordinates.
V4 extends the existing Geometry Construction Language with opt-in
`INSTANCE` parts. Each instance names `source_part_id` within the SAME
program, and owns a distinct `id` and `at`. Its geometry is copied by
value in local model coordinates; source world placement is not inherited.
An optional `reflect_axis` mirrors source-local Cube bounds about the
source bounding-box midplane. This is a geometry-only transform, not
Texture UV mirroring, a Bone/pivot, rigging or global scene symmetry.

The already-owned `geometryMathProgram.ts` resolves instance dependency
DAGs lazily by part ID, memoizes source-local geometry, and rejects unknown,
self-referential or cyclic part graphs. Exact codepoint ID ordering is
used in v4 just as in v3; v1/v2 legacy locale behaviour is retained.
Mathematical kernels and the canonical Recipe compiler remain unchanged.
The strict v4 schema is a union of v1–v3 native mathematical methods and
one `INSTANCE` source reference, not a new object-preset catalogue.

V4 instances may request a single signed linear array via `repeat`
(`axis`, `count` 2–16 including original, `spacing` ±1…±32).
The existing Recipe LINEAR pattern expander creates all copies; the
feature's 64-native-Cube budget counts the actual expanded instances.
The semantic part's solved bounding box includes the entire array
extent, including negative-axis repetition, so existing Recipe ANCHOR
alignment uses the correct target envelope. A repeated instance cannot
be re-instanced because nested arrays cannot be silently flattened.

Old Geometry Construction Language v1/v2/v3 continues to reject
`INSTANCE` and does NOT change generated Recipe IDs/placements, error
behaviour, math versions or stored source. Native Project Group, current
Recipe Store, incremental plan/apply and Undo remain canonical.
AI source handles are caller declarations rather than image attestation.
No build, typecheck, tests, CI, native QA or visual/export acceptance
were performed. Public `construct_geometry` registration still
requires the original Bun API generator, so no partial hand-authored
Runtime registration or generated artifacts are committed.

Future explicit source proof cases (not executed): out-of-order source
IDs, mirrored asymmetric profile, repeated ± spacing, anchor-to-array
bounds, nested ordinary instance chains, missing/cyclic references,
unreferencable repeated source, and 64-Cube expanded-budget overflow;
then native save/Undo/texture/export and exact v1–v3 compatibility.

### R3q — Profile-based LOFT and semantic CONNECT (2026-11-02; SOURCE ONLY)

The canonical Geometry Construction Language gained opt-in
`program.version=5` for two complementary construction classes
without a new manager, renderer, mutation engine, database or tool.

`LOFT` receives 2–12 explicit axis-aligned rectangular sections
with relative axial height, perpendicular centre and cross-section
dimensions. A pure module `geometryMathLoft.ts` interpolates
piecewise-linear profiles and uses existing connected voxel partition
to native Cuboids. Voxel resolution is exactly one model unit;
unrepresented axial layers, broken solids and limits fail before Undo.
This cannot provide a smooth mesh or infer unsupported reference depth.

`CONNECT` references two existing non-CONNECT semantic parts rather
than independently guessing world coordinates. The original Recipe
ANCHOR solver positions ordinary/INSTANCE/LOFT sources first. A new
pure `geometryMathConnect.ts` then computes explicit bbox anchors,
optional offsets and source-local native Cuboid contact; converts the
declared endpoints and up to four ordered fractional waypoints to the
existing `sweepMathVolume`; and requires actual generated
face-area/interior contact with both source cohorts. This guarantees
only a bounded structural relationship, never reference fidelity,
rig attachment, Texture UV mirroring or visual PASS.

CONNECT is intentionally excluded from the ordinary ANCHOR dependency
solver, CONNECT-to-CONNECT graph and INSTANCE source. Source pointers
to a repeated part account for actual signed LINEAR positions.
One total 64-native-Cuboid budget includes the derived connectors and
expanded repeated copies. Part IDs, feature ownership and existing
canonical Recipe source/Undo remain unchanged.

Old versions 1–4 do not accept LOFT/CONNECT, nor are their
algorithms, generated IDs or persistence silently migrated. The
existing public Gateway stays four tools and internal
`construct_geometry` remains UNREGISTERED pending atomically
generator-owned Bun API/docs, not manually authored snapshots.

Deferred acceptance, NOT EXECUTED under user CODE-FIRST policy:
v1–v4 saved-source identity, LOFT taper/offset and axial-loss cases;
BOX/LOFT/INSTANCE connector contact, empty bounding-box corner;
negative signed repeats, invalid endpoints/loops, Cuboid budget;
native Blockbench save/reopen/Undo, UV/export and visual reference.
NO build/typecheck/unit tests/CI/native execution occurred.

### R3r — Orthogonal part frames and exposed-face connector orientation (2026-11-02, CODE ONLY)

Source-only review identified that v5 LOFT uses inclusive boundaries:
a centred width-one section can occupy two voxel columns. Correcting
v5 in place would silently recompile persisted Cuboid cohorts, so the
strict new `program.version=6` is opt-in and its previous source
versions stay untouched.

One canonical pure helper `geometryMathOrthogonal.ts` applies 90-degree
right-handed X/Y/Z quarter turns through signed coordinate swaps about
the source-local part bounds centre. New `ORIENT` is an explicit
source-owning INSTANCE-like operation with optional pre-rotation
reflection, independent placement and existing Recipe LINEAR repeat.
It reuses the same dependency DAG, ANCHOR solver, stable source identities,
Cuboid validation, 64-native-instance budget and Recipe plan/apply/Undo.
No native Cube rotation angles or negative scale are introduced.

V6 LOFT uses half-open upper-boundary voxel-centre sampling. This
removes double inclusion at exact opposing boundaries while preserving
explicit unit-voxel approximation (not precise continuous-surface
construction or proof of proportional fidelity). V5 retains the old
inclusive-cell semantics and does not undergo implicit migration.

V6 CONNECT uses the same previous endpoint schema but narrows its
eligible semantics: exactly one MIN/MAX axis selects the outward
normal of a real source Cuboid face; a normal-direction offset is
rejected. Its first path tangent must depart outward and its final
tangent must approach the target against its outward normal.
Existing source-part solved positions, bounded SWEEP and positive-face/
volume contact preflights remain authoritative. This is not a new
automatic obstacle-aware path planner, Bone joint, UV transform or
visual/reference acceptance.

The new v6 program source stays in canonical
`advanced_geometry_source`; no extra MCP Gateway tool, state store,
workflow, generated API edit or plugin has been added. Registration
of the internal `construct_geometry` remains generator-coupled.
Code-only completion does not imply compile or native acceptance.

Unexecuted future proof cases: v1–v5 exact reconstruction; each
X/Y/Z quarter-turn, asymmetric reflected rotation, chained orientations,
ANCHOR and signed-repeat; v5/v6 thin LOFT tie-break; exposed-face
connector orientation, interior/corner rejection and waypoint tangents;
64-Cube and valid Bedrock UV, Undo and export checks.
No build/typecheck/tests/CI/native Blockbench/visual QA was run.

### R3s — Actual Cuboid face alignment via existing Recipe solver (2026-11-02; CODE ONLY)

The prior v6 `ANCHOR` feature aligns only semantic-part bounding-box
MIN/CENTER/MAX coordinates, not specific faces of asymmetric or hollow
parts. That is insufficient for reliably mounting a small panel, armor
plate or rotated bracket on a selected *real* source-Cube face.

The strict opt-in `program.version=7` introduces `face_anchors`
(max 12), each with a unique constraint ID, moving/fixed semantic
part ID, unique source-local Cube ID, selected outward face, optional
explicit repeated-copy index, and optional strictly tangential offset.
Faces must have opposite normals on the same model axis. All names
are validated against the existing part/constraint identities;
CONNECT is excluded because it is constructed after ordinary solving.

`geometryMathFaceAnchors.ts` owns pure, bounded source-only geometry
preflight: it resolves Cuboid/copy identity, computes actual face
centres, checks that the requested face is not obscured by another
Cube/copy of the same part, then emits ordinary Recipe `ANCHOR`
constraints using whole-part MIN anchors and mathematically derived
three-axis offsets. It reuses the existing single
`solveRecipeConstraints` dependency graph (including its duplicate,
cycle and per-axis conflict detection). After positional solution, the
same face planes must coincide with positive face AREA overlap on both
tangent axes. No made-up “nearest” face, partial edge contact, new
constraint engine, arbitrary scene rotation or hand-authored Cube
coordinate is allowed.

V7 retains v6 half-open LOFT raster, orthogonal ORIENT and
face-aware CONNECT, and uses their same existing mathematics and
native-Cuboid realizer. Source parameters and feature identity persist
in the sole `advanced_geometry_source` Recipe field; no object-preset
database, new Gateway capability, compiler/storage/Undo or plugin.

Boundary: structural exposed-face checks consider the selected semantic
part's own Cuboids/repetitions, not all other Project elements; source
cannot certify global collision clearance, material/UV, rig/pivot,
reference art fidelity or Bedrock export. No tests/build/typecheck/CI,
native Blockbench, save/reopen/export or visual QA were executed.

Pending *future* verification only: exact v1–v6 reconstruction;
BOX/LOFT/ORIENT local face alignment, negative-repeat index,
missing/ambiguous Cube IDs, buried faces, opposed-normal checks,
normal-offset rejection, conflicting and cyclic mixed anchors,
edge-only contact, native UV/Undo/save/Bedrock and visual acceptance.

### R3t — Explicit source-pair clearance and non-interpenetrating face mounts (2026-11-02; CODE ONLY)

Audit after R3s found an important blind spot: `FACE_ANCHOR` checked
that its two selected native Cuboid faces coincide with positive-area
contact, but did not exclude *other* Cuboids of those two semantic parts
from passing through each other. A plate could be correctly mounted
at the selected face while other source material intersects.

V8 introduces `geometryMathClearanceSchema` under one explicitly
versioned `kind:"program"` source, with up to 16 declared
`{id, part_a_id, part_b_id, minimum_gap?}` pairs. `minimum_gap = 0`
forbids strict 3D volume overlap but allows touching; `> 0` requires
the true shortest Euclidean distance between the source's expanded
axis-aligned Cuboid volumes. Both signed LINEAR copies and derived
CONNECT parts are included when explicitly selected. Relations
are checked after original `solveRecipeConstraints`, v8
`FACE_ANCHOR` verification and any CONNECT realization, never
by modifying the solver, dragging native Cubes or guessing from images.

The pure `geometryMathClearance.ts` reuses CONNECT's native Cube-copy
enumeration, computing pairwise AABB intersection/gap without voxel
sampling, global scene discovery or a secondary optimizer. Every v8
FACE_ANCHOR pair automatically rejects strictly positive volume overlap
of its complete two part cohorts. This preserves the stronger guarantee
“selected face contact *and* no other geometry penetrates” at the
declared pair level. Other scene objects/relations remain explicitly
out of scope. Intentional interpenetration should use a separately
declared construction method; older authored v7 Geometry is untouched.

The source schema enforces valid distinct part references, bounded
gaps, and globally unique relation IDs across existing ANCHOR,
FACE_ANCHOR and CLEARANCE lists. All resulting Cuboids remain
in the original Recipe source, 64 expanded-Cube plan, incremental
native parent/Undo and saved source-owner route. Original public
Gateway remains four tools; no separate database, shape preset,
generated API artifact or released plugin is introduced.

This is SOURCE ONLY. No build/typecheck/tests/CI, live Blockbench,
native Undo/save-reopen/Bedrock export or image/reference visual
acceptance executed. Required future proof includes v1–v7 output
equivalence, face mount with hidden whole-part penetration, touching
vs strict overlap, min-gap positive Euclidean distance, repeated
LINEAR copies, CONNECT source pairs, reversed relation order,
stable relation IDs, and unchanged surrounding scene objects.

### R3u — Typed dimension inheritance (2026-11-02, CODE ONLY)

Prior version-8 composition could solve relative positions, exposed
Cube-face contacts, collision clearances and repeated/oriented parts,
but all primitive BOX dimensions remained disconnected constants.
This forces an AI to rewrite many source sizes after one object's
proportion changes.

Strict opt-in `program.version=9` introduces at most 16 declarative
`dimension_links` in the existing math source contract. Each entry
identifies a single target BOX axis, existing non-CONNECT source
part/axis, positive rational multiplier (bounded integer numerator
and denominator), and optional signed integer delta. Exact source
extent is computed from the source-local constructed envelope, not
from screen pixels, unsupported reference inference, or an arbitrary
string expression. Every target-axis has exactly one source owner;
duplicate IDs with ANCHOR/FACE_ANCHOR/CLEARANCE are rejected.

The canonical `geometryMathProgram.ts` *already* owns memoized
semantic-part dependency resolution for INSTANCE and ORIENT. V9
routes dimension inheritance through that SAME resolution graph,
so chained dimensions, forward references and mixed cycles resolve
deterministically or reject with a bounded dependency error. The
existing `realizePart` native BOX builder receives the calculated
positive integer dimensions, without new native scaling, fractional
Cube geometry, rounding/clamping, a second solver or a global CAD
constraint engine.

Numerical contract:
`target_size_axis = source_bbox_extent_axis * numerator /
denominator + delta`. Accept only finite results within 1–32
representable model units and within a small float tolerance of
an actual integer (arithmetic-noise protection, not snap-to-grid).
Source extents include the full LINEAR repeat envelope, not the
sum of occupied material lengths across disjoint copies.
A target source BOX axis that has no link keeps its authored size.

V9 remains opt-in: the original math v1–v8 source/compiled paths,
legacy shape families, LOFT/CONNECT, ORIENT, signed repeats, positional
ANCHOR, FACE_ANCHOR and CLEARANCE are not rewritten. All later
placement and collision checks run on newly derived dimensions
through the SAME canonical Recipe v1 compiler, incremental mutation
and native Group/Undo owner. No new public Gateway tool, database,
generator artifact or plugin was introduced.

**Deferred executable proof, NOT EXECUTED**: v1–v8 exact source
reconstruction, Box-to-Box ratio chains and renamed part order,
dimension from LOFT or oriented/reflected instance envelope,
negative LINEAR repeat extent, cyclic dimension/INSTANCE graphs,
two links to same axis, unrepresentable fractions, overbudget native
BOX dimensions, resulting FACE_ANCHOR alignment, CLEARANCE contact,
saved Recipe/Undo, native UV/export and visual reference review.
Bun, typecheck/build/tests/CI/native Blockbench were NOT run.

### R3v — Bounded dimensional acceptance for proportional construction (2026-11-02; CODE ONLY)

The v9 `DIMENSION_LINK` can derive numerically valid BOX sizes from
other component envelopes but does not, by itself, guarantee declared
proportions or minimum/maximum component spans. Adding more shape
presets or a subjective "beauty score" would not solve that problem.

Strict opt-in `program.version=10` adds one small declarative
`dimension_constraints` list (maximum 16), with two pure relationship
kinds: `SPAN_BOUNDS` on a part's chosen X/Y/Z extent, and
`RATIO_BOUNDS` on a unitless ratio of two chosen semantic part extents.
The latter uses explicit bounded rational lower/upper constants
(0–32 numerator, 1–32 denominator), allowing strict equalities or
ranges without floating source inputs. Schema checks known part IDs,
valid and ascending bounds, and global relation ID uniqueness across
ANCHOR, FACE_ANCHOR, CLEARANCE, DIMENSION_LINK and the new assertions.

`geometryMathDimensionConstraints.ts` is a pure, bounded read-only
acceptance function called from the EXISTING `geometryMathProgram.ts`
after the prior dimension/INSTANCE resolver, Recipe ANCHOR solver,
FACE_ANCHOR geometry, and optional derived CONNECT/CLEARANCE. All
calculations use the same final source-local part AABBs, including
signed LINEAR envelope extents and generated connectors. Exact ratio
comparison uses finite cross products; no new graph, resizing solver,
optimizer, local runtime registry or persistence path is introduced.
A failing user-declared ratio or span aborts source construction rather
than guessing a correction. The native 64-Cuboid budget is unchanged.

v1–v9 Recipe output semantics are frozen, with v10 opt-in only.
AABB extents measure envelopes, NOT physical occupancy in repeat gaps.
These declared constraints are not reference-backed by themselves and
do NOT certify asset beauty, Minecraft scale, UV, animation, or export.
No new Gateway tool, editor mutation owner or generated API was added.

**Pending future proof (NOT EXECUTED):** v1–v9 exact source equivalence;
dimension-link-to-SPAN and chained RATIO acceptance; equal and inverted
rational bounds; missing parts and duplicate relation IDs; v10
CONNECT/INSTANCE/ORIENT and signed repeat scopes; precision at inclusive
limits, nonpositive source extents, 64-Cube budget, native Recipe
Undo/save/reopen and art-reference review. No Bun, typecheck, tests,
build, CI, Blockbench or visual/native QA was run.

### R3w — Model-unit/physical/player calibration and traced measurements (2026-11-02; CODE ONLY)

Canonical modelling `standard.md` states 16 native units per
Minecraft block. That does NOT establish a physical real-world
metres-per-block factor or the height of a particular player model.
Previously, v9 DIMENSION_LINK and v10 BOUNDS allowed excellent
source-local ratios but had no source contract for units,
calibration or measurement provenance.

V11 adds strict `scale_context` and optional `measured_dimensions`
and `scale_targets` to the EXISTING versioned high-level
`kind:"program"` schema. Physical calibration requires an explicit
`meters_per_block` and PLAYER_HEIGHTS requires an explicit
`player_height_blocks` declaration; no default real-world scale,
silent 1m/block, 1.8-block player or automatic scaling is introduced.

`MEASURED_DIMENSION` owns at most one axis of an existing BOX.
It converts a caller-declared value in MODEL_UNITS/BLOCKS/
METERS/CENTIMETERS/PLAYER_HEIGHTS to an exact integer native
BOX dimension from 1 to 32 model units. It shares the existing
semantic resolver with DIMENSION_LINK/INSTANCE, with an explicit
schema conflict when two derivation methods claim the same BOX
axis. Source cannot be rounded or clamped to invent a feasible
shape. Existing ANCHOR/FACE_ANCHOR/CONNECT/CLEARANCE follow the
derived geometry through ONE canonical Authoring Recipe pipeline.

`SCALE_TARGET` is an acceptance-only declared extent range, checked
on actual final semantic-part envelopes after normal construction and
before the native Cuboid factory. It never treats gaps of a signed
LINEAR repeated assembly as occupied material or uses centre
distance as a dimensional substitute.

All calibration and measurement entries carry explicit provenance:
`DECLARED_SPEC` is only a caller declaration; `REFERENCE_CLAIM`
must bind an exact source_ref in the enclosing Geometry feature's
`evidence_refs`, without fabricating image/file content or verified
measurement. Unbound sources abort before math construction.
Nothing may independently promote a source handle to external
reference certification, art review, player-scale PASS, native
UV/rig correctness or Bedrock export acceptance.

V1–v10 Recipe source and mathematical algorithms remain untouched.
No second parser, full CAD scale solver, automatic world rescaling,
tool/registry, persistent DB, extra plugin or non-generator API edit.
The original native Cube Group/Undo, incremental source matching and
64-native-instance budget remain authoritative.

Future **unexecuted** acceptance: v1–v10 source equivalence;
16 units/block; physical calibration required; centimetre/metre
conversion; declared player height; absent/unbound/duplicate provenance;
noninteger measured BOX spans, two axis owners; scale target checks
after DIMENSION_LINK/ORIENT/repeat/CONNECT; persistence, native
Undo/export/visual size versus approved reference. NO Bun, build,
typecheck, tests, CI or live Blockbench was run in this code-first task.

### R3x — Calibrated interval arithmetic without false reference certainty (2026-11-02; CODE ONLY)

V11 only accepted single nominal physical/player calibration values.
Such values are adequate when the design specification explicitly
fixes scale, but not when an image, drawing or estimated measurement
admits a range of plausible sizes. A source handle is also not proof
that external measurements were retrieved or checked.

V12 provides explicit `uncertainty_targets` and optional ranges
around the existing v11 nominal `meters_per_block` and
`player_height_blocks`. Calibration uncertainty MUST enclose its
nominal. Each 0–4096 unit target interval carries model-axis identity,
source unit, bounded explicit native-unit tolerance and caller-declared
or source-handle-linked evidence. Missing calibrations, duplicate
part/axis ownership, inverted intervals, and unbound source claims
fail before native Cuboids. If an uncertain calibration is used to
construct a measured BOX axis, a matching uncertain target must use
the same measurement unit, own that exact part/axis, and enclose
the nominal value. Otherwise an unrelated MODEL_UNITS target could
evade the physical calibration uncertainty.

The pure `geometryMathUncertainty.ts` performs monotone interval
conversion, not Monte Carlo sampling or a new geometry solver:
for physical meters, lower native bound is
`16 * measured_min / meters_per_block_max` and upper is
`16 * measured_max / meters_per_block_min`. For player-relative
values use `16 * player_height_min/max`, respectively.
Blocks and model units have exact native factors. Every derived
native interval is checked finite/nonnegative and compared against
the ACTUAL built semantic part's source-local axis envelope.

Result states are `ALL_DECLARED_VALUES_FIT` (every declared
candidate is within the explicit tolerance),
`SOME_DECLARED_VALUES_FIT` (only a nonempty intersection, so
review REQUIRED), and `NO_DECLARED_VALUES_FIT` (incompatible).
Only ALL passes. Critically, even ALL means SOURCE-CONTRACT-consistent,
not verified real-world measurement or visual/player-scale approval.
The read-only assessment may be reused by an AI for precise revision
advice, while plan/apply fails closed on SOME or NONE.

Old mathematical source v1–v11 and all preexisting shape methods,
native Cube IDs, v11 nominal measured dimension conversions,
original ANCHOR/FACE_ANCHOR/CLEARANCE constraints, single Recipe Store
and Undo remain unchanged; v12 is explicitly opt-in and does not
invent new material geometry. No new Gateway tool, database,
independent evaluator service or generated Runtime/API snapshot.

Future proof, NOT EXECUTED: v1–v11 saved-source equivalence;
minimum/maximum calibration propagation, cm/m and player-height
bounds, all/some/no interval classifications, tolerance boundaries,
misbound REFERENCE_CLAIM, uncertain measured BOX lacking matching
target, signed LINEAR envelope, CONNECT outputs, native save/reopen/
Undo, UV/export and reference scale review. No Bun/typecheck/build,
tests/CI, installed Blockbench or visual QA was performed.

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
