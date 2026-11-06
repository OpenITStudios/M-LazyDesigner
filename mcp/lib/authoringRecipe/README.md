# Authoring Recipe Domain

## Recipe-owned knowledge and context-aware selection

Recipe is the **single authoring decision owner**. Existing
`mcp/lib/semantic/knowledge.ts` remains only the reusable Markdown index
and bounded selector; it is **not** a competing authoring or approval engine.
Knowledge references, decisions, geometry compilation, and corrections stay
under `mcp/lib/authoringRecipe/`, in small modules:

- `knowledge.ts`: validated, feature-owned source revision links;
  explicit binding and source-snapshot freshness review.
- `knowledgeSelection.ts`: bounded, per-feature knowledge suggestions
  using the existing index. External snapshots require exact Bedrock/Blockbench
  compatibility; unproven sources cannot silently become guidance.
- `knowledgePlanning.ts`: `prepareKnowledgeAwareRecipe` composes the existing
  compiler with guidance and freshness in a small read-only entrypoint;
  the large legacy `planning.ts` retains its existing responsibilities.
- `compiler.ts`/`store.ts`: schema-1 Recipes accept optional
  `knowledge_links` and reject malformed/foreign/duplicate links.
  Existing Recipes and their compiled Cube placements are unchanged.

Sequence: index existing canonical knowledge → suggest relevant sections for
each feature → explicitly bind selected section IDs, section SHA-256, full source SHA-256
and optional external revision to the same Recipe → compile/plan → inspect
link freshness before trusting guidance.
The Recipe store already owns persistence; no second database or registry.
Changing knowledge marks the link `REVIEW_REQUIRED`, never silently rebinds
or edits native assets. Knowledge citations are **advice**, not reference-image
proof, visual approval, native runtime evidence, or an automatic Geometry
classification. Existing `feature_intents.evidence_refs`, Validation owners,
user approvals and Gateway's four-tool surface remain authoritative.
The existing `createAuthoringRecipeService.plan/planStored` consumes a
demand-driven knowledge index when a Recipe declares feature intents.
`recipe_knowledge` reports source availability, exact linked revision status,
and up to eight feature suggestions (two sections each). The registered
`inspect_element` / `inspect_elements(mode=detail)` path, when explicitly
called with `recipe_optimization_review=true`, returns guidance for the
exact selected Recipe-owned feature. Ordinary inspection and Geometry edits
do not read the index. The Runtime adapter `server/runtime/recipes/authoring/knowledgeRuntime.ts`
now combines the existing **bundled Bedrock workflow** with exactly eight
Geometry G1 candidate sections imported as raw text from the canonical
`docs/03-authoring/modelling/decision-cases.md`. Bun's `type: "text"`
import embeds this source at build time; the prompt manifest and its generator
remain unchanged. The casebook is indexed **only when Recipe planning or
opt-in native inspection requests knowledge**; no Runtime filesystem/network
fetch, parallel registry or new Gateway capability is involved.

`knowledgeExcerpt.ts` re-verifies the full source SHA-256 and exact
indexed section revision before returning a single bounded advisory excerpt
(up to 1,600 characters) for each selected feature. The matching case's
`Apply`, `Reject/defer` and `Proof required` statements become readable
rather than returning IDs only. Missing/altered pilot source fails closed;
stale Recipe bindings suppress suggestions and require review. A scoped
integration audit corrected G2 retrieval order: choose at most one
**uniquely matched G1 case using the feature title first**, then spend
the remaining per-feature slot/token budget on ordinary workflow sources.
An ambiguous, absent or over-budget case does not consume the generic
selector's budget; all other knowledge sources retain their existing
eligibility and ranking. Normal
inspection and Geometry mutation do not retrieve new knowledge, and a
source-hash match is **never** visual, native, reference or user approval.
The eight G1 cases are SOURCE-GROUNDED_CANDIDATE, not Golden assets or
an advanced model corpus. No new engine, external model, training loop,
public Gateway capability, or native mutation has been added.

### R1: evidence-bound precompile construction proposals (source only)

`geometryProposal.ts` is a small, pure Recipe helper. It converts exact
hash-verified G1 case sections into **conditional, read-only** Geometry
alternatives using the existing `featureDecision.ts` routing. A proposal
retains the full source and section revisions, application/exclusion criteria,
unverified applicability conditions, and source-authored Recipe guidance.
No option may invent coordinates, approve a model, generate Cubes or
trigger native Undo. An approved 3D feature with no authored Cube pattern
still triggers the existing compiler's `FEATURE_GEOMETRY_UNREALIZED`
guard; proposing a strategy never satisfies mandatory construction.
An unresolved feature can receive an explained
hypothesis with `MORE_REFERENCE_EVIDENCE_REQUIRED`; Texture/Omit features
generate **zero** Geometry construction options.

`reviewRecipeKnowledge` returns bounded `geometry_proposals` next to
existing `suggestions`. `prepareKnowledgeAwareRecipe` now evaluates
knowledge **before** compiling the candidate. The existing
`createAuthoringRecipeService.plan/planStored` caller likewise computes
the advisory preflight before `planIncrementalRecipeRebuild`, without
altering the caller-authored Recipe. Stale explicit links withhold options,
and legacy Recipes without feature intents skip the index.
The R1 source/regression contracts are authored, NOT EXECUTED with Bun,
TypeScript/build or native Blockbench. No measured 3D fidelity is claimed.

### R2: declared semantic assembly (source only)

`geometryAssembly.ts` now derives a bounded **feature → Recipe instance →
declared relation** review from the existing `expandRecipePattern`, `ANCHOR`
and `SYMMETRY` contracts. The R1 `geometry_proposals[].assembly` field
exposes exact source/target instance IDs, owning semantic feature IDs,
recorded axis or mirror/UV/texture/rig policies, and conditional reference
checks. It explicitly distinguishes **positional ANCHOR** from a Blockbench
Bone parent/pivot and treats `semantic_group` as a label, not a verified
native Group. Missing/foreign endpoints, duplicate instances, incompatible
symmetry stage, unverified feature evidence and oversize reviews remain
`SOURCE_IDENTITY_REVIEW_REQUIRED` for the affected feature. Relationships
are never invented or applied; the existing compiler/Undo retains sole
structural and mutation authority.

The review is read-only, only requested through existing opt-in Recipe
planning/inspection, and preserves direct authoring and legacy Recipes.
R2 tests are authored in the focused assembly test owner, but Bun/typecheck/
build/native/visual proof remain NOT EXECUTED.

### R3: explicitly sampled curved/organic construction alternatives (source only)

`geometryCurves.ts` reviews a **caller-supplied** centerline with up to
12 source-linked points per feature and positive rectangular cross-section
parameters. It measures declared spans, directional changes, taper and
explicit joint boundaries, then offers conditional review of one rotated
Cuboid versus a segmented cohort. The latter is considered only when the
declared path actually changes direction/section or has a required joint;
an almost-straight, constant-section path must not request unnecessary
micro-segments. Four or more sampled intervals trigger the existing
complexity-escalation review, **not** a fixed Cube quota.

The optional transient `curve_observations` reaches the existing
`knowledgePlanning.ts` through `plan/planStored` and is reported as
`geometry_proposals[].curve_review`. Each sample must name an exact
feature owner and existing declared reference handle; matching string
handles is **not** image-content attestation. Bad geometry, unknown owners,
duplicate IDs, excessive inputs and degenerate spans fail closed.
No new persisted Recipe schema, compiler pattern, free-form Sweep mesh,
native Cube placements, inferred Euler rotations, Bone parents or public
Gateway tool. A normal Recipe omitting these observations is unchanged.
Focused R3 source tests are authored; Bun/typecheck/build/native/visual
acceptance are NOT EXECUTED.

### Advanced shape composition (source-only, not yet public Runtime)

`geometryComposition.ts` composes up to eight explicitly sourced shape
features into the existing Recipe schema: CUBOID, hollow FRAME, repeated
LINEAR/GRID/RADIAL Cuboids and planar CURVE/TAPER built with the R3a
constructor. The feature compiler uses existing prototype/pattern/feature
ownership, accepts explicit generated-cohort replacement only, protects
unrelated Recipe entries, rejects conflicting ANCHOR/SYMMETRY ownership,
requires Box UV-representable spans, and refuses exact duplicate Cubes.
Native Cube positions are Recipe compilation output, not a visual PASS.

`createAuthoringRecipeService.planAdvancedGeometry` (and Stored variant)
uses the original `planPair`, plan registry and canonical subsequent
`apply` transaction. No second persistent Recipe store, direct native
mutation, public Gateway tool or mandatory Blockbench panel is introduced.
The SOURCE implementation is intentionally not yet invokable by AI clients.
Testing, builds, generated docs, native acceptance and source-based visual
correspondence were deliberately deferred at the user's request.
### Geometry composition: hollow box and stepped arch (R3h, code only)

`geometryShapeBuilders.ts` is the focused, pure mathematical owner for
native-Cuboid shape construction; `geometryComposition.ts` remains the
feature and Recipe-ownership orchestrator. The same strict schema now
accepts `hollow_box` and `arch` alongside Cuboid, Frame, Repeat and Curve.

- `hollow_box`: a caller-chosen open axis/face, five disjoint wall panels
  (side pairs and one opposite back) and a real negative-space cavity.
  All positive wall and interior spans require at least one model unit.
- `arch`: a vertical, voxel-stepped semicircular doorway opening in XY
  or ZY, with bounded odd column count, crown thickness and an explicit
  rise. Each column's bottom samples the nearest crown point within
  the column so its Cube cannot obstruct the intended arch opening.
  Column IDs remain stable at a fixed column count.

All shapes become existing Recipe v1 Cube prototypes and patterns.
No separate mesh engine, new persistent registry, new public Gateway tool,
new Blockbench UI, or manually authored generated API docs were added.
Source implementation is untested by user instruction; native/visual
quality and Bedrock export remain UNVERIFIED.
### R3i — Voxel cylinder / tube with connected hollow cross-section (code only)

`geometryShapeBuilders.ts` now owns the pure `voxel_cylinder` feature
from the existing strict AI schema. Axis X/Y/Z, center, whole-unit
outer radius (2–16), optional inner radius and axial length are
explicit caller parameters, not inferred from image pixels.

The builder samples a one-unit voxel cross-section and compresses each
contiguous occupied row-run into one native Cuboid. It emits no freeform
mesh, no one-Cube-per-cell output and no overlapping run volume.
A bounded 4-neighbour flood rejects disconnected solid walls. For a
tube, the exterior/void check now uses 8-neighbour background connectivity,
consistent with the dual topology already used in the versioned Geometry
Math profile system. A cavity touching the exterior through voxel corners
is **not** accepted as a sealed hole. The enclosed empty cells must also
form one connected cavity. These checks reject bad candidates instead of
silently filling holes, thickening walls, deleting detail or adding Cubes.
All authored axes must retain Box UV-compatible spans.

Patterns have stable source-scoped `shape:voxel_cylinder` IDs and reuse
the original Recipe compiler, incremental rebuild, plan/apply and native
Undo; no new runtime engine or public Gateway tool is introduced.
Whether the voxelized silhouette matches a target reference requires
later native/reference visual review. By user instruction no tests,
Bun, CI, installed Blockbench or export verification were executed.
### Geometry command contract and native plan/apply source binding (code only)

`geometrySchema.ts` owns one strict import-safe Zod contract for Cuboid,
Frame, Repeat and Curve feature intents, explicit reference handles,
bounded counts and native `plan`/`apply` input envelopes. This removes
duplicated feature type declarations from `geometryComposition.ts`.

The existing Blockbench Recipe service now exposes one internal
`constructGeometry` command dispatcher. A plan creates a deterministic
`geometryplan:<sha256>` handle bound to the exact Project UUID, parent
Group UUID, parsed features, compiled Cuboids and source revision.
`advancedConstruction.ts` obtains the source revision from bounded,
read-only native Project/Group/Cube/UV/Undo state. The subsequent apply
recomputes the same plan and refuses drift, a foreign Stage/surface,
missing parent, open native Undo and duplicate native names before
delegating to the existing `manage_cubes(create)` executor.

AI can call plan/apply internally without an independent registry or
human-controlled panel. This is intentionally **create-only**: native
cross-session Recipe persistence and stable parametric replacement must
preserve Blockbench Undo metadata, not write unsynchronized Project
properties after an edit. Source handles are claims, never attested
reference images. `construct_geometry` is NOT registered as a public
Runtime capability, and no installed/native/visual acceptance is claimed.

User requested code-first development: tests, Bun, CI and Blockbench
verification are intentionally deferred until code integration matures.
### R3j — Durable high-level shape source and bounded revision impact (code only)

Advanced Geometry is no longer only a compiled Cube collection. Its
existing Authoring Recipe v1 now includes an OPTIONAL
`advanced_geometry_source` array of the exact high-level feature
parameters (Curve samples, Cuboid bounds, Frame/Hollow Box thickness,
voxel Cylinder radius, Arch rise and Repeat pattern). The array is
canonically sorted and updated **only for the selected feature IDs**.
The command-only `replace_generated` flag is never persisted as a
shape property. Older/other Recipe documents remain compatible and
can omit the optional source field.

`store.ts` validates source count, strict feature schema, unique IDs,
Recipe owner and authored native patterns before serializing the
same bounded Project Recipe store. No new DB, per-model JSON file,
revision registry or second serializer is introduced.

`reviewStoredAdvancedGeometrySource` reconstructs the declared
features through the EXISTING shape compiler without native edits,
then checks exact compiled placement/feature ownership equality.
AI inspect exposes `source_features` only if the parameters match
the persisted Recipe geometry. Mismatches are a review blocker;
legacy source-less Recipes remain readable but do not invent
original feature parameters. This is structural source evidence,
NOT visual/reference or Bedrock export certification.

The native Geometry plan/apply path now returns a bounded
`impact` summary from the canonical incremental rebuild: created,
updated, removed, preserved and metadata-only instance counts,
source-owned examples (max eight each), and explicit UV, Texture and
Animation invalidation. Impact is read-only until apply. It is
not a numeric visual-quality score or permission to override
unsupported textured feature revisions.

Public `construct_geometry` registration still requires one coherent
source + generated API delivery; the current GitHub-only environment
cannot run the Bun generator. No tests/build/native QA were run
per the active user instruction.
### R3k — Six reusable advanced shape methods (code only)

geometryPresetBuilders.ts extends AdvancedGeometryFeature with staircase,
pitched_roof, beveled_box, voxel_ellipsoid (full/upper dome), voxel_cone
(cone/frustum), and voxel_torus (wheel/ring). Explicit dimensions,
orientations and semantic feature IDs compile to original Recipe v1
Cube prototypes/patterns, with existing incremental revision and Undo.

A bounded X→Z→Y greedy voxel partition merges occupied cells into disjoint
native Cuboids and checks six-neighbour connectivity. More than 64
native Cubes per shape are refused; stair/roof use deliberate strips.
These opt-in templates are modelling methods, NOT asset-specific presets,
reference appearance PASS or substitutes for UV/pivot/rig review.

Public construct_geometry registration, generator-owned API/docs, build,
native Blockbench and export proof remain outstanding. Tests/CI were not run.

### R3l — One Geometry Construction Language, not more object presets

One opt-in `kind: "program"` feature adds a versioned `program.version=1`
under the EXISTING advanced Geometry schema. It combines up to eight
semantic parts with strict BOX, EXTRUDE, SWEEP and REVOLVE methods, and
up to sixteen `ANCHOR` relations. A part is a construction unit, not
a guessed native Cube, separate Bone, or hand-authored asset preset.

Each method produces source-local native Cuboid candidates: extruded
simple polygon with optional fully-enclosed raster holes; round
variable-radius swept centerline with optional centripetal Catmull–Rom
interpolation/adaptive chord sampling; and axial radial-profile revolution
with optional interior channel. One-unit voxel occupancy uses bounded
connected-mass checks and deterministic disjoint greedy rectangular
partition. The whole program is bounded to 64 native Cube instances
for current Advanced Geometry apply compatibility.

`geometryMathProgram.ts` uses original Recipe `solveRecipeConstraints`
to place semantic-part bounds under user-declared `ANCHOR` relations,
rejecting conflicting axes and cycles. Final construction is ordinary
Recipe v1 patterns/compile/incremental/native Undo with source parameters
persisted through the existing `advanced_geometry_source`. Existing
R3a–R3k shapes are NOT recompiled through the new engine: v1 source
semantics are pinned to avoid silently changing saved Cube cohorts.

The input reference IDs remain caller claims only. No reference
recognition, automatic proportion invention, UV-repaint, Bone parenting,
new public MCP tool or visual/export PASS is implied. Public
`construct_geometry` and its canonical generated API/docs remain
unregistered. Bun/native/tests/CI/visual proof NOT EXECUTED.

### R3m — Mathematical correctness and source-compatibility audit (source only)

The Geometry Construction Language now accepts `program.version=1|2`.
**V1 is retained for stored Recipe reconstruction**: its historical
nearest-point variable-radius SWEEP approximation, quarter-sample cubic
error heuristic and four-neighbour profile void connectivity remain
selectable only by the explicit persisted version. No saved source,
Cuboid IDs or other R3a–R3k shape constructors are migrated implicitly.

**V2 fixes correctness** without adding object presets, a new registry,
public tool or native engine:

- SWEEP occupancy minimizes the exact quadratic
  `|p-(a+t*d)|² - (r0+t*(r1-r0))²` over `t ∈ [0,1]`, instead of
  treating the radius at the Euclidean nearest chord point as correct.
- Centripetal cubic segments use a conservative chord deviation bound
  derived from their four cubic Bézier controls. Uniform linear knot
  radius remains explicit; no automatic cross-section twist or mesh.
- EXTRUDE uses eight-connected empty-space checks against
  four-connected occupied raster profiles, rejecting diagonal hole leaks.
- The shared bounded 3D greedy partition explicitly checks occupied
  voxel-count conservation and rejects uncertain volume.

The candidate volume is still a one-unit voxel approximation and
native Blockbench Cuboid scene quality is **NOT visually attested**.
The profile and source handles are claims, not verified reference images.
The exact-version plan/apply and Recipe Store remain the sole mutation and
persistence owners; public `construct_geometry` registration still needs
canonical Bun-generated docs.

Next evidence (NOT YET EXECUTED): compare exact v1 native placements
against pre-audit source, then v2 positive/negative cases for varying
radius, curve deviations, diagonal void leakage, multiple holes, volume
conservation, ANCHOR conflicts, UV safety, Undo and save/reopen. Never
mistake source review or presence of these criteria for a passed test.

### R3n — Versioned annular topology and deterministic source (source only)

Exact `program.version=3` is opt-in; stored v1/v2 programs remain on
their existing reconstruction paths. The v3 REVOLVE preflight examines
each annular axial raster section, requiring 4-connected material,
a single represented radial cavity and an 8-connected background that
does not leak through diagonal corner gaps. A 3D mass connected across
multiple layers can still have an invalid radial section, so the local
cross-section check is needed in addition to normal Recipe/voxel
connectivity. V3 rejects that candidate; it does not silently fill holes
or thicken walls. Solid caps and intentionally sub-unit transitions
are not invented as a through-channel.

V3 orders semantic part and ANCHOR IDs using stable codepoint comparison,
not environment-dependent locale collation. The v1/v2 ordering remains
untouched to preserve historical Recipe placement source. The existing
voxel partition now compares the complete occupied-cell bitmap to the
greedy Cuboid-ownership bitmap, in addition to total occupied volume;
this assertion does not alter valid placement output.

No second shape database, mesh engine, global optimizer, registration
layer or native Undo mechanism was introduced. Public
`construct_geometry` remains unregistered. This is source-only
hardening; Bun/typecheck, behavioral tests, installed Blockbench, native
save/reopen/export and reference/visual QA were NOT EXECUTED.

### R3o — Lost-hollow rejection and recoverable errors

V3 `REVOLVE` now rejects a declared positive inner radius if all
axial raster samples eliminate the requested opening. The source-only
failure `GEOMETRY_MATH_REVOLVE_HOLE_NOT_REPRESENTED` replaces silent
solid output; callers must supply a representable profile, not silently
modify shape dimensions or pretend a cavity survives. This applies to
version 3 only. Legacy math v1/v2 remains reconstructable.

V3 Geometry Construction Language failures now retain their original
error-code prefix and append the exact bounded semantic `part` /
`method` (or `part` / source Cuboid ID) where the error occurred.
Original errors remain chained as `cause`. AI can correct the affected
part without guessing which of up to eight parts failed. This does NOT
authorize mutation, fabricate reference evidence, or imply visual PASS.

No tests/build/CI/native QA were run; public `construct_geometry`
remains pending canonical generated API documentation.

### R3p — Semantic part reuse, reflection and linear composition (source only)

The opt-in `kind:"program"` supports an explicit `program.version=4`.
V1–v3 program inputs and compiled Cuboid cohorts retain their previous
semantics: neither their strict part schema nor their source sorting,
Curve/REVOLVE maths or Native Recipe path is silently modified.

V4 adds ONE declarative method, `INSTANCE`:

```json
{
  "version": 4,
  "parts": [
    { "id": "leg_left", "method": "BOX", "at": [-5, 0, 0], "size": [2, 8, 2] },
    { "id": "leg_right", "method": "INSTANCE", "at": [5, 0, 0],
      "source_part_id": "leg_left" },
    { "id": "repeated_braces", "method": "INSTANCE", "at": [0, 0, 2],
      "source_part_id": "leg_left",
      "repeat": { "axis": "Z", "count": 3, "spacing": 4 } }
  ],
  "anchors": []
}
```

An `INSTANCE` borrows a sibling semantic part's LOCAL Cuboid geometry
without inheriting its `at` position, native Group, Bone, UV, Texture
or Animation. `reflect_axis: "X" | "Y" | "Z"` optionally mirrors local
axis-aligned Cuboids about the referenced shape's local bounding-box
midplane; no negative native scale or implicit UV mirroring occurs.
Definitions may appear in any order. A bounded, memoized dependency
resolver follows chained instancing, rejects unknown targets and cycles,
and never re-evaluates the underlying profile/curve unnecessarily.

Optional signed `repeat` is allowed on an INSTANCE (2–16 total
occurrences, finite spacing of at least one model unit in either
direction). It uses the original Recipe LINEAR pattern expansion with
the existing native identity/Undo, rather than a separate placement
engine. The canonical Recipe ANCHOR solver sees the FULL array envelope,
not only the first copy, so a downstream part can align to the array.
A repeated instance cannot itself become another INSTANCE source:
nested/compound arrays would require an explicit separate contract.
Expanded native instances, not only prototypes, count toward the
original 64-Cube-per-program budget.

V4 retains v3 curve mathematics, profile void checking, REVOLVE radial
topology preflight and full voxel coverage checks. The original source
program and exact feature/instance identities persist inside the ONE
Authoring Recipe owner; revisions preserve unrelated native cohorts.
No unapproved object preset, alternate engine, new Gateway tool,
runtime evaluator, registry or database is introduced.

Code/source only. Bun, typecheck, build, tests, CI, native Blockbench,
save/reopen/export and reference/visual QA were NOT EXECUTED.
Public `construct_geometry` remains unregistered until generated
API/docs and Runtime registration can be authored atomically.

### R3q — Explicit v5 LOFT + CONNECT composition (code only)

Geometry Construction Language now accepts `program.version=5`.
Existing versions 1–4 and the 13 pre-existing shapes retain their
original semantics, source IDs and Recipe reconstruction. V5 is inside
the *same* `kind:"program"`, not a new MCP tool or persistence owner.

- `LOFT`: supply X/Y/Z axis and ordered profile stations
  `{height, center:[u,v], size:[width,depth]}`. Local cross-sections
  are interpolated piecewise linearly, then realized as connected,
  bounded native Cuboids by the original 3D voxel partition. Lost
  axial layers, disconnected bodies and oversized sources fail closed.
  This is voxel approximation, not a free-surface mesh.
- `CONNECT`: name two existing semantic parts and explicit
  MIN/CENTER/MAX bounding-box face anchors, endpoint radii,
  interpolation and optional ordered fractional-offset waypoints.
  Solve the ordinary source parts with the existing Recipe ANCHOR
  solver first. Then evaluate each endpoint against actual source
  Cuboid volume, derive a path and invoke the ORIGINAL SWEEP kernel
  for variable-radius, native-Cuboid construction. The connector
  must also have face-area or volume contact with each source:
  empty bounding-box corners cannot authorize phantom connections.
- Source instances and signed canonical LINEAR repetitions remain
  available to `LOFT`/ordinary parts, with repeated source envelope
  and actual members reflected in connector contact checks.
  `CONNECT` is derived output: it is NOT a valid source for
  INSTANCE, a downstream CONNECT, or ordinary Recipe ANCHOR.
  This is a deliberate current solver boundary, not guessed support.

One optional semantic source for straight assembly:
```json
{
  "version":5,
  "parts":[
    {"id":"left","method":"BOX","at":[0,0,0],"size":[4,4,4]},
    {"id":"right","method":"INSTANCE","source_part_id":"left","at":[10,0,0]},
    {"id":"brace","method":"CONNECT",
     "start":{"part_id":"left","anchor":["MAX","CENTER","CENTER"]},
     "end":{"part_id":"right","anchor":["MIN","CENTER","CENTER"]},
     "radius":[1,1],"interpolation":"LINEAR","max_chord_error":0.5}
  ]
}
```

V5 source remains in original `advanced_geometry_source`; total
expanded program output stays within 64 native Cuboids and existing
Recipe plan/apply, parent identity, source freshness and Undo.
Source reference handles are not image attestation, and geometric
contact is not visual, Bone, UV or export approval.

NO Bun, TypeScript, build, tests, CI, native Blockbench or visual QA
were executed. Public `construct_geometry` registration remains
deferred until canonical Bun generator-owned API docs can be authored
atomically with it.

### R3r — Exact orthogonal orientation and face-aware connections (SOURCE ONLY)

Explicit `program.version=6` extends the existing Geometry Construction
Language and the same Authoring Recipe compiler; versions 1–5 retain
their exact declared operations and historical native-Cuboid output.

- `ORIENT`: reuse a source-local semantic part with an explicit
  `quarter_turn: {axis: "X"|"Y"|"Z", steps: 1|2|3}`.
  `geometryMathOrthogonal.ts` transforms each original Cuboid about
  the source part's local bounds centre through exact signed axis swaps,
  avoiding arbitrary trigonometric Cube rotation or negative native
  scale. Optional reflection occurs BEFORE rotation; optional signed
  LINEAR repeat and original ANCHOR relationships are retained.
  The result is new local geometry, not automatic UV mirror, Bone
  pivot, world-space rotation, rig or texture transfer.
- `LOFT` v6: keeps the existing section language and uses half-open
  voxel-centre classification at the upper profile edge. This prevents
  an odd-width integer-centred section from filling BOTH unit-voxel
  columns at its boundaries. Unit-voxel quantization and remaining
  positional approximation are explicit; it is not lossless CAD.
  The old v5 inclusive-boundary rasterization is retained unchanged.
- `CONNECT` v6: after existing ANCHOR solves sources, each endpoint
  requires exactly ONE named MIN/MAX face axis, zero offset along that
  normal, and a point lying on a real source Cuboid face rather than
  an empty bounding-envelope coordinate. The outgoing path must depart
  the start face; the incoming path must enter the target from outside
  its corresponding face. A curved/waypoint route can otherwise
  reverse into the interior of a source Cube between those correctly
  oriented endpoint segments. The v6 source preflight now rejects an
  authored intermediate waypoint strictly inside any actually occupied
  Cuboid of the start or end part (including repeated source copies).
  An empty location inside a hollow source's bounding box is not treated
  as material; boundary/tangent waypoints are not automatically blocked.
  Existing SWEEP, voxel and 3D contact guards still own realization.
  The source-only check now also covers **every centerline interval**:
  LINEAR chords use exact open-box intersection, while Catmull–Rom
  intervals reuse the canonical SWEEP cubic controls and conservative
  de Casteljau subdivision. A proven centerline entry into the actual
  endpoint Cube material is refused; numerically unresolved close
  intervals also fail closed, instead of reporting a safe route. Existing
  endpoint/waypoint/voxel/contact checks all remain in place.

  After the original SWEEP realizes its disjoint one-unit voxel Cuboids,
  the v6 source preflight now checks **actual native-volume overlap** with
  the two solved endpoint-part Cube inventories. Legitimate attachment
  penetration stays permitted only inside a local contact cap: the declared
  endpoint radius plus half a voxel diagonal (sqrt(3)/2 model units)
  to account for cell-centre quantization. A deeper overlap outside that
  cap is refused with `GEOMETRY_MATH_CONNECT_NATIVE_VOLUME_EXCEEDS_CONTACT`.
  The check uses each endpoint's own cap and actual Cuboids, including
  repeated source copies, rather than treating a hollow bounding envelope
  as solid. No second raster or all-scene collision traversal is introduced.

  The continuous centerline preflight remains separate. The new check
  bounds overlap in the **emitted voxel-native Cuboid volume**, not the
  ideal continuous radius-expanded spline, third-party scene obstacles,
  animated geometry or reference/visual/UV approval. Large sections
  remain allowed where they do not intrude too far into the two endpoint
  source parts. Version 5 retains its historical interpretation and
  derived geometry. No new shape method or native mutation is introduced.

Illustrative source snippet (not executed):

```json
{
  "version": 6,
  "parts": [
    {"id":"blade","method":"LOFT","at":[0,0,0],"axis":"Y",
     "sections":[
       {"height":0,"center":[0,0],"size":[4,2]},
       {"height":8,"center":[0,0],"size":[2,2]}
     ]},
    {"id":"blade_side","method":"ORIENT","source_part_id":"blade",
     "at":[10,0,0],"quarter_turn":{"axis":"Z","steps":1}}
  ]
}
```

This extension adds one mathematics-only orthogonal helper under the
existing domain, not an alternate tool, solver, database or native
transaction. Eight semantic parts and <=64 expanded native Cuboids
per program remain enforced. Profile source is caller-asserted, not
verified image evidence. Existing geometry v1–v5 and every R3 legacy
shape remain source-compatible.

Bun/typecheck/build/tests/CI, live Blockbench, Undo/save-reopen,
Bedrock export and visual/reference QA were NOT EXECUTED by user
CODE-FIRST restriction. Public `construct_geometry` still awaits
canonical generator-coupled registration and generated API docs.

### R3s — Exact source-Cube FACE_ANCHOR (SOURCE ONLY)

Opt-in Geometry Construction Language `program.version=7` adds bounded
`face_anchors` to the SAME `kind:"program"` source field. Earlier
programs v1–v6 retain their original schema, geometry, numerical
semantics, IDs, order and source reconstruction.

An entry names a distinct `moving` and `fixed` semantic part, the
exact source-local `cube_id` in each part, and opposite faces such as
`NEG_X` against `POS_X`. An optional `repeat_index` (0-based) is
REQUIRED for repeated parts and forbidden for single parts; this makes
each Cube/copy referent deterministic. Optional `tangent_offset` may
change alignment along the two in-face dimensions only. The requested
Cube face must be exposed against the other Cuboids in its own part,
including repeated copies. Hidden faces, missing IDs, ambiguous
copies, mismatched normals and inward offsets fail explicitly.

The source-owned `geometryMathFaceAnchors.ts` converts those local
face centres to full three-axis existing Recipe `ANCHOR` constraints
for the whole semantic-part bounds. The canonical
`solveRecipeConstraints` remains the ONLY positional graph solver
and owns conflicts and cycles; no new runtime/native operation is
introduced. After solving, the same source-Cube faces must have equal
planes and positive-area overlap, not merely touch along an edge.
This is a structural/local-scope check, not whole-scene clearance,
UV transfer, native Bone parenting, rigid-body joint or visual PASS.

Illustrative v7 source; `face_anchors` references `BOX`'s local
Cube ID `box` (not a scene Cube UUID):

```json
{
  "version":7,
  "parts":[
    {"id":"body","method":"BOX","at":[0,0,0],"size":[8,4,4]},
    {"id":"panel","method":"BOX","at":[0,0,0],"size":[2,4,4]}
  ],
  "face_anchors":[{
    "kind":"FACE_ANCHOR","id":"mount_panel",
    "moving":{"part_id":"panel","cube_id":"box","face":"NEG_X"},
    "fixed":{"part_id":"body","cube_id":"box","face":"POS_X"},
    "tangent_offset":[0,0,0]
  }]
}
```

FACE_ANCHOR may coexist with normal envelope `anchors`; its derived
constraints participate in the same conflict/cycle checks. CONNECT
remains a separately derived, non-ANCHOR source feature and cannot be
used as a FACE_ANCHOR endpoint. All v7 shapes, LOFT, ORIENT, INSTANCE,
signed LINEAR repetition and CONNECT share the original expanded
64-Cube-per-program limit and canonical Recipe source/Undo.

Code only. No Bun, typecheck, build, tests, CI, Blockbench, save/reopen,
export or visual/reference verification executed. Public
`construct_geometry` remains UNREGISTERED pending atomic canonical
API generation with Runtime registration.

### R3t — V8 inter-part CLEARANCE and full FACE_ANCHOR pair protection (SOURCE ONLY)

Opt-in `program.version=8` retains all previous v1–v7 source
schemas, source-local Cube IDs and Recipe compiler semantics. This
extension adds bounded, explicit `clearances` to the SAME high-level
`kind:"program"` stored source; it does NOT create a second placement
solver, collision engine, manager, database or public MCP tool.

- `CLEARANCE`: select two distinct existing semantic part IDs and an
  optional `minimum_gap` (0–8 Blockbench model units, default 0).
  `0` permits face/edge/corner contact but rejects positive-volume
  interpenetration; a positive value requires the nearest Euclidean
  distance between *actual native Cuboid volumes* to be at least the
  declared gap. An envelope-to-envelope or part-centre distance is
  NOT a valid substitute. Both signed LINEAR repeats and derived
  CONNECT geometry are evaluated at their final Recipe positions.
- All v8 `FACE_ANCHOR` pairs implicitly require zero-interpenetration
  between the two entire semantic-part cohorts, not just their selected
  face Cuboids. Their existing exact selected-face, exposed-surface
  and positive-area contact checks still apply.
- The source-first `geometryMathClearance.ts` reuses the exact
  `expandGeometrySourceBoxes` enumeration that CONNECT uses for
  repeated native Cuboids; it scans only declared part pairs after
  the canonical Recipe ANCHOR solver and optional derived CONNECT
  generation. Failed relations return stable error-code prefixes
  plus relation IDs and affected part IDs. The checks do NOT move
  any Cube or infer clearance requirements from images.
- `clearances` is capped at 16, and its IDs are unique across
  standard ANCHOR, FACE_ANCHOR and CLEARANCE relations. Source IDs,
  original v7 relation syntax and native 64-Cube program budget remain.

Example (source illustration only, NOT a Blockbench result):

```json
{
  "version":8,
  "parts":[
    {"id":"base","method":"BOX","at":[0,0,0],"size":[8,4,8]},
    {"id":"plate","method":"BOX","at":[0,0,0],"size":[2,2,2]}
  ],
  "face_anchors":[{
    "kind":"FACE_ANCHOR","id":"plate_mount",
    "moving":{"part_id":"plate","cube_id":"box","face":"NEG_Y"},
    "fixed":{"part_id":"base","cube_id":"box","face":"POS_Y"}
  }],
  "clearances":[{
    "id":"no_plate_base_penetration",
    "part_a_id":"plate","part_b_id":"base","minimum_gap":0
  }]
}
```

IMPORTANT: this is *declared-pair, source-only* Cuboid intersection and
distance; unlisted pairs and other existing scene/Project objects are
not scanned. Touching is not a guarantee of UV compatibility, native
Bone/hinge ownership, rig behaviour, overall visual similarity or
collision-free animation. v1–v7 output is unchanged by design; public
`construct_geometry` remains UNREGISTERED pending canonical generated
API docs and runtime registration.

Build/typecheck/tests/CI, installed Blockbench, save/reopen, native
Undo/export and reference/visual QA were **NOT EXECUTED**.

### R3u — Mathematical dimension links between semantic parts (SOURCE ONLY)

Opt-in `program.version=9` introduces `dimension_links` to the
existing `kind:"program"` source schema and canonical Recipe owner.
Older math v1–v8 and all 13 legacy shape families retain their
original source and compiled-Cuboid semantics.

A DIMENSION_LINK binds exactly one axis of a target `BOX` to the
actual local bounding-box extent of another semantic part (BOX,
EXTRUDE, SWEEP, REVOLVE, LOFT, INSTANCE or ORIENT; not CONNECT).
Links may form a bounded dependency chain, including references
forward in the input. The existing memoized part resolver that owns
INSTANCE/ORIENT geometry now resolves dimensions as well; it rejects
a mixed instancing/dimension cycle rather than iterating or
guessing an order. No new solver, editor or measurement database.

Source syntax:
```json
{
  "version":9,
  "parts":[
    {"id":"frame","method":"BOX","at":[0,0,0],"size":[8,6,2]},
    {"id":"brace","method":"BOX","at":[0,0,0],"size":[1,2,2]},
    {"id":"peg","method":"BOX","at":[0,0,0],"size":[1,1,1]}
  ],
  "dimension_links":[
    {"id":"brace_width","target_part_id":"brace","target_axis":"X",
     "source_part_id":"frame","source_axis":"X",
     "numerator":1,"denominator":1,"delta":-2},
    {"id":"peg_width","target_part_id":"peg","target_axis":"X",
     "source_part_id":"brace","source_axis":"X",
     "numerator":1,"denominator":2}
  ]
}
```
The declared `brace.size[0]` and `peg.size[0]` are fallback
source values; the corresponding linked axes take their derived
values (6 and 3 model units in this illustrative case). Other axes
remain authored. A changed `frame` width deterministically
updates dependent widths before original ANCHOR/FACE_ANCHOR solves.
This example is authored source, **not executed Blockbench output**.

For each link, the derived dimension is
`source_extent * numerator / denominator + delta`.
The ratio uses bounded positive integer numerator/denominator (1–16);
the optional signed integer delta is -16…16. Results must be
representable positive integers in 1–32 model units for inherited
native Box UV. Non-integer, negative, oversized and nonfinite values
fail explicitly. No implicit rounding/clamping, arbitrary formula,
recursive optimization or Blender-like general CAD solver.

Source extent means the axis-aligned bounds of the source's *entire*
semantic part, including the outer envelope of signed LINEAR repeats.
It does NOT imply that gaps between repeat copies are solid material,
or that image dimensions were measured independently. One
DIMENSION_LINK per target BOX axis is permitted; all new relation IDs
are unique among ANCHOR/FACE_ANCHOR/CLEARANCE/DIMENSION_LINK. Linked
BOX source geometry is still realized through the same native Recipe
prototype/pattern builder after versioned mathematical construction.

The original >=64-Cube guard, single `advanced_geometry_source`,
source-matching inspection, dependency and ownership protections,
native Cube Group and Undo remain in use. No separate MCP capability,
DB, new plugin or generated API-doc snapshot was created. Public
`construct_geometry` remains UNREGISTERED.

NO Bun, build, typecheck, unit/integration tests, CI, installed
Blockbench, save/reopen, Undo, export or visual QA was executed.

### R3v — Source-owned dimensional acceptance, not automatic beauty scoring (CODE ONLY)

Explicit `program.version=10` adds at most 16 optional
`dimension_constraints` alongside existing `dimension_links` in the
same `kind:"program"` and original `advanced_geometry_source`.
Earlier v1–v9 source semantics, local Cube IDs, compiler and native
Recipe ownership remain unmodified.

`SPAN_BOUNDS` constrains one part's source-local axis-aligned bounding
extent to a finite inclusive `min_span..max_span` (0–64 model units).
`RATIO_BOUNDS` constrains `extent(A,axisA)/extent(B,axisB)`
between inclusive lower and upper **exact rational constants**.
Bounds have nonnegative integer numerators 0–32 and positive integer
denominators 1–32; malformed or inverted ranges reject before any
native authoring. A zero-extent denominator is never silently accepted.

Example: an AI declares that an 8-unit seat within a 12-unit frame
must retain between 2/3 and 3/4 of the frame's width. The same
constraint applies after a v9-style `DIMENSION_LINK` recomputes size:

```json
{
  "version":10,
  "parts":[
    {"id":"frame","method":"BOX","at":[0,0,0],"size":[12,4,4]},
    {"id":"seat","method":"BOX","at":[0,0,0],"size":[1,2,4]}
  ],
  "dimension_links":[{
    "id":"seat_width","target_part_id":"seat","target_axis":"X",
    "source_part_id":"frame","source_axis":"X",
    "numerator":2,"denominator":3
  }],
  "dimension_constraints":[
    {"kind":"SPAN_BOUNDS","id":"seat_min_width",
     "part_id":"seat","axis":"X","min_span":8,"max_span":10},
    {"kind":"RATIO_BOUNDS","id":"seat_frame_ratio",
     "numerator_part_id":"seat","numerator_axis":"X",
     "denominator_part_id":"frame","denominator_axis":"X",
     "min_ratio":{"numerator":2,"denominator":3},
     "max_ratio":{"numerator":3,"denominator":4}}
  ]
}
```

`geometryMathDimensionConstraints.ts` checks the exact bounded
part envelopes after the existing semantic resolution, original Recipe
ANCHOR/FACE_ANCHOR solve and any derived CONNECT generation, but before
the ordinary native Cuboid factory. Ratios use finite cross-multiplication
rather than dividing by an uncertain measurement. Failures identify the
declared constraint ID/part without altering geometry, guessing shape
parameters, clamping ratios or creating another solver.

Source envelopes for signed LINEAR repeats include the intentionally
empty gaps between copies. Neither these checks nor any v10 result
establishes reference-image measurement, player-scale fitness, optimal
artistic proportion, UV/rig correctness or global scene collision safety.
The existing <=64 expanded-Cube budget, one Recipe store, incremental
native Group/Undo and stable four public Gateway tools remain.

Code authored only. NO Bun, TypeScript typecheck, build, unit tests,
CI, native Blockbench, save/reopen/export or visual QA was executed.
Public `construct_geometry` remains UNREGISTERED pending canonical
generator-coupled Runtime/API changes.

### R3w — Explicit measurement authority and scale-aware construction (SOURCE ONLY)

Strict opt-in `kind:"program"` `program.version=11` adds one bounded,
source-declared measurement context while retaining EVERY v1–v10
construction algorithm and original Authoring Recipe compiler/Undo.

`scale_context.model_units_per_block` is exactly 16 (repository's
native Minecraft modelling convention). **No universal real-world
metres-per-block is assumed.** `meters_per_block` is optional and
must be explicitly declared for METERS/CENTIMETERS; similarly an
optional `player_height_blocks` must be explicitly declared before
PLAYER_HEIGHTS. These calibrations have their own claimed provenance.
Neither setting automatically alters the whole model or redefines
the project Coordinate Frame, and no player height defaults to 1.8.

`measured_dimensions` is an optional list of at most 16 explicitly
sourced measurements that **owns individual BOX axes**. Values may
be expressed in MODEL_UNITS, BLOCKS, METERS, CENTIMETERS or
PLAYER_HEIGHTS. The pure `geometryMathMeasurement.ts` converts an
explicit value into native units before existing BOX construction.
Only exact (within floating arithmetic noise), positive integer
sizes 1–32 units are allowed; fractional, overlarge and uncalibrated
dimensions fail closed. A BOX axis may have one MEASURED_DIMENSION
or one previous DIMENSION_LINK, never both. Other BOX axes retain
the originally declared source size.

`scale_targets` (max 16) independently checks a final part's
X/Y/Z envelope against an explicit inclusive `min_value` and
`max_value` in the chosen unit, after DIMENSION_LINK, INSTANCE,
ANCHOR/FACE_ANCHOR and derived CONNECT. It is acceptance-only:
it never moves, scales or revises Cuboids. Repeat envelopes include
intentionally empty space between copies.

Example: one explicitly declared 1 metre/block calibration turns a
0.5-metre authored seat height into 8 native model units. This is a
**hypothetical design scale**, not a universal Minecraft measurement.

```json
{
  "version":11,
  "parts":[
    {"id":"seat","method":"BOX","at":[0,0,0],"size":[8,1,8]}
  ],
  "scale_context":{
    "model_units_per_block":16,
    "meters_per_block":{"value":1,"evidence":{"kind":"DECLARED_SPEC"}},
    "player_height_blocks":{"value":1.8,"evidence":{"kind":"DECLARED_SPEC"}}
  },
  "measured_dimensions":[{
    "id":"seat_height","target_part_id":"seat","target_axis":"Y",
    "unit":"METERS","value":0.5,"evidence":{"kind":"DECLARED_SPEC"}
  }],
  "scale_targets":[{
    "id":"seat_width_player_ratio","part_id":"seat","axis":"X",
    "unit":"PLAYER_HEIGHTS","min_value":0.25,"max_value":0.35,
    "evidence":{"kind":"DECLARED_SPEC"}
  }]
}
```

Every measurement/calibration carries an explicit `evidence`:
`DECLARED_SPEC` means *caller-declared*, NOT certified/approved by
the user; `REFERENCE_CLAIM` must supply `source_ref` that exactly
matches an existing outer-feature `evidence_refs` handle. Binding
a handle is only a provenance-identity check, not evidence that any
image/spec sheet was fetched, read, metrically calibrated or validated.
Unknown refs fail before voxel and native Cube construction.

All measured source parameters persist in the same
`advanced_geometry_source`. Existing 13 shapes, v1–v10 source
semantics, Recipe-native Group/Undo and <=64 expanded Cube budget
remain. No new Gateway tool, DB, external measurement service,
native format, automatic model scaler or hand-edited generated API.
Public `construct_geometry` is still UNREGISTERED.

**Not executed:** Bun, typecheck, build, tests/CI, live Blockbench,
native Undo/save/reopen/Bedrock export or visual/reference acceptance.

### R3x — Interval measurement uncertainty and fail-closed scale decisions (SOURCE ONLY)

Opt-in `kind:"program"` `program.version=12` adds
`uncertainty_targets` (1–16 declarations) and optional
`calibration_uncertainty` to the existing v11 Measurement & Scale
contract. Math source versions v1–v11 remain unchanged: no implicit
calibration, material mutation, Box resizing or reference approval.

Each target declares `part_id`, X/Y/Z `axis`, `unit`, a
`min_value..max_value` closed interval, an EXPLICIT
`tolerance_model_units` (0–16) and evidence. Range bounds are
caller-declared possibilities, **not statistically computed
confidence levels or verified observations**. For physical units,
conversion propagates BOTH calibration bounds (metres-per-block),
and player-relative units propagate declared player-height bounds.
Any optional calibration interval must contain the nominal value
used by existing v11 measured BOX construction. No metres-per-block
or player height can be guessed from pixels or general knowledge.

The new pure `geometryMathUncertainty.ts` returns one of three
read-only states per target: `ALL_DECLARED_VALUES_FIT`,
`SOME_DECLARED_VALUES_FIT` or `NO_DECLARED_VALUES_FIT`.
**Only ALL may pass the source preflight**, and even ALL means
compatibility with stated intervals/tolerance, NEVER a verified
reference or asset approval. SOME throws a dedicated
`GEOMETRY_MATH_UNCERTAINTY_REVIEW_REQUIRED` error; NONE reports
`GEOMETRY_MATH_UNCERTAINTY_INCOMPATIBLE`. No branch auto-selects
a best-case measurement or enlarges tolerance without new source.

Example: model height 8 units, caller-declared 0.5 m nominal with
1 metre/block nominal calibration and a 0.95–1.05 metre/block
uncertainty range. Source dimensions 0.48–0.52 m propagate to
about 7.31–8.76 model units. An explicit 1-unit native tolerance
covers that FULL declared interval; a tighter tolerance may fail.

```json
{
  "version":12,
  "parts":[
    {"id":"seat","method":"BOX","at":[0,0,0],"size":[8,8,8]}
  ],
  "scale_context":{
    "model_units_per_block":16,
    "meters_per_block":{"value":1,"evidence":{"kind":"DECLARED_SPEC"}}
  },
  "measured_dimensions":[{
    "id":"height_nominal","target_part_id":"seat","target_axis":"Y",
    "unit":"METERS","value":0.5,"evidence":{"kind":"DECLARED_SPEC"}
  }],
  "calibration_uncertainty":{
    "meters_per_block":{"min_value":0.95,"max_value":1.05,
      "evidence":{"kind":"DECLARED_SPEC"}}
  },
  "uncertainty_targets":[{
    "id":"height_interval","part_id":"seat","axis":"Y",
    "unit":"METERS","min_value":0.48,"max_value":0.52,
    "tolerance_model_units":1,"evidence":{"kind":"DECLARED_SPEC"}
  }]
}
```

For uncertain calibration in a v12 `MEASURED_DIMENSION`,
a corresponding uncertainty target on the same BOX part/axis and in
the SAME measurement unit is REQUIRED; its interval must contain
the nominal measured value. A MODEL_UNITS-only target cannot hide
uncertainty in metres or player-height conversion.
Provenance for every interval/calibration must bind through the same
outer-feature `evidence_refs` check as v11 (a matching
`REFERENCE_CLAIM` remains unverified reference content).
Original dimensions/ANCHOR/FACE_ANCHOR, CLEARANCE, LOFT, ORIENT,
signed LINEAR repeats, derived CONNECT, single Recipe v1 compiler
and 64-expanded-native-Cube budget remain the only owners.
No second solver, persistent store, provider API or new Gateway tool.

**Proof boundary:** source-only implementation. No Bun, typecheck,
build, tests/CI, installed Blockbench, native Undo/save/reopen,
Bedrock export or visual/source verification was executed.
Public `construct_geometry` remains UNREGISTERED pending canonical
generator-owned Runtime/API documentation.

### R3z — Ordered PROFILE_SWEEP joint continuity (source only)

The existing v13+ `PROFILE_SWEEP` kernel already requires every declared
segment to contribute one-unit sampled voxels and the *overall* voxel
solid to be six-neighbour connected. That does not by itself show the
**authored sequence of segment joints** was retained: a later/nonadjacent
segment can bridge two contributions that do not touch each other.

The existing voxel predicate now records a compact segment-membership
bitmask (one byte per already-budgeted cell, at most seven segments).
After the same canonical voxel partition, each **consecutive** segment
pair must share an occupied voxel or have occupied voxels touching
through a full face. Edge/corner-only contact is insufficient.
A missing join fails with
`GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED`, rather than
silently treating some other part of the union as that segment's join.
The check adds **no second raster, synthetic filler Cubes, remeshing,
sampling-density reduction or second Recipe engine**.

Existing valid single-segment and multistation source shapes retain
their original deterministic Cuboid partition and native Recipe owner.
Stored v13+ sources whose only global connectivity came from a
non-consecutive path shortcut may now fail reconstruction; no saved
Recipe is automatically migrated. This validates the discrete joint
topology only, NOT fidelity of a continuous CAD surface, the exact
declared pen-width/taper at every station, tangent smoothness, UV
ownership, native Blockbench or visual reference acceptance.

Bun/TypeScript/Codex/native tests and visual QA remain NOT EXECUTED
under the user's testing hold; regressions are authored only.

### R3z — PROFILE_SWEEP station-local joint contact (source only)

The v13+ `PROFILE_SWEEP` segment bitmask already verifies contact
between adjacent *source sequence* segments. Previously that contact
could occur anywhere on a looping/bent/twisted sweep, even when the
declared shared station had no native voxel connection. A remote
self-contact is not proof that the intended corner joint survived.

The existing contact helper now receives the authored stations and
voxel-grid origin from the same source-local raster. Each consecutive
pair must share a voxel or full-face adjacency **near its declared
shared station**. The conservative search radius is the station's
rectangular cross-section corner distance
`hypot(half_width, half_height)` plus half the unit-voxel diagonal
`sqrt(3)/2`. Contacts only at distant crossings no longer satisfy
the joint. The existing
`GEOMETRY_MATH_PROFILE_SWEEP_JOINT_DISCONNECTED` error includes
`reason=OFF_STATION` for this bounded failure. A three-argument
source-only contact helper call retains its prior unscoped behavior;
the canonical sweep always supplies station coordinates.

This is **geometric localization of discrete voxel contact**, not
proof of continuous smooth transitions, exact pen-width, correct
twist orientation, unobstructed rigging or visual/reference fidelity.
No second voxelization, geometry filler, new source schema, native
operation, public Gateway tool or new engine is introduced. Some
previously stored v13+ sources whose only segment contact was at a
remote loop may now fail reconstruction without automatic migration.
Regressions are authored, not executed.

### R3z — Material taper visibility after PROFILE_SWEEP voxelization (source only)

The existing v13+ `PROFILE_SWEEP` raster now checks whether a
source-declared material half-width or half-height change survives
one-model-unit voxel sampling. Before this change a taper could become
equal-size axial sections despite valid mass and ordered joints.

For each segment/axis with **at least one model unit** of half-extent
change, the SAME voxel-predicate pass records near-start/end voxel-center
radial extents in that segment's transported/twisted section frame.
Sampling bands cover `min(1, segment_length/3)` model units.
A **0.5-unit minimum change in the authored direction** is required.
Missing endpoint samples or collapsed/opposite-direction taper fails
with `GEOMETRY_MATH_PROFILE_SWEEP_TAPER_UNREPRESENTED`.

This is a coarse discrete representability gate, **not** exact
thickness, loft smoothness, UV, rig, reference or visual PASS.
Changes smaller than one native half-extent unit are left as caller
declarations and not promoted to visible evidence. No additional
voxel raster, filler Cube, re-meshing, persistent state or public tool.
Existing valid Cuboid partitions and v1–v12 version behavior remain
unchanged. A stored v13+ source with unrepresented taper may newly
fail reconstruction; no automatic migration is performed.

Focused tests are AUTHORED_NOT_RUN; Bun, TypeScript, Codex and native
Blockbench visual acceptance remain NOT EXECUTED.

### R3z — Significant PROFILE_SWEEP twist representation (source only)

The existing v13+ `PROFILE_SWEEP` applies caller-declared
`twist_degrees` when sampling its transported cross-sections.
Until now, connected mass, station-local joints and material taper
checks could all pass even if a strongly twisted **anisotropic**
section yielded exactly the same native voxel occupancy as the
section held at its starting angle.

The SAME existing one-unit voxel predicate now checks **whether any
cell's inclusion differs** from that segment with
`start.twist_degrees` held constant. This counterfactual shares
the same profile, source positions, dimensions, bend frames and cell
coordinates; only twist interpolation differs. It does not perform a
second raster or generate alternative Cuboids. The comparison runs
only for source segments whose declared twist changes by at least
45 degrees and whose width/height anisotropy reaches one model unit
at either end. Once a difference is observed, extra comparisons for
that segment stop. If no difference survives sampling, the source
refuses with `GEOMETRY_MATH_PROFILE_SWEEP_TWIST_UNREPRESENTED`.

Rotationally symmetric or subthreshold source shapes retain their
earlier behavior: the guard neither claims their twist is visible nor
rejects them based on a meaningless occupancy difference. The
result proves only a nonzero voxel occupancy response to the
declared twist. It does NOT prove the exact angle, intermediate
curve/tangent smoothness, texture orientation, UV correctness or
reference visual fidelity. No fill Cubes, geometry smoothing,
additional geometry engine, native API or source schema is added.
Stored v13+ source whose significant anisotropic twist was
completely aliased by voxel resolution can now fail reconstruction.

Regressions are AUTHORED_NOT_RUN; Bun, TypeScript, Codex, installed
Blockbench and visual acceptance remain NOT EXECUTED.

### R3z — Stable initial PROFILE_SWEEP frame at bends (source only)

The source-owned v13+ `PROFILE_SWEEP` parallel-transports the initial
cross-section normal through consecutive path tangents, then applies
the caller's explicitly authored twist. If the **first path tangent**
is almost parallel or antiparallel to the chosen `up_axis`, the
initial orthogonal projection has vanishing magnitude. A microscopic
signed transverse offset can then reverse the normalized frame by
180 degrees, propagating unintended cross-section roll along later
bends even when no twist was declared.

The canonical frame constructor now refuses this near-singular
numeric source when the sine of the angle between `up_axis` and the
first tangent is below `1e-4` (about 0.0057 degrees), with
`GEOMETRY_MATH_PROFILE_SWEEP_UP_AXIS_UNSTABLE`. Exact parallel still
uses the existing `UP_AXIS_PARALLEL` error. An explicit different
`up_axis` is required; LazyDesigner does **not** guess a fallback,
silently rotate Cubes, change the twist parameters or modify geometry.
Ordinary slanted/orthogonal and bent source paths retain the same
frames and deterministic voxel/Cuboid compiler.

This protects a narrow numerical singularity, not every possible
visual orientation discontinuity. It neither verifies actual
reference alignment, UV texture rotation, seamless shape surface,
nor native Blockbench output. No new schema/version, solver,
voxel raster, public Gateway tool, generated API or native action
was introduced. Persisted v13+ sources with near-singular initial
`up_axis` may newly refuse reconstruction until revised explicitly.
Focused regressions are AUTHORED_NOT_RUN; Codex, Bun, TypeScript,
live Blockbench and visual QA remain NOT EXECUTED.

### R4: existing Geometry fidelity diagnostics, scoped to a selected Recipe feature

`geometryFidelity.ts` composes the existing `geometry/surfaceEvidence.ts`
**same-parent** static containment, projected-outline and rectangular
merge diagnostics. The existing `inspectStoredGeometryCoincidence` opt-in
native/Recipe snapshot already validates current placement identity and
parent hierarchy; when a **selected instance** owns an explicit semantic
feature, its review now includes `geometry_fidelity_review`.
It does not run during ordinary inspection, normal Geometry mutation or
a broad unselected review.

The report identifies exact native Cube UUIDs and Recipe instance/feature
owners, labels candidates `REFERENCE_AND_NATIVE_REVIEW_REQUIRED`, and
protects cross-feature membership and declared ANCHOR/SYMMETRY dependencies
as `RETAIN_DECLARED_RELATION`. Known motion, transform, negative-space
and contact requirements also prevent treating a geometric merge or
containment as redundancy. The diagnostic is withheld if native parent
identity, reference claims, target identity or technical scope is missing.
Partial/missing static evidence cannot mean the asset is error-free.

Every result preserves `quality_verdict: UNVERIFIED`, and
`safe_to_merge_or_delete: false`: silhouette from current views,
material/UV/alpha, independent visibility, relevant extreme poses and
Bedrock export still need their existing reviewers. Repeated unsuccessful
corrections and evidence freshness remain owned by the existing
`orchestration/correctionLoop.ts` and Recipe transaction guards;
R4 does **not** implement an alternative loop, score, auto-simplifier,
Cube deletion, or native mutation. Focused R4 source tests are authored,
but Bun/typecheck/build/native and visual proof remain NOT EXECUTED.


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
- A proposed 3D feature whose sole purpose is `NEGATIVE_SPACE` and which
  has no owned Recipe instance must not be interpreted as a solid Cube to
  add. The read-only optimization response is `REFERENCE_REVIEW_REQUIRED`
  for inspection of the surrounding structure; combined silhouette/volume
  requirements still retain `GEOMETRY_CREATION_REQUIRED`. Neither action
  bypasses the compiler's required feature ownership or authorizes a native
  carve, mutation or visual PASS.
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

### B13 — First source-level Cube counterfactual

`assessRecipeNativeCoincidence` now includes `optimization_counterfactual` from
a small pure Recipe-domain helper. This uses the existing incremental
rebuild planner, NOT another checker or native optimizer.

The only supported case is a Recipe with exactly one zero-spaced LINEAR
pattern, one prototype, at least two co-located native Recipe-owned Cubes
under the same parent, no Anchor/Symmetry or explicit feature-intent owner,
and identical observed UV/material fields without authored parent Bone tracks.
Missing source evidence, an animation or material difference, unsupported
pattern, or differing hierarchy results in `NOT_PREPARED` with a reason.

For the supported case, a **cloned Recipe** with the LINEAR count reduced
from N to N−1 is passed to `planIncrementalRecipeRebuild`. The existing
planner compiles both Recipe versions and validates the counterfactual is
exactly one tail instance removal, with zero upserts or metadata-only edits
and every other compiled instance preserved. The draft is never returned,
persisted, applied or submitted to Undo.

`SOURCE_COUNTERFACTUAL_ONLY` reports pattern identity, before/after
**compiled Recipe** Cube counts, `compiled_recipe_cube_delta`, exact
hypothetical removed instance and source fingerprints. It does not prove
that the native Blockbench model or Bedrock export can be simplified:
`native_reduction_measured: null`, `native_mutation_executed: false`,
`native_removal_authorized: false`, `visual_verdict: NOT_EVALUATED`,
and the parent `estimated_removable_cube_count: null` remain mandatory.
Even matching authored source cannot prove visual, rig or controller parity.

This is a source-only first experiment, not a general-purpose Geometry
reduction engine and not an authorization to delete Cubes.

### B14 — Exact native identity and source-only drift closure

The B13 hypothetical one-instance LINEAR reduction now reports both
`counterfactual_removed_instance_id` **and** the corresponding
`counterfactual_removed_native_cube_uuid`, obtained exclusively from the
already verified Recipe-owned native Cube inventory. It never guesses the
target by name, candidate example order, or visual proximity. Missing exact
native UUID resolution refuses the draft; retained compiled instance IDs
must also match the full expected set, not just the previous count.

These are **source identity bindings**, not an instruction or permission to
remove a native Cube. The result is still `SOURCE_COUNTERFACTUAL_ONLY`,
`native_reduction_measured: null`, `native_mutation_executed: false`,
`native_removal_authorized: false` and `visual_verdict: NOT_EVALUATED`.
The no-coincidence refusal is named
`NO_EXACT_AUTHORED_NATIVE_COINCIDENCE` to avoid implying that native visual
equivalence was ever verified.

The existing `AuthoringRecipeService.inspectStoredGeometryCoincidence`
also re-reads the native Recipe-owned Cube inventory on **every** inspection,
including when the optional UV/material/animation surface reader is absent.
If Geometry or Group source changes during the read, it fails with
`RECIPE_OPTIMIZATION_NATIVE_CHANGED_DURING_INSPECTION` before returning
a stale review. Previously this second native read happened only when a
surface snapshot existed. Saved-Recipe metadata freshness and native
surface read-window protections remain in place.

This closes two exact integration holes without any new checker, registry,
Gateway route, native Apply transaction, or installed Blockbench claim.

## Advanced Geometry creates canonical Recipe-owned Cubes (code only)

The internal `advancedConstruction.ts` create path builds a deterministic
Recipe from Project identity, parent Group UUID and semantic feature IDs.
Creation of a second cohort with the same Recipe identity is refused;
the stored-Recipe planning path owns later parametric revisions.
The native adapter accepts an optional exact parent Group UUID for
new Cubes while retaining the original root default for legacy callers.

Advanced first creation now calls the existing
`applyAuthoringRecipeIncrementalAtomic` with that parent-aware native
adapter. This is the same native Undo and Project Recipe metadata
transition described below; generated Cubes carry Recipe/instance IDs.
No new runtime database, mutation framework or duplicate Cube engine is
introduced. Public `construct_geometry` routing is still pending
canonical generator-owned API documentation. No tests/QA were run.
## AI-first inspect/create/revise Geometry command (source only)

The internal `constructGeometry` command now supports read-only `inspect`
of exact saved Advanced Geometry Recipes, source-only `plan` and
source-fingerprint-protected `apply`. AI can discover an exact saved
`recipe_id`, existing feature identities and native parent Group UUID
without guessing identifiers or asking a user to identify a Cube.

The plan/apply inputs have a `mode`: `create` (default) or `revise`.
A revision requires `target_recipe_id` and an existing saved Recipe.
Only selected existing generated features can be changed. Previous
Recipe state, unrelated features, constraints and parent identity
are preserved. The canonical incremental rebuild retains native Cube
UUIDs for unchanged instance IDs; affected/removed instances use the
same owned native Undo transaction and metadata source revision.

Revisions refuse unsupported source identities, no-op changes, over-budget
native deltas, a moved parent Group, and texture-mapped affected Cubes
whose UV ownership cannot yet be safely remapped. Native scene and
plan fingerprints must remain unchanged between planning and applying.

**Critical persistence correction:** Blockbench's bbmodel codec
explicitly skips ModelProject custom properties with `export:false`.
The canonical Project Recipe store is therefore now registered with
`export:true` for editable .bbmodel persistence; Bedrock geometry export
is a separate codec. Cube Recipe ownership properties already survive
getSaveCopy without changing their previous flags.

This is source-only authoring logic, not a registered AI-facing Runtime
tool or native quality proof. QA/build/generation remain deferred.
## Project Recipe source persistence and native Undo coherence (code only)

The canonical `AuthoringRecipeService` now supplies both previous and next
Recipe revisions to the SAME native `commitUndo` that applies Cube changes.
The Blockbench adapter preflights the current Project Recipe store before
native `Undo.initEdit`, validates the exact stored previous Recipe, and
serializes the next Recipe using the existing bounded `store.ts` owner.
First adoption permits only a genuinely empty previous Recipe; it does
not silently overwrite already-owned/hand-authored geometry.

Before `Undo.finishEdit`, the adapter stamps a namespaced metadata
before/after marker on the ORIGINAL native `Undo.current_save` and writes
the new Project Recipe property after all fallible precommit checks.
The existing ownership registration adds native `undo`/`redo` listeners
which restore the Project Recipe property only when the exact current
source matches the expected history side and Project UUID. Hot-reload
teardown removes those listeners. Nothing is stored in a second undo
registry or database. Cancellation restores the original property
before cancelling the owned native edit.

Metadata-only source mutation without a native Undo is rejected by the
Blockbench adapter rather than being reported as a persisted success.
An external edit or history listener failure withholds automatic
reconciliation; callers must inspect native state and re-plan.
Native save/reopen and plugin reload behavior remain UNVERIFIED until
the user reopens QA. This is source wiring, not certified Undo behavior.
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
