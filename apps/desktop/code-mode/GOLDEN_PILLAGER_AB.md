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

## Frozen acceptance cases

| Case ID | Prior user feedback | Acceptance evidence to obtain |
| --- | --- | --- |
| PILL-01 | Approved Tier 1 shield was modified during requested higher-tier grading | Exact approved Tier 1 pixel/carrier unchanged in saved file and matched visual views |
| PILL-02 | Tier 2 shield artwork looked smaller despite equal Cube dimensions | Compare visible artwork bounds, not merely Cube dimensions |
| PILL-03 | Tier 2/3 helmet was a flat band rather than hand-painted metal | Human/visual-capable reviewer sees material hierarchy and highlights/shadows on a helmet close-up; numerical color count is insufficient |
| PILL-04 | Unwanted side/head ornaments or removed required helmet and face trace | Approved helmet remains, prohibited side ornament absent, red face trace retained in front and side views |
| PILL-05 | Blue/red variant shading recolored neutral iron and collapsed identity | Hardware remains neutral where requested; accents/shield red follow approved reference |
| PILL-06 | Rear, side and undersides were overlooked | Pin sample to Cube/UV/texture owner; measure six saved Cube-face alpha states **separately** from six operator-selected rendered camera pairs. Record a concrete reviewer outcome for each front/back/left/right/top/bottom view; unresolved or occluded views block broad propagation and cannot pass quality |
| PILL-07 | Same rejected stripes/noise/gradient plan repeated | Two unsuccessful same-causal-direction corrections require a different diagnosis and evidence before continuing; repeated user instructions count as failures, not proof |
| PILL-08 | Tier 2/3 progression unclear or generic/cluttered | Reviewer can distinguish progressive armor/detail/silhouette without altering approved Tier 1 language |
| PILL-09 | Finished/approved claims followed receipts without visual acceptance | Never mark PASS/APPROVED on a CLI success, image hash match, or callback declaration alone |
| PILL-10 | Separate file/export/live-state confusion | Required single asset structure checked on authoritative saved .bbmodel and verified opened state, not assumed from local file existence |

Geometry/UV and Animation remain their respective authoring owners; do not repair a geometry cause by repainting arbitrary atlas pixels.

## Exact correction loop

1. The authorized operator selects one source .bbmodel revision, actual approved image(s), and current model capture from the same viewed region. Bind their SHAs and view name in the existing Rust Code Mode host.
2. An actual independent reviewer inspects BOTH image buffers and returns ACCEPTED, REJECTED or UNVERIFIED. Rejections require stable issue ID, observed defect and bounded affected texture region; do not let the guest invent reviewer approval.
3. For one rejected defect, bind one reviewer issue ID and material-correction diagnosis: semantic part, material type, suspected cause, directional shading/material treatment and expected visible change. The operator's reviewer may carry known rejected `issueId + approachId` pairs across revisions; repeating the rejected approach is refused. Start with **one small reviewer-selected atlas patch, an actual Cube UUID and its local face direction**. The Rust face inspector must confirm the exact texture/UV/ownership and return six saved face-alpha statuses without a visual PASS. Save the model and inspect the rendered sample from a fresh SHA-bound capture. Only when the reviewer declares the representative material accepted may remaining styled areas be expanded, without repainting the sample. Rust verifies authorized changed pixels and preservation. Do not mutate accepted or unverified snapshots.
4. Reopen/capture the saved new revision and bind an updated image pair. Never use an earlier capture or repeat a stale approved decision. Check the repaired region, corresponding protected parts and views not targeted.
5. Record actual accepted/rejected outcomes and diagnostic direction. If the same approach is rejected twice, stop that approach and require new causal visual evidence. The existing host has no cross-session retry-memory; the operator's recorded evaluation supplies continuity.


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
A material with more than the bounded 256 reviewed faces remains
UNVERIFIED until an authorized broader process exists. Existing PILL-01
through PILL-10 acceptance and test holds remain unchanged.

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

## Evidence and stop criteria

Record only actual observations: case ID, source SHA, camera/view, approved reference PNG SHA, candidate PNG SHA, reviewer/host/version, issue ID, observed defect, correction approach, permitted atlas rectangle, protected regions, final user decision, reason for rejection and native proof. When any observation is missing, write NOT_EXECUTED, UNVERIFIED or BLOCKED with the specific gap.

To claim measurable improvement, compare identical Golden cases for baseline/candidate: user accepted outcomes, repeated rejected causal treatments, protected-area regressions, human correction rounds, and elapsed time-to-acceptance with real timestamps. Do not invent percentages, faster performance or reduced tokens from source-file changes alone.

**Current ceiling:** source commits and authored tests; no actual Pillager A/B image comparison, user approval, model image ingestion or PC-local native execution has occurred in the ChatGPT/GitHub work surface.
