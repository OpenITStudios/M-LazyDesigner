# LazyDesigner — Visual Validation

**Status:** Active Policy  
**Version:** 1.6  
**Updated:** 2026-09-18

## Purpose

Define the minimum evidence required before LazyDesigner claims that a Blockbench
model visually matches the requested scope.

Reference preparation belongs to [Reference Preparation](../../02-reference/README.md).
This note validates the Blockbench result.
Comparison captures require Shading ON. Record shading, view/front direction, and artifact revision with the image; unknown/off shading is not final comparison evidence. Use the same lighting context for before/after judgements. Blockbench preview shading supports review but does not prove actual Minecraft in-game lighting.

## Core Principle

**Structural success is not visual success.**

None of these proves resemblance by itself:

- successful MCP/tool call;
- all Cubes existing;
- Cubes touching/overlapping;
- valid `from/to/origin/rotation` values;
- valid hierarchy/parenting;
- matching global bounds;
- saved/reopenable file;
- linked UV/texture data;
- numeric similarity/IoU/projection score.

A material visual `PASS` requires **both the actual approved reference image and fresh current-revision model image evidence to be visible to the reviewing model in the active comparison context**.

A filename/path/manifest, Reference Evidence Map, prose description, remembered reference, prior observation summary, or old model screenshot is not a substitute for those images.

## Optional art-direction probes (AD-01 / AD-02)

Use these **only** if identity hierarchy or small-display readability is genuinely unresolved; they do not add a mandatory capture to every Cube/tool operation. The research rationale is in [Modelling curated research](../modelling/research-sources.md#artist-oriented-composition-sources--ad-01ad-02-2026-10-31-research-only); the approved user image remains authoritative.

- **AD-01, focal hierarchy:** compare which observable primary mass/landmark conveys the identity and whether unrelated geometry/ornament obscures it. Separate actual source color/marking from cinematic bloom, camera angle or lighting; a bright area is not automatically a required texture change. Name the affected part and reference claim before attributing cause to Geometry or Texture.
- **AD-02, intended-size silhouette:** inspect a *derived view* of the same current native capture at the asset's intended presentation scale when known. Keep orientation, crop, visible model size, revision and shading comparable to a supported source view. This is a visual-readability probe, **not** a new global thumbnail pixel quota or proof of unobserved depth.
- **No false comparison:** if the source is an art-render and the model is a neutral Blockbench capture, do not label cinematic lighting, pose or exposure differences as geometry/texture defects. Request only the missing compatible evidence that can change the current decision. Neither a resized screenshot nor a perceptual similarity number independently establishes a `PASS`.
- **Evidence output:** one identity-bearing discrepancy, its current/reference image hashes or exact current-view evidence refs, view/camera and material presentation context, responsible existing owner if supported, and smallest coherent correction candidate. Unknown correspondence remains `UNVERIFIED`; approval stays with the existing visual verdict and human review.

These probes are adapted from first-party [Riot Character Art](https://www.riotgames.com/en/artedu/character-art), [Riot portfolio guidance](https://www.riotgames.com/en/portfolio-and-reel-suggestions) and [Hytale art direction](https://hytale.com/news/2025/12/an-introduction-to-making-models-for-hytale), not copied visual assets or new renderer contracts. Native and quality benefit **NOT EXECUTED**.

## Reference Claim / View Grounding

Use a compact Reference Evidence Map only when material identity/view/attachment ambiguity needs explicit tracking; otherwise state the concrete difference and supporting views directly:

```text
claim_id | observable reference claim | supporting reference view(s) | evidence state
```

The map is navigation/cache for current reasoning, not independent visual proof. If the actual image contradicts a cached claim, the image wins and the claim must be re-grounded.

Compare like with like; use an explicit View Pair Map when correspondence is materially ambiguous:

```text
REFERENCE FRONT ↔ MODEL front
REFERENCE BACK  ↔ MODEL back
REFERENCE SIDE  ↔ MODEL matching left/right
REFERENCE TOP   ↔ MODEL top
REFERENCE 3/4   ↔ MODEL matching front_left_3q/front_right_3q
```

View identity must be explicit. Ambiguous/mirrored front/back, left/right, or 3/4 pairing leaves the affected claim `UNVERIFIED`; **do not silently compare the closest-looking view**.

**Structured discrepancy intake (source gate, not visual PASS):** Geometry claims about required/extra parts, attachments, silhouette, depth, negative space or secondary form must name at least one actual compared view and distinct reference/model evidence identities before entering the existing `visualObservation` compiler. Treat a mismatched/missing source-view pair as `UNVERIFIED`; the labels alone do not prove the images were inspected or calibrated. Keep cause and criterion aligned: missing/extra part claims are separate from size/position errors; a wrong silhouette is not permission to add filler Cubes, and a contact gap is not a generic surface-detail fix. `UNKNOWN` cause is permitted but routes to more evidence rather than a speculative mutation. The existing Correction Loop and matching native-revision checks remain the only correction/continuation owners.

## Visual Verdict Contract

Every material visual gate must end in exactly one state:

```text
FAIL
UNVERIFIED
PASS
```

### FAIL

Use when any critical or major mismatch is visible in an applicable criterion. The review must name the mismatch and corresponding reference/model view evidence; include `claim_id` only when a claim map was needed.

### UNVERIFIED

Use when evidence needed for the claim is missing or insufficient. Examples include missing actual reference image, missing current model view, invalid/ambiguous View Pair Map, missing side/depth evidence, materially conflicting views, or unavailable capture. Missing evidence is not a visual pass.

### PASS

Use only after the **actual approved reference image and fresh current-revision model images were directly inspected together through the correct paired view(s)**, a difference-first review checked the applicable supported claim, and no critical/major mismatch was found.

A claim may be narrower than the whole model. For example, a front silhouette can pass while depth remains UNVERIFIED. Do not upgrade a partial-view success into a full 3D PASS.

### Claim-locked difference-first review

Before approval, actively search for mismatch in each relevant paired claim/view:

```text
claim_id
REFERENCE VIEW ↔ CURRENT MODEL VIEW
observable reference requirement
silhouette / primary mass / count difference
primary proportion / placement difference
orientation / slope difference
visible contact / topology difference
negative-space difference when material
severity: critical / major / minor / none
verdict: FAIL | UNVERIFIED | PASS
```

Only after this mismatch search may the reviewer choose PASS. Generic positive language is not a substitute for this comparison.

## Evidence Types

### Structural Evidence

Examples:

- element UUIDs;
- authored transforms;
- hierarchy/parent state;
- rendered global envelope;
- save/runtime state.

Structural evidence answers **what state exists**, not whether it looks right.

### Reference Visual Evidence

The **actual approved reference image** currently visible to the reviewing model. A path/manifest/metadata/text summary by itself is not visual evidence.

### Model Visual Evidence

Fresh model images from the current revision, in views that correspond to the
reference question being evaluated.

Visual evidence answers **whether the form reads correctly**.

After a material geometry/pivot/hierarchy mutation, affected previous model views are stale until re-captured.

### Runtime Evidence

Live proof of Blockbench/MCP behavior such as camera/render transport, Undo,
project switching, animation, save/reopen, or persistence.

Static GitHub source is not runtime evidence.

## Current Local Observation Instruments

Current Local source includes:

### `inspect_model_bounds`

Returns raw rendered whole-Cube envelope facts such as size/center/ground context.

Use `inspect_model_bounds` only for material envelope/scale/ground/displacement or bounded surface/contact questions; reuse fresh evidence. Do not call it as a mandatory modelling checkpoint. It is structural evidence, not a visual validator.

### `capture_model_views`

Produces named canonical **model images** for explicit front direction and stable
reference ↔ model comparison.

Principal views are orthographic comparison evidence; 3/4 views are volume/
readability context. Successful capture is not `PASS`. It does not itself load/score the approved reference or judge resemblance.

### `inspect_elements(mode=detail)`

Returns exact authored Cube/Group state for a diagnosed local target. Reuse fresh exact state already returned for that target when sufficient; use `inspect_elements(mode=detail)` only when required state is unavailable, insufficient, or stale. Do not add a mandatory readback before every numeric correction.

These are source-implemented capabilities. Their live integration/image delivery
still remains `LOCAL PROOF REQUIRED` until tested locally.

## Reference ↔ Model View Pairing

For actual image-based review through the Gateway: obtain the approved
source image(s) with `status(reference_package_path=...,
include_reference_images=true)` for the current authoring stage. If there
are more than four, request only the necessary stage image IDs using
`reference_image_ids`. The source images arrive as MCP image content,
while compact metadata exposes ID, approval status, optional canonical view,
SHA-256 and current Reference Package fingerprint.

Capture current model images separately with `capture_model_views` using
the correct `front_direction`, framing and relevant views/targets.
Compare both actual images directly in one reviewing context. For images
marked composite/unknown, verify the relevant panel manually rather than
pretending that a tag solves camera alignment. Model camera-spec fields
are capture plans, not native camera attestation; neither matching hashes nor
silhouette score grants a visual PASS.

Control binds image byte hashes to the active stage context fingerprint.
A changed source image invalidates the old context even if
`REFERENCE.json` did not change. A missing, unsafe or oversized source
image blocks the affected stage. Normal `status` remains compact; do
not request the bytes during unrelated orientation or development work.

Compare like with like using the View Pair Map. Do not silently compare mismatched front/back or left/right interpretations.

Do not require every view after every mutation. Capture the smallest view set
that can answer the current modelling question.

## Cross-View Validity

A whole-form verdict must cover the views/axes that the claim actually depends on.

```text
front PASS + side FAIL        -> whole-form FAIL
front PASS + side unavailable -> whole-form UNVERIFIED for depth/side claims
front PASS + conflicting side/top reference -> BLOCKED if the conflict materially affects primary form and cannot be resolved
```

Do not promote the strongest-looking view to represent the whole 3D model. For each material mismatch/approval, name the paired view that supports it and keep unsupported axes provisional or unverified.

### Blocked validation

`BLOCKED` is not a visual quality grade. It means a valid visual verdict cannot currently be reached without guessing because the actual approved image is unavailable, view pairing cannot be resolved, material reference evidence conflicts, required observation/capability is unavailable, or repeated failed work has exhausted the bounded correction direction.

When blocked, stop speculative corrections and report:

```text
blocker category
evidence
claim/result that cannot be validated
bounded attempts already made
exact requirement to unblock
```

If the same causal correction direction fails twice without new evidence, treat continued patching as a loop and stop. Do not manufacture a success report from repeated attempts.

## Structural Envelope Gate

When approved numeric target bounds exist:

1. inspect current rendered bounds;
2. compare width/height/length/center/ground with the target envelope;
3. use explicit target-envelope framing for visual capture where appropriate.

This prevents auto-framing from hiding scale/offset failure.

Matching bounds remain **structural evidence only**.

## Gate 1 — Primary Whole Form

Before secondary/detail work, check grounded material claims for:

- recognizability;
- required primary masses/landmarks/counts;
- global silhouette;
- major proportions;
- primary mass placement;
- important orientation/slopes;
- major visible contacts/topology;
- important negative spaces/separations.

For a material mismatch, identify:

```text
claim_id
failed criterion
responsible mass/relationship when known
observed mismatch
reference/model view(s)
severity: critical | major | minor
```

Statements such as “looks good”, “everything is attached”, or “all Cubes are
present” cannot produce `PASS`.

### Hard Rebuild Threshold

Reject/rebuild the primary scaffold when:

- the intended object is not recognizable;
- several primary relationships fail together;
- semantic decomposition itself omitted/misread material parts;
- repair would require detail/compensating geometry to hide a wrong whole form.

If decomposition is wrong, return to Semantic Form against actual reference claims. If decomposition is sound but spatial relationships are globally wrong, return to Primary Form Hypothesis. Do not micro-patch a globally wrong scaffold because work has already been spent on it.

## Gate 2 — Complete Geometry

After secondary geometry/neutral organization, with form-defining hierarchy/pivots already established when required, review applicable supported claims:

- silhouette/proportions across the declared reference views;
- required major parts/counts and orientation;
- depth/footprint where reference evidence exists;
- coherent visible attachments;
- important negative spaces;
- rotations that correspond to visible form/motion;
- meaningful pivots corresponding to actual transform/joint/attachment needs;
- no arbitrary distant pivot;
- no major unnecessary/intersecting/inverted geometry;
- hierarchy supporting intended editability/motion.

## Gate 3 — Texture

Only when texture is in scope:

- UV orientation/alignment;
- material/pattern direction;
- pixel-density consistency where applicable;
- missing/broken surfaces;
- identity/readability.

Texture cannot approve or conceal wrong primary geometry.

## Gate 4 — Animation

Only when animation is required:

- pivot arcs;
- hierarchy behavior;
- clipping/detachment;
- intended motion/readability;
- return/neutral behavior when relevant.

A static pivot that creates an implausible motion arc is not approved.

## Gate 5 — Final Review

Use the **actual approved reference image plus evidence from the current saved/release candidate**. Do not reuse older model screenshots after material geometry/pivot/hierarchy/texture/animation changes.

## Region-grounded semantic part review

A real image can contain multiple representations inside one semantic part:
its **silhouette/volume** belongs to Geometry, whereas its **markings,
colors and thin surface detail** normally belong to Texture. For an
approved single-view image, `images[].regions` can annotate these
bounded claims using `part_id`, `evidence_role`, `visibility` and
normalized region box. The same `status(include_reference_images=true)`
response returns the pixel image and its region metadata; the read-only
`semantic_part_grounding` summary separates owner signals, view coverage
and explicit ownership conflicts.

`PARTIAL` never authorizes reconstruction of the unseen continuation.
`OCCLUDED` is visibility uncertainty, not evidence that the part does
not exist. Duplicate images of one canonical view never supply independent
cross-view shape corroboration. A box is neither a semantic segmentation
mask nor source-camera calibration. Do not generate geometry from a box,
turn region labels into automatic difference scores, infer exact dimensions
from pixels, or allow a proposed region to overrule the approved image.
Resolve `DECLARED_TEXTURE_BUT_VISIBLE_VOLUME` and
`DECLARED_OMIT_BUT_VISIBLE` as explicit owner-review questions before
issuing a causal correction. If the region/model correspondence is
uncertain, keep the claim `UNVERIFIED`.

### Recipe-owned part correspondence at the capture boundary

When explicit image-region annotations and native recipe-owned Cube
UUIDs are material to a Geometry review, reuse the existing Gateway
`status(include_reference_images=true)` to obtain the actual approved
source pixels and current image IDs/SHA-256/regions. On the existing
`capture_model_views` call, optionally include
`reference_correspondence` with the saved `recipe_id`, **only the
current reference metadata** (not binary bytes), and the explicitly
proposed region-to-Cube UUID mapping.

The native owner reads the current stored Authoring Recipe and exact
recipe-owned UUIDs, verifies their state before and after the model
capture, and returns compact `part_correspondence` candidates with
project/native fingerprint and capture-image digests. A missing recipe
or invalid native owner is rejected; an absent candidate mapping stays
provisional, **not** proof of a missing required part.

The source image metadata in the Runtime request remains **caller
declared**, not verified by Blockbench from the Reference Package. Its
output deliberately omits source/model visual-review declarations and
cannot mark a correspondence `SUPPORTED` automatically. Only
fresh paired source/model pixels examined together may support a
reviewer's later claim. The recipe-owned native fingerprint does not
cover unrelated Cubes, parent group transforms or texture pixels.
Do not forward provisional correspondence directly into correction
convergence or a 3D mutation. The four-tool Gateway surface is unchanged.

## Bounded Landmark Diagnosis

Use source-image landmark measurements only after the actual approved image
has been inspected and the required part correspondence is known. An
`images[].landmarks` row supplies `id`, normalized `uv` and optional
semantic `part_id`. The image hash is read from the current Reference Package;
never assume an old image ID identifies unchanged pixels.

For a grounded central mass point, call existing `capture_model_views` with
explicit `views`, `front_direction`, and a bounded `landmark_pairs` list
referencing image ID, SHA-256, landmark ID/UV, view, and exact model Cube UUID.
The Runtime observes that Cube's rendered world-space center (including
parent transform), then returns projected model UV, source/model offset and
an in-frame flag. No new tool or second solver is needed.

A Cube center is **not a general corner, joint or silhouette endpoint**.
Do not map a source edge landmark to a Cube center just because the part name
matches. Landmark residuals do not establish source camera calibration,
depth reconstruction, view occlusion, or reference fidelity PASS; they never
auto-issue a correction. If camera/view/source binding is uncertain, keep
the discrepancy `UNVERIFIED`, not `RESOLVED`. Continue using the existing
difference-first observation and correction loop for supported claims.

### Measured direction guard — same capture, not source-camera calibration

For bounded corrections that already have a separately evidenced **Geometry**
owner/cause and exact Cube correspondence, compare the previous and fresh
`capture_model_views` landmark outputs only when the source image ID/SHA,
landmark ID, exact Cube UUID, project UUID, front direction, resolution,
framing bounds and **computed camera settings** are unchanged.

The existing `assessLandmarkCorrectionDelta(before, after)` helper evaluates
per-point 2D UV residual direction (`IMPROVED`, `UNCHANGED`,
`REGRESSED`, `UNCOMPARABLE`). It does not average improvement across
different parts: any worsening point is a regression. It also cannot prove
correct correspondence between a real-world reference camera and Blockbench.

On the existing `CorrectionLoopRegistry.updateEvidence` boundary,
`options.landmark_check` can supply the previous/current capture descriptions,
bound to the original/new verification evidence handles. The affected views
must be explicitly reported in `recovered_views`. Camera drift, missing
pairs, incorrect handles and regressed measurements are rejected **before**
correction state changes. An unchanged measurement cannot be used to clear a
vanished discrepancy.

If the measurement regresses, stop the correction and **undo the actual
native edit at its execution owner** before recapturing; correction-loop code
does not invoke native Undo or claim it has reverted model state.

The parametric recipe's native apply transaction now has a separate safety
boundary: while the original `Undo.initEdit` remains open, a read-only
`verifyBeforeCommit` check can reject the candidate before
`Undo.finishEdit`. The adapter verifies exact ownership of the current
Undo save and created Cubes. On rejection the same native owner uses
`Undo.cancelEdit(true)`; the transaction checks that the before-state
fingerprint is restored and surfaces `RECIPE_APPLY_ROLLBACK_UNVERIFIED`
if not. This must **not** be described as post-commit automatic rollback
or as automatically wired landmark judgment. Landmark before/after
measurements performed after an apply commit remain diagnostic until an
actual execution-owner recovery is completed.

The existing Authoring Recipe Service now supports explicit
receipt-bound recovery through its existing bounded `APPLY_RECEIPT`
evidence handle. The native adapter may undo the **exact top-most**
Blockbench history entry only when a private provenance stamp on the
actual before-save matches the receipt, project UUID, Undo position
and exact after-state fingerprint. An intervening edit, current open
edit, changed Cube state or missing receipt must refuse recovery.
A successful Undo must restore the exact original native fingerprint;
otherwise return `RECIPE_POSTCOMMIT_UNDO_UNVERIFIED`. This internal
recovery method does not change the stable four-tool Gateway surface,
and it is not invoked automatically by `assessLandmarkCorrectionDelta`. A measured
improvement is supporting diagnostic evidence only: a fresh actual
reference↔model comparison and independent semantic observation still own
`IMPROVED`, `RESOLVED` and final visual `PASS` decisions. Do not derive
`POSITION_MISMATCH` or other 3D causes from a 2D UV offset alone.

## Visual Repair Loop

```text
actual reference image + fresh paired current model evidence
↓
claim_id + concrete mismatch
↓
GLOBAL or LOCAL?

GLOBAL
→ revise Semantic Form when decomposition is wrong
→ otherwise revise/rebuild Primary Form Hypothesis

LOCAL
→ locate exact UUID only if target identity is not already fresh/known
→ reuse fresh exact authored state; inspect_elements(mode=detail) only if unavailable/insufficient/stale
→ choose causal correction
→ retain relevant pre-correction paired evidence
→ mutate bounded relationship
→ fresh affected paired view(s) first; expand only for material cross-view risk
→ qualitative fidelity delta
```

### Compact Difference Contract

A correction discrepancy `code` is a stable identity, not a reusable severity
label. Two claims in the same evidence batch cannot share a code, including
whitespace variants, even if they differ in owner or severity. Structured
batches mark both ambiguous entries `OBSERVATION_INVALID`; direct correction
input fails before state mutation. Valid independent claims remain eligible.
This avoids a `Map` silently replacing one diagnosis with another during
correction, convergence and continuation.

For a local visual mismatch, the reviewing model should stop after producing the
minimum decision payload needed by the existing authoring-intent compiler:

```text
target
difference:
  criterion: SILHOUETTE | PROPORTION | PLACEMENT | ORIENTATION | CONTACT |
             TOPOLOGY | NEGATIVE_SPACE | COUNT | DEPTH | LAYERING
  severity: CRITICAL | MAJOR | MINOR
  view: canonical paired view
  delta: one observable mismatch
  claim_id: optional
correction_family:
  TRANSLATE | RESIZE | ROTATE | REATTACH | LAYER_OFFSET |
  SPLIT | MERGE_REMOVE | ADD_MASS
geometry_operations:
  exact semantic operation(s)
preserve:
  only invariants materially at risk
```

Do not repeat the diagnosis as explanatory prose before execution. `delta` is bounded
to one concrete mismatch; it is not a chain-of-thought field. If exact semantic
operations are not yet grounded, remain in visual judgment rather than inventing
coordinates.

### Causal Correction

Use the correction family carried by the compact intent. Do not default to adding another Cube.

For one multi-Cube relationship, `manage_cubes(operation=batch_update)` may execute different
exact-UUID corrections as one recoverable operation. It does not plan or judge
the correction.

### Fidelity Delta / Convergence

A discrepancy disappearing from a partial observation is not evidence of
resolution. The correction loop accepts an absent target only with explicit
`cleared_target_codes`, a fresh evidence handle, and `recovered_views`
covering the target's recorded views (or verification fallback views when
the claim has no recorded view). This is a reviewer's bounded clearance
declaration, **not** automatic visual certification. Missing or contradictory
coverage rejects the update before mutation, leaving verification pending.
Unrelated discrepancies remain tracked independently. For non-targeted full
updates, previously recorded claims also need explicit clearance before
they disappear; do not rename a remaining mismatch to bypass verification.

A local correction must prove direction, not merely mutation activity. Compare the relevant fresh pre-correction evidence with fresh post-correction evidence for every materially affected supported claim/view:

```text
IMPROVED | UNCHANGED | REGRESSED
```

A correction counts as progress only when the target mismatch is `IMPROVED` and no previously supported material claim/view is `REGRESSED`. `UNCHANGED` or `REGRESSED` is not progress. If one paired view improves while another material paired view regresses, reject that correction direction; change the causal diagnosis or reopen the owning Primary Form Hypothesis rather than patching around the regression.

This is a qualitative difference-first delta, not a scalar similarity score. Do not aggregate view outcomes into a numeric fidelity score or let one improved view cancel a material regression elsewhere.

## Rotation Review

For a material rotation, answer:

- Which grounded reference/form/motion claim justifies the angle?
- Is the rotated mass improving the intended silhouette rather than compensating
  for wrong placement/size?
- Is the rotation simpler/more coherent than an unnecessary stepped
  approximation?
- Did it damage visible contacts/global bounds?

A newly created non-zero-rotation Cube must have an intentional explicit pivot;
this source-level safety does not itself prove the pivot is visually correct.

A visible material slope left axis-aligned is `FAIL` unless the approved construction language intentionally requires a stepped form.

## Pivot Review

For a meaningful pivot, answer:

- What rotation/joint/attachment/parent-transform purpose does it serve?
- Is it near the intended transform relation rather than a random distant point?
- Does its transform preserve visible attachment/articulation?

### Pivot-only Cube correction

If geometry is already correct and only pivot is wrong, Local uses Cube
pivot-transfer semantics so the pivot can change without intentionally moving the
visual Cube.

### Group pivot

Group/bone pivot changes use Blockbench transfer-origin semantics through `modify_group(origin)`; reserve `bone_rigging` for IK/mirror.

Both behaviors are source implemented; live behavior still requires local proof.

## Severity

### Critical

Makes the model unusable, unrecognizable, or materially different from the
requested target.

### Major

Strongly reduces reference fidelity, readability, attachment, or required
function.

### Minor

Does not block intended use.

Critical/major issues block visual completion.

## Information-Gain Visual Gate

Before `capture_model_views`, identify the **current unanswered visual claim**. When
that claim maps to canonical evidence targets, prefer `evidence_targets` and let the
Runtime choose the minimum useful view set deterministically instead of asking Astra/Codex
to reason about camera selection.

Examples:

```text
width + height + silhouette → front
depth + attachment          → left
orientation + layering      → front_left_3q
rear_topology + depth       → back + left
underside                    → bottom
```

This selector is evidence routing, not visual judgment. It must not decide PASS/FAIL,
invent reference claims, or replace direct inspection of the returned image(s). Explicit
`views` remain valid when the reference itself dictates a specific correspondence or
when the canonical evidence vocabulary cannot express the question.

For Codex allowance efficiency, one view that answers the claim is better than a
multi-view board that adds no decision-changing evidence. Reuse the existing verification
risk when available:

```text
LOW
→ minimum evidence-target view set

MEDIUM
→ minimum set + one deterministic orthogonal view

HIGH
→ minimum set + front/left/top core coverage when possible
```

Risk expansion is a quality guard, not a second visual planner. It does not change the
claim, judge the image, or add more than the five-view capture budget. For post-mutation
verification, reuse `DeltaVerificationPlan.evidence_requests[].verification_risk`
directly; Codex should not restate or reclassify the same risk. The visual claim/evidence
targets still come from grounded visual diagnosis and must not be invented from risk
alone.

Explicit `views` remain authoritative when the reference requires a specific
correspondence. When `evidence_targets` are also given, `view_selection.uncovered_targets`
reports which claims lack canonical view coverage. Those claims remain UNVERIFIED
until direct image evidence supports them; the tool does not silently replace
explicit views. If automatic selection cannot cover the targets in five views,
narrow the claim instead of silently exceeding the context budget.

Captures include computed `camera_spec` (projection, position, target, up,
zoom/FOV) and `framing_bounds`. Compare these settings before judging
before/after silhouettes or proportions. Prefer a shared explicit framing
envelope when object bounds change: auto-framing can hide scale changes.
Camera-spec metadata describes the applied capture plan, not independently
attested native camera pose or proof of visual fidelity.

## Dynamic Evidence Reuse

For a bounded correction, fresh evidence from an unaffected view remains reusable when
the current discrepancy set carries complete view provenance.

```text
WIDTH_HIGH          → front
SHOULDER_CONTACT    → left

correct WIDTH_HIGH
→ front becomes stale
→ left remains reusable
→ recapture front only
```

Reuse is valid only when every current discrepancy needed for the reuse decision has
explicit view provenance. Missing/partial provenance falls back to conservative
recapture of the request views.

The existing correction registry tracks the latest evidence handle **per view**. A fresh
targeted verification replaces only the stale view handle and only the targeted
discrepancy branch; unrelated discrepancies and unaffected view handles remain available
for the next correction round. This is lifecycle bookkeeping inside the existing
registry, not a second visual cache. A clear recaptured view may remain reusable even
when it no longer has an active discrepancy.

## Adaptive Capture Resolution

When `evidence_targets` are present and no explicit `size` is required, choose the
smallest resolution that still supports the current decision:

```text
256
→ silhouette / width / height / length / count

384
→ depth / orientation / negative_space / asymmetry

512
→ attachment / layering / rear_topology / underside
```

Risk raises the floor:

```text
LOW    → target-driven minimum
MEDIUM → at least 384
HIGH   → 512
```

An explicit `size` always wins. Explicit `views` without grounded evidence targets
retain the 512 default, preserving existing high-detail behavior. Texture/identity review
should continue using detail-appropriate evidence; do not downsample merely to reduce
Codex allowance when the decision depends on fine visual detail.

## Evidence Economy

Good reasons to capture:

- primary whole-form gate;
- complete-geometry gate;
- one targeted correction;
- texture/animation gate;
- final current-revision gate.

Bad reasons:

- after every Cube/tool call;
- to prove that a Cube was technically created;
- to create evidence volume without a decision it informs;
- repeat unchanged views after the criterion is already established.

More screenshots are not automatically more proof.

## Completion Rule

Visual `PASS` is valid only when the **actual approved reference image and fresh current-revision model image(s)** were actually inspected against the relevant grounded claim/view criteria.

Invalid approval justifications include:

```text
all Cubes are present
all Cubes are attached
tool calls succeeded
coordinates are valid
bounds match
hierarchy is valid
rotation/pivot values exist
validator has no error
similarity/IoU/projection score is high
reference path/manifest/summary says it should match
```

## Execution-Channel Boundary

### ChatGPT → GitHub

May review/change source/docs and establish static contracts. Cannot claim live
Blockbench visual/runtime success or model image-understanding accuracy.

### Codex Local

Blockbench + MCP is the final environment for proof requiring actual image
transport, camera behavior, model appearance, animation, Undo, or persistence.

If that proof is unavailable, report `LOCAL PROOF REQUIRED` / user-facing
`Perlu pemeriksaan` rather than inventing a substitute. If the approved reference image itself is unavailable to the reviewing model, reference-driven visual authoring/approval is `BLOCKED` rather than memory-based.

## Related

- [Modelling Workflow](../modelling/README.md)
- [Geometry Standard](../modelling/standard.md)
- [Current Validation](../../05-operations/current-validation.md)
- [Current Flow](../../01-product/flow.md)
