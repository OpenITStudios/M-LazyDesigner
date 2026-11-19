# Pillager Tier 1–3 Golden A/B — real visual acceptance contract

**State:** SOURCE_AUTHORED, TEST_AUTHORED_NOT_RUN, LOCAL_TEST_DEFERRED.
**Purpose:** compare real baseline and candidate Bedrock Entity model quality without confusing SHA/PNG receipts with artistic acceptance. This is an evaluation handoff, not a new runner, approval database, or claim that a Rust/native trial occurred.

## Grounded source evidence

The Local branch's 2026-11-16 authoring-session analysis and public transcript describe repeated user rejections involving Pillager Tier 2–3 shading, helmet flatness, repeated noise/stripes, side ornaments, shield appearance versus Cube size, color drift of neutral hardware and accidental edits to approved Tier 1 regions. Its recorded late-session helmet correction was saved but not finally accepted by the user.

- Analysis: https://github.com/OpenITStudios/M-LazyDesigner/blob/Local/experiments/authoring-session-2026-11-12/continuation-2026-11-16/analysis.md
- Original feedback: https://github.com/OpenITStudios/M-LazyDesigner/blob/Local/experiments/authoring-session-2026-11-12/continuation-2026-11-16/messages.md

Do not infer that Rust reproduces those defects or has fixed their appearance. Do not copy private images from the Local archive to a public test fixture.

## Freeze a comparable A/B case

| Evidence | Required before evaluation | If unavailable |
| --- | --- | --- |
| Selected baseline / candidate source | Exact .bbmodel SHA, geometry/UV/material identity, saved texture revision | NOT_EVALUATED |
| User-approved style master | Actual Tier 1 approved material/reference PNG and original approval context, SHA | MASTER_UNVERIFIED |
| Current candidate | Real PNG capture and matching saved .bbmodel SHA, model/texture revision | CAPTURE_UNVERIFIED |
| Matching visual view | Camera, crop, illumination/shading, orientation, face visibility for BOTH sides | VIEW_MISMATCH |
| Independent reviewer | Actual person or authorized image-capable host receiving BOTH real images and giving a specific finding | REVIEW_NOT_OBSERVED |
| Mutation result | Saved sibling SHA, affected atlas pixels, protected-region comparison, new view | UNVERIFIED |

Baseline and candidate must use comparable model, viewer, reference and work scope. Do not compare a Blockbench-hosted Local runtime with Rust and assume an equivalent renderer or native feature surface.

## Texture Craft TC1 — mask/stroke/shade-walk A/B probes (SOURCE ONLY)

Extend existing PILL-03, PILL-05, PILL-06, PILL-07 and PILL-09,
**not** a new benchmark, model or separate acceptance authority.

- **Same source and reference**: pin Local and Rust model/reference PNG
  SHAs, identical material/part/pose, selected face UUID, atlas/UV,
  light setup and matched front/side/back closeups. A Rust-only candidate
  must not silently change Geometry, its native shading preview, or the
  user-approved source artwork before the A/B comparison.
- **Professional cluster composition** (PILL-03): compare a controlled
  shadow/bevel highlight painted through an explicitly selected
  face-local `brushComposition` (mask+stroke) with the earlier repeated
  stripes/noise. The independent reviewer must describe actual form
  readability, hard-edge continuity, material character and quiet
  resting areas, not number of pixels/brushes or code features.
- **Protected identity and palette** (PILL-01/PILL-05): a source-swatch
  `shadeWalk` may move only one adjacent **declared** material role;
  its actual host Paint must preserve source alpha, current reviewed
  editable RGBA and protected logos/neutral iron. Missing shade role,
  unknown reference RGB or source mismatch means STOP before Paint.
- **UV/face mapping** (PILL-06): use native rotated/signed face-local
  projection and exact physical atlas source guards; ambiguous alias,
  missing mapped backside or invalid source contact cannot count as
  reviewed. A row-span mask is not the reference-image bounding box.
- **No repeat-failure loop** (PILL-07): when the reviewer rejects one
  stroke family or sees the same visual artifact after a second attempt,
  require a new cause/selected evidence rather than changing only
  brush radius, palette naming or seed. A new plan fingerprint is not
  itself visual improvement.
- **Approval boundary** (PILL-09): the authored unit/host regression
  fixtures check exact compiled guarded operations, mask exclusion,
  overlapping/fragmented clusters, shade roles and missing native
  form receipt. Only a fresh native image reviewer can judge artistic
  success and user approval; source-only tests are NOT_EXECUTED.

The new composer is a deterministic source-authoring helper. It does
not infer the correct stroke from an image, bake AO/curvature, sample
unknown original bitmap colors, simulate native GPU shading or certify
its result better than `Local`. Its alternate brush path remains
reviewer-selected and sample-first.

## TC2 curved brush visual acceptance extension (SOURCE ONLY)

Use the same existing PILL-03 helmet flatness and PILL-07
repeated-stripe comparison, not a new acceptance runner.
Freeze the identical approved reference, model/UV, selected
Cube face and camera/shaded model views; compare an explicitly
selected three-anchor curved gesture with the prior painter
composition and a true reference-matching flat/stepped
counterexample. Check whether the curvature improves the
actual helmet bevel, material value hierarchy, silhouette
and quiet areas, and whether the 4-connected quantization
creates corner stair-step artifacts. A syntactically valid
curve may be worse than a straight hand-placed cluster.
Review the exact resulting saved atlas face and matched
shaded model, not just path anchors or geometry normals.

Efficiency must count artist corrections, actual source
safety refusals, unnecessary brush plan edits, tool calls
and cost/time to **accepted** result. The sparse compiler
changes algorithmic work and may save repeated full-256²
scans, but a real timing/quality improvement over Local
remains `NOT_MEASURED/UNVERIFIED`. Authored Node tests
for source equivalence, 4-neighbour connectivity, rest
preservation, malformed curves and 256-wide row boundaries
are NOT_EXECUTED under the test hold.

## P0 semantic material source-first acceptance (NOT_EXECUTED)

P0 introduces one deterministic Rust painted-metal candidate as a
**new control**, not an A/B winner by construction.

- Use PILL-03: same current approved Tier 1 helmet material source,
  selected Tier 2/3 Cube-face UV, close-up views, light/framing and
  original opaque base swatches. Compare the candidate's sculpted
  corner value masses **against** the prior flat stripe and any
  genuinely better manually painted cluster. More colors or wedges
  are not quality evidence; the candidate may also be rejected.
- Use PILL-01/PILL-04/PILL-05: record original neutral hardware,
  face marks, shield symbols and approved legacy identity. The
  proposal must leave all original non-base pixels untouched,
  keep alpha and abort a protected-region conflict before Apply.
  If an approved mark shares the selected base swatch, an exact
  reference-provided protected region is required; source RGB
  selection alone cannot tell artwork from base.
- Use PILL-06: the mask comes from the actual signed/rotated native
  Cube face projection and refuses atlas-aliased, absent, unsupported,
  uneditable, and broad faces. A successful one-face preview cannot
  stand in for an all-face inventory or a 3D rendered approval.
- Use PILL-07/PILL-09: one reviewable candidate per selected part.
  On visual rejection, change the diagnosis/reference or treatment
  family; do not repeat the same corner formula under new names.
  `VALIDATED_NOT_APPLIED`, a candidate SHA and a source RGB
  whitelist do not mean the reference was seen or accepted.
- Efficiency must be measured as **time/tool calls/corrections to
  accepted artwork** against the matched Local workflow, not lines
  of source code or raw bytes/pixel. The P0 semantic intent removes
  AI-authored pixel paths but still requires actual ref-grounded
  palette selection and final visual judgment.

This is a source-authored acceptance extension to the existing Golden
Pillager review. P0-D disposable rendered preview and P0-E
reviewer-bound Apply integration remain separate work; no native
Pillager test, image-capable review or quality win was executed.

## P0-D/E semantic material candidate — actual matched-view review remains mandatory

**Source-authored, NOT_EXECUTED.** The Rust editor now has a
user-selected PNG **reference image preview** and a non-persistent
Source/Candidate toggle using the *same* Three.js model, camera,
UV and renderer. The reference picker reports only
\`USER_SELECTED_NOT_ARTISTICALLY_VERIFIED\`; selection/hash is
not proof that the reference was approved. The candidate has
\`UNVERIFIED\` material/visual status, and the GUI must never
capture it as if it were the original saved .bbmodel preview.

At PILL-03 and PILL-07, compare a real close-up of the current
helmet from both Source and Candidate views at identical framing,
with the chosen approved Tier 1 reference visible. Reject
generic opposite-corner wedges, discontinuities, stripes,
underexposed panel centers or lost material identity even if
the native source plan was legal and the user could click Apply.
If a candidate is worse than the previous manual cluster,
retain the previous version or discard; do NOT increment a
self-authored performance or quality score for generating it.

At PILL-01/PILL-04/PILL-05 require explicit source
before-color and protected landmark checks. RGB equivalence
does **not** prove an emblem is harmless to repaint:
approved marks using the same base swatch still need protected
atlas coordinates from actual reviewed image evidence.
At PILL-06, an accepted one-face result must not stand in for
actual side/back/underside and six-camera review.
At PILL-09, the direct editor user can acknowledge that both
provisional views were inspected and explicitly Apply, but
this **does not constitute independent image reviewer
acceptance** or final material/style PASS. A stale model epoch,
revision, selected target, texture UUID, reference hash,
source SHA or candidate SHA must refuse that Apply.

Efficiency includes number of model reloads, rejected candidates,
correction cycles, tool invocations and elapsed time **to
independently accepted art**. No candidate image, actual review
or cost-to-accepted measurement was executed in this GitHub-only
source phase.

### P0-D/E acceptance of a rejected candidate (SOURCE ONLY)

The comparison UI now requires explicit selection of both
Source and Candidate before a separate user acknowledgment
can enable the SHA-bound desktop Apply. The user may instead
choose *Reject and revise*, with a defect classification for
flat value masses, approved identity risk, incorrect material
style, or another observed failure. The exact same semantic
intent (current model/revision, reference SHA, Cube/face,
base/palette, corner and contrast) cannot be regenerated
unmodified in that UI session. This is a bounded correction
loop to discourage repeating the same generic wedge mask,
not an automated evaluation of image quality.

A separate native source regression records the immutable
original PNG/model/Undo after ephemeral preview, rejection
of mismatched source or candidate SHA, and an exact accepted
transaction whose Undo restores the original. The tests are
AUTHORED_NOT_RUN. Neither the visual-review checkbox nor
the test source proves that a human actually compared the
saved reference against all affected mapped views. Evidence
of Rust > Local visual improvement, shadow placement and
cost to accepted artist result remains NOT_EVALUATED.

## Frozen acceptance cases

| Case ID | Prior user feedback | Acceptance evidence to obtain |
| --- | --- | --- |
| PILL-01 | Approved Tier 1 shield was modified during requested higher-tier grading | Exact approved Tier 1 pixel/carrier unchanged in saved file and matched visual views |
| PILL-02 | Tier 2 shield artwork looked smaller despite equal Cube dimensions | Compare visible artwork bounds, not merely Cube dimensions |
| PILL-03 | Tier 2/3 helmet was a flat band rather than hand-painted metal | Human/visual-capable reviewer sees material hierarchy and highlights/shadows on a helmet close-up; numerical color count is insufficient |
| PILL-04 | Unwanted side/head ornaments or removed required helmet and face trace | Approved helmet remains, prohibited side ornament absent, red face trace retained in front and side views |
| PILL-05 | Blue/red variant shading recolored neutral iron and collapsed identity | Hardware remains neutral where requested; accents/shield red follow approved reference |
| PILL-06 | Rear, side and undersides were overlooked | Pin sample to Cube/UV/texture owner; measure six saved Cube-face alpha states **separately** from six operator-selected rendered camera pairs. Each reviewed face cites a selected `observedInViewId` and is matched against real saved Cube/face/texture identities before reviewer acceptance; unresolved or occluded views still block broad propagation and cannot pass quality |
| PILL-07 | Same rejected stripes/noise/gradient plan repeated | Two unsuccessful same-causal-direction corrections require a different diagnosis and evidence before continuing; repeated user instructions count as failures, not proof |
| PILL-08 | Tier 2/3 progression unclear or generic/cluttered | Reviewer can distinguish progressive armor/detail/silhouette without altering approved Tier 1 language |
| PILL-09 | Finished/approved claims followed receipts without visual acceptance | Never mark PASS/APPROVED on a CLI success, image hash match, or callback declaration alone |
| PILL-10 | Separate file/export/live-state confusion | Required single asset structure checked on authoritative saved .bbmodel and verified opened state, not assumed from local file existence |

Reviewer face labels must agree with saved pixel opacity before either a
single-page or paged review can cache ACCEPTED: a fully transparent face
requires INTENTIONAL_TRANSPARENT, while any face with visible pixels cannot
claim that exception. This source-level consistency check does not establish
camera visibility, independent image interpretation, or user artistic approval.

Geometry/UV and Animation remain their respective authoring owners; do not repair a geometry cause by repainting arbitrary atlas pixels.

## Reference Package automatic handoff: missing evidence remains explicit

When the selected Pillager `.bbmodel` and canonical `REFERENCE.json`
are in one active Workspace, the Code Mode operator CLI can locate
`reference/REFERENCE.json` or `references/REFERENCE.json` without transcribing each explicitly
annotated visible approved surface detail. Only declared
`SURFACE_DETAIL` source regions and corresponding supported semantic
parts produce MATCH_REFERENCE checks, not assertions that an existing
model part was accepted. A currently rejected CORRECT part is excluded;
true PRESERVE requires separately established approved model state.
The approved source still cannot disclose Cube/UV atlas coordinates.
Front/back annotations may reuse the same source-region ID; Code Mode
issues separate reviewer criteria per selected view instead of conflating
the two annotations. Conversely, copied PNG bytes under different camera
filenames cannot satisfy independent multi-view image requirements.
Neither guard attests real camera provenance or artistic correctness.
No guessed correction region, accepted user decision or equivalent image
camera is created automatically. Unannotated/ambiguous references
remain an explicit blocker rather than an inferred PASS.

## User-decision convergence cases

The approved user/Workspace reference, not the agent's latest prose,
is the source of required art. At the operator-owned Rust visual review
boundary, project its current decisions into
`--visual-manifest.reviewCriteria`:

- `PILL-01/PILL-05`: `PRESERVE` Tier 1 shield markings and
  neutral iron, including bounded physical texture regions when known.
- `PILL-03/PILL-07`: `CORRECT` the repeatedly rejected helmet
  bar with its own physical atlas, visible view and source PNG SHA.
- Every review must report `MET`, `VIOLATED`, or `UNVERIFIED`
  for *every* criterion; no acceptance from one freeform summary.
- A regression of approved identity is refused before further Paint.
  Guest-selected operations remain bounded to the original corrective
  region, not the reviewer's newly invented wider rectangle.
- Final all-face/source readiness also needs these criteria all
  independently `MET` and still returns only readiness for user decision.

These fixture/source gates do NOT prove that a real image reviewer
recognizes the helmet or improves material quality. Actual A/B
evaluation, corrections and user acceptance are NOT_EXECUTED.

## Exact correction loop

1. The authorized operator selects one source .bbmodel revision, actual approved image(s), and current model capture from the same viewed region. Bind their SHAs and view name in the existing Rust Code Mode host.
2. An actual independent reviewer inspects BOTH image buffers and returns ACCEPTED, REJECTED or UNVERIFIED. Rejections require stable issue ID, observed defect and bounded affected texture region; do not let the guest invent reviewer approval.
3. For one rejected defect, bind one reviewer issue ID and material-correction diagnosis: semantic part, material type, suspected cause, directional shading/material treatment and expected visible change. The operator's reviewer may carry known rejected `issueId + approachId` pairs across revisions; repeating the rejected approach is refused. Start with **one small reviewer-selected atlas patch, an actual Cube UUID and its local face direction**. The Rust face inspector must confirm the exact texture/UV/ownership and return six saved face-alpha statuses without a visual PASS. Save the model and inspect the rendered sample from a fresh SHA-bound capture. Only when the reviewer declares the representative material accepted may remaining styled areas be expanded, without repainting the sample. Rust verifies authorized changed pixels and preservation. Do not mutate accepted or unverified snapshots.
4. Reopen/capture the saved new revision and bind an updated image pair. Never use an earlier capture or repeat a stale approved decision. Check the repaired region, corresponding protected parts and views not targeted.
5. Record actual accepted/rejected outcomes and diagnostic direction. If the same approach is rejected twice, stop that approach and require new causal visual evidence. For a rejected exact Paint operation plan, retain `texturing_workflow.operation_plan_fingerprint_sha256` in the authorized review history and return it as `rejectedPaintPlans` with the same part and texture UUID. The trusted host rejects that exact replay despite renamed labels. The existing host has no cross-session retry-memory; the operator's recorded evaluation supplies continuity. A fingerprint match is operation identity, not visual equivalence.


## Paged Golem/large-Pillager face accounting — source-only

The historical Golem's 372 mapped Cube-face entries exceeded the first
external reviewer inventory's 256-face limit. The reviewed Rust Code Mode
source now uses bounded pages (256+116 for an exactly 372-face source
inventory) rather than claiming one partial inventory is complete.
Every page keeps the exact model SHA, its own native Cube/face/texture
IDs, all six matched camera pairs, and the current approved visual
criteria. A genuinely independent image-capable reviewer must examine
and acknowledge each face and source image page. Missing, duplicate,
unresolvable or unreviewed source faces retain BLOCKED. Source face
counts and reviewed declarations do not demonstrate that a hidden
face was visually present in an image; genuine visibility and artistic
quality still require reviewer/user assessment. The host also repeats
native saved face coverage and style diagnostics before issuing only
`REVIEWER_DECLARED_READY_FOR_USER_DECISION`.

The maximum admitted paged source is four 256-face pages and 256
saved Cubes; larger models remain unresolved rather than fabricating
coverage. Likewise the current 12-criterion manifest limit is
unchanged and must not silently drop user-approved requirements.
All positive/negative Node cases are AUTHORED_NOT_RUN; the historical
Local Golem was **not** independently reviewed in Rust or converted
into a verified rendering in this change.

## Multi-view acceptance gate for source-only Rust workflow

Broad reviewed texture propagation **requires** six selected camera
pairs; local representative sample correction may use one relevant view.
The operator must select six actual rendered view pairs with
`preselectedVisualPair.supportingViews` and
`requireSixDirections:true`. These images are not extracted from
the six saved Cube alpha faces. They must have one source model
SHA, independently pinned reference/capture SHA for each direction,
matching view/crop/lighting supplied by the authorized reviewer,
and a per-direction ACCEPTED/REJECTED/UNVERIFIED record.

**Do not claim all-sided texture completion** from source face-alpha
histograms, a single front screenshot or merely selecting six files.
The independent reviewer must see every actual pair. If a direction
is hidden/occluded or cannot be meaningfully compared, mark it
UNVERIFIED and keep broad reviewed propagation held. One corrected
front sample can be reviewed locally without claiming global
completion. A whole-material ACCEPTED declaration is invalid if
any selected direction remains REJECTED/UNVERIFIED.

Subsequent revisions require entirely new SHA-bound candidate
captures and fresh reviewer declarations; saved Cube orientation
or texture alpha can help localize a defect, but do not prove that
the camera screenshot represents the intended shaded face.
## Negative controls already represented in source

- A second review attempt cannot downgrade ACCEPTED to REJECTED for the identical model/image binding.
- Replacing either image after preflight prevents Paint before write approval/native mutation.
- A rejected review must not allow changes outside its rectangle or weakened alpha.
- A completed scoped correction cannot be repeated against the consumed source/capture.
- A missing material intent, unknown reviewer issue, mismatch against a reviewer-declared part, or reviewer-listed rejected approach cannot launch a new Texture Paint. Renaming the same idea under a new ID is not independent visual improvement.
- A broad Paint before independently accepted representative shading is observed must be refused, even when the earlier rejected review allowed a larger region. During propagation the accepted sample cannot be repainted, and the new capture/source revision must match the review.
- A caller-declared Cube/face that is not explicitly linked to the selected atlas or whose projected UV does not wholly own the sample must be refused; aliasing/implicit links are not silently guessed. Six saved source faces do not replace independently reviewed 3D front/back/side/underside views.
- Equal PNG hashes, arbitrary color transitions, or full opaque backgrounds cannot establish professional texture quality or silhouette acceptance.

The authored Node cases use synthetic header-only PNGs to exercise host authority with a mocked CLI; they do not constitute an actual decoded PNG, image-rendering or artistic-quality test. Real Rust decoder and native interface tests remain on hold.

## Source-authored P0 reviewer transport and opaque-face negative case

At the operator boundary, the standard Code Mode CLI can now accept a
separately configured trusted image reviewer executable plus SHA-bound
actual rendered image pairs. Native Rust source face IDs are delivered
alongside actual PNG bytes via the external process's bounded stdin;
model-written JavaScript never receives private PNG bytes or filesystem
paths. This is a source-wired **capability**, not a shipped vision model,
successful image ingestion or live visual acceptance.

A positive source-only transport fixture must verify real image buffers
and exact per-view SHA return bindings. Negative fixtures must reject
stale image hashes, mismatched reviewer replies, absent source inventory,
and missing opaque-but-required Cube faces even when six directions were
declared ACCEPTED. For PILL-06, intentional absent faces may be excluded;
valid opaque faces must not be silently excluded from reviewer accountability.
A material requiring more than 256 reviewed faces uses the separately
source-bound paged reviewer process (up to 1024 active faces across four
pages). Missing or unverifiable page evidence remains UNVERIFIED;
the process is source-authored but not native/artistic-tested. Existing PILL-01
through PILL-10 acceptance and test holds remain unchanged.

## PILL-03 cluster geometry and execution coherence — source only

A reviewer-selected first `FLAT_SHADING` helmet sample must now
include the same `MaterialWorkPacket` form/light/palette/connected
shadow/highlight masks required by broad propagation, but confined
to exactly one actual reviewer-selected Cube face and scoped atlas
patch. Direct flat-fill shortcuts and mismatched model/reference/
face plans are refused before approval. Rust remains the single
bitmap, UV and Undo owner. Source regressions cover missing and
incorrect sample plans as well as valid compiled samples; none
establishes that the submitted cluster actually resembles metal.
Independent fresh visual acceptance of the saved sample is still
required. Intentional flat marks and small independent detail
corrections are not forced into FORM_SHADING. TEST_AUTHORED_NOT_RUN.

## PILL-01/PILL-05 — preserve source identity by original RGBA guard

An allowed metal-shading patch that contains original red/blue artwork
must not have its old identity colors silently repainted just because
they lie inside a broad correction rectangle. In reviewed propagation
the independent reviewer must select the actual saved RGBA colors that
may be overwritten (typically identified with a SHA-bound
`texture_source_colors` atlas read). The Deno guest cannot increase
that permission. Rust atomically refuses any changed pixel whose
old RGBA falls outside the selected source colors, as well as
protected-coordinate violations and alpha regressions.

Source-authored cases: one metal base recolor succeeds; attempting
metal recolor plus old red marking alteration in the same transaction
refuses all writes/Undo changes; stale and duplicate before-colors
refuse; guest-only source colors do not authorize reviewed propagation;
a guest trying to replace the reviewer's palette cannot broaden it.
This checks source identity protection, not reference-to-render style
or Pillager artistic acceptance. Native tests NOT_EXECUTED.

## PILL-01/PILL-04 — protected identity pixels within correction scope

A Tier 2/3 helmet correction may legitimately change the surrounding
metal atlas while preserving an already-approved emblem, helmet trace,
neutral hardware or shield identity **inside that same broad region**.
Reviewers can now bind exact `protectedRegions` and
`expectedBeforePixels` into the existing Rust correction scope.
Negative cases must attempt to modify a protected identity pixel, send
a stale/wrong original pixel, and omit or replace a reviewer-declared
guard. They must be refused before any final mutation. A valid change
elsewhere in the same allowed atlas area must retain Undo/redo
compatibility and original approved marks. Source tests authored,
NOT_EXECUTED. Only actual approved image/model comparison can identify
which pixels deserve that protection.



After a real reviewer accepts the representative helmet sample, a
`FORM_SHADING` propagation packet must supply distinct connected
Cube face-local shadow/highlight masks, not a textual claim that
two shades will appear. The trusted host compiles these masks into
the existing Rust guarded face-region painter, refuses arbitrary
alternate guest operations, disconnected fragments, accidental
overlap, duplicate/unknown palette roles and invalid scope/UV.
An intentional flat face does not need false gradients. These
source checks are not pixel-art quality acceptance: compare current
images with the approved actual references and preserve the accepted
sample/shield before any final verdict. Source fixtures authored but
NOT_EXECUTED.

## Golden PILL-03/PILL-07 MaterialWorkPacket source contract

A reviewed propagation sample may not become a cohort-wide Paint unless
Code Mode supplies the current source/reviewer-bound `materialWorkPacket`.
For PILL-03, the packet must describe helmet form, light direction,
material-appropriate palette roles and deliberate shadow/highlight
clusters tied to actual Rust Cube-local faces. The host verifies
source/UV ownership and only authorized face-local Paint touches those
specified atlas regions. A base-only FORM_SHADING operation is refused;
one intentionally flat identity or detail pixel remains valid in its
own scope. A distinct ramp and a well-written plan are never a visual
PASS—only fresh native/reference matched views can support artistic
acceptance.

Negative cases must include missing packet; conflicting issue,
approved reference SHA or model SHA; mismatched atlas rectangles;
unbound/missing face; direct unplanned pixel Paint; an arbitrary new RGB;
and fake flat form-shading propagation. Verify the accepted representative
sample cannot be repainted. Source-only Node fixtures have been authored,
**NOT_EXECUTED** while localtest/CI are on hold; no actual Pillager art
improvement is measured.

## PILL-09 native receipt cannot masquerade as artist acceptance

A source-corrected Pillager candidate is not an accepted
texture merely because `apply` returned `OK`. Before creating
the next Code Mode project handle, require a matching native
scoped Paint receipt (source SHA, original pixel-guard counts,
operation count, revision and candidate output SHA) and reopen
that candidate to compare its actual SHA. If the receipt is
missing or contradicts the source scope, return an explicit
uncertain/failed result, preserve the possibly published sibling
for operator reconciliation, and do not issue automatic retry
under another filename. A reviewer-bound source lease is spent
on ambiguous published success. The image reviewer must still
inspect the fresh candidate with actual, matched mapped views.
Source regression fixtures AUTHORED_NOT_RUN.

## Evidence and stop criteria

Record only actual observations: case ID, source SHA, camera/view, approved reference PNG SHA, candidate PNG SHA, reviewer/host/version, issue ID, observed defect, correction approach, permitted atlas rectangle, protected regions, final user decision, reason for rejection and native proof. When any observation is missing, write NOT_EXECUTED, UNVERIFIED or BLOCKED with the specific gap.

To claim measurable improvement, compare identical Golden cases for baseline/candidate: user accepted outcomes, repeated rejected causal treatments, protected-area regressions, human correction rounds, and elapsed time-to-acceptance with real timestamps. Do not invent percentages, faster performance or reduced tokens from source-file changes alone.

**Current ceiling:** source commits and authored tests; no actual Pillager A/B image comparison, user approval, model image ingestion or PC-local native execution has occurred in the ChatGPT/GitHub work surface.
