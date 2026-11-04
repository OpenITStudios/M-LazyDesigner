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

## Verify AI pixel ingestion before trusting visual QA

A successful Blockbench render and valid MCP ImageContent do NOT prove the
receiving AI actually saw the pixels. On a new/changed AI client, call
`capture_model_views` once with ordinary view arguments plus
`ai_ingestion_probe: true`. This appends one synthetic 4×3 color-grid PNG
after the actual model images, with a separate receipt. It is NOT an asset
render, reference image or visual QA verdict, and is never automatic.

Ask AI for 12 color letters in row-major order (R red, G green, B blue,
Y yellow, C cyan, M magenta). The answer does not appear in the textual
MCP result. Independently verify the reported answer with the receipt's
nonce and expected_answer_sha256. Digest construction:
`SHA256("LAZYDESIGNER_MCP_IMAGE_PROBE_V1\\n"+nonce+"\\n"+answer)`.
For an independent local check, run:
`node mcp/scripts/qa/verify-mcp-image-probe.mjs <nonce> <sha256> <AI_12_LETTERS>`.
The command returns a machine-readable PASS/FAIL and a nonzero exit code
on mismatch. Never put the answer into the prompt before AI reads the PNG.
The reusable pure checker is `verifyVisualIngestionProbeResponse` in
`mcp/lib/protocol/visualIngestionProbe.ts`. Wrong answer / missing image
means the client's pixel ingestion is UNVERIFIED. A correct answer proves
only this particular image transport; it is not a motion or visual PASS.
Never replace actual pixels with a file path, hash or written description.

`inspect_animation(diagnostics=true).motion_dynamics.temporal_image_capture_hints`
offers image-free candidate timestamps ranked from authored numeric keys;
it does not render interpolated frames. Capture only decision-changing poses
within the current views × times × optional silhouette ≤8 limit. Missing
samples, MoLang, controller playback and continuous motion stay UNVERIFIED.

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

## Smart Evidence Selection (target-bound, source-only)

For automatic `capture_model_views(evidence_targets=["silhouette"])`,
only canonical views whose primary evidence supports silhouette receive
the extra silhouette PNG. Other risk-expanded views still deliver shaded
model images; explicitly selected views keep mask-per-view behavior.
`view_selection.silhouette_mask_views` reports the exact plan and
Animation's eight-image preflight uses the same selection function.

A scoped Texture `get_texture` follow-up can now supply
`continuation.next_action.evidence_request.args` with the exact
`texture`, `region={x,y,width,height}`, and `expected_revision`
derived from the current right-exclusive affected rectangle. This is a
suggestion, not a tool call, image cache, or visual PASS. The model still
needs actual mapped 3D/reference comparison when material fidelity is
under review.

`inspect_animation(diagnostics=true,bone=...,time_range=...)` now
returns optional timestamp hints only for the selected bone and window.
Bracketing authored keys are included for candidate selection, and
different high-change intervals are prioritized before redundant frames
within the same interval. No native interpolation/playback or PNG is
performed by these hints. Continuous motion remains UNVERIFIED.

## Texture inline-image transport and cohort deferral

The native `paint_texture_transaction` produces a postcondition-checked
affected-region PNG by default. Its `visual_evidence` receipt now includes
the PNG's encoded byte length and SHA-256. Before Control marks
`evidence_source=mutation_response`, the Gateway must see exactly one
actual PNG `content.image`, verify canonical Base64, PNG envelope and
dimensions, and match its bytes with the signed-by-source digest claim.
A metadata-only `visual_evidence` claim cannot authorize
`REVIEW_RETURNED_EVIDENCE`; the focused `get_texture` route remains.

For an explicitly grouped editing sequence, pass a nonempty
`task_context_id` and `cohort_boundary=CONTINUE` through existing
`invoke_capability`. On successful native paint mutations whose PNG
transport is verified, the Gateway omits that **intermediate PNG only**,
retains mutation receipts and pending visual debt, and reports that the
image was withheld. The default and `COMPLETE` requests retain the
actual PNG. The final image avoids another `get_texture` call only
when its verified revision and rectangle fully cover the merged cohort.
Otherwise Control retains `follow_up_read`. The source still performs
PNG encoding internally, so this is AI image-transport economy, not
measured native speed or model-token savings.

Do not group edits that need intermediate visual decisions, do not
silently defer failures or unverified source bytes, and never treat
producer PNG, SHA-256, transport match or reduced calls as visual PASS.
An approved reference and the relevant mapped model view still need
actual side-by-side perception for material fidelity.

## Lossless same-response image evidence

The canonical `capture_model_views` tool still renders **every selected view**
(including required risk expansion) and performs any requested Cube silhouette
measurement. It now computes a SHA-256 identifier for each actual shaded PNG
and includes that identifier plus delivery provenance in every per-view receipt.

Within **one** tool response, a later image with **exactly identical PNG bytes**
and the same role (shaded model vs. solid Cube silhouette mask) can point to the
image already delivered earlier in that response. Each view retains its own
camera specification and identity. Merely similar images, different roles,
different invocations, different project revisions, and unproven image matches
are never deduplicated. The returned `image_transport` counts actual delivered
and exact-reused image items; `total_png_bytes` continues to describe all
captured model views, not a measured token/API saving.

This is **transport compaction**, not a screenshot cache or permission to skip
a required view. A byte hash is not evidence of source fidelity, current native
revision attestation, actual visual inspection, user approval, or Minecraft
runtime behavior. Model and approved reference pixels must still be visible to
the reviewing model before an applicable visual PASS. Native 3D/camera facts can
narrow which view is useful, but cannot replace perceptual comparison.

The next optimization should benchmark exact delivered image counts, bytes,
native render time and cost-to-accepted-result against identical input assets;
do not claim a percentage reduction without a measured live run. Deterministic
camera/capture compatibility is a precondition for visual diffs, as documented
by [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).
An image-capable Codex model is not itself an attestation of the Blockbench
viewport or reference fidelity.

## Native capture freshness, not an image cache

The existing `capture_model_views` native owner now fingerprints the same
project's Cube geometry, face UV/material references, Group hierarchy,
current rendered Cube world matrices, decoded texture pixels within a bounded
on-demand budget, pose context and capture presentation before and after the
requested view series. It also incorporates caller-supplied reference identity
metadata without pretending that Runtime can certify the Gateway's approved
Reference Package. Every model view carries a camera/image/dependency-bound
`capture_contract_sha256`.

If project identity or tracked dependency bytes change across the series, the
tool fails closed with `MODEL_CAPTURE_STALE`; it does **not** deliver mixed
before/after screenshot proof. Unknown texture canvas, budget exhaustion,
unsupported visible non-Cube geometry, missing native pose or renderer state
sets `evidence_freshness.state=UNVERIFIED` with explicit reasons. The requested
views are still captured for manual comparison; missing coverage is **not**
quietly treated as validated. Source-reference image pixels and native renderer
attestation remain outside this internal identity fingerprint.

`MATCHED` means only that the **tracked same-call dependencies** were observed
unchanged; it is not an artistic, reference, animation playback or in-game
PASS. No cross-invocation screenshot reuse is authorized: a future cache must
independently match current native state, reference bytes and capture context.
Fingerprint reads run only when users actually request capture, not at every
Cube edit. Live native acceptance and measured savings are still required.

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

## MP4-only offscreen encoder readiness

`lib/animation/mp4RecordingPlan.ts` owns bounded project/clip/revision,
resolution, duration, bitrate and requested FPS, plus explicit H.264 MP4
codec selection. `server/runtime/animation/mp4Encoder.ts` owns the
`MediaRecorder`-based encoder from an existing canonical offscreen
Blockbench canvas. It does **not** call `Timeline.setTime`,
`Animator.preview`, or generate PNG/GIF. It uses a detached (not user-facing)
video element to probe that the first encoded MP4 frame can be decoded;
the temporary blob URL is revoked immediately. This first-frame probe
is NOT whole-video decoding, exact frame-count proof, visual motion QA,
or evidence that Sol can consume MP4. A future verified native
playback adapter must keep the scene rendering and restore all state
safely; no such adapter is currently connected.

`inspect_animation(diagnostics=true)` can now return
`motion_mp4_encoder_probe` when the Runtime supports MIME probing.
`SUPPORTED_BY_MIME_QUERY_ONLY` checks device support, **not** that
any frame was recorded or that the output's timing/codec is attested.
The encoder reports actual output MP4 bytes only with explicit
non-approving flags for authored playback timestamps, encoded frame
count, native state restoration and Sol video consumption. When H.264
MP4 cannot be recorded, the route fails without WebM/GIF fallback.
The maximum request budget is bounded to avoid excessive resource
consumption.

## AI-only MP4 binary resource — transport, not review

Runtime registers a non-listed, short-lived binary resource using the existing
MCP `createResource` factory: `motion-evidence://{id}/{revision}/{sha256}`.
There is NO UI player, no GIF, no scheduled screenshot flow and no file
written to the user's project. A trusted in-process native encoder (NOT YET
IMPLEMENTED) is the only intended producer, via
`nativeMotionMp4EvidenceSlot.publishFromNativeRecorder`.

The source restricts payload size, parses bounded top-level MP4 boxes, checks
encoded-byte length/SHA, requires current project/animation/revision on each
read, expires old artifacts and never lists evidence as a user-visible item.
This does not prove H.264 decodability or time continuity. A base64 MP4 read
through MCP proves binary transport at most, NOT that GPT-6.1 Sol watched
or understood the video. The AI-consumption/quality gate remains
`UNVERIFIED` until independently supported.

The existing four-tool Gateway now exposes only this exact unlisted MP4
resource via a narrow `resources/read` proxy. It does NOT proxy arbitrary
Runtime files or resources, does not create a fifth tool, and does not add
a user preview. Reads run through the existing Gateway Runtime operation
queue with bound project/Animation-stage and generation checks; the Gateway
independently validates MP4 MIME/container/hash after reading the blob.
No remote arbitrary URL, filesystem path or unbounded binary payload is
accepted by this bridge.

This makes MCP *binary access* possible when a future native recorder
publishes a real clip; it does NOT mean the current Sol client supports
ingesting or reviewing MP4 as video. Motion remains `UNVERIFIED` until
that separate client capability and actual perceptual review are established.

## Evidence medium contract: Geometry / Texture / Animation

Geometry uses native geometry facts plus selected still model views for
form-fidelity questions. Texture uses native UV/bitmap and optional PNG crop
plus mapped shaded model views. Animation has **three distinct gates**:

1. **Technical Animation:** authored keyframes, curves, rig, trajectory,
   contacts and effects; scope-limited native data, not a motion visual PASS.
2. **Static Pose Fidelity:** selected reference-paired pose PNGs. These may
   establish a named pose claim but cannot establish motion continuity.
3. **Temporal Motion Fidelity:** actual observed time-sequence movement
   (timing, weight, foot sliding, recovery, loops). The ONLY planned
   visual artifact is MP4/H.264; GIF and user-facing video preview are
   explicitly excluded.

The existing `inspect_animation`, multi-pose
`capture_model_views(animation_preview)`, and successful
`manage_animation_timeline(...play)` emit a non-approving
`animation_evidence_boundary`: temporal-motion remains `UNVERIFIED`
until an independent, revision-bound MP4 has really been produced,
delivered and consumed by the AI reviewer. PNG count, elapsed timeline,
Molang syntax, a plausible trajectory report and a model-facing MP4
descriptor alone NEVER prove temporal motion. The current MCP tool
content contract and connected AI client do not yet provide a verified
MP4-consumption bridge. Do not introduce a fake URL, in-memory video
claim, polling screenshots or alternative media codec to disguise it.

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
For structured visual corrections, a fresh evidence handle alone cannot
refresh a previously affected view. After the native correction receipt,
`recovered_views` must explicitly cover the pending stale views even when a
discrepancy still exists. This is a review declaration, not native attestation;
raw numeric Recipe corrections retain their existing update contract.

Unrelated discrepancies remain tracked independently. For non-targeted full
updates, previously recorded claims also need explicit clearance before
they disappear; do not rename a remaining mismatch to bypass verification.

A local correction must prove direction, not merely mutation activity. Compare the relevant fresh pre-correction evidence with fresh post-correction evidence for every materially affected supported claim/view:

```text
IMPROVED | UNCHANGED | REGRESSED
```

A correction counts as progress only when the target mismatch is `IMPROVED` and no previously supported material claim/view is `REGRESSED`. `UNCHANGED` or `REGRESSED` is not progress. If one paired view improves while another material paired view regresses, reject that correction direction; change the causal diagnosis or reopen the owning Primary Form Hypothesis rather than patching around the regression.

For a structured visual correction, every view cited by a newly submitted
post-correction finding must also appear in `recovered_views`; otherwise its
previous capture cannot silently become fresh evidence. A newly reported
`BLOCKING` claim, or increased severity of a known non-target claim, prevents
net convergence from being marked `IMPROVED` or `RESOLVED`. The existing
`PLATEAU` result means safe improvement has not been established; it does not
attribute the new problem to the edit. If the target's diagnosed cause changes,
`CAUSE_CHANGED` takes priority over a simultaneous severity decrease.
Neither rule adds a visual quality score or automatic approval.

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

## Claim-scoped optional Animation diagnostics

Existing `animation_preview` now selects its **optional** native
world-OBB/Locator/joint-origin scans from already declared
`evidence_targets`. For appearance-only silhouette/count/width/height,
extra native motion scans are not requested. Attachment still performs
geometry/Locator/joint observations, and geometry claims such as depth
or orientation retain world-OBB evidence. When there are no grounded
targets (only explicit views), legacy full native diagnostics remain.
The `native_pose_diagnostic_scope` receipt declares the exact selected
readers; absent reports cannot be interpreted as PASS.

This is scope selection, not a public API/schema change or motion quality
approval. Every required visual image and the fixed pose-frame
contract remain unchanged.

## Fixed camera for multi-pose Animation evidence

Multi-pose `animation_preview` first uses temporary native scene evaluations
to collect the rendered bounds of only the specified times, without images.
It creates one shared explicit frame for every later model image, rather than
re-centering or auto-zooming separately for each pose. A caller-supplied
explicit frame must already cover every sampled pose or it fails before
rendering. Current native pose bounds are compared against the prepass to
detect incompatible native changes.

The `shared_pose_framing` and `pose_camera_comparability` receipts prove
only sampled-frame planning and matching computed camera settings. They do
not establish live GPU camera attestation, missing intermediate motion
extrema, approved source camera calibration, or visual PASS. This prepass
adds bounded native CPU work but does not transport PNGs.

## Animation evidence integrity and capture cost

The existing Animation Runtime extension supports `animation_preview.times`
within the existing `capture_model_views` tool. Times must be chosen for
specific pose/contact events, not generated every fixed number of seconds.
The limit of eight potential images per request is a maximum, **not** a
screenshot budget to exhaust. Inspect the authored clip and current native
poses first; use playback for dynamic continuity and use still images only
for actual unresolved visual pose/reference claims.

Every per-time response now validates delivered shaded PNG bytes or an
exact-byte alias to an earlier **same-role, same-pose** image. A model PNG
must never be considered present because a silhouette mask increased the
total item count. Invalid alias/image labels/identity fail closed. Silhouette
images retain their `SILHOUETTE VIEW` labels during multi-time composition.

Multi-time usage totals aggregate all per-time model/mask counts, actual
delivered/reused bytes and native capture time. The per-time capture
freshness, framing, reference correspondence and evidence metadata are
not silently replaced with the first pose's values. No token billing
or cross-pose image-reuse claim is inferred.

The canonical camera framing path now skips the separate OBB pairwise
surface-warning scan; that diagnostic remains owned by
`inspect_model_bounds` when it can change the structural decision.
Ordinary capture still evaluates rendered bounds and its own freshness
contract. Avoid requesting silhouette masks merely to reaffirm numeric
width/height when the real visual question is different.

## Usage-aware visual evidence routing

Control `VERIFY_VISUAL` still means visual verification is owed.
For `CUBE_TARGETS`, the continuation no longer recommends an immediate
`capture_model_views` after every Cube edit. Reuse the current mutation
receipt and existing native evidence; call `inspect_model_bounds` only
when structural uncertainty actually changes the next decision.
At a reference-fidelity gate, inspect matched approved source/model pixels.
Numeric structure alone cannot establish a visual PASS.

`TEXTURE_REGION` retains strict revision/rectangle coverage and uses
a verified returned crop where it covers the change; otherwise read
`get_texture`. Animation keeps meaningful sampled motion/pose reviews.
Cohort `CONTINUE` is batching, not indefinite review deferral.
Unknown outcomes, stale evidence and skipped claims cannot count as savings.

`capture_model_views.image_transport` measures same-response image
counts, generated/delivered/exact-reused PNG bytes and processing time.
This excludes separately delivered approved references, texture crops,
other tool images and actual GPT-6.1 Sol token billing. Do not calculate
token cost from PNG bytes.

## Native-first evidence economy (zero-image geometry triage)

Before requesting a new model screenshot for geometry hygiene, consume the
existing `inspect_model_bounds.surface_integrity.evidence_economy` projection.
It does **not** run a second scan: it classifies the exact same native Cube
surface, containment and projected-contribution results already produced by
the current inspector. It costs **zero additional image bytes** per receipt,
not necessarily zero CPU or zero text tokens.

- `FIX_NATIVE_SURFACE_BLOCKER`: same-facing coplanar Cube/face pairs already
  carry concrete UUID evidence. Correct the confirmed structural issue through
  the existing authoring/correction path; do not request a screenshot just to
  reconfirm a deterministic overlap.
- `RESOLVE_NATIVE_COVERAGE`: a rotated, unsupported, cross-parent, invalid
  or budget-omitted region remains structurally unverified. A screenshot
  cannot prove the missing *numeric* scan completed.
- `REVIEW_NATIVE_GEOMETRY_CANDIDATES`: inspect existing positive-volume,
  containment, and projected-outline findings before requesting visual data.
  These are not deletion recommendations or proof of aesthetic redundancy.
- `REFERENCE_VISUAL_GATE_ONLY_WHEN_DUE`: a clean native check does not
  justify a celebratory screenshot. At the appropriate modelling review gate,
  the actual approved source image **and** matching current model view are still
  required for reference-fidelity PASS.

For UV/texture and animation, use existing native UV/bitmap and keyframe/
contact diagnostics before choosing the smallest unresolved region or
meaningful pose. Reuse fresh mutation receipt images when they actually cover
the affected texture region. Do not generate geometry screenshots after every
Cube edit or full-frame animation screenshots at every keyframe. This policy
changes **evidence order**, not verification ownership or review gates.

A screenshot-free ray hit can potentially identify a Cube candidate from a
known camera coordinate, but cannot establish pixel-accurate UV, alpha
occlusion, material appearance, or artistic similarity. Do not create a
duplicate raycasting renderer before actual native evidence shows existing
UUID-backed issue navigation cannot answer a specific defect. No new public
Gateway/capture schema is required for the native-first route.

**Cost measurement:** compare equal golden assets using total delivered image
items and bytes, model-visible tokens when reported by the client, native QA
latency, missed critical defects, and corrections to accepted quality. No
claimed savings percentage exists without live measured baselines.

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
